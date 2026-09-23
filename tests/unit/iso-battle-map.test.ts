// #322 — territorial battles: monopoly/town unlock, first/second win, decline
// as forfeit, fight-offs, player cooldown, rival targeting, comeback sales.
import { describe, expect, it } from "vitest";
import {
  canChallenge, canChallengeTown, createChallengeState, markChallenge, markRivalChallenge,
  rivalChallengeDue, applyBattleResult, declineTakesPrize, settleMapBattle,
  resolveFightOff, grantIndustryWin, grantTownWin, pickRivalChallengeTarget,
  cheapestSale, applySale, listSales, isComeback, monopolizedCargos, allTownsTaken,
} from "../../src/iso/battle-map";
import {
  industryLocks, heldIndustries, type EconomyState, type Harvester, type Factory,
} from "../../src/iso/economy";
import { createTrack, buildTile } from "../../src/iso/track";
import { BATTLE_RULES, BATTLE_SALE, MAP_W, MAP_H } from "../../src/iso/config";
import type { Grid } from "../../src/iso/grid";

// ── the fixture: ONE grain industry between two serviced depots ─────────────
//
//   · Industry 0 (farm, 2×2) at (12,10) — the only grain site, so whoever
//     holds it has a cargo monopoly and challenges unlock.
//   · Depot A ("p1", ownerId 1) at (10,10), entrance north, east edge on farm.
//   · Depot B ("p2", ownerId 2) at (14,10), entrance south-east, west edge on farm.

function fixture(): { eco: EconomyState; h1: Harvester; h2: Harvester } {
  const grid: Grid = {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H),
    industries: [{ id: 0, type: "farm", tx: 12, ty: 10, w: 2, h: 2, output: 1, banditUntil: 0 }],
    towns: [],
    occupancy: new Int16Array(MAP_W * MAP_H).fill(-1),
    seed: 1,
  };
  const track = createTrack();
  for (const [x, y] of [[10, 9], [11, 9]] as [number, number][]) buildTile(track, "road", x, y, 1);
  for (const [x, y] of [[16, 10], [16, 11]] as [number, number][]) buildTile(track, "road", x, y, 2);
  const h1: Harvester = { id: 1, owner: "p1", ownerId: 1, tx: 10, ty: 10, facing: "ne" };
  const h2: Harvester = { id: 2, owner: "p2", ownerId: 2, tx: 14, ty: 10, facing: "se" };
  return { eco: { grid, track, harvesters: [h1, h2], factories: [] }, h1, h2 };
}

function withTowns(eco: EconomyState): EconomyState {
  eco.grid.towns = [
    { id: 0, tx: 4, ty: 4, houses: [], roads: [] },
    { id: 1, tx: 20, ty: 4, houses: [], roads: [] },
  ];
  const f1: Factory = { owner: "p1", ownerId: 1, tx: 4, ty: 5, id: 0, townId: 0 };
  const f2: Factory = { owner: "p2", ownerId: 2, tx: 20, ty: 5, id: 1, townId: 1 };
  eco.factories = [f1, f2];
  return eco;
}

describe("#322 — industryLocks with a battle result", () => {
  it("both depots reach the industry; first-come holds it initially", () => {
    const { eco, h1, h2 } = fixture();
    const locks = industryLocks(eco);
    expect(locks.get(0)?.id).toBe(h1.id);
    expect(heldIndustries(eco, h1, locks).map((i) => i.id)).toEqual([0]);
    expect(heldIndustries(eco, h2, locks)).toEqual([]);
  });

  it("the winner's depot draws from it afterwards; the loser's stops", () => {
    const { eco, h1, h2 } = fixture();
    applyBattleResult(eco, 0, h2.id);
    const locks = industryLocks(eco);
    expect(locks.get(0)?.id).toBe(h2.id);
    expect(heldIndustries(eco, h2, locks).map((i) => i.id)).toEqual([0]);
    expect(heldIndustries(eco, h1, locks)).toEqual([]);
  });

  it("a first win shares the site; a second consecutive win closes the loser's depot", () => {
    const { eco, h1, h2 } = fixture();
    expect(grantIndustryWin(eco, 0, "p2", "p1")).toBe("rights");
    expect(eco.siteRights?.get(0)?.rights.sort()).toEqual(["p1", "p2"]);
    expect(h1.closed).toBeFalsy();
    expect(grantIndustryWin(eco, 0, "p2", "p1")).toBe("closed");
    expect(h1.closed).toBe(true);
    expect(h2.closed).toBeFalsy();
  });

  it("the owner reopening a closed depot clears closed and resets the streak", () => {
    const { eco, h1 } = fixture();
    h1.closed = true;
    expect(grantIndustryWin(eco, 0, "p1", "p2")).toBe("reopened");
    expect(h1.closed).toBe(false);
    expect(eco.siteRights?.get(0)?.streak).toEqual({ playerId: "p1", wins: 1 });
  });

  it("a draw leaves the map unchanged", () => {
    const { eco, h1, h2 } = fixture();
    applyBattleResult(eco, 0, h2.id);
    expect(settleMapBattle(eco, {
      kind: "industry", industryId: 0, challengerId: "p1",
      challengerHarvesterId: h1.id, holderHarvesterId: h2.id,
    }, null)).toBe("draw");
    expect(industryLocks(eco).get(0)?.id).toBe(h2.id);
  });

  it("declining is a forfeit — the challenger wins", () => {
    const { eco, h1, h2 } = fixture();
    expect(declineTakesPrize(eco, 0, "p2", "p1")).toBe("rights");
    expect(eco.siteRights?.get(0)?.rights).toContain("p2");
    expect(settleMapBattle(eco, {
      kind: "industry", industryId: 0, challengerId: "p2", holderId: "p1",
      challengerHarvesterId: h2.id, holderHarvesterId: h1.id,
    }, true)).toBe("closed");
    expect(h1.closed).toBe(true);
  });
});

