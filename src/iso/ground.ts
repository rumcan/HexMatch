// ══════════════════════════════════════════════════════════════════════════
// W-series — Terrain overhaul: pattern-painted ground.
//
// The old ground was a per-tile sprite puzzle (terrain_grass/water/rough
// diamonds from the shared atlas). This module replaces it with ONE
// continuously painted landscape:
//
//   • the whole map diamond sits on an ANIMATED OCEAN — the seamless water
//     texture scrolls as a canvas pattern anchored to world space, so it
//     pans with the camera and drifts on its own;
//   • the island's land tiles are filled with the seamless grass texture,
//     again world-anchored — adjacent tiles read as one painted meadow with
//     zero per-tile seams (the "puzzle" is gone);
//   • connected, rounded land and inland contours reveal a continuous beach;
//   • shallow-water bands and animated foam follow that same coast path.
//     No separate sand stamps or tinted water diamonds remain.
//
// Everything is a pure function of (grid, camera, time). Textures are the
// seamless 512×512 PNGs in assets/ground/ (tools/make-ground-textures.mjs).
// ══════════════════════════════════════════════════════════════════════════
import { HW, HH, TILE_H, screenToTile, tileToScreen } from "../game/config";
import { GRASS, SAND, WATER, type Grid } from "./grid";
import type { AtlasImage } from "./atlas";
import { traceCoast, type CoastPoint } from "./coastline";
import {
  LEVEL_PX, elevationActive, elevatedWorld, slopeShade, tileCorners,
} from "./elevation";

export const GROUND_TEX_SIZE = 512;

export interface GroundTextures {
  grass: AtlasImage;
  sand: AtlasImage;
  water: AtlasImage;
  /** R1 (#260): the fresh-water texture for rivers; optional so old callers stay valid. */
  river?: AtlasImage;
}

/** Per-zoom canvas patterns for the ground textures. */
export interface GroundPatterns {
  grass: CanvasPattern;
  sand: CanvasPattern;
  water: CanvasPattern;
  river?: CanvasPattern;
}

/**
 * R1 (#260): the river fill the ground paint uses. The renderer's chunk call
 * hands `paintGroundTiles` only grass/sand, so `createGroundPatterns` parks
 * the river pattern here where the paint can find it. Null until textures load
 * (or in stubbed-canvas contexts), and the paint falls back to a flat colour.
 */
let riverFillPattern: CanvasPattern | null = null;
/** Test/debug access to the installed river pattern. */
export const riverPattern = (): CanvasPattern | null => riverFillPattern;

/** The four diamond corners of tile (tx,ty) in world space (1×), clockwise from the top vertex. */
export function tileDiamondWorld(tx: number, ty: number): [number, number][] {
  const [x, y] = tileToScreen(tx, ty);
  return [
    [x, y],                    // N (top vertex)
    [x + HW, y + HH],          // E
    [x, y + TILE_H],           // S (bottom vertex)
    [x - HW, y + HH],          // W
  ];
}

// ── E2 (#267): raised tiles ────────────────────────────────────────────────
/**
 * The tile's diamond corners raised onto the terrain, N/E/S/W, in world space.
 *
 * The lift is a pure screen-Y term (`−height × LEVEL_PX`), exactly the term the
 * road/rail painters' drape reproduces in the ground plane, so the ground and
 * everything lying on it agree to the pixel. With the `elevation` option off
 * every corner height is 0 and this is `tileDiamondWorld`.
 */
export function tileDiamondRaised(grid: Grid, tx: number, ty: number): [number, number][] {
  const corners = tileCorners(grid, tx, ty);
  return tileDiamondWorld(tx, ty)
    .map(([x, y], i) => [x, y - corners[i] * LEVEL_PX] as [number, number]);
}

/**
 * One tile's TOP FACE, as world-space polygons: a single quad when the face is
 * flat or a plain slope, four triangles when it is a saddle.
 *
 * The split matters because the surface the roads drape on is bilinear inside a
 * tile (see `surfaceHeight`), and a bilinear patch is not the flat quad its four
 * corners span when the corners alternate high/low. Drawing those ~7% of tiles
 * as four triangles through the face's centre keeps the painted ground and the
 * draped track on the same surface, and costs one extra vertex each.
 */
export function tileTopFaces(
  grid: Grid, tx: number, ty: number,
  corners: readonly [number, number, number, number] = tileCorners(grid, tx, ty),
): [number, number][][] {
  const pts = tileDiamondRaised(grid, tx, ty);
  if (corners[0] + corners[2] === corners[1] + corners[3]) return [pts];
  const [x, y] = tileToScreen(tx, ty);
  const centre: [number, number] = [
    x, y + HH - ((corners[0] + corners[1] + corners[2] + corners[3]) / 4) * LEVEL_PX,
  ];
  return [
    [pts[0], pts[1], centre], [pts[1], pts[2], centre],
    [pts[2], pts[3], centre], [pts[3], pts[0], centre],
  ];
}

/**
 * How many buckets the slope shading is quantised into. The shade is a smooth
 * number; the PAINT is one translucent fill per bucket, so quantising is what
 * keeps a chunk's hillshade to a handful of fills instead of one per tile.
 * 1/16th of the full range is far below what the eye separates on ground.
 */
export const SHADE_BUCKETS = 16;
/** Translucent ink laid over a lit face, per unit of `slopeShade`. */
export const SHADE_LIGHT_GAIN = 1.6;
/** …and over a face in shadow. Shadow reads stronger than highlight at equal alpha. */
export const SHADE_DARK_GAIN = 1.2;
/** The sun's warm highlight and the cool shadow it casts. */
export const SHADE_LIGHT = "#fff6dc";
export const SHADE_DARK = "#16240f";

/** One world-space segment: a pair of projected points, as the strokes take. */
export type GroundSegment = [[number, number], [number, number]];

/** Quantise a shade to its bucket; 0 is the neutral band, which is not painted. */
export const shadeBucket = (shade: number): number =>
  Math.round(shade * SHADE_BUCKETS) / SHADE_BUCKETS;

// ══════════════════════════════════════════════════════════════════════════
// ART-2 (#382) — a thick, painterly dither between water, sand and grass.
//
// The ground used to change material on a hairline: a 2–7 px feather of grass
// over the beach's inland seam, and translucent bands over the sea shelf. This
// replaces both with a WIDE band (½–1 tile) in which the two materials
// interleave as clumps — sand creeping into the grass, grass tufts in the sand,
// wet sand and foam flecks at the waterline.
//
// A clump field is a pure function of WORLD position and the map seed:
//
//   • `blendNoise(wx, wy, seed, cell)` — three octaves of value noise, the
//     middle one rotated off the axes so no lattice line survives;
//   • `blendCoverage(noise, dist, cfg)` — that noise thresholded against the
//     distance to the material edge, so clumps are dense at the seam and thin
//     out to isolated flecks at the band's far side;
//   • `blendClumps(edges, side, cfg, seed)` — walks the edge polylines, drops a
//     jittered lattice across the band and keeps what the coverage covers.
//
// Nothing in that chain knows which chunk, zoom or detail tier is asking, so
// two neighbouring chunks compute the SAME clumps for the strip they share and
// each paints its own clipped half — the joins match by construction, and host
// and guest agree because the only seed in it is the map's. No `Math.random`,
// no Bayer matrix, no straight lines.
//
// It is baked into the ground chunk cache (`groundFillChunk` in renderer.ts):
// per chunk, per detail tier, never per frame.
// ══════════════════════════════════════════════════════════════════════════

/** One material edge's blend tuning. */
export interface BlendEdgeConfig {
  /**
   * How far the two materials interleave, in world px at 1×. A tile is
   * `2 × HW` = 64 px wide, so 32–64 is the ½–1 tile band ART-2 asks for.
   * 0 switches the dither off and leaves exactly the old narrow feather.
   */
  widthPx: number;
  /** The clump size: the noise lattice cell the mask is sampled on, world px. */
  noiseScale: number;
  /** Threshold contrast. Above 1 the clumps are crisper, below 1 hazier. */
  contrast: number;
}

/** The three edges the ground paints, each with its own tuning. */
export interface GroundBlendConfig {
  /** The beach's inland seam: sand ↔ grass. */
  sandGrass: BlendEdgeConfig;
  /** The shoreline: water ↔ sand — wet sand, foam, sand bars in the shallows. */
  waterSand: BlendEdgeConfig;
  /** Water ↔ grass where there is no beach: river banks, raised shores. */
  waterGrass: BlendEdgeConfig;
}

export type BlendEdgeKind = keyof GroundBlendConfig;

/**
 * The shipped tuning. ½–1 tile bands: the beach seam is the widest (it is the
 * one you stare at from the inland side), the shoreline a little narrower so
 * the surf still reads, and the no-beach water edge narrowest — a river bank
 * has no terrace to hide behind.
 */
