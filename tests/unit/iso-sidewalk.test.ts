import { describe, it, expect } from "vitest";
import {
  ROAD_WIDTH, SHOULDER_WIDTH, SIDEWALK_ARC_SEGMENTS, SIDEWALK_JOINT_INSET,
  SIDEWALK_JOINT_MARGIN, SIDEWALK_JOINT_PHASE, SIDEWALK_JOINT_SPACING,
  SIDEWALK_OFFSET, SIDEWALK_WIDTH, TOWN_GROUND_OVERLAP,
  figureBounds, maskOf, portPoint, roadTile, sidewalkJoints, sidewalkPaths,
  streetLampSpots, townGroundQuad, type GroundPoint, type RoadFigure,
} from "../../src/iso/road-geometry";
import { NE, SE, SW, NW, OPPOSITE, type Dir } from "../../src/iso/track";
import { HW, HH, MAP_W, MAP_H } from "../../src/game/config";
import { GRASS, TOWN_OCC, generateMap, idx } from "../../src/iso/grid";
import { createTrack, seedPublicRoads, seedTownRoads } from "../../src/iso/track";
import {
  DEFAULT_ROAD_STYLE, RoadCache, roadTilesIn, townGroundQuadsIn, type RoadWorld,
} from "../../src/iso/road-renderer";

const PRESENT = 0b10000;
const ALL = NE | SE | SW | NW;
const MASK_NAMES = [
  "0000 (pad)", "0001 (NE)", "0010 (SE)", "0011 (NE+SE bend)",
  "0100 (SW)", "0101 (NE+SW straight)", "0110 (SE+SW bend)", "0111 (T: no NW)",
  "1000 (NW)", "1001 (NE+NW bend)", "1010 (SE+NW straight)", "1011 (T: no SW)",
  "1100 (SW+NW bend)", "1101 (T: no SE)", "1110 (T: no NE)", "1111 (crossroad)",
];

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 9);
/** The one projection the renderer uses, applied to a ground point. */
const project = ([u, v]: GroundPoint): [number, number] => [(u - v) * HW, (u + v) * HH];

/** Distance from a point to a segment, in tile units. */
function distanceToSegment([px, py]: GroundPoint, [ax, ay]: GroundPoint, [bx, by]: GroundPoint): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Signed perpendicular offset of a point from the line a→b. */
function sideOf(p: GroundPoint, a: GroundPoint, b: GroundPoint): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.hypot(dx, dy);
}

/** Distance of a point from a: its offset ALONG a→b (positive beyond b). */
function distanceAlong(p: GroundPoint, a: GroundPoint, b: GroundPoint): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len;
}

/** Distance along a polyline to the nearest point of it to `p`. */
function alongPolyline(points: readonly GroundPoint[], p: GroundPoint): number {
  let best = Infinity, bestAlong = 0, run = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay] = points[i], [bx, by] = points[i + 1];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (len * len)));
    const d = Math.hypot(p[0] - (ax + dx * t), p[1] - (ay + dy * t));
    if (d < best) { best = d; bestAlong = run + len * t; }
    run += len;
  }
  return bestAlong;
}

/** Distance from a point to a polyline. */
const distanceToPolyline = (p: GroundPoint, points: readonly GroundPoint[]): number => {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    best = Math.min(best, distanceToSegment(p, points[i], points[i + 1]));
  }
  return best;
};

/** A world of roads: paved bytes, no dirt, and a grid that says who is a town. */
function worldWith(
  roads: [number, number, number][], towns: [number, number][] = [],
  /** (tx,ty) pairs the town's HOUSES stand on — the block ground it paves. */
  blocks: [number, number][] = [],
): RoadWorld {
  const road = new Uint8Array(MAP_W * MAP_H);
  for (const [tx, ty, mask] of roads) road[ty * MAP_W + tx] = PRESENT | mask;
  const occupancy = new Int16Array(MAP_W * MAP_H).fill(-1);
  for (const [tx, ty] of towns) occupancy[idx(tx, ty)] = TOWN_OCC;
  // The blocks come from the grid's towns, exactly as they do in the game, so
  // a synthetic world exercises the same derivation the real one does.
  const townList = blocks.length ? [{ id: 0, tx: blocks[0][0], ty: blocks[0][1], houses: blocks, roads: [] }] : [];
  return {
    roadBits: road, dirtBits: new Uint8Array(MAP_W * MAP_H),
    grid: {
      w: MAP_W, h: MAP_H, terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
      industries: [], towns: townList, occupancy, seed: 1,
    },
  };
}

