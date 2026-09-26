import { test, expect, type Page } from "@playwright/test";
import { bootBudget } from "./boot";

// ══════════════════════════════════════════════════════════════════════════
// TUT-03 (#422) — the in-game guide, against the REAL built game.
//
// The unit suite (tests/unit/iso-guide.test.ts) owns the engine, the sections
// and the projector in jsdom. What only a real browser can prove is the
// wiring around them:
//
//   * the guide is what a first-time player actually meets after "Play vs AI",
//     and it stands OVER a live game — the clock runs, the map takes a click,
//     nothing is blocked;
//   * the spotlight really lands on the chrome (the veil is one box-shadow,
//     so the hole has to be measured to exist);
//   * a real click on the target is what advances a step, and a real drawer
//     tab is what advances the drawer section;
//   * "End tutorial" is the one exit that is remembered — the next fresh game
//     does not start the guide by itself, and the Tutorial menu is the door
//     back in (a dismissed guide never restarts unasked);
//   * finishing a section marks it, and the mark survives a reload;
//   * `?guide=0` (and the legacy `?tutorial=0`) keep it out of the way.
//
// Every step boots through the start screen, the app's only entry point, and
// drops the autosave first so each boot is a FRESH game by construction.
// ══════════════════════════════════════════════════════════════════════════

const BASE = "/";
const GUIDE = "#iso-guide";
const SAVE_KEY = "hexmatch:save";

/** The strip's one caption. */
const caption = (page: Page) => page.locator(`${GUIDE} .guide-caption`);
const key = (page: Page, act: string) => page.locator(`${GUIDE} [data-act="${act}"]`);

const hasSave = (page: Page) =>
  page.evaluate((k) => localStorage.getItem(k) !== null, SAVE_KEY);
const guideRecord = (page: Page) =>
  page.evaluate(() => localStorage.getItem("hexmatch:guide"));

/**
 * Boot a solo game through the front door and wait for the map.
 *
 * `fresh: true` (the default) drops the autosave on the START SCREEN — after
 * the previous game's `pagehide` write and before Play mounts the next one —
 * so the boot is a new game by construction. Without it a shelf with a save
 * turns the front door's gold button into CONTINUE, which resumes the match.
 */
async function boot(page: Page, extra = "", opts: { fresh?: boolean } = {}) {
  await page.goto(`${BASE}?seed=79${extra}`);
  if (opts.fresh ?? true) {
    await page.evaluate((k) => localStorage.removeItem(k), SAVE_KEY);
    expect(await hasSave(page)).toBe(false);
  }
  // CONTINUE-01 (#191): a shelf with a save resumes in one click.
  if (await hasSave(page)) {
    await page.getByRole("button", { name: /^Continue/ }).click();
  } else {
    await page.locator(".menu-btn.primary").click();
    await page.getByRole("button", { name: /^Play vs AI(?! — Conquest)/ }).click();
  }
  await page.waitForFunction(() => {
    const h = (window as unknown as {
      __iso?: { phase: string; loading: boolean; grid?: { industries: unknown[] } };
    }).__iso;
    return !!h && h.phase === "setup-factory" && !!h.grid
      && h.grid.industries.length > 0 && !h.loading;
  }, null, { timeout: bootBudget() });
}

/** Remember a difficulty so AI-02's picker stays out of the way. */
async function pickDifficulty(page: Page, key_ = "normal") {
  await page.addInitScript(
    (k: string) => localStorage.setItem("hexmatch:rival-skill", k), key_,
  );
}

/** ☰ → Tutorial — the menu that lists every section. */
async function openTutorialMenu(page: Page) {
  await page.locator("#iso-menu-btn").click();
  await page.locator(".tm-item", { hasText: "Tutorial" }).first().click();
  const menu = page.locator("[data-act='guide-menu']");
  await expect(menu).toBeVisible();
  return menu;
}

