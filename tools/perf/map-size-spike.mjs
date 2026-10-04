// ══════════════════════════════════════════════════════════════════════════
// TOWN-4.1 (#677) — map-size perf spike: standard (144) vs large (216), one seed.
//
// Two modes.
//
// 1. BROWSER (the gate; needs a dev server and a Playwright Chromium):
//
//      npx playwright install chromium            # once, if no browser yet
//      npx vite --port 5179 --strictPort          # 2nd Vite: RUNDOT_DEV_ROOM_PORT=9011
//      BASE=http://localhost:5179 node tools/perf/map-size-spike.mjs
//
//    For each size it opens a fresh 1280×720 context, boots free play through
//    the menu (Play → Play vs AI) on `?seed=SEED&size=<size>` and records:
//      • boot — "Play vs AI" click → first interactive frame (loading screen
//        gone, phase setup-factory|play, two more frames painted);
//      • heap — JS heap after a forced GC (CDP), right after boot;
//      • fps over SECS (5) s at zoom 1, camera parked at the MAP CENTRE, then
//        over TOWN 0 (static camera; rAF count, worst frame, p95 frame);
//      • AI tick — `__iso.aiTick(now)` timed over 40 calls, `now` stepped
//        750 ms, after the seat has placed its Factory + Depot (so the rival
//        is really planning, not idling in setup).
//    GATE (epic #676 §3): large may cost ≤ 3 fps (either view) and ≤ 400 ms
//    boot against standard. If it fails, the 216 run is repeated at 192 by
//    re-serving src/game/config.ts with `large: 192` (dev server only — the
//    route rewrite needs unbundled modules), and both are reported.
//    Note: `?three=1` (the live-3D spike) is NOT on main, so only the 2D
//    renderer (with the GL terrain the player has on by default) is measured.
//
//    Env: BASE (http://localhost:5179), SEED (1337), SECS (5),
//         SIZES ("standard,large"), FORCE192=1 (run 192 even if the gate
//         passes), OUT (JSON report path, default /tmp/map-size-spike.json).
//
// 2. NODE (no browser, no server):  node --expose-gc tools/perf/map-size-spike.mjs --node
//
//    Bundles the generator and the boot-time pure-JS stages with esbuild and
//    times them at 144 / 192 / 216 on the same seed with the shipped map
//    options: generateMap, the scenery scatter, track + public roads, the
//    terrain-GL mesh / distance-field / erosion bakes, the minimap ground,
//    the bird pool, the junction signals, the rival's factory-spot search and
//    one uncached rival plan, plus the network flood and the ★ rescore that
//    run on every track change. Median of REPS (5) runs per stage, and the
//    heap the built world holds. These are the area-scaling CPU costs; the
//    browser mode is what the gate is decided on.
// ══════════════════════════════════════════════════════════════════════════
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SEED = Number(process.env.SEED ?? 1337);

if (process.argv.includes("--node")) await nodeMode();
else await browserMode();

