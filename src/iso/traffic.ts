// ══════════════════════════════════════════════════════════════════════════
// TRAFFIC-1 (#433): lanes, car-following, junction yielding.
//
// Vehicles currently drive centre-to-centre along their route, so they all
// sit on the centre-line of the road and overlap at corners and on overpasses.
// This module gives every vehicle the bookkeeping it needs to read as real
// traffic without changing how they ROUTE (routes still come from roadPath/
// carRoute and are unchanged):
//
//   1. LANE OFFSET — right-hand traffic. Each vehicle carries a (du, dv)
//      offset perpendicular to its current leg, applied at draw time via an
//      additive offset on fx/fy. Highways shift further out (two lanes each
//      direction, separated by the divider). Diagonals keep the offset along
//      the 45° perpendicular.
//   2. CAR-FOLLOWING — a vehicle reads the vehicle ahead in the same spatial
//      hash bucket and slows/brakes to maintain the minimum gap. Simple IDM
//      (intelligent driver model) lite: desired speed, min gap, comfortable
//      deceleration — no O(n²) scan.
//   3. JUNCTION YIELD — at a tile where the route TURNS (leg changes
//      direction), the arriving vehicle briefly yields to any vehicle already
//      in the intersection box (first-come priority with a short wait),
//      preventing simultaneous entry.
//   4. OVERPASS LIFT — vehicles on a deck/overpass get an extra depth lift so
//      they draw OVER the lower road.
//   5. DENSITY & JAM RECOVERY — a per-segment cap; a vehicle that has been
//      stuck for > JAM_TIMEOUT_MS despawns and re-plans (ambient cars just
//      pick a new trip; cargo trucks wait for the road to clear rather than
//      despawn mid-delivery — they're the economic contract).
//   6. SPATIAL HASH — segment-keyed bucketing: segKey(ax, ay, bx, by) is the
//      bucket for any vehicle between a and b. Scans only the bucket(s) the
//      vehicle is entering — O(n) total.
//
// All of this is PRESENTATION with one exception: cars may despawn on a
// permanent jam (same as today's wait-after-delivery, just sooner). Cargo
// trucks never despawn mid-route because they are the economic contract; they
// keep waiting.
// ══════════════════════════════════════════════════════════════════════════
import {
  tIdx, inMapT, PRESENT, OVERPASS_X, OVERPASS_Y,
  ROAD_RAIL_DECK_X, ROAD_RAIL_DECK_Y,
  type Track, type RoadTier,
} from "./track";

// ── lane offsets ────────────────────────────────────────────────────────
/** Perpendicular offset (in tile units) for right-hand traffic, single-lane
 *  roads (dirt, road, street, ramp). Right-of-centre when heading in the
 *  direction of the leg; magnitude is half the lane width, so opposite
 *  directions pass side-by-side without overlapping. */
export const LANE_OFFSET = 0.12;
/** Highway: two lanes each direction, so the offset is wider — two offsets
 *  from the centre, straddling the divider. */
export const LANE_OFFSET_HIGHWAY = 0.24;
/** Extra z-lift for vehicles ON an overpass deck — large enough to guarantee
 *  they draw OVER the crossing road beneath, small enough not to float above
 *  the bridge itself. */
export const OVERPASS_LIFT = 0.9;
/** Minimum gap (in tile units) to the vehicle ahead, measured along the
 *  direction of travel. */
export const MIN_GAP = 0.35;
/** Comfortable braking decel (tiles/s²). */
export const COMFORT_DECEL = 2.5;
/** Junction approach radius: a vehicle is "at" a junction when its remaining
 *  distance to the next tile is below this. It yields before entering. */
export const JUNCTION_APPROACH = 0.15;
/** How long a vehicle waits at a yield before forcing through (jam recovery). */
export const YIELD_WAIT_MS = 800;
/** How long a car must be stationary before it despawns on a suspected jam. */
export const JAM_TIMEOUT_MS = 12000;
/** Per-segment density cap: refuse entry when this many vehicles already
 *  occupy the same lane bucket (prevents pile-ups from snowballing). */
export const SEGMENT_CAP = 4;
/** Speed under which a vehicle is considered "stationary" for jam detection.
 *  In tiles per ms (≈ TRUCK_SPEED / 50 so very slow counts as stopped). */
export const STATIONARY_SPEED = 1 / 30000;

/**
 * The perpendicular ground-plane offset for a vehicle heading from a to b.
 * Right-hand traffic: the normal points to the vehicle's RIGHT (which is the
 * left side of the screen in ground coordinates — a right-hand driver hugs
 * the right side of their carriageway).
 *
 * For axis legs dx or dy is ±1, the other is 0; for diagonals both are ±1.
 * The perpendicular to (dx, dy) is (-dy, dx). In right-hand traffic you
 * drive on the RIGHT side of your direction, which is -perpendicular
 * (because ground-space has y increasing DOWN-SOUTH).
 */
