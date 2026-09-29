// ══════════════════════════════════════════════════════════════════════════
// AMB-3 (#392) — cars, pedestrians, traffic lights.
//
// Pinned here, and only here:
//   * delivery ticks are identical with ambience on and off (trucks are drawn
//     held at a light; their economic pose is not)
//   * lights cycle green → amber → red per axis, never both green
//   * town junctions with 3+ connections get a light; a junction outside a
//     town does not
//   * cars hold at red, pedestrians hold at a crossing until the axis is red
//   * cars give way to a truck ahead instead of overlapping it
//   * density rises with town size and city-upgrade tier, and the hard caps
//     and the per-screen caps hold
//   * the same seed rebuilds the same walkers
//   * pedestrians are close-zoom only, cars from medium zoom, everything off
//     in performance mode
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import {
  AMBIENT_ACTOR_CAP, AMBIENT_ART_NEEDED, CAR_HARD_CAP, CAR_MODELS, LIGHT_CYCLE_MS,
  PED_HARD_CAP, SCREEN_CAR_CAP, SCREEN_PED_CAP,
  ambienceVisible, ambientCarBudget, ambientPedBudget, buildSignals, clampBudgets,
  clampToLight, crossingAllowed, createAmbience, holdTForLight, lightAspect, lightPair,
  selectOnScreen, spawnPedestrians, stepGhost, stepPedestrians, tickAmbience,
  tickTruckGhosts, townTrafficWeight,
  type Ped, type SignalMap,
  setAmbientStandIns,
} from "../../src/iso/ambience";
import {
  createCarState, gapToActors, planCars, tickCars,
  type Car, type YieldActor,
} from "../../src/iso/cars";
import { createTruckState, tickTrucks, type Truck } from "../../src/iso/vehicles";
import { createTrack, buildTile, setRoadTier, ROAD_TIER, tIdx, type Track } from "../../src/iso/track";
import type { Grid } from "../../src/iso/grid";

function townGrid(towns: Grid["towns"]): Grid {
  return {
    w: 144, h: 144, seed: 1,
    terrain: new Uint8Array(144 * 144),
    occupancy: new Int16Array(144 * 144).fill(-1),
    industries: [],
    towns,
  } as Grid;
}

function pave(track: Track, tiles: [number, number][], tier = ROAD_TIER.street) {
  for (const [x, y] of tiles) buildTile(track, "road", x, y, 1);
  for (const [x, y] of tiles) setRoadTier(track, x, y, tier);
}

function timeOf(seed: number, townId: number, axis: 0 | 1, aspect: "green" | "amber" | "red"): number {
  for (let t = 0; t < LIGHT_CYCLE_MS * 2; t += 10) {
    if (lightAspect(seed, townId, axis, t) === aspect) return t;
  }
  throw new Error(`no ${aspect} in two cycles`);
}

function handTruck(): Truck {
  const route: [number, number][] = [[10, 9], [10, 10], [10, 11], [10, 12]];
  return {
    ownerId: 1, depotId: 1, factory: [10, 13], route,
    leg: 0, t: 0, reverse: false, deliveries: 0, waitMs: 0,
    segMult: [1, 1, 1], rateMult: 1,
    _yieldMs: 0, _stuckMs: 0, _lastSpeed: 0,
  };
}

// The painter tests below draw the vector stand-ins; the shipped game keeps
// them off until the sprites land (see the first test).
setAmbientStandIns(true);

describe("AMB-3 stand-ins are off in the shipped game", () => {
  it("paints nothing until the sprites land", async () => {
    const mod = await import("../../src/iso/ambience");
    mod.setAmbientStandIns(false);
    const calls: string[] = [];
    const ctx = new Proxy({}, { get: (_t, k) => (typeof k === "string" ? (...a: unknown[]) => { calls.push(k); return a; } : undefined) }) as never;
    const state = mod.createAmbience(1);
    const n = mod.paintAmbience(ctx, { x: 0, y: 0, zoom: 2, vw: 800, vh: 600 } as never, null, state, [], { performance: false });
    expect(n).toBe(0);
    expect(calls).toEqual([]);
    mod.setAmbientStandIns(true);
  });
});

