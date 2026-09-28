#!/usr/bin/env node
import { isCli } from "./is-cli.mjs";
// ══════════════════════════════════════════════════════════════════════════
// Animated building layers (owner, 2026-09-28: "apply the animation sprites
// on the resources").
//
// INPUT: assets/buildings-src/anim/<name>@2x.png — a 2×2 SHEET of four frames
// (reading order: top-left, top-right, bottom-left, bottom-right), rendered
// from the same model as the static master assets/buildings-src/<name>@2x.png.
// The cells are not an even grid (the bottom row sits higher, and art can
// touch a cell edge), so the frames are found by the empty gaps between them.
//
// OUTPUT: assets/buildings/<name>@{2x,1x,0.5x}.png as a horizontal STRIP of
// the four frames (the atlas' `frames` convention: frame i is the i-th equal
// slice), and a manifest entry with `frames` / `frameMs`. Every frame is
// registered on the STATIC master's geometry: scaled so its ground lot is the
// master's lot width, and placed so its south vertex lands on the master's —
// the animated building stands exactly where the still one did.
//
// Clean-up per frame: alpha < 16 is cleared (the generator leaves invisible
// pure-red specks that bleed when resampled) and alpha ≥ 224 is made opaque
// (the art ships at 240–254, which would read faintly see-through in game).
//
// make-building-pngs.mjs calls this after compiling a master that has a
// sheet, so a full rebuild keeps the animation.
//
// Usage: node tools/make-building-anims.mjs [name ...]   (default: every sheet)
// ══════════════════════════════════════════════════════════════════════════
import sharp from "sharp";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "assets", "buildings-src");
const ANIM = join(SRC, "anim");
const OUT = join(root, "assets", "buildings");

export const ANIM_FRAMES = 4;
/** A slow industrial loop: pump beams, smoke and windmills, not a flicker. */
export const ANIM_FRAME_MS = 260;
const KERNEL = "lanczos3";
const SOLID = 16;

export const hasAnimSheet = (name, animDir = ANIM) => existsSync(join(animDir, `${name}@2x.png`));

async function rgba(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** The empty (or emptiest) line between two frames, searched mid-image. */
function splitAt(count, lo, hi) {
  let best = lo, bestN = Infinity, runStart = -1;
  let runBest = null;
  for (let i = lo; i < hi; i++) {
    const n = count(i);
    if (n === 0) {
      if (runStart < 0) runStart = i;
      if (!runBest || i - runStart > runBest[1] - runBest[0]) runBest = [runStart, i];
    } else runStart = -1;
    if (n < bestN) { bestN = n; best = i; }
  }
  return runBest ? Math.round((runBest[0] + runBest[1]) / 2) : best;
}

/** Cut one frame out of the sheet as its own cleaned RGBA image. */
function cut(img, x0, y0, x1, y1) {
  const w = x1 - x0, h = y1 - y0;
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y + y0) * img.w + x + x0) * 4, d = (y * w + x) * 4;
      const a = img.data[s + 3];
      if (a < SOLID) continue;
      data[d] = img.data[s]; data[d + 1] = img.data[s + 1]; data[d + 2] = img.data[s + 2];
      data[d + 3] = a >= 224 ? 255 : a;
    }
  }
  return { data, w, h };
}

/** Lot width (widest opaque row of the lower 60%) and the south vertex. */
export function lotMetrics(img) {
  const op = (x, y) => img.data[(y * img.w + x) * 4 + 3] >= SOLID;
  let top = -1, bottom = -1;
  for (let y = 0; y < img.h && top < 0; y++) for (let x = 0; x < img.w; x++) if (op(x, y)) { top = y; break; }
  for (let y = img.h - 1; y >= 0 && bottom < 0; y--) for (let x = 0; x < img.w; x++) if (op(x, y)) { bottom = y; break; }
  if (top < 0) return null;
  let lotW = 0;
  for (let y = top + Math.floor((bottom - top) * 0.4); y <= bottom; y++) {
    let l = -1, r = -1;
    for (let x = 0; x < img.w; x++) if (op(x, y)) { if (l < 0) l = x; r = x; }
    if (l >= 0 && r - l + 1 > lotW) lotW = r - l + 1;
  }
  // South vertex: the mean x of the lowest few opaque rows.
  let sx = 0, n = 0;
  for (let y = bottom; y > bottom - 4; y--) for (let x = 0; x < img.w; x++) if (op(x, y)) { sx += x; n++; }
  return { top, bottom, lotW, vx: sx / n, vy: bottom };
}

/** Split a 2×2 sheet into its four frames (reading order). */
export async function sheetFrames(file) {
  const img = await rgba(file);
  const op = (x, y) => img.data[(y * img.w + x) * 4 + 3] >= SOLID;
  const rowCount = (y) => { let n = 0; for (let x = 0; x < img.w; x += 2) n += op(x, y) ? 1 : 0; return n; };
  const ys = splitAt(rowCount, Math.floor(img.h * 0.3), Math.floor(img.h * 0.7));
  const frames = [];
  for (const [y0, y1] of [[0, ys], [ys, img.h]]) {
    const colCount = (x) => { let n = 0; for (let y = y0; y < y1; y += 2) n += op(x, y) ? 1 : 0; return n; };
    const xs = splitAt(colCount, Math.floor(img.w * 0.3), Math.floor(img.w * 0.7));
    frames.push(cut(img, 0, y0, xs, y1), cut(img, xs, y0, img.w, y1));
  }
  return frames;
}

