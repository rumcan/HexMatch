// ══════════════════════════════════════════════════════════════════════════
// F4 (#275) — the shapes map option: towns merge blocks along a street for
// the long #273 buildings, industries keep their depot/platform sites with
// non-square footprints, and option OFF keeps every seed byte-identical.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  generateMap, idx, inBounds, townBuildings, TOWN_OCC, WATER,
  type Grid, type Industry, type Town,
} from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/iso/config";
import { depotSites } from "../../src/iso/depot";
import { platformRefusal } from "../../src/iso/rail";

/** The runtime footprint source: the per-building layer manifest. */
const buildings = JSON.parse(readFileSync("assets/buildings/manifest.json", "utf8")) as {
  sprites: Record<string, { footprint: [number, number] }>;
};
const footprintOf = (sprite: string): [number, number] =>
  buildings.sprites[sprite]?.footprint ?? [1, 1];

/** The seeds the map tests pin. */
const PINNED = [7, 42, 79, 199, 1337];

describe("F4 shapes option — option off keeps today's maps", () => {
  it("default and explicit-off generate the identical map (seed 42)", () => {
    const a = generateMap(42);
    const b = generateMap(42, { shapes: false });
    expect(a.terrain).toEqual(b.terrain);
    expect(a.occupancy).toEqual(b.occupancy);
    expect(JSON.stringify(a.industries)).toBe(JSON.stringify(b.industries));
    expect(JSON.stringify(a.towns)).toBe(JSON.stringify(b.towns));
    expect(JSON.stringify(a.publicRoads)).toBe(JSON.stringify(b.publicRoads));
  });

  it("an option-off town never contains the shape sprites", () => {
    for (const seed of PINNED) {
      const g = generateMap(seed);
      for (const t of g.towns) {
        for (const b of townBuildings(t, footprintOf)) {
          expect(b.sprite.startsWith("shops_1x3")).toBe(false);
          expect(b.sprite.startsWith("store_2x4")).toBe(false);
          expect(b.sprite.startsWith("terrace_1x2")).toBe(false);
        }
      }
    }
  });
});

