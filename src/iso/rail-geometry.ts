// ══════════════════════════════════════════════════════════════════════════
// RAIL-03 (#177) — the railway TRACK as pure ground-plane geometry.
//
// The roads have `road-geometry.ts`; this is its rail twin, and it is the only
// place a rail tile's shape is decided. It knows nothing about canvases,
// textures, caches or the camera: it turns a tile's 4-bit rail mask into paths
// in the same LOGICAL GROUND PLANE the roads use (tile (tx,ty) owns
// [tx,tx+1] × [ty,ty+1], projected by the game's one transform
// X = (u−v)·HW, Y = (u+v)·HH), so a train, a platform lane and a cache chunk
// all agree with the geometry for free.
//
// THE TRACK IS VECTOR. There is no rail sprite, no rail atlas cell and no
// `rail_0101.png` anywhere in this project; `paintRailTiles` in
// `rail-renderer.ts` strokes what this module returns, into the same cached
// chunk raster the roads are painted into. PNG art exists for the things the
// epic wants replaceable — the locomotive, the wagon, the platform and the
// train depot — and for nothing else.
//
// THREE PROPERTIES ARE THE WHOLE DESIGN, and each is pinned by a unit test:
//
//  1. THE PORT CONTRACT (inherited from the roads). Two adjacent tiles must
//     compute the SAME two points where their rails meet, exactly, or the
//     steel breaks at the tile boundary. Rails are the centre-line offset by
//     ±RAIL_GAUGE/2, and at a port the arm is axis-aligned, so the offset
//     point is the neighbour's own port offset from the other side: identical
//     algebraically, which is why the joins are seamless rather than merely
//     close.
//
//  2. THE ABSOLUTE TIE LATTICE. Sleepers sit at integer multiples of
//     TIE_SPACING on the ground axis their leg runs along — never at "half a
//     tile from the centre", never at a spacing that restarts per tile. A leg
//     owns the multiples in the half-open interval (lo, hi] between its two
//     ends, so the port at the high end is owned by one tile and one tile
//     only: neighbours cannot double up a sleeper, and a cache chunk boundary
//     cannot shift the rhythm. (TIE_SPACING divides the half-tile, so the
//     half-integer ports ARE lattice points — which is what makes the
//     half-open interval land exactly on the joins.)
//
//  3. THE CENTRE-LINES ARE THE TRAIN PATHS. Runs are paired through the tile
//     centre exactly as `roadFigures` pairs them, because `railPath`/`pointAt`
//     in `rail.ts` drive a train centre-to-centre: a sweeping arc inside the
//     tile would be prettier and would put the locomotive off its own rails.
//     A bend is therefore two arms joined at the centre with a round join (the
//     rails mitre together), not a quarter arc.
//
// WHAT IS NOT HERE. Every rule — where rail may be laid, what a crossing is,
// what an owner is, what a structure's lane joins — lives in `rail.ts`. This
// module re-states exactly one two-line shape test (`levelCrossing`, pinned
// against `crossingOk` by `tests/unit/iso-rail-geometry.test.ts`) because a
// value import of `rail.ts` from here would close a runtime cycle
// (rail.ts → track.ts → renderer.ts → road-renderer.ts → here) and take the
// whole module graph down at boot with a temporal-dead-zone error. The
// direction bits are re-declared for the same reason, and pinned the same way
// — exactly the arrangement `road-geometry.ts` documents for `track.ts`.
//
// OWNERSHIP IS NOT PAINTED. The rails are neutral steel and the sleepers are
// weathered timber for every owner: the roads carry no owner tint either (the
// road surface's own comment says so), and the epic's ownership story is told
// by the platform, the depot and the locomotive — replaceable PNG art — and by
// the Railway panel. `Rail.owner` still rides along in the layer the renderer
// reads, so a change of hands invalidates that tile's chunks and a future
// owner-tinted detail cannot serve a stale raster.
//
// GRAPHICS TIERS CHANGE DETAIL ONLY. `rail-renderer.ts` derives the tier from
// the atlas detail cap: High draws the ballast bed and individual crossing
// boards, Medium keeps the bed, Low drops it and draws every second sleeper.
// No tier moves a rail or changes its width — the ties a lower tier draws are
// a SUBSET of the higher tier's, at the same coordinates.
// ══════════════════════════════════════════════════════════════════════════
import type { Dir } from "./track";
import {
  ROAD_DIRS, ROAD_WIDTH, tileCentre, portPoint, neighbourOf, maskOf,
  roadFigures, type GroundPoint,
} from "./road-geometry";

