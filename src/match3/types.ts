// ══════════════════════════════════════════════════════════════════════════
// MATCH-2 — the board's types.
//
// Two halves:
//
//  1. THE LEGACY SURFACE — every type `src/game/board.ts` exported at
//     32571ece and a caller (tuning, battles, quarry, rival plant) imports:
//     `Gem`, `BoardObstacles`, `PassReport`, `FxType`, `CrossKind`,
//     `RewardKind`, `BOARD_ANIMATION_MS`, `FAST_ANIMATION_MS`,
//     `HOLY_CROSS_PICKS`, `BROKEN_CROSS_PICKS`, `arcadeLabel`. Same names,
//     same shapes, same numbers — the adapter (`board.ts`) re-exports them so
//     the old import lines compile unchanged.
//
//  2. THE PHASE STREAM — what the NEW engine yields as it resolves a move.
//     A phase is one animation beat (the swap, a clear, a fall…) with every
//     fact the renderer and the audio layer need to draw and voice it at the
//     right frame: which two stones pass each other (and the contact moment),
//     which gems left the grid, which fell how far, which landed. The engine
//     never knows about time; the adapter paces phases with the animation
//     table and the renderer tweens them over exactly the same duration.
// ══════════════════════════════════════════════════════════════════════════

/** The six gem colours — the board's own keys, kept for save compatibility. */
export type ResKey = "wood" | "brick" | "sheep" | "wheat" | "ore" | "gold";
export const RES_KEYS: ResKey[] = ["wood", "brick", "sheep", "wheat", "ore", "gold"];

/** The six cargoes — also the asset contract's stone names. */
export type StoneType = "grain" | "wood" | "ore" | "stone" | "oil" | "gold";
export const STONE_TYPES: StoneType[] = ["grain", "wood", "ore", "stone", "oil", "gold"];

/** `GEM_TO_CARGO` (quarry.ts): how a gem colour reads as a cargo / a stone strip. */
export const RES_TO_STONE: Record<ResKey, StoneType> = {
  wheat: "grain",
  wood: "wood",
  ore: "ore",
  brick: "stone",
  sheep: "oil",
  gold: "gold",
};
export const STONE_TO_RES: Record<StoneType, ResKey> = {
  grain: "wheat",
  wood: "wood",
  ore: "ore",
  stone: "brick",
  oil: "sheep",
  gold: "gold",
};

/** The shipped board: 7 wide, 8 tall (`BOARD_W`/`BOARD_H` in game/config.ts). */
export const BOARD_W = 7;
export const BOARD_H = 8;

export interface Gem {
  id: number;
  res: ResKey;
  tier: 0 | 1 | 2;
  special: Special;
  /** Frost: 0 = clear, 1 = one match frees it, 2 = two. */
  hard: 0 | 1 | 2;
  /** Iron girder: the cell is out of play until a removal beside it breaks it. */
  block: boolean;
  r: number;
  c: number;
  isNew?: boolean;
  dead?: boolean;
  /** PP-13: minted by the player's own long match (pays even off-network). */
  forged?: boolean;
}

/** L10 (#225) — an obstacle count. */
export interface BoardObstacles {
  frost: number;
  girders: number;
  frostHard: 1 | 2;
}

/** Animation waits, in ms — shared with the DOM so input never unlocks early. */
export const BOARD_ANIMATION_MS = {
  swap: 80,
  clear: 95,
  fall: 105,
  bombClear: 130,
  bombFall: 115,
  shuffle: 110,
} as const;

/** Issue #152 — turbo waits while the player has the next move queued. */
export const FAST_ANIMATION_MS = {
  swap: 16,
  clear: 16,
  fall: 16,
  bombClear: 24,
  bombFall: 16,
  shuffle: 110,
} as const;

export type AnimationKey = keyof typeof BOARD_ANIMATION_MS;

export type FxType = "pop" | "crack" | "up" | "boom" | "bad" | "chain" | "combo" | "cross" | "bcross";
/** A gem's special: a bomb (match 5) purges a colour; a line gem (match 4)
 * clears its row and column — or, swapped, just the row (left/right) or the
 * column (up/down); a disco ball (match 5) wipes the whole board. Bombs are
 * minted by L-shapes and crosses. */
