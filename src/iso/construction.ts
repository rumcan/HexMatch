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
// PP-07's rebalance landed here: BUILD_COSTS is declared once in config.ts
// (the lowest import layer, so track/config/plants can all read it without a
// cycle) and re-exported above, so this module is still the import every
// caller already uses. Nothing else in the codebase prices a building.
//
// L5 (#219) layered the DEPOT TREE on top without moving that seam: a Depot's
// price is now the price of its TYPE (the cargo of the industry it serves),
// read from `DEPOT_TREE` in config.ts, and the type is also what gates it
// behind the rungs the seat has unlocked. `priceDepot` takes the type and the
// seat's rung as optional data and every caller above passes them, so "what you
// see" is still the one number the click charges — it is just a different
// number per industry now. With no type (the shipped loop, a caller that has
// not picked a site yet) it prices PP-07's single mix exactly as before.
// ══════════════════════════════════════════════════════════════════════════
import {
  BUILD_COSTS, CARGO, CARGOES, DEPOT_TREE, DEPOT_TIER_MAX, TOWN_UPGRADES,
  type Cargo, type DepotTypeDef, type TownUpgradeDef,
} from "./config";
import { type Purse } from "./track";

export { BUILD_COSTS };

/** The shipped loop's one-size Depot price (PP-07's 1/1/1/1 mix). */
export const DEPOT_COST: Purse = BUILD_COSTS.depot;

/**
 * L5 (#219): the depot TYPE an industry's cargo builds — the tree row for a
 * cargo. Every cargo has one, so a caller that knows the industry always knows
 * the price (and the rung) the click will use.
 */
export const depotTypeFor = (cargo: Cargo): DepotTypeDef => DEPOT_TREE[cargo];

/** L5: the Depot price table for a type — the tree under `newLoop`, PP-07's
 *  one mix on the shipped loop. */
export function depotCostFor(cargo: Cargo | null | undefined, newLoop = false): Purse {
  return newLoop && cargo ? { ...DEPOT_TREE[cargo].cost } : DEPOT_COST;
}

/** L5: the rung a type sits on. No type (shipped loop) reads as the bottom. */
export const depotTierFor = (cargo: Cargo | null | undefined): number =>
  cargo ? DEPOT_TREE[cargo].tier : 0;

/** L5: the cheapest type a seat may build right now — what the HUD quotes. */
export function cheapestDepotType(unlocked: number, newLoop = false): DepotTypeDef {
  if (!newLoop) return DEPOT_TREE.grain;
  const open = (Object.values(DEPOT_TREE) as DepotTypeDef[])
    .filter((t) => t.tier <= unlocked);
  const pool = open.length ? open : [DEPOT_TREE.grain];
  return pool.reduce((best, t) => {
    const a = Object.values(t.cost).reduce((n, v) => n + v, 0);
    const b = Object.values(best.cost).reduce((n, v) => n + v, 0);
    return a < b ? t : best;
  });
}

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
 *
 * L5 (#219) keeps it type-blind on purpose: the free Depot is the one the
 * SEEDED MAP hands you (whatever industry stands nearest), which is the
 * Catan-style opening the ticket asks for. Every Depot after it pays its
 * type's mix and needs its rung unlocked.
 */
export const FREE_SETUP_DEPOTS = 1;

/** A Depot price, fully resolved against one purse and one seat's tree. */
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
  /**
   * L5 (#219): the depot type this price is for (null = the shipped loop's
   * single mix, or a caller that has not picked a site).
   */
  type: DepotTypeDef | null;
  /** L5: the type's rung. */
  tier: number;
  /**
   * L5: true when the seat has not unlocked this type's rung yet — the
   * placement is refused for progression, not for money, and the refusal has
   * to say which (the two are different toasts).
   */
  locked: boolean;
  /** L5: the rungs this seat has unlocked (echoed for the callers' copy). */
  unlocked: number;
}

/** L5: everything `priceDepot` needs beyond the purse and the allowance. */
export interface DepotPriceOptions {
  /** The cargo of the industry this Depot would serve (its type). */
  cargo?: Cargo | null;
  /** The rungs the seat has unlocked. Omitted = 0 (a fresh seat). */
  tier?: number;
  /** Price from `DEPOT_TREE` (the new loop) instead of `BUILD_COSTS.depot`. */
  newLoop?: boolean;
}

/**
 * Price a Depot against a purse, the owner's remaining free allowance and
 * (L5) the rung it would need.
 *
 * Pure and side-effect free: the caller decides whether to spend. Because the
 * same call prices the HUD label, the placement and the AI plan, "what you see"
 * and "what you are charged" are one number — the W1 invariant, applied to
 * buildings instead of track.
 */
