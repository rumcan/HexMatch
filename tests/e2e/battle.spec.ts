import { test, expect } from "@playwright/test";
import { bootSoloIso } from "./boot";

// ══════════════════════════════════════════════════════════════════════════
// B2 (#247) — the battle screen, played for real in a real browser.
//
// The acceptance block: `__iso.startBattle(seed)` opens a battle against a
// placeholder opponent that makes legal moves, it can be played to a result,
// it holds up at desktop AND phone sizes, and closing returns to the map with
// no leftover state. The moves below are the engine's own `findMove` oracle
// clicked through the same gem buttons a hand would press — no rules bypass.
// ══════════════════════════════════════════════════════════════════════════

const ISO_URL = "/?seed=199";

async function bootIso(page: import("@playwright/test").Page) {
  await bootSoloIso(page, {
    url: ISO_URL,
    remembered: {
      "hexmatch:rival-skill": "normal",
      "hexmatch:tutorial": "never",
    },
  });
}

/** Read the engine for one legal swap and click its two gems. */
type Step = "moved" | "wait" | "over" | "none";

test.describe("B2 battle screen", () => {
  test("__iso.startBattle plays to a result and returns to the map", async ({ page }) => {
    test.setTimeout(240_000);
    await bootIso(page);

    await page.evaluate(() => {
      (window as unknown as { __iso: { startBattle(seed: number): unknown } })
        .__iso.startBattle(42);
    });
    const root = page.locator(".battle-root");
    await expect(root).toBeVisible();
    await expect(root.locator(".battle-side")).toHaveCount(2);
    await expect(root.locator(".battle-turn")).toHaveText(/YOUR TURN|BATTLE OVER/);
    await expect(root.locator(".gem")).toHaveCount(7 * 8);
    await expect(root.locator(".battle-abilities")).toBeHidden();

    // play it out: click the oracle's two gems every time the board is ours
    let finished = false;
    for (let i = 0; i < 80 && !finished; i++) {
      const step: Step = await page.evaluate(() => {
        type IsoWindow = {
          __iso: {
            battleScreen: {
              battle: {
                state: { over: boolean };
                board: { findMove(): number[] | null };
              };
            } | null;
          };
        };
        const iso = (window as unknown as IsoWindow).__iso;
        const screen = iso.battleScreen;
        if (!screen) return "none";
        if (screen.battle.state.over) return "over";
        const grid = document.querySelector(".battle-card .grid");
        if (grid && grid.classList.contains("locked")) return "wait";
        const mv = screen.battle.board.findMove();
        if (!mv) return "wait";
        const click = (r: number, c: number) => {
          const sel = `.battle-card .gem[data-r="${r}"][data-c="${c}"]`;
          const el = document.querySelector(sel);
          if (el instanceof HTMLElement) el.click();
        };
        click(mv[0], mv[1]);
        click(mv[2], mv[3]);
        return "moved";
      });
      if (step === "over") finished = true;
      else await page.waitForTimeout(400);
    }
    expect(finished).toBe(true);

    // the result screen names a verdict and Continue lands on the map
    const result = root.locator(".battle-result");
    await expect(result).toBeVisible({ timeout: 15_000 });
    await expect(root.locator(".battle-verdict")).toHaveText(/VICTORY|DEFEAT|DRAW/);
    await root.locator(".battle-continue").click();
    await expect(root).toHaveCount(0);
    // the map underneath is untouched — the canvas layers are still live
    expect(await page.evaluate(() => document.querySelectorAll("canvas").length)).toBeGreaterThan(0);
  });

  test("the screen holds its layout at phone size", async ({ page }) => {
    test.setTimeout(120_000);
    await bootIso(page);
    await page.setViewportSize({ width: 390, height: 780 });
    await page.evaluate(() => {
      (window as unknown as { __iso: { startBattle(seed: number): unknown } })
        .__iso.startBattle(7);
    });
    const root = page.locator(".battle-root");
    await expect(root).toBeVisible();
    await expect(root.locator(".battle-side")).toHaveCount(2);
    // both names, both health bars, the turn banner and the board are on screen
    await expect(root.locator(".battle-health")).toHaveCount(2);
    await expect(root.locator(".battle-turn")).toBeVisible();
    await expect(root.locator(".gem")).toHaveCount(7 * 8);
    // nothing hangs off the card: the board fits the viewport
    const box = await root.locator(".battle-board").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(390);
    await page.evaluate(() => {
      (window as unknown as {
        __iso: { battleScreen: { destroy(): void } | null };
      }).__iso.battleScreen?.destroy();
    });
    await expect(root).toHaveCount(0);
  });
});
