// ─────────────────────────────────────────────────────────────────────────────
// Test helper for the VP-01 race + AI-01 calibration (not a test file — vitest
// only collects `tests/unit/**/*.test.ts`).
//
// Two AI seats play a full game of Hexmatch Industries head to head, driven by
// the REAL modules the live game drives — no game code mocked:
//
//   opening Factory: chooseRivalFactorySpot, per seat, on the real terrain;
//   every build turn, in the game's order: plant → aiBuildStep (A* road
//     planning against BUILD_COSTS + priceDepot) → planUpgrades/executePaves →
//     banking;
//   income: playerResources trickle with the PP-07 fractional carry;
//   trading: the real bankTrade 4:1 bank, aimed at the smaller shortfall
//     between the next Depot and the next four paves — plus, since AI-01, the
//     same market offers the live rival posts (chooseRivalOffer over the real
//     escrow Market), with expiry refunds and `rivalWouldAccept` as the
//     answering policy on both sides;
//   scoring: rescore after each turn that built something, then hasWon.
//
// Both seats carry a RIVAL_SKILLS preset, so `runRace(seed, { skills:
// ["normal", "normal"] })` is the VP-01 race and `["hard", "easy"]` is how a
// difficulty gets measured: the speed at which each seat reaches the win
// points (recorded as per-seat 1★/5★/10★ milestones) is the answer.
//
// Deliberate omissions — every number here is an upper bound on a real game's,
// and every seat pair is missing THE SAME things, so comparisons stay fair:
//
//   * no match-3 board — a human turning gems into Ore paves far faster than a
//     seat that can only trade at the bank;
//   * no Black Market, no sabotage, no blockades.
// ─────────────────────────────────────────────────────────────────────────────
import { generateMap } from "../../../src/iso/grid";
import {
  createTrack, seedTownRoads, seedPublicRoads, canAfford, isUpgradedRoad,
  tIdx, tileCost, type Purse, type Track,
} from "../../../src/iso/track";
import {
  aiBuildStep, chooseRivalFactorySpot, planUpgrades, executePaves, paveCandidates,
  deepPlanCandidates, rivalPace, type RivalPace,
} from "../../../src/iso/ai";
import { RIVAL_SKILLS, type RivalSkill, type SkillKey } from "../../../src/iso/skill";
import {
  playerResources, type EconomyState, type Factory,
} from "../../../src/iso/economy";
import {
  createScoreState, rescore, vpFor, hasWon,
} from "../../../src/iso/victory";
import {
  addPlant, canAffordPlant, chooseAiPlantSpot, PLANT_COST,
} from "../../../src/iso/plants";
import { VP_TARGET, CARGOES, type Cargo } from "../../../src/iso/config";
import {
  bankTrade, BANK_RATE, createMarket, postOffer, acceptOffer, tickMarket,
  type Market, type MarketPlayer, type TradeOffer,
} from "../../../src/game/trade";
import { MAP_W, MAP_H } from "../../../src/game/config";
import {
  toBag, chooseRivalOffer, rivalWouldAccept, AI_TRADE_MS, type CargoBag,
} from "../../../src/iso/market";
import {
  START_PURSE, FREE_SETUP_TRACK, HARVEST_MS,
} from "../../../src/iso/game";
import { FREE_SETUP_DEPOTS, priceDepot } from "../../../src/iso/construction";

export const STEP_MS = 1_000;
export const MIN = (ms: number) => `${(ms / 60_000).toFixed(1)}m`;
const GOLD_BLOCKED: ReadonlySet<Cargo> = new Set(["gold"]);

export interface Seat {
  id: string;
  ownerId: number;
  skill: RivalSkill;
  purse: CargoBag;
  freeTrack: number;
  freeDepots: number;
  lastBuild: number;
  lastHarvest: number;
  lastOffer: number;
  carry: Partial<Record<Cargo, number>>;
  /** ms of the first pave and of the first point of any kind. */
  firstPave: number | null;
  firstPoint: number | null;
  /** Ore actually burned on pavement — the "ore is the score" claim, counted. */
  oreOnPaves: number;
  paves: number;
  /** AI-01: the market activity this seat performed. */
  offersPosted: number;
  offersTaken: number;
  /** AI-01: when this seat crossed each headline total (1★, 5★, the win). */
  milestones: { vp: number; at: number }[];
  /** The last purse target `seatSkintTarget` computed for this seat (decision
   *  cache the trade-answer policy reads instead of re-planning). */
  target: Purse | null;
  /** AI-01: the depot-plan goal and the pave goal, exposed separately from
   *  `target` (their winner), so the two banking passes can guard what the
   *  other is saving for and never trade it away. */
  planGoal: Purse | null;
  paveGoal: Purse | null;
}

