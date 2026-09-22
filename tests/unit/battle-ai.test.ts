// ══════════════════════════════════════════════════════════════════════════
// B4 (#249) — the rival battle policy: legality, determinism, nerve.
//
// The acceptance ladder (Easy loses most / Hard wins most vs the greedy
// bot) lives in battle-ai-sim.test.ts. This file pins the contract:
//
//   • every move the policy returns is one the engine carries;
//   • (seed, skill) fully determines the move stream — never Math.random,
//     never the battle's own RNG;
//   • Hard takes the greedy line far more often than Easy wanders off it;
//   • a lethal Dynamite is taken by every skill — nobody walks past a win.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { createBattle, type Battle, type BattleSeat } from "../../src/game/battle";
import { chooseBattleMove, greedyBattleMove, type RivalMove } from "../../src/iso/battle-ai";
import { BATTLE_RULES, type Cargo } from "../../src/iso/config";

const ALL: Cargo[] = ["grain", "wood", "ore", "stone", "oil", "gold"];

const fresh = (seed: number): Battle =>
  createBattle({
    seed,
    players: [
      { id: "a", name: "A", depots: ALL },
      { id: "b", name: "B", depots: ALL },
    ],
    rules: BATTLE_RULES,
  });

const playOut = (b: Battle, mv: RivalMove) =>
  mv.t === "ability" ? b.useAbility(mv.id) : b.playSwap(mv.r1, mv.c1, mv.r2, mv.c2, 0);

describe("B4 chooseBattleMove", () => {
  it("returns only moves the engine carries (three seeds, swaps and spells)", async () => {
    for (const seed of [3, 11, 19]) {
      const b = fresh(seed);
      for (let i = 0; i < 8 && !b.state.over; i++) {
        // fund the bill a little each turn so spells have a chance to fire
        for (const seat of [0, 1] as BattleSeat[]) {
          const me = b.state.players[seat];
          for (const c of Object.keys(me.mana) as Cargo[]) {
            me.mana[c] = Math.min(BATTLE_RULES.manaCap, me.mana[c] + 3);
          }
        }
        const mv = await chooseBattleMove(b, "hard");
        if (!mv) {
          await b.ensureMove();
          continue;
        }
        const out = await playOut(b, mv);
        expect(out.ok, `seed ${seed} move ${i} must land`).toBe(true);
      }
    }
  });

  it("is deterministic in (seed, skill): twin battles play identical streams", async () => {
    const run = async (seed: number) => {
      const b = fresh(seed);
      const log: string[] = [];
      for (let i = 0; i < 10 && !b.state.over; i++) {
        const mv = await chooseBattleMove(b, "normal");
        if (!mv) { await b.ensureMove(); continue; }
        log.push(mv.t === "ability" ? `A:${mv.id}` : `S:${mv.r1},${mv.c1},${mv.r2},${mv.c2}`);
        await playOut(b, mv);
      }
      return { log, snap: JSON.stringify(b.save()) };
    };
    const a = await run(23);
    const c = await run(23);
    expect(c.log).toEqual(a.log);
    expect(c.snap).toBe(a.snap);
  });

  it("Easy walks greedy's line; Hard looks past it (depth re-grades)", async () => {
    // The two properties the ladder rests on: Easy has GREEDY'S EYE with a
    // wandering nerve (so it agrees with the shallow line often), while
    // Hard's shadow plies re-grade the top lines and step off that line.
    let hardAgree = 0, easyAgree = 0, n = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const g = fresh(seed * 7 + 1);
      const greedy = greedyBattleMove(g);
      if (!greedy) continue;
      n++;
      const hard = await chooseBattleMove(g, "hard");
      const easy = await chooseBattleMove(fresh(seed * 7 + 1), "easy");
      const same = (mv: RivalMove | null) => !!mv && mv.t === "swap" && greedy.t === "swap"
        && mv.r1 === greedy.r1 && mv.c1 === greedy.c1
        && mv.r2 === greedy.r2 && mv.c2 === greedy.c2;
      if (same(hard)) hardAgree++;
      if (same(easy)) easyAgree++;
    }
    expect(n).toBeGreaterThan(10);
    // Easy keeps the greedy eye (its best-line rate is pBest ≈ 0.55)
    expect(easyAgree / n).toBeGreaterThan(0.35);
    // …and Hard's depth steps off the shallow line more often than that
    expect(hardAgree / n).toBeLessThan(easyAgree / n);
  });

  it("every skill takes a lethal Dynamite — nobody walks past a win", async () => {
    for (const skill of ["easy", "normal", "hard"] as const) {
      for (let seed = 31; seed <= 36; seed++) {
        const b = fresh(seed);
        // seat 1 sits one hit from death; the bill for Dynamite is funded
        b.state.players[1].health = 3;
        b.state.players[0].mana.ore = 2;
        b.state.players[0].mana.oil = 2;
        const mv = await chooseBattleMove(b, skill);
        expect(mv, `seed ${seed} as ${skill}`).toEqual({ t: "ability", id: "dynamite", seat: 0 });
      }
    }
  });

  it("greedyBattleMove is deterministic and always answers on a live board", () => {
    const a = greedyBattleMove(fresh(41));
    const b = greedyBattleMove(fresh(41));
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
  });
});
