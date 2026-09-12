// ══════════════════════════════════════════════════════════════════════════
// E4 — Isometric renderer core (W-series pattern-painted ground).
//
// Three stacked canvases:
//   1. terrain     — the pattern-painted GROUND: an animated ocean over the
//                    whole stage, the grass island and its beach ring cached
//                    in 8×8-tile chunks, the SCENERY DECALS (dirt scrapes and
//                    grass variation, painted live above the chunks so they
//                    are not cut on chunk edges), and the animated shoreline
//                    (shallow swell + foam) stroked live. Redrawn every frame
//                    — the ocean drifts — but the expensive part is cached.
//   2. structures  — industries, road, rail, stations, scattered trees;
//                    redrawn on world change
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
import { depthSort, isMoving, place, pickSprite, type DrawItem, type Placed } from "./depth";
import { GRASS, WATER, ROUGH, type Grid } from "./grid";
import {
  FALLBACK, GROUND_TEX_SIZE, createGroundPatterns, makeMatrix, oceanMatrix,
  paintGroundTiles, paintShore, invalidateGroundContours,
  type GroundPatterns, type GroundTextures,
} from "./ground";
import { ShadowStamps, paintBuildingShadows } from "./building-shadow";
import {
  FOREST_FOOTPRINT, TREE_SPRITES, paintDecals,
  type Decal, type DecalImages, type Forest, type Scenery,
} from "./scenery";
import {
  DEFAULT_ROAD_STYLE, RoadCache,
  type RoadCacheStats, type RoadRenderMode, type RoadStyle,
} from "./road-renderer";
import {
  PlacementOverlay, sceneFromItems,
  type GhostSpec, type OverlayStats,
} from "./overlay-art";

/**
 * Which placement-overlay implementation is live. Same A/B seam the roads
 * have (`RoadRenderMode`): `vector` paints the highlight as geometry
 * (`overlay-art.ts`) and is the default; `sprites` blits the four baked atlas
 * cells the way the overlay always did, kept as a rollback and for comparison
 * through `__iso.highlightMode('sprites')`. Renderer state only — never
 * persisted, never on the wire.
 */
export type HighlightRenderMode = "sprites" | "vector";

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
  /**
   * SCENERY: one byte per tile — 0 for none, else a 1-based index into
   * `TREE_SPRITES`. A flat array rather than a list because the draw list is
   * already built by walking the visible tile range, so a tree costs one
   * array read on a loop the renderer runs anyway. Seed-derived and never
   * mutated: a tree is hidden, not deleted, when something is built on it.
   */
  trees?: Uint8Array;
  /**
   * SCENERY: tile indices where a tree must not be drawn because the player
   * built something there (plant footprints, depots). Roads are NOT in here —
   * `roadBits`/`dirtBits` already say where the gravel is, and the draw list
   * reads those directly.
   */
  sceneryBlocked?: Set<number>;
  /**
   * SCENERY: the multi-tile forest blocks. A list rather than a per-tile byte
   * because each covers a 4×4 footprint and depth-sorts as one thing, exactly
   * like an industry.
   */
  forests?: Forest[];
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

/**
 * Options for the draw list. `roads: false` suppresses ONLY the road and dirt
 * SPRITE items, for the textured road renderer which paints those surfaces
 * itself. Everything else in the tile loop — most importantly the tree and
 * forest suppression, which reads the live road bytes — runs exactly as
 * before. Hiding roads by handing this function zeroed road arrays would
 * "work" and would also resurrect every tree the player has paved over.
 */
export interface DrawListOptions {
  roads?: boolean;
  /** Exclude per-frame traffic when caching static placements. */
  vehicles?: boolean;
}

