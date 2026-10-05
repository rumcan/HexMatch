// ══════════════════════════════════════════════════════════════════════════
// TOWN-4.3 (#679) — planned towns: `layout: "planned"`, a seeded MASTER PLAN
// instead of the grid lattice or the organic outline.
//
// Pinned here, and only here:
//   * a planned town is ONE straight 2-wide avenue that reaches both plan
//     edges (22–28 tiles on the standard map) with a 4×4 square on it, whose
//     avenue-facing centre tile is the hall (today's `Town.tx/ty`)
//   * ≥ 6 real blocks, streets + avenue cover 20–30% of the plan's rectangle,
//     no stub lane (a lane end is either an avenue end or a cul-de-sac circle)
//   * every lot fronts a street and never overlaps one; a corner lot fronts
//     the busier of the streets meeting there (avenue > street > lane)
//   * `Town.houses` is the district-0 village, `Town.roads` is its streets +
//     the whole avenue, and occupancy is exactly what the plan stamps — the
//     reserved districts (1–3) stay free land (TOWN-4.4 reveals them)
//   * highways meet an avenue terminus on every planned town, and every
//     town's roads ride ONE 4-connected network with the public roads
//   * grid and organic maps are byte-identical to main (pinned fingerprints,
//     verified against c66a1a5 on 2026-10-04) — planned is opt-in only
//   * the option chain resolves "planned" and nothing else changes
//   * the boot stamp paves BOTH avenue carriageways as public road — the one
//     place TOWN-4.2 (#678, the AVENUE tier) will change
// ══════════════════════════════════════════════════════════════════════════
import { afterEach, describe, expect, it } from "vitest";
import {
  generateMap, idx, inBounds, WATER, TOWN_OCC, type Grid,
} from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/iso/config";
import { MAP_SIZES, releaseMapSize, setMapSize } from "../../src/game/config";
import { harvesterSpots } from "../../src/iso/ai";
import { MAP_OPTIONS_OFF, MAP_OPTIONS_ON, resolveTownLayout } from "../../src/iso/map-options";
import {
  TOWN_LAYOUTS, normalizeMatchSettings, DEFAULT_MATCH_SETTINGS,
} from "../../src/net/match-settings";
import {
  createTrack, isPublicRoad, seedPublicRoads, seedTownAvenues, seedTownDiagonals,
  seedTownRoads,
} from "../../src/iso/track";
import {
  PLANNED_INDUSTRY_SEP, planAvenueTiles, planLotTiles, planLotsUpTo, planRoadTiles, planVillage,
  planTileDistrict, plannedTownSep, type LotFront, type TownPlan,
} from "../../src/iso/town-plan";

/** Seeds the ticket pins: every planned town in every one of them is audited. */
const SEEDS = [1, 2, 3, 7, 42, 1337];
const DIR4: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
/** The tile a lot's frontage faces. */
const VEC: Record<LotFront, [number, number]> = { NE: [0, -1], SE: [1, 0], SW: [0, 1], NW: [-1, 0] };
const k = (x: number, y: number): number => y * MAP_W + x;

const maps = SEEDS.map((seed) => ({ seed, grid: generateMap(seed, { layout: "planned" }) }));
const plans = maps.flatMap(({ seed, grid }) => grid.towns.map((t) => ({ seed, town: t, plan: t.plan! })));

/** The avenue length and plaza size each plan size draws (the KNOBS table). */
const AVE_RANGE = { standard: [22, 28], large: [32, 40] } as const;
const SQUARE_TILES = { standard: 16, large: 24 } as const;

