// ══════════════════════════════════════════════════════════════════════════
// SCENERY ART — loading the decal and tree PNGs (tools/make-scenery-art.mjs).
//
// Split out of `scenery.ts` so the scatter/paint logic stays importable from
// plain Node (unit tests, tools) — this file reaches for `import.meta.glob`
// and `createImageBitmap`, which only the bundler and a browser have.
//
// Both families are STATICALLY IMPORTED (globbed), not fetched at runtime
// like `assets/buildings/`: they are a fixed, small set that every map needs
// from the first frame, so bundling them beats a manifest fetch plus a
// vite-build copy step. Tree sprite DEFS are installed straight into the
// atlas — a tree is an ordinary 1×1 centre-anchored sprite as far as the
// renderer, depth sort and cull pad are concerned, it just happens to come
// from its own PNG rather than the shared sheet (the same road
// `loadBuildingLayers` drives for per-building art).
// ══════════════════════════════════════════════════════════════════════════
import type { Atlas, AtlasImage } from "./atlas";
import {
  DECAL_KINDS, FOREST_SPRITES, TREE_SPRITES,
  type DecalImages, type DecalKind,
} from "./scenery";
import sceneryManifest from "../../assets/scenery/manifest.json";

// Both extensions: the small tree sprites stay PNG (they are mostly alpha
// edge, which lossy codecs fringe), while the big soft forest blocks and
// ground patches ship as WebP at a third of the bytes.
const treeUrls = import.meta.glob<string>(
  "../../assets/scenery/*.{png,webp}", { eager: true, import: "default" },
);
const decalUrls = import.meta.glob<string>(
  "../../assets/ground/decals/*.{png,webp}", { eager: true, import: "default" },
);

/**
 * The tree geometry table. JSON imports widen `[1, 1]` to `number[]`, so the
 * tuple shape is asserted here once rather than at every read.
 */
const manifestSprites = (sceneryManifest as unknown as {
  sprites: Record<string, { footprint: [number, number]; anchor: [number, number]; w: number; h: number }>;
}).sprites;

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function loadBitmap(url: string): Promise<AtlasImage> {
  return fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
      return r.blob();
    })
    .then((b) => createImageBitmap(b));
}

/**
 * The decal PNGs, grouped by family. Variants come back in file-name order so
 * a given seed picks the same patch art on every client.
 */
export async function loadDecalImages(): Promise<DecalImages> {
  const byKind = Object.fromEntries(DECAL_KINDS.map((k) => [k, [] as AtlasImage[]])) as DecalImages;
  const jobs: Promise<void>[] = [];
  for (const [path, url] of Object.entries(decalUrls).sort(([a], [b]) => a.localeCompare(b))) {
    const kind = fileName(path).split("_")[0] as DecalKind;
    const bank = byKind[kind];
    if (!bank) continue;                       // a family the engine doesn't know
    const slot = bank.length;
    bank.push(null as unknown as AtlasImage);  // reserve order before the await
    jobs.push(loadBitmap(url).then((img) => { bank[slot] = img; }));
  }
  await Promise.all(jobs);
  for (const k of DECAL_KINDS) byKind[k] = byKind[k].filter(Boolean);
  return byKind;
}

/**
 * Install the scenery sprites into `atlas` — the 1×1 trees and the 4×4 forest
 * blocks alike: a sprite def plus its three per-zoom PNGs in `buildingImages`
 * (which `imageForSprite` consults first). Returns the number installed — 0
 * means the art is missing and the renderer draws no scenery, which is a bare
 *
 * map, not a broken one.
 *
 * No alpha mask is built: scenery is drawn as `decor` and skipped by
 * picking, so a mask would only ever cost memory.
 */
export async function loadScenerySprites(atlas: Atlas): Promise<number> {
  // The extension varies by sprite family, so resolve by trying both rather
  // than hard-coding one and silently dropping the other.
  const urlFor = (name: string, suffix: string) =>
    treeUrls[`../../assets/scenery/${name}@${suffix}.png`]
    ?? treeUrls[`../../assets/scenery/${name}@${suffix}.webp`];

  let installed = 0;
  // Trees and forest blocks install identically — both are centre-anchored
  // sprites with their own PNG per zoom; only the footprint differs, and that
  // comes from the manifest.
  const all: readonly string[] = [...TREE_SPRITES, ...FOREST_SPRITES];
  await Promise.all(all.map(async (name) => {
    const def = manifestSprites[name];
    const urls = [["0.5x", 0.5], ["1x", 1], ["2x", 2]] as const;
    if (!def || urls.some(([s]) => !urlFor(name, s))) return;
    try {
      const images = await Promise.all(urls.map(([s]) => loadBitmap(urlFor(name, s))));
      atlas.buildingImages.set(name, new Map(urls.map(([, z], i) => [z, images[i]])));
      atlas.manifest.sprites[name] = {
        x: 0, y: 0, w: def.w, h: def.h,
        footprint: def.footprint,
        anchor: def.anchor,
        center: true,       // placed on the footprint's CENTRE, like buildings
      };
      installed++;
    } catch (err) {
      console.warn(`[scenery] ${name}: not installed`, err);
    }
  }));
  return installed;
}
