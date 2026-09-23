// ══════════════════════════════════════════════════════════════════════════
// RAIL-03 (#177) — the railway's cache and frame contract.
//
// The epic's performance bar is stated as a promise, not a benchmark: ~200 rail
// tiles and two moving trains must hold road-only frame time. Two mechanisms
// carry it, and both are pinned here without a browser:
//
//   1. THE CHUNK RASTER. Track is painted into the same cached chunk raster the
//      roads are painted into, in the same tile walk, with the same gutter — so
//      a rail tile never adds a chunk, a chunk is rasterised once and then only
//      blitted, and the rail pass costs a CONSTANT handful of canvas calls per
//      chunk however many tiles that chunk carries.
//
//   2. THE REVISION GATE. `renderer.syncRailCache` diffs the layer only when
//      `Rail.revision` moves, and then only for the bytes that changed, with
//      `reach = 1` (a rail tile's shape stays inside its own tile). Laying one
//      tile drops one chunk; moving a train drops nothing at all — the train is
//      a draw-list SPRITE, and a rail edit does not even rebuild that list.
// ══════════════════════════════════════════════════════════════════════════
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Atlas, type Manifest } from "../../src/iso/atlas";
import { IsoRenderer, type World } from "../../src/iso/renderer";
import { RoadCache, DEFAULT_ROAD_STYLE, type RoadWorld } from "../../src/iso/road-renderer";
import { createCamera, centerOnMap } from "../../src/iso/camera";
import { generateMap } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { NE, NW, PRESENT, SE, SW } from "../../src/iso/track";
import {
  createRailState, laneTiles, placeDepot, placePlatform, railDrawLayer, railStructureItems,
  trainItems, type RailLayer, type RailState,
} from "../../src/iso/rail";

const railManifest = JSON.parse(readFileSync("assets/railway/manifest.json", "utf8")) as {
  sprites: Record<string, unknown>;
};

/** A rail layer with the given tiles: PRESENT | mask, owner 1, given revision. */
function railLayer(tiles: readonly (readonly [number, number, number])[], revision: number): RailLayer {
  const tile = new Uint8Array(MAP_W * MAP_H);
  const owner = new Uint8Array(MAP_W * MAP_H);
  for (const [tx, ty, mask] of tiles) {
    tile[ty * MAP_W + tx] = PRESENT | mask;
    owner[ty * MAP_W + tx] = 1;
  }
  return { tile, owner, revision };
}

/** A road world with no roads at all and the given railway. */
function worldOf(rail: RailLayer): RoadWorld {
  return { roadBits: new Uint8Array(MAP_W * MAP_H), dirtBits: new Uint8Array(MAP_W * MAP_H), rail };
}

/** A canvas stub that records the ops a chunk raster makes (the sidewalk suite's). */
function recordingSurface() {
  const calls: string[] = [];
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get: (_t, prop: string) => {
      if (prop === "globalAlpha" || prop === "lineWidth" || prop === "lineDashOffset") return 1;
      if (prop === "canvas") return { width: 0, height: 0 };
      return () => {
        if (prop === "stroke" || prop === "fill" || prop === "setTransform") calls.push(prop);
        if (prop === "createPattern") return null;
        return undefined;
      };
    },
    set: () => true,
  });
  return {
    surface: { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement,
    calls,
  };
}

/**
 * Paint, returning the surfaces the cache had to rasterise, their op counts,
 * and how many chunks the frame WALKED (hits + misses) — a chunk with nothing
 * to draw is remembered rather than rasterised, so "chunks on screen" and
 * "rasters built" are different numbers and both matter here.
 */
function paint(cache: RoadCache, world: RoadWorld, cam: { x: number; y: number; zoom: number; vw: number; vh: number }) {
  const surfaces: ReturnType<typeof recordingSurface>[] = [];
  const drawCtx = { drawImage: () => {} } as unknown as CanvasRenderingContext2D;
  const before = cache.stats();
  const blits = cache.paint(drawCtx, cam, world, DEFAULT_ROAD_STYLE, () => {
    const s = recordingSurface();
    surfaces.push(s);
    return s.surface;
  });
  const after = cache.stats();
  const ops = surfaces.reduce((n, s) => n + s.calls.filter((c) => c !== "setTransform").length, 0);
  return {
    surfaces, ops, blits, rasterised: surfaces.length,
    visited: after.hits + after.misses - before.hits - before.misses,
  };
}

const ONE_CHUNK = { x: 0, y: 0, zoom: 1, vw: 480, vh: 240 };
const MANY_CHUNKS = { x: 0, y: 0, zoom: 1, vw: 1600, vh: 800 };

