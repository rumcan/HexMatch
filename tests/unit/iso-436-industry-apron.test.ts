// ══════════════════════════════════════════════════════════════════════════
// #436 — can't build a Depot near an industry: elevation around industries.
//
// The owner's report: the land around an industry slopes, so every Depot
// footprint beside it is refused as "not flat". The fix is the town apron's
// treatment (`makeElevation` in grid.ts), applied to every industry on every
// map: a flat ring ≥ `INDUSTRY_APRON` tiles around the footprint at the
// industry's own level, blended back into the open country by the usual
// one-level relaxation. Rivers keep their course (the apron writes height
// bytes only and never touches a fixed water tile).
//
// These pins run over 20 seeds with every map option ON (rivers, elevation,
// shapes, rings) — the maps the owner plays:
//   • every industry keeps ≥ 4 legal Depot sites under the REAL placement
//     rule (`planDepotPlacement` — exactly what `placeHarvester` accepts),
//     with sites against both axis bands of the footprint;
//   • the whole apron ring sits at the industry's level (water excepted);
//   • the corner lattice — the numbers terrain-GL bakes its ground mesh and
//     the faint tile grid from (`terrain-gl-adapter` reads `cornerHeight`) —
//     is flat across every apron;
//   • the first-Depot tutorial step (guide `depots/place`, "complete: a Depot
//     is built") can always be completed next to the nearest industry.
//
// Note on the ticket's wording "4 legal 1×2 Depot sites (both orientations)":
// the shipped Depot lot is the 2×2 `DEPOT_SIZE`, and a legal 2×2 site holds
// both 1×2 orientations flat inside it — so counting legal 2×2 sites is the
// stricter reading of the same property.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import {
  INDUSTRY_APRON, WATER,
  generateMap, heightAt, idx,
  type Grid, type Industry,
} from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/iso/config";
import { planDepotPlacement } from "../../src/iso/placement";
import { DEPOT_SIZE, depotTiles, industriesTouchingDepot, type DepotSide } from "../../src/iso/depot";
import { cornerHeight } from "../../src/iso/elevation";

/** Twenty seeds — a sweep, not one lucky draw. */
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

/** Every map option ON: rivers, elevation, non-square shapes, town rings. */
const ALL_ON = { rivers: true, elevation: true, shapes: true, rings: true } as const;

const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

/** One generated map per seed, shared by every pin below (they are cheap
 *  readers of the same deterministic map — pure function of the seed). */
const maps = new Map<number, Grid>();
function mapFor(seed: number): Grid {
  let g = maps.get(seed);
  if (!g) {
    g = generateMap(seed, ALL_ON);
    maps.set(seed, g);
  }
  return g;
}

/** The tiles of the industry's apron box (footprint + INDUSTRY_APRON ring). */
function apronBox(ind: Industry): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: ind.tx - INDUSTRY_APRON,
    y0: ind.ty - INDUSTRY_APRON,
    x1: ind.tx + ind.w - 1 + INDUSTRY_APRON,
    y1: ind.ty + ind.h - 1 + INDUSTRY_APRON,
  };
}

/** The tiles of the industry's own footprint. */
function footprintTilesOf(ind: Industry): [number, number][] {
  const out: [number, number][] = [];
  for (let y = ind.ty; y < ind.ty + ind.h; y++) {
    for (let x = ind.tx; x < ind.tx + ind.w; x++) out.push([x, y]);
  }
  return out;
}

/**
 * Every legal 2×2 truck-Depot anchor that would SERVE `ind`, under the exact
 * rule the click runs — `planDepotPlacement` (four buildable tiles, one flat
 * level, the industry edge-adjacent, a free side for the entrance). This is
 * the same vote BUILD-1's `legalDepotSpots` highlight paints, so the pins
 * below read what the player sees.
 */
function legalDepotSitesFor(g: Grid, ind: Industry): [number, number][] {
  const [dw, dh] = DEPOT_SIZE;
  const out: [number, number][] = [];
  for (let y = ind.ty - dh; y <= ind.ty + ind.h; y++) {
    for (let x = ind.tx - dw; x <= ind.tx + ind.w; x++) {
      const plan = planDepotPlacement(g, [], x, y);
      if (!plan.valid) continue;
      if (!plan.served.some((s) => s.id === ind.id)) continue;
      out.push([x, y]);
    }
  }
  return out;
}

/** The lot sides the industry touches at a site — the game's own geometry. */
function contactSides(g: Grid, ind: Industry, x: number, y: number): DepotSide[] {
  const t = industriesTouchingDepot(g, x, y).find((e) => e.industry.id === ind.id);
  return t ? [...t.sides] : [];
}

// Lots along the industry's top/bottom edge present one of these lot edges to
// it; lots along its left/right edge present one of the others.
const HORIZONTAL_BAND: DepotSide[] = ["ne", "sw"]; // lot runs east–west
const VERTICAL_BAND: DepotSide[] = ["nw", "se"];   // lot runs north–south

