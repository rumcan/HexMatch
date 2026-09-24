import { test, expect, type Page } from "@playwright/test";
import { bootSoloIso, bootBudget } from "./boot";

// ══════════════════════════════════════════════════════════════════════════
// PERF-01 — the performance mode as a PLAYER sees it, in a real browser.
//
// The unit suite pins the renderer's cadence contract (a static terrain
// never repaints while idle); this spec proves the seams around it: the
// settings switch beside Miniature, the suppressed-but-preserved miniature
// preference, the DPR-capped backing, the persistence across reloads, the
// camera a toggle must not move, and a rapid ON→OFF→ON burst that the
// serialised apply chain must converge.
//
// The terrain canvas is READ DIRECTLY (it is a 2d canvas): a flat
// performance scene lives in a handful of distinct colours, while the
// textured meadow runs into the thousands — the single most visible
// consequence of the mode, measurable without a reference image.
// ══════════════════════════════════════════════════════════════════════════

const SEED = "1337";   // the seed the suite pins (iso-game.spec.ts)
const REMEMBERED = {
  "hexmatch:rival-skill": "normal",   // AI-02: no difficulty prompt
  "hexmatch:tutorial": "never",       // TUT-01: no starting tour
};

/** Renderer diagnostics + the layer geometry, in one hop. */
const terrainState = (page: Page) => page.evaluate(() => {
  const h = (window as unknown as { __iso: { rendering: () => {
    camera: { zoom: number; vw: number; vh: number; x: number; y: number };
    terrain: { performance: boolean; animated: boolean; redraws: number };
  } } }).__iso;
  const c = document.querySelector("canvas.iso-layer") as HTMLCanvasElement;
  const mini = document.querySelector("canvas.iso-mini") as HTMLCanvasElement | null;
  const d = h.rendering();
  // The world point under the viewport centre — `resizeCamera` promises a
  // DPR change keeps it put, so a toggle that moves it moved the camera.
  const cam = d.camera;
  return {
    terrain: d.terrain,
    backing: [c.width, c.height] as [number, number],
    css: [Math.round(c.clientWidth), Math.round(c.clientHeight)] as [number, number],
    dpr: window.devicePixelRatio,
    miniDisplay: mini ? getComputedStyle(mini).display : "absent",
    worldAtCentre: [(cam.vw / 2 - cam.x) / cam.zoom, (cam.vh / 2 - cam.y) / cam.zoom] as [number, number],
  };
});

/**
 * Distinct colours on the terrain canvas, sampled every 32nd pixel. Flat
 * performance terrain (a few solid fills, one grid stroke, a static shore)
 * stays in a small set; the textured meadow is thousands.
 */
const terrainColourCount = (page: Page) => page.evaluate(() => {
  const c = document.querySelector("canvas.iso-layer") as HTMLCanvasElement;
  const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  const seen = new Set<number>();
  for (let i = 0; i < data.length; i += 32 * 4) {
    seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  }
  return seen.size;
});

const bootIso = (page: Page, extra = "") => bootSoloIso(page, {
  url: `/?seed=${SEED}${extra}&iso-debug=1`,
  remembered: REMEMBERED,
});

/** The in-game ☰ → Settings sheet, open and on-screen. */
const openSettings = async (page: Page) => {
  await page.locator("#iso-menu-btn").click();
  await page.getByRole("menuitem", { name: /Settings/ }).click();
  await page.locator(".settings-sheet").waitFor();
};

const perfSwitch = (page: Page) => page.locator('[data-gfx="performance"]');
const miniSwitch = (page: Page) => page.locator('[data-gfx="miniature"]');

