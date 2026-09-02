import { describe, it, expect } from "vitest";
import {
  TILE_W, TILE_H, HW, HH, MAP_W, MAP_H,
  tileToScreen, screenToTile, ZOOM_LEVELS,
} from "../../src/iso/config";

describe("E0 constants", () => {
  it("uses a 2:1 dimetric tile (64×32)", () => {
    expect(TILE_W).toBe(64);
    expect(TILE_H).toBe(32);
    expect(HW).toBe(32);
    expect(HH).toBe(16);
    expect(TILE_W).toBe(TILE_H * 2);
  });
  it("grid is 48×48", () => {
    expect(MAP_W).toBe(48);
    expect(MAP_H).toBe(48);
    expect(MAP_W * MAP_H).toBe(2304);
  });
  it("zoom is three integer steps only", () => {
    expect([...ZOOM_LEVELS]).toEqual([0.5, 1, 2]);
  });
});

describe("E0 tileToScreen", () => {
  it("matches the standard 2:1 formula", () => {
    const [sx, sy] = tileToScreen(3, 5);
    expect(sx).toBe((3 - 5) * HW);
    expect(sy).toBe((3 + 5) * HH);
  });
  it("origin maps to the screen origin", () => {
    expect(tileToScreen(0, 0)).toEqual([0, 0]);
  });
});

describe("E0 screenToTile (flooring, not rounding)", () => {
  it("round-trips EVERY one of the 2304 tile centres", () => {
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const [sx, sy] = tileToScreen(tx, ty);
        // probe the tile centre: average of the four diamond corners
        const cx = sx, cy = sy + HH;
        expect(screenToTile(cx, cy)).toEqual([tx, ty]);
      }
    }
  });

  it("returns the containing tile at all four diamond corners (20 samples)", () => {
    const samples = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28,
      31, 34, 37, 40, 43, 46, 2, 12, 30, 44];
    for (const i of samples) {
      const tx = i, ty = (i * 7) % MAP_H;
      const [nx, ny] = tileToScreen(tx, ty);
      // diamond corners (N, E, S, W), inset by a fraction to stay strictly inside
      const eps = 0.9;
      const corners: [number, number][] = [
        [nx, ny + eps],             // N (just inside)
        [nx + HW - eps, ny + HH],   // E
        [nx, ny + TILE_H - eps],    // S
        [nx - HW + eps, ny + HH],   // W
      ];
      for (const [px, py] of corners) {
        expect(screenToTile(px, py)).toEqual([tx, ty]);
      }
    }
  });

  it("floors instead of rounding: a point just over a diamond edge stays in its tile", () => {
    // tile (5,5) north corner projects to (0, 160); sample slightly toward centre
    const [sx, sy] = tileToScreen(5, 5);
    // a sub-tile offset toward the east corner but still inside (5,5)
    expect(screenToTile(sx + HW * 0.4, sy + HH * 0.4)).toEqual([5, 5]);
    expect(screenToTile(sx - HW * 0.4, sy + HH * 0.4)).toEqual([5, 5]);
  });

  it("inverts tileToScreen algebraically across the grid", () => {
    for (let ty = 0; ty < MAP_H; ty += 5) {
      for (let tx = 0; tx < MAP_W; tx += 5) {
        const [sx, sy] = tileToScreen(tx, ty);
        // screen point on the tile's south corner should floor back to (tx,ty)
        const [gx, gy] = screenToTile(sx, sy + TILE_H - 1);
        expect([gx, gy]).toEqual([tx, ty]);
      }
    }
  });
});
