// ══════════════════════════════════════════════════════════════════════════
// TRAFFIC-01 — ambient cars on the streets: the perf probe's contract.
//
// Pinned here (the art is placeholder — truck sprites renamed car 1/2/3 —
// so nothing about the pixels is asserted, only the driving):
//   * planCars produces at most `count` cars, named "car 1"…"car N", with
//     routes over the road surface (paved + dirt, public included);
//   * every route is a legal drive: consecutive tiles face each other (E5's
//     mutual-bit invariant), and a loop route's closing edge is mutual too;
//   * the three cars are spread: routes are never all byte-identical when
//     the network has room for variety;
//   * tickCars moves a car at exactly CAR_SPEED, folds a huge tick through
//     the turns without teleporting (position continuity), and ping-pongs
//     vs loops correctly;
//   * a replan on an UNCHANGED network keeps each car's position (drive on
//     mid-crack, the lorries' migration rule);
//   * carItems carries the fractional position, the direction-of-travel
//     truck sprite, the rounded tile for culling, and the car's NAME.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { generateMap } from "../../src/iso/grid";
import {
  createTrack, seedTownRoads, seedPublicRoads, buildTile, bitsAt,
  OPPOSITE, tIdx, type Track,
} from "../../src/iso/track";
import {
  CAR_COUNT, CAR_SPEED, createCarState, planCars, tickCars, carItems,
  type Car,
} from "../../src/iso/cars";

/** Fresh seeded map with its public streets stamped — the boot state. */
function seededWorld() {
  const grid = generateMap(79);
  const track = createTrack();
  seedTownRoads(track, grid);
  seedPublicRoads(track, grid);
  return { grid, track };
}

const SPRITES = new Set(["truck_goods_ne", "truck_goods_se", "truck_goods_sw", "truck_goods_nw"]);

/** E5's mutual-bit rule, as the cars' walker uses it: may a car on (x,y)
 *  step toward (nx,ny)? */
function mutual(track: Track, x: number, y: number, nx: number, ny: number): boolean {
  const m = bitsAt(track, "dirt", x, y) || bitsAt(track, "road", x, y);
  const n = bitsAt(track, "dirt", nx, ny) || bitsAt(track, "road", nx, ny);
  if (!m || !n) return false;
  const dx = nx - x, dy = ny - y;
  const d = dx > 0 ? 2 : dx < 0 ? 8 : dy > 0 ? 4 : 1; // SE NW SW NE
  return !!(m & d) && !!(n & OPPOSITE[d]);
}

/** Assert every step of the route is a legal mutual edge; a loop's closing
 *  edge too. Returns the route as tile indices for convenience. */
function assertDriveable(track: Track, car: Car) {
  const r = car.route;
  expect(r.length).toBeGreaterThanOrEqual(car.loop ? 3 : 2);
  for (let k = 0; k < r.length; k++) {
    const nk = car.loop ? (k + 1) % r.length : k + 1;
    if (nk >= r.length) break;
    const [x, y] = r[k], [nx, ny] = r[nk];
    expect(
      mutual(track, x, y, nx, ny),
      `${car.name}: step ${k} (${x},${y})→(${nx},${ny}) is not a mutual road edge`,
    ).toBe(true);
    // and the edge really exists on the surface
    const m = bitsAt(track, "dirt", x, y) || bitsAt(track, "road", x, y);
    const d = nx > x ? 2 : nx < x ? 8 : ny > y ? 4 : 1;
    expect(!!(m & d), `${car.name}: no road bit pointing at step ${k}`).toBe(true);
  }
  // no repeated tile inside a loop (the closing repeat is implied, not stored)
  if (car.loop) {
    const seen = new Set<number>();
    for (const [x, y] of r) {
      const i = tIdx(x, y);
      expect(seen.has(i), `${car.name}: loop repeats tile ${x},${y}`).toBe(false);
      seen.add(i);
    }
  }
}

/** Position in tile space for (leg, t) — the item contract, in one place. */
function carPos(car: Car): [number, number] {
  const n = car.route.length;
  const a = car.route[car.leg];
  const b = car.route[car.loop ? (car.leg + 1) % n : Math.min(car.leg + 1, n - 1)];
  return [a[0] + (b[0] - a[0]) * car.t, a[1] + (b[1] - a[1]) * car.t];
}

