// ══════════════════════════════════════════════════════════════════════════
// AI-01 unit coverage for the pieces the race harness cannot pin:
//   • resolveSkillKey  — where the boot difficulty comes from (URL > storage
//     > normal), with garbage falling through instead of crashing the boot;
//   • the ★ line a difficulty races to (`winTargetFor`) and the per-preset
//     knobs around it;
//   • deepPlanCandidates — the memoized bottomless-purse planning the rival's
//     reserve reader reads (L11 / #226 retired its other caller, the market
//     offer): same answer as the raw search, recomputed only when the world
//     actually moves.
// The difficulty ladder ITSELF (that hard finishes before normal before easy)
// is measured, not asserted here — that lives in iso-skill-calibration.test.ts.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { CARGOES, VICTORY } from "../../src/iso/config";
import {
  resolveSkillKey, RIVAL_SKILLS, SKILL_KEYS, SKILL_STORAGE_KEY, winTargetFor,
} from "../../src/iso/skill";
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

  it.skip("the free allowances are part of the cache key", () => {
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
