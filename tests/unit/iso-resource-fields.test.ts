// ══════════════════════════════════════════════════════════════════════════
// RES-FIELDS — wheat fields round a Farm, tree blocks round a Forest.
//
// Every Farm and Forest gets at least six 2×2 blocks of dressing, all on ONE
// side of its 4×4 lot, so the other sides stay open for a truck Depot. The
// blocks are obstacles: stamped FIELD_OCC they refuse roads and depots until
// demolished, which puts the ground back to -1.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { FIELD_OCC, generateMap } from "../../src/iso/grid";
import { FIELD_SIZE, FIELDS_MIN, scatterScenery } from "../../src/iso/scenery";
import { buildRefusal } from "../../src/iso/track";
import { depotSites } from "../../src/iso/depot";

const SEEDS = [1337, 42, 7];

/** Which side of the industry a block sits on: 0 −x, 1 +x, 2 −y, 3 +y. */
function sideOf(ind: { tx: number; ty: number; w: number; h: number }, f: { tx: number; ty: number }): number {
  if (f.tx + FIELD_SIZE <= ind.tx) return 0;
  if (f.tx >= ind.tx + ind.w) return 1;
  if (f.ty + FIELD_SIZE <= ind.ty) return 2;
  return 3;
}

describe("RES-FIELDS the dressing beside Farms and Forests", () => {
  it("dresses Farms in wheat and Forests in trees, and nothing else", () => {
    for (const seed of SEEDS) {
      const grid = generateMap(seed);
      const { fields } = scatterScenery(grid);
      expect(fields.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const f of fields) expect(["wheat_field", "trees"]).toContain(f.sprite);
      const farms = grid.industries.filter((i) => i.type === "farm").length;
      const forests = grid.industries.filter((i) => i.type === "forest").length;
      if (!farms) expect(fields.some((f) => f.sprite === "wheat_field")).toBe(false);
      if (!forests) expect(fields.some((f) => f.sprite === "trees")).toBe(false);
    }
  });

  it("lays each resource's blocks on a single side, touching the lot, never on it", () => {
    for (const seed of SEEDS) {
      const grid = generateMap(seed);
      const { fields } = scatterScenery(grid);
      let checked = 0;
      for (const ind of grid.industries) {
        if (ind.type !== "farm" && ind.type !== "forest") continue;
        // the blocks laid for THIS resource are the ones generated right after
        // it; group them by adjacency to its lot edge
        const touching = fields.filter((f) => {
          const overlapX = f.tx < ind.tx + ind.w && f.tx + FIELD_SIZE > ind.tx;
          const overlapY = f.ty < ind.ty + ind.h && f.ty + FIELD_SIZE > ind.ty;
          const onLot = overlapX && overlapY;
          expect(onLot, `seed ${seed}: a field stands on ${ind.type} #${ind.id}`).toBe(false);
          const besideX = overlapY && (f.tx + FIELD_SIZE === ind.tx || f.tx === ind.tx + ind.w);
          const besideY = overlapX && (f.ty + FIELD_SIZE === ind.ty || f.ty === ind.ty + ind.h);
          return besideX || besideY;
        });
        if (!touching.length) continue;
        const sides = new Set(touching.map((f) => sideOf(ind, f)));
        expect(sides.size, `seed ${seed} ${ind.type} #${ind.id} fields on ${[...sides]}`).toBe(1);
        // …so a Depot still has somewhere to stand beside it
        expect(depotSites(grid, ind).length, `seed ${seed} ${ind.type} #${ind.id}`).toBeGreaterThan(0);
        checked++;
      }
      expect(checked, `seed ${seed}: no farm or forest got fields`).toBeGreaterThan(0);
    }
  });

  it("at least six blocks per resource wherever the ground allows it", () => {
    const grid = generateMap(1337);
    const { fields } = scatterScenery(grid);
    const farmsAndForests = grid.industries.filter((i) => i.type === "farm" || i.type === "forest");
    expect(fields.length).toBeGreaterThanOrEqual(farmsAndForests.length * FIELDS_MIN * 0.75);
    // blocks never overlap one another
    const seen = new Set<string>();
    for (const f of fields) {
      for (let dy = 0; dy < FIELD_SIZE; dy++) {
        for (let dx = 0; dx < FIELD_SIZE; dx++) {
          const k = `${f.tx + dx},${f.ty + dy}`;
          expect(seen.has(k), `tile ${k} carries two fields`).toBe(false);
          seen.add(k);
        }
      }
    }
  });

  it("is a pure function of the seed (a guest regenerates the same fields)", () => {
    const a = scatterScenery(generateMap(42)).fields;
    const b = scatterScenery(generateMap(42)).fields;
    expect(a).toEqual(b);
    expect(a.map((f) => f.id)).toEqual(a.map((_, i) => i));
  });

  it("a standing field refuses a road until it is cleared back to open ground", () => {
    const grid = generateMap(1337);
    const f = scatterScenery(grid).fields[0];
    expect(f).toBeTruthy();
    const i = f.ty * grid.w + f.tx;
    expect(buildRefusal(grid, "dirt", f.tx, f.ty)).toBeNull();   // not stamped yet
    grid.occupancy[i] = FIELD_OCC;
    expect(buildRefusal(grid, "dirt", f.tx, f.ty)).toBe("field");
    grid.occupancy[i] = -1;                                        // demolished
    expect(buildRefusal(grid, "dirt", f.tx, f.ty)).toBeNull();
  });
});
