// ══════════════════════════════════════════════════════════════════════════
// VP-01 — the race to ten, measured.
//
// `iso-victory.test.ts` pins what scores. `iso-progression.test.ts` pins the
// opening economy. Neither answers the question this ticket really raises:
// **can a player reach 10★ at all, and does the AI get there by playing its own
// plan?** A target nobody can hit is worse than a target that is too easy, so
// this file runs the real modules head to head — both seats driven by the
// rival's own turn, in order: plant → depot (`aiBuildStep`) → pave
// (`planUpgrades` + `executePaves`) → bank, with the same clocks the live game
// uses and income from `playerResources` only. The simulation machinery lives
// in `tests/unit/helpers/race.ts` (the AI-01 calibration harness shares it,
// with per-seat difficulty presets and the market offers the live rival posts).
//
// Two deliberate omissions make every number here an UPPER bound on a real
// game's, which is how the table should be read:
//
//   * no match-3 board — a human turning gems into Ore paves far faster than a
//     seat that can only trade at the bank;
//   * no Black Market, no sabotage, no blockades.
//
// The window is one finished game, not a fixed slice: the loop breaks the moment
// a seat reaches 10★ (≈12 in-game simulated minutes, ≈50s of wall clock on a
// dev machine — the only file in the suite that plans a whole match for two
// players). The assertions are about the SHAPE of the game — someone scoring within the
// opening, the total always equal to what the board says, a scoreboard that
// never moves backwards while nothing is demolished, and a leader whose PACE
// closes 10★ inside a session. Pacing itself is measured over a long run:
//
//   VP_RACE_MINUTES=45 VP_RACE_SEEDS=1337,7,42,99 npx vitest run tests/unit/iso-vp-race.test.ts
//
// whose printed table feeds the playtest report in `docs/`.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { victoryBreakdown } from "../../src/iso/victory";
import { plantsOf } from "../../src/iso/plants";
import { VICTORY, VP_TARGET } from "../../src/iso/config";
import {
  runRace, pavedCount, countTier, pacePerMinute, MIN,
} from "./helpers/race";

/**
 * The simulated horizon, in in-game minutes. It is long enough for the window to
 * contain a FINISHED game (the line is back to 10★ — 9.9–17.6m to the flag on
 * the measured seeds; the AI-02 20★ detour closed at 16.8–25.4m on this one),
 * and short enough to stay a unit test.
 *
 * PP-16 moved this window (24 → 30): with one holder per industry, a seat can
 * no longer park its fifth Depot on a rich cluster it already shares, so every
 * extra Depot costs the road out to fresh ground. Measured on this seed after
 * the change, to the old 20★ line: `you` closed at 25.4m with 5 depots and
 * 80 paves, `ai` was 4m behind on 3 depots — the race is still a race, it is
 * just honestly
 * contested, and the pace floor below is unchanged. If the window ever needs to
 * move again, the printed table (and the playtest report in `docs/`) is where
 * the number comes from.
 * A playtest run raises it and reads the printed table:
 *
 *   VP_RACE_MINUTES=45 VP_RACE_SEEDS=1337,7,42 npx vitest run tests/unit/iso-vp-race.test.ts
 */
const RACE_MINUTES = Number(process.env.VP_RACE_MINUTES ?? 30);
/** Seeds to race. One is enough for the invariant; a playtest wants the spread. */
const SEEDS = (process.env.VP_RACE_SEEDS ?? "1337").split(",").map((x) => Number(x));

