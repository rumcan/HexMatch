import { chromium } from "@playwright/test";
import sharp from "sharp";
const b = await chromium.launch({ args: ["--use-angle=default", "--ignore-gpu-blocklist"] });
const page = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
await page.addInitScript(() => { localStorage.setItem("hexmatch:rival-skill", "normal"); localStorage.setItem("hexmatch:tutorial", "never"); });
await page.goto("http://localhost:5180/?seed=199&three=1&models=none", { waitUntil: "domcontentloaded", timeout: 180000 });
await page.locator(".menu-btn.primary").click();
await page.getByRole("button", { name: /^Play vs AI(?! — Conquest)/ }).click();
await page.waitForFunction(() => window.__iso?.grid?.industries.length > 0 && !window.__iso.loading, null, { timeout: 120000 });
await page.waitForTimeout(1500);
const info = await page.evaluate(async () => {
  const g = window.__iso.grid, t = g.towns[0];
  window.__iso.centerOn(t.tx + 4, t.ty + 4);
  await new Promise((r) => setTimeout(r, 500));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "]" }));
  await new Promise((r) => setTimeout(r, 3000));
  const cam = window.__iso.camera;
  // water tiles within 14 tiles of the pivot
  const W = g.w ?? 144, out = [];
  for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) {
    const x = t.tx + 4 + dx, y = t.ty + 4 + dy;
    if (x < 0 || y < 0 || x >= W || y >= W) continue;
    if (g.terrain[y * W + x] === 1) out.push([x, y]);
  }
  return { cam: { ...cam }, water: out.slice(0, 400), pivot: [t.tx + 4, t.ty + 4] };
});
console.log("water tiles near pivot:", info.water.length);
const buf = await page.screenshot();
const { data, info: im } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
const c = Math.cos(Math.PI / 2), s = Math.sin(Math.PI / 2);
let blue = 0, n = 0, blueUn = 0;
for (const [i, j] of info.water) {
  const wx = (i - j) * 32 + 16 * 0, wy = (i + j) * 16 + 16;   // tile centre, flat
  // rotated: tile centre lattice (i+.5, j+.5)
  const ti = i + 0.5, tj = j + 0.5;
  const ri = ti * c + tj * s, rj = -ti * s + tj * c;
  const sx = Math.round((ri - rj) * 32 * info.cam.zoom + info.cam.x), sy = Math.round((ri + rj) * 16 * info.cam.zoom + info.cam.y);
  if (sx < 100 || sx > 1600 || sy < 80 || sy > 1000) continue;
  const k = (sy * im.width + sx) * im.channels; n++;
  const r = data[k], g = data[k + 1], bl = data[k + 2];
  if (bl > r + 25 && bl > 70) blue++;
}
console.log("on-screen water tiles", n, "of which the pixel there is blue:", blue);
await b.close();