describe("AMB-3 delivery clock", () => {
  it("delivery ticks and the economic pose match with ambience on and off", () => {
    const track = createTrack();
    pave(track, [[10, 9], [10, 10], [10, 11], [10, 12]]);
    const grid = townGrid([{ id: 0, tx: 10, ty: 10, houses: [[10, 10]], roads: [[10, 10], [10, 11]] }]);
    // A light sits on the lorry's route. If the visual hold wrote back into
    // tickTrucks, the on-run would deliver later.
    const signals: SignalMap = { seed: 1, junctions: new Map([[tIdx(10, 11), 0]]) };

    const trace = (on: boolean) => {
      const trucks = createTruckState();
      trucks.trucks = [handTruck()];
      const cars = createCarState();
      cars.cars = planCars(track, grid, [], 4, 1);
      const amb = createAmbience(1);
      amb.signals = signals;
      const times: number[] = [];
      const poses: string[] = [];
      let prev = 0;
      for (let ms = 0; ms < 12_000; ms += 100) {
        tickTrucks(trucks, 100, undefined, track);
        if (on) {
          tickAmbience(amb, 100, { track, grid, zoom: 2, performance: false });
          amb.signals = signals;
          tickCars(cars, 100, track, grid, 1, {
            signals, timeMs: amb.time,
            yieldTo: trucks.trucks,
          });
          tickTruckGhosts(amb, trucks.trucks, 100);
        }
        const tr = trucks.trucks[0];
        if (tr.deliveries !== prev) { times.push(ms + 100); prev = tr.deliveries; }
        poses.push(`${tr.leg}:${tr.t.toFixed(4)}:${tr.reverse}:${tr.deliveries}`);
      }
      return { times, poses };
    };

    const off = trace(false);
    const on = trace(true);
    expect(off.times.length, "the corridor lorry should deliver at least once").toBeGreaterThan(0);
    expect(on.times).toEqual(off.times);
    expect(on.poses).toEqual(off.poses);
  });

  it("a red light holds the DRAWN truck and leaves the economic pose alone", () => {
    const route: [number, number][] = [[10, 10], [11, 10], [12, 10]];
    const signals: SignalMap = { seed: 4, junctions: new Map([[tIdx(11, 10), 2]]) };
    const red = timeOf(4, 2, 0, "red");
    // the stop line moved back to t 0.4 (owner, 2026-09-29): probe from before it
    const hold = holdTForLight(route, 0, 0.3, signals, red);
    expect(hold).not.toBeNull();
    const truck = {
      depotId: 1, route, leg: 0, t: 0.3, reverse: false,
      segMult: [4], rateMult: 1,
    };
    const before = { ...truck };
    let ghost = stepGhost(null, truck, signals, red, 40);
    for (let i = 0; i < 25; i++) {
      truck.t = Math.min(0.98, truck.t + 0.04);
      ghost = stepGhost(ghost, truck, signals, red, 40);
    }
    expect(truck.t).toBeGreaterThan(hold!);
    expect(ghost.t).toBeLessThanOrEqual(hold! + 1e-6);
    expect(ghost.t).toBeLessThan(truck.t);
    // stepGhost must not have been what moved the economic pose — we moved it.
    expect(before.leg).toBe(0);
    const green = timeOf(4, 2, 0, "green");
    for (let i = 0; i < 60; i++) ghost = stepGhost(ghost, truck, signals, green, 50);
    expect(Math.abs(ghost.t - truck.t)).toBeLessThan(0.08);
    // clamp is a no-op on green, so a pose already past the line stays past it
    expect(clampToLight({ leg: 0, t: 0.95, reverse: false }, route, signals, green).t).toBe(0.95);
  });
});

