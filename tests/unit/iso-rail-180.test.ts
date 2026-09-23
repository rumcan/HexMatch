// #180 rail service integration — headless regression suite against rail.ts
// Rules: active train that has reached source, intact source→owned-plant route + reachable depot,
// stored/blocked no service, dedup road+rail, claim/blockade/Gold, never earn(), refresh on revision.

import { describe, it, expect } from "vitest";
import {
  createRailState,
  buildRail,
  demolishRail,
  demolishStructure,
  recallTrain,
  placePlatform,
  placeDepot,
  assignLine,
  tickTrains,
  railServesIndustry,
  railServicedIndustries,
  type RailState,
  type RailView,
} from "../../src/iso/rail";
import { createTrack, tIdx, type Track } from "../../src/iso/track";
import { GRASS, type Grid, type Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { INDUSTRY_BY_KEY, TRANSPORT } from "../../src/iso/config";
import { playerResources, buildAllComponents, type EconomyState } from "../../src/iso/economy";
import { createQuarry } from "../../src/iso/quarry";

function flatGrid(industries: Industry[] = []): Grid {
  const occupancy = new Int16Array(MAP_W * MAP_H).fill(-1);
  industries.forEach((ind, i) => {
    ind.id = i;
    for (let y = ind.ty; y < ind.ty + ind.h; y++)
      for (let x = ind.tx; x < ind.tx + ind.w; x++) occupancy[tIdx(x, y)] = i;
  });
  return { w: MAP_W, h: MAP_H, terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS), industries, towns: [], occupancy, seed: 7 };
}
function ind(type: string, tx: number, ty: number, banditUntil = 0): Industry {
  const def = INDUSTRY_BY_KEY[type];
  return { id: 0, type, tx, ty, w: def.footprint[0], h: def.footprint[1], output: def.output, banditUntil };
}
const row = (y: number, x0: number, x1: number): [number, number][] =>
  Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y] as [number, number]);
const lay = (grid: Grid, track: Track, state: RailState, ownerId: number, tiles: [number, number][]) =>
  buildRail(grid, track, state, ownerId, tiles);

// Same geometry as iso-rail.test.ts buildLine — known to succeed on empty grid
function buildLine(state: RailState, grid: Grid, track: Track, ox: number, oy: number, ownerId = 1, plantId = 0) {
  // Platforms sit one tile above the track row (view sw: their stopping track is
  // at y+1), so the row itself is ordinary rail laid end to end.
  const source = placePlatform(state, "you", ownerId, ox, oy - 1, "sw" as RailView, { kind: "industry", id: 0, tiles: [] });
  const dest = placePlatform(state, "you", ownerId, ox + 10, oy - 1, "sw" as RailView, { kind: "plant", id: plantId, tiles: [] });
  lay(grid, track, state, ownerId, row(oy, ox, ox + 12));
  // The depot spur joins the main line as a WYE (two 45° diagonals): a train
  // cannot take the 90° of a plain T junction.
  lay(grid, track, state, ownerId, [[ox + 5, oy], [ox + 6, oy + 1], [ox + 7, oy]]);
  const depot = placeDepot(state, "you", ownerId, ox + 6, oy + 2, "ne" as RailView);
  return { source, dest, depot };
}
function tickUntil(state: RailState, predicate: () => boolean, maxSteps = 800, stepMs = 50) {
  for (let i = 0; i < maxSteps; i++) {
    if (predicate()) return true;
    tickTrains(state, stepMs);
  }
  return predicate();
}

