// ─────────────────────────────────────────────────────────────────────────────
// BAL-1 (#471) — the balance sim harness (not a test file; vitest only collects
// `tests/unit/**/*.test.ts`). A headless match runner in the `l1d-race`
// pattern (tests/unit/helpers/race.ts) with TWO differences the ticket asks
// for:
//
//   1. SCRIPTED PLAYER BOTS at three levels ("novice" / "steady" / "sharp")
//      drive the human seat — not the rival's own policy twice. Each bot is a
//      build order + a pair of clocks + a market policy, spelled out in
//      `BOTS` below so the numbers the report quotes are reproducible.
//   2. The MONEY economy (ECON-1, #421) is modelled end to end: builds cost
//      money (`moneyValueOf`, `BUILD_COSTS_MONEY`), income is cargo on the
//      clock, and both seats convert cargo to money on the seeded market
//      (`src/iso/market.ts`) — so the report can print money over time and
//      the win rates measure the game the lead actually ships.
//
// The RIVAL seat runs the live turn, seam for seam: `aiNewLoopTurn` in
// game.ts (connect → tune → spend → pave), paced by `RIVAL_SKILLS[key]`'s
// `buildMs` / `idleMs` / `sessionMs` (#297's session clock), and
// `rivalMarketTick`'s sell rule (`rivalSellLot`) every 5 s. Where the live
// turn charges money (`chargeBuild`, clamped at $0; `spendBuild` for paves)
// the harness charges exactly the same way; where it gates on goods
// (`aiBuildStep`'s `canAfford` on `rival.purse`) the harness gates the same.
//
// What is deliberately NOT simulated (both seats miss it equally, so the
// comparison stays fair): the match-3 board (sessions are SIMULATED off each
// seat's `tuningSkill`, exactly as the rival's are in game.ts), battles /
// holds (`VICTORY.loop.hold` is contested-site ★ — no battles in the sim, so
// it never pays), raids / sabotage / blockades, rail (flagged out of the live
// game) and dams (DAMS_ENABLED is false). The city upgrades run the shared
// seat-level rule (the race harness's `townPass` twin of `rivalTownStep`),
// not the multi-city bookkeeping.
//
// Determinism: no Math.random anywhere — the map, the market walk, the
// market events and the session results are all seeded functions of `(seed,
// time)`. The same seed + bot + difficulty replays the same match.
// ─────────────────────────────────────────────────────────────────────────────
import { generateMap } from "../../../src/iso/grid";
import {
  createTrack, seedTownRoads, seedPublicRoads, canAfford, addCost,
  type Purse, type Track,
} from "../../../src/iso/track";
import {
  aiBuildStep, chooseRivalFactorySpot, deepPlanCandidates, planBankTrades, planGoalPurchase, goalOutOfReach,
  executeCandidate, planUpgrades, executePaves, treeGoal, treeWants, scoreCargoWant,
  rivalPace,
  type Candidate, type PlanOptions,
} from "../../../src/iso/ai";
import { createRailState, type RailState } from "../../../src/iso/rail";
import {
  buildAllComponents, harvesterYield, industryLocks, ownerIdOf, isServiced,
  depotCargo, depotRoutePaved, heldIndustries, resolveConnection,
  type EconomyState, type Factory,
} from "../../../src/iso/economy";
import {
  depotTransportTier, depotYield, distanceFactor, transportFactor,
} from "../../../src/iso/loop";
import {
  decayYield, difficultyRulesFor, obstacleDrag, retuneOwed, rivalTuningScore,
  rivalTuningYield, sessionObstacles, settleTuningYield, townBonusFor,
  unlockTierAfterSession,
} from "../../../src/iso/tuning";
import {
  createScoreState, rescore, vpFor, hasWon, victoryBreakdown, type LoopScoring,
} from "../../../src/iso/victory";
import { addPlant, chooseAiPlantSpot, PLANT_COST } from "../../../src/iso/plants";
import {
  BASE_RATE, BASE_PRICE, TUNING, VICTORY, CARGOES, TOWN_UPGRADES, DEPOT_LEVELS,
  depotYieldCap, START_MONEY, moneyValueOf, type Cargo, type DifficultyRules,
} from "../../../src/iso/config";
import {
  createMarket, priceOf, movingAverage, rivalSellLot, sell, sellable, quoteBuy,
  type MarketState,
} from "../../../src/iso/market";
import {
  FREE_SETUP_DEPOTS, priceDepot, priceTownUpgrade, storageCapFor,
  DEPOT_RETUNE_COST,
} from "../../../src/iso/construction";
import {
  START_PURSE, FREE_SETUP_TRACK, HARVEST_MS, RIVAL_REMATCH_DROP,
} from "../../../src/iso/game";
import { toBag, type CargoBag } from "../../../src/iso/purse";
import { RIVAL_SKILLS, type RivalSkill, type SkillKey } from "../../../src/iso/skill";
import { MAP_W, MAP_H } from "../../../src/game/config";

export const STEP_MS = 1_000;
export const MIN = (ms: number) => `${(ms / 60_000).toFixed(1)}m`;
export const SELL_MS = 5_000;      // `rivalMarketTick`'s clock in game.ts

