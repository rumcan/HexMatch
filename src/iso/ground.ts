// ══════════════════════════════════════════════════════════════════════════
// W-series — Terrain overhaul: pattern-painted ground.
//
// The old ground was a per-tile sprite puzzle (terrain_grass/water/rough
// diamonds from the shared atlas). This module replaces it with ONE
// continuously painted landscape:
//
//   • the whole map diamond sits on an ANIMATED OCEAN — the seamless water
//     texture scrolls as a canvas pattern anchored to world space, so it
//     pans with the camera and drifts on its own;
//   • the island's land tiles are filled with the seamless grass texture,
//     again world-anchored — adjacent tiles read as one painted meadow with
//     zero per-tile seams (the "puzzle" is gone);
//   • connected, rounded land and inland contours reveal a continuous beach;
//   • shallow-water bands and animated foam follow that same coast path.
//     No separate sand stamps or tinted water diamonds remain.
//
// Everything is a pure function of (grid, camera, time). Textures are the
// seamless 512×512 PNGs in assets/ground/ (tools/make-ground-textures.mjs).
// ══════════════════════════════════════════════════════════════════════════
import { HW, HH, TILE_H, tileToScreen } from "../game/config";
import { GRASS, SAND, WATER, type Grid } from "./grid";
import type { AtlasImage } from "./atlas";
import { traceCoast, type CoastPoint } from "./coastline";

export const GROUND_TEX_SIZE = 512;

export interface GroundTextures {
  grass: AtlasImage;
  sand: AtlasImage;
  water: AtlasImage;
  /** R1 (#260): the fresh-water texture for rivers; optional so old callers stay valid. */
  river?: AtlasImage;
}

/** Per-zoom canvas patterns for the ground textures. */
export interface GroundPatterns {
  grass: CanvasPattern;
  sand: CanvasPattern;
  water: CanvasPattern;
  river?: CanvasPattern;
}

/**
 * R1 (#260): the river fill the ground paint uses. The renderer's chunk call
 * hands `paintGroundTiles` only grass/sand, so `createGroundPatterns` parks
 * the river pattern here where the paint can find it. Null until textures load
 * (or in stubbed-canvas contexts), and the paint falls back to a flat colour.
 */
let riverFillPattern: CanvasPattern | null = null;
/** Test/debug access to the installed river pattern. */
export const riverPattern = (): CanvasPattern | null => riverFillPattern;

/** The four diamond corners of tile (tx,ty) in world space (1×), clockwise from the top vertex. */
export function tileDiamondWorld(tx: number, ty: number): [number, number][] {
  const [x, y] = tileToScreen(tx, ty);
  return [
    [x, y],                    // N (top vertex)
    [x + HW, y + HH],          // E
    [x, y + TILE_H],           // S (bottom vertex)
    [x - HW, y + HH],          // W
  ];
}

/** Scale a polygon toward its centroid by factor `s` (sand inset). */
export function insetPolygon(pts: [number, number][], s: number): [number, number][] {
  let cx = 0, cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  cx /= pts.length; cy /= pts.length;
  return pts.map(([x, y]) => [cx + (x - cx) * s, cy + (y - cy) * s] as [number, number]);
}

/**
 * Sand inset as a fraction of the diamond. 1 = full tiles: the beach is a
 * connected golden terrace — perfect diamond edges at the sea (foam kisses
 * them), a crisp scalloped staircase inland. Below 1 the ring dissolves into
 * scattered squares; keep it at 1.
 */
export const SAND_INSET = 1;

/**
 * Path a list of world-space polygons onto `ctx` (already in the space the
 * points live in). Shared edges of adjacent diamonds are traversed in
 * opposite directions, so one `fill()` call over a batch of tiles has no
 * interior hairline — but we still stroke the outline at 1px because two
 * SEPARATE fill() calls (grass, then sand) meet antialiased edges.
 */
export function pathPolygons(ctx: CanvasRenderingContext2D, polys: [number, number][][]): void {
  ctx.beginPath();
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [x, y] = poly[i];
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}

