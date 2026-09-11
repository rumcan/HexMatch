// ══════════════════════════════════════════════════════════════════════════
// E4 — Isometric renderer core (W-series pattern-painted ground).
//
// Three stacked canvases:
//   1. terrain     — the pattern-painted GROUND: an animated ocean over the
//                    whole stage, the grass island and its beach ring cached
//                    in 8×8-tile chunks, and the animated shoreline (shallow
//                    swell + foam) stroked live. Redrawn every frame — the
//                    ocean drifts — but the expensive part is cached.
//   2. structures  — industries, road, rail, stations; redrawn on world change
//   3. overlay     — previews, highlights, animated frames, cursor; 60fps
//
// Ground chunks are cached per zoom exactly like the old sprite tiles; a
// chunk is invalidated per changed tile and all chunks are dropped on a zoom
// change. Land diamonds are filled with seamless world-anchored canvas
// patterns (assets/ground/*.png — tools/make-ground-textures.mjs); the ocean
// pattern additionally drifts with time. Without textures (tests, demo
// fallback) the same polygons paint with flat FALLBACK colours.
//
// The old per-tile terrain sprites (terrain_grass/water/rough) are gone from
// the draw path — `terrainSprite` survives only for debug probes. Roads and
// buildings blit from the LAYER atlases (assets/layers/), same rects.
//
// Every draw coordinate goes through Math.floor, and nothing is ever scaled
// inside drawImage — the atlases ship pre-rendered at 0.5×/1×/2×.
// ══════════════════════════════════════════════════════════════════════════
import { HW, HH, TILE_W, TILE_H, MAP_W, MAP_H } from "../game/config";
import type { Camera } from "./camera";
import { visibleTileRange, screenToWorld, worldToScreen } from "./camera";
import type { Atlas } from "./atlas";
import { depthSort, place, pickSprite, type DrawItem, type Placed } from "./depth";
import { GRASS, WATER, ROUGH, type Grid } from "./grid";
import {
  FALLBACK, FOAM_RGB, GROUND_TEX_SIZE, SHALLOW_RGB, computeShore,
  createGroundPatterns, foamAlpha, foamWidth, makeMatrix, oceanMatrix,
  paintGroundTiles, pathPolygons, shallowAlpha, tileDiamondWorld,
  type GroundPatterns, type GroundTextures, type ShoreTile,
} from "./ground";

/**
 * Ground texture scale relative to world pixels: one texture pixel covers
 * this many world pixels. Tuned to 10% of the W-series default (was 2 /
 * 1.6) — the painted brush clumps are fine grain now, roughly one texture
 * repeat per 1.6 tiles, instead of tile-sized. Drop to 0.1 / 0.08 for 5%.
 */
const LAND_SCALE = 0.2;
/** The ocean reads a little denser than the land (same 10% tune). */
const SEA_SCALE = 0.16;

export const CHUNK = 8;
export const chunksX = Math.ceil(MAP_W / CHUNK);
export const chunksY = Math.ceil(MAP_H / CHUNK);
export const chunkIndexOf = (tx: number, ty: number) =>
  ((ty / CHUNK) | 0) * chunksX + ((tx / CHUNK) | 0);

/**
 * G8: chunk canvas size. An 8×8 of diamonds spans 16*HW × 16*HH, but sprites
 * are drawn at `+HW` in x (anchor) so the rightmost column used to clip 32px
 * off every eastern chunk edge — dark wedges at 8-tile intervals against the
 * `#0b1a26` stage background. Pad by a full tile on both axes.
 */
export function chunkSurfaceSize(z: number): { w: number; h: number } {
  return {
    w: Math.ceil((2 * CHUNK * HW + TILE_W) * z),
    h: Math.ceil((2 * CHUNK * HH + TILE_H * 2) * z),
  };
}

