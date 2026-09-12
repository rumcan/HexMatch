import { test, expect } from "@playwright/test";

// ══════════════════════════════════════════════════════════════════════════
// TUT-01 — the starting tour, against the REAL built game (vite preview).
//
// The unit suite (tests/unit/iso-tutorial.test.ts) owns the content and the
// card's mechanics in jsdom. What only a real browser can prove is the wiring
// around it:
//
//   * the tour is what a first-time player actually meets after "Play vs AI",
//     and the difficulty prompt WAITS for it instead of stacking on top of it;
//   * every step paints its figure, and the numbers in it are the live game's;
//   * "Never show this again" is the ONE exit that survives a reload — Skip,
//     Esc and the veil all bring the tour back next boot;
//   * once dismissed, the ❔ help modal still replays it (the preference stops
//     the tour opening itself, it never takes the lesson away).
//
// Every step boots through the start screen, the app's only entry point.
// ══════════════════════════════════════════════════════════════════════════

const BASE = "/hexmatch/";
const TOUR = "#iso-tutorial";
const STEP_IDS = ["loop", "plant", "depot", "roads", "board", "expand", "victory", "desk"];

/** Boot a solo game through the start screen and wait for the map to exist. */
async function boot(page: import("@playwright/test").Page, extra = "") {
  await page.goto(`${BASE}?seed=79${extra}`);
  await page.getByRole("button", { name: /Play vs AI/ }).click();
  await page.waitForFunction(() => {
    const h = (window as unknown as { __iso?: { phase: string } }).__iso;
    return !!h && h.phase === "setup-factory";
  }, null, { timeout: 20000 });
}

/** Remember a difficulty so AI-02's picker stays out of the way. */
async function pickDifficulty(page: import("@playwright/test").Page, key = "normal") {
  await page.addInitScript(
    (k: string) => localStorage.setItem("hexmatch:rival-skill", k), key,
  );
}

test("TUT-01 the first boot walks the tour, then hands over to the difficulty", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // No remembered difficulty on purpose: this spec asserts the tour hands the
  // boot over to AI-02's prompt rather than stacking under it.

  await boot(page);
  const tour = page.locator(TOUR);
  await expect(tour).toBeVisible();
  await expect(tour).toHaveAttribute("data-step", "loop");
  await expect(tour.locator(".tut-title")).toHaveText("One island, one loop");
  await expect(tour.locator(".tut-dot")).toHaveCount(STEP_IDS.length);

  // Walk it with the real button, and check each step painted its own figure.
  const expectFigure = async (id: string) => {
    if (id === "loop") return expect(tour.locator(".tut-chain-node")).toHaveCount(7);
    if (id === "plant") return expect(tour.locator(".tut-tile.ring-good")).toHaveCount(4);
    if (id === "depot") return expect(tour.locator(".t-depot")).toHaveCount(1);
    if (id === "roads") return expect(tour.locator(".t-dirt")).toHaveCount(2);
    if (id === "board") return expect(tour.locator(".tut-gem")).toHaveCount(20);
    if (id === "victory") return expect(tour.locator(".tut-ledger-row")).toHaveCount(4);
    // expand and desk are words only — a step with no figure paints no plate
    return expect(tour.locator(".tut-fig")).toHaveCount(0);
  };
  await expectFigure("loop");
  for (const id of STEP_IDS.slice(1)) {
    await tour.locator('[data-act="tut-next"]').click();
    await expect(tour).toHaveAttribute("data-step", id);
    await expectFigure(id);
  }
  // the finish line the ledger prints is the shipped one (no difficulty yet)
  await tour.locator('[data-step="victory"]').click();
  await expect(tour.locator(".tut-ledger-total")).toContainText("10★");
  await tour.locator('[data-step="desk"]').click();
  await expect(tour.locator('[data-act="tut-done"]')).toBeVisible();

  // The last key ends the tour — and finishing it is NOT dismissing it.
  await tour.locator('[data-act="tut-done"]').click();
  await expect(page.locator(TOUR)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("hexmatch:tutorial"))).toBeNull();

  // AI-02's prompt is what the tour hands over to.
  await page.locator("#iso-skill-prompt [data-skill='normal']").click();
  await expect(page.locator("#iso-skill-prompt")).toHaveCount(0);
  await expect(page.locator("#iso-vp")).toContainText("/10");

  // …and the game underneath is still in the boot phase the tour was covering:
  // nothing was placed, nothing was charged, no clock ran off without the player.
  expect(await page.evaluate(() => (window as unknown as { __iso: { phase: string } }).__iso.phase))
    .toBe("setup-factory");
  await expect(page.locator("#iso-banner")).toContainText(/place your factory/i);

  expect(errors).toEqual([]);
});

test("TUT-01 only “never show this again” survives a reload", async ({ page }) => {
  await pickDifficulty(page);

  // A skip (Esc) closes the card and remembers nothing.
  await boot(page);
  await expect(page.locator(TOUR)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(TOUR)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("hexmatch:tutorial"))).toBeNull();

  // So the next boot asks again.
  await boot(page);
  await expect(page.locator(TOUR)).toBeVisible();

  // The button is the one exit that persists.
  await page.locator('[data-act="tut-never"]').click();
  await expect(page.locator(TOUR)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("hexmatch:tutorial"))).toBe("never");

  // …and a fresh load now boots straight to the map.
  await boot(page);
  await expect(page.locator(TOUR)).toHaveCount(0);
  await expect(page.locator("#iso-banner")).toBeVisible();

  // The lesson is still one click away from the ❔, dismissal or not.
  await page.locator(".top-right .icon-btn[title='How to play']").click();
  await expect(page.locator(".modal.box")).toBeVisible();
  await page.locator("#tourBtn").click();
  await expect(page.locator(".modal-root")).toHaveClass(/hidden/);
  await expect(page.locator(TOUR)).toBeVisible();
  await expect(page.locator(TOUR)).toHaveAttribute("data-step", "loop");
  // Replaying leaves the stored preference exactly as it was.
  await page.locator('[data-act="tut-close"]').click();
  await expect(page.locator(TOUR)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("hexmatch:tutorial"))).toBe("never");
});

test("TUT-01 the tour quotes the live game, and ?tutorial=0 keeps it out of the way", async ({ page }) => {
  await pickDifficulty(page, "easy");   // the Easy chair races a 5★ line

  await boot(page);
  const tour = page.locator(TOUR);
  await expect(tour).toBeVisible();
  await tour.locator('[data-step="victory"]').click();
  await expect(tour).toHaveAttribute("data-step", "victory");
  // AI-04: the ★ line belongs to the difficulty the boot resolved, so the
  // ledger the tour prints is the one the HUD badge shows beside it.
  await expect(tour.locator(".tut-ledger-total")).toContainText("5★");
  await expect(page.locator("#iso-vp")).toContainText("/5");
  // the roads step quotes the allowance the live player record carries
  await tour.locator('[data-step="roads"]').click();
  await expect(tour.locator(".tut-points")).toContainText("first 12 of them");
  await tour.locator('[data-act="tut-done"]').click();
  await expect(page.locator(TOUR)).toHaveCount(0);

  // The URL opt-out the gameplay specs and playtest links use.
  await boot(page, "&tutorial=0");
  await expect(page.locator(TOUR)).toHaveCount(0);
  await expect(page.locator("#iso-banner")).toBeVisible();
});
