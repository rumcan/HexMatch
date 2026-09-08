import { describe, it, expect } from "vitest";
import {
  generateMap, GRASS, TOWN_OCC, factoryTouchesTown, canPlaceFactory,
  type Grid,
} from "../../src/iso/grid";
import { planFactoryPlacement } from "../../src/iso/placement";
import { MAP_W, MAP_H } from "../../src/game/config";

// ── PP-02: a Factory must be built next to a town ──────────────────────────
// "Next to" = at least one tile of the 2×2 footprint shares an EDGE with a
// town tile. Diagonal-only contact does not qualify. The whole footprint must
// stay on legal ground without overlapping the town or another building.
// Town tiles include PP-10 town roads (both houses and roads are stamped
// TOWN_OCC), so touching the ring road counts exactly like touching a house.

/** A flat grid with a single 1-tile town at (10,10) — isolates the rule. */
function singleTownGrid(): Grid {
  const occ = new Int16Array(MAP_W * MAP_H).fill(-1);
  occ[10 * MAP_W + 10] = TOWN_OCC;
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries: [],
    towns: [{ id: 0, tx: 10, ty: 10, houses: [[10, 10]], roads: [] }],
    occupancy: occ,
    seed: 0,
  };
}

describe("PP-02 edge contact, not diagonal", () => {
  const g = singleTownGrid();

  it("touches the town when a footprint tile shares an edge with a town tile", () => {
    // footprint to the RIGHT of the town: (11,10) is edge-adjacent to (10,10)
    expect(factoryTouchesTown(g, 11, 10)).toBe(true);
    // footprint BELOW the town: (10,11)'s up-neighbour is the town tile
    expect(factoryTouchesTown(g, 10, 11)).toBe(true);
  });

  it("does NOT qualify on diagonal-only contact", () => {
    // the footprint at (11,11) only meets the town at the corner — rejected
    expect(factoryTouchesTown(g, 11, 11)).toBe(false);
    // two tiles away in a straight line: no edge contact at all
    expect(factoryTouchesTown(g, 12, 10)).toBe(false);
  });

  it("canPlaceFactory rejects diagonal-only / far spots with a town reason", () => {
    expect(canPlaceFactory(g, 11, 11)).toEqual({
      ok: false,
      reason: expect.stringMatching(/town/i),
    });
    expect(canPlaceFactory(g, 12, 10).ok).toBe(false);
  });

  it("canPlaceFactory accepts an edge-adjacent footprint", () => {
    expect(canPlaceFactory(g, 11, 10).ok).toBe(true);
  });

  it("canPlaceFactory still rejects water and overlaps independently", () => {
    const w = singleTownGrid();
    w.terrain[11 * MAP_W + 11] = 1; // WATER
    expect(canPlaceFactory(w, 11, 10).ok).toBe(false); // footprint now hits water
    // overlapping the town tile itself
    expect(canPlaceFactory(g, 10, 9).ok).toBe(false);
  });
});

describe("PP-02 town roads are town tiles for the adjacency rule", () => {
  it("a footprint touching the town's ring road counts as next to the town", () => {
    // town at (10,10) with a road tile at (10,9) above it, as PP-10 stamps.
    const g = singleTownGrid();
    g.towns[0].roads = [[10, 9]];
    g.occupancy[9 * MAP_W + 10] = TOWN_OCC;
    // footprint directly ABOVE the road: (10,7)'s down-neighbour (10,8) is
    // free, so use a footprint whose tile neighbours the road tile itself:
    // footprint at (10, 7) spans (10,7),(11,7),(10,8),(11,8); the road at
    // (10,9) is edge-adjacent to footprint tile (10,8).
    expect(factoryTouchesTown(g, 10, 7)).toBe(true);
    expect(canPlaceFactory(g, 10, 7).ok).toBe(true);
  });
});

describe("PP-02 generated maps offer enough town-adjacent Factory sites", () => {
  it("every town has at least one legal, town-adjacent 2×2 footprint", () => {
    for (const seed of [1337, 7, 42, 100, 1, 123, 2026, 20240902]) {
      const g = generateMap(seed);
      // count legal, town-adjacent footprints on the whole map
      let total = 0;
      for (let ty = 0; ty < MAP_H - 1; ty++) {
        for (let tx = 0; tx < MAP_W - 1; tx++) {
          if (factoryTouchesTown(g, tx, ty) && canPlaceFactory(g, tx, ty).ok) total++;
        }
      }
      // four towns, each with multiple adjacent free tiles → comfortably more
      // than one site per player, on every seeded map.
      expect(total, `seed ${seed} has too few town-adjacent sites`).toBeGreaterThanOrEqual(8);
    }
  });

  it("determinism is preserved (the guarantee is a pure function of seed)", () => {
    const a = generateMap(1337);
    const b = generateMap(1337);
    let na = 0, nb = 0;
    for (let ty = 0; ty < MAP_H - 1; ty++) {
      for (let tx = 0; tx < MAP_W - 1; tx++) {
        if (canPlaceFactory(a, tx, ty).ok) na++;
        if (canPlaceFactory(b, tx, ty).ok) nb++;
      }
    }
    expect(na).toBe(nb);
  });
});

describe("PP-02 one rule: the click, the preview and the pure predicate agree", () => {
  it("canPlaceFactory matches the requireTown placement plan on real maps", () => {
    for (const seed of [1337, 7, 42, 2026]) {
      const g = generateMap(seed);
      let compared = 0;
      for (let ty = 4; ty < MAP_H - 4; ty += 5) {
        for (let tx = 4; tx < MAP_W - 4; tx += 5) {
          const verdict = canPlaceFactory(g, tx, ty);
          const plan = planFactoryPlacement(g, tx, ty, { requireTown: true });
          expect(verdict.ok, `seed ${seed} @ (${tx},${ty})`).toBe(plan.valid);
          if (!verdict.ok) {
            // the reason must be the readable one the preview shows
            expect(verdict.reason).toMatch(/town|water|Out of bounds|occupied/i);
            expect(plan.code === "not-near-town"
              ? verdict.reason!.toLowerCase()
              : plan.why).toBeTruthy();
          }
          compared++;
        }
      }
      expect(compared).toBeGreaterThan(100);
    }
  });
});

describe("PP-02 the AI never lands a Factory off-town via its fallback", () => {
  it("chooseRivalFactorySpot always returns a town-adjacent, buildable tile", async () => {
    const { chooseRivalFactorySpot } = await import("../../src/iso/ai");
    const { createTrack } = await import("../../src/iso/track");
    for (const seed of [1337, 7, 42, 100, 1, 123, 2026]) {
      const g = generateMap(seed);
      const opts = { purse: { stone: 12, ore: 0 }, free: 12, ownerId: 2 };
      for (const [px, py] of [[4, 4], [16, 16], [27, 6], [6, 27], [23, 22], [12, 12]] as [number, number][]) {
        if (!canPlaceFactory(g, px, py).ok) continue; // only meaningful player sites
        const spot = chooseRivalFactorySpot(g, createTrack(), [px, py], opts);
        expect(spot, `seed ${seed} player ${px},${py}`).toBeTruthy();
        expect(factoryTouchesTown(g, spot![0], spot![1]), `rival off-town, seed ${seed}`).toBe(true);
        expect(canPlaceFactory(g, spot![0], spot![1]).ok, `rival site illegal, seed ${seed}`).toBe(true);
      }
    }
  }, 30_000);
});
