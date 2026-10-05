// Owner 2026-10-05: the domed town hall (town_bank) stands once per town, at the centre,
// only from the first upgrade; never in a level-0 town and never as ordinary town art.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { generateMap, townBuildings } from "../../src/iso/grid";
import { TOWN_DOWNTOWN_VARIANTS, TOWN_HOUSE_VARIANTS } from "../../src/iso/config";

const bm = JSON.parse(readFileSync("assets/buildings/manifest.json", "utf8")).sprites;
const sm = JSON.parse(readFileSync("assets/scenery/manifest.json", "utf8")).sprites;
const KNOWN = new Set([...Object.keys(bm), ...Object.keys(sm)]);
const footprintOf = (s: string): [number, number] => (bm[s] ?? sm[s])?.footprint ?? [1, 1];

describe("the town hall stands once, at the centre, from the first upgrade", () => {
  it("is in no building pool", () => {
    expect(TOWN_HOUSE_VARIANTS as readonly string[]).not.toContain("town_bank");
    expect(TOWN_DOWNTOWN_VARIANTS as readonly string[]).not.toContain("town_bank");
  });
  for (const layout of ["grid", "planned"] as const) {
    it(`${layout} towns: none at tier 0, exactly one from tier 1`, () => {
      for (const seed of [1, 7, 42]) {
        const grid = generateMap(seed, { layout });
        for (const town of grid.towns) {
          for (const tier of [0, 1, 2, 3]) {
            const halls = townBuildings(town, footprintOf, { tier, grid, shapes: true, spriteKnown: (s) => KNOWN.has(s) })
              .filter((b) => b.sprite.replace(/_r$/, "") === "town_bank");
            expect(halls.length, `${layout} seed ${seed} town ${town.id} tier ${tier}`).toBe(tier === 0 ? 0 : 1);
          }
        }
      }
    });
  }
});
