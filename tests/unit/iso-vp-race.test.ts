// ══════════════════════════════════════════════════════════════════════════
// VP-01 — the race to ten, measured.
//
// `iso-victory.test.ts` pins what scores. `iso-progression.test.ts` pins the
// opening economy. Neither answers the question this ticket really raises:
// **can a player reach 10★ at all, and does the AI get there by playing its own
// plan?** A target nobody can hit is worse than a target that is too easy, so
// this file runs the real modules head to head — both seats driven by the
// rival's own turn, in order: plant → depot (`aiBuildStep`) → pave
// (`planUpgrades` + `executePaves`) → bank, with the same clocks the live game
// uses (`AI_BUILD_MS`, `HARVEST_MS`) and income from `playerResources` only.
//
// Two deliberate omissions make every number here an UPPER bound on a real
// game's, which is how the table should be read:
//
//   * no match-3 board — a human turning gems into Ore paves far faster than a
//     seat that can only trade at the bank;
//   * no Black Market, no sabotage, no blockades.
//
// The window is one finished game, not a fixed slice: the loop breaks the moment
// a seat reaches 10★ (≈12 in-game simulated minutes, ≈50s of wall clock on a
// dev machine — the only file in the suite that plans a whole match for two
// players). The assertions are about the SHAPE of the game — someone scoring within the
// opening, the total always equal to what the board says, a scoreboard that
// never moves backwards while nothing is demolished, and a leader whose PACE
// closes 10★ inside a session. Pacing itself is measured over a long run:
//
//   VP_RACE_MINUTES=45 VP_RACE_SEEDS=1337,7,42,99 npx vitest run tests/unit/iso-vp-race.test.ts
//
// whose printed table feeds the playtest report in `docs/`.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { generateMap } from "../../src/iso/grid";
import {
  createTrack, canAfford, isUpgradedRoad, tIdx, tileCost, type Purse, type Track,
} from "../../src/iso/track";
import {
  aiBuildStep, chooseRivalFactorySpot, planUpgrades, executePaves, paveCandidates,
  planCandidates, rivalPace, type RivalPace,
} from "../../src/iso/ai";
import { playerResources, type EconomyState, type Factory } from "../../src/iso/economy";
import { createScoreState, rescore, vpFor, hasWon, victoryBreakdown } from "../../src/iso/victory";
import {
  addPlant, canAffordPlant, chooseAiPlantSpot, PLANT_COST, plantsOf,
} from "../../src/iso/plants";
import { VICTORY, VP_TARGET, CARGOES, type Cargo } from "../../src/iso/config";
import { bankTrade, BANK_RATE } from "../../src/game/trade";
import { MAP_W, MAP_H } from "../../src/game/config";
import { toBag, type CargoBag } from "../../src/iso/market";
import { START_PURSE, FREE_SETUP_TRACK, HARVEST_MS, AI_BUILD_MS } from "../../src/iso/game";
import { FREE_SETUP_DEPOTS, priceDepot } from "../../src/iso/construction";

const STEP_MS = 1_000;
const MIN = (ms: number) => `${(ms / 60_000).toFixed(1)}m`;
/**
 * The simulated horizon, in in-game minutes. It is long enough for the window to
 * contain a FINISHED game (a seat reaches 10★ around minute 12-20 on these
 * seeds, with no match-3 income at all), and short enough to stay a unit test.
 * A playtest run raises it and reads the printed table:
 *
 *   VP_RACE_MINUTES=45 VP_RACE_SEEDS=1337,7,42 npx vitest run tests/unit/iso-vp-race.test.ts
 */
const RACE_MINUTES = Number(process.env.VP_RACE_MINUTES ?? 24);
const RACE_MS = RACE_MINUTES * 60_000;
/** Seeds to race. One is enough for the invariant; a playtest wants the spread. */
const SEEDS = (process.env.VP_RACE_SEEDS ?? "1337").split(",").map((x) => Number(x));
const GOLD_BLOCKED: ReadonlySet<Cargo> = new Set(["gold"]);

interface Seat {
  id: string;
  ownerId: number;
  purse: CargoBag;
  freeTrack: number;
  freeDepots: number;
  lastBuild: number;
  lastHarvest: number;
  carry: Partial<Record<Cargo, number>>;
  /** ms of the first pave and of the first point of any kind. */
  firstPave: number | null;
  firstPoint: number | null;
  /** Ore actually burned on pavement — the "ore is the score" claim, counted. */
  oreOnPaves: number;
  paves: number;
}

