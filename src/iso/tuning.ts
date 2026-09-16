// ══════════════════════════════════════════════════════════════════════════
// L4 (#218) — the TUNING EVENT: match-3 sets a depot's yield level.
// L6 (#220) — and the difficulty flags that decide how that level maps,
// cools and re-matches.
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
//   • `takeTuningMove` / `recordTuningCleared` — the only two things that
//     happen to a session: a move is spent, and the gems that move cleared are
//     scored;
//   • `tuningYieldFor(score, floor)` — the ONE mapping from score to yield,
//     clamped to [floor, maxYield] and rounded to two decimals so the number the
//     HUD shows and the number stored on the depot are the same number;
//   • `rivalTuningYield(skill)` — the rival's simulated session result, so it
//     needs no visible board (AI-03's autoplay stays a thing you can WATCH;
//     it is no longer how its depots get their yield).
//
// L6 added three more, all of them READING the same row of `DIFFICULTY_RULES`
// (`config.ts`) so the difficulty is data and never a second codepath:
//
//   • `settleTuningYield(prev, score, rules)` — what a finished session SETS
//     the depot to, including the "yield never drops" clamp (Easy, Normal) and
//     the row where a bad session is allowed to bite (Hard);
//   • `decayYield(current, rules)` — one economy tick of cooling. A zero
//     `decayRate` (Easy, Normal) returns null, which is why `economyTick` can
//     call it for every difficulty on the same line;
//   • `retuneOwed(rules, depot)` — whether the plant panel offers a re-match at
//     all, and whether THIS Depot has earned one.
//
// Everything that reads these — the board hooks, the HUD plate, the wire, the
// clock — goes through this file, so "what a session is worth" has exactly one
// answer per difficulty, and each of the three answers is the same code.
// ══════════════════════════════════════════════════════════════════════════
import {
  CARGO, DEFAULT_DIFFICULTY, DIFFICULTY_RULES, TUNING,
  type Cargo, type DifficultyKey, type DifficultyRules,
} from "./config";
import { RIVAL_SKILLS, type SkillKey } from "./skill";

/** Round to the two decimals the HUD prints and the depot stores. */
export const roundYield = (y: number): number => Math.round(y * 100) / 100;

/** Clamp any yield (a wire value, a save, a hand-edited test) into range. */
export const clampYield = (y: number): number =>
  roundYield(Math.min(TUNING.maxYield, Math.max(TUNING.minYield, Number.isFinite(y) ? y : TUNING.minYield)));

// ══════════════════════════════════════════════════════════════════════════
// L6 (#220) — the difficulty, as the numbers a session is played under.
//
// `DIFFICULTY_RULES` in `config.ts` is the table; this is the only reader of it
// on the tuning side. Note which functions take the GLOBAL clamp (a wire value
// or a save is sanitised against `TUNING`, whatever difficulty wrote it) and
// which take the difficulty's FLOOR (what a session is worth today). The
// difference is the whole reason Easy can be generous without lying to the
// wire: an Easy Depot's ×1.5 floor never rewrites a ×1.0 level that arrives
// from a Normal or Hard game.
// ══════════════════════════════════════════════════════════════════════════

/** The rules a session is played under, read off the live difficulty key. */
export const difficultyRulesFor = (key: DifficultyKey): DifficultyRules =>
  DIFFICULTY_RULES[key] ?? DIFFICULTY_RULES[DEFAULT_DIFFICULTY];

/**
 * The yield a score earns. Linear between `floor` (score 0 — the baseline an
 * untuned depot runs at, so abandoning a session is never a penalty) and
 * `maxYield` at `TUNING.targetScore` and beyond.
 *
 * `floor` is the difficulty's `minYield` (L6): Easy lifts it to 1.5 so a weak
 * session still gives a decent Depot, while Normal and Hard keep the shipped
 * baseline. Omitted, it is the shipped table — which is what the L4 tests and
 * any caller without a live difficulty get.
 */
export function tuningYieldFor(score: number, floor: number = TUNING.minYield): number {
  if (!Number.isFinite(score) || score <= 0) return clampYield(floor);
  const t = Math.min(1, score / TUNING.targetScore);
  return clampYield(floor + (TUNING.maxYield - floor) * t);
}

/** What ABANDONING a session pays, for this difficulty (L6: Easy's is raised). */
export const abandonYieldFor = (rules: DifficultyRules): number => clampYield(rules.minYield);

/** What a Depot is BORN with, before any session, on this difficulty. */
export const birthYieldFor = (rules: DifficultyRules): number => clampYield(rules.minYield);

/**
 * What a finished session SETS the Depot's yield to.
 *
 * The one place the "yield never drops" rule lives: it maps the session's score
 * onto the difficulty's floor and, on `yieldNeverDrops`, keeps the better of
 * the old and new levels — so Easy's build session and Normal's per-upgrade
 * re-match can only ever be an improvement, while Hard takes the new number
 * whatever it is, which is what makes a bad re-match a real risk.
 */
