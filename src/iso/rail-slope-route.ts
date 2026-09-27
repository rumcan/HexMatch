// ══════════════════════════════════════════════════════════════════════════
// RAIL-SLOPE (#429) — the slope-aware planner behind a rail DRAG.
//
// A rail drag draws the geometric line between its two endpoints
// (`octPath`). On a hill that line breaks a slope rule — two climbs one tile
// apart, a diagonal straddling a level — and until #429 the drag simply
// refused, which made a switchback (the zig-zag a real railway uses to climb)
// impossible to draw. This module answers the question the preview should
// have been asking: not "is the drawn line legal?" but "is there ANY legal
// line between these two tiles, and which is it?"
//
// The answer is a bounded A* over the state (tile, heading, ramp-run) — the
// same state `ai.ts`'s rival planner has carried since #268, restated here
// for the PLAYER because the rules must be one: every path this returns is a
// path `railDragSlopeVerdict` accepts, or the search says null and the drag
// refuses with the rule's own words (and only the offending tiles go red).
//
//   • A step may climb at most `SLOPES.railMaxStep` levels, and a level change
//     needs `railRampRun` tiles of run behind it — so a climb is followed by
//     level tiles before the next climb, which is what draws the zig-zag. The
//     start carries the run the player's STANDING line gives it
//     (`runBefore`), so a line composed from two drags stays legal.
//   • A diagonal link may only join two tiles at the SAME level — the search
//     turns on level ground, and `railRampCornerOk` allows a 90° corner where
//     a ramp's top or bottom tile touches it (the hillside's only other turn).
//   • Turns stay inside 45° except for that ramp corner — the railway's shape
//     rule is kept, not replaced.
//   • Costs prefer the cheap line: level ground is free, each level climbed
//     is paid (contour-following wins), every turn is paid, a ramp corner a
//     little more — so between two legal zig-zags the one a player would
//     have drawn comes out first.
//   • The search is BOUNDED: a box around the endpoints and an expansion cap.
//     No route ever costs the pointer a frame, and a null answer is a real
//     "no legal line fits here", not a timeout.
//
// Like every E4 rule this is inert on a map without elevation: the caller
// keeps `octPath` and this module is never reached.
// ══════════════════════════════════════════════════════════════════════════
import { SLOPES } from "./config";
import { elevationActive } from "./elevation";
import { heightAt, type Grid } from "./grid";
import { railRampCornerOk } from "./slopes";

/**
 * The eight headings, as grid steps, in turning order — the SAME table
 * `rail.ts` owns. Restated (with its `turnOk` rule) because `rail.ts` imports
 * THIS module and a value import back would close a runtime cycle; the same
 * reason `slopes.ts` restates the diagonal test.
 */
const OCT_STEPS: readonly [number, number][] = [
  [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1],
];
/** The diagonals are the EVEN octants (screen e/s/w/n); odd ones are axis steps. */
const isDiagOct = (o: number): boolean => (o & 1) === 0;

/** The turn rule: at most 45°, or the 90° ramp corner `railRampCornerOk` allows. */
const turnOkAt = (
  grid: Grid, oct: number, o: number,
  cx: number, cy: number,
): boolean => {
  const d = Math.abs(oct - o) % 8;
  if (Math.min(d, 8 - d) <= 1) return true;
  if (d !== 2) return false;
  return railRampCornerOk(grid,
    [cx - OCT_STEPS[oct][0], cy - OCT_STEPS[oct][1]], [cx, cy],
    [cx + OCT_STEPS[o][0], cy + OCT_STEPS[o][1]]);
};

/** The turn's price: straight on is free, a 45° bend costs, a ramp corner more. */
const turnCost = (oct: number, o: number): number => {
  if (oct === 8) return 0;
  const d = Math.abs(oct - o) % 8;
  const min = Math.min(d, 8 - d);
  return min === 0 ? 0 : min === 1 ? TURN_COST : CORNER_COST;
};

/** Tile prices, so "a route over the hill" loses to "a route around it"
 * whenever the player could have drawn either: a level climb costs what the
 * economy already says one is worth, and every extra turn is dearer still. */
const CLIMB_COST = SLOPES.climbTiles;   // per level, up or down — the L3 measure
const TURN_COST = 0.4;                  // a 45° bend is a little dearer than straight on
const CORNER_COST = 1.2;                // the 90° ramp corner: legal, but the last resort

export interface RailSlopeRouteOptions {
  /**
   * Flat steps of run the player's standing rail carries INTO (ax, ay) (the
   * `before` half of `railJoinRunAt`'s answer). A route that changes level
   * sooner than `railRampRun - runBefore` steps in is illegal, exactly as it
   * would be inside one drag; omitted = a fresh line with all the run it
   * needs.
   */
  runBefore?: number;
  /** Tiles the route may not step onto (water, something built, the rival's
   * rail…). The goal tile is exempt — the drag's own endpoint is the
   * preview's business, not the route's. */
  impassable?: (x: number, y: number) => boolean;
  /** Half the side of the search box around the endpoints, in addition to the
   * stretch between them. Bigger finds wilder zig-zags; the bound is the
   * promise that a refusal is quick. */
  boxMargin?: number;
  /** Maximum pops before the search says null. */
  maxExpansions?: number;
}

/**
 * A legal rail line from (ax, ay) to (bx, by) on `grid`'s slopes, or null when
 * none exists inside the bound. The returned tiles INCLUDE both endpoints, in
 * order; every step is one of the eight rail moves, and the whole path passes
 * `railDragSlopeVerdict` with the caller's `runBefore` — so the preview can
 * lay it exactly like a hand-drawn one.
 */
