// ══════════════════════════════════════════════════════════════════════════
// E4 (#268) — slope rules and uphill costs.
//
// The acceptance block this file pins, in the order the ticket writes it:
//
//   • a road (either tier) climbs at most one level per tile: a steeper step is
//     refused with a readable reason, and the drag builds its valid prefix;
//   • rail obeys the same one-level limit PLUS the ramp rule (two level changes
//     at least `railRampRun` steps apart) and no diagonal link across a level
//     change;
//   • a truck Depot's 2×2 lot, a processing plant, the starting Factory, a
//     platform's 1×3 and a dam's dry half all need a LEVEL footprint;
//   • the L3 distance factor (#217) counts every level climbed as extra
//     distance, so a hill route bands lower — and pays out slower — than the
//     same length of flat road;
//   • lorries and trains move slower on the segment they climb;
//   • the rival's A* prices the climb and never plans a drag the shared rules
//     would refuse (its planner is checked with `validateRailDrag`);
//   • the exemptions that keep bridges (#266) and dams (#270) working: a step
//     onto/off a bridge deck, and the water half of a dam's footprint, are not
//     graded;
//   • with the `elevation` option off (no height bytes) every answer is exactly
//     the pre-#268 one.
//
// Fixtures are FULL-SIZE grids (a MAP_W × MAP_H grid where `tIdx`/`idx` agree):
// `map(rows)` stamps small patterns of LEVELS at the top-left and leaves the
// rest flat grass. `~` is river water, so bridges and dams can see it.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { MAP_W, MAP_H } from "../../src/game/config";
import { SLOPES } from "../../src/iso/config";
import { GRASS, WATER, type Grid } from "../../src/iso/grid";
import {
  buildRefusal, buildTile, canBuildOn, createTrack, previewDrag, tIdx, type Track,
} from "../../src/iso/track";
import {
  RAIL_REFUSAL_TEXT, createRailState, depotRefusal, platformRefusal, railPreview,
  tickTrains, type RailState,
} from "../../src/iso/rail";
import {
  SLOPE_REFUSAL_TEXT, climbLevels, climbTiles, footprintFlatTiles, railDragSlopeRefusals,
  roadStepOk, roadStepRefusal, routeDistance, uphillSpeed,
} from "../../src/iso/slopes";
import { depotPathLength, type EconomyState, type Harvester } from "../../src/iso/economy";
import { depotRate, distanceFactor } from "../../src/iso/loop";
import { planDepotPlacement, planFactoryPlacement } from "../../src/iso/placement";
import { PLANT_REFUSAL_TEXT, plantRefusal } from "../../src/iso/plants";
import { damRefusal } from "../../src/iso/dams";
import { COST_SLOPE, IMPASSABLE, findPath, planRailRoute, stepCost, validateRailDrag } from "../../src/iso/ai";
import { tickTrucks, type Truck, type TruckState } from "../../src/iso/vehicles";

// ── fixtures ──────────────────────────────────────────────────────────────
/**
 * A full 144×144 map: each char of `rows` is the LEVEL of a tile at the
 * top-left (`~` = river water, level 0 — `rivers` is set so bridge/dam rules
 * see the water). Every other tile is level-0 grass.
 */
function map(rows: string[] = []): Grid {
  const w = MAP_W, h = MAP_H;
  const terrain = new Uint8Array(w * h).fill(GRASS);
  const height = new Uint8Array(w * h);
  const rivers = new Uint8Array(w * h);
  const occupancy = new Int16Array(w * h).fill(-1);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const i = y * MAP_W + x;
      if (row[x] === "~") { terrain[i] = WATER; rivers[i] = 1; continue; }
      height[i] = Number(row[x]);
    }
  });
  return { w, h, terrain, rivers, height, industries: [], towns: [], occupancy, seed: 1 } as unknown as Grid;
}

