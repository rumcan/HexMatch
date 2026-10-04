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
//     the caps read.
//   • (#681's follow-up folded this in, so it IS covered below:) the flow's
//     own BACKGROUND demand near a town (`townWeight` in flow/index.ts)
//     also scales with town size — grid 6.04 vs planned 8.90 in flow's
//     units — and is capped at the heaviest grid town by the same rule.
// ══════════════════════════════════════════════════════════════════════════
// TOWN-4.5 (#681) — the REST of the ticket: ship planned towns as the
// new-game default (a large, planned map for new free-play games), the flow
// background cap above, and the gameplay/balance guard (catchment,
// contracts, the rival's opening, generation time).
//
// The contract, in one paragraph: a NEW free-play game boots large (216) +
// planned; EVERY other boot path — story, scenarios, the Starter Island, the
// tutorial, a resumed save, an old room — boots exactly what it always did.
// Old records name no size/layout and resolve to the pinned LEGACY map
// (standard + organic outside the runner, grid under it); new rooms carry
// the size + layout explicitly so both seats agree. The menu (solo Play
// screen + hosted lobby) shows the two dials and persists them — the save's
// map record carries them, which the boot-harness half of this ticket pins
// in town-4-1-large-boot.test.ts (node cannot boot the game).
// ══════════════════════════════════════════════════════════════════════════
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAR_HARD_CAP, TOWN_AMBIENT_CAR_CAP,
  ambientCarBudget, townCarWeight, townTrafficWeight, type TownTrafficShape,
} from "../../src/iso/ambience";
import { CAR_COUNT, planCars } from "../../src/iso/cars";
import { buildTile, createTrack, setRoadTier, ROAD_TIER, type Track } from "../../src/iso/track";
import {
  canPlaceFactory, factoryFootprintOf, generateMap, startingTownReservations,
  type Grid, type Industry, type Town,
} from "../../src/iso/grid";
import {
  DEFAULT_FLOW_CONFIG, createFlowState, observePose, rebuildFlow, setSource, stepFlow, tileFactor,
} from "../../src/iso/flow/flow-core";
import { clearTrafficSamples, noteTrafficSample, trafficFactorOf } from "../../src/iso/traffic-income";
import { MAP_SIZES, mulberry32, releaseMapSize, setMapSize } from "../../src/game/config";
import {
  MAP_OPTIONS_OFF, MAP_OPTIONS_ON, resolveMapSize, resolveTownLayout,
} from "../../src/iso/map-options";
import {
  DEFAULT_MATCH_SETTINGS, defaultMapSize, defaultMatchSettings, defaultRoomTownLayout,
  defaultTownLayout, describeMatchSettings, isDefaultMatchSettings, loadMatchSettings,
  normalizeMatchSettings, type MatchSettings, type TownLayout,
} from "../../src/net/match-settings";
import {
  defaultNewGameMap, loadNewGameMap, saveNewGameMap,
} from "../../src/ui/new-game-map";
import { FLOW_TOWN_WEIGHT_CAP, flowTownWeight, townWeight } from "../../src/iso/flow";
import { contractOffers, type ContractView } from "../../src/iso/quests";
import {
  industriesInCatchment, isServiced, type EconomyState, type Factory,
} from "../../src/iso/economy";
import { aiBuildStep, chooseRivalFactorySpot, harvesterSpots } from "../../src/iso/ai";
import { FREE_SETUP_DEPOTS } from "../../src/iso/construction";

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