export type { GroundPoint };

/**
 * The direction bits, re-declared. The unit tests assert they equal track.ts's
 * NE/SE/SW/NW AND that they are the four bits `ROAD_DIRS` walks (`road-geometry`
 * exports the same numbers, which is why they are taken from there and not
 * retyped a third time).
 */
const [NE, SE, SW, NW] = ROAD_DIRS;
const STRAIGHT_MASKS: readonly number[] = [NE | SW, SE | NW];
/** The opposite bit of each direction — the neighbour's "faces back at me" bit. */
const OPPOSITE: Record<number, number> = { [NE]: SW, [SE]: NW, [SW]: NE, [NW]: SE };
/** The unit step from a tile toward each neighbour, in the ground plane. */
const DIR_VEC: Record<number, GroundPoint> = {
  [NE]: [0, -1], [SE]: [1, 0], [SW]: [0, 1], [NW]: [-1, 0],
};

/**
 * Playtest (2026-09): a tile's DIAGONAL arms, one bit each, toward the corner
 * it shares with its diagonal neighbour — screen north (tx,ty), east
 * (tx+1,ty), south (tx+1,ty+1) and west (tx,ty+1). Both neighbours meet at
 * that corner point exactly, which is the port contract for a diagonal.
 */
export const DIAG_N = 1, DIAG_E = 2, DIAG_S = 4, DIAG_W = 8;
const DIAG_CORNER: Record<number, GroundPoint> = {
  [DIAG_N]: [0, 0], [DIAG_E]: [1, 0], [DIAG_S]: [1, 1], [DIAG_W]: [0, 1],
};
const diagCorner = (tx: number, ty: number, bit: number): GroundPoint =>
  [tx + DIAG_CORNER[bit][0], ty + DIAG_CORNER[bit][1]];
const DIAG_BITS = [DIAG_N, DIAG_E, DIAG_S, DIAG_W];

/** The rail mask of a rail byte — the low nibble, PRESENT bit excluded. */
export const railMaskOf = (cell: number): number => maskOf(cell);

/** Is this mask a straight line (either diagonal)? */
export const isStraightRail = (mask: number): boolean => STRAIGHT_MASKS.includes(mask);

/**
 * THE LEVEL-CROSSING SHAPE TEST, on masks alone.
 *
 * A crossing is a straight road crossed PERPENDICULARLY by a straight rail:
 * curves and junctions are refused on either side, and two parallel straights
 * are not a crossing (they would be track laid along the road). This is the
 * geometry twin of `crossingOk` in `rail.ts` — see the module header for why
 * it cannot simply be imported — and the unit test drives every one of the
 * 16×16 mask pairs through both functions to prove they agree.
 */
export function levelCrossing(roadMask: number, railMask: number): boolean {
  if ((roadMask & 0b1111) === 0) return false;
  if (!isStraightRail(roadMask & 0b1111) || !isStraightRail(railMask & 0b1111)) return false;
  return (roadMask & 0b1111) !== (railMask & 0b1111);
}

// ── the cross-section, in tile units ───────────────────────────────────────
/**
 * Distance between the two rails' centre-lines.
 *
 * The authored PNG lanes are the contract here, because a platform's or a
 * depot's internal track has to meet the network's track at the port without a
 * step: `tools/make-railway-art.mjs` draws the platform lane's rails at ±0.16
 * and the depot's at ±0.15 of the lane centre-line, and the lane centre-line is
 * the tile row's centre-line — i.e. exactly the centre-line of the arms this
 * module builds. 0.32 is the platform's figure; it is within a fifth of a
 * screen pixel of the depot's at 1×.
 */