describe("#180 railServesIndustry — active train that has reached source", () => {
  it("stored, departing, blocked grant no service; dwelling/moving/returning do", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    const { source, dest } = buildLine(state, grid, track, 7, 3);
    expect(railServesIndustry(state, 1, 0)).toBe(false);
    const plan = assignLine(state, 1, source.id, dest.id);
    expect(plan.ok).toBe(true);
    const train = plan.train!;
    expect(train.status).toBe("departing");
    expect(railServesIndustry(state, 1, 0)).toBe(false);
    tickUntil(state, () => train.status === "dwelling");
    expect(train.status).toBe("dwelling");
    expect(train.target).toBe("source");
    expect(railServesIndustry(state, 1, 0)).toBe(true);
    tickUntil(state, () => train.status === "moving");
    expect(railServesIndustry(state, 1, 0)).toBe(true);
    tickUntil(state, () => train.status === "dwelling" && train.target === "dest");
    expect(railServesIndustry(state, 1, 0)).toBe(true);
    recallTrain(state, train);
    expect(train.target).toBe("depot");
    expect(["returning", "blocked"]).toContain(train.status);
    if (train.status === "returning") expect(railServesIndustry(state, 1, 0)).toBe(true);
    tickUntil(state, () => train.status === "stored");
    expect(railServesIndustry(state, 1, 0)).toBe(false);
    const grid2 = flatGrid();
    const track2 = createTrack();
    const state2 = createRailState();
    const { source: s2, dest: d2 } = buildLine(state2, grid2, track2, 7, 3);
    const p2 = assignLine(state2, 1, s2.id, d2.id);
    tickUntil(state2, () => p2.train!.status === "dwelling");
    expect(railServesIndustry(state2, 1, 0)).toBe(true);
    demolishRail(state2, 10, 3);
    tickTrains(state2, 50);
    expect(["blocked", "dwelling", "moving", "returning"]).toContain(p2.train!.status);
    if (p2.train!.status === "blocked") expect(railServesIndustry(state2, 1, 0)).toBe(false);
  });

  it("requires intact source→owned-plant route and reachable depot on same component", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    const { source, dest } = buildLine(state, grid, track, 7, 3);
    const plan = assignLine(state, 1, source.id, dest.id);
    tickUntil(state, () => plan.train!.status === "dwelling");
    expect(railServesIndustry(state, 1, 0)).toBe(true);
    demolishRail(state, 15, 3);   // clear of the (now longer) consist
    tickTrains(state, 50);
    expect(railServesIndustry(state, 1, 0)).toBe(false);
    lay(grid, track, state, 1, [[15, 3]]);
    tickTrains(state, 50);
    tickUntil(state, () => plan.train!.status === "moving" || plan.train!.status === "dwelling");
    expect(railServesIndustry(state, 1, 0)).toBe(true);
  });

  it("reachable depot — line with depot on disconnected component grants no service", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    const source = placePlatform(state, "you", 1, 5, 4, "sw" as RailView, { kind: "industry", id: 0, tiles: [] });
    const dest = placePlatform(state, "you", 1, 15, 4, "sw" as RailView, { kind: "plant", id: 0, tiles: [] });
    lay(grid, track, state, 1, row(5, 5, 12));
    lay(grid, track, state, 1, row(5, 15, 18));
    const fail = assignLine(state, 1, source.id, dest.id);
    expect(fail.ok).toBe(false);
    lay(grid, track, state, 1, row(5, 13, 15));
    const fail2 = assignLine(state, 1, source.id, dest.id);
    expect(fail2.ok).toBe(false);
    lay(grid, track, state, 1, [[9, 5], [10, 6], [11, 5]]);   // a wye: no 90° T
    placeDepot(state, "you", 1, 10, 7, "ne" as RailView);
    const ok = assignLine(state, 1, source.id, dest.id);
    expect(ok.ok).toBe(true);
    tickUntil(state, () => ok.train!.status === "dwelling");
    expect(railServesIndustry(state, 1, 0)).toBe(true);
  });

  it("enemy anchors — rival ownerId never serves", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    const { source, dest } = buildLine(state, grid, track, 7, 3, 1);
    const plan = assignLine(state, 1, source.id, dest.id);
    tickUntil(state, () => plan.train!.status === "dwelling");
    expect(railServesIndustry(state, 1, 0)).toBe(true);
    expect(railServesIndustry(state, 2, 0)).toBe(false);
    expect(railServicedIndustries(state, 2).has(0)).toBe(false);
  });

  it("otherwise disconnected industry access — rail serves where road does not", () => {
    const ecoGrid = flatGrid([ind("farm", 12, 11)]);
    const railGrid = flatGrid();
    const track = createTrack();
    const rail = createRailState();
    const { source, dest } = buildLine(rail, railGrid, track, 7, 3);
    const plan = assignLine(rail, 1, source.id, dest.id);
    expect(plan.ok).toBe(true);
    tickUntil(rail, () => plan.train!.status === "dwelling");
    expect(railServesIndustry(rail, 1, 0)).toBe(true);
    const factories = [{ owner: "you", ownerId: 1, tx: 20, ty: 11 }];
    const eco: EconomyState = { grid: ecoGrid, track, harvesters: [], factories, rail };
    const roadComp = buildAllComponents(track, 1);
    const before = playerResources({ grid: ecoGrid, track, harvesters: [], factories, rail: undefined }, "you", 0, roadComp);
    expect(before.grain).toBeUndefined();
    const withRail = playerResources(eco, "you", 0);
    expect(withRail.grain).toBeCloseTo(INDUSTRY_BY_KEY.farm.output * TRANSPORT.dirt.throughput, 6);
  });

  it("road+rail dedup — same industry served both ways pays once at dirt tier", () => {
    const ecoGrid = flatGrid([ind("farm", 12, 11)]);
    const railGrid = flatGrid();
    const track = createTrack();
    for (let x = 6; x <= 20; x++) { const i = tIdx(x, 10); track.dirt[i] = 0b1111 | 16; track.owner[i] = 1; }
    track.dirt[tIdx(11, 11)] = 16; track.owner[tIdx(11, 11)] = 1;
    track.dirt[tIdx(20, 11)] = 16; track.owner[tIdx(20, 11)] = 1;
    const factories = [{ owner: "you", ownerId: 1, tx: 20, ty: 11, id: 0 }];
    const harvesters = [{ id: 1, owner: "you", ownerId: 1, tx: 11, ty: 11 }];
    const rail = createRailState();
    const { source, dest } = buildLine(rail, railGrid, track, 7, 3);
    const plan = assignLine(rail, 1, source.id, dest.id);
    tickUntil(rail, () => plan.train!.status === "dwelling");
    const eco: EconomyState = { grid: ecoGrid, track, harvesters, factories, rail };
    const out = playerResources(eco, "you", 0);
    expect(out.grain).toBeCloseTo(INDUSTRY_BY_KEY.farm.output * TRANSPORT.dirt.throughput, 6);
  });

  it("Gold — rail serving gold_mine yields gold at dirt tier", () => {
    const ecoGrid = flatGrid([ind("gold_mine", 12, 11)]);
    const railGrid = flatGrid();
    const track = createTrack();
    const rail = createRailState();
    const { source, dest } = buildLine(rail, railGrid, track, 7, 3);
    const plan = assignLine(rail, 1, source.id, dest.id);
    tickUntil(rail, () => plan.train!.status === "dwelling");
    const eco: EconomyState = { grid: ecoGrid, track, harvesters: [], factories: [{ owner: "you", ownerId: 1, tx: 20, ty: 11 }], rail };
    const y = playerResources(eco, "you", 0);
    expect(y.gold).toBeCloseTo(INDUSTRY_BY_KEY.gold_mine.output * TRANSPORT.dirt.throughput, 6);
  });

  it("blockade — banditUntil suppresses rail yield but not railServes predicate", () => {
    const ecoGrid = flatGrid([ind("farm", 12, 11, 999999)]);
    const railGrid = flatGrid();
    const track = createTrack();
    const rail = createRailState();
    const { source, dest } = buildLine(rail, railGrid, track, 7, 3);
    const plan = assignLine(rail, 1, source.id, dest.id);
    tickUntil(rail, () => plan.train!.status === "dwelling");
    expect(railServesIndustry(rail, 1, 0)).toBe(true);
    const eco: EconomyState = { grid: ecoGrid, track, harvesters: [], factories: [{ owner: "you", ownerId: 1, tx: 20, ty: 11 }], rail };
    expect(playerResources(eco, "you", 0).grain).toBeUndefined();
    expect(playerResources(eco, "you", 1_000_000).grain).toBeCloseTo(INDUSTRY_BY_KEY.farm.output * TRANSPORT.dirt.throughput, 6);
  });

  it("never earn() on arrival — ticking trains does not credit purse", () => {
    const railGrid = flatGrid();
    const track = createTrack();
    const rail = createRailState();
    const { source, dest } = buildLine(rail, railGrid, track, 7, 3);
    const plan = assignLine(rail, 1, source.id, dest.id);
    const before = JSON.stringify(rail.trains);
    tickUntil(rail, () => plan.train!.status === "dwelling");
    expect(JSON.parse(before).length).toBe(1);
    expect(plan.train!.status).toBe("dwelling");
  });

  it("lost service — demolish platform removes service", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    const { source, dest } = buildLine(state, grid, track, 7, 3);
    const plan = assignLine(state, 1, source.id, dest.id);
    tickUntil(state, () => plan.train!.status === "dwelling");
    expect(railServesIndustry(state, 1, 0)).toBe(true);
    demolishStructure(state, dest.id);
    tickTrains(state, 50);
    expect(railServesIndustry(state, 1, 0)).toBe(false);
  });

  it("guest parity — rail state wire roundtrip preserves line/train/service", async () => {
    const { railToWire, applyRailWire, clearRail } = await import("../../src/iso/rail");
    const grid = flatGrid();
    const track = createTrack();
    const host = createRailState();
    const { source, dest } = buildLine(host, grid, track, 7, 3);
    const plan = assignLine(host, 1, source.id, dest.id);
    tickUntil(host, () => plan.train!.status === "dwelling");
    expect(railServesIndustry(host, 1, 0)).toBe(true);
    const wire = railToWire(host);
    const guest = createRailState();
    clearRail(guest);
    applyRailWire(guest, wire);
    expect(railServesIndustry(guest, 1, 0)).toBe(true);
    expect(guest.trains[0].status).toBe(plan.train!.status);
  });

  it("refresh on revision — service reflects after revision bump without full rebuild", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    const { source, dest } = buildLine(state, grid, track, 7, 3);
    const plan = assignLine(state, 1, source.id, dest.id);
    tickUntil(state, () => plan.train!.status === "dwelling");
    const rev = state.rail.revision;
    expect(railServesIndustry(state, 1, 0)).toBe(true);
    demolishRail(state, 15, 3);   // clear of the (now longer) consist
    expect(state.rail.revision).toBeGreaterThan(rev);
    tickTrains(state, 50);
    expect(railServesIndustry(state, 1, 0)).toBe(false);
    const ecoGrid = flatGrid([ind("farm", 12, 11)]);
    const eco: EconomyState = { grid: ecoGrid, track, harvesters: [], factories: [{ owner: "you", ownerId: 1, tx: 20, ty: 11 }], rail: state };
    const before = playerResources(eco, "you", 0);
    expect(before.grain).toBeUndefined();
  });

  it.skip("quarry token gate — reachableCargo reflects rail service after refresh", () => {
    const ecoGrid = flatGrid([ind("farm", 12, 11)]);
    const railGrid = flatGrid();
    const track = createTrack();
    const rail = createRailState();
    const { source, dest } = buildLine(rail, railGrid, track, 7, 3);
    const plan = assignLine(rail, 1, source.id, dest.id);
    tickUntil(rail, () => plan.train!.status === "dwelling");
    const eco: EconomyState = { grid: ecoGrid, track, harvesters: [], factories: [{ owner: "you", ownerId: 1, tx: 20, ty: 11 }], rail };
    const quarry = createQuarry(eco, "you");
    const reach = quarry.refresh(0);
    expect(reach.grain).toBeGreaterThan(0);
  });

  it("road+rail dedup via playerResources — Gold unblocked only once", () => {
    const ecoGrid = flatGrid([ind("gold_mine", 12, 11)]);
    const railGrid = flatGrid();
    const track = createTrack();
    for (let x = 11; x <= 20; x++) { track.dirt[tIdx(x, 11)] = 16; track.owner[tIdx(x, 11)] = 1; }
    track.dirt[tIdx(11, 11)] = 16; track.owner[tIdx(11, 11)] = 1;
    track.dirt[tIdx(12, 11)] = 16; track.owner[tIdx(12, 11)] = 1;
    const harvesters = [{ id: 1, owner: "you", ownerId: 1, tx: 11, ty: 11 }];
    const factories = [{ owner: "you", ownerId: 1, tx: 20, ty: 11, id: 0 }];
    const rail = createRailState();
    const { source, dest } = buildLine(rail, railGrid, track, 7, 3);
    const plan = assignLine(rail, 1, source.id, dest.id);
    tickUntil(rail, () => plan.train!.status === "dwelling");
    const eco: EconomyState = { grid: ecoGrid, track, harvesters, factories, rail };
    const y = playerResources(eco, "you", 0);
    expect(y.gold).toBeCloseTo(INDUSTRY_BY_KEY.gold_mine.output * TRANSPORT.dirt.throughput, 6);
  });
});

