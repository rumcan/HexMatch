// ══════════════════════════════════════════════════════════════════════════
// TRUCK-BRAND art — loading the player-branded lorry PNGs.
//
// Split out of `vehicles.ts` for the same reason `scenery-art.ts` is split out
// of `scenery.ts`: this file reaches for `import.meta.glob`, a JSON import and
// `createImageBitmap`, which only the bundler and a browser have, while the
// truck routing/math must stay importable from plain Node (unit tests, tools).
//
// The eight branded sprites (blue for the player, red for the rival, four
// headings each) live in `assets/vehicles/` and are authored as keyed masters
// in `assets/vehicles-src/`, compiled by `tools/make-truck-art.mjs`. They are
// STATICALLY IMPORTED (globbed) like the scenery, not fetched at runtime like
// `assets/buildings/`: a fixed set of 24 small PNGs that every map needs from
// the first frame, so bundling beats a manifest fetch plus a build-time copy.
//
// A branded lorry is an ordinary sprite with a def in the atlas table plus its
// own per-zoom PNG in `Atlas.buildingImages` (which `imageForSprite` consults
// first) — the same route `loadBuildingLayers` and `loadScenerySprites` drive.
// Two differences matter:
//   * `center` is NOT set. Moving sprites are anchored by
//     `depth.drawOriginMoving`, which puts the def's anchor pixel on the
//     centre of the fractional tile's diamond; centre-placement would float the
//     lorry half a tile up the road.
//   * no alpha mask is built. `pickSprite` skips moving items, so a truck mask
//     would only ever cost memory.
//
// Non-gating by contract: absent or partial art leaves the legacy
// `truck_goods_*` sheet cells (which `assets/iso-atlas` always ships) — the
// trucks keep driving, they are just not liveried yet.
// ══════════════════════════════════════════════════════════════════════════
import type { Atlas, AtlasImage, SpriteDef } from "./atlas";
import vehiclesManifest from "../../assets/vehicles/manifest.json";

const vehicleUrls = import.meta.glob<string>(
  "../../assets/vehicles/*.png", { eager: true, import: "default" },
);

/**
 * The truck geometry table, authored by the compiler. JSON imports widen
 * `[1, 1]` to `number[]`, so the tuple shape is asserted once here rather than
 * at every read.
 */
interface VehicleDef {
  w: number; h: number; anchor: [number, number]; footprint: [number, number];
  /** The one thing that is NOT in the atlas def: who is driving. */
  owner: number;
}
const manifestSprites = (vehiclesManifest as unknown as {
  sprites: Record<string, VehicleDef>;
}).sprites;

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
 * Install the branded lorries into `atlas`. Returns how many sprites landed —
 * 0 means the art is missing (or the bundler had no PNGs), and every truck then
 * draws with the legacy sheet cell, which is a plain map, not a broken one.
 *
 * The images are loaded BEFORE the def is written, per sprite: a def whose PNGs
 * failed would make the renderer blit a 0×0 rect, whereas an unwritten def just
 * sends `Atlas.has(name)` false and `truckItems` falls back. That ordering is
 * also what makes a partially authored family (say three of four headings)
 * safe — the missing heading falls back on its own.
 */
export async function loadVehicleLayers(atlas: Atlas, maxZ = atlas.detailCap): Promise<number> {
  let installed = 0;
  await Promise.all(Object.entries(manifestSprites).map(async ([name, def]) => {
    const urlFor = (suffix: string) => vehicleUrls[`../../assets/vehicles/${name}@${suffix}.png`];
    // GFX-01: the family must be authored at every detail level the quality
    // preset asks for — `low` is satisfied by @0.5x alone. A run with a
    // RAISED cap only fills the levels the sprite is still missing, so a
    // quality change never re-fetches a bitmap that is already installed.
    if (ZOOMS.some(([suffix, z]) => z <= maxZ && !urlFor(suffix))) return;
    const have = atlas.buildingImages.get(name);
    const missing = ZOOMS.filter(([, z]) => z <= maxZ && !have?.has(z));
    if (!missing.length) return;
    try {
      const images = await Promise.all(missing.map(([suffix]) => loadBitmap(urlFor(suffix) as string)));
      const map = have ?? new Map<number, AtlasImage>();
      for (let i = 0; i < missing.length; i++) map.set(missing[i][1], images[i]);
      atlas.buildingImages.set(name, map);
      const sprite: SpriteDef = {
        x: 0, y: 0, w: def.w, h: def.h,
        footprint: def.footprint,
        anchor: def.anchor,
      };
      atlas.manifest.sprites[name] = sprite;
      installed++;
    } catch (err) {
      // Only a FIRST install may fall back: dropping the def of a sprite that
      // already serves its installed levels would delete working art on a
      // failed fill pass.
      if (!atlas.buildingImages.get(name)?.size) delete atlas.manifest.sprites[name];
      console.warn(`[truck-brand] ${name}: not installed`, err);
    }
  }));
  return installed;
}