export interface Race {
  seed: number;
  minutes: number;
  eco: EconomyState;
  seats: Seat[];
  vp: Record<string, number>;
  /** VP per seat, sampled every simulated minute. */
  trace: { t: number; you: number; ai: number }[];
  winner: { id: string; at: number } | null;
}

export interface RaceOptions {
  /** Simulated horizon in in-game minutes. */
  minutes?: number;
  /** [you, ai] difficulty presets. Both "normal" = the classic VP-01 race. */
  skills?: [SkillKey, SkillKey];
  /** Debug hook, called at the end of every simulated minute. */
  onMinute?: (t: number, seats: Seat[], eco: EconomyState) => void;
  /**
   * Diagnostic: keep both seats playing after the first reaches 10★, so a
   * slow lane's full-window conversion can be measured instead of its
   * mid-flight snapshot. `winner` still records who crossed first (and when);
   * the calibration assertions never set this — their races must stop at the
   * line, like the live game's.
   */
  fullWindow?: boolean;
}

/** Spend from a seat's bag through the same affordability rule the game's spends use. */
function pay(seat: Seat, cost: Purse): boolean {
  if (!canAfford(seat.purse, cost)) return false;
  for (const [k, v] of Object.entries(cost) as [Cargo, number][]) {
    seat.purse[k] = (seat.purse[k] ?? 0) - v;
  }
  return true;
}

/**
 * Give back what a plan priced but the build did not spend — a tile the other
 * seat's plant had already taken is skipped by `executePaves`, and the game's
 * `rivalPavePass` refunds the difference. The sim has to, or its purse drifts
 * below zero-equivalent and every later affordability answer is a lie.
 */
function refund(seat: Seat, planned: Purse, spent: Purse) {
  for (const [k, v] of Object.entries(planned) as [Cargo, number][]) {
    const owed = v - (spent[k] ?? 0);
    if (owed > 0) seat.purse[k] = (seat.purse[k] ?? 0) + owed;
  }
}

export const gap = (purse: CargoBag, target: Purse | null): number => {
  if (!target) return Infinity;
  let missing = 0;
  for (const [k, v] of Object.entries(target) as [Cargo, number][]) {
    missing += Math.max(0, v - (purse[k] ?? 0));
  }
  return missing;
};

/** The bank's per-turn exchange budget for this seat's difficulty. */
const bankBudget = (skill: RivalSkill, pace: RivalPace): number =>
  Math.max(1, pace.bankPerTurn + skill.bankBonus);

/**
 * `rivalBankTowardPave`: exchanges into Ore, never out of the build plan.
 * AI-01: the plan guard covers the WHOLE chosen plan (track + Depot), asking
 * `seatSkintTarget` for the current goals first. The original port guarded
 * nothing at all, and together with `bankToward` it formed the churn the
 * shipped rival felt like on a bad lane: this pass sold the Wood the depot
 * plan needed into Ore, that pass sold the Ore back into Wood, and the 4:1
 * round trip vaporized the purse while no plan ever completed.
 */
function bankForPaves(eco: EconomyState, seat: Seat, track: Track, f: Factory, pace: RivalPace, urgency: number) {
  const ranked = paveCandidates(eco, {
    owner: seat.id, ownerId: seat.ownerId, purse: seat.purse, maxTiles: 4,
  });
  if (!ranked.length) return;
  let need = 0;
  for (const t of ranked.slice(0, 4)) need += tileCost(track, "road", t.x, t.y).ore ?? 0;
  const price = need > 0 ? 4 : 0;
  if ((seat.purse.ore ?? 0) >= need || !price) return;
  seatSkintTarget(eco, seat, track, f, urgency);        // refresh the goals
  const guard = seat.planGoal ?? {};
  let trades = 0;
  while ((seat.purse.ore ?? 0) < need && trades < bankBudget(seat.skill, pace)) {
    const surplus = (CARGOES as Cargo[])
      .filter((c) => c !== "gold" && c !== "ore" && (seat.purse[c] ?? 0) >= price)
      .filter((c) => (seat.purse[c] ?? 0) - price >= (guard[c] ?? 0))
      .sort((a, b) => (seat.purse[b] ?? 0) - (seat.purse[a] ?? 0))[0];
    if (!surplus) return;
    if (!bankTrade({ res: seat.purse }, surplus, "ore", undefined, GOLD_BLOCKED)) return;
    trades++;
  }
}

