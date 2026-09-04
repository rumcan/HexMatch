import { describe, it, expect } from "vitest";
import {
  TILE_W, TILE_H, HW, HH, MAP_W, MAP_H, ZOOM_STEPS,
  tileToScreen, screenToTile,
} from "../../src/game/config";

// Test fixture #1 from the E-series: projection round-trip (K0 re-baseline).
// tileToScreen is the diamond CENTRE (== the pick cell's top vertex);
// screenToTile floors to the tile whose pick cell contains the point
// (E0 — floor, never round).

describe("K0 projection constants", () => {
  it("fixes the 2:1 dimetric tile (Kenney 132×64 diamond + 50px skirt) and the 32×32 map", () => {
    expect(TILE_W).toBe(132);
    expect(TILE_H).toBe(64);
    expect(HW).toBe(66);
    expect(HH).toBe(32);
    expect(MAP_W * MAP_H).toBe(1024);
  });

  it("exposes integer-stepped zoom levels only", () => {
    expect(ZOOM_STEPS).toEqual([0.5, 1, 2]);
  });
});

describe("tileToScreen / screenToTile", () => {
  it("round-trips every one of the 1024 tiles", () => {
    for (let tx = 0; tx < MAP_W; tx++) {
      for (let ty = 0; ty < MAP_H; ty++) {
        const [sx, sy] = tileToScreen(tx, ty);
        const [rx, ry] = screenToTile(sx, sy);
        expect([rx, ry], `tile (${tx},${ty}) -> screen (${sx},${sy})`).toEqual([tx, ty]);
      }
    }
  });

  it("maps the four pick-cell corners of sampled tiles to the tiles whose top vertex sits there", () => {
    // The diamond of tile (tx,ty) has its corners at the top vertices of the
    // diagonal neighbours: top = itself, right = SE (tx+1,ty), bottom = the
    // tile straight below (tx+1,ty+1), left = SW (tx,ty+1).
    const samples: [number, number][] = [
      [0, 0], [31, 31], [31, 0], [0, 31],          // map corners
      [10, 10], [23, 23], [3, 28], [28, 3],        // interior spread
      [12, 5], [5, 12], [35, 20], [20, 35], [30, 30],
      [1, 1], [30, 30], [1, 20], [20, 1], [16, 31], [31, 16], [22, 7],
    ];
    expect(samples.length).toBeGreaterThanOrEqual(20);
    for (const [tx, ty] of samples) {
      const corners: [string, [number, number], [number, number]][] = [
        ["top", tileToScreen(tx, ty), [tx, ty]],
        ["right", tileToScreen(tx + 1, ty), [tx + 1, ty]],
        ["bottom", tileToScreen(tx + 1, ty + 1), [tx + 1, ty + 1]],
        ["left", tileToScreen(tx, ty + 1), [tx, ty + 1]],
      ];
      for (const [name, [sx, sy], want] of corners) {
        expect(screenToTile(sx, sy),
          `${name} corner of (${tx},${ty}) at screen (${sx},${sy})`)
          .toEqual(want);
      }
    }
  });

  it("picks the tile itself 1px inside every diamond edge (floor, not round)", () => {
    // Points just inside each edge of the diamond must belong to the tile.
    // Math.round shifts this band by half a tile along every boundary — this
    // is the regression that pins E0's Math.floor.
    const samples: [number, number][] = [
      [10, 10], [23, 23], [3, 28], [28, 3], [12, 5], [5, 12],
      [25, 20], [30, 30], [16, 31], [31, 16], [0, 0], [31, 31],
    ];
    for (const [tx, ty] of samples) {
      const [cx, cy] = tileToScreen(tx, ty);
      const probes: [string, number, number][] = [
        ["north edge", cx, cy + 1],        // just below the top vertex
        ["east edge", cx + HW - 1, cy + HH],  // just left of the right vertex
        ["south edge", cx, cy + TILE_H - 1], // just above the bottom vertex
        ["west edge", cx - HW + 1, cy + HH], // just right of the left vertex
      ];
      for (const [name, px, py] of probes) {
        expect(screenToTile(px, py),
          `${name} probe (${px},${py}) of tile (${tx},${ty})`)
          .toEqual([tx, ty]);
      }
    }
  });

  it("assigns points just across each diamond edge to the edge-adjacent tile", () => {
    // Diamond of (tx,ty): top (cx,cy), right (cx+32,cy+16), bottom
    // (cx,cy+32), left (cx-32,cy+16). Probes 1px past the midpoint of each
    // edge must land in the tile on the other side:
    //   top-left edge   → NW (tx-1,ty);  top-right edge → NE (tx,ty-1)
    //   bottom-right    → SE (tx+1,ty);  bottom-left    → SW (tx,ty+1)
    const samples: [number, number][] = [[10, 10], [23, 17], [3, 28], [25, 6]];
    for (const [tx, ty] of samples) {
      const [cx, cy] = tileToScreen(tx, ty);
      const probes: [string, [number, number], [number, number]][] = [
        ["NW", [cx - HW + 1, cy + HH - 1], [tx - 1, ty]],     // over top-left edge
        ["NE", [cx + HW - 1, cy + HH - 1], [tx, ty - 1]],     // over top-right edge
        ["SE", [cx + HW - 1, cy + HH + 1], [tx + 1, ty]],     // over bottom-right edge
        ["SW", [cx - HW + 1, cy + HH + 1], [tx, ty + 1]],     // over bottom-left edge
      ];
      for (const [name, [px, py], want] of probes) {
        expect(screenToTile(px, py),
          `${name} probe (${px},${py}) of tile (${tx},${ty})`)
          .toEqual(want);
      }
      // A tile's diamond centre always belongs to the tile itself.
      expect(screenToTile(cx, cy + HH)).toEqual([tx, ty]);
    }
  });
});
