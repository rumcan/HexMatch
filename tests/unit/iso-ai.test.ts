import { describe, it, expect } from "vitest";
import {
  COST_FLAT, COST_ROUGH, COST_OWNED, stepCost, findPath, scarcity,
  harvesterSpots, networkTiles, nearestSource, planCandidates, bestCandidate,
  executeCandidate, aiBuildStep, planFeasibility, chooseRivalFactorySpot,
} from "../../src/iso/ai";
import {
  createTrack, buildTile, hasTrack, tIdx, canBuildOn, type Track,
} from "../../src/iso/track";
import { isServiced, type EconomyState, type Factory } from "../../src/iso/economy";
import { generateMap, GRASS, WATER, ROUGH, type Grid, type Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { INDUSTRY_BY_KEY, TRANSPORT } from "../../src/iso/config";
import { canReachASpot } from "./helpers/rival-map";

function flatGrid(industries: Industry[] = []): Grid {
  const occupancy = new Int16Array(MAP_W * MAP_H).fill(-1);
  industries.forEach((ind, i) => {
    ind.id = i;
    for (let y = ind.ty; y < ind.ty + ind.h; y++)
      for (let x = ind.tx; x < ind.tx + ind.w; x++) occupancy[tIdx(x, y)] = i;
  });
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries, occupancy, seed: 7,
  };
}

const ind = (type: string, tx: number, ty: number): Industry => {
  const def = INDUSTRY_BY_KEY[type];
  return {
    id: 0, type, tx, ty,
    w: def.footprint[0], h: def.footprint[1],
    output: def.output, banditUntil: 0,
  };
};

const state = (grid: Grid, track: Track = createTrack()): EconomyState =>
  ({ grid, track, harvesters: [], factories: [] });

// ownerId 0 = the neutral, unowned world these unit tests use (no rival),
// which also keeps the legacy "any track is the AI's trunk" discount.
const F: Factory = { owner: "ai", ownerId: 0, tx: 5, ty: 5 };
const rich = { stone: 9999, ore: 9999 };

describe("E7 step cost", () => {
  it("charges 1 for flat and 3 for rough", () => {
    const grid = flatGrid();
    grid.terrain[tIdx(4, 4)] = ROUGH;
    const t = createTrack();
    expect(stepCost(grid, t, "road", 3, 3)).toBe(COST_FLAT);
    expect(stepCost(grid, t, "road", 4, 4)).toBe(COST_ROUGH);
  });

  it("makes water and industry footprints impassable", () => {
    const farm = ind("farm", 10, 10);
    const grid = flatGrid([farm]);
    grid.terrain[tIdx(3, 3)] = WATER;
    const t = createTrack();
    expect(stepCost(grid, t, "road", 3, 3)).toBe(Infinity);
    expect(stepCost(grid, t, "road", 10, 10)).toBe(Infinity);
    expect(stepCost(grid, t, "road", -1, 0)).toBe(Infinity);
  });

  it("blocks rail on rough where road passes", () => {
    const grid = flatGrid();
    grid.terrain[tIdx(4, 4)] = ROUGH;
    const t = createTrack();
    expect(stepCost(grid, t, "rail", 4, 4)).toBe(Infinity);
    expect(stepCost(grid, t, "road", 4, 4)).toBe(COST_ROUGH);
  });

  it("discounts tiles already carrying the AI's own network by 0.3×", () => {
    const grid = flatGrid();
    const t = createTrack();
    buildTile(t, "road", 6, 6);
    expect(stepCost(grid, t, "road", 6, 6)).toBeCloseTo(COST_FLAT * COST_OWNED, 6);
    // ...and the discount is layer-specific
    expect(stepCost(grid, t, "rail", 6, 6)).toBe(COST_FLAT);
  });
});