/** World-space top-left of a chunk's cache surface. */
export function chunkWorldOrigin(cx: number, cy: number): [number, number] {
  const x0 = cx * CHUNK, y0 = cy * CHUNK;
  const ox = (x0 - (y0 + CHUNK - 1)) * HW - HW;
  const oy = (x0 + y0) * HH;
  return [ox, oy];
}

/**
 * Terrain sprite for a tile. W-series: no longer on the draw path (the
 * pattern-painted ground replaces the per-tile puzzle), but the debug console
 * and its probes still name the tile's terrain class through the old sprite
 * names, and the manifest still ships the cells.
 */
export function terrainSprite(grid: Grid, tx: number, ty: number): string {
  const v = grid.terrain[ty * MAP_W + tx];
  if (v === WATER) return "terrain_water";
  if (v === ROUGH) return "terrain_rough";
  return "terrain_grass";
}

/** Structures currently on the map, as a draw list (pre-cull). */
export interface World {
  grid: Grid;
  roadBits?: Uint8Array;   // E5 — the premium paved layer (drawn with road_XXXX tar)
  dirtBits?: Uint8Array;   // E5 — the basic gravel layer (drawn with dirt_XXXX)
  extra?: DrawItem[];      // stations, previews owned by the caller
  /**
   * RV-01: moving sprites (trucks), refreshed by the game every frame.
   * Depth-sorted WITH the structures so buildings properly occlude a truck
   * passing behind them; culling keeps them while they are near the view.
   */
  vehicles?: DrawItem[];
}

// Track layers carry a PRESENT bit (0b10000) above the 4 direction bits, so a
// lone stub with no connections (mask 0000) is still drawn. Any non-zero byte
// means "there is track here"; the low nibble names the sprite.
const bitName = (prefix: string, cell: number) =>
  `${prefix}_${(cell & 0b1111).toString(2).padStart(4, "0")}`;

// The `dirt_road_<eNE><eSE><eSW><eNW>` transition sprites index their four
// edge-state chars by DIRECTION (NE first) — NOT by the bit-position order a
// `dirt_<mask>` name uses — so the renderer walks the edges in this exact
// order. Each entry: [direction bit, dx, dy].
const TRANSITION_EDGES: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, -1],   // NE
  [2, 1, 0],    // SE
  [4, 0, 1],    // SW
  [8, -1, 0],   // NW
];

/**
 * The sprite drawn for one tile of the DIRT layer.
 *
 * Gravel and tar are ONE continuous road surface, so a dirt tile whose mask
 * reaches a neighbour is drawn as plain `dirt_<mask>` only when every reach
 * is gravel. The moment one of its edges meets a PAVED tile, the tile shows
 * the seam: `dirt_road_<state>`, one of the 65 transition cells, with an
 * edge-state char per direction (0 none / 1 gravel / 2 paved) — the tar on
 * the transition bleeds out to exactly match the neighbouring paved tile.
 *
 * The tier test is purely physical (does the neighbouring byte carry a road
 * PRESENT bit?) because the renderer is a shared view of the map's road
 * surface — it has no owner layer. W2 (never drive a rival's private track)
 * is enforced by the owner-scoped floods and routes, not by the art; a rival
 * tile drawn with a seam is the physical join, exactly as two rival tiles of
 * the SAME tier already drew arms at each other before this feature.
 */
export function dirtSpriteName(world: World, tx: number, ty: number, cell: number): string {
  const mask = cell & 0b1111;
  if (!mask) return bitName("dirt", cell);       // lone stub — no edge to classify
  let state = "";
  let paved = false;
  for (const [bit, dx, dy] of TRANSITION_EDGES) {
    if (!(mask & bit)) { state += "0"; continue; }
    const nx = tx + dx, ny = ty + dy;
    if (nx >= 0 && nx < MAP_W && ny >= 0 && ny < MAP_H) {
      const n = ny * MAP_W + nx;
      if (((world.roadBits?.[n] ?? 0) & 0b10000) !== 0) { state += "2"; paved = true; continue; }
    }
    state += "1";
  }
  return paved ? `dirt_road_${state}` : bitName("dirt", cell);
}