export function routeRailSlope(
  grid: Grid, ax: number, ay: number, bx: number, by: number,
  opts: RailSlopeRouteOptions = {},
): [number, number][] | null {
  if (!elevationActive(grid)) return null;
  const { runBefore, impassable, boxMargin = 9, maxExpansions = 2800 } = opts;
  if (ax === bx && ay === by) return null;
  const w = grid.w, h = grid.h;
  const goal = by * w + bx;
  // The search box: the endpoints plus a margin of detour room — the rival's
  // boxed search (ai.ts) is the pattern, tightened for a pointer that moves
  // every frame.
  const cxm = (ax + bx) >> 1, cym = (ay + by) >> 1;
  const box = (Math.abs(ax - bx) + Math.abs(ay - by)) / 2 + boxMargin;
  const inBox = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && Math.abs(x - cxm) <= box && Math.abs(y - cym) <= box;

  // State: tile · (9 headings, 8 = "no heading yet") · ramp-run. `run` counts
  // the level tiles walked since the last level change, saturating at FULL;
  // a change is legal only when the run is already there — the ramp rule as a
  // search invariant (the mirror of `railDragSlopeVerdict`, which checks it on
  // the finished shape).
  const R = Math.max(2, SLOPES.railRampRun);
  const FULL = R - 1;
  const S = 9 * R;
  const key = (t: number, o: number, run: number): number => t * S + o * R + run;
  const start = key(ay * w + ax, 8, Math.min(FULL, runBefore ?? FULL));

  const octile = (x: number, y: number): number => {
    const dx = Math.abs(x - bx), dy = Math.abs(y - by);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };

  // Stable binary min-heap, ties by insertion order — the shape
  // `road-routing.ts`'s Dijkstra uses, so the route is the same on every
  // client and the host never disagrees with a guest's preview.
  type Entry = { k: number; f: number; order: number };
  const heap: Entry[] = [];
  let order = 0;
  const better = (a: Entry, b: Entry): boolean => a.f < b.f || (a.f === b.f && a.order < b.order);
  const push = (k: number, f: number): void => {
    const e = { k, f, order: order++ };
    let n = heap.length;
    heap.push(e);
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (!better(e, heap[p])) break;
      heap[n] = heap[p]; n = p;
    }
    heap[n] = e;
  };
  const pop = (): Entry => {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) {
      let n = 0;
      while (n * 2 + 1 < heap.length) {
        let c = n * 2 + 1;
        if (c + 1 < heap.length && better(heap[c + 1], heap[c])) c++;
        if (!better(last, heap[c])) break;
        heap[n] = heap[c]; n = c;
      }
      heap[n] = last;
    }
    return first;
  };

  const level = (t: number): number => heightAt(grid, t % w, (t / w) | 0);
  const gScore = new Map<number, number>([[start, 0]]);
  const cameFrom = new Map<number, number>();
  const fScore = new Map<number, number>([[start, octile(ax, ay)]]);
  const closed = new Set<number>();
  push(start, fScore.get(start)!);
  let expansions = 0;

  while (heap.length) {
    const { k: cur, f } = pop();
    if (closed.has(cur)) continue;
    if (f !== (fScore.get(cur) ?? Infinity)) continue;
    if (++expansions > maxExpansions) return null;   // the bound is honest
    closed.add(cur);
    const t = Math.floor(cur / S), rem = cur % S;
    const oct = Math.floor(rem / R), run = rem % R;
    const x = t % w, y = (t / w) | 0;
    if (t === goal) {
      const tiles: [number, number][] = [];
      let n: number | undefined = cur;
      while (n !== undefined) {
        const ti = Math.floor(n / S);
        tiles.push([ti % w, (ti / w) | 0]);
        n = cameFrom.get(n);
      }
      return tiles.reverse();
    }
    for (let o = 0; o < 8; o++) {
      if (oct !== 8) {
        const d = Math.abs(oct - o) % 8;
        if (Math.min(d, 8 - d) > 1 && !turnOkAt(grid, oct, o, x, y)) continue;
      }
      const [sx, sy] = OCT_STEPS[o];
      const nx = x + sx, ny = y + sy;
      if (!inBox(nx, ny)) continue;
      const ni = ny * w + nx;
      if (ni !== goal && impassable?.(nx, ny)) continue;
      const climb = level(ni) - level(t);
      if (Math.abs(climb) > SLOPES.railMaxStep) continue;         // the step itself is a cliff
      if (isDiagOct(o) && climb !== 0) continue;                   // a diagonal never leaves the level
      if (climb !== 0 && run < FULL) continue;                     // the ramp run is not there yet
      const nrun = climb === 0 ? Math.min(FULL, run + 1) : 0;
      const step = (isDiagOct(o) ? Math.SQRT2 : 1)
        + CLIMB_COST * Math.abs(climb) + turnCost(oct, o);
      const nk = key(ni, o, nrun);
      if (closed.has(nk)) continue;
      const tentative = (gScore.get(cur) ?? Infinity) + step;
      if (tentative >= (gScore.get(nk) ?? Infinity)) continue;
      cameFrom.set(nk, cur);
      gScore.set(nk, tentative);
      const nf = tentative + octile(nx, ny);
      fScore.set(nk, nf);
      push(nk, nf);
    }
  }
  return null;
}