// ══════════════════════════════════════════════════════════════════════════
// THE PLAYER BOTS — the thing being measured against the rival's difficulties.
//
// A bot is three levers, same shape as `RIVAL_SKILLS` so the report can read
// both seats off one vocabulary:
//
//   clocks   buildMs / idleMs / sessionMs — how fast its hands are. The
//            session clock is the big one: a Depot (with its tune), a city
//            tier and a re-match each cost the PLAYER a real session on the
//            board, and `sessionMs` is how long one takes this bot.
//   quality  tuningSkill — the 0…1 axis every simulated session plays at,
//            through the SAME score→yield curve the rival's sessions use
//            (`settleTuningYield`, with the match difficulty's board rules).
//   market   the sell policy — how it converts cargo to the money every
//            BUILD is paid in. "dump" sells on sight (into every dip),
//            "average" is the rival's own rule (`rivalSellLot`, sell above
//            your recent average), "timing" waits for a 6% edge and dumps
//            only under storage pressure.
//
// The build order is scripted by priority through the SHARED planner (the
// same `deepPlanCandidates` ranking the rival plans from, steered by the
// tree's `wantCargo`): first Depot (free), then the tree's cheapest goal,
// plants for reach, city tiers when the reserve rule allows, then paving.
// That is what "a sensible build order" means here — a policy over the
// engine's own candidate list, not a hand-picked tile script that only works
// on one seed.
// ══════════════════════════════════════════════════════════════════════════
export type BotKey = "novice" | "steady" | "sharp";

export type SellPolicy = "dump" | "average" | "timing";

export interface BotProfile {
  key: BotKey;
  /** Reaction clock: ms between turns that achieved something. */
  buildMs: number;
  /** Retry clock after a turn that found nothing. */
  idleMs: number;
  /** One tuning session (a Depot's tune, a city tier, a re-match). */
  sessionMs: number;
  /** Session quality, 0…1 — the same axis as `RIVAL_SKILLS[].tuningSkill`. */
  tuningSkill: number;
  /** `planUpgrades` batch cap per pave turn. */
  paveTiles: number;
  /** Share of the next Depot's price kept in hand before buying a city tier. */
  townReserve: number;
  /** Bank trades per stalled turn (the goal's mix). */
  bankPerTurn: number;
  /** Market policy — see above. */
  sell: SellPolicy;
  /** Max units per sale lot (slippage is paid like everyone else's). */
  sellLot: number;
  /** The build order stops buying Processing Plants once it has this many. */
  plantCap: number;
}

export const BOTS: Record<BotKey, BotProfile> = {
  // "the first Depot, then slow" — casual hands, sells on sight, no timing.
  novice: {
    key: "novice", buildMs: 26_000, idleMs: 12_000, sessionMs: 135_000,
    tuningSkill: 0.35, paveTiles: 2, townReserve: 1.5, bankPerTurn: 1,
    sell: "dump", sellLot: 8, plantCap: 1,
  },
  // "a sensible build order" — steady hands, the rival's own market rule.
  steady: {
    key: "steady", buildMs: 13_000, idleMs: 5_000, sessionMs: 85_000,
    tuningSkill: 0.62, paveTiles: 6, townReserve: 1.0, bankPerTurn: 2,
    sell: "average", sellLot: 10, plantCap: 2,
  },
  // "an optimised build order with market timing" — quick hands, patient lots.
  sharp: {
    key: "sharp", buildMs: 8_000, idleMs: 2_500, sessionMs: 55_000,
    tuningSkill: 0.85, paveTiles: 10, townReserve: 0.7, bankPerTurn: 4,
    sell: "timing", sellLot: 12, plantCap: 2,
  },
};

// ══════════════════════════════════════════════════════════════════════════
// What one match reports.
// ══════════════════════════════════════════════════════════════════════════
export interface SeatStats {
  id: "you" | "ai";
  depots: number;
  plants: number;
  paves: number;
  /** Cargo sold on the market, and the $ it fetched. */
  soldUnits: number;
  soldRevenue: number;
  /** ms the seat first scored any ★. */
  firstPoint: number | null;
  /** Final purse, rounded — the report's "who ended rich". */
  money: number;
  /** The final ★ breakdown (`victoryBreakdown` off the live network). */
  stars: { types: number; routes: number; city: number; maxDepot: number };
  /** Why the seat paced the way it did — the report's stall column. */
  turns: {
    /** Turns that built, paved, bought or banked something. */
    acted: number;
    /** Turns that found nothing to do (idle clock). */
    idle: number;
    /** Turns where no plan was affordable at all (plan starvation). */
    broke: number;
  };
}

export interface TracePoint {
  t: number;
  youStar: number;
  aiStar: number;
  youMoney: number;
  aiMoney: number;
}

export interface BalanceMatch {
  seed: number;
  bot: BotKey;
  difficulty: SkillKey;
  /** The ★ line this match raced to (`VICTORY.loop.target`). */
  target: number;
  winner: "you" | "ai" | null;
  /** ms the match ended at (the win, or the window's end). */
  endMs: number;
  windowMs: number;
  trace: TracePoint[];
  you: SeatStats;
  ai: SeatStats;
}

export interface BalanceMatchOptions {
  /** Simulated horizon in in-game minutes. Default 25. */
  minutes?: number;
  /** Keep playing after the first win (diagnostics). Default false. */
  fullWindow?: boolean;
  /** Diagnostics hook: the final world and seats (used by probes). */
  onEnd?: (eco: EconomyState, seats: readonly SimSeat[]) => void;
}

export interface SimSeat {
  id: "you" | "ai";
  ownerId: number;
  /** The rival's preset; null for a bot seat. */
  skill: RivalSkill | null;
  bot: BotProfile | null;
  goods: CargoBag;
  money: number;
  freeTrack: number;
  freeDepots: number;
  depotTier: number;
  townLevel: number;
  townBonus: number;
  lastBuild: number;
  sessionUntil: number;
  lastHarvest: number;
  lastSell: number;
  carry: Partial<Record<Cargo, number>>;
  loopCarry: Map<number, number>;
  stats: SeatStats;
}

/**
 * The income cache — the harness twin of the live game's per-network rate
 * cache ("one BFS per depot per network change, never per tick"). Invalidated
 * whenever the world moves; `harvesterYield` only varies with time through
 * `banditUntil` (blockades), which the sim never applies.
 */
interface RateCache {
  version: number;
  rows: Map<number, { yields: Partial<Record<Cargo, number>>; factor: number }>;
  /** Per-owner network scans, valid until the world moves. */
  comp: Map<number, { components: ReturnType<typeof buildAllComponents>; locks: ReturnType<typeof industryLocks> }>;
}

