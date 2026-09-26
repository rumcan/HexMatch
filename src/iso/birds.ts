// ══════════════════════════════════════════════════════════════════════════
// AMB-2 (#391) — birds at the closest zoom.
//
// At zoom 2 — and only at zoom 2 — small flocks fly over the map and a few
// birds perch and peck on the ground. The whole thing is COSMETIC, and every
// decision below follows from that:
//
//   • nothing is on the wire and nothing is in a save. The birds are rebuilt
//     from the map seed alone (`mulberry32(grid.seed ^ BIRD_SALT)`), so two
//     clients of the same room see the same species in the same places
//     without exchanging a byte — exactly like the scenery;
//   • nothing is in `World`, so nothing joins the depth sort, the damage
//     repaints, the cull pad or `renderer.pick`. `pick` walks `lastOrder`;
//     a bird never gets there, so it can never be clicked, hovered or built
//     upon;
//   • the pool is FIXED (`MAX_BIRDS`) and POOLED: a bird that leaves the view
//     is re-seeded back into it, never freed and re-allocated, and the
//     per-frame path allocates nothing;
//   • the sim runs only while the fade is non-zero. Zooming out, or switching
//     performance mode on, parks it completely: no steering, no draw.
//
// WHY THE POOL RECYCLES. A 144×144 map at zoom 2 shows roughly 15×20 tiles.
// A dozen birds scattered over the whole island would be a ghost that a player
// meets once a session. So the pool lives around the VIEW: spawns are seeded,
// but the tile they are seeded from is drawn from the buckets the view
// overlaps. Pan away and a bird that has left the visible rect is relocated
// to a fresh seeded site inside it, at no visible cost — it happened
// off-screen, which is where a teleport is honest.
//
// SPECIES COME FROM THE TERRAIN (`birdSites`), not from a dice roll: a land
// tile within a couple of tiles of water is a GULL tile (the beach, the
// banks of a river), one near a town house or a town road is a PIGEON tile,
// one near a farm or a field is a CROW tile. A tile that qualifies for more
// than one belongs to the CLOSEST feature; ties break gull → pigeon → crow.
// Flying flocks spawn on the same sites, so the flock over the coast is
// gulls and the one over the farms is crows.
//
// ART. Placeholder vector birds: two frames (wings up / wings down), a few
// strokes and a soft elliptical shadow stamp — the lead swaps in rundot
// sprites later (see `BIRD_ART` for the sizes and the palettes the sprites
// must match). Nothing here is generated art, and nothing is loaded: a canvas
// context that cannot make a stamp (jsdom) simply draws no shadow.
// ══════════════════════════════════════════════════════════════════════════
import { HH, mulberry32, tileToScreen, type Zoom } from "../game/config";
import { WATER, type Grid } from "./grid";
import { liftAt } from "./elevation";
import { worldToScreen, type Camera } from "./camera";

// ── the gate ──────────────────────────────────────────────────────────────
/**
 * The zoom step the birds belong to: the CLOSEST one (`ZOOM_STEPS` is
 * [0.5, 1, 2]). Zoomed out they would be noise, on the middle step they would
 * be two pixels — the fade below is what turns the step into a transition.
 */
export const BIRD_ZOOM: Zoom = 2;
/** Milliseconds the pool takes to fade in (or out) on a zoom step. */
export const BIRD_FADE_MS = 320;

/**
 * Target opacity for the current zoom and mode: 1 at the closest step, 0
 * everywhere else and 0 in performance mode. Pure — the game's fade reads it
 * every frame, and the test pins the gate here rather than in a draw call.
 */
export function birdTargetAlpha(zoom: number, performance: boolean): number {
  return !performance && zoom >= BIRD_ZOOM ? 1 : 0;
}

/** Step a fade toward its target at `BIRD_FADE_MS`. Linear, clamped, pure. */
export function stepBirdAlpha(alpha: number, target: number, dtMs: number): number {
  const step = dtMs / BIRD_FADE_MS;
  if (alpha < target) return Math.min(target, alpha + step);
  if (alpha > target) return Math.max(target, alpha - step);
  return alpha;
}

// ── the pool ──────────────────────────────────────────────────────────────
export type BirdSpecies = "gull" | "pigeon" | "crow";
/** Species in tie-break order, and the order `birdSites` resolves a tile in. */
export const BIRD_SPECIES: readonly BirdSpecies[] = ["gull", "pigeon", "crow"];

/** Hard cap on the pool — "at most about 12 birds visible". */
export const MAX_BIRDS = 12;
/** A flock is 3–9 birds, and all flocks together never exceed this. */
export const FLOCK_MIN = 3;
export const FLOCK_MAX = 9;
export const FLOCK_TOTAL_MAX = 9;
/** Ground birds: a couple perch, peck, and take off when disturbed. */
export const PERCH_MIN = 2;
export const PERCH_MAX = 3;

/** Cruise altitude above the ground, in world (1×) pixels. */
export const BIRD_ALTITUDE = 26;
/** How fast the altitude eases toward its target — this is take-off and landing. */
export const BIRD_CLIMB = 46;          // world px per second
/** Cruise speed and its clamp, in tiles per second. */
export const BIRD_SPEED = 1.7;
export const BIRD_SPEED_MIN = 1.0;
export const BIRD_SPEED_MAX = 2.6;
/** A spooked bird stays up this long before it looks for a new perch. */
export const SCARE_MS = 7000;
/** Extra, seeded jitter on that, so a scattered group does not land together. */
export const SCARE_JITTER_MS = 4000;

/** Boids: cohesion, alignment, separation — plus a slow wander. */
const NEIGHBOUR_R = 6;                 // tiles inside which a flockmate counts
const SEPARATION_R = 1.1;              // tiles a bird wants kept free
const COHESION_W = 0.55;
const ALIGNMENT_W = 0.9;
const SEPARATION_W = 2.4;
const WANDER_W = 0.5;
const WANDER_RATE = 0.9;               // radians per second of wander phase
/** How hard a bird is pulled back toward its home once it is outside it. */
const HOME_PULL = 0.5;

/** Scare radii, in tiles. */
export const VEHICLE_SCARE_R = 1.0;    // "a vehicle passes within about 1 tile"
export const CLICK_SCARE_R = 2.0;      // "the player clicks near them"
export const SCATTER_R = 1.8;          // flockmates caught by a take-off

/**
 * How far outside the pool's area a bird may drift before it is relocated,
 * in the screen-shaped metric `screenish` measures (one unit is one tile of
 * the visible diamond's own edge). Also the pad the game adds to the cull rect
 * it hands the sim, so the two agree on where "off the view" starts.
 */
