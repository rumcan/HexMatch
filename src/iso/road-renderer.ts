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
//
// THE RAILWAY RIDES THE SAME RASTERS (RAIL-03 / #177). `rail-geometry.ts`
// produces the track's paths in the same ground plane, and each chunk paints
// them AFTER the roads — that ordering is what a level crossing is — inside the
// same surface, so track is always under the sprites and train movement (which
// changes none of the layer's bytes) repaints nothing. The cache re-keys when
// the rail DETAIL tier or the region's road mode changes, and the renderer
// invalidates single tiles with `invalidateTile(..., "rail", 1)` when a rail
// byte moves.
// ══════════════════════════════════════════════════════════════════════════
import { HW, HH, MAP_W, MAP_H, ZOOM_STEPS } from "../game/config";
import type { Camera } from "./camera";
import { WATER, isTownTile, townGroundBytes, type Grid } from "./grid";
import {
  ROAD_WIDTH, SHOULDER_WIDTH, SIDEWALK_WIDTH,
  hasRoad, paintFigures, roadTile, sidewalkJoints, sidewalkPaths, streetLampSpots, townGroundQuad,
  type GroundPoint, type RoadFigure, type RoadTile,
} from "./road-geometry";
import {
  DEFAULT_RAIL_STYLE, paintRailTiles, railBridgeDecksIn, railDetailFor, railTilesIn,
  type RailDetail, type RailLayer, type RailStyle,
} from "./rail-renderer";
import {
  DEFAULT_BRIDGE_STYLE, deckAxis, paintBridgeDecks, paintBridgeRailings, type BridgeDeck,
} from "./bridge-renderer";
import { FLAT_DRAPER, draperFor, elevationLiftPx, type Draper } from "./elevation";

type Ctx2D = CanvasRenderingContext2D;

/** The road layer's PRESENT bit (`track.ts`'s bit 4) — a lone stub still counts. */
const PRESENT = 0b10000;

/** The one-pixel softening baked into every road/rail chunk raster. */
export const ROAD_SOFTEN_FILTER = "blur(1px)";
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
  /**
   * #159: the surface a town's BLOCKS are paved with — the yards the houses
   * stand on, between the streets. Its own material rather than a reuse of
   * `dirt`, because a settlement's ground is its own thing: compacted,
   * trodden, greyer than a rural track's earth, and it has to read as made
   * ground beside both the asphalt and the grass.
   */
  town: RoadMaterialStyle;
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
  // Dark grey-brown, and deliberately within a shade or two of the asphalt:
  // a town's ground is the same made surface as its streets, one step softer
  // and browner, which is what makes the two read as one streetscape.
  town: { flat: "#4b463d", shoulder: "#4b463d", image: null, repeat: 2.6 },
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
 * #159: the wash laid over a town block's paving.
 *
 * TRANSLUCENT INK OVER WHATEVER TEXTURE THE YARD HAS, rather than a tint baked
 * into an asset, so the yard can borrow the road materials' own grain and
 * still read as the town's own surface: dark, desaturated, grey-brown. The
 * wash is what makes the same texture read as a rural track outside the
 * limits and as a trodden town yard inside them.
 */
const TOWN_GROUND_WASH = "rgba(38,37,33,0.42)";

/**
 * Opacity of the shoulder pass. The shoulder is a darkening of the ground
 * beside the road, so it has to let that ground through — at full opacity it
 * is a border, not a verge.
 */
const SHOULDER_ALPHA = 0.42;

/** Marking width in tile units. */
const PAINT_WIDTH = 0.03;

// ── #159: town-street sidewalks and lamps ───────────────────────────────────
/**
 * The sidewalk palette, and the last word on how a town street's verges look.
 *
 * Flat colours, like the road's own camber and markings: a sidewalk is a MADE
 * surface, not a sample of ground, so it has nothing to gain from a texture
 * and everything to lose from sharing the asphalt's. Light, cool concrete
 * against the road's weathered charcoal is what makes a town read as paved
 * while a highway reads as worn.
 *
 * `ribbon`/`crown` are the ticket's two greys, stroked concentrically exactly
 * as the road's camber is: the crown is the top of a slab that is a little
 * higher in the middle than at its kerbs.
 */
export const SIDEWALK_STYLE = {
  ribbon: "#c8cbd0",
  crown: "#d5d8dc",
  /**
   * The transverse joints. Dark enough to divide the ribbon into blocks, and
   * never drawn across its full width (see SIDEWALK_JOINT_INSET): the light
   * perimeter that survives is what makes each block look like a raised slab
   * rather than a stripe.
   */
  joint: "#4a4d52",
  jointAlpha: 0.9,
  /** Cast iron, the lantern's glass, and the warm incandescent light in it. */
  iron: "#33363b",
  lantern: "#ffe494",
  glow: "#fdf6d8",
  glowAlpha: 0.22,
  /** The soft contact shadow at the post's foot. */
  shadow: "rgba(10,13,9,0.34)",
} as const;