test.describe("PERF-01 performance mode", () => {
  test("boots the flat static scene, DPR-capped, miniature off", async ({ page }) => {
    await bootIso(page, "&performance=1&quality=low");
    const s = await terrainState(page);
    // the policy, not the art: quality=low stays the art axis
    expect(s.terrain).toMatchObject({ performance: true, animated: false });
    expect(s.miniDisplay).toBe("none");
    // the backing honours the policy's DPR cap
    const cap = Math.min(1, s.dpr);
    expect(s.backing[0]).toBe(Math.max(1, Math.round(s.css[0] * cap)));
    expect(s.backing[1]).toBe(Math.max(1, Math.round(s.css[1] * cap)));
    // and the map is FLAT, not textured
    expect(await terrainColourCount(page)).toBeLessThan(150);
    // and it HOLDS: 300 ms of idle passes several 30 Hz windows; the
    // textured terrain would have redrawn on each of them
    const first = s.terrain.redraws;
    await page.waitForTimeout(300);
    const second = (await terrainState(page)).terrain.redraws;
    expect(second).toBe(first);
  });

  test("a camera move invalidates the static terrain exactly once", async ({ page }) => {
    await bootIso(page, "&performance=1");
    const before = (await terrainState(page)).terrain.redraws;
    const box = await page.locator("canvas.iso-layer").first().boundingBox();
    expect(box).not.toBeNull();
    // middle-drag pans (TK-001: the left mouse button builds, it never pans)
    const cx = box!.x + box!.width / 2, cy = box!.y + box!.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(cx + 90, cy, { steps: 6 });
    await page.mouse.up({ button: "middle" });
    await page.waitForTimeout(100);
    const after = (await terrainState(page)).terrain;
    expect(after.redraws).toBe(before + 1);
    // …and then it is still again
    await page.waitForTimeout(300);
    expect((await terrainState(page)).terrain.redraws).toBe(after.redraws);
  });

  test("settings sheet: the switch sits beside Miniature and suppresses it", async ({ page }) => {
    await bootIso(page);
    await openSettings(page);

    // the row exists with the issue's exact copy
    await expect(page.locator(".settings-sheet .gfx-copy h3", { hasText: "Performance mode" })).toBeVisible();
    await expect(perfSwitch(page)).toHaveAttribute("role", "switch");
    await expect(perfSwitch(page)).toHaveAttribute("aria-checked", "false");
    await expect(miniSwitch(page)).toBeEnabled();
    await expect(miniSwitch(page)).toHaveAttribute("aria-checked", "false");

    // miniature ON, performance ON: the stored choice is PRESERVED, the
    // control is only suppressed — dimmed, unfocusable, and saying why.
    await miniSwitch(page).click();
    await expect(miniSwitch(page)).toHaveAttribute("aria-checked", "true");
    await perfSwitch(page).click();
    await expect(perfSwitch(page)).toHaveAttribute("aria-checked", "true");
    await expect(miniSwitch(page)).toBeDisabled();
    await expect(miniSwitch(page)).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".settings-sheet .gfx-mini-note"))
      .toHaveText("Unavailable while Performance mode is on.");

    // the store agrees — miniature is still ON inside it
    await expect.poll(() => page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("hexmatch:graphics") ?? "{}");
      return s.miniature === true && s.performance === true;
    })).toBe(true);

    // the terrain went flat under the sheet (the first flat frame lands on
    // the next rAF after the switch — poll it, don't race it)
    await expect.poll(async () => (await terrainState(page)).terrain.performance).toBe(true);
    await expect.poll(() => terrainColourCount(page)).toBeLessThan(150);

    // performance OFF restores the miniature exactly as it was stored
    await perfSwitch(page).click();
    await expect(perfSwitch(page)).toHaveAttribute("aria-checked", "false");
    await expect(miniSwitch(page)).toBeEnabled();
    await expect(miniSwitch(page)).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".settings-sheet .gfx-mini-note"))
      .not.toHaveText("Unavailable while Performance mode is on.");
    await expect.poll(async () => (await terrainState(page)).terrain.performance).toBe(false);

    // back to performance ON for the camera check: the world point under the
    // viewport centre must not move (the DPR re-size re-anchors it)
    const before = (await terrainState(page)).worldAtCentre;
    await perfSwitch(page).click();
    await expect.poll(async () => (await terrainState(page)).terrain.performance).toBe(true);
    const after = (await terrainState(page)).worldAtCentre;
    expect(Math.abs(before[0] - after[0])).toBeLessThan(1e-6);
    expect(Math.abs(before[1] - after[1])).toBeLessThan(1e-6);

    await page.locator(".settings-sheet [data-gfx-close].big-btn").click();
    await page.locator(".settings-sheet").waitFor({ state: "detached" });
  });

  test("persists across reloads — the stored choice outlives the URL flag", async ({ page }) => {
    await bootIso(page, "&performance=1");
    expect((await terrainState(page)).terrain.performance).toBe(true);
    // same seed, NO performance flag: the choice must come from storage
    await page.goto(`/?seed=${SEED}&iso-debug=1`);
    await page.locator(".menu-btn.primary").click();
    await page.getByRole("button", { name: /^Play vs AI(?! — Conquest)/ }).click();
    await page.waitForFunction(() => {
      const h = (window as unknown as {
        __iso?: { phase: string; loading: boolean; grid?: { industries: unknown[] } };
      }).__iso;
      return !!h && h.phase === "setup-factory" && !!h.grid
        && h.grid.industries.length > 0 && !h.loading;
    }, null, { timeout: bootBudget() });
    expect((await terrainState(page)).terrain.performance).toBe(true);
  });

  test("rapid ON→OFF→ON bursts converge on the final policy", async ({ page }) => {
    await bootIso(page);
    await page.evaluate(() => {
      const h = (window as unknown as { __iso: { graphics: (q?: string, m?: boolean, p?: boolean) => unknown } }).__iso;
      h.graphics(undefined, undefined, true);
      h.graphics(undefined, undefined, false);
      h.graphics(undefined, undefined, true);
    });
    // the serialised apply chain settles on the LAST toggle
    await expect.poll(async () => (await terrainState(page)).terrain.performance).toBe(true);
    const s = await terrainState(page);
    expect(s.terrain.performance).toBe(true);
    expect(s.miniDisplay).toBe("none");
    expect(s.backing[0]).toBe(Math.max(1, Math.round(s.css[0] * Math.min(1, s.dpr))));
    // the terrain is the flat one — no stale textured surface survived the burst
    await expect.poll(() => terrainColourCount(page)).toBeLessThan(150);
    // …and idle still holds
    const first = s.terrain.redraws;
    await page.waitForTimeout(300);
    expect((await terrainState(page)).terrain.redraws).toBe(first);
  });
});