export const GROUND_BLEND_DEFAULTS: GroundBlendConfig = {
  sandGrass: { widthPx: 44, noiseScale: 15, contrast: 1.15 },
  waterSand: { widthPx: 40, noiseScale: 13, contrast: 1.3 },
  waterGrass: { widthPx: 34, noiseScale: 14, contrast: 1.1 },
};

const cloneBlend = (c: GroundBlendConfig): GroundBlendConfig => ({
  sandGrass: { ...c.sandGrass }, waterSand: { ...c.waterSand }, waterGrass: { ...c.waterGrass },
});

/** The EFFECTIVE tuning the paint reads. `applyGroundBlendSearch` may move it (DEV). */
export const GROUND_BLEND: GroundBlendConfig = cloneBlend(GROUND_BLEND_DEFAULTS);

/** Back to the shipped tuning. Baked fields are keyed by the tuning, so they re-bake. */
export function resetGroundBlend(): GroundBlendConfig {
  const d = cloneBlend(GROUND_BLEND_DEFAULTS);
  GROUND_BLEND.sandGrass = d.sandGrass;
  GROUND_BLEND.waterSand = d.waterSand;
  GROUND_BLEND.waterGrass = d.waterGrass;
  return GROUND_BLEND;
}

/**
 * DEV-only `?groundBlend=<width>,<scale>,<contrast>` — one triple applied to
 * all three edges, so the lead can compare looks in the browser without a
 * rebuild. `null` when the parameter is absent or unusable; a partial triple
 * (`?groundBlend=64`) keeps the shipped scale and contrast.
 */
