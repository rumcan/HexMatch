import { test, expect } from "@playwright/test";
import { bootBudget } from "./boot";

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
//     the tour opening itself, it never takes the lesson away);
//   * a RESUMED save never opens the tour — and does so without writing the
//     preference, so the four states (fresh start, resume, permanent
//     dismissal, replay) stay distinguishable.
//
// Every step boots through the start screen, the app's only entry point.
// Because the game autosaves (5s + pagehide), "boot again" is a RESUME unless
// the spec clears the save first — see `boot(..., { fresh: true })`; nothing relies on a
// second navigation happening to be a new game.
// ══════════════════════════════════════════════════════════════════════════

const BASE = "/";
const TOUR = "#iso-tutorial";
const STEP_IDS = ["loop", "plant", "depot", "roads", "rail", "board", "expand", "victory", "desk"];

// ── save control ──────────────────────────────────────────────────────────
// The game autosaves every 5s AND on `pagehide`, so the moment a spec
// navigates away from a booted game there is a recent save — and the next
// boot RESUMES it, which by design (src/iso/game.ts: `!bootSave && isSolo()`)
// never opens the tour. A spec that wants a fresh game must therefore say so,
// rather than trusting that "another navigation" means "another game".
const SAVE_KEY = "hexmatch:save";
const hasSave = (page: import("@playwright/test").Page) =>
  page.evaluate((k) => localStorage.getItem(k) !== null, SAVE_KEY);
const tutorialPref = (page: import("@playwright/test").Page) =>
  page.evaluate(() => localStorage.getItem("hexmatch:tutorial"));
const readSave = (page: import("@playwright/test").Page) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null") as { savedAt: number; seed: number } | null, SAVE_KEY);

/**
 * Boot a solo game through the start screen and wait for the map to exist.
 *
 * `fresh: true` drops the autosave on the START SCREEN — after the previous
 * game's `pagehide` save has been written and before Play mounts the next
 * one, the only moment nothing can race the write. That makes the boot a
 * fresh game by construction; without it, a second boot is a RESUME.
 */
async function boot(page: import("@playwright/test").Page, extra = "", opts: { fresh?: boolean } = {}) {
  // The tour belongs to the loop the game ships. `?loop=old` stands no tour
  // (game.ts), so this spec boots the same way a player does — seed only —
  // and walks the nine cards, the 5-row ledger and the live 12★ line.
  await page.goto(`${BASE}?seed=79${extra}`);
  if (opts.fresh) {
    await page.evaluate((k) => localStorage.removeItem(k), SAVE_KEY);
    expect(await hasSave(page)).toBe(false);
  }
  // CONTINUE-01 (#191): a shelf with a save makes the front door's gold
  // button CONTINUE, which resumes the match in one click — so a resume boot
  // never walks into Play vs AI (that door now starts a NEW game and would
  // ask first). A fresh shelf keeps Play gold, then Play vs AI boots clean.
  if (await hasSave(page)) {
    await page.getByRole("button", { name: /^Continue/ }).click();
  } else {
    // STORY-01 menu: the mode screen stands behind the front door — Play first
    await page.locator(".menu-btn.primary").click();
    await page.getByRole("button", { name: /^Play vs AI(?! — Conquest)/ }).click();
  }
  await page.waitForFunction(() => {
    const h = (window as unknown as { __iso?: { phase: string } }).__iso;
    return !!h && h.phase === "setup-factory";
  }, null, { timeout: bootBudget() });
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
    if (id === "loop") return expect(tour.locator(".tut-chain-node")).toHaveCount(5);
    if (id === "victory") return expect(tour.locator(".tut-ledger-row")).toHaveCount(5);
    // every other step shows a real screenshot of the game, and it loads
    const img = tour.locator("img.tut-shot");
    await expect(img).toHaveCount(1);
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
  };
  await expectFigure("loop");
  for (const id of STEP_IDS.slice(1)) {
    await tour.locator('[data-act="tut-next"]').click();
    await expect(tour).toHaveAttribute("data-step", id);
    await expectFigure(id);
  }
  // the finish line the ledger prints is the new loop's (no difficulty changes it)
  await tour.locator('[data-step="victory"]').click();
  await expect(tour.locator(".tut-ledger-total")).toContainText("12★");
  await tour.locator('[data-step="desk"]').click();
  await expect(tour.locator('[data-act="tut-done"]')).toBeVisible();

  // The last key ends the tour — and finishing it is NOT dismissing it.
  await tour.locator('[data-act="tut-done"]').click();
  await expect(page.locator(TOUR)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("hexmatch:tutorial"))).toBeNull();

  // AI-02's prompt is what the tour hands over to.
  await page.locator("#iso-skill-prompt [data-skill='normal']").click();
  await expect(page.locator("#iso-skill-prompt")).toHaveCount(0);
  await expect(page.locator("#iso-vp")).toContainText("/12");

  // …and the game underneath is still in the boot phase the tour was covering:
  // nothing was placed, nothing was charged, no clock ran off without the player.
  expect(await page.evaluate(() => (window as unknown as { __iso: { phase: string } }).__iso.phase))
    .toBe("setup-factory");
  // no hint banner stands over the map — the tour is where setup is taught
  await expect(page.locator("#iso-banner")).toBeHidden();

  expect(errors).toEqual([]);
});

