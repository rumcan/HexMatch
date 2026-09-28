// ══════════════════════════════════════════════════════════════════════════
// MATCH-2 (#566) — the 5★ rating, as the match-3 module sees it.
//
// The table and the curve live in the game: `TUNING` / `TUNING_STARS` in
// src/iso/config.ts and the functions that read them in src/iso/tuning.ts.
// This module re-exports them (so the engine, the bot and the session runner
// rate a score exactly as the results pop-up does) and adds the few helpers
// the 5-scale needs on top: the distance to the next star, the glyph string,
// and the migration of a remembered 0–3 rating.
//
// Migration keeps the COUNT: an old ★★★ stays ★★★ on the 5-scale. A save
// carries no score to re-rate from, and demoting a remembered result would
// read as a bug on the depot card ("Last: ★★★☆☆ — beat it!"). Every old value
// is already a legal 5-scale value, so loading a save needs no rewrite — the
// validators only had to widen from 0…3 to 0…5.
// ══════════════════════════════════════════════════════════════════════════

import { TUNING, TUNING_STARS, type TuningStarRow } from "../iso/config";
import {
  clampYield, roundYield, tuningGoldFor, tuningStarLabel, tuningStarScores, tuningStarsFor, tuningYieldFor,
  type TuningStars,
} from "../iso/tuning";

export {
  TUNING, TUNING_STARS, clampYield, roundYield, tuningGoldFor, tuningStarLabel, tuningStarScores, tuningStarsFor,
  tuningYieldFor,
};
export type { TuningStarRow, TuningStars };

/** The top of the scale. */
export const STAR_SCALE = 5 as const;

/** Score still needed for the next star (0 at ★★★★★). */
export function scoreToNextStar(score: number): number {
  const s = Number.isFinite(score) ? score : 0;
  for (const bar of tuningStarScores()) if (s < bar) return bar - s;
  return 0;
}

/** The yield each star is worth at its bar, on a given floor. */
export function starTierYields(floor: number = TUNING.minYield): { stars: number; score: number; yield: number; label: string }[] {
  const bars = tuningStarScores();
  return TUNING_STARS.map((row, i) => ({ stars: row.stars, score: bars[i], yield: tuningYieldFor(bars[i], floor), label: row.label }));
}

/**
 * Any remembered rating on the 5-scale: the count is kept, junk becomes 0.
 * (Old saves hold 0–3, which are 5-scale values already.)
 */
export function migrateLegacyStars(old: unknown): TuningStars {
  if (typeof old !== "number" || !Number.isFinite(old)) return 0;
  const n = Math.floor(old);
  if (n <= 0) return 0;
  return Math.min(STAR_SCALE, n) as TuningStars;
}

/** Is `n` a legal remembered rating (an integer 0…5)? */
export function isStarRating(n: unknown): n is TuningStars {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= STAR_SCALE;
}

/** "★★★☆☆" — the depot card's glyph string. */
export function starGlyphs(stars: number, scale: number = STAR_SCALE): string {
  const n = Math.max(0, Math.min(scale, Math.floor(Number.isFinite(stars) ? stars : 0)));
  return "★".repeat(n) + "☆".repeat(scale - n);
}
