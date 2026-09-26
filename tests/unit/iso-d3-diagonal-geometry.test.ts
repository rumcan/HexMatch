import { describe, expect, it, vi } from "vitest";
import { HW, MAP_H, MAP_W } from "../../src/game/config";
import {
  DIAGONAL_DIRS, DIR, NE, NW, OPPOSITE, ROAD_DE, ROAD_DN, ROAD_DS, ROAD_DW, SE, SW,
} from "../../src/iso/track";
import {
  continuousRoadFigures, figureBounds, highwayDividerFigures, JUNCTION_GAP, paintFigures,
  portPoint, roadDirections, roadTile, roadWidth, ROAD_WIDTH, SHOULDER_WIDTH,
  SIDEWALK_WIDTH, SIDEWALK_JOINT_INSET, sidewalkJoints, sidewalkOffset, sidewalkPaths, streetLampSpots, tileCentre,
  TRANSITION_BLEND, type GroundPoint, type RoadFigure, type RoadTile,
} from "../../src/iso/road-geometry";
import {
  DEFAULT_ROAD_STYLE, paintRoadTiles, RoadCache, roadBridgeDecksIn, roadTilesIn,
  ROAD_CHUNK_H, ROAD_CHUNK_W, tilesForRect, type RoadWorld,
} from "../../src/iso/road-renderer";
import { draperFor, FLAT_DRAPER } from "../../src/iso/elevation";
import { TOWN_OCC, WATER, type Grid } from "../../src/iso/grid";

const index = (x: number, y: number) => y * MAP_W + x;
const blank = () => new Uint8Array(MAP_W * MAP_H);
const world = () => ({ roadBits: blank(), dirtBits: blank(), roadTiers: blank(), diagonalRoads: true });
const grid = (): Grid => ({ w: MAP_W, h: MAP_H, seed: 1, terrain: blank(),
  occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), industries: [], towns: [] });
