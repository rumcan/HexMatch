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
// boots them) and the time each seat takes to reach 1★, 5★ and 10★ is the
// measurement. The table of results lives in
// docs/playtest-reports/2026-09-10-ai-skills.md. The acceptance shape is:
//
//   • easy  — finishes a game well behind normal: a relaxed opponent that
//             still plays the victory condition (expands, paves, scores);
//   • normal — the VP-01 calibration: 10★ in ~12–20 min of pure trickle
//             income, same as the shipped rival;
//   • hard  — reaches 10★ roughly 30–40% sooner than easy, and beats easy
//             head-to-head on every measured seed.
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
//   blockades         whether it buys industry Blockades against you.
//
// ══════════════════════════════════════════════════════════════════════════

import { RAID_EVERY } from "../game/config";

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
  /** Multiplier on the ore urgency rivalPace computes from the scoreboard. */
  urgencyBias: number;
}

export const RIVAL_SKILLS: Record<SkillKey, RivalSkill> = {
  easy: {
    key: "easy",
    label: "Easy",
    blurb: "A patient rival: slower clock, one build at a time, no sabotage.",
    buildMs: 14_000,
    idleMs: 5_000,
    expandPerTurn: 1,
    paveTiles: 4,
    bankBonus: -1,
    offerEveryMs: 90_000,
    raidEveryMs: 0,
    blockades: false,
    urgencyBias: 0.75,
  },
  normal: {
    key: "normal",
    label: "Normal",
    blurb: "The classic rival — the VP-01 tuning the game shipped with.",
    buildMs: 9_000,
    idleMs: 2_500,
    expandPerTurn: 1,
    paveTiles: 8,
    bankBonus: 0,
    offerEveryMs: 60_000,
    raidEveryMs: RAID_EVERY,   // the classic 2-minute raid clock
    blockades: true,
    urgencyBias: 1,
  },
  hard: {
    key: "hard",
    label: "Hard",
    blurb: "Plays the scoreboard: expands two builds at a time, banks hard, fights back.",
    buildMs: 5_500,
    idleMs: 1_500,
    expandPerTurn: 2,
    paveTiles: 12,
    bankBonus: 1,
    offerEveryMs: 40_000,
    raidEveryMs: 90_000,
    blockades: true,
    urgencyBias: 1.3,
  },
};

export const SKILL_KEYS: SkillKey[] = ["easy", "normal", "hard"];

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
