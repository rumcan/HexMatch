import { test, expect, type Page } from "@playwright/test";
import { STORY_MODE_ENABLED } from "../../src/story/flag";
import { bootBudget } from "./boot";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Read a numeric `export const NAME = n` out of the game's source. The modules
 *  themselves cannot be imported by Playwright's node loader (they pull in JSON
 *  asset manifests), and a hand-typed copy goes stale — a wrong version makes the
 *  shelf silently drop the crafted save (as it did when these were 1 and 14). */
function sourceConst(file: string, name: string): number {
  const src = readFileSync(fileURLToPath(new URL(`../../src/iso/${file}`, import.meta.url)), "utf8");
  const m = new RegExp(`export const ${name}\\s*=\\s*(\\d+)`).exec(src);
  if (!m) throw new Error(`${name} not found in src/iso/${file}`);
  return Number(m[1]);
}
const SAVEGAME_VERSION = sourceConst("savegame-runtime.ts", "SAVEGAME_VERSION");
const SNAPSHOT_VERSION = sourceConst("snapshot.ts", "SNAPSHOT_VERSION");

// ══════════════════════════════════════════════════════════════════════════
// CONTINUE-01 (#191) — Continue vs a deliberate new game, in the real app.
//
// The unit suite (save-summary / continue-game / main-menu) owns the shelf
// logic and the React doors in jsdom. What only a browser can prove is the
// loop a player actually walks:
//
//   1. a match played, then "Quit to Main Menu" leaves a save — and the
//      front door now offers a gold CONTINUE that actually RESUMES it
//      (restore toast, same match), instead of "Play vs AI" silently doing so;
//   2. Play vs AI with a save on the shelf ASKS first: cancel keeps the save,
//      "Start new game" clears it and boots a fresh setup phase;
//   3. a contract card with a save is a Continue card, and its "Start over"
//      door clears just that contract into a fresh briefing.
// ══════════════════════════════════════════════════════════════════════════

const SAVE_KEY = "hexmatch:save";
const CONTRACT_KEY = "hexmatch:save:story:inheritance";

/** Stand onboarding doors shut; these tests exercise the menus, not the tour. */
const REMEMBERED: Record<string, string> = {
  "hexmatch:tutorial": "never",
  "hexmatch:rival-skill": "normal",
};

async function waitIsoPhase(page: Page, phase: string | RegExp): Promise<void> {
  await page.waitForFunction((want) => {
    const h = (window as unknown as { __iso?: { phase?: string } }).__iso;
    if (!h?.phase) return false;
    return want instanceof RegExp ? want.test(h.phase) : h.phase === want;
  }, phase, { timeout: bootBudget() });
}

/** A minimal but VALID save payload for tests that need a shelf without
 *  playing a match: phase "play" is the discriminator — a resumed crafted
 *  save lands in "play", while the NEW games these tests confirm into must
 *  always land back in "setup-factory". */
function craftedSave(skillKey: string): string {
  return JSON.stringify({
    // versions come from the game: a hand-typed pair goes stale and the shelf silently drops the save
    v: SAVEGAME_VERSION,
    snapV: SNAPSHOT_VERSION,
    savedAt: Date.now(),
    seed: 4242,
    skillKey,
    phase: "play",
    winnerId: null,
    bandit: {},
    track: { dirt: "", road: "", owner: "", upgraded: "" },
    eco: { harvesters: [], factories: [] },
    players: [],
    boards: [],
    clocks: {},
  });
}

async function quitToMainMenu(page: Page): Promise<void> {
  await page.locator("#iso-menu-btn").click();
  await page.locator(".tm-item", { hasText: "Quit to Main Menu" }).click();
  await expect(page.locator(".start-screen.menu")).toBeVisible();
}

