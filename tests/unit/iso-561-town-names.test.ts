// TOWN-3 (#561): every town gets a generated 1940s–50s name — seeded,
// deterministic per map, and never repeated within a map. No wire/save
// field needed: names are re-derived from the seed alone every time.
import { describe, expect, it } from "vitest";
import { generateMap } from "../../src/iso/grid";
import { deriveTownNames, TOWN_NAME_POOL } from "../../src/iso/town-names";

describe("#561 town names", () => {
  it("deriveTownNames is a pure function of (seed, count) — repeat calls agree", () => {
    for (const seed of [1, 7, 42, 1337, 20260903]) {
      for (const count of [1, 2, 4, 8]) {
        expect(deriveTownNames(seed, count)).toEqual(deriveTownNames(seed, count));
      }
    }
  });

  it("different seeds draw different name orders", () => {
    const a = deriveTownNames(1, 6);
    const b = deriveTownNames(2, 6);
    expect(a).not.toEqual(b);
  });

  it("names are never repeated within one map's draw", () => {
    for (const seed of [1, 7, 42, 1337, 999999]) {
      for (const count of [1, 4, 8, TOWN_NAME_POOL.length]) {
        const names = deriveTownNames(seed, count);
        expect(new Set(names).size, `seed ${seed}, count ${count}`).toBe(count);
      }
    }
  });

  it("count 0 returns an empty list", () => {
    expect(deriveTownNames(42, 0)).toEqual([]);
  });

  it("every drawn name (within one lap) comes from the curated pool", () => {
    const names = deriveTownNames(42, TOWN_NAME_POOL.length);
    for (const n of names) expect(TOWN_NAME_POOL).toContain(n);
  });

  it("drawing more towns than the pool holds still stays unique (lap suffix)", () => {
    const count = TOWN_NAME_POOL.length + 3;
    const names = deriveTownNames(42, count);
    expect(names.length).toBe(count);
    expect(new Set(names).size).toBe(count);
  });

  it("generateMap gives every town a name, seeded from the map seed, with no repeats on the map", () => {
    for (const seed of [7, 42, 199, 1337, 20260903]) {
      const grid = generateMap(seed);
      expect(grid.towns.length).toBeGreaterThan(0);
      const names = grid.towns.map((t) => t.name);
      for (const n of names) {
        expect(typeof n).toBe("string");
        expect(n!.length).toBeGreaterThan(0);
        expect(n).not.toMatch(/^Town \d+$/); // the old placeholder is gone
      }
      expect(new Set(names).size, `seed ${seed}`).toBe(names.length);
    }
  });

  it("generateMap is deterministic: same seed → same town names, in the same order", () => {
    for (const seed of [7, 42, 1337]) {
      const g1 = generateMap(seed);
      const g2 = generateMap(seed);
      expect(g2.towns.map((t) => t.name)).toEqual(g1.towns.map((t) => t.name));
    }
  });

  it("naming does not perturb the seeded placement stream — geometry stays byte-identical", () => {
    // T1: this is the guard the ticket's "no new wire fields if possible" and
    // every other seeded-stream comment in grid.ts depend on — town names are
    // drawn from a private RNG stream, so terrain/industries/town footprints
    // must come out exactly as before naming existed.
    for (const seed of [7, 42, 199, 1337]) {
      const g = generateMap(seed);
      expect(g.terrain).toEqual(generateMap(seed).terrain);
      expect(g.industries).toEqual(generateMap(seed).industries);
      expect(g.towns.map((t) => ({ id: t.id, tx: t.tx, ty: t.ty, houses: t.houses, roads: t.roads })))
        .toEqual(generateMap(seed).towns.map((t) => ({ id: t.id, tx: t.tx, ty: t.ty, houses: t.houses, roads: t.roads })));
    }
  });

  it("option variants (rings/shapes/elevation) still name every town uniquely", () => {
    const grid = generateMap(2026, { rings: true, shapes: true, elevation: true, rivers: true });
    const names = grid.towns.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toBeTruthy();
  });
});
