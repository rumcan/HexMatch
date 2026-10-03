// LIVE-3D: screenshot specific town sprites (by name) at yaw 0..3.  node tools/perf/three-model-shots.mjs town_offices_tall factory_2x4 ...
import { chromium } from "@playwright/test";
const BASE = process.env.BASE ?? "http://localhost:5180";
const want = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-angle=default", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
const page = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage();
await page.addInitScript(() => { localStorage.setItem("hexmatch:rival-skill", "normal"); localStorage.setItem("hexmatch:tutorial", "never"); });
await page.goto(`${BASE}/?seed=${process.env.SEED ?? 199}&three=1`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.locator(".menu-btn.primary").click();
const play = page.getByRole("button", { name: /^Play vs AI(?! — Conquest)/ });
await play.waitFor({ state: "visible", timeout: 60000 }); await play.click();
await page.waitForFunction(() => { const h = window.__iso; return !!h && !!h.grid && h.grid.industries.length > 0 && !h.loading && /^(setup-factory|play)$/.test(h.phase); }, null, { timeout: 120000 });
await page.waitForTimeout(3000);
const items = await page.evaluate(() => window.__iso.townDrawItems.concat(window.__iso.grid.industries.map((i) => ({ sprite: i.type, tx: i.tx, ty: i.ty }))).map((e) => ({ sprite: e.sprite, tx: e.tx, ty: e.ty })));
console.log("sprites:", [...new Set(items.map((i) => i.sprite))].filter((s) => /town|factory|store|shops/.test(s)).join(" "));
for (const name of want) {
  const it = items.find((i) => i.sprite.replace(/_r$/, "") === name || i.sprite.startsWith(name));
  if (!it) { console.log("not on map:", name); continue; }
  await page.evaluate((t) => window.__iso.lookAt(t.tx, t.ty, 2), it);
  for (let k = 0; k < 4; k++) {
    if (k) { await page.keyboard.press("]"); }
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `tools/perf/model-${name}-${k}.png` });
  }
  await page.keyboard.press("]"); await page.waitForTimeout(1000);
  console.log("shot", name, it.sprite, it.tx, it.ty);
}
await browser.close();
