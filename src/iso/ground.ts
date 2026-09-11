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
//   • SAND tiles (the beach ring hugging the coastline, see grid.ts) get an
//     inset diamond of the seamless sand texture on top of the grass, so the
//     island is lined with an organic golden beach edge;
//   • the shoreline (water tiles that touch land) gets a shallow-water tint
//     and animated foam strokes along each shared edge — two out-of-phase
//     sine waves per tile so the surf shimmers instead of blinking.
//
// Everything is a pure function of (grid, camera, time). Textures are the
// seamless 512×512 PNGs in assets/ground/ (tools/make-ground-textures.mjs).
// ══════════════════════════════════════════════════════════════════════════
import { HW, HH, TILE_H, tileToScreen } from "../game/config";
import { GRASS, WATER, type Grid } from "./grid";
import type { AtlasImage } from "./atlas";

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

/** Sand inset as a fraction of the diamond (grass peeks past the beach). */
export const SAND_INSET = 0.86;

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
 * The static parts of one chunk of ground, painted in WORLD space (caller
 * has set the transform). Water tiles are skipped — the animated ocean pass
 * shows through them.
 */
export function paintGroundTiles(
  ctx: CanvasRenderingContext2D,
  grid: Grid,
  tx0: number, ty0: number, tx1: number, ty1: number,
  patterns: { grass: string | CanvasPattern; sand: string | CanvasPattern },
): void {
  const grassPolys: [number, number][][] = [];
  const sandPolys: [number, number][][] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const v = grid.terrain[ty * grid.w + tx];
      if (v === WATER) continue;
      grassPolys.push(tileDiamondWorld(tx, ty));
      if (v === SAND)
        sandPolys.push(insetPolygon(tileDiamondWorld(tx, ty), SAND_INSET));
    }
  }
  if (!grassPolys.length) return;
  // Grass under everything (full diamonds — adjacent fills share edges and
  // opposite winding keeps the union seamless), then the beach ring on top.
  pathPolygons(ctx, grassPolys);
  ctx.fillStyle = patterns.grass;
  ctx.fill();
  ctx.strokeStyle = patterns.grass;
  ctx.lineWidth = 1;
  ctx.stroke();                       // hairline seal against AA cracks
  if (sandPolys.length) {
    pathPolygons(ctx, sandPolys);
    ctx.fillStyle = patterns.sand;
    ctx.fill();
    ctx.strokeStyle = patterns.sand;
    ctx.stroke();
  }
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

/** Fill colour of the shallow shelf over the ocean pattern. */
export const SHALLOW_RGBA = "rgba(151,225,214,1)";   // alpha applied per tile

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
 */
export function oceanMatrix(
  cam: { x: number; y: number; zoom: number },
  t: number,
): DOMMatrix {
  const z = cam.zoom;
  const period = GROUND_TEX_SIZE * z;
  const dx = cam.x + ((t * 0.0022 * z) % period);
  const dy = cam.y + ((t * 0.0014 * z) % period);
  const m = new DOMMatrix();
  m.translateSelf(dx, dy);
  m.scaleSelf(z, z);
  return m;
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