export const BIRD_VIEW_PAD = 3;
/** How often the pool retries a spawn when the view had no sites at all. */
const SPAWN_RETRY_MS = 400;
/** How long a freshly seated bird takes to fade in. */
export const BIRD_APPEAR_MS = 420;
/**
 * How far from the middle of the view the pool lives, as a fraction of the
 * view's SHORTER side.
 *
 * The tile rect the game hands us is the CULLING box — the bounding box of the
 * four screen corners, which is about twice the visible diamond's area and
 * whose corners are well off-screen. Seeding birds anywhere in that box would
 * put half the pool out of sight; seeding them inside this radius around the
 * middle is what makes "twelve birds" mean twelve birds you can see.
 *
 * Two radii, because spawning and roaming want different answers: a bird is
 * BORN inside the visible diamond (`SPAWN_FRACTION`, so the pool is on screen
 * from the first frame) but may ROAM a little further (`ROAM_FRACTION`, still
 * well inside the cull rect, so a flock crossing the screen edge never trips
 * the recycle step while the camera stands still).
 */
const SPAWN_FRACTION = 0.35;
const ROAM_FRACTION = 0.4;
/**
 * How hard a bird is pushed back toward the middle of the screen once it
 * leaves the pool's area. Stronger than the wander by an order of magnitude:
 * this is the wall that keeps a flock from drifting off the view (and so from
 * ever tripping the recycle step) while the camera stands still.
 */
const BOUNDARY_PULL = 1.6;

/** Tile buckets the sites are indexed in — a spawn picks a bucket the view overlaps. */
const SITE_BUCKET = 16;
/** A land tile this close (Chebyshev, tiles) to a feature belongs to it. */
export const WATER_RANGE = 2;
export const TOWN_RANGE = 2;
export const FARM_RANGE = 2;

/** A tile-space rectangle (the renderer/camera's own `TileRange`). */
export interface TileRange { x0: number; y0: number; x1: number; y1: number }
/** A 2×2 field block, as `scatterScenery` lays them out. */
export interface FieldRect { tx: number; ty: number }

/** One live bird. Pooled: a recycled bird keeps its object, not its identity. */
export interface Bird {
  species: BirdSpecies;
  /** "fly" steers with the boids, "perch" pecks, "land" descends onto `perch`. */
  mode: "fly" | "land" | "perch";
  /** Ground-plane position in TILE units (a tile's centre is tx+0.5, ty+0.5). */
  x: number;
  y: number;
  /** Tiles per second. */
  vx: number;
  vy: number;
  /** Height above the ground in world pixels; eases toward its target. */
  alt: number;
  /** Anchored bird: the flock centre for a flyer, the perch tile for a percher. */
  home: [number, number];
  /** The perch it is settling on, while `mode` is "land". */
  perch: [number, number] | null;
  /** Flock id — boids only ever see their own flock. */
  flock: number;
  /** A ground bird (perches between flights) or a flock bird (always up). */
  percher: boolean;
  /** Simulation time (ms) after which a spooked bird may look for a perch. */
  calmAt: number;
  /** Seeded per-bird phase for the wander and the peck, never re-rolled. */
  phase: number;
  /** Rotating heading the wander noise reads — integrated, not stored as rng. */
  wander: number;
  /**
   * 0..1 appear-fade. A bird that is seated — at a spawn, or re-seeded by the
   * pool's recycling — fades in over `BIRD_APPEAR_MS` instead of blinking into
   * existence, which is what keeps a pan from showing birds popping up in the
   * middle of the screen.
   */
  fade: number;
}

/** What the map says about where each species belongs. */
export interface BirdSites {
  /** The map the sites were derived from (spawns are seeded from it). */
  readonly grid: Grid;
  /** Per-species bucket grid: bucket → land tiles that belong to that species. */
  bySpecies: Record<BirdSpecies, number[][]>;
  /** Per-tile species code (0 none, 1 gull, 2 pigeon, 3 crow), map-sized. */
  species: Uint8Array;
  bucketCols: number;
  bucketRows: number;
  /** How many tiles qualify, per species — diagnostics and the spawn planner. */
  counts: Record<BirdSpecies, number>;
}

/**
 * The spawn plan: what the pool is made of. Decided ONCE per map from the
 * seeded stream, so the same seed offers the same flocks however many times
 * the pool is refilled.
 */
export interface BirdPlan {
  flocks: { species: BirdSpecies; size: number }[];
  perchers: BirdSpecies[];
}

export interface BirdState {
  readonly seed: number;
  readonly sites: BirdSites;
  readonly plan: BirdPlan;
  /** Live birds; length ≤ MAX_BIRDS. */
  birds: Bird[];
  /** Drawn opacity 0..1 — the zoom fade. */
  alpha: number;
  /** Simulation clock (ms), advanced only while the pool is alive. */
  time: number;
  /** True while the pool is populated and simulating. */
  active: boolean;
  /** prefers-reduced-motion: the wings hold their glide frame. */
  reducedMotion: boolean;
  /** The seeded stream spawns draw from — the map seed, never the ambient RNG. */
  rng: () => number;
  /** The view the pool is currently living in. */
  view: TileRange;
  /** Earliest time the next empty-view spawn retry may run. */
  nextRetry: number;
  /** Pre-rendered shadow stamps by zoom (one surface; jsdom → null). */
  stamps: Map<number, CanvasImageSource | null>;
}

/** Salt on the map seed, so the birds are not the scenery's stream. */
const BIRD_SALT = 0x9f1b3c7d;

type Surface = HTMLCanvasElement | OffscreenCanvas;

function makeSurface(w: number, h: number): Surface | null {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  if (typeof document === "undefined") return null;
  return Object.assign(document.createElement("canvas"), { width: w, height: h });
}

const clampNum = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// ── where each species belongs ────────────────────────────────────────────
/**
 * Chebyshev tile distance from every tile to the nearest source, capped at
 * `max`. A bounded 8-neighbour BFS over the grid's OWN dimensions (the map
 * is 144×144 today, but the tests build small synthetic grids, and a bird
 * site is a property of the grid, not of the world size).
 */
function distanceField(grid: Grid, sources: readonly number[], max: number): Uint8Array {
  const w = grid.w, h = grid.h;
  const d = new Uint8Array(w * h).fill(255);
  const queue: number[] = [];
  for (const i of sources) {
    if (i < 0 || i >= d.length || d[i] === 0) continue;
    d[i] = 0;
    queue.push(i);
  }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const cd = d[cur];
    if (cd >= max) continue;
    const x = cur % w, y = (cur / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (d[ni] <= cd + 1) continue;
        d[ni] = cd + 1;
        queue.push(ni);
      }
    }
  }
  return d;
}

