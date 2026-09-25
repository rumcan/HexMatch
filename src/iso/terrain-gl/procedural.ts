/**
 * Procedural fallback textures.
 *
 * All generators are pure (no DOM): they return raw RGBA8 pixel buffers built
 * from *periodic* value noise, so every texture is seamless by construction
 * and can be uploaded with REPEAT wrapping. They are only used for slots the
 * game does not provide a painted image for, and they run once at startup.
 *
 * Palette anchors (shipped art): grass #354312, sand #cdbb95, sea #1b5f72.
 */

export interface RawTexture {
  width: number;
  height: number;
  data: Uint8Array;
}

type RGB = [number, number, number];

/* ------------------------------------------------------------------ */
/* Periodic value noise                                                */
/* ------------------------------------------------------------------ */

function latticeHash(seed: number, x: number, y: number): number {
  let h = Math.imul(seed ^ 0x5bd1e995, 0x9e3779b1);
  h ^= Math.imul(x + 0x632be5ab, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f);
  h ^= Math.imul(y + 0x2545f491, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 13), 0x165667b1);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Value noise with an integer period (fx × fy lattice) → tileable. */
class PeriodicNoise {
  private readonly lat: Float32Array;
  constructor(private readonly fx: number, private readonly fy: number, seed: number) {
    this.lat = new Float32Array(fx * fy);
    for (let y = 0; y < fy; y++)
      for (let x = 0; x < fx; x++) this.lat[y * fx + x] = latticeHash(seed, x, y);
  }
  /** u,v in [0,1) texture space */
  at(u: number, v: number): number {
    const px = u * this.fx, py = v * this.fy;
    const x0 = Math.floor(px), y0 = Math.floor(py);
    let fx = px - x0, fy = py - y0;
    fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    fy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const xa = ((x0 % this.fx) + this.fx) % this.fx, xb = (xa + 1) % this.fx;
    const ya = ((y0 % this.fy) + this.fy) % this.fy, yb = (ya + 1) % this.fy;
    const l = this.lat;
    const a = l[ya * this.fx + xa], b = l[ya * this.fx + xb];
    const c = l[yb * this.fx + xa], d = l[yb * this.fx + xb];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
}

/**
 * Tileable fBm field of size×size samples, stretched to exactly [0,1].
 * fx/fy are the base periods; anisotropic periods give streaks (grass blades).
 */
export function fbmField(size: number, fx: number, fy: number, octaves: number, seed: number, gain = 0.5): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  for (let o = 0; o < octaves; o++) {
    const n = new PeriodicNoise(fx << o, fy << o, seed * 31 + o * 977);
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) out[y * size + x] += amp * n.at(x / size, v);
    }
    amp *= gain;
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < out.length; i++) { if (out[i] < lo) lo = out[i]; if (out[i] > hi) hi = out[i]; }
  const inv = hi > lo ? 1 / (hi - lo) : 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) * inv;
  return out;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
