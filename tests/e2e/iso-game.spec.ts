import { test, expect } from "@playwright/test";

// ══════════════════════════════════════════════════════════════════════════
// E12 — iso game DOM e2e, against the REAL built app (vite preview).
//
// No mocking anywhere: a real browser mounts the default route (no legacy
// flag), React boots, the iso game fetches the real atlas images, and the
// assertions drive real pointer events through the real canvas + requestAn-
// imationFrame loop. Layout is asserted on the real DOM; gameplay is asserted
// through window.__iso (read-only, mirrors __hex) plus canvas pixel reads so
// "the screen is actually painting" cannot pass by accident.
// ══════════════════════════════════════════════════════════════════════════

/** The default route: iso is the standalone default (E12); seed pins the map. */
const ISO_URL = "/hexmatch/?seed=1337";

async function bootIso(page: import("@playwright/test").Page) {
  await page.goto(ISO_URL);
  await page.waitForFunction(() => {
    const h = (window as any).__iso;
    return !!h && h.phase === "setup-factory" && !!h.grid && h.grid.industries.length > 0;
  }, null, { timeout: 20000 });
}

/**
 * Pick a legal south corridor to play the round on, in-page: harvester tile
 * just below an industry, factory 6 tiles further south, all in-bounds, no
 * water, no industry footprint on the column (roads cannot cross occupancy),
 * and the whole column on screen at the current camera.
 */
async function pickCorridor(page: import("@playwright/test").Page): Promise<{
  hx: number; hy: number; fx: number; fy: number;
}> {
  return page.evaluate(() => {
    const h = (window as any).__iso;
    const grid = h.grid;
    const MAP_W = grid.w, MAP_H = grid.h;
    const WATER = 1;
    const dpr = window.devicePixelRatio || 1;
    const inView = (tx: number, ty: number) => {
      const [dx, dy] = h.tileScreenAt(tx, ty);
      const cx = dx / dpr, cy = dy / dpr;
      return cx >= -20 && cx <= window.innerWidth + 20 && cy >= -20 && cy <= window.innerHeight + 20;
    };
    // J1: the Quarry/Market panels overlay the map and take pointer events, so
    // a tile hidden behind one cannot be clicked. Never pick a corridor under
    // a panel — otherwise this helper hands back a tile the mouse cannot reach.
    const clickable = (tx: number, ty: number) => {
      // K0/K4: tileScreenAt returns the tile's diamond CENTRE now.
      const [dx, dy] = h.tileScreenAt(tx, ty);
      const cx = dx / dpr, cy = dy / dpr;
      return !document.elementsFromPoint(cx, cy)
        .some((el) => !!(el as HTMLElement).closest?.(".iso-panel"));
    };
    // V1: the factory is a 1×1 footprint (one declared sprite, one diamond),
    // so its highlight must be in-bounds and on screen before we hand back a
    // corridor — and the tile diagonally behind it must stay clear, which is
    // what the overlay-pixel sample below asserts.
    const legalFactory = (hx: number, fy: number) => {
      if (hx + 1 >= MAP_W || fy + 1 >= MAP_H) return false;
      return inView(hx, fy) && inView(hx + 1, fy + 1);
    };
    const legalColumn = (hx: number, hy: number, fy: number) => {
      if (hx < 0 || hx >= MAP_W || hy < 0 || fy >= MAP_H) return false;
      if (!legalFactory(hx, fy)) return false;
      for (let y = hy; y <= fy; y++) {
        const i = y * MAP_W + hx;
        if (grid.terrain[i] === WATER) return false;
        if (grid.occupancy[i] >= 0) return false;
        if (!inView(hx, y)) return false;
        if (!clickable(hx, y)) return false;
      }
      return true;
    };
    const focus = grid.industries[0];
    const ranked = [...grid.industries].sort((a, b) =>
      Math.abs(a.tx - focus.tx) + Math.abs(a.ty - focus.ty)
      - (Math.abs(b.tx - focus.tx) + Math.abs(b.ty - focus.ty)));
    const corridorTiles = 7;
    const panels = [...document.querySelectorAll<HTMLElement>(".iso-panel")]
      .map((panel) => panel.getBoundingClientRect());
    const clearLeft = Math.max(0, ...panels.filter((r) => r.left < innerWidth / 2).map((r) => r.right));
    const clearRight = Math.min(innerWidth, ...panels.filter((r) => r.left >= innerWidth / 2).map((r) => r.left));
    const [p0x] = h.tileScreenAt(focus.tx, focus.ty);
    const [p1x] = h.tileScreenAt(focus.tx, focus.ty + 1);
    const stepX = Math.abs(p1x - p0x) / dpr;
    const footprint = stepX * (corridorTiles - 1);
    if (clearRight - clearLeft < footprint) {
      throw new Error(`No ${corridorTiles}-tile corridor can fit: clear band ${Math.round(clearRight - clearLeft)}px, footprint ${Math.round(footprint)}px`);
    }
    const rejected = { terrain: 0, occupancy: 0, view: 0, panel: 0 };
    for (const ind of ranked) {
      const hx = ind.tx, hy = ind.ty + ind.h, fy = hy + corridorTiles - 1;
      if (legalColumn(hx, hy, fy)) return { hx, hy, fx: hx, fy };
      for (let y = hy; y <= fy && y < MAP_H; y++) {
        const i = y * MAP_W + hx;
        if (grid.terrain[i] === WATER) rejected.terrain++;
        else if (grid.occupancy[i] >= 0) rejected.occupancy++;
        else if (!inView(hx, y)) rejected.view++;
        else if (!clickable(hx, y)) rejected.panel++;
      }
    }
    throw new Error(`No buildable corridor at zoomed geometry; rejection counts ${JSON.stringify(rejected)}`);
  });
}

