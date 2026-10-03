// LIVE-3D yaw check: node tools/perf/three-yaw.mjs  (BASE=http://localhost:5180)  -> shots + pick check + fps per yaw
import { chromium } from "@playwright/test";
const BASE = process.env.BASE ?? "http://localhost:5180";
const EXTRA = process.env.EXTRA ?? "&three=1";
const browser = await chromium.launch({ args: ["--use-angle=default", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on("console", (m) => { if (/error|warn|terrain/i.test(m.type() + m.text())) console.log("CON", m.text().slice(0, 300)); });
page.on("pageerror", (e) => console.log("PAGEERR", e.message));
await page.addInitScript(() => { localStorage.setItem("hexmatch:rival-skill", "normal"); localStorage.setItem("hexmatch:tutorial", "never"); });
await page.goto(`${BASE}/?seed=199${EXTRA}`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.locator(".menu-btn.primary").waitFor({ state: "visible", timeout: 90000 });
await page.locator(".menu-btn.primary").click();
const play = page.getByRole("button", { name: /^Play vs AI(?! — Conquest)/ });
await play.waitFor({ state: "visible", timeout: 60000 }); await play.click();
await page.waitForFunction(() => { const h = window.__iso; return !!h && !!h.grid && h.grid.industries.length > 0 && !h.loading && /^(setup-factory|play)$/.test(h.phase); }, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.evaluate(() => { const h = window.__iso; outer: for (const t of h.grid.towns) for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) { const tx = t.tx + dx, ty = t.ty + dy; if (h.placementPlan("factory", tx, ty).valid && h.placeFactory(tx, ty)) break outer; } });
const town = await page.evaluate(() => { const t = window.__iso.grid.towns[0]; return { tx: t.tx + 4, ty: t.ty + 4 }; });
await page.evaluate((t) => window.__iso.lookAt(t.tx, t.ty, 1), town);
for (let k = 0; k < Number(process.env.KMAX ?? 4); k++) {
  if (k) { await page.keyboard.press("]"); await page.waitForTimeout(1200); }
  const r = await page.evaluate(async ({ town, secs }) => {
    const h = window.__iso; const yaw = h.viewYaw(), c = Math.cos(yaw), s = Math.sin(yaw), z = h.camera.zoom;
    let bad = 0, n = 0, ex = null; const mid = h.tileAtScreen(h.camera.vw / 2, h.camera.vh / 2), cam0 = { ...h.camera };
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const tx = town.tx + dx, ty = town.ty + dy; const [x, y] = h.tileScreenAt(tx, ty);
      const hh = 16 * z; const sx = x + 2 * s * hh, sy = y + c * hh;     // tile centre (top vertex + turned (0,HH))
      const [px, py] = h.tileAtScreen(sx, sy); n++; if (px !== tx || py !== ty) { bad++; ex ??= [tx, ty, px, py]; }
    }
    let frames = 0, last = performance.now(), worst = 0; const t0 = last; let stop = false;
    const loop = (t) => { frames++; worst = Math.max(worst, t - last); last = t; if (!stop) requestAnimationFrame(loop); }; requestAnimationFrame(loop);
    await new Promise((r) => setTimeout(r, secs * 1000)); stop = true;
    return { yawDeg: Math.round(yaw * 180 / Math.PI), pickBad: bad + "/" + n, ex, mid, cam0, town, fps: Math.round(frames * 1000 / (performance.now() - t0)), worstMs: Math.round(worst), three: h.threeStats?.() ?? null };
  }, { town, secs: 3 });
  console.log(JSON.stringify(r));
  await page.screenshot({ path: `tools/perf/yaw-${EXTRA.includes("three") ? "3d" : "2d"}-${k}.png` });
}
await browser.close();