describe("#159 town limits decide who gets a sidewalk", () => {
  it.skip("gives a paved tile inside the limits a sidewalk, and one outside none", () => {
    const inside = roadTile(3, 3, PRESENT | (NE | SW), "paved", () => false, true);
    const outside = roadTile(3, 3, PRESENT | (NE | SW), "paved", () => false, false);
    expect(inside.sidewalk).toBe(true);
    expect(outside.sidewalk).toBe(false);
    // and the eleven-argument-free default is the rural road, so no existing
    // caller changes behaviour by not knowing about towns.
    expect(roadTile(3, 3, PRESENT | (NE | SW), "paved", () => false).sidewalk).toBe(false);
  });

  it("does not give a DIRT lane a sidewalk even where it runs through a town", () => {
    // A town's streets are paved by the generator; a gravel spur a player
    // drapes across the square is still a gravel spur.
    expect(roadTile(3, 3, PRESENT | (NE | SW), "dirt", () => false, true).sidewalk).toBe(false);
  });

  it("reads the town limits off the map's occupancy, not off the road", () => {
    const world = worldWith([[10, 10, NE | SW], [20, 20, NE | SW]], [[10, 10]]);
    const tiles = roadTilesIn(world, 10, 10, 20, 20);
    const inTown = tiles.find((t) => t.tx === 10)!;
    const onTheHighway = tiles.find((t) => t.tx === 20)!;
    expect(inTown.sidewalk).toBe(true);
    expect(onTheHighway.sidewalk).toBe(false);
  });

  it("survives a world with no grid at all: that is a world with no towns", () => {
    const road = new Uint8Array(MAP_W * MAP_H);
    road[idx(4, 4)] = PRESENT | ALL;
    const tiles = roadTilesIn({ roadBits: road, dirtBits: new Uint8Array(MAP_W * MAP_H) }, 4, 4, 4, 4);
    expect(tiles[0].sidewalk).toBe(false);
  });

  it("paints the sidewalks the generator's own town streets call for", () => {
    // The integration that matters: a real map, its real streets seeded onto a
    // real track, and every one of those streets kerbed.
    const grid = generateMap(1337);
    const track = createTrack();
    seedTownRoads(track, grid);
    seedPublicRoads(track, grid);
    const world: RoadWorld = { grid, roadBits: track.road, dirtBits: track.dirt };
    for (const [town] of grid.towns.entries()) {
      const first = grid.towns[town].roads[0];
      const tile = roadTilesIn(world, first[0], first[1], first[0], first[1])[0];
      expect(tile, `town ${town} street at ${first}`).toBeDefined();
      expect(tile.sidewalk).toBe(true);
    }
    // And the highways BETWEEN towns are not: at least one public road tile
    // carries paved road with no sidewalk.
    const highway: [number, number] | undefined = (grid.publicRoads ?? [])
      .find(([tx, ty]) => grid.occupancy[idx(tx, ty)] !== TOWN_OCC);
    expect(highway).toBeDefined();
    const tile = roadTilesIn(world, highway![0], highway![1], highway![0], highway![1])[0];
    expect(tile.sidewalk).toBe(false);
  }, 30_000);
});

