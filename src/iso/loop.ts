/**
 * New-loop tuning seams. Later L issues replace these implementations.
 *
 * L2 (#216) MVP: `transportFactor` is 1.0 for road — the clock pays
 * `baseRate × yield × distance × 1.0` on any road connection. The 1.6× rail
 * factor from the L2 spec is post-MVP (rail stays behind its DEV flag until
 * its pricing lands); when it does, this function reads the depot's line.
 *
 * L3 (#217): `distanceFactor` is the banded road-distance multiplier — the
 * lorry's own route length (`depotPathLength` in economy.ts) read off
 * `DISTANCE` in config.ts. Near depots tick at the full rate, far ones at
 * half. Post-MVP (#221 L7) may retune the bands or fit a smooth falloff, and
 * makes the lorries' speed match the rate; the clock reads only this module.
 */
import type { Components, ConnKind, EconomyState, Harvester } from "./economy";
import { depotPathLength, resolveConnection } from "./economy";
import { DISTANCE, TUNING } from "./config";
import { clampYield } from "./tuning";

/**
 * L6 (#220) — the transport tier, i.e. what "this Depot got upgraded" is
 * counted in.
 *
 * Only the tiers you PAY for are a step up. An unconnected Depot and a Depot on
 * free gravel are the SAME tier, because since L2 (#216) dirt roads are free —
 * if merely connecting counted as an upgrade, every Depot would come with a
 * second session for the price of laying the road the tutorial tells you to lay,
 * and Normal's "one match per depot and per upgrade" would quietly become "two
 * per depot". Paving to a Road is the first real upgrade, and it is worth
 * exactly one re-tune. L2's rail tier and L5's `baseRate` city upgrades — what
 * the ticket actually calls a "city upgrade" — extend this list by one step
 * each, and each step is one credit; nothing else has to know about them.
 *
 * The tier is derived from the world rather than stored, so a save or a
 * snapshot needs no new field to answer it and a re-tune credit cannot be
 * forged by editing a number. `tuning.retuneOwed` compares it against the tier
 * the Depot's last session settled on (`Harvester.tuneTier`).
 */
export const TRANSPORT_TIERS = ["base", "paved"] as const;
export type TransportTier = (typeof TRANSPORT_TIERS)[number];

/** The upgrade tier a connection kind is worth. 0 = nothing paid for yet. */
export const transportTierOf = (kind: ConnKind | null | undefined): number =>
  kind === "road" ? TRANSPORT_TIERS.indexOf("paved") : 0;

/**
 * L6 (#220) / L14 (#229): the tier a DEPOT stands on, derived from the world
 * rather than stored — see the note above on why that is the whole point.
 *
 * One function for every reader, so the player's re-match credit
 * (`retuneCandidates` in game.ts), the rival's simulated session and the race
 * harness's seats cannot disagree about what "this Depot got upgraded" means.
 * The caller passes the components it already built (a scan over a seat's
 * Depots is one flood fill, never one per Depot).
 */
export function depotTransportTier(
  state: EconomyState, comp: Components, depot: Harvester,
): number {
  return transportTierOf(resolveConnection(state, comp, depot).kind);
}

/**
 * L4 (#218) — the depot's yield level: the one number a tuning session sets
 * and the L1b clock multiplies a connected depot's cargo by.
 *
 * An ABSENT level is the baseline (`TUNING.minYield`) — an untuned depot, a
 * rival depot from before the redesign, or a save/snapshot written before the
 * field existed. A present one is clamped, so a hand-edited save or a stale
 * wire frame can never multiply the economy by something absurd.
 *
 * The clamp is against the SHIPPED range and not the live difficulty's: an Easy
 * Depot's raised `minYield` is what a session MAPS onto (see `tuningYieldFor`),
 * never a floor that rewrites a level arriving from another game. Holding a
 * level DOWN is `tuning.decayYield`'s job, and it floors at its own row.
 */
export function depotYield(depot: Harvester): number {
  return clampYield(depot.yield ?? TUNING.minYield);
}

/** L3 (#217): the distance bands — the names the inspector prints. */
export type DistanceBand = "near" | "mid" | "far";

/**
 * L3 (#217): which band a route length falls in. `null` (no road route to any
 * owned plant) is no band at all — the inspector prints "no route" for it
 * rather than a factor.
 */
export function distanceBandForPath(tiles: number | null): DistanceBand | null {
  if (tiles === null || !Number.isFinite(tiles)) return null;
  if (tiles <= DISTANCE.nearTiles) return "near";
  if (tiles <= DISTANCE.midTiles) return "mid";
  return "far";
}

/**
 * L3 (#217): the banded tick-rate multiplier for a route length in tiles.
 *
 * `null` — no road route — reads as the FULL rate, not zero: the clock's
 * `harvesterYield` gate already pays an unconnected Depot nothing, so the
 * factor must not invent a second gate. The inspector prints "no route" for
 * null rather than a factor, so the player never sees a ×1.0 that earns
 * nothing.
 */
export function distanceFactorForPath(tiles: number | null): number {
  return DISTANCE[distanceBandForPath(tiles) ?? "near"];
}

/**
 * L3 (#217): this depot's tick-rate multiplier, measured live off the
 * network — the shortest road run to its nearest owned plant, banded. The
 * live game reads it through a per-network cache in game.ts (one BFS per
 * depot per network change, never per tick); this is the uncached rule the
 * cache, the race harness and the tests share.
 */
export function distanceFactor(eco: EconomyState, depot: Harvester): number {
  return distanceFactorForPath(depotPathLength(eco, depot));
}

export function transportFactor(_depot: Harvester): number {
  return 1;
}