/**
 * The purse a seat is working toward right now — the depot plan closest to
 * affordable, unless the pave milestone is fewer trades away. The game twin is
 * `rivalSkintTarget` in game.ts; the bank and the market offer both read it.
 */
function seatSkintTarget(
  eco: EconomyState, seat: Seat, track: Track, f: Factory, urgency: number,
): Purse | null {
  // AI-01: through the memoized deep search — a stalled seat re-asks this on
  // every idle retry, and re-routing an unchanged map was most of the
  // harness's wall clock. Scores may lag the trickle by one build; the
  // shortfall ranking below reads the live purse either way.
  const cands = deepPlanCandidates(eco, f, {
    stock: seat.purse, free: seat.freeTrack, freeDepots: seat.freeDepots,
    oreUrgency: urgency,
  });
  const depot = priceDepot(seat.purse, seat.freeDepots).cost;
  let planTarget: Purse | null = null;
  if (cands.length) {
    const shortfall = (c: (typeof cands)[number]): number => gap(seat.purse, c.cost) + gap(seat.purse, depot);
    const chosen = [...cands].sort((a, b) => shortfall(a) - shortfall(b) || b.score - a.score)[0];
    planTarget = {};
    for (const [k, v] of Object.entries(chosen.cost)) planTarget[k as Cargo] = v;
    for (const [k, v] of Object.entries(depot)) planTarget[k as Cargo] = (planTarget[k as Cargo] ?? 0) + v;
  }
  let paveTarget: Purse | null = null;
  const ranked = paveCandidates(eco, {
    owner: seat.id, ownerId: seat.ownerId, purse: seat.purse, maxTiles: 4,
  });
  if (ranked.length) {
    let ore = 0;
    for (const t of ranked.slice(0, 4)) ore += tileCost(track, "road", t.x, t.y).ore ?? 0;
    if (ore > 0) paveTarget = { ore };
  }
  seat.planGoal = planTarget;
  seat.paveGoal = paveTarget;
  return paveTarget && gap(seat.purse, paveTarget) < gap(seat.purse, planTarget)
    ? paveTarget : planTarget;
}

/**
 * The 4:1 bank on a stalled turn — a port of the rival's `rivalBankTowardPlan`,
 * including VP-01's rule that the bank may be pointed at the SCOREboard (Ore
 * for paves) when that milestone is closer than the next Depot.
 */
function bankToward(eco: EconomyState, seat: Seat, track: Track, f: Factory, pace: RivalPace, urgency: number) {
  const target = seatSkintTarget(eco, seat, track, f, urgency);
  seat.target = target;      // AI-01: the market's answer policy reads this
  if (!target) return;
  // AI-01: never sell the score. While any pave goal is on the board, Ore
  // only flows IN (this bank or `bankForPaves`), never out — the round trip
  // was the churn behind the "passive rival" report.
  const paving = seat.paveGoal !== null;
  let trades = 0;
  for (const [cargo, need] of Object.entries(target) as [Cargo, number][]) {
    while ((seat.purse[cargo] ?? 0) < need && trades < bankBudget(seat.skill, pace)) {
      const surplus = (CARGOES as Cargo[])
        .filter((c) => c !== "gold" && c !== cargo && (seat.purse[c] ?? 0) >= BANK_RATE)
        .filter((c) => c !== "ore" || !paving)
        .filter((c) => (seat.purse[c] ?? 0) - BANK_RATE >= (target[c] ?? 0))
        .sort((a, b) => (seat.purse[b] ?? 0) - (seat.purse[a] ?? 0))[0];
      if (!surplus) break;
      if (!bankTrade({ res: seat.purse }, surplus, cargo, undefined, GOLD_BLOCKED)) break;
      trades++;
    }
  }
}

