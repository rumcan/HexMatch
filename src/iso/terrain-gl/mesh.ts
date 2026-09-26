/**
 * Pure (DOM-free, GL-free) geometry + field baking for the terrain renderer.
 *
 * Everything in here is deterministic and unit-testable in Node:
 *  - the isometric corner lattice → world px mapping (worldOfCorner)
 *  - the static tile mesh (buildTerrainMesh)
 *  - per-vertex slope lighting from the height lattice (buildVertexShade)
 *  - the signed distance fields (buildFields) that the fragment shader uses
 *    for every soft transition (beach, dither, depth, foam, rock edges).
 */

export const TERRAIN_GRASS = 0;
export const TERRAIN_WATER = 1;
export const TERRAIN_ROUGH = 2;
export const TERRAIN_SAND = 3;

/** Half tile width / height in world px (2:1 isometric, 64×32 diamond). */
export const HW = 32;
export const HH = 16;
/** Screen px a corner rises per elevation level. */
export const LEVEL_PX = 8;
/** Distance fields are clamped to ±FIELD_RANGE tiles and packed into 8 bits. */
export const FIELD_RANGE = 8;

export interface TerrainMapInput {
  w: number;
  h: number;
  terrain: Uint8Array;
  rivers?: Uint8Array;
  heights?: Uint8Array;
  seed: number;
}

export interface TerrainMesh {
  positions: Float32Array;
  uvTile: Float32Array;
  indices: Uint32Array;
}

/* ------------------------------------------------------------------ */
/* Hashing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Deterministic integer hash → [0,1). Same on every JS engine (only int32
 * arithmetic via Math.imul + unsigned shifts). Used to derive the shader's
 * seed offset and by the harness' synthetic map generator.
 */
export function hash2(seed: number, x: number, y: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1);
  h ^= Math.imul((x | 0) + 0x7f4a7c15, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f);
  h ^= Math.imul((y | 0) + 0x165667b1, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 13), 0x9e3779b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/* ------------------------------------------------------------------ */
/* Lattice → world                                                     */
/* ------------------------------------------------------------------ */

/** World px of corner lattice point (i, j) at elevation `level` (0..4). */
export function worldOfCorner(i: number, j: number, level = 0): [number, number] {
  return [(i - j) * HW, (i + j) * HH - level * LEVEL_PX];
}

function cornerLevel(map: TerrainMapInput, i: number, j: number): number {
  if (!map.heights) return 0;
  const w1 = map.w + 1;
  const ii = i < 0 ? 0 : i > map.w ? map.w : i;
  const jj = j < 0 ? 0 : j > map.h ? map.h : j;
  return map.heights[jj * w1 + ii];
}

/* ------------------------------------------------------------------ */
/* Mesh                                                                */
/* ------------------------------------------------------------------ */

/**
 * One shared vertex per lattice corner ((w+1)*(h+1) vertices), two triangles
 * per tile. Because heights live on the corners, sharing vertices gives a
 * watertight surface for free; slopes are simply tiles whose corners differ.
 *
 * Vertex index = j * (w+1) + i, so a range of lattice rows is a contiguous
 * slice of the buffers (that is what invalidateTiles relies on).
 */
export function buildTerrainMesh(map: TerrainMapInput): TerrainMesh {
  const { w, h } = map;
  const w1 = w + 1;
  const vcount = w1 * (h + 1);
  const positions = new Float32Array(vcount * 2);
  const uvTile = new Float32Array(vcount * 2);
  writeVertexRows(map, 0, h, positions, uvTile);

  const indices = new Uint32Array(w * h * 6);
  writeIndexRows(map, 0, h - 1, indices);
  return { positions, uvTile, indices };
}

/**
 * Fill the index buffer for tile rows ty0..ty1 inclusive (in place). Tile
 * (tx, ty) owns indices [ (ty*w+tx)*6, +6 ), so a row range is contiguous.
 */
export function writeIndexRows(map: TerrainMapInput, ty0: number, ty1: number, indices: Uint32Array): void {
  const { w } = map;
  const w1 = w + 1;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = 0; tx < w; tx++) {
      let o = (ty * w + tx) * 6;
      const top = ty * w1 + tx;
      const right = top + 1;
      const left = top + w1;
      const bottom = left + 1;
      // Pick the diagonal that keeps the tile closest to planar: when one
      // corner is raised, splitting along the "flat" diagonal avoids a fold
      // that would read as a crease in the slope shading.
      const dTB = Math.abs(cornerLevel(map, tx, ty) - cornerLevel(map, tx + 1, ty + 1));
      const dLR = Math.abs(cornerLevel(map, tx, ty + 1) - cornerLevel(map, tx + 1, ty));
      if (dTB <= dLR) {
        indices[o++] = top; indices[o++] = right; indices[o++] = bottom;
        indices[o++] = top; indices[o++] = bottom; indices[o++] = left;
      } else {
        indices[o++] = top; indices[o++] = right; indices[o++] = left;
        indices[o++] = right; indices[o++] = bottom; indices[o++] = left;
      }
    }
  }
}