// ── node mode ──────────────────────────────────────────────────────────────
async function nodeMode() {
  const esbuild = await import("esbuild");
  const REPS = Number(process.env.REPS ?? 5);
  const entry = `
    export { MAP_W, MAP_H, setMapSize, releaseMapSize } from "./src/game/config";
    export { generateMap } from "./src/iso/grid";
    export { scatterScenery } from "./src/iso/scenery";
    export { createTrack, seedTownRoads, seedPublicRoads } from "./src/iso/track";
    export { createRailState } from "./src/iso/rail";
    export { terrainMapInput } from "./src/iso/terrain-gl-adapter";
    export { buildTerrainMesh, buildFields, buildErosionField } from "./src/iso/terrain-gl/mesh";
    export { terrainColours } from "./src/iso/minimap";
    export { createBirds } from "./src/iso/birds";
    export { buildSignals } from "./src/iso/ambience";
    export { chooseRivalFactorySpot, planCandidates } from "./src/iso/ai";
    export { buildAllComponents } from "./src/iso/economy";
    export { createScoreState, rescore } from "./src/iso/victory";
  `;
  const out = await esbuild.build({
    stdin: { contents: entry, resolveDir: ROOT, loader: "ts", sourcefile: "map-size-spike-entry.ts" },
    bundle: true, platform: "node", format: "esm", target: "node20", write: false, logLevel: "error",
    loader: Object.fromEntries([".png", ".jpg", ".webp", ".svg", ".mp3", ".ogg", ".wav", ".woff2", ".css"].map((e) => [e, "empty"])),
    define: {
      "import.meta.env": JSON.stringify({ MODE: "production", DEV: false, PROD: true, BASE_URL: "/" }),
      // Vite-only asset globs (terrain textures): nothing to load in node.
      "import.meta.glob": "__viteGlobStub",
    },
    banner: { js: "const __viteGlobStub = () => ({});" },
  });
  const file = path.join(os.tmpdir(), `map-size-spike-${process.pid}.mjs`);
  fs.writeFileSync(file, out.outputFiles[0].text);
  const m = await import(pathToFileURL(file).href);

  const SHIPPED = { rivers: true, elevation: true, shapes: true, rings: true, layout: "organic" };
  // Mirrored from src/iso/game.ts (START_PURSE, FREE_SETUP_TRACK) and
  // construction.ts (FREE_SETUP_DEPOTS): the rival's opening allowance. Equal
  // at every size, so they cannot tilt the comparison.
  const PURSE = { wood: 12, stone: 12, ore: 0 };
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const time = (fn) => { const t = performance.now(); const v = fn(); return [performance.now() - t, v]; };
  const gc = () => { if (typeof global.gc === "function") { global.gc(); global.gc(); } };

  const sides = (process.env.SIDES ?? "144,192,216").split(",").map(Number);
  /** One full pass of the area-scaling boot stages at `side`; returns stage → ms and the world. */
  // SEEDS (comma list) spreads the samples over several maps: a map's cost
  // depends on its seed (placement retries), not only on its size.
  const seeds = (process.env.SEEDS ?? String(SEED)).split(",").map(Number);
  const pass = (side, seed = seeds[0]) => {
    m.releaseMapSize();
    m.setMapSize(side, side);
    const t = {};
    const [gen, grid] = time(() => m.generateMap(seed, SHIPPED));
    t["generateMap (shipped options)"] = gen;
    const [sc, scenery] = time(() => m.scatterScenery(grid));
    t["scatterScenery"] = sc;
    const [tr, track] = time(() => {
      const tk = m.createTrack(true);
      m.seedTownRoads(tk, grid);
      m.seedPublicRoads(tk, grid);
      m.createRailState();
      return tk;
    });
    t["track + public roads + rail"] = tr;
    const [tg, terrain] = time(() => {
      const input = m.terrainMapInput(grid, grid.seed);
      return { mesh: m.buildTerrainMesh(input), fields: m.buildFields(input), ground: m.buildErosionField(input) };
    });
    t["terrain-GL mesh + fields + erosion bake"] = tg;
    const [mm, mini] = time(() => m.terrainColours({ terrain: grid.terrain, trees: scenery.trees, forests: scenery.forests }));
    t["minimap ground"] = mm;
    const [bp, birds] = time(() => m.createBirds(grid, scenery.fields.filter((f) => f.sprite === "wheat_field")));
    t["bird pool"] = bp;
    t["junction signals"] = time(() => m.buildSignals(track, grid, grid.seed))[0];
    const eco = { grid, track, harvesters: [], factories: [], rail: m.createRailState(), dams: [] };
    const [sp, spot] = time(() => m.chooseRivalFactorySpot(grid, track, [side >> 1, side >> 1], {
      purse: PURSE, free: 12, freeDepots: 1, ownerId: 2,
    }));
    t["AI: rival factory-spot search (on the opening Factory click)"] = sp;
    if (spot) {
      const factory = { owner: "ai", ownerId: 2, tx: spot[0], ty: spot[1], id: 0, townId: null };
      eco.factories.push(factory);
      t["AI: one uncached rival plan"] = time(() => m.planCandidates(eco, factory, {
        stock: {}, purse: PURSE, free: 12, freeDepots: 1, depotTier: 0, newLoop: true,
      }))[0];
    }
    t["network flood (per track change)"] = time(() => m.buildAllComponents(track, 2))[0];
    t["★ rescore (per track change)"] = time(() => m.rescore(eco, m.createScoreState()))[0];
    return { t, world: { grid, scenery, track, terrain, mini, birds, eco } };
  };
  // A discarded warm-up pass per size (the JIT would otherwise bill the first
  // size measured for compiling everything), then REPS passes with the sizes
  // interleaved, so drift and GC pressure land on every size alike.
  for (const side of sides) pass(side);
  const samples = Object.fromEntries(sides.map((s) => [s, {}]));
  const bootSums = Object.fromEntries(sides.map((s) => [s, {}]));
  const BOOT_STAGES = ["generateMap (shipped options)", "scatterScenery", "track + public roads + rail",
    "terrain-GL mesh + fields + erosion bake", "minimap ground", "bird pool", "junction signals"];
  for (const seed of seeds) {
    for (let r = 0; r < REPS; r++) {
      for (const side of sides) {
        const { t } = pass(side, seed);
        for (const [k, ms] of Object.entries(t)) (samples[side][k] ??= []).push(ms);
        (bootSums[side][seed] ??= []).push(BOOT_STAGES.reduce((a, k) => a + (t[k] ?? 0), 0));
      }
    }
  }
  const rows = Object.fromEntries(sides.map((s) => [s, Object.fromEntries(
    Object.entries(samples[s]).map(([k, v]) => [k, median(v)]))]));
  // What a built world holds: JS heap PLUS the typed arrays' backing stores
  // (off-heap — `heapUsed` alone misses every map layer).
  const mem = () => { const u = process.memoryUsage(); return u.heapUsed + u.arrayBuffers; };
  const heap = {};
  for (const side of sides) {
    gc();
    const before = mem();
    let keep = pass(side).world;
    gc();
    heap[side] = (mem() - before) / 1048576;
    keep = null;
    void keep;
  }
  m.releaseMapSize();
  fs.rmSync(file, { force: true });

  const keys = Object.keys(rows[sides[0]]);
  const head = `| stage (median of ${REPS * seeds.length}, ms) | ${sides.map((s) => `${s}²`).join(" | ")} | ${sides.at(-1)}/${sides[0]} |`;
  console.log(`\nNode ${process.version}, seed${seeds.length > 1 ? "s" : ""} ${seeds.join(", ")}, shipped options (rivers, elevation, shapes, rings, organic)\n`);
  console.log(head);
  console.log(`|${"---|".repeat(sides.length + 2)}`);
  let totals = sides.map(() => 0);
  for (const k of keys) {
    const vals = sides.map((s) => rows[s][k] ?? 0);
    totals = totals.map((a, i) => a + vals[i]);
    console.log(`| ${k} | ${vals.map((v) => v.toFixed(1)).join(" | ")} | ×${(vals.at(-1) / Math.max(1e-6, vals[0])).toFixed(2)} |`);
  }
  console.log(`| **sum** | ${totals.map((v) => `**${v.toFixed(0)}**`).join(" | ")} | ×${(totals.at(-1) / totals[0]).toFixed(2)} |`);
  console.log(`| memory held by the built world, heap + typed arrays (MB${typeof global.gc === "function" ? "" : ", no --expose-gc: noisy"}) | ${sides.map((s) => heap[s].toFixed(1)).join(" | ")} | ×${(heap[sides.at(-1)] / heap[sides[0]]).toFixed(2)} |`);
  // The boot path alone (what stands between "Play" and the first frame in
  // JS), per seed — the part of the 400 ms boot budget the CPU spends.
  console.log(`\n| boot-path JS (${BOOT_STAGES.length} stages above, median ms) | ${sides.map((s) => `${s}²`).join(" | ")} | Δ ${sides.at(-1)} − ${sides[0]} |`);
  console.log(`|${"---|".repeat(sides.length + 2)}`);
  for (const seed of seeds) {
    const v = sides.map((s) => median(bootSums[s][seed]));
    console.log(`| seed ${seed} | ${v.map((x) => x.toFixed(0)).join(" | ")} | ${(v.at(-1) - v[0]) >= 0 ? "+" : ""}${(v.at(-1) - v[0]).toFixed(0)} |`);
  }
  const report = { mode: "node", node: process.version, seeds, reps: REPS, rows, heapMB: heap, bootSums };
  fs.writeFileSync(process.env.OUT ?? "/tmp/map-size-spike-node.json", JSON.stringify(report, null, 2));
}

