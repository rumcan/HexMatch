import { test, expect } from "@playwright/test";
import { bootGame, hex, completeSetup } from "./helpers";

test.describe("boot + guided setup", () => {
  test("boots the 3D game and exposes the test hook", async ({ page }) => {
    await bootGame(page);
    expect(await hex(page).mode()).toBe("capital");
    expect(await hex(page).legalVerts()).toBeGreaterThan(0);
    expect(await hex(page).setupPhase()).toBe(true);
  });

  // Ticket #1: setup markers must NOT vanish ~1s after arming even with 0
  // resources. We advance real fake time by waiting 3.5s and re-checking.
  test("setup rail highlights stay lit indefinitely with 0 resources (ticket #1)", async ({ page }) => {
    await bootGame(page);
    // place the capital, arming the first rail
    const { pos } = await hex(page).firstLegalVertex();
    await page.mouse.click(pos[0], pos[1]);
    await page.waitForFunction(() => (window as any).__hex.view.mode === "road");
    expect(await hex(page).legalEdges()).toBeGreaterThan(0);
    // wait well past the 1s housekeeping tick that used to clear the mode
    await page.waitForTimeout(3500);
    expect(await hex(page).mode()).toBe("road");
    expect(await hex(page).legalEdges()).toBeGreaterThan(0);
  });

  test("places HQ and both setup rails; setup ends (smoke)", async ({ page }) => {
    await bootGame(page);
    await completeSetup(page);
    expect(await hex(page).setupPhase()).toBe(false);
    expect(await hex(page).mode()).toBeNull();
  });
});
