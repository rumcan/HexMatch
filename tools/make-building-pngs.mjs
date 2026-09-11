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
//   • 1× / 0.5× variants are DERIVED here (2:1 / 4:1 nearest-neighbour), so
//     the engine never scales inside drawImage (same rule as the atlases).
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
  // 2:1 and 4:1 nearest-neighbour downscale — exact pixel subsets, crisp.
  const out2x = join(OUT, `${name}@2x.png`);
  await sharp(src).png({ compressionLevel: 9 }).toFile(out2x);
  for (const [z, size] of [["1x", spec.S / 2], ["0.5x", spec.S / 4]]) {
    await sharp(src).resize(size, size, { kernel: "nearest" }).png({ compressionLevel: 9 }).toFile(join(OUT, `${name}@${z}.png`));
  }
  return { name, footprint: fp, anchor: [spec.ax / 2, spec.ay / 2], w: spec.S / 2, h: spec.S / 2, canvas2x: spec.S };
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
  console.log(`${name}: ${entry.footprint[0]}×${entry.footprint[1]} → ${entry.w}×${entry.h} @1× (anchor ${entry.anchor.join(",")})`);
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify({
  note: "Per-building PNG layers: assets/buildings/<name>@{0.5x,1x,2x}.png. Rect is the WHOLE image (x=y=0); anchor is the footprint-centre placement point (see tools/make-building-pngs.mjs).",
  sprites: manifest.sprites,
}, null, 2) + "\n");
console.log(`wrote ${join(OUT, "manifest.json")} (${Object.keys(manifest.sprites).length} building${Object.keys(manifest.sprites).length === 1 ? "" : "s"})`);
