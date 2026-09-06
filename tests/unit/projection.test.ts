import { describe, it, expect } from "vitest";
import {
  TILE_W, TILE_H, HW, HH, MAP_W, MAP_H, ZOOM_STEPS,
  tileToScreen, screenToTile,
} from "../../src/game/config";

// I2: draw and pick use one centred-diamond transform. tileToScreen returns
// the diamond centre; screenToTile is its exact floor-based inverse.

describe("K0 projection constants", () => {
  it("fixes the 2:1 dimetric tile and the 32×32 map", () => {
    expect(TILE_W).toBe(132);
    expect(TILE_H).toBe(64);
    expect(HW).toBe(66);
    expect(HH).toBe(32);
    expect(MAP_W * MAP_H).toBe(1024);
  });

  it("exposes the three pre-rendered zoom levels", () => {
    expect(ZOOM_STEPS).toEqual([0.5, 1, 2]);
  });
});

describe("I2 tileToScreen / screenToTile", () => {
  const samples: [number, number][] = [
    [0, 0], [31, 31], [31, 0], [0, 31],
    [10, 10], [23, 23], [3, 28], [28, 3], [12, 5], [5, 12],
  ];

  it("round-trips every one of the 1024 tile centres", () => {
    for (let tx = 0; tx < MAP_W; tx++) {
      for (let ty = 0; ty < MAP_H; ty++) {
        const [sx, sy] = tileToScreen(tx, ty);
        expect(screenToTile(sx, sy), `tile (${tx},${ty})`).toEqual([tx, ty]);
      }
    }
  });

  it("assigns each shared vertex deterministically", () => {
    for (const [tx, ty] of samples) {
      const [cx, cy] = tileToScreen(tx, ty);
      const vertices: [string, [number, number], [number, number]][] = [
        ["top", [cx, cy - HH], [tx, ty]],
        ["right", [cx + HW, cy], [tx + 1, ty]],
        ["bottom", [cx, cy + HH], [tx + 1, ty + 1]],
        ["left", [cx - HW, cy], [tx, ty + 1]],
      ];
      for (const [name, point, want] of vertices) {
        expect(screenToTile(...point), `${name} vertex of (${tx},${ty})`).toEqual(want);
      }
    }
  });

  it("keeps points one pixel inside every centred-diamond vertex", () => {
    for (const [tx, ty] of samples) {
      const [cx, cy] = tileToScreen(tx, ty);
      for (const [name, px, py] of [
        ["top", cx, cy - HH + 1],
        ["right", cx + HW - 1, cy],
        ["bottom", cx, cy + HH - 1],
        ["left", cx - HW + 1, cy],
      ] as [string, number, number][]) {
        expect(screenToTile(px, py), `${name} of (${tx},${ty})`).toEqual([tx, ty]);
      }
    }
  });

  it("hands points just across each edge to the adjacent diamond", () => {
    for (const [tx, ty] of samples.slice(4)) {
      const [cx, cy] = tileToScreen(tx, ty);
      const probes: [string, [number, number], [number, number]][] = [
        ["NW", [cx - HW / 2 - 1, cy - HH / 2 - 1], [tx - 1, ty]],
        ["NE", [cx + HW / 2 + 1, cy - HH / 2 - 1], [tx, ty - 1]],
        ["SE", [cx + HW / 2 + 1, cy + HH / 2 + 1], [tx + 1, ty]],
        ["SW", [cx - HW / 2 - 1, cy + HH / 2 + 1], [tx, ty + 1]],
      ];
      for (const [name, point, want] of probes) {
        expect(screenToTile(...point), `${name} edge of (${tx},${ty})`).toEqual(want);
      }
    }
  });
});
