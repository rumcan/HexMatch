// ══════════════════════════════════════════════════════════════════════════
// AI-01 — rival difficulty: three presets, measured against each other.
//
// The opponent the player meets is a POLICY (the turn `aiTick` takes — plant →
// depot(s) → pave → bank → sabotage on the shipped loop; connect → tune →
// climb the tree → upgrade the city under `newLoop`) and a set of NUMBERS that
// pace it. This module owns the numbers, and it is data, not a behavioural
// fork: every difficulty runs the SAME turn, so "hard" can never cheat — it
// plans off the same A*, pays the same costs, and never touches the player's
// purse. (L11 / #226 removed the market from that turn; the bank it kept is
// the same pass both seats run, gated to the seat's own rungs.)
//
// How the presets were set, so they do not drift into guesswork: two AI seats
// race each other head-to-head (tests/unit/iso-skill-calibration.test.ts,
// seeded with the map's town roads + public highways exactly as the live game
// boots them) and the time each seat takes to reach 1★, 5★ and the finish line is the
// measurement. The table of results lives in
// docs/playtest-reports/2026-09-10-ai-skills.md. The acceptance shape is:
//
//   • easy  — finishes alongside normal, never ahead of it: a relaxed
//             opponent that still plays the victory condition (expands,
//             paves, scores);
//   • normal — the shipped rival's tuning: reaches the 10★ line in 15.8m on
//             the 1337 lane (the number PR #282 measured; L11 / #226 removed
//             the rival's market, and the bank it keeps is gated to the
//             seat's own rungs, so the harness in
//             tests/unit/iso-l1d-race.test.ts re-measures it) — well inside
//             any session;
//   • hard  — reaches the line no later than normal, and never trails easy
//             pooled over both chairs on any measured seed.
// Why the ladder reads flat: the 10★ line lands mid-opening, where the
// calibration sim's clock-fed seats are income-capped and every preset
// moves together (all three 1337 mirrors cross on the same tick). The sim
// guards against an INVERTED ladder, not a photo finish; the difference a
// player feels is the clocks below, the raid cadence, and Blockades.
//
// AI-04 note on those numbers: the harness races EVERY preset to the shipped
// line (`VP_TARGET`, 10★) on purpose. The ladder it measures is about how fast
// a preset PLAYS, and a per-preset finish line would make the presets' own
// times incomparable — easy at 5★ would "win" by definition. `winTarget` is a
// game rule for the live seat, so the calibration stays on one line and the
// easy chair's 5★ is a shorter race over the same measured pace.
//
// Levers, in order of how loudly a player feels them:
//
//   buildMs / idleMs  the rival's two clocks (was the AI_BUILD_MS / AI_IDLE_MS
//                     pair in game.ts — those constants now exist only as the
//                     NORMAL preset's values, exported for the tests that pin
//                     them);
//   expandPerTurn     how many depot plans ONE build turn may complete. One
//                     reads as "builds occasionally"; two reads as "the rival
//                     is spreading across the map" — the single most visible
//                     difference between the presets;
//   paveTiles         the planUpgrades batch cap (was 8);
//   urgencyBias       multiplier on the ore urgency the scoreboard read
//                     produces, so a hard rival chases Ore Mines harder when
//                     it falls behind;
//   (L11 / #226 retired TWO entries from this list. `offerEveryMs` paced the
//   offer board, which is gone. `bankBonus` was the bank's difficulty term
//   (`rivalPace().bankPerTurn + bankBonus`), and in the bank-only economy it
//   was the wrong lever: the rival's budget is a RATE, so a bonus buys the
//   richer lane more than the poorer one and the presets stopped being legible
//   against each other — VP-01's game-shape floor caught it first (the winner
//   crossed 10★ with the loser on 1.25★ of its 2.5★ floor on the measured
//   seed, `tests/unit/iso-vp-race.test.ts`). The bank's budget is the pace's
//   own `bankPerTurn` (2 cruise / 4 sprint) on every preset now.)
//   raidEveryMs       Black Market raid cadence (0 = never: the easy rival
//                     leaves your plant alone);
//   blockades         whether it buys industry Blockades against you;
//   winTarget         AI-04: the ★ line the GAME races to at this difficulty
//                     (easy 5★, the rest the shipped `VICTORY.target`). A
//                     shorter race is a difficulty lever like any other, and
//                     the only one that changes nothing about how the rival
//                     plays — which is what "make the easy game 5 win points"
//                     was asking for.
//
// ── L14 (#229): the same table, read by the NEW loop's turn ───────────────
// Under `newLoop` the rival plays a different turn (`aiNewLoopTurn` in
// game.ts: connect → tune → climb the tree → upgrade the city), and the levers
// above re-map onto its decisions instead of the old ones:
//
//   buildMs / idleMs      the REACTION clocks, unchanged — how fast it answers
//                         a tick of income and how soon it retries a turn that
//                         achieved nothing;
//   tuningSkill           the SESSION QUALITY: every simulated session it plays
//                         (build tune, re-match, city upgrade) reads it;
//   townReserve           the UPGRADE TIMING: how much of the next Depot it
//                         keeps in hand before buying the city upgrade;
//   expandPerTurn         still the expansion pressure — Depot plans per turn,
//                         which on the new loop is how fast it spreads over the
//                         map on free gravel;
//   paveTiles / urgencyBias / moveMs
//                         shipped-loop levers. Market offers and the watched
//                         board are retired outright (L11 #226 removed the
//                         board; L14 #229 grew the new loop its own income), so
//                         the new loop reads none of them. L11 also retired
//                         `bankBonus` — see the note above.
//
// ══════════════════════════════════════════════════════════════════════════

