// ─────────────────────────────────────────────────────────────────────────
// E7 — isometric AI. Scores candidate industries by (cargo scarcity × output
// ÷ path cost), A*-routes from the nearest owned network tile, builds road if
// it can't afford rail, and places a harvester. Deterministic under the seeded
// RNG (T1) — it uses config.choice/randInt only.
// ─────────────────────────────────────────────────────────────────────────

import { Cargo, INDUSTRIES, TRANSPORT, tileIndex, inBounds, TERRAIN, randInt } from "./config";
import { IsoWorld } from "./world";
import { Industry } from "./grid";
import { Transport } from "./config";

export interface AStarNode { x: number; y: number; cost: number; }

function isPassable(world: IsoWorld, kind: Transport, x: number, y: number): boolean {
  return tileCost(world, kind, x, y) !== Infinity;
}

// Tile traversal cost for the AI's network (E7): 1 flat, 3 rough, water and
// industry footprints impassable, and 0.3× for tiles already carrying the
// AI's own network so it reuses trunk lines.
export function tileCost(world: IsoWorld, kind: Transport, x: number, y: number): number {
  if (!inBounds(x, y)) return Infinity;
  const t = world.map.terrain[tileIndex(x, y)];
  if (t === TERRAIN.WATER) return Infinity;
  if (kind === "rail" && t === TERRAIN.ROUGH) return Infinity;
  if (world.map.occup[tileIndex(x, y)] !== -1) return Infinity; // industry footprint
  if (world.net.has(kind, x, y)) return 0.3;
  return t === TERRAIN.ROUGH ? 3 : 1;
}

/** A* over the tile grid with 4-way movement. Returns the path or null. */
export function aStar(world: IsoWorld, kind: Transport,
  starts: { x: number; y: number }[], goal: { x: number; y: number }):
  { x: number; y: number }[] | null {
  const key = (x: number, y: number) => y * world.map.w + x;
  const open = new Map<number, { x: number; y: number; f: number; g: number }>();
  const came = new Map<number, number>();
  const gScore = new Map<number, number>();
  const h = (x: number, y: number) => Math.abs(x - goal.x) + Math.abs(y - goal.y);

  for (const s of starts) {
    const k = key(s.x, s.y);
    gScore.set(k, 0);
    open.set(k, { x: s.x, y: s.y, f: h(s.x, s.y), g: 0 });
  }

  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  let guard = 0;
  while (open.size && guard++ < 20000) {
    // pop lowest f
    let cur: { x: number; y: number; f: number; g: number } | null = null;
    let curKey = -1;
    for (const [k, n] of open) if (!cur || n.f < cur.f) { cur = n; curKey = k; }
    if (!cur) break;
    open.delete(curKey);
    if (cur.x === goal.x && cur.y === goal.y) {
      // reconstruct
      const path = [{ x: goal.x, y: goal.y }];
      let k = curKey;
      while (came.has(k)) {
        const pk = came.get(k)!;
        path.push({ x: pk % world.map.w, y: Math.floor(pk / world.map.w) });
        k = pk;
      }
      path.reverse();
      return path;
    }
    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      const step = tileCost(world, kind, nx, ny);
      if (step === Infinity) continue;
      const nk = key(nx, ny);
      const ng = cur.g + step;
      if (ng < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, ng);
        came.set(nk, curKey);
        open.set(nk, { x: nx, y: ny, f: ng + h(nx, ny), g: ng });
      }
    }
  }
  return null;
}

/** Tiles currently carrying the AI's network (used as A* start seeds). */
function networkTiles(world: IsoWorld, player: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const f = world.factories.get(player);
  if (f) {
    // seed from factory's neighbours plus any existing network
    out.push({ x: f.tx, y: f.ty });
  }
  for (const hv of world.harvesters) out.push({ x: hv.tx, y: hv.ty });
  return out;
}

/**
 * One AI build decision. Returns true if it expanded.
 * Scoring: cargo the AI lacks scores high; cheap short paths and high output
 * win. Builds rail when the ore/stone budget allows, else road.
 */
