#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// Terrain overhaul (W-series) — make the generated ground textures seamless.
//
// Offset-roll cross-fade (the classic "make seamless" that avoids the mirror
// echo): each axis is conceptually rolled by half its length, then dst is a
// wide smoothstep cross-fade between the ROLLED and ORIGINAL images with
// t=0 at both outer edges and t=1 in the middle. Consequences, per axis:
//   • the wrap boundary shows rolled[w-1]|rolled[0] = orig[m-1]|orig[m]
//     — contiguous source content, seamless by construction;
//   • the raw generator edges only ever appear faded against UNRELATED
//     content (their half-offset twins), so no mirrored symmetry;
//   • the double-exposure width (FADE) is wide enough to read as natural
//     painterly overlap on organic texture.
//
// Usage: node tools/make-ground-textures.mjs [name...]
// Reads  tools/texture-src/<name>-src.png   (raw generated art, any size)
// Writes assets/ground/<name>.png            (seamless 512×512 RGBA)
// ══════════════════════════════════════════════════════════════════════════
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "tools", "texture-src");
const OUT = join(root, "assets", "ground");
const SIZE = 512;
const FADE = Math.floor(SIZE / 4);     // 128px ramp per side, per axis

const smooth = (t) => t * t * (3 - 2 * t);

async function seamless(name) {
  const { data, info } = await sharp(join(SRC, `${name}-src.png`))
    .resize(SIZE, SIZE, { kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let w = info.width, h = info.height;
  let cur = data;

  for (const along of [0, 1]) {                       // 0 = x axis, 1 = y axis
    const n = along === 0 ? w : h;
    const m = n >> 1;
    const at = (buf, a, b) => {                       // (along, other) → index
      const x = along === 0 ? a : b, y = along === 0 ? b : a;
      return (y * w + x) * 4;
    };
    const otherN = along === 0 ? h : w;
    const fade = Math.min(FADE, n >> 2);
    const t = (a) => {
      if (a < fade) return smooth(a / fade);           // 0 → 1
      if (a >= n - fade) return smooth((n - 1 - a) / fade); // 1 → 0
      return 1;
    };
    const next = Buffer.alloc(cur.length);
    for (let b = 0; b < otherN; b++) {
      for (let a = 0; a < n; a++) {
        const i0 = at(cur, a, b);
        const i1 = at(cur, (a + m) % n, b);            // the rolled twin
        const k = t(a);
        const o = at(next, a, b);
        for (let c = 0; c < 4; c++) {
          next[o + c] = c === 3
            ? 255
            : Math.round(cur[i1 + c] * (1 - k) + cur[i0 + c] * k);
        }
      }
    }
    cur = next;
  }

  const out = join(OUT, `${name}.png`);
  await sharp(cur, { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`seamless ${name}: ${w}×${h} (fade ${FADE}) → ${out}`);
}

mkdirSync(OUT, { recursive: true });
const names = process.argv.slice(2);
for (const name of (names.length ? names : ["grass", "sand", "water"])) await seamless(name);