/**
 * Classify every LAND tile of the map by the nearest thing it is next to.
 *
 * The three sources are the map's own data — no options, no game state:
 *   gull   — within `WATER_RANGE` of a water tile (the sea, the beach ring,
 *            and every river: a river tile is WATER in `terrain` too);
 *   pigeon — within `TOWN_RANGE` of a town tile (its houses and its PP-10
 *            ring road — the tiles `isTownTile` calls town);
 *   crow   — within `FARM_RANGE` of a farm's footprint or of one of the 2×2
 *            fields `scatterScenery` lays beside the resources.
 *
 * Water tiles themselves are never sites: a gull perches on the sand, not on
 * the sea, and a flock that spawns on the beach circles out over the water on
 * its own. Built once per map — the whole thing is three BFS passes and one
 * classification sweep.
 */
export function birdSites(grid: Grid, fields: readonly FieldRect[] = []): BirdSites {
  const w = grid.w, h = grid.h, n = w * h;
  const water: number[] = [];
  for (let i = 0; i < n; i++) if (grid.terrain[i] === WATER) water.push(i);

  const town: number[] = [];
  for (const t of grid.towns) {
    for (const [tx, ty] of t.houses) if (tx >= 0 && ty >= 0 && tx < w && ty < h) town.push(ty * w + tx);
    for (const [tx, ty] of t.roads) if (tx >= 0 && ty >= 0 && tx < w && ty < h) town.push(ty * w + tx);
  }

  const farm: number[] = [];
  for (const ind of grid.industries) {
    if (ind.type !== "farm") continue;
    for (let y = ind.ty; y < ind.ty + ind.h; y++) {
      for (let x = ind.tx; x < ind.tx + ind.w; x++) {
        if (x >= 0 && y >= 0 && x < w && y < h) farm.push(y * w + x);
      }
    }
  }
  for (const f of fields) {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const x = f.tx + dx, y = f.ty + dy;
        if (x >= 0 && y >= 0 && x < w && y < h) farm.push(y * w + x);
      }
    }
  }

  const dWater = distanceField(grid, water, WATER_RANGE);
  const dTown = distanceField(grid, town, TOWN_RANGE);
  const dFarm = distanceField(grid, farm, FARM_RANGE);

  const bucketCols = Math.ceil(w / SITE_BUCKET), bucketRows = Math.ceil(h / SITE_BUCKET);
  const bySpecies: Record<BirdSpecies, number[][]> = {
    gull: Array.from({ length: bucketCols * bucketRows }, () => [] as number[]),
    pigeon: Array.from({ length: bucketCols * bucketRows }, () => [] as number[]),
    crow: Array.from({ length: bucketCols * bucketRows }, () => [] as number[]),
  };
  const counts: Record<BirdSpecies, number> = { gull: 0, pigeon: 0, crow: 0 };
  const species = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (grid.terrain[i] === WATER) continue;
    const dw = dWater[i], dt = dTown[i], df = dFarm[i];
    let best = -1, bestD = 256;
    if (dw <= WATER_RANGE && dw < bestD) { best = 0; bestD = dw; }
    if (dt <= TOWN_RANGE && dt < bestD) { best = 1; bestD = dt; }
    if (df <= FARM_RANGE && df < bestD) { best = 2; bestD = df; }
    if (best < 0) continue;
    const sp = BIRD_SPECIES[best];
    species[i] = best + 1;
    counts[sp]++;
    const bx = clampNum((i % w) / SITE_BUCKET | 0, 0, bucketCols - 1);
    const by = clampNum(((i / w) | 0) / SITE_BUCKET | 0, 0, bucketRows - 1);
    bySpecies[sp][by * bucketCols + bx].push(i);
  }
  return { grid, bySpecies, species, bucketCols, bucketRows, counts };
}

/** The species a tile belongs to, or null — the classified byte, read back. */
export function birdSpeciesAt(sites: BirdSites, grid: Grid, tx: number, ty: number): BirdSpecies | null {
  if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) return null;
  const code = sites.species[ty * grid.w + tx];
  return code === 0 ? null : BIRD_SPECIES[code - 1];
}

// ── the plan ──────────────────────────────────────────────────────────────
/**
 * Decide what the pool is made of, from the sites the map actually has. The
 * seeded stream decides; an empty site list simply drops that species, so a
 * waterless, townless, farmless map has no birds at all rather than crows
 * standing in a vacuum.
 */
export function planBirds(sites: BirdSites, rng: () => number): BirdPlan {
  const available = BIRD_SPECIES.filter((s) => sites.counts[s] > 0);
  const pick = (): BirdSpecies => available[Math.min(available.length - 1, (rng() * available.length) | 0)];
  const flocks: { species: BirdSpecies; size: number }[] = [];
  if (available.length > 0) {
    const wanted = rng() < 0.5 ? 1 : 2;
    let budget = FLOCK_TOTAL_MAX;
    for (let k = 0; k < wanted; k++) {
      const size = FLOCK_MIN + ((rng() * (FLOCK_MAX - FLOCK_MIN + 1)) | 0);
      if (size > budget) break;
      budget -= size;
      flocks.push({ species: pick(), size });
    }
    if (flocks.length === 0) flocks.push({ species: pick(), size: FLOCK_MIN });
  }
  const perchers: BirdSpecies[] = [];
  if (available.length > 0) {
    const count = PERCH_MIN + (rng() < 0.5 ? 0 : 1);       // 2 or 3
    const room = MAX_BIRDS - flocks.reduce((n, f) => n + f.size, 0);
    for (let k = 0; k < Math.min(count, room); k++) {
      // Prefer a species the flocks are not already using, for variety.
      const fresh = available.filter((s) => !perchers.includes(s));
      perchers.push(fresh.length > 0 && rng() < 0.65 ? fresh[(rng() * fresh.length) | 0] : pick());
    }
  }
  return { flocks, perchers };
}

// ── spawning ──────────────────────────────────────────────────────────────
/**
 * The pool's active area: the middle of the view and a radius in the
 * SCREEN-ISH metric below. The rect itself is only used to find the buckets to
 * look in.
 */
interface ActiveView {
  cx: number; cy: number;
  /** Where the pool may roam before it is steered back. */
  r: number;
  /** Where a bird may be SEEDED — inside the visible diamond. */
  spawnR: number;
  /** Where one may ROAM before the pool relocates it: the screen, plus a pad. */
  recycleR: number;
}