interface Race {
  seed: number;
  minutes: number;
  eco: EconomyState;
  seats: Seat[];
  vp: Record<string, number>;
  /** VP per seat, sampled every simulated minute. */
  trace: { t: number; you: number; ai: number }[];
  winner: { id: string; at: number } | null;
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

const gap = (purse: CargoBag, target: Purse): number => {
  let missing = 0;
  for (const [k, v] of Object.entries(target) as [Cargo, number][]) {
    missing += Math.max(0, v - (purse[k] ?? 0));
  }
  return missing;
};

/** `rivalBankTowardPave`: exchanges into Ore, never out of the Depot plan. */
function bankForPaves(eco: EconomyState, seat: Seat, track: Track, pace: RivalPace) {
  const ranked = paveCandidates(eco, {
    owner: seat.id, ownerId: seat.ownerId, purse: seat.purse, maxTiles: 4,
  });
  if (!ranked.length) return;
  let need = 0;
  for (const t of ranked.slice(0, 4)) need += tileCost(track, "road", t.x, t.y).ore ?? 0;
  const price = need > 0 ? 4 : 0;
  if ((seat.purse.ore ?? 0) >= need || !price) return;
  let trades = 0;
  while ((seat.purse.ore ?? 0) < need && trades < pace.bankPerTurn) {
    const surplus = (CARGOES as Cargo[])
      .filter((c) => c !== "gold" && c !== "ore" && (seat.purse[c] ?? 0) >= price)
      .sort((a, b) => (seat.purse[b] ?? 0) - (seat.purse[a] ?? 0))[0];
    if (!surplus) return;
    if (!bankTrade({ res: seat.purse }, surplus, "ore", undefined, GOLD_BLOCKED)) return;
    trades++;
  }
}

/**
 * The 4:1 bank on a stalled turn — a port of the rival's `rivalBankTowardPlan`,
 * including VP-01's rule that the bank may be pointed at the SCOREboard (Ore
 * for paves) when that milestone is closer than the next Depot. Two exchanges a
 * turn, gold never, and it targets the plan with the SMALLEST shortfall, which
 * is what keeps a stalled seat from chasing a moving target forever.
 */
function bankToward(eco: EconomyState, seat: Seat, track: Track, f: Factory, pace: RivalPace) {
  // Price the transport plan with a hypothetical deep purse: `planCandidates`
  // drops plans a purse cannot finish, and the plan to bank toward is one of
  // those (the scarcity ranking still reads the REAL stock).
  const deep: Purse = { ...seat.purse };
  for (const c of CARGOES) deep[c] = (deep[c] ?? 0) + 1_000_000;
  const cands = planCandidates(eco, f, {
    stock: seat.purse, purse: deep, free: seat.freeTrack, freeDepots: seat.freeDepots,
    oreUrgency: pace.oreUrgency,
  });
  const depot = priceDepot(seat.purse, seat.freeDepots).cost;
  const planTarget: Purse = {};
  if (cands.length) {
    const shortfall = (c: (typeof cands)[number]): number => gap(seat.purse, c.cost) + gap(seat.purse, depot);
    const chosen = [...cands].sort((a, b) => shortfall(a) - shortfall(b) || b.score - a.score)[0];
    for (const [k, v] of Object.entries(chosen.cost)) planTarget[k as Cargo] = v;
    for (const [k, v] of Object.entries(depot)) planTarget[k as Cargo] = (planTarget[k as Cargo] ?? 0) + v;
  }
  // …and the scoreboard's own milestone competes with it.
  let paveTarget: Purse | null = null;
  const ranked = paveCandidates(eco, {
    owner: seat.id, ownerId: seat.ownerId, purse: seat.purse, maxTiles: 4,
  });
  if (ranked.length) {
    let ore = 0;
    for (const t of ranked.slice(0, 4)) ore += tileCost(track, "road", t.x, t.y).ore ?? 0;
    if (ore > 0) paveTarget = { ore };
  }
  const target = paveTarget && gap(seat.purse, paveTarget) < gap(seat.purse, planTarget)
    ? paveTarget : Object.keys(planTarget).length ? planTarget : null;
  if (!target) return;

  let trades = 0;
  for (const [cargo, need] of Object.entries(target) as [Cargo, number][]) {
    while ((seat.purse[cargo] ?? 0) < need && trades < pace.bankPerTurn) {
      const surplus = (CARGOES as Cargo[])
        .filter((c) => c !== "gold" && c !== cargo && (seat.purse[c] ?? 0) >= BANK_RATE)
        .filter((c) => (seat.purse[c] ?? 0) - BANK_RATE >= (target[c] ?? 0))
        .sort((a, b) => (seat.purse[b] ?? 0) - (seat.purse[a] ?? 0))[0];
      if (!surplus) break;
      if (!bankTrade({ res: seat.purse }, surplus, cargo, undefined, GOLD_BLOCKED)) break;
      trades++;
    }
  }
}

function race(seed: number): Race {
  const grid = generateMap(seed);
  const track = createTrack();
  const eco: EconomyState = { grid, track, harvesters: [], factories: [] };
  const score = createScoreState();
  const mk = (id: string, ownerId: number): Seat => ({
    id, ownerId,
    purse: toBag(START_PURSE),
    freeTrack: FREE_SETUP_TRACK,
    freeDepots: FREE_SETUP_DEPOTS,
    lastBuild: -AI_BUILD_MS, lastHarvest: -HARVEST_MS, carry: {},
    firstPave: null, firstPoint: null, oreOnPaves: 0, paves: 0,
  });
  const seats: Seat[] = [mk("you", 1), mk("ai", 2)];

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
  expect(opening, `seed ${seed}: no legal opening site`).toBeTruthy();
  expect(rival, `seed ${seed}: no second site for the rival`).toBeTruthy();
  eco.factories.push({ owner: "you", ownerId: 1, tx: opening![0], ty: opening![1], id: 0, townId: null });
  eco.factories.push({ owner: "ai", ownerId: 2, tx: rival![0], ty: rival![1], id: 0, townId: null });

  const factoryFor = (seat: Seat) => eco.factories.find((f) => f.ownerId === seat.ownerId)!;
  let nextHarvesterId = 1;
  const trace: Race["trace"] = [];
  let winner: Race["winner"] = null;

  for (let t = 0; t <= RACE_MS && !winner; t += STEP_MS) {
    for (const seat of seats) {
      // ── the build clock: `aiTick`'s actions, most valuable first, each one
      //    paying for itself before it is applied
      if (t - seat.lastBuild >= AI_BUILD_MS) {
        seat.lastBuild = t;
        let acted = false;
        // VP-01: the same read of the scoreboard the shipped rival makes. The
        // OTHER seat's total is what a seat reacts to, and BOTH seats run the
        // policy — the only way to measure whether catching up helps at all.
        const pace = rivalPace(
          vpFor(score, seat.id === "you" ? "ai" : "you"), vpFor(score, seat.id), VP_TARGET,
        );

        if (canAffordPlant(seat.purse)) {
          const spot = chooseAiPlantSpot(grid, track, eco, seat.id);
          if (spot && pay(seat, PLANT_COST)) {
            addPlant(grid, track, eco, seat.id, seat.ownerId, spot[0], spot[1]);
            acted = true;
          }
        }
        const built = aiBuildStep(eco, factoryFor(seat), {
          stock: seat.purse, purse: seat.purse,
          free: seat.freeTrack, freeDepots: seat.freeDepots, now: t,
          oreUrgency: pace.oreUrgency,
        }, nextHarvesterId);
        if (built) {
          nextHarvesterId++;
          seat.freeTrack = Math.max(0, seat.freeTrack - built.free);
          seat.freeDepots = Math.max(0, seat.freeDepots - built.freeDepots);
          pay(seat, built.spent);
          acted = true;
        }
        const plan = planUpgrades(eco, {
          owner: seat.id, ownerId: seat.ownerId, purse: seat.purse, maxTiles: 8,
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
          bankForPaves(eco, seat, track, pace);
        }
        if (!acted) {
          bankToward(eco, seat, track, factoryFor(seat), pace);
          // the game retries the whole sequence once a bank unlocked something
          const retry = planUpgrades(eco, {
            owner: seat.id, ownerId: seat.ownerId, purse: seat.purse, maxTiles: 8,
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
          if (seat.firstPoint === null && vpFor(score, seat.id) > 0) seat.firstPoint = t;
          if (hasWon(score, seat.id)) winner = { id: seat.id, at: t };
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
    if (t % 60_000 === 0) trace.push({ t, you: vpFor(score, "you"), ai: vpFor(score, "ai") });
  }
  return {
    seed, minutes: Math.round(trace.length ? (trace[trace.length - 1].t - trace[0].t) / 60_000 : 0),
    eco, seats,
    vp: { you: vpFor(score, "you"), ai: vpFor(score, "ai") },
    trace, winner,
  };
}

/** How many of `ownerId`'s tiles on the board carry pave provenance. */
function pavedCount(track: Track, ownerId: number): number {
  let n = 0;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (track.owner[tIdx(x, y)] !== ownerId) continue;
      if (isUpgradedRoad(track, x, y)) n++;
    }
  }
  return n;
}

/** Tiles of one tier owned by `ownerId` — the stall diagnostics, above. */
function countTier(track: Track, kind: "dirt" | "road", ownerId: number): number {
  let n = 0;
  for (let i = 0; i < track[kind].length; i++) {
    if ((track[kind][i] & 16) !== 0 && track.owner[i] === ownerId) n++;
  }
  return n;
}

/** The seat's own pace over the second half of the run, in ★ per minute. */
function pacePerMinute(r: Race, key: "you" | "ai"): number {
  const half = r.trace.slice(Math.floor(r.trace.length / 2));
  if (half.length < 2) return 0;
  const first = half[0], last = half[half.length - 1];
  const minutes = (last.t - first.t) / 60_000;
  return minutes <= 0 ? 0 : (last[key] - first[key]) / minutes;
}

describe("VP-01 the race to ten", () => {
  const races = SEEDS.map(race);

  it("prints the pace for the playtest report", () => {
    for (const r of races) {
      console.log(`seed ${r.seed} (${RACE_MINUTES}m window)`, JSON.stringify(r.seats.map((s) => ({
        seat: s.id,
        firstPoint: s.firstPoint === null ? "—" : MIN(s.firstPoint),
        firstPave: s.firstPave === null ? "—" : MIN(s.firstPave),
        paves: s.paves,
        oreOnPaves: s.oreOnPaves,
        vp: r.vp[s.id],
        // the tail of the state that explains a stall, printed rather than
        // asserted: a seat stops scoring for a reason, and it is nearly always
        // here (no ore, and no paveable gravel left to bank toward)
        gravel: countTier(r.eco.track, "dirt", s.ownerId),
        tarmac: countTier(r.eco.track, "road", s.ownerId),
        depots: r.eco.harvesters.filter((h) => h.owner === s.id).length,
        plants: plantsOf(r.eco, s.id).length,
        purse: Object.fromEntries(
          Object.entries(s.purse).filter(([k, v]) => k !== "gold" && (v as number) > 0),
        ),
      }))));
      console.log("  winner:", r.winner
        ? `${r.winner.id} at ${MIN(r.winner.at)} (${r.vp[r.winner.id]}★)`
        : `none inside ${RACE_MINUTES}m — leader ${r.vp.you >= r.vp.ai ? "you" : "ai"} at ${Math.max(r.vp.you, r.vp.ai)}★`);
      console.table(r.trace.map((p) => ({ minute: Math.round(p.t / 60_000), you: p.you, ai: p.ai })));
    }
    expect(races.length).toBe(SEEDS.length);
  }, 900_000);

  it("both seats score off paving, inside the opening", () => {
    for (const r of races) {
      for (const seat of r.seats) {
        expect(seat.firstPoint, `seed ${r.seed}/${seat.id} never scored`).not.toBeNull();
        // Three build turns of a rival's opening — two free dirt legs and the
        // bank converting wood into the first Ore — must be enough to put a
        // point on the board. A seat that cannot do that is a seat whose
        // planner is not playing the victory condition at all.
        expect(seat.firstPoint!, `seed ${r.seed}/${seat.id} first scored at ${MIN(seat.firstPoint!)}`)
          .toBeLessThanOrEqual(3 * 60_000);
        // …and it PAVED, which is the half of the plan the old AI never had.
        expect(seat.firstPave, `seed ${r.seed}/${seat.id} never paved a tile`).not.toBeNull();
        expect(seat.firstPave!).toBeLessThanOrEqual(5 * 60_000);
        expect(seat.oreOnPaves).toBeGreaterThan(0);
      }
    }
  }, 900_000);

  it("the total is always exactly what the board says it is", () => {
    for (const r of races) {
      for (const seat of r.seats) {
        const bd = victoryBreakdown(r.eco, seat.id);
        const onBoard = pavedCount(r.eco.track, seat.ownerId);
        expect(bd.paved, `seed ${r.seed}/${seat.id}: score ${bd.paved}, map ${onBoard}`).toBe(onBoard);
        // the free opening Factory is plant #0 and earns nothing, ever
        expect(bd.plants).toBe(Math.max(0, plantsOf(r.eco, seat.id).length - 1));
        expect(bd.pavedVp).toBe(bd.paved * VICTORY.upgrade);
        expect(bd.plantVp).toBe(bd.plants * VICTORY.plant);
        expect(bd.pavedVp + bd.plantVp).toBeCloseTo(r.vp[seat.id], 6);
        // the seat's own count of laid paves matches the scoreboard it earned
        expect(bd.paved).toBe(seat.paves);
      }
    }
  }, 900_000);

  it("the scoreboard never moves backwards while nothing is demolished", () => {
    // The one invariant a diff-based scorer can quietly break: if `rescore` ever
    // lost a ledger entry, a long game would drift. Nothing in this sim tears
    // anything up, so each seat's VP must be monotonically non-decreasing.
    for (const r of races) {
      for (const key of ["you", "ai"] as const) {
        for (let i = 1; i < r.trace.length; i++) {
          expect(r.trace[i][key], `seed ${r.seed} minute ${i}: ${key} lost points`)
            .toBeGreaterThanOrEqual(r.trace[i - 1][key]);
        }
      }
    }
  }, 900_000);

  it("a game ends: someone reaches 10★, and the other seat was racing", () => {
    for (const r of races) {
      const trailer = Math.min(r.vp.you, r.vp.ai);
      expect(r.winner, `seed ${r.seed}: no seat reached ${VP_TARGET}★ in ${RACE_MINUTES} minutes`).toBeTruthy();
      expect(r.winner!.at).toBeLessThanOrEqual(RACE_MS);
      const win = r.vp[r.winner!.id];
      // The check runs once a turn, after the whole turn's scoring has landed,
      // so a seat can cross the line by more than one point's worth in a single
      // turn — eight paves AND a plant (seed 2024 finished at 10.25★). That is
      // the design: the banner prints the true total, and what must not happen
      // is the win check LAGGING, i.e. a seat sitting on 13★ because the gate
      // was only consulted at the top of a turn. So the overshoot is bounded by
      // one turn's maximum, which is exactly what `applyVpEvents` can aggregate.
      expect(win).toBeGreaterThanOrEqual(VP_TARGET);
      expect(win).toBeLessThan(VP_TARGET + 8 * VICTORY.upgrade + VICTORY.plant);
      expect(trailer, `seed ${r.seed}: the loser never scored at all`).toBeGreaterThan(0);
      // and the loser got a real game in: at least a quarter of the target, so
      // "the AI can play the new condition" is not a one-seat accident
      expect(trailer).toBeGreaterThanOrEqual(VP_TARGET / 4);
    }
  }, 900_000);

  it("nobody wins it by pottering: the pace is monotone and the paving carries", () => {
    for (const r of races) {
      // What "pottering" means here, in the order of how much it hurts:
      // (1) no seat's score may go DOWN (nothing in the race demolishes), and
      // (2) the seat that WON must still have been gaining in the second half —
      //     a game decided by an early lead nobody defended is a stall with a
      //     trophy at the end. A LOSER plateauing is not asserted: Ore is the
      //     only cargo that scores, and a seat whose gravel ends up under rough
      //     ground (paved Roads cannot cross rock) has no legal point left to
      //     make, whatever its purse. seed 2024's rival finished 6.5★ that way —
      //     27 owned gravel tiles, not one paveable — and the terrain, not the
      //     AI, is why. The stall this harness exists to catch is the 0★-forever
      //     one, and "both seats score off paving, inside the opening" owns it.
      for (const seat of r.seats) {
        const key = seat.id as "you" | "ai";
        expect(pacePerMinute(r, key), `seed ${r.seed}: ${key} lost points mid-race`)
          .toBeGreaterThanOrEqual(0);
      }
      if (r.winner) {
        const wk = r.winner.id as "you" | "ai";
        expect(pacePerMinute(r, wk), `seed ${r.seed}: the winner stopped scoring before it won`)
          .toBeGreaterThan(0);
      }
      // more than half of every seat's score came from paving, which is the
      // behaviour the ticket asked the AI to have
      for (const seat of r.seats) {
        const bd = victoryBreakdown(r.eco, seat.id);
        expect(bd.pavedVp + bd.plantVp).toBeCloseTo(r.vp[seat.id], 6);
        expect(bd.paved).toBeGreaterThan(bd.plants);
        expect(seat.oreOnPaves).toBe(bd.paved * (4));      // 4 Ore a tile, always
      }
    }
  }, 900_000);
});
