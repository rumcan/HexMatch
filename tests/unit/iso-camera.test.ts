import { describe, it, expect } from "vitest";
import {
  createCamera, worldToScreen, screenToWorld, screenToTileAt, tileToScreenAt,
  stepZoom, zoomAt, zoomStepAt, clampCamera, panBy, centerOnTile, centerOnMap,
  resizeCamera, visibleTileRange, createGesture, pointerDown, pointerMove, pointerUp,
} from "../../src/iso/camera";
import { MAP_W, MAP_H, HW, HH, tileToScreen } from "../../src/game/config";

describe("E4 camera — space conversions", () => {
  it("world→screen→world round-trips at every zoom", () => {
    for (const zoom of [0.5, 1, 2] as const) {
      const c = { ...createCamera(1024, 768), zoom, x: 137, y: -42 };
      for (const [wx, wy] of [[0, 0], [123, 456], [-800, 1200]]) {
        const [sx, sy] = worldToScreen(c, wx, wy);
        expect(screenToWorld(c, sx, sy)).toEqual([wx, wy]);
      }
    }
  });

  it("tileToScreenAt is the inverse of screenToTileAt at lattice points", () => {
    const c = { ...createCamera(800, 600), zoom: 1 as const, x: 0, y: 0 };
    for (const [tx, ty] of [[0, 0], [5, 9], [47, 47], [12, 30]]) {
      const [sx, sy] = tileToScreenAt(c, tx, ty);
      // nudge inside the diamond so we're unambiguously in this tile
      expect(screenToTileAt(c, sx, sy + 1)).toEqual([tx, ty]);
    }
  });
});

describe("E4 camera — zoom", () => {
  it("steps only between 0.5, 1, 2 and saturates", () => {
    expect(stepZoom(0.5, -1)).toBe(0.5);
    expect(stepZoom(0.5, +1)).toBe(1);
    expect(stepZoom(1, +1)).toBe(2);
    expect(stepZoom(2, +1)).toBe(2);
  });

  it("is anchored: the world point under the anchor does not move", () => {
    const c = { ...createCamera(1000, 800), x: 400, y: 300 };
    const ax = 640, ay = 210;
    const before = screenToWorld(c, ax, ay);
    const after = zoomAt(c, 2, ax, ay);
    const back = worldToScreen(after, before[0], before[1]);
    expect(back[0]).toBeCloseTo(ax, 6);
    expect(back[1]).toBeCloseTo(ay, 6);
    expect(after.zoom).toBe(2);
  });

  it("anchored step zoom keeps the tile under the cursor", () => {
    let c = centerOnMap(createCamera(900, 700));
    const px = 500, py = 380;
    const t0 = screenToTileAt(c, px, py);
    c = zoomStepAt(c, +1, px, py);
    expect(screenToTileAt(c, px, py)).toEqual(t0);
    c = zoomStepAt(c, -1, px, py);
    expect(screenToTileAt(c, px, py)).toEqual(t0);
  });
});

describe("E4 camera — clamping", () => {
  it("keeps the map diamond intersecting the viewport after wild pans", () => {
    const base = centerOnMap(createCamera(800, 600));
    for (const [dx, dy] of [[1e6, 1e6], [-1e6, -1e6], [1e6, -1e6]]) {
      const c = panBy(base, dx, dy);
      const left = -MAP_H * HW * c.zoom + c.x;
      const right = MAP_W * HW * c.zoom + c.x;
      const top = 0 + c.y;
      const bottom = (MAP_W + MAP_H) * HH * c.zoom + c.y;
      expect(left).toBeLessThanOrEqual(c.vw);
      expect(right).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThanOrEqual(c.vh);
      expect(bottom).toBeGreaterThanOrEqual(0);
    }
  });

  it("centreOnTile puts the tile's top vertex at the viewport centre", () => {
    const c = centerOnTile(createCamera(800, 600), 24, 24);
    const [wx, wy] = tileToScreen(24, 24);
    expect(worldToScreen(c, wx, wy)).toEqual([400, 300]);
  });

  it("resize re-clamps", () => {
    const c = resizeCamera(centerOnMap(createCamera(800, 600)), 360, 640);
    expect(clampCamera(c)).toEqual(c);
    expect(c.vw).toBe(360);
  });
});

describe("E4 camera — culling", () => {
  it("covers every tile actually on screen", () => {
    const c = centerOnMap(createCamera(640, 480));
    const r = visibleTileRange(c, 8);
    // sample the viewport; every flat-picked in-map tile must be in range
    for (let sx = 0; sx <= 640; sx += 16) {
      for (let sy = 0; sy <= 480; sy += 16) {
        const [tx, ty] = screenToTileAt(c, sx, sy);
        if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue;
        expect(tx).toBeGreaterThanOrEqual(r.x0);
        expect(tx).toBeLessThanOrEqual(r.x1);
        expect(ty).toBeGreaterThanOrEqual(r.y0);
        expect(ty).toBeLessThanOrEqual(r.y1);
      }
    }
  });

  it("is a strict subset of the map at 2× on a small viewport", () => {
    const c = { ...centerOnMap(createCamera(320, 240)), zoom: 2 as const };
    const r = visibleTileRange({ ...c }, 8);
    const tiles = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    expect(tiles).toBeLessThan(MAP_W * MAP_H);
  });
});

describe("E4 camera — gestures", () => {
  it("one finger pans by the pointer delta", () => {
    const cam = centerOnMap(createCamera(800, 600));
    let g = pointerDown(createGesture(), { id: 1, x: 100, y: 100 });
    const r = pointerMove(g, { id: 1, x: 130, y: 90 }, cam);
    expect(r.cam.x).toBe(cam.x + 30);
    expect(r.cam.y).toBe(cam.y - 10);
    g = r.gesture;
    expect(g.lastX).toBe(130);
  });

  it("lifting one finger of a pinch promotes the survivor with no snap", () => {
    const cam = centerOnMap(createCamera(800, 600));
    let g = pointerDown(createGesture(), { id: 1, x: 200, y: 200 });
    g = pointerDown(g, { id: 2, x: 400, y: 200 });
    expect(g.panId).toBeNull();
    g = pointerUp(g, 1);
    expect(g.panId).toBe(2);
    expect([g.lastX, g.lastY]).toEqual([400, 200]);
    // the very next move must not jump the camera by the finger's absolute pos
    const r = pointerMove(g, { id: 2, x: 405, y: 200 }, cam);
    expect(r.cam.x).toBe(cam.x + 5);
  });

  it("pinch zooms anchored on the midpoint", () => {
    const cam = centerOnMap(createCamera(800, 600));
    let g = pointerDown(createGesture(), { id: 1, x: 300, y: 300 });
    g = pointerDown(g, { id: 2, x: 500, y: 300 });
    // midpoint after the move is (500,300) — that is the anchor
    const t0 = screenToTileAt(cam, 500, 300);
    const r = pointerMove(g, { id: 2, x: 700, y: 300 }, cam);
    expect(r.cam.zoom).toBe(2);
    expect(screenToTileAt(r.cam, 500, 300)).toEqual(t0);
  });
});
