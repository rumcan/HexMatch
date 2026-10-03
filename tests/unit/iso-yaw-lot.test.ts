import { describe, it, expect, afterEach } from "vitest";
import { createCamera, snapViewYaw, worldToScreen } from "../../src/iso/camera";
import { footprintPin, turnFootprint, turnPlaced, turnTilePoint, type Placed } from "../../src/iso/depth";
import { liftShift } from "../../src/iso/elevation";
import { tileToScreen } from "../../src/game/config";

afterEach(() => { snapViewYaw(createCamera(800, 600), 0); });
const FPS: [number, number][] = [[1, 1], [1, 2], [2, 1], [2, 2], [1, 3], [3, 1], [2, 4], [4, 2]];

describe("LIVE-3D buildings keep their lot under a view turn", () => {
  for (const center of [false, true]) for (const [fw, fh] of FPS) it(`${fw}x${fh}${center ? " centre-anchored" : ""}: anchor sits on the turned footprint at all 4 yaws`, () => {
    const tx = 11, ty = 7, anchor: [number, number] = [60, 90];
    const def = { footprint: [fw, fh], anchor, center } as unknown as Placed["def"];
    const [pwx, pwy] = footprintPin(def, tx, ty, fw, fh);
    const p = { def, tx, ty, wx: pwx - anchor[0], wy: pwy - anchor[1], w: 120, h: 120, sprite: "t", key: 0 } as unknown as Placed;
    for (let k = 0; k < 4; k++) {
      const cam = snapViewYaw({ ...createCamera(800, 600), x: 0, y: 0, zoom: 1 }, (k * Math.PI) / 2);
      const { draw, sort } = turnPlaced(p, (k * Math.PI) / 2, k);
      // where the sprite's anchor pixel is drawn on screen
      const [ox, oy] = worldToScreen(cam, draw.wx, draw.wy), sx = ox + anchor[0], sy = oy + anchor[1];   // the art never turns
      // where the turned footprint's pin is (the turned lattice IS the screen lattice at this yaw)
      const [a, b, w2, h2] = turnFootprint(tx, ty, fw, fh, k);
      const [ex, ey] = footprintPin(def, a, b, w2, h2);
      expect(sx).toBeCloseTo(ex + cam.x, 6); expect(sy).toBeCloseTo(ey + cam.y, 6);
      // the tile set the game uses (sort footprint) is the turned image of every original tile
      expect(sort.def.footprint).toEqual([w2, h2]);
      for (let dx = 0; dx < fw; dx++) for (let dy = 0; dy < fh; dy++) {
        const [u, v] = turnTilePoint(tx + dx + 0.5, ty + dy + 0.5, k);
        expect(u).toBeGreaterThan(a); expect(u).toBeLessThan(a + w2); expect(v).toBeGreaterThan(b); expect(v).toBeLessThan(b + h2);
      }
      void tileToScreen;
    }
  });

  it("the baked hill lift stays screen-vertical at every quarter turn", () => {
    for (let q = 0; q < 4; q++) {
      const [u, v] = liftShift(5, 9, 0.75, q);
      const [tu, tv] = turnTilePoint(u - 5, v - 9, q);   // turn the lift vector with the raster
      expect(tu).toBeCloseTo(-0.75, 9); expect(tv).toBeCloseTo(-0.75, 9);
    }
  });
});
