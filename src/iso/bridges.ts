// ══════════════════════════════════════════════════════════════════════════
// R2 (#266) — BRIDGES: a drag across a NARROW river builds a deck.
//
// A bridge is not a new kind of track. It is the SAME road/rail bytes standing
// on a tile the map calls water, so connectivity, ownership, the economy's
// floods, lorry/train routing and demolition all work untouched — the only
// thing that changes is that the build rules now ALLOW a player-laid tile on
// the river, and the renderer draws a deck under it (`bridge-renderer.ts`).
//
// That derivation is what makes bridges need no wire, no save and no protocol
// change: track on water IS a bridge, because nothing else in the game can put
// track there (land builds refuse water, `publicRoadTiles` routes around it,
// platforms and depots refuse it) — see `bridgeDeckAt`.
//
// THE RULE, in one place, because four callers ask it: the player's road drag
// (`previewDrag` in track.ts), the player's rail drag (`railPreview` /
// `buildRail` in rail.ts), and the rival's two planners (`stepCost` for roads
// and `railStepCost`/`planRailRoute` for rail, both in ai.ts):
//
//   • RIVER WATER ONLY. A bridge spans tiles the river generator carved
//     (`grid.rivers`, #260). Sea and lakes never bridge at any width — a
//     one-tile channel between two bays is still the ocean — and with the
//     `rivers` option off no tile is river water, so option-OFF maps cannot
//     grow a bridge at all.
//   • ≤ MAX_BRIDGE_SPAN (2) water tiles. Wider water refuses, exactly as the
//     ticket asks: the crossing has to be a narrow one.
//   • STRAIGHT. Every step from the last land tile before the water to the
//     first land tile after it runs in ONE orthogonal direction. A bend in
//     the water, or a diagonal step onto/off the deck (rail's octilinear
//     drags), refuses — a diagonal link may not start or end on a bridge,
//     which is the #266 clause the rail tile model needs (RAIL_DE/RAIL_DS).
//   • BOTH ENDS ON LAND, INSIDE THE SAME DRAG. A drag that stops in the water
//     builds nothing: the deck must land on both banks.
//   • NO JUNCTIONS. Neither flank of a deck may carry track of the layer, nor
//     may the tile already carry the OTHER layer's track (a deck is never
//     shared), so a bridge can never become a junction and a rail bridge can
//     never double as a road bridge. The one exception is a deck tile that
//     has lost every connection (bits 0 — its banks were demolished): there
//     is no axis left to protect, and refusing would make the deck
//     unreachable, so it reads as "no side join" and the crossing may be
//     re-laid over it.
//
// This module is a LEAF: it imports `grid.ts` and `config.ts` and nothing else
// that imports it back. The four direction bits are re-declared the way
// `road-geometry.ts` re-declares them (a value import of track.ts would close
// the track → bridges → track cycle, whose top-level reads land in the
// temporal dead zone) and `tests/unit/iso-bridges.test.ts` pins them against
// track.ts tile for tile.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W, MAP_H } from "../game/config";
import { BUILD_COSTS, type Cargo } from "./config";
import { WATER, type Grid } from "./grid";

// ── the bits (re-declared; pinned by the unit test) ───────────────────────
const NE = 1, SE = 2, SW = 4, NW = 8;
const DIRS: readonly number[] = [NE, SE, SW, NW];
const DIR: Record<number, readonly [number, number]> = {
  [NE]: [0, -1], [SE]: [1, 0], [SW]: [0, 1], [NW]: [-1, 0],
};
const OPPOSITE: Record<number, number> = {
  [NE]: SW, [SE]: NW, [SW]: NE, [NW]: SE,
};
const BITS = 0b1111;

/** How many water tiles one bridge may span. The ticket's "narrow river". */
export const MAX_BRIDGE_SPAN = 2;
/** ROADS-3 (#394): a Highway bridge may span this many water tiles. */
export const HIGHWAY_BRIDGE_SPAN = 4;

/**
 * The direction bits as THIS module declares them — the same four numbers
 * `track.ts` uses, re-declared because a value import of `track.ts` from here
 * would close the track → bridges → track cycle (see the header). Exported so
 * `tests/unit/iso-bridges.test.ts` can pin them against `track.ts`'s own
 * `NE/SE/SW/NW` and the ways they are walked (`OPPOSITE_BIT`, `DIR_OF_BIT`).
 */
export const BRIDGE_BITS: readonly [number, number, number, number] = [NE, SE, SW, NW];

