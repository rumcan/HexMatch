/**
 * #300 — the results pop-up's STAR THRESHOLDS, and the outcome it counts up.
 *
 * Pure: no DOM, no game. The thresholds live in ONE table (`TUNING_STARS`,
 * config.ts) whose rows are points on the score→yield curve
 * (`tuningYieldFor`, tuning.ts), so this file pins three things:
 *
 *   1. the table itself — one row per star, rising, on the curve;
 *   2. the derivation — each row's bar is its point on the curve, on every
 *      difficulty (MATCH-2 #566: five rows now, and the bars sit PAST the
 *      max-yield target — a target session is one star);
 *   3. the outcome the pop-up shows (`depotSessionOutcome`) is the number the
 *      settle has always applied (`settleTuningYield` + the Gold rules) — the
 *      "Confirm applies exactly the yield shown" half that needs no game.
 */
import { describe, expect, it } from "vitest";
import {
  DEPOT_LEVELS, DIFFICULTY_RULES, TUNING, TUNING_STARS, depotYieldCap, type DifficultyRules,
} from "../../src/iso/config";
import {
  depotSessionOutcome, overshootGold, settleTuningYield, tuningGoldFor, tuningStarLabel,
  tuningStarScores, tuningStarsFor, tuningYieldFor,
} from "../../src/iso/tuning";

const RULES = Object.entries(DIFFICULTY_RULES) as [string, DifficultyRules][];

