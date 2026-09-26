import { describe, it, expect } from "vitest";
import { MAP_W as W, MAP_H as H } from "../../src/game/config";
import { INDUSTRY_BY_KEY } from "../../src/iso/config";
import { GRASS, type Grid, type Industry } from "../../src/iso/grid";
import { createTrack, buildTile, previewDrag, commitDrag, setRoadTier, dirtyTiles, tIdx } from "../../src/iso/track";
import { buildAllComponents, industryLocks, harvesterYield, routeIncome, routeUpgradeGain,
  type EconomyState, type Harvester } from "../../src/iso/economy";
import { createMarket, priceOf } from "../../src/iso/market";
import { tickAmount } from "../../src/iso/readouts";
import { BASE_RATE } from "../../src/iso/config";

function fixture(kind: "road" | "dirt" = "road", diagonal = false) {
  const def = INDUSTRY_BY_KEY.farm;
  const farm: Industry = { id: 0, type: "farm", tx: 12, ty: 11, w: def.footprint[0], h: def.footprint[1], output: def.output, banditUntil: 0 };
  const occupancy = new Int16Array(W * H).fill(-1);
  for (let y = farm.ty; y < farm.ty + farm.h; y++) for (let x = farm.tx; x < farm.tx + farm.w; x++) occupancy[y * W + x] = 0;
  const grid = { w: W, h: H, terrain: new Uint8Array(W * H).fill(GRASS), industries: [farm], occupancy, seed: 1 } as Grid;
  const track = createTrack(); track.diagonalRoads = diagonal;
  for (let x = 6; x <= 20; x++) buildTile(track, kind, x, 10, 1);
  const h = { id: 1, owner: "p1", ownerId: 1, tx: 10, ty: 11, facing: "ne" } as Harvester;
  const state = { grid, track, harvesters: [h], factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }] } as EconomyState;
  return { state, h };
}
const yields = (s: EconomyState, h: Harvester) => harvesterYield(s, buildAllComponents(s.track, 1), industryLocks(s), h, 0).yields;
const total = (s: EconomyState, h: Harvester) => Object.values(yields(s, h)).reduce((a, b) => a + (b ?? 0), 0);
const rich = { wood: 999, stone: 999, ore: 999, grain: 999, oil: 999, gold: 999 };

describe("#462 route stats", () => {
  it("per-minute cargo matches the economy ledger and value uses current market prices", () => {
    const { state, h } = fixture();
    const output = yields(state, h);
    expect(total(state, h)).toBeGreaterThan(0);
    const factor = BASE_RATE * 1.2 * 0.8 * 1.25 * 1.5;
    const market = createMarket(42);
    const price = (cargo: Parameters<typeof priceOf>[1]) => priceOf(market, cargo, 60_000);
    const r = routeIncome(output, factor, 2000, price);
    const expected = Object.values(output).reduce((n, amount) => n + tickAmount({ amount: amount!, yieldLevel: 1.2,
      distanceFactor: 0.8, transportFactor: 1, damBonus: 0.25, townBonus: 0.5 }), 0) * 30;
    expect(r.cargoPerMinute).toBeCloseTo(expected);
    expect(r.moneyPerMinute).toBeCloseTo(expected * price("grain"));
    expect(routeIncome(output, 0, 2000, price).cargoPerMinute).toBe(0);
  });

  for (const diagonal of [false, true]) for (const kind of ["road", "dirt"] as const) {
    it(`preview then actual Highway build has the same gain (${kind}, diagonal=${diagonal})`, () => {
      const { state, h } = fixture(kind, diagonal);
      const pv = previewDrag(state.grid, state.track, "road", rich, 14, 10, 16, 10, true, undefined, 0, undefined, true, {}, "highway");
      expect(pv.tiles.length).toBeGreaterThan(0);
      const before = total(state, h);
      const road = state.track.road.slice(), dirt = state.track.dirt.slice(), tiers = state.track.tier?.slice();
      dirtyTiles.clear(); dirtyTiles.mark(tIdx(2, 2));
      const preview = routeUpgradeGain(state, h, 0, pv, "highway");
      expect(state.track.road).toEqual(road);
      expect(state.track.dirt).toEqual(dirt);
      expect(state.track.tier).toEqual(tiers);
      expect(dirtyTiles.drain()).toEqual([tIdx(2, 2)]);
      commitDrag(state.track, "road", pv, 1, "highway");
      expect(preview).toBeCloseTo((total(state, h) / before - 1) * 100, 10);
      expect(preview).toBeGreaterThan(0);
    });
  }
  it("never promises a gain for a downgrade", () => {
    const { state, h } = fixture();
    for (let x = 6; x <= 20; x++) setRoadTier(state.track, x, 10, 2);
    const pv = previewDrag(state.grid, state.track, "road", rich, 14, 10, 14, 10, true, undefined, 0, undefined, true, {}, "street");
    expect(routeUpgradeGain(state, h, 0, pv, "street")).toBe(0);
  });
  it("does not advertise sale proceeds for gold or an inactive route", () => {
    expect(routeIncome({ gold: 2 }, 1, 2000, () => 100).moneyPerMinute).toBe(0);
    expect(routeIncome({}, 1, 2000, () => 100)).toEqual({ cargoPerMinute: 0, moneyPerMinute: 0 });
  });
});
