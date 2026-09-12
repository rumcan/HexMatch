// ══════════════════════════════════════════════════════════════════════════
// ROADS (vector) — rasterising the ground-plane geometry, with its own cache.
//
// `road-geometry.ts` produces paths in tile units. This module projects and
// paints them, and owns the cache that keeps that work off the per-frame
// path.
//
// WHY A SEPARATE CACHE. Roads live on the STRUCTURES canvas, and that canvas
// is fully redrawn on every frame a lorry is moving (`hasAnimation`). Road
// geometry does not change on those frames, so rasterising it per frame would
// pay for the whole road network sixty times a second to animate a truck.
// The surfaces are cached per (zoom, chunk) and blitted.
//
// CHUNKS ARE RECTANGLES IN PROJECTED WORLD SPACE, not groups of tiles. The
// ground chunks elsewhere in the renderer are 8×8 tile diamonds, whose
// bounding boxes OVERLAP; that is harmless when each one paints only its own
// tiles, but a road spills past its tile, so overlapping ownership would
// double-blend every shoulder in the overlap. Axis-aligned rectangles tile
// the plane exactly once, so every pixel has exactly one owner.
//
// Each chunk rasterises with a GUTTER — it evaluates geometry beyond its own
// rectangle — and then blits only its interior. Without that, a road crossing
// a chunk edge loses the half of its width that belonged to the neighbour.
//
// TEXTURE COORDINATES ARE ABSOLUTE. The pattern transform is derived from
// ground coordinates alone, never from the chunk origin, the camera or the
// draw order, so two chunks sample the same material field and a pan does not
// slide the surface.
// ══════════════════════════════════════════════════════════════════════════
import { HW, HH, MAP_W, MAP_H } from "../game/config";
import type { Camera } from "./camera";
import {
  ROAD_WIDTH, SHOULDER_WIDTH,
  hasRoad, paintFigures, roadTile,
  type GroundPoint, type RoadFigure, type RoadTile,
} from "./road-geometry";

type Ctx2D = CanvasRenderingContext2D;
type Surface = HTMLCanvasElement | OffscreenCanvas;

/** Which road implementation the renderer is using. Never persisted. */
export type RoadRenderMode = "sprites" | "textured";

/** Anything `createPattern` accepts — an ImageBitmap here, a stub in tests. */
export interface RoadTextureImage {
  width: number;
  height: number;
}

/**
 * Material appearance. `image` is the seamless texture once one has loaded;
 * `flat` is the fallback colour, which is a complete, shippable look rather
 * than an error state — a missing texture must never mean missing roads.
 *
 * The IMAGE is held, not a CanvasPattern, because every cache chunk rasterises
 * through its own offscreen context and a pattern belongs to the context that
 * created it. Creating one per chunk is cheap and avoids relying on
 * cross-context pattern reuse, which browsers permit unevenly.
 */
export interface RoadMaterialStyle {
  flat: string;
  shoulder: string;
  image: RoadTextureImage | null;
  /**
   * Ground-plane tile units spanned by one repeat of the texture ACROSS ITS
   * WIDTH. The vertical repeat follows from the image's own aspect ratio, so
   * a non-square swatch keeps its grain round instead of being stretched to
   * fit a square of ground.
   */
  repeat: number;
}

export interface RoadStyle {
  paved: RoadMaterialStyle;
  dirt: RoadMaterialStyle;
  /** Worn, low-saturation marking colour. */
  paint: string;
  paintAlpha: number;
}

/**
 * Fallback palette, chosen against the map's dark-olive grass and the painted
 * buildings: weathered charcoal for asphalt, muted compacted earth for dirt,
 * and markings that are worn rather than fresh. Deliberately not pure black
 * or bright orange — both fight the landscape.
 */