// ══════════════════════════════════════════════════════════════════════════
// TOWN-4.5 (#681) — the new-game default: a large (216), planned map.
// ══════════════════════════════════════════════════════════════════════════
describe("TOWN-4.5 a new free-play game boots large + planned", () => {
  it("resolves the shipped default outside the runner, grid + standard under it", () => {
    // Under the unit-test runner nothing moves: the seed-pinned suites keep
    // their 144 grid maps.
    expect(resolveTownLayout({})).toBe("grid");
    expect(resolveMapSize({})).toBe("standard");
    expect(defaultTownLayout()).toBe("grid");
    expect(defaultMapSize()).toBe("standard");
    vi.stubEnv("MODE", "production");
    try {
      expect(resolveTownLayout({})).toBe("planned");
      expect(resolveMapSize({})).toBe("large");
      expect(defaultTownLayout()).toBe("planned");
      expect(defaultMapSize()).toBe("large");
    } finally { vi.unstubAllEnvs(); }
  });

  it("a new game's URL params still win, both sizes and all three plans", () => {
    vi.stubEnv("MODE", "production");
    try {
      expect(resolveTownLayout({ search: "?layout=grid" })).toBe("grid");
      expect(resolveTownLayout({ search: "?layout=organic" })).toBe("organic");
      expect(resolveTownLayout({ search: "?layout=planned" })).toBe("planned");
      expect(resolveMapSize({ search: "?size=standard" })).toBe("standard");
      expect(resolveMapSize({ search: "?size=large" })).toBe("large");
      // …and explicit (tests, debug boots, the Play screen's remembered map)
      // outranks the URL.
      expect(resolveTownLayout({ explicit: { layout: "grid" }, search: "?layout=organic" })).toBe("grid");
      expect(resolveMapSize({ explicit: { size: "standard" }, search: "?size=large" })).toBe("standard");
    } finally { vi.unstubAllEnvs(); }
  });

  it("tuned places keep grid + standard: story, scenarios, the Starter record", () => {
    vi.stubEnv("MODE", "production");
    try {
      expect(resolveTownLayout({ story: {} })).toBe("grid");
      expect(resolveMapSize({ story: {} })).toBe("standard");
      expect(resolveTownLayout({ scenario: {} })).toBe("grid");
      expect(resolveMapSize({ scenario: {} })).toBe("standard");
      // A chapter that names a plan/size still gets it (none does today).
      expect(resolveTownLayout({ story: { mapOptions: { layout: "planned" } } })).toBe("planned");
      expect(resolveMapSize({ story: { mapOptions: { size: "large" } } })).toBe("large");
    } finally { vi.unstubAllEnvs(); }
  });

  it("a resumed save keeps the plan + size it was generated with", () => {
    vi.stubEnv("MODE", "production");
    try {
      // A save from the new default, and one from each legacy shape.
      expect(resolveTownLayout({ save: { map: { layout: "planned" } } })).toBe("planned");
      expect(resolveMapSize({ save: { map: { size: "large" } } })).toBe("large");
      expect(resolveTownLayout({ save: { map: { layout: "organic" } } })).toBe("organic");
      expect(resolveMapSize({ save: { map: { size: "standard" } } })).toBe("standard");
      expect(resolveTownLayout({ save: { map: { layout: "grid" } } })).toBe("grid");
      // A pre-TOWN-2/4.1 save (no keys at all) regenerates grid + standard.
      expect(resolveTownLayout({ save: { map: {} } })).toBe("grid");
      expect(resolveMapSize({ save: { map: {} } })).toBe("standard");
      // A URL never re-terrains a resumed save.
      expect(resolveTownLayout({ save: { map: { layout: "grid" } }, search: "?layout=planned" })).toBe("grid");
      expect(resolveMapSize({ save: { map: { size: "standard" } }, search: "?size=large" })).toBe("standard");
    } finally { vi.unstubAllEnvs(); }
  });
});