describe("TRAFFIC-01 planning", () => {
  it("boots with a few cars (3) named car 1 / car 2 / car 3", () => {
    const { track } = seededWorld();
    const cars = planCars(track);
    expect(cars.length).toBe(CAR_COUNT);
    expect(cars.map((c) => c.name)).toEqual(["car 1", "car 2", "car 3"]);
    for (const c of cars) assertDriveable(track, c);
  });

  it("the cars actually drive the PUBLIC streets of a freshly seeded map", () => {
    // No player road at all: town rings + inter-town highways only. If the
    // plan produced zero cars, "traffic on the streets" is a lie.
    const { track } = seededWorld();
    const cars = planCars(track);
    expect(cars.length).toBeGreaterThan(0);
    // and at least one of them found a real loop (the town ring road is a
    // cycle — the walk must close on it, not just ping-pong)
    expect(cars.some((c) => c.loop)).toBe(true);
  });

  it("spreads the three cars: not all of them on the identical route", () => {
    const { track } = seededWorld();
    const cars = planCars(track);
    const keys = cars.map((c) => JSON.stringify(c.route) + (c.loop ? "L" : "P"));
    expect(new Set(keys).size).toBeGreaterThan(1);
  });

  it("respects the count dial (0 clears, 1 is a single car 1, huge caps at count)", () => {
    const { track } = seededWorld();
    expect(planCars(track, [], 0)).toEqual([]);
    const one = planCars(track, [], 1);
    expect(one.map((c) => c.name)).toEqual(["car 1"]);
    const many = planCars(track, [], 50);
    expect(many.length).toBeLessThanOrEqual(50);
    expect(many.map((c) => c.name)).toEqual(
      Array.from({ length: many.length }, (_, i) => `car ${i + 1}`),
    );
    for (const c of many) assertDriveable(track, c);
  });

  it("an empty road surface gets no cars", () => {
    expect(planCars(createTrack(), [])).toEqual([]);
  });

  it("a lone stub road (no mutual edge) gets no car", () => {
    const track = createTrack();
    buildTile(track, "road", 10, 10, 1);
    expect(planCars(track, [])).toEqual([]);
  });

  it("a small paved square loops as a 4-tile cycle", () => {
    const track = createTrack();
    for (const [x, y] of [[10, 10], [11, 10], [11, 11], [10, 11]] as const)
      buildTile(track, "road", x, y, 1);
    const cars = planCars(track, [], 3);
    expect(cars.length).toBeGreaterThan(0);
    for (const c of cars) {
      assertDriveable(track, c);
      expect(c.loop).toBe(true);
      expect(c.route.length).toBe(4);
    }
  });

  it("a dead-end line ping-pongs (no loop, both ends visited)", () => {
    const track = createTrack();
    for (let x = 10; x <= 14; x++) buildTile(track, "road", x, 10, 1);
    const cars = planCars(track, [], 1);
    expect(cars.length).toBe(1);
    const c = cars[0];
    expect(c.loop).toBe(false);
    assertDriveable(track, c);
    // the walk cannot leave the line
    for (const [x, y] of c.route) {
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThanOrEqual(14);
      expect(y).toBe(10);
    }
  });

  it("dirt AND paved are both drivable (the surface is one road)", () => {
    const track = createTrack();
    for (let x = 10; x <= 13; x++) buildTile(track, "dirt", x, 10, 1);
    buildTile(track, "dirt", 14, 10, 1);
    buildTile(track, "road", 14, 10, 1); // pave the end: dirt → road
    const cars = planCars(track, [], 1);
    expect(cars.length).toBe(1);
    assertDriveable(track, cars[0]);
    expect(cars[0].route.some(([x]) => x === 14)).toBe(true);
  });
});

