// ══════════════════════════════════════════════════════════════════════════
// RAIL-03 (#177) — painting the vector track, and the detail tiers.
//
// `rail-geometry.ts` decides what a tile's track IS; this module strokes and
// fills it, and answers the two questions the road cache asks about a chunk:
// which rail tiles to evaluate, and how much of their detail the current
// graphics tier wants.
//
// BATCHED, NOT PER TILE. Every pass below collects the whole chunk's figures
// into ONE canvas path and issues one `stroke()`/`fill()` for the lot: ballast,
// sleepers, boards, the rails' dark web, the steel head and the buffer stops
// are six draw calls per chunk, whatever the tile count — the same discipline
// `paintRoadTiles` keeps, and the reason ~200 rail tiles cost the same handful
// of calls as a single one.
//
// THE PASS ORDER IS THE DEPTH. The rail pass runs AFTER the road passes (so a
// level crossing's boards and steel land on the road surface the road pass just
// drew, and the road underneath is untouched) and BEFORE any sprite, because it
// happens inside the chunk raster the structures canvas blits first. Track is
// therefore always under the trains, the platforms, the depots and every
// building — by construction, not by sorting.
//
// GRAPHICS TIERS. `railDetailFor` maps the atlas detail cap (0.5 / 1 / 2, i.e.
// the same quality preset the art tiers use) to what is drawn:
//
//   High    ballast bed + shoulder, every sleeper, individual crossing boards
//   Medium  the same bed and sleepers, one crossing slab instead of boards
//   Low     no ballast at all, every SECOND sleeper (the low tier is the one
//           that has to keep its triangles down, and a bed is a wide fill)
//
// A lower tier never moves anything: every sleeper it draws is one the high
// tier also draws, at the identical coordinates, and no rail, board or stop
// changes size. That is asserted in the unit tests; it is the same rule the
// scenery LOD keeps in the renderer.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W, MAP_H } from "../game/config";
import { detailTierFor, type DetailTier } from "./detail-tiers";
import {
  RAIL_BED_SHOULDER, RAIL_BED_WIDTH, RAIL_WEB_WIDTH, RAIL_WIDTH, TIE_WIDTH,
  railTile, type GroundPoint, type RailTile,
} from "./rail-geometry";

type Ctx2D = CanvasRenderingContext2D;

/** The rail layer's PRESENT bit — the same one `track.ts` and `rail.ts` use. */
const PRESENT = 0b10000;
const BITS = 0b1111;

/**
 * The rail layer as the renderer reads it: the EFFECTIVE masks (a structure's
 * internal lane folded in, which is what makes a platform's port join the
 * network) with the PRESENT bit, the effective owner, and the rail revision the
 * bytes were written from.
 *
 * Deliberately the raw byte arrays the simulation already maintains plus its
 * revision counter — the painter derives everything it draws from them and
 * writes nothing back, exactly like `RoadWorld`.
 */
export interface RailLayer {
  tile?: Uint8Array;
  owner?: Uint8Array;
  /** `Rail.revision`: the invalidation gate the renderer diffs against. */
  revision?: number;
}

/** The world view a rail paint needs: the layer, plus the roads it crosses. */
export interface RailWorld {
  rail?: RailLayer;
  roadBits?: Uint8Array;
  dirtBits?: Uint8Array;
}

/** The railway's palette. Values are the art's own (see the generator's PALETTE). */
export interface RailStyle {
  /** Ballast aggregate, and the soft edge under it. */
  bed: string;
  bedEdge: string;
  /** Weathered timber: sleepers and crossing boards. */
  tie: string;
  plank: string;
  /** Steel: the dark web under the head, then the polished head itself. */
  web: string;
  steel: string;
  /** The buffer stop's beam. */
  stop: string;
}

/**
 * Neutral steel and timber for every owner — see the geometry module's header
 * for why the railway is not team-coloured (the roads are not either).
 * Hammered against the map's dark-olive grass and the asphalt: the bed is the
 * same family as the road's shoulder but warmer, the steel is the one bright
 * line on the ground, and the stop is the one warm accent, as on the art's
 * buffer beams.
 */
export const DEFAULT_RAIL_STYLE: RailStyle = {
  bed: "#6f6659",
  bedEdge: "#4f463b",
  tie: "#4a3d31",
  plank: "#7b6a52",
  web: "#5c6165",
  steel: "#b9bec4",
  stop: "#8f3f2b",
};

/** How much of the track's detail a tier draws. */
export interface RailDetail {
  /** A stable key — the cache re-keys its rasters when it changes. */
  key: DetailTier;
  /** Draw the ballast bed (and its soft edge). */
  bed: boolean;
  /** Draw every n-th sleeper from the lattice (1 = every one, 2 = every second). */
  tieStride: number;
  /** Draw the crossing as individual boards rather than one slab. */
  boards: boolean;
}

const DETAIL: Record<DetailTier, RailDetail> = {
  high: { key: "high", bed: true, tieStride: 1, boards: true },
  medium: { key: "medium", bed: true, tieStride: 1, boards: false },
  low: { key: "low", bed: false, tieStride: 2, boards: false },
};

/** The detail a graphics tier draws. The atlas detail cap is 0.5 / 1 / 2. */
export const railDetailFor = (cap: number): RailDetail => DETAIL[detailTierFor(cap)];

