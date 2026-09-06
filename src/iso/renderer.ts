// ══════════════════════════════════════════════════════════════════════════
// E4 — Isometric renderer core (K4 — Kenney block geometry).
//
// Three stacked canvases:
//   1. terrain     — chunk-cached, redrawn only on camera move / zoom change
//   2. structures  — industries, road, rail, stations; redrawn on world change
//   3. overlay     — previews, highlights, animated frames, cursor; 60fps
//
// Terrain is cached in 4×4-tile chunks rendered once into an OffscreenCanvas
// and blitted thereafter; a chunk is invalidated per changed tile and all
// chunks are dropped on a zoom change. Only the culled tile range is touched.
// (K4: chunks shrank 8→4 — a 132px tile makes an 8×8 chunk ~1188px wide, and
// the cached-surface memory at 2× zoom stops being cheap; 4×4 keeps the same
// coverage in half the wasted area.)
//
// Every draw coordinate goes through Math.floor, and nothing is ever scaled
// inside drawImage — the atlas ships pre-rendered at 0.5×/1×/2×.
// ══════════════════════════════════════════════════════════════════════════
import {
  HW, HH, TILE_W, TILE_H, BLOCK_H, MAP_W, MAP_H, tileToScreen, screenToTile,
} from "../game/config";
import type { Camera } from "./camera";
import { visibleTileRange, screenToWorld, worldToScreen } from "./camera";
import type { Atlas, SpriteDef } from "./atlas";
import { depthSort, place, pickSprite, type DrawItem, type Placed } from "./depth";
import { GRASS, WATER, ROUGH, inBounds, idx, type Grid } from "./grid";

// ══════════════════════════════════════════════════════════════════════════
// N1 — brown only at the map edge (the real geometry rule).
//
// Every Kenney tile is a diamond top plus a block skirt below it, and the
// skirt is TALLER than the vertical gap between tiles (grass: 66px of block
// below the corner row vs HH = 32px of screen per tile row), so a fully
// drawn interior tile can never be fully covered by the neighbour in front
// of it — brown leaked under every road and building.
//
// The rule (backlog N1, Approach A): a tile draws its skirt ONLY where no
// tile in front of it covers the skirt — i.e. where a SE or SW neighbour is
// water or off the map. That is the coastline, and it is the only place
// brown belongs. Interior tiles draw just their above-ground region (the
// diamond top plus anything standing on it), which tessellates into a
// seamless flat ground plane; flush ground overlays (roads/rail) use the same
// treatment. Standing sprites are different: a building is bottom-anchored
// and always drawn whole — clipping its walls to solve a terrain problem was
// the I1 regression. `skirtCovered` classifies the tile, while
// `shouldClipGroundSkirt` enforces that the clip is ground-art only.
// ══════════════════════════════════════════════════════════════════════════

/**
 * True when every pixel of the sprite's skirt would be covered by tiles
 * drawn in front of it — i.e. the sprite is an INTERIOR tile and must not
 * draw its skirt at all. False = coast/edge: draw the full block.
 *
 * The covering tiles are the footprint's exterior SE neighbours (x+1 along
 * the footprint's east edge) and SW neighbours (y+1 along its south edge) —
 * exactly the tiles drawn after it that overlap its skirt. A neighbour that
 * is water or off the map covers nothing, so the tile is a coast tile.
 */
export function skirtCovered(grid: Grid, tx: number, ty: number, fw = 1, fh = 1): boolean {
  for (let x = tx; x < tx + fw; x++) {
    for (let y = ty; y < ty + fh; y++) {
      if (x === tx + fw - 1) {
        const nx = x + 1, ny = y;
        if (!inBounds(nx, ny) || grid.terrain[idx(nx, ny)] === WATER) return false;
      }
      if (y === ty + fh - 1) {
        const nx = x, ny = y + 1;
        if (!inBounds(nx, ny) || grid.terrain[idx(nx, ny)] === WATER) return false;
      }
    }
  }
  return true;
}

/**
 * I1/I4 boundary: only ground art participates in the island-skirt rule.
 * Roads, rail and crossings are ground overlays, so clipping their inland
 * block side keeps them flush. A standing sprite is positioned by its bottom
 * anchor and must be painted whole, regardless of whether its tile is inland.
 */