/** AUDIT: every master-plan invariant the ticket asks for, in one pass. */
function audit(plan: TownPlan): string[] {
  const out: string[] = [];
  const road = new Set<number>(planRoadTiles(plan).map(([x, y]) => k(x, y)));
  const square = new Set<number>(plan.square.tiles.map(([x, y]) => k(x, y)));
  const hall = k(plan.square.hall[0], plan.square.hall[1]);
  const lotOf = new Map<number, string>();
  plan.blocks.forEach((b, bi) => {
    for (const l of b.lots) {
      for (let j = 0; j < l.h; j++) for (let i = 0; i < l.w; i++) {
        const x = l.x + i, y = l.y + j, t = k(x, y);
        if (lotOf.has(t)) out.push(`OVERLAP @${x},${y} ${lotOf.get(t)} & b${bi}`);
        lotOf.set(t, `b${bi}`);
        if (road.has(t)) out.push(`LOT-ON-ROAD @${x},${y}`);
        if (square.has(t)) out.push(`LOT-ON-SQUARE @${x},${y}`);
        if (t === hall) out.push(`LOT-ON-HALL @${x},${y}`);
      }
      // …and the whole frontage must be a street, not just one tile of it (a
      // lot that fronts a gap has no door).
      const [dx, dy] = VEC[l.front];
      const edge: [number, number][] = [];
      if (dy !== 0) {
        const y = dy < 0 ? l.y - 1 : l.y + l.h;
        for (let i = 0; i < l.w; i++) edge.push([l.x + i, y]);
      } else {
        const x = dx < 0 ? l.x - 1 : l.x + l.w;
        for (let j = 0; j < l.h; j++) edge.push([x, l.y + j]);
      }
      if (edge.some(([x, y]) => !road.has(k(x, y)))) {
        out.push(`NO-FRONT ${l.zone} @${l.x},${l.y} ${l.w}x${l.h} front ${l.front}`);
      }
    }
  });
  const dn = (x: number, y: number): number => (road.has(k(x, y)) ? 1 : 0);
  const legal = new Set<number>([...planAvenueTiles(plan), ...plan.culDeSacs].map(([x, y]) => k(x, y)));
  for (const [x, y] of planRoadTiles(plan)) {
    const n = dn(x, y - 1) + dn(x + 1, y) + dn(x, y + 1) + dn(x - 1, y);
    if (n === 1 && !legal.has(k(x, y))) out.push(`STUB @${x},${y}`);
    if (n === 0) out.push(`ISOLATED @${x},${y}`);
  }
  const avenue = new Set(plan.avenueTiles.map(([x, y]) => k(x, y)));
  if (!DIR4.some(([dx, dy]) => avenue.has(k(plan.square.hall[0] + dx, plan.square.hall[1] + dy)))) {
    out.push("HALL-NO-AVENUE");
  }
  if (plan.blocks.filter((b) => b.kind === "built" && b.lots.length > 0).length < 6) {
    out.push(`BLOCKS ${plan.blocks.length}`);
  }
  const roads = planRoadTiles(plan).length;
  const area = (plan.bounds.x1 - plan.bounds.x0 + 1) * (plan.bounds.y1 - plan.bounds.y0 + 1);
  const share = (100 * roads) / area;
  // TOWN-4.7 (#700): a town with a second, crossing avenue carries 2 more
  // tiles of road across its whole depth, so its ceiling is 33%, not 30%.
  if (share < 20 || share > (plan.crossAvenueTiles ? 33 : 30)) out.push(`SHARE ${share.toFixed(1)}%`);
  const [aveMin, aveMax] = AVE_RANGE[plan.size];
  const len = plan.avenueTiles.length / 2;
  if (len < aveMin || len > aveMax) out.push(`AVENUE ${len}`);
  return out;
}

/** The plain road class of a tile, for the corner-frontage rule. */
function roadRank(plan: TownPlan, x: number, y: number): number {
  if (planAvenueTiles(plan).some(([ax, ay]) => ax === x && ay === y)) return 2;
  for (const s of plan.streets) {
    if (s.tiles.some(([sx, sy]) => sx === x && sy === y)) return s.kind === "street" ? 1 : 0;
  }
  for (const [cx, cy] of plan.culDeSacs) if (cx === x && cy === y) return 0;
  return -1;
}

/** Every tile a plan claims: the reserved bands + the avenue. */
function planTileKeys(plan: TownPlan): Set<number> {
  const out = new Set<number>();
  for (const [x, y] of plan.reserved) out.add(k(x, y));
  for (const [x, y] of planAvenueTiles(plan)) out.add(k(x, y));
  return out;
}

/** FNV-1a over a grid's terrain, occupancy, towns and highways. */
function hashMap(grid: Grid): number {
  let h = 0x811c9dc5;
  const fnv = (byte: number): void => { h = ((h ^ (byte & 0xff)) * 0x01000193) >>> 0; };
  for (let i = 0; i < grid.terrain.length; i++) fnv(grid.terrain[i]);
  for (let i = 0; i < grid.occupancy.length; i++) fnv(grid.occupancy[i]);
  for (const t of grid.towns) {
    fnv(t.tx); fnv(t.ty); fnv(t.houses.length); fnv(t.roads.length);
    for (const [x, y] of t.houses) { fnv(x); fnv(y); }
    for (const [x, y] of t.roads) { fnv(x); fnv(y); }
  }
  for (const [x, y] of grid.publicRoads ?? []) { fnv(x); fnv(y); }
  return h;
}

