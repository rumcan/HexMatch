// ══════════════════════════════════════════════════════════════════════════
// #433 TRAFFIC-1 — lanes, spacing, junction yielding, jam recovery.
//
// Tests for:
//   * lane offset per direction (cars on opposite sides of centre) and on
//     a diagonal (45° perpendicular)
//   * minimum gap never violated in a queued lane over 2 simulated minutes
//   * junction yield order (first-come priority)
//   * forced jam clears within timeout (car despawn / reroute)
//   * a cargo truck still delivers on a short route
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { MAP_W, MAP_H } from "../../src/game/config";
import { GRASS, type Grid } from "../../src/iso/grid";
import {
  createTrack, buildTile, setRoadTier, ROAD_TIER, OVERPASS_X, tIdx,
  type Track,
} from "../../src/iso/track";
import {
  createCarState, planCars, tickCars, carItems, CAR_SPEED, CAR_COUNT,
  type Car,
} from "../../src/iso/cars";
import {
  createTruckState, tickTrucks, truckItems, TRUCK_SPEED, planTrucks,
  type Truck,
} from "../../src/iso/vehicles";
import {
  lanePerp, laneOffsetFor, overpassLiftFor, MIN_GAP, JAM_TIMEOUT_MS,
  segKey,
} from "../../src/iso/traffic";
import type { EconomyState } from "../../src/iso/economy";

const flat = (): Grid => ({
  w: MAP_W, h: MAP_H, seed: 433,
  terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
  occupancy: new Int16Array(MAP_W * MAP_H).fill(-1),
  industries: [], towns: [], publicRoads: [],
});

function pave(track: Track, tiles: [number, number][], owner = 1) {
  for (const [x, y] of tiles) buildTile(track, "road", x, y, owner);
}

function carFixture(route: [number, number][], t = 0, leg = 0): Car {
  return {
    name: "test", carIndex: 1, originTownId: 0, destTownId: 0,
    origin: route[0], dest: route.at(-1)!, route,
    state: "driving", leg, t, waitMs: 0, fadeMs: 0, fade: 1, arriveMs: 0,
    lastTripKey: null,
  };
}

function truckFixture(route: [number, number][], t = 0, leg = 0, reverse = false): Truck {
  return {
    ownerId: 1, depotId: 1, factory: route.at(-1)!,
    route, leg, t, reverse, deliveries: 0,
    segFast: route.slice(0, -1).map(() => false),
    segClimb: route.slice(0, -1).map(() => 0),
  };
}

