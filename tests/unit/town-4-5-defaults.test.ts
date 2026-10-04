// ══════════════════════════════════════════════════════════════════════════
// TOWN-4.5 (#681) — the ambient-traffic half: a per-town CAP on ambient cars.
//
// The epic's planned towns (4.3/4.4) are several times the size of a grid
// town. A town's size feeds `townTrafficWeight`, the ambient car budget is
// the sum of the weights, and more cars is more PCU in the traffic field —
// the very thing `traffic-income.ts` folds into a depot's income
// (`trafficFactorOf`). So "bigger towns must not slow lorries" needs a
// ceiling, and the ticket fixes the number: today's tier-3 grid town.
//
// MEASURED, 2026-10-04, on the standard 144 map with every town at tier 3
// (`level` 3 = `TOWN_VISUAL_MAX`), seeds 1…60:
//
//   biggest tier-3 grid town   26.845  (seed 1: 169 houses / 216 roads)
//   other tier-3 towns         19.50 … 26.85
//   tier-3 villages             6.74 … 10.07
//   a planned-scale town       ~41.5   (600 houses / 240 roads at tier 3 —
//                                      the epic's 30–40 × 20–28 tile city)
//   4 planned towns            166.2   → 96 cars (CAR_HARD_CAP) un-capped
//
// PINNED: `TOWN_AMBIENT_CAR_CAP = 26.845` — the heaviest measured grid town.
// Because the cap is the measured MAXIMUM, no grid town is ever capped, so
// every boot that exists today budgets exactly the cars it always did (the
// "every other boot path unchanged" rule). A planned town gets exactly the
// heaviest grid town's cars and not one more.
//
// WHAT THIS FILE DOES NOT COVER (say it here, the lead reads the PR):
//   • planned towns themselves — the generator is TOWN-4.3/4.4's. Here a
//     planned town is a TOWN RECORD at planned size, which is exactly what
//     the cap reads.
//   • the flow's own BACKGROUND demand near a town (`townWeight` in
//     flow/index.ts) also scales with town size and is NOT capped by this
//     ticket (that file is outside #681's list). Measured on the same towns:
//     grid 6.04 vs planned 8.90 in flow's units — worth a follow-up before
//     the epic's balance pass, because the background is the dominant term
//     on a town street.
// ══════════════════════════════════════════════════════════════════════════
import { beforeEach, describe, expect, it } from "vitest";
import {
  CAR_HARD_CAP, TOWN_AMBIENT_CAR_CAP,
  ambientCarBudget, townCarWeight, townTrafficWeight, type TownTrafficShape,
} from "../../src/iso/ambience";
import { CAR_COUNT, planCars } from "../../src/iso/cars";
import { buildTile, createTrack, setRoadTier, ROAD_TIER, type Track } from "../../src/iso/track";
import { generateMap, type Grid } from "../../src/iso/grid";
import {
  DEFAULT_FLOW_CONFIG, createFlowState, observePose, rebuildFlow, setSource, stepFlow, tileFactor,
} from "../../src/iso/flow/flow-core";
import { clearTrafficSamples, noteTrafficSample, trafficFactorOf } from "../../src/iso/traffic-income";

/** The epic's tier-3 planned city, as the traffic reads it: houses + streets. */
const PLANNED_TOWN: TownTrafficShape = { houses: Array(600), roads: Array(240), level: 3 };
/** Measured seed 1 (standard map): the heaviest tier-3 grid town. */
const GRID_CAP_TOWN: TownTrafficShape = { houses: Array(169), roads: Array(216), level: 3 };
/** The three villages the mixed-map case seats beside the planned city. */
const VILLAGE: TownTrafficShape = { houses: Array(100), roads: Array(135), level: 0 };

const setLevel = (g: Grid, level: number | undefined): void => {
  for (const t of g.towns) {
    if (level === undefined) delete (t as { level?: number }).level;
    else t.level = level;
  }
};

/** The PRE-TOWN-4.5 budget: the raw weights, summed. The pin is that this
 *  still equals `ambientCarBudget` for every map that exists today. */
const uncappedBudget = (towns: readonly TownTrafficShape[]): number =>
  Math.min(CAR_HARD_CAP, Math.max(1, Math.round(
    towns.reduce((sum, t) => sum + townTrafficWeight(t), 0),
  )));

/** The car budget's own allocation rule (see `planCars`' weighting): a town's
 *  share of the map's cars, whole cars. */
function carsPerTown(towns: readonly TownTrafficShape[], capped = true): number[] {
  const w = towns.map((t) => (capped ? townCarWeight(t) : townTrafficWeight(t)));
  const budget = capped ? ambientCarBudget(towns) : uncappedBudget(towns);
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((x) => Math.round((budget * x) / sum));
}

