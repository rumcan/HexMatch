// ══════════════════════════════════════════════════════════════════════════
// RAIL-03 (#177) — painting the vector track, and the detail tiers.
// ART-4 (#402) — the gravel bed, the slim rails and the lit edge.
//
// `rail-geometry.ts` decides what a tile's track IS; this module strokes and
// fills it, and answers the two questions the road cache asks about a chunk:
// which rail tiles to evaluate, and how much of their detail the current
// graphics tier wants.
//
// BATCHED, NOT PER TILE. Every pass below collects the whole chunk's figures
// into ONE canvas path and issues one `stroke()`/`fill()` for the lot: ballast
// margin, gravel bed, sleepers, boards, the rails' dark web, the steel head,
// the lit edge and the buffer stops are a fixed handful of draw calls per chunk,
// whatever the tile count — the same discipline `paintRoadTiles` keeps, and the
// reason ~200 rail tiles cost the same handful of calls as a single one. That
// property is asserted in `tests/unit/iso-rail-cache.test.ts`; every pass added
// here keeps it.
//
// THE PASS ORDER IS THE DEPTH. The rail pass runs AFTER the road passes (so a
// level crossing's boards and steel land on the road surface the road pass just
// drew, and the road underneath is untouched) and BEFORE any sprite, because it
// happens inside the chunk raster the structures canvas blits first. Track is
// therefore always under the trains, the platforms, the depots and every
// building — by construction, not by sorting.
//
// THE TRACK IS MADE SMALL BY THE BED, NOT BY THE RAILS. ART-4 (#402): the owner
// said the railway read far too big beside the painted map, so the cross-section
// was narrowed (`rail-geometry.ts` owns every number) and the paint was changed
// from "a wide dark band with two heavy lines" to what a railway actually looks
// like from above:
//
//   1. A TEXTURED GRAVEL BED, painted exactly the way `road-renderer.ts` paints
//      a road's asphalt: one batched stroke per pass with a `CanvasPattern` for
//      a stroke style, sampled in ABSOLUTE GROUND COORDINATES so two chunks (and
//      two tiles) sample the same material field and the surface does not slide
//      when the camera pans or a chunk boundary falls on it. The swatch is a
//      code-generated seamless gravel (`gravelRaster` below) until the lead
//      ships a painted one — see `RAIL_BALLAST_TEXTURE` for the file and size
//      that swap wants.
//   2. A LIGHT MARGIN under the bed rather than the dark rim it used to have, so
//      the gravel fades into the grass instead of ringing the track in a dark
//      outline (the same reason the road's shoulder is a translucent darkening
//      rather than a border).
//   3. SLIM STEEL with its shadow on the wrong side: the web is stroked first at
//      full width, then the head is stroked OVER it offset towards the light,
//      which leaves the dark line along the rail's lower-right edge. That is the
//      whole of the "thin upper-left highlight" — one extra pass at the closest
//      zoom draws a brighter hairline on the same lit side.
//   4. SHORT, DARK SLEEPERS on the absolute lattice `rail-geometry.ts` builds —
//      evenly spaced along straights, diagonals and curves alike, because the
//      lattice is a property of the leg, not of the shape.
//
// THE BED IS DRAPED. E2 (#267): every point this module traces goes through the
// `Draper` the cache hands over (the identity unless the map carries heights),
// so the gravel lies on the hillside with the rails on top of it. The bed, the
// ties, the rails, the crossing boards and the stops are all ground-plane
// figures, so one seam drapes the whole railway.
//
// GRAPHICS TIERS. Two things cap the detail: the atlas detail cap (0.5 / 1 / 2,
// the quality preset the art tiers use) and the CAMERA ZOOM (0.5 / 1 / 2), and
// the WEAKER of the two wins — `railDetailForZoom`. Rasters are cached per
// (zoom, chunk), so the zoom is a free axis: `paintRailTiles` reads the scale
// off the context it was handed (`contextZoom`) and never asks a caller to
// remember which zoom it is painting.
//
//   closest (2×)  gravel bed + sleepers + both rails + the lit edge, boards
//   middle  (1×)  the same, minus the lit edge and the individual boards
//   far    (0.5×) ONE thin two-tone line down the centre-lines: a dark gravel
//                 band with the steel line through it, no bed and no sleepers
//
// A lower tier never moves anything: every sleeper it draws is one the high
// tier also draws, at the identical coordinates, and no rail, board or stop
// changes size. That is asserted in the unit tests; it is the same rule the
// scenery LOD keeps in the renderer.
// ══════════════════════════════════════════════════════════════════════════
import { HW, MAP_H, MAP_W, ZOOM_STEPS } from "../game/config";
import { detailTierFor, type DetailTier } from "./detail-tiers";
import {
  RAIL_BED_SHOULDER, RAIL_BED_WIDTH, RAIL_WEB_WIDTH, RAIL_WIDTH, TIE_WIDTH,
  railTile, DIAG_N, DIAG_E, DIAG_S, DIAG_W, type GroundPoint, type RailTile,
} from "./rail-geometry";
import { WATER, type Grid } from "./grid";
import {
  DEFAULT_BRIDGE_STYLE, deckAxis, paintBridgeDecks, paintBridgeRailings, type BridgeDeck,
} from "./bridge-renderer";
import { FLAT_DRAPER, type Draper } from "./elevation";