test("TUT-03 the first boot stands the guide over a live, playable game", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // No remembered difficulty on purpose: the guide stands from the boot, and
  // AI-02's prompt must not be what this spec is really looking at.

  await boot(page);
  await expect(page.locator(GUIDE)).toBeVisible({ timeout: bootBudget() });
  await expect(page.locator(GUIDE)).toHaveAttribute("data-section", "getting-started");
  await expect(page.locator(GUIDE)).toHaveAttribute("data-step", "map");
  await expect(page.locator(`${GUIDE} .guide-kicker`)).toHaveText("Getting started");
  await expect(page.locator(`${GUIDE} .guide-count`)).toHaveText("1 / 3");
  // the one caption, and the two exits that are ALWAYS there
  await expect(caption(page)).toContainText(/island is yours/i);
  for (const act of ["guide-skip", "guide-end"]) {
    await expect(key(page, act)).toBeVisible();
  }

  // The game underneath is live: still the boot phase the guide is covering,
  // nothing placed, nothing charged.
  expect(await page.evaluate(() =>
    (window as unknown as { __iso: { phase: string } }).__iso.phase)).toBe("setup-factory");

  // …and the guide never takes a click: the veil is pointer-events:none, so a
  // tap on the map lands on the map. (The strip is the only hit area.)
  const blocked = await page.evaluate(() => {
    const hole = document.querySelector("#iso-guide .guide-hole") as HTMLElement | null;
    const layer = document.querySelector("#iso-guide") as HTMLElement | null;
    return { hole: hole ? getComputedStyle(hole).pointerEvents : null,
      layer: layer ? getComputedStyle(layer).pointerEvents : null };
  });
  expect(blocked.hole).toBe("none");
  expect(blocked.layer).toBe("none");

  // The section is three steps and each one is walked with the real key.
  await key(page, "guide-next").click();
  await expect(page.locator(GUIDE)).toHaveAttribute("data-step", "camera");
  await expect(page.locator(`${GUIDE} .guide-count`)).toHaveText("2 / 3");
  // Back only exists after the first step.
  await expect(key(page, "guide-back")).toBeVisible();
  await key(page, "guide-back").click();
  await expect(page.locator(GUIDE)).toHaveAttribute("data-step", "map");
  await expect(key(page, "guide-back")).toBeHidden();

  await key(page, "guide-next").click();
  await key(page, "guide-next").click();
  await expect(page.locator(GUIDE)).toHaveAttribute("data-step", "topbar");
  await key(page, "guide-next").click();
  // finishing the section is NOT dismissing the guide: the layer goes idle
  // (display:none) and nothing is written to the record
  await expect(page.locator(GUIDE)).toBeHidden();
  expect(await guideRecord(page)).toBeNull();

  expect(errors).toEqual([]);
});

test("TUT-03 the spotlight lands on the chrome it names, and a click on it advances", async ({ page }) => {
  await pickDifficulty(page);
  await boot(page);
  await expect(page.locator(GUIDE)).toBeVisible({ timeout: bootBudget() });

  // Step 2's target is the recenter key in the top bar: the hole must be a
  // real box over that button, not a full-screen dim.
  await key(page, "guide-next").click();
  await expect(page.locator(GUIDE)).toHaveAttribute("data-step", "camera");
  const over = await page.evaluate(() => {
    const hole = document.querySelector("#iso-guide .guide-hole") as HTMLElement;
    const btn = document.querySelector('[data-act="recenter"]') as HTMLElement;
    const h = hole.getBoundingClientRect(), b = btn.getBoundingClientRect();
    return { w: h.width, h: h.height, vw: window.innerWidth, vh: window.innerHeight,
      dx: Math.abs(h.left + h.width / 2 - (b.left + b.width / 2)),
      dy: Math.abs(h.top + h.height / 2 - (b.top + b.height / 2)) };
  });
  expect(over.w).toBeGreaterThan(8);
  expect(over.h).toBeGreaterThan(8);
  expect(over.w).toBeLessThan(over.vw);       // a hole, not a veil
  expect(over.h).toBeLessThan(over.vh);
  expect(over.dx).toBeLessThan(24);
  expect(over.dy).toBeLessThan(24);

  // The real click on that key is what the step waits for.
  await page.locator('[data-act="recenter"]').click();
  await expect(page.locator(GUIDE)).toHaveAttribute("data-step", "topbar");
});

test("TUT-03 a real drawer tab advances the drawer section", async ({ page }) => {
  await pickDifficulty(page);
  await boot(page);
  await expect(page.locator(GUIDE)).toBeVisible({ timeout: bootBudget() });
  await key(page, "guide-end").click();          // the first section is not the subject
  await expect(page.locator(GUIDE)).toBeHidden();

  // ☰ → Tutorial → The drawer. The step points at the Bank tab, opens the
  // Economy sheet for the player (the assist), and waits for the tab.
  const menu = await openTutorialMenu(page);
  await expect(menu.locator("[data-act='guide-section']")).toHaveCount(10);
  await menu.locator('[data-section="drawer"]').click();
  await expect(page.locator(GUIDE)).toHaveAttribute("data-section", "drawer");
  await expect(page.locator(GUIDE)).toHaveAttribute("data-step", "open");
  await expect(caption(page)).toContainText(/Bank, Market, Black Market, Feed and Quests/i);

  await page.locator('#iso-trade [data-tab="bank"]').click();
  await expect(page.locator(GUIDE)).toHaveAttribute("data-step", "bank");
  await expect(caption(page)).toContainText(/exchange/i);
  // …and the rest of the drawer is walked the same way, one tab at a time
  for (const [tab, step, words] of [
    ["black", "black", /blockade/i],
    ["feed", "feed", /logs everything/i],
    ["quests", "quests", /optional/i],
  ] as const) {
    await key(page, "guide-next").click();
    await page.locator(`#iso-trade [data-tab="${tab}"]`).click();
    await expect(page.locator(GUIDE)).toHaveAttribute("data-step", step);
    await expect(caption(page)).toContainText(words);
  }
});

