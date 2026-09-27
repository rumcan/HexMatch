// ══════════════════════════════════════════════════════════════════════════
// E4 (#268) — slope rules and uphill costs: the ONE module that answers "may a
// line go there?", "may a building stand there?" and "what does the climb
// cost?" for an elevation map.
//
// It builds on E1's height bytes (`Grid.height`, 0–4 per tile — `heightAt`, the
// map's own levels) and adds NO second height model: the rules read the same
// bytes the renderer draws and the vehicles ride.
//
// ONE MEASURE: the LEVEL (an integer). A level is the map's own unit — the
// generator guarantees neighbours differ by at most one, it is what a Depot lot
// or a plant footprint is flattened to, and it is what the player sees as a
// step in the ground. Rules, costs and speeds all read `climbLevels`, so the
// drag, the rival's A*, the clock and the lorry can never disagree about what
// counts as a climb. (The RENDERER draws a one-level step as a ramp across the
// two tiles that straddle it — `elevation.ts`'s corner lattice — which is what
// makes the level readable on screen; it is not a second measure.)
//
// EVERY rule here is inert when the `elevation` map option is off:
// `elevationActive` is false, `heightAt` reads zero bytes and the surface is
// 0.0 everywhere, so every refusal returns null, every climb is 0 and every
// speed factor is 1 — the flat game, untouched.
//
// Two exemptions, both of them structures standing ON water rather than normal
// ground, and both of them the reason bridges and dams still work on a map
// whose river banks sit a level above the water (which is nearly all of them:
// measured 51 of 52 river-bank tiles on seed 1337 are level 1):
//
//   • a BRIDGE deck — track on water — is a structure that levels its own
//     crossing; its approach is the bridge's business, not a track grade. So a
//     step onto or off a water tile is never a slope refusal, and a deck's
//     tiles do not count as run for the rail ramp rule.
//   • a DAM's river tile is the same: the footprint rule reads only the LAND
//     half of a footprint.
//   • a DAM's river tile is the same: the footprint rule reads only the LAND
//     half of a footprint.
// ══════════════════════════════════════════════════════════════════════════
import { SLOPES } from "./config";
import { elevationActive } from "./elevation";
import { WATER, heightAt, type Grid } from "./grid";

/** A tile pair, in the order a line walks it. */
export type TilePair = readonly [number, number];

/** Every slope refusal, in one vocabulary (rail adds these to `RailRefusal`). */
export type SlopeRefusal = "too-steep" | "slope-diagonal" | "not-flat";

/**
 * The one wording, so a toast, an overlay and a test can never disagree.
 * #429: every sentence names the RULE and the FIX, not just the verdict.
 */
export const SLOPE_REFUSAL_TEXT: Record<SlopeRefusal, string> = {
  "too-steep": "Too steep — rail needs 2 flat tiles between climbs; end on level ground and climb again.",
  "slope-diagonal": "Diagonals must be level — turn on flat ground, not across a slope.",
  "not-flat": "It needs flat ground — the whole footprint on one level.",
};

/** Is (tx,ty) on the map? Local, so this module needs nothing from track.ts. */
const inMap = (grid: Grid, tx: number, ty: number): boolean =>
  tx >= 0 && ty >= 0 && tx < grid.w && ty < grid.h;

/**
 * The ground LEVEL of a tile — the map's own 0–4 byte, and 0 for every tile of
 * an option-off (or synthetic) map. The integer measure: rules, footprints.
 */
export const levelAt = (grid: Grid, tx: number, ty: number): number => heightAt(grid, tx, ty);

/** Is a tile water — i.e. a bridge deck or a dam's river tile (a structure)? */
export const isWaterTile = (grid: Grid, tx: number, ty: number): boolean =>
  !inMap(grid, tx, ty) || grid.terrain[ty * grid.w + tx] === WATER;

/**
 * Levels between two tiles, positive when `to` is uphill of `from`. 0 when the
 * option is off, and 0 between two tiles of the same level. The ONE place the
 * step a rule measures comes from.
 */
