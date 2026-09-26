// #462: route stats the player can see — cargo/min and $/min off the economy,
// and an upgrade preview that matches the gain a real build then pays.
import { describe, expect, it } from "vitest";
import {
  buildAllComponents, cargoPerMinute, clockFactorOf, depotPathLength, depotRoutePay,
  forecastStretchUpgrade, formatUpgradePreview, harvesterYield, heldIndustries,
  industryLocks, pickLargestGain, resolveConnection, routeDollarsPerMin, routeLedgerText,
  routePaceNames, routeThroughput, slowestOnRoute, stretchAround,
  type EconomyState, type Harvester,
} from "../../src/iso/economy";
import { depotYield, distanceFactorForPath, transportFactor } from "../../src/iso/loop";
import { createMarket, priceOf } from "../../src/iso/market";
import {
  commitDrag, createTrack, buildTile, previewDrag, roadTierAt, setRoadTier, ROAD_TIER,
} from "../../src/iso/track";
import { GRASS, type Grid, type Industry } from "../../src/iso/grid";
import { INDUSTRY_BY_KEY, TIER_THROUGHPUT, TRANSPORT } from "../../src/iso/config";
import { MAP_W, MAP_H } from "../../src/game/config";
import { industriesTouchingDepot } from "../../src/iso/depot";
import { planTrucks, lorryRoundTripMs, lorryTripsPerMin, tickTrucks } from "../../src/iso/vehicles";
import { composeRouteOverlay, type RouteOverlayPath } from "../../src/iso/renderer";

const rich = { wood: 999, stone: 999, ore: 999, grain: 999, oil: 999, gold: 999 };

function flatGrid(industries: Industry[]): Grid {
  const occupancy = new Int16Array(MAP_W * MAP_H).fill(-1);
  industries.forEach((ind, i) => {
    ind.id = i;
    for (let y = ind.ty; y < ind.ty + ind.h; y++)
      for (let x = ind.tx; x < ind.tx + ind.w; x++) occupancy[y * MAP_W + x] = i;
  });
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries, occupancy, seed: 1,
  };
}

function farm(): Industry {
  const def = INDUSTRY_BY_KEY.farm;
  return {
    id: 0, type: "farm", tx: 12, ty: 11,
    w: def.footprint[0], h: def.footprint[1],
    output: def.output, banditUntil: 0,
  };
}

/**
 * The ROADS-2 payout fixture: a Farm Depot opening NE onto a paved trunk that
 * reaches its plant. `tier` null leaves the map with no tier bytes, which the
 * economy short-cuts to Road ×1.6.
 */
function scenario(kind: "dirt" | "road" = "road", tier: number | null = null) {
  const ind = farm();
  const grid = flatGrid([ind]);
  const track = createTrack();
  for (let x = 6; x <= 20; x++) {
    buildTile(track, kind, x, 10, 1);
    if (kind === "road" && tier !== null) setRoadTier(track, x, 10, tier as 0 | 1 | 2);
  }
  const h: Harvester = { id: 1, owner: "p1", ownerId: 1, tx: 10, ty: 11, facing: "ne" };
  const state: EconomyState = {
    grid, track, harvesters: [h],
    factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }],
    dams: [],
  };
  return { state, track, grid, h, ind };
}

/** The cargo/min the clock will pay: raw yield × the clock factor, per minute. */
function measure(state: EconomyState, h: Harvester): number {
  const pay = depotRoutePay(state, h, 0);
  if (!pay.connected) return 0;
  const factor = clockFactorOf({
    yieldLevel: depotYield(h),
    distanceFactor: distanceFactorForPath(depotPathLength(state, h)),
    transportFactor: transportFactor(h),
  });
  return cargoPerMinute(pay.rawPerTick, factor, 3000);
}

