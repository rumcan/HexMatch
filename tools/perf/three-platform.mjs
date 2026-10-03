// LIVE-3D: place platforms (4 views) + a depot in the game, screenshot at yaw 0..3.  EXTRA="" for the 2D look.
import { chromium } from "@playwright/test";
const BASE = process.env.BASE ?? "http://localhost:5180";
const EXTRA = process.env.EXTRA ?? "&three=1";
const browser = await chromium.launch({ args: ["--use-angle=default", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
page.on("pageerror", (e) => console.log("PAGEERR", e.message));
await page.addInitScript(() => { localStorage.setItem("hexmatch:rival-skill", "normal"); localStorage.setItem("hexmatch:tutorial", "never"); });
await page.goto(`${BASE}/?seed=199${EXTRA}`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.locator(".menu-btn.primary").click();
const play = page.getByRole("button", { name: /^Play vs AI(?! — Conquest)/ });
await play.waitFor({ state: "visible", timeout: 60000 }); await play.click();
await page.waitForFunction(() => { const h = window.__iso; return !!h && !!h.grid && h.grid.industries.length > 0 && !h.loading && /^(setup-factory|play)$/.test(h.phase); }, null, { timeout: 120000 });
await page.waitForTimeout(2000);
const dismiss = async () => {
  const win = page.locator("#iso-session");
  for (let i = 0; i < 4 && (await win.isVisible()); i++) {
    const skip = win.getByRole("button", { name: /Skip/ });
    if (await skip.count() && await skip.first().isVisible()) await skip.first().click();
    const ab = win.locator(".tp-abandon");
    if (await ab.count() && await ab.first().isVisible()) await ab.first().click();
    await page.waitForTimeout(300);
  }
};
const placed = [];
const views = process.env.VIEW ? [process.env.VIEW] : ["ne", "se", "sw", "nw"];
const cands = await page.evaluate(() => { const h = window.__iso, c = []; for (const ind of h.grid.industries.slice(0, 6)) for (let dy = -6; dy <= ind.h + 6; dy += 1) for (let dx = -6; dx <= ind.w + 6; dx += 1) c.push({ x: ind.tx + dx, y: ind.ty + dy }); return c; });
for (const c of cands) {
  if (placed.length >= views.length) break;
  if (placed.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < 6)) continue;
  const v = views[placed.length];
  const ok = await page.evaluate(({ c, v }) => { try { return window.__iso.placePlatform(c.x, c.y, v); } catch (e) { return false; } }, { c, v });
  if (ok) { placed.push({ view: v, ...c }); await dismiss(); }
}
console.log(JSON.stringify(placed)); console.log(JSON.stringify(await page.evaluate(() => (window.__iso.threeItems ?? []).filter((i) => /platform|depot_/.test(i.sprite)))));
const c = placed[Number(process.env.LOOK ?? 0)] ?? { x: 30, y: 30 };
await page.evaluate((c) => window.__iso.lookAt(c.x, c.y, 1), c);
for (let k = 0; k < Number(process.env.KMAX ?? 4); k++) {
  if (k) await page.keyboard.press("]");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `tools/perf/platform-${process.env.VIEW ?? "all"}-${EXTRA.includes("three") ? "3d" : "2d"}-${k}.png` });
}
await browser.close();
