// ══════════════════════════════════════════════════════════════════════════
// ROADS (vector) — pure ground-plane geometry.
//
// This module knows nothing about canvases, textures, caches or the camera.
// It turns a tile's 4-bit connection mask into paths in the LOGICAL GROUND
// PLANE, where every tile is a unit square: tile (tx,ty) owns
// [tx,tx+1] × [ty,ty+1]. The renderer projects with the game's one transform,
//
//     X = (u - v) · HW      Y = (u + v) · HH
//
// which sends (tx,ty) to `tileToScreen(tx,ty)` — the diamond's TOP vertex —
// and the tile centre (tx+0.5, ty+0.5) to that plus (0, HH).
//
// WHY THE GROUND PLANE. A road has a width, and width is a property of the
// ground, not of the screen. Stroking a projected polyline with a constant
// screen-space line width gives a road that is too wide on one diagonal and
// too narrow on the other, and whose edges do not meet its neighbour's. Every
// point and every width here is in tile units; the renderer applies the
// projection to the whole shape, its width included, by stroking under the
// isometric transform.
//
// THE PORT CONTRACT. Two adjacent tiles must compute the SAME point for the
// edge they share, exactly, or their arms leave a hairline at the tile
// boundary. Ports are defined at edge midpoints, and each direction's port is
// algebraically identical to the neighbour's opposite port:
//
//     (tx,ty) NE = (tx+0.5, ty)      == (tx,ty-1) SW = (tx+0.5, ty-1+1)
//     (tx,ty) SE = (tx+1, ty+0.5)    == (tx+1,ty) NW = (tx+1, ty+0.5)
//
// `sharedPortsAgree` in the unit tests pins this down for every direction.
// ══════════════════════════════════════════════════════════════════════════
// TYPE-ONLY import from track.ts, deliberately.
//
// A value import here is a circular one: `track.ts` imports CHUNK/chunksX from
// `renderer.ts`, `renderer.ts` reaches this module through `road-renderer.ts`,
// and the cycle closes. Under ESM the cycle resolves by evaluating this module
// first, so every top-level use of an imported binding — `ROAD_DIRS = DIRS`,
// the computed keys in `PORT_OFFSET` — reads it inside its temporal dead zone
// and throws `Cannot access 'DIRS' before initialization`. That does not fail
// gracefully: the whole module graph fails to load, so the app never boots and
// everything hanging off it (the UI sound layer included) is simply absent.
//
// A type import is erased, so it creates no runtime edge. The four direction
// values are re-declared below instead, and pinned against track.ts by
// `tests/unit/iso-road-geometry.test.ts` so they cannot drift.
import type { Dir } from "./track";

/**
 * The direction bits, re-declared. These MUST equal track.ts's NE/SE/SW/NW —
 * the unit tests assert it tile for tile.
 */
const NE = 1, SE = 2, SW = 4, NW = 8;
const DIRS: readonly Dir[] = [NE, SE, SW, NW];
const DIR: Record<number, [number, number]> = {
  [NE]: [0, -1],
  [SE]: [1, 0],
  [SW]: [0, 1],
  [NW]: [-1, 0],
};
const OPPOSITE: Record<number, number> = {
  [NE]: SW, [SE]: NW, [SW]: NE, [NW]: SE,
};

/** A point in the ground plane, in tile units. */
export type GroundPoint = readonly [number, number];

/** The four direction bits, in the order geometry walks them. */
export const ROAD_DIRS = DIRS;

/**
 * Port offsets from a tile's origin, in tile units. The midpoint of the edge
 * the direction leads through — NOT a diamond corner. Connecting corners is
 * the classic mistake here: it produces roads that meet at the points where
 * four tiles touch instead of across the edges they actually share.
 */
export const PORT_OFFSET: Record<number, GroundPoint> = {
  [NE]: [0.5, 0],
  [SE]: [1, 0.5],
  [SW]: [0.5, 1],
  [NW]: [0, 0.5],
};

/** The centre of tile (tx,ty) in the ground plane. */
export const tileCentre = (tx: number, ty: number): GroundPoint =>
  [tx + 0.5, ty + 0.5];

/** The point where tile (tx,ty)'s road crosses its `dir` edge. */
export const portPoint = (tx: number, ty: number, dir: Dir): GroundPoint =>
  [tx + PORT_OFFSET[dir][0], ty + PORT_OFFSET[dir][1]];

/** The neighbour tile in `dir`. */
export const neighbourOf = (tx: number, ty: number, dir: Dir): [number, number] =>
  [tx + DIR[dir][0], ty + DIR[dir][1]];