export function aiBuild(world: IsoWorld, player: number, cargo: Record<Cargo, number>): boolean {
  const industries = world.map.industries
    .filter((ind) => ind.banditUntil < performance.now());

  // scarcity: how little of each cargo we hold (0..1+), normalised
  const scarcity = (c: Cargo) => 1 / (1 + (cargo[c] ?? 0));

  type Cand = { ind: Industry; score: number; spot: { x: number; y: number } };
  const cands: Cand[] = [];
  for (const ind of industries) {
    const cargoType = INDUSTRIES[ind.type].cargo;
    // a harvester tile adjacent to the footprint on free land
    const spot = harvesterSpot(world, ind);
    if (!spot) continue;
    // rough path-cost estimate (Manhattan, terrain-blind) for scoring; A* refines
    const starts = networkTiles(world, player);
    if (!starts.length) continue;
    const approx = starts.reduce((m, s) =>
      Math.min(m, Math.abs(s.x - spot.x) + Math.abs(s.y - spot.y)), Infinity);
    const score = (scarcity(cargoType) * ind.output * 10) / (1 + approx * 0.1);
    cands.push({ ind, score, spot });
  }
  if (!cands.length) return false;
  cands.sort((a, b) => b.score - a.score);

  for (const c of cands) {
    const canRail = (cargo.ore ?? 0) >= 2 && (cargo.stone ?? 0) >= 1;
    const kind: Transport = canRail ? "rail" : "road";
    const starts = networkTiles(world, player);
    // route from a tile adjacent to the factory/network to a tile NEXT TO the
    // harvester spot (which must stay clear for the harvester itself).
    const seeds = expandSeeds(world, starts, kind);
    const goalNeighbours = [[0, -1], [1, 0], [0, 1], [-1, 0]]
      .map(([dx, dy]) => ({ x: c.spot.x + dx, y: c.spot.y + dy }))
      .filter((p) => inBounds(p.x, p.y) && isPassable(world, kind, p.x, p.y));
    let path: { x: number; y: number }[] | null = null;
    for (const g of goalNeighbours) {
      path = aStar(world, kind, seeds, g);
      if (path) break;
    }
    if (!path) continue;
    const charged = world.net.commitDrag(kind, path);
    if (charged.length) {
      // deduct cost from the AI's cargo ledger
      const cost = TRANSPORT[kind].cost;
      for (const [res, n] of Object.entries(cost) as [Cargo, number][]) {
        cargo[res] = Math.max(0, (cargo[res] ?? 0) - n * charged.length);
      }
      const hv = world.placeHarvester(player, c.spot.x, c.spot.y);
      if (hv) { world.checkConnections(); return true; }
    }
  }
  return false;
}

function expandSeeds(world: IsoWorld, starts: { x: number; y: number }[], kind: Transport) {
  // A* may start from the factory tile itself (not a road); expand to adjacent
  // buildable tiles and any existing network tiles.
  const out: { x: number; y: number }[] = [];
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (const s of starts) {
    if (world.net.has(kind, s.x, s.y)) out.push(s);
    for (const [dx, dy] of DIRS) {
      const nx = s.x + dx, ny = s.y + dy;
      if (inBounds(nx, ny)) out.push({ x: nx, y: ny });
    }
  }
  return out;
}

function harvesterSpot(world: IsoWorld, ind: Industry): { x: number; y: number } | null {
  // ring around the footprint, preferring a grass tile with catchment overlap
  for (let y = ind.ty - 1; y <= ind.ty + ind.h; y++) {
    for (let x = ind.tx - 1; x <= ind.tx + ind.w; x++) {
      if (!inBounds(x, y)) continue;
      if (world.map.occup[tileIndex(x, y)] !== -1) continue;
      if (world.net.has("road", x, y) || world.net.has("rail", x, y)) continue;
      if (world.catchmentIndustries(x, y).length) return { x, y };
    }
  }
  return null;
}

// deterministic AI pacing scaffolding (E7 reuses nextBuild-style timers)
export function aiTick(world: IsoWorld, player: number, cargo: Record<Cargo, number>, dt: number,
  timers: { nextBuild: number }) {
  timers.nextBuild -= dt;
  if (timers.nextBuild <= 0) {
    aiBuild(world, player, cargo);
    timers.nextBuild = 9000 + randInt(7000);
  }
}