/**
 * One projected pixel, as a ground distance measured ACROSS the projection.
 *
 * The transformation sends one tile unit along a ground axis to `hypot(HW,HH)`
 * world pixels, so this is the ground length of a single one — the unit the
 * sidewalk's own 1px details (joint ink, lamp iron) are specified in. It
 * scales with the zoom with everything else in the raster pass, which is what
 * makes a sidewalk look the same at every zoom rather than thinning out.
 */
const PIXEL = 1 / Math.hypot(HW, HH);

/** Joint ink thickness: one projected pixel across the ribbon. */
const JOINT_WIDTH = PIXEL;

/**
 * The lamp, in PROJECTED WORLD pixels — the same pixel grid the sprites are
 * authored on, so it grows with the zoom exactly like the buildings it stands
 * between.
 *
 * `LAMP_POST_H + LAMP_HEAD_H` is 11px, in the 8–12 the ticket asks for, and
 * that range is the point: a town street is 32px of ground across at 1x, so a
 * post the height of the road's half-width is a piece of street furniture. At
 * twice this it stopped reading as period hardware and started reading as a
 * signal post.
 */
const LAMP_POST_H = 8;
const LAMP_HEAD_W = 3;
const LAMP_HEAD_H = 3;
/** The lantern's glass, inset into the housing rather than filling it. */
const LAMP_GLASS_W = 1.6;
const LAMP_GLASS_H = 1.8;
const LAMP_GLASS_Y = 0.6;
const LAMP_GLOW_R = 2.2;
/** The contact shadow, as a GROUND radius: the projection flattens it for us. */
const LAMP_SHADOW_R = 0.04;
/**
 * Segments in a lamp's circle. Twelve is smooth at the sizes involved — the
 * contact shadow is about two and a half world pixels across, the glow five —
 * and keeps the painter to `moveTo`/`lineTo`, which every 2D context and every
 * test stub has.
 */
const LAMP_ELLIPSE_SEGMENTS = 12;

/** A screen-space offset of `n` projected pixels to the RIGHT, in ground units. */
const pxRight = (n: number): GroundPoint => [n / (2 * HW), -n / (2 * HW)];
/** A screen-space offset of `n` projected pixels UP, in ground units. */
const pxUp = (n: number): GroundPoint => [-n / (2 * HH), -n / (2 * HH)];

/**
 * Add a ground-plane ellipse to the current path, as a polyline.
 *
 * A POLYLINE, like every other curve this feature draws (the walkway's bends
 * are arcs traced segment by segment, and so is a lamp's smudge), and not
 * `ctx.ellipse`. Two reasons, and the second is the one that matters: the
 * painting stays inside the handful of path ops every canvas has — including
 * the stubs the unit tests paint through — and a shape defined by points is
 * the same shape whether it is rasterised by a browser, by an SVG backend or
 * by a test that only counts strokes.
 */
function ellipseInto(ctx: Ctx2D, [u, v]: GroundPoint, rx: number, ry: number, rotation: number): void {
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  for (let i = 0; i <= LAMP_ELLIPSE_SEGMENTS; i++) {
    const a = (i / LAMP_ELLIPSE_SEGMENTS) * Math.PI * 2;
    const x = rx * Math.cos(a), y = ry * Math.sin(a);
    const px = u + x * cos - y * sin, py = v + x * sin + y * cos;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

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

/**
 * The tile range whose geometry can touch a projected-world rectangle.
 *
 * `liftPx` (E2 #267) is the elevation headroom: raised ground is drawn ABOVE
 * its flat position, so a tile sitting below the rectangle can still paint
 * into it. Extending the rectangle's bottom edge by the lift is what keeps a
 * chunk from rasterising a road whose far end belongs to a tile it never
 * looked at — the reason a chunk boundary cannot cut a road on a hill.
 */
export function tilesForRect(
  x0: number, y0: number, x1: number, y1: number, liftPx = 0,
): { tx0: number; ty0: number; tx1: number; ty1: number } {
  const by1 = y1 + liftPx;
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, by1], [x1, by1]] as const) {
    const [u, v] = screenToGround(x, y);
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
    if (v < v0) v0 = v;
    if (v > v1) v1 = v;
  }
  // A tile's road can reach out of the tile by half a width plus a shoulder.
  // ROADS-2 (#393): a Highway is 1.6× the paved width.
  const reach = Math.max(ROAD_WIDTH.dirt, ROAD_WIDTH.paved * 1.6) / 2 + SHOULDER_WIDTH + 0.01;
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
  /** ROADS-2 (#393): the paved tier per tile (0 Road, 1 Street, 2 Highway). */
  roadTiers?: Uint8Array;
  /**
   * #159: the map, for its TOWN LIMITS. A tile stamped `TOWN_OCC` in
   * `occupancy` is town ground — the same test `isTownTile` makes — and a
   * paved tile on town ground is a town STREET: kerbs, sidewalks and corner
   * lamps instead of rural verges.
   *
   * Optional, and deliberately so: a world without a map draws the rural road
   * it always drew, exactly as a world with no road bytes draws nothing. The
   * live renderer passes its whole `World`, whose `grid` this is.
   */
  grid?: Grid;
  /**
   * RAIL-03 (#177): the railway layer, painted by the same chunk raster as the
   * roads — after them (so a level crossing's steel and boards land on the
   * finished road surface) and inside the cache (so train movement, which
   * changes none of these bytes, repaints no track). A world without a railway
   * draws exactly the roads it always drew.
   */
  rail?: RailLayer;
}

