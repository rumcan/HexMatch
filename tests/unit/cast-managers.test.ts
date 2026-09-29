// ══════════════════════════════════════════════════════════════════════════
// CAST-1 — the managers' rulebook (src/iso/managers.ts) and the hire record
// (src/story/managers.ts). docs/CAST.md is the table these pin.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import {
  FIXER_WINDOW_MS, FRESH_RECORD, MANAGER_IDS, buildMultiplier, effectiveBalance, fixerLeft, fixerRefillIn,
  isUnlocked, managerOrNull, normalizeManager, perkPrice, perksOf, readRecord, recordOutcome, sabotageGold,
  securityCost, spendFixer, tuningScore, type FixerState,
} from "../../src/iso/managers";
import { MANAGERS, loadManagerRecord, recordManagerMatch, savedManager, CAST_KEY } from "../../src/story/managers";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
};

describe("CAST-1 perks", () => {
  it("James: Road Ways 25% off, Rail Ways 10% dearer", () => {
    expect(perkPrice(100, "james", "road")).toBe(75);
    expect(perkPrice(100, "james", "rail")).toBe(110);
    expect(perkPrice(100, "james", "other")).toBe(100);
  });
  it("Anne: Rail Ways 25% off, Road Ways 10% dearer", () => {
    expect(perkPrice(120, "anne", "rail")).toBe(90);
    expect(perkPrice(120, "anne", "road")).toBe(132);
  });
  it("Kenji: tuning +25% (PERK-1 #600 raised the Showman from +20%), levelling +25%", () => {
    expect(tuningScore(1000, "kenji")).toBe(1250);
    expect(tuningScore(1000, "james")).toBe(1000);
    expect(perkPrice(40, "kenji", "level")).toBe(50);
  });
  it("no manager (the AI rival, a bare boot) pays base everywhere", () => {
    for (const cls of ["road", "rail", "level", "other"] as const) expect(buildMultiplier(null, cls)).toBe(1);
    expect(sabotageGold(15, null)).toBe(15);
    expect(securityCost({ grain: 6, stone: 3 }, null)).toEqual({ grain: 6, stone: 3 });
    expect(tuningScore(777, null)).toBe(777);
  });
  it("Dolores: Security Forces are free; sabotage costs 10% more Gold", () => {
    expect(securityCost({ grain: 6, stone: 3 }, "dolores")).toEqual({});
    expect(sabotageGold(15, "dolores")).toBe(17);
    expect(sabotageGold(18, "dolores")).toBe(20);
  });
  it("Rafael: Security Forces cost 50% more", () => {
    expect(securityCost({ grain: 6, stone: 3 }, "rafael")).toEqual({ grain: 9, stone: 5 });
  });
  it("CAST-2 (#558): Rafael, Dolores and Kenji each edge out the starting pair", () => {
    // The starters' headline is a 25% class discount. The unlockables were a
    // touch weaker, so #558 buffed the perk or softened the quirk — modestly,
    // and never past the starters' 25% ceiling, so hiring one is a reward.
    expect(perksOf("rafael").freeBlack).toBe(4);        // was 3 free cards a window
    expect(perksOf("dolores").sabotageGold).toBeCloseTo(1.1); // was a +20% surcharge
    // PERK-1 (#600): the Showman is the named perk now — 1.25, overriding
    // CAST-2's 1.2. The ceiling check below still holds.
    expect(perksOf("kenji").tuning).toBeCloseTo(1.25); // was a +10% bonus (CAST-2: +20%)
    expect(Math.abs(perksOf("kenji").tuning - 1)).toBeLessThanOrEqual(0.25);
    // James and Anne are untouched.
    expect(perkPrice(100, "james", "road")).toBe(75);
    expect(perkPrice(120, "anne", "rail")).toBe(90);
  });
  it("the preview balance never promises more than the charge can take", () => {
    for (const id of MANAGER_IDS) for (const cls of ["road", "rail", "level"] as const) {
      for (let money = 0; money < 400; money += 7.3) for (let base = 1; base < 300; base += 11) {
        if (base <= effectiveBalance(money, id, cls)) expect(perkPrice(base, id, cls)).toBeLessThanOrEqual(money);
      }
    }
  });
});

