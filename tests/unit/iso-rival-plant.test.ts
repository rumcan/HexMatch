// ══════════════════════════════════════════════════════════════════════════
// A1, as L10 (#225) left it — the rival's Processing Plant.
//
// The Black Market bug this file was written around is fixed twice over:
// Frost Tiles, Iron Girders and Smog Cloud first stopped firing into
// `quarry.board` (the buyer's OWN board) by landing on the rival's plant
// instead, and then #225 retired the cards altogether. Board obstacles are a
// difficulty's now — placed when a tuning session opens, gone when it closes —
// so there is nothing left to buy, nothing to expire and no damage model:
// the rival's income is never scaled by how wrecked a plant LOOKS.
//
// What is left here:
//
//   • the plant is a BOARD — AI-03 plays it, the peek panel paints it, and
//     nothing about it is a clock;
//   • the obstacle count it reports is the board's own, so a plant with
//     nothing on it reads clean and two plants never share gems;
//   • and the rival's yield is the SIMULATED SESSION (L4), docked once by the
//     obstacles that difficulty would have put on the board — the damage
//     model's replacement, and the only thing that still costs the rival
//     anything for playing on a harder difficulty.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach } from "vitest";
import { createRivalPlant } from "../../src/iso/rival-plant";
import {
  DIFFICULTY_RULES, OBSTACLE_RAMP, type DifficultyRules, type ObstacleRules,
} from "../../src/iso/config";
import {
  obstacleDrag, rivalTuningGold, rivalTuningYield, sessionObstacles,
} from "../../src/iso/tuning";
import { BOARD_W, BOARD_H, setRng, mulberry32 } from "../../src/game/config";
import { SKILL_KEYS } from "../../src/iso/skill";

const CELLS = BOARD_W * BOARD_H;

beforeEach(() => setRng(mulberry32(1234)));

describe("A1 the rival's plant", () => {
  it("is a board of its own — two plants never share gems", () => {
    const a = createRivalPlant();
    const b = createRivalPlant();
    // Separate boards, separate GEM OBJECTS: mint ids restart at 1 per board,
    // so identity is what proves one plant's gems are not the other's.
    expect(b.board.gems()).not.toContain(a.board.gems()[0]);
    a.board.seedObstacles(4, 2, 2);
    expect(a.status()).toEqual({ frozen: 4, girders: 2 });
    expect(b.status(), "the other plant is untouched").toEqual({ frozen: 0, girders: 0 });
  });

  it("starts clean — nothing can put an obstacle on it outside a session", () => {
    const p = createRivalPlant();
    expect(p.status()).toEqual({ frozen: 0, girders: 0 });
    expect(p.board.gems().some((g) => g.hard > 0 || g.block)).toBe(false);
    // The whole sabotage surface is gone with the cards that fed it: no way to
    // freeze it, no girders to drop, no smog, no health to scale an income by,
    // and no clock to tick.
    for (const dead of ["frost", "girders", "smog", "health", "tick"]) {
      expect((p as unknown as Record<string, unknown>)[dead], `${dead}() is still here`).toBeUndefined();
    }
  });

  it("carries no timestamps — an obstacle has no clock to expire on", () => {
    const b = createRivalPlant().board;
    const saved = JSON.stringify(b.save());
    expect(saved).not.toMatch(/fog|blockIn|smog/i);
    expect(Object.keys(b.save() as Record<string, unknown>).sort())
      .toEqual(["comboCount", "grid", "pool", "seq"]);
  });
});

describe("L10 the rival's simulated session is docked by the obstacles", () => {
  it("costs the rival more on a board with obstacles than on a clean one", () => {
    for (const key of SKILL_KEYS) {
      // Easy has no obstacles, so its rival's number is L4's, unchanged —
      // "the rival is not made better for the player choosing easy" (L6).
      expect(rivalTuningYield(key, 0, DIFFICULTY_RULES.easy))
        .toBe(rivalTuningYield(key));
      // Normal (frost) and Hard (frost + girders) both cost it something, and
      // Hard costs more than Normal.
      const normal = rivalTuningYield(key, 0, DIFFICULTY_RULES.normal);
      const hard = rivalTuningYield(key, 0, DIFFICULTY_RULES.hard);
      expect(normal).toBeLessThan(rivalTuningYield(key));
      expect(hard).toBeLessThan(normal);
      // …and it still plays: the dock never takes it below the baseline.
      expect(hard).toBeGreaterThanOrEqual(1);
    }
  });

  it("docks the Gold the same way — both halves of one simulated session", () => {
    const raw = rivalTuningGold("hard");
    const docked = rivalTuningGold("hard", 0, DIFFICULTY_RULES.hard);
    expect(docked).toBeLessThanOrEqual(raw);
    expect(docked).toBeGreaterThan(0);
  });

  it("is a drag on the SCORE, measured on the board the player plays", () => {
    // The counts are the ones the table hands a session, ramped by tier.
    const full = sessionObstacles(DIFFICULTY_RULES.hard, 1);
    const first = sessionObstacles(DIFFICULTY_RULES.hard, 0);
    expect(full.girders).toBeGreaterThan(first.girders);
    expect(first.frost).toBe(Math.floor(full.frost * OBSTACLE_RAMP.firstTier));
    // A girder is worth two frosted gems: it takes its cell out of the board
    // entirely, where ice is one match away from being an ordinary gem.
    expect(obstacleDrag({ frost: 0, girders: 1, frostHard: 1 }))
      .toBeCloseTo(2 * obstacleDrag({ frost: 1, girders: 0, frostHard: 1 }), 6);
    // …and the whole board iced over still leaves the rival half a session —
    // a difficulty makes the board harder to read, not unplayable.
    expect(obstacleDrag({ frost: CELLS, girders: CELLS, frostHard: 2 })).toBeLessThanOrEqual(0.5);
    expect(obstacleDrag({ frost: 0, girders: 0, frostHard: 1 })).toBe(0);
  });

  it("never docks a difficulty that puts nothing on the board", () => {
    const rules: DifficultyRules = { ...DIFFICULTY_RULES.normal, obstacles: { frost: 0, girders: 0, frostHard: 1 } };
    const empty: ObstacleRules = { frost: 0, girders: 0, frostHard: 1 };
    expect(sessionObstacles(rules, 1)).toEqual(empty);
    expect(rivalTuningYield("normal", 0, rules)).toBe(rivalTuningYield("normal"));
  });
});