/** The connection bits of a track byte — the low nibble. */
export const maskOf = (cell: number): number => cell & 0b1111;

/** Does this byte carry road at all? The PRESENT bit is 0b10000. */
export const hasRoad = (cell: number): boolean => (cell & 0b10000) !== 0 || maskOf(cell) !== 0;

/** The directions set in a mask, in NE/SE/SW/NW order. */
export function dirsOf(mask: number): Dir[] {
  const out: Dir[] = [];
  for (const d of ROAD_DIRS) if (mask & d) out.push(d);
  return out;
}

/**
 * One stroked figure of road surface, in ground coordinates.
 *
 * `points` is stroked with the material's width, round cap and round join, so
 * an arm's free end is a rounded stub and a bend is a rounded corner. A
 * single point is a PAD — the isolated tile that carries road but connects to
 * nothing; stroking it with a round cap produces a disc of exactly the road's
 * width, which is the right shape and needs no special case downstream.
 */
export interface RoadFigure {
  points: GroundPoint[];
}

/**
 * The road surface of one tile, as figures to stroke.
 *
 * Arms are paired through the CENTRE rather than emitted one by one, for two
 * reasons. A pair sharing a vertex strokes as one continuous figure with a
 * round join, so a bend has no seam down its inside edge; and pairing a
 * direction with its OPPOSITE where both are present makes a crossroads two
 * straight ribbons rather than four stubs meeting in a blob.
 *
 * Every trajectory passes through the tile centre, which is deliberate: the
 * lorries in `vehicles.ts` drive centre-to-centre, so this is the geometry
 * that keeps them on the road. A sweeping corner cut inside the centre would
 * be prettier and would put traffic on the grass.
 */
export function roadFigures(tx: number, ty: number, mask: number): RoadFigure[] {
  const centre = tileCentre(tx, ty);
  const dirs = dirsOf(mask);
  if (dirs.length === 0) return [{ points: [centre] }];

  const out: RoadFigure[] = [];
  const left = new Set<Dir>(dirs);
  while (left.size) {
    const a = [...left][0];
    left.delete(a);
    // Prefer the straight-through partner, so a crossroads reads as two roads
    // crossing instead of four arms abutting.
    const opp = OPPOSITE[a] as Dir;
    const b = left.has(opp) ? opp : [...left][0];
    if (b === undefined) {
      out.push({ points: [centre, portPoint(tx, ty, a)] });
    } else {
      left.delete(b);
      out.push({ points: [portPoint(tx, ty, a), centre, portPoint(tx, ty, b)] });
    }
  }
  return out;
}

// ── material regions ────────────────────────────────────────────────────────
/** Which surface a tile's road is made of. */
export type RoadMaterial = "dirt" | "paved";

/**
 * A stretch of asphalt laid into a DIRT tile's arm, where that arm meets a
 * paved neighbour.
 *
 * The transition belongs to the dirt tile by convention — one side has to own
 * it or both would draw half a join and the seam would double up. The paved
 * tile stays asphalt right to its edge, so at the shared port both tiles put
 * asphalt on the same ground coordinates and the join is invisible.
 *
 * `from` is the shared port, `to` is `blend` tile units inward along the arm.
 * The renderer ramps asphalt alpha from 1 at `from` to 0 at `to`, OVER an
 * already opaque dirt core — fading both materials to transparency instead
 * would open a window onto the grass along the join.
 */
export interface RoadTransition {
  dir: Dir;
  from: GroundPoint;
  to: GroundPoint;
}

/** How far a paved arm bleeds into its dirt tile, in tile units. */
export const TRANSITION_BLEND = 0.2;

/**
 * The complete drawing description of one tile's road.
 *
 * `transitions` is empty for a paved tile: pavement never fades into its
 * neighbour, it simply ends at the port where the neighbouring dirt tile's
 * own transition takes over.
 */
export interface RoadTile {
  tx: number;
  ty: number;
  material: RoadMaterial;
  mask: number;
  figures: RoadFigure[];
  transitions: RoadTransition[];
  /** Town paved roads get sidewalks + street lights (issue #159). */
  isTown?: boolean;
}

/**
 * Build a tile's road description.
 *
 * `pavedAt(tx,ty)` reports whether the neighbour carries PAVED road — the
 * same classification `dirtSpriteName` makes when it picks a `dirt_road_*`
 * transition cell, expressed as geometry instead of a sprite name. It is
 * deliberately a physical test: a rival's paved road joins yours visually,
 * exactly as two rival dirt tiles already draw arms at each other. Ownership,
 * routing, costs and speed are decided elsewhere and are not affected by what
 * the join looks like.
 */
