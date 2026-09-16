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
import { CARGO, DEPOT_TIER_MAX, TUNING, type Cargo } from "./config";
import { RIVAL_SKILLS, type SkillKey } from "./skill";
import type { RewardKind } from "../game/board";

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
 * L9 (#224) — the Gold a session's score pays.
 *
 * The new loop's replacement for combo Gold (`Board.COMBOS_PER_GOLD`, which
 * stops paying under the flag): the same burst of matching that sets a Depot's
 * yield also banks the coins the Black Market's two map cards are bought with.
 *
 *   score 0            0 — a session nobody played pays nothing;
 *   any score          at least `TUNING.minGold`;
 *   `targetScore`+     `TUNING.maxGold`.
 *
 * Whole coins only (Gold is a counted cargo, not a fraction), and monotone in
 * the score, so a better session is never worth less.
 */
export function tuningGoldFor(score: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  const t = Math.min(1, score / TUNING.targetScore);
  return Math.max(TUNING.minGold, Math.round(TUNING.minGold + (TUNING.maxGold - TUNING.minGold) * t));
}

/**
 * L12 (#227) — what each board REWARD is worth in session score, on top of
 * the plain gems the pass already cleared (`onClear` scores those by count).
 *
 * The board reports the event, never the value — this table is the single
 * place the value lives, so tuning a reward's worth is a one-line change and
 * the "bigger shape pays more" rule the issue asks for is visible in one
 * glance: a holy cross (the 3×4 shape) outscores a broken cross, both
 * outscore the smaller shapes, and a combo — a cascade that kept going —
 * pays on its own.
 *
 * Plain gems still score 1 apiece (the board's `onClear` count), so a 3-match
 * is worth 3; the numbers below are the BONUS a shape or event adds.
 */
export const TUNING_REWARD_SCORE: Record<RewardKind, number> = {
  holyCross: 10,
  brokenCross: 5,
  shape: 2,     // a match-5 or L-shape
  combo: 2,     // a cascade that ran two deep
  frost: 1,     // one step of frost cracked off a gem
  girder: 2,    // a girder broken by an adjacent match
};

/**
 * A session in progress. Mutable on purpose — it is one small record with one
 * writer (the game), read by the HUD every frame.
 *
 * L5 (#219) gave it a KIND: the L4 session is opened by a Depot and sets that
 * Depot's yield, and the same bounded session now also confirms a CITY UPGRADE
 * (`createTownSession`). One table, one budget, one score — the only difference
 * is what the score lands on when the session closes, so the board, the plate
 * and the wire stay exactly as L4 built them.
 */
export interface TuningSession {
  /** Which L5 (#219) progression the session confirms. */
  kind: "depot" | "town";
  /** The depot this session will set the yield of (`Harvester.id`); -1 = the
   *  town upgrade (see `TOWN_SESSION_ID`). */
  depotId: number;
  /** The cargo the depot collects — what the board spawns mostly of. `null`
   *  for a town session: the city is not about one colour (and the board
   *  stays neutral for it). */
  cargo: Cargo | null;
  /** Moves the session was opened with. */
  moves: number;
  /** Moves spent so far. */
  used: number;
  /** Gems cleared in this session. */
  score: number;
}

/** L5 (#219): the `depotId` a city-upgrade session carries. */
export const TOWN_SESSION_ID = -1;

export const createTuningSession = (depotId: number, cargo: Cargo): TuningSession => ({
  kind: "depot", depotId, cargo, moves: TUNING.moves, used: 0, score: 0,
});

/**
 * L5 (#219): the session a city upgrade is confirmed with. Same budget, same
 * score→strength rule; the board is left NEUTRAL (no `cargo`), because the
 * upgrade benefits every cargo the city already handles.
 */
export const createTownSession = (): TuningSession => ({
  kind: "town", depotId: TOWN_SESSION_ID, cargo: null,
  moves: TUNING.moves, used: 0, score: 0,
});