const cellAt = (arr: Uint8Array | undefined, tx: number, ty: number): number =>
  arr && tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H ? arr[ty * MAP_W + tx] : 0;

/** Is there PAVED road on this tile? The transition classifier's one question. */
const isPaved = (world: RoadWorld, tx: number, ty: number): boolean =>
  hasRoad(cellAt(world.roadBits, tx, ty));

/**
 * #159: is this tile inside a town's limits?
 *
 * The map's own test, `isTownTile`: a town's houses, its centre AND its
 * streets are all stamped `TOWN_OCC`, so one occupancy read answers it. What
 * is NOT town ground is a public highway running between towns, which is
 * track rather than town furniture and is never stamped — which is exactly
 * the distinction the ticket draws between a town street and a rural road.
 */
const isTownStreet = (world: RoadWorld, tx: number, ty: number): boolean =>
  !!world.grid && isTownTile(world.grid, tx, ty);

/**
 * R2 (#266): every BRIDGE DECK in a range. A deck is track on water — nothing
 * else can put road bytes on a water tile — so the test is the map's terrain
 * plus the tile's own presence bit, and no new layer or wire field is needed.
 * The axis comes from the tile's direction bits (see `deckAxis`).
 *
 * Deliberately separate from `roadTilesIn`: in the sprite road mode the atlas
 * cells draw the roads, so `roadTilesIn` returns nothing — but a bridge deck is
 * not art and must still be painted, or a road bridge would render as a road
 * sprite floating on the sea.
 */
export function roadBridgeDecksIn(
  world: RoadWorld, tx0: number, ty0: number, tx1: number, ty1: number,
): BridgeDeck[] {
  const grid = world.grid;
  if (!grid) return [];
  const out: BridgeDeck[] = [];
  const isWater = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && grid.terrain[y * MAP_W + x] === WATER;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const cell = cellAt(world.roadBits, tx, ty) | cellAt(world.dirtBits, tx, ty);
      if ((cell & PRESENT) === 0) continue;
      if (!isWater(tx, ty)) continue;
      out.push({ tx, ty, axis: deckAxis(cell, isWater, tx, ty) });
    }
  }
  return out;
}

/** Every road tile in a range, as drawing descriptions. */
export function roadTilesIn(
  world: RoadWorld, tx0: number, ty0: number, tx1: number, ty1: number,
): RoadTile[] {
  const out: RoadTile[] = [];
  const paved = (x: number, y: number) => isPaved(world, x, y);
  // Town level is visual building progression only. Town road bytes are
  // paved at every level, so the road material and its connection geometry do
  // not change when a town is upgraded. In particular, a level-0 town must
  // still receive the same sidewalk treatment as a larger town; using the
  // village art tier to switch this to dirt left isolated-looking patches and
  // removed the kerb/sidewalk pass entirely.
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const road = cellAt(world.roadBits, tx, ty);
      const dirt = cellAt(world.dirtBits, tx, ty);
      const town = isTownStreet(world, tx, ty);
      // A tile carries at most one tier; paved wins if both bytes are set,
      // matching the simulation's "paving replaces dirt" rule.
      if (hasRoad(road)) {
        // ROADS-2 (#393): a Street is kerbed like a town street; a Highway
        // is wider with a solid centre line (see paintRoadTiles).
        const tier = world.roadTiers?.[ty * MAP_W + tx] ?? 0;
        const tile = roadTile(tx, ty, road, "paved", paved, town || tier === 1);
        if (tier) tile.tier = tier;
        out.push(tile);
        // ROADS-3 (#394): an overpass carries a road deck ACROSS the highway.
        if (tier === 4 || tier === 5) {
          // highway along x (SE/NW) → the deck runs along y (NE/SW), and v.v.
          const crossMask = 0x10 | (tier === 4 ? 1 | 4 : 2 | 8);
          const deck = roadTile(tx, ty, crossMask, "paved", paved, false);
          deck.deck = true;
          out.push(deck);
        }
      }
      else if (hasRoad(dirt)) out.push(roadTile(tx, ty, dirt, "dirt", paved, town));
    }
  }
  return out;
}

