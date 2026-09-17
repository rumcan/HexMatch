import { test, expect } from "@playwright/test";
import { bootSoloIso } from "./boot";

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

/** Boot a solo game past the menu via the shared `bootSoloIso` (issue #135);
 *  `extra` appends the spec's own query (e.g. `&rival=hard`). The spec-specific
 *  half is what is remembered — and what deliberately is NOT: TUT-01's tour is
 *  a full-screen boot overlay and this spec drives the top-bar selector with
 *  real clicks, so its dismissal is remembered; the rival-skill key is
 *  deliberately left out, because what this spec measures is the URL and the
 *  picker writing it. */
async function bootIso(page: import("@playwright/test").Page, extra = "") {
  await bootSoloIso(page, {
    // L1f (#237): under the new loop every chair races the loop's own 12★
    // line (L13), so the difficulty's short race this spec pins belongs to the
    // retired loop — `?loop=old` keeps the assertion honest.
    url: `${BASE}?seed=79&loop=old${extra}`,
    remembered: { "hexmatch:tutorial": "never" },
  });
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