/**
 * Project world-space (1×) coordinates to the paint space of the target
 * context. Preserve subpixel curve coordinates; only the final cache blit
 * snaps to a device pixel. Callers painting whole scenes pass the identity.
 */
export type GroundProject = (wx: number, wy: number) => [number, number];

export const identityProject: GroundProject = (wx, wy) => [wx, wy];

/**
 * The static parts of the ground for a tile range, painted through `project`.
 * Water tiles are skipped — the animated ocean pass shows through them. The
 * caller must have world-anchored any pattern transforms BEFORE calling
 * (patterns share the paint space).
 */
export function paintGroundTiles(
  ctx: CanvasRenderingContext2D,
  grid: Grid,
  tx0: number, ty0: number, tx1: number, ty1: number,
  patterns: { grass: string | CanvasPattern; sand: string | CanvasPattern },
  project: GroundProject = identityProject,
): void {
  const coast = groundContours(grid);
  // Clip the SAME world contours into each cache surface. The tiny overlap
  // seals antialiased chunk joins; it never changes the outer coastline.
  const pad = .04;
  const corners = [[tx0 - pad, ty0 - pad], [tx1 + 1 + pad, ty0 - pad],
    [tx1 + 1 + pad, ty1 + 1 + pad], [tx0 - pad, ty1 + 1 + pad]];
  ctx.save();
  pathPolygons(ctx, [corners.map(([x, y]) => project(...tileToScreen(x, y)))]);
  ctx.clip();
  const paint = (loops: CoastPoint[][], fill: string | CanvasPattern) => {
    pathPolygons(ctx, loops.map(loop => loop.map(p => project(...p))));
    ctx.fillStyle = fill;
    ctx.fill();
  };
  // Sand under the entire island; the rounded inland mask reveals a beach
  // between two continuous contours, including concave bays and corners.
  paint(coast.land, patterns.sand);
  paint(coast.inland, patterns.grass);
  // A narrow feather of the real grass texture softens the beach's inland
  // seam without an extra bitmap or a fringe of disconnected grass stamps.
  ctx.strokeStyle = patterns.grass;
  ctx.lineJoin = "round";
  const [px, py] = project(0, 0), [qx, qy] = project(1, 0);
  const scale = Math.hypot(qx - px, qy - py);
  for (const [width, alpha] of [[7, .12], [4, .2], [2, .28]] as const) {
    ctx.lineWidth = width * scale;
    ctx.globalAlpha = alpha;
    ctx.stroke();
  }
  paintRiverWater(ctx, grid, tx0, ty0, tx1, ty1, project, px, py, scale);
  ctx.restore();
}

/**
 * R1 (#260): the river's own water and banks. River tiles are WATER in the
 * terrain, so left alone they would show the animated open ocean; this paints
 * them with the seamless fresh-water texture (world-anchored, like the land
 * patterns, so joins between chunks line up) over the ocean, then strokes a
 * subtle dark bank along the edges a river shares with land. ONE batched fill
 * and two batched strokes per chunk — rivers add no per-frame cost (the chunk
 * is cached), which is what keeps the shore-stroke fps budget intact.
 */