/** Where the pool lives this frame: the view's middle, and its two radii. */
function activeView(view: TileRange): ActiveView {
  const span = Math.min(view.x1 - view.x0 + 1, view.y1 - view.y0 + 1);
  return {
    cx: (view.x0 + view.x1 + 1) / 2,
    cy: (view.y0 + view.y1 + 1) / 2,
    r: Math.max(4, span * ROAM_FRACTION),
    spawnR: Math.max(3, span * SPAWN_FRACTION),
    recycleR: Math.max(6, span * ROAM_FRACTION) + BIRD_VIEW_PAD,
  };
}

/**
 * A tile-space distance that follows the SCREEN, not the grid: the two screen
 * axes are (x − y) and (x + y), so the larger of those two offsets is a
 * screen-shaped distance in tiles. A point inside `r` in this metric has
 * |dx| ≤ r and |dy| ≤ r too (the two axes are a rotation of the tile grid), so
 * the area is contained in the cull rect's own box as soon as `r` is under its
 * half-extent — which is what lets the pool promise never to trip its own
 * recycling while the camera stands still.
 */
const screenish = (dx: number, dy: number): number =>
  Math.max(Math.abs(dx - dy), Math.abs(dx + dy));

/** Is a tile inside the pool's active area (plus `slack`)? */
const inActive = (a: ActiveView, tx: number, ty: number, slack = 0): boolean =>
  screenish(tx + 0.5 - a.cx, ty + 0.5 - a.cy) <= a.spawnR + slack;

/** The buckets of one species that `view` overlaps, in row-major order. */
function viewBuckets(state: BirdState, species: BirdSpecies, view: TileRange): number[][] {
  const { sites } = state;
  const bx0 = clampNum((view.x0 / SITE_BUCKET) | 0, 0, sites.bucketCols - 1);
  const bx1 = clampNum((view.x1 / SITE_BUCKET) | 0, 0, sites.bucketCols - 1);
  const by0 = clampNum((view.y0 / SITE_BUCKET) | 0, 0, sites.bucketRows - 1);
  const by1 = clampNum((view.y1 / SITE_BUCKET) | 0, 0, sites.bucketRows - 1);
  const buckets = sites.bySpecies[species];
  const hits: number[][] = [];
  for (let by = by0; by <= by1; by++) {
    for (let bx = bx0; bx <= bx1; bx++) {
      const list = buckets[by * sites.bucketCols + bx];
      if (list.length > 0) hits.push(list);
    }
  }
  return hits;
}

/**
 * The tiles of `species` inside the active area, grouped by bucket. Built by
 * walking the buckets the view rect overlaps — the rect is a cheap prefilter,
 * the metric decides. Buckets hold a few dozen tiles, so this is a few hundred
 * reads on a spawn, and a spawn happens a handful of times a minute.
 */
function activeBuckets(
  state: BirdState, species: BirdSpecies, view: TileRange,
): { hits: number[][]; anywhere: number[][] } {
  const grid = state.sites.grid;
  const buckets = viewBuckets(state, species, view);
  const a = activeView(view);
  const hits: number[][] = [];
  const anywhere: number[][] = [];
  for (const list of buckets) {
    // The fallback (a view whose middle has no sites — the open sea): every
    // qualifying tile of the buckets the rect overlaps, off-screen or not, so
    // a pool still exists to fly in when the player pans back to land.
    if (anywhere.length === 0) anywhere.push(list);
    let near: number[] | null = null;
    for (const i of list) {
      const tx = i % grid.w, ty = (i / grid.w) | 0;
      if (!inActive(a, tx, ty)) continue;
      (near ??= []).push(i);
    }
    if (near) hits.push(near);
  }
  return { hits, anywhere };
}

/** Does this species have anywhere to stand inside `view`? (Consumes no rng.) */
function hasSiteInView(state: BirdState, species: BirdSpecies, view: TileRange): boolean {
  return viewBuckets(state, species, view).length > 0;
}

/**
 * A placement tile of `species` for the pool: a random one inside the active
 * area when there is one, else — a screen-wide town at the closest zoom, an
 * open sea — the nearest tile the cull rect offers, pulled back to the edge of
 * the visible diamond. A bird is never parked off the view to be recycled on
 * the next tick; it flies over its own terrain at the screen's edge instead.
 */
function pickSiteInView(
  state: BirdState, species: BirdSpecies, view: TileRange,
): [number, number] | null {
  const { hits, anywhere } = activeBuckets(state, species, view);
  const groups = hits.length > 0 ? hits : anywhere;
  if (groups.length === 0) return null;
  const grid = state.sites.grid;
  if (hits.length === 0) {
    const a = activeView(view);
    let best = -1, bd = Infinity;
    for (const list of groups) {
      for (const i of list) {
        const d = screenish(i % grid.w + 0.5 - a.cx, ((i / grid.w) | 0) + 0.5 - a.cy);
        if (d < bd) { bd = d; best = i; }
      }
    }
    if (best >= 0 && bd > a.spawnR) {
      const k = a.spawnR / bd;
      const tx = Math.round(a.cx + (best % grid.w + 0.5 - a.cx) * k - 0.5);
      const ty = Math.round(a.cy + (((best / grid.w) | 0) + 0.5 - a.cy) * k - 0.5);
      return [
        Math.max(0, Math.min(grid.w - 1, tx)),
        Math.max(0, Math.min(grid.h - 1, ty)),
      ];
    }
  }
  const list = groups[Math.min(groups.length - 1, (state.rng() * groups.length) | 0)];
  const i = list[Math.min(list.length - 1, (state.rng() * list.length) | 0)];
  return [i % grid.w, (i / grid.w) | 0];
}


/**
 * A species the pool can actually use in this view: the plan's if its terrain
 * is anywhere in the cull rect (the terrain decides — `pickSiteInView` pulls an
 * off-screen placement in to the edge of the visible diamond), else any
 * species that does have ground here.
 */
function speciesForView(state: BirdState, wanted: BirdSpecies, view: TileRange): BirdSpecies | null {
  if (hasSiteInView(state, wanted, view)) return wanted;
  for (const s of BIRD_SPECIES) {
    if (s !== wanted && hasSiteInView(state, s, view)) return s;
  }
  return null;
}

