// RAIL-7 (#603) — the station placement ghost shows the old platform — draw what will be placed.
//
// Acceptance: a unit test asserts that the ghost's sprite keys equal the placed
// structure's sprite keys for every rotation.
//
// The ghost and the placed structure must call the same draw function / sprite
// lookup (rail-art.ts / rail-renderer.ts / renderer.ts), so they can't drift
// again. We assert that here by comparing the ghost helpers
// (platformGhostItems / depotGhostItems / laneGhostItems) against
// railStructureItems — the function the renderer uses to draw placed stations.

import { describe, it, expect } from "vitest";
import {
  createRailState,
  placePlatform,
  placeDepot,
  addStationLane,
  railStructureItems,
  platformGhostItems,
  depotGhostItems,
  laneGhostItems,
  laneOriginAt,
  stationLanes,
  stationWhSprite,
  laneSlabSprite,
  stationCapSprite,
  depotSprite,
  RAIL_VIEWS,
  type RailView,
} from "../../src/iso/rail";
import { createTrack } from "../../src/iso/track";
import { GRASS, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";

function flatGrid(): Grid {
  return {
    w: MAP_W,
    h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries: [],
    towns: [],
    occupancy: new Int16Array(MAP_W * MAP_H).fill(-1),
    seed: 7,
  };
}

const hasAllStationArt = { has: () => true };

describe("RAIL-7 ghost draws what will be placed", () => {
  for (const view of RAIL_VIEWS as readonly RailView[]) {
    it(`platform ghost equals placed 1-lane station for view ${view}`, () => {
      const tx = 10, ty = 10;
      // Ghost items — what the hover preview will draw
      const ghost = platformGhostItems(tx, ty, view, hasAllStationArt);
      // Placed structure items — what railStructureItems draws for a real station
      const state = createRailState();
      const s = placePlatform(state, "you", 1, tx, ty, view, { kind: "industry", id: 1, tiles: [] });
      // stationLanes materialises lane 0, so railStructureItems will draw
      // warehouse + two slabs + cap (a four-long lane)
      const placed = railStructureItems(state, hasAllStationArt);

      // One source of truth: same sprite lookup
      expect(ghost[0].sprite).toBe(stationWhSprite(1, view));
      expect(ghost[1].sprite).toBe(laneSlabSprite(view));
      expect(ghost[2].sprite).toBe(laneSlabSprite(view));
      expect(ghost[3].sprite).toBe(stationCapSprite(view));

      // Ghost's sprite keys equal placed structure's sprite keys, same order, same tiles
      expect(ghost.map((g) => [g.sprite, g.tx, g.ty])).toEqual(
        placed.map((p) => [p.sprite, p.tx, p.ty]),
      );

      // Also check the structure we placed has the expected view
      expect(s.view).toBe(view);
      expect(stationLanes(s)).toHaveLength(1);
    });

    it(`depot ghost equals placed depot for view ${view}`, () => {
      const tx = 20, ty = 20;
      const ghost = depotGhostItems(tx, ty, view);
      const state = createRailState();
      placeDepot(state, "you", 1, tx, ty, view);
      const placed = railStructureItems(state, hasAllStationArt);

      expect(ghost[0].sprite).toBe(depotSprite(view));
      expect(ghost.map((g) => [g.sprite, g.tx, g.ty])).toEqual(
        placed.map((p) => [p.sprite, p.tx, p.ty]),
      );
    });

    it(`lane upgrade ghost equals the new lane that will be placed for view ${view}`, () => {
      const tx = 30, ty = 30;
      const grid = flatGrid();
      const track = createTrack();
      const state = createRailState();
      const s = placePlatform(state, "you", 1, tx, ty, view, { kind: "industry", id: 2, tiles: [] });

      // Where a new lane on side +1 would start
      const origin = laneOriginAt(s, 1);
      const ghost = laneGhostItems(origin.tx, origin.ty, view);

      // Ghost uses same sprite lookup as placed lane
      expect(ghost[0].sprite).toBe(laneSlabSprite(view));
      expect(ghost[1].sprite).toBe(laneSlabSprite(view));
      expect(ghost[2].sprite).toBe(laneSlabSprite(view));
      expect(ghost[3].sprite).toBe(stationCapSprite(view));

      // Add the lane for real and check that the new lane's tiles are exactly the ghost's tiles
      const res = addStationLane(grid, track, state, 1, s.id, 1);
      expect(res.ok).toBe(true);
      const placedAfter = railStructureItems(state, hasAllStationArt);

      // placedAfter contains warehouse tier 2 + lane0 (2 slabs+cap) + lane1 (3 slabs+cap) = 8 items
      // The new lane's 4 items should be the last 4 of placedAfter (lane1)
      const newLanePlaced = placedAfter.slice(-4);
      expect(ghost.map((g) => [g.sprite, g.tx, g.ty])).toEqual(
        newLanePlaced.map((p) => [p.sprite, p.tx, p.ty]),
      );
    });
  }

  it("platform ghost is warehouse + middle slabs + cap, using same helpers as placed", () => {
    // Extra explicit check that the helper itself is built from the shared tile helpers
    const view: RailView = "sw";
    const tx = 5, ty = 5;
    const ghost = platformGhostItems(tx, ty, view);
    expect(ghost).toHaveLength(4);
    expect(ghost[0]).toEqual({ sprite: stationWhSprite(1, view), tx, ty });
    // middle slabs are the second and third tiles of the 4-tile footprint
    expect(ghost[1].tx).not.toBe(tx);
    expect(ghost[2].tx).not.toBe(ghost[1].tx);
    expect(ghost[3].sprite).toBe(stationCapSprite(view));
  });
});

describe("RAIL-7 ghost while the station art is still loading", () => {
  it("falls back to the same old-platform sprite the placed station would draw", () => {
    const noStationArt = { has: () => false };
    const ghost = platformGhostItems(10, 10, "ne", noStationArt);
    const state = createRailState();
    placePlatform(state, "you", 1, 10, 10, "ne", { kind: "industry", id: 1, tiles: [] });
    const placed = railStructureItems(state, noStationArt);
    expect(ghost.map((g) => [g.sprite, g.tx, g.ty])).toEqual(placed.map((p) => [p.sprite, p.tx, p.ty]));
  });
});
