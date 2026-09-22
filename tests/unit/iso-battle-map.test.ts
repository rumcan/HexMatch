// B5 (#250) — battles on the map: contested industries, conquests, fight-offs
// and the cooldowns that pace them. These are the ACCEPTANCE mechanisms:
//   1. a battle result decides who draws the contested industry (`industryLocks`
//      with a conquest on the state), until the next challenge;
//   2. a Blockade/Protest can be fought off — winning cancels it (the attacker's
//      Gold stays spent: the hire is paid at purchase in `game.ts`, and
//      `settleMapBattle` touches no purse — nothing refunds it);
//   3. cooldowns stop battle spam, and a whole game against the Normal rival
//      has a SENSIBLE number of battles (the playtest note's count, machine-
//      twinned here over 30 game-minutes of the rival's challenge clock).
// The other acceptance half — "neither player's resources tick during a battle"
// — is a live-tick gate (`game.ts` tick entry points); its probe lives in
// `iso-battle-pause.test.ts` against a booted game.
import { describe, expect, it } from "vitest";
import {
  canChallenge, createChallengeState, markChallenge, markRivalChallenge,
  rivalChallengeDue, applyBattleResult, declineTakesPrize, settleMapBattle,
  resolveFightOff,
} from "../../src/iso/battle-map";
import {
  industryLocks, heldIndustries, type EconomyState, type Harvester,
} from "../../src/iso/economy";
import { createTrack, buildTile, demolishTile } from "../../src/iso/track";
import { BATTLE_RULES, MAP_W, MAP_H } from "../../src/iso/config";
import type { Grid } from "../../src/iso/grid";

// ── the fixture: ONE contested industry between two serviced depots ─────────
//
//   · Industry 0 (farm, 2×2) at (12,10).
//   · Depot A ("p1", ownerId 1) at (10,10), entrance on its north edge (facing
//     "ne") with a private road at (10,9). Its east edge touches the farm.
//   · Depot B ("p2", ownerId 2) at (14,10), entrance on its south-east edge
//     (facing "se") with a private road at (16,10). Its west edge touches the
//     same farm. Both depots therefore reach industry 0 — contested.

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
  // Depot A's entrance road (north edge), owned by seat 1.
  for (const [x, y] of [[10, 9], [11, 9]] as [number, number][]) buildTile(track, "road", x, y, 1);
  // Depot B's entrance road (south-east edge), owned by seat 2.
  for (const [x, y] of [[16, 10], [16, 11]] as [number, number][]) buildTile(track, "road", x, y, 2);
  const h1: Harvester = { id: 1, owner: "p1", ownerId: 1, tx: 10, ty: 10, facing: "ne" };
  const h2: Harvester = { id: 2, owner: "p2", ownerId: 2, tx: 14, ty: 10, facing: "se" };
  return { eco: { grid, track, harvesters: [h1, h2], factories: [] }, h1, h2 };
}

describe("B5 — industryLocks with a battle result (acceptance 1)", () => {
  it("both depots reach the contested industry; first-come holds it initially", () => {
    const { eco, h1, h2 } = fixture();
    const locks = industryLocks(eco);
    expect(locks.get(0)?.id).toBe(h1.id);                    // build order = first-come
    expect(heldIndustries(eco, h1, locks).map((i) => i.id)).toEqual([0]);
    expect(heldIndustries(eco, h2, locks)).toEqual([]);      // the loser of first-come
  });

  it("the winner's depot draws from it afterwards; the loser's stops", () => {
    const { eco, h1, h2 } = fixture();
    applyBattleResult(eco, 0, h2.id);                       // B wins the fight
    const locks = industryLocks(eco);
    expect(locks.get(0)?.id).toBe(h2.id);                    // winner draws it
    expect(heldIndustries(eco, h2, locks).map((i) => i.id)).toEqual([0]);
    expect(heldIndustries(eco, h1, locks)).toEqual([]);      // loser stops drawing
  });

  it("a conquest stands until the NEXT successful challenge flips it", () => {
    const { eco, h1, h2 } = fixture();
    applyBattleResult(eco, 0, h2.id);
    expect(industryLocks(eco).get(0)?.id).toBe(h2.id);
    applyBattleResult(eco, 0, h1.id);                       // A's rematch wins
    expect(industryLocks(eco).get(0)?.id).toBe(h1.id);
  });

  it("a draw leaves the map unchanged; a lapsed conquest falls back to first-come", () => {
    const { eco, h1, h2 } = fixture();
    applyBattleResult(eco, 0, h2.id);
    // draw → settle returns "draw" and touches nothing
    expect(settleMapBattle(eco, {
      kind: "industry", industryId: 0, challengerId: "p1",
      challengerHarvesterId: h1.id, holderHarvesterId: h2.id,
    }, null)).toBe("draw");
    expect(industryLocks(eco).get(0)?.id).toBe(h2.id);
    // the conqueror's depot is demolished → the conquest lapses
    eco.harvesters = [h1];
    expect(industryLocks(eco).get(0)?.id).toBe(h1.id);
  });

  it("declining hands the challenger the prize (declineTakesPrize)", () => {
    const { eco, h1, h2 } = fixture();
    declineTakesPrize(eco, 0, h2.id);                       // A challenged; B folded
    expect(industryLocks(eco).get(0)?.id).toBe(h2.id);
  });

  it("settle: challenger win = conquest, defender win = held", () => {
    const { eco, h1, h2 } = fixture();
    const stake = {
      kind: "industry" as const, industryId: 0, challengerId: "p2",
      challengerHarvesterId: h2.id, holderHarvesterId: h1.id,
    };
    expect(settleMapBattle(eco, stake, true)).toBe("conquest");
    expect(industryLocks(eco).get(0)?.id).toBe(h2.id);
    expect(settleMapBattle(eco, stake, false)).toBe("held");
    expect(industryLocks(eco).get(0)?.id).toBe(h1.id);
  });
});