describe("TOWN-4.5 the pin: today's heaviest tier-3 grid town", () => {
  it("is the measured number, and no tier-3 grid town reaches it", () => {
    // The measurement above, in one line a reviewer can re-run: the cap IS the
    // heaviest grid town's weight, exactly — not a rounded copy of it.
    expect(TOWN_AMBIENT_CAR_CAP).toBe(townTrafficWeight(GRID_CAP_TOWN));

    let heaviest = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const g = generateMap(seed, {});
      setLevel(g, 3);
      for (const t of g.towns) heaviest = Math.max(heaviest, townTrafficWeight(t));
    }
    // Seed 1's capital is the pin; nothing in the sweep is over it, so no
    // grid town is ever clamped and `townCarWeight` is a no-op for grid maps.
    expect(heaviest).toBe(TOWN_AMBIENT_CAR_CAP);
    for (const t of [GRID_CAP_TOWN, VILLAGE]) {
      expect(townCarWeight(t)).toBe(Math.min(TOWN_AMBIENT_CAR_CAP, townTrafficWeight(t)));
    }
  });

  it("leaves today's budgets alone: capped == uncapped on every boot path we ship", () => {
    for (const seed of [1, 7, 42, 1337]) {
      for (const level of [undefined, 0, 3] as const) {
        const g = generateMap(seed, {});
        setLevel(g, level);
        // The grid map is unchanged: story chapters, scenarios, the Starter
        // Island and old saves all sit inside this range too (fewer houses,
        // lower tiers), so none of them moves either.
        expect(ambientCarBudget(g.towns), `seed ${seed} level ${level}`)
          .toBe(uncappedBudget(g.towns));
      }
    }
    // The game's floor still applies on top (`carBudget` in game.ts): a small
    // map budgets under it and boots at the shipped CAR_COUNT, exactly as it
    // did before the cap.
    const quiet = [{ houses: Array(4), roads: Array(6), level: 0 }];
    expect(uncappedBudget(quiet)).toBeLessThan(CAR_COUNT);
    expect(Math.max(CAR_COUNT, ambientCarBudget(quiet))).toBe(CAR_COUNT);
  });
});