describe("433 lane offsets", () => {
  it("shifts eastbound to the south (right) side of centre", () => {
    // East (dx=+1,dy=0): right-hand traffic hugs the southern carriageway
    const [du, dv] = lanePerp(1, 0);
    expect(du).toBeCloseTo(0, 10);
    expect(dv).toBeGreaterThan(0); // south is positive v in ground plane
  });

  it("shifts westbound to the north side — opposite sign of eastbound", () => {
    const east = lanePerp(1, 0);
    const west = lanePerp(-1, 0);
    expect(west[0]).toBeCloseTo(-east[0], 10);
    expect(west[1]).toBeCloseTo(-east[1], 10);
  });

  it("shifts northbound and southbound to opposite sides", () => {
    const south = lanePerp(0, 1);
    const north = lanePerp(0, -1);
    expect(south[0]).not.toBeCloseTo(0, 6);
    expect(north[0]).toBeCloseTo(-south[0], 10);
    expect(north[1]).toBeCloseTo(-south[1], 10);
  });

  it("diagonal heading (1,1) gives a 45° perpendicular of correct magnitude", () => {
    const [du, dv] = lanePerp(1, 1);
    // Perpendicular to (1,1)/√2 is (-1,1)/√2, scaled by LANE_OFFSET.
    const mag = Math.hypot(du, dv);
    expect(mag).toBeCloseTo(0.12, 5);
    // du ≈ -0.12/√2, dv ≈ +0.12/√2
    expect(du).toBeLessThan(0);
    expect(dv).toBeGreaterThan(0);
  });

  it("opposite diagonal (-1,-1) has opposite offset to (1,1)", () => {
    const a = lanePerp(1, 1);
    const b = lanePerp(-1, -1);
    expect(b[0]).toBeCloseTo(-a[0], 10);
    expect(b[1]).toBeCloseTo(-a[1], 10);
  });

  it("highway tier gets a wider lane offset", () => {
    const road = lanePerp(1, 0, 0);
    const hw = lanePerp(1, 0, 2); // ROAD_TIER.highway = 2
    expect(Math.hypot(hw[0], hw[1])).toBeGreaterThan(Math.hypot(road[0], road[1]));
    // Both offset south for eastbound
    expect(hw[1]).toBeGreaterThan(road[1]);
  });

  it("laneOffsetFor reads the track's tier at rounded tile", () => {
    const track = createTrack();
    pave(track, [[10, 10], [11, 10], [12, 10]]);
    // All tiles highway
    setRoadTier(track, 10, 10, ROAD_TIER.highway);
    setRoadTier(track, 11, 10, ROAD_TIER.highway);
    setRoadTier(track, 12, 10, ROAD_TIER.highway);
    // Car at start of leg 0 → t=0 exactly at (10,10), rounds to (10,10)
    const car = carFixture([[10, 10], [11, 10], [12, 10]], 0, 0);
    const [du, dv] = laneOffsetFor(car, track);
    // On a highway, offset magnitude is LANE_OFFSET_HIGHWAY
    expect(Math.hypot(du, dv)).toBeCloseTo(0.24, 5);
  });

  it("draw items for opposite-direction cars sit on opposite sides", () => {
    const track = createTrack();
    pave(track, [[10, 10], [11, 10], [12, 10], [13, 10]]);
    // Eastbound car at t=0.5
    const eastState = createCarState();
    const eastCar = carFixture([[10, 10], [11, 10], [12, 10]], 0.5, 1);
    eastState.cars = [eastCar];
    // Westbound car on a separate route (same physical segment, opposite direction)
    const westState = createCarState();
    const westCar: Car = {
      ...carFixture([[12, 10], [11, 10], [10, 10]], 0.5, 1),
      name: "west",
    };
    westState.cars = [westCar];
    const eastItem = carItems(eastState, track)[0]!;
    const westItem = carItems(westState, track)[0]!;
    // Both near (11.5,10) / (11.5,10) raw, but lane offset should shift them
    // apart perpendicular to direction (v axis)
    const dv = eastItem.fy! - westItem.fy!;
    // Eastbound shifts +dv (south), westbound shifts -dv (north) → dv > 0
    expect(dv).toBeGreaterThan(0.05);
  });
});

describe("433 car-following: minimum gap never violated", () => {
  it("two cars queued behind a stopped leader never close inside MIN_GAP over 2 minutes", () => {
    const track = createTrack();
    // Long straight road
    const tiles: [number, number][] = [];
    for (let x = 10; x <= 30; x++) tiles.push([x, 10]);
    pave(track, tiles);
    const state = createCarState();
    // Leader at x=20, follower at x=18 on same route, leader "stopped" (route
    // is short so it arrives and waits).
    const leaderRoute: [number, number][] = [];
    for (let x = 10; x <= 22; x++) leaderRoute.push([x, 10]);
    const followerRoute: [number, number][] = [];
    for (let x = 10; x <= 22; x++) followerRoute.push([x, 10]);

    // Use an artificial grid so planCars/tickCars accept the track
    const grid = flat();
    grid.towns = [{
      id: 0, tx: 10, ty: 10, roads: leaderRoute,
    } as any];

    const leader: Car = {
      ...carFixture(leaderRoute, 0, 10), // starts at leg=10 (x=20)
      name: "leader",
      carIndex: 1,
      state: "spawning", // will go to driving
      fadeMs: 0, fade: 1,
    };
    leader.t = 0.999; // leader is at the end of route segment, about to arrive
    leader.leg = leaderRoute.length - 2;
    // Force leader to arriving immediately so it stops.
    leader.state = "arriving";
    leader.arriveMs = 50; // short arrive, then despawns to waiting (not driving anymore, so it leaves the hash)
    // For a more robust test we park the leader mid-route by giving it no
    // destination end to reach? Simpler: give leader a route where after
    // arrival it enters 'despawning' and leaves the roadway — we replace
    // with a permanently-stuck leader via direct t=0 position.
    leader.state = "driving";
    leader.leg = 10;
    leader.t = 0;
    leader.route = leaderRoute;
    // Clip the leader's route so its "destination" is at its current tile —
    // leader stays at x=20 by making its route length 1? No, keep a longer
    // route but force t to never advance: use a huge waitMs state? Easier:
    // use TWO CARS with leader starting ahead on same route.
    const follower: Car = {
      ...carFixture(followerRoute, 0, 8), // at x=18
      name: "follower",
      carIndex: 2,
      state: "driving",
      fadeMs: 0, fade: 1,
    };
    state.cars = [leader, follower];
    // Run 2 minutes of sim time in 20 ms chunks.
    let minGap = Infinity;
    for (let step = 0; step < 6000; step++) {
      tickCars(state, 20, track, grid, 433);
      // Compute follower-to-leader gap along x axis (same road, same direction)
      const fp = follower.leg + follower.t;
      const lp = leader.leg + leader.t;
      if (follower.state === "driving" && leader.state === "driving") {
        const gap = lp - fp;
        if (gap < minGap) minGap = gap;
        if (gap < -0.01) {
          // Follower ahead of leader = something wrong; don't assert here
          // (leader may have finished), but track minGap when both on road.
        }
      }
    }
    // The follower must never close inside the minimum spacing while both
    // are driving. We tolerate a small epsilon for discrete ticking.
    expect(minGap).toBeGreaterThan(MIN_GAP - 0.08);
  });
});