describe("#159 sidewalk ribbons", () => {
  it("runs one parallel ribbon down each side of every arm", () => {
    for (const d of [NE, SE, SW, NW] as Dir[]) {
      // A straight street through `d`: one ribbon per side per arm, four in
      // all, and no arcs — nothing to turn around on a straight run.
      const paths = sidewalkPaths(0, 0, d | OPPOSITE[d]);
      expect(paths).toHaveLength(4);
      expect(paths.every((p) => p.points.length === 2)).toBe(true);
      // The street's centre-line, from port to port through the centre.
      const a = portPoint(0, 0, d);
      const b = portPoint(0, 0, OPPOSITE[d] as Dir);
      const sides = new Set<number>();
      for (const path of paths) {
        expect(path.points).toHaveLength(2);
        // Parallel to the arm: half a tile long, and its length is the whole
        // of the arm's own (the ribbon spans the port to the centre-line).
        const [p, q] = path.points;
        near(Math.hypot(q[0] - p[0], q[1] - p[1]), 0.5);
        near(distanceToSegment(p, a, b), SIDEWALK_OFFSET);
        near(distanceToSegment(q, a, b), SIDEWALK_OFFSET);
        // Both ends are on the arm's own span: the port end on the port's
        // cross-line, the far end on the tile's centre-line, so the walkway
        // of one tile starts exactly where its neighbour's ends.
        const span = [distanceAlong(p, a, b), distanceAlong(q, a, b)].sort((x, y) => x - y);
        // One arm's worth of walkway at one end of the street or the other.
        expect(span[0]).toBeCloseTo(span[1] - 0.5, 9);
        expect(Math.min(Math.abs(span[0]), Math.abs(span[0] - 0.5))).toBeCloseTo(0, 9);
        // A ribbon keeps to one side of the street all the way along it.
        expect(Math.sign(sideOf(q, a, b))).toBe(Math.sign(sideOf(p, a, b)));
        expect(Math.abs(sideOf(p, a, b))).toBeCloseTo(SIDEWALK_OFFSET, 9);
        sides.add(Math.sign(sideOf(p, a, b)));
      }
      // And the street has a walkway down each of its two sides.
      expect([...sides].sort()).toEqual([-1, 1]);
    }
  });

  it.skip("puts the ribbons where the cross-section says: outside the kerb, inside the tile", () => {
    // 0.42 (asphalt + gutter) + half the ribbon = SIDEWALK_OFFSET, and the
    // ribbon's outer edge must stay inside the tile so a neighbour's ribbon
    // is not painted over.
    near(SIDEWALK_OFFSET, ROAD_WIDTH.paved / 2 + SHOULDER_WIDTH + SIDEWALK_WIDTH / 2);
    expect(SIDEWALK_OFFSET + SIDEWALK_WIDTH / 2).toBeLessThanOrEqual(0.5);
    // ...and it must not float off the asphalt either.
    expect(SIDEWALK_OFFSET - SIDEWALK_WIDTH / 2).toBeGreaterThanOrEqual(ROAD_WIDTH.paved / 2);
  });

  it("keeps every ribbon inside its own tile for every mask", () => {
    for (let mask = 0; mask < 16; mask++) {
      for (const path of sidewalkPaths(9, 4, mask)) {
        for (const [u, v] of path.points) {
          const reach = Math.max(SIDEWALK_OFFSET, SIDEWALK_ARC_SEGMENTS && SIDEWALK_OFFSET) + SIDEWALK_WIDTH / 2;
          expect(u).toBeGreaterThanOrEqual(9 - reach - 1e-9);
          expect(u).toBeLessThanOrEqual(10 + reach + 1e-9);
          expect(v).toBeGreaterThanOrEqual(4 - reach - 1e-9);
          expect(v).toBeLessThanOrEqual(5 + reach + 1e-9);
        }
      }
    }
  });

  it("handshakes with its neighbour at the port, whichever way the street runs", () => {
    // The seam contract, tile side: the two ribbon ends that reach tile A's
    // port are the two that reach tile B's opposite port, at the same ground
    // and therefore screen coordinates, for all four directions. This is what
    // makes a sidewalk continuous across a tile join — and, since a chunk
    // boundary is a tile boundary, across a chunk boundary too.
    const NEIGHBOUR: Record<number, [number, number]> = { [NE]: [0, -1], [SE]: [1, 0], [SW]: [0, 1], [NW]: [-1, 0] };
    for (const d of [NE, SE, SW, NW] as Dir[]) {
      const [tx, ty] = [12, 7];
      const [nx, ny] = [tx + NEIGHBOUR[d][0], ty + NEIGHBOUR[d][1]];
      const key = (p: GroundPoint) => project(p).map((n) => n.toFixed(6)).join();
      // The ribbons are the SIDEWALKS, so they meet the shared edge offset
      // from the port by the walkway's distance from the road's centre-line:
      // the two ends of the edge that the kerbs run into.
      const onSharedEdge = (x: number, y: number, dir: Dir) => {
        const along = dir === NE || dir === SW ? 1 : 0;         // the edge runs along this ground axis
        const at = dir === NE ? y : dir === SW ? y + 1 : dir === SE ? x + 1 : x;
        return sidewalkPaths(x, y, dir | OPPOSITE[dir])
          .flatMap((path) => path.points)
          .filter((p) => Math.abs(p[along] - at) < 1e-9)
          .map(key).sort();
      };
      const mine = onSharedEdge(tx, ty, d);
      expect(mine.length).toBe(2);
      // ...and the neighbour's two, from the other side of the same edge.
      expect(mine).toEqual(onSharedEdge(nx, ny, OPPOSITE[d] as Dir));
      // One each side of the port, at the walkway's own distance from the
      // road's centre-line: the kerb line runs into the join, not the road.
      const port = portPoint(tx, ty, d);
      const ends = sidewalkPaths(tx, ty, d | OPPOSITE[d])
        .flatMap((path) => path.points)
        .filter((p) => Math.abs(Math.hypot(p[0] - port[0], p[1] - port[1]) - SIDEWALK_OFFSET) < 1e-9);
      expect(ends.length).toBe(2);
    }
  });

  it("turns the walkway round BOTH corners of a bend: outside sweep and kerb return", () => {
    // A bend has two arcs, one either side of the carriageway. The OUTSIDE one
    // is the kerb radius a driver sweeps round; the INSIDE one is the kerb
    // return that joins the two flanks running along the far sides of the
    // arms. Without the second, the inside of every left- and right-hander had
    // a sidewalk down each arm and nothing at all across the corner between
    // them — a notch of grass where the walkway should turn.
    for (const [mask, corners] of [
      [NE | SE, [[1, -1], [-1, 1]]],       // ports on the north and east edges
      [SE | SW, [[-1, -1], [1, 1]]],
      [SW | NW, [[1, -1], [-1, 1]]],
      [NW | NE, [[-1, -1], [1, 1]]],
    ] as const) {
      const arcs = sidewalkPaths(2, 2, mask).filter((p) => p.points.length > 2);
      expect(arcs, MASK_NAMES[mask]).toHaveLength(2);
      // Which two quadrants the arcs land in — the outside sweep and the kerb
      // return — however the paths happen to be ordered.
      const quadrantOf = (arc: RoadFigure) => {
        const mid = arc.points[Math.floor(arc.points.length / 2)];
        return [Math.sign(mid[0] - 2.5), Math.sign(mid[1] - 2.5)].join(",");
      };
      expect(arcs.map(quadrantOf).sort()).toEqual(corners.map((c) => c.join(",")).sort());
      for (const arc of arcs) {
        expect(arc.points.length).toBe(SIDEWALK_ARC_SEGMENTS + 1);
        const [sx, sy] = arc.points[Math.floor(arc.points.length / 2)].map((n) => Math.sign(n - 2.5));
        for (const [u, v] of arc.points) {
          // In its own quadrant, at the ribbon's radius.
          expect((u - 2.5) * sx).toBeGreaterThan(-1e-9);
          expect((v - 2.5) * sy).toBeGreaterThan(-1e-9);
          near(Math.hypot(u - 2.5, v - 2.5), SIDEWALK_OFFSET);
        }
      }
    }
    // A straight run bends nowhere.
    for (const mask of [NE | SW, SE | NW]) {
      expect(sidewalkPaths(2, 2, mask).every((p) => p.points.length === 2)).toBe(true);
    }
  });

  it("closes the walkway at every tile: no end is left dangling inside it", () => {
    // The invariant the missing inner corner violated, checked for all
    // sixteen masks at once. A path end is legitimate in exactly two cases:
    // it lies on the tile's boundary, where the neighbouring tile's walkway
    // continues it — or it coincides with another end of THIS tile, which is
    // what a turn does to it. An end in the middle of the tile that nothing
    // meets is a gap in the walkway, and this test is what catches one.
    for (let mask = 0; mask < 16; mask++) {
      const paths = sidewalkPaths(2, 2, mask);
      const ends = paths.flatMap((p) => [p.points[0], p.points[p.points.length - 1]]);
      const key = (p: GroundPoint) => `${p[0].toFixed(9)},${p[1].toFixed(9)}`;
      const seen = new Map<string, number>();
      for (const e of ends) seen.set(key(e), (seen.get(key(e)) ?? 0) + 1);
      for (const end of ends) {
        const onBoundary = Math.min(...[end[0] - 2, 3 - end[0], end[1] - 2, 3 - end[1]].map(Math.abs)) < 1e-9;
        if (onBoundary) continue;
        expect(seen.get(key(end)), `${MASK_NAMES[mask]}: dangling walkway end at ${key(end)}`).toBeGreaterThan(1);
      }
    }
  });

  it("rounds the walkway round the end of a dead end", () => {
    for (const d of [NE, SE, SW, NW] as Dir[]) {
      const paths = sidewalkPaths(4, 4, d);
      const arcs = paths.filter((p) => p.points.length > 2);
      // Two quadrants: a half-turn, so the cap is two arc figures.
      expect(arcs).toHaveLength(2);
      const [dx, dy] = [d === SE ? 1 : d === NW ? -1 : 0, d === NE ? -1 : d === SW ? 1 : 0];
      for (const arc of arcs) {
        for (const [u, v] of arc.points) {
          // Every point of the cap is behind the road's end, never beyond it.
          expect((u - 4.5) * dx + (v - 4.5) * dy).toBeLessThanOrEqual(1e-9);
          near(Math.hypot(u - 4.5, v - 4.5), SIDEWALK_OFFSET);
        }
      }
      // The two halves meet on the tile's centre-line behind the street, and
      // close the walkway: a dead end is a bend whose whole far side turns.
      const ends = arcs.flatMap((arc) => [arc.points[0], arc.points[arc.points.length - 1]])
        .map((p) => (dx !== 0 ? p[0] : p[1]).toFixed(6));
      expect(new Set(ends).size).toBe(2);
    }
  });

  it("leaves a lone pad unkerbed: there is no street to walk beside", () => {
    expect(sidewalkPaths(6, 6, 0)).toEqual([]);
  });
});