export function priceDepot(
  purse: Purse, freeDepots: number, opts: DepotPriceOptions = {},
): DepotPrice {
  const newLoop = opts.newLoop === true;
  const cargo = opts.cargo ?? null;
  const unlocked = Math.max(0, Math.floor(opts.tier ?? 0));
  // L5 (#219): under the new loop a Depot ALWAYS has a type, so a caller that
  // has not picked a site yet (the Build column, the debug price readout, the
  // rival's "what would my next Depot cost" planner) is quoted the CHEAPEST
  // type the seat can build right now — the same number `depotButtonLabel`
  // prints, and never PP-07's flat mix, which the tree does not use.
  const type = newLoop ? (cargo ? DEPOT_TREE[cargo] : cheapestDepotType(unlocked, true)) : null;
  const table = type ? type.cost : DEPOT_COST;
  const tier = type ? type.tier : 0;
  const locked = type !== null && tier > unlocked;
  const left = Math.max(0, Math.floor(freeDepots));
  const free = left > 0;
  const cost: Purse = free ? {} : { ...table };
  const missing: Cargo[] = free
    ? []
    : CARGOES.filter((c) => (table[c] ?? 0) > (purse[c] ?? 0));
  return {
    cost,
    free,
    affordable: missing.length === 0,
    missing,
    freeLeft: free ? left - 1 : left,
    type,
    tier,
    locked,
    unlocked,
  };
}

/**
 * L5 (#219): what the NEXT city upgrade costs and is worth, priced against the
 * seat's purse. One row of `TOWN_UPGRADES` ships in the MVP; the reader is a
 * table walk, so later rows need no code.
 */
export interface TownUpgradePrice {
  /** The row being bought, or null when the city is at its top level. */
  def: TownUpgradeDef | null;
  /** What the upgrade costs (the row's table). */
  cost: Purse;
  affordable: boolean;
  missing: Cargo[];
  /** Levels already bought. */
  level: number;
  /** True when there is nothing left to buy. */
  maxed: boolean;
}

export function priceTownUpgrade(purse: Purse, level: number): TownUpgradePrice {
  const rows = TOWN_UPGRADES;
  const def = level >= rows.length ? null : rows[Math.max(0, Math.floor(level))];
  if (!def) {
    return { def: null, cost: {}, affordable: false, missing: [], level, maxed: true };
  }
  const cost: Purse = { ...def.cost };
  const missing: Cargo[] = CARGOES.filter((c) => (cost[c] ?? 0) > (purse[c] ?? 0));
  return { def, cost, affordable: missing.length === 0, missing, level, maxed: false };
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
 * missing part of the price the caller quoted, so the refusal names the actual
 * blocker instead of restating a cost the HUD already shows.
 */
export const shortfallLabel = (missing: Cargo[], cost: Purse = DEPOT_COST): string =>
  costLabel(Object.fromEntries(missing.map((c) => [c, cost[c] ?? 0])));

/**
 * The Depot's Build-button label.
 *
 * Shipped loop: the setup allowance while it lasts, then PP-07's one mix.
 * L5 (#219, `newLoop`): the price depends on the industry you stand beside, so
 * the button quotes the CHEAPEST type the seat can build right now and says
 * where the real number comes from — the tile you hover, which the modebar's
 * cost line spells out.
 */
export const depotButtonLabel = (freeDepots: number, opts: { newLoop?: boolean; tier?: number } = {}): string => {
  if (opts.newLoop === true) {
    const cheap = costCompact(cheapestDepotType(Math.max(0, Math.floor(opts.tier ?? 0)), true).cost);
    return freeDepots > 0
      ? `free setup · then from ${cheap}`
      : `from ${cheap} · by industry`;
  }
  return freeDepots > 0
    ? `free setup · then ${costCompact(DEPOT_COST)}`
    : `${costCompact(DEPOT_COST)} · on industry`;
};

/**
 * L5 (#219): the complete price line for a Depot placement at a site whose
 * type is known — "2 🪵 Wood + 2 🌾 Grain". Used by the modebar's cost readout
 * and the refused-placement toast, so the two always agree.
 */
export const depotTypeLabel = (type: DepotTypeDef | null): string =>
  type ? type.name : "Depot";

/** The rung a seat may build up to, as a human sentence: "2 rungs unlocked". */
export const rungLabel = (unlocked: number): string =>
  `${Math.min(unlocked, DEPOT_TIER_MAX)}/${DEPOT_TIER_MAX} rungs unlocked`;
