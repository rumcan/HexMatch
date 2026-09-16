/**
 * New-loop tuning seams. Later L issues replace these implementations.
 *
 * L2 (#216) MVP: `transportFactor` is 1.0 for road — the clock pays
 * `baseRate × yield × distance × 1.0` on any road connection. The 1.6× rail
 * factor from the L2 spec is post-MVP (rail stays behind its DEV flag until
 * its pricing lands); when it does, this function reads the depot's line.
 */
import type { ConnKind, Harvester } from "./economy";
import { TUNING } from "./config";
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

export function distanceFactor(_depot: Harvester): number {
  return 1;
}

export function transportFactor(_depot: Harvester): number {
  return 1;
}
