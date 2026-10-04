import { test, expect } from "@playwright/test";
import { bootSoloIso } from "./boot";

// LIVE3D-ON (#698): the default boot (no ?three=) mounts the live 3D layer. The shared storage state pins
// the stored setting off for every other spec, so this one clears it before boot and keeps the URL bare.
test("a bare boot mounts the 3D layer and draws a first frame", async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem("hexmatch.three3d"); });
  await bootSoloIso(page, { url: "/?seed=1337", defaultThree: true });
  await expect.poll(() => page.evaluate(() => (window as any).__iso.threeStats() !== null)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__iso.threeStats()?.drawCalls ?? 0), { timeout: 20000 }).toBeGreaterThan(0);
});