describe("TOWN-4.5 a planned town asks for today's biggest grid town — no more", () => {
  it("clamps the planned town's car weight to the grid town's, exactly", () => {
    // Un-capped, the planned scale is ~1.5× the heaviest grid town...
    expect(townTrafficWeight(PLANNED_TOWN)).toBeGreaterThan(TOWN_AMBIENT_CAR_CAP);
    // ...and the cap makes the two identical: the same cars, not one more.
    expect(townCarWeight(PLANNED_TOWN)).toBe(TOWN_AMBIENT_CAR_CAP);
    expect(townCarWeight(PLANNED_TOWN)).toBe(townCarWeight(GRID_CAP_TOWN));
    // A LARGER planned town cannot lift its own ceiling either.
    expect(townCarWeight({ houses: Array(1200), roads: Array(400), level: 3 }))
      .toBe(TOWN_AMBIENT_CAR_CAP);
    // Pedestrians keep the raw weight — walkers never touch the traffic field.
    expect(townTrafficWeight(PLANNED_TOWN)).toBeGreaterThan(townCarWeight(PLANNED_TOWN));
  });

  it("keeps a map of four planned towns at today's worst-case car budget", () => {
    const planned = [0, 1, 2, 3].map(() => PLANNED_TOWN);
    // Today's worst standard map already saturates CAR_HARD_CAP (seeds 1 and
    // 42 at tier 3), so a planned map can be no busier than that...
    expect(uncappedBudget(planned)).toBe(CAR_HARD_CAP);
    expect(ambientCarBudget(planned)).toBe(CAR_HARD_CAP);
    // ...and, per town, against the real seed-1 standard map at tier 3, the
    // planned cities carry LESS than its capital did (24 vs 26): the cap
    // holds, with the map's four towns all wanting the ceiling.
    const real = generateMap(1, {});
    setLevel(real, 3);
    const cars = carsPerTown(planned);
    const gridCars = carsPerTown(real.towns);
    expect(cars).toEqual([24, 24, 24, 24]);
    expect(Math.max(...cars)).toBeLessThan(Math.max(...gridCars));
    expect(cars.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(CAR_HARD_CAP);
  });

  it("cuts a lone planned city on a village map from the un-capped 42 cars to 27", () => {
    const mixed = [PLANNED_TOWN, VILLAGE, VILLAGE, VILLAGE];
    const capped = carsPerTown(mixed);
    const uncapped = carsPerTown(mixed, false);
    // The un-capped rule is what the ticket exists to stop: a planned city
    // takes 42 of the map's 96 cars (its raw weight is 63% of the sum).
    expect(uncapped[0]).toBe(42);
    expect(ambientCarBudget(mixed)).toBeLessThan(uncappedBudget(mixed));
    // With the cap it is held at today's tier-3 count (26.845 fits 26 whole
    // cars, and the share rounds to 27 — the grid capital's own number).
    expect(capped[0]).toBeLessThan(uncapped[0]);
    expect(capped[0]).toBeLessThanOrEqual(Math.ceil(TOWN_AMBIENT_CAR_CAP));
  });
});

describe("TOWN-4.5 the planner starts trips by the capped weight", () => {
  /** Two towns — a village and a planned-scale city — on two paved streets. */
  function twoTownFixture(): { track: Track; grid: Grid } {
    const track = createTrack();
    const villageRoads: [number, number][] = [[10, 10], [11, 10]];
    const cityRoads: [number, number][] = [];
    for (let x = 20; x <= 40; x++) cityRoads.push([x, 20]);
    const link: [number, number][] = [];
    for (let x = 12; x <= 19; x++) link.push([x, 10]);
    const all = [...villageRoads, ...cityRoads, ...link];
    for (const [x, y] of all) buildTile(track, "road", x, y, 1);
    for (const [x, y] of all) setRoadTier(track, x, y, ROAD_TIER.street);
    const grid = {
      w: 144, h: 144, seed: 1,
      terrain: new Uint8Array(144 * 144),
      occupancy: new Int16Array(144 * 144).fill(-1),
      industries: [],
      towns: [
        { id: 0, tx: 11, ty: 10, houses: [[10, 11], [11, 11]], roads: villageRoads, level: 0 },
        { id: 1, tx: 30, ty: 20, houses: Array.from({ length: 600 }, (_, i) => [21 + (i % 20), 21 + (i % 5)] as [number, number]), roads: cityRoads, level: 3 },
      ],
    } as unknown as Grid;
    return { track, grid };
  }

  function cityTrips(houses: number): { city: number; total: number } {
    const { track, grid } = twoTownFixture();
    (grid.towns[1] as { houses: unknown[] }).houses = Array(houses);
    let city = 0, total = 0;
    for (let seed = 1; seed <= 12; seed++) {
      for (const car of planCars(track, grid, [], 96, seed)) {
        total++;
        if (car.originTownId === 1) city++;
      }
    }
    return { city, total };
  }

  it("a town TWICE the size gets exactly the same cars (the cap is the ceiling)", () => {
    const planned = cityTrips(600);
    const bigger = cityTrips(1200);
    expect(planned.total).toBeGreaterThan(0);
    // Same capped weight → same weighted draw → the identical trip list. If
    // cars.ts ever goes back to the raw weight this goes red (1200 houses
    // would take the lion's share).
    expect(bigger.city).toBe(planned.city);
    expect(bigger.total).toBe(planned.total);
    // And the capped share is below what the raw weight would have asked for
    // (26.845 / (26.845 + village) vs 41.54 / (41.54 + village)).
    const cappedShare = cityTrips(600).city / cityTrips(600).total;
    const rawShare = townTrafficWeight({ houses: Array(600), roads: Array(21), level: 3 })
      / (townTrafficWeight({ houses: Array(600), roads: Array(21), level: 3 })
        + townTrafficWeight({ houses: Array(2), roads: Array(2), level: 0 }));
    expect(cappedShare).toBeLessThan(rawShare);
  });
});

describe("TOWN-4.5 the traffic-income guard: planned never slows a lorry more", () => {
  /**
   * The congestion factor the flow holds on a town street carrying `cars` —
   * the real `tileFactor` the truck hook multiplies a lorry's speed by (and
   * the ratio `tickTrucks` folds into `trafficFactorOf`).
   *
   * The cars are spread one per street tile over the town's busiest stretch,
   * the way a town's cars bunch on its main street, on a `ROAD_TIER.street`
   * surface (capacity 4 in flow's `capacityOf`, which is what a town's own
   * streets get).
   */
  function townStreetFactor(cars: number, tiles = 26, cap = 4): number {
    const W = 144;
    const s = createFlowState({ incidents: false, rushAmplitude: 0 });
    const street: [number, number][] = [];
    for (let k = 0; k < tiles; k++) street.push([10 + (k % 30), 10 + Math.floor(k / 30)]);
    const graph = new Map<number, number[]>();
    const idx = (x: number, y: number) => y * W + x;
    street.forEach(([x, y], k) => {
      const arms: number[] = [];
      if (k > 0) arms.push(idx(street[k - 1][0], street[k - 1][1]));
      if (k < street.length - 1) arms.push(idx(street[k + 1][0], street[k + 1][1]));
      graph.set(idx(x, y), arms);
    });
    rebuildFlow(s, {
      mapW: W, mapH: W, seed: 1, graph, junctions: new Map(), towns: [],
      capacityOf: () => cap, corridorOf: () => 0,
    });
    const cfg = DEFAULT_FLOW_CONFIG;
    const obs: Parameters<typeof setSource>[2] = [];
    for (let i = 0; i < cars; i++) {
      const at = (i * (street.length - 1)) / cars;
      const leg = Math.min(street.length - 2, Math.floor(at));
      observePose(obs, W, street, leg, at - leg, cfg.carPcu);
    }
    setSource(s, "cars", obs);
    for (let step = 0; step < 40; step++) stepFlow(s, 100);   // settle (τ = 1.5 s)
    return tileFactor(s, idx(street[0][0], street[0][1]), cfg.truckPcu);
  }

  beforeEach(() => clearTrafficSamples());

  it("holds the factor at or above the grid town's, and only the cap keeps it there", () => {
    // One town, one street, one comparison: the same town the cap was
    // measured on, at today's grid cars, at the planned town's capped cars,
    // and at what the un-capped weight would have asked for.
    const gridCars = carsPerTown([GRID_CAP_TOWN])[0];                    // 27
    const plannedCars = carsPerTown([PLANNED_TOWN])[0];                  // 27
    const uncappedPlannedCars = carsPerTown([PLANNED_TOWN], false)[0];   // 42
    expect(gridCars).toBe(Math.ceil(TOWN_AMBIENT_CAR_CAP));
    expect(uncappedPlannedCars).toBe(42);
    expect(uncappedPlannedCars).toBeGreaterThan(gridCars);
    expect(plannedCars).toBeLessThanOrEqual(gridCars);

    const grid = townStreetFactor(gridCars);
    const planned = townStreetFactor(plannedCars);
    const uncapped = townStreetFactor(uncappedPlannedCars);
    // Fewer cars can never mean less speed: the planned town's factor is at
    // least the grid town's...
    expect(planned).toBeGreaterThanOrEqual(grid);
    // ...and the un-capped load is strictly worse, which is the drop the cap
    // prevents (small at today's volumes — the flow's background dominates —
    // but it is the guarded direction and it grows with the car count).
    expect(uncapped).toBeLessThan(grid);

    // The same two factors through the REAL traffic-income EMA — the number
    // `trafficScaledHaul` multiplies a depot's haul factor by.
    for (let i = 0; i < 400; i++) {
      noteTrafficSample(1, grid, 100);
      noteTrafficSample(2, planned, 100);
      noteTrafficSample(3, uncapped, 100);
    }
    expect(trafficFactorOf(2)).toBeGreaterThanOrEqual(trafficFactorOf(1));
    expect(trafficFactorOf(3)).toBeLessThan(trafficFactorOf(1));
    // The EMA is still easing toward the sample (τ = 20 s, 40 s of samples),
    // so it sits between the sample and 1 — heading the right way.
    expect(trafficFactorOf(2)).toBeGreaterThanOrEqual(planned);
    expect(trafficFactorOf(2)).toBeLessThanOrEqual(1);
  });

  it("a map of planned towns cannot put more PCU in the field than today's worst", () => {
    const planned = [PLANNED_TOWN, PLANNED_TOWN, PLANNED_TOWN, PLANNED_TOWN];
    const gridWorst = [GRID_CAP_TOWN, GRID_CAP_TOWN, GRID_CAP_TOWN, GRID_CAP_TOWN];
    // The map-wide car count IS the map-wide PCU source (\`flowObserveCars\`),
    // and lorries feel it on the shared roads between towns.
    expect(ambientCarBudget(planned)).toBeLessThanOrEqual(ambientCarBudget(gridWorst));
    expect(ambientCarBudget(planned)).toBeLessThanOrEqual(CAR_HARD_CAP);
    // Per town too: the epic's four planned cities each carry no more than
    // today's grid capital, and the four of them together never exceed 96.
    const cars = carsPerTown(planned);
    expect(Math.max(...cars)).toBeLessThanOrEqual(carsPerTown(gridWorst)[0]);
    expect(cars.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(CAR_HARD_CAP);
    // Guarding the guard: the same four towns on the RAW weight would have
    // asked for 96 cars each town's share of a hard-capped map — i.e. the
    // budget saturates either way, but the per-town share is what the cap
    // holds today (24 ≤ today's 26).
    expect(carsPerTown(planned, false)[0]).toBeGreaterThanOrEqual(cars[0]);
  });
});