import { RAID_EVERY } from "../game/config";
import { VICTORY } from "./config";

export type SkillKey = "easy" | "normal" | "hard" | "trainee";

export interface RivalSkill {
  key: SkillKey;
  /** Short name for the HUD control. */
  label: string;
  /** One-line description for the title tooltip. */
  blurb: string;
  /** The build clock: ms between turns that achieved something. */
  buildMs: number;
  /** The retry clock after a turn that achieved NOTHING. */
  idleMs: number;
  /** Depot plans a single build turn may complete (expansion pressure). */
  expandPerTurn: number;
  /** Cap on tiles one pave pass lays (planUpgrades maxTiles). */
  paveTiles: number;
  /** Milliseconds between Black Market raids on the player's plant. 0 = never. */
  raidEveryMs: number;
  /** Whether the rival buys industry Blockades. */
  blockades: boolean;
  /** AI-03: ms between the rival's match-3 moves on its own plant board —
   *  the speed a player watches when they open the rival's plant: a slow
   *  single swap every few seconds, never a cascade bot. */
  moveMs: number;
  /**
   * Multiplier on the ore urgency rivalPace computes from the scoreboard. On
   * the shipped loop this is how hard the rival chases the cargo that buys
   * points (VP-01: Ore). Under `newLoop` there is no urgency dial — the tree
   * decides what the rival wants (`treeGoal` in ai.ts) — so this lever is the
   * shipped loop's alone.
   */
  urgencyBias: number;
  /**
   * RAIL-05 (#182): the railway lever — does this rival build and run lines at
   * all? `easy` keeps to the road entirely (the issue's "easy may skip rail");
   * `normal` and `hard` plan one rail action per turn through the SAME
   * `rail.ts` rules the player's drag commits through. Inert while the game's
   * `?rail` feature flag is down.
   */
  rail: boolean;
  /**
   * FTUE-1 (#464): does this rival CONTEST the player's industries — plan a
   * Depot that could claim one the player's network already covers (serviced
   * or not)? `true` is the shipped race: first come, first served. The
   * trainee is `false`: it builds its own lane and never takes what the
   * player has staked, so a first-timer's four industries stay theirs.
   * Read by the planner (`planCandidates` in ai.ts) through the turn's
   * options — the flag is data here, the behaviour is over there.
   */
  contests: boolean;
  /**
   * FTUE-1 (#464): does this rival ever CALL a challenge — start a battle
   * over an industry or a town? `true` is the shipped cadence
   * (`BATTLE_SKILLS[].challengeEveryMs`); the trainee is `false`, and its
   * battle row never arms the clock either. It will still DEFEND if the
   * player picks a fight — it just never starts one.
   */
  challenges: boolean;
  /**
   * L6 (#220): what this difficulty does to the PLAYER's side of the economy,
   * in one line. It is copy, not a rule — the numbers it describes are the
   * flags on this key's row of `DIFFICULTY_RULES` (`config.ts`) — and it lives
   * here because there is exactly ONE difficulty setting in the game now, so
   * the picker's card, the top-bar tooltip and the switch toast state both
   * halves from one row. `iso-l6-difficulty.test.ts` pins the sentence against
   * the flags, so the promise and the rule cannot drift.
   */
  economyLine: string;
  /**
   * L4 (#218): how well this rival plays a tuning session, on the same 0…1
   * axis as a player's own score (0 = `TUNING.minYield`, 1 = `maxYield`). It
   * is a SIMULATED result — the rival opens no board for it — and it is the
   * same lever for all three presets, so "the hard rival's depots tick faster"
   * is one number here rather than a special case somewhere in `game.ts`.
   *
   * L14 (#229): this is the NEW loop's headline lever, next to the two clocks.
   * It feeds every session the rival never opens — the build tune, the re-match
   * and the city upgrade's own session — so one number sets how good the whole
   * network it raises is.
   */
  tuningSkill: number;
  /**
   * L14 (#229): how much of its next Depot the rival insists on still being
   * able to pay BEFORE it buys the city upgrade — expressed as a multiple of
   * `treeGoal`'s price. `1` keeps the goal whole (buy the upgrade late, when
   * the network is comfortable), `0.6` buys it as soon as two thirds of the
   * goal is in hand (the upgrade's ×1.6 compounds every later tick), and
   * anything above 1 is a seat that will not touch the city until it is rich.
   *
   * This is the "upgrade timing" decision of the new loop and the third lever
   * a player feels, next to the reaction clocks (`buildMs`/`idleMs`) and the
   * session quality (`tuningSkill`). Ignored on the shipped loop, where the
   * upgrade is priced against the next Depot PLAN instead (`rivalSkintTarget`).
   */
  townReserve: number;
  /**
   * #297: how long one simulated tuning session keeps the rival busy on the
   * new loop, in ms. A Depot, a city upgrade and a re-match are each a session
   * for the player — ten real moves on the board — and the rival used to get
   * them free and instant, raising two Depots and a rung every build clock
   * (a Normal rival reached 12★ in ~35 s). The rival now waits this long after
   * each one, so its pace is bounded by sessions exactly as the player's is.
   */
  sessionMs: number;
  /**
   * AI-04: the Victory-Point line the GAME races to while this difficulty is
   * selected — the number in the HUD's "You 2★/5", the king bars' 100%, the
   * rival's own race assessment (`rivalPace`) and the win check. `easy` runs a
   * short race (5★) because that is what the easy chair was asked for; every
   * other preset aliases the shipped line so the two can never drift.
   */
  winTarget: number;
}