describe("#300 the star table (TUNING_STARS)", () => {
  // MATCH-2 (#566): the scale is 1–5★ and every bar above the first sits past
  // the target (the curve runs on past it at the same slope — no ceiling).
  it("has one row per star, 1 → 5, in rising order", () => {
    expect(TUNING_STARS.map((r) => r.stars)).toEqual([1, 2, 3, 4, 5]);
    for (let i = 0; i < TUNING_STARS.length; i++) {
      const row = TUNING_STARS[i];
      expect(row.curve, `row ${i} is a point on the curve`).toBeGreaterThanOrEqual(0);
      if (i > 0) expect(row.curve, `row ${i} is past the target`).toBeGreaterThan(1);
      if (i > 0) expect(row.curve, "each star asks for more of the climb").toBeGreaterThan(TUNING_STARS[i - 1].curve);
      expect(row.label.length, `row ${i} has a verdict word`).toBeGreaterThan(0);
    }
  });

  it("derives every bar from the curve: the row's share of targetScore, never below 1", () => {
    const bars = tuningStarScores();
    expect(bars).toHaveLength(TUNING_STARS.length);
    TUNING_STARS.forEach((row, i) => {
      expect(bars[i]).toBe(Math.max(1, Math.ceil(row.curve * TUNING.targetScore - 1e-9)));
    });
    // The shipped table, spelled out (owner, 2026-09-29: 5★ at 2000).
    expect(bars).toEqual([1, 500, 1000, 1500, 2000]);
  });

  it("pays the yield by the star: the top bar is the Depot's cap (owner, 2026-09-29)", () => {
    const top = tuningStarScores()[TUNING_STARS.length - 1];
    expect(tuningStarsFor(top)).toBe(5);
    expect(tuningStarsFor(top - 1)).toBe(4);
    expect(tuningYieldFor(top)).toBe(depotYieldCap(undefined));
    expect(tuningYieldFor(top - 1)).toBe(1.8);
  });

  it("rates the boundaries — 0 stars only when nothing was cleared", () => {
    const cases: [number, number][] = [
      [0, 0], [1, 1], [499, 1], [500, 2], [999, 2], [1000, 3], [1499, 3], [1500, 4], [1999, 4], [2000, 5], [5000, 5],
    ];
    for (const [score, stars] of cases) expect(tuningStarsFor(score), `score ${score}`).toBe(stars);
    expect(tuningStarsFor(-5)).toBe(0);
    expect(tuningStarsFor(Number.NaN)).toBe(0);
    expect(tuningStarsFor(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("reads every bar off the table — its own row's stars, at its own score", () => {
    const bars = tuningStarScores();
    TUNING_STARS.forEach((row, i) => {
      expect(tuningStarsFor(bars[i]), `the bar of the ${row.stars}★ row`).toBe(row.stars);
      if (bars[i] > 1) expect(tuningStarsFor(bars[i] - 1)).toBe(row.stars - 1);
    });
  });

  it("asks the same score on every difficulty: a bar is a score, never a yield", () => {
    const bars = tuningStarScores();
    for (const [key, rules] of RULES) {
      // the same bars rate every row; a raised floor only lifts the minimum
      TUNING_STARS.forEach((row, i) => expect(tuningStarsFor(bars[i]), key).toBe(row.stars));
      expect(tuningYieldFor(bars[bars.length - 1], rules.minYield), key).toBe(depotYieldCap(undefined));
    }
  });

  it("names each rating with the table's verdict word, and none for zero", () => {
    for (const row of TUNING_STARS) expect(tuningStarLabel(row.stars)).toBe(row.label);
    expect(tuningStarLabel(0)).toBe("");
  });
});

describe("#300 the outcome the pop-up counts up (depotSessionOutcome)", () => {
  const normal = DIFFICULTY_RULES.normal;

  it("is EXACTLY what the settle applies — yield and Gold — across scores, levels, caps and rows", () => {
    const caps = [undefined, ...DEPOT_LEVELS.caps];
    const prevs = [undefined, 1, 1.5, 2, 2.2, 3.4, 5];
    for (const [key, rules] of RULES) {
      for (const cap of caps) {
        for (const prev of prevs) {
          for (let score = 0; score <= 2400; score += 71) {
            const o = depotSessionOutcome(score, prev, rules, { cap });
            const tag = `${key} cap ${cap} prev ${prev} score ${score}`;
            expect(o.yield, tag).toBe(settleTuningYield(prev, score, rules, { cap }));
            const over = cap === undefined ? 0 : overshootGold(score, rules, cap);
            expect(o.gold, tag).toBe(tuningGoldFor(score) + over);
            expect(o.overshootGold, tag).toBe(over);
            expect(o.stars, tag).toBe(tuningStarsFor(score));
            expect(o.raw, tag).toBe(tuningYieldFor(score, rules.minYield, cap));
          }
        }
      }
    }
  });

  it("a 5★ session sets a fresh level-1 Depot to its cap — never past it", () => {
    const cap = depotYieldCap(undefined);
    expect(cap).toBe(DEPOT_LEVELS.caps[0]);
    const o = depotSessionOutcome(2000, normal.minYield, normal, { cap });
    expect(o.stars).toBe(5);
    expect(o.raw).toBe(cap);
    expect(o.yield).toBe(cap);
    expect(o.capped).toBe(false);
    expect(o.kept).toBe(false);
    expect(o.from).toBe(normal.minYield);
    expect(o.overshootGold).toBe(0);
    expect(o.gold).toBe(TUNING.maxGold);
  });

  it("says when the never-drops rule kept the old level — and when a row without it replaces it", () => {
    const kept = depotSessionOutcome(10, 2.5, normal, { cap: 4 });
    expect(normal.yieldNeverDrops).toBe(true);
    expect(kept.yield).toBe(2.5);
    expect(kept.kept).toBe(true);
    expect(kept.raw).toBeLessThan(2.5);

    const harsh: DifficultyRules = { ...DIFFICULTY_RULES.hard, yieldNeverDrops: false };
    const dropped = depotSessionOutcome(10, 2.5, harsh, { cap: 4 });
    expect(dropped.yield).toBe(tuningYieldFor(10, harsh.minYield, 4));
    expect(dropped.yield).toBeLessThan(dropped.from);
    expect(dropped.kept).toBe(false);
  });

  it("rates an empty session 0 stars and prices an abandon at the default with no Gold", () => {
    const empty = depotSessionOutcome(0, undefined, normal, { cap: 2 });
    expect(empty.stars).toBe(0);
    expect(empty.gold).toBe(0);
    expect(empty.yield).toBe(normal.minYield);

    const quit = depotSessionOutcome(55, 1.8, normal, { cap: 2, abandon: true });
    expect(quit.stars, "an abandon is never rated").toBe(0);
    expect(quit.gold).toBe(0);
    expect(quit.yield).toBe(settleTuningYield(1.8, 55, normal, { cap: 2, abandon: true }));
  });
});
