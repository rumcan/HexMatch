// ══════════════════════════════════════════════════════════════════════════
// E4 — Isometric renderer core (flat OpenGFX tiles).
//
// Three stacked canvases:
//   1. terrain     — chunk-cached, redrawn only on camera move / zoom change
//   2. structures  — industries, road, rail, stations; redrawn on world change
//   3. overlay     — previews, highlights, animated frames, cursor; 60fps
//
// Terrain is cached in 8×8-tile chunks rendered once into an OffscreenCanvas
// and blitted thereafter; a chunk is invalidated per changed tile and all
// chunks are dropped on a zoom change. Only the culled tile range is touched.
//
// OpenGFX tiles are FLAT pixel diamonds (64×31 drawn, declared xrel/yrel) with
// no cube skirt, so a tile is drawn whole by its declared anchor and there is
// nothing to clip, no skirt to hide and no per-tile height to model.
//
// Every draw coordinate goes through Math.floor, and nothing is ever scaled
// inside drawImage — the atlas ships pre-rendered at 0.5×/1×/2×.
// ══════════════════════════════════════════════════════════════════════════
import { HW, HH, TILE_W, TILE_H, MAP_W, MAP_H } from "../game/config";
import type { Camera } from "./camera";
import { visibleTileRange, screenToWorld, worldToScreen } from "./camera";
import type { Atlas } from "./atlas";
import { depthSort, place, pickSprite, type DrawItem, type Placed } from "./depth";
import { GRASS, WATER, ROUGH, type Grid } from "./grid";

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
 * Terrain sprite for a tile. There is exactly one flat grass tile (declared
 * sprite 3981) — the grass sheet is one terrain type across a 19-sprite slope
 * set, so what used to be `terrain_grass_b` was a hillside drawn on flat
 * ground (the source of the "weird triangles"). Nothing to vary with now.
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
        // Y5 anchor: the declared xrel/yrel pixel lands on the SOUTH corner of
        // the footprint diamond — drawOrigin in depth.ts places the same pixel
        // at (sx + HW, sy + TILE_H), i.e. the bottom vertex of the diamond.
        const wx = (tx - ty) * HW + HW - s.anchor[0];
        const wy = (tx + ty) * HH + TILE_H - s.anchor[1];
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
          anchor: s.anchor, world: [wx, wy], dest: [dx, dy, src.w, src.h], src, z,
        });
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
  }

  private blit(ctx: Ctx2D, p: Placed, timeMs: number) {
    const z = this.cam.zoom;
    const img = this.atlas.image(z);
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
 * I2: the renderer, camera and input code share this one inverse — the exact
 * `tileToScreen` inverse, no HH compensation and no second pick lattice.
 */
export const flatPick = (wx: number, wy: number): [number, number] => {
  const a = wx / HW, b = wy / HH;
  return [Math.floor((a + b) / 2), Math.floor((b - a) / 2)];
};

export { GRASS, WATER, ROUGH, TILE_W, TILE_H, HW, HH };
