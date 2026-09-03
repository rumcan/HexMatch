import { COSTS, ResKey, SABOTAGE, SECURITY, BANDIT_MS, FOG_MS, BLOCK_MS, choice, randInt } from "./config";
import { G, Player, bus } from "./state";
import { canBuildRoad, canBuildSettlement, canBuildCity, vertNeighbors, tollRoadOwner } from "./hexmap";

export function canAfford(p: Player, cost: Partial<Record<ResKey, number>>): boolean {
  return (Object.keys(cost) as ResKey[]).every((k) => p.res[k] >= (cost[k] ?? 0));
}
function pay(p: Player, cost: Partial<Record<ResKey, number>>) {
  (Object.keys(cost) as ResKey[]).forEach((k) => { p.res[k] -= cost[k] ?? 0; });
}

export function gainRes(p: Player, res: ResKey, n: number) {
  p.res[res] += n;
  p.lastGain[res] = performance.now();
}

export function checkWin(p: Player) {
  if (p.vp >= 10 && !G.won) {
    G.won = true; G.running = false;
    bus.emit("win", p);
  }
}

// ── BUILD ──
export function doRoad(p: Player, eId: number, free = false): boolean {
  if (!canBuildRoad(G.map, p, eId)) return false;
  if (!free && !canAfford(p, COSTS.road.cost)) return false;
  if (!free) pay(p, COSTS.road.cost);
  G.map.edges[eId].owner = p.i;
  p.roads.push(eId);
  bus.emit("build", { p, kind: "road" });
  return true;
}

export function doSettlement(p: Player, vId: number, free = false): boolean {
  if (!canBuildSettlement(G.map, p, vId, G.setupPhase || free)) return false;
  if (!free && !canAfford(p, COSTS.settlement.cost)) return false;
  if (!free) pay(p, COSTS.settlement.cost);
  const v = G.map.verts[vId];
  v.building = "settlement"; v.owner = p.i;
  p.settlements.push(vId);
  p.vp += COSTS.settlement.vp;
  bus.emit("build", { p, kind: "settlement" });
  checkWin(p);
  return true;
}

export function doCity(p: Player, vId: number): boolean {
  if (!canBuildCity(G.map, p, vId)) return false;
  if (!canAfford(p, COSTS.city.cost)) return false;
  pay(p, COSTS.city.cost);
  const v = G.map.verts[vId];
  v.building = "city";
  p.settlements = p.settlements.filter((x) => x !== vId);
  p.cities.push(vId);
  p.vp += COSTS.city.vp;
  bus.emit("build", { p, kind: "city" });
  checkWin(p);
  return true;
}

// ── Capital (main city / network root) ──
export function doCapital(p: Player, vId: number): boolean {
  if (vId < 0 || !G.map.verts[vId]) return false;
  const v = G.map.verts[vId];
  if (v.building) return false;
  for (const n of vertNeighbors(G.map, vId)) if (G.map.verts[n].building) return false;
  v.building = "capital"; v.owner = p.i;
  p.capital = vId;
  bus.emit("build", { p, kind: "capital" });
  return true;
}

// grant a short free rail spur from the capital so a factory can be reached
export function grantStartRails(p: Player, hops = 2) {
  if (p.capital < 0 || !G.map.verts[p.capital]) return;
  let cur = p.capital;
  let prev = -1;
  for (let i = 0; i < hops; i++) {
    const v = G.map.verts[cur];
    const opts = v.edges.filter((e: number) => {
      const e2 = G.map.edges[e];
      if (e2.owner !== -1 || !e2.rail) return false;
      const other = e2.a === cur ? e2.b : e2.a;
      return other !== prev;
    });
    if (!opts.length) break;
    const edge = opts[randInt(opts.length)];
    doRoad(p, edge, true);
    const e2 = G.map.edges[edge];
    prev = cur;
    cur = e2.a === cur ? e2.b : e2.a;
  }
}

// give a player a free settlement + connecting road (used to bootstrap AI)
export function freeSettlement(p: Player, vId: number) {
  if (vId < 0 || !G.map.verts[vId]) return;
  doSettlement(p, vId, true);
  const v = G.map.verts[vId];
  const edge = v.edges.find((e: number) => G.map.edges[e].owner === -1);
  if (edge !== undefined) doRoad(p, edge, true);
}