function paintRiverWater(
  ctx: CanvasRenderingContext2D,
  grid: Grid,
  tx0: number, ty0: number, tx1: number, ty1: number,
  project: GroundProject,
  px: number, py: number, scale: number,
): void {
  const river = grid.rivers;
  if (!river) return;
  const diamonds: [number, number][][] = [];
  const banks: [number, number][][] = [];
  const isLand = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < grid.w && y < grid.h && grid.terrain[y * grid.w + x] !== WATER;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!river[ty * grid.w + tx]) continue;
      const corners = tileDiamondWorld(tx, ty).map(([x, y]) => project(x, y));
      diamonds.push(corners);
      // Shared edge with each land 4-neighbour: W(-1,0)=T–W, N(0,-1)=T–E,
      // E(+1,0)=E–S, S(0,1)=W–S (corners N,E,S,W = indices 0..3).
      const edge: [number, number][] = [[0, 3], [0, 1], [1, 2], [3, 2]];
      const dirs = [[-1, 0], [0, -1], [1, 0], [0, 1]];
      for (let d = 0; d < 4; d++) {
        if (!isLand(tx + dirs[d][0], ty + dirs[d][1])) continue;
        const [a, b] = edge[d];
        banks.push([corners[a], corners[b]]);
      }
    }
  }
  if (diamonds.length === 0) return;
  ctx.save();
  ctx.globalAlpha = 1;
  pathPolygons(ctx, diamonds);
  if (riverFillPattern) {
    const m = makeMatrix();
    m.translateSelf(px, py);
    m.scaleSelf(scale * RIVER_TEX_SCALE, scale * RIVER_TEX_SCALE);
    riverFillPattern.setTransform(m);
    ctx.fillStyle = riverFillPattern;
  } else {
    ctx.fillStyle = FALLBACK.river;
  }
  ctx.fill();
  if (banks.length) {
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (const [[ax, ay], [bx, by]] of banks) { ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
    ctx.strokeStyle = "rgba(24, 46, 40, 0.55)";
    ctx.lineWidth = 2.2 * scale;
    ctx.stroke();
    ctx.strokeStyle = "rgba(196, 232, 220, 0.28)";
    ctx.lineWidth = 1 * scale;
    ctx.stroke();
  }
  ctx.restore();
}

/** River texture grain — the same world scale the land textures paint at. */
const RIVER_TEX_SCALE = 0.2;

// ── PERF-01: the flat performance-mode ground ─────────────────────────────
/**
 * PERF-01: the muted flat palette for performance mode. Solid fills — no
 * textures, no patterns — so a painted chunk stays valid for the whole map's
 * life instead of one animation frame. Muted so buildings and the placement
 * glow read above it, and close to the textured palette's mid-tones so
 * toggling the mode does not flash the island a different colour.
 */
export const PERF_FLAT = {
  /** Flat blue under the island (the ocean, with its drift switched off). */
  water: "#1a5f7d",
  /** Flat sand terrace — the coast keeps the textured ground's shape. */
  sand: "#d9bd7f",
  /** Muted flat green land. */
  grass: "#6f7f4a",
  /** R1 (#260): flat fresh-water for rivers in performance mode. */
  river: "#2c7471",
  /** The subtle isometric build grid, stroked over the land only. */
  grid: "rgba(24, 32, 16, 0.16)",
};

export interface FlatGroundColors {
  grass: string;
  sand: string;
  grid: string;
  river?: string;
}

/**
 * PERF-01: the STATIC performance-mode ground for a tile range, painted
 * through `project`. Same contours as the textured ground (`groundContours`),
 * so the island and its beach keep their exact shape — only the paint is
 * flat: a solid sand terrace under the land, a solid muted-green meadow over
 * it, and ONE subtle isometric build grid (every tile diamond of the range,
 * plus a one-tile ring so the lines reach the chunk edges) stroked once,
 * clipped to the land so the water stays clean.
 *
 * No `time` parameter by construction: everything here is a function of
 * (grid, range) only, which is what makes the chunk it lands on cacheable
 * for good. The caller must be in the paint space the points project into
 * (the chunk surfaces do).
 */