/** Build the structure draw list for a culled tile range. */
export function buildDrawList(world: World, r: { x0: number; y0: number; x1: number; y1: number }): DrawItem[] {
  const out: DrawItem[] = [];
  const { grid } = world;
  // Both road tiers are flush to the ground and 1×1 — they sort naturally.
  // A tile carries at most ONE tier (paving replaces dirt), so nothing here
  // needs a crossing overlay — the old road+rail "crossing" is gone. A dirt
  // tile that meets pavement draws the dirt_road_* seam sprite instead of a
  // plain dirt_* stub (see dirtSpriteName); a paved tile is always plain
  // road_XXXX.
  for (let ty = r.y0; ty <= r.y1; ty++) {
    for (let tx = r.x0; tx <= r.x1; tx++) {
      const i = ty * MAP_W + tx;
      const rb = world.roadBits?.[i] ?? 0;    // premium paved → road_XXXX (tar)
      const db = world.dirtBits?.[i] ?? 0;    // basic gravel   → dirt_XXXX / dirt_road_*
      if (db) out.push({ sprite: dirtSpriteName(world, tx, ty, db), tx, ty });
      if (rb) out.push({ sprite: bitName("road", rb), tx, ty });
    }
  }
  // PP-12: each industry is ONE verbatim TTD building sprite, drawn as a single
  // item at the footprint origin — `ind.type` names the atlas cell directly
  // (`farm`, `forest`, …). The manifest footprint equals the industry
  // footprint (both derive from the art via `footprintForArt`), so the
  // anchor lands on the footprint's south corner and depth sorting treats
  // the whole complex as one multi-tile building.
  for (const ind of grid.industries) {
    if (ind.tx + ind.w - 1 < r.x0 || ind.tx > r.x1) continue;
    if (ind.ty + ind.h - 1 < r.y0 || ind.ty > r.y1) continue;
    out.push({ sprite: ind.type, tx: ind.tx, ty: ind.ty, ref: ind });
  }
  if (world.extra) {
    for (const e of world.extra) {
      if (e.tx < r.x0 - 4 || e.tx > r.x1 + 4 || e.ty < r.y0 - 4 || e.ty > r.y1 + 4) continue;
      out.push(e);
    }
  }
  // RV-01: trucks drive BETWEEN tiles, so the cull test uses the rounded
  // tile with the same generous pad the extras get.
  if (world.vehicles) {
    for (const v of world.vehicles) {
      if (v.tx < r.x0 - 4 || v.tx > r.x1 + 4 || v.ty < r.y0 - 4 || v.ty > r.y1 + 4) continue;
      out.push(v);
    }
  }
  return out;
}

/** Culling pad: largest footprint plus the tallest sprite expressed in tiles. */
export function cullPad(atlas: Atlas): number {
  let maxFoot = 1, maxH = TILE_H;
  for (const s of Object.values(atlas.manifest.sprites)) {
    maxFoot = Math.max(maxFoot, s.footprint[0], s.footprint[1]);
    maxH = Math.max(maxH, s.h);
  }
  return maxFoot + Math.ceil(maxH / HH);
}

type Ctx2D = CanvasRenderingContext2D;

export interface RendererCanvases {
  terrain: HTMLCanvasElement;
  structures: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
}

/**
 * Structured render trace. Gate with `renderer.setRenderLog(true)` (the debug
 * console exposes `__iso.renderLog(true)` and auto-enables it with
 * `?render-log=1`). Two consumers:
 *   1. live console debugging — `console.debug("[render] …")` per blit/chunk
 *      so a running game can be traced to the exact source/dest rect the
 *      renderer used;
 *   2. a `renderer.renderDiagnostics()` snapshot returned by `__iso.rendering()`
 *      so a screenshot can be matched to state without reading the renderer.
 */