/** `canPayBuild` (game.ts): a resource bill priced in money. */
const canPayBuild = (s: SimSeat, cost: Purse): boolean => s.money >= moneyValueOf(cost);

/** `spendBuild` (game.ts): strictly the money price, never the goods. */
const spendBuild = (s: SimSeat, cost: Purse): boolean => {
  const price = moneyValueOf(cost);
  if (s.money < price) return false;
  s.money -= price;
  return true;
};

/** `chargeBuild` (game.ts): the rival's charge, clamped at $0. */
const chargeBuild = (s: SimSeat, cost: Purse): void => {
  s.money = Math.max(0, s.money - moneyValueOf(cost));
};

/** `earn` (game.ts): income through the storage cap; above the cap is lost. */
const earn = (s: SimSeat, gain: Purse): void => {
  const cap = storageCapFor(s.townLevel);
  for (const [k, v] of Object.entries(gain) as [Cargo, number][]) {
    const held = s.goods[k] ?? 0;
    s.goods[k] = Math.max(held, Math.min(cap, held + v));
  }
};

/** `buildPurse` (game.ts): the money a seat holds, as goods at base prices. */
const buildPurse = (s: SimSeat): Purse =>
  Object.fromEntries(CARGOES.map((c) => [c, Math.floor(s.money / BASE_PRICE[c])])) as Purse;

/** The goods bill `aiBuildStep` would charge, depot row included. */
const planBill = (c: Candidate, opts: { purse: Purse; freeDepots: number; depotTier: number }): Purse =>
  addCost(c.cost, c.depotCost ?? priceDepot(opts.purse, opts.freeDepots, {
    tier: opts.depotTier, newLoop: true,
  }).cost);

/**
 * The stall guard, and the harness's one real speed-up: `aiBuildStep` plans
 * (a full A* sweep, ~0.2 s) to discover there is nothing affordable, and the
 * idle clock then asks again 1.8 s later. The memoized deep list
 * (`deepPlanCandidates`) answers "could ANY plan be affordable?" for ~1 ms,
 * and the answer cannot change until the purse or the world moves — so a
 * broke seat skips the planning call and loses nothing. Exact: any candidate
 * `aiBuildStep` could return passes `canAfford(purse, bill)`, and every such
 * candidate is in the deep list (the purse prunes, it does not create).
 */
function anyAffordable(
  eco: EconomyState, f: Factory, opts: PlanOptions,
): boolean {
  const purse = opts.purse ?? {};
  const cands = deepPlanCandidates(eco, f, {
    stock: opts.stock, free: opts.free, freeDepots: opts.freeDepots,
    depotTier: opts.depotTier, newLoop: opts.newLoop, wantCargo: opts.wantCargo,
    now: opts.now,
  });
  const probe = { purse, freeDepots: opts.freeDepots ?? 0, depotTier: opts.depotTier ?? 0 };
  return cands.some((c) => canAfford(purse, planBill(c, probe)));
}

function loopIncome(eco: EconomyState, seat: SimSeat, cache: RateCache, t: number): void {
  // The world moved since the last rate pass: rebuild it once, not per tick.
  if (cache.version !== worldVersion) {
    cache.version = worldVersion;
    cache.rows.clear();
    cache.comp.clear();
  }
  const ownerNum = ownerIdOf(eco, seat.id);
  let scans = cache.comp.get(ownerNum);
  if (!scans) {
    scans = { components: buildAllComponents(eco.track, ownerNum), locks: industryLocks(eco) };
    cache.comp.set(ownerNum, scans);
  }
  const { components, locks } = scans;
  for (const depot of eco.harvesters) {
    if (depot.owner !== seat.id) continue;
    let row = cache.rows.get(depot.id);
    if (!row) {
      const result = harvesterYield(eco, components, locks, depot, t);
      const factor = BASE_RATE * depotYield(depot) * distanceFactor(eco, depot) * transportFactor(depot);
      row = { yields: result.serviced ? result.yields : {}, factor: result.serviced ? factor : 0 };
      cache.rows.set(depot.id, row);
    }
    if (!row.factor) continue;
    const cargoes = Object.entries(row.yields) as [Cargo, number][];
    if (!cargoes.length) continue;
    const total = cargoes.reduce((sum, [, amount]) => sum + amount, 0) * row.factor
      * (1 + Math.max(0, seat.townBonus))
      + (seat.loopCarry.get(depot.id) ?? 0);
    const whole = Math.floor(total);
    seat.loopCarry.set(depot.id, total - whole);
    if (whole > 0) earn(seat, { [cargoes[0][0]]: whole });
  }
}

// The world's move counter — every build/pave/plant bumps it, invalidating the
// rate cache. Module-local because the seats mutate the map through shared
// helpers; one number is simpler than threading a context object everywhere.
let worldVersion = 0;
const worldMoved = (): void => { worldVersion++; };

/** The simulated session score one tune plays at (`rivalTuningScore`, by number). */
const sessionScoreFor = (tuningSkill: number, rules: DifficultyRules, tier: number): number => {
  const drag = obstacleDrag(sessionObstacles(rules, tier));
  const t = Math.min(1, Math.max(0, tuningSkill * (1 - drag)));
  return t * TUNING.targetScore;
};

/**
 * `applyRivalTuning` (game.ts) — every Depot a seat just raised takes its
 * seat's simulated session result (capped by the Depot's level), and a
 * session that ran opens the next tree rung. Idempotent: a Depot that has a
 * level is left alone.
 */
