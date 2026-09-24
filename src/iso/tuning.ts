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
//   • `tuningYieldFor(score, floor)` — the ONE mapping from score to yield:
//     linear from `floor` through `maxYield` at `targetScore` and ON past it
//     (no ceiling — owner call, 2026-09), rounded to two decimals so the number
//     the HUD shows and the number stored on the depot are the same number;
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
// L10 (#225) added the session's OBSTACLES — the frost and the girders the
// board opens with, read off the same row of `DIFFICULTY_RULES`
// (`sessionObstacles`), what they cost a simulated score (`obstacleDrag`) and
// the intro's one in-world sentence (`obstacleIntroLine`). The rules are here
// with the rest of the session's numbers; the PLACING is the board's, because
// only the board knows which cell can take one and still leave a legal move.
//
// Everything that reads these — the board hooks, the HUD plate, the wire, the
// clock — goes through this file, so "what a session is worth" has exactly one
// answer per difficulty, and each of the three answers is the same code.
// ══════════════════════════════════════════════════════════════════════════
import {
  CARGO, DEFAULT_DIFFICULTY, DEPOT_TIER_MAX, DIFFICULTY_RULES, OBSTACLE_RAMP, TUNING, TUNING_STARS,
  type Cargo, type DifficultyKey, type DifficultyRules, type ObstacleRules, DEPOT_LEVELS,
} from "./config";
import { RIVAL_SKILLS, type SkillKey } from "./skill";
import { BOARD_H, BOARD_W } from "../game/config";
import type { BoardObstacles, RewardKind } from "../game/board";

/** Round to the two decimals the HUD prints and the depot stores. */
export const roundYield = (y: number): number => Math.round(y * 100) / 100;

/** Clamp any yield (a wire value, a save, a hand-edited test) into range. */
export const clampYield = (y: number): number =>
  roundYield(Math.min(TUNING.yieldSanityMax, Math.max(TUNING.minYield, Number.isFinite(y) ? y : TUNING.minYield)));

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
 * The yield a score earns. Linear from `floor` (score 0 — the baseline an
 * untuned depot runs at, so abandoning a session is never a penalty) through
 * `maxYield` at `TUNING.targetScore`, and it KEEPS CLIMBING past the target at
 * the same slope: the better the session, the higher the yield (owner call,
 * 2026-09 — the old ×2.5 ceiling is gone).
 *
 * `floor` is the difficulty's `minYield` (L6): Easy lifts it to 1.5 so a weak
 * session still gives a decent Depot, while Normal and Hard keep the shipped
 * baseline. Omitted, it is the shipped table — which is what the L4 tests and
 * any caller without a live difficulty get.
 */
export function tuningYieldFor(score: number, floor: number = TUNING.minYield): number {
  if (!Number.isFinite(score) || score <= 0) return clampYield(floor);
  const t = score / TUNING.targetScore;
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
  opts: { abandon?: boolean; cap?: number } = {},
): number {
  const base = prev ?? rules.minYield;
  let next = opts.abandon ? abandonYieldFor(rules) : tuningYieldFor(score, rules.minYield);
  // 2026-09: the Depot's level caps what a session can set (L1 ×2 …).
  if (opts.cap !== undefined) next = Math.min(next, opts.cap);
  return roundYield(rules.yieldNeverDrops ? Math.max(base, next) : next);
}

/**
 * 2026-09: the Gold a session pays for the score it played PAST the Depot's
 * cap — 1 per `DEPOT_LEVELS.goldPerOvershoot` of yield over it.
 */