export function roadTile(
  tx: number, ty: number, cell: number, material: RoadMaterial,
  pavedAt: (tx: number, ty: number) => boolean,
): RoadTile {
  const mask = maskOf(cell);
  const figures = roadFigures(tx, ty, mask);
  const transitions: RoadTransition[] = [];
  if (material === "dirt") {
    const centre = tileCentre(tx, ty);
    for (const dir of dirsOf(mask)) {
      const [nx, ny] = neighbourOf(tx, ty, dir);
      if (!pavedAt(nx, ny)) continue;
      const port = portPoint(tx, ty, dir);
      // Inward along the arm, toward the centre. The arm is half a tile long,
      // so the blend cannot reach the junction at the default width.
      const t = TRANSITION_BLEND / 0.5;
      transitions.push({
        dir,
        from: port,
        to: [port[0] + (centre[0] - port[0]) * t, port[1] + (centre[1] - port[1]) * t],
      });
    }
  }
  return { tx, ty, material, mask, figures, transitions };
}

// ── centre-lines for paint ──────────────────────────────────────────────────
/**
 * The centre-lines a paved tile's markings follow: the same figures as the
 * surface, but trimmed back from junctions.
 *
 * Paint is generated from the geometry rather than baked into the material so
 * it can follow a bend and stop at a junction. At a T or a crossroads the
 * approach markings stop short of the middle — real junctions are not painted
 * through, and a dash crossing the box would read as a mistake. A tile with
 * one connection or none carries no paint at all: there is no through-route
 * to mark.
 */
export function paintFigures(tx: number, ty: number, mask: number): RoadFigure[] {
  const dirs = dirsOf(mask);
  if (dirs.length < 2) return [];
  const centre = tileCentre(tx, ty);
  const junction = dirs.length >= 3;
  const trim = junction ? JUNCTION_GAP : 0;

  const out: RoadFigure[] = [];
  const toward = (port: GroundPoint, by: number): GroundPoint => {
    if (by === 0) return centre;
    const t = by / 0.5;                     // the arm is half a tile long
    return [centre[0] + (port[0] - centre[0]) * t, centre[1] + (port[1] - centre[1]) * t];
  };

  if (junction) {
    // Every arm is painted separately, each stopping `JUNCTION_GAP` short of
    // the middle, so nothing is drawn across the junction itself.
    for (const d of dirs) out.push({ points: [toward(portPoint(tx, ty, d), trim), portPoint(tx, ty, d)] });
    return out;
  }
  // Exactly two connections: one continuous line through the centre, so a
  // bend's paint bends with it instead of breaking into two stubs.
  const [a, b] = dirs;
  out.push({ points: [portPoint(tx, ty, a), centre, portPoint(tx, ty, b)] });
  return out;
}

/** How far short of a junction's centre approach markings stop, in tile units. */
export const JUNCTION_GAP = 0.22;

// ── measurements ────────────────────────────────────────────────────────────
/**
 * Road width in tile units. Ground-plane, never screen-space.
 *
 * A road tile OCCUPIES ITS TILE. This is measured, not chosen: the sprite
 * these vectors replace (`road_1010`, a straight, in the 1× atlas) carries an
 * asphalt band 0.84 tile units across, leaving only a thin verge in the two
 * off-axis corners of the diamond. Core 0.78 + `SHOULDER_WIDTH` on each side
 * reproduces that footprint exactly.
 *
 * It was 0.45 — a little under half a tile — and that was the bug behind
 * "the road runs on the edge of two diamonds, half in one and half in the
 * other". The centre-line was never off (it passes through `tileCentre`, and
 * an overlay of the true diamonds confirms it): a ribbon that narrow just
 * floats midway between the two boundary lines running parallel to it a few
 * pixels away, and the eye cannot tell which diamond owns it. Filling the
 * tile is what makes a road section read as one tile of road.
 */
export const ROAD_WIDTH: Record<RoadMaterial, number> = {
  dirt: 0.78,
  paved: 0.78,
};

/**
 * Extra width of the soft shoulder drawn under the core, per side, in tile
 * units.
 *
 * Kept narrow on purpose. At 0.1 with an opaque near-black this read as a
 * thick outline drawn around every road — the "thick cartoon outlines" the
 * art direction rules out — rather than as ground disturbed at the road's
 * edge. It is a hint of a verge, not a border.
 */
export const SHOULDER_WIDTH = 0.03;