export function paintFlatGroundTiles(
  ctx: CanvasRenderingContext2D,
  grid: Grid,
  tx0: number, ty0: number, tx1: number, ty1: number,
  colors: FlatGroundColors,
  project: GroundProject = identityProject,
): void {
  const coast = groundContours(grid);
  // The same tiny padded clip the textured ground uses: it seals
  // antialiased chunk joins without changing the outer coastline.
  const pad = .04;
  const corners: [number, number][] = [[tx0 - pad, ty0 - pad], [tx1 + 1 + pad, ty0 - pad],
    [tx1 + 1 + pad, ty1 + 1 + pad], [tx0 - pad, ty1 + pad]];
  ctx.save();
  pathPolygons(ctx, [corners.map(([x, y]) => project(...tileToScreen(x, y)))]);
  ctx.clip();
  const loops = (loops: CoastPoint[][]) => loops.map((l) => l.map((p) => project(...p)));
  // Sand under the entire island, grass over the inland mask — the rounded
  // beach ring between the two contours, exactly as in the textured paint.
  pathPolygons(ctx, loops(coast.land));
  ctx.fillStyle = colors.sand;
  ctx.fill();
  pathPolygons(ctx, loops(coast.inland));
  ctx.fillStyle = colors.grass;
  ctx.fill();
  // R1 (#260): rivers get a solid fresh-water fill in performance mode (the
  // flat path has no textures). Water tiles are transparent elsewhere, so the
  // diamonds are exactly the river.
  if (grid.rivers) {
    const diamonds: [number, number][][] = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (!grid.rivers[ty * grid.w + tx]) continue;
      diamonds.push(tileDiamondWorld(tx, ty).map(([x, y]) => project(x, y)));
    }
    if (diamonds.length) {
      pathPolygons(ctx, diamonds);
      ctx.fillStyle = colors.river ?? PERF_FLAT.river;
      ctx.fill();
    }
  }
  // The build grid: one path over every tile diamond in the range (ringed),
  // one stroke, clipped to the land so the grid never crosses the water.
  // 1px in paint space — it scales with the chunk's zoom, so the line stays
  // one tile-fraction wide on screen at every zoom step.
  ctx.save();
  pathPolygons(ctx, loops(coast.land));
  ctx.clip();
  const diamonds: [number, number][][] = [];
  for (let ty = ty0 - 1; ty <= ty1 + 1; ty++) {
    for (let tx = tx0 - 1; tx <= tx1 + 1; tx++) {
      diamonds.push(tileDiamondWorld(tx, ty).map(([x, y]) => project(x, y)));
    }
  }
  pathPolygons(ctx, diamonds);
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

export interface GroundContours {
  land: CoastPoint[][];
  inland: CoastPoint[][];
  /**
   * R1 (#260): the OUTER sea coast with river tiles treated as land, so the
   * ocean's surf/foam bands follow only the true coastline and never stroke
   * the long banks of a river (which get their own, cheaper bank stroke).
   */
  coast: CoastPoint[][];
}
const contourCache = new WeakMap<Grid, GroundContours>();
export function groundContours(grid: Grid): GroundContours {
  let coast = contourCache.get(grid);
  if (!coast) {
    const river = grid.rivers;
    const isRiver = (x: number, y: number) =>
      !!river && x >= 0 && y >= 0 && x < grid.w && y < grid.h && river[y * grid.w + x] !== 0;
    coast = {
      land: traceCoast(grid.w, grid.h, (x, y) => grid.terrain[y * grid.w + x] !== WATER),
      inland: traceCoast(grid.w, grid.h, (x, y) => {
        const v = grid.terrain[y * grid.w + x];
        return v !== WATER && v !== SAND;
      }),
      coast: traceCoast(grid.w, grid.h, (x, y) =>
        grid.terrain[y * grid.w + x] !== WATER || isRiver(x, y)),
    };
    contourCache.set(grid, coast);
  }
  return coast;
}
export function invalidateGroundContours(grid: Grid): void { contourCache.delete(grid); }