export const RIVAL_SKILLS: Record<SkillKey, RivalSkill> = {
  easy: {
    key: "easy",
    label: "Easy",
    blurb: "A patient rival: slower clock, one build at a time, no sabotage — and a short race, first to 5★.",
    // L6 (#220): Easy is generous, and it never calls you back to the board.
    economyLine: "Match-3 still opens when you build a Depot, a weak session still lands a decent yield, and the yield you tune is yours to keep.",
    buildMs: 11_000,
    idleMs: 3_500,
    expandPerTurn: 1,
    paveTiles: 4,
    raidEveryMs: 0,
    blockades: false,
    moveMs: 4_200,
    urgencyBias: 0.75,
    // RAIL-05: the easy chair keeps to the road — no rail for it to learn.
    rail: false,
    // FTUE-1 (#464): every pickable chair races the ordinary race.
    contests: true,
    challenges: true,
    // L4 (#218): a casual tuning hand — its depots land just above baseline.
    tuningSkill: 0.35,
    // L14 (#229): a careful steward — the city waits until the next Depot's
    // whole price (and a quarter more) is in hand.
    townReserve: 1.25,
    sessionMs: 110_000,
    // AI-04: the easy chair is a SHORT race — 5★ instead of the shipped 10★.
    winTarget: 5,
  },
  normal: {
    key: "normal",
    label: "Normal",
    blurb: "The classic rival — the VP-01 tuning the game shipped with.",
    // L6 (#220): one session per Depot, one more per upgrade, monotone.
    economyLine: "One tuning session per Depot and one more per upgrade — your yield never drops.",
    buildMs: 6_500,
    idleMs: 1_800,
    expandPerTurn: 2,
    paveTiles: 10,
    raidEveryMs: RAID_EVERY,   // the classic 2-minute raid clock
    blockades: true,
    moveMs: 2_600,
    urgencyBias: 1,
    // RAIL-05: normal builds and runs rail lines, one action per turn.
    rail: true,
    // FTUE-1 (#464): every pickable chair races the ordinary race.
    contests: true,
    challenges: true,
    // L4 (#218): the shipped tuning hand — the middle of the multiplier.
    tuningSkill: 0.62,
    // L14 (#229): the shipped city timing — the next Depot stays funded.
    townReserve: 1,
    sessionMs: 80_000,
    winTarget: VICTORY.target,   // AI-04: the shipped 10★ line, aliased
  },
  hard: {
    key: "hard",
    label: "Hard",
    blurb: "Plays the scoreboard: expands three builds at a time, paves hard, fights back.",
    // L6 (#220): the only row where the yield is not permanent.
    economyLine: "A tuned Depot cools off on the clock — re-tune it any time, and a bad session can cost you.",
    buildMs: 4_500,
    idleMs: 1_200,
    expandPerTurn: 3,
    paveTiles: 16,
    raidEveryMs: 90_000,
    blockades: true,
    moveMs: 1_800,
    urgencyBias: 1.4,
    // RAIL-05: hard runs rail as hard as it paves — the spread lever.
    rail: true,
    // FTUE-1 (#464): every pickable chair races the ordinary race.
    contests: true,
    challenges: true,
    // L4 (#218): reads the board — long matches and cascades.
    tuningSkill: 0.88,
    // L14 (#229): buys the upgrade early — the ×1.6 is worth more than the
    // tempo the next Depot loses, and a hard rival is playing a compound game.
    townReserve: 0.6,
    sessionMs: 55_000,
    winTarget: VICTORY.target,   // AI-04: the shipped 10★ line, aliased
  },
  // FTUE-1 (#464) — the TRAINEE: the Starter Island's rival, and the only
  // skill a first-timer meets. It is a real seat (it builds, it scores, the
  // Feed has something in it, and there IS a race) played with its hands
  // behind its back: slow on every clock, never a raid or a blockade, never
  // a challenge, and never a Depot that could claim an industry the player's
  // network has staked. Its ★ line is the Starter Island's own: 6.
  //
  // It is deliberately NOT in `SKILL_KEYS` — the picker and the top-bar
  // selector show the three chairs a player may choose. The trainee is cast
  // by the scenario (exactly like a contract casts its rival); `parseSkill`
  // still reads it so a `?rival=trainee` playtest link and a Starter Island
  // save round-trip.
  trainee: {
    key: "trainee",
    label: "Trainee",
    blurb: "A first-day rival: slow and polite — it never takes your industries and never starts a fight.",
    // L6 (#220): the player's own half runs the EASY row (the clean board,
    // the generous floor) — a first game is gentle on both sides of the map.
    economyLine: "Match-3 still opens when you build a Depot, a weak session still lands a decent yield, and the yield you tune is yours to keep.",
    buildMs: 15_000,
    idleMs: 5_000,
    expandPerTurn: 1,
    paveTiles: 3,
    raidEveryMs: 0,
    blockades: false,
    moveMs: 5_200,
    urgencyBias: 0.5,
    rail: false,
    // FTUE-1 (#464): the two behaviour flags that make it a trainee.
    contests: false,
    challenges: false,
    tuningSkill: 0.3,
    townReserve: 1.25,
    sessionMs: 120_000,
    // FTUE-1 (#464): the Starter Island is a SHORT, winnable race — 6★.
    winTarget: 6,
  },
};

