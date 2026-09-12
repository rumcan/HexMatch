#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// ART-1950S / TICKET-B4 — instrumented dead-art audit.
//
// Never delete on a grep: 149 of 239 manifest sprites look "unused" as string
// literals because road/dirt bitmasks, depot_<cargo> and town-house names are
// CONSTRUCTED at runtime. This tool proves usage the only reliable way:
//
//   1. drives a REAL built game (vite preview) through a hard session —
//      factory setup, depots, plants, road drags, rival AI + economy +
//      truck ticks, and a full-map camera sweep at every zoom —
//   2. reads `__iso.drawnSprites` (the renderer's runtime record of every
//      name actually blitted; see IsoRenderer.drawnSprites),
//   3. unions that with the by-construction families (16 road/dirt bitmasks
//      ×3, depot_<cargo>, TOWN_HOUSE_VARIANTS, terrain_*, truckGoods dirs)
//      and with names still written literally in the source tree,
//   4. writes the COMPLEMENT — the deletion candidates — to a dated report
//      under docs/. DELETES NOTHING: candidates need human sign-off.
//
// Usage (needs the built game served on :4173 — `npm run build && npm run
// preview -- --port 4173 --strictPort`, or the playwright webServer does it):
//   node tools/art-audit.mjs [--url http://localhost:4173/hexmatch/?seed=79]
//   PW_CHROMIUM_EXECUTABLE=/path/to/chrome node tools/art-audit.mjs   # sandbox
// ══════════════════════════════════════════════════════════════════════════
import { chromium } from "playwright";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const URL = arg("--url", "http://localhost:4173/hexmatch/?seed=79");
const DATE = new Date().toISOString().slice(0, 10);

// ── the by-construction families (enumerate what the runtime can build) ────
const manifest = JSON.parse(readFileSync(join(root, "assets", "iso-atlas", "manifest.json"), "utf8"));
const manifestNames = Object.keys(manifest.sprites);

const BITS = Array.from({ length: 16 }, (_, i) => i.toString(2).padStart(4, "0"));
// dirt_road_#### is a BLEND mask: per direction 0 = nothing, 1 = dirt only,
// 2 = dirt with road underneath — a base-3 code, 3^4 = 81 combinations
// (see dirtSpriteName in src/iso/renderer.ts; the family count in the
// manifest is exactly 81).
const TRITS = Array.from({ length: 81 }, (_, i) => i.toString(3).padStart(4, "0"));
const constructed = new Set([
  ...BITS.map((b) => `road_${b}`),
  ...BITS.map((b) => `dirt_${b}`),
  ...TRITS.map((t) => `dirt_road_${t}`),
  ...["grain", "wood", "ore", "stone", "oil", "gold"].map((c) => `depot_${c}`),
  "terrain_grass", "terrain_rough", "terrain_water", "node_mark",
  "highlight_soft", "highlight_bad",
  ...["ne", "se", "sw", "nw"].map((d) => `truck_goods_${d}`),
]);
// TOWN_HOUSE_VARIANTS from src/iso/config.ts (the pool is the authority)
{
  const cfg = readFileSync(join(root, "src", "iso", "config.ts"), "utf8");
  const m = cfg.match(/TOWN_HOUSE_VARIANTS = \[([\s\S]*?)\]/);
  for (const [, n] of m[1].matchAll(/"([a-z0-9_]+)"/g)) constructed.add(n);
}

/** Runtime source text — src/, server/, rundot/ + index.html ONLY.
 *  Deliberately NOT tools/ (iso-atlas.cells.json DECLARES every cell — a
 *  declaration is not a use) and NOT tests/ (a test pinning a sprite's pixels
 *  keeps the test honest, it does not make the game use the art). This is the
 *  ticket's "written literally in src/" step. */
function sourceTexts() {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) {
        if (["node_modules", ".git", "dist", "assets", "test-results", "playwright-report"].includes(e)) continue;
        walk(p, depth + 1);
      } else if (/\.(ts|tsx|js|mjs|html)$/.test(e)) {
        out.push(readFileSync(p, "utf8"));
      }
    }
  };
  for (const d of ["src", "server", "rundot"]) walk(join(root, d), 0);
  out.push(readFileSync(join(root, "index.html"), "utf8"));
  return out;
}

// ── 1+2: drive a real session and collect what was blitted ─────────────────
const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE } : {}),
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleWarnings = [];
page.on("console", (m) => { const t = m.text(); if (t.includes("[")) consoleWarnings.push(t.slice(0, 160)); });
await page.addInitScript(() => localStorage.setItem("hexmatch:rival-skill", "normal"));
await page.goto(URL);
await page.getByRole("button", { name: /Play vs AI/ }).click();
await page.waitForFunction(() => {
  const h = window.__iso;
  return !!h && h.phase === "setup-factory" && !!h.grid && h.grid.industries.length > 0;
}, null, { timeout: 30000 });

