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
//
//   • OVERHANG EXTENSION (ART-1950S): the original TTD art overhangs its
//     footprint — 20 of the 43 town sprites and 4 of the 6 depots are wider
//     or taller at 2× than the base canvas (e.g. town_flats_arctic_2x1_2 is
//     192×226 on a 128² canvas). The silhouette-fidelity contract wins over
//     the base size table, so a source MAY use a larger canvas: the ground
//     diamond stays pinned to the canvas BOTTOM (bottom vertex at
//     (W/2, H), anchor at (W/2, H − (w+h)×16), all at 2×) and the extra room
//     goes to headroom ABOVE and width symmetrically either side. W and H
//     must each be ≥ S (= (w+h)×64); the base canvas is the special case
//     W = H = S and reduces to the table below. The engine is agnostic — it
//     places whatever w/h/anchor the manifest carries — and every reference
//     sprite is horizontally centred on its anchor, so symmetric width is
//     faithful.
//
//   | footprint | canvas @2× | anchor (x, y) | ground zone | max rise |
//   |-----------|------------|---------------|-------------|----------|
//   | 1×1       | 128 × 128  | (64, 96)      | 64 px       | 96 px    |
//   | 2×2       | 256 × 256  | (128, 192)    | 128 px      | 192 px   |
//   | 3×3       | 384 × 384  | (192, 288)    | 192 px      | 288 px   |
//   | 4×4       | 512 × 512  | (256, 384)    | 256 px      | 384 px   |
//
// COMPILED OUTPUT (TICKET-B2 + B-3.1, ART-1950S):
//
//   The shipped PNGs are TRIMMED to the art's tight alpha bounding box
//   (threshold 8, the same cut the sheet packer uses) and the manifest's
//   `anchor` is re-expressed relative to the trimmed origin — the renderer
//   then blits the same pixels at the same place, minus the transparent
//   margin. The box is snapped to a multiple of 4 at 2× so that
//   w@2x = 2 × w@1x = 4 × w@0.5x exactly: the blit computes its source rect
//   as round(manifest.w × zoom), which must equal the real pixel width of
//   each zoom file or the right/bottom edge crops.
//
//   1×/0.5× are resampled with a QUALITY kernel (lanczos3), not nearest:
//   these are painted, anti-aliased images, and nearest at 4:1 discards 15
//   of every 16 pixels — thin structures (derrick lattice, railings, window
//   frames) broke into sparkling noise at 0.5×. sharp/libvips premultiplies
//   alpha during resize, so transparent edges do not pick up dark halos.
//   The engine still never scales inside drawImage — only the offline
//   resampling filter changed; the output sizes stay exact halves/quarters.
//
// Usage:
//   node tools/make-building-pngs.mjs                # process every <name>@2x.png
//   node tools/make-building-pngs.mjs farm quarry    # specific names
//   node tools/make-building-pngs.mjs --templates    # (re)generate the templates
//
// Input  : assets/buildings-src/<name>@2x.png   (transparent, spec size)
// Output : assets/buildings/<name>@{0.5x,1x,2x}.png   (tight-trimmed)
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

/** Downscale kernel for the derived 1×/0.5× tiers (TICKET-B2). */
const KERNEL = "lanczos3";

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
 * Tight alpha bounding box of an RGBA image (alpha > threshold), matching the
 * sheet packer's trim rule. Returns null for a fully transparent image.
 */
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
 * One transparent building canvas → the 3 zoom variants. The canvas may be
 * the base spec square (S×S) or an EXTENDED canvas (≥ S in both dims, ground
 * diamond pinned to the canvas bottom — see the header). Outputs are trimmed
 * to the art's alpha box (TICKET-B-3.1) and resampled with a quality kernel
 * (TICKET-B2).
 */
