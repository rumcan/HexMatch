#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// ART-1950S — verify fitted masters against the official footprint templates.
//
// Composites each assets/buildings-src/<name>@2x.png over its
// assets/buildings-src/templates/<w>x<h>@2x.png guide, ALIGNING ANCHORS:
//
//   template anchor = templateGeometry(fp)         (cross-hair on the guide)
//   master   anchor = (W/2, H - footRoom - (w+h)*16)
//
// The footprint is resolved exactly as the compiler resolves it
// (footprints.json, then the compiled manifest, then the sheet manifest —
// see resolveFootprint in tools/make-building-pngs.mjs). The template must
// be the EXACT w×h guide — there is no same-(w+h) fallback: a square guide
// under non-square art (or vice versa) would fake every reading. Missing
// guide → the sprite is skipped with the --templates command that makes it.
//
// The template is NEVER rescaled to the master's canvas width — on overhang
// canvases (W > (w+h)*64) the footprint diamond stays (w+h)*64 wide, so
// scaling it would fake "undersized parcel" readings. The guide's diamond and
// the art's parcel must come out concentric and at the same 2:1 angle.
//
// A scale strip on the cell's left stamps the SAME person + door figure the
// template carries (scaleFigureShapes), feet on the ground row, so reviewers
// can check doors against it even where the art covers the guide's own.
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
import {
  templateGeometry, scaleFigureShapes, parcelMetrics,
  loadDeclaredFootprints, resolveFootprint,
} from "./make-building-pngs.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "assets", "buildings-src");
const TEMPLATES = join(SRC, "templates");
const SHEET_MANIFEST = join(root, "assets", "iso-atlas", "manifest.json");
const BUILDINGS_MANIFEST = join(root, "assets", "buildings", "manifest.json");

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

const sheetManifest = JSON.parse(readFileSync(SHEET_MANIFEST, "utf8"));
const buildingsManifest = existsSync(BUILDINGS_MANIFEST)
  ? JSON.parse(readFileSync(BUILDINGS_MANIFEST, "utf8"))
  : { sprites: {} };
const declared = loadDeclaredFootprints();
const CELL = 320;
const STRIP = 76;   // scale strip on the cell's left (person + door figure)
const FOOT_PAD = 16; // room for the figure's tags below the ground row

const cells = [];
const metrics = [];
for (const name of names) {
  const masterPath = join(SRC, `${name}@2x.png`);
  if (!existsSync(masterPath)) { console.warn(`skip ${name}: no ${masterPath}`); continue; }
  const m = await sharp(masterPath).ensureAlpha().metadata();
  const W = m.width, H = m.height;
  let fp, footRoom = 0, via = "";
  try {
    ({ fp, source: via } = resolveFootprint(name, W, H, {
      declared: declared[name]?.footprint ?? null,
      compiled: buildingsManifest.sprites[name]?.footprint ?? null,
      sheet: sheetManifest.sprites[name]?.footprint ?? null,
    }));
    footRoom = declared[name]?.footRoom ?? 0;
  } catch (err) {
    console.warn(`skip ${name}: ${err.message}`);
    continue;
  }
  const [w, h] = fp;
  // exact template only — never a same-(w+h) square under non-square art
  const tplPath = join(TEMPLATES, `${w}x${h}@2x.png`);
  if (!existsSync(tplPath)) {
    console.warn(`skip ${name}: no ${w}×${h} template — generate it: node tools/make-building-pngs.mjs --templates ${w}x${h}`);
    continue;
  }
  const tg = templateGeometry(fp);
  const mAx = W / 2, mAy = H - footRoom - (w + h) * 16;   // master anchor
  const tAx = tg.ax, tAy = tg.ay;                          // template anchor
  const tW = tg.W, tH = tg.H;

  const top = Math.max(tAy, mAy);
  const bottom = Math.max(tH - tAy, H - mAy);
  const side = Math.max(tW, W);
  const artW = side + 24;
  const CW = STRIP + artW, CH = top + bottom + 4 + FOOT_PAD;
  const artCx = STRIP + artW / 2;

  const tLeft = Math.round(artCx - tAx);
  const mLeft = Math.round(artCx - mAx);
  const tTop = Math.round(top - tAy) + 28;
  const mTop = Math.round(top - mAy) + 28;

  // ── parcel metrics: how the art's GROUND diamond compares to the guide ──
  // (shared with the compiler; see parcelMetrics. diamondRatio ≈ 0.5 == the
  // 2:1 family. Tall buildings can read low: the widest row may be a
  // roof/balcony overhang rather than the slab — confirm on the overlay.)
  const parcel = await parcelMetrics(masterPath, fp, footRoom);

  // scale figure, feet on the ground (vertex) row, in the strip
  const groundRow = Math.round(mTop + (H - footRoom));
  const figure = Buffer.from(
    `<svg width="${CW}" height="${CH + 28}" xmlns="http://www.w3.org/2000/svg">` +
    `<line x1="${STRIP - 6}" y1="28" x2="${STRIP - 6}" y2="${CH + 28}" stroke="#2a3d4f" stroke-width="1"/>` +
    scaleFigureShapes(40, groundRow) + `</svg>`,
  );

  const label = Buffer.from(
    `<svg width="${CW}" height="26" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="100%" height="100%" fill="#101820"/>` +
    `<text x="6" y="18" font-family="monospace" font-size="12" fill="#9fe8ff">${name}  ${W}x${H}  ${w}×${h}${footRoom ? ` foot ${footRoom}` : ""}</text></svg>`,
  );

  const cell = await sharp({
    create: { width: CW, height: CH + 28, channels: 4, background: { r: 16, g: 24, b: 32, alpha: 255 } },
  })
    .composite([
      { input: await sharp(tplPath).ensureAlpha().toBuffer(), left: tLeft, top: tTop },
      { input: await sharp(masterPath).ensureAlpha().toBuffer(), left: mLeft, top: mTop },
      { input: figure, left: 0, top: 0 },
      { input: label, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();

  cells.push(await sharp(cell).resize(CELL, CELL, {
    fit: "contain",
    background: { r: 16, g: 24, b: 32, alpha: 255 },
  }).png().toBuffer());
  console.log(
    `  ${name.padEnd(28)} master ${W}x${H}  ${w}×${h} via ${via}  guide ${tW}x${tH}  ` +
    `parcel ${parcel.parcelW}px (${parcel.parcelPct}% of guide)  ` +
    `diamondRatio ${parcel.diamondRatio} ${w !== h ? "(non-square — confirm visually)" : (parcel.diamondRatio !== null && Math.abs(parcel.diamondRatio - 0.5) <= 0.08 ? "OK(2:1)" : "CHECK")}  ` +
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
