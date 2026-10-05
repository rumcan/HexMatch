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
  /** BRIDGE-1 (#685): the arms the carried surface really has (centre to edge, straight or 45 degrees). Absent = the axis pair. */
  arms?: GroundPoint[][];
  /** BRIDGE-1: per arm, does it land on a bank (draw an abutment)? */
  landEnds?: boolean[];
  /** BRIDGE-1: half the deck's width; absent = BRIDGE_DECK_HALF (the old width). */
  half?: number;
  /** BRIDGE-1: the material it is built in; absent = timber. */
  kind?: DeckKind;
  /** BRIDGE-1: false for a deck that does not stand in water (a rail overpass over a road). */
  pier?: boolean;
  /** BRIDGE-1: how far (zoom-1 px) the deck stands above the water under it - the pier's height. */
  heightPx?: number;
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

// ── BRIDGE-1 (#685): decks that read as bridges ─────────────────────────────
//
// A deck used to be the tile's square narrowed across ONE axis. That broke on
// the crossings players see most: a public highway crosses a river as a
// staircase of tiles through their centres (drawn with round joins, so it reads
// as a diagonal), and a highway is ~1.25 tiles wide, so the asphalt spilled off
// a 0.92-wide square onto the water and no bridge showed at all.
//
// A deck is now traced along the ARMS its surface actually has (centre to the
// tile edge it links through, straight or 45 degrees), at a half-width taken
// from the road class it carries. It is drawn as a structure standing in the
// water: a soft shadow on the water, a pier under every deck tile, stone
// abutments where it meets a bank, a dark fascia lip under the deck edge (the
// "raised" read), the surface, then - over the road - railings and posts offset
// along each arm. Everything is ground-plane vector work in the cached chunk
// raster, exactly as before: no sprite, no per-frame cost.

/** The material a deck is built in: timber (lanes, roads), concrete (highways), steel (railway). */
export type DeckKind = "timber" | "concrete" | "steel";

/**
 * Screen pixels to a ground-plane offset (the raster's transform is in ground
 * units). The road raster is blitted through the view turn, so its caller
 * passes the turn-aware version (`screenOffsetAt(dx, dy, vq)`); this default is
 * the unturned one.
 */
export type ScreenOffset = (dx: number, dy: number) => GroundPoint;
const HW_PX = 32, HH_PX = 16;
const UNTURNED: ScreenOffset = (dx, dy) => [dx / (2 * HW_PX) + dy / (2 * HH_PX), dy / (2 * HH_PX) - dx / (2 * HW_PX)];

/** Per-material colours; flat 1950s palette, no gradients. */
export const DECK_MATERIAL: Record<DeckKind, { deck: string; fascia: string; railing: string; railingEdge: string; post: string }> = {
  timber: { deck: "#8b7355", fascia: "#4a3d31", railing: "#3f382e", railingEdge: "#2b2620", post: "#3f382e" },
  concrete: { deck: "#a7a29a", fascia: "#5f5b55", railing: "#cfc9bd", railingEdge: "#6d6860", post: "#8e897f" },
  steel: { deck: "#5d5f60", fascia: "#2f3133", railing: "#3b4a57", railingEdge: "#1f272e", post: "#3b4a57" },
};
const SHADOW = "rgba(10,24,32,0.24)";
const PIER = "#6b6459";
const PIER_DARK = "#4d4840";
const STONE = "#8f8676";

/** The arms of an axis deck: centre to the two tile edges it spans. */
function axisArms(d: BridgeDeck): GroundPoint[][] {
  const c: GroundPoint = [d.tx + 0.5, d.ty + 0.5];
  return d.axis === "x"
    ? [[c, [d.tx, d.ty + 0.5]], [c, [d.tx + 1, d.ty + 0.5]]]
    : [[c, [d.tx + 0.5, d.ty]], [c, [d.tx + 0.5, d.ty + 1]]];
}
/** The arms a deck is drawn along (its own, or the axis pair). */
export function deckArms(d: BridgeDeck): GroundPoint[][] {
  return d.arms && d.arms.length ? d.arms : axisArms(d);
}
const deckHalf = (d: BridgeDeck): number => d.half ?? BRIDGE_DECK_HALF;
const kindOf = (d: BridgeDeck): DeckKind => d.kind ?? "timber";

const shift = (pts: readonly GroundPoint[], o: GroundPoint): GroundPoint[] =>
  pts.map(([u, v]) => [u + o[0], v + o[1]] as GroundPoint);

/** A straight arm offset sideways by `o` ground units (positive = left of travel). */
export function offsetArm(arm: readonly GroundPoint[], o: number): GroundPoint[] {
  const a = arm[0], b = arm[arm.length - 1];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * o, ny = (dx / len) * o;
  return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny]];
}

/** Stroke a set of polylines at one width and colour, in one batch. */
function strokeAll(ctx: Ctx2D, lines: readonly (readonly GroundPoint[])[], width: number, color: string, elev: Draper): void {
  if (!lines.length) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const l of lines) traceInto(ctx, l, elev);
  ctx.stroke();
}

/**
 * Paint the decks, under everything the road/rail pass will draw: the shadow on
 * the water, piers, bank abutments, the fascia lip, the surface and (timber)
 * its planks.
 */
