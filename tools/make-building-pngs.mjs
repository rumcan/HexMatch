#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// Building layers — ONE standalone PNG per building, placed free on its
// footprint (the roads stay exact-grid; buildings don't have to).
//
// AUTHORING CONVENTION (author at 2× — the most zoomed-in version):
//
//   • canvas: a square of  S = (w + h) × 64 px,  where [w, h] is the sprite's
//     FOOTPRINT (in tiles) — the same footprint the game already uses
//     (assets/iso-atlas/manifest.json stays the footprint authority).
//   • ground zone: the bottom (w + h) × 32 px. The footprint diamond spans
//     the full canvas width with its top vertex at canvas centre; square
//     footprints form a perfect iso diamond.
//   • anchor: pixel  ((w + h) × 32, (w + h) × 48)  from the top-left — the
//     footprint CENTRE. The renderer places that pixel exactly on the
//     footprint's centre (def.center in src/iso/depth.ts), so art drawn on
//     the template sits concentric with its tiles even if it never "snaps".
//   • the building may rise at most (w + h) × 48 px above the anchor.
//   • 1× / 0.5× variants are DERIVED here (lanczos3, exact 2:1 / 4:1), so the
//     engine never scales inside drawImage (same rule as the atlases). The
//     trim step (below) snaps the 2× box to a multiple of 4, keeping 1× and
//     0.5× exact integers — nothing fractional ever reaches drawImage.
//
//   | footprint | canvas @2× | anchor (x, y) | ground zone | max rise |
//   |-----------|------------|---------------|-------------|----------|
//   | 1×1       | 128 × 128  | (64, 96)      | 64 px       | 96 px    |
//   | 2×2       | 256 × 256  | (128, 192)    | 128 px      | 192 px   |
//   | 3×3       | 384 × 384  | (192, 288)    | 192 px      | 288 px   |
//   | 4×4       | 512 × 512  | (256, 384)    | 256 px      | 384 px   |
//
// Usage:
//   node tools/make-building-pngs.mjs                # process every <name>@2x.png
//   node tools/make-building-pngs.mjs farm quarry    # specific names
//   node tools/make-building-pngs.mjs --templates    # (re)generate the templates
//
// Input  : assets/buildings-src/<name>@2x.png   (transparent, spec size)
// Output : assets/buildings/<name>@{0.5x,1x,2x}.png
//          assets/buildings/manifest.json
//          assets/buildings-src/templates/<w>x<h>@2x.png  (--templates)
// ══════════════════════════════════════════════════════════════════════════
import sharp from "sharp";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "assets", "buildings-src");
const OUT = join(root, "assets", "buildings");
const TEMPLATES = join(SRC, "templates");

/** Spec for a footprint, all in 2× pixels (the authoring resolution). */
export function specFor([w, h]) {
  const n = w + h;
  return {
    S: n * 64,                 // canvas side
    ax: n * 32,                // anchor x (footprint centre)
    ay: n * 48,                // anchor y (footprint centre)
    groundH: n * 32,           // ground zone height (bottom of canvas)
    maxRise: n * 48,           // max building height above the anchor
  };
}

/** Footprints from the monolith manifest — the geometry authority. */
function footprints() {
  const m = JSON.parse(readFileSync(join(root, "assets", "iso-atlas", "manifest.json"), "utf8"));
  const out = {};
  for (const [name, s] of Object.entries(m.sprites)) out[name] = s.footprint;
  return out;
}

/**
 * Tight alpha bounding box of a straight-alpha RGBA buffer, snapped to the
 * 1×/0.5× integer contract:
 *   • left/top snap DOWN to a multiple of 4 (2× px) → the anchor offset
 *     (spec.a − offset) stays even, so the 1× anchor is an integer;
 *   • right/bottom snap UP to a multiple of 4 (2× px) → the trimmed width
 *     and height are multiples of 4, so 1× (÷2) and 0.5× (÷4) are integers.
 * Fully-transparent input falls back to the whole canvas (the old behaviour).
 */
function alphaBox(data, width, height) {
  let l = width, t = height, r = 0, b = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] === 0) continue;
      if (x < l) l = x;
      if (x + 1 > r) r = x + 1;
      if (y < t) t = y;
      if (y + 1 > b) b = y + 1;
    }
  }
  if (r === 0) return { l: 0, t: 0, r: width, b: height };
  return {
    l: Math.floor(l / 4) * 4,
    t: Math.floor(t / 4) * 4,
    r: Math.min(Math.ceil(r / 4) * 4, width),
    b: Math.min(Math.ceil(b / 4) * 4, height),
  };
}

