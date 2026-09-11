// ══════════════════════════════════════════════════════════════════════════
// E3 — Grid generation (isometric): typed-array terrain + industry placement
//
// Replaces the hex `hexmap.ts` geometry. Deterministic under a seed:
// multiplayer ships only the seed and every client regenerates byte-identical
// terrain + industries (net.ts must never send them — E10).
//
// Terrain is a flat Uint8Array (read every frame by the culler — no object
// arrays). Industries live in a separate list with an occupancy Int16Array
// mapping tile index → industry list index (or -1). Placement is Poisson-disc
// style rejection sampling: target separation 12 tiles, no overlap, not on
// water, quota per industry type so no cargo is absent from the map.
// ══════════════════════════════════════════════════════════════════════════
import {
  MAP_W, MAP_H, mulberry32, INDUSTRIES, INDUSTRY_QUOTA, INDUSTRY_BY_KEY, FACTORY_FOOTPRINT,
} from "./config";

export const GRASS = 0;
export const WATER = 1;
export const ROUGH = 2;
/**
 * W-series terrain overhaul: the golden beach ring hugging the coastline.
 * Purely cosmetic — every gameplay check treats SAND exactly like GRASS
 * (buildable, flat cost). Assigned deterministically after landmass
 * selection, so the seed → map contract is unchanged.
 */
export const SAND = 3;

export const idx = (tx: number, ty: number) => ty * MAP_W + tx;
export const inBounds = (tx: number, ty: number) =>
  tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H;

export interface Industry {
  id: number;             // index into grid.industries
  type: string;           // INDUSTRY_BY_KEY key, e.g. "farm"
  tx: number;             // footprint origin tile (top corner of the diamond)
  ty: number;
  w: number;              // footprint [w, h]
  h: number;
  output: number;
  banditUntil: number;    // blockade expiry (0 = none) — legacy carry-over
}

/** TOWN-1: a town is a cluster of house tiles around a center. */
export interface Town {
  id: number;
  tx: number;             // center tile
  ty: number;
  houses: [number, number][];  // list of house tile positions
  /** PP-10: the town's simple ring road — the perimeter of the house
   *  bounding box expanded by one tile, kept on free land only. The tiles
   *  are stamped TOWN_OCC in `occupancy` (a town's roads belong to the
   *  town, exactly like its houses: nobody may build on them), and the game
   *  copies them onto the track layer at boot (`seedTownRoads` in track.ts).
   *  A pure function of the houses plus the terrain/occupancy at placement
   *  time, so the map stays deterministic under the seed. */
  roads: [number, number][];
}

export interface Grid {
  w: number;
  h: number;
  terrain: Uint8Array;        // MAP_W*MAP_H values GRASS | WATER | ROUGH | SAND
  industries: Industry[];
  towns: Town[];              // TOWN-1: four towns per map
  /**
   * PP-13: the map's PUBLIC ROADS — the seed-generated highway that links the
   * towns (see `publicRoadTiles`). Optional only so the hand-built synthetic
   * grids in the unit tests stay valid; `generateMap` always fills it.
   *
   * These tiles are deliberately NOT stamped in `occupancy`: a public road is
   * track, not town furniture, so a player may build over it (and, because a
   * tile that already carries road costs nothing, claim it into their own
   * network for free). The game stamps them onto the road layer at boot with
   * owner `PUBLIC_OWNER` (`seedPublicRoads` in track.ts), which is what makes
   * them usable by every player's network.
   */
  publicRoads?: [number, number][];
  occupancy: Int16Array;      // per tile: industry list index or -1 (towns use -2)
  seed: number;
}