describe("CAST-1 Rafael's Fixer allowance", () => {
  it("gives 4 free cards per 5 minutes of play, refilled (never stacked)", () => {
    let s: FixerState | null = null;
    for (let i = 0; i < 4; i++) {
      expect(fixerLeft(s, "rafael", 10_000)).toBe(4 - i);
      s = spendFixer(s, "rafael", 10_000);
      expect(s).not.toBeNull();
    }
    expect(fixerLeft(s, "rafael", 10_000)).toBe(0);
    expect(spendFixer(s, "rafael", 10_000)).toBeNull();
    // still the same window just before the refill
    expect(fixerLeft(s, "rafael", FIXER_WINDOW_MS - 1)).toBe(0);
    expect(fixerRefillIn(FIXER_WINDOW_MS - 1)).toBe(1);
    // the next window: a full four, no carry-over
    expect(fixerLeft(s, "rafael", FIXER_WINDOW_MS)).toBe(4);
    expect(fixerLeft(null, "rafael", FIXER_WINDOW_MS * 7)).toBe(4);
  });
  it("is Rafael's alone", () => {
    for (const id of ["james", "anne", "dolores", "kenji", null] as const) {
      expect(fixerLeft(null, id, 0)).toBe(0);
      expect(spendFixer(null, id, 0)).toBeNull();
    }
  });
});

describe("CAST-1 legacy portraits", () => {
  it("maps old saves' vex/you to Anne/James", () => {
    expect(normalizeManager("vex")).toBe("anne");
    expect(normalizeManager("you")).toBe("james");
    expect(normalizeManager("kenji")).toBe("kenji");
    expect(normalizeManager("torvin")).toBe("anne");
    expect(normalizeManager(undefined)).toBe("anne");
    expect(managerOrNull(undefined)).toBeNull();
    expect(managerOrNull("you")).toBe("james");
  });
  it("savedManager reads the legacy key and refuses a locked pick", () => {
    const s = mem();
    s.setItem(CAST_KEY, "you");
    expect(savedManager(s)).toBe("james");
    s.setItem(CAST_KEY, "kenji");
    expect(savedManager(s)).toBe("anne");
  });
});

describe("CAST-1 unlocks (earned by play)", () => {
  it("starts with James and Anne hired", () => {
    expect(MANAGERS.map((m) => m.id)).toEqual(MANAGER_IDS);
    expect(MANAGER_IDS.filter((id) => isUnlocked(FRESH_RECORD, id))).toEqual(["james", "anne"]);
  });
  it("hires Rafael on the first win, Dolores on a Normal+ win, Kenji on 3 wins", () => {
    let r = FRESH_RECORD;
    let out = recordOutcome(r, { won: true, skill: "easy", multiplayer: false, scenario: false });
    expect(out.hired).toEqual(["rafael"]);
    r = out.record;
    out = recordOutcome(r, { won: true, skill: "normal", multiplayer: false, scenario: false });
    expect(out.hired).toEqual(["dolores"]);
    r = out.record;
    out = recordOutcome(r, { won: true, skill: "easy", multiplayer: false, scenario: false });
    expect(out.hired).toEqual(["kenji"]);
    expect(recordOutcome(out.record, { won: true, skill: "hard", multiplayer: false, scenario: false }).hired).toEqual([]);
  });
  it("hires Kenji on any Scenario win; a loss and the tutorial count for nothing", () => {
    expect(recordOutcome(FRESH_RECORD, { won: false, skill: "hard", multiplayer: false, scenario: true }).hired).toEqual([]);
    expect(recordOutcome(FRESH_RECORD, { won: true, skill: "trainee", multiplayer: false, scenario: false, tutorial: true }).hired).toEqual([]);
    expect(recordOutcome(FRESH_RECORD, { won: true, skill: "easy", multiplayer: false, scenario: true }).hired)
      .toEqual(["rafael", "kenji"]);
    expect(recordOutcome(FRESH_RECORD, { won: true, skill: null, multiplayer: true, scenario: false }).hired)
      .toEqual(["rafael", "dolores"]);
  });
  it("persists in localStorage and survives corruption", () => {
    const s = mem();
    expect(recordManagerMatch({ won: true, skill: "normal", multiplayer: false, scenario: false }, s)).toEqual(["rafael", "dolores"]);
    expect(loadManagerRecord(s).unlocked).toEqual(["james", "anne", "rafael", "dolores"]);
    s.setItem("hexmatch:managers", "{nope");
    expect(loadManagerRecord(s).unlocked).toEqual(["james", "anne"]);
    expect(readRecord({ wins: -3, unlocked: ["kenji", "bogus"] }).unlocked).toEqual(["james", "anne", "kenji"]);
  });
});