export type Special = null | "bomb" | "line" | "disco";
export type CrossKind = "holy" | "broken";

/** B1 (#246) — one resolved pass, seen by the battle engine. */
export interface PassReport {
  cleared: Partial<Record<ResKey, number>>;
  biggest: number;
  shaped: boolean;
  chain: number;
  purged: number;
}

/** L12 (#227) — the kinds of board reward a score-paying board reports. */
export type RewardKind = "holyCross" | "brokenCross" | "shape" | "combo" | "frost" | "girder" | "disco";

export const HOLY_CROSS_PICKS = 6;
export const BROKEN_CROSS_PICKS = 3;

/** The word a cascade pass shouts, by how deep in the cascade it is. */
export function arcadeLabel(chain: number): string {
  if (chain <= 1) return "MATCH!";
  if (chain === 2) return "COMBO x2";
  return `CHAIN x${chain}!!`;
}

// ── the phase stream ──────────────────────────────────────────────────────

export interface CellRef {
  r: number;
  c: number;
}

export interface FxEvent {
  type: FxType;
  r: number;
  c: number;
  text?: string;
}

export interface CellGem extends CellRef {
  id: number;
  res: ResKey;
}

/** Two stones trade places. `contactAt` is the fraction of the swap beat at
 * which the two stones touch — the frame the clack is hooked on. */
export interface SwapPhase {
  type: "swap" | "revert";
  a: CellGem;
  b: CellGem;
  contactAt: number;
  /** A bomb is being carried into a colour — the swap will detonate. */
  bomb: boolean;
}

export interface CrossHit {
  gems: Gem[];
  mid: Gem;
  kind: CrossKind;
}

/** One resolved pass: what left the grid and what merely cracked. */
export interface ClearPhase {
  type: "clear" | "bombClear";
  chain: number;
  removed: CellGem[];
  cracked: { r: number; c: number; kind: "frost" | "girder"; left: number }[];
  /** Tokens forged / bombs minted in place this pass (drawn as an `up`/`boom`). */
  minted: { r: number; c: number; what: "token" | "bomb" | "line" | "disco" }[];
  fx: FxEvent[];
  rewards: RewardKind[];
  bonus: { res: ResKey; amount: number; reason: string }[];
  crosses: CrossHit[];
  cleared: number;
  pass: PassReport;
  /** A disco ball went off: the whole board is wiped (every cell bursts). */
  wipe?: boolean;
  /** A bomb blast's centre, for the shockwave. */
  bombAt?: CellRef;
  /** The callout text (`MATCH!`, `MATCH 5 · COMBO x2`, `COLOUR PURGE`). */
  label: string;
}

export interface FallMove {
  id: number;
  res: ResKey;
  c: number;
  /** Negative for a gem spawned above the board. */
  fromR: number;
  toR: number;
  spawned: boolean;
}

export interface FallPhase {
  type: "fall" | "bombFall";
  moves: FallMove[];
  /** Cascade depth the fall belongs to (the settle sound climbs with it). */
  chain: number;
}

export interface ShufflePhase {
  type: "shuffle";
}

/** PP-14: the cascade pauses here until the chooser answers (cargo boards). */
export interface CrossChoicePhase {
  type: "crossChoice";
  kind: CrossKind;
  picks: number;
}

/** The cross chooser's answer, paid out (the picks plus any random top-up). */
export interface CrossBonusPhase {
  type: "crossBonus";
  bonus: ClearPhase["bonus"];
}

/** The cascade is over: what the readout shows and how deep it went. */
export interface EndPhase {
  type: "end";
  gains: Partial<Record<ResKey, number>>;
  label: string;
  maxChain: number;
}

export type BoardPhase = SwapPhase | ClearPhase | FallPhase | ShufflePhase | CrossChoicePhase | CrossBonusPhase | EndPhase;

/** What `Board.trySwap` resolves to (the legacy signature returned nothing;
 * a value is strictly more information and breaks no caller). */
export type SwapOutcome = "matched" | "reverted" | "refused" | "queued";
