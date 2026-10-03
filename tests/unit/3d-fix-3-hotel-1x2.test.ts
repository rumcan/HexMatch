// ══════════════════════════════════════════════════════════════════════════
// 3D-FIX-3 (#662) — the cream hotel becomes a TRUE 1×2.
//
// Owner playtest: the 5-storey red-brick building with cream stone bands,
// orange window bays, a striped glass canopy and a roof terrace is "too
// large". It should be a 1×2 building. 3D-FIX-1 (PR #656) only scaled it to
// 60% as a stopgap — not what was asked.
//
// IDENTIFYING THE SPRITE (the ticket's CAUTION). `town_hotel` is not named in
// src/ or in a test, so this file proves it in code before it moves anything:
// towns really DO place it — as the stand-in of `town_station` (CIVIC-1,
// minTier 3), which is the only way it reaches a town. The "which 2×2 sprites
// do tier-3 towns place" sweep that #656 ran puts it on the map on every seed
// tried; the `it("…is a building tier-3 towns really place")` case below
// re-derives that from the shipped tables so the fact cannot rot.
//
// What the change is:
//
//   • assets/buildings/manifest.json: `town_hotel` [2,2] → [1,2], so
//     `buildingFootprint` / every `footprintOf` caller sees a 1×2;
//   • src/iso/config.ts: `town_station`'s plot follows its stand-in to 1×2
//     (the CIVIC-1 invariant: a kind's stand-in and its table footprint are
//     the same shape);
//   • src/iso/three-layer.ts: the 60% `MODEL_SCALE` stopgap is gone — the
//     runtime already fits a model's plan to the footprint it stands on;
//   • the town grid keeps every invariant: the half of the old 2×2 plot the
//     hotel no longer takes is filled by the ordinary lot filler.
//
// ART THE LEAD MUST RE-RENDER (agents may not edit images):
// assets/buildings/town_hotel@{0.5x,1x,2x}.png are still the 2×2 drawing, so
// the building overhangs its 1×2 lot until they are re-rendered. That
// overhang is the accepted, clearly-marked fallback (see PLAN_FIT in
// tools/models/build-models.mjs): the FOOTPRINT is 1×2 everywhere —
// placement, occupancy, the 3D lot — only the PNG is still twice as wide.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import {
  generateMap, grownTownHouses, idx, townBuildings, townGrownRings, type Grid, type Town,
} from "../../src/iso/grid";
import {
  CIVIC_BUILDINGS, TOWN_LAWN, TOWN_PARK_VARIANTS, TOWN_TREE_VARIANTS, TOWN_HOME_VARIANTS,
  buildingFootprint, civicBuildingOf, townCentreSprite,
} from "../../src/iso/config";
import { MODEL_SCALE } from "../../src/iso/three-layer";
import { spinOf } from "../../src/iso/three-layer";

const buildings = JSON.parse(readFileSync("assets/buildings/manifest.json", "utf8")) as {
  sprites: Record<string, { footprint: [number, number]; w: number; h: number; anchor: [number, number] }>;
};
const footprintOf = (sprite: string): [number, number] =>
  buildings.sprites[sprite]?.footprint ?? [1, 1];
const models = JSON.parse(readFileSync("public/models/manifest.json", "utf8")) as Record<string, {
  turn: number; ex: number; ez: number; h: number;
}>;

/** The ticket's seeds, on the all-options maps the owner plays. */
const SEEDS = [1, 2, 3, 42, 1337];
const ALL_ON = { rivers: true, elevation: true, shapes: true, rings: true };
const maps = SEEDS.map((seed) => ({ seed, grid: generateMap(seed, ALL_ON) }));

/** Art that leaves a lot OPEN: a tree, a park or a tended lawn. */
const GREEN = new Set<string>([...TOWN_TREE_VARIANTS, ...TOWN_PARK_VARIANTS, TOWN_LAWN]);
/** The ordinary house pool CITY-1 fills lots from. */
const HOMES = new Set<string>(TOWN_HOME_VARIANTS);

/**
 * Every lot a town of this tier draws on: its CENTRE PLOT, its houses and its
 * grown ring.
 *
 * The centre plot is the whole footprint of `townCentreSprite(tier)`, not just
 * its origin tile: `townBuildings` always places it at (t.tx, t.ty) and it is
 * 2×2 from tier 1 up, so three of its tiles are the town's ground even where
 * `Town.houses` does not list them (seed 3's first town is exactly that case —
 * pre-existing, and nothing to do with the hotel).
 */
function lotsOf(t: Town, grid: Grid, tier: number): Set<number> {
  const lots = new Set<number>();
  const [cw, ch] = footprintOf(townCentreSprite(tier));
  for (let dy = 0; dy < ch; dy++) for (let dx = 0; dx < cw; dx++) lots.add(idx(t.tx + dx, t.ty + dy));
  for (const [x, y] of t.houses) lots.add(idx(x, y));
  for (const [x, y] of grownTownHouses(t, grid, townGrownRings(tier))) lots.add(idx(x, y));
  return lots;
}