/** An unseated bird; `seatFlying` / `seatPerched` fill in every field. */
function blankBird(): Bird {
  return {
    species: "pigeon", mode: "perch", x: 0, y: 0, vx: 0, vy: 0, alt: 0,
    home: [0, 0], perch: null, flock: 0, percher: false,
    calmAt: 0, phase: 0, wander: 0, fade: 1,
  };
}

/** Place one flying bird around a flock centre `(cx, cy)` in tile units. */
function seatFlying(state: BirdState, b: Bird, species: BirdSpecies, flock: number,
  cx: number, cy: number, radius: number): void {
  const ang = state.rng() * Math.PI * 2, rad = radius * (0.35 + state.rng() * 0.65);
  b.species = species;
  b.flock = flock;
  b.percher = false;
  b.mode = "fly";
  b.x = cx + Math.cos(ang) * rad;
  b.y = cy + Math.sin(ang) * rad;
  const heading = state.rng() * Math.PI * 2;
  b.vx = Math.cos(heading) * BIRD_SPEED;
  b.vy = Math.sin(heading) * BIRD_SPEED;
  b.alt = BIRD_ALTITUDE;
  b.home = [cx, cy];
  b.perch = null;
  b.calmAt = state.time;
  b.phase = state.rng() * Math.PI * 2;
  b.wander = state.rng() * Math.PI * 2;
  b.fade = 0;
}

/** Seat a ground bird on a perch tile inside the view, at rest. */
function seatPerched(state: BirdState, b: Bird, species: BirdSpecies, tx: number, ty: number): void {
  b.species = species;
  b.flock = 1000 + tx * 32 + ty;         // perchers are their own company
  b.percher = true;
  b.mode = "perch";
  b.x = tx + 0.5 + (state.rng() - 0.5) * 0.5;
  b.y = ty + 0.5 + (state.rng() - 0.5) * 0.5;
  b.vx = 0;
  b.vy = 0;
  b.alt = 0;
  b.home = [tx + 0.5, ty + 0.5];
  b.perch = null;
  b.calmAt = state.time;
  b.phase = state.rng() * Math.PI * 2;
  b.wander = state.rng() * Math.PI * 2;
  b.fade = 0;
}

/**
 * Populate the pool inside `view` from the plan. Called on the fade-in and
 * when the view had no sites at all; every bird it makes comes off the same
 * seeded stream, so a fresh state and a reused one behave identically.
 */
export function spawnBirds(state: BirdState, view: TileRange): number {
  state.view = view;
  state.birds.length = 0;
  const span = Math.max(3, Math.min(view.x1 - view.x0 + 1, view.y1 - view.y0 + 1));
  const radius = Math.min(3.5, span * 0.18);
  let flockId = 0;
  for (const f of state.plan.flocks) {
    const species = speciesForView(state, f.species, view);
    if (!species) continue;
    const site = pickSiteInView(state, species, view)!;
    const cx = site[0] + 0.5, cy = site[1] + 0.5;
    for (let k = 0; k < f.size && state.birds.length < MAX_BIRDS; k++) {
      const b = blankBird();
      seatFlying(state, b, species, flockId, cx, cy, radius);
      state.birds.push(b);
    }
    flockId++;
  }
  for (const wanted of state.plan.perchers) {
    if (state.birds.length >= MAX_BIRDS) break;
    const species = speciesForView(state, wanted, view);
    if (!species) continue;
    const site = pickSiteInView(state, species, view)!;
    const b = blankBird();
    seatPerched(state, b, species, site[0], site[1]);
    state.birds.push(b);
  }
  return state.birds.length;
}

/**
 * The pool for one map. Nothing is spawned yet — the first fade-in calls
 * `spawnBirds` with the view that is actually on screen (`tickBirds` does it).
 */
export function createBirds(
  grid: Grid, fields: readonly FieldRect[] = [],
): BirdState {
  const sites = birdSites(grid, fields);
  const rng = mulberry32((grid.seed ^ BIRD_SALT) >>> 0);
  return {
    seed: grid.seed,
    sites,
    plan: planBirds(sites, rng),
    birds: [],
    alpha: 0,
    time: 0,
    active: false,
    reducedMotion: false,
    rng,
    view: { x0: 0, y0: 0, x1: grid.w - 1, y1: grid.h - 1 },
    nextRetry: 0,
    stamps: new Map(),
  };
}

// ── the tick ──────────────────────────────────────────────────────────────
/** A live vehicle's ground position, in tiles (`fx`/`fy` win over `tx`/`ty`). */
export interface VehiclePoint { tx: number; ty: number; fx?: number; fy?: number }

export interface BirdTickContext {
  grid: Grid;
  /** The camera's zoom step — the fade gate. */
  zoom: number;
  /** The tile rect the pool lives in (the game passes `visibleTileRange`). */
  view: TileRange;
  /** Performance mode: the pool fades out and stops. */
  performance?: boolean;
  /** prefers-reduced-motion: the wings hold their glide frame. */
  reducedMotion?: boolean;
  /** Live traffic, for the scatter trigger. */
  vehicles?: readonly VehiclePoint[];
}

/**
 * One frame of birds. Cheap by construction: it returns immediately (doing
 * nothing at all) while the fade is out, and while the fade is running the
 * whole simulation is a dozen birds and a 12×12 neighbour loop.
 */
export function tickBirds(state: BirdState, dtMs: number, ctx: BirdTickContext): void {
  const target = birdTargetAlpha(ctx.zoom, !!ctx.performance);
  state.alpha = stepBirdAlpha(state.alpha, target, dtMs);
  state.reducedMotion = !!ctx.reducedMotion;
  state.view = ctx.view;
  if (target <= 0 && state.alpha <= 0) {
    // Parked: nothing to simulate, nothing to draw, and the next fade-in
    // re-populates the pool around whatever the view is then.
    if (state.active) { state.active = false; state.birds.length = 0; }
    return;
  }
  const dt = Math.max(0, Math.min(100, dtMs));
  state.time += dt;
  if (!state.active || state.birds.length === 0) {
    if (state.time < state.nextRetry) return;
    state.active = true;
    const made = spawnBirds(state, ctx.view);
    if (made === 0) state.nextRetry = state.time + SPAWN_RETRY_MS;   // a view with no sites
    return;
  }
  if (ctx.vehicles) scareAtVehicles(state, ctx.vehicles);
  simulate(state, dt, ctx);
  recycle(state, ctx.view);
}

