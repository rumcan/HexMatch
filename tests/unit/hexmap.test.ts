import { describe, it, expect } from "vitest";
import {
  generateMap, vertNeighbors, reachable, canBuildSettlement, canBuildRoad,
  canBuildCity, tollRoadOwner, playerResources,
} from "../../src/game/hexmap";
import { setRng, mulberry32 } from "../../src/game/config";
import { makePlayer } from "../../src/game/state";
import { G } from "../../src/game/state";

function freshGame(seed = 42) {
  setRng(mulberry32(seed ^ 0x5eed5));
  G.map = generateMap(seed);
  G.players = [makePlayer(0, "You", true, "#fff")];
  return G.map;
}

describe("generateMap determinism", () => {
  it("produces byte-identical geometry for the same seed", () => {
    const a = generateMap(12345);
    const b = generateMap(12345);
    expect(a.tiles.length).toBe(b.tiles.length);
    expect(a.verts.length).toBe(b.verts.length);
    expect(a.edges.length).toBe(b.edges.length);
    expect(a.tiles.map((t) => t.type).join(",")).toBe(b.tiles.map((t) => t.type).join(","));
    expect(JSON.stringify(a.verts.map((v) => [v.x, v.y]))).toBe(
      JSON.stringify(b.verts.map((v) => [v.x, v.y])));
    expect(a.bounds).toEqual(b.bounds);
  });

  it("(usually) differs for different seeds", () => {
    const a = generateMap(1);
    const b = generateMap(2);
    const sameTiles = a.tiles.map((t) => t.type).join(",") === b.tiles.map((t) => t.type).join(",");
    expect(sameTiles).toBe(false);
  });

  it("flags interior edges as rails and junctions as buildable", () => {
    const m = generateMap(777);
    for (const e of m.edges) expect(e.rail).toBe(e.tiles.length === 2);
    for (const v of m.verts) {
      if (v.buildable) expect(v.tiles.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("guarantees at least one of every resource type and a goldmine", () => {
    const m = generateMap(99);
    const types = new Set(m.tiles.map((t) => t.type));
    for (const t of ["forest", "hills", "pasture", "field", "mountain", "goldmine"]) {
      expect(types.has(t as any)).toBe(true);
    }
  });
});

describe("adjacency / reachability", () => {
  it("vertNeighbors returns symmetric neighbors", () => {
    const m = generateMap(5);
    for (const v of m.verts.slice(0, 20)) {
      for (const n of vertNeighbors(m, v.i)) {
        expect(vertNeighbors(m, n)).toContain(v.i);
      }
    }
  });

  it("reachable only contains the capital before any rails are built", () => {
    const m = freshGame();
    const p = G.players[0];
    // find any buildable vert for the capital
    const cap = m.verts.find((v) => v.buildable)!;
    p.capital = cap.i;
    const R = reachable(m, p);
    expect(R.has(cap.i)).toBe(true);
    expect(R.size).toBe(1);
  });

  it("roads extend the reachable network", () => {
    const m = freshGame();
    const p = G.players[0];
    const cap = m.verts.find((v) => v.buildable)!;
    p.capital = cap.i;
    m.verts[cap.i].building = "capital";
    m.verts[cap.i].owner = 0;
    // build along a rail edge from the capital
    const edge = m.verts[cap.i].edges.map((id) => m.edges[id]).find((e) => e.rail)!;
    edge.owner = 0;
    p.roads.push(edge.i);
    const other = edge.a === cap.i ? edge.b : edge.a;
    expect(reachable(m, p).has(other)).toBe(true);
  });
});

describe("build rules", () => {
  it("canBuildSettlement requires a buildable junction during setup", () => {
    const m = freshGame();
    const p = G.players[0];
    const good = m.verts.find((v) => v.buildable)!;
    const bad = m.verts.find((v) => !v.buildable)!;
    expect(canBuildSettlement(m, p, good.i, true)).toBe(true);
    expect(canBuildSettlement(m, p, bad.i, true)).toBe(false);
  });

  it("canBuildSettlement rejects vertices adjacent to an existing building", () => {
    const m = freshGame();
    const p = G.players[0];
    const good = m.verts.find((v) => v.buildable)!;
    m.verts[good.i].building = "capital";
    m.verts[good.i].owner = 0;
    const neighbor = vertNeighbors(m, good.i)
      .map((id) => m.verts[id])
      .find((v) => v.buildable);
    if (neighbor) expect(canBuildSettlement(m, p, neighbor.i, true)).toBe(false);
  });

  it("canBuildRoad requires an unowned interior edge touching the network", () => {
    const m = freshGame();
    const p = G.players[0];
    expect(canBuildRoad(m, p, 0)).toBe(false); // no capital yet
    const cap = m.verts.find((v) => v.buildable)!;
    p.capital = cap.i;
    m.verts[cap.i].building = "capital";
    m.verts[cap.i].owner = 0;
    const legal = m.edges.find((e) => canBuildRoad(m, p, e.i));
    expect(legal).toBeDefined();
    expect(legal!.rail).toBe(true);
    expect(legal!.owner).toBe(-1);
  });

  it("canBuildCity only upgrades own settlements", () => {
    const m = freshGame();
    const p = G.players[0];
    const v = m.verts.find((x) => x.buildable)!;
    expect(canBuildCity(m, p, v.i)).toBe(false);
    v.building = "settlement"; v.owner = 0; p.settlements.push(v.i);
    expect(canBuildCity(m, p, v.i)).toBe(true);
    v.owner = 1;
    expect(canBuildCity(m, p, v.i)).toBe(false);
  });

  it("tollRoadOwner identifies rival rails touching the network", () => {
    const m = freshGame();
    const p = G.players[0];
    const cap = m.verts.find((v) => v.buildable)!;
    p.capital = cap.i;
    m.verts[cap.i].building = "capital";
    m.verts[cap.i].owner = 0;
    // rival owns an interior edge adjacent to the capital
    const edge = m.verts[cap.i].edges.map((id) => m.edges[id]).find((e) => e.rail)!;
    edge.owner = 1;
    expect(tollRoadOwner(m, p, edge.i)).toBe(1);
    // once toll access is granted, it is no longer offered
    p.tollAccess.add(1);
    expect(tollRoadOwner(m, p, edge.i)).toBe(-1);
  });

  it("playerResources harvests tiles around buildings and respects blockades", () => {
    const m = freshGame();
    const p = G.players[0];
    const cap = m.verts.find((v) => v.buildable && v.tiles.some((t) => m.tiles[t].type === "forest"))!;
    p.capital = cap.i;
    const now = 1000;
    const res = playerResources(m, p, now);
    expect(res.wood).toBe(1);
    // blockade every harvested tile → nothing
    for (const ti of m.verts[cap.i].tiles) m.tiles[ti].banditUntil = now + 99999;
    const res2 = playerResources(m, p, now);
    expect(Object.keys(res2).length).toBe(0);
  });
});
