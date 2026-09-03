#!/usr/bin/env node
// Scratch helper: ASCII-preview a rectangular region of a PNG so sprite
// content can be identified headlessly. Usage:
//   node tools/peek.mjs <file.png> <x> <y> <w> <h> [maxW] [maxH]
import sharp from "sharp";

const [file, x, y, w, h] = process.argv.slice(2);
const maxW = Number(process.argv[6] ?? 96);
const maxH = Number(process.argv[7] ?? 40);
if (!file || x == null) {
  console.error("usage: peek.mjs file.png x y w h [maxW] [maxH]");
  process.exit(1);
}
const { data, info } = await sharp(file, { limitInputPixels: false })
  .extract({ left: Number(x), top: Number(y), width: Number(w), height: Number(h) })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const W = info.width, H = info.height;
const CHARS = " .:-=+*#%@";
// per-pixel luminance of content (alpha>0.5); transparent -> '.'
const cell = [];
let blueFound = false, whiteFound = false;
for (let yy = 0; yy < H; yy++) {
  let row = "";
  for (let xx = 0; xx < W; xx++) {
    const i = (yy * W + xx) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a === 0 || (r === 0 && g === 0 && b === 255)) { row += "."; continue; }
    if (r === 255 && g === 255 && b === 255) { whiteFound = true; row += "w"; continue; }
    if (b > 90 && b > r + 30 && b > g + 30) { row += "L"; continue; }
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    row += CHARS[Math.min(9, Math.max(0, Math.round((1 - lum) * 9)) + 0)];
  }
  cell.push(row);
}
console.log(`region ${file} x=${x} y=${y} ${W}x${H} (blue=${blueFound} white=${whiteFound})`);
const sw = Math.max(1, Math.floor(W / maxW));
const sh = Math.max(1, Math.floor(H / maxH));
for (let yy = 0; yy < H; yy += sh) {
  let row = "";
  for (let xx = 0; xx < W; xx += sw) {
    // sample top-left of block: adequate at these scales
    row += cell[yy][xx];
  }
  console.log(row);
}
