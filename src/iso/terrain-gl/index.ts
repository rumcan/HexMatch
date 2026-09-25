/**
 * HexMatch Industries – WebGL2 terrain renderer.
 *
 * Public contract (do not change; only optional additions):
 *   createTerrainRenderer(canvas, opts) → TerrainRenderer | null
 *   hash2, worldOfCorner, buildTerrainMesh (pure helpers for tests)
 *
 * Architecture in one paragraph: setMap builds ONE static mesh (a shared
 * vertex per lattice corner, two triangles per tile, heights applied) and
 * bakes four signed distance fields (shore, rough, river, sand) into a small
 * RGBA8 texture. Every frame is a single drawElements; the vertex shader
 * applies the game's camera and the fragment shader derives every blend,
 * beach, dither, depth and foam from the smooth fields + a seeded noise
 * atlas, sampling the ground art through an anti-repetition function.
 */

import { TERRAIN_FS, TERRAIN_VS } from "./shaders";
import {
  buildFields,
  buildTerrainMesh,
  buildVertexShade,
  hash2,
  updateFieldsRegion,
  writeIndexRows,
  writeShadeRows,
  writeVertexRows,
  type TerrainFields,
  type TerrainMapInput,
} from "./mesh";
import { makeNoiseAtlas, makeProcedural, TEXTURE_SLOTS, type RawTexture, type TextureSlot } from "./procedural";

export const TERRAIN_GRASS = 0, TERRAIN_WATER = 1, TERRAIN_ROUGH = 2, TERRAIN_SAND = 3;

export type { TerrainMapInput } from "./mesh";
export { hash2, worldOfCorner, buildTerrainMesh } from "./mesh";

export interface TerrainCamera {
  x: number; y: number;
  zoom: 0.5 | 1 | 2;
  vw: number; vh: number;
}

export interface TerrainTextureUrls {
  grass?: string; meadow?: string; dirt?: string; rock?: string;
  sand?: string; detail?: string; waterNormal?: string;
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
  slotTex: Record<TextureSlot, WebGLTexture>;
  u: Record<string, WebGLUniformLocation | null>;
  aniso: EXT_texture_filter_anisotropic | null;
}

/** Texture unit assignment (fixed; bound once, rebound after uploads). */
const UNIT: Record<TextureSlot, number> = {
  grass: 3, meadow: 4, dirt: 5, rock: 6, sand: 7, detail: 8, waterNormal: 9,
};
const UNIT_FIELD = 0, UNIT_CODES = 1, UNIT_NOISE = 2;

/** Flat placeholder colours shown until a slot's real texture arrives. */
const PLACEHOLDER: Record<TextureSlot, [number, number, number]> = {
  grass: [53, 67, 18], meadow: [112, 104, 50], dirt: [104, 80, 52], rock: [116, 108, 98],
  sand: [205, 187, 149], detail: [128, 128, 128], waterNormal: [128, 128, 255],
};

const UNIFORMS = [
  "uCam", "uZoom", "uView", "uField", "uCodes", "uNoise", "uGrass", "uMeadow", "uDirt", "uRock",
  "uSand", "uDetail", "uWaterN", "uMapSize", "uSeedOff", "uDetailAmt", "uWaterAnim", "uTime",
  "uTilesPerRepeat", "uLumA",
] as const;

const SLOT_UNIFORM: Record<TextureSlot, string> = {
  grass: "uGrass", meadow: "uMeadow", dirt: "uDirt", rock: "uRock", sand: "uSand",
  detail: "uDetail", waterNormal: "uWaterN",
};

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

class TerrainRendererImpl implements TerrainRenderer {
  private gl: WebGL2RenderingContext;
  private st: GLState | null = null;
  private lost = false;
  private disposed = false;

  private readonly quality: "high" | "low";
  private readonly tilesPerRepeat: number;
  private readonly noiseAtlas: RawTexture;

  // texture sources kept for context restore
  private readonly sources = new Map<TextureSlot, TexSource>();
  private readonly lum: Record<TextureSlot, number>;
  private pending = 0;
  private readyFired = false;