describe("RAIL-03 the railway rides the road cache", () => {
  it("rasterises a chunk once, then only blits it", () => {
    const cache = new RoadCache();
    const world = worldOf(railLayer([[6, 1, NE | SW]], 1));
    const first = paint(cache, world, ONE_CHUNK);
    expect(first.rasterised).toBe(1);
    expect(cache.stats().misses).toBe(1);
    // The track is IN that raster: the rail pass strokes and fills into it.
    expect(first.ops).toBeGreaterThan(1);
    const second = paint(cache, world, ONE_CHUNK);
    expect(second.rasterised).toBe(0);
    expect(cache.stats().hits).toBe(1);
  });

  it("costs the same handful of calls for 40 rail tiles as for one", () => {
    // One chunk on screen, so the counts are that chunk's rail pass alone.
    const one = paint(new RoadCache(), worldOf(railLayer([[6, 1, NE | SW]], 1)), ONE_CHUNK);
    const tiles: [number, number, number][] = [];
    for (let ty = 2; ty <= 6; ty++) for (let tx = 4; tx <= 11; tx++) tiles.push([tx, ty, NE | SW]);
    expect(tiles).toHaveLength(40);
    const many = paint(new RoadCache(), worldOf(railLayer(tiles, 1)), ONE_CHUNK);
    // Same chunk, same surfaces — and the SAME op count: every pass batches the
    // whole chunk into one path, so tile count does not enter the frame path.
    expect(many.rasterised).toBe(one.rasterised);
    expect(many.ops).toBe(one.ops);
  });

  it("adds no chunk of its own to a road-only frame", () => {
    const roads = new Uint8Array(MAP_W * MAP_H);
    for (let ty = 0; ty < 16; ty++) for (let tx = 0; tx < 16; tx++) roads[ty * MAP_W + tx] = NE | SW;
    const rail = railLayer([[6, 1, NE | SW], [7, 2, SE | NW], [8, 3, 0]], 1);
    const withRails = paint(new RoadCache(), { roadBits: roads, dirtBits: new Uint8Array(MAP_W * MAP_H), rail }, MANY_CHUNKS);
    const roadOnly = paint(new RoadCache(), { roadBits: roads, dirtBits: new Uint8Array(MAP_W * MAP_H) }, MANY_CHUNKS);
    // The frame walks the viewport's chunks — 4×4 of them at 1600×800 on the
    // 512×256 chunk grid — and the railway adds none: its tiles land inside
    // chunks the roads already fill, so both frames build the same rasters.
    expect(roadOnly.visited).toBe(16);
    expect(withRails.visited).toBe(16);
    expect(withRails.rasterised).toBe(roadOnly.rasterised);
    expect(withRails.rasterised).toBeGreaterThan(0);
  });

  it("paints the track even when the sprite road mode draws the roads", () => {
    // The A/B seam `__iso.roadMode` switches the ROAD implementation, and the
    // railway has no atlas cells to fall back on: in that mode the rassters
    // carry the track and nothing else, so the two never double-draw a road.
    const roads = new Uint8Array(MAP_W * MAP_H);
    for (let tx = 0; tx < 8; tx++) roads[3 * MAP_W + tx] = NE | SW;
    const rail = railLayer([[6, 1, NE | SW]], 1);
    const world = { roadBits: roads, dirtBits: new Uint8Array(MAP_W * MAP_H), rail };

    const sprite = new RoadCache();
    sprite.setRailOnly(true);
    const both = paint(sprite, world, ONE_CHUNK);
    const trackOnly = new RoadCache();
    trackOnly.setRailOnly(true);
    const bare = paint(trackOnly, worldOf(rail), ONE_CHUNK);
    // Identical op counts: the road pass contributed nothing…
    expect(both.ops).toBe(bare.ops);
    expect(both.ops).toBeGreaterThan(1);            // …and the track is there.

    // The flag is part of a raster's CONTENT, so flipping it re-keys them all.
    sprite.setRailOnly(false);
    expect(sprite.stats().entries).toBe(0);
    expect(sprite.stats().lastInvalidation).toBe("roads");
    // …and the same world then rasterises the roads again, plus the track.
    const textured = paint(sprite, world, ONE_CHUNK);
    expect(textured.ops).toBeGreaterThan(both.ops);
  });

  it("rasterises and blits nothing for a chunk with nothing on it", () => {
    // A corner of the map with no roads and no railway: the frame walks the
    // chunk, remembers it is empty, and neither allocates nor blits a raster.
    const cache = new RoadCache();
    const empty = { roadBits: new Uint8Array(MAP_W * MAP_H), dirtBits: new Uint8Array(MAP_W * MAP_H) };
    const first = paint(cache, empty, ONE_CHUNK);
    expect(first.visited).toBe(1);
    expect(first.rasterised).toBe(0);
    expect(first.blits).toBe(0);
    const second = paint(cache, empty, ONE_CHUNK);
    expect(second.blits).toBe(0);
    expect(cache.stats().hits).toBe(1);
  });

  it("re-rasterises only the chunks a rail edit touches", () => {
    const cache = new RoadCache();
    const layer = railLayer([[6, 1, NE | SW], [20, 5, NE | SW]], 1);
    const world = worldOf(layer);
    const first = paint(cache, world, MANY_CHUNKS);
    expect(first.visited).toBe(16);
    // Only the chunks the track reaches are rasterised — a rail tile is drawn
    // into the chunk that owns it and, through the 64 px gutter, into the
    // rasters of the neighbours it is near. Everything else costs a map lookup.
    expect(first.rasterised).toBeGreaterThan(0);
    expect(first.rasterised).toBeLessThan(first.visited);

    // Tile (6,1) and its ±1-tile neighbourhood sit inside chunk (0,0): exactly
    // one raster is dropped, and the other fifteen stay hits.
    const before = cache.stats();
    cache.invalidateTile(6, 1, "rail", 1);
    const after = paint(cache, world, MANY_CHUNKS);
    expect(after.rasterised).toBe(1);
    expect(cache.stats().misses - before.misses).toBe(1);
    expect(cache.stats().hits - before.hits).toBe(15);

    // Tile (20,5) is the same edit one step from a chunk boundary: its
    // neighbourhood straddles x = 512, so both chunks that can show it drop.
    const before2 = cache.stats();
    cache.invalidateTile(20, 5, "rail", 1);
    const after2 = paint(cache, world, MANY_CHUNKS);
    expect(after2.rasterised).toBe(2);
    expect(cache.stats().misses - before2.misses).toBe(2);
    expect(cache.stats().hits - before2.hits).toBe(14);
  });
});

