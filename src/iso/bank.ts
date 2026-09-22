// ══════════════════════════════════════════════════════════════════════════
// L11 (#226) — THE BANK: the one exchange, and the rung it may not skip.
//
// The bank is a REBALANCER, restored by L17 (#245) at the owner's 3:1:
//
//   • it may never skip a rung. A cargo is exchangeable at a seat only when
//     its `DEPOT_TREE` row is at or below the rungs that seat has UNLOCKED
//     (`unlockTierAfterSession`, L4): rung 0 grain/wood, rung 1 stone/ore,
//     rung 2 oil/gold. A seat with two rungs has earned every cargo it can
//     convert into, so the exchange can only rebalance what the tree already
//     gave it;
//   • the rate is 3:1 (`BANK_RATE`, ONE constant here — the owner's
//     "bring back the bank at 3:1", balancing still open) so it is a rebalance,
//     never the cheap route around a tree the player has not climbed;
//   • Gold is outside it entirely (PP-08): it is the Black Market's currency
//     and pays for nothing else, in either direction, on both seats.
//
// The gate is DATA, passed in as `unlocked`. The shipped loop has no tree —
// `DEPOT_TREE` prices nothing there and no rung can ever be earned — so its
// callers pass no `unlocked` and the bank keeps exactly the behaviour it had
// before L11 landed: everything but Gold. The new loop passes the seat's
// `depotTier`, which is the same number `priceDepot` gates a build with.
//
// Pure and purse-shaped: the caller owns the balance, this module never keeps
// a copy of it. One owner, one rule, every caller (`game.ts` for the click,
// the host's intent validation and the HUD's affordability line).
// ══════════════════════════════════════════════════════════════════════════
import { CARGOES, DEPOT_TREE, DEPOT_RUNG_GATE, type Cargo } from "./config";

/** A purse with every cargo key present — the shape the bank arithmetic needs. */
export type CargoBag = Record<Cargo, number>;

export const emptyBag = (): CargoBag =>
  Object.fromEntries(CARGOES.map((c) => [c, 0])) as CargoBag;

/** Fill in the cargo keys a partial purse (e.g. `START_PURSE`) leaves out. */
export const toBag = (purse: Partial<Record<Cargo, number>>): CargoBag => ({
  ...emptyBag(), ...purse,
});

/** The bank's rate: give this many of one cargo, receive 1 of another.
 *  L17 (#245): 3 — the owner's "bring back the bank at 3:1" (was 4). */
export const BANK_RATE = 3;

/** The one cargo no exchange in the game touches (PP-08). */
export const SABOTAGE_ONLY: readonly Cargo[] = ["gold"];

/** The rung of `DEPOT_TREE` a cargo sits on — what the bank's gate reads. */
export const bankTier = (cargo: Cargo): number => DEPOT_TREE[cargo].tier;

/**
 * L11 (#226): may a seat that has unlocked `unlocked` RUNG(s) exchange this
 * cargo at all — in either direction?
 *
 * `null` (the shipped loop, and any caller with no tree in play) means "no
 * rungs to check": every cargo but Gold is exchangeable, which is the rule
 * the game shipped with. Gold is never exchangeable, at any rung: it is the
 * Black Market's money (PP-08) and it is refused here rather than left to a
 * caller to remember.
 */
export function bankAllowed(cargo: Cargo, unlocked: number | null): boolean {
  if (SABOTAGE_ONLY.includes(cargo)) return false;
  // The rung gate is off (DEPOT_RUNG_GATE): with every Depot needing ore and
  // oil, a rung-0 bank that could not make them would soft-lock the opening.
  if (unlocked === null || !DEPOT_RUNG_GATE) return true;
  return bankTier(cargo) <= Math.max(0, Math.floor(unlocked));
}

export interface BankOptions {
  /**
   * L11 (#226): the rungs of `DEPOT_TREE` the seat has unlocked. Omitted or
   * null = the shipped loop, where no tree applies (see `bankAllowed`).
   */
  unlocked?: number | null;
  /** Override the rate (the legacy tests' 1:1 called it 1). */
  rate?: number;
}

/**
 * Bank exchange: give `rate` of one cargo from `purse`, get 1 of another.
 * Refuses a self-trade, Gold, anything the seat has not unlocked, and a purse
 * that cannot cover the lot — leaving the balance untouched in every refusal.
 */
export function bankTrade(
  purse: CargoBag,
  give: Cargo, want: Cargo,
  opts: BankOptions = {},
): boolean {
  if (give === want) return false;
  const rate = opts.rate ?? BANK_RATE;
  if (rate <= 0) return false;
  const unlocked = opts.unlocked ?? null;
  if (!bankAllowed(give, unlocked) || !bankAllowed(want, unlocked)) return false;
  if ((purse[give] ?? 0) < rate) return false;
  purse[give] = (purse[give] ?? 0) - rate;
  purse[want] = (purse[want] ?? 0) + 1;
  return true;
}

/** Is this string one of the six cargos the tree prices? */
export const isCargo = (k: string): k is Cargo => (CARGOES as readonly string[]).includes(k);
