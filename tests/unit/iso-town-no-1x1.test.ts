// ══════════════════════════════════════════════════════════════════════════
// What a SINGLE TILE of an upgraded town is allowed to draw.
//
// Owner (2026-09-26): upgraded towns drew no 1×1 building at all — a whole
// house squeezed onto one tile broke the door-height rule — so every single
// lot became a park, a lawn or (MAP-2, #559) a tree, and whole blocks took
// the 2×2 art.
//
// Owner playtest (2026-10-03), CITY-1 (#652): that went too far. "The second
// version of the upgraded city needs normal houses still. It is very empty
// too. Those empty spaces should have some normal town buildings." A tier 1+
// town now fills its free lots from the CURATED ordinary house pool
// (`TOWN_HOME_VARIANTS` — the 1×1 art that is authored to stand on one tile),
// keeping one lot in `TOWN_GREEN_LOT_IN` green.
//
// So the rule this file pins is no longer "nothing 1×1" but "nothing 1×1 that
// is not on a list": a single tile draws an open lot (park, lawn, tree) or a
// home from the pool, and never some other sprite that happens to be 1×1 —
// a village-only cottage, a cropped tower, or art the manifest does not have.
// The fill itself (how much of a city is built on, and that the mix is houses
// AND towers) is pinned in city-1-fill.test.ts.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { generateMap, townBuildings } from "../../src/iso/grid";
import {
  TOWN_HOME_VARIANTS, TOWN_LAWN, TOWN_PARK_VARIANTS, TOWN_TREE_VARIANTS,
  buildingFootprint,
} from "../../src/iso/config";

const footprintOf = (s: string): [number, number] => buildingFootprint(s) ?? [1, 1];

/** Open-lot art: what a tile draws when it is left unbuilt. */
const LOTS: readonly string[] = [...TOWN_PARK_VARIANTS, TOWN_LAWN, ...TOWN_TREE_VARIANTS];
/** CITY-1 (#652): the ordinary houses a lot may be built on instead. */
const ALLOWED: readonly string[] = [...LOTS, ...TOWN_HOME_VARIANTS];

describe("a 1×1 item in an upgraded town is an open lot or an ordinary home", () => {
  it("every 1×1 item in a tier 1-3 town comes from one of the two pools", () => {
    for (const seed of [42, 1337]) {
      const grid = generateMap(seed);
      for (const t of grid.towns) for (const tier of [1]) for (const shapes of [false, true]) {
        for (const b of townBuildings(t, footprintOf, { tier, grid, shapes })) {
          const [fw, fh] = footprintOf(b.sprite);
          if (fw === 1 && fh === 1) {
            expect(ALLOWED, `${b.sprite} (seed ${seed}, tier ${tier})`).toContain(b.sprite);
          }
        }
      }
    }
  });

  it("a LEGACY town still draws no 1×1 building — only open lots", () => {
    // The tier-less call is what every shipped map, room and story contract
    // uses. CITY-1 deliberately did not touch it: a 1×1 item there is still
    // a park, a lawn or a tree, exactly as before.
    for (const seed of [42, 1337]) {
      const grid = generateMap(seed);
      for (const t of grid.towns) for (const shapes of [false, true]) {
        for (const b of townBuildings(t, footprintOf, { shapes })) {
          const [fw, fh] = footprintOf(b.sprite);
          if (fw === 1 && fh === 1) {
            expect(LOTS, `${b.sprite} (seed ${seed}, LEGACY)`).toContain(b.sprite);
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
