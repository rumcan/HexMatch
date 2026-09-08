// ══════════════════════════════════════════════════════════════════════════
// PP-07 — Rebalance construction and expansion using Catan-style resource
// roles. ONE authoritative cost table for every construction/expansion
// purchase; the UI, the gameplay charge and the AI all read from here, so
// the price a button shows, the price a click charges and the price the
// rival plans with can never drift apart.
//
// Resource roles (the ticket's design goal):
//   Wood + Stone — basic infrastructure (road, every building's skeleton).
//   Grain        — workforce and expansion (depots, processing plants).
//   Ore          — industrial investment and better transport (rail).
//   Oil          — Depot expansion (every paid Depot).
//   Gold         — Black Market sabotage ONLY (PP-08; no construction cost
//                  here may contain gold — `tests/unit/iso-costs.test.ts`
//                  enforces that).
//
// The numbers are the ticket's "suggested first playtest costs" — starting
// proposals, pinned by the playtest simulation in
// `tests/unit/iso-progression.test.ts` and the report under
// `docs/playtest-reports/`. Tune them there, nowhere else.
//
// This module has NO runtime imports (the `Cargo` type only), so it can sit
// at the bottom of the iso module graph: `config.ts` (TRANSPORT/UPGRADE_COST),
// `plants.ts` (PLANT_COST), `ai.ts`, `game.ts` and the UI all import from it
// and nothing in the chain can form a cycle.
// ══════════════════════════════════════════════════════════════════════════
import type { Cargo } from "./config";

/** A construction cost: cargo → units required. */
export type Cost = Partial<Record<Cargo, number>>;

/** Every purchase the table prices, keyed by its build action. */
export type BuildKey =
  | "road"              // one road tile
  | "rail"              // one NEW rail tile (not over road)
  | "upgradeRoadToRail" // in-place road → rail upgrade (the difference)
  | "depot"             // every PAID Depot (the first setup Depot is free)
  | "plant";            // an additional processing plant beside a town

/**
 * THE authoritative construction cost table (PP-07).
 *
 *   Road tile                    1 Wood + 1 Stone
 *   Rail tile                    1 Wood + 1 Stone + 4 Ore
 *   Upgrade Road to Rail         4 Ore
 *   Additional Depot             1 Wood + 1 Stone + 1 Grain + 1 Oil
 *   Additional Processing Plant  2 Wood + 2 Stone + 2 Grain + 3 Ore
 *
 * Keep every entry free of Gold — Gold is reserved for Black Market
 * sabotage (PP-08).
 */
export const BUILD_COSTS: Record<BuildKey, Cost> = {
  road: { wood: 1, stone: 1 },
  rail: { wood: 1, stone: 1, ore: 4 },
  upgradeRoadToRail: { ore: 4 },
  depot: { wood: 1, stone: 1, grain: 1, oil: 1 },
  plant: { wood: 2, stone: 2, grain: 2, ore: 3 },
};

/**
 * PP-07 setup exception (the ticket's "no endless dependency loop" rule,
 * matching PP-05's proposed exception): the FIRST Depot of a player is free —
 * it is placed during setup, before any income exists, and Oil production
 * itself needs a Depot, so charging Oil for the very first one would make the
 * opening impossible. Every Depot after the first pays `BUILD_COSTS.depot`.
 *
 * `ownedDepots` is the number of Depots the player ALREADY has. Both the
 * human click path (`game.ts placeHarvester`) and the rival (`ai.ts
 * executeCandidate`) ask this one function, so the two can never disagree
 * about which Depot is the free one.
 */
export const depotCharge = (ownedDepots: number): Cost =>
  ownedDepots > 0 ? { ...BUILD_COSTS.depot } : {};

/** Does this Depot cost anything? (i.e. is it beyond the free first one?) */
export const depotIsPaid = (ownedDepots: number): boolean => ownedDepots > 0;