export function shouldClipGroundSkirt(
  grid: Grid, def: SpriteDef, tx: number, ty: number,
): boolean {
  return def.kind === "ground" &&
    skirtCovered(grid, tx, ty, def.footprint[0], def.footprint[1]);
}

/**
 * The clip region an interior tile may paint: its ground diamond PLUS
 * everything above it (a building's tower, a rock on rough ground), and
 * NOTHING below the diamond's two lower edges — the skirt. (lx, ly) is the
 * footprint ground diamond's centre in canvas coordinates, hw/hh its
 * half-width/height ((fw+fh)/2 · HW/HH for an fw×fh footprint), `up` reaches
 * above the sprite's tallest pixel, and z scales everything for the zoomed
 * atlas. Returned as canvas-space vertices for `clipAboveGround`.
 */
export function aboveGroundPoly(
  lx: number, ly: number, hw: number, hh: number, up: number, z = 1,
): [number, number][] {
  return [
    [lx - hw, ly - up],
    [lx - hw, ly],
    [lx, ly + hh],
    [lx + hw, ly],
    [lx + hw, ly - up],
  ].map(([x, y]) => [Math.round(x * z), Math.round(y * z)] as [number, number]);
}

/** I4 screen-space clip for a placed ground overlay at any camera/zoom. */
export function structureSkirtPoly(p: Placed, cam: Camera): [number, number][] {
  const [fw, fh] = p.def.footprint;
  const [fcx, fcy] = tileToScreen(p.tx + (fw - 1) / 2, p.ty + (fh - 1) / 2);
  const [lx, ly] = worldToScreen(cam, fcx, fcy);
  const half = (fw + fh) / 2;
  return aboveGroundPoly(
    lx, ly, half * HW * cam.zoom, half * HH * cam.zoom,
    (p.def.h + TILE_H + BLOCK_H) * cam.zoom,
  );
}

/** Apply `aboveGroundPoly` as a canvas clip. Caller draws, then restore()s. */
function clipAboveGround(ctx: Ctx2D, poly: [number, number][]): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
  ctx.closePath();
  ctx.clip();
}

/** I5: one logical pixel of straight-alpha overlap hides floored tile seams. */
export const GROUND_OVERLAP = 1;

export const CHUNK = 4;
export const chunksX = Math.ceil(MAP_W / CHUNK);
export const chunksY = Math.ceil(MAP_H / CHUNK);
export const chunkIndexOf = (tx: number, ty: number) =>
  ((ty / CHUNK) | 0) * chunksX + ((tx / CHUNK) | 0);

/**
 * G8/K4: chunk canvas size. A CHUNK×CHUNK span of diamonds covers
 * 2*CHUNK*HW × 2*CHUNK*HH between its extreme centre-lines, plus one full
 * tile of width on the east (the rightmost tile's sprite extends HW past its
 * centre-line on both sides) and TILE_H + BLOCK_H of height (the tallest
 * sprite half above the top centre-line, plus the 50px block skirt below the
 * bottom one) so no pixel of any chunk tile clips.
 */
export function chunkSurfaceSize(z: number): { w: number; h: number } {
  return {
    w: Math.ceil((2 * CHUNK * HW + TILE_W + 2 * GROUND_OVERLAP) * z),
    h: Math.ceil((2 * CHUNK * HH + TILE_H + BLOCK_H + 2 * GROUND_OVERLAP) * z),
  };
}

/** World-space top-left of a chunk's cache surface. */
export function chunkWorldOrigin(cx: number, cy: number): [number, number] {
  const x0 = cx * CHUNK, y0 = cy * CHUNK;
  const ox = (x0 - (y0 + CHUNK - 1)) * HW - HW - GROUND_OVERLAP;
  const oy = (x0 + y0) * HH - HH - GROUND_OVERLAP;
  return [ox, oy];
}

