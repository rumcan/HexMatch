// ══════════════════════════════════════════════════════════════════════════
// E4 — Isometric renderer core.
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

/** Terrain sprite for a tile. Grass alternates on a stable checker hash. */
export function terrainSprite(grid: Grid, tx: number, ty: number): string {
  const v = grid.terrain[ty * MAP_W + tx];
  if (v === WATER) return "terrain_water";
  if (v === ROUGH) return "terrain_rough";
  return ((tx * 7 + ty * 13) & 3) === 0 ? "terrain_grass_b" : "terrain_grass_a";
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
      if (rb) out.push({ sprite: bitName("road", rb), tx, ty });
      const kb = world.railBits?.[i] ?? 0;
      if (kb) out.push({ sprite: bitName("rail", kb), tx, ty });
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

export class IsoRenderer {
  readonly atlas: Atlas;
  cam: Camera;
  world: World;

  readonly canvases: RendererCanvases;
  private ctxT: Ctx2D; private ctxS: Ctx2D; private ctxO: Ctx2D;
  private chunkCache = new Map<string, HTMLCanvasElement | OffscreenCanvas>();
  private terrainDirty = true;
  private structuresDirty = true;
  private lastOrder: Placed[] = [];
  private pad: number;

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

    const W = Math.ceil(2 * CHUNK * HW * z);
    const H = Math.ceil((2 * CHUNK * HH + TILE_H) * z);
    const surf = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(W, H)
      : Object.assign(document.createElement("canvas"), { width: W, height: H });
    const ctx = (surf as HTMLCanvasElement).getContext("2d") as Ctx2D;
    ctx.imageSmoothingEnabled = false;

    // Chunk-local origin: world position of the chunk's leftmost tile column.
    const [ox, oy] = this.chunkWorldOrigin(cx, cy);
    for (let ty = cy * CHUNK; ty < Math.min(MAP_H, (cy + 1) * CHUNK); ty++) {
      for (let tx = cx * CHUNK; tx < Math.min(MAP_W, (cx + 1) * CHUNK); tx++) {
        const name = terrainSprite(this.world.grid, tx, ty);
        const s = this.atlas.get(name);
        if (!s) continue;
        const wx = (tx - ty) * HW + HW - s.anchor[0];
        const wy = (tx + ty) * HH + TILE_H - s.anchor[1];
        ctx.drawImage(
          img as unknown as CanvasImageSource,
          s.x * z, s.y * z, s.w * z, s.h * z,
          Math.floor((wx - ox) * z), Math.floor((wy - oy) * z),
          Math.floor(s.w * z), Math.floor(s.h * z),
        );
      }
    }
    this.chunkCache.set(key, surf);
    return surf;
  }

  /** World-space top-left of a chunk's cache surface. */
  chunkWorldOrigin(cx: number, cy: number): [number, number] {
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    // leftmost point = tile (x0, y0+CHUNK-1) left vertex; topmost = tile (x0,y0) top
    const ox = (x0 - (y0 + CHUNK - 1)) * HW - HW;
    const oy = (x0 + y0) * HH;
    return [ox, oy];
  }

  // ── layers ──────────────────────────────────────────────────────────────
  drawTerrain() {
    const ctx = this.ctxT, cam = this.cam;
    ctx.clearRect(0, 0, cam.vw, cam.vh);
    const r = visibleTileRange(cam, this.pad);
    const cx0 = (r.x0 / CHUNK) | 0, cx1 = (r.x1 / CHUNK) | 0;
    const cy0 = (r.y0 / CHUNK) | 0, cy1 = (r.y1 / CHUNK) | 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const surf = this.chunkCanvas(cx, cy);
        if (!surf) continue;
        const [ox, oy] = this.chunkWorldOrigin(cx, cy);
        const [sx, sy] = worldToScreen(cam, ox, oy);
        ctx.drawImage(surf as unknown as CanvasImageSource, Math.floor(sx), Math.floor(sy));
      }
    }
    this.terrainDirty = false;
  }

  drawStructures(timeMs = 0) {
    const ctx = this.ctxS, cam = this.cam;
    ctx.clearRect(0, 0, cam.vw, cam.vh);
    const r = visibleTileRange(cam, this.pad);
    const items = buildDrawList(this.world, r);
    const placed = items.map((i) => place(this.atlas, i)).filter(Boolean) as Placed[];
    const { order } = depthSort(placed);
    this.lastOrder = order;
    for (const p of order) this.blit(ctx, p, timeMs);
    this.structuresDirty = false;
  }

  /** Overlay: cheap, cleared and redrawn every frame. */
  drawOverlay(items: DrawItem[] = [], timeMs = 0) {
    const ctx = this.ctxO, cam = this.cam;
    ctx.clearRect(0, 0, cam.vw, cam.vh);
    const placed = items.map((i) => place(this.atlas, i)).filter(Boolean) as Placed[];
    for (const p of depthSort(placed).order) this.blit(ctx, p, timeMs);
  }

  private blit(ctx: Ctx2D, p: Placed, timeMs: number) {
    const z = this.cam.zoom;
    const img = this.atlas.image(z);
    if (!img) return;
    const frame = p.frame ?? this.atlas.frameAt(p.def, timeMs);
    const rect = this.atlas.frameRect(p.def, frame);
    const [sx, sy] = worldToScreen(this.cam, p.wx, p.wy);
    ctx.drawImage(
      img as unknown as CanvasImageSource,
      rect.x * z, rect.y * z, rect.w * z, rect.h * z,
      Math.floor(sx), Math.floor(sy),
      Math.floor(rect.w * z), Math.floor(rect.h * z),
    );
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
}

export const flatPick = (wx: number, wy: number): [number, number] => {
  const a = wx / HW, b = wy / HH;
  return [Math.floor((a + b) / 2), Math.floor((b - a) / 2)];
};

export { GRASS, WATER, ROUGH, TILE_W, TILE_H, HW, HH };
