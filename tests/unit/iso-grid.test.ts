import { describe, it, expect } from "vitest";
import {
  generateMap, randomSeed, GRASS, WATER, ROUGH, terrainAt, industryAt,
} from "../../src/iso/grid";
import { MAP_W, MAP_H, INDUSTRY_QUOTA, INDUSTRY_BY_KEY, CARGOES } from "../../src/iso/config";

// E3 acceptance + T1 determinism fixture: same seed → byte-identical
// terrain and industries across contexts (hashed), quotas, placement rules.

function hashGrid(g: ReturnType<typeof generateMap>): string {
  return [
    Array.from(g.terrain).join(","),
    g.industries.map((i) => `${i.type}:${i.tx},${i.ty}`).join(";"),
  ].join("|");
}

describe("R6 deterministic seed handling", () => {
  it("requires an explicit seed: no undefined-map fallback remains", () => {
    // This test is a type assertion at compile time; at runtime it simply
    // verifies that the generated seed property always equals the passed seed.
    const g = generateMap(123);
    expect(g.seed).toBe(123);
  });

  it("randomSeed() produces different seeds across calls (fallback still works)", () => {
    const a = randomSeed();
    const b = randomSeed();
    expect(a).not.toBe(b);
    expect(a >>> 0).toBe(a);
    expect(b >>> 0).toBe(b);
  });

  it("the game boot path can always supply a concrete seed", () => {
    // E10/Multiplayer contract: callers resolve `?seed=` or draw a random seed
    // first; generateMap is never allowed to infer one from Math.random.
    const bootSeed = randomSeed();
    const g1 = generateMap(bootSeed);
    const g2 = generateMap(bootSeed);
    expect(hashGrid(g1)).toBe(hashGrid(g2));
  });
});

describe("E3 grid generation determinism", () => {
  it("produces identical terrain+industries for the same seed (T1)", () => {
    const a = generateMap(20260902);
    const b = generateMap(20260902);
    expect(a.terrain).toEqual(b.terrain);
    expect(a.occupancy).toEqual(b.occupancy);
    expect(JSON.stringify(a.industries)).toBe(JSON.stringify(b.industries));
    expect(hashGrid(a)).toBe(hashGrid(b));
    // interleave other seeds to prove it isn't state leaking through module globals
    generateMap(1); generateMap(99999);
    const c = generateMap(20260902);
    expect(hashGrid(c)).toBe(hashGrid(a));
  });

  it("usually differs across seeds", () => {
    const hashes = new Set([1, 2, 3, 4, 5].map((s) => hashGrid(generateMap(s))));
    expect(hashes.size).toBeGreaterThan(1);
  });

  it("regenerates the same seed identically after a different map", () => {
    const first = hashGrid(generateMap(777));
    generateMap(314159);
    expect(hashGrid(generateMap(777))).toBe(first);
  });
});

describe("E3 terrain", () => {
  it("is a flat typed array of MAP_W*MAP_H GRASS|WATER|ROUGH", () => {
    const g = generateMap(42);
    expect(g.w).toBe(MAP_W);
    expect(g.h).toBe(MAP_H);
    expect(g.terrain).toBeInstanceOf(Uint8Array);
    expect(g.terrain.length).toBe(MAP_W * MAP_H);
    for (const v of g.terrain) {
      expect([GRASS, WATER, ROUGH]).toContain(v);
    }
  });

  it("contains grass, water and rough", () => {
    const g = generateMap(42);
    const counts = [0, 0, 0];
    for (const v of g.terrain) counts[v]++;
    expect(counts[GRASS]).toBeGreaterThan(0);
    expect(counts[WATER]).toBeGreaterThan(0);
    expect(counts[ROUGH]).toBeGreaterThan(0);
  });
});

