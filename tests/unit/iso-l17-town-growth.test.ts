import { TOWN_PARK_VARIANTS, TOWN_VILLAGE_BLOCKS } from "../../src/iso/config";
// ══════════════════════════════════════════════════════════════════════════
// L17 (#245) — towns grow visually: village → town → city.
//
// Every town starts a new-loop game as a VILLAGE: small 1×1 homes around the
// church. Streets remain paved with sidewalks at every town tier, while a
// further upgrade grows the FOOTPRINT (visual-only). `__iso.setTownLevel`
// drives it for art review.
//
// What this file pins, all in the pure modules:
//
//   • the tier art — village smalls only + town_center; tier 1 swaps the
//     centre for town_bank and restores today's mix; tier 2+ adds the grown
//     ring on free land only; LEGACY (no tier) is byte-for-byte today's look;
//   • the street look — every town tier renders continuous PAVED roads with
//     sidewalks, lamps and paved block ground. The BYTES stay unchanged at
//     every tier: paving rules are the town's at every tier (ownership,
//     routing, truck speed), only the building look changes;
//   • THE TICKET'S RULE — no gameplay changes with town tier: occupancy,
//     factory placement, plant adjacency, catchments and the public-road
//     network are byte-identical at tier 0 and at the top tier;
//   • the upgrade table — one row per growth step, +50% each.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  TOWN_OCC, generateMap, grownTownHouses, idx, seedTownLevels, setTownLevel,
  townBuildings, townGrownRings, townTier, townVillageBytes,
  type Town,
} from "../../src/iso/grid";
import {
  STORAGE_CAP_BASE, TOWN_HOUSE_VARIANTS, TOWN_TIER_LEGACY, TOWN_UPGRADES,
  TOWN_VILLAGE_VARIANTS, TOWN_VISUAL_MAX, townCentreSprite, townTierLabel,
} from "../../src/iso/config";
import { createTrack, seedPublicRoads, seedTownRoads } from "../../src/iso/track";
import { roadTilesIn, townGroundQuadsIn, type RoadWorld } from "../../src/iso/road-renderer";
import { factoryQualifyingTowns } from "../../src/iso/placement";
import { publicRoadTiles } from "../../src/iso/grid";

/** The runtime footprint source: the per-building layer manifest. */
const buildings = JSON.parse(readFileSync("assets/buildings/manifest.json", "utf8")) as {
  sprites: Record<string, { footprint: [number, number] }>;
};
const footprintOf = (sprite: string): [number, number] =>
  buildings.sprites[sprite]?.footprint ?? [1, 1];

/** One generated map reused by the art tests (towns are seed-derived). */
const grid = generateMap(21);
const town = grid.towns[0];
const townSet = new Set(town.houses.map(([x, y]) => idx(x, y)));

/** The centre item of a laid-out town, if any. */
const centreOf = (items: ReturnType<typeof townBuildings>, t: Town) =>
  items.find((b) => b.tx === t.tx && b.ty === t.ty && footprintOf(b.sprite)[0] > 1);

describe("L17 tier art — village (0)", () => {
  it("draws no 1×1 buildings: low 2×2 homes and 1×1 parks, plus the town_center", () => {
    const items = townBuildings(town, footprintOf, { tier: 0 });
    const centre = centreOf(items, town);
    expect(centre?.sprite).toBe("town_center");
    for (const b of items) {
      const [fw, fh] = footprintOf(b.sprite);
      if (b.tx === town.tx && b.ty === town.ty) continue;   // the centre block
      // Owner (2026-09-26): a 1×1 tile is a park/garden, never a building.
      if (fw === 1 && fh === 1) {
        expect(TOWN_PARK_VARIANTS as readonly string[], `${b.sprite} on one tile must be a park`).toContain(b.sprite);
      } else {
        expect(TOWN_VILLAGE_BLOCKS as readonly string[], `${b.sprite} is not a village home`).toContain(b.sprite);
      }
    }
  });

  it("still builds on every house tile, and never on a street", () => {
    const items = townBuildings(town, footprintOf, { tier: 0 });
    const streets = new Set(town.roads.map(([x, y]) => idx(x, y)));
    const covered = new Set<number>();
    for (const b of items) {
      const [fw, fh] = footprintOf(b.sprite);
      for (let dy = 0; dy < fh; dy++) {
        for (let dx = 0; dx < fw; dx++) {
          const i = idx(b.tx + dx, b.ty + dy);
          expect(streets.has(i)).toBe(false);
          covered.add(i);
        }
      }
    }
    for (const h of townSet) expect(covered.has(h)).toBe(true);
  });

  it("picks within the village list by the same tile hash — no flicker on re-render", () => {
    expect(townBuildings(town, footprintOf, { tier: 0 })).toEqual(
      townBuildings(town, footprintOf, { tier: 0 }));
  });
});

