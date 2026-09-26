// ══════════════════════════════════════════════════════════════════════════
// SCENERY — ground decals and scattered trees.
//
// The W-series ground paints the island as ONE continuous meadow from a
// seamless grass texture. That kills the old per-tile sprite puzzle, which
// was the point, but it leaves a 144×144 field of the same green: the eye
// has nothing to hold on to and the map reads as flat. This module adds the
// two things that break it up, both PURE FUNCTIONS OF THE SEED (multiplayer
// ships only the seed — scenery must regenerate identically on every client,
// exactly like the terrain and the industries):
//
//   • DECALS — a FEW LARGE painted patches (bare earth, and three moods of
//     grass that differ from the base meadow) laid flat ON the meadow. Each
//     one spans several tiles and fades to nothing at its rim, so it reads as
//     a region of the landscape rather than a sticker: the first pass used
//     many small ovals and the map just looked speckled. They live on the
//     TERRAIN canvas, above the chunk-cached ground and below the surf, and
//     are pure decoration: nothing reads them, nothing collides with them.
//
//     Placement is INDEPENDENT and EXCLUSIVE (`scatterDecals`): every patch
//     draws its own size, turn, padding, family and opacity, looks for a
//     random point on its own, and is rejected if that ground is not clear.
//     Nothing seeds a patch from a neighbour — no cluster centres, no shared
//     tile, no family batches — so the only structure in the layout is the
//     spacing the exclusion rule imposes. Two rules do the work: a patch must
//     keep its ink (plus its own padding) off the beach and clear of the sea,
//     and it must not overlap any patch already down. Both are answered
//     against a uniform spatial hash, so the whole scatter stays linear
//     instead of O(n²) in patches placed.
//
//   • TREES — 1×1 sprites scattered in CLUMPS, because scattered-uniform
//     trees read as wallpaper while clumps read as woodland. Stored as one
//     byte per tile (`Uint8Array`, 0 = none) so the renderer picks them up
//     inside the tile loop it already runs, and depth-sorted with the
//     buildings so a lorry passes behind a tree properly.
//
// Trees are DECOR, not obstacles: they are never written to `grid.occupancy`,
// so every placement/build rule is untouched by them, they are skipped by
// picking (`decor` on the draw item), and the renderer simply stops drawing
// one the moment a road, a plant or a depot lands on its tile — the tree was
// cleared to make way, which is also what the player expects to see.
// ══════════════════════════════════════════════════════════════════════════
import { HW, HH, MAP_W, MAP_H, TILE_W, TILE_H, mulberry32 } from "../game/config";
import {
  GRASS, ROUGH, WATER, chebyshevField, idx, inBounds, townGroundBytes, type Grid,
} from "./grid";

/**
 * Every tree sprite, in the order the per-tile byte indexes them (1-based).
 * Cut from the supplied tree sheet by tools/make-scenery-art.mjs: six painted
 * species, each shipped at three or four SIZES so a wood is a mix of ages
 * rather than a row of identical stamps. Size is the only transform — the art
 * is never mirrored, because every tree on the sheet is lit from the upper
 * right and a mirrored copy is lit from the upper left, which reads as two
 * suns the moment both are on screen.
 *
 * Hand-maintained to match the tool's output (it prints this list when it
 * runs) and cross-checked against the shipped manifest by the unit tests, so
 * the two cannot drift apart silently.
 */
export const TREE_SPRITES = [
  "tree_dead_a", "tree_dead_b", "tree_dead_c",
  "tree_bush_a", "tree_bush_b", "tree_bush_c", "tree_bush_d",
  "tree_pine_a", "tree_pine_b", "tree_pine_c", "tree_pine_d",
  "tree_oak_a", "tree_oak_b", "tree_oak_c", "tree_oak_d",
  "tree_maple_a", "tree_maple_b", "tree_maple_c", "tree_maple_d",
  "tree_birch_a", "tree_birch_b", "tree_birch_c", "tree_birch_d",
] as const;
export type TreeSprite = (typeof TREE_SPRITES)[number];

/**
 * The multi-tile forest blocks, cut from the supplied forest art. These are
 * NOT big trees: each is one 4x4 painted wood that anchors a clump, with the
 * 1x1 trees feathering out around its edge, which is what makes a wood read
 * as a wood at map scale instead of as a grid of separate trees.
 */
export const FOREST_SPRITES = ["forest_conifer", "forest_mixed"] as const;
export type ForestSprite = (typeof FOREST_SPRITES)[number];

/** Footprint of a forest block, in tiles. Must match the art tool. */
export const FOREST_FOOTPRINT = 4;

/** One placed forest block, at its footprint origin. */
export interface Forest {
  tx: number;
  ty: number;
  sprite: ForestSprite;
}

/**
 * The decal families. This is the family list, not a paint order: patches no
 * longer overlap (`scatterDecals` reserves each one's ground), so there is no
 * "bare earth under the grass moods" layering left to arbitrate — the list is
 * painted back to front by depth alone, and the families only pick art and
 * weight the mix.
 */
export const DECAL_KINDS = ["bare", "dry", "rocky", "lush", "garden"] as const;

/**
 * #437 — the GARDEN family is not one of the wild moods.
 *
 * It is never drawn by `scatterDecals` (it is absent from `DECAL_MIX` on
 * purpose): a hedge or a flower bed belongs to a town lot, not to open
 * country. It is placed by `scatterTownGardens` on the town blocks instead,
 * and painted over the block's lawn.
 *
 * The family exists so the lead can DROP THE ART IN and have it appear:
 * `loadDecalImages` globs `assets/ground/decals/<family>_<n>.webp`, so
 * `garden_1.webp`, `garden_2.webp`, … are picked up with no code change.
 * Until they exist the bank is empty and the paint pass skips every garden,
 * which is exactly the town with no gardens we ship today.
 */
export const GARDEN_KIND: DecalKind = "garden";
export type DecalKind = (typeof DECAL_KINDS)[number];

/**
 * One painted ground patch. `wx`/`wy` are the WORLD-space (1×) centre and
 * `w` the world-space width; the art is authored 2:1 squashed (it lies flat
 * on the iso ground), so the drawn height is always `w / 2`.
 *
 * `rot`, `pad` and `reach` are the placement's own record of the patch: the
 * turn it was given, the ground it keeps clear around itself, and the
 * tile-space radius its turned art box reaches. `reach` is derived — it lives
 * on the decal because the paint pass tests it against the visible range for
 * EVERY patch on the map, every frame, and must not do trig or division to
 * get it.
 */
