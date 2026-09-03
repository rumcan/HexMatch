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
      const [dx, dy] = h.tileScreenAt(tx, ty);
      const cx = dx / dpr, cy = (dy + 16) / dpr;
      return !document.elementsFromPoint(cx, cy)
        .some((el) => !!(el as HTMLElement).closest?.(".iso-panel"));
    };
    // U2: the factory is a 3×3 footprint, so its highlight (and the future
    // building) must be fully in-bounds and on screen before we hand back a
    // corridor — otherwise the overlay-pixel sample below cannot see the far
    // corner of the footprint.
    const legalFactory = (hx: number, fy: number) => {
      if (hx + 2 >= MAP_W || fy + 2 >= MAP_H) return false;
      for (let dy = 0; dy < 3; dy++) {
        for (let dx = 0; dx < 3; dx++) {
          if (!inView(hx + dx, fy + dy)) return false;
        }
      }
      return true;
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
    for (const ind of ranked) {
      const hx = ind.tx, hy = ind.ty + ind.h, fy = hy + 6;
      if (legalColumn(hx, hy, fy)) return { hx, hy, fx: hx, fy };
    }
    return null as unknown as { hx: number; hy: number; fx: number; fy: number };
  }).then((c) => {
    expect(c).not.toBeNull();
    return c;
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
    const cx = Math.floor(dx + 16), cy = Math.floor(dy + 16);
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
    const c = await pickCorridor(page);
    const factory = await tileCenter(page, c.fx, c.fy);
    const harvester = await tileCenter(page, c.hx, c.hy);

    // ── setup round 1 of 2: click the tile for your Factory ─────────────
    // U2: before placing, hover the factory footprint and prove the overlay
    // paints the whole 3×3 real footprint, not just the anchor tile.
    await page.mouse.move(factory.x, factory.y);
    await expect.poll(() => opaqueNear(page, 2, c.fx, c.fy), { timeout: 5000 }).toBeGreaterThan(10);
    await expect.poll(() => opaqueNear(page, 2, c.fx + 2, c.fy + 2), { timeout: 5000 }).toBeGreaterThan(10);
    await page.mouse.click(factory.x, factory.y);
    await page.waitForFunction(() => (window as any).__iso.phase === "setup-harvester");
    expect((await page.evaluate(() => (window as any).__iso.factories.length))).toBeGreaterThanOrEqual(1);
    // U2: the guide banner must re-word to the Harvester once the Factory is
    // placed, and the factory highlight footprint is a 3×3 (asserted below in
    // the pixel sample, not here — the banner is the user-facing cue).
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
