import { test, expect } from "@playwright/test";
import { bootBudget } from "./boot";

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
  }, null, { timeout: bootBudget() });
}

test("the campaign menu opens with one open contract and four sealed", async ({ page }) => {
  await primeStory(page, "/");
  // STORY-01 menu: Play first — the mode screen stands behind the front door
  await page.locator(".menu-btn.primary").click();
  await page.getByRole("button", { name: /Story Mode/ }).click();
  const cards = page.locator(".chapter-card");
  await expect(cards).toHaveCount(5);
  await expect(page.locator(".chapter-card.locked")).toHaveCount(4);
  await expect(cards.first()).toContainText("First Day on the Job");
  await expect(cards.first()).toContainText("Logistics Manager");
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
  // STORY-01 menu: Play first — the mode screen stands behind the front door
  await page.locator(".menu-btn.primary").click();
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

// ══════════════════════════════════════════════════════════════════════════
// #122 — contract status badge must not overlap heading text, at desktop and
// narrow widths, across won/lost/locked/unplayed states.
// ══════════════════════════════════════════════════════════════════════════
type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box, tol = 1): boolean =>
  a.x + tol < b.x + b.width - tol &&
  b.x + tol < a.x + a.width - tol &&
  a.y + tol < b.y + b.height - tol &&
  b.y + tol < a.y + a.height - tol;

async function openCampaignWith(
  page: import("@playwright/test").Page,
  progress: { unlocked: number; results: Record<string, string> },
) {
  await page.addInitScript((p) => {
    localStorage.setItem("hexmatch:tutorial", "never");
    localStorage.setItem("hexmatch:rival-skill", "normal");
    localStorage.setItem("hexmatch:story", JSON.stringify({ ...p, introSeen: true, advisor: true }));
  }, progress);
  await page.goto("/");
  await page.locator(".menu-btn.primary").click();
  await page.getByRole("button", { name: /Story Mode/ }).click();
  await expect(page.locator(".chapter-card")).toHaveCount(5);
}

/** Every leaf box on every card must sit apart — no badge over any heading. */
async function expectCardsHaveNoOverlap(page: import("@playwright/test").Page) {
  const cards = page.locator(".chapter-card");
  const n = await cards.count();
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    const name = (await card.locator(".cc-name").textContent())?.trim() ?? `card ${i}`;
    const parts: Array<[string, Box | null]> = [
      ["face", await card.locator(".cc-face").boundingBox()],
      ["kicker", await card.locator(".cc-kicker").boundingBox()],
      ["name", await card.locator(".cc-name").boundingBox()],
      ["brief", await card.locator(".cc-brief").boundingBox()],
      ["meta", await card.locator(".cc-meta").boundingBox()],
    ];
    const badge = card.locator(".cc-seal, .cc-lock");
    if (await badge.count()) parts.push(["badge", await badge.boundingBox()]);
    for (const [label, box] of parts) {
      expect(box, `${name}: .${label} has a box`).not.toBeNull();
    }
    const boxes = parts as Array<[string, Box]>;
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        expect(
          overlaps(boxes[a][1], boxes[b][1]),
          `${name}: ${boxes[a][0]} overlaps ${boxes[b][0]}`,
        ).toBe(false);
      }
    }
  }
}

test("#122 contract badge never overlaps heading, won/lost/unplayed/locked", async ({ page }) => {
  // Mixed record: loss (the reported Inheritance state), win, unplayed open,
  // and two sealed — every badge state on screen at once.
  await openCampaignWith(page, {
    unlocked: 3,
    results: { inheritance: "loss", "toll-king": "win" },
  });
  await expect(page.locator(".chapter-card .cc-seal.loss").first()).toContainText("Filed · lost");
  await expectCardsHaveNoOverlap(page);

  // Narrow phone width: the header row wraps the badge below the kicker.
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(150);
  await expectCardsHaveNoOverlap(page);

  // 200% zoom proxy: halve the CSS width so text wraps as it does zoomed.
  await page.setViewportSize({ width: 640, height: 800 });
  await page.waitForTimeout(150);
  await expectCardsHaveNoOverlap(page);
});

test("#122 long contract headings keep clear of their badges", async ({ page }) => {
  // Every contract filed, so even the longest kicker (Contract V) wears a badge.
  await openCampaignWith(page, {
    unlocked: 5,
    results: {
      inheritance: "loss",
      "toll-king": "win",
      "black-gold": "loss",
      "stone-thunder": "win",
      "chairmans-ledger": "loss",
    },
  });
  await expect(page.locator(".chapter-card .cc-seal")).toHaveCount(5);
  await expectCardsHaveNoOverlap(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(150);
  await expectCardsHaveNoOverlap(page);
});