function tuneNewDepots(eco: EconomyState, seat: SimSeat): boolean {
  const rules = difficultyRulesFor(seat.skill ? seat.skill.key : "normal");
  const comp = buildAllComponents(eco.track, seat.ownerId);
  let simulated = false;
  for (const depot of eco.harvesters) {
    if (depot.owner !== seat.id) continue;
    const cooled = decayYield(depot.yield, rules);
    if (cooled !== null) depot.yield = cooled;
    if (depot.yield === undefined) {
      const tier = depotTransportTier(eco, comp, depot);
      const raw = seat.skill
        ? rivalTuningYield(seat.skill.key, 0, rules, tier)
        : settleTuningYield(undefined, sessionScoreFor(seat.bot!.tuningSkill, rules, tier), rules);
      depot.yield = Math.min(depotYieldCap(depot.level), raw);
      depot.tuneTier = tier;
      simulated = true;
    }
  }
  if (!simulated) return false;
  const before = seat.depotTier;
  seat.depotTier = unlockTierAfterSession(seat.depotTier, 1);
  return seat.depotTier > before;
}

/**
 * The city upgrade — the harness twin of `rivalTownStep` / the player's
 * confirmed tier: goods-priced (`priceTownUpgrade`), one tier per turn,
 * reserve-scaled by the seat's `townReserve`, skipped while a purse sits at
 * its storage cap (`wasting`), and settled at the seat's session score.
 */
function townPass(eco: EconomyState, seat: SimSeat, reserve: Purse, rules: DifficultyRules, tier0: number): boolean {
  const price = priceTownUpgrade(seat.goods, seat.townLevel);
  if (!price.def || !price.affordable) return false;
  if (!eco.harvesters.some((h) => h.owner === seat.id && isServiced(eco.track, h, eco.rail))) return false;
  const wasting = (Object.keys(price.cost) as Cargo[]).some((c) =>
    (seat.goods[c] ?? 0) >= storageCapFor(seat.townLevel));
  const covers = (want: Purse): boolean =>
    (Object.entries(want) as [Cargo, number][]).every(
      ([k, v]) => (seat.goods[k] ?? 0) - (price.cost[k] ?? 0) >= v);
  if (!wasting && !covers(reserve)) return false;
  for (const [k, v] of Object.entries(price.cost) as [Cargo, number][]) {
    seat.goods[k] = (seat.goods[k] ?? 0) - v;
  }
  seat.townLevel = Math.min(seat.townLevel + 1, TOWN_UPGRADES.length);
  const score = seat.skill
    ? rivalTuningScore(seat.skill.key)
    : sessionScoreFor(seat.bot!.tuningSkill, rules, tier0);
  seat.townBonus = townBonusFor(price.def.bonus, score);
  return true;
}

/**
 * The re-match (`rivalRetuneStep` in game.ts): a Depot that has actually
 * cooled gets the seat's fresh session number, but only when the session
 * would improve it. The rival pays nothing for it in game.ts — the harness
 * mirrors that exactly; a BOT pays `DEPOT_RETUNE_COST` in money, like the
 * player's Re-tune key.
 */
function retunePass(eco: EconomyState, seat: SimSeat, rules: DifficultyRules): boolean {
  if (!rules.matchEnabled) return false;
  const comp = buildAllComponents(eco.track, seat.ownerId);
  const due = eco.harvesters
    .filter((h) => h.owner === seat.id)
    .map((h) => {
      const tier = depotTransportTier(eco, comp, h);
      const level = depotYield(h);
      const fresh = seat.skill
        ? settleTuningYield(level, rivalTuningScore(seat.skill.key, 0, rules, tier), rules)
        : settleTuningYield(level, sessionScoreFor(seat.bot!.tuningSkill, rules, tier), rules);
      return { h, tier, level, fresh };
    })
    .filter(({ h, tier, level, fresh }) =>
      fresh > level + 1e-9
      && retuneOwed(rules, { tier, tuneTier: h.tuneTier })
      && level <= fresh * (1 - RIVAL_REMATCH_DROP))
    .sort((a, b) => a.level - b.level || a.h.id - b.h.id);
  const head = due[0];
  if (!head) return false;
  if (seat.bot && !spendBuild(seat, DEPOT_RETUNE_COST)) return false;
  head.h.yield = head.fresh;
  head.h.tuneTier = head.tier;
  return true;
}