/**
 * The pickable difficulties — the skill picker's and the top-bar selector's
 * list. `trainee` is cast by the Starter Island and never offered (see its
 * row above); `ALL_SKILL_KEYS` is the set every key is legal in (URL parses,
 * save reads, tests).
 */
export const SKILL_KEYS: SkillKey[] = ["easy", "normal", "hard"];
export const ALL_SKILL_KEYS: SkillKey[] = [...SKILL_KEYS, "trainee"];

/**
 * AI-04: the ★ line a difficulty races to, for the callers that know only the
 * key (the HUD labels, the boot toast, the tests) rather than holding a live
 * preset. `easy` is 5★; every other preset is `VICTORY.target`.
 */
export const winTargetFor = (key: SkillKey): number => RIVAL_SKILLS[key].winTarget;

/** The default the game boots with when nothing asks otherwise. */
export const DEFAULT_SKILL: SkillKey = "normal";

/** The localStorage key a mid-game difficulty change is remembered under. */
export const SKILL_STORAGE_KEY = "hexmatch:rival-skill";

const parseSkill = (raw: string | null | undefined): SkillKey | null =>
  raw && (ALL_SKILL_KEYS as string[]).includes(raw) ? (raw as SkillKey) : null;

/**
 * Where the initial difficulty comes from, in order:
 *   1. the URL (`?rival=easy|normal|hard`) — exactly how `?seed=` works, so a
 *      playtest link can pin a difficulty the way it pins a map;
 *   2. localStorage — the top-bar selector remembers the last choice;
 *   3. the normal preset.
 * Both inputs are injectable so the resolver is testable without a window.
 */
/** The URL's own answer, without the storage/default fallbacks — the game
 *  asks this separately so a pinned `?rival=` link can be REMEMBERED (a
 *  playtest link is an explicit choice) while a plain boot still leaves the
 *  storage key absent for AI-02's start-of-game picker. */
export function skillKeyFromUrl(
  search: string = typeof location !== "undefined" ? location.search : "",
): SkillKey | null {
  const rawSearch = search.startsWith("?") ? search.slice(1) : search;
  return parseSkill(new URLSearchParams(rawSearch).get("rival"));
}

export function resolveSkillKey(
  search: string = typeof location !== "undefined" ? location.search : "",
  storage: Pick<Storage, "getItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): SkillKey {
  const rawSearch = search.startsWith("?") ? search.slice(1) : search;
  const fromUrl = parseSkill(new URLSearchParams(rawSearch).get("rival"));
  if (fromUrl) return fromUrl;
  const fromStore = storage ? parseSkill(storage.getItem(SKILL_STORAGE_KEY)) : null;
  return fromStore ?? DEFAULT_SKILL;
}