type Ctx2D = CanvasRenderingContext2D;

/** The rail layer's PRESENT bit — the same one `track.ts` and `rail.ts` use. */
const PRESENT = 0b10000;
const BITS = 0b1111;
/** The diagonal link bits (`RAIL_DE`/`RAIL_DS` in rail.ts), re-declared like PRESENT. */
const DE = 32, DS = 64;

/**
 * The rail layer as the renderer reads it: the EFFECTIVE masks (a structure's
 * internal lane folded in, which is what makes a platform's port join the
 * network) with the PRESENT bit, the effective owner, and the rail revision the
 * bytes were written from.
 *
 * Deliberately the raw byte arrays the simulation already maintains plus its
 * revision counter — the painter derives everything it draws from them and
 * writes nothing back, exactly like `RoadWorld`.
 */
export interface RailLayer {
  tile?: Uint8Array;
  owner?: Uint8Array;
  /** `Rail.revision`: the invalidation gate the renderer diffs against. */
  revision?: number;
}

/** The world view a rail paint needs: the layer, plus the roads it crosses. */
export interface RailWorld {
  rail?: RailLayer;
  roadBits?: Uint8Array;
  dirtBits?: Uint8Array;
  /**
   * R2 (#266): the map, for the one question a rail tile's own bytes cannot
   * answer — is this tile WATER? Track on water is a bridge deck, and that is
   * what the painter draws a deck for. Optional, and deliberately so: a world
   * without a map draws the track it always drew, exactly as `RoadWorld.grid`
   * is optional for town streets.
   */
  grid?: Grid;
}

/**
 * R2 (#266): every rail BRIDGE DECK in a range — rail tiles standing on water.
 * Same derivation as `roadBridgeDecksIn` (track on water IS a bridge, so no new
 * byte or wire field is needed) and the same axis rule (`deckAxis`).
 */
export function railBridgeDecksIn(
  world: RailWorld, tx0: number, ty0: number, tx1: number, ty1: number,
): BridgeDeck[] {
  const grid = world.grid, layer = world.rail;
  if (!grid || !layer?.tile) return [];
  const isWater = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && grid.terrain[y * MAP_W + x] === WATER;
  const out: BridgeDeck[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const cell = cellAt(layer.tile, tx, ty);
      if ((cell & PRESENT) === 0) continue;
      if (!isWater(tx, ty)) continue;
      out.push({ tx, ty, axis: deckAxis(cell, isWater, tx, ty) });
    }
  }
  return out;
}

/**
 * Anything `createPattern` accepts. Structural, not imported from
 * `road-renderer.ts`: rail-renderer is imported BY the road renderer, so the
 * value/type import would close a runtime cycle — the same reason
 * `rail-geometry.ts` re-declares its direction bits.
 */
export interface RailTextureImage {
  width: number;
  height: number;
}

/**
 * The railway's palette. Values are the art's own (see the generator's PALETTE).
 */
export interface RailStyle {
  /** Ballast aggregate — the flat colour, and the fallback when no texture. */
  bed: string;
  /** The soft, LIGHT margin under the bed (ART-4: it used to be a dark rim). */
  bedEdge: string;
  /** Weathered timber: sleepers and crossing boards. */
  tie: string;
  plank: string;
  /** Steel: the dark web under the head, the head itself, and its lit edge. */
  web: string;
  steel: string;
  /**
   * ART-4 (#402): the brighter hairline along each rail's lit (upper-left)
   * side. Drawn only where a block of rails can afford it (see
   * `RailDetail.lit`) — the offset head already carries the highlight, and on a
   * patch of track this pass is the one that would tip the steel to white.
   */
  lit: string;
  /** The buffer stop's beam. */
  stop: string;
  /**
   * ART-4 (#402): the painted ballast swatch, once the lead ships one. NULL
   * (the default) uses the code-generated gravel, so the textured bed works on
   * a checkout with no art at all — `RAIL_BALLAST_TEXTURE` names the file this
   * field wants. Installed with `RoadCache.setRailStyle`, exactly as
   * `RoadStyle.paved.image` is installed by `renderer.setRoadStyle`.
   */
  ballast: RailTextureImage | null;
}

/**
 * Neutral steel and timber for every owner — see the geometry module's header
 * for why the railway is not team-coloured (the roads are not either).
 * ART-4 (#402): the bed is a grey-brown gravel, the margin is LIGHTER than the
 * bed rather than darker (the dark rim is what made the old track read as one
 * wide band), and the steel is the one bright line on the ground.
 */
