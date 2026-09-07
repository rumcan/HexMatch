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
// style rejection sampling: minimum separation 6 tiles, no overlap, not on
// water, quota per industry type so no cargo is absent from the map.
// ══════════════════════════════════════════════════════════════════════════
import {
  MAP_W, MAP_H, mulberry32, INDUSTRIES, INDUSTRY_QUOTA, INDUSTRY_BY_KEY,
} from "./config";

export const GRASS = 0;
export const WATER = 1;
export const ROUGH = 2;

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
}

export interface Grid {
  w: number;
  h: number;
  terrain: Uint8Array;        // MAP_W*MAP_H values GRASS | WATER | ROUGH
  industries: Industry[];
  towns: Town[];              // TOWN-1: four towns per map
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
  // try to guarantee the quota: relax separation 6 → 4 → 2 → 1 (overlap-only)
  for (const sep of [6, 4, 2, 1]) {
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
/** TOWN-1: houses per town (min..max inclusive). */
const TOWN_HOUSES_MIN = 6;
const TOWN_HOUSES_MAX = 12;
/** TOWN-1: minimum Chebyshev distance between town centres and any industry tile. */
const TOWN_INDUSTRY_SEP = 6;
/** TOWN-1: minimum Chebyshev distance between two town centres. */
const TOWN_TOWN_SEP = 10;
/** TOWN-1: occupancy sentinel for town tiles (distinct from industry indices ≥ 0). */
export const TOWN_OCC = -2;

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

        // Reachability check: town tiles must not strand any industry.
        const blocked = new Set<number>();
        for (let i = 0; i < MAP_W * MAP_H; i++) {
          if (occ[i] !== -1) blocked.add(i);   // already-occupied industry tiles
        }
        for (const [hx, hy] of houses) blocked.add(idx(hx, hy));
        if (!allIndustriesReachable(blocked)) continue;

        // Commit: mark tiles with TOWN_OCC so later towns/industries avoid them.
        for (const [hx, hy] of houses) occ[idx(hx, hy)] = TOWN_OCC;
        towns.push({ id: towns.length, tx: cx, ty: cy, houses });
        placed = true;
      }
      if (placed) break;
    }
  }
  return towns;
}

/**
 * Generate a deterministic 48×48 iso grid. Same seed → byte-identical
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
  return { w: MAP_W, h: MAP_H, terrain, industries: list, towns, occupancy: occ, seed: s };
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
