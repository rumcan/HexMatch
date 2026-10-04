// TOWN-BUG-2 (#699): no planned-town building may be DRAWN over a street.
//
// The TOWN-4.4 "never overlaps" test checks the manifest FOOTPRINT. What the
// player sees is the DRAWING: a PNG whose trimmed width is wider than its
// footprint's diamond ((fw+fh)·HW px) spills over the neighbouring tiles, and
// a `_r` mirror is placed from its own manifest entry. So the drawn ground
// footprint is computed here from the manifest (footprint, anchor, w) of the
// sprite actually placed, mirror included, and widened to the smallest
// footprint the art really fills. It must cover no street tile.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  generateMap, idx, plannedReveal, townBuildings,
} from "../../src/iso/grid";
import { HW } from "../../src/iso/config";

type Def = { footprint: [number, number]; anchor: [number, number]; w: number; h: number };
type Manifest = { sprites: Record<string, Def> };
const bm = JSON.parse(readFileSync("assets/buildings/manifest.json", "utf8")) as Manifest;
const sm = JSON.parse(readFileSync("assets/scenery/manifest.json", "utf8")) as Manifest;
const KNOWN = new Set([...Object.keys(bm.sprites), ...Object.keys(sm.sprites)]);
const defOf = (s: string): Def | undefined => bm.sprites[s] ?? sm.sprites[s];
const footprintOf = (s: string): [number, number] => defOf(s)?.footprint ?? [1, 1];

/** Slack for anti-aliased edges, px. */
const TOL = 6;

/**
 * The tiles a placed sprite's DRAWING stands on. The anchor is the footprint
 * centre, so the art is centred on it; when the trimmed width exceeds the
 * footprint's diamond the excess spills `ceil(excess / (2·HW))` tiles out on
 * every side (one tile of spill = one more diamond half-width each way).
 */
export function drawnTiles(sprite: string, tx: number, ty: number): [number, number][] {
  const d = defOf(sprite);
  const [fw, fh] = footprintOf(sprite);
  const spill = d ? Math.max(0, Math.ceil((d.w - (fw + fh) * HW - TOL) / (2 * HW))) : 0;
  const out: [number, number][] = [];
  for (let y = ty - spill; y < ty + fh + spill; y++) {
    for (let x = tx - spill; x < tx + fw + spill; x++) out.push([x, y]);
  }
  return out;
}

const SEEDS = [1, 7, 42, 1337];
const TIERS = [0, 1, 2, 3];

describe("TOWN-BUG-2: planned buildings are not drawn over the street", () => {
  for (const seed of SEEDS) {
    const grid = generateMap(seed, { layout: "planned" });
    // Highways only: `publicRoads` also lists every town's FULL plan paving, which a low tier has not laid.
    const townPaving = new Set(grid.towns.flatMap((t) => (t.roads ?? []).map(([x, y]) => idx(x, y))));
    const highway = new Set((grid.publicRoads ?? []).map(([x, y]) => idx(x, y)).filter((k) => !townPaving.has(k)));
    for (const tier of TIERS) {
      it(`seed ${seed} tier ${tier}`, () => {
        const bad: string[] = [];
        for (const town of grid.towns) {
          const reveal = plannedReveal(town, grid, tier, {});
          const laid = townBuildings(town, footprintOf, { tier, grid, shapes: true, spriteKnown: (s) => KNOWN.has(s) });
          for (const b of laid) {
            for (const [x, y] of drawnTiles(b.sprite, b.tx, b.ty)) {
              const k = idx(x, y);
              if (reveal.roadKeys.has(k) || highway.has(k)) { bad.push(`${b.sprite}@${b.tx},${b.ty} over ${x},${y} ${reveal.roadKeys.has(k) ? "plan" : "hwy"}`); break; }
            }
          }
        }
        expect(bad).toEqual([]);
      });
    }
  }
});