function mix3(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function put(data: Uint8Array, i: number, c: RGB, mul = 1): void {
  data[i] = Math.max(0, Math.min(255, Math.round(c[0] * mul)));
  data[i + 1] = Math.max(0, Math.min(255, Math.round(c[1] * mul)));
  data[i + 2] = Math.max(0, Math.min(255, Math.round(c[2] * mul)));
  data[i + 3] = 255;
}
function tex(size: number): RawTexture {
  return { width: size, height: size, data: new Uint8Array(size * size * 4) };
}

/* ------------------------------------------------------------------ */
/* Ground textures                                                     */
/* ------------------------------------------------------------------ */

/** Lush grass: dark olive base (#354312 mean), soft tonal patches, vertical blade streaks. */
export function makeGrass(size: number, seed: number): RawTexture {
  const t = tex(size);
  const patches = fbmField(size, 3, 3, 3, seed + 1);
  const blades = fbmField(size, 10, 96, 3, seed + 2, 0.6);
  const fleck = fbmField(size, 48, 48, 2, seed + 3);
  const dark: RGB = [42, 56, 14], light: RGB = [68, 84, 26], yellow: RGB = [86, 92, 34];
  for (let i = 0; i < size * size; i++) {
    let c = mix3(dark, light, patches[i]);
    c = mix3(c, yellow, smooth(0.7, 0.95, fleck[i]) * 0.5);
    const b = 0.82 + 0.36 * blades[i];
    put(t.data, i * 4, c, b);
  }
  return t;
}

/** Dry meadow: yellow-olive hay, sparser and warmer than grass, same streak direction. */
export function makeMeadow(size: number, seed: number): RawTexture {
  const t = tex(size);
  const patches = fbmField(size, 3, 3, 3, seed + 11);
  const blades = fbmField(size, 8, 80, 3, seed + 12, 0.6);
  const fleck = fbmField(size, 40, 40, 2, seed + 13);
  const olive: RGB = [98, 96, 44], straw: RGB = [136, 122, 62], ochre: RGB = [122, 100, 46];
  for (let i = 0; i < size * size; i++) {
    let c = mix3(olive, straw, patches[i]);
    c = mix3(c, ochre, smooth(0.65, 0.9, fleck[i]) * 0.6);
    put(t.data, i * 4, c, 0.86 + 0.28 * blades[i]);
  }
  return t;
}

/** Bare earth: warm brown, subtle clods and scattered pale pebbles with a shadow rim. */
export function makeDirt(size: number, seed: number): RawTexture {
  const t = tex(size);
  const clods = fbmField(size, 5, 5, 4, seed + 21);
  const pebbleN = fbmField(size, 40, 40, 2, seed + 22);
  const grain = fbmField(size, 96, 96, 1, seed + 23);
  const dark: RGB = [78, 58, 38], base: RGB = [104, 80, 52], pale: RGB = [150, 128, 96];
  for (let i = 0; i < size * size; i++) {
    let c = mix3(dark, base, clods[i]);
    const p = pebbleN[i];
    const pebble = smooth(0.66, 0.72, p);
    const rim = smooth(0.6, 0.66, p) * (1 - pebble);
    c = mix3(c, pale, pebble * 0.8);
    c = mix3(c, dark, rim * 0.5);
    put(t.data, i * 4, c, 0.9 + 0.2 * grain[i]);
  }
  return t;
}

/** Rock / scree: grey-brown plates split by dark ridged cracks, cool lichen flecks. */
export function makeRock(size: number, seed: number): RawTexture {
  const t = tex(size);
  const plates = fbmField(size, 4, 4, 3, seed + 31);
  const crackN = fbmField(size, 6, 6, 4, seed + 32, 0.55);
  const fine = fbmField(size, 64, 64, 2, seed + 33);
  const lichen = fbmField(size, 12, 12, 2, seed + 34);
  const dark: RGB = [70, 66, 62], base: RGB = [116, 108, 98], light: RGB = [150, 142, 130], moss: RGB = [96, 104, 70];
  for (let i = 0; i < size * size; i++) {
    let c = mix3(dark, light, plates[i]);
    c = mix3(c, base, 0.4);
    const ridged = 1 - Math.abs(2 * crackN[i] - 1);
    const crack = smooth(0.8, 0.97, ridged);
    c = mix3(c, [46, 42, 40], crack * 0.85);
    c = mix3(c, moss, smooth(0.72, 0.9, lichen[i]) * 0.45);
    put(t.data, i * 4, c, 0.92 + 0.16 * fine[i]);
  }
  return t;
}

/** Beach sand: #cdbb95 with soft wind ripples and fine grain. */
export function makeSand(size: number, seed: number): RawTexture {
  const t = tex(size);
  const warp = fbmField(size, 4, 4, 3, seed + 41);
  const tone = fbmField(size, 3, 3, 2, seed + 42);
  const grain = fbmField(size, 128, 128, 1, seed + 43);
  const base: RGB = [205, 187, 149], dark: RGB = [184, 164, 124], light: RGB = [222, 206, 170];
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size;
      // 9 ripple periods (integer → tileable), bent by low-frequency noise
      const ripple = Math.sin(2 * Math.PI * (v * 9 + u * 2 + warp[i] * 0.9));
      let c = mix3(dark, light, tone[i]);
      c = mix3(c, base, 0.5);
      const shade = 1 + ripple * 0.045 + (grain[i] - 0.5) * 0.08;
      put(t.data, i * 4, c, shade);
    }
  }
  return t;
}

