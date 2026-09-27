// #431 — a stalled seat turns money into its next Depot (`planGoalPurchase`).
//
// The rival's goods gate is priced in cargo; under ECON-1 it sells what it
// earns, so a seat whose only income is the gold mine (gold is outside the
// bank, PP-08) used to hold money it could never spend. The rule is all or
// nothing: a purchase that leaves the goal short builds nothing, so it never
// happens.
import { describe, it, expect } from "vitest";
import { goalOutOfReach, planGoalPurchase } from "../../src/iso/ai";
import { BASE_PRICE, type Cargo } from "../../src/iso/config";

const atBase = (cargo: Cargo, units: number): number | null =>
  cargo === "gold" ? null : BASE_PRICE[cargo] * units;

describe("#431 planGoalPurchase", () => {
  it("buys exactly the shortfall when the money covers all of it", () => {
    const plan = planGoalPurchase({ wood: 3, stone: 3, grain: 3 }, { wood: 6, stone: 3, grain: 5 }, 1000, atBase);
    expect(plan).toEqual({ buy: { wood: 3, grain: 2 }, price: 3 * BASE_PRICE.wood + 2 * BASE_PRICE.grain });
  });

  it("buys nothing when the money falls short of the whole goal", () => {
    const cost = { wood: 10, oil: 10 };
    const price = 10 * BASE_PRICE.wood + 10 * BASE_PRICE.oil;
    expect(planGoalPurchase({}, cost, price - 1, atBase)).toBeNull();
    expect(planGoalPurchase({}, cost, price, atBase)?.price).toBe(price);
  });

  it("buys nothing when nothing is short", () => {
    expect(planGoalPurchase({ wood: 9 }, { wood: 4 }, 1000, atBase)).toBeNull();
  });

  it("refuses a goal that needs a cargo the market will not sell", () => {
    expect(planGoalPurchase({}, { wood: 1, gold: 1 }, 1e6, atBase)).toBeNull();
  });

  it("rounds a fractional need up (a Depot is never bought 0.4 short)", () => {
    expect(planGoalPurchase({ wood: 2.6 }, { wood: 4 }, 1000, atBase)?.buy).toEqual({ wood: 2 });
  });
});

describe("#431 goalOutOfReach — only a real stall buys", () => {
  it("is false while every short cargo is one the seat earns (wait for the clock)", () => {
    expect(goalOutOfReach({ wood: 1 }, { wood: 4, stone: 2 }, new Set<Cargo>(["wood", "stone"]))).toBe(false);
  });
  it("is true when a short cargo has no Depot of the seat's own behind it", () => {
    expect(goalOutOfReach({ wood: 1 }, { wood: 4, stone: 2 }, new Set<Cargo>(["wood"]))).toBe(true);
  });
  it("is false when nothing is short, whatever the seat earns", () => {
    expect(goalOutOfReach({ wood: 4 }, { wood: 4 }, new Set<Cargo>(["gold"]))).toBe(false);
  });
});