  // last map + derived CPU-side data (kept for invalidateTiles / restore)
  private map: TerrainMapInput | null = null;
  private fields: TerrainFields | null = null;
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
      for (const slot of TEXTURE_SLOTS) {
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
    const slotTex = {} as Record<TextureSlot, WebGLTexture>;
    for (const slot of TEXTURE_SLOTS) slotTex[slot] = must(gl.createTexture(), "createTexture");

    this.st = { program, vao, posBuf, tileBuf, shadeBuf, idxBuf, fieldTex, codesTex, noiseTex, slotTex, u, aniso };

    // Data textures: field is LINEAR (smooth interpolation between tile
    // centres is the whole point), codes is NEAREST (hard flags).
    this.setupDataTexture(fieldTex, true);
    this.setupDataTexture(codesTex, false);

    // Noise atlas: repeat + mipmaps so it never shimmers when zoomed out.
    gl.bindTexture(gl.TEXTURE_2D, noiseTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.noiseAtlas.width, this.noiseAtlas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.noiseAtlas.data);
    this.setGroundSampling();

    // Placeholders for every slot until the real image / procedural arrives.
    for (const slot of TEXTURE_SLOTS) {
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
    for (const slot of TEXTURE_SLOTS) gl.uniform1i(u[SLOT_UNIFORM[slot]], UNIT[slot]);
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

  private bindAllTextures(): void {
    const gl = this.gl, st = this.st;
    if (!st) return;
    gl.activeTexture(gl.TEXTURE0 + UNIT_FIELD); gl.bindTexture(gl.TEXTURE_2D, st.fieldTex);
    gl.activeTexture(gl.TEXTURE0 + UNIT_CODES); gl.bindTexture(gl.TEXTURE_2D, st.codesTex);
    gl.activeTexture(gl.TEXTURE0 + UNIT_NOISE); gl.bindTexture(gl.TEXTURE_2D, st.noiseTex);
    for (const slot of TEXTURE_SLOTS) {
      gl.activeTexture(gl.TEXTURE0 + UNIT[slot]);
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

  /* --------------------------- textures ----------------------------- */

  private startTextureLoads(): void {
    const urls = this.opts.textures ?? {};
    const procSize = this.quality === "low" ? 256 : 512;
    this.pending = TEXTURE_SLOTS.length;
    let delay = 0;
    for (const slot of TEXTURE_SLOTS) {
      const url = urls[slot];
      if (url) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => { if (!this.disposed) { this.setSource(slot, img); this.slotDone(); } };
        img.onerror = () => {
          console.warn(`[terrain-gl] texture "${slot}" failed to load (${url}); using procedural fallback`);
          if (!this.disposed) { this.setSource(slot, makeProcedural(slot, procSize)); this.slotDone(); }
        };
        img.src = url;
      } else {
        // Procedural fallbacks are generated one per task so the first frames
        // (flat placeholder colours) can already be presented.
        delay += 1;
        setTimeout(() => {
          if (this.disposed) return;
          this.setSource(slot, makeProcedural(slot, procSize));
          this.slotDone();
        }, delay);
      }
    }
  }

  private slotDone(): void {
    this.pending--;
    if (this.pending === 0 && !this.readyFired) {
      this.readyFired = true;
      this.opts.onReady?.();
    }
  }

  private setSource(slot: TextureSlot, src: TexSource): void {
    this.sources.set(slot, src);
    const l = meanLuminance(src);
    if (l !== null) this.lum[slot] = l;
    if (!this.lost && this.st) {
      this.uploadSlot(slot, src);
      this.uploadLum();
    }
  }

  private uploadSlot(slot: TextureSlot, src: TexSource): void {
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

  /* ----------------------------- map -------------------------------- */

  setMap(map: TerrainMapInput): void {
    this.map = map;
    this.seedOff = [hash2(map.seed, 11, 7), hash2(map.seed, 23, 5)];
    const mesh = buildTerrainMesh(map);
    this.positions = mesh.positions;
    this.uvTile = mesh.uvTile;
    this.indices = mesh.indices;
    this.shade = buildVertexShade(map);
    this.fields = buildFields(map);
    if (this.lost || !this.st) return;
    const gl = this.gl, st = this.st;
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

    // 3. Sub-rect texture upload straight from the full-size arrays.
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
    this.bindAllTextures();
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

    gl.useProgram(st.program);
    gl.uniform2f(st.u.uCam, cam.x, cam.y);
    gl.uniform1f(st.u.uZoom, zoom);
    gl.uniform2f(st.u.uView, this.vw, this.vh);
    gl.uniform2f(st.u.uMapSize, map.w, map.h);
    gl.uniform2f(st.u.uSeedOff, this.seedOff[0], this.seedOff[1]);
    gl.uniform1f(st.u.uDetailAmt, detailAmt);
    gl.uniform1f(st.u.uWaterAnim, waterAnim);
    gl.uniform1f(st.u.uTime, (timeMs % 3_600_000) / 1000);
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
      gl.deleteTexture(st.fieldTex); gl.deleteTexture(st.codesTex); gl.deleteTexture(st.noiseTex);
      for (const slot of TEXTURE_SLOTS) gl.deleteTexture(st.slotTex[slot]);
    }
    this.st = null;
    this.sources.clear();
    this.map = null;
    this.fields = null;
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
