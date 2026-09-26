import { describe, expect, it, vi } from "vitest";
import { HH, HW, MAP_H, MAP_W } from "../../src/game/config";
import { GRASS, WATER, type Grid } from "../../src/iso/grid";
import {
  createTrack, NE, SE, SW, NW, ROAD_DE, ROAD_DS, ROAD_DW, ROAD_DN,
  roadConnectionMask, roadDiagonalRefusal, tIdx, type Track,
} from "../../src/iso/track";
import {
  buildRail, createRailState, crossingMasksOk, depotRefusal, diagLinked, layPlatformTrack,
  octPath, placePlatform, platformRefusal, platformTrackAt, railDrawLayer, railPath, railPreview,
  RAIL_REFUSAL_TEXT, RAIL_VIEWS, type RailView,
} from "../../src/iso/rail";
import { validateRailDrag } from "../../src/iso/ai";
import {
  DIAG_E, DIAG_N, DIAG_S, DIAG_W, levelCrossing, logicalRailDiagonals, PLANK_BOARDS,
  RAIL_BED_WIDTH, RAIL_GAUGE, RAIL_WIDTH, railTile, type GroundPoint,
} from "../../src/iso/rail-geometry";
import {
  DEFAULT_RAIL_STYLE, paintRailTiles, railBridgeDecksIn, railDetailFor, railTilesIn,
} from "../../src/iso/rail-renderer";
import { roadTile, roadWidth } from "../../src/iso/road-geometry";
import { draperFor } from "../../src/iso/elevation";
import { RoadCache, DEFAULT_ROAD_STYLE } from "../../src/iso/road-renderer";

type Tile = [number, number];
const rich = { wood: 99999, stone: 99999, ore: 99999, oil: 99999, grain: 99999 };
function setup() {
  const grid: Grid = { w: MAP_W, h: MAP_H, seed: 264, terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), industries: [], towns: [] };
  return { grid, track: createTrack(true), state: createRailState() };
}
const orientations = [
  { name: "axis x", x: 1, y: 0, mask: SE | NW, diag: 0, logical: 0 },
  { name: "axis y", x: 0, y: 1, mask: NE | SW, diag: 0, logical: 0 },
  { name: "diagonal E/W", x: 1, y: -1, mask: 0, diag: DIAG_E | DIAG_W, logical: ROAD_DE | ROAD_DW },
  { name: "diagonal N/S", x: 1, y: 1, mask: 0, diag: DIAG_N | DIAG_S, logical: ROAD_DS | ROAD_DN },
];
const run = (x: number, y: number, dx: number, dy: number, half = 3): Tile[] =>
  Array.from({ length: half * 2 + 1 }, (_, i) => [x + (i - half) * dx, y + (i - half) * dy]);
function road(track: Track, path: Tile[], dirt = false, tier = 0) {
  const layer = dirt ? track.dirt : track.road;
  for (const [x, y] of path) { layer[tIdx(x, y)] = 16; track.owner[tIdx(x, y)] = 2; track.tier![tIdx(x, y)] = tier; }
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i], dx = bx - ax, dy = by - ay;
    if (dx && dy) {
      const low = ax < bx ? path[i - 1] : path[i];
      layer[tIdx(...low)] |= dx * dy < 0 ? ROAD_DE : ROAD_DS;
    } else {
      const d = dx > 0 ? SE : dx < 0 ? NW : dy > 0 ? SW : NE;
      const opposite = { [NE]: SW, [SE]: NW, [SW]: NE, [NW]: SE }[d];
      layer[tIdx(ax, ay)] |= d; layer[tIdx(bx, by)] |= opposite;
    }
  }
}
const view = (w: ReturnType<typeof setup>) => ({ grid: w.grid, roadBits: w.track.road,
  dirtBits: w.track.dirt, roadTiers: w.track.tier, rail: railDrawLayer(w.state), diagonalRoads: true });
const finite = (paths: readonly (readonly GroundPoint[])[]) => {
  for (const path of paths) {
    expect(path.length).toBeGreaterThan(0);
    expect(path.flat().every(Number.isFinite)).toBe(true);
  }
};

