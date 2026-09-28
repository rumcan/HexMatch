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
//
// Vehicles and train cars: `--moving`
//
//   node tools/meshy/render.mjs <model> --moving --length <m> --views 4|8
//        [--flip] [--dest assets/vehicles --prefix truck_red --manifest assets/vehicles/manifest.json]
//        [--livery truck_blue=215]
//
// No footprint fit: the long axis is scaled to a real LENGTH in metres, and
// the anchor is the ground point under the centre (`drawOriginMoving`). Each
// heading is the model turned for real (4 = ne/nw/se/sw, 8 = n…nw), front
// toward the heading (`--flip` when the model's front came out at the back).
// Writes <prefix>_<view>@2x/@1x/@0.5x.png, trimmed, and updates
// {w,h,anchor,footprint,moving,box2x} in the manifest. `--livery <prefix>=<hue>`
// writes a second set with the red paint turned to <hue>°, so one model
// serves both truck liveries. Without --dest it only writes the contact
// sheet, tools/art-src/meshy/<model>/moving.png.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import sharp from "sharp";
import { chromium } from "playwright";

const ROOT = process.cwd();
const OUT = "tools/art-src/meshy";

function parseArgs(argv) {
  const o = { moving: false, length: 5, views: "4", flip: false, dest: null, prefix: null, manifest: null, liveries: [], names: [], turn: "0", r: false, fill: 0.92, sun: 1.1, ambient: 2.8, yaw: null, footprint: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--turn") o.turn = argv[++i];
    else if (a === "--r") o.r = true;
    else if (a === "--moving") o.moving = true;
    else if (a === "--length") o.length = Number(argv[++i]);
    else if (a === "--views") o.views = argv[++i];
    else if (a === "--flip") o.flip = true;
    else if (a === "--dest") o.dest = argv[++i];
    else if (a === "--prefix") o.prefix = argv[++i];
    else if (a === "--manifest") o.manifest = argv[++i];
    else if (a === "--livery") { const [p, h] = argv[++i].split("="); o.liveries.push({ prefix: p, hue: Number(h) }); }
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
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    // THREE_DIR: a three.js install to use when this checkout's node_modules
    // has none (a worktree sharing another clone's modules).
    const three = process.env.THREE_DIR && rel.startsWith("/node_modules/three/");
    const p = three ? path.join(process.env.THREE_DIR, rel.slice("/node_modules/three/".length)) : path.join(ROOT, rel);
    if ((!three && !p.startsWith(ROOT)) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
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

// Heading → turn of +X (screen SE) toward −Z (screen NE), in degrees.
const HEADING = { se: 0, e: 45, ne: 90, n: 135, nw: 180, w: -135, sw: -90, s: -45 };
const VIEWS = { 4: ["ne", "nw", "se", "sw"], 8: ["n", "ne", "e", "se", "s", "sw", "w", "nw"] };

function rgbToHsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx / 255];
}
function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
/** Turn the red paint (hue within ±18° of red, saturated) to `hue`. */
function repaint(raw, hue) {
  const out = Buffer.from(raw);
  for (let i = 0; i < out.length; i += 4) {
    if (!out[i + 3]) continue;
    const [h, s, v] = rgbToHsv(out[i], out[i + 1], out[i + 2]);
    const dist = Math.min(h, 360 - h);
    if (dist > 18 || s < 0.38 || v < 0.12) continue;
    const [r, g, b] = hsvToRgb(hue, Math.min(1, s * 0.9), Math.min(1, v * 1.05));
    out[i] = r; out[i + 1] = g; out[i + 2] = b;
  }
  return out;
}

async function renderMoving(page, name, o) {
  const W = 320, H = 288, AX = 160, AY = 176;
  const views = VIEWS[o.views];
  const shots = [];
  for (const view of views) {
    const r = await page.evaluate((q) => window.renderVehicle(q), {
      glb: `/${OUT}/${name}/model.glb`, width: W, height: H, anchorX: AX, anchorY: AY, ss: 2,
      lengthM: o.length, flip: o.flip, headingDeg: HEADING[view], yaw: o.yaw, sun: o.sun, ambient: o.ambient,
    });
    const full = await sharp(Buffer.from(r.url.split(",")[1], "base64")).resize(W, H, { kernel: "lanczos3" }).raw().toBuffer();
    // Trim to the opaque box; keep the anchor on an even 2× pixel so the 1×
    // anchor is whole, and pad to a multiple of 4 so @0.5x is whole too.
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (full[(y * W + x) * 4 + 3] > 4) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0 || x0 === 0 || y0 === 0 || x1 === W - 1 || y1 === H - 1) throw new Error(`${name} ${view}: empty or clipped render`);
    x0 -= (AX - x0) % 2; y0 -= (AY - y0) % 2;
    const w2 = Math.ceil((x1 - x0 + 1) / 4) * 4, h2 = Math.ceil((y1 - y0 + 1) / 4) * 4;
    const crop = Buffer.alloc(w2 * h2 * 4);
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
      const sx = x0 + x, sy = y0 + y;
      if (sx >= W || sy >= H) continue;
      full.copy(crop, (y * w2 + x) * 4, (sy * W + sx) * 4, (sy * W + sx) * 4 + 4);
    }
    shots.push({ view, raw: crop, w2, h2, anchor: [(AX - x0) / 2, (AY - y0) / 2] });
    console.log(`${name} ${view}: ${w2}×${h2} @2x, anchor ${(AX - x0) / 2},${(AY - y0) / 2} @1x, ${r.lengthM.toFixed(1)}×${r.widthM.toFixed(1)}×${r.heightM.toFixed(1)} m`);
  }
  const sets = [{ prefix: o.prefix ?? name, hue: null }, ...o.liveries];
  const tiles = [];
  for (const set of sets) {
    for (const s of shots) {
      const raw = set.hue == null ? s.raw : repaint(s.raw, set.hue);
      const png2 = await sharp(raw, { raw: { width: s.w2, height: s.h2, channels: 4 } }).png().toBuffer();
      tiles.push(png2);
      if (!o.dest) continue;
      const base = path.join(o.dest, `${set.prefix}_${s.view}`);
      fs.writeFileSync(`${base}@2x.png`, png2);
      await sharp(png2).resize(s.w2 / 2, s.h2 / 2, { kernel: "lanczos3" }).png().toFile(`${base}@1x.png`);
      await sharp(png2).resize(s.w2 / 4, s.h2 / 4, { kernel: "lanczos3" }).png().toFile(`${base}@0.5x.png`);
    }
    if (o.dest && o.manifest) {
      const m = JSON.parse(fs.readFileSync(o.manifest, "utf8"));
      for (const s of shots) {
        const key = `${set.prefix}_${s.view}`;
        const old = m.sprites[key] ?? {};
        m.sprites[key] = {
          ...old, w: s.w2 / 2, h: s.h2 / 2, anchor: s.anchor, footprint: [1, 1], moving: true, box2x: [s.w2, s.h2],
          view: old.view ?? s.view,
          note: `ART-3D (#504): Meshy model ${name}, ${o.length} m long, rendered for this heading by tools/meshy/render.mjs --moving${set.hue != null ? ` (paint turned to ${set.hue}°)` : ""}.`,
        };
      }
      fs.writeFileSync(o.manifest, JSON.stringify(m, null, 2) + "\n");
    }
  }
  // Contact sheet: every heading (and livery) side by side on paper.
  const cw = Math.max(...shots.map((s) => s.w2)) + 16, ch = Math.max(...shots.map((s) => s.h2)) + 16;
  const cols = shots.length;
  await sharp({ create: { width: cw * cols, height: ch * sets.length, channels: 4, background: { r: 236, g: 230, b: 214, alpha: 1 } } })
    .composite(tiles.map((input, i) => ({ input, left: (i % cols) * cw + 8, top: Math.floor(i / cols) * ch + 8 })))
    .png().toFile(path.join(OUT, name, "moving.png"));
  console.log(`${name}: contact sheet → ${path.join(OUT, name, "moving.png")}`);
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
    if (o.moving) { await renderMoving(page, name, o); continue; }
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