export function settleTuningYield(
  prev: number | undefined, score: number, rules: DifficultyRules,
  opts: { abandon?: boolean } = {},
): number {
  const base = prev ?? rules.minYield;
  const next = opts.abandon ? abandonYieldFor(rules) : tuningYieldFor(score, rules.minYield);
  return roundYield(rules.yieldNeverDrops ? Math.max(base, next) : next);
}

/**
 * One economy tick of cooling, for a depot that stores `current` (`undefined`
 * = never tuned). Returns the level to store, or `null` when nothing changed.
 *
 * Decay eats the SURPLUS above the difficulty's floor, so a Depot cools toward
 * the rate an untuned Depot ticks at and never below it — Hard punishes a stale
 * tune, it does not starve a player. `decayRate === 0` on Easy and Normal,
 * which is exactly why `economyTick` calls this for every difficulty on the
 * same line instead of branching on which one is on.
 *
 * The "a decay too small to print ends the cooling at the floor" step is not a
 * nicety: yields are stored to two decimals (the HUD prints that number and the
 * wire carries it), so a surplus under a cent would otherwise leave a Depot
 * ticking at ×1.01 forever.
 */
export function decayYield(current: number | undefined, rules: DifficultyRules): number | null {
  if (rules.decayRate <= 0 || current === undefined) return null;
  const cur = clampYield(current);
  const floor = clampYield(rules.minYield);
  if (cur <= floor) return null;
  const cooled = roundYield(floor + (cur - floor) * (1 - rules.decayRate));
  return cooled < cur ? cooled : floor;
}

/**
 * May THIS Depot be re-tuned? (L6 — the re-match policy, one predicate.)
 *
 *   • `rematch: "never"` (Easy) — the build session is the only one there is.
 *     "No forced return" is a rule and not a courtesy: nothing in the game
 *     offers a second board on Easy, and the plant plate says so instead of
 *     showing a key that would refuse to work.
 *   • `rematch: "upgrade"` (Normal) — owed once per transport tier the Depot has
 *     moved up since its last session, which is the ticket's "one match per
 *     depot/upgrade" as a comparison instead of a counter. A Depot tuned on open
 *     ground and then PAVED owes exactly one; paving it again cannot invent a
 *     second, because the tier no longer moves.
 *   • `rematch: "open"` (Hard) — always owed: cooling is the difficulty and
 *     re-tuning is the answer to it. The plate spends its one key on the
 *     LOWEST-yield Depot, so "a low-output Depot invites a re-match" is where
 *     the offer appears, and `yieldNeverDrops: false` is what makes taking that
 *     invite a risk.
 *
 * `dep.tuneTier` is the tier the Depot stood on when its last session settled
 * (undefined = never tuned — the build session is L4's and always comes first).
 */
export function retuneOwed(
  rules: DifficultyRules, dep: { tier: number; tuneTier: number | undefined },
): boolean {
  if (!rules.matchEnabled) return false;
  if (rules.rematch === "never") return false;
  if (rules.rematch === "open") return true;
  return dep.tuneTier !== undefined && dep.tier > dep.tuneTier;
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

/**
 * What this session pays if it is played out now. `floor` is the live
 * difficulty's (L6) — the plate shows the number that will actually settle, so
 * an Easy session never advertises ×1.0 for a Depot about to be set to ×1.5.
 */
export const tuningSessionYield = (s: TuningSession, floor: number = TUNING.minYield): number =>
  tuningYieldFor(s.score, floor);

/**
 * What ABANDONING pays on the SHIPPED mapping — the defined default a closed or
 * unwinnable session leaves behind, and the value a depot is born with. Never
 * below the baseline an untuned depot runs at (see `depotYield` in loop.ts), so
 * no session can ever leave a depot worse off than not having tuned it.
 *
 * L6: a game with a live difficulty reads `abandonYieldFor(rules)` /
 * `birthYieldFor(rules)` instead, because Easy raises that floor and a constant
 * cannot know which difficulty is on. This stays as the shipped-table value the
 * L4 tests and the flag-off paths pin.
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
 *
 * L6 deliberately does NOT raise this with the difficulty's `minYield`: the
 * generous Easy floor is the PLAYER's concession. Mapping the rival onto it too
 * would hand the easy chair better Depots for choosing easy, inverting the
 * ladder `iso-skill-calibration` exists to guard.
 */
export function rivalTuningYield(key: SkillKey, noise = 0): number {
  const skill = RIVAL_SKILLS[key]?.tuningSkill ?? RIVAL_SKILLS.normal.tuningSkill;
  const t = Math.min(1, Math.max(0, skill + noise));
  return clampYield(TUNING.minYield + (TUNING.maxYield - TUNING.minYield) * t);
}