// ── the renderer's side of the contract ────────────────────────────────────
vi.mock("../../src/iso/building-shadow", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/iso/building-shadow")>(),
  paintBuildingShadows: () => 0,
}));

/** A renderer over a generated map, with the railway's own defs registered. */
function setup() {
  const atlas = new Atlas(JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8")) as Manifest);
  // `loadRailwaySprites` writes these defs when the PNGs land; the geometry is
  // all `place()` needs, and the bitmaps are a browser's business.
  for (const [name, def] of Object.entries(railManifest.sprites)) {
    atlas.manifest.sprites[name] = def as Manifest["sprites"][string];
  }
  const ctx = { clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn() };
  const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
  const world: World = {
    grid: generateMap(1234),
    roadBits: new Uint8Array(MAP_W * MAP_H),
    dirtBits: new Uint8Array(MAP_W * MAP_H),
  };
  const renderer = new IsoRenderer({ terrain: canvas, structures: canvas, overlay: canvas },
    atlas, centerOnMap(createCamera(800, 600)), world);
  renderer.setRoadMode("sprites");
  return { renderer, world };
}

/** The rail bytes that differ between two layers, in the renderer's own walk order. */
function changedTiles(a: RailLayer, b: RailLayer): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < b.tile!.length; i++) {
    if (a.tile![i] === b.tile![i] && a.owner![i] === b.owner![i]) continue;
    out.push([i % MAP_W, (i / MAP_W) | 0]);
  }
  return out;
}
const railCalls = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter((c) => c[2] === "rail").map((c) => [c[0], c[1], c[2], c[3]]);

const trainX = (world: World): number | undefined =>
  [...(world.vehicles ?? [])].reverse().find((i) => i.sprite.startsWith("car-loco"))?.fx;

