// FLEET-5 (#599): the whole depot fleet upgrades together - faster, same sprites.
import { describe, it, expect } from "vitest";
import { FLEET, BUILD_COSTS_MONEY } from "../../src/iso/config";
import {
  truckLevelOf, truckSpeedMultOf, truckUpgradeBase, truckUpgradePrice, truckUpgradeCheck, fleetLoadFactor,
} from "../../src/iso/fleet";
import { perkPrice } from "../../src/iso/managers";
import type { EconomyState, Harvester } from "../../src/iso/economy";
import { planRivalTruckUpgrade } from "../../src/iso/ai";
import { generateMap } from "../../src/iso/grid";
import { createTrack, buildTile } from "../../src/iso/track";
import { createTruckState, planTrucks, tickTrucks } from "../../src/iso/vehicles";
import {
  buildSnapshot, applySnapshot, validateSnapshot, type SnapshotSource,
} from "../../src/iso/snapshot";

const dep = (o: Partial<Harvester> = {}): Harvester =>
  ({ id: 1, owner: "p1", ownerId: 1, tx: 10, ty: 11, facing: "ne", ...o }) as Harvester;

function lorriesFor(level: number | undefined) {
  const track = createTrack();
  for (let k = 0; k < 5; k++) buildTile(track, "dirt", 10 + k, 10, 1);
  const eco: EconomyState = { grid: generateMap(1701), track, harvesters: [], factories: [] };
  eco.harvesters.push(dep(level === undefined ? {} : { truckLevel: level }));
  eco.factories.push({ owner: "p1", ownerId: 1, tx: 15, ty: 10 });
  return planTrucks(eco);
}

describe("FLEET-5 (a) a faster fleet delivers more", () => {
  it("level 3 delivers about 1.5x the loads of level 1 in the same time", () => {
    const run = (level: number | undefined): number => {
      const state = createTruckState();
      state.trucks.push(...lorriesFor(level));
      expect(state.trucks.length).toBe(1);
      for (let i = 0; i < 6000; i++) tickTrucks(state, 100);   // 10 simulated minutes
      return state.trucks[0].deliveries;
    };
    const l1 = run(1), l3 = run(3);
    expect(l1).toBeGreaterThan(20);
    expect(l3 / l1).toBeGreaterThan(1.35);
    expect(l3 / l1).toBeLessThan(1.6);
    expect(run(undefined)).toBe(l1);
  });
  it("the load clock reads the level too", () => {
    expect(fleetLoadFactor(dep({ truckLevel: 3 })) / fleetLoadFactor(dep())).toBeCloseTo(1.5, 5);
    expect(fleetLoadFactor(dep({ truckLevel: 2, trucks: 2 }))).toBeCloseTo(FLEET.truckLoadMult[1] * 1.25, 5);
  });
  it("speed is x1 / x1.25 / x1.5 and junk clamps", () => {
    expect([1, 2, 3].map((l) => truckSpeedMultOf({ truckLevel: l }))).toEqual([1, 1.25, 1.5]);
    expect(truckLevelOf({})).toBe(1);
    expect(truckLevelOf({ truckLevel: 99 })).toBe(3);
    expect(truckLevelOf({ truckLevel: Number.NaN })).toBe(1);
  });
});

describe("FLEET-5 (b) the price ladder and the James perk", () => {
  it("costs 0.8x then 1.3x the base", () => {
    const b = BUILD_COSTS_MONEY.truckUpgrade;
    expect(b).toBeGreaterThan(0);
    expect(truckUpgradeBase(1)).toBe(Math.round(b * 0.8));
    expect(truckUpgradeBase(2)).toBe(Math.round(b * 1.3));
  });
  it("James's road perk applies", () => {
    expect(truckUpgradePrice(1, "james")).toBe(perkPrice(truckUpgradeBase(1), "james", "road"));
    expect(truckUpgradePrice(2, "james")).toBeLessThanOrEqual(truckUpgradePrice(2, null));
  });
  it("refusals: max level, poor, unconnected, not yours", () => {
    const rich = 1e6;
    expect(truckUpgradeCheck(dep(), 1, true, rich, null).ok).toBe(true);
    expect(truckUpgradeCheck(dep({ truckLevel: 3 }), 1, true, rich, null).ok).toBe(false);
    expect(truckUpgradeCheck(dep(), 1, true, 0, null).ok).toBe(false);
    expect(truckUpgradeCheck(dep(), 1, false, rich, null).ok).toBe(false);
    expect(truckUpgradeCheck(dep(), 2, true, rich, null).ok).toBe(false);
  });
});

describe("FLEET-5 (c) the level round-trips", () => {
  const src = (h: Partial<Harvester>[]): SnapshotSource => ({
    seed: 7, track: createTrack(),
    harvesters: h.map((x, i) => dep({ id: i + 1, ...x })),
    factories: [{ owner: "p1", ownerId: 1, tx: 30, ty: 11 }] as never,
    setupPhase: false, won: false,
    players: [{ id: "p1", vp: 0, res: {} }] as never, t: 1,
  });
  it("keeps level 3 and reads an absent level as 1", () => {
    const snap = buildSnapshot(src([{ truckLevel: 3 }, {}]));
    expect(validateSnapshot(snap)).toBeNull();
    const back = applySnapshot(snap).harvesters;
    expect(truckLevelOf(back[0])).toBe(3);
    expect(back[1].truckLevel).toBeUndefined();
    expect(truckLevelOf(back[1])).toBe(1);
  });
  it("rejects junk", () => {
    const snap = buildSnapshot(src([{ truckLevel: 3 }])) as never as { harvesters: { truckLevel?: number }[] };
    snap.harvesters[0].truckLevel = 7;
    expect(validateSnapshot(snap)).not.toBeNull();
    snap.harvesters[0].truckLevel = 1.5;
    expect(validateSnapshot(snap)).not.toBeNull();
  });
});

describe("FLEET-5 (d) the rival upgrades", () => {
  const price = (l: number) => truckUpgradePrice(l, null);
  const R = BUILD_COSTS_MONEY.depot;
  it("upgrades its busiest connected Depot when rich", () => {
    const c = [
      { id: 1, score: 5, level: 1, connected: true },
      { id: 2, score: 9, level: 2, connected: true },
      { id: 3, score: 99, level: 1, connected: false },
    ];
    expect(planRivalTruckUpgrade(c, 10_000, price, R)).toBe(2);
  });
  it("does nothing when poor or at level 3", () => {
    expect(planRivalTruckUpgrade([{ id: 1, score: 5, level: 1, connected: true }], price(1), price, R)).toBeNull();
    expect(planRivalTruckUpgrade([{ id: 1, score: 5, level: 3, connected: true }], 10_000, price, 0)).toBeNull();
  });
});