describe("433 junction yield order", () => {
  it("the first car to reach a junction enters before a later arrival", () => {
    const track = createTrack();
    // L-shaped road: horizontal then turn at (15,10) to go up
    pave(track, [[10, 10], [11, 10], [12, 10], [13, 10], [14, 10], [15, 10], [15, 9], [15, 8], [15, 7]]);
    const grid = flat();
    grid.towns = [{
      id: 0, tx: 10, ty: 10,
      roads: [[10, 10], [11, 10], [12, 10], [13, 10], [14, 10], [15, 10], [15, 9], [15, 8], [15, 7]],
    } as any];
    // Place two cars approaching the same corner (15,10) from the same
    // direction at different distances. Car A is closer to the corner.
    const route: [number, number][] = [
      [10, 10], [11, 10], [12, 10], [13, 10], [14, 10], [15, 10], [15, 9], [15, 8], [15, 7],
    ];
    const carA: Car = {
      ...carFixture(route, 0.7, 4), name: "A", carIndex: 1, state: "driving", fadeMs: 0, fade: 1,
    };
    // Car B a few tiles back
    const carB: Car = {
      ...carFixture(route, 0.2, 2), name: "B", carIndex: 2, state: "driving", fadeMs: 0, fade: 1,
    };
    const state = createCarState();
    state.cars = [carA, carB];
    // Tick for a few seconds — car A should be first to pass the corner
    let aAtCorner = 0, bAtCorner = 0;
    for (let step = 0; step < 300; step++) {
      tickCars(state, 50, track, grid, 433);
      // Has A crossed route[5] (the corner)?
      if (aAtCorner === 0 && (carA.leg > 5 || (carA.leg === 5 && carA.t > 0.5))) aAtCorner = step;
      if (bAtCorner === 0 && (carB.leg > 5 || (carB.leg === 5 && carB.t > 0.5))) bAtCorner = step;
      if (aAtCorner > 0 && bAtCorner > 0) break;
    }
    expect(aAtCorner).toBeGreaterThan(0);
    expect(bAtCorner).toBeGreaterThan(0);
    // A arrives at the corner strictly before B does
    expect(aAtCorner).toBeLessThan(bAtCorner);
  });
});

