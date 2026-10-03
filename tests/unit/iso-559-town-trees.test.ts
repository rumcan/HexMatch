import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildingFootprint, MAP_W, TOWN_LAWN, TOWN_TREE_VARIANTS } from "../../src/iso/config";
import {
  TREE_SPRITES, TOWN_TREE_REACH, TOWN_TREE_STREET_CLEARANCE, scatterScenery,
} from "../../src/iso/scenery";
import {
  GRASS, ROUGH, generateMap, grownTownHouses, idx, setTownLevel, townBuildings,
  townGrownRings,
} from "../../src/iso/grid";

/**
 * MAP-2 (#559), items 2 and 3 — TREES IN TOWNS, and no bare lots.
 *
 * The owner's report: "towns need trees … on open town lots and grass gaps",
 * and a city upgrade "leaves big empty grass fields". The two are one layout
 * question asked from opposite sides, so they are pinned together here:
 *
 *   • every house tile a town owns gets a draw item — including the leftover
 *     tiles of a clipped or merged block, which used to be bare grass;
 *   • the items those lots draw are a mix of trees, parks and lawn, so a town
 *     looks planted rather than paved;
 *   • the gap ring around a town's own ground carries the scenery tree bits.
 *
 * Seeds are the all-option maps (rivers + elevation + shapes + rings) because
 * they are the ones the owner plays.
 */

const ALL_ON = { rivers: true, elevation: true, shapes: true, rings: true };
const SEEDS = [1, 7, 42, 99, 1234];
const footprintOf = (s: string): [number, number] => buildingFootprint(s) ?? [1, 1];
const TREE_LOTS = new Set<string>(TOWN_TREE_VARIANTS);

/** The tiles a town's own ground covers: centre, houses and streets. */
const groundOf = (t: { tx: number; ty: number; houses: [number, number][]; roads: [number, number][] }) => {
  const ground = new Set<number>();
  ground.add(idx(t.tx, t.ty));
  for (const [hx, hy] of t.houses) ground.add(idx(hx, hy));
  for (const [rx, ry] of t.roads) ground.add(idx(rx, ry));
  return ground;
};

