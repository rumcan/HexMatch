import { describe, it, expect, beforeEach } from "vitest";
import { generateMap } from "../../src/game/hexmap";
import { setRng, mulberry32, COSTS, SABOTAGE } from "../../src/game/config";
import { G, makePlayer, Player } from "../../src/game/state";
import {
  doRoad, doSettlement, doCity, doCapital, canAfford, gainRes, doTollRoad,
  placeBandit, buySecurity, applySabotage, findLegalSettlement,
} from "../../src/game/actions";

function setup(seed = 42) {
  setRng(mulberry32(seed ^ 0x5eed5));
  G.map = generateMap(seed);
  G.players = [
    makePlayer(0, "You", true, "#fff"),
    makePlayer(1, "Rival", false, "#f00"),
  ];
  G.won = false;
  return G.players as Player[];
}

beforeEach(() => setup());

describe("canAfford / gainRes", () => {
  it("checks every resource in a cost", () => {
    const p = G.players[0];
    expect(canAfford(p, COSTS.settlement.cost)).toBe(false);
    for (const k of Object.keys(COSTS.settlement.cost)) gainRes(p, k as any, 5);
    expect(canAfford(p, COSTS.settlement.cost)).toBe(true);
  });
});

describe("doCapital", () => {
  it("places the capital and marks the vertex", () => {
    const p = G.players[0];
    const v = G.map.verts.find((x: any) => x.buildable)!;
    expect(doCapital(p, v.i)).toBe(true);
    expect(p.capital).toBe(v.i);
    expect(G.map.verts[v.i].building).toBe("capital");
    expect(doCapital(p, v.i)).toBe(false); // already built
  });

  it("rejects a vertex next to an existing building", () => {
    const p = G.players[0];
    const v = G.map.verts.find((x: any) => x.buildable)!;
    doCapital(p, v.i);
    const neighbour = G.map.verts[v.i].edges
      .map((eid: number) => { const e = G.map.edges[eid]; return e.a === v.i ? e.b : e.a; })
      .find((id: number) => G.map.verts[id].buildable);
    if (neighbour !== undefined) expect(doCapital(p, neighbour)).toBe(false);
  });
});

describe("doRoad", () => {
  it("free setup road costs nothing; paid road deducts resources", () => {
    const p = G.players[0];
    const v = findLegalSettlement(p, true);
    doCapital(p, v);
    // first free road
    const edge = G.map.verts[v].edges
      .map((eid: number) => G.map.edges[eid])
      .find((e: any) => e.rail && e.owner === -1)!;
    expect(doRoad(p, edge.i, true)).toBe(true);
    expect(p.res.wood).toBe(0);
    expect(G.map.edges[edge.i].owner).toBe(0);
    expect(p.roads).toContain(edge.i);
    // can't rebuild the same edge even for free
    expect(doRoad(p, edge.i, true)).toBe(false);
    // paid road needs resources
    for (const k of Object.keys(COSTS.road.cost)) gainRes(p, k as any, 5);
    const next = G.map.edges.find((e: any) => e.owner === -1 && e.rail &&
      (G.map.verts[e.a].building === "capital" || G.map.verts[e.b].building === "capital" ||
       p.roads.some((r: number) => { const r2 = G.map.edges[r]; return r2.a === e.a || r2.a === e.b || r2.b === e.a || r2.b === e.b; })));
    if (next) {
      const woodBefore = p.res.wood;
      expect(doRoad(p, next.i)).toBe(true);
      expect(p.res.wood).toBe(woodBefore - COSTS.road.cost.wood!);
    }
  });

  it("refuses a paid road without resources", () => {
    const p = G.players[0];
    const v = findLegalSettlement(p, true);
    doCapital(p, v);
    const edge = G.map.verts[v].edges
      .map((eid: number) => G.map.edges[eid])
      .find((e: any) => e.rail && e.owner === -1)!;
    expect(doRoad(p, edge.i, false)).toBe(false);
  });
});

describe("doSettlement / doCity", () => {
  it("building a settlement awards VP and a city upgrades it", () => {
    const p = G.players[0];
    const v = findLegalSettlement(p, true);
    doCapital(p, v);
    // a free settlement (setup-style) at a reachable junction
    const site = findLegalSettlement(p, true);
    if (site >= 0) {
      expect(doSettlement(p, site, true)).toBe(true);
      expect(p.settlements).toContain(site);
      expect(p.vp).toBe(COSTS.settlement.vp);
      // upgrade to city: needs wheat+ore
      expect(doCity(p, site)).toBe(false);
      p.res.wheat = 5; p.res.ore = 5;
      expect(doCity(p, site)).toBe(true);
      expect(p.cities).toContain(site);
      expect(p.settlements).not.toContain(site);
      expect(p.vp).toBe(COSTS.settlement.vp + COSTS.city.vp);
    }
  });
});

describe("doTollRoad", () => {
  it("pays half of each resource and grants passage", () => {
    const [p, rival] = G.players as Player[];
    const v = findLegalSettlement(p, true);
    doCapital(p, v);
    const edge = G.map.verts[v].edges
      .map((eid: number) => G.map.edges[eid])
      .find((e: any) => e.rail)!;
    edge.owner = rival.i;
    gainRes(p, "wood", 4); gainRes(p, "ore", 3);
    const woodBefore = p.res.wood;
    expect(doTollRoad(p, edge.i)).toBe(true);
    expect(p.tollAccess.has(rival.i)).toBe(true);
    expect(p.res.wood).toBe(Math.floor(woodBefore / 2));
    expect(rival.res.wood).toBe(woodBefore - p.res.wood);
  });
});

describe("sabotage / security", () => {
  it("placeBandit deducts gold and sets the tile timer", () => {
    const p = G.players[0];
    p.res.gold = SABOTAGE.bandit.gold;
    expect(placeBandit(p, 0)).toBe(true);
    expect(p.res.gold).toBe(0);
    expect(G.map.tiles[0].banditUntil).toBeGreaterThan(0);
    expect(placeBandit(p, 0)).toBe(false);
  });

  it("buySecurity flips the secured flag", () => {
    const p = G.players[0];
    expect(buySecurity(p)).toBe(false);
    p.res.gold = 10;
    expect(buySecurity(p)).toBe(true);
    expect(p.securedUntil).toBeGreaterThan(0);
  });

  it("smog is blocked by security", () => {
    const rival = G.players[1] as Player;
    G.board = { harden: () => {}, dropBlocks: () => {}, fog: () => {} };
    rival.res.gold = 20;
    rival.securedUntil = performance.now() + 99999;
    expect(applySabotage(rival, "fog", rival)).toBe(false);
  });
});
