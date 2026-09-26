import { MAP_W } from "../game/config";
import {
  DIR, DIRS, OPPOSITE, bitsAt, tIdx, inMapT, trackOpenTo, plantFootprintTiles, overpassJump,
  roadDiagNeighbours, hasTrack, type Track, type TrackKind,
} from "./track";
import { DEFAULT_FACING, depotEntranceTiles, type DepotFacing } from "./depot";

// ── the route finder ──────────────────────────────────────────────────────
/**
 * Shortest ROAD route from any tile in `from` to any tile index in `goals`,
 * over the tiles `owner` may drive, crossing only mutually facing bits.
 * Multi-source BFS with parents — the same graph the economy's component
 * flood walks, but returning the actual tiles. Null when no route exists.
 *
 * Gravel and tar are ONE continuous road surface: masks cross the tier
 * boundary (`track.ts` autotiles the union), so by default the route runs
 * over whichever tier each tile carries and crosses dirt↔paved seams freely
 * — the same merged graph the economy's components flood. Pass a specific
 * `kind` only when the caller genuinely needs a tier-pure flood; a route
 * restricted to `dirt` stops at a paved tile (that tile is not PRESENT on
 * the dirt layer, so it never faces back on it). A tile never carries both
 * tiers (`track.ts` replaces on pave).
 */
export function roadPath(
  track: Track, owner: number,
  from: [number, number][], goals: Set<number>,
  kind?: TrackKind,
): [number, number][] | null {
  if (goals.size === 0 || from.length === 0) return null;
  if (track.diagonalRoads) return diagonalRoadPath(track, owner, from, goals, kind);
  const bitsOf = (x: number, y: number): number =>
    kind !== undefined ? bitsAt(track, kind, x, y)
      : (bitsAt(track, "dirt", x, y) || bitsAt(track, "road", x, y));
  const parent = new Map<number, number>();   // tile index → previous index (-1 = source)
  const queue: number[] = [];
  for (const [x, y] of from) {
    if (!inMapT(x, y)) continue;
    const i = tIdx(x, y);
    if (parent.has(i)) continue;
    parent.set(i, -1);
    queue.push(i);
  }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (goals.has(cur)) {
      const path: number[] = [];
      for (let i = cur; i !== -1; i = parent.get(i)!) path.push(i);
      path.reverse();
      return path.map((i) => [i % MAP_W, (i / MAP_W) | 0] as [number, number]);
    }
    const x = cur % MAP_W, y = (cur / MAP_W) | 0;
    for (const d of DIRS) {
      if (!(bitsOf(x, y) & d)) continue;                       // we face it
      const nx = x + DIR[d][0], ny = y + DIR[d][1];
      if (!inMapT(nx, ny)) continue;
      if (!(bitsOf(nx, ny) & OPPOSITE[d])) continue;           // it faces back
      const ni = tIdx(nx, ny);
      if (parent.has(ni)) continue;
      if (!trackOpenTo(track, owner, nx, ny)) continue;        // W2 + PP-13
      parent.set(ni, cur);
      queue.push(ni);
    }
    // ROADS-3 (#394): straight over an overpass (no turn onto the highway).
    if (track.tier) {
      for (const d of DIRS) {
        const j = overpassJump(track, x, y, d, owner);
        if (!j) continue;
        const ji = tIdx(j[0], j[1]);
        if (parent.has(ji) || !trackOpenTo(track, owner, j[0], j[1])) continue;
        parent.set(ji, cur);
        queue.push(ji);
      }
    }
  }
  return null;
}

/** D1: deterministic Dijkstra, because sqrt(2) links invalidate BFS's
 * fewest-edges = shortest-distance assumption. Legacy flag-OFF BFS stays
 * untouched (including its tie breaks and overpass behaviour). */