test("TUT-01 fresh games: only “never show this again” survives to the next one", async ({ page }) => {
  await pickDifficulty(page);

  // A skip (Esc) closes the card and remembers nothing.
  await boot(page);
  await expect(page.locator(TOUR)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(TOUR)).toHaveCount(0);
  expect(await tutorialPref(page)).toBeNull();

  // So the next FRESH game asks again. (A resume would not — that is the
  // separate rule the next spec pins down — so the save is dropped on purpose.)
  await boot(page, "", { fresh: true });
  await expect(page.locator(TOUR)).toBeVisible();

  // The veil is the other "for now" exit: it closes, it remembers nothing.
  await page.locator(`${TOUR} .tut-shade`).click({ position: { x: 4, y: 4 } });
  await expect(page.locator(TOUR)).toHaveCount(0);
  expect(await tutorialPref(page)).toBeNull();

  await boot(page, "", { fresh: true });
  await expect(page.locator(TOUR)).toBeVisible();

  // The button is the one exit that persists.
  await page.locator('[data-act="tut-never"]').click();
  await expect(page.locator(TOUR)).toHaveCount(0);
  expect(await tutorialPref(page)).toBe("never");

  // …and a fresh game now boots straight to the map.
  await boot(page, "", { fresh: true });
  await expect(page.locator(TOUR)).toHaveCount(0);
  await expect(page.locator("#iso-vp")).toBeVisible();

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
  expect(await tutorialPref(page)).toBe("never");
});

test("TUT-01 a resumed game skips the tour without touching the preference", async ({ page }) => {
  await pickDifficulty(page);

  // A player mid-match who reloads is not a first-time player: the product
  // rule is "a restored save never opens the tour" — and it must do so by
  // reading the SAVE, not by writing the preference.
  await boot(page);
  await expect(page.locator(TOUR)).toBeVisible();
  await page.locator('[data-act="tut-close"]').click();
  await expect(page.locator(TOUR)).toHaveCount(0);
  expect(await tutorialPref(page)).toBeNull();

  // Wait for the autosave to actually exist (the 5s writer, no fixed sleep),
  // so the next boot is a resume by construction rather than by luck.
  await expect.poll(() => hasSave(page), { timeout: 15000 }).toBe(true);

  const before = await readSave(page);
  expect(before).not.toBeNull();

  await boot(page);
  // This boot RESUMED: the save it found is still the save it keeps writing
  // (same world, newer stamp) — no fresh game replaced it.
  await expect.poll(async () => (await readSave(page))?.savedAt ?? 0, { timeout: 15000 })
    .toBeGreaterThan(before!.savedAt);
  expect((await readSave(page))!.seed).toBe(before!.seed);
  await expect(page.locator(TOUR)).toHaveCount(0);
  await expect(page.locator("#iso-vp")).toBeVisible();
  // The tour is absent because of the save — the preference is still unset…
  expect(await tutorialPref(page)).toBeNull();

  // …which is why dropping the save brings the tour straight back.
  await boot(page, "", { fresh: true });
  await expect(page.locator(TOUR)).toBeVisible();
  await expect(page.locator(TOUR)).toHaveAttribute("data-step", "loop");
});

test("TUT-01 the tour quotes the live game, and ?tutorial=0 keeps it out of the way", async ({ page }) => {
  await pickDifficulty(page, "easy");   // Easy no longer shortens the new-loop line

  await boot(page);
  const tour = page.locator(TOUR);
  await expect(tour).toBeVisible();
  await tour.locator('[data-step="victory"]').click();
  await expect(tour).toHaveAttribute("data-step", "victory");
  // The new loop races VICTORY.loop.target on every difficulty. Easy's 5★ is
  // the retired hatch only, so the ledger and the badge must both say 12.
  await expect(tour.locator(".tut-ledger-total")).toContainText("12★");
  await expect(tour.locator(".tut-ledger-total")).not.toContainText("5★");
  await expect(page.locator("#iso-vp")).toContainText("/12");
  // Dirt is free. The card must not count down an allowance that buys nothing.
  await tour.locator('[data-step="roads"]').click();
  await expect(tour).toHaveAttribute("data-step", "roads");
  await expect(tour.locator(".tut-points")).toContainText("is free, tile after tile");
  await expect(tour.locator(".tut-points")).not.toContainText(/pays for the first \d+ of them/);
  // Mid-tour there is no Done — the last key is "Next" until the final step.
  await expect(tour.locator('[data-act="tut-done"]')).toHaveCount(0);
  await expect(tour.locator('[data-act="tut-next"]')).toBeVisible();
  // Finish it the real way: jump to the last step, where Done actually lives.
  await tour.locator('[data-step="desk"]').click();
  await expect(tour).toHaveAttribute("data-step", "desk");
  await expect(tour.locator('[data-act="tut-done"]')).toBeVisible();
  await tour.locator('[data-act="tut-done"]').click();
  await expect(page.locator(TOUR)).toHaveCount(0);
  expect(await tutorialPref(page)).toBeNull();

  // The URL opt-out the gameplay specs and playtest links use — proven on a
  // FRESH game, so it is the flag keeping the tour away and not the autosave.
  await boot(page, "&tutorial=0", { fresh: true });
  await expect(page.locator(TOUR)).toHaveCount(0);
  await expect(page.locator("#iso-vp")).toBeVisible();
  expect(await tutorialPref(page)).toBeNull();
});
