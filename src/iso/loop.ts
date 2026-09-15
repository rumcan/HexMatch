/**
 * New-loop tuning seams. Later L issues replace these implementations.
 *
 * L2 (#216) MVP: `transportFactor` is 1.0 for road — the clock pays
 * `baseRate × yield × distance × 1.0` on any road connection. The 1.6× rail
 * factor from the L2 spec is post-MVP (rail stays behind its DEV flag until
 * its pricing lands); when it does, this function reads the depot's line.
 */
import type { Harvester } from "./economy";
import { TUNING } from "./config";
import { clampYield } from "./tuning";

/**
 * L4 (#218) — the depot's yield level: the one number a tuning session sets
 * and the L1b clock multiplies a connected depot's cargo by.
 *
 * An ABSENT level is the baseline (`TUNING.minYield`) — an untuned depot, a
 * rival depot from before the redesign, or a save/snapshot written before the
 * field existed. A present one is clamped, so a hand-edited save or a stale
 * wire frame can never multiply the economy by something absurd.
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
