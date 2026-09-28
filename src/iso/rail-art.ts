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

// ══════════════════════════════════════════════════════════════════════════
// RAIL-6 (#575) — THE STATION ART (art drop #578).
//
// Two families, both non-gating like the railway's own:
//
//   1. THE PAINTED PNGs — `assets/stations/station_wh_{1,2,3}@2x.png` (the
//      warehouse tiers) and `station_cap@2x.png` (the platform end), each with
//      an `_r` orientation for the other axis. Authored at 2× only, so the 2×
//      bitmap is installed and the atlas's own zoom fallback serves the rest.
//      The defs (footprint 1×1, anchor on the south vertex of the sprite's
//      ground pad) are measured from the PNGs' alpha, once, by hand.
//   2. THE CODE-PAINTED LANE SLAB — `station_lane_<view>`: one tile of flat
//      concrete with a light edge line along the side the track runs on,
//      generated here at load (there is no lane sprite; the owner's note on
//      #575 says paint it in code). No canvas (Node, jsdom) means no slab
//      sprite, and a station simply draws without its concrete — the rules
//      and the track never notice.
// ══════════════════════════════════════════════════════════════════════════

const stationUrls = import.meta.glob<string>(
  "../../assets/stations/*.png", { eager: true, import: "default" },
);

interface StationDef { w: number; h: number; anchor: [number, number] }
/** 1× world-pixel geometry, measured off each PNG's lowest opaque row. */
const STATION_DEFS: Record<string, StationDef> = {
  station_wh_1: { w: 120, h: 144, anchor: [59, 134] },
  station_wh_1_r: { w: 120, h: 144, anchor: [60, 134] },
  station_wh_2: { w: 120, h: 144, anchor: [56, 132.5] },
  station_wh_2_r: { w: 120, h: 144, anchor: [61.5, 133] },
  station_wh_3: { w: 160, h: 192, anchor: [79.5, 173] },
  station_wh_3_r: { w: 160, h: 192, anchor: [80, 173] },
  station_cap: { w: 80, h: 96, anchor: [44, 90] },
  station_cap_r: { w: 80, h: 96, anchor: [35, 90] },
};

/** Every station sprite name the loader may install (tiers, caps, slabs). */
export const STATION_SPRITE_NAMES: readonly string[] = [
  ...Object.keys(STATION_DEFS),
  "station_lane_ne", "station_lane_se", "station_lane_sw", "station_lane_nw",
];

/** Install the painted station PNGs. Returns how many landed (0 = no art). */
export async function loadStationSprites(atlas: Atlas, maxZ = atlas.detailCap): Promise<number> {
  if (maxZ < 2) maxZ = 2;   // authored at 2× only; the zoom fallback serves the rest
  let installed = 0;
  await Promise.all(Object.entries(STATION_DEFS).map(async ([name, def]) => {
    const url = stationUrls[`../../assets/stations/${name}@2x.png`];
    if (!url || atlas.buildingImages.get(name)?.has(2)) return;
    try {
      const img = await loadBitmap(url);
      atlas.buildingImages.set(name, new Map<number, AtlasImage>([[2, img]]));
      atlas.manifest.sprites[name] = {
        x: 0, y: 0, w: def.w, h: def.h,
        footprint: [1, 1],
        anchor: def.anchor,
      };
      installed++;
    } catch (err) {
      if (!atlas.buildingImages.get(name)?.size) delete atlas.manifest.sprites[name];
      console.warn(`[station] ${name}: not installed`, err);
    }
  }));
  return installed;
}

/** Flat concrete + one lit edge line: the lane slab, painted per view. */
const SLAB_CONCRETE = "#c9c3b6";
const SLAB_EDGE = "#ece7db";
const SLAB_GRAVEL = "#a49d8f";

/**
 * The four edges of the 2× tile diamond (centre 64,32), in cycle order, and
 * which one faces the lane's track side per view: se track at +x (the SE
 * edge), nw at -x (NW), sw at +y (SW), ne at -y (NE).
 */
const SLAB_VERTS: [number, number][] = [[64, 2], [126, 32], [64, 62], [2, 32]];
const SLAB_EDGES: [[number, number], [number, number]][] = [
  [SLAB_VERTS[0], SLAB_VERTS[1]], [SLAB_VERTS[1], SLAB_VERTS[2]],
  [SLAB_VERTS[2], SLAB_VERTS[3]], [SLAB_VERTS[3], SLAB_VERTS[0]],
];
const slabTrackEdge = (view: string): number =>
  (view === "ne" ? 0 : view === "se" ? 1 : view === "sw" ? 2 : 3);

/** Generate and install the four lane-slab sprites. 0 when there is no canvas. */
export function makeLaneSlabSprites(atlas: Atlas): number {
  if (typeof document === "undefined") return 0;
  let installed = 0;
  for (const view of ["ne", "se", "sw", "nw"]) {
    const name = `station_lane_${view}`;
    if (atlas.buildingImages.has(name)) continue;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) return installed;              // headless: no slab, no crash
    // The concrete diamond, a hair inside the tile so neighbouring slabs read
    // as one strip while the grass still shows between stations.
    ctx.beginPath();
    ctx.moveTo(64, 2);
    ctx.lineTo(126, 32);
    ctx.lineTo(64, 62);
    ctx.lineTo(2, 32);
    ctx.closePath();
    ctx.fillStyle = SLAB_CONCRETE;
    ctx.fill();
    // A gravel shoulder on the three quiet sides…
    const trackEdge = slabTrackEdge(view);
    ctx.lineWidth = 3;
    ctx.strokeStyle = SLAB_GRAVEL;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      if (i === trackEdge) continue;
      ctx.moveTo(SLAB_EDGES[i][0][0], SLAB_EDGES[i][0][1]);
      ctx.lineTo(SLAB_EDGES[i][1][0], SLAB_EDGES[i][1][1]);
    }
    ctx.stroke();
    // …and the lit platform edge along the track side, the line a train
    // stops beside.
    ctx.lineWidth = 5;
    ctx.strokeStyle = SLAB_EDGE;
    ctx.beginPath();
    ctx.moveTo(SLAB_EDGES[trackEdge][0][0], SLAB_EDGES[trackEdge][0][1]);
    ctx.lineTo(SLAB_EDGES[trackEdge][1][0], SLAB_EDGES[trackEdge][1][1]);
    ctx.stroke();
    atlas.buildingImages.set(name, new Map<number, AtlasImage>([[2, canvas]]));
    atlas.manifest.sprites[name] = {
      x: 0, y: 0, w: 64, h: 32,
      footprint: [1, 1],
      anchor: [32, 32],
    };
    installed++;
  }
  return installed;
}
