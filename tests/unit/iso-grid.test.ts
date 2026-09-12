import { describe, it, expect } from "vitest";
import {
  generateMap, randomSeed, GRASS, WATER, ROUGH, SAND, terrainAt, industryAt, TOWN_OCC,
  TOWN_HOUSES_MIN, TOWN_BLOCK, TOWN_SPAN_MIN,
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

import { resolveMapSeed } from "../../src/iso/grid";

describe("R6 resolveMapSeed", () => {
  it("honours ?seed= and rejects junk", () => {
    expect(resolveMapSeed("?seed=42")).toBe(42);
    expect(() => resolveMapSeed("?seed=nope")).toThrow(/Invalid map seed/);
  });
});

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
  it("is a flat typed array of MAP_W*MAP_H GRASS|WATER|ROUGH|SAND", () => {
    const g = generateMap(42);
    expect(g.w).toBe(MAP_W);
    expect(g.h).toBe(MAP_H);
    expect(g.terrain).toBeInstanceOf(Uint8Array);
    expect(g.terrain.length).toBe(MAP_W * MAP_H);
    for (const v of g.terrain) {
      expect([GRASS, WATER, ROUGH, SAND]).toContain(v);
    }
  });

  it("has no interior lakes — every land tile is 4-reachable from every other (G3)", () => {
    for (const seed of [42, 1, 7, 123, 2026, 20260902]) {
      const g = generateMap(seed);
      const land: number[] = [];
      for (let i = 0; i < g.terrain.length; i++) if (g.terrain[i] !== WATER) land.push(i);
      expect(land.length).toBeGreaterThan(0);
      const start = land[0];
      const seen = new Set<number>([start]);
      const stack = [start];
      while (stack.length) {
        const i = stack.pop()!;
        const x = i % MAP_W, y = (i / MAP_W) | 0;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
          const ni = ny * MAP_W + nx;
          if (seen.has(ni) || g.terrain[ni] === WATER) continue;
          seen.add(ni);
          stack.push(ni);
        }
      }
      expect(seen.size, `seed ${seed}`).toBe(land.length);
    }
  });

  it("gives every industry at least one adjacent land tile", () => {
    const g = generateMap(42);
    for (const ind of g.industries) {
      let ok = false;
      for (let y = ind.ty - 1; y <= ind.ty + ind.h && !ok; y++) {
        for (let x = ind.tx - 1; x <= ind.tx + ind.w && !ok; x++) {
          const insideX = x >= ind.tx && x < ind.tx + ind.w;
          const insideY = y >= ind.ty && y < ind.ty + ind.h;
          if (insideX && insideY) continue;
          if (!insideX && !insideY) continue;
          if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
          if (g.terrain[y * MAP_W + x] !== WATER) ok = true;
        }
      }
      expect(ok, JSON.stringify(ind)).toBe(true);
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

  it("matches the occupancy Int16Array to the industry list and towns", () => {
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
    // TOWN-1: town house tiles are stamped with TOWN_OCC.
    // PP-10: town road tiles are town too — stamped with the same sentinel.
    for (const t of g.towns) {
      for (const [hx, hy] of t.houses) occ[hy * MAP_W + hx] = TOWN_OCC;
      for (const [rx, ry] of t.roads) occ[ry * MAP_W + rx] = TOWN_OCC;
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

  it("keeps the large majority of placements at the full 12-tile separation", () => {
    // Poisson-disc separation is best-effort: on awkward seeds a few
    // industries must relax to fit the quota (see grid.ts). The bulk of
    // pairs must still hold the 12-tile disc (E4's depth-sort rationale).
    let strict = 0, total = 0;
    for (const seed of [42, 1, 7, 123, 2026]) {
      const g = generateMap(seed);
      for (let i = 0; i < g.industries.length; i++) {
        for (let j = i + 1; j < g.industries.length; j++) {
          const a = g.industries[i], b = g.industries[j];
          const dx = Math.max(a.tx - (b.tx + b.w - 1), b.tx - (a.tx + a.w - 1));
          const dy = Math.max(a.ty - (b.ty + b.h - 1), b.ty - (a.ty + a.h - 1));
          if (Math.max(dx, dy) >= 12) strict++;
          total++;
        }
      }
    }
    expect(strict / total).toBeGreaterThanOrEqual(0.9);
  });
});

// ── F1: towns ────────────────────────────────────────────────────────────
// F1 was a self-blocking reachability bug: `placeTowns` put every occupied
// industry tile into `blocked`, then `allIndustriesReachable` started its
// flood from an industry tile and bailed on `blocked.has(start)` — so no town
// was ever placed. The fix keeps only the PROPOSED town tiles in `blocked`.
describe("F1 towns place and never strand an industry", () => {
  it("places exactly 4 towns on the known-zero seeds (and generally)", () => {
    for (const seed of [1337, 7, 42, 100, 1, 123, 2026, 0]) {
      const g = generateMap(seed);
      expect(g.towns.length, `seed ${seed}`).toBe(4);
    }
  });

  /**
   * TOWN-GRID: a town is a street grid with houses in the blocks, and the
   * streets run BETWEEN the buildings rather than around the outside.
   *
   * The old ring-and-fill layout is what these assertions are guarding
   * against coming back: it grew a solid blob of houses, paved whatever gaps
   * the growth happened to leave, and ringed the whole thing with a closed
   * road one tile outside the bounding box. So the test that matters is not
   * the house count — it is WHERE the roads are.
   */
  it("TOWN-GRID: lays streets between the houses, not a ring around them", () => {
    for (const seed of [1337, 7, 42, 100, 1, 123, 2026, 0, 79, 2024]) {
      const g = generateMap(seed);
      expect(g.towns.length, `seed ${seed} town count`).toBe(4);
      for (const t of g.towns) {
        const xs = t.houses.map(([x]) => x), ys = t.houses.map(([, y]) => y);
        const x0 = Math.min(...xs), x1 = Math.max(...xs);
        const y0 = Math.min(...ys), y1 = Math.max(...ys);

        // Big enough to be a town, and viable.
        expect(t.houses.length, `seed ${seed} town ${t.id} houses`)
          .toBeGreaterThanOrEqual(TOWN_HOUSES_MIN);
        // The footprint comes from the span now, not the house count. A
        // coastal town can be clipped on one axis, so assert the larger one.
        expect(Math.max(x1 - x0, y1 - y0) + 1, `seed ${seed} town ${t.id} span`)
          .toBeGreaterThanOrEqual(TOWN_SPAN_MIN + 2);

        // The road network lives IN the built area. Under the ring layout the
        // opposite held: the ring lay wholly outside the house box, one tile
        // clear of it on all four sides. Thresholds are set below the worst
        // case measured across these ten seeds (0.71 within, 0.57 strictly
        // inside), with room for a coastal town to skew them.
        const within = t.roads.filter(([rx, ry]) =>
          rx >= x0 && rx <= x1 && ry >= y0 && ry <= y1).length;
        const inside = t.roads.filter(([rx, ry]) =>
          rx > x0 && rx < x1 && ry > y0 && ry < y1).length;
        expect(within / t.roads.length, `seed ${seed} town ${t.id} roads in the box`)
          .toBeGreaterThan(0.6);
        expect(inside / t.roads.length, `seed ${seed} town ${t.id} interior roads`)
          .toBeGreaterThan(0.45);

        // No street runs out into open country. A lane may cross an unbuilt
        // gap in an L-shaped town — that is the street joining its two halves
        // — so the bound is a few tiles rather than "adjacent to a house",
        // but it rules out the lanes-to-nowhere the first cut produced (10).
        for (const [rx, ry] of t.roads) {
          let d = Infinity;
          for (const [hx, hy] of t.houses) {
            d = Math.min(d, Math.max(Math.abs(hx - rx), Math.abs(hy - ry)));
          }
          expect(d, `seed ${seed} town ${t.id} road ${rx},${ry} is ${d} from any house`)
            .toBeLessThanOrEqual(4);
        }

        // Streets lie on grid lanes and houses never do, which is what makes
        // the layout a grid rather than a scatter.
        const lane = (v: number, c: number) =>
          ((((v - c) % TOWN_BLOCK) + TOWN_BLOCK) % TOWN_BLOCK) === TOWN_BLOCK - 1;
        for (const [rx, ry] of t.roads) {
          expect(lane(rx, t.tx) || lane(ry, t.ty),
            `seed ${seed} town ${t.id} road ${rx},${ry} off-lane`).toBe(true);
        }
        for (const [hx, hy] of t.houses) {
          expect(lane(hx, t.tx) || lane(hy, t.ty),
            `seed ${seed} town ${t.id} house ${hx},${hy} on a street`).toBe(false);
        }

        // The centre carries the church, so it must be a house cell.
        expect(t.houses.some(([hx, hy]) => hx === t.tx && hy === t.ty),
          `seed ${seed} town ${t.id} centre is not a house`).toBe(true);
      }
    }
  });

  it("is deterministic: same seed → identical town tiles", () => {
    const a = generateMap(1337);
    const b = generateMap(1337);
    expect(a.towns).toEqual(b.towns);
    expect(a.occupancy).toEqual(b.occupancy);
  });

  it("marks every town house with TOWN_OCC and keeps them inside bounds", () => {
    for (const seed of [1337, 7, 42, 100]) {
      const g = generateMap(seed);
      for (const t of g.towns) {
        expect(t.houses.length).toBeGreaterThanOrEqual(6);
        for (const [hx, hy] of t.houses) {
          expect(hx).toBeGreaterThanOrEqual(0);
          expect(hy).toBeGreaterThanOrEqual(0);
          expect(hx).toBeLessThan(MAP_W);
          expect(hy).toBeLessThan(MAP_H);
          expect(g.occupancy[hy * MAP_W + hx]).toBe(TOWN_OCC);
          expect(g.terrain[hy * MAP_W + hx]).not.toBe(WATER);
        }
      }
    }
  });

  it("leaves every industry tile land-reachable after towns are placed", () => {
    // The reachability guarantee the F1 check exists for: the town tiles are
    // impassable, and the flood that starts from an industry tile must still
    // reach EVERY industry tile (water excluded, as in placeTowns).
    for (const seed of [1337, 7, 42, 100, 1, 123]) {
      const g = generateMap(seed);
      const n = MAP_W * MAP_H;
      const blocked = new Uint8Array(n);
      for (const t of g.towns) for (const [hx, hy] of t.houses) blocked[hy * MAP_W + hx] = 1;
      const first = g.industries[0];
      const seen = new Uint8Array(n);
      const stack = [first.ty * MAP_W + first.tx];
      seen[stack[0]] = 1;
      while (stack.length) {
        const cur = stack.pop()!;
        const x = cur % MAP_W, y = (cur / MAP_W) | 0;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
          const ni = ny * MAP_W + nx;
          if (seen[ni] || blocked[ni] || g.terrain[ni] === WATER) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
      for (const ind of g.industries) {
        for (let x = ind.tx; x < ind.tx + ind.w; x++) {
          for (let y = ind.ty; y < ind.ty + ind.h; y++) {
            expect(seen[y * MAP_W + x], `seed ${seed} strands ${ind.type}@(${ind.tx},${ind.ty})`).toBe(1);
          }
        }
      }
    }
  });
});


describe("T4 roomier map", () => {
  it("triples both dimensions while keeping 25 industries and four towns", () => {
    for (const seed of [0, 1, 7, 42, 100, 123, 1337, 2026]) {
      const g = generateMap(seed);
      expect([g.w, g.h]).toEqual([144, 144]);
      expect(g.industries).toHaveLength(25);
      expect(g.towns).toHaveLength(4);
      for (const [type, count] of Object.entries(INDUSTRY_QUOTA)) {
        expect(g.industries.filter((i) => i.type === type)).toHaveLength(count);
      }
      for (const [ti, town] of g.towns.entries()) {
        for (const other of g.towns.slice(ti + 1)) {
          expect(Math.max(Math.abs(town.tx - other.tx), Math.abs(town.ty - other.ty)), `town gap, seed ${seed}`)
            .toBeGreaterThanOrEqual(28);
        }
        for (const [x, y] of town.houses) for (const ind of g.industries) {
          const dx = Math.max(ind.tx - x, 0, x - (ind.tx + ind.w - 1));
          const dy = Math.max(ind.ty - y, 0, y - (ind.ty + ind.h - 1));
          expect(Math.max(dx, dy), `house/industry gap, seed ${seed}`).toBeGreaterThanOrEqual(8);
        }
      }
    }
  });
});