/** CSS-pixel centre of a tile's diamond (top vertex + 16 world px). */
async function tileCenter(page: import("@playwright/test").Page, tx: number, ty: number) {
  return page.evaluate(({ tx, ty }) => {
    const h = (window as any).__iso;
    const dpr = window.devicePixelRatio || 1;
    const [dx, dy] = h.tileScreenAt(tx, ty);
    return { x: (dx + 0) / dpr, y: (dy + 16 * 1) / dpr };
  }, { tx, ty });
}

/** Count opaque pixels in a square around a tile centre on a given canvas. */
async function opaqueNear(
  page: import("@playwright/test").Page, canvasIndex: number,
  tx: number, ty: number, half = 6,
) {
  return page.evaluate(({ canvasIndex, tx, ty, half }) => {
    const h = (window as any).__iso;
    // canvas pixels are device pixels; tileScreenAt already returns device px
    const [dx, dy] = h.tileScreenAt(tx, ty);
    const cx = Math.floor(dx), cy = Math.floor(dy);
    const c = document.querySelectorAll("canvas")[canvasIndex] as HTMLCanvasElement;
    const ctx = c.getContext("2d")!;
    const d = ctx.getImageData(cx - half, cy - half, half * 2 + 1, half * 2 + 1).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  }, { canvasIndex, tx, ty, half });
}

test.describe("iso layout on every viewport", () => {
  test("three canvas layers fill the stage without page overflow", async ({ page }) => {
    await bootIso(page);
    const root = page.locator(".game-root.iso-game");
    await expect(root).toHaveCount(1);
    await expect(root.locator("canvas.iso-layer")).toHaveCount(3);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(root.locator("[data-tool]")).toHaveCount(4);
    await expect(root.locator("[data-act=recenter]")).toHaveCount(1);
  });
});