/** A vehicle within `VEHICLE_SCARE_R` of a perched bird puts it up — and its neighbours too. */
function scareAtVehicles(state: BirdState, vehicles: readonly VehiclePoint[]): void {
  for (const v of vehicles) {
    const vx = v.fx ?? v.tx, vy = v.fy ?? v.ty;
    for (const b of state.birds) {
      if (b.mode !== "perch") continue;
      if (Math.abs(b.x - vx) > VEHICLE_SCARE_R || Math.abs(b.y - vy) > VEHICLE_SCARE_R) continue;
      takeOff(state, b, vx, vy);
    }
  }
}

/**
 * Put a bird up. `from` is what spooked it — the bird is thrown AWAY from it
 * and its nearer flockmates follow, which is what makes a scatter read as a
 * scatter rather than as one startled pigeon.
 */
function takeOff(state: BirdState, bird: Bird, fromX: number, fromY: number): void {
  const dx = bird.x - fromX, dy = bird.y - fromY;
  const len = Math.hypot(dx, dy) || 1;
  const jitter = (state.rng() - 0.5) * 0.7;
  const cos = Math.cos(jitter), sin = Math.sin(jitter);
  const ux = (dx / len) * cos - (dy / len) * sin;
  const uy = (dx / len) * sin + (dy / len) * cos;
  const speed = BIRD_SPEED * 1.7;
  bird.mode = "fly";
  bird.perch = null;
  bird.vx = ux * speed;
  bird.vy = uy * speed;
  bird.calmAt = state.time + SCARE_MS + state.rng() * SCARE_JITTER_MS;
  bird.home = [bird.x + ux * 6, bird.y + uy * 6];
  // And its neighbours, as a wave — but only birds that are already down.
  for (const other of state.birds) {
    if (other === bird || other.mode !== "perch") continue;
    if (Math.hypot(other.x - bird.x, other.y - bird.y) > SCATTER_R) continue;
    takeOff(state, other, bird.x, bird.y);
  }
}

/**
 * Spook every perched bird near a point (the player's click). Returns how many
 * took off — the game does not read it, the test does.
 */
export function scareBirds(state: BirdState, x: number, y: number, radius = CLICK_SCARE_R): number {
  let n = 0;
  for (const b of state.birds) {
    if (b.mode !== "perch") continue;
    if (Math.hypot(b.x - x, b.y - y) > radius) continue;
    takeOff(state, b, x, y);
    n++;
  }
  return n;
}

/** Boids + wander + home pull, then the altitude ease. No allocations. */
function simulate(state: BirdState, dt: number, ctx: BirdTickContext): void {
  const s = dt / 1000;
  // The pool's active circle: where the birds live, and how far one may roam
  // from its flock before it is pulled back — a fraction of where it was
  // seeded, so a flock circles a point on screen rather than drifting.
  const a = activeView(ctx.view);
  const homeR = Math.max(2, a.r * 0.2);
  const birds = state.birds;
  for (let i = 0; i < birds.length; i++) {
    const b = birds[i];
    if (b.fade < 1) b.fade = Math.min(1, b.fade + dt / BIRD_APPEAR_MS);
    if (b.mode === "perch") {
      // Pecking and the odd hop are read off the phase at DRAW time, so a
      // perched bird holds no timer that could drift while it is out of view.
      b.alt = 0;
      continue;
    }
    let ax = 0, ay = 0;
    const bsep = SEPARATION_R;
    for (let j = 0; j < birds.length; j++) {
      if (j === i) continue;
      const o = birds[j];
      if (o.flock !== b.flock || o.mode === "perch") continue;
      const dx = o.x - b.x, dy = o.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > NEIGHBOUR_R * NEIGHBOUR_R || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      ax += (o.vx - b.vx) * ALIGNMENT_W / NEIGHBOUR_R;
      ay += (o.vy - b.vy) * ALIGNMENT_W / NEIGHBOUR_R;
      ax += (dx / d) * COHESION_W;
      ay += (dy / d) * COHESION_W;
      if (d < bsep) {
        const push = SEPARATION_W * (1 - d / bsep);
        ax -= (dx / d) * push;
        ay -= (dy / d) * push;
      }
    }
    // Wander: two offset sines off one integrated phase. No rng in the loop,
    // so a bird's flight never consumes the spawn stream.
    b.wander += s * WANDER_RATE;
    ax += Math.sin(b.wander + b.phase) * WANDER_W;
    ay += Math.cos(b.wander * 0.77 + b.phase * 1.7) * WANDER_W;
    // Home pull: gentle, and only once the bird is further out than `homeR`.
    const hx = b.home[0] - b.x, hy = b.home[1] - b.y;
    const hd = Math.hypot(hx, hy);
    if (hd > homeR) {
      const pull = HOME_PULL * (hd - homeR);
      ax += (hx / hd) * pull;
      ay += (hy / hd) * pull;
    }
    // The pool's own boundary: past the active circle the bird is steered back
    // toward the middle of the screen, hard. Without it a flock slowly walks
    // off the view and gets recycled — a teleport the player can see; with it
    // the pool turns on the spot.
    const cx2 = b.x - a.cx, cy2 = b.y - a.cy;
    const m = screenish(cx2, cy2);
    if (m > a.r) {
      const md = Math.hypot(cx2, cy2) || 1;
      const pull = BOUNDARY_PULL * (m - a.r);
      ax -= (cx2 / md) * pull;
      ay -= (cy2 / md) * pull;
    }
    // A landing bird flies AT its perch instead of with its flock.
    if (b.mode === "land" && b.perch) {
      const px = b.perch[0] + 0.5 - b.x, py = b.perch[1] + 0.5 - b.y;
      const pd = Math.hypot(px, py);
      if (pd < 0.25) { b.mode = "perch"; b.x = b.perch[0] + 0.5; b.y = b.perch[1] + 0.5; b.perch = null; b.vx = 0; b.vy = 0; continue; }
      ax = (px / pd) * 2.4 - b.vx * 1.5;
      ay = (py / pd) * 2.4 - b.vy * 1.5;
    }
    b.vx += ax * s;
    b.vy += ay * s;
    const sp = Math.hypot(b.vx, b.vy) || 1e-6;
    const want = BIRD_SPEED;
    if (sp < BIRD_SPEED_MIN || sp > BIRD_SPEED_MAX) {
      const k = (sp < BIRD_SPEED_MIN ? BIRD_SPEED_MIN : BIRD_SPEED_MAX) / sp;
      b.vx *= k; b.vy *= k;
    } else if (b.mode === "fly") {
      // Cruise: relax toward the flock's pace rather than snapping to it.
      const k = 1 + (want / sp - 1) * Math.min(1, s * 1.5);
      b.vx *= k; b.vy *= k;
    }
    b.x += b.vx * s;
    b.y += b.vy * s;
    // The map edge is a wall, not a wrap: a bird that reaches it turns back.
    const w = ctx.grid.w - 0.5, h = ctx.grid.h - 0.5;
    if (b.x < 0.5) { b.x = 0.5; b.vx = Math.abs(b.vx); }
    if (b.y < 0.5) { b.y = 0.5; b.vy = Math.abs(b.vy); }
    if (b.x > w) { b.x = w; b.vx = -Math.abs(b.vx); }
    if (b.y > h) { b.y = h; b.vy = -Math.abs(b.vy); }
    // Altitude: take-off and landing are the same ease, at different targets.
    const altTarget = b.mode === "land" ? 0 : BIRD_ALTITUDE;
    const step = (BIRD_CLIMB * s);
    b.alt += clampNum(altTarget - b.alt, -step, step);
    if (b.mode === "fly" && b.percher && state.time >= b.calmAt) startLanding(state, b);
  }
}

