// ══════════════════════════════════════════════════════════════════════════
// FLEET-1 (#595) — buy trucks (and the pure rules the Fleet card, the host
// intent and the rival share).
//
// A Depot comes with ONE lorry. `Harvester.trucks` (absent = 1) says how many
// run its route, capped at `FLEET.maxTrucks`. This module is deliberately a
// leaf (types + config + perkPrice only) so vehicles.ts, ambience.ts, the game
// and the AI can all import it without a cycle.
// ══════════════════════════════════════════════════════════════════════════
import { BUILD_COSTS_MONEY, FLEET } from "./config";
import { perkPrice, type ManagerId } from "./managers";
import type { Harvester } from "./economy";

/** The lorry count of a Depot: absent, junk or out-of-range reads as the legal clamp. */
export function truckCountOf(h: { trucks?: number | undefined }): number {
  const n = h.trucks;
  if (typeof n !== "number" || !Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(FLEET.maxTrucks, Math.floor(n)));
}

/** Unique numeric id of one lorry: slot 0 keeps the bare depot id (old saves, tests). */
export const truckKey = (t: { depotId: number; slot?: number }): number =>
  t.depotId + (t.slot ?? 0) * 1_000_000;

/** What `n` lorries multiply a Depot's income clock by (1 lorry = x1). */
export function fleetLoadFactor(h: { trucks?: number | undefined }): number {
  const n = truckCountOf(h);
  return FLEET.truckLoadMult[n - 1] ?? n;
}

/** Base $ (before any perk) of the truck that would take the fleet from `count` to `count + 1`. */
export function nextTruckBase(count: number): number {
  const mult = FLEET.truckPriceMult[Math.max(0, count - 1)]
    ?? FLEET.truckPriceMult[FLEET.truckPriceMult.length - 1] ?? 1;
  return Math.round(BUILD_COSTS_MONEY.truck * mult);
}

/** What this seat pays for the next truck on a Depot with `count` lorries (James: road perk). */
export const truckBuyPrice = (count: number, manager: ManagerId | null | undefined): number =>
  perkPrice(nextTruckBase(count), manager, "road");

/** One-time 50% refund of the LAST truck bought (the one taking the fleet from `count` to `count - 1`). */
export const truckSellRefund = (count: number, manager: ManagerId | null | undefined): number =>
  Math.floor(truckBuyPrice(count - 1, manager) * 0.5);

export interface TruckBuyCheck { ok: boolean; why?: string; price: number }

/**
 * The refusal ladder for "Buy truck", in the order the player should hear it.
 * `roadConnected` is the caller's `roadRouteForHarvester(...) !== null` (kept
 * out of here so this file stays a leaf).
 */
export function truckBuyCheck(
  h: Harvester | undefined, ownerId: number, roadConnected: boolean,
  money: number, manager: ManagerId | null | undefined,
): TruckBuyCheck {
  if (!h || h.ownerId !== ownerId) return { ok: false, why: "That is not your Depot.", price: 0 };
  const count = truckCountOf(h);
  const price = truckBuyPrice(count, manager);
  if (h.platformId !== undefined) return { ok: false, why: "A platform's freight goes by train.", price };
  if (h.closed) return { ok: false, why: "This Depot is closed.", price };
  if (count >= FLEET.maxTrucks) return { ok: false, why: `This Depot already runs ${FLEET.maxTrucks} trucks.`, price };
  if (!roadConnected) return { ok: false, why: "Connect this Depot to a Factory by road first.", price };
  if (money < price) return { ok: false, why: `Not enough money - a truck costs $${price}.`, price };
  return { ok: true, price };
}

/** Why a truck cannot be sold (null = it can). The first lorry is the Depot's own. */
export const truckSellRefusal = (h: Harvester | undefined, ownerId: number): string | null =>
  !h || h.ownerId !== ownerId ? "That is not your Depot."
    : truckCountOf(h) <= 1 ? "The Depot's first truck is not for sale."
      : null;
