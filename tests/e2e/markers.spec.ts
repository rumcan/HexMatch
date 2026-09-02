import { test, expect } from "@playwright/test";
import { bootGame, hex } from "./helpers";

// Ticket #2: markers must be readable on every terrain and never z-fight.
// We arm the rail markers (edges across all tile types) and screenshot from
// three camera angles: default, shallow pitch (hardest case), and top-down.
test.describe("legal-move markers visibility", () => {
  test.beforeEach(async ({ page }) => {
    await bootGame(page);
    // arm rail markers: place capital then we're on step 1 (road mode)
    const { pos } = await hex(page).firstLegalVertex();
    await page.mouse.click(pos[0], pos[1]);
    await page.waitForFunction(() => (window as any).__hex.view.legalEdges.size > 0);
  });

  test("markers visible at the default angle", async ({ page }) => {
    await page.waitForTimeout(600); // let a pulse + damping settle
    await expect(page).toHaveScreenshot("markers-default.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  test("markers visible at the shallowest pitch (0.22)", async ({ page }) => {
    await page.evaluate(() => {
      const v = (window as any).__hex.view;
      v.tPitch = 0.22; v.pitch = 0.22;
    });
    await page.waitForTimeout(800);
    await expect(page).toHaveScreenshot("markers-shallow.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  test("markers visible at a steep top-down-ish angle", async ({ page }) => {
    await page.evaluate(() => {
      const v = (window as any).__hex.view;
      v.tPitch = 1.35; v.pitch = 1.35; v.tYaw = 0.6; v.yaw = 0.6;
    });
    await page.waitForTimeout(800);
    await expect(page).toHaveScreenshot("markers-steep.png", {
      maxDiffPixelRatio: 0.02,
    });
  });
});