// Play hard through the __iso test twins — everything the pointer path runs.
const play = await page.evaluate(() => {
  const h = window.__iso;
  const log = { factory: null, depots: [], plants: [], roads: 0, ticks: 0 };
  // setup: scan a coarse grid for a legal factory site (placeFactory also
  // seats the rival, exactly like the real setup click).
  outer:
  for (let ty = 4; ty < 140; ty += 3) {
    for (let tx = 4; tx < 140; tx += 3) {
      if (h.placeFactory(tx, ty)) { log.factory = [tx, ty]; break outer; }
    }
  }
  if (!log.factory) return log;
  h.finishSetup();
  // depots + plants: probe outward from every industry (depots want resource
  // catchment; plants want clear ground).
  for (const ind of h.grid.industries) {
    for (let d = 1; d <= 5 && log.depots.length < 6; d++) {
      for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d]]) {
        const tx = ind.tx + dx, ty = ind.ty + dy;
        if (h.placeDepot(tx, ty)) { log.depots.push([tx, ty]); break; }
      }
    }
  }
  for (let ty = 4; ty < 140 && log.plants.length < 4; ty += 5) {
    for (let tx = 4; tx < 140 && log.plants.length < 4; tx += 5) {
      if (h.placePlant(tx, ty, "you")) log.plants.push([tx, ty]);
    }
  }
  // roads: L-drags between the depot cluster and the factory (bitmask shapes
  // are covered by construction, this proves the family live).
  const from = log.depots[0] ?? log.factory;
  for (let i = 0; i < 4 && from; i++) {
    const r = h.dragBuild(i % 2 ? "road" : "dirt", from[0], from[1],
      log.factory[0] + i * 3, log.factory[1] + i, i % 2 === 0);
    if (r) log.roads++;
  }
  // let both economies run: rival AI + econ + quarry + trucks, minutes of
  // simulated time in fast forward (trucks animate → structures redraw).
  for (let i = 1; i <= 900; i++) {
    const now = i * 1000;
    h.aiTick(now);
    h.econTick(now);
    h.tick(now);
    h.truckTick(now, 1000);
    h.protestTick?.(now);
  }
  log.ticks = 900;
  log.trucks = h.trucksList.length;
  log.phase = h.phase;
  return log;
});

// camera sweep: real middle-button drags across the map at every zoom level
// (the input handler invalidates the structures pass; cam mutation would not).
const cx = 640, cy = 400;
for (const wheel of [0, -1, -1, 1, 1, 1]) {          // 1x → 0.5x → 2x → 1x
  await page.mouse.wheel(0, wheel * 120);
  await page.waitForTimeout(150);
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      await page.mouse.move(cx, cy);
      await page.mouse.down({ button: "middle" });
      // sweep target: cover the 144-tile map in 12 drags
      await page.mouse.move(cx + (gx - 1.5) * 900, cy + (gy - 1) * 700, { steps: 12 });
      await page.mouse.up({ button: "middle" });
      await page.waitForTimeout(60);
    }
  }
}
await page.waitForTimeout(400);

const observed = await page.evaluate(() => window.__iso.drawnSprites);
await browser.close();

// ── 3: union observed + constructed + literals ─────────────────────────────
const texts = sourceTexts();
const literal = new Set(manifestNames.filter((n) => texts.some((t) => t.includes(`"${n}"`))));
const used = new Set([...observed, ...constructed, ...literal]);
const candidates = manifestNames.filter((n) => !used.has(n));

// ── 4: report (NO deletion — sign-off required) ────────────────────────────
const byFamily = {};
for (const n of candidates) {
  const f = n.split("_")[0];
  (byFamily[f] ??= []).push(n);
}
const report = `# ART-1950S / TICKET-B4 — dead-art audit (${DATE})

Generated by \`node tools/art-audit.mjs\` against the built game (\`${URL}\`).
**Nothing was deleted.** Candidates need sign-off; see the method below.

## Session coverage

- factory placed at [${play.factory}] (rival auto-seated), setup finished
- ${play.depots.length} depots, ${play.plants.length} plants, ${play.roads} road drags
- 900 fast-forward ticks: aiTick + econTick + quarry + trucks${play.trucks ? ` (${play.trucks} trucks running)` : " (no trucks — no connected depot↔factory route this seed)"}
- full-map middle-drag camera sweep at 0.5× / 1× / 2×
- **${observed.length} sprite names observed blitted** (\`__iso.drawnSprites\`)

## Accounted-for (NOT candidates)

- ${constructed.size} by construction: 16 road_/dirt_/dirt_road_ bitmasks ×3,
  depot_<cargo> ×6, TOWN_HOUSE_VARIANTS ×43, terrain ×3, truck_goods ×4,
  node_mark, highlight ×2
- ${literal.size} written literally in src/tools/tests/server/rundot
- ${observed.length} observed at runtime (subset overlap with the above)

## Deletion candidates (${candidates.length} of ${manifestNames.length}) — NEED SIGN-OFF

${Object.entries(byFamily).map(([f, names]) => `### ${f} (${names.length})\n${names.map((n) => `- \`${n}\``).join("\n")}`).join("\n\n")}

## Method (why these are only CANDIDATES)

The audit unions the runtime-observed set with every by-construction family
and every literal name. The remainder are candidates, not deletions:

1. Some families are situational (protest art, MP flows) — a single seed and
   a 900-tick session does not exercise every branch.
2. \`spare_*\` cells exist as packing overflow from the TTD house sheets;
   \`factory_mt_*\` is documented legacy ("the game no longer emits them").
3. Removing a name is a two-stage change (manifest + \`npm run slice-atlas\`,
   then the source art) and moves \`iso-manifest\`/\`iso-atlas-pixels\`/
   \`iso-pp12-assets\`/\`iso-golden\` assertions — update deliberately.

Before deleting anything: re-run this audit on more seeds, add a deliberate
playtest of the branches above, and get explicit sign-off on this list.
`;

const outPath = join(root, "docs", `art-audit-${DATE}.md`);
writeFileSync(outPath, report);
console.log(`observed ${observed.length} sprites; literal ${literal.size}; constructed ${constructed.size}`);
console.log(`candidates: ${candidates.length} of ${manifestNames.length}`);
for (const [f, names] of Object.entries(byFamily)) console.log(`  ${f}: ${names.join(", ")}`);
console.log(`report → ${outPath}`);