export function climbLevels(grid: Grid, from: TilePair, to: TilePair): number {
  if (!elevationActive(grid)) return 0;
  return levelAt(grid, to[0], to[1]) - levelAt(grid, from[0], from[1]);
}

// ── roads ─────────────────────────────────────────────────────────────────
/**
 * May a road step from `from` to `to`? null when it may, `"too-steep"` when the
 * pair climbs more than `SLOPES.roadMaxStep` levels.
 *
 * A pair with WATER at either end is never refused: the only way track stands
 * on water is a bridge deck, and a deck's approach is the bridge's own ramp
 * (see the header).
 */
export function roadStepRefusal(grid: Grid, from: TilePair | undefined | null, to: TilePair): SlopeRefusal | null {
  if (!from || !elevationActive(grid)) return null;
  if (isWaterTile(grid, from[0], from[1]) || isWaterTile(grid, to[0], to[1])) return null;
  return Math.abs(climbLevels(grid, from, to)) > SLOPES.roadMaxStep ? "too-steep" : null;
}

/** The boolean form, for a caller that only gates. */
export const roadStepOk = (grid: Grid, from: TilePair | undefined | null, to: TilePair): boolean =>
  roadStepRefusal(grid, from, to) === null;

/**
 * The FLANK half of the road rule: a tile laid beside standing track is joined
 * to it by the autotiler (a road's bits face every neighbour carrying track of
 * either tier), so a step the drag never walks can still exist. `carries(x,y)`
 * is the caller's "track stands there" test; every joined neighbour has to be
 * within `roadMaxStep` levels. Decks are exempt, as everywhere.
 */
export function roadJoinSlopeRefusal(
  grid: Grid, tx: number, ty: number,
  carries: (x: number, y: number) => boolean,
): SlopeRefusal | null {
  if (!elevationActive(grid) || isWaterTile(grid, tx, ty)) return null;
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const nx = tx + dx, ny = ty + dy;
    if (!inMap(grid, nx, ny) || !carries(nx, ny)) continue;
    if (roadStepRefusal(grid, [tx, ty], [nx, ny])) return "too-steep";
  }
  return null;
}

// ── rail ──────────────────────────────────────────────────────────────────
/** What a rail drag's own shape refuses, per tile index the drag steps into. */
export type RailSlopeRefusal = Extract<SlopeRefusal, "too-steep" | "slope-diagonal">;

/**
 * The diamond's two diagonal steps — the same unit-both-axes test as rail.ts's
 * `isDiagStep`, restated here because rail.ts imports THIS module (a value
 * import back would close a runtime cycle; the same reason `crossingMasksOk`
 * is restated in rail-geometry.ts).
 */
const stepIsDiagonal = (ax: number, ay: number, bx: number, by: number): boolean =>
  Math.abs(ax - bx) === 1 && Math.abs(ay - by) === 1;

/**
 * #429 — the RAMP CORNER exception to rail's 45° turn rule. A switchback turns
 * 180° on a hillside, and on a stair-stepped slope every diagonal straddles a
 * level change (which rail may not link), so the ONLY turn available is a 90°
 * corner between two axis steps. Those are allowed exactly where a ramp touches
 * the corner tile: when the step into it or the step out of it changes level by
 * one (the tile is the ramp's TOP or BOTTOM). Every other corner — on level
 * ground, or involving a diagonal, or a reversal — stays refused.
 */
export function railRampCornerOk(
  grid: Grid | null | undefined, prev: TilePair, cur: TilePair, next: TilePair,
): boolean {
  if (!grid || !elevationActive(grid)) return false;
  const ax = cur[0] - prev[0], ay = cur[1] - prev[1];
  const bx = next[0] - cur[0], by = next[1] - cur[1];
  // Both steps must be axis steps (a diagonal turn keeps the old rule)…
  if (Math.abs(ax) + Math.abs(ay) !== 1 || Math.abs(bx) + Math.abs(by) !== 1) return false;
  // …perpendicular to one another (the 90° corner; straight on and reversals
  // are the normal rule's business)…
  if (ax * bx + ay * by !== 0) return false;
  // …and one of the two steps must BE the ramp.
  return Math.abs(climbLevels(grid, prev, cur)) === 1 || Math.abs(climbLevels(grid, cur, next)) === 1;
}

