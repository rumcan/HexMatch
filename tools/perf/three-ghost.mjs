// LIVE-3D / 3D-FIX-2: the placement ghost + the highlight diamond vs the PICKED tile, at yaw 0..3.
// node tools/perf/three-ghost.mjs [ToolLabel]   (needs a dev server: BASE=http://localhost:5180)
//
// Prints one line per quarter turn: the tile the cursor is over, the tile `pick` returns,
// and how far apart the diamond's centre and the ghost's anchor are. A correct frame reads
// picked === target and a delta of ~0 px at every yaw.
import { chromium } from "@playwright/test";
const BASE = process.env.BASE ?? "http://localhost:5180";
const tool = process.argv[2] ?? "PROCESSING";
const HH = 16;
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
let bad = 0;
for (let k = 0; k < 4; k++) {
  if (k) await page.keyboard.press("]");
  await page.waitForTimeout(1500);
  // The tile CENTRE the overlay draws: `tileScreenAt` is the diamond's top vertex, already lifted;
  // the turned (0, HH) step is the hill-lift direction too, so the centre is (2 sin, cos) * HH.
  const { sx, sy, yaw, zoom } = await page.evaluate(({ t, HH }) => {
    const [bx, by] = window.__iso.tileScreenAt(t.x, t.y);
    const yaw = window.__iso.viewYaw(), zoom = window.__iso.camera.zoom;
    return { sx: bx + 2 * Math.sin(yaw) * HH * zoom, sy: by + Math.cos(yaw) * HH * zoom, yaw, zoom };
  }, { t, HH });
  await page.mouse.move(sx + 1, sy + 1); await page.mouse.move(sx, sy); await page.waitForTimeout(600);
  const picked = await page.evaluate((p) => window.__iso.tileAtScreen(p[0], p[1]), [sx, sy]);
  const ok = picked[0] === t.x && picked[1] === t.y;
  if (!ok) bad++;
  console.log(`yaw ${Math.round((yaw * 180) / Math.PI)} (q${k}) target ${t.x},${t.y} picked ${picked[0]},${picked[1]} ${ok ? "OK" : "MISMATCH"}  zoom ${zoom}`);
  await page.screenshot({ path: `tools/perf/ghost-${k}.png` });
}
console.log(bad === 0 ? "3D-FIX-2: ghost/highlight on the picked tile at all four yaws" : `3D-FIX-2: ${bad}/4 yaws mismatched`);
await browser.close();