export const RAIL_GAUGE = 0.32;
/** One rail's width. Also the art's figure (0.07 across). */
export const RAIL_WIDTH = 0.07;
/**
 * The dark "web" drawn under the rail head, so a 0.07-wide steel line reads as
 * a rail rather than as a painted stripe on the ballast. Not a separate object:
 * the head is stroked on top of it, concentric.
 */
export const RAIL_WEB_WIDTH = 0.11;
/** Sleeper (tie) dimensions. The art's lane draws 0.48 × 0.09. */
export const TIE_LENGTH = 0.48;
export const TIE_WIDTH = 0.09;
/**
 * Sleeper pitch on the absolute lattice. 0.23 in the art's platform lane; 0.25
 * here because 0.25 divides the half-tile exactly, so the half-integer ports are
 * lattice points and the half-open ownership rule (see `latticeTies`) lands a
 * sleeper exactly on every join instead of drifting a little per tile.
 */
export const TIE_SPACING = 0.25;
/** The ballast bed, under the sleepers. */
export const RAIL_BED_WIDTH = 0.62;
/** The soft edge under the bed, on each side (the roads' shoulder, in miniature). */
export const RAIL_BED_SHOULDER = 0.06;
/** A dead end's buffer stop: a beam across the rails, inset from the port. */
export const RAIL_STOP_INSET = 0.1;
export const RAIL_STOP_WIDTH = 0.1;
export const RAIL_STOP_LENGTH = 0.54;
/** A lone stub's piece of track, centred on its tile. */
export const RAIL_STUB_LENGTH = 0.5;
/** Crossing boards: how many, and the gap between them. */
export const PLANK_BOARDS = 3;
export const PLANK_GAP = 0.03;
/** The road surface a crossing's boards reach across — the wider road tier. */
export const PLANK_ROAD_WIDTH = Math.max(ROAD_WIDTH.dirt, ROAD_WIDTH.paved);

// ── the tile's geometry ────────────────────────────────────────────────────
/**
 * One tile of rail, as paths to stroke and quads to fill.
 *
 * Every list is batched later into a handful of canvas paths (see
 * `paintRailTiles`), so a hundred tiles cost a handful of draw calls per chunk,
 * not a handful per tile.
 */
export interface RailTile {
  tx: number;
  ty: number;
  mask: number;
  /**
   * The centre-lines: one polyline per run, through the tile centre. A train
   * drives these exactly (`rail.ts`'s `pointAt` moves along tile centre-lines).
   */
  runs: GroundPoint[][];
  /** The ballast bed: the runs again, stroked wider. Empty on a crossing. */
  bed: GroundPoint[][];
  /** The steel: each run offset by ±RAIL_GAUGE/2. */
  rails: GroundPoint[][];
  /** Sleepers, each a 2-point segment across the track. Empty on a crossing. */
  ties: GroundPoint[][];
  /** Crossing boards, in order along the rail — the HIGH tier's look. */
  planks: GroundPoint[][];
  /** The same strip as one slab, for the tiers below High. Null when not a crossing. */
  plankSlab: GroundPoint[] | null;
  /** Buffer-stop beams at exposed centre ends and ports with no reciprocal neighbour. */
  stops: GroundPoint[][];
}

/** The unit normal of a leg, always on the same (left-hand) side of `a → b`. */
function legNormal(a: GroundPoint, b: GroundPoint): GroundPoint {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [-dy / len, dx / len];
}

/**
 * Offset a centre-line sideways by `offset`, mitred at every interior vertex.
 *
 * The mitre length `offset / (1 + n₀·n₁)` is the one that keeps the offset line
 * exactly `offset` away from BOTH legs, which is what makes a bend's two rails
 * turn together without pinching — and what makes the offset at an endpoint
 * (a port) a plain perpendicular offset, i.e. the value the neighbouring tile
 * computes for itself.
 */
