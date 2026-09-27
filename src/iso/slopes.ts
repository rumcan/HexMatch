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

/** The one wording, so a toast, an overlay and a test can never disagree.
 * #429: the name of the rule AND the fix, in the player's words. */
export const SLOPE_REFUSAL_TEXT: Record<SlopeRefusal, string> = {
  // #429: name the rule AND the fix. Roads have no ramp run (they climb every
  // step they may), so their "too-steep" is the step itself.
  "too-steep": "Too steep — climbs one level at a time.",
  "slope-diagonal": "Diagonals must be level — turn on flat ground.",
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

/**
 * #429 — the ONE exception to the 45° turn rule: a perpendicular pair of
 * ORTHOGONAL steps that turns on the top or bottom tile of a ramp. That is
 * the corner a switchback makes on a hillside: climb the ramp and turn hard
 * on the tile the ramp ends on (or turn hard onto the tile a ramp starts
 * from). A single tile carries the 90°, so a train takes it as one move.
 *
 * Never qualifies: a leg that is a diagonal (the 45° link is a grade of its
 * own, and it stays level), a turn on level ground (there is no ramp to turn
 * on), and any tile of a bridge deck (a structure, not a grade — a bridge
 * stays straight). Inert on a flat map.
 */
export function rampCornerOk(grid: Grid, f: TilePair, m: TilePair, t: TilePair): boolean {
  if (!elevationActive(grid)) return false;
  const fx = m[0] - f[0], fy = m[1] - f[1];
  const tx = t[0] - m[0], ty = t[1] - m[1];
  if (Math.abs(fx) + Math.abs(fy) !== 1 || Math.abs(tx) + Math.abs(ty) !== 1) return false;
  if ((fx === 0) === (tx === 0)) return false;   // both on one axis: straight or a U, not a 90° corner
  if (isWaterTile(grid, f[0], f[1]) || isWaterTile(grid, m[0], m[1]) || isWaterTile(grid, t[0], t[1])) return false;
  // The corner sits on the ramp: one of its two legs crosses a level change.
  return Math.abs(climbLevels(grid, f, m)) >= 1 || Math.abs(climbLevels(grid, m, t)) >= 1;
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
 * #429 — the standing-rail context a drag's ramp rule counts run ACROSS.
 * `at(x, y)` is the caller's "same-owner standing rail stands there, and it
 * is NOT one of this drag's own tiles" (rail.ts's `sameOwnerRail`, minus the
 * drag's planned set — a drag redrawing its own line is one line, not two).
 * `diag(x, y, x2, y2)` says a standing DIAGONAL link joins the two. A
 * diagonal join never changes level (that is the diagonal rule), so it only
 * matters for the run behind the join.
 */
export interface RailStanding {
  at: (x: number, y: number) => boolean;
  diag?: (x: number, y: number, x2: number, y2: number) => boolean;
}

/**
 * #429 — the nearest level change on the standing rail that the drag end
 * `end` joins, as its position in the COMPOSED line (the end tile is 1, the
 * join tile is 0, and the standing rail runs on to negative positions):
 *
 *   1      the join step itself climbs (standing rail → the end tile), the
 *          change entering the end tile;
 *   -1     the change entering the join tile itself (its step from the
 *          standing rail one behind it);
 *   -(m+1) the change entering the standing tile m steps behind the join.
 *
 * Null when no change sits close enough to constrain anything: only a change
 * at position ≥ 3 - `railRampRun` could violate the run rule (the drag's own
 * first change enters at 2 at the earliest), so the walk behind the join is
 * bounded to `railRampRun - 2` steps and stops at a deck (water is exempt
 * from grading, exactly like the drag rule's `deckTiles`).
 */
export function nearestStandingChange(
  grid: Grid, end: TilePair, standing: RailStanding,
): number | null {
  const [ex, ey] = end;
  const joins: TilePair[] = [];
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const nx = ex + dx, ny = ey + dy;
    if (!inMap(grid, nx, ny) || isWaterTile(grid, nx, ny) || !standing.at(nx, ny)) continue;
    joins.push([nx, ny]);
  }
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const nx = ex + dx, ny = ey + dy;
    if (!inMap(grid, nx, ny) || isWaterTile(grid, nx, ny) || !standing.diag?.(ex, ey, nx, ny)) continue;
    joins.push([nx, ny]);
  }
  let best: number | null = null;
  for (const [jx, jy] of joins) {
    // The join step climbs → the change enters the end tile (position 1).
    if (levelAt(grid, jx, jy) !== levelAt(grid, ex, ey)) return 1;
    // Walk the standing rail behind the join. `depth` m = the tile is m steps
    // behind the join (position -m); a change into it needs level P_{m+1}
    // ≠ level P_m for some standing neighbour P_{m+1}.
    const limit = SLOPES.railRampRun - 2;    // only positions ≥ 3 - run can bind
    if (limit < 0) continue;
    const frontier: TilePair[] = [[jx, jy]];
    const seen = new Set<number>([jy * grid.w + jx]);
    for (let m = 0; m <= limit && frontier.length; m++) {
      const next: TilePair[] = [];
      for (const [cx, cy] of frontier) {
        const level = levelAt(grid, cx, cy);
        let changed = false;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          const nx = cx + dx, ny = cy + dy;
          if (!inMap(grid, nx, ny) || isWaterTile(grid, nx, ny)) continue;
          if (!standing.at(nx, ny)) continue;
          const i = ny * grid.w + nx;
          if (seen.has(i)) continue;
          if (levelAt(grid, nx, ny) !== level) changed = true;
          seen.add(i);
          next.push([nx, ny]);
        }
        // The step P_{m+1}→P_m enters P_m, at position -(m+1).
        if (changed && (best === null || -(m + 1) > best)) best = -(m + 1);
      }
      frontier.length = 0;
      for (const p of next) frontier.push(p);
    }
  }
  return best;
}

