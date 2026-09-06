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
  HW, HH, TILE_W, TILE_H, BLOCK_H, MAP_W, MAP_H, tileToScreen,
} from "../game/config";
import type { Camera } from "./camera";
import { visibleTileRange, screenToWorld, worldToScreen } from "./camera";
import type { Atlas } from "./atlas";
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
// seamless flat ground plane; roads and buildings ride that plane with no
// skirt of their own. `skirtCovered` is the predicate, `aboveGroundPoly` the
// clip region, both pure and unit-tested against real atlas pixels.
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

/** Apply `aboveGroundPoly` as a canvas clip. Caller draws, then restore()s. */
function clipAboveGround(ctx: Ctx2D, poly: [number, number][]): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
  ctx.closePath();
  ctx.clip();
}

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
    w: Math.ceil((2 * CHUNK * HW + TILE_W) * z),
    h: Math.ceil((2 * CHUNK * HH + TILE_H + BLOCK_H) * z),
  };
}

/** World-space top-left of a chunk's cache surface. */
export function chunkWorldOrigin(cx: number, cy: number): [number, number] {
  const x0 = cx * CHUNK, y0 = cy * CHUNK;
  const ox = (x0 - (y0 + CHUNK - 1)) * HW - HW;
  const oy = (x0 + y0) * HH - HH;
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
  private pad: number;

  /** The last depth-sorted structure order actually drawn (C5 dumps/picking). */
  get drawOrder(): Placed[] { return this.lastOrder; }

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
    for (let ty = cy * CHUNK; ty < Math.min(MAP_H, (cy + 1) * CHUNK); ty++) {
      for (let tx = cx * CHUNK; tx < Math.min(MAP_W, (cx + 1) * CHUNK); tx++) {
        const name = terrainSprite(this.world.grid, tx, ty);
        const s = this.atlas.get(name);
        if (!s) continue;
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
            (tx - ty) * HW - ox, (tx + ty) * HH - oy, HW, HH, TILE_H + BLOCK_H, z,
          ));
        }
        ctx.drawImage(
          img as unknown as CanvasImageSource,
          s.x * z, s.y * z, s.w * z, s.h * z,
          Math.floor((wx - ox) * z), Math.floor((wy - oy) * z),
          Math.floor(s.w * z), Math.floor(s.h * z),
        );
        if (covered) ctx.restore();
      }
    }
    this.chunkCache.set(key, surf);
    return surf;
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
        const [ox, oy] = chunkWorldOrigin(cx, cy);
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
    // MB2: resolve per-instance variant presets (stable per tile) before placing,
    // so depth-sort and picking operate on the exact sprite that gets drawn.
    const items = buildDrawList(this.world, r)
      .map((i) => ({ ...i, sprite: resolveVariantSprite(this.atlas, i.sprite, i.tx, i.ty) }));
    const placed = items.map((i) => place(this.atlas, i)).filter(Boolean) as Placed[];
    const { order } = depthSort(placed);
    this.lastOrder = order;
    for (const p of order) {
      // N1: structures obey the same skirt rule as terrain — an interior
      // road/building draws no skirt (it stands on the flat ground plane the
      // terrain diamonds make), a coast one keeps its block side. The flag
      // also feeds stage-2 picking (N4): never pick an undrawn skirt.
      const covered = skirtCovered(this.world.grid, p.tx, p.ty, p.def.footprint[0], p.def.footprint[1]);
      p.clipped = covered;
      this.blit(ctx, p, timeMs, covered);
    }
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
      // N1: restrict this sprite to its above-ground region — the footprint's
      // ground diamond plus everything above it. The lattice point the anchor
      // lands on is the footprint centre (depth.drawOrigin), so the clip is
      // expressed directly in screen space around it and is exact at any zoom.
      const [fcx, fcy] = tileToScreen(
        p.tx + (p.def.footprint[0] - 1) / 2, p.ty + (p.def.footprint[1] - 1) / 2,
      );
      const [lx, ly] = worldToScreen(this.cam, fcx, fcy);
      const half = (p.def.footprint[0] + p.def.footprint[1]) / 2;
      clipAboveGround(ctx, aboveGroundPoly(
        lx, ly, half * HW, half * HH, p.def.h + TILE_H + BLOCK_H, z,
      ));
    }
    // MB1: a composite (stacked) building is drawn part-by-part — each layer
    // is a packed sprite sourced from its own atlas rect, offset by (dx, dy)
    // from the stack's top-left (bottom-to-top so upper storeys paint over).
    if (p.def.parts) {
      for (const part of p.def.parts) {
        const def = this.atlas.get(part.sprite);
        if (!def) continue;
        const [sx, sy] = worldToScreen(this.cam, p.wx + part.dx, p.wy + part.dy);
        ctx.drawImage(
          img as unknown as CanvasImageSource,
          def.x * z, def.y * z, def.w * z, def.h * z,
          Math.floor(sx), Math.floor(sy),
          Math.floor(def.w * z), Math.floor(def.h * z),
        );
      }
      ctx.restore();
      return;
    }
    const frame = p.frame ?? this.atlas.frameAt(p.def, timeMs);
    const rect = this.atlas.frameRect(p.def, frame);
    const [sx, sy] = worldToScreen(this.cam, p.wx, p.wy);
    ctx.drawImage(
      img as unknown as CanvasImageSource,
      rect.x * z, rect.y * z, rect.w * z, rect.h * z,
      Math.floor(sx), Math.floor(sy),
      Math.floor(rect.w * z), Math.floor(rect.h * z),
    );
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
    if (hit) return { tx: hit.tx, ty: hit.ty, sprite: hit, ref: hit.ref };
    return { tx: flat[0], ty: flat[1], sprite: null, ref: null };
  }
}

export const flatPick = (wx: number, wy: number): [number, number] => {
  // N4: ONE convention, no compensation. The drawn diamond of tile (tx,ty) is
  // CENTRED on tileToScreen(tx,ty) (the anchor row lands there by
  // construction), and this is its exact closed-form inverse: with a =
  // wx/HW and b = wy/HH, the point lies in the drawn diamond of (i,j) iff
  // |a−(i−j)| + |b−(i+j)| ≤ 1, and flooring the half-sums below returns that
  // tile. The old pick lattice put the cell's TOP VERTEX on tileToScreen —
  // HH away from the drawn diamond — and sampled HH below the cursor to
  // paper over the gap; that fudge is gone. The highlight, the building base
  // and pick() now speak the same tile by construction.
  const a = wx / HW, b = wy / HH;
  return [Math.floor((a + b + 1) / 2), Math.floor((b - a + 1) / 2)];
};

export { GRASS, WATER, ROUGH, TILE_W, TILE_H, HW, HH };
