// ══════════════════════════════════════════════════════════════════════════
// E2 (#267) — the elevation SURFACE: one corner-height lattice, the lift, the
// drape every painter uses, and the slope shading.
//
// E1 (#261) put a level per TILE on the map (`Grid.height`, 0–4, neighbours
// within one level, sea and rivers pinned at 0). Drawing that needs a level per
// CORNER, because a tile whose four corners disagree is a slope and a tile
// whose corners agree is flat. This module derives that corner lattice ONCE per
// map and is the single source of truth for "how high is the ground here" —
// the ground paint, the road/rail/bridge painters and (in #269) the objects
// that stand on it all read the same numbers, so nothing can float or sink
// against anything else.
//
// THE LATTICE IS THE MINIMUM OF THE TILES THAT MEET AT A CORNER. That one rule
// buys four properties, each of which the alternatives lose:
//
//   1. SINGLE-VALUED AND CONTINUOUS. A corner belongs to up to four tiles and
//      gets one height, so two adjacent tiles always draw the same edge at the
//      same place: the surface has no cracks, no cliffs to fall through, and a
//      road or a rail draped on it needs no special case at a tile boundary.
//   2. THE COAST MEETS THE WATER AT LEVEL 0. Sea and river tiles are height 0,
//      so every corner they touch is 0 too, and the land beside them ramps down
//      to the waterline — exactly where `paintShore` strokes its foam, which is
//      drawn at height 0 and must not need lifting.
//   3. FLAT GROUND RENDERS AT ITS OWN LEVEL. Where a tile and its neighbours
//      agree — every town, every industry, every plateau the generator
//      flattened — the corners are that level, so the drawn surface is
//      `heightAt(tile) × LEVEL_PX` exactly. #269 can anchor a building on
//      `heightAt` and it will stand on the ground it was placed on.
//   4. EVERY TOP FACE IS DRAWABLE. Corner heights inside one tile differ by at
//      most one level (the generator's own constraint), so a tile is a flat
//      quad, a gentle slope or — rarely, ~7% of tiles — a saddle, which is
//      split into four triangles rather than left to fold.
//
// What MIN costs: a lone peak (one tile a level above all its neighbours)
// renders at its neighbours' level, so the generator's ±1 jitter reads as
// smooth ground rather than as a field of one-tile mesas. Hills still read —
// the island is a dome from the 0 coast shelf to the level-4 interior, and the
// ramp bands between them slope — and `slopeShade` below lights them.
//
// THE DRAPE. The road/rail painters stroke in the LOGICAL GROUND PLANE under
// one affine transform (X = (u−v)·HW, Y = (u+v)·HH), which is what keeps a
// road's width honest on both diagonals. A lift is a pure screen-Y
// displacement, and in that plane it is exactly a shift of BOTH ground axes by
// −lift/(2·HH): the X term (u−v) is unchanged and the Y term (u+v) drops by
// the lift. So draping the vectors is a change of the points, not of the
// transform — widths, joins, dash phases and the port contract all survive.
// `DRAPE_STEP` tessellates first, because a segment longer than that can cross
// a tile whose surface is not planar.
//
// EVERYTHING IS CACHED PER GRID and every function is the identity when the
// `elevation` map option is off: `elevationField` returns null for a grid with
// no height bytes (or all zeroes), `draperFor` hands back `FLAT_DRAPER`, and
// the painters draw byte-identically to the flat renderer they were before.
// ══════════════════════════════════════════════════════════════════════════
import { HW, HH } from "../game/config";
import type { Grid } from "./grid";

/** World pixels one elevation level raises the ground. TTD's own figure. */
export const LEVEL_PX = 8;
/** The highest level the generator produces (`makeElevation` clamps to 4). */
export const MAX_LEVEL = 4;
/** The tallest lift a chunk's cache surface must leave headroom for. */
export const MAX_LIFT_PX = MAX_LEVEL * LEVEL_PX;

/**
 * Ground-plane units one world pixel of lift costs, on EACH axis (see the
 * module header: the lift is a shift of both u and v, so the Y term doubles).
 */
