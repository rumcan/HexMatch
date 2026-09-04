// ══════════════════════════════════════════════════════════════════════════
// TK-004 — vehicle animation feasibility spike, and TK-007's arrival source.
//
// A bus drives back and forth along the player's own track between a serviced
// harvester (its depot) and the Processing Plant (the factory). The route is
// a BFS over mutually-connected track tiles owned by the player; movement is
// constant-speed interpolation along the tile-centre polyline; the vehicle
// ping-pongs: depot → plant → depot → …
//
// Each arrival AT THE PLANT fires `onArrival` — TK-007 hangs the Processing
// Plant's token spawn on exactly that event, replacing the old time-based
// spawn clock.
//
// Everything here is pure (grid + track in, positions and events out) so the
// spike's technical requirements are unit-testable without a DOM; the game
// renders each vehicle as a free-floating DrawItem at its world position so
// the depth sort keeps buildings in front of (or behind) it correctly.
//
// The full investigation (open requirements: 8-view rotation, per-tile
// speed, mid-route re-routing, blocked-vehicle UX, sound) is
// docs/TK-004-vehicle-animation-feasibility.md.
// ══════════════════════════════════════════════════════════════════════════
import { HW, HH, MAP_W, tileToScreen } from "../game/config";
import {
  DIRS, DIR, OPPOSITE, tIdx, inMapT, bitsAt, trackOwnedBy, type Track,
} from "./track";
import type { EconomyState } from "./economy";

/** Constant vehicle speed in WORLD pixels per second (1× zoom space). */
export const BUS_SPEED_PXPS = 36;
/** Never more buses than this, however many harvesters are serviced. */
export const MAX_VEHICLES = 4;

export interface Vehicle {
  id: number;
  /** Depot (harvester) tile — one path end. */
  depot: { tx: number; ty: number };
  /** The Processing Plant (factory) tile — the other path end. */
  plant: { tx: number; ty: number };
  /** Tiles from depot → plant, inclusive. Length ≥ 2 when usable. */
  path: [number, number][];
  /** Index of the segment currently being travelled (path[leg] → path[leg+1]). */
  leg: number;
  /** World-pixel distance already travelled into the current segment. */
  progress: number;
  /** +1 toward the plant, −1 toward the depot (the back-and-forth). */
  dir: 1 | -1;
}

/** World-space (1×) polyline connecting the tile centres of `path`. */
export function pathPoints(path: [number, number][]): [number, number][] {
  return path.map(([tx, ty]) => {
    const [x, y] = tileToScreen(tx, ty);
    return [x + HW, y + HH] as [number, number];
  });
}

/** Segment lengths of the path polyline, in world px. */
export function segmentLengths(path: [number, number][]): number[] {
  const pts = pathPoints(path);
  const out: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    out.push(Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]));
  }
  return out;
}

/** Interpolated world position and travel axis of a vehicle. */
export function vehiclePos(v: Vehicle): {
  wx: number; wy: number;
  /** "/" = travelling the NE|SW diagonal (side view), "\" = NW|SE (end view). */
  axis: "/" | "\\";
} {
  const pts = pathPoints(v.path);
  const lens = segmentLengths(v.path);
  const len = lens[v.leg] || 1;
  const t = Math.min(1, v.progress / len);
  const [ax, ay] = pts[v.leg];
  const [bx, by] = pts[v.leg + 1];
  const wx = v.dir === 1 ? ax + (bx - ax) * t : bx + (ax - bx) * t;
  const wy = v.dir === 1 ? ay + (by - ay) * t : by + (ay - by) * t;
  // The nose direction this instant: a tile step always satisfies |dx| = 2|dy|
  // and the two diagonals split by the sign relationship — NE/SW steps have
  // opposite-signed deltas ("/" on screen), NW/SE steps same-signed ("\").
  const sdx = (bx - ax) * v.dir;
  const sdy = (by - ay) * v.dir;
  const axis: "/" | "\\" =
    sdx === 0 || sdy === 0 ? "\\" : (sdx > 0) === (sdy > 0) ? "\\" : "/";
  return { wx, wy, axis };
}

/**
 * Breadth-first route over `owner`'s OWN track (the W2 rule: never the
 * rival's) from a track tile adjacent to `from` to a track tile adjacent to
 * `to`. A step follows a MUTUAL direction bit on either layer — the spike
 * lets a bus traverse rail-linked tiles too (acceptable here because a
 * crossing always carries road, and documented as a refinement in the
 * feasibility doc). Returns the tile path INCLUDING both structure
 * endpoints, or null when the network does not link them.
 */