export type Purse = Partial<Record<Cargo, number>>;

/**
 * The tile price of a river crossing, PER WATER TILE — the ticket's "more
 * expensive per water tile". Two entries because the two layers carry
 * different cargo: `bridge` is the road deck (dirt and paved alike — the deck
 * is the deck, whatever surface rides it) and `railBridge` the railway's. Both
 * live in `BUILD_COSTS` with every other price, so the balance gate tunes one
 * table. Neither is ever covered by the free setup allowance: the allowance
 * buys road, and a deck is a structure.
 */
export const BRIDGE_COST: Purse = { ...BUILD_COSTS.bridge };
export const RAIL_BRIDGE_COST: Purse = { ...BUILD_COSTS.railBridge };

/** `cost × n`, for a drag that crosses `decks` water tiles. */
export function bridgeCostFor(cost: Purse, decks: number): Purse {
  const out: Purse = {};
  if (decks <= 0) return out;
  for (const [c, n] of Object.entries(cost) as [Cargo, number][]) out[c] = n * decks;
  return out;
}

export const inMapB = (x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

/**
 * Is (x,y) a tile a bridge may span — RIVER water, in bounds? The mask is
 * `Grid.rivers` (#260), so this is false on every ocean and lake tile and on
 * every map generated without the option.
 */
export function bridgeWaterAt(grid: Grid, x: number, y: number): boolean {
  if (!inMapB(x, y)) return false;
  const i = y * MAP_W + x;
  return grid.rivers !== undefined && (grid.rivers[i] ?? 0) !== 0 && grid.terrain[i] === WATER;
}

/** Axis tags: a deck runs along x (SE↔NW) or along y (NE↔SW). */
export const AXIS_X = 1, AXIS_Y = 2;
export type BridgeAxis = typeof AXIS_X | typeof AXIS_Y;

/** The axis a step runs along, or 0 for a step that is not orthogonal. */
export function axisOfStep(dx: number, dy: number): BridgeAxis | 0 {
  if (Math.abs(dx) + Math.abs(dy) !== 1) return 0;
  return dx !== 0 ? AXIS_X : AXIS_Y;
}

/**
 * The axes along which (x,y) is PART OF a straight run of ≤ MAX_BRIDGE_SPAN
 * river tiles with dry land at both ends — the local, path-free necessary
 * condition for standing on a bridge. Bit 1 = x (SE↔NW), bit 2 = y (NE↔SW),
 * 0 = not bridgeable.
 *
 * The rival's road ranker (`stepCost` in ai.ts) needs exactly this: its A* is
 * per tile, so it cannot see the drag's shape, and a tile that cannot be part
 * of a legal crossing at all must stay impassable. The SHAPE is checked later,
 * on the whole planned path (`planBridges`), by the same function the player's
 * preview uses.
 */
export function bridgeAxesAt(grid: Grid, x: number, y: number): number {
  if (!bridgeWaterAt(grid, x, y)) return 0;
  const land = (nx: number, ny: number): boolean =>
    inMapB(nx, ny) && grid.terrain[ny * MAP_W + nx] !== WATER;
  let axes = 0;
  for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
    // The tile itself is water, so a 1-run needs land on both sides; a 2-run
    // needs the partner water tile and land on its far side. A longer run
    // fails both readings and stays unbridgeable.
    const px = x - dx, py = y - dy, qx = x + dx, qy = y + dy;
    if (!inMapB(px, py) || !inMapB(qx, qy)) continue;
    if (land(px, py) && land(qx, qy)) { axes |= dx !== 0 ? AXIS_X : AXIS_Y; continue; }
    if (bridgeWaterAt(grid, px, py) && inMapB(px - dx, py - dy) && land(px - dx, py - dy)
      && land(qx, qy)) { axes |= dx !== 0 ? AXIS_X : AXIS_Y; continue; }
    if (bridgeWaterAt(grid, qx, qy) && inMapB(qx + dx, qy + dy) && land(qx + dx, qy + dy)
      && land(px, py)) { axes |= dx !== 0 ? AXIS_X : AXIS_Y; }
  }
  return axes;
}

/**
 * A straight water run of a planned drag: `path[start..end]` are the deck's
 * tiles, and the step that enters it runs `(dx, dy)` — the same step that
 * crosses it and leaves it, since a bridge is straight.
 */
export interface BridgeRun {
  start: number;
  end: number;
  dx: number;
  dy: number;
  axis: BridgeAxis;
}