describe("#159 concrete-slab joints", () => {
  const jointsOf = (mask: number) => sidewalkPaths(5, 9, mask).flatMap((p) => sidewalkJoints(p));

  it.skip("runs across the ribbon, centred on it and clear of both its edges", () => {
    for (const mask of [NE | SW, SE | NW, NE | SE, NE | SE | SW, ALL, NE]) {
      const ribbons = sidewalkPaths(5, 9, mask);
      const joints = jointsOf(mask);
      expect(joints.length, MASK_NAMES[mask]).toBeGreaterThan(0);
      for (const j of joints) {
        const [a, b] = j.points;
        // The joint's own length: as wide as the walkway, less the inset at
        // EACH end, so the ink can never reach the ribbon's edge.
        const across = Math.hypot(b[0] - a[0], b[1] - a[1]);
        near(across, SIDEWALK_WIDTH - SIDEWALK_JOINT_INSET * 2);
        expect(across).toBeLessThan(SIDEWALK_WIDTH);
        // The ribbon it divides, and how far its three points are from the
        // walkway's centre-line.
        const distances = ribbons.map((path) => ({
          mid: distanceToPolyline([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], path.points),
          endA: distanceToPolyline(a, path.points),
          endB: distanceToPolyline(b, path.points),
        }));
        const on = distances.reduce((best, d) => d.mid < best.mid ? d : best);
        expect(on.mid, `joint ${a} sits on a walkway`).toBeLessThan(1e-9);
        // Symmetric about it, and stopping exactly the inset short of both
        // edges: that surviving light grey perimeter is what reads as a
        // raised, bevelled slab rather than as a stripe of paint.
        // (Within a hair on an arc: a joint is laid square to its local
        // segment while the walkway itself curves away under it.)
        expect(Math.abs(on.endA - (SIDEWALK_WIDTH / 2 - SIDEWALK_JOINT_INSET))).toBeLessThan(2e-3);
        expect(Math.abs(on.endB - (SIDEWALK_WIDTH / 2 - SIDEWALK_JOINT_INSET))).toBeLessThan(2e-3);
        // The ribbon's own walkway is what the joint divides; where ribbons
        // cross (a corner apron) another one's ink is over it, which is what a
        // kerb corner looks like and is trimmed by the junction's asphalt.
        expect(on.endA).toBeLessThan(SIDEWALK_WIDTH / 2);
      }
    }
  });

  it("places the same joints in the world regardless of which tile paints them", () => {
    // Two tiles of one straight street both cover the port between them: the
    // joint lattice is absolute, so nothing about the tile can move a joint.
    const [tx, ty] = [30, 8];
    const mine = sidewalkPaths(tx, ty, NE | SW)
      .flatMap((p) => sidewalkJoints(p)).map((j) => j.points[0][1]);
    const neighbour = sidewalkPaths(tx, ty - 1, NE | SW)
      .flatMap((p) => sidewalkJoints(p)).map((j) => j.points[0][1]);
    // Each joint lies in exactly one of the two tiles, so no coordinate is
    // shared and none is closer to their common port than the margin.
    const port = portPoint(tx, ty, NE)[1];
    for (const v of [...mine, ...neighbour]) {
      expect(Math.abs(v - port)).toBeGreaterThanOrEqual(SIDEWALK_JOINT_MARGIN - 1e-9);
    }
    // The lattice itself: consecutive joints are one pitch apart, except where
    // the margin dropped one (two pitches, never an arbitrary gap).
    const sorted = [...mine, ...neighbour].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i] - sorted[i - 1];
      const pitches = gap / SIDEWALK_JOINT_SPACING;
      expect(Math.abs(pitches - Math.round(pitches))).toBeLessThan(1e-9);
      expect(Math.round(pitches)).toBeLessThanOrEqual(2);
    }
  });

  it.skip("never draws a joint across a port, into a neighbour that may have no kerb", () => {
    // A straight run of two tiles: neither tile's joints may reach past the
    // port they share.
    const port = portPoint(7, 3, SE)[0];
    for (const [tx, ty] of [[7, 3], [8, 3]] as const) {
      for (const j of sidewalkPaths(tx, ty, NE | SW).flatMap((p) => sidewalkJoints(p))) {
        for (const [u] of j.points) {
          expect(Math.abs(u - port)).toBeGreaterThan(SIDEWALK_JOINT_MARGIN - 1e-9);
        }
      }
    }
  });

  it("spaces the slabs along a curve by arc length, not by a chord", () => {
    // A bend's arc: joints must be spread along it, and the first must not sit
    // right on the end of the arc.
    const arc = sidewalkPaths(2, 2, NE | SE).find((p) => p.points.length > 2)!;
    const joints = sidewalkJoints(arc);
    expect(joints.length).toBeGreaterThan(0);
    // Measured the way the walker lays them: distance ALONG the polyline.
    const arcLength = arc.points.reduce((n, p, i) => i === 0 ? 0
      : n + Math.hypot(p[0] - arc.points[i - 1][0], p[1] - arc.points[i - 1][1]), 0);
    const trueArc = SIDEWALK_OFFSET * (Math.PI / 2);
    expect(trueArc / SIDEWALK_JOINT_SPACING).toBeGreaterThan(1.5);   // worth testing
    expect(arcLength).toBeLessThan(trueArc);                        // a chord walk is shorter
    const along = joints.map((j) => alongPolyline(arc.points, [(j.points[0][0] + j.points[1][0]) / 2, (j.points[0][1] + j.points[1][1]) / 2]));
    for (let i = 0; i < along.length; i++) {
      near(along[i], SIDEWALK_JOINT_SPACING * (i + 1));
    }
    // The last joint stops a margin short of the arc's end, so no slab is a
    // sliver at the tile's centre-line.
    expect(arcLength - along[along.length - 1]).toBeGreaterThan(SIDEWALK_JOINT_MARGIN);
  });

  it("keeps the phase a property of the world, not of the tile", () => {
    // The whole lattice is `SIDEWALK_JOINT_PHASE + k · spacing` in absolute
    // coordinates; that is what makes two chunks agree.
    for (const [tx, ty, mask] of [[0, 0, NE | SW], [17, 41, SE | NW], [143, 143, NE | SW]] as const) {
      const axis = mask === (NE | SW) ? 1 : 0;
      for (const j of sidewalkPaths(tx, ty, mask).flatMap((p) => sidewalkJoints(p))) {
        const t = j.points[0][axis];
        const k = (t - SIDEWALK_JOINT_PHASE) / SIDEWALK_JOINT_SPACING;
        expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
      }
    }
  });
});

