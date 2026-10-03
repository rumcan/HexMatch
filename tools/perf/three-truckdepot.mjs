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
const dep = await page.evaluate(() => { const h = window.__iso; for (const ind of h.grid.industries) for (let dy = -3; dy <= ind.h + 1; dy++) for (let dx = -3; dx <= ind.w + 1; dx++) { try { if (h.placeDepot(ind.tx + dx, ind.ty + dy)) return { x: ind.tx + dx, y: ind.ty + dy }; } catch (e) {} } return null; });
console.log("depot", JSON.stringify(dep));
await page.locator(".tc-skip").first().click(); await page.waitForTimeout(1200); await page.locator(".tp-finish").first().click(); await page.waitForTimeout(800); await page.getByRole("button", { name: /Confirm/ }).first().click(); await page.waitForTimeout(800); console.log("sess", await page.locator("#iso-session").isVisible(), JSON.stringify(await page.evaluate(()=>window.__iso.harvesters.map(h=>[h.tx,h.ty,h.facing]))));
const mode = EXTRA.includes("three") ? "3d" : "2d";
await page.evaluate((c) => window.__iso.lookAt(c.x + 1, c.y + 1, 2), dep);
const yaws = (process.env.YAWS ?? "0").split(",").map(Number);
for (const f of ["ne", "se", "sw", "nw"]) {
  await page.evaluate((f) => { window.__iso.harvesters[0].facing = f; window.__iso.lookAt(window.__iso.harvesters[0].tx + 1, window.__iso.harvesters[0].ty + 1, 2); }, f);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `tools/perf/td-${mode}-${f}.png`, clip: { x: 300, y: 150, width: 500, height: 400 } });
}
await browser.close();
