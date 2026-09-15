/** New-loop tuning seams. Later L issues replace these implementations. */
import type { Harvester } from "./economy";

export function depotYield(depot: Harvester): number {
  return depot.yield ?? 1;
}

export function distanceFactor(_depot: Harvester): number {
  return 1;
}

export function transportFactor(_depot: Harvester): number {
  return 1;
}
