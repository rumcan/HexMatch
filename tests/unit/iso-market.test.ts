// ECON-1 (#421): the commodity market — determinism, mean reversion,
// slippage and recovery, demand events, the money cost table and the rival's
// sell rule.
import { describe, it, expect, beforeEach } from "vitest";
import {
  createMarket, cleanPrice, priceOf, quoteSale, sell, quoteBuy, buyPrice,
  eventsAt, eventMult, movingAverage, rivalSellLot, trendPct, history,
  decayImpact, impactAt, resetMarketCache, marketToWire, marketFromWire,
  walkAt, sellable, SELLABLE, MAX_IMPACT, RECOVERY_MS, EVENT_SLOT_MS, EVENT_MS,
  SLIP_PER_UNIT, money,
} from "../../src/iso/market";
import { BASE_PRICE, BUILD_COSTS, BUILD_COSTS_MONEY, CARGOES, moneyValueOf } from "../../src/iso/config";

const MIN = 60_000;

beforeEach(() => { resetMarketCache(); });

describe("ECON-1 market > determinism", () => {
  it("gives the same price for a seed and a clock, cold cache or warm", () => {
    const a = cleanPrice(1234, "ore", 7 * MIN + 137);
    resetMarketCache();
    // warm the cache with an unrelated walk first — the answer may not move
    cleanPrice(1234, "ore", 20 * MIN);
    const b = cleanPrice(1234, "ore", 7 * MIN + 137);
    expect(b).toBeCloseTo(a, 10);
  });

  it("different seeds give different price paths", () => {
    const one = Array.from({ length: 40 }, (_, i) => cleanPrice(1, "wood", i * 10_000));
    const two = Array.from({ length: 40 }, (_, i) => cleanPrice(2, "wood", i * 10_000));
    expect(one).not.toEqual(two);
  });

  it("starts every good at its base price (the opening minute is quiet)", () => {
    for (const c of CARGOES) expect(cleanPrice(99, c, 0)).toBeCloseTo(BASE_PRICE[c], 6);
  });

  it("is continuous between walk steps (no jumps)", () => {
    const seed = 77;
    let prev = cleanPrice(seed, "grain", 0);
    for (let t = 250; t < 5 * MIN; t += 250) {
      const now = cleanPrice(seed, "grain", t);
      expect(Math.abs(now / prev - 1)).toBeLessThan(0.05);
      prev = now;
    }
  });

  it("uses no Math.random (the module never calls it)", () => {
    const real = Math.random;
    Math.random = () => { throw new Error("market used Math.random"); };
    try {
      expect(() => { for (let t = 0; t < 10 * MIN; t += 5_000) cleanPrice(5, "oil", t); }).not.toThrow();
    } finally { Math.random = real; }
  });
});

describe("ECON-1 market > mean reversion", () => {
  it("comes home to base over a long window, for every seed we try", () => {
    for (const seed of [1, 42, 1337, 90210]) {
      for (const cargo of SELLABLE) {
        let total = 0; let n = 0;
        for (let t = 0; t < 60 * MIN; t += 5_000) {
          // the WALK only — events are a separate, deliberate shock
          total += BASE_PRICE[cargo] * Math.exp(walkAt(seed, cargo, t)); n++;
        }
        const mean = total / n;
        expect(Math.abs(mean / BASE_PRICE[cargo] - 1)).toBeLessThan(0.15);
      }
    }
  });

  it("never runs away: the walk stays inside its clamp band", () => {
    for (let t = 0; t < 90 * MIN; t += 2_500) {
      const p = BASE_PRICE.ore * Math.exp(walkAt(4242, "ore", t));
      expect(p).toBeGreaterThan(BASE_PRICE.ore * 0.6);
      expect(p).toBeLessThan(BASE_PRICE.ore * 1.6);
    }
  });
});