describe("F4 shapes option — towns gain the long buildings", () => {
  /** One shapes-on map per pinned seed. */
  const maps = PINNED.map((seed) => ({ seed, grid: generateMap(seed, { shapes: true }) }));

  it("is deterministic: same seed → identical towns", () => {
    for (const seed of PINNED) {
      const a = generateMap(seed, { shapes: true });
      const b = generateMap(seed, { shapes: true });
      expect(JSON.stringify(a.towns), `seed ${seed}`).toBe(JSON.stringify(b.towns));
      expect(a.occupancy, `seed ${seed}`).toEqual(b.occupancy);
    }
  });

  it("still places four towns and the full industry quota", () => {
    for (const { seed, grid } of maps) {
      expect(grid.towns.length, `seed ${seed} towns`).toBe(4);
      expect(grid.industries.length, `seed ${seed} industries`).toBe(11);
    }
  });

  it("merged street segments become house ground stamped TOWN_OCC", () => {
    for (const { seed, grid } of maps) {
      const occ = new Int16Array(MAP_W * MAP_H).fill(-1);
      for (const ind of grid.industries) {
        for (let x = 0; x < ind.w; x++) for (let y = 0; y < ind.h; y++) {
          occ[(ind.ty + y) * MAP_W + ind.tx + x] = ind.id;
        }
      }
      for (const t of grid.towns) {
        for (const [hx, hy] of t.houses) occ[hy * MAP_W + hx] = TOWN_OCC;
        for (const [rx, ry] of t.roads) occ[ry * MAP_W + rx] = TOWN_OCC;
      }
      expect(grid.occupancy, `seed ${seed}`).toEqual(occ);
      // every house is dry land
      for (const t of grid.towns) {
        for (const [hx, hy] of t.houses) {
          expect(grid.terrain[idx(hx, hy)], `seed ${seed}`).not.toBe(WATER);
        }
      }
    }
  });

  it("towns contain 1×3 and 2×4 buildings, with no overlaps and nothing over streets", () => {
    let shops = 0, stores = 0, terraces = 0, mergedTiles = 0;
    for (const { seed, grid } of maps) {
      for (const t of grid.towns) {
        const houses = new Set(t.houses.map(([x, y]) => idx(x, y)));
        const streets = new Set(t.roads.map(([x, y]) => idx(x, y)));
        const covered = new Set<number>();
        for (const b of townBuildings(t, footprintOf, { shapes: true, tier: 1 })) {
          const [fw, fh] = footprintOf(b.sprite);
          if (b.sprite.startsWith("shops_1x3")) shops++;
          if (b.sprite.startsWith("store_2x4")) stores++;
          if (b.sprite.startsWith("terrace_1x2")) terraces++;
          for (let dy = 0; dy < fh; dy++) {
            for (let dx = 0; dx < fw; dx++) {
              const i = idx(b.tx + dx, b.ty + dy);
              const at = `${b.sprite} at ${b.tx},${b.ty} (seed ${seed} town ${t.id})`;
              expect(streets.has(i), `${at} covers a street`).toBe(false);
              expect(covered.has(i), `${at} overlaps another building`).toBe(false);
              expect(houses.has(i), `${at} stands off its town's houses`).toBe(true);
              covered.add(i);
            }
          }
        }
        // every house tile — merged former-street segments included — is built on
        for (const h of houses) {
          expect(covered.has(h), `unbuilt house tile in seed ${seed} town ${t.id}`).toBe(true);
        }
        // a merged town has house tiles on street lanes (the joined segments)
        const lane = (v: number, c: number) =>
          ((((v - c) % 3) + 3) % 3) === 2;
        for (const [hx, hy] of t.houses) {
          if (lane(hx, t.tx) || lane(hy, t.ty)) mergedTiles++;
        }
      }
    }
    expect(mergedTiles, "some blocks were merged").toBeGreaterThan(0);
    expect(shops, "at least one 1×3/3×1 across the pinned seeds").toBeGreaterThan(0);
    expect(stores, "at least one 2×4/4×2 across the pinned seeds").toBeGreaterThan(0);
    expect(terraces, "at least one terrace").toBeGreaterThan(0);
  });

  it("streets are never blocked: every street still reaches open country", () => {
    for (const { seed, grid } of maps) {
      for (const t of grid.towns) {
        const streets = new Set(t.roads.map(([x, y]) => idx(x, y)));
        if (!streets.size) continue;
        const blockedByArt = new Set<number>();
        for (const b of townBuildings(t, footprintOf, { shapes: true, tier: 1 })) {
          const [fw, fh] = footprintOf(b.sprite);
          for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) {
            blockedByArt.add(idx(b.tx + dx, b.ty + dy));
          }
        }
        // walkable: street tiles, or free ground nothing claims
        const walk = (x: number, y: number): boolean => {
          if (!inBounds(x, y)) return false;
          const i = idx(x, y);
          if (streets.has(i)) return true;
          return grid.terrain[i] !== WATER && grid.occupancy[i] === -1 && !blockedByArt.has(i);
        };
        // a street network that touches open ground is not sealed off; the
        // town box plus a margin is what "open country" means here
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const [hx, hy] of t.houses) {
          x0 = Math.min(x0, hx); x1 = Math.max(x1, hx);
          y0 = Math.min(y0, hy); y1 = Math.max(y1, hy);
        }
        const seen = new Set<number>();
        const queue: number[] = [...streets];
        for (const s of queue) seen.add(s);
        let reachedOpen = false;
        for (let head = 0; head < queue.length && !reachedOpen; head++) {
          const cur = queue[head];
          const x = cur % MAP_W, y = (cur / MAP_W) | 0;
          if (x < x0 - 1 || x > x1 + 1 || y < y0 - 1 || y > y1 + 1) reachedOpen = true;
          for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
            const nx = x + dx, ny = y + dy;
            if (!walk(nx, ny)) continue;
            const ni = idx(nx, ny);
            if (seen.has(ni)) continue;
            seen.add(ni);
            queue.push(ni);
          }
        }
        expect(reachedOpen, `seed ${seed} town ${t.id} streets sealed in`).toBe(true);
      }
    }
  });

  it("a village never draws shape art, and the grown ring still works", () => {
    const { grid } = maps[0];
    for (const t of grid.towns) {
      const village = townBuildings(t, footprintOf, { shapes: true, tier: 0 });
      for (const b of village) {
        const [fw, fh] = footprintOf(b.sprite);
        if (b.tx === t.tx && b.ty === t.ty) continue;   // the church
        expect([fw, fh], `${b.sprite} in a shapes village`).toEqual([1, 1]);
      }
      // tier 2 adds the ring without crashing on the merged layout
      const city = townBuildings(t, footprintOf, { shapes: true, tier: 2, grid });
      expect(city.length).toBeGreaterThanOrEqual(village.length);
    }
  });
});