export interface Decal {
  tx: number;
  ty: number;
  kind: DecalKind;
  /** Which variant PNG within the family. */
  variant: number;
  wx: number;
  wy: number;
  w: number;
  alpha: number;
  /**
   * Mirror the art horizontally. A ground patch mirrored across the screen's
   * vertical axis is still a valid ground patch in this projection (it just
   * swaps the two ground axes), so this doubles the apparent variety of a
   * small set of large, memorable shapes for the price of one transform.
   */
  flip: boolean;
  /**
   * Turn the patch ON THE GROUND, in radians, about its own centre. A ground
   * texture has no up, so this is free variety: the art tool cuts three turned
   * variants per family and the mirror above doubles them, but a continuous
   * turn makes every patch on the map a different shape without shipping one
   * more pixel.
   */
  rot: number;
  /**
   * This patch's OWN padding, in tiles: clear ground it keeps between its ink
   * and everything it must not touch — the sea, the beach, and every other
   * patch. Drawn per patch, so the spacing between two neighbours is the sum
   * of theirs, and the gaps vary instead of reading as a laid-out grid.
   */
  pad: number;
  /** Tile-space radius of the turned art box, plus a tile of slop. */
  reach: number;
}

export interface Scenery {
  decals: Decal[];
  /**
   * #437: the garden details on the town blocks — hedges, flower beds, paths.
   * Separate from `decals` because they are painted in a different pass (over
   * the block's lawn, under the kerbs) and placed by a different rule. Empty
   * until the `garden_*` art exists, and harmless when it does not.
   */
  gardens: Decal[];
  /** Per tile: 0 = no tree, else 1-based index into TREE_SPRITES. */
  trees: Uint8Array;
  /** The multi-tile forest blocks, at their footprint origins. */
  forests: Forest[];
  /** RES-FIELDS: the 2×2 wheat fields and tree blocks beside Farms and Forests. */
  fields: Field[];
}

/**
 * RES-FIELDS: the 2×2 dressing laid beside a resource — wheat fields round a
 * Farm, tree blocks round a Forest. Unlike the rest of the scenery these are
 * OBSTACLES: the game stamps their tiles `FIELD_OCC` so nothing builds on them
 * until the player demolishes one. They all go on ONE side of the resource,
 * so its other sides stay open for a Depot.
 */
export const FIELD_SIZE = 2;
export const FIELD_SPRITE_FOR: Readonly<Record<string, FieldSprite>> = {
  farm: "wheat_field",
  forest: "trees",
};
export type FieldSprite = "wheat_field" | "trees";
export interface Field {
  /** Stable index into `Scenery.fields` — what a save and the wire name. */
  id: number;
  tx: number;
  ty: number;
  sprite: FieldSprite;
}
/** The fewest blocks a side must take before it is chosen outright. */
export const FIELDS_MIN = 6;
/** How many 2×2 rows a side may stack outward from the resource. */
const FIELD_ROWS = 4;

// ── tuning: decals ──────────────────────────────────────────────────────────
/**
 * Nominal patch width in world pixels. A tile diamond is 64 wide, so the base
 * is 2½ tiles and the scale range below takes a patch from roughly 1¾ to 5
 * tiles across.
 *
 * Halved. The patches were drawn up to ten tiles wide from a 768px texture,
 * which at the 2× camera meant stretching that texture across some 1300
 * screen pixels — visibly soft, and the pixels showed. Half the width is a
 * quarter of the area per patch and twice the texture density.
 */
const DECAL_BASE_W = 160;
const DECAL_SCALE_MIN = 0.7, DECAL_SCALE_MAX = 1.9;
/**
 * Patches WANTED per eligible tile — a tile that is open ground and far enough
 * inland to host the smallest patch. It is a ceiling, not a quota: every patch
 * now reserves its own ground, so a crowded map simply stops early rather than
 * stacking patches to hit the number. The old scatter treated density as a
 * quota it always met, and met it by letting ~300 pairs of patches overlap.
 */
const DECAL_DENSITY = 1 / 50;
/**
 * Rejection-sampling budget, per patch wanted. Placing a patch that must not
 * touch any other is a search, and the search gets harder as the map fills:
 * the budget is what bounds it. Thirty-odd tries per wanted patch fills the
 * island to where the remaining misses are genuinely full (the placement
 * curve is flat by then — doubling the budget buys a handful of patches), and
 * costs a few tens of milliseconds on a 144×144 map, inside the map-load
 * budget the scenery already shares with the trees.
 */
const DECAL_ATTEMPTS = 32;
/**
 * Tiles of clear grass a patch keeps between its ink and the shoreline, ON TOP
 * of its own reach and its own padding. The beach is one tile of SAND and the
 * surf animates over the water line, so a patch whose feather dies two tiles
 * inland of them reads as ground; one that dies on the sand reads as a stain
 * in the sea.
 */
export const DECAL_SHORE_PAD = 2;
/**
 * A patch's OWN padding band, in tiles. Individual on purpose: the gap between
 * two neighbours is the sum of theirs, so gaps vary from patch to patch and
 * the layout never settles into a visible rhythm.
 */
export const DECAL_PAD_MIN = 0.4, DECAL_PAD_MAX = 2.2;
/**
 * How much of the art's ground box the painted blob actually inks. The tool
 * trims each variant to its alpha bbox and stretches it back to 768×384, so
 * the ink does reach the box — but only at its widest: the corners of the box
 * are the faintest part of the feather. Reserving the whole box would push
 * neighbours apart over transparent pixels, so the exclusion test reserves
 * this much of it and the shore/cull tests keep using the full box.
 */
export const DECAL_INK = 0.86;
/**
 * Spatial-hash cell for the exclusion test, in tiles. Sized above the widest
 * ground any one patch can reserve (~6 tiles: the largest ink square's
 * circumradius plus the largest padding), so a candidate's lookup spans a
 * couple of cells in each direction and the no-overlap rule costs a handful of
 * separating-axis tests instead of a pass over every patch already placed.
 */
const DECAL_CELL = 8;
/**
 * Forest blocks per land tile. Each covers 16 tiles and is a landmark, so a
 * handful per map is the point — roughly two dozen on a 144x144 island.
 */
const FOREST_DENSITY = 1 / 700;
/** Tree clumps per land tile, and the size of one clump. */
const CLUMP_DENSITY = 1 / 150;
const CLUMP_MIN = 4, CLUMP_MAX = 17;
/** Lone trees per land tile — the strays that stop clumps looking placed. */
const STRAY_DENSITY = 1 / 200;
/** Chance a tree inside a clump breaks from the clump's species. */
const OFF_SPECIES = 0.18;
/**
 * FOREST-01: pine clusters around each lumber (`forest`) industry — how many
 * clusters, how far out from the footprint edge (tiles), and trees per cluster.
 * The ring starts past the site so the Depot/Harvester approach stays open.
 */
const PINE_CLUSTERS_MIN = 3, PINE_CLUSTERS_MAX = 5;
const PINE_RING_MIN = 2.5, PINE_RING_MAX = 6;
const PINE_CLUSTER_MIN = 7, PINE_CLUSTER_MAX = 13;
/**
 * FOREST-01: painted 4×4 `forest_conifer` blocks set beside each Forest
 * resource, the tries allowed to find room for them, and how far past the
 * footprint (tiles) a block's centre may drift.
 */