/** Soft surf bands follow the exact land contour, never whole water diamonds. */
export function paintShore(
  ctx: CanvasRenderingContext2D, grid: Grid, t: number, zoom: number,
  project: GroundProject = identityProject,
): void {
  ctx.save();
  // R1 (#260): surf follows the OUTER coast only (rivers read as land for this
  // contour), so the broad ocean shelf bands never swallow a narrow river.
  pathPolygons(ctx, groundContours(grid).coast.map(loop => loop.map(p => project(...p))));
  ctx.lineJoin = "round";
  // Broad translucent bands feather the shelf into the animated ocean.
  for (const [width, alpha] of [[18, .035], [12, .055], [7, .09]] as const) {
    ctx.strokeStyle = `rgba(${SHALLOW_RGB},${alpha})`;
    ctx.lineWidth = width * zoom;
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(100,77,43,0.20)";
  ctx.lineWidth = 3.5 * zoom;
  ctx.stroke();
  ctx.strokeStyle = `rgba(${FOAM_RGB},${.32 + .1 * Math.sin(t * .0016)})`;
  ctx.lineWidth = (1.2 + .25 * Math.sin(t * .002)) * zoom;
  ctx.stroke();
  ctx.restore();
}

// ── shoreline ───────────────────────────────────────────────────────────────
export interface ShoreTile {
  tx: number;
  ty: number;
  /** World-space foam segments — the edges this water tile shares with land. */
  edges: [[number, number], [number, number]][];
}

/**
 * The diamond edge shared with each 4-neighbour, as world-space segments.
 * Direction order: W (-1,0), N (0,-1), E (+1,0), S (0,+1) — matching the
 * corners of tileDiamondWorld.
 */
const EDGE_BY_DIR: Record<string, [number, number]> = {};
{
  // neighbour (tx-1,ty) shares T–W; (tx,ty-1) shares T–E; (tx+1,ty) shares E–S; (tx,ty+1) shares W–S
  EDGE_BY_DIR["-1,0"] = [0, 3];
  EDGE_BY_DIR["0,-1"] = [0, 1];
  EDGE_BY_DIR["1,0"] = [1, 2];
  EDGE_BY_DIR["0,1"] = [3, 2];
}

/**
 * Water tiles that touch land, with their foam edges. The terrain never
 * changes at runtime (only ROUGH→GRASS flattening, which cannot touch a
 * coast), so this is computed once per map.
 */
export function computeShore(grid: Grid): ShoreTile[] {
  const out: ShoreTile[] = [];
  const isLand = (tx: number, ty: number) => {
    if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) return false;
    return grid.terrain[ty * grid.w + tx] !== WATER;
  };
  for (let ty = 0; ty < grid.h; ty++) {
    for (let tx = 0; tx < grid.w; tx++) {
      if (grid.terrain[ty * grid.w + tx] !== WATER) continue;
      let any = false;
      for (let dy = -1; dy <= 1 && !any; dy++)
        for (let dx = -1; dx <= 1 && !any; dx++)
          if ((dx || dy) && isLand(tx + dx, ty + dy)) any = true;
      if (!any) continue;
      const corners = tileDiamondWorld(tx, ty);
      const edges: ShoreTile["edges"] = [];
      for (const [dx, dy] of [[-1, 0], [0, -1], [1, 0], [0, 1]] as const) {
        if (!isLand(tx + dx, ty + dy)) continue;
        const [a, b] = EDGE_BY_DIR[`${dx},${dy}`];
        edges.push([corners[a], corners[b]]);
      }
      out.push({ tx, ty, edges });
    }
  }
  return out;
}

/** Stable per-tile animation phase so the surf shimmers, not blinks. */
export const shorePhase = (tx: number, ty: number) => tx * 0.9 + ty * 1.7;

/**
 * Shallow-water tint alpha for one shore tile at time `t` (ms).
 * Slow swell: one breath roughly every 4 seconds, phase-shifted per tile.
 */
export const shallowAlpha = (t: number, tx: number, ty: number) =>
  0.14 + 0.05 * Math.sin(t * 0.0016 + shorePhase(tx, ty));

/** Foam stroke alpha — faster than the swell, out of phase with it. */
export const foamAlpha = (t: number, tx: number, ty: number) =>
  0.36 + 0.24 * Math.sin(t * 0.004 + shorePhase(tx, ty) * 1.3);

/** Foam stroke width in world pixels. */
export const foamWidth = (t: number, tx: number, ty: number) =>
  2.1 + 0.9 * Math.sin(t * 0.0031 + shorePhase(tx, ty) * 0.7);