describe("F4 shapes — non-square industries keep their depot and platform sites", () => {
  /** A flat all-grass map with hand-placed industries of any footprint. */
  const flatGrid = (inds: { tx: number; ty: number; w: number; h: number }[]): Grid => {
    const occ = new Int16Array(MAP_W * MAP_H).fill(-1);
    const industries: Industry[] = inds.map((p, i) => {
      for (let x = 0; x < p.w; x++) for (let y = 0; y < p.h; y++) {
        occ[(p.ty + y) * MAP_W + p.tx + x] = i;
      }
      return { id: i, type: "farm", tx: p.tx, ty: p.ty, w: p.w, h: p.h, output: 1, banditUntil: 0 };
    });
    return {
      w: MAP_W, h: MAP_H,
      terrain: new Uint8Array(MAP_W * MAP_H),
      industries, towns: [], occupancy: occ, seed: 0,
    };
  };

  it("a non-square industry still offers 2×2 depot sites along its long edges", () => {
    for (const [w, h] of [[2, 4], [4, 2], [1, 3], [3, 1]] as const) {
      const g = flatGrid([{ tx: 60, ty: 60, w, h }]);
      const sites = depotSites(g, g.industries[0]);
      expect(sites.length, `${w}×${h} industry depot sites`).toBeGreaterThan(0);
      for (const s of sites) {
        // every site shares an edge with the footprint and never covers it
        let touches = false;
        for (let dx = 0; dx < 2; dx++) {
          for (let dy = 0; dy < 2; dy++) {
            const x = s.tx + dx, y = s.ty + dy;
            expect(x >= 60 && x < 60 + w && y >= 60 && y < 60 + h,
              `${w}×${h} lot at ${s.tx},${s.ty} covers the industry`).toBe(false);
            for (const [ax, ay] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
              if (ax >= 60 && ax < 60 + w && ay >= 60 && ay < 60 + h) touches = true;
            }
          }
        }
        expect(touches, `${w}×${h} lot at ${s.tx},${s.ty} beside the footprint`).toBe(true);
      }
    }
  });

  it("a platform (1×3) still places next to a non-square industry", () => {
    const g = flatGrid([{ tx: 60, ty: 60, w: 4, h: 2 }]);
    // A `sw` platform is 3×1 with its track along y+1: park it one tile south
    // of the footprint's west end.
    const tx = 60, ty = 63;
    expect(platformRefusal(g, [], [], 0, tx, ty, "sw")).toBe("ok");
    // …and a `se` (1×3, track at x+1) one tile east of the footprint.
    expect(platformRefusal(g, [], [], 0, 65, 60, "se")).toBe("ok");
  });
});
