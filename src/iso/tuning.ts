// ══════════════════════════════════════════════════════════════════════════
// L4 (#218) — the TUNING EVENT: match-3 sets a depot's yield level.
//
// The redesign's core rule. Before this module the board was an always-on
// machine that paid cargo into the purse; from here the board is a bounded,
// once-per-depot SESSION whose only output is a YIELD LEVEL on the depot it
// was opened for — and the clock in `economyTick` (L1b) turns that level into
// cargo per tick. Better matching → higher yield → faster ticks.
//
// The shape, and why it is a pure module with no DOM and no game state:
//
//   • `createTuningSession(depot, cargo)` — a budget of `TUNING.moves` moves,
//     a score of 0, the cargo colour the depot collects;
//   • `takeMove` / `recordCleared` — the only two things that happen to a
//     session: a move is spent, and the gems that move cleared are scored;
//   • `tuningYieldFor(score)` — the ONE mapping from score to yield, clamped
//     to [minYield, maxYield] and rounded to two decimals so the number the
//     HUD shows and the number stored on the depot are the same number;
//   • `rivalTuningYield(skill)` — the rival's simulated session result, so it
//     needs no visible board (AI-03's autoplay stays a thing you can WATCH;
//     it is no longer how its depots get their yield).
//
// Everything that reads these — the board hooks, the HUD plate, the wire —
// goes through this file, so "what a session is worth" has exactly one answer.
//
// Difficulty (#220, post-MVP) changes only the numbers a session is played
// under (moves, decay, obstacles), never whether a session exists: match-3
// stays on every difficulty.
// ══════════════════════════════════════════════════════════════════════════
import { CARGO, TUNING, type Cargo } from "./config";
import { RIVAL_SKILLS, type SkillKey } from "./skill";

/** Round to the two decimals the HUD prints and the depot stores. */
export const roundYield = (y: number): number => Math.round(y * 100) / 100;

/** Clamp any yield (a wire value, a save, a hand-edited test) into range. */
export const clampYield = (y: number): number =>
  roundYield(Math.min(TUNING.maxYield, Math.max(TUNING.minYield, Number.isFinite(y) ? y : TUNING.minYield)));

/**
 * The yield a score earns. Linear between `minYield` (score 0 — the same
 * baseline an untuned depot runs at, so abandoning a session is never a
 * penalty) and `maxYield` at `TUNING.targetScore` and beyond.
 */
export function tuningYieldFor(score: number): number {
  if (!Number.isFinite(score) || score <= 0) return TUNING.minYield;
  const t = Math.min(1, score / TUNING.targetScore);
  return clampYield(TUNING.minYield + (TUNING.maxYield - TUNING.minYield) * t);
}

/**
 * A session in progress. Mutable on purpose — it is one small record with one
 * writer (the game), read by the HUD every frame.
 */
export interface TuningSession {
  /** The depot this session will set the yield of (`Harvester.id`). */
  depotId: number;
  /** The cargo the depot collects — what the board spawns mostly of. */
  cargo: Cargo;
  /** Moves the session was opened with. */
  moves: number;
  /** Moves spent so far. */
  used: number;
  /** Gems cleared in this session. */
  score: number;
}

export const createTuningSession = (depotId: number, cargo: Cargo): TuningSession => ({
  depotId, cargo, moves: TUNING.moves, used: 0, score: 0,
});

/** Moves the player has left. 0 = the session is over and will settle. */
export const tuningMovesLeft = (s: TuningSession): number => Math.max(0, s.moves - s.used);

/** Is the budget spent? (The board may still be mid-cascade when this flips.) */
export const tuningOver = (s: TuningSession): boolean => tuningMovesLeft(s) <= 0;

/**
 * Spend one move. Returns false when the budget is gone — the caller refuses
 * the swap rather than letting a session run past its bound.
 */
export function takeTuningMove(s: TuningSession): boolean {
  if (tuningMovesLeft(s) <= 0) return false;
  s.used++;
  return true;
}

/** Score the gems a resolved pass cleared. */
export function recordTuningCleared(s: TuningSession, cleared: number): void {
  if (Number.isFinite(cleared) && cleared > 0) s.score += cleared;
}

/** What this session pays if it is played out now. */
export const tuningSessionYield = (s: TuningSession): number => tuningYieldFor(s.score);

/**
 * What ABANDONING pays — the defined default a closed or unwinnable session
 * leaves behind, and the value a depot is born with. Never below the baseline
 * an untuned depot runs at (see `depotYield` in loop.ts), so no session can
 * ever leave a depot worse off than not having tuned it.
 */
export const TUNING_ABANDON_YIELD = TUNING.minYield;

/** "🌾 Grain" for the HUD plate and the toasts. */
export const tuningCargoLabel = (cargo: Cargo): string => `${CARGO[cargo].icon} ${CARGO[cargo].name}`;

/**
 * The rival's result for a depot it just built, read off its difficulty.
 *
 * AI-03's autoplay is still there to watch, but a simulated session is what a
 * rival depot's yield comes from — the rival is never made to play a board it
 * cannot be bothered to open, and the number is deterministic per skill (the
 * caller's `noise` is the seeded RNG where it has one).
 */
export function rivalTuningYield(key: SkillKey, noise = 0): number {
  const skill = RIVAL_SKILLS[key]?.tuningSkill ?? RIVAL_SKILLS.normal.tuningSkill;
  const t = Math.min(1, Math.max(0, skill + noise));
  return clampYield(TUNING.minYield + (TUNING.maxYield - TUNING.minYield) * t);
}
