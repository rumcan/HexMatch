// ══════════════════════════════════════════════════════════════════════════
// CIVIC-1 (#654) — hospitals, schools, stadiums and the other civic buildings
// of a town.
//
// The owner's playtest: "we also need more variation in buildings — where are
// the hospitals and schools and stadiums?" The answer is ONE table
// (`CIVIC_BUILDINGS` in src/iso/config.ts) and one placement pass
// (`layCivicBuildings` in src/iso/grid.ts). This file pins the contract:
//
//   • a tier-3 town gets a hospital, a school and a stadium; a village gets
//     none of them;
//   • a civic lot never overlaps another building, never covers a street and
//     never leaves the town's own house ground;
//   • the drawing the lead has not supplied yet falls back to a stand-in of
//     the SAME footprint on the SAME plot, and an atlas that can draw neither
//     leaves the plot alone instead of punching a hole in the town;
//   • a LEGACY town (no tier) draws no civic buildings at all.
//
// The "art has landed" case is simulated with a fake atlas — the civic names
// are not in assets/buildings/ yet, so a test that only ever asked the real
// manifest could never exercise the path the lead is about to switch on.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  generateMap, grownTownHouses, idx, townBuildings, townGrownRings,
  type Grid, type Town, type TownBuilding,
} from "../../src/iso/grid";
import {
  CIVIC_BUILDINGS, CIVIC_MAX_SHARE, civicBuildingOf, civicName, TOWN_LAWN, TOWN_PARK_VARIANTS,
} from "../../src/iso/config";

/** The runtime footprint source: the per-building layer manifest. */
const buildings = JSON.parse(
  readFileSync("assets/buildings/manifest.json", "utf8"),
) as { sprites: Record<string, { footprint: [number, number] }> };
const footprintOf = (sprite: string): [number, number] =>
  buildings.sprites[sprite]?.footprint ?? [1, 1];

/**
 * The civic drawings the lead still owes, at the footprint the TABLE declares
 * — the atlas as it will be the day the art lands.
 */
const CIVIC_FP = new Map<string, [number, number]>();
const CIVIC_NAMES = new Set<string>();
for (const def of CIVIC_BUILDINGS) {
  CIVIC_FP.set(def.sprite, def.footprint);
  CIVIC_NAMES.add(def.sprite);
  if (def.rotate) {
    CIVIC_FP.set(`${def.sprite}_r`, [def.footprint[1], def.footprint[0]]);
    CIVIC_NAMES.add(`${def.sprite}_r`);
  }
}
/** The atlas WITH the civic art. */
const artOf = (sprite: string): [number, number] => CIVIC_FP.get(sprite) ?? footprintOf(sprite);
/** The 1×1 lot art a civic stand-in may be thinned to (see the park pass). */
const PARK_LOTS = new Set<string>(TOWN_PARK_VARIANTS);
/** Today's atlas: the civic drawings are missing, the stand-ins are not. */
const missingCivicArt = (sprite: string): boolean => !CIVIC_FP.has(sprite);

// The seeds the acceptance boxes are checked on; the maps the owner plays are
// the all-option ones — `shapes` ON is what gives a town the merged 2×4 plot
// a stadium needs.
const ALL_ON = { rivers: true, elevation: true, shapes: true, rings: true };
const SEEDS = [1, 2, 3];

/** One laid item plus the plot it covers. */
interface Plot { sprite: string; tx: number; ty: number; w: number; h: number }

const plotsOf = (
  laid: readonly TownBuilding[],
  fp: (s: string) => [number, number],
  names?: Set<string>,
): Plot[] => laid
  .filter((b) => !names || names.has(b.sprite))
  .map((b) => ({ sprite: b.sprite, tx: b.tx, ty: b.ty, w: fp(b.sprite)[0], h: fp(b.sprite)[1] }));

/** The civic items of a laid town, keyed "tx,ty". */
const civicPlots = (
  laid: readonly TownBuilding[], fp: (s: string) => [number, number],
): Map<string, Plot> =>
  new Map(plotsOf(laid, fp, CIVIC_NAMES).map((p) => [`${p.tx},${p.ty}`, p]));

