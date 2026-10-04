// ══════════════════════════════════════════════════════════════════════════
// TOWN-4.3 (#679) — the PLANNED TOWN: a master plan with one grand avenue,
// a town square, real blocks and zoned lots.
//
// The third town layout (`layout: "planned"`, beside TOWN-2's `"organic"`)
// replaces the 3-tile street lattice with a real small-town plan:
//
//   • ONE AVENUE — two tiles wide, straight, axis-aligned, running the full
//     length of the plan and out to the plan's edge at both ends, where the
//     inter-town highways meet it (`termini`).
//   • A TOWN SQUARE at the avenue's midpoint, on one side of it: a 4×4 (4×6
//     on the large map) plaza whose avenue-facing centre is the HALL tile —
//     `Town.tx/ty`, the tile `townCentreSprite` draws on, exactly the role
//     the church tile plays in a grid town.
//   • CROSS STREETS every 6–8 tiles, drawn independently on each side of the
//     avenue with a seeded 1–2 tile stagger, so the crossings are T-junctions
//     and not a chessboard; PARALLEL STREETS one block out close the blocks.
//   • REAL BLOCKS — 4–5 tiles deep between the avenue and the parallel
//     street, 6–10 long between cross streets — lined with depth-2 lots on
//     every street frontage; what is left in the middle is the block
//     interior (back yards, and TOWN-4.4's courtyard / parking art).
//   • OUTER RESIDENTIAL: a ribbon beyond the parallel street, served by
//     cul-de-sac spurs that end in a turning circle — never a raw stub.
//   • DISTRICTS 0–3 by Chebyshev ring from the hall: the core (avenue +
//     square + the first ring) is the village a new game starts with;
//     TOWN-4.4 reveals the rest tier by tier.
//
// This module is PURE GEOMETRY. `planTown` reads only the terrain, the
// occupancy, the industry footprints and a seeded RNG, and returns a
// `TownPlan` — or null when the ground cannot hold one, in which case the
// caller tries another centre, exactly like the organic layout's rejection.
// It stamps nothing: `placeTowns` (grid.ts) commits the plan to the
// occupancy array, `seedTownRoads` / `seedTownAvenues` (track.ts) pave it at
// boot, and TOWN-4.4 fills its lots with art.
//
// Nothing here is stored on a save or sent on the wire: like the organic
// outline, a planned town is regenerated from the seed with the rest of the
// map, so every client and every reload builds the identical plan.
//
// DETERMINISM. `planTown` draws from the caller's RNG stream in exactly this
// order — avenue length, row-A depth (square side, far side), ribbon depth
// (square side, far side), then per side (square side first) the cross-street
// period and the stagger — and NOTHING else: the axis and the square's side
// come from the free ground (the longer run, the fuller side), so a plan is a
// pure function of the centre, the terrain, the occupancy, the industry
// rectangles and that one burst of draws. `planTown` may return null several
// times before one centre is accepted, so the caller must not depend on how
// many draws a REJECTED attempt consumed; only an accepted plan's stream
// position is part of the map.
// ══════════════════════════════════════════════════════════════════════════

import { MAP_W, MAP_H } from "./config";

// Local copies, so this module never imports `grid.ts` (which imports it).
const idx = (tx: number, ty: number) => ty * MAP_W + tx;
const inBounds = (tx: number, ty: number) => tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H;
/** grid.ts's WATER terrain byte; a local copy for the same reason. */
const WATER_IDX = 1;

/** TOWN-4.1 (#677): the map sizes a plan is drawn for. */
export type PlanSize = "standard" | "large";
/** The avenue's axis in tile space: `x` runs along x, `y` along y. */
export type PlanAxis = "x" | "y";
/** A lot's zone — what TOWN-4.4 draws on it (epic §2.6). */
export type LotZone = "downtown" | "inner" | "outer" | "edge" | "civic";
/**
 * The tile-space direction of the street a lot fronts: `front` names the
 * neighbour the street sits on (track.ts's NE/SE/SW/NW, i.e. NE = (0,−1),
 * SE = (+1,0), SW = (0,+1), NW = (−1,0)).
 */
export type LotFront = "NE" | "SE" | "SW" | "NW";
/** `street` — a full town street; `lane` — an outer service street / spur. */
export type StreetKind = "street" | "lane";

/**
 * TOWN-4.4: the civic buildings a plan reserves plots for, by
 * `CIVIC_BUILDINGS` sprite name. A unit test pins these names to that table,
 * so a rename there cannot silently orphan a reserved plot.
 */
export const PLAN_CIVIC = {
  /** On the square: a 1×1 plot beside the plaza (the bank is the tier-1 centre). */
  square: "town_post_office",
  /** At the edge: 2×2 plots in the outer ribbon. */
  edge: ["town_school", "town_hospital"] as const,
  /** At the edge: a 4×2 / 2×4 plot — the stadium. */
  long: "town_stadium",
} as const;

/** The Chebyshev ring a plan keeps between its blocks and an industry: the
 *  same TOWN_INDUSTRY_SEP (grid.ts) the grid layout keeps between a house and
 *  an industry, applied here to the WHOLE plan so growth never hits a node. */
export const PLANNED_INDUSTRY_SEP = 8;

/** A resource footprint, as the plan's industry halo needs it. */
export interface IndustryRect { tx: number; ty: number; w: number; h: number }

/** One building plot: `w`×`h` tiles from (x, y), facing its street. */
export interface Lot {
  x: number;
  y: number;
  w: number;
  h: number;
  zone: LotZone;
  front: LotFront;
  district: number;
  /** A lot at the end of a block's frontage — TOWN-4.4's corner shops. */
  corner?: boolean;
  /** Reserved for this civic building (a `CIVIC_BUILDINGS` sprite name). */
  civic?: string;
}