export function lanePerp(dx: number, dy: number, tier?: number): [number, number] {
  // Normalise the direction vector.
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  // Perpendicular: rotate (ux,uy) 90° CCW in ground plane -> (-uy, ux)
  // Right-hand traffic -> shift RIGHT relative to heading = +perpendicular
  // (sign verified: heading E (dx=1,dy=0): perp = (0,1) = SOUTH side of the
  // eastbound lane, which IS the right-hand side in ground coordinates
  // because ground y grows toward the south.)
  const px = -uy * LANE_OFFSET;
  const py = ux * LANE_OFFSET;
  if (tier === 2 || tier === OVERPASS_X || tier === OVERPASS_Y) {
    // Highway: larger offset, two lanes straddling divider.
    return [px * (LANE_OFFSET_HIGHWAY / LANE_OFFSET), py * (LANE_OFFSET_HIGHWAY / LANE_OFFSET)];
  }
  return [px, py];
}

/** True when the tier at (x,y) is an overpass deck carrying vehicles OVER
 *  another road, or a rail deck. Both cases need the vehicle lifted. */
export function isOverpassTier(tier: RoadTier, flags: number): boolean {
  if (tier === OVERPASS_X || tier === OVERPASS_Y) return true;
  if (flags & (ROAD_RAIL_DECK_X | ROAD_RAIL_DECK_Y)) return true;
  return false;
}

/** Combined tier+flags byte at (tx,ty); flags are the upper bits of tier. */
function tierFlags(t: Track, tx: number, ty: number): { tier: RoadTier; flags: number } {
  const i = tIdx(tx, ty);
  const byte = t.tier?.[i] ?? 0;
  return { tier: (byte & 7) as RoadTier, flags: byte & ~7 };
}

// ── spatial hash ────────────────────────────────────────────────────────
/**
 * Canonical segment key: lower-tile-index first so a→b and b→a (opposing
 * traffic) share the same bucket. We then split further by lane parity at
 * query time so following only considers same-direction vehicles.
 */
export function segKey(ax: number, ay: number, bx: number, by: number): string {
  const ai = tIdx(ax, ay), bi = tIdx(bx, by);
  return ai < bi ? `${ai}->${bi}` : `${bi}->${ai}`;
}

/** A Vehicle's public position — the traffic system reads any object that
 *  matches this shape (Car, Truck, test fixtures). */
export interface VehiclePos {
  /** route tiles */
  route: readonly (readonly [number, number])[];
  /** index into route */
  leg: number;
  /** 0..1 progress along route[leg] → route[leg+1] */
  t: number;
  /** for trucks only: true on the return leg */
  reverse?: boolean;
}

/** The "world" progress (cumulative tile distance from route[0]) used for
 *  ordering vehicles on the same segment. Returns [fromTileIdx, progress,
 *  endTileIdx] for fast same-bucket comparison. For a reverse truck we
 *  measure from the far end so progress still increases along the heading. */
export function vehicleProgress(v: VehiclePos): { key: string; along: number; headingForward: boolean } {
  const n = v.route.length;
  if (n < 2) return { key: "", along: 0, headingForward: true };
  const k = Math.min(v.leg, n - 2);
  const a = v.route[k], b = v.route[k + 1];
  const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const key = segKey(a[0], a[1], b[0], b[1]);
  // For the along-segment measure we want a monotonic coordinate that is
  // SMALLER when the vehicle is further back ALONG ITS HEADING. Same lane,
  // same direction means vehicles can be sorted by it.
  const along = v.t * segLen;
  const headingForward = !v.reverse;
  // Normalise direction: for forward direction along a segment where
  // route goes a→b (aIdx < bIdx canonical? not needed since we already have
  // segKey shared), use along directly; for reverse, use segLen - along.
  // We expose headingForward so the caller can decide ordering.
  return { key, along: v.reverse ? segLen - along : along, headingForward };
}

// ── overpass lift for drawing ──────────────────────────────────────────
/** Return the additional depth lift a vehicle at its current position needs
 *  because it is on an overpass/bridge deck. 0 elsewhere.
 *
 * An OVERPASS_X tile carries a Highway along the x-axis (SE/NW) with the
 * crossing y-axis road passing OVER it. So only vehicles heading along the
 * CROSSING direction (i.e. not along the highway axis) get lifted.
 * Rail decks (ROAD_RAIL_DECK_X/Y) lift every vehicle on the deck tile. */
