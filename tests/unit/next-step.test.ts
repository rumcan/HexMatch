// GOAL-1 (#459): unit tests for the pure `nextStep` advisor — scripted states,
// no game boot, every rule in the priority list.
import { describe, expect, it } from "vitest";
import { IDLE_MONEY_THRESHOLD, nextStep, type NextStepInput } from "../../src/iso/next-step";
import { TOWN_UPGRADES } from "../../src/iso/config";
import { storageCapFor } from "../../src/iso/construction";
import type { Factory, Harvester } from "../../src/iso/economy";
import type { Industry, Town } from "../../src/iso/grid";

// ── fixtures ──────────────────────────────────────────────────────────────
const town = (id: number, tx: number, ty: number): Town => ({
  id, tx, ty, houses: [], roads: [],
});
const industry = (id: number, type: string, tx: number, ty: number): Industry => ({
  id, type, tx, ty, w: 2, h: 2, output: 1, banditUntil: 0,
});
const factory = (owner: string, tx: number, ty: number): Factory => ({
  owner, ownerId: owner === "p1" ? 1 : 2, tx, ty,
});
const depot = (id: number, owner: string, tx: number, ty: number, closed = false): Harvester => ({
  id, owner, ownerId: owner === "p1" ? 1 : 2, tx, ty, closed,
});

const BASE: NextStepInput = {
  phase: "play",
  playerId: "p1",
  factories: [factory("p1", 20, 20)],
  harvesters: [],
  industries: [industry(0, "farm", 30, 30)],
  towns: [town(0, 22, 22)],
  isConnected: () => true,
  money: 0,
  purse: { wood: 0, stone: 0, ore: 0, grain: 0, coal: 0, gold: 0 },
  freeDepots: 1,
  depotTier: 0,
  townLevel: 0,
  marketPrices: null,
  tuning: null,
  activeContract: null,
  contestedIndustry: null,
  winTarget: 10,
  newLoop: true,
};