export const DEFAULT_ROAD_STYLE: RoadStyle = {
  paved: { flat: "#3c3b38", shoulder: "#2a2926", image: null, repeat: 2.6 },
  dirt: { flat: "#7b6443", shoulder: "#574631", image: null, repeat: 2.6 },
  // Road markings: near-white and only lightly worn. The first pass used a
  // dim parchment tone at half opacity, which at 1x simply did not read as a
  // painted line.
  paint: "#e8e4d6",
  paintAlpha: 0.78,
};

// ── paint geometry constants ────────────────────────────────────────────────
/**
 * The road's cross-section shading, applied over the material core as
 * concentric strokes: `[width as a fraction of the road, ink, alpha]`.
 *
 * One dark wash across the whole width, then the middle lifted back up in
 * several thin light steps. Ordered outer-to-inner, and every alpha is low —
 * this is camber, not a vignette, and at strong values it turns the road into
 * a tube.
 *
 * The lift is four weak passes rather than one strong one because a single
 * light stroke at 0.58 of the width put a visible STEP down each side of the
 * road: the ink stopped at a hard edge. Stacking four at a quarter of the
 * alpha spreads the same total lift over four boundaries, which at road scale
 * reads as a fade from dark rim to lighter crown.
 */
const EDGE_SHADE: [number, string, number][] = [
  [1, "#0b0d09", 0.20],
  [0.80, "#c9cbbd", 0.055],
  [0.62, "#c9cbbd", 0.055],
  [0.44, "#c9cbbd", 0.055],
  [0.26, "#c9cbbd", 0.055],
];

/**
 * Opacity of the shoulder pass. The shoulder is a darkening of the ground
 * beside the road, so it has to let that ground through — at full opacity it
 * is a border, not a verge.
 */
const SHOULDER_ALPHA = 0.42;

/** Marking width in tile units. */
const PAINT_WIDTH = 0.03;
/**
 * Dash geometry in tile units: a short dash and a shorter gap, four cycles
 * per tile.
 *
 * The gap does the work here. One long dash per tile read as a single tick;
 * two with a wide gap still read as separate marks rather than as one line.
 * Closing the gap up to roughly the dash's own length is what makes the eye
 * join them into a centre line, and it still resolves at 0.5x.
 */
const DASH_ON = 0.12, DASH_OFF = 0.13;

// ── chunking ────────────────────────────────────────────────────────────────
/** Chunk size in PROJECTED WORLD pixels at 1×. Non-overlapping by construction. */
export const ROAD_CHUNK_W = 512, ROAD_CHUNK_H = 256;
/**
 * Gutter in projected world pixels. A road reaches half its width plus its
 * shoulder past its centre-line, and the widest of those is well under a
 * tile, so one tile of slack on each side is generous.
 */
const GUTTER = 64;

/** Inverse of the ground projection: projected world pixels → tile units. */
export const screenToGround = (x: number, y: number): GroundPoint =>
  [x / (2 * HW) + y / (2 * HH), y / (2 * HH) - x / (2 * HW)];

/** The tile range whose geometry can touch a projected-world rectangle. */
export function tilesForRect(
  x0: number, y0: number, x1: number, y1: number,
): { tx0: number; ty0: number; tx1: number; ty1: number } {
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const) {
    const [u, v] = screenToGround(x, y);
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
    if (v < v0) v0 = v;
    if (v > v1) v1 = v;
  }
  // A tile's road can reach out of the tile by half a width plus a shoulder.
  const reach = Math.max(ROAD_WIDTH.dirt, ROAD_WIDTH.paved) / 2 + SHOULDER_WIDTH + 0.01;
  return {
    tx0: Math.max(0, Math.floor(u0 - reach) - 1),
    ty0: Math.max(0, Math.floor(v0 - reach) - 1),
    tx1: Math.min(MAP_W - 1, Math.ceil(u1 + reach)),
    ty1: Math.min(MAP_H - 1, Math.ceil(v1 + reach)),
  };
}

// ── the road world view ─────────────────────────────────────────────────────
/**
 * What the painter needs from the world. Deliberately the raw byte arrays the
 * simulation already maintains — this module derives everything it draws and
 * never writes back, so no amount of art work can disturb ownership, routing,
 * costs or speed.
 */