/** A calmed percher picks a site near where it is and glides down onto it. */
function startLanding(state: BirdState, b: Bird): void {
  const spot = pickSiteNear(state, b.species, b.x, b.y);
  if (!spot) { b.calmAt = state.time + SCARE_MS; return; }   // nowhere to land: stay up
  b.mode = "land";
  b.perch = spot;
  b.home = [spot[0] + 0.5, spot[1] + 0.5];
}

/**
 * A site of `species` near a point — the landing search, and the honest
 * version of "birds land somewhere that makes sense". Searches outward in
 * whole buckets so a bird never lands in the sea or on a rooftop tile.
 */
function pickSiteNear(
  state: BirdState, species: BirdSpecies, x: number, y: number,
): [number, number] | null {
  const { sites } = state;
  const grid = state.sites.grid;
  const a = activeView(state.view);
  const bx = clampNum((x / SITE_BUCKET) | 0, 0, sites.bucketCols - 1);
  const by = clampNum((y / SITE_BUCKET) | 0, 0, sites.bucketRows - 1);
  const found: number[] = [];
  for (let ring = 0; ring <= 1 && found.length === 0; ring++) {
    for (let gy = by - ring; gy <= by + ring; gy++) {
      if (gy < 0 || gy >= sites.bucketRows) continue;
      for (let gx = bx - ring; gx <= bx + ring; gx++) {
        if (gx < 0 || gx >= sites.bucketCols) continue;
        const list = sites.bySpecies[species][gy * sites.bucketCols + gx];
        for (const i of list) {
          const tx = i % grid.w, ty = (i / grid.w) | 0;
          // A bird lands where the player can see it land: near where it is
          // now, and inside the pool's own active area.
          if (Math.abs(tx + 0.5 - x) > 9 || Math.abs(ty + 0.5 - y) > 9) continue;
          if (!inActive(a, tx, ty, 2)) continue;
          found.push(i);
        }
      }
    }
  }
  if (found.length === 0) return null;
  const i = found[Math.min(found.length - 1, (state.rng() * found.length) | 0)];
  return [i % grid.w, (i / grid.w) | 0];
}

/**
 * Keep the pool where the player is looking. A bird that leaves the view (plus
 * `BIRD_VIEW_PAD`) is re-seeded inside it — a whole flock at once, so a
 * formation never gets half-eaten at the screen edge, and a percher
 * individually, because a ground bird has no formation to keep.
 */
function recycle(state: BirdState, view: TileRange): void {
  const { birds } = state;
  if (birds.length === 0) return;
  const a = activeView(view);
  const moved = new Set<number>();
  for (let i = 0; i < birds.length; i++) {
    const b = birds[i];
    // The cull rect's CORNERS are well off-screen, so a bird inside them can
    // still be invisible — the metric keeps the pool on the visible diamond.
    if (screenish(b.x - a.cx, b.y - a.cy) <= a.recycleR) continue;
    if (b.percher) {
      const species = speciesForView(state, b.species, view);
      const site = species ? pickSiteInView(state, species, view) : null;
      if (species && site) seatPerched(state, b, species, site[0], site[1]);
      continue;
    }
    if (moved.has(b.flock)) continue;
    moved.add(b.flock);
    const species = speciesForView(state, b.species, view);
    if (!species) continue;
    const site = pickSiteInView(state, species, view);
    if (!site) continue;
    const cx = site[0] + 0.5, cy = site[1] + 0.5;
    for (const other of birds) {
      if (other.flock !== b.flock || other.percher) continue;
      seatFlying(state, other, species, b.flock, cx, cy, 2.5);
    }
  }
}

// ── drawing ───────────────────────────────────────────────────────────────
/**
 * Placeholder vector art, one entry per species: the colours and the sizes a
 * rundot sprite must match (the sprite is the wing-span at zoom 1, in world
 * pixels). Gull white-grey, pigeon slate, crow near-black — all three are
 * silhouettes at this size, so they are read by colour and by span, not by
 * shape.
 */
export const BIRD_ART: Record<BirdSpecies, {
  /** Body and head fill. */ body: string;
  /** Wing stroke. */ wing: string;
  /** Beak and the thin outline. */ edge: string;
  /** Wing span in world pixels — the size the sprite must be cut at. */ size: number;
}> = {
  gull: { body: "#f2f5f7", wing: "#c2ced7", edge: "#5c6a74", size: 9 },
  pigeon: { body: "#9aa0ae", wing: "#767d8d", edge: "#41454f", size: 8 },
  crow: { body: "#23252c", wing: "#3a3d47", edge: "#0d0e12", size: 10 },
};

/** Wing-beat period, ms. Two frames, as the ticket specifies. */
export const FLAP_MS = 260;
/** A perched bird's hop/peck period, ms. */
const PECK_MS = 2400;
/** Shadow stamp extents in world pixels, and its peak opacity. */
const SHADOW_W = 9, SHADOW_H = 4.5, SHADOW_ALPHA = 0.2;

/** Species tallies + fade, for `__iso`-style diagnostics and the tests. */
export function birdStats(state: BirdState): {
  alpha: number; active: boolean; total: number;
  species: Record<BirdSpecies, number>; flying: number; perched: number;
} {
  const species: Record<BirdSpecies, number> = { gull: 0, pigeon: 0, crow: 0 };
  let flying = 0, perched = 0;
  for (const b of state.birds) {
    species[b.species]++;
    if (b.mode === "perch") perched++; else flying++;
  }
  return { alpha: state.alpha, active: state.active, total: state.birds.length, species, flying, perched };
}