/**
 * #429 — how much FLAT RUN the line a drag joins carries INTO its ends from the
 * player's standing rail. `before` is the flat-step count behind the drag's
 * first tile, `after` the count ahead of its last one; 0 means the standing
 * line changes level at the join itself, and `SLOPES.railRampRun - 1` (or
 * more) means the run is long enough to matter not at all. `rail.ts` measures
 * both by walking the standing line (`railJoinRunAt`); without them the rules
 * judge one drag at a time, and a climb could be split into drags to dodge the
 * ramp-run rule.
 */
export interface RailSlopeRun { before?: number; after?: number }

/** The drag-shape answer, split so the UI can separate "stop here" from "paint
 * these red" (#429: colour only the offending tiles, never the whole drag). */
export interface RailSlopeVerdict {
  /** Every tile of a bad step — the tiles to paint red. Both ends of a step
   * are flagged, so the answer does not depend on which way the drag was drawn. */
  flags: Map<number, RailSlopeRefusal>;
  /** The INDEX of each tile the drag may not ENTER — the step's "to" end. The
   * preview and the commit stop here; the tile before a bad step is legal on
   * its own, so it is still laid. */
  blocks: Map<number, RailSlopeRefusal>;
}

/**
 * The SLOPE rules a rail DRAG's shape has to satisfy, answered for the whole
 * gesture at once — the way `planBridges` answers the bridge question, and for
 * the same reason: both rules are properties of a run of tiles, not of one
 * tile, so a per-tile refusal could not state them.
 *
 *   • no diagonal rail link on a slope. A diagonal is stored as a 45° link
 *     (RAIL_DE/RAIL_DS), and a link that also climbs is a corner a train
 *     cannot hold: the two tiles it joins must be at the SAME level.
 *   • a climb is a RAMP: a one-level step needs `railRampRun` tiles of run, so
 *     two level changes may not sit closer than `railRampRun` steps apart.
 *     A step of more than `railMaxStep` levels is refused outright.
 *   • #429: that run is counted ACROSS the joins — `run` carries the flat run
 *     of the player's standing rail into both ends of the drag, so two drags
 *     compose as one line: a first climb tight against the drag's own first
 *     change (head) and the drag's last change tight against a climb the
 *     standing line continues into (tail) are both refused.
 *
 * `deckTiles` is a set of TILE indices (as `BridgePlan.deckTiles` returns)
 * covering the tiles this gesture lays as bridge decks: a deck and its
 * approaches are structure, not graded track (see the header), so steps onto,
 * off and along a deck neither climb nor count as run.
 */