export function offsetPath(points: GroundPoint[], offset: number): GroundPoint[] {
  if (points.length < 2) return points.slice();
  const out: GroundPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const n0 = i > 0 ? legNormal(points[i - 1], points[i]) : null;
    const n1 = i < points.length - 1 ? legNormal(points[i], points[i + 1]) : null;
    if (n0 && n1) {
      const dot = n0[0] * n1[0] + n0[1] * n1[1];
      // A reversal would divide by zero; a run never contains one (its arms
      // leave through distinct ports), and the clamp keeps a degenerate case
      // from throwing rather than from looking perfect.
      const k = offset / Math.max(0.25, 1 + dot);
      out.push([points[i][0] + (n0[0] + n1[0]) * k, points[i][1] + (n0[1] + n1[1]) * k]);
    } else {
      const n = (n0 ?? n1) as GroundPoint;
      out.push([points[i][0] + n[0] * offset, points[i][1] + n[1] * offset]);
    }
  }
  return out;
}

/**
 * The centre-line runs of a tile's mask, in the roads' own language: arms are
 * paired through the centre (opposite first, so a crossroads is two straight
 * runs and a bend is one run through the corner), and a mask with no bits is a
 * short STUB across the tile centre — rail can be laid as a lone tile, and a
 * stub must still look like a piece of track rather than like nothing at all.
 */
export function railRuns(tx: number, ty: number, mask: number, diag = 0): GroundPoint[][] {
  const bits = mask & 0b1111;
  const c = tileCentre(tx, ty);
  if (bits === 0 && diag === 0) {
    return [[[c[0] - RAIL_STUB_LENGTH / 2, c[1]], [c[0] + RAIL_STUB_LENGTH / 2, c[1]]]];
  }
  if (diag === 0) return roadFigures(tx, ty, bits).map((f) => f.points);
  // With diagonals: exactly two arms are ONE run through the centre (a 45°
  // bend or a straight diagonal mitres properly); more arms are the
  // orthogonal figures plus one centre-to-corner arm per diagonal.
  const ends: GroundPoint[] = [];
  for (const d of ROAD_DIRS) if (bits & d) ends.push(portPoint(tx, ty, d as Dir));
  for (const d of DIAG_BITS) if (diag & d) ends.push(diagCorner(tx, ty, d));
  if (ends.length === 2) return [[ends[0], c, ends[1]]];
  const runs = bits ? roadFigures(tx, ty, bits).map((f) => f.points) : [];
  for (const d of DIAG_BITS) if (diag & d) runs.push([c, diagCorner(tx, ty, d)]);
  return runs;
}

/** Sleeper step along u on a diagonal leg: 1/6 divides the half-tile, so the
 *  centre and the corner are lattice points (spacing ≈ 0.236 along the track). */
const DIAG_TIE_DU = 1 / 6;

/**
 * The sleepers of a run: on the ABSOLUTE lattice of the axis each leg runs
 * along, in that leg's half-open interval (lo, hi].
 *
 * The half-open interval is the ownership rule that makes the lattice work
 * across tiles and chunks: the port at a leg's high end carries a sleeper, and
 * the neighbouring tile's leg toward the same port starts just past it, so the
 * ladder continues with no double sleeper and no gap. It is also
 * direction-independent (lo/hi are sorted), so a run that walks the same tile
 * the other way produces the same sleepers.
 */