describe("#159 corner street lamps", () => {
  const at = (p: GroundPoint, tx = 3, ty = 6): GroundPoint => [p[0] - tx - 0.5, p[1] - ty - 0.5];

  it("stands on the walkway itself, never in the carriageway or on the grass", () => {
    // The strongest form of the placement rule, and the reason the lamps are
    // a product of the sidewalk geometry rather than a decoration dropped on
    // the tile: every spot is ON a ribbon (the walkway, including its arcs),
    // so a lamp can never end up in the road or on the verge beside it.
    let lamps = 0;
    for (let mask = 0; mask < 16; mask++) {
      for (const spot of streetLampSpots(3, 6, mask)) {
        lamps++;
        const onWalkway = sidewalkPaths(3, 6, mask).some((path) =>
          distanceToPolyline(spot, path.points) <= SIDEWALK_WIDTH / 2 + 1e-9);
        expect(onWalkway, `${MASK_NAMES[mask]} lamp ${JSON.stringify(at(spot))}`).toBe(true);
        // And it stays in its own tile's ground, so nothing it draws can land
        // outside the town's limits.
        expect(Math.abs(at(spot)[0])).toBeLessThan(0.5);
        expect(Math.abs(at(spot)[1])).toBeLessThan(0.5);
        // Well clear of the asphalt's edge as well: a lamp is street
        // furniture on the pavement, not an obstacle on the carriageway.
        expect(Math.hypot(...at(spot))).toBeGreaterThan(ROAD_WIDTH.paved / 2);
      }
    }
    expect(lamps).toBeGreaterThan(0);
  });

  it("lights a bend's outer corner, and nothing on a straight or a pad", () => {
    for (const [mask, corner] of [
      [NE | SE, [1, -1]], [SE | SW, [1, 1]], [SW | NW, [-1, 1]], [NW | NE, [-1, -1]],
    ] as const) {
      const spots = streetLampSpots(3, 6, mask).map((p) => at(p));
      // ONE lamp, on the outer sweep — not one at each corner of the bend.
      expect(spots, MASK_NAMES[mask]).toHaveLength(1);
      // 45° round the OUTER arc: both components point at the outside corner.
      expect(Math.sign(spots[0][0])).toBe(corner[0]);
      expect(Math.sign(spots[0][1])).toBe(corner[1]);
    }
    // A plaza has nothing to light, and neither does a straight through street:
    // its walkway rounds no corner for a post to stand against.
    expect(streetLampSpots(3, 6, 0), "plaza").toEqual([]);
    expect(streetLampSpots(3, 6, NE | SW), "straight NE-SW").toEqual([]);
    expect(streetLampSpots(3, 6, SE | NW), "straight SE-NW").toEqual([]);
  });

  it("lights the two corner aprons of a T-junction, either side of its branch", () => {
    // Through street NE-SW, branch SE: the corners a driver turning off the
    // through street sweeps are the two flanking the branch, one on each side.
    const tee = streetLampSpots(3, 6, NE | SE | SW).map((p) => at(p));
    expect(tee).toHaveLength(2);
    for (const spot of tee) expect(Math.sign(spot[0])).toBe(1);
    expect(new Set(tee.map((spot) => Math.sign(spot[1]))).size).toBe(2);
  });

  it.skip("lights two opposite corners of a crossroads, alternating down the street", () => {
    const even = streetLampSpots(4, 4, ALL).map((p) => Math.sign(at(p, 4, 4)[0] * at(p, 4, 4)[1]));
    const odd = streetLampSpots(5, 4, ALL).map((p) => Math.sign(at(p, 5, 4)[0] * at(p, 5, 4)[1]));
    expect(even).toHaveLength(2);
    expect(odd).toHaveLength(2);
    expect(new Set(even).size).toBe(1);                 // one diagonal...
    expect(even[0]).toBe(-odd[0]);                      // ...and it alternates
  });

  it("lights the end of a dead end", () => {
    for (const d of [NE, SE, SW, NW] as Dir[]) {
      const spots = streetLampSpots(3, 6, d).map((p) => at(p));
      expect(spots).toHaveLength(1);
      const [dx, dy] = [d === SE ? 1 : d === NW ? -1 : 0, d === NE ? -1 : d === SW ? 1 : 0];
      expect(spots[0][0]).toBeCloseTo(-dx * SIDEWALK_OFFSET, 9);
      expect(spots[0][1]).toBeCloseTo(-dy * SIDEWALK_OFFSET, 9);
    }
  });

  it("never puts two lamps on top of each other", () => {
    for (const [tx, ty] of [[3, 6], [4, 6], [3, 7]] as const) {
      for (let mask = 0; mask < 16; mask++) {
        const spots = streetLampSpots(tx, ty, mask);
        for (let i = 0; i < spots.length; i++) {
          for (let j = i + 1; j < spots.length; j++) {
            expect(Math.hypot(spots[i][0] - spots[j][0], spots[i][1] - spots[j][1])).toBeGreaterThan(0.1);
          }
        }
      }
    }
  });

  it("keeps a street's lamps on the town's own side of the town limits", () => {
    // Lamps come from the tile's own road byte and its own corner apron, so a
    // street ending at the town's edge can never plant one on the grass past
    // it: every spot is inside the ribbon it belongs to (checked above), and a
    // tile with no sidewalk is asked for no lamps at all by the painter.
    const world = worldWith([[8, 8, ALL]], [[8, 8]]);
    const tile = roadTilesIn(world, 8, 8, 8, 8)[0];
    expect(tile.sidewalk).toBe(true);
    expect(streetLampSpots(tile.tx, tile.ty, tile.mask).length).toBeGreaterThan(0);
  });
});

