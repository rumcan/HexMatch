/**
 * HexMatch Industries – WebGL2 terrain renderer.
 *
 * Public contract (do not change; only optional additions):
 *   createTerrainRenderer(canvas, opts) → TerrainRenderer | null
 *   hash2, worldOfCorner, buildTerrainMesh (pure helpers for tests)
 *
 * Architecture in one paragraph: setMap builds ONE static mesh (a shared
 * vertex per lattice corner, two triangles per tile, heights applied) and
 * bakes the signed distance fields (shore, rough, river, sand) plus the
 * elevation/erosion field (slope, curvature, flow, thermal erosion) into two
 * small textures. Every frame is a single drawElements; the vertex shader
 * applies the game's camera and the fragment shader derives every blend,
 * material weight, beach, dither, depth and foam from the smooth fields + a
 * seeded noise atlas, sampling each ground material through a 3-layer texture
 * array (the A/B/C variants) with per-variant rotation and anti-repetition.
 */

import { TERRAIN_FS, TERRAIN_VS } from "./shaders";
import {
  buildErosionField,
  buildFields,
  buildTerrainMesh,
  buildVertexShade,
  hash2,
  updateFieldsRegion,
  writeIndexRows,
  writeShadeRows,
  writeVertexRows,
  type ErosionField,
  type TerrainFields,
  type TerrainMapInput,
} from "./mesh";
import { makeNoiseAtlas, makeProcedural, variantFromBase, type RawTexture, type TextureSlot } from "./procedural";

export const TERRAIN_GRASS = 0, TERRAIN_WATER = 1, TERRAIN_ROUGH = 2, TERRAIN_SAND = 3;

export type { TerrainMapInput, ErosionField } from "./mesh";
export { hash2, worldOfCorner, buildTerrainMesh, buildErosionField } from "./mesh";

export interface TerrainCamera {
  x: number; y: number;
  zoom: 0.5 | 1 | 2;
  vw: number; vh: number;
}

/**
 * Painted ground art. The material names are the A variants (layer 0); the
 * optional `*B` / `*C` entries are the second and third variants of the same
 * material (#451), loaded into layers 1 and 2 of that material's array
 * texture. A missing or failed variant falls back to a placeholder derived
 * from the base pixels (rotation + slight hue/value shift), so the slots work
 * before the art lands.
 */
export interface TerrainTextureUrls {
  grass?: string; meadow?: string; dirt?: string; rock?: string; sand?: string;
  grassB?: string; grassC?: string;
  meadowB?: string; meadowC?: string;
  dirtB?: string; dirtC?: string;
  rockB?: string; rockC?: string;
  sandB?: string; sandC?: string;
  detail?: string; waterNormal?: string;
}

export interface TerrainOptions {
  textures?: TerrainTextureUrls;
  quality?: "high" | "low";
  onReady?: () => void;
  /** OPTIONAL ADDITION: ground texture repeat length in tiles (default 5). */
  tilesPerRepeat?: number;
}