export function latticeTies(points: GroundPoint[]): GroundPoint[][] {
  const out: GroundPoint[][] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    const alongU = Math.abs(b[1] - a[1]) < 1e-9;
    const alongV = Math.abs(b[0] - a[0]) < 1e-9;
    if (!alongU && !alongV) {
      // A diagonal leg: the lattice runs on u, half-open (lo, hi] as below.
      const du = b[0] - a[0], dv = b[1] - a[1];
      if (Math.abs(Math.abs(du) - Math.abs(dv)) > 1e-9) continue;
      const n = legNormal(a, b);
      const hx = (n[0] * TIE_LENGTH) / 2, hy = (n[1] * TIE_LENGTH) / 2;
      const lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]);
      for (let k = Math.floor(lo / DIAG_TIE_DU + 1e-9) + 1; k * DIAG_TIE_DU <= hi + 1e-9; k++) {
        const u = k * DIAG_TIE_DU;
        const v = a[1] + (u - a[0]) * (dv / du);
        out.push([[u - hx, v - hy], [u + hx, v + hy]]);
      }
      continue;
    }
    const axis = alongU ? 0 : 1;                   // the coordinate the lattice runs on
    const lo = Math.min(a[axis], b[axis]), hi = Math.max(a[axis], b[axis]);
    const n = legNormal(a, b);
    const hx = (n[0] * TIE_LENGTH) / 2, hy = (n[1] * TIE_LENGTH) / 2;
    for (let k = Math.floor(lo / TIE_SPACING) + 1; k * TIE_SPACING <= hi + 1e-9; k++) {
      const t = k * TIE_SPACING;
      const at = axis === 0 ? [t, a[1]] : [a[0], t];
      out.push([[at[0] - hx, at[1] - hy], [at[0] + hx, at[1] + hy]]);
    }
  }
  return out;
}

/** A quad centred on `p`, `length` across the track and `width` along it. */
function beamAt(p: GroundPoint, along: GroundPoint, length: number, width: number): GroundPoint[] {
  const n: GroundPoint = [-along[1], along[0]];
  const hl = length / 2, hw = width / 2;
  return [
    [p[0] - n[0] * hl - along[0] * hw, p[1] - n[1] * hl - along[1] * hw],
    [p[0] + n[0] * hl - along[0] * hw, p[1] + n[1] * hl - along[1] * hw],
    [p[0] + n[0] * hl + along[0] * hw, p[1] + n[1] * hl + along[1] * hw],
    [p[0] - n[0] * hl + along[0] * hw, p[1] - n[1] * hl + along[1] * hw],
  ];
}

/** A buffer stop just inside the port a dead-end arm leaves through. */
function stopBeam(tx: number, ty: number, dir: number): GroundPoint[] {
  const [px, py] = portPoint(tx, ty, dir as Dir);
  const t = DIR_VEC[dir];
  return beamAt([px - t[0] * RAIL_STOP_INSET, py - t[1] * RAIL_STOP_INSET], t, RAIL_STOP_LENGTH, RAIL_STOP_WIDTH);
}

/**
 * The level-crossing planks: boards between the rails, spanning the road.
 *
 * A crossing keeps the road exactly as the road pass drew it and lays the
 * boards on top, between the two rails, across the full width of the road the
 * rail cuts through — the shape a real crossing has. The rails go over the
 * boards (the painter's order), so the steel is continuous through the
 * crossing. `plankSlab` is the same strip as one board, for the tiers below
 * High: the tiers may change how many boards are drawn, never where they are.
 */
function crossingPlanks(tx: number, ty: number, mask: number): { boards: GroundPoint[][]; slab: GroundPoint[] } {
  const [cx, cy] = tileCentre(tx, ty);
  // The rails run along one axis; the strip between them is as long as the road
  // is wide (along the rails), and as wide as the clear space between them.
  const railsAlongV = (mask & (NE | SW)) !== 0;
  const acrossHalf = (RAIL_GAUGE + RAIL_WIDTH) / 2 - 0.02;
  const roadHalf = PLANK_ROAD_WIDTH / 2;
  const strip = (from: number, to: number): GroundPoint[] => railsAlongV
    ? [[cx - acrossHalf, cy + from], [cx + acrossHalf, cy + from], [cx + acrossHalf, cy + to], [cx - acrossHalf, cy + to]]
    : [[cx + from, cy - acrossHalf], [cx + from, cy + acrossHalf], [cx + to, cy + acrossHalf], [cx + to, cy - acrossHalf]];
  const slab = strip(-roadHalf, roadHalf);
  const board = (2 * roadHalf - (PLANK_BOARDS - 1) * PLANK_GAP) / PLANK_BOARDS;
  const boards: GroundPoint[][] = [];
  for (let i = 0; i < PLANK_BOARDS; i++) {
    const from = -roadHalf + i * (board + PLANK_GAP);
    boards.push(strip(from, from + board));
  }
  return { boards, slab };
}