export function overshootGold(score: number, rules: DifficultyRules, cap: number): number {
  const raw = tuningYieldFor(score, rules.minYield);
  if (raw <= cap) return 0;
  return Math.floor((raw - cap) / DEPOT_LEVELS.goldPerOvershoot + 1e-9);
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

// ══════════════════════════════════════════════════════════════════════════
// L10 (#225) — the session's OBSTACLES, as data.
//
// Frost tiles and iron girders were Black-Market sabotage: a purchase, a
// timer, and an overlay that shipped them to the other seat. They are a
// difficulty's now — placed when a session opens, on the board that session
// plays, gone when it closes. The three things that follow are the whole of
// it, and they are all pure:
//
//   • `sessionObstacles(rules, tier)` — how many of each the row asks for,
//     ramped by the tier the Depot stands on;
//   • `obstacleDrag(plan)` — what those obstacles are worth against a SCORE,
//     which is how the rival's simulated session is docked for them;
//   • `obstacleIntroLine(label, plan)` — the session intro's one sentence,
//     naming them in the game's own world.
//
// The board itself does the PLACING (`Board.seedObstacles`): it is the only
// thing that knows whether a cell can take an obstacle and whether the board
// still has a legal move afterwards. This module never sees a grid.
// ══════════════════════════════════════════════════════════════════════════

/**
 * What a session OPENS with: the difficulty's row, put through the tier ramp.
 *
 * The ramp is the L5 half of the ticket ("counts ramp gently with the depot
 * tier, e.g. the first depot has fewer"): a Depot standing on open ground
 * (tier 0) gets thinned obstacles, and every tier the player has actually
 * paid for puts the full row back. Frost is floored, never rounded up, so
 * "half of a small number" stays small.
 */
export function sessionObstacles(rules: DifficultyRules, tier = 0): ObstacleRules {
  const row = rules.obstacles;
  if (tier > 0) return { frost: row.frost, frostHard: row.frostHard, girders: row.girders };
  return {
    frost: Math.floor(row.frost * OBSTACLE_RAMP.firstTier),
    frostHard: Math.min(row.frostHard, OBSTACLE_RAMP.firstTierHard) as 1 | 2,
    girders: Math.floor(row.girders * OBSTACLE_RAMP.firstTier),
  };
}

/** The cells an obstacle count is measured against (the shipped 7×8 board). */
const OBSTACLE_CELLS = BOARD_W * BOARD_H;
/** A frosted gem costs one cell's worth of play: one match cracks it free. */
export const FROST_WEIGHT = 1;
/** A girder costs two — it leaves the cell unmatchable AND un-refillable. */
export const GIRDER_WEIGHT = 2;
/** A board can be made harder, never unplayable: the drag is capped. */
export const MAX_OBSTACLE_DRAG = 0.5;

/**
 * L10 (#225) — the share of a session's SCORE the obstacles cost.
 *
 * The rival plays no board, so the obstacles it would have met are taken off
 * its simulated session instead of off a grid: a frosted gem is one cracked
 * step away from being an ordinary gem, a girder takes its cell out of the
 * board entirely, and both are priced on the same 7×8 board the player's is.
 */
export function obstacleDrag(plan: ObstacleRules): number {
  const wrecked = plan.frost * FROST_WEIGHT + plan.girders * GIRDER_WEIGHT;
  if (!Number.isFinite(wrecked) || wrecked <= 0) return 0;
  return Math.min(MAX_OBSTACLE_DRAG, wrecked / OBSTACLE_CELLS);
}

/**
 * L10 (#225) — the session intro's obstacle line, or `null` on a difficulty
 * (and a tier) that opens on a clean board, so the intro simply says nothing
 * about them on Easy instead of promising obstacles it did not place.
 *
 * They are named in the game's WORLD, because a puzzle tile that does not
 * belong to the story breaks the fiction — the Merge Gardens deconstruction's
 * lesson: it swapped fruit for books and cameras to fit its mansion, and a
 * mismatch is what reads as "not a game". Frost and girders were already
 * industrial — "the rails froze overnight and girders fell on the line" — and
 * a later obstacle must come from the same world (rubble, an oil slick, rust),
 * never a generic match-3 blocker. Copy is finalised in L8 (#222); this is the
 * shape of it.
 *
 * The counts are the ones that actually LANDED, so a crowded board that could
 * only take four girders is not advertised as six.
 */
export function obstacleIntroLine(label: string, placed: BoardObstacles): string | null {
  if (!placed.frost && !placed.girders) return null;
  const what = placed.girders
    ? "the rails froze overnight and girders fell on the line"
    : "the rails froze overnight";
  const counts: string[] = [];
  if (placed.frost) counts.push(`${placed.frost} iced`);
  if (placed.girders) counts.push(`${placed.girders} girder${placed.girders === 1 ? "" : "s"}`);
  return `${label}: ${what} — ${counts.join(", ")}.`;
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

/**
 * What this session pays if it is played out now. `floor` is the live
 * difficulty's (L6) — the plate shows the number that will actually settle, so
 * an Easy session never advertises ×1.0 for a Depot about to be set to ×1.5.
 */
export const tuningSessionYield = (s: TuningSession, floor: number = TUNING.minYield): number =>
  tuningYieldFor(s.score, floor);

/** L9 (#224): the Gold this session pays if it is played out now. */
export const tuningSessionGold = (s: TuningSession): number => tuningGoldFor(s.score);

// ══════════════════════════════════════════════════════════════════════════
// #300 — the RESULTS a session ends on: its stars, and its outcome.
//
// When a session ends (the budget spent and the board settled, or Finish
// pressed) the game freezes what it is worth, the results pop-up counts it
// up, and its one Confirm key applies it. Both halves are here and pure:
//
//   • `tuningStarScores` / `tuningStarsFor` — the rating, read off the ONE
//     table (`TUNING_STARS`, config.ts), whose rows are points on the curve
//     `tuningYieldFor` draws;
//   • `depotSessionOutcome` — everything a Depot's settle does to the numbers
//     (the curve, the Depot's cap, the never-drops rule, the Gold), computed
//     with the SAME functions the settle has always used, so the yield the
//     card shows is the yield the Depot gets.
// ══════════════════════════════════════════════════════════════════════════

/** #300: a session's rating. 0 = nothing cleared (no star at all). */
export type TuningStars = 0 | 1 | 2 | 3;

/**
 * #300: the score each row of `TUNING_STARS` asks for, in table order — the
 * row's point on the curve times `TUNING.targetScore` (the curve is linear
 * from score 0 to `targetScore`). Never below 1: the bottom of the curve is
 * score 0, and a session that cleared nothing earns no star.
 */
export function tuningStarScores(): number[] {
  return TUNING_STARS.map((row) => Math.max(1, Math.ceil(row.curve * TUNING.targetScore - 1e-9)));
}

/** #300: how many stars a score earns — the highest row of `TUNING_STARS` it reaches. */
export function tuningStarsFor(score: number): TuningStars {
  if (!Number.isFinite(score) || score <= 0) return 0;
  const bars = tuningStarScores();
  let stars: TuningStars = 0;
  TUNING_STARS.forEach((row, i) => { if (score >= bars[i]) stars = Math.max(stars, row.stars) as TuningStars; });
  return stars;
}

/** #300: the verdict word for a rating (`TUNING_STARS[].label`); empty for none. */
export function tuningStarLabel(stars: number): string {
  return TUNING_STARS.find((row) => row.stars === stars)?.label ?? "";
}

/** #300: what a Depot's session settles to — see `depotSessionOutcome`. */
export interface TuningOutcome {
  /** The session's score. */
  score: number;
  /** Its rating (`tuningStarsFor`) — 0 for an abandon, which is never rated. */
  stars: TuningStars;
  /** The level the Depot was paying at before — the count-up starts here. */
  from: number;
  /** What the curve pays for the score on this floor, before the Depot's cap. */
  raw: number;
  /** EXACTLY what the Depot is set to (`settleTuningYield`). */
  yield: number;
  /** The Depot's level cap, when there is one. */
  cap?: number;
  /** The curve's number was over the cap (the rest is paid as Gold). */
  capped: boolean;
  /** The Depot kept its old, higher level (the rules' never-drops clamp). */
  kept: boolean;
  /** All the Gold the settle pays: the score's own plus the overshoot. */
  gold: number;
  /** The part of `gold` paid for the score played past the cap. */
  overshootGold: number;
}

/**
 * #300 — a Depot session's whole settlement, as numbers: the curve, capped
 * by the Depot's level (2026-09), clamped by `yieldNeverDrops` (L6), and the
 * Gold (L9 plus the overshoot). Pure, and built from the functions the settle
 * already used — `settleTuningYield`, `overshootGold`, `tuningGoldFor` — so
 * the pop-up that shows `yield` and the Confirm that applies it can never be
 * two answers. An abandon pays the difficulty's default and no Gold.
 */
export function depotSessionOutcome(
  score: number, prev: number | undefined, rules: DifficultyRules,
  opts: { cap?: number; abandon?: boolean } = {},
): TuningOutcome {
  const abandon = opts.abandon === true;
  const s = Number.isFinite(score) && score > 0 ? score : 0;
  const raw = abandon ? abandonYieldFor(rules) : tuningYieldFor(s, rules.minYield);
  const set = settleTuningYield(prev, s, rules, { abandon, cap: opts.cap });
  const earned = roundYield(opts.cap !== undefined ? Math.min(raw, opts.cap) : raw);
  const over = abandon || opts.cap === undefined ? 0 : overshootGold(s, rules, opts.cap);
  return {
    score: s,
    stars: abandon ? 0 : tuningStarsFor(s),
    from: roundYield(prev ?? rules.minYield),
    raw,
    yield: set,
    cap: opts.cap,
    capped: !abandon && opts.cap !== undefined && raw > opts.cap,
    kept: set > earned,
    gold: (abandon ? 0 : tuningGoldFor(s)) + over,
    overshootGold: over,
  };
}

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
 *
 * L10 (#225): the OBSTACLES are not a concession — they are the board, and the
 * rival meets the same board the player does. It plays no session, so what it
 * would have lost to frost and girders is taken off its simulated score as
 * `obstacleDrag` (pass `rules` and the Depot's `tier` to charge for them;
 * without them the number is L4's, unchanged, which is what the calibration
 * sweeps pin). This is what replaced `rival-plant.ts`'s damage model: the
 * rival's yield is docked by the obstacles it would have faced, once, instead
 * of by ice and girders melting off a board nobody was watching.
 */
/**
 * L5 (#219): the SCORE the rival's simulated session represents, in the same
 * units a played session scores in. `tuningSkill` is the difficulty's place on
 * the 0…1 axis, so the score is that axis times `TUNING.targetScore` — the one
 * number behind `rivalTuningYield`, `rivalTuningGold`, the tree gate
 * (`unlockTierAfterSession`) and the city upgrade's `townBonusFor`.
 * L10 (#225): pass `rules` and the Depot's `tier` to dock it by `obstacleDrag`.
 */
export function rivalTuningScore(
  key: SkillKey, noise = 0, rules?: DifficultyRules, tier = 0,
): number {
  const skill = RIVAL_SKILLS[key]?.tuningSkill ?? RIVAL_SKILLS.normal.tuningSkill;
  const drag = rules ? obstacleDrag(sessionObstacles(rules, tier)) : 0;
  const t = Math.min(1, Math.max(0, (skill + noise) * (1 - drag)));
  return t * TUNING.targetScore;
}

export function rivalTuningYield(
  key: SkillKey, noise = 0, rules?: DifficultyRules, tier = 0,
): number {
  return tuningYieldFor(rivalTuningScore(key, noise, rules, tier));
}

/**
 * L9 (#224): the Gold the rival banks per depot it tunes.
 *
 * Same axis as `rivalTuningYield` — a simulated session at the difficulty's
 * `tuningSkill`, priced through the SAME score→Gold curve the player's own
 * session is paid by (`tuningGoldFor`), so both seats are funded by the same
 * rule and the raid table never runs dry on one side only. Deterministic per
 * skill, like the yield, and docked by the same obstacles (L10 / #225) —
 * the rival's Gold comes out of the session the obstacles made harder.
 */
export function rivalTuningGold(
  key: SkillKey, noise = 0, rules?: DifficultyRules, tier = 0,
): number {
  return tuningGoldFor(rivalTuningScore(key, noise, rules, tier));
}