export function railDragSlopeVerdict(
  grid: Grid,
  tiles: readonly TilePair[],
  deckTiles?: ReadonlySet<number>,
  run?: RailSlopeRun,
): RailSlopeVerdict {
  const flags = new Map<number, RailSlopeRefusal>();
  const blocks = new Map<number, RailSlopeRefusal>();
  const verdict = { flags, blocks };
  if (tiles.length < 2 || !elevationActive(grid)) return verdict;
  const n = tiles.length;
  const R = SLOPES.railRampRun;
  const deck = (i: number): boolean =>
    !!deckTiles?.has(tiles[i][1] * grid.w + tiles[i][0]) || isWaterTile(grid, tiles[i][0], tiles[i][1]);
  // What each step does: its level change (0 = flat, ±1 = one level, more is
  // refused outright), whether it is a diagonal, and whether it is exempt
  // because a deck is involved.
  const changes: number[] = [];          // step indices with a ±1 change
  for (let i = 1; i < n; i++) {
    if (deck(i - 1) || deck(i)) continue;
    const d = Math.abs(climbLevels(grid, tiles[i - 1], tiles[i]));
    if (d === 0) continue;
    // The tile the drag steps INTO is the one it may not lay; the step's
    // other end is legal on its own and is only painted to show the pair.
    const mark = (k: number, why: RailSlopeRefusal) => {
      if (!flags.has(k - 1)) flags.set(k - 1, why);
      if (!flags.has(k)) flags.set(k, why);
      if (!blocks.has(k)) blocks.set(k, why);
    };
    if (d > SLOPES.railMaxStep) { mark(i, "too-steep"); continue; }
    if (stepIsDiagonal(tiles[i - 1][0], tiles[i - 1][1], tiles[i][0], tiles[i][1])) {
      mark(i, "slope-diagonal");
      continue;
    }
    changes.push(i);
  }
  // Two level changes closer than `railRampRun` steps are a step, not a ramp.
  for (let c = 1; c < changes.length; c++) {
    const a = changes[c - 1], b = changes[c];
    if (b - a >= R) continue;
    for (const k of [a, b]) {
      if (!flags.has(k - 1)) flags.set(k - 1, "too-steep");
      if (!flags.has(k)) flags.set(k, "too-steep");
    }
    if (!blocks.has(b)) blocks.set(b, "too-steep");
  }
  // #429: the same rule counted ACROSS the joins, so two drags compose as one
  // line. A standing line that changed level `before` flat steps behind the
  // drag's start sits at composite index `-before`, so the drag's FIRST change
  // (step k) is refused when k + before < R; a line that keeps climbing
  // `after` flat steps ahead of the drag's end sits at index `n + after`, so
  // the drag's LAST change is refused against the END TILE — the fix is to
  // give the climb one tile more of level run, in either direction.
  const before = run?.before ?? R;
  const after = run?.after ?? R;
  if (changes.length) {
    const first = changes[0], last = changes[changes.length - 1];
    if (first + before < R) {
      if (!flags.has(first - 1)) flags.set(first - 1, "too-steep");
      if (!flags.has(first)) flags.set(first, "too-steep");
      if (!blocks.has(first)) blocks.set(first, "too-steep");
    }
    if (n + after - last < R) {
      for (const k of [last - 1, last, n - 1]) if (k >= 0 && !flags.has(k)) flags.set(k, "too-steep");
      if (!blocks.has(n - 1)) blocks.set(n - 1, "too-steep");
    }
  }
  return verdict;
}

/** The drag's red tiles: every tile of a bad step, both ends included. */
export function railDragSlopeRefusals(
  grid: Grid,
  tiles: readonly TilePair[],
  deckTiles?: ReadonlySet<number>,
  run?: RailSlopeRun,
): Map<number, RailSlopeRefusal> {
  return railDragSlopeVerdict(grid, tiles, deckTiles, run).flags;
}

/**
 * The LOCAL half of the rail slope rule: the step between one tile and the
 * neighbours it would join. `joins(x, y)` says whether the tile being laid
 * connects to (x,y) — a planned tile of the same drag, or standing rail of the
 * same owner (rail.ts's own connection model) — so a tile laid BESIDE a line
 * two levels away is refused even when the drag itself is short.
 *
 * Decks and their approaches are exempt, exactly as in `railDragSlopeRefusals`.
 */
export function railJoinSlopeRefusal(
  grid: Grid, tx: number, ty: number,
  joins: (x: number, y: number) => boolean,
): RailSlopeRefusal | null {
  if (!elevationActive(grid) || isWaterTile(grid, tx, ty)) return null;
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const nx = tx + dx, ny = ty + dy;
    if (!inMap(grid, nx, ny) || !joins(nx, ny)) continue;
    if (isWaterTile(grid, nx, ny)) continue;
    if (Math.abs(climbLevels(grid, [tx, ty], [nx, ny])) > SLOPES.railMaxStep) return "too-steep";
  }
  return null;
}

// ── footprints ────────────────────────────────────────────────────────────
/**
 * The tiles of a footprint that break the flat-footprint rule, in footprint
 * order — or null when the whole footprint sits on one level.
 *
 * A Depot lot, a processing plant, the Factory, a railway platform's 1×3 and a
 * dam all need LEVEL ground: their art is drawn on one diamond and their rules
 * (catchment, lanes, footing) assume one plane, so a footprint straddling a
 * level change is refused rather than half-drawn up a cliff.
 *
 * Water tiles are ignored, which is what keeps bridges and dams legal on a map
 * whose banks stand a level above the river (see the header): a dam's footprint
 * is its river tile PLUS a bank tile, and only the land half is graded. A
 * footprint with no land tile at all is level by definition.
 *
 * The reference level is the first land tile's, so the tiles returned are the
 * ones to paint red: the others agree with the ground the building is anchored
 * on.
 */
