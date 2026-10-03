// LIVE-3D spike perf: node tools/perf/three-spike.mjs  (dev server: npx vite --port 5179 --strictPort)
// Runs 2D baseline, ?three=1 (boxes) and ?three=1&tris=3000 at 3 zooms while panning across a town.
import { chromium } from "@playwright/test";
const BASE = process.env.BASE ?? "http://localhost:5179";
const SECS = Number(process.env.SECS ?? 4);
const variants = [["2d", ""], ["three-boxes", "&three=1&models=0"], ["three-models", "&three=1"], ["three-3000tri", "&three=1&tris=3000"]];

async function run(browser, name, extra) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.setItem("hexmatch:rival-skill", "normal");
    localStorage.setItem("hexmatch:tutorial", "never");
  });
  await page.goto(`${BASE}/?seed=199${extra}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.locator(".menu-btn.primary").waitFor({ state: "visible", timeout: 90000 });
  await page.locator(".menu-btn.primary").click();
  const play = page.getByRole("button", { name: /^Play vs AI(?! — Conquest)/ });
  await play.waitFor({ state: "visible", timeout: 60000 });
  await play.click();
  await page.waitForFunction(() => {
    const h = window.__iso;
    return !!h && !!h.grid && h.grid.industries.length > 0 && !h.loading && /^(setup-factory|play)$/.test(h.phase);
  }, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  // stage 2: put a Factory and a crowd of Depots on the map so real models have instances
  await page.evaluate(() => {
    const h = window.__iso;
    outer: for (const t of h.grid.towns) for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
      const tx = t.tx + dx, ty = t.ty + dy;
      if (tx < 0 || ty < 0 || tx >= h.grid.w || ty >= h.grid.h) continue;
      if (h.placementPlan("factory", tx, ty).valid && h.placeFactory(tx, ty)) break outer;
    }
  });
  const cands = await page.evaluate(() => {
    const h = window.__iso, c = [];
    for (const ind of h.grid.industries) for (let dy = 0; dy <= 4; dy++) for (let dx = -2; dx <= ind.w + 1; dx++) {
      const tx = ind.tx + dx, ty = ind.ty + ind.h + dy;
      if (tx >= 0 && ty >= 0 && tx < h.grid.w && ty < h.grid.h && h.tileProbe("dirt", tx, ty).harvester.ok) c.push({ tx, ty });
    }
    return c;
  });
  // a Depot opens a tuning session over the map: skip the briefing, abandon it, then place the next
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
  let pan = null, placed = 0;
  for (const c of cands) {
    if (placed >= 20) break;
    if (await page.evaluate((c) => window.__iso.placeDepot(c.tx, c.ty), c)) { placed++; pan ??= c; await dismiss(); }
  }
  if (await page.locator("#iso-session").isVisible()) throw new Error("tuning session still covers the map");
  console.log(name, "depots placed", placed, JSON.stringify(pan));
  const town = pan ?? await page.evaluate(() => { const t = window.__iso.grid.towns[0]; return { tx: t.tx, ty: t.ty }; });
  const rows = [];
  for (const zoom of [0.5, 1, 2]) {
    // wheel over the map until the camera sits on the wanted zoom step
    for (let i = 0; i < 4 && (await page.evaluate(() => window.__iso.camera.zoom)) !== zoom; i++) {
      const cur = await page.evaluate(() => window.__iso.camera.zoom);
      await page.mouse.move(960, 540);
      await page.evaluate((dy) => { const c = [...document.querySelectorAll("canvas.iso-layer")].pop(); c.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, clientX: 960, clientY: 540, bubbles: true, cancelable: true })); }, cur < zoom ? -100 : 100);
      await page.waitForTimeout(250);
    }
    const r = await page.evaluate(async ({ town, secs }) => {
      const h = window.__iso;
      let frames = 0, worst = 0, last = performance.now();
      const t0 = last;
      let stop = false;
      const loop = (t) => { frames++; worst = Math.max(worst, t - last); last = t; if (!stop) requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      // pan diagonally across the town, there and back
      const steps = secs * 20;
      for (let i = 0; i < steps; i++) {
        const f = Math.abs(((i / steps) * 2) % 2 - 1);
        h.centerOn(town.tx - 12 + f * 24, town.ty - 12 + f * 24);
        await new Promise((r) => setTimeout(r, 50));
      }
      stop = true;
      const ms = performance.now() - t0;
      return { fps: Math.round((frames * 1000) / ms * 10) / 10, worstMs: Math.round(worst), stats: h.threeStats?.() ?? null, zoom: h.camera.zoom };
    }, { town, secs: SECS });
    rows.push({ variant: name, want: zoom, ...r });
    await page.evaluate((t) => window.__iso.centerOn(t.tx + 0.5, t.ty + 1), town); await page.waitForTimeout(800);
    await page.screenshot({ path: `tools/perf/three-spike-${name}-z${zoom}.png` });
  }
  await ctx.close();
  return rows;
}

const browser = await chromium.launch({ args: ["--use-angle=default", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
console.log("variant | zoom | fps | worstFrameMs | three.fps | drawCalls | triangles | instances | textures");
for (const [name, extra] of variants) {
  for (const r of await run(browser, name, extra)) {
    const s = r.stats;
    console.log([r.variant, r.want + "/" + r.zoom, r.fps, r.worstMs, s?.fps ?? "-", s?.drawCalls ?? "-", s?.triangles ?? "-", s?.instances ?? "-", s?.textures ?? "-"].join(" | "));
  }
}
await browser.close();