export interface RoadWorld {
  roadBits?: Uint8Array;
  dirtBits?: Uint8Array;
}

const cellAt = (arr: Uint8Array | undefined, tx: number, ty: number): number =>
  arr && tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H ? arr[ty * MAP_W + tx] : 0;

/** Is there PAVED road on this tile? The transition classifier's one question. */
const isPaved = (world: RoadWorld, tx: number, ty: number): boolean =>
  hasRoad(cellAt(world.roadBits, tx, ty));

/** Every road tile in a range, as drawing descriptions. */
export function roadTilesIn(
  world: RoadWorld, tx0: number, ty0: number, tx1: number, ty1: number,
): RoadTile[] {
  const out: RoadTile[] = [];
  const paved = (x: number, y: number) => isPaved(world, x, y);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const road = cellAt(world.roadBits, tx, ty);
      const dirt = cellAt(world.dirtBits, tx, ty);
      // A tile carries at most one tier; paved wins if both bytes are set,
      // matching the simulation's "paving replaces dirt" rule.
      if (hasRoad(road)) out.push(roadTile(tx, ty, road, "paved", paved));
      else if (hasRoad(dirt)) out.push(roadTile(tx, ty, dirt, "dirt", paved));
    }
  }
  return out;
}

// ── painting ────────────────────────────────────────────────────────────────
/** Trace a figure into the current path, in ground coordinates. */
function trace(ctx: Ctx2D, fig: RoadFigure): void {
  const pts = fig.points;
  ctx.beginPath();
  if (pts.length === 1) {
    // A pad: a zero-length segment with a round cap strokes a disc of exactly
    // the road's width, which is the shape we want and needs no special case.
    ctx.moveTo(pts[0][0], pts[0][1]);
    ctx.lineTo(pts[0][0], pts[0][1]);
    return;
  }
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
}

/**
 * Anchor a straight run's dash phase to the world, so the dashes of two
 * neighbouring tiles line up and a pan or a cache boundary cannot shift them.
 *
 * Only straight runs get this. A bend has no single axis to anchor to, and a
 * junction's approaches are short and gapped, so both are left to start their
 * dash at the port — which the deliberate corner and junction gaps hide.
 */
function dashOffsetFor(fig: RoadFigure): number {
  const pts = fig.points;
  if (pts.length !== 3) return 0;
  const [a, , c] = pts;
  const du = Math.abs(c[0] - a[0]), dv = Math.abs(c[1] - a[1]);
  const cycle = DASH_ON + DASH_OFF;
  // A straight run moves along exactly one ground axis.
  if (du > 1e-9 && dv > 1e-9) return 0;
  const along = du > dv ? a[0] : a[1];
  return -(((along % cycle) + cycle) % cycle);
}

/**
 * A pattern bound to THIS context, sampling ABSOLUTE ground coordinates.
 *
 * The context is already in ground coordinates, so the whole mapping is one
 * uniform scale: `repeat / width` ground units per texture pixel, applied to
 * BOTH axes. Scaling the vertical by `repeat / height` instead would squash a
 * non-square swatch onto a square of ground and turn its grit into ovals.
 *
 * There is no camera term and no chunk origin here, and that is the point:
 * two chunks sample the same material field, so a road crossing between them
 * is continuous and panning does not slide the surface underneath it.
 */
function makePattern(ctx: Ctx2D, style: RoadMaterialStyle): CanvasPattern | null {
  if (!style.image || typeof ctx.createPattern !== "function") return null;
  const p = ctx.createPattern(style.image as unknown as CanvasImageSource, "repeat");
  if (!p) return null;
  const k = style.repeat / style.image.width;
  const m = makeMatrix();
  m.scaleSelf(k, k);
  p.setTransform(m);
  return p;
}

/** DOMMatrix where it exists, a minimal stand-in where it does not (tests). */
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