/** One street of the plan, as the run of tiles that survived the trim. */
export interface PlanStreet {
  kind: StreetKind;
  tiles: [number, number][];
  /**
   * The EARLIEST district the street's tiles fall in — the tier at which the
   * street first exists. A street that only starts at tier 1 has `district: 1`.
   */
  district: number;
}

/**
 * One city block: its lots, the interior tiles between them (back yards /
 * courtyard / parking — TOWN-4.4's art), and the district it belongs to.
 * A `"park"` block is designated green: no lots, every tile interior.
 */
export interface PlanBlock {
  lots: Lot[];
  interior: [number, number][];
  district: number;
  zone: LotZone;
  kind: "built" | "park";
}

/**
 * The master plan of one planned town. Field names follow the TOWN-4 epic's
 * architecture sketch (§4); the extras (`avenueTiles`, `termini`, `core`,
 * `reserved`, `bounds`) are what the generator and the boot stamps read.
 */
export interface TownPlan {
  axis: PlanAxis;
  size: PlanSize;
  /** The side of the hall the square is on: −1 folds the plan's +v the other way. */
  mirror: 1 | -1;
  /** The avenue's centre line, from its low-u end to its high-u end. */
  avenue: { from: [number, number]; to: [number, number] };
  /** Both carriageway tiles of the avenue, low-u end first. */
  avenueTiles: [number, number][];
  /** The avenue's tiles at its two ends: where a highway may meet the town. */
  termini: [number, number][];
  square: {
    x0: number; y0: number; x1: number; y1: number;
    /** `Town.tx/ty`: the hall tile, the square's avenue-facing centre. */
    hall: [number, number];
    tiles: [number, number][];
  };
  streets: PlanStreet[];
  /** The turning-circle tiles of the outer cul-de-sacs. */
  culDeSacs: [number, number][];
  blocks: PlanBlock[];
  /** District count: 0 = core … 3 = city edge. */
  districts: number;
  /** The plan's outer rectangle (the "planned town edge"). */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /**
   * The district rings, in plan-frame Chebyshev distance per axis: a tile is
   * in district `i` when both `|u| <= rings.u[i]` and `|v| <= rings.v[i]`.
   * Scaled to the plan's own extents (a plan is wider along the avenue than
   * deep across it), so all four districts are real bands of ground rather
   * than one huge core and a sliver at the tip.
   */
  rings: { u: [number, number, number]; v: [number, number, number] };
  /**
   * The plan's district-0 tiles — the village a new game starts with. These
   * are the only plan tiles stamped `TOWN_OCC` at generation (beside the
   * avenue): the reserved districts stay free land until TOWN-4.4's growth
   * reveals them, exactly as L17's grown ring does.
   */
  core: [number, number][];
  /**
   * Every tile the plan reserves (all districts) — what the PP-14 repair must
   * not re-site an industry onto, so growth never hits a resource node.
   */
  reserved: [number, number][];
}

// ── the size knobs ────────────────────────────────────────────────────────
/**
 * The plan's dimensions, per map size (TOWN-4.1). Standard is what the 144×144
 * map has room for today; large is the 216×216 map's target from the epic
 * (§2.10). Nothing here reads the map's actual size: `planTown` is handed the
 * size by its caller, and a plan that does not fit the ground it is given is
 * rejected like any other.
 */
interface PlanKnobs {
  /** Avenue length, in tiles (drawn, then clipped to the free run). */
  aveMin: number;
  aveMax: number;
  /** The square: extent along the avenue × extent across it. */
  squareU: number;
  squareV: number;
  /** Block row depths: between the avenue and the parallel street. */
  depthsA: readonly number[];
  /** Block row depths: beyond the parallel street (the outer ribbon). */
  depthsB: readonly number[];
  /** The free run along the avenue's axis a plan needs before it is drawn. */
  minHalf: number;
  /** Minimum Chebyshev distance between two planned town centres. */
  sep: number;
}

const KNOBS: Record<PlanSize, PlanKnobs> = {
  standard: {
    aveMin: 22, aveMax: 28, squareU: 4, squareV: 4,
    depthsA: [4, 5], depthsB: [2, 3], minHalf: 11, sep: 44,
  },
  large: {
    aveMin: 32, aveMax: 40, squareU: 4, squareV: 6,
    depthsA: [4, 5], depthsB: [3, 4], minHalf: 16, sep: 64,
  },
};

/**
 * TOWN-4.3: the Chebyshev distance two planned town CENTRES keep — 44 on the
 * standard map, 64 on the large one (BUILD item 2). A plan is much bigger
 * than the old 13–19 tile town box (an avenue alone is up to 40 tiles long),
 * so the grid layout's 28 would let two plans overlap.
 */
export const plannedTownSep = (size: PlanSize = "standard"): number => KNOBS[size].sep;

/** The Chebyshev ring (district) a tile belongs to, from the plan's hall. */
export function planTileDistrict(plan: TownPlan, tx: number, ty: number): number {
  const [hx, hy] = plan.square.hall;
  // Back into the plan's own (u, v) frame: u runs along the avenue, v across
  // it (mirrored, so +v is always the square's side).
  const du = Math.abs(plan.axis === "x" ? tx - hx : ty - hy);
  const dv = Math.abs((plan.axis === "x" ? ty - hy : tx - hx) * plan.mirror);
  for (let i = 0; i < 3; i++) {
    if (du <= plan.rings.u[i] && dv <= plan.rings.v[i]) return i;
  }
  return 3;
}

