// ══════════════════════════════════════════════════════════════════════════
// R2 (#266) — painting the bridge DECKS and their railings, as vectors.
//
// The ticket grants the renderer exception by name: bridge decks are drawn in
// the road-renderer / rail-renderer style rather than from art, so a river
// crossing needs no sprite, no atlas cell and no `bridge_0101.png` anywhere.
// This module is the one place a deck's shape is decided, exactly as
// `road-geometry.ts` and `rail-geometry.ts` own theirs.
//
// WHAT A DECK IS, in geometry. A deck tile carries track bits like any other
// tile, and a bridge's bits are the straight pair along the axis it crosses, so
// the deck is the tile's own 1×1 square, narrowed across the axis to
// `BRIDGE_DECK_HALF × 2`. Adjacent deck tiles therefore abut exactly on the
// tile boundary (both rectangles are the same width and meet on the shared
// edge), so a two-tile crossing draws as one continuous deck with no seam —
// the same port-contract discipline the rails and roads keep.
//
// The deck is painted UNDER the road/rail pass (the surfaces sit on it, with
// the road's shoulder and the rail's ballast landing on timber rather than on
// water) and the railings go on last, over everything, so a lorry on a bridge
// reads as being between its two kerbs — the chunk raster is a ground layer, so
// rails, railings, cars and trains all sort correctly by construction.
//
// NO OWNERSHIP TINT. Like the road surfaces and the neutral steel, a deck
// belongs to nobody visually: who built the crossing is told by the road's
// material and by the Railway panel, not by paint.
// ══════════════════════════════════════════════════════════════════════════
import type { GroundPoint } from "./road-geometry";
import { FLAT_DRAPER, type Draper } from "./elevation";

type Ctx2D = CanvasRenderingContext2D;

/** Which way a deck runs: along the ground u axis (SE↔NW), or v (NE↔SW). */
export type BridgeDeckAxis = "x" | "y";

/** One tile of a bridge, as the renderer sees it. */
export interface BridgeDeck {
  tx: number;
  ty: number;
  axis: BridgeDeckAxis;
}

/**
 * Half the deck's width, in tile units. Wider than the widest thing that rides
 * it (a road's shoulder ends at 0.42, the rail's bed at 0.2775), so the deck
 * reads as structure left and right of the surface, and narrow enough that
 * `0.46 × 2` still leaves a verge of water either side of the tile's diamond —
 * a deck that filled the whole tile would read as reclaimed land.
 */
export const BRIDGE_DECK_HALF = 0.46;
/** How far the kerb line sits inside the deck edge. */
const KERB_INSET = 0.02;
/** The railing's line, and how thick it is drawn. */
const RAILING_INSET = 0.055;
const RAILING_WIDTH = 0.05;
/** A post every QUARTER tile, across the railing line. */
const POST_SPACING = 0.25;
const POST_LENGTH = 0.12;
/** Light cross-beams (the deck's planks) every eighth of a tile. */
const PLANK_SPACING = 0.125;

/**
 * The deck palette. Weathered timber and dark kerbs, in the railway's own
 * material family (`rail-renderer.ts`'s `bed`/`plank`/`tie`), so a rail bridge
 * and a road bridge read as the same craft built by the same map.
 */
export interface BridgeStyle {
  /** The deck's surface. */
  deck: string;
  /** The cross-beams visible through it. */
  plank: string;
  /** The kerb/girder line at the deck's edge. */
  kerb: string;
  /** The railing, and the dark line under it. */
  railing: string;
  railingEdge: string;
}

export const DEFAULT_BRIDGE_STYLE: BridgeStyle = {
  deck: "#8b7355",
  plank: "#79624a",
  kerb: "#4a3d31",
  railing: "#3f382e",
  railingEdge: "#2b2620",
};

/**
 * The axis a deck tile runs along, read off its direction bits — the pairs the
 * rules already force a bridge to have. A single bit (a deck whose far bank was
 * demolished) still names its axis; a deck with NO bits left (both banks gone),
 * or an impossible bend, falls back to where the water is: the deck follows the
 * channel, which is what the tile was built along in the first place.
 */
export function deckAxis(
  mask: number,
  water: (x: number, y: number) => boolean,
  tx: number,
  ty: number,
): BridgeDeckAxis {
  const bits = mask & 0b1111;
  const NE = 1, SE = 2, SW = 4, NW = 8;
  if (bits === (SE | NW)) return "x";
  if (bits === (NE | SW)) return "y";
  if (bits === SE || bits === NW) return "x";
  if (bits === NE || bits === SW) return "y";
  if (bits !== 0) {
    // A bend or a junction on a deck cannot be built, but the renderer must
    // still draw something sane: prefer the axis the tile actually spans.
    if ((bits & (SE | NW)) !== 0 && (bits & (NE | SW)) === 0) return "x";
    if ((bits & (NE | SW)) !== 0 && (bits & (SE | NW)) === 0) return "y";
  }
  if (water(tx - 1, ty) || water(tx + 1, ty)) return "x";
  return "y";
}

