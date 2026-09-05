import { test, expect } from "@playwright/test";
import {
  findIsoCorridor, isoTileOcclusion, isoClickableTile, type Corridor,
} from "./corridor-picker";

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

// E14 — the corridor the gameplay round is played on is chosen by
// `findIsoCorridor` (tests/e2e/corridor-picker.ts): it measures the tile step
// and the clear band between the HUD panels instead of assuming a fixed 7-tile
// south column that only ever fitted at the pre-Kenney 64px tile, it searches
// all four track directions, it filters tiles through the GAME's own legality
// rule (`__iso.tileProbe`, i.e. `buildRefusal`), and it throws with the closest
// candidate plus the filter that rejected it rather than returning `null`.
// It is passed to `page.evaluate` as a function reference: Playwright ships its
// source into the page, which is why it is self-contained — and why
// tests/unit/iso-corridor-picker.test.ts runs `String(fn)` as well as the
// import, so that contract is tested, not trusted.
async function pickCorridor(
  page: import("@playwright/test").Page,
  opts?: { minTiles?: number; maxTiles?: number },
): Promise<Corridor> {
  return page.evaluate(findIsoCorridor, opts ?? { minTiles: 4, maxTiles: 7 });
}

/**
 * One real wheel step over the map (E14 fix candidate (a)). ZOOM_STEPS are
 * 0.5/1/2 and `canvases.overlay` owns the wheel listener, so this is a genuine
 * user gesture — no camera API is poked. Returns the CSS px a single tile step
 * now covers, so a caller can assert the zoom actually moved.
 */
async function zoomStep(page: import("@playwright/test").Page, dir: "out" | "in") {
  const tileStepPx = () => page.evaluate(() => {
    const h = (window as any).__iso;
    const dpr = window.devicePixelRatio || 1;
    const [x0] = h.tileScreenAt(0, 0);
    const [x1] = h.tileScreenAt(0, 1);
    return Math.round((Math.abs(x1 - x0) / dpr) * 100) / 100;
  });
  const before = await tileStepPx();
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, dir === "out" ? 1 : -1);
  await expect
    .poll(tileStepPx, {
      timeout: 5000,
      message: "the wheel gesture did not change the camera's tile step — either the step is clamped "
        + "(ZOOM_STEPS is 0.5/1/2) or the overlay canvas did not receive the event",
    })
    .not.toBe(before);      // fails loudly if the camera is clamped at the step
  return { before, after: await tileStepPx() };
}