describe("ECON-1 market > slippage and recovery", () => {
  it("a big lot earns less per unit than a small one", () => {
    const m = createMarket(7);
    const small = quoteSale(m, "ore", 1, 0).revenue;
    const big = quoteSale(m, "ore", 40, 0);
    expect(big.revenue).toBeLessThan(small * 40);
    expect(big.priceAfter).toBeLessThan(big.priceBefore);
  });

  it("selling pushes the price down and it recovers over time", () => {
    const m = createMarket(7);
    const before = priceOf(m, "wood", 0);
    sell(m, "wood", 50, 0);
    const after = priceOf(m, "wood", 0);
    expect(after).toBeLessThan(before * 0.9);
    // one recovery constant later most of it is gone…
    const later = impactAt(m, "wood", 3 * RECOVERY_MS);
    expect(later).toBeLessThan(impactAt(m, "wood", 0) * 0.1);
    // …and decaying forward is idempotent
    decayImpact(m, 10 * RECOVERY_MS);
    decayImpact(m, 10 * RECOVERY_MS);
    expect(m.impact.wood ?? 0).toBeLessThan(1e-3);
  });

  it("clamps slippage — dumping forever cannot make a price negative", () => {
    const m = createMarket(7);
    for (let i = 0; i < 20; i++) sell(m, "stone", 200, 0);
    expect(impactAt(m, "stone", 0)).toBeLessThanOrEqual(MAX_IMPACT + 1e-9);
    expect(priceOf(m, "stone", 0)).toBeGreaterThan(0);
  });

  it("each unit slips by about SLIP_PER_UNIT", () => {
    const m = createMarket(3);
    const q = quoteSale(m, "grain", 10, 0);
    expect(1 - q.priceAfter / q.priceBefore).toBeCloseTo(1 - (1 - SLIP_PER_UNIT) ** 10, 3);
  });

  it("refuses gold and non-positive lots, and moves nothing", () => {
    const m = createMarket(7);
    expect(sellable("gold")).toBe(false);
    expect(sell(m, "gold", 10, 0)).toMatchObject({ units: 0, revenue: 0 });
    expect(sell(m, "ore", 0, 0)).toMatchObject({ units: 0, revenue: 0 });
    expect(sell(m, "ore", -5, 0)).toMatchObject({ units: 0, revenue: 0 });
    expect(m.impact).toEqual({});
  });

  it("a buy pays a spread over the sale price", () => {
    const m = createMarket(7);
    expect(buyPrice(m, "oil", 0)).toBeGreaterThan(priceOf(m, "oil", 0));
    expect(quoteBuy(m, "oil", 3, 0).cost).toBeGreaterThan(quoteSale(m, "oil", 3, 0).revenue);
    expect(quoteBuy(m, "gold", 3, 0)).toEqual({ units: 0, cost: 0 });
  });

  it("no infinite loop: buying back what you just sold always loses money", () => {
    const m = createMarket(11);
    const got = sell(m, "ore", 20, 0).revenue;
    expect(quoteBuy(m, "ore", 20, 0).cost).toBeGreaterThan(got);
  });
});

describe("ECON-1 market > demand events", () => {
  const seedWithEvent = (): { seed: number; ev: ReturnType<typeof eventsAt>[number] } => {
    for (let seed = 1; seed < 500; seed++) {
      for (let slot = 0; slot < 30; slot++) {
        const evs = eventsAt(seed, slot * EVENT_SLOT_MS + 1_000);
        if (evs.length) return { seed, ev: evs[0] };
      }
    }
    throw new Error("no event in 500 seeds — the schedule is broken");
  };

  it("fires, moves its own cargo's price, and expires", () => {
    const { seed, ev } = seedWithEvent();
    const mid = (ev.startMs + ev.endMs) / 2;
    expect(eventMult(seed, ev.cargo, mid)).not.toBeCloseTo(1, 3);
    // the event moves the price away from the pure walk, in its direction
    const withEv = cleanPrice(seed, ev.cargo, mid);
    const walkOnly = BASE_PRICE[ev.cargo] * Math.exp(walkAt(seed, ev.cargo, mid));
    if (ev.mult > 1) expect(withEv).toBeGreaterThan(walkOnly);
    else expect(withEv).toBeLessThan(walkOnly);
    // and it is gone the moment it expires
    expect(eventsAt(seed, ev.endMs).some((e) => e.id === ev.id)).toBe(false);
    expect(eventsAt(seed, ev.endMs - 1).some((e) => e.id === ev.id)).toBe(true);
  });

  it("never schedules gold and always has readable copy", () => {
    for (let seed = 1; seed < 60; seed++) {
      for (let slot = 0; slot < 20; slot++) {
        for (const ev of eventsAt(seed, slot * EVENT_SLOT_MS + 500)) {
          expect(ev.cargo).not.toBe("gold");
          expect(ev.label).toMatch(/[+−]\d+%/);
          expect(ev.endMs - ev.startMs).toBe(EVENT_MS);
        }
      }
    }
  });

  it("is deterministic per seed", () => {
    const a = eventsAt(31, 5 * MIN).map((e) => e.id + e.label);
    const b = eventsAt(31, 5 * MIN).map((e) => e.id + e.label);
    expect(b).toEqual(a);
  });
});