/**
 * The sleepers a tier draws from a tile's lattice.
 *
 * Striding BY INDEX walks the ladder in order, so a lower tier's sleepers are
 * literally a subset of the higher tier's at the identical coordinates — the
 * promise the tier note in the header makes, kept by construction rather than
 * by a second lattice.
 */
export const tiesFor = (tile: RailTile, detail: RailDetail): readonly GroundPoint[][] =>
  detail.tieStride <= 1 ? tile.ties : tile.ties.filter((_, i) => i % detail.tieStride === 0);

/**
 * The crossing boards a tier draws: the individual boards on High, the single
 * slab that covers exactly their extent on Medium and Low.
 */
export const planksFor = (tile: RailTile, detail: RailDetail): readonly GroundPoint[][] => {
  if (!tile.plankSlab) return [];
  return detail.boards ? tile.planks : [tile.plankSlab];
};

const cellAt = (arr: Uint8Array | undefined, tx: number, ty: number): number =>
  arr && tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H ? arr[ty * MAP_W + tx] : 0;

/** The road mask at a tile, either tier — the same OR `rail.ts`'s `roadAt` makes. */
const roadMaskAt = (world: RailWorld, tx: number, ty: number): number =>
  (cellAt(world.roadBits, tx, ty) | cellAt(world.dirtBits, tx, ty)) & BITS;

/** Every rail tile in a range, as drawing descriptions. */
export function railTilesIn(
  world: RailWorld, tx0: number, ty0: number, tx1: number, ty1: number,
): RailTile[] {
  const layer = world.rail;
  if (!layer?.tile) return [];
  const maskAt = (x: number, y: number): number => cellAt(layer.tile, x, y) & BITS;
  const out: RailTile[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const cell = cellAt(layer.tile, tx, ty);
      if ((cell & PRESENT) === 0) continue;
      out.push(railTile(tx, ty, cell, maskAt, roadMaskAt(world, tx, ty)));
    }
  }
  return out;
}

/** Trace a polyline into the CURRENT path (the caller owns `beginPath`). */
function traceInto(ctx: Ctx2D, points: readonly (readonly [number, number])[]): void {
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
}

/** Trace a closed quad into the CURRENT path. */
function traceQuad(ctx: Ctx2D, quad: readonly (readonly [number, number])[]): void {
  ctx.moveTo(quad[0][0], quad[0][1]);
  for (let i = 1; i < quad.length; i++) ctx.lineTo(quad[i][0], quad[i][1]);
  ctx.closePath();
}

/**
 * Paint rail tiles into a context already in ground coordinates, calling
 * `beginPath` + one stroke/fill per pass.
 */
export function paintRailTiles(
  ctx: Ctx2D,
  tiles: readonly RailTile[],
  detail: RailDetail,
  style: RailStyle = DEFAULT_RAIL_STYLE,
): void {
  if (!tiles.length) return;
  ctx.save();
  // Butt caps: every arm ends exactly ON the port, where the neighbouring
  // tile's arm begins, so two tiles' steel is butt-jointed with no round cap
  // bulging over the boundary — and a dead end stops square on the edge
  // instead of poking a semicircle into the next tile. Joins (the bend at the
  // tile centre, a junction's crossing arms) stay round.
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";

  // 1. The ballast bed, with a soft edge under it — the roads' shoulder in
  //    miniature, so the bed sits in the grass rather than on top of it.
  if (detail.bed) {
    ctx.strokeStyle = style.bedEdge;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = RAIL_BED_WIDTH + RAIL_BED_SHOULDER * 2;
    ctx.beginPath();
    for (const t of tiles) for (const run of t.bed) traceInto(ctx, run);
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.strokeStyle = style.bed;
    ctx.lineWidth = RAIL_BED_WIDTH;
    ctx.beginPath();
    for (const t of tiles) for (const run of t.bed) traceInto(ctx, run);
    ctx.stroke();
  }

  // 2. Crossing boards, over the road the road pass drew and under the steel.
  //    Boards come as a list, so the tiers choose how many rectangles to draw
  //    without moving any of them.
  ctx.fillStyle = style.plank;
  ctx.beginPath();
  for (const t of tiles) for (const board of planksFor(t, detail)) traceQuad(ctx, board);
  ctx.fill();

  // 3. Sleepers, in their own pass over the bed. Striding by index walks the
  //    lattice in order, so the low tier's every-second sleeper is a subset of
  //    the high tier's ladder, never a shifted one.
  ctx.strokeStyle = style.tie;
  ctx.lineWidth = TIE_WIDTH;
  ctx.beginPath();
  for (const t of tiles) for (const tie of tiesFor(t, detail)) traceInto(ctx, tie);
  ctx.stroke();

  // 4. The steel: a dark web first, the polished head concentric on top of it.
  //    Two passes for all the rails on the chunk, in the order web → head, so
  //    a junction's crossing arms read as one continuous way through.
  for (const [colour, width] of [[style.web, RAIL_WEB_WIDTH], [style.steel, RAIL_WIDTH]] as const) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const t of tiles) for (const rail of t.rails) traceInto(ctx, rail);
    ctx.stroke();
  }

  // 5. Buffer stops, last: the beam sits ON the rails it ends.
  ctx.fillStyle = style.stop;
  ctx.beginPath();
  for (const t of tiles) for (const stop of t.stops) traceQuad(ctx, stop);
  ctx.fill();

  ctx.restore();
}