export interface RenderDiagnostics {
  camera: { zoom: number; vw: number; vh: number; x: number; y: number };
  cull: { pad: number; x0: number; y0: number; x1: number; y1: number };
  chunkCacheEntries: number;
  groundAnchorReference: number | null;
  depthCycles: string[][];
  structures: {
    sprite: string;
    tx: number;
    ty: number;
    footprint: [number, number];
    anchor: [number, number];
    box: [number, number];
    world: [number, number];
    screen: [number, number];
    depthKey: number;
  }[];
  sourceRect: { sprite: string; frames: number; raw: [number, number, number, number]; packed: [number, number, number, number] }[];
  warnings: string[];
}

export class IsoRenderer {
  readonly atlas: Atlas;
  cam: Camera;
  world: World;

  /**
   * C5: an optional hook the OVERLAY layer calls after its own items are
   * blitted, with the raw 2D context and the live camera. It is how the debug
   * console draws anchor/network/pick marks on the map so a screenshot carries
   * the state behind it (`installIsoDebug` in `debug.ts`). Left null in
   * production — nothing else ever writes to the overlay context.
   */
  debugPainter: ((ctx: CanvasRenderingContext2D, cam: Camera) => void) | null = null;

  /**
   * Game-owned overlay pass, drawn LAST — above every preview glow and debug
   * mark. This is where the protest crowds live (`paintProtests` in game.ts):
   * a crowd standing on the road must never hide under a highlight. Null in
   * tests and the demo, which stage no protests.
   */
  overlayPainter: ((ctx: CanvasRenderingContext2D, cam: Camera, timeMs: number) => void) | null = null;

  readonly canvases: RendererCanvases;
  private ctxT: Ctx2D; private ctxS: Ctx2D; private ctxO: Ctx2D;
  private structuresDirty = true;
  private lastOrder: Placed[] = [];
  private lastCycles: string[][] = [];
  private pad: number;
  private logRender = false;

  // ── W-series pattern-painted ground ──────────────────────────────────────
  /** Canvas patterns for grass/sand/water; null → flat FALLBACK colours. */
  private ground: GroundPatterns | null = null;
  /** Shoreline tiles (water touching land) for the animated surf pass. */
  private shore: ShoreTile[] | null = null;
  private shoreGrid: Grid | null = null;
  /**
   * Chunk surfaces for the STATIC ground (grass fill + beach ring, water left
   * transparent so the animated ocean shows through). Cached per zoom like
   * the old sprite chunks; repainted when a tile is invalidated.
   */
  private groundChunkCache = new Map<string, HTMLCanvasElement | OffscreenCanvas>();

  /** The last depth-sorted structure order actually drawn (C5 dumps/picking). */
  get drawOrder(): Placed[] { return this.lastOrder; }

  /**
   * Turn on/off the `[render]` console.debug trace. Off by default so a normal
   * dev build is not flooded; the debug console exposes `logRender(true)` and
   * `?render-log=1` auto-enables it at boot.
   */
  setRenderLog(on: boolean): void { this.logRender = on; }
  get renderLogging(): boolean { return this.logRender; }

  private trace(...args: unknown[]): void {
    if (this.logRender) console.debug("[render]", ...args);
  }

  constructor(canvases: RendererCanvases, atlas: Atlas, cam: Camera, world: World) {
    this.canvases = canvases;
    this.atlas = atlas;
    this.cam = cam;
    this.world = world;
    this.pad = cullPad(atlas);
    const g = (el: HTMLCanvasElement, smooth: boolean) => {
      const ctx = el.getContext("2d") as Ctx2D;
      ctx.imageSmoothingEnabled = smooth;
      return ctx;
    };
    // The terrain context samples the ground patterns downscaled
    // (scale < 1× world), so it smooths; structures/overlay blit 1:1
    // pixel art and stay crisp.
    this.ctxT = g(canvases.terrain, true);
    this.ctxS = g(canvases.structures, false);
    this.ctxO = g(canvases.overlay, false);
  }

  // ── invalidation ────────────────────────────────────────────────────────
  invalidateTile(tx: number, ty: number) {
    for (const z of this.atlas.images.keys()) {
      this.groundChunkCache.delete(`${z}:${chunkIndexOf(tx, ty)}`);
    }
    this.structuresDirty = true;
  }

