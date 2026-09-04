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
  TOWN_COUNT, TOWN_RADIUS, TOWN_MIN_SEP, TOWN_EDGE_MARGIN,
  TOWN_HOUSES_MIN, TOWN_HOUSES_MAX, TOWN_NAMES,
} from "./config";

export const GRASS = 0;
export const WATER = 1;
export const ROUGH = 2;

/**
 * TK-005: a generated town — the anchor for TK-006's "first building must be
 * placed within radius of a town" rule and a visual landmark on the larger
 * map. Fully seed-derived: multiplayer ships only the seed (E10).
 */
export interface Town {
  id: number;
  name: string;
  tx: number;               // centre tile
  ty: number;
  radius: number;           // TK-006 placement radius (tiles, Chebyshev)
  houses: { tx: number; ty: number; v: 0 | 1 }[];   // decorative no-build tiles
}

/** occupancy sentinel for a town house tile (no-build, no industry). */
export const HOUSE = -2;

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

export interface Grid {
  w: number;
  h: number;
  terrain: Uint8Array;        // MAP_W*MAP_H values GRASS | WATER | ROUGH
  industries: Industry[];
  occupancy: Int16Array;      // per tile: industry index, HOUSE (-2), or -1
  towns: Town[];              // TK-005
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

function placeIndustries(
  terrain: Uint8Array, occ: Int16Array, rng: () => number,
): { list: Industry[] } {
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
        if (occ[ti] !== -1) return false;   // industry or town house
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
  return { list };
}

/**
 * TK-005: place TOWN_COUNT towns on inland grass, mutual separation ≥
 * TOWN_MIN_SEP (Chebyshev), each with TOWN_HOUSES_MIN..MAX decorative house
 * tiles on free grass inside its radius. Houses mark their tiles HOUSE (-2)
 * in `occ` so industries (placed next) and track (canBuildOn) avoid them.
 * Deterministic: same rng stream position → same towns.
 */
function placeTowns(terrain: Uint8Array, occ: Int16Array, rng: () => number): Town[] {
  const towns: Town[] = [];
  const namePool = [...TOWN_NAMES];
  // deterministic shuffle of the name pool (Fisher-Yates on the map rng)
  for (let i = namePool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [namePool[i], namePool[j]] = [namePool[j], namePool[i]];
  }
  const houseSprites = 2;   // atlas cells house_a / house_b
  const centreOk = (tx: number, ty: number) => {
    if (tx < TOWN_EDGE_MARGIN || ty < TOWN_EDGE_MARGIN) return false;
    if (tx >= MAP_W - TOWN_EDGE_MARGIN || ty >= MAP_H - TOWN_EDGE_MARGIN) return false;
    // the whole radius need not be land, but the centre 3×3 must be grass so
    // a town is never visually stranded in rough/water
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        if (terrain[idx(tx + x, ty + y)] !== GRASS) return false;
      }
    }
    return towns.every((t) =>
      Math.max(Math.abs(t.tx - tx), Math.abs(t.ty - ty)) >= TOWN_MIN_SEP);
  };
  for (let n = 0; n < TOWN_COUNT; n++) {
    let placed = false;
    for (let attempt = 0; attempt < 200 && !placed; attempt++) {
      const tx = TOWN_EDGE_MARGIN + Math.floor(rng() * (MAP_W - 2 * TOWN_EDGE_MARGIN));
      const ty = TOWN_EDGE_MARGIN + Math.floor(rng() * (MAP_H - 2 * TOWN_EDGE_MARGIN));
      if (!centreOk(tx, ty)) continue;
      const houses: Town["houses"] = [];
      const count = TOWN_HOUSES_MIN + Math.floor(rng() * (TOWN_HOUSES_MAX - TOWN_HOUSES_MIN + 1));
      for (let h = 0; h < count; h++) {
        for (let ha = 0; ha < 24; ha++) {
          const hx = tx + Math.floor(rng() * (2 * TOWN_RADIUS + 1)) - TOWN_RADIUS;
          const hy = ty + Math.floor(rng() * (2 * TOWN_RADIUS + 1)) - TOWN_RADIUS;
          if (!inBounds(hx, hy)) continue;
          const hi = idx(hx, hy);
          if (terrain[hi] !== GRASS || occ[hi] !== -1) continue;
          // keep the exact centre 3×3 clear (TK-006 guaranteed build space)
          if (Math.abs(hx - tx) <= 1 && Math.abs(hy - ty) <= 1) continue;
          occ[hi] = HOUSE;
          houses.push({ tx: hx, ty: hy, v: Math.floor(rng() * houseSprites) as 0 | 1 });
          break;
        }
      }
      towns.push({
        id: n, name: namePool[n % namePool.length],
        tx, ty, radius: TOWN_RADIUS, houses,
      });
      placed = true;
    }
    // Land is guaranteed larger than the town footprint needs; if all 200
    // attempts miss (pathological map), skip this town — the map stays valid,
    // TK-006 just has one fewer anchor.
  }
  return towns;
}

/**
 * Generate a deterministic 64×64 iso grid (TK-005; was 48×48). Same seed → byte-identical
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
  const occ = new Int16Array(MAP_W * MAP_H).fill(-1);
  const towns = placeTowns(terrain, occ, rng);
  const { list } = placeIndustries(terrain, occ, rng);
  return { w: MAP_W, h: MAP_H, terrain, industries: list, occupancy: occ, towns, seed: s };
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
