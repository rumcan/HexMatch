#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// ART-1950S — fit loose building art onto the authoring canvas.
//
// The 1950s art is generated as free-standing illustration (this tool does
// not care where it came from). This tool turns it into a compliant
// assets/buildings-src/<name>@2x.png master:
//
//   1. BACKGROUND: if the art has no alpha (opaque AI output), the solid
//      background is keyed out (corner-colour detection + soft threshold +
//      despill). Art that already carries transparency passes through.
//   2. TRIM to the art's alpha box.
//   3. SCALE uniformly so the art's width matches the REFERENCE sprite's
//      alpha-box width at 2× (the reference is extracted from
//      assets/iso-atlas/atlas@2x.png — the reference's ground span is the
//      physical size we must match). Height may exceed the reference (taller
//      chimneys): the canvas grows.
//   4. PLACE so the reference's anchor pixel lands on the canvas' south
//      vertex (W/2, H) — exactly where the sheet's south-corner anchor sits
//      relative to the footprint. make-building-pngs.mjs then derives the
//      manifest anchor from the same geometry (ground diamond pinned to the
//      canvas bottom), so the compiled art lands pixel-for-pixel where the
//      sheet art did.
//
// Usage:
//   node tools/fit-building-art.mjs <sprite-name> <raw-art.png> [--out <file>]
//                                     [--scale-ref width|height] [--dry]
//
// Prints the placement numbers (canvas, anchor, offsets) for audit logs.
// ══════════════════════════════════════════════════════════════════════════
import sharp from "sharp";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ATLAS = join(root, "assets", "iso-atlas", "atlas@2x.png");
const MANIFEST = join(root, "assets", "iso-atlas", "manifest.json");
const SRC_DIR = join(root, "assets", "buildings-src");

const args = process.argv.slice(2);
const name = args[0];
const rawPath = args[1];
const flag = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
if (!name || !rawPath || args.includes("--help") || args.includes("-h")) {
  console.log("usage: node tools/fit-building-art.mjs <sprite-name> <raw-art.png> [--scale-ref width|height] [--margin N] [--dry]");
  process.exit(1);
}
const scaleRef = flag("--scale-ref", "width"); // width | height
const MARGIN = Number(flag("--margin", "8"));  // canvas breathing room, 2× px
const dry = args.includes("--dry");

const snap4 = (v) => Math.ceil(v / 4) * 4;

/** Alpha bbox (threshold 8) of a sharp image. */
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

/**
 * Key out a solid background. Samples the border pixels, takes the modal
 * colour, and removes pixels within a soft distance threshold with a despill
 * ramp. Returns a sharp pipeline with real alpha.
 */
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
        out[o] = Math.min(255, Math.round(r + (r - bg[0]) * (1 - t) * 0.5));
        out[o + 1] = Math.min(255, Math.round(g + (g - bg[1]) * (1 - t) * 0.5));
        out[o + 2] = Math.min(255, Math.round(b + (b - bg[2]) * (1 - t) * 0.5));
      } else {
        out[o] = r; out[o + 1] = g; out[o + 2] = b;
      }
      out[o + 3] = a;
    }
  }
  return sharp(out, { raw: { width, height, channels: 4 } });
}

// ── reference sprite geometry (all at 2×) ──────────────────────────────────
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const def = manifest.sprites[name];
if (!def) throw new Error(`"${name}" is not a sprite in assets/iso-atlas/manifest.json`);
const spec = { S: (def.footprint[0] + def.footprint[1]) * 64 };
const refCell = sharp(ATLAS).extract({
  left: def.x * 2, top: def.y * 2, width: def.w * 2, height: def.h * 2,
});
const refBox = await alphaBBox(refCell.clone());
if (!refBox) throw new Error(`reference sprite "${name}" is empty in the atlas`);
const refAnchor = { x: def.anchor[0] * 2, y: def.anchor[1] * 2 };   // sprite-local, 2×

// ── raw art: key the background if there is no alpha ──────────────────────
if (!existsSync(rawPath)) throw new Error(`missing raw art ${rawPath}`);
let art = sharp(rawPath, { limitInputPixels: false });
const meta = await art.metadata();
let keyed = false;
const alphaStats = await art.stats();   // channel stats include alpha when present
const hasAlpha = meta.channels === 4 && alphaStats.channels[3]?.min !== alphaStats.channels[3]?.max;
if (!hasAlpha) {
  art = await chromaKey(art);
  keyed = true;
}
const artBox = await alphaBBox(art);
if (!artBox) throw new Error(`raw art ${rawPath} is fully transparent after background keying`);

// ── scale: match the reference's ground span (width by default) ────────────
const refSpan = scaleRef === "height" ? refBox.height : refBox.width;
const artSpan = scaleRef === "height" ? artBox.height : artBox.width;
const scale = refSpan / artSpan;
const artW = Math.max(1, Math.round(artBox.width * scale));
const artH = Math.max(1, Math.round(artBox.height * scale));

// ── canvas: base size, or an overhang canvas (ground diamond pinned to the
//    bottom). The reference's anchor pixel lands on the south vertex
//    (W/2, H); the art is aligned to the reference's alpha box — bottom on
//    the reference's ground line, centred — so TALLER art grows upward
//    (chimneys) instead of sinking through the ground.
const W = snap4(Math.max(spec.S, artW + MARGIN * 2));
const H = snap4(Math.max(spec.S, artH + (refAnchor.y - refBox.top - refBox.height) + MARGIN));
// ref bbox top-left position on the canvas, then bottom-align + centre:
const bx = W / 2 - refAnchor.x + refBox.left;
const by = H - refAnchor.y + refBox.top;
const dx = Math.round(bx + (refBox.width - artW) / 2);
const dy = Math.round(by + refBox.height - artH);

// ── compose ────────────────────────────────────────────────────────────────
const scaled = art.extract({
  left: artBox.left, top: artBox.top, width: artBox.width, height: artBox.height,
}).resize(artW, artH, { kernel: "lanczos3", fit: "fill" });
const out = flag("--out", join(SRC_DIR, `${name}@2x.png`));
if (!dry) {
  await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await scaled.png().toBuffer(), left: Math.max(0, Math.min(W - artW, dx)), top: Math.max(0, Math.min(H - artH, dy)) }])
    .png({ compressionLevel: 9 })
    .toFile(out);
}
console.log(JSON.stringify({
  name, raw: rawPath, keyed,
  ref: { w: def.w * 2, h: def.h * 2, bbox: [refBox.left, refBox.top, refBox.width, refBox.height], anchor: [refAnchor.x, refAnchor.y] },
  art: { bbox: [artBox.left, artBox.top, artBox.width, artBox.height], scaled: [artW, artH], scale: +scale.toFixed(4), placed: [dx, dy] },
  canvas: { W, H, baseS: spec.S, anchor: [W / 2, H - (def.footprint[0] + def.footprint[1]) * 16] },
  out: dry ? "(dry run)" : out,
}, null, 2));
