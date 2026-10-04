// ══════════════════════════════════════════════════════════════════════════
// ROADS (vector) — pure ground-plane geometry.
//
// This module knows nothing about canvases, textures, caches or the camera.
// It turns a tile's axis mask and resolved diagonal legs into paths in the LOGICAL GROUND
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
// boundary. Axis ports are edge midpoints; diagonal ports are corners. Each port is
// algebraically identical to the neighbour's opposite port:
//
//     (tx,ty) NE = (tx+0.5, ty)      == (tx,ty-1) SW = (tx+0.5, ty-1+1)
//     (tx,ty) SE = (tx+1, ty+0.5)    == (tx+1,ty) NW = (tx+1, ty+0.5)
//
// `sharedPortsAgree` in the unit tests pins this down for every direction.
// ══════════════════════════════════════════════════════════════════════════
import { NE, SE, SW, NW, DIRS, DIR, OPPOSITE, DIAGONAL_DIRS, type Dir } from "./track";

/** A point in the ground plane, in tile units. */
export type GroundPoint = readonly [number, number];

/** The four direction bits, in the order geometry walks them. */
export const ROAD_DIRS = DIRS;

/**
 * Port offsets from a tile's origin, in tile units. The midpoint of the edge
 * the direction leads through for axis arms; the shared corner for explicit
 * diagonals. Never infer a corner link from two merely occupied neighbours.
 */
export const PORT_OFFSET: Record<number, GroundPoint> = {
  [NE]: [0.5, 0],
  [SE]: [1, 0.5],
  [SW]: [0.5, 1],
  [NW]: [0, 0.5],
  ...Object.fromEntries(DIAGONAL_DIRS.map((d) => [d, [0.5 + DIR[d][0] / 2, 0.5 + DIR[d][1] / 2]])),
};

/** The centre of tile (tx,ty) in the ground plane. */
export const tileCentre = (tx: number, ty: number): GroundPoint =>
  [tx + 0.5, ty + 0.5];

/** The point where tile (tx,ty)'s road crosses its `dir` edge. */
export const portPoint = (tx: number, ty: number, dir: number): GroundPoint =>
  [tx + PORT_OFFSET[dir][0], ty + PORT_OFFSET[dir][1]];

/** The neighbour tile in `dir`. */
export const neighbourOf = (tx: number, ty: number, dir: number): [number, number] =>
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

/** D3: axis nibble plus RESOLVED logical diagonal directions. A raw tile's
 * stored 32/64 bits are not enough: incoming legs live on western neighbours.
 * Keep them separate from the PRESENT byte, as railRuns does for rail. */
