// ROADS-2 (#393): Street / Road / Highway tiers on the paved layer.
import { describe, expect, it } from "vitest";
import {
  createTrack, buildTile, commitDrag, previewDrag, roadTierAt, setRoadTier, tierTileCost,
  demolishTile, hasTrack, ROAD_TIER,
} from "../../src/iso/track";
import { generateMap } from "../../src/iso/grid";
import { ROAD_TIERS, TIER_THROUGHPUT, TRANSPORT } from "../../src/iso/config";
import { diffTrack, readTiles, applyTrackDelta } from "../../src/net/delta";

const rich = { wood: 999, stone: 999, ore: 999, grain: 999, oil: 999, gold: 999 };

function flatLand() {
  // a quiet inland stretch on a known seed
  const g = generateMap(42, {});
  for (let y = 60; y < 70; y++) for (let x = 20; x < 60; x++) { g.terrain[y * 144 + x] = 0; g.occupancy[y * 144 + x] = -1; }
  return g;
}

describe("ROADS-2 road tiers", () => {
  it("tier costs and throughput come from the config table", () => {
    expect(TIER_THROUGHPUT[ROAD_TIER.road]).toBe(TRANSPORT.road.throughput);
    expect(TIER_THROUGHPUT[ROAD_TIER.highway]).toBeGreaterThan(TRANSPORT.road.throughput);
    expect(TIER_THROUGHPUT[ROAD_TIER.street]).toBeLessThan(TRANSPORT.road.throughput);
  });

  it("a Highway drag lays road stamped highway and charges the highway price", () => {
    const g = flatLand(), t = createTrack();
    const pv = previewDrag(g, t, "road", rich, 22, 64, 30, 64, true, undefined, 0, undefined, true, {}, "highway");
    expect(pv.tiles.length).toBe(9);
    expect(pv.cost.ore).toBe((ROAD_TIERS.highway.cost.ore ?? 0) * 9);
    commitDrag(t, "road", pv, 1, "highway");
    for (let x = 22; x <= 30; x++) expect(roadTierAt(t, x, 64)).toBe(ROAD_TIER.highway);
  });

  it("upgrading a Road to a Highway pays only the difference, and never downgrades", () => {
    const g = flatLand(), t = createTrack();
    for (let x = 22; x <= 26; x++) buildTile(t, "road", x, 64, 1);
    const gap = tierTileCost(t, "highway", 22, 64);
    expect(gap.ore).toBe((ROAD_TIERS.highway.cost.ore ?? 0) - (ROAD_TIERS.road.cost.ore ?? 0));
    const pv = previewDrag(g, t, "road", rich, 22, 64, 26, 64, true, undefined, 0, undefined, true, {}, "highway");
    commitDrag(t, "road", pv, 1, "highway");
    expect(roadTierAt(t, 24, 64)).toBe(ROAD_TIER.highway);
    // a Street drag over the highway changes nothing and costs nothing
    const pv2 = previewDrag(g, t, "road", rich, 22, 64, 26, 64, true, undefined, 0, undefined, true, {}, "street");
    expect(Object.keys(pv2.cost).length).toBe(0);
    commitDrag(t, "road", pv2, 1, "street");
    expect(roadTierAt(t, 24, 64)).toBe(ROAD_TIER.highway);
  });

  it("demolishing pavement clears its tier", () => {
    const t = createTrack();
    buildTile(t, "road", 10, 10, 1);
    setRoadTier(t, 10, 10, ROAD_TIER.street);
    demolishTile(t, "road", 10, 10);
    expect(hasTrack(t, "road", 10, 10)).toBe(false);
    expect(roadTierAt(t, 10, 10)).toBe(ROAD_TIER.road);
  });

  it("a Highway refuses a level change between two tiles (gentle grades)", () => {
    const g = flatLand(), t = createTrack();
    g.height = new Uint8Array(144 * 144).fill(1);
    for (let y = 60; y < 70; y++) g.height[y * 144 + 26] = 2;
    const pv = previewDrag(g, t, "road", rich, 22, 64, 30, 64, true, undefined, 0, undefined, true, {}, "highway");
    expect(pv.tiles.length).toBeLessThan(9);
    expect(pv.truncated || pv.blocked.length > 0).toBe(true);
  });

  it("tiers ride the multiplayer delta", () => {
    const a = createTrack(), b = createTrack();
    buildTile(a, "road", 5, 5, 1); buildTile(b, "road", 5, 5, 1);
    setRoadTier(b, 5, 5, ROAD_TIER.highway);
    const d = diffTrack(a, b);
    expect(d.some((c) => c.tier === ROAD_TIER.highway)).toBe(true);
    applyTrackDelta(a, readTiles(b, [5 * 144 + 5]));
    expect(roadTierAt(a, 5, 5)).toBe(ROAD_TIER.highway);
  });
});

import { buildAllComponents, resolveConnection, type EconomyState, type Harvester } from "../../src/iso/economy";
import { GRASS, type Grid, type Industry } from "../../src/iso/grid";
import { INDUSTRY_BY_KEY } from "../../src/iso/config";
import { MAP_W as W, MAP_H as HH } from "../../src/game/config";

describe("ROADS-2 payouts follow the tier", () => {
  function scenario(tier: number | null) {
    const def = INDUSTRY_BY_KEY.farm;
    const farm: Industry = { id: 0, type: "farm", tx: 12, ty: 11, w: def.footprint[0], h: def.footprint[1], output: def.output, banditUntil: 0 };
    const occupancy = new Int16Array(W * HH).fill(-1);
    for (let y = farm.ty; y < farm.ty + farm.h; y++) for (let x = farm.tx; x < farm.tx + farm.w; x++) occupancy[y * W + x] = 0;
    const grid: Grid = { w: W, h: HH, terrain: new Uint8Array(W * HH).fill(GRASS), industries: [farm], occupancy, seed: 1 };
    const track = createTrack();
    for (let x = 6; x <= 20; x++) {
      buildTile(track, "road", x, 10, 1);
      if (tier !== null) setRoadTier(track, x, 10, tier as 0 | 1 | 2);
    }
    const h: Harvester = { id: 1, owner: "p1", ownerId: 1, tx: 10, ty: 11, facing: "ne" } as Harvester;
    const state: EconomyState = { grid, track, harvesters: [h], factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }] } as EconomyState;
    return resolveConnection(state, buildAllComponents(track, 1), h).multiplier;
  }
  it("Road is unchanged; Highway pays more; Street pays less", () => {
    const road = scenario(null);
    expect(road).toBe(TRANSPORT.road.throughput);
    expect(scenario(ROAD_TIER.highway)).toBeGreaterThan(road);
    expect(scenario(ROAD_TIER.street)).toBeLessThan(road);
  });
});
