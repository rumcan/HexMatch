// ══════════════════════════════════════════════════════════════════════════
// TOWN-2 (#653) — organic towns: diagonal streets, bigger plots, irregular
// outlines, as a NEW map option `layout: "organic"`.
//
// Pinned here, and only here:
//   * an organic town is not a rectangle: bounding-box fill < 85% (houses +
//     streets against the town's own bounding box), on every pinned seed
//   * it carries at least one diagonal road run ≥ 6 tiles (the avenue), as
//     real stored diagonal links (Town.organicDiag)
//   * it has at least one merged plot ≥ 2×4
//   * every house lot touches a street; no overlaps; town roads are one
//     connected 4-connected piece; every town meets the public road network
//   * the option is OFF by default: every pre-TOWN-2 seed is byte-identical
//   * the option chain: new game → organic, test runner → grid, a save keeps
//     its own plan, a room takes the host's, ?layout= is a new-game param
//   * wedge lots: every avenue-frontage house is a wedge and stays 1×1
//   * traffic and signals build on an organic town (buildSignals, planCars)
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it, vi } from "vitest";
import {
  generateMap, idx, inBounds, townBuildings, TOWN_BLOCK, TOWN_OCC, WATER,
  type Grid, type Town,
} from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/iso/config";
import {
  MAP_OPTIONS_OFF, MAP_OPTIONS_ON, resolveMapOptions, resolveTownLayout,
} from "../../src/iso/map-options";
import {
  normalizeMatchSettings, DEFAULT_MATCH_SETTINGS,
} from "../../src/net/match-settings";
import {
  createTrack, seedTownRoads, seedTownDiagonals, seedPublicRoads, buildTile,
  isPublicRoad, roadDiagNeighbours, roadDiagLinked, hasTrack, PUBLIC_OWNER,
} from "../../src/iso/track";
import { buildSignals } from "../../src/iso/ambience";
import { createCarState, planCars } from "../../src/iso/cars";
import { readFileSync } from "node:fs";

/** The runtime footprint source: the per-building layer manifest. */
const buildings = JSON.parse(readFileSync("assets/buildings/manifest.json", "utf8")) as {
  sprites: Record<string, { footprint: [number, number] }>;
};
const footprintOf = (sprite: string): [number, number] =>
  buildings.sprites[sprite]?.footprint ?? [1, 1];

/** Seeds whose organic maps place all four towns (verified against main). */
const SEEDS = [1337, 123, 2026, 2024, 5150];

const organicMap = (seed: number): Grid => generateMap(seed, { layout: "organic" });

const DIR4: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Longest chain of diagonal links (in tiles) among a town's avenue links. */
function longestDiagonalRun(town: Town): number {
  const links = town.organicDiag ?? [];
  if (!links.length) return 0;
  const startOf = new Map<string, [number, number, number, number][]>();
  for (const [ax, ay, bx, by] of links) {
    const k = `${ax},${ay}`;
    const list = startOf.get(k) ?? [];
    list.push([ax, ay, bx, by]);
    startOf.set(k, list);
  }
  const seen = new Set<string>();
  let best = 0;
  for (const [ax, ay] of links) {
    // count only chain heads (no link ends on this tile from another link)
    const isHead = !links.some(([cx2, cy2, dx2, dy2]) => cx2 === ax && cy2 === ay
      ? false
      : (dx2 === ax && dy2 === ay));
    if (!isHead || seen.has(`${ax},${ay}`)) continue;
    let len = 1;
    let cx = ax, cy = ay;
    for (;;) {
      const next = startOf.get(`${cx},${cy}`);
      if (!next || !next.length) break;
      const [, , bx, by] = next[0];
      cx = bx; cy = by;
      seen.add(`${cx},${cy}`);
      len++;
    }
    best = Math.max(best, len);
  }
  return best;
}

/** Merged plots ≥ 2×4: seams (former street segments turned house) detected
 * exactly the way `townBuildingsShapes` detects its supers. */
