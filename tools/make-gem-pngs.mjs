#!/usr/bin/env node
/**
 * ART-08 (ART-1950S): compile raw generated art into a match-3 gem icon.
 *
 *   node tools/make-gem-pngs.mjs <cargo> [<raw-path>]
 *
 * <cargo>  one of grain | wood | ore | stone | oil | gold
 *          (the icon lands in src/assets/gems/<cargo>.png, 128×128, transparent)
 * <raw>    path to the freshly generated art. Omit to re-emit the icon from
 *          the master at assets/gems-src/<cargo>.png (the raw is archived
 *          there automatically on first compile).
 *
 * Pipeline: chroma-key the magenta backing (same border-sampled keyer as
 * tools/fit-building-art.mjs — hard/soft distance bands + despill), trim to
 * the alpha bbox, scale the longest side to 108 px, and centre on a 128×128
 * transparent canvas so every gem shares one visual weight.
 */
import sharp from "sharp";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GEM_DIR = join(ROOT, "src/assets/gems");
const SRC_DIR = join(ROOT, "assets/gems-src");

const CARGOS = new Set(["grain", "wood", "ore", "stone", "oil", "gold"]);
const OUT = 128;        // final canvas
const CONTENT = 108;    // longest side of the trimmed gem inside the canvas

const cargo = process.argv[2];
if (!CARGOS.has(cargo)) {
  console.error(`usage: node tools/make-gem-pngs.mjs <grain|wood|ore|stone|oil|gold> [raw]`);
  process.exit(1);
}
const givenRaw = process.argv[3];
const master = join(SRC_DIR, `${cargo}.png`);
const rawPath = givenRaw ?? master;
if (!existsSync(rawPath)) throw new Error(`missing raw art ${rawPath}`);

// ── border-sampled chroma keyer (ported from fit-building-art.mjs) ─────────
async function alphaBBox(img, threshold = 8) {
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function chromaKey(img) {
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;          // channels = 3 here
  const sample = (x, y) => {
    const i = (y * width + x) * channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  // modal border colour: quantise to 16-step bins, then MERGE the dominant
  // cluster's near neighbours (a noisy magenta backing splits across bins)
  const bins = new Map();
  const push = (c) => {
    const key = `${c[0] >> 4},${c[1] >> 4},${c[2] >> 4}`;
    const b = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += c[0]; b.g += c[1]; b.b += c[2];
    bins.set(key, b);
  };
  for (let x = 0; x < width; x += 3) { push(sample(x, 0)); push(sample(x, height - 1)); }
  for (let y = 0; y < height; y += 3) { push(sample(0, y)); push(sample(width - 1, y)); }
  const ranked = [...bins.values()].sort((a, b) => b.n - a.n);
  const dom = ranked[0];
  let n = dom.n, r = dom.r, g = dom.g, b = dom.b;
  for (const c of ranked.slice(1)) {          // merge the near cluster
    const d = Math.hypot(c.r / c.n - r / n, c.g / c.n - g / n, c.b / c.n - b / n);
    if (d < 48) { n += c.n; r += c.r; g += c.g; b += c.b; }
  }
  const bg = [r / n, g / n, b / n];

  const HARD = 80, SOFT = 130;    // colour-distance bands (max 441)
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels, o = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const d = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
      let a = 255;
      if (d < HARD) a = 0;
      else if (d < SOFT) a = Math.round(255 * (d - HARD) / (SOFT - HARD));
      // despill: soften the background cast on semi-transparent edge pixels
      if (a > 0 && a < 255) {
        const t = a / 255;
        out[o] = Math.round(r * t + bg[0] * (1 - t) * 0);      // drop bg tint
        out[o + 1] = Math.round(g * t + bg[1] * (1 - t) * 0);
        out[o + 2] = Math.round(b * t + bg[2] * (1 - t) * 0);
      } else {
        out[o] = r; out[o + 1] = g; out[o + 2] = b;
      }
      out[o + 3] = a;
    }
  }
  return sharp(out, { raw: { width, height, channels: 4 } });
}

// ── compile ─────────────────────────────────────────────────────────────────
let art = sharp(rawPath, { limitInputPixels: false });
const meta = await art.metadata();
const alphaStats = await art.stats();
const hasAlpha = meta.channels === 4 && alphaStats.channels[3]?.min !== alphaStats.channels[3]?.max;
if (!hasAlpha) art = await chromaKey(art);

const box = await alphaBBox(art);
if (!box) throw new Error(`raw art ${rawPath} is fully transparent after background keying`);
const trimmed = await art.extract(box)
  .resize({ width: CONTENT, height: CONTENT, fit: "inside", kernel: "lanczos3" })
  .png().toBuffer();
const t = await sharp(trimmed).metadata();

await sharp({ create: { width: OUT, height: OUT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: trimmed, left: Math.round((OUT - t.width) / 2), top: Math.round((OUT - t.height) / 2) }])
  .png().toFile(join(GEM_DIR, `${cargo}.png`));

if (givenRaw) {
  mkdirSync(SRC_DIR, { recursive: true });
  writeFileSync(master, readFileSync(givenRaw));   // archive the raw as the master
}
console.log(`${cargo}: gem ${box.width}×${box.height} → ${t.width}×${t.height} in 128×128 transparent canvas`);
