// ══════════════════════════════════════════════════════════════════════════
// TOWN-GRID — town art sits on house BLOCKS, never on the streets.
//
// `townLayout` keeps houses off the street lanes, but the art used to be
// emitted one item per house TILE while a third of the town cells are
// authored on a 2x2 footprint (assets/buildings/manifest.json is the
// footprint authority). A 2x2 sprite anchored on one tile spans its east and
// south neighbours — the streets — so towers were drawn standing in the road
// and every tile of a block drew a building through its neighbours.
//
// `townBuildings` places those cells on whole 2x2 blocks instead. This pins
// the three properties that matters: no building overlaps a street tile, no
// two buildings overlap each other, and every house tile is still built on.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { generateMap, townBuildings, idx } from "../../src/iso/grid";
import { TOWN_HOUSE_VARIANTS } from "../../src/iso/config";

/** The runtime footprint source: the per-building layer manifest. */
const buildings = JSON.parse(readFileSync("assets/buildings/manifest.json", "utf8")) as {
  sprites: Record<string, { footprint: [number, number] }>;
};
const footprintOf = (sprite: string): [number, number] =>
  buildings.sprites[sprite]?.footprint ?? [1, 1];

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

describe("TOWN-GRID town art", () => {
  it("has multi-tile cells to place (otherwise this suite proves nothing)", () => {
    const multi = [...TOWN_HOUSE_VARIANTS, "town_center"]
      .filter((v) => footprintOf(v)[0] > 1 || footprintOf(v)[1] > 1);
    expect(multi.length).toBeGreaterThan(0);
  });

  it("never draws a building over a town street, and never over another", () => {
    let multi = 0;
    for (const seed of SEEDS) {
      const grid = generateMap(seed);
      expect(grid.towns.length).toBeGreaterThan(0);
      for (const t of grid.towns) {
        const houses = new Set(t.houses.map(([x, y]) => idx(x, y)));
        const streets = new Set(t.roads.map(([x, y]) => idx(x, y)));
        const covered = new Set<number>();
        for (const b of townBuildings(t, footprintOf)) {
          const [fw, fh] = footprintOf(b.sprite);
          if (fw > 1 || fh > 1) multi++;
          for (let dy = 0; dy < fh; dy++) {
            for (let dx = 0; dx < fw; dx++) {
              const i = idx(b.tx + dx, b.ty + dy);
              const at = `${b.sprite} at ${b.tx},${b.ty} (town ${t.id}, seed ${seed})`;
              expect(streets.has(i), `${at} covers a street`).toBe(false);
              expect(covered.has(i), `${at} overlaps another building`).toBe(false);
              covered.add(i);
              // The church is the one cell placed by position rather than by
              // the house list; every other cell must stand on houses.
              if (b.sprite !== "town_center") {
                expect(houses.has(i), `${at} covers a tile with no house`).toBe(true);
              }
            }
          }
        }
        for (const h of houses) expect(covered.has(h), `unbuilt house tile in town ${t.id}`).toBe(true);
      }
    }
    // The block path is actually exercised: without it the fix is untested.
    expect(multi).toBeGreaterThan(0);
  });

  it("is deterministic for a town", () => {
    const t = generateMap(11).towns[0];
    expect(townBuildings(t, footprintOf)).toEqual(townBuildings(t, footprintOf));
  });

  it("falls back to one house per tile while every cell is 1x1 (sheet art)", () => {
    // Before the per-building layers load, the monolith manifest reports 1x1
    // for every town cell — the layout must then be the per-tile one.
    const t = generateMap(3).towns[0];
    const items = townBuildings(t, () => [1, 1]);
    expect(items.length).toBe(t.houses.length + (t.houses.some(([x, y]) => x === t.tx && y === t.ty) ? 0 : 1));
  });
});
