import { describe, it, expect } from "vitest";
import {
  JUNCTION_GAP, PORT_OFFSET, ROAD_DIRS, ROAD_WIDTH, TRANSITION_BLEND,
  dirsOf, figureBounds, hasRoad, maskOf, neighbourOf, paintFigures,
  portPoint, roadFigures, roadTile, tileCentre, type GroundPoint,
} from "../../src/iso/road-geometry";
import { NE, SE, SW, NW, OPPOSITE, type Dir } from "../../src/iso/track";
import { HW, HH, tileToScreen } from "../../src/game/config";

/** The one projection the renderer uses, applied to a ground point. */
const project = ([u, v]: GroundPoint): [number, number] => [(u - v) * HW, (u + v) * HH];

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 10);
const samePoint = (a: GroundPoint, b: GroundPoint) => {
  near(a[0], b[0]);
  near(a[1], b[1]);
};

describe("ground plane agrees with the game's projection", () => {
  it("puts a tile's origin on the diamond's top vertex", () => {
    for (const [tx, ty] of [[0, 0], [3, 7], [70, 12], [143, 143]]) {
      expect(project([tx, ty])).toEqual(tileToScreen(tx, ty));
    }
  });

  it("puts the tile centre half a tile below the top vertex", () => {
    for (const [tx, ty] of [[0, 0], [5, 9], [100, 33]]) {
      const [sx, sy] = tileToScreen(tx, ty);
      const [cx, cy] = project(tileCentre(tx, ty));
      near(cx, sx);
      near(cy, sy + HH);
    }
  });

  it("projects the four ports to the edge midpoints of the diamond", () => {
    // The handover pins these: NE (16,8), SE (16,24), SW (-16,24), NW (-16,8)
    // relative to the top vertex, at HW=32 / HH=16.
    const expected: Record<Dir, [number, number]> = {
      [NE]: [HW / 2, HH / 2],
      [SE]: [HW / 2, HH * 1.5],
      [SW]: [-HW / 2, HH * 1.5],
      [NW]: [-HW / 2, HH / 2],
    };
    for (const [tx, ty] of [[0, 0], [4, 11]]) {
      const [sx, sy] = tileToScreen(tx, ty);
      for (const d of ROAD_DIRS) {
        const [px, py] = project(portPoint(tx, ty, d));
        near(px - sx, expected[d][0]);
        near(py - sy, expected[d][1]);
      }
    }
  });
});

describe("shared ports", () => {
  it("computes the identical point from both sides of every edge", () => {
    // This is the contract that stops a hairline appearing at tile joins:
    // exact equality, not proximity.
    for (const [tx, ty] of [[0, 0], [6, 2], [63, 91], [143, 0]]) {
      for (const d of ROAD_DIRS) {
        const [nx, ny] = neighbourOf(tx, ty, d);
        const mine = portPoint(tx, ty, d);
        const theirs = portPoint(nx, ny, OPPOSITE[d] as Dir);
        expect(mine).toEqual(theirs);
      }
    }
  });

  it("keeps every port on its own tile's boundary", () => {
    const [tx, ty] = [9, 4];
    for (const d of ROAD_DIRS) {
      const [u, v] = portPoint(tx, ty, d);
      expect(u).toBeGreaterThanOrEqual(tx);
      expect(u).toBeLessThanOrEqual(tx + 1);
      expect(v).toBeGreaterThanOrEqual(ty);
      expect(v).toBeLessThanOrEqual(ty + 1);
      // and exactly ON an edge, not inside the tile
      expect(u === tx || u === tx + 1 || v === ty || v === ty + 1).toBe(true);
    }
  });

  it("offsets ports by half a tile in the direction they lead", () => {
    for (const d of ROAD_DIRS) {
      const [du, dv] = PORT_OFFSET[d];
      expect(du === 0.5 || dv === 0.5).toBe(true);
    }
  });
});

describe("mask decoding", () => {
  it("reads the low nibble and ignores the PRESENT bit", () => {
    expect(maskOf(0b10000)).toBe(0);
    expect(maskOf(0b10101)).toBe(0b0101);
    expect(maskOf(0)).toBe(0);
  });

  it("treats a PRESENT-only byte as road and an empty byte as nothing", () => {
    expect(hasRoad(0b10000)).toBe(true);
    expect(hasRoad(0b0011)).toBe(true);
    expect(hasRoad(0)).toBe(false);
  });

  it("lists directions in NE/SE/SW/NW order", () => {
    expect(dirsOf(NE | SW)).toEqual([NE, SW]);
    expect(dirsOf(0b1111)).toEqual([NE, SE, SW, NW]);
    expect(dirsOf(0)).toEqual([]);
  });
});

