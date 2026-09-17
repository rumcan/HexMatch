import { test, expect } from "@playwright/test";
import { bootBudget, isPhoneProject } from "./boot";

// ══════════════════════════════════════════════════════════════════════════
// #163 — on a phone, switching Processing Plant → Bank (or Feed) and
// back must NOT grow the match-3 board. The old fit measured the plant slot
// mid tab-switch, when the outgoing pane still shared the flex space: the
// box came back full-width-but-a-sliver-tall, the cell dropped to its 30px
// floor, and the width math jumped to the 11-column maximum — the grow-only
// rule then stuck that board for the match, shrinking every gem into a band
// across the top. The settled pass (a frame after the swap + a
// ResizeObserver) decides board size from the SETTLED slot aspect, caps
// growth at +2 rows/columns, and tab switches on the same viewport ask for
// the exact same rectangle. These assertions read the REAL board box the
// player sees, so the band (and the overflow) fail loudly.
//
// #188 — the settled measurement was not enough by itself. `Board.setSize`
// repaints the chrome through the game's `onChange`, and that repaint used to
// adopt the chrome's own grow as the baseline the next pass measured from, so
// every round-trip below added two rows (portrait) or two COLUMNS (landscape)
// and the cap could not hold — the same over-wide board, one tab switch at a
// time. `src/game/ui.ts` now claims the rectangle before `setSize` and will
// not re-decide a slot box it has already answered, so the round-trip loop in
// this spec is also the creep regression: `first` is read once, and every
// later read must match it exactly.
// ══════════════════════════════════════════════════════════════════════════

// L1f (#237): the board is DOWN between tuning sessions on the new loop, and
// this spec measures the always-on board's fit and its creep — so it asks for
// the loop that has one (`?loop=old`, the retirement hatch).
const ISO_URL = "/hexmatch/?seed=199&loop=old";

async function bootIso(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    localStorage.setItem("hexmatch:rival-skill", "normal");
    localStorage.setItem("hexmatch:tutorial", "never");
  });
  await page.goto(ISO_URL);
  await page.locator(".menu-btn.primary").click();
  await page.getByRole("button", { name: /Play vs AI/ }).click();
  await page.waitForFunction(() => {
    const h = (window as any).__iso;
    return !!h && h.phase === "setup-factory" && !!h.grid && h.grid.industries.length > 0 && !h.loading;
  }, null, { timeout: bootBudget() });
}

/** Board rectangle, read straight off the grid the gems live in (CELL=80). */
async function boardSize(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>("#iso-gems");
    const wrap = document.querySelector<HTMLElement>("#iso-quarry .board-slot .board-wrap");
    const slot = document.querySelector<HTMLElement>("#iso-quarry .board-slot");
    if (!grid || !wrap || !slot) return null;
    const gb = grid.getBoundingClientRect();
    const sb = slot.getBoundingClientRect();
    return {
      cols: Math.round(parseInt(grid.style.width, 10) / 80),
      rows: Math.round(parseInt(grid.style.height, 10) / 80),
      gridW: gb.width,
      gridH: gb.height,
      slotW: sb.width,
      slotH: sb.height,
    };
  });
}

test("phone: tab round-trips never resize the board and it keeps filling the slot (#163)", async ({ page }) => {
  test.skip(!isPhoneProject(), "phone board-fit contract");
  await bootIso(page);

  // Open the economy sheet — it boots on the Processing Plant tab — and let
  // the settled fit do its one legitimate grow.
  await page.locator('.mnav-btn[data-view="trade"]').click();
  await expect(page.locator("#iso-quarry")).toBeVisible();
  await page.waitForTimeout(500);   // the settled pass runs a frame in
  const first = await boardSize(page);
  expect(first).not.toBeNull();
  expect(first!.cols).toBeGreaterThanOrEqual(7);
  expect(first!.rows).toBeGreaterThanOrEqual(8);
  // #163: growth is capped at +2 per axis — 11 columns is the bug, not the fit.
  expect(first!.cols).toBeLessThanOrEqual(9);
  expect(first!.rows).toBeLessThanOrEqual(10);
  // MOBILE-02: the settled board fills the slot's limiting axis and never
  // overflows it — the bug read as a thin band with a big empty gap below.
  await expect.poll(async () => {
    const b = await boardSize(page);
    return b ? Math.min(b.gridW / b.slotW, b.gridH / b.slotH) : 0;
  }, { timeout: 2000 }).toBeGreaterThan(0.85);
  await expect.poll(async () => {
    const b = await boardSize(page);
    return b ? Math.max(b.gridW - b.slotW, b.gridH - b.slotH) : 999;
  }, { timeout: 2000 }).toBeLessThanOrEqual(2);

  // Plant → Bank / Feed → Plant, twice each — the heart of #163.
  // (L11 / #226 dropped the Market tab from the strip on every loop.)
  for (let round = 0; round < 2; round++) {
    for (const tab of ["bank", "feed"] as const) {
      await page.locator(`.tab[data-tab="${tab}"]`).click();
      await page.waitForTimeout(120);
      await page.locator('.tab[data-tab="plant"]').click();
      // Give the deferred settled pass (rAF + ResizeObserver) room to make
      // the wrong move if it ever regresses.
      await page.waitForTimeout(300);
      const now = await boardSize(page);
      expect(now, `round ${round} ${tab} → plant`).not.toBeNull();
      expect(now!.cols, `round ${round} ${tab} changed columns`).toBe(first!.cols);
      expect(now!.rows, `round ${round} ${tab} changed rows`).toBe(first!.rows);
      // still filling, still fitted — no band, no overflow
      expect(Math.min(now!.gridW / now!.slotW, now!.gridH / now!.slotH)).toBeGreaterThan(0.85);
      expect(Math.max(now!.gridW - now!.slotW, now!.gridH - now!.slotH)).toBeLessThanOrEqual(2);
    }
  }
});