test("TUT-03 a dismissed guide stays dismissed, and the menu is the door back in", async ({ page }) => {
  await pickDifficulty(page);
  await boot(page);
  await expect(page.locator(GUIDE)).toBeVisible({ timeout: bootBudget() });
  await key(page, "guide-end").click();
  await expect(page.locator(GUIDE)).toBeHidden();
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem("hexmatch:guide") ?? "{}").dismissed)).toBe(true);

  // A FRESH game does not start the guide by itself…
  await boot(page);
  await expect(page.locator(GUIDE)).toBeHidden();
  // …and the mark on the section it did not finish is not there either
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem("hexmatch:guide") ?? "{}").done ?? [])).not.toContain("getting-started");

  // …but the Tutorial menu still lists every section, and a pick runs it now.
  const menu = await openTutorialMenu(page);
  await expect(menu.locator("[data-act='guide-section']")).toHaveCount(10);
  await menu.locator('[data-section="getting-started"]').click();
  await expect(page.locator(GUIDE)).toHaveAttribute("data-section", "getting-started");
  // asking by name is the one thing that lifts the dismissal
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem("hexmatch:guide") ?? "{}").dismissed ?? false)).toBe(false);
  await key(page, "guide-end").click();
});

test("TUT-03 a finished section is marked, and the mark survives a reload", async ({ page }) => {
  await pickDifficulty(page);
  await boot(page);
  await expect(page.locator(GUIDE)).toBeVisible({ timeout: bootBudget() });
  for (let i = 0; i < 3; i++) await key(page, "guide-next").click();
  await expect(page.locator(GUIDE)).toBeHidden();
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem("hexmatch:guide") ?? "{}").done)).toContain("getting-started");

  // The autosave exists by now, so this boot RESUMES — a resumed game never
  // opens the guide by itself, and the menu shows the section as done.
  await expect.poll(() => hasSave(page), { timeout: 15000 }).toBe(true);
  await boot(page, "", { fresh: false });
  await expect(page.locator(GUIDE)).toBeHidden();
  const menu = await openTutorialMenu(page);
  const row = menu.locator('[data-section="getting-started"]');
  await expect(row.locator(".guide-menu-mark")).toHaveText("✓");
  await expect(row.locator(".guide-menu-go")).toHaveText("Replay");

  // "Reset tutorial" clears the marks and the dismissal.
  await page.locator("[data-act='guide-reset']").click();
  await expect(row.locator(".guide-menu-mark")).toHaveText("");
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem("hexmatch:guide") ?? "{}").done)).toEqual([]);
});

test("TUT-03 ?guide=0 and the legacy ?tutorial=0 keep the guide out of the way", async ({ page }) => {
  await pickDifficulty(page);
  await boot(page, "&guide=0");
  await expect(page.locator(GUIDE)).toBeHidden();
  await expect(page.locator("#iso-vp")).toBeVisible();
  // …without writing the preference: the next plain boot asks again
  expect(await guideRecord(page)).toBeNull();

  await boot(page, "&tutorial=0");
  await expect(page.locator(GUIDE)).toBeHidden();
  expect(await guideRecord(page)).toBeNull();

  await boot(page);
  await expect(page.locator(GUIDE)).toBeVisible({ timeout: bootBudget() });
});

test("TUT-03 Skip section drops the section without marking it", async ({ page }) => {
  await pickDifficulty(page);
  await boot(page);
  await expect(page.locator(GUIDE)).toBeVisible({ timeout: bootBudget() });
  await key(page, "guide-skip").click();
  await expect(page.locator(GUIDE)).toBeHidden();
  expect(await page.evaluate(() =>
    JSON.parse(localStorage.getItem("hexmatch:guide") ?? "{}").done ?? [])).not.toContain("getting-started");
});