describe("road figures — all sixteen masks", () => {
  const [tx, ty] = [5, 8];
  const centre = tileCentre(tx, ty);
  const isCentre = (p: GroundPoint) => p[0] === centre[0] && p[1] === centre[1];

  it("covers every mask without throwing, and always touches the centre", () => {
    for (let mask = 0; mask < 16; mask++) {
      const figs = roadFigures(tx, ty, mask);
      expect(figs.length).toBeGreaterThan(0);
      // Every trajectory runs through the tile centre, which is what keeps
      // the lorries (who drive centre to centre) on the road.
      for (const f of figs) expect(f.points.some(isCentre)).toBe(true);
    }
  });

  it("reaches exactly the connected ports, and no others", () => {
    for (let mask = 0; mask < 16; mask++) {
      const reached = new Set<string>();
      for (const f of roadFigures(tx, ty, mask)) {
        for (const p of f.points) if (!isCentre(p)) reached.add(`${p[0]},${p[1]}`);
      }
      const want = new Set(dirsOf(mask).map((d) => portPoint(tx, ty, d).join(",")));
      expect(reached).toEqual(want);
    }
  });

  it("draws a PRESENT-only tile as a single round pad at the centre", () => {
    const figs = roadFigures(tx, ty, 0);
    expect(figs).toHaveLength(1);
    expect(figs[0].points).toHaveLength(1);
    samePoint(figs[0].points[0], centre);
  });

  it("draws one connection as a single arm from the centre out", () => {
    for (const d of ROAD_DIRS) {
      const figs = roadFigures(tx, ty, d);
      expect(figs).toHaveLength(1);
      expect(figs[0].points).toHaveLength(2);
      samePoint(figs[0].points[0], centre);
      samePoint(figs[0].points[1], portPoint(tx, ty, d));
    }
  });

  it("draws two opposite connections as one straight run through the centre", () => {
    for (const [a, b] of [[NE, SW], [SE, NW]] as [Dir, Dir][]) {
      const figs = roadFigures(tx, ty, a | b);
      expect(figs).toHaveLength(1);
      const pts = figs[0].points;
      expect(pts).toHaveLength(3);
      // Straight: the centre is the exact midpoint of the two ports.
      near((pts[0][0] + pts[2][0]) / 2, centre[0]);
      near((pts[0][1] + pts[2][1]) / 2, centre[1]);
    }
  });

  it("draws two adjacent connections as one bend through the centre", () => {
    for (const [a, b] of [[NE, SE], [SE, SW], [SW, NW], [NW, NE]] as [Dir, Dir][]) {
      const figs = roadFigures(tx, ty, a | b);
      expect(figs).toHaveLength(1);
      const pts = figs[0].points;
      expect(pts).toHaveLength(3);
      samePoint(pts[1], centre);
      // Bent, not straight: the ports are not collinear through the centre.
      const mid: GroundPoint = [(pts[0][0] + pts[2][0]) / 2, (pts[0][1] + pts[2][1]) / 2];
      expect(Math.hypot(mid[0] - centre[0], mid[1] - centre[1])).toBeGreaterThan(0.1);
    }
  });

  it("splits three and four connections into through-runs, not four stubs", () => {
    // A crossroads is two straight ribbons crossing.
    const four = roadFigures(tx, ty, 0b1111);
    expect(four).toHaveLength(2);
    for (const f of four) expect(f.points).toHaveLength(3);
    // A T is one straight run plus a stub into the centre.
    const tee = roadFigures(tx, ty, NE | SE | SW);
    expect(tee).toHaveLength(2);
    expect(tee.map((f) => f.points.length).sort()).toEqual([2, 3]);
  });

  it("is deterministic — the same mask always yields the same paths", () => {
    for (let mask = 0; mask < 16; mask++) {
      expect(roadFigures(3, 4, mask)).toEqual(roadFigures(3, 4, mask));
    }
  });

  it("stays inside the tile plus its road width", () => {
    for (let mask = 0; mask < 16; mask++) {
      const tile = roadTile(tx, ty, 0b10000 | mask, "dirt", () => false);
      const b = figureBounds(tile);
      const pad = ROAD_WIDTH.dirt / 2 + 0.1;
      expect(b.u0).toBeGreaterThanOrEqual(tx - pad - 1e-9);
      expect(b.v0).toBeGreaterThanOrEqual(ty - pad - 1e-9);
      expect(b.u1).toBeLessThanOrEqual(tx + 1 + pad + 1e-9);
      expect(b.v1).toBeLessThanOrEqual(ty + 1 + pad + 1e-9);
    }
  });
});