/**
 * Compile one sheet into the strip + manifest entry. `staticEntry` is the
 * master's compiled entry (footprint, footRoom); the anchor maths is the same
 * as make-building-pngs' (footprint centre, ground pinned to the canvas).
 */
export async function processAnim(name, staticEntry, { srcDir = SRC, animDir = ANIM, outDir = OUT } = {}) {
  const master = await rgba(join(srcDir, `${name}@2x.png`));
  const mm = lotMetrics(master);
  const frames = await sheetFrames(join(animDir, `${name}@2x.png`));
  const metrics = frames.map(lotMetrics);
  const widths = metrics.map((m) => m.lotW).sort((a, b) => a - b);
  const k = mm.lotW / ((widths[1] + widths[2]) / 2);     // one scale for the whole loop

  // Place every frame on the master's canvas.
  const W = master.w, H = master.h;
  const placed = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i], m = metrics[i];
    const sw = Math.max(1, Math.round(f.w * k)), sh = Math.max(1, Math.round(f.h * k));
    const scaled = await sharp(f.data, { raw: { width: f.w, height: f.h, channels: 4 } })
      .resize(sw, sh, { kernel: KERNEL }).png().toBuffer();
    const left = Math.round(mm.vx - m.vx * k), top = Math.round(mm.vy - m.vy * k);
    // composite needs the overlay inside the canvas: crop what falls outside
    const cl = Math.max(0, -left), ct = Math.max(0, -top);
    const cw = Math.min(sw - cl, W - Math.max(0, left)), ch = Math.min(sh - ct, H - Math.max(0, top));
    const piece = await sharp(scaled).extract({ left: cl, top: ct, width: cw, height: ch }).toBuffer();
    const canvas = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: piece, left: Math.max(0, left), top: Math.max(0, top) }])
      .raw().toBuffer();
    placed.push(canvas);
  }

  // One trim box for every frame (their union), snapped to 4 like the masters.
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (const buf of placed) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (buf[(y * W + x) * 4 + 3] > 8) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const left = Math.floor(minX / 4) * 4, top = Math.floor(minY / 4) * 4;
  const right = Math.min(W, Math.ceil((maxX + 1) / 4) * 4), bottom = Math.min(H, Math.ceil((maxY + 1) / 4) * 4);
  const w2 = right - left, h2 = bottom - top;

  const tiles = await Promise.all(placed.map((buf) =>
    sharp(buf, { raw: { width: W, height: H, channels: 4 } }).extract({ left, top, width: w2, height: h2 }).png().toBuffer()));
  const strip = sharp({ create: { width: w2 * frames.length, height: h2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(tiles.map((input, i) => ({ input, left: i * w2, top: 0 })));
  const stripPng = await strip.png().toBuffer();
  await sharp(stripPng).png({ compressionLevel: 9 }).toFile(join(outDir, `${name}@2x.png`));
  for (const [z, div] of [["1x", 2], ["0.5x", 4]]) {
    // Each frame resized alone so no frame bleeds into its neighbour.
    const small = await Promise.all(tiles.map((t) => sharp(t).resize(w2 / div, h2 / div, { kernel: KERNEL }).png().toBuffer()));
    await sharp({ create: { width: (w2 / div) * frames.length, height: h2 / div, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(small.map((input, i) => ({ input, left: i * (w2 / div), top: 0 })))
      .png({ compressionLevel: 9 }).toFile(join(outDir, `${name}@${z}.png`));
  }

  const [fw, fh] = staticEntry.footprint;
  const footRoom = staticEntry.footRoom ?? 0;
  const ax2 = W / 2, ay2 = H - footRoom - (fw + fh) * 16;
  return {
    footprint: staticEntry.footprint,
    anchor: [(ax2 - left) / 2, (ay2 - top) / 2],
    w: (w2 / 2) * frames.length, h: h2 / 2,
    canvas: [W, H],
    ...(footRoom ? { footRoom } : {}),
    frames: frames.length, frameMs: ANIM_FRAME_MS,
  };
}

async function main() {
  const manifestPath = join(OUT, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const names = args.length ? args : readdirSync(ANIM).filter((f) => /@2x\.png$/.test(f)).map((f) => f.replace(/@2x\.png$/, ""));
  for (const name of names) {
    const prev = manifest.sprites[name];
    if (!prev) throw new Error(`${name}: compile the static master first (node tools/make-building-pngs.mjs ${name})`);
    manifest.sprites[name] = await processAnim(name, prev);
    const e = manifest.sprites[name];
    console.log(`${name}: ${e.frames} frames → ${e.w / e.frames}×${e.h} @1× each (anchor ${e.anchor.join(",")})`);
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

if (isCli(import.meta.url)) await main();
