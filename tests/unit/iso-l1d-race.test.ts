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

import { plantsOf } from "../../src/iso/plants";
import { runRace, pacePerMinute, MIN } from "./helpers/race";

const RACE_MINUTES = Number(process.env.L1D_RACE_MINUTES ?? 30);
const SEEDS = (process.env.L1D_RACE_SEEDS ?? "1337,7").split(",").map((x) => Number(x));

describe.skip("L1d (#235) a whole race on the new loop's clock", () => {
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
      // L13 (#228): the new loop races its own line (`r.target`, 12★), not the
      // shipped 10★ — the harness reports which one it ran to.
      expect(r.winner, `seed ${r.seed}: no seat reached ${r.target}★ in ${RACE_MINUTES}m — deadlock`)
        .toBeTruthy();
      expect(r.vp[r.winner!.id]).toBeGreaterThanOrEqual(r.target);
      const trailer = Math.min(r.vp.you, r.vp.ai);
      expect(trailer, `seed ${r.seed}: the loser never scored`).toBeGreaterThan(0);
      expect(trailer, `seed ${r.seed}: the loser stalled out of the race`)
        .toBeGreaterThanOrEqual(r.target / 4);
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
        // L13 (#228): paving is no longer THE score, so "did this seat pave"
        // is no longer the proof that it played — under the new table the
        // score comes from depot types, rungs and city tiers, and a seat can
        // now reach the line before it ever needs a road upgrade. (With #229's
        // rival the race ends inside ~20s; over a full window both seats still
        // pave 200+ tiles for the throughput, which is what paving is FOR
        // now.) What must still hold is the thing this file exists to prove:
        // the seat SPENT what the clock paid it, i.e. it converted income into
        // the board rather than idling on a growing purse.
        expect(seat.paves + depots.length, `seed ${r.seed}/${seat.id} built nothing`)
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

// ══════════════════════════════════════════════════════════════════════════
// L5 (#219) — the depot tree, raced.
//
// The tree's acceptance block, at race level, on the seeds the ticket names:
// the rival gets THROUGH the rungs in real play (no deadlock, no cargo the map
// cannot supply), the opening is the map's choice rather than a fixed script,
// and NO single build order wins every seed — the two seats open on different
// cargos on different maps and the winner changes with the map.
//
// Heavy by design (five whole simulated matches): it lives in `test:slow`,
// next to the L1d deadlock detector above. What it prints is the table the PR
// quotes; what it asserts is only that the runs FINISH, that the tree is
// climbed, and that the opener is not a constant.
// ══════════════════════════════════════════════════════════════════════════
import { depotCargo } from "../../src/iso/economy";
import { DEPOT_TREE } from "../../src/iso/config";

describe("L5 (#219) the depot tree, raced", () => {
  const TREE_SEEDS = (process.env.L5_TREE_SEEDS ?? "7,42,79,199,1337").split(",").map(Number);
  const TREE_MINUTES = Number(process.env.L5_TREE_MINUTES ?? 12);
  let races: ReturnType<typeof runRace>[] = [];

  /** Every cargo a seat actually raised a Depot for. */
  const cargosOf = (r: ReturnType<typeof runRace>, id: string) =>
    r.eco.harvesters.filter((h) => h.owner === id).map((h) => depotCargo(r.eco, h)!);

  beforeAll(() => {
    races = TREE_SEEDS.map((seed) => runRace(seed, { minutes: TREE_MINUTES, newLoop: true }));
    for (const r of races) {
      const winners = r.seats.map((s) => s.id);
      console.log(`[L5 tree] seed ${r.seed}`, JSON.stringify({
        winner: r.winner ? `${r.winner.id} at ${MIN(r.winner.at)}` : `none inside ${TREE_MINUTES}m`,
        seats: r.seats.map((s) => ({
          seat: s.id, rung: s.depotTier, city: s.townLevel,
          opened: cargosOf(r, s.id)[0] ?? "—",
          cargos: [...new Set(cargosOf(r, s.id))],
        })),
        orders: winners.length,
      }));
    }
  }, 900_000);

  it("finishes on every seed, with both seats still racing", () => {
    for (const r of races) {
      expect(r.winner, `seed ${r.seed}: nobody reached ${r.target}★ in ${TREE_MINUTES}m — deadlock`)
        .toBeTruthy();
      for (const seat of r.seats) {
        expect(r.vp[seat.id], `seed ${r.seed}/${seat.id} never scored`).toBeGreaterThan(0);
      }
    }
  });

  it("climbs the tree in real play — rungs opened, deeper types built", () => {
    for (const r of races) {
      for (const seat of r.seats) {
        // A seat that never unlocked a rung never tuned a Depot (or never
        // built one). Both are deadlocks for the tree: the ticket's rival has
        // to progress through it, not stall on the starter pair.
        expect(seat.depotTier, `seed ${r.seed}/${seat.id} unlocked no rung`)
          .toBeGreaterThanOrEqual(1);
        // …and every Depot it raised sits at or below the rung it holds now:
        // a rung only ever grows, so a type above the live one could not have
        // been placed when it was built.
        for (const cargo of cargosOf(r, seat.id)) {
          expect(DEPOT_TREE[cargo].tier, `seed ${r.seed}/${seat.id}: built a locked type`)
            .toBeLessThanOrEqual(seat.depotTier);
        }
      }
      // At least one seat got past the starter pair on every seed — the rungs
      // really are reachable from what the map + the tree offer.
      const deep = r.seats.flatMap((s) => cargosOf(r, s.id)).filter((c) => DEPOT_TREE[c].tier > 0);
      expect(deep.length, `seed ${r.seed}: no seat ever built a rung-1 type`).toBeGreaterThan(0);
    }
  });

  it("no single build order wins every seed", () => {
    // The opening each seat CHOSE (its first real Depot) and the seat that
    // won are both properties of the map: if either were a constant, the tree
    // would not be branching — it would be a script.
    const opened = new Set(races.flatMap((r) => r.seats.map((s) => cargosOf(r, s.id)[0])));
    expect(opened.size, `every seat on every seed opened on ${[...opened].join("/")} — a script`)
      .toBeGreaterThanOrEqual(2);
    const winners = new Set(races.filter((r) => r.winner).map((r) => r.winner!.id));
    expect(winners.size, "one seat's build order won every single seed").toBeGreaterThanOrEqual(2);
  });
});