describe("adjacent tiles join without a gap", () => {
  it("meets its neighbour's arm at the identical projected point", () => {
    // Two tiles connected along each axis: the arm end of one must land on
    // the arm end of the other, after projection, to the last bit.
    for (const d of ROAD_DIRS) {
      const [tx, ty] = [11, 6];
      const [nx, ny] = neighbourOf(tx, ty, d);
      const mine = roadFigures(tx, ty, d);
      const theirs = roadFigures(nx, ny, OPPOSITE[d]);
      const myEnd = mine[0].points[1];
      const theirEnd = theirs[0].points[1];
      expect(project(myEnd)).toEqual(project(theirEnd));
    }
  });
});

describe("dirt to paved transitions", () => {
  const [tx, ty] = [20, 20];

  it("gives the transition to the DIRT tile, never the paved one", () => {
    const dirt = roadTile(tx, ty, 0b10000 | NE, "dirt", () => true);
    expect(dirt.transitions).toHaveLength(1);
    const paved = roadTile(tx, ty, 0b10000 | NE, "paved", () => true);
    expect(paved.transitions).toHaveLength(0);
  });

  it("only transitions arms that actually meet paved road", () => {
    const pavedNorth = (nx: number, ny: number) => nx === tx && ny === ty - 1;
    const tile = roadTile(tx, ty, 0b10000 | NE | SE, "dirt", pavedNorth);
    expect(tile.transitions.map((t) => t.dir)).toEqual([NE]);
  });

  it("runs the blend from the shared port inward, the configured distance", () => {
    const tile = roadTile(tx, ty, 0b10000 | SE, "dirt", () => true);
    const [t] = tile.transitions;
    samePoint(t.from, portPoint(tx, ty, SE));
    const span = Math.hypot(t.to[0] - t.from[0], t.to[1] - t.from[1]);
    expect(span).toBeCloseTo(TRANSITION_BLEND, 10);
  });

  it("keeps the blend clear of the junction", () => {
    // The arm is half a tile long; the blend must not reach the centre or a
    // crossroads would come out asphalt in the middle of a gravel run.
    expect(TRANSITION_BLEND).toBeLessThan(0.5);
    const tile = roadTile(tx, ty, 0b10000 | 0b1111, "dirt", () => true);
    const centre = tileCentre(tx, ty);
    for (const t of tile.transitions) {
      expect(Math.hypot(t.to[0] - centre[0], t.to[1] - centre[1])).toBeGreaterThan(0.2);
    }
  });

  it("reports no transitions when nothing around is paved", () => {
    const tile = roadTile(tx, ty, 0b10000 | 0b1111, "dirt", () => false);
    expect(tile.transitions).toHaveLength(0);
  });
});

describe("paint centre-lines", () => {
  const [tx, ty] = [30, 14];

  it("leaves pads and dead ends unmarked", () => {
    expect(paintFigures(tx, ty, 0)).toHaveLength(0);
    for (const d of ROAD_DIRS) expect(paintFigures(tx, ty, d)).toHaveLength(0);
  });

  it("runs one continuous line through a straight or a bend", () => {
    for (const mask of [NE | SW, NE | SE]) {
      const figs = paintFigures(tx, ty, mask);
      expect(figs).toHaveLength(1);
      expect(figs[0].points).toHaveLength(3);
      samePoint(figs[0].points[1], tileCentre(tx, ty));
    }
  });

  it("stops short of the middle at a junction and never crosses it", () => {
    for (const mask of [NE | SE | SW, 0b1111]) {
      const figs = paintFigures(tx, ty, mask);
      expect(figs).toHaveLength(dirsOf(mask).length);
      const centre = tileCentre(tx, ty);
      for (const f of figs) {
        expect(f.points).toHaveLength(2);
        const gap = Math.hypot(f.points[0][0] - centre[0], f.points[0][1] - centre[1]);
        expect(gap).toBeCloseTo(JUNCTION_GAP, 10);
        // The far end is still the port, so approaches stay aligned across
        // the tile boundary with the neighbour's markings.
        expect(f.points[1]).toEqual(
          portPoint(tx, ty, dirsOf(mask).find((d) =>
            portPoint(tx, ty, d).join() === f.points[1].join())!),
        );
      }
    }
  });

  it("keeps the junction gap inside the arm", () => {
    expect(JUNCTION_GAP).toBeGreaterThan(0);
    expect(JUNCTION_GAP).toBeLessThan(0.5);
  });
});