function makeTerrain(rng: () => number): Uint8Array {
  const t = new Uint8Array(MAP_W * MAP_H).fill(GRASS);
  const set = (tx: number, ty: number, v: number) => {
    if (inBounds(tx, ty)) t[idx(tx, ty)] = v;
  };
  const distEdge = (tx: number, ty: number) =>
    Math.min(tx, ty, MAP_W - 1 - tx, MAP_H - 1 - ty);

  // ── water: ragged outer coastline only (G3 — no interior lakes) ──
  for (let tx = 0; tx < MAP_W; tx++) {
    for (let ty = 0; ty < MAP_H; ty++) {
      const d = distEdge(tx, ty);
      const jag = 2 + Math.floor(rng() * 3);      // 2..4 tile raggedness
      if (d < jag) set(tx, ty, WATER);
    }
  }

  // G3: ragged jag can isolate 1-tile islets in the ring. Keep only the
  // largest 4-connected landmass so every remaining land tile is reachable.
  {
    const n = MAP_W * MAP_H;
    const seen = new Uint8Array(n);
    let best: number[] = [];
    for (let i = 0; i < n; i++) {
      if (seen[i] || t[i] === WATER) continue;
      const comp: number[] = [];
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const cur = stack.pop()!;
        comp.push(cur);
        const x = cur % MAP_W, y = (cur / MAP_W) | 0;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
          const ni = ny * MAP_W + nx;
          if (seen[ni] || t[ni] === WATER) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
      if (comp.length > best.length) best = comp;
    }
    const keep = new Set(best);
    for (let i = 0; i < n; i++) if (t[i] !== WATER && !keep.has(i)) t[i] = WATER;
  }

  // ── rough (rocky) terrain: blobs + mountain spine clumps ──
  const blobs = 14 + Math.floor(rng() * 8);
  for (let i = 0; i < blobs; i++) {
    const cx = 3 + rng() * (MAP_W - 6);
    const cy = 3 + rng() * (MAP_H - 6);
    const r = 1.5 + rng() * 2.6;
    for (let tx = Math.max(0, Math.floor(cx - r - 1)); tx <= Math.min(MAP_W - 1, Math.ceil(cx + r + 1)); tx++) {
      for (let ty = Math.max(0, Math.floor(cy - r - 1)); ty <= Math.min(MAP_H - 1, Math.ceil(cy + r + 1)); ty++) {
        if (Math.hypot(tx - cx, ty - cy) + (rng() - 0.5) * 1.6 < r) {
          if (t[idx(tx, ty)] === GRASS) set(tx, ty, ROUGH);
        }
      }
    }
  }

  // ── W-series: the beach ring ──
  // Every grass tile that touches water (8-neighbourhood) becomes SAND, so
  // the island is lined with a golden beach edge exactly along the coast.
  // Runs AFTER the rough blobs so the beach always wins the shoreline (a
  // rock clump that reaches the coast keeps its inland tiles only). Consumes
  // no rng: the seed stream below this point is unchanged.
  {
    const sand: number[] = [];
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        if (t[idx(tx, ty)] !== GRASS) continue;
        let touches = false;
        for (let dy = -1; dy <= 1 && !touches; dy++) {
          for (let dx = -1; dx <= 1 && !touches; dx++) {
            if (!dx && !dy) continue;
            const nx = tx + dx, ny = ty + dy;
            if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
            if (t[idx(nx, ny)] === WATER) touches = true;
          }
        }
        if (touches) sand.push(idx(tx, ty));
      }
    }
    for (const i of sand) t[i] = SAND;
  }
  return t;
}