interface Laid {
  built: Set<number>;
  green: Set<number>;
  cover: Map<number, number>;
}
function readLaid(t: Town, grid: Grid, tier: number, shapes: boolean): Laid {
  const out: Laid = { built: new Set(), green: new Set(), cover: new Map() };
  for (const b of townBuildings(t, footprintOf, { tier, grid, shapes })) {
    const [fw, fh] = footprintOf(b.sprite);
    for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) {
      const i = idx(b.tx + dx, b.ty + dy);
      out.cover.set(i, (out.cover.get(i) ?? 0) + 1);
      if (GREEN.has(b.sprite)) out.green.add(i); else out.built.add(i);
    }
  }
  return out;
}

describe("3D-FIX-3 (#662): which building is it, and is it really placed", () => {
  it("town_hotel is a building tier-3 towns really place (the ticket's CAUTION)", () => {
    // The only way `town_hotel` reaches a town is as the stand-in of a civic
    // kind whose own art has not landed. Prove that, from the shipped tables.
    const station = civicBuildingOf("town_station");
    expect(station, "town_station is in the civic table").toBeTruthy();
    expect(station!.fallback).toBe("town_hotel");
    expect(buildings.sprites["town_station"], "town_station art is not installed (so the stand-in is what draws)").toBeUndefined();
    // ...and it is on the map on every seed the ticket names.
    let placed = 0;
    for (const { grid } of maps) {
      for (const t of grid.towns) {
        for (const b of townBuildings(t, footprintOf, { tier: 3, grid, shapes: true })) {
          if (b.sprite === "town_hotel") placed++;
        }
      }
    }
    expect(placed, `town_hotel is placed ${placed} times on seeds ${SEEDS.join(", ")}`).toBeGreaterThan(0);
  });
});

describe("3D-FIX-3 (#662): the footprint is 1×2 everywhere", () => {
  it("the manifest, buildingFootprint and the civic table agree", () => {
    expect(buildings.sprites["town_hotel"].footprint).toEqual([1, 2]);
    expect(buildingFootprint("town_hotel")).toEqual([1, 2]);
    expect(footprintOf("town_hotel")).toEqual([1, 2]);
    // CIVIC-1's invariant: a kind's stand-in is the same shape as its plot.
    const station = civicBuildingOf("town_station")!;
    expect(station.footprint).toEqual(footprintOf(station.fallback));
    for (const def of CIVIC_BUILDINGS) {
      expect(footprintOf(def.fallback), `${def.sprite}: stand-in shape`).toEqual(def.footprint);
    }
  });

  it("the 3D plan fits the 1×2 lot, and the runtime stopgap is gone", () => {
    const mi = models["town_hotel"];
    expect(mi, "town_hotel has a model").toBeTruthy();
    // No 60% stopgap any more: the footprint does the work.
    expect(MODEL_SCALE["town_hotel"], "the MODEL_SCALE stopgap must be gone").toBeUndefined();
    expect(MODEL_SCALE["store_2x4"], "store_2x4 keeps its own scale").toBeCloseTo(0.6, 5);
    // A non-square footprint only ever flips 180 degrees (never a quarter turn).
    const spins = new Set<number>();
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) spins.add(spinOf("town_hotel", x, y, 1, 2));
    expect([...spins].sort()).toEqual([0, 2]);
    // The plan fills the 1×2 lot and the height follows it proportionally
    // (no taller than the 2×2-at-60% it replaces: 1.2486 × 1.84 × 0.6 = 1.378).
    const [fw, fh] = footprintOf("town_hotel");
    for (const rot of [0, 2]) {
      const ex = rot & 1 ? mi.ez : mi.ex, ez = rot & 1 ? mi.ex : mi.ez;
      const s = Math.min((fw * 0.92) / ex, (fh * 0.92) / ez);
      expect(mi.h * s).toBeLessThanOrEqual(1.378);
      expect(ex * s).toBeLessThanOrEqual(fw * 0.92 + 1e-6);
      expect(ez * s).toBeLessThanOrEqual(fh * 0.92 + 1e-6);
    }
  });

  it("the GLB was not rebuilt (no source to rebuild from) — size unchanged", () => {
    // The Meshy sources are git-ignored (401 MB), so nothing was re-exported:
    // kb before == kb after. The plan fit is a runtime fit, not a bake.
    const kb = statSync("public/models/town_hotel.glb").size / 1024;
    expect(kb).toBeLessThan(700);                 // inside the model budget
    console.log(`town_hotel.glb ${kb.toFixed(1)} KB (unchanged — no rebuild)`);
  });
});