const CONIFER_BLOCKS = 2;
const CONIFER_BLOCK_ATTEMPTS = 40;
const CONIFER_BLOCK_SLACK = 3;

/**
 * Tiles of clear ground a tree keeps from any seed-generated road, measured
 * as Chebyshev distance.
 *
 * A tree standing right against a road hides the road at the camera's angle —
 * the canopy is drawn well above its own tile — and roads are what the player
 * is looking at while building. The clearance applies to the roads that exist
 * when the map is made: the inter-town highways and the town streets. Roads
 * the player lays later cannot move a tree, so the renderer simply stops
 * drawing one that has been built over.
 */
const TREE_ROAD_CLEARANCE = 3;

/**
 * Weighted family mix for decals. Bare earth leads — it is the only family
 * that breaks the green outright — and the grass moods share the rest.
 */
const DECAL_MIX: [DecalKind, number][] = [
  ["bare", 0.3], ["dry", 0.25], ["rocky", 0.23], ["lush", 0.22],
];

/** A dead tree — an accent, never the character of a wood. */
const isDead = (name: string) => name.startsWith("tree_dead");

/**
 * Two mixes, because a clump repeats its PRIMARY tree across most of its
 * tiles. Letting a dead tree be primary produces an entire copse of
 * them perhaps one clump in ten — which does not read as variety, it reads
 * as blight. So dead trees can only ever arrive through the off-species
 * break, where they are the occasional dead tree in a living wood.
 */
const PRIMARY_MIX: [number, number][] = (() => {
  const living = TREE_SPRITES.map((n, i) => [i + 1, isDead(n) ? 0 : 1] as [number, number])
    .filter(([, w]) => w > 0);
  return living.map(([i]) => [i, 1 / living.length]);
})();

/** The off-species mix: every sprite, with the dead trees kept rare. */
const ACCENT_MIX: [number, number][] = (() => {
  const raw = TREE_SPRITES.map((n) => (isDead(n) ? 0.3 : 1));
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((w, i) => [i + 1, w / total]);
})();

function weighted<T>(mix: [T, number][], r: number): T {
  let acc = 0;
  for (const [v, w] of mix) {
    acc += w;
    if (r < acc) return v;
  }
  return mix[mix.length - 1][0];
}

/** Tiles a tree or decal may stand on: open, unowned, unpaved land. */
function buildable(grid: Grid, publicRoad: Set<number>): (i: number) => boolean {
  return (i) => {
    const v = grid.terrain[i];
    // SAND is deliberately excluded: the beach ring is its own painted
    // terrace and a pine growing out of it reads as a mistake.
    if (v !== GRASS && v !== ROUGH) return false;
    // occupancy: >= 0 an industry, -2 a town (houses, centre, ring road).
    if (grid.occupancy[i] !== -1) return false;
    return !publicRoad.has(i);
  };
}

/**
 * Tiles-to-nearest-water for every tile, by multi-source BFS from the sea.
 * Water itself is 0. Capped at `max` because nothing here cares how deep
 * inland a tile is beyond the largest patch's reach, and the cap keeps the
 * queue short on a mostly-land map.
 */
export function waterDistance(grid: Grid, max = 12): Uint8Array {
  const n = MAP_W * MAP_H;
  const dist = new Uint8Array(n).fill(max);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) {
    if (grid.terrain[i] === WATER) { dist[i] = 0; frontier.push(i); }
  }
  for (let d = 1; d < max && frontier.length; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        const j = ny * MAP_W + nx;
        if (dist[j] <= d) continue;
        dist[j] = d;
        next.push(j);
      }
    }
    frontier = next;
  }
  // Off-map counts as sea: a patch must not hang over the stage edge either.
  for (let i = 0; i < n; i++) {
    const x = i % MAP_W, y = (i / MAP_W) | 0;
    const edge = Math.min(x, y, MAP_W - 1 - x, MAP_H - 1 - y);
    if (edge < dist[i]) dist[i] = edge;
  }
  return dist;
}

/**
 * Chessboard distance from every tile to the nearest sea tile — or to the edge
 * of the stage, which counts as sea exactly as `waterDistance` treats it. Read
 * it as: the half-size of the largest TILE BOX centred on this tile that holds
 * no water.
 *
 * A decal's footprint IS a box (its art box, turned), so this is the field that
 * answers "does the rim reach the beach?" without guessing. `waterDistance`
 * spreads over 4 neighbours and measures an L1 ball: comparing a box's
 * half-width against that under-protects the box's corners, and a corner is
 * exactly where a turned patch reaches farthest.
 *
 * Computed as a two-pass raster transform rather than the BFS `chebyshevField`
 * runs, because it is called on every map load and the transform is the same
 * answer for a fifth of the work: a king reaches any tile in
 * max(|dx|, |dy|) moves, so one forward scan over the four already-visited
 * neighbours and one backward scan over their mirror images settle every tile
 * exactly — no queue, no allocation, two passes over the map. A unit test
 * cross-checks it against the BFS so the shortcut cannot drift.
 */
export function coastClearance(grid: Grid): Uint8Array {
  const n = MAP_W * MAP_H;
  // 255 stands in for ∞: the true distance across a 144×144 stage never
  // reaches it, and `min` is always applied before a store, so the +1 below
  // can never wrap a byte.
  const clear = new Uint8Array(n).fill(255);
  for (let i = 0; i < n; i++) if (grid.terrain[i] === WATER) clear[i] = 0;
  for (let x = 0; x < MAP_W; x++) { clear[x] = 0; clear[(MAP_H - 1) * MAP_W + x] = 0; }
  for (let y = 0; y < MAP_H; y++) { clear[y * MAP_W] = 0; clear[y * MAP_W + MAP_W - 1] = 0; }

  for (let y = 0; y < MAP_H; y++) {
    const row = y * MAP_W, prev = row - MAP_W;
    for (let x = 0; x < MAP_W; x++) {
      const i = row + x;
      let d = clear[i];
      if (x > 0 && clear[i - 1] + 1 < d) d = clear[i - 1] + 1;
      if (y > 0) {
        if (clear[prev + x] + 1 < d) d = clear[prev + x] + 1;
        if (x > 0 && clear[prev + x - 1] + 1 < d) d = clear[prev + x - 1] + 1;
        if (x + 1 < MAP_W && clear[prev + x + 1] + 1 < d) d = clear[prev + x + 1] + 1;
      }
      clear[i] = d;
    }
  }
  for (let y = MAP_H - 1; y >= 0; y--) {
    const row = y * MAP_W, next = row + MAP_W;
    for (let x = MAP_W - 1; x >= 0; x--) {
      const i = row + x;
      let d = clear[i];
      if (x + 1 < MAP_W && clear[i + 1] + 1 < d) d = clear[i + 1] + 1;
      if (y + 1 < MAP_H) {
        if (clear[next + x] + 1 < d) d = clear[next + x] + 1;
        if (x + 1 < MAP_W && clear[next + x + 1] + 1 < d) d = clear[next + x + 1] + 1;
        if (x > 0 && clear[next + x - 1] + 1 < d) d = clear[next + x - 1] + 1;
      }
      clear[i] = d;
    }
  }
  return clear;
}