function countBigPlots(town: Town): number {
  const houses = new Set(town.houses.map(([x, y]) => idx(x, y)));
  const blockOf = (v: number, c: number) => Math.floor((v - c) / TOWN_BLOCK);
  const origins = new Set<number>();
  for (const [hx, hy] of town.houses) origins.add(idx(blockOf(hx, town.tx) * TOWN_BLOCK + town.tx, blockOf(hy, town.ty) * TOWN_BLOCK + town.ty));
  const fullBlock = (ox: number, oy: number) => {
    for (let dy = 0; dy < TOWN_BLOCK - 1; dy++) {
      for (let dx = 0; dx < TOWN_BLOCK - 1; dx++) if (!houses.has(idx(ox + dx, oy + dy))) return false;
    }
    return true;
  };
  let count = 0;
  for (const k of origins) {
    const ox = k % MAP_W, oy = (k / MAP_W) | 0;
    const rx = ox + TOWN_BLOCK, by = oy + TOWN_BLOCK;
    const hMerge = fullBlock(ox, oy) && fullBlock(rx, oy)
      && houses.has(idx(ox + TOWN_BLOCK - 1, oy)) && houses.has(idx(ox + TOWN_BLOCK - 1, oy + 1));
    const vMerge = fullBlock(ox, oy) && fullBlock(ox, by)
      && houses.has(idx(ox, oy + TOWN_BLOCK - 1)) && houses.has(idx(ox + 1, oy + TOWN_BLOCK - 1));
    if (hMerge || vMerge) count++;
  }
  return count;
}