/** Per-material fills resolved against one context. */
type RoadFills = Record<"paved" | "dirt", string | CanvasPattern>;

/**
 * Paint a set of road tiles into a context that is ALREADY in ground
 * coordinates — i.e. whose transform maps tile units to device pixels.
 *
 * Pass order is bottom-up and deliberate: shoulders first so the core covers
 * their inner half, then the opaque core, then the dirt→paved transitions
 * over the finished dirt, then markings last. Every pass strokes with a width
 * in TILE UNITS; the context transform turns that into the correct projected
 * width, including its foreshortening on each diagonal.
 */
export function paintRoadTiles(ctx: Ctx2D, tiles: RoadTile[], style: RoadStyle): void {
  // Patterns are created against THIS context; a material with no texture
  // falls through to its flat colour, which is a complete look, not a hole.
  const fills: RoadFills = {
    paved: makePattern(ctx, style.paved) ?? style.paved.flat,
    dirt: makePattern(ctx, style.dirt) ?? style.dirt.flat,
  };
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 1. Shoulders — ground disturbed at the road's edge, NOT an outline. Drawn
  //    semi-transparent so it darkens whatever it happens to lie on (grass, a
  //    dry patch, sand) rather than ringing the road in one flat colour,
  //    which is how the opaque version of this read: a thick cartoon border
  //    around every road, which is the one thing the art direction rules out.
  ctx.globalAlpha = SHOULDER_ALPHA;
  for (const t of tiles) {
    ctx.strokeStyle = style[t.material].shoulder;
    ctx.lineWidth = ROAD_WIDTH[t.material] + SHOULDER_WIDTH * 2;
    for (const f of t.figures) { trace(ctx, f); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;

  // 2. The opaque material core.
  for (const t of tiles) {
    ctx.strokeStyle = fills[t.material];
    ctx.lineWidth = ROAD_WIDTH[t.material];
    for (const f of t.figures) { trace(ctx, f); ctx.stroke(); }
  }

  // 2b. Shade the road ACROSS its width: dark at both edges, lifting towards
  //     the middle. A flat ribbon of texture reads as a decal lying on the
  //     grass; a crown reads as a made surface with camber, and it gives the
  //     centre-line something to sit on.
  //
  //     Done as concentric strokes rather than a gradient, because a gradient
  //     runs ALONG a path, not across it — there is no canvas primitive for
  //     "perpendicular to this polyline". Two narrowing passes of translucent
  //     ink, one dark at full width and one light down the middle, add up to
  //     the same falloff and cost two more strokes.
  //
  //     BUTT caps, not round. Every shade ring is NARROWER than the core, so
  //     a round cap puts a semicircle of ink INSIDE the asphalt at each end
  //     of the figure — and a figure ends at the tile's edge midpoints. The
  //     result was a set of concentric arcs printed across the road at every
  //     tile join: the "weird circles on the front and back of each road
  //     piece". Butt caps end each band square on the port, where the next
  //     tile's band begins, so the shading runs continuously down the sides
  //     and appears nowhere across the road.
  ctx.lineCap = "butt";
  for (const t of tiles) {
    const w = ROAD_WIDTH[t.material];
    for (const [frac, colour, alpha] of EDGE_SHADE) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = colour;
      ctx.lineWidth = w * frac;
      for (const f of t.figures) {
        // A pad (a lone road tile) is a zero-length segment: with butt caps
        // it strokes nothing at all, so it keeps its plain core rather than
        // gaining a cross-road arc it has no sides to justify.
        if (f.points.length < 2) continue;
        trace(ctx, f); ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.lineCap = "round";

  // 3. Dirt→paved transitions, laid OVER the opaque dirt core.
  for (const t of tiles) {
    if (!t.transitions.length) continue;
    ctx.lineWidth = ROAD_WIDTH.dirt;
    for (const tr of t.transitions) {
      // A pattern cannot itself carry a gradient, so the join is built in two
      // strokes: the real asphalt at full strength, then the dirt painted
      // back over it with its alpha ramping IN from the port. The result is
      // a·asphalt + (1-a)·dirt at every point and opaque throughout — fading
      // both materials towards transparency instead would open a window onto
      // the grass along every dirt-to-paved seam.
      ctx.beginPath();
      ctx.moveTo(tr.from[0], tr.from[1]);
      ctx.lineTo(tr.to[0], tr.to[1]);
      ctx.strokeStyle = fills.paved;
      ctx.stroke();
      const g = ctx.createLinearGradient(tr.from[0], tr.from[1], tr.to[0], tr.to[1]);
      g.addColorStop(0, withAlpha(style.dirt.flat, 0));
      g.addColorStop(1, style.dirt.flat);
      ctx.strokeStyle = g;
      ctx.stroke();
    }
  }

  // 4. Markings, on paved tiles only, never across a junction or a transition.
  ctx.strokeStyle = style.paint;
  ctx.globalAlpha = style.paintAlpha;
  ctx.lineWidth = PAINT_WIDTH;
  ctx.lineCap = "butt";
  for (const t of tiles) {
    if (t.material !== "paved") continue;
    for (const f of paintFigures(t.tx, t.ty, t.mask)) {
      ctx.setLineDash([DASH_ON, DASH_OFF]);
      ctx.lineDashOffset = dashOffsetFor(f);
      trace(ctx, f);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.restore();
}

/** `#rrggbb` with an alpha, for the transition gradient's transparent end. */
function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ── the cache ───────────────────────────────────────────────────────────────
interface CacheEntry {
  surface: Surface;
  /** Projected-world top-left of the chunk's OWNED rectangle. */
  ox: number;
  oy: number;
  bytes: number;
}

export interface RoadCacheStats {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  lastInvalidation: string | null;
}

/**
 * Per-(zoom, chunk) raster cache with a byte budget.
 *
 * A full-map surface is not an option: at 2× the projected 144×144 map is
 * about 18432×9216, which is roughly 648 MiB for one RGBA buffer before any
 * mask work. Visible chunks only, with an LRU bound.
 */
export class RoadCache {
  private entries = new Map<string, CacheEntry>();
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  private lastInvalidation: string | null = null;
  /** Bumped when the style or textures change; keys carry it, so old rasters die. */
  private styleVersion = 0;

  constructor(private budgetBytes = 48 * 1024 * 1024) {}

  stats(): RoadCacheStats {
    return {
      entries: this.entries.size,
      bytes: this.bytes,
      hits: this.hits,
      misses: this.misses,
      lastInvalidation: this.lastInvalidation,
    };
  }

  clear(reason: string): void {
    this.entries.clear();
    this.bytes = 0;
    this.lastInvalidation = reason;
  }

  /** Textures or palette changed: every raster is stale. */
  bumpStyle(reason: string): void {
    this.styleVersion++;
    this.clear(reason);
  }

  /**
   * Drop the chunks a tile can affect. A road's shape depends on its
   * neighbours' bits (the mask) and its neighbours' TIER (the transitions),
   * so a single tile edit dirties a neighbourhood, not a tile.
   */
  invalidateTile(tx: number, ty: number, reason = "tile"): void {
    const reach = 2;
    const corners: [number, number][] = [];
    for (const [u, v] of [
      [tx - reach, ty - reach], [tx + 1 + reach, ty - reach],
      [tx - reach, ty + 1 + reach], [tx + 1 + reach, ty + 1 + reach],
    ] as const) corners.push([(u - v) * HW, (u + v) * HH]);
    const x0 = Math.min(...corners.map((c) => c[0]));
    const x1 = Math.max(...corners.map((c) => c[0]));
    const y0 = Math.min(...corners.map((c) => c[1]));
    const y1 = Math.max(...corners.map((c) => c[1]));
    for (const key of [...this.entries.keys()]) {
      const e = this.entries.get(key)!;
      if (e.ox > x1 || e.ox + ROAD_CHUNK_W < x0) continue;
      if (e.oy > y1 || e.oy + ROAD_CHUNK_H < y0) continue;
      this.bytes -= e.bytes;
      this.entries.delete(key);
    }
    this.lastInvalidation = reason;
  }

  private evict(): void {
    // Map preserves insertion order, so the first key is the least recently
    // (re)built. Good enough, and cheap.
    while (this.bytes > this.budgetBytes && this.entries.size) {
      const key = this.entries.keys().next().value as string;
      const e = this.entries.get(key)!;
      this.bytes -= e.bytes;
      this.entries.delete(key);
    }
  }

  private chunk(
    cx: number, cy: number, zoom: number, world: RoadWorld, style: RoadStyle,
    makeSurface: (w: number, h: number) => Surface | null,
  ): CacheEntry | null {
    const key = `${this.styleVersion}:${zoom}:${cx},${cy}`;
    const hit = this.entries.get(key);
    if (hit) {
      this.hits++;
      // Touch for LRU.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    this.misses++;

    const ox = cx * ROAD_CHUNK_W, oy = cy * ROAD_CHUNK_H;
    const px = ox - GUTTER, py = oy - GUTTER;
    const w = Math.ceil((ROAD_CHUNK_W + GUTTER * 2) * zoom);
    const h = Math.ceil((ROAD_CHUNK_H + GUTTER * 2) * zoom);
    const surface = makeSurface(w, h);
    if (!surface) return null;
    const ctx = (surface as HTMLCanvasElement).getContext("2d") as Ctx2D | null;
    if (!ctx) return null;

    const range = tilesForRect(px, py, px + ROAD_CHUNK_W + GUTTER * 2, py + ROAD_CHUNK_H + GUTTER * 2);
    const tiles = roadTilesIn(world, range.tx0, range.ty0, range.tx1, range.ty1);
    if (tiles.length) {
      ctx.imageSmoothingEnabled = true;
      // Ground coordinates → this surface's device pixels. The gutter origin
      // is folded in here; the camera is NOT — that belongs to the blit.
      ctx.setTransform(HW * zoom, HH * zoom, -HW * zoom, HH * zoom, -px * zoom, -py * zoom);
      paintRoadTiles(ctx, tiles, style);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    const bytes = w * h * 4;
    const entry: CacheEntry = { surface, ox, oy, bytes };
    this.entries.set(key, entry);
    this.bytes += bytes;
    this.evict();
    return entry;
  }

  /**
   * Blit every chunk covering the viewport. Only each chunk's OWNED interior
   * is copied — the gutter exists so geometry crossing the boundary is
   * complete, not so it can be drawn twice.
   */
  paint(
    ctx: Ctx2D, cam: Camera, world: RoadWorld, style: RoadStyle,
    makeSurface: (w: number, h: number) => Surface | null,
  ): number {
    const z = cam.zoom;
    // Viewport in projected world pixels.
    const wx0 = -cam.x / z, wy0 = -cam.y / z;
    const wx1 = (cam.vw - cam.x) / z, wy1 = (cam.vh - cam.y) / z;
    const cx0 = Math.floor(wx0 / ROAD_CHUNK_W), cx1 = Math.floor(wx1 / ROAD_CHUNK_W);
    const cy0 = Math.floor(wy0 / ROAD_CHUNK_H), cy1 = Math.floor(wy1 / ROAD_CHUNK_H);

    let blits = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const e = this.chunk(cx, cy, z, world, style, makeSurface);
        if (!e) continue;
        const sx = Math.round(GUTTER * z), sy = Math.round(GUTTER * z);
        const sw = Math.round(ROAD_CHUNK_W * z), sh = Math.round(ROAD_CHUNK_H * z);
        ctx.drawImage(
          e.surface as unknown as CanvasImageSource,
          sx, sy, sw, sh,
          Math.round(e.ox * z + cam.x), Math.round(e.oy * z + cam.y), sw, sh,
        );
        blits++;
      }
    }
    return blits;
  }
}
