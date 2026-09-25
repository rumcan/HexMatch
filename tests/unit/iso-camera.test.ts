import { describe, it, expect } from "vitest";
import {
  createCamera, worldToScreen, screenToWorld, screenToTileAt, tileToScreenAt,
  stepZoom, zoomAt, zoomStepAt, clampCamera, panBy, centerOnTile, centerOnMap, centerOnWorld,
  resizeCamera, visibleTileRange, createGesture, pointerDown, pointerMove, pointerUp,
  mapWorldBounds, bootZoomFor, tapSlop, tileCssAt,
} from "../../src/iso/camera";
import { MAP_W, MAP_H, tileToScreen } from "../../src/game/config";

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

  it("I2 round-trips every tile at every zoom and a non-zero camera offset", () => {
    for (const zoom of [0.5, 1, 2] as const) {
      const c = { ...createCamera(800, 600), zoom, x: 137, y: -42 };
      for (let tx = 0; tx < MAP_W; tx++) {
        for (let ty = 0; ty < MAP_H; ty++) {
          const [sx, sy] = tileToScreenAt(c, tx, ty);
          expect(screenToTileAt(c, sx, sy), `${zoom}× (${tx},${ty})`).toEqual([tx, ty]);
        }
      }
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
      // K4: read the real world bounds (the diamond reaches HH above tile
      // (0,0)'s centre-line and HH below the last skirt) instead of assuming
      // minY = 0.
      const b = mapWorldBounds();
      const left = b.minX * c.zoom + c.x;
      const right = b.maxX * c.zoom + c.x;
      const top = b.minY * c.zoom + c.y;
      const bottom = b.maxY * c.zoom + c.y;
      expect(left).toBeLessThanOrEqual(c.vw);
      expect(right).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThanOrEqual(c.vh);
      expect(bottom).toBeGreaterThanOrEqual(0);
    }
  });

  it("centreOnTile puts the tile's diamond centre at the viewport centre", () => {
    const c = centerOnTile(createCamera(800, 600), 24, 24);
    const [wx, wy] = tileToScreen(24, 24);
    expect(worldToScreen(c, wx, wy)).toEqual([400, 300]);
  });

  // M1 (#254): the minimap centres the view on a WORLD point (a click can land
  // between tiles). The tile helper is now that same call, so the two can
  // never drift apart — including at every zoom and through the clamp.
  it("M1 centerOnWorld centres any world point, and centerOnTile is exactly it", () => {
    for (const zoom of [0.5, 1, 2] as const) {
      const cam = { ...createCamera(1280, 720), zoom };
      const c = centerOnWorld(cam, 321.5, 1234.25);
      expect(worldToScreen(c, 321.5, 1234.25)).toEqual([640, 360]);
      expect(c.zoom).toBe(zoom);
      expect([c.vw, c.vh]).toEqual([1280, 720]);
      for (const [tx, ty] of [[24, 24], [0, 0], [MAP_W - 1, MAP_H - 1], [70.5, 12.25]]) {
        const [wx, wy] = tileToScreen(tx, ty);
        expect(centerOnTile(cam, tx, ty), `${zoom}× (${tx},${ty})`).toEqual(centerOnWorld(cam, wx, wy));
      }
    }
    // A point far off the island clamps like any other camera write.
    const far = centerOnWorld(createCamera(800, 600), 1e6, -1e6);
    expect(clampCamera(far)).toEqual(far);
    expect(far).toEqual(clampCamera({ ...createCamera(800, 600), x: 400 - 1e6, y: 300 + 1e6 }));
  });

  it("resize keeps the same world point centred, including high-DPI boot", () => {
    const c = centerOnMap(createCamera(390, 844));
    const before = screenToWorld(c, c.vw / 2, c.vh / 2);
    const resized = resizeCamera(c, 780, 1688);
    expect(screenToWorld(resized, resized.vw / 2, resized.vh / 2)).toEqual(before);
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

describe("MOBILE-01 — a boot zoom that is one size on every screen", () => {
  it("keeps the desktop tile exactly where it has always been", () => {
    // dpr 1 is the desktop the whole HUD was drawn against: 64 CSS px a tile.
    expect(bootZoomFor(1)).toBe(1);
    expect(tileCssAt(bootZoomFor(1), 1)).toBe(64);
  });

  it("gives a phone a fingertip-sized tile, not a postage stamp", () => {
    // Before MOBILE-01 every screen booted at zoom 1, which at dpr 2/3 is a
    // 32/21 CSS-px tile — under half a fingertip. The boot step must now land
    // in the comfortable band on every dpr the game actually renders at (the
    // canvas caps devicePixelRatio at 2, so 2 is the hottest real case).
    for (const raw of [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4]) {
      const dpr = Math.min(2, raw);
      const css = tileCssAt(bootZoomFor(dpr), dpr);
      expect(css, `dpr ${raw}`).toBeGreaterThanOrEqual(40);
      expect(css, `dpr ${raw}`).toBeLessThanOrEqual(76);
    }
    expect(bootZoomFor(2)).toBe(2);
    expect(tileCssAt(bootZoomFor(2), 2)).toBe(64);   // same as desktop
  });

  it("never answers with a step the atlas does not ship", () => {
    for (let dpr = 0.5; dpr <= 5; dpr += 0.25) {
      expect([0.5, 1, 2] as const).toContain(bootZoomFor(dpr));
    }
  });

  it("zooming about the viewport centre keeps the centred tile centred", () => {
    // the boot applies its zoom through zoomAt at the middle of the stage;
    // the e2e's "focus == centre" assertion rides on this.
    const c = centerOnMap(createCamera(390, 844));
    const [tx, ty] = screenToTileAt(c, 390 / 2, 844 / 2);
    const z = zoomAt(c, bootZoomFor(3), 390 / 2, 844 / 2);
    expect(screenToTileAt(z, 390 / 2, 844 / 2)).toEqual([tx, ty]);
    // …and the CSS→device resize that follows keeps it there too.
    const r = resizeCamera(z, 390 * 2, 844 * 2);
    expect(screenToTileAt(r, 390, 844)).toEqual([tx, ty]);
  });
});

describe("MOBILE-01 — tap slop is a fingertip, not a mouse hair", () => {
  it("keeps the mouse's precise 4 device px (TK-001)", () => {
    expect(tapSlop("mouse", 1)).toBe(4);
    expect(tapSlop("mouse", 3)).toBe(4);
  });

  it("gives touch ~10 CSS px in the canvas' own device pixels", () => {
    expect(tapSlop("touch", 1)).toBe(10);
    expect(tapSlop("touch", 2)).toBe(20);
    expect(tapSlop("touch", 3)).toBe(30);
    // a two-CSS-px finger jitter at dpr 3 must stay INSIDE the slop…
    expect(2 * 3).toBeLessThanOrEqual(tapSlop("touch", 3));
    // …while a real drag (this audit's 100px pan) stays outside it.
    expect(100 * 3).toBeGreaterThan(tapSlop("touch", 3));
  });
});
