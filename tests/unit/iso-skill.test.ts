// ══════════════════════════════════════════════════════════════════════════
// AI-01 unit coverage for the pieces the race harness cannot pin:
//   • resolveSkillKey  — where the boot difficulty comes from (URL > storage
//     > normal), with garbage falling through instead of crashing the boot;
//   • chooseRivalOffer — the market posting rule, including the bank-reserve
//     that keeps an escrowed offer from deadlocking the 4:1 bank (the race
//     autopsy that produced it);
//   • deepPlanCandidates — the memoized bottomless-purse planning the stall
//     turn and the offer both read: same answer as the raw search, recomputed
//     only when the world actually moves.
// The difficulty ladder ITSELF (that hard finishes before normal before easy)
// is measured, not asserted here — that lives in iso-skill-calibration.test.ts.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { BANK_RATE } from "../../src/game/trade";
import { CARGOES, VICTORY } from "../../src/iso/config";
import {
  resolveSkillKey, RIVAL_SKILLS, SKILL_KEYS, SKILL_STORAGE_KEY, winTargetFor,
} from "../../src/iso/skill";
import { chooseRivalOffer } from "../../src/iso/market";
import { createScoreState, hasWon } from "../../src/iso/victory";
import { deepPlanCandidates, planCandidates } from "../../src/iso/ai";
import { createTrack, buildTile, tIdx } from "../../src/iso/track";
import { isServiced, type EconomyState, type Factory } from "../../src/iso/economy";
import { generateMap } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";

describe("AI-01 difficulty resolution", () => {
  const store = (v: string | null): Pick<Storage, "getItem"> => ({
    getItem: (k: string) => (k === SKILL_STORAGE_KEY ? v : null),
  });

  it("every preset key round-trips and the clock ladder is real", () => {
    expect(SKILL_KEYS).toEqual(["easy", "normal", "hard"]);
    for (const k of SKILL_KEYS) expect(RIVAL_SKILLS[k].key).toBe(k);
  });

  it("url beats storage beats the default, and garbage falls through", () => {
    expect(resolveSkillKey("?rival=hard", store("easy"))).toBe("hard");
    expect(resolveSkillKey("?rival=easy", null)).toBe("easy");
    expect(resolveSkillKey("rival=normal", null)).toBe("normal");
    expect(resolveSkillKey("?rival=nonsense", store("easy"))).toBe("easy");
    expect(resolveSkillKey("", store("hard"))).toBe("hard");
    expect(resolveSkillKey("?seed=1337", store("junk"))).toBe("normal");
    expect(resolveSkillKey("", null)).toBe("normal");
    expect(resolveSkillKey(undefined, null)).toBe("normal");
  });
});

// AI-04 — the difficulty now owns the finish line, not just the pacing.
describe("AI-04 the difficulty owns the win line", () => {
  it("easy races a short 5★ line; normal and hard alias the shipped one", () => {
    expect(winTargetFor("easy")).toBe(5);
    // aliased, not retyped: if `VICTORY.target` ever moves again the other two
    // presets move with it and only easy stays the short race.
    expect(winTargetFor("normal")).toBe(VICTORY.target);
    expect(winTargetFor("hard")).toBe(VICTORY.target);
    for (const k of SKILL_KEYS) {
      expect(RIVAL_SKILLS[k].winTarget).toBe(winTargetFor(k));
      expect(RIVAL_SKILLS[k].winTarget).toBeGreaterThan(0);
    }
  });

  it("hasWon honours the line it is given and still defaults to the shipped one", () => {
    const score = createScoreState();
    score.vp.set("you", winTargetFor("easy"));        // 5★
    // on the easy chair that is the whole race…
    expect(hasWon(score, "you", winTargetFor("easy"))).toBe(true);
    // …and on any other chair it is exactly half of it.
    expect(hasWon(score, "you")).toBe(false);
    expect(hasWon(score, "you", VICTORY.target)).toBe(false);
    score.vp.set("you", VICTORY.target);
    expect(hasWon(score, "you")).toBe(true);
    expect(hasWon(score, "you", winTargetFor("easy"))).toBe(true);
  });
});