export function parseGroundBlend(search: string): BlendEdgeConfig | null {
  const m = /(?:^|[?&])groundBlend=([^&#]*)/.exec(search ?? "");
  if (!m) return null;
  const [w, s, c] = m[1].split(",").map((v) => Number(v.trim()));
  if (!Number.isFinite(w) || w < 0) return null;
  return {
    widthPx: w,
    noiseScale: Number.isFinite(s) && s > 0 ? s : GROUND_BLEND_DEFAULTS.sandGrass.noiseScale,
    contrast: Number.isFinite(c) && c > 0 ? c : GROUND_BLEND_DEFAULTS.sandGrass.contrast,
  };
}

/**
 * Install the DEV override. A no-op in a production build (`import.meta.env.DEV`
 * is folded away) and when the parameter is absent. Call `resetGroundBlend()`
 * to undo it; the clump caches are keyed by the tuning, so a change cannot leak
 * into a chunk already baked.
 */
export function applyGroundBlendSearch(
  search: string = typeof location !== "undefined" && typeof location.search === "string"
    ? location.search
    : "",
): GroundBlendConfig {
  if (!import.meta.env.DEV) return GROUND_BLEND;
  const cfg = parseGroundBlend(search);
  if (!cfg) return GROUND_BLEND;
  GROUND_BLEND.sandGrass = { ...cfg };
  GROUND_BLEND.waterSand = { ...cfg };
  GROUND_BLEND.waterGrass = { ...cfg };
  return GROUND_BLEND;
}

let blendSearchRead = false;
/** Read the DEV override once, on the first paint that needs the tuning. */
function ensureGroundBlendSearch(): GroundBlendConfig {
  if (!blendSearchRead) { blendSearchRead = true; applyGroundBlendSearch(); }
  return GROUND_BLEND;
}
/** Test hook: let a spec re-read the URL override (or not). */
export function groundBlendSearchRead(): boolean { return blendSearchRead; }

/** The tuning's cache signature — any change re-bakes every clump field. */
const blendSig = (): string => (["sandGrass", "waterSand", "waterGrass"] as const)
  .map((k) => {
    const c = GROUND_BLEND[k];
    return `${k}:${c.widthPx}|${c.noiseScale}|${c.contrast}`;
  }).join(";");

// ── the mask ────────────────────────────────────────────────────────────────
/** Rotate the middle octave's lattice off the world axes. */
const BLEND_COS = Math.cos(0.61), BLEND_SIN = Math.sin(0.61);
/** Where the incoming material's threshold sits at the seam / at the band's end. */
export const BLEND_T_SEAM = 0.06;
export const BLEND_T_END = 0.86;

/** Deterministic integer hash → [0,1). The only randomness in the blend. */
function hash01(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** One octave of value noise on a `wl`-world-px lattice, smoothstep interpolated. */
function valueNoise(wx: number, wy: number, wl: number, seed: number): number {
  const fx = wx / wl, fy = wy / wl;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = smoothstep(fx - x0), ty = smoothstep(fy - y0);
  const a = hash01(x0, y0, seed), b = hash01(x0 + 1, y0, seed);
  const c = hash01(x0, y0 + 1, seed), d = hash01(x0 + 1, y0 + 1, seed);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/**
 * The blend mask: three octaves of value noise at `cell` world px, in [0,1).
 * A pure function of world position and the map seed — the same number on
 * every frame, in every chunk, at every zoom and detail tier, on host and
 * guest. The middle octave is sampled through a rotation so its lattice never
 * lines up with the other two (that alignment is what would read as a grid).
 */
export function blendNoise(wx: number, wy: number, seed: number, cell: number): number {
  const c = cell > 0 ? cell : 1;
  const n0 = valueNoise(wx, wy, c * 2, (seed ^ 0x9e3779b9) | 0);
  const rx = wx * BLEND_COS - wy * BLEND_SIN, ry = wx * BLEND_SIN + wy * BLEND_COS;
  const n1 = valueNoise(rx, ry, c, (seed ^ 0x51ed2701) | 0);
  const n2 = valueNoise(wx, wy, c * 0.5, (seed ^ 0x27d4eb2d) | 0);
  return 0.55 * n0 + 0.3 * n1 + 0.15 * n2;
}

/**
 * How much of the incoming material covers a point `dist` world px into the
 * band: the mask thresholded against a ramp that runs from `BLEND_T_SEAM` at
 * the edge to `BLEND_T_END` at the band's far side. Solid at the seam, sparse
 * flecks at the end, clumpy in between — and with `widthPx` 0 it degenerates
 * to the hard edge the ground had before this ticket.
 */
export function blendCoverage(noise: number, dist: number, cfg: BlendEdgeConfig): number {
  const band = cfg.widthPx;
  if (!(band > 0)) return dist <= 0 ? 1 : 0;
  const t = dist / band;
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  const k = cfg.contrast > 0 ? cfg.contrast : 1;
  const threshold = BLEND_T_SEAM + (BLEND_T_END - BLEND_T_SEAM) * t;
  return Math.min(1, Math.max(0, (noise - threshold) * k + 0.5));
}

// ── the clumps ──────────────────────────────────────────────────────────────
/** A clump field: flat `[x, y, r, shape, …]` in world space. */
export type BlendClumps = Float32Array;
export const BLEND_STRIDE = 4;
export const clumpCount = (c: BlendClumps): number => (c.length / BLEND_STRIDE) | 0;

/** How many sides a clump polygon has — 8 reads as a blob at every zoom. */
const BLOB_SIDES = 8;
const BLOB_COS = Array.from({ length: BLOB_SIDES }, (_, i) => Math.cos((i / BLOB_SIDES) * Math.PI * 2));
const BLOB_SIN = Array.from({ length: BLOB_SIDES }, (_, i) => Math.sin((i / BLOB_SIDES) * Math.PI * 2));
/** Per-vertex radius wobbles, so no two flecks are the same cookie cutter. */
const BLOB_SHAPES: readonly (readonly number[])[] = [
  [1, .86, 1.06, .92, .98, .84, 1.04, .9],
  [.9, 1.04, .88, 1.02, .86, 1.06, .92, .98],
  [1.04, .92, .96, .86, 1.06, .9, .88, 1.02],
  [.96, .9, 1.02, .94, .9, 1, .94, 1.04],
];

/** March step along an edge, and lattice spacing across the band, × the cell. */
const BLEND_STEP = 0.72;
/** How far the lattice is displaced by its own noise, × the cell. */
const BLEND_JITTER = 0.34;
/** Coverage below which a lattice point leaves no clump at all. */
const BLEND_MIN = 0.2;
/** Clump radius at zero / full coverage, × the cell. */
const BLEND_R0 = 0.36;
const BLEND_R1 = 0.3;

/**
 * One edge of a material boundary in world space, with the unit normal pointing
 * at the SOFTER material — sand for `sandGrass`, water for the two water edges.
 * Flat fields, not point pairs: a coastal map has tens of thousands of these.
 */
export interface BlendEdge {
  ax: number; ay: number; bx: number; by: number; nx: number; ny: number;
}

/**
 * Drop the clumps of ONE side of an edge set into `out`.
 *
 * `side` is +1 to scatter the incoming material along `+n` (into the softer
 * material) and −1 for `−n`. The lattice marches the polylines and steps across
 * the band; each point is displaced by its own noise before the mask is read,
 * which is what breaks the rows up — the surviving points keep their coverage
 * as a radius, so a run of them merges into one patch and a lone one is a fleck.
 */
export function blendClumps(
  edges: readonly BlendEdge[],
  side: 1 | -1,
  cfg: BlendEdgeConfig,
  seed: number,
  out: number[] = [],
): number[] {
  const band = cfg.widthPx;
  if (!(band > 0) || edges.length === 0) return out;
  const cell = Math.max(4, cfg.noiseScale);
  const step = cell * BLEND_STEP;
  const rows = Math.max(2, Math.round(band / step));
  const jitter = cell * BLEND_JITTER;
  const jitterSeedA = (seed ^ 0x5bf03ce5) | 0, jitterSeedB = (seed ^ 0x1f3d2ab7) | 0;
  for (const e of edges) {
    const dx = e.bx - e.ax, dy = e.by - e.ay;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) continue;
    const nx = e.nx * side, ny = e.ny * side;
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const ex = e.ax + dx * f, ey = e.ay + dy * f;
      for (let r = 0; r < rows; r++) {
        const d = ((r + 0.5) * band) / rows;
        const qx = ex + nx * d, qy = ey + ny * d;
        const px = qx + (blendNoise(qx, qy, jitterSeedA, cell) - 0.5) * 2 * jitter;
        const py = qy + (blendNoise(qx, qy, jitterSeedB, cell) - 0.5) * 2 * jitter;
        const dist = Math.hypot(px - ex, py - ey);
        const cov = blendCoverage(blendNoise(px, py, seed, cell), dist, cfg);
        if (cov < BLEND_MIN) continue;
        out.push(px, py, cell * (BLEND_R0 + BLEND_R1 * cov),
          (hash01(px | 0, py | 0, seed) * BLOB_SHAPES.length) | 0);
      }
    }
  }
  return out;
}

/** Path a clump field as one batch of polygons (one `fill()` — no overlap seams). */
function pathClumps(
  ctx: CanvasRenderingContext2D, clumps: BlendClumps, k: number,
  scale: number, project: GroundProject,
): void {
  ctx.beginPath();
  for (let i = 0; i < clumps.length; i += BLEND_STRIDE) {
    const r = clumps[i + 2] * k * scale;
    if (!(r > 0.2)) continue;
    const [px, py] = project(clumps[i], clumps[i + 1]);
    const shape = BLOB_SHAPES[clumps[i + 3] | 0] ?? BLOB_SHAPES[0];
    ctx.moveTo(px + shape[0] * r, py);
    for (let v = 1; v < BLOB_SIDES; v++) {
      ctx.lineTo(px + BLOB_COS[v] * shape[v] * r, py + BLOB_SIN[v] * shape[v] * r);
    }
    ctx.closePath();
  }
}

/**
 * Fill a clump field. ALWAYS at `globalAlpha` 1 with the alpha carried by the
 * colour string: the batch is one path, so nonzero winding paints an overlap
 * once, and the elevation paint's hillshade-bucket assertion (which reads every
 * translucent fill after the two material fills) keeps seeing only hillshade.
 */
function paintClumps(
  ctx: CanvasRenderingContext2D, clumps: BlendClumps, fill: string | CanvasPattern,
  k: number, scale: number, project: GroundProject,
): void {
  if (clumps.length === 0) return;
  pathClumps(ctx, clumps, k, scale, project);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** The translucent washes the blend lays under and over the textured clumps. */
export const BLEND_WASH = {
  /** Sand's mean colour (ART_PIPELINE §4 `#cdbb95`), for the soft halo. */
  sand: "rgba(205, 187, 149, 0.34)",
  /** Grass's mean colour (`#354312`). */
  grass: "rgba(53, 67, 18, 0.30)",
  /** Wet sand: the same beach, darkened and cooled by the tide. */
  wetSand: "rgba(84, 74, 48, 0.42)",
  /** Wet ground at a bank with no beach — the river-bank ink's tone. */
  wetGrass: "rgba(24, 46, 40, 0.40)",
  /** Shallow water over the sand bar, the lighter cap colour `#3f8c94`. */
  shallow: "rgba(63, 140, 148, 0.26)",
  /** Foam flecks — `FOAM_RGB`. */
  foam: "rgba(255, 244, 214, 0.34)",
};

/** The foam layer is a narrow, sparse slice of its edge's own band. */
const BLEND_FOAM_BAND = 0.42;
const BLEND_FOAM_CONTRAST = 1.15;
/** How far the soft halo and the solid core reach, × the clump radius. */
const BLEND_SOFT_K = 1.55;
const BLEND_SOLID_K = 0.86;

/** The clump fields one chunk paints, already generated. */
export interface BlendClumpSet {
  /** Clumps on the SOFTER side: sand on the seam, water at a shore. */
  softSide: BlendClumps;
  /** Clumps on the harder side: grass on the seam, dry land at a shore. */
  hardSide: BlendClumps;
  /** Foam flecks on the water — empty for the sand/grass seam. */
  foam: BlendClumps;
}

// ── where the edges come from ───────────────────────────────────────────────
/** Tiles per block of the edge index (a spatial index only; not the chunk size). */
const BLEND_BLOCK = 8;
/** Distances the side probe tries, world px, until the two sides disagree. */
const BLEND_PROBES: readonly number[] = [4, 9, 16, 26, 40];

/** The three edge sets of one spatial block. */
export type BlendEdgeSets = Record<BlendEdgeKind, BlendEdge[]>;
const emptyEdgeSets = (): BlendEdgeSets => ({ sandGrass: [], waterSand: [], waterGrass: [] });

interface BlendIndex { blocks: Map<number, BlendEdgeSets>; padTiles: number }
const blendIndexCache = new WeakMap<Grid, BlendIndex>();
const blendClumpCache = new WeakMap<Grid, { sig: string; sets: Map<string, BlendClumpSets> }>();

/** Drop every cached clump field (the tuning moved, or the map did). */
export function invalidateGroundBlend(grid: Grid): void {
  blendClumpCache.delete(grid);
}
/** Drop the edge index too — the map's terrain or contours changed. */
export function invalidateGroundBlendIndex(grid: Grid): void {
  blendIndexCache.delete(grid);
  blendClumpCache.delete(grid);
}

const terrainAt = (grid: Grid, wx: number, wy: number): number => {
  const [tx, ty] = screenToTile(wx, wy);
  if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) return -1;
  return grid.terrain[ty * grid.w + tx];
};

/**
 * Classify a contour point by sampling both sides of it outward until a
 * distance gives `classify` an answer.
 *
 * The traced coast is a SMOOTHED staircase — `traceCoast` pulls each point up
 * to ~0.45 of a tile toward the mean of its neighbours and then rounds it twice
 * — so one fixed probe distance would land on the wrong tile wherever the
 * smoothing moved the loop. Walking outward and taking the first distance that
 * decides is the most local evidence there is; a point no distance can decide
 * (a loop entirely inside one material) is dropped.
 */
function classifySides<T>(
  grid: Grid, mx: number, my: number, nx: number, ny: number,
  classify: (pos: number, neg: number) => T | null,
): { value: T; pos: number; neg: number } | null {
  for (const d of BLEND_PROBES) {
    const pos = terrainAt(grid, mx + nx * d, my + ny * d);
    const neg = terrainAt(grid, mx - nx * d, my - ny * d);
    if (pos < 0 || neg < 0 || pos === neg) continue;
    const value = classify(pos, neg);
    if (value !== null) return { value, pos, neg };
  }
  return null;
}

/** Bucket key of a block. */
const blockKey = (bx: number, by: number): number => by * 4096 + bx;

/** World px → fractional tile coordinates (the inverse of `tileToScreen`). */
function worldToTileUV(wx: number, wy: number): [number, number] {
  const a = wx / HW, b = wy / HH;
  return [(a + b) / 2, (b - a) / 2];
}

/**
 * Blocks an edge can throw clumps into: its own, plus a margin wide enough for
 * the widest band the tuning can ask for. Four tiles covers a 96 px band, well
 * past the ½–1 tile the ticket specifies, so the index never has to be rebuilt
 * when the DEV override moves the width.
 */
const BLEND_PAD_TILES = 4;

function indexPut(index: Map<number, BlendEdgeSets>, kind: BlendEdgeKind, e: BlendEdge): void {
  const [u0, v0] = worldToTileUV(e.ax, e.ay);
  const [u1, v1] = worldToTileUV(e.bx, e.by);
  const umin = Math.floor(Math.min(u0, u1)) - BLEND_PAD_TILES;
  const umax = Math.ceil(Math.max(u0, u1)) + BLEND_PAD_TILES;
  const vmin = Math.floor(Math.min(v0, v1)) - BLEND_PAD_TILES;
  const vmax = Math.ceil(Math.max(v0, v1)) + BLEND_PAD_TILES;
  for (let by = Math.floor(vmin / BLEND_BLOCK); by <= Math.floor(vmax / BLEND_BLOCK); by++) {
    for (let bx = Math.floor(umin / BLEND_BLOCK); bx <= Math.floor(umax / BLEND_BLOCK); bx++) {
      const k = blockKey(bx, by);
      let set = index.get(k);
      if (!set) { set = emptyEdgeSets(); index.set(k, set); }
      set[kind].push(e);
    }
  }
}

/**
 * Index every material boundary of the map once, bucketed spatially.
 *
 * The FLAT paint's boundaries are the traced contours, not the tile staircase:
 * `traceCoast` smooths the staircase by up to ~0.45 of a tile, so a blend built
 * on the raw tile edges would sit that far off the sand it is supposed to
 * soften and leave the very hard seam this ticket removes. So:
 *
 *   • `coast.inland` (the boundary of the non-sand land) → `sandGrass`, kept
 *     only where the other side really is SAND — where grass meets the sea
 *     directly the water edges below own that transition;
 *   • `coast.land` (everything that is not water, rivers included) → the
 *     waterline, split per segment into `waterSand` and `waterGrass` by the
 *     material of the land tile beside it. River banks (#260) fall out of this
 *     for free and get the no-beach setting.
 *
 * The raised paint does NOT use this: its faces are painted on the diamond
 * edges themselves, so it hands the painter those edges directly.
 */
function blendIndexFor(grid: Grid): BlendIndex {
  const hit = blendIndexCache.get(grid);
  if (hit) return hit;
  const coast = groundContours(grid);
  const blocks = new Map<number, BlendEdgeSets>();
  /** Add one traced loop, keeping the segments `classify` wants. */
  const addLoop = (
    loop: CoastPoint[], classify: (pos: number, neg: number) => BlendEdgeKind | null,
  ): void => {
    for (let i = 0; i < loop.length; i++) {
      const [ax, ay] = loop[i], [bx, by] = loop[(i + 1) % loop.length];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 0.001) continue;
      let nx = -dy / len, ny = dx / len;
      const hit = classifySides(grid, (ax + bx) / 2, (ay + by) / 2, nx, ny, classify);
      if (!hit) continue;
      // Normal toward the SOFTER material: sand on the seam, water at a shore.
      if (hit.pos !== (hit.value === "sandGrass" ? SAND : WATER)) { nx = -nx; ny = -ny; }
      indexPut(blocks, hit.value, { ax, ay, bx, by, nx, ny });
    }
  };
  // The beach's inland seam — only where the outer side really is beach. Where
  // grass meets the sea with no sand between, the water edges below own it.
  for (const loop of coast.inland) {
    addLoop(loop, (pos, neg) => ((pos === SAND) !== (neg === SAND)
      && isLandTerrain(pos) && isLandTerrain(neg) ? "sandGrass" : null));
  }
  // The waterline: sea, lakes and river banks alike, split by the land beside them.
  for (const loop of coast.land) {
    addLoop(loop, (pos, neg) => {
      const land = pos === WATER ? neg : pos;
      if (land === WATER || !isLandTerrain(land)) return null;
      return land === SAND ? "waterSand" : "waterGrass";
    });
  }
  const index: BlendIndex = { blocks, padTiles: BLEND_PAD_TILES };
  blendIndexCache.set(grid, index);
  return index;
}

/**
 * The material edges that can throw clumps into a tile range: every indexed
 * block the range (plus the widest band) touches. A chunk and its neighbour
 * both ask for the blocks in their shared margin, which is exactly what makes
 * them generate the same clumps for the strip they share.
 */
export function blendEdgesFor(
  grid: Grid, tx0: number, ty0: number, tx1: number, ty1: number,
): BlendEdgeSets {
  const index = blendIndexFor(grid);
  const out = emptyEdgeSets();
  // An edge whose padded box straddles a block boundary is indexed in both, so
  // dedupe on identity — otherwise its clumps would be walked (and drawn) twice.
  const seen: Record<BlendEdgeKind, Set<BlendEdge>> = {
    sandGrass: new Set(), waterSand: new Set(), waterGrass: new Set(),
  };
  const take = (kind: BlendEdgeKind, list: BlendEdge[]): void => {
    for (const e of list) {
      if (seen[kind].has(e)) continue;
      seen[kind].add(e);
      out[kind].push(e);
    }
  };
  const bx0 = Math.floor((tx0 - BLEND_PAD_TILES) / BLEND_BLOCK);
  const bx1 = Math.floor((tx1 + 1 + BLEND_PAD_TILES) / BLEND_BLOCK);
  const by0 = Math.floor((ty0 - BLEND_PAD_TILES) / BLEND_BLOCK);
  const by1 = Math.floor((ty1 + 1 + BLEND_PAD_TILES) / BLEND_BLOCK);
  for (let by = by0; by <= by1; by++) {
    for (let bx = bx0; bx <= bx1; bx++) {
      const set = index.blocks.get(blockKey(bx, by));
      if (!set) continue;
      take("sandGrass", set.sandGrass);
      take("waterSand", set.waterSand);
      take("waterGrass", set.waterGrass);
    }
  }
  return out;
}

const emptyClumpSet = (): BlendClumpSet => ({
  softSide: new Float32Array(0), hardSide: new Float32Array(0), foam: new Float32Array(0),
});
export type BlendClumpSets = Record<BlendEdgeKind, BlendClumpSet>;
const emptyClumpSets = (): BlendClumpSets => ({
  sandGrass: emptyClumpSet(), waterSand: emptyClumpSet(), waterGrass: emptyClumpSet(),
});
const BLEND_KINDS: readonly BlendEdgeKind[] = ["sandGrass", "waterSand", "waterGrass"];

/**
 * Generate (once per range and tuning) the clump fields a chunk paints.
 *
 * Cached per grid under the tuning's signature: the fields live in WORLD space,
 * so the same set serves every zoom and every detail tier — a chunk re-baked at
 * another tier re-projects the clumps it already has instead of walking the
 * edges again. `edges` is a thunk because a cache hit must not pay for
 * gathering them.
 */
export function blendClumpSetsFor(
  grid: Grid,
  range: readonly [number, number, number, number],
  edges: () => BlendEdgeSets,
): BlendClumpSets {
  const cfg = ensureGroundBlendSearch();
  const sig = blendSig();
  const key = `${range[0]},${range[1]},${range[2]},${range[3]}`;
  let cache = blendClumpCache.get(grid);
  if (!cache || cache.sig !== sig) {
    cache = { sig, sets: new Map() };
    blendClumpCache.set(grid, cache);
  }
  const hit = cache.sets.get(key);
  if (hit) return hit;
  const seed = grid.seed | 0;
  const sets = emptyClumpSets();
  const byKind = edges();
  for (const kind of BLEND_KINDS) {
    const list = byKind[kind];
    if (list.length === 0) continue;
    const c = cfg[kind];
    if (!(c.widthPx > 0)) continue;                 // width 0 = the old hard edge
    const foam = kind === "sandGrass" ? [] : blendClumps(list, 1, {
      ...c, widthPx: c.widthPx * BLEND_FOAM_BAND, contrast: c.contrast + BLEND_FOAM_CONTRAST,
    }, seed ^ 0x60a5);
    sets[kind] = {
      softSide: Float32Array.from(blendClumps(list, 1, c, seed)),
      hardSide: Float32Array.from(blendClumps(list, -1, c, seed)),
      foam: Float32Array.from(foam),
    };
  }
  cache.sets.set(key, sets);
  return sets;
}

/**
 * Lay the dither over a chunk's ground: both sides of every material edge, in
 * the order a painter would — the soft wash that gives a clump its halo, the
 * real texture on top of it, the tide's wash where water soaks into the beach,
 * and foam last, on the water.
 *
 * Every fill runs at `globalAlpha` 1 with its alpha in the colour, so the batch
 * of overlapping clumps paints as one flat field (nonzero winding) and the
 * elevation paint's hillshade assertion still sees only hillshade.
 */
export function paintGroundBlend(
  ctx: CanvasRenderingContext2D,
  grid: Grid,
  edges: BlendEdgeSets | (() => BlendEdgeSets),
  patterns: { grass: string | CanvasPattern; sand: string | CanvasPattern },
  scale: number,
  project: GroundProject,
  range: readonly [number, number, number, number],
): void {
  const sets = blendClumpSetsFor(grid, range,
    typeof edges === "function" ? edges : () => edges);
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = 1;
  // Sand ↔ grass: grass tufts into the beach, sand patches into the meadow.
  const seam = sets.sandGrass;
  paintClumps(ctx, seam.softSide, BLEND_WASH.grass, BLEND_SOFT_K, scale, project);
  paintClumps(ctx, seam.softSide, patterns.grass, BLEND_SOLID_K, scale, project);
  paintClumps(ctx, seam.hardSide, BLEND_WASH.sand, BLEND_SOFT_K, scale, project);
  paintClumps(ctx, seam.hardSide, patterns.sand, BLEND_SOLID_K, scale, project);
  // Water ↔ land, on both shores: a bar of the beach out in the shallows, the
  // tide soaking back into it, foam riding the water.
  for (const [kind, soft, wet] of [
    ["waterSand", patterns.sand, BLEND_WASH.wetSand],
    ["waterGrass", patterns.grass, BLEND_WASH.wetGrass],
  ] as const) {
    const s = sets[kind];
    paintClumps(ctx, s.softSide, BLEND_WASH.shallow, BLEND_SOFT_K * 1.25, scale, project);
    paintClumps(ctx, s.softSide, soft, BLEND_SOLID_K, scale, project);
    paintClumps(ctx, s.hardSide, wet, BLEND_SOFT_K, scale, project);
    paintClumps(ctx, s.foam, BLEND_WASH.foam, BLEND_SOLID_K, scale, project);
  }
  ctx.globalAlpha = alpha;
}

/** Everything one chunk of raised ground needs, gathered in a single walk. */
interface ElevatedGroundBatch {
  /** Top faces of SAND tiles, projected. */
  sand: [number, number][][];
  /** Top faces of every other land tile, projected. */
  grass: [number, number][][];
  /** Lit faces, by shade bucket, projected. */
  lit: Map<number, [number, number][][]>;
  /** Shaded faces, by shade bucket (a POSITIVE alpha), projected. */
  shaded: Map<number, [number, number][][]>;
  /** The beach's inland seam: edges a grass tile shares with a sand tile. */
  seam: GroundSegment[];
  /** The waterline: edges a land tile shares with sea or river water. */
  waterline: GroundSegment[];
  /** Every land tile's raised diamond — the performance mode's build grid. */
  diamonds: [number, number][][];
  /**
   * ART-2 (#382): the same two edge sets, UNPROJECTED and in world space, with
   * the normal pointing at the softer material. The dither is generated from
   * these — never from the projected ones — so its mask is a function of world
   * position alone and two chunks agree across their join.
   */
  blend: BlendEdgeSets;
}

/** The diamond edge shared with each 4-neighbour, as corner indices (N,E,S,W). */
const TILE_EDGE: readonly (readonly [number, number])[] = [
  [0, 3],   // W (−1, 0)
  [0, 1],   // N (0, −1)
  [1, 2],   // E (+1, 0)
  [3, 2],   // S (0, +1)
];
const TILE_DIRS: readonly (readonly [number, number])[] = [[-1, 0], [0, -1], [1, 0], [0, 1]];

/**
 * Walk one tile range (ringed by one tile, so the padded clip is covered) and
 * collect the raised ground's faces, shades and edges.
 *
 * ONE walk for both ground styles: the textured island and the performance
 * mode's flat paints differ only in what they do with the batch, never in the
 * geometry — which is the property that keeps the two looking like the same
 * island, elevated or not.
 */
function collectElevatedGround(
  grid: Grid, tx0: number, ty0: number, tx1: number, ty1: number,
  project: GroundProject,
): ElevatedGroundBatch {
  const batch: ElevatedGroundBatch = {
    sand: [], grass: [], lit: new Map(), shaded: new Map(),
    seam: [], waterline: [], diamonds: [], blend: emptyEdgeSets(),
  };
  const bucket = (map: Map<number, [number, number][][]>, key: number) => {
    let list = map.get(key);
    if (!list) { list = []; map.set(key, list); }
    return list;
  };
  for (let ty = ty0 - 1; ty <= ty1 + 1; ty++) {
    if (ty < 0 || ty >= grid.h) continue;
    for (let tx = tx0 - 1; tx <= tx1 + 1; tx++) {
      if (tx < 0 || tx >= grid.w) continue;
      const terrain = grid.terrain[ty * grid.w + tx];
      if (terrain === WATER) continue;   // sea and river show the animated water
      const corners = tileCorners(grid, tx, ty);
      const diamond = tileDiamondRaised(grid, tx, ty);
      const faces = tileTopFaces(grid, tx, ty, corners)
        .map((face) => face.map(([x, y]) => project(x, y)));
      (terrain === SAND ? batch.sand : batch.grass).push(...faces);
      batch.diamonds.push(diamond.map(([x, y]) => project(x, y)));

      // Hillshade: one translucent fill per bucket, over the finished ground.
      const shade = shadeBucket(slopeShade(corners));
      if (shade > 0) bucket(batch.lit, shade).push(...faces);
      else if (shade < 0) bucket(batch.shaded, -shade).push(...faces);

      // Edges, from the RAISED corners so they follow the surface exactly.
      for (let d = 0; d < 4; d++) {
        const nx = tx + TILE_DIRS[d][0], ny = ty + TILE_DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) continue;
        const n = grid.terrain[ny * grid.w + nx];
        const [a, b] = TILE_EDGE[d];
        const edge: GroundSegment = [project(...diamond[a]), project(...diamond[b])];
        if (n === WATER) batch.waterline.push(edge);
        else if (terrain !== SAND && n === SAND) batch.seam.push(edge);
        else continue;
        // ART-2: the same edge in world space, normal pointing at the neighbour
        // (the softer material — water at a shore, sand on the beach seam).
        const ddx = TILE_DIRS[d][0], ddy = TILE_DIRS[d][1];
        const vx = (ddx - ddy) * HW, vy = (ddx + ddy) * HH;
        const vl = Math.hypot(vx, vy) || 1;
        const [ax, ay] = diamond[a], [bx2, by2] = diamond[b];
        batch.blend[n === WATER ? (terrain === SAND ? "waterSand" : "waterGrass") : "sandGrass"]
          .push({ ax, ay, bx: bx2, by: by2, nx: vx / vl, ny: vy / vl });
      }
    }
  }
  return batch;
}

