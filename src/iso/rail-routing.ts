// ══════════════════════════════════════════════════════════════════════════
// #429 — the slope-aware RAIL drag route.
//
// A rail drag is a gesture with two ends, and the tile path between them used
// to be the octPath — the straight-or-45° line the pointer drew. On an
// elevation map that geometric line crosses grades the shared slope rules
// refuse (a diagonal over a level, two climbs with no run), so the drag was
// refused even when a LEGAL zig-zag — a switchback — exists between the same
// ends. This module is the fix: when the geometric line breaks a slope rule,
// plan a legal one instead, the way `road-routing.ts` plans road routes —
// bounded A* over the seat's own rail rules, preferring flat and
// contour-following tiles, ramps with their run, diagonals on level pairs.
//
// ONE deterministic function of (world, ends). The preview, the commit's
// re-run and the MP host's validation all call it with the same ends and get
// the same tiles, so nothing on the wire changes: a guest still sends the two
// endpoints, and the host re-derives the very zig-zag the guest saw.
//
// It refuses ONLY when nothing legal exists inside the bound — the box around
// the two ends plus a margin of detour room — and then the caller judges the
// straight line as usual, so the refusal still names the tiles that break.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W } from "../game/config";
import { SLOPES } from "./config";
import { FIELD_OCC, ROUGH, type Grid } from "./grid";
import { elevationActive } from "./elevation";
import { NE, SE, SW, NW, tIdx, inMapT, octPath, type Track } from "./track";
import { bridgeAxesAt } from "./bridges";
import { climbLevels, rampCornerOk, railDragSlopeRefusals } from "./slopes";
import {
  OCT_STEPS, RAIL_PRESENT, turnOk,
  railTerrainOk, roadAt, railBridgePlan, railStandingFor, railSlopeJoinChange,
  railSlopeGoalRun, previewRailBuild, type RailState,
} from "./rail";

// ── the ranker's cost table (RANKS only — legality is the shared rule's) ───
const IMPASSABLE = Infinity;
/** Stepping over the seat's own track costs almost nothing — a line reuses
 *  its trunk, exactly like the rival's `RAIL_OWN_COST`. */
const OWN_COST = 0.2;
/** A straight-road level crossing is legal but dear (the rival's own price). */
const CROSSING_COST = 8;
/** A bridge deck tile: the rival's `RAIL_BRIDGE_STEP`. */
const BRIDGE_COST = 12;
/** One level of rail climb is DEAR, so the A* walks the map's own long ramps
 *  and contour lines instead of its one-tile jitter cliffs (the rival's
 *  `RAIL_SLOPE_STEP`). */
const SLOPE_STEP_COST = 6;
/** A direction change: the ticket's "fewer turns" preference, softly — a
 *  switchback turns a lot and every turn is geometrically necessary, so the
 *  penalty must stay well under a flat step. */
const TURN_COST = 0.35;
/** Terrain prices, the rival's own (`COST_FLAT` / `COST_ROUGH`). */
const COST_FLAT = 1;
const COST_ROUGH = 3;
/** The hard bound on the search: a line is a local job between two ends, and
 *  the box plus this cap is what keeps a drag from spending a turn's wall
 *  clock on a dead end. */
const MAX_EXPANSIONS = 30000;

/**
 * The A* step cost for laying rail across one tile. Water, built things,
 * foreign rail and a curve over a road are impassable; a straight road is a
 * crossing (a price, not a wall); the seat's own track is nearly free; a climb
 * is dear. This table only RANKS — whether the drag is legal at all is the
 * shared rule's answer (`previewRailBuild` on the finished path), the same
 * split the rival's `railStepCost` keeps for `validateRailDrag`.
 */
function routeStepCost(
  grid: Grid, track: Track, rail: RailState, ownerId: number, tx: number, ty: number,
  from?: readonly [number, number],
): number {
  if (!inMapT(tx, ty)) return IMPASSABLE;
  const i = tIdx(tx, ty);
  // The occupancy test is the shared rule's own (`railTileRefusal` reads the
  // same bytes the same way), so the ranker never prefers a tile the rule
  // would refuse.
  if (grid.occupancy[i] >= 0 || grid.occupancy[i] === FIELD_OCC) return IMPASSABLE;
  const built = grid.builtAt?.(tx, ty);
  if (built === "depot" || built === "plant" || built === "platform" || built === "dam") return IMPASSABLE;
  if ((rail.rail.tile[i] & RAIL_PRESENT) !== 0) {
    return rail.rail.owner[i] === ownerId ? OWN_COST : IMPASSABLE;
  }
  if (!railTerrainOk(grid, tx, ty)) {
    // River water may be CROSSED by a deck (a straight run, both banks in the
    // drag — the final judge confirms); the sea and a foreign bridge may not.
    if (roadAt(track, tx, ty) !== 0) return IMPASSABLE;
    return bridgeAxesAt(grid, tx, ty) ? BRIDGE_COST : IMPASSABLE;
  }
  const road = roadAt(track, tx, ty);
  if (road !== 0) {
    // A crossing is straight-only, exactly like the rival's table: a curved
    // road would curve the rail with it.
    if (road !== (NE | SW) && road !== (SE | NW)) return IMPASSABLE;
    return CROSSING_COST;
  }
  // E4 (#268): the rail grades. A step steeper than one level is out (the
  // shared rule refuses it too), and a one-level step is dear, so the A* walks
  // the contour. A step onto or off a bridge deck is EXEMPT, exactly as it is
  // in the drag rule: a deck sits at water level and its approach is the
  // bridge's structure, not a grade the line chose.
  const deckStep = !railTerrainOk(grid, tx, ty)
    || (!!from && !railTerrainOk(grid, from[0], from[1]));
  const climb = from && !deckStep ? Math.abs(climbLevels(grid, from, [tx, ty])) : 0;
  if (climb > SLOPES.railMaxStep) return IMPASSABLE;
  return (grid.terrain[i] === ROUGH ? COST_ROUGH : COST_FLAT) + climb * SLOPE_STEP_COST;
}

