// ══════════════════════════════════════════════════════════════════════════
// R3 (#270) — loading the dam PNGs.
//
// The same split the railway art got (#177): this file reaches for
// `import.meta.glob`, a JSON import and `createImageBitmap`, which only the
// bundler and a browser have, while the dam RULES live in `dams.ts` and must
// stay importable from plain Node (unit tests, tools, the headless suites).
//
// The two sprites (`dam_x`, `dam_y`) live in `assets/rivers/` and are
// authored at 2× / 1× / 0.5×. They are STATICALLY IMPORTED (globbed) like
// the railway and the scenery, NOT fetched at runtime from the manifest.
//
// A dam sprite is an ordinary sprite with a def in the atlas table plus its
// own per-zoom PNGs in `Atlas.buildingImages`, which `imageForSprite`
// consults first. Two things about the defs are worth spelling out:
//   * `center` is NEVER set. The dam is anchored on the SOUTH VERTEX of its
//     footprint's last tile — `depth.drawOrigin`'s default branch, the same
//     convention every industry, factory, depot, town house and platform
//     uses. The manifest's `anchor` is authored for exactly that branch.
//   * no alpha mask is built HERE. The mask is built by the same
//     `buildBuildingMasks` pass every other sprite in `buildingImages` gets.
//
// Non-gating by contract: absent or partial art leaves the vector map
// standing. The dam keeps working (it is a structure and an economy rule,
// not a picture), it is just not dressed yet.
// ══════════════════════════════════════════════════════════════════════════
import type { Atlas, AtlasImage } from "./atlas";
import riversManifest from "../../assets/rivers/manifest.json";

const riverUrls = import.meta.glob<string>(
  "../../assets/rivers/*.png", { eager: true, import: "default" },
);

/**
 * One sprite's geometry, authored by the manifest. JSON imports widen `[1,1]`
 * to `number[]`, so the tuple shape is asserted once here rather than at
 * every read. The dam is a static structure (`moving` is always false).
 */
export interface RiverDef {
  name: string;
  kind: string;
  w: number;
  h: number;
  anchor: [number, number];
  footprint: [number, number];
  moving: boolean;
}
const manifestSprites = (riversManifest as unknown as {
  sprites: Record<string, RiverDef>;
}).sprites;

/** Every sprite the manifest ships, in stable name order. */
export const RIVER_SPRITE_NAMES: readonly string[] = Object.keys(manifestSprites).sort();

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
 * Install the dam sprites into `atlas`. Returns how many landed — 0 means the
 * art is missing (or the bundler had no PNGs) and every dam falls back to
 * nothing being drawn, which is a plain map, not a broken one.
 *
 * The images load BEFORE the def is written, per sprite: a def whose PNGs
 * failed would make the renderer blit a 0×0 rect, whereas an unwritten def
 * just sends `Atlas.has(name)` false and `syncWorld`'s dam items skip it
 * (they probe first). That ordering is what makes a partially authored
 * family safe: the missing heading falls back on its own.
 */
export async function loadRiverSprites(atlas: Atlas, maxZ = atlas.detailCap): Promise<number> {
  let installed = 0;
  await Promise.all(Object.entries(manifestSprites).map(async ([name, def]) => {
    const urlFor = (suffix: string) => riverUrls[`../../assets/rivers/${name}@${suffix}.png`];
    // A family must be authored at every detail level the quality preset asks
    // for — `low` is satisfied by @0.5x alone. A run with a RAISED cap only
    // fills the levels the sprite is still missing, so a quality change never
    // re-fetches a bitmap that is already installed.
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
        // NO `center`: south-vertex placement, the structure convention.
      };
      installed++;
    } catch (err) {
      // Only a FIRST install may fall back: dropping the def of a sprite that
      // already serves its installed levels would delete working art on a
      // failed fill pass.
      if (!atlas.buildingImages.get(name)?.size) delete atlas.manifest.sprites[name];
      console.warn(`[rivers] ${name}: not installed`, err);
    }
  }));
  return installed;
}