async function processBuilding(name, fps) {
  const src = join(SRC, `${name}@2x.png`);
  if (!existsSync(src)) throw new Error(`missing ${src}`);
  const meta = await sharp(src).metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;

  // Template size determines the terrain footprint:
  // 128x128 -> [1, 1], 256x256 -> [2, 2], 384x384 -> [3, 3], 512x512 -> [4, 4]
  let fp;
  if (W === 128 && H === 128) fp = [1, 1];
  else if (W === 256 && H === 256) fp = [2, 2];
  else if (W === 384 && H === 384) fp = [3, 3];
  else if (W === 512 && H === 512) fp = [4, 4];
  else fp = fps[name] ?? [1, 1];

  const spec = specFor(fp);
  if (W < spec.S || H < spec.S) {
    throw new Error(`${name}: canvas must be at least ${spec.S}×${spec.S} at 2× for a ${fp[0]}×${fp[1]} footprint (got ${W}×${H}) — use assets/buildings-src/templates/${fp[0]}x${fp[1]}@2x.png as the base (larger overhang canvases allowed: ground diamond pinned to the canvas bottom)`);
  }
  if (W > 2048 || H > 2048) {
    throw new Error(`${name}: canvas ${W}×${H} exceeds the 2048px overhang cap — the art is expected to sit near its footprint`);
  }
  // Anchor at 2×: the footprint centre. On the base canvas this is the
  // spec table's (S/2, 3S/4); on an extended canvas the ground diamond is
  // pinned to the bottom, so the anchor sits (w+h)×16 px above it.
  const ax2 = W / 2;
  const ay2 = H - (fp[0] + fp[1]) * 16;

  // ── B-3.1: tight alpha box, snapped to a 4px lattice at 2× so the three
  // tiers are exact 4:2:1 relatives of each other (see header). Snap by
  // EXPANDING (never cutting art): floor the origin, ceil the far edge.
  const base = sharp(src);
  const box = await alphaBBox(base);
  if (!box) throw new Error(`${name}: the source is fully transparent — nothing to compile`);
  const left = Math.max(0, Math.floor(box.left / 4) * 4);
  const top = Math.max(0, Math.floor(box.top / 4) * 4);
  const right = Math.min(W, Math.ceil((box.left + box.width) / 4) * 4);
  const bottom = Math.min(H, Math.ceil((box.top + box.height) / 4) * 4);
  const w2 = right - left, h2 = bottom - top;          // multiples of 4

  // ── write the trimmed 2× master, then the resampled 1×/0.5× from it ──
  const trimmed = base.extract({ left, top, width: w2, height: h2 });
  await trimmed.clone().png({ compressionLevel: 9 }).toFile(join(OUT, `${name}@2x.png`));
  for (const [z, div] of [["1x", 2], ["0.5x", 4]]) {
    await trimmed.clone()
      .resize(Math.round(w2 / div), Math.round(h2 / div), { kernel: KERNEL })
      .png({ compressionLevel: 9 })
      .toFile(join(OUT, `${name}@${z}.png`));
  }

  // ── manifest entry, all at 1×: rect is the WHOLE (trimmed) image, the
  // anchor is the authoring anchor shifted by the trim origin. Fractional
  // anchors are fine — drawOrigin places floats, the blit floors them.
  return {
    name, footprint: fp,
    anchor: [(ax2 - left) / 2, (ay2 - top) / 2],
    w: w2 / 2, h: h2 / 2,
    canvas: [W, H],                   // log/diagnostics only
    trim: { left, top, w2, h2 },      // log/diagnostics only
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
  manifest.sprites[name] = { footprint: entry.footprint, anchor: entry.anchor, w: entry.w, h: entry.h, canvas: entry.canvas };
  const t = entry.trim;
  console.log(`${name}: ${entry.footprint[0]}×${entry.footprint[1]} → ${entry.w}×${entry.h} @1× (anchor ${entry.anchor.join(",")}, trimmed ${t.w2}×${t.h2} from canvas ${entry.canvas[0]}×${entry.canvas[1]} at +${t.left},+${t.top})`);
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify({
  note: "Per-building PNG layers: assets/buildings/<name>@{0.5x,1x,2x}.png — tight-trimmed to the art's alpha box; w/h/anchor are at 1× relative to the TRIMMED image (rect is the whole image, x=y=0), anchor is the footprint-centre placement point (see tools/make-building-pngs.mjs).",
  sprites: manifest.sprites,
}, null, 2) + "\n");
console.log(`wrote ${join(OUT, "manifest.json")} (${Object.keys(manifest.sprites).length} building${Object.keys(manifest.sprites).length === 1 ? "" : "s"})`);
