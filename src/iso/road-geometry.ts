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