export function findRoute(
  track: Track, owner: number,
  from: { tx: number; ty: number }, to: { tx: number; ty: number },
): [number, number][] | null {
  if (!inMapT(from.tx, from.ty) || !inMapT(to.tx, to.ty)) return null;
  const start = tIdx(from.tx, from.ty);
  const goal = tIdx(to.tx, to.ty);
  const prev = new Map<number, number>();
  const queue: number[] = [];
  const seen = new Set<number>([start, goal]);
  const passable = (i: number) =>
    trackOwnedBy(track, owner, i % MAP_W, (i / MAP_W) | 0);
  // seed: every owned track tile adjacent to the depot
  for (const d of DIRS) {
    const nx = from.tx + DIR[d][0], ny = from.ty + DIR[d][1];
    if (!inMapT(nx, ny)) continue;
    const ni = tIdx(nx, ny);
    if (seen.has(ni) || !passable(ni)) continue;
    seen.add(ni);
    prev.set(ni, start);
    queue.push(ni);
  }
  if (queue.length === 0) return null;
  let hit = -1;
  while (queue.length) {
    const cur = queue.shift()!;
    const cx = cur % MAP_W, cy = (cur / MAP_W) | 0;
    const goalAdjacent = DIRS.some((d) => {
      const nx = cx + DIR[d][0], ny = cy + DIR[d][1];
      return inMapT(nx, ny) && tIdx(nx, ny) === goal;
    });
    if (goalAdjacent) { hit = cur; break; }
    for (const d of DIRS) {
      if (!(bitsAt(track, "road", cx, cy) & d) && !(bitsAt(track, "rail", cx, cy) & d)) continue;
      const nx = cx + DIR[d][0], ny = cy + DIR[d][1];
      if (!inMapT(nx, ny)) continue;
      const ni = tIdx(nx, ny);
      if (seen.has(ni) || !passable(ni)) continue;
      // mutual facing bit on at least one shared layer
      const mutual = ((bitsAt(track, "road", cx, cy) & d) && (bitsAt(track, "road", nx, ny) & OPPOSITE[d]))
        || ((bitsAt(track, "rail", cx, cy) & d) && (bitsAt(track, "rail", nx, ny) & OPPOSITE[d]));
      if (!mutual) continue;
      seen.add(ni);
      prev.set(ni, cur);
      queue.push(ni);
    }
  }
  if (hit < 0) return null;
  // reconstruct depot → plant-adjacent (the seed chain already ends AT the
  // depot tile, because every seed's prev is the depot), then pin the plant
  const tiles: number[] = [hit];
  for (let cur = hit; prev.has(cur); cur = prev.get(cur)!) tiles.push(prev.get(cur)!);
  tiles.reverse();
  tiles.push(goal);
  return tiles.map((i) => [i % MAP_W, (i / MAP_W) | 0] as [number, number]);
}

export interface VehicleHooks {
  /** The vehicle reached the Processing Plant (the TK-007 spawn trigger). */
  onArrival?: (v: Vehicle, now: number) => void;
}

export interface VehicleSystem {
  vehicles: Vehicle[];
  /** Rebuild the routes for `owner`'s serviced harvesters (call on world change). */
  sync(state: EconomyState, owner: string): void;
  /** Advance movement; fires onArrival for each plant arrival this tick. */
  tick(now: number, dtMs: number): void;
  /** Cumulative plant arrivals (diagnostic). */
  arrivals: number;
}

/**
 * The feasibility spike's runtime. `sync` is deliberately dumb: it rebuilds
 * every route from scratch, which costs one BFS per serviced harvester and
 * only runs when the track actually changed (the rescore cadence) — never
 * per frame.
 */
export function createVehicleSystem(hooks: VehicleHooks = {}): VehicleSystem {
  const sys: VehicleSystem = {
    vehicles: [],
    arrivals: 0,
    sync(state, owner) {
      const out: Vehicle[] = [];
      const factory = state.factories.find((f) => f.owner === owner) ?? null;
      if (factory) {
        let nextId = 1;
        for (const h of state.harvesters) {
          if (h.owner !== owner) continue;
          const path = findRoute(state.track, h.ownerId, h, factory);
          if (!path || path.length < 2) continue;
          out.push({
            id: nextId++, depot: { tx: h.tx, ty: h.ty },
            plant: { tx: factory.tx, ty: factory.ty },
            path, leg: 0, progress: 0, dir: 1,
          });
          if (out.length >= MAX_VEHICLES) break;
        }
      }
      sys.vehicles = out;
    },
    tick(now, dtMs) {
      const dist = (BUS_SPEED_PXPS * dtMs) / 1000;
      for (const v of sys.vehicles) {
        let remaining = dist;
        while (remaining > 0) {
          const lens = segmentLengths(v.path);
          const len = lens[v.leg] ?? 0;
          if (v.progress + remaining < len) {
            v.progress += remaining;
            break;
          }
          remaining -= Math.max(0, len - v.progress);
          v.progress = 0;
          // stepped onto the segment-end node: turn around at either path end
          const nextLeg = v.leg + v.dir;
          if (nextLeg < 0 || nextLeg > v.path.length - 2) {
            v.dir = (v.dir === 1 ? -1 : 1) as 1 | -1;
            if (v.dir === -1) {
              // the far end of the path IS the Processing Plant
              sys.arrivals++;
              hooks.onArrival?.(v, now);
            }
            // first segment in the new direction (clamp handles len-2 == 0)
            v.leg = Math.max(0, Math.min(v.path.length - 2, v.leg + v.dir));
          } else {
            v.leg = nextLeg;
          }
        }
      }
    },
  };
  return sys;
}
