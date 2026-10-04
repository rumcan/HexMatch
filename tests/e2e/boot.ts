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
 *  are what a healthy CI node needs. Desktop was 20s until the boot grew past it (#623: software
 *  GL, 15-25s on a CI core), now 60s. */
export const bootBudget = (): number => {
  const env = Number(process.env.PW_BOOT_BUDGET ?? 0);
  if (env > 0) return env;
  return isPhoneProject() ? 150000 : 60000;
};

// ══════════════════════════════════════════════════════════════════════════
// Issue #135 — the solo boot, in one place, right beside the budget it waits
// on.
//
// `/` is the MAIN MENU (STORY-01) — it mounts no game until Play →
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
    /** LIVE3D-ON (#698): leave the URL bare so the default (3D on) boots. */
    defaultThree?: boolean;
  },
): Promise<void> {
  // LIVE3D-ON (#698): 3D is the default; specs keep their 2D pixels unless the URL says three=1 (or three=0 already).
  if (!opts.defaultThree && !/[?&]three=/.test(opts.url)) opts = { ...opts, url: opts.url + (opts.url.includes("?") ? "&" : "?") + "three=0" };
  if (opts.remembered && Object.keys(opts.remembered).length > 0) {
    await page.addInitScript((state: Record<string, string>) => {
      for (const [k, v] of Object.entries(state)) localStorage.setItem(k, v);
    }, opts.remembered);
  }
  // PLAY-FIX: page.goto can abort with ERR_ABORTED if the frame detaches during HMR or a
  // previous navigation — retry once and wait for DOM to settle before clicking the menu.
  try {
    await page.goto(opts.url, { waitUntil: "domcontentloaded" });
  } catch (e) {
    // Retry on abort — the dev server may have restarted between specs.
    if (String(e).includes("ERR_ABORTED") || String(e).includes("detached")) {
      await page.waitForTimeout(500);
      await page.goto(opts.url, { waitUntil: "domcontentloaded" });
    } else throw e;
  }
  await page.locator(".menu-btn.primary").waitFor({ state: "visible", timeout: bootBudget() });
  // The front door, then the mode screen — the same two clicks a player makes.
  // CONTINUE-01 (#191): with a match on the shelf the gold door is Continue and Play steps down
  // beside it. A RE-boot within one test (the first game autosaved on pagehide) therefore RESUMES
  // that match, exactly as a refresh does — "start a new game" would forget the remembered
  // difficulty (discardSoloSave) and re-ask it, which is not what a re-boot spec is measuring.
  const hasShelf = (await page.getByRole("button", { name: /^Continue/ }).count()) > 0;
  if (hasShelf) {
    await page.locator(".menu-btn.primary").click();
  } else {
    await page.locator(".menu-btn.primary").click();
    const playBtn = page.getByRole("button", { name: /^Play vs AI(?! — Conquest)/ });
    await playBtn.waitFor({ state: "visible", timeout: bootBudget() });
    await playBtn.click();
  }
  await page.waitForFunction((resumed) => {
    const h = (window as unknown as {
      __iso?: { phase: string; loading: boolean; grid?: { industries: unknown[] } };
    }).__iso;
    // LOAD-01: the loading screen covers the map until the art settles —
    // clicking before it lifts would land on the overlay, not a tile.
    return !!h && (resumed ? /^(setup-factory|play)$/.test(h.phase) : h.phase === "setup-factory")
      && !!h.grid && h.grid.industries.length > 0 && !h.loading;
  }, hasShelf, { timeout: bootBudget() });
}

/**
 * START-1 (#604): town contracts wait for the FIRST Depot. Places one through the game's own twin
 * (`tileProbe` is the click's legality code) on the first legal lot beside an industry.
 */
export async function placeOpeningDepot(page: Page): Promise<{ tx: number; ty: number }> {
  const at = await page.evaluate(() => {
    const h = (window as unknown as {
      __iso: {
        grid: { w: number; h: number; industries: { tx: number; ty: number; w: number; h: number }[] };
        tileProbe: (kind: "dirt", tx: number, ty: number) => { harvester: { ok: boolean } };
        placeDepot: (tx: number, ty: number) => boolean;
      };
    }).__iso;
    for (const ind of h.grid.industries) {
      for (let dy = 0; dy <= 4; dy++) {
        for (let dx = -2; dx <= ind.w + 1; dx++) {
          const tx = ind.tx + dx, ty = ind.ty + ind.h + dy;
          if (tx < 0 || ty < 0 || tx >= h.grid.w || ty >= h.grid.h) continue;
          if (!h.tileProbe("dirt", tx, ty).harvester.ok) continue;
          if (h.placeDepot(tx, ty)) return { tx, ty };
        }
      }
    }
    return null;
  });
  if (!at) throw new Error("placeOpeningDepot: the map offers no legal Depot lot");
  return at;
}

/**
 * START-1 (#611): the Factory click STARTS the match, and the advisor's objective ("place-factory")
 * stays until the seat owns one — `__iso.finishSetup()` only flips the phase and no longer moves it.
 * Specs that skip the pointer path place the opening Factory through the game's own twin, on the
 * first site the game's own placement verdict (`placementPlan`) calls valid.
 */
export async function placeOpeningFactory(page: Page): Promise<{ tx: number; ty: number }> {
  const at = await page.evaluate(() => {
    const h = (window as unknown as {
      __iso: {
        grid: { w: number; h: number; towns: { tx: number; ty: number }[] };
        placementPlan: (kind: "factory", tx: number, ty: number) => { valid: boolean };
        placeFactory: (tx: number, ty: number) => boolean;
      };
    }).__iso;
    // town rings: the factory must touch a town, so look around each town centre
    for (const t of h.grid.towns) {
      for (let dy = -8; dy <= 8; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
          const tx = t.tx + dx, ty = t.ty + dy;
          if (tx < 0 || ty < 0 || tx >= h.grid.w || ty >= h.grid.h) continue;
          if (h.placementPlan("factory", tx, ty).valid && h.placeFactory(tx, ty)) return { tx, ty };
        }
      }
    }
    return null;
  });
  if (!at) throw new Error("placeOpeningFactory: the map offers no legal Factory site beside a town");
  return at;
}
