// ══════════════════════════════════════════════════════════════════════════
// TK-004 — vehicle animation feasibility spike.
//
// The spike's claims, proven: routes exist only over the owner's OWN
// connected track; movement interpolates along the tile-centre polyline at a
// constant speed; the bus ping-pongs; and each plant end arrival fires
// exactly once — the event TK-007 hangs the token spawn on.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import {
  createVehicleSystem, findRoute, vehiclePos, pathPoints, segmentLengths,
  BUS_SPEED_PXPS, MAX_VEHICLES, type Vehicle,
} from "../../src/iso/vehicles";
import { createTrack, buildTile, tIdx, type Track } from "../../src/iso/track";
import { GRASS, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import type { EconomyState } from "../../src/iso/economy";

function flatGrid(): Grid {
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries: [], towns: [], occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), seed: 1,
  };
}

/** Depot/harvester at (5,5), plant/factory at (5,12), road column between. */
function world(track = createTrack(), roadOwner = 1): { grid: Grid; track: Track } {
  const grid = flatGrid();
  for (let y = 6; y <= 11; y++) buildTile(track, "road", 5, y, roadOwner);
  return { grid, track };
}

const eco = (grid: Grid, track: Track): EconomyState => ({
  grid, track,
  harvesters: [{ id: 1, owner: "you", ownerId: 1, tx: 5, ty: 5 }],
  factories: [{ owner: "you", ownerId: 1, tx: 5, ty: 12 }],
});

describe("TK-004 findRoute", () => {
  it("runs depot → plant over the owner's own track, endpoints included", () => {
    const { grid, track } = world();
    void grid;
    const path = findRoute(track, 1, { tx: 5, ty: 5 }, { tx: 5, ty: 12 });
    expect(path).toBeTruthy();
    expect(path![0]).toEqual([5, 5]);
    expect(path![path!.length - 1]).toEqual([5, 12]);
    expect(path!.length).toBe(8);
    // strictly the column between the two ends
    for (const [x, y] of path!) expect(x).toBe(5);
  });

  it("never routes over the rival's track (W2)", () => {
    const { grid, track } = world(createTrack(), 2);
    void grid;
    expect(findRoute(track, 1, { tx: 5, ty: 5 }, { tx: 5, ty: 12 })).toBeNull();
  });

  it("returns null when the network does not link depot and plant", () => {
    const { grid, track } = world();
    void grid;
    // cut the column in half
    for (let y = 9; y <= 11; y++) {
      const i = tIdx(5, y);
      track.road[i] = 0; track.owner[i] = 0;
    }
    expect(findRoute(track, 1, { tx: 5, ty: 5 }, { tx: 5, ty: 12 })).toBeNull();
  });

  it("rejects out-of-bounds endpoints", () => {
    const { track } = world();
    expect(findRoute(track, 1, { tx: -1, ty: 0 }, { tx: 5, ty: 5 })).toBeNull();
  });
});

describe("TK-004 movement", () => {
  const mkVehicle = (): Vehicle => {
    const { track } = world();
    const path = findRoute(track, 1, { tx: 5, ty: 5 }, { tx: 5, ty: 12 })!;
    return {
      id: 1, depot: { tx: 5, ty: 5 }, plant: { tx: 5, ty: 12 },
      path, leg: 0, progress: 0, dir: 1,
    };
  };

  it("interpolates along the tile-centre polyline, '/' axis for NE travel", () => {
    const v = mkVehicle();
    const start = vehiclePos(v);
    const pts = pathPoints(v.path);
    expect(start.wx).toBeCloseTo(pts[0][0], 6);
    expect(start.wy).toBeCloseTo(pts[0][1], 6);
    // NE step: (5,5)→(5,4) would be "/" — this route steps SOUTH (SW direction,
    // same "/" diagonal); assert the axis and midpoint of the first leg
    expect(start.axis).toBe("/");
    v.progress = segmentLengths(v.path)[0] / 2;
    const mid = vehiclePos(v);
    expect(mid.wy).toBeGreaterThan(start.wy);   // travelling SW: screen-y grows
    expect(mid.wx).toBeLessThan(start.wx);
  });

  it("an eastbound leg uses the '\\' end-view axis", () => {
    const v = mkVehicle();
    // E step: tileToScreen delta (+HW, +HH) — same-signed → the "\" diagonal
    v.path = [[5, 12], [6, 12]];
    v.leg = 0; v.progress = 0; v.dir = 1;
    expect(vehiclePos(v).axis).toBe("\\");
  });

  it("the reverse direction keeps the same diagonal (N/S are one line)", () => {
    const v = mkVehicle();
    v.path = [[5, 12], [5, 11]];
    v.leg = 0; v.progress = 0; v.dir = -1;   // heading south (depot-ward)
    expect(vehiclePos(v).axis).toBe("/");
  });

  it("arrives at the plant exactly once per round trip and ping-pongs", () => {
    const { grid, track } = world();
    const sys = createVehicleSystem();
    sys.sync(eco(grid, track), "you");
    expect(sys.vehicles).toHaveLength(1);
    const v = sys.vehicles[0];
    const lens = segmentLengths(v.path);
    const total = lens.reduce((a, b) => a + b, 0);
    const dt = 100;
    let arrivals = 0;
    let now = 0;
    // piecewise: cross the whole path to the plant, sampling arrivals
    let travelled = 0;
    while (travelled < total) {
      const before = sys.arrivals;
      sys.tick(now += dt, dt);
      travelled += (BUS_SPEED_PXPS * dt) / 1000;
      if (sys.arrivals > before) arrivals++;
      expect(v.leg).toBeGreaterThanOrEqual(0);
      expect(v.progress).toBeGreaterThanOrEqual(0);
    }
    expect(arrivals).toBe(1);                      // one plant arrival
    expect(v.dir).toBe(-1);                        // and turned around
    expect(v.leg).toBeLessThan(v.path.length - 1); // heading back
    // the full trip back + forth again yields exactly one more arrival
    travelled = 0;
    const before = sys.arrivals;
    while (travelled < 2 * total) {
      sys.tick(now += dt, dt);
      travelled += (BUS_SPEED_PXPS * dt) / 1000;
    }
    expect(sys.arrivals - before).toBe(1);
  });

  it("onArrival carries the vehicle and the tick time", () => {
    const { grid, track } = world();
    const seen: { id: number; now: number }[] = [];
    const sys = createVehicleSystem({ onArrival: (v, now) => seen.push({ id: v.id, now }) });
    sys.sync(eco(grid, track), "you");
    sys.tick(50_000, 10_000);   // 360px: crosses the ~250px path once, not twice
    expect(seen).toEqual([{ id: 1, now: 50_000 }]);
  });

  it("sync caps the fleet at MAX_VEHICLES", () => {
    const { grid, track } = world();
    // a second serviced harvester on the same network
    const state = eco(grid, track);
    state.harvesters.push({ id: 2, owner: "you", ownerId: 1, tx: 5, ty: 6 });
    state.harvesters.push({ id: 3, owner: "you", ownerId: 1, tx: 5, ty: 7 });
    const sys = createVehicleSystem();
    sys.sync(state, "you");
    expect(sys.vehicles.length).toBeLessThanOrEqual(MAX_VEHICLES);
    expect(sys.vehicles.length).toBeGreaterThan(1);
  });

  it("sync yields nothing without a factory (setup phases)", () => {
    const { grid, track } = world();
    const state = eco(grid, track);
    state.factories = [];
    const sys = createVehicleSystem();
    sys.sync(state, "you");
    expect(sys.vehicles).toHaveLength(0);
    expect(sys.arrivals).toBe(0);
  });
});
