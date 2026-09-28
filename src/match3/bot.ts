// ══════════════════════════════════════════════════════════════════════════
// MATCH-2 — the scripted player, and the balance sweep it drives.
//
// Three profiles, all of them playing the SAME session the game opens (the
// depot board: cargo-biased refill, the difficulty's obstacles, ten moves,
// score = gems cleared + reward points), on the engine with no timers:
//
//   random     any legal swap — the floor;
//   average    sees the biggest immediate match a little over half the time
//              and otherwise takes whatever is in front of them; never plans
//              a cascade. This is "a simulated average player";
//   competent  always the biggest immediate gain, ties broken toward the
//              bottom of the board (more falls behind it) and toward a bomb
//              carried into the biased colour. "A competent player".
//
// Everything rolls on ONE mulberry32 stream per session — the board's deal,
// the refill AND the bot's own coin flips — so a seed is a full replay.
// `runBalanceSweep` is what `tests/unit/match3-balance-bot.test.ts` pins:
// the average profile's mean stars, and the competent profile's 5★ rate.
// ══════════════════════════════════════════════════════════════════════════

import { Match3Engine, type Move } from "./engine";
import { mulberry32, type Rng } from "./rng";
import {
  DIFFICULTY_RULES,
  createTuningSession,
  recordTuningCleared,
  recordTuningReward,
  sessionObstacles,
  takeTuningMove,
  tuningOver,
  type DifficultyKey,
  type TuningSession,
} from "./session";
import { TUNING, tuningStarsFor, type TuningStars } from "./stars";
import { STONE_TO_RES, type BoardPhase, type StoneType } from "./types";

export type BotProfile = "random" | "average" | "competent";

export interface BotSessionOptions {
  seed: number;
  profile: BotProfile;
  difficulty?: DifficultyKey;
  cargo?: StoneType | null;
  /** The Depot's transport tier (ramps the obstacles). Default 1 = the full row. */
  tier?: number;
  moves?: number;
}

export interface BotSessionResult {
  seed: number;
  profile: BotProfile;
  score: number;
  stars: TuningStars;
  session: TuningSession;
  /** Moves that resolved (a dud swap is not spent — same as the game). */
  movesPlayed: number;
}

/** The share of moves the average profile actually looks for the best swap. */
export const AVERAGE_LOOKS = 0.55;

/** The move a profile plays on this board (exported for the demo's autoplay). */
export function chooseBotMove(engine: Match3Engine, profile: BotProfile, rng: Rng): Move | null {
  return pickMove(engine, profile, rng);
}

function pickMove(engine: Match3Engine, profile: BotProfile, rng: Rng): Move | null {
  const legal = engine.legalMoves();
  if (!legal.length) return engine.findMove();
  if (profile === "random") return legal[Math.floor(rng() * legal.length)].move;
  if (profile === "average" && rng() >= AVERAGE_LOOKS) return legal[Math.floor(rng() * legal.length)].move;
  let best = legal[0];
  for (const cand of legal) {
    if (cand.gain > best.gain) best = cand;
    else if (profile === "competent" && cand.gain === best.gain) {
      // deeper on the board → more falls behind the clear → more cascades
      const depth = (m: Move) => Math.max(m[0], m[2]);
      if (depth(cand.move) > depth(best.move)) best = cand;
    }
  }
  return best.move;
}

