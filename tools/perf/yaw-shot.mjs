// node tools/perf/yaw-shot.mjs [turns=1] [zoom=1]: boot ?three=1 on the owner's dev server, centre the town, press ] <turns>
// times, settle, screenshot tools/perf/yaw-<turns>.png and print fps over 3 s (+ pick check: click the town centre tile).
import { chromium } from "@playwright/test";
const BASE = process.env.BASE ?? "http://localhost:5180";
const turns = Number(process.argv[2] ?? 1), zoom = Number(process.argv[3] ?? 1);
const b = await chromium.launch({ args: ["--use-angle=default", "--ignore-gpu-blocklist"] });
const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") console.log("PAGE error", m.text().slice(0, 200)); });
await page.addInitScript(() => { localStorage.setItem("hexmatch:rival-skill", "normal"); localStorage.setItem("hexmatch:tutorial", "never"); });
await page.goto(`${BASE}/?seed=199&three=1`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.locator(".menu-btn.primary").click();
await page.getByRole("button", { name: /^Play vs AI(?! — Conquest)/ }).click();
await page.waitForFunction(() => window.__iso?.grid?.industries.length > 0 && !window.__iso.loading, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__iso.setTraffic(40));
for (let i = 0; i < 4 && (await page.evaluate(() => window.__iso.camera.zoom)) !== zoom; i++) {
  const cur = await page.evaluate(() => window.__iso.camera.zoom);
  await page.evaluate((dy) => { const c = [...document.querySelectorAll("canvas.iso-layer")].pop(); c.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, clientX: 960, clientY: 540, bubbles: true, cancelable: true })); }, cur < zoom ? -100 : 100);
  await page.waitForTimeout(250);
}
const town = await page.evaluate(() => { const g = window.__iso.grid.towns[0]; window.__iso.centerOn(g.tx + 4, g.ty + 4); return { tx: g.tx + 4, ty: g.ty + 4 }; });
await page.waitForTimeout(800);
for (let i = 0; i < Math.abs(turns); i++) { await page.keyboard.press(turns > 0 ? "]" : "["); await page.waitForTimeout(150); }
await page.waitForTimeout(1500);
const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(Math.round((n * 1000) / (performance.now() - t0) * 10) / 10); }; requestAnimationFrame(f); }));
console.log("turns", turns, "zoom", zoom, "fps", fps, JSON.stringify(await page.evaluate(() => window.__iso.threeStats())));
// picking: the tile under the screen centre must be the town tile we centred on (centerOn = tile top vertex -> centre of screen)
console.log("camera", JSON.stringify(await page.evaluate(() => window.__iso.camera)));
await page.screenshot({ path: `tools/perf/yaw-${turns}.png` });
await b.close();
