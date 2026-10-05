// TOWN-4.6 (#682) — PLANNED-TOWN PERF AT FOUR YAWS.
//
//   node tools/perf/planned-town-3d.mjs                 # both modes, seed 199, 3 s per yaw
//   BASE=http://localhost:5180 MODES=3d SECS=5 node tools/perf/planned-town-3d.mjs
//
// What it measures, and why it is the ticket's table: four TIER-3 PLANNED
// towns on the LARGE map (TOWN-4.1, `?size=large&layout=planned`), 1280x720,
// one fps figure per view quarter for 2D and for `?three=1`, with the 3D
// layer's own draw calls / triangles / instances / vehicles beside it. The
// budget is the handover's (docs/HANDOVER-2026-10-03-b.md): 53-59 fps at four
// yaws, so anything within 3 fps of 53 still passes.
//
// It also prints how many of the 3D items carry a `front` — the TOWN-4.6 facing
// data has to REACH the three layer before any fps number here means anything.
// A planned town should be ~100%; 0% means the plumbing, not the frame rate, is
// what is wrong.
//
// The lead runs this (agents do not install browsers): it needs a dev server on
// BASE and a real GPU — headless software raster numbers are not the budget.
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:5180";
const SEED = process.env.SEED ?? "199";
const SECS = Number(process.env.SECS ?? 3);
const YAWS = Number(process.env.YAWS ?? 4);
const MODES = (process.env.MODES ?? "2d,3d").split(",").map((m) => m.trim()).filter(Boolean);
/** docs/HANDOVER-2026-10-03-b.md: "fps 53-59 at 4 yaws vs 2D 59". */
const BUDGET_LOW = 53;
const BUDGET_HIGH = 59;

const boot = async (page, extra) => {
  await page.addInitScript(() => {
    localStorage.setItem("hexmatch:rival-skill", "normal");
    localStorage.setItem("hexmatch:tutorial", "never");
  });
  await page.goto(`${BASE}/?seed=${SEED}&size=large&layout=planned${extra}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.locator(".menu-btn.primary").waitFor({ state: "visible", timeout: 90000 });
  await page.locator(".menu-btn.primary").click();
  const play = page.getByRole("button", { name: /^Play vs AI(?! — Conquest)/ });
  await play.waitFor({ state: "visible", timeout: 60000 });
  await play.click();
  await page.waitForFunction(() => {
    const h = window.__iso;
    return !!h && !!h.grid && h.grid.industries.length > 0 && !h.loading && /^(setup-factory|play)$/.test(h.phase);
  }, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  // The game needs a factory before it leaves the setup phase.
  await page.evaluate(() => {
    const h = window.__iso;
    outer: for (const t of h.grid.towns) for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
      const tx = t.tx + dx, ty = t.ty + dy;
      if (h.placementPlan("factory", tx, ty).valid && h.placeFactory(tx, ty)) break outer;
    }
  });
  // TOWN-4.6: every town to tier 3 — the epic's density target, and the heaviest
  // thing a planned town can draw.
  const towns = await page.evaluate(() => {
    const h = window.__iso;
    // `setTownLevel` takes the town's ID (L17's debug door), which is the town's
    // index in map order — the ticket's `forEach((t, i) => ...(i, 3))` works,
    // but `t.id` is what the door names and stays right if that ever parts.
    h.grid.towns.forEach((t) => h.setTownLevel(t.id, 3));
    return h.grid.towns.length;
  });
  await page.waitForTimeout(2500);
  // Park the camera on the town with the most planned lots, and report what the
  // world actually drew (towns, draw items, and how many carry a front).
  const world = await page.evaluate(() => {
    const h = window.__iso, g = h.grid;
    let best = g.towns[0];
    for (const t of g.towns) if ((t.plan?.blocks?.length ?? 0) > (best.plan?.blocks?.length ?? 0)) best = t;
    h.lookAt(best.tx, best.ty, 1);
    // `__iso.threeItems` are the LIVE ThreeItems (sprite/tx/ty/w/h/lift/front);
    // `__iso.townDrawItems` is a read-only projection WITHOUT `front`, so the
    // facing count can only come from the former.
    const three = h.threeItems ?? [];
    const byFront = {};
    for (const e of three) if (e.front) byFront[e.front] = (byFront[e.front] ?? 0) + 1;
    return {
      towns: g.towns.length,
      planned: g.towns.filter((t) => !!t.plan).length,
      tiers: g.towns.map((t) => t.level ?? -1),
      townItems: (h.townDrawItems ?? []).length,
      threeItems: three.length,
      threeItemsWithFront: three.filter((e) => !!e.front).length,
      frontSides: byFront,
      at: [best.tx, best.ty],
    };
  });
  await page.waitForTimeout(1200);
  return { towns, ...world };
};

const measure = (page, secs) => page.evaluate(async (s) => {
  const h = window.__iso;
  let frames = 0, worst = 0, last = performance.now();
  const t0 = last;
  let stop = false;
  const loop = (t) => { frames++; worst = Math.max(worst, t - last); last = t; if (!stop) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  await new Promise((r) => setTimeout(r, s * 1000));
  stop = true;
  return {
    fps: Math.round((frames * 1000) / (performance.now() - t0)),
    worstMs: Math.round(worst),
    yawDeg: Math.round((h.viewYaw() * 180) / Math.PI),
    three: h.threeStats?.() ?? null,
  };
}, secs);

const rows = [];
for (const mode of MODES) {
  const extra = mode === "3d" ? "&three=1" : "";
  const browser = await chromium.launch({ args: ["--use-angle=default", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERR", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.log("CON", m.text().slice(0, 200)); });
  const world = await boot(page, extra);
  console.log(`\n### ${mode} — ${world.towns} towns (${world.planned} planned), tiers ${JSON.stringify(world.tiers)}`);
  console.log(`    town draw items ${world.townItems} \u00b7 3D items ${world.threeItems} (${world.threeItemsWithFront} with a front) ${JSON.stringify(world.frontSides)}`);
  for (let k = 0; k < YAWS; k++) {
    if (k) { await page.keyboard.press("]"); await page.waitForTimeout(1200); }
    const r = await measure(page, SECS);
    const s = r.three;
    const fps = r.fps;
    const verdict = fps >= BUDGET_LOW - 3 ? "ok" : "OVER BUDGET";
    rows.push({ mode, yaw: r.yawDeg, fps, verdict, worstMs: r.worstMs, calls: s?.drawCalls ?? null, tris: s?.triangles ?? null, inst: s?.instances ?? null, veh: s?.vehicles ?? null });
    console.log(`    yaw ${String(r.yawDeg).padStart(3)}  fps ${String(fps).padStart(3)}  worst ${String(r.worstMs).padStart(3)} ms` +
      (s ? `  calls ${s.drawCalls}  tris ${s.triangles}  instances ${s.instances}  vehicles ${s.vehicles}` : "  (2D: no three stats)") +
      `   ${verdict}`);
    await page.screenshot({ path: `tools/perf/planned-town-${mode}-${k}.png` });
  }
  await browser.close();
}

console.log("\n| mode | yaw | fps | worst frame | draw calls | triangles | instances | vehicles | budget (53-59, -3) |");
console.log("|---|--:|--:|--:|--:|--:|--:|--:|---|");
for (const r of rows) {
  console.log(`| ${r.mode} | ${r.yaw}° | ${r.fps} | ${r.worstMs} ms | ${r.calls ?? "—"} | ${r.tris ?? "—"} | ${r.inst ?? "—"} | ${r.veh ?? "—"} | ${r.verdict} |`);
}
