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
import type { EconomyState, Harvester } from "./economy";
import { depotPathLength } from "./economy";
import { DISTANCE, TUNING } from "./config";
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
