#!/usr/bin/env node
// ART-3D (#504) step 3 — render a Meshy model into a building sprite.
//
//   node tools/meshy/render.mjs <name> [--turn 0|1|2|3|all] [--r] [--fill 0.92]
//        [--sun 1.1] [--ambient 2.8] [--yaw <deg>] [--footprint WxH]
//
// Reads tools/art-src/meshy/<name>/model.glb and writes
// tools/art-src/meshy/<name>/render_t<turn>[_r]@2x.png on the authoring
// canvas contract (docs/building-layers.md, overhang form): the footprint
// diamond pinned to the canvas bottom, anchor = footprint centre at
// (W/2, H − (w+h)·16). `make-building-pngs.mjs` trims and tiers it.
//
// One camera for everything: orthographic 2:1 isometric (30° elevation),
// 12 m tiles (7.54 px/m at 2×, so a 2.1 m door is ~14 px), one sun from the
// upper left. The model is squared to the grid by its minimum-area plan,
// turned by `--turn` quarter turns (which face is the front), and fitted
// uniformly to its footprint. `--r` renders the other orientation for real
// (footprint swapped, one more quarter turn) — no mirroring, so the light
// stays on the SW wall. `--turn all` writes a 4-up contact sheet to choose
// the front from.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import sharp from "sharp";
import { chromium } from "playwright";

const ROOT = process.cwd();
const OUT = "tools/art-src/meshy";

function parseArgs(argv) {
  const o = { names: [], turn: "0", r: false, fill: 0.92, sun: 1.1, ambient: 2.8, yaw: null, footprint: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--turn") o.turn = argv[++i];
    else if (a === "--r") o.r = true;
    else if (a === "--fill") o.fill = Number(argv[++i]);
    else if (a === "--sun") o.sun = Number(argv[++i]);
    else if (a === "--ambient") o.ambient = Number(argv[++i]);
    else if (a === "--yaw") o.yaw = Number(argv[++i]);
    else if (a === "--footprint") o.footprint = argv[++i].split("x").map(Number);
    else o.names.push(a);
  }
  return o;
}

function footprintOf(name) {
  const m = JSON.parse(fs.readFileSync("assets/buildings/manifest.json", "utf8"));
  const sprites = m.sprites ?? m;
  const fp = sprites[name]?.footprint;
  if (!fp) throw new Error(`${name}: no footprint in assets/buildings/manifest.json (pass --footprint WxH)`);
  return fp;
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".glb": "model/gltf-binary", ".png": "image/png" };
function serve() {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] ?? "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

async function renderOne(page, name, fp, turn, o) {
  const [fw, fh] = fp;
  const S = (fw + fh) * 64;
  const W = Math.round(S * 1.25), H = Math.round(S * 1.5);
  const params = {
    glb: `/${OUT}/${name}/model.glb`, fw, fh, turn, width: W, height: H,
    anchorX: W / 2, anchorY: H - (fw + fh) * 16, ss: 2,
    fill: o.fill, sun: o.sun, ambient: o.ambient, yaw: o.yaw,
  };
  const r = await page.evaluate((q) => window.renderSprite(q), params);
  const big = Buffer.from(r.url.split(",")[1], "base64");
  const png = await sharp(big).resize(W, H, { kernel: "lanczos3" }).png().toBuffer();
  // Clipping check: any opaque pixel on the top/left/right border means the
  // overhang canvas was too small for this model.
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let clipped = false;
  for (let x = 0; x < info.width && !clipped; x++) if (data[(x) * 4 + 3] > 8) clipped = true;
  for (let y = 0; y < info.height && !clipped; y++) {
    if (data[(y * info.width) * 4 + 3] > 8 || data[(y * info.width + info.width - 1) * 4 + 3] > 8) clipped = true;
  }
  return { png, heightM: r.heightM, planM: r.planM, autoYawDeg: r.autoYawDeg, clipped, W, H };
}

async function run() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.names.length) throw new Error("name at least one model");
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page:", e.message));
  await page.goto(`http://127.0.0.1:${port}/tools/meshy/render.html`);
  await page.waitForFunction(() => window.ready === true);

  for (const name of o.names) {
    let fp = o.footprint ?? footprintOf(name);
    const turns = o.turn === "all" ? [0, 1, 2, 3] : [Number(o.turn)];
    const outs = [];
    for (const t0 of turns) {
      const t = o.r ? t0 + 1 : t0;
      const f = o.r ? [fp[1], fp[0]] : fp;
      const res = await renderOne(page, name, f, t, o);
      const file = path.join(OUT, name, `render_t${t0}${o.r ? "_r" : ""}@2x.png`);
      fs.writeFileSync(file, res.png);
      outs.push({ file, ...res });
      console.log(`${name} turn ${t0}${o.r ? " (r)" : ""}: height ${res.heightM.toFixed(1)} m, plan ${res.planM.map((v) => v.toFixed(1)).join("×")} m, auto-yaw ${res.autoYawDeg.toFixed(1)}°${res.clipped ? "  ⚠ CLIPPED" : ""} → ${file}`);
    }
    if (turns.length > 1) {
      const { W, H } = outs[0];
      const sheet = sharp({ create: { width: W * outs.length, height: H, channels: 4, background: { r: 236, g: 230, b: 214, alpha: 1 } } })
        .composite(outs.map((x, i) => ({ input: x.png, left: i * W, top: 0 })));
      const file = path.join(OUT, name, `turns${o.r ? "_r" : ""}.png`);
      await sheet.png().toFile(file);
      console.log(`${name}: contact sheet → ${file}`);
    }
  }
  await browser.close();
  server.close();
}

run().catch((e) => { console.error(e.stack ?? e.message); process.exit(1); });
