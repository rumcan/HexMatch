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
import { MAP_W, MAP_H, mulberry32 } from "../game/config";
import { GRASS, ROUGH, WATER, idx, inBounds, type Grid } from "./grid";

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
 * The decal families, in PAINT ORDER — `bare` earth goes down first and the
 * grass moods lie over it, so a patch of dry grass can soften the edge of a
 * scrape instead of fighting it.
 */
export const DECAL_KINDS = ["bare", "dry", "rocky", "lush"] as const;
export type DecalKind = (typeof DECAL_KINDS)[number];

/**
 * One painted ground patch. `wx`/`wy` are the WORLD-space (1×) centre and
 * `w` the world-space width; the art is authored 2:1 squashed (it lies flat
 * on the iso ground), so the drawn height is always `w / 2`.
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
}

export interface Scenery {
  decals: Decal[];
  /** Per tile: 0 = no tree, else 1-based index into TREE_SPRITES. */
  trees: Uint8Array;
  /** The multi-tile forest blocks, at their footprint origins. */
  forests: Forest[];
}

// ── tuning ──────────────────────────────────────────────────────────────────
/**
 * Decal patches per LAND TILE. Each patch covers 4–10 tiles across and they
 * overlap freely, so this is what gives the ground its variety: roughly 250
 * regions on a 144×144 island, in four moods, at every size and both
 * mirrorings.
 */
const DECAL_DENSITY = 1 / 70;
/**
 * Nominal patch width in world pixels. A tile diamond is 64 wide, so the base
 * is 5 tiles and the scale range below takes a patch from roughly 3½ to 10
 * tiles across.
 */
const DECAL_BASE_W = 320;
const DECAL_SCALE_MIN = 0.7, DECAL_SCALE_MAX = 1.9;
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
 * Deterministic scenery for a grid. Seeded off `grid.seed` with its own
 * stream offset, so adding/removing scenery can never shift the terrain or
 * industry generators that already consumed that seed.
 */
export function scatterScenery(grid: Grid): Scenery {
  const rng = mulberry32((grid.seed ^ 0x5ce9e12b) >>> 0);
  const publicRoad = new Set<number>();
  for (const [x, y] of grid.publicRoads ?? []) if (inBounds(x, y)) publicRoad.add(idx(x, y));
  const open = buildable(grid, publicRoad);

  // The land tiles, collected once — both scatters sample from this list, so
  // density is per LAND tile and does not swing with how much ocean a seed
  // happened to generate.
  const land: number[] = [];
  for (let i = 0; i < MAP_W * MAP_H; i++) if (grid.terrain[i] !== WATER) land.push(i);
  const pick = () => land[(rng() * land.length) | 0];

  // ── decals ──
  // Distance (in tiles) from every land tile to the nearest water, capped —
  // a patch 10 tiles across cannot be centred 2 tiles off the beach or its
  // soft rim hangs over the sea, and the ground canvas does not clip it.
  const toWater = waterDistance(grid);

  const decals: Decal[] = [];
  const decalAttempts = Math.round(land.length * DECAL_DENSITY);
  for (let n = 0; n < decalAttempts; n++) {
    const i = pick();
    if (!open(i)) continue;
    const tx = i % MAP_W, ty = (i / MAP_W) | 0;
    const kind = weighted(DECAL_MIX, rng());
    const w = DECAL_BASE_W * (DECAL_SCALE_MIN + rng() * (DECAL_SCALE_MAX - DECAL_SCALE_MIN));
    // The patch's radius in TILES: the art is 2:1 squashed, so its world width
    // maps to `w / TILE_W` tiles along each ground axis; half of that is the
    // reach from the centre, plus a tile of slack for the feathered rim.
    const reach = Math.ceil(w / 64 / 2) + 1;
    if (toWater[i] < reach) continue;
    decals.push({
      tx, ty, kind,
      variant: (rng() * 1024) | 0,          // resolved against the file count at load
      // Jitter within the tile's diamond so the patches do not sit on a
      // lattice; the centre of tile (tx,ty) in world space is
      // ((tx-ty)·32, (tx+ty)·16 + 16).
      wx: (tx - ty) * 32 + (rng() - 0.5) * 46,
      wy: (tx + ty) * 16 + 16 + (rng() - 0.5) * 24,
      w,
      alpha: 0.5 + rng() * 0.42,
      flip: rng() < 0.5,
    });
  }
  // Paint order: bare earth first, then the grass moods, and back-to-front
  // within a family so a nearer patch's rim lies over a farther one's.
  decals.sort((a, b) =>
    DECAL_KINDS.indexOf(a.kind) - DECAL_KINDS.indexOf(b.kind)
    || (a.tx + a.ty) - (b.tx + b.ty));

  // ── forest blocks ──
  // Placed BEFORE the single trees, and their 16 tiles are then reserved, so
  // a 1×1 tree can never sprout out of the middle of a painted wood.
  const trees = new Uint8Array(MAP_W * MAP_H);
  const underForest = new Uint8Array(MAP_W * MAP_H);
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
    if (trees[i] || underForest[i] || !open(i)) return;
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

  return { decals, trees, forests };
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
 * up to 2.5 tiles wide and would be clipped by whichever 8×8 chunk owned its
 * tile, leaving a hard straight cut every eight tiles. One drawImage per
 * visible patch (a few dozen) is cheaper than the seams would be to fix.
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
    // A patch reaches up to ~5 tiles from its centre tile on each ground
    // axis, so the cull pad has to clear the largest one or big patches pop
    // in at the screen edge. Derived from the decal's own width, not a
    // constant, so the tuning above cannot silently outgrow it.
    const pad = Math.ceil(d.w / 64 / 2) + 1;
    if (d.tx < r.x0 - pad || d.tx > r.x1 + pad || d.ty < r.y0 - pad || d.ty > r.y1 + pad) continue;
    const bank = images[d.kind];
    if (!bank?.length) continue;
    const img = bank[d.variant % bank.length];
    const w = d.w * z, h = (d.w / 2) * z;
    const x = Math.floor(d.wx * z + cam.x - w / 2);
    const y = Math.floor(d.wy * z + cam.y - h / 2);
    ctx.globalAlpha = d.alpha;
    if (d.flip) {
      // Mirror about the patch's own centre: translate to it, flip x, and
      // draw at the negated left edge.
      ctx.save();
      ctx.translate(x + Math.ceil(w), y);
      ctx.scale(-1, 1);
      ctx.drawImage(img as unknown as CanvasImageSource, 0, 0, Math.ceil(w), Math.ceil(h));
      ctx.restore();
    } else {
      ctx.drawImage(img as unknown as CanvasImageSource, x, y, Math.ceil(w), Math.ceil(h));
    }
    drawn++;
  }
  ctx.globalAlpha = prev;
  return drawn;
}
