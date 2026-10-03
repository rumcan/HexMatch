// ══════════════════════════════════════════════════════════════════════════
// CITY-1 (#652) — an upgraded city keeps NORMAL HOUSES, and fills its lots.
//
// Owner playtest (2026-10-03): "The second version of the upgraded city needs
// normal houses still. It is very empty too. Those empty spaces should have
// some normal town buildings."
//
// What it was. From the first upgrade on, a town drew no 1×1 building at all
// (the 2026-09-26 direction): every whole block took one 2×2 tower, the grown
// districts packed towers over every free quad, and everything left over —
// clipped blocks, 1-wide strips, the ragged edge of a district — became a
// lawn, a park or a tree. A tier-3 city measured 82-92% built and 0% ordinary
// houses: towers standing in grass.
//
// What it is now (src/iso/grid.ts + the pools in src/iso/config.ts):
//
//   • a free single lot of a tier 1+ town draws an ordinary house
//     (`TOWN_HOME_VARIANTS` — houses, cottages, townhouses, shops, flats),
//     and one lot in `TOWN_GREEN_LOT_IN` stays green so MAP-2 (#559)'s trees
//     and gardens survive the change;
//   • one block in `TOWN_HOME_BLOCK_IN` gives up its tall pick so its tiles
//     draw houses — that is what puts houses back AMONG the towers rather
//     than only on the scraps at the coast;
//   • the grown districts (tier 2+) do the same with their 2×2 quads.
//
// This file pins the ticket's acceptance box: a tier-3 town on three seeds is
// ≥90% occupied with no two buildings overlapping, the mix really is houses
// AND tall buildings, and nothing that must not move has moved — the village,
// the LEGACY town, the streets, and the town data a save restores.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  generateMap, grownTownHouses, idx, townBuildings, townGrownRings, type Grid, type Town,
} from "../../src/iso/grid";
import {
  TOWN_GREEN_LOT_IN, TOWN_HOME_BLOCK_IN, TOWN_HOME_VARIANTS, TOWN_LAWN,
  TOWN_PARK_VARIANTS, TOWN_TREE_VARIANTS, TOWN_VILLAGE_VARIANTS,
} from "../../src/iso/config";

/** The runtime footprint source: the per-building layer manifest. */
const buildings = JSON.parse(readFileSync("assets/buildings/manifest.json", "utf8")) as {
  sprites: Record<string, { footprint: [number, number] }>;
};
const footprintOf = (sprite: string): [number, number] =>
  buildings.sprites[sprite]?.footprint ?? [1, 1];

/** The ticket's "3 different seeds", on the all-options maps the owner plays. */
const SEEDS = [7, 42, 1337];
const ALL_ON = { rivers: true, elevation: true, shapes: true, rings: true };

/** Art that leaves a lot OPEN: a tree, a park or a tended lawn (`lotArtAt`). */
const GREEN = new Set<string>([...TOWN_TREE_VARIANTS, ...TOWN_PARK_VARIANTS, TOWN_LAWN]);
/** The ordinary house pool this ticket fills the lots from. */
const HOMES = new Set<string>(TOWN_HOME_VARIANTS);

/** One generated map per seed, shared by every case below. */
const maps = SEEDS.map((seed) => ({ seed, grid: generateMap(seed, ALL_ON) }));

/** Every tile a town of this tier draws on: its centre, houses and ring. */
function lotsOf(t: Town, grid: Grid, tier: number): Set<number> {
  const lots = new Set<number>([idx(t.tx, t.ty)]);
  for (const [x, y] of t.houses) lots.add(idx(x, y));
  for (const [x, y] of grownTownHouses(t, grid, townGrownRings(tier))) lots.add(idx(x, y));
  return lots;
}

interface Laid {
  /** Tiles covered by a BUILDING (anything that is not open-lot art). */
  built: Set<number>;
  /** Tiles left open — a tree, a park or a lawn. */
  green: Set<number>;
  /** Tiles under an ordinary 1×1 house. */
  homes: Set<number>;
  /** Tiles under a tall/large building (2×2 towers, terraces, #273 shapes). */
  big: Set<number>;
  /** Every tile any item covers, and how often — overlaps show up as >1. */
  cover: Map<number, number>;
}