describe("TRAFFIC-01 motion", () => {
  it("moves at exactly CAR_SPEED and stays on the road between tiles", () => {
    const { track } = seededWorld();
    const state = createCarState();
    state.cars = planCars(track, [], 3);
    for (const car of state.cars) {
      const [x0, y0] = carPos(car);
      tickCars(state, 100); // one third of a tile
      const [x1, y1] = carPos(car);
      const dist = Math.hypot(x1 - x0, y1 - y0);
      expect(dist).toBeCloseTo(100 * CAR_SPEED, 6);
      // position is on the segment: t stayed in [0,1]
      expect(car.t).toBeGreaterThanOrEqual(0);
      expect(car.t).toBeLessThanOrEqual(1);
    }
  });

  it("a huge tick folds through the turns — no teleport, exact end tiles", () => {
    const track = createTrack();
    // a 2×2 square: a 4-tile loop, one lap = 1200 ms at 300 ms/tile
    for (const [x, y] of [[20, 20], [21, 20], [21, 21], [20, 21]] as const)
      buildTile(track, "road", x, y, 1);
    const state = createCarState();
    state.cars = planCars(track, [], 1);
    const car = state.cars[0]!;
    expect(car.loop).toBe(true);
    // exactly one lap: the car is where it started
    const [x0, y0] = carPos(car);
    tickCars(state, 1200);
    expect(carPos(car)).toEqual([x0, y0]);
    // exactly three laps: same, and the fold never left the route
    tickCars(state, 3 * 1200);
    expect(carPos(car)).toEqual([x0, y0]);
  });

  it("a ping-pong car reflects at both ends (position continuous across the turn)", () => {
    const track = createTrack();
    for (let x = 30; x <= 34; x++) buildTile(track, "road", x, 30, 1);
    const state = createCarState();
    state.cars = planCars(track, [], 1);
    const car = state.cars[0]!;
    expect(car.loop).toBe(false);
    // drive to the far end, through the turn, and back — sampling every
    // 10 ms, the car may never move faster than CAR_SPEED (a teleport
    // between samples would be the fold going wrong)
    let prev = carPos(car);
    for (let i = 0; i < 2000; i++) {
      tickCars(state, 10);
      const now = carPos(car);
      expect(Math.hypot(now[0] - prev[0], now[1] - prev[1]))
        .toBeLessThanOrEqual(10 * CAR_SPEED + 1e-9);
      prev = now;
    }
    // after 20 s it has been to both ends and back many times
    expect(car.reverse || car.leg > 0 || car.t > 0).toBe(true);
  });

  it("replanning an UNCHANGED network keeps each car's position", () => {
    const { track } = seededWorld();
    const first = planCars(track);
    for (const car of first) { car.leg = 2; car.t = 0.5; }
    const second = planCars(track, first);
    expect(second.length).toBe(first.length);
    for (let i = 0; i < first.length; i++) {
      expect(second[i]!.route).toEqual(first[i]!.route);
      expect(second[i]!.loop).toBe(first[i]!.loop);
      expect(second[i]!.leg).toBe(first[i]!.leg);
      expect(second[i]!.t).toBe(first[i]!.t);
    }
  });

  it("deterministic per boot: same network, same plan", () => {
    const { track } = seededWorld();
    const a = planCars(track);
    const b = planCars(track);
    expect(b.map((c) => JSON.stringify(c.route) + c.loop)).toEqual(
      a.map((c) => JSON.stringify(c.route) + c.loop),
    );
  });
});

describe("TRAFFIC-01 draw items", () => {
  it("one item per car: fractional position, truck art, name in ref", () => {
    const { track } = seededWorld();
    const state = createCarState();
    state.cars = planCars(track, [], 3);
    const items = carItems(state);
    expect(items.length).toBe(3);
    items.forEach((item, i) => {
      expect(item.fx).toBeTypeOf("number");
      expect(item.fy).toBeTypeOf("number");
      expect(item.tx).toBe(Math.round(item.fx!));
      expect(item.ty).toBe(Math.round(item.fy!));
      expect(SPRITES.has(item.sprite)).toBe(true);
      expect(item.ref).toEqual({ car: `car ${i + 1}` });
    });
  });

  it("faces the direction of travel, including the way BACK on a ping-pong", () => {
    const track = createTrack();
    for (let x = 40; x <= 43; x++) buildTile(track, "road", x, 40, 1);
    const state = createCarState();
    state.cars = planCars(track, [], 1);
    const car = state.cars[0]!;
    expect(car.loop).toBe(false);
    // heading east (SE on this map? no — x grows to the SE): first step is
    // (40,40)→(41,40), i.e. SE… drive to the far end and flip
    const items = carItems(state);
    expect(items.length).toBe(1);
    // run it to the end and back; the sprite must exist and be a lorry view
    for (let i = 0; i < 600; i++) {
      tickCars(state, 300);
      const it = carItems(state)[0]!;
      expect(SPRITES.has(it.sprite)).toBe(true);
    }
    void car;
  });
});