describe("L17 tier art — town (1) and city (2+)", () => {
  it("tier 1: the centre is the BANK, and the full building mix is back", () => {
    const items = townBuildings(town, footprintOf, { tier: 1 });
    const centre = centreOf(items, town);
    expect(centre?.sprite).toBe("town_bank");
    expect(items.some((b) => b.sprite === "town_center")).toBe(false);
    // The full mix: some whole-block (2×2) art beyond the centre itself.
    const multi = items.filter((b) => {
      const [fw, fh] = footprintOf(b.sprite);
      return (fw > 1 || fh > 1) && !(b.tx === town.tx && b.ty === town.ty);
    });
    expect(multi.length).toBeGreaterThan(0);
    expect(townBuildings(town, footprintOf, { tier: 1 })).toEqual(
      townBuildings(town, footprintOf, { tier: 1 }));
  });

  it("tier 2: the footprint grows onto free land outside the built extent", () => {
    const ring = grownTownHouses(town, grid, townGrownRings(2));
    expect(ring.length).toBeGreaterThan(0);
    const publicRoads = new Set(publicRoadTiles(grid.towns, grid.terrain, grid.occupancy)
      .map(([x, y]) => idx(x, y)));
    for (const [x, y] of ring) {
      const i = idx(x, y);
      expect(townSet.has(i), "a grown tile inside the old footprint").toBe(false);
      expect(grid.terrain[i]).not.toEqual(1 /* WATER */);
      expect(grid.occupancy[i]).toBe(-1);
      expect(publicRoads.has(i), "a grown tile on the inter-town highway").toBe(false);
    }
    // …and the laid-out town then draws on those tiles too.
    const items = townBuildings(town, footprintOf, { tier: 2, grid });
    const covered = new Set<number>();
    for (const b of items) {
      const [fw, fh] = footprintOf(b.sprite);
      for (let dy = 0; dy < fh; dy++) {
        for (let dx = 0; dx < fw; dx++) covered.add(idx(b.tx + dx, b.ty + dy));
      }
    }
    for (const [x, y] of ring) expect(covered.has(idx(x, y))).toBe(true);
  });

  it("tier 3 grows further than tier 2, and TOWN_VISUAL_MAX caps the look", () => {
    expect(townGrownRings(2)).toBe(1);
    expect(townGrownRings(3)).toBe(2);
    expect(grownTownHouses(town, grid, 2).length)
      .toBeGreaterThan(grownTownHouses(town, grid, 1).length);
    expect(setTownLevel(town, 99)).toBe(true);
    expect(townTier(town)).toBe(TOWN_VISUAL_MAX);
    setTownLevel(town, 0);
  });

  it("LEGACY (no tier) is today's look, byte for byte", () => {
    expect(townBuildings(town, footprintOf)).toEqual(townBuildings(town, footprintOf));
    expect(townBuildings(town, footprintOf)).toEqual(
      townBuildings(town, footprintOf, { tier: TOWN_TIER_LEGACY }));
    expect(centreOf(townBuildings(town, footprintOf), town)?.sprite).toBe("town_center");
    // ...and the full list is still what a block pick runs on.
    expect(TOWN_HOUSE_VARIANTS.length).toBeGreaterThan(TOWN_VILLAGE_VARIANTS.length);
  });
});

// ── the street look ──────────────────────────────────────────────────────────
function roadWorld(): { world: RoadWorld; roads: [number, number][] } {
  const track = createTrack(grid);
  seedTownRoads(track, grid);
  seedPublicRoads(track, grid);
  return { world: { grid, roadBits: track.road, dirtBits: track.dirt }, roads: town.roads };
}

describe("L17 street look per tier", () => {
  it("a village's streets are paved, joined, and have sidewalks", () => {
    const { world, roads } = roadWorld();
    seedTownLevels(grid, 0);                       // the new loop's boot state
    const [rx, ry] = roads[0];
    const tiles = roadTilesIn(world, rx, ry, rx, ry);
    expect(tiles.length).toBe(1);
    expect(tiles[0].material).toBe("paved");
    expect(tiles[0].sidewalk).toBe(true);
    // Block paving is present from game start, so no grass wedges show between
    // the road tiles.
    expect(townGroundQuadsIn(world, town.tx - 12, town.ty - 12, town.tx + 12, town.ty + 12)
      .length).toBeGreaterThan(0);
  });

  it("upgrading preserves the same paved streetscape", () => {
    const { world, roads } = roadWorld();
    const [rx, ry] = roads[0];
    const looks = [0, 1, TOWN_VISUAL_MAX].map((level) => {
      seedTownLevels(grid, level);
      const tile = roadTilesIn(world, rx, ry, rx, ry)[0];
      return [tile.material, tile.sidewalk, townGroundQuadsIn(
        world, town.tx - 12, town.ty - 12, town.tx + 12, town.ty + 12,
      ).length] as const;
    });
    expect(looks[0]).toEqual(looks[1]);
    expect(looks[1]).toEqual(looks[2]);
  });

  it("the BYTES never change — paving rules are the town's at every tier", () => {
    const track = createTrack(grid);
    seedTownRoads(track, grid);
    const bytes = Uint8Array.from(track.road);
    seedTownLevels(grid, 0);
    expect(Uint8Array.from(track.road)).toEqual(bytes);
    seedTownLevels(grid, TOWN_VISUAL_MAX);
    expect(Uint8Array.from(track.road)).toEqual(bytes);
    // ...and the village byte-read is what flips (the look), nothing else.
    const [vx, vy] = town.roads[0];
    seedTownLevels(grid, 0);
    const village = townVillageBytes(grid);
    expect(village).not.toBeNull();
    expect(village![vy * grid.w + vx]).toBe(1);
    setTownLevel(town, TOWN_VISUAL_MAX);
    expect(townVillageBytes(grid)![vy * grid.w + vx]).toBe(0);
    seedTownLevels(grid, TOWN_TIER_LEGACY);
  });
});