/** The same map with no height bytes at all — the `elevation` option off. */
const optionOff = (): Grid => {
  const g = map();
  return { ...g, height: undefined } as unknown as Grid;
};

/** A dirt run down a column, owned by `owner` (the L3 test's `vrun`). */
const vrun = (t: Track, x: number, y0: number, y1: number, owner: number) => {
  for (let y = y0; y <= y1; y++) buildTile(t, "dirt", x, y, owner);
};

/** A truck Depot whose ENTRANCE is (tx, ty) — the lot is the row above it. */
const HarvesterAt = (id: number, tx: number, ty: number): Harvester =>
  ({ id, owner: "you", ownerId: 1, tx, ty: ty - 1, facing: "sw" });

function economy(grid: Grid, track: Track, h: Harvester, factoryTy: number): EconomyState {
  const eco = { grid, track, harvesters: [h], factories: [] } as unknown as EconomyState;
  eco.factories.push({ owner: "you", ownerId: 1, tx: h.tx, ty: factoryTy, id: 0, townId: null });
  return eco;
}

// ══════════════════════════════════════════════════════════════════════════
describe("E4 (#268) the road slope rule", () => {
  it("pins the shipped numbers", () => {
    expect(SLOPES.roadMaxStep).toBe(1);
    expect(SLOPES.railMaxStep).toBe(1);
    expect(SLOPES.railRampRun).toBe(3);
    expect(SLOPES.climbTiles).toBe(2);
    expect(SLOPES.uphillSlow).toBe(1);
  });

  it("refuses a step steeper than one level, with a readable reason", () => {
    // (0,1) is level 0, (1,1) is level 2: a two-level step.
    const g = map(["000", "020", "000"]);
    expect(climbLevels(g, [0, 1], [1, 1])).toBe(2);
    expect(roadStepRefusal(g, [0, 1], [1, 1])).toBe("too-steep");
    expect(roadStepOk(g, [0, 1], [1, 1])).toBe(false);
    expect(buildRefusal(g, "dirt", 1, 1, undefined, undefined, undefined, [0, 1])).toBe("too-steep");
    expect(canBuildOn(g, "dirt", 1, 1, undefined, undefined, undefined, [0, 1])).toBe(false);
    // The wording the toast/flash read, and it says what is wrong.
    expect(SLOPE_REFUSAL_TEXT["too-steep"]).toMatch(/steep/i);
    // A probe with no step keeps the pre-#268 answer: the tile alone is fine.
    expect(buildRefusal(g, "dirt", 1, 1)).toBeNull();
    // One level is a legal climb, both tiers.
    expect(roadStepRefusal(g, [0, 1], [0, 0])).toBeNull();
    expect(roadStepOk(g, [0, 1], [0, 0])).toBe(true);
  });

  it("builds a one-level climb, and a refused drag keeps its valid prefix", () => {
    const t = createTrack();
    // A terrace one level up: every step climbs at most one level → all 5 tiles.
    const climb = map(["00111", "00111", "00111"]);
    const ok = previewDrag(climb, t, "dirt", {}, 0, 0, 4, 0);
    expect(ok.tiles).toEqual([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]);
    expect(ok.truncated).toBe(false);
    expect(ok.blocked).toEqual([]);
    // A cliff: the tile at x=2 is two levels up, so the drag stops one short of
    // it and the prefix is what a build would lay (the same shape an
    // unaffordable drag produces).
    const cliff = map(["00222", "00222", "00222"]);
    const cut = previewDrag(cliff, t, "dirt", {}, 0, 0, 4, 0);
    expect(cut.tiles).toEqual([[0, 0], [1, 0]]);
    expect(cut.blocked).toEqual([[2, 0]]);
    expect(cut.truncated).toBe(true);
  });

  it("refuses a tile that would JOIN standing track across a steeper step", () => {
    // A road stands at (0,0) on level 2; (0,1) is level 0 and joins it edge-on.
    const g = map(["2000", "0000", "0000"]);
    const t = createTrack();
    buildTile(t, "dirt", 0, 0, 1);
    expect(buildRefusal(g, "dirt", 0, 1, undefined, undefined, t)).toBe("too-steep");
    // Without the layer there is no join to judge — the tile alone is legal.
    expect(buildRefusal(g, "dirt", 0, 1)).toBeNull();
    // Two levels apart is the only case refused: a one-level flank joins fine.
    const fine = map(["1000", "0000", "0000"]);
    expect(buildRefusal(fine, "dirt", 0, 1, undefined, undefined, t)).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("E4 (#268) the rail slope rules", () => {
  it("refuses a diagonal link that crosses a level change", () => {
    // (0,0) is level 0, (1,1) is level 1: the 45° link climbs.
    const g = map(["01", "11"]);
    const why = railDragSlopeRefusals(g, [[0, 0], [1, 1]]);
    expect(why.get(1)).toBe("slope-diagonal");
    // Both ends are flagged, so the answer does not depend on the drag's way.
    expect(why.get(0)).toBe("slope-diagonal");
    // Level ground: the same diagonal is legal.
    expect(railDragSlopeRefusals(map(["00", "00"]), [[0, 0], [1, 1]]).size).toBe(0);
    // …and the whole gesture says it too (the preview's `why`).
    // (Rail costs 1 Stone a tile, so the preview needs a purse to lay any.)
    const pv = railPreview(g, createTrack(), createRailState(), 1, { stone: 9 }, 0, 0, 2, 2);
    expect(pv.why).toBe("slope-diagonal");
    expect(pv.tiles.length).toBe(0);              // refused on its first tile
  });

  it("needs railRampRun steps of run between two level changes", () => {
    const tiles = (n: number): [number, number][] => Array.from({ length: n }, (_, x) => [x, 0] as [number, number]);
    // Changes at steps 2 and 4: two steps apart — a cliff, not a ramp.
    const tight = railDragSlopeRefusals(map(["001100000000"]), tiles(12));
    expect(tight.get(3)).toBe("too-steep");
    expect(tight.get(4)).toBe("too-steep");
    // Changes at steps 2 and 5: exactly `railRampRun` apart → a ramp.
    expect(railDragSlopeRefusals(map(["001110000000"]), tiles(12)).size).toBe(0);
    // A two-level step is refused outright, ramp or not.
    const cliff = railDragSlopeRefusals(map(["002200000000"]), tiles(12));
    expect(cliff.get(1)).toBe("too-steep");
    expect(cliff.get(2)).toBe("too-steep");
    // The preview stops the drag at the tile the run rule refuses.
    const pv = railPreview(map(["001100000000"]), createTrack(), createRailState(), 1, { stone: 9 }, 0, 0, 8, 0);
    expect(pv.why).toBe("too-steep");
    // The drag stops at the tile before the first of the two changes: only (0,0)
    // is laid, and the run it would need is the reason.
    expect(pv.tiles).toEqual([[0, 0]]);
  });

  it("grades a platform's 1×3 and a rail Depot's 2×2 as one level", () => {
    // A platform along y ("se" = 1 wide × 3 deep) half on a terrace.
    const sloped = map(["011", "111", "000"]);
    expect(platformRefusal(sloped, [], [], 1, 0, 0, "se")).toBe("not-flat");
    expect(footprintFlatTiles(sloped, [[0, 0], [0, 1], [0, 2]])).toEqual([[0, 1]]);
    expect(RAIL_REFUSAL_TEXT["not-flat"]).toMatch(/flat/i);
    // Level ground reaches the anchor rule instead (no factory here).
    expect(platformRefusal(map(), [], [], 1, 0, 0, "se")).not.toBe("not-flat");
    // The rail Depot's 2×2 has the same rule.
    const step = map(["0110", "0000"]);
    expect(depotRefusal(step, createRailState(), 1, 0, 0, "se")).toBe("not-flat");
    expect(depotRefusal(map(), createRailState(), 1, 0, 0, "se")).not.toBe("not-flat");
  });

  it("exempts bridge decks — a drag onto a raised bank is still legal", () => {
    // A two-level land step refuses…
    expect(railDragSlopeRefusals(map(["13", "00"]), [[0, 0], [1, 0]]).get(1)).toBe("too-steep");
    // …but the same step onto WATER is a deck's own approach.
    const river = map(["13", "0~"]);
    expect(railDragSlopeRefusals(river, [[1, 0], [1, 1]], new Set([tIdx(1, 1)])).size).toBe(0);
    expect(roadStepRefusal(river, [1, 0], [1, 1])).toBeNull();
    expect(roadStepOk(river, [1, 0], [1, 1])).toBe(true);
  });

  it("never plans a drag the rules refuse (the rival's own rehearsal)", () => {
    const g = map(["1111100000", "1111100000", "0000000000"]);
    const t = createTrack();
    const rail = createRailState();
    const tiles = planRailRoute(g, t, rail, 1, 1, 1, 6, 1);
    expect(tiles).not.toBeNull();
    expect(validateRailDrag(g, t, rail, 1, tiles!).ok).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("E4 (#268) the flat-footprint rule", () => {
  it("refuses a truck Depot lot straddling a level change", () => {
    const sloped = map(["0110", "0000"]);
    const plan = planDepotPlacement(sloped, [], 0, 0, {});
    expect(plan.code).toBe("not-flat");
    expect(plan.valid).toBe(false);
    expect(plan.why).toMatch(/flat/i);
    // Level ground is judged by the ordinary rules instead.
    expect(planDepotPlacement(map(), [], 0, 0, {}).code).not.toBe("not-flat");
  });

  it("refuses a plant / Factory footprint (and the dam keeps its water half)", () => {
    const track = createTrack();
    const sloped = map(["011", "111", "000"]);
    const eco = { grid: sloped, track, harvesters: [], factories: [] } as unknown as EconomyState;
    expect(plantRefusal(sloped, track, eco, 0, 0)).toBe("not-flat");
    expect(PLANT_REFUSAL_TEXT["not-flat"]).toMatch(/flat/i);
    // A level footprint is judged by the town rule instead.
    expect(plantRefusal(map(), track, eco, 0, 0)).toBe("no-town");
    expect(planFactoryPlacement(sloped, 0, 0, {}).code).toBe("not-flat");
    expect(planFactoryPlacement(map(), 0, 0, {}).code).not.toBe("not-flat");

    // R3 (#270): a dam spans a river whose bank sits a level above the water —
    // the water half is not graded, so the site stays legal.
    const river = map(["111", "~~~", "111"]);
    expect(footprintFlatTiles(river, [[1, 1], [1, 0]])).toBeNull();
    expect(damRefusal(river, [], 1, 1, 1, "n")).toBe("ok");
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("E4 (#268) the climb in the L3 economy", () => {
  it("counts every level as climbTiles extra tiles of distance", () => {
    const up = map(["011"]);
    expect(climbLevels(up, [0, 0], [1, 0])).toBe(1);
    // One level of three tiles: 3 + `climbTiles` tile-equivalents.
    expect(climbTiles(up, [[0, 0], [1, 0], [2, 0]])).toBe(SLOPES.climbTiles);
    expect(routeDistance(up, [[0, 0], [1, 0], [2, 0]])).toBe(3 + SLOPES.climbTiles);
    // Downhill counts too — a loaded lorry pays for the hill either way.
    expect(climbTiles(up, [[2, 0], [1, 0], [0, 0]])).toBe(SLOPES.climbTiles);
    // A level route is exactly its length.
    expect(climbTiles(map(), [[0, 0], [1, 0], [2, 0]])).toBe(0);
    expect(routeDistance(map(), [[0, 0], [1, 0], [2, 0]])).toBe(3);
  });

  it("pays a hill route slower than the same length of flat road", () => {
    // Same road, same ends, same LENGTH: eight tiles in a column. The hill map
    // puts the last four one level up.
    const run = (grid: Grid): { eco: EconomyState; h: Harvester } => {
      const track = createTrack();
      const h = HarvesterAt(1, 10, 10);
      vrun(track, 10, 11, 18, 1);
      return { eco: economy(grid, track, h, 19), h };
    };
    const flat = run(map());
    const hillGrid = map([]);
    for (let y = 15; y <= 18; y++) for (let x = 0; x < MAP_W; x++) hillGrid.height![y * MAP_W + x] = 1;
    const hill = run(hillGrid);

    // The run itself is eight tiles on both maps…
    expect(depotPathLength(flat.eco, flat.h)).toBe(8);
    // …and the hill measures ten: one level climbed = two extra tiles.
    expect(depotPathLength(hill.eco, hill.h)).toBe(8 + SLOPES.climbTiles);
    // Which moves the L3 band, and so the payout the clock makes.
    expect(distanceFactor(flat.eco, flat.h)).toBe(1.0);
    expect(distanceFactor(hill.eco, hill.h)).toBe(0.7);
    expect(depotRate(hill.h, distanceFactor(hill.eco, hill.h)))
      .toBeLessThan(depotRate(flat.h, distanceFactor(flat.eco, flat.h)));
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("E4 (#268) vehicles on a slope", () => {
  it("slows the lorry on the segment it climbs, and only that way", () => {
    const truck = (segClimb: number[], reverse = false, t = 0): TruckState => ({
      trucks: [{
        ownerId: 1, depotId: 1, factory: [2, 0], depot: [0, 0],
        route: [[0, 0], [1, 0], [2, 0]], segClimb,
        leg: 0, t, reverse, waitMs: 0, deliveries: 0,
      } as Truck],
    });
    const dt = 300;                       // a flat segment takes 600 ms
    const flat = truck([0, 0]);
    tickTrucks(flat, dt);
    const up = truck([1, 0]);
    tickTrucks(up, dt);
    expect(flat.trucks[0].t).toBeCloseTo(0.5, 6);
    expect(up.trucks[0].t).toBeCloseTo(0.25, 6);         // half speed uphill
    // The same segment on the way back down is NOT slowed: the grade is signed.
    const down = truck([1, 0], true, 0.5);
    tickTrucks(down, dt);
    expect(down.trucks[0].t).toBeCloseTo(0.5 - 0.5, 6);
  });

  it("slows the train on the segment it climbs, and only when a grid is given", () => {
    const trainState = (): RailState => {
      const st = createRailState();
      st.trains.push({
        id: 1, ownerId: 1, lineId: 1, depotId: 1, status: "moving", target: "dest",
        route: [[0, 0], [1, 0], [2, 0]], dist: 0, planRevision: st.rail.revision,
        dwellMs: 0, dirBit: 2, resold: false,
      });
      return st;
    };
    const dt = 150;                       // RAIL_SPEED = 1/300 tiles/ms
    const flat = trainState();
    tickTrains(flat, dt, map());
    expect(flat.trains[0].dist).toBeCloseTo(0.5, 6);
    const up = trainState();
    tickTrains(up, dt, map(["011", "011"]));
    expect(up.trains[0].dist).toBeCloseTo(0.25, 6);
    // No grid (the pre-#268 call): the old, uniform pace.
    const bare = trainState();
    tickTrains(bare, dt);
    expect(bare.trains[0].dist).toBeCloseTo(0.5, 6);
  });

  it("pins the shipped speed factor", () => {
    expect(uphillSpeed(0)).toBe(1);
    expect(uphillSpeed(1)).toBe(0.5);
    expect(uphillSpeed(2)).toBeCloseTo(1 / 3, 6);
    expect(uphillSpeed(-1)).toBe(1);      // downhill is never a bonus
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("E4 (#268) the rival prices the climb", () => {
  it("charges COST_SLOPE for a level and refuses the steeper step outright", () => {
    const g = map(["1111111111", "0000000000", "0011111000", "0000000000", "1111111111"]);
    const t = createTrack();
    expect(stepCost(g, t, "dirt", 2, 2, 0, [1, 2])).toBeCloseTo(1 + COST_SLOPE, 6);
    expect(stepCost(g, t, "dirt", 2, 1, 0, [1, 1])).toBe(1);          // flat
    expect(stepCost(g, t, "dirt", 2, 1, 0)).toBe(1);                  // no step given
    const cliff = map(["00222", "00222", "00222"]);
    expect(stepCost(cliff, t, "dirt", 2, 0, 0, [1, 0])).toBe(IMPASSABLE);
  });

  it("lays the flat route: a ridge line is shorter but the climb prices it out", () => {
    const rows = ["1111111111", "0000000000", "0011111000", "0000000000", "1111111111"];
    const g = map(rows);
    const t = createTrack();
    // Straight over the ridge (y=2, x=0..8): 8 tiles, two level changes — the
    // climb adds `2 × COST_SLOPE` on top of the eight tile prices.
    let ridge = 0;
    for (let x = 1; x <= 8; x++) ridge += stepCost(g, t, "dirt", x, 2, 0, [x - 1, 2]);
    expect(ridge).toBeCloseTo(8 + 2 * COST_SLOPE, 6);
    // On a flat map the same ridge line is the cheapest route: 8 < the 10-step
    // detour that goes around it (two extra steps off and back onto y=2).
    expect(findPath(map(rows.map((r) => r.replace(/1/g, "0"))), t, "dirt", 0, 2, 8, 2)!.cost)
      .toBeCloseTo(8, 6);
    // With the climb priced, 8 + 2 × 1.5 = 11 > 10 — the planner takes the flat
    // corridor and its cost carries no climb at all.
    const path = findPath(g, t, "dirt", 0, 2, 8, 2);
    expect(path).not.toBeNull();
    expect(path!.cost).toBeCloseTo(10, 6);
    // …and it never touches the ridge itself (the two endpoints excepted).
    const onRidge = (x: number, y: number) => y === 2 && x >= 2 && x <= 6;
    expect(path!.tiles.some(([x, y]) => onRidge(x, y))).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("E4 (#268) the option-off map is untouched", () => {
  it("answers null/0/1 everywhere the rules would speak", () => {
    const flat = optionOff();
    expect(roadStepRefusal(flat, [0, 0], [1, 1])).toBeNull();
    expect(roadStepOk(flat, [0, 0], [1, 1])).toBe(true);
    expect(climbLevels(flat, [0, 0], [1, 1])).toBe(0);
    expect(climbTiles(flat, [[0, 0], [1, 1]])).toBe(0);
    expect(routeDistance(flat, [[0, 0], [1, 1]])).toBe(2);
    expect(footprintFlatTiles(flat, [[0, 0], [1, 1]])).toBeNull();
    expect(railDragSlopeRefusals(flat, [[0, 0], [1, 1]]).size).toBe(0);
    expect(stepCost(flat, createTrack(), "dirt", 3, 0, 0, [2, 0])).toBe(1);
  });

  it("measures the tiles it always did, and previews the same drag", () => {
    const t = createTrack();
    const h = HarvesterAt(1, 10, 10);
    const flat = optionOff();
    vrun(t, 10, 11, 18, 1);
    const eco = economy(flat, t, h, 19);
    expect(depotPathLength(eco, h)).toBe(8);          // the L3 tile count, unchanged
    const a = previewDrag(optionOff(), t, "dirt", {}, 0, 0, 4, 0);
    const b = previewDrag(map(), t, "dirt", {}, 0, 0, 4, 0);
    expect(a.tiles).toEqual(b.tiles);
    expect(a.tiles.length).toBe(5);
    expect(a.truncated).toBe(false);
  });
});
