#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// Crop a sprite's 2× reference from the group sheets (assets/iso-atlas/).
//
// The 1950s restyle contract (ai-codex-art-tickets-1950s.md §2.3) requires the
// new art to match the ORIGINAL (OpenGFX/TTD) silhouette, massing and
// component arrangement. The group sheets carry the exact current art on
// transparent cells (assets/iso-atlas/groups/groups@2x.json is the index), so
// this crops the reference that gets passed to the image model as the
// silhouette ground truth.
//
// Usage: node tools/crop-reference.mjs <sprite_name> <out.png> [paddingPx=12]
// ══════════════════════════════════════════════════════════════════════════
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [name, out, padArg] = process.argv.slice(2);
if (!name || !out) {
  console.error("usage: node tools/crop-reference.mjs <sprite_name> <out.png> [paddingPx=12]");
  process.exit(2);
}
const pad = padArg ? Number(padArg) : 12;

const groups = JSON.parse(readFileSync(join(root, "assets", "iso-atlas", "groups", "groups@2x.json"), "utf8"));
for (const group of Object.values(groups.groups)) {
  for (const page of group.pages) {
    const s = page.sprites.find((sp) => sp.name === name);
    if (!s) continue;
    const left = Math.max(0, s.x - pad);
    const top = Math.max(0, s.y - pad);
    const width = Math.min(page.width - left, s.w + pad * 2);
    const height = Math.min(page.height - top, s.h + pad * 2);
    await sharp(join(root, "assets", "iso-atlas", "groups", page.file))
      .extract({ left, top, width, height })
      .png({ compressionLevel: 9 })
      .toFile(resolve(out));
    console.log(`${name}: cropped ${width}×${height} from ${page.file} (rect ${s.x},${s.y} ${s.w}×${s.h}) → ${out}`);
    process.exit(0);
  }
}
console.error(`"${name}" not found in assets/iso-atlas/groups/groups@2x.json`);
process.exit(1);