/** Every tile a plot covers. */
const tilesOf = (p: Plot): number[] => {
  const out: number[] = [];
  for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) out.push(idx(p.tx + dx, p.ty + dy));
  return out;
};

/** A town laid out WITH the civic art (the state the lead's drop-in makes). */
const laidWithArt = (t: Town, grid: Grid, tier: number, shapes = true): TownBuilding[] =>
  townBuildings(t, artOf, { tier, grid, shapes, spriteKnown: () => true });

/** How many civic plots of one kind a map holds (`_r` counts as the kind). */
function civicCount(civic: Map<string, Plot>, sprite: string): number {
  return [...civic.values()].filter((p) => p.sprite === sprite || p.sprite === `${sprite}_r`).length;
}

describe("CIVIC-1 (#654) — the civic table", () => {
  it("declares every building the ticket asks for", () => {
    expect(CIVIC_BUILDINGS.map((d) => d.sprite)).toEqual([
      "town_stadium", "town_hospital", "town_school", "town_library", "town_station",
      "town_park", "town_fire_station", "town_police", "town_diner", "town_post_office",
    ]);
    for (const def of CIVIC_BUILDINGS) {
      expect(def.name.length, def.sprite).toBeGreaterThan(0);
      expect(def.minTier, def.sprite).toBeGreaterThanOrEqual(0);
      expect(def.minTier, def.sprite).toBeLessThanOrEqual(3);
    }
    // The two landmarks are one-per-town, as the ticket says.
    expect(civicBuildingOf("town_hospital")?.unique).toBe(true);
    expect(civicBuildingOf("town_stadium")?.unique).toBe(true);
    // …and a name is one lookup away for a label / the inspector.
    expect(civicName("town_hospital")).toBe("Hospital");
    expect(civicName("town_stadium_r")).toBe("Stadium");
    expect(civicName("town_flats")).toBe(null);
  });

  it("gives every entry a stand-in of the SAME footprint, art that exists", () => {
    for (const def of CIVIC_BUILDINGS) {
      const stand = buildings.sprites[def.fallback];
      expect(stand, `${def.sprite}: fallback "${def.fallback}" is not installed art`).toBeTruthy();
      expect(stand.footprint, `${def.sprite}: fallback footprint`).toEqual(def.footprint);
      // …and the stand-in is not a civic name (that would be no fallback).
      expect(CIVIC_NAMES.has(def.fallback), `${def.fallback} is a civic name`).toBe(false);
      if (!def.rotate) continue;
      const turned = buildings.sprites[`${def.fallback}_r`];
      expect(turned, `${def.sprite}: rotated fallback is not installed art`).toBeTruthy();
      expect(turned.footprint, `${def.sprite}: rotated fallback footprint`)
        .toEqual([def.footprint[1], def.footprint[0]]);
    }
  });

  it("names a footprint the town grid can actually host", () => {
    // A 2×4 plot only exists on the superblocks `mergeTownBlocks` joins
    // (shapes ON); a 4×2 is the same merge turned. Nothing in the table may
    // be wider than the merged block it is meant for.
    for (const def of CIVIC_BUILDINGS) {
      const [w, h] = def.footprint;
      expect(w, def.sprite).toBeGreaterThan(0);
      expect(h, def.sprite).toBeGreaterThan(0);
      expect(Math.max(w, h), `${def.sprite} is too wide for a town block`).toBeLessThanOrEqual(4);
    }
  });
});

