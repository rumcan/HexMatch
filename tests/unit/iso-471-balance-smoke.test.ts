// ══════════════════════════════════════════════════════════════════════════
// BAL-1 (#471) — the balance smoke. This is what `npm run test:slow` runs:
// a FEW seeds per matchup (default 8 — the first 8 seeds of the full run's
// 30, so the smoke and the report corroborate each other), asserting the
// ticket's targets have not drifted more than 15% (win rates ±15 percentage
// points, match length ±15% relative — the reading of "drifts more than 15%"
// spelled out in docs/BALANCE.md, because integer wins over a handful of
// seeds cannot carry a finer band).
//
//     BALANCE_SMOKE_SEEDS=1-8 npx vitest run tests/unit/iso-471-balance-smoke.test.ts
//
// The measured numbers and the ±5% acceptance verdict live in the full run
// (`npm run balance`) and the committed report block in docs/BALANCE.md.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";

import {
  runBalanceMatch, summarize, summaryLine, pct, parseSeeds,
  SMOKE_WIN_RATE_TOLERANCE_PP, SMOKE_LENGTH_TOLERANCE_REL, MIN,
  type BotKey,
} from "./helpers/balance-sim";
import type { SkillKey } from "../../src/iso/skill";

const SEEDS = parseSeeds(process.env.BALANCE_SMOKE_SEEDS ?? "1-8");
const MINUTES = Number(process.env.BALANCE_MINUTES ?? 25);

const MATCHUPS: { bot: BotKey; difficulty: SkillKey; target: { win: number | null; length: [number, number] | null } }[] = [
  { bot: "steady", difficulty: "easy", target: { win: 0.20, length: null } },
  { bot: "steady", difficulty: "normal", target: { win: 0.40, length: [15, 20] } },
  { bot: "steady", difficulty: "hard", target: { win: 0.60, length: null } },
  { bot: "novice", difficulty: "trainee", target: { win: 0, length: null } },
];

describe("BAL-1 (#471) balance smoke (a few seeds — the drift gate)", () => {
  for (const { bot, difficulty, target } of MATCHUPS) {
    it(`${bot} vs ${difficulty}: rival win rate and pace stay near target`, () => {
      const matches = SEEDS.map((seed) => runBalanceMatch(seed, bot, difficulty, { minutes: MINUTES }));
      const s = summarize(bot, difficulty, matches);
      console.log(`[balance smoke] ${summaryLine(s)}`);
      for (const m of matches) {
        console.log(`[balance smoke]   seed ${m.seed}: ${m.winner ?? "no decision"} at ${MIN(m.endMs)}`);
      }
      if (target.win !== null) {
        // A ±15pp band on the rival's win rate. The trainee's target is 0 —
        // "never beats novice" reads as: not one win in the measured seeds.
        const drift = Math.abs(s.rivalWinRate - target.win) * 100;
        expect(
          drift,
          `rival win rate ${pct(s.rivalWinRate)} drifted ${drift.toFixed(1)}pp from ${pct(target.win)} `
          + `(±${SMOKE_WIN_RATE_TOLERANCE_PP}pp allowed) — see docs/BALANCE.md`,
        ).toBeLessThanOrEqual(SMOKE_WIN_RATE_TOLERANCE_PP);
      }
      if (target.length !== null) {
        const lo = target.length[0] * (1 - SMOKE_LENGTH_TOLERANCE_REL);
        const hi = target.length[1] * (1 + SMOKE_LENGTH_TOLERANCE_REL);
        expect(
          s.meanMinutes,
          `mean match length ${s.meanMinutes.toFixed(1)}m outside ${lo.toFixed(1)}–${hi.toFixed(1)}m `
          + `(${target.length[0]}–${target.length[1]}m ±${(SMOKE_LENGTH_TOLERANCE_REL * 100).toFixed(0)}%) — see docs/BALANCE.md`,
        ).toBeGreaterThanOrEqual(lo);
        expect(s.meanMinutes).toBeLessThanOrEqual(hi);
      }
    }, 3_600_000);
  }
});
