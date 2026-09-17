import { test, expect } from "@playwright/test";
import { bootBudget } from "./boot";

// ══════════════════════════════════════════════════════════════════════════
// L1f (#237) — the new loop, in a real browser, with NO URL parameter.
//
// The ticket's acceptance is exactly one sentence — *"a fresh sandbox game uses
// the new loop without any URL parameter"* — and the unit harness proves it in
// jsdom. This spec proves the two things jsdom cannot: that the shipped
// PRODUCTION bundle (this suite runs `vite preview` over `vite build`, where the
// old `import.meta.env.DEV` gate used to strip the flag entirely) boots on the
// clock loop, and that the copy a player is actually handed — the boot tour's
// cards, the build buttons — describes that loop.
//
// The retired loop's own browser coverage is where it always was
// (`iso-game.spec.ts`, `iso-tutorial.spec.ts`, `mobile-board-fit.spec.ts`,
// `iso-skill.spec.ts`), each now booted through `?loop=old`, the one-release
// hatch #237 leaves in.
// ══════════════════════════════════════════════════════════════════════════

const BASE = "/hexmatch/";
const SAVE_KEY = "hexmatch:save";
const TOUR = "#iso-tutorial";

/** The boot, from a clean shelf: the front door, then Play vs AI. */
async function bootFresh(page: import("@playwright/test").Page, search: string) {
  await page.goto(`${BASE}${search}`);
  // The game autosaves (5 s + pagehide), and a shelf with a save turns the
  // front door into CONTINUE — which would resume a match instead of booting
  // the fresh game this spec is about. Drop it before the menu mounts.
  await page.evaluate((k) => localStorage.removeItem(k), SAVE_KEY);
  await page.locator(".menu-btn.primary").click();
  await page.getByRole("button", { name: /Play vs AI/ }).click();
  await page.waitForFunction(() => {
    const h = (window as unknown as {
      __iso?: { phase: string; loading: boolean; grid?: { industries: unknown[] } };
    }).__iso;
    return !!h && h.phase === "setup-factory" && !!h.grid
      && h.grid.industries.length > 0 && !h.loading;
  }, null, { timeout: bootBudget() });
}

test("a bare production boot is on the new loop", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // No `loop` in the URL at all — that is the whole point of #237. The tour is
  // remembered-away here (it is walked on its own below) so the map chrome is
  // clickable, exactly as the other gameplay specs do it.
  await page.addInitScript(() => {
    localStorage.setItem("hexmatch:rival-skill", "normal");
    localStorage.setItem("hexmatch:tutorial", "never");
  });
  await bootFresh(page, "?seed=199");

  await expect.poll(() => page.evaluate(() => (window as any).__iso.newLoop)).toBe(true);

  // L13 (#228): the loop races its own line, not the shipped 10★.
  expect(await page.evaluate(() => (window as any).__iso.vpTarget)).toBe(12);
  await expect(page.locator("#iso-vp")).toContainText("/12");

  // L4 (#218): the plant floor is DOWN until a Depot is being tuned — the
  // always-on board was the retired loop's whole shape of the game.
  expect(await page.evaluate(() => document
    .querySelector("#iso-quarry .board-slot .board-wrap")?.classList.contains("hidden"))).toBe(true);

  // L2 (#216) + L13: gravel is free, and paving is sold as the fast lane, not
  // as a quarter-star the scoreboard no longer pays.
  await expect(page.locator('[data-tool="dirt"]')).toContainText(/free/i);
  await expect(page.locator('[data-tool="road"]')).toContainText("faster hauling");
  await expect(page.locator('[data-tool="road"]')).not.toContainText("paving dirt");

  expect(errors).toEqual([]);
});

test("?loop=old still opens the retired loop, board and all", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("hexmatch:rival-skill", "normal");
    localStorage.setItem("hexmatch:tutorial", "never");
  });
  await bootFresh(page, "?seed=199&loop=old");

  await expect.poll(() => page.evaluate(() => (window as any).__iso.newLoop)).toBe(false);
  expect(await page.evaluate(() => (window as any).__iso.vpTarget)).toBe(10);
  await expect(page.locator("#iso-vp")).toContainText("/10");
  expect(await page.evaluate(() => document
    .querySelector("#iso-quarry .board-slot .board-wrap")?.classList.contains("hidden"))).toBe(false);
  await expect(page.locator('[data-tool="road"]')).toContainText("paving dirt");
});

test("the tour a first-time player meets teaches the tuning session", async ({ page }) => {
  // A genuinely fresh shelf: no remembered difficulty (this boot stops at the
  // tour, which is what stands first in the onboarding chain), and the tour
  // therefore opens by itself.
  await bootFresh(page, "?seed=79");
  const tour = page.locator(TOUR);
  await expect(tour).toBeVisible({ timeout: bootBudget() });
  await expect(tour).toHaveAttribute("data-step", "loop");

  // The sentence #237's ticket names: the tour used to promise that every
  // delivery stamps a cargo token. On this loop a Depot is TUNED, and the
  // clock pays.
  await expect(tour).toContainText(/tuning session/i);
  await expect(tour).not.toContainText(/stamps a cargo token/i);

  // …the roads card says the gravel is free and does NOT count down an
  // allowance that buys nothing here (L2's `freeAllowanceCovers` is false).
  await tour.locator('[data-step="roads"]').click();
  await expect(tour).toHaveAttribute("data-step", "roads");
  await expect(tour.locator(".tut-points")).toContainText(/is free, tile after tile/i);
  await expect(tour.locator(".tut-points")).not.toContainText(/pays for the first \d+ of them/i);

  // …and the ★ ledger is the loop's own three rows, ending on the loop's line.
  await tour.locator('[data-step="victory"]').click();
  await expect(tour).toHaveAttribute("data-step", "victory");
  await expect(tour.locator(".tut-ledger-row")).toHaveCount(5);
  await expect(tour.locator(".tut-ledger-total")).toContainText("12★");
  await expect(tour.locator(".tut-ledger-total")).not.toContainText("10★");
});
