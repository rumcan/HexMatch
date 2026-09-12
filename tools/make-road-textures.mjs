#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// ROAD MATERIALS — verify the supplied swatches tile, then ship them.
//
// Deliberately NOT `make-ground-textures.mjs`. That tool exists to MAKE a raw
// generated image seamless, by cross-fading it against a half-offset copy of
// itself. It is the right tool for art that does not tile — and the wrong one
// for art that already does, because the cross-fade is a double exposure: it
// softens every pebble and crack it touches, which is most of what a road
// material is made of.
//
// So this tool measures instead. It compares the difference across the wrap
// edges against the difference between two neighbouring columns/rows in the
// middle of the image. On a seamless texture those are about the same — the
// wrap is just another pair of adjacent pixels. On a non-seamless one the
// wrap difference is several times larger, and the tool refuses rather than
// shipping a texture that will show a grid across every road on the map.
//
// No resampling either. Resizing would run a filter kernel over the wrap
// edges without wrapping it, which is exactly how a verified-seamless texture
// stops being seamless. The native pixels ship; only the container changes.
//
// WebP because these are opaque, organic, and large: lossy is the right
// trade, and it is roughly a fifth of the PNG.
//
// Usage: node tools/make-road-textures.mjs
//   Reads  tools/texture-src/{asphalt,dirt}-src.png
//   Writes assets/roads/{asphalt,dirt}.webp
// ══════════════════════════════════════════════════════════════════════════
import sharp from "sharp";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "tools", "texture-src");
const OUT = join(root, "assets", "roads");

const MATERIALS = ["asphalt", "dirt"];
/**
 * How much worse the wrap seam may be than the texture's own local
 * variation before this is not a tiling texture. Seamless art measures around
 * 1.1–1.3; art that simply was not made to tile measures 3 and upward.
 */
const SEAM_LIMIT = 2;

mkdirSync(OUT, { recursive: true });

/** Mean absolute channel difference across the wrap, and in the interior. */
function seamEnergy(data, width, height, channels) {
  let wrapX = 0, innerX = 0, wrapY = 0, innerY = 0;
  const at = (x, y, c) => data[(y * width + x) * channels + c];
  for (let y = 0; y < height; y++) {
    for (let c = 0; c < 3; c++) {
      wrapX += Math.abs(at(width - 1, y, c) - at(0, y, c));
      innerX += Math.abs(at(width >> 1, y, c) - at((width >> 1) + 1, y, c));
    }
  }
  for (let x = 0; x < width; x++) {
    for (let c = 0; c < 3; c++) {
      wrapY += Math.abs(at(x, height - 1, c) - at(x, 0, c));
      innerY += Math.abs(at(x, height >> 1, c) - at(x, (height >> 1) + 1, c));
    }
  }
  return {
    x: wrapX / Math.max(1, innerX),
    y: wrapY / Math.max(1, innerY),
  };
}

let failed = false;
for (const name of MATERIALS) {
  const src = join(SRC, `${name}-src.png`);
  if (!existsSync(src)) {
    // Report rather than throw: the road renderer has a complete flat-colour
    // fallback, so a missing swatch is a gap in the art, not a broken build.
    console.error(`missing tools/texture-src/${name}-src.png`);
    console.error("  Supply a top-down, SEAMLESS material swatch:");
    console.error("  no perspective, no road edges, no lane lines, no grass frame.");
    failed = true;
    continue;
  }
  const { data, info } = await sharp(src).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const seam = seamEnergy(data, info.width, info.height, info.channels);
  const ok = seam.x < SEAM_LIMIT && seam.y < SEAM_LIMIT;
  console.log(`${name}: ${info.width}x${info.height}`
    + ` seam x ${seam.x.toFixed(2)}x y ${seam.y.toFixed(2)}x`
    + ` ${ok ? "— tiles" : "— DOES NOT TILE"}`);
  if (!ok) {
    console.error(`  ${name}-src.png shows a visible seam when repeated.`);
    console.error("  Re-export it as a tiling texture, or run it through");
    console.error("  tools/make-ground-textures.mjs first (which softens detail).");
    failed = true;
    continue;
  }
  const file = join(OUT, `${name}.webp`);
  await sharp(src).removeAlpha()
    .webp({ quality: 82, effort: 6 })
    .toFile(file);
  console.log(`  -> assets/roads/${name}.webp`
    + ` ${(statSync(file).size / 1024).toFixed(0)} kB`
    + ` (from ${(statSync(src).size / 1024).toFixed(0)} kB)`);
}
if (failed) process.exit(1);
