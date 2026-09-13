import { test, expect } from "@playwright/test";
import { BOARD_H, BOARD_W, MAP_W, MAP_H } from "../../src/game/config";
import {
  findIsoCorridor, isoTileOcclusion, isoClickableTile, classifyDragTiles,
  type Corridor,
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

/** The default route: iso is the standalone default (E12); seed pins the map.
 *  PP-13: seed 79 — its boot frame holds a town-ring corridor at both zooms.
 *  PP-12 swept to 74 when the bigger art re-flowed the map; PP-13 re-swept to
 *  79 because the towns tripled in size and grew inter-town highways, which
 *  moves every settlement (seed 74's boot industry no longer has a town ring
 *  inside the 12-tile corridor reach). Swept over seeds 0–400 at both boot
 *  zooms with this very search: 16 seeds qualify, 79 is the first that reads
 *  as well as 74 did. See the E14 swept pairs in
 *  tests/unit/iso-corridor-picker.test.ts. */
const ISO_URL = "/hexmatch/?seed=79";

async function bootIso(page: import("@playwright/test").Page) {
  // AI-02: the start-of-game difficulty prompt overlays the UI when nothing
  // chose yet — these specs play a game, they do not exercise onboarding
  // (the picker is unit-tested in iso-skill-picker.test.ts), so boot with a
  // choice already remembered.
  // TUT-01: the starting tour is the other boot overlay, and it covers the
  // whole screen until it is walked or dismissed (it is exercised for real in
  // tests/e2e/iso-tutorial.spec.ts). Remember its dismissal the same way, so
  // these specs click on the map and not on a card.
  await page.addInitScript(() => {
    localStorage.setItem("hexmatch:rival-skill", "normal");
    localStorage.setItem("hexmatch:tutorial", "never");
  });
  await page.goto(ISO_URL);
  await page.waitForFunction(() => {
    const h = (window as any).__iso;
    // LOAD-01: the loading screen covers the map until the art settles —
    // clicking before it lifts would land on the overlay, not a tile.
    return !!h && h.phase === "setup-factory" && !!h.grid && h.grid.industries.length > 0 && !h.loading;
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
  // PP-02: the corridor must end at a town-ring factory, and towns sit ≥8
  // tiles from industries (T4's TOWN_INDUSTRY_SEP) — so the picker's own
  // defaults (4..12, the setup free-track allowance) are the ones that work.
  return page.evaluate(findIsoCorridor, opts);
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

/** Count opaque pixels in a square around a tile's diamond centre on a given canvas. */
async function opaqueNear(
  page: import("@playwright/test").Page, canvasIndex: number,
  tx: number, ty: number, half = 6,
) {
  return page.evaluate(({ canvasIndex, tx, ty, half }) => {
    const h = (window as any).__iso;
    // Sample the DRAWN diamond centre. drawOrigin anchors at
    // tileToScreen + (HW, TILE_H), so its centre is one HW to the right of
    // the projection origin. Sampling x0 alone samples the left edge (and
    // often the neighbouring empty tile), not the visible road.
    const [x0, y0] = h.tileScreenAt(tx, ty);
    const [, y1] = h.tileScreenAt(tx + 1, ty + 1);
    const [ax] = h.tileScreenAt(0, 0), [bx] = h.tileScreenAt(1, 0);
    const cx = Math.floor(x0 + Math.abs(bx - ax)), cy = Math.floor((y0 + y1) / 2);
    const c = document.querySelectorAll("canvas")[canvasIndex] as HTMLCanvasElement;
    const ctx = c.getContext("2d")!;
    const d = ctx.getImageData(cx - half, cy - half, half * 2 + 1, half * 2 + 1).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  }, { canvasIndex, tx, ty, half });
}

/**
 * Count pixels in the same window whose ALPHA is high enough to be a strong
 * placement mark. The overlay is now the vector placement pass
 * (`src/iso/overlay-art.ts`), whose marks are strokes and faint fills, not the
 * baked glow cells: the footprint floor's gradient only ever reaches α ≈ 77
 * (×0.93 breathing) on a COVERED tile, the reach tint is α ≈ 26, node tags and
 * the site outline are thin perimeter strokes, and the ghost building's tint is
 * composited onto the sprite's own alpha — never a flat strong fill on a
 * neighbour. The high-alpha pixels sit on the site's PERIMETER; at a tile's
 * centre the fill is faint, and one tile past the site the canvas is clear.
 * So a zero count here is exactly "no strong/placement mark on this tile" at
 * any zoom. (See docs/placement-overlay.md.)
 */
async function strongGlowNear(
  page: import("@playwright/test").Page, canvasIndex: number,
  tx: number, ty: number, half = 6, alpha = 130,
) {
  return page.evaluate(({ canvasIndex, tx, ty, half, alpha }) => {
    const h = (window as any).__iso;
    const [x0, y0] = h.tileScreenAt(tx, ty);
    const [, y1] = h.tileScreenAt(tx + 1, ty + 1);
    const [ax] = h.tileScreenAt(0, 0), [bx] = h.tileScreenAt(1, 0);
    const cx = Math.floor(x0 + Math.abs(bx - ax)), cy = Math.floor((y0 + y1) / 2);
    const c = document.querySelectorAll("canvas")[canvasIndex] as HTMLCanvasElement;
    const ctx = c.getContext("2d")!;
    const d = ctx.getImageData(cx - half, cy - half, half * 2 + 1, half * 2 + 1).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > alpha) n++;
    return n;
  }, { canvasIndex, tx, ty, half, alpha });
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
    // The pointer ("Select") leads, then PP-06's "plant" tool, so the build
    // chrome is six buttons: Select, Dirt Road, Road, harvester, plant, demolish.
    await expect(root.locator("[data-tool]")).toHaveCount(6);
    await expect(root.locator("[data-act=recenter]")).toHaveCount(1);
    const scene = await page.evaluate(() => {
      const h = (window as unknown as { __iso: {
        grid: { w: number; h: number; industries: { tx: number; ty: number }[]; towns: unknown[] };
        camera: { vw: number; vh: number };
        tileScreenAt: (x: number, y: number) => [number, number];
      } }).__iso;
      const focus = h.grid.industries[0];
      return {
        size: [h.grid.w, h.grid.h], counts: [h.grid.industries.length, h.grid.towns.length],
        focus: h.tileScreenAt(focus.tx, focus.ty), centre: [h.camera.vw / 2, h.camera.vh / 2],
      };
    });
    expect(scene.size).toEqual([MAP_W, MAP_H]);
    expect(scene.counts).toEqual([25, 4]);
    // The first CSS→device-pixel resize must not push the focus off centre
    // on DPR 2/3 phones, even with the expanded map's distant coordinates.
    expect(scene.focus).toEqual(scene.centre);
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
    // PP-08 moved the Black Market pane into the RIGHT aside, nested beneath the
    // bank, and these three lines were never retuned — they have been red on
    // `main` (and in the nightly e2e) ever since, which is why they ride along
    // with this branch instead of poisoning its signal. Measured against the
    // same markup through the jsdom harness (`iso-game.test.ts` boots the real
    // `ui.ts`): `aside.left` = ["🏗️ Build"], `aside.right` = ["🕵️ Black Market",
    // "💎 Your Processing Plant"]. Structure, not CSS — Playwright counts hidden
    // nodes too, so the viewport's media queries cannot move these numbers.
    await expect(root.locator(".ui-root aside.left .panel-title")).toHaveCount(1);
    await expect(root.locator(".ui-root aside.left .panel-title").first()).toContainText(/Build/i);
    await expect(root.locator(".ui-root aside.right .panel-title")).toHaveCount(2);
    await expect(root.locator(".ui-root aside.right .panel-title").first()).toContainText(/Black Market/i);
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

    // tool chrome with all six tools: the pointer ("select") leads, then
    // PP-06's plant between harvester and demolish + recentre
    const tools = await root.locator("[data-tool]").evaluateAll((bs) =>
      bs.map((b) => (b as HTMLElement).dataset.tool));
    expect(tools).toEqual(["select", "dirt", "road", "harvester", "plant", "demolish"]);
    await expect(root.locator("[data-act=recenter]")).toHaveCount(1);

    // J1: the match-3 quarry is mounted NEXT TO the map, not instead of it,
    // and its cells are real, pickable DOM.
    await expect(root.locator("#iso-quarry")).toBeVisible();
    await expect(root.locator("#iso-quarry .gem")).toHaveCount(BOARD_W * BOARD_H);
    await expect(root.locator('[data-tab="plant"]')).toHaveCount(1);
    await expect(root.locator('[data-tab="market"]')).toHaveCount(1);
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
    expect(stats.seed).toBe(79);

    await test.info().attach("iso-boot-layout", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });

  // VP-01 rewrote the end of this round. The drag still lays the column and the
  // cargo still flows, but a Dirt Road connection is worth NOTHING now — the
  // assertion flipped from "+1 VP" to "0 VP", which is the ticket in one number.
  // The points live on the PAVE, and a paved drag needs 4 Ore a tile the opening
  // purse does not have, so the paving half of the round is asserted in
  // `tests/unit/iso-victory.test.ts` and `iso-game.test.ts` (drag preview, mode
  // bar, rival pave pass) rather than faked into this one with a purse handout.
  test("gameplay: factory → harvester → Dirt Road drag → cargo flows, 0 VP", async ({ page }) => {
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
    // PP-12 + PP-03: the factory occupies a 3×3 (the TTD art's footprint) and
    // both corners get the SOLID placement glow. The tile past the far corner
    // never gets a solid glow; PP-03's fainter reach band may legitimately
    // reach that tile's sample window at low zoom, so the anti-outer guard
    // probes the strong layer only.
    await page.mouse.move(factory.x, factory.y);
    await expect.poll(() => opaqueNear(page, 2, c.fx, c.fy), { timeout: 5000 }).toBeGreaterThan(10);
    await expect.poll(() => opaqueNear(page, 2, c.fx + 2, c.fy + 2), { timeout: 5000 }).toBeGreaterThan(10);
    await expect.poll(() => strongGlowNear(page, 2, c.fx + 3, c.fy + 3), { timeout: 5000 }).toBe(0);
    await page.mouse.click(factory.x, factory.y);
    await page.waitForFunction(() => (window as any).__iso.phase === "setup-harvester");
    // The Factory now covers part of the corridor, and a covered tile is not
    // clickable — our own building, not a picking bug. Ask the game's own pick
    // which tiles those are: the atlas's stage-2 alpha decides it, and seed 79
    // showed a footprint-shaped window is wrong (the sprite reaches one tile
    // past the 3×3). Then require the Factory to be the ONLY reason any
    // corridor tile is skipped, so a tile eaten by a map sprite or by HUD
    // chrome still fails here instead of being quietly stepped over.
    const { drag: dragTiles, refused } = await classifyDragTiles(c, async (tx, ty) => {
      try {
        await clickPointFor(page, tx, ty, aim);
        return null;
      } catch (err) {
        return String(err instanceof Error ? err.message : err);
      }
    });
    for (const r of refused) {
      expect(
        r.why,
        `corridor tile (${r.tile.tx},${r.tile.ty}) is unclickable for a reason `
        + `that is not the Factory we just placed`,
      ).toMatch(/via `factory`/);
    }
    expect(dragTiles.length, "the drag has no exposed tile left to lay")
      .toBeGreaterThan(0);
    const dragEnd = dragTiles[dragTiles.length - 1];
    expect([dragEnd.tx, dragEnd.ty], "the drag no longer ends on the harvester")
      .toEqual([c.hx, c.hy]);
    test.info().annotations.push({
      type: "drag-stepped-over",
      description: refused.length
        ? refused.map((r) => `(${r.tile.tx},${r.tile.ty})`).join(" ")
        : "none",
    });
    expect((await page.evaluate(() => (window as any).__iso.factories.length))).toBeGreaterThanOrEqual(1);
    // U2: the guide banner must re-word to the Depot once the Factory is
    // placed (the banner is the user-facing cue; the footprint itself is
    // asserted in the pixel sample above).
    await expect(page.locator("#iso-banner")).toContainText(/place your depot/i);

    // ── setup round 2 of 2: click the harvester spot beside the industry ─
    // U2: the harvester is a 1×1 building, so its placement glow is the solid
    // tile highlight (the 4×4 catchment around it is the fainter soft tint).
    await page.mouse.move(harvester.x, harvester.y);
    await expect.poll(() => opaqueNear(page, 2, c.hx, c.hy), { timeout: 5000 }).toBeGreaterThan(10);
    await page.mouse.click(harvester.x, harvester.y);
    await page.waitForFunction(() => (window as any).__iso.phase === "play");
    await page.waitForFunction(() => (window as any).__iso.harvesters.length >= 1);
    const h0 = await page.evaluate(() => {
      const h = (window as any).__iso;
      let dirt = 0;
      for (let i = 0; i < h.track.dirt.length; i++) if (h.track.dirt[i] & 16) dirt++;
      return {
        free: h.freeTrack,
        vp: h.vp,
        stone: h.purse.stone,
        ore: h.purse.ore ?? 0,
        // PP-10: the towns' seed-generated ring roads stand at boot (they are
        // paved `road` tiles), while no player Dirt Road exists yet, so the
        // drag's footprint is measured against this (zero) dirt baseline.
        dirt,
        // VP-01: the victory table, read off the booted game rather than the
        // config module, so a stale UI constant cannot pass this test.
        vpTarget: h.vpTarget,
        vpRates: h.vpRates,
      };
    });
    expect(h0.free).toBe(12);                       // FREE_SETUP_TRACK (E8)
    expect(h0.vp).toEqual({ you: 0, ai: 0 });
    expect(h0.stone).toBe(12);
    expect(h0.ore).toBe(0);
    // PP-10: the four towns' seed-generated ring roads are already standing.
    expect(h0.dirt).toBe(0);   // no player Dirt Road yet — allowance untouched

    // PP-15: "how many tiles does this corridor cost" is no longer "how many
    // tiles are in the column". The drag's L-path runs over the ground the
    // player's OWN buildings stand on — the Factory's 3×3 block and the Depot
    // it ends on — and those tiles are stepped over: not built, not charged,
    // and not spent from the free allowance (nobody paves their own factory's
    // floor). Ask the game's own preview for the number instead of counting the
    // column here, so the spec can never bake in a footprint or a tile count.
    const laid = await page.evaluate(({ fx, fy, hx, hy }) => {
      const pv = (window as any).__iso.dragPreview("dirt", fx, fy, hx, hy);
      if (!pv) throw new Error(`dragPreview refused the corridor (${fx},${fy})→(${hx},${hy})`);
      return pv.tiles.length as number;
    }, c);
    expect(laid, "the corridor lays nothing at all once its own buildings are free")
      .toBeGreaterThan(0);
    expect(laid, "the preview built more tiles than the column contains").toBeLessThanOrEqual(n);

    // ── build phase: drag the free Dirt Road corridor from Factory to harvester ─
    // real pointer stream: move → down on the factory → step tile by tile
    // along the picked column → up on the harvester. The path is the
    // corridor itself, so the drag length is whatever the geometry yielded —
    // no tile count is baked into this test any more (E14/A4).
    const dragStart = await at(c.fx, c.fy);
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    // The pointer only visits the tiles the pick says are clickable; the road
    // still lands on all `n` of them because `previewDrag` fills the L-path in
    // between (asserted below).
    for (const t of dragTiles) {
      const p = t.tx === c.hx && t.ty === c.hy ? harvester : await at(t.tx, t.ty);
      await page.mouse.move(p.x, p.y);
    }
    await page.mouse.up();
    await page.waitForFunction(
      ({ free, used }) => (window as any).__iso.freeTrack === free - used,
      { free: h0.free, used: laid },
      { timeout: 5000 },
    );

    const after = await page.evaluate(() => {
      const h = (window as any).__iso;
      const t = h.track;
      let dirt = 0;
      for (let i = 0; i < t.dirt.length; i++) if (t.dirt[i] & 16) dirt++;
      return {
        free: h.freeTrack, vp: h.vp, stone: h.purse.stone, ore: h.purse.ore ?? 0, dirt,
        vpTarget: h.vpTarget, vpRates: h.vpRates, paved: h.pavedTiles("you"),
      };
    });
    // the allowance paid for exactly the tiles the drag laid — the column minus
    // the ground under the player's own buildings (PP-15).
    expect(after.free).toBe(h0.free - laid);
    expect(after.vp.you).toBe(0);                    // VP-01: a gravel connection scores nothing
    expect(after.vp.ai).toBe(0);
    // …and the hook that replaces the old scoreboard census reports the new
    // table straight off the real boot: 10★ to win, a quarter per upgraded tile.
    expect(h0.vpTarget).toBe(10);
    expect(h0.vpRates).toEqual({ upgrade: 0.25, plant: 1 });
    expect(after.stone).toBe(12);                    // allowance, not purse
    expect(after.ore).toBe(0);
    // the free opening corridor is DIRT (the allowance buys Dirt Roads only),
    // so the drag lays exactly `n` new Dirt Road tiles from a zero baseline.
    expect(after.dirt).toBe(h0.dirt + laid);         // h0.dirt === 0

    // …and the tiles it did NOT lay are exactly its own Factory's floor. Read
    // the footprint off the game's placement plan — never re-derived here —
    // because "the road had to be built into some weird spot inside" is what
    // this whole change is about: the inside of the graphic is nobody's road.
    const under = await page.evaluate(({ fx, fy }) => {
      const plan = (window as any).__iso.placementPlan("factory", fx, fy);
      const t = (window as any).__iso.track;
      const W = (window as any).__iso.grid.w;
      return plan.footprint.filter((f: { tx: number; ty: number }) =>
        (t.dirt[f.ty * W + f.tx] & 16) !== 0);
    }, c);
    expect(under, "dirt was laid under the player's own Factory").toEqual([]);

    // Track state changes synchronously; the canvas paints on the next RAF.
    await page.evaluate(() => new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    // the structures canvas really painted the dirt column
    // The two frames above guarantee the draw. A software-GPU readback can
    // itself exceed expect.poll's 5s deadline, so assert the actual result
    // rather than timing out an otherwise-correct pixel read.
    expect(await opaqueNear(page, 1, c.col[1].tx, c.col[1].ty)).toBeGreaterThan(10);

    // …nothing on the map was upgraded, so nothing was scored, and the badge
    // says the same thing the state does
    expect(after.paved).toBe(0);
    await expect(page.locator("#iso-vp")).toContainText("You 0");
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
    // PP-02: the Factory must touch a town by an edge, and towns sit ≥8 tiles
    // from the industries the boot camera frames (T4's TOWN_INDUSTRY_SEP) — so
    // the zoom-1 boot frame holds no town-ring Factory site at all (the 
    // gameplay test hits the same wall and searches at 0.5x). One real wheel
    // gesture puts a town's ring in the clear band; no camera API is poked.
    await zoomStep(page, "out");
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
      // PP-02/PP-12: factory legality is the game's own placement verdict —
      // the whole art-sized footprint on legal ground plus the town-edge
      // rule — exactly what the final click below will be judged by.
      // Centre-most matters: the middle-drag below pans the camera before
      // the final click, and a tile near the centre survives a ±60 px nudge
      // without drifting under HUD chrome.
      const centreX = window.innerWidth / 2, centreY = window.innerHeight / 2;
      let best: { tx: number; ty: number; d: number } | null = null;
      for (let ty = 0; ty < H; ty++) {
        for (let tx = 0; tx < W; tx++) {
          if (!h.placementPlan("factory", tx, ty).valid) continue;
          if (!inView(tx, ty) || !clickable(tx, ty)) continue;
          const [dx, dy] = h.tileScreenAt(tx, ty);
          const d = Math.abs(dx / dpr - centreX) + Math.abs(dy / dpr - centreY);
          if (!best || d < best.d) best = { tx, ty, d };
        }
      }
      return best ? { tx: best.tx, ty: best.ty } : null;
    });
    expect(spot).not.toBeNull();
    // E14: the anchor goes through the same resolver the gameplay round clicks
    // with, so "a left click here places" is asserted against a point the
    // game's own pick hands back to this tile — not a re-derivation of it.
    const anchor = await clickPointFor(page, spot!.tx, spot!.ty);
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
    const midStart = await clickPointFor(page, spot!.tx, spot!.ty);
    await page.mouse.move(midStart.x, midStart.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(midStart.x - 60, midStart.y - 40, { steps: 8 });
    await page.mouse.up({ button: "middle" });
    const afterMiddleDrag = await screenAt(spot!.tx, spot!.ty);
    expect(afterMiddleDrag).not.toEqual(before);
    expect(await page.evaluate(() => (window as any).__iso.phase)).toBe("setup-factory");
    expect(await page.evaluate(() => (window as any).__iso.factories.length)).toBe(0);

    // ── a left CLICK (no drag) still places — the acceptance boundary ────
    const clickHere = await clickPointFor(page, spot!.tx, spot!.ty);
    await page.mouse.click(clickHere.x, clickHere.y);
    await page.waitForFunction(() => (window as any).__iso.phase === "setup-harvester");
    expect(await page.evaluate(() => (window as any).__iso.factories.length)).toBeGreaterThanOrEqual(1);
  });
});

test("consolidated economy tabs and disabled purchases", async ({ page }) => {
  await bootIso(page);
  if ((page.viewportSize()?.width ?? 1280) <= 760) {
    await page.locator('.mnav-btn[data-view="trade"]').click();
  }
  await expect(page.locator('[data-panel]')).toHaveCount(0);
  for (const tab of ["bank", "market", "plant", "feed"]) {
    await page.locator(`[data-tab="${tab}"]`).click();
    await expect(page.locator('#iso-trade > .pane:not(.hidden), #iso-trade > #iso-quarry:not(.hidden)')).toHaveCount(1);
    await expect(page.locator(`[data-tab="${tab}"]`)).toBeInViewport();
  }
  await page.locator('[data-tab="bank"]').click();
  await expect(page.locator('.bank-pane .sab-list')).toBeVisible();
  await page.evaluate(() => {
    const game = (window as unknown as { __iso: { purse: Record<string, number> } }).__iso;
    for (const key of Object.keys(game.purse)) game.purse[key] = 0;
  });
  await expect(page.locator('[data-tool="plant"]')).toBeDisabled();
  await expect(page.locator('[data-act="bank"]')).toBeDisabled();
  await expect(page.locator('[data-black="harden"]')).toBeDisabled();
});