/**
 * Where a bird is on screen: its ground point (the shared `tileToScreen`
 * lattice, lifted onto the terrain) and then its altitude straight up the
 * screen. The shadow asks for the same point with `alt = 0`, which is exactly
 * why the two can never separate.
 */
function birdScreen(cam: Camera, grid: Grid, x: number, y: number, alt: number): [number, number] {
  const [wx, wy] = tileToScreen(x, y);
  const groundY = wy + HH - liftAt(grid, x, y);
  return worldToScreen(cam, wx, groundY - alt);
}

/** The pre-rendered soft shadow blob for one zoom, or null (a stub context). */
function shadowStamp(state: BirdState, zoom: number): CanvasImageSource | null {
  const hit = state.stamps.get(zoom);
  if (hit !== undefined) return hit;
  let stamp: CanvasImageSource | null = null;
  const w = Math.max(2, Math.round(SHADOW_W * zoom));
  const h = Math.max(2, Math.round(SHADOW_H * zoom));
  const surf = makeSurface(w, h);
  const c = surf ? (surf as HTMLCanvasElement).getContext("2d") as CanvasRenderingContext2D | null : null;
  if (c && typeof c.createRadialGradient === "function") {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(12,16,12,1)");
    g.addColorStop(0.55, "rgba(12,16,12,0.55)");
    g.addColorStop(1, "rgba(12,16,12,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    stamp = surf as unknown as CanvasImageSource;
  }
  state.stamps.set(zoom, stamp);
  return stamp;
}

/**
 * Paint the pool. Called from the renderer's above-structures pass (see
 * `IsoRenderer.aboveStructuresPainter`), so the birds fly over the buildings
 * and under the placement overlay, and never enter the draw list that
 * `renderer.pick` walks.
 *
 * Returns how many birds were drawn — the test's handle on the cull, and the
 * number the PR reports.
 */
export function paintBirds(
  ctx: CanvasRenderingContext2D | null | undefined,
  cam: Camera,
  grid: Grid,
  state: BirdState,
): number {
  const alpha = Math.max(0, Math.min(1, state.alpha));
  if (!ctx || alpha <= 0 || state.birds.length === 0) return 0;
  const z = cam.zoom;
  const m = 24 * z;                                    // off-screen margin, device px
  const vw = cam.vw, vh = cam.vh;
  const stamp = shadowStamp(state, z);
  const prev = typeof ctx.globalAlpha === "number" ? ctx.globalAlpha : 1;
  const sw = Math.max(2, Math.round(SHADOW_W * z)), sh = Math.max(2, Math.round(SHADOW_H * z));
  const shadows = !!stamp && typeof ctx.drawImage === "function";
  // Every bird's opacity is its own: the pool's zoom fade times the bird's
  // appear-fade (a re-seeded bird arrives dimmed rather than blinking in).
  const shown: { b: Bird; sx: number; sy: number; a: number }[] = [];
  for (const b of state.birds) {
    const [px, py] = birdScreen(cam, grid, b.x, b.y, b.alt);
    if (px < -m || py < -m || px > vw + m || py > vh + m) continue;
    shown.push({ b, sx: px, sy: py, a: alpha * Math.max(0, Math.min(1, b.fade)) });
  }
  // Shadows first, as one pass: a bird's shadow is on the ground and another
  // bird's body must never be drawn under it.
  if (shadows) {
    for (const s0 of shown) {
      const [sx, sy] = birdScreen(cam, grid, s0.b.x, s0.b.y, 0);
      if (sx < -m || sy < -m || sx > vw + m || sy > vh + m) continue;
      ctx.globalAlpha = prev * s0.a * SHADOW_ALPHA;
      ctx.drawImage(stamp!, Math.floor(sx - sw / 2), Math.floor(sy - sh / 2), sw, sh);
    }
    ctx.globalAlpha = prev;
  }
  const flap = state.reducedMotion ? 0 : Math.floor(state.time / FLAP_MS) % 2;
  for (const s0 of shown) {
    const b = s0.b;
    // A perched bird bobs on its phase; a flying one flaps (unless the player
    // asked for reduced motion, when the wings hold the glide frame).
    const peck = b.mode === "perch"
      ? Math.max(0, Math.sin((state.time + b.phase * 900) / PECK_MS * Math.PI * 2)) : 0;
    const bob = peck * 1.5 * z;
    const frame = b.mode === "perch" ? 1 : flap;       // perched wings sit low
    const dir = (b.vx - b.vy) >= 0 ? 1 : -1;           // screen-space facing
    drawBird(ctx, Math.round(s0.sx), Math.round(s0.sy + bob), z, b.species, frame, dir, s0.a);
  }
  return shown.length;
}

/** One placeholder bird: two wing sweeps, a body, a head and a beak. */
function drawBird(
  ctx: CanvasRenderingContext2D, x: number, y: number, z: number,
  species: BirdSpecies, frame: number, dir: number, alpha: number,
): void {
  const art = BIRD_ART[species];
  const s = art.size * z;
  const h = s * 0.5;
  const up = frame === 0;
  const tipY = up ? -h * 0.85 : h * 0.4;
  const ctrlY = up ? -h * 1.15 : h * 0.1;
  const prevAlpha = typeof ctx.globalAlpha === "number" ? ctx.globalAlpha : 1;
  ctx.globalAlpha = prevAlpha * Math.max(0, Math.min(1, alpha));
  if (typeof ctx.lineCap === "string") ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, Math.round(s * 0.15));
  // Wings: one quadratic each way from the body, mirrored about the bird.
  ctx.beginPath();
  ctx.moveTo(x - s / 2, y + tipY);
  ctx.quadraticCurveTo(x - s * 0.26, y + ctrlY, x, y - h * 0.1);
  ctx.quadraticCurveTo(x + s * 0.26, y + ctrlY, x + s / 2, y + tipY);
  ctx.strokeStyle = art.wing;
  ctx.stroke();
  // Body, head, beak — the bird reads by silhouette, so these are three fills.
  ctx.fillStyle = art.body;
  ctx.beginPath();
  if (typeof ctx.ellipse === "function") {
    ctx.ellipse(x, y - h * 0.12, s * 0.17, h * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + dir * s * 0.18, y - h * 0.42, s * 0.11, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.arc(x, y - h * 0.12, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(x + dir * s * 0.27, y - h * 0.42);
  ctx.lineTo(x + dir * s * 0.42, y - h * 0.3);
  ctx.strokeStyle = art.edge;
  ctx.lineWidth = Math.max(1, Math.round(s * 0.08));
  ctx.stroke();
  ctx.globalAlpha = prevAlpha;
}