export function overpassLiftFor(v: VehiclePos, track: Track): number {
  const n = v.route.length;
  if (n < 2) return 0;
  const k = Math.min(v.leg, n - 2);
  let a = v.route[k], b = v.route[k + 1];
  // For reverse (truck returning) heading is b→a.
  if (v.reverse) {
    a = v.route[k];
    b = v.route[Math.max(k - 1, 0)];
  }
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const fx = (v.route[k][0] + v.route[Math.min(k + 1, n - 1)][0]) / 2
    || v.route[k][0] + (v.route[Math.min(k + 1, n - 1)][0] - v.route[k][0]) * v.t;
  const fy = v.route[k][1] + (v.route[Math.min(k + 1, n - 1)][1] - v.route[k][1]) * v.t;
  const tx = Math.round(fx), ty = Math.round(fy);
  if (!inMapT(tx, ty)) return 0;
  const i = tIdx(tx, ty);
  if (((track.road[i] | track.dirt[i]) & PRESENT) === 0) return 0;
  const { tier, flags } = tierFlags(track, tx, ty);
  if (flags & (ROAD_RAIL_DECK_X | ROAD_RAIL_DECK_Y)) return OVERPASS_LIFT;
  if (tier === OVERPASS_X) {
    // highway on x axis → crossing road (y axis, NE/SW direction) goes over
    // Lift vehicles whose heading is primarily N-S (dy != 0 and dx == 0 for axis).
    // Diagonals never appear on overpass tiles per D5 rule.
    if (Math.abs(dx) < 0.01 && Math.abs(dy) > 0.5) return OVERPASS_LIFT;
    return 0;
  }
  if (tier === OVERPASS_Y) {
    if (Math.abs(dy) < 0.01 && Math.abs(dx) > 0.5) return OVERPASS_LIFT;
    return 0;
  }
  return 0;
}

/** Compute the draw offset (du, dv) in ground tile units for a vehicle's
 *  lane position, given its current segment and whether it is on a highway. */
export function laneOffsetFor(v: VehiclePos, track: Track): [number, number] {
  const n = v.route.length;
  if (n < 2) return [0, 0];
  const k = Math.min(v.leg, n - 2);
  const a = v.route[k], b = v.route[k + 1];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  // Determine the tier at mid-segment (sample the rounded tile).
  const fx = a[0] + dx * v.t, fy = a[1] + dy * v.t;
  const tx = Math.round(fx), ty = Math.round(fy);
  let tier: number = 0;
  if (inMapT(tx, ty)) {
    const i = tIdx(tx, ty);
    if ((track.road[i] & PRESENT) !== 0) tier = (track.tier?.[i] ?? 0) & 7;
  }
  // For reverse (truck returning) the heading flips: we want the offset in
  // the HEADING direction, not the raw route-array direction. The route
  // goes depot→factory; reverse means heading factory→depot, so the leg
  // step is from route[leg] toward route[leg-1] which is the same as -dx,-dy.
  const hdx = v.reverse ? -dx : dx;
  const hdy = v.reverse ? -dy : dy;
  return lanePerp(hdx, hdy, tier);
}

// ── car-following model (IDM-lite) ────────────────────────────────────
/**
 * Recommended speed multiplier 0..1 for a vehicle at position `progress`
 * along its segment given the closest same-lane vehicle ahead on the same
 * segment. `v0` is the desired speed (tiles/ms); `distAhead` is the distance
 * in TILES to the vehicle ahead along the heading (Infinity if clear);
 * returns the speed cap (0..v0).
 *
 * This is a deliberately simple follow: don't close faster than comfort
 * deceleration allows, and never enter the MIN_GAP. Not a full IDM — there
 * is no time-headway term — because we only need to keep visible spacing,
 * not calibrate motorway flow.
 */
export function followSpeed(v0: number, distAhead: number): number {
  if (!isFinite(distAhead) || distAhead > MIN_GAP + 1.5) return v0;
  if (distAhead <= MIN_GAP) return 0;
  // Brake smoothly in the zone between MIN_GAP and MIN_GAP+1.5.
  const slack = distAhead - MIN_GAP;
  // 0 slack → 0 speed, 1.5 slack → v0. Use a quadratic so onset is gentle
  // and stop is firm; clip to v0.
  const factor = Math.min(1, (slack / 1.5) ** 1.5);
  return v0 * factor;
}

// ── junction detection ────────────────────────────────────────────────
/**
 * Does the vehicle's current position put it APPROACHING a junction, and
 * which tiles define the intersection box? Returns null if the next step
 * is a straight continuation; otherwise returns the set of tile indices
 * that form the intersection (the current tile + next tile + the direction
 * we came from, essentially the corner where the turn happens).
 *
 * A junction is a point where two consecutive legs differ in direction —
 * i.e. the path BENDS at route[leg+1].
 */