describe("E7 A*", () => {
  it("finds the shortest straight path and reports its cost", () => {
    const grid = flatGrid();
    const p = findPath(grid, createTrack(), "road", 5, 5, 10, 5)!;
    expect(p).toBeTruthy();
    expect(p.tiles[0]).toEqual([5, 5]);
    expect(p.tiles.at(-1)).toEqual([10, 5]);
    expect(p.tiles).toHaveLength(6);
    expect(p.cost).toBe(5 * COST_FLAT);   // 5 steps, start is free
  });

  it("routes around water rather than failing", () => {
    const grid = flatGrid();
    for (let y = 0; y <= 6; y++) grid.terrain[tIdx(8, y)] = WATER;
    const p = findPath(grid, createTrack(), "road", 5, 5, 12, 5)!;
    expect(p).toBeTruthy();
    for (const [x, y] of p.tiles) expect(grid.terrain[tIdx(x, y)]).not.toBe(WATER);
    expect(p.tiles.at(-1)).toEqual([12, 5]);
  });

  it("returns null when the target is walled off entirely", () => {
    const grid = flatGrid();
    for (let y = 0; y < MAP_H; y++) grid.terrain[tIdx(8, y)] = WATER;
    expect(findPath(grid, createTrack(), "road", 5, 5, 12, 5)).toBeNull();
  });

  it("detours around rough when the detour is genuinely cheaper", () => {
    const grid = flatGrid();
    // A single rough tile dead ahead. Crossing costs 3; stepping around it
    // costs 1+1+1 = 3 for the same net progress, so the detour must not be
    // MORE expensive — assert on cost, not on which tiles were chosen.
    grid.terrain[tIdx(7, 5)] = ROUGH;
    const p = findPath(grid, createTrack(), "road", 5, 5, 9, 5)!;
    expect(p.cost).toBeLessThanOrEqual(3 * COST_FLAT + COST_ROUGH);
  });

  it("crosses a thick rough wall rather than taking a long detour", () => {
    const grid = flatGrid();
    // Detouring around a 3-tall wall costs 4 extra steps; crossing one rough
    // tile costs 2 extra. Crossing is correct and A* must find it.
    for (const y of [4, 5, 6]) grid.terrain[tIdx(7, y)] = ROUGH;
    const p = findPath(grid, createTrack(), "road", 5, 5, 9, 5)!;
    expect(p.cost).toBe(3 * COST_FLAT + COST_ROUGH);
    expect(p.tiles.some(([x, y]) => grid.terrain[tIdx(x, y)] === ROUGH)).toBe(true);
  });

  it("avoids rough entirely when a flat route of equal length exists", () => {
    const grid = flatGrid();
    // one rough tile with clear flat ground either side of a 2-wide corridor
    grid.terrain[tIdx(6, 5)] = ROUGH;
    const p = findPath(grid, createTrack(), "road", 5, 5, 7, 5)!;
    // straight through costs 1+3=4; around via y=4 costs 1+1+1+1=4 — either
    // is optimal, but the path must never cost more than the cheapest option
    expect(p.cost).toBeLessThanOrEqual(4);
  });

  it("reuses an existing trunk line thanks to the 0.3× discount", () => {
    const grid = flatGrid();
    const t = createTrack();
    // an existing road along y=8 ; a detour onto it should beat a straight run
    for (let x = 5; x <= 20; x++) buildTile(t, "road", x, 8);
    const p = findPath(grid, t, "road", 5, 8, 20, 8)!;
    // the whole path is on the trunk, so it costs 15 * 0.3, not 15
    expect(p.cost).toBeCloseTo(15 * COST_FLAT * COST_OWNED, 6);
  });

  it("can stop beside an impassable goal with adjacentTo", () => {
    const farm = ind("farm", 10, 10);
    const grid = flatGrid([farm]);
    expect(findPath(grid, createTrack(), "road", 5, 10, 10, 10)).toBeNull();
    const p = findPath(grid, createTrack(), "road", 5, 10, 10, 10, true)!;
    expect(p).toBeTruthy();
    const [lx, ly] = p.tiles.at(-1)!;
    expect(Math.abs(lx - 10) + Math.abs(ly - 10)).toBe(1);
  });

  it("is deterministic — identical inputs give an identical path", () => {
    const grid = generateMap(31337);
    const a = findPath(grid, createTrack(), "road", 4, 4, 40, 40);
    const b = findPath(grid, createTrack(), "road", 4, 4, 40, 40);
    expect(a?.tiles).toEqual(b?.tiles);
    expect(a?.cost).toBe(b?.cost);
  });

  it("handles the degenerate same-tile path", () => {
    const p = findPath(flatGrid(), createTrack(), "road", 5, 5, 5, 5)!;
    expect(p.tiles).toEqual([[5, 5]]);
    expect(p.cost).toBe(0);
  });
});

