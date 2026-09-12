// ══════════════════════════════════════════════════════════════════════════
// AI-01 — rival difficulty: three presets, measured against each other.
//
// The opponent the player meets is a POLICY (the turn aiTick takes: plant →
// depot(s) → pave → bank → market → sabotage) and a set of NUMBERS that pace
// it. This module owns the numbers, and it is data, not a behavioural fork:
// every difficulty runs the SAME turn, so "hard" can never cheat — it plans
// off the same A*, pays the same costs, and never touches the player's purse.
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
//             the 1337 lane, on bank income alone like the shipped rival —
//             well inside any session;
//   • hard  — reaches the line no later than normal, and never trails easy
//             pooled over both chairs on any measured seed.
// Why the ladder reads flat: the 10★ line lands mid-opening, where the
// calibration sim's bank-only seats are income-capped and every preset
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
//   bankBonus         added to rivalPace().bankPerTurn (floored at 1) — how
//                     hard the 4:1 bank works toward the plan it cannot yet
//                     afford;
//   urgencyBias       multiplier on the ore urgency the scoreboard read
//                     produces, so a hard rival chases Ore Mines harder when
//                     it falls behind;
//   offerEveryMs      how often the rival POSTS a market offer (the market is
//                     a nicety, not the strategy — see ai.ts's CARGO_VALUE for
//                     what actually wins);
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
// ══════════════════════════════════════════════════════════════════════════

import { RAID_EVERY } from "../game/config";
import { VICTORY } from "./config";

export type SkillKey = "easy" | "normal" | "hard";

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
  /** Added to pace.bankPerTurn on every banking decision (min 1). */
  bankBonus: number;
  /** Milliseconds between the rival's market offer posts. 0 = never. */
  offerEveryMs: number;
  /** Milliseconds between Black Market raids on the player's plant. 0 = never. */
  raidEveryMs: number;
  /** Whether the rival buys industry Blockades. */
  blockades: boolean;
  /** AI-03: ms between the rival's match-3 moves on its own plant board —
   *  the speed a player watches when they open the rival's plant: a slow
   *  single swap every few seconds, never a cascade bot. */
  moveMs: number;
  /** Multiplier on the ore urgency rivalPace computes from the scoreboard. */
  urgencyBias: number;
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
    buildMs: 11_000,
    idleMs: 3_500,
    expandPerTurn: 1,
    paveTiles: 4,
    bankBonus: 0,
    offerEveryMs: 75_000,
    raidEveryMs: 0,
    blockades: false,
    moveMs: 4_200,
    urgencyBias: 0.75,
    // AI-04: the easy chair is a SHORT race — 5★ instead of the shipped 10★.
    winTarget: 5,
  },
  normal: {
    key: "normal",
    label: "Normal",
    blurb: "The classic rival — the VP-01 tuning the game shipped with.",
    buildMs: 6_500,
    idleMs: 1_800,
    expandPerTurn: 2,
    paveTiles: 10,
    bankBonus: 2,
    offerEveryMs: 50_000,
    raidEveryMs: RAID_EVERY,   // the classic 2-minute raid clock
    blockades: true,
    moveMs: 2_600,
    urgencyBias: 1,
    winTarget: VICTORY.target,   // AI-04: the shipped 10★ line, aliased
  },
  hard: {
    key: "hard",
    label: "Hard",
    blurb: "Plays the scoreboard: expands two builds at a time, banks hard, fights back.",
    buildMs: 4_500,
    idleMs: 1_200,
    expandPerTurn: 3,
    paveTiles: 16,
    bankBonus: 2,
    offerEveryMs: 35_000,
    raidEveryMs: 90_000,
    blockades: true,
    moveMs: 1_800,
    urgencyBias: 1.4,
    winTarget: VICTORY.target,   // AI-04: the shipped 10★ line, aliased
  },
};

export const SKILL_KEYS: SkillKey[] = ["easy", "normal", "hard"];

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
  raw && (SKILL_KEYS as string[]).includes(raw) ? (raw as SkillKey) : null;

/**
 * Where the initial difficulty comes from, in order:
 *   1. the URL (`?rival=easy|normal|hard`) — exactly how `?seed=` works, so a
 *      playtest link can pin a difficulty the way it pins a map;
 *   2. localStorage — the top-bar selector remembers the last choice;
 *   3. the normal preset.
 * Both inputs are injectable so the resolver is testable without a window.
 */
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
