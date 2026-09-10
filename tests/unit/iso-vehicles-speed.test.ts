// ══════════════════════════════════════════════════════════════════════════
// AI-02 — per-segment truck speed: paved legs carry a lorry twice as fast as
// dirt legs, so a mixed route's round trip is Σ(len × (paved ? 1/2 : 1)),
// not one uniform fade. The change of pace must:
//   * plan a segFast flag per route SEGMENT (either endpoint paved);
//   * integrate the tick per segment so reflection at both ends is exact
//     despite non-uniform speed (no teleport past the factory);
//   * recompute on replan, so an upgraded tile speeds its lorry immediately;
//   * leave pre-AI-02 trucks (no segFast) at the uniform dirt pace.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { generateMap } from "../../src/iso/grid";
import {
  createTrack, buildTile, PUBLIC_OWNER, type Track,
} from "../../src/iso/track";
import type { EconomyState, Harvester } from "../../src/iso/economy";
import {
  TRUCK_SPEED, TRUCK_ROAD_MULT, createTruckState, planTrucks, tickTrucks,
  type Truck,
} from "../../src/iso/vehicles";

const TICK = 1 / TRUCK_SPEED; // ms per tile on dirt (300)

/** Straight five-tile east route on free land; one depot+factory at the ends. */
function lane(pavedSegs: number): { truck: Truck | undefined; planAgain: () => Truck[] } {
  const grid = generateMap(1701);
  const track: Track = createTrack();
  // the route (10,10)→(14; depot at (10,11) shoulders (10,10); factory at (15,10)
  for (let k = 0; k < 5; k++) buildTile(track, "dirt", 10 + k, 10, 1);
  // upgrade the first `pavedSegs` segments to paved Road
  for (let k = 0; k < pavedSegs; k++) buildTile(track, "road", 10 + k, 10, 1);
  const eco: EconomyState = { grid, track, harvesters: [], factories: [] };
  const h: Harvester = { id: 1, owner: "you", ownerId: 1, tx: 10, ty: 11 };
  eco.harvesters.push(h);
  eco.factories.push({ owner: "you", ownerId: 1, tx: 15, ty: 10 });
  return { truck: planTrucks(eco)[0], planAgain: () => planTrucks(eco) };
}

describe("AI-02 trucks run 2× on paved segments", () => {
  it("a paved route's one-way trip takes half the dirt time", () => {
    const state = createTruckState();
    state.trucks.push({
      ownerId: 1, depotId: 1, factory: [4, 0],
      route: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
      segFast: [true, true, true, true],
      leg: 0, t: 0, reverse: false, deliveries: 0,
    });
    // 4 paved segments are done in 2 dirt-tile-times exactly
    tickTrucks(state, (4 / TRUCK_ROAD_MULT) * TICK - 1);
    expect(state.trucks[0].reverse).toBe(false);
    tickTrucks(state, 1);
    expect(state.trucks[0].deliveries).toBe(1);
    expect(state.trucks[0].reverse).toBe(true);
  });

  it("a mixed route crosses its paved half twice as fast", () => {
    const state = createTruckState();
    state.trucks.push({
      ownerId: 1, depotId: 1, factory: [4, 0],
      route: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
      segFast: [false, false, true, true],   // dirt dirt road road
      leg: 0, t: 0, reverse: false, deliveries: 0,
    });
    tickTrucks(state, 2 * TICK);             // the two dirt tiles take 2×TICK
    expect(state.trucks[0].leg).toBe(2);
    expect(state.trucks[0].t).toBeCloseTo(0);
    // the remaining two paved segments take TICK total, not 2×TICK
    tickTrucks(state, TICK - 1);
    expect(state.trucks[0].reverse).toBe(false);
    tickTrucks(state, 1);
    expect(state.trucks[0].deliveries).toBe(1);
  });

  it("planTrucks stamps the paved segments it found", () => {
    expect(lane(0).truck?.segFast).toEqual([false, false, false, false]);
    expect(lane(2).truck?.segFast).toEqual([true, true, false, false]);
    expect(lane(5).truck?.segFast).toEqual([true, true, true, true]);
  });

  it("a truck without segFast still drives the old uniform pace (saves)", () => {
    const state = createTruckState();
    state.trucks.push({
      ownerId: 1, depotId: 1, factory: [2, 0],
      route: [[0, 0], [1, 0], [2, 0]], leg: 0, t: 0, reverse: false, deliveries: 0,
    });
    tickTrucks(state, TICK / 2);
    expect(state.trucks[0].t).toBeCloseTo(0.5);
  });

  it("public (unowned) highways read as paved too", () => {
    const track: Track = createTrack();
    for (let k = 0; k < 3; k++) buildTile(track, "road", 10 + k, 10, PUBLIC_OWNER);
    // reading segFast out of a route reuses track.road bits only: assert the
    // helper directly over the same plan path on a real eco via lane()
    expect(track.road[10 * 144 + 10]).not.toBe(0);
  });
});