export const LIFT_GROUND_PER_PX = 1 / (2 * HH);
/** LEVEL_PX expressed directly in ground units: 8 / 32 = exactly ¼ tile. */
export const LIFT_GROUND_PER_LEVEL = LEVEL_PX * LIFT_GROUND_PER_PX;

/**
 * How far a segment is chopped before it is draped, in tile units. A quarter
 * tile keeps a draped road within a fraction of a pixel of the bilinear
 * surface on the steepest slope the generator can produce (one level per tile).
 */
export const DRAPE_STEP = 0.25;

/** A point in the logical ground plane, in tile units. */
export type GroundPoint = readonly [number, number];

/**
 * The lift, as the painters take it: one object that raises a point or a whole
 * polyline onto the terrain. Always defined — `FLAT_DRAPER` is the identity, so
 * a painter never branches on "is elevation on", it just drapes.
 */
export interface Draper {
  /** One ground point, lifted (still in ground units). */
  point(u: number, v: number): GroundPoint;
  /**
   * A polyline, lifted: tessellated to `DRAPE_STEP` first, so a long run
   * follows the surface instead of cutting across a slope. Returns the SAME
   * array untouched when the ground is flat, which keeps the flat path
   * allocation-free and byte-identical.
   */
  path(points: readonly GroundPoint[]): readonly GroundPoint[];
  /** Is this draper doing anything at all? (Diagnostics and fast paths.) */
  readonly active: boolean;
}

/** The identity draper: what every painter uses with the option off. */
export const FLAT_DRAPER: Draper = {
  point: (u, v) => [u, v],
  path: (points) => points,
  active: false,
};

// ── the corner lattice ──────────────────────────────────────────────────────
/** The derived corner heights of one map, built once and cached per grid. */
export interface ElevationField {
  readonly w: number;
  readonly h: number;
  /** Corner heights on a (w+1)×(h+1) lattice, row-major from the map origin. */
  readonly corners: Uint8Array;
  /** The highest level on the map — how much headroom a cache surface needs. */
  readonly maxLevel: number;
}

const fields = new WeakMap<Grid, ElevationField | null>();

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function buildField(grid: Grid): ElevationField | null {
  const height = grid.height;
  const w = grid.w, h = grid.h;
  if (!height || !w || !h) return null;
  let maxLevel = 0;
  for (let i = 0; i < height.length && i < w * h; i++) {
    if (height[i] > maxLevel) maxLevel = height[i];
  }
  // Option OFF (or any flat map) is the identity, and must stay cheap: no
  // lattice, no draper, no second code path in any painter.
  if (maxLevel === 0) return null;
  const corners = new Uint8Array((w + 1) * (h + 1));
  for (let j = 0; j <= h; j++) {
    for (let i = 0; i <= w; i++) {
      // The corner (i,j) is shared by the four tiles whose origin is
      // (i−1..i, j−1..j). Out-of-map tiles are skipped, not read as 0, so the
      // map's border keeps its own level instead of ramping off the edge.
      let m = maxLevel;
      for (let dy = -1; dy <= 0; dy++) {
        for (let dx = -1; dx <= 0; dx++) {
          const x = i + dx, y = j + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const v = height[y * w + x];
          if (v < m) m = v;
        }
      }
      corners[j * (w + 1) + i] = m;
    }
  }
  return { w, h, corners, maxLevel };
}

/**
 * The map's corner lattice, or NULL when the ground is flat (no height bytes,
 * or every one of them zero — the option-off map). Cached per grid object, so
 * the painters may ask on every chunk they rasterise.
 */
export function elevationField(grid: Grid | null | undefined): ElevationField | null {
  if (!grid) return null;
  if (fields.has(grid)) return fields.get(grid) ?? null;
  const field = buildField(grid);
  fields.set(grid, field);
  return field;
}

/** Drop a cached lattice (a map whose heights were rewritten under us). */
export function invalidateElevation(grid: Grid): void { fields.delete(grid); }

/** Is elevation drawing ON for this map? The one question the renderer asks. */
export const elevationActive = (grid: Grid | null | undefined): boolean => !!elevationField(grid);

/**
 * How many world pixels of headroom a cache surface needs above the flat
 * projection so a raised chunk is never clipped: the map's own highest level.
 */