describe("TOWN-4.5 rooms: new rooms play the default, old rooms never re-terrain", () => {
  it("a room that names no layout/size plays the legacy map (organic + standard)", () => {
    vi.stubEnv("MODE", "production");
    try {
      // Every pre-4.5 room record has this shape: settings, but no map (or a
      // map from before the keys existed). It plays what it always did.
      expect(resolveTownLayout({ room: {} })).toBe("organic");
      expect(resolveMapSize({ room: {} })).toBe("standard");
      expect(resolveTownLayout({ room: { map: { ...MAP_OPTIONS_ON } } })).toBe("organic");
      expect(resolveMapSize({ room: { map: { ...MAP_OPTIONS_ON } } })).toBe("standard");
      // The legacy fallback is pinned by name, next to the new-game default.
      expect(defaultRoomTownLayout()).toBe("organic");
      expect(defaultTownLayout()).toBe("planned");
    } finally { vi.unstubAllEnvs(); }
    // Under the runner the legacy map is what the suites were written on.
    expect(resolveTownLayout({ room: {} })).toBe("grid");
    expect(resolveMapSize({ room: {} })).toBe("standard");
  });

  it("a new room carries large + planned explicitly, so both seats agree", () => {
    const fresh = defaultMatchSettings();
    expect(fresh.map?.size).toBe(defaultMapSize());
    expect(fresh.map?.layout).toBe(defaultTownLayout());
    vi.stubEnv("MODE", "production");
    try {
      const prod = defaultMatchSettings();
      expect(prod.map?.size).toBe("large");
      expect(prod.map?.layout).toBe("planned");
      // ...and a room holding that record resolves it on either seat (a
      // guest's URL cannot split the seats).
      expect(resolveTownLayout({ room: prod, search: "?layout=grid" })).toBe("planned");
      expect(resolveMapSize({ room: prod, search: "?size=standard" })).toBe("large");
      // The host's dials can still pick every combination.
      for (const layout of ["grid", "organic", "planned"] as const) {
        for (const size of ["standard", "large"] as const) {
          const room: MatchSettings = {
            ...prod, map: { ...MAP_OPTIONS_OFF, layout, size },
          };
          expect(resolveTownLayout({ room })).toBe(layout);
          expect(resolveMapSize({ room })).toBe(size);
        }
      }
    } finally { vi.unstubAllEnvs(); }
  });

  it("the wire reader never fills a map; the host's stored record always has one", () => {
    // The WIRE must not migrate: an old room's map-less record crosses the
    // room exactly as stored, and resolves to the legacy map on arrival.
    expect(normalizeMatchSettings({})!.map).toBeUndefined();
    expect(normalizeMatchSettings({ winTarget: 15 })!.map).toBeUndefined();
    expect(normalizeMatchSettings(DEFAULT_MATCH_SETTINGS)!.map).toBeUndefined();
    // ...while the HOST's last-used record always comes back complete — a
    // map-less stored block (every record stored before this ticket, when the
    // lobby had no map dials) gets today's defaults for exactly the keys it
    // does not name, so a new room plays the default map on both seats.
    const stored = (v: unknown) => loadMatchSettings({ getItem: () => JSON.stringify(v) });
    const migrated = stored({ aiSeats: [], winTarget: 10, startPurse: { wood: 12, stone: 12, ore: 0 } });
    expect(migrated.map?.size).toBe(defaultMapSize());
    expect(migrated.map?.layout).toBe(defaultTownLayout());
    // A host who CHOSE a map keeps it — migration only fills absent keys.
    const chosen = stored({
      aiSeats: [], winTarget: 10, startPurse: { wood: 12, stone: 12, ore: 0 },
      map: { ...MAP_OPTIONS_OFF, layout: "grid", size: "standard" },
    });
    expect(chosen.map?.layout).toBe("grid");
    expect(chosen.map?.size).toBe("standard");
    // And the baseline the ladder reads against stays map-less and default.
    expect("map" in DEFAULT_MATCH_SETTINGS).toBe(false);
    expect(isDefaultMatchSettings(DEFAULT_MATCH_SETTINGS)).toBe(true);
    expect(isDefaultMatchSettings(defaultMatchSettings())).toBe(true);
  });

  it("names the map in the room's one-line rules", () => {
    const line = (map: MatchSettings["map"]) =>
      describeMatchSettings({ ...DEFAULT_MATCH_SETTINGS, map });
    // Large keeps printing now that it is the default — a guest should still
    // hear the map is big, and an old standard room reads audibly different.
    expect(line({ ...MAP_OPTIONS_ON, size: "large", layout: "planned" })).toContain("Large map");
    expect(line({ ...MAP_OPTIONS_ON, size: "standard", layout: "planned" })).not.toContain("map");
    // A non-default town plan is named; planned (or absent) says nothing.
    expect(line({ ...MAP_OPTIONS_ON, size: "standard", layout: "organic" })).toContain("Organic towns");
    expect(line({ ...MAP_OPTIONS_ON, size: "standard", layout: "grid" })).toContain("Grid towns");
    expect(line({ ...MAP_OPTIONS_ON, size: "standard", layout: "planned" })).not.toContain("towns");
    expect(line({ ...MAP_OPTIONS_ON })).not.toContain("towns");
    expect(line(undefined)).not.toContain("towns");
  });
});

