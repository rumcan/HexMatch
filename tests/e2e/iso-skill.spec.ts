import { test, expect } from "@playwright/test";

// ══════════════════════════════════════════════════════════════════════════
// AI-01 — the difficulty selector, against the REAL built game (vite preview).
// Small facts around the boot: the control is on the top bar, `?rival=` wins,
// the choice persists to localStorage, and switching it reaches the live
// rival's clock WITHOUT a restart (read back through the __iso debug hook —
// the same hook the gameplay e2e already drives). The seats are still in the
// setup phase here; that the rival actually PLAYS at each difficulty is the
// AI-vs-AI race suite's claim (tests/unit/iso-skill-calibration.test.ts).
// ══════════════════════════════════════════════════════════════════════════

const BASE = "/hexmatch/";

async function bootIso(page: import("@playwright/test").Page, extra = "") {
  // TUT-01: the starting tour is a full-screen boot overlay, and this spec
  // drives the top-bar selector with real clicks. Remember the tour's
  // dismissal so it stays out of the way — the rival-skill key is deliberately
  // NOT set here, because what this spec measures is the URL and the picker
  // writing it.
  await page.addInitScript(
    () => localStorage.setItem("hexmatch:tutorial", "never"),
  );
  await page.goto(`${BASE}?seed=79${extra}`);
  await page.waitForFunction(() => {
    const h = (window as any).__iso;
    return !!h && h.phase === "setup-factory" && !!h.grid && h.grid.industries.length > 0;
  }, null, { timeout: 20000 });
}

test("AI-01 picker: url wins, choice persists, switching is live", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await bootIso(page, "&rival=hard");
  const sel = page.locator("#iso-rival-skill");
  await expect(sel).toBeVisible();
  await expect(sel).toHaveValue("hard");
  expect(await page.evaluate(() => localStorage.getItem("hexmatch:rival-skill"))).toBe("hard");
  expect(await page.evaluate(() => (window as any).__iso.rivalSkill.key)).toBe("hard");
  // AI-04: hard races the shipped line, and the HUD badge says so.
  expect(await page.evaluate(() => (window as any).__iso.vpTarget)).toBe(10);
  await expect(page.locator("#iso-vp")).toContainText("/10");

  // switching persists and reaches the live rival without a reload
  await sel.selectOption("easy");
  expect(await page.evaluate(() => localStorage.getItem("hexmatch:rival-skill"))).toBe("easy");
  expect(await page.evaluate(() => (window as any).__iso.rivalSkill.key)).toBe("easy");
  // AI-04: the difficulty owns the finish line — the easy chair is a 5★ race,
  // and both the debug hook and the badge the player reads move with the pick.
  expect(await page.evaluate(() => (window as any).__iso.vpTarget)).toBe(5);
  await expect(page.locator("#iso-vp")).toContainText("/5");

  // re-boot with no param: the stored choice wins over the default
  await bootIso(page);
  await expect(page.locator("#iso-rival-skill")).toHaveValue("easy");
  expect(await page.evaluate(() => (window as any).__iso.rivalSkill.key)).toBe("easy");

  expect(errors).toEqual([]);
});