/** Why a water run of a drag cannot be bridged. */
export type BridgeRefusal =
  /** More than `MAX_BRIDGE_SPAN` water tiles across. */
  | "span"
  /** The crossing does not begin and end on dry land inside this drag. */
  | "ends"
  /** Not straight: a bend in the water, or a diagonal step onto/off the deck. */
  | "bend"
  /** Track stands on a flank — the deck would gain a junction. */
  | "junction"
  /** The tile already carries the other layer's track: a deck is not shared. */
  | "shared";

/**
 * Does (x,y) already carry a bridge deck of the layer being built? Read off
 * the game's own `Grid.builtAt`, which reports `"bridge"` for exactly
 * "track on water" (track.ts / rail.ts each feed their own layer in).
 *
 * `carries` is the caller's layer test — the road tiers in one case, the
 * railway's own tiles and structure lanes in the other.
 */
export function bridgeDeckAt(grid: Grid, x: number, y: number, carries: (x: number, y: number) => boolean): boolean {
  if (!inMapB(x, y)) return false;
  return grid.terrain[y * MAP_W + x] === WATER && carries(x, y);
}

/**
 * The axis a mask runs along — AXIS_X / AXIS_Y when every set bit lies on one
 * axis, else 0. A deck's bits are always on one axis (the rules build it
 * straight), and a single remaining bit still names that axis, which is what
 * lets a half-demolished crossing be repaired.
 */
function axisOfBits(bits: number): number {
  const x = bits & (SE | NW), y = bits & (NE | SW);
  if (x && y) return 0;
  if (x) return AXIS_X;
  if (y) return AXIS_Y;
  return 0;
}

/**
 * Would laying a SAME-LAYER tile at (tx,ty) hang a connection on the SIDE of a
 * standing bridge deck? `deckAt` says whether a neighbour is a deck of this
 * layer, `bitsAt` gives that neighbour's direction mask.
 *
 * The test is the deck's AXIS, not its bits: a tile reached along the axis is
 * the deck's continuation (its far bank, or the bank being re-laid after a
 * demolition), while a tile reached across the axis would add a third arm to a
 * straight deck — the junction the ticket refuses. Reading the axis rather
 * than the bits is what makes a half-demolished crossing repairable: the deck
 * that lost its far bank has only one bit left, and the tile that vanished is
 * still on its line.
 *
 * A deck with NO bits at all (both banks gone) protects no axis and lets
 * everything through, so a stranded deck can always be re-connected.
 */
export function sideJoinAt(
  tx: number, ty: number,
  deckAt: (x: number, y: number) => boolean,
  bitsAt: (x: number, y: number) => number,
): boolean {
  if (deckAt(tx, ty)) return false;                  // the deck itself: judged by the crossing rule
  for (const d of DIRS) {
    const nx = tx + DIR[d][0], ny = ty + DIR[d][1];
    if (!deckAt(nx, ny)) continue;
    const bits = bitsAt(nx, ny) & BITS;
    if (bits === 0) continue;                        // a stranded deck: repair-friendly
    const deckAxis = axisOfBits(bits);
    if (deckAxis === 0) continue;                    // a bend/junction on a deck: no axis to protect
    // The step from the deck to us runs along the same axis as `d`.
    if (axisOfStep(DIR[d][0], DIR[d][1]) !== deckAxis) return true;
  }
  return false;
}

interface RunProbe {
  run: BridgeRun | null;
  why: BridgeRefusal | null;
  /** First index of the water run (the tile a stopped drag paints red). */
  start: number;
}

/**
 * Judge the water run of `path` that contains `index`. `layerAt` answers "does
 * THIS layer carry track here" (owner-scoped for rail, either tier for road —
 * baked-in "the drag is about to build it" tiles included) and `otherAt` "does
 * the other layer" (a deck is never shared).
 */
