import { test, expect, type Page } from "@playwright/test";
import { STORY_MODE_ENABLED } from "../../src/story/flag";

// ══════════════════════════════════════════════════════════════════════════
// Issue #184 — the desktop mode menu fits without scrolling.
//
// The "Back to work, Logistics Manager" play/start screen used to be a narrow
// 440px single column: at 1432x936 "The ladder" was cut off at the fold while
// empty space sat on both sides. It is now a wider two-column card (manager
// and rating left, every play action right), and at each desktop acceptance
// size every primary action — including The ladder and Back to the menu — is
// visible with no document scrolling and no internally scrolling card.
//
// Each size also leaves a viewport screenshot in the test output, so a run
// doubles as the PR's before/after evidence.
// ══════════════════════════════════════════════════════════════════════════

const BASE = "/hexmatch/";

/** The acceptance sizes from the ticket, widest first. */
const SIZES = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1432x936", width: 1432, height: 936 },
  { name: "1366x768", width: 1366, height: 768 },
] as const;

/** Every control the ticket names, in the DOM order they must keep. */
const ACTIONS = [
  // Story mode is hidden for now (src/story/flag.ts).
  ...(STORY_MODE_ENABLED ? ["Story Mode"] : []),
  "Play vs AI",
  "Auto Matchmaking",
  "Host a game",
  "Join with a code",
  "The ladder",
  "Back to the menu",
];

async function openModeScreen(page: Page): Promise<void> {
  await page.goto(BASE);
  await page.locator(".menu-btn.primary").click();
  await expect(page.locator('main[aria-label="Hexmatch start screen"]')).toBeVisible();
}

test.describe("start menu two-column layout", () => {
  // The acceptance sizes are desktop viewports; the phone projects emulate
  // their own small screens (and own the single-column menu).
  test.beforeEach(async ({ }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "desktop menu sizes only");
  });

  for (const size of SIZES) {
    test(`all actions visible without scrolling at ${size.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openModeScreen(page);

      const panel = page.locator(".start-panel.start-modes");
      await expect(panel).toBeVisible();

      // Two balanced columns, info left of actions.
      const tracks = await panel.evaluate((el) =>
        getComputedStyle(el).gridTemplateColumns.split(" ").length);
      expect(tracks).toBe(2);
      const infoBox = await page.locator(".start-modes-info").boundingBox();
      const actionsBox = await page.locator(".start-actions").boundingBox();
      expect(infoBox && actionsBox).toBeTruthy();
      expect(infoBox!.x + infoBox!.width).toBeLessThanOrEqual(actionsBox!.x + 1);

      // No document scrolling and no internally scrolling card.
      const overflow = await page.evaluate(() => {
        const screen = document.querySelector(".start-screen") as HTMLElement;
        const card = document.querySelector(".start-panel.start-modes") as HTMLElement;
        return {
          docX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          docY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
          screenY: screen.scrollHeight - screen.clientHeight,
          cardY: card.scrollHeight - card.clientHeight,
        };
      });
      expect(overflow.docX).toBeLessThanOrEqual(1);
      expect(overflow.docY).toBeLessThanOrEqual(1);
      expect(overflow.screenY).toBeLessThanOrEqual(1);
      expect(overflow.cardY).toBeLessThanOrEqual(1);

      // Every named action is on screen — fully inside the viewport, not
      // clipped, not reachable only by scrolling or keyboard.
      const viewport = page.viewportSize()!;
      for (const action of ACTIONS) {
        const button = page.locator(".start-actions").getByRole("button", { name: new RegExp(`^${action}`) });
        await expect(button).toBeVisible();
        const box = await button.boundingBox();
        expect(box, `${action} has no box`).toBeTruthy();
        expect(box!.y, `${action} above the fold`).toBeGreaterThanOrEqual(-1);
        expect(box!.y + box!.height, `${action} below the fold`).toBeLessThanOrEqual(viewport.height + 1);
        expect(box!.x, `${action} off the left edge`).toBeGreaterThanOrEqual(-1);
        expect(box!.x + box!.width, `${action} off the right edge`).toBeLessThanOrEqual(viewport.width + 1);
      }

      await page.screenshot({ path: testInfo.outputPath(`start-menu-${size.name}.png`) });
    });
  }
});