describe("CIVIC-1 (#654) — a town gets civic buildings by tier", () => {
  it("a tier-3 town has a hospital, a school and a stadium", () => {
    for (const seed of SEEDS) {
      const grid = generateMap(seed, ALL_ON);
      for (const t of grid.towns) {
        const civic = civicPlots(laidWithArt(t, grid, 3), artOf);
        const names = new Set([...civic.values()].map((p) => p.sprite));
        const at = `seed ${seed} town ${t.id}`;
        // `town_stadium_r` is the same stadium turned, on a 4×2 plot.
        expect(names.has("town_hospital"), `${at}: no hospital`).toBe(true);
        expect(names.has("town_school"), `${at}: no school`).toBe(true);
        expect(names.has("town_stadium") || names.has("town_stadium_r"), `${at}: no stadium`).toBe(true);
        // The landmarks are unique: one of each, whatever the town's size.
        expect(civicCount(civic, "town_hospital"), `${at}: not exactly one hospital`).toBe(1);
        expect(civicCount(civic, "town_stadium"), `${at}: not exactly one stadium`).toBe(1);
      }
    }
  });

  it("a village gets a post office and none of the big civic buildings", () => {
    for (const seed of SEEDS) {
      const grid = generateMap(seed, ALL_ON);
      for (const t of grid.towns) {
        const civic = civicPlots(laidWithArt(t, grid, 0), artOf);
        const names = new Set([...civic.values()].map((p) => p.sprite));
        const at = `seed ${seed} town ${t.id}`;
        expect(names.has("town_post_office"), `${at}: no post office`).toBe(true);
        for (const big of ["town_hospital", "town_school", "town_stadium",
          "town_library", "town_police", "town_station", "town_park"]) {
          expect(names.has(big), `${at}: a village has a ${big}`).toBe(false);
        }
      }
    }
  });

  it("grows the civic list with the tier (0 < 1 < 2 < 3)", () => {
    const grid = generateMap(SEEDS[0], ALL_ON);
    const t = grid.towns[0];
    const kindsAt = (tier: number): string[] =>
      [...new Set([...civicPlots(laidWithArt(t, grid, tier), artOf).values()]
        .map((p) => p.sprite.replace(/_r$/, "")))].sort();
    const t0 = kindsAt(0), t1 = kindsAt(1), t2 = kindsAt(2), t3 = kindsAt(3);
    // A village (tier 0) is pinned to 1×1 homes around the church, so the
    // 2×2 park waits for the first upgrade.
    expect(t0).toEqual(["town_post_office"]);
    // Every kind a lower tier has, a higher tier still has (nothing vanishes)…
    for (const k of t0) expect(t1).toContain(k);
    for (const k of t1) expect(t2).toContain(k);
    for (const k of t2) expect(t3).toContain(k);
    // …and each tier adds at least one kind.
    expect(t1.length).toBeGreaterThan(t0.length);
    expect(t2.length).toBeGreaterThan(t1.length);
    expect(t3.length).toBeGreaterThan(t2.length);
  });
});

