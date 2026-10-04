import { test, expect } from "@playwright/test";
import { bootSoloIso } from "./boot";

// ══════════════════════════════════════════════════════════════════════════
// ROT-UI-1 — the rotate keys under the minimap plate, in the real browser.
//
// The unit tests pin the rules (tests/unit/rot-ui-1.test.ts); this spec pins
// the WIRING the unit tests cannot reach: that `?three=1` unlocks the keys
// (three-layer.ts's `rotationAvailable()` through game.ts), that a click turns
// the SAME view the `[` / `]` keys turn, that the tip fires once, and that the
// keys sit under the plate's canvas — never over it — at the desktop size the
// owner plays at. It never runs in the agent sandbox (no browsers there): the
// lead runs it with the rest of the e2e shards.
// ══════════════════════════════════════════════════════════════════════════

const ROT_URL = "/?three=1&seed=1337";
const HINT_KEY = "hexmatch:rotate-hint";

/** The live view yaw in degrees (the game's own probe). */
const yawDeg = (page: import("@playwright/test").Page) =>
  page.evaluate(() => ((window as any).__iso.viewYaw() * 180) / Math.PI);

test.describe("ROT-UI-1 — rotate keys under the minimap", () => {
  test("?three=1 unlocks two keys under the plate; a click turns the view and tips the keyboard once", async ({ page }) => {
    // The keys are a live-3D control: the spec needs the 3D layer up (swiftshader
    // WebGL) and the desktop plate open, so it runs on desktop-chromium only.
    test.skip(test.info().project.name !== "desktop-chromium", "the 3D layer and the open plate are desktop-chromium");
    // The tip is once PER PROFILE: forget it so this run sees the first turn.
    await page.addInitScript((key) => localStorage.removeItem(key), HINT_KEY);
    await bootSoloIso(page, {
      url: ROT_URL,
      remembered: { "hexmatch:rival-skill": "normal", "hexmatch:tutorial": "never" },
    });

    const row = page.locator(".minimap-rotate");
    // live-3D mounts after the map (models stream in): the keys appear with it.
    await expect(row).toBeVisible({ timeout: 90_000 });
    const keys = row.locator("button");
    await expect(keys).toHaveCount(2);
    await expect(keys.nth(0)).toHaveAttribute("aria-label", "Rotate view left ([)");
    await expect(keys.nth(1)).toHaveAttribute("aria-label", "Rotate view right (])");

    // Directly UNDER the plate's canvas, and inside the plate (no overlap).
    const canvas = page.locator(".minimap-dock .minimap-canvas");
    await expect(canvas).toBeVisible();
    const cbox = (await canvas.boundingBox())!;
    const rbox = (await row.boundingBox())!;
    const dock = (await page.locator(".minimap-dock").boundingBox())!;
    expect(rbox.y).toBeGreaterThanOrEqual(cbox.y + cbox.height - 1);
    expect(rbox.y + rbox.height).toBeLessThanOrEqual(dock.y + dock.height + 1);
    expect(rbox.x).toBeGreaterThanOrEqual(dock.x - 1);
    expect(rbox.x + rbox.width).toBeLessThanOrEqual(dock.x + dock.width + 1);

    // Settled at yaw 0, then one click = one quarter turn (the ease polled down).
    await expect.poll(() => yawDeg(page), { timeout: 15_000 }).toBeCloseTo(0, 1);
    await keys.nth(1).click();
    // … and the first button-turn names the keys, in the notification lane.
    await expect(page.locator(".toast .toast-msg", { hasText: "Tip: [ and ] rotate too" })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => yawDeg(page), { timeout: 15_000 }).toBeCloseTo(90, 0);
    // The same door the keys open: `]` from the keyboard lands on the same yaw.
    await page.keyboard.press("]");
    await expect.poll(() => yawDeg(page), { timeout: 15_000 }).toBeCloseTo(180, 0);
    // Back to 0 in two steps, and the second turn is quiet (the tip is spent).
    await keys.nth(0).click();
    await expect.poll(() => yawDeg(page), { timeout: 15_000 }).toBeCloseTo(90, 0);
    await keys.nth(0).click();
    await expect.poll(() => yawDeg(page), { timeout: 15_000 }).toBeCloseTo(0, 0);

    // The plate turned too: clicking it still centres a tile at a turned yaw
    // (`__iso.camera` is the live camera the click writes).
    await keys.nth(1).click();
    await expect.poll(() => yawDeg(page), { timeout: 15_000 }).toBeCloseTo(90, 0);
    const before = await page.evaluate(() => ({ ...(window as any).__iso.camera }));
    await canvas.click({ position: { x: 30, y: 30 } });
    await expect
      .poll(() => page.evaluate(() => ({ ...(window as any).__iso.camera })), { timeout: 15_000 })
      .not.toEqual(before);
  });
});