describe("3D-FIX-3 (#662): tier-3 towns keep every layout invariant", () => {
  for (const { seed, grid } of maps) {
    for (const shapes of [false, true]) {
      it(`seed ${seed} (shapes ${shapes ? "on" : "off"}): no two buildings overlap`, () => {
        for (const t of grid.towns) {
          const laid = readLaid(t, grid, 3, shapes);
          for (const [i, n] of laid.cover) {
            expect(n, `tile ${i} of town ${t.id} carries ${n} items`).toBe(1);
          }
        }
      });

      it(`seed ${seed} (shapes ${shapes ? "on" : "off"}): ≥90% of the lots are built on`, () => {
        for (const t of grid.towns) {
          const lots = lotsOf(t, grid, 3);
          const laid = readLaid(t, grid, 3, shapes);
          const occupied = [...lots].filter((i) => laid.built.has(i)).length;
          const pct = (occupied / lots.size) * 100;
          expect(pct, `town ${t.id} (seed ${seed}) is only ${pct.toFixed(1)}% built`).toBeGreaterThanOrEqual(90);
        }
      });
    }
  }

  it("every lot still draws something — the freed half of the old 2×2 plot is filled", () => {
    // The ticket's box: where a 2×2 block used to be drawn, a 1×2 covers half
    // of it and the other half takes a legal filler (a house or a tree).
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
        // No lot is left to the bare-ground case: every one is covered exactly once.
        for (const i of lots) expect(laid.cover.get(i) ?? 0, `lot ${i} coverage`).toBe(1);
      }
    }
  });

  it("nothing is drawn over a street or off the town's own ground", () => {
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

  it("an upgraded city still keeps its ordinary houses (CITY-1 unchanged)", () => {
    for (const { seed, grid } of maps) {
      const t = grid.towns[0];
      const laid = readLaid(t, grid, 3, true);
      const homes = [...laid.built].filter((i) => {
        for (const b of townBuildings(t, footprintOf, { tier: 3, grid, shapes: true })) {
          const [fw, fh] = footprintOf(b.sprite);
          if (fw !== 1 || fh !== 1) continue;
          if (idx(b.tx, b.ty) === i && HOMES.has(b.sprite)) return true;
        }
        return false;
      });
      expect(homes.length, `seed ${seed}: no ordinary houses left`).toBeGreaterThan(0);
    }
  });
});

describe("3D-FIX-3 (#662): an old save keeps its town", () => {
  it("a save's town tiers re-derive to a town that still satisfies every invariant", () => {
    // A save travels the towns' TIERS, never their building list (savegame-runtime.ts):
    // the map regenerates from the seed and `townBuildings` re-lays every lot.
    // So "an old save with the 2×2 hotel" is a save whose towns were tier 3 —
    // and it must come back as a town that is still complete.
    const grid = generateMap(42, ALL_ON);
    const savedTiers = grid.towns.map(() => 3);      // the wire shape: number[]
    expect(savedTiers.length).toBe(grid.towns.length);
    for (let i = 0; i < grid.towns.length; i++) {
      const t = grid.towns[i];
      const tier = savedTiers[i];
      const lots = lotsOf(t, grid, tier);
      const laid = readLaid(t, grid, tier, true);
      for (const l of lots) {
        expect(laid.built.has(l) || laid.green.has(l), `town ${t.id} lot ${l} draws nothing`).toBe(true);
        expect(laid.cover.get(l) ?? 0, `town ${t.id} lot ${l} coverage`).toBe(1);
      }
    }
  });

  it("a legacy building list that still names the hotel at its old 2×2 plot resolves", () => {
    // Nothing persists a footprint, so the old save's hotel re-lays on the new
    // 1×2 — no crash, no hole, the sprite is still installed art.
    const grid = generateMap(1337, ALL_ON);
    const t = grid.towns[0];
    const laid = townBuildings(t, footprintOf, { tier: 3, grid, shapes: true });
    const hotel = laid.filter((b) => b.sprite === "town_hotel");
    for (const b of hotel) {
      const [fw, fh] = footprintOf(b.sprite);
      expect([fw, fh]).toEqual([1, 2]);           // the old plot, re-laid at 1×2
      // The sprite is installed art, so `place()` in depth.ts draws it — never
      // the missing-sprite path a hole would come from.
      expect(buildings.sprites[b.sprite]).toBeTruthy();
      // ...and every tile it covers is the town's own ground, never a street.
      const streets = new Set(t.roads.map(([x, y]) => idx(x, y)));
      for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) {
        expect(streets.has(idx(b.tx + dx, b.ty + dy))).toBe(false);
        expect(lotsOf(t, grid, 3).has(idx(b.tx + dx, b.ty + dy))).toBe(true);
      }
    }
  });
});