export interface TerrainRenderer {
  setMap(map: TerrainMapInput): void;
  invalidateTiles(tiles: ReadonlyArray<readonly [number, number]>): void;
  render(cam: TerrainCamera, timeMs: number): void;
  resize(vw: number, vh: number): void;
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

type TexSource = RawTexture | HTMLImageElement;

/** Materials that get three variants in a texture array. */
const MATERIALS = ["grass", "meadow", "dirt", "rock", "sand"] as const;
type MaterialSlot = (typeof MATERIALS)[number];
/** Slots that stay a single 2D texture. */
const SINGLE_SLOTS = ["detail", "waterNormal"] as const;
type SingleSlot = (typeof SINGLE_SLOTS)[number];

/** Variant B/C URL key of a material ("grass" → "grassB"). */
function variantUrlKey(m: MaterialSlot, v: 1 | 2): keyof TerrainTextureUrls {
  return (v === 1 ? `${m}B` : `${m}C`) as keyof TerrainTextureUrls;
}

interface GLState {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  posBuf: WebGLBuffer;
  tileBuf: WebGLBuffer;
  shadeBuf: WebGLBuffer;
  idxBuf: WebGLBuffer;
  fieldTex: WebGLTexture;
  codesTex: WebGLTexture;
  noiseTex: WebGLTexture;
  groundTex: WebGLTexture;
  matTex: Record<MaterialSlot, WebGLTexture>;
  slotTex: Record<SingleSlot, WebGLTexture>;
  u: Record<string, WebGLUniformLocation | null>;
  aniso: EXT_texture_filter_anisotropic | null;
}

/**
 * Texture unit assignment (fixed; bound once, rebound after uploads).
 * 11 of the 16 guaranteed fragment texture units: the five ground materials
 * are 3-layer ARRAYS (one unit each), which is what keeps the budget flat
 * while every material blends three variants.
 */
const UNIT_FIELD = 0, UNIT_CODES = 1, UNIT_NOISE = 2, UNIT_GROUND = 3;
const UNIT_MAT: Record<MaterialSlot, number> = { grass: 4, meadow: 5, dirt: 6, rock: 7, sand: 8 };
const UNIT_SINGLE: Record<SingleSlot, number> = { detail: 9, waterNormal: 10 };

/** Flat placeholder colours shown until a slot's real texture arrives. */
const PLACEHOLDER: Record<TextureSlot, [number, number, number]> = {
  grass: [53, 67, 18], meadow: [112, 104, 50], dirt: [104, 80, 52], rock: [116, 108, 98],
  sand: [205, 187, 149], detail: [128, 128, 128], waterNormal: [128, 128, 255],
};

const UNIFORMS = [
  "uCam", "uZoom", "uView", "uField", "uCodes", "uNoise", "uGround", "uGrassArr", "uMeadowArr",
  "uDirtArr", "uRockArr", "uSandArr", "uDetail", "uWaterN", "uMapSize", "uCornerSize", "uSeedOff",
  "uDetailAmt", "uWaterAnim", "uVariantAmt", "uTime", "uGrid", "uTilesPerRepeat", "uLumA",
] as const;

const MAT_UNIFORM: Record<MaterialSlot, string> = {
  grass: "uGrassArr", meadow: "uMeadowArr", dirt: "uDirtArr", rock: "uRockArr", sand: "uSandArr",
};
const SINGLE_UNIFORM: Record<SingleSlot, string> = { detail: "uDetail", waterNormal: "uWaterN" };

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("createShader failed");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? "";
    gl.deleteShader(sh);
    throw new Error("terrain shader compile failed: " + log);
  }
  return sh;
}

function must<T>(v: T | null, what: string): T {
  if (v === null) throw new Error(what + " failed");
  return v;
}

function meanLuminance(src: TexSource): number | null {
  if (src instanceof HTMLImageElement) {
    try {
      const c = document.createElement("canvas");
      c.width = 16; c.height = 16;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(src, 0, 0, 16, 16);
      const d = ctx.getImageData(0, 0, 16, 16).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      return s / (256 * 255);
    } catch {
      return null; // cross-origin without CORS: keep the placeholder mean
    }
  }
  const d = src.data;
  let s = 0, n = 0;
  for (let i = 0; i < d.length; i += 4 * 7) { s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; }
  return s / (n * 255);
}

/**
 * Pixels of an <img>, so a variant placeholder can be derived from a painted
 * texture. Null when the pixels are unreadable (cross-origin, no 2D context).
 */
function imageToRaw(img: HTMLImageElement, size: number): RawTexture | null {
  try {
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    const d = ctx.getImageData(0, 0, size, size).data;
    return { width: size, height: size, data: new Uint8Array(d.buffer.slice(0)) };
  } catch {
    return null;
  }
}