/** Every lot tile of the plan, in block order. */
export function planLotTiles(plan: TownPlan): [number, number][] {
  const out: [number, number][] = [];
  for (const block of plan.blocks) {
    for (const lot of block.lots) {
      for (let dy = 0; dy < lot.h; dy++) {
        for (let dx = 0; dx < lot.w; dx++) out.push([lot.x + dx, lot.y + dy]);
      }
    }
  }
  return out;
}

/** Every paved tile of the plan: the avenue, its streets and the circles. */
export function planRoadTiles(plan: TownPlan): [number, number][] {
  const seen = new Set<number>();
  const out: [number, number][] = [];
  const add = (tiles: readonly [number, number][]): void => {
    for (const [x, y] of tiles) {
      const k = y * 4096 + x;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push([x, y]);
    }
  };
  add(plan.avenueTiles);
  for (const street of plan.streets) add(street.tiles);
  add(plan.culDeSacs);
  return out;
}

/**
 * BUILD item 2: the tiles a planned town OWNS at generation — the district-0
 * village beside the avenue. `houses` is every district-0 lot tile (what
 * `Town.houses` carries: the ground `townBuildings` may build on and the
 * budget CIVIC-1 spends), `roads` is every district-0 street tile plus the
 * whole avenue (the town's spine, laid at full length from tier 0). The
 * square's tiles are returned separately: public ground that is stamped
 * `TOWN_OCC` like a street but is not a lot and not a lane.
 */
export function planVillage(plan: TownPlan): {
  houses: [number, number][];
  roads: [number, number][];
  square: [number, number][];
} {
  const key = (x: number, y: number): number => y * 4096 + x;
  const avenue = new Set<number>(plan.avenueTiles.map(([x, y]) => key(x, y)));
  const houses = planLotTiles(plan).filter(([x, y]) => planTileDistrict(plan, x, y) === 0);
  const roads: [number, number][] = [];
  const seen = new Set<number>();
  for (const [x, y] of planRoadTiles(plan)) {
    const k = key(x, y);
    if (seen.has(k)) continue;
    if (!avenue.has(k) && planTileDistrict(plan, x, y) !== 0) continue;
    seen.add(k);
    roads.push([x, y]);
  }
  return { houses, roads, square: [...plan.square.tiles] };
}

/** The plan's lots in districts 0..tier — TOWN-4.4's reveal filter. */
export function planLotsUpTo(plan: TownPlan, tier: number): Lot[] {
  const out: Lot[] = [];
  for (const block of plan.blocks) {
    for (const lot of block.lots) if (lot.district <= tier) out.push(lot);
  }
  return out;
}

// ── the plan frame ────────────────────────────────────────────────────────
// `planTown` works in the town's own frame: u runs ALONG the avenue and v
// ACROSS it, both as offsets from the hall (which sits at (0, 0)). The
// square's side is always +v and the avenue always sits at v = −2, −1, so the
// same geometry serves either axis and either side of the hall; `axis` and
// `mirror` fold the frame onto the world.

/** The plan frame's tile key (|u|, |v| stay well under 512 for a map). */
const key = (u: number, v: number): number => (u + 512) * 1024 + (v + 512);
const keyU = (k: number): number => Math.floor(k / 1024) - 512;
const keyV = (k: number): number => (k % 1024) - 512;

/** One block of the ideal lattice, before the terrain has its say. */
interface BlockSpec {
  side: 1 | -1;
  row: "A" | "B";
  u0: number; u1: number;
  v0: number; v1: number;
  /** The square's own column on the square side: a plaza, not a block of lots. */
  square: boolean;
}

/**
 * TOWN-4.3: draw the master plan of one planned town, centred on the HALL
 * tile (cx, cy) — `Town.tx/ty`, the square's avenue-facing centre.
 *
 * Pure and deterministic: the same centre, terrain, occupancy, industries and
 * RNG stream give the same plan, and nothing is written to `terrain` or
 * `occ`. Returns null when the ground cannot hold a plan worth having (no
 * avenue-length run, the avenue or the square is cut, fewer than 6 blocks
 * survive, more than 40% of the ideal blocks are lost) — the caller then
 * tries another centre.
 *
 * `industries` is the halo rule of BUILD item 2: "keep industries at
 * TOWN_INDUSTRY_SEP from the WHOLE plan, so growth never hits an industry".
 * A block within `PLANNED_INDUSTRY_SEP` tiles of a resource footprint is
 * dropped whole (the lots the grown city would draw on), while streets may
 * still pass closer, exactly as a grid town's streets may.
 */
