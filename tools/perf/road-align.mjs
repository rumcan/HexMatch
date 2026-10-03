// LIVE-3D: placement ghost + highlight alignment at yaw 0..3.  node tools/perf/three-ghost.mjs [ToolLabel]
import { chromium } from "@playwright/test";
const BASE = process.env.BASE ?? "http://localhost:5180";

const browser = await chromium.launch({ args: ["--use-angle=default", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
await page.addInitScript(() => { localStorage.setItem("hexmatch:rival-skill", "normal"); localStorage.setItem("hexmatch:tutorial", "never"); });
await page.goto(`${BASE}/?seed=199&three=1`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.locator(".menu-btn.primary").click();
const play = page.getByRole("button", { name: /^Play vs AI(?! — Conquest)/ });
await play.waitFor({ state: "visible", timeout: 60000 }); await play.click();
await page.waitForFunction(() => { const h = window.__iso; return !!h && !!h.grid && h.grid.industries.length > 0 && !h.loading && /^(setup-factory|play)$/.test(h.phase); }, null, { timeout: 120000 });
await page.waitForTimeout(2000);
import sharp from "sharp";
await page.waitForTimeout(1500);
for (let i = 0; i < 4; i++) { const w = page.locator("#iso-session"); if (!(await w.isVisible())) break; const s = w.getByRole("button", { name: /Skip/ }); if (await s.count() && await s.first().isVisible()) await s.first().click(); const f = w.locator(".tp-finish"); if (await f.count() && await f.first().isVisible()) await f.first().click(); await page.waitForTimeout(500); }
const T = await page.evaluate(() => { const t = window.__iso.grid.towns[0]; return { x: t.tx, y: t.ty }; });
await page.evaluate((t) => window.__iso.lookAt(t.x, t.y, 1), T);
const res = {};
const tiles = [];
for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) tiles.push([T.x + dx, T.y + dy]);
const hs = await page.evaluate((ts) => ts.map(([x, y]) => window.__iso.heightAt(x, y)), tiles);
const cls = (r, g, b) => (Math.max(r, g, b) - Math.min(r, g, b) < 22 && r > 55 && r < 115) ? 1 : 0;   // asphalt/kerb grey
const grey = [];
for (let k = 0; k < 4; k++) {
  if (k) await page.keyboard.press("]");
  await page.waitForTimeout(1500);
  const pos = await page.evaluate((ts) => { const yw = window.__iso.viewYaw(), z = window.__iso.camera.zoom; return ts.map(([x, y]) => { const [a, b] = window.__iso.tileScreenAt(x, y); return [a + 2 * Math.sin(yw) * 16 * z, b + Math.cos(yw) * 16 * z]; }); }, tiles);
  await page.evaluate(() => document.querySelectorAll(".dbg").forEach((e) => e.remove())); const buf = await page.screenshot(); const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  grey.push(pos.map(([x, y]) => { x = Math.round(x); y = Math.round(y); if (x < 3 || y < 3 || x >= info.width - 3 || y >= info.height - 3) return -1; const i = (y * info.width + x) * info.channels; return cls(data[i], data[i + 1], data[i + 2]); }));
  await page.evaluate((p) => { document.querySelectorAll(".dbg").forEach((e) => e.remove()); p.forEach(([x, y], i) => { const d = document.createElement("div"); d.className = "dbg"; d.style.cssText = `position:fixed;left:${x - 2}px;top:${y - 2}px;width:4px;height:4px;background:${i % 15 === 7 || (i / 15 | 0) === 7 ? "#f0f" : "#0ff"};z-index:99999;pointer-events:none`; document.body.appendChild(d); }); }, pos);
  await page.screenshot({ path: `tools/perf/road-${k}.png`, clip: { x: 300, y: 150, width: 500, height: 400 } }); await sharp(`tools/perf/road-${k}.png`).extract({ left: 0, top: 200, width: 250, height: 200 }).resize({ width: 500, kernel: "nearest" }).toFile(`tools/perf/road-${k}z.png`);
}
const out = {};
for (const flat of [true, false]) for (let k = 1; k < 4; k++) {
  let n = 0, same = 0;
  tiles.forEach((_, i) => { const nb = [-1, 1, -15, 15].every((d) => hs[i + d] === undefined || hs[i + d] === hs[i]); if (nb !== flat || grey[0][i] !== 1 || grey[k][i] < 0) return; n++; if (grey[k][i] === 1) same++; });
  out[`${flat ? "flat" : "hill"} yaw${k}`] = `${same}/${n}`;
}
console.log(JSON.stringify(out), "hillTiles", new Set(hs).size);
await browser.close();