// ── decal placement ─────────────────────────────────────────────────────────
/**
 * Ground-space (tile) coordinates of a world point — the inverse of the
 * projection the decals are placed in. A tile's centre is its own integer
 * ground coordinate, so a patch can sit at any REAL ground point rather than
 * on the tile lattice: `gx = 40.3` is a third of the way across tile 40.
 */
export const groundOf = (wx: number, wy: number): [number, number] => [
  wx / TILE_W + (wy - HH) / TILE_H,
  (wy - HH) / TILE_H - wx / TILE_W,
];

/** World position of a ground point: the projection the decals are placed in. */
const worldOf = (gx: number, gy: number): [number, number] => [
  (gx - gy) * HW, (gx + gy) * HH + HH,
];

/**
 * The ground a patch's art actually covers — and it is NOT the box the blit
 * looks like. Drawn as a `w × w/2` screen rect, the art covers the ground
 * diamond |dx| + |dy| ≤ w / TILE_W: invert the projection on the rect's
 * corners and they land on the ground AXES at ±w/64 tiles, not on a square's
 * sides. So one patch is a square turned 45° to the tile grid, tip to tip
 * `w / 64` tiles along each ground axis and `w / 64 · √2` tiles side to side.
 *
 * Everything below measures that square. Getting it wrong is not a rounding
 * question: measuring the drawn rect as though it were an axis-aligned ground
 * square understates the footprint by √2, which is exactly how the old scatter
 * came to feather patches onto the beach and stack them on each other.
 */
/** Half-diagonal of a patch's ground diamond, in tiles: its reach at rot 0. */
const decalDiagonal = (w: number): number => w / TILE_W;
/** Half-side of that square, in tiles (a square's side is diagonal / √2). */
const decalSide = (w: number): number => w / TILE_W / Math.SQRT2;
/** Half-side of the INK inside it — see `DECAL_INK`. */
const decalInkSide = (w: number): number => decalSide(w) * DECAL_INK;
/**
 * The square's own axes sit 45° off the tile grid before the patch is even
 * turned, because the blit is a screen-aligned rect (see `decalDiagonal`).
 */
const decalAxisAngle = (rot: number): number => rot + Math.PI / 4;

/**
 * Tile-space radius of a turned patch: how far it reaches along each ground
 * axis. The square's half-side h at axis angle φ covers h·(|cos φ| + |sin φ|),
 * which at φ = rot + 45° collapses to the diagonal times max(|cos rot|,
 * |sin rot|) — D at rot 0, D/√2 at 45°, and never less.
 *
 * One tile of slop goes on top, for the two half-tiles the comparison cannot
 * see: the patch's centre is a random point INSIDE its tile, and a sea tile's
 * own area reaches half a tile back towards it.
 *
 * Computed once, at scatter time, and carried on the decal — the paint pass
 * runs this test for every patch on the map, every frame, visible or not, so
 * it must not cost trig or a division per patch to answer.
 */
export const decalReach = (w: number, rot: number): number =>
  decalDiagonal(w) * Math.max(Math.abs(Math.cos(rot)), Math.abs(Math.sin(rot))) + 1;

/**
 * The ground one patch reserves: its ink square, turned by θ, grown by its own
 * padding. `u`/`v` are the square's own unit axes, so a projection onto any
 * direction is arithmetic on four numbers rather than a corner loop.
 */
interface Spot {
  gx: number;
  gy: number;
  half: number;
  pad: number;
  ux: number; uy: number;
  vx: number; vy: number;
  /** Broad-phase radius: the ink square's circumradius, plus the padding. */
  r: number;
}

const spotOf = (gx: number, gy: number, w: number, rot: number, pad: number): Spot => {
  const half = decalInkSide(w), a = decalAxisAngle(rot);
  const cos = Math.cos(a), sin = Math.sin(a);
  return {
    gx, gy, half, pad,
    ux: cos, uy: sin, vx: -sin, vy: cos,
    r: half * Math.SQRT2 + pad,
  };
};

/** The reserved ground of a patch that is already down. */
const spotOfDecal = (d: Decal): Spot => {
  const [gx, gy] = groundOf(d.wx, d.wy);
  return spotOf(gx, gy, d.w, d.rot, d.pad);
};

/**
 * Separating-axis test between two reserved grounds. A square of half-side h
 * grown by p projects onto an axis n as h·(|n·u| + |n·v|) + p, so if any one of
 * the four edge normals has room for both projections, a line separates the two
 * shapes and they cannot overlap. Exact for the shapes actually reserved — a
 * bounding-circle test would turn two patches that meet corner to corner away
 * from each other for no reason, and the coast is where they have to fit.
 */
function spotsOverlap(a: Spot, b: Spot): boolean {
  const dx = b.gx - a.gx, dy = b.gy - a.gy;
  const wide = a.r + b.r;
  if (dx * dx + dy * dy > wide * wide) return false;
  const clears = (nx: number, ny: number): boolean => {
    const gap = Math.abs(dx * nx + dy * ny);
    const ra = a.half * (Math.abs(nx * a.ux + ny * a.uy) + Math.abs(nx * a.vx + ny * a.vy)) + a.pad;
    const rb = b.half * (Math.abs(nx * b.ux + ny * b.uy) + Math.abs(nx * b.vx + ny * b.vy)) + b.pad;
    return gap >= ra + rb;
  };
  return !(clears(a.ux, a.uy) || clears(a.vx, a.vy)
    || clears(b.ux, b.uy) || clears(b.vx, b.vy));
}

/**
 * Do two placed patches touch? The contract the scatter holds to, in the terms
 * a test can check: their ink, plus the padding each keeps for itself.
 */
export const decalsOverlap = (a: Decal, b: Decal): boolean =>
  spotsOverlap(spotOfDecal(a), spotOfDecal(b));

/**
 * Uniform hash of the reserved ground, `DECAL_CELL` tiles to a side, so a
 * candidate patch tests only the neighbours that could reach it. Without it
 * the no-overlap rule is a pass over every patch already placed, per attempt,
 * and rejection sampling multiplies that by every miss — quadratic in a number
 * the tuning above only wants to be in the hundreds.
 */
class SpotHash {
  private readonly cols = Math.ceil(MAP_W / DECAL_CELL);
  private readonly rows = Math.ceil(MAP_H / DECAL_CELL);
  private readonly cells: Spot[][] = [];
  constructor() {
    for (let i = 0; i < this.cols * this.rows; i++) this.cells.push([]);
  }