/**
 * Fill positions/uvTile for lattice rows j0..j1 inclusive (in place).
 * Exposed so invalidateTiles can refresh just the rows around changed tiles.
 */
export function writeVertexRows(
  map: TerrainMapInput,
  j0: number,
  j1: number,
  positions: Float32Array,
  uvTile: Float32Array,
): void {
  const w1 = map.w + 1;
  for (let j = j0; j <= j1; j++) {
    for (let i = 0; i < w1; i++) {
      const v = j * w1 + i;
      const [x, y] = worldOfCorner(i, j, cornerLevel(map, i, j));
      positions[v * 2] = x;
      positions[v * 2 + 1] = y;
      uvTile[v * 2] = i;
      uvTile[v * 2 + 1] = j;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Slope lighting                                                      */
/* ------------------------------------------------------------------ */

const LIGHT = normalize3(-0.42, -0.5, 0.76); // toward the light: screen upper-left
/** Height gradient exaggeration: 8 px per level is geometrically shallow. */
const SLOPE_GAIN = 4.5;

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/**
 * Per-vertex lighting factor: 1.0 on flat ground (bit-exact, so a flat map is
 * indistinguishable from "no elevation"), >1 on slopes facing the upper-left
 * light, <1 on slopes facing away.
 *
 * The normal is built in *screen* space: we differentiate the corner height
 * (in px) with respect to world x / y through the isometric transform, so the
 * light direction can be expressed directly as a screen-space vector.
 */
export function buildVertexShade(map: TerrainMapInput): Float32Array {
  const out = new Float32Array((map.w + 1) * (map.h + 1));
  writeShadeRows(map, 0, map.h, out);
  return out;
}

export function writeShadeRows(map: TerrainMapInput, j0: number, j1: number, out: Float32Array): void {
  const w1 = map.w + 1;
  const flat = LIGHT[2];
  for (let j = j0; j <= j1; j++) {
    for (let i = 0; i < w1; i++) {
      const v = j * w1 + i;
      if (!map.heights) { out[v] = 1; continue; }
      // central differences in lattice space (px per lattice step)
      const dhi = (cornerLevel(map, i + 1, j) - cornerLevel(map, i - 1, j)) * LEVEL_PX * 0.5;
      const dhj = (cornerLevel(map, i, j + 1) - cornerLevel(map, i, j - 1)) * LEVEL_PX * 0.5;
      if (dhi === 0 && dhj === 0) { out[v] = 1; continue; }
      // chain rule through x=(i-j)*HW, y=(i+j)*HH
      const gx = ((dhi - dhj) / (2 * HW)) * SLOPE_GAIN;
      const gy = ((dhi + dhj) / (2 * HH)) * SLOPE_GAIN;
      const n = normalize3(-gx, -gy, 1);
      const d = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      out[v] = d / flat;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Distance fields                                                     */
/* ------------------------------------------------------------------ */

const INF = 1e9;

/**
 * 1-D squared Euclidean distance transform (Felzenszwalb & Huttenlocher).
 * Exact, O(n); used separably over rows then columns.
 */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dx = q - v[k];
    d[q] = dx * dx + f[v[k]];
  }
}

/**
 * Euclidean distance (in tiles, between tile centres) from every cell to the
 * nearest cell where `inside(cell)` is true. Cells that are themselves inside
 * get 0. If no cell is inside, every distance is a large number.
 */
export function distanceTo(w: number, h: number, inside: (idx: number) => boolean): Float32Array {
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = inside(i) ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  // columns
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  // rows
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = Math.sqrt(grid[i]);
  return out;
}

/**
 * Signed distance to the boundary of a tile set: negative inside, positive
 * outside, zero exactly on the shared edge between an inside tile and an
 * outside tile (so a LINEAR-filtered lookup crosses 0 at the tile edge).
 */
export function signedDistance(w: number, h: number, mask: Uint8Array): Float32Array {
  const dIn = distanceTo(w, h, (i) => mask[i] !== 0);
  const dOut = distanceTo(w, h, (i) => mask[i] === 0);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = mask[i] !== 0 ? -(dOut[i] - 0.5) : dIn[i] - 0.5;
  return out;
}

export interface TerrainFields {
  /** RGBA8, w*h*4: R = shore (any water), G = rough, B = river, A = sand. All signed, land/outside positive. */
  rgba: Uint8Array;
  /** R8, w*h: bits 0-1 terrain code, bit 7 river flag. */
  codes: Uint8Array;
  shore: Float32Array;
  rough: Float32Array;
  river: Float32Array;
  sand: Float32Array;
}

export function encodeField(d: number): number {
  const c = d < -FIELD_RANGE ? -FIELD_RANGE : d > FIELD_RANGE ? FIELD_RANGE : d;
  return Math.round((c / (2 * FIELD_RANGE) + 0.5) * 255);
}

export function isWaterTile(map: TerrainMapInput, idx: number): boolean {
  return map.terrain[idx] === TERRAIN_WATER || (map.rivers !== undefined && map.rivers[idx] !== 0);
}

/**
 * Bakes the four signed distance fields the shader needs. 144² is ~20k cells;
 * eight separable EDTs take a couple of milliseconds.
 */
export function buildFields(map: TerrainMapInput): TerrainFields {
  const { w, h } = map;
  const n = w * h;
  const water = new Uint8Array(n);
  const river = new Uint8Array(n);
  const rough = new Uint8Array(n);
  const sand = new Uint8Array(n);
  const codes = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const isRiver = map.rivers !== undefined && map.rivers[i] !== 0;
    const isWater = isWaterTile(map, i);
    water[i] = isWater ? 1 : 0;
    river[i] = isRiver ? 1 : 0;
    rough[i] = map.terrain[i] === TERRAIN_ROUGH ? 1 : 0;
    sand[i] = map.terrain[i] === TERRAIN_SAND ? 1 : 0;
    codes[i] = (map.terrain[i] & 3) | (isRiver ? 0x80 : 0);
  }
  const shoreF = signedDistance(w, h, water);
  const roughF = signedDistance(w, h, rough);
  const riverF = signedDistance(w, h, river);
  const sandF = signedDistance(w, h, sand);
  const rgba = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    rgba[i * 4] = encodeField(shoreF[i]);
    rgba[i * 4 + 1] = encodeField(roughF[i]);
    rgba[i * 4 + 2] = encodeField(riverF[i]);
    rgba[i * 4 + 3] = encodeField(sandF[i]);
  }
  return { rgba, codes, shore: shoreF, rough: roughF, river: riverF, sand: sandF };
}

/**
 * Recompute the fields for a rectangular window of tiles only. Distances are
 * clamped to FIELD_RANGE, so a cell's value depends solely on tiles within
 * that radius: we run the transform on the window padded by FIELD_RANGE+1 and
 * copy back only the window. Returns the window that was written.
 */
export function updateFieldsRegion(
  map: TerrainMapInput,
  fields: TerrainFields,
  x0: number, y0: number, x1: number, y1: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const pad = FIELD_RANGE + 1;
  // window whose values may have changed
  const wx0 = Math.max(0, x0 - pad), wy0 = Math.max(0, y0 - pad);
  const wx1 = Math.min(map.w - 1, x1 + pad), wy1 = Math.min(map.h - 1, y1 + pad);
  // source window that influences the values above
  const sx0 = Math.max(0, wx0 - pad), sy0 = Math.max(0, wy0 - pad);
  const sx1 = Math.min(map.w - 1, wx1 + pad), sy1 = Math.min(map.h - 1, wy1 + pad);
  const sw = sx1 - sx0 + 1, sh = sy1 - sy0 + 1;

  const sub = (pred: (idx: number) => boolean): Uint8Array => {
    const m = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) m[y * sw + x] = pred((sy0 + y) * map.w + sx0 + x) ? 1 : 0;
    return m;
  };
  const waterM = sub((i) => isWaterTile(map, i));
  const riverM = sub((i) => map.rivers !== undefined && map.rivers[i] !== 0);
  const roughM = sub((i) => map.terrain[i] === TERRAIN_ROUGH);
  const sandM = sub((i) => map.terrain[i] === TERRAIN_SAND);
  const shoreF = signedDistance(sw, sh, waterM);
  const roughF = signedDistance(sw, sh, roughM);
  const riverF = signedDistance(sw, sh, riverM);
  const sandF = signedDistance(sw, sh, sandM);

  for (let y = wy0; y <= wy1; y++) {
    for (let x = wx0; x <= wx1; x++) {
      const gi = y * map.w + x;
      const li = (y - sy0) * sw + (x - sx0);
      fields.shore[gi] = shoreF[li];
      fields.rough[gi] = roughF[li];
      fields.river[gi] = riverF[li];
      fields.sand[gi] = sandF[li];
      fields.rgba[gi * 4] = encodeField(shoreF[li]);
      fields.rgba[gi * 4 + 1] = encodeField(roughF[li]);
      fields.rgba[gi * 4 + 2] = encodeField(riverF[li]);
      fields.rgba[gi * 4 + 3] = encodeField(sandF[li]);
      const isRiver = map.rivers !== undefined && map.rivers[gi] !== 0;
      fields.codes[gi] = (map.terrain[gi] & 3) | (isRiver ? 0x80 : 0);
    }
  }
  return { x0: wx0, y0: wy0, x1: wx1, y1: wy1 };
}