const length = (a: GroundPoint, b: GroundPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const finite = (figures: RoadFigure[]) => {
  for (const f of figures) {
    expect(f.points.length).toBeGreaterThan(0);
    expect(f.points.flat().every(Number.isFinite)).toBe(true);
  }
};
const diagonalMask = (n: number) => DIAGONAL_DIRS.reduce((m, d, i) => m | ((n & (1 << i)) ? d : 0), 0);
const highway = (x: number, y: number, axis: number, diagonal = 0): RoadTile =>
  ({ ...roadTile(x, y, 16 | axis, "paved", () => true, false, diagonal), tier: 2 });

// Recording canvas only: asserts paths/styles/cache work, not browser pixels or FPS.
function recorder() {
  const strokes: { colour: unknown; width: number; alpha: number; dash: number[]; offset: number; paths: GroundPoint[][] }[] = [];
  let paths: GroundPoint[][] = [], dash: number[] = [];
  const ctx = {
    strokeStyle: "", fillStyle: "", lineWidth: 1, globalAlpha: 1, lineDashOffset: 0,
    save: vi.fn(), restore: vi.fn(), closePath: vi.fn(), fill: vi.fn(), setTransform: vi.fn(), drawImage: vi.fn(),
    beginPath: () => { paths = []; },
    moveTo: (x: number, y: number) => { paths.push([[x, y]]); },
    lineTo: (x: number, y: number) => { paths[paths.length - 1].push([x, y]); },
    setLineDash: (d: number[]) => { dash = d.slice(); },
    stroke: () => strokes.push({ colour: ctx.strokeStyle, width: ctx.lineWidth, alpha: ctx.globalAlpha,
      dash: dash.slice(), offset: ctx.lineDashOffset, paths: paths.map((p) => p.slice()) }),
    createLinearGradient: () => ({ addColorStop: vi.fn() }), createPattern: () => null,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes };
}

describe("D3 all eight-direction junction figures", () => {
  it.each(Array.from({ length: 256 }, (_, n) => n))("mask %i: both materials, all paved tiers, finite arms and furniture", (n) => {
    const axis = n & 15, diagonal = diagonalMask(n >> 4), dirs = roadDirections(axis, diagonal);
    for (const material of ["dirt", "paved"] as const) {
      for (const tier of material === "dirt" ? [0] : [0, 1, 2, 3]) {
        const tile = roadTile(23, 17, 16 | axis, material, () => true, true, diagonal);
        tile.tier = tier;
        expect(tile.figures.length).toBeGreaterThan(0);
        finite(tile.figures);
        const points = tile.figures.flatMap((f) => f.points);
        for (const d of dirs) expect(points).toContainEqual(portPoint(23, 17, d));
        const paint = paintFigures(23, 17, axis, diagonal);
        finite(paint);
        expect(paint.length).toBe(dirs.length < 2 ? 0 : dirs.length === 2 ? 1 : dirs.length);
        if (dirs.length > 2) for (const f of paint) expect(length(f.points[0], tileCentre(23, 17))).toBeCloseTo(JUNCTION_GAP, 10);
        const walks = sidewalkPaths(23, 17, axis, diagonal, sidewalkOffset(tile));
        finite(walks); finite(walks.flatMap(sidewalkJoints));
        expect(streetLampSpots(23, 17, axis, diagonal, sidewalkOffset(tile)).flat().every(Number.isFinite)).toBe(true);
        expect(Object.values(figureBounds(tile)).every(Number.isFinite)).toBe(true);
        for (const tr of tile.transitions) expect(length(tr.from, tr.to)).toBeCloseTo(TRANSITION_BLEND, 10);
      }
    }
  });

  it.each(DIAGONAL_DIRS)("direction %i has an exact shared corner and normalized sidewalks", (d) => {
    const [dx, dy] = DIR[d], a = portPoint(32, 24, d), b = portPoint(32 + dx, 24 + dy, OPPOSITE[d]);
    expect(a).toEqual(b);
    expect(length(a, tileCentre(32, 24))).toBeCloseTo(Math.SQRT1_2, 12);
    const offset = sidewalkOffset({ ...highway(32, 24, 0, d), tier: 1 });
    const left = sidewalkPaths(32, 24, 0, d, offset).slice(0, 2);
    const right = sidewalkPaths(32 + dx, 24 + dy, 0, OPPOSITE[d], offset).slice(0, 2);
    for (const f of left) {
      expect(length(f.points[1], a)).toBeCloseTo(offset, 12);
      expect(right.map((r) => r.points[1])).toContainEqual(f.points[1]);
      for (const j of sidewalkJoints(f)) {
        expect(length(j.points[0], j.points[1])).toBeCloseTo(SIDEWALK_WIDTH - 2 * SIDEWALK_JOINT_INSET, 12);
        expect((j.points[1][0] - j.points[0][0]) * dx + (j.points[1][1] - j.points[0][1]) * dy).toBeCloseTo(0, 12);
      }
    }
  });

  it.each([0, 1, 2, 3, 4, 5])("tier %i retains its ground width and bounds", (tier) => {
    const tile = { ...highway(10, 10, 0, ROAD_DE | ROAD_DW), tier, sidewalk: tier === 1 };
    const width = ROAD_WIDTH.paved * ([1, 0.8, 1.6, 1.2, 1.6, 1.6][tier]);
    expect(roadWidth(tile)).toBe(width);
    const bounds = figureBounds(tile);
    expect(bounds.u0).toBeLessThanOrEqual(10 - width / 2 - SHOULDER_WIDTH);
    expect(bounds.u1).toBeGreaterThanOrEqual(11 + width / 2 + SHOULDER_WIDTH);
    const { ctx, strokes } = recorder();
    paintRoadTiles(ctx, [tile], DEFAULT_ROAD_STYLE);
    expect(strokes.some((s) => s.colour === DEFAULT_ROAD_STYLE.paved.flat && s.width === width)).toBe(true);
    if (tier === 1) expect(strokes.some((s) => s.colour === DEFAULT_ROAD_STYLE.paint)).toBe(false);
    expect(roadWidth({ ...tile, deck: true })).toBe(ROAD_WIDTH.paved);
    expect(roadWidth({ ...tile, material: "dirt" })).toBe(ROAD_WIDTH.dirt);
  });

  it("keeps lamps outside the carriageway on diagonal bends, T and X mouths", () => {
    for (const [axis, diagonal] of [[SE, ROAD_DE], [0, ROAD_DE | ROAD_DS | ROAD_DW], [0, diagonalMask(15)]]) {
      const tile = { ...highway(12, 12, axis, diagonal), tier: 1 }, centre = tileCentre(12, 12);
      const lamps = streetLampSpots(12, 12, axis, diagonal, sidewalkOffset(tile));
      expect(lamps.length).toBeGreaterThan(0);
      for (const spot of lamps) for (const d of roadDirections(axis, diagonal)) {
        const end = portPoint(12, 12, d), dx = end[0] - centre[0], dy = end[1] - centre[1];
        const t = Math.max(0, Math.min(1, ((spot[0] - centre[0]) * dx + (spot[1] - centre[1]) * dy) / (dx * dx + dy * dy)));
        expect(length(spot, [centre[0] + t * dx, centre[1] + t * dy])).toBeGreaterThan(roadWidth(tile) / 2);
      }
    }
  });
});

describe("D3 stored links, not inferred diagonal adjacency", () => {
  it.each(["roadBits", "dirtBits"] as const)("resolves outgoing and incoming %s links across both materials", (layer) => {
    const w = world();
    w[layer][index(10, 10)] = 16 | ROAD_DE;
    w.roadBits[index(11, 9)] = 16;
    const tiles = roadTilesIn(w, 10, 9, 11, 10);
    expect(tiles.find((t) => t.tx === 10)?.diagonal).toBe(ROAD_DE);
    expect(tiles.find((t) => t.tx === 11)?.diagonal).toBe(ROAD_DW);
    for (const tile of tiles) finite(tile.figures);
    // The receiver can be collected alone: the western link lies outside the requested range.
    expect(roadTilesIn(w, 11, 9, 11, 9)[0].diagonal).toBe(ROAD_DW);
    if (layer === "dirtBits") expect(tiles.find((t) => t.material === "dirt")?.transitions[0].from).toEqual([11, 10]);
    w.diagonalRoads = false;
    expect(roadTilesIn(w, 10, 9, 11, 10).every((t) => !t.diagonal)).toBe(true);
  });

  it("reads a link from either layer even when paving wins, without mutating any bytes", () => {
    const w = world();
    w.roadBits[index(10, 10)] = 16 | SE;
    w.dirtBits[index(10, 10)] = 16 | ROAD_DS;
    w.roadBits[index(11, 11)] = 16;
    const road = w.roadBits.slice(), dirt = w.dirtBits.slice(), tiers = w.roadTiers.slice();
    const tiles = roadTilesIn(w, 10, 10, 11, 11);
    expect(tiles[0]).toMatchObject({ material: "paved", mask: SE, diagonal: ROAD_DS });
    expect(tiles[1].diagonal).toBe(ROAD_DN);
    expect(w.roadBits).toEqual(road); expect(w.dirtBits).toEqual(dirt); expect(w.roadTiers).toEqual(tiers);
  });

  it("production gating wins even over an explicit local renderer override", () => {
    const w = world(); w.roadBits[index(10, 10)] = 16 | ROAD_DS; w.roadBits[index(11, 11)] = 16;
    vi.stubEnv("DEV", false);
    try { expect(roadTilesIn(w, 10, 10, 11, 11).every((t) => !t.diagonal)).toBe(true); }
    finally { vi.unstubAllEnvs(); }
  });

  it("does not invent an arm from presence, an orphan bit, a wrapped map edge or forbidden tier link", () => {
    const w = world();
    w.roadBits[index(10, 10)] = 16; w.roadBits[index(11, 11)] = 16;
    expect(roadTilesIn(w, 10, 10, 11, 11).every((t) => !t.diagonal)).toBe(true);
    w.roadBits[index(10, 10)] |= ROAD_DS;
    w.roadBits[index(11, 11)] = 0;
    expect(roadTilesIn(w, 10, 10, 10, 10)[0].diagonal).toBeUndefined();
    w.roadBits[index(11, 11)] = 16; w.roadTiers[index(11, 11)] = 2;
    expect(roadTilesIn(w, 10, 10, 11, 11).every((t) => !t.diagonal)).toBe(true);
    w.roadBits[index(MAP_W - 1, 10)] = 16 | ROAD_DE;
    w.roadBits[index(0, 10)] = 16;
    expect(roadTilesIn(w, MAP_W - 1, 10, MAP_W - 1, 10)[0].diagonal).toBeUndefined();
  });

  it("keeps all tier-compatible links and sidewalks on Street / town Road only", () => {
    for (const tier of [0, 1, 2, 3]) {
      const w = { ...world(), grid: grid() };
      w.roadBits[index(10, 10)] = 16 | ROAD_DS; w.roadBits[index(11, 11)] = 16;
      for (const i of [index(10, 10), index(11, 11)]) { w.roadTiers[i] = tier; w.grid.occupancy[i] = TOWN_OCC; }
      const tiles = roadTilesIn(w, 10, 10, 11, 11);
      expect(tiles.map((t) => t.diagonal)).toEqual([ROAD_DS, ROAD_DN]);
      expect(tiles.every((t) => t.sidewalk === (tier < 2))).toBe(true);
    }
  });

  it("leaves overpass decks and water bridges axis-only, without changing their bridge axis", () => {
    for (const tier of [4, 5]) {
      const w = world(); w.roadBits[index(10, 10)] = 16 | NE | SW | ROAD_DS;
      w.roadBits[index(11, 11)] = 16; w.roadTiers[index(10, 10)] = tier;
      const tiles = roadTilesIn(w, 10, 10, 11, 11);
      expect(tiles.every((t) => !t.diagonal)).toBe(true);
      expect(tiles.find((t) => t.deck)?.mask).toBe(tier === 4 ? NE | SW : SE | NW);
    }
    const w = { ...world(), grid: grid() };
    w.grid.terrain[index(10, 10)] = WATER;
    w.roadBits[index(10, 10)] = 16 | NE | SW | ROAD_DS; w.roadBits[index(11, 11)] = 16;
    expect(roadTilesIn(w, 10, 10, 11, 11).every((t) => !t.diagonal)).toBe(true);
    const withBits = roadBridgeDecksIn(w, 10, 10, 10, 10);
    w.roadBits[index(10, 10)] &= ~ROAD_DS;
    expect(roadBridgeDecksIn(w, 10, 10, 10, 10)).toEqual(withBits);
    expect(withBits).toHaveLength(1);
  });
});

describe("D3 / #420 continuous Highway divider", () => {
  it.each([false, true])("one uninterrupted stroke along a run (diagonal=%s)", (diagonal) => {
    const tiles = Array.from({ length: 30 }, (_, i) => diagonal
      ? highway(20 + i, 20 + i, 0, (i ? ROAD_DN : 0) | (i < 29 ? ROAD_DS : 0))
      : highway(20 + i, 20, (i ? NW : 0) | (i < 29 ? SE : 0)));
    const runs = highwayDividerFigures(tiles);
    expect(runs).toHaveLength(1);
    expect(runs[0].points[0]).toEqual(tileCentre(20, 20));
    expect(runs[0].points.at(-1)).toEqual(tileCentre(49, diagonal ? 49 : 20));
    const { ctx, strokes } = recorder();
    paintRoadTiles(ctx, tiles, DEFAULT_ROAD_STYLE);
    const dividers = strokes.filter((s) => s.colour === DEFAULT_ROAD_STYLE.paint);
    expect(dividers).toHaveLength(1);
    expect(dividers[0].dash).toEqual([]);
    expect(dividers[0].width).toBeCloseTo(0.03 * 2.2);
    expect(dividers[0].paths).toEqual(runs.map((r) => r.points));
    if (diagonal) expect(strokes.filter((s) => s.colour === DEFAULT_ROAD_STYLE.paved.shoulder)).toHaveLength(1);
  });

  it("joins a diagonal/axis bend and axis highway underneath an overpass, never the crossing deck", () => {
    const tiles = [highway(10, 10, SE, ROAD_DS), highway(11, 10, NW), highway(11, 11, 0, ROAD_DN)];
    expect(highwayDividerFigures(tiles)).toHaveLength(1);
    const middle = { ...highway(20, 20, SE | NW), tier: 4 };
    const crossing = { ...roadTile(20, 20, 16 | NE | SW, "paved", () => true), deck: true };
    const runs = highwayDividerFigures([highway(19, 20, SE), middle, highway(21, 20, NW), crossing]);
    expect(runs).toHaveLength(1);
    expect(runs[0].points.every((p) => p[1] === 20.5)).toBe(true);
    expect(highwayDividerFigures([{ ...tiles[0], tier: 3 }])).toEqual([]);
  });

  it("keeps junction gaps, preserves branches and terminates on closed loops", () => {
    const junction = highway(10, 10, NE, ROAD_DS | ROAD_DW);
    expect(highwayDividerFigures([junction])).toHaveLength(3);
    for (const f of highwayDividerFigures([junction])) expect(length(f.points[0], tileCentre(10, 10))).toBeCloseTo(JUNCTION_GAP);
    const loop: RoadFigure[] = [
      { points: [[0, 0], [1, 0]] }, { points: [[1, 1], [1, 0]] },
      { points: [[1, 1], [0, 1]] }, { points: [[0, 1], [0, 0]] },
    ];
    const joined = continuousRoadFigures(loop);
    expect(joined).toHaveLength(1); expect(joined[0].points).toHaveLength(5);
    expect(joined[0].points[0]).toEqual(joined[0].points.at(-1));
    const branch = continuousRoadFigures([{ points: [[0, 0], [1, 0]] }, { points: [[0, 0], [0, 1]] }, { points: [[0, 0], [-1, 0]] }]);
    expect(branch).toHaveLength(3);
  });

  it("phases diagonal dashed Road markings in world-distance rather than restarting at every corner", () => {
    const a = { ...highway(10, 10, 0, ROAD_DS | ROAD_DN), tier: 0 };
    const b = { ...highway(11, 11, 0, ROAD_DS | ROAD_DN), tier: 0 };
    const { ctx, strokes } = recorder(); paintRoadTiles(ctx, [a, b], DEFAULT_ROAD_STYLE);
    const paint = strokes.filter((s) => s.colour === DEFAULT_ROAD_STYLE.paint);
    expect(paint).toHaveLength(2);
    expect(paint[0].offset).not.toBe(paint[1].offset);
    // Both paths run towards decreasing x/y; their absolute phase advances √2.
    const modulo = (n: number) => ((n % 0.25) + 0.25) % 0.25;
    expect(modulo(paint[1].offset - paint[0].offset)).toBeCloseTo(modulo(Math.SQRT2), 10);
  });
});

describe("D3 elevation and cached chunk seams", () => {
  const seamWorld = (): RoadWorld => {
    const w = world();
    // DE line projects horizontally across X=512, at Y=656. Includes incoming
    // links outside either chunk's collection range.
    for (let i = 0; i < 30; i++) {
      w.roadBits[index(10 + i, 30 - i)] = 16 | (i < 29 ? ROAD_DE : 0);
      w.roadTiers[index(10 + i, 30 - i)] = 2;
    }
    return w;
  };

  it("adjacent chunk gutters compute identical shared tile geometry", () => {
    const w = seamWorld(), gutter = 64;
    const collect = (cx: number) => {
      const r = tilesForRect(cx * ROAD_CHUNK_W - gutter, 2 * ROAD_CHUNK_H - gutter,
        (cx + 1) * ROAD_CHUNK_W + gutter, 3 * ROAD_CHUNK_H + gutter);
      return roadTilesIn(w, r.tx0, r.ty0, r.tx1, r.ty1);
    };
    const left = collect(0), right = collect(1);
    const shared = left.filter((a) => right.some((b) => a.tx === b.tx && a.ty === b.ty));
    expect(shared.length).toBeGreaterThan(2);
    for (const a of shared) expect(right.find((b) => a.tx === b.tx && a.ty === b.ty)).toEqual(a);
    const run = highwayDividerFigures(roadTilesIn(w, 0, 0, MAP_W - 1, MAP_H - 1));
    expect(run).toHaveLength(1);
    expect(run[0].points.some(([u, v]) => (u - v) * HW === ROAD_CHUNK_W)).toBe(true);
  });

  it("uses the real elevation draper for continuous diagonal surfaces and dividers", () => {
    const g = grid();
    g.height = blank(); g.height.fill(2);
    const elev = draperFor(g);
    expect(elev.active).toBe(true);
    const tile = highway(20, 20, 0, ROAD_DS | ROAD_DN);
    const { ctx, strokes } = recorder(); paintRoadTiles(ctx, [tile], DEFAULT_ROAD_STYLE, [], [], elev);
    expect(strokes.find((s) => s.colour === DEFAULT_ROAD_STYLE.paved.flat)?.paths).toEqual([elev.path(tile.figures[0].points)]);
    expect(strokes.find((s) => s.colour === DEFAULT_ROAD_STYLE.paint)?.paths).toEqual([elev.path(highwayDividerFigures([tile])[0].points)]);
    expect(elev.path(tile.figures[0].points)).not.toEqual(FLAT_DRAPER.path(tile.figures[0].points));
  });

  it.each([0.5, 1, 2])("zoom %s: warm panning only blits cropped interiors; mutation invalidates both seam sides", (zoom) => {
    const w = seamWorld(), cache = new RoadCache();
    const main = recorder(), contexts: ReturnType<typeof recorder>[] = [];
    const surface = vi.fn((width: number, height: number) => {
      const rec = recorder(); contexts.push(rec);
      return { width, height, getContext: () => rec.ctx } as unknown as HTMLCanvasElement;
    });
    const cam = { x: 0, y: -2 * ROAD_CHUNK_H * zoom, zoom, vw: 900 * zoom, vh: 200 * zoom };
    expect(cache.paint(main.ctx, cam, w, DEFAULT_ROAD_STYLE, surface)).toBeGreaterThan(1);
    const before = cache.stats(), strokes = contexts.reduce((n, c) => n + c.strokes.length, 0), allocations = surface.mock.calls.length;
    cache.paint(main.ctx, { ...cam, x: -zoom }, w, DEFAULT_ROAD_STYLE, surface);
    expect(cache.stats().misses).toBe(before.misses);
    expect(cache.stats().hits).toBeGreaterThan(before.hits);
    expect(surface).toHaveBeenCalledTimes(allocations);
    expect(contexts.reduce((n, c) => n + c.strokes.length, 0)).toBe(strokes);
    for (const call of vi.mocked(main.ctx.drawImage).mock.calls) {
      expect(call.slice(1, 5)).toEqual([64 * zoom, 64 * zoom, ROAD_CHUNK_W * zoom, ROAD_CHUNK_H * zoom]);
    }
    const [tx, ty] = [28, 12]; // shared port at X=512 between tiles 27,13 and 28,12
    w.roadBits![index(tx - 1, ty + 1)] &= ~ROAD_DE;
    cache.invalidateTile(tx - 1, ty + 1, "diagonal unlink");
    const after = cache.stats();
    expect(after.entries).toBeLessThanOrEqual(before.entries - 2);
    cache.paint(main.ctx, cam, w, DEFAULT_ROAD_STYLE, surface);
    expect(cache.stats().misses).toBeGreaterThan(before.misses);
    const changed = roadTilesIn(w, tx, ty, tx, ty)[0];
    expect(changed.diagonal).toBe(ROAD_DE);
  });

  it("uses the same batched surface pass in an axis-only gutter of the flagged world", () => {
    const tiles = [highway(10, 10, SE), highway(11, 10, SE | NW), highway(12, 10, NW)];
    const { ctx, strokes } = recorder();
    paintRoadTiles(ctx, tiles, DEFAULT_ROAD_STYLE, [], [], FLAT_DRAPER, true);
    const shoulders = strokes.filter((s) => s.colour === DEFAULT_ROAD_STYLE.paved.shoulder);
    expect(shoulders).toHaveLength(1);
    expect(shoulders[0].paths).toHaveLength(1);
    expect(shoulders[0].paths[0][0]).toEqual(tileCentre(10, 10));
    expect(shoulders[0].paths[0].at(-1)).toEqual(tileCentre(12, 10));
  });

  it("keeps sprite-mode suppression and keys caches separately for the local diagonal flag", () => {
    const w = seamWorld(), cache = new RoadCache(), { ctx } = recorder();
    const surface = vi.fn(() => null);
    const cam = { x: 0, y: -512, zoom: 1, vw: 900, vh: 200 };
    cache.setRailOnly(true); cache.paint(ctx, cam, w, DEFAULT_ROAD_STYLE, surface);
    expect(surface).not.toHaveBeenCalled();
    const misses = cache.stats().misses;
    w.diagonalRoads = false; cache.paint(ctx, cam, w, DEFAULT_ROAD_STYLE, surface);
    expect(cache.stats().misses).toBeGreaterThan(misses);
  });
});
