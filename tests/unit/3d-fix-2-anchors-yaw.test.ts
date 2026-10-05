// 3D-FIX-2 (#661), the rest: the tile-ANCHORED overlays (labels, floats, the
// build flash, protest crowds, the guide's spotlight) and the site bounds.
//
// They anchored on a fixed lattice corner — "the top vertex is corner (tx,ty)",
// "the bottom vertex is (tx+1,ty+1)". Under a view turn that corner is no longer
// the top (or bottom) of the tile on screen, so a label slid half a tile sideways
// at yaw 90/180/270. `tileVertexAt` anchors on the turned tile centre instead;
// these tests pin it to the drawn diamond at every quarter, and pin yaw 0 to the
// old corner path exactly.
import { afterEach, describe, expect, it } from "vitest";
import {
  createCamera, snapViewYaw, tileToScreenAt, tileVertexAt, type Camera,
} from "../../src/iso/camera";
import { HH } from "../../src/iso/config";
import { loopsBounds, tileLoop } from "../../src/iso/overlay-art";

afterEach(() => { snapViewYaw(createCamera(800, 600), 0); });

const camAt = (k: number): Camera =>
  snapViewYaw({ ...createCamera(900, 640), zoom: 2, x: 137, y: -211 }, (k * Math.PI) / 2);

/** The tile's four lattice corners on screen, under the current yaw. */
const diamond = (c: Camera, tx: number, ty: number): [number, number][] =>
  [[tx, ty], [tx + 1, ty], [tx + 1, ty + 1], [tx, ty + 1]].map(([x, y]) => tileToScreenAt(c, x, y));

const TILES: [number, number][] = [[0, 0], [12, 7], [40, 3], [5, 61]];

describe("3D-FIX-2: tile-anchored overlays follow the turn", () => {
  it("yaw 0 keeps the lattice-corner anchors exactly", () => {
    const c = camAt(0);
    for (const [tx, ty] of TILES) {
      expect(tileVertexAt(c, tx, ty, -1)).toEqual(tileToScreenAt(c, tx, ty));
      expect(tileVertexAt(c, tx, ty, 1)).toEqual(tileToScreenAt(c, tx + 1, ty + 1));
    }
  });

  for (const k of [0, 1, 2, 3]) {
    it(`yaw ${k * 90}: the top/bottom anchors are the drawn diamond's top/bottom vertices`, () => {
      const c = camAt(k);
      for (const [tx, ty] of TILES) {
        const d = diamond(c, tx, ty);
        const top = d.reduce((a, b) => (b[1] < a[1] ? b : a));
        const bot = d.reduce((a, b) => (b[1] > a[1] ? b : a));
        const [ax, ay] = tileVertexAt(c, tx, ty, -1);
        const [bx, by] = tileVertexAt(c, tx, ty, 1);
        expect(ax).toBeCloseTo(top[0], 6);
        expect(ay).toBeCloseTo(top[1], 6);
        expect(bx).toBeCloseTo(bot[0], 6);
        expect(by).toBeCloseTo(bot[1], 6);
        // half a tile apart, straight down the screen
        expect(by - ay).toBeCloseTo(2 * HH * c.zoom, 6);
      }
    });
  }

  it("site bounds use the outline's own (lifted) corners when given", () => {
    const c = camAt(1);
    const loop = tileLoop(10, 10);
    const flat = loopsBounds(c, [loop])!;
    const lift = 24;
    const lifted = loopsBounds(c, [loop], (p) => {
      const [x, y] = tileToScreenAt(c, p[0], p[1]);
      return [x, y - lift];
    })!;
    expect(lifted.x0).toBeCloseTo(flat.x0, 9);
    expect(lifted.x1).toBeCloseTo(flat.x1, 9);
    expect(lifted.y0).toBeCloseTo(flat.y0 - lift, 9);
    expect(lifted.y1).toBeCloseTo(flat.y1 - lift, 9);
  });
});