// ── Toll: pay to USE a rival's existing rail network (passage rights) ──
export function doTollRoad(p: Player, eId: number): boolean {
  const owner = tollRoadOwner(G.map, p, eId);
  if (owner < 0) return false;
  const rival = G.players[owner] as Player;
  // pay half (rounded down) of each resource to the rail owner
  let paidAny = false;
  for (const k of Object.keys(p.res) as ResKey[]) {
    const half = Math.floor(p.res[k] / 2);
    if (half > 0) { p.res[k] -= half; rival.res[k] += half; paidAny = true; }
  }
  // gain passage through this rival's whole network — no new rail is built,
  // you're using theirs. Your reachability now flows through their rails so you
  // can extend and build factories on the far side.
  p.tollAccess.add(owner);
  bus.emit("toll", { payer: p, owner: rival, paidAny });
  bus.emit("build", { p, kind: "toll" });
  return true;
}

// ── SABOTAGE ──
export function placeBandit(attacker: Player, tileId: number): boolean {
  if (attacker.res.gold < SABOTAGE.bandit.gold) return false;
  attacker.res.gold -= SABOTAGE.bandit.gold;
  G.map.tiles[tileId].banditUntil = performance.now() + BANDIT_MS;
  bus.emit("sabotage", { attacker, key: "bandit", tile: tileId });
  return true;
}

export function isSecured(p: Player): boolean {
  return p.securedUntil > performance.now();
}

// buy security forces (protection against Blockade & Smog Cloud)
export function buySecurity(p: Player): boolean {
  if (p.res.gold < SECURITY.gold) return false;
  p.res.gold -= SECURITY.gold;
  p.securedUntil = performance.now() + SECURITY.ms;
  bus.emit("security", { p });
  return true;
}

export function applySabotage(attacker: Player, key: string, victim: Player): boolean {
  const s = SABOTAGE[key];
  if (attacker.res.gold < s.gold) return false;
  if (key === "fog" && isSecured(victim)) return false;  // security blocks smog
  attacker.res.gold -= s.gold;
  if (victim.human) {
    const now = performance.now();
    if (key === "harden") G.board.harden(7);
    else if (key === "block") G.board.dropBlocks(2, BLOCK_MS, now);
    else if (key === "fog") G.board.fog(FOG_MS, now);
  } else {
    // represent as slow
    victim.slowedUntil = performance.now() + (key === "fog" ? FOG_MS : BLOCK_MS);
  }
  bus.emit("sabotage", { attacker, key, victim });
  return true;
}

// helpers for AI targeting
export function findLegalSettlement(p: Player, setup: boolean): number {
  let best = -1, bestScore = -Infinity;
  G.map.verts.forEach((v: any) => {
    if (!canBuildSettlement(G.map, p, v.i, setup)) return;
    let score = randInt(80) / 100;
    const seen = new Set<ResKey>();
    for (const ti of v.tiles) {
      const tile = G.map.tiles[ti];
      const res = tile ? require0(tile) : null;
      if (!res) continue;
      const owned = p.settlements.concat(p.cities).some((vv: number) =>
        G.map.verts[vv].tiles.includes(ti));
      score += owned ? 1 : 0;
      if (!seen.has(res)) { score += 2.2; seen.add(res); }
      if (tile.type === "goldmine") score += 1.6;
    }
    if (score > bestScore) { bestScore = score; best = v.i; }
  });
  return best;
}
function require0(tile: any): ResKey | null {
  const map: Record<string, ResKey | null> = {
    forest: "wood", hills: "brick", pasture: "sheep", field: "wheat",
    mountain: "ore", goldmine: "gold", desert: null,
  };
  return map[tile.type];
}

export function findLegalRoad(p: Player): number {
  const legal: number[] = [];
  G.map.edges.forEach((e: any) => { if (canBuildRoad(G.map, p, e.i)) legal.push(e.i); });
  return legal.length ? choice(legal) : -1;
}

export function tileVictimHarvests(victim: Player, attacker: Player): number {
  const vTiles = new Set<number>();
  victim.settlements.concat(victim.cities).forEach((v: number) =>
    G.map.verts[v].tiles.forEach((t: number) => vTiles.add(t)));
  const aTiles = new Set<number>();
  attacker.settlements.concat(attacker.cities).forEach((v: number) =>
    G.map.verts[v].tiles.forEach((t: number) => aTiles.add(t)));
  const cand = [...vTiles].filter((t) => !aTiles.has(t) && G.map.tiles[t].banditUntil < performance.now());
  return cand.length ? choice(cand) : -1;
}

export { vertNeighbors };