// ── browser mode ───────────────────────────────────────────────────────────
async function browserMode() {
  const { chromium } = await import("@playwright/test");
  const BASE = process.env.BASE ?? "http://localhost:5179";
  const SECS = Number(process.env.SECS ?? 5);
  const SIZES = (process.env.SIZES ?? "standard,large").split(",");

  const browser = await chromium.launch({
    args: ["--enable-precise-memory-info", "--use-angle=default", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
  });

  /** Boot one size (optionally with large re-served as `side192`) and measure. */
  async function run(size, side192 = false) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => {
      localStorage.setItem("hexmatch:onboarded", "1");
      localStorage.setItem("hexmatch:rival-skill", "normal");
      localStorage.setItem("hexmatch:tutorial", "never");
    });
    if (side192) {
      await ctx.route(/\/src\/game\/config\.ts(\?.*)?$/, async (route) => {
        const resp = await route.fetch();
        const body = (await resp.text()).replace(/large:\s*216/, "large: 192");
        await route.fulfill({ response: resp, body });
      });
    }
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await page.goto(`${BASE}/?seed=${SEED}&size=${size}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.locator(".menu-btn.primary").first().waitFor({ state: "visible", timeout: 120_000 });
    await page.locator(".menu-btn.primary").first().click();
    const play = page.getByRole("button", { name: /^Play vs AI(?! — Conquest)/ });
    await play.waitFor({ state: "visible", timeout: 60_000 });
    await page.evaluate(() => { window.__spikeT0 = performance.now(); });
    await play.click();
    await page.waitForFunction(() => {
      const h = window.__iso;
      return !!h && !!h.grid && h.grid.industries.length > 0 && !h.loading && /^(setup-factory|play)$/.test(h.phase);
    }, null, { timeout: 180_000 });
    const bootMs = await page.evaluate(() => new Promise((res) =>
      requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now() - window.__spikeT0)))));
    const mapSize = await page.evaluate(() => window.__iso.mapSize);
    await cdp.send("HeapProfiler.collectGarbage");
    const heapMB = (await cdp.send("Runtime.getHeapUsage")).usedSize / 1048576;

    // Seat the player (Factory + Depot, setup finished) so the rival plans for real.
    await page.evaluate(() => {
      const h = window.__iso;
      const near = (cx, cy, kind, r0 = 22) => {
        for (let r = 1; r <= r0; r++) {
          for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
            if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
            if (h.placementPlan(kind, x, y).valid) return [x, y];
          }
        }
        return null;
      };
      for (const t of h.grid.towns) { const f = near(t.tx, t.ty, "factory"); if (f && h.placeFactory(f[0], f[1])) break; }
      for (const ind of h.grid.industries) { const d = near(ind.tx, ind.ty, "depot", 6); if (d && h.placeDepot(d[0], d[1])) break; }
      h.finishSetup?.();
    });
    for (let i = 0; i < 6 && (await page.locator("#iso-session").isVisible().catch(() => false)); i++) {
      const win = page.locator("#iso-session");
      const skip = win.getByRole("button", { name: /Skip/ });
      if (await skip.count() && await skip.first().isVisible()) await skip.first().click();
      const ab = win.locator(".tp-abandon");
      if (await ab.count() && await ab.first().isVisible()) await ab.first().click();
      await page.waitForTimeout(300);
    }
    // Zoom 1 (wheel over the map until the camera sits on it).
    for (let i = 0; i < 6 && (await page.evaluate(() => window.__iso.camera.zoom)) !== 1; i++) {
      const cur = await page.evaluate(() => window.__iso.camera.zoom);
      await page.evaluate((dy) => {
        const c = [...document.querySelectorAll("canvas.iso-layer")].pop() ?? document.querySelector("canvas");
        c?.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, clientX: 640, clientY: 360, bubbles: true, cancelable: true }));
      }, cur < 1 ? -100 : 100);
      await page.waitForTimeout(250);
    }
    const fpsAt = async (tx, ty) => {
      await page.evaluate(([x, y]) => window.__iso.centerOn(x, y), [tx, ty]);
      await page.waitForTimeout(1500);   // let the chunk caches fill
      return page.evaluate((secs) => new Promise((res) => {
        const gaps = [];
        let last = performance.now();
        const t0 = last;
        const loop = (t) => {
          gaps.push(t - last); last = t;
          if (t - t0 < secs * 1000) requestAnimationFrame(loop);
          else {
            const sorted = [...gaps].sort((a, b) => a - b);
            res({
              fps: Math.round((gaps.length * 1000) / (t - t0) * 10) / 10,
              worstMs: Math.round(sorted.at(-1)),
              p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
              zoom: window.__iso.camera.zoom,
            });
          }
        };
        requestAnimationFrame(loop);
      }), SECS);
    };
    const centre = await fpsAt(mapSize.w / 2, mapSize.h / 2);
    const t0 = await page.evaluate(() => { const t = window.__iso.grid.towns[0]; return [t.tx, t.ty]; });
    const town = await fpsAt(t0[0], t0[1]);
    const ai = await page.evaluate(() => {
      const h = window.__iso;
      const times = [];
      let now = performance.now();
      for (let i = 0; i < 40; i++) {
        now += 750;
        const t = performance.now();
        h.aiTick(now);
        times.push(performance.now() - t);
      }
      const s = [...times].sort((a, b) => a - b);
      const r = (v) => Math.round(v * 100) / 100;
      return { meanMs: r(times.reduce((a, b) => a + b, 0) / times.length), p50Ms: r(s[20]), p95Ms: r(s[38]), maxMs: r(s[39]) };
    });
    await ctx.close();
    return { size: side192 ? "192 (large re-served)" : size, side: mapSize.w, bootMs: Math.round(bootMs), heapMB: Math.round(heapMB * 10) / 10, centre, town, ai };
  }

  const results = [];
  for (const size of SIZES) results.push(await run(size));
  const std = results.find((r) => r.side === 144);
  const big = results.find((r) => r.side === 216);
  const gate = (a, b) => (!a || !b ? null : {
    fpsCentreDelta: Math.round((a.centre.fps - b.centre.fps) * 10) / 10,
    fpsTownDelta: Math.round((a.town.fps - b.town.fps) * 10) / 10,
    bootDeltaMs: b.bootMs - a.bootMs,
    pass: a.centre.fps - b.centre.fps <= 3 && a.town.fps - b.town.fps <= 3 && b.bootMs - a.bootMs <= 400,
  });
  const g216 = gate(std, big);
  let g192 = null;
  if (std && (process.env.FORCE192 === "1" || (g216 && !g216.pass))) {
    const r192 = await run("large", true);
    results.push(r192);
    g192 = gate(std, r192);
  }
  await browser.close();

  console.log(`\nseed ${SEED}, 1280×720, dpr 1, zoom 1, ${SECS}s per view, base ${BASE}\n`);
  console.log("| size | side | boot ms | heap MB | fps centre (p95 / worst ms) | fps town (p95 / worst ms) | AI tick mean / p95 / max ms |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of results) {
    console.log(`| ${r.size} | ${r.side} | ${r.bootMs} | ${r.heapMB} | ${r.centre.fps} (${r.centre.p95Ms} / ${r.centre.worstMs}) | ${r.town.fps} (${r.town.p95Ms} / ${r.town.worstMs}) | ${r.ai.meanMs} / ${r.ai.p95Ms} / ${r.ai.maxMs} |`);
  }
  const say = (label, g) => g && console.log(`\nGATE ${label}: fps Δ centre ${g.fpsCentreDelta}, town ${g.fpsTownDelta} (≤ 3); boot Δ ${g.bootDeltaMs} ms (≤ 400) → ${g.pass ? "PASS" : "FAIL"}`);
  say("216 vs 144", g216);
  say("192 vs 144", g192);
  fs.writeFileSync(process.env.OUT ?? "/tmp/map-size-spike.json", JSON.stringify({ seed: SEED, base: BASE, results, gate216: g216, gate192: g192 }, null, 2));
}
