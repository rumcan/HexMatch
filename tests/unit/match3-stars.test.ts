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
  it("has five rising rows, read off the yield curve", () => {
    expect(TUNING_STARS.map((r) => r.stars)).toEqual([1, 2, 3, 4, 5]);
    for (let i = 1; i < TUNING_STARS.length; i++) expect(TUNING_STARS[i].curve).toBeGreaterThan(TUNING_STARS[i - 1].curve);
    expect(tuningStarScores()).toEqual([1, 408, 864, 1410, 1680]);
  });

  it("rates a score by the highest bar it reaches", () => {
    expect(tuningStarsFor(0)).toBe(0);
    expect(tuningStarsFor(-3)).toBe(0);
    expect(tuningStarsFor(NaN)).toBe(0);
    expect(tuningStarsFor(1)).toBe(1);
    expect(tuningStarsFor(407)).toBe(1);
    expect(tuningStarsFor(408)).toBe(2);
    expect(tuningStarsFor(863)).toBe(2);
    expect(tuningStarsFor(864)).toBe(3);
    expect(tuningStarsFor(1409)).toBe(3);
    expect(tuningStarsFor(1410)).toBe(4);
    expect(tuningStarsFor(1679)).toBe(4);
    expect(tuningStarsFor(1680)).toBe(5);
    expect(tuningStarsFor(9999)).toBe(5);
  });

  it("is harder than #300's table: the old ★★★ (score 60) is ★ now, ★★ needs 408", () => {
    expect(tuningStarsFor(60)).toBe(1);
    expect(tuningStarsFor(30)).toBe(1);
  });

  it("leaves the yield curve itself untouched (BAL-1's numbers)", () => {
    expect(tuningYieldFor(0)).toBe(1);
    expect(tuningYieldFor(30)).toBe(1.75);
    expect(tuningYieldFor(TUNING.targetScore)).toBe(TUNING.maxYield);
    expect(tuningYieldFor(120)).toBe(4);
    // the game's curve (src/iso/tuning.ts): the climb runs floor → maxYield at
    // the target, so a raised floor makes it shallower (Easy's ×1.5 floor)
    expect(tuningYieldFor(30, 1.5)).toBe(2);
    // the tiers are points on that same line
    const tiers = starTierYields(1);
    expect(tiers.map((t) => t.score)).toEqual([1, 408, 864, 1410, 1680]);
    for (const t of tiers) expect(t.yield).toBe(tuningYieldFor(t.score, 1));
    expect(starTierYields(1.5)[1].yield).toBe(8.3);
  });

  it("names every tier and counts the distance to the next", () => {
    expect(tuningStarLabel(1)).toBe("Tuned");
    expect(tuningStarLabel(5)).toBe("Legendary");
    expect(tuningStarLabel(0)).toBe("");
    expect(scoreToNextStar(0)).toBe(1);
    expect(scoreToNextStar(40)).toBe(368);
    expect(scoreToNextStar(1680)).toBe(0);
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