  insert(s: Spot): void {
    const x = Math.min(this.cols - 1, Math.max(0, Math.floor(s.gx / DECAL_CELL)));
    const y = Math.min(this.rows - 1, Math.max(0, Math.floor(s.gy / DECAL_CELL)));
    this.cells[y * this.cols + x].push(s);
  }

  /**
   * Every spot whose reserved ground could reach a disc of radius `r` at
   * (gx, gy) — the caller passes its own radius plus the widest any spot can
   * reserve, so a small candidate cannot miss a large neighbour.
   */
  near(gx: number, gy: number, r: number, out: Spot[]): void {
    out.length = 0;
    const x0 = Math.max(0, Math.floor((gx - r) / DECAL_CELL));
    const x1 = Math.min(this.cols - 1, Math.floor((gx + r) / DECAL_CELL));
    const y0 = Math.max(0, Math.floor((gy - r) / DECAL_CELL));
    const y1 = Math.min(this.rows - 1, Math.floor((gy + r) / DECAL_CELL));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const cell = this.cells[y * this.cols + x];
        for (let i = 0; i < cell.length; i++) out.push(cell[i]);
      }
    }
  }
}

/**
 * The decals: independent patches, each on ground it keeps to itself.
 *
 * One patch per attempt, drawn whole before it looks for anywhere to go —
 * size, turn, padding, family, variant, opacity, mirror — and then two tests,
 * both cheap and both answered without reference to any other patch's CHOICES:
 *
 *   1. SHORELINE. The turned art box, this patch's own padding and a fixed
 *      margin of clear grass must all fit between its centre tile and the sea
 *      (`coastClearance`, measured in tile boxes because the footprint is a
 *      box). The beach is its own painted terrace and the surf animates over
 *      the water line, so a patch that dies on either reads as a spill.
 *   2. OVERLAP. The reserved ground must not touch any patch already down,
 *      looked up through the spatial hash.
 *
 * The location is a random point INSIDE a random eligible tile, so patches sit
 * off the tile lattice and no two share a tile: the exclusion rule is wider
 * than a tile, which is what makes "one patch per tile" a consequence rather
 * than a rule. Candidates are sampled from a list pre-filtered to tiles that
 * could host the SMALLEST patch, so the loop spends its rejections on spacing
 * — the interesting question — and not on the beach.
 */
function scatterDecals(rng: () => number, open: (i: number) => boolean, clear: Uint8Array): Decal[] {
  // The least any patch can need: the smallest art, turned to its narrowest
  // (45°, where the square sits flush with the tile grid), at its least padding.
  const minNeed = decalDiagonal(DECAL_BASE_W * DECAL_SCALE_MIN) / Math.SQRT2 + 1
    + DECAL_PAD_MIN + DECAL_SHORE_PAD;
  const spots: number[] = [];
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    if (open(i) && clear[i] >= minNeed) spots.push(i);
  }
  const decals: Decal[] = [];
  if (!spots.length) return decals;

  const target = Math.max(1, Math.round(spots.length * DECAL_DENSITY));
  // The widest ground any one patch can reserve, so the hash lookup below is
  // wide enough for the pair and not just for the candidate.
  const maxReserve = decalInkSide(DECAL_BASE_W * DECAL_SCALE_MAX) * Math.SQRT2 + DECAL_PAD_MAX;
  const hash = new SpotHash();
  const near: Spot[] = [];

  for (let attempt = 0; attempt < target * DECAL_ATTEMPTS && decals.length < target; attempt++) {
    const i = spots[(rng() * spots.length) | 0];
    const tx = i % MAP_W, ty = (i / MAP_W) | 0;
    const w = DECAL_BASE_W * (DECAL_SCALE_MIN + rng() * (DECAL_SCALE_MAX - DECAL_SCALE_MIN));
    const rot = rng() * Math.PI * 2;
    const pad = DECAL_PAD_MIN + rng() * (DECAL_PAD_MAX - DECAL_PAD_MIN);
    const reach = decalReach(w, rot);
    // 1. the shoreline: the turned box, this patch's own padding, and a fixed
    //    margin of clear grass must all fit between the centre and the sea.
    //    `reach` already carries the two half-tiles this comparison cannot
    //    see — the centre's random offset inside its tile, and the sea tile's
    //    own area reaching back towards it.
    if (clear[i] < reach + pad + DECAL_SHORE_PAD) continue;
    // A random point inside the tile, so the layout is not a lattice of tile
    // centres nudged by a fixed jitter.
    const gx = tx + rng() - 0.5, gy = ty + rng() - 0.5;
    // 2. the neighbours: reserved ground, ink plus each patch's own padding
    const spot = spotOf(gx, gy, w, rot, pad);
    hash.near(gx, gy, spot.r + maxReserve, near);
    let room = true;
    for (let k = 0; k < near.length; k++) {
      if (spotsOverlap(spot, near[k])) { room = false; break; }
    }
    if (!room) continue;
    hash.insert(spot);
    const [wx, wy] = worldOf(gx, gy);
    decals.push({
      tx, ty,
      kind: weighted(DECAL_MIX, rng()),
      variant: (rng() * 1024) | 0,          // resolved against the file count at load
      wx, wy, w,
      alpha: 0.5 + rng() * 0.42,
      flip: rng() < 0.5,
      rot, pad, reach,
    });
  }

  // Painter's order, back to front: the reserved ground is the INK, which is a
  // little smaller than the art box, so two neighbours' faintest feather can
  // still meet — and where it does, the nearer patch lies over the farther one.
  decals.sort((a, b) => (a.tx + a.ty) - (b.tx + b.ty));
  return decals;
}

/**
 * Deterministic scenery for a grid. Seeded off `grid.seed` with its own
 * stream offset, so adding/removing scenery can never shift the terrain or
 * industry generators that already consumed that seed.
 */