export function approachingJunction(v: VehiclePos): boolean {
  const n = v.route.length;
  if (n < 3) return false;
  const k = Math.min(v.leg, n - 2);
  // Remaining distance to the waypoint at route[k+1]
  const a = v.route[k], b = v.route[k + 1];
  const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const remaining = (1 - v.t) * segLen;
  // We are "approaching" when close enough to the junction tile
  if (remaining > JUNCTION_APPROACH + 0.01) return false;
  // It is a junction only if the NEXT leg changes direction (bend/turn) or
  // if k+1 is the end of route, or if the tile at b has >2 connections
  // (crossroads). We keep detection cheap: a junction is simply "we are at
  // a node tile b that is not a straight continuation". Since roads are
  // centre-to-centre, every bend IS a junction. For straight continuations
  // (opposite direction) there is no need to yield.
  if (k + 1 >= n - 1) {
    // Approaching the end of the route — treat as a junction for yield/arrival purposes.
    return remaining <= JUNCTION_APPROACH;
  }
  const c = v.route[k + 2];
  const d1x = b[0] - a[0], d1y = b[1] - a[1];
  const d2x = c[0] - b[0], d2y = c[1] - b[1];
  // Straight continuation: incoming is opposite of outgoing
  if (d1x === -d2x && d1y === -d2y) {
    // Actually check: if d1x,d1y straight, and d2x,d2y same direction, it's
    // straight (not opposite). Wait — route goes a→b→c: from a to b is
    // direction (d1x,d1y); from b to c is (d2x,d2y). Straight = same
    // direction (not opposite). If directions are same (dx=1,dy=0 both),
    // straight through.
    if (d1x === d2x && d1y === d2y) return false;
    // If d2 is diagonal continuation of axis? That's a bend because roads
    // can't turn diagonal onto same-axis. Treat as junction.
  }
  // Same direction → straight
  if (d1x === d2x && d1y === d2y) return false;
  return true;
}

/**
 * Is the intersection node (route[leg+1] when approaching) currently
 * OCCUPIED by another vehicle? This is used for first-come yield. A
 * spatial hash keyed by node tile covers it.
 */
export function junctionKey(v: VehiclePos): string | null {
  const n = v.route.length;
  if (n < 2) return null;
  const k = Math.min(v.leg, n - 2);
  if (k + 1 >= n) return null;
  const b = v.route[k + 1];
  return `j:${tIdx(b[0], b[1])}`;
}

// ── spatial hash bucket helpers ───────────────────────────────────────
export interface VehicleEntry {
  id: number | string;
  v: VehiclePos;
  /** set by the hash: current bucket keys this vehicle occupies */
  _keys?: string[];
}

/** Simple segment-keyed spatial hash for O(1) same-segment lookup. */
export class TrafficHash {
  private buckets = new Map<string, Set<VehicleEntry>>();
  private junctionBuckets = new Map<string, Set<VehicleEntry>>();

  clear(): void {
    this.buckets.clear();
    this.junctionBuckets.clear();
  }

  /** Register or update a vehicle in the hash. Returns the bucket keys
   *  added so the caller can use them for lookups. */
  add(entry: VehicleEntry): string[] {
    const v = entry.v;
    const n = v.route.length;
    const keys: string[] = [];
    if (n >= 2) {
      const k = Math.min(v.leg, n - 2);
      const a = v.route[k], b = v.route[k + 1];
      const sk = segKey(a[0], a[1], b[0], b[1]);
      keys.push(sk);
      let bucket = this.buckets.get(sk);
      if (!bucket) { bucket = new Set(); this.buckets.set(sk, bucket); }
      bucket.add(entry);
    }
    const jk = junctionKey(v);
    if (jk) {
      keys.push(jk);
      let jb = this.junctionBuckets.get(jk);
      if (!jb) { jb = new Set(); this.junctionBuckets.set(jk, jb); }
      jb.add(entry);
    }
    entry._keys = keys;
    return keys;
  }

  /** Iterate every vehicle in the current segment bucket, including the
   *  caller — the caller must itself out by id. */
  segmentMates(key: string): Iterable<VehicleEntry> {
    return this.buckets.get(key) ?? [];
  }

  /** Iterate vehicles currently at a junction. */
  junctionMates(key: string): Iterable<VehicleEntry> {
    return this.junctionBuckets.get(key) ?? [];
  }

  /** Count vehicles in a segment bucket (cap check). */
  segmentCount(key: string): number {
    return this.buckets.get(key)?.size ?? 0;
  }

  /** Count vehicles in a junction bucket. */
  junctionCount(key: string): number {
    return this.junctionBuckets.get(key)?.size ?? 0;
  }
}

/**
 * Build a fresh TrafficHash from an array of vehicle positions. Each entry
 * must have a unique id (car name / truck depotId).
 */
export function buildHash(entries: VehicleEntry[]): TrafficHash {
  const h = new TrafficHash();
  for (const e of entries) h.add(e);
  return h;
}
