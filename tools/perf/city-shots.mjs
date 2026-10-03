// LIVE-3D: placement ghost + highlight alignment at yaw 0..3.  node tools/perf/three-ghost.mjs [ToolLabel]
import { chromium } from "@playwright/test";
const BASE = process.env.BASE ?? "http://localhost:5180";

const browser = await chromium.launch({ args: ["--use-angle=default", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
await page.addInitScript(() => { localStorage.setItem("hexmatch:rival-skill", "normal"); localStorage.setItem("hexmatch:tutorial", "never"); });
await page.goto(`${BASE}/?seed=199${process.env.EXTRA ?? "&three=1"}`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.locator(".menu-btn.primary").click();
const play = page.getByRole("button", { name: /^Play vs AI(?! — Conquest)/ });
await play.waitFor({ state: "visible", timeout: 60000 }); await play.click();
await page.waitForFunction(() => { const h = window.__iso; return !!h && !!h.grid && h.grid.industries.length > 0 && !h.loading && /^(setup-factory|play)$/.test(h.phase); }, null, { timeout: 120000 });
await page.waitForTimeout(2000);
await page.waitForTimeout(1500);
for (let i = 0; i < 4; i++) { const w = page.locator("#iso-session"); if (!(await w.isVisible())) break; const s = w.getByRole("button", { name: /Skip/ }); if (await s.count() && await s.first().isVisible()) await s.first().click(); const f = w.locator(".tp-finish"); if (await f.count() && await f.first().isVisible()) await f.first().click(); await page.waitForTimeout(500); }
const names = (process.env.NAMES ?? "town_flats").split(",");
const items = await page.evaluate(() => { const h = window.__iso; h.grid.towns.forEach((t, i) => h.setTownLevel(i, 3)); return h.townDrawItems.map((e) => ({ sprite: e.sprite, tx: e.tx, ty: e.ty })); });
await page.waitForTimeout(1500);
for (const n of names) {
  const it = items.find((i) => i.sprite === n); if (!it) { console.log("none", n); continue; }
  await page.evaluate((t) => window.__iso.lookAt(t.tx + 1, t.ty + 1, 2), it);
  for (let k = 0; k < (Number(process.env.YAWS ?? 2)); k++) { if (k) await page.keyboard.press("]"); await page.waitForTimeout(1300); await page.screenshot({ path: `tools/perf/b-${n}-${k}.png`, clip: { x: 300, y: 150, width: 500, height: 400 } }); }
  await page.keyboard.press("]"); await page.keyboard.press("]"); await page.waitForTimeout(500);
  console.log("shot", n, JSON.stringify(it));
}
await browser.close();
