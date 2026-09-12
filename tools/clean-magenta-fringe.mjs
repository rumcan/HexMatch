#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// ART-1950S — magenta fringe cleanup for fitted building masters.
//
// The chroma keyer in fit-building-art.mjs keys the solid background, but AI
// output leaves "despilled mauve" pixels along silhouettes: a 1–3 px keyline
// where anti-aliased art blended into the magenta backing and landed just
// outside the keyer's distance bands (e.g. #91028F at alpha 90–255). Those
// survive keying and read as bright violet fringes in-game.
//
// This pass keys by HUE FAMILY, not distance:
//
//   magenta family  =  b > 105 && r > 75 && b > 0.7*r && |r-b| < 90
//                      && g < 0.32*(r+b)
//
// and clears a pixel only when it is either semi-transparent, or opaque and
// sitting within 3 px of the silhouette (a neighbouring pixel with
// alpha < 200). Interior opaque magenta-hued pixels (pink neon letters,
// flowers well inside the art) are preserved. Fully transparent pixels get
// their RGB zeroed so no downstream compositor can bleed leftover colour.
//
// Usage:
//   node tools/clean-magenta-fringe.mjs                 # every master in assets/buildings-src
//   node tools/clean-magenta-fringe.mjs farm town_flats # specific masters
// ══════════════════════════════════════════════════════════════════════════
import sharp from "sharp";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "assets", "buildings-src");

const names = process.argv.slice(2).filter((a) => !a.startsWith("--") && !/^\d+$/.test(a));
const all = readdirSync(SRC)
  .filter((f) => f.endsWith("@2x.png"))
  .map((f) => f.replace(/@2x\.png$/, ""));
const targets = names.length ? names : all;

const inMagentaFamily = (r, g, b) =>
  b > 105 && r > 75 && b > 0.7 * r && Math.abs(r - b) < 90 && g < 0.32 * (r + b);

// --reach N: how far inside the silhouette an opaque magenta-hued pixel may
// sit and still be treated as keyline residue. 3 suits anti-aliased edges;
// raise it for stray opaque blobs that survived a soft key (e.g. 6).
const reachIdx = process.argv.indexOf("--reach");
const REACH = reachIdx >= 0 ? Number(process.argv[reachIdx + 1]) : 3;

for (const name of targets) {
  const file = join(SRC, `${name}@2x.png`);
  const img = sharp(file);
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const px = (x, y) => {
    const i = (y * W + x) * C;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  // "outside" mask: alpha < 200 (semi-transparent or transparent)
  const outside = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (px(x, y)[3] < 200) outside[y * W + x] = 1;
  // chebyshev dilation of radius REACH
  const near = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!outside[y * W + x]) continue;
      for (let dy = -REACH; dy <= REACH; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -REACH; dx <= REACH; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= W) continue;
          near[ny * W + nx] = 1;
        }
      }
    }
  }

  let cleared = 0, rgbZeroed = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * C;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a === 0) {
        if (r || g || b) { data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; rgbZeroed++; }
        continue;
      }
      if (inMagentaFamily(r, g, b) && (a < 255 || near[y * W + x])) {
        data[i + 3] = 0;
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
        cleared++;
      }
    }
  }
  if (cleared || rgbZeroed) {
    await sharp(data, { raw: { width: W, height: H, channels: C } })
      .png({ compressionLevel: 9 })
      .toFile(file);
  }
  console.log(JSON.stringify({ name, size: `${W}x${H}`, cleared, rgbZeroed }));
}
