#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// ART-1950S — verify fitted masters against the official footprint templates.
//
// Composites each assets/buildings-src/<name>@2x.png over its
// assets/buildings-src/templates/<w>x<h>@2x.png guide, ALIGNING ANCHORS:
//
//   template anchor = ((w+h)*32, (w+h)*48)          (cross-hair on the guide)
//   master   anchor = (W/2, H - (w+h)*16)           (READMED overhang rule)
//
// The template is NEVER rescaled to the master's canvas width — on overhang
// canvases (W > (w+h)*64) the footprint diamond stays (w+h)*64 wide, so
// scaling it would fake "undersized parcel" readings. The guide's diamond and
// the art's parcel must come out concentric and at the same 2:1 angle.
//
// Usage:
//   node tools/overlay-building-template.mjs farm factory [--out /tmp/template-overlays.png]
//
// SAFETY: refuses to write an --out that already exists unless the filename
// contains "template-overlay" (a previous guard against clobbering raw art).
// ══════════════════════════════════════════════════════════════════════════
import sharp from "sharp";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "assets", "buildings-src");
const TEMPLATES = join(SRC, "templates");
const MANIFEST = join(root, "assets", "iso-atlas", "manifest.json");

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const OUT = outIdx >= 0 ? args[outIdx + 1] : "/tmp/template-overlay.png";
const names = args.filter((a, i) => !a.startsWith("--") && i !== outIdx + 1);

