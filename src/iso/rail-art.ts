// ══════════════════════════════════════════════════════════════════════════
// RAIL-03 (#177) — loading the railway PNGs.
//
// Split out of `rail.ts` for the same reason `vehicle-art.ts` is split out of
// `vehicles.ts` and `scenery-art.ts` out of `scenery.ts`: this file reaches for
// `import.meta.glob`, a JSON import and `createImageBitmap`, which only the
// bundler and a browser have, while the railway RULES must stay importable from
// plain Node (unit tests, tools, the headless suites).
//
// The sixteen sprites (`{locomotive,wagon,platform,train-depot}_{ne,se,sw,nw}`)
// live in `assets/railway/` and are authored at 2× and derived down by
// `tools/make-railway-art.mjs`. They are STATICALLY IMPORTED (globbed) like the
// scenery and the branded lorries, NOT fetched at runtime from the manifest the
// way `assets/buildings/` is: a fixed set of small PNGs every map wants from the
// first frame, so bundling beats a manifest fetch plus a build-time copy step
// (and it is the trap docs/BUILDING-PNG-MIGRATION.md's B-0 already fell into
// once — a file that 404s in production).
//
// A railway sprite is an ordinary sprite with a def in the atlas table plus its
// own per-zoom PNGs in `Atlas.buildingImages`, which `imageForSprite` consults
// first. Two things about the defs are worth spelling out:
//   * `center` is NEVER set. The static sprites (platform, depot) are anchored
//     on the SOUTH VERTEX of their footprint's last tile — `depth.drawOrigin`'s
//     default branch, the same convention every industry, factory, depot and
//     town house uses. The moving ones (locomotive, wagon) are anchored on the
//     ground-contact point `depth.drawOriginMoving` lands on their fractional
//     tile. The manifest's `anchor` is authored for exactly those two branches.
//   * no alpha mask is built HERE. `pickSprite` skips moving items, so a
//     locomotive mask would only cost memory; the static two are masks built by
//     the same `buildBuildingMasks` pass every other sprite in `buildingImages`
//     gets, which is where the two of them belong.
//
// Non-gating by contract: absent or partial art leaves the vector rail (the
// drawn track, the flat platform slab) standing on the map. The railway keeps
// working, it is just not dressed yet.
// ══════════════════════════════════════════════════════════════════════════
import type { Atlas, AtlasImage } from "./atlas";
import railwayManifest from "../../assets/railway/manifest.json";

const railUrls = import.meta.glob<string>(
  "../../assets/railway/*.png", { eager: true, import: "default" },
);

/**
 * One sprite's geometry, authored by the compiler. JSON imports widen `[1, 1]`
 * to `number[]`, so the tuple shape is asserted once here rather than at every
 * read. `moving` says whether the sprite is a vehicle (drawn at a fractional
 * tile) or a structure (drawn at its footprint).
 */
export interface RailwayDef {
  name: string;
  kind: string;
  view: string;
  w: number;
  h: number;
  anchor: [number, number];
  footprint: [number, number];
  moving: boolean;
  /** Railway tiles the sprite is long/wide — the wagon's trail math reads it. */
  lenTiles?: number;
  widthTiles?: number;
}
const manifestSprites = (railwayManifest as unknown as {
  sprites: Record<string, RailwayDef>;
}).sprites;

/** Every sprite the manifest ships, in stable name order. */
export const RAILWAY_SPRITE_NAMES: readonly string[] = Object.keys(manifestSprites).sort();

const ZOOMS = [["0.5x", 0.5], ["1x", 1], ["2x", 2]] as const;

function loadBitmap(url: string): Promise<AtlasImage> {
  return fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
      return r.blob();
    })
    .then((b) => createImageBitmap(b));
}

/**
 * Install the railway sprites into `atlas`. Returns how many sprites landed — 0
 * means the art is missing (or the bundler had no PNGs) and every platform,
 * depot, locomotive and wagon falls back to the vector drawing, which is a
 * plain map, not a broken one.
 *
 * The images load BEFORE the def is written, per sprite: a def whose PNGs
 * failed would make the renderer blit a 0×0 rect, whereas an unwritten def just
 * sends `Atlas.has(name)` false and `railStructureItems` / `trainItems` skip it
 * (they probe first). That ordering is also what makes a partially authored
 * family — say three of four headings — safe: the missing heading falls back on
 * its own.
 */
export async function loadRailwaySprites(atlas: Atlas, maxZ = atlas.detailCap): Promise<number> {
  let installed = 0;
  await Promise.all(Object.entries(manifestSprites).map(async ([name, def]) => {
    const urlFor = (suffix: string) => railUrls[`../../assets/railway/${name}@${suffix}.png`];
    // GFX-01: the family must be authored at every detail level the quality
    // preset asks for — `low` is satisfied by @0.5x alone. A run with a RAISED
    // cap only fills the levels the sprite is still missing, so a quality change
    // never re-fetches a bitmap that is already installed.
    if (ZOOMS.some(([suffix, z]) => z <= maxZ && !urlFor(suffix))) return;
    const have = atlas.buildingImages.get(name);
    const missing = ZOOMS.filter(([, z]) => z <= maxZ && !have?.has(z));
    if (!missing.length) return;               // already at full detail for this cap
    try {
      const images = await Promise.all(missing.map(([suffix]) => loadBitmap(urlFor(suffix) as string)));
      const map = have ?? new Map<number, AtlasImage>();
      for (let i = 0; i < missing.length; i++) map.set(missing[i][1], images[i]);
      atlas.buildingImages.set(name, map);
      atlas.manifest.sprites[name] = {
        x: 0, y: 0, w: def.w, h: def.h,
        footprint: def.footprint,
        anchor: def.anchor,
        // NO `center`: south-vertex placement for the structures, and the
        // moving pair ignores this branch entirely (`drawOriginMoving`).
      };
      installed++;
    } catch (err) {
      // Only a FIRST install may fall back: dropping the def of a sprite that
      // already serves its installed levels would delete working art on a
      // failed fill pass.
      if (!atlas.buildingImages.get(name)?.size) delete atlas.manifest.sprites[name];
      console.warn(`[railway] ${name}: not installed`, err);
    }
  }));
  return installed;
}