/**
 * The ground-plane bounding box of a tile's road, shoulder included. The
 * cache uses this to decide which tiles it has to evaluate for a region: a
 * road reaches beyond its own tile, so a chunk has to consider its
 * neighbours' geometry too.
 */
export function figureBounds(tile: RoadTile): {
  u0: number; v0: number; u1: number; v1: number;
} {
  const pad = ROAD_WIDTH[tile.material] / 2 + SHOULDER_WIDTH;
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const f of tile.figures) {
    for (const [u, v] of f.points) {
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
  }
  return { u0: u0 - pad, v0: v0 - pad, u1: u1 + pad, v1: v1 + pad };
}

// ── sidewalks (town) ──────────────────────────────────────────────────────
/**
 * Elevated concrete block sidewalks — only for paved roads inside town
 * limits (TOWN_OCC). Geometry is still ground-plane, same port contract as
 * roads, so chunks line up without seams.
 *
 * Visual spec (issue #159):
 *  - Light grey ribbon (#c8cbd0 / #d5d8dc) along both outer edges of paved
 *    road surface, near ROAD_WIDTH.paved/2 (~0.39) from centre line.
 *  - Width narrow curb/walkway ribbon ~0.06–0.08 tile units.
 *  - Transverse joints every 0.15–0.20 tile units, dark grey, 1px wide,
 *    offset by 1px and shortened to stay inside ribbon for elevated effect.
 *  - Street light posts at bends and intersections on sidewalks.
 */
export const SIDEWALK_WIDTH = 0.07;
export const SIDEWALK_GAP = 0.02;
export const SIDEWALK_OFFSET = ROAD_WIDTH.paved / 2 + SIDEWALK_GAP + SIDEWALK_WIDTH / 2; // ~0.445
export const SIDEWALK_JOINT_SPACING = 0.18;
export const SIDEWALK_JOINT_WIDTH = 0.015;
export const SIDEWALK_JOINT_INSET = 0.015;
export const SIDEWALK_JOINT_OFFSET = 0.02;
export const SIDEWALK_LIGHT_EXTRA = 0.08;
export const SIDEWALK_LIGHT_DISTANCE = SIDEWALK_OFFSET + SIDEWALK_LIGHT_EXTRA;

function sub(a: GroundPoint, b: GroundPoint): [number, number] {
  return [a[0] - b[0], a[1] - b[1]];
}
function add(a: GroundPoint, v: [number, number]): GroundPoint {
  return [a[0] + v[0], a[1] + v[1]];
}
function mul(v: [number, number], s: number): [number, number] {
  return [v[0] * s, v[1] * s];
}
function len(v: [number, number]): number {
  return Math.hypot(v[0], v[1]);
}
function norm(v: [number, number]): [number, number] {
  const l = len(v);
  return l < 1e-9 ? [0, 0] : [v[0] / l, v[1] / l];
}
function perpLeft(v: [number, number]): [number, number] {
  return [-v[1], v[0]];
}
function cross(a: [number, number], b: [number, number]): number {
  return a[0] * b[1] - a[1] * b[0];
}

/** Offset a 2-point segment by `off` to left (positive) or right (negative). */
function offsetSegment(
  p0: GroundPoint, p1: GroundPoint, off: number, side: "left" | "right",
): [GroundPoint, GroundPoint] {
  const d = sub(p1, p0);
  const l = len(d);
  if (l < 1e-9) return [p0, p1];
  const n = perpLeft(norm(d));
  const f = side === "left" ? 1 : -1;
  const o = mul(n, off * f);
  return [add(p0, o), add(p1, o)];
}

/**
 * Offset a 3-point figure [a,b,c] to one side, with miter join at b.
 * Returns 3 points [a', intersection, c'].
 */
function offsetFigure3(
  a: GroundPoint, b: GroundPoint, c: GroundPoint,
  off: number, side: "left" | "right",
): GroundPoint[] {
  const d1 = sub(b, a);
  const d2 = sub(c, b);
  const l1 = len(d1), l2 = len(d2);
  if (l1 < 1e-9 || l2 < 1e-9) {
    // Degenerate, fall back to simple offset
    const seg1 = offsetSegment(a, b, off, side);
    const seg2 = offsetSegment(b, c, off, side);
    return [seg1[0], seg1[1], seg2[1]];
  }
  const n1 = perpLeft(norm(d1));
  const n2 = perpLeft(norm(d2));
  const f = side === "left" ? 1 : -1;
  const a1 = add(a, mul(n1, off * f));
  const b2 = add(b, mul(n2, off * f));
  const c1 = add(c, mul(n2, off * f));

  const cr = cross(d1, d2);
  if (Math.abs(cr) < 1e-9) {
    // Parallel (straight road): middle is b + normal*off
    return [a1, add(b, mul(n1, off * f)), c1];
  }
  // Intersection of lines a1 + t*d1 and b2 + s*d2
  // t = cross(b2 - a1, d2) / cross(d1, d2)
  const diff = sub(b2, a1);
  const t = cross(diff, d2) / cr;
  const inter = add(a1, mul(d1, t));
  return [a1, inter, c1];
}

