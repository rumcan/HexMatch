// ══════════════════════════════════════════════════════════════════════════
// B3 (#248) — battle abilities: cost, effect and cooldown, one test each.
//
// The acceptance block:
//   • each ability has a unit test for cost, effect and cooldown;
//   • (screen half, in battle-screen.test.ts) locked abilities show why;
//   • an ability used in a replayed move list reproduces the same battle.
//
// Engine-only here (no DOM). Mana is credited straight onto the player
// object — the board fixtures stand in for "matches that happened", exactly
// like the B1 suites. `useAbility` always casts for the CURRENT player, so
// the choreography minds whose turn it is.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { createBattle, type Battle, type BattleSeat } from "../../src/game/battle";
import {
  BATTLE_ABILITIES, BATTLE_ABILITY_ORDER, BATTLE_RULES, type Cargo,
} from "../../src/iso/config";

const ALL_DEPOTS: Cargo[] = ["grain", "wood", "ore", "stone", "oil", "gold"];

function freshBattle(
  seed = 3,
  depots: [Cargo[], Cargo[]] = [ALL_DEPOTS, ALL_DEPOTS],
): Battle {
  return createBattle({
    seed,
    players: [
      { id: "you", name: "You", depots: depots[0] },
      { id: "rival", name: "Vex", depots: depots[1] },
    ],
    rules: BATTLE_RULES,
  });
}

function giveMana(b: Battle, seat: BattleSeat, m: Partial<Record<Cargo, number>>): void {
  for (const [k, v] of Object.entries(m) as [Cargo, number][]) {
    b.state.players[seat].mana[k] = v;
  }
}

function fillMana(b: Battle, seat: BattleSeat): void {
  for (const c of Object.keys(b.state.players[seat].mana) as Cargo[]) {
    b.state.players[seat].mana[c] = BATTLE_RULES.manaCap;
  }
}

/** Paint the B1 three-in-a-row fixture: wood at (0,0)(0,1)(1,2), swap
 *  (1,2)↔(0,2) makes the run. Checkerboard base, no standing matches. */
function paintFixture(b: Battle): void {
  for (const g of b.board.gems()) g.res = (g.r + g.c) % 2 ? "ore" : "wheat";
  b.board.grid[0][0]!.res = "wood";
  b.board.grid[0][1]!.res = "wood";
  b.board.grid[1][2]!.res = "wood";
}

const FIXTURE_SWAP: [number, number, number, number] = [1, 2, 0, 2];