describe("AMB-3 lights", () => {
  it("cycles green, amber, red per axis and never shows both axes green", () => {
    const seed = 3, town = 1;
    const greenAt = timeOf(seed, town, 0, "green");
    let t = greenAt;
    while (lightAspect(seed, town, 0, t) === "green") t += 10;
    expect(lightAspect(seed, town, 0, t)).toBe("amber");
    while (lightAspect(seed, town, 0, t) === "amber") t += 10;
    expect(lightAspect(seed, town, 0, t)).toBe("red");
    let bothGreen = 0;
    for (let ms = 0; ms < LIGHT_CYCLE_MS; ms += 50) {
      const [a, b] = lightPair(seed, town, ms);
      if (a === "green" && b === "green") bothGreen++;
    }
    expect(bothGreen).toBe(0);
    // The phase is a pure function of seed, town and time, and the two axes
    // are not the same light (axis 1 is half a cycle behind).
    expect(lightAspect(seed, town, 0, 1234)).toBe(lightAspect(seed, town, 0, 1234));
    let axesDiffer = false;
    for (let ms = 0; ms < LIGHT_CYCLE_MS; ms += 100) {
      if (lightAspect(seed, town, 0, ms) !== lightAspect(seed, town, 1, ms)) axesDiffer = true;
    }
    expect(axesDiffer).toBe(true);
  });

  it("puts a light on a town junction with 3+ links and not on one outside town", () => {
    const track = createTrack();
    const cross: [number, number][] = [[5, 4], [5, 5], [5, 6], [4, 5], [6, 5]];
    pave(track, cross);
    // A second cross, far from any town.
    pave(track, [[40, 40], [40, 41], [40, 42], [39, 41], [41, 41]]);
    const grid = townGrid([{
      id: 3, tx: 5, ty: 5, houses: [[5, 7]], roads: cross,
    }]);
    const signals = buildSignals(track, grid, 11);
    expect(signals.junctions.get(tIdx(5, 5))).toBe(3);
    expect(signals.junctions.has(tIdx(40, 41))).toBe(false);
    // A straight street is not a junction.
    expect(signals.junctions.has(tIdx(5, 4))).toBe(false);
  });

  it("holds a car at a red light and lets it through on green", () => {
    const track = createTrack();
    const tiles: [number, number][] = [[10, 10], [11, 10], [12, 10], [13, 10]];
    pave(track, tiles);
    const grid = townGrid([{ id: 2, tx: 11, ty: 10, houses: [], roads: tiles }]);
    const signals: SignalMap = { seed: 8, junctions: new Map([[tIdx(11, 10), 2]]) };
    const red = timeOf(8, 2, 0, "red");
    const hold = holdTForLight([[10, 10], [11, 10], [12, 10]], 0, 0.3, signals, red)!;
    const state = createCarState();
    const car: Car = {
      name: "car 1", carIndex: 1, state: "driving",
      originTownId: 2, destTownId: 2,
      origin: [10, 10], dest: [13, 10],
      route: [[10, 10], [11, 10], [12, 10], [13, 10]],
      leg: 0, t: hold - 0.05,
      waitMs: 0, fadeMs: 0, fade: 1, arriveMs: 0, lastTripKey: null,
    };
    state.cars = [car];
    tickCars(state, 5_000, track, grid, 1, { signals, timeMs: red });
    expect(car.state).toBe("driving");
    expect(car.leg).toBe(0);
    expect(car.t).toBeLessThanOrEqual(hold + 1e-4);
    const green = timeOf(8, 2, 0, "green");
    tickCars(state, 800, track, grid, 1, { signals, timeMs: green });
    // Past the line, which may already be the next leg.
    expect(car.leg > 0 || car.t > hold + 1e-3).toBe(true);
  });

  it("holds a pedestrian at the kerb until the crossed axis is red", () => {
    const ped: Ped = {
      id: 1, townId: 4, plaza: false, frame: 0, phase: 0, leg: 0, t: 0,
      path: [
        { x: 5.3, y: 5, townId: 4, waitAxis: 0 },
        { x: 4.7, y: 5, townId: 4 },
      ],
    };
    const signals: SignalMap = { seed: 6, junctions: new Map() };
    const green = timeOf(6, 4, 0, "green");
    expect(crossingAllowed(6, 4, 0, green)).toBe(false);
    stepPedestrians([ped], 800, signals, green);
    expect(ped.t).toBe(0);
    expect(ped.leg).toBe(0);
    const red = timeOf(6, 4, 0, "red");
    expect(crossingAllowed(6, 4, 0, red)).toBe(true);
    stepPedestrians([ped], 400, signals, red);
    expect(ped.t + ped.leg).toBeGreaterThan(0);
  });
});