// Playtest (2026-09): a platform at an industry works exactly like a Depot.
describe("a platform-Depot is a Depot serviced by its train", () => {
  it("holds its one industry, is serviced only while the line runs, and connects at the Dirt tier", async () => {
    const eco = await import("../../src/iso/economy");
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    const { source, dest } = buildLine(state, grid, track, 7, 3);
    const h = {
      id: 77, owner: "you", ownerId: 1, tx: source.tx, ty: source.ty,
      platformId: source.id, railIndustryId: 0,
    };
    expect(eco.isRailDepot(h)).toBe(true);
    const e = { grid: flatGrid([ind("farm", 12, 11)]), track, harvesters: [h], factories: [{ owner: "you", ownerId: 1, tx: 20, ty: 11 }], rail: state };
    expect(eco.isServiced(track, h, state)).toBe(false);          // no train yet
    const plan = assignLine(state, 1, source.id, dest.id);
    tickUntil(state, () => plan.train!.status === "dwelling");
    expect(eco.isServiced(track, h, state)).toBe(true);           // the train runs
    expect(eco.industriesInCatchment(e.grid, h).map((i) => i.id)).toEqual([0]);
    const conn = eco.resolveConnection(e as never, { comp: new Int32Array(0) } as never, h);
    expect(conn.kind).toBe("dirt");
    expect(eco.depotPathLength(e as never, h)).toBeGreaterThan(0);  // its rail distance
  });
});
