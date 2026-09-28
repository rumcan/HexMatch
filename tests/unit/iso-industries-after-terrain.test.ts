// ═══════════════════════════════════════════════════════════════════════════
// Industries after terrain — "resources should be placed after the map renders
// and does the elevations."
//
// `generateMap` now builds land, water, rivers and the NATURAL elevation
// first, then sites every industry on ground that is already flat (or nearly
// — a small `INDUSTRY_APRON` patch levelled, blending ≤ 1 level). Pins, over
// 20 seeds with every map option ON:
//   • the quota is met (INDUSTRY_QUOTA: 11 industries);
//   • every industry has ≥ 4 legal Depot sites against both approach bands
//     (the real `planDepotPlacement` rule);
//   • no pits/plateaus: the country around the levelled patch (the next three
//     rings out) sits within ±1 level of the industry.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import {
  INDUSTRY_APRON, WATER, generateMap, heightAt, idx,
  type Grid, type Industry,
} from "../../src/iso/grid";
import { INDUSTRY_QUOTA, MAP_W, MAP_H } from "../../src/iso/config";
import { planDepotPlacement } from "../../src/iso/placement";
import { DEPOT_SIZE, industriesTouchingDepot, type DepotSide } from "../../src/iso/depot";

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const ALL_ON = { rivers: true, elevation: true, shapes: true, rings: true } as const;
const QUOTA = Object.values(INDUSTRY_QUOTA).reduce((a, b) => a + b, 0);

function legalSides(g: Grid, ind: Industry): { count: number; sides: Set<DepotSide> } {
  const [dw, dh] = DEPOT_SIZE;
  let count = 0;
  const sides = new Set<DepotSide>();
  for (let y = ind.ty - dh; y <= ind.ty + ind.h; y++) {
    for (let x = ind.tx - dw; x <= ind.tx + ind.w; x++) {
      const plan = planDepotPlacement(g, [], x, y);
      if (!plan.valid || !plan.served.some((s) => s.id === ind.id)) continue;
      count++;
      const t = industriesTouchingDepot(g, x, y).find((e) => e.industry.id === ind.id);
      for (const s of t?.sides ?? []) sides.add(s);
    }
  }
  return { count, sides };
}

/** Largest |height − level| on land in the rings just outside the patch. */
function surroundDelta(g: Grid, ind: Industry): number {
  const lv = heightAt(g, ind.tx, ind.ty);
  let worst = 0;
  const r0 = INDUSTRY_APRON + 1, r1 = INDUSTRY_APRON + 3;
  for (let y = ind.ty - r1; y < ind.ty + ind.h + r1; y++) {
    for (let x = ind.tx - r1; x < ind.tx + ind.w + r1; x++) {
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
      const inner = x >= ind.tx - r0 + 1 && x < ind.tx + ind.w + r0 - 1
        && y >= ind.ty - r0 + 1 && y < ind.ty + ind.h + r0 - 1;
      if (inner) continue;
      const i = idx(x, y);
      if (g.terrain[i] === WATER || g.occupancy[i] >= 0) continue;
      worst = Math.max(worst, Math.abs(g.height![i] - lv));
    }
  }
  return worst;
}

describe("industries after terrain (20 seeds, all options ON)", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: quota, ≥ 4 Depot sites both bands, no pits`, () => {
      const g = generateMap(seed, ALL_ON);
      expect(g.industries.length).toBe(QUOTA);
      for (const ind of g.industries) {
        const { count, sides } = legalSides(g, ind);
        const tag = `seed ${seed} ${ind.type} #${ind.id} (${ind.tx},${ind.ty})`;
        expect(count, `${tag} legal Depot sites`).toBeGreaterThanOrEqual(4);
        expect(sides.has("ne") || sides.has("sw"), `${tag} top/bottom band`).toBe(true);
        expect(sides.has("nw") || sides.has("se"), `${tag} left/right band`).toBe(true);
        expect(surroundDelta(g, ind), `${tag} sits in a pit/plateau`).toBeLessThanOrEqual(1);
      }
    });
  }
});
