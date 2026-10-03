import { describe, expect, it } from "vitest";
import { generateMap, townBuildings } from "../../src/iso/grid";
import { TOWN_PARK_VARIANTS, TOWN_LAWN, TOWN_TREE_VARIANTS, buildingFootprint } from "../../src/iso/config";

const footprintOf = (s: string): [number, number] => buildingFootprint(s) ?? [1, 1];

describe("owner 2026-09-26: upgraded towns draw no 1×1 buildings", () => {
  // MAP-2 (#559) added the last group: an open town lot may draw a scenery
  // tree (`lotArtAt`), which is decal art, not a building either.
  it("every 1×1 item in a tier 1 town is a lot — park, lawn or tree", () => {
    for (const seed of [42, 1337]) {
      const grid = generateMap(seed);
      for (const t of grid.towns) for (const tier of [1]) for (const shapes of [false, true]) {
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

// CITY-HOMES (owner, 2026-10-03) supersedes the rule above for GROWN cities (tier 2+): a free lot there is mostly a
// normal 1x1 home again, and the city must not sit in empty lawns.
describe("owner 2026-10-03: a grown city keeps its ordinary houses", () => {
  it("tier 3 on 3 seeds: >= 90% of the house lots are built on, nothing overlaps", () => {
    for (const seed of [42, 1337, 7]) {
      const grid = generateMap(seed);
      for (const t of grid.towns) {
        const items = townBuildings(t, footprintOf, { tier: 3, grid, shapes: false });
        const seen = new Set<string>();
        for (const b of items) {
          const [fw, fh] = footprintOf(b.sprite);
          for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) {
            const k = `${b.tx + dx},${b.ty + dy}`;
            expect(seen.has(k), `overlap at ${k} (seed ${seed})`).toBe(false);
            seen.add(k);
          }
        }
        const lots = t.houses.length;
        const built = t.houses.filter(([x, y]) => seen.has(`${x},${y}`)).length;
        expect(built / lots, `seed ${seed} town ${t.id}`).toBeGreaterThanOrEqual(0.9);
        const homes = items.filter((b) => /small_house|small_flat|cottage_old/.test(b.sprite)).length;
        expect(homes, `seed ${seed} town ${t.id} homes`).toBeGreaterThan(0);
      }
    }
  });
});