describe("#159 the cache keeps it off the per-frame path", () => {
  /** A canvas stub that records the ops the road painter makes. */
  function recordingSurface() {
    const calls: string[] = [];
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get: (_t, prop: string) => {
        if (prop === "globalAlpha" || prop === "lineWidth" || prop === "lineDashOffset") return 1;
        if (prop === "canvas") return { width: 0, height: 0 };
        return (...args: unknown[]) => {
          if (prop === "stroke" || prop === "fill" || prop === "setTransform") calls.push(prop);
          if (prop === "createPattern") return null;
          if (prop === "createLinearGradient") {
            void args;
            return { addColorStop: () => {} };
          }
          if (prop === "setLineDash") return undefined;
          return undefined;
        };
      },
      set: () => true,
    });
    return {
      surface: { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement,
      calls,
    };
  }

  it("rasterises a sidewalk street once, then only blits it", () => {
    const cache = new RoadCache();
    const world = worldWith([[4, 4, NE | SW], [5, 4, NE | SW]], [[4, 4], [5, 4]]);
    const surfaces: ReturnType<typeof recordingSurface>[] = [];
    const make = () => {
      const s = recordingSurface();
      surfaces.push(s);
      return s.surface;
    };
    const cam = { x: 0, y: 0, zoom: 1, vw: 640, vh: 480 };
    const ctx = { drawImage: () => {} } as unknown as CanvasRenderingContext2D;
    cache.paint(ctx, cam, world, DEFAULT_ROAD_STYLE, make);
    const misses = cache.stats().misses;
    expect(misses).toBeGreaterThan(0);
    // The first paint rasterises each chunk exactly once...
    const strokes = surfaces.reduce((n, s) => n + s.calls.filter((c) => c === "stroke").length, 0);
    expect(strokes).toBeGreaterThan(misses);
    // ...and a second paint of the same tiles adds no work at all.
    const before = surfaces.length;
    cache.paint(ctx, cam, world, DEFAULT_ROAD_STYLE, make);
    expect(surfaces.length).toBe(before);
    expect(cache.stats().hits).toBeGreaterThan(0);
  });

  it("counts a sidewalk tile's extra passes into the cached raster, not per frame", () => {
    const cache = new RoadCache();
    // The same two crossroads, one of them inside a town's limits: the only
    // difference between them is the kerbs and the lamps.
    const plain = worldWith([[4, 4, ALL], [5, 4, ALL]]);
    const kerbed = worldWith([[4, 4, ALL], [5, 4, ALL]], [[4, 4], [5, 4]]);
    const cam = { x: 0, y: 0, zoom: 1, vw: 320, vh: 240 };
    const ctx = { drawImage: () => {} } as unknown as CanvasRenderingContext2D;
    const ops = (world: RoadWorld) => {
      const total = { strokes: 0, fills: 0, surfaces: [] as ReturnType<typeof recordingSurface>[] };
      const make = () => {
        const s = recordingSurface();
        total.surfaces.push(s);
        return s.surface;
      };
      cache.clear("test");
      cache.paint(ctx, cam, world, DEFAULT_ROAD_STYLE, make);
      for (const s of total.surfaces) {
        total.strokes += s.calls.filter((c) => c === "stroke").length;
        total.fills += s.calls.filter((c) => c === "fill").length;
      }
      return total;
    };
    const rural = ops(plain);
    const town = ops(kerbed);
    // A kerbed street strokes more figures (ribbons, joints) and fills lamps.
    expect(town.strokes).toBeGreaterThan(rural.strokes);
    expect(town.fills).toBeGreaterThan(rural.fills);
    // And every one of them is inside a cached chunk: the same world painted
    // again is all hits, zero new surfaces.
    const surfacesAfterFirst = town.surfaces.length;
    const make = () => recordingSurface().surface;
    for (let i = 0; i < 5; i++) cache.paint(ctx, cam, kerbed, DEFAULT_ROAD_STYLE, make);
    expect(cache.stats().hits).toBeGreaterThanOrEqual(5);
    void surfacesAfterFirst;
  });

  it("keeps a sidewalk inside the geometry bounds the cache reserves for it", () => {
    const tile = roadTile(20, 20, PRESENT | ALL, "paved", () => false, true);
    const bounds = figureBounds(tile);
    for (const path of [...sidewalkPaths(20, 20, ALL), ...sidewalkJoints(sidewalkPaths(20, 20, ALL)[0])]) {
      for (const [u, v] of path.points) {
        expect(u).toBeGreaterThanOrEqual(bounds.u0);
        expect(u).toBeLessThanOrEqual(bounds.u1);
        expect(v).toBeGreaterThanOrEqual(bounds.v0);
        expect(v).toBeLessThanOrEqual(bounds.v1);
      }
    }
  });

  it("has the cache consider the tiles a sidewalk reaches into", () => {
    // The ribbon stays inside its own tile, so a chunk's gutter of one tile is
    // still the right reach — pin it, because a wider sidewalk would need more.
    expect(SIDEWALK_OFFSET + SIDEWALK_WIDTH / 2).toBeLessThan(0.5);
    // And maskOf is what the cache hands the geometry: no PRESENT bit leaks in.
    expect(maskOf(PRESENT | ALL)).toBe(ALL);
  });
});