describe("AI-01 the rival's market offer", () => {
  it("posts the bank's own deal, spoken out loud: 4 of surplus for 2 of need", () => {
    const idea = chooseRivalOffer({ wood: 20, ore: 0 }, { ore: 4 })!;
    expect(idea).toEqual({ give: "wood", giveN: 4, want: "ore", wantN: 2 });
    // strictly better than the 4:1 bank for the poster, never worse for the taker
    expect(idea.giveN).toBeGreaterThanOrEqual(idea.wantN);
    expect(idea.giveN).toBeLessThanOrEqual(4);
  });

  it("offers nothing when the plan is funded, and never touches Gold", () => {
    expect(chooseRivalOffer({ ore: 4 }, { ore: 4 })).toBeNull();
    expect(chooseRivalOffer({ wood: 10, stone: 10 }, {})).toBeNull();
    // a mountain of Gold is not a surplus: construction spends no Gold
    expect(chooseRivalOffer({ gold: 50, wood: 1 }, { ore: 2 })).toBeNull();
    // …and it never asks for what it is offering (no wash trades)
    const idea = chooseRivalOffer({ wood: 12, stone: 1 }, { stone: 3, wood: 0 });
    expect(idea).not.toBeNull();
    expect(idea!.give).not.toBe(idea!.want);
  });

  it("keeps the bank's lot in reserve — the deadlock the race autopsy found", () => {
    // The plan needs 5 Wood; the purse holds 9. Selling 3 Wood for Grain is a
    // GOOD deal vs the bank's 4:1 — but the bank itself only fires at
    // stock ≥ need + BANK_RATE (= 9), and an escrowed offer on the slice
    // between would pin the purse under the trigger forever. The offer must
    // leave need + BANK_RATE untouched, so here it may not post at all.
    expect(chooseRivalOffer({ wood: 9, ore: 0 }, { wood: 5, grain: 1, oil: 1 })).toBeNull();
    // one more Wood and the genuinely spare units exist: 10 − 5 − 4 = 1…
    // still under the 2-unit lot minimum, so still null;
    expect(chooseRivalOffer({ wood: 10, ore: 0 }, { wood: 5, grain: 1 })).toBeNull();
    // …and at 11 the spare pair is real and the offer leaves 9 in hand.
    const idea = chooseRivalOffer({ wood: 11, ore: 0 }, { wood: 5, grain: 1 })!;
    expect(idea.give).toBe("wood");
    expect(idea.giveN).toBe(2);
    expect(11 - idea.giveN).toBe(5 + BANK_RATE);
  });

  it("asks for the cargo the plan is shortest of, deterministically", () => {
    const a = chooseRivalOffer({ wood: 30 }, { stone: 6, ore: 6 });
    const b = chooseRivalOffer({ wood: 30 }, { stone: 6, ore: 6 });
    expect(a).toEqual(b);
    // ties break by CARGOES order — ore precedes stone there
    expect(CARGOES.indexOf(a!.want)).toBeLessThan(CARGOES.indexOf("stone"));
    expect(a!.want).toBe("ore");
  });
});

describe("AI-01 the memoized deep plan", () => {
  const DEEP = Object.fromEntries(
    [...CARGOES, "gold"].map((c) => [c, MAP_W * MAP_H]),
  ) as never;

  it("answers exactly what the raw deep-purse search answers", () => {
    const grid = generateMap(1337);
    const track = createTrack();
    const eco: EconomyState = { grid, track, harvesters: [], factories: [] };
    const f: Factory = { owner: "you", ownerId: 1, tx: 60, ty: 60, id: 0, townId: null };
    const fast = deepPlanCandidates(eco, f, { stock: {}, free: 12, freeDepots: 2 });
    const raw = planCandidates(eco, f, {
      stock: {}, purse: DEEP, free: 12, freeDepots: 2,
    });
    expect(fast.length).toBe(raw.length);
    for (let i = 0; i < raw.length; i++) {
      expect(fast[i].hx).toBe(raw[i].hx);
      expect(fast[i].hy).toBe(raw[i].hy);
      expect(fast[i].cost).toEqual(raw[i].cost);
      expect(fast[i].score).toBeCloseTo(raw[i].score, 10);
    }
  });

  it("caches against the world: same array until a build moves, fresh after", () => {
    const grid = generateMap(1337);
    const track = createTrack();
    const eco: EconomyState = { grid, track, harvesters: [], factories: [] };
    const f: Factory = { owner: "you", ownerId: 1, tx: 60, ty: 60, id: 0, townId: null };
    const first = deepPlanCandidates(eco, f, {});
    const second = deepPlanCandidates(eco, f, {});
    expect(second).toBe(first);                       // identity: no re-search
    expect(buildTile(track, "dirt", f.tx - 1, f.ty, 1)).toBeTruthy();
    const moved = deepPlanCandidates(eco, f, {});
    expect(moved).not.toBe(first);                    // the fingerprint moved
    expect(eco.harvesters.length).toBe(0);
    void isServiced;
  });

  it("the free allowances are part of the cache key", () => {
    const grid = generateMap(1337);
    const track = createTrack();
    const eco: EconomyState = { grid, track, harvesters: [], factories: [] };
    const f: Factory = { owner: "you", ownerId: 1, tx: 60, ty: 60, id: 0, townId: null };
    const a = deepPlanCandidates(eco, f, { free: 12, freeDepots: 2 });
    // a different allowance is a different question — the priced track cost
    // moves with it, so it must NOT come back out of the same slot
    const b = deepPlanCandidates(eco, f, { free: 0, freeDepots: 0 });
    expect(b).not.toBe(a);
    // …and the same question asked twice in a row still hits the cache
    expect(deepPlanCandidates(eco, f, { free: 0, freeDepots: 0 })).toBe(b);
    void tIdx;
  });
});