export function scatterScenery(grid: Grid): Scenery {
  const rng = mulberry32((grid.seed ^ 0x5ce9e12b) >>> 0);
  const publicRoad = new Set<number>();
  for (const [x, y] of grid.publicRoads ?? []) if (inBounds(x, y)) publicRoad.add(idx(x, y));
  const open = buildable(grid, publicRoad);

  // Distance from every tile to the nearest seed-generated road — the
  // highways plus every town street — so trees can keep clear of them.
  const roadTiles = new Set<number>(publicRoad);
  for (const t of grid.towns) {
    for (const [x, y] of t.roads) if (inBounds(x, y)) roadTiles.add(idx(x, y));
  }
  const toRoad = chebyshevField(roadTiles);
  const clearOfRoads = (i: number) => toRoad[i] >= TREE_ROAD_CLEARANCE;

  // The land tiles, collected once — both scatters sample from this list, so
  // density is per LAND tile and does not swing with how much ocean a seed
  // happened to generate.
  const land: number[] = [];
  for (let i = 0; i < MAP_W * MAP_H; i++) if (grid.terrain[i] !== WATER) land.push(i);
  const pick = () => land[(rng() * land.length) | 0];

  // ── decals ──
  // Two distance fields, because the two scatters ask different questions of
  // the coast: a patch's footprint is a BOX (its art box, turned), so it is
  // measured against `coastClearance` — the largest water-free tile box around
  // a tile — while a forest block's footprint is a 4×4 of tiles walked one at
  // a time, which `waterDistance` already answers per tile.
  //
  // The decal pass runs on its OWN stream, the way the Forest-resource woods
  // do, so from here on retuning or rewriting the patches cannot shift a
  // single tree: the two scatters never share a draw.
  const toWater = waterDistance(grid);
  const decals = scatterDecals(mulberry32((grid.seed ^ 0x2dec417b) >>> 0), open, coastClearance(grid));

  // ── forest blocks ──
  // Placed BEFORE the single trees, and their 16 tiles are then reserved, so
  // a 1×1 tree can never sprout out of the middle of a painted wood.
  const trees = new Uint8Array(MAP_W * MAP_H);
  const underForest = new Uint8Array(MAP_W * MAP_H);
  // RES-FIELDS first: their tiles are reserved like a forest block's, so no
  // tree or painted wood lands on a field.
  const fields = layResourceFields(grid, open, underForest);
  const forests: Forest[] = [];
  const forestAttempts = Math.round(land.length * FOREST_DENSITY);
  for (let n = 0; n < forestAttempts; n++) {
    const i = pick();
    const tx = i % MAP_W, ty = (i / MAP_W) | 0;
    let ok = true;
    for (let dy = 0; dy < FOREST_FOOTPRINT && ok; dy++) {
      for (let dx = 0; dx < FOREST_FOOTPRINT && ok; dx++) {
        const x = tx + dx, y = ty + dy;
        if (!inBounds(x, y)) { ok = false; break; }
        const j = idx(x, y);
        // The art's canopy overhangs the footprint generously, so the block
        // needs clearance from the coast as well as clear ground.
        if (underForest[j] || !open(j) || toWater[j] < FOREST_FOOTPRINT) ok = false;
        else if (!clearOfRoads(j)) ok = false;
      }
    }
    if (!ok) continue;
    for (let dy = 0; dy < FOREST_FOOTPRINT; dy++) {
      for (let dx = 0; dx < FOREST_FOOTPRINT; dx++) underForest[idx(tx + dx, ty + dy)] = 1;
    }
    forests.push({
      tx, ty,
      sprite: FOREST_SPRITES[(rng() * FOREST_SPRITES.length) | 0],
    });
  }

  // ── trees ──
  const plant = (tx: number, ty: number, species: number): void => {
    if (!inBounds(tx, ty)) return;
    const i = idx(tx, ty);
    if (trees[i] || underForest[i] || !open(i) || !clearOfRoads(i)) return;
    trees[i] = species;
  };

  // A ring of single trees around each block, so the painted wood feathers
  // into the meadow instead of ending on its own footprint edge. The interior
  // is reserved, so these can only land on the outside.
  for (const f of forests) {
    const cx = f.tx + (FOREST_FOOTPRINT - 1) / 2, cy = f.ty + (FOREST_FOOTPRINT - 1) / 2;
    const primary = weighted(PRIMARY_MIX, rng());
    const skirt = 10 + ((rng() * 10) | 0);
    for (let k = 0; k < skirt; k++) {
      const a = rng() * Math.PI * 2;
      const r = FOREST_FOOTPRINT / 2 + rng() * 2.4;
      plant(
        Math.round(cx + Math.cos(a) * r),
        Math.round(cy + Math.sin(a) * r),
        rng() < OFF_SPECIES ? weighted(ACCENT_MIX, rng()) : primary,
      );
    }
  }

  const clumps = Math.round(land.length * CLUMP_DENSITY);
  for (let c = 0; c < clumps; c++) {
    const seedTile = pick();
    if (!open(seedTile)) continue;
    const cx = seedTile % MAP_W, cy = (seedTile / MAP_W) | 0;
    const primary = weighted(PRIMARY_MIX, rng());
    const count = CLUMP_MIN + ((rng() * (CLUMP_MAX - CLUMP_MIN + 1)) | 0);
    // Elliptical, randomly proportioned clump — a circular one reads as a
    // stamp when several land near each other.
    const rx = 1.4 + rng() * 3.4;
    const ry = 1.4 + rng() * 3.4;
    for (let k = 0; k < count; k++) {
      // sqrt(r) on the radius gives a uniform disc; squaring it back CLUSTERS
      // toward the middle, which is what a copse actually looks like.
      const a = rng() * Math.PI * 2;
      const d = rng() * rng();
      const sprite = rng() < OFF_SPECIES ? weighted(ACCENT_MIX, rng()) : primary;
      plant(
        Math.round(cx + Math.cos(a) * rx * d * 2),
        Math.round(cy + Math.sin(a) * ry * d * 2),
        sprite,
      );
    }
  }

  const strays = Math.round(land.length * STRAY_DENSITY);
  for (let s = 0; s < strays; s++) {
    const i = pick();
    plant(i % MAP_W, (i / MAP_W) | 0, weighted(ACCENT_MIX, rng()));
  }

  // A painted forest block at a tile origin, with the same rules the random
  // blocks above obey. Trees already standing on its 16 tiles are cleared, so
  // no 1×1 sprite pokes out of the middle of the painted wood.
  const tryForestBlock = (tx: number, ty: number, sprite: ForestSprite): boolean => {
    for (let dy = 0; dy < FOREST_FOOTPRINT; dy++) {
      for (let dx = 0; dx < FOREST_FOOTPRINT; dx++) {
        const x = tx + dx, y = ty + dy;
        if (!inBounds(x, y)) return false;
        const j = idx(x, y);
        if (underForest[j] || !open(j) || toWater[j] < FOREST_FOOTPRINT || !clearOfRoads(j)) return false;
      }
    }
    for (let dy = 0; dy < FOREST_FOOTPRINT; dy++) {
      for (let dx = 0; dx < FOREST_FOOTPRINT; dx++) {
        const j = idx(tx + dx, ty + dy);
        underForest[j] = 1;
        trees[j] = 0;
      }
    }
    forests.push({ tx, ty, sprite });
    return true;
  };

  plantForestResourceWoods(grid, plant, tryForestBlock);

  return { decals, gardens: scatterTownGardens(grid), trees, forests, fields };
}

