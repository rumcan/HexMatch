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
}

/** Per-zoom canvas patterns for the three ground textures. */
export interface GroundPatterns {
  grass: CanvasPattern;
  sand: CanvasPattern;
  water: CanvasPattern;
}

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
  ctx.restore();
}

export interface GroundContours { land: CoastPoint[][]; inland: CoastPoint[][] }
const contourCache = new WeakMap<Grid, GroundContours>();
export function groundContours(grid: Grid): GroundContours {
  let coast = contourCache.get(grid);
  if (!coast) {
    coast = {
      land: traceCoast(grid.w, grid.h, (x, y) => grid.terrain[y * grid.w + x] !== WATER),
      inland: traceCoast(grid.w, grid.h, (x, y) => {
        const v = grid.terrain[y * grid.w + x];
        return v !== WATER && v !== SAND;
      }),
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
  pathPolygons(ctx, groundContours(grid).land.map(loop => loop.map(p => project(...p))));
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
 */
export function oceanMatrix(
  cam: { x: number; y: number; zoom: number },
  t: number,
  scale = 1,
  texScale = 1,
): DOMMatrix {
  const z = cam.zoom * scale;
  const period = GROUND_TEX_SIZE * z;
  const dx = cam.x + ((t * 0.0022 * z) % period);
  const dy = cam.y + ((t * 0.0014 * z) % period);
  const m = makeMatrix();
  m.translateSelf(dx, dy);
  m.scaleSelf(z * texScale, z * texScale);
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

/** Load the three seamless ground textures in a browser. */
export async function loadGroundTextures(
  urls: { grass: string; sand: string; water: string },
): Promise<GroundTextures> {
  const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
  const [grass, sand, water] = await Promise.all([
    load(urls.grass), load(urls.sand), load(urls.water),
  ]);
  return { grass, sand, water };
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
  return { grass: pat(tex.grass), sand: pat(tex.sand), water: pat(tex.water) };
}

/** GRASS re-exported for callers that classify land vs water. */
export const isLandTerrain = (v: number) => v === GRASS || v === 2 /* ROUGH */ || v === 3 /* SAND */;
