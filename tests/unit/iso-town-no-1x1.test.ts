import { describe, expect, it } from "vitest";
import { generateMap, townBuildings } from "../../src/iso/grid";
import { TOWN_PARK_VARIANTS, TOWN_LAWN, TOWN_TREE_VARIANTS, buildingFootprint } from "../../src/iso/config";

const footprintOf = (s: string): [number, number] => buildingFootprint(s) ?? [1, 1];

describe("owner 2026-09-26: upgraded towns draw no 1×1 buildings", () => {
  // MAP-2 (#559) added the last group: an open town lot may draw a scenery
  // tree (`lotArtAt`), which is decal art, not a building either.
  it("every 1×1 item in a tier 1-3 town is a lot — park, lawn or tree", () => {
    for (const seed of [42, 1337]) {
      const grid = generateMap(seed);
      for (const t of grid.towns) for (const tier of [1, 2, 3]) for (const shapes of [false, true]) {
        for (const b of townBuildings(t, footprintOf, { tier, grid, shapes })) {
          const [fw, fh] = footprintOf(b.sprite);
          if (fw === 1 && fh === 1) {
            expect(
              [...TOWN_PARK_VARIANTS, TOWN_LAWN, ...TOWN_TREE_VARIANTS] as readonly string[],
              `${b.sprite} (seed ${seed}, tier ${tier})`,
            ).toContain(b.sprite);
          }
        }
      }
    }
  });
});