export function planTown(
  cx: number, cy: number,
  terrain: Uint8Array, occ: Int16Array,
  rng: () => number,
  size: PlanSize = "standard",
  industries: readonly IndustryRect[] = [],
): TownPlan | null {
  const knobs = KNOBS[size];
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];
  const free = (tx: number, ty: number): boolean =>
    inBounds(tx, ty) && terrain[idx(tx, ty)] !== WATER_IDX && occ[idx(tx, ty)] === -1;

  /** The free run of a straight corridor from the hall, one way. */
  const freeRun = (dx: number, dy: number): number => {
    let n = 0;
    while (free(cx + dx * (n + 1), cy + dy * (n + 1))) n++;
    return n;
  };
  // BUILD item 1: "the avenue runs along the town's longer free extent". A
  // corridor is measured both ways from the hall on each axis and the longer
  // axis wins (a tie keeps x), so the avenue goes where the ground lets it go
  // longest — no draw is spent on the choice. The mirror then puts the square
  // on the fuller of the two sides across the avenue, again by measurement.
  const xs = freeRun(1, 0) + freeRun(-1, 0);
  const ys = freeRun(0, 1) + freeRun(0, -1);
  const axis: PlanAxis = xs >= ys ? "x" : "y";
  const mirror: 1 | -1 = axis === "x"
    ? (freeRun(0, 1) >= freeRun(0, -1) ? 1 : -1)
    : (freeRun(1, 0) >= freeRun(-1, 0) ? 1 : -1);
  /** Plan (u, v) → world tile. */
  const at = (u: number, v: number): [number, number] =>
    axis === "x" ? [cx + u, cy + v * mirror] : [cx + v * mirror, cy + u];
  const freeAt = (u: number, v: number): boolean => {
    const [x, y] = at(u, v);
    return free(x, y);
  };
  /** A plan-frame rect → the world rect a `Lot` carries. */
  const rect = (u0: number, v0: number, u1: number, v1: number): { x: number; y: number; w: number; h: number } => {
    const w = u1 - u0 + 1, h = v1 - v0 + 1;
    if (axis === "x") return { x: cx + u0, y: mirror > 0 ? cy + v0 : cy - v1, w, h };
    return { x: mirror > 0 ? cx + v0 : cx - v1, y: cy + u0, w: h, h: w };
  };

  // ── the avenue's length, from the free run through the hall ────────────
  // Both carriageways must be free for the whole run: the avenue is the
  // town's spine and its two ends are where the highways meet it, so a cut
  // avenue is not a plan.
  const av = -2;                                   // the low-v carriageway row
  let uLo = 0, uHi = 0;
  while (freeAt(uLo - 1, av) && freeAt(uLo - 1, av + 1)) uLo--;
  while (freeAt(uHi + 1, av) && freeAt(uHi + 1, av + 1)) uHi++;
  const want = knobs.aveMin + Math.floor(rng() * (knobs.aveMax - knobs.aveMin + 1));
  const half = Math.min(Math.floor((want - 1) / 2), -uLo, uHi);
  if (half < knobs.minHalf) return null;
  const Lu = Math.min(want, 2 * half + 1);
  if (Lu < knobs.aveMin || Lu > knobs.aveMax) return null;
  const U0 = -Math.floor((Lu - 1) / 2), U1 = U0 + Lu - 1;

  // ── the square, centred on the hall ───────────────────────────────────
  // The church is 2×2 at the hall tile, so the square keeps two tiles either
  // side of it along u: a 4-wide plaza (6 on the large map), 4 deep.
  const sqU0 = -Math.floor((knobs.squareU - 2) / 2);
  const sqU1 = sqU0 + knobs.squareU - 1;
  const sqV0 = 0, sqV1 = knobs.squareV - 1;
  if (sqU0 <= U0 + 1 || sqU1 >= U1 - 1) return null;
  for (let v = sqV0; v <= sqV1; v++) {
    for (let u = sqU0; u <= sqU1; u++) if (!freeAt(u, v)) return null;
  }
  const inSquare = (u: number, v: number): boolean =>
    u >= sqU0 && u <= sqU1 && v >= sqV0 && v <= sqV1;

  // ── the depths, drawn per side ────────────────────────────────────────
  const dA = [pick(knobs.depthsA), pick(knobs.depthsA)];   // [square side, far side]
  const dB = [pick(knobs.depthsB), pick(knobs.depthsB)];

  /** The block row between the avenue and the parallel street. */
  const rowA = (side: 1 | -1) => ({
    /** The avenue-side row. */
    a: side > 0 ? 0 : -3,
    /** The parallel-street-side row. */
    p: side > 0 ? dA[0] - 1 : -2 - dA[1],
    par: side > 0 ? dA[0] : -3 - dA[1],
  });
  /** The outer ribbon beyond the parallel street. */
  const rowB = (side: 1 | -1) => {
    const par = side > 0 ? dA[0] : -3 - dA[1];
    return { a: par + side, b: par + side * dB[side > 0 ? 0 : 1], par };
  };
  const run = (from: number, to: number): number[] => {
    const out: number[] = [];
    for (let v = from; from <= to ? v <= to : v >= to; v += from <= to ? 1 : -1) out.push(v);
    return out;
  };

  // ── the ideal street lattice ──────────────────────────────────────────
  // Cross streets every 6–8 tiles from a seeded phase, drawn independently
  // per side so the two sides' crossings are staggered (T-junctions). The
  // square's side drops any position inside the plaza's own column.
  const crossUs: [number[], number[]] = [[], []];
  let phase = Math.floor(rng() * 3);
  for (let s = 0; s < 2; s++) {
    const side: 1 | -1 = s === 0 ? 1 : -1;
    const period = pick([6, 7, 8] as const);
    // BUILD item 1: "a seeded 1-2 tile stagger" — the far side's crossings sit
    // 1-2 tiles off the square side's, so most crossings are T-junctions.
    if (s === 1) phase += rng() < 0.5 ? 1 : 2;
    for (let u = U0 + 4 + phase; u <= U1 - 4; u += period) crossUs[s].push(u);
    if (side > 0) crossUs[s] = crossUs[s].filter((u) => u < sqU0 || u > sqU1);
  }
  crossUs[0].sort((a, b) => a - b);
  crossUs[1].sort((a, b) => a - b);

  // ── the street set, as plan-frame keys ────────────────────────────────
  const street = new Map<number, StreetKind>();
  const avenueKeys = new Set<number>();
  const circles = new Set<number>();
  for (const u of run(U0, U1)) {
    for (const v of [av, av + 1]) {
      avenueKeys.add(key(u, v));
      street.set(key(u, v), "street");
    }
  }
  for (let s = 0; s < 2; s++) {
    const side: 1 | -1 = s === 0 ? 1 : -1;
    const { a, par } = rowA(side);
    for (const u of crossUs[s]) for (const v of run(a, par)) street.set(key(u, v), "street");
  }
  // The parallel streets span their side's first to last cross street: both
  // ends are junctions, so neither end is a stub.
  for (let s = 0; s < 2; s++) {
    const side: 1 | -1 = s === 0 ? 1 : -1;
    const list = crossUs[s];
    if (list.length < 2) {
      // Nothing to hang a parallel street from: drop this side's crossings too.
      const { a, par } = rowA(side);
      for (const u of list) for (const v of run(a, par)) street.delete(key(u, v));
      list.length = 0;
      continue;
    }
    const { par } = rowA(side);
    for (const u of run(list[0], list[list.length - 1])) street.set(key(u, par), "street");
  }

  // ── the cul-de-sac lanes (outer residential) ──────────────────────────
  // Every cross street continues one block deep into the outer ribbon beyond
  // the parallel street, as a lane ending in a turning circle at the ribbon's
  // far edge — the one legal dead end the epic allows, and the outer
  // residential ring's access.
  const spurs: { side: 1 | -1; u: number; v0: number; v1: number }[] = [];
  for (let s = 0; s < 2; s++) {
    const side: 1 | -1 = s === 0 ? 1 : -1;
    const list = crossUs[s];
    if (list.length < 2) continue;
    const { a: bNear, b: bFar } = rowB(side);
    for (const u of list) {
      let ok = true;
      for (const v of run(bNear, bFar)) if (!freeAt(u, v)) ok = false;
      if (!ok) continue;
      for (const v of run(bNear, bFar)) street.set(key(u, v), "lane");
      circles.add(key(u, bFar));
      spurs.push({ side, u, v0: Math.min(bNear, bFar), v1: Math.max(bNear, bFar) });
    }
  }

  // ── the block lattice ─────────────────────────────────────────────────
  const specs: BlockSpec[] = [];
  for (let s = 0; s < 2; s++) {
    const side: 1 | -1 = s === 0 ? 1 : -1;
    const { a, p } = rowA(side);
    const v0 = Math.min(a, p), v1 = Math.max(a, p);
    const bounds: [number, number][] = [];
    let prev = U0;
    for (const u of crossUs[s]) {
      if (u - 1 >= prev) bounds.push([prev, u - 1]);
      prev = u + 1;
    }
    if (prev <= U1) bounds.push([prev, U1]);
    for (const [u0, u1] of bounds) {
      if (u1 < u0) continue;
      const square = side > 0 && u0 >= sqU0 && u1 <= sqU1;
      specs.push({ side, row: "A", u0, u1, v0, v1, square });
    }
    const { a: bNear, b: bFar } = rowB(side);
    const bv0 = Math.min(bNear, bFar), bv1 = Math.max(bNear, bFar);
    // The ribbon only exists where the parallel street runs — its own lane
    // columns are the block boundaries, so every ribbon block fronts a street.
    const lanes = spurs.filter((x) => x.side === side).map((x) => x.u);
    if (lanes.length < 2) continue;
    let start = lanes[0] + 1;
    for (const u of lanes.slice(1)) {
      if (u - 1 >= start) specs.push({ side, row: "B", u0: start, u1: u - 1, v0: bv0, v1: bv1, square: false });
      start = u + 1;
    }
    if (start <= lanes[lanes.length - 1]) specs.push({ side, row: "B", u0: start, u1: lanes[lanes.length - 1], v0: bv0, v1: bv1, square: false });
  }

  // ── keep a block only when its whole footprint is free ground ─────────
  // "Water, rivers, steep slopes and industries drop whole blocks, never half
  // a block." Slopes do not exist at plan time (the height map is built after
  // every town), so the test is terrain + occupancy + the industry halo.
  const gapToIndustry = (u0: number, v0: number, u1: number, v1: number): number => {
    let best = Infinity;
    for (const ind of industries) {
      const { x, y, w, h } = rect(u0, v0, u1, v1);
      const dx = Math.max(0, Math.max(ind.tx - (x + w - 1), x - (ind.tx + ind.w - 1)));
      const dy = Math.max(0, Math.max(ind.ty - (y + h - 1), y - (ind.ty + ind.h - 1)));
      best = Math.min(best, Math.max(dx, dy));
      if (best === 0) break;
    }
    return best;
  };
  const kept: BlockSpec[] = [];
  for (const spec of specs) {
    let ok = true;
    for (let v = spec.v0; v <= spec.v1 && ok; v++) {
      for (let u = spec.u0; u <= spec.u1; u++) {
        if (!freeAt(u, v)) { ok = false; break; }
      }
    }
    if (ok && gapToIndustry(spec.u0, spec.v0, spec.u1, spec.v1) < PLANNED_INDUSTRY_SEP) ok = false;
    if (ok) kept.push(spec);
  }
  const idealBlocks = specs.filter((s) => !s.square).length;
  const builtBlocks = kept.filter((s) => !s.square);
  if (builtBlocks.length < 6 || builtBlocks.length < Math.ceil(idealBlocks * 0.6)) return null;

  // ── trim the streets: leaves back to their last junction ──────────────
  // "A street cut by water is trimmed back to its last junction (no stubs)."
  // Repeatedly drop a street tile with fewer than two street neighbours — the
  // end of a run nothing continues — and keep only the component the avenue
  // is in, so every surviving street is reachable from the spine. A
  // cul-de-sac circle is exempt: it is the one legal dead end.
  const streetNeighbours = (k: number): number => {
    const u = keyU(k), v = keyV(k);
    let n = 0;
    if (street.has(key(u - 1, v))) n++;
    if (street.has(key(u + 1, v))) n++;
    if (street.has(key(u, v - 1))) n++;
    if (street.has(key(u, v + 1))) n++;
    return n;
  };
  for (let pass = 0; pass < 4; pass++) {
    for (let sweep = 0; sweep < 64; sweep++) {
      let removed = 0;
      for (const k of [...street.keys()]) {
        if (avenueKeys.has(k) || circles.has(k)) continue;
        if (streetNeighbours(k) < 2) { street.delete(k); removed++; }
      }
      if (!removed) break;
    }
    const start = [...avenueKeys].find((k) => street.has(k));
    if (start !== undefined) {
      const seen = new Set<number>([start]);
      const stack = [start];
      while (stack.length) {
        const k = stack.pop()!;
        const u = keyU(k), v = keyV(k);
        for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nk = key(u + du, v + dv);
          if (!street.has(nk) || seen.has(nk)) continue;
          seen.add(nk);
          stack.push(nk);
        }
      }
      for (const k of [...street.keys()]) {
        if (seen.has(k) || avenueKeys.has(k) || circles.has(k)) continue;
        street.delete(k);
      }
    }
  }
  for (const k of [...circles]) if (streetNeighbours(k) < 1) circles.delete(k);

  // ── districts, zones and the lot grid ─────────────────────────────────
  // The rings are fractions of the plan's own extents (see `TownPlan.rings`).
  const uHalf = Math.max(-U0, U1);
  const vHalf = Math.max(dA[0] + dB[0], 2 + dA[1] + dB[1]);
  const rings = {
    u: ([0.45, 0.7, 0.9] as const).map((k) => Math.max(3, Math.round(k * uHalf))) as [number, number, number],
    v: ([0.45, 0.7, 0.9] as const).map((k) => Math.max(3, Math.round(k * vHalf))) as [number, number, number],
  };
  const planDistrict = (u: number, v: number): number => {
    const au = Math.abs(u), av = Math.abs(v);
    for (let i = 0; i < 3; i++) if (au <= rings.u[i] && av <= rings.v[i]) return i;
    return 3;
  };
  /** The plan's own (u, v) district read, from a world tile. */
  const tileDistrict = (x: number, y: number): number => {
    const du = axis === "x" ? x - cx : y - cy;
    const dv = (axis === "x" ? y - cy : x - cx) * mirror;
    return planDistrict(du, dv);
  };
  const hash = (u: number, v: number): number => {
    let h = Math.imul(u + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(v + 0x7f4a7c15, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
    return (h ^ (h >>> 15)) >>> 0;
  };
  const front = {
    uNeg: axis === "x" ? "NW" : "NE",
    uPos: axis === "x" ? "SE" : "SW",
    vNeg: axis === "x" ? (mirror > 0 ? "NE" : "SW") : (mirror > 0 ? "NW" : "SE"),
    vPos: axis === "x" ? (mirror > 0 ? "SW" : "NE") : (mirror > 0 ? "SE" : "NW"),
  } as const satisfies Record<string, LotFront>;

  /** Designated park blocks: the outermost ribbon block of each side. */
  const parkKeys = new Set<string>();
  for (const side of [1, -1] as const) {
    const list = kept.filter((s) => s.side === side && s.row === "B");
    if (list.length >= 2) parkKeys.add(`${list[0].u0},${list[0].v0}`);
  }

  /** Civic plots reserved for TOWN-4.4, by block key. */
  const pins = new Map<string, { u: number; w: number; civic: string }[]>();
  const pin = (spec: BlockSpec, u: number, w: number, civic: string) => {
    const k = `${spec.u0},${spec.v0}`;
    const list = pins.get(k) ?? [];
    list.push({ u, w, civic });
    pins.set(k, list);
  };
  {
    // The post office stands beside the plaza, on the square's own block (the
    // block column the plaza is cut into — it is usually wider than the plaza).
    const squareBlock = kept.find(
      (s) => s.side > 0 && s.row === "A" && s.u0 <= sqU0 && s.u1 >= sqU1,
    );
    if (squareBlock) pin(squareBlock, sqU0 - 1, 1, PLAN_CIVIC.square);
    // The school and the hospital take a 2×2 plot in the outer ribbon, one
    // per side, on the parallel street's frontage.
    const edgeBlocks = kept.filter((s) => s.row === "B" && !parkKeys.has(`${s.u0},${s.v0}`));
    const schoolBlock = edgeBlocks[0];
    const hospitalBlock = edgeBlocks[edgeBlocks.length - 1];
    for (const [spec, def] of [[schoolBlock, PLAN_CIVIC.edge[0]], [hospitalBlock, PLAN_CIVIC.edge[1]]] as const) {
      if (!spec || spec.u1 - spec.u0 + 1 < 2) continue;
      pin(spec, spec.u0 + Math.floor((spec.u1 - spec.u0 + 1 - 2) / 2), 2, def);
    }
    // The stadium needs four tiles along the street: the widest ribbon block.
    const wide = kept
      .filter((s) => s.row === "B" && !parkKeys.has(`${s.u0},${s.v0}`) && s.u1 - s.u0 + 1 >= 4)
      .sort((a, b) => (b.u1 - b.u0) - (a.u1 - a.u0) || a.u0 - b.u0)[0];
    if (wide) pin(wide, wide.u0 + Math.floor((wide.u1 - wide.u0 + 1 - 4) / 2), 4, PLAN_CIVIC.long);
  }

  const blocks: PlanBlock[] = [];
  for (const spec of kept) {
    const park = parkKeys.has(`${spec.u0},${spec.v0}`);
    const claimed = new Set<number>();
    const lots: Lot[] = [];
    const blockPins = [...(pins.get(`${spec.u0},${spec.v0}`) ?? [])].sort((a, b) => a.u - b.u);

    /** The tiles a lot of `rows` (the two frontage rows) covers from `u`. */
    const lotRect = (uFrom: number, uTo: number, rows: number[]): { u0: number; u1: number; v0: number; v1: number } => ({
      u0: Math.min(uFrom, uTo), u1: Math.max(uFrom, uTo),
      v0: Math.min(...rows), v1: Math.max(...rows),
    });
    const addLot = (
      r: { u0: number; u1: number; v0: number; v1: number },
      zone: LotZone, frontDir: LotFront, district: number,
      corner: boolean, civic?: string,
    ) => {
      const { x, y, w, h } = rect(r.u0, r.v0, r.u1, r.v1);
      const lot: Lot = { x, y, w, h, zone, front: frontDir, district };
      if (corner) lot.corner = true;
      if (civic) lot.civic = civic;
      lots.push(lot);
      for (let v = r.v0; v <= r.v1; v++) for (let u = r.u0; u <= r.u1; u++) claimed.add(key(u, v));
    };

    /**
     * Lay depth-2 lots along one horizontal frontage run, in `along` order,
     * honouring the block's pinned civic plots. A pinned plot takes its exact
     * `w` tiles from its own `u`; the rest of the run is subdivided by zone.
     */
    const layHorizontal = (
      along: [number, number][], depthRows: number[], frontDir: LotFront,
      zone: LotZone, district: number,
    ) => {
      const pinned = blockPins.filter((p) => p.u >= along[0][0] && p.u <= along[along.length - 1][0]);
      let i = 0;
      const takePin = (): boolean => {
        const cur = along[i];
        const p = pinned.find((x) => x.u === cur[0]);
        if (!p) return false;
        const cells = along.slice(i, i + p.w);
        if (cells.length < p.w) return false;
        for (let j = 1; j < cells.length; j++) if (cells[j][0] !== cells[0][0] + j) return false;
        addLot(lotRect(cells[0][0], cells[cells.length - 1][0], depthRows), "civic", frontDir, district, false, p.civic);
        i += p.w;
        return true;
      };
      while (i < along.length) {
        if (takePin()) continue;
        const width = zone === "inner" ? (hash(along[i][0], along[i][1]) % 4 === 0 ? 2 : 1) : 2;
        const end = Math.min(along.length, i + width);
        const cells = along.slice(i, end);
        if (cells.length) {
          const corner = i === 0 || end === along.length;
          addLot(lotRect(cells[0][0], cells[cells.length - 1][0], depthRows), zone, frontDir, district, corner);
        }
        i = end;
      }
    };

    if (!park) {
      // Horizontal frontages first: their rows take the corners, and the
      // avenue / parallel street are always the busier of the streets meeting
      // at a corner (the epic's "corner lots front the busier one").
      const edges: { rows: number[]; out: number; dir: LotFront; kind: "avenue" | "parallel" | "lane" }[] = [];
      const { par } = rowA(spec.side);
      const parOf = spec.row === "A" ? par : rowB(spec.side).par;
      const nearAvenue = spec.side > 0 ? [0, 1] : [-3, -4];
      // Row A's parallel frontage is on its far side, the ribbon's on its near
      // side: both face `par`, from opposite banks.
      const nearPar = spec.row === "A"
        ? [parOf - 2 * spec.side, parOf - spec.side]
        : [parOf + spec.side, parOf + 2 * spec.side];
      const dirPar = spec.row === "A" ? spec.side : -spec.side;
      if (spec.row === "A") {
        // The avenue frontage runs even for the block that carries the
        // square's column: the `along` loop below drops the plaza's own tiles
        // one by one, so gating the whole edge on `spec.u0` used to hand that
        // block's remaining avenue tiles to the cross-street pass below —
        // where they fronted the side street while the avenue ran past their
        // door (the ONE corner-lot violation the seeds had).
        edges.push({ rows: nearAvenue, out: spec.side > 0 ? -1 : -2, dir: spec.side > 0 ? front.vNeg : front.vPos, kind: "avenue" });
        edges.push({ rows: nearPar, out: par, dir: dirPar > 0 ? front.vPos : front.vNeg, kind: "parallel" });
      } else {
        edges.push({ rows: nearPar, out: par, dir: dirPar > 0 ? front.vPos : front.vNeg, kind: "parallel" });
      }
      for (const edge of edges) {
        const along: [number, number][] = [];
        for (const u of run(spec.u0, spec.u1)) {
          if (!street.has(key(u, edge.out))) continue;
          if (edge.rows.some((v) => inSquare(u, v))) continue;   // the plaza's edge
          along.push([u, edge.rows[0]]);
        }
        if (!along.length) continue;
        const d = planDistrict(along[0][0], edge.rows[0]);
        // The epic's zoning (§2.6): commercial on the avenue near the square,
        // terraces and small flats in the core's other frontages, detached
        // houses further out, parks and allotments at the plan's rim.
        const zone: LotZone = edge.kind === "avenue" && Math.abs(along[0][0]) <= 10 && d <= 1
          ? "downtown"
          : d <= 1 ? "inner" : d >= 3 ? "edge" : "outer";
        layHorizontal(along, edge.rows, edge.dir, zone, d);
      }
      // Then the short sides (cross streets and spur lanes), on whatever rows
      // the horizontal lots left: a 2-wide column either side, 2 rows deep.
      for (const [cols, out, dir] of [
        [[spec.u0, spec.u0 + 1], spec.u0 - 1, front.uNeg],
        [[spec.u1 - 1, spec.u1], spec.u1 + 1, front.uPos],
      ] as const) {
        const rows: number[] = [];
        for (const v of run(spec.v0, spec.v1)) {
          if (!street.has(key(out, v))) continue;
          if (cols.some((u) => claimed.has(key(u, v)) || inSquare(u, v))) continue;
          rows.push(v);
        }
        const sideZone: LotZone = planDistrict(cols[0], rows[0]) <= 1 ? "inner" : planDistrict(cols[0], rows[0]) >= 3 ? "edge" : "outer";
        let i = 0;
        while (i < rows.length) {
          const width = sideZone === "inner" ? 1 : 2;
          const end = Math.min(rows.length, i + width);
          const cells = rows.slice(i, end);
          const district = planDistrict(cols[0], cells[0]);
          const zone: LotZone = district <= 1 ? "inner" : district >= 3 ? "edge" : "outer";
          const r = { u0: cols[0], u1: cols[1], v0: cells[0], v1: cells[cells.length - 1] };
          addLot(r, zone, dir, district, i === 0 || end === rows.length);
          i = end;
        }
      }
    }

    const interior: [number, number][] = [];
    for (const v of run(spec.v0, spec.v1)) {
      for (const u of run(spec.u0, spec.u1)) {
        if (claimed.has(key(u, v)) || inSquare(u, v)) continue;
        interior.push(at(u, v));
      }
    }
    const district = Math.min(...run(spec.v0, spec.v1).flatMap((v) => run(spec.u0, spec.u1).map((u) => planDistrict(u, v))));
    blocks.push({ lots, interior, district, zone: lots.length ? lots[0].zone : "edge", kind: park ? "park" : "built" });
  }
  // "≥ 6 blocks": blocks that actually carry lots — a block whose ground the
  // plan could not fill is not a block, it is a gap.
  if (blocks.filter((b) => b.kind === "built" && b.lots.length > 0).length < 6) return null;

  // ── the plan's outputs ────────────────────────────────────────────────
  // Everything below reads the plan back in world tiles. No spreads: a plan's
  // tile lists run to thousands of entries, and `Math.min(...list)` blows the
  // argument limit long before the large map's plan.
  const box = (tiles: readonly [number, number][]): { x0: number; y0: number; x1: number; y1: number } => {
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const [x, y] of tiles) {
      if (x < b.x0) b.x0 = x;
      if (y < b.y0) b.y0 = y;
      if (x > b.x1) b.x1 = x;
      if (y > b.y1) b.y1 = y;
    }
    return b;
  };
  const minDistrict = (tiles: readonly [number, number][]): number => {
    let d = 3;
    for (const [x, y] of tiles) {
      const t = tileDistrict(x, y);
      if (t < d) d = t;
    }
    return d;
  };
  /** The tiles a block's lots cover, as world tiles. */
  const planBlockLots = (block: PlanBlock): [number, number][] => {
    const out: [number, number][] = [];
    for (const lot of block.lots) {
      for (let dy = 0; dy < lot.h; dy++) for (let dx = 0; dx < lot.w; dx++) out.push([lot.x + dx, lot.y + dy]);
    }
    return out;
  };

  const streets: PlanStreet[] = [];
  for (let s = 0; s < 2; s++) {
    const side: 1 | -1 = s === 0 ? 1 : -1;
    const { a, par } = rowA(side);
    for (const u of crossUs[s]) {
      const tiles: [number, number][] = [];
      for (const v of run(a, par)) if (street.has(key(u, v))) tiles.push(at(u, v));
      if (tiles.length) streets.push({ kind: "street", tiles, district: minDistrict(tiles) });
    }
    const parTiles: [number, number][] = [];
    for (const u of run(U0, U1)) {
      if (avenueKeys.has(key(u, par))) continue;
      if (street.has(key(u, par))) parTiles.push(at(u, par));
    }
    if (parTiles.length) streets.push({ kind: "street", tiles: parTiles, district: minDistrict(parTiles) });
  }
  for (const sp of spurs) {
    const tiles: [number, number][] = [];
    for (const v of run(sp.v0, sp.v1)) if (street.has(key(sp.u, v))) tiles.push(at(sp.u, v));
    if (tiles.length) streets.push({ kind: "lane", tiles, district: minDistrict(tiles) });
  }
  const circlesOut: [number, number][] = [...circles].map((k) => at(keyU(k), keyV(k)));
  const avenueTiles: [number, number][] = [];
  for (const u of run(U0, U1)) for (const v of [av, av + 1]) avenueTiles.push(at(u, v));
  const termini: [number, number][] = [at(U0, av), at(U0, av + 1), at(U1, av), at(U1, av + 1)];
  const squareTiles: [number, number][] = [];
  for (const v of run(sqV0, sqV1)) for (const u of run(sqU0, sqU1)) squareTiles.push(at(u, v));

  // `reserved` is every tile of the plan (all districts) — the halo the PP-14
  // industry repair reads; `core` is district 0, the village the town OWNS at
  // generation and the only plan ground (beside the avenue) stamped TOWN_OCC.
  const reserved: [number, number][] = [];
  const core: [number, number][] = [];
  for (const k of street.keys()) {
    if (avenueKeys.has(k)) continue;
    const [x, y] = at(keyU(k), keyV(k));
    reserved.push([x, y]);
    if (tileDistrict(x, y) === 0) core.push([x, y]);
  }
  for (const block of blocks) {
    for (const [x, y] of planBlockLots(block)) {
      reserved.push([x, y]);
      if (block.kind !== "park" && tileDistrict(x, y) === 0) core.push([x, y]);
    }
    for (const [x, y] of block.interior) reserved.push([x, y]);
  }
  for (const [x, y] of squareTiles) {
    reserved.push([x, y]);
    core.push([x, y]);
  }
  const bounds = box([...reserved, ...avenueTiles]);
  return {
    axis,
    size,
    mirror,
    avenue: { from: at(U0, av), to: at(U1, av) },
    avenueTiles,
    termini,
    square: { ...box(squareTiles), hall: [cx, cy], tiles: squareTiles },
    streets,
    culDeSacs: circlesOut,
    blocks,
    districts: 4,
    rings,
    bounds,
    core,
    reserved,
  };
}