export const DEFAULT_RAIL_STYLE: RailStyle = {
  bed: "#6d6355",
  bedEdge: "#998f7c",
  tie: "#493b2c",
  plank: "#7b6a52",
  web: "#4b4741",
  steel: "#b2b8be",
  lit: "#e9edf0",
  stop: "#8f3f2b",
  ballast: null,
};

/**
 * Opacity of the light gravel margin under the bed.
 *
 * ART-4 (#402) measured this, twice. At 0.42 the margin read as a soft halo
 * rather than as the "slightly lighter edge where it meets the grass" the
 * ticket asks for; at 0.72 it is still clearly part of the ground it lies on
 * (the `bedEdge` colour is only a shade lighter than the bed) and the ballast
 * reads as a bed with a shoulder rather than as a line drawn on the grass.
 */
const BED_MARGIN_ALPHA = 0.72;

/**
 * How far the steel head sits from the web, and the lit hairline from the head,
 * in GROUND units — one constant direction, always the same way on screen.
 *
 * The projection sends a ground vector (du, dv) to screen ((du−dv)·HW,
 * (du+dv)·HH), so `(−a, −b)` with a > b > 0 is always up and to the left, and
 * the web left showing on the other side of the head is the rail's shadow. A
 * CONSTANT ground offset (never a per-tile one) is what keeps that edge
 * continuous where two tiles meet at a port, and it works on a diagonal exactly
 * as on a straight. The same trick the roads use for their lamps'
 * `pxUp`/`pxRight`.
 */
export const RAIL_LIT_OFFSET: GroundPoint = [-0.014, -0.005];
/** The lit hairline's width — a quarter of the head, i.e. a spark, not a line. */
export const RAIL_LIT_WIDTH = 0.009;
/**
 * The lit hairline's opacity.
 *
 * Low on purpose, and the difference between a highlight and a white line: the
 * bed is 4–6 px wide at the closest zoom, and an opaque hairline down each rail
 * tips the whole strip to white — the "wide dark band", in reverse. The offset
 * steel head already carries the highlight, and this is the spark on top of it.
 */
export const RAIL_LIT_ALPHA = 0.3;

/**
 * The FAR LOD — "a thin two-tone line" (the ticket's word for the zoomed-out
 * track): a dark gravel band with the steel through it, along the tile
 * CENTRE-lines rather than as two rails, because at 0.5× two 0.4 px rails 4 px
 * apart are a smudge and one line is legible.
 */
export const RAIL_FAR_BED_WIDTH = 0.19;
export const RAIL_FAR_RAIL_WIDTH = 0.045;

// ── ART-4 (#402): the ballast gravel ────────────────────────────────────────
/**
 * The code-generated gravel swatch: 128×128 px, seamless, one repeat spanning
 * `GRAVEL_REPEAT` tile units of ground.
 *
 * The numbers are a texture's, not a drawing's: at the closest zoom one texel
 * is a little over one screen pixel, so a pebble (3–5 texels) is the 3–5 px
 * speck gravel actually looks like, and at 1× the same pebbles are 1–3 px and
 * read as grit rather than as boulders.
 */
export const GRAVEL_TEXTURE_SIZE = 128;
/** Ground-plane tile units one repeat of the gravel spans, across its width. */
export const GRAVEL_REPEAT = 1.2;

/**
 * The PAINTED swatch this code-generated one wants to be replaced by (ART-4
 * says so in as many words: the lead generates the painted art).
 *
 * The field is wired the whole way through — `railBallastPattern` samples
 * `style.ballast` in preference to the generated swatch — so the swap is two
 * mechanical pieces of plumbing OUTSIDE this ticket's file: a
 * `setRailBallast(image)` on `RoadCache`/`IsoRenderer` (the mirror of
 * `setRoadStyle`, in `renderer.ts` / `road-renderer.ts`) and the boot load of
 * `assets/railway/ballast.webp` in `game.ts`, beside the `assets/roads/*` load.
 * Both are listed as follow-ups in the PR rather than done here, because the
 * renderer restriction is lifted for this file only.
 *
 * Until then the generated swatch ships: a checkout with no art at all still
 * gets a textured bed, not a gradient.
 */
export const RAIL_BALLAST_TEXTURE = {
  file: "assets/railway/ballast.webp",
  source: "tools/texture-src/ballast-src.png",
  size: 256,
  /** Tile units one repeat spans; keep it the same or the grain changes scale. */
  repeat: GRAVEL_REPEAT,
} as const;