describe("#462 route stats", () => {
  it("cargo/min and $/min are the economy's own yield at the current price", () => {
    const { state, track, h } = scenario("road");
    expect(industriesTouchingDepot(state.grid, h.tx, h.ty).length, "the depot holds the farm").toBeGreaterThan(0);
    expect(heldIndustries(state, h, industryLocks(state))).toHaveLength(1);

    const comp = buildAllComponents(track, 1);
    const conn = resolveConnection(state, comp, h);
    const y = harvesterYield(state, comp, industryLocks(state), h, 0);
    const pay = depotRoutePay(state, h, 0, comp);
    expect(pay.connected).toBe(true);
    expect(pay.throughput).toBe(conn.multiplier);
    expect(pay.throughput).toBe(TRANSPORT.road.throughput);
    const raw = Object.values(y.yields).reduce((s, n) => s + n, 0);
    expect(pay.rawPerTick).toBeCloseTo(raw, 6);

    const factor = clockFactorOf({
      yieldLevel: depotYield(h),
      distanceFactor: distanceFactorForPath(depotPathLength(state, h)),
      transportFactor: transportFactor(h),
    });
    const cargo = cargoPerMinute(pay.rawPerTick, factor, 3000);
    expect(cargo).toBeGreaterThan(0);
    // 3000ms tick → 20 ticks a minute. The number on the card is that product.
    expect(cargo).toBeCloseTo(raw * factor * 20, 6);

    const market = createMarket(7);
    const price = priceOf(market, "grain", 1_000);
    const dollars = routeDollarsPerMin(pay.yields, factor, 3000, (c) => priceOf(market, c, 1_000));
    expect(dollars).toBeCloseTo(cargo * price, 6);

    const text = routeLedgerText({
      cargoPerMin: cargo,
      dollarsPerMin: dollars,
      cargoName: "Grain",
      slowest: pay.slowest,
      tripsPerMin: 1.5,
    });
    expect(text.plain).toContain("cargo:");
    expect(text.plain).toContain("/min");
    expect(text.plain).toContain("Grain");
    expect(text.html).toContain("slowest:");
    expect(text.plain).toContain("trips/min");
  });

  it("a no-tier map is all Road, and a Highway on that route still gains", () => {
    const { state, track, h } = scenario("road", null);
    const route = depotRoutePay(state, h, 0).route!;
    expect(route.length).toBeGreaterThan(1);
    expect(routeThroughput(state, route)).toBe(TRANSPORT.road.throughput);
    const tile = route.find(([x, y]) => y === 10 && x > 12 && x < 18)!;
    expect(tile, "a trunk tile of the route").toBeTruthy();
    const stretch = stretchAround(track, route, tile[0], tile[1]);
    expect(stretch.length).toBeGreaterThan(1);
    const before = measure(state, h);
    const forecast = forecastStretchUpgrade(state, h, stretch, "highway", measure);
    expect(forecast, "highway on an all-Road route must gain").not.toBeNull();
    expect(forecast!.pct).toBeGreaterThan(0);
    expect(forecast!.after).toBeGreaterThan(before);
    // The forecast must not have written the live track.
    expect(roadTierAt(track, tile[0], tile[1])).toBe(ROAD_TIER.road);
  });

  it("the upgrade preview matches the cargo/min a real build then pays", () => {
    const { state, track, grid, h } = scenario("road", ROAD_TIER.street);
    expect(industriesTouchingDepot(state.grid, h.tx, h.ty).length).toBeGreaterThan(0);
    expect(heldIndustries(state, h, industryLocks(state)).length, "non-zero preview needs a held industry").toBe(1);

    const route = depotRoutePay(state, h, 0).route!;
    // A non-junction trunk tile: the straight run, not the depot gate or the plant.
    const tile = route.find(([x, y]) => y === 10 && x >= 14 && x <= 16);
    expect(tile).toBeTruthy();
    const stretch = stretchAround(track, route, tile![0], tile![1]);
    expect(stretch.every(([, y]) => y === 10)).toBe(true);
    const before = measure(state, h);
    const forecast = forecastStretchUpgrade(state, h, stretch, "highway", measure);
    expect(forecast).not.toBeNull();
    expect(forecast!.pct).toBeGreaterThan(0);

    const [x0] = stretch[0];
    const [x1] = stretch[stretch.length - 1];
    const pv = previewDrag(grid, track, "road", rich, x0, 10, x1, 10, true, undefined, 0, undefined, true, {}, "highway");
    expect(pv.tiles.length).toBeGreaterThan(0);
    commitDrag(track, "road", pv, 1, "highway");
    // A junction on the stretch becomes a Ramp — the same rule the preview
    // stamps. What has to match is the cargo/min, not a uniform Highway.
    const after = measure(state, h);
    const realPct = ((after - before) / before) * 100;
    expect(after).toBeGreaterThan(before);
    expect(after).toBeCloseTo(forecast!.after, 4);
    expect(realPct).toBeCloseTo(forecast!.pct, 4);
    expect(formatUpgradePreview(forecast!.pct, "Farm Depot")).toMatch(/^\+\d+(\.\d)?% cargo\/min on Farm Depot$/);
  });

  it("does not preview a downgrade", () => {
    const { state, track, h } = scenario("road", ROAD_TIER.highway);
    const route = depotRoutePay(state, h, 0).route!;
    const tile = route.find(([, y]) => y === 10)!;
    const stretch = stretchAround(track, route, tile[0], tile[1]);
    expect(forecastStretchUpgrade(state, h, stretch, "street", measure)).toBeNull();
  });

  it("names the slowest tile on the route, first on a tie", () => {
    const { state, track, h } = scenario("road", ROAD_TIER.road);
    // One Street tile in the middle of the trunk is the bottleneck.
    setRoadTier(track, 15, 10, ROAD_TIER.street);
    const route = depotRoutePay(state, h, 0).route;
    expect(route, "the lorry still has a route").toBeTruthy();
    const slow = slowestOnRoute(track, route!);
    expect(slow).not.toBeNull();
    expect(slow!.name).toBe("Street");
    expect(slow!.throughput).toBe(TIER_THROUGHPUT[ROAD_TIER.street]);
    expect(slow!.tx).toBe(15);
    // The depot lot the lorry loads on is not track. It must not win "slowest".
    const withLot: [number, number][] = [[10, 11], ...route!];
    expect(slowestOnRoute(track, withLot)?.tx).toBe(15);
    expect(routePaceNames(track, withLot)[0]).not.toBe("Dirt");
  });

  it("a shared tile keeps the Depot with the larger cargo/min gain", () => {
    const small = { name: "Farm Depot", forecast: { before: 10, after: 14, pct: 40, raised: [[1, 1] as [number, number]] } };
    const large = { name: "Mine Depot", forecast: { before: 100, after: 112, pct: 12, raised: [[1, 1] as [number, number]] } };
    const picked = pickLargestGain([small, large]);
    expect(picked?.name).toBe("Mine Depot");
    expect(formatUpgradePreview(picked!.pct, picked!.name)).toBe("+12% cargo/min on Mine Depot");
  });

  it("lorry trips/min is one factory arrival per round trip of the truck clock", () => {
    const { state, h } = scenario("road", ROAD_TIER.road);
    expect(heldIndustries(state, h, industryLocks(state)).length).toBe(1);
    const trucks = planTrucks(state);
    expect(trucks).toHaveLength(1);
    const trip = lorryRoundTripMs(trucks[0]);
    const perMin = lorryTripsPerMin(trucks[0]);
    expect(perMin).toBeCloseTo(60000 / trip, 6);
    const box = { trucks };
    // Step the clock and mark each factory arrival. The gap between the
    // second and third is a full round trip (the first departure has no
    // load wait, so it is shorter and is not the number on the card).
    const marks: number[] = [];
    let elapsed = 0;
    while (marks.length < 3 && elapsed < 120_000) {
      tickTrucks(box, 10);
      elapsed += 10;
      if (trucks[0].deliveries > marks.length) marks.push(elapsed);
    }
    expect(marks).toHaveLength(3);
    const interval = marks[2] - marks[1];
    expect(Math.abs(interval - trip)).toBeLessThan(15);
    expect(perMin).toBeCloseTo(60000 / interval, 1);
  });

  it("network view is on or off without dropping a hovered route", () => {
    const network: RouteOverlayPath[] = [
      { tiles: [[1, 1], [2, 1]], pace: ["Road", "Highway"], label: { tx: 1, ty: 1, text: "4/min" } },
    ];
    const focus: RouteOverlayPath = { tiles: [[3, 3], [4, 3]], focus: true };
    expect(composeRouteOverlay(false, network, null)).toEqual([]);
    expect(composeRouteOverlay(true, network, null)).toEqual(network);
    const both = composeRouteOverlay(true, network, focus);
    expect(both).toHaveLength(2);
    expect(both[1].focus).toBe(true);
    const hoverOnly = composeRouteOverlay(false, network, focus);
    expect(hoverOnly).toHaveLength(1);
    expect(hoverOnly[0].focus).toBe(true);
  });
});
