#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// GFX-01 terrain LOD — derive the medium/low detail tiers of the ground
// textures and decals from the SHIPPED full-size art.
//
// The graphics preset caps the atlases at 2× / 1× / 0.5×; these copies give
// the ground and the decals the same steps (src/iso/detail-tiers.ts):
//
//   assets/ground/<name>.png          full size (512²)  — high
//   assets/ground/medium/<name>.png   half   (256²)     — medium
//   assets/ground/low/<name>.png      quarter (128²)    — low
//   assets/ground/decals/<f>.webp     full size (768×384)
//   assets/ground/decals/medium/<f>   half   (384×192)
//   assets/ground/decals/low/<f>      quarter (192×96)
//
// Derived from the shipped files rather than the sources so the high tier
// never changes when the smaller ones are rebuilt. make-ground-textures.mjs
// and make-scenery-art.mjs call this at the end of their own runs.
//
// Usage: node tools/make-detail-tiers.mjs
// ══════════════════════════════════════════════════════════════════════════
import sharp from "sharp";
import { mkdirSync, readdirSync, existsSync, statSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GROUND = join(root, "assets", "ground");
const DECALS = join(GROUND, "decals");
/** Tier folder → integer shrink factor. */
const TIERS = [["medium", 2], ["low", 4]];
const kb = (n) => `${(n / 1024).toFixed(0)} kB`;

/**
 * Box-average downsample of raw RGBA by an integer factor. Every output texel
 * averages only its own f×f block, so a seamless tile stays seamless — a
 * lanczos resize samples across the image edge (clamped, not wrapped) and
 * would put a faint seam back at the tile boundary.
 */
function boxDown(data, w, h, f) {
  const ow = w / f, oh = h / f, n = f * f;
  const out = Buffer.alloc(ow * oh * 4);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const o = (y * ow + x) * 4;
      for (let c = 0; c < 4; c++) {
        let s = 0;
        for (let dy = 0; dy < f; dy++) {
          for (let dx = 0; dx < f; dx++) s += data[((y * f + dy) * w + (x * f + dx)) * 4 + c];
        }
        out[o + c] = Math.round(s / n);
      }
    }
  }
  return out;
}

/** Half- and quarter-size copies of the seamless ground textures. */
export async function deriveGroundTiers(names = ["grass", "sand", "water"]) {
  for (const [tier] of TIERS) mkdirSync(join(GROUND, tier), { recursive: true });
  for (const name of names) {
    const src = join(GROUND, `${name}.png`);
    if (!existsSync(src)) { console.log(`  ground ${name}: no ${name}.png — skipped`); continue; }
    const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width % 4 || info.height % 4) {
      throw new Error(`${name}.png is ${info.width}×${info.height}; tiers need sides divisible by 4`);
    }
    for (const [tier, f] of TIERS) {
      const out = join(GROUND, tier, `${name}.png`);
      // Same palette PNG settings as the full-size texture.
      await sharp(boxDown(data, info.width, info.height, f), {
        raw: { width: info.width / f, height: info.height / f, channels: 4 },
      })
        .png({ compressionLevel: 9, effort: 10, palette: true, colours: 256 })
        .toFile(out);
      console.log(`  ground ${tier}/${name}.png ${info.width / f}×${info.height / f} ${kb(statSync(out).size)}`);
    }
  }
}

/** Half- and quarter-size copies of every decal. */
export async function deriveDecalTiers() {
  if (!existsSync(DECALS)) { console.log("  decals: none shipped — skipped"); return; }
  const files = readdirSync(DECALS).filter((f) => /\.(webp|png)$/i.test(f));
  for (const [tier] of TIERS) {
    // Rebuilt from scratch so a removed decal never lingers in a tier.
    rmSync(join(DECALS, tier), { recursive: true, force: true });
    mkdirSync(join(DECALS, tier), { recursive: true });
  }
  let bytes = 0;
  for (const f of files) {
    const src = join(DECALS, f);
    const { width, height } = await sharp(src).metadata();
    for (const [tier, k] of TIERS) {
      const out = join(DECALS, tier, f);
      // Decals are not tiled, so a lanczos resize is safe here. Same lossy
      // settings as make-scenery-art.mjs `writeLossy`.
      const img = sharp(src).resize(Math.round(width / k), Math.round(height / k), { kernel: "lanczos3" });
      if (/\.webp$/i.test(f)) await img.webp({ quality: 78, alphaQuality: 88, effort: 6 }).toFile(out);
      else await img.png({ palette: true, compressionLevel: 9, effort: 10 }).toFile(out);
      bytes += statSync(out).size;
    }
  }
  console.log(`  decals: ${files.length} × ${TIERS.length} tiers, ${kb(bytes)}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  console.log("detail tiers (from shipped art):");
  await deriveGroundTiers();
  await deriveDecalTiers();
}