/** The gravel's own colours. Grey-brown, and never a pure grey or a pure brown. */
const GRAVEL_BASE: readonly [number, number, number] = [0x6d, 0x63, 0x55];
/** Pebble tones, dark to light; a pebble takes one and a lit cap of a lighter one. */
const GRAVEL_DARK: readonly [number, number, number] = [0x51, 0x49, 0x3f];
const GRAVEL_LIGHT: readonly [number, number, number] = [0xa3, 0x99, 0x88];
/** ±10% lightness of wrapping noise under the pebbles. */
const GRAVEL_CONTRAST = 0.2;
/** How many pebbles one 128 px swatch gets. */
const GRAVEL_PEBBLES_PER_TEXEL = 0.03;
/** Fixed seed: the map's gravel must look the same on every boot and in tests. */
const GRAVEL_SEED = 402;
/** The widest a pebble may be drawn, in texels — the raster's wrap uses it. */
const GRAVEL_MAX_PEBBLE = 6;

/** mulberry32 — a small deterministic PRNG. Same seed, same swatch, always. */
function rng32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hash of a lattice point, in [0,1). */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * Value noise that TILES: the lattice wraps at `cells`, so the sample at u = 1
 * is the sample at u = 0 and the swatch has no seam — a lattice that simply
 * ran out of samples at the edge would show a grid across every track on the
 * map, and the wrap energy is asserted in the unit tests.
 */
function tilingNoise(u: number, v: number, cells: number, seed: number): number {
  const fx = u * cells, fy = v * cells;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = smooth(fx - x0), ty = smooth(fy - y0);
  const w = (i: number): number => ((i % cells) + cells) % cells;
  const a = hash2(w(x0), w(y0), seed), b = hash2(w(x0 + 1), w(y0), seed);
  const c = hash2(w(x0), w(y0 + 1), seed), d = hash2(w(x0 + 1), w(y0 + 1), seed);
  const top = a + (b - a) * tx, bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

/** A pebble, as the raster draws it: centre, radii and tone, all in texels. */
export interface GravelPebble {
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** 0 = darkest tone, 1 = lightest. */
  tone: number;
  /** Rotation, so the pebbles are not an army of axis-aligned ellipses. */
  angle: number;
}

/**
 * The swatch's pebbles. Pure and deterministic, and independent of the raster:
 * the wrap (see `gravelPebbleCopies`) and the tile seam can be checked on the
 * list rather than on somebody's eye.
 */
export function gravelPebbles(size = GRAVEL_TEXTURE_SIZE): GravelPebble[] {
  const rnd = rng32(GRAVEL_SEED ^ (size * 2654435761));
  const count = Math.round(size * size * GRAVEL_PEBBLES_PER_TEXEL);
  const out: GravelPebble[] = [];
  for (let i = 0; i < count; i++) {
    // A pebble's half-width, up to the wrap's own reach (`GRAVEL_MAX_PEBBLE`).
    const r = GRAVEL_MAX_PEBBLE * (0.1 + rnd() * 0.35);
    out.push({
      x: rnd() * size,
      y: rnd() * size,
      rx: r,
      ry: r * (0.55 + rnd() * 0.45),
      tone: rnd(),
      angle: rnd() * Math.PI,
    });
  }
  return out;
}

/**
 * Every copy of a pebble the raster has to draw — the pebble itself, plus the
 * copies just outside the swatch whose bodies still reach inside it. Drawing
 * those is what makes the PEBBLE layer seamless as well as the noise under it.
 */
export function gravelPebbleCopies(
  p: GravelPebble, size = GRAVEL_TEXTURE_SIZE,
): GroundPoint[] {
  const reach = Math.max(p.rx, p.ry) + 1;
  const out: GroundPoint[] = [];
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      const x = p.x + dx, y = p.y + dy;
      if (x + reach < 0 || x - reach > size || y + reach < 0 || y - reach > size) continue;
      out.push([x, y]);
    }
  }
  return out;
}

/** Fill one rotated ellipse of the raster, wrapping at the swatch's edges. */
function fillPebble(
  px: Uint8ClampedArray, size: number, at: GroundPoint, p: GravelPebble,
  colour: readonly [number, number, number], alpha: number,
): void {
  const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
  const reach = Math.ceil(Math.max(p.rx, p.ry) + 1);
  const x0 = Math.floor(at[0] - reach), x1 = Math.ceil(at[0] + reach);
  const y0 = Math.floor(at[1] - reach), y1 = Math.ceil(at[1] + reach);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - at[0], dy = y + 0.5 - at[1];
      const lx = (dx * cos + dy * sin) / p.rx, ly = (-dx * sin + dy * cos) / p.ry;
      const d = lx * lx + ly * ly;
      if (d > 1) continue;
      // A soft edge: the middle of a pebble is its own tone, the rim feathers
      // into the grain underneath, which is what keeps 3-px stones from
      // reading as holes punched in the bed.
      const cover = alpha * Math.min(1, (1 - d) * 2.2);
      if (cover <= 0) continue;
      const wx = ((x % size) + size) % size, wy = ((y % size) + size) % size;
      const i = (wy * size + wx) * 4;
      for (let c = 0; c < 3; c++) px[i + c] = px[i + c] + (colour[c] - px[i + c]) * cover;
    }
  }
}