function placeIndustries(terrain: Uint8Array, rng: () => number): { list: Industry[]; occ: Int16Array } {
  const occ = new Int16Array(MAP_W * MAP_H).fill(-1);
  const list: Industry[] = [];
  const idAt = (tx: number, ty: number) =>
    inBounds(tx, ty) ? occ[idx(tx, ty)] : -1;

  // true when the whole footprint is placeable at (tx,ty): in bounds, no
  // water, no overlap with an existing industry.
  const footprintFree = (tx: number, ty: number, w: number, h: number) => {
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const gx = tx + x, gy = ty + y;
        if (!inBounds(gx, gy)) return false;
        const ti = idx(gx, gy);
        if (terrain[ti] === WATER) return false;
        if (occ[ti] !== -1) return false;
      }
    }
    return true;
  };

  // Poisson-disc separation: no tile of the new footprint may come within
  // `sep` tiles (Chebyshev) of an occupied tile. sep <= 1 degenerates to the
  // no-overlap check above.
  const separated = (tx: number, ty: number, w: number, h: number, sep: number) => {
    if (sep <= 1) return true;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const gx = tx + x, gy = ty + y;
        for (let dx = -(sep - 1); dx <= sep - 1; dx++) {
          for (let dy = -(sep - 1); dy <= sep - 1; dy++) {
            if (idAt(gx + dx, gy + dy) !== -1) return false;
          }
        }
      }
    }
    return true;
  };

  const defs = INDUSTRIES.map((d) => ({ d, n: INDUSTRY_QUOTA[d.key] ?? 0 }));
  // try to guarantee the quota: relax separation 12 → … → 1 (overlap-only).
  // T4: on the 144×144 map the same INDUSTRY_QUOTA has 9× the room, so start
  // from a much wider target sep (was 6) and let the fallback converge; this
  // spreads industries instead of letting them clump as the old sep would.
  for (const sep of [12, 8, 6, 4, 2, 1]) {
    let placedAny = true;
    while (placedAny) {
      placedAny = false;
      for (const { d, n } of defs) {
        const have = list.filter((i) => i.type === d.key).length;
        for (let k = have; k < n; k++) {
          const w = d.footprint[0], h = d.footprint[1];
          let done = false;
          for (let attempt = 0; attempt < 90 && !done; attempt++) {
            const tx = Math.floor(rng() * (MAP_W - w + 1));
            const ty = Math.floor(rng() * (MAP_H - h + 1));
            if (footprintFree(tx, ty, w, h) && separated(tx, ty, w, h, sep)) {
              list.push({
                id: list.length, type: d.key, tx, ty, w, h,
                output: d.output, banditUntil: 0,
              });
              for (let x = 0; x < w; x++) {
                for (let y = 0; y < h; y++) {
                  occ[idx(tx + x, ty + y)] = list.length - 1;
                }
              }
              done = true;
              placedAny = true;
            }
          }
          if (!done && sep === 1) {
            // Land still exists on this map; keep the quota best-effort but
            // do not loop forever. Log-free: caller may assert quotas.
            break;
          }
        }
      }
    }
  }
  // final pass: renumber ids to indices and order by id (stable)
  list.forEach((ind, i) => { ind.id = i; });
  return { list, occ };
}

/** TOWN-1: number of towns per map. */
const TOWN_COUNT = 4;
/**
 * TOWN-1: houses per town (min..max inclusive).
 *
 * PP-13: TRIPLED (was 6..12). A settlement of 6–12 houses read as a hamlet
 * next to the 144×144 map T4 shipped, and its PP-10 ring road was barely a
 * loop. Three times the houses triples the built area, which also triples the
 * ring road and the interior streets `townRoadTiles` paves inside the house
 * box — the town footprint grows with it, since the box is derived from the
 * houses. The 8-tile industry ring (TOWN_INDUSTRY_SEP) and the 28-tile
 * town-to-town centre separation are unchanged: they are separations, not
 * sizes, and the map has the room (all four towns still place on every
 * standard seed — pinned in tests/unit/iso-grid.test.ts).
 */
export const TOWN_HOUSES_MIN = 18;
export const TOWN_HOUSES_MAX = 36;
/** Minimum Chebyshev distance from EVERY town tile to any industry tile.
 * T4 widens the former 3-tile ring to 8 on the roomier map. */
const TOWN_INDUSTRY_SEP = 8;
/** TOWN-1: minimum Chebyshev distance between two town centres. */
const TOWN_TOWN_SEP = 28;
/** TOWN-1: occupancy sentinel for town tiles (distinct from industry indices ≥ 0). */
export const TOWN_OCC = -2;

/**
 * PP-02: how far (Chebyshev) around each town tile we flatten rocky terrain so
 * the generator can always offer a buildable, town-adjacent Factory footprint
 * per town (and, with it, flat ground for the opening Depot line — rail needs
 * flat land, W8). A factory footprint that touches a town by an EDGE extends
 * at most max(fw, fh) tiles from the touched town tile (see
 * `factoryTouchesTown`), so a ring of this radius guarantees at least one
 * legal, town-adjacent site per town — and PP-12 derives it from the same
 * FACTORY_FOOTPRINT the rules use, so re-arting the factory keeps the
 * guarantee. Industries are ≥8 tiles from any town tile (TOWN_INDUSTRY_SEP),
 * so this never touches an industry footprint.
 * Only FREE tiles are converted — town houses and PP-10 town roads (stamped
 * TOWN_OCC) keep their ground — and the map stays a pure function of `seed`.
 */