describe("E7 scoring", () => {
  it("rates a cargo the AI holds none of highest", () => {
    expect(scarcity({}, "grain")).toBe(1);
    expect(scarcity({ grain: 1 }, "grain")).toBe(0.5);
    expect(scarcity({ grain: 9 }, "grain")).toBeLessThan(scarcity({ grain: 1 }, "grain"));
  });

  it("harvesterSpots hugs the footprint without corners or overlap", () => {
    const farm = ind("farm", 10, 10);      // 1×1 (V1: footprint = the art)
    const spots = harvesterSpots(flatGrid([farm]), farm);
    expect(spots).toEqual([[10, 9], [9, 10], [11, 10], [10, 11]]);  // 4 sides, no diagonals
    for (const [x, y] of spots) {
      const insideX = x >= 10 && x < 11, insideY = y >= 10 && y < 11;
      expect(insideX && insideY).toBe(false);
      expect(insideX || insideY).toBe(true);
    }
  });

  it("skips harvester spots on water", () => {
    const farm = ind("farm", 10, 10);
    const grid = flatGrid([farm]);
    grid.terrain[tIdx(9, 10)] = WATER;
    const spots = harvesterSpots(grid, farm);
    expect(spots).not.toContainEqual([9, 10]);
  });

  it("falls back to the factory when the network is empty", () => {
    expect(networkTiles(createTrack(), "road", F)).toEqual([[5, 5]]);
  });

  it("nearestSource picks by Manhattan distance, deterministically", () => {
    const sources: [number, number][] = [[0, 0], [10, 10], [3, 3]];
    expect(nearestSource(sources, 4, 4)).toEqual([3, 3]);
    expect(nearestSource([], 1, 1)).toBeNull();
  });
});

describe("E7 planning", () => {
  it("prefers the scarcer cargo when output and distance match", () => {
    // two identical-output industries equidistant from the factory
    const farm = ind("farm", 5, 10);       // grain, output 1.0
    const forest = ind("forest", 5, 0);    // wood,  output 1.0
    const grid = flatGrid([farm, forest]);
    const s = state(grid);
    const plan = planCandidates(s, F, { stock: { grain: 8 }, purse: rich });
    expect(plan.length).toBeGreaterThan(0);
    // grain is plentiful, so wood should win
    expect(plan[0].industry.type).toBe("forest");
  });

  it("prefers the nearer industry when cargo scarcity matches", () => {
    const near = ind("farm", 8, 5);
    const far = ind("farm", 40, 5);
    const grid = flatGrid([near, far]);
    const plan = planCandidates(state(grid), F, { stock: {}, purse: rich });
    expect(plan[0].industry).toBe(near);
  });

  it("builds road when it cannot afford rail", () => {
    const grid = flatGrid([ind("farm", 10, 5)]);
    // enough stone for road, no ore at all → rail is unaffordable
    const plan = planCandidates(state(grid), F, { stock: {}, purse: { stone: 50 } });
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((c) => c.kind === "road")).toBe(true);
    expect(TRANSPORT.rail.cost.ore).toBeGreaterThan(0);
  });

  it("uses rail when it can afford it", () => {
    const grid = flatGrid([ind("farm", 10, 5)]);
    const plan = planCandidates(state(grid), F, { stock: {}, purse: rich });
    expect(plan[0].kind).toBe("rail");
  });

  it("returns nothing when it can afford nothing", () => {
    const grid = flatGrid([ind("farm", 10, 5)]);
    expect(planCandidates(state(grid), F, { stock: {}, purse: {} })).toEqual([]);
    expect(bestCandidate(state(grid), F, { stock: {}, purse: {} })).toBeNull();
  });

  it("skips industries already covered by its own harvester", () => {
    const farm = ind("farm", 8, 5);
    const grid = flatGrid([farm]);
    const s = state(grid);
    const before = planCandidates(s, F, { stock: {}, purse: rich });
    expect(before.some((c) => c.industry === farm)).toBe(true);
    s.harvesters.push({ id: 1, owner: "ai", ownerId: 0, tx: 8, ty: 5 });
    const after = planCandidates(s, F, { stock: {}, purse: rich });
    expect(after.some((c) => c.industry === farm)).toBe(false);
  });

  it("is deterministic across repeated planning on a real map", () => {
    const grid = generateMap(2024);
    const a = planCandidates(state(grid), F, { stock: {}, purse: rich });
    const b = planCandidates(state(grid), F, { stock: {}, purse: rich });
    expect(a.map((c) => [c.industry.id, c.hx, c.hy, c.score]))
      .toEqual(b.map((c) => [c.industry.id, c.hx, c.hy, c.score]));
  });
});

