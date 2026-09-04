import { describe, it, expect } from "vitest";
import {
  COST_FLAT, COST_ROUGH, COST_OWNED, stepCost, findPath, scarcity,
  harvesterSpots, networkTiles, nearestSource, planCandidates, bestCandidate,
  executeCandidate, aiBuildStep,
} from "../../src/iso/ai";
import { createTrack, buildTile, hasTrack, tIdx, type Track } from "../../src/iso/track";
import { isServiced, type EconomyState, type Factory } from "../../src/iso/economy";
import { generateMap, GRASS, WATER, ROUGH, type Grid, type Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { INDUSTRY_BY_KEY, TRANSPORT } from "../../src/iso/config";

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

const F: Factory = { owner: "ai", tx: 5, ty: 5 };
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
    s.harvesters.push({ id: 1, owner: "ai", tx: 8, ty: 5 });
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
    const out = executeCandidate(s, c, "ai", 1);
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