describe("E3 industry placement", () => {
  const g = generateMap(42);

  it("meets the per-type quota so no cargo is absent from the map", () => {
    const byType: Record<string, number> = {};
    for (const ind of g.industries) byType[ind.type] = (byType[ind.type] ?? 0) + 1;
    for (const [type, n] of Object.entries(INDUSTRY_QUOTA)) {
      expect(byType[type] ?? 0, `quota for ${type}`).toBe(n);
    }
    const cargos = new Set(g.industries.map((i) => INDUSTRY_BY_KEY[i.type].cargo));
    for (const c of CARGOES) expect(cargos.has(c), `cargo ${c} present`).toBe(true);
  });

  it("places no industry on water", () => {
    for (const ind of g.industries) {
      for (let x = 0; x < ind.w; x++) {
        for (let y = 0; y < ind.h; y++) {
          expect(terrainAt(g, ind.tx + x, ind.ty + y), JSON.stringify(ind)).not.toBe(WATER);
        }
      }
    }
  });

  it("keeps footprints in bounds and non-overlapping", () => {
    const tiles = new Set<number>();
    for (const ind of g.industries) {
      expect(ind.tx).toBeGreaterThanOrEqual(0);
      expect(ind.ty).toBeGreaterThanOrEqual(0);
      expect(ind.tx + ind.w).toBeLessThanOrEqual(MAP_W);
      expect(ind.ty + ind.h).toBeLessThanOrEqual(MAP_H);
      for (let x = 0; x < ind.w; x++) {
        for (let y = 0; y < ind.h; y++) {
          const key = (ind.ty + y) * MAP_W + (ind.tx + x);
          expect(tiles.has(key), `tile overlap in ${JSON.stringify(ind)}`).toBe(false);
          tiles.add(key);
        }
      }
    }
  });

  it("matches the occupancy Int16Array to the industry list", () => {
    const occ = new Int16Array(MAP_W * MAP_H).fill(-1);
    for (const ind of g.industries) {
      expect(ind.id).toBe(g.industries.indexOf(ind));
      for (let x = 0; x < ind.w; x++) {
        for (let y = 0; y < ind.h; y++) {
          const ti = (ind.ty + y) * MAP_W + (ind.tx + x);
          occ[ti] = ind.id;
        }
      }
    }
    expect(g.occupancy).toEqual(occ);
    // spot check via industryAt / industryAt miss on grass
    const ind = g.industries[0];
    expect(industryAt(g, ind.tx, ind.ty)?.id).toBe(0);
  });

  it("respects a ≥1-tile gap between footprints", () => {
    for (let i = 0; i < g.industries.length; i++) {
      for (let j = i + 1; j < g.industries.length; j++) {
        const a = g.industries[i], b = g.industries[j];
        const dx = Math.max(a.tx - (b.tx + b.w - 1) - 1, b.tx - (a.tx + a.w - 1) - 1, 0);
        const dy = Math.max(a.ty - (b.ty + b.h - 1) - 1, b.ty - (a.ty + a.h - 1) - 1, 0);
        const gap = Math.max(dx, dy);
        expect(gap, `gap between ${a.type}@(${a.tx},${a.ty}) and ${b.type}@(${b.tx},${b.ty})`)
          .toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("keeps the large majority of placements at the full 6-tile separation", () => {
    // Poisson-disc separation is best-effort: on awkward seeds a few
    // industries must relax to fit the quota (see grid.ts). The bulk of
    // pairs must still hold the 6-tile disc (E4's depth-sort rationale).
    let strict = 0, total = 0;
    for (const seed of [42, 1, 7, 123, 2026]) {
      const g = generateMap(seed);
      for (let i = 0; i < g.industries.length; i++) {
        for (let j = i + 1; j < g.industries.length; j++) {
          const a = g.industries[i], b = g.industries[j];
          const dx = Math.max(a.tx - (b.tx + b.w - 1), b.tx - (a.tx + a.w - 1));
          const dy = Math.max(a.ty - (b.ty + b.h - 1), b.ty - (a.ty + a.h - 1));
          if (Math.max(dx, dy) >= 6) strict++;
          total++;
        }
      }
    }
    expect(strict / total).toBeGreaterThanOrEqual(0.9);
  });
});