describe("VP-01 the race to ten", () => {
  const races = SEEDS.map((seed) => runRace(seed, { minutes: RACE_MINUTES }));

  it("prints the pace for the playtest report", () => {
    for (const r of races) {
      console.log(`seed ${r.seed} (${RACE_MINUTES}m window)`, JSON.stringify(r.seats.map((s) => ({
        seat: s.id,
        firstPoint: s.firstPoint === null ? "—" : MIN(s.firstPoint),
        firstPave: s.firstPave === null ? "—" : MIN(s.firstPave),
        paves: s.paves,
        oreOnPaves: s.oreOnPaves,
        offers: `+${s.offersPosted}/${s.offersTaken}`,
        vp: r.vp[s.id],
        // the tail of the state that explains a stall, printed rather than
        // asserted: a seat stops scoring for a reason, and it is nearly always
        // here (no ore, and no paveable gravel left to bank toward)
        gravel: countTier(r.eco.track, "dirt", s.ownerId),
        tarmac: countTier(r.eco.track, "road", s.ownerId),
        depots: r.eco.harvesters.filter((h) => h.owner === s.id).length,
        plants: plantsOf(r.eco, s.id).length,
        purse: Object.fromEntries(
          Object.entries(s.purse).filter(([k, v]) => k !== "gold" && (v as number) > 0),
        ),
      }))));
      console.log("  winner:", r.winner
        ? `${r.winner.id} at ${MIN(r.winner.at)} (${r.vp[r.winner.id]}★)`
        : `none inside ${RACE_MINUTES}m — leader ${r.vp.you >= r.vp.ai ? "you" : "ai"} at ${Math.max(r.vp.you, r.vp.ai)}★`);
      console.table(r.trace.map((p) => ({ minute: Math.round(p.t / 60_000), you: p.you, ai: p.ai })));
    }
    expect(races.length).toBe(SEEDS.length);
  }, 900_000);

  it("both seats score off paving, inside the opening", () => {
    for (const r of races) {
      for (const seat of r.seats) {
        expect(seat.firstPoint, `seed ${r.seed}/${seat.id} never scored`).not.toBeNull();
        // Three build turns of a rival's opening — two free dirt legs and the
        // bank converting wood into the first Ore — must be enough to put a
        // point on the board. A seat that cannot do that is a seat whose
        // planner is not playing the victory condition at all.
        expect(seat.firstPoint!, `seed ${r.seed}/${seat.id} first scored at ${MIN(seat.firstPoint!)}`)
          .toBeLessThanOrEqual(3 * 60_000);
        // …and it PAVED, which is the half of the plan the old AI never had.
        expect(seat.firstPave, `seed ${r.seed}/${seat.id} never paved a tile`).not.toBeNull();
        expect(seat.firstPave!).toBeLessThanOrEqual(5 * 60_000);
        expect(seat.oreOnPaves).toBeGreaterThan(0);
      }
    }
  }, 900_000);

  it("the total is always exactly what the board says it is", () => {
    for (const r of races) {
      for (const seat of r.seats) {
        const bd = victoryBreakdown(r.eco, seat.id);
        const onBoard = pavedCount(r.eco.track, seat.ownerId);
        expect(bd.paved, `seed ${r.seed}/${seat.id}: score ${bd.paved}, map ${onBoard}`).toBe(onBoard);
        // the free opening Factory is plant #0 and earns nothing, ever
        expect(bd.plants).toBe(Math.max(0, plantsOf(r.eco, seat.id).length - 1));
        expect(bd.pavedVp).toBe(bd.paved * VICTORY.upgrade);
        expect(bd.plantVp).toBe(bd.plants * VICTORY.plant);
        expect(bd.pavedVp + bd.plantVp).toBeCloseTo(r.vp[seat.id], 6);
        // the seat's own count of laid paves matches the scoreboard it earned
        expect(bd.paved).toBe(seat.paves);
      }
    }
  }, 900_000);

  it("the scoreboard never moves backwards while nothing is demolished", () => {
    // The one invariant a diff-based scorer can quietly break: if `rescore` ever
    // lost a ledger entry, a long game would drift. Nothing in this sim tears
    // anything up, so each seat's VP must be monotonically non-decreasing.
    for (const r of races) {
      for (const key of ["you", "ai"] as const) {
        for (let i = 1; i < r.trace.length; i++) {
          expect(r.trace[i][key], `seed ${r.seed} minute ${i}: ${key} lost points`)
            .toBeGreaterThanOrEqual(r.trace[i - 1][key]);
        }
      }
    }
  }, 900_000);

  it("a game ends: someone reaches 10★, and the other seat was racing", () => {
    for (const r of races) {
      const trailer = Math.min(r.vp.you, r.vp.ai);
      expect(r.winner, `seed ${r.seed}: no seat reached ${VP_TARGET}★ in ${RACE_MINUTES} minutes`).toBeTruthy();
      expect(r.winner!.at).toBeLessThanOrEqual(RACE_MINUTES * 60_000);
      const win = r.vp[r.winner!.id];
      // The check runs once a turn, after the whole turn's scoring has landed,
      // so a seat can cross the line by more than one point's worth in a single
      // turn — eight paves AND a plant (seed 2024 finished at 10.25★). That is
      // the design: the banner prints the true total, and what must not happen
      // is the win check LAGGING, i.e. a seat sitting on 13★ because the gate
      // was only consulted at the top of a turn. So the overshoot is bounded by
      // one turn's maximum, which is exactly what `applyVpEvents` can aggregate.
      expect(win).toBeGreaterThanOrEqual(VP_TARGET);
      expect(win).toBeLessThan(VP_TARGET + 12 * VICTORY.upgrade + VICTORY.plant);
      expect(trailer, `seed ${r.seed}: the loser never scored at all`).toBeGreaterThan(0);
      // and the loser got a real game in: at least a quarter of the target, so
      // "the AI can play the new condition" is not a one-seat accident
      expect(trailer).toBeGreaterThanOrEqual(VP_TARGET / 4);
    }
  }, 900_000);

  it("nobody wins it by pottering: the pace is monotone and the paving carries", () => {
    for (const r of races) {
      // What "pottering" means here, in the order of how much it hurts:
      // (1) no seat's score may go DOWN (nothing in the race demolishes), and
      // (2) the seat that WON must still have been gaining in the second half —
      //     a game decided by an early lead nobody defended is a stall with a
      //     trophy at the end. A LOSER plateauing is not asserted: Ore is the
      //     only cargo that scores, and a seat whose gravel ends up under rough
      //     ground (paved Roads cannot cross rock) has no legal point left to
      //     make, whatever its purse. seed 2024's rival finished 6.5★ that way —
      //     27 owned gravel tiles, not one paveable — and the terrain, not the
      //     AI, is why. The stall this harness exists to catch is the 0★-forever
      //     one, and "both seats score off paving, inside the opening" owns it.
      for (const seat of r.seats) {
        const key = seat.id as "you" | "ai";
        expect(pacePerMinute(r, key), `seed ${r.seed}: ${key} lost points mid-race`)
          .toBeGreaterThanOrEqual(0);
      }
      if (r.winner) {
        const wk = r.winner.id as "you" | "ai";
        expect(pacePerMinute(r, wk), `seed ${r.seed}: the winner stopped scoring before it won`)
          .toBeGreaterThan(0);
      }
      // more paving than plants in every seat's score, which is the behaviour
      // the ticket asked the AI to have
      for (const seat of r.seats) {
        const bd = victoryBreakdown(r.eco, seat.id);
        expect(bd.pavedVp + bd.plantVp).toBeCloseTo(r.vp[seat.id], 6);
        expect(bd.paved).toBeGreaterThan(bd.plants);
        expect(seat.oreOnPaves).toBe(bd.paved * (4));      // 4 Ore a tile, always
      }
    }
  }, 900_000);
});