// ── #437: town gardens ──────────────────────────────────────────────────────
/**
 * Nominal garden width in world pixels — and the number that keeps a hedge
 * out of the road.
 *
 * A patch drawn `w` wide covers a ground diamond of half-diagonal `w / 64`
 * tiles (see `decalDiagonal`: the art box is a square turned 45° to the tile
 * grid, NOT the axis-aligned rect the blit looks like). At the widest scale
 * that is 44.8 / 64 ≈ 0.70 tiles, and with `GARDEN_JITTER` on top the art
 * reaches at most ~0.88 tiles from its lot's centre — so the faint outer
 * feather can just touch a neighbouring lot inside the same 2×2 block, and
 * cannot reach across the kerb of the street beyond it.
 *
 * Small on purpose, then: these are a flower bed and a hedge in one yard, not
 * the patches that mood the open country (`DECAL_BASE_W` is 160 — two and a
 * half tiles).
 */
const GARDEN_BASE_W = 40;
const GARDEN_SCALE_MIN = 0.72, GARDEN_SCALE_MAX = 1.12;
/**
 * How far a garden's centre may wander from its lot's centre, in tiles. Kept
 * well inside a half-tile: a garden that drifted to the lot's edge would hang
 * over the kerb of the street beside it, and the street is not a garden.
 */
const GARDEN_JITTER = 0.18;
/**
 * The share of town lots that get a garden. Not every yard is planted — a
 * town where every single lot carries the same handful of art reads as
 * wallpaper — and the buildings cover most lots anyway, so this is really
 * "how dressed are the EMPTY lots".
 */
const GARDEN_DENSITY = 0.55;

/**
 * #437 — the garden details laid on a town's blocks.
 *
 * WHY THIS IS NOT PART OF `scatterDecals`: that pass moods the open country
 * and is forbidden from every owned tile (`buildable` refuses anything the
 * occupancy claims, towns included). Gardens are the opposite — they exist
 * ONLY on town ground. So they get their own pass, their own stream and their
 * own family, and the two can be retuned without disturbing each other.
 *
 * One candidate per town-block tile, in tile order, each drawing once from a
 * seeded stream: deterministic for a seed, and stable if the density or the
 * art count changes later. The tile a garden sits on may well end up under a
 * house — `townBuildings` decides that at paint time from the art manifest,
 * which this pass has no access to and does not need: a garden under a
 * building is simply never seen, and the lots the buildings do NOT cover are
 * the empty lots the ticket is about.
 *
 * Returns [] when the map has no towns, so a caller can treat "no towns" and
 * "no gardens" identically.
 */
export function scatterTownGardens(grid: Grid): Decal[] {
  const blocks = townGroundBytes(grid);
  if (!blocks) return [];
  const rng = mulberry32((grid.seed ^ 0x6a12d3f7) >>> 0);
  const gardens: Decal[] = [];
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const i = ty * MAP_W + tx;
      if (!blocks[i]) continue;
      // Every candidate draws the same five numbers whether or not it is
      // planted, so the density knob cannot reshuffle the whole town.
      const roll = rng(), scale = rng(), rot = rng(), jx = rng(), jy = rng();
      const variant = (rng() * 1024) | 0;
      if (roll >= GARDEN_DENSITY) continue;
      if (grid.terrain[i] === WATER) continue;
      const w = GARDEN_BASE_W * (GARDEN_SCALE_MIN + scale * (GARDEN_SCALE_MAX - GARDEN_SCALE_MIN));
      const gx = tx + (jx - 0.5) * 2 * GARDEN_JITTER;
      const gy = ty + (jy - 0.5) * 2 * GARDEN_JITTER;
      const [wx, wy] = worldOf(gx, gy);
      gardens.push({
        tx, ty,
        kind: GARDEN_KIND,
        variant,
        wx, wy, w,
        // Opaque: a garden is an object in a yard, not a wash over it.
        alpha: 1,
        flip: jx < 0.5,
        // Turned on the ground like every other patch, but only a little: a
        // hedge or a path reads as laid out, and a lot turned 40 degrees to
        // its own street looks like a mistake rather than like variety.
        rot: (rot - 0.5) * 0.5,
        pad: 0,
        reach: decalDiagonal(w) + 1,
      });
    }
  }
  return gardens;
}

/**
 * RES-FIELDS: lay at least `FIELDS_MIN` 2×2 blocks beside every Farm (wheat)
 * and Forest (trees), all on ONE side. A side fills row by row outward from
 * the resource's edge; a row stops the side as soon as none of its blocks fit,
 * so the dressing always touches the resource. Sides are tried in a seeded
 * order: the first to reach the minimum wins, otherwise the fullest one does.
 * Own seed stream, so nothing else in the scenery shifts.
 */
function layResourceFields(
  grid: Grid, open: (i: number) => boolean, reserved: Uint8Array,
): Field[] {
  const rng = mulberry32((grid.seed ^ 0x6f1e1d5b) >>> 0);
  const fields: Field[] = [];
  const S = FIELD_SIZE;
  const fits = (x: number, y: number): boolean => {
    for (let dy = 0; dy < S; dy++) {
      for (let dx = 0; dx < S; dx++) {
        if (!inBounds(x + dx, y + dy)) return false;
        const i = idx(x + dx, y + dy);
        if (reserved[i] || !open(i)) return false;
      }
    }
    return true;
  };
  for (const ind of grid.industries) {
    const sprite = FIELD_SPRITE_FOR[ind.type];
    if (!sprite) continue;
    // [NW, SE, NE, SW] in grid terms: −x, +x, −y, +y
    const origin = (side: number, row: number, col: number): [number, number] => {
      switch (side) {
        case 0: return [ind.tx - S * (row + 1), ind.ty + S * col];
        case 1: return [ind.tx + ind.w + S * row, ind.ty + S * col];
        case 2: return [ind.tx + S * col, ind.ty - S * (row + 1)];
        default: return [ind.tx + S * col, ind.ty + ind.h + S * row];
      }
    };
    const order = [0, 1, 2, 3];
    for (let k = order.length - 1; k > 0; k--) {
      const j = (rng() * (k + 1)) | 0;
      [order[k], order[j]] = [order[j], order[k]];
    }
    let best: [number, number][] = [];
    for (const side of order) {
      const cols = Math.ceil((side < 2 ? ind.h : ind.w) / S);
      const taken: [number, number][] = [];
      for (let row = 0; row < FIELD_ROWS; row++) {
        const inRow: [number, number][] = [];
        for (let col = 0; col < cols; col++) {
          const [x, y] = origin(side, row, col);
          if (fits(x, y)) inRow.push([x, y]);
        }
        if (!inRow.length) break;
        taken.push(...inRow);
      }
      if (taken.length > best.length) best = taken;
      if (best.length >= FIELDS_MIN) break;
    }
    for (const [x, y] of best) {
      for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) reserved[idx(x + dx, y + dy)] = 1;
      fields.push({ id: fields.length, tx: x, ty: y, sprite });
    }
  }
  return fields;
}

/** 1-based TREE_SPRITES indices of the pines. */
const PINES: number[] = TREE_SPRITES
  .map((n, i) => (n.startsWith("tree_pine") ? i + 1 : 0))
  .filter((i) => i > 0);