/**
 * The gravel swatch as RGBA bytes: wrapping noise, then pebbles with a lit cap
 * on the upper-left of each one — the same light the rails' lit edge comes
 * from, so the bed and the steel agree about where the sun is.
 *
 * PURE, so it can be built (and checked) without a canvas: the browser path
 * blits it with `putImageData`, a test reads the numbers, and the SVG preview
 * writes it out as a PNG. One implementation, three consumers.
 */
export function gravelRaster(size = GRAVEL_TEXTURE_SIZE): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      const n = 0.62 * tilingNoise(u, v, 12, GRAVEL_SEED)
        + 0.38 * tilingNoise(u, v, 27, GRAVEL_SEED ^ 0x9e37);
      const k = 1 + (n - 0.5) * GRAVEL_CONTRAST;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) px[i + c] = GRAVEL_BASE[c] * k;
      px[i + 3] = 255;
    }
  }
  for (const p of gravelPebbles(size)) {
    const body: readonly [number, number, number] = [
      GRAVEL_DARK[0] + (GRAVEL_LIGHT[0] - GRAVEL_DARK[0]) * p.tone,
      GRAVEL_DARK[1] + (GRAVEL_LIGHT[1] - GRAVEL_DARK[1]) * p.tone,
      GRAVEL_DARK[2] + (GRAVEL_LIGHT[2] - GRAVEL_DARK[2]) * p.tone,
    ];
    const lit: readonly [number, number, number] = [
      Math.min(255, body[0] * 1.34 + 12), Math.min(255, body[1] * 1.34 + 12),
      Math.min(255, body[2] * 1.34 + 12),
    ];
    const cap: GravelPebble = {
      ...p, rx: p.rx * 0.62, ry: p.ry * 0.62,
      // The cap is the "upper-left" of the pebble on the GROUND plane; the
      // projection turns it into the upper-left of the ellipse on screen.
      x: p.x - p.rx * 0.3, y: p.y - p.ry * 0.3,
    };
    for (const at of gravelPebbleCopies(p, size)) fillPebble(px, size, at, p, body, 0.72);
    for (const at of gravelPebbleCopies(cap, size)) fillPebble(px, size, at, cap, lit, 0.5);
  }
  return px;
}

/** A surface this module can generate into; `HTMLCanvasElement` in the game. */
interface GravelSurface {
  width: number;
  height: number;
  getContext(kind: "2d"): Ctx2D | null;
}

/**
 * The swatch as an image, built once per process and remembered even when it
 * FAILS: a test environment with no canvas (node, jsdom without the `canvas`
 * package) must not retry — and log — on every chunk it paints.
 */
let gravelCache: GravelSurface | null | undefined;

/** The generated gravel swatch, or null where no canvas exists. */
export function gravelImage(): GravelSurface | null {
  if (gravelCache !== undefined) return gravelCache;
  gravelCache = null;
  try {
    const g = globalThis as {
      OffscreenCanvas?: new (w: number, h: number) => GravelSurface;
      document?: { createElement(tag: string): GravelSurface };
    };
    const surface = g.OffscreenCanvas
      ? new g.OffscreenCanvas(GRAVEL_TEXTURE_SIZE, GRAVEL_TEXTURE_SIZE)
      : g.document?.createElement("canvas");
    if (!surface) return (gravelCache = null);
    surface.width = GRAVEL_TEXTURE_SIZE;
    surface.height = GRAVEL_TEXTURE_SIZE;
    const ctx = surface.getContext("2d");
    if (!ctx || typeof ctx.putImageData !== "function") return (gravelCache = null);
    const Image = (globalThis as { ImageData?: new (p: Uint8ClampedArray, w: number, h: number) => ImageData }).ImageData;
    if (!Image) return (gravelCache = null);
    ctx.putImageData(new Image(gravelRaster(GRAVEL_TEXTURE_SIZE), GRAVEL_TEXTURE_SIZE, GRAVEL_TEXTURE_SIZE), 0, 0);
    gravelCache = surface;
  } catch {
    gravelCache = null;
  }
  return gravelCache;
}

/** A matrix for a pattern's own transform; `DOMMatrix` where it exists. */
function makeMatrix(): DOMMatrix {
  const g = globalThis as { DOMMatrix?: typeof DOMMatrix };
  if (g.DOMMatrix) return new g.DOMMatrix();
  const stub = {
    m11: 1, m12: 0, m21: 0, m22: 1, e: 0, f: 0,
    translateSelf(x: number, y: number) { this.e += x; this.f += y; return this; },
    scaleSelf(x: number, y?: number) { this.m11 *= x; this.m22 *= y ?? x; return this; },
  };
  return stub as unknown as DOMMatrix;
}

