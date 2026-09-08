// ══════════════════════════════════════════════════════════════════════════
// PP-05 — Construction costs: ONE authoritative table for buildings.
//
// The ticket: "Every paid, newly built Depot must require Oil alongside its
// other construction materials. Show the complete cost before placement.
// Apply the same cost to player actions, AI decisions and multiplayer
// validation."
//
// Before this module a Depot cost nothing at all — `placeHarvester` had a
// `_free` parameter it never read, so the player, the AI and the inspector
// each had their own idea of what a Depot was worth (free, free, and unstated).
// That is the same bug class W3 fixed for track ("the drag and the AI share
// one cost model"), so the rule lives in exactly one place and every surface
// asks it:
//
//   placeHarvester (game.ts)   the human click AND the host's authority in a
//                              multiplayer room — the relay in server/server.js
//                              does not simulate, so the host running this
//                              rule IS the multiplayer validation.
//   planCandidates /
//   executeCandidate (ai.ts)   the rival prices the Depot into the plan it
//                              can afford and pays it in `spent`.
//   tileProbe (game.ts)        the read-only legality answer the e2e corridor
//                              picker and the debug console read.
//   the HUD (ui.ts)            the Build button and the modebar show the same
//                              numbers the placement will charge.
//
// Oil is the point of the ticket: it is the cargo whose only source is an Oil
// Rig, so it gives Depot expansion a real dependency instead of a stone sink.
// Oil earned in the Processing Plant lands in the same purse this prices
// against (`earn` in game.ts writes `purse.oil`), so processed Oil is valid
// construction stock — no separate "delivered" balance exists.
//
// PP-07's rebalance extends THIS table (it asks for "one authoritative table
// used by the UI, gameplay and AI"); nothing else in the codebase prices a
// building, so the rebalance is a one-line change here.
// ══════════════════════════════════════════════════════════════════════════
import { CARGO, CARGOES, type Cargo } from "./config";
import { type Purse } from "./track";

/**
 * The authoritative construction-cost table.
 *
 * PP-05 puts Oil on the Depot. It deliberately changes no other entry: the
 * Depot previously cost nothing, so "alongside its other construction
 * materials" is satisfied by Oil being the material a paid Depot requires.
 * PP-07 (the Catan-style rebalance) owns the wider numbers — add its proposed
 * Wood/Stone/Grain here and every surface below follows automatically.
 */
export const BUILD_COSTS: Readonly<Record<"depot", Purse>> = {
  depot: { oil: 1 },
};

/** What a PAID Depot costs — the single source of the Depot's price. */
export const DEPOT_COST: Purse = BUILD_COSTS.depot;

/**
 * PP-05's setup exception, and the answer to "the opening cannot become
 * impossible because Oil production itself requires a Depot": the FIRST Depot
 * a player builds is free. Without it the opening is a deadlock — Oil needs a
 * Depot, the Depot needs Oil — so the allowance is what makes the second
 * Depot a real decision instead of an unwinnable state.
 *
 * Like `FREE_SETUP_TRACK` it is DATA on the player record (`freeDepots` in
 * game.ts), never inferred from the phase: that is E8's K1 rule, and it means
 * a refused placement can never silently burn the allowance.
 */
export const FREE_SETUP_DEPOTS = 1;

/** A Depot price, fully resolved against one purse. */
export interface DepotPrice {
  /** What the placement deducts. Empty while the setup allowance covers it. */
  cost: Purse;
  /** True when this Depot rides on the setup allowance. */
  free: boolean;
  /** `cost` can be paid in full. */
  affordable: boolean;
  /** The cargoes the purse is short of, in `CARGOES` order. */
  missing: Cargo[];
  /** Setup allowance left once this Depot is built. */
  freeLeft: number;
}

/**
 * Price a Depot against a purse and the owner's remaining free allowance.
 *
 * Pure and side-effect free: the caller decides whether to spend. Because the
 * same call prices the HUD label, the placement and the AI plan, "what you see"
 * and "what you are charged" are one number — the W1 invariant, applied to
 * buildings instead of track.
 */
export function priceDepot(purse: Purse, freeDepots: number): DepotPrice {
  const left = Math.max(0, Math.floor(freeDepots));
  const free = left > 0;
  const cost: Purse = free ? {} : { ...DEPOT_COST };
  const missing: Cargo[] = free
    ? []
    : CARGOES.filter((c) => (DEPOT_COST[c] ?? 0) > (purse[c] ?? 0));
  return {
    cost,
    free,
    affordable: missing.length === 0,
    missing,
    freeLeft: free ? left - 1 : left,
  };
}

/** Cargoes in the fixed display order, dropping zero/negative entries. */
const entriesOf = (cost: Purse): Cargo[] =>
  CARGOES.filter((c) => (cost[c] ?? 0) > 0);

/** The complete cost, spelled out: "1 🛢️ Oil". Empty cost → "free". */
export const costLabel = (cost: Purse): string => {
  const parts = entriesOf(cost).map((c) => `${cost[c]} ${CARGO[c].icon} ${CARGO[c].name}`);
  return parts.length ? parts.join(" + ") : "free";
};

/** The complete cost, compact for a button: "1🛢️". Empty cost → "free". */
export const costCompact = (cost: Purse): string => {
  const parts = entriesOf(cost).map((c) => `${cost[c]}${CARGO[c].icon}`);
  return parts.length ? parts.join(" ") : "free";
};

/**
 * What a player is short of, as a sentence fragment: "1 🛢️ Oil". Only the
 * missing part of `DEPOT_COST`, so the refusal names the actual blocker
 * instead of restating a cost the HUD already shows.
 */
export const shortfallLabel = (missing: Cargo[]): string =>
  costLabel(Object.fromEntries(missing.map((c) => [c, DEPOT_COST[c] ?? 0])));

/**
 * The Depot's Build-button label: the setup allowance while it lasts, then the
 * full cost. "Show the complete cost before placement" — the player reads the
 * price before the first click, not after a refusal.
 */
export const depotButtonLabel = (freeDepots: number): string =>
  freeDepots > 0
    ? `free setup · then ${costCompact(DEPOT_COST)}`
    : `${costCompact(DEPOT_COST)} · on industry`;