/** E14/A3: the picker's own failure text is part of the assertion trail. */
function describeCorridorError(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The viewport point to click to reach a tile — the page-side
 * `isoClickableTile` from tests/e2e/corridor-picker.ts, so every click of the
 * round is resolved against the LIVE state: on screen, not swallowed by HUD
 * chrome, and answered by the game's own pick with the tile it names.
 *
 * The spec deliberately does no geometry of its own here. It used to: it
 * derived its aim offset from `tileScreenAt(0,1)` minus *the target tile*
 * instead of `tileScreenAt(0,0)` → `tileScreenAt(0,1)`, which at tile (24,10)
 * made a tile step fifteen tiles long and put the whole round's mouse 16 tiles
 * away from the tiles it claimed. And a point verified once up front is not
 * enough either — placing the Factory and the Harvester changes what the
 * stage-2 sprite pick answers, which is what the second CI run caught. Both
 * failure modes are now the helper's problem, and it fails loudly.
 */
async function clickPointFor(
  page: import("@playwright/test").Page, tx: number, ty: number,
  prefer?: { x: number; y: number },
) {
  return page.evaluate(isoClickableTile, { tx, ty, aim: prefer });
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

    // E14 fix candidate (a): the Kenney tiles doubled every footprint, so the
    // corridor the round is played on has to be searched at a camera that can
    // actually frame one. The wheel is a real gesture on the real listener —
    // the camera is never poked, and the occlusion filters are kept, not
    // relaxed. If 0.5x frames nothing, 1x is the only other geometry worth
    // asking, so the search is retried once after a second real gesture.
    await zoomStep(page, "out");
    let c: Corridor;
    try {
      c = await pickCorridor(page);
    } catch (err) {
      const first = describeCorridorError(err);
      await zoomStep(page, "in");
      try {
        c = await pickCorridor(page);
      } catch (err2) {
        throw new Error(
          `pickCorridor found no playable corridor at either zoom.\n`
          + `  at 0.5x — ${first}\n  at 1x  — ${describeCorridorError(err2)}`,
        );
      }
    }
    // E14/A2: the helper picked the corridor by geometry, so the geometry the
    // rest of the test relies on is reported with it.
    test.info().annotations.push({
      type: "corridor",
      description: `${c.tiles} tiles ${c.dir} from (${c.hx},${c.hy}) to (${c.fx},${c.fy}), `
        + `click offset (${c.aim.x}, ${c.aim.y}), ${Math.round(c.margin)}px clear of the HUD`,
    });
    const n = c.tiles;
    const aim = c.aim;
    const at = (tx: number, ty: number) => clickPointFor(page, tx, ty, aim);
    const factory = await at(c.fx, c.fy);
    const harvester = await at(c.hx, c.hy);

    // A2: every tile a pointer event is about to land on is reachable —
    // re-checked here, independently of the filter that chose them, because a
    // corridor under a panel is exactly the failure this suite exists to catch.
    // The points asserted on are the points the round is about to click (the
    // same resolution the clicks themselves go through), not a re-derivation.
    // (The tile diagonally behind the factory is only *sampled* for pixels, so
    // it is deliberately not part of the clickability claim.)
    const planned = await Promise.all(
      c.col.map(async (t) => ({ ...t, ...(await at(t.tx, t.ty)) })),
    );
    expect(await page.evaluate(isoTileOcclusion, { tiles: planned, aim })).toEqual([]);
    test.info().annotations.push({
      type: "click-points",
      description: planned.map((p) =>
        `(${p.tx},${p.ty})→aim(${p.aim.x}, ${p.aim.y})`).join(" "),
    });

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
    expect(h0.free).toBe(12);                       // FREE_SETUP_TRACK (E8)
    expect(h0.vp).toEqual({ you: 0, ai: 0 });
    expect(h0.stone).toBe(12);
    expect(h0.ore).toBe(0);

    // ── build phase: drag a road from the Factory to the harvester ───────
    // real pointer stream: move → down on the factory → step tile by tile
    // along the picked column → up on the harvester. The path is the
    // corridor itself, so the drag length is whatever the geometry yielded —
    // no tile count is baked into this test any more (E14/A4).
    const path = [...c.col].reverse();              // factory → harvester
    await page.mouse.move(factory.x, factory.y);
    await page.mouse.down();
    for (const t of path.slice(1)) {
      const p = t.tx === c.hx && t.ty === c.hy ? harvester : await at(t.tx, t.ty);
      await page.mouse.move(p.x, p.y);
    }
    await page.mouse.up();
    await page.waitForFunction(
      ({ free, used }) => (window as any).__iso.freeTrack === free - used,
      { free: h0.free, used: n },
      { timeout: 5000 },
    );

    const after = await page.evaluate(() => {
      const h = (window as any).__iso;
      const t = h.track;
      let road = 0;
      for (let i = 0; i < t.road.length; i++) if (t.road[i] & 16) road++;
      return { free: h.freeTrack, vp: h.vp, stone: h.purse.stone, ore: h.purse.ore ?? 0, road };
    });
    expect(after.free).toBe(h0.free - n);            // the allowance paid for exactly the column
    expect(after.vp.you).toBe(1);                    // connection scored
    expect(after.vp.ai).toBe(0);
    expect(after.stone).toBe(12);                    // allowance, not purse
    expect(after.ore).toBe(0);
    expect(after.road).toBe(n);

    // the structures canvas really painted the road column
    await expect.poll(
      () => opaqueNear(page, 1, c.col[1].tx, c.col[1].ty),
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