/** The deck's rectangle, as a closed quad in the ground plane. */
export function deckQuad(d: BridgeDeck, half = BRIDGE_DECK_HALF): GroundPoint[] {
  const { tx, ty, axis } = d;
  if (axis === "x") {
    const lo = ty + 0.5 - half, hi = ty + 0.5 + half;
    return [[tx, lo], [tx + 1, lo], [tx + 1, hi], [tx, hi]];
  }
  const lo = tx + 0.5 - half, hi = tx + 0.5 + half;
  return [[lo, ty], [lo, ty + 1], [hi, ty + 1], [hi, ty]];
}

/** Every line a deck is drawn from, in paint order: planks, kerbs, railings, posts. */
export function deckLines(d: BridgeDeck): {
  planks: GroundPoint[][];
  kerbs: GroundPoint[][];
  railings: GroundPoint[][];
  posts: GroundPoint[][];
} {
  const { tx, ty, axis } = d;
  const planks: GroundPoint[][] = [];
  const kerbs: GroundPoint[][] = [];
  const railings: GroundPoint[][] = [];
  const posts: GroundPoint[][] = [];
  const half = BRIDGE_DECK_HALF;
  const kerb = half - KERB_INSET;
  const rail = half - RAILING_INSET;
  // A point `t` along the deck (0 = its start edge, 1 = its end edge) crossed
  // `o` to the side: `o` is measured on the axis the deck's WIDTH runs along.
  const point = (t: number, o: number): GroundPoint =>
    axis === "x" ? [tx + t, ty + 0.5 + o] : [tx + 0.5 + o, ty + t];
  for (let t = PLANK_SPACING; t < 1; t += PLANK_SPACING) {
    planks.push([point(t, -kerb), point(t, kerb)]);
  }
  for (const side of [-1, 1]) {
    kerbs.push([point(0, side * kerb), point(1, side * kerb)]);
    railings.push([point(0, side * rail), point(1, side * rail)]);
    for (let t = POST_SPACING / 2; t < 1; t += POST_SPACING) {
      posts.push([point(t, side * (rail - POST_LENGTH / 2)), point(t, side * (rail + POST_LENGTH / 2))]);
    }
  }
  return { planks, kerbs, railings, posts };
}

/**
 * Trace a polyline into the CURRENT path (the caller owns `beginPath`).
 *
 * E2 (#267): through the draper like every other ground-plane painter. A deck
 * stands on WATER, and water is level 0 on a map with elevation, so in practice
 * this is the identity for a bridge — but a deck's ends meet the banks, and it
 * is the draper that puts them on the same surface the road on either side is
 * drawn on.
 */
function traceInto(ctx: Ctx2D, points: readonly GroundPoint[], elev: Draper = FLAT_DRAPER): void {
  if (!points.length) return;
  const pts = elev.path(points);
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
}

/** Trace a closed quad into the CURRENT path. */
function traceQuad(ctx: Ctx2D, quad: readonly GroundPoint[], elev: Draper = FLAT_DRAPER): void {
  traceInto(ctx, quad, elev);
  ctx.closePath();
}

/**
 * Paint the decks: the timber surface under everything the road/rail pass will
 * draw, then the kerbs and cross-beams. Batched — one fill for every deck on
 * the chunk, one stroke per pass — exactly like the road and rail painters.
 */
export function paintBridgeDecks(
  ctx: Ctx2D, decks: readonly BridgeDeck[], style: BridgeStyle = DEFAULT_BRIDGE_STYLE,
  elev: Draper = FLAT_DRAPER,
): void {
  if (!decks.length) return;
  ctx.save();
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";

  // 1. The surface, opaque: it has to cover the water texture underneath.
  ctx.fillStyle = style.deck;
  ctx.beginPath();
  for (const d of decks) traceQuad(ctx, deckQuad(d), elev);
  ctx.fill();

  // 2. Cross-beams, under the surface's traffic — the deck's visible structure.
  ctx.strokeStyle = style.plank;
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  for (const d of decks) for (const line of deckLines(d).planks) traceInto(ctx, line, elev);
  ctx.stroke();

  ctx.restore();
}

/**
 * …and the railings, painted after the road/rail pass so they stand over the
 * surface's edge rather than under it. The kerb line goes down first: a dark
 * edge is what makes the deck read as raised above the water line.
 */
export function paintBridgeRailings(
  ctx: Ctx2D, decks: readonly BridgeDeck[], style: BridgeStyle = DEFAULT_BRIDGE_STYLE,
  elev: Draper = FLAT_DRAPER,
): void {
  if (!decks.length) return;
  ctx.save();
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";

  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = style.kerb;
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  for (const d of decks) for (const line of deckLines(d).kerbs) traceInto(ctx, line, elev);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.strokeStyle = style.railingEdge;
  ctx.lineWidth = RAILING_WIDTH + 0.03;
  ctx.beginPath();
  for (const d of decks) for (const line of deckLines(d).railings) traceInto(ctx, line, elev);
  ctx.stroke();

  ctx.strokeStyle = style.railing;
  ctx.lineWidth = RAILING_WIDTH;
  ctx.beginPath();
  for (const d of decks) for (const line of deckLines(d).railings) traceInto(ctx, line, elev);
  ctx.stroke();

  // The posts, last: short ticks across the railings, so the fence lights up
  // as a fence and not as two painted stripes.
  ctx.lineWidth = RAILING_WIDTH * 0.8;
  ctx.beginPath();
  for (const d of decks) for (const post of deckLines(d).posts) traceInto(ctx, post, elev);
  ctx.stroke();

  ctx.restore();
}