describe("B3 battle abilities — cost, effect, cooldown", () => {
  it("Iron Girders: pays stone+ore, drops 3 girders, cooldown 3, costs the turn", async () => {
    const b = freshBattle();
    giveMana(b, 0, { stone: 3, ore: 3 });
    const out = await b.useAbility("girders");
    expect(out.ok).toBe(true);
    // cost
    expect(out.spent).toEqual({ stone: 3, ore: 3 });
    expect(b.state.players[0].mana.stone).toBe(0);
    expect(b.state.players[0].mana.ore).toBe(0);
    // effect
    expect(out.girders).toBe(3);
    expect(b.board.obstacleCounts().girders).toBe(3);
    // cooldown + turn
    expect(b.state.cooldowns[0].girders).toBe(3);
    const again = b.canUse("girders", 0);
    expect(again.ok).toBe(false);
    expect(again.ok === false && again.reason).toBe("cooldown");
    expect(out.costsTurn).toBe(true);
    expect(b.state.turn).toBe(1);
  });

  it("Frost: pays grain+wood, freezes 4 gems at hardness 2, cooldown 3, costs the turn", async () => {
    const b = freshBattle();
    giveMana(b, 0, { grain: 3, wood: 3 });
    const out = await b.useAbility("frost");
    expect(out.ok).toBe(true);
    expect(out.spent).toEqual({ grain: 3, wood: 3 });
    expect(b.state.players[0].mana.grain).toBe(0);
    expect(b.state.players[0].mana.wood).toBe(0);
    expect(out.frozen).toBe(4);
    const counts = b.board.obstacleCounts();
    expect(counts.frost).toBe(4);
    expect(counts.frostHard).toBe(2);
    expect(b.state.cooldowns[0].frost).toBe(3);
    expect(out.costsTurn).toBe(true);
    expect(b.state.turn).toBe(1);
  });

  it("Smog: pays oil, the opponent's next match banks half mana (once), cooldown 2", async () => {
    const b = freshBattle(2);
    giveMana(b, 0, { oil: 4 });
    const out = await b.useAbility("smog");
    expect(out.ok).toBe(true);
    expect(out.spent).toEqual({ oil: 4 });
    expect(b.state.players[0].mana.oil).toBe(0);
    expect(out.smog).toBe(1);
    expect(b.state.smog[1]).toBe(1);
    expect(b.state.cooldowns[0].smog).toBe(2);
    expect(out.costsTurn).toBe(true);
    expect(b.state.turn).toBe(1);

    // the opponent's next match: the fixture banks 3 wood raw → 1 halved
    paintFixture(b);
    const oppTurn = await b.playSwap(...FIXTURE_SWAP, 0);
    expect(oppTurn.ok).toBe(true);
    expect(oppTurn.smogged).toBe(true);
    expect(oppTurn.mana.wood ?? 0).toBe(1);
    expect(b.state.smog[1]).toBe(0);

    // …and only that one: the next match banks full mana again
    paintFixture(b);
    const clear = await b.playSwap(...FIXTURE_SWAP, 0);
    expect(clear.ok).toBe(true);
    expect(clear.smogged).toBe(false);
    expect(clear.mana.wood ?? 0).toBe(3);
  });

  it("Dynamite: pays ore+oil, deals 4 direct damage (a kill wins), cooldown 2", async () => {
    const b = freshBattle();
    giveMana(b, 0, { ore: 2, oil: 2 });
    const out = await b.useAbility("dynamite");
    expect(out.ok).toBe(true);
    expect(out.spent).toEqual({ ore: 2, oil: 2 });
    expect(out.damage).toBe(4);
    expect(b.state.players[1].health).toBe(BATTLE_RULES.startHealth - 4);
    expect(b.state.cooldowns[0].dynamite).toBe(2);
    expect(out.costsTurn).toBe(true);
    expect(b.state.turn).toBe(1);

    // a lethal cast ends it (now it is seat 1's turn)
    giveMana(b, 1, { ore: 2, oil: 2 });
    b.state.players[0].health = 3;
    const kill = await b.useAbility("dynamite");
    expect(kill.ok).toBe(true);
    expect(kill.winner).toBe(1);
    expect(b.state.over).toBe(true);
  });

  it("Repair Crew: pays wood+stone, heals 6 up to the cap, cooldown 3", async () => {
    const b = freshBattle();
    giveMana(b, 0, { wood: 2, stone: 2 });
    b.state.players[0].health = 10;
    const out = await b.useAbility("repair");
    expect(out.ok).toBe(true);
    expect(out.spent).toEqual({ wood: 2, stone: 2 });
    expect(out.heal).toBe(6);
    expect(b.state.players[0].health).toBe(16);
    expect(b.state.cooldowns[0].repair).toBe(3);
    expect(out.costsTurn).toBe(true);
    expect(b.state.turn).toBe(1);

    // capped at startHealth (seat 1 casts now)
    giveMana(b, 1, { wood: 2, stone: 2 });
    b.state.players[1].health = BATTLE_RULES.startHealth - 2;
    const topUp = await b.useAbility("repair");
    expect(topUp.ok).toBe(true);
    expect(topUp.heal).toBe(2);
    expect(b.state.players[1].health).toBe(BATTLE_RULES.startHealth);
  });

  it("Gold Bribe: pays gold, steals 2 mana of each cargo — and the table says it is FREE", async () => {
    const b = freshBattle();
    giveMana(b, 0, { gold: 3 });
    giveMana(b, 1, { oil: 5, gold: 5, grain: 1 });
    const out = await b.useAbility("bribe");
    expect(out.ok).toBe(true);
    expect(out.spent).toEqual({ gold: 3 });
    expect(out.stolen).toEqual({ grain: 1, oil: 2, gold: 2 });
    expect(b.state.players[0].mana.grain).toBe(1);
    expect(b.state.players[0].mana.oil).toBe(2);
    expect(b.state.players[0].mana.gold).toBe(2); // 3 − 3 + 2
    expect(b.state.players[1].mana.oil).toBe(3);
    expect(b.state.players[1].mana.gold).toBe(3);
    expect(b.state.players[1].mana.grain).toBe(0);
    expect(b.state.cooldowns[0].bribe).toBe(2);
    // THE TABLE SAYS OTHERWISE: the caster still holds the turn
    expect(out.costsTurn).toBe(false);
    expect(b.state.turn).toBe(0);
  });

  it("cooldowns tick at each of the caster's turns and clear on schedule", async () => {
    const b = freshBattle();
    fillMana(b, 0); fillMana(b, 1);

    // T0: seat 0 casts smog (cooldown 2); the turn passes
    await b.useAbility("smog");
    expect(b.state.cooldowns[0].smog).toBe(2);
    let check = b.canUse("smog", 0);
    expect(check.ok === false && check.reason).toBe("cooldown");
    expect(check.ok === false && check.readyIn).toBe(2);

    // seat 1 casts dynamite → seat 0's turn starts: smog ticks 2 → 1
    await b.useAbility("dynamite");
    expect(b.state.turn).toBe(0);
    expect(b.state.cooldowns[0].smog).toBe(1);
    check = b.canUse("smog", 0);
    expect(check.ok === false && check.reason).toBe("cooldown");

    // seat 0 passes with frost; seat 1 passes it back with girders
    await b.useAbility("frost");
    await b.useAbility("girders");
    expect(b.state.turn).toBe(0);
    // seat 0's turn started again: smog ticks 1 → 0 — ready
    expect(b.state.cooldowns[0].smog).toBe(0);
    expect(b.canUse("smog", 0).ok).toBe(true);
  });

  it("the map gate locks an ability and cannot be argued with mana", async () => {
    const b = freshBattle(3, [["grain"], ["gold"]]);
    fillMana(b, 0); // mana must NOT be the blocker here
    const smog = b.canUse("smog", 0); // needs an Oil depot
    expect(smog.ok).toBe(false);
    expect(smog.ok === false && smog.reason).toBe("owner");
    const cast = await b.useAbility("smog");
    expect(cast.ok).toBe(false);
    expect(cast.reason).toBe("owner");

    // seat 1 holds gold only: bribe is open for them, girders is not
    fillMana(b, 1);
    expect(b.canUse("bribe", 1).ok).toBe(true);
    const girders = b.canUse("girders", 1); // needs a Stone depot
    expect(girders.ok === false && girders.reason).toBe("owner");
  });

  it("a bare purse refuses the bill and says what is missing", () => {
    const b = freshBattle();
    const check = b.canUse("girders", 0); // costs stone 3 + ore 3
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toBe("mana");
    expect(check.ok === false && check.need).toEqual({ stone: 3, ore: 3 });
  });

  it("a cast-stall still hits the turn limit and equal health draws", async () => {
    const b = createBattle({
      seed: 11,
      players: [
        { id: "you", name: "You", depots: ALL_DEPOTS },
        { id: "rival", name: "Vex", depots: ALL_DEPOTS },
      ],
      rules: { ...BATTLE_RULES, turnLimit: 6 },
    });
    const casted = ["girders", "frost", "smog", "dynamite", "repair"] as const;
    let i = 0;
    while (!b.state.over) {
      fillMana(b, b.turn);
      const out = await b.useAbility(casted[i++ % casted.length]);
      expect(out.ok, `cast #${i} must land`).toBe(true);
    }
    expect(b.state.turns).toBeGreaterThanOrEqual(6);
    expect(b.state.players[0].health).toBe(b.state.players[1].health);
    expect(b.state.winner).toBeNull(); // equal health at the limit = draw
  });

  it("every row of the table casts once, arming exactly its cooldown", async () => {
    const b = freshBattle();
    for (const id of BATTLE_ABILITY_ORDER) {
      const def = BATTLE_ABILITIES[id];
      const seat = b.turn;
      fillMana(b, seat);
      const out = await b.useAbility(id);
      expect(out.ok, `ability ${id} must cast`).toBe(true);
      expect(out.id).toBe(id);
      expect(out.costsTurn).toBe(def.costsTurn !== false);
      expect(b.state.cooldowns[seat][id]).toBe(def.cooldown);
    }
  });
});