describe("ECON-1 market > trend, history and wire", () => {
  it("reports a trend and a sparkline of the right length", () => {
    const m = createMarket(21);
    expect(Number.isFinite(trendPct(m, "ore", 5 * MIN))).toBe(true);
    expect(history(m, "ore", 5 * MIN, 24).length).toBe(24);
    // a dump drags the trend down (the walk under it may be doing anything)
    const before = trendPct(m, "ore", 5 * MIN);
    sell(m, "ore", 60, 5 * MIN);
    expect(trendPct(m, "ore", 5 * MIN)).toBeLessThan(before - 0.3);
  });

  it("round-trips through the wire/save shape", () => {
    const m = createMarket(21);
    sell(m, "oil", 12, 2 * MIN);
    const back = marketFromWire(JSON.parse(JSON.stringify(marketToWire(m))), 0);
    expect(back.seed).toBe(21);
    expect(priceOf(back, "oil", 2 * MIN)).toBeCloseTo(priceOf(m, "oil", 2 * MIN), 8);
    // a missing/garbage payload falls back to the map seed, never throws
    expect(marketFromWire(null, 5).seed).toBe(5);
    expect(marketFromWire({ seed: 9, impact: { ore: 99 } } as never, 5).impact.ore).toBe(MAX_IMPACT);
  });

  it("formats money for the HUD", () => {
    expect(money(1240.4)).toBe("$1,240");
    expect(money(0)).toBe("$0");
  });
});

describe("ECON-1 > the money cost table", () => {
  it("prices every build key in BUILD_COSTS", () => {
    for (const key of Object.keys(BUILD_COSTS)) {
      expect(BUILD_COSTS_MONEY[key], key).toBeTypeOf("number");
      expect(BUILD_COSTS_MONEY[key], key).toBeGreaterThanOrEqual(0);
    }
    // plus the tier/overpass rows the road layer charges per tile
    for (const key of ["street", "highway", "ramp", "overpass"]) {
      expect(BUILD_COSTS_MONEY[key], key).toBeGreaterThan(0);
    }
  });

  it("is derived from the resource table at the starting prices", () => {
    for (const key of Object.keys(BUILD_COSTS) as (keyof typeof BUILD_COSTS)[]) {
      expect(BUILD_COSTS_MONEY[key], key).toBe(moneyValueOf(BUILD_COSTS[key]));
    }
  });

  it("keeps Dirt Road free and orders the tiers", () => {
    expect(BUILD_COSTS_MONEY.dirt).toBe(0);
    expect(BUILD_COSTS_MONEY.street).toBeLessThan(BUILD_COSTS_MONEY.road);
    expect(BUILD_COSTS_MONEY.road).toBeLessThan(BUILD_COSTS_MONEY.highway);
    expect(BUILD_COSTS_MONEY.upgrade).toBeLessThan(BUILD_COSTS_MONEY.road);
  });
});

describe("ECON-1 > the rival's sell rule", () => {
  it("sells above its moving average and holds below it", () => {
    const m = createMarket(2026);
    let sold = 0; let held = 0;
    for (let t = 0; t < 30 * MIN; t += 15_000) {
      const lot = rivalSellLot(m, "ore", 100, 0, t);
      const avg = movingAverage(m.seed, "ore", t);
      if (lot > 0) { sold++; expect(priceOf(m, "ore", t)).toBeGreaterThan(avg); }
      else held++;
    }
    expect(sold).toBeGreaterThan(0);
    expect(held).toBeGreaterThan(0);
  });

  it("keeps its city-upgrade reserve back", () => {
    const m = createMarket(2026);
    // a clock where it wants to sell
    let t = 0;
    while (t < 60 * MIN && rivalSellLot(m, "ore", 100, 0, t) === 0) t += 5_000;
    expect(rivalSellLot(m, "ore", 100, 0, t)).toBeGreaterThan(0);
    expect(rivalSellLot(m, "ore", 100, 100, t)).toBe(0);
    expect(rivalSellLot(m, "ore", 100, 95, t)).toBe(5);
    expect(rivalSellLot(m, "gold", 100, 0, t)).toBe(0);
  });

  it("never dumps more than a lot at a time", () => {
    const m = createMarket(2026);
    for (let t = 0; t < 20 * MIN; t += 10_000) {
      expect(rivalSellLot(m, "grain", 9999, 0, t)).toBeLessThanOrEqual(10);
    }
  });
});
