import { test, type Page } from "@playwright/test";

// ══════════════════════════════════════════════════════════════════════════
// MOBILE-01 — the boot wait, in one place, sized to the harness.
//
// Booting the island rasterizes ~1.4M device pixels of isometric art per
// frame. On desktop-chromium (dpr 1) that settles inside the 20s this suite
// has always allowed. The phone projects emulate dpr 2-3 and, in a
// network-restricted runner with no Playwright CDN and therefore a
// software-rasterizing Chromium (PW_CHROMIUM_EXECUTABLE), the same boot can
// take a minute. A fixed 20s budget made every phone spec fail on the wait,
// before it could assert anything — so the budget now follows the project,
// and desktop keeps exactly the number it has always had.
// ══════════════════════════════════════════════════════════════════════════
export const isPhoneProject = (): boolean => test.info().project.name !== "desktop-chromium";
/** PW_BOOT_BUDGET overrides both budgets for slow/shared runners; the defaults
 *  are what a healthy CI node needs, and desktop keeps its historic 20s. */
export const bootBudget = (): number => {
  const env = Number(process.env.PW_BOOT_BUDGET ?? 0);
  if (env > 0) return env;
  return isPhoneProject() ? 150000 : 20000;
};

// ══════════════════════════════════════════════════════════════════════════
// Issue #135 — the solo boot, in one place, right beside the budget it waits
// on.
//
// `/hexmatch/` is the MAIN MENU (STORY-01) — it mounts no game until Play →
// Play vs AI is clicked. Specs that `goto` and then wait for `window.__iso`
// now hang on a hook that never exists; the menu walk belongs to the boot.
// Inlining it into one shared helper means a moved or renamed menu control
// fails loudly AT THE CLICK inside `bootSoloIso`, once, instead of timing
// out twenty-second boot waits across every gameplay spec.
//
// What stays with each spec (see iso-game.spec.ts / iso-skill.spec.ts): the
// seed pin, and which onboarding overlays its `remembered` localStorage
// pre-set stands off — AI-02's difficulty prompt and TUT-01's tour. Specs
// that TEST the onboarding walk (iso-tutorial.spec.ts, story.spec.ts) must
// never use this helper: it would hide under test the very menu flow they
// assert.
// ══════════════════════════════════════════════════════════════════════════
export async function bootSoloIso(
  page: Page,
  opts: {
    /** The URL to open. Every spec pins the seed its steps were swept for. */
    url: string;
    /** Saved state to remember BEFORE boot (localStorage key → value), e.g.
     *  `{"hexmatch:tutorial": "never"}` so a full-screen boot overlay stays
     *  off the click path — a spec that plays the game, not onboarding,
     *  remembers what onboarding would otherwise have written itself. */
    remembered?: Record<string, string>;
  },
): Promise<void> {
  if (opts.remembered && Object.keys(opts.remembered).length > 0) {
    await page.addInitScript((state: Record<string, string>) => {
      for (const [k, v] of Object.entries(state)) localStorage.setItem(k, v);
    }, opts.remembered);
  }
  await page.goto(opts.url);
  // The front door, then the mode screen — the same two clicks a player makes.
  await page.locator(".menu-btn.primary").click();
  await page.getByRole("button", { name: /Play vs AI/ }).click();
  await page.waitForFunction(() => {
    const h = (window as unknown as {
      __iso?: { phase: string; loading: boolean; grid?: { industries: unknown[] } };
    }).__iso;
    // LOAD-01: the loading screen covers the map until the art settles —
    // clicking before it lifts would land on the overlay, not a tile.
    return !!h && h.phase === "setup-factory" && !!h.grid
      && h.grid.industries.length > 0 && !h.loading;
  }, null, { timeout: bootBudget() });
}