describe("B3 abilities — replay and restore", () => {
  it("an ability inside a replayed move list reproduces the same battle", async () => {
    // The choreography (funding + fixtures) is the harness's "board history";
    // what is REPLAYED is the logged move list alone.
    const fund = (b: Battle) => {
      giveMana(b, 0, { gold: 3, oil: 6 });
      giveMana(b, 1, { oil: 5, gold: 5 });
    };
    // Run A: swap (seat 0) → bribe (seat 1, free) → swap (seat 1) → smog (seat 0)
    const a = freshBattle(19);
    fund(a);
    paintFixture(a);
    await a.playSwap(...FIXTURE_SWAP, 0);
    await a.useAbility("bribe");
    paintFixture(a);
    await a.playSwap(...FIXTURE_SWAP, 0);
    await a.useAbility("smog");
    const log = a.moves.map((m) => ({ ...m }));
    expect(log.map((m) => m.t)).toEqual(["swap", "ability", "swap", "ability"]);

    // Run B: same seed and the same harness beats, replaying the LOG.
    const b = freshBattle(19);
    fund(b);
    for (const m of log) {
      if (m.t === "swap") {
        paintFixture(b);
        const out = await b.playSwap(m.r1, m.c1, m.r2, m.c2, 0);
        expect(out.ok).toBe(true);
      } else if (m.t === "ability") {
        const out = await b.useAbility(m.id);
        expect(out.ok, `replayed ${m.id} must land`).toBe(true);
      }
    }
    // identical: state, board, RNG position and the re-derived move list
    expect(JSON.stringify(b.save())).toBe(JSON.stringify(a.save()));
    expect(b.moves).toEqual(a.moves);
  });

  it("save/restore continues exactly across a cast (smog + cooldowns travel)", async () => {
    const a = freshBattle(23);
    fillMana(a, 0);
    await a.useAbility("smog");
    fillMana(a, 1);
    await a.useAbility("dynamite");
    const snap = a.save();
    expect((snap as { state: { smog: [number, number] } }).state.smog).toEqual([0, 1]);
    // continue run A
    fillMana(a, 0);
    await a.useAbility("repair");
    paintFixture(a);
    await a.playSwap(...FIXTURE_SWAP, 0);
    const endA = JSON.stringify(a.save());

    // run B: restore the snapshot and play the same continuation
    const b = freshBattle(23);
    b.restore(snap);
    expect(b.state.smog).toEqual([0, 1]);
    fillMana(b, 0);
    await b.useAbility("repair");
    paintFixture(b);
    await b.playSwap(...FIXTURE_SWAP, 0);
    expect(JSON.stringify(b.save())).toBe(endA);
  });
});