// ── THE TICKET'S RULE: no gameplay rule changes with town tier ───────────────
describe("L17 invariance — tier changes no rule", () => {
  it("occupancy, factory adjacency, plant towns and the highway are identical", () => {
    const occ0 = Uint8Array.from(grid.occupancy, (v) => v & 0xff);
    const highway0 = publicRoadTiles(grid.towns, grid.terrain, grid.occupancy);
    // Factory placement + plant adjacency over a spread of free tiles.
    const verdicts = (() => {
      const out: [number, number, Town[]][] = [];
      for (const t of grid.towns) {
        for (let dy = -13; dy <= 13; dy++) {
          for (let dx = -13; dx <= 13; dx++) {
            const x = t.tx + dx, y = t.ty + dy;
            if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) continue;
            if (grid.terrain[idx(x, y)] === 1 || grid.occupancy[idx(x, y)] !== -1) continue;
            out.push([x, y, factoryQualifyingTowns(grid, x, y)]);
          }
        }
      }
      return out;
    })();

    seedTownLevels(grid, TOWN_VISUAL_MAX);          // the loudest tier
    townBuildings(town, footprintOf, { tier: TOWN_VISUAL_MAX, grid }); // the art runs
    grownTownHouses(town, grid, townGrownRings(TOWN_VISUAL_MAX));

    expect(Uint8Array.from(grid.occupancy, (v) => v & 0xff)).toEqual(occ0);
    expect(publicRoadTiles(grid.towns, grid.terrain, grid.occupancy)).toEqual(highway0);
    for (const t of grid.towns) {
      // The grown ring never claimed tiles: every town tile is still exactly
      // the generated ones (houses stamped TOWN_OCC, nothing else).
      for (const [x, y] of [...t.houses, ...t.roads]) {
        expect(grid.occupancy[idx(x, y)]).toBe(TOWN_OCC);
      }
    }
    let checked = 0;
    for (const [x, y, towns0] of verdicts) {
      const towns1 = factoryQualifyingTowns(grid, x, y);
      expect(towns1.map((t) => t.id)).toEqual(towns0.map((t) => t.id));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    seedTownLevels(grid, TOWN_TIER_LEGACY);         // leave the shared map as it was
  });
});

describe("L17 upgrade table + tier names", () => {
  it("one row per growth step, +50% each, storage rising with them", () => {
    expect(TOWN_UPGRADES.length).toBe(3);
    for (let i = 0; i < TOWN_UPGRADES.length; i++) {
      expect(TOWN_UPGRADES[i].level).toBe(i + 1);
      // The ceilings STACK: row N is worth +50% × N total (0.5 / 1.0 / 1.5),
      // because the settlement replaces `townBonus` with the bought row's
      // number — the owner's "each upgrade adds 50% to the yields".
      expect(TOWN_UPGRADES[i].bonus).toBe(0.5 * (i + 1));
      expect(TOWN_UPGRADES[i].storage).toBeGreaterThan(0);
    }
    // The opening still fits under the base cap (L16's rule the rows ride).
    const biggest = Math.max(...TOWN_UPGRADES.map((r) => Math.max(0, ...Object.values(r.cost))));
    expect(STORAGE_CAP_BASE).toBeGreaterThanOrEqual(biggest);
  });

  it("the centre sprite and label follow the tier", () => {
    expect(townCentreSprite(0)).toBe("town_center");
    expect(townCentreSprite(1)).toBe("town_bank");
    expect(townCentreSprite(TOWN_VISUAL_MAX)).toBe("town_bank");
    expect(townTierLabel(0)).toBe("village");
    expect(townTierLabel(1)).toBe("town");
    expect(townTierLabel(2)).toBe("city");
    expect(townTierLabel(3)).toBe("metropolis");
  });
});