/**
 * FOREST-01: the Forest resource (the `forest` industry, which yields wood)
 * sits in its own pine wood, so the place that produces wood reads as woodland
 * at a glance instead of a building in a meadow:
 *   1. up to `CONIFER_BLOCKS` painted 4×4 `forest_conifer` blocks right beside
 *      the site — the pine-cluster IMAGE, the thing the eye actually lands on;
 *   2. then dense clusters of 1×1 pines fanned round it, feathering the blocks
 *      into the meadow.
 * Runs LAST and on its own seed stream, so every other scatter (decals, random
 * blocks, clumps, strays) is identical to what it was; everything here only
 * takes ground still open, under the same rules as any block or tree.
 */
function plantForestResourceWoods(
  grid: Grid,
  plant: (tx: number, ty: number, species: number) => void,
  tryForestBlock: (tx: number, ty: number, sprite: ForestSprite) => boolean,
): void {
  const rng = mulberry32((grid.seed ^ 0x9f1e57a3) >>> 0);
  const half = (FOREST_FOOTPRINT - 1) / 2;
  for (const ind of grid.industries) {
    if (ind.type !== "forest") continue;
    const cx = ind.tx + (ind.w - 1) / 2, cy = ind.ty + (ind.h - 1) / 2;
    const base = Math.max(ind.w, ind.h) / 2;

    // 1. the painted conifer woods, hugging the site: block CENTRES sit just
    //    past the footprint edge, on random bearings, until enough have landed.
    let blocks = 0;
    for (let attempt = 0; attempt < CONIFER_BLOCK_ATTEMPTS && blocks < CONIFER_BLOCKS; attempt++) {
      const a = rng() * Math.PI * 2;
      const dist = base + half + 1 + rng() * CONIFER_BLOCK_SLACK;
      const bx = Math.round(cx + Math.cos(a) * dist - half);
      const by = Math.round(cy + Math.sin(a) * dist - half);
      if (tryForestBlock(bx, by, "forest_conifer")) blocks++;
    }

    // 2. the 1×1 pine clusters
    const clusters = PINE_CLUSTERS_MIN + ((rng() * (PINE_CLUSTERS_MAX - PINE_CLUSTERS_MIN + 1)) | 0);
    // Spread the clusters round the site (an even fan plus jitter), so the
    // wood surrounds the camp rather than piling up on one side of it.
    const phase = rng() * Math.PI * 2;
    for (let k = 0; k < clusters; k++) {
      const a = phase + (k / clusters) * Math.PI * 2 + (rng() - 0.5) * 0.9;
      const dist = base + PINE_RING_MIN + rng() * (PINE_RING_MAX - PINE_RING_MIN);
      const ccx = cx + Math.cos(a) * dist, ccy = cy + Math.sin(a) * dist;
      const count = PINE_CLUSTER_MIN + ((rng() * (PINE_CLUSTER_MAX - PINE_CLUSTER_MIN + 1)) | 0);
      const rx = 1.2 + rng() * 1.6, ry = 1.2 + rng() * 1.6;
      for (let n = 0; n < count; n++) {
        // the clump's centre-weighted disc: a stand is thickest in the middle
        const t = rng() * Math.PI * 2, d = rng() * rng();
        plant(
          Math.round(ccx + Math.cos(t) * rx * d * 2),
          Math.round(ccy + Math.sin(t) * ry * d * 2),
          PINES[(rng() * PINES.length) | 0],
        );
      }
    }
  }
}

// ── painting ────────────────────────────────────────────────────────────────
/** Anything blittable — an ImageBitmap in the browser, a stub in tests. */
export interface SceneryImage { width: number; height: number }

/** The loaded decal PNGs, grouped by family (variants in file order). */
export type DecalImages = Record<DecalKind, SceneryImage[]>;

/**
 * Paint the decals that fall in a culled tile range onto the terrain canvas.
 * Runs AFTER the cached ground chunks and BEFORE the surf, so a patch lies on
 * the meadow but never over the foam.
 *
 * Decals are deliberately NOT baked into the ground chunk cache: a patch is
 * several tiles wide and would be clipped by whichever 8×8 chunk owned its
 * tile, leaving a hard straight cut every eight tiles. One drawImage per
 * visible patch (a few dozen) is cheaper than the seams would be to fix.
 *
 * The pass is built for the fact that it runs over EVERY patch on the map
 * every frame and blits only the few that are on screen:
 *   • the cull reads `d.reach`, computed once at scatter time — no trig, no
 *     division and no `Math.ceil` in the loop that runs ~400 times a frame;
 *   • the patches do not overlap, so this paints each ground pixel once
 *     instead of blending the same soft rim two or three times over;
 *   • the turn is one `transform` on the way in and one `restore` on the way
 *     out, and the mirror is folded into that matrix instead of costing a
 *     second transform of its own.
 */
export function paintDecals(
  ctx: CanvasRenderingContext2D,
  cam: { x: number; y: number; zoom: number },
  decals: Decal[],
  images: DecalImages,
  r: { x0: number; y0: number; x1: number; y1: number },
): number {
  const z = cam.zoom;
  const prev = ctx.globalAlpha;
  let drawn = 0;
  for (const d of decals) {
    // The turned art box's tile radius, plus the slop for the centre's random
    // offset inside its tile: big patches must not pop in at the screen edge.
    if (d.tx < r.x0 - d.reach || d.tx > r.x1 + d.reach
      || d.ty < r.y0 - d.reach || d.ty > r.y1 + d.reach) continue;
    const bank = images[d.kind];
    if (!bank?.length) continue;
    const img = bank[d.variant % bank.length];
    const w = d.w * z, h = w / 2;
    const cos = Math.cos(d.rot), sin = Math.sin(d.rot);
    ctx.globalAlpha = d.alpha;
    ctx.save();
    ctx.translate(Math.floor(d.wx * z + cam.x), Math.floor(d.wy * z + cam.y));
    // TURNED ON THE GROUND, not on the screen. The projection is a half-squash
    // (S = diag(1, ½)), so turning the patch by θ on the ground plane is
    // S·R(θ)·S⁻¹ here: [[cos θ, −2 sin θ], [½ sin θ, cos θ]]. A plain
    // screen-space rotate would tilt the patch off the ground like a label
    // stuck to the camera; this keeps it lying flat and the 2:1 art honest.
    // Mirroring negates the image's own x axis, which negates the matrix's
    // first column — the flip rides along for free.
    ctx.transform(d.flip ? -cos : cos, d.flip ? -sin / 2 : sin / 2, -2 * sin, cos, 0, 0);
    ctx.drawImage(img as unknown as CanvasImageSource, -w / 2, -h / 2, w, h);
    ctx.restore();
    drawn++;
  }
  ctx.globalAlpha = prev;
  return drawn;
}