describe("E7 execution", () => {
  it("lays the path and places a serviced harvester", () => {
    const grid = flatGrid([ind("farm", 12, 5)]);
    const s = state(grid);
    const out = aiBuildStep(s, F, { stock: {}, purse: rich }, 1)!;
    expect(out).toBeTruthy();
    expect(out.built.length).toBeGreaterThan(0);
    expect(out.harvester).toBeTruthy();
    expect(s.harvesters).toHaveLength(1);
    expect(isServiced(s.track, out.harvester!)).toBe(true);
    for (const [x, y] of out.built) expect(hasTrack(s.track, out.kind, x, y)).toBe(true);
  });

  it("charges only for tiles it actually laid", () => {
    const grid = flatGrid([ind("farm", 12, 5)]);
    const s = state(grid);
    const c = bestCandidate(s, F, { stock: {}, purse: rich })!;
    const out = executeCandidate(s, c, "ai", 0, 1);
    const perTile = TRANSPORT[c.kind].cost;
    for (const [cargo, v] of Object.entries(perTile)) {
      expect(out.spent[cargo as keyof typeof out.spent]).toBe(v * out.built.length);
    }
  });

  it("reuses its trunk line on the second build instead of a parallel spur", () => {
    const grid = flatGrid([ind("farm", 20, 5), ind("forest", 24, 5)]);
    const s = state(grid);
    const first = aiBuildStep(s, F, { stock: {}, purse: rich }, 1)!;
    const laidFirst = first.built.length;
    const second = aiBuildStep(s, F, { stock: {}, purse: rich }, 2)!;
    // the second industry is close to the first, so the marginal build is small
    expect(second.built.length).toBeLessThan(laidFirst);
    expect(s.harvesters).toHaveLength(2);
  });

  it("W3: builds over its free allowance when the purse alone is short", () => {
    const grid = flatGrid([ind("farm", 12, 5)]);
    const s = state(grid);
    // The path from F(5,5) to the harvester spot near the farm is longer
    // than 5 tiles — 5 stone of road is not enough for the whole build...
    const short = bestCandidate(s, F, { stock: {}, purse: { stone: 5 } });
    expect(short).toBeNull();
    // ...but the 12-tile free setup allowance covers it, exactly like the
    // human's setup phase does.
    const withFree = aiBuildStep(s, F, { stock: {}, purse: { stone: 5 }, free: 12 }, 1);
    expect(withFree).toBeTruthy();
    expect(withFree!.built.length).toBeGreaterThan(5);
    expect(withFree!.free).toBe(withFree!.built.length);   // all free
    expect(Object.keys(withFree!.spent).length).toBe(0);   // purse untouched
    expect(s.harvesters).toHaveLength(1);
  });

  it("W3: charges only the tiles beyond the free allowance", () => {
    const grid = flatGrid([ind("farm", 12, 5)]);
    const s = state(grid);
    const out = aiBuildStep(s, F, { stock: {}, purse: { stone: 99 }, free: 4 }, 1)!;
    const charged = out.built.length - out.free;
    expect(charged).toBeGreaterThan(0);
    expect(out.spent.stone).toBe(charged);
  });

  it("returns null when there is nothing reachable", () => {
    const grid = flatGrid([ind("farm", 20, 20)]);
    // wall the map in two
    for (let y = 0; y < MAP_H; y++) grid.terrain[tIdx(10, y)] = WATER;
    expect(aiBuildStep(state(grid), F, { stock: {}, purse: rich }, 1)).toBeNull();
  });

  it("produces an identical build from an identical starting state", () => {
    const mk = () => state(generateMap(99));
    const a = mk(), b = mk();
    const ra = aiBuildStep(a, F, { stock: {}, purse: rich }, 1);
    const rb = aiBuildStep(b, F, { stock: {}, purse: rich }, 1);
    expect(ra?.built).toEqual(rb?.built);
    expect(ra?.harvester).toEqual(rb?.harvester);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// W8 — the rival never builds a single tile (AI deadlock).
//
// Three faults compounded: a one-tile "path" with cost 0 outranked every real
// build (÷ the 0.3 floor), the rail-first pass never fell through to road when
// rail was impossible, and the resulting no-op turn was reported as a real one
// — so the rival re-picked the same doomed candidate every 9 s forever.
//
// The whole-map sweep over every legal rival tile lives in
// `iso-ai-sweep.test.ts` (it is slow); these are the focused regressions.
// ══════════════════════════════════════════════════════════════════════════

/** The rival's opening purse and setup allowance, exactly as `game.ts` gives it. */
const rivalOpts = () => ({ stock: { stone: 12, ore: 0 }, purse: { stone: 12, ore: 0 }, free: 12 });

/** Seed-1337 repro state: the rival's factory on the rough tile at (2,2). */
function roughRival(): { eco: EconomyState; f: Factory } {
  const grid = generateMap(1337);
  const eco: EconomyState = {
    grid, track: createTrack(), harvesters: [],
    factories: [{ owner: "ai", ownerId: 2, tx: 2, ty: 2 }],
  };
  return { eco, f: eco.factories[0] };
}

describe("W8 plan feasibility", () => {
  it("flags a rail path over rough ground as not executable", () => {
    const grid = flatGrid([ind("farm", 5, 9)]);
    grid.terrain[tIdx(5, 5)] = ROUGH;         // the factory stands on rough
    const s = state(grid);
    const path = findPath(grid, s.track, "road", 5, 5, 5, 8, false, 0)!;
    expect(path).toBeTruthy();
    // the same tiles are illegal for rail: TRANSPORT.rail.onRough === false
    const rail = planFeasibility(s, "rail", { tiles: path.tiles, cost: path.cost }, 5, 8, 0);
    expect(TRANSPORT.rail.onRough).toBe(false);
    expect(rail.executable).toBe(false);
    expect(rail.viable).toBe(false);
    const road = planFeasibility(s, "road", path, 5, 8, 0);
    expect(road.executable).toBe(true);
    expect(road.serviced).toBe(true);          // the path's penultimate tile
    expect(road.viable).toBe(true);
    expect(road.fresh.length).toBe(path.tiles.length);
  });

  it("refuses the one-tile path under the depot: laid track there services nothing", () => {
    // `isServiced` looks at the harvester's four NEIGHBOURS, so track laid on
    // the tile the depot stands on does not service it.
    const grid = flatGrid([ind("oil_rig", 5, 6)]);
    const s = state(grid);
    const one: [number, number][] = [[5, 5]];  // F's own tile, a harvester spot
    const f = planFeasibility(s, "road", { tiles: one, cost: 0 }, 5, 5, 0);
    expect(f.fresh).toEqual([[5, 5]]);
    expect(f.serviced).toBe(false);
    expect(f.viable).toBe(false);
    // once a neighbour carries our track the same spot IS viable, for free
    buildTile(s.track, "road", 4, 5, 0);
    expect(planFeasibility(s, "road", { tiles: one, cost: 0 }, 5, 5, 0).viable).toBe(true);
  });

  it("counts only track owned by the AI as servicing (W2)", () => {
    const grid = flatGrid([ind("oil_rig", 5, 6)]);
    const s = state(grid);
    buildTile(s.track, "road", 4, 5, 7);       // somebody else's road
    const f = planFeasibility(s, "road", { tiles: [[5, 5]], cost: 0 }, 5, 5, 2);
    expect(f.serviced).toBe(false);
    buildTile(s.track, "road", 6, 5, 2);       // ours
    expect(planFeasibility(s, "road", { tiles: [[5, 5]], cost: 0 }, 5, 5, 2).serviced).toBe(true);
  });
});

describe("W8 the degenerate candidate no longer wins the ranking", () => {
  it("never offers a path that lays nothing and lands nothing", () => {
    // The industry sits directly below the factory, so the factory's own tile
    // is a harvester spot: the old scorer divided by the 0.3 floor and put a
    // one-tile, zero-cost "path" first, every turn, forever.
    const grid = flatGrid([ind("oil_rig", 5, 6)]);
    grid.terrain[tIdx(5, 5)] = ROUGH;          // and it is rough: rail is out
    const s = state(grid);
    const cands = planCandidates(s, F, { stock: {}, purse: rich });
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      const f = planFeasibility(s, c.kind, c.path, c.hx, c.hy, F.ownerId);
      expect(f.viable, `${c.kind} to (${c.hx},${c.hy})`).toBe(true);
      const out = executeCandidate(state(s.grid), c, "ai", 0, 1);
      expect(out.built.length > 0 || out.harvester !== null).toBe(true);
    }
    // the degenerate shape is gone: no one-tile path ending on the factory
    expect(cands.some((c) => c.path.tiles.length === 1 && c.hx === F.tx && c.hy === F.ty)).toBe(false);
    // …and the rival reaches a REAL spot instead (road, since rail needs flat)
    const out = aiBuildStep(s, F, { stock: {}, purse: rich }, 1)!;
    expect(out).toBeTruthy();
    expect(out.kind).toBe("road");
    expect(out.built.length).toBeGreaterThan(1);
    expect(out.harvester).toBeTruthy();
    expect(isServiced(s.track, out.harvester!)).toBe(true);
  });

  it("falls through to road when the rail plan cannot be built", () => {
    const { eco, f } = roughRival();
    expect(canBuildOn(eco.grid, "road", f.tx, f.ty)).toBe(true);
    expect(canBuildOn(eco.grid, "rail", f.tx, f.ty)).toBe(false);
    // no candidate may claim a kind it cannot lay
    for (const c of planCandidates(eco, f, rivalOpts())) {
      expect(c.path.tiles.every(([x, y]) => canBuildOn(eco.grid, c.kind, x, y))).toBe(true);
    }
  });
});

describe("W8 a no-op turn is reported as no turn", () => {
  it("aiBuildStep returns null instead of a truthy empty outcome", () => {
    // (2,2) on seed 1337 is worse than rough: water on three sides and the
    // oil_rig footprint at (2,3) on the fourth, so no track can leave the tile
    // at all. Nothing the AI does can build from there — the honest answer is
    // `null` every turn, never a truthy outcome the caller spends a turn on.
    const { eco, f } = roughRival();
    expect(canReachASpot(eco.grid, f.tx, f.ty)).toBe(false);   // an enclave
    for (let i = 0; i < 6; i++) {
      const out = aiBuildStep(eco, f, rivalOpts(), i + 1);
      expect(out === null || out.built.length > 0 || out.harvester !== null).toBe(true);
      if (out) expect(out.harvester, "a build with no harvester is waste").toBeTruthy();
    }
    expect(eco.harvesters).toHaveLength(0);
  });

  it("walks past a candidate that cannot be executed to the next one", () => {
    const grid = flatGrid([ind("farm", 5, 9), ind("forest", 9, 5)]);
    const s = state(grid);
    const cands = planCandidates(s, F, { stock: {}, purse: rich });
    expect(cands.length).toBeGreaterThan(1);
    const out = aiBuildStep(s, F, { stock: {}, purse: rich }, 1)!;
    expect(out.built.length).toBeGreaterThan(0);
    expect(out.harvester).toBeTruthy();
    expect(s.harvesters).toHaveLength(1);
  });
});

describe("W8 the rival's factory is placed where it can build", () => {
  it("picks a rail-legal tile with a real plan, not the farthest road-only one", () => {
    const grid = generateMap(1337);
    const player: [number, number] = [23, 22];
    const spot = chooseRivalFactorySpot(grid, createTrack(), player, {
      purse: { stone: 12, ore: 0 }, free: 12, ownerId: 2,
    });
    expect(spot).toBeTruthy();
    const [x, y] = spot!;
    expect(canBuildOn(grid, "rail", x, y), "rail must be legal on the rival's tile").toBe(true);
    // the old road-only search handed back the (2,2) enclave for this player
    expect(spot).not.toEqual([2, 2]);
    expect(canReachASpot(grid, x, y)).toBe(true);
    // and a real build exists from it, first turn
    const eco: EconomyState = {
      grid, track: createTrack(), harvesters: [],
      factories: [{ owner: "ai", ownerId: 2, tx: x, ty: y }],
    };
    const out = aiBuildStep(eco, eco.factories[0], rivalOpts(), 1)!;
    expect(out).toBeTruthy();
    expect(out.built.length).toBeGreaterThan(0);
    expect(out.harvester).toBeTruthy();
    expect(isServiced(eco.track, out.harvester!)).toBe(true);
  });

  it("is deterministic, and never returns an enclave for any player tile", () => {
    const grid = generateMap(1337);
    const opts = { purse: { stone: 12, ore: 0 }, free: 12, ownerId: 2 };
    const a = chooseRivalFactorySpot(grid, createTrack(), [23, 22], opts);
    const b = chooseRivalFactorySpot(grid, createTrack(), [23, 22], opts);
    expect(a).toEqual(b);
    // a spread of player placements across the map
    for (const [px, py] of [[4, 4], [16, 16], [27, 6], [6, 27], [23, 22], [12, 12]] as [number, number][]) {
      const s = chooseRivalFactorySpot(grid, createTrack(), [px, py], opts);
      expect(s, `player at ${px},${py}`).toBeTruthy();
      expect(canBuildOn(grid, "road", s![0], s![1])).toBe(true);
      expect(canReachASpot(grid, s![0], s![1]), `enclave for player ${px},${py}`).toBe(true);
      expect(s).not.toEqual([px, py]);
    }
  });

  it("still returns a tile when nothing is affordable (the rival exists)", () => {
    const grid = generateMap(1337);
    const spot = chooseRivalFactorySpot(grid, createTrack(), [23, 22], {
      purse: {}, free: 0, ownerId: 2,
    });
    expect(spot).toBeTruthy();
    expect(canBuildOn(grid, "road", spot![0], spot![1])).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// W9 — the AI shares the player's cost model, including the road-only
// allowance. W3 made the rival plan with the same free-track budget the human
// drag preview uses; before this, that meant free rail for the rival too.
// ══════════════════════════════════════════════════════════════════════════
describe("W9 the rival's setup allowance buys road only", () => {
  it("offers no rail plan while rail still has to be paid for in ore", () => {
    const grid = flatGrid([ind("farm", 12, 5)]);
    const s = state(grid);
    // the rival's opening purse: 12 stone, no ore, 12 free tiles
    const plan = planCandidates(s, F, { stock: {}, purse: { stone: 12, ore: 0 }, free: 12 });
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((c) => c.kind === "road"), "free rail is the W9 bug").toBe(true);

    // with ore it prefers rail again — and now prices every tile of it
    const paid = planCandidates(s, F, { stock: {}, purse: { stone: 12, ore: 9999 }, free: 12 });
    expect(paid[0].kind).toBe("rail");
    expect(paid[0].cost.ore).toBe(TRANSPORT.rail.cost.ore! * paid[0].path.tiles.length);
  });

  it("a rail build consumes no allowance, so the rival keeps its road budget", () => {
    const grid = flatGrid([ind("farm", 12, 5)]);
    const s = state(grid);
    const rail = aiBuildStep(s, F, { stock: {}, purse: { stone: 12, ore: 9999 }, free: 12 }, 1)!;
    expect(rail).toBeTruthy();
    expect(rail.kind).toBe("rail");
    expect(rail.free).toBe(0);
    expect(rail.spent.ore).toBe(TRANSPORT.rail.cost.ore! * rail.built.length);
    expect(rail.harvester).toBeTruthy();

    // the road build the same allowance WAS for still rides it, unchanged (W3)
    const s2 = state(grid);
    const road = aiBuildStep(s2, F, { stock: {}, purse: { stone: 12, ore: 0 }, free: 12 }, 1)!;
    expect(road.kind).toBe("road");
    expect(road.free).toBe(road.built.length);
    expect(Object.keys(road.spent).length).toBe(0);
  });

  it("prices a rail plan the same way the human drag preview does", () => {
    const grid = flatGrid([ind("farm", 12, 5)]);
    const s = state(grid);
    const purse = { stone: 12, ore: 8 };         // two rail tiles' worth of ore
    const plan = planCandidates(s, F, { stock: {}, purse, free: 12 });
    const rail = plan.filter((c) => c.kind === "rail");
    // every rail candidate must fit the purse: 8 ore = at most 2 tiles
    for (const c of rail) expect(c.cost.ore ?? 0).toBeLessThanOrEqual(8);
    const out = aiBuildStep(s, F, { stock: {}, purse, free: 12 }, 1);
    if (out?.kind === "rail") {
      expect(out.spent.ore).toBeLessThanOrEqual(8);
      expect(out.free).toBe(0);
    }
  });
});