if (!names.length) {
  console.error("usage: node tools/overlay-building-template.mjs <name...> [--out <png>]");
  process.exit(1);
}
if (existsSync(OUT) && !OUT.includes("template-overlay")) {
  throw new Error(
    `refusing to overwrite ${OUT}: output files must contain "template-overlay" in the name ` +
    `(guard against clobbering raw art). Pick another --out.`,
  );
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const CELL = 320;

/** find the template for a footprint (exact, else same (w+h) sum) */
function templatePath(fp) {
  const [w, h] = fp;
  const exact = join(TEMPLATES, `${w}x${h}@2x.png`);
  if (existsSync(exact)) return { path: exact, S: (w + h) * 64 };
  for (const f of ["1x1", "2x2", "3x3", "4x4"]) {
    const [tw, th] = f.split("x").map(Number);
    if (tw + th === w + h) {
      const p = join(TEMPLATES, `${f}@2x.png`);
      if (existsSync(p)) return { path: p, S: (tw + th) * 64 };
    }
  }
  return null;
}

const cells = [];
const metrics = [];
for (const name of names) {
  const def = manifest.sprites[name];
  if (!def) { console.warn(`skip ${name}: not in iso manifest`); continue; }
  const [w, h] = def.footprint;
  const tpl = templatePath(def.footprint);
  const masterPath = join(SRC, `${name}@2x.png`);
  if (!tpl || !existsSync(masterPath)) { console.warn(`skip ${name}`); continue; }

  const m = await sharp(masterPath).ensureAlpha().metadata();
  const W = m.width, H = m.height;
  const tS = tpl.S;                       // template canvas side (== its file size)
  const mAx = W / 2, mAy = H - (w + h) * 16;   // master anchor
  const tAx = tS / 2, tAy = tS * 0.75;          // template anchor

  const top = Math.max(tAy, mAy);
  const bottom = Math.max(tS - tAy, H - mAy);
  const side = Math.max(tS, W);
  const CW = side + 24, CH = top + bottom + 4;

  const tLeft = Math.round(CW / 2 - tAx);
  const mLeft = Math.round(CW / 2 - mAx);
  const tTop = Math.round(top - tAy) + 28;
  const mTop = Math.round(top - mAy) + 28;

  // ── parcel metrics: how the art's GROUND diamond compares to the guide ──
  // widest opaque row in the bottom 60% = the parcel's left/right vertex row;
  // distance from there to the lowest opaque pixel = half the diamond height.
  // A 2:1 diamond has (bottom - widest) / (rowWidth / 2) === 1.0.
  const { data: raw, info: ri } = await sharp(masterPath).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const rx = (x, y, c) => raw[(y * ri.width + x) * ri.channels + c];
  let pMinY = ri.height, pMaxY = -1;
  for (let y = 0; y < ri.height; y++)
    for (let x = 0; x < ri.width; x++)
      if (rx(x, y, 3) > 8) {
        if (y < pMinY) pMinY = y;
        if (y > pMaxY) pMaxY = y;
      }
  const yFrom = pMinY + Math.floor((pMaxY - pMinY) * 0.4);
  let rowW = 0, widestY = yFrom, widestX = 0;
  for (let y = yFrom; y <= pMaxY; y++) {
    let l = -1, r = -1;
    for (let x = 0; x < ri.width; x++) {
      if (rx(x, y, 3) > 8) { if (l < 0) l = x; r = x; }
    }
    if (r - l + 1 > rowW) { rowW = r - l + 1; widestY = y; widestX = (l + r) / 2; }
  }
  let lowestX = 0;
  for (let x = 0; x < ri.width; x++) if (rx(x, pMaxY, 3) > 8) { lowestX = x; break; }
  // diamondRatio: for a true 2:1 diamond, the distance from the widest row
  // (the left/right vertex row) to the bottom vertex is half the half-width,
  // so a 2:1 parcel measures ~0.5. Band 0.42–0.58 == the 2:1 family;
  // >=0.65 means a squished/"true isometric" diamond, <=0.35 too flat.
  // Tall buildings can read low: the widest row may be a roof/balcony
  // overhang rather than the slab — confirm on the overlay image.
  const diamondRatio = rowW > 0 ? +((pMaxY - widestY) / (rowW / 2)).toFixed(3) : null;
  const parcelPct = +((rowW / ((w + h) * 64)) * 100).toFixed(1);
  const parcel = { parcelW: rowW, guideW: (w + h) * 64, parcelPct, diamondRatio,
    vertexOffset: +(lowestX - widestX).toFixed(1) };

  const label = Buffer.from(
    `<svg width="${CW}" height="26" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="100%" height="100%" fill="#101820"/>` +
    `<text x="6" y="18" font-family="monospace" font-size="15" fill="#9fe8ff">${name}  ${W}x${H}</text></svg>`,
  );

  const cell = await sharp({
    create: { width: CW, height: CH + 28, channels: 4, background: { r: 16, g: 24, b: 32, alpha: 255 } },
  })
    .composite([
      { input: await sharp(tpl.path).ensureAlpha().toBuffer(), left: tLeft, top: tTop },
      { input: await sharp(masterPath).ensureAlpha().toBuffer(), left: mLeft, top: mTop },
      { input: label, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();

  cells.push(await sharp(cell).resize(CELL, CELL, {
    fit: "contain",
    background: { r: 16, g: 24, b: 32, alpha: 255 },
  }).png().toBuffer());
  console.log(
    `  ${name.padEnd(28)} master ${W}x${H}  guide ${tpl.S}  ` +
    `parcel ${parcel.parcelW}px (${parcel.parcelPct}% of guide)  ` +
    `diamondRatio ${parcel.diamondRatio} ${parcel.diamondRatio !== null && Math.abs(parcel.diamondRatio - 0.5) <= 0.08 ? "OK(2:1)" : "CHECK"}  ` +
    `vertexOffset ${parcel.vertexOffset}`);
  metrics.push({ name, ...parcel });
}

const cols = Math.min(5, cells.length);
const rows = Math.ceil(cells.length / cols);
const sheet = await sharp({
  create: { width: cols * CELL + (cols + 1) * 8, height: rows * CELL + (rows + 1) * 8,
    channels: 4, background: { r: 8, g: 12, b: 16, alpha: 255 } },
})
  .composite(cells.map((c, i) => ({
    input: c,
    left: 8 + (i % cols) * (CELL + 8),
    top: 8 + Math.floor(i / cols) * (CELL + 8),
  })))
  .png({ compressionLevel: 9 })
  .toFile(OUT);
console.log(JSON.stringify({ out: OUT, size: `${sheet.width}x${sheet.height}`, cells: cells.length, metrics }, null, 1));
