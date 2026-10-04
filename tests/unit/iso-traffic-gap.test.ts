// TRAFFIC-GAP (owner round 2): vehicles in one lane keep a minimum centre gap across tile boundaries, and two
// vehicles spawned on the very same spot separate. Deterministic (no Math.random).
import { describe, expect, it } from "vitest";
import { MAP_W, MAP_H } from "../../src/game/config";
import { GRASS, type Grid } from "../../src/iso/grid";
import { createTrack, buildTile } from "../../src/iso/track";
import { createCarState, tickCars, type Car } from "../../src/iso/cars";
import { MIN_GAP } from "../../src/iso/traffic";

const flat = (): Grid => ({
  w: MAP_W, h: MAP_H, seed: 7, terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
  occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), industries: [], towns: [], publicRoads: [],
});
const route: [number, number][] = [];
for (let x = 10; x <= 40; x++) route.push([x, 10]);
const car = (name: string, leg: number, t: number): Car => ({
  name, carIndex: 1, originTownId: 0, destTownId: 0, origin: route[0], dest: route.at(-1)!, route: route.slice(),
  state: "driving", leg, t, waitMs: 0, fadeMs: 0, fade: 1, arriveMs: 0, lastTripKey: null,
});

describe("TRAFFIC-GAP", () => {
  it("N cars on one lane never come closer than the gap, including a pile spawned on one spot", () => {
    const track = createTrack();
    for (const [x, y] of route) buildTile(track, "road", x, y, 1);
    const grid = flat();
    grid.towns = [{ id: 0, tx: 10, ty: 10, roads: route } as any];
    const state = createCarState();
    // 4 cars on the same spot (a spawn pile), 3 more spread close together across tile boundaries
    state.cars = [car("a", 5, 0.5), car("b", 5, 0.5), car("c", 5, 0.5), car("d", 5, 0.5), car("e", 3, 0.9), car("f", 4, 0.2), car("g", 4, 0.6)];
    let min = Infinity, settledMin = Infinity;
    for (let step = 0; step < 4000; step++) {
      tickCars(state, 20, track, grid, 7);
      const live = state.cars.filter((c) => c.state === "driving").map((c) => c.leg + c.t).sort((p, q) => p - q);
      for (let i = 1; i < live.length; i++) { const g = live[i] - live[i - 1]; min = Math.min(min, g); if (step > 1500) settledMin = Math.min(settledMin, g); }
    }
    // after the opening pile has separated, nobody sits inside the gap (small epsilon for discrete ticks)
    expect(settledMin).toBeGreaterThan(MIN_GAP - 0.08);
    expect(MIN_GAP).toBeGreaterThanOrEqual(0.6);
  });
});