test.describe("Continue door (#191)", () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(bootBudget() * 4 + 30_000);
    await page.addInitScript((state) => {
      for (const [k, v] of Object.entries(state)) localStorage.setItem(k, v);
    }, REMEMBERED);
  });

  test("a match left via Quit is resumed from Continue, not from Play", async ({ page }) => {
    await page.goto("/");
    // fresh machine: no Continue door, Play stays gold
    await expect(page.getByRole("button", { name: /^Continue/ })).toHaveCount(0);
    await page.locator(".menu-btn.primary").click();
    await page.getByRole("button", { name: /^Play vs AI(?! — Conquest)/ }).click();
    await waitIsoPhase(page, "setup-factory");
    // the 5-second autosave puts the match on the shelf (the boot stalls the main thread for
    // 10s+ in software GL, so the first tick lands late — the wait follows the boot budget)
    await page.waitForFunction(
      (k) => localStorage.getItem(k) !== null,
      SAVE_KEY,
      { timeout: bootBudget() },
    );

    await quitToMainMenu(page);

    // the front door now names the match and owns the gold styling
    const cont = page.getByRole("button", { name: /^Continue/ });
    await expect(cont).toBeVisible();
    // #614 (menu redesign): the front-door Continue prints only "Continue →"; the save
    // summary rides in its accessible name (aria-label), so assert it there.
    await expect(cont).toHaveAccessibleName(/vs AI \(Normal\)/);
    await expect(cont).toHaveAccessibleName(/saved/);
    expect(await page.locator(".menu-btn.primary").textContent()).toMatch(/^Continue/);
    // Play is still here, explicitly the new-game door
    await expect(page.getByRole("button", { name: /^Play/ })).toContainText(/start a new game/i);

    await cont.click();
    await waitIsoPhase(page, /setup-factory|play/);
    // the boot RESUMED — the game says so (a fresh boot never does). HUD-1: "good" toasts are
    // low priority now — they are recorded in the Feed instead of popping up — so read the Feed.
    await expect(page.locator(".feed-pane")).toContainText(/restored from your save/, { timeout: bootBudget() });
  });

  test("Play vs AI asks before replacing the save, and only confirming starts new", async ({ page }) => {
    await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, craftedSave("normal")]);
    await page.goto("/");

    // into the mode screen (Play is no longer gold on the front door)
    await page.getByRole("button", { name: /^Play/ }).click();
    await expect(page.getByRole("button", { name: /^Continue/ })).toContainText(/vs AI \(Normal\)/);

    // first attempt: the painted ask, then cancel — the shelf survives
    await page.getByRole("button", { name: /^Play vs AI(?! — Conquest)/ }).click();
    const plate = page.locator(".confirm-sheet");
    await expect(plate).toBeVisible();
    await expect(plate).toContainText(/Start a new game/);
    await plate.getByRole("button", { name: "Cancel" }).click();
    await expect(plate).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k) !== null, SAVE_KEY)).toBe(true);

    // second attempt: confirm — slot cleared, a genuinely NEW boot begins
    await page.getByRole("button", { name: /^Play vs AI(?! — Conquest)/ }).click();
    await plate.getByRole("button", { name: /Start new game/ }).click();
    await waitIsoPhase(page, "setup-factory");
    await expect(page.locator(".feed-pane")).not.toContainText(/restored from your save/);
  });

  test("a contract's Start-over door clears just that save into a fresh briefing", async ({ page }) => {
    test.skip(!STORY_MODE_ENABLED, "Story mode is hidden (STORY_MODE_ENABLED = false)");
    await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [CONTRACT_KEY, craftedSave("easy")]);
    await page.addInitScript(() => localStorage.setItem("hexmatch:story", JSON.stringify({
      unlocked: 1, introSeen: true, advisor: true, results: {},
    })));
    await page.goto("/");
    // the story save makes CONTINUE the gold door — Play is reached by name
    await page.getByRole("button", { name: /^Play/ }).click();
    await page.getByRole("button", { name: /Story Mode/ }).click();

    const firstCard = page.locator(".chapter-item").first();
    await expect(firstCard.locator(".cc-continue")).toContainText(/Continue/);
    await expect(firstCard.locator(".cc-restart")).toBeVisible();

    // cancel keeps the contract save
    await firstCard.locator(".cc-restart").click();
    const plate = page.locator(".confirm-sheet");
    await expect(plate).toContainText(/Start "First Day on the Job" over/);
    await plate.getByRole("button", { name: "Cancel" }).click();
    expect(await page.evaluate((k) => localStorage.getItem(k) !== null, CONTRACT_KEY)).toBe(true);

    // confirm clears it and boots the contract's briefing — a resume would
    // skip the briefing straight into the "play" phase of the crafted save
    await firstCard.locator(".cc-restart").click();
    await plate.getByRole("button", { name: /Start over/ }).click();
    await expect(page.locator('.story-stage[data-scene="c1-pre"]'))
      .toBeVisible({ timeout: bootBudget() });
    expect(await page.evaluate((k) => localStorage.getItem(k), CONTRACT_KEY)).toBeNull();
  });
});
