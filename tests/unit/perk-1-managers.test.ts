// ══════════════════════════════════════════════════════════════════════════
// PERK-1 (#600) — the five perks per manager, pinned perk by perk.
//
// One test per named perk (25) + the quirks, against the named seams the
// game reads (src/iso/managers.ts), plus the null-seat behaviour (the AI
// rival, a boot without a manager) and the story layer's display rows.
// CAST-1/CAST-2's money pins live in cast-managers.test.ts; this file is
// the PERK-1 roster only.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import {
  FIXER_WINDOW_MS, MANAGER_IDS, MANAGER_PERKS, battlePerksOf, buyMovesOffer,
  fixerLeft, fleetUpgradePrice, freshFixer, perkLines, perkPrice, perksOf,
  returnToSenderOf, sabotageGold, sabotageTilesBonus, securityCost,
  sessionExtraMoves, trainSpeedOf, truckSpeedOf, tuningScore,
} from "../../src/iso/managers";
import { MANAGERS } from "../../src/story/managers";

// ── the shape of the table ────────────────────────────────────────────────
describe("PERK-1 the table", () => {
  it("every manager lists exactly five perks + one quirk, quirk last", () => {
    for (const id of MANAGER_IDS) {
      const rows = MANAGER_PERKS[id];
      expect(rows).toHaveLength(6);
      expect(rows.filter((p) => p.quirk)).toHaveLength(1);
      expect(rows[5].quirk).toBe(true);
      expect(rows.slice(0, 5).every((p) => !p.quirk)).toBe(true);
      // The ids are the pruner's handle — unique across the whole book.
      expect(new Set(rows.map((p) => p.id)).size).toBe(6);
    }
    const allIds = MANAGER_IDS.flatMap((id) => MANAGER_PERKS[id].map((p) => p.id));
    expect(new Set(allIds).size).toBe(30);
  });

  it("the story layer prints the same rows (profile card + picker)", () => {
    for (const m of MANAGERS) {
      expect(m.perks).toEqual(perkLines(m.id));
    }
  });

  it("null/unknown seats read the blank row everywhere", () => {
    for (const seat of [null, undefined]) {
      expect(perkLines(seat)).toEqual([]);
      expect(battlePerksOf(seat)).toBeNull();
      expect(buyMovesOffer(seat)).toBeNull();
      expect(sessionExtraMoves(seat)).toBe(0);
      expect(sabotageTilesBonus(seat)).toBe(0);
      expect(returnToSenderOf(seat)).toBe(false);
      expect(truckSpeedOf(seat)).toBe(1);
      expect(trainSpeedOf(seat)).toBe(1);
      expect(perkPrice(100, seat, "road")).toBe(100);
      expect(fleetUpgradePrice(200, seat, "truck")).toBe(200);
      expect(fixerLeft(freshFixer(), seat, 0)).toBe(0);
    }
  });
});

// ── James Calloway, the Road Man ─────────────────────────────────────────
describe("PERK-1 James", () => {
  it("Road Crew: every road lays 25% cheaper", () => {
    expect(perkPrice(100, "james", "road")).toBe(75);
    // The classes James does NOT touch: his other perks price depot/level,
    // the quirk prices rail — platform and trainDepot stay at base.
    for (const cls of ["platform", "trainDepot"] as const)
      expect(perkPrice(100, "james", cls)).toBe(100);
  });
  it("Yard Deal: the Depot bill is 10% cheaper", () => {
    expect(perkPrice(100, "james", "depot")).toBe(90);
  });
  it("Lead Foot: his Depot trucks drive 20% faster; trains are untouched", () => {
    expect(truckSpeedOf("james")).toBeCloseTo(1.2);
    expect(trainSpeedOf("james")).toBe(1);
  });
  it("Earthmover: Level Ground is 20% cheaper", () => {
    expect(perkPrice(100, "james", "level")).toBe(80);
  });
  it("Fleet Discount: truck upgrades cost 15% less (train upgrades untouched)", () => {
    expect(fleetUpgradePrice(200, "james", "truck")).toBe(170);
    expect(fleetUpgradePrice(200, "james", "train")).toBe(200);
  });
  it("Quirk — Rail Skeptic: rail track costs 10% more", () => {
    expect(perkPrice(100, "james", "rail")).toBe(110);
  });
});

// ── Anne Whitfield, the Station Master ───────────────────────────────────
describe("PERK-1 Anne", () => {
  it("Iron Rails: rail track lays 25% cheaper", () => {
    expect(perkPrice(100, "anne", "rail")).toBe(75);
  });
  it("Station Master: platforms and station lanes cost 10% less", () => {
    expect(perkPrice(100, "anne", "platform")).toBe(90);
  });
  it("Express: her trains run 20% faster; trucks are untouched", () => {
    expect(trainSpeedOf("anne")).toBeCloseTo(1.2);
    expect(truckSpeedOf("anne")).toBe(1);
  });
  it("Shed Deal: Train Depots cost 10% less", () => {
    expect(perkPrice(100, "anne", "trainDepot")).toBe(90);
  });
  it("Loco Works: train upgrades cost 15% less (truck upgrades untouched)", () => {
    expect(fleetUpgradePrice(200, "anne", "train")).toBe(170);
    expect(fleetUpgradePrice(200, "anne", "truck")).toBe(200);
  });
  it("Quirk — Lorry Doubt: road ways cost 10% more", () => {
    expect(perkPrice(100, "anne", "road")).toBe(110);
  });
});