/** Walk a laid-out town once and bucket every tile its art covers. */
function readLaid(t: Town, grid: Grid, tier: number, shapes: boolean): Laid {
  const out: Laid = {
    built: new Set(), green: new Set(), homes: new Set(), big: new Set(), cover: new Map(),
  };
  for (const b of townBuildings(t, footprintOf, { tier, grid, shapes })) {
    const [fw, fh] = footprintOf(b.sprite);
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        const i = idx(b.tx + dx, b.ty + dy);
        out.cover.set(i, (out.cover.get(i) ?? 0) + 1);
        if (GREEN.has(b.sprite)) out.green.add(i);
        else {
          out.built.add(i);
          if (HOMES.has(b.sprite) && fw === 1 && fh === 1) out.homes.add(i);
          else out.big.add(i);
        }
      }
    }
  }
  return out;
}

// ── the acceptance box ────────────────────────────────────────────────────
describe("CITY-1 (#652) a tier-3 city fills its lots", () => {
  for (const { seed, grid } of maps) {
    for (const shapes of [false, true]) {
      it(`seed ${seed} (shapes ${shapes ? "on" : "off"}): ≥90% of the lots are built on`, () => {
        for (const t of grid.towns) {
          const lots = lotsOf(t, grid, 3);
          const laid = readLaid(t, grid, 3, shapes);
          const occupied = [...lots].filter((i) => laid.built.has(i)).length;
          const pct = (occupied / lots.size) * 100;
          expect(lots.size, `town ${t.id} has lots to fill`).toBeGreaterThan(40);
          expect(
            pct,
            `town ${t.id} (seed ${seed}) is only ${pct.toFixed(1)}% built`,
          ).toBeGreaterThanOrEqual(90);
        }
      });

      it(`seed ${seed} (shapes ${shapes ? "on" : "off"}): no two buildings overlap`, () => {
        for (const t of grid.towns) {
          const laid = readLaid(t, grid, 3, shapes);
          for (const [i, n] of laid.cover) {
            expect(n, `tile ${i} of town ${t.id} carries ${n} items`).toBe(1);
          }
        }
      });
    }
  }

  it("still gives EVERY lot a draw item — a filled lot or a green one", () => {
    // The flip side of the fill: a tile that gets no house must still get its
    // tree/park/lawn (MAP-2 #559). Nothing may come out as bare ground.
    for (const { seed, grid } of maps) {
      for (const t of grid.towns) {
        const lots = lotsOf(t, grid, 3);
        const laid = readLaid(t, grid, 3, true);
        for (const i of lots) {
          expect(
            laid.built.has(i) || laid.green.has(i),
            `lot ${i} of town ${t.id} (seed ${seed}) draws nothing`,
          ).toBe(true);
        }
      }
    }
  });

  it("never draws on a street, and never off the town's own ground", () => {
    for (const { seed, grid } of maps) {
      for (const t of grid.towns) {
        const lots = lotsOf(t, grid, 3);
        const streets = new Set(t.roads.map(([x, y]) => idx(x, y)));
        for (const shapes of [false, true]) {
          for (const i of readLaid(t, grid, 3, shapes).cover.keys()) {
            expect(streets.has(i), `town ${t.id} (seed ${seed}) built in the road`).toBe(false);
            expect(lots.has(i), `town ${t.id} (seed ${seed}) built off its own ground`).toBe(true);
          }
        }
      }
    }
  });
});