export const TOWN_FACTORY_RING = Math.max(...FACTORY_FOOTPRINT);

/**
 * PP-10: a simple road network for a settlement.
 *
 * Two pieces, both "simple" on purpose:
 *   1. the RING — the perimeter of the house bounding box expanded by one
 *      tile: a ring road the settlement sits inside;
 *   2. the INTERIOR streets — every free tile INSIDE the box (the gaps the
 *      BFS-grown cluster leaves between houses along its edge, ~5 per town;
 *      the strict interior is solid, ~0.01 empty tile).
 *
 * Piece 2 is load-bearing, not decoration: the ring is a closed loop of
 * TOWN_OCC tiles, and any free tile it encloses would become a road-buildable
 * ENCLAVE — a pocket the W8 sweep proves the rival's factory search must
 * never commit to. Paving the box's free tiles removes the pockets by
 * construction, and every box-edge street touches the ring, so the network
 * is one connected piece wherever the ring is unbroken.
 *
 * Only free land becomes road: in-bounds, not water, occupancy -1. Rough is
 * legal (roads build on rough). A water tile or an earlier town's tile
 * simply leaves a gap — the autotile masks render the break naturally.
 * Deterministic: same houses + terrain + occupancy → same roads.
 */
export function townRoadTiles(
  houses: [number, number][], terrain: Uint8Array, occ: Int16Array,
): [number, number][] {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [hx, hy] of houses) {
    x0 = Math.min(x0, hx); x1 = Math.max(x1, hx);
    y0 = Math.min(y0, hy); y1 = Math.max(y1, hy);
  }
  // The candidate's own houses are not stamped in `occ` yet (the town
  // commits them after this returns), so exclude them explicitly — a road
  // under a house would be drawn, and the house is the tile's owner anyway.
  const houseSet = new Set<number>(houses.map(([hx, hy]) => idx(hx, hy)));
  const free = (tx: number, ty: number): boolean => {
    if (!inBounds(tx, ty)) return false;
    const i = idx(tx, ty);
    return terrain[i] !== WATER && occ[i] === -1 && !houseSet.has(i);
  };
  const out: [number, number][] = [];
  // Interior streets: the free tiles inside the box (scan order = stable).
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (free(tx, ty)) out.push([tx, ty]);
    }
  }
  // Ring road: the perimeter of the box expanded by one tile.
  for (let ty = y0 - 1; ty <= y1 + 1; ty++) {
    for (let tx = x0 - 1; tx <= x1 + 1; tx++) {
      const onRing = tx === x0 - 1 || tx === x1 + 1 || ty === y0 - 1 || ty === y1 + 1;
      if (onRing && free(tx, ty)) out.push([tx, ty]);
    }
  }
  return out;
}

