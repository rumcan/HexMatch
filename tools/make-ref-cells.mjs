#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// ART-1950S — reference-cell extractor for prompt conditioning.
//
// Pulls the OpenGFX reference cell(s) for the named sprites out of
// assets/iso-atlas/atlas@2x.png and lays them on a labeled contact sheet.
// State the printed width/height ratio in the generation prompt: the fit
// tool normalises the art's alpha-box WIDTH to the reference's, so matching
// the reference's overall proportions is what keeps the silhouette faithful.
//
// Usage:
//   node tools/make-ref-cells.mjs --out /tmp/refs.png <name...>
//   node tools/make-ref-cells.mjs --out /tmp/refs.png --all-town
// ══════════════════════════════════════════════════════════════════════════
import sharp from "sharp";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ATLAS = join(root, "assets", "iso-atlas", "atlas@2x.png");
const MANIFEST = join(root, "assets", "iso-atlas", "manifest.json");
const SRC = join(root, "assets", "buildings-src");

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const OUT = outIdx >= 0 ? args[outIdx + 1] : "/tmp/ref-cells.png";
let names = args.filter((a, i) => !a.startsWith("--") && i !== outIdx + 1);
if (args.includes("--all-town")) {
  names = readdirSync(SRC).filter((f) => f.startsWith("town_") && f.endsWith("@2x.png"))
    .map((f) => f.replace(/@2x\.png$/, ""));
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const CELL = 260;
const cells = [];

for (const name of names) {
  const def = manifest.sprites[name];
  if (!def) { console.warn(`skip ${name}`); continue; }
  const refW = def.w * 2, refH = def.h * 2;
  const cell = await sharp(ATLAS)
    .extract({ left: def.x * 2, top: def.y * 2, width: refW, height: refH })
    .resize(CELL - 40, CELL - 40, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer({ resolveWithObject: true });
  const label = Buffer.from(
    `<svg width="${CELL}" height="${CELL}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="100%" height="36" fill="#0d1418"/>` +
    `<text x="6" y="15" font-family="monospace" font-size="11" fill="#9fe8ff">${name}</text>` +
    `<text x="6" y="30" font-family="monospace" font-size="11" fill="#ffd479">` +
    `${refW}x${refH}  aspect ${(refW / refH).toFixed(3)}  fp ${def.footprint.join("x")}</text></svg>`,
  );
  const card = await sharp({
    create: { width: CELL, height: CELL, channels: 4, background: { r: 13, g: 20, b: 24, alpha: 255 } },
  })
    .composite([
      { input: cell.data, left: Math.round((CELL - cell.info.width) / 2),
        top: 36 + Math.round((CELL - 36 - cell.info.height) / 2) },
      { input: label, left: 0, top: 0 },
    ])
    .png().toBuffer();
  cells.push(card);
  console.log(JSON.stringify({ name, ref: `${refW}x${refH}`, aspect: +(refW / refH).toFixed(3), footprint: def.footprint, anchor: def.anchor }));
}

const cols = Math.min(5, cells.length);
const rows = Math.ceil(cells.length / cols);
await sharp({
  create: { width: cols * CELL + (cols + 1) * 6, height: rows * CELL + (rows + 1) * 6,
    channels: 4, background: { r: 5, g: 8, b: 10, alpha: 255 } },
})
  .composite(cells.map((c, i) => ({ input: c, left: 6 + (i % cols) * (CELL + 6), top: 6 + Math.floor(i / cols) * (CELL + 6) })))
  .png({ compressionLevel: 9 })
  .toFile(OUT);
console.log("wrote", OUT, existsSync(OUT));