/** Build the structure draw list for a culled tile range. */
export function buildDrawList(
  world: World,
  r: { x0: number; y0: number; x1: number; y1: number },
  opts: DrawListOptions = {},
): DrawItem[] {
  const emitRoads = opts.roads !== false;
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
      if (emitRoads && db) out.push({ sprite: dirtSpriteName(world, tx, ty, db), tx, ty });
      if (emitRoads && rb) out.push({ sprite: bitName("road", rb), tx, ty });
      // SCENERY: a scattered tree, unless the tile has since been paved or
      // built on — the tree was cleared to make room, which is what the
      // player expects to see and costs nothing to model.
      const tree = world.trees?.[i] ?? 0;
      if (tree && !rb && !db && !world.sceneryBlocked?.has(i))
        out.push({ sprite: TREE_SPRITES[tree - 1], tx, ty, decor: true });
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
  // SCENERY: the 4×4 forest blocks, culled and depth-keyed exactly like an
  // industry. Cleared wholesale the moment anything is built inside them —
  // the wood came down to make room, which is what the player expects, and a
  // half-erased painted block would look far worse than a cleared one.
  if (world.forests) {
    for (const f of world.forests) {
      if (f.tx + FOREST_FOOTPRINT - 1 < r.x0 || f.tx > r.x1) continue;
      if (f.ty + FOREST_FOOTPRINT - 1 < r.y0 || f.ty > r.y1) continue;
      let clear = true;
      for (let dy = 0; dy < FOREST_FOOTPRINT && clear; dy++) {
        for (let dx = 0; dx < FOREST_FOOTPRINT && clear; dx++) {
          const i = (f.ty + dy) * MAP_W + f.tx + dx;
          if (world.roadBits?.[i] || world.dirtBits?.[i] || world.sceneryBlocked?.has(i)) clear = false;
        }
      }
      if (clear) out.push({ sprite: f.sprite, tx: f.tx, ty: f.ty, decor: true });
    }
  }
  if (world.extra) {
    for (const e of world.extra) {
      if (e.tx < r.x0 - 4 || e.tx > r.x1 + 4 || e.ty < r.y0 - 4 || e.ty > r.y1 + 4) continue;
      out.push(e);
    }
  }
  // RV-01: trucks drive BETWEEN tiles, so the cull test uses the rounded
  // tile with the same generous pad the extras get.
  if (opts.vehicles !== false && world.vehicles) {
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

/** Integer screen rectangle, half-open: [x0, x1) × [y0, y1). */
interface ScreenRect { x0: number; y0: number; x1: number; y1: number }

const rectsOverlap = (a: ScreenRect, b: ScreenRect): boolean =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** What the last structures pass painted, for `__iso.rendering().repaint`. */
export interface RepaintStats {
  /** true: the whole viewport was cleared and repainted. */
  full: boolean;
  /** Sprite blits issued by the pass (roads and shadows not counted). */
  blits: number;
  /** Damage rectangles clipped to (0 on a full repaint or an idle pass). */
  damageRects: number;
}

/**
 * The terrain's ambient animation (ocean drift, surf) repaints at ~30 Hz. It
 * moves slowly enough that 60 Hz bought nothing visible. The small tolerance
 * keeps a 60 Hz display on every other frame instead of slipping to every
 * third when frame times jitter under the exact period.
 */
export const TERRAIN_FRAME_MS = 1000 / 30;
const TERRAIN_FRAME_SLACK_MS = 4;

/** An offscreen raster surface, or null where neither API exists (tests). */
function makeSurface(w: number, h: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  if (typeof document === "undefined") return null;
  return Object.assign(document.createElement("canvas"), { width: w, height: h });
}

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
  /** Road renderer mode, texture readiness and cache accounting. */
  roads: {
    mode: RoadRenderMode;
    textured: { paved: boolean; dirt: boolean };
    blitsLastFrame: number;
    cache: RoadCacheStats;
  };
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
  /**
   * The placement overlay's last frame: which implementation drew it and what
   * it painted. A screenshot of a placement therefore carries the tile counts
   * behind the glow, the same way `structures` carries the draw rects.
   */
  overlay: OverlayDiagnostics;
  /** The last structures pass: full repaint or damage-clipped, and its cost. */
  repaint: RepaintStats;
  warnings: string[];
}

/** What the overlay layer drew last frame: the vector scene, or the blit count. */
export type OverlayDiagnostics =
  | OverlayStats
  | { mode: "sprites"; painted: number };

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

  /** Pre-blurred building shadow stamps, one per footprint size per zoom. */
  private readonly shadowStamps = new ShadowStamps();

  readonly canvases: RendererCanvases;
  private ctxT: Ctx2D; private ctxS: Ctx2D; private ctxO: Ctx2D;
  private structuresDirty = true;
  private staticPlaced: Placed[] = [];
  private staticItemCount = 0;
  private staticRange = "";
  private hadVehicles = false;
  // ── damage-clipped traffic repaint ───────────────────────────────────────
  /** The structures canvas holds a complete frame the next pass may patch. */
  private paintedValid = false;
  /** Non-moving placements in the order last drawn (compared by identity). */
  private lastStaticOrder: Placed[] = [];
  /** Screen bounds of every moving sprite last drawn. */
  private lastMovingRects: ScreenRect[] = [];
  /** Frame last drawn for each multi-frame static sprite. */
  private lastFrames = new Map<Placed, number>();
  private repaint: RepaintStats = { full: true, blits: 0, damageRects: 0 };
  // ── terrain cadence ──────────────────────────────────────────────────────
  /** Camera/world/art changed: repaint the terrain on the next frame. */
  private terrainDirty = true;
  private lastTerrainT = -Infinity;
  private lastOrder: Placed[] = [];
  private lastCycles: string[][] = [];
  private pad: number;
  private logRender = false;
  // ── W-series pattern-painted ground ──────────────────────────────────────
  /** Canvas patterns for grass/sand/water; null → flat FALLBACK colours. */
  private ground: GroundPatterns | null = null;
  /**
   * Chunk surfaces for the STATIC ground (grass fill + beach ring, water left
   * transparent so the animated ocean shows through). Cached per zoom like
   * the old sprite chunks; repainted when a tile is invalidated.
   */
  private groundChunkCache = new Map<string, HTMLCanvasElement | OffscreenCanvas>();
  // ── scenery ──────────────────────────────────────────────────────────────
  /** The seed-derived ground decals; null until the map's scenery is set. */
  private decals: Decal[] | null = null;
  // ── roads ────────────────────────────────────────────────────────────────
  /**
   * Which road implementation is live. Renderer-local and never persisted —
   * it is an A/B switch, not game state, so it must not reach the save format
   * or the multiplayer protocol.
   *
   * `textured` is now the default: the vector roads are the roads. The old
   * per-mask sprites stay reachable through `__iso.roadMode('sprites')` for
   * comparison and as a rollback, and their atlas cells are still shipped.
   */
  private roadMode: RoadRenderMode = "textured";
  private roadStyle: RoadStyle = DEFAULT_ROAD_STYLE;
  private roadCache = new RoadCache();
  private roadBlits = 0;
  // ── placement overlay ───────────────────────────────────────────────────
  /** Vector by default; `sprites` is the baked-cell rollback (see the type). */
  private highlightMode: HighlightRenderMode = "vector";
  /** The vector painter and its ghost cache — one per renderer. */
  private readonly overlayArt = new PlacementOverlay();
  /** How many overlay items the last frame blitted as sprites (0 in vector mode). */
  private overlayBlits = 0;
  /**
   * A copy of the road bytes as they were when the caches were last valid.
   *
   * The track layers are typed arrays MUTATED IN PLACE, so `setWorld` cannot
   * detect a change by identity — the same array object arrives every time
   * with different contents. Comparing against a copy is the reliable way to
   * find which tiles actually moved, and it dirties only those tiles and
   * their neighbours instead of dropping the whole cache on every build.
   */
  private roadShadow: { road: Uint8Array; dirt: Uint8Array } | null = null;
  /** The decal PNGs by family; null until the art loads (then decals paint). */
  private decalImages: DecalImages | null = null;

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

  /**
   * ART-1950S (TICKET-B-3.2): recompute the culling pad from the CURRENT
   * sprite defs. The constructor computes it once from
   * `atlas.manifest.sprites` — but `loadBuildingLayers()` resolves LATER and
   * mutates `s.w`/`s.h` on the defs it installs (a per-building PNG can be
   * taller than the tallest sheet sprite), so a pad frozen at construction
   * lets tall buildings pop in and out at the screen edge. Call this from the
   * same `.then()` that invalidates after the layers install. Exposed as a
   * method (not re-derived per frame) because it scans every sprite def.
   */
  recomputePad(): number {
    this.pad = cullPad(this.atlas);
    this.structuresDirty = true;
    return this.pad;
  }

  /** The culling pad currently in use (tiles of overdraw beyond the viewport). */
  get cullPadValue(): number { return this.pad; }

  // ── invalidation ────────────────────────────────────────────────────────
  invalidateTile(tx: number, ty: number) {
    for (const z of this.atlas.images.keys()) {
      this.groundChunkCache.delete(`${z}:${chunkIndexOf(tx, ty)}`);
    }
    // A road's shape depends on its neighbours' bits and their tier, so the
    // cache dirties a neighbourhood rather than a tile.
    this.roadCache.invalidateTile(tx, ty, "invalidateTile");
    this.structuresDirty = true;
    this.terrainDirty = true;
  }

  invalidateAll() {
    invalidateGroundContours(this.world.grid);
    this.groundChunkCache.clear();
    this.roadCache.clear("all");
    this.structuresDirty = true;
    this.terrainDirty = true;
  }

  setCamera(cam: Camera) {
    if (cam.zoom !== this.cam.zoom) {
      this.groundChunkCache.clear();
    }
    this.cam = cam;
    this.structuresDirty = true;
    this.terrainDirty = true;
  }

  setWorld(world: World) {
    const gridChanged = this.world.grid !== world.grid;
    this.world = world;
    this.structuresDirty = true;
    this.terrainDirty = true;
    if (gridChanged) {
      // A new map, a loaded save or a guest snapshot: nothing cached applies.
      invalidateGroundContours(this.world.grid);
      this.groundChunkCache.clear();
      this.roadCache.clear("world");
      this.roadShadow = null;
    }
    this.syncRoadCache();
  }

  // ── roads ────────────────────────────────────────────────────────────────
  /** Which road implementation to draw. A/B switch; never persisted. */
  setRoadMode(mode: RoadRenderMode): void {
    if (mode === this.roadMode) return;
    this.roadMode = mode;
    this.structuresDirty = true;
  }

  get roadRenderMode(): RoadRenderMode { return this.roadMode; }

  /**
   * Install road materials. Called when the textures resolve; a failure just
   * leaves the flat fallback palette in place, which is a complete look
   * rather than an error state.
   */
  setRoadStyle(style: RoadStyle): void {
    this.roadStyle = style;
    this.roadCache.bumpStyle("style");
    this.structuresDirty = true;
  }

  /**
   * Diff the live road bytes against our copy and dirty only what moved.
   *
   * Both track layers are mutated IN PLACE, so array identity proves nothing;
   * this is the only reliable signal short of the simulation raising explicit
   * events. It is O(map) per call, on a 20 736-tile map, and only on world
   * syncs — not per frame.
   */
  private syncRoadCache(): void {
    const road = this.world.roadBits, dirt = this.world.dirtBits;
    if (!road || !dirt) return;
    const prev = this.roadShadow;
    if (!prev || prev.road.length !== road.length) {
      this.roadShadow = { road: Uint8Array.from(road), dirt: Uint8Array.from(dirt) };
      this.roadCache.clear("resync");
      return;
    }
    for (let i = 0; i < road.length; i++) {
      if (prev.road[i] === road[i] && prev.dirt[i] === dirt[i]) continue;
      prev.road[i] = road[i];
      prev.dirt[i] = dirt[i];
      this.roadCache.invalidateTile(i % MAP_W, (i / MAP_W) | 0, "build");
    }
  }

  /** Road cache + mode, for `__iso.rendering()`. */
  roadDiagnostics() {
    return {
      mode: this.roadMode,
      textured: {
        paved: !!this.roadStyle.paved.image,
        dirt: !!this.roadStyle.dirt.image,
      },
      blitsLastFrame: this.roadBlits,
      cache: this.roadCache.stats(),
    };
  }

  // ── placement overlay ───────────────────────────────────────────────────
  /**
   * Which placement-overlay implementation to draw. A/B switch, exactly like
   * `setRoadMode`: renderer state, never persisted, never simulated — both
   * players place by the same rules whatever they are looking at.
   */
  setHighlightMode(mode: HighlightRenderMode): void {
    this.highlightMode = mode;
  }

  get highlightRenderMode(): HighlightRenderMode { return this.highlightMode; }

  /**
   * QoL: freeze the overlay's pulse, marching reach band and ghost bob for
   * players who ask the OS to reduce motion. Colours, shapes and positions are
   * untouched — only the movement goes.
   */
  setOverlayMotion(on: boolean): void {
    this.overlayArt.reducedMotion = !on;
  }

  /** Overlay mode + last frame's paint facts, for `__iso.rendering()`. */
  overlayDiagnostics(): OverlayDiagnostics {
    if (this.highlightMode === "sprites") {
      return { mode: "sprites", painted: this.overlayBlits };
    }
    // Nothing painted yet (no frame since boot) still answers as a vector
    // overlay with an empty scene, rather than as "no overlay at all".
    return this.overlayArt.stats ?? {
      mode: "vector", footprint: 0, blocked: 0, reach: 0, nodes: 0,
      loops: 0, ghost: null, ghostDrawn: false,
    };
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

  /**
   * SCENERY: install the map's decal list (from `scatterScenery`). The trees
   * travel on the World instead — the draw list reads them per tile.
   */
  setDecals(scenery: Scenery | null): void {
    this.decals = scenery?.decals ?? null;
    this.terrainDirty = true;
  }

  /**
   * SCENERY: install the decal PNGs. Until these arrive the decal pass is a
   * no-op and the map is simply the plain meadow — art is an upgrade here,
   * never a gate, exactly like the ground textures.
   */
  setDecalImages(images: DecalImages | null): void {
    this.decalImages = images;
    this.terrainDirty = true;
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
      const phase = (v: number) => ((-v * z) % P + P) % P;
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
      (wx, wy) => [(wx - ox) * z, (wy - oy) * z],
    );
    this.groundChunkCache.set(key, surf);
    if (this.logRender) this.trace("ground-chunk-built", { chunk: [cx, cy], origin: [ox, oy], surface: [W, H], z, textured: !!this.ground });
    return surf;
  }

  /** Surf shares the ground contour, so corners and chunk joins stay aligned. */
  private drawShore(ctx: Ctx2D, cam: Camera, t: number) {
    paintShore(ctx, this.world.grid, t, cam.zoom,
      (wx, wy) => [wx * cam.zoom + cam.x, wy * cam.zoom + cam.y]);
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
        if (this.logRender) this.trace("ground-blit", { chunk: [cx, cy], origin: [ox, oy], screen: [Math.floor(sx), Math.floor(sy)], z: cam.zoom });
      }
    }
    // 3. The scenery decals: dirt scrapes and grass variation painted on the
    //    meadow. Above the chunks (they must not be clipped into 8×8 cuts),
    //    below the surf (a patch must never cover the foam).
    let decals = 0;
    if (this.decals && this.decalImages)
      decals = paintDecals(ctx, cam, this.decals, this.decalImages, r);
    // 4. The surf: shallow swell + foam along every coast edge, animated.
    this.drawShore(ctx, cam, timeMs);
    if (this.logRender) this.trace("terrain-pass", { range: [r.x0, r.y0, r.x1, r.y1], blits, decals, z: cam.zoom });
  }

  /**
   * The structures layer. When only traffic (or a multi-frame sprite) changed
   * since the last complete frame, the pass repaints just the DAMAGE: the old
   * and new screen bounds of each moving sprite, clipped, with the roads, the
   * shadows and every sprite intersecting those bounds redrawn in the same
   * depth order — so transparent edges and foreground occlusion come out
   * exactly as a full repaint would draw them. Anything else — a changed
   * static order (a lorry dragged into a cycle included), world, camera or
   * artwork — repaints the whole viewport. `forceFull` does that on demand
   * (for comparison) without dropping the placement cache.
   */
  drawStructures(timeMs = 0, forceFull = false) {
    const ctx = this.ctxS, cam = this.cam;
    const r = visibleTileRange(cam, this.pad);
    const textured = this.roadMode === "textured";
    let full = forceFull || this.structuresDirty || !this.paintedValid;
    // Static geometry only changes on existing world/art/tile invalidation
    // paths or a changed visible range. Never cache vehicles: the game replaces
    // that list every frame without setWorld(). Keep their original tail order
    // so stable Tier-1 ties still behave exactly as before.
    const rangeKey = `${r.x0}:${r.y0}:${r.x1}:${r.y1}`;
    if (this.structuresDirty || rangeKey !== this.staticRange) {
      const items = buildDrawList(this.world, r, { roads: !textured, vehicles: false });
      this.staticItemCount = items.length;
      this.staticPlaced = items.map((i) => place(this.atlas, i)).filter((p): p is Placed => p !== null);
      this.staticRange = rangeKey;
      full = true;
    }
    const placed = this.staticPlaced.slice();
    let itemCount = this.staticItemCount;
    for (const v of this.world.vehicles ?? []) {
      if (v.tx < r.x0 - 4 || v.tx > r.x1 + 4 || v.ty < r.y0 - 4 || v.ty > r.y1 + 4) continue;
      itemCount++;
      const p = place(this.atlas, v);
      if (p) placed.push(p);
    }
    this.hadVehicles = (this.world.vehicles?.length ?? 0) > 0;
    const sorted = depthSort(placed);
    const { order } = sorted;
    this.lastOrder = order;
    this.lastCycles = sorted.cycles;

    // What moved since the last frame: every moving sprite, and each animated
    // static sprite whose frame index changed.
    const staticOrder: Placed[] = [];
    const movingRects: ScreenRect[] = [];
    const frames = new Map<Placed, number>();
    const damage: ScreenRect[] = [];
    for (const p of order) {
      if (isMoving(p)) { movingRects.push(this.screenRect(p)); continue; }
      staticOrder.push(p);
      if ((p.def.frames ?? 1) > 1) {
        const f = p.frame ?? this.atlas.frameAt(p.def, timeMs);
        frames.set(p, f);
        if (this.lastFrames.get(p) !== f) damage.push(this.screenRect(p));
      }
    }
    if (!full && (sorted.cycles.length > 0 || !sameOrder(staticOrder, this.lastStaticOrder))) full = true;
    if (!full) damage.push(...this.lastMovingRects, ...movingRects);
    this.lastStaticOrder = staticOrder;
    this.lastMovingRects = movingRects;
    this.lastFrames = frames;

    const paintRoads = () => {
      // Roads are flat, so they go down first, under every elevated thing —
      // and above the terrain canvas entirely, which is what keeps their
      // transparent verges showing the real decals and grass underneath.
      this.roadBlits = textured
        ? this.roadCache.paint(ctx, cam, this.world, this.roadStyle, (w, h) => makeSurface(w, h))
        : 0;
    };
    // Contact shadows go down between the roads and the first sprite: they
    // are ground, so they may darken the asphalt a building stands beside
    // but must never land on a building, a tree or a passing lorry.
    const paintShadows = () => paintBuildingShadows(
      ctx, cam, order, this.shadowStamps, (w, h) => makeSurface(w, h));
    let shadows = 0, blits = 0, damageRects = 0;
    if (full) {
      ctx.clearRect(0, 0, cam.vw, cam.vh);
      paintRoads();
      shadows = paintShadows();
      for (const p of order) if (this.blit(ctx, p, timeMs)) blits++;
      this.paintedValid = true;
    } else {
      // Off-screen traffic leaves a still viewport untouched.
      const rects = clampRects(damage, cam.vw, cam.vh);
      damageRects = rects.length;
      if (rects.length) {
        ctx.save();
        ctx.beginPath();
        for (const d of rects) {
          ctx.clearRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
          ctx.rect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
        }
        ctx.clip();
        paintRoads();
        shadows = paintShadows();
        for (const p of order) {
          const box = this.screenRect(p);
          if (!rects.some((d) => rectsOverlap(box, d))) continue;
          if (this.blit(ctx, p, timeMs)) blits++;
        }
        ctx.restore();
      } else {
        this.roadBlits = 0;
      }
    }
    this.repaint = { full, blits, damageRects };
    if (this.logRender) this.trace("structures-pass", {
      z: cam.zoom, range: [r.x0, r.y0, r.x1, r.y1],
      items: itemCount, placed: placed.length, shadows, cycles: sorted.cycles,
      repaint: this.repaint,
      order: order.map((p) => ({ sprite: p.sprite, tile: [p.tx, p.ty], key: p.key })),
    });
    this.structuresDirty = false;
  }

  /**
   * Integer screen bounds a sprite's blit can touch, padded a pixel each way
   * for the zoomed source rect's rounding.
   */
  private screenRect(p: Placed): ScreenRect {
    const z = this.cam.zoom;
    const [sx, sy] = worldToScreen(this.cam, p.wx, p.wy);
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    return { x0: x0 - 1, y0: y0 - 1, x1: x0 + Math.ceil(p.w * z) + 1, y1: y0 + Math.ceil(p.h * z) + 1 };
  }

  /** Overlay: cheap, cleared and redrawn every frame. */
  /**
   * Overlay: cheap, cleared and redrawn every frame.
   *
   * In `vector` mode the four placement roles (`highlight`, `highlight_bad`,
   * `highlight_soft`, `node_mark`) are painted as geometry by `overlay-art.ts`
   * — one outline around the whole tile set instead of a diamond per tile —
   * and `ghost` adds the transparent preview of the building being placed.
   * Anything else on the list is still blitted from the atlas, and in
   * `sprites` mode the whole list is, exactly as before.
   */
  drawOverlay(items: DrawItem[] = [], timeMs = 0, ghost: GhostSpec | null = null) {
    const ctx = this.ctxO, cam = this.cam;
    ctx.clearRect(0, 0, cam.vw, cam.vh);
    const vector = this.highlightMode === "vector";
    const { scene, rest } = vector
      ? sceneFromItems(items)
      : { scene: null, rest: items };
    if (scene) {
      this.overlayArt.paint(ctx, cam, this.atlas, scene, ghost, timeMs, makeSurface);
    }
    this.overlayBlits = rest.length;
    const placed = rest.map((i) => place(this.atlas, i)).filter(Boolean) as Placed[];
    for (const p of depthSort(placed).order) this.blit(ctx, p, timeMs);
    // C5: the debug marks are drawn last so they sit above every preview glow.
    if (this.debugPainter) this.debugPainter(ctx, cam);
    // Protests go above even those — the crowd is the thing on the road.
    if (this.overlayPainter) this.overlayPainter(ctx, cam, timeMs);
  }

  /**
   * ART-1950S (TICKET-B4): every sprite name actually handed to blit() this
   * session — industries, depots, town houses, roads, dirt, trucks, extras.
   * The dead-art audit unions this observed set with the by-construction
   * families (road/dirt bitmasks, depot_<cargo>, TOWN_HOUSE_VARIANTS) to
   * derive deletion candidates; a naive grep reports 149 of 239 sprites as
   * "unused" because most names are built at runtime. Ground tiles are
   * pattern-painted, not blitted, so terrain_* never appears here (they are
   * enumerated by construction instead). Cleared never; it is a Set of
   * strings, cheap to hold.
   */
  readonly drawnSprites = new Set<string>();

  /** Draw one placed sprite; false when its image is not loaded. */
  private blit(ctx: Ctx2D, p: Placed, timeMs: number): boolean {
    const z = this.cam.zoom;
    // W-series: roads blit from the ROADS atlas, buildings from the BUILDINGS
    // atlas (separate PNG layer atlases, identical rect layout); anything
    // else falls back to the monolithic image (layer sets unloaded).
    const img = this.atlas.imageForSprite(p.sprite, z);
    if (!img) return false;
    this.drawnSprites.add(p.sprite);
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
    if (this.logRender) this.trace("blit", {
      sprite: p.sprite, tile: [p.tx, p.ty], def: p.def,
      z, context: p.ref != null ? "world" : "overlay",
      anchor: p.def.anchor, world: [p.wx, p.wy],
      screen: [Math.floor(sx), Math.floor(sy)],
      src, dest: [Math.floor(sx), Math.floor(sy), src.w, src.h],
      depthKey: p.key,
    });
    return true;
  }

  /**
   * One frame. The terrain layer animates — the ocean drifts and the surf
   * breathes — but slowly, so its ambient repaint is capped at ~30 Hz
   * (`TERRAIN_FRAME_MS`); a camera, world or art change repaints it on the
   * very next frame. Its static island is chunk-cached either way. Structures
   * redraw only when dirty or animated, and the overlay every frame.
   */
  render(timeMs = 0, overlay: DrawItem[] = [], ghost: GhostSpec | null = null) {
    const since = timeMs - this.lastTerrainT;
    if (this.terrainDirty || since < 0 || since >= TERRAIN_FRAME_MS - TERRAIN_FRAME_SLACK_MS) {
      this.terrainDirty = false;
      this.lastTerrainT = timeMs;
      this.drawTerrain(timeMs);
    }
    if (this.structuresDirty || this.hasAnimation()) this.drawStructures(timeMs);
    this.drawOverlay(overlay, timeMs, ghost);
  }

  private hasAnimation(): boolean {
    // RV-01: a truck somewhere on the map moves every frame, so the sorted
    // structures pass (which depth-sorts it among the buildings) must run.
    // Also clear the last drawn truck when the traffic list becomes empty.
    if (this.hadVehicles || (this.world.vehicles?.length ?? 0) > 0) return true;
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
      roads: this.roadDiagnostics(),
      overlay: this.overlayDiagnostics(),
      repaint: { ...this.repaint },
      groundAnchorReference,
      depthCycles: this.lastCycles,
      structures,
      sourceRect,
      warnings,
    };
  }
}

/** Same placements in the same order, by identity. */
function sameOrder(a: Placed[], b: Placed[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Clamp damage to the viewport, dropping anything wholly off-screen. */
function clampRects(rects: ScreenRect[], vw: number, vh: number): ScreenRect[] {
  const out: ScreenRect[] = [];
  for (const d of rects) {
    const x0 = Math.max(0, d.x0), y0 = Math.max(0, d.y0);
    const x1 = Math.min(Math.ceil(vw), d.x1), y1 = Math.min(Math.ceil(vh), d.y1);
    if (x0 < x1 && y0 < y1) out.push({ x0, y0, x1, y1 });
  }
  return out;
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
