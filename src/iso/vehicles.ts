// ══════════════════════════════════════════════════════════════════════════
// RV-01 — Road vehicles: the TTD goods lorry that SHOWS a road connection.
//
// When a Depot reaches a Factory by ROAD the economy already knows the route
// (`economy.resolveConnection` → `linkedBy` over owner-scoped components).
// This module turns that fact into one little truck per SERVICED DEPOT that
// drives the exact tile route — depot → factory → depot, forever, ping-ponging
// at the ends — so the map explains itself: a connected network has traffic
// on it, a broken one goes quiet. Each truck is bound to its depot and never
// switches to another; on every network change the routes are re-planned, so
// each lorry re-routes to whatever is now the closest path for its depot.
// The truck changes no economy outcome; it is presentation with a contract,
// and the contract is that it finds the SAME route the flood scores by (and
// that a depot placed beside a town's ring road gets its route over the
// public network just like a depot beside a highway — RV-03).
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
import { depotShoulders, plantShoulders, roadPath } from "./road-routing";
import { DEPOT_SIZE, depotContains, lotTileBeside } from "./depot";
import { factoryFootprintOf } from "./grid";
export { roadPath } from "./road-routing";
import type { DrawItem } from "./depth";
import type { EconomyState } from "./economy";
import {
  buildAllComponents, isServiced, resolveConnection, type Components,
  type Harvester,
} from "./economy";
import { depotRate, distanceFactor } from "./loop";
import { gradeOf, uphillSpeed } from "./slopes";
import {
  NE, SE, SW, NW, tIdx,
} from "./track";

/**
 * Tiles per millisecond on GRAVEL: one tile every 600 ms. Dirt is free to lay
 * now, so what it costs the player is the lorry's time — half the pace it used
 * to run at, and a quarter of what the same lorry does on tarmac.
 */
export const TRUCK_SPEED = 1 / 600;
/** AI-02: a lorry over PAVED road (`track.road`) moves FOUR times as fast as
 *  one over gravel — so a route is Σ(segment × (paved ? 1/4 : 1)) of its dirt
 *  time, segment by segment. Tarmac keeps the pace it always had (150 ms a
 *  tile); it is the free gravel that slowed to 600 ms, so paving a lane is now
 *  the whole motivation-to-upgrade the free dirt took away. */
export const TRUCK_ROAD_MULT = 4;
/**
 * How long a lorry stands on the depot lot before it turns around: it drives
 * in through the entrance, stops on the first lot tile to load, and only then
 * flips and pulls out again. A beat of stillness is what reads as "loading" —
 * a lorry that bounced off the end looked like it had missed the turn.
 */
export const DEPOT_LOAD_MS = 1000;

/** One truck on one route. Position along the route is `leg + t` tiles. */
export interface Truck {
  /** Track-owner id whose network this truck drives (players are ≥ 1). */
  ownerId: number;
  /** The Depot this lorry belongs to — it never switches to another one. */
  depotId: number;
  /**
   * A1: the Factory tile at the far end of the route — where the load is
   * delivered. Kept on the truck so a delivery knows where to show its "+N"
   * without re-deriving the connection.
   */
  factory: [number, number];
  /** Road tiles from the depot's shoulder to the factory's shoulder. */
  route: [number, number][];
  /** Index of the route tile the truck is leaving. */
  leg: number;
  /** 0..1 progress from `route[leg]` toward the next tile. */
  t: number;
  /** false = heading depot→factory, true = heading back. */
  reverse: boolean;
  /**
   * The Depot lot's origin tile, so the drawing pass can lift the lorry over
   * the depot building it is standing inside (`truckItems`). Absent on a
   * record that came off the wire before the game re-attached it.
   */
  depot?: [number, number];
  /**
   * Milliseconds still to stand at the depot end before pulling out. Counted
   * down by `tickTrucks` ahead of any movement, so a big frame cannot skip
   * the stop.
   */
  waitMs?: number;
  /** AI-02: per-SEGMENT speed flag — segFast[k] for route[k]→route[k+1] says
   *  the paved multiplier applies. Recomputed with every `planTrucks`, so an
   *  upgraded tile speeds its lorry up from the next dispatch. Old saves /
   *  pre-AI-02 call sites without it drive at the uniform dirt pace. */
  segFast?: boolean[];
  /**
   *  E4 (#268): per-SEGMENT grade — the SIGNED levels the drawn surface rises
   *  from route[k] to route[k+1] (`gradeOf` in slopes.ts). `tickTrucks` slows
   *  the lorry down on whichever segments it is climbing, in the direction it
   *  is driving, so the pace follows the hill: forwards up the slope, back
   *  down it. 0 on every segment of a flat map, which is why an option-off map
   *  behaves exactly as it did. Absent on old saves / hand-built trucks.
   */
  segClimb?: number[];
  /**
   * L7 (#221): the depot's effective tick-rate product (`yield × distance ×
   * transport`) stamped onto the lorry. `tickTrucks` multiplies `TRUCK_SPEED`
   * by this, so a busy depot's lorry looks busy and a far, poorly-tuned one
   * crawls. Derived presentation — not economic state. Absent / non-positive
   * (old saves, hand-built test trucks) drives at 1, the pre-L7 pace.
   */
  rateMult?: number;
  /**
   * A1: how many times this lorry has REACHED THE FACTORY END — one delivery
   * each. The game reads it against the count it last saw, so a delivery is
   * an event, never a poll: the token lands on a gem at exactly the frame the
   * lorry arrives.
   */
  deliveries: number;
}