test.describe("iso game boots on the default route", () => {
  test.skip(({ isMobile }) => !!isMobile, "real-pointer flow runs on desktop chromium");

  test("layout: three real canvas layers and the tool chrome", async ({ page }) => {
    await bootIso(page);
    const root = page.locator(".game-root.iso-game");
    await expect(root).toHaveCount(1);

    // U1: the recovered original chassis, not the old floating NEW-UI panel.
    // The map lives in the original `#map`/`.map-canvas` slot inside .ui-root,
    // with the original topbar / resbar / BUILD / BLACK MARKET / QUARRY chrome.
    await expect(root.locator(".ui-root[data-view=map]")).toHaveCount(1);
    await expect(root.locator(".topbar")).toHaveCount(1);
    await expect(root.locator(".resbar .chipbar#iso-res")).toHaveCount(1);
    await expect(root.locator("aside.left.iso-panel")).toHaveCount(1);
    await expect(root.locator("aside.right.iso-panel")).toHaveCount(1);
    await expect(root.locator(".ui-root aside.left .panel-title")).toHaveCount(2);
    await expect(root.locator(".ui-root aside.left .panel-title").first()).toContainText(/Build/i);
    await expect(root.locator(".ui-root aside.left .panel-title").nth(1)).toContainText(/Black Market/i);
    await expect(root.locator(".ui-root aside.right #iso-quarry")).toHaveCount(1);
    await expect(root.locator(".iso-stage#map")).toHaveCount(1);

    // three stacked canvases (terrain, structures, overlay)
    const layers = root.locator("canvas.iso-layer");
    await expect(layers).toHaveCount(3);
    const z = await layers.evaluateAll((cs) => cs.map((c) => c.style.zIndex));
    expect(z).toEqual(["1", "2", "3"]);
    const sizes = await layers.evaluateAll((cs) =>
      cs.map((c) => ({ w: (c as HTMLCanvasElement).width, h: (c as HTMLCanvasElement).height })));
    for (const s of sizes) { expect(s.w).toBeGreaterThan(0); expect(s.h).toBeGreaterThan(0); }

    // tool chrome with all four tools + recentre
    const tools = await root.locator("[data-tool]").evaluateAll((bs) =>
      bs.map((b) => (b as HTMLElement).dataset.tool));
    expect(tools).toEqual(["road", "rail", "harvester", "demolish"]);
    await expect(root.locator("[data-act=recenter]")).toHaveCount(1);

    // J1: the match-3 quarry is mounted NEXT TO the map, not instead of it,
    // and its cells are real, pickable DOM.
    await expect(root.locator("#iso-quarry")).toBeVisible();
    await expect(root.locator("#iso-quarry .gem")).toHaveCount(81);
    await expect(root.locator('[data-panel="quarry"]')).toHaveCount(1);
    await expect(root.locator('[data-panel="trade"]')).toHaveCount(1);
    const firstGem = root.locator('.gem[data-r="0"][data-c="0"]');
    await expect(firstGem).toHaveAttribute("data-res", /^(wood|brick|sheep|wheat|ore|gold)$/);
    await firstGem.click();
    await expect(firstGem).toHaveClass(/sel/);

    // guided-setup banner + scoreboard + starting purse
    await expect(root.locator("#iso-banner")).toContainText(/place your factory/i);
    await expect(root.locator("#iso-vp")).toContainText("You 0");
    await expect(root.locator("#iso-res")).toContainText("🪨12");

    // a real map with industries, and the renderer is painting real pixels
    // (poll: the terrain canvas fills asynchronously once the atlas loads)
    await expect.poll(async () => page.evaluate(() => {
      const c = document.querySelectorAll("canvas")[0] as HTMLCanvasElement;
      const ctx = c.getContext("2d")!;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let opaque = 0, coloured = 0;
      for (let i = 3; i < d.length; i += 40) {
        if (d[i] > 0) opaque++;
        if (d[i] > 0 && (d[i - 3] !== 0 || d[i - 2] !== 0)) coloured++;
      }
      return opaque > 100 && coloured > 100;
    }), { timeout: 15000 }).toBe(true);
    const stats = await page.evaluate(() => ({
      industries: (window as any).__iso.grid.industries.length,
      seed: (window as any).__iso.grid.seed,
    }));
    expect(stats.industries).toBeGreaterThan(0);
    expect(stats.seed).toBe(1337);

    await test.info().attach("iso-boot-layout", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });

  test("gameplay: factory → harvester → road drag → +1 VP, all real pointer events", async ({ page }) => {
    await bootIso(page);

    // E14: Kenney tiles doubled the boot-camera corridor footprint. Zoom out
    // through the real canvas wheel listener before doing any geometry search;
    // this preserves the occlusion checks instead of relaxing them.
    const tileStep = () => page.evaluate(() => {
      const h = (window as any).__iso;
      const [x0] = h.tileScreenAt(0, 0);
      const [x1] = h.tileScreenAt(0, 1);
      return Math.abs(x1 - x0);
    });
    const beforeZoom = await tileStep();
    await page.mouse.move(640, 360);
    await page.mouse.wheel(0, 1);
    await expect.poll(tileStep).toBeLessThan(beforeZoom);

    const c = await pickCorridor(page);
    const factory = await tileCenter(page, c.fx, c.fy);
    const harvester = await tileCenter(page, c.hx, c.hy);

    // ── setup round 1 of 2: click the tile for your Factory ─────────────
    // V1 acceptance: the placement highlight covers EXACTLY the footprint the
    // building will visibly occupy — the anchor tile glows and the tile
    // diagonally behind it (old 3×3 corner) stays unpainted.
    await page.mouse.move(factory.x, factory.y);
    await expect.poll(() => opaqueNear(page, 2, c.fx, c.fy), { timeout: 5000 }).toBeGreaterThan(10);
    await expect.poll(() => opaqueNear(page, 2, c.fx + 1, c.fy + 1), { timeout: 5000 }).toBe(0);
    await page.mouse.click(factory.x, factory.y);
    await page.waitForFunction(() => (window as any).__iso.phase === "setup-harvester");
    expect((await page.evaluate(() => (window as any).__iso.factories.length))).toBeGreaterThanOrEqual(1);
    // U2: the guide banner must re-word to the Harvester once the Factory is
    // placed (the banner is the user-facing cue; the footprint itself is
    // asserted in the pixel sample above).
    await expect(page.locator("#iso-banner")).toContainText(/place your harvester/i);

    // ── setup round 2 of 2: click the harvester spot beside the industry ─
    // U2: the harvester is a 1×1 building, so its placement glow is the solid
    // tile highlight (the 4×4 catchment around it is the fainter soft tint).
    await page.mouse.move(harvester.x, harvester.y);
    await expect.poll(() => opaqueNear(page, 2, c.hx, c.hy), { timeout: 5000 }).toBeGreaterThan(10);
    await page.mouse.click(harvester.x, harvester.y);
    await page.waitForFunction(() => (window as any).__iso.phase === "play");
    await page.waitForFunction(() => (window as any).__iso.harvesters.length >= 1);
    const h0 = await page.evaluate(() => ({
      free: (window as any).__iso.freeTrack,
      vp: (window as any).__iso.vp,
      stone: (window as any).__iso.purse.stone,
      ore: (window as any).__iso.purse.ore ?? 0,
    }));
    expect(h0.free).toBe(12);
    expect(h0.vp).toEqual({ you: 0, ai: 0 });
    expect(h0.stone).toBe(12);
    expect(h0.ore).toBe(0);

    // ── build phase: drag a road from the Factory down to the harvester ──
    // real pointer stream: move → down on the factory → step tile by tile
    // along the column → up on the harvester.
    await page.mouse.move(factory.x, factory.y);
    await page.mouse.down();
    // walk up the column, tile by tile, from just above the factory to the
    // harvester (the pointerup commits the last hovered tile's preview)
    const steps: { x: number; y: number }[] = [];
    for (let y = c.fy - 1; y > c.hy; y--) {
      steps.push(await tileCenter(page, c.hx, y));
    }
    steps.push(harvester);
    for (const s of steps) await page.mouse.move(s.x, s.y);

    // free setup allowance covers the whole 7-tile column: no purse charge
    await page.mouse.up();
    await page.waitForFunction(() => (window as any).__iso.freeTrack === 5);

    const after = await page.evaluate(() => {
      const h = (window as any).__iso;
      const t = h.track;
      let road = 0;
      for (let i = 0; i < t.road.length; i++) if (t.road[i] & 16) road++;
      return { free: h.freeTrack, vp: h.vp, stone: h.purse.stone, ore: h.purse.ore ?? 0, road };
    });
    expect(after.free).toBe(5);                      // 12 − 7 free tiles used
    expect(after.vp.you).toBe(1);                    // connection scored
    expect(after.vp.ai).toBe(0);
    expect(after.stone).toBe(12);                    // allowance, not purse
    expect(after.ore).toBe(0);
    expect(after.road).toBe(7);

    // the structures canvas really painted the road column
    await expect.poll(
      () => opaqueNear(page, 1, c.hx, c.hy + 3),
      { timeout: 5000 },
    ).toBeGreaterThan(10);

    // UI reflects the scored connection
    await expect(page.locator("#iso-vp")).toContainText("You 1");
    await expect(page.locator("#iso-banner")).toContainText(/free track tiles/i);

    await test.info().attach("iso-round-complete", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// TK-001 — panning is middle-mouse; the left button is build/place ONLY.
// Boot is still in `setup-factory`, which is the cleanest proof that a drag
// can never be mistaken for panning: a left drag must neither move the camera
// nor place the factory, while a middle drag pans the same camera.
// ══════════════════════════════════════════════════════════════════════════
test.describe("TK-001 mouse panning is middle-button only", () => {
  test.skip(({ isMobile }) => !!isMobile, "mouse-button flow runs on desktop chromium");

  test("left-drag never pans or places; middle-drag pans; left-click places", async ({ page }) => {
    await bootIso(page);
    const screenAt = (tx: number, ty: number) => page.evaluate(({ tx, ty }) => {
      const h = (window as any).__iso;
      const dpr = window.devicePixelRatio || 1;
      const [dx, dy] = h.tileScreenAt(tx, ty);
      return { x: dx / dpr, y: dy / dpr };
    }, { tx, ty });

    // A clickable GRASS tile the factory can legally occupy, in view at the
    // boot camera. Unlike pickCorridor we do NOT need a whole road corridor
    // on screen — this test is about mouse buttons, not about playing a round.
    const spot = await page.evaluate(() => {
      const h = (window as any).__iso;
      const grid = h.grid;
      const W = grid.w, H = grid.h;
      const dpr = window.devicePixelRatio || 1;
      const inView = (tx: number, ty: number) => {
        const [dx, dy] = h.tileScreenAt(tx, ty);
        const cx = dx / dpr, cy = dy / dpr;
        return cx >= -20 && cx <= window.innerWidth + 20 && cy >= -20 && cy <= window.innerHeight + 20;
      };
      const clickable = (tx: number, ty: number) => {
        const [dx, dy] = h.tileScreenAt(tx, ty);
        return !document.elementsFromPoint(dx / dpr, dy / dpr)
          .some((el) => !!(el as HTMLElement).closest?.(".iso-panel"));
      };
      const focus = grid.industries[0];
      // spiral out from the on-screen focus industry until the first free,
      // legal, clickable grass tile shows up (terrain GRASS === 0).
      for (let r = 0; r < 14; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const tx = focus.tx + dx, ty = focus.ty + dy;
            if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
            const i = ty * W + tx;
            if (grid.terrain[i] !== 0 || grid.occupancy[i] >= 0) continue;
            if (!inView(tx, ty) || !clickable(tx, ty)) continue;
            return { tx, ty };
          }
        }
      }
      return null;
    });
    expect(spot).not.toBeNull();
    const anchor = await tileCenter(page, spot!.tx, spot!.ty);
    const before = await screenAt(spot!.tx, spot!.ty);
    expect(before.x).toBeGreaterThan(0);

    // ── left-drag: neither pan nor accidental placement ──────────────────
    await page.mouse.move(anchor.x, anchor.y);
    await page.mouse.down({ button: "left" });
    await page.mouse.move(anchor.x - 60, anchor.y + 30, { steps: 8 });
    await page.mouse.up({ button: "left" });
    const afterLeftDrag = await screenAt(spot!.tx, spot!.ty);
    expect(afterLeftDrag).toEqual(before);     // camera did NOT move
    expect(await page.evaluate(() => (window as any).__iso.phase)).toBe("setup-factory");
    expect(await page.evaluate(() => (window as any).__iso.factories.length)).toBe(0);

    // ── middle-drag (started on the same tile) pans the camera ───────────
    const midStart = await screenAt(spot!.tx, spot!.ty);
    await page.mouse.move(midStart.x, midStart.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(midStart.x - 60, midStart.y - 40, { steps: 8 });
    await page.mouse.up({ button: "middle" });
    const afterMiddleDrag = await screenAt(spot!.tx, spot!.ty);
    expect(afterMiddleDrag).not.toEqual(before);
    expect(await page.evaluate(() => (window as any).__iso.phase)).toBe("setup-factory");
    expect(await page.evaluate(() => (window as any).__iso.factories.length)).toBe(0);

    // ── a left CLICK (no drag) still places — the acceptance boundary ────
    const clickHere = await screenAt(spot!.tx, spot!.ty);
    await page.mouse.click(clickHere.x, clickHere.y);
    await page.waitForFunction(() => (window as any).__iso.phase === "setup-harvester");
    expect(await page.evaluate(() => (window as any).__iso.factories.length)).toBeGreaterThanOrEqual(1);
  });
});
