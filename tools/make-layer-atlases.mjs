#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// Terrain overhaul (W-series) — split the monolithic iso-atlas into LAYER
// atlases: roads (road_*/dirt_*) and buildings (everything else except the
// old terrain_* tiles, which the pattern-painted ground replaces).
//
// Every sprite keeps its EXACT manifest rect, so `assets/iso-atlas/
// manifest.json` remains the one source of truth for x/y/w/h/footprint/
// anchor — the layer PNGs are the same atlas with the other layers' pixels
// blanked. The renderer blits roads from roads@*.png and buildings from
// buildings@*.png; nothing else about placement/depth/picking changes.
//
// Usage: node tools/make-layer-atlases.mjs
// Reads  assets/iso-atlas/{manifest.json,atlas@0.5x.png,atlas@1x.png,atlas@2x.png}
// Writes assets/layers/{roads,buildings}@{0.5x,1x,2x}.png
//        assets/layers/manifest.json   (layer → images + sprite-name sets)
// ══════════════════════════════════════════════════════════════════════════
import sharp from "sharp";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ATLAS = join(root, "assets", "iso-atlas");
const OUT = join(root, "assets", "layers");

const manifest = JSON.parse(readFileSync(join(ATLAS, "manifest.json"), "utf8"));

/** Layer assignment. Terrain sprites belong to NO layer — the pattern-
 *  painted ground (`src/iso/ground.ts`) replaces them entirely. */
const layerOf = (name) =>
  /^(road|dirt)_/.test(name) ? "roads"
  : /^terrain_/.test(name) ? null
  : "buildings";

const layerNames = { roads: [], buildings: [] };
for (const name of Object.keys(manifest.sprites)) {
  const layer = layerOf(name);
  if (layer) layerNames[layer].push(name);
}

const ZOOMS = Object.keys(manifest.images);            // ["1","2","0.5"]
mkdirSync(OUT, { recursive: true });

for (const zoom of ZOOMS) {
  const srcFile = join(ATLAS, manifest.images[zoom]);
  const { data, info } = await sharp(srcFile, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const z = Number(zoom);
  // Packer rounding: the zoomed atlas places each sprite at
  // round(x·z), round(y·z) sized round(w·z) × round(h·z) — mirror it exactly.
  const rect = (s) => ({
    x: Math.round(s.x * z), y: Math.round(s.y * z),
    w: Math.round(s.w * z), h: Math.round(s.h * z),
  });

  for (const layer of ["roads", "buildings"]) {
    const out = Buffer.from(data);                     // copy, then blank others
    for (const [name, s] of Object.entries(manifest.sprites)) {
      if (layerOf(name) === layer) continue;
      const r = rect(s);
      for (let y = 0; y < r.h; y++) {
        const row = ((r.y + y) * info.width + r.x) * 4;
        out.fill(0, row, row + r.w * 4);
      }
    }
    const suffix = zoom === "1" ? "1x" : zoom === "2" ? "2x" : "0.5x";
    const file = join(OUT, `${layer}@${suffix}.png`);
    await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(file);
    console.log(`${layer}@${suffix}.png: kept ${layerNames[layer].length} sprites`);
  }
}

writeFileSync(join(OUT, "manifest.json"), JSON.stringify({
  // Same tile metrics and rect layout as assets/iso-atlas/manifest.json,
  // partitioned into draw layers. Terrain sprites are listed under `ground`
  // for provenance only — they are no longer rendered as sprites.
  tileW: manifest.tileW,
  tileH: manifest.tileH,
  layers: {
    roads: { images: { "0.5": "roads@0.5x.png", "1": "roads@1x.png", "2": "roads@2x.png" }, sprites: layerNames.roads },
    buildings: { images: { "0.5": "buildings@0.5x.png", "1": "buildings@1x.png", "2": "buildings@2x.png" }, sprites: layerNames.buildings },
  },
  ground: Object.keys(manifest.sprites).filter((n) => layerOf(n) === null),
  note: "Sprite rects are identical to assets/iso-atlas/manifest.json — that file remains authoritative for geometry.",
}, null, 2) + "\n");
console.log(`wrote ${join(OUT, "manifest.json")}`);
