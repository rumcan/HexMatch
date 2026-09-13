import { test, expect } from "@playwright/test";

// ══════════════════════════════════════════════════════════════════════════
// STORY-01 — the campaign in a real browser, against the real built app.
//
// Three seams, no mocking: the menu opens with four sealed contracts on a
// fresh record; a playtest link (`?chapter=`) boots straight into a contract
// with the reel suppressed; and the cutscene stage — reel and briefing alike
// — really stands over the boot and really lifts when skipped, leaving the
// contract's rival wearing their name and painted face in the HUD.
// ══════════════════════════════════════════════════════════════════════════

/** Fresh record, no onboarding: the specs exercise the campaign, not the tour. */
async function primeStory(page: import("@playwright/test").Page, url: string) {
  await page.addInitScript(() => {
    localStorage.setItem("hexmatch:tutorial", "never");
    localStorage.setItem("hexmatch:rival-skill", "normal");
    localStorage.removeItem("hexmatch:story");
  });
  await page.goto(url);
}

/** Skip whatever reel or briefing is standing, until the game is under it. */
async function skipToGame(page: import("@playwright/test").Page) {
  for (let i = 0; i < 4; i++) {
    const skip = page.locator(".story-skip");
    if (await skip.count()) { await skip.click(); await page.waitForTimeout(350); continue; }
    break;
  }
  await page.waitForFunction(() => {
    const h = (window as unknown as { __iso?: { phase?: string } }).__iso;
    return !!h && (h.phase === "setup-factory" || h.phase === "play");
  }, null, { timeout: 20000 });
}

test("the campaign menu opens with one open contract and four sealed", async ({ page }) => {
  await primeStory(page, "/");
  await page.getByRole("button", { name: /Story Mode/ }).click();
  const cards = page.locator(".chapter-card");
  await expect(cards).toHaveCount(5);
  await expect(page.locator(".chapter-card.locked")).toHaveCount(4);
  await expect(cards.first()).toContainText("The Inheritance");
  await expect(cards.first()).toContainText("vs Torvin");
  // the opening reel is offered exactly while it is still unseen
  await expect(page.getByRole("button", { name: /opening reel/ })).toBeVisible();
});

test("a playtest link boots the contract, and skipping the briefing lands in the game", async ({ page }) => {
  await primeStory(page, "/?chapter=black-gold&storyintro=0");
  // the briefing stands first: the oil field, then Roque in person
  const stage = page.locator(".story-stage");
  await expect(stage).toBeVisible();
  await expect(page.locator(".story-caption")).toContainText("Roque field");
  await stage.click();                       // title card → first spoken line
  await expect(page.locator(".story-name")).toHaveText("Delphine Roque");
  await page.locator(".story-skip").click();
  await skipToGame(page);
  // the contract's rival wears their name in the dossier row
  await expect(page.locator(".king-name").nth(1)).toContainText("Delphine Roque");
  // and the HUD badge races to the contract's line, not the difficulty's
  await expect(page.locator(".vp-tot")).toHaveText("/7");
});

test("the reel plays once for a fresh player and skips clean", async ({ page }) => {
  await primeStory(page, "/");
  await page.getByRole("button", { name: /Story Mode/ }).click();
  await page.locator(".chapter-card").first().click();
  // unseen record ⇒ the opening reel stands before the briefing
  await expect(page.locator(".story-stage")).toBeVisible();
  await expect(page.locator(".story-titlecard")).toContainText("HEXMATCH INDUSTRIES");
  await page.locator(".story-skip").click();
  await page.waitForTimeout(400);
  // …and the contract's briefing follows it, Mabel first after the card
  const briefing = page.locator(".story-stage");
  await expect(briefing).toBeVisible();
  await briefing.click();
  await expect(page.locator(".story-name")).toHaveText("Mabel Quill");
  await skipToGame(page);
  await expect(page.locator(".king-name").nth(1)).toContainText("Torvin");
});
