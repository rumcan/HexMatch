#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// Place generated building art onto its spec canvas (the authoring contract).
//
// The image model returns a free-composition render; the engine needs the
// building on the EXACT spec canvas (tools/make-building-pngs.mjs validates
// it): square S = (w+h)×64 px @2×, ground zone = bottom S/2, anchor at
// (S/2, 3S/4) = the footprint centre. This deterministically normalises any
// generated render to that contract:
//
//   1. trim the alpha bounding box;
//   2. scale so the art fits: width ≤ 0.95·S (footprint diamond's widest
//      span) AND height ≤ S (max rise above the anchor + drop below it);
//   3. centre horizontally, align the art's BOTTOM to the canvas bottom —
//      the base's front corner then sits on the footprint diamond's front
//      (south) corner, exactly like the hand-authored 1×1 masters;
//   4. write assets/buildings-src/<name>@2x.png (the authoring master).
//
// Usage:
//   node tools/place-building-art.mjs <name> <generated.png>
//   (name must be a sprite in assets/iso-atlas/manifest.json — the footprint
//    authority, as in make-building-pngs.mjs)
// ══════════════════════════════════════════════════════════════════════════
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [name, genPath] = process.argv.slice(2);
if (!name || !genPath) {
  console.error("usage: node tools/place-building-art.mjs <name> <generated.png>");
  process.exit(2);
}

// footprint → canvas spec (2× px), same formulas as make-building-pngs.mjs
const manifest = JSON.parse(readFileSync(join(root, "assets", "iso-atlas", "manifest.json"), "utf8"));
const fp = manifest.sprites[name]?.footprint;
if (!fp) throw new Error(`"${name}" is not a sprite in assets/iso-atlas/manifest.json`);
const n = fp[0] + fp[1];
const S = n * 64;

// 1. tight alpha box
const { data, info } = await sharp(genPath, { animated: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let l = info.width, t = info.height, r = 0, b = 0;
for (let y = 0; y < info.height; y++) {
  const row = y * info.width * 4;
  for (let x = 0; x < info.width; x++) {
    if (data[row + x * 4 + 3] === 0) continue;
    if (x < l) l = x;
    if (x + 1 > r) r = x + 1;
    if (y < t) t = y;
    if (y + 1 > b) b = y + 1;
  }
}
if (r === 0) throw new Error("generated image is fully transparent");
const bboxW = r - l, bboxH = b - t;

// 2. scale: never exceed 95% of the canvas width (the diamond's widest span)
//    nor the full canvas height (max rise above anchor + drop below it)
const scale = Math.min((0.95 * S) / bboxW, S / bboxH);
const w = Math.max(2, Math.round(bboxW * scale));
const h = Math.max(2, Math.round(bboxH * scale));

// 3. crop the bbox, resample, place: centred x, bottom on the canvas bottom
const placed = await sharp(genPath)
  .extract({ left: l, top: t, width: bboxW, height: bboxH })
  .resize(w, h, { kernel: "lanczos3" })
  .ensureAlpha()
  .png()
  .toBuffer();

const canvas = await sharp({
  create: { width: S, height: S, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([{ input: placed, left: Math.round((S - w) / 2), top: S - h }])
  .png({ compressionLevel: 9 });

const dest = join(root, "assets", "buildings-src", `${name}@2x.png`);
await canvas.toFile(dest);
console.log(
  `${name}: ${info.width}×${info.height} gen → bbox ${bboxW}×${bboxH} → ${w}×${h} @${scale.toFixed(3)} ` +
  `→ canvas ${S}×${S} (x=${Math.round((S - w) / 2)}, y=${S - h}) → ${dest}`,
);