describe("TOWN-4.5 the solo menu remembers its map", () => {
  /** A short-lived in-memory Storage, so the persistence path is really run. */
  function fakeStorage(initial: Record<string, string> = {}) {
    const map = new Map<string, string>(Object.entries(initial));
    return {
      getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
      setItem: (key: string, value: string) => { void map.set(key, value); },
    };
  }

  it("defaults to the shipped new-game map, and round-trips a choice", () => {
    expect(defaultNewGameMap()).toEqual({ size: defaultMapSize(), layout: defaultTownLayout() });
    expect(loadNewGameMap(fakeStorage())).toEqual(defaultNewGameMap());
    expect(loadNewGameMap(null)).toEqual(defaultNewGameMap());
    const storage = fakeStorage();
    saveNewGameMap({ size: "standard", layout: "grid" }, storage);
    expect(loadNewGameMap(storage)).toEqual({ size: "standard", layout: "grid" });
    saveNewGameMap({ size: "large", layout: "planned" }, storage);
    expect(loadNewGameMap(storage)).toEqual({ size: "large", layout: "planned" });
  });

  it("falls back key by key on a corrupt, hostile or future value", () => {
    const fallback = defaultNewGameMap();
    // Unknown names fall back individually — a stored size survives an
    // unknown layout and vice versa (a future plan must not strand a size).
    expect(loadNewGameMap(fakeStorage({ "hexmatch:new-game-map": JSON.stringify({ size: "large", layout: "round" }) })))
      .toEqual({ size: "large", layout: fallback.layout });
    expect(loadNewGameMap(fakeStorage({ "hexmatch:new-game-map": JSON.stringify({ size: "giant", layout: "grid" }) })))
      .toEqual({ size: fallback.size, layout: "grid" });
    // Corrupt JSON, a non-record, or a store that throws: the default.
    expect(loadNewGameMap(fakeStorage({ "hexmatch:new-game-map": "{not json" }))).toEqual(fallback);
    expect(loadNewGameMap(fakeStorage({ "hexmatch:new-game-map": "null" }))).toEqual(fallback);
    expect(loadNewGameMap(fakeStorage({ "hexmatch:new-game-map": "7" }))).toEqual(fallback);
    const hostile = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };
    expect(loadNewGameMap(hostile)).toEqual(fallback);
    expect(() => saveNewGameMap({ size: "large", layout: "planned" }, hostile)).not.toThrow();
    expect(() => saveNewGameMap({ size: "large", layout: "planned" }, null)).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// TOWN-4.5 (#681, follow-up) — the flow background cap: a planned town
// radiates the heaviest grid town's background demand, never more.
// ══════════════════════════════════════════════════════════════════════════
describe("TOWN-4.5 the flow background is capped at the heaviest grid town", () => {
  /** The epic's tier-3 planned city, as the flow reads it. */
  const FLOW_PLANNED = { houses: Array(600), roads: Array(240), level: 3 };
  /** Measured seed 1 (standard map): the heaviest tier-3 grid town. */
  const FLOW_GRID_MAX = { houses: Array(169), roads: Array(216), level: 3 };

  it("pins the cap at the measured heaviest tier-3 grid town, in flow's units", () => {
    // (1 + √216/6) × (0.7 + 3×0.35) ≈ 6.037 — the pin IS the grid town's
    // weight, exactly, not a rounded copy of it.
    expect(FLOW_TOWN_WEIGHT_CAP).toBe(townWeight(FLOW_GRID_MAX));
    expect(FLOW_TOWN_WEIGHT_CAP).toBeCloseTo(6.037, 3);

    releaseMapSize();
    let heaviest = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const g = generateMap(seed, {});
      setLevel(g, 3);
      for (const t of g.towns) heaviest = Math.max(heaviest, townWeight(t));
    }
    // Seed 1's capital is the pin; nothing in the sweep is over it, so the
    // cap is a no-op for every grid map that exists today...
    expect(heaviest).toBe(FLOW_TOWN_WEIGHT_CAP);
    for (let seed = 1; seed <= 12; seed++) {
      const g = generateMap(seed, {});
      for (const level of [undefined, 0, 3] as const) {
        setLevel(g, level);
        for (const t of g.towns) {
          expect(flowTownWeight(t), `seed ${seed} level ${level} town ${t.id}`)
            .toBe(townWeight(t));
        }
      }
    }
    // ...while the raw planned scale overshoots it (~8.90) and clamps.
    expect(townWeight(FLOW_PLANNED)).toBeGreaterThan(FLOW_TOWN_WEIGHT_CAP);
    expect(townWeight(FLOW_PLANNED)).toBeCloseTo(8.9, 1);
    expect(flowTownWeight(FLOW_PLANNED)).toBe(FLOW_TOWN_WEIGHT_CAP);
    expect(flowTownWeight(FLOW_PLANNED)).toBe(flowTownWeight(FLOW_GRID_MAX));
    // A LARGER planned town cannot lift its own ceiling either.
    expect(flowTownWeight({ houses: Array(1200), roads: Array(400), level: 3 }))
      .toBe(FLOW_TOWN_WEIGHT_CAP);
  });

  /**
   * The congestion factor the flow holds on a town street tile — the real
   * `tileFactor` the truck hook multiplies a lorry's speed by — for a town
   * radiating `weight` over the planned footprint. Same street, same cars,
   * same spread on all three runs: only the radiated weight varies, so any
   * difference is the cap's. Read a dozen tiles out from the centre: right
   * at the centre the background alone floors the factor at minSpeedFactor
   * for ANY town this size, while out here the capped and raw weights sit on
   * the BPR curve's sensitive slope.
   */
  function bgStreetFactor(weight: number): number {
    const W = 144;
    const s = createFlowState({ incidents: false, rushAmplitude: 0 });
    const street: [number, number][] = [];
    for (let k = 0; k < 26; k++) street.push([10 + (k % 30), 10 + Math.floor(k / 30)]);
    const graph = new Map<number, number[]>();
    const idx = (x: number, y: number) => y * W + x;
    street.forEach(([x, y], k) => {
      const arms: number[] = [];
      if (k > 0) arms.push(idx(street[k - 1][0], street[k - 1][1]));
      if (k < street.length - 1) arms.push(idx(street[k + 1][0], street[k + 1][1]));
      graph.set(idx(x, y), arms);
    });
    rebuildFlow(s, {
      mapW: W, mapH: W, seed: 1, graph, junctions: new Map(),
      towns: [{ id: 0, tx: 10, ty: 10, weight, radius: 4 + Math.sqrt(240) * 0.9 }],
      capacityOf: () => 4, corridorOf: () => 0,
    });
    const cfg = DEFAULT_FLOW_CONFIG;
    const obs: Parameters<typeof setSource>[2] = [];
    for (let i = 0; i < 10; i++) {
      const at = (i * (street.length - 1)) / 10;
      const leg = Math.min(street.length - 2, Math.floor(at));
      observePose(obs, W, street, leg, at - leg, cfg.carPcu);
    }
    setSource(s, "cars", obs);
    for (let step = 0; step < 40; step++) stepFlow(s, 100);   // settle (τ = 1.5 s)
    return tileFactor(s, idx(street[12][0], street[12][1]), cfg.truckPcu);
  }

  it("radiates the grid town's factor on a planned street, and only the cap keeps it there", () => {
    const grid = bgStreetFactor(flowTownWeight(FLOW_GRID_MAX));
    const planned = bgStreetFactor(flowTownWeight(FLOW_PLANNED));
    const uncapped = bgStreetFactor(townWeight(FLOW_PLANNED));
    // The street is actually loaded (the comparison is not 1 vs 1 vs 1)...
    expect(grid).toBeLessThan(1);
    // ...the capped planned town holds EXACTLY the grid town's factor (the
    // same radiated weight over the same footprint is the same demand)...
    expect(planned).toBe(grid);
    // ...and the un-capped weight is strictly worse — the drop the cap
    // prevents.
    expect(uncapped).toBeLessThan(grid);
  });

  it("holds traffic income at or above the grid town's through the real EMA", () => {
    clearTrafficSamples();
    const grid = bgStreetFactor(flowTownWeight(FLOW_GRID_MAX));
    const planned = bgStreetFactor(flowTownWeight(FLOW_PLANNED));
    const uncapped = bgStreetFactor(townWeight(FLOW_PLANNED));
    for (let i = 0; i < 400; i++) {
      noteTrafficSample(11, grid, 100);
      noteTrafficSample(12, planned, 100);
      noteTrafficSample(13, uncapped, 100);
    }
    // The number `trafficScaledHaul` multiplies a depot's haul factor by: a
    // planned town earns at least the grid town's income, and would earn less
    // without the cap.
    expect(trafficFactorOf(12)).toBeGreaterThanOrEqual(trafficFactorOf(11));
    expect(trafficFactorOf(13)).toBeLessThan(trafficFactorOf(11));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// TOWN-4.5 (#681) — the gameplay guard, part 1: what a Depot earns and what
// a contract pays does not scale with town size.
// ══════════════════════════════════════════════════════════════════════════
describe("TOWN-4.5 a Depot's catchment reads industries, not town size", () => {
  /** A farm and the Depot lot parked against its east edge. */
  function catchmentFixture(towns: Town[]): { grid: Grid; depot: { id: number; owner: string; ownerId: number; tx: number; ty: number } } {
    const industry: Industry = { id: 0, type: "farm", tx: 10, ty: 10, w: 2, h: 2, output: "grain", banditUntil: 0 };
    const grid = { industries: [industry], towns } as Grid;
    return { grid, depot: { id: 0, owner: "you", ownerId: 1, tx: 12, ty: 10 } };
  }
  /** A town record at grid scale, and the same town at the epic's planned scale. */
  const gridTown = (n: number): Town => ({
    id: 0, tx: 30, ty: 30,
    houses: Array.from({ length: 40 }, () => [30, 30] as [number, number]),
    roads: Array.from({ length: 52 }, () => [31, 31] as [number, number]),
    level: n,
  }) as Town;
  const plannedTown = (n: number): Town => ({
    id: 0, tx: 30, ty: 30,
    houses: Array.from({ length: 600 }, () => [30, 30] as [number, number]),
    roads: Array.from({ length: 240 }, () => [31, 31] as [number, number]),
    level: n,
  }) as Town;

  it("serves the same industries at grid scale and at planned scale, every tier", () => {
    for (const level of [0, 1, 2, 3]) {
      const a = catchmentFixture([gridTown(level)]);
      const b = catchmentFixture([plannedTown(level)]);
      // The lot touches the farm (the fixture is not empty on both sides)...
      expect(industriesInCatchment(a.grid, a.depot).map((i) => i.id)).toEqual([0]);
      // ...and the planned-scale town serves exactly the same industry.
      expect(industriesInCatchment(b.grid, b.depot)).toEqual(industriesInCatchment(a.grid, a.depot));
    }
  });

  it("a bigger town does not pull in a farther industry", () => {
    // A second farm two tiles past the lot's edge: out of reach at BOTH
    // scales (the catchment is the lot's edges, not the town's girth).
    const far: Industry = { id: 1, type: "farm", tx: 16, ty: 10, w: 2, h: 2, output: "grain", banditUntil: 0 };
    for (const towns of [[gridTown(3)], [plannedTown(3)]]) {
      const { grid, depot } = catchmentFixture(towns);
      grid.industries.push(far);
      expect(industriesInCatchment(grid, depot).map((i) => i.id)).toEqual([0]);
    }
  });
});

describe("TOWN-4.5 a contract pays the same values at the same tier, any town size", () => {
  /** Two views that differ ONLY in which map's towns they list. */
  function viewsFor(towns: { id: number; name: string; tx: number; ty: number }[]): ContractView {
    return {
      seed: 7, towns, cargoesRunning: [], depotCount: 1, connected: 1,
      townLevel: 2, townLevels: 2, difficulty: "normal", phase: 0.5, money: 100,
    };
  }
  /** The VALUES a contract pays — everything but the town's name and words. */
  const valuesOf = (defs: ReturnType<typeof contractOffers>) =>
    defs.map((d) => [d.kind, d.cargo, d.amount, d.rewardMoney, d.rewardTown, d.deadlineMs].join("|"));

  it("offers identical values whether the towns are grid or planned scale", () => {
    // The same four-town map at two scales: same tiers, same count, same
    // seed — only the towns' footprints (and names) differ.
    const gridTowns = [0, 1, 2, 3].map((id) => ({ id, name: `Grid ${id}`, tx: 20 * id, ty: 20 * id }));
    const plannedTowns = [0, 1, 2, 3].map((id) => ({ id, name: `Planned ${id}`, tx: 50 * id, ty: 50 * id }));
    const a = contractOffers(viewsFor(gridTowns), mulberry32(5));
    const b = contractOffers(viewsFor(plannedTowns), mulberry32(5));
    expect(a.length).toBeGreaterThan(0);
    expect(valuesOf(b)).toEqual(valuesOf(a));
    // Guarding the guard: the values DO move with difficulty and phase
    // (the only view fields the offers read besides the rng stream), so the
    // comparison above is not vacuous — the offers are alive, just not
    // town-sized.
    const harder = contractOffers({ ...viewsFor(gridTowns), difficulty: "hard", phase: 0.9 }, mulberry32(5));
    expect(valuesOf(harder)).not.toEqual(valuesOf(a));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// TOWN-4.5 (#681) — the gameplay guard, part 2: the new default map plays.
// Four large, planned maps (the ticket's seeds), through the same helpers
// the game itself uses: a factory site per town, a harvester spot per
// industry, two starting reservations, and the rival's real opening.
// ══════════════════════════════════════════════════════════════════════════
describe("TOWN-4.5 the new default map plays: large + planned, seeds 1/7/42/1337", () => {
  afterEach(() => { releaseMapSize(); });
  const SEEDS = [1, 7, 42, 1337];

  function largePlanned(seed: number): Grid {
    releaseMapSize();
    setMapSize(MAP_SIZES.large, MAP_SIZES.large);
    return generateMap(seed, { size: "large", layout: "planned" });
  }

  /** A legal factory site touching `town` (the reservations' own search). */
  function factorySiteBeside(grid: Grid, town: Town): [number, number] | null {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [hx, hy] of [...town.houses, ...town.roads]) {
      minX = Math.min(minX, hx); maxX = Math.max(maxX, hx);
      minY = Math.min(minY, hy); maxY = Math.max(maxY, hy);
    }
    const pad = Math.max(...factoryFootprintOf(grid)) + 2;
    for (let y = minY - pad; y <= maxY + pad; y++) {
      for (let x = minX - pad; x <= maxX + pad; x++) {
        for (const rot of [0, 1]) {
          if (canPlaceFactory(grid, x, y, rot).ok) return [x, y];
        }
      }
    }
    return null;
  }

  it("lays four planned towns, each with a legal factory site beside it", () => {
    for (const seed of SEEDS) {
      const grid = largePlanned(seed);
      expect(grid.towns.length, `seed ${seed} town count`).toBe(4);
      for (const t of grid.towns) {
        expect(t.plan, `seed ${seed} town ${t.id} has no plan`).toBeTruthy();
        expect(factorySiteBeside(grid, t), `seed ${seed} town ${t.id} has no factory site`).not.toBeNull();
      }
    }
  });

  it("leaves every industry with a harvester spot, and two starting reservations", () => {
    for (const seed of SEEDS) {
      const grid = largePlanned(seed);
      expect(grid.industries.length, `seed ${seed} no industries`).toBeGreaterThan(0);
      for (const ind of grid.industries) {
        expect(harvesterSpots(grid, ind).length, `seed ${seed} industry ${ind.id} has no harvester spot`)
          .toBeGreaterThan(0);
      }
      // Two distant towns, each with a legal factory site and a nearby depot
      // site — the seats the game deals the player and the rival.
      expect(startingTownReservations(grid), `seed ${seed} has no starting reservations`).not.toBeNull();
    }
  });

  it("the rival's opening builds a serviced harvester, first turn, on all four", () => {
    for (const seed of SEEDS) {
      const grid = largePlanned(seed);
      // The player's seat: the reservation's town, a legal factory site
      // beside it — the same ground the game's opening placement deals.
      const reservations = startingTownReservations(grid)!;
      const player = factorySiteBeside(grid, reservations[0])!;
      expect(player, `seed ${seed} player has no factory site`).not.toBeNull();
      // The rival's seat, then its first build, on the REAL opening purse.
      const spot = chooseRivalFactorySpot(grid, createTrack(), player, {
        purse: { wood: 12, stone: 12, ore: 0 }, free: 12, ownerId: 2,
      });
      expect(spot, `seed ${seed} rival has no factory spot`).not.toBeNull();
      const eco: EconomyState = {
        grid, track: createTrack(), harvesters: [],
        factories: [{ owner: "ai", ownerId: 2, tx: spot![0], ty: spot![1] } as Factory],
      };
      const out = aiBuildStep(eco, eco.factories[0], {
        stock: { wood: 12, stone: 12, ore: 0 }, purse: { wood: 12, stone: 12, ore: 0 },
        free: 12, freeDepots: FREE_SETUP_DEPOTS,
      }, 1);
      expect(out, `seed ${seed} rival builds nothing`).not.toBeNull();
      expect(out!.built.length, `seed ${seed} rival lays no track`).toBeGreaterThan(0);
      expect(out!.harvester, `seed ${seed} rival places no harvester`).not.toBeNull();
      expect(isServiced(eco.track, out!.harvester!), `seed ${seed} rival harvester unserviced`).toBe(true);
    }
  }, 300_000);

  it("generates in budget: planned costs under 4× the same seed's grid map", () => {
    for (const seed of SEEDS) {
      releaseMapSize();
      setMapSize(MAP_SIZES.large, MAP_SIZES.large);
      const t0 = performance.now();
      generateMap(seed, { size: "large", layout: "grid" });
      const gridMs = performance.now() - t0;
      const t1 = performance.now();
      generateMap(seed, { size: "large", layout: "planned" });
      const plannedMs = performance.now() - t1;
      // A RELATIVE bound, so a loaded runner cannot flake it: the planned
      // checks ride the same floods as the grid map's. (Absolute times are
      // measured in the PR: ~0.6–1.2 s for large+planned locally.)
      expect(
        plannedMs / Math.max(1, gridMs),
        `seed ${seed} planned ${plannedMs.toFixed(0)} ms vs grid ${gridMs.toFixed(0)} ms`,
      ).toBeLessThan(4);
    }
  }, 120_000);
});