describe("MAP-2 (#559) trees in towns", () => {
  it("draws the town trees from the scenery art the game actually ships", () => {
    const manifest = JSON.parse(readFileSync("assets/scenery/manifest.json", "utf8"));
    expect(TOWN_TREE_VARIANTS.length).toBeGreaterThan(3);
    for (const name of TOWN_TREE_VARIANTS) {
      // A name the scenery scatter knows AND the art tool cut...
      expect(TREE_SPRITES).toContain(name);
      const def = manifest.sprites[name];
      expect(def).toBeTruthy();
      // ...as a 1×1 lot, which is the only footprint `lotArtAt` can place.
      expect(def.footprint).toEqual([1, 1]);
      expect(footprintOf(name)).toEqual([1, 1]);
      // A dead trunk never stands on a town lot.
      expect(name.startsWith("tree_dead")).toBe(false);
    }
  });

  it("gives every house tile a draw item — no bare lots, in either layout", () => {
    for (const seed of SEEDS) {
      const grid = generateMap(seed, ALL_ON);
      const town = grid.towns[0];
      setTownLevel(town, 3);
      const ring = new Set(grownTownHouses(town, grid, townGrownRings(3)).map(([x, y]) => idx(x, y)));
      const owns = new Set([...groundOf(town), ...ring]);
      for (const shapes of [false, true]) {
        const laid = townBuildings(town, footprintOf, { tier: 3, grid, shapes });
        const covered = new Set<number>();
        for (const b of laid) {
          const [fw, fh] = footprintOf(b.sprite);
          for (let dy = 0; dy < fh; dy++) {
            for (let dx = 0; dx < fw; dx++) {
              const i = idx(b.tx + dx, b.ty + dy);
              // Village art never reaches a tile this town does not own.
              expect(owns.has(i)).toBe(true);
              covered.add(i);
            }
          }
        }
        for (const [hx, hy] of town.houses) expect(covered.has(idx(hx, hy))).toBe(true);
        for (const i of ring) expect(covered.has(i)).toBe(true);
      }
    }
  });

  it("plants the open lots with trees, parks and lawn — not one flat field", () => {
    // CITY-1 (#652) changed what an OPEN LOT is. A single tile of an upgraded
    // town now takes an ordinary house, and only the lots this ticket's green
    // sprinkle keeps (one in `TOWN_GREEN_LOT_IN`) stay open — so "the lots"
    // here are the tiles that drew open-lot art, not every 1×1 item on the
    // map. The mix WITHIN them is still #559's: trees lead, then parks, then
    // lawn. That the rest of the town is built on is city-1-fill.test.ts.
    for (const seed of SEEDS) {
      const grid = generateMap(seed, ALL_ON);
      const town = grid.towns[0];
      setTownLevel(town, 3);
      const laid = townBuildings(town, footprintOf, { tier: 3, grid, shapes: true });
      const isPark = (s: string) => s.startsWith("park_") || s.startsWith("town_fountain");
      const lots = laid.filter((b) => TREE_LOTS.has(b.sprite) || isPark(b.sprite) || b.sprite === TOWN_LAWN);
      const trees = lots.filter((b) => TREE_LOTS.has(b.sprite));
      const parks = lots.filter((b) => isPark(b.sprite));
      expect(trees.length).toBeGreaterThan(0);
      expect(lots.length).toBeGreaterThan(3);
      // Trees are the majority of the lots (the mix is 55/15/30), and a lot is
      // never left as a bare tile without art.
      expect(trees.length * 2).toBeGreaterThan(lots.length / 2);
      expect(trees.length + parks.length).toBeLessThanOrEqual(lots.length);
      for (const tree of trees) expect(TOWN_LAWN).not.toBe(tree.sprite);
    }
  });

  it("scatters the town trees on the gap ring only, clear of every street", () => {
    for (const seed of SEEDS) {
      const grid = generateMap(seed, ALL_ON);
      const town = grid.towns[0];
      const scenery = scatterScenery(grid);
      const ground = groundOf(town);
      const streets = new Set<number>([
        ...town.roads.map(([x, y]) => idx(x, y)),
        ...(grid.publicRoads ?? []).map(([x, y]) => idx(x, y)),
      ]);
      const near = (set: Set<number>, x: number, y: number, r: number): boolean => {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) if (set.has(idx(x + dx, y + dy))) return true;
        }
        return false;
      };
      let eligible = 0, planted = 0;
      for (let i = 0; i < scenery.trees.length; i++) {
        const x = i % MAP_W, y = (i / MAP_W) | 0;
        const inRing = near(ground, x, y, TOWN_TREE_REACH);
        if (scenery.trees[i] && inRing) {
          planted++;
          // A town tree stands on open grass and never where its canopy would
          // hang over a street.
          expect(ground.has(i)).toBe(false);
          expect(grid.occupancy[i]).toBe(-1);
          expect([GRASS, ROUGH]).toContain(grid.terrain[i]);
          expect(near(streets, x, y, TOWN_TREE_STREET_CLEARANCE - 1)).toBe(false);
        }
        if (!inRing || ground.has(i)) continue;
        if (grid.occupancy[i] !== -1) continue;
        if (grid.terrain[i] !== GRASS && grid.terrain[i] !== ROUGH) continue;
        if (near(streets, x, y, TOWN_TREE_STREET_CLEARANCE - 1)) continue;
        eligible++;
      }
      // The ring has gaps to plant (a town is not wall-to-wall buildings) and
      // the pass actually plants them.
      expect(eligible).toBeGreaterThan(10);
      expect(planted).toBeGreaterThan(5);
      expect(planted).toBeLessThanOrEqual(eligible);
    }
  });

  it("is a pure function of the seed, and does not disturb the country scatter", () => {
    const grid = generateMap(42, ALL_ON);
    const a = scatterScenery(grid);
    const b = scatterScenery(generateMap(42, ALL_ON));
    expect(Array.from(a.trees)).toEqual(Array.from(b.trees));
    expect(a.decals).toEqual(b.decals);
    // The country scatter still keeps its own distance from the town streets.
    const town = grid.towns[0];
    const streets = new Set(town.roads.map(([x, y]) => idx(x, y)));
    const ground = groundOf(town);
    let farTrees = 0;
    for (let i = 0; i < a.trees.length; i++) {
      if (!a.trees[i] || ground.has(i)) continue;
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      let nearStreet = false;
      for (let dy = -2; dy <= 2 && !nearStreet; dy++) {
        for (let dx = -2; dx <= 2 && !nearStreet; dx++) nearStreet = streets.has(idx(x + dx, y + dy));
      }
      if (!nearStreet) farTrees++;
    }
    expect(farTrees).toBeGreaterThan(100);
  });
});