/** The market clock: the rival's exact sell rule (game.ts's `rivalMarketTick`). */
function marketTick(market: MarketState, seat: SimSeat, t: number): void {
  if (t - seat.lastSell < SELL_MS) return;
  seat.lastSell = t;
  const upgrade = TOWN_UPGRADES[Math.min(seat.townLevel, TOWN_UPGRADES.length - 1)];
  const reserve = (upgrade?.cost ?? {}) as Purse;
  for (const cargo of CARGOES) {
    if (!sellable(cargo)) continue;
    const held = Math.floor(seat.goods[cargo] ?? 0);
    let lot = 0;
    if (seat.bot) {
      const policy = seat.bot.sell;
      const spare = held - Math.max(0, Math.floor(reserve[cargo] ?? 0));
      if (policy === "dump") {
        // Novice: cash out whatever is above the city reserve, at whatever
        // price the market pays — no edge, no timing.
        lot = spare > 0 ? Math.max(1, Math.min(spare, seat.bot.sellLot)) : 0;
      } else if (policy === "average") {
        lot = rivalSellLot(market, cargo, held, reserve[cargo] ?? 0, t,
          { maxLot: seat.bot.sellLot });
      } else {
        // Timing: hold out for a 6% edge over the good's own recent average;
        // a warehouse pressing the storage cap cashes out regardless.
        const spare2 = held - Math.max(0, Math.floor(reserve[cargo] ?? 0));
        const pressured = held >= storageCapFor(seat.townLevel) * 0.9;
        if (spare2 > 0 && (pressured || priceOf(market, cargo, t) >= movingAverage(market.seed, cargo, t) * 1.06)) {
          lot = Math.max(1, Math.min(spare2, seat.bot.sellLot));
        }
      }
    } else {
      lot = rivalSellLot(market, cargo, held, reserve[cargo] ?? 0, t);
    }
    if (lot <= 0) continue;
    const quote = sell(market, cargo, lot, t);
    if (quote.units <= 0) continue;
    seat.goods[cargo] = (seat.goods[cargo] ?? 0) - quote.units;
    seat.money += quote.revenue;
    seat.stats.soldUnits += quote.units;
    seat.stats.soldRevenue += quote.revenue;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// The turn. The rival's half is `aiNewLoopTurn` in game.ts, step for step;
// the bot's half is the same verbs a player has, prioritised the way a
// build order is described (plant guard → depot → tune → spend → pave).
// ══════════════════════════════════════════════════════════════════════════
interface TurnCtx {
  eco: EconomyState;
  market: MarketState;
  t: number;
  nextHarvesterId: number;
  factoryFor: (seat: SimSeat) => Factory;
  /** `bankBudget(rivalPaceNow())` (game.ts) — the rival's trade budget. */
  rivalBankBudget: number;
}

function depotStep(ctx: TurnCtx, seat: SimSeat, want: Cargo[], planOpts: {
  free: number; freeDepots: number; depotTier: number;
}): boolean {
  const { eco, factoryFor, t } = ctx;
  const f = factoryFor(seat);
  // The bot's plans are priced in MONEY (its builds cost money); the rival's
  // in goods (its `aiBuildStep` gates on `rival.purse`, then pays money) —
  // exactly the two rules game.ts runs.
  const purse: Purse = seat.bot ? buildPurse(seat) : seat.goods;
  const opts: PlanOptions = {
    stock: seat.goods, purse,
    free: planOpts.free, freeDepots: planOpts.freeDepots, now: t,
    newLoop: true, depotTier: planOpts.depotTier,
    wantCargo: want.length ? want : undefined,
  };
  if (!anyAffordable(eco, f, opts)) return false;
  if (seat.bot) {
    const cands = deepPlanCandidates(eco, f, {
      stock: seat.goods, free: planOpts.free, freeDepots: planOpts.freeDepots,
      depotTier: planOpts.depotTier, newLoop: true,
      wantCargo: want.length ? want : undefined, now: t,
    });
    const probe = { purse, freeDepots: planOpts.freeDepots, depotTier: planOpts.depotTier };
    for (const c of cands) {
      const bill = planBill(c, probe);
      if (moneyValueOf(bill) > seat.money) continue;
      const out = executeCandidate(eco, c, seat.id, seat.ownerId, ctx.nextHarvesterId,
        planOpts.free, planOpts.freeDepots, true);
      if (!out.built.length && !out.harvester) continue;
      spendBuild(seat, out.spent);          // the exact bill the tiles cost
      seat.freeTrack = Math.max(0, seat.freeTrack - out.free);
      seat.freeDepots = Math.max(0, seat.freeDepots - out.freeDepots);
      ctx.nextHarvesterId++;
      worldMoved();
      return true;
    }
    return false;
  }
  const out = aiBuildStep(eco, f, opts, ctx.nextHarvesterId);
  if (!out) return false;
  seat.freeTrack = Math.max(0, seat.freeTrack - out.free);
  seat.freeDepots = Math.max(0, seat.freeDepots - out.freeDepots);
  chargeBuild(seat, out.spent);             // game.ts's `chargeBuild`, clamped
  ctx.nextHarvesterId++;
  worldMoved();
  return true;
}

function plantStep(ctx: TurnCtx, seat: SimSeat, goalCost: Purse | null): boolean {
  const { eco } = ctx;
  const { grid, track } = eco;
  // game.ts: the plant may never eat the purse the next Depot's price needs.
  const withPlant = (base: Purse): Purse => addCost({ ...base }, PLANT_COST);
  const covers = (want: Purse, base: Purse): boolean =>
    (Object.entries(want) as [Cargo, number][]).every(([k, v]) => (base[k] ?? 0) >= v);
  if (goalCost) {
    if (seat.bot) {
      // A bot's builds cost MONEY: the goal and the plant must both fit.
      // The plant is the income engine (no plant, no distance band), so a
      // sensible build order takes it as soon as both fit — the opening
      // Depot first (free), the Plant next.
      if (seat.money < moneyValueOf(withPlant(goalCost))) return false;
    } else if (!covers(withPlant(goalCost), seat.goods)) {
      return false;
    }
  }
  // A build order stops at its plant budget — reach is a means, not a goal.
  if (seat.bot && seat.stats.plants >= seat.bot.plantCap) return false;
  if (!canPayBuild(seat, PLANT_COST)) return false;
  const spot = chooseAiPlantSpot(grid, track, eco, seat.id);
  if (!spot) return false;
  const plant = addPlant(grid, track, eco, seat.id, seat.ownerId, spot[0], spot[1], spot[2] ?? 0);
  if (!plant) return false;
  spendBuild(seat, PLANT_COST);
  seat.stats.plants++;
  worldMoved();
  return true;
}

function paveStep(ctx: TurnCtx, seat: SimSeat, maxTiles: number, keepOre: number): boolean {
  const { eco } = ctx;
  const plan = planUpgrades(eco, {
    owner: seat.id, ownerId: seat.ownerId,
    purse: seat.bot ? buildPurse(seat) : seat.goods,
    maxTiles, keepOre,
  });
  if (!plan || !plan.tiles.length) return false;
  // Rival: `rivalPavePass` — `spendBuild` up front, goods refunded for tiles
  // that did not lay. Bot: the same shape, money-gated like every player build.
  if (!spendBuild(seat, plan.cost)) return false;
  const out = executePaves(eco, plan, seat.ownerId);
  if (!out.built.length) {
    earn(seat, plan.cost);                  // game.ts: nothing built, nothing owed
    return false;
  }
  seat.stats.paves += out.built.length;
  for (const [cargo, v] of Object.entries(plan.cost) as [Cargo, number][]) {
    const owed = v - (out.spent[cargo] ?? 0);
    if (owed > 0) earn(seat, { [cargo]: owed });
  }
  worldMoved();
  return true;
}

function bankTowardGoal(seat: SimSeat, cost: Purse, budget: number): boolean {
  let traded = 0;
  let left = budget;
  for (const [cargo, amount] of Object.entries(cost) as [Cargo, number][]) {
    if (left <= 0) break;
    if ((seat.goods[cargo] ?? 0) >= amount) continue;
    const n = planBankTrades(seat.goods, cargo, cost, { unlocked: seat.depotTier, budget: left, need: amount });
    left -= n;
    traded += n;
  }
  return traded > 0;
}

/** `rivalBuyTowardGoal` (game.ts, #431): spend money on the goal's whole
 *  shortfall at the market's buy price, or not at all. */
function buyTowardGoal(ctx: TurnCtx, seat: SimSeat, cost: Purse): boolean {
  const earns = new Set(ctx.eco.harvesters.filter((h) => h.owner === seat.id)
    .map((h) => depotCargo(ctx.eco, h)).filter((c): c is Cargo => !!c));
  if (!goalOutOfReach(seat.goods, cost, earns)) return false;
  const plan = planGoalPurchase(seat.goods, cost, seat.money, (cargo, units) => {
    const q = quoteBuy(ctx.market, cargo, units, ctx.t);
    return q.units === units ? q.cost : null;
  });
  if (!plan) return false;
  seat.money -= plan.price;
  for (const [cargo, n] of Object.entries(plan.buy) as [Cargo, number][]) {
    seat.goods[cargo] = (seat.goods[cargo] ?? 0) + n;
  }
  return true;
}

/**
 * One seat's turn. Returns true when it achieved something (the caller's
 * clock then waits `buildMs`); false = the idle clock (`idleMs`).
 */
function takeTurn(ctx: TurnCtx, seat: SimSeat): boolean {
  const rules = difficultyRulesFor(seat.skill ? seat.skill.key : "normal");
  const pace = seat.skill ?? null;
  const buildCfg = seat.bot ?? {
    buildMs: pace!.buildMs, idleMs: pace!.idleMs, sessionMs: pace!.sessionMs,
    townReserve: pace!.townReserve, paveTiles: pace!.paveTiles,
  };
  let acted = false;

  const goal = treeGoal({ purse: seat.goods, tier: seat.depotTier });
  const want = treeWants(goal, scoreCargoWant(ctx.eco, seat.id));
  // `rivalBankTowardGoal` (game.ts): with the rung gate off every Depot costs
  // one of each cargo, so the bank trades toward the goal FIRST — the stall
  // fix the shipped turn runs.
  if (goal && goal.missing.length > 0
    && bankTowardGoal(seat, goal.cost, seat.bot ? seat.bot.bankPerTurn : ctx.rivalBankBudget)) {
    acted = true;
  }

  // City-first at the storage cap (game.ts's `townFirst` hoist).
  const atCap = CARGOES.some((c) => (seat.goods[c] ?? 0) >= storageCapFor(seat.townLevel));
  const reserve: Purse = {};
  const keep = Math.max(0, buildCfg.townReserve);
  for (const [k, v] of Object.entries(goal?.cost ?? {}) as [Cargo, number][]) {
    reserve[k] = Math.ceil(v * keep);
  }
  let townBought = false;
  if (atCap && townPass(ctx.eco, seat, reserve, rules, 0)) {
    townBought = true;
    acted = true;
    seat.sessionUntil = ctx.t + buildCfg.sessionMs;
    return true;
  }

  // 1. plant — reach (game.ts step 1).
  if (plantStep(ctx, seat, goal ? goal.cost : null)) acted = true;

  // 2. one Depot per turn (game.ts step 2), then its simulated tune (step 3).
  const builtDepot = depotStep(ctx, seat, want, {
    free: seat.freeTrack, freeDepots: seat.freeDepots, depotTier: seat.depotTier,
  });
  if (builtDepot) {
    acted = true;
    seat.stats.depots++;
    tuneNewDepots(ctx.eco, seat);
    seat.sessionUntil = ctx.t + buildCfg.sessionMs;
  }

  // 3. spend — a city tier, else a re-match (game.ts step 4). One per turn.
  if (!builtDepot && !townBought) {
    if (townPass(ctx.eco, seat, reserve, rules, 0)) {
      townBought = true;
      acted = true;
      seat.sessionUntil = ctx.t + buildCfg.sessionMs;
    } else if (retunePass(ctx.eco, seat, rules)) {
      acted = true;
      seat.sessionUntil = ctx.t + buildCfg.sessionMs;
    }
  }

  // 4. pave (game.ts step 5) — no session, it is the turn's free second half.
  if (paveStep(ctx, seat, buildCfg.paveTiles,
    chooseAiPlantSpot(ctx.eco.grid, ctx.eco.track, ctx.eco, seat.id) && !canPayBuild(seat, PLANT_COST)
      ? (PLANT_COST.ore ?? 0) : 0)) acted = true;

  // #431: the rival's idle tail — nothing landed, so it buys the goal's
  // missing goods with its money (`rivalBuyTowardGoal` in game.ts).
  if (!acted && !seat.bot && goal && buyTowardGoal(ctx, seat, goal.cost)) acted = true;

  return acted;
}

// ══════════════════════════════════════════════════════════════════════════
// The match.
// ══════════════════════════════════════════════════════════════════════════
export function runBalanceMatch(
  seed: number, botKey: BotKey, difficulty: SkillKey, opts: BalanceMatchOptions = {},
): BalanceMatch {
  const windowMs = (opts.minutes ?? 25) * 60_000;
  const bot = BOTS[botKey];
  const skill = RIVAL_SKILLS[difficulty];
  const target = VICTORY.loop.target;

  worldVersion = 0;
  const grid = generateMap(seed);
  const track = createTrack();
  seedTownRoads(track, grid);
  seedPublicRoads(track, grid);
  const rail: RailState = createRailState();
  const eco: EconomyState = { grid, track, harvesters: [], factories: [], rail };
  const market = createMarket(seed);

  const mk = (id: "you" | "ai", ownerId: number, s: RivalSkill | null, b: BotProfile | null): SimSeat => {
    const stats: SeatStats = {
      id, depots: 0, plants: 0, paves: 0, soldUnits: 0, soldRevenue: 0,
      firstPoint: null, money: START_MONEY, stars: { types: 0, routes: 0, city: 0, maxDepot: 0 },
      turns: { acted: 0, idle: 0, broke: 0 },
    };
    return {
      id, ownerId, skill: s, bot: b,
      goods: toBag(START_PURSE), money: START_MONEY,
      freeTrack: FREE_SETUP_TRACK, freeDepots: FREE_SETUP_DEPOTS,
      depotTier: 0, townLevel: 0, townBonus: 0,
      lastBuild: -(b?.buildMs ?? s!.buildMs), sessionUntil: 0,
      lastHarvest: -HARVEST_MS, lastSell: -SELL_MS,
      carry: {}, loopCarry: new Map(), stats,
    };
  };
  const you = mk("you", 1, null, bot);
  const ai = mk("ai", 2, skill, null);
  const seats: SimSeat[] = [you, ai];

  // Both openings come from the ENGINE's own rule (race.ts's note applies
  // here too): a town-adjacent site far from the other seat — a weaker
  // opening than a thinking human takes, on purpose.
  const opening = chooseRivalFactorySpot(grid, track, [MAP_W >> 1, MAP_H >> 1], {
    purse: START_PURSE, free: FREE_SETUP_TRACK, ownerId: 1,
  });
  const rivalSpot = chooseRivalFactorySpot(grid, track, opening ?? [4, 4], {
    purse: START_PURSE, free: FREE_SETUP_TRACK, ownerId: 2,
  });
  if (!opening || !rivalSpot) throw new Error(`seed ${seed}: no legal factory spot for a seat`);
  eco.factories.push({ owner: "you", ownerId: 1, tx: opening[0], ty: opening[1], id: 0, townId: null });
  eco.factories.push({ owner: "ai", ownerId: 2, tx: rivalSpot[0], ty: rivalSpot[1], id: 0, townId: null });

  const factoryFor = (seat: SimSeat) => eco.factories.find((f) => f.ownerId === seat.ownerId)!;

  // The loop's ★ table, wired exactly as `loopScoring` in game.ts — the
  // "running" gate, the route rule and the per-seat rung/city rows.
  const loopScoring = (): LoopScoring => {
    const locks = industryLocks(eco);
    const comps = new Map<number, ReturnType<typeof buildAllComponents>>();
    const compFor = (ownerId: number) => {
      let c = comps.get(ownerId);
      if (!c) comps.set(ownerId, c = buildAllComponents(eco.track, ownerId));
      return c;
    };
    return {
      running: (h) => {
        if (!isServiced(eco.track, h, eco.rail)) return false;
        if (resolveConnection(eco, compFor(h.ownerId), h).kind === null) return false;
        return heldIndustries(eco, h, locks).length > 0;
      },
      cargoOf: (h) => depotCargo(eco, h),
      routePaved: (h) => depotRoutePaved(eco, h),
      seats: seats.map((st) => ({ owner: st.id, depotTier: st.depotTier, townLevel: st.townLevel })),
    };
  };

  const score = createScoreState();
  const rateCache: RateCache = { version: -1, rows: new Map(), comp: new Map() };
  const trace: TracePoint[] = [];
  let winner: BalanceMatch["winner"] = null;
  let endMs = windowMs;
  let nextHarvesterId = 1;

  for (let t = 0; t <= windowMs && (opts.fullWindow || !winner); t += STEP_MS) {
    for (const seat of seats) {
      // The market clock runs for both seats (game.ts's `rivalMarketTick` is
      // the AI seat's half; the player presses Sell whenever — the bot's
      // policy IS its sell press).
      marketTick(market, seat, t);

      // ── the build/idle clock, exactly as `aiTick` runs it ───────────────
      const cfg = seat.bot ?? {
        buildMs: seat.skill!.buildMs, idleMs: seat.skill!.idleMs,
      };
      if (t - seat.lastBuild >= cfg.buildMs) {
        seat.lastBuild = t;
        // #297's session clock: a seat still playing a tuning session burns
        // the tick and comes back on the next build clock (the harvest clock
        // below runs regardless — income does not wait for the board).
        if (t >= seat.sessionUntil) {
          const ctx: TurnCtx = {
            eco, market, t, nextHarvesterId, factoryFor,
            rivalBankBudget: Math.max(1, rivalPace(vpFor(score, "you"), vpFor(score, "ai"), target).bankPerTurn),
          };
          const acted = takeTurn(ctx, seat);
          nextHarvesterId = ctx.nextHarvesterId;
          if (acted) {
            seat.stats.turns.acted++;
            rescore(eco, score, [], loopScoring());
            const got = vpFor(score, seat.id);
            if (seat.stats.firstPoint === null && got > 0) seat.stats.firstPoint = t;
            if (!winner && hasWon(score, seat.id, target)) {
              winner = seat.id;
              endMs = t;
            }
          } else {
            // "Had the money for a build, found nothing to do" is the stall
            // the report's tables explain; a broke seat is just pacing.
            if (seat.money >= moneyValueOf({ grain: 3, wood: 3, stone: 3 })) seat.stats.turns.broke++;
            else seat.stats.turns.idle++;
            seat.lastBuild = t - cfg.buildMs + cfg.idleMs;
          }
        }
      }

      // ── the harvest clock (economyTick's new-loop branch) ───────────────
      if (t - seat.lastHarvest >= HARVEST_MS) {
        seat.lastHarvest = t;
        loopIncome(eco, seat, rateCache, t);
      }
    }

    if (t % 60_000 === 0) {
      trace.push({
        t,
        youStar: vpFor(score, "you"), aiStar: vpFor(score, "ai"),
        youMoney: you.money, aiMoney: ai.money,
      });
    }
    if (winner && !opts.fullWindow) break;
  }

  you.stats.money = you.money;
  ai.stats.money = ai.money;
  for (const seat of seats) {
    const b = victoryBreakdown(eco, seat.id, [], loopScoring());
    seat.stats.stars = {
      types: b.types, routes: b.routes, city: b.city,
      maxDepot: eco.harvesters.filter((h) => h.owner === seat.id && (h.level ?? 1) >= DEPOT_LEVELS.max).length,
    };
  }
  opts.onEnd?.(eco, seats);
  return {
    seed, bot: botKey, difficulty, target,
    winner, endMs, windowMs, trace, you: you.stats, ai: ai.stats,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Aggregation and the report — what the harness runs from one command exist
// to produce (tests/unit/iso-471-balance-sim.test.ts writes the markdown).
// ══════════════════════════════════════════════════════════════════════════
export interface MatchupSummary {
  bot: BotKey;
  difficulty: SkillKey;
  matches: BalanceMatch[];
  /** Share of matches the RIVAL won (0…1). */
  rivalWinRate: number;
  /** Share of matches the bot won. */
  botWinRate: number;
  /** Share that reached the ★ line inside the window at all. */
  decisionRate: number;
  /** Mean minutes to the decision (matches that decided). */
  meanMinutes: number;
  medianMinutes: number;
  /** The ticket's targets, for the report's verdict column. */
  target: { rivalWinRate: number | null; meanMinutes: [number, number] | null };
}

export function summarize(
  bot: BotKey, difficulty: SkillKey, matches: BalanceMatch[],
): MatchupSummary {
  const decided = matches.filter((m) => m.winner !== null);
  const minutes = decided.map((m) => m.endMs / 60_000).sort((a, b) => a - b);
  const mean = minutes.length ? minutes.reduce((a, b) => a + b, 0) / minutes.length : NaN;
  const median = minutes.length ? minutes[Math.floor(minutes.length / 2)] : NaN;
  const rivalWins = matches.filter((m) => m.winner === "ai").length;
  return {
    bot, difficulty, matches,
    rivalWinRate: matches.length ? rivalWins / matches.length : 0,
    botWinRate: matches.length ? matches.filter((m) => m.winner === "you").length / matches.length : 0,
    decisionRate: matches.length ? decided.length / matches.length : 0,
    meanMinutes: mean,
    medianMinutes: median,
    target: TARGETS[`${bot}#${difficulty}`] ?? { rivalWinRate: null, meanMinutes: null },
  };
}

/**
 * The ticket's targets, in one place the report and the smoke test share.
 *
 * Reading of "within ±5%" (the ticket does not define it): win rates are
 * shares of 30+ seeds, so ±5 PERCENTAGE POINTS is the finest band integer
 * wins can land in; match length is a mean of minutes, so ±5% relative. The
 * smoke test is the looser gate the ticket asks for (±15).
 */
export const WIN_RATE_TOLERANCE_PP = 5;
export const LENGTH_TOLERANCE_REL = 0.05;
export const SMOKE_WIN_RATE_TOLERANCE_PP = 15;
export const SMOKE_LENGTH_TOLERANCE_REL = 0.15;

export const TARGETS: Record<string, {
  rivalWinRate: number | null;
  meanMinutes: [number, number] | null;
}> = {
  "steady#easy":   { rivalWinRate: 0.20, meanMinutes: null },
  "steady#normal": { rivalWinRate: 0.40, meanMinutes: [15, 20] },
  "steady#hard":   { rivalWinRate: 0.60, meanMinutes: null },
  // FTUE-1: the trainee NEVER beats the novice.
  "novice#trainee": { rivalWinRate: 0, meanMinutes: null },
};

export const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

/** "1-30" | "7,42,1337" | "1-8,42" → the seed list (shared by both runners). */
export function parseSeeds(raw: string): number[] {
  const out: number[] = [];
  for (const part of raw.split(",")) {
    const m = part.trim().match(/^(\d+)-(\d+)$/);
    if (m) {
      for (let n = Number(m[1]); n <= Number(m[2]); n++) out.push(n);
    } else if (part.trim()) {
      out.push(Number(part.trim()));
    }
  }
  return out;
}

export function summaryLine(s: MatchupSummary): string {
  const t = s.target;
  const win = t.rivalWinRate === null ? "—"
    : `rival ${pct(s.rivalWinRate)} (target ${pct(t.rivalWinRate!)} ±${WIN_RATE_TOLERANCE_PP}pp)`;
  const len = t.meanMinutes === null ? `mean ${s.meanMinutes.toFixed(1)}m`
    : `mean ${s.meanMinutes.toFixed(1)}m (target ${t.meanMinutes[0]}–${t.meanMinutes[1]}m)`;
  return `${s.bot} vs ${s.difficulty}: ${win}, ${len}, decided ${pct(s.decisionRate)}, n=${s.matches.length}`;
}

/** The per-minute ★/money averages the report prints as its arc table. */
export function arcTable(s: MatchupSummary, at: readonly number[]): string {
  const rows = at.map((min) => {
    const pts = s.matches.map((m) => m.trace[Math.min(min, m.trace.length - 1)]).filter(Boolean);
    if (!pts.length) return `| ${min}m | — | — | — | — |`;
    const avg = (f: (p: TracePoint) => number) =>
      (pts.reduce((a, p) => a + f(p), 0) / pts.length).toFixed(1);
    return `| ${min}m | ${avg((p) => p.youStar)} | ${avg((p) => p.aiStar)} | ${avg((p) => p.youMoney)} | ${avg((p) => p.aiMoney)} |`;
  });
  return [
    "| t | you ★ | rival ★ | you $ | rival $ |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}
