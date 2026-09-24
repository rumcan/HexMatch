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

const BASE = "/";
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
  await page.getByRole("button", { name: /^Play vs AI(?! — Conquest)/ }).click();
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
  // #299: the plant is not a tab on this loop either — the strip is Bank and
  // Feed, and the plant panel itself lives inside the session window, which
  // waits closed for the first Depot.
  await expect(page.locator('#iso-trade [data-tab="plant"]')).toHaveCount(0);
  await expect(page.locator("#iso-session")).toBeHidden();
  await expect(page.locator("#iso-session #iso-quarry")).toHaveCount(1);
  // The ♻ Reset and the combo bank ride the panel — hidden while it is.
  await expect(page.locator(".reset-btn")).toBeHidden();
  await expect(page.locator(".combo-bank")).toBeHidden();

  // L2 (#216) + L13: gravel is free, and paving is sold as the fast lane, not
  // as a quarter-star the scoreboard no longer pays.
  await expect(page.locator('[data-tool="dirt"]')).toContainText(/free/i);
  await expect(page.locator('[data-tool="road"]')).toContainText("faster hauling");
  await expect(page.locator('[data-tool="road"]')).not.toContainText("paving dirt");

  expect(errors).toEqual([]);
});

test("#299: placing a Depot opens the session window over the map", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    localStorage.setItem("hexmatch:rival-skill", "normal");
    localStorage.setItem("hexmatch:tutorial", "never");
  });
  await bootFresh(page, "?seed=1337");

  // The setup is played out by the twins and the opening Depot placed by the
  // game's own legality rules — the same route `iso-l8-legibility.spec.ts`
  // walks. What this spec watches is WHERE the session appears.
  const placed = await page.evaluate(() => {
    const h = (window as any).__iso;
    h.finishSetup();
    const W = h.grid.w, H = h.grid.h;
    for (const ind of h.grid.industries) {
      for (let dy = 0; dy <= 4; dy++) {
        for (let dx = -2; dx <= ind.w + 1; dx++) {
          const tx = ind.tx + dx, ty = ind.ty + ind.h + dy;
          if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
          if (!h.tileProbe("dirt", tx, ty).harvester.ok) continue;
          if (h.placeDepot(tx, ty)) return true;
        }
      }
    }
    return false;
  });
  expect(placed, "the map offers at least one legal Depot lot").toBe(true);

  // The window stands up over the map with everything the ticket asks it to
  // carry: a title naming the Depot, moves left, score and yield, and the
  // two doors — Finish and Abandon (#301's labels).
  const win = page.locator("#iso-session");
  await expect(win).toBeVisible();
  await expect(win.locator(".tp-title")).toContainText(/Tuning .* Depot/);
  await expect(win.locator(".tp-moves")).toContainText("moves");
  await expect(win.locator(".tp-score")).toContainText("Score");
  await expect(win.locator(".tp-yield")).toContainText("Yield");
  await expect(win.locator(".tp-finish")).toBeVisible();
  await expect(win.locator(".tp-abandon")).toBeVisible();
  await expect(win.locator(".board-slot .gem").first()).toBeVisible();
  // Inside an active session the reset / combo chrome is allowed on screen.
  await expect(win.locator(".reset-btn")).toBeVisible();
  await expect(win.locator(".combo-bank")).toBeVisible();

  // The map behind it is BLOCKED: inert, so neither a click nor a keyboard
  // walk reaches it until the window closes.
  expect(await page.evaluate(() => (document.querySelector("#map") as HTMLElement).inert)).toBe(true);

  // Abandon (nothing scored, so #301's confirm does not arm) puts the map
  // back and takes the window — and the board — down.
  await win.locator(".tp-abandon").click();
  await expect(win).toBeHidden();
  expect(await page.evaluate(() => (document.querySelector("#map") as HTMLElement).inert)).toBe(false);
  await expect(page.locator(".reset-btn")).toBeHidden();
  // Between sessions the plate lives in the rail's plant card, saying how to
  // open the next one.
  await expect(page.locator("#iso-plant")).toContainText(/No tuning session|re-match/);

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
  // #299 moved the PROCESSING PLANT out of the rail on the new loop only —
  // the retired loop's always-on board keeps its tab and its docked panel.
  await expect(page.locator('#iso-trade [data-tab="plant"]')).toHaveCount(1);
  await expect(page.locator("#iso-trade #iso-quarry")).toBeVisible();
  await expect(page.locator("#iso-session")).toHaveCount(0);
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