/**
 * #159: the paving of every town block tile in a range, ready to fill.
 *
 * One quad per tile, in tile order, so the whole of a chunk's yards go into a
 * single path and are filled in one call. A tile is paved because the map says
 * a town house stands there; it is not paved because a road passes it, which
 * is what keeps the town's limits — and the grass outside them — exactly where
 * the generator drew them.
 */
export function townGroundQuadsIn(
  world: RoadWorld, tx0: number, ty0: number, tx1: number, ty1: number,
): GroundPoint[][] {
  const blocks = world.grid ? townGroundBytes(world.grid) : null;
  if (!blocks) return [];
  // Town level changes the building footprint, not the streetscape. Keep the
  // block paving present for villages as well, so no grass wedges show
  // through between otherwise paved street tiles at game start.
  const street = (x: number, y: number) => hasRoad(cellAt(world.roadBits, x, y));
  const out: GroundPoint[][] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!cellAt(blocks, tx, ty)) continue;
      out.push(townGroundQuad(tx, ty, street));
    }
  }
  return out;
}

// ── painting ────────────────────────────────────────────────────────────────
/**
 * Add a figure to the CURRENT path, in ground coordinates. Separate from
 * `trace` because the batched passes below put many figures in one path: a
 * single stroke call is one rasterisation of the whole lot, which is what
 * keeps a street of sidewalks as cheap as a single stroke of asphalt.
 */
/**
 * E2 (#267): every path a painter traces goes through the draper, which is the
 * identity (`FLAT_DRAPER`) unless the map has elevation. One seam for the whole
 * module: the passes below keep stroking in ground units, under the one affine
 * transform, with their widths and joins exactly as they were.
 */