/** Detail overlay: neutral 50% grey plus fine grain and faint blade streaks (2·base·detail ≈ base). */
export function makeDetail(size: number, seed: number): RawTexture {
  const t = tex(size);
  const grain = fbmField(size, 48, 48, 3, seed + 51, 0.6);
  const streak = fbmField(size, 12, 64, 2, seed + 52);
  const cracks = fbmField(size, 10, 10, 3, seed + 53);
  for (let i = 0; i < size * size; i++) {
    const ridged = 1 - Math.abs(2 * cracks[i] - 1);
    let v = 128 + (grain[i] - 0.5) * 64 + (streak[i] - 0.5) * 30 - smooth(0.9, 1, ridged) * 30;
    v = Math.max(0, Math.min(255, v));
    t.data[i * 4] = v; t.data[i * 4 + 1] = v; t.data[i * 4 + 2] = v; t.data[i * 4 + 3] = 255;
  }
  return t;
}

/** Tileable tangent-space normal map from an fBm heightfield (for water ripples). */
export function makeWaterNormal(size: number, seed: number): RawTexture {
  const t = tex(size);
  const hgt = fbmField(size, 5, 5, 4, seed + 61, 0.55);
  const amp = size * 0.02;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xl = hgt[y * size + ((x + size - 1) % size)], xr = hgt[y * size + ((x + 1) % size)];
      const yu = hgt[((y + size - 1) % size) * size + x], yd = hgt[((y + 1) % size) * size + x];
      const nx = -(xr - xl) * amp, ny = -(yd - yu) * amp;
      const l = Math.hypot(nx, ny, 1);
      t.data[i * 4] = Math.round((nx / l * 0.5 + 0.5) * 255);
      t.data[i * 4 + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
      t.data[i * 4 + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      t.data[i * 4 + 3] = 255;
    }
  }
  return t;
}

/* ------------------------------------------------------------------ */
/* Shader noise atlas                                                  */
/* ------------------------------------------------------------------ */

/**
 * The single noise texture the fragment shader reads (REPEAT, LINEAR).
 * It is seed-independent; the map seed enters as a UV offset, so building it
 * once at startup keeps setMap cheap and results deterministic.
 *
 *  R  low-frequency fBm  (land blend field 1, ~1 feature per 8 tiles when
 *     the texture spans 64 tiles) – also the anti-repetition index noise
 *  G  independent low-frequency fBm (land blend field 2)
 *  B  medium fBm (~2.5 tiles): the clumpy dither / edge-perturbation noise
 *  A  fine fBm (~0.5 tile): foam breakup and water tint sparkle
 */
export function makeNoiseAtlas(size: number): RawTexture {
  const t = tex(size);
  const r = fbmField(size, 8, 8, 4, 101);
  const g = fbmField(size, 8, 8, 4, 202);
  const b = fbmField(size, 24, 24, 3, 303, 0.55);
  const a = fbmField(size, 128, 128, 2, 404, 0.6);
  for (let i = 0; i < size * size; i++) {
    t.data[i * 4] = Math.round(r[i] * 255);
    t.data[i * 4 + 1] = Math.round(g[i] * 255);
    t.data[i * 4 + 2] = Math.round(b[i] * 255);
    t.data[i * 4 + 3] = Math.round(a[i] * 255);
  }
  return t;
}

export type TextureSlot = "grass" | "meadow" | "dirt" | "rock" | "sand" | "detail" | "waterNormal";

export const TEXTURE_SLOTS: readonly TextureSlot[] = ["grass", "meadow", "dirt", "rock", "sand", "detail", "waterNormal"];

/** Build the procedural fallback for one slot. */
export function makeProcedural(slot: TextureSlot, size: number, seed = 1957): RawTexture {
  switch (slot) {
    case "grass": return makeGrass(size, seed);
    case "meadow": return makeMeadow(size, seed);
    case "dirt": return makeDirt(size, seed);
    case "rock": return makeRock(size, seed);
    case "sand": return makeSand(size, seed);
    case "detail": return makeDetail(Math.min(size, 256), seed);
    case "waterNormal": return makeWaterNormal(Math.min(size, 256), seed);
  }
}
