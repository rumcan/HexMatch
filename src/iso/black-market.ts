// BM-2 (#560): live deadlines use the host-authoritative match clock, not
// performance.now(). Saves carry remaining time and rebase on restore.
import type { ObstacleRules } from "./config";
import { TUNING } from "./config";
import { obstacleDrag } from "./tuning";

export const SESSION_SABOTAGE = {
  frost: { durationMs: 120_000, frost: 4, girders: 2, lostMoves: 0 },
  redTape: { durationMs: 60_000, frost: 0, girders: 0, lostMoves: 2 },
} as const;
export type SessionSabotageKey = keyof typeof SESSION_SABOTAGE;
/** Shared across these cards: no alternating purchases to keep a seat locked. */
export const SESSION_SABOTAGE_COOLDOWN_MS = 180_000;
export interface BlackMarketState {
  frostUntil: number;
  redTapeUntil: number;
  readyAt: number;
  /**
   * PERK-1 (#600): Rafael's Heavy Hands — while a frost card is armed on
   * THIS seat, its frost and girder counts grow by these (both 1 for the
   * perk). Additive optional: an old save or wire without them reads 0.
   */
  frostBonus?: number;
  girdersBonus?: number;
}
export function readBlackMarket(raw?: Partial<BlackMarketState>): BlackMarketState {
  const deadline = (n: unknown) => typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : 0;
  const bonus = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
  return {
    frostUntil: deadline(raw?.frostUntil), redTapeUntil: deadline(raw?.redTapeUntil), readyAt: deadline(raw?.readyAt),
    frostBonus: bonus(raw?.frostBonus), girdersBonus: bonus(raw?.girdersBonus),
  };
}
/** Translate live deadlines to remaining time for saves, or back on restore. */
export function rebaseBlackMarket(state: BlackMarketState | undefined, from: number, to: number): BlackMarketState {
  const clean = readBlackMarket(state);
  const rebase = (deadline: number) => deadline > from ? to + deadline - from : 0;
  return { frostUntil: rebase(clean.frostUntil), redTapeUntil: rebase(clean.redTapeUntil), readyAt: rebase(clean.readyAt) };
}
export function isSessionSabotage(key: string): key is SessionSabotageKey {
  return Object.prototype.hasOwnProperty.call(SESSION_SABOTAGE, key);
}
/**
 * PERK-1 (#600): `bonusTiles` is the SENDER's Heavy Hands — a frost card
 * armed with it lands that many EXTRA frost tiles and girders on the target,
 * riding the card's own deadline (the bonus dies with `frostUntil`). 0/omitted
 * arms the shipped card.
 */
export function armSessionSabotage(
  actor: BlackMarketState, target: BlackMarketState, key: SessionSabotageKey, now: number,
  bonusTiles = 0,
): void {
  actor.readyAt = now + SESSION_SABOTAGE_COOLDOWN_MS;
  if (key === "frost") {
    target.frostUntil = now + SESSION_SABOTAGE.frost.durationMs;
    if (bonusTiles > 0) {
      target.frostBonus = bonusTiles;
      target.girdersBonus = bonusTiles;
    }
  } else {
    target.redTapeUntil = now + SESSION_SABOTAGE.redTape.durationMs;
  }
}
/** Read once when a session opens. Existing sessions are never changed mid-swap. */
export function sessionSabotage(state: BlackMarketState | undefined, now: number) {
  return {
    frost: now < (state?.frostUntil ?? 0)
      ? SESSION_SABOTAGE.frost.frost + (state?.frostBonus ?? 0)
      : 0,
    girders: now < (state?.frostUntil ?? 0)
      ? SESSION_SABOTAGE.frost.girders + (state?.girdersBonus ?? 0)
      : 0,
    lostMoves: now < (state?.redTapeUntil ?? 0) ? SESSION_SABOTAGE.redTape.lostMoves : 0,
  };
}
export function sabotagedObstacles(base: ObstacleRules, state: BlackMarketState | undefined, now: number): ObstacleRules {
  const extra = sessionSabotage(state, now);
  return { frost: base.frost + extra.frost, girders: base.girders + extra.girders, frostHard: base.frostHard };
}
/** The AI's simulated sessions pay the same obstacle/move penalty. */
export function sabotagedScore(score: number, state: BlackMarketState | undefined, now: number): number {
  const extra = sessionSabotage(state, now);
  return score * (1 - obstacleDrag({ ...extra, frostHard: 1 })) * (TUNING.moves - extra.lostMoves) / TUNING.moves;
}