function diagonalRoadPath(
  track: Track, owner: number, from: [number, number][], goals: Set<number>, kind?: TrackKind,
): [number, number][] | null {
  const bitsOf = (x: number, y: number) => kind ? bitsAt(track, kind, x, y)
    : bitsAt(track, "dirt", x, y) | bitsAt(track, "road", x, y);
  const usable = (x: number, y: number) => trackOpenTo(track, owner, x, y)
    && (!kind || hasTrack(track, kind, x, y));
  const parent = new Map<number, number>();
  const distance = new Map<number, number>();
  // Stable binary min-heap: O(E log V), no repeated map-wide sorts/scans.
  type Entry = { i: number; cost: number; order: number };
  const heap: Entry[] = [];
  let order = 0;
  const less = (a: Entry, b: Entry) => a.cost < b.cost || (a.cost === b.cost && a.order < b.order);
  const push = (i: number, cost: number) => {
    const e = { i, cost, order: order++ };
    let n = heap.length;
    heap.push(e);
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (!less(e, heap[p])) break;
      heap[n] = heap[p];
      n = p;
    }
    heap[n] = e;
  };
  const pop = (): Entry => {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) {
      let n = 0;
      while (n * 2 + 1 < heap.length) {
        let c = n * 2 + 1;
        if (c + 1 < heap.length && less(heap[c + 1], heap[c])) c++;
        if (!less(heap[c], last)) break;
        heap[n] = heap[c];
        n = c;
      }
      heap[n] = last;
    }
    return first;
  };
  for (const [x, y] of from) {
    const i = tIdx(x, y);
    if (!usable(x, y) || distance.has(i)) continue;
    distance.set(i, 0);
    parent.set(i, -1);
    push(i, 0);
  }
  while (heap.length) {
    const { i: cur, cost } = pop();
    if (cost !== distance.get(cur)) continue;
    if (goals.has(cur)) {
      const path: [number, number][] = [];
      for (let i = cur; i !== -1; i = parent.get(i)!) path.push([i % MAP_W, (i / MAP_W) | 0]);
      return path.reverse();
    }
    const x = cur % MAP_W, y = (cur / MAP_W) | 0;
    const visit = (nx: number, ny: number, length: number) => {
      if (!usable(nx, ny)) return;
      const ni = tIdx(nx, ny), next = cost + length;
      if (next >= (distance.get(ni) ?? Infinity)) return;
      distance.set(ni, next);
      parent.set(ni, cur);
      push(ni, next);
    };
    for (const d of DIRS) {
      const nx = x + DIR[d][0], ny = y + DIR[d][1];
      if ((bitsOf(x, y) & d) && (bitsOf(nx, ny) & OPPOSITE[d])) visit(nx, ny, 1);
    }
    for (const [nx, ny] of roadDiagNeighbours(track, x, y, kind)) visit(nx, ny, Math.SQRT2);
    for (const d of DIRS) {
      const jump = overpassJump(track, x, y, d, owner);
      if (jump) visit(jump[0], jump[1], 2);
    }
  }
  return null;
}

// ── planning: connection → truck ──────────────────────────────────────────
/** Road tiles 4-adjacent to (tx,ty) that `owner` may drive on. */
export const shoulders = (track: Track, owner: number, tx: number, ty: number) => {
  const out: [number, number][] = [];
  for (const d of DIRS) {
    const nx = tx + DIR[d][0], ny = ty + DIR[d][1];
    if (trackOpenTo(track, owner, nx, ny)) out.push([nx, ny]);
  }
  return out;
};

/**
 * A 2×2 truck Depot's road access: the ENTRANCE tiles outside its open edges
 * (`depot.ts`) that `owner` may drive on. A road touching the lot's closed
 * side does not reach it — the gate is on the open side.
 */
export const depotShoulders = (
  track: Track, owner: number, h: { tx: number; ty: number; facing?: DepotFacing },
): [number, number][] =>
  depotEntranceTiles(h.tx, h.ty, h.facing ?? DEFAULT_FACING).filter(([x, y]) => trackOpenTo(track, owner, x, y));

/**
 * PP-15: the road tiles a PLANT's edge touches — every tile 4-adjacent to ANY
 * tile of its `FACTORY_FOOTPRINT` block, deduplicated in footprint order.
 *
 * A plant is one sprite drawn over the whole block, so the block has four
 * sides and all of them are frontage. The single-tile `shoulders` answer was
 * the origin tile's ring, which sits at the BACK of the graphic: a road that
 * plainly touches the building's visible edge was "not connected", and the only
 * tile a player could plug into was the one the art covers — "you have to build
 * the road into some weird spot inside". Every consumer of "is this depot
 * joined to that plant" (the economy's component test, the lorry's route goal,
 * the rival's pave pass) reads this, so the edge is one rule, not four.
 */
export function plantShoulders(
  track: Track, owner: number, tx: number, ty: number, rot = 0,
  // F4 (#275): the map's Factory span — defaults to the legacy square via
  // `plantFootprintTiles`, so grid-less callers and legacy maps are unchanged.
  footprint?: readonly [number, number],
): [number, number][] {
  const out: [number, number][] = [];
  const seen = new Set<number>();
  for (const [fx, fy] of plantFootprintTiles(tx, ty, rot, footprint)) {
    for (const [x, y] of shoulders(track, owner, fx, fy)) {
      const i = tIdx(x, y);
      if (seen.has(i)) continue;
      seen.add(i);
      out.push([x, y]);
    }
  }
  return out;
}