export interface TruckState {
  trucks: Truck[];
}

export const createTruckState = (): TruckState => ({ trucks: [] });

/**
 * Shortest ROAD route from a specific Depot to its owner's connected Factory.
 *
 * This is the SAME route the economy scores (`resolveConnection` → ``kind:
 * "road"``) and the route the lorry drives: it walks `roadPath` from the
 * depot's shoulders to the connected factory's shoulders over `trackOpenTo`
 * tiles (own + public, never the rival's — W2), crossing only mutual bits.
 *
 * PP-15: the plant end is `plantShoulders` — every road tile touching ANY tile
 * of the factory's footprint. The lorry pulls up at the side of the building
 * the road joins, which is the tile the player can actually see and click.
 *
 * `comp` is optional so callers that already built the owner's components
 * (the game's hover overlay, `planTrucks`) do not pay a second flood. Returns
 * null when the depot is unserviced, rail-only (`trains are not this ticket`),
 * or has no road route to any of its factories — exactly the set of depots
 * that get no truck.
 */
export function roadRouteForHarvester(
  eco: EconomyState, h: Harvester, comp?: Components,
): [number, number][] | null {
  return roadDeliveryForHarvester(eco, h, comp)?.route ?? null;
}

/**
 * A1: the route AND the factory it delivers to.
 *
 * `roadRouteForHarvester` above is the thin wrapper every existing caller
 * wants (the pacing probe, the hover overlay); this one is what the game
 * needs to turn an arrival into a delivery, because "the lorry got there" is
 * only half the fact — the other half is WHERE it got to.
 */
export function roadDeliveryForHarvester(
  eco: EconomyState, h: Harvester, comp?: Components,
): { route: [number, number][]; factory: { tx: number; ty: number } } | null {
  const c = comp ?? buildAllComponents(eco.track, h.ownerId);
  if (!isServiced(eco.track, h)) return null;
  const conn = resolveConnection(eco, c, h);
  if (conn.kind === null || !conn.factory) return null;
  // The lorry drives on whichever tier the connection used — a Dirt Road or a
  // paved Road (public roads included). `roadPath` with no kind routes over
  // the tier each tile actually carries.
  const route = roadPath(
    eco.track, h.ownerId,
    depotShoulders(eco.track, h.ownerId, h),
    new Set(plantShoulders(eco.track, h.ownerId, conn.factory.tx, conn.factory.ty, conn.factory.rot ?? 0, factoryFootprintOf(eco.grid))
      .map(([x, y]) => tIdx(x, y))),
  );
  if (!route) return null;
  // The lorry loads ON the lot: the route starts on the depot tile just inside
  // the entrance it uses, so it drives in through the gate, stops to load, and
  // drives back out the same way.
  const lot = lotTileBeside(h.tx, h.ty, route[0]);
  if (lot) route.unshift(lot);
  return { route, factory: { tx: conn.factory.tx, ty: conn.factory.ty } };
}

/**
 * One truck per SERVICED DEPOT (RV-03): every depot with a ROAD connection to
 * its owner's factory gets its own lorry on its own closest route. A truck is
 * bound to its depot — it never switches to another one — but on every network
 * change `planTrucks` is re-run, so each depot's lorry re-routes to whatever
 * is now the closest path. A rail-only connection gets no truck (trains are
 * not this ticket); a depot with no road route at all gets none either.
 */