// ── the owner's actual complaint ──────────────────────────────────────────
describe("CITY-1 (#652) an upgraded city is houses AND tall buildings", () => {
  for (const tier of [1, 2, 3]) {
    it(`tier ${tier}: ordinary houses are back, mixed with the tall ones`, () => {
      for (const { seed, grid } of maps) {
        const t = grid.towns[0];
        const lots = lotsOf(t, grid, tier);
        const laid = readLaid(t, grid, tier, true);
        const homes = laid.homes.size / lots.size;
        const big = laid.big.size / lots.size;
        expect(homes, `seed ${seed} tier ${tier}: no ordinary houses`).toBeGreaterThan(0.15);
        expect(big, `seed ${seed} tier ${tier}: the tall buildings are gone`).toBeGreaterThan(0.15);
      }
    });
  }

  it("keeps a sprinkle of green between the houses, but only a sprinkle", () => {
    for (const { seed, grid } of maps) {
      const t = grid.towns[0];
      const lots = lotsOf(t, grid, 3);
      const laid = readLaid(t, grid, 3, true);
      const green = laid.green.size / lots.size;
      expect(green, `seed ${seed}: the city has no greenery at all`).toBeGreaterThan(0);
      expect(green, `seed ${seed}: the city is still mostly grass`).toBeLessThan(0.1);
    }
  });

  it("draws the houses from the shipped art, never from a name with no PNG", () => {
    expect(TOWN_HOME_VARIANTS.length).toBeGreaterThan(8);
    for (const name of TOWN_HOME_VARIANTS) {
      const def = buildings.sprites[name];
      expect(def, `${name} is not in assets/buildings/manifest.json`).toBeTruthy();
      expect(def.footprint, `${name} must be a 1×1 home`).toEqual([1, 1]);
      // A park is not a house: the fountain belongs to the open-lot pools.
      expect(GREEN.has(name), `${name} is open-lot art, not a home`).toBe(false);
    }
  });

  it("is a pure function of the town — same seed, same city, every call", () => {
    const { grid } = maps[1];
    const t = grid.towns[0];
    for (const shapes of [false, true]) {
      expect(townBuildings(t, footprintOf, { tier: 3, grid, shapes }))
        .toEqual(townBuildings(t, footprintOf, { tier: 3, grid, shapes }));
    }
    // …and a freshly generated map of the same seed lays the same town.
    const again = generateMap(SEEDS[1], ALL_ON);
    expect(townBuildings(again.towns[0], footprintOf, { tier: 3, grid: again, shapes: true }))
      .toEqual(townBuildings(t, footprintOf, { tier: 3, grid, shapes: true }));
  });
});

// ── what must NOT move ────────────────────────────────────────────────────
describe("CITY-1 (#652) leaves the other tiers and every save alone", () => {
  it("a LEGACY town draws no ordinary house — today's maps are untouched", () => {
    for (const { seed, grid } of maps) {
      for (const t of grid.towns) {
        for (const shapes of [false, true]) {
          for (const b of townBuildings(t, footprintOf, { shapes })) {
            expect(HOMES.has(b.sprite), `${b.sprite} in a LEGACY town (seed ${seed})`).toBe(false);
          }
        }
      }
    }
  });

  it("a VILLAGE still draws only its own small homes", () => {
    const village = new Set<string>([...TOWN_VILLAGE_VARIANTS, TOWN_LAWN]);
    for (const { seed, grid } of maps) {
      const t = grid.towns[0];
      for (const b of townBuildings(t, footprintOf, { tier: 0, grid, shapes: true })) {
        if (b.tx === t.tx && b.ty === t.ty) continue;     // the church
        expect(village.has(b.sprite), `${b.sprite} in a village (seed ${seed})`).toBe(true);
      }
    }
  });

  it("changes no town DATA — a saved town's footprint is what it was", () => {
    // The art is derived at sync time; the town the save holds (its centre,
    // its house tiles, its streets) and the map's occupancy must be exactly
    // what they were before the draw list was asked for, or an old save
    // would come back a different shape.
    for (const { grid } of maps) {
      const before = JSON.stringify(grid.towns);
      const occ = Int16Array.from(grid.occupancy);
      for (const t of grid.towns) {
        for (const tier of [0, 1, 2, 3]) {
          townBuildings(t, footprintOf, { tier, grid, shapes: true });
        }
      }
      expect(JSON.stringify(grid.towns)).toBe(before);
      expect(Array.from(grid.occupancy)).toEqual(Array.from(occ));
    }
  });

  it("falls back to the old look when the atlas has no home art yet", () => {
    // `spriteKnown` is the atlas question the game passes. Before the
    // building layers land, no home is drawable — the town must then lay the
    // lots exactly as it did before this ticket rather than leave them bare.
    const { grid } = maps[0];
    const t = grid.towns[0];
    const noHomes = townBuildings(t, footprintOf, {
      tier: 3, grid, shapes: true, spriteKnown: (s) => !HOMES.has(s),
    });
    expect(noHomes.some((b) => HOMES.has(b.sprite))).toBe(false);
    const lots = lotsOf(t, grid, 3);
    const covered = new Set<number>();
    for (const b of noHomes) {
      const [fw, fh] = footprintOf(b.sprite);
      for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) covered.add(idx(b.tx + dx, b.ty + dy));
    }
    for (const i of lots) expect(covered.has(i), `lot ${i} lost its art`).toBe(true);
  });

  it("exposes the two knobs the lead can tune", () => {
    expect(TOWN_HOME_BLOCK_IN).toBeGreaterThan(0);
    expect(TOWN_GREEN_LOT_IN).toBeGreaterThan(0);
  });
});