/** 4-neighbourhood, in a fixed order (keeps every BFS below deterministic). */
const DIR4: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * PP-13: the PUBLIC ROADS — highways that connect the towns.
 *
 * What it builds:
 *   1. a MINIMUM SPANNING TREE over the town centres, so all four settlements
 *      end up on one highway network without paving a redundant loop
 *      (Prim, seeded from town 0, ties by lowest index — no RNG);
 *   2. for each tree edge, the SHORTEST drivable route between the two towns'
 *      own road networks (a multi-source BFS, so the highway meets each
 *      settlement's ring road wherever that is cheapest).
 *
 * "Drivable" means: in bounds, not water, not an industry footprint, not a
 * house. A town's own ROAD tiles are passable — that is precisely how the
 * highway joins a settlement — and rough ground is fine, because roads build
 * on rough (`TRANSPORT.road.onRough`).
 *
 * Tiles a town already paves are left out of the result: they are on the road
 * layer already, and they keep the town's neutral ownership rather than being
 * adopted into the public highway.
 *
 * Deterministic and pure — a function of the towns, the terrain and the
 * occupancy at generation time, with no RNG draws of its own, so it cannot
 * perturb the seeded stream the rest of the map depends on.
 */
export function publicRoadTiles(
  towns: Town[], terrain: Uint8Array, occ: Int16Array,
): [number, number][] {
  if (towns.length < 2) return [];

  const houses = new Set<number>();
  for (const t of towns) for (const [hx, hy] of t.houses) houses.add(idx(hx, hy));
  const paved = new Set<number>();
  for (const t of towns) for (const [rx, ry] of t.roads) paved.add(idx(rx, ry));

  const passable = (tx: number, ty: number): boolean => {
    if (!inBounds(tx, ty)) return false;
    const i = idx(tx, ty);
    // occ < 0 keeps both free land (-1) and town tiles (-2); the house set is
    // what takes the houses back out, so a highway may cross a ring road but
    // never runs through somebody's living room.
    return terrain[i] !== WATER && occ[i] < 0 && !houses.has(i);
  };

  /** Where a leg may start/end: the town's ring road, else its centre. */
  const anchorsOf = (t: Town): [number, number][] =>
    t.roads.length ? t.roads : [[t.tx, t.ty]];

  /** Shortest drivable route between two towns' road networks. */
  const link = (a: Town, b: Town): [number, number][] => {
    const targets = new Set<number>(anchorsOf(b).map(([x, y]) => idx(x, y)));
    const prev = new Int32Array(MAP_W * MAP_H).fill(-1);
    const seen = new Uint8Array(MAP_W * MAP_H);
    const queue: number[] = [];
    for (const [sx, sy] of anchorsOf(a)) {
      const si = idx(sx, sy);
      if (seen[si]) continue;
      seen[si] = 1;
      prev[si] = si;                 // a source is its own parent: "walk back stops"
      queue.push(si);
    }
    let found = -1;
    for (let head = 0; head < queue.length && found === -1; head++) {
      const cur = queue[head];
      const x = cur % MAP_W, y = (cur / MAP_W) | 0;
      for (const [dx, dy] of DIR4) {
        const nx = x + dx, ny = y + dy;
        if (!passable(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (seen[ni]) continue;
        seen[ni] = 1;
        prev[ni] = cur;
        if (targets.has(ni)) { found = ni; break; }
        queue.push(ni);
      }
    }
    if (found === -1) return [];     // walled off — this leg simply does not exist
    const path: [number, number][] = [];
    for (let cur = found; ; cur = prev[cur]) {
      path.push([cur % MAP_W, (cur / MAP_W) | 0]);
      if (prev[cur] === cur) break;
    }
    return path.reverse();
  };

  // ── the spanning tree ──
  const cheb = (a: Town, b: Town) => Math.max(Math.abs(a.tx - b.tx), Math.abs(a.ty - b.ty));
  const inTree: Town[] = [towns[0]];
  const rest = towns.slice(1);
  const legs: [Town, Town][] = [];
  while (rest.length) {
    let bestI = 0, bestFrom = inTree[0], bestD = Infinity;
    for (let i = 0; i < rest.length; i++) {
      for (const t of inTree) {
        const d = cheb(rest[i], t);
        if (d < bestD) { bestD = d; bestI = i; bestFrom = t; }
      }
    }
    legs.push([bestFrom, rest[bestI]]);
    inTree.push(rest[bestI]);
    rest.splice(bestI, 1);
  }

  const out: [number, number][] = [];
  const added = new Set<number>();
  for (const [a, b] of legs) {
    for (const [tx, ty] of link(a, b)) {
      const i = idx(tx, ty);
      if (paved.has(i) || added.has(i)) continue;
      added.add(i);
      out.push([tx, ty]);
    }
  }
  return out;
}

function placeTowns(
  terrain: Uint8Array, occ: Int16Array, industries: Industry[], rng: () => number,
): Town[] {
  const towns: Town[] = [];

  const tileFree = (tx: number, ty: number) => {
    if (!inBounds(tx, ty)) return false;
    if (terrain[idx(tx, ty)] === WATER) return false;
    if (occ[idx(tx, ty)] !== -1) return false;   // occupied by an industry or another town house
    return true;
  };

  /** Chebyshev distance from (tx,ty) to the nearest tile of any industry. */
  const industrySep = (tx: number, ty: number) => {
    let best = Infinity;
    for (const ind of industries) {
      // distance from point to rect [ind.tx, ind.tx+w) × [ind.ty, ind.ty+h)
      const dx = Math.max(ind.tx - tx, 0, tx - (ind.tx + ind.w - 1));
      const dy = Math.max(ind.ty - ty, 0, ty - (ind.ty + ind.h - 1));
      best = Math.min(best, Math.max(dx, dy));
    }
    return best;
  };

  const townSep = (tx: number, ty: number) => {
    let best = Infinity;
    for (const t of towns) best = Math.min(best, Math.max(Math.abs(t.tx - tx), Math.abs(t.ty - ty)));
    return best;
  };

  /**
   * TOWN-1: reachability check. With the proposed town tiles marked as
   * impassable, every industry must still be land-reachable from every other.
   * Cheap 4-connected flood from the first non-water, non-blocked tile.
   */
  const allIndustriesReachable = (blocked: Set<number>) => {
    let start = -1;
    for (const ind of industries) {
      if (start === -1) start = idx(ind.tx, ind.ty);
    }
    if (start === -1) return true;
    if (blocked.has(start)) return false;
    const seen = new Uint8Array(MAP_W * MAP_H);
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      const x = cur % MAP_W, y = (cur / MAP_W) | 0;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        const ni = ny * MAP_W + nx;
        if (seen[ni]) continue;
        if (terrain[ni] === WATER) continue;
        if (blocked.has(ni)) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    for (const ind of industries) {
      for (let x = ind.tx; x < ind.tx + ind.w; x++) {
        for (let y = ind.ty; y < ind.ty + ind.h; y++) {
          if (!seen[idx(x, y)]) return false;
        }
      }
    }
    return true;
  };

  for (let t = 0; t < TOWN_COUNT; t++) {
    let placed = false;
    // try candidate centres at relaxing separation
    for (const sep of [TOWN_TOWN_SEP, 6, 4, 2]) {
      for (let attempt = 0; attempt < 120 && !placed; attempt++) {
        const cx = 4 + Math.floor(rng() * (MAP_W - 8));
        const cy = 4 + Math.floor(rng() * (MAP_H - 8));
        if (!tileFree(cx, cy)) continue;
        if (industrySep(cx, cy) < TOWN_INDUSTRY_SEP) continue;
        if (sep > 0 && townSep(cx, cy) < sep) continue;

        // Build a cluster of houses around (cx, cy) by BFS growth.
        const nHouses = TOWN_HOUSES_MIN + Math.floor(rng() * (TOWN_HOUSES_MAX - TOWN_HOUSES_MIN + 1));
        const houses: [number, number][] = [[cx, cy]];
        const houseSet = new Set<number>([idx(cx, cy)]);
        let frontier: [number, number][] = [[cx, cy]];
        while (houses.length < nHouses && frontier.length) {
          // shuffle frontier so growth isn't biased to one direction
          for (let i = frontier.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [frontier[i], frontier[j]] = [frontier[j], frontier[i]];
          }
          const next: [number, number][] = [];
          for (const [fx, fy] of frontier) {
            if (houses.length >= nHouses) break;
            const dirs: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
            // shuffle directions
            for (let i = dirs.length - 1; i > 0; i--) {
              const j = Math.floor(rng() * (i + 1));
              [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
            }
            for (const [dx, dy] of dirs) {
              const nx = fx + dx, ny = fy + dy;
              if (!tileFree(nx, ny)) continue;
              if (houseSet.has(idx(nx, ny))) continue;
              if (industrySep(nx, ny) < TOWN_INDUSTRY_SEP) continue;
              houses.push([nx, ny]);
              houseSet.add(idx(nx, ny));
              next.push([nx, ny]);
              if (houses.length >= nHouses) break;
            }
          }
          frontier = next;
        }
        if (houses.length < TOWN_HOUSES_MIN) continue;

        // PP-10: the proposed town's ring road. Computed from the candidate
        // houses against the CURRENT occupancy, so it never overlaps an
        // industry or an earlier town (both are stamped in `occ` already),
        // and it is part of the proposed tiles for the reachability check
        // below — a closed road loop must never wall off an industry either.
        const roads = townRoadTiles(houses, terrain, occ);

        // Reachability check: the PROPOSED TOWN tiles must not strand any
        // industry. F1 fix: `blocked` holds only the town's house tiles.
        // Adding every occupied industry tile to `blocked` made
        // `allIndustriesReachable` start its flood from an industry tile
        // (`blocked.has(start)` → false), so every candidate failed and no
        // town was ever placed. Industries must stay passable for the flood
        // — the question is "do these houses wall off an industry?", and the
        // flood starts from an industry tile and walks land that excludes
        // only the town footprint (water is already excluded inside).
        // PP-10: the ring road is part of the proposed town, so it is
        // blocked for the flood too (a closed loop could in principle enclose
        // an industry; the 8-tile industry ring makes it impossible in
        // practice, but the check must not rely on that).
        const blocked = new Set<number>();
        for (const [hx, hy] of houses) blocked.add(idx(hx, hy));
        for (const [rx, ry] of roads) blocked.add(idx(rx, ry));
        if (!allIndustriesReachable(blocked)) continue;

        // Commit: mark tiles with TOWN_OCC so later towns/industries avoid them.
        // PP-10: the road tiles are stamped too — a later town's houses AND
        // ring road both treat them as occupied, so towns never overlap.
        for (const [hx, hy] of houses) occ[idx(hx, hy)] = TOWN_OCC;
        for (const [rx, ry] of roads) occ[idx(rx, ry)] = TOWN_OCC;
        towns.push({ id: towns.length, tx: cx, ty: cy, houses, roads });
        placed = true;
      }
      if (placed) break;
    }
  }
  return towns;
}

/**
 * Generate a deterministic 144×144 iso grid. Same seed → byte-identical
 * `terrain`, `occupancy` and `industries` across contexts (T1 determinism).
 *
 * R6: `seed` is required. Multiplayer (E10) must resolve and distribute a
 * concrete seed before generating the map, so every client runs through this
 * same typed path and no client can silently fall back to `Math.random()`.
 * Callers that want a random game map should draw the seed themselves with the
 * game RNG and pass it in (see `randomSeed`).
 */
export function generateMap(seed: number): Grid {
  const s = seed >>> 0;
  const rng = mulberry32(s);
  const terrain = makeTerrain(rng);
  const { list, occ } = placeIndustries(terrain, rng);
  // TOWN-1: towns are placed AFTER industries (sequencing), using the same
  // seeded RNG so the map stays deterministic. Town tiles are stamped with
  // TOWN_OCC in the occupancy array so roads/other structures route around.
  const towns = placeTowns(terrain, occ, list, rng);
  // PP-13: highways between the towns, derived from the towns that were
  // actually placed. No RNG draws, so the seeded stream the rest of the map
  // depends on is untouched — and the highway is a pure function of the seed.
  const publicRoads = publicRoadTiles(towns, terrain, occ);
  // PP-02: guarantee every town can host a Factory. The only thing that could
  // wall a town off from a legal Factory site is ROUGH terrain around it,
  // so flatten the rough in a small ring around every town tile. A town tile
  // here means a house OR a PP-10 town road (both stamped TOWN_OCC), so the
  // ring covers the land just outside the town's ring road where a footprint
  // may actually stand. Occupied tiles are skipped: a factory footprint may
  // never overlap the town, so houses and roads keep their own ground.
  // Industries sit ≥8 tiles from any town tile (TOWN_INDUSTRY_SEP), so this
  // never touches an industry footprint, and determinism is preserved (the
  // map is still a pure function of `seed`).
  for (const t of towns) {
    for (const [hx, hy] of [...t.houses, ...t.roads]) {
      for (let dy = -TOWN_FACTORY_RING; dy <= TOWN_FACTORY_RING; dy++) {
        for (let dx = -TOWN_FACTORY_RING; dx <= TOWN_FACTORY_RING; dx++) {
          const x = hx + dx, y = hy + dy;
          if (!inBounds(x, y)) continue;
          const i = idx(x, y);
          if (occ[i] === -1 && terrain[i] === ROUGH) terrain[i] = GRASS;
        }
      }
    }
  }
  return {
    w: MAP_W, h: MAP_H, terrain, industries: list, towns, publicRoads, occupancy: occ, seed: s,
  };
}

/**
 * Generate a non-deterministic seed for a random game.
 *
 * Kept separate from `generateMap` so the fallback is explicit and testable
 * (R6: two no-arg map generations must be different), while the map generator
 * itself remains deterministic-by-value.
 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/** R6: parse `?seed=` or draw a random seed. Never call generateMap without this. */
export function resolveMapSeed(search = typeof location !== "undefined" ? location.search : ""): number {
  const rawSearch = search.startsWith("?") ? search.slice(1) : search;
  const q = new URLSearchParams(rawSearch);
  const raw = q.get("seed");
  if (raw != null && raw !== "") {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`Invalid map seed "${raw}".`);
    return n >>> 0;
  }
  return randomSeed();
}

// ── helpers ──
export const terrainAt = (g: Grid, tx: number, ty: number): number =>
  inBounds(tx, ty) ? g.terrain[idx(tx, ty)] : WATER;

export const industryAt = (g: Grid, tx: number, ty: number): Industry | null => {
  if (!inBounds(tx, ty)) return null;
  const id = g.occupancy[idx(tx, ty)];
  return id >= 0 ? g.industries[id] : null;
};

export const industryHasTile = (ind: Industry, tx: number, ty: number) =>
  tx >= ind.tx && tx < ind.tx + ind.w && ty >= ind.ty && ty < ind.ty + ind.h;

export const industryKey = (ind: Industry) => INDUSTRY_BY_KEY[ind.type];

// ── PP-02: Factory placement must be next to a town ────────────────────────
/**
 * True when (tx,ty) is a town tile — any tile stamped `TOWN_OCC`: a town
 * house, its centre, or a PP-10 town road (a town's roads belong to the town
 * exactly like its houses, and are stamped the same way in `occupancy`).
 */
export const isTownTile = (g: Grid, tx: number, ty: number): boolean =>
  inBounds(tx, ty) && g.occupancy[idx(tx, ty)] === TOWN_OCC;

/**
 * PP-02 — does a Factory footprint whose top-left tile is (tx,ty) touch a
 * town tile by an EDGE (share a side)? At least one footprint tile must be
 * orthogonally adjacent to a town tile. Diagonal-only contact does NOT qualify
 * (a footprint sitting kitty-corner to a town tile, touching it only at the
 * corner, is not "next to" the town). Town roads count exactly like town
 * houses — both are TOWN_OCC town tiles — which is what keeps every generated
 * town able to host a Factory after PP-10 ring roads surround its houses.
 */
export function factoryTouchesTown(grid: Grid, tx: number, ty: number): boolean {
  const [fw, fh] = FACTORY_FOOTPRINT;
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      const x = tx + dx, y = ty + dy;
      if (isTownTile(grid, x, y - 1) || isTownTile(grid, x, y + 1)
        || isTownTile(grid, x - 1, y) || isTownTile(grid, x + 1, y)) {
        return true;
      }
    }
  }
  return false;
}

export interface FactoryPlacement {
  /** True when a Factory may legally occupy the footprint from (tx,ty). */
  ok: boolean;
  /**
   * The human-readable reason placement is refused (the message the UI shows),
   * or null when `ok` is true. The whole footprint must be legal ground — in
   * bounds, no water, not overlapping a town or another building — AND at least
   * one footprint tile must share an edge with a town tile.
   */
  reason: string | null;
}

/**
 * PP-02 — the single source of truth for whether a Factory may be placed at
 * the Factory footprint whose top-left tile is (tx,ty). Both the human placement
 * (`placeFactory` in `game.ts`) and the AI's factory search use this, so the
 * AI cannot bypass town adjacency through a fallback placement.
 */
export function canPlaceFactory(grid: Grid, tx: number, ty: number): FactoryPlacement {
  const [fw, fh] = FACTORY_FOOTPRINT;
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      const x = tx + dx, y = ty + dy;
      if (!inBounds(x, y)) return { ok: false, reason: "Out of bounds." };
      const terr = grid.terrain[idx(x, y)];
      if (terr === WATER) return { ok: false, reason: "Can't build on water." };
      if (grid.occupancy[idx(x, y)] !== -1) {
        return {
          ok: false,
          reason: isTownTile(grid, x, y) ? "Can't build on the town." : "Tile is occupied.",
        };
      }
    }
  }
  if (!factoryTouchesTown(grid, tx, ty)) {
    return {
      ok: false,
      reason: "The Factory must be next to a town — at least one of its tiles must share an edge with a town tile.",
    };
  }
  return { ok: true, reason: null };
}
