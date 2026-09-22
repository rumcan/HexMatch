// ══════════════════════════════════════════════════════════════════════════
// B4 (#249) — the acceptance ladder, measured.
//
//   "Easy loses most battles to a greedy-move bot, Hard wins most
//    (unit/test:slow simulation over many seeds, results in the PR)."
//
// The greedy strawman always takes its best immediate swap (same static
// eye as the skills, no noise, no spells). Each challenger meets it over
// an even seat split (first-move advantage cancelled), fights to the
// engine's own verdict, and the tally is printed for the PR table.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { createBattle, type Battle, type BattleSeat } from "../../src/game/battle";
import { chooseBattleMove, greedyBattleMove, type RivalMove } from "../../src/iso/battle-ai";
import { BATTLE_RULES, type Cargo } from "../../src/iso/config";

const ALL: Cargo[] = ["grain", "wood", "ore", "stone", "oil", "gold"];

type Side = "easy" | "normal" | "hard" | "greedy";

const decide = (b: Battle, side: Side): Promise<RivalMove | null> =>
  side === "greedy" ? Promise.resolve(greedyBattleMove(b)) : chooseBattleMove(b, side);

interface Tally { wins: number; losses: number; draws: number }

/** One battle to the engine's verdict. `null` winner = draw. */
async function duel(seed: number, seat0: Side, seat1: Side): Promise<BattleSeat | null> {
  const b = createBattle({
    seed,
    players: [
      { id: "p0", name: "P0", depots: ALL },
      { id: "p1", name: "P1", depots: ALL },
    ],
    // a hair more room than the shipped 20 so health verdicts can settle,
    // and double bomb damage — with two shallow players the battles are
    // long and cautious, and the acceptance ladder needs verdicts (policy
    // vs policy is the thing measured; B7 owns the shipped numbers)
    rules: { ...BATTLE_RULES, turnLimit: 30, damagePerGem: 2, startHealth: 24 },
  });
  for (let guard = 0; guard < 500 && !b.state.over; guard++) {
    const side = b.state.turn === 0 ? seat0 : seat1;
    const mv = await decide(b, side);
    if (!mv) {
      await b.ensureMove();
      continue;
    }
    const out = mv.t === "ability"
      ? await b.useAbility(mv.id)
      : await b.playSwap(mv.r1, mv.c1, mv.r2, mv.c2, 0);
    if (!out.ok) await b.ensureMove();
  }
  return b.state.winner;
}

async function ladder(challenger: Exclude<Side, "greedy">, seeds: number): Promise<Tally> {
  const t: Tally = { wins: 0, losses: 0, draws: 0 };
  for (let s = 0; s < seeds; s++) {
    const seat0: Side = s % 2 === 0 ? challenger : "greedy";
    const seat1: Side = s % 2 === 0 ? "greedy" : challenger;
    const winner = await duel(1000 + s * 13, seat0, seat1);
    const mine: BattleSeat = (s % 2 === 0 ? 0 : 1) as BattleSeat;
    if (winner === null) t.draws++;
    else if (winner === mine) t.wins++;
    else t.losses++;
  }
  return t;
}

const report = (name: string, t: Tally): void => {
  const n = t.wins + t.losses + t.draws;
  // eslint-disable-next-line no-console
  console.log(`[battle-ai sim] ${name}: ${t.wins}W-${t.losses}L-${t.draws}D over ${n} battles`);
};

const SEEDS = 20; // 10 per seat — "many seeds", inside npm test's budget too

describe("B4 skill ladder vs the greedy-move bot", () => {
  it("Easy loses most battles to the greedy bot", async () => {
    const t = await ladder("easy", SEEDS);
    report("easy-vs-greedy", t);
    const n = t.wins + t.losses + t.draws;
    expect(t.losses).toBeGreaterThan(t.wins);
    expect(t.losses / n).toBeGreaterThan(0.5);
  }, 120_000);

  it("Hard wins most battles against the greedy bot", async () => {
    const t = await ladder("hard", SEEDS);
    report("hard-vs-greedy", t);
    const n = t.wins + t.losses + t.draws;
    expect(t.wins).toBeGreaterThan(t.losses);
    expect(t.wins / n).toBeGreaterThan(0.5);
  }, 120_000);

  it("Normal sits in between (report for the PR table)", async () => {
    const t = await ladder("normal", SEEDS);
    report("normal-vs-greedy", t);
    expect(t.wins + t.losses + t.draws).toBe(SEEDS);
  }, 120_000);
});