describe("CIVIC-1 (#654) — the lots a civic building may take", () => {
  it("never overlaps another building, a street, or ground the town does not own", () => {
    for (const seed of SEEDS) {
      for (const shapes of [false, true]) {
        const grid = generateMap(seed, { ...ALL_ON, shapes });
        for (const t of grid.towns) {
          const houses = new Set(t.houses.map(([x, y]) => idx(x, y)));
          const streets = new Set(t.roads.map(([x, y]) => idx(x, y)));
          for (const tier of [0, 1, 2, 3]) {
            // The ground this town may build on: its houses, plus the grown
            // districts a tier 2+ town adds beyond them (L17 #245).
            const owns = new Set(houses);
            if (tier >= 2) {
              for (const [gx, gy] of grownTownHouses(t, grid, townGrownRings(tier))) owns.add(idx(gx, gy));
            }
            const covered = new Set<number>();
            for (const p of plotsOf(laidWithArt(t, grid, tier, shapes), artOf)) {
              for (const i of tilesOf(p)) {
                const at = `${p.sprite} at ${p.tx},${p.ty} (seed ${seed} town ${t.id} tier ${tier})`;
                expect(streets.has(i), `${at} covers a street`).toBe(false);
                expect(covered.has(i), `${at} overlaps another building`).toBe(false);
                // The centre is the one cell placed by POSITION rather than by
                // the house list, so a clipped centre block can reach past the
                // town's ground (the same exemption iso-town-art.test.ts makes).
                if (!(p.tx === t.tx && p.ty === t.ty)) {
                  expect(owns.has(i), `${at} stands off the town's own ground`).toBe(true);
                }
                covered.add(i);
              }
            }
            // …and the town is still finished: not one house tile left bare.
            for (const h of houses) {
              expect(covered.has(h), `unbuilt house tile (seed ${seed} town ${t.id} tier ${tier})`).toBe(true);
            }
          }
        }
      }
    }
  });

  it("draws every civic building on the footprint the table declares", () => {
    for (const seed of SEEDS) {
      const grid = generateMap(seed, ALL_ON);
      for (const t of grid.towns) {
        for (const tier of [1, 2, 3]) {
          for (const p of civicPlots(laidWithArt(t, grid, tier), artOf).values()) {
            const def = civicBuildingOf(p.sprite);
            expect(def, `${p.sprite} is not a civic drawing`).toBeTruthy();
            const table = def ? def.footprint : [1, 1];
            const want = p.sprite.endsWith("_r") ? [table[1], table[0]] : [table[0], table[1]];
            expect([p.w, p.h], `${p.sprite} at ${p.tx},${p.ty}`).toEqual(want);
          }
        }
      }
    }
  });

  it("keeps a town mostly homes — the civic ground is capped", () => {
    for (const seed of SEEDS) {
      const grid = generateMap(seed, ALL_ON);
      for (const t of grid.towns) {
        const civic = [...civicPlots(laidWithArt(t, grid, 3), artOf).values()];
        const tiles = civic.reduce((n, p) => n + p.w * p.h, 0);
        expect(tiles, `seed ${seed} town ${t.id}: no civic ground`).toBeGreaterThan(0);
        expect(tiles, `seed ${seed} town ${t.id}: civic ground over the cap`)
          .toBeLessThanOrEqual(Math.floor(t.houses.length * CIVIC_MAX_SHARE));
      }
    }
  });

  it("leaves the grown districts alone — no civic building on a grown tile", () => {
    const grid = generateMap(SEEDS[0], ALL_ON);
    const t = grid.towns[0];
    const houses = new Set(t.houses.map(([x, y]) => idx(x, y)));
    for (const tier of [2, 3]) {
      for (const p of civicPlots(laidWithArt(t, grid, tier), artOf).values()) {
        for (const i of tilesOf(p)) {
          expect(houses.has(i), `${p.sprite} at ${p.tx},${p.ty} is on a grown tile`).toBe(true);
        }
      }
    }
  });
});