export function footprintFlatTiles(
  grid: Grid, tiles: readonly TilePair[],
): [number, number][] | null {
  if (!elevationActive(grid)) return null;
  let level: number | null = null;
  const off: [number, number][] = [];
  for (const [x, y] of tiles) {
    if (!inMap(grid, x, y) || isWaterTile(grid, x, y)) continue;
    const v = levelAt(grid, x, y);
    if (level === null) { level = v; continue; }
    if (v !== level) off.push([x, y]);
  }
  return off.length ? off : null;
}

/** The boolean form: may a footprint of these tiles stand here? */
export const footprintFlat = (grid: Grid, tiles: readonly TilePair[]): boolean =>
  footprintFlatTiles(grid, tiles) === null;

// ── the economy: climb distance ───────────────────────────────────────────
/**
 * How much EXTRA distance a route's climbs are worth, in tile-equivalents: the
 * absolute levels of every step (`|climbLevels|`, up or down — a loaded lorry
 * pays for the hill either way), times `SLOPES.climbTiles`.
 *
 * This is what the L3 distance factor (#217) adds to a Depot's route length, so
 * a route over a hill bands lower than the same length of flat road and the
 * clock pays it slower. 0 (exactly) on a flat map.
 */
export function climbTiles(grid: Grid, route: readonly TilePair[]): number {
  if (!elevationActive(grid) || route.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < route.length; i++) sum += Math.abs(climbLevels(grid, route[i - 1], route[i]));
  return sum * SLOPES.climbTiles;
}

/** D1 keeps the historic one-tile origin allowance. With diagonals enabled,
 * each subsequent step contributes its geometric length (including a two-tile
 * overpass jump). #420: axis overpass jumps always count their full span;
 * flag-OFF diagonal/rail steps retain their previous distance contract. */
export function routeTileLength(route: readonly TilePair[], diagonalRoads = false): number {
  if (route.length === 0) return 0;
  let length = 1;
  for (let i = 1; i < route.length; i++) {
    const dx = route[i][0] - route[i - 1][0], dy = route[i][1] - route[i - 1][1];
    length += diagonalRoads ? Math.hypot(dx, dy) : dx === 0 || dy === 0 ? Math.abs(dx) + Math.abs(dy) : 1;
  }
  return length;
}

/**
 * The route as the L3 clock measures it: its tile count plus `climbTiles`. The
 * one number `depotPathLength` returns, so the inspector, the banded factor and
 * the lorry all keep reading one measure (and an option-off map is exactly the
 * tile count it always was).
 */
export const routeDistance = (grid: Grid, route: readonly TilePair[], diagonalRoads = false): number =>
  routeTileLength(route, diagonalRoads) + climbTiles(grid, route);

// ── vehicles ──────────────────────────────────────────────────────────────
/**
 * The speed factor for riding a step that climbs `levels`: 1 on the flat and
 * downhill, `1 / (1 + uphillSlow × levels)` uphill — halved for one level at
 * the shipped settings. Presentation only: the clock is paid by `climbTiles`.
 * A negative (downhill) step is 1: nothing is gained, the lorry just is not
 * slowed.
 */
export const uphillSpeed = (levels: number): number =>
  levels > 0 ? 1 / (1 + SLOPES.uphillSlow * levels) : 1;

/**
 * `uphillSpeed` for a step, in the direction the vehicle is going — the level
 * the step climbs, signed. The ONE number a train's tick and a lorry's segment
 * table both read.
 */
export const uphillFactor = (grid: Grid, from: TilePair, to: TilePair): number =>
  uphillSpeed(climbLevels(grid, from, to));

/** The signed climb of a step — what a vehicle stores per segment. */
export const gradeOf = (grid: Grid, from: TilePair, to: TilePair): number =>
  climbLevels(grid, from, to);