describe("AMB-3 cars give way and towns get busier", () => {
  it("does not close on a truck ahead in the same lane", () => {
    const route: [number, number][] = [[10, 10], [14, 10]];
    const car = { route, leg: 0, t: 0.2 };
    const truck: YieldActor = { id: 1, route, leg: 0, t: 0.28, reverse: false };
    // 0.08 of a 4-tile leg is 0.32 tiles — inside the minimum gap.
    expect(gapToActors(car, [truck])).toBeLessThan(0.35);
    const clear: YieldActor = { id: 2, route: [[10, 12], [14, 12]], leg: 0, t: 0.2 };
    expect(gapToActors(car, [clear])).toBe(Infinity);

    const track = createTrack();
    pave(track, [[10, 10], [11, 10], [12, 10], [13, 10], [14, 10]]);
    const grid = townGrid([{ id: 0, tx: 10, ty: 10, houses: [], roads: [[10, 10], [11, 10]] }]);
    const state = createCarState();
    const live: Car = {
      name: "car 1", carIndex: 1, state: "driving",
      originTownId: 0, destTownId: 0,
      origin: [10, 10], dest: [14, 10],
      route: [[10, 10], [11, 10], [12, 10], [13, 10], [14, 10]],
      leg: 0, t: 0.1, waitMs: 0, fadeMs: 0, fade: 1, arriveMs: 0, lastTripKey: null,
    };
    state.cars = [live];
    const ahead: YieldActor = {
      id: 7, route: live.route, leg: 0, t: 0.25, reverse: false,
    };
    const before = live.t;
    tickCars(state, 2_000, track, grid, 1, { yieldTo: [ahead] });
    expect(live.t).toBe(before);
    expect(live.leg).toBe(0);
  });

  it("gives a bigger, higher-tier town more cars and more people, and respects the caps", () => {
    const small = [{ houses: Array(4), roads: Array(6), level: 0 }];
    const big = [{ houses: Array(40), roads: Array(48), level: 3 }];
    expect(townTrafficWeight(big[0])).toBeGreaterThan(townTrafficWeight(small[0]));
    expect(ambientCarBudget(big)).toBeGreaterThan(ambientCarBudget(small));
    expect(ambientPedBudget(big)).toBeGreaterThan(ambientPedBudget(small));
    const huge = Array.from({ length: 12 }, () => ({ houses: Array(80), roads: Array(80), level: 5 }));
    expect(ambientCarBudget(huge)).toBeLessThanOrEqual(CAR_HARD_CAP);
    expect(ambientPedBudget(huge)).toBeLessThanOrEqual(PED_HARD_CAP);
    const capped = clampBudgets(10_000, 10_000);
    expect(capped.cars + capped.peds).toBeLessThanOrEqual(AMBIENT_ACTOR_CAP);
    expect(capped.cars).toBe(CAR_HARD_CAP);
    expect(selectOnScreen(Array.from({ length: 40 }, (_, i) => i), SCREEN_CAR_CAP, (n) => n)).toHaveLength(SCREEN_CAR_CAP);
    expect(selectOnScreen([1, 2], SCREEN_PED_CAP, (n) => n)).toEqual([1, 2]);
  });

  it("starts more trips in the bigger town", () => {
    const track = createTrack();
    const smallRoads: [number, number][] = [[10, 10], [11, 10]];
    const bigRoads: [number, number][] = [];
    for (let x = 20; x <= 32; x++) bigRoads.push([x, 10]);
    pave(track, [...smallRoads, ...bigRoads, [12, 10], [13, 10], [14, 10], [15, 10], [16, 10], [17, 10], [18, 10], [19, 10]]);
    const grid = townGrid([
      { id: 0, tx: 10, ty: 10, houses: [[10, 11]], roads: smallRoads, level: 0 },
      { id: 1, tx: 26, ty: 10, houses: Array.from({ length: 20 }, (_, i) => [20 + (i % 5), 11 + (i % 3)] as [number, number]), roads: bigRoads, level: 3 },
    ]);
    let smallN = 0, bigN = 0;
    for (let seed = 1; seed <= 12; seed++) {
      for (const c of planCars(track, grid, [], 16, seed)) {
        if (c.originTownId === 0) smallN++;
        if (c.originTownId === 1) bigN++;
      }
    }
    expect(bigN).toBeGreaterThan(smallN);
  });
});