export function paintBridgeDecks(
  ctx: Ctx2D, decks: readonly BridgeDeck[], style: BridgeStyle = DEFAULT_BRIDGE_STYLE,
  elev: Draper = FLAT_DRAPER,
  screen: ScreenOffset = UNTURNED,
): void {
  if (!decks.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const down3 = screen(0, 3), down12 = screen(0, 12);
  const shadowOff = screen(4, 8);
  const left1 = screen(-1, 0);

  // 1. The shadow on the water (sun from the upper left), cast down past the
  //    deck's own height so a raised bridge throws it onto the water below.
  for (const d of decks) {
    const off = d.heightPx ? screen(4 + d.heightPx * 0.25, 8 + d.heightPx) : shadowOff;
    strokeAll(ctx, deckArms(d).map((a) => shift(a, off)), deckHalf(d) * 2, SHADOW, elev);
  }

  // 2. A pier under every deck tile that stands in water: a dark column from
  //    the deck down into the water, a lighter face on its sunny side.
  for (const d of decks) {
    if (d.pier === false) continue;
    const c: GroundPoint = [d.tx + 0.5, d.ty + 0.5];
    const w = Math.min(0.2, deckHalf(d) * 0.4);
    const reach = d.heightPx ? screen(0, d.heightPx + 10) : down12;
    const col: GroundPoint[] = [c, [c[0] + reach[0], c[1] + reach[1]]];
    strokeAll(ctx, [col], w, PIER_DARK, elev);
    strokeAll(ctx, [shift(col, left1)], w * 0.45, PIER, elev);
  }

  // 3. Stone abutments where an arm lands on a bank.
  for (const d of decks) {
    const ends = d.landEnds ?? [];
    const blocks = deckArms(d).filter((_, i) => ends[i]).map((a) => {
      const p = a[0], q = a[a.length - 1];
      return [[p[0] + (q[0] - p[0]) * 0.7, p[1] + (q[1] - p[1]) * 0.7], q] as GroundPoint[];
    });
    strokeAll(ctx, blocks.map((b) => shift(b, down3)), deckHalf(d) * 2 + 0.1, PIER_DARK, elev);
    strokeAll(ctx, blocks, deckHalf(d) * 2 + 0.1, STONE, elev);
  }

  // 4. The fascia lip, then 5. the surface.
  for (const d of decks) {
    strokeAll(ctx, deckArms(d).map((a) => shift(a, down3)), deckHalf(d) * 2, DECK_MATERIAL[kindOf(d)].fascia, elev);
  }
  for (const d of decks) {
    const color = kindOf(d) === "timber" ? style.deck : DECK_MATERIAL[kindOf(d)].deck;
    strokeAll(ctx, deckArms(d), deckHalf(d) * 2, color, elev);
  }

  // 6. Timber decks show their planks; concrete and steel are plain slabs.
  const planks: GroundPoint[][] = [];
  for (const d of decks) {
    if (kindOf(d) !== "timber") continue;
    const h = deckHalf(d) - KERB_INSET;
    for (const arm of deckArms(d)) {
      const a = arm[0], b = arm[arm.length - 1];
      for (let t = PLANK_SPACING * 2; t < 1; t += PLANK_SPACING * 2) {
        const p: GroundPoint = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const seg: GroundPoint[] = [p, [p[0] + (b[0] - a[0]), p[1] + (b[1] - a[1])]];
        planks.push([offsetArm(seg, h)[0], offsetArm(seg, -h)[0]]);
      }
    }
  }
  ctx.lineCap = "butt";
  strokeAll(ctx, planks, 0.05, style.plank, elev);
  ctx.restore();
}

/**
 * ...and the railings, painted after the road/rail pass so they stand over the
 * surface's edge: an edge line, the rail, then short posts, offset along each
 * arm on both sides.
 */
export function paintBridgeRailings(
  ctx: Ctx2D, decks: readonly BridgeDeck[], style: BridgeStyle = DEFAULT_BRIDGE_STYLE,
  elev: Draper = FLAT_DRAPER,
  screen: ScreenOffset = UNTURNED,
): void {
  if (!decks.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const kind of ["timber", "concrete", "steel"] as const) {
    const group = decks.filter((d) => kindOf(d) === kind);
    if (!group.length) continue;
    const m = kind === "timber"
      ? { railing: style.railing, railingEdge: style.railingEdge, post: style.railing }
      : DECK_MATERIAL[kind];
    const rails: GroundPoint[][] = [];
    const posts: GroundPoint[][] = [];
    const up3 = screen(0, -3);
    for (const d of group) {
      const r = deckHalf(d) - RAILING_INSET;
      for (const arm of deckArms(d)) {
        for (const side of [-1, 1]) {
          const line = offsetArm(arm, side * r);
          rails.push(line);
          const [a, b] = line;
          for (let t = POST_SPACING; t <= 1; t += POST_SPACING * 2) {
            const p: GroundPoint = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            posts.push([p, [p[0] + up3[0], p[1] + up3[1]]]);
          }
        }
      }
    }
    const w = kind === "concrete" ? RAILING_WIDTH * 1.6 : RAILING_WIDTH;
    strokeAll(ctx, rails, w + 0.03, m.railingEdge, elev);
    strokeAll(ctx, rails, w, m.railing, elev);
    ctx.lineCap = "butt";
    strokeAll(ctx, posts, RAILING_WIDTH * 0.8, m.post, elev);
    ctx.lineCap = "round";
  }
  ctx.restore();
}