/**
 * The gravel as a pattern bound to THIS context, sampling ABSOLUTE GROUND
 * coordinates: the context is already in ground units, so the whole mapping is
 * one uniform scale (`repeat / width` ground units per texture pixel). There is
 * no camera term and no chunk origin, which is the point — two chunks sample
 * the same material field, so the bed does not slide under the track.
 *
 * Null when there is no texture to sample or the context cannot take one: the
 * caller falls back to `style.bed`, which is a complete look, not a hole.
 */
export function railBallastPattern(
  ctx: Ctx2D, style: RailStyle = DEFAULT_RAIL_STYLE,
): CanvasPattern | null {
  if (typeof ctx.createPattern !== "function") return null;
  const image = style.ballast ?? gravelImage();
  if (!image || !image.width) return null;
  const p = ctx.createPattern(image as unknown as CanvasImageSource, "repeat");
  if (!p || typeof p.setTransform !== "function") return null;
  const repeat = style.ballast ? RAIL_BALLAST_TEXTURE.repeat : GRAVEL_REPEAT;
  const m = makeMatrix();
  m.scaleSelf(repeat / image.width, repeat / image.width);
  p.setTransform(m);
  return p;
}

/** How much of the track's detail a tier draws. */
export interface RailDetail {
  /** A stable key — the cache re-keys its rasters when it changes. */
  key: DetailTier;
  /** Draw the ballast bed (and its soft edge). */
  bed: boolean;
  /** Paint the bed with the gravel TEXTURE rather than its flat colour. */
  gravel: boolean;
  /** Draw sleepers at all. */
  ties: boolean;
  /** Draw every n-th sleeper from the lattice (1 = every one, 2 = every second). */
  tieStride: number;
  /** Draw the crossing as individual boards rather than one slab. */
  boards: boolean;
  /** Two rails… or, false, ONE two-tone line down the centre-lines (far LOD). */
  railPair: boolean;
  /** Draw the lit hairline along each rail (the closest zoom's extra). */
  lit: boolean;
}

const DETAIL: Record<DetailTier, RailDetail> = {
  high: { key: "high", bed: true, gravel: true, ties: true, tieStride: 1, boards: true, railPair: true, lit: true },
  medium: { key: "medium", bed: true, gravel: true, ties: true, tieStride: 1, boards: false, railPair: true, lit: false },
  low: { key: "low", bed: false, gravel: false, ties: false, tieStride: 2, boards: false, railPair: false, lit: false },
};

/** The detail a graphics tier draws. The atlas detail cap is 0.5 / 1 / 2. */
export const railDetailFor = (cap: number): RailDetail => DETAIL[detailTierFor(cap)];

/** The zoom the full detail is drawn at, and the one the far LOD ends at. */
export const RAIL_CLOSE_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
export const RAIL_MID_ZOOM = ZOOM_STEPS[Math.max(0, ZOOM_STEPS.length - 2)];

const RANK: Record<DetailTier, number> = { high: 2, medium: 1, low: 0 };

/**
 * The detail a CAMERA ZOOM draws, capped by what the quality preset allows —
 * the weaker of the two wins, so a low-quality boot never gains the closest
 * zoom's extra work and a zoomed-out view never draws the full bed.
 *
 * The three zoom steps of the game are the ticket's own three (the closest zoom
 * is full detail, the middle one keeps the bed and the rails, the far one is a
 * thin two-tone line), and `ZOOM_STEPS` is where they come from, so a fourth
 * step would join the middle tier rather than fall off the end.
 */
export function railDetailForZoom(base: RailDetail, zoom: number): RailDetail {
  const atZoom: DetailTier = zoom >= RAIL_CLOSE_ZOOM ? "high" : zoom >= RAIL_MID_ZOOM ? "medium" : "low";
  return RANK[atZoom] < RANK[base.key] ? DETAIL[atZoom] : base;
}

/**
 * The ground-plane scale of the context a painter was handed, from its own
 * transform — the cache rasterises under `setTransform(HW·z, HH·z, …)`, so
 * `a / HW` is the zoom the raster is being baked at. Null when the context has
 * no transform to read (a recording stub in a test, an exotic 2D backend), in
 * which case the painter draws the tier it was handed and nothing is guessed.
 */
export function contextZoom(ctx: Ctx2D): number | null {
  const m = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
  const a = m ? (m as DOMMatrix).a : undefined;
  return typeof a === "number" && a > 0 ? a / HW : null;
}

/**
 * The sleepers a tier draws from a tile's lattice.
 *
 * Striding BY INDEX walks the ladder in order, so a lower tier's sleepers are
 * literally a subset of the higher tier's at the identical coordinates — the
 * promise the tier note in the header makes, kept by construction rather than
 * by a second lattice.
 */
