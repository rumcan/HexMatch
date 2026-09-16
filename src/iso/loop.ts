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
 * half. (Retuning the bands or fitting a smooth falloff is still open, but the
 * clock reads only this module, so it stays a one-table change.)
 *
 * L7 (#221): `depotTickRate` is the whole product above as ONE number, so the
 * clock that pays a depot and the lorry that drives its route are scaled
 * identically — the lorry is visual, but its pace is the rate.
 */
import type { ConnKind, EconomyState, Harvester } from "./economy";
import { depotPathLength } from "./economy";
import { BASE_RATE, DISTANCE, TUNING } from "./config";
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

/**
 * L7 (#221) — THE depot's effective tick rate: the whole factor the L1b clock
 * multiplies a connected depot's cargo by,
 *
 *   `BASE_RATE × yield × distance × transport`
 *
 * — the ticket's `yield × distance × transport` shorthand, with `BASE_RATE`
 * (the units one tick is worth, 1) making it a rate rather than a bare
 * multiplier.
 *
 * It exists so that "the depot's rate" is ONE number with ONE definition. The
 * clock reads it with the distance factor it has cached; `vehicles.ts` is
 * handed the very same number for the depot's lorry, so the pace on the map and
 * the cargo in the purse are scaled by the same value and cannot drift apart.
 *
 * The caller supplies the distance factor — the live game from its per-network
 * cache (`distanceInfoFor`), the harnesses from `distanceFactor(eco, depot)` —
 * because measuring it is a BFS and each caller already knows how often it can
 * afford one.
 *
 * Note what is NOT in here: the per-cargo amounts (`harvesterYield`'s industry
 * output and the connection tier's own multiplier). Those multiply the cargo a
 * depot delivers, per industry; this is the depot's clock, which is the axis
 * the redesign's speed rule follows.
 */
export function depotTickRate(depot: Harvester, distance: number): number {
  return BASE_RATE * depotYield(depot) * distance * transportFactor(depot);
}

/**
 * L7 (#221): the same rate measured straight off the network — one BFS, the
 * uncached rule the game's distance cache reproduces and the headless
 * harnesses (and the tests) can call. `null` distance (no road route) reads as
 * the full factor, exactly as `distanceFactorForPath` documented: the clock's
 * `harvesterYield` gate already pays an unconnected depot nothing.
 */
export function liveTickRate(eco: EconomyState, depot: Harvester): number {
  return depotTickRate(depot, distanceFactor(eco, depot));
}