  invalidateAll() {
    this.groundChunkCache.clear();
    this.structuresDirty = true;
  }

  setCamera(cam: Camera) {
    if (cam.zoom !== this.cam.zoom) {
      this.groundChunkCache.clear();
    }
    this.cam = cam;
    this.structuresDirty = true;
  }

  setWorld(world: World) {
    this.world = world;
    this.shore = null;                       // recompute for the new grid
    this.shoreGrid = null;
    this.structuresDirty = true;
  }

  /**
   * W-series: install the seamless ground textures (assets/ground/*.png).
   * Patterns are built from the terrain canvas' context; pass null to drop
   * back to flat fallback colours. A context without createPattern (test
   * stubs) degrades silently to the flat palette. Invalidates everything.
   */
  setGround(tex: GroundTextures | null) {
    if (!tex) { this.ground = null; this.invalidateAll(); return; }
    try {
      this.ground = createGroundPatterns(this.ctxT, tex);
    } catch {
      this.ground = null;                    // e.g. stubbed canvas in tests
    }
    this.invalidateAll();
  }

  /** Shoreline for the current grid, computed once. */
  private shoreOf(): ShoreTile[] {
    if (!this.shore || this.shoreGrid !== this.world.grid) {
      this.shore = computeShore(this.world.grid);
      this.shoreGrid = this.world.grid;
    }
    return this.shore;
  }

  // ── ground chunks ────────────────────────────────────────────────────────
  /**
   * The STATIC ground of one 8×8 chunk (grass fill + beach ring), painted
   * once into a surface and blitted thereafter. Water tiles stay transparent
   * so the animated ocean fill on the layer shows through. Patterns are
   * world-anchored: the pattern transform compensates the chunk origin
   * (modulo the texture period), so every chunk samples ONE continuous
   * meadow — the pattern-painted anti-puzzle.
   */
  private groundFillChunk(cx: number, cy: number): HTMLCanvasElement | OffscreenCanvas | null {
    const z = this.cam.zoom;
    const key = `${z}:${cy * chunksX + cx}`;
    const hit = this.groundChunkCache.get(key);
    if (hit) return hit;

    const { w: W, h: H } = chunkSurfaceSize(z);
    const surf = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(W, H)
      : Object.assign(document.createElement("canvas"), { width: W, height: H });
    const ctx = (surf as HTMLCanvasElement).getContext("2d") as Ctx2D;
    ctx.imageSmoothingEnabled = true;   // the pattern fill downsamples

    const [ox, oy] = chunkWorldOrigin(cx, cy);
    if (this.ground) {
      // World-anchored pattern phase: texture (0,0) must land at the screen
      // position of world (0,0) — offset by the chunk origin mod the tile
      // period, scaled by the zoom. Per-chunk, pre-fill.
      //
      // The textures paint at LAND_SCALE × world — fine grain (one repeat ≈
      // 1.6 tiles wide); the chunk context samples them downscaled, so it
      // must smooth or the nearest-neighbour subsample shimmers on pans.
      const P = GROUND_TEX_SIZE * z * LAND_SCALE;
      const phase = (v: number) => ((-v * z * LAND_SCALE) % P + P) % P;
      const setPat = (p: CanvasPattern, k: number) => {
        const m = makeMatrix();
        m.translateSelf(phase(ox), phase(oy));
        m.scaleSelf(z * k, z * k);
        p.setTransform(m);
      };
      setPat(this.ground.grass, LAND_SCALE);
      setPat(this.ground.sand, LAND_SCALE);
    }
    paintGroundTiles(
      ctx, this.world.grid,
      cx * CHUNK, cy * CHUNK, (cx + 1) * CHUNK - 1, (cy + 1) * CHUNK - 1,
      this.ground
        ? { grass: this.ground.grass, sand: this.ground.sand }
        : { grass: FALLBACK.grass, sand: FALLBACK.sand },
      (wx, wy) => [Math.floor((wx - ox) * z), Math.floor((wy - oy) * z)],
    );
    this.groundChunkCache.set(key, surf);
    this.trace("ground-chunk-built", { chunk: [cx, cy], origin: [ox, oy], surface: [W, H], z, textured: !!this.ground });
    return surf;
  }