export const tiesFor = (tile: RailTile, detail: RailDetail): readonly GroundPoint[][] =>
  detail.tieStride <= 1 ? tile.ties : tile.ties.filter((_, i) => i % detail.tieStride === 0);

/**
 * The crossing boards a tier draws: the individual boards on High, the single
 * slab that covers exactly their extent on Medium and Low.
 */
export const planksFor = (tile: RailTile, detail: RailDetail): readonly GroundPoint[][] => {
  if (!tile.plankSlab) return [];
  return detail.boards ? tile.planks : [tile.plankSlab];
};

const cellAt = (arr: Uint8Array | undefined, tx: number, ty: number): number =>
  arr && tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H ? arr[ty * MAP_W + tx] : 0;

/** The road mask at a tile, either tier — the same OR `rail.ts`'s `roadAt` makes. */
const roadMaskAt = (world: RailWorld, tx: number, ty: number): number =>
  (cellAt(world.roadBits, tx, ty) | cellAt(world.dirtBits, tx, ty)) & BITS;

/** Every rail tile in a range, as drawing descriptions. */
export function railTilesIn(
  world: RailWorld, tx0: number, ty0: number, tx1: number, ty1: number,
): RailTile[] {
  const layer = world.rail;
  if (!layer?.tile) return [];
  const maskAt = (x: number, y: number): number => cellAt(layer.tile, x, y) & BITS;
  const out: RailTile[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const cell = cellAt(layer.tile, tx, ty);
      if ((cell & PRESENT) === 0) continue;
      // Playtest (2026-09): the tile's diagonal arms. A link is stored on the
      // smaller-x tile, so the west and north arms are read off the neighbour;
      // both ends must be rail.
      const on = (x: number, y: number) => (cellAt(layer.tile, x, y) & PRESENT) !== 0;
      let diag = 0;
      if ((cellAt(layer.tile, tx - 1, ty - 1) & DS) && on(tx - 1, ty - 1)) diag |= DIAG_N;
      if ((cell & DE) && on(tx + 1, ty - 1)) diag |= DIAG_E;
      if ((cell & DS) && on(tx + 1, ty + 1)) diag |= DIAG_S;
      if ((cellAt(layer.tile, tx - 1, ty + 1) & DE) && on(tx - 1, ty + 1)) diag |= DIAG_W;
      out.push(railTile(tx, ty, cell, maskAt, roadMaskAt(world, tx, ty), diag));
    }
  }
  return out;
}

/**
 * Trace a polyline into the CURRENT path (the caller owns `beginPath`).
 *
 * E2 (#267): through the draper, like every road pass — the identity unless the
 * map carries heights, and a lift onto the terrain when it does. Sleepers, the
 * two rails, the ballast bed, the crossing boards and the buffer stops are all
 * ground-plane figures, so one seam here drapes the whole railway, the 45°
 * diagonal legs included (they are just runs with a corner for a port).
 */
function traceInto(
  ctx: Ctx2D, points: readonly (readonly [number, number])[], elev: Draper = FLAT_DRAPER,
): void {
  const pts = elev.path(points);
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
}

