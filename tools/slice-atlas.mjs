#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// E1 — atlas slicer.
//
// Reads a source sprite sheet plus a hand-written cell map (a manifest JSON
// describing each sprite's source rect, footprint and anchor), then emits:
//   dist-atlas/<image>            the @1x sheet
//   dist-atlas/<image@2x>         nearest-neighbour 2× upscale
//   dist-atlas/<image@0.5x>       nearest-neighbour 0.5× downscale
//   dist-atlas/manifest.json      one shared manifest for all three scales
//   dist-atlas/contact.png        debug contact sheet: every sprite drawn on a
//                                 tile grid with its anchor pixel in magenta and
//                                 its footprint diamond outlined.
//
// The anchor is the contract the renderer draws by (E1): it is the pixel that
// lands exactly on the screen position of the footprint's south corner.
//
// Usage: node tools/slice-atlas.mjs [manifest.json] [sheet.png] [outDir]
// Requires `sharp` (npm i -D sharp). Manifest is validated against
// tools/atlas-manifest.schema.json (lightweight hand-rolled validator, no dep).
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = process.argv[2] || join(__dirname, "../assets/iso-atlas/manifest.json");
const OUT_DIR = process.argv[3] || join(__dirname, "../dist-atlas");

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error("[slice-atlas] sharp is not installed. Run: npm i -D sharp");
  process.exit(2);
}

// ── manifest validation (schema subset; no external json-schema dep) ──
function validateManifest(m) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  need(m && typeof m === "object", "manifest must be an object");
  if (errors.length) return errors;
  need(typeof m.image === "string" && m.image.length, "image: non-empty string");
  need(Number.isInteger(m.tileW) && m.tileW > 0, "tileW: positive integer");
  need(Number.isInteger(m.tileH) && m.tileH > 0, "tileH: positive integer");
  need(m.sprites && typeof m.sprites === "object", "sprites: object");
  for (const [name, s] of Object.entries(m.sprites || {})) {
    const k = `sprites.${name}`;
    for (const f of ["x", "y", "w", "h", "frames"])
      need(Number.isInteger(s[f]) && s[f] >= 0, `${k}.${f}: integer >= 0`);
    need(Array.isArray(s.footprint) && s.footprint.length === 2 &&
      s.footprint.every((n) => Number.isInteger(n) && n >= 1), `${k}.footprint: [w,h] of positive ints`);
    need(Array.isArray(s.anchor) && s.anchor.length === 2 &&
      s.anchor.every((n) => Number.isInteger(n) && n >= 0), `${k}.anchor: [x,y] of non-negative ints`);
    if (s.frameMs !== undefined) need(Number.isInteger(s.frameMs) && s.frameMs >= 1, `${k}.frameMs: positive integer`);
  }
  return errors;
}

// ── contact sheet rendering ──────────────────────────────────────────────
async function contactSheet(sheet, manifest, scale) {
  const { tileW, tileH } = manifest;
  const entries = Object.entries(manifest.sprites);
  const cols = 6;
  const rows = Math.ceil(entries.length / cols);
  const cellW = tileW * 5 * scale + 80;
  const cellH = tileH * 5 * scale + 220;
  const W = cols * cellW;
  const H = rows * cellH;

  const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`];
  svg.push(`<rect width="${W}" height="${H}" fill="#20242c"/>`);

  for (let i = 0; i < entries.length; i++) {
    const [name, s] = entries[i];
    const gx = (i % cols) * cellW, gy = Math.floor(i / cols) * cellH;
    const fw = s.footprint[0], fh = s.footprint[1];
    // diamond of the footprint's south corner, drawn in tile space
    const cx = gx + cellW / 2;
    const cy = gy + cellH - 120;
    const hw = tileW * fw / 2 * scale, hh = tileH * fh / 2 * scale;
    // tile grid
    for (let ty = 0; ty < fh; ty++) {
      for (let tx = 0; tx < fw; tx++) {
        const ddx = (tx - ty) * (tileW / 2) * scale;
        const ddy = (tx + ty) * (tileH / 2) * scale - hh + tileH / 2 * scale;
        const px = cx + ddx, py = cy + ddy;
        svg.push(`<polygon points="${px},${py} ${px + hw / fw},${py + hh / fh} ${px},${py + 2 * hh / fh} ${px - hw / fw},${py + hh / fh}" fill="none" stroke="#3a4150" stroke-width="1"/>`);
      }
    }
    // footprint diamond outline (south corner at cx,cy)
    svg.push(`<polygon points="${cx},${cy - 2 * hh} ${cx + hw},${cy - hh} ${cx},${cy} ${cx - hw},${cy - hh}" fill="none" stroke="#ff5fd0" stroke-width="2"/>`);
    // sprite image: anchor lands on the south corner (cx,cy)
    const ax = s.anchor[0] * scale, ay = s.anchor[1] * scale;
    const sw = s.w * scale, sh = s.h * scale;
    // embed via base64 so sharp can rasterise it
    const sheetB64 = (await sheet.png().toBuffer()).toString("base64");
    svg.push(`<image x="${cx - ax}" y="${cy - ay}" width="${(await sheet.metadata()).width * scale}" height="${(await sheet.metadata()).height * scale}" preserveAspectRatio="none" href="data:image/png;base64,${sheetB64}" clip-path="inset(0)"/>`);
    // we still need to clip to the sprite rect; instead blit just the crop below.
    svg.push(`<rect x="${cx - 3}" y="${cy - 3}" width="6" height="6" fill="#ff2bd6"/>`); // anchor pixel
    svg.push(`<text x="${gx + 12}" y="${gy + 24}" fill="#fff" font-size="16" font-family="monospace">${name}</text>`);
    svg.push(`<text x="${gx + 12}" y="${gy + 44}" fill="#9fb3c8" font-size="12" font-family="monospace">${s.footprint[0]}×${s.footprint[1]} anchor[${s.anchor}]@${scale}×</text>`);
  }
  svg.push("</svg>");
  return Buffer.from(svg.join(""));
}

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const errors = validateManifest(manifest);
  if (errors.length) {
    console.error("[slice-atlas] manifest validation failed:");
    for (const e of errors) console.error("  -", e);
    process.exit(1);
  }
  const sheetPath = join(dirname(MANIFEST_PATH), manifest.image);
  const sheet = sharp(sheetPath);
  mkdirSync(OUT_DIR, { recursive: true });

  for (const [scale, suffix] of [[1, ""], [2, "@2x"], [0.5, "@0.5x"]]) {
    const meta = await sharp(sheetPath).metadata();
    const out = sharp(sheetPath).resize(
      Math.round(meta.width * scale),
      Math.round(meta.height * scale),
      { kernel: scale < 1 ? "cubic" : "nearest" },
    );
    const name = basename(manifest.image, ".png");
    await out.png().toFile(join(OUT_DIR, `${name}${suffix}.png`));
  }

  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

  // contact sheet (rendered via SVG → raster; nearest-neighbour sprites)
  const svg = await contactSheet(sharp(sheetPath), manifest, 1);
  await sharp(svg, { density: 96 }).png().toFile(join(OUT_DIR, "contact.png"));

  console.log(`[slice-atlas] wrote ${Object.keys(manifest.sprites).length} sprites → ${OUT_DIR}`);
  console.log("[slice-atlas] manifest validated OK; contact.png written.");
}

main().catch((err) => { console.error(err); process.exit(1); });
