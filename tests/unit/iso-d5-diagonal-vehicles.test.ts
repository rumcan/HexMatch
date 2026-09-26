import { describe, expect, it } from "vitest";
import { MAP_W, MAP_H } from "../../src/game/config";
import { GRASS, WATER, type Grid } from "../../src/iso/grid";
import {
  createTrack, buildTile, buildRoadDiagonal, roadDiagLinked, setRoadTier, ROAD_TIER,
  OVERPASS_X, highwayRouteTiers, tIdx, resolveDiagonalRoads, type Track,
} from "../../src/iso/track";
import { roadPath } from "../../src/iso/road-routing";
import { depotPathLength, type EconomyState } from "../../src/iso/economy";
import { distanceFactorForPath } from "../../src/iso/loop";
import { TRUCK_SPEED, tickTrucks, truckItems, type Truck } from "../../src/iso/vehicles";
import { CAR_SPEED, tickCars, carItems, planCars, carRoute, type Car } from "../../src/iso/cars";
import { findPath, stepCost, executeCandidate, planFeasibility, type Candidate } from "../../src/iso/ai";
import { buildSnapshot, applySnapshot } from "../../src/iso/snapshot";

type Tile = [number, number];
const flat = (): Grid => ({ w: MAP_W, h: MAP_H, seed: 265,
  terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS), occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), industries: [], towns: [] });
const truck = (route: Tile[]): Truck => ({ ownerId: 1, depotId: 1, factory: route.at(-1)!,
  route, segFast: [], leg: 0, t: 0, reverse: false, deliveries: 0 });
const car = (route: Tile[]): Car => ({ name: "car 1", carIndex: 1, originTownId: 0, destTownId: 0,
  origin: route[0], dest: route.at(-1)!, route, state: "driving", leg: 0, t: 0,
  waitMs: 0, fadeMs: 0, fade: 1, arriveMs: 0, lastTripKey: null });