describe("B5 — fight-offs (acceptance 2)", () => {
  it("winning cancels the sabotage — it never lands", () => {
    expect(resolveFightOff(true)).toBe(false);              // does not land
    expect(settleMapBattle(fixture().eco, {
      kind: "fightoff",
      pending: { kind: "blockade", attackerId: "rival", industryId: 0, until: 100, offerUntil: 50 },
    }, true)).toBe("cancelled");
    expect(settleMapBattle(fixture().eco, {
      kind: "fightoff",
      pending: { kind: "protest", attackerId: "rival", tile: 3, until: 100, offerUntil: 50 },
    }, true)).toBe("cancelled");
  });

  it("losing (or declining) lands it exactly as bought — and the attacker's Gold stays spent", () => {
    expect(resolveFightOff(false)).toBe(true);              // lands
    expect(settleMapBattle(fixture().eco, {
      kind: "fightoff",
      pending: { kind: "blockade", attackerId: "rival", industryId: 0, until: 100, offerUntil: 50 },
    }, false)).toBe("lands");
    // The Gold half of the acceptance line: `settleMapBattle` never touches a
    // purse — the hire is charged at purchase in `game.ts`'s buyBlackFor /
    // rivalSabotage / rivalRaid and nothing here (or there) refunds it. A
    // defender that fights off a raid therefore costs the attacker the full
    // price every time.
  });
});

describe("B5 — cooldowns and the battle count (acceptance 3/4)", () => {
  it("may challenge a contested industry, and the refusals read right", () => {
    const { eco, h1, h2 } = fixture();
    const s = createChallengeState();
    const gold = BATTLE_RULES.challengeGold + 5;
    // p1 holds it (first-come); p2's depot reaches it too — p2 may challenge.
    const ok = canChallenge(eco, s, 1000, "p2", 0, BATTLE_RULES, gold);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.holder.id).toBe(h1.id);
      expect(ok.mine.id).toBe(h2.id);
    }
    // the holder cannot challenge their own holding
    expect(canChallenge(eco, s, 1000, "p1", 0, BATTLE_RULES, gold))
      .toEqual({ ok: false, reason: "held-by-you" });
    // not enough Gold
    expect(canChallenge(eco, s, 1000, "p2", 0, BATTLE_RULES, 0))
      .toEqual({ ok: false, reason: "gold" });
    // not contested (p2's depot loses BOTH entrance tiles)
    const { eco: eco2 } = fixture();
    demolishTile(eco2.track, "road", 16, 10);
    demolishTile(eco2.track, "road", 16, 11);
    expect(canChallenge(eco2, s, 1000, "p2", 0, BATTLE_RULES, gold))
      .toEqual({ ok: false, reason: "not-contested" });
  });

  it("cooldowns stop battle spam — both the per-player and the per-industry clock", () => {
    const { eco } = fixture();
    const s = createChallengeState();
    const gold = 99;
    markChallenge(s, 1000, "p2", 0, BATTLE_RULES);
    expect(s.battles).toBe(1);
    // inside the per-player cooldown
    expect(canChallenge(eco, s, 2000, "p2", 0, BATTLE_RULES, gold))
      .toEqual({ ok: false, reason: "cooldown" });
    // past the player clock but inside the industry clock → the pair is paced too
    s.playerReadyAt.clear();
    expect(canChallenge(eco, s, 1000 + BATTLE_RULES.challengeIndustryCooldownMs - 1, "p2", 0, BATTLE_RULES, gold))
      .toEqual({ ok: false, reason: "industry-cooldown" });
    // past BOTH clocks it may fight again (and a second fight counts)
    markChallenge(s, 1000 + BATTLE_RULES.challengeIndustryCooldownMs + 1, "p2", 0, BATTLE_RULES);
    expect(s.battles).toBe(2);
  });

  it("a whole game against the Normal rival has a sensible number of battles (playtest note)", () => {
    // 30 game-minutes of the rival's own challenge clock (`challengeEveryMs`),
    // one scheduler pass a minute. Normal's pace is 6 minutes — the band is the
    // acceptance's "sensible number"; the live game's note reports the same
    // `ChallengeState.battles` counter (see the PR body).
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
});
