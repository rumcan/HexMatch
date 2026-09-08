// ══════════════════════════════════════════════════════════════════════════
// PP-07 — one authoritative cost table.
//
// Acceptance: "All costs come from one authoritative table used by the UI,
// gameplay and AI." These tests pin the table itself (`construction.ts`
// BUILD_COSTS) and prove that every consumer — `tileCost` in track.ts (human
// drag + rival alike), PLANT_COST in plants.ts, `priceDepot` for the Depot
// charge in game.ts/ai.ts — reads THAT table, so a price can be changed in
// exactly one place.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi } from "vitest";

// The boot module imports the atlas PNGs; stub them so the tuning constants
// (START_PURSE, FREE_SETUP_TRACK) can be read without a bundler.
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

import {
  BUILD_COSTS, DEPOT_COST, FREE_SETUP_DEPOTS, priceDepot,
} from "../../src/iso/construction";
import { CARGOES } from "../../src/iso/config";
import { PLANT_COST } from "../../src/iso/plants";
import { START_PURSE, FREE_SETUP_TRACK } from "../../src/iso/game";
import { canAfford, createTrack, tileCost } from "../../src/iso/track";

describe("PP-07 the ticket's suggested first playtest costs", () => {
  it("prices the five purchases exactly as the table proposes", () => {
    expect(BUILD_COSTS.road).toEqual({ wood: 1, stone: 1 });
    expect(BUILD_COSTS.rail).toEqual({ wood: 1, stone: 1, ore: 4 });
    expect(BUILD_COSTS.upgrade).toEqual({ ore: 4 });
    expect(BUILD_COSTS.depot).toEqual({ wood: 1, stone: 1, grain: 1, oil: 1 });
    expect(BUILD_COSTS.plant).toEqual({ wood: 2, stone: 2, grain: 2, ore: 3 });
  });

  it("the in-place upgrade is the difference, so upgrading never double-pays", () => {
    // rail = road + the upgrade difference (wood/stone already in the ground)
    for (const [cargo, v] of Object.entries(BUILD_COSTS.upgrade)) {
      expect(BUILD_COSTS.rail[cargo as keyof typeof BUILD_COSTS.rail]).toBe(v);
    }
  });
});

describe("PP-07 one table feeds every consumer", () => {
  it("the in-game tile charge IS the table entry (human drag and AI alike)", () => {
    // `tileCost` is the single function `previewDrag` (the human) and
    // `planCandidates`/`executeCandidate` (the rival) both ask — and it reads
    // the table at call time, so there is no second number to drift.
    const t = createTrack();
    expect(tileCost(t, "road", 3, 3)).toEqual(BUILD_COSTS.road);
    expect(tileCost(t, "rail", 3, 3)).toEqual(BUILD_COSTS.rail);
    expect(tileCost(t, "rail", 3, 3).ore).toBe(4);
  });

  it("PLANT_COST is the table's plant entry", () => {
    expect(PLANT_COST).toEqual(BUILD_COSTS.plant);
  });

  it("the Depot charge is the table's depot entry — after the free first one", () => {
    const deep = { wood: 9, stone: 9, grain: 9, oil: 9 };
    // the setup allowance makes the FIRST Depot free…
    expect(FREE_SETUP_DEPOTS).toBe(1);
    expect(priceDepot(deep, FREE_SETUP_DEPOTS).cost).toEqual({});
    expect(priceDepot(deep, FREE_SETUP_DEPOTS).free).toBe(true);
    // …every Depot after it pays the table's depot entry
    expect(priceDepot(deep, 0).cost).toEqual(BUILD_COSTS.depot);
    expect(priceDepot(deep, 0).free).toBe(false);
    expect(DEPOT_COST).toEqual(BUILD_COSTS.depot);
    // the price returns a COPY — spending it can never mutate the table
    const c = priceDepot(deep, 0).cost;
    c.wood = 999;
    expect(BUILD_COSTS.depot.wood).toBe(1);
  });

  it("priceDepot names exactly the cargoes the purse is short of", () => {
    const p = priceDepot({ wood: 1, stone: 1 }, 0);
    expect(p.affordable).toBe(false);
    expect(p.missing).toEqual(["grain", "oil"]);   // CARGOES order
    expect(priceDepot({ wood: 1, stone: 1, grain: 1, oil: 1 }, 0).affordable).toBe(true);
    // the free allowance makes an EMPTY purse affordable — the opening works
    expect(priceDepot({}, FREE_SETUP_DEPOTS).affordable).toBe(true);
  });
});

describe("PP-07 Catan-style resource roles", () => {
  const constructionRoles = new Set<string>();
  for (const cost of Object.values(BUILD_COSTS)) {
    for (const cargo of Object.keys(cost)) constructionRoles.add(cargo);
  }

  it("every normal resource has a useful construction role", () => {
    for (const cargo of ["wood", "stone", "grain", "ore", "oil"]) {
      expect(constructionRoles.has(cargo), `${cargo} builds nothing`).toBe(true);
    }
  });

  it("Gold builds nothing — it stays reserved for Black Market sabotage (PP-08)", () => {
    expect(constructionRoles.has("gold")).toBe(false);
    for (const [key, cost] of Object.entries(BUILD_COSTS)) {
      expect(cost.gold, `${key} costs gold`).toBeUndefined();
    }
  });
});

describe("PP-07 the opening can never deadlock on its own costs", () => {
  it("the first Depot is free — Oil needs a Depot, so a paid first Depot would loop", () => {
    expect(BUILD_COSTS.depot.oil).toBeGreaterThan(0);      // later Depots gate on Oil…
    expect(priceDepot({}, FREE_SETUP_DEPOTS).cost).toEqual({}); // …the first never pays it
  });

  it("the setup allowance still rides road only, and covers the first connection", () => {
    expect(FREE_SETUP_TRACK).toBeGreaterThanOrEqual(12);
    // road is the only transport the allowance may buy (W9 gate, unchanged)
    expect(canAfford(START_PURSE, BUILD_COSTS.rail)).toBe(false); // no ore at spawn
    expect(START_PURSE.ore ?? 0).toBe(0);
  });

  it("a missing construction resource is manufacturable — no endless dependency loop", () => {
    // Every construction cargo is a match-3 cargo the Processing Plant can
    // pay (reach + tokens) and a bank-tradeable good, so a player who lacks
    // one can always earn or 4:1-bank their way into the next purchase.
    for (const cargo of Object.keys(BUILD_COSTS.depot)) {
      expect(CARGOES).toContain(cargo);
    }
    for (const cargo of Object.keys(BUILD_COSTS.plant)) {
      expect(CARGOES).toContain(cargo);
    }
  });
});
