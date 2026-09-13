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
import { detailTierFor, type DetailTier } from "./detail-tiers";

// Both extensions: the small tree sprites stay PNG (they are mostly alpha
// edge, which lossy codecs fringe), while the big soft forest blocks and
// ground patches ship as WebP at a third of the bytes.
const treeUrls = import.meta.glob<string>(
  "../../assets/scenery/*.{png,webp}", { eager: true, import: "default" },
);
// GFX-01 terrain LOD: full-size decals, plus the half/quarter-size copies the
// medium/low presets load (tools/make-detail-tiers.mjs). One literal glob per
// tier — Vite cannot build a glob from a variable. The tier folders are
// sub-directories, so the full-size glob (non-recursive) never picks them up.
const decalUrlsByTier: Record<DetailTier, Record<string, string>> = {
  high: import.meta.glob<string>(
    "../../assets/ground/decals/*.{png,webp}", { eager: true, import: "default" },
  ),
  medium: import.meta.glob<string>(
    "../../assets/ground/decals/medium/*.{png,webp}", { eager: true, import: "default" },
  ),
  low: import.meta.glob<string>(
    "../../assets/ground/decals/low/*.{png,webp}", { eager: true, import: "default" },
  ),
};

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
 *
 * GFX-01 terrain LOD: `maxZ` is the preset's detail cap; medium and low load
 * the smaller copies. Decals are drawn at a world size, not their pixel size
 * (`paintDecals`), so a smaller copy needs no other change. A tier with no
 * copies falls back to the full-size set rather than painting no patches.
 */
export async function loadDecalImages(maxZ = 2): Promise<DecalImages> {
  const tier = detailTierFor(maxZ);
  const tierUrls = decalUrlsByTier[tier];
  const decalUrls = Object.keys(tierUrls).length ? tierUrls : decalUrlsByTier.high;
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
export async function loadScenerySprites(atlas: Atlas, maxZ = atlas.detailCap): Promise<number> {
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
    // GFX-01: the family must be authored at every level the quality preset
    // asks for — at `low` that means only 0.5×, so a tree set missing @2x
    // still installs there and a full one still installs at `high`.
    if (!def || urls.some(([s, z]) => z <= maxZ && !urlFor(name, s))) return;
    const have = atlas.buildingImages.get(name);
    const missing = urls.filter(([, z]) => z <= maxZ && !have?.has(z));
    if (!missing.length) return;             // already at full detail for this cap
    try {
      const images = await Promise.all(missing.map(([s]) => loadBitmap(urlFor(name, s))));
      const map = have ?? new Map<number, AtlasImage>();
      for (let i = 0; i < missing.length; i++) map.set(missing[i][1], images[i]);
      atlas.buildingImages.set(name, map);
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