describe("#322 — town fights", () => {
  it("first win shares the city; second consecutive closes the loser's plant", () => {
    const { eco } = fixture();
    withTowns(eco);
    expect(grantTownWin(eco, 0, "p2", "p1")).toBe("shared");
    expect(eco.townHolds?.get(0)).toEqual({ holder: "p2", wins: 1, locked: true });
    expect(eco.factories[0].closed).toBeFalsy();
    expect(grantTownWin(eco, 0, "p2", "p1")).toBe("closed");
    expect(eco.factories[0].closed).toBe(true);
    expect(eco.townHolds?.get(0)?.wins).toBe(2);
  });

  it("towns unlock only once every town is taken (or comeback)", () => {
    const { eco } = fixture();
    withTowns(eco);
    const s = createChallengeState();
    const gold = 99;
    expect(allTownsTaken(eco)).toBe(true);
    expect(canChallengeTown(eco, s, 1000, "p2", 0, BATTLE_RULES, gold).ok).toBe(true);
    eco.factories[1].closed = true;
    eco.factories.pop();
    expect(allTownsTaken(eco)).toBe(false);
    expect(canChallengeTown(eco, s, 1000, "p2", 0, BATTLE_RULES, gold))
      .toEqual({ ok: false, reason: "not-eligible" });
  });
});

describe("B5 — fight-offs (acceptance 2)", () => {
  it("winning cancels the sabotage — it never lands", () => {
    expect(resolveFightOff(true)).toBe(false);
    expect(settleMapBattle(fixture().eco, {
      kind: "fightoff",
      pending: { kind: "blockade", attackerId: "rival", industryId: 0, until: 100, offerUntil: 50 },
    }, true)).toBe("cancelled");
  });

  it("losing (or declining) lands it exactly as bought", () => {
    expect(resolveFightOff(false)).toBe(true);
    expect(settleMapBattle(fixture().eco, {
      kind: "fightoff",
      pending: { kind: "blockade", attackerId: "rival", industryId: 0, until: 100, offerUntil: 50 },
    }, false)).toBe("lands");
  });
});