export const elevationLiftPx = (grid: Grid | null | undefined): number => {
  const f = elevationField(grid);
  return f ? f.maxLevel * LEVEL_PX : 0;
};

/** The corner height at lattice point (i,j), clamped to the map. */
export function cornerHeight(grid: Grid, i: number, j: number): number {
  const f = elevationField(grid);
  if (!f) return 0;
  const ii = clamp(Math.round(i), 0, f.w);
  const jj = clamp(Math.round(j), 0, f.h);
  return f.corners[jj * (f.w + 1) + ii];
}

/**
 * The surface height, in LEVELS, at any point of the ground plane: bilinear
 * over the four corners of the tile that contains it.
 *
 * Bilinear is the interpolation that makes the surface continuous across a tile
 * boundary without any negotiation between tiles: along a shared edge both
 * tiles interpolate between the same two corner heights, so they agree exactly,
 * and a road draped with this can never leave a step at a join.
 */
export function surfaceHeight(grid: Grid, u: number, v: number): number {
  const f = elevationField(grid);
  if (!f) return 0;
  const cu = clamp(u, 0, f.w), cv = clamp(v, 0, f.h);
  const i = Math.min(f.w - 1, Math.floor(cu)), j = Math.min(f.h - 1, Math.floor(cv));
  const fu = cu - i, fv = cv - j;
  const row = f.corners, stride = f.w + 1, k = j * stride + i;
  const h00 = row[k], h10 = row[k + 1], h01 = row[k + stride], h11 = row[k + stride + 1];
  return (1 - fu) * (1 - fv) * h00 + fu * (1 - fv) * h10
    + (1 - fu) * fv * h01 + fu * fv * h11;
}

/** A tile's four corner heights, in the diamond's own N, E, S, W order. */
export function tileCorners(grid: Grid, tx: number, ty: number): [number, number, number, number] {
  const f = elevationField(grid);
  if (!f) return [0, 0, 0, 0];
  const stride = f.w + 1;
  const i = clamp(tx, 0, f.w), j = clamp(ty, 0, f.h);
  const i1 = clamp(tx + 1, 0, f.w), j1 = clamp(ty + 1, 0, f.h);
  return [f.corners[j * stride + i], f.corners[j * stride + i1],
    f.corners[j1 * stride + i1], f.corners[j1 * stride + i]];
}

/**
 * The height the ground is DRAWN at in the middle of a tile, in levels.
 *
 * This is the anchor #269 wants: a building, a truck or a pick that stands on
 * tile (tx,ty) belongs at `tileSurfaceHeight × LEVEL_PX` above the flat
 * projection, not at `heightAt × LEVEL_PX`. On flat ground — every town and
 * industry footprint, and every plateau — the two are the same number; on a
 * slope the surface's centre is the average of the corners the tile is drawn
 * from, which is where the ground actually is.
 */
export function tileSurfaceHeight(grid: Grid, tx: number, ty: number): number {
  const [n, e, s, w] = tileCorners(grid, tx, ty);
  return (n + e + s + w) / 4;
}

/** World pixels the ground is lifted at a ground-plane point. */
export const liftAt = (grid: Grid, u: number, v: number): number =>
  surfaceHeight(grid, u, v) * LEVEL_PX;

/**
 * A ground-plane point projected to WORLD space and lifted onto the terrain:
 * the same `tileToScreen` the whole game uses, minus the lift.
 */
export function elevatedWorld(grid: Grid, u: number, v: number): [number, number] {
  return [(u - v) * HW, (u + v) * HH - liftAt(grid, u, v)];
}

/** The inverse of `tileToScreen`: projected world pixels → ground units. */
export const worldToGround = (wx: number, wy: number): [number, number] =>
  [wx / (2 * HW) + wy / (2 * HH), wy / (2 * HH) - wx / (2 * HW)];

/**
 * Lift a point that is already in world space (a traced coastline, a decal's
 * centre) onto the terrain. X is untouched; the lift is a screen-Y term.
 */
export function elevateWorldPoint(grid: Grid, wx: number, wy: number): [number, number] {
  const f = elevationField(grid);
  if (!f) return [wx, wy];
  const [u, v] = worldToGround(wx, wy);
  return [wx, wy - surfaceHeight(grid, u, v) * LEVEL_PX];
}