/** One spec-size transparent building canvas → the 3 zoom variants. */
async function processBuilding(name, fps) {
  const fp = fps[name];
  if (!fp) throw new Error(`"${name}" is not a sprite in assets/iso-atlas/manifest.json — buildings must map onto existing game footprints`);
  const src = join(SRC, `${name}@2x.png`);
  if (!existsSync(src)) throw new Error(`missing ${src}`);
  const spec = specFor(fp);
  const meta = await sharp(src).metadata();
  if (meta.width !== spec.S || meta.height !== spec.S) {
    throw new Error(`${name}: canvas must be ${spec.S}×${spec.S} at 2× for a ${fp[0]}×${fp[1]} footprint (got ${meta.width}×${meta.height}) — use assets/buildings-src/templates/${fp[0]}x${fp[1]}@2x.png as the base`);
  }
  // B-3.1: trim the transparent margin. The engine blits the WHOLE image as
  // the sprite rect (loadBuildingLayers sets x=y=0, w,h from the manifest),
  // so the trim is folded into the manifest instead: w/h become the trimmed
  // 1× size and the anchor is re-expressed relative to the trimmed top-left.
  // No renderer change is needed for that reason; the only dependent read is
  // buildBuildingMasks, which rasterises the 1× image at its own size.
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const box = alphaBox(data, info.width, info.height);
  const w2 = box.r - box.l;                       // trimmed 2× size
  const h2 = box.b - box.t;
  const crop = sharp(src).extract({ left: box.l, top: box.t, width: w2, height: h2 });
  // B-2: quality downscale. sharp premultiplies alpha around the resize
  // (libvips path, see sharp/src/pipeline.cc) and un-premultiplies after, so
  // thin structures (derrick lattice, railings) survive 4:1 without the
  // sparkling/dark-halo artefacts of nearest. Output sizes stay exact halves
  // and quarters of the (non-square) trimmed box — the engine still never
  // scales inside drawImage.
  await crop.clone().png({ compressionLevel: 9 }).toFile(join(OUT, `${name}@2x.png`));
  for (const [z, div] of [["1x", 2], ["0.5x", 4]]) {
    await crop.clone().resize(w2 / div, h2 / div, { kernel: "lanczos3" }).png({ compressionLevel: 9 }).toFile(join(OUT, `${name}@${z}.png`));
  }
  return {
    name, footprint: fp,
    anchor: [(spec.ax - box.l) / 2, (spec.ay - box.t) / 2],   // 1×, trimmed-origin
    w: w2 / 2, h: h2 / 2,                                      // 1× trimmed size
    canvas2x: `${w2}×${h2} (trimmed from ${spec.S}×${spec.S})`,
  };
}

/** Marked authoring template for a footprint (2×). */
function templateSvg([w, h]) {
  const spec = specFor([w, h]);
  const { S, ax, ay, groundH } = spec;
  const gTop = S - groundH;                       // ground zone top = S/2
  const [cx, cy] = [S / 2, gTop];                 // tile (0,0) top vertex
  const tile = (i, j) => {
    const x = cx + (i - j) * 64, y = cy + (i + j) * 32;
    return `M ${x} ${y} l 64 32 l -64 32 l -64 -32 Z`;
  };
  let tiles = "";
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) tiles += `<path d="${tile(i, j)}" fill="none" stroke="#2f8f6f" stroke-width="1.5"/>`;
  // footprint outline (union of the tiles)
  const outline = `M ${cx} ${cy} L ${cx + w * 64} ${cy + w * 32} L ${cx + (w - h) * 64} ${S} L ${cx - h * 64} ${cy + h * 32} Z`;
  const cross = 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
  <rect width="${S}" height="${S}" fill="#10222e"/>
  <path d="${outline}" fill="#1d4436" stroke="#39d98a" stroke-width="3"/>
  ${tiles}
  <line x1="0" y1="1" x2="${S}" y2="1" stroke="#888" stroke-width="2" stroke-dasharray="12 10"/>
  <circle cx="${ax}" cy="${ay}" r="7" fill="none" stroke="#ff4fd8" stroke-width="3"/>
  <line x1="${ax - cross}" y1="${ay}" x2="${ax + cross}" y2="${ay}" stroke="#ff4fd8" stroke-width="3"/>
  <line x1="${ax}" y1="${ay - cross}" x2="${ax}" y2="${ay + cross}" stroke="#ff4fd8" stroke-width="3"/>
</svg>`;
}

// ── main ───────────────────────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true });
const fps = footprints();
const args = process.argv.slice(2);

if (args.includes("--templates")) {
  const seen = new Set();
  for (const [w, h] of Object.values(fps)) {
    const key = `${w}x${h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mkdirSync(TEMPLATES, { recursive: true });
    const file = join(TEMPLATES, `${key}@2x.png`);
    await sharp(Buffer.from(templateSvg([w, h]))).png({ compressionLevel: 9 }).toFile(file);
    console.log(`template ${key} → ${file} (canvas ${specFor([w, h]).S}², anchor ${specFor([w, h]).ax},${specFor([w, h]).ay})`);
  }
  process.exit(0);
}

const names = args.length
  ? args
  : readdirSync(SRC).filter((f) => /@2x\.png$/.test(f)).map((f) => f.replace(/@2x\.png$/, ""));
if (!names.length) { console.log("nothing to do — drop <name>@2x.png files into assets/buildings-src/"); process.exit(0); }

const manifest = { sprites: {} };
const manifestPath = join(OUT, "manifest.json");
if (existsSync(manifestPath)) {                     // merge — partial runs keep the rest
  const prev = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.sprites = prev.sprites ?? {};
}
for (const name of names) {
  const entry = await processBuilding(name, fps);
  manifest.sprites[name] = { footprint: entry.footprint, anchor: entry.anchor, w: entry.w, h: entry.h };
  console.log(`${name}: ${entry.footprint[0]}×${entry.footprint[1]} → ${entry.w}×${entry.h} @1× (anchor ${entry.anchor.join(",")}) — ${entry.canvas2x}`);
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify({
  note: "Per-building PNG layers: assets/buildings/<name>@{0.5x,1x,2x}.png. Images are TIGHT-alpha-trimmed; the rect is the whole image (x=y=0) and the anchor is the footprint-centre placement point re-expressed relative to the trimmed origin (see tools/make-building-pngs.mjs).",
  sprites: manifest.sprites,
}, null, 2) + "\n");
console.log(`wrote ${join(OUT, "manifest.json")} (${Object.keys(manifest.sprites).length} building${Object.keys(manifest.sprites).length === 1 ? "" : "s"})`);