describe("RAIL-03 the renderer diffs the railway by revision", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("clears once on first sight of the layer, then drops exactly the tiles that changed", () => {
    const { renderer, world } = setup();
    renderer.setWorld(world);                    // the road shadow, no railway yet
    const spy = vi.spyOn(RoadCache.prototype, "invalidateTile");
    const state = createRailState();
    let layer = railDrawLayer(state);
    world.rail = layer;
    spy.mockClear();
    renderer.setWorld(world);
    // First sight of a layer has nothing to diff against: one clear, no walk.
    expect(railCalls(spy)).toHaveLength(0);
    expect(renderer.roadDiagnostics().cache.lastInvalidation).toBe("rail");

    // One tile laid by hand — the drag's own bytes and the revision bump.
    const idx = 72 * MAP_W + 70;
    state.rail.tile[idx] = PRESENT | (NE | SW);
    state.rail.owner[idx] = 1;
    state.rail.revision++;
    let next = railDrawLayer(state);
    const changed = changedTiles(layer, next);
    expect(changed).toEqual([[70, 72]]);

    // A rail edit drops exactly those tiles, with the rail reach (1), not the
    // road neighbourhood's (2) — and nothing at all when nothing moved.
    spy.mockClear();
    world.rail = next;
    renderer.setWorld(world);
    expect(railCalls(spy)).toEqual(changed.map(([tx, ty]) => [tx, ty, "rail", 1]));
    layer = next;
    spy.mockClear();
    renderer.setWorld(world);
    expect(spy).not.toHaveBeenCalled();

    // A structure's LANE is rail bytes in the layer too: placing a platform and
    // a depot lays their internal track, and every tile of it drops.
    const platform = placePlatform(state, "you", 1, 70, 72, "se", null);
    const depot = placeDepot(state, "you", 1, 74, 72, "ne");
    next = railDrawLayer(state);
    const arrival = changedTiles(layer, next);
    spy.mockClear();
    world.rail = next;
    renderer.setWorld(world);
    expect(new Set(railCalls(spy).map((c) => [c[0], c[1]]).map(String)))
      .toEqual(new Set(arrival.map((t) => t.join(","))));
    for (const s of [platform, depot]) {
      for (const [x, y] of laneTiles(s)) {
        expect(railCalls(spy).map((c) => [c[0], c[1]]), `lane ${x},${y}`).toContainEqual([x, y]);
      }
    }

    // The diagnostics report the revision and the tier the rasters are baked at.
    expect(renderer.roadDiagnostics().rail).toEqual({
      revision: state.rail.revision, detail: "high", tiles: expect.any(Number),
    });
  });

  it("draws the train as a sprite: moving it repaints no track, on any frame", () => {
    const { renderer, world } = setup();
    renderer.setWorld(world);                    // the road shadow, no railway yet
    const state = createRailState();
    const platform = placePlatform(state, "you", 1, 70, 72, "se", null);
    const depot = placeDepot(state, "you", 1, 74, 72, "ne");
    state.trains.push({
      id: 99, ownerId: 1, lineId: 1, depotId: depot.id, status: "moving", target: "source",
      route: [[72, 72], [73, 72], [74, 72], [75, 72]], dist: 1.5, planRevision: 0,
      dwellMs: 0, dirBit: SE, resold: false,
    });
    const source = { has: () => true };
    // Exactly the game's split: a platform and a depot are STATIC draw items,
    // the train rides the MOVING list beside the lorries (`world.vehicles`).
    const items = () => [...railStructureItems(state), ...trainItems(state, source)];
    world.rail = railDrawLayer(state);
    world.extra = railStructureItems(state);
    world.vehicles = trainItems(state, source);
    renderer.setWorld(world);
    renderer.drawStructures();

    // The track is NOT in the draw list: it is ground, painted by the chunk
    // pass, which is why no sprite can ever be drawn under it.
    expect(renderer.drawOrder.every((p) => !p.sprite.startsWith("rail_"))).toBe(true);
    // The structures and the train are, and the train rides at its fractional
    // position — one item per car: locomotive, tender and wagons.
    expect(renderer.drawOrder.map((p) => p.sprite)).toEqual(
      expect.arrayContaining([`platform_${platform.view}`, `train-depot_${depot.view}`, "car-loco_se", "car-tender_se"]));
    expect(trainX(world)).toBeCloseTo(73.5, 6);

    const spy = vi.spyOn(RoadCache.prototype, "invalidateTile");
    // A rail edit drops chunks, and puts nothing new in the structures list:
    // track is ground, so laying it cannot add a draw item.
    const idx = 72 * MAP_W + 70;
    state.rail.tile[idx] = PRESENT | (NE | SW);
    state.rail.revision++;
    world.rail = railDrawLayer(state);
    renderer.setWorld(world);
    const listBefore = renderer.drawOrder;
    renderer.drawStructures();
    expect(renderer.drawOrder).toStrictEqual(listBefore);

    // …and moving the train repaints no chunk at all: it is a sprite.
    spy.mockClear();
    state.trains[0].dist += 0.4;
    const moved = trainX({ ...world, vehicles: items() });
    expect(moved).toBeGreaterThan(trainX(world)!);
    world.vehicles = trainItems(state, source);
    renderer.drawStructures();
    expect(spy).not.toHaveBeenCalled();
    world.rail = railDrawLayer(state);
    renderer.setWorld(world);
    expect(railCalls(spy)).toHaveLength(0);
    expect(renderer.drawOrder.find((p) => p.sprite === "car-loco_se")?.fx).toBe(moved);
  });
});