// ── the draper ──────────────────────────────────────────────────────────────
/**
 * Lift a polyline, tessellating each segment to `step` first.
 *
 * Endpoints are exact and shared: two tiles that meet at a port compute the
 * same draped port from either side (the draper is a pure function of the
 * ground point), so the port contract that keeps the flat roads seamless keeps
 * the draped ones seamless too.
 */
export function drapePath(
  points: readonly GroundPoint[],
  drape: (u: number, v: number) => GroundPoint,
  step = DRAPE_STEP,
): GroundPoint[] {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [drape(points[0][0], points[0][1])];
  const out: GroundPoint[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const [au, av] = points[i];
    const [bu, bv] = points[i + 1];
    const du = bu - au, dv = bv - av;
    const steps = Math.max(1, Math.ceil(Math.hypot(du, dv) / step - 1e-9));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push(drape(au + du * t, av + dv * t));
    }
  }
  out.push(drape(points[n - 1][0], points[n - 1][1]));
  return out;
}

/**
 * The draper for a map: the real one when elevation is on, `FLAT_DRAPER` when
 * it is not. Built once per grid and cached beside the lattice.
 */
const drapers = new WeakMap<Grid, Draper>();
export function draperFor(grid: Grid | null | undefined): Draper {
  if (!grid || !elevationField(grid)) return FLAT_DRAPER;
  const hit = drapers.get(grid);
  if (hit) return hit;
  const point = (u: number, v: number): GroundPoint => {
    const k = surfaceHeight(grid, u, v) * LIFT_GROUND_PER_LEVEL;
    return [u - k, v - k];
  };
  const draper: Draper = {
    point,
    path: (points) => drapePath(points, point),
    active: true,
  };
  drapers.set(grid, draper);
  return draper;
}

/** Drop a cached draper with its lattice. */
export function invalidateDraper(grid: Grid): void { drapers.delete(grid); }

// ── slope shading ───────────────────────────────────────────────────────────
/**
 * The light, as a unit vector TOWARDS the sun: from the screen's upper left
 * (the map's north-west) and above. Every shade below is measured against it,
 * so a slope that faces north-west is lit and its opposite is in shadow — the
 * convention the pixel-art buildings' own highlights already follow.
 */
export const LIGHT: readonly [number, number, number] = [-0.42, -0.5, 0.76];

/** The diffuse term of perfectly flat ground — the neutral the shade is read against. */
export const FLAT_SHADE = LIGHT[2];

/**
 * How lit a tile's top face is, as a signed number around 0: positive faces
 * the light, negative faces away. Roughly −0.30…+0.14 over the slopes the
 * generator can produce (one level per tile in any direction).
 *
 * The surface is treated as a real plane in (screen X, screen Y, height): the
 * two ground-plane tangents are (HW, HH, LEVEL_PX·∂h/∂u) and
 * (−HW, HH, LEVEL_PX·∂h/∂v), and their cross product is the normal the light
 * is measured against. The height gradients come from the tile's own corner
 * heights, so the shade is exactly as smooth as the surface it lights.
 */
export function slopeShade(corners: readonly [number, number, number, number]): number {
  const [hN, hE, hS, hW] = corners;
  // Edge midpoints: the height half way along each side of the diamond.
  const mN = (hN + hE) / 2, mE = (hE + hS) / 2, mS = (hS + hW) / 2, mW = (hN + hW) / 2;
  const zu = LEVEL_PX * (mE - mW);   // ∂height/∂u over one tile
  const zv = LEVEL_PX * (mS - mN);   // ∂height/∂v over one tile
  const nx = HH * (zv - zu);
  const ny = -HW * (zu + zv);
  const nz = 2 * HW * HH;
  const len = Math.hypot(nx, ny, nz) || 1;
  return (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / len - FLAT_SHADE;
}

/** Is this tile's top face planar? A non-planar (saddle) face needs splitting. */
export const isPlanarFace = (corners: readonly [number, number, number, number]): boolean =>
  corners[0] + corners[2] === corners[1] + corners[3];