function traceInto(ctx: Ctx2D, fig: RoadFigure, elev: Draper = FLAT_DRAPER): void {
  const pts = elev.path(fig.points);
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

/** Trace one figure into a path of its own. */
function trace(ctx: Ctx2D, fig: RoadFigure, elev: Draper = FLAT_DRAPER): void {
  ctx.beginPath();
  traceInto(ctx, fig, elev);
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
 * #159 — the paved yards of a town's blocks, under everything else.
 *
 * One path, one fill, one wash: the whole town's ground costs two canvas
 * operations per chunk however many blocks it has. It goes down FIRST, before
 * the shoulders, the sidewalks and the asphalt, because it is the ground the
 * other three sit on — and because the kerbs have to be painted over the band
 * the paving reaches under them, not beside it.
 */
function paintTownGround(
  ctx: Ctx2D, quads: GroundPoint[][], fill: string | CanvasPattern,
  elev: Draper = FLAT_DRAPER,
): void {
  if (!quads.length) return;
  ctx.save();
  ctx.lineJoin = "miter";
  ctx.beginPath();
  for (const quad of quads) {
    const pts = elev.path(quad);
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.fillStyle = TOWN_GROUND_WASH;
  ctx.fill();
  ctx.restore();
}

/**
 * #159 — the sidewalks of a set of town-street tiles, in one batched pass.
 *
 * Every ribbon in the chunk goes into a SINGLE path and is stroked once per
 * coat, because the whole lot shares one width and one colour: the difference
 * between a street and a whole town of streets is then the difference between
 * four subpaths and four hundred, not between one stroke call and four
 * hundred. The joints are batched the same way.
 *
 * Cap and join are the load-bearing details. BUTT caps, so a ribbon ends
 * square on the port where the neighbour's ribbon begins — a round cap would
 * bulge past it and, worse, would round the END of an arm whose neighbour has
 * no sidewalk at all, which is what the town's limits look like. ROUND joins,
 * so a bend's outer arc has no seam down its inside.
 */
function paintSidewalks(ctx: Ctx2D, tiles: RoadTile[], elev: Draper = FLAT_DRAPER): void {
  const streets = tiles.filter((t) => t.sidewalk);
  if (!streets.length) return;

  const paths: RoadFigure[] = [];
  const joints: RoadFigure[] = [];
  for (const t of streets) {
    for (const path of sidewalkPaths(t.tx, t.ty, t.mask)) {
      paths.push(path);
      for (const joint of sidewalkJoints(path)) joints.push(joint);
    }
  }

  ctx.save();
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  // The slab, then its crown: two concentric strokes, the trick the road's own
  // camber already uses. `traceInto` puts every run in the one path.
  for (const [colour, width] of [[SIDEWALK_STYLE.ribbon, SIDEWALK_WIDTH],
    [SIDEWALK_STYLE.crown, SIDEWALK_WIDTH * 0.55]] as const) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const path of paths) traceInto(ctx, path, elev);
    ctx.stroke();
  }
  // The joints, over the finished ribbon: a run of slabs, not a painted line.
  ctx.strokeStyle = SIDEWALK_STYLE.joint;
  ctx.globalAlpha = SIDEWALK_STYLE.jointAlpha;
  ctx.lineWidth = JOINT_WIDTH;
  ctx.lineCap = "butt";
  ctx.beginPath();
  for (const joint of joints) traceInto(ctx, joint, elev);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * #159 — the street lamps of a set of town-street tiles.
 *
 * A lamp is a SCREEN-space object standing on a ground point, which is why it
 * is drawn from explicit pixel offsets rather than in ground units: its post
 * rises straight up the screen, its lantern is an axis-aligned little box like
 * the pixel-art buildings, and its shadow is the one part that is a ground
 * shape (an ellipse under the projection, so it lies on the pavement).
 *
 * Drawn last of everything on a road, because a lamp stands ABOVE the ground
 * it is planted in: its head can legitimately hang over the next tile's
 * asphalt, and the asphalt was painted several passes ago.
 */
function paintStreetLamps(ctx: Ctx2D, tiles: RoadTile[], elev: Draper = FLAT_DRAPER): void {
  const spots: GroundPoint[] = [];
  for (const t of tiles) {
    if (!t.sidewalk) continue;
    // E2 (#267): the post is planted on the DRAPEd spot and its head is built
    // from there with the same screen-pixel offsets, so a lamp stands on the
    // pavement however the street slopes, and still rises straight up the
    // screen by exactly LAMP_POST_H pixels.
    for (const spot of streetLampSpots(t.tx, t.ty, t.mask)) {
      const [u, v] = elev.point(spot[0], spot[1]);
      spots.push([u, v]);
    }
  }
  if (!spots.length) return;

  ctx.save();
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  for (const base of spots) {
    // 1. The contact shadow the post casts on the pavement. A ground circle:
    //    the projection flattens it into the iso smudge a shadow should be.
    ctx.fillStyle = SIDEWALK_STYLE.shadow;
    ctx.beginPath();
    ellipseInto(ctx, base, LAMP_SHADOW_R, LAMP_SHADOW_R, 0);
    ctx.fill();

    // 2. The iron post, and the lantern it carries: a screen-aligned box, so
    //    its 4x3 pixels read as pixels at every zoom.
    const head: GroundPoint = [base[0] + pxUp(LAMP_POST_H)[0], base[1] + pxUp(LAMP_POST_H)[1]];
    ctx.strokeStyle = SIDEWALK_STYLE.iron;
    ctx.lineWidth = PIXEL;
    ctx.beginPath();
    ctx.moveTo(base[0], base[1]);
    ctx.lineTo(head[0], head[1]);
    ctx.stroke();

    const corner = (right: number, up: number): GroundPoint => [
      head[0] + pxRight(right)[0] + pxUp(up)[0],
      head[1] + pxRight(right)[1] + pxUp(up)[1],
    ];
    const [bl, br, tr, tl] = [
      corner(-LAMP_HEAD_W / 2, 0), corner(LAMP_HEAD_W / 2, 0),
      corner(LAMP_HEAD_W / 2, LAMP_HEAD_H), corner(-LAMP_HEAD_W / 2, LAMP_HEAD_H),
    ];
    // 3. The warm light it throws, BEFORE the lantern that contains it: the
    //    glow belongs around the glass, not painted over its housing.
    const bulb: GroundPoint = [corner(0, LAMP_HEAD_H / 2)[0], corner(0, LAMP_HEAD_H / 2)[1]];
    const glowR = LAMP_GLOW_R / (Math.SQRT2 * HW), glowRy = LAMP_GLOW_R / (Math.SQRT2 * HH);
    ctx.fillStyle = SIDEWALK_STYLE.glow;
    ctx.globalAlpha = SIDEWALK_STYLE.glowAlpha;
    ctx.beginPath();
    ellipseInto(ctx, bulb, glowR, glowRy, -Math.PI / 4);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = SIDEWALK_STYLE.iron;
    ctx.beginPath();
    ctx.moveTo(bl[0], bl[1]);
    ctx.lineTo(br[0], br[1]);
    ctx.lineTo(tr[0], tr[1]);
    ctx.lineTo(tl[0], tl[1]);
    ctx.closePath();
    ctx.fill();

    // 4. The glass: a smaller warm pane INSIDE the housing, so the lamp reads
    //    as an iron lantern with a light in it rather than as a yellow sign.
    ctx.fillStyle = SIDEWALK_STYLE.lantern;
    ctx.beginPath();
    const glass = [
      corner(-LAMP_GLASS_W / 2, LAMP_GLASS_Y), corner(LAMP_GLASS_W / 2, LAMP_GLASS_Y),
      corner(LAMP_GLASS_W / 2, LAMP_GLASS_Y + LAMP_GLASS_H), corner(-LAMP_GLASS_W / 2, LAMP_GLASS_Y + LAMP_GLASS_H),
    ];
    ctx.moveTo(glass[0][0], glass[0][1]);
    for (const p of glass.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Paint a set of road tiles into a context that is ALREADY in ground
 * coordinates — i.e. whose transform maps tile units to device pixels.
 *
 * Pass order is bottom-up and deliberate, and #159 slots the town-street work
 * into it rather than beside it:
 *
 *   0. town ground  — the paved blocks a town's houses stand on;
 *   1. shoulders    — ground disturbed at the road's edge, under the core;
 *   1b. sidewalks   — the walkways, over the shoulders and UNDER the asphalt,
 *                     which is what trims them at every junction for free;
 *   2. the core     — opaque asphalt or earth;
 *   2b. camber      — the cross-width shading;
 *   3. transitions  — the dirt→paved blend, over the finished dirt;
 *   4. markings     — centre-lines, on paved tiles, never across a junction;
 *   5. lamps        — last, because a lamp stands ON the ground it is planted
 *                     in and its head may hang over the next tile's asphalt.
 *
 * Every pass strokes with a width in TILE UNITS; the context transform turns
 * that into the correct projected width, including its foreshortening on each
 * diagonal. The lamp is the one exception, drawn in projected pixels like the
 * sprite art it stands among.
 *
 * `townGround` is the block paving to lay down first, in the same ground
 * coordinates — one quad per paved tile, from `townGroundQuadsIn`.
 */
/** ROADS-2 (#393): a tile's carriageway width — Street narrower, Highway wider. */
const widthOf = (t: RoadTile): number =>
  t.material !== "paved" ? ROAD_WIDTH[t.material]
    : t.deck ? ROAD_WIDTH.paved
      : (t.tier === 2 || t.tier === 4 || t.tier === 5) ? ROAD_WIDTH.paved * 1.6
        : t.tier === 3 ? ROAD_WIDTH.paved * 1.2
          : t.tier === 1 ? ROAD_WIDTH.paved * 0.8
            : ROAD_WIDTH.paved;

export function paintRoadTiles(
  ctx: Ctx2D, tiles: RoadTile[], style: RoadStyle, townGround: GroundPoint[][] = [],
  /**
   * R2 (#266): the chunk's bridge decks, painted first so every road surface
   * sits on timber rather than on water, with the railings last — see
   * `bridge-renderer.ts`. Empty for a chunk with no crossing, in which case
   * this pass is byte-identical to the one that shipped before bridges.
   */
  decks: readonly BridgeDeck[] = [],
  /**
   * E2 (#267): the elevation draper — the identity unless the map carries
   * heights, in which case every point this pass traces is lifted onto the
   * terrain before it is projected (see `elevation.ts` for why that is a shift
   * of the ground plane and not of the transform). A road on a hill therefore
   * tilts with the hill instead of floating over it or sinking into it.
   */
  elev: Draper = FLAT_DRAPER,
): void {
  // Patterns are created against THIS context; a material with no texture
  // falls through to its flat colour, which is a complete look, not a hole.
  const fills: RoadFills = {
    paved: makePattern(ctx, style.paved) ?? style.paved.flat,
    dirt: makePattern(ctx, style.dirt) ?? style.dirt.flat,
  };
  const townFill = style.town ? (makePattern(ctx, style.town) ?? style.town.flat) : null;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 0. R2 (#266) Bridge decks, under everything: the water texture has to go.
  paintBridgeDecks(ctx, decks, DEFAULT_BRIDGE_STYLE, elev);

  // 0b. #159 Town ground: the paved yards the houses stand on, under everything
  //    a road paints. Absent a `town` material the passes below still draw the
  //    streets; only the blocks between them stay grass.
  if (townFill) paintTownGround(ctx, townGround, townFill, elev);

  // 1. Shoulders — ground disturbed at the road's edge, NOT an outline. Drawn
  //    semi-transparent so it darkens whatever it happens to lie on (grass, a
  //    dry patch, sand) rather than ringing the road in one flat colour,
  //    which is how the opaque version of this read: a thick cartoon border
  //    around every road, which is the one thing the art direction rules out.
  ctx.globalAlpha = SHOULDER_ALPHA;
  for (const t of tiles) {
    ctx.strokeStyle = style[t.material].shoulder;
    ctx.lineWidth = widthOf(t) + SHOULDER_WIDTH * 2;
    for (const f of t.figures) { trace(ctx, f, elev); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;

  // 1b. #159 Town-street sidewalks and their joints, BETWEEN the shoulders and
  //     any asphalt.
  //
  //     The position is the whole trick. A ribbon runs from its port to the
  //     tile centre, so at a junction it would cross the carriageway it meets;
  //     painted here, it is simply covered by that carriageway's core below,
  //     and every approach is trimmed at the kerb line with no clipping, no
  //     per-tile special case and no gap. Where two ribbons cross each other
  //     they overprint — which is the corner apron of an intersection, and is
  //     the shape a corner-kerb is supposed to have anyway.
  paintSidewalks(ctx, tiles, elev);

  // 2. The opaque material core.
  for (const t of tiles) {
    ctx.strokeStyle = fills[t.material];
    ctx.lineWidth = widthOf(t);
    for (const f of t.figures) { trace(ctx, f, elev); ctx.stroke(); }
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
    const w = widthOf(t);
    for (const [frac, colour, alpha] of EDGE_SHADE) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = colour;
      ctx.lineWidth = w * frac;
      for (const f of t.figures) {
        // A pad (a lone road tile) is a zero-length segment: with butt caps
        // it strokes nothing at all, so it keeps its plain core rather than
        // gaining a cross-road arc it has no sides to justify.
        if (f.points.length < 2) continue;
        trace(ctx, f, elev); ctx.stroke();
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
      // E2 (#267): the blend follows the draped arm, and its gradient runs
      // between the DRAPED ends — a gradient anchored on the flat points would
      // ramp across a hillside at the wrong angle.
      const blend = elev.path([tr.from, tr.to]);
      ctx.beginPath();
      ctx.moveTo(blend[0][0], blend[0][1]);
      for (let i = 1; i < blend.length; i++) ctx.lineTo(blend[i][0], blend[i][1]);
      ctx.strokeStyle = fills.paved;
      ctx.stroke();
      const from = blend[0], to = blend[blend.length - 1];
      const g = ctx.createLinearGradient(from[0], from[1], to[0], to[1]);
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
    if (t.tier === 1) continue;                 // ROADS-2: a Street has no centre line
    for (const f of paintFigures(t.tx, t.ty, t.mask)) {
      // ROADS-2 (#393): a Highway's centre is a solid divider, twice as heavy.
      if (t.tier === 2) {
        ctx.setLineDash([]);
        ctx.lineWidth = PAINT_WIDTH * 2.2;
        trace(ctx, f, elev);
        ctx.stroke();
        ctx.lineWidth = PAINT_WIDTH;
        continue;
      }
      ctx.setLineDash([DASH_ON, DASH_OFF]);
      // The dash phase stays anchored on the FLAT figure: the lattice it is
      // pinned to is a property of the world's tile grid, and a slope changes a
      // run's projected length by a fraction of a dash at most.
      ctx.lineDashOffset = dashOffsetFor(f);
      trace(ctx, f, elev);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  // 4b. ROADS-3 (#394) Overpass decks: a shadow on the highway, the deck,
  //     then railings — over the highway's markings.
  for (const t of tiles) {
    if (!t.deck) continue;
    ctx.save();
    ctx.lineCap = "butt";
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = ROAD_WIDTH.paved * 1.35;
    for (const f of t.figures) { trace(ctx, f, elev); ctx.stroke(); }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#8f9498";
    ctx.lineWidth = ROAD_WIDTH.paved * 1.15;
    for (const f of t.figures) { trace(ctx, f, elev); ctx.stroke(); }
    ctx.strokeStyle = fills.paved;
    ctx.lineWidth = ROAD_WIDTH.paved;
    for (const f of t.figures) { trace(ctx, f, elev); ctx.stroke(); }
    ctx.restore();
  }

  // 5. #159 Street lamps, on top of everything else on the ground: see
  //    `paintStreetLamps` for why they cannot go down with their sidewalks.
  //    Markings stay under a lamp, exactly as paint on asphalt does.
  paintStreetLamps(ctx, tiles, elev);

  // 6. R2 (#266) The decks' kerbs and railings, last of all: a bridge's fence
  //    stands OVER its surface, and over the lamps of any street that happens
  //    to end at the bank.
  paintBridgeRailings(ctx, decks, DEFAULT_BRIDGE_STYLE, elev);
  ctx.restore();
}

/** `#rrggbb` with an alpha, for the transition gradient's transparent end. */
function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ── the cache ───────────────────────────────────────────────────────────────
interface CacheEntry {
  /**
   * The raster, or NULL for a chunk with nothing to draw at all — an empty
   * stretch of ocean in textured mode, or a chunk with no railway in the
   * sprite road mode. An empty chunk is remembered rather than re-tried, and it
   * is skipped by the blit rather than blended into the canvas as a fully
   * transparent rectangle.
   */
  surface: Surface | null;
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
  /**
   * RAIL-03: the rail's detail tier. It is baked INTO a raster, so it belongs
   * to the cache key: `setRailDetail` bumps the style version when the quality
   * preset changes, and every chunk re-rasterises at the new detail without any
   * caller having to remember that it must.
   */
  private railDetail: RailDetail = railDetailFor(2);
  /**
   * RAIL-03: the sprite road mode draws the ROADS itself, from the atlas cells
   * (`buildDrawList` with `roads: true`), while the railway has no cells at all
   * and must be painted either way. In that mode a raster carries the railway
   * ONLY, so the two never double-draw a road — and the flag is part of the
   * raster's content, which is why turning it on or off re-keys every chunk.
   */
  private railOnly = false;
  private railStyle: RailStyle = DEFAULT_RAIL_STYLE;

  constructor(private budgetBytes = 48 * 1024 * 1024) {}

  /** Set the rail detail tier; a change re-keys every cached raster. */
  setRailDetail(detail: RailDetail): void {
    if (detail.key === this.railDetail.key) return;
    this.railDetail = detail;
    this.bumpStyle("rail-detail");
  }

  /** The rail detail tier currently baked into the rasters. */
  get railDetailTier(): RailDetail["key"] { return this.railDetail.key; }

  /**
   * Paint the railway only, for the sprite road mode. A change re-keys every
   * cached raster, exactly like a detail-tier change: the content differs.
   */
  setRailOnly(on: boolean): void {
    if (on === this.railOnly) return;
    this.railOnly = on;
    this.bumpStyle(on ? "rail-only" : "roads");
  }

  /** Is the cache painting the railway without the roads? */
  get railOnlyMode(): boolean { return this.railOnly; }

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
   * so a single tile edit dirties a neighbourhood, not a tile. A rail tile's
   * shape stays inside its own tile, so the rail diff asks for `reach = 1`.
   */
  invalidateTile(tx: number, ty: number, reason = "tile", reach = 2): void {
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
    // E2 (#267): the draper is a pure function of the map's height lattice, so
    // it is baked into the raster exactly like the rail's detail tier — no
    // per-frame work, and the flat path keeps the identity draper and the tile
    // range it has always evaluated.
    const elev = draperFor(world.grid);
    const lift = elevationLiftPx(world.grid);
    const range = tilesForRect(
      px, py, px + ROAD_CHUNK_W + GUTTER * 2, py + ROAD_CHUNK_H + GUTTER * 2, lift,
    );
    // In the sprite road mode the atlas cells draw the roads, so this raster
    // carries the railway and nothing else.
    const tiles = this.railOnly ? [] : roadTilesIn(world, range.tx0, range.ty0, range.tx1, range.ty1);
    // R2 (#266): decks are NOT atlas art, so they are collected in both road
    // modes — in the sprite mode the cells above would otherwise leave a road
    // bridge floating on the sea with no deck under it.
    const roadDecks = roadBridgeDecksIn(world, range.tx0, range.ty0, range.tx1, range.ty1);
    // Town ground comes from the same tile range, so a block at a chunk's edge
    // is paved by the chunk that owns it and the gutter simply agrees.
    const townGround = this.railOnly
      ? [] : townGroundQuadsIn(world, range.tx0, range.ty0, range.tx1, range.ty1);
    // RAIL-03: the railway rides the same range, the gutter included — the
    // geometry is per tile, so a chunk paints its own tiles plus the neighbours
    // inside its gutter and the seam between chunks is invisible.
    const rail = railTilesIn(world, range.tx0, range.ty0, range.tx1, range.ty1);
    // R2 (#266): the railway's own decks, painted by the rail pass.
    const railDecks = railBridgeDecksIn(world, range.tx0, range.ty0, range.tx1, range.ty1);

    // A chunk with nothing to draw is never rasterised: an empty path painted
    // into a fresh surface would cost the same memory for a rectangle that
    // shows nothing, and the blit skips it on every frame after this one.
    let surface: Surface | null = null;
    if (tiles.length || townGround.length || rail.length || roadDecks.length || railDecks.length) {
      surface = makeSurface(w, h);
      if (!surface) return null;
      const ctx = (surface as HTMLCanvasElement).getContext("2d") as Ctx2D | null;
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      // Ground coordinates → this surface's device pixels. The gutter origin
      // is folded in here; the camera is NOT — that belongs to the blit.
      ctx.setTransform(HW * zoom, HH * zoom, -HW * zoom, HH * zoom, -px * zoom, -py * zoom);
      paintRoadTiles(ctx, tiles, style, townGround, roadDecks, elev);
      // …and the track OVER the finished road: that is what a level crossing
      // is, and why the road pass above has to stay exactly as it was.
      paintRailTiles(ctx, rail, this.railDetail, this.railStyle, railDecks, elev);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // Soften the vectors by a pixel so roads and rails sit with the pixel
      // artwork instead of looking razor-cut. ONE filtered copy of the finished
      // chunk: a filter set while painting would blur every one of the hundreds
      // of fills/strokes separately and freeze the game whenever panning
      // rasterises new chunks. Only at the closest zoom: further out the
      // roads are already small enough to read as pixel art, and blurring
      // them just makes them muddy.
      const soft = zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1] ? makeSurface(w, h) : null;
      const sctx = soft ? (soft as HTMLCanvasElement).getContext("2d") as Ctx2D | null : null;
      if (soft && sctx && "filter" in sctx) {
        sctx.filter = ROAD_SOFTEN_FILTER;
        sctx.drawImage(surface as unknown as CanvasImageSource, 0, 0);
        sctx.filter = "none";
        surface = soft;
      }
    }

    const bytes = surface ? w * h * 4 : 0;
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
        if (!e?.surface) continue;
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
