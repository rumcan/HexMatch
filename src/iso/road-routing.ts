import { MAP_W } from "../game/config";
import { DIR, DIRS, OPPOSITE, bitsAt, tIdx, inMapT, trackOpenTo, type Track, type TrackKind } from "./track";

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
