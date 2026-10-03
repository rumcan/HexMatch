// LIVE-3D: placement ghost + highlight alignment at yaw 0..3.  node tools/perf/three-ghost.mjs [ToolLabel]
import { chromium } from "@playwright/test";
const BASE = process.env.BASE ?? "http://localhost:5180";
const tool = process.argv[2] ?? "PROCESSING";
const browser = await chromium.launch({ args: ["--use-angle=default", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
await page.addInitScript(() => { localStorage.setItem("hexmatch:rival-skill", "normal"); localStorage.setItem("hexmatch:tutorial", "never"); });
await page.goto(`${BASE}/?seed=199&three=1`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.locator(".menu-btn.primary").click();
const play = page.getByRole("button", { name: /^Play vs AI(?! — Conquest)/ });
await play.waitFor({ state: "visible", timeout: 60000 }); await play.click();
await page.waitForFunction(() => { const h = window.__iso; return !!h && !!h.grid && h.grid.industries.length > 0 && !h.loading && /^(setup-factory|play)$/.test(h.phase); }, null, { timeout: 120000 });
await page.waitForTimeout(2000);
const t = await page.evaluate(() => { const g = window.__iso.grid.towns[0]; return { x: g.tx + 8, y: g.ty + 12 }; });
await page.evaluate((t) => window.__iso.lookAt(t.x, t.y, 1), t);
await page.getByText(new RegExp(tool, "i")).first().click();
for (let k = 0; k < 4; k++) {
  if (k) await page.keyboard.press("]");
  await page.waitForTimeout(1500);
  const [bx, by] = await page.evaluate((t) => window.__iso.tileScreenAt(t.x, t.y), t);
  const yw = await page.evaluate(() => window.__iso.viewYaw()), zz = await page.evaluate(() => window.__iso.camera.zoom);
  const sx = bx + 2 * Math.sin(yw) * 16 * zz, sy = by + Math.cos(yw) * 16 * zz - 17;
  await page.mouse.move(sx + 1, sy + 18); await page.mouse.move(sx, sy + 17); await page.waitForTimeout(600);
  console.log(k, JSON.stringify(await page.evaluate((p) => window.__iso.tileAtScreen(p[0], p[1]), [sx, sy + 17])), JSON.stringify(t));
  await page.screenshot({ path: `tools/perf/ghost-${k}.png` });
}
await browser.close();
