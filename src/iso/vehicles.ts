// ══════════════════════════════════════════════════════════════════════════
// RV-01 — Road vehicles: the TTD goods lorry that SHOWS a road connection.
//
// When a Depot reaches a Factory by ROAD the economy already knows the route
// (`economy.resolveConnection` → `linkedBy` over owner-scoped components).
// This module turns that fact into one little truck per player that drives
// the exact tile route — depot → factory → depot, forever, ping-ponging at
// the ends — so the map explains itself: a connected network has traffic on
// it, a broken one goes quiet. The truck changes no economy outcome; it is
// presentation with a contract, and the contract is that it finds the SAME
// route the flood scores by.
//
// The route finder (`roadPath`) walks the same graph the economy floods:
//   * tiles `trackOpenTo` admits — the player's own track plus the map's
//     PUBLIC highways (PP-13), never the rival's (W2) — so a Depot and a
//     Factory parked on opposite sides of a highway, with no player-laid
//     road at all, still get their truck;
//   * edges only where BOTH tiles face each other (E5's mutual-bit
//     invariant), so a half-autotiled stub never carries traffic.
//
// Motion is position-along-route in tile units with reflection folding, so
// ping-pong is exact at any dt (a huge tick folds through the turn, it does
// not teleport). Positions stay fractional in TILE space; `depth.place`
// pins a moving sprite's anchor to the fractional tile's diamond centre.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W } from "../game/config";
import type { DrawItem } from "./depth";
import type { EconomyState } from "./economy";
import { buildAllComponents, isServiced, resolveConnection } from "./economy";
import {
  DIR, DIRS, NE, SE, SW, NW, OPPOSITE, bitsAt, tIdx, inMapT, trackOpenTo,
  type Track,
} from "./track";

/** Tiles per millisecond: one tile every 300 ms — RV-02: doubled. */
export const TRUCK_SPEED = 1 / 300;

/** One truck on one route. Position along the route is `leg + t` tiles. */
export interface Truck {
  /** Track-owner id whose network this truck drives (players are ≥ 1). */
  ownerId: number;
  /** Road tiles from the depot's shoulder to the factory's shoulder. */
  route: [number, number][];
  /** Index of the route tile the truck is leaving. */
  leg: number;
  /** 0..1 progress from `route[leg]` toward the next tile. */
  t: number;
  /** false = heading depot→factory, true = heading back. */
  reverse: boolean;
}

export interface TruckState {
  trucks: Truck[];
}

export const createTruckState = (): TruckState => ({ trucks: [] });

// ── the route finder ──────────────────────────────────────────────────────
/**
 * Shortest road route from any tile in `from` to any tile index in `goals`,
 * over the tiles `owner` may drive, crossing only mutually facing bits.
 * Multi-source BFS with parents — the same graph the economy's component
 * flood walks, but returning the actual tiles. Null when no route exists.
 */
export function roadPath(
  track: Track, owner: number,
  from: [number, number][], goals: Set<number>,
): [number, number][] | null {
  if (goals.size === 0 || from.length === 0) return null;
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
      if (!(bitsAt(track, "road", x, y) & d)) continue;      // we face it
      const nx = x + DIR[d][0], ny = y + DIR[d][1];
      if (!inMapT(nx, ny)) continue;
      if (!(bitsAt(track, "road", nx, ny) & OPPOSITE[d])) continue;  // it faces back
      const ni = tIdx(nx, ny);
      if (parent.has(ni)) continue;
      if (!trackOpenTo(track, owner, nx, ny)) continue;      // W2 + PP-13
      parent.set(ni, cur);
      queue.push(ni);
    }
  }
  return null;
}

// ── planning: connection → truck ──────────────────────────────────────────
/** Road tiles 4-adjacent to (tx,ty) that `owner` may drive on. */
const shoulders = (track: Track, owner: number, tx: number, ty: number) => {
  const out: [number, number][] = [];
  for (const d of DIRS) {
    const nx = tx + DIR[d][0], ny = ty + DIR[d][1];
    if (trackOpenTo(track, owner, nx, ny)) out.push([nx, ny]);
  }
  return out;
};

