// ══════════════════════════════════════════════════════════════════════════
// MATCH-2 — the tuning SESSION, as the new board scores it.
//
// Mirrors `src/iso/tuning.ts` at 32571ece — the same record (`moves`, `used`,
// `score`), the same two things that ever happen to it (a move is spent, a
// pass is scored), the same reward points a score-paying board's `onReward`
// is worth — with the rating read off the 5★ table in `stars.ts`. In the
// repo, `tuning.ts` keeps its own copies of these and only the star functions
// change (see CHANGES.md); this module exists so the demo, the bot and the
// tests can run a whole session without the iso game behind them.
// ══════════════════════════════════════════════════════════════════════════

import { TUNING, clampYield, roundYield, tuningGoldFor, tuningStarsFor, tuningYieldFor, type TuningStars } from "./stars";
import type { BoardObstacles, RewardKind, StoneType } from "./types";
import { TUNING_REWARD_SCORE } from "../iso/tuning";

/** L12 (#227) — what each board reward is worth in session score: the game's table. */
export const REWARD_POINTS: Record<RewardKind, number> = TUNING_REWARD_SCORE;

export type DifficultyKey = "trainee" | "easy" | "normal" | "hard";

export interface ObstacleRules {
  frost: number;
  frostHard: 1 | 2;
  girders: number;
}

export interface DifficultyRules {
  minYield: number;
  yieldNeverDrops: boolean;
  obstacles: ObstacleRules;
}

/** The rows of `DIFFICULTY_RULES` the session reads (iso/config.ts). */
export const DIFFICULTY_RULES: Record<DifficultyKey, DifficultyRules> = {
  trainee: { minYield: 1.5, yieldNeverDrops: true, obstacles: { frost: 0, frostHard: 1, girders: 0 } },
  easy: { minYield: 1.5, yieldNeverDrops: true, obstacles: { frost: 0, frostHard: 1, girders: 0 } },
  normal: { minYield: TUNING.minYield, yieldNeverDrops: true, obstacles: { frost: 6, frostHard: 1, girders: 0 } },
  hard: { minYield: TUNING.minYield, yieldNeverDrops: true, obstacles: { frost: 6, frostHard: 2, girders: 3 } },
};

export const OBSTACLE_RAMP = { firstTier: 0.5, firstTierHard: 1 as 1 | 2 } as const;

/** L10 (#225): what a session opens with, ramped by the Depot's tier. */
export function sessionObstacles(rules: DifficultyRules, tier = 0): ObstacleRules {
  const row = rules.obstacles;
  if (tier > 0) return { ...row };
  return {
    frost: Math.floor(row.frost * OBSTACLE_RAMP.firstTier),
    frostHard: Math.min(row.frostHard, OBSTACLE_RAMP.firstTierHard) as 1 | 2,
    girders: Math.floor(row.girders * OBSTACLE_RAMP.firstTier),
  };
}

export interface TuningSession {
  kind: "depot" | "town";
  depotId: number;
  cargo: StoneType | null;
  moves: number;
  used: number;
  score: number;
  /** MATCH-2: what the board opened with (the intro line, the results card). */
  opened: BoardObstacles;
  /** MATCH-2: the session's own tally, for the results card and the balance sweep. */
  tally: { cleared: number; rewards: Partial<Record<RewardKind, number>>; bombs: number; maxChain: number; passes: number };
}

export const TOWN_SESSION_ID = -1;

export function createTuningSession(depotId: number, cargo: StoneType | null, moves: number = TUNING.moves): TuningSession {
  return {
    kind: cargo ? "depot" : "town",
    depotId: cargo ? depotId : TOWN_SESSION_ID,
    cargo,
    moves,
    used: 0,
    score: 0,
    opened: { frost: 0, girders: 0, frostHard: 1 },
    tally: { cleared: 0, rewards: {}, bombs: 0, maxChain: 0, passes: 0 },
  };
}

export const tuningMovesLeft = (s: TuningSession): number => Math.max(0, s.moves - s.used);
export const tuningOver = (s: TuningSession): boolean => tuningMovesLeft(s) <= 0;

export function takeTuningMove(s: TuningSession): void {
  if (s.used < s.moves) s.used++;
}

export function recordTuningCleared(s: TuningSession, cleared: number, chain = 1): void {
  if (!Number.isFinite(cleared) || cleared <= 0) return;
  s.score += cleared;
  s.tally.cleared += cleared;
  s.tally.passes++;
  s.tally.maxChain = Math.max(s.tally.maxChain, chain);
}

export function recordTuningReward(s: TuningSession, kind: RewardKind): void {
  const pts = REWARD_POINTS[kind] ?? 0;
  s.score += pts;
  s.tally.rewards[kind] = (s.tally.rewards[kind] ?? 0) + 1;
}

export const tuningSessionStars = (s: TuningSession): TuningStars => tuningStarsFor(s.score);
export const tuningSessionYield = (s: TuningSession, floor: number = TUNING.minYield): number => tuningYieldFor(s.score, floor);

export function settleTuningYield(prev: number | undefined, score: number, rules: DifficultyRules, opts: { abandon?: boolean; cap?: number } = {}): number {
  const base = prev ?? rules.minYield;
  let next = opts.abandon ? clampYield(rules.minYield) : tuningYieldFor(score, rules.minYield);
  if (opts.cap !== undefined) next = Math.min(next, opts.cap);
  return roundYield(rules.yieldNeverDrops ? Math.max(base, next) : next);
}

export interface TuningOutcome {
  score: number;
  stars: TuningStars;
  from: number;
  raw: number;
  yield: number;
  cap?: number;
  capped: boolean;
  kept: boolean;
  gold: number;
}

/** #300 — a Depot session's whole settlement, as numbers (5★ edition). */
export function depotSessionOutcome(score: number, prev: number | undefined, rules: DifficultyRules, opts: { cap?: number; abandon?: boolean } = {}): TuningOutcome {
  const abandon = opts.abandon === true;
  const s = Number.isFinite(score) && score > 0 ? score : 0;
  const raw = abandon ? clampYield(rules.minYield) : tuningYieldFor(s, rules.minYield);
  const set = settleTuningYield(prev, s, rules, { abandon, cap: opts.cap });
  const earned = roundYield(opts.cap !== undefined ? Math.min(raw, opts.cap) : raw);
  return {
    score: s,
    stars: abandon ? 0 : tuningStarsFor(s),
    from: roundYield(prev ?? rules.minYield),
    raw,
    yield: set,
    cap: opts.cap,
    capped: !abandon && opts.cap !== undefined && raw > opts.cap,
    kept: set > earned,
    gold: abandon ? 0 : tuningGoldFor(s),
  };
}

/** The session intro's one in-world sentence about its obstacles. */
export function obstacleIntroLine(plan: BoardObstacles): string {
  const parts: string[] = [];
  if (plan.frost > 0) parts.push(`${plan.frost} stones under ${plan.frostHard === 2 ? "thick" : "thin"} frost`);
  if (plan.girders > 0) parts.push(`${plan.girders} iron girder${plan.girders === 1 ? "" : "s"} on the line`);
  return parts.length ? `The yard opens with ${parts.join(" and ")}.` : "The yard opens clean.";
}
