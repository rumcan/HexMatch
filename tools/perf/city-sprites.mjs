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
await page.waitForTimeout(1500);
const r = await page.evaluate(() => { const h = window.__iso; h.grid.towns.forEach((t, i) => h.setTownLevel(i, 3)); const c = {}; for (const e of h.townDrawItems) c[e.sprite] = (c[e.sprite] ?? 0) + 1; return c; });
console.log(JSON.stringify(r));
await browser.close();