/** `?variants=1|2|3` pins the number of blended texture variants (FPS A/B). */
function readVariantOverride(): number | null {
  try {
    const v = new URLSearchParams(location.search).get("variants");
    if (v === null || v === "") return null;
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.max(1, Math.min(3, n)) : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Byte-exact compare for the height lattice (typed arrays have no memcmp). */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

class TerrainRendererImpl implements TerrainRenderer {
  private gl: WebGL2RenderingContext;
  private st: GLState | null = null;
  private lost = false;
  private disposed = false;

  private readonly quality: "high" | "low";
  private readonly tilesPerRepeat: number;
  /** Strength of the faint tile grid (0 = off). `?grid=0` turns it off. */
  gridStrength = (() => { try { const g = new URLSearchParams(location.search).get("grid"); return g === null ? 0.5 : Math.max(0, Math.min(1, Number(g) || 0)); } catch { return 0.5; } })();
  /** How many texture variants blend (1..3). `?variants=1|2|3` pins it. */
  private readonly variantOverride: number | null = readVariantOverride();
  private readonly noiseAtlas: RawTexture;

  // texture sources kept for context restore
  private readonly sources = new Map<string, TexSource>();
  private readonly lum: Record<TextureSlot, number>;
  private readonly procSize: number;
  private readonly matSize: Record<MaterialSlot, number> = { grass: 0, meadow: 0, dirt: 0, rock: 0, sand: 0 };
  private pending = 0;
  private readyFired = false;

  // last map + derived CPU-side data (kept for invalidateTiles / restore)
  private map: TerrainMapInput | null = null;
  private fields: TerrainFields | null = null;
  private ground: ErosionField | null = null;
  /** Height lattice the current `ground` was baked from (see refreshGround). */
  private bakedHeights: Uint8Array | null = null;
  private positions: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private uvTile: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private shade: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private indices: Uint32Array<ArrayBufferLike> = new Uint32Array(0);
  private seedOff: [number, number] = [0, 0];

  private vw = 0;
  private vh = 0;

  private readonly onLost = (e: Event): void => {
    e.preventDefault();
    this.lost = true;
    this.st = null;
  };
  private readonly onRestored = (): void => {
    if (this.disposed) return;
    try {
      this.initGL();
      this.lost = false;
      for (const m of MATERIALS) {
        const size = this.matSize[m];
        if (!size) continue;
        this.ensureMatAlloc(m, size);
        for (const v of [0, 1, 2] as const) {
          const src = this.sources.get(this.matKey(m, v));
          if (src) this.uploadMatLayer(m, src, v);
        }
      }
      for (const slot of SINGLE_SLOTS) {
        const src = this.sources.get(slot);
        if (src) this.uploadSlot(slot, src);
      }
      if (this.map) this.setMap(this.map);
    } catch (err) {
      console.error("[terrain-gl] context restore failed", err);
    }
  };

  constructor(private readonly canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, private readonly opts: TerrainOptions) {
    this.gl = gl;
    this.quality = opts.quality ?? "high";
    this.tilesPerRepeat = opts.tilesPerRepeat ?? 5;
    this.procSize = this.quality === "low" ? 256 : 512;
    this.lum = {
      grass: 0.22, meadow: 0.40, dirt: 0.32, rock: 0.42, sand: 0.74, detail: 0.5, waterNormal: 0.5,
    };
    // Seed-independent noise atlas: the map seed enters as a UV offset.
    this.noiseAtlas = makeNoiseAtlas(this.quality === "low" ? 128 : 256);
    this.initGL();
    canvas.addEventListener("webglcontextlost", this.onLost, false);
    canvas.addEventListener("webglcontextrestored", this.onRestored, false);
    this.startTextureLoads();
  }

  /* ---------------------------- GL setup ---------------------------- */

  private initGL(): void {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);

    const vs = compile(gl, gl.VERTEX_SHADER, TERRAIN_VS);
    const fs = compile(gl, gl.FRAGMENT_SHADER, TERRAIN_FS);
    const program = must(gl.createProgram(), "createProgram");
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, "aPos");
    gl.bindAttribLocation(program, 1, "aTile");
    gl.bindAttribLocation(program, 2, "aShade");
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error("terrain program link failed: " + (gl.getProgramInfoLog(program) ?? ""));
    }
    const u: Record<string, WebGLUniformLocation | null> = {};
    for (const name of UNIFORMS) u[name] = gl.getUniformLocation(program, name);

    const vao = must(gl.createVertexArray(), "createVertexArray");
    const posBuf = must(gl.createBuffer(), "createBuffer");
    const tileBuf = must(gl.createBuffer(), "createBuffer");
    const shadeBuf = must(gl.createBuffer(), "createBuffer");
    const idxBuf = must(gl.createBuffer(), "createBuffer");
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, tileBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, shadeBuf);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bindVertexArray(null);

    const aniso = gl.getExtension("EXT_texture_filter_anisotropic");

    const fieldTex = must(gl.createTexture(), "createTexture");
    const codesTex = must(gl.createTexture(), "createTexture");
    const noiseTex = must(gl.createTexture(), "createTexture");
    const groundTex = must(gl.createTexture(), "createTexture");
    const matTex = {} as Record<MaterialSlot, WebGLTexture>;
    for (const m of MATERIALS) matTex[m] = must(gl.createTexture(), "createTexture");
    const slotTex = {} as Record<SingleSlot, WebGLTexture>;
    for (const slot of SINGLE_SLOTS) slotTex[slot] = must(gl.createTexture(), "createTexture");

    this.st = { program, vao, posBuf, tileBuf, shadeBuf, idxBuf, fieldTex, codesTex, noiseTex, groundTex, matTex, slotTex, u, aniso };

    // Data textures: field + ground are LINEAR (smooth interpolation between
    // tile / corner centres is the whole point), codes is NEAREST (hard flags).
    this.setupDataTexture(fieldTex, true);
    this.setupDataTexture(groundTex, true);
    this.setupDataTexture(codesTex, false);

    // Noise atlas: repeat + mipmaps so it never shimmers when zoomed out.
    gl.bindTexture(gl.TEXTURE_2D, noiseTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.noiseAtlas.width, this.noiseAtlas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.noiseAtlas.data);
    this.setGroundSampling();

    // Ground materials start as 3-layer arrays of their flat placeholder
    // colour: every variant slot is defined (no black flash) until the real
    // texture arrives.
    for (const m of MATERIALS) this.ensureMatAlloc(m, this.procSize);

    // Placeholders for the single 2D slots until the real image / procedural arrives.
    for (const slot of SINGLE_SLOTS) {
      gl.bindTexture(gl.TEXTURE_2D, slotTex[slot]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([...PLACEHOLDER[slot], 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    }

    // Constant uniforms + sampler units.
    gl.useProgram(program);
    gl.uniform1i(u.uField, UNIT_FIELD);
    gl.uniform1i(u.uCodes, UNIT_CODES);
    gl.uniform1i(u.uNoise, UNIT_NOISE);
    gl.uniform1i(u.uGround, UNIT_GROUND);
    for (const m of MATERIALS) gl.uniform1i(u[MAT_UNIFORM[m]], UNIT_MAT[m]);
    for (const slot of SINGLE_SLOTS) gl.uniform1i(u[SINGLE_UNIFORM[slot]], UNIT_SINGLE[slot]);
    gl.uniform1f(u.uTilesPerRepeat, this.tilesPerRepeat);
    this.uploadLum();
    this.bindAllTextures();
  }

  private setupDataTexture(tex: WebGLTexture, linear: boolean): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** REPEAT + trilinear mipmaps + anisotropy on the currently bound texture. */
  private setGroundSampling(): void {
    const gl = this.gl;
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const st = this.st;
    if (st && st.aniso) {
      const max = gl.getParameter(st.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
      gl.texParameterf(gl.TEXTURE_2D, st.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(this.quality === "low" ? 4 : 8, max));
    }
  }

  /** Same, for a material's array texture (all three layers at once). */
  private setMatSampling(m: MaterialSlot): void {
    const st = this.st;
    if (!st) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, st.matTex[m]);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    if (st.aniso) {
      const max = gl.getParameter(st.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
      gl.texParameterf(gl.TEXTURE_2D_ARRAY, st.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(this.quality === "low" ? 4 : 8, max));
    }
  }

  private bindAllTextures(): void {
    const gl = this.gl, st = this.st;
    if (!st) return;
    gl.activeTexture(gl.TEXTURE0 + UNIT_FIELD); gl.bindTexture(gl.TEXTURE_2D, st.fieldTex);
    gl.activeTexture(gl.TEXTURE0 + UNIT_CODES); gl.bindTexture(gl.TEXTURE_2D, st.codesTex);
    gl.activeTexture(gl.TEXTURE0 + UNIT_NOISE); gl.bindTexture(gl.TEXTURE_2D, st.noiseTex);
    gl.activeTexture(gl.TEXTURE0 + UNIT_GROUND); gl.bindTexture(gl.TEXTURE_2D, st.groundTex);
    for (const m of MATERIALS) {
      gl.activeTexture(gl.TEXTURE0 + UNIT_MAT[m]);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, st.matTex[m]);
    }
    for (const slot of SINGLE_SLOTS) {
      gl.activeTexture(gl.TEXTURE0 + UNIT_SINGLE[slot]);
      gl.bindTexture(gl.TEXTURE_2D, st.slotTex[slot]);
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  private uploadLum(): void {
    const st = this.st;
    if (!st) return;
    this.gl.useProgram(st.program);
    this.gl.uniform4f(st.u.uLumA, this.lum.grass, this.lum.meadow, this.lum.dirt, this.lum.rock);
  }

  /* ----------------------------- textures --------------------------- */

  private matKey(m: MaterialSlot, v: 0 | 1 | 2): string {
    return v === 0 ? m : `${m}${v === 1 ? "B" : "C"}`;
  }

  /** (Re)allocate a material's 3-layer array and fill it with its placeholder colour. */
  private ensureMatAlloc(m: MaterialSlot, size: number): void {
    const st = this.st;
    if (!st || size <= 0) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, st.matTex[m]);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, size, size, 3, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const flat = new Uint8Array(size * size * 4);
    const [r, g, b] = PLACEHOLDER[m];
    for (let i = 0; i < flat.length; i += 4) { flat[i] = r; flat[i + 1] = g; flat[i + 2] = b; flat[i + 3] = 255; }
    for (let layer = 0; layer < 3; layer++) {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, flat);
    }
    this.matSize[m] = size;
    this.setMatSampling(m);
    this.bindAllTextures();
  }

  private startTextureLoads(): void {
    const urls = this.opts.textures ?? {};
    this.pending = MATERIALS.length * 3 + SINGLE_SLOTS.length;
    for (const m of MATERIALS) {
      const variantUrls: Array<string | undefined> = [urls[m], urls[variantUrlKey(m, 1)], urls[variantUrlKey(m, 2)]];
      void this.loadMaterial(m, variantUrls).catch((err) => console.warn(`[terrain-gl] material "${m}" failed`, err));
    }
    let delay = 0;
    for (const slot of SINGLE_SLOTS) {
      const url = urls[slot];
      if (url) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => { if (!this.disposed) { this.setSource(slot, img); this.slotDone(); } };
        img.onerror = () => {
          console.warn(`[terrain-gl] texture "${slot}" failed to load (${url}); using procedural fallback`);
          if (!this.disposed) { this.setSource(slot, makeProcedural(slot, this.procSize)); this.slotDone(); }
        };
        img.src = url;
      } else {
        // Procedural fallbacks are generated one per task so the first frames
        // (flat placeholder colours) can already be presented.
        delay += 1;
        setTimeout(() => {
          if (this.disposed) return;
          this.setSource(slot, makeProcedural(slot, this.procSize));
          this.slotDone();
        }, delay);
      }
    }
  }

  /**
   * Loads one ground material: the base (A) texture, then the B and C
   * variants — from their own files when the art provides them, otherwise a
   * placeholder derived from the base pixels.
   */
  private async loadMaterial(m: MaterialSlot, urls: Array<string | undefined>): Promise<void> {
    let img: HTMLImageElement | null = null;
    if (urls[0]) img = await this.loadImage(m, urls[0]);
    const square = !!img && img.naturalWidth > 0 && img.naturalWidth === img.naturalHeight;
    if (img && !square) {
      console.warn(`[terrain-gl] "${m}" is ${img.naturalWidth}×${img.naturalHeight}; expected a square texture — using the procedural fallback`);
      img = null;
    }
    if (this.disposed) return;

    // Variant A: the painted base, or a procedural fallback spread over the
    // first frames (generation blocks for a moment, so they are staggered).
    let size: number, base: RawTexture | null = null, baseSrc: TexSource;
    if (img) {
      size = img.naturalWidth;
      baseSrc = img;
    } else {
      await sleep(1 + MATERIALS.indexOf(m));
      if (this.disposed) return;
      size = this.procSize;
      base = makeProcedural(m, size);
      baseSrc = base;
    }
    this.ensureMatAlloc(m, size);
    this.setLum(m, baseSrc);
    this.sources.set(this.matKey(m, 0), baseSrc);
    this.uploadMatLayer(m, baseSrc, 0);
    this.slotDone();
    if (this.disposed) return;

    // Variants B and C: their own painted file, else a placeholder derived
    // from the base pixels (rotation + slight hue/value shift).
    const [imB, imC] = await Promise.all([
      urls[1] ? this.loadImage(this.matKey(m, 1), urls[1]) : Promise.resolve(null),
      urls[2] ? this.loadImage(this.matKey(m, 2), urls[2]) : Promise.resolve(null),
    ]);
    const imgs: Array<HTMLImageElement | null> = [imB, imC];
    for (const v of [1, 2] as const) {
      if (this.disposed) return;
      const im = imgs[v - 1];
      if (im && im.naturalWidth === size && im.naturalHeight === size) {
        this.sources.set(this.matKey(m, v), im);
        this.uploadMatLayer(m, im, v);
        this.slotDone();
        continue;
      }
      if (im) {
        console.warn(`[terrain-gl] "${this.matKey(m, v)}" is ${im.naturalWidth}×${im.naturalHeight}; expected ${size}² — using a derived placeholder`);
      }
      if (!base && img) base = imageToRaw(img, size);
      const derived = base && !this.disposed ? variantFromBase(base, v) : makeProcedural(m, size);
      this.sources.set(this.matKey(m, v), derived);
      this.uploadMatLayer(m, derived, v);
      this.slotDone();
    }
  }

  private loadImage(name: string, url: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => {
        console.warn(`[terrain-gl] texture "${name}" failed to load (${url}); using a placeholder`);
        resolve(null);
      };
      img.src = url;
    });
  }

  private slotDone(): void {
    this.pending--;
    if (this.pending <= 0 && !this.readyFired) {
      this.readyFired = true;
      this.opts.onReady?.();
    }
  }

  private setLum(slot: TextureSlot, src: TexSource): void {
    const l = meanLuminance(src);
    if (l !== null) { this.lum[slot] = l; this.uploadLum(); }
  }

  private setSource(slot: SingleSlot, src: TexSource): void {
    this.sources.set(slot, src);
    this.setLum(slot, src);
    if (!this.lost && this.st) this.uploadSlot(slot, src);
  }

  private uploadSlot(slot: SingleSlot, src: TexSource): void {
    const gl = this.gl, st = this.st;
    if (!st) return;
    gl.bindTexture(gl.TEXTURE_2D, st.slotTex[slot]);
    if (src instanceof HTMLImageElement) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, src.width, src.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.data);
    }
    this.setGroundSampling();
    this.bindAllTextures();
  }

  /** Upload one layer of a material's array (0 = A, 1 = B, 2 = C). */
  private uploadMatLayer(m: MaterialSlot, src: TexSource, layer: 0 | 1 | 2): void {
    const gl = this.gl, st = this.st;
    if (!st || this.lost) return;
    const w = src instanceof HTMLImageElement ? src.naturalWidth : src.width;
    const h = src instanceof HTMLImageElement ? src.naturalHeight : src.height;
    if (w !== this.matSize[m] || h !== this.matSize[m]) {
      console.warn(`[terrain-gl] "${this.matKey(m, layer)}" is ${w}×${h}; expected ${this.matSize[m]}² — skipped`);
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, st.matTex[m]);
    if (src instanceof HTMLImageElement) {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, src);
    } else {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, src.data);
    }
    this.setMatSampling(m);
    this.bindAllTextures();
  }

  /* ------------------------------ map ------------------------------- */

  setMap(map: TerrainMapInput): void {
    this.map = map;
    this.seedOff = [hash2(map.seed, 11, 7), hash2(map.seed, 23, 5)];
    const mesh = buildTerrainMesh(map);
    this.positions = mesh.positions;
    this.uvTile = mesh.uvTile;
    this.indices = mesh.indices;
    this.shade = buildVertexShade(map);
    this.fields = buildFields(map);
    this.ground = buildErosionField(map);
    this.bakedHeights = map.heights ? map.heights.slice() : null;
    if (this.lost || !this.st) return;
    const gl = this.gl, st = this.st;
    gl.useProgram(st.program);
    gl.uniform2f(st.u.uCornerSize, this.ground.w, this.ground.h);
    gl.bindBuffer(gl.ARRAY_BUFFER, st.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, st.tileBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.uvTile, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, st.shadeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.shade, gl.STATIC_DRAW);
    gl.bindVertexArray(st.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, st.idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    gl.bindTexture(gl.TEXTURE_2D, st.fieldTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, map.w, map.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.fields.rgba);
    gl.bindTexture(gl.TEXTURE_2D, st.codesTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, map.w, map.h, 0, gl.RED, gl.UNSIGNED_BYTE, this.fields.codes);
    gl.bindTexture(gl.TEXTURE_2D, st.groundTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.ground.w, this.ground.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.ground.rgba);
    this.bindAllTextures();
  }

  invalidateTiles(tiles: ReadonlyArray<readonly [number, number]>): void {
    const map = this.map, fields = this.fields;
    if (!map || !fields || tiles.length === 0) return;
    let x0 = map.w, y0 = map.h, x1 = -1, y1 = -1;
    for (const [tx, ty] of tiles) {
      if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;
      if (tx < x0) x0 = tx; if (tx > x1) x1 = tx;
      if (ty < y0) y0 = ty; if (ty > y1) y1 = ty;
    }
    if (x1 < 0) return;
    // A change touching most of the map is cheaper to rebuild wholesale.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > map.w * map.h * 0.4) { this.setMap(map); return; }

    // 1. Fields: recompute the affected window only.
    const r = updateFieldsRegion(map, fields, x0, y0, x1, y1);
    // 2. Geometry: vertex rows around the tiles (shade needs ±1 neighbour).
    const j0 = Math.max(0, y0 - 1), j1 = Math.min(map.h, y1 + 2);
    writeVertexRows(map, j0, j1, this.positions, this.uvTile);
    writeShadeRows(map, j0, j1, this.shade);
    writeIndexRows(map, y0, y1, this.indices);
    // 3. Elevation/erosion field: flow accumulation is a global property of
    //    the height lattice, so an ELEVATION edit re-bakes the whole field. A
    //    tile edit that leaves the heights alone (the road-drag hot path)
    //    skips the bake entirely.
    const groundChanged = this.refreshGround();
    if (this.lost || !this.st) return;

    const gl = this.gl, st = this.st;
    const w1 = map.w + 1;
    const v0 = j0 * w1, v1 = (j1 + 1) * w1;
    gl.bindBuffer(gl.ARRAY_BUFFER, st.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, v0 * 8, this.positions, v0 * 2, (v1 - v0) * 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, st.shadeBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, v0 * 4, this.shade, v0, v1 - v0);
    const i0 = y0 * map.w * 6, i1 = (y1 + 1) * map.w * 6;
    gl.bindVertexArray(st.vao);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, i0 * 4, this.indices, i0, i1 - i0);
    gl.bindVertexArray(null);

    // 4. Sub-rect texture upload straight from the full-size arrays.
    const rw = r.x1 - r.x0 + 1, rh = r.y1 - r.y0 + 1;
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, map.w);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, r.x0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, r.y0);
    gl.bindTexture(gl.TEXTURE_2D, st.fieldTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x0, r.y0, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, fields.rgba);
    gl.bindTexture(gl.TEXTURE_2D, st.codesTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x0, r.y0, rw, rh, gl.RED, gl.UNSIGNED_BYTE, fields.codes);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);

    // 5. Ground field: whole texture (the corner lattice is one array).
    if (groundChanged && this.ground) {
      gl.bindTexture(gl.TEXTURE_2D, st.groundTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.ground.w, this.ground.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.ground.rgba);
    }
    this.bindAllTextures();
  }

  /**
   * Re-bakes the elevation/erosion field only when the height lattice has
   * actually changed. Returns whether `this.ground` is new.
   */
  private refreshGround(): boolean {
    const map = this.map;
    if (!map) return false;
    const h = map.heights;
    if (this.ground && h && this.bakedHeights && this.bakedHeights.length === h.length && sameBytes(this.bakedHeights, h)) {
      return false;
    }
    if (this.ground && !h && this.bakedHeights === null) return false; // still a flat map
    this.ground = buildErosionField(map);
    this.bakedHeights = h ? h.slice() : null;
    return true;
  }

  /* ---------------------------- frame ------------------------------- */

  resize(vw: number, vh: number): void {
    this.vw = vw; this.vh = vh;
    if (this.canvas.width !== vw) this.canvas.width = vw;
    if (this.canvas.height !== vh) this.canvas.height = vh;
  }

  render(cam: TerrainCamera, timeMs: number): void {
    if (this.disposed || this.lost || !this.st) return;
    if (cam.vw !== this.vw || cam.vh !== this.vh) this.resize(cam.vw, cam.vh);
    const gl = this.gl, st = this.st;
    gl.viewport(0, 0, this.vw, this.vh);
    gl.clearColor(0.07, 0.275, 0.345, 1); // abyss colour beyond the map edge
    gl.clear(gl.COLOR_BUFFER_BIT);
    const map = this.map;
    if (!map) return;

    const zoom = cam.zoom;
    const low = this.quality === "low";
    const detailAmt = low ? 0 : zoom === 2 ? 1 : zoom === 1 ? 0.35 : 0;
    const waterAnim = low ? 0 : zoom === 2 ? 1 : zoom === 1 ? 0.5 : 0;
    // How many texture variants blend: the far zoom fetches two (the mip
    // chain already softens the repeats), the near zooms three. Low quality
    // (phones) keeps one. `?variants=N` pins it for an FPS A/B.
    const variantAmt = this.variantOverride ?? (low ? 1 : zoom === 0.5 ? 2 : 3);

    gl.useProgram(st.program);
    gl.uniform2f(st.u.uCam, cam.x, cam.y);
    gl.uniform1f(st.u.uZoom, zoom);
    gl.uniform2f(st.u.uView, this.vw, this.vh);
    gl.uniform2f(st.u.uMapSize, map.w, map.h);
    gl.uniform2f(st.u.uSeedOff, this.seedOff[0], this.seedOff[1]);
    gl.uniform1f(st.u.uDetailAmt, detailAmt);
    gl.uniform1f(st.u.uWaterAnim, waterAnim);
    gl.uniform1f(st.u.uVariantAmt, variantAmt);
    gl.uniform1f(st.u.uTime, (timeMs % 3_600_000) / 1000);
    gl.uniform1f(st.u.uGrid, this.gridStrength);
    gl.bindVertexArray(st.vao);
    gl.drawElements(gl.TRIANGLES, this.indices.length, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    const gl = this.gl, st = this.st;
    if (st && !this.lost) {
      gl.deleteProgram(st.program);
      gl.deleteVertexArray(st.vao);
      gl.deleteBuffer(st.posBuf); gl.deleteBuffer(st.tileBuf); gl.deleteBuffer(st.shadeBuf); gl.deleteBuffer(st.idxBuf);
      gl.deleteTexture(st.fieldTex); gl.deleteTexture(st.codesTex); gl.deleteTexture(st.noiseTex); gl.deleteTexture(st.groundTex);
      for (const m of MATERIALS) gl.deleteTexture(st.matTex[m]);
      for (const slot of SINGLE_SLOTS) gl.deleteTexture(st.slotTex[slot]);
    }
    this.st = null;
    this.sources.clear();
    this.map = null;
    this.fields = null;
    this.ground = null;
    // The context itself is left alive on purpose: a canvas can only ever
    // hold one context, and forcing a loss here would break any renderer the
    // game creates on the same canvas later (e.g. after a quality change).
  }
}

/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */

/**
 * Returns null when WebGL2 is unavailable or setup fails for any reason
 * (the game then keeps its 2D ground). Never throws.
 */
export function createTerrainRenderer(canvas: HTMLCanvasElement, opts: TerrainOptions = {}): TerrainRenderer | null {
  try {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) return null;
    return new TerrainRendererImpl(canvas, gl, opts);
  } catch (err) {
    console.warn("[terrain-gl] unavailable:", err);
    return null;
  }
}