/** The two projected points that fix the paint's world scale (pattern widths). */
function paintScale(project: GroundProject): number {
  const [px, py] = project(0, 0), [qx, qy] = project(1, 0);
  return Math.hypot(qx - px, qy - py);
}

/** Stroke a batch of world-space segments, already projected. */
function strokeSegments(
  ctx: CanvasRenderingContext2D, segments: GroundSegment[],
  stroke: string | CanvasPattern, width: number, alpha = 1,
): void {
  if (!segments.length) return;
  ctx.save();
  ctx.beginPath();
  for (const [[ax, ay], [bx, by]] of segments) { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

/**
 * E2 (#267): the raised ground of a tile range, painted through `project`.
 *
 * The flat island is ONE pair of traced contours (`groundContours`); a raised
 * island cannot be, because a contour is a boundary and the terrain's interior
 * now has height in it. So this paints per TILE — top faces batched by material
 * into two fills, hillshade into a handful more, the beach seam and the
 * waterline into two strokes — and keeps every property the flat paint has:
 *
 *   • the patterns are still world-anchored (the caller sets their transforms),
 *     so adjacent tiles read as one continuous meadow;
 *   • faces are batched into one path per material, so shared edges are
 *     traversed in opposite directions and a fill leaves no interior hairline;
 *   • the range is ringed by one tile and clipped to the padded, LIFTED rect of
 *     the caller's own range, which is what seals the chunk joins;
 *   • water tiles are skipped, so the animated ocean shows through them, and
 *     because a corner touching water is level 0 the land ramps down to exactly
 *     the waterline the foam is stroked on (see `elevation.ts`).
 */
export function paintElevatedGroundTiles(
  ctx: CanvasRenderingContext2D,
  grid: Grid,
  tx0: number, ty0: number, tx1: number, ty1: number,
  patterns: { grass: string | CanvasPattern; sand: string | CanvasPattern },
  project: GroundProject = identityProject,
): void {
  const pad = .04;
  ctx.save();
  // The clip follows the terrain: a raised chunk's own tiles leave the flat
  // rectangle they would have occupied, so clipping to that would shave the top
  // off every hill on a chunk boundary.
  const clip: [number, number][] = [
    [tx0 - pad, ty0 - pad], [tx1 + 1 + pad, ty0 - pad],
    [tx1 + 1 + pad, ty1 + 1 + pad], [tx0 - pad, ty1 + 1 + pad],
  ].map(([u, v]) => project(...elevatedWorld(grid, u, v)));
  pathPolygons(ctx, [clip]);
  ctx.clip();

  const batch = collectElevatedGround(grid, tx0, ty0, tx1, ty1, project);
  const scale = paintScale(project);
  const [px, py] = project(0, 0);

  // Sand under the beach tiles, grass over the rest — the same two materials
  // the flat island is painted with, in the same order.
  pathPolygons(ctx, batch.sand);
  ctx.fillStyle = patterns.sand;
  ctx.fill();
  pathPolygons(ctx, batch.grass);
  ctx.fillStyle = patterns.grass;
  ctx.fill();

  // The beach's inland seam, feathered exactly like the flat paint feathers its
  // inland contour: three strokes of the real grass texture, widening and
  // fading, so the sand does not stop in a knife edge.
  ctx.save();
  ctx.beginPath();
  for (const [[ax, ay], [bx, by]] of batch.seam) { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
  ctx.strokeStyle = patterns.grass;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const [width, alpha] of [[7, .12], [4, .2], [2, .28]] as const) {
    ctx.lineWidth = width * scale;
    ctx.globalAlpha = alpha;
    ctx.stroke();
  }
  ctx.restore();

  // Slope shading, over the material: the sun from the north-west lifts the
  // faces that turn to it and drops the ones that turn away. This is what makes
  // a hill read at 0.5× zoom, where the outline alone is a few pixels.
  for (const [shade, faces] of batch.lit) {
    ctx.globalAlpha = Math.min(1, shade * SHADE_LIGHT_GAIN);
    ctx.fillStyle = SHADE_LIGHT;
    pathPolygons(ctx, faces);
    ctx.fill();
  }
  for (const [shade, faces] of batch.shaded) {
    ctx.globalAlpha = Math.min(1, shade * SHADE_DARK_GAIN);
    ctx.fillStyle = SHADE_DARK;
    pathPolygons(ctx, faces);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ART-2 (#382): the dithered transition, over the material and the hillshade
  // so a clump is lit like the ground it lies on. It is part of this paint, so
  // it drapes with the surface instead of floating over it as an overlay.
  paintGroundBlend(ctx, grid, batch.blend, patterns, scale, project, [tx0, ty0, tx1, ty1]);

  // The waterline: a soft dark foot where the ground meets the sea or a river,
  // which is the cliff/side shading a raised coast needs — the land beside
  // water always ramps down to it, so this is the edge the slope ends on.
  strokeSegments(ctx, batch.waterline, "rgba(28, 44, 34, 0.42)", 2.4 * scale);
  strokeSegments(ctx, batch.waterline, "rgba(12, 22, 18, 0.30)", 1 * scale);

  paintRiverWater(ctx, grid, tx0, ty0, tx1, ty1, project, px, py, scale);
  ctx.restore();
}

/** Scale a polygon toward its centroid by factor `s` (sand inset). */
export function insetPolygon(pts: [number, number][], s: number): [number, number][] {
  let cx = 0, cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  cx /= pts.length; cy /= pts.length;
  return pts.map(([x, y]) => [cx + (x - cx) * s, cy + (y - cy) * s] as [number, number]);
}

/**
 * Sand inset as a fraction of the diamond. 1 = full tiles: the beach is a
 * connected golden terrace — perfect diamond edges at the sea (foam kisses
 * them), a crisp scalloped staircase inland. Below 1 the ring dissolves into
 * scattered squares; keep it at 1.
 */
export const SAND_INSET = 1;

/**
 * Path a list of world-space polygons onto `ctx` (already in the space the
 * points live in). Shared edges of adjacent diamonds are traversed in
 * opposite directions, so one `fill()` call over a batch of tiles has no
 * interior hairline — but we still stroke the outline at 1px because two
 * SEPARATE fill() calls (grass, then sand) meet antialiased edges.
 */
export function pathPolygons(ctx: CanvasRenderingContext2D, polys: [number, number][][]): void {
  ctx.beginPath();
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [x, y] = poly[i];
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}

/**
 * Project world-space (1×) coordinates to the paint space of the target
 * context. Preserve subpixel curve coordinates; only the final cache blit
 * snaps to a device pixel. Callers painting whole scenes pass the identity.
 */
export type GroundProject = (wx: number, wy: number) => [number, number];

export const identityProject: GroundProject = (wx, wy) => [wx, wy];

/**
 * The static parts of the ground for a tile range, painted through `project`.
 * Water tiles are skipped — the animated ocean pass shows through them. The
 * caller must have world-anchored any pattern transforms BEFORE calling
 * (patterns share the paint space).
 */
export function paintGroundTiles(
  ctx: CanvasRenderingContext2D,
  grid: Grid,
  tx0: number, ty0: number, tx1: number, ty1: number,
  patterns: { grass: string | CanvasPattern; sand: string | CanvasPattern },
  project: GroundProject = identityProject,
): void {
  // E2 (#267): with the `elevation` option ON the island is a surface, not a
  // plane, and is painted per tile. With it off — every map that is not asking
  // for elevation, which is every map today — the code below runs untouched.
  if (elevationActive(grid)) {
    paintElevatedGroundTiles(ctx, grid, tx0, ty0, tx1, ty1, patterns, project);
    return;
  }
  const coast = groundContours(grid);
  // Clip the SAME world contours into each cache surface. The tiny overlap
  // seals antialiased chunk joins; it never changes the outer coastline.
  const pad = .04;
  const corners = [[tx0 - pad, ty0 - pad], [tx1 + 1 + pad, ty0 - pad],
    [tx1 + 1 + pad, ty1 + 1 + pad], [tx0 - pad, ty1 + 1 + pad]];
  ctx.save();
  pathPolygons(ctx, [corners.map(([x, y]) => project(...tileToScreen(x, y)))]);
  ctx.clip();
  const paint = (loops: CoastPoint[][], fill: string | CanvasPattern) => {
    pathPolygons(ctx, loops.map(loop => loop.map(p => project(...p))));
    ctx.fillStyle = fill;
    ctx.fill();
  };
  // Sand under the entire island; the rounded inland mask reveals a beach
  // between two continuous contours, including concave bays and corners.
  paint(coast.land, patterns.sand);
  paint(coast.inland, patterns.grass);
  // A narrow feather of the real grass texture softens the beach's inland
  // seam without an extra bitmap or a fringe of disconnected grass stamps.
  ctx.strokeStyle = patterns.grass;
  ctx.lineJoin = "round";
  const [px, py] = project(0, 0), [qx, qy] = project(1, 0);
  const scale = Math.hypot(qx - px, qy - py);
  for (const [width, alpha] of [[7, .12], [4, .2], [2, .28]] as const) {
    ctx.lineWidth = width * scale;
    ctx.globalAlpha = alpha;
    ctx.stroke();
  }
  // ART-2 (#382): the thick dithered transition, baked into this chunk's cache
  // surface. It covers both the seam feathered above and the waterline the
  // surf bands sit on, so the material never changes on a hairline again.
  ctx.globalAlpha = 1;
  paintGroundBlend(ctx, grid, () => blendEdgesFor(grid, tx0, ty0, tx1, ty1), patterns, scale,
    project, [tx0, ty0, tx1, ty1]);
  paintRiverWater(ctx, grid, tx0, ty0, tx1, ty1, project, px, py, scale);
  ctx.restore();
}

/**
 * R1 (#260): the river's own water and banks. River tiles are WATER in the
 * terrain, so left alone they would show the animated open ocean; this paints
 * them with the seamless fresh-water texture (world-anchored, like the land
 * patterns, so joins between chunks line up) over the ocean, then strokes a
 * subtle dark bank along the edges a river shares with land. ONE batched fill
 * and two batched strokes per chunk — rivers add no per-frame cost (the chunk
 * is cached), which is what keeps the shore-stroke fps budget intact.
 */
function paintRiverWater(
  ctx: CanvasRenderingContext2D,
  grid: Grid,
  tx0: number, ty0: number, tx1: number, ty1: number,
  project: GroundProject,
  px: number, py: number, scale: number,
): void {
  const river = grid.rivers;
  if (!river) return;
  const diamonds: [number, number][][] = [];
  const banks: [number, number][][] = [];
  const isLand = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < grid.w && y < grid.h && grid.terrain[y * grid.w + x] !== WATER;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!river[ty * grid.w + tx]) continue;
      // E2 (#267): raised corners, so a river on a map with elevation is drawn
      // from the same lattice the land beside it is. A river tile itself sits at
      // level 0 (`makeElevation` pins water and river tiles there), so its own
      // diamond is unmoved — and the shared edge with its bank is level 0 on
      // BOTH sides, which is what keeps the bank stroke welded to the shore
      // that slopes down to it.
      const corners = tileDiamondRaised(grid, tx, ty).map(([x, y]) => project(x, y));
      diamonds.push(corners);
      // Shared edge with each land 4-neighbour: W(-1,0)=T–W, N(0,-1)=T–E,
      // E(+1,0)=E–S, S(0,1)=W–S (corners N,E,S,W = indices 0..3).
      const edge: [number, number][] = [[0, 3], [0, 1], [1, 2], [3, 2]];
      const dirs = [[-1, 0], [0, -1], [1, 0], [0, 1]];
      for (let d = 0; d < 4; d++) {
        if (!isLand(tx + dirs[d][0], ty + dirs[d][1])) continue;
        const [a, b] = edge[d];
        banks.push([corners[a], corners[b]]);
      }
    }
  }
  if (diamonds.length === 0) return;
  ctx.save();
  ctx.globalAlpha = 1;
  pathPolygons(ctx, diamonds);
  if (riverFillPattern) {
    const m = makeMatrix();
    m.translateSelf(px, py);
    m.scaleSelf(scale * RIVER_TEX_SCALE, scale * RIVER_TEX_SCALE);
    riverFillPattern.setTransform(m);
    ctx.fillStyle = riverFillPattern;
  } else {
    ctx.fillStyle = FALLBACK.river;
  }
  ctx.fill();
  if (banks.length) {
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (const [[ax, ay], [bx, by]] of banks) { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
    ctx.strokeStyle = "rgba(24, 46, 40, 0.55)";
    ctx.lineWidth = 2.2 * scale;
    ctx.stroke();
    ctx.strokeStyle = "rgba(196, 232, 220, 0.28)";
    ctx.lineWidth = 1 * scale;
    ctx.stroke();
  }
  ctx.restore();
}

/** River texture grain — the same world scale the land textures paint at. */
const RIVER_TEX_SCALE = 0.2;

// ── PERF-01: the flat performance-mode ground ─────────────────────────────
/**
 * PERF-01: the muted flat palette for performance mode. Solid fills — no
 * textures, no patterns — so a painted chunk stays valid for the whole map's
 * life instead of one animation frame. Muted so buildings and the placement
 * glow read above it, and close to the textured palette's mid-tones so
 * toggling the mode does not flash the island a different colour.
 */
export const PERF_FLAT = {
  /** Flat blue under the island (the ocean, with its drift switched off). */
  water: "#1a5f7d",
  /** Flat sand terrace — the coast keeps the textured ground's shape. */
  sand: "#d9bd7f",
  /** Muted flat green land. */
  grass: "#6f7f4a",
  /** R1 (#260): flat fresh-water for rivers in performance mode. */
  river: "#2c7471",
  /** The subtle isometric build grid, stroked over the land only. */
  grid: "rgba(24, 32, 16, 0.16)",
};

export interface FlatGroundColors {
  grass: string;
  sand: string;
  grid: string;
  river?: string;
}

/**
 * PERF-01: the STATIC performance-mode ground for a tile range, painted
 * through `project`. Same contours as the textured ground (`groundContours`),
 * so the island and its beach keep their exact shape — only the paint is
 * flat: a solid sand terrace under the land, a solid muted-green meadow over
 * it, and ONE subtle isometric build grid (every tile diamond of the range,
 * plus a one-tile ring so the lines reach the chunk edges) stroked once,
 * clipped to the land so the water stays clean.
 *
 * No `time` parameter by construction: everything here is a function of
 * (grid, range) only, which is what makes the chunk it lands on cacheable
 * for good. The caller must be in the paint space the points project into
 * (the chunk surfaces do).
 */
export function paintFlatGroundTiles(
  ctx: CanvasRenderingContext2D,
  grid: Grid,
  tx0: number, ty0: number, tx1: number, ty1: number,
  colors: FlatGroundColors,
  project: GroundProject = identityProject,
): void {
  // E2 (#267): the same dispatch the textured ground makes. The flat paint is
  // not on the draw path today (PERF-01 keeps the textured terrain), but it is
  // reachable from tests and from any future "no textures" mode, and an island
  // that goes flat-grey on a hill would be a hole in the feature.
  if (elevationActive(grid)) {
    paintElevatedFlatGroundTiles(ctx, grid, tx0, ty0, tx1, ty1, colors, project);
    return;
  }
  const coast = groundContours(grid);
  // The same tiny padded clip the textured ground uses: it seals
  // antialiased chunk joins without changing the outer coastline.
  const pad = .04;
  const corners: [number, number][] = [[tx0 - pad, ty0 - pad], [tx1 + 1 + pad, ty0 - pad],
    [tx1 + 1 + pad, ty1 + 1 + pad], [tx0 - pad, ty1 + pad]];
  ctx.save();
  pathPolygons(ctx, [corners.map(([x, y]) => project(...tileToScreen(x, y)))]);
  ctx.clip();
  const loops = (loops: CoastPoint[][]) => loops.map((l) => l.map((p) => project(...p)));
  // Sand under the entire island, grass over the inland mask — the rounded
  // beach ring between the two contours, exactly as in the textured paint.
  pathPolygons(ctx, loops(coast.land));
  ctx.fillStyle = colors.sand;
  ctx.fill();
  pathPolygons(ctx, loops(coast.inland));
  ctx.fillStyle = colors.grass;
  ctx.fill();
  // R1 (#260): rivers get a solid fresh-water fill in performance mode (the
  // flat path has no textures). Water tiles are transparent elsewhere, so the
  // diamonds are exactly the river.
  if (grid.rivers) {
    const diamonds: [number, number][][] = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (!grid.rivers[ty * grid.w + tx]) continue;
      diamonds.push(tileDiamondWorld(tx, ty).map(([x, y]) => project(x, y)));
    }
    if (diamonds.length) {
      pathPolygons(ctx, diamonds);
      ctx.fillStyle = colors.river ?? PERF_FLAT.river;
      ctx.fill();
    }
  }
  // The build grid: one path over every tile diamond in the range (ringed),
  // one stroke, clipped to the land so the grid never crosses the water.
  // 1px in paint space — it scales with the chunk's zoom, so the line stays
  // one tile-fraction wide on screen at every zoom step.
  ctx.save();
  pathPolygons(ctx, loops(coast.land));
  ctx.clip();
  const diamonds: [number, number][][] = [];
  for (let ty = ty0 - 1; ty <= ty1 + 1; ty++) {
    for (let tx = tx0 - 1; tx <= tx1 + 1; tx++) {
      diamonds.push(tileDiamondWorld(tx, ty).map(([x, y]) => project(x, y)));
    }
  }
  pathPolygons(ctx, diamonds);
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

/**
 * E2 (#267): the raised PERFORMANCE-mode ground — the same batch of raised
 * faces the textured paint gathers, in flat colours.
 *
 * The build grid rides the surface too: it is stroked from the raised diamonds
 * rather than the flat ones, clipped to the land exactly as the flat paint
 * clips its grid, so a mode switch moves the terrain's shape and its shading
 * and nothing else.
 */
export function paintElevatedFlatGroundTiles(
  ctx: CanvasRenderingContext2D,
  grid: Grid,
  tx0: number, ty0: number, tx1: number, ty1: number,
  colors: FlatGroundColors,
  project: GroundProject = identityProject,
): void {
  const pad = .04;
  ctx.save();
  const clip: [number, number][] = [[tx0 - pad, ty0 - pad], [tx1 + 1 + pad, ty0 - pad],
    [tx1 + 1 + pad, ty1 + 1 + pad], [tx0 - pad, ty1 + 1 + pad]]
    .map(([u, v]) => project(...elevatedWorld(grid, u, v)));
  pathPolygons(ctx, [clip]);
  ctx.clip();

  const batch = collectElevatedGround(grid, tx0, ty0, tx1, ty1, project);
  pathPolygons(ctx, batch.sand);
  ctx.fillStyle = colors.sand;
  ctx.fill();
  pathPolygons(ctx, batch.grass);
  ctx.fillStyle = colors.grass;
  ctx.fill();

  // Rivers: one flat fill over the raised diamonds (which are level 0).
  if (grid.rivers) {
    const diamonds: [number, number][][] = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (!grid.rivers[ty * grid.w + tx]) continue;
      diamonds.push(tileDiamondRaised(grid, tx, ty).map(([x, y]) => project(x, y)));
    }
    if (diamonds.length) {
      pathPolygons(ctx, diamonds);
      ctx.fillStyle = colors.river ?? PERF_FLAT.river;
      ctx.fill();
    }
  }

  for (const [shade, faces] of batch.lit) {
    ctx.globalAlpha = Math.min(1, shade * SHADE_LIGHT_GAIN);
    ctx.fillStyle = SHADE_LIGHT;
    pathPolygons(ctx, faces);
    ctx.fill();
  }
  for (const [shade, faces] of batch.shaded) {
    ctx.globalAlpha = Math.min(1, shade * SHADE_DARK_GAIN);
    ctx.fillStyle = SHADE_DARK;
    pathPolygons(ctx, faces);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.save();
  pathPolygons(ctx, [...batch.sand, ...batch.grass]);
  ctx.clip();
  pathPolygons(ctx, batch.diamonds);
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  strokeSegments(ctx, batch.waterline, "rgba(28, 44, 34, 0.42)", 2.4 * paintScale(project));
  ctx.restore();
}

export interface GroundContours {
  land: CoastPoint[][];
  inland: CoastPoint[][];
  /**
   * R1 (#260): the OUTER sea coast with river tiles treated as land, so the
   * ocean's surf/foam bands follow only the true coastline and never stroke
   * the long banks of a river (which get their own, cheaper bank stroke).
   */
  coast: CoastPoint[][];
}
const contourCache = new WeakMap<Grid, GroundContours>();
export function groundContours(grid: Grid): GroundContours {
  let coast = contourCache.get(grid);
  if (!coast) {
    const river = grid.rivers;
    const isRiver = (x: number, y: number) =>
      !!river && x >= 0 && y >= 0 && x < grid.w && y < grid.h && river[y * grid.w + x] !== 0;
    coast = {
      land: traceCoast(grid.w, grid.h, (x, y) => grid.terrain[y * grid.w + x] !== WATER),
      inland: traceCoast(grid.w, grid.h, (x, y) => {
        const v = grid.terrain[y * grid.w + x];
        return v !== WATER && v !== SAND;
      }),
      coast: traceCoast(grid.w, grid.h, (x, y) =>
        grid.terrain[y * grid.w + x] !== WATER || isRiver(x, y)),
    };
    contourCache.set(grid, coast);
  }
  return coast;
}
export function invalidateGroundContours(grid: Grid): void {
  contourCache.delete(grid);
  // ART-2 (#382): the dither's edge index is derived from these contours, so it
  // goes with them — a chunk baked after this rebuilds its clumps from the new
  // shoreline instead of a stale one.
  invalidateGroundBlendIndex(grid);
}

/** Soft surf bands follow the exact land contour, never whole water diamonds. */
export function paintShore(
  ctx: CanvasRenderingContext2D, grid: Grid, t: number, zoom: number,
  project: GroundProject = identityProject,
): void {
  // E2 (#267): the surf needs NO lift. A corner that touches water is level 0
  // by the lattice's own rule (see `elevation.ts`), so the coastline this
  // contour traces is exactly where the raised ground meets the sea — the foam
  // keeps sitting on the waterline while the land behind it climbs.
  ctx.save();
  // R1 (#260): surf follows the OUTER coast only (rivers read as land for this
  // contour), so the broad ocean shelf bands never swallow a narrow river.
  pathPolygons(ctx, groundContours(grid).coast.map(loop => loop.map(p => project(...p))));
  ctx.lineJoin = "round";
  // Broad translucent bands feather the shelf into the animated ocean.
  for (const [width, alpha] of [[18, .035], [12, .055], [7, .09]] as const) {
    ctx.strokeStyle = `rgba(${SHALLOW_RGB},${alpha})`;
    ctx.lineWidth = width * zoom;
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(100,77,43,0.20)";
  ctx.lineWidth = 3.5 * zoom;
  ctx.stroke();
  ctx.strokeStyle = `rgba(${FOAM_RGB},${.32 + .1 * Math.sin(t * .0016)})`;
  ctx.lineWidth = (1.2 + .25 * Math.sin(t * .002)) * zoom;
  ctx.stroke();
  ctx.restore();
}

// ── shoreline ───────────────────────────────────────────────────────────────
export interface ShoreTile {
  tx: number;
  ty: number;
  /** World-space foam segments — the edges this water tile shares with land. */
  edges: [[number, number], [number, number]][];
}

/**
 * The diamond edge shared with each 4-neighbour, as world-space segments.
 * Direction order: W (-1,0), N (0,-1), E (+1,0), S (0,+1) — matching the
 * corners of tileDiamondWorld.
 */
const EDGE_BY_DIR: Record<string, [number, number]> = {};
{
  // neighbour (tx-1,ty) shares T–W; (tx,ty-1) shares T–E; (tx+1,ty) shares E–S; (tx,ty+1) shares W–S
  EDGE_BY_DIR["-1,0"] = [0, 3];
  EDGE_BY_DIR["0,-1"] = [0, 1];
  EDGE_BY_DIR["1,0"] = [1, 2];
  EDGE_BY_DIR["0,1"] = [3, 2];
}

/**
 * Water tiles that touch land, with their foam edges. The terrain never
 * changes at runtime (only ROUGH→GRASS flattening, which cannot touch a
 * coast), so this is computed once per map.
 */
export function computeShore(grid: Grid): ShoreTile[] {
  const out: ShoreTile[] = [];
  const isLand = (tx: number, ty: number) => {
    if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) return false;
    return grid.terrain[ty * grid.w + tx] !== WATER;
  };
  for (let ty = 0; ty < grid.h; ty++) {
    for (let tx = 0; tx < grid.w; tx++) {
      if (grid.terrain[ty * grid.w + tx] !== WATER) continue;
      let any = false;
      for (let dy = -1; dy <= 1 && !any; dy++)
        for (let dx = -1; dx <= 1 && !any; dx++)
          if ((dx || dy) && isLand(tx + dx, ty + dy)) any = true;
      if (!any) continue;
      const corners = tileDiamondWorld(tx, ty);
      const edges: ShoreTile["edges"] = [];
      for (const [dx, dy] of [[-1, 0], [0, -1], [1, 0], [0, 1]] as const) {
        if (!isLand(tx + dx, ty + dy)) continue;
        const [a, b] = EDGE_BY_DIR[`${dx},${dy}`];
        edges.push([corners[a], corners[b]]);
      }
      out.push({ tx, ty, edges });
    }
  }
  return out;
}

/** Stable per-tile animation phase so the surf shimmers, not blinks. */
export const shorePhase = (tx: number, ty: number) => tx * 0.9 + ty * 1.7;

/**
 * Shallow-water tint alpha for one shore tile at time `t` (ms).
 * Slow swell: one breath roughly every 4 seconds, phase-shifted per tile.
 */
export const shallowAlpha = (t: number, tx: number, ty: number) =>
  0.14 + 0.05 * Math.sin(t * 0.0016 + shorePhase(tx, ty));

/** Foam stroke alpha — faster than the swell, out of phase with it. */
export const foamAlpha = (t: number, tx: number, ty: number) =>
  0.36 + 0.24 * Math.sin(t * 0.004 + shorePhase(tx, ty) * 1.3);

/** Foam stroke width in world pixels. */
export const foamWidth = (t: number, tx: number, ty: number) =>
  2.1 + 0.9 * Math.sin(t * 0.0031 + shorePhase(tx, ty) * 0.7);

/** Shallow-shelf tint over the ocean pattern, as "r,g,b" (alpha per tile). */
export const SHALLOW_RGB = "151,225,214";
/** Foam stroke colour, as "r,g,b" (alpha per tile). */
export const FOAM_RGB = "255,244,214";

/** Fallback flat colours when ground textures are not (yet) available. */
export const FALLBACK = {
  water: "#155e70",
  grass: "#6d7c42",
  sand: "#d9b36c",
  river: "#2c7471",
};

/**
 * Ocean pattern transform for the terrain canvas: the texture is anchored to
 * WORLD space (pans with the camera) and drifts on its own — the animated
 * sea. `t` is the frame time in ms; the drift wraps at one texture period.
 *
 * GFX-01 terrain LOD: `texScale` is GROUND_TEX_SIZE ÷ the loaded texture's
 * width (2 for the medium tier, 4 for low). It stretches the pattern so a
 * smaller copy covers the same world area; the drift and its wrap period are
 * world terms and do not change with the tier.
 *
 * Optimized path: pre-compute the scaled zoom and period once so the per-frame
 * matrix only calculates the drift offset (two modulo operations) and applies
 * the pre-computed scale.
 */
export function oceanMatrix(
  cam: { x: number; y: number; zoom: number },
  t: number,
  scale = 1,
  texScale = 1,
): DOMMatrix {
  const z = cam.zoom * scale;
  const period = GROUND_TEX_SIZE * z;
  // Pre-compute the scaled texture size for faster matrix application.
  const sz = z * texScale;
  const dx = cam.x + ((t * 0.0022 * z) % period);
  const dy = cam.y + ((t * 0.0014 * z) % period);
  const m = makeMatrix();
  m.translateSelf(dx, dy);
  m.scaleSelf(sz, sz);
  return m;
}

/**
 * DOMMatrix where it exists (browsers), a minimal {e,f,m11,m22} stand-in
 * where it doesn't (Node unit tests — the matrix only ever feeds
 * CanvasPattern.setTransform, which only runs in a browser).
 */
export function makeMatrix(): DOMMatrix {
  const g = globalThis as { DOMMatrix?: typeof DOMMatrix };
  if (g.DOMMatrix) return new g.DOMMatrix();
  const stub = {
    m11: 1, m12: 0, m21: 0, m22: 1, e: 0, f: 0,
    translateSelf(x: number, y: number) { this.e += x; this.f += y; return this; },
    scaleSelf(x: number, y?: number) { this.m11 *= x; this.m22 *= y ?? x; return this; },
  };
  return stub as unknown as DOMMatrix;
}

/** Load the seamless ground textures in a browser (river optional). */
export async function loadGroundTextures(
  urls: { grass: string; sand: string; water: string; river?: string },
): Promise<GroundTextures> {
  const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
  const [grass, sand, water, river] = await Promise.all([
    load(urls.grass), load(urls.sand), load(urls.water),
    urls.river ? load(urls.river).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  return { grass, sand, water, river };
}

/** Build the per-zoom patterns (call on zoom change / texture load). */
export function createGroundPatterns(
  ctx: CanvasRenderingContext2D,
  tex: GroundTextures,
): GroundPatterns {
  const pat = (img: AtlasImage) => {
    const p = ctx.createPattern(img as unknown as CanvasImageSource, "repeat");
    if (!p) throw new Error("createPattern failed for ground texture");
    return p;
  };
  // Park the river fill for `paintGroundTiles` (the renderer's chunk call only
  // forwards grass/sand). A context without the river texture yields null.
  riverFillPattern = tex.river
    ? ctx.createPattern(tex.river as unknown as CanvasImageSource, "repeat")
    : null;
  return {
    grass: pat(tex.grass), sand: pat(tex.sand), water: pat(tex.water),
    river: riverFillPattern ?? undefined,
  };
}

/** GRASS re-exported for callers that classify land vs water. */
export const isLandTerrain = (v: number) => v === GRASS || v === 2 /* ROUGH */ || v === 3 /* SAND */;
