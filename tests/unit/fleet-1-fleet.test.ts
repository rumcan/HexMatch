// FLEET-1 (#595): trucks are bought, priced, saved and paid for in the economy.
import { describe, it, expect } from "vitest";
import { FLEET, BUILD_COSTS_MONEY, BASE_RATE } from "../../src/iso/config";
import {
  truckCountOf, fleetLoadFactor, nextTruckBase, truckBuyPrice, truckBuyCheck, truckSellRefusal,
} from "../../src/iso/fleet";
import { perkPrice } from "../../src/iso/managers";
import { clockFactorOf, cargoPerMinute, type Harvester } from "../../src/iso/economy";
import { planRivalTruck, RIVAL_TRUCK_CAP } from "../../src/iso/ai";
import {
  buildSnapshot, applySnapshot, validateSnapshot, type SnapshotSource,
} from "../../src/iso/snapshot";
import { createTrack } from "../../src/iso/track";

const dep = (o: Partial<Harvester> = {}): Harvester =>
  ({ id: 1, owner: "p1", ownerId: 1, tx: 6, ty: 11, ...o }) as Harvester;

describe("FLEET-1 (a) more trucks, more loads per minute", () => {
  it("2 trucks pay more than 1 over N simulated minutes, in the real clock", () => {
    const perMin = (h: Harvester) => cargoPerMinute(
      1, clockFactorOf({ yieldLevel: 1, distanceFactor: 1, transportFactor: fleetLoadFactor(h) }), 1000);
    const total = (h: Harvester, minutes: number) => { let s = 0; for (let m = 0; m < minutes; m++) s += perMin(h); return s; };
    const one = total(dep(), 10);
    const two = total(dep({ trucks: 2 }), 10);
    expect(one).toBeGreaterThan(0);
    expect(two).toBeGreaterThan(one);
    expect(two / one).toBeCloseTo(FLEET.truckLoadMult[1], 5);
    expect(total(dep({ trucks: 4 }), 10)).toBeGreaterThan(two);
    expect(BASE_RATE).toBeGreaterThan(0);
  });
});

describe("FLEET-1 (b) the count round-trips", () => {
  const src = (h: Partial<Harvester>[]): SnapshotSource => ({
    seed: 7, track: createTrack(),
    harvesters: h.map((x, i) => dep({ id: i + 1, ...x })),
    factories: [{ owner: "p1", ownerId: 1, tx: 30, ty: 11 }] as never,
    setupPhase: false, won: false,
    players: [{ id: "p1", vp: 0, res: {} }] as never, t: 1,
  });
  it("snapshot keeps 3 trucks and reads an absent count as 1", () => {
    const snap = buildSnapshot(src([{ trucks: 3 }, {}]));
    expect(validateSnapshot(snap)).toBeNull();
    const back = applySnapshot(snap).harvesters;
    expect(truckCountOf(back[0])).toBe(3);
    expect(back[1].trucks).toBeUndefined();
    expect(truckCountOf(back[1])).toBe(1);
  });
  it("rejects a junk count", () => {
    const snap = buildSnapshot(src([{ trucks: 3 }])) as never as { harvesters: { trucks?: number }[] };
    snap.harvesters[0].trucks = 9;
    expect(validateSnapshot(snap)).not.toBeNull();
  });
  it("the solo save copies the Depot record, so the count survives JSON", () => {
    const back = JSON.parse(JSON.stringify([dep({ trucks: 2 }), dep({ id: 2 })])) as Harvester[];
    expect(truckCountOf(back[0])).toBe(2);
    expect(truckCountOf(back[1])).toBe(1);
  });
});

describe("FLEET-1 (c) the rival buys a second truck", () => {
  const price = (n: number) => truckBuyPrice(n, null);
  it("picks its busiest connected Depot when it can pay", () => {
    const cands = [
      { id: 1, score: 5, trucks: 1, connected: true },
      { id: 2, score: 9, trucks: 1, connected: true },
      { id: 3, score: 99, trucks: 1, connected: false },
    ];
    expect(planRivalTruck(cands, 10_000, price, BUILD_COSTS_MONEY.depot)).toBe(2);
  });
  it("buys nothing when poor or at its cap", () => {
    const c = [{ id: 1, score: 5, trucks: 1, connected: true }];
    expect(planRivalTruck(c, price(1), price, BUILD_COSTS_MONEY.depot)).toBeNull();
    expect(planRivalTruck([{ id: 1, score: 5, trucks: RIVAL_TRUCK_CAP, connected: true }], 10_000, price, 0)).toBeNull();
  });
});

describe("FLEET-1 (d) the price ladder and the James perk", () => {
  it("costs base x 1 / 1.5 / 2 for the 2nd / 3rd / 4th truck", () => {
    const b = BUILD_COSTS_MONEY.truck;
    expect(b).toBeGreaterThan(0);
    expect(nextTruckBase(1)).toBe(b);
    expect(nextTruckBase(2)).toBe(Math.round(b * 1.5));
    expect(nextTruckBase(3)).toBe(b * 2);
  });
  it("James's road perk applies", () => {
    expect(truckBuyPrice(1, "james")).toBe(perkPrice(nextTruckBase(1), "james", "road"));
    expect(truckBuyPrice(1, "james")).toBeLessThan(truckBuyPrice(1, null));
  });
  it("refuses at the cap, when poor, and sells only extra trucks", () => {
    expect(truckBuyCheck(dep({ trucks: 4 }), 1, true, 1e6, null).ok).toBe(false);
    expect(truckBuyCheck(dep(), 1, true, 0, null).why).toMatch(/Not enough money/);
    expect(truckBuyCheck(dep(), 1, true, 1e6, null).ok).toBe(true);
    expect(truckSellRefusal(dep(), 1)).not.toBeNull();
    expect(truckSellRefusal(dep({ trucks: 2 }), 1)).toBeNull();
  });
});
