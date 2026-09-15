// ══════════════════════════════════════════════════════════════════════════
// L1d (#235) — the race harness, on the new loop's economy.
//
// The ticket's second acceptance line: "A `test:slow` race with the flag on
// finishes (no deadlock); note the win times in the PR." This file is that
// run. It is a DEADLOCK DETECTOR, not a balance gate:
//
//   • both seats are driven by the live rival's own turn (`aiBuildStep` →
//     `planUpgrades` → bank → market), so "the AI rewrite" (#229) can land
//     later without this file changing;
//   • income is the new loop's clock (`loopIncome` in helpers/race.ts — the
//     harness twin of game.ts's `economyTick` branch), dirt is free at the
//     build step (L2), and each depot carries the simulated tuning level its
//     seat's difficulty prints (L4);
//   • what must hold is that the game ENDS and that both seats played it:
//     somebody reaches the line inside the window, the trailer scored too, and
//     every depot the winner and the loser raised has a yield level the clock
//     can pay.
//
// What is deliberately NOT asserted: who wins, or how fast. The new loop's
// numbers are untuned — L2/L3/L12/#229 all still move them — so a pace
// assertion here would be a guess that the next ticket breaks. The win times
// are PRINTED (and quoted in the PR) instead.
//
// Heavy by design (two seeds × a whole simulated match each): it lives in
// `npm run test:slow`, next to the AI sweep and the rebalance sweep.
//
//   L1D_RACE_SEEDS=1337,7,42,99 npx vitest run tests/unit/iso-l1d-race.test.ts
// ══════════════════════════════════════════════════════════════════════════
import { beforeAll, describe, it, expect } from "vitest";
import { VP_TARGET } from "../../src/iso/config";
import { plantsOf } from "../../src/iso/plants";
import { runRace, pacePerMinute, MIN } from "./helpers/race";

const RACE_MINUTES = Number(process.env.L1D_RACE_MINUTES ?? 30);
const SEEDS = (process.env.L1D_RACE_SEEDS ?? "1337,7").split(",").map((x) => Number(x));

describe("L1d (#235) a whole race on the new loop's clock", () => {
  let races: ReturnType<typeof runRace>[] = [];

  beforeAll(() => {
    races = SEEDS.map((seed) => runRace(seed, { minutes: RACE_MINUTES, newLoop: true }));
    // The numbers the PR quotes. Printed unconditionally: this file exists to
    // answer "does it finish, and in what time", and the answer is the table.
    for (const r of races) {
      console.log(`[L1d race] seed ${r.seed} (newLoop, ${RACE_MINUTES}m window)`, JSON.stringify({
        winner: r.winner ? `${r.winner.id} at ${MIN(r.winner.at)}` : `none inside ${RACE_MINUTES}m`,
        vp: r.vp,
        seats: r.seats.map((s) => ({
          seat: s.id,
          firstPoint: s.firstPoint === null ? "—" : MIN(s.firstPoint),
          paves: s.paves,
          depots: r.eco.harvesters.filter((h) => h.owner === s.id).length,
          plants: plantsOf(r.eco, s.id).length,
          purse: Object.fromEntries(
            Object.entries(s.purse).filter(([k, v]) => k !== "gold" && (v as number) > 0)
              .map(([k, v]) => [k, Math.round(v as number)]),
          ),
        })),
      }));
    }
  }, 900_000);

  it("finishes: a seat reaches the line, and the other one was racing", () => {
    for (const r of races) {
      expect(r.winner, `seed ${r.seed}: no seat reached ${VP_TARGET}★ in ${RACE_MINUTES}m — deadlock`)
        .toBeTruthy();
      expect(r.vp[r.winner!.id]).toBeGreaterThanOrEqual(VP_TARGET);
      const trailer = Math.min(r.vp.you, r.vp.ai);
      expect(trailer, `seed ${r.seed}: the loser never scored`).toBeGreaterThan(0);
      expect(trailer, `seed ${r.seed}: the loser stalled out of the race`)
        .toBeGreaterThanOrEqual(VP_TARGET / 4);
    }
  }, 900_000);

  it("both seats earn on the clock and keep expanding", () => {
    for (const r of races) {
      for (const seat of r.seats) {
        const depots = r.eco.harvesters.filter((h) => h.owner === seat.id);
        expect(depots.length, `seed ${r.seed}/${seat.id} raised no depot`).toBeGreaterThan(0);
        // Every depot carries the level the clock multiplies by — a depot with
        // no level is a depot the clock cannot pay (L4's simulated session).
        for (const d of depots) {
          expect(d.yield, `seed ${r.seed}/${seat.id} depot ${d.id} has no yield`).toBeDefined();
        }
        expect(seat.paves, `seed ${r.seed}/${seat.id} never paved`).toBeGreaterThan(0);
        expect(seat.oreOnPaves, `seed ${r.seed}/${seat.id} spent no ore on the score`)
          .toBeGreaterThan(0);
        // The clock paid it: a seat that scored and paved on clock income alone
        // ends the race having EARNED — its purse is never overdrawn, and its
        // pace never went backwards (nothing in the harness demolishes).
        for (const [cargo, v] of Object.entries(seat.purse)) {
          expect(v, `seed ${r.seed}/${seat.id} ${cargo} negative`).toBeGreaterThanOrEqual(0);
        }
        expect(pacePerMinute(r, seat.id as "you" | "ai"),
          `seed ${r.seed}/${seat.id} lost points mid-race`).toBeGreaterThanOrEqual(0);
      }
    }
  }, 900_000);
});
