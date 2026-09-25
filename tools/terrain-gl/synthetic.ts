/**
 * Synthetic 144×144 test map for the terrain harness: an island with
 * beaches, inland lakes, a meandering river, rocky patches and hills.
 * Deterministic from the seed (uses hash2 from the renderer module).
 */
import {
  hash2,
  TERRAIN_GRASS,
  TERRAIN_ROUGH,
  TERRAIN_SAND,
  TERRAIN_WATER,
  type TerrainMapInput,
} from "../../src/iso/terrain-gl/index";

function vnoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  let fx = x - x0, fy = y - y0;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash2(seed, x0, y0), b = hash2(seed, x0 + 1, y0);
  const c = hash2(seed, x0, y0 + 1), d = hash2(seed, x0 + 1, y0 + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(seed: number, x: number, y: number, oct: number): number {
  let s = 0, a = 0.5, n = 0;
  for (let o = 0; o < oct; o++) {
    s += a * vnoise(seed + o * 131, x, y);
    n += a;
    x = x * 2.03 + 17.1;
    y = y * 2.01 + 9.7;
    a *= 0.5;
  }
  return s / n;
}

export interface SyntheticOptions {
  seed: number;
  w?: number;
  h?: number;
  elevation?: boolean;
}

/** Continuous "land value" used for coast, hills and the river descent. */
function landValue(seed: number, w: number, h: number, x: number, y: number): number {
  const nx = (x - w / 2) / (w / 2), ny = (y - h / 2) / (h / 2);
  const r = Math.hypot(nx, ny * 1.05);
  const n = fbm(seed, x / 26, y / 26, 4);
  return n * 0.95 + 0.42 - Math.pow(r, 1.9) * 1.0;
}

export function makeSyntheticMap(o: SyntheticOptions): TerrainMapInput {
  const w = o.w ?? 144, h = o.h ?? 144, seed = o.seed | 0;
  const terrain = new Uint8Array(w * h);
  const rivers = new Uint8Array(w * h);
  const val = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = landValue(seed, w, h, x + 0.5, y + 0.5);
      val[i] = v;
      let t = TERRAIN_WATER;
      if (v >= 0.5) t = TERRAIN_GRASS;
      else if (v >= 0.455) t = TERRAIN_SAND;
      if (t === TERRAIN_GRASS) {
        const lake = fbm(seed + 900, x / 14, y / 14, 3);
        if (lake > 0.70 && v > 0.66) t = TERRAIN_WATER;
        const rough = fbm(seed + 1700, x / 11, y / 11, 3);
        if (t === TERRAIN_GRASS && rough > 0.665 && v > 0.58) t = TERRAIN_ROUGH;
      }
      terrain[i] = t;
    }
  }

  // Beaches for the lakes too: ring lake tiles with sand where grass.
  const isWater = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && terrain[y * w + x] === TERRAIN_WATER;
  const sandRing = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (terrain[i] !== TERRAIN_GRASS && terrain[i] !== TERRAIN_ROUGH) continue;
      if (isWater(x - 1, y) || isWater(x + 1, y) || isWater(x, y - 1) || isWater(x, y + 1)) sandRing[i] = 1;
    }
  for (let i = 0; i < w * h; i++) if (sandRing[i]) terrain[i] = TERRAIN_SAND;

  // River: start at the highest inland value, descend toward the coast.
  let best = -1, bi = -1;
  for (let i = 0; i < w * h; i++) if (terrain[i] !== TERRAIN_WATER && val[i] > best) { best = val[i]; bi = i; }
  if (bi >= 0) {
    let cx = bi % w, cy = Math.floor(bi / w);
    const visited = new Set<number>();
    for (let step = 0; step < 600; step++) {
      const i = cy * w + cx;
      if (terrain[i] === TERRAIN_WATER && rivers[i] === 0) break; // reached sea / lake
      rivers[i] = 1;
      terrain[i] = TERRAIN_WATER;
      visited.add(i);
      // occasional second tile of width
      if (hash2(seed + 5, cx, cy) > 0.55) {
        const side = hash2(seed + 6, cx, cy) > 0.5 ? 1 : -1;
        const sx = cx + side, sy = cy;
        if (sx >= 0 && sx < w && terrain[sy * w + sx] !== TERRAIN_WATER) {
          rivers[sy * w + sx] = 1;
          terrain[sy * w + sx] = TERRAIN_WATER;
          visited.add(sy * w + sx);
        }
      }
      // choose the lowest neighbour (with a little wobble), never revisiting
      let nb = -1, nv = Infinity;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const j = y * w + x;
          if (visited.has(j)) continue;
          const away = Math.hypot(x - w / 2, y - h / 2) * -0.004; // gentle pull toward the coast
          const vv = val[j] + away + (hash2(seed + 9, x, y) - 0.5) * 0.06;
          if (vv < nv) { nv = vv; nb = j; }
        }
      if (nb < 0) break;
      cx = nb % w; cy = Math.floor(nb / w);
    }
  }

  let heights: Uint8Array | undefined;
  if (o.elevation !== false) {
    const w1 = w + 1;
    heights = new Uint8Array(w1 * (h + 1));
    for (let j = 0; j <= h; j++)
      for (let i = 0; i <= w; i++) {
        const v = landValue(seed, w, h, i, j) + (fbm(seed + 77, i / 9, j / 9, 2) - 0.5) * 0.12;
        heights[j * w1 + i] = Math.max(0, Math.min(4, Math.floor((v - 0.66) / 0.075)));
      }
    // water is never raised: any corner touching a water tile is level 0
    const wet = (tx: number, ty: number): boolean => isWater(tx, ty);
    for (let j = 0; j <= h; j++)
      for (let i = 0; i <= w; i++)
        if (wet(i, j) || wet(i - 1, j) || wet(i, j - 1) || wet(i - 1, j - 1)) heights[j * w1 + i] = 0;
    // limit steps to one level between neighbouring corners (gentle terraces)
    for (let pass = 0; pass < 6; pass++)
      for (let j = 0; j <= h; j++)
        for (let i = 0; i <= w; i++) {
          const c = j * w1 + i;
          let m = 9;
          if (i > 0) m = Math.min(m, heights[c - 1]);
          if (i < w) m = Math.min(m, heights[c + 1]);
          if (j > 0) m = Math.min(m, heights[c - w1]);
          if (j < h) m = Math.min(m, heights[c + w1]);
          if (heights[c] > m + 1) heights[c] = m + 1;
        }
  }

  return { w, h, terrain, rivers, heights, seed };
}
