// MATCH-2 — the 5★ table, the thresholds on L4's curve, and the save migration.
import { describe, expect, it } from "vitest";
import {
  STAR_SCALE,
  TUNING,
  TUNING_STARS,
  isStarRating,
  migrateLegacyStars,
  scoreToNextStar,
  starGlyphs,
  starTierYields,
  tuningStarLabel,
  tuningStarScores,
  tuningStarsFor,
  tuningYieldFor,
} from "../../src/match3";

describe("MATCH-2 — the 5★ scale", () => {
  // Owner (2026-09-29): "2000 should be 5 stars" — even bars every 250.
  it("has five rising rows, 5★ at 2000", () => {
    expect(TUNING_STARS.map((r) => r.stars)).toEqual([1, 2, 3, 4, 5]);
    for (let i = 1; i < TUNING_STARS.length; i++) expect(TUNING_STARS[i].curve).toBeGreaterThan(TUNING_STARS[i - 1].curve);
    expect(tuningStarScores()).toEqual([1, 500, 1000, 1500, 2000]);
  });

  it("rates a score by the highest bar it reaches", () => {
    expect(tuningStarsFor(0)).toBe(0);
    expect(tuningStarsFor(-3)).toBe(0);
    expect(tuningStarsFor(NaN)).toBe(0);
    expect(tuningStarsFor(1)).toBe(1);
    expect(tuningStarsFor(499)).toBe(1);
    expect(tuningStarsFor(500)).toBe(2);
    expect(tuningStarsFor(999)).toBe(2);
    expect(tuningStarsFor(1000)).toBe(3);
    expect(tuningStarsFor(1499)).toBe(3);
    expect(tuningStarsFor(1500)).toBe(4);
    expect(tuningStarsFor(1999)).toBe(4);
    expect(tuningStarsFor(2000)).toBe(5);
    expect(tuningStarsFor(9999)).toBe(5);
  });

  // Owner (2026-09-29): the yield IS the star rating — +0.2 a star on a
  // level-1 Depot (cap ×2): 2★ ×1.4, 5★ ×2.0; a higher cap stretches the steps.
  it("pays the yield by the star, up to the Depot's cap", () => {
    expect(tuningYieldFor(0)).toBe(1);
    expect(tuningYieldFor(1)).toBe(1.2);
    expect(tuningYieldFor(500)).toBe(1.4);
    expect(tuningYieldFor(1000)).toBe(1.6);
    expect(tuningYieldFor(1500)).toBe(1.8);
    expect(tuningYieldFor(2000)).toBe(2);
    expect(tuningYieldFor(5000)).toBe(2);
    expect(tuningYieldFor(2000, 1, 4)).toBe(4);
    expect(tuningYieldFor(500, 1, 4)).toBe(2.2);
    // a raised floor (Easy ×1.5) is still the minimum
    expect(tuningYieldFor(1, 1.5)).toBe(1.5);
    const tiers = starTierYields(1);
    expect(tiers.map((t) => t.score)).toEqual([1, 500, 1000, 1500, 2000]);
    expect(tiers.map((t) => t.yield)).toEqual([1.2, 1.4, 1.6, 1.8, 2]);
  });

  it("names every tier and counts the distance to the next", () => {
    expect(tuningStarLabel(1)).toBe("Tuned");
    expect(tuningStarLabel(5)).toBe("Legendary");
    expect(tuningStarLabel(0)).toBe("");
    expect(scoreToNextStar(0)).toBe(1);
    expect(scoreToNextStar(40)).toBe(460);
    expect(scoreToNextStar(2000)).toBe(0);
  });

  it("prints the depot card's glyphs on the 5-scale", () => {
    expect(starGlyphs(0)).toBe("☆☆☆☆☆");
    expect(starGlyphs(2)).toBe("★★☆☆☆");
    expect(starGlyphs(5)).toBe("★★★★★");
    expect(starGlyphs(7)).toBe("★★★★★");
    expect(starGlyphs(2, 3)).toBe("★★☆");
  });
});

describe("MATCH-2 — saves and snapshots migrate 0–3 → 0–5", () => {
  it("keeps the count of an old value and rejects junk", () => {
    expect(migrateLegacyStars(0)).toBe(0);
    expect(migrateLegacyStars(1)).toBe(1);
    expect(migrateLegacyStars(2)).toBe(2);
    expect(migrateLegacyStars(3)).toBe(3);
    expect(migrateLegacyStars(3.7)).toBe(3);
    expect(migrateLegacyStars(-1)).toBe(0);
    expect(migrateLegacyStars("3")).toBe(0);
    expect(migrateLegacyStars(undefined)).toBe(0);
    expect(migrateLegacyStars(Infinity)).toBe(0);
  });

  it("knows a legal remembered rating: an integer 0…5 (every old 0…3 value is one)", () => {
    for (const n of [0, 1, 2, 3, 4, 5]) expect(isStarRating(n), String(n)).toBe(true);
    for (const n of [-1, 6, 2.5, NaN, "3", null, undefined]) expect(isStarRating(n), String(n)).toBe(false);
    expect(STAR_SCALE).toBe(5);
  });
});