/** Shallow-shelf tint over the ocean pattern, as "r,g,b" (alpha per tile). */
export const SHALLOW_RGB = "151,225,214";
/** Foam stroke colour, as "r,g,b" (alpha per tile). */
export const FOAM_RGB = "255,244,214";

/** Fallback flat colours when ground textures are not (yet) available. */
export const FALLBACK = {
  water: "#155e70",
  grass: "#6d7c42",
  sand: "#d9b36c",
  river: "#2c7471",
};

/**
 * Ocean pattern transform for the terrain canvas: the texture is anchored to
 * WORLD space (pans with the camera) and drifts on its own — the animated
 * sea. `t` is the frame time in ms; the drift wraps at one texture period.
 *
 * GFX-01 terrain LOD: `texScale` is GROUND_TEX_SIZE ÷ the loaded texture's
 * width (2 for the medium tier, 4 for low). It stretches the pattern so a
 * smaller copy covers the same world area; the drift and its wrap period are
 * world terms and do not change with the tier.
 *
 * Optimized path: pre-compute the scaled zoom and period once so the per-frame
 * matrix only calculates the drift offset (two modulo operations) and applies
 * the pre-computed scale.
 */
export function oceanMatrix(
  cam: { x: number; y: number; zoom: number },
  t: number,
  scale = 1,
  texScale = 1,
): DOMMatrix {
  const z = cam.zoom * scale;
  const period = GROUND_TEX_SIZE * z;
  // Pre-compute the scaled texture size for faster matrix application.
  const sz = z * texScale;
  const dx = cam.x + ((t * 0.0022 * z) % period);
  const dy = cam.y + ((t * 0.0014 * z) % period);
  const m = makeMatrix();
  m.translateSelf(dx, dy);
  m.scaleSelf(sz, sz);
  return m;
}

/**
 * DOMMatrix where it exists (browsers), a minimal {e,f,m11,m22} stand-in
 * where it doesn't (Node unit tests — the matrix only ever feeds
 * CanvasPattern.setTransform, which only runs in a browser).
 */
export function makeMatrix(): DOMMatrix {
  const g = globalThis as { DOMMatrix?: typeof DOMMatrix };
  if (g.DOMMatrix) return new g.DOMMatrix();
  const stub = {
    m11: 1, m12: 0, m21: 0, m22: 1, e: 0, f: 0,
    translateSelf(x: number, y: number) { this.e += x; this.f += y; return this; },
    scaleSelf(x: number, y?: number) { this.m11 *= x; this.m22 *= y ?? x; return this; },
  };
  return stub as unknown as DOMMatrix;
}

/** Load the seamless ground textures in a browser (river optional). */
export async function loadGroundTextures(
  urls: { grass: string; sand: string; water: string; river?: string },
): Promise<GroundTextures> {
  const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
  const [grass, sand, water, river] = await Promise.all([
    load(urls.grass), load(urls.sand), load(urls.water),
    urls.river ? load(urls.river).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  return { grass, sand, water, river };
}

/** Build the per-zoom patterns (call on zoom change / texture load). */
export function createGroundPatterns(
  ctx: CanvasRenderingContext2D,
  tex: GroundTextures,
): GroundPatterns {
  const pat = (img: AtlasImage) => {
    const p = ctx.createPattern(img as unknown as CanvasImageSource, "repeat");
    if (!p) throw new Error("createPattern failed for ground texture");
    return p;
  };
  // Park the river fill for `paintGroundTiles` (the renderer's chunk call only
  // forwards grass/sand). A context without the river texture yields null.
  riverFillPattern = tex.river
    ? ctx.createPattern(tex.river as unknown as CanvasImageSource, "repeat")
    : null;
  return {
    grass: pat(tex.grass), sand: pat(tex.sand), water: pat(tex.water),
    river: riverFillPattern ?? undefined,
  };
}

/** GRASS re-exported for callers that classify land vs water. */
export const isLandTerrain = (v: number) => v === GRASS || v === 2 /* ROUGH */ || v === 3 /* SAND */;