/**
 * One truck per player: the first (stable network order) serviced Depot
 * whose connection to one of its owner's factories is a ROAD connection,
 * routed along the actual tiles the connection flood found. A rail-only
 * connection gets no truck (trains are not this ticket); a Depot with no
 * road route at all gets none either. Returns [] when nobody is connected.
 */
export function planTrucks(eco: EconomyState): Truck[] {
  const out: Truck[] = [];
  const owners = [...new Set(
    eco.harvesters.filter((h) => h.ownerId > 0).map((h) => h.ownerId),
  )].sort((a, b) => a - b);
  for (const ownerId of owners) {
    const comp = buildAllComponents(eco.track, ownerId);
    for (const h of eco.harvesters) {
      if (h.ownerId !== ownerId) continue;
      if (!isServiced(eco.track, h)) continue;
      const conn = resolveConnection(eco, comp, h);
      if (conn.kind !== "road" || !conn.factory) continue;
      const route = roadPath(
        eco.track, ownerId,
        shoulders(eco.track, ownerId, h.tx, h.ty),
        new Set(shoulders(eco.track, ownerId, conn.factory.tx, conn.factory.ty)
          .map(([x, y]) => tIdx(x, y))),
      );
      if (!route) continue;
      out.push({ ownerId, route, leg: 0, t: 0, reverse: false });
      break;   // one truck per player
    }
  }
  return out;
}

// ── the clock ─────────────────────────────────────────────────────────────
/**
 * Advance every truck by `dtMs`, reflecting off both ends of its route so
 * it is always driving — depot → factory → depot. The truck's position is
 * carried as PHASE along a triangle wave (distance travelled, folded by
 * reflection), so a huge tick turns the truck around at the exact end tile
 * instead of pinning it there or teleporting it.
 */
export function tickTrucks(state: TruckState, dtMs: number): void {
  if (dtMs <= 0) return;
  for (const truck of state.trucks) {
    const max = truck.route.length - 1;
    if (max < 1) { truck.leg = 0; truck.t = 0; continue; }
    const span = 2 * max;
    // current phase on the fold axis: forward leg+t, backward mirrored
    const phase = truck.reverse ? span - (truck.leg + truck.t) : truck.leg + truck.t;
    const fold = ((phase + TRUCK_SPEED * dtMs) % span + span) % span;
    const p = fold <= max ? fold : span - fold;     // reflected into [0, max]
    const leg = Math.min(max - 1, Math.floor(p));
    truck.leg = leg;
    truck.t = p - leg;
    truck.reverse = fold > max;
  }
}

// ── drawing ───────────────────────────────────────────────────────────────
/** Track-bit of the step a truck is currently driving, signed for direction. */
function stepBit(route: [number, number][], leg: number, reverse: boolean): number {
  const a = route[leg], b = route[Math.min(leg + 1, route.length - 1)];
  const sign = reverse ? -1 : 1;
  const dx = (b[0] - a[0]) * sign, dy = (b[1] - a[1]) * sign;
  if (dx > 0) return SE;
  if (dx < 0) return NW;
  if (dy > 0) return SW;
  if (dy < 0) return NE;
  return SE;   // degenerate single-tile route: face somewhere sensible
}

const SPRITE_OF: Record<number, string> = {
  [NE]: "truck_goods_ne", [SE]: "truck_goods_se",
  [SW]: "truck_goods_sw", [NW]: "truck_goods_nw",
};

/**
 * The trucks as draw items: FRACTIONAL tile position between route-tile
 * centres, the directional TTD lorry for the current leg, and the rounded
 * tile in `tx`/`ty` for culling. `depth.place` anchors a moving item at the
 * fractional tile's diamond centre; `pickSprite` skips such items.
 */
export function truckItems(state: TruckState): DrawItem[] {
  const out: DrawItem[] = [];
  for (const truck of state.trucks) {
    const { route, leg, t } = truck;
    const a = route[leg], b = route[Math.min(leg + 1, route.length - 1)];
    const fx = a[0] + (b[0] - a[0]) * t;
    const fy = a[1] + (b[1] - a[1]) * t;
    const sprite = SPRITE_OF[stepBit(route, leg, truck.reverse)];
    if (!sprite) continue;
    out.push({
      sprite,
      tx: Math.round(fx), ty: Math.round(fy),
      fx, fy,
    });
  }
  return out;
}