describe("CIVIC-1 (#654) — the art the lead has not supplied yet", () => {
  it("falls back to the stand-in, on the same plot the art will take", () => {
    for (const seed of SEEDS) {
      const grid = generateMap(seed, ALL_ON);
      for (const t of grid.towns) {
        for (const tier of [1, 2, 3]) {
          const withArt = civicPlots(laidWithArt(t, grid, tier), artOf);
          const without = townBuildings(t, footprintOf, {
            tier, grid, shapes: true, spriteKnown: missingCivicArt,
          });
          // The stand-in buildings of the shipped atlas, by plot.
          const stand = new Map<string, Plot>();
          for (const p of plotsOf(without, footprintOf)) {
            const hit = CIVIC_BUILDINGS.find((d) => d.fallback === p.sprite
              || (d.rotate === true && `${d.fallback}_r` === p.sprite));
            if (hit) stand.set(`${p.tx},${p.ty}`, p);
          }
          const at = `seed ${seed} town ${t.id} tier ${tier}`;
          expect(stand.size, `${at}: no stand-in buildings`).toBeGreaterThan(0);
          for (const [key, p] of withArt) {
            const q = stand.get(key);
            expect(q, `${at}: ${p.sprite} at ${key} has no stand-in`).toBeTruthy();
            if (!q) continue;
            // …same plot, same footprint — the layout does not move when the
            // lead's art drops in.
            expect([q.w, q.h], `${at}: ${key} changed footprint`).toEqual([p.w, p.h]);
            const def = civicBuildingOf(p.sprite);
            const want = p.sprite.endsWith("_r") && def ? `${def.fallback}_r` : def?.fallback;
            // A 1×1 stand-in is a LOT (a park or the lawn): the owner's
            // "upgraded towns draw no 1×1 buildings" rule. Two lots of a kind
            // side by side are de-duplicated to the lawn by the park pass in
            // `townBuildings`, so the lawn is the same stand-in, thinned.
            const ok = q.sprite === want
              || (PARK_LOTS.has(want ?? "") && q.sprite === TOWN_LAWN);
            expect(ok, `${at}: ${key} draws ${q.sprite}, not the stand-in ${want}`).toBe(true);
          }
        }
      }
    }
  });

  it("never breaks a town whose atlas can draw neither the drawing nor the stand-in", () => {
    // The renderer's missing-sprite path (`place` in depth.ts) draws nothing
    // and does not throw — but a civic lot must not RESERVE ground nothing can
    // be drawn on, or the town would come out with holes in it.
    for (const seed of SEEDS) {
      const grid = generateMap(seed, ALL_ON);
      for (const t of grid.towns) {
        const houses = new Set(t.houses.map(([x, y]) => idx(x, y)));
        for (const tier of [0, 1, 2, 3]) {
          const laid = townBuildings(t, footprintOf, {
            tier, grid, shapes: true, spriteKnown: () => false,
          });
          for (const p of plotsOf(laid, footprintOf)) {
            expect(CIVIC_NAMES.has(p.sprite), `${p.sprite} drawn with an empty atlas`).toBe(false);
          }
          // …and the town is still complete: every house tile has a draw item.
          const covered = new Set<number>();
          for (const p of plotsOf(laid, footprintOf)) for (const i of tilesOf(p)) covered.add(i);
          for (const h of houses) {
            expect(covered.has(h), `bare house tile (seed ${seed} town ${t.id} tier ${tier})`).toBe(true);
          }
        }
      }
    }
  });

  it("draws nothing civic in a LEGACY town (no tier), art landed or not", () => {
    const grid = generateMap(SEEDS[0], ALL_ON);
    const t = grid.towns[0];
    for (const known of [() => true, missingCivicArt]) {
      const legacy = plotsOf(townBuildings(t, artOf, { shapes: true, spriteKnown: known }), artOf, CIVIC_NAMES);
      expect(legacy, "a legacy town draws a civic building").toEqual([]);
    }
    // …while the very same town at tier 1 does draw them: LEGACY is today's
    // look byte for byte, not a town that lost its civic buildings.
    expect(civicPlots(laidWithArt(t, grid, 1), artOf).size).toBeGreaterThan(0);
  });
});

describe("CIVIC-1 (#654) — determinism and spread", () => {
  it("lays the same civic buildings on every re-render", () => {
    for (const seed of SEEDS) {
      const grid = generateMap(seed, ALL_ON);
      for (const t of grid.towns) {
        for (const tier of [0, 1, 2, 3]) {
          expect(laidWithArt(t, grid, tier)).toEqual(laidWithArt(t, grid, tier));
          expect(townBuildings(t, footprintOf, { tier, grid, shapes: true }))
            .toEqual(townBuildings(t, footprintOf, { tier, grid, shapes: true }));
        }
      }
    }
  });

  it("spreads a town's civic buildings instead of stacking them in one corner", () => {
    // The walk starts at a hash salted per civic kind, so a town's civic
    // buildings land all over it rather than in the first plots found.
    const grid = generateMap(SEEDS[0], ALL_ON);
    const t = grid.towns[0];
    const civic = [...civicPlots(laidWithArt(t, grid, 3), artOf).values()];
    expect(civic.length).toBeGreaterThan(4);
    const rows = new Set(civic.map((p) => p.ty));
    const cols = new Set(civic.map((p) => p.tx));
    expect(rows.size, "every civic building in one row").toBeGreaterThan(1);
    expect(cols.size, "every civic building in one column").toBeGreaterThan(1);
  });
});