/** Angle for a Dir, clockwise from north, in degrees. */
function dirAngle(d: Dir): number {
  if (d === NE) return 0;
  if (d === SE) return 90;
  if (d === SW) return 180;
  return 270; // NW
}
function angleToVec(deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [Math.sin(rad), -Math.cos(rad)];
}

/**
 * Parallel sidewalk centre-lines for a road tile.
 * Returns an array of polylines (each 2 or 3 points) in ground coords.
 */
export function sidewalkFiguresForTile(
  tx: number, ty: number, mask: number,
): GroundPoint[][] {
  const dirs = dirsOf(mask);
  if (dirs.length === 0) return [];
  const centre = tileCentre(tx, ty);
  const off = SIDEWALK_OFFSET;
  const out: GroundPoint[][] = [];

  if (dirs.length === 1) {
    const d = dirs[0];
    const port = portPoint(tx, ty, d);
    const seg = [port, centre] as const;
    const left = offsetSegment(seg[0], seg[1], off, "left");
    const right = offsetSegment(seg[0], seg[1], off, "right");
    out.push([left[0], left[1]]);
    out.push([right[0], right[1]]);
    return out;
  }

  if (dirs.length === 2) {
    const [da, db] = dirs;
    const pa = portPoint(tx, ty, da);
    const pb = portPoint(tx, ty, db);
    // Figure from pa -> centre -> pb
    const left = offsetFigure3(pa, centre, pb, off, "left");
    const right = offsetFigure3(pa, centre, pb, off, "right");
    out.push(left);
    out.push(right);
    return out;
  }

  // Junction (>=3): each arm trimmed, left+right per arm
  const trim = JUNCTION_GAP;
  const t = trim / 0.5;
  for (const d of dirs) {
    const port = portPoint(tx, ty, d);
    const trimmed: GroundPoint = [
      centre[0] + (port[0] - centre[0]) * t,
      centre[1] + (port[1] - centre[1]) * t,
    ];
    const left = offsetSegment(port, trimmed, off, "left");
    const right = offsetSegment(port, trimmed, off, "right");
    out.push([left[0], left[1]]);
    out.push([right[0], right[1]]);
  }
  return out;
}

/**
 * Street light post positions for a town road tile.
 * - Bend (2 non-opposite): 1 light at outer corner (large gap bisector)
 * - T / 4-way (>=3): lights at each 90° gap bisector (corners of intersection)
 */
export function streetLightPositionsForTile(
  tx: number, ty: number, mask: number,
): GroundPoint[] {
  const dirs = dirsOf(mask);
  if (dirs.length < 2) return [];
  const centre = tileCentre(tx, ty);
  const sorted = [...dirs].sort((a, b) => dirAngle(a) - dirAngle(b));
  const angles = sorted.map(dirAngle);
  const gaps: { start: number; gap: number }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = angles[i];
    const nxt = angles[(i + 1) % angles.length];
    const gap = (nxt - cur + 360) % 360;
    gaps.push({ start: cur, gap: gap === 0 ? 360 : gap });
  }

  const dist = SIDEWALK_LIGHT_DISTANCE;
  const out: GroundPoint[] = [];

  if (dirs.length === 2) {
    const isOpposite = sorted[0] === OPPOSITE[sorted[1] as number];
    if (isOpposite) return []; // straight, no corner
    // bend: outer corner = large gap
    let large = gaps[0];
    for (const g of gaps) if (g.gap > large.gap) large = g;
    const bis = (large.start + large.gap / 2) % 360;
    const v = angleToVec(bis);
    out.push([centre[0] + v[0] * dist, centre[1] + v[1] * dist]);
    return out;
  }

  // >=3: lights at each 90° gap
  for (const g of gaps) {
    if (Math.abs(g.gap - 90) > 1e-6) continue;
    const bis = (g.start + g.gap / 2) % 360;
    const v = angleToVec(bis);
    out.push([centre[0] + v[0] * dist, centre[1] + v[1] * dist]);
  }
  return out;
}