export function roadDirections(mask: number, diagonal = 0): number[] {
  return [...dirsOf(mask), ...DIAGONAL_DIRS.filter((d) => (diagonal & d) !== 0)];
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
export function roadFigures(tx: number, ty: number, mask: number, diagonal = 0): RoadFigure[] {
  const centre = tileCentre(tx, ty);
  const dirs = roadDirections(mask, diagonal);
  if (dirs.length === 0) return [{ points: [centre] }];

  const out: RoadFigure[] = [];
  const left = new Set<number>(dirs);
  while (left.size) {
    const a = [...left][0];
    left.delete(a);
    // Prefer the straight-through partner, so a crossroads reads as two roads
    // crossing instead of four arms abutting.
    const opp = OPPOSITE[a];
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
  dir: number;
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
  /** ROADS-2 (#393): paved tier (absent/0 Road, 1 Street, 2 Highway, 3 Ramp, 4/5 Overpass). */
  tier?: number;
  /** ROADS-3 (#394): the road deck an overpass carries across its highway. */
  deck?: boolean;
  /** #420: unlike a highway crossing deck, this retains its own paved tier. */
  railDeck?: boolean;
  material: RoadMaterial;
  mask: number;
  /** Resolved logical directions, never a raw stored road byte. */
  diagonal?: number;
  figures: RoadFigure[];
  transitions: RoadTransition[];
  /**
   * #159: this tile is a town STREET — paved road inside a town's limits, so
   * its verges are kerbed sidewalks with corner lamps rather than soft dirt
   * shoulders (see the TOWN STREETS section at the foot of this file).
   *
   * A property of the TILE, decided by the caller from the map's occupancy,
   * not of the material: a town's streets are paved by the generator, and a
   * gravel lane crossing a town's limits is not one of them.
   */
  sidewalk: boolean;
  /** TOWN-4.2 (#678): set on Avenue tiles — the carriageway axis, which side
   * of the pair this tile is on (outer side of the planted median), and
   * whether it is a junction cell. Drives the offset figures, the outer
   * sidewalk and the median passes. */
  avenue?: AvenueInfo;
  /** TOWN-4.4 (#680): set on a planned town's cul-de-sac circle tile
   * (`TownPlan.culDeSacs`) — the lane ends in a kerbed turning circle instead
   * of a raw stub. Drives the disc + kerb pass; the tile's own figures and
   * sidewalks are the ordinary dead-end ones, which the disc covers. */
  culDeSac?: boolean;
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
  /**
   * #159: is this tile inside a town's limits? Defaults to false, so every
   * caller that does not know about towns gets exactly the rural road it
   * always got.
   */
  town = false,
  diagonal = 0,
  /** TOWN-4.2 (#678): Avenue context — offset figures, outer sidewalk. */
  avenue?: AvenueInfo,
): RoadTile {
  const mask = maskOf(cell);
  // An Avenue draws its own offset cross-section; diagonals never ride one.
  const figures = avenue ? avenueFigures(tx, ty, mask, avenue) : roadFigures(tx, ty, mask, diagonal);
  const transitions: RoadTransition[] = [];
  if (material === "dirt") {
    const centre = tileCentre(tx, ty);
    for (const dir of roadDirections(mask, diagonal)) {
      const [nx, ny] = neighbourOf(tx, ty, dir);
      if (!pavedAt(nx, ny)) continue;
      const port = portPoint(tx, ty, dir);
      // Inward along the arm, toward the centre. Axis arms are 0.5 long, diagonal arms √0.5,
      // so the blend cannot reach the junction at the default width.
      const t = TRANSITION_BLEND / Math.hypot(port[0] - centre[0], port[1] - centre[1]);
      transitions.push({
        dir,
        from: port,
        to: [port[0] + (centre[0] - port[0]) * t, port[1] + (centre[1] - port[1]) * t],
      });
    }
  }
  return {
    tx, ty, material, mask, ...(diagonal ? { diagonal } : {}), figures, transitions,
    // An Avenue always has its OUTER sidewalk (see avenueSidewalkPaths).
    sidewalk: (town && material === "paved") || !!avenue,
    ...(avenue ? { avenue } : {}),
  };
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
export function paintFigures(tx: number, ty: number, mask: number, diagonal = 0): RoadFigure[] {
  const dirs = roadDirections(mask, diagonal);
  if (dirs.length < 2) return [];
  const centre = tileCentre(tx, ty);
  const junction = dirs.length >= 3;
  const trim = junction ? JUNCTION_GAP : 0;

  const out: RoadFigure[] = [];
  const toward = (port: GroundPoint, by: number): GroundPoint => {
    if (by === 0) return centre;
    const t = by / Math.hypot(port[0] - centre[0], port[1] - centre[1]);
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

/** Single width contract for bounds, sidewalks and every raster pass. */
export const roadWidth = (tile: RoadTile): number =>
  tile.material !== "paved" ? ROAD_WIDTH[tile.material]
    : tile.deck && !tile.railDeck ? ROAD_WIDTH.paved
      : (tile.tier === 2 || tile.tier === 4 || tile.tier === 5) ? ROAD_WIDTH.paved * 1.6
        : tile.tier === 3 ? ROAD_WIDTH.paved * 1.2
          : tile.tier === 1 ? ROAD_WIDTH.paved * 0.8 : ROAD_WIDTH.paved;

export const sidewalkOffset = (tile: RoadTile): number =>
  roadWidth(tile) / 2 + SHOULDER_WIDTH + SIDEWALK_WIDTH / 2;

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
  const road = roadWidth(tile) / 2 + SHOULDER_WIDTH;
  // A town street's sidewalk reaches further out than its shoulder does, and
  // the bounds are what tells a cache which tiles to look at, so the wider of
  // the two is the honest number.
  const pad = tile.sidewalk ? Math.max(road, sidewalkOffset(tile) + SIDEWALK_WIDTH / 2) : road;
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

// ══════════════════════════════════════════════════════════════════════════
// #159 TOWN STREETS — sidewalks and corner street lamps.
//
// A paved road inside a town's limits is not a rural highway, and it should
// not be drawn as one. This section gives such a tile a CROSS-SECTION, from
// its centre-line outward, measured in the same tile units as everything
// else here:
//
//     0.00 ─ 0.39   asphalt core        ROAD_WIDTH.paved / 2
//     0.39 ─ 0.42   gutter / kerb       SHOULDER_WIDTH (the existing verge)
//     0.42 ─ 0.49   sidewalk ribbon     SIDEWALK_WIDTH
//     0.49 ─ 0.50   frontage
//
// The ribbon begins exactly where the shoulder ends, so the three bands meet
// edge to edge and the dark gutter reads as the shadow a raised slab casts on
// the road beside it.
//
// THE SIDEWALK STAYS INSIDE ITS OWN TILE (0.49 < 0.5). That is the property
// that makes two tiles — and therefore two cache chunks — agree at a port
// without a shared state of any kind: each tile draws its own half of a
// continuous ribbon and the two halves are butt-joined at exactly the port
// point, the way the road's own arms already are. The same argument that
// hangs the port contract on tile-edge midpoints hangs the sidewalk on it.
//
// SIDEWALKS ARE NOT OFFSET ROAD FIGURES. Offsetting a whole figure (say the
// straight run through a crossroads) would paint a ribbon straight across the
// crossing carriageway: a sidewalk in the middle of a junction. Instead each
// ARM contributes its own two flank ribbons, from the port to the CENTRE, and
// the renderer paints them BEFORE any asphalt. A ribbon that runs into
// another street is then simply covered by that street's core — the junction
// trims every approach without one clip, and where two ribbons cross at a
// corner they overprint to form the corner apron.
//
// Only the two cases the arms cannot express get a curve of their own:
//
//   • a BEND, whose INSIDE corner is a quarter arc of radius SIDEWALK_OFFSET
//     around the tile centre — the kerb radius that carries the walkway round
//     the turn, with the asphalt's own round join concentric and 0.03 of
//     gutter inside it — and
//   • a DEAD END, whose cap is the same arc stretched over half a turn.
//
// Both are traced as polylines, so everything downstream — the ribbon stroke,
// the joint walker, the tests — handles a curve and a straight run alike.
// ══════════════════════════════════════════════════════════════════════════
/**
 * The width of a sidewalk ribbon, in tile units.
 *
 * Narrow on purpose. It is a kerb and a walkway between an asphalt edge and a
 * building frontage, not a road; at the 1× projection this is roughly 2.5
 * screen pixels across, which is what lets the joints below be read as blocks
 * rather than as stripes on a pavement the size of a lane.
 */
export const SIDEWALK_WIDTH = 0.07;

/**
 * Distance from the road's centre-line to the ribbon's centre-line.
 *
 * Derived, not chosen: the ribbon starts at the asphalt edge plus the gutter
 * (`ROAD_WIDTH.paved / 2 + SHOULDER_WIDTH` = 0.42) and is SIDEWALK_WIDTH
 * wide, so its outer edge lands at 0.49 — one hundredth of a tile of frontage
 * left over, and not a pixel of the neighbouring tile taken.
 */
export const SIDEWALK_OFFSET = ROAD_WIDTH.paved / 2 + SHOULDER_WIDTH + SIDEWALK_WIDTH / 2;

/**
 * Distance between two transverse joints along a ribbon, in tile units.
 *
 * This is the "concrete slab" pitch: exactly four slabs per tile, so every
 * tile carries the same joints and the pitch runs across a port with no seam.
 * With SIDEWALK_JOINT_PHASE at half a pitch a joint lands 0.125 from a port
 * or the tile centre (where two arms meet),
 * never on one.
 */
export const SIDEWALK_JOINT_SPACING = 0.25;

/**
 * Where the joint lattice sits in the world: joints on a straight run fall at
 * `SIDEWALK_JOINT_PHASE + k · SIDEWALK_JOINT_SPACING` along the run's axis, in
 * ABSOLUTE tile coordinates.
 *
 * Two things follow, and both are load-bearing:
 *
 *   • two tiles, or two cache chunks, place the same joints, because the
 *     lattice is a property of the world and not of the tile being painted;
 *   • no joint ever lands on a port or a tile centre: those sit at whole or
 *     half tile units and the lattice at 0.125 + k·0.25, a clear eighth of a
 *     tile away, so every tile carries the same four slabs per flank.
 */
export const SIDEWALK_JOINT_PHASE = SIDEWALK_JOINT_SPACING / 2;

/**
 * How far a joint stops short of the ribbon's edge, in tile units, on EACH
 * side — the "offset and shortened" dark line of the ticket.
 *
 * The point of it is the illusion: a light grey perimeter that the dark ink
 * never touches makes every block read as an individual slab with a raised,
 * bevelled edge, whereas a joint drawn clean across the ribbon reads as two
 * separate strips of paint. About 0.4 of a screen pixel at 1×, so the ribbon
 * keeps its outline without the joint vanishing.
 */
export const SIDEWALK_JOINT_INSET = 0.012;

/**
 * How close to the end of a run a joint's centre may sit, in tile units.
 *
 * The lattice can land 0.01 short of a port (see SIDEWALK_JOINT_PHASE), and
 * half of a joint's own thickness would then hang over the port into a
 * neighbouring tile that may have no sidewalk at all. A joint is dropped
 * rather than overhanging: the block it would have closed is one hundredth of
 * a tile wider than its neighbours, and the overhang is the thing that shows.
 */
export const SIDEWALK_JOINT_MARGIN = 0.012;

/** Pieces a quarter-turn arc is cut into. Eight is smooth at 2× and cheap. */
export const SIDEWALK_ARC_SEGMENTS = 8;

/**
 * The four tile corners, as the signs of the quadrant each one opens into:
 * `(sx, sy)` names the corner whose ground point is
 * `tileCentre + (sx · 0.5, sy · 0.5)` — the diamond's right, top, left and
 * bottom vertices, in that order.
 */
const QUADRANTS: readonly (readonly [number, number])[] = [
  [1, -1],    // right vertex
  [-1, -1],   // top vertex
  [-1, 1],    // left vertex
  [1, 1],     // bottom vertex
];

/**
 * Which arm is the one that runs ALONG each ground axis, and in which
 * direction: `ARM_AT_Y[-1] = NE` is the arm heading north (ground v − 1), and
 * `ARM_AT_X[1] = SE` the arm heading east (u + 1).
 *
 * A flank of that arm is the ribbon parallel to it, offset to one side — so an
 * arm heading north leaves its two flanks at u = tileCentre ± SIDEWALK_OFFSET,
 * running through the tile's NORTHERN half (v from the centre-line to the
 * port). An arm's flanks therefore always lie in the two quadrants on the side
 * it heads towards: NE's are in the top-left and top-right ones.
 */
const ARM_AT_Y: Record<number, Dir> = { [-1]: NE, [1]: SW };
const ARM_AT_X: Record<number, Dir> = { [-1]: NW, [1]: SE };

const hasArm = (mask: number, dir: Dir): boolean => (mask & dir) !== 0;

/**
 * The tile's corners where the walkway has to TURN — round the outside of a
 * bend, round the inside of one, round the end of a dead end.
 *
 * Quadrant (sx, sy) holds the flank of the arm heading along y with sign sy
 * and the flank of the arm heading along x with sign sx: an arm's ribbons lie
 * on the side it HEADS TOWARDS, so the NE arm's two flanks (parallel to v, at
 * u = centre ± OFFSET) both lie in the north half. Everything about a corner
 * follows from which of those two arms are there:
 *
 *   • BOTH are. The two ribbons meet inside the quadrant and the walkway turns
 *     between them. This is the OUTSIDE of a bend — and at a T-junction or a
 *     crossroad it is a kerb corner, where the junction's own asphalt is
 *     painted over the arc and only the corner, and its lamp, survive.
 *
 *   • NEITHER is, and the tile has road somewhere. The walkway turns the other
 *     way: this is the INSIDE of a bend, where the two flanks that ran along
 *     the far sides of the arms have to be joined by a kerb return, exactly as
 *     a real one is. It is also the whole of a DEAD END's cap, which is the
 *     same construction — a street whose two flanks have nowhere to go but
 *     round the end of it.
 *
 *   • Exactly ONE is. The walkway runs straight through the quadrant: no
 *     corner, no arc.
 *
 * A lone PAD — road on a tile that connects to nothing — turns nowhere: it is
 * a stub in open ground, and it keeps the plain core it has always had.
 */
function cornerQuadrants(mask: number): [number, number][] {
  const out: [number, number][] = [];
  if (dirsOf(mask).length === 0) return out;
  for (const [sx, sy] of QUADRANTS) {
    const alongY = hasArm(mask, ARM_AT_Y[sy]);
    const alongX = hasArm(mask, ARM_AT_X[sx]);
    if (alongY === alongX) out.push([sx, sy]);      // both arms, or neither
  }
  return out;
}

/**
 * The OUTER corners — the quadrants where two arms meet and the walkway turns
 * between them: the outside of a bend, a T-junction's branch mouths, the
 * corners of a crossroad.
 *
 * The ones a lamp belongs on, and NOT the kerb returns above. A bend has two
 * turns, one either side of the road, and they are not the same thing to look
 * at: the outer one sweeps round the corner the driver is coming to, which is
 * the one the ticket asks to light, while the inner one is the quiet side of
 * the block. Lighting both would also put four lamps on every bend, which is
 * the crowded look the crossroads rule exists to avoid.
 */
function outerCornerQuadrants(mask: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [sx, sy] of QUADRANTS) {
    if (hasArm(mask, ARM_AT_Y[sy]) && hasArm(mask, ARM_AT_X[sx])) out.push([sx, sy]);
  }
  return out;
}

/** The quarter-arc a turn leaves in a quadrant, as a polyline of ground points. */
function arcFigure(centre: GroundPoint, sx: number, sy: number): RoadFigure {
  const points: GroundPoint[] = [];
  for (let i = 0; i <= SIDEWALK_ARC_SEGMENTS; i++) {
    const a = (i / SIDEWALK_ARC_SEGMENTS) * (Math.PI / 2);
    points.push([
      centre[0] + sx * SIDEWALK_OFFSET * Math.cos(a),
      centre[1] + sy * SIDEWALK_OFFSET * Math.sin(a),
    ]);
  }
  return { points };
}

/**
 * One tile's sidewalk ribbons, as paths to stroke with SIDEWALK_WIDTH.
 *
 * `mask` is the connection nibble, exactly as `maskOf` returns it and as
 * `roadFigures` takes it. Every path begins or ends on a port or on the tile's
 * centre-lines: ports are where the neighbour's ribbon continues this one, and
 * the centre-lines are where the junction's own asphalt will cover it.
 */
export function sidewalkPaths(tx: number, ty: number, mask: number, diagonal = 0, offset = SIDEWALK_OFFSET): RoadFigure[] {
  if (diagonal || offset !== SIDEWALK_OFFSET) return angledSidewalks(tx, ty, mask, diagonal, offset);
  const centre = tileCentre(tx, ty);
  const out: RoadFigure[] = [];
  for (const d of dirsOf(mask)) {
    const port = portPoint(tx, ty, d);
    const du = port[0] - centre[0], dv = port[1] - centre[1];
    // The arm is half a tile long, so (-dv, du)·2 is the unit perpendicular
    // pointing along it: one flank on each side, from the port to the centre.
    for (const side of [-1, 1]) {
      const off: GroundPoint = [-side * dv * 2 * SIDEWALK_OFFSET, side * du * 2 * SIDEWALK_OFFSET];
      out.push({
        points: [
          [centre[0] + off[0], centre[1] + off[1]],
          [port[0] + off[0], port[1] + off[1]],
        ],
      });
    }
  }
  for (const [sx, sy] of cornerQuadrants(mask)) {
    out.push(arcFigure(centre, sx, sy));
  }
  return out;
}

/** Directions sorted around the centre, shared by ribbons and corner lamps. */
function angularArms(mask: number, diagonal: number) {
  return roadDirections(mask, diagonal).map((d) => {
    const [dx, dy] = DIR[d], length = Math.hypot(dx, dy);
    return { d, u: dx / length, v: dy / length, length: length / 2, angle: Math.atan2(dy, dx) };
  }).sort((a, b) => a.angle - b.angle);
}

function angledSidewalks(tx: number, ty: number, mask: number, diagonal: number, offset: number): RoadFigure[] {
  const c = tileCentre(tx, ty), arms = angularArms(mask, diagonal), out: RoadFigure[] = [];
  for (const arm of arms) {
    const port = portPoint(tx, ty, arm.d);
    for (const side of [-1, 1]) {
      const du = -arm.v * side * offset, dv = arm.u * side * offset;
      out.push({ points: [[c[0] + du, c[1] + dv], [port[0] + du, port[1] + dv]] });
    }
  }
  // Outside a bend (or the cap of a dead end), join the tangent ribbons by
  // an arc. Inside junctions the other arms' opaque cores trim the ribbons,
  // just as in the original four-direction sidewalk pass.
  for (let i = 0; i < arms.length; i++) {
    const a = arms[i].angle, b = arms[(i + 1) % arms.length].angle + (i === arms.length - 1 ? 2 * Math.PI : 0);
    if (b - a <= Math.PI + 1e-9) continue;
    const start = a + Math.PI / 2, end = b - Math.PI / 2;
    const steps = Math.ceil((end - start) / (Math.PI / 2) * SIDEWALK_ARC_SEGMENTS);
    const points: GroundPoint[] = [];
    for (let k = 0; k <= steps; k++) {
      const angle = start + (end - start) * k / steps;
      points.push([c[0] + offset * Math.cos(angle), c[1] + offset * Math.sin(angle)]);
    }
    out.push({ points });
  }
  return out;
}

function angledLampSpots(tx: number, ty: number, mask: number, diagonal: number, offset: number): GroundPoint[] {
  const c = tileCentre(tx, ty), arms = angularArms(mask, diagonal), out: GroundPoint[] = [];
  if (!arms.length || (arms.length === 2 && OPPOSITE[arms[0].d] === arms[1].d)) return out;
  for (let i = 0; i < arms.length; i++) {
    const a = arms[i], b = arms[(i + 1) % arms.length];
    const gap = b.angle - a.angle + (i === arms.length - 1 ? 2 * Math.PI : 0);
    if (gap <= 1e-9) continue;
    // Bends light their OUTSIDE arc only. At a junction the lamp sits on the
    // intersection of the two flank ribbons, never at an arbitrary radius
    // inside the asphalt. Acute mouths may have no room for furniture.
    if (arms.length === 2 && gap <= Math.PI) continue;
    const radius = gap >= Math.PI ? offset : offset / Math.sin(gap / 2);
    if (gap < Math.PI && offset / Math.tan(gap / 2) > Math.min(a.length, b.length)) continue;
    const angle = a.angle + gap / 2;
    out.push([c[0] + radius * Math.cos(angle), c[1] + radius * Math.sin(angle)]);
  }
  if (out.length <= 2) return out;
  const phase = (tx + ty) & 1;
  return out.filter((_, i) => (i & 1) === phase).slice(0, 2);
}

/**
 * The transverse joints along one ribbon: the dark concrete-slab dividers.
 *
 * Each joint is a short segment ACROSS the ribbon, and it is cut back by
 * SIDEWALK_JOINT_INSET at both ends so the light grey outline of the slab
 * survives around it (see that constant).
 *
 * Every joint lies along a ground AXIS (the iso grid's own lines on screen),
 * placed on the absolute lattice of the segment's dominant axis — straights,
 * diagonals and bends alike — so the joints of neighbouring tiles and cache
 * chunks line up. Off-axis segments get a longer joint so it still spans the
 * ribbon.
 */
export function sidewalkJoints(path: RoadFigure): RoadFigure[] {
  const pts = path.points;
  const out: RoadFigure[] = [];
  if (pts.length < 2) return out;
  const half = (SIDEWALK_WIDTH - SIDEWALK_JOINT_INSET * 2) / 2;
  const last = pts.length - 2;
  // Every joint lies along a GROUND axis, so on screen it runs at the iso
  // grid's own ±0.5 slope, and it sits on the absolute lattice
  // `SIDEWALK_JOINT_PHASE + k · SIDEWALK_JOINT_SPACING` of the segment's
  // dominant axis — the same lattice on every tile, straight or curved.
  for (let i = 0; i <= last; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const axis = Math.abs(dx) >= Math.abs(dy) - 1e-9 ? 0 : 1;
    const a = axis === 0 ? ax : ay, b = axis === 0 ? bx : by, span = b - a;
    if (Math.abs(span) < 1e-9) continue;
    // Margins only at the ends of the whole path; interior segments are
    // half-open so a shared vertex is never jointed twice.
    const dir = Math.sign(span);
    const from = a + dir * (i === 0 ? SIDEWALK_JOINT_MARGIN : 0);
    const to = b - dir * (i === last ? SIDEWALK_JOINT_MARGIN : 0);
    const lo = Math.min(from, to), hi = Math.max(from, to);
    // The joint runs along the OTHER axis, long enough to span the ribbon.
    const ux = dx / len, uy = dy / len;
    const cross = axis === 0 ? Math.abs(ux) : Math.abs(uy);
    const reach = half / Math.max(cross, 1e-6);
    const k0 = Math.ceil((lo - SIDEWALK_JOINT_PHASE) / SIDEWALK_JOINT_SPACING - 1e-9);
    for (let k = k0; ; k++) {
      const t = SIDEWALK_JOINT_PHASE + k * SIDEWALK_JOINT_SPACING;
      if (t > hi + 1e-9) break;
      // Half-open toward b on interior vertices.
      if (i !== last && Math.abs(t - b) < 1e-9) continue;
      const f = (t - a) / span;
      const x = ax + dx * f, y = ay + dy * f;
      out.push(axis === 0
        ? { points: [[x, y - reach], [x, y + reach]] }
        : { points: [[x - reach, y], [x + reach, y]] });
    }
  }
  return out;
}

/**
 * Where a tile's street lamps stand, one post each, on its sidewalk.
 *
 * The ticket's rule is "corners and intersections, at the outer corner of the
 * sidewalk curve", which is what this returns:
 *
 *   • a BEND lights the middle of its outer arc — the one corner a driver
 *     actually rounds a lamp to see the kerb by;
 *   • a T-JUNCTION lights both corner aprons of the branch mouth, so the
 *     turn is legible from either approach;
 *   • a CROSSROAD would light all four corners, which is four lamps every
 *     three tiles and reads as a runway. It lights the two facing each other
 *     on the diagonal this tile's parity picks instead, so a street of
 *     crossroads alternates rather than stamps;
 *   • a DEAD END lights the apex of its cap — the end of the street;
 *   • a straight run and a lone pad light nothing: there is no corner there.
 *
 * Every point returned lies ON the ribbon (SIDEWALK_OFFSET from the road's
 * centre-line, or from the tile centre for an arc), so a lamp can never end up
 * standing in the carriageway or on the grass.
 */
export function streetLampSpots(tx: number, ty: number, mask: number, diagonal = 0, offset = SIDEWALK_OFFSET): GroundPoint[] {
  if (diagonal || offset !== SIDEWALK_OFFSET) return angledLampSpots(tx, ty, mask, diagonal, offset);
  const dirs = dirsOf(mask);
  const centre = tileCentre(tx, ty);
  const out: GroundPoint[] = [];

  if (dirs.length === 0) return out;                 // a lone pad is a plaza
  if (dirs.length === 1) {
    // The cap bulges away from the arm, so its apex is opposite the port.
    const [dx, dy] = DIR[dirs[0]];
    return [[centre[0] - dx * SIDEWALK_OFFSET, centre[1] - dy * SIDEWALK_OFFSET]];
  }

  // The OUTER corners: the frames a lamp is placed against. A crossroads has
  // four of them, and lighting all four every three tiles reads as a runway,
  // so the two on one diagonal are lit and the diagonal alternates with the
  // tile's parity — a street of crossroads then alternates rather than
  // stamping the same fixture over and over.
  const litDiagonal = ((tx + ty) & 1) === 0 ? -1 : 1;   // the sx·sy of the lit pair
  for (const [sx, sy] of outerCornerQuadrants(mask)) {
    if (dirs.length === 4 && sx * sy !== litDiagonal) continue;
    // A bend's corner is an ARC, and the lamp stands at 45° round it.
    const on = dirs.length === 2 && (mask & OPPOSITE[dirs[0]]) === 0 ? 1 / Math.SQRT2 : 1;
    out.push([
      centre[0] + sx * SIDEWALK_OFFSET * on,
      centre[1] + sy * SIDEWALK_OFFSET * on,
    ]);
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// #159 follow-up — TOWN GROUND: the paved blocks a town's streets enclose.
//
// A town's street grid divides it into 2×2-tile BLOCKS, and the generator puts
// its houses on the tiles of those blocks. Drawing nothing there leaves each
// block as a patch of raw grass inside a grid of kerbed streets, which reads
// as a lawn with roads around it rather than as a settlement.
//
// So a block is PAVED: every tile the town's own houses occupy gets a yard of
// its own, tucked under the kerbs around it. The buildings then stand on
// pavement, the kerbs bound it, and the whole square reads as one made surface
// from street to street.
//
// The yard is the tile itself, with one adjustment: a side that faces a STREET
// reaches OVERLAP further out, under the kerb. Without that extra band the
// paving would stop 0.01 of a tile short of the sidewalk — the hairline of
// grass between the tile's edge and the walkway's outer edge, running the
// whole length of every street — and with it the kerb is painted on top of the
// yard instead of beside a gap. The overlap is covered by the sidewalk and the
// road it reaches under, and nothing of it can show.
// ══════════════════════════════════════════════════════════════════════════
/**
 * How far a paved yard reaches under the kerb of a street beside it, in tile
 * units. Comfortably more than the 0.01 of frontage the walkway leaves, and
 * comfortably less than the 0.08 from a street's tile edge to its asphalt.
 */
export const TOWN_GROUND_OVERLAP = 0.06;

/**
 * The paving of one town block tile, as a quad in the ground plane.
 *
 * `streetAt` reports whether the tile in that direction carries the town's
 * paved street — the sides the yard grows under. The quad is traced clockwise
 * from its north-west corner, which is the order the renderer fills in; the
 * shape is deliberately axis-aligned rather than the tile's rotated diamond,
 * because a block of four such tiles has to tile the block exactly with no
 * seam and no overlap along the two shared edges.
 */
export function townGroundQuad(
  tx: number, ty: number, streetAt: (tx: number, ty: number) => boolean,
): GroundPoint[] {
  const over = (x: number, y: number) => streetAt(x, y) ? TOWN_GROUND_OVERLAP : 0;
  const u0 = tx - over(tx - 1, ty), u1 = tx + 1 + over(tx + 1, ty);
  const v0 = ty - over(tx, ty - 1), v1 = ty + 1 + over(tx, ty + 1);
  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
}

/** Join exact shared endpoints into continuous runs in O(points + figures).
 * Stops at branches, visits every edge once, and handles closed loops. Only
 * invoked when baking a chunk: no geometry or graph traversal on cache hits. */
export function continuousRoadFigures(figures: readonly RoadFigure[]): RoadFigure[] {
  const edges = figures.filter((f) => f.points.length > 1);
  const nodes = new Map<string, number[]>();
  const key = (p: GroundPoint) => `${p[0]},${p[1]}`;
  const ends = edges.map((f, i) => {
    const pair = [key(f.points[0]), key(f.points[f.points.length - 1])];
    for (const k of pair) { const list = nodes.get(k) ?? []; list.push(i); nodes.set(k, list); }
    return pair;
  });
  const seen = new Set<number>(), out = figures.filter((f) => f.points.length === 1);
  const walk = (first: number, start: string) => {
    const points: GroundPoint[] = [];
    let edge = first, at = start;
    while (!seen.has(edge)) {
      seen.add(edge);
      const forward = ends[edge][0] === at;
      const leg = forward ? edges[edge].points : [...edges[edge].points].reverse();
      points.push(...(points.length ? leg.slice(1) : leg));
      at = ends[edge][forward ? 1 : 0];
      const neighbours = nodes.get(at)!;
      if (neighbours.length !== 2) break;
      const next = neighbours.find((e) => !seen.has(e));
      if (next === undefined) break;
      edge = next;
    }
    out.push({ points });
  };
  for (const [k, es] of nodes) if (es.length !== 2) for (const e of es) if (!seen.has(e)) walk(e, k);
  for (let e = 0; e < edges.length; e++) if (!seen.has(e)) walk(e, ends[e][0]);
  return out;
}

/** #420 item 3: solid dividers are runs, not one stroke per highway tile.
 * Overpass highway lanes participate; crossing decks and ramps do not. */
export function highwayDividerFigures(tiles: readonly RoadTile[]): RoadFigure[] {
  const figures: RoadFigure[] = [];
  for (const t of tiles) {
    if ((t.deck && !t.railDeck) || t.material !== "paved" || ![2, 4, 5].includes(t.tier ?? 0)) continue;
    const dirs = roadDirections(t.mask, t.diagonal);
    if (dirs.length === 1) figures.push({ points: [tileCentre(t.tx, t.ty), portPoint(t.tx, t.ty, dirs[0])] });
    else figures.push(...paintFigures(t.tx, t.ty, t.mask, t.diagonal));
  }
  return continuousRoadFigures(figures);
}

// ══════════════════════════════════════════════════════════════════════════
// TOWN-4.2 (#678) AVENUE — the two-tile boulevard, in ground space.
//
// One tile of an Avenue pair is a slice of ONE boulevard, not a road that
// happens to sit beside another road. The cross-section (sums to exactly one
// tile, measured from this tile's outer edge inward):
//
//     0.00 ─ 0.06   frontage          AVENUE_FRONTAGE
//     0.06 ─ 0.13   outer sidewalk    SIDEWALK_WIDTH (OUTER edge only)
//     0.13 ─ 0.91   carriageway       ROAD_WIDTH.paved, centre offset 0.02
//                                     toward the median (AVENUE_BIAS)
//     0.91 ─ 1.09   planted median    MEDIAN_WIDTH — straddles the SHARED
//                                     edge, so only the pair's outer=−1 cell
//                                     draws it (exactly once per pair-tile)
//
// The carriageway centreline therefore sits 0.02 off the tile centre toward
// the partner, and every figure — surface, dashes, sidewalks — runs along
// that offset line. Neighbour tiles compute the SAME offset (their partner
// side agrees), so ports still butt-join exactly like roadFigures'.
//
// A corner needs no special figure: two straight offset runs simply overlap
// on the interface cells (a "wide bend"), because each run's figures reach
// their port and the neighbour's reach back. Junction cells add a short
// cross stub from each cross-arm port to the offset centreline so the
// asphalt stays continuous where a street threads the pair.
// ══════════════════════════════════════════════════════════════════════════

/** Everything a tile needs to draw itself as half a boulevard. */
export type AvenueInfo = {
  /** Carriageway axis: "x" lanes run SE/NW, "y" lanes run NE/SW. */
  axis: "x" | "y";
  /** Which perpendicular side this tile's OUTERMOST edge is on (−1 draws the
   *  median strip, because the partner then sits on its +side). */
  outer: -1 | 1;
  /** `avenueJunction` — the median opens and the flow painter may draw here. */
  junction: boolean;
};

/** The planted median's width, straddling the shared edge between the pair. */
export const MEDIAN_WIDTH = 0.18;
/** Frontage between the outer sidewalk and the tile edge (1 − half median −
 *  sidewalk − carriageway). Fits the cross-section to exactly one tile. */
export const AVENUE_FRONTAGE = 1 - MEDIAN_WIDTH / 2 - SIDEWALK_WIDTH - ROAD_WIDTH.paved;
/** How far the carriageway centreline sits from the tile centre, toward the
 *  median — frontage + sidewalk + half carriageway − half tile (0.02). */
export const AVENUE_BIAS = AVENUE_FRONTAGE + SIDEWALK_WIDTH + ROAD_WIDTH.paved / 2 - 0.5;

const alongDirs = (axis: "x" | "y"): number[] => axis === "x" ? [SE, NW] : [NE, SW];
const crossDirs = (axis: "x" | "y"): number[] => axis === "x" ? [NE, SW] : [SE, NW];

/** The tile-centre point of the carriageway's offset centreline. */
export function avenueCentre(tx: number, ty: number, info: AvenueInfo): GroundPoint {
  return info.axis === "x"
    ? [tx + 0.5, ty + 0.5 - AVENUE_BIAS * info.outer]
    : [tx + 0.5 - AVENUE_BIAS * info.outer, ty + 0.5];
}

/** The offset port where the centreline meets the `dir` edge — algebraically
 *  the same point on both sides of the shared edge, exactly like portPoint. */
export function avenuePort(tx: number, ty: number, info: AvenueInfo, dir: number): GroundPoint {
  const c = avenueCentre(tx, ty, info);
  if (dir === SE) return [tx + 1, c[1]];
  if (dir === NW) return [tx, c[1]];
  if (dir === SW) return [c[0], ty + 1];
  return [c[0], ty]; // NE
}

/**
 * The asphalt of one Avenue tile: the offset straight run along the
 * carriageway (paired through the offset centreline, like roadFigures), plus
 * — at junction cells only — a cross stub from each cross-arm port to that
 * centreline so a street threading the pair leaves no gap. Never a figure
 * across the median outside a junction; the median pass covers that ground.
 */
export function avenueFigures(tx: number, ty: number, mask: number, info: AvenueInfo): RoadFigure[] {
  const c = avenueCentre(tx, ty, info);
  const [alongA, alongB] = alongDirs(info.axis);
  const hasA = (mask & alongA) !== 0, hasB = (mask & alongB) !== 0;
  const out: RoadFigure[] = [];
  if (hasA && hasB) {
    out.push({ points: [avenuePort(tx, ty, info, alongA), c, avenuePort(tx, ty, info, alongB)] });
  } else if (hasA || hasB) {
    out.push({ points: [c, avenuePort(tx, ty, info, hasA ? alongA : alongB)] });
  } else {
    out.push({ points: [c] }); // pad — isolated carriageway tile
  }
  if (info.junction) {
    for (const d of crossDirs(info.axis)) {
      if (!(mask & d)) continue;
      out.push({ points: [portPoint(tx, ty, d), c] });
    }
  }
  return out;
}

/**
 * The dashed lane divider along the offset centreline — `paintFigures`'
 * rules on the boulevard's line: two arms or more, trimmed back from the
 * centre at a junction, nothing on a stub, and NOTHING across the median or
 * the cross stubs (an Avenue has no centre line — flow-paint owns junction
 * zebras, and only Streets carry a painted centre line).
 */
export function avenuePaintFigures(tx: number, ty: number, mask: number, info: AvenueInfo): RoadFigure[] {
  const [a, b] = alongDirs(info.axis);
  const hasA = (mask & a) !== 0, hasB = (mask & b) !== 0;
  if (!hasA || !hasB) return [];                    // no through-route, no paint
  const dirs = (hasA ? 1 : 0) + (hasB ? 1 : 0)
    + crossDirs(info.axis).filter((d) => mask & d).length;
  const trim = dirs >= 3 ? JUNCTION_GAP : 0;
  const c = avenueCentre(tx, ty, info);
  const arm = (d: number): GroundPoint[] => {
    const port = avenuePort(tx, ty, info, d);
    if (trim === 0) return [port, c];
    const len = Math.hypot(port[0] - c[0], port[1] - c[1]) || 1;
    const t = (len - trim) / len;
    return [port, [c[0] + (port[0] - c[0]) * t, c[1] + (port[1] - c[1]) * t]];
  };
  return [{ points: arm(a) }, { points: arm(b) }];
}

/**
 * The outer-edge sidewalk flanks (full tile run each) plus the END CAP: a
 * transverse segment across the whole boulevard face where a carriageway arm
 * is genuinely missing (a dead end). Both pair cells compute the same cap,
 * so a chunk boundary never splits it. Junction cross-arms are left to the
 * street's own sidewalks — an Avenue never draws a sidewalk through the
 * median it shares with its partner.
 */
export function avenueSidewalkPaths(tx: number, ty: number, mask: number, info: AvenueInfo): RoadFigure[] {
  const { axis, outer } = info;
  const out: RoadFigure[] = [];
  // The outer flank: tile centre + outer × (0.5 − frontage − half sidewalk).
  const reach = 0.5 - AVENUE_FRONTAGE - SIDEWALK_WIDTH / 2;
  if (axis === "x") {
    const v = ty + 0.5 + outer * reach;
    out.push({ points: [[tx, v], [tx + 1, v]] });
    const lo = Math.min(ty, ty - outer);              // the pair's lower row
    for (const [d, u] of [[SE, tx + 1], [NW, tx]] as [number, number][]) {
      if (mask & d) continue;                         // arm continues — no cap
      out.push({ points: [[u, lo + AVENUE_FRONTAGE + SIDEWALK_WIDTH / 2],
        [u, lo + 1 + 1 - AVENUE_FRONTAGE - SIDEWALK_WIDTH / 2]] });
    }
  } else {
    const u = tx + 0.5 + outer * reach;
    out.push({ points: [[u, ty], [u, ty + 1]] });
    const lo = Math.min(tx, tx - outer);
    for (const [d, v] of [[SW, ty + 1], [NE, ty]] as [number, number][]) {
      if (mask & d) continue;
      out.push({ points: [[lo + AVENUE_FRONTAGE + SIDEWALK_WIDTH / 2, v],
        [lo + 1 + 1 - AVENUE_FRONTAGE - SIDEWALK_WIDTH / 2, v]] });
    }
  }
  return out;
}

/**
 * The planted median strip's quad — drawn ONLY by the pair cell whose
 * partner is on its +side (`outer === −1`), so each shared edge gets exactly
 * one strip, and NEVER at a junction cell (the median opens there; flow's
 * zebra takes over the ground). Returns the four corners for a fill.
 */
export function avenueMedianStrip(tx: number, ty: number, info: AvenueInfo): GroundPoint[] | null {
  if (info.outer !== -1 || info.junction) return null;
  const h = MEDIAN_WIDTH / 2;
  if (info.axis === "x") {
    const e = ty + 1;                                 // the shared edge
    return [[tx, e - h], [tx + 1, e - h], [tx + 1, e + h], [tx, e + h]];
  }
  const e = tx + 1;
  return [[e - h, ty], [e + h, ty], [e + h, ty + 1], [e - h, ty + 1]];
}

/** A tree spot on the median — one per pair-tile (every tile), mid-along. */
export function avenueMedianTreeSpot(tx: number, ty: number, info: AvenueInfo): GroundPoint | null {
  if (info.outer !== -1 || info.junction) return null;
  return info.axis === "x" ? [tx + 0.5, ty + 1] : [tx + 1, ty + 0.5];
}

/** A DOUBLE lamp post spot — every SECOND tile along the run (parity on the
 *  tile's along-coordinate), offset a quarter tile from the tree so the two
 *  silhouettes never overlap. */
export function avenueMedianLampSpot(tx: number, ty: number, info: AvenueInfo): GroundPoint | null {
  if (info.outer !== -1 || info.junction) return null;
  const even = info.axis === "x" ? (tx & 1) === 0 : (ty & 1) === 0;
  if (!even) return null;
  return info.axis === "x" ? [tx + 0.25, ty + 1] : [tx + 1, ty + 0.25];
}

// ══════════════════════════════════════════════════════════════════════════
// TOWN-4.4 (#680) — the CUL-DE-SAC TURNING CIRCLE.
//
// A planned town's outer ribbon is served by lane spurs that end in a turning
// circle (`TownPlan.culDeSacs`) rather than in a raw stub: the epic's §2.8
// "no stubs — every street ends at a junction, a cul-de-sac circle, the
// avenue, or the town edge". This is the geometry of that round end, and it is
// vector like every other road figure here — no sprite, nothing for the lead to
// draw (epic §6: "Cul-de-sac turning circle: vector geometry in
// road-geometry.ts, no sprite").
//
// Two closed polygons on the circle tile, both centred on the tile centre:
//
//   disc  the asphalt, filled with the paved material. Its radius IS
//         `CUL_DE_SAC_RADIUS`, so the turning circle is 0.9 tiles across —
//         wider than the lane that feeds it (a Street's core is 0.78 × 0.8 =
//         0.624), which is what makes it read as a place to turn around
//         rather than as a road that stopped.
//   kerb  the ring the disc's edge wears, stroked with SIDEWALK_WIDTH exactly
//         like a sidewalk ribbon, sitting INSIDE the disc's edge so no grass
//         shows between the two. It is the "kerbed" half of the ticket: a
//         cul-de-sac is a paved circle with a kerb around it, not a hole in
//         the lawn.
//
// The lane's own arm keeps its figures (`roadFigures` gives a dead end a
// centre-to-port run) and its own flank ribbons (`sidewalkPaths` already caps a
// dead end with an arc), so the circle is added ON TOP of the street the plan
// drew: the disc covers the arm's rounded end and the cap arc's inner half, and
// the ring closes the whole thing. Both polygons stay inside the tile
// (0.45 < 0.5), so a chunk boundary can never cut a circle in half and no
// neighbouring tile has to know about it.
// ══════════════════════════════════════════════════════════════════════════

/** The turning circle's radius, in tile units — the asphalt's outer edge. */
export const CUL_DE_SAC_RADIUS = 0.45;

/** Pieces the circle is cut into. Sixteen is round at 2× and cheap; it is the
 *  same order as `SIDEWALK_ARC_SEGMENTS` (8 per quarter turn). */
export const CUL_DE_SAC_SEGMENTS = 16;

/** The kerb ring's centreline radius: the ribbon straddles the disc's edge. */
export const CUL_DE_SAC_KERB_RADIUS = CUL_DE_SAC_RADIUS - SIDEWALK_WIDTH / 2;

/** A closed circle of `segments` ground points around a tile's centre. */
function circlePoints(tx: number, ty: number, radius: number, segments: number): GroundPoint[] {
  const c = tileCentre(tx, ty);
  const points: GroundPoint[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push([c[0] + radius * Math.cos(a), c[1] + radius * Math.sin(a)]);
  }
  // Closed: the last point repeats the first, so `trace`/`traceInto` callers
  // stroke a ring and fill callers get a closed polygon for free.
  points.push(points[0]);
  return points;
}

/** The turning circle's asphalt, as a closed polygon to FILL. */
export function culDeSacDisc(tx: number, ty: number): GroundPoint[] {
  return circlePoints(tx, ty, CUL_DE_SAC_RADIUS, CUL_DE_SAC_SEGMENTS);
}

/** The turning circle's kerb, as a closed ring to STROKE with SIDEWALK_WIDTH. */
export function culDeSacKerb(tx: number, ty: number): GroundPoint[] {
  return circlePoints(tx, ty, CUL_DE_SAC_KERB_RADIUS, CUL_DE_SAC_SEGMENTS);
}

/**
 * The turning-circle figures of a cul-de-sac tile: the disc and its kerb, as
 * the two paths the road renderer's cached chunk paints. `mask` is the tile's
 * connection nibble — a circle with no arm at all (a plan tile the trim left
 * isolated) draws nothing, because there is no street to turn around in.
 */
export function culDeSacFigures(
  tx: number, ty: number, mask: number,
): { disc: GroundPoint[]; kerb: GroundPoint[] } | null {
  if (maskOf(mask) === 0) return null;
  return { disc: culDeSacDisc(tx, ty), kerb: culDeSacKerb(tx, ty) };
}
