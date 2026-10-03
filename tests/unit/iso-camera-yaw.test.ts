import { describe, it, expect, afterEach } from "vitest";
import {
  createCamera, snapViewYaw, getViewYaw, worldToScreen, screenToWorld, screenToTileAt, tileToScreenAt, turnWorld,
} from "../../src/iso/camera";
import { turnFootprint, yawQuarter } from "../../src/iso/depth";
import { HW, HH, tileToScreen } from "../../src/game/config";

// LIVE-3D: the view yaw (quarter turns about tile (0,0)) must keep pick, projection and sprite sorting consistent.
afterEach(() => { snapViewYaw(createCamera(800, 600), 0); });

describe("LIVE-3D view yaw", () => {
  it("every tile's turned centre picks that tile back at yaw 0/90/180/270 and any zoom", () => {
    for (let k = 0; k < 4; k++) {
      for (const zoom of [0.5, 1, 2] as const) {
        const c = snapViewYaw({ ...createCamera(1280, 720), zoom, x: 311, y: -97 }, (k * Math.PI) / 2);
        const yaw = getViewYaw(), cs = Math.cos(yaw), sn = Math.sin(yaw);
        for (const [tx, ty] of [[0, 0], [5, 9], [28, 20], [63, 40]]) {
          const [x, y] = tileToScreenAt(c, tx, ty);                    // turned top vertex
          const sx = x + 2 * sn * HH * zoom, sy = y + cs * HH * zoom;   // + turned (0, HH) = the tile centre
          expect(screenToTileAt(c, sx, sy)).toEqual([tx, ty]);
        }
      }
    }
  });

  it("world<->screen round-trips under a turn", () => {
    const c = snapViewYaw({ ...createCamera(1024, 768), zoom: 1, x: 40, y: 80 }, Math.PI / 2);
    const [sx, sy] = worldToScreen(c, 123, 456);
    const [wx, wy] = screenToWorld(c, sx, sy);
    expect(wx).toBeCloseTo(123, 6); expect(wy).toBeCloseTo(456, 6);
  });

  it("a turn pivots about the screen centre: the tile under it does not change", () => {
    const base = { ...createCamera(1280, 720), zoom: 1 as const, x: 384, y: -408 };
    const before = screenToTileAt(base, 640, 360); let cur = base;
    for (let k = 1; k < 4; k++) {
      cur = snapViewYaw(cur, (k * Math.PI) / 2); const c = cur;
      const [tx, ty] = screenToTileAt(c, 640, 360);
      expect(Math.abs(tx - before[0]) + Math.abs(ty - before[1])).toBeLessThanOrEqual(1);   // same tile (centre sits on a corner)
    }
  });

  it("turnFootprint agrees with the world turn: a footprint's centre maps to the turned footprint's centre", () => {
    for (let k = 0; k < 4; k++) {
      const yaw = (k * Math.PI) / 2;
      expect(yawQuarter(yaw)).toBe(k);
      for (const [tx, ty, fw, fh] of [[3, 4, 1, 1], [10, 2, 2, 3], [7, 7, 4, 1]]) {
        const [cx, cy] = tileToScreen(tx + fw / 2, ty + fh / 2);
        const [tcx, tcy] = turnWorld(cx, cy, yaw);
        const [a, b, w2, h2] = turnFootprint(tx, ty, fw, fh, k);
        const [ex, ey] = tileToScreen(a + w2 / 2, b + h2 / 2);
        expect(tcx).toBeCloseTo(ex, 6); expect(tcy).toBeCloseTo(ey, 6);
        expect(w2 * h2).toBe(fw * fh);
      }
    }
    expect(HW).toBe(32);
  });
});
