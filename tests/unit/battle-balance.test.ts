// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// B7 (#252) — battle balance, onboarding and ★.
//
// Always on (fast):
//   • the TUNED TABLE is pinned here, row by row — docs/battle-balance.md is
//     where each number is argued; a retune changes both in one commit;
//   • the engine knobs B7 added do what the doc says: the extra-turn chain
//     cap, the second seat's health, free Girders/Frost that ARM and drop
//     when the caster's turn passes — and all three survive save/restore;
//   • the ★ cap: contested sites held by battle pay +hold★ each, at most
//     holdCap★ per seat, revocably; a site nobody fought over pays nothing;
//   • the first-battle hint shows ONCE (the gate and the screen), and the
//     How to Play page reads its numbers from the live tables.
//
// Gated (slow — `BATTLE_BALANCE=1`): the doc's release gates, re-measured
// with the real engine and the real rival policies. See the doc's "How it is
// measured" for the command and the seeds.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, afterEach } from "vitest";
import { createBattle, type Battle } from "../../src/game/battle";
import { openBattleScreen, type BattleScreenHandle } from "../../src/game/battle-screen";
import type { ResKey } from "../../src/game/config";
import { MAP_W, MAP_H } from "../../src/game/config";
import {
  BATTLE_ABILITIES, BATTLE_ABILITY_ORDER, BATTLE_RULES, VICTORY, type Cargo,
} from "../../src/iso/config";
import {
  createScoreState, rescore, vpFor, hasWon, victoryBreakdown, payingHolds, contestedHolds,
  type LoopScoring,
} from "../../src/iso/victory";
import { ledgerRows } from "../../src/iso/ending";
import { createTrack } from "../../src/iso/track";
import { GRASS, type Grid, type Industry, type Town } from "../../src/iso/grid";
import type { EconomyState } from "../../src/iso/economy";
import {
  BATTLE_HINT_KEY, battleHintLines, buildBattleHowtoSteps, takeFirstBattleHint,
} from "../../src/iso/battle-howto";
import {
  contestedIndustries, battleCooldownLeft, fmtBattleCooldown, createChallengeState, markChallenge,
} from "../../src/iso/battle-map";
import {
  matchup, score, seedList, type SimSeat,
} from "./helpers/battle-sim";

const ALL: Cargo[] = ["grain", "wood", "ore", "stone", "oil", "gold"];
const players = [
  { id: "you", name: "You", depots: ALL },
  { id: "ai", name: "Rival", depots: ALL },
];
const fresh = (seed = 7): Battle => createBattle({ seed, players, rules: BATTLE_RULES });
const checker = (b: Battle) => { for (const g of b.board.gems()) g.res = (g.r + g.c) % 2 ? "ore" : "wheat"; };
const at = (b: Battle, r: number, c: number, res: ResKey) => { b.board.grid[r][c]!.res = res; };
/** battle.test's 4-run fixture: the swap (1,2)→(0,2) completes a wood run of 4. */
const paintFour = (b: Battle) => {
  checker(b);
  at(b, 0, 0, "wood"); at(b, 0, 1, "wood"); at(b, 0, 3, "wood"); at(b, 1, 2, "wood");
};

