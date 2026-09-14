// ══════════════════════════════════════════════════════════════════════════
// RAIL-05 (#182) — the railway balance matrix, measured.
//
// Two AI seats race through the VP-01/AI-01 simulator (`helpers/race.ts`),
// one seat playing a railway strategy and the other the road-only game, in
// BOTH chairs, on every seed. Every rail action is the live rival's own
// `planRailMove` → `executeRailMove`, so the numbers describe the shipped
// rules and prices, not a model of them.
//
// Gated: a full matrix is minutes of wall clock, so it only runs on demand and
// writes one JSON line per race. docs/railway-balance.md is built from it:
//
//   RAIL_BALANCE=1 RAIL_BALANCE_SEEDS=7 RAIL_BALANCE_OUT=out-7.jsonl \
//     npx vitest run tests/unit/iso-rail-balance.test.ts
//
// Knobs: RAIL_BALANCE_SEEDS (default 7,42,79,199,1337), RAIL_BALANCE_SKILL
// (normal), RAIL_BALANCE_STRATS (mixed,exclusive,railFirst,platforms),
// RAIL_BALANCE_MINUTES (24, the VP-01 horizon).
// ══════════════════════════════════════════════════════════════════════════
import { describe, it } from "vitest";
import { appendFileSync } from "node:fs";
import { runRace, type RailStrategy } from "./helpers/race";
import { victoryBreakdown } from "../../src/iso/victory";
import type { SkillKey } from "../../src/iso/skill";

const ON = process.env.RAIL_BALANCE === "1";
const SEEDS = (process.env.RAIL_BALANCE_SEEDS ?? "7,42,79,199,1337").split(",").map(Number);
const SKILL = (process.env.RAIL_BALANCE_SKILL ?? "normal") as SkillKey;
const STRATS = (process.env.RAIL_BALANCE_STRATS ?? "mixed,exclusive,railFirst,platforms")
  .split(",") as RailStrategy[];
const MINUTES = Number(process.env.RAIL_BALANCE_MINUTES ?? 24);
const OUT = process.env.RAIL_BALANCE_OUT;

describe.skipIf(!ON)("RAIL-05 railway balance matrix", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}`, () => {
      const pairs: [RailStrategy, RailStrategy][] = [["road", "road"]];
      for (const strat of STRATS) pairs.push([strat, "road"], ["road", strat]);
      for (const pair of pairs) {
        const started = Date.now();
        const r = runRace(seed, { minutes: MINUTES, skills: [SKILL, SKILL], rail: pair });
        const platforms = r.rail.structures
          .filter((s) => s.kind === "platform")
          .map((s) => ({ id: s.id, ownerId: s.ownerId, owner: s.owner, tx: s.tx, ty: s.ty }));
        const row = {
          seed, skill: SKILL, you: pair[0], ai: pair[1],
          winner: r.winner?.id ?? null, winAt: r.winner?.at ?? null,
          wallMs: Date.now() - started,
          seats: r.seats.map((s) => {
            const b = victoryBreakdown(r.eco, s.id, platforms);
            return {
              id: s.id, strategy: s.rail, vp: r.vp[s.id],
              pavedVp: b.pavedVp, plantVp: b.plantVp, platformVp: b.platformVp,
              firstPoint: s.firstPoint, firstTrain: s.firstTrain,
              railActions: s.railActions, railSpent: s.railSpent, paves: s.paves,
              milestones: s.milestones,
              trains: r.rail.trains.filter((t) => t.ownerId === s.ownerId).map((t) => t.status),
            };
          }),
        };
        const line = JSON.stringify(row);
        console.log(line);
        if (OUT) appendFileSync(OUT, line + "\n");
      }
    }, 60 * 60_000);
  }
});