/**
 * Terrain sprite for a tile. One flat tile per terrain type (K2): the Kenney
 * landscape set has many grass variants, but a single flat block per type
 * keeps the terrain uniform — and the packer's flat-only filter (widest row
 * at y≈32) is what keeps slope/ramp tiles out (the old "weird triangles").
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
  roadBits?: Uint8Array;   // E5 — optional until the track model lands
  railBits?: Uint8Array;
  extra?: DrawItem[];      // stations, previews owned by the caller
}

// Track layers carry a PRESENT bit (0b10000) above the 4 direction bits, so a
// lone stub with no connections (mask 0000) is still drawn. Any non-zero byte
// means "there is track here"; the low nibble names the sprite.
const bitName = (prefix: string, cell: number) =>
  `${prefix}_${(cell & 0b1111).toString(2).padStart(4, "0")}`;

/** Build the structure draw list for a culled tile range. */
export function buildDrawList(world: World, r: { x0: number; y0: number; x1: number; y1: number }): DrawItem[] {
  const out: DrawItem[] = [];
  const { grid } = world;
  // road/rail are flush to the ground and 1×1 — they sort naturally.
  for (let ty = r.y0; ty <= r.y1; ty++) {
    for (let tx = r.x0; tx <= r.x1; tx++) {
      const i = ty * MAP_W + tx;
      const rb = world.roadBits?.[i] ?? 0;
      const kb = world.railBits?.[i] ?? 0;
      if (rb) out.push({ sprite: bitName("road", rb), tx, ty });
      if (kb) out.push({ sprite: bitName("rail", kb), tx, ty });
      // G6: a tile carrying both layers draws a third sprite on top.
      if (rb && kb) out.push({ sprite: "crossing", tx, ty });
    }
  }
  // industries: emit once, keyed on their origin, when the footprint
  // intersects the culled range.
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
  return out;
}

/**
 * MB2 per-instance variant selection. A canonical sprite whose manifest def
 * carries a `variants` pick-set (length > 1) draws a DIFFERENT preset on every
 * instance, so repeated buildings aren't identical. The choice is a stable
 * hash of the footprint origin — the same tile always picks the same preset, so
 * culling, chunk invalidation and picking can never flicker. Terrain and the
 * single preset (length 1) resolve to the given sprite unchanged.
 */
export const variantSeed = (tx: number, ty: number): number =>
  (((tx * 0x9E3779B1) ^ (ty * 0x85EBCA77)) >>> 0) % 0x7fffffff;

