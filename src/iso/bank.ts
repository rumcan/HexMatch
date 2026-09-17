// ══════════════════════════════════════════════════════════════════════════
// L11 (#226) — THE BANK: the one exchange left, and the rung it may not skip.
//
// Until this ticket a player had two ways to turn one cargo into another: the
// 4:1 bank, and player-to-player OFFERS. Both broke L5
// (#219)'s tree. L5's whole point is "you need wood to unlock stone, stone to
// unlock ore…", and a bank that trades anything for anything lets a seat with
// a pile of Wood buy Oil or Gold — the deepest row of `DEPOT_TREE` — without
// ever playing a tuning session for the rung that unlocks it. The rival could
// do it too, and so could two humans through the offer board.
//
// The ticket's Option A, decided and shipped here: THE OFFER BOARD IS GONE
// (with its escrow, its expiry clock, its rival policy and its wire fields)
// and the bank is kept as a REBALANCER —
//
//   • it may never skip a rung. A cargo is exchangeable at a seat only when
//     its `DEPOT_TREE` row is at or below the rungs that seat has UNLOCKED
//     (`unlockTierAfterSession`, L4): rung 0 grain/wood, rung 1 stone/ore,
//     rung 2 oil/gold. A seat with two rungs has earned every cargo it can
//     convert into, so the exchange can only rebalance what the tree already
//     gave it;
//   • the rate stays steep (4:1, `BANK_RATE`) so it is a last resort, never
//     the cheap route around a tree the player has not climbed;
//   • Gold is outside it entirely (PP-08): it is the Black Market's currency
//     and pays for nothing else, in either direction, on both seats.
//
// The gate is DATA, passed in as `unlocked`. The shipped loop has no tree —
// `DEPOT_TREE` prices nothing there and no rung can ever be earned — so its
// callers pass no `unlocked` and the bank keeps exactly the behaviour it had
// before this landed: everything but Gold. The new loop passes the seat's
// `depotTier`, which is the same number `priceDepot` gates a build with.
//
// Pure and purse-shaped: the caller owns the balance, this module never keeps
// a copy of it. One owner, one rule, every caller (`game.ts` for the click,
// the host's intent validation and the HUD's affordability line).
// ══════════════════════════════════════════════════════════════════════════
import { CARGOES, DEPOT_TREE, type Cargo } from "./config";

/** A purse with every cargo key present — the shape the bank arithmetic needs. */
export type CargoBag = Record<Cargo, number>;

export const emptyBag = (): CargoBag =>
  Object.fromEntries(CARGOES.map((c) => [c, 0])) as CargoBag;

/** Fill in the cargo keys a partial purse (e.g. `START_PURSE`) leaves out. */
export const toBag = (purse: Partial<Record<Cargo, number>>): CargoBag => ({
  ...emptyBag(), ...purse,
});

/** The bank's rate: give this many of one cargo, receive 1 of another. */
export const BANK_RATE = 4;

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
  if (unlocked === null) return true;
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