/**
 * Race one seed, both seats driven by the same AI the live game ships. The
 * loop steps one simulated second at a time and breaks on the first seat to
 * 10★; per-difficulty clocks (`buildMs`/`idleMs`) run exactly like the live
 * game's: a turn that achieved something waits `buildMs`, a no-op turn
 * retries in `idleMs`.
 */
export function runRace(seed: number, opts: RaceOptions = {}): Race {
  const RACE_MS = (opts.minutes ?? 24) * 60_000;
  const [skillYou, skillAi] = opts.skills ?? ["normal", "normal"];
  const grid = generateMap(seed);
  const track = createTrack();
  // AI-01: the live map boots with its towns' ring roads and inter-town
  // highways already stamped (PP-10/PP-13), and the rival's planner treats
  // them as shared network ground — a sim that leaves them out would measure
  // an opponent that cannot use the main roads at all.
  seedTownRoads(track, grid);
  seedPublicRoads(track, grid);
  const eco: EconomyState = { grid, track, harvesters: [], factories: [] };
  const score = createScoreState();
  const mk = (id: string, ownerId: number, key: SkillKey): Seat => ({
    id, ownerId,
    skill: RIVAL_SKILLS[key],
    purse: toBag(START_PURSE),
    freeTrack: FREE_SETUP_TRACK,
    freeDepots: FREE_SETUP_DEPOTS,
    lastBuild: -RIVAL_SKILLS[key].buildMs, lastHarvest: -HARVEST_MS,
    lastOffer: -(RIVAL_SKILLS[key].offerEveryMs || 0), carry: {},
    firstPave: null, firstPoint: null, oreOnPaves: 0, paves: 0,
    offersPosted: 0, offersTaken: 0, milestones: [],
    target: null, planGoal: null, paveGoal: null,
  });
  const seats: Seat[] = [mk("you", 1, skillYou), mk("ai", 2, skillAi)];

  // AI-01: the two seats trade through ONE real market — escrow, expiry
  // refunds and all (postOffer stamps `born` with the wall clock, so the sim
  // re-stamps it with simulated time before the offer can be read).
  const market: Market<Cargo> = createMarket(["gold"]);
  const traders: MarketPlayer<Cargo>[] = seats.map((s, i) => ({ i, res: s.purse }));
  let lastTradeCheck = -AI_TRADE_MS;

  // Both openings come from the ENGINE's own rule (`chooseRivalFactorySpot`: a
  // town-adjacent site far from the other seat), never a hand-picked tile —
  // including for the "you" seat, which is a WEAKER opening than a thinking
  // human takes. Conservative, on purpose.
  const opening = chooseRivalFactorySpot(grid, track, [MAP_W >> 1, MAP_H >> 1], {
    purse: START_PURSE, free: FREE_SETUP_TRACK, ownerId: 1,
  });
  const rival = chooseRivalFactorySpot(grid, track, opening ?? [4, 4], {
    purse: START_PURSE, free: FREE_SETUP_TRACK, ownerId: 2,
  });
  if (!opening || !rival) throw new Error(`seed ${seed}: no legal factory spot for a seat`);
  eco.factories.push({ owner: "you", ownerId: 1, tx: opening[0], ty: opening[1], id: 0, townId: null });
  eco.factories.push({ owner: "ai", ownerId: 2, tx: rival[0], ty: rival[1], id: 0, townId: null });

  const factoryFor = (seat: Seat) => eco.factories.find((f) => f.ownerId === seat.ownerId)!;
  let nextHarvesterId = 1;
  const trace: Race["trace"] = [];
  let winner: Race["winner"] = null;

  const MILESTONES = [1, 5, VP_TARGET];

  for (let t = 0; t <= RACE_MS && (opts.fullWindow || !winner); t += STEP_MS) {
    for (const seat of seats) {
      // ── the build clock: `aiTick`'s actions, most valuable first, each one
      //    paying for itself before it is applied
      if (t - seat.lastBuild >= seat.skill.buildMs) {
        seat.lastBuild = t;
        let acted = false;
        // VP-01: the same read of the scoreboard the shipped rival makes. The
        // OTHER seat's total is what a seat reacts to, and BOTH seats run the
        // policy — the only way to measure whether catching up helps at all.
        const other = seat.id === "you" ? "ai" : "you";
        const pace = rivalPace(vpFor(score, other), vpFor(score, seat.id), VP_TARGET);
        const urgency = pace.oreUrgency * seat.skill.urgencyBias;

        if (canAffordPlant(seat.purse)) {
          const spot = chooseAiPlantSpot(grid, track, eco, seat.id);
          if (spot && pay(seat, PLANT_COST)) {
            addPlant(grid, track, eco, seat.id, seat.ownerId, spot[0], spot[1]);
            acted = true;
          }
        }
        // AI-01: a hard preset expands several depot plans per turn; each pass
        // re-plans against the purse the last build left, like the live loop.
        for (let n = Math.max(1, seat.skill.expandPerTurn); n > 0; n--) {
          const built = aiBuildStep(eco, factoryFor(seat), {
            stock: seat.purse, purse: seat.purse,
            free: seat.freeTrack, freeDepots: seat.freeDepots, now: t,
            oreUrgency: urgency,
          }, nextHarvesterId);
          if (!built) break;
          nextHarvesterId++;
          seat.freeTrack = Math.max(0, seat.freeTrack - built.free);
          seat.freeDepots = Math.max(0, seat.freeDepots - built.freeDepots);
          pay(seat, built.spent);
          acted = true;
        }
        const plan = planUpgrades(eco, {
          owner: seat.id, ownerId: seat.ownerId, purse: seat.purse,
          maxTiles: seat.skill.paveTiles,
        });
        if (plan && pay(seat, plan.cost)) {
          const laid = executePaves(eco, plan, seat.ownerId);
          refund(seat, plan.cost, laid.spent);      // as `rivalPavePass` does
          if (laid.built.length) {
            if (seat.firstPave === null) seat.firstPave = t;
            seat.paves += laid.built.length;
            seat.oreOnPaves += laid.spent.ore ?? 0;
            acted = true;
          }
        } else {
          // VP-01: the seat that has gravel and no Ore buys the Ore, even on a
          // turn it also spent building — `rivalBankTowardPave` in game.ts
          bankForPaves(eco, seat, track, factoryFor(seat), pace, urgency);
        }
        if (!acted) {
          bankToward(eco, seat, track, factoryFor(seat), pace, urgency);
          // the game retries the whole sequence once a bank unlocked something
          const retry = planUpgrades(eco, {
            owner: seat.id, ownerId: seat.ownerId, purse: seat.purse,
            maxTiles: seat.skill.paveTiles,
          });
          if (retry && pay(seat, retry.cost)) {
            const laid = executePaves(eco, retry, seat.ownerId);
            refund(seat, retry.cost, laid.spent);
            if (laid.built.length) {
              if (seat.firstPave === null) seat.firstPave = t;
              seat.paves += laid.built.length;
              seat.oreOnPaves += laid.spent.ore ?? 0;
              acted = true;
            }
          }
        }

        // Points move on a build, never on a clock — the rule `game.ts` keeps by
        // rescoring from the build paths only.
        if (acted) {
          rescore(eco, score);
          const got = vpFor(score, seat.id);
          if (seat.firstPoint === null && got > 0) seat.firstPoint = t;
          for (const m of MILESTONES) {
            if (got >= m && !seat.milestones.some((x) => x.vp === m)) {
              seat.milestones.push({ vp: m, at: t });
            }
          }
          if (!winner && hasWon(score, seat.id)) winner = { id: seat.id, at: t };
        } else {
          // AI-01: the idle clock is per-difficulty, exactly like the live
          // game — a no-op turn retries in `idleMs`, not a whole `buildMs`.
          seat.lastBuild = t - seat.skill.buildMs + seat.skill.idleMs;
        }
      }

      // ── the market clock: post an offer on the seat's own cadence (the
      //    answering pass runs once per step, after both seats)
      if (seat.skill.offerEveryMs && t - seat.lastOffer >= seat.skill.offerEveryMs) {
        seat.lastOffer = t;
        const other = seat.id === "you" ? "ai" : "you";
        const urgency = rivalPace(vpFor(score, other), vpFor(score, seat.id), VP_TARGET).oreUrgency
          * seat.skill.urgencyBias;
        const need = seatSkintTarget(eco, seat, track, factoryFor(seat), urgency);
        seat.target = need;  // AI-01: cache for the answering policy
        if (need) {
          const idea = chooseRivalOffer(seat.purse, need);
          if (idea) {
            const before = market.offers.map((o) => o.id);
            if (postOffer(traders[seat.ownerId - 1], idea.give, idea.giveN, idea.want, idea.wantN, market)) {
              const fresh = market.offers.find((o) => !before.includes(o.id));
              if (fresh) fresh.born = t;     // born on simulated time, not wall time
              seat.offersPosted++;
            }
          }
        }
      }

      // ── the harvest clock: trickle income with the fractional carry
      if (t - seat.lastHarvest >= HARVEST_MS) {
        seat.lastHarvest = t;
        const y = playerResources(eco, seat.id, t);
        for (const [cargo, v] of Object.entries(y) as [Cargo, number][]) {
          const acc = (seat.carry[cargo] ?? 0) + Math.max(0, v);
          const n = Math.floor(acc);
          seat.carry[cargo] = acc - n;
          if (n > 0) seat.purse[cargo] = (seat.purse[cargo] ?? 0) + n;
        }
      }
    }

    // AI-01: both seats look at the offer board on the shared trade cadence.
    // The answering policy here is deliberately stricter than the live
    // rival's `rivalWouldAccept` (which answers the PLAYER's offers politely
    // dumb, so a posted deal the player offers is usually taken): between two
    // thinking economies the taker also refuses to pay a cargo that dips it
    // below its own plan's demand. Without that guard the harness showed the
    // rich seat structurally extracting the poor seat's scarcest cargo —
    // every "free units" deal it took moved it further from the purse its
    // next Depot needed, and mirrored normal-vs-normal ended 10★–0★.
    if (t - lastTradeCheck >= AI_TRADE_MS) {
      lastTradeCheck = t;
      for (const o of [...market.offers]) {
        const takerSeat = seats.find((s) => s.ownerId - 1 !== o.from);
        const taker = traders.find((tr) => tr.i !== o.from);
        if (!taker || !takerSeat) continue;
        if (!rivalWouldAccept(taker, o as TradeOffer<Cargo>)) continue;
        const planDemand = takerSeat.target?.[o.want] ?? 0;
        if ((taker.res[o.want] ?? 0) - o.wantN < planDemand) continue;   // would starve the plan
        if (acceptOffer(taker, o.id, traders, market)) takerSeat.offersTaken++;
      }
    }
    tickMarket(t, traders, market);   // OFFER_LIFE expiry, sim-clock refunds
    if (t % 60_000 === 0) {
      trace.push({ t, you: vpFor(score, "you"), ai: vpFor(score, "ai") });
      opts.onMinute?.(t, seats, eco);
    }
  }

  return {
    seed,
    minutes: Math.round(trace.length ? (trace[trace.length - 1].t - trace[0].t) / 60_000 : 0),
    eco, seats,
    vp: { you: vpFor(score, "you"), ai: vpFor(score, "ai") },
    trace, winner,
  };
}

/** How many of `ownerId`'s tiles on the board carry pave provenance. */
export function pavedCount(track: Track, ownerId: number): number {
  let n = 0;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (track.owner[tIdx(x, y)] !== ownerId) continue;
      if (isUpgradedRoad(track, x, y)) n++;
    }
  }
  return n;
}

/** Tiles of one tier owned by `ownerId` — the stall diagnostics. */
export function countTier(track: Track, kind: "dirt" | "road", ownerId: number): number {
  let n = 0;
  for (let i = 0; i < track[kind].length; i++) {
    if ((track[kind][i] & 16) !== 0 && track.owner[i] === ownerId) n++;
  }
  return n;
}

/** The seat's own pace over the second half of the run, in ★ per minute. */
export function pacePerMinute(r: Race, key: "you" | "ai"): number {
  const half = r.trace.slice(Math.floor(r.trace.length / 2));
  if (half.length < 2) return 0;
  const first = half[0], last = half[half.length - 1];
  const minutes = (last.t - first.t) / 60_000;
  return minutes <= 0 ? 0 : (last[key] - first[key]) / minutes;
}