describe("GOAL-1 nextStep priority list", () => {
  it("1. No Factory → place Factory beside a town", () => {
    const r = nextStep({ ...BASE, factories: [] });
    expect(r.key).toBe("place-factory");
    expect(r.text).toContain("Factory");
    expect(r.tool).toBe("plant");
    expect(r.target).not.toBeNull();
  });

  it("1b. setup-factory phase overrides everything", () => {
    const r = nextStep({ ...BASE, phase: "setup-factory", harvesters: [depot(1, "p1", 30, 30)] });
    expect(r.key).toBe("place-factory");
    expect(r.tool).toBe("plant");
  });

  it("2. No Depot → claim an industry", () => {
    const r = nextStep({ ...BASE, harvesters: [] });
    expect(r.key).toBe("place-depot");
    expect(r.text).toContain("Depot");
    expect(r.tool).toBe("harvester");
    expect(r.target).not.toBeNull();
  });

  it("2b. setup-harvester phase says claim an industry even if there are closed Depots", () => {
    const r = nextStep({
      ...BASE,
      phase: "setup-harvester",
      // A closed Depot (lost territorial fight) does NOT count as having one.
      harvesters: [depot(1, "p1", 28, 28, true)],
    });
    expect(r.key).toBe("place-depot");
    expect(r.tool).toBe("harvester");
  });

  it("3. Disconnected Depot → connect with a road", () => {
    const d = depot(1, "p1", 28, 28);
    const r = nextStep({
      ...BASE,
      harvesters: [d],
      isConnected: (h) => h !== d,
    });
    expect(r.key).toBe("connect-depot");
    expect(r.text).toContain("road");
    expect(r.tool).toBe("road");
    expect(r.target).toEqual({ tx: d.tx + 1, ty: d.ty + 1 });
  });

  it("4. Idle money + stockpile → sell at Market", () => {
    const cap = storageCapFor(0);
    const r = nextStep({
      ...BASE,
      harvesters: [depot(1, "p1", 28, 28)],
      money: IDLE_MONEY_THRESHOLD + 50,
      purse: { wood: 0, stone: 0, ore: 0, grain: cap, coal: 0, gold: 0 },
      marketPrices: { grain: 42 },
    });
    expect(r.key).toBe("sell-grain");
    expect(r.text).toMatch(/sell at the market/i);
    expect(r.text).toContain("Grain");
    expect(r.tool).toBe("market");
  });

  it("4b. Below money threshold or no cap → does not fire", () => {
    const cap = storageCapFor(0);
    const noMoney = nextStep({
      ...BASE,
      harvesters: [depot(1, "p1", 28, 28)],
      money: 5,
      purse: { wood: 0, stone: 0, ore: 0, grain: cap, coal: 0, gold: 0 },
      marketPrices: { grain: 42 },
    });
    expect(noMoney.key).not.toBe("sell-grain");
    const noStock = nextStep({
      ...BASE,
      harvesters: [depot(1, "p1", 28, 28)],
      money: IDLE_MONEY_THRESHOLD + 100,
      purse: { wood: 0, stone: 0, ore: 0, grain: 0, coal: 0, gold: 0 },
      marketPrices: { grain: 42 },
    });
    expect(noStock.key).not.toBe("sell-grain");
  });

  it("5. Active contract fires when present (below sell priority per spec)", () => {
    const r = nextStep({
      ...BASE,
      harvesters: [depot(1, "p1", 28, 28)],
      money: 0,
      purse: { wood: 0, stone: 0, ore: 0, grain: 0, coal: 0, gold: 0 },
      marketPrices: null,
      activeContract: { label: "Deliver 10 Grain to Mapleton", target: { tx: 40, ty: 40 } },
    });
    expect(r.key).toMatch(/^contract-/);
    expect(r.text).toContain("Mapleton");
    expect(r.target).toEqual({ tx: 40, ty: 40 });
    expect(r.tool).toBeNull();
  });

  it("6. Affordable town upgrade → Upgrade (+x% yield)", () => {
    const def = TOWN_UPGRADES[0];
    const r = nextStep({
      ...BASE,
      harvesters: [depot(1, "p1", 28, 28)],
      purse: { ...Object.fromEntries(Object.keys(def.cost).map((k) => [k, 999])) } as NextStepInput["purse"],
      townLevel: 0,
    });
    expect(r.key).toBe("town-upgrade-0");
    expect(r.text).toMatch(/upgrade/i);
    expect(r.text).toMatch(/yield/);
    expect(r.tool).toBe("city");
  });

  it("7. Contested industry nearby → race the rival", () => {
    const r = nextStep({
      ...BASE,
      harvesters: [depot(1, "p1", 28, 28)],
      contestedIndustry: { name: "the Coal Seam", target: { tx: 50, ty: 50 } },
    });
    expect(r.key).toMatch(/^contest-/);
    expect(r.text).toMatch(/rival/i);
    expect(r.text).toContain("Coal Seam");
    expect(r.tool).toBe("harvester");
    expect(r.target).toEqual({ tx: 50, ty: 50 });
  });

  it("8. Fallback → nearest unclaimed ★ source", () => {
    const inds = [industry(0, "farm", 30, 30), industry(1, "coal", 60, 60)];
    // Place a depot BESIDE the farm so the farm is claimed and coal is the
    // nearest remaining ★ source.
    const d = depot(1, "p1", 29, 29);
    const r2 = nextStep({
      ...BASE,
      industries: inds,
      harvesters: [d],
      isConnected: () => true,
    });
    expect(r2.key).toBe("next-star-coal");
    expect(r2.tool).toBe("harvester");
    // Target should be the unclaimed (coal) industry center.
    expect(r2.target).toEqual({ tx: 61, ty: 61 });
  });

  it("tuning session open takes priority over everything else", () => {
    const cap = storageCapFor(0);
    const r = nextStep({
      ...BASE,
      phase: "setup-factory",   // would otherwise fire rule 1
      factories: [],
      tuning: { kind: "depot", cargo: "grain", movesLeft: 8, moves: 15, target: { tx: 30, ty: 30 } },
      money: IDLE_MONEY_THRESHOLD + 100,
      purse: { wood: 0, stone: 0, ore: 0, grain: cap, coal: 0, gold: 0 },
      marketPrices: { grain: 42 },
    });
    expect(r.key).toBe("tuning-depot");
    expect(r.text).toContain("Grain");
    expect(r.text).toContain("8/15");
    expect(r.tool).toBeNull();
  });

  it("tuning town session names the city", () => {
    const r = nextStep({
      ...BASE,
      tuning: { kind: "town", cargo: null, movesLeft: 3, moves: 10, target: { tx: 20, ty: 20 } },
    });
    expect(r.key).toBe("tuning-town");
    expect(r.text).toMatch(/city/i);
  });

  it("returns a stable key for the same state", () => {
    const a = nextStep({ ...BASE, harvesters: [] });
    const b = nextStep({ ...BASE, harvesters: [] });
    expect(a.key).toBe(b.key);
  });

  it("phase 'won' says you win", () => {
    const r = nextStep({
      ...BASE,
      phase: "won",
      harvesters: [depot(1, "p1", 28, 28)],
    });
    expect(r.key).toBe("won");
    expect(r.text).toMatch(/win/);
    expect(r.tool).toBeNull();
  });
});