export function planTrucks(eco: EconomyState): Truck[] {
  const out: Truck[] = [];
  const paved = ([x, y]: [number, number]): boolean => eco.track.road[tIdx(x, y)] !== 0;
  for (const h of eco.harvesters) {
    if (h.ownerId <= 0) continue;
    if (h.platformId !== undefined) continue;     // a platform's freight goes by train
    const plan = roadDeliveryForHarvester(eco, h);
    if (!plan) continue;
    // AI-02: a segment is fast when either of its tiles is paved; public and
    // town roads are paved by construction (see track.ts), so driving the
    // public network also earns the bonus — same rule the economy scores by.
    const segFast = plan.route.slice(0, -1).map(
      (a, k) => paved(a) || paved(plan.route[k + 1]));
    // E4 (#268): the grade of every segment, off the DRAWN surface (slopes.ts).
    const segClimb = plan.route.slice(0, -1).map(
      (a, k) => gradeOf(eco.grid, a, plan.route[k + 1]));
    out.push({
      ownerId: h.ownerId,
      depotId: h.id,
      factory: [plan.factory.tx, plan.factory.ty],
      route: plan.route,
      segFast,
      segClimb,
      depot: [h.tx, h.ty],
      rateMult: depotRate(h, distanceFactor(eco, h)),
      leg: 0, t: 0, reverse: false, waitMs: 0, deliveries: 0,
    });
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
 *
 * `blocked` is the protest set: tile indices no lorry may ENTER. A truck
 * whose next tile is blocked holds exactly where it is — it does not
 * re-route, it waits — and rolls on once the road clears. Nothing else about
 * the truck changes (in particular no delivery is counted for a road it never
 * finished), so a hold is purely lost time, which is the sabotage.
 */
/** L7 (#221): the live rate scale. Absent / non-positive → 1 (pre-L7 pace). */
export function truckRateMultOf(truck: Truck): number {
  const r = truck.rateMult;
  return typeof r === "number" && Number.isFinite(r) && r > 0 ? r : 1;
}

export function tickTrucks(state: TruckState, dtMs: number, blocked?: ReadonlySet<number>): void {
  if (dtMs <= 0) return;
  for (const truck of state.trucks) {
    const max = truck.route.length - 1;
    if (max < 1) { truck.leg = 0; truck.t = 0; continue; }
    const rate = truckRateMultOf(truck);
    // E4 (#268): `reverse` is passed in because the GRADE is signed: the lorry
    // is slower on the segments it is climbing and keeps its pace on the flat
    // and the way down, so the same segment is slow one way and quick the other.
    const speed = (k: number, reverse: boolean): number => {
      const climb = truck.segClimb?.[k] ?? 0;
      return TRUCK_SPEED * rate * (truck.segFast?.[k] ? TRUCK_ROAD_MULT : 1)
        * uphillSpeed(reverse ? -climb : climb);
    };
    // AI-02: integrate SEGMENT BY SEGMENT at each segment's own pace — the
    // triangle-fold over a uniform axis would be exact only when every leg
    // has the same speed. The loop still folds exactly at both ends (a huge
    // tick turns the truck around at the exact end tile, never a teleport).
    // A1: turning around at the FAR end is the delivery — one arrival is one
    // delivery, counted here and read by the game on the same frame.
    let ms = dtMs;
    // Frame-capped dt makes this ~1 iteration; tests with a large dt loop at
    // most dt/segment-time.
    while (ms > 1e-9) {
      // Standing at the depot, loading: the clock runs, the lorry does not.
      if (truck.waitMs && truck.waitMs > 0) {
        const use = Math.min(ms, truck.waitMs);
        truck.waitMs -= use;
        ms -= use;
        if (truck.waitMs > 0) break;
        continue;
      }
      const k = Math.min(truck.leg, max - 1);
      // A protest holds the lorry BEFORE the blocked tile: it may not enter,
      // but a truck already standing on the boundary (t at the edge) still
      // completes its arrival or turn, so a crowd landing under a stopped
      // truck never wedges it mid-leg.
      if (blocked && blocked.size > 0) {
        if (!truck.reverse) {
          const nxt = truck.route[k + 1];
          if (truck.t < 1 && nxt && blocked.has(tIdx(nxt[0], nxt[1]))) break;
        } else {
          const cur = truck.route[k];
          if (truck.t > 0 && cur && blocked.has(tIdx(cur[0], cur[1]))) break;
        }
      }
      const v = speed(k, truck.reverse);
      if (!truck.reverse) {
        const need = (1 - truck.t) / v;
        if (ms < need) { truck.t += ms * v; ms = 0; continue; }
        ms -= need;
        if (k === max - 1) { truck.reverse = true; truck.t = 1; truck.deliveries++; }
        else { truck.leg = k + 1; truck.t = 0; }
      } else {
        const need = truck.t / v;
        if (ms < need) { truck.t -= ms * v; ms = 0; continue; }
        ms -= need;
        if (k === 0) { truck.reverse = false; truck.t = 0; truck.waitMs = DEPOT_LOAD_MS; }
        else { truck.leg = k - 1; truck.t = 1; }
      }
    }
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

/**
 * The four screen headings a lorry can face, and the ONLY names either livery
 * family needs: the legacy OpenGFX cells are `truck_goods_<view>` (shipped in
 * `assets/iso-atlas/manifest.json`) and the branded ones are
 * `truck_<brand>_<view>` (`assets/vehicles/`). One key, two families, so a
 * heading can never exist for one art set and be missing from the other.
 * A route step is exactly one of these — `stepBit` returns no other bit.
 */
export const TRUCK_VIEW: Record<number, "ne" | "se" | "sw" | "nw"> = {
  [NE]: "ne", [SE]: "se", [SW]: "sw", [NW]: "nw",
};

/** Who owns which livery: the player drives the blue lorries, everyone else red. */
export const truckBrand = (ownerId: number): "blue" | "red" =>
  ownerId === 1 ? "blue" : "red";

/** `atlas.has` is all `truckItems` needs — see the doc on `truckSpriteName`. */
export interface TruckSpriteSource { has(name: string): boolean }

/**
 * The sprite name for one truck on one leg: `truck_<brand>_<view>`, and the
 * legacy `truck_goods_<view>` whenever the branded art is not in the atlas.
 *
 * The probe is what keeps this non-gating. `assets/vehicles/` is installed at
 * runtime by `loadVehicleLayers` (see `vehicle-art.ts`), so between the first
 * frame and that promise resolving — and forever after on a checkout without
 * the art — `truck_blue_se` simply is not a sprite, and a draw item naming it
 * would draw NOTHING (not the lorry in the wrong livery: nothing at all). Asking
 * the atlas is one `in` check per truck per tick, and it means the fallback and
 * the upgrade are the same code path. With no atlas passed at all (tools, unit
 * tests) the legacy names are the answer, because that is the only set whose
 * presence is guaranteed by `assets/iso-atlas/manifest.json`.
 */
export function truckSpriteName(
  ownerId: number, dirBit: number, atlas?: TruckSpriteSource,
): string {
  // `stepBit` only ever returns one of the four, so the default is unreachable
  // from the game — but a truck must never be dropped for a bad bit, and a
  // one-tile route already faces SE for exactly that reason.
  const view = TRUCK_VIEW[dirBit] ?? "se";
  const branded = `truck_${truckBrand(ownerId)}_${view}`;
  return atlas && atlas.has(branded) ? branded : `truck_goods_${view}`;
}

/**
 * The trucks as draw items: FRACTIONAL tile position between route-tile
 * centres, the directional lorry for the current leg in its owner's livery,
 * and the rounded tile in `tx`/`ty` for culling. `depth.place` anchors a
 * moving item at the fractional tile's diamond centre; `pickSprite` skips such
 * items.
 */
export function truckItems(state: TruckState, atlas?: TruckSpriteSource): DrawItem[] {
  const out: DrawItem[] = [];
  for (const truck of state.trucks) {
    const { route, leg, t } = truck;
    const a = route[leg], b = route[Math.min(leg + 1, route.length - 1)];
    const fx = a[0] + (b[0] - a[0]) * t;
    const fy = a[1] + (b[1] - a[1]) * t;
    const sprite = truckSpriteName(truck.ownerId, stepBit(route, leg, truck.reverse), atlas);
    if (!sprite) continue;
    out.push({
      sprite,
      tx: Math.round(fx), ty: Math.round(fy),
      fx, fy,
      // A lorry loading ON the lot drives INTO the depot's own 2×2 block, and
      // a 2×2 building keys off its front corner — so on the back tiles the
      // depot would paint over the lorry parked in its yard. Lift the lorry
      // just past the building's key while it is inside the lot: the exact
      // gap, so nothing else on the map changes order.
      ...(truck.depot ? { lift: depotLift(truck.depot, fx, fy) } : {}),
    });
  }
  return out;
}

/**
 * How far a lorry standing inside the lot at `depot` must be lifted to draw
 * over the depot building — 0 when it is off the lot or already in front.
 */
function depotLift([dx, dy]: [number, number], fx: number, fy: number): number {
  const tx = Math.round(fx), ty = Math.round(fy);
  if (!depotContains(dx, dy, tx, ty)) return 0;
  const buildingKey = (dx + DEPOT_SIZE[0] - 1) + (dy + DEPOT_SIZE[1] - 1);
  const truckKey = tx + ty + 0.5;
  return Math.max(0, buildingKey - truckKey + 0.25);
}