/**
 * The slope-aware rail drag route: the octPath between the ends when it is
 * legal under the shared slope rules (a flat game and every gentle drag are
 * exactly what they were), otherwise a bounded A* for a legal zig-zag — and
 * null when none exists in the bound, when the caller judges the straight
 * line and reports the offending tiles.
 */
export function planSlopeRailRoute(
  grid: Grid, track: Track, rail: RailState, ownerId: number,
  ax: number, ay: number, bx: number, by: number, xFirst = true,
  gradeSeparated = true,
): [number, number][] | null {
  if (!inMapT(ax, ay) || !inMapT(bx, by)) return null;
  const straight = octPath(ax, ay, bx, by, xFirst);
  if (!elevationActive(grid)) return straight;
  const planned = new Set(straight.map(([x, y]) => tIdx(x, y)));
  const deckTiles = railBridgePlan(grid, track, rail, ownerId, straight, planned).deckTiles;
  // The geometric line is legal under the shared rule (including the run
  // counted across the join with standing rail) → it is the route, unchanged.
  if (railDragSlopeRefusals(grid, straight, deckTiles, railStandingFor(rail, ownerId, planned)).size === 0) {
    return straight;
  }
  // ── the search ─────────────────────────────────────────────────────────
  // State = (tile, heading, RAMP RUN): `run` is how many flat steps the line
  // has taken since its last level change, saturating at FULL — the same
  // state the rival's `planRailRoute` carries, because the rail rule is a
  // property of the run, not of a tile. Diagonals only between equal levels;
  // a level change needs the full run behind it; a step steeper than one
  // level is a wall.
  const R = Math.max(2, SLOPES.railRampRun);
  const FULL = R - 1;
  const S = 9 * R;
  const key = (t: number, o: number, run: number) => t * S + o * R + run;
  // The search box: the ends plus a margin of detour room — a switchback
  // needs lateral room for its U-turns, and the box is what keeps this a
  // local job (the rival's own bound).
  const cx = (ax + bx) >> 1, cy = (ay + by) >> 1;
  const box = (Math.abs(ax - bx) + Math.abs(ay - by)) / 2 + 16;
  const inBox = (x: number, y: number) => Math.abs(x - cx) <= box && Math.abs(y - cy) <= box;

  // The line composes with the seat's standing rail at its ends: the run it
  // starts with is the standing rail's, and the run it must finish with is
  // the goal's — the same context the player's preview reads. The search
  // walks away from both ends, so none of its own tiles is "planned" context.
  const NO_PLANNED: ReadonlySet<number> = new Set();
  const startP = railSlopeJoinChange(grid, rail, ownerId, ax, ay, NO_PLANNED);
  const startRun = startP === null || startP === 0 ? FULL : Math.min(FULL, Math.max(0, -startP));
  const goalRun = railSlopeGoalRun(grid, rail, ownerId, bx, by, NO_PLANNED);

  const goalIdx = tIdx(bx, by);
  const startIdx = tIdx(ax, ay);
  // Endpoints the rule cannot stand on (a cliff, an occupied tile) have no
  // route: the straight-line judge will name them.
  if (!isFinite(routeStepCost(grid, track, rail, ownerId, ax, ay))
    || !isFinite(routeStepCost(grid, track, rail, ownerId, bx, by))) return null;

  // Deterministic A* — the same heap discipline as `planRailRoute` (lowest
  // f, ties by lowest state key), so the same ends on the same world always
  // yield the same zig-zag: the guest's preview, the commit and the MP host
  // all re-derive one route.
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const open: { i: number; f: number }[] = [];
  const less = (a: { i: number; f: number }, b: { i: number; f: number }): boolean =>
    b.f < a.f || (b.f === a.f && b.i < a.i);
  const push = (i: number, f: number): void => {
    open.push({ i, f });
    let n = open.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (!less(open[p], open[n])) break;
      const tmp = open[p]; open[p] = open[n]; open[n] = tmp;
      n = p;
    }
  };
  const pop = (): { i: number; f: number } => {
    const top = open[0], last = open.pop()!;
    if (open.length) {
      open[0] = last;
      let n = 0;
      for (;;) {
        const l = 2 * n + 1, r = l + 1;
        let m = n;
        if (l < open.length && less(open[m], open[l])) m = l;
        if (r < open.length && less(open[m], open[r])) m = r;
        if (m === n) break;
        const tmp = open[n]; open[n] = open[m]; open[m] = tmp;
        n = m;
      }
    }
    return top;
  };
  const heuristic = (x: number, y: number): number => {
    // Octile distance at the cheapest step price — admissible, and tight
    // enough that the search hugs the corridor between the ends.
    const dx = Math.abs(x - bx), dy = Math.abs(y - by);
    return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * OWN_COST;
  };

  const startState = key(startIdx, 8, startRun);
  gScore.set(startState, 0);
  push(startState, heuristic(ax, ay));
  const closed = new Set<number>();
  let expansions = 0;

  while (open.length && expansions < MAX_EXPANSIONS) {
    if (!open.length) break;
    const e = pop();
    if (closed.has(e.i)) continue;
    const cur = e.i;
    closed.add(cur);
    const tile = Math.floor(cur / S), rem = cur % S;
    const oct = Math.floor(rem / R), run = rem % R;
    if (tile === goalIdx && run >= goalRun) {
      // Reconstruct this route and let the shared rule have the final word on
      // the WHOLE gesture — the shape the search kept (turns, runs, level
      // diagonals) plus everything the search does not model (arms, joins,
      // crossings on the final shape, bridges). If it fails, keep searching:
      // a different route into the goal may still pass.
      const tiles: [number, number][] = [];
      let n: number | undefined = cur;
      while (n !== undefined) {
        const t = Math.floor(n / S);
        tiles.push([t % MAP_W, (t / MAP_W) | 0]);
        n = cameFrom.get(n);
      }
      tiles.reverse();
      // The game previews and commits with `gradeSeparated = true`, so the
      // final word is theirs — a route is only "the route" if the drag that
      // builds it is the drag that commits it.
      if (previewRailBuild(grid, track, rail, ownerId, tiles, gradeSeparated).why === "ok") return tiles;
      continue;
    }
    expansions++;
    const x = tile % MAP_W, y = (tile / MAP_W) | 0;
    const baseG = gScore.get(cur) ?? Infinity;
    for (let o = 0; o < 8; o++) {
      // The 45° turn rule — with the one #429 exception: a 90° corner on the
      // top or bottom tile of a ramp, the switchback's turn.
      if (oct !== 8 && !turnOk(oct, o)
        && !rampCornerOk(grid,
          [x - OCT_STEPS[oct][0], y - OCT_STEPS[oct][1]],
          [x, y],
          [x + OCT_STEPS[o][0], y + OCT_STEPS[o][1]])) continue;
      const [sx, sy] = OCT_STEPS[o];
      const diag = sx !== 0 && sy !== 0;
      const nx = x + sx, ny = y + sy;
      if (!inMapT(nx, ny) || !inBox(nx, ny)) continue;
      // A level crossing is straight across: no diagonal on or off a road
      // tile, and no turn on one.
      const roadHere = roadAt(track, x, y) !== 0;
      const roadNext = roadAt(track, nx, ny) !== 0;
      if (diag && (roadHere || roadNext)) continue;
      if (roadHere && oct !== 8 && o !== oct) continue;
      // …and a bridge is straight across for the same reasons.
      const deckHere = !railTerrainOk(grid, x, y);
      const deckNext = !railTerrainOk(grid, nx, ny);
      if (diag && (deckHere || deckNext)) continue;
      if (deckHere && oct !== 8 && o !== oct) continue;
      // E4 (#268): the slopes. A step steeper than one level is out; a
      // diagonal that climbs is out (no 45° link on a slope); a level change
      // needs the full run behind it. Deck steps are exempt (the bridge's own
      // ramp), and they refill the run for the approach on the far bank.
      const deckStep = deckHere || deckNext;
      const climb = climbLevels(grid, [x, y], [nx, ny]);
      if (!deckStep && Math.abs(climb) > SLOPES.railMaxStep) continue;
      if (diag && climb !== 0 && !deckStep) continue;
      if (!deckStep && climb !== 0 && run < FULL) continue;
      const nrun = climb === 0 || deckStep ? Math.min(FULL, run + 1) : 0;
      const cost = routeStepCost(grid, track, rail, ownerId, nx, ny, [x, y]);
      if (!isFinite(cost)) continue;
      const ni = key(tIdx(nx, ny), o, nrun);
      if (closed.has(ni)) continue;
      const tentative = baseG + (diag ? cost * Math.SQRT2 : cost) + (oct !== 8 && o !== oct ? TURN_COST : 0);
      if (tentative >= (gScore.get(ni) ?? Infinity)) continue;
      gScore.set(ni, tentative);
      cameFrom.set(ni, cur);
      push(ni, tentative + heuristic(nx, ny));
    }
  }
  return null;
}