/**
 * The diamond's two diagonal steps — the same unit-both-axes test as rail.ts's
 * `isDiagStep`, restated here because rail.ts imports THIS module (a value
 * import back would close a runtime cycle; the same reason `crossingMasksOk`
 * is restated in rail-geometry.ts).
 */
const stepIsDiagonal = (ax: number, ay: number, bx: number, by: number): boolean =>
  Math.abs(ax - bx) === 1 && Math.abs(ay - by) === 1;

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
 *
 * `deckTiles` is a set of TILE indices (as `BridgePlan.deckTiles` returns)
 * covering the tiles this gesture lays as bridge decks: a deck and its
 * approaches are structure, not graded track (see the header), so steps onto,
 * off and along a deck neither climb nor count as run.
 *
 * #429: when `standing` is given, the run rule is counted ACROSS the join
 * with the player's standing rail, so two drags compose like one: the level
 * change the standing rail made just behind a drag end is part of the same
 * line, and the drag's own first (or last) change must leave `railRampRun`
 * of run from it. `nearestStandingChange` answers where that change sits,
 * relative to the end tile (the start end is position 1, the goal end is
 * position n, and the standing rail runs on behind each): the START end's
 * standing change is at position p, the GOAL end's at `n + max(1, 1 − p)`
 * (a join-step climb and the first standing change both sit one step past
 * the goal tile). The offending pair is a step, not a ramp, exactly when
 * the distance between the two changes is < `railRampRun`.
 *
 * Returns a map from the INDEX of the tile the drag steps into to the refusal
 * that stops it there — both ends of a bad step are flagged, so the answer does
 * not depend on which way the player drew the drag. Empty when nothing is
 * wrong, and empty (at no cost) when the map is flat.
 */
export function railDragSlopeRefusals(
  grid: Grid,
  tiles: readonly TilePair[],
  deckTiles?: ReadonlySet<number>,
  standing?: RailStanding,
): Map<number, RailSlopeRefusal> {
  const out = new Map<number, RailSlopeRefusal>();
  if (tiles.length < 2 || !elevationActive(grid)) return out;
  const n = tiles.length;
  const deck = (i: number): boolean =>
    !!deckTiles?.has(tiles[i][1] * grid.w + tiles[i][0]) || isWaterTile(grid, tiles[i][0], tiles[i][1]);
  // What each step does: its level change (0 = flat, ±1 = one level, more is
  // refused outright), whether it is a diagonal, and whether it is exempt
  // because a deck is involved.
  const changes: number[] = [];          // step indices with a ±1 change
  const exempt = new Array<boolean>(n).fill(false);
  for (let i = 1; i < n; i++) {
    if (deck(i - 1) || deck(i)) { exempt[i] = true; continue; }
    const d = Math.abs(climbLevels(grid, tiles[i - 1], tiles[i]));
    if (d === 0) continue;
    const flag = (k: number, why: RailSlopeRefusal) => {
      if (!out.has(k - 1)) out.set(k - 1, why);
      if (!out.has(k)) out.set(k, why);
    };
    if (d > SLOPES.railMaxStep) { flag(i, "too-steep"); continue; }
    if (stepIsDiagonal(tiles[i - 1][0], tiles[i - 1][1], tiles[i][0], tiles[i][1])) {
      flag(i, "slope-diagonal");
      continue;
    }
    changes.push(i);
  }
  // Two level changes closer than `railRampRun` steps are a step, not a ramp.
  for (let c = 1; c < changes.length; c++) {
    const a = changes[c - 1], b = changes[c];
    if (b - a >= SLOPES.railRampRun) continue;
    for (const k of [a, b]) {
      if (!out.has(k - 1)) out.set(k - 1, "too-steep");
      if (!out.has(k)) out.set(k, "too-steep");
    }
  }
  // #429: the same rule, counted across the join with standing rail — the
  // composed line is what a train rides, and the drag's end is where the two
  // pieces meet. Only the nearest standing change on each end can bind.
  if (standing && changes.length) {
    const run = SLOPES.railRampRun;
    // Start end (position 1): its standing change sits at position p, the
    // drag's first change enters at changes[0] + 1.
    const pStart = nearestStandingChange(grid, tiles[0], standing);
    if (pStart !== null) {
      const k = changes[0];
      if (k + 1 - pStart < run) {
        if (!out.has(k - 1)) out.set(k - 1, "too-steep");
        if (!out.has(k)) out.set(k, "too-steep");
      }
    }
    // Goal end (position n): its standing change sits one step past the goal
    // tile (a join-step climb and the first change behind the join both do),
    // i.e. at n + max(1, 1 − p); the drag's last change enters at
    // changes[last] + 1.
    const pGoal = nearestStandingChange(grid, tiles[n - 1], standing);
    if (pGoal !== null) {
      const k = changes[changes.length - 1];
      if (n + Math.max(1, 1 - pGoal) - k - 1 < run) {
        if (!out.has(k - 1)) out.set(k - 1, "too-steep");
        if (!out.has(k)) out.set(k, "too-steep");
      }
    }
  }
  return out;
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