// No browser/canvas pixels: records projection/drape paths and raster work only.
function recorder(zoom = 2) {
  const ops: { kind: string; style: unknown; paths: GroundPoint[][] }[] = [];
  let paths: GroundPoint[][] = [];
  const ctx = {
    strokeStyle: "" as unknown, fillStyle: "" as unknown, lineWidth: 1, globalAlpha: 1,
    save: vi.fn(), restore: vi.fn(), closePath: vi.fn(), setTransform: vi.fn(), drawImage: vi.fn(), setLineDash: vi.fn(),
    getTransform: () => ({ a: HW * zoom, b: HH * zoom, c: -HW * zoom, d: HH * zoom, e: 0, f: 0 }),
    beginPath: () => { paths = []; }, moveTo: (x: number, y: number) => { paths.push([[x, y]]); },
    lineTo: (x: number, y: number) => { paths[paths.length - 1].push([x, y]); },
    stroke: () => ops.push({ kind: "stroke", style: ctx.strokeStyle, paths }),
    fill: () => ops.push({ kind: "fill", style: ctx.fillStyle, paths }),
    createPattern: () => null, createLinearGradient: () => ({ addColorStop: () => {} }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

describe("D4 crossing rule and geometry agree", () => {
  it.each(Array.from({ length: 256 }, (_, n) => n))("rail mask %i: all road masks and finite rail geometry", (n) => {
    const axis = n & 15, diag = n >> 4;
    const modelRail = logicalRailDiagonals(diag), fullRail = axis | modelRail;
    const tile = railTile(20, 20, 16 | axis, () => 15, 0, diag);
    expect(tile.runs.length).toBeGreaterThan(0);
    finite([...tile.runs, ...tile.bed, ...tile.rails, ...tile.ties, ...tile.stops]);
    for (let r = 0; r < 256; r++) {
      const roadAxis = r & 15, roadDiag = logicalRailDiagonals(r >> 4), fullRoad = roadAxis | roadDiag;
      // Independent list of the four straight pairs, not the implementation's predicate.
      const straight = [NE | SW, SE | NW, ROAD_DE | ROAD_DW, ROAD_DS | ROAD_DN];
      const expected = straight.includes(fullRoad) && straight.includes(fullRail)
        && fullRoad !== fullRail && !(roadDiag && modelRail);
      expect(levelCrossing(roadAxis, axis, roadDiag, diag)).toBe(expected);
      expect(crossingMasksOk(roadAxis, axis, roadDiag, modelRail)).toBe(expected);
    }
  });

  const legal = orientations.flatMap((r, i) => orientations.flatMap((q, j) =>
    i !== j && !(i > 1 && j > 1) ? [{ name: `${r.name} rail / ${q.name} road`, r, q }] : []));
  it.each(legal)("$name: preview, commit, rival validation and planks agree", ({ r, q }) => {
    for (const dirt of [false, true]) for (const reverse of [false, true]) {
      const w = setup(), rail = run(30, 30, r.x, r.y);
      if (reverse) rail.reverse();
      road(w.track, run(30, 30, q.x, q.y), dirt);
      const bytes = [w.track.road.slice(), w.track.dirt.slice(), w.track.owner.slice()];
      const revision = w.state.rail.revision;
      const preview = railPreview(w.grid, w.track, w.state, 1, rich, ...rail[0], ...rail.at(-1)!);
      expect(preview.why).toBeNull(); expect(preview.tiles).toEqual(rail);
      expect(w.state.rail.tile.some((b) => b !== 0)).toBe(false);
      expect(w.state.rail.revision).toBe(revision);
      expect(validateRailDrag(w.grid, w.track, w.state, 1, rail).ok).toBe(true);
      const built = buildRail(w.grid, w.track, w.state, 1, preview.tiles);
      expect(built.why).toBe("ok"); expect(built.built).toEqual(preview.tiles); expect(built.cost).toEqual(preview.cost);
      expect(railPath(w.state, 1, [rail[0]], new Set([tIdx(...rail.at(-1)!)]))).toEqual(rail);
      expect(w.track.road).toEqual(bytes[0]); expect(w.track.dirt).toEqual(bytes[1]); expect(w.track.owner).toEqual(bytes[2]);
      const crossing = railTilesIn(view(w), 30, 30, 30, 30)[0];
      expect(crossing.planks).toHaveLength(PLANK_BOARDS); expect(crossing.plankSlab).not.toBeNull();
      expect(crossing.bed).toEqual([]); expect(crossing.ties).toEqual([]);
      expect(crossing.rails).toEqual(railTile(30, 30, 16 | r.mask, () => 15, 0, r.diag).rails);
    }
  });

  it("accepts PRESENT bytes without feeding them to the direction-vector lookup", () => {
    const tile = railTile(20, 20, 16, () => 15, 16 | SE | NW, DIAG_E | DIAG_W);
    expect(tile.planks).toHaveLength(3); finite(tile.planks);
  });

  it.each([0, 1, 2, 3, 4, 5])("angled planks cover tier %i exactly at both kerbs and stay between rails", (tier) => {
    for (const [r, q] of [[orientations[2], orientations[0]], [orientations[0], orientations[3]]]) {
      const surface = { ...roadTile(0, 0, 16, "paved", () => false), tier }, width = roadWidth(surface);
      const tile = railTile(20, 20, 16 | r.mask, () => 15, q.mask, r.diag, q.logical, width);
      const rn = [-r.y / Math.hypot(r.x, r.y), r.x / Math.hypot(r.x, r.y)];
      const qn = [-q.y / Math.hypot(q.x, q.y), q.x / Math.hypot(q.x, q.y)];
      const acrossRoad: number[] = [];
      finite([...tile.planks, tile.plankSlab!]);
      for (const [x, y] of tile.plankSlab!) {
        const dr = (x - 20.5) * rn[0] + (y - 20.5) * rn[1];
        const dq = (x - 20.5) * qn[0] + (y - 20.5) * qn[1];
        expect(Math.abs(dr)).toBeCloseTo((RAIL_GAUGE + RAIL_WIDTH) / 2 - 0.02, 10);
        expect(Math.abs(dq)).toBeCloseTo(width / 2, 10); acrossRoad.push(dq);
      }
      expect(Math.min(...acrossRoad)).toBeCloseTo(-width / 2, 10);
      expect(Math.max(...acrossRoad)).toBeCloseTo(width / 2, 10);
    }
  });

  it("diagonal rail across an axis road remains ON without the experimental road flag, including production", () => {
    const w = setup(); w.track.diagonalRoads = false; road(w.track, run(20, 20, 1, 0));
    expect(buildRail(w.grid, w.track, w.state, 1, run(20, 20, 1, 1)).why).toBe("ok");
    vi.stubEnv("DEV", false);
    try { expect(railTilesIn({ ...view(w), diagonalRoads: false }, 20, 20, 20, 20)[0].planks).toHaveLength(PLANK_BOARDS); }
    finally { vi.unstubAllEnvs(); }
  });

  it("passes tier widths and the local road flag through the real tile collector", () => {
    for (const tier of [0, 1, 2, 3]) {
      const w = setup(); road(w.track, run(20, 20, 1, 1), false, tier);
      expect(buildRail(w.grid, w.track, w.state, 1, run(20, 20, 1, 0)).why).toBe("ok");
      const world = view(w), tile = railTilesIn(world, 20, 20, 20, 20)[0];
      const expected = railTile(20, 20, 16 | SE | NW, () => 15, 0, 0, ROAD_DS | ROAD_DN,
        roadWidth({ ...roadTile(0, 0, 16, "paved", () => false), tier }));
      expect(tile.planks).toEqual(expected.planks);
      expect(railTilesIn({ ...world, diagonalRoads: false }, 20, 20, 20, 20)[0].planks).toEqual([]);
      vi.stubEnv("DEV", false);
      try { expect(railTilesIn(world, 20, 20, 20, 20)[0].planks).toEqual([]); }
      finally { vi.unstubAllEnvs(); }
    }
  });
});

describe("D4 refusals and prefix safety", () => {
  it.each(["road", "rail"])("refuses an X with an existing %s link at a shared corner (no shared tile)", (kind) => {
    for (const reverse of [false, true]) {
      const w = setup();
      if (kind === "road") road(w.track, [[20, 21], [21, 20]]);
      else expect(buildRail(w.grid, w.track, w.state, 2, [[20, 21], [21, 20]]).why).toBe("ok");
      const path: Tile[] = reverse ? [[21, 21], [20, 20]] : [[20, 20], [21, 21]];
      const before = w.state.rail.tile.slice();
      const preview = railPreview(w.grid, w.track, w.state, 1, rich, ...path[0], ...path[1]);
      expect(preview.why).toBe("diagonal-crossing"); expect(preview.blocked).toContainEqual(path[0]);
      expect(validateRailDrag(w.grid, w.track, w.state, 1, path).why).toBe("diagonal-crossing");
      expect(buildRail(w.grid, w.track, w.state, 1, path)).toMatchObject({ built: [], why: "diagonal-crossing", cost: {} });
      expect(w.state.rail.tile).toEqual(before);
    }
    expect(RAIL_REFUSAL_TEXT["diagonal-crossing"]).toMatch(/cannot cross in an X/);
  });

  it("the road-last construction order also refuses an X through occupied rail flanks", () => {
    const w = setup(); buildRail(w.grid, w.track, w.state, 1, [[20, 21], [21, 20]]);
    w.grid.builtAt = (x, y) => w.state.rail.tile[tIdx(x, y)] & 16 ? "rail" : null;
    expect(roadDiagonalRefusal(w.grid, w.track, 20, 20, 21, 21)).toBe("corner-cut");
  });

  it("refuses two diagonal lines sharing a tile, parallel runs, road curves and a bend at the crossing", () => {
    for (const [roadPath, rail] of [
      [run(20, 20, 1, 1), run(20, 20, 1, -1)],
      [run(20, 20, 1, 0), run(20, 20, 1, 0)],
      [[[19, 20], [20, 20], [20, 21]], run(20, 20, 1, -1)],
      [run(20, 20, 1, 0), [[20, 18], [20, 19], [20, 20], [21, 21], [22, 22]]],
    ] as [Tile[], Tile[]][]) {
      const w = setup(); road(w.track, roadPath);
      const result = buildRail(w.grid, w.track, w.state, 1, rail);
      expect(result.why).not.toBe("ok");
      expect(result.built).not.toContainEqual([20, 20]);
    }
  });

  it("does not let a later 45-degree WYE change a straight crossing into a junction", () => {
    const w = setup(); road(w.track, run(20, 20, 1, 0));
    expect(buildRail(w.grid, w.track, w.state, 1, run(20, 20, 0, 1)).why).toBe("ok");
    const before = w.state.rail.tile.slice();
    const attempt = buildRail(w.grid, w.track, w.state, 1, [[20, 20], [21, 21]]);
    expect(attempt.why).toBe("crossing-curve"); expect(w.state.rail.tile).toEqual(before);
  });

  it("poor-purse previews do not buy half of a diagonal level crossing", () => {
    const w = setup(), path = run(20, 20, 1, 1, 2); road(w.track, run(20, 20, 1, 0));
    const full = railPreview(w.grid, w.track, w.state, 1, rich, ...path[0], ...path.at(-1)!);
    const perTile = Object.fromEntries(Object.entries(full.cost).map(([key, value]) => [key, value! / 5]));
    const purse = Object.fromEntries(Object.entries(perTile).map(([key, value]) => [key, value * 3]));
    const preview = railPreview(w.grid, w.track, w.state, 1, purse, ...path[0], ...path.at(-1)!);
    expect(preview.tiles).not.toContainEqual([20, 20]);
    const built = buildRail(w.grid, w.track, w.state, 1, preview.tiles);
    expect(built.built).toEqual(preview.tiles); expect(built.cost).toEqual(preview.cost);
  });
});

describe("D4 axis-only structures and newer-system audit", () => {
  it.each(RAIL_VIEWS)("platform %s: rejects incoming/outgoing diagonals on its stopping lane, before and after placement", (heading) => {
    const w = setup(), lane = platformTrackAt(30, 30, heading), centre = lane[1];
    const diag = run(...centre, 1, 1, 1);
    expect(buildRail(w.grid, w.track, w.state, 1, diag).why).toBe("ok");
    const factories = [{ ownerId: 1, tx: 32, ty: 33 }];
    expect(platformRefusal(w.grid, [], factories, 1, 30, 30, heading, undefined, undefined, w.state.rail)).toBe("axis-only");
    const clean = setup(), p = placePlatform(clean.state, "one", 1, 30, 30, heading, null);
    layPlatformTrack(clean.grid, clean.track, clean.state, p);
    const before = clean.state.rail.tile.slice();
    expect(buildRail(clean.grid, clean.track, clean.state, 1, [centre, [centre[0] + 1, centre[1] + 1]]).why).toBe("axis-only");
    expect(clean.state.rail.tile).toEqual(before);
  });

  it("detects an incoming-only diagonal at a platform lane even without a stored bit on that tile", () => {
    const w = setup(), endpoint = platformTrackAt(30, 30, "se")[0];
    const [x, y] = endpoint;
    buildRail(w.grid, w.track, w.state, 1, [[x - 1, y - 1], endpoint]);
    expect(w.state.rail.tile[tIdx(x, y)]).toBe(16);
    expect(platformRefusal(w.grid, [], [], 1, 30, 30, "se", undefined, undefined, w.state.rail)).toBe("axis-only");
  });

  it("keeps view headings axis-only and refuses diagonal depot lanes with a readable reason", () => {
    expect(RAIL_VIEWS).toEqual(["ne", "se", "sw", "nw"]);
    const w = setup(); buildRail(w.grid, w.track, w.state, 1, [[20, 20], [21, 21]]);
    expect(depotRefusal(w.grid, w.state, 1, 20, 20, "se")).toBe("axis-only");
    for (const invalid of ["e", "s", "w", "n"] as RailView[]) {
      expect(platformRefusal(w.grid, [], [], 1, 20, 20, invalid)).toBe("axis-only");
      expect(depotRefusal(w.grid, w.state, 1, 20, 20, invalid)).toBe("axis-only");
    }
    expect(RAIL_REFUSAL_TEXT["axis-only"]).toMatch(/axis-only/);
  });

  it("keeps flat diagonals, rejects slope diagonals and retains the sharp-turn rule", () => {
    const w = setup(); w.grid.height = new Uint8Array(MAP_W * MAP_H).fill(1);
    const path: Tile[] = [[20, 20], [21, 21], [22, 22]];
    expect(validateRailDrag(w.grid, w.track, w.state, 1, path).why).toBeNull();
    w.grid.height[tIdx(21, 21)] = 2;
    expect(buildRail(w.grid, w.track, w.state, 1, path).why).toBe("slope-diagonal");
    expect(railPreview(w.grid, w.track, w.state, 1, rich, 20, 20, 22, 22).why).toBe("slope-diagonal");
    const flat = setup();
    expect(buildRail(flat.grid, flat.track, flat.state, 1, [[20, 20], [21, 21], [22, 20]]).why).toBe("too-sharp");
    expect(buildRail(flat.grid, flat.track, flat.state, 1, octPath(30, 30, 35, 33)).why).toBe("ok");
  });

  it("still permits a gentle axis ramp and refuses sea, wide rivers and a dam's water tile", () => {
    const slope = setup(); slope.grid.height = new Uint8Array(MAP_W * MAP_H).fill(1);
    const ramp = run(20, 20, 1, 0);
    for (const [x, y] of ramp.slice(4)) slope.grid.height[tIdx(x, y)] = 2;
    expect(buildRail(slope.grid, slope.track, slope.state, 1, ramp).why).toBe("ok");
    for (const kind of ["sea", "wide", "dam"]) {
      const w = setup();
      const cells = kind === "wide" ? [21, 22, 23] : [21];
      w.grid.rivers = new Uint8Array(MAP_W * MAP_H);
      for (const x of cells) { w.grid.terrain[tIdx(x, 20)] = WATER; if (kind !== "sea") w.grid.rivers[tIdx(x, 20)] = 1; }
      if (kind === "dam") w.grid.builtAt = (x, y) => x === 21 && y === 20 ? "dam" : null;
      const path: Tile[] = Array.from({ length: cells.length + 2 }, (_, i) => [20 + i, 20]);
      expect(buildRail(w.grid, w.track, w.state, 1, path).why).not.toBe("ok");
      expect(w.state.rail.tile[tIdx(21, 20)]).toBe(0);
    }
  });

  it("bridges remain axis-only with their decks, and dam footprints block rail and depots", () => {
    const w = setup(); w.grid.terrain[tIdx(21, 20)] = WATER;
    w.grid.rivers = new Uint8Array(MAP_W * MAP_H); w.grid.rivers[tIdx(21, 20)] = 1;
    expect(buildRail(w.grid, w.track, w.state, 1, [[20, 20], [21, 20], [22, 20]]).why).toBe("ok");
    expect(railBridgeDecksIn(view(w), 20, 20, 22, 20)).toHaveLength(1);
    expect(buildRail(w.grid, w.track, w.state, 1, [[20, 19], [21, 20], [22, 21]]).why).not.toBe("ok");
    expect(diagLinked(w.state.rail, 20, 19, 21, 20)).toBe(false);
    const dam = setup(); dam.grid.builtAt = (x, y) => x === 21 && y === 21 ? "dam" : null;
    expect(buildRail(dam.grid, dam.track, dam.state, 1, [[20, 20], [21, 21], [22, 22]]).why).toBe("occupied");
    expect(depotRefusal(dam.grid, dam.state, 1, 20, 20, "se")).toBe("occupied");
  });
});

describe("D4 cached drawing / lead visual audit support", () => {
  it.each([0.5, 1, 2])("zoom %s: boards stay under continuous steel, no ballast on the crossing, drape stays active", (zoom) => {
    const w = setup(); w.grid.height = new Uint8Array(MAP_W * MAP_H).fill(2);
    road(w.track, run(20, 20, 1, 0)); buildRail(w.grid, w.track, w.state, 1, run(20, 20, 1, 1));
    const tiles = railTilesIn(view(w), 20, 20, 20, 20), elev = draperFor(w.grid), { ctx, ops } = recorder(zoom);
    expect(elev.active).toBe(true); expect(tiles[0].bed).toEqual([]);
    expect(RAIL_BED_WIDTH).toBeGreaterThanOrEqual(0.4); expect(RAIL_BED_WIDTH).toBeLessThanOrEqual(0.45);
    paintRailTiles(ctx, tiles, railDetailFor(2), { ...DEFAULT_RAIL_STYLE, ballast: null }, [], elev);
    const boards = ops.findIndex((o) => o.kind === "fill" && o.style === DEFAULT_RAIL_STYLE.plank);
    expect(boards).toBeGreaterThanOrEqual(0);
    expect(ops[boards].paths).toEqual((zoom === 2 ? tiles[0].planks : [tiles[0].plankSlab!]).map((p) => [...elev.path(p)]));
    expect(ops.slice(boards + 1).some((o) => o.kind === "stroke" && o.paths.length > 0)).toBe(true);
    finite(ops.flatMap((o) => o.paths));
  });

  it("the shared RoadCache only blits on a warm crossing-heavy pan and invalidates a seam edit", () => {
    const w = setup(); road(w.track, run(25, 9, 1, 0));
    expect(buildRail(w.grid, w.track, w.state, 1, run(25, 9, 1, 1)).why).toBe("ok");
    const world = view(w), cache = new RoadCache(), main = recorder(1), recs: ReturnType<typeof recorder>[] = [];
    const surface = vi.fn((width: number, height: number) => {
      const rec = recorder(1); recs.push(rec);
      return { width, height, getContext: () => rec.ctx } as unknown as HTMLCanvasElement;
    });
    const cam = { x: 0, y: -400, zoom: 1, vw: 900, vh: 300 };
    expect(cache.paint(main.ctx, cam, world, DEFAULT_ROAD_STYLE, surface)).toBeGreaterThan(0);
    const allocations = surface.mock.calls.length, ops = recs.reduce((n, r) => n + r.ops.length, 0), misses = cache.stats().misses;
    cache.paint(main.ctx, { ...cam, x: -1 }, world, DEFAULT_ROAD_STYLE, surface);
    expect(surface).toHaveBeenCalledTimes(allocations); expect(cache.stats().misses).toBe(misses);
    expect(recs.reduce((n, r) => n + r.ops.length, 0)).toBe(ops);
    const entries = cache.stats().entries;
    cache.invalidateTile(25, 9, "crossing edit"); expect(cache.stats().entries).toBeLessThan(entries);
    expect(roadConnectionMask(w.track, 25, 9)).toBe(SE | NW);
  });
});