/**
 * One tile of rail, complete.
 *
 * `railAt(tx,ty)` answers with the EFFECTIVE mask of any tile (the layer's bits
 * with a structure's lane folded in, which is what `railDrawLayer` in `rail.ts`
 * hands the renderer), and is asked only about neighbours: a port whose
 * neighbour does not carry the reciprocal bit is where the rail ENDS, and a dead
 * end gets a buffer stop. A one-bit tile also ends at its centre, away from
 * its connected neighbour, and gets a buffer there. `roadMask` is the road byte's low nibble at this tile
 * (either tier), and turns the tile into a level crossing when the two are
 * straight and perpendicular.
 */
export function railTile(
  tx: number,
  ty: number,
  cell: number,
  railAt: (tx: number, ty: number) => number,
  roadMask = 0,
  diag = 0,
): RailTile {
  const mask = cell & 0b1111;
  const crossing = diag === 0 && levelCrossing(roadMask, mask);
  const runs = railRuns(tx, ty, mask, diag);
  const bed: GroundPoint[][] = [];
  const rails: GroundPoint[][] = [];
  const ties: GroundPoint[][] = [];
  for (const run of runs) {
    // A crossing keeps the road surface the road pass drew: no ballast, no
    // sleepers — boards and steel only.
    if (!crossing) {
      bed.push(run);
      ties.push(...latticeTies(run));
    }
    rails.push(offsetPath(run, -RAIL_GAUGE / 2), offsetPath(run, RAIL_GAUGE / 2));
  }
  const planks = crossing ? crossingPlanks(tx, ty, mask) : null;

  const stops: GroundPoint[][] = [];
  if (mask === 0 && diag === 0) {
    // A lone stub ends at both ends.
    const c = tileCentre(tx, ty);
    const half = RAIL_STUB_LENGTH / 2;
    stops.push(
      beamAt([c[0] - half + RAIL_STOP_INSET, c[1]], DIR_VEC[SE], RAIL_STOP_LENGTH, RAIL_STOP_WIDTH),
      beamAt([c[0] + half - RAIL_STOP_INSET, c[1]], DIR_VEC[NW], RAIL_STOP_LENGTH, RAIL_STOP_WIDTH),
    );
  } else {
    // Autotiling stores connections, not the exposed end: a one-bit tile
    // runs from its centre toward its only neighbour. Cap the centre end,
    // inset along that run so the beam sits fully on the steel. Do not cap
    // the centre of a T: its branch joins the through run there.
    if (diag !== 0) {
      // A lone diagonal arm ends at the centre: cap it there.
      if (mask === 0 && (diag & (diag - 1)) === 0) {
        const c = tileCentre(tx, ty);
        const k = diagCorner(tx, ty, diag);
        const len = Math.hypot(k[0] - c[0], k[1] - c[1]);
        const toward: GroundPoint = [(k[0] - c[0]) / len, (k[1] - c[1]) / len];
        stops.push(beamAt(
          [c[0] + toward[0] * RAIL_STOP_INSET, c[1] + toward[1] * RAIL_STOP_INSET],
          toward, RAIL_STOP_LENGTH, RAIL_STOP_WIDTH,
        ));
      }
    } else if ((mask & (mask - 1)) === 0) {
      const c = tileCentre(tx, ty);
      const toward = DIR_VEC[mask];
      stops.push(beamAt(
        [c[0] + toward[0] * RAIL_STOP_INSET, c[1] + toward[1] * RAIL_STOP_INSET],
        toward, RAIL_STOP_LENGTH, RAIL_STOP_WIDTH,
      ));
    }
    for (const d of ROAD_DIRS) {
      if (!(mask & d)) continue;
      const [nx, ny] = neighbourOf(tx, ty, d as Dir);
      if ((railAt(nx, ny) & OPPOSITE[d]) !== 0) continue;    // the steel continues
      stops.push(stopBeam(tx, ty, d));
    }
  }

  return {
    tx, ty, mask, runs, bed, rails, ties,
    planks: planks?.boards ?? [],
    plankSlab: planks?.slab ?? null,
    stops,
  };
}