const connect = (grid: Grid, track: Track, route: Tile[]) => {
  for (const [x, y] of route) buildTile(track, "dirt", x, y, 1);
  for (let n = 1; n < route.length; n++) buildRoadDiagonal(grid, track, ...route[n - 1], ...route[n], 1);
};
const headings = [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

describe("D5 Euclidean vehicle clocks and continuous four-heading placeholders", () => {
  it.each(headings)("trucks interpolate (%i,%i) without a timing shortcut", (dx, dy) => {
    const route: Tile[] = [[10, 10], [10 + dx, 10 + dy]], state = { trucks: [truck(route)] };
    const duration = Math.hypot(dx, dy) / TRUCK_SPEED;
    tickTrucks(state, duration / 2);
    expect(state.trucks[0].t).toBeCloseTo(0.5);
    const item = truckItems(state)[0];
    expect(item.fx).toBeCloseTo(10 + dx / 2); expect(item.fy).toBeCloseTo(10 + dy / 2);
    expect(item.sprite).toMatch(/_(ne|se|sw|nw)$/);
    tickTrucks(state, duration / 2);
    expect(state.trucks[0].deliveries).toBe(1); expect(state.trucks[0].reverse).toBe(true);
    tickTrucks(state, duration / 2);
    expect(state.trucks[0].t).toBeCloseTo(0.5);
  });
  it.each(headings)("cars interpolate (%i,%i) and finish after the geometric duration", (dx, dy) => {
    const route: Tile[] = [[10, 10], [10 + dx, 10 + dy]], state = { cars: [car(route)] };
    const duration = Math.hypot(dx, dy) / CAR_SPEED;
    tickCars(state, duration / 2);
    expect(state.cars[0].t).toBeCloseTo(0.5);
    const item = carItems(state)[0];
    expect(item.fx).toBeCloseTo(10 + dx / 2); expect(item.fy).toBeCloseTo(10 + dy / 2);
    expect(item.sprite).toMatch(/_(ne|se|sw|nw)$/);
    tickCars(state, duration / 2);
    expect(state.cars[0].state).toBe("arriving");
  });
  it("applies paving multiplier once, including the sqrt(2) leg", () => {
    const t = truck([[10, 10], [11, 11]]); t.segFast = [true];
    tickTrucks({ trucks: [t] }, Math.SQRT2 / TRUCK_SPEED / 8);
    expect(t.t).toBeCloseTo(0.5);
  });
  it("crosses a mixed axis/diagonal boundary continuously in one or many ticks", () => {
    const route: Tile[] = [[10, 10], [11, 10], [12, 11], [13, 11]];
    const a = { trucks: [truck(route)] }, b = { trucks: [truck(route)] };
    const ms = (1 + Math.SQRT2 / 2) / TRUCK_SPEED;
    tickTrucks(a, ms);
    for (let n = 0; n < 100; n++) tickTrucks(b, ms / 100);
    expect(b.trucks[0].leg).toBe(a.trucks[0].leg); expect(b.trucks[0].t).toBeCloseTo(a.trucks[0].t);
    expect(truckItems(a)[0]).toMatchObject({ fx: 11.5, fy: 10.5 });
  });
  it("takes two tile-times over an overpass, with no midpoint teleport", () => {
    const route: Tile[] = [[10, 9], [10, 11]];
    const t = truck(route), c = car(route);
    tickTrucks({ trucks: [t] }, 1 / TRUCK_SPEED); tickCars({ cars: [c] }, 1 / CAR_SPEED);
    expect(t.t).toBeCloseTo(0.5); expect(c.t).toBeCloseTo(0.5);
    expect(truckItems({ trucks: [t] })[0]).toMatchObject({ fx: 10, fy: 10 });
  });
});

describe("D5 shared road graph, distance and snapshot bytes", () => {
  it("keeps diagonals behind the DEV flag", () => {
    expect(resolveDiagonalRoads("?diag=1", false)).toBe(false);
    expect(resolveDiagonalRoads("?diag=1", true)).toBe(true);
    expect(resolveDiagonalRoads("", true)).toBe(false);
    const track = createTrack(true), grid = flat(), route: Tile[] = [[10, 10], [11, 11], [12, 12]];
    connect(grid, track, route);
    expect(roadPath(track, 1, [route[0]], new Set([tIdx(...route[2])]))).toEqual(route);
    expect(planCars(track, [car(route)], 1)[0].route).toEqual(route);
    track.diagonalRoads = false; track.revision++;
    expect(roadPath(track, 1, [route[0]], new Set([tIdx(...route[2])]))).toBeNull();
    expect(planCars(track, [car(route)], 1)[0].route).not.toEqual(route);
  });
  it("cars retain a valid overpass-jump route instead of treating it as disconnected", () => {
    const t = createTrack(true);
    for (const y of [9, 10, 11]) buildTile(t, "road", 10, y, 1);
    for (const x of [9, 10, 11]) { buildTile(t, "road", x, 10, 1); setRoadTier(t, x, 10, ROAD_TIER.highway); }
    setRoadTier(t, 10, 10, OVERPASS_X);
    const c = car([[10, 9], [10, 11]]); c.t = 0.4;
    expect(planCars(t, [c], 1)[0]).toMatchObject({ route: c.route, t: 0.4, state: "driving" });
  });
  it("new car trips use the weighted graph, rather than choosing fewest edges", () => {
    const grid = flat(), track = createTrack(true);
    const diagonal: Tile[] = [[10, 10], [11, 9], [12, 10], [13, 9], [14, 10]];
    connect(grid, track, diagonal);
    // No intermediate x-axis road bytes: the explicit diagonal is the only path.
    expect(carRoute(track, diagonal[0], diagonal.at(-1)!)).toEqual(diagonal);
    for (const x of [11, 13]) buildTile(track, "dirt", x, 10, 1);
    expect(carRoute(track, [10, 10], [14, 10])).toEqual([[10, 10], [11, 10], [12, 10], [13, 10], [14, 10]]);
  });
  it("L3 uses sqrt(2), not the route's number of edges", () => {
    const track = createTrack(true), grid = flat();
    connect(grid, track, Array.from({ length: 7 }, (_, n) => [10 + n, 10 + n]));
    const h = { id: 1, owner: "you", ownerId: 1, tx: 10, ty: 8, facing: "sw" as const };
    const state: EconomyState = { grid, track, harvesters: [h], factories: [{ owner: "you", ownerId: 1, tx: 16, ty: 17 }] };
    expect(depotPathLength(state, h)).toBeCloseTo(1 + 6 * Math.SQRT2);
    expect(distanceFactorForPath(depotPathLength(state, h))).toBe(0.7);
  });
  it("truck routes/progress round-trip through the existing snapshot wire shape", () => {
    const track = createTrack(true), grid = flat(), route: Tile[] = [[10, 10], [11, 11], [12, 12]];
    connect(grid, track, route);
    const t = truck(route); t.t = 0.3;
    const wire = { ...t, segFast: [] };
    const snap = buildSnapshot({ seed: 265, track, harvesters: [], factories: [], players: [], setupPhase: false, won: false, trucks: [wire] });
    const loaded = applySnapshot(JSON.parse(JSON.stringify(snap)));
    expect(loaded.trucks?.[0]).toMatchObject({ route, leg: 0, t: 0.3 });
    const state = { trucks: loaded.trucks! };
    tickTrucks(state, Math.SQRT2 / TRUCK_SPEED / 5);
    expect(state.trucks[0].t).toBeCloseTo(0.5);
  });
});

describe("D5 rival eight-neighbour planning and explicit execution", () => {
  it("chooses the shorter diagonal only when enabled", () => {
    const g = flat(), on = createTrack(true), off = createTrack(false);
    const diagonal = findPath(g, on, "dirt", 10, 10, 14, 14, false, 1)!;
    const axis = findPath(g, off, "dirt", 10, 10, 14, 14, false, 1)!;
    expect(diagonal.tiles).toEqual([[10, 10], [11, 11], [12, 12], [13, 13], [14, 14]]);
    expect(diagonal.cost).toBeCloseTo(4 * Math.SQRT2); expect(axis.cost).toBe(8);
  });
  it("refuses blocked-corner, slope and direct Highway-to-Road diagonal steps", () => {
    const g = flat(), t = createTrack(true);
    g.terrain[tIdx(10, 11)] = WATER; g.terrain[tIdx(11, 10)] = WATER;
    expect(stepCost(g, t, "road", 11, 11, 1, [10, 10])).toBe(Infinity);
    g.terrain.fill(GRASS); g.height = new Uint8Array(MAP_W * MAP_H); g.height[tIdx(11, 11)] = 2;
    expect(stepCost(g, t, "road", 11, 11, 1, [10, 10])).toBe(Infinity);
    g.height.fill(0); buildTile(t, "road", 11, 11, 1); setRoadTier(t, 11, 11, ROAD_TIER.highway);
    expect(stepCost(g, t, "road", 11, 11, 1, [10, 10])).toBe(Infinity);
    setRoadTier(t, 11, 11, ROAD_TIER.ramp);
    expect(Number.isFinite(stepCost(g, t, "road", 11, 11, 1, [10, 10]))).toBe(true);
  });
  it("plans Highway ramps from diagonal branches before any tier changes", () => {
    const grid = flat(), track = createTrack(true), path: Tile[] = [[10, 10], [11, 11], [12, 12]];
    for (const [x, y] of [...path, [12, 10] as Tile]) buildTile(track, "road", x, y, 1);
    for (let n = 1; n < path.length; n++) buildRoadDiagonal(grid, track, ...path[n - 1], ...path[n], 1);
    buildRoadDiagonal(grid, track, 11, 11, 12, 10, 1);
    setRoadTier(track, 10, 10, ROAD_TIER.ramp);
    const tiers = highwayRouteTiers(track, path);
    expect(tiers).toEqual([ROAD_TIER.ramp, ROAD_TIER.ramp, ROAD_TIER.highway]);
    path.forEach(([x, y], n) => setRoadTier(track, x, y, tiers[n]));
    expect(roadDiagLinked(track, 11, 11, 12, 10)).toBe(true);
    expect(roadPath(track, 1, [[10, 10]], new Set([tIdx(12, 12)]))).toEqual(path);
  });
  it("rejects a stale blocked diagonal plan without partial paid construction", () => {
    const grid = flat(), track = createTrack(true);
    const path = findPath(grid, track, "road", 10, 10, 12, 12, false, 1)!;
    const c: Candidate = { industry: { id: 0, type: "farm", tx: 12, ty: 15, w: 2, h: 2, output: "grain", banditUntil: 0 },
      hx: 12, hy: 13, facing: "ne", kind: "road", path, cost: {}, score: 1, value: 1 };
    grid.terrain[tIdx(10, 11)] = WATER; grid.terrain[tIdx(11, 10)] = WATER;
    const before = track.road.slice(), revision = track.revision;
    const out = executeCandidate({ grid, track, factories: [], harvesters: [] }, c, "you", 1, 1);
    expect(out.built).toEqual([]); expect(out.spent).toEqual({});
    expect(track.road).toEqual(before); expect(track.revision).toBe(revision);
  });
  it("stamps explicit diagonal links even on existing tiles, not merely PRESENT bytes", () => {
    const grid = flat(), track = createTrack(true);
    const path = findPath(grid, track, "dirt", 10, 10, 12, 12, false, 1)!;
    for (const [x, y] of path.tiles) buildTile(track, "dirt", x, y, 1);
    const c: Candidate = { industry: { id: 0, type: "farm", tx: 12, ty: 15, w: 2, h: 2, output: "grain", banditUntil: 0 },
      hx: 12, hy: 13, facing: "ne", kind: "dirt", path, cost: {}, score: 1, value: 1 };
    const eco: EconomyState = { grid, track, factories: [], harvesters: [] };
    expect(planFeasibility(eco, "dirt", path, c.hx, c.hy, 1, c.facing).executable).toBe(true);
    const out = executeCandidate(eco, c, "you", 1, 1, 0, 1);
    expect(out.built).toEqual(path.tiles); expect(out.spent).toEqual({});
    expect(roadDiagLinked(track, 10, 10, 11, 11)).toBe(true);
    expect(roadDiagLinked(track, 11, 11, 12, 12)).toBe(true);
    expect(roadPath(track, 1, [[10, 10]], new Set([tIdx(12, 12)]))).toEqual(path.tiles);
  });
});