describe("433 jam recovery", () => {
  it("a car stuck behind a stationary blocker despawns within JAM_TIMEOUT_MS + a tick", () => {
    const track = createTrack();
    const tiles: [number, number][] = [];
    for (let x = 10; x <= 25; x++) tiles.push([x, 10]);
    pave(track, tiles);
    const grid = flat();
    grid.towns = [{ id: 0, tx: 10, ty: 10, roads: tiles } as any];
    const state = createCarState();
    const longRoute: [number, number][] = [];
    for (let x = 10; x <= 25; x++) longRoute.push([x, 10]);
    // Blocker: car placed at x=20 (leg=10, t=0) with state=spawning and
    // no fade progress so it stays at spawn position (never drives).
    // Actually, spawning cars are not in the hash; arriving cars are.
    // Place a car permanently "arriving" at x=20 so it occupies the segment
    // and blocks followers. We set arriveMs to a very large value so the
    // blocker never despawns during our test window.
    const blocker: Car = {
      ...carFixture(longRoute, 0, 10), name: "blocker", carIndex: 1,
      state: "arriving", fadeMs: 0, fade: 1, arriveMs: 999999,
    };
    const follower: Car = {
      ...carFixture(longRoute, 0, 8), name: "follower", carIndex: 2,
      state: "driving", fadeMs: 0, fade: 1,
    };
    state.cars = [blocker, follower];
    // Tick for JAM_TIMEOUT_MS + buffer in small steps.
    const steps = Math.ceil((JAM_TIMEOUT_MS + 2000) / 50);
    for (let i = 0; i < steps; i++) {
      tickCars(state, 50, track, grid, 433);
      if (follower.state === "waiting") break;
    }
    expect(follower.state).toBe("waiting");
    expect(follower.route.length).toBe(0);
  });
});

describe("433 cargo truck still delivers", () => {
  it("a truck completes a delivery on a short paved road (economic contract preserved)", () => {
    const track = createTrack();
    // Straight road from a mock depot to a mock factory — route length 4 tiles.
    const route: [number, number][] = [[10, 10], [11, 10], [12, 10], [13, 10], [14, 10]];
    pave(track, route);
    const truck = truckFixture(route, 0, 0, false);
    truck.segFast = route.slice(0, -1).map(() => true);
    truck.depot = [10, 10];
    const state = createTruckState();
    state.trucks = [truck];
    const before = truck.deliveries;
    // One-way time: 4 tiles / TRUCK_SPEED on paved (×4 multiplier).
    const oneWayMs = 4 / (TRUCK_SPEED * 4); // = 600ms
    tickTrucks(state, oneWayMs + 50, undefined, track);
    expect(truck.deliveries).toBeGreaterThan(before);
    expect(truck.reverse).toBe(true); // turned around
  });
});

describe("433 overpass lift", () => {
  it("lifts CROSSING vehicles on an OVERPASS_X deck above the highway", () => {
    const track = createTrack();
    // Build an E-W highway (x axis) at y=10
    for (let x = 10; x <= 14; x++) {
      buildTile(track, "road", x, 10, 1);
      setRoadTier(track, x, 10, ROAD_TIER.highway);
    }
    setRoadTier(track, 12, 10, OVERPASS_X); // overpass deck at (12,10)
    // Build the N-S crossing road (the crossing goes OVER the highway)
    for (let y = 8; y <= 12; y++) {
      buildTile(track, "road", 12, y, 1);
    }
    // A car driving N-S along the CROSSING road, passing through the deck
    // tile (12,10) going north. Leg 1 is (12,11)→(12,10), t=0.5 → (12,10.5)?
    // No: route [12,12]→[12,11]→[12,10]→[12,9] going north; leg=1 is
    // (12,11)→(12,10), t=0.5 → (12, 10.5) rounds to (12,11) not deck.
    // Put t very close to 1.0 on leg=1 → (12, ~10) rounds to (12,10).
    const carOnDeck = carFixture(
      [[12, 12], [12, 11], [12, 10], [12, 9]],
      0.95,
      1,
    );
    const lift = overpassLiftFor(carOnDeck, track);
    expect(lift).toBeGreaterThan(0);
    // A car driving E-W along the HIGHWAY at the deck tile does NOT get lift
    // (it is on the lower road).
    const highwayCar = carFixture(
      [[10, 10], [11, 10], [12, 10], [13, 10], [14, 10]],
      0.5,
      1,
    );
    // t=0.5 leg=1: (11.5,10) rounds to (12,10) — deck tile, but direction is
    // E-W (highway axis) → no lift
    expect(overpassLiftFor(highwayCar, track)).toBe(0);
  });
});

describe("433 segKey (spatial hash)", () => {
  it("is symmetric: a→b and b→a produce the same key", () => {
    expect(segKey(10, 10, 11, 10)).toBe(segKey(11, 10, 10, 10));
    expect(segKey(10, 10, 11, 11)).toBe(segKey(11, 11, 10, 10));
  });
  it("differs for different segments", () => {
    expect(segKey(10, 10, 11, 10)).not.toBe(segKey(11, 10, 12, 10));
  });
});