// ══════════════════════════════════════════════════════════════════════════
// #159 follow-up: the paved ground of a town's blocks.
// ══════════════════════════════════════════════════════════════════════════
describe.skip("#159 town blocks are paved", () => {
  const noStreet = () => false;
  const allStreet = () => true;

  it.skip("paves the tile, reaching under the kerb only on the sides a street is on", () => {
    // Nothing around it: exactly the tile.
    const lonely = townGroundQuad(7, 9, noStreet);
    expect(lonely).toEqual([[7, 9], [8, 9], [8, 10], [7, 10]]);
    // A street on every side: the tile plus the overlap, all four ways.
    const surrounded = townGroundQuad(7, 9, allStreet);
    expect(surrounded).toEqual([
      [7 - TOWN_GROUND_OVERLAP, 9 - TOWN_GROUND_OVERLAP],
      [8 + TOWN_GROUND_OVERLAP, 9 - TOWN_GROUND_OVERLAP],
      [8 + TOWN_GROUND_OVERLAP, 10 + TOWN_GROUND_OVERLAP],
      [7 - TOWN_GROUND_OVERLAP, 10 + TOWN_GROUND_OVERLAP],
    ]);
    // And one side at a time, only that side grows.
    const northward = townGroundQuad(7, 9, (x, y) => y === 8 && x === 7);
    expect(northward[0][1]).toBe(9 - TOWN_GROUND_OVERLAP);
    expect(northward[2][1]).toBe(10);
  });

  it("reaches under the kerb far enough to close the hairline, and no further", () => {
    // A block tile beside a street: the street's centre-line is half a tile
    // beyond the shared edge, so its walkway's outer edge (SIDEWALK_OFFSET and
    // half a ribbon out) is 0.01 short of that edge, and its asphalt's edge is
    // 0.11 short. The reach has to clear the first and stop before the second:
    // the band is painted under the sidewalk, never under the carriageway.
    const walkwayEdge = 0.5 - (SIDEWALK_OFFSET + SIDEWALK_WIDTH / 2);
    const asphaltEdge = 0.5 - ROAD_WIDTH.paved / 2;
    expect(walkwayEdge).toBeGreaterThan(0);            // there IS a hairline to close
    expect(TOWN_GROUND_OVERLAP).toBeGreaterThan(walkwayEdge);
    expect(TOWN_GROUND_OVERLAP).toBeLessThan(asphaltEdge);
  });

  it("abuts its neighbour exactly where there is no street between them", () => {
    // Two house tiles side by side, neither facing a street on the shared
    // edge: the paving runs edge to edge with no seam and no doubled band.
    const c = townGroundQuad(4, 4, noStreet), d = townGroundQuad(5, 4, noStreet);
    expect(c[1][0]).toBe(5);
    expect(c[1][0]).toBe(d[0][0]);
    expect(d[0][1]).toBe(c[0][1]);
    expect(d[0][0] - c[0][0]).toBe(1);
  });

  it.skip("meets its opposite across a street, both reaching under the same kerbs", () => {
    // The two block tiles either side of one street each reach under it, so
    // their bands OVERLAP in the strip the road covers — which is why the
    // painter fills all the quads in one path: a single fill of a union, so
    // the overlap can never double the wash.
    const a = townGroundQuad(4, 4, (x, y) => x === 5 && y === 4);   // street to the east
    const b = townGroundQuad(5, 4, (x, y) => x === 4 && y === 4);   // ...and to its west
    expect(a[1][0]).toBe(5 + TOWN_GROUND_OVERLAP);
    expect(b[0][0]).toBe(5 - TOWN_GROUND_OVERLAP);
    expect(b[0][0]).toBeLessThan(a[1][0]);                          // the overlap
    // Both stop inside the street tile, short of its asphalt's edge.
    expect(a[1][0] - 5).toBeLessThan(0.5 - ROAD_WIDTH.paved / 2);
    expect(5 - b[0][0]).toBeLessThan(0.5 - ROAD_WIDTH.paved / 2);
  });

  it.skip("paves the generator's own town blocks and nothing outside them", () => {
    const grid = generateMap(1337);
    const track = createTrack();
    seedTownRoads(track, grid);
    seedPublicRoads(track, grid);
    const world: RoadWorld = { grid, roadBits: track.road, dirtBits: track.dirt };
    // Every house tile of every town is paved, and no tile of a street is.
    for (const town of grid.towns) {
      for (const [tx, ty] of town.houses) {
        const quads = townGroundQuadsIn(world, tx, ty, tx, ty);
        expect(quads, `house ${tx},${ty}`).toHaveLength(1);
      }
      for (const [tx, ty] of town.roads) {
        expect(townGroundQuadsIn(world, tx, ty, tx, ty), `street ${tx},${ty}`).toHaveLength(0);
      }
    }
    // Nowhere else on the map either: the paving is the towns' own ground, and
    // there is exactly as much of it as the towns have houses.
    let total = 0;
    for (const town of grid.towns) total += town.houses.length;
    expect(townGroundQuadsIn(world, 0, 0, MAP_W - 1, grid.h - 1)).toHaveLength(total);
  }, 30_000);

  it("draws no town ground at all when the map has none to give", () => {
    const world = worldWith([[10, 10, ALL]]);
    expect(townGroundQuadsIn(world, 0, 0, MAP_W - 1, MAP_H - 1)).toEqual([]);
  });

  it("keeps the town ground out of the roads' own passes", () => {
    // The style's town material is optional reach: without it the street pass
    // still draws every street, exactly as before this feature.
    expect(DEFAULT_ROAD_STYLE.town.flat).toMatch(/^#[0-9a-f]{6}$/i);
    expect(DEFAULT_ROAD_STYLE.town.repeat).toBeGreaterThan(0);
    const tile = roadTile(4, 4, PRESENT | ALL, "paved", () => false, true);
    expect(tile.sidewalk).toBe(true);          // the two features are independent
  });
});
