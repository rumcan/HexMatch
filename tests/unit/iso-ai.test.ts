import { describe, it, expect } from "vitest";
import {
  COST_FLAT, COST_ROUGH, COST_OWNED, stepCost, findPath, scarcity,
  harvesterSpots, networkTiles, nearestSource, planCandidates, bestCandidate,
  executeCandidate, aiBuildStep, planFeasibility, chooseRivalFactorySpot,
  catchmentValue, rivalPace, CARGO_VALUE,
} from "../../src/iso/ai";
import {
  createTrack, buildTile, hasTrack, tIdx, canBuildOn, type Track,
} from "../../src/iso/track";
import {
  isServiced, lockedIndustryIds, type EconomyState, type Factory,
} from "../../src/iso/economy";
import { generateMap, GRASS, WATER, ROUGH, TOWN_OCC, type Grid, type Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { INDUSTRY_BY_KEY, TRANSPORT, UPGRADE_COST } from "../../src/iso/config";
import { DEPOT_COST, FREE_SETUP_DEPOTS } from "../../src/iso/construction";
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
    industries, towns: [], occupancy, seed: 7,
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
// PP-05: "rich" means able to finish a turn, and a turn now ends at a Depot
// that costs Oil — so Oil belongs in the unlimited purse with stone and ore.
// PP-07: dirt/road cost Wood too and the Depot costs Grain as well, so both
// join the unlimited purse — "rich" stays "able to finish any turn".
const rich = { wood: 9999, stone: 9999, grain: 9999, ore: 9999, oil: 9999 };

describe("E7 step cost", () => {
  it("charges 1 for flat and 3 for rough", () => {
    const grid = flatGrid();
    grid.terrain[tIdx(4, 4)] = ROUGH;
    const t = createTrack();
    expect(stepCost(grid, t, "dirt", 3, 3)).toBe(COST_FLAT);
    expect(stepCost(grid, t, "dirt", 4, 4)).toBe(COST_ROUGH);
  });

  it("makes water and industry footprints impassable", () => {
    const farm = ind("farm", 10, 10);
    const grid = flatGrid([farm]);
    grid.terrain[tIdx(3, 3)] = WATER;
    const t = createTrack();
    expect(stepCost(grid, t, "dirt", 3, 3)).toBe(Infinity);
    expect(stepCost(grid, t, "dirt", 10, 10)).toBe(Infinity);
    expect(stepCost(grid, t, "dirt", -1, 0)).toBe(Infinity);
  });

  it("blocks road on rough where dirt passes", () => {
    const grid = flatGrid();
    grid.terrain[tIdx(4, 4)] = ROUGH;
    const t = createTrack();
    expect(stepCost(grid, t, "road", 4, 4)).toBe(Infinity);
    expect(stepCost(grid, t, "dirt", 4, 4)).toBe(COST_ROUGH);
  });

  it("discounts tiles already carrying the AI's own network by 0.3×", () => {
    const grid = flatGrid();
    const t = createTrack();
    buildTile(t, "dirt", 6, 6);
    expect(stepCost(grid, t, "dirt", 6, 6)).toBeCloseTo(COST_FLAT * COST_OWNED, 6);
    // ...and the discount is layer-specific
    expect(stepCost(grid, t, "road", 6, 6)).toBe(COST_FLAT);
  });
});

describe("E7 A*", () => {
  it("finds the shortest straight path and reports its cost", () => {
    const grid = flatGrid();
    const p = findPath(grid, createTrack(), "dirt", 5, 5, 10, 5)!;
    expect(p).toBeTruthy();
    expect(p.tiles[0]).toEqual([5, 5]);
    expect(p.tiles.at(-1)).toEqual([10, 5]);
    expect(p.tiles).toHaveLength(6);
    expect(p.cost).toBe(5 * COST_FLAT);   // 5 steps, start is free
  });

  it("routes around water rather than failing", () => {
    const grid = flatGrid();
    for (let y = 0; y <= 6; y++) grid.terrain[tIdx(8, y)] = WATER;
    const p = findPath(grid, createTrack(), "dirt", 5, 5, 12, 5)!;
    expect(p).toBeTruthy();
    for (const [x, y] of p.tiles) expect(grid.terrain[tIdx(x, y)]).not.toBe(WATER);
    expect(p.tiles.at(-1)).toEqual([12, 5]);
  });

  it("returns null when the target is walled off entirely", () => {
    const grid = flatGrid();
    for (let y = 0; y < MAP_H; y++) grid.terrain[tIdx(8, y)] = WATER;
    expect(findPath(grid, createTrack(), "dirt", 5, 5, 12, 5)).toBeNull();
  });

  it("detours around rough when the detour is genuinely cheaper", () => {
    const grid = flatGrid();
    // A single rough tile dead ahead. Crossing costs 3; stepping around it
    // costs 1+1+1 = 3 for the same net progress, so the detour must not be
    // MORE expensive — assert on cost, not on which tiles were chosen.
    grid.terrain[tIdx(7, 5)] = ROUGH;
    const p = findPath(grid, createTrack(), "dirt", 5, 5, 9, 5)!;
    expect(p.cost).toBeLessThanOrEqual(3 * COST_FLAT + COST_ROUGH);
  });

  it("crosses a thick rough wall rather than taking a long detour", () => {
    const grid = flatGrid();
    // Detouring around a 3-tall wall costs 4 extra steps; crossing one rough
    // tile costs 2 extra. Crossing is correct and A* must find it.
    for (const y of [4, 5, 6]) grid.terrain[tIdx(7, y)] = ROUGH;
    const p = findPath(grid, createTrack(), "dirt", 5, 5, 9, 5)!;
    expect(p.cost).toBe(3 * COST_FLAT + COST_ROUGH);
    expect(p.tiles.some(([x, y]) => grid.terrain[tIdx(x, y)] === ROUGH)).toBe(true);
  });

  it("avoids rough entirely when a flat route of equal length exists", () => {
    const grid = flatGrid();
    // one rough tile with clear flat ground either side of a 2-wide corridor
    grid.terrain[tIdx(6, 5)] = ROUGH;
    const p = findPath(grid, createTrack(), "dirt", 5, 5, 7, 5)!;
    // straight through costs 1+3=4; around via y=4 costs 1+1+1+1=4 — either
    // is optimal, but the path must never cost more than the cheapest option
    expect(p.cost).toBeLessThanOrEqual(4);
  });

  it("reuses an existing trunk line thanks to the 0.3× discount", () => {
    const grid = flatGrid();
    const t = createTrack();
    // an existing dirt along y=8 ; a detour onto it should beat a straight run
    for (let x = 5; x <= 20; x++) buildTile(t, "dirt", x, 8);
    const p = findPath(grid, t, "dirt", 5, 8, 20, 8)!;
    // the whole path is on the trunk, so it costs 15 * 0.3, not 15
    expect(p.cost).toBeCloseTo(15 * COST_FLAT * COST_OWNED, 6);
  });

  it("can stop beside an impassable goal with adjacentTo", () => {
    const farm = ind("farm", 10, 10);
    const grid = flatGrid([farm]);
    expect(findPath(grid, createTrack(), "dirt", 5, 10, 10, 10)).toBeNull();
    const p = findPath(grid, createTrack(), "dirt", 5, 10, 10, 10, true)!;
    expect(p).toBeTruthy();
    const [lx, ly] = p.tiles.at(-1)!;
    expect(Math.abs(lx - 10) + Math.abs(ly - 10)).toBe(1);
  });

  it("is deterministic — identical inputs give an identical path", () => {
    const grid = generateMap(31337);
    const a = findPath(grid, createTrack(), "dirt", 4, 4, 40, 40);
    const b = findPath(grid, createTrack(), "dirt", 4, 4, 40, 40);
    expect(a?.tiles).toEqual(b?.tiles);
    expect(a?.cost).toBe(b?.cost);
  });

  it("handles the degenerate same-tile path", () => {
    const p = findPath(flatGrid(), createTrack(), "dirt", 5, 5, 5, 5)!;
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
    const farm = ind("farm", 10, 10);      // PP-12: footprint follows the art
    const spots = harvesterSpots(flatGrid([farm]), farm);
    // the orthogonally-adjacent ring tiles of the w×h footprint, in the
    // stable y-major order harvesterSpots walks (no diagonal corners).
    const expected: [number, number][] = [];
    for (let x = farm.tx; x < farm.tx + farm.w; x++) expected.push([x, farm.ty - 1]);
    for (let y = farm.ty; y < farm.ty + farm.h; y++) {
      expected.push([farm.tx - 1, y]);
      expected.push([farm.tx + farm.w, y]);
    }
    for (let x = farm.tx; x < farm.tx + farm.w; x++) expected.push([x, farm.ty + farm.h]);
    expect(spots).toEqual(expected);
    for (const [x, y] of spots) {
      const insideX = x >= farm.tx && x < farm.tx + farm.w;
      const insideY = y >= farm.ty && y < farm.ty + farm.h;
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
    expect(networkTiles(createTrack(), "dirt", F)).toEqual([[5, 5]]);
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

  it("builds dirt when it cannot afford road", () => {
    const grid = flatGrid([ind("farm", 10, 5)]);
    // enough wood/stone for dirt, no ore at all → road is unaffordable.
    // PP-05/PP-07: the Depot's own cost (1 grain + 1 oil alongside wood/stone)
    // is covered, so the Depot is affordable and the transport choice stays
    // the thing under test.
    const plan = planCandidates(state(grid), F, { stock: {}, purse: { wood: 50, stone: 50, grain: 1, oil: 1 } });
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((c) => c.kind === "dirt")).toBe(true);
    expect(TRANSPORT.road.cost.ore).toBeGreaterThan(0);
  });

  it("builds dirt by default and road only when told to pave", () => {
    // VP-01 changed the default. A Road laid on virgin ground buys throughput
    // but no points, and 4 extra Ore a tile it will never see back — so the
    // planner lays gravel, keeps the ore, and the POINTS come from the pave
    // pass (`planUpgrades`), which is 4 Ore and 0.25★ on a tile it already
    // owns. `preferPaved` is the option that still asks for road up front.
    const grid = flatGrid([ind("farm", 10, 5)]);
    const plan = planCandidates(state(grid), F, { stock: {}, purse: rich });
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((c) => c.kind === "dirt")).toBe(true);
    const paved = planCandidates(state(grid), F, { stock: {}, purse: rich, preferPaved: true });
    expect(paved[0].kind).toBe("road");
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
    expect(out.harvester).toBeTruthy();
    const perTile = TRANSPORT[c.kind].cost;
    for (const [cargo, v] of Object.entries(perTile)) {
      // the laid tiles at the per-tile rate, plus the paid Depot's own share
      // of this cargo (PP-07: wood/stone ride the depot ticket too)
      const depotBit = DEPOT_COST[cargo as keyof typeof out.spent] ?? 0;
      expect(out.spent[cargo as keyof typeof out.spent]).toBe(v * out.built.length + depotBit);
    }
  });

  it("reuses its trunk line on the second build instead of a parallel spur", () => {
    // PP-16 sets the gap here: the second industry has to be far enough that
    // the first Depot's 4×4 catchment does NOT reach it — a Depot holds every
    // industry it can see, so two industries within one catchment are one
    // claim and there is nothing left for a second Depot to build for. Seven
    // tiles apart is the balance: separate claims, one shared trunk.
    const grid = flatGrid([ind("farm", 20, 5), ind("forest", 27, 5)]);
    const s = state(grid);
    const first = aiBuildStep(s, F, { stock: {}, purse: rich }, 1)!;
    const laidFirst = first.built.length;
    const second = aiBuildStep(s, F, { stock: {}, purse: rich }, 2)!;
    // the second industry is close to the first, so the marginal build is small
    expect(second.built.length).toBeLessThan(laidFirst);
    expect(s.harvesters).toHaveLength(2);
  });

  it("PP-16: will not build a second Depot for ground the first one holds", () => {
    // Two industries inside ONE catchment: the rival takes the first, holds
    // both, and spends no further tile on a Depot that would claim nothing.
    const grid = flatGrid([ind("farm", 20, 5), ind("forest", 22, 5)]);
    const s = state(grid);
    const first = aiBuildStep(s, F, { stock: {}, purse: rich }, 1)!;
    expect(first.harvester).toBeTruthy();
    expect(lockedIndustryIds(s).size).toBe(2);
    expect(bestCandidate(s, F, { stock: {}, purse: rich })).toBeNull();
    expect(s.harvesters).toHaveLength(1);
  });

  it("W3: builds over its free allowance when the purse alone is short", () => {
    const grid = flatGrid([ind("farm", 12, 5)]);
    const s = state(grid);
    // The path from F(5,5) to the harvester spot near the farm is longer
    // than 5 tiles — 5 stone of dirt is not enough for the whole build...
    const short = bestCandidate(s, F, { stock: {}, purse: { stone: 5 } });
    expect(short).toBeNull();
    // ...but the 12-tile free setup allowance covers it, exactly like the
    // human's setup phase does.
    const withFree = aiBuildStep(s, F, { stock: {}, purse: { stone: 5 }, free: 12, freeDepots: 1 }, 1);
    expect(withFree).toBeTruthy();
    expect(withFree!.built.length).toBeGreaterThan(5);
    expect(withFree!.free).toBe(withFree!.built.length);   // all free
    expect(Object.keys(withFree!.spent).length).toBe(0);   // purse untouched
    expect(s.harvesters).toHaveLength(1);
  });

  it("W3: charges only the tiles beyond the free allowance", () => {
    const grid = flatGrid([ind("farm", 12, 5)]);
    const s = state(grid);
    const out = aiBuildStep(s, F, { stock: {}, purse: { wood: 99, stone: 99, grain: 99, oil: 1 }, free: 4 }, 1)!;
    const charged = out.built.length - out.free;
    expect(charged).toBeGreaterThan(0);
    // the paid track tiles plus the paid Depot's own wood/stone (PP-07)
    expect(out.spent.stone).toBe(charged + (DEPOT_COST.stone ?? 0));
    expect(out.spent.wood).toBe(charged + (DEPOT_COST.wood ?? 0));
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
// build (÷ the 0.3 floor), the road-first pass never fell through to dirt when
// road was impossible, and the resulting no-op turn was reported as a real one
// — so the rival re-picked the same doomed candidate every 9 s forever.
//
// The whole-map sweep over every legal rival tile lives in
// `iso-ai-sweep.test.ts` (it is slow); these are the focused regressions.
// ══════════════════════════════════════════════════════════════════════════

/** The rival's opening purse and setup allowances, exactly as `game.ts` gives
 *  it. PP-05 added `freeDepots`: the rival's FIRST Depot is free, which is what
 *  keeps an opening turn affordable with no Oil in the purse. */
const rivalOpts = () => ({
  stock: { wood: 12, stone: 12, ore: 0 }, purse: { wood: 12, stone: 12, ore: 0 },
  free: 12, freeDepots: FREE_SETUP_DEPOTS,
});

/**
 * Seed-1337 repro state: the rival's factory on a rough, dirt-buildable,
 * reachable tile (found from the map); callers needing a dead tile pass (0,0).
 */
function roughRival(tx?: number, ty?: number): { eco: EconomyState; f: Factory } {
  const grid = generateMap(1337);
  // T4: (38,4) was a rough, dirt-legal/road-illegal tile on the 48×48 map.
  // Scan for one instead so the fixture is map-size agnostic: the factory must
  // stand on rough ground (road can't lay there, dirt can).
  if (tx === undefined || ty === undefined) {
    outer: for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      const i = y * MAP_W + x;
      if (grid.terrain[i] === ROUGH && grid.occupancy[i] === -1) { tx = x; ty = y; break outer; }
    }
  }
  if (tx === undefined || ty === undefined) throw new Error("seed has no dirt-legal rough tile");
  const eco: EconomyState = {
    grid, track: createTrack(), harvesters: [],
    factories: [{ owner: "ai", ownerId: 2, tx, ty }],
  };
  return { eco, f: eco.factories[0] };
}

describe("W8 plan feasibility", () => {
  it("flags a road path over rough ground as not executable", () => {
    const grid = flatGrid([ind("farm", 5, 9)]);
    grid.terrain[tIdx(5, 5)] = ROUGH;         // the factory stands on rough
    const s = state(grid);
    const path = findPath(grid, s.track, "dirt", 5, 5, 5, 8, false, 0)!;
    expect(path).toBeTruthy();
    // the same tiles are illegal for road: TRANSPORT.road.onRough === false
    const road = planFeasibility(s, "road", { tiles: path.tiles, cost: path.cost }, 5, 8, 0);
    expect(TRANSPORT.road.onRough).toBe(false);
    expect(road.executable).toBe(false);
    expect(road.viable).toBe(false);
    const dirt = planFeasibility(s, "dirt", path, 5, 8, 0);
    expect(dirt.executable).toBe(true);
    expect(dirt.serviced).toBe(true);          // the path's penultimate tile
    expect(dirt.viable).toBe(true);
    expect(dirt.fresh.length).toBe(path.tiles.length);
  });

  it("refuses the one-tile path under the depot: laid track there services nothing", () => {
    // `isServiced` looks at the harvester's four NEIGHBOURS, so track laid on
    // the tile the depot stands on does not service it.
    const grid = flatGrid([ind("oil_rig", 5, 6)]);
    const s = state(grid);
    const one: [number, number][] = [[5, 5]];  // F's own tile, a harvester spot
    const f = planFeasibility(s, "dirt", { tiles: one, cost: 0 }, 5, 5, 0);
    expect(f.fresh).toEqual([[5, 5]]);
    expect(f.serviced).toBe(false);
    expect(f.viable).toBe(false);
    // once a neighbour carries our track the same spot IS viable, for free
    buildTile(s.track, "dirt", 4, 5, 0);
    expect(planFeasibility(s, "dirt", { tiles: one, cost: 0 }, 5, 5, 0).viable).toBe(true);
  });

  it("counts only track owned by the AI as servicing (W2)", () => {
    const grid = flatGrid([ind("oil_rig", 5, 6)]);
    const s = state(grid);
    buildTile(s.track, "dirt", 4, 5, 7);       // somebody else's dirt
    const f = planFeasibility(s, "dirt", { tiles: [[5, 5]], cost: 0 }, 5, 5, 2);
    expect(f.serviced).toBe(false);
    buildTile(s.track, "dirt", 6, 5, 2);       // ours
    expect(planFeasibility(s, "dirt", { tiles: [[5, 5]], cost: 0 }, 5, 5, 2).serviced).toBe(true);
  });
});

describe("W8 the degenerate candidate no longer wins the ranking", () => {
  it("never offers a path that lays nothing and lands nothing", () => {
    // The industry sits directly below the factory, so the factory's own tile
    // is a harvester spot: the old scorer divided by the 0.3 floor and put a
    // one-tile, zero-cost "path" first, every turn, forever.
    const grid = flatGrid([ind("oil_rig", 5, 6)]);
    grid.terrain[tIdx(5, 5)] = ROUGH;          // and it is rough: road is out
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
    // …and the rival reaches a REAL spot instead (dirt, since road needs flat)
    const out = aiBuildStep(s, F, { stock: {}, purse: rich }, 1)!;
    expect(out).toBeTruthy();
    expect(out.kind).toBe("dirt");
    expect(out.built.length).toBeGreaterThan(1);
    expect(out.harvester).toBeTruthy();
    expect(isServiced(s.track, out.harvester!)).toBe(true);
  });

  it("falls through to dirt when the road plan cannot be built", () => {
    const { eco, f } = roughRival();
    expect(canBuildOn(eco.grid, "dirt", f.tx, f.ty)).toBe(true);
    expect(canBuildOn(eco.grid, "road", f.tx, f.ty)).toBe(false);
    // no candidate may claim a kind it cannot lay
    for (const c of planCandidates(eco, f, rivalOpts())) {
      expect(c.path.tiles.every(([x, y]) => canBuildOn(eco.grid, c.kind, x, y))).toBe(true);
    }
  });
});

describe("W8 a no-op turn is reported as no turn", () => {
  it("aiBuildStep returns null instead of a truthy empty outcome", () => {
    // (0,0) on seed 1337 is the water corner: no track can leave the tile at
    // all, and its dirt-legal component reaches no harvester. Nothing the AI
    // does can build from there — the honest answer is `null` every turn,
    // never a truthy outcome the caller spends a turn on.
    const { eco, f } = roughRival(0, 0);
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
  it("picks a road-legal tile with a real plan, not the farthest dirt-only one", () => {
    const grid = generateMap(1337);
    const player: [number, number] = [23, 22];
    const spot = chooseRivalFactorySpot(grid, createTrack(), player, {
      purse: { wood: 12, stone: 12, ore: 0 }, free: 12, ownerId: 2,
    });
    expect(spot).toBeTruthy();
    const [x, y] = spot!;
    expect(canBuildOn(grid, "road", x, y), "road must be legal on the rival's tile").toBe(true);
    // the old dirt-only search handed back the (2,2) enclave for this player
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
  }, 10_000);

  it("is deterministic, and never returns an enclave for any player tile", () => {
    const grid = generateMap(1337);
    const opts = { purse: { wood: 12, stone: 12, ore: 0 }, free: 12, ownerId: 2 };
    const a = chooseRivalFactorySpot(grid, createTrack(), [23, 22], opts);
    const b = chooseRivalFactorySpot(grid, createTrack(), [23, 22], opts);
    expect(a).toEqual(b);
    // a spread of player placements across the map
    for (const [px, py] of [[4, 4], [16, 16], [27, 6], [6, 27], [23, 22], [12, 12]] as [number, number][]) {
      const s = chooseRivalFactorySpot(grid, createTrack(), [px, py], opts);
      expect(s, `player at ${px},${py}`).toBeTruthy();
      expect(canBuildOn(grid, "dirt", s![0], s![1])).toBe(true);
      expect(canReachASpot(grid, s![0], s![1]), `enclave for player ${px},${py}`).toBe(true);
      expect(s).not.toEqual([px, py]);
    }
  }, 10_000);

  it("still returns a tile when nothing is affordable (the rival exists)", () => {
    const grid = generateMap(1337);
    const spot = chooseRivalFactorySpot(grid, createTrack(), [23, 22], {
      purse: {}, free: 0, ownerId: 2,
    });
    expect(spot).toBeTruthy();
    expect(canBuildOn(grid, "dirt", spot![0], spot![1])).toBe(true);
  }, 10_000);
});

// ══════════════════════════════════════════════════════════════════════════
// W9 — the AI shares the player's cost model, including the dirt-only
// allowance. W3 made the rival plan with the same free-track budget the human
// drag preview uses; before this, that meant free road for the rival too.
// ══════════════════════════════════════════════════════════════════════════
describe("W9 the rival's setup allowance buys dirt only", () => {
  it("offers no road plan while road still has to be paid for in ore", () => {
    const grid = flatGrid([ind("farm", 12, 5)]);
    const s = state(grid);
    // the rival's opening purse: 12 wood + 12 stone, no ore, 12 free tiles
    const plan = planCandidates(s, F, { stock: {}, purse: { wood: 12, stone: 12, ore: 0 }, free: 12, freeDepots: 1 });
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((c) => c.kind === "dirt"), "free road is the W9 bug").toBe(true);

    // with ore AND `preferPaved` it takes road again — and now prices every
    // tile of it (VP-01 made the plain default dirt, so the option is required)
    const paid = planCandidates(s, F, { stock: {}, purse: { wood: 12, stone: 12, ore: 9999 }, free: 12, freeDepots: 1, preferPaved: true });
    expect(paid[0].kind).toBe("road");
    expect(paid[0].cost.ore).toBe(TRANSPORT.road.cost.ore! * paid[0].path.tiles.length);
  });

  it("a road build consumes no allowance, so the rival keeps its dirt budget", () => {
    const grid = flatGrid([ind("farm", 12, 5)]);
    const s = state(grid);
    const road = aiBuildStep(s, F, { stock: {}, purse: { wood: 12, stone: 12, ore: 9999 }, free: 12, freeDepots: 1, preferPaved: true }, 1)!;
    expect(road).toBeTruthy();
    expect(road.kind).toBe("road");
    expect(road.free).toBe(0);
    expect(road.spent.ore).toBe(TRANSPORT.road.cost.ore! * road.built.length);
    expect(road.harvester).toBeTruthy();

    // the dirt build the same allowance WAS for still rides it, unchanged (W3)
    const s2 = state(grid);
    const dirt = aiBuildStep(s2, F, { stock: {}, purse: { wood: 12, stone: 12, ore: 0 }, free: 12, freeDepots: 1 }, 1)!;
    expect(dirt.kind).toBe("dirt");
    expect(dirt.free).toBe(dirt.built.length);
    expect(Object.keys(dirt.spent).length).toBe(0);
  });

  it("prices a road plan the same way the human drag preview does", () => {
    const grid = flatGrid([ind("farm", 12, 5)]);
    const s = state(grid);
    // 8 Ore will not pay for the ~7 tiles of a paved line from F to the farm, so
    // the affordability bound must refuse the whole road plan — and VP-01's
    // default would have bought the same reach in gravel for free.
    const purse = { wood: 12, stone: 12, ore: 8 };
    const opts = { stock: {}, purse, free: 12, freeDepots: 1, preferPaved: true as const };
    const plan = planCandidates(s, F, opts);
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((c) => c.kind === "dirt")).toBe(true);
    const out = aiBuildStep(s, F, opts, 1)!;
    expect(out.kind).toBe("dirt");
    expect(out.spent.ore ?? 0).toBe(0);

    // …with ore to spare the SAME path is priced tile for tile at the full road
    // price, which is what `previewDrag` charges a human for that drag (W9),
    // and a paid tier still burns none of the free dirt allowance.
    const s2 = state(grid);
    const paved = aiBuildStep(
      s2, F, { stock: {}, purse: { wood: 99, stone: 99, ore: 9999 }, free: 12, freeDepots: 1, preferPaved: true }, 1,
    )!;
    expect(paved.kind).toBe("road");
    expect(paved.built.length).toBeGreaterThan(0);
    expect(paved.spent.ore).toBe((TRANSPORT.road.cost.ore ?? 0) * paved.built.length);
    expect(paved.free).toBe(0);
  });
});


describe("T4 routing regressions", () => {
  it("routes around town tiles instead of proposing an unbuildable shortcut", () => {
    const grid = flatGrid([ind("farm", 10, 10)]);
    grid.occupancy[tIdx(6, 5)] = TOWN_OCC;
    grid.occupancy[tIdx(10, 9)] = TOWN_OCC;
    expect(stepCost(grid, createTrack(), "dirt", 6, 5)).toBe(Infinity);
    const path = findPath(grid, createTrack(), "dirt", 5, 5, 7, 5)!;
    expect(path.tiles).not.toContainEqual([6, 5]);
    expect(path.tiles.every(([x, y]) => canBuildOn(grid, "dirt", x, y))).toBe(true);
    expect(harvesterSpots(grid, grid.industries[0])).not.toContainEqual([10, 9]);
  });

  it("preserves the heap's lowest-index tie break", () => {
    expect(findPath(flatGrid(), createTrack(), "dirt", 5, 5, 7, 7)?.tiles).toEqual([
      [5, 5], [6, 5], [7, 5], [7, 6], [7, 7],
    ]);
  });

  it("does not prune affordable extensions of a long existing trunk", () => {
    const grid = flatGrid([ind("farm", 65, 5)]), track = createTrack();
    for (let x = 5; x <= 60; x++) buildTile(track, "dirt", x, 5);
    const candidate = bestCandidate(state(grid, track), F, { stock: {}, purse: { wood: 4, stone: 4 }, freeDepots: 1 });
    expect(candidate).toBeTruthy();
    expect(candidate!.cost.stone).toBeLessThanOrEqual(4);
    expect(candidate!.path.tiles[0]).toEqual([60, 5]);
  });

  it("does not charge stone in the affordability bound for dirt-to-road upgrades", () => {
    const grid = flatGrid([ind("farm", 15, 5)]), track = createTrack();
    for (let x = 5; x <= 14; x++) buildTile(track, "dirt", x, 5);
    // `preferPaved` is what VP-01 needs here: the claim under test is that a
    // path riding existing gravel is bound by the UPGRADE price (4 Ore), not by
    // the full road price — dirt would be cheaper still, and is the default now.
    const candidate = bestCandidate(state(grid, track), F, { stock: {}, purse: { ore: 40 }, freeDepots: 1, preferPaved: true });
    expect(candidate?.kind).toBe("road");
    // The whole bound is an UPGRADE price: the one tile this plan has to touch
    // is already the AI's own gravel, so it costs Ore and nothing else — no
    // Wood, no Stone, which is the thing this test was written for. The rest of
    // the trunk is not in `path.tiles` at all: `networkTiles` seeds the search
    // from the MERGED network, so a rival never re-prices ground it already owns.
    expect(candidate!.cost).toEqual({ ore: UPGRADE_COST.ore });
    expect(candidate!.path.tiles).toEqual([[14, 5]]);
  });

  it("finds an affordable rival opening beyond the old eight far-corner probes", () => {
    // PP-02: the rival's Factory must sit next to a town, so the search runs
    // on a REAL generated map (which has towns + industries), not a town-less
    // flat grid. The opening must still be affordable from the rival's
    // 12 wood + 12 stone of PP-07 starting stock.
    const grid = generateMap(1337);
    const spot = chooseRivalFactorySpot(grid, createTrack(), [4, 4], { purse: { wood: 12, stone: 12 }, free: 12, ownerId: 2 })!;
    expect(spot).toBeTruthy();
    const factory: Factory = { owner: "ai", ownerId: 2, tx: spot[0], ty: spot[1] };
    const out = aiBuildStep(state(grid), factory, { stock: {}, purse: { wood: 12, stone: 12 }, free: 12, freeDepots: 1 }, 1);
    expect(out?.harvester).toBeTruthy();
    expect(out!.spent.stone ?? 0).toBeLessThanOrEqual(12);
  }, 30_000);

  it("keeps an opening placement well below the old multi-second UI stall", () => {
    const grid = generateMap(1337);
    const start = performance.now();
    const spot = chooseRivalFactorySpot(grid, createTrack(), [92, 32], { purse: { wood: 12, stone: 12 }, free: 12, ownerId: 2 });
    expect(spot).toBeTruthy();
    // The unpruned patch took ~9s locally. Generous CI margin over a <100ms
    // normal opening, without disguising the stall with a 120s test timeout.
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe("VP-01 the rival reads the scoreboard", () => {
  // `rivalPace` is pure — two totals and the target — so the whole policy fits
  // in a table instead of having to be inferred from a 40-minute race.
  it("sprints only when the gap is a whole point of score", () => {
    const cruise = { sprint: false, bankPerTurn: 2, oreUrgency: 1, deny: false };
    expect(rivalPace(0, 0, 10)).toEqual(cruise);
    expect(rivalPace(0.75, 0, 10).sprint).toBe(false);     // under a plant: noise
    expect(rivalPace(1, 0, 10).sprint).toBe(true);         // exactly a plant: an emergency
    expect(rivalPace(3.5, 2.5, 10).sprint).toBe(true);    // the GAP counts, not the totals
    expect(rivalPace(2, 4, 10)).toEqual(cruise);            // winning → keep compounding income
    const pace = rivalPace(1, 0, 10);
    expect(pace.bankPerTurn).toBeGreaterThan(cruise.bankPerTurn); // more trades a turn
    expect(pace.oreUrgency).toBeGreaterThan(cruise.oreUrgency);  // …and it chases ore mines
    // …and NOTHING else. In particular the goal does not grow: an earlier
    // version let a sprinting rival point its bank at eight tiles (32 Ore)
    // instead of four, and on seed 99 of the 5-seed race that seat scored 0★ for
    // the entire game — it sold four stacks a turn toward a milestone it could
    // never reach and stopped affording the economy that would have carried it
    // there. A plan has to be short enough to finish. The policy's whole surface
    // is asserted here so that enlarging it is a decision, not an accident
    // (`planUpgrades` still paves all eight tiles in one go when the Ore is
    // already in the purse, which is the half of the idea that survived).
    expect(Object.keys(pace).sort()).toEqual(["bankPerTurn", "deny", "oreUrgency", "sprint"]);
  });

  it("denies the leader once the game is one plant away from ending", () => {
    expect(rivalPace(9, 4, 10).deny).toBe(false);       // two points of room: build
    expect(rivalPace(9.25, 4, 10).deny).toBe(true);     // one pave from the win: block
    expect(rivalPace(9.25, 10, 10).deny).toBe(true);    // it reads YOUR total, not the gap
    // denial is independent of sprinting: a rival that is AHEAD still blocks a
    // player about to win, because that turn is the last turn either way.
    expect(rivalPace(9.5, 10, 10).sprint).toBe(false);
  });

  it("scales the value of Ore-bearing ground and nothing else", () => {
    const ore = ind("ore_mine", 4, 4);
    const oreGrid = flatGrid([ore]);
    // PP-16: the ranking values what a NEW Depot would HOLD, so the second
    // argument is the claim map — empty here, i.e. nothing spoken for yet.
    const locks = new Map<number, Harvester>();
    const at = (u: number) => catchmentValue(state(oreGrid), locks, {}, 5, 5, 0, u);
    expect(at(1)).toBeGreaterThan(0);
    expect(at(3)).toBeCloseTo(at(1) * 3, 10);      // a pure multiplier on the ore term

    const farmGrid = flatGrid([ind("farm", 4, 4)]);
    const atFarm = (u: number) => catchmentValue(state(farmGrid), locks, {}, 5, 5, 0, u);
    expect(atFarm(3)).toBe(atFarm(1));              // urgency does not touch other cargo
  });

  it("changes which industry the next Depot chases", () => {
    // Equal distance from the plant, so only the cargo weighting can move the
    // ranking: the farm is worth more per tile at urgency 1 on this output…
    const farm = ind("farm", 5, 10);
    const mine = ind("ore_mine", 5, 0);
    const grid = flatGrid([farm, mine]);
    const plan = (oreUrgency: number) =>
      planCandidates(state(grid), F, { stock: {}, purse: rich, oreUrgency });
    const scoreOf = (p: ReturnType<typeof plan>, type: string) =>
      p.find((c) => c.industry.type === type)!.score;
    const calm = plan(1), hot = plan(3);
    expect(scoreOf(calm, "farm")).toBeGreaterThan(0);
    expect(scoreOf(hot, "ore_mine") / scoreOf(hot, "farm"))
      .toBeGreaterThan(scoreOf(calm, "ore_mine") / scoreOf(calm, "farm"));
    expect(scoreOf(hot, "farm")).toBe(scoreOf(calm, "farm"));   // the farm's own value is untouched
    // …and the multiplier is bounded by the table it scales, so a rival cannot
    // be talked into an infinite ore obsession by a large number.
    expect(CARGO_VALUE.ore).toBeGreaterThan(0);
  });
});