/** Trace a closed quad into the CURRENT path. */
function traceQuad(
  ctx: Ctx2D, quad: readonly (readonly [number, number])[], elev: Draper = FLAT_DRAPER,
): void {
  const pts = elev.path(quad);
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** One polyline shifted by a constant ground offset (the lit side of the light). */
function shifted(
  path: readonly GroundPoint[], offset: GroundPoint, times = 1,
): GroundPoint[] {
  return path.map(([u, v]) => [u + offset[0] * times, v + offset[1] * times] as GroundPoint);
}

/**
 * Paint rail tiles into a context already in ground coordinates, calling
 * `beginPath` + one stroke/fill per pass.
 */
export function paintRailTiles(
  ctx: Ctx2D,
  tiles: readonly RailTile[],
  detail: RailDetail,
  style: RailStyle = DEFAULT_RAIL_STYLE,
  /**
   * R2 (#266): the chunk's rail bridge decks. Painted under the bed (a deck is
   * what the ballast lies on) with the railings last, over the steel — see
   * `bridge-renderer.ts`.
   */
  decks: readonly BridgeDeck[] = [],
  /**
   * E2 (#267): the elevation draper. The railway rides the same cached chunk
   * raster as the roads, so it is draped by the same object and lands on the
   * same surface — a level crossing stays level because BOTH layers were lifted
   * by the same function of the ground point.
   */
  elev: Draper = FLAT_DRAPER,
): void {
  if (!tiles.length && !decks.length) return;
  // ART-4 (#402): the zoom the raster is baked at decides how much of the
  // cross-section is drawn. Read off the context (see `contextZoom`), so the
  // cache and every caller stay exactly as they were.
  const zoom = contextZoom(ctx);
  const det = zoom === null ? detail : railDetailForZoom(detail, zoom);
  ctx.save();
  // Butt caps: every arm ends exactly ON the port, where the neighbouring
  // tile's arm begins, so two tiles' steel is butt-jointed with no round cap
  // bulging over the boundary — and a dead end stops square on the edge
  // instead of poking a semicircle into the next tile. Joins (the bend at the
  // tile centre, a junction's crossing arms) stay round.
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";

  // 0. R2 (#266) The deck, under everything the railway paints on it.
  paintBridgeDecks(ctx, decks, DEFAULT_BRIDGE_STYLE, elev);

  // 1. The ballast bed. Two passes: the light margin that lets the gravel fade
  //    into the grass, then the bed itself — textured, and falling back to the
  //    flat colour wherever no pattern can be made (see `railBallastPattern`).
  if (det.bed) {
    ctx.strokeStyle = style.bedEdge;
    ctx.globalAlpha = BED_MARGIN_ALPHA;
    ctx.lineWidth = RAIL_BED_WIDTH + RAIL_BED_SHOULDER * 2;
    ctx.beginPath();
    for (const t of tiles) for (const run of t.bed) traceInto(ctx, run, elev);
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.strokeStyle = det.gravel ? (railBallastPattern(ctx, style) ?? style.bed) : style.bed;
    ctx.lineWidth = RAIL_BED_WIDTH;
    ctx.beginPath();
    for (const t of tiles) for (const run of t.bed) traceInto(ctx, run, elev);
    ctx.stroke();
  }

  // 2. Crossing boards, over the road the road pass drew and under the steel.
  //    Boards come as a list, so the tiers choose how many rectangles to draw
  //    without moving any of them.
  ctx.fillStyle = style.plank;
  ctx.beginPath();
  for (const t of tiles) for (const board of planksFor(t, det)) traceQuad(ctx, board, elev);
  ctx.fill();

  // 3. Sleepers, in their own pass over the bed. Striding by index walks the
  //    lattice in order, so the low tier's every-second sleeper is a subset of
  //    the high tier's ladder, never a shifted one.
  if (det.ties) {
    ctx.strokeStyle = style.tie;
    ctx.lineWidth = TIE_WIDTH;
    ctx.beginPath();
    for (const t of tiles) for (const tie of tiesFor(t, det)) traceInto(ctx, tie, elev);
    ctx.stroke();
  }

  // 4. The steel. On a pair tier, three passes for the whole chunk: the dark
  //    web first, the head over it OFFSET towards the light — which leaves the
  //    web showing along the rail's lower-right side, the whole of the "thin
  //    upper-left highlight" — and, at the closest zoom, a low-alpha spark on
  //    the lit side. The order is why a junction's crossing arms read as one
  //    continuous way through.
  //
  //    On the far tier there are no pairs at all: ONE two-tone line down each
  //    tile's centre-lines, a dark gravel band with the steel through it.
  if (det.railPair) {
    ctx.strokeStyle = style.web;
    ctx.lineWidth = RAIL_WEB_WIDTH;
    ctx.beginPath();
    for (const t of tiles) for (const rail of t.rails) traceInto(ctx, rail, elev);
    ctx.stroke();

    ctx.strokeStyle = style.steel;
    ctx.lineWidth = RAIL_WIDTH;
    ctx.beginPath();
    for (const t of tiles) for (const rail of t.rails) traceInto(ctx, shifted(rail, RAIL_LIT_OFFSET), elev);
    ctx.stroke();

    if (det.lit) {
      ctx.strokeStyle = style.lit;
      ctx.globalAlpha = RAIL_LIT_ALPHA;
      ctx.lineWidth = RAIL_LIT_WIDTH;
      ctx.beginPath();
      for (const t of tiles) for (const rail of t.rails) traceInto(ctx, shifted(rail, RAIL_LIT_OFFSET, 2), elev);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  } else {
    ctx.strokeStyle = style.web;
    ctx.lineWidth = RAIL_FAR_BED_WIDTH;
    ctx.beginPath();
    for (const t of tiles) for (const run of t.runs) traceInto(ctx, run, elev);
    ctx.stroke();

    ctx.strokeStyle = style.steel;
    ctx.lineWidth = RAIL_FAR_RAIL_WIDTH;
    ctx.beginPath();
    for (const t of tiles) for (const run of t.runs) traceInto(ctx, shifted(run, RAIL_LIT_OFFSET), elev);
    ctx.stroke();
  }

  // 5. Buffer stops, last: the beam sits ON the rails it ends.
  ctx.fillStyle = style.stop;
  ctx.beginPath();
  for (const t of tiles) for (const stop of t.stops) traceQuad(ctx, stop, elev);
  ctx.fill();

  // 6. R2 (#266) …and the deck's kerbs and railings, over the steel: a rail
  //    bridge's fence stands between the train and the water.
  paintBridgeRailings(ctx, decks, DEFAULT_BRIDGE_STYLE, elev);

  ctx.restore();
}