function probeRun(
  grid: Grid, path: readonly (readonly [number, number])[], index: number,
  layerAt: (x: number, y: number) => boolean,
  otherAt: (x: number, y: number) => boolean,
  maxSpan: number = MAX_BRIDGE_SPAN,
): RunProbe {
  const [x, y] = path[index];
  if (!bridgeWaterAt(grid, x, y)) return { run: null, why: null, start: index };
  let start = index;
  while (start > 0 && bridgeWaterAt(grid, path[start - 1][0], path[start - 1][1])) start--;
  let end = index;
  while (end < path.length - 1 && bridgeWaterAt(grid, path[end + 1][0], path[end + 1][1])) end++;
  if (end - start + 1 > maxSpan) return { run: null, why: "span", start };
  // Both banks must be inside this drag, and dry.
  if (start === 0 || end === path.length - 1) return { run: null, why: "ends", start };
  const before = path[start - 1], after = path[end + 1];
  if (grid.terrain[before[1] * MAP_W + before[0]] === WATER
    || grid.terrain[after[1] * MAP_W + after[0]] === WATER) return { run: null, why: "ends", start };
  // Straight: one orthogonal step in, through and out.
  const dx = path[start][0] - before[0], dy = path[start][1] - before[1];
  const axis = axisOfStep(dx, dy);
  if (!axis) return { run: null, why: "bend", start };
  if (after[0] - path[end][0] !== dx || after[1] - path[end][1] !== dy) {
    return { run: null, why: "bend", start };
  }
  for (let j = start; j < end; j++) {
    if (path[j + 1][0] - path[j][0] !== dx || path[j + 1][1] - path[j][1] !== dy) {
      return { run: null, why: "bend", start };
    }
  }
  // Flanks clear, and the deck itself not already somebody else's.
  const pdx = -dy, pdy = dx;
  for (let j = start; j <= end; j++) {
    const [bx, by] = path[j];
    if (otherAt(bx, by)) return { run: null, why: "shared", start };
    // R3 (#270): a dam STANDS on its river tile — a deck laid over it would
    // be a second structure at the same site. `builtAt` is the map's own
    // report, and "something already crosses the water there" is exactly
    // what a standing dam is.
    if (grid.builtAt?.(bx, by) === "dam") return { run: null, why: "shared", start };
    for (const s of [1, -1]) {
      const nx = bx + pdx * s, ny = by + pdy * s;
      if (!inMapB(nx, ny)) continue;
      if (layerAt(nx, ny) || otherAt(nx, ny)) return { run: null, why: "junction", start };
    }
  }
  return { run: { start, end, dx, dy, axis }, why: null, start };
}

export interface BridgePlan {
  /** Path index → the legal crossing that covers it (its deck tiles). */
  runs: Map<number, BridgeRun>;
  /**
   * The same decks as TILE indices (`tIdx` values). The per-tile rules ask
   * "may this tile stand on water?" — `railTileRefusal` and the rival's
   * feasibility/price loops — and a Tile must never be confused with a path
   * index: the two are equal only by coincidence.
   */
  deckTiles: Set<number>;
  /** The first water tile the drag may not cross, and why. Null = all clear. */
  refusal: { index: number; why: BridgeRefusal } | null;
}

/**
 * The bridge part of a whole drag: which of its tiles are deck tiles of a
 * legal crossing, and — when the drag runs into water it may not bridge — the
 * first such tile with the reason. One pass, no state, so the preview, the
 * commit and the rival's validator all read the same answer.
 */
export function planBridges(
  grid: Grid, path: readonly (readonly [number, number])[],
  layerAt: (x: number, y: number) => boolean,
  otherAt: (x: number, y: number) => boolean,
  maxSpan: number = MAX_BRIDGE_SPAN,
): BridgePlan {
  const runs = new Map<number, BridgeRun>();
  const deckTiles = new Set<number>();
  let refusal: { index: number; why: BridgeRefusal } | null = null;
  for (let i = 0; i < path.length; i++) {
    if (runs.has(i) || !bridgeWaterAt(grid, path[i][0], path[i][1])) continue;
    const probe = probeRun(grid, path, i, layerAt, otherAt, maxSpan);
    if (probe.run) {
      for (let j = probe.run.start; j <= probe.run.end; j++) {
        runs.set(j, probe.run);
        deckTiles.add(path[j][1] * MAP_W + path[j][0]);
      }
    } else if (!refusal) {
      refusal = { index: probe.start, why: probe.why ?? "ends" };
    }
  }
  return { runs, deckTiles, refusal };
}

/** The refusal wording the drag overlays and the toasts share. */
export const BRIDGE_REFUSAL_TEXT: Record<BridgeRefusal, string> = {
  span: "The river is too wide to bridge here — find a narrower crossing.",
  ends: "A bridge has to start and finish on land.",
  bend: "A bridge is straight — no bends and no diagonals on the deck.",
  junction: "A bridge stays straight — nothing can join its side.",
  shared: "Something already crosses the water there.",
};

export const OPPOSITE_BIT = OPPOSITE;
export const DIR_OF_BIT = DIR;