/** Play one whole session headless and rate it. */
export function simulateSession(opts: BotSessionOptions): BotSessionResult {
  const rng = mulberry32(opts.seed);
  const difficulty = opts.difficulty ?? "normal";
  const cargo = opts.cargo === undefined ? "grain" : opts.cargo;
  const rules = DIFFICULTY_RULES[difficulty];
  const engine = new Match3Engine({ rng });
  engine.paysScore = true;
  if (cargo) engine.setBias(STONE_TO_RES[cargo], TUNING.cargoBias);
  if (cargo === "gold") engine.setGoldEnabled(true);
  const session = createTuningSession(1, cargo, opts.moves ?? TUNING.moves);
  const plan = sessionObstacles(rules, opts.tier ?? 1);
  session.opened = engine.seedObstacles(plan.frost, plan.girders, plan.frostHard);

  const onPhase = (p: BoardPhase) => {
    if (p.type === "clear") {
      for (const k of p.rewards) recordTuningReward(session, k);
      for (const x of p.crosses) recordTuningReward(session, x.kind === "holy" ? "holyCross" : "brokenCross");
      if (p.cleared) recordTuningCleared(session, p.cleared, p.chain);
      if (p.minted.some((m) => m.what === "bomb")) session.tally.bombs++;
    } else if (p.type === "bombClear") {
      for (const k of p.rewards) recordTuningReward(session, k);
      recordTuningCleared(session, p.cleared, 2);
    } else if (p.type === "end" && p.maxChain >= 2) {
      // the adapter banks a combo per 2-deep cascade; every second one pays
      engine.comboCount++;
      if (engine.comboCount >= Match3Engine.COMBOS_PER_GOLD) {
        engine.comboCount -= Match3Engine.COMBOS_PER_GOLD;
        recordTuningReward(session, "combo");
      }
    }
  };

  let movesPlayed = 0;
  let guard = 0;
  while (!tuningOver(session) && guard++ < 200) {
    const mv = pickMove(engine, opts.profile, rng);
    if (!mv) {
      engine.reshuffleGrid();
      continue;
    }
    let reverted = false;
    engine.drain(engine.resolveSwap(mv[0], mv[1], mv[2], mv[3]), (p) => {
      if (p.type === "revert") reverted = true;
      onPhase(p);
    });
    if (reverted) continue;
    takeTuningMove(session);
    movesPlayed++;
  }
  return { seed: opts.seed, profile: opts.profile, score: session.score, stars: tuningStarsFor(session.score), session, movesPlayed };
}

export interface SweepSummary {
  profile: BotProfile;
  sessions: number;
  meanScore: number;
  meanStars: number;
  /** Share of sessions at each star count, index = stars (0…5). */
  starShare: number[];
  fiveStarRate: number;
  fourPlusRate: number;
  minScore: number;
  maxScore: number;
  p50: number;
  p90: number;
  p99: number;
  results: BotSessionResult[];
}

/** N seeded sessions of one profile, summarised for the gate and the lab. */
export function runBalanceSweep(profile: BotProfile, sessions = 200, opts: Partial<Omit<BotSessionOptions, "seed" | "profile">> & { seedBase?: number } = {}): SweepSummary {
  const base = opts.seedBase ?? 1000;
  const results: BotSessionResult[] = [];
  for (let i = 0; i < sessions; i++) {
    results.push(simulateSession({ seed: base + i * 7919, profile, difficulty: opts.difficulty, cargo: opts.cargo, tier: opts.tier, moves: opts.moves }));
  }
  const scores = results.map((r) => r.score).sort((a, b) => a - b);
  const q = (p: number) => scores[Math.min(scores.length - 1, Math.floor(p * scores.length))] ?? 0;
  const starShare = [0, 0, 0, 0, 0, 0];
  for (const r of results) starShare[r.stars] += 1 / results.length;
  return {
    profile,
    sessions,
    meanScore: scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length),
    meanStars: results.reduce((a, r) => a + r.stars, 0) / Math.max(1, results.length),
    starShare,
    fiveStarRate: starShare[5],
    fourPlusRate: starShare[4] + starShare[5],
    minScore: scores[0] ?? 0,
    maxScore: scores[scores.length - 1] ?? 0,
    p50: q(0.5),
    p90: q(0.9),
    p99: q(0.99),
    results,
  };
}

/** The acceptance gate, as one predicate the test and the lab both read. */
export const BALANCE_GATE = {
  averageMeanStars: 2.0,
  averageTolerance: 0.3,
  competentFiveStarMax: 0.05,
} as const;

export function balanceGate(average: SweepSummary, competent: SweepSummary): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (Math.abs(average.meanStars - BALANCE_GATE.averageMeanStars) > BALANCE_GATE.averageTolerance) {
    reasons.push(`average player mean ${average.meanStars.toFixed(2)}★ is outside ${BALANCE_GATE.averageMeanStars} ± ${BALANCE_GATE.averageTolerance}`);
  }
  if (competent.fiveStarRate >= BALANCE_GATE.competentFiveStarMax) {
    reasons.push(`competent player hits 5★ in ${(competent.fiveStarRate * 100).toFixed(1)}% of sessions (limit ${BALANCE_GATE.competentFiveStarMax * 100}%)`);
  }
  return { pass: reasons.length === 0, reasons };
}