describe("#436 industry aprons — legal Depot sites", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: every industry keeps ≥ 4 legal Depot sites, both approach bands`, () => {
      const g = mapFor(seed);
      expect(g.industries.length).toBeGreaterThan(0);
      for (const ind of g.industries) {
        const sites = legalDepotSitesFor(g, ind);
        expect(
          sites.length,
          `seed ${seed} ${ind.type} #${ind.id} at (${ind.tx},${ind.ty}) has ${sites.length} legal Depot sites`,
        ).toBeGreaterThanOrEqual(4);

        // The ticket's "(both orientations)" in approach terms: at least one
        // legal lot against a horizontal edge of the footprint and at least
        // one against a vertical edge — the apron is flat all the way round,
        // not just on one side.
        const bands = new Set<DepotSide>();
        for (const [x, y] of sites) for (const s of contactSides(g, ind, x, y)) bands.add(s);
        expect(
          HORIZONTAL_BAND.some((s) => bands.has(s)),
          `seed ${seed} ${ind.type} #${ind.id}: no legal lot along its top/bottom edge (bands: ${[...bands].join(",") || "none"})`,
        ).toBe(true);
        expect(
          VERTICAL_BAND.some((s) => bands.has(s)),
          `seed ${seed} ${ind.type} #${ind.id}: no legal lot along its left/right edge (bands: ${[...bands].join(",") || "none"})`,
        ).toBe(true);

        // A legal site is a legal 1×2 site in BOTH orientations (the lot is
        // flat on one level — `planDepotPlacement` refused everything else).
        for (const [x, y] of sites) {
          const lot = depotTiles(x, y);
          const levels = new Set(lot.map(([lx, ly]) => heightAt(g, lx, ly)));
          expect(levels.size, `seed ${seed} lot (${x},${y}) is not one level`).toBe(1);
        }
      }
    });
  }
});

describe("#436 industry aprons — the apron is flat at the industry's level", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: the whole ring is level, rivers keep their course`, () => {
      const g = mapFor(seed);
      for (const ind of g.industries) {
        const level = heightAt(g, ind.tx, ind.ty);
        // The footprint itself is one level (E1's own pin; cheap here too).
        for (const [x, y] of footprintTilesOf(ind)) {
          expect(heightAt(g, x, y), `seed ${seed} footprint (${x},${y})`).toBe(level);
        }
        // The ring: every tile of the apron box beside the footprint lands at
        // the industry's level — except water and another industry's own
        // footprint, which keep theirs (a river is never cut off, and two
        // packed industries each keep their own flat lot).
        const { x0, y0, x1, y1 } = apronBox(ind);
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            if (!inMap(x, y)) continue;
            const i = idx(x, y);
            if (x >= ind.tx && x < ind.tx + ind.w && y >= ind.ty && y < ind.ty + ind.h) continue;
            if (g.terrain[i] === WATER) {
              // River / sea inside the ring: still water, still level 0.
              expect(heightAt(g, x, y), `seed ${seed} water (${x},${y})`).toBe(0);
              continue;
            }
            if (g.occupancy[i] >= 0) continue; // another industry's footprint
            expect(
              heightAt(g, x, y),
              `seed ${seed} apron tile (${x},${y}) of ${ind.type} #${ind.id} is ${heightAt(g, x, y)}, want ${level}`,
            ).toBe(level);
          }
        }
      }
    });
  }
});

describe("#436 industry aprons — terrain-GL ground + faint grid", () => {
  it("the corner lattice is flat across every apron (what the GL mesh bakes)", () => {
    for (const seed of SEEDS) {
      const g = mapFor(seed);
      for (const ind of g.industries) {
        const level = heightAt(g, ind.tx, ind.ty);
        const { x0, y0, x1, y1 } = apronBox(ind);
        // `terrain-gl-adapter` uploads `cornerHeight` for every lattice point
        // and the mesh + faint grid ride those corners. Every corner whose
        // four meeting tiles all sit inside the apron (and none is water or a
        // foreign footprint) must be exactly the industry's level — that is
        // "the flattened apron shows correctly" at the data level. Corners on
        // the box BOUNDARY blend into the ring's outer slope by design (a
        // corner is the min of the tiles that meet there), so only fully
        // interior corners are pinned here.
        for (let j = y0; j <= y1 + 1; j++) {
          for (let i = x0; i <= x1 + 1; i++) {
            const tiles: [number, number][] = [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]];
            if (!tiles.every(([x, y]) => inMap(x, y))) continue;
            if (!tiles.every(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) continue;
            if (tiles.some(([x, y]) => g.terrain[idx(x, y)] === WATER)) continue;
            if (tiles.some(([x, y]) => g.occupancy[idx(x, y)] >= 0)) continue;
            expect(
              cornerHeight(g, i, j),
              `seed ${seed} corner (${i},${j}) of ${ind.type} #${ind.id}`,
            ).toBe(level);
          }
        }
      }
    }
  });
});

describe("#436 industry aprons — the first-Depot tutorial step", () => {
  it("can always be completed next to the nearest industry (20 seeds)", () => {
    for (const seed of SEEDS) {
      const g = mapFor(seed);
      // The guide step (`depots/place`, complete: a Depot is built) anchors on
      // an industry — on a live map the one nearest the player's town. Every
      // industry has legal sites (pinned above), so the step's target always
      // is completable; pin the one the step actually points at, per seed.
      const town = g.towns[0];
      expect(town, `seed ${seed} has no town`).toBeTruthy();
      const dist = (ind: Industry) => {
        const dx = Math.max(ind.tx - town.tx, 0, town.tx - (ind.tx + ind.w - 1));
        const dy = Math.max(ind.ty - town.ty, 0, town.ty - (ind.ty + ind.h - 1));
        return Math.max(dx, dy);
      };
      const nearest = [...g.industries].sort((a, b) => dist(a) - dist(b) || a.id - b.id)[0]!;
      const sites = legalDepotSitesFor(g, nearest);
      expect(
        sites.length,
        `seed ${seed}: nearest industry ${nearest.type} #${nearest.id} to the town has no legal Depot site`,
      ).toBeGreaterThan(0);
    }
  });
});