// Verified against main @ c66a1a5 with the same fingerprint (a worktree run of
// this function on the unmodified tree, 2026-10-04): planned is opt-in, so
// neither legacy layout may move by a single tile.
const LEGACY_HASHES: Record<string, number> = {
  "grid/1": 132485636, "grid/7": 2395692941, "grid/42": 209064556, "grid/1337": 411691004,
  "organic/1": 3349895340, "organic/7": 531011636, "organic/42": 3118420460, "organic/1337": 2649360952,
};

// ── the plan itself ───────────────────────────────────────────────────────
describe("TOWN-4.3 planned towns — the master plan", () => {
  it("places the full town quota, every town planned", () => {
    for (const { seed, grid } of maps) {
      expect(grid.towns.length, `seed ${seed} town count`).toBe(4);
      for (const t of grid.towns) {
        expect(t.plan, `seed ${seed} town ${t.id} has no plan`).toBeDefined();
        expect(t.plan!.size).toBe("standard");
        expect(t.plan!.districts).toBe(4);
      }
    }
  });

  it("passes the whole audit on every pinned seed", () => {
    for (const { seed, town, plan } of plans) {
      expect(audit(plan), `seed ${seed} town ${town.id}`).toEqual([]);
    }
  });

  it("draws one straight, 2-wide avenue that reaches both plan edges", () => {
    const axes = new Set<string>();
    for (const { seed, town, plan } of plans) {
      const len = plan.avenueTiles.length / 2;
      expect(Number.isInteger(len), `seed ${seed} town ${town.id} odd avenue`).toBe(true);
      expect(len, `seed ${seed} town ${town.id}`).toBeGreaterThanOrEqual(22);
      expect(len, `seed ${seed} town ${town.id}`).toBeLessThanOrEqual(28);
      // In the plan frame the avenue is exactly two rows at v = −2, −1, one u
      // per tile: contiguous, straight, axis-aligned, both carriageways.
      const rows = new Map<number, number[]>();
      for (const [x, y] of plan.avenueTiles) {
        const u = plan.axis === "x" ? x - town.tx : y - town.ty;
        const v = (plan.axis === "x" ? y - town.ty : x - town.tx) * plan.mirror;
        const list = rows.get(v) ?? [];
        list.push(u);
        rows.set(v, list);
      }
      expect([...rows.keys()].sort((a, b) => a - b), `seed ${seed} town ${town.id} carriageways`)
        .toEqual([-2, -1]);
      for (const [, us] of rows) {
        us.sort((a, b) => a - b);
        expect(us.length, `seed ${seed} town ${town.id} avenue run`).toBe(len);
        for (let i = 1; i < us.length; i++) expect(us[i] - us[i - 1]).toBe(1);
      }
      // The axis is measured, not drawn — across the pinned seeds both
      // orientations show up (an avenue that could only ever run one way
      // would mean the measurement is broken).
      axes.add(plan.axis);
      // …and both ends are the ends a highway may meet.
      const [f, t2] = [plan.avenue.from, plan.avenue.to];
      expect(k(f[0], f[1])).not.toBe(k(t2[0], t2[1]));
      // Four ends per avenue: two carriageways at each end (TOWN-4.7 adds a cross avenue's four).
      expect(plan.termini.length, `seed ${seed} town ${town.id} termini`).toBe(plan.crossAvenueTiles ? 8 : 4);
      const av = new Set(planAvenueTiles(plan).map(([x, y]) => k(x, y)));
      for (const [x, y] of plan.termini) expect(av.has(k(x, y)), `terminus (${x},${y}) off-avenue`).toBe(true);
    }
    expect([...axes].sort(), "both avenue orientations appear").toEqual(["x", "y"]);
  });

  it("puts the 4×4 square on the avenue's midpoint, the hall on its avenue edge", () => {
    for (const { seed, town, plan } of plans) {
      const square = plan.square;
      expect(square.tiles.length, `seed ${seed} town ${town.id} square size`).toBe(16);
      expect(new Set(square.tiles.map(([x, y]) => k(x, y))).size).toBe(16);
      const uOf = (x: number, y: number): number => (plan.axis === "x" ? x : y) - (plan.axis === "x" ? town.tx : town.ty);
      const vOf = (x: number, y: number): number =>
        ((plan.axis === "x" ? y : x) - (plan.axis === "x" ? town.ty : town.tx)) * plan.mirror;
      const us = square.tiles.map(([x, y]) => uOf(x, y));
      const vs = square.tiles.map(([x, y]) => vOf(x, y));
      const u0 = Math.min(...us), u1 = Math.max(...us);
      const v0 = Math.min(...vs), v1 = Math.max(...vs);
      expect(u1 - u0 + 1, `seed ${seed} town ${town.id} square width`).toBe(4);
      expect(v1 - v0 + 1, `seed ${seed} town ${town.id} square depth`).toBe(4);
      // Every column and every row of the rectangle is fully tiled: the
      // square is the paving, not a scattered pinch of tiles.
      expect(new Set(us).size).toBe(4);
      expect(new Set(vs).size).toBe(4);
      for (const u of new Set(us)) expect(us.filter((a) => a === u).length, `column ${u}`).toBe(4);
      for (const v of new Set(vs)) expect(vs.filter((a) => a === v).length, `row ${v}`).toBe(4);
      // The plaza sits beside the avenue (its v = 0 row touches the v = −1
      // carriageway), and the hall is the plaza's avenue-edge centre tile.
      // (`v0 + 0` folds −0 to +0: the mirror multiplies the frame's 0 row.)
      expect(v0 + 0, `seed ${seed} town ${town.id} square not beside the avenue`).toBe(0);
      const hu = uOf(square.hall[0], square.hall[1]);
      expect(hu, `seed ${seed} town ${town.id} hall off the middle of the square`)
        .toBeGreaterThanOrEqual(u0 + 1);
      expect(hu, `seed ${seed} town ${town.id} hall off the middle of the square`).toBeLessThanOrEqual(u1 - 1);
      // (`+ 0` folds the mirrored row's −0 to +0.)
      expect(vOf(square.hall[0], square.hall[1]) + 0, `seed ${seed} town ${town.id} hall off the avenue edge`).toBe(0);
      expect(square.hall[0], `seed ${seed} town ${town.id} hall is Town.tx/ty`).toBe(town.tx);
      expect(square.hall[1], `seed ${seed} town ${town.id} hall is Town.tx/ty`).toBe(town.ty);
      // …and the plaza is centred on the avenue's midpoint (± the paving).
      const uMid = plan.avenueTiles.reduce((s, [x, y]) => s + uOf(x, y), 0) / plan.avenueTiles.length;
      expect(Math.abs((u0 + u1) / 2 - uMid), `seed ${seed} town ${town.id} plaza off midpoint`)
        .toBeLessThanOrEqual(2);
    }
  });

  it("fronts every corner lot on the busier of the streets meeting there", () => {
    for (const { seed, town, plan } of plans) {
      for (const block of plan.blocks) {
        for (const lot of block.lots) {
          if (!lot.corner) continue;
          let widest = -1;
          for (let j = 0; j < lot.h; j++) for (let i = 0; i < lot.w; i++) {
            for (const [dx, dy] of DIR4) {
              widest = Math.max(widest, roadRank(plan, lot.x + i + dx, lot.y + j + dy));
            }
          }
          const [dx, dy] = VEC[lot.front];
          let frontBest = -1;
          const tiles = dy !== 0
            ? Array.from({ length: lot.w }, (_, i) => [lot.x + i, dy < 0 ? lot.y - 1 : lot.y + lot.h] as [number, number])
            : Array.from({ length: lot.h }, (_, j) => [dx < 0 ? lot.x - 1 : lot.x + lot.w, lot.y + j] as [number, number]);
          for (const [x, y] of tiles) frontBest = Math.max(frontBest, roadRank(plan, x, y));
          expect(frontBest, `seed ${seed} town ${town.id} corner lot @${lot.x},${lot.y} fronts a side street`)
            .toBe(widest);
        }
      }
    }
  });

  it("keeps the plans off each other: no tile belongs to two towns", () => {
    // The epic's TOWN_TOWN_SEP (44 standard / 64 large) is the TARGET — the
    // first rung of the centre ladder. The hard floor is here: the reserved
    // bands are not stamped, so `occ` alone cannot keep two plans apart and a
    // large seed that cannot fit four plans at 64 still places four that
    // interlock rather than dropping one.
    for (const { seed, grid } of maps) {
      const seen = new Map<number, number>();
      for (const t of grid.towns) {
        for (const key of planTileKeys(t.plan!)) {
          const prev = seen.get(key);
          expect(prev, `seed ${seed} tile ${key} belongs to towns ${prev} and ${t.id}`).toBeUndefined();
          seen.set(key, t.id);
        }
      }
    }
  });

  it("keeps the epic's 44-tile centre separation on the standard seeds", () => {
    for (const { seed, grid } of maps) {
      for (let a = 0; a < grid.towns.length; a++) {
        for (let b = a + 1; b < grid.towns.length; b++) {
          const cheb = Math.max(
            Math.abs(grid.towns[a].tx - grid.towns[b].tx),
            Math.abs(grid.towns[a].ty - grid.towns[b].ty),
          );
          expect(cheb, `seed ${seed} towns ${a}/${b}`).toBeGreaterThanOrEqual(44);
        }
      }
    }
  });

  it("keeps districts 0–3 as real, increasing bands", () => {
    const seen = new Set<number>();
    for (const { plan } of plans) {
      const { u, v } = plan.rings;
      expect(u[0] < u[1] && u[1] < u[2], "ring u not increasing").toBe(true);
      expect(v[0] < v[1] && v[1] < v[2], "ring v not increasing").toBe(true);
    }
    for (const { seed, town, plan } of plans) {
      expect(planTileDistrict(plan, ...plan.square.hall), `seed ${seed} hall not in the core`).toBe(0);
      for (const t of plan.square.tiles) {
        expect(planTileDistrict(plan, t[0], t[1]), `seed ${seed} plaza tile off the core`).toBe(0);
      }
      const coreLots = planLotTiles(plan).filter(([x, y]) => planTileDistrict(plan, x, y) === 0);
      expect(coreLots.length, `seed ${seed} town ${town.id} has no district-0 lots`).toBeGreaterThan(0);
      for (const [x, y] of planLotTiles(plan)) seen.add(planTileDistrict(plan, x, y));
    }
    // Across the pinned seeds all four bands carry lots (nothing collapses).
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("commits exactly the village: houses + district-0 streets + the whole avenue + the square", () => {
    for (const { seed, town, plan } of plans) {
      const { houses, roads, square } = planVillage(plan);
      const houseSet = new Set(town.houses.map(([x, y]) => k(x, y)));
      const roadSet = new Set(town.roads.map(([x, y]) => k(x, y)));
      const squareSet = new Set(plan.square.tiles.map(([x, y]) => k(x, y)));
      const avenueSet = new Set(planAvenueTiles(plan).map(([x, y]) => k(x, y)));
      const lotTiles = new Set(planLotTiles(plan).map(([x, y]) => k(x, y)));
      expect(houseSet.size, `seed ${seed} town ${town.id} duplicate house tiles`).toBe(houses.length);
      expect(roadSet.size, `seed ${seed} town ${town.id} duplicate road tiles`).toBe(roads.length);
      expect(town.houses.length, `seed ${seed} town ${town.id} houses`).toBe(houses.length);
      expect(town.roads.length, `seed ${seed} town ${town.id} roads`).toBe(roads.length);
      expect(square.length, `seed ${seed} town ${town.id} square tiles`).toBe(16);
      const where = (x: number, y: number): string => `seed ${seed} town ${town.id} (${x},${y})`;
      // Houses: every tile is a district-0 lot tile and never a street.
      for (const [x, y] of town.houses) {
        expect(lotTiles.has(k(x, y)), `${where(x, y)} is not a lot tile`).toBe(true);
        expect(planTileDistrict(plan, x, y), `${where(x, y)} house outside the core`).toBe(0);
        expect(roadSet.has(k(x, y)) || squareSet.has(k(x, y)), `${where(x, y)} house on paving`).toBe(false);
      }
      // …and every district-0 lot tile is built on (the village is complete).
      for (const [x, y] of planLotTiles(plan)) {
        if (planTileDistrict(plan, x, y) !== 0) continue;
        expect(houseSet.has(k(x, y)), `${where(x, y)} core lot left free`).toBe(true);
      }
      // Roads: the WHOLE avenue (already at tier 0) plus every district-0 street.
      for (const [x, y] of planAvenueTiles(plan)) {
        expect(roadSet.has(k(x, y)), `${where(x, y)} avenue tile unpaved`).toBe(true);
      }
      // TOWN-4.7: planVillage may commit a FEW district-1 plan-street tiles: the
      // shortest connectors that join a stray village street to the avenue.
      const planStreets = new Set(planRoadTiles(plan).map(([x, y]) => k(x, y)));
      let connectors = 0;
      for (const [x, y] of town.roads) {
        if (avenueSet.has(k(x, y)) || planTileDistrict(plan, x, y) === 0) continue;
        connectors++;
        expect(planStreets.has(k(x, y)), `${where(x, y)} reserved street committed early`).toBe(true);
      }
      expect(connectors, `seed ${seed} town ${town.id} too many early street tiles`).toBeLessThanOrEqual(16);
      for (const [x, y] of planRoadTiles(plan)) {
        if (planTileDistrict(plan, x, y) !== 0) continue;
        expect(roadSet.has(k(x, y)), `${where(x, y)} core street left out`).toBe(true);
      }
    }
  });

  it("does not stamp the reserved districts into occupancy", () => {
    for (const { seed, grid } of maps) {
      for (const t of grid.towns) {
        const plan = t.plan!;
        const committed = new Set<number>([
          ...t.houses.map(([x, y]) => k(x, y)),
          ...t.roads.map(([x, y]) => k(x, y)),
          ...plan.square.tiles.map(([x, y]) => k(x, y)),
        ]);
        for (const [x, y] of plan.reserved) {
          if (committed.has(k(x, y))) continue;
          expect(grid.occupancy[k(x, y)], `seed ${seed} reserved tile (${x},${y}) occupied`)
            .toBe(-1);
        }
      }
    }
  });

  it("occupancy is exactly the towns' houses + roads + squares, over the industries", () => {
    for (const { seed, grid } of maps) {
      const occ = new Int16Array(MAP_W * MAP_H).fill(-1);
      for (const ind of grid.industries) {
        for (let x = 0; x < ind.w; x++) for (let y = 0; y < ind.h; y++) {
          occ[(ind.ty + y) * MAP_W + ind.tx + x] = ind.id;
        }
      }
      for (const t of grid.towns) {
        for (const [hx, hy] of t.houses) {
          expect(occ[k(hx, hy)], `seed ${seed} town ${t.id} overlap at (${hx},${hy})`).toBe(-1);
          occ[k(hx, hy)] = TOWN_OCC;
        }
        for (const [rx, ry] of t.roads) {
          expect(occ[k(rx, ry)], `seed ${seed} town ${t.id} overlap at (${rx},${ry})`).toBe(-1);
          occ[k(rx, ry)] = TOWN_OCC;
        }
        for (const [sx, sy] of t.plan!.square.tiles) {
          expect(occ[k(sx, sy)], `seed ${seed} town ${t.id} overlap at (${sx},${sy})`).toBe(-1);
          occ[k(sx, sy)] = TOWN_OCC;
        }
      }
      expect(grid.occupancy, `seed ${seed}`).toEqual(occ);
    }
  });

  it("stands every building on dry land, in bounds", () => {
    for (const { seed, grid } of maps) {
      for (const t of grid.towns) {
        for (const [x, y] of [...t.houses, ...t.roads, ...planAvenueTiles(t.plan!)]) {
          expect(inBounds(x, y), `seed ${seed} off-map`).toBe(true);
          expect(grid.terrain[idx(x, y)], `seed ${seed} town ${t.id} tile (${x},${y}) on water`)
            .not.toBe(WATER);
        }
      }
    }
  });
});

// ── the highway hand-off ─────────────────────────────────────────────────
describe("TOWN-4.3 planned towns — highways", () => {
  it("meets an avenue terminus on every planned town", () => {
    for (const { seed, grid } of maps) {
      const pub = new Set((grid.publicRoads ?? []).map(([x, y]) => k(x, y)));
      expect(pub.size, `seed ${seed} has no public roads`).toBeGreaterThan(0);
      for (const t of grid.towns) {
        const hit = t.plan!.termini.filter(([x, y]) =>
          DIR4.some(([dx, dy]) => pub.has(k(x + dx, y + dy))));
        expect(hit.length, `seed ${seed} town ${t.id} highway misses every avenue end`)
          .toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("rides ONE 4-connected network: every town's roads + the highways", () => {
    for (const { seed, grid } of maps) {
      const all = new Set<number>();
      for (const t of grid.towns) for (const [x, y] of t.roads) all.add(k(x, y));
      for (const [x, y] of grid.publicRoads ?? []) all.add(k(x, y));
      const s0 = k(...grid.towns[0].roads[0]);
      const seen = new Set<number>([s0]);
      const queue: number[] = [s0];
      for (let head = 0; head < queue.length; head++) {
        const cur = queue[head];
        const cx = cur % MAP_W, cy = (cur / MAP_W) | 0;
        for (const [dx, dy] of DIR4) {
          const ni = k(cx + dx, cy + dy);
          if (!all.has(ni) || seen.has(ni)) continue;
          seen.add(ni);
          queue.push(ni);
        }
      }
      expect(seen.size, `seed ${seed} streets + highways split into pieces`).toBe(all.size);
    }
  });

  it("leaves every industry with a harvestable, reachable site", () => {
    for (const { seed, grid } of maps) {
      expect(grid.industries.length, `seed ${seed} no industries`).toBeGreaterThan(0);
      for (const ind of grid.industries) {
        const spots = harvesterSpots(grid, ind);
        expect(spots.length, `seed ${seed} industry ${ind.id} has no harvester spot`).toBeGreaterThan(0);
        for (const [x, y] of spots) {
          expect(inBounds(x, y), `seed ${seed} spot off-map`).toBe(true);
          expect(grid.terrain[idx(x, y)], `seed ${seed} spot in water`).not.toBe(WATER);
        }
      }
    }
  });
});

// ── the legacy layouts may not move ──────────────────────────────────────
describe("TOWN-4.3 planned towns — the legacy layouts are untouched", () => {
  it("grid and organic fingerprints match main on the pinned seeds", () => {
    for (const seed of [1, 7, 42, 1337]) {
      expect(hashMap(generateMap(seed, { layout: "grid" })), `grid seed ${seed}`)
        .toBe(LEGACY_HASHES[`grid/${seed}`]);
      expect(hashMap(generateMap(seed, { layout: "organic" })), `organic seed ${seed}`)
        .toBe(LEGACY_HASHES[`organic/${seed}`]);
    }
  });

  it("absent and explicit-grid still generate the identical map", () => {
    for (const seed of [42, 1337]) {
      const a = generateMap(seed);
      const b = generateMap(seed, { layout: "grid" });
      expect(JSON.stringify(a.towns), `seed ${seed} towns`).toBe(JSON.stringify(b.towns));
      expect(a.terrain).toEqual(b.terrain);
      expect(a.occupancy).toEqual(b.occupancy);
      expect(JSON.stringify(a.publicRoads)).toBe(JSON.stringify(b.publicRoads));
    }
  });

  it("a planned town carries no organic extras (the grid art pass, not the organic one)", () => {
    for (const { seed, town } of plans) {
      expect(town.organicDiag, `seed ${seed}`).toBeUndefined();
      expect(town.organicWedges, `seed ${seed}`).toBeUndefined();
    }
  });
});

// ── the option chain ─────────────────────────────────────────────────────
describe("TOWN-4.3 planned towns — the option chain", () => {
  it("reads \"planned\" everywhere a layout is read", () => {
    expect(TOWN_LAYOUTS).toContain("planned");
    expect(resolveTownLayout({ explicit: { layout: "planned" } })).toBe("planned");
    expect(resolveTownLayout({ search: "?layout=planned" })).toBe("planned");
    // …and an unknown name still falls to the default, never to planned.
    expect(resolveTownLayout({ search: "?layout=circle" })).not.toBe("planned");
  });

  it("keeps a planned layout through a save, a room and the wire", () => {
    const saved = normalizeMatchSettings({
      ...DEFAULT_MATCH_SETTINGS,
      map: { ...MAP_OPTIONS_ON, layout: "planned" },
    })!;
    expect(saved.map?.layout).toBe("planned");
    expect(resolveTownLayout({ save: { map: saved.map } })).toBe("planned");
    expect(resolveTownLayout({ room: { map: { ...MAP_OPTIONS_OFF, layout: "planned" } } })).toBe("planned");
    // A malformed layout still drops the map record whole (never half-read).
    expect(normalizeMatchSettings({ winTarget: 10, map: { rivers: true, layout: "planned " } })!.map)
      .toBeUndefined();
    // …and a layout-less record keeps its exact pre-TOWN-4 shape.
    expect(normalizeMatchSettings({ winTarget: 10, map: { rivers: true } })!.map)
      .toEqual({ rivers: true, elevation: false, shapes: false, rings: false, diag: false });
  });

  it("pins the size knobs the ticket fixes", () => {
    expect(plannedTownSep("standard")).toBe(44);
    expect(plannedTownSep("large")).toBe(64);
    // Mirrors grid.ts's TOWN_INDUSTRY_SEP (module-private there): the plan
    // keeps the same industry halo the grid layout keeps around a house.
    expect(PLANNED_INDUSTRY_SEP).toBe(8);
  });
});

// ── the boot stamp (TOWN-4.2's seam) ─────────────────────────────────────
describe("TOWN-4.3 planned towns — boot stamping", () => {
  it("paves both avenue carriageways as ordinary public road", () => {
    const grid = maps.find((m) => m.seed === 1)!.grid;
    const track = createTrack(true);
    seedTownRoads(track, grid);
    seedTownDiagonals(track, grid);
    seedTownAvenues(track, grid);
    seedPublicRoads(track, grid);
    for (const t of grid.towns) {
      for (const [x, y] of t.plan!.avenueTiles) {
        expect(isPublicRoad(track, x, y), `avenue (${x},${y}) is not public road`).toBe(true);
      }
    }
    // Both carriageways are the SAME road tier for now: TOWN-4.2 (#678) is the
    // ticket that gives the avenue its own AVENUE_X/Y tier, and it changes
    // `stampAvenue` alone; until then both lines ride the ordinary public
    // road, so every avenue tile answers `isPublicRoad`.
    for (const t of grid.towns) {
      expect(t.plan!.avenueTiles.length, "avenue not stamped").toBeGreaterThan(40);
    }
  });

  it("is a no-op on a grid map (no planned town, no avenue)", () => {
    const grid = generateMap(7, { layout: "grid" });
    const track = createTrack(true);
    seedTownRoads(track, grid);
    seedTownDiagonals(track, grid);
    seedTownAvenues(track, grid);
    seedPublicRoads(track, grid);
    for (const t of grid.towns) {
      for (const [x, y] of t.roads) {
        expect(isPublicRoad(track, x, y), `town road (${x},${y}) not public`).toBe(true);
      }
    }
  });
});

// A tiny guard against the audit quietly passing on an empty set.
describe("TOWN-4.3 planned towns — the audit is not vacuous", () => {
  it("audits four towns per seed", () => {
    expect(plans.length).toBe(SEEDS.length * 4);
    for (const { seed, town, plan } of plans) {
      expect(plan.blocks.length, `seed ${seed} town ${town.id}`).toBeGreaterThanOrEqual(6);
      expect(planLotTiles(plan).length, `seed ${seed} town ${town.id}`).toBeGreaterThan(30);
    }
  });
});

// ── the large map (TOWN-4.1 has landed: sizes its plans large) ────────────
describe("TOWN-4.3 planned towns — a large map draws large plans", () => {
  afterEach(() => { releaseMapSize(); });
  it("sizes the avenue 32–40 and the square 4×6, and keeps the plans apart", () => {
    releaseMapSize();
    setMapSize(MAP_SIZES.large, MAP_SIZES.large);
    for (const seed of [1, 7, 42]) {
      const grid = generateMap(seed, { size: "large", layout: "planned" });
      expect(grid.towns.length, `seed ${seed} town count`).toBe(4);
      for (const t of grid.towns) {
        const plan = t.plan!;
        expect(plan.size, `seed ${seed} town ${t.id} plan size`).toBe("large");
        expect(plan.square.tiles.length, `seed ${seed} town ${t.id} plaza`).toBe(SQUARE_TILES.large);
        expect(plan.avenueTiles.length / 2, `seed ${seed} town ${t.id} avenue`)
          .toBeGreaterThanOrEqual(AVE_RANGE.large[0]);
        expect(audit(plan), `seed ${seed} town ${t.id} (large)`).toEqual([]);
      }
      // The centre separation here is the 64-tile TARGET (the ladder's first
      // rung): seeds 1 and 42 cannot fit four plans that far apart on this
      // size and fall to the interlock floor below instead of dropping a
      // town. The floor is exact: no tile belongs to two plans.
      const seen = new Map<number, number>();
      for (const t of grid.towns) {
        for (const key of planTileKeys(t.plan!)) {
          const prev = seen.get(key);
          expect(prev, `seed ${seed} tile ${key} belongs to towns ${prev} and ${t.id}`).toBeUndefined();
          seen.set(key, t.id);
        }
      }
      // …and the plan is still a pure function of the seed and the size.
      expect(JSON.stringify(generateMap(seed, { size: "large", layout: "planned" }).towns))
        .toBe(JSON.stringify(grid.towns));
    }
  }, 300000);
});