describe("#322 — eligibility, cooldown, rival pace", () => {
  it("challenges unlock on a cargo monopoly; the holder cannot challenge their own", () => {
    const { eco, h1, h2 } = fixture();
    const s = createChallengeState();
    const gold = BATTLE_RULES.challengeGold + 5;
    expect(monopolizedCargos(eco).get("grain")).toBe("p1");
    const ok = canChallenge(eco, s, 1000, "p2", 0, BATTLE_RULES, gold);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.holder?.id).toBe(h1.id);
      expect(ok.mine?.id).toBe(h2.id);
    }
    expect(canChallenge(eco, s, 1000, "p1", 0, BATTLE_RULES, gold))
      .toEqual({ ok: false, reason: "held-by-you" });
    expect(canChallenge(eco, s, 1000, "p2", 0, BATTLE_RULES, 0))
      .toEqual({ ok: false, reason: "gold" });
  });

  it("a second unheld grain industry is not a monopoly — fights stay locked", () => {
    const { eco } = fixture();
    eco.grid.industries.push({ id: 1, type: "farm", tx: 2, ty: 2, w: 2, h: 2, output: 1, banditUntil: 0 });
    const s = createChallengeState();
    expect(monopolizedCargos(eco).has("grain")).toBe(false);
    expect(canChallenge(eco, s, 1000, "p2", 0, BATTLE_RULES, 99))
      .toEqual({ ok: false, reason: "not-eligible" });
  });

  it("one 2-minute player cooldown; the per-industry clock is gone", () => {
    const { eco } = fixture();
    const s = createChallengeState();
    const gold = 99;
    markChallenge(s, 1000, "p2", 0, BATTLE_RULES);
    expect(s.battles).toBe(1);
    expect(canChallenge(eco, s, 2000, "p2", 0, BATTLE_RULES, gold))
      .toEqual({ ok: false, reason: "cooldown" });
    expect(BATTLE_RULES.challengeIndustryCooldownMs).toBe(0);
    expect(BATTLE_RULES.challengePlayerCooldownMs).toBe(120_000);
    s.playerReadyAt.clear();
    expect(canChallenge(eco, s, 2000, "p2", 0, BATTLE_RULES, gold).ok).toBe(true);
  });

  it("comeback (last plant closed) waives eligibility and cooldown", () => {
    const { eco } = fixture();
    withTowns(eco);
    eco.factories[1].closed = true;
    expect(isComeback(eco, "p2")).toBe(true);
    const s = createChallengeState();
    markChallenge(s, 1000, "p2", 0, BATTLE_RULES);
    expect(canChallenge(eco, s, 2000, "p2", 0, BATTLE_RULES, 99).ok).toBe(true);
  });

  it("a whole game against the Normal rival has a sensible number of battles", () => {
    const s = createChallengeState();
    const T = 30 * 60_000;
    for (let t = 0; t <= T; t += 60_000) {
      if (rivalChallengeDue(s, t)) {
        markChallenge(s, t, "rival", 0, BATTLE_RULES);
        markRivalChallenge(s, t, "normal");
      }
    }
    expect(s.battles).toBeGreaterThanOrEqual(2);
    expect(s.battles).toBeLessThanOrEqual(10);
  });

  it("the skills pace the rival's challenges differently (easy < normal < hard)", () => {
    const due = (skill: "easy" | "normal" | "hard") => {
      const s = createChallengeState();
      let fights = 0;
      for (let t = 0; t <= 30 * 60_000; t += 30_000) {
        if (rivalChallengeDue(s, t)) {
          markChallenge(s, t, "rival", 0, BATTLE_RULES);
          markRivalChallenge(s, t, skill);
          fights++;
        }
      }
      return fights;
    };
    const easy = due("easy"), normal = due("normal"), hard = due("hard");
    expect(easy).toBeLessThan(normal);
    expect(normal).toBeLessThan(hard);
  });

  it("the rival prefers its own closed depot, then a player monopoly, then a town", () => {
    const { eco, h2 } = fixture();
    withTowns(eco);
    const s = createChallengeState();
    h2.closed = true;
    const gold = 99;
    const first = pickRivalChallengeTarget(eco, s, 1000, "p2", "p1", BATTLE_RULES, gold);
    expect(first).toEqual({ kind: "industry", id: 0 });
    h2.closed = false;
    const second = pickRivalChallengeTarget(eco, s, 1000, "p2", "p1", BATTLE_RULES, gold);
    expect(second).toEqual({ kind: "industry", id: 0 });
  });
});

describe("#322 — comeback sales", () => {
  it("lists cheapest-first and applySale pays Gold", () => {
    const { eco, h1 } = fixture();
    withTowns(eco);
    const sales = listSales(eco, "p1", BATTLE_SALE.pavedTiles, 1);
    expect(sales[0]?.kind).toBe("pave");
    expect(sales.some((s) => s.kind === "depot" && s.id === h1.id)).toBe(true);
    expect(sales.some((s) => s.kind === "plant")).toBe(true);
    expect(sales.some((s) => s.kind === "city")).toBe(true);
    const cheap = cheapestSale(eco, "p1", BATTLE_SALE.pavedTiles, 1);
    expect(cheap?.kind).toBe("pave");
    expect(applySale(eco, "p1", { kind: "depot", gold: BATTLE_SALE.depot, id: h1.id })).toBe(BATTLE_SALE.depot);
    expect(eco.harvesters.find((h) => h.id === h1.id)).toBeUndefined();
  });
});