// ── Rafael Vega, the Fixer ───────────────────────────────────────────────
describe("PERK-1 Rafael", () => {
  it("Connections: 4 free sabotage cards per 5-minute window, nobody else's", () => {
    expect(fixerLeft(freshFixer(), "rafael", 0)).toBe(4);
    expect(perksOf("rafael").freeBlack).toBe(4);
    for (const id of MANAGER_IDS) if (id !== "rafael") expect(fixerLeft(freshFixer(), id, 0)).toBe(0);
    // The window is 5 minutes of play.
    expect(FIXER_WINDOW_MS).toBe(5 * 60_000);
  });
  it("Friends Price: sabotage costs 25% less Gold", () => {
    expect(sabotageGold(100, "rafael")).toBe(75);
  });
  it("Overtime Crew: buy 3 extra moves for 8 Gold, once per session", () => {
    expect(buyMovesOffer("rafael")).toEqual({ gold: 8, uses: 1 });
  });
  it("Sucker Punch: the battle seat gets one extra turn, once per battle", () => {
    expect(battlePerksOf("rafael")).toEqual({ extraTurnOnce: true });
  });
  it("Heavy Hands: his own Frost and Girders land one extra tile", () => {
    expect(sabotageTilesBonus("rafael")).toBe(1);
    for (const id of MANAGER_IDS) if (id !== "rafael") expect(sabotageTilesBonus(id)).toBe(0);
  });
  it("Quirk — Guards Price: Security Forces cost 50% more", () => {
    expect(securityCost({ grain: 6, stone: 3 }, "rafael")).toEqual({ grain: 9, stone: 5 });
  });
});

// ── Dolores Marchetti, the Quiet Money ───────────────────────────────────
describe("PERK-1 Dolores", () => {
  it("Private Guard: Security Forces are free", () => {
    expect(securityCost({ grain: 6, stone: 3 }, "dolores")).toEqual({});
  });
  it("Stamina: 3 extra moves in every tuning session, nobody else's", () => {
    expect(sessionExtraMoves("dolores")).toBe(3);
    for (const id of MANAGER_IDS) if (id !== "dolores") expect(sessionExtraMoves(id)).toBe(0);
  });
  it("Bulk Buyer: buy 3 extra moves for 4 Gold, twice per session", () => {
    expect(buyMovesOffer("dolores")).toEqual({ gold: 4, uses: 2 });
    // Rafael is the only other buyer — and his offer is the 8 ×1 one.
    for (const id of MANAGER_IDS) if (id !== "dolores" && id !== "rafael") expect(buyMovesOffer(id)).toBeNull();
  });
  it("Momentum: a match of 4 earns an extra turn in rival battles", () => {
    expect(battlePerksOf("dolores")).toEqual({ extraTurnMinMatch: 4 });
  });
  it("Return to Sender: the first sabotage played on her bounces back", () => {
    expect(returnToSenderOf("dolores")).toBe(true);
    for (const id of MANAGER_IDS) if (id !== "dolores") expect(returnToSenderOf(id)).toBe(false);
  });
  it("Quirk — Quiet Money: her sabotage costs 10% more Gold", () => {
    expect(sabotageGold(15, "dolores")).toBe(17);
  });
});

// ── Kenji Sato, the Showman ──────────────────────────────────────────────
describe("PERK-1 Kenji", () => {
  it("Shortcut: the board mints shortcut specials, capped at 3 free lines", () => {
    expect(perksOf("kenji").shortcut).toBe(true);
    expect(perksOf("kenji").shortcutLineCap).toBe(3);
    for (const id of MANAGER_IDS) if (id !== "kenji") {
      expect(perksOf(id).shortcut).toBe(false);
      expect(perksOf(id).shortcutLineCap).toBe(0);
    }
  });
  it("Showman: tuning sessions score 25% more (PERK-1's 1.25, not CAST-2's 1.2)", () => {
    expect(tuningScore(1000, "kenji")).toBe(1250);
    for (const id of MANAGER_IDS) if (id !== "kenji") expect(tuningScore(1000, id)).toBe(1000);
  });
  it("Opening Act: every session starts with a disco ball", () => {
    expect(perksOf("kenji").startingSpecial).toBe("disco");
    for (const id of MANAGER_IDS) if (id !== "kenji") expect(perksOf(id).startingSpecial).toBeNull();
  });
  it("Encore: one bonus turn at the end of every round", () => {
    expect(battlePerksOf("kenji")).toEqual({ bonusTurnPerRound: true });
  });
  it("Second Sight: the hint shows the best move and one reshuffle is free", () => {
    expect(perksOf("kenji").secondSight).toBe(true);
    for (const id of MANAGER_IDS) if (id !== "kenji") expect(perksOf(id).secondSight).toBe(false);
  });
  it("Quirk — Stage Fright: Level Ground costs 25% more", () => {
    expect(perkPrice(100, "kenji", "level")).toBe(125);
  });
});