// ══════════════════════════════════════════════════════════════════════════
describe("B7 — the tuned table (docs/battle-balance.md)", () => {
  it("pins BATTLE_RULES", () => {
    expect(BATTLE_RULES).toMatchObject({
      startHealth: 50,
      manaCap: 12,
      manaPerGem: 1,
      damagePerGem: 1,
      matchDamagePerGem: 1,
      extraTurnMinMatch: 4,
      extraTurnOnShape: true,
      extraTurnOnCascade: 3,
      extraTurnChain: 1,
      secondSeatHealth: 10,
      turnLimit: 20,
      turnMs: 30000,
      challengeGold: 12,
      declineGold: 9,
      challengePlayerCooldownMs: 120_000,
    });
  });

  it("pins every ability row — cost, cooldown, effect, and whether it spends the turn", () => {
    const row = (id: keyof typeof BATTLE_ABILITIES) => {
      const d = BATTLE_ABILITIES[id];
      return {
        cost: d.cost, cooldown: d.cooldown, requires: d.requires, free: d.costsTurn === false,
        girders: d.girders, frostGems: d.frostGems, frostHard: d.frostHard, matches: d.matches,
        damage: d.damage, heal: d.heal, stealPerCargo: d.stealPerCargo,
      };
    };
    expect(row("girders")).toMatchObject({ cost: { stone: 2, ore: 2 }, cooldown: 2, requires: "stone", free: true, girders: 4 });
    expect(row("frost")).toMatchObject({ cost: { grain: 2, wood: 2 }, cooldown: 2, requires: "grain", free: true, frostGems: 6, frostHard: 2 });
    expect(row("smog")).toMatchObject({ cost: { oil: 4 }, cooldown: 2, requires: "oil", free: true, matches: 1 });
    expect(row("dynamite")).toMatchObject({ cost: { ore: 2, oil: 2 }, cooldown: 2, requires: "ore", free: false, damage: 9 });
    expect(row("repair")).toMatchObject({ cost: { wood: 2, stone: 2 }, cooldown: 3, requires: "wood", free: false, heal: 10 });
    expect(row("bribe")).toMatchObject({ cost: { gold: 3 }, cooldown: 2, requires: "gold", free: true, stealPerCargo: 2 });
  });

  it("pins the ★ table: Hold ★ is one route among several, and capped below the city", () => {
    expect(VICTORY.loop.hold).toBe(1);
    expect(VICTORY.loop.holdCap).toBe(2);
    // the cap is a minority of the line: the game is winnable without a fight
    expect(VICTORY.loop.holdCap / VICTORY.loop.target).toBeLessThanOrEqual(0.2);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("B7 — engine knobs", () => {
  it("extraTurnChain: one extra turn, then the turn passes however big the move", async () => {
    const b = fresh(7);
    paintFour(b);
    const first = await b.playSwap(1, 2, 0, 2, 0);
    expect(first.ok).toBe(true);
    expect(first.extraTurn).toBe(true);
    expect(b.state.turn).toBe(0);
    expect(b.state.chain).toBe(1);

    paintFour(b);
    const second = await b.playSwap(1, 2, 0, 2, 0);
    expect(second.ok).toBe(true);
    expect(second.damage).toBeGreaterThan(0);   // the move still scores…
    expect(second.extraTurn).toBe(false);       // …but the chain is spent
    expect(b.state.turn).toBe(1);
    expect(b.state.chain).toBe(0);
  });

  it("secondSeatHealth: seat 1 opens higher, and Repair heals up to ITS full health", async () => {
    const b = fresh(3);
    const full = BATTLE_RULES.startHealth + (BATTLE_RULES.secondSeatHealth ?? 0);
    expect(b.state.players[0].health).toBe(BATTLE_RULES.startHealth);
    expect(b.state.players[1].health).toBe(full);
    expect(b.state.players[1].maxHealth).toBe(full);

    // seat 0 passes the turn with Dynamite; seat 1 repairs to 60, not to 50
    b.state.players[0].mana.ore = 2; b.state.players[0].mana.oil = 2;
    expect((await b.useAbility("dynamite")).ok).toBe(true);
    b.state.players[1].health = full - 3;
    b.state.players[1].mana.wood = 2; b.state.players[1].mana.stone = 2;
    const rep = await b.useAbility("repair");
    expect(rep.ok).toBe(true);
    expect(rep.heal).toBe(3);
    expect(b.state.players[1].health).toBe(full);
  });

  it("a free Girders ARMS: nothing on the board until the caster's turn passes, gone when it returns", async () => {
    const b = fresh(5);
    b.state.players[0].mana.stone = 2; b.state.players[0].mana.ore = 2;
    const cast = await b.useAbility("girders");
    expect(cast.ok).toBe(true);
    expect(cast.costsTurn).toBe(false);
    expect(cast.girders).toBe(BATTLE_ABILITIES.girders.girders);
    expect(b.state.turn).toBe(0);                          // still the caster's
    expect(b.board.obstacleCounts().girders).toBe(0);      // never on its own swap
    expect(b.state.armed).toMatchObject({ seat: 0, girders: 4 });

    // the caster keeps swapping until the turn passes; the girders wait
    for (let i = 0; i < 6 && b.state.turn === 0 && !b.state.over; i++) {
      expect(b.board.obstacleCounts().girders).toBe(0);
      const mv = b.board.findMove()!;
      await b.playSwap(mv[0], mv[1], mv[2], mv[3], 0);
    }
    expect(b.state.turn).toBe(1);
    expect(b.board.obstacleCounts().girders).toBe(4);      // the opponent's board
    expect(b.state.obstaclesBy).toBe(0);
    expect(b.state.armed).toBeNull();

    for (let i = 0; i < 6 && b.state.turn === 1 && !b.state.over; i++) {
      const mv = b.board.findMove()!;
      await b.playSwap(mv[0], mv[1], mv[2], mv[3], 0);
    }
    expect(b.state.turn).toBe(0);
    expect(b.board.obstacleCounts().girders).toBe(0);      // lifted for the caster
    expect(b.state.obstaclesBy).toBeNull();
  });

  it("chain, armed obstacles and full health survive save/restore (multiplayer + saves)", async () => {
    const b = fresh(9);
    b.state.players[0].mana.grain = 2; b.state.players[0].mana.wood = 2;
    expect((await b.useAbility("frost")).ok).toBe(true);
    paintFour(b);
    await b.playSwap(1, 2, 0, 2, 0);                       // an extra turn: chain 1, frost still armed
    const snap = JSON.parse(JSON.stringify(b.save()));
    const c = fresh(9);
    c.restore(snap);
    expect(c.state.chain).toBe(b.state.chain);
    expect(c.state.armed).toEqual(b.state.armed);
    expect(c.state.players[1].maxHealth).toBe(b.state.players[1].maxHealth);
    expect(JSON.stringify(c.save())).toBe(JSON.stringify(b.save()));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ★ — Hold ★ and its cap
const industry = (id: number, tx: number): Industry =>
  ({ id, type: "farm", tx, ty: 10, w: 4, h: 4, output: 0, banditUntil: 0 } as Industry);
const town = (id: number, tx: number): Town => ({ id, tx, ty: 30, houses: [[tx, 30]], roads: [] } as Town);

function ecoWith(): EconomyState {
  const grid: Grid = {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries: [industry(0, 5), industry(1, 15), industry(2, 25), industry(3, 35)],
    towns: [town(0, 10)],
    occupancy: new Int16Array(MAP_W * MAP_H).fill(-1),
    seed: 1,
  };
  return { grid, track: createTrack(), harvesters: [], factories: [], siteRights: new Map(), townHolds: new Map() };
}
const loop: LoopScoring = {
  running: () => false, cargoOf: () => null, routePaved: () => false,
  seats: [{ owner: "you", depotTier: 0, townLevel: 0 }, { owner: "ai", depotTier: 0, townLevel: 0 }],
};
const won = (eco: EconomyState, id: number, who: string, rights = ["you", "ai"]) =>
  eco.siteRights!.set(id, { rights, streak: { playerId: who, wins: 1 } });

describe("B7 — Hold ★ and the cap", () => {
  it("pays +hold★ per contested site held, capped at holdCap★ per seat", () => {
    const eco = ecoWith();
    won(eco, 0, "you"); won(eco, 1, "you"); won(eco, 2, "you");
    eco.townHolds!.set(0, { holder: "you", wins: 1, locked: false });
    const score = createScoreState();
    const events = rescore(eco, score, undefined, loop);
    expect(contestedHolds(eco).filter((h) => h.owner === "you")).toHaveLength(4);
    expect(vpFor(score, "you")).toBe(VICTORY.loop.holdCap);           // 4 held, 2 pay
    expect(events.filter((e) => e.source === "hold" && e.type === "awarded")).toHaveLength(2);
    const b = victoryBreakdown(eco, "you", undefined, loop);
    expect(b).toMatchObject({ holds: 2, holdVp: 2, holdsHeld: 4 });
    // the cap holds however many more sites fall
    won(eco, 3, "you");
    rescore(eco, score, undefined, loop);
    expect(vpFor(score, "you")).toBe(VICTORY.loop.holdCap);
  });

  it("is revocable: lose the next fight and the ★ moves (and another held site steps in)", () => {
    const eco = ecoWith();
    won(eco, 0, "you"); won(eco, 1, "you"); won(eco, 2, "you");
    const score = createScoreState();
    rescore(eco, score, undefined, loop);
    const paying = [...payingHolds(eco, score.holds).keys()];
    expect(paying).toEqual(["you#industry:0", "you#industry:1"]);

    won(eco, 0, "ai");                                               // the rival takes site 0 back
    const ev = rescore(eco, score, undefined, loop);
    expect(ev.some((e) => e.source === "hold" && e.type === "revoked" && e.owner === "you")).toBe(true);
    expect(vpFor(score, "you")).toBe(2);                             // site 2 steps in
    expect(vpFor(score, "ai")).toBe(1);
    expect([...score.holds.keys()].sort()).toEqual(["ai#industry:0", "you#industry:1", "you#industry:2"]);

    eco.siteRights!.clear();
    rescore(eco, score, undefined, loop);
    expect(vpFor(score, "you")).toBe(0);
    expect(vpFor(score, "ai")).toBe(0);
  });

  it("pays nothing for a site nobody fought over, or a stale record without rights", () => {
    const eco = ecoWith();
    eco.siteRights!.set(0, { rights: ["you"], streak: null });          // shared, no standing winner
    won(eco, 1, "you", ["ai"]);                                          // streak left behind, rights gone
    const score = createScoreState();
    rescore(eco, score, undefined, loop);
    expect(vpFor(score, "you")).toBe(0);
    expect(contestedIndustries(eco).size).toBe(0);
  });

  it("counts toward the win like every other source, and the ledger shows the row only when it paid", () => {
    const eco = ecoWith();
    won(eco, 0, "you"); won(eco, 1, "you");
    const score = createScoreState();
    rescore(eco, score, undefined, loop);
    expect(hasWon(score, "you", 2)).toBe(true);
    expect(hasWon(score, "you", 3)).toBe(false);
    const base = { loop: true, paved: 0, plants: 0, pavedVp: 0, plantVp: 0, types: 1, typeVp: 1, city: 0, cityVp: 0, routes: 0, routeVp: 0 };
    expect(ledgerRows(base).map((r) => r.key)).toEqual(["types", "routes", "city"]);
    expect(ledgerRows({ ...base, holds: 2, holdVp: 2 }).map((r) => r.key)).toEqual(["types", "routes", "city", "holds"]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Onboarding — the one-time hint and the page
const memoryStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
};

let screen: BattleScreenHandle | null = null;
afterEach(() => {
  screen?.destroy();
  screen = null;
  document.body.innerHTML = "";
});

describe("B7 — first-battle hint and How to Play", () => {
  it("the gate hands out the hint once, then never again", () => {
    const storage = memoryStorage();
    const first = takeFirstBattleHint(storage);
    expect(first).toEqual(battleHintLines());
    expect(storage.getItem(BATTLE_HINT_KEY)).toBe("seen");
    expect(takeFirstBattleHint(storage)).toBeNull();
    expect(takeFirstBattleHint(storage)).toBeNull();
  });

  it("shows on the first battle's screen only — and never blocks the board", () => {
    const storage = memoryStorage();
    const open = (seed: number) => openBattleScreen({
      battle: createBattle({ seed, players, rules: BATTLE_RULES, animate: false }),
      contenders: [{ id: "you", name: "You", portrait: null }, { id: "ai", name: "Rival", portrait: null }],
      opponentDelayMs: 60_000,
      onHelp: () => {},
      firstHint: takeFirstBattleHint(storage),
      onClose: () => {},
    });
    screen = open(1);
    const hint = screen.root.querySelector(".battle-first-hint");
    expect(hint).not.toBeNull();
    expect(hint!.querySelectorAll("li")).toHaveLength(3);
    expect(screen.root.querySelector(".battle-help")).not.toBeNull();       // the "?"
    // the board stays live under it
    expect(screen.root.querySelectorAll(".battle-board .gem").length).toBeGreaterThan(0);
    (hint!.querySelector("[data-act=battle-hint-ok]") as HTMLButtonElement).click();
    expect(screen.root.querySelector(".battle-first-hint")).toBeNull();
    screen.destroy();

    screen = open(2);                                                        // the second battle
    expect(screen.root.querySelector(".battle-first-hint")).toBeNull();
  });

  it("the page's five cards quote the live tables (turns, mana, extra turns, abilities, limit + stakes)", () => {
    const steps = buildBattleHowtoSteps();
    expect(steps.map((s) => s.id)).toEqual(["battle-turns", "battle-mana", "battle-extra", "battle-abilities", "battle-stakes"]);
    const text = JSON.stringify(steps);
    expect(text).toContain(`${BATTLE_RULES.startHealth} health`);
    expect(text).toContain(`${BATTLE_RULES.turnLimit} turns`);
    expect(text).toContain(`+${BATTLE_RULES.secondSeatHealth} health`);
    expect(text).toContain(`at most ${VICTORY.loop.holdCap}★`);
    for (const id of BATTLE_ABILITY_ORDER) expect(text).toContain(BATTLE_ABILITIES[id].name);
    // a retune moves the page with it
    const other = JSON.stringify(buildBattleHowtoSteps({ ...BATTLE_RULES, turnLimit: 26 }));
    expect(other).toContain("26 turns");
  });

  it("the map's challenge clock reads the same cooldown the challenge gate enforces", () => {
    const s = createChallengeState();
    markChallenge(s, 1000, "you", 0, BATTLE_RULES);
    expect(battleCooldownLeft(s, 1000, "you")).toBe(BATTLE_RULES.challengePlayerCooldownMs);
    expect(fmtBattleCooldown(battleCooldownLeft(s, 1000 + 55_500, "you"))).toBe("1:05");
    expect(battleCooldownLeft(s, 1000 + BATTLE_RULES.challengePlayerCooldownMs, "you")).toBe(0);
    expect(battleCooldownLeft(s, 0, "ai")).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// The release gates (docs/battle-balance.md) — slow, opt-in.
const GATED = process.env.BATTLE_BALANCE === "1";
const N = Number(process.env.BATTLE_BALANCE_N ?? 200);
const P = (policy: SimSeat["policy"], depots?: Cargo[]): SimSeat => ({ policy, depots });
const seat0 = (t: { seat0Wins: number; decisive: number }) => t.seat0Wins / Math.max(1, t.decisive);

describe.skipIf(!GATED)("B7 — release gates (BATTLE_BALANCE=1)", () => {
  it("battles last, KO most of the time, and the first move is compensated", async () => {
    const g = await matchup(P("greedy"), P("greedy"), seedList(N));
    const n = await matchup(P("normal"), P("normal"), seedList(N));
    const turns = n.turns / n.n;
    console.log(`[B7] normal mirror: ${turns.toFixed(1)} turns, KO ${(n.ko / n.n * 100).toFixed(0)}%, seat0 ${(seat0(n) * 100).toFixed(0)}% | greedy seat0 ${(seat0(g) * 100).toFixed(0)}%`);
    expect(turns).toBeGreaterThanOrEqual(10);
    expect(turns).toBeLessThanOrEqual(18);
    expect(n.ko / n.n).toBeGreaterThanOrEqual(0.6);
    expect(n.draws / n.n).toBeLessThan(0.05);
    expect(seat0(n)).toBeLessThanOrEqual(0.62);
    expect(seat0(g)).toBeGreaterThanOrEqual(0.38);
    expect(seat0(g)).toBeLessThanOrEqual(0.62);
  }, 600_000);

  it("the skill ladder holds: easy < greedy < hard", async () => {
    const eg = score(await matchup(P("easy"), P("greedy"), seedList(N, 9000)));
    const hg = score(await matchup(P("hard"), P("greedy"), seedList(Math.ceil(N / 2), 9000)));
    console.log(`[B7] easy-v-greedy ${(eg * 100).toFixed(0)}%  hard-v-greedy ${(hg * 100).toFixed(0)}%`);
    expect(eg).toBeLessThan(0.5);
    expect(hg).toBeGreaterThan(0.5);
  }, 600_000);

  it("spells pay, and no single ability loadout dominates the round robin", async () => {
    const kit = score(await matchup(P("normal"), P("normal", []), seedList(N, 7100)));
    expect(kit).toBeGreaterThan(0.5);
    const tot: Record<string, number> = {};
    for (let i = 0; i < BATTLE_ABILITY_ORDER.length; i++) {
      for (let j = i + 1; j < BATTLE_ABILITY_ORDER.length; j++) {
        const a = BATTLE_ABILITY_ORDER[i], b = BATTLE_ABILITY_ORDER[j];
        const s = score(await matchup(
          P("normal", [BATTLE_ABILITIES[a].requires!]), P("normal", [BATTLE_ABILITIES[b].requires!]),
          seedList(Math.ceil(N / 2), 8000),
        ));
        tot[a] = (tot[a] ?? 0) + s;
        tot[b] = (tot[b] ?? 0) + (1 - s);
      }
    }
    const rr = BATTLE_ABILITY_ORDER.map((id) => [id, tot[id] / (BATTLE_ABILITY_ORDER.length - 1)] as const);
    console.log(`[B7] kit-v-none ${(kit * 100).toFixed(0)}%  RR ${rr.map(([id, v]) => `${id} ${(v * 100).toFixed(0)}%`).join(" ")}`);
    for (const [, v] of rr) expect(v).toBeLessThan(0.62);
  }, 1_200_000);
});
