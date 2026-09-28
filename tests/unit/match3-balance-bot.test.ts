// MATCH-2 — the acceptance gate: a scripted average player over N seeded
// sessions averages 2.0 ± 0.3★, and a competent one hits 5★ in under 5%.
//
// Runs the depot board the game opens (grain bias, Normal's obstacles at the
// full row, ten moves) on the engine with no timers. ~600 sessions run in
// well under a second, so this sits in the default lane, not the slow one.
import { describe, expect, it } from "vitest";
import { BALANCE_GATE, balanceGate, runBalanceSweep, simulateSession } from "../../src/match3";

const N = 300;

describe("MATCH-2 — balance: the simulated players", () => {
  const average = runBalanceSweep("average", N, { difficulty: "normal", cargo: "grain", tier: 1, seedBase: 1000 });
  const competent = runBalanceSweep("competent", N, { difficulty: "normal", cargo: "grain", tier: 1, seedBase: 1000 });
  const random = runBalanceSweep("random", N, { difficulty: "normal", cargo: "grain", tier: 1, seedBase: 1000 });

  it("an average session scores about 2★ (2.0 ± 0.3)", () => {
    expect(average.sessions).toBe(N);
    expect(Math.abs(average.meanStars - BALANCE_GATE.averageMeanStars)).toBeLessThanOrEqual(BALANCE_GATE.averageTolerance);
  });

  it("5★ is rare for a competent player (under 5% of sessions)", () => {
    expect(competent.fiveStarRate).toBeLessThan(BALANCE_GATE.competentFiveStarMax);
  });

  it("the ladder is monotone: random ≤ average ≤ competent", () => {
    expect(random.meanScore).toBeLessThanOrEqual(average.meanScore + 1);
    expect(average.meanScore).toBeLessThanOrEqual(competent.meanScore + 1);
  });

  it("4★ takes a good run: the competent profile reaches it, the average one rarely", () => {
    expect(competent.fourPlusRate).toBeGreaterThan(0);
    expect(average.fourPlusRate).toBeLessThan(0.2);
  });

  it("the gate predicate agrees with the two assertions above", () => {
    const gate = balanceGate(average, competent);
    expect(gate.reasons).toEqual([]);
    expect(gate.pass).toBe(true);
  });
});

describe("MATCH-2 — balance: determinism", () => {
  it("the same seed replays the same session, move for move", () => {
    const a = simulateSession({ seed: 4242, profile: "competent" });
    const b = simulateSession({ seed: 4242, profile: "competent" });
    expect(a.score).toBe(b.score);
    expect(a.stars).toBe(b.stars);
    expect(a.session.tally).toEqual(b.session.tally);
    expect(a.movesPlayed).toBe(b.movesPlayed);
  });

  it("a different seed is a different board", () => {
    const scores = new Set(Array.from({ length: 12 }, (_, i) => simulateSession({ seed: 100 + i, profile: "average" }).score));
    expect(scores.size).toBeGreaterThan(3);
  });

  it("spends exactly the budget (dud swaps are not moves)", () => {
    const r = simulateSession({ seed: 77, profile: "average" });
    expect(r.session.used).toBe(r.session.moves);
    expect(r.movesPlayed).toBe(r.session.moves);
    expect(r.score).toBeGreaterThan(0);
  });

  it("opens with the difficulty's obstacles and still has a move", () => {
    const hard = simulateSession({ seed: 9, profile: "random", difficulty: "hard", tier: 1 });
    expect(hard.session.opened.frost).toBeGreaterThan(0);
    expect(hard.session.opened.girders).toBeGreaterThan(0);
    expect(hard.session.opened.frostHard).toBe(2);
    const easy = simulateSession({ seed: 9, profile: "random", difficulty: "easy" });
    expect(easy.session.opened).toEqual({ frost: 0, girders: 0, frostHard: 1 });
  });
});