describe("AMB-3 determinism, LOD and the art list", () => {
  it("rebuilds the same walkers from the same seed", () => {
    const track = createTrack();
    const roads: [number, number][] = [];
    for (let x = 8; x <= 14; x++) roads.push([x, 8]);
    for (let y = 8; y <= 12; y++) roads.push([10, y]);
    pave(track, roads);
    const grid = townGrid([{ id: 1, tx: 10, ty: 8, houses: [[9, 9], [11, 9]], roads, level: 1 }]);
    const a = spawnPedestrians(track, grid, 42);
    const b = spawnPedestrians(track, grid, 42);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(PED_HARD_CAP);
    expect(a.map((p) => [p.townId, p.leg, p.t, p.plaza, p.path.length])).toEqual(
      b.map((p) => [p.townId, p.leg, p.t, p.plaza, p.path.length]),
    );
    const sa = createAmbience(42);
    const sb = createAmbience(42);
    tickAmbience(sa, 500, { track, grid, zoom: 2, performance: false });
    tickAmbience(sb, 500, { track, grid, zoom: 2, performance: false });
    expect(sa.peds.map((p) => [p.leg, p.t, p.frame])).toEqual(sb.peds.map((p) => [p.leg, p.t, p.frame]));
    // Parked at the medium zoom: the clock runs, the walkers do not.
    const parked = sa.peds.map((p) => [p.leg, p.t]);
    tickAmbience(sa, 800, { track, grid, zoom: 1, performance: false });
    expect(sa.pedsActive).toBe(false);
    expect(sa.peds.map((p) => [p.leg, p.t])).toEqual(parked);
    expect(sa.time).toBe(1300);
  });

  it("shows pedestrians only at the closest zoom, cars from medium, and nothing in performance mode", () => {
    expect(ambienceVisible("peds", 2, false)).toBe(true);
    expect(ambienceVisible("peds", 1, false)).toBe(false);
    expect(ambienceVisible("peds", 0.5, false)).toBe(false);
    expect(ambienceVisible("cars", 0.5, false)).toBe(false);
    expect(ambienceVisible("cars", 1, false)).toBe(true);
    expect(ambienceVisible("cars", 2, false)).toBe(true);
    expect(ambienceVisible("lights", 1, false)).toBe(true);
    expect(ambienceVisible("cars", 2, true)).toBe(false);
    expect(ambienceVisible("peds", 2, true)).toBe(false);
    expect(ambienceVisible("lights", 2, true)).toBe(false);
  });

  it("lists every sprite the lead still has to draw", () => {
    for (const model of CAR_MODELS) {
      for (const view of ["ne", "se", "sw", "nw"]) {
        expect(AMBIENT_ART_NEEDED).toContain(`car_${model}_${view}`);
      }
    }
    for (const view of ["ne", "se", "sw", "nw"]) {
      expect(AMBIENT_ART_NEEDED).toContain(`ped_walk_${view}_0`);
      expect(AMBIENT_ART_NEEDED).toContain(`ped_walk_${view}_1`);
    }
    expect(AMBIENT_ART_NEEDED).toEqual(expect.arrayContaining([
      "traffic_light_green", "traffic_light_amber", "traffic_light_red",
    ]));
    expect(new Set(AMBIENT_ART_NEEDED).size).toBe(AMBIENT_ART_NEEDED.length);
  });
});