export function resolveVariantSprite(atlas: Atlas, sprite: string, tx: number, ty: number): string {
  const def = atlas.get(sprite);
  if (!def || !def.variants || def.variants.length < 2) return sprite;
  return def.variants[variantSeed(tx, ty) % def.variants.length];
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
 *      so a running game can be traced to the exact source/dest rect and clip
 *      decision the renderer used;
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
    kind: string | null;
    anchor: [number, number];
    box: [number, number];
    world: [number, number];
    screen: [number, number];
    depthKey: number;
    clipped: boolean;
    parts: { sprite: string; dx: number; dy: number }[] | null;
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
   * console draws skirt/anchor/network/pick marks on the map so a screenshot
   * carries the state behind it (`installIsoDebug` in `debug.ts`). Left null
   * in production — nothing else ever writes to the overlay context.
   */
  debugPainter: ((ctx: CanvasRenderingContext2D, cam: Camera) => void) | null = null;

  readonly canvases: RendererCanvases;
  private ctxT: Ctx2D; private ctxS: Ctx2D; private ctxO: Ctx2D;
  private chunkCache = new Map<string, HTMLCanvasElement | OffscreenCanvas>();
  private terrainDirty = true;
  private structuresDirty = true;
  private lastOrder: Placed[] = [];
  private lastCycles: string[][] = [];
  private pad: number;
  private logRender = false;

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
    const g = (el: HTMLCanvasElement) => {
      const ctx = el.getContext("2d") as Ctx2D;
      ctx.imageSmoothingEnabled = false;
      return ctx;
    };
    this.ctxT = g(canvases.terrain);
    this.ctxS = g(canvases.structures);
    this.ctxO = g(canvases.overlay);
  }

  // ── invalidation ────────────────────────────────────────────────────────
  invalidateTile(tx: number, ty: number) {
    for (const z of this.atlas.images.keys()) this.chunkCache.delete(`${z}:${chunkIndexOf(tx, ty)}`);
    this.terrainDirty = true;
    this.structuresDirty = true;
  }

  invalidateAll() {
    this.chunkCache.clear();
    this.terrainDirty = true;
    this.structuresDirty = true;
  }

  setCamera(cam: Camera) {
    if (cam.zoom !== this.cam.zoom) this.chunkCache.clear();
    this.cam = cam;
    this.terrainDirty = true;
    this.structuresDirty = true;
  }

  setWorld(world: World) {
    this.world = world;
    this.structuresDirty = true;
  }

  // ── chunk cache ─────────────────────────────────────────────────────────
  /**
   * Chunk canvas size: an 8×8 chunk of diamonds spans 8+8 tiles wide and
   * 8+8 tall in half-units, so 16*HW × 16*HH at 1×, scaled by zoom.
   */
  private chunkCanvas(cx: number, cy: number): HTMLCanvasElement | OffscreenCanvas | null {
    const z = this.cam.zoom;
    const key = `${z}:${cy * chunksX + cx}`;
    const hit = this.chunkCache.get(key);
    if (hit) return hit;
    const img = this.atlas.image(z);
    if (!img) return null;

    const { w: W, h: H } = chunkSurfaceSize(z);
    const surf = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(W, H)
      : Object.assign(document.createElement("canvas"), { width: W, height: H });
    const ctx = (surf as HTMLCanvasElement).getContext("2d") as Ctx2D;
    ctx.imageSmoothingEnabled = false;

    // Chunk-local origin: world position of the chunk's leftmost tile column.
    const [ox, oy] = chunkWorldOrigin(cx, cy);
    let sprites = 0;
    for (let ty = cy * CHUNK; ty < Math.min(MAP_H, (cy + 1) * CHUNK); ty++) {
      for (let tx = cx * CHUNK; tx < Math.min(MAP_W, (cx + 1) * CHUNK); tx++) {
        const name = terrainSprite(this.world.grid, tx, ty);
        const s = this.atlas.get(name);
        if (!s) continue;
        sprites++;
        // K0 anchor: the sprite's widest-row pixel lands on the tile's
        // centre-line — drawX = screenX − HW, drawY = screenY − widestRow.
        const wx = (tx - ty) * HW - s.anchor[0];
        const wy = (tx + ty) * HH - s.anchor[1];
        // N1: interior tiles paint only their above-ground region — the
        // diamond top tessellates into the flat ground plane and the skirt
        // (which the tiles in front can never fully cover) is simply not
        // drawn. Edge tiles keep the full block: that IS the coastline.
        const covered = skirtCovered(this.world.grid, tx, ty);
        if (covered) {
          clipAboveGround(ctx, aboveGroundPoly(
            (tx - ty) * HW - ox, (tx + ty) * HH - oy,
            HW + GROUND_OVERLAP, HH + GROUND_OVERLAP,
            TILE_H + BLOCK_H, z,
          ));
        }
        // The zoomed atlas is packed at INTEGER source coords
        // (`Math.round(x*z)` / `Math.round(w*z)` in slice-atlas.mjs), so use
        // the real packed rect rather than the fractional `s.x*z…s.w*z`.
        const src = this.atlas.zoomRect(s, z);
        const dx = Math.floor((wx - ox) * z), dy = Math.floor((wy - oy) * z);
        ctx.drawImage(
          img as unknown as CanvasImageSource,
          src.x, src.y, src.w, src.h,
          dx, dy, src.w, src.h,
        );
        this.trace("terrain", {
          chunk: [cx, cy], key, tile: [tx, ty], sprite: name,
          anchor: s.anchor, world: [wx, wy], dest: [dx, dy, src.w, src.h],
          src, clip: covered ? "above-ground" : "full-block", z,
        });
        if (covered) ctx.restore();
      }
    }
    this.chunkCache.set(key, surf);
    this.trace("chunk-built", { key, chunk: [cx, cy], origin: [ox, oy], surface: [W, H], sprites, z });
    return surf;
  }

  // ── layers ──────────────────────────────────────────────────────────────
  drawTerrain() {
    const ctx = this.ctxT, cam = this.cam;
    ctx.clearRect(0, 0, cam.vw, cam.vh);
    const r = visibleTileRange(cam, this.pad);
    const cx0 = (r.x0 / CHUNK) | 0, cx1 = (r.x1 / CHUNK) | 0;
    const cy0 = (r.y0 / CHUNK) | 0, cy1 = (r.y1 / CHUNK) | 0;
    let blits = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const surf = this.chunkCanvas(cx, cy);
        if (!surf) continue;
        const [ox, oy] = chunkWorldOrigin(cx, cy);
        const [sx, sy] = worldToScreen(cam, ox, oy);
        ctx.drawImage(surf as unknown as CanvasImageSource, Math.floor(sx), Math.floor(sy));
        blits++;
        this.trace("terrain-blit", { chunk: [cx, cy], origin: [ox, oy], screen: [Math.floor(sx), Math.floor(sy)], z: cam.zoom });
      }
    }
    this.trace("terrain-pass", { range: [r.x0, r.y0, r.x1, r.y1], blits, z: cam.zoom });
    this.terrainDirty = false;
  }

  drawStructures(timeMs = 0) {
    const ctx = this.ctxS, cam = this.cam;
    ctx.clearRect(0, 0, cam.vw, cam.vh);
    const r = visibleTileRange(cam, this.pad);
    // MB2: resolve per-instance variant presets (stable per tile) before placing,
    // so depth-sort and picking operate on the exact sprite that gets drawn.
    const items = buildDrawList(this.world, r)
      .map((i) => ({ ...i, sprite: resolveVariantSprite(this.atlas, i.sprite, i.tx, i.ty) }));
    const placed = items.map((i) => place(this.atlas, i)).filter(Boolean) as Placed[];
    const sorted = depthSort(placed);
    const { order } = sorted;
    this.lastOrder = order;
    this.lastCycles = sorted.cycles;
    for (const p of order) {
      // I1/I4: the coastline clip belongs to GROUND art only. Roads/rail are
      // flush ground overlays and lose their inland block side; buildings are
      // standing sprites and are always bottom-anchored and painted whole.
      // The flag also keeps stage-2 picking identical to what was painted.
      const clipSkirt = shouldClipGroundSkirt(this.world.grid, p.def, p.tx, p.ty);
      p.clipped = clipSkirt;
      this.blit(ctx, p, timeMs, clipSkirt);
    }
    this.trace("structures-pass", {
      z: cam.zoom, range: [r.x0, r.y0, r.x1, r.y1],
      items: items.length, placed: placed.length, cycles: sorted.cycles,
      order: order.map((p) => ({ sprite: p.sprite, tile: [p.tx, p.ty], key: p.key, clip: p.clipped })),
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
  }

  private blit(ctx: Ctx2D, p: Placed, timeMs: number, clipSkirt = false) {
    const z = this.cam.zoom;
    const img = this.atlas.image(z);
    if (!img) return;
    if (clipSkirt) {
      // I4: structureSkirtPoly receives SCREEN space and scales dimensions
      // once; camera translation is never multiplied a second time.
      clipAboveGround(ctx, structureSkirtPoly(p, this.cam));
    }
    // MB1: a composite (stacked) building is drawn part-by-part — each layer
    // is a packed sprite sourced from its own atlas rect, offset by (dx, dy)
    // from the stack's top-left (bottom-to-top so upper storeys paint over).
    if (p.def.parts) {
      for (const part of p.def.parts) {
        const def = this.atlas.get(part.sprite);
        if (!def) continue;
        const [sx, sy] = worldToScreen(this.cam, p.wx + part.dx, p.wy + part.dy);
        const src = this.atlas.zoomRect(def, z);
        ctx.drawImage(
          img as unknown as CanvasImageSource,
          src.x, src.y, src.w, src.h,
          Math.floor(sx), Math.floor(sy), src.w, src.h,
        );
        this.trace("blit-part", {
          stack: p.sprite, tile: [p.tx, p.ty], part: part.sprite,
          offset: [part.dx, part.dy], world: [p.wx + part.dx, p.wy + part.dy],
          screen: [Math.floor(sx), Math.floor(sy)], src, z,
        });
      }
      if (clipSkirt) ctx.restore();
      return;
    }
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
      clipped: clipSkirt, z, context: p.ref != null ? "world" : "overlay",
      anchor: p.def.anchor, world: [p.wx, p.wy],
      screen: [Math.floor(sx), Math.floor(sy)],
      src, dest: [Math.floor(sx), Math.floor(sy), src.w, src.h],
      depthKey: p.key,
    });
    if (clipSkirt) ctx.restore();
  }

  /** One frame. Layers 1 and 2 redraw only when dirty. */
  render(timeMs = 0, overlay: DrawItem[] = []) {
    if (this.terrainDirty) this.drawTerrain();
    if (this.structuresDirty || this.hasAnimation()) this.drawStructures(timeMs);
    this.drawOverlay(overlay, timeMs);
  }

  private hasAnimation(): boolean {
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
    const out = hit
      ? { tx: hit.tx, ty: hit.ty, sprite: hit, ref: hit.ref }
      : { tx: flat[0], ty: flat[1], sprite: null, ref: null };
    this.trace("pick", {
      input: [screenX, screenY], world: [wx, wy], flat,
      sprite: hit ? hit.sprite : null,
      result: [out.tx, out.ty], z: this.cam.zoom,
    });
    return out;
  }

  /**
   * C5/render-debug snapshot: the exact numbers the renderer used on the last
   * frame — geometry, each structure's draw rect at the live zoom, source-rect
   * rounding and a list of warnings for known bug classes (anchor drift off
   * the shared ground line, standing sprite accidentally clipped, zoom rect
   * mismatches, depth-sort cycles). Surfaces `__iso.rendering()`.
   */
  renderDiagnostics(): RenderDiagnostics {
    const z = this.cam.zoom;
    const range = visibleTileRange(this.cam, this.pad);
    const grass = this.atlas.get("terrain_grass");
    const groundAnchorReference = grass?.anchor[1] ?? null;
    const warnings: string[] = [];
    const structures = this.lastOrder.map((p) => {
      const [sx, sy] = worldToScreen(this.cam, p.wx, p.wy);
      if (p.clipped && p.def.kind !== "ground") {
        warnings.push(`${p.sprite} at (${p.tx},${p.ty}) is a STANDING sprite but it was clipped to its above-ground polygon`);
      }
      if (p.def.kind === "ground" && groundAnchorReference !== null) {
        const drift = p.def.anchor[1] - groundAnchorReference;
        if (Math.abs(drift) > 1) {
          warnings.push(`ground ${p.sprite} anchor.y ${p.def.anchor[1]} drifts ${drift}px from the ${groundAnchorReference}px shared ground line`);
        }
      }
      return {
        sprite: p.sprite,
        tx: p.tx,
        ty: p.ty,
        footprint: p.def.footprint,
        kind: p.def.kind ?? null,
        anchor: p.def.anchor,
        box: [p.w, p.h] as [number, number],
        world: [p.wx, p.wy] as [number, number],
        screen: [Math.floor(sx), Math.floor(sy)] as [number, number],
        depthKey: p.key,
        clipped: p.clipped ?? false,
        parts: p.def.parts
          ? p.def.parts.map((part) => ({ sprite: part.sprite, dx: part.dx, dy: part.dy }))
          : null,
      };
    });
    const seen = new Set<string>();
    const sourceRect: RenderDiagnostics["sourceRect"] = [];
    for (const p of this.lastOrder) {
      if (seen.has(p.sprite)) continue;
      seen.add(p.sprite);
      if (p.def.parts) continue;   // a stack has no zoom rect of its own
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
    // The placement glow is a ground-kind cell in the atlas; flag a 1px anchor
    // drift against the terrain reference (the known highlight/base mismatch).
    const hl = this.atlas.get("highlight");
    if (hl && groundAnchorReference !== null && hl.anchor[1] !== groundAnchorReference) {
      warnings.push(`highlight anchor.y ${hl.anchor[1]} differs from the ${groundAnchorReference}px shared ground line`);
    }
    if (this.lastCycles.length) {
      warnings.push(`depth sort hit ${this.lastCycles.length} occlusion cycle(s): ${this.lastCycles.map((c) => c.join(" > ")).join("; ")}`);
    }
    return {
      camera: { zoom: this.cam.zoom, vw: this.cam.vw, vh: this.cam.vh, x: this.cam.x, y: this.cam.y },
      cull: { pad: this.pad, x0: range.x0, y0: range.y0, x1: range.x1, y1: range.y1 },
      chunkCacheEntries: this.chunkCache.size,
      groundAnchorReference,
      depthCycles: this.lastCycles,
      structures,
      sourceRect,
      warnings,
    };
  }
}

/**
 * I2: the renderer, camera and input code share this one inverse. Keeping the
 * public name avoids churn for debug/tests while the implementation is the
 * exact `tileToScreen` inverse exported from config — no HH compensation and
 * no second pick lattice.
 */
export const flatPick = screenToTile;

export { GRASS, WATER, ROUGH, TILE_W, TILE_H, HW, HH };
