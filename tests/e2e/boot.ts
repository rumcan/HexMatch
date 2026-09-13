import { test } from "@playwright/test";

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