/**
 * L5 (#219) — THE SESSION GATE, in one function: what finishing a session
 * unlocks.
 *
 * Addition A of the ticket is the Merge Gardens lesson ("the two mechanics only
 * worked together once progression REQUIRED both"), so the rung of the depot
 * tree a seat may build on is bought with match-3, not with resources alone: a
 * seat starts at rung 0 (the two starter cargos) and a session that was really
 * PLAYED — any score above zero, i.e. at least one cleared gem — opens the next
 * rung. An abandoned session, or one closed with nothing cleared, changes
 * nothing; the resources that bought its depot are not returned either, because
 * the depot stands (only the CITY upgrade refunds, since no building is raised
 * for it — see `buyTownUpgrade` in game.ts).
 *
 * Clamping the mapping per difficulty is L6's business (#220); this keeps the
 * rule — score > 0 — and the ceiling in one place.
 */
export function unlockTierAfterSession(unlocked: number, score: number): number {
  const current = Math.max(0, Math.min(DEPOT_TIER_MAX, Math.floor(unlocked)));
  if (!Number.isFinite(score) || score <= 0) return current;
  return Math.min(DEPOT_TIER_MAX, current + 1);
}

/**
 * L5 (#219): the base-rate bonus a city session's score actually sets.
 *
 * The table row (`TOWN_UPGRADES[level].bonus`) is the ceiling a perfect session
 * reaches; a session that merely got a few points confirms the upgrade at a
 * fraction of it, so "a better score gives a slightly higher base-rate bonus"
 * is true and visible in the inspector. The 0.4 floor is the honest price of
 * finishing at all — a session you played gets most of the way there, and the
 * ceiling still needs a real burst.
 */
export function townBonusFor(ceiling: number, score: number): number {
  const max = Math.max(0, Number.isFinite(ceiling) ? ceiling : 0);
  if (!Number.isFinite(score) || score <= 0) return 0;
  const t = Math.min(1, score / TUNING.targetScore);
  return Math.round(max * (0.4 + 0.6 * t) * 100) / 100;
}

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

/**
 * Add points to a session's score. L4 called this per CLEARED GEM; L12
 * (#227) calls it for the bonus value of a board REWARD too (see
 * `TUNING_REWARD_SCORE`) — either way the session's score is just a number,
 * and `tuningYieldFor` does not care where it came from.
 */
export function recordTuningCleared(s: TuningSession, cleared: number): void {
  if (Number.isFinite(cleared) && cleared > 0) s.score += cleared;
}

/** What this session pays if it is played out now. */
export const tuningSessionYield = (s: TuningSession): number => tuningYieldFor(s.score);

/** L9 (#224): the Gold this session pays if it is played out now. */
export const tuningSessionGold = (s: TuningSession): number => tuningGoldFor(s.score);

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
/**
 * L5 (#219): the SCORE the rival's simulated session represents, in the same
 * units a played session scores in. `tuningSkill` is the difficulty's place on
 * the 0…1 axis, so the score is that axis times `TUNING.targetScore` — which is
 * exactly what `rivalTuningYield` and `rivalTuningGold` already priced, and
 * what the tree gate (`unlockTierAfterSession`) and the city upgrade's
 * `townBonusFor` now read. One simulated session, one number.
 */
export function rivalTuningScore(key: SkillKey, noise = 0): number {
  const skill = RIVAL_SKILLS[key]?.tuningSkill ?? RIVAL_SKILLS.normal.tuningSkill;
  const t = Math.min(1, Math.max(0, skill + noise));
  return t * TUNING.targetScore;
}

export function rivalTuningYield(key: SkillKey, noise = 0): number {
  return tuningYieldFor(rivalTuningScore(key, noise));
}

/**
 * L9 (#224): the Gold the rival banks per depot it tunes.
 *
 * Same axis as `rivalTuningYield` — a simulated session at the difficulty's
 * `tuningSkill`, priced through the SAME score→Gold curve the player's own
 * session is paid by (`tuningGoldFor`), so both seats are funded by the same
 * rule and the raid table never runs dry on one side only. Deterministic per
 * skill, like the yield.
 */
export function rivalTuningGold(key: SkillKey, noise = 0): number {
  return tuningGoldFor(rivalTuningScore(key, noise));
}