  /** The animated shoreline: shallow swell fill + foam strokes per shore tile. */
  private drawShore(ctx: Ctx2D, cam: Camera, r: { x0: number; y0: number; x1: number; y1: number }, t: number) {
    const z = cam.zoom;
    const toScreen = (wx: number, wy: number): [number, number] =>
      [Math.floor(wx * z + cam.x), Math.floor(wy * z + cam.y)];
    let tiles = 0;
    ctx.lineCap = "round";
    for (const st of this.shoreOf()) {
      if (st.tx < r.x0 - 1 || st.tx > r.x1 + 1 || st.ty < r.y0 - 1 || st.ty > r.y1 + 1) continue;
      tiles++;
      // Shallow shelf: a soft turquoise breath over the ocean pattern.
      const diamond = tileDiamondWorld(st.tx, st.ty).map((p) => toScreen(p[0], p[1]));
      pathPolygons(ctx, [diamond]);
      ctx.fillStyle = `rgba(${SHALLOW_RGB},${shallowAlpha(t, st.tx, st.ty).toFixed(3)})`;
      ctx.fill();
      // Foam: a warm white line along every edge this water tile shares
      // with land, breathing out of phase with the swell.
      ctx.strokeStyle = `rgba(${FOAM_RGB},${foamAlpha(t, st.tx, st.ty).toFixed(3)})`;
      ctx.lineWidth = Math.max(1, foamWidth(t, st.tx, st.ty) * z);
      ctx.beginPath();
      for (const [[ax, ay], [bx, by]] of st.edges) {
        const [x1, y1] = toScreen(ax, ay);
        const [x2, y2] = toScreen(bx, by);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    }
    this.trace("shore-pass", { tiles, z });
  }

  // ── layers ──────────────────────────────────────────────────────────────
  drawTerrain(timeMs = 0) {
    const ctx = this.ctxT, cam = this.cam;
    ctx.clearRect(0, 0, cam.vw, cam.vh);
    // 1. The ocean: the seamless water texture, anchored to WORLD space and
    //    drifting with time, fills the whole stage — the map diamond floats
    //    in an endless animated sea.
    if (this.ground) this.ground.water.setTransform(oceanMatrix(cam, timeMs, SEA_SCALE));
    ctx.fillStyle = this.ground ? this.ground.water : FALLBACK.water;
    ctx.fillRect(0, 0, cam.vw, cam.vh);
    // 2. The island: cached land chunks (grass + beach ring) blitted over it.
    const r = visibleTileRange(cam, this.pad);
    const cx0 = (r.x0 / CHUNK) | 0, cx1 = (r.x1 / CHUNK) | 0;
    const cy0 = (r.y0 / CHUNK) | 0, cy1 = (r.y1 / CHUNK) | 0;
    let blits = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const surf = this.groundFillChunk(cx, cy);
        if (!surf) continue;
        const [ox, oy] = chunkWorldOrigin(cx, cy);
        const [sx, sy] = worldToScreen(cam, ox, oy);
        ctx.drawImage(surf as unknown as CanvasImageSource, Math.floor(sx), Math.floor(sy));
        blits++;
        this.trace("ground-blit", { chunk: [cx, cy], origin: [ox, oy], screen: [Math.floor(sx), Math.floor(sy)], z: cam.zoom });
      }
    }
    // 3. The surf: shallow swell + foam along every coast edge, animated.
    this.drawShore(ctx, cam, r, timeMs);
    this.trace("terrain-pass", { range: [r.x0, r.y0, r.x1, r.y1], blits, z: cam.zoom });
  }

  drawStructures(timeMs = 0) {
    const ctx = this.ctxS, cam = this.cam;
    ctx.clearRect(0, 0, cam.vw, cam.vh);
    const r = visibleTileRange(cam, this.pad);
    const items = buildDrawList(this.world, r);
    const placed = items.map((i) => place(this.atlas, i)).filter(Boolean) as Placed[];
    const sorted = depthSort(placed);
    const { order } = sorted;
    this.lastOrder = order;
    this.lastCycles = sorted.cycles;
    for (const p of order) this.blit(ctx, p, timeMs);
    this.trace("structures-pass", {
      z: cam.zoom, range: [r.x0, r.y0, r.x1, r.y1],
      items: items.length, placed: placed.length, cycles: sorted.cycles,
      order: order.map((p) => ({ sprite: p.sprite, tile: [p.tx, p.ty], key: p.key })),
    });
    this.structuresDirty = false;
  }

  /** Overlay: cheap, cleared and redrawn every frame. */
  drawOverlay(items: DrawItem[] = [], timeMs = 0) {
    const ctx = this.ctxO, cam = this.cam;
    ctx.clearRect(0, 0, cam.vw, cam.vh);
    const placed = items.map((i) => place(this.atlas, i)).filter(Boolean) as Placed[];
    for (const p of depthSort(placed).order) this.blit(ctx, p, timeMs);
    // C5: the debug marks are drawn last so they sit above every preview glow.
    if (this.debugPainter) this.debugPainter(ctx, cam);
    // Protests go above even those — the crowd is the thing on the road.
    if (this.overlayPainter) this.overlayPainter(ctx, cam, timeMs);
  }

  private blit(ctx: Ctx2D, p: Placed, timeMs: number) {
    const z = this.cam.zoom;
    // W-series: roads blit from the ROADS atlas, buildings from the BUILDINGS
    // atlas (separate PNG layer atlases, identical rect layout); anything
    // else falls back to the monolithic image (layer sets unloaded).
    const img = this.atlas.imageForSprite(p.sprite, z);
    if (!img) return;
    const frame = p.frame ?? this.atlas.frameAt(p.def, timeMs);
    // Source rect in the ZOOMED atlas — never the raw 1× rect scaled with a
    // multiplication (the packer rounds both position and size at each zoom).
    const src = this.atlas.zoomFrameRect(p.def, frame, z);
    const [sx, sy] = worldToScreen(this.cam, p.wx, p.wy);
    ctx.drawImage(
      img as unknown as CanvasImageSource,
      src.x, src.y, src.w, src.h,
      Math.floor(sx), Math.floor(sy), src.w, src.h,
    );
    this.trace("blit", {
      sprite: p.sprite, tile: [p.tx, p.ty], def: p.def,
      z, context: p.ref != null ? "world" : "overlay",
      anchor: p.def.anchor, world: [p.wx, p.wy],
      screen: [Math.floor(sx), Math.floor(sy)],
      src, dest: [Math.floor(sx), Math.floor(sy), src.w, src.h],
      depthKey: p.key,
    });
  }

  /**
   * One frame. The terrain layer redraws every frame — the ocean drifts and
   * the surf breathes — but its static island is chunk-cached, so the per-
   * frame cost is one pattern fill, a handful of chunk blits and the shore
   * strokes. Structures redraw only when dirty or animated.
   */
  render(timeMs = 0, overlay: DrawItem[] = []) {
    this.drawTerrain(timeMs);
    if (this.structuresDirty || this.hasAnimation()) this.drawStructures(timeMs);
    this.drawOverlay(overlay, timeMs);
  }

  private hasAnimation(): boolean {
    // RV-01: a truck somewhere on the map moves every frame, so the sorted
    // structures pass (which depth-sorts it among the buildings) must run.
    if ((this.world.vehicles?.length ?? 0) > 0) return true;
    return this.lastOrder.some((p) => (p.def.frames ?? 1) > 1);
  }

  // ── picking ─────────────────────────────────────────────────────────────
  /**
   * Two-stage pick. Stage 1 is the flat screenToTile; stage 2 walks the culled
   * draw list front-to-back with alpha masks and overrides stage 1 on a hit.
   */
  pick(screenX: number, screenY: number): {
    tx: number; ty: number; sprite: Placed | null; ref: unknown;
  } {
    const [wx, wy] = screenToWorld(this.cam, screenX, screenY);
    const flat = flatPick(wx, wy);
    if (!this.lastOrder.length) this.drawStructures(0);
    const hit = pickSprite(this.atlas, this.lastOrder, wx, wy);
    if (hit) return { tx: hit.tx, ty: hit.ty, sprite: hit, ref: hit.ref };
    return { tx: flat[0], ty: flat[1], sprite: null, ref: null };
  }

  /**
   * C5/render-debug snapshot: the exact numbers the renderer used on the last
   * frame — geometry, each structure's draw rect at the live zoom, source-rect
   * rounding and a list of warnings for known bug classes (fractional zoom
   * source rect, depth-sort cycles). Surfaces `__iso.rendering()`.
   */
  renderDiagnostics(): RenderDiagnostics {
    const z = this.cam.zoom;
    const range = visibleTileRange(this.cam, this.pad);
    const grass = this.atlas.get("terrain_grass");
    const groundAnchorReference = grass?.anchor[1] ?? null;
    const warnings: string[] = [];
    const structures = this.lastOrder.map((p) => {
      const [sx, sy] = worldToScreen(this.cam, p.wx, p.wy);
      return {
        sprite: p.sprite,
        tx: p.tx,
        ty: p.ty,
        footprint: p.def.footprint,
        anchor: p.def.anchor,
        box: [p.w, p.h] as [number, number],
        world: [p.wx, p.wy] as [number, number],
        screen: [Math.floor(sx), Math.floor(sy)] as [number, number],
        depthKey: p.key,
      };
    });
    const seen = new Set<string>();
    const sourceRect: RenderDiagnostics["sourceRect"] = [];
    for (const p of this.lastOrder) {
      if (seen.has(p.sprite)) continue;
      seen.add(p.sprite);
      const s = p.def;
      const raw: [number, number, number, number] = [s.x * z, s.y * z, s.w * z, s.h * z];
      const packed: [number, number, number, number] = [
        Math.round(s.x * z), Math.round(s.y * z), Math.round(s.w * z), Math.round(s.h * z),
      ];
      sourceRect.push({ sprite: p.sprite, frames: s.frames ?? 1, raw, packed });
      if (raw.some((v, i) => Math.abs(v - packed[i]) > 0.001)) {
        warnings.push(`zoom source rect for ${p.sprite} is fractional (${raw.map((v) => v.toFixed(2)).join(", ")}); packed atlas uses ${packed.join(", ")}`);
      }
    }
    if (this.lastCycles.length) {
      warnings.push(`depth sort hit ${this.lastCycles.length} occlusion cycle(s): ${this.lastCycles.map((c) => c.join(" > ")).join("; ")}`);
    }
    return {
      camera: { zoom: this.cam.zoom, vw: this.cam.vw, vh: this.cam.vh, x: this.cam.x, y: this.cam.y },
      cull: { pad: this.pad, x0: range.x0, y0: range.y0, x1: range.x1, y1: range.y1 },
      chunkCacheEntries: this.groundChunkCache.size,
      groundAnchorReference,
      depthCycles: this.lastCycles,
      structures,
      sourceRect,
      warnings,
    };
  }
}

/**
 * I2: the renderer, camera and input code share this one inverse — the exact
 * `tileToScreen` inverse, no HH compensation and no second pick lattice.
 */
export const flatPick = (wx: number, wy: number): [number, number] => {
  const a = wx / HW, b = wy / HH;
  return [Math.floor((a + b) / 2), Math.floor((b - a) / 2)];
};

export { GRASS, WATER, ROUGH, TILE_W, TILE_H, HW, HH };