// ── the acceptance: shape, avenue, plots ───────────────────────────────────
describe("TOWN-2 organic towns — the acceptance, on 5 seeds", () => {
  const maps = SEEDS.map((seed) => ({ seed, grid: organicMap(seed) }));

  it("places the full town quota deterministically", () => {
    for (const { seed, grid } of maps) {
      const b = organicMap(seed);
      expect(grid.towns.length, `seed ${seed} towns`).toBe(4);
      expect(JSON.stringify(grid.towns), `seed ${seed} deterministic`).toBe(JSON.stringify(b.towns));
      expect(grid.occupancy, `seed ${seed} occupancy deterministic`).toEqual(b.occupancy);
    }
  });

  it("no organic town is a rectangle: bounding-box fill < 85%", () => {
    for (const { seed, grid } of maps) {
      for (const t of grid.towns) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const tiles = new Set<number>();
        for (const [x, y] of t.houses) {
          x0 = Math.min(x0, x); x1 = Math.max(x1, x);
          y0 = Math.min(y0, y); y1 = Math.max(y1, y);
          tiles.add(idx(x, y));
        }
        for (const [x, y] of t.roads) {
          x0 = Math.min(x0, x); x1 = Math.max(x1, x);
          y0 = Math.min(y0, y); y1 = Math.max(y1, y);
          tiles.add(idx(x, y));
        }
        const fill = tiles.size / ((x1 - x0 + 1) * (y1 - y0 + 1));
        expect(
          fill,
          `seed ${seed} town ${t.id} is a ${(x1 - x0 + 1)}×${(y1 - y0 + 1)} square (fill ${(fill * 100).toFixed(0)}%)`,
        ).toBeLessThan(0.85);
      }
    }
  });

  it("every organic town has a diagonal avenue run of ≥ 6 tiles", () => {
    for (const { seed, grid } of maps) {
      for (const t of grid.towns) {
        expect(
          longestDiagonalRun(t),
          `seed ${seed} town ${t.id} has no avenue`,
        ).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it("the stored diagonal links are real, linked, town-road tiles", () => {
    for (const { seed, grid } of maps) {
      const track = createTrack(true);    // the reader asks the 45° flag
      seedTownRoads(track, grid);
      seedTownDiagonals(track, grid);
      for (const t of grid.towns) {
        for (const [ax, ay, bx, by] of t.organicDiag ?? []) {
          expect(Math.abs(ax - bx), `seed ${seed}`).toBe(1);
          expect(Math.abs(ay - by), `seed ${seed}`).toBe(1);
          expect(hasTrack(track, "road", ax, ay), `seed ${seed} (${ax},${ay}) unpaved`).toBe(true);
          expect(hasTrack(track, "road", bx, by), `seed ${seed} (${bx},${by}) unpaved`).toBe(true);
          expect(roadDiagLinked(track, ax, ay, bx, by), `seed ${seed} (${ax},${ay})→(${bx},${by}) not linked`).toBe(true);
          const read = roadDiagNeighbours(track, ax, ay).some(([x, y]) => x === bx && y === by);
          expect(read, `seed ${seed} link not readable from (${ax},${ay})`).toBe(true);
        }
      }
    }
  });

  it("every organic town has at least one merged plot ≥ 2×4", () => {
    for (const { seed, grid } of maps) {
      for (const t of grid.towns) {
        expect(countBigPlots(t), `seed ${seed} town ${t.id} has no big plot`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("the long art stands on the big plots, and nothing covers a street or a wedge", () => {
    let long = 0;
    for (const { seed, grid } of maps) {
      for (const t of grid.towns) {
        const houses = new Set(t.houses.map(([x, y]) => idx(x, y)));
        const streets = new Set(t.roads.map(([x, y]) => idx(x, y)));
        const wedges = new Set(t.organicWedges ?? []);
        const covered = new Set<number>();
        const items = townBuildings(t, footprintOf, { organic: true, tier: 1 });
        for (const b of items) {
          const [fw, fh] = footprintOf(b.sprite);
          if (fw >= 2 && fh >= 2 && (fw >= 4 || fh >= 4)) long++;
          // A wedge lot DRAWS 1×1 art (a tree, a lawn) — only a building
          // wider than one tile may never cover one.
          const multi = fw > 1 || fh > 1;
          // The centre building is ALWAYS drawn on the town origin, exactly
          // as on the grid plan — its block can lose a row to the industry
          // buffer on a coastal/tight seed, and the art still stands.
          const centre = b.tx === t.tx && b.ty === t.ty;
          for (let dy = 0; dy < fh; dy++) {
            for (let dx = 0; dx < fw; dx++) {
              const i = idx(b.tx + dx, b.ty + dy);
              const at = `${b.sprite} at ${b.tx},${b.ty} (seed ${seed} town ${t.id})`;
              expect(streets.has(i), `${at} covers a street`).toBe(false);
              expect(covered.has(i), `${at} overlaps another building`).toBe(false);
              if (!centre) expect(houses.has(i), `${at} stands off its town's houses`).toBe(true);
              if (multi && !centre) expect(wedges.has(i), `${at} covers an avenue wedge lot`).toBe(false);
              covered.add(i);
            }
          }
        }
        // the centre building itself is always the first item
        expect(items[0]?.sprite, `seed ${seed} centre drawn`).toBe("town_bank");
        // every house tile — merged seams and wedge lots included — is built on
        for (const h of houses) {
          expect(covered.has(h), `unbuilt house tile in seed ${seed} town ${t.id}`).toBe(true);
        }
      }
    }
    expect(long, "at least one 2×4-or-larger building across the seeds").toBeGreaterThan(0);
  });
});

// ── buildability and routing ────────────────────────────────────────────────
describe("TOWN-2 organic towns — buildable and routable", () => {
  const maps = SEEDS.map((seed) => ({ seed, grid: organicMap(seed) }));

  it("every house lot touches a street", () => {
    for (const { seed, grid } of maps) {
      for (const t of grid.towns) {
        const streets = new Set(t.roads.map(([x, y]) => idx(x, y)));
        for (const [hx, hy] of t.houses) {
          const touches = DIR4.some(([dx, dy]) => streets.has(idx(hx + dx, hy + dy)));
          expect(touches, `seed ${seed} town ${t.id} house (${hx},${hy}) never touches a street`).toBe(true);
        }
      }
    }
  });

  it("occupancy is exactly the towns' houses + roads (no overlaps)", () => {
    for (const { seed, grid } of maps) {
      const occ = new Int16Array(MAP_W * MAP_H).fill(-1);
      for (const ind of grid.industries) {
        for (let x = 0; x < ind.w; x++) for (let y = 0; y < ind.h; y++) {
          occ[(ind.ty + y) * MAP_W + ind.tx + x] = ind.id;
        }
      }
      for (const t of grid.towns) {
        for (const [hx, hy] of t.houses) {
          expect(occ[hy * MAP_W + hx], `seed ${seed} town ${t.id} overlaps at (${hx},${hy})`).toBe(-1);
          occ[hy * MAP_W + hx] = TOWN_OCC;
        }
        for (const [rx, ry] of t.roads) {
          expect(occ[ry * MAP_W + rx], `seed ${seed} town ${t.id} overlaps at (${rx},${ry})`).toBe(-1);
          occ[ry * MAP_W + rx] = TOWN_OCC;
        }
      }
      expect(grid.occupancy, `seed ${seed}`).toEqual(occ);
    }
  });

  it("each town's streets ride ONE network with the public roads", () => {
    // The engine's own invariant (iso-public-roads): the towns' roads and
    // the seed highways form ONE 4-connected network — the coastal-lagoon
    // street pieces a bay cuts off on grid maps included, which is why the
    // public roads are part of the set rather than a per-town-only claim.
    for (const { seed, grid } of maps) {
      const all = new Set<number>();
      for (const t of grid.towns) for (const [x, y] of t.roads) all.add(idx(x, y));
      for (const [x, y] of grid.publicRoads ?? []) all.add(idx(x, y));
      const townTiles = [...all].filter(() => true);
      void townTiles;
      const start = [...grid.towns[0].roads][0];
      const s0 = idx(start[0], start[1]);
      expect(all.has(s0), `seed ${seed} first town road in set`).toBe(true);
      const seen = new Set<number>([s0]);
      const queue: number[] = [s0];
      for (let head = 0; head < queue.length; head++) {
        const cur = queue[head];
        const x = cur % MAP_W, y = (cur / MAP_W) | 0;
        for (const [dx, dy] of DIR4) {
          const ni = idx(x + dx, y + dy);
          if (!all.has(ni) || seen.has(ni)) continue;
          seen.add(ni);
          queue.push(ni);
        }
      }
      expect(seen.size, `seed ${seed} streets+highways split into pieces`).toBe(all.size);
    }
  });

  it("every organic town meets the public road network", () => {
    for (const { seed, grid } of maps) {
      const pub = new Set((grid.publicRoads ?? []).map(([x, y]) => idx(x, y)));
      expect(pub.size, `seed ${seed} has no public roads`).toBeGreaterThan(0);
      for (const t of grid.towns) {
        const touches = t.roads.some(([x, y]) =>
          DIR4.some(([dx, dy]) => pub.has(idx(x + dx, y + dy))));
        expect(touches, `seed ${seed} town ${t.id} never meets the highway`).toBe(true);
      }
    }
  });

  it("houses stand on dry land, in bounds", () => {
    for (const { seed, grid } of maps) {
      for (const t of grid.towns) {
        for (const [hx, hy] of [...t.houses, ...t.roads]) {
          expect(inBounds(hx, hy), `seed ${seed} off-map`).toBe(true);
          expect(grid.terrain[idx(hx, hy)], `seed ${seed} town ${t.id} tile (${hx},${hy}) on water`).not.toBe(WATER);
        }
      }
    }
  });
});

// ── wedges ──────────────────────────────────────────────────────────────────
describe("TOWN-2 organic towns — avenue wedge lots", () => {
  it("wedges are exactly the avenue-frontage house tiles", () => {
    for (const seed of SEEDS) {
      const grid = organicMap(seed);
      for (const t of grid.towns) {
        const houses = new Set(t.houses.map(([x, y]) => idx(x, y)));
        const wedges = new Set(t.organicWedges ?? []);
        const inCentre = (x: number, y: number) =>
          x >= t.tx && x <= t.tx + 1 && y >= t.ty && y <= t.ty + 1;
        for (const [hx, hy] of t.houses) {
          const i = idx(hx, hy);
          if (inCentre(hx, hy)) continue;    // the centre building draws whole
          const onAvenueFront = (t.organicDiag ?? []).some(([ax, ay, bx, by]) => {
            const ends: [number, number][] = [[ax, ay], [bx, by]];
            return ends.some(([ex, ey]) => DIR4.some(([dx, dy]) => ex + dx === hx && ey + dy === hy));
          });
          if (wedges.has(i)) {
            expect(houses.has(i), `seed ${seed} wedge not a house`).toBe(true);
            expect(onAvenueFront, `seed ${seed} wedge (${hx},${hy}) fronts no avenue`).toBe(true);
          } else if (onAvenueFront) {
            // a fronting lot must be a wedge — unless it yielded to the avenue
            expect(houses.has(i), `seed ${seed} avenue frontage (${hx},${hy}) neither wedge nor street`).toBe(false);
          }
        }
      }
    }
  });

  it("paint keeps wedge lots to 1×1, in the village too", () => {
    for (const seed of SEEDS.slice(0, 2)) {
      const grid = organicMap(seed);
      for (const t of grid.towns) {
        const wedges = new Set(t.organicWedges ?? []);
        for (const tier of [0, 1]) {
          for (const b of townBuildings(t, footprintOf, { organic: true, tier })) {
            const [fw, fh] = footprintOf(b.sprite);
            if (fw === 1 && fh === 1) continue;   // a wedge lot draws 1×1 art
            for (let dy = 0; dy < fh; dy++) {
              for (let dx = 0; dx < fw; dx++) {
                expect(
                  wedges.has(idx(b.tx + dx, b.ty + dy)),
                  `seed ${seed} tier ${tier}: ${b.sprite} covers a wedge`,
                ).toBe(false);
              }
            }
          }
        }
      }
    }
  });
});

// ── the option: default OFF, chain of custody ───────────────────────────────
describe("TOWN-2 the layout option", () => {
  it("absent and explicit-grid generate the identical map", () => {
    for (const seed of [42, 79, 1337]) {
      const a = generateMap(seed);
      const b = generateMap(seed, { layout: "grid" });
      expect(JSON.stringify(a.towns), `seed ${seed} towns`).toBe(JSON.stringify(b.towns));
      expect(a.terrain).toEqual(b.terrain);
      expect(a.occupancy).toEqual(b.occupancy);
      expect(JSON.stringify(a.publicRoads)).toBe(JSON.stringify(b.publicRoads));
      expect(JSON.stringify(a.industries)).toBe(JSON.stringify(b.industries));
    }
  });

  it("shapes-only maps (the pre-TOWN-2 all-ON default) are unchanged", () => {
    for (const seed of [42, 1337]) {
      const a = generateMap(seed, { rivers: true, elevation: true, shapes: true, rings: true });
      const b = generateMap(seed, { rivers: true, elevation: true, shapes: true, rings: true, layout: "grid" });
      expect(JSON.stringify(a.towns)).toBe(JSON.stringify(b.towns));
      // …and a shapes map carries no organic fields
      for (const t of b.towns) {
        expect(t.organicDiag).toBeUndefined();
        expect(t.organicWedges).toBeUndefined();
      }
    }
  });

  it("a new game resolves planned; the unit-test runner resolves grid", () => {
    expect(resolveTownLayout({})).toBe("grid");
    vi.stubEnv("MODE", "production");
    try {
      // TOWN-4.5 (#681): the new-game default flipped organic → planned. (A
      // room that names NO layout still plays organic — the "host's record"
      // test below — so old rooms never re-terrain.)
      expect(resolveTownLayout({})).toBe("planned");
      // ?layout= is a new-game param, both ways, only in known names
      expect(resolveTownLayout({ search: "?layout=grid" })).toBe("grid");
      expect(resolveTownLayout({ search: "?layout=organic" })).toBe("organic");
      expect(resolveTownLayout({ search: "?layout=round" })).toBe("planned");
      expect(resolveTownLayout({ explicit: { layout: "grid" }, search: "?layout=organic" })).toBe("grid");
    } finally { vi.unstubAllEnvs(); }
  });

  it("a save keeps the plan it was generated with; a pre-TOWN-2 save stays grid", () => {
    vi.stubEnv("MODE", "production");
    try {
      expect(resolveTownLayout({ save: { map: { rivers: true, layout: "organic" } } })).toBe("organic");
      expect(resolveTownLayout({ save: { map: { rivers: true, elevation: true, shapes: true, rings: true, diag: true } } })).toBe("grid");
      expect(resolveTownLayout({ save: {} })).toBe("grid");
      // a URL never re-terrains a resumed save
      expect(resolveTownLayout({ save: { map: {} }, search: "?layout=organic" })).toBe("grid");
    } finally { vi.unstubAllEnvs(); }
  });

  it("in a room the host's record wins; a guest's URL cannot split the seats", () => {
    vi.stubEnv("MODE", "production");
    try {
      expect(resolveTownLayout({ room: {} })).toBe("organic");
      expect(resolveTownLayout({ room: { map: { ...MAP_OPTIONS_ON, layout: "grid" } } })).toBe("grid");
      expect(resolveTownLayout({ room: { map: { ...MAP_OPTIONS_ON, layout: "grid" } }, search: "?layout=organic" })).toBe("grid");
      expect(resolveTownLayout({ room: { map: { ...MAP_OPTIONS_OFF, layout: "organic" } } })).toBe("organic");
    } finally { vi.unstubAllEnvs(); }
  });

  it("a story contract keeps its tuned (grid) towns unless the chapter says otherwise", () => {
    vi.stubEnv("MODE", "production");
    try {
      expect(resolveTownLayout({ story: {} })).toBe("grid");
      expect(resolveTownLayout({ story: { mapOptions: { layout: "organic" } } })).toBe("organic");
      expect(resolveTownLayout({ scenario: {} })).toBe("grid");
    } finally { vi.unstubAllEnvs(); }
  });

  it("rides the wire: optional on the map record, dropped when malformed", () => {
    const s = normalizeMatchSettings({
      ...DEFAULT_MATCH_SETTINGS,
      map: { rivers: true, elevation: true, shapes: true, rings: true, diag: true, layout: "organic" },
    })!;
    expect(s.map?.layout).toBe("organic");
    // a record without the key keeps its exact pre-TOWN-2 shape
    expect(normalizeMatchSettings({ winTarget: 10, map: { rivers: true } })!.map)
      .toEqual({ rivers: true, elevation: false, shapes: false, rings: false, diag: false });
    // a malformed layout drops nothing else, but loses the map? no — the map
    // record is dropped whole (the same strictness as a bad boolean), and the
    // boot then plays the defaults.
    expect(normalizeMatchSettings({ winTarget: 10, map: { rivers: true, layout: "circular" } })!.map).toBeUndefined();
    // absence equality: a pre-TOWN-2 record equals the same record written after
    expect(resolveMapOptions({ save: { map: { rivers: true } } }).layout).toBeUndefined();
    expect(MAP_OPTIONS_OFF.layout).toBeUndefined();
    expect(MAP_OPTIONS_ON.layout).toBeUndefined();
  });
});

// ── traffic and signals smoke ───────────────────────────────────────────────
describe("TOWN-2 organic towns — traffic and signals build", () => {
  it("buildSignals finds junctions on an organic town, planCars routes them", () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const grid = organicMap(seed);
      const track = createTrack(true);
      seedTownRoads(track, grid);
      seedTownDiagonals(track, grid);
      seedPublicRoads(track, grid);
      const signals = buildSignals(track, grid, seed);
      expect(signals.junctions.size, `seed ${seed} no town junctions`).toBeGreaterThan(0);
      // the avenue is public ground like every town street
      for (const t of grid.towns) {
        for (const [x, y] of t.organicDiag?.flat().reduce<number[]>((acc, _v, i) => acc, []) ?? []) void [x, y];
      }
      for (const t of grid.towns) {
        const links = t.organicDiag ?? [];
        for (const [ax, ay] of links) {
          expect(isPublicRoad(track, ax, ay), `seed ${seed} avenue tile not public`).toBe(true);
        }
      }
      const cars = planCars(track, grid, [], 8, seed);
      expect(cars.length, `seed ${seed} planned no cars`).toBeGreaterThan(0);
    }
  });

  it("public roads still attach through the boot stamp (PUBLIC_OWNER)", () => {
    const grid = organicMap(42);
    const track = createTrack(true);
    seedTownRoads(track, grid);
    seedTownDiagonals(track, grid);
    seedPublicRoads(track, grid);
    for (const [x, y] of grid.publicRoads ?? []) {
      expect(isPublicRoad(track, x, y), `(${x},${y}) not public`).toBe(true);
    }
    for (const t of grid.towns) {
      for (const [x, y] of t.roads) {
        expect(isPublicRoad(track, x, y), `town road (${x},${y}) not public`).toBe(true);
      }
    }
    void buildTile; void PUBLIC_OWNER;
  });
});
