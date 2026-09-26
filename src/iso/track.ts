// ══════════════════════════════════════════════════════════════════════════
// E5 — Road tiers (dirt & paved): the tile model, autotiling, drag-to-build.
//
// Two parallel Uint8Array(MAP_W*MAP_H) layers hold a 4-bit direction mask per
// tile (OpenTTD's RoadBits model), PRESENT=16, and optional one-sided diagonal
// links in bits 32/64 (D1, DEV-only). No wider bytes or format migration.
// The two tiers are `dirt` (basic gravel) and
// `road` (premium paved, which also carries the map's paved public/town
// roads). Paving a Road over a Dirt Road replaces it — a tile carries at most
// ONE layer, so there is no level-crossing overlay any more.
//
// The mask is the PHYSICAL road surface: a tile sets a bit toward a neighbour
// whenever that neighbour carries track of EITHER tier, so gravel and tar are
// one continuous surface — a Dirt Road that reaches a paved tile connects to
// it (that is the dirt↔paved seam feature: `dirt_road_*` transition sprites
// draw the join, and the economy floods the merged surface). The bit still
// lives in the tile's own tier layer, and a tile only ever carries one tier.
//
// Autotiling is a 4-bit / 16-variant problem, so the sprite key is built from
// the mask rather than looked up in a table nobody maintains:
//   `${kind}_${bits.toString(2).padStart(4,'0')}` → "dirt_0011" / "road_0011"
//
// Masks are recomputed ONLY for the tile placed plus its four neighbours, and
// only the containing chunks are invalidated. The whole map is never rescanned.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W, MAP_H } from "../game/config";
import { TRANSPORT, UPGRADE_COST, FACTORY_FOOTPRINT, ROAD_TIERS, moneyValueOf, type Cargo } from "./config";
import { WATER, ROUGH, TOWN_OCC, FIELD_OCC, rotatedSpan, heightAt as tileHeight, type Grid } from "./grid";
import {
  BRIDGE_COST, HIGHWAY_BRIDGE_SPAN, bridgeDeckAt, planBridges, sideJoinAt, type BridgePlan,
} from "./bridges";
// E4 (#268): the slope rules — the step the drag walked and the flanks it joins.
import { roadJoinSlopeRefusal, roadStepRefusal } from "./slopes";

// Keep the model independent of renderer → road-geometry → track. The renderer
// uses 8-tile chunks; a D1 guard test pins this invalidation contract. Moving
// the renderer's constants into a leaf module is a separate renderer cleanup.
const CHUNK = 8;
const chunksX = Math.ceil(MAP_W / CHUNK);

// ── directions ────────────────────────────────────────────────────────────
export const NE = 1, SE = 2, SW = 4, NW = 8;
export const DIRS = [NE, SE, SW, NW] as const;
export type Dir = typeof DIRS[number];

/** Explicit, one-sided diagonal storage, exactly like RAIL_DE / RAIL_DS.
 * These are NOT reciprocal direction bits: the lower-x endpoint owns the bit. */
export const ROAD_DE = 32, ROAD_DS = 64;
export const ROAD_DIAG = ROAD_DE | ROAD_DS;
/** The reverse directions are logical IDs only, NEVER stored in tile bytes. */
export const ROAD_DW = 128, ROAD_DN = 256;
export const DIAGONAL_DIRS = [ROAD_DE, ROAD_DS, ROAD_DW, ROAD_DN] as const;

export const DIR: Record<number, [number, number]> = {
  [NE]: [0, -1],
  [SE]: [1, 0],
  [SW]: [0, 1],
  [NW]: [-1, 0],
  [ROAD_DE]: [1, -1], [ROAD_DS]: [1, 1], [ROAD_DW]: [-1, 1], [ROAD_DN]: [-1, -1],
};

export const OPPOSITE: Record<number, number> = {
  [NE]: SW, [SE]: NW, [SW]: NE, [NW]: SE,
  [ROAD_DE]: ROAD_DW, [ROAD_DS]: ROAD_DN, [ROAD_DW]: ROAD_DE, [ROAD_DN]: ROAD_DS,
};

/** D4: direction of a straight resolved eight-way mask. Raw stored diagonal
 * bits must first be resolved at both endpoints; PRESENT is not a direction. */
export function straightTrackDirection(mask: number): number | undefined {
  return [...DIRS, ...DIAGONAL_DIRS].find((d) => mask === (d | OPPOSITE[d]));
}

/** Shared model/geometry crossing policy. Straight axis/axis and axis/diagonal
 * intersections are legal, never parallel runs, bends, junctions or two
 * diagonals in an X. Diagonal arguments use logical ROAD_D* directions. */
export function crossingMasksOk(roadMask: number, railMask: number, roadDiagonal = 0, railDiagonal = 0): boolean {
  const a = straightTrackDirection((roadMask & 15) | roadDiagonal);
  const b = straightTrackDirection((railMask & 15) | railDiagonal);
  return a !== undefined && b !== undefined && a !== b && !(a > 15 && b > 15);
}

/** D1 is a local development experiment, not a save/wire format field. */
export function resolveDiagonalRoads(
  search = typeof location === "undefined" ? "" : location.search,
  dev = import.meta.env.DEV,
): boolean {
  return dev && new URLSearchParams(search).get("diag") === "1";
}

export type TrackKind = "dirt" | "road";

/**
 * Two road layers (rail has its own separate model in rail.ts):
 *   `dirt` = the cheap basic gravel road (player-built "Dirt Road");
 *   `road` = the premium paved road (player-built "Road", and the map's
 *            paved public/town roads — both render as tar).
 *
 * W2 — per-tile track ownership. 0 = no owner; otherwise the builder's id
 * (the game uses the player's index + 1, so the two players are 1 and 2).
 * v1 rule: a tile is owned SOLELY by its builder — there is no implicit
 * sharing, so one player's flood can never run over the other's road. A tile
 * rebuilt by a second player (e.g. paving a Road over a Dirt Road tile)
 * changes hands: the last real builder owns it.
 */
/**
 * VP-01 — `upgraded`: the per-tile UPGRADE PROVENANCE layer, sitting beside the
 * two bit layers. A tile carries `PRESENT` here when the paved Road standing on
 * it REPLACED a Dirt Road, which is the only way a road tile is worth Victory
 * Points (0.25★ each, `victory.ts`).
 *
 * The two bit layers alone cannot answer that question: paving clears the dirt
 * (`buildTile` keeps a tile single-tier), so afterwards "was this tile once
 * gravel?" is unrecorded. It has to be recorded, because a paved Road laid on
 * virgin ground is NOT worth a point — the victory rule is "improve what you
 * already built". Making it a fourth layer of the tile model rather than a
 * ledger some caller maintains is what makes it survive every build path: the
 * human drag, the rival's `executeCandidate`, the demo and a rejoined guest's
 * snapshot all go through `buildTile`/`demolishTile`, so no caller can forget
 * to update it.
 *
 * Public ground never scores: `seedTownRoads`/`seedPublicRoads` pave tiles that
 * carry no dirt, so they never gain the bit — and the scoreboard filters on the
 * tile's owner as well, so a public tile could not be claimed even if it did.
 */
export interface Track {
  /** Basic gravel roads (player-built). */
  dirt: Uint8Array;
  /** Premium paved roads — player Roads AND the map's public/town roads. */
  road: Uint8Array;
  /** 0 = unowned, else the builder's id (see above). */
  owner: Uint8Array;
  /** VP-01: `PRESENT` where the paved Road here replaced a Dirt Road. */
  upgraded: Uint8Array;
  /**
   * ROADS-2 (#393): the paved layer's TIER per tile — 0 Road (the default),
   * 1 Street, 2 Highway. Meaningful only where `road` is present; cleared with
   * the pavement. Optional so hand-built test tracks and old saves (all Road)
   * keep working; `roadTierAt` reads a missing array as all Road.
   */
  tier?: Uint8Array;
  /** TRAFFIC-02: monotonically increments on every road mutation, so ambient
   *  traffic can cache adjacency by revision without rescanning the whole map
   *  every render frame. */
  revision: number;
  /** Local DEV flag; deliberately not serialized. Missing means OFF. */
  diagonalRoads?: boolean;
}

export const createTrack = (diagonalRoads = resolveDiagonalRoads()): Track => ({
  diagonalRoads: import.meta.env.DEV && diagonalRoads,
  dirt: new Uint8Array(MAP_W * MAP_H),
  road: new Uint8Array(MAP_W * MAP_H),
  owner: new Uint8Array(MAP_W * MAP_H),
  upgraded: new Uint8Array(MAP_W * MAP_H),
  tier: new Uint8Array(MAP_W * MAP_H),
  revision: 0,
});

// ── ROADS-2 (#393): road tiers ──────────────────────────────────────────────
export const ROAD_TIER = { road: 0, street: 1, highway: 2, ramp: 3 } as const;
export type RoadTierKey = keyof typeof ROAD_TIER;
/** ROADS-3 (#394): an OVERPASS tile - a Highway running along one axis with a
 *  Road/Street crossing OVER it on the other. 4 = highway along x (SE/NW),
 *  5 = highway along y (NE/SW). Stored in the same tier byte. */
export const OVERPASS_X = 4, OVERPASS_Y = 5;
/** #420 wire-compatible tier byte: low 3 bits retain Road/Street/Highway/
 * Ramp; bits 3/4 mark a ROAD deck over rail along x/y. Old bytes are level.
 * Saves and deltas already carry the whole byte. Demolition clears it. */
export const ROAD_RAIL_DECK_X = 8, ROAD_RAIL_DECK_Y = 16;
export const roadRailDeckAxis = (tier: number): "x" | "y" | null =>
  tier & ROAD_RAIL_DECK_X ? "x" : tier & ROAD_RAIL_DECK_Y ? "y" : null;
export type RoadTier = (typeof ROAD_TIER)[RoadTierKey] | typeof OVERPASS_X | typeof OVERPASS_Y;
export const ROAD_TIER_KEYS: readonly RoadTierKey[] = ["road", "street", "highway", "ramp"];

/** ROADS-3 (#394): a paved tile's link class - Highway, Ramp, Overpass (with
 *  its highway axis) or Normal (Road, Street, and all gravel). */
type LinkClass = "H" | "R" | "OX" | "OY" | "N";
function linkClass(t: Track, x: number, y: number): LinkClass {
  const i = tIdx(x, y);
  if ((t.road[i] & PRESENT) === 0) return "N";
  switch ((t.tier?.[i] ?? 0) & 7) {
    case 2: return "H";
    case 3: return "R";
    case OVERPASS_X: return "OX";
    case OVERPASS_Y: return "OY";
    default: return "N";
  }
}
const axisOfDir = (d: number): "x" | "y" => (DIR[d][0] !== 0 ? "x" : "y");
/**
 * ROADS-3 (#394): may a tile of class `a` link to its neighbour of class `b`
 * across direction `d`? Highways meet the network only through Ramps; an
 * Overpass links along its highway axis to highway-class tiles and not at all
 * across it (the crossing road passes OVER - see `overpassJump`).
 */
function classesLink(a: LinkClass, b: LinkClass, d: number): boolean {
  // Overpasses never gain a diagonal arm (nor a diagonal jump).
  if (DIR[d][0] !== 0 && DIR[d][1] !== 0
    && (a === "OX" || a === "OY" || b === "OX" || b === "OY")) return false;
  const ax = axisOfDir(d);
  if (a === "OX" || a === "OY") {
    if ((a === "OX" ? "x" : "y") !== ax) return false;
    return b === "H" || b === "R" || b === a;
  }
  if (b === "OX" || b === "OY") return classesLink(b, a, d);
  if (a === "H" && b === "N") return false;
  if (a === "N" && b === "H") return false;
  return true;
}
/** D5 planner's tier gate, including unbuilt (ordinary-road) endpoints. */
export function roadClassesConnect(t: Track, ax: number, ay: number, bx: number, by: number): boolean {
  const d = (ax !== bx && ay !== by ? DIAGONAL_DIRS : DIRS).find((d) => ax + DIR[d][0] === bx && ay + DIR[d][1] === by);
  if (d === undefined) return false;
  for (const [x, y] of [[ax, ay], [bx, by]]) {
    const axis = roadRailDeckAxis(t.tier?.[tIdx(x, y)] ?? 0);
    if (axis && (d > 15 || axisOfDir(d) !== axis)) return false;
  }
  return classesLink(linkClass(t, ax, ay), linkClass(t, bx, by), d);
}

/**
 * ROADS-3 (#394): the tile a road jumps to when it crosses an overpass from
 * (x,y) in direction `d`: the overpass must carry its highway ACROSS `d`, and
 * the tile beyond must be ordinary road. Null otherwise. Used by the economy's
 * component flood and by `roadPath`, so the crossing is straight-through only
 * - nothing turns onto the highway at an overpass.
 */
export function overpassJump(t: Track, x: number, y: number, d: number, owner?: number): [number, number] | null {
  const [dx, dy] = DIR[d];
  const ox = x + dx, oy = y + dy, bx = x + 2 * dx, by = y + 2 * dy;
  if (!inMapT(ox, oy) || !inMapT(bx, by)) return null;
  const deckAxis = roadRailDeckAxis(t.tier?.[tIdx(ox, oy)] ?? 0);
  if (deckAxis && owner !== undefined && !trackOpenTo(t, owner, ox, oy)) return null;
  if (deckAxis && d < 16 && axisOfDir(d) === deckAxis && mergedPresent(t, ox, oy)
    && mergedPresent(t, x, y) && mergedPresent(t, bx, by)
    && roadClassesConnect(t, x, y, ox, oy) && roadClassesConnect(t, ox, oy, bx, by)) return [bx, by];
  const oc = linkClass(t, ox, oy);
  if (oc !== "OX" && oc !== "OY") return null;
  if ((oc === "OX" ? "x" : "y") === axisOfDir(d)) return null;
  if (!mergedPresent(t, bx, by)) return null;
  const here = linkClass(t, x, y), there = linkClass(t, bx, by);
  if (here !== "N" && here !== "R") return null;
  if (there !== "N" && there !== "R") return null;
  return [bx, by];
}

/** The paved tier at a tile (Road when the track predates tiers). */
export const roadTierAt = (t: Track, tx: number, ty: number): RoadTier =>
  ((t.tier?.[tIdx(tx, ty)] ?? 0) & 7) as RoadTier;

/** Stamp a paved tile's tier (no-op off the map or without pavement). */
export function setRoadTier(t: Track, tx: number, ty: number, tier: RoadTier): void {
  if (!inMapT(tx, ty)) return;
  const i = tIdx(tx, ty);
  if (!t.tier) t.tier = new Uint8Array(MAP_W * MAP_H);
  const packed = tier | (t.tier[i] & (ROAD_RAIL_DECK_X | ROAD_RAIL_DECK_Y));
  if ((t.road[i] & PRESENT) === 0 || t.tier[i] === packed) return;
  t.tier[i] = packed;
  dirtyTiles.mark(i);
  // ROADS-3 (#394): links depend on the tier (highway access rules), so the
  // tile and its neighbours re-autotile on both layers.
  const changed = autotileAroundBoth(t, "road", tx, ty);
  if (t.diagonalRoads) dirtyTiles.markAll(changed.tiles);
  t.revision++;
}

// ── dirty-tile journal (MP-04) ────────────────────────────────────────────
/**
 * Which tile indices changed since the last publish. The host drains this on
 * every publish tick and sends current values at exactly those indices
 * (`src/net/delta.ts`) — no 20,736-tile scan at 6 Hz (§5).
 *
 * Fed at the two choke points `buildTile`/`demolishTile`, which already know
 * their touched set (`AutotileResult.tiles`: the tile plus its neighbours on
 * both layers). Everything funnels through them — human drags (`commitDrag`
 * is a `buildTile` loop), the rival AI, the demo, seeding — so no mutation
 * path can forget to mark; the no-op paths return `null` and mark nothing.
 * (The ticket names `construction.ts`, but that module is costs-only — this
 * is the seam where the bytes actually change.)
 *
 * Lifecycle:
 *   - delta publish: `buildPublish` drains the set (indices are sent, then
 *     forgotten — a drained tile only reappears if it changes again);
 *   - snapshot publish (join/resync): the full state supersedes everything,
 *     so `clear()` right after sending;
 *   - seeding marks thousands of tiles — also superseded by the initial
 *     snapshot, so clear after it;
 *   - the guest never publishes: `applyTrackDelta`/`applySnapshot` write the
 *     layers directly and never mark, so a guest's journal stays empty;
 *   - bulk loads (`.set` in `applySnapshot`/savegames) bypass the journal —
 *     after loading a save the host must snapshot+clear (MP-05 owns that).
 *
 * One sim per page ⇒ one process-wide journal is correct. `drain()` sorts so
 * published deltas are deterministic.
 */
export class DirtyTiles {
  private readonly set = new Set<number>();

  /** How many indices are journalled (the publish path caps this). */
  get size(): number {
    return this.set.size;
  }

  has(i: number): boolean {
    return this.set.has(i);
  }

  mark(i: number): void {
    this.set.add(i);
  }

  markAll(indices: Iterable<number>): void {
    for (const i of indices) this.set.add(i);
  }

  clear(): void {
    this.set.clear();
  }

  /** Take all journalled indices, sorted ascending, and empty the journal. */
  drain(): number[] {
    const out = [...this.set].sort((a, b) => a - b);
    this.set.clear();
    return out;
  }
}

/** The process-wide journal — marked by build/demolish, drained on publish. */
export const dirtyTiles = new DirtyTiles();

/**
 * PP-10: stamp the towns' seed-generated ring roads into a fresh track.
 *
 * RV-03: town roads are PUBLIC RULES — they are every player's to drive on,
 * exactly like the inter-town highways (PP-13), so a Depot parked beside a
 * town's ring road is serviced and may route over the settlement's streets.
 * They are stamped with `PUBLIC_OWNER` (the same id PP-13 gives the highways),
 * so every owner-scoped flood — `playerNetwork`, `buildComponents`,
 * `isServiced`, `trackOwnedBy`, `trackOpenTo` — already treats them as shared
 * network ground without any new rule. The two kinds of map road differ only
 * in `grid.occupancy`: a town road is stamped `TOWN_OCC` (a player can never
 * build on, or pave over, the town), while a highway is free land a player may
 * extend across. Driving is shared; building on the settlement is not.
 *
 * They ride the snapshot's track bytes like any other track, so a rejoined
 * guest renders them without regenerating anything (E10).
 */
export function seedTownRoads(t: Track, grid: Grid): void {
  for (const town of grid.towns) {
    for (const [tx, ty] of town.roads) {
      buildTile(t, "road", tx, ty, PUBLIC_OWNER);
    }
  }
}

/**
 * PP-13/RV-03: the owner id the map's PUBLIC ROADS carry.
 *
 * Players are 1 and 2 (player index + 1) and a town's own furniture used to be
 * 0, so 3 is free and unambiguous. Public roads are the seed-generated
 * highways between the towns (`grid.publicRoads`) AND — since RV-03 — the seed
 * towns' own ring roads: unlike town furniture they are NOT neutral —
 * `trackOpenTo` lets every player's network run over them, which is what
 * "roads players can use" means here. (`seedTownRoads` stamps the town rings
 * with this same id; the only remaining difference is `grid.occupancy`, where
 * a town road is TOWN_OCC and a highway is not.)
 */
export const PUBLIC_OWNER = 3;

/**
 * PP-13: stamp the inter-town highways onto a fresh track.
 *
 * Call this AFTER `seedTownRoads`: a highway tile a town already paves is
 * skipped, so the settlement keeps its own ring road and the highway simply
 * meets it. Everything is built with owner `PUBLIC_OWNER` (the same id RV-03
 * gives a town's ring road), so the owner-scoped floods treat both as shared
 * network ground — and a player's own line is still distinguishable, which is
 * what keeps a public road demolish-proof (`game.ts` only tears down track
 * whose owner is the player clicking).
 *
 * Like the town roads, these ride the snapshot's track bytes to a rejoined
 * guest, so no client has to regenerate them (E10).
 */
export function seedPublicRoads(t: Track, grid: Grid): void {
  for (const [tx, ty] of grid.publicRoads ?? []) {
    if (hasTrack(t, "road", tx, ty)) continue;      // a town road already paves it
    buildTile(t, "road", tx, ty, PUBLIC_OWNER);
  }
}

export const tIdx = (tx: number, ty: number) => ty * MAP_W + tx;
export const inMapT = (tx: number, ty: number) =>
  tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H;

export const layerOf = (t: Track, kind: TrackKind) => (kind === "road" ? t.road : t.dirt);

/** Sprite key for a mask. `road_0000` is a lone stub with no connections. */
export const spriteKey = (kind: TrackKind, bits: number) =>
  `${kind}_${(bits & 0b1111).toString(2).padStart(4, "0")}`;

// ── OpenTTD RoadBits interop (Y4 guard) ──────────────────────────────────
// This project numbers directions NE=1, SE=2, SW=4, NW=8. OpenTTD's RoadBits
// order is the reverse: NW=1, SW=2, SE=4, NE=8. The declared OpenGFX road
// piece set and OpenTTD's `GetRoadSpriteOffset` selection table are keyed by
// OpenTTD RoadBits — index them with this project's mask directly and every
// curve/corner points 90° off (the original G1-style bug resurfacing).
//
// Today the 16 road/rail masks are generated from the declared straight
// half-piece (road 1332 / rail 1012) and mirrored by *this* project's own bit
// order, so they are already self-consistent. These two helpers make the
// conversion explicit and are exhaustively unit-tested across all 16 values so
// an OpenTTD-indexed piece set can never be wired up identity-mapped by
// mistake. OTTD bit value of each direction, in OpenTTD's numbering:
//   NE = 8, SE = 4, SW = 2, NW = 1.
export const OTTD_ROADBIT: Record<number, number> = {
  [NE]: 8,  // our NE (bit 1) → OpenTTD NE = 8
  [SE]: 4,  // our SE (bit 2) → OpenTTD SE = 4
  [SW]: 2,  // our SW (bit 4) → OpenTTD SW = 2
  [NW]: 1,  // our NW (bit 8) → OpenTTD NW = 1
};
export const OTTD_BIT_TO_DIR: Record<number, number> = {
  8: NE, 4: SE, 2: SW, 1: NW,
};

/** Map this project's RoadBits mask (0..15) to OpenTTD RoadBits (NW=1 SW=2 SE=4 NE=8). */
export const toOpenttdRoadBits = (bits: number): number => {
  let out = 0;
  for (const d of DIRS) if (bits & d) out |= OTTD_ROADBIT[d];
  return out & 0b1111;
};

/** Map an OpenTTD RoadBits mask back to this project's numbering (NE=1 SE=2 SW=4 NW=8). */
export const fromOpenttdRoadBits = (ottdBits: number): number => {
  let out = 0;
  let m = ottdBits & 0b1111;
  while (m) {
    const bit = m & -m;
    out |= OTTD_BIT_TO_DIR[bit];
    m ^= bit;
  }
  return out;
};

// ── presence + legality ───────────────────────────────────────────────────
// Presence is tracked in a separate bit so a lone tile (mask 0) still counts
// as built. Bit 4 (0b10000) = "this tile has track of this kind".
export const PRESENT = 16;

export const hasTrack = (t: Track, kind: TrackKind, tx: number, ty: number): boolean =>
  inMapT(tx, ty) && (layerOf(t, kind)[tIdx(tx, ty)] & PRESENT) !== 0;

/** Direction bits only (what the renderer draws with). */
export const bitsAt = (t: Track, kind: TrackKind, tx: number, ty: number): number =>
  inMapT(tx, ty) ? layerOf(t, kind)[tIdx(tx, ty)] & 0b1111 : 0;

/**
 * Does (tx,ty) carry track of EITHER tier? A tile carries at most one tier
 * (paving replaces gravel), but the merged test is what the union mask and
 * the merged floods need: gravel and tar are one continuous road surface, so
 * presence on either layer is presence on the road.
 */
export const mergedPresent = (t: Track, tx: number, ty: number): boolean =>
  inMapT(tx, ty)
  && ((layerOf(t, "dirt")[tIdx(tx, ty)] | layerOf(t, "road")[tIdx(tx, ty)]) & PRESENT) !== 0;

/**
 * VP-01: is the paved Road at (tx,ty) one that REPLACED a Dirt Road? That and
 * only that is worth 0.25★ to whoever owns the tile (`victory.ts`). Reads the
 * provenance layer `buildTile` stamps and `demolishTile` clears.
 */
export const isUpgradedRoad = (t: Track, tx: number, ty: number): boolean =>
  inMapT(tx, ty)
  && (t.road[tIdx(tx, ty)] & PRESENT) !== 0
  && (t.upgraded[tIdx(tx, ty)] & PRESENT) !== 0;

/**
 * Does a plan of `kind` need to build anything at (tx,ty)? A dirt plan can ride
 * a paved tile (tar carries traffic at least as well as gravel, and a dirt
 * drag over pavement is a documented no-op), so BOTH count as already there.
 * A paved plan over gravel does NOT: that tile still has to be paid for — it
 * is the in-place upgrade, `UPGRADE_COST` and the 0.25★.
 *
 * `stepCost` discounts these tiles for the rival (its own trunk is already
 * carrying what the plan wants), and `tileCost` already charges 0 for them, so
 * the AI's route cost, its purse and its money all agree on the same set.
 */
export const tileAlreadyCarries = (t: Track, kind: TrackKind, tx: number, ty: number): boolean =>
  hasTrack(t, kind, tx, ty) || (kind === "dirt" && hasTrack(t, "road", tx, ty));

/**
 * Direction bits of whatever tier (tx,ty) carries. Since a tile never holds
 * both tiers, this is the single mask of the surface there — the graph the
 * merged floods and the transition sprite selection walk on.
 */
export const mergedBitsAt = (t: Track, tx: number, ty: number): number =>
  inMapT(tx, ty)
  ? (layerOf(t, "dirt")[tIdx(tx, ty)] | layerOf(t, "road")[tIdx(tx, ty)]) & 0b1111
  : 0;

/**
 * E14: the ONE place that knows why a build is refused. `canBuildOn` is this
 * function's boolean projection, so a test hook, a debug dump and a refusal
 * toast can never disagree with the rule that actually gates the build — the
 * corridor picker in `tests/e2e/corridor-picker.ts` filters tiles through it
 * instead of re-deriving water/occupancy constants from the outside.
 *
 * Returns null when `kind` may be laid at (tx,ty) (within `network`, when one
 * is given), else the reason tag: "out-of-bounds" | "water" | "occupied" |
 * "field" | "rail" | "bridge-junction" | "too-steep" | "rough" | "not-adjacent".
 *
 * `track` (optional) is the layer itself, and it buys the ONE rule the tile
 * alone cannot answer: R2 (#266) — a tile that would hang a side connection on
 * a standing bridge deck is refused (`"bridge-junction"`), because a bridge is
 * straight and stations, spurs and junctions may never stand on it. Callers
 * that pass no track (a read-only probe, a synthetic grid) keep the pre-#266
 * answer exactly.
 *
 * `from` (optional) is the tile the drag CAME FROM, and it buys E4 (#268)'s
 * slope rule: a road may climb at most one level per tile, so the step
 * `from → (tx,ty)` is refused (`"too-steep"`) when it climbs further. A caller
 * that passes no `from` — a one-tile probe, a hover, a building footprint —
 * keeps the pre-#268 answer, exactly like the other optional rules; the drag
 * preview, the rival's A* and the plan validators all pass it.
 */
export function buildRefusal(
  grid: Grid, kind: TrackKind, tx: number, ty: number, network?: Set<number>,
  crossing?: "x" | "y", track?: Track, from?: readonly [number, number],
): string | null {
  if (!inMapT(tx, ty)) return "out-of-bounds";
  const i = tIdx(tx, ty);
  const deckAxis = roadRailDeckAxis(track?.tier?.[i] ?? 0);
  if (deckAxis && ((crossing && crossing !== deckAxis)
    || (from && (deckAxis === "x" ? from[1] !== ty : from[0] !== tx)))) return "road-tier";
  const terrain = grid.terrain[i];
  if (terrain === WATER) return "water";
  // Industry footprints and town tiles (TOWN_OCC) block building outright —
  // checked before the terrain kind, so a town road on rough ground reports
  // "occupied" (the permanent blocker) rather than "rough".
  if (grid.occupancy[i] >= 0 || grid.occupancy[i] === TOWN_OCC) return "occupied";
  // RES-FIELDS: a wheat field or tree block stands here until demolished.
  if (grid.occupancy[i] === FIELD_OCC) return "field";
  // Playtest (2026-09) / #298: the railway, the Depots, and plants / town
  // buildings are built things. A road never runs along a rail line or over a
  // platform, a Depot lot, a processing plant or a town building; it may only
  // CROSS a straight rail at a right angle (`crossing` is the axis the road
  // runs along through this tile — only a drag knows it). The owner's own
  // plant is stepped over earlier, by `previewDrag`'s `structures` skip
  // (PP-15) — this refusal is what stops the OTHER seat paving the floor.
  const built = grid.builtAt?.(tx, ty) ?? null;
  // R2 (#266): a bridge deck is reported by `builtAt` like any other built
  // thing, so nothing is built on one. (A deck's own tile is WATER, and the
  // terrain test above answers "water" for it long before this — the deck is in
  // the set for the belt-and-braces case, a `builtAt` a game or a test
  // supplies.)
  // R3 (#270): a dam's footprint is standing ground — its water tile already
  // answers "water" above, and this is what protects its BANK tile, the dry
  // land the structure leans on.
  if (built === "platform" || built === "depot" || built === "plant" || built === "bridge" || built === "dam") {
    return "occupied";
  }
  if (built === "rail") return "rail";
  if (built === "rail-x" && crossing !== "y") return "rail";
  if (built === "rail-y" && crossing !== "x") return "rail";
  // R2 (#266): a bridge is straight. A tile ORTHOGONALLY beside a bridge deck
  // would join it (the merged autotile connects any two tiles carrying track),
  // and the deck would grow a third arm — a junction on a bridge. Refused
  // here, so the drag stops at the bank and the toast can say why.
  if (track && sideJoinAt(
    tx, ty,
    (x, y) => bridgeDeckAt(grid, x, y, (b, c) => mergedPresent(track, b, c)),
    (x, y) => mergedBitsAt(track, x, y),
  )) return "bridge-junction";
  // E4 (#268): the slope rule — the step the drag walked, plus every neighbour
  // the autotiler would join this tile to (a flank step the drag never walks).
  // Both are no-ops on a flat map.
  const steep = roadStepRefusal(grid, from, [tx, ty])
    ?? (track ? roadJoinSlopeRefusal(grid, tx, ty, (x, y) => mergedPresent(track, x, y)) : null);
  if (steep) return steep;
  // The premium paved Road additionally needs flat ground (TRANSPORT.onRough);
  // the basic Dirt Road builds on rough.
  if (terrain === ROUGH && !TRANSPORT[kind].onRough) return "rough";
  if (track?.diagonalRoads && from && isRoadDiagonal(...from, tx, ty)) {
    const refusal = roadDiagonalRefusal(grid, track, ...from, tx, ty);
    if (refusal) return refusal;
  }
  if (network) {
    if (network.has(i)) return null;
    let adj = false;
    for (const d of DIRS) {
      const nx = tx + DIR[d][0], ny = ty + DIR[d][1];
      if (inMapT(nx, ny) && network.has(tIdx(nx, ny))) { adj = true; break; }
    }
    if (!adj && track?.diagonalRoads) {
      adj = DIAGONAL_DIRS.some((d) => {
        const nx = tx + DIR[d][0], ny = ty + DIR[d][1];
        return inMapT(nx, ny) && network.has(tIdx(nx, ny))
          && roadDiagonalRefusal(grid, track, nx, ny, tx, ty) === null;
      });
    }
    if (!adj) return "not-adjacent";
  }
  return null;
}

/**
 * Can `kind` be built on this tile? See `buildRefusal` for the rule.
 */
export function canBuildOn(
  grid: Grid, kind: TrackKind, tx: number, ty: number, network?: Set<number>,
  crossing?: "x" | "y", track?: Track, from?: readonly [number, number],
): boolean {
  return buildRefusal(grid, kind, tx, ty, network, crossing, track, from) === null;
}

/**
 * The axis a drag runs along THROUGH tile `i` of `path` — both of its steps
 * on the same axis — or undefined for a bend or an end. Only a straight pass
 * may cross a rail line.
 */
function passAxis(path: [number, number][], i: number): "x" | "y" | undefined {
  const a = path[i - 1], b = path[i], c = path[i + 1];
  if (!a || !c) return undefined;
  if (isRoadDiagonal(...a, ...b) || isRoadDiagonal(...b, ...c)) return undefined;
  const ax1 = a[0] !== b[0] ? "x" : "y", ax2 = c[0] !== b[0] ? "x" : "y";
  return ax1 === ax2 ? ax1 : undefined;
}

/** Who owns the track at (tx,ty)? 0 = no track owner. */
export const ownerAt = (t: Track, tx: number, ty: number): number =>
  inMapT(tx, ty) ? t.owner[tIdx(tx, ty)] : 0;

/**
 * W2: the owner-scoped presence test. A tile belongs to `owner`'s network
 * only when it carries track AND its owner layer says `owner`. 0 is the
 * "no owner" identity, so an owner-0 flood only crosses owner-0 tiles —
 * two real players (1 and 2) can never see each other's road.
 *
 * PP-13: this is the STRICT test ("whose road is this?"). For "may this
 * player's network run over the tile?" use `trackOpenTo`, which also admits
 * the map's public highways.
 */
export const trackOwnedBy = (t: Track, owner: number, tx: number, ty: number): boolean =>
  inMapT(tx, ty) && t.owner[tIdx(tx, ty)] === owner
  && (hasTrack(t, "road", tx, ty) || hasTrack(t, "dirt", tx, ty));

/** Is (tx,ty) one of the map's public highway tiles? */
export const isPublicRoad = (t: Track, tx: number, ty: number): boolean =>
  inMapT(tx, ty) && t.owner[tIdx(tx, ty)] === PUBLIC_OWNER
  && (hasTrack(t, "road", tx, ty) || hasTrack(t, "dirt", tx, ty));

/**
 * PP-13/RV-03: may `owner`'s network run over this tile?
 *
 * A tile carries `owner`'s traffic when it holds track and either
 *   (a) `owner` built it — the W2 rule, unchanged — or
 *   (b) it is one of the map's PUBLIC roads: the seed-generated highways
 *       between the towns AND the towns' own ring roads, which belong to
 *       nobody and are everybody's to drive on. That is the whole feature:
 *       hook a Depot or a Factory onto a highway (or a town's ring road) and
 *       the rest of the shared network is yours to route over, including the
 *       stretches the rival is also using.
 *
 * Two things this deliberately does NOT do:
 *   - it never lets one player cross the OTHER player's track (W2 stands);
 *   - it never changes the owner-0 answer. 0 is the neutral identity nobody
 *     builds with (players are ≥1, public roads are PUBLIC_OWNER), so
 *     `trackOpenTo(t, 0, …)` stays exactly `trackOwnedBy(t, 0, …)`. Only a
 *     REAL owner (a player, id ≥ 1) may drive on the public roads.
 */
export const trackOpenTo = (t: Track, owner: number, tx: number, ty: number): boolean =>
  trackOwnedBy(t, owner, tx, ty) || (owner !== 0 && isPublicRoad(t, tx, ty));

/**
 * PP-15: every tile a plant's graphic stands on. The building is ONE sprite
 * drawn over the whole `FACTORY_FOOTPRINT` block (its anchor is that block's
 * south corner, so the art's edge is the block's edge — not the origin tile's),
 * and `drawOrigin` measures the footprint from the origin towards +x/+y. A
 * Depot is 1×1, so its origin tile IS its footprint.
 */
export function plantFootprintTiles(
  tx: number, ty: number, rot = 0,
  footprint: readonly [number, number] = FACTORY_FOOTPRINT,
): [number, number][] {
  const [fw, fh] = rotatedSpan(footprint[0], footprint[1], rot);
  const out: [number, number][] = [];
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) out.push([tx + x, ty + y]);
  return out;
}

/**
 * The tiles the players' BUILDINGS stand on (every plant footprint tile, every
 * Depot tile), keyed by tile index. Two things read this, and they are the two
 * halves of one idea — a building's own ground is part of its owner's network,
 * and it is not a road to pay for:
 *
 *   • `playerNetwork` seeds from it, so a drag may START on the building and,
 *     more importantly, lay its first tile on ANY tile touching the graphic's
 *     edge (PP-15: before this the anchor was the origin tile alone, so the
 *     only way in was the back corner of the art — "build the road into some
 *     weird spot inside");
 *   • `previewDrag` skips it, so those tiles are never charged and never
 *     built: the L-path may run under the building on its way out, but the
 *     building's own ground carries no gravel.
 */
export function structureTiles(
  factories: { ownerId: number; tx: number; ty: number; rot?: number }[],
  harvesters: { ownerId: number; tx: number; ty: number }[],
  owner: number,
  // F4 (#275): the map's Factory span — the shapes option's long footprint
  // where the grid carries one, the legacy square otherwise.
  footprint: readonly [number, number] = FACTORY_FOOTPRINT,
): Set<number> {
  const out = new Set<number>();
  for (const f of factories) {
    if (f.ownerId !== owner) continue;
    for (const [x, y] of plantFootprintTiles(f.tx, f.ty, (f as any).rot ?? 0, footprint)) {
      if (inMapT(x, y)) out.add(tIdx(x, y));
    }
  }
  // A truck Depot is a 2×2 lot (`DEPOT_SIZE` in depot.ts — inlined here to
  // keep track.ts free of an import cycle).
  for (const h of harvesters) {
    if (h.ownerId !== owner) continue;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      if (inMapT(h.tx + dx, h.ty + dy)) out.add(tIdx(h.tx + dx, h.ty + dy));
    }
  }
  return out;
}

export function playerNetwork(
  track: Track,
  owner: number,
  factories: { ownerId: number; tx: number; ty: number; rot?: number }[],
  harvesters: { ownerId: number; tx: number; ty: number }[],
  // F4 (#275): the map's Factory span, as in `structureTiles`.
  footprint: readonly [number, number] = FACTORY_FOOTPRINT,
): Set<number> {
  const seen = new Set<number>();
  const stack: number[] = [];
  const seed = (tx: number, ty: number) => {
    if (!inMapT(tx, ty)) return;
    const i = tIdx(tx, ty);
    if (seen.has(i)) return;
    seen.add(i);
    stack.push(i);
  };
  // PP-15: a plant seeds its WHOLE footprint, not its origin tile. The
  // building is one sprite over the whole block, so every edge of that block is
  // a side the owner may plug a road into — and the flood that decides what a
  // drag may extend has to agree, or the front of the graphic would be illegal
  // ground while the back corner was not.
  for (const f of factories) {
    if (f.ownerId !== owner) continue;
    for (const [x, y] of plantFootprintTiles(f.tx, f.ty, (f as any).rot ?? 0, footprint)) seed(x, y);
  }
  // …and a truck Depot seeds its whole 2×2 lot, for the same reason.
  for (const h of harvesters) {
    if (h.ownerId !== owner) continue;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) seed(h.tx + dx, h.ty + dy);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % MAP_W, y = (i / MAP_W) | 0;
    for (const d of DIRS) {
      const nx = x + DIR[d][0], ny = y + DIR[d][1];
      if (!inMapT(nx, ny)) continue;
      if (track.diagonalRoads && mergedPresent(track, x, y)
        && (!(mergedBitsAt(track, x, y) & d) || !(mergedBitsAt(track, nx, ny) & OPPOSITE[d]))) continue;
      const ni = tIdx(nx, ny);
      if (seen.has(ni)) continue;
      // W2: flood only over track THIS owner built — never the rival's.
      // PP-13: …or over the map's public highways, which are everybody's.
      if (trackOpenTo(track, owner, nx, ny)) {
        seen.add(ni);
        stack.push(ni);
      }
    }
    if (track.diagonalRoads && mergedPresent(track, x, y)) {
      const neighbours = roadDiagNeighbours(track, x, y);
      for (const d of DIRS) {
        const jump = overpassJump(track, x, y, d, owner);
        if (jump) neighbours.push(jump);
      }
      for (const [nx, ny] of neighbours) {
        const ni = tIdx(nx, ny);
        if (seen.has(ni) || !trackOpenTo(track, owner, nx, ny)) continue;
        seen.add(ni);
        stack.push(ni);
      }
    }
  }
  return seen;
}

// ── D1: explicit diagonal links (D2 will wire these into drag commits) ──────
export const isRoadDiagonal = (ax: number, ay: number, bx: number, by: number): boolean =>
  Math.abs(ax - bx) === 1 && Math.abs(ay - by) === 1;

function roadDiagSlot(ax: number, ay: number, bx: number, by: number) {
  const [x, y, otherY] = ax < bx ? [ax, ay, by] : [bx, by, ay];
  return { x, y, i: tIdx(x, y), bit: otherY < y ? ROAD_DE : ROAD_DS };
}

function storedRoadDiagonal(t: Track, ax: number, ay: number, bx: number, by: number): boolean {
  if (!inMapT(ax, ay) || !inMapT(bx, by) || !isRoadDiagonal(ax, ay, bx, by)) return false;
  const { i, bit } = roadDiagSlot(ax, ay, bx, by);
  return ((t.dirt[i] | t.road[i]) & bit) !== 0;
}

/** Read in either direction, across either layer; ownership is checked by the
 * caller with trackOpenTo, just as for axis links. Re-check tiers on reads so
 * changing a tile to Highway/Overpass cannot leave a forbidden live link. */
export function roadDiagLinked(t: Track, ax: number, ay: number, bx: number, by: number): boolean {
  if (!t.diagonalRoads || !storedRoadDiagonal(t, ax, ay, bx, by)) return false;
  if (!mergedPresent(t, ax, ay) || !mergedPresent(t, bx, by)) return false;
  return roadClassesConnect(t, ax, ay, bx, by);
}

export function roadDiagNeighbours(t: Track, x: number, y: number, kind?: TrackKind): [number, number][] {
  if (!t.diagonalRoads || (kind && !hasTrack(t, kind, x, y))) return [];
  const out: [number, number][] = [];
  for (const d of DIAGONAL_DIRS) {
    const nx = x + DIR[d][0], ny = y + DIR[d][1];
    if (kind && !hasTrack(t, kind, nx, ny)) continue;
    if (roadDiagLinked(t, x, y, nx, ny)) out.push([nx, ny]);
  }
  return out;
}

/** D4: a road's complete physical mask for crossing rules and cached paint.
 * Uses the same local flag, endpoint presence and tier gates as road routing. */
export function roadConnectionMask(t: Track, x: number, y: number): number {
  if (!inMapT(x, y)) return 0;
  let mask = (t.road[tIdx(x, y)] | t.dirt[tIdx(x, y)]) & 15;
  if (t.diagonalRoads) for (const d of DIAGONAL_DIRS) {
    if (roadDiagLinked(t, x, y, x + DIR[d][0], y + DIR[d][1])) mask |= d;
  }
  return mask;
}

/** Terrain/buildings block the two flanks. Rough land alone is not a wall. */
function diagonalBlocked(grid: Grid, x: number, y: number): boolean {
  if (!inMapT(x, y)) return true;
  const i = tIdx(x, y);
  return grid.terrain[i] === WATER || grid.occupancy[i] >= 0
    || grid.occupancy[i] === TOWN_OCC || grid.occupancy[i] === FIELD_OCC
    || grid.builtAt?.(x, y) != null;
}

/** Step rule also used by canBuildOn(from). Endpoints need not be built yet;
 * unbuilt pavement has the normal link class. D2 previews should validate
 * their projected tiers before committing links. Bridges remain axis-only. */
export function roadDiagonalRefusal(
  grid: Grid, t: Track, ax: number, ay: number, bx: number, by: number,
): string | null {
  if (!t.diagonalRoads) return "diagonals-disabled";
  if (!inMapT(ax, ay) || !inMapT(bx, by)) return "out-of-bounds";
  if (!isRoadDiagonal(ax, ay, bx, by)) return "not-diagonal";
  if (diagonalBlocked(grid, ax, ay) || diagonalBlocked(grid, bx, by)) return "occupied";
  if (diagonalBlocked(grid, ax, by) && diagonalBlocked(grid, bx, ay)) return "corner-cut";
  // The other pair of corners of this unit square must not already be linked,
  // even on the other layer or owned by another player.
  if (storedRoadDiagonal(t, ax, by, bx, ay)) return "diagonal-crossing";
  if (!roadClassesConnect(t, ax, ay, bx, by)) return "road-tier";
  if ((linkClass(t, ax, ay) === "H" || linkClass(t, bx, by) === "H")
    && tileHeight(grid, ax, ay) !== tileHeight(grid, bx, by)) return "too-steep";
  return roadStepRefusal(grid, [ax, ay], [bx, by]);
}

/** Join two already paid-for tiles. A diagonal costs the same per TILE as an
 * axis run (tileCost / tierTileCost), never an extra charge for the link.
 * No auto-diagonal neighbours: adjacency alone must not invent X crossings.
 * Drag commits use the same mutation after validating projected endpoint tiers. */
export function buildRoadDiagonal(
  grid: Grid, t: Track, ax: number, ay: number, bx: number, by: number, owner = 0,
): AutotileResult | null {
  if (!trackOpenTo(t, owner, ax, ay) || !trackOpenTo(t, owner, bx, by)) return null;
  if (roadDiagonalRefusal(grid, t, ax, ay, bx, by)) return null;
  return stampRoadDiagonal(t, ax, ay, bx, by);
}

/** Internal mutation: callers either validate the link or consume a validated
 * preview. No grid dependency is needed at commit time. */
function stampRoadDiagonal(t: Track, ax: number, ay: number, bx: number, by: number): AutotileResult | null {
  const { i, bit } = roadDiagSlot(ax, ay, bx, by);
  const layer = (t.road[i] & PRESENT) ? t.road : t.dirt;
  if (layer[i] & bit) return null;
  layer[i] |= bit;
  const tiles = [tIdx(ax, ay), tIdx(bx, by)];
  dirtyTiles.markAll(tiles);
  t.revision++;
  const chunks = [...new Set([[ax, ay], [bx, by]].map(([x, y]) =>
    ((y / CHUNK) | 0) * chunksX + ((x / CHUNK) | 0)))];
  return { tiles, chunks };
}

// ── autotiling ────────────────────────────────────────────────────────────
/**
 * Recompute one tile's direction mask from its four neighbours. A bit is set
 * when the neighbour carries ANY tier of track — the mask is the physical
 * road surface and stays mutually consistent across both tiers, which is what
 * the merged floods rely on. The bit is stored in this tile's own tier layer
 * only; a tile carrying the other tier is not PRESENT here and recomputes to
 * zero.
 */
export function recomputeMask(t: Track, kind: TrackKind, tx: number, ty: number): number {
  const layer = layerOf(t, kind);
  const i = tIdx(tx, ty);
  if ((layer[i] & PRESENT) === 0) { layer[i] = 0; return 0; }
  let bits = 0;
  for (const d of DIRS) {
    const [dx, dy] = DIR[d];
    if (!mergedPresent(t, tx + dx, ty + dy)) continue;
    // ROADS-3 (#394): highway access rules (Road/Street/gravel never join a
    // Highway directly - only through a Ramp; an Overpass links along its
    // highway only). Maps without tiers are all class "N": unchanged.
    if (!roadClassesConnect(t, tx, ty, tx + dx, ty + dy)) continue;
    bits |= d;
  }
  layer[i] = PRESENT | bits | (layer[i] & ROAD_DIAG);
  return bits;
}

export interface AutotileResult {
  /** Tile indices whose mask was recomputed: the tile plus its 4 neighbours. */
  tiles: number[];
  /** Chunk indices to invalidate (1–4 for a single placement). */
  chunks: number[];
}

/**
 * Incremental autotile after a change at (tx,ty): recompute that tile and its
 * four neighbours only, and report the chunks to invalidate.
 */
export function autotileAround(t: Track, kind: TrackKind, tx: number, ty: number): AutotileResult {
  const tiles: number[] = [];
  const chunks = new Set<number>();
  const touch = (x: number, y: number) => {
    if (!inMapT(x, y)) return;
    recomputeMask(t, kind, x, y);
    tiles.push(tIdx(x, y));
    chunks.add(((y / CHUNK) | 0) * chunksX + ((x / CHUNK) | 0));
  };
  touch(tx, ty);
  for (const d of DIRS) touch(tx + DIR[d][0], ty + DIR[d][1]);
  for (const d of DIAGONAL_DIRS) {
    const nx = tx + DIR[d][0], ny = ty + DIR[d][1];
    if (storedRoadDiagonal(t, tx, ty, nx, ny)) touch(nx, ny);
  }
  return { tiles, chunks: [...chunks] };
}

// ── build / demolish ──────────────────────────────────────────────────────
/**
 * Masks are the MERGED road surface (see `recomputeMask`): laying or removing
 * a tile can change the direction bits of same-tier neighbours AND of
 * neighbours carrying the other tier (a gravel tile beside a paved tile faces
 * it). So after a change the tile is re-autotiled on both layers — but only
 * when the other tier is actually present in the 4-neighbourhood, so a build
 * on virgin ground still touches exactly 5 tiles.
 */
function autotileAroundBoth(
  t: Track, kind: TrackKind, tx: number, ty: number,
): AutotileResult {
  const r1 = autotileAround(t, kind, tx, ty);
  const other: TrackKind = kind === "road" ? "dirt" : "road";
  const otherNearby = DIRS.some((d) => hasTrack(t, other, tx + DIR[d][0], ty + DIR[d][1]));
  if (!otherNearby) return r1;
  const r2 = autotileAround(t, other, tx, ty);
  return {
    tiles: [...new Set([...r1.tiles, ...r2.tiles])],
    chunks: [...new Set([...r1.chunks, ...r2.chunks])],
  };
}
/**
 * W2: `owner` is stamped on the tile so the network flood knows whose road
 * this is. Passing 0 (the default) is a neutral placement — it does NOT
 * strip ownership, so a second build on an owned tile keeps the existing
 * owner unless the new builder is also a real owner (last real builder wins).
 *
 * PP-13, the one exception to "last real builder wins": a PUBLIC highway tile
 * keeps owner `PUBLIC_OWNER` no matter who builds on it. Both players may drag
 * a road straight over a highway — it is already paved, so `tileCost` charges
 * nothing and the route connects — and without this the drag would silently
 * re-stamp every tile it crossed into that player's private network, for free,
 * taking the shared road away from the rival and from the map. Enforcing it
 * here rather than at each call site is deliberate: `commitDrag`, the AI's
 * builder and the demo all reach a public tile, and the invariant should not
 * depend on any of them remembering. The build itself is still applied (the
 * track bit is idempotent, and the autotile result is returned as usual), so
 * a route through a highway still connects and still renders.
 *
 * The two tiers never stack on one tile: paving a `road` over a `dirt` tile
 * REPLACES the dirt (the upgraded tile is a plain paved Road — no overlay),
 * and a `dirt` drag over an already-`road` tile is a no-op (a paved road is
 * strictly better; you never downgrade it by dragging gravel across it).
 * Keeping a tile single-layer is what lets the renderer drop the old
 * road+rail "crossing" sprite entirely.
 */
export function buildTile(
  t: Track, kind: TrackKind, tx: number, ty: number, owner: number = 0,
): AutotileResult | null {
  if (!inMapT(tx, ty)) return null;
  const i = tIdx(tx, ty);
  const dirt = t.dirt, road = t.road;
  if (kind === "road" && (dirt[i] & PRESENT) !== 0) {
    // Paving over a Dirt Road: clear the gravel so the tile becomes road only.
    const diagonals = dirt[i] & ROAD_DIAG;
    dirt[i] = 0;
    layerOf(t, kind)[i] |= PRESENT | diagonals;
    if (owner !== 0 && t.owner[i] !== PUBLIC_OWNER) t.owner[i] = owner;
    // VP-01: this is THE upgrade event the scoreboard pays for. The gravel is
    // gone from the bit layers, so `upgraded` is what keeps "this paved tile
    // used to be a Dirt Road" true after the fact — and `victory.ts` reads
    // nothing else. Public ground never reaches here with dirt under it.
    if (t.owner[i] !== PUBLIC_OWNER) t.upgraded[i] = PRESENT;
    // Recompute around the tile (dirt lost this tile, road gained) on both
    // layers: the surrounding gravel now faces a paved tile instead.
    const paved = autotileAroundBoth(t, "road", tx, ty);
    dirtyTiles.markAll(paved.tiles);
    t.revision++;
    return paved;
  }
  if (kind === "dirt" && (road[i] & PRESENT) !== 0) {
    // Already a paved road here — laying dirt changes nothing (no downgrade).
    return null;
  }
  layerOf(t, kind)[i] |= PRESENT;
  if (owner !== 0 && t.owner[i] !== PUBLIC_OWNER) t.owner[i] = owner;
  const built = autotileAroundBoth(t, kind, tx, ty);
  dirtyTiles.markAll(built.tiles);
  t.revision++;
  return built;
}

/**
 * W2: demolition never touches ownership while any track remains on the tile
 * (the other tier — possibly the rival's — is still standing). When the last
 * layer goes down the tile is unowned again.
 */
export function demolishTile(t: Track, kind: TrackKind, tx: number, ty: number): AutotileResult | null {
  if (!inMapT(tx, ty)) return null;
  const i = tIdx(tx, ty);
  const removed = hasTrack(t, kind, tx, ty);
  const diagonalEnds = DIAGONAL_DIRS.map((d) => [tx + DIR[d][0], ty + DIR[d][1]])
    .filter(([nx, ny]) => removed && storedRoadDiagonal(t, tx, ty, nx, ny));
  layerOf(t, kind)[i] = 0;
  // VP-01: provenance dies with the pavement. Tearing up a paved tile takes
  // its 0.25★ back with it (the scoreboard diffs against this layer), so a
  // point can never be farmed by paving and re-paving the same ground.
  if (kind === "road") { t.upgraded[i] = 0; if (t.tier) t.tier[i] = 0; }
  if (!hasTrack(t, "road", tx, ty) && !hasTrack(t, "dirt", tx, ty)) t.owner[i] = 0;
  // Also re-tile the OTHER layer around the gap: a paved neighbour that was
  // facing this tile (any-tier masks) must stop now that nothing is here.
  const torn = autotileAroundBoth(t, kind, tx, ty);
  // Stored at the lower-x endpoint, including links arriving from the west.
  // Clean saved experimental links even if the current session's flag is OFF.
  if (removed && !mergedPresent(t, tx, ty)) {
    for (const [x, y, bit] of [[tx - 1, ty + 1, ROAD_DE], [tx - 1, ty - 1, ROAD_DS]]) {
      if (!inMapT(x, y)) continue;
      const ni = tIdx(x, y);
      if (!((t.dirt[ni] | t.road[ni]) & bit)) continue;
      t.dirt[ni] &= ~bit;
      t.road[ni] &= ~bit;
      torn.tiles.push(ni);
      torn.chunks.push(((y / CHUNK) | 0) * chunksX + ((x / CHUNK) | 0));
    }
  }
  for (const [x, y] of diagonalEnds) {
    torn.tiles.push(tIdx(x, y));
    torn.chunks.push(((y / CHUNK) | 0) * chunksX + ((x / CHUNK) | 0));
  }
  torn.tiles = [...new Set(torn.tiles)];
  torn.chunks = [...new Set(torn.chunks)];
  dirtyTiles.markAll(torn.tiles);
  t.revision++;
  return torn;
}

// ── costs ─────────────────────────────────────────────────────────────────
export type Purse = Partial<Record<Cargo, number>>;

export const addCost = (a: Purse, b: Purse, times = 1): Purse => {
  const out: Purse = { ...a };
  for (const [k, v] of Object.entries(b) as [Cargo, number][]) {
    out[k] = (out[k] ?? 0) + v * times;
  }
  return out;
};

export const canAfford = (purse: Purse, cost: Purse): boolean =>
  (Object.entries(cost) as [Cargo, number][]).every(([k, v]) => (purse[k] ?? 0) >= v);

/**
 * W9: what the free setup allowance (`FREE_SETUP_TRACK` in `game.ts`) may buy.
 *
 * Option (a) from the ticket — ROAD ONLY. Rail, laid new or upgraded in place
 * over a road, always pays `TRANSPORT.rail.cost` / `UPGRADE_COST`. E8's design
 * note is "wood and stone for roads, no ore — rail is gated behind an ore
 * mine", and before this the allowance ignored the gate: `previewDrag` spent it
 * on ANY tile with a non-empty cost, so the first 12 tiles of a rail drag were
 * free and the connection jumped straight to rail VP (3/tile) and rail
 * throughput (×1.6) with 0 ore in the purse.
 *
 * One rule, one place: `previewDrag` (the human drag), `planCandidates` and
 * `executeCandidate` (the AI, W3's "same cost model as the player") all ask
 * this function, so the two can never disagree about what "free" means.
 *
 * L2 (#216) MVP: under `newLoop` the allowance covers NOTHING on the road
 * tiers. Dirt is free outright (`tileCost` returns {}), so it needs no
 * allowance — and a paved Road still pays full price exactly as before, so
 * the ore gate stands. The count stays DATA on the player record and keeps
 * riding the wire and saves untouched; post-MVP rail work wires it to the
 * paid tiers (rail/paid upgrades) per the L2 spec.
 */
export const freeAllowanceCovers = (kind: TrackKind, newLoop = false): boolean =>
  newLoop ? false : kind === "dirt";

/**
 * Cost of applying `kind` to a single tile:
 *   - already the same kind → free (dragging over your own road never
 *     double-charges)
 *   - a `road` (paved) over an existing `dirt` tile → the upgrade difference
 *     only (UPGRADE_COST); the dirt is replaced, not kept underneath
 *   - a `dirt` over an existing `road` tile → free (a paved road is already
 *     there and is never downgraded)
 *   - otherwise the full transport cost
 *
 * L2 (#216) MVP: under `newLoop` a Dirt Road tile is free on virgin ground
 * too ({}), so the purse — however empty — never blocks expansion by road.
 * The paved tier is unchanged: full price on virgin ground, UPGRADE_COST
 * over gravel. The adjacency rule (build off your own network) is untouched;
 * `BUILD_COSTS.dirt` keeps its old-loop price and the old loop reads it.
 */
/** ROADS-2 (#393): a tier's rank — Street < Road < Highway. */
export const TIER_RANK: Record<RoadTierKey, number> = { street: 0, road: 1, highway: 2, ramp: 1 };
// stored tier 0 Road, 1 Street, 2 Highway, 3 Ramp, 4/5 Overpass (highway)
const RANK_OF_STORED = [1, 0, 2, 1, 2, 2];
/** Per-cargo difference `a − b`, floored at zero (an upgrade pays the gap). */
const costGap = (a: Purse, b: Purse): Purse => {
  const out: Purse = {};
  for (const [k, v] of Object.entries(a) as [Cargo, number][]) {
    const d = v - (b[k] ?? 0);
    if (d > 0) out[k] = d;
  }
  return out;
};
/**
 * ROADS-2 (#393): what one tile of a TIERED paved drag costs. New ground pays
 * the tier; pavement already at this rank or higher pays nothing (and is not
 * downgraded); lower pavement pays the difference; gravel pays the tier.
 */
export function tierTileCost(t: Track, tier: RoadTierKey, tx: number, ty: number): Purse {
  const want = ROAD_TIERS[tier].cost;
  if (hasTrack(t, "road", tx, ty)) {
    const stored = roadTierAt(t, tx, ty);
    // ROADS-3 (#394): a Ramp converts a Road/Street (pays the gap), never a
    // Highway or an overpass (free: the drag passes over it unchanged).
    if (tier === "ramp") {
      if (stored === 3 || stored === 2 || stored === OVERPASS_X || stored === OVERPASS_Y) return {};
      return costGap(want, ROAD_TIERS[stored === 1 ? "street" : "road"].cost);
    }
    const cur = RANK_OF_STORED[stored];
    if (cur >= TIER_RANK[tier]) return {};
    const curKey = ROAD_TIER_KEYS.find((k) => TIER_RANK[k] === cur) ?? "road";
    return costGap(want, ROAD_TIERS[curKey].cost);
  }
  return { ...want };
}

/** ROADS-3 (#394): does (x,y) have track beside it that is not part of `path`? */
export function sideBranch(t: Track, path: [number, number][], x: number, y: number): boolean {
  const on = new Set(path.map(([px, py]) => tIdx(px, py)));
  for (const d of DIRS) {
    const nx = x + DIR[d][0], ny = y + DIR[d][1];
    if (!inMapT(nx, ny) || on.has(tIdx(nx, ny))) continue;
    if (hasTrack(t, "road", nx, ny) || hasTrack(t, "dirt", nx, ny)) return true;
  }
  return roadDiagNeighbours(t, x, y).some(([nx, ny]) => !on.has(tIdx(nx, ny)));
}

/** D5: preserve existing ramps and every axis/explicit-diagonal branch in a
 * rival Highway upgrade. Read the whole plan before changing any tiers. */
export function highwayRouteTiers(t: Track, path: [number, number][]): RoadTier[] {
  const on = new Set(path.map(([x, y]) => tIdx(x, y)));
  return path.map(([x, y]) => {
    const stored = roadTierAt(t, x, y);
    if (stored === ROAD_TIER.ramp || stored === OVERPASS_X || stored === OVERPASS_Y) return stored;
    const branch = DIRS.some((d) => {
      const nx = x + DIR[d][0], ny = y + DIR[d][1];
      return inMapT(nx, ny) && !on.has(tIdx(nx, ny)) && mergedPresent(t, nx, ny);
    }) || roadDiagNeighbours(t, x, y).some(([nx, ny]) => !on.has(tIdx(nx, ny)));
    return branch ? ROAD_TIER.ramp : ROAD_TIER.highway;
  });
}

/** ROADS-3 (#394): what an overpass costs (one crossing tile). */
export const OVERPASS_COST: Purse = { wood: 6, stone: 12, ore: 8 };
const tileAlreadyOverpass = (t: Track, x: number, y: number) => {
  const v = roadTierAt(t, x, y);
  return v === OVERPASS_X || v === OVERPASS_Y;
};
/** A Highway tile (or overpass) being crossed at right angles to its axis. */
function overpassCrossing(t: Track, x: number, y: number, dragAxis: "x" | "y" | undefined): boolean {
  if (!dragAxis || !hasTrack(t, "road", x, y)) return false;
  const v = roadTierAt(t, x, y);
  if (v === OVERPASS_X) return dragAxis === "y";
  if (v === OVERPASS_Y) return dragAxis === "x";
  if (v !== 2) return false;
  const bits = t.road[tIdx(x, y)] & 0b1111;
  const alongX = (bits & (SE | NW)) !== 0, alongY = (bits & (NE | SW)) !== 0;
  if (alongX && !alongY) return dragAxis === "y";
  if (alongY && !alongX) return dragAxis === "x";
  return false;
}

export function tileCost(t: Track, kind: TrackKind, tx: number, ty: number, newLoop = false): Purse {
  if (kind === "dirt" && newLoop) return {};   // L2: free dirt under the new loop
  if (hasTrack(t, kind, tx, ty)) return {};
  if (kind === "dirt" && hasTrack(t, "road", tx, ty)) return {};  // already paved
  if (kind === "road" && hasTrack(t, "dirt", tx, ty)) return { ...UPGRADE_COST };
  return { ...TRANSPORT[kind].cost };
}

// ── drag-to-build ─────────────────────────────────────────────────────────
/**
 * L-shaped Manhattan path from a to b: all of one axis, then all of the other.
 * `xFirst` flips which axis leads (the modifier-key / two-finger-tap toggle).
 * No A* — that is reserved for the AI (E7), where nobody is surprised by it.
 */
export function lPath(
  ax: number, ay: number, bx: number, by: number, xFirst = true,
): [number, number][] {
  const out: [number, number][] = [];
  const stepTo = (from: number, to: number) => (to > from ? 1 : -1);
  let x = ax, y = ay;
  out.push([x, y]);
  if (xFirst) {
    while (x !== bx) { x += stepTo(x, bx); out.push([x, y]); }
    while (y !== by) { y += stepTo(y, by); out.push([x, y]); }
  } else {
    while (y !== by) { y += stepTo(y, by); out.push([x, y]); }
    while (x !== bx) { x += stepTo(x, bx); out.push([x, y]); }
  }
  return out;
}

/**
 * The octilinear drag: a straight run and a diagonal run joined at ONE 45°
 * bend, so a single drag never draws a corner a train cannot take.
 * `straightFirst` picks which half leads (the old L-drag's toggle).
 */
export function octPath(
  ax: number, ay: number, bx: number, by: number, straightFirst = true,
): [number, number][] {
  const dx = bx - ax, dy = by - ay;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const n = Math.min(Math.abs(dx), Math.abs(dy));
  const rest = Math.max(Math.abs(dx), Math.abs(dy)) - n;
  const st: [number, number] = Math.abs(dx) >= Math.abs(dy) ? [sx, 0] : [0, sy];
  const out: [number, number][] = [[ax, ay]];
  let x = ax, y = ay;
  const walk = (k: number, s: [number, number]) => {
    for (let i = 0; i < k; i++) { x += s[0]; y += s[1]; out.push([x, y]); }
  };
  if (straightFirst) { walk(rest, st); walk(n, [sx, sy]); } else { walk(n, [sx, sy]); walk(rest, st); }
  return out;
}

export interface DragPreview {
  /** Tiles that will actually be built, in order. */
  tiles: [number, number][];
  /**
   * VP-01: how many of `tiles` are in-place DIRT-TO-PAVED upgrades — the
   * tiles that will earn 0.25★ each. The modebar previews the score the drag
   * is about to buy (`previewVp` in `victory.ts`), so the number the player
   * reads is the number the scoreboard pays.
   */
  upgrades: number;
  /**
   * W1: what the purse will be charged — the sum of per-tile costs for the
   * tiles NOT covered by the free allowance. This is the ONLY number the
   * commit spends, so what you see is what you're charged.
   */
  cost: Purse;
  /** W1: how many of `tiles` the free allowance covers (commit debits this). */
  free: number;
  /**
   * R2 (#266): how many of `tiles` are BRIDGE DECKS — tiles this drag builds
   * on river water. The overlay reads it for the cost label, and it is the
   * number a test asserts to tell a crossing apart from a drag that merely ran
   * up to the bank.
   */
  bridges: number;
  /** Tiles previewed but unaffordable — drawn red, not built. */
  unaffordable: [number, number][];
  /**
   * #298: tiles the drag ran into that an obstacle refuses (a plant, a town
   * building, water, …). Drawn red, not built. The owner's own plant is absent
   * — PP-15 steps over it before this list is collected.
   */
  blocked: [number, number][];
  /** True when an obstacle cut the path short. */
  truncated: boolean;
  /** D2: reason for the first blocked tile (not an HTML string). */
  why?: string | null;
  /** #420: road-deck metadata for the validated, affordable prefix only. */
  railOverpasses?: [number, number, "x" | "y"][];
  /** D2: validated mutations for the affordable prefix, not a second path.
   * Local preview data only; guests send endpoints/order/tier to the host. */
  roadPlan?: {
    tiers: [number, number, RoadTier][];
    links: [number, number, number, number][];
  };
}

/**
 * Compute the drag preview. Obstacles (water, rough for rail, industry
 * footprints) truncate at the last legal tile rather than failing the drag,
 * and the preview stops charging once the purse runs out — the affordable
 * prefix is what gets built.
 *
 * W1: `freeTiles` is the caller's free-track allowance, applied INSIDE the
 * preview: the first `freeTiles` new tiles (tiles that actually cost
 * something) ride free, and `cost` counts only the rest. The commit spends
 * exactly `cost`, so preview and charge can no longer disagree — the class of
 * bug where a drag that "looked fine" charged the purse into the negative.
 *
 * W9: the allowance only covers ROAD (`freeAllowanceCovers`). A rail drag
 * prices every tile from tile one, so with no ore in the purse it previews
 * nothing, spends no allowance, and leaves the setup budget intact for the
 * road the player still has to build.
 *
 * PP-15: `structures` (from `structureTiles`) marks the builder's own building
 * tiles, which the path steps over for free — see the skip in the loop.
 *
 * L2 (#216) MVP: `newLoop` makes dirt free (see `tileCost`) and the setup
 * allowance inapplicable (see `freeAllowanceCovers`), so a dirt drag prices
 * {} with `free: 0` and never truncates on affordability. A paved drag is
 * priced exactly as before.
 *
 * R2 (#266): a drag that crosses a narrow river builds a BRIDGE (`bridges.ts`
 * holds the rule — river water only, ≤ 2 tiles, straight, land at both ends,
 * no junctions). The deck's tiles ride in `tiles` like any others (track on
 * water IS a bridge), are counted in `bridges`, and are charged the per-tile
 * `BUILD_COSTS.bridge`: a deck is a structure, so neither the free setup
 * allowance nor free Dirt Road covers it. `bridges.railAt` lets the caller
 * hand in the railway layer, because a deck is never shared: a road drag never
 * rides an existing rail bridge.
 */
export interface BridgeDragOptions {
  /** Does the OTHER layer (rail) carry track at (x,y)? A deck is never shared. */
  railAt?: (x: number, y: number) => boolean;
  /** Opt in for new player drags; existing level crossings remain readable. */
  gradeSeparated?: boolean;
  railDeckAt?: (x: number, y: number) => boolean;
}

/** Only dry, straight AXIS/AXIS intersections become new grade-separated
 * decks. Mixed diagonal crossings retain D4's level-crossing rules. */
function roadRailOverpass(grid: Grid, kind: TrackKind, path: [number, number][], i: number, options: BridgeDragOptions): "x" | "y" | null {
  if (!options.gradeSeparated || kind !== "road") return null;
  const [x, y] = path[i], axis = passAxis(path, i);
  if (!axis || options.railDeckAt?.(x, y)) return null;
  return grid.builtAt?.(x, y) === (axis === "x" ? "rail-y" : "rail-x") ? axis : null;
}
function flatDeck(grid: Grid, path: [number, number][], i: number): boolean {
  const [x, y] = path[i], h = tileHeight(grid, x, y);
  return [path[i - 1], path[i + 1]].every((p) => p && grid.terrain[tIdx(...p)] !== WATER && tileHeight(grid, ...p) === h);
}
function roadDeckCost(t: Track, x: number, y: number, cost: Purse): Purse {
  return roadRailDeckAxis(t.tier?.[tIdx(x, y)] ?? 0) ? cost : addCost(cost, OVERPASS_COST);
}
function roadDecksIn(grid: Grid, kind: TrackKind, tiles: [number, number][], options: BridgeDragOptions): [number, number, "x" | "y"][] {
  return tiles.flatMap(([x, y], i) => {
    const axis = roadRailOverpass(grid, kind, tiles, i, options);
    return axis ? [[x, y, axis] as [number, number, "x" | "y"]] : [];
  });
}

export function previewDrag(
  grid: Grid, t: Track, kind: TrackKind, purse: Purse,
  ax: number, ay: number, bx: number, by: number, xFirst = true,
  network?: Set<number>, freeTiles = 0, structures?: Set<number>,
  newLoop = false, bridges: BridgeDragOptions = {},
  roadTier: RoadTierKey = "road",
  // ECON-1 (#421): the seat's MONEY balance. When it is a number the drag is
  // priced in money — the running resource bill is converted with
  // `moneyValueOf` (the same table `BUILD_COSTS_MONEY` is derived from) and
  // the affordable prefix is the one the purse of $ can pay for. `null` (the
  // default, and every pure cost test) keeps the pre-money rule: the prefix
  // the RESOURCE purse can pay for.
  moneyBalance: number | null = null,
): DragPreview {
  /** One affordability rule for the whole drag — resources, or money. */
  const affords = (next: Purse): boolean =>
    moneyBalance === null ? canAfford(purse, next) : moneyValueOf(next) <= moneyBalance;
  if (t.diagonalRoads) return previewDiagonalDrag(grid, t, kind, purse,
    ax, ay, bx, by, xFirst, network, freeTiles, structures, newLoop, bridges, roadTier, moneyBalance);
  // ROADS-2 (#393): Street / Highway ride the paved layer at their own price.
  const tiered = kind === "road" && roadTier !== "road";
  const path = lPath(ax, ay, bx, by, xFirst);
  const tiles: [number, number][] = [];
  const unaffordable: [number, number][] = [];
  const blocked: [number, number][] = [];
  let cost: Purse = {};
  let truncated = false;
  let why: string | null = null;
  // VP-01: count of tiles this drag would PAVE over gravel (all of them are
  // `kind === "road"` tiles standing on dirt — `tileCost` returns
  // UPGRADE_COST for exactly that case, so one test drives both numbers).
  let upgrades = 0;
  // R2 (#266): how many of the built tiles are bridge decks (see DragPreview).
  let decks = 0;
  // W9: rail never rides the setup allowance, so for rail there is no
  // allowance to spend and `free` in the result stays 0.
  // L2: under newLoop the allowance covers no road tier at all.
  const allowance = freeAllowanceCovers(kind, newLoop) ? Math.max(0, freeTiles) : 0;
  let freeLeft = allowance;
  const growing = network ? new Set(network) : undefined;
  // R2 (#266): the drag's bridge plan, computed once for the whole gesture —
  // a crossing is a property of the PATH, not of a tile. The drag's own tiles
  // count as track for the flank test (an L that runs back beside the water is
  // a junction), exactly the way rail's `planned` set works.
  const planned = new Set(path.map(([x, y]) => tIdx(x, y)));
  const bridgePlan: BridgePlan = planBridges(
    grid, path,
    (x, y) => inMapT(x, y) && (mergedPresent(t, x, y) || planned.has(tIdx(x, y))),
    (x, y) => inMapT(x, y) && (bridges.railAt?.(x, y) ?? false),
    // ROADS-3 (#394): a Highway bridge may span wider water.
    tiered && roadTier === "highway" ? HIGHWAY_BRIDGE_SPAN : undefined,
  );
  // The obstacle run the drag dies on — the building (or the water) it ran
  // into, not the free tiles beyond it. Painted red by the overlay.
  const noteObstacle = (from: number) => {
    truncated = true;
    for (let j = from; j < path.length; j++) {
      const [bx, by] = path[j];
      if (bridgePlan.runs.has(j)) break;            // a legal crossing: it is not the obstacle
      // E4 (#268): the same `from` the drag's own step test uses, so the
      // painted obstacle is the tile the drag would actually refuse.
      if (canBuildOn(grid, kind, bx, by, growing, passAxis(path, j), t, path[j - 1])) break;
      blocked.push([bx, by]);
    }
  };

  for (let i = 0; i < path.length; i++) {
    const [x, y] = path[i];
    // PP-15 (below): the builder's own building is stepped over — checked
    // first, because a Depot lot (and, #298, a plant) is "built" ground
    // (`Grid.builtAt`). The OTHER seat's plant is not in `structures`, so it
    // falls through to the refusal below and the drag stops.
    if (structures !== undefined && structures.has(tIdx(x, y))) continue;
    // R2 (#266): a deck tile is water, so `canBuildOn` says "water" — the
    // bridge plan is what makes it legal, and it is only legal as part of the
    // crossing it was planned with.
    const deck = bridgePlan.runs.get(i);
    const railDeck = roadRailOverpass(grid, kind, path, i, bridges);
    if (railDeck && (tileAlreadyOverpass(t, x, y) || !flatDeck(grid, path, i))) {
      why = tileAlreadyOverpass(t, x, y) ? "overpass-stack" : "overpass-ground";
      truncated = true; blocked.push([x, y]); break;
    }
    // E4 (#268): the drag knows the tile it came from, so the one-level road
    // rule is enforced on the step — a steeper step truncates the drag exactly
    // like an unaffordable tile does, and the prefix stands.
    if (!canBuildOn(grid, kind, x, y, growing, passAxis(path, i), t, path[i - 1]) && !deck) {
      noteObstacle(i); break;
    }
    // PP-15: a tile the builder's OWN building stands on is stepped over — it
    // is neither built nor charged, and it consumes none of the free allowance.
    // The path may run under the plant to reach the ground beyond (that is a
    // normal drag), but nobody pays to pave their own factory's floor, and the
    // 12 free setup tiles are 12 tiles of ROAD rather than 10 of road plus two
    // of building. The tile stays legal ground for `canBuildOn`, so a drag may
    // also START on the building itself — that is how you join a road to the
    // edge of a plant whose graphic covers the tile you wanted to click.
    if (structures !== undefined && structures.has(tIdx(x, y))) continue;
    // R2 (#266): the deck is a structure and pays its own price — once, on the
    // first crossing. A tile the player's own track already fills (a re-drag
    // over their bridge, or paving the gravel on it) falls through to the
    // ordinary tier cost below, so a bridge is never charged twice.
    if (deck && !tileAlreadyCarries(t, kind, x, y)) {
      const deckCost = { ...BRIDGE_COST };
      const next = addCost(cost, deckCost);
      if (!affords(next)) {
        for (let j = i; j < path.length; j++) {
          const [ux, uy] = path[j];
          if (!bridgePlan.runs.has(j)
            && !canBuildOn(grid, kind, ux, uy, growing, undefined, t, path[j - 1])) { noteObstacle(j); break; }
          unaffordable.push([ux, uy]);
        }
        break;
      }
      cost = next;
      tiles.push([x, y]);
      decks++;
      // A deck consumes none of the free allowance: that buys road.
      growing?.add(tIdx(x, y));
      continue;
    }
    // ROADS-2 (#393): a Highway needs gentle grades — no level change between
    // two consecutive tiles (a deck is the bridge's own ramp, handled above).
    if (tiered && roadTier === "highway" && i > 0
      && tileHeight(grid, x, y) !== tileHeight(grid, path[i - 1][0], path[i - 1][1])) {
      noteObstacle(i); break;
    }
    // ROADS-3 (#394): a Road/Street crossing a Highway at right angles builds
    // an OVERPASS here (straight through, no junction) at OVERPASS_COST.
    const crossing = kind === "road" && (roadTier === "road" || roadTier === "street")
      && overpassCrossing(t, x, y, passAxis(path, i));
    const baseCost = crossing ? (tileAlreadyOverpass(t, x, y) ? {} : { ...OVERPASS_COST })
      : tiered ? tierTileCost(t, roadTier, x, y) : tileCost(t, kind, x, y, newLoop);
    const c = railDeck ? roadDeckCost(t, x, y, baseCost) : baseCost;
    const paves = kind === "road" && hasTrack(t, "dirt", x, y);
    // VP-01: Free tiles are charged nothing; the allowance covers them first.
    // A tile that costs nothing (dragging over your own track) consumes no
    // allowance — free setup tiles are never wasted.
    // W9: for a paved drag `freeLeft` starts at 0, so the allowance branch is
    // dirt-only and a paved tile always reaches the affordability test below.
    if (Object.keys(c).length === 0) {
      tiles.push([x, y]);
      growing?.add(tIdx(x, y));
      continue;
    }
    if (freeLeft > 0) {
      freeLeft--;
      tiles.push([x, y]);
      // VP-01: never an upgrade — the setup allowance buys dirt only
      // (`freeAllowanceCovers`), and only a paved tile over gravel scores.
      growing?.add(tIdx(x, y));
      continue;
    }
    const next = addCost(cost, c);
    if (!affords(next)) {
      for (let j = i; j < path.length; j++) {
        const [ux, uy] = path[j];
        if (!canBuildOn(grid, kind, ux, uy, growing)) { noteObstacle(j); break; }
        unaffordable.push([ux, uy]);
      }
      break;
    }
    cost = next;
    tiles.push([x, y]);
    if (paves) upgrades++;
    growing?.add(tIdx(x, y));
  }
  const last = tiles.at(-1);
  if (last) {
    const n = path.findIndex(([x, y]) => x === last[0] && y === last[1]);
    if (roadRailOverpass(grid, kind, path, n, bridges)) {
      tiles.pop();
      const base = tiered ? tierTileCost(t, roadTier, ...last) : tileCost(t, kind, ...last, newLoop);
      const refund = roadDeckCost(t, ...last, base);
      for (const key of Object.keys(refund) as Cargo[]) { cost[key] = Math.max(0, (cost[key] ?? 0) - (refund[key] ?? 0)); if (!cost[key]) delete cost[key]; }
      if (hasTrack(t, "dirt", ...last)) upgrades--;
      unaffordable.unshift(last);
    }
  }
  return { why, railOverpasses: roadDecksIn(grid, kind, tiles, bridges), tiles, cost, upgrades, free: allowance - freeLeft, bridges: decks, unaffordable, blocked, truncated };
}

/** Static wording only: safe to include in the HUD's cost markup. */
export function roadDragRefusalText(why: string | null | undefined): string {
  const text: Record<string, string> = {
    "overpass-stack": "An overpass already occupies this crossing; move the new deck to another tile.",
    "overpass-ground": "Overpasses need flat, dry approaches on both sides; no slopes or bridge decks.",
    "diagonal-highway": "A diagonal road cannot cross a Highway — cross straight at right angles or join through a Ramp.",
    "road-tier": "Highways join roads only through Ramps; Overpasses stay axis-only.",
    "corner-cut": "A diagonal cannot cut between two blocked corners.",
    "diagonal-crossing": "Two diagonal roads cannot cross in an X.",
    "too-steep": "Too steep — Highways need level ground; roads climb at most one level.",
    "water": "No road here — bridges need a straight crossing with land at both ends.",
    "bridge-junction": "A bridge stays straight — nothing can join its side.",
    "rail": "Cross rail straight at right angles, not diagonally.",
    "occupied": "A building or structure blocks this road.",
    "field": "Clear this field before building a road.",
    "rough": "Paved roads need smoother ground.",
    "not-adjacent": "Extend the road from your network.",
    "out-of-bounds": "The road must stay on the map.",
  };
  return text[why ?? ""] ?? "Can't build there.";
}

/** D2: preview the shared octPath. The OFF path above is deliberately intact.
 * Project only the current prefix onto a PRIVATE track copy, never invoking
 * journalled builders. This makes tier changes visible to D1's step rules
 * without changing the live world, revision, purse or dirty-tile journal.
 * Copies are once per changed gesture, NOT per tile (the UI caches previews).
 */
function previewDiagonalDrag(
  grid: Grid, t: Track, kind: TrackKind, purse: Purse,
  ax: number, ay: number, bx: number, by: number, straightFirst: boolean,
  network: Set<number> | undefined, freeTiles: number, structures: Set<number> | undefined,
  newLoop: boolean, bridges: BridgeDragOptions, roadTier: RoadTierKey,
  moneyBalance: number | null = null,
): DragPreview {
  // ECON-1 (#421): with a money balance, the drag is priced in $.
  const affordsD = (next: Purse): boolean =>
    moneyBalance === null ? canAfford(purse, next) : moneyValueOf(next) <= moneyBalance;
  const path = octPath(ax, ay, bx, by, straightFirst);
  const planned = new Set(path.filter(([x, y]) => !structures?.has(tIdx(x, y))).map(([x, y]) => tIdx(x, y)));
  const bridgePlan = planBridges(grid, path,
    (x, y) => inMapT(x, y) && (mergedPresent(t, x, y) || planned.has(tIdx(x, y))),
    (x, y) => inMapT(x, y) && (bridges.railAt?.(x, y) ?? false),
    kind === "road" && roadTier === "highway" ? HIGHWAY_BRIDGE_SPAN : undefined);
  const projected: Track = { ...t, dirt: t.dirt.slice(), road: t.road.slice(),
    tier: t.tier?.slice() ?? new Uint8Array(t.road.length) };
  const growing = network ? new Set(network) : undefined;
  const allowance = freeAllowanceCovers(kind, newLoop) ? Math.max(0, freeTiles) : 0;
  let freeLeft = allowance, outOfBudget = false;
  const result: DragPreview = { tiles: [], cost: {}, upgrades: 0, free: 0, bridges: 0,
    blocked: [], unaffordable: [], truncated: false, roadPlan: { tiers: [], links: [] } };
  const crossingAt = (i: number) => kind === "road" && (roadTier === "road" || roadTier === "street")
    && overpassCrossing(t, ...path[i], passAxis(path, i));
  const priceAt = (i: number): Purse => {
    const [x, y] = path[i];
    if (structures?.has(tIdx(x, y))) return {};
    if (bridgePlan.runs.has(i) && !tileAlreadyCarries(t, kind, x, y)) return { ...BRIDGE_COST };
    if (crossingAt(i)) return tileAlreadyOverpass(t, x, y) ? {} : { ...OVERPASS_COST };
    const base = kind === "road" && roadTier !== "road" ? tierTileCost(t, roadTier, x, y) : tileCost(t, kind, x, y, newLoop);
    return roadRailOverpass(grid, kind, path, i, bridges) ? roadDeckCost(t, x, y, base) : base;
  };
  const tierAt = (i: number): RoadTier => {
    const [x, y] = path[i], stored = roadTierAt(t, x, y);
    if (crossingAt(i)) return passAxis(path, i) === "x" ? OVERPASS_Y : OVERPASS_X;
    if (roadTier === "road") return hasTrack(t, "road", x, y) ? stored : ROAD_TIER.road;
    if (roadTier === "ramp") return stored === 0 || stored === 1 ? ROAD_TIER.ramp : stored;
    if (hasTrack(t, "road", x, y) && RANK_OF_STORED[stored] >= TIER_RANK[roadTier]) return stored;
    return roadTier === "highway" && sideBranch(t, path, x, y) ? ROAD_TIER.ramp : ROAD_TIER[roadTier];
  };
  for (let i = 0; i < path.length; i++) {
    const [x, y] = path[i], index = tIdx(x, y);
    if (structures?.has(index)) continue; // own floors are neither charged nor linked across
    const prev = path[i - 1], next = path[i + 1];
    const from = prev && !structures?.has(tIdx(...prev)) ? prev : undefined;
    const diagonalIn = !!from && isRoadDiagonal(...from, x, y);
    const diagonalOut = !!next && isRoadDiagonal(x, y, ...next);
    const deck = bridgePlan.runs.get(i);
    const tier = tierAt(i);
    if (inMapT(x, y)) {
      if (kind === "road") {
        projected.road[index] |= PRESENT | (projected.dirt[index] & ROAD_DIAG);
        projected.dirt[index] = 0;
        projected.tier![index] = tier | ((t.tier?.[index] ?? 0) & (ROAD_RAIL_DECK_X | ROAD_RAIL_DECK_Y));
      } else if (!hasTrack(projected, "road", x, y)) projected.dirt[index] |= PRESENT;
    }
    // Plain road cannot enter/cross a highway diagonally (including a bend
    // departing it diagonally). A Ramp/Highway gesture may JOIN diagonally;
    // Overpass endpoint rules are still enforced by D1 on the projected tier.
    const high = linkClass(t, x, y);
    let why: string | null = (high === "H" || high === "OX" || high === "OY")
      && (kind === "dirt" || roadTier === "road" || roadTier === "street")
      && (diagonalIn || diagonalOut || roadDiagNeighbours(t, x, y).length > 0)
      ? "diagonal-highway" : null;
    if (roadRailOverpass(grid, kind, path, i, bridges)) {
      if (tileAlreadyOverpass(t, x, y)) why ??= "overpass-stack";
      else if (!flatDeck(grid, path, i)) why ??= "overpass-ground";
    }
    why ??= buildRefusal(grid, kind, x, y, growing, passAxis(path, i), projected, from);
    // A valid bridge plan alone permits water. Never mask another refusal.
    if (why === "water" && deck) why = null;
    if (!why && kind === "road" && roadTier === "highway" && from
      && !deck && !bridgePlan.runs.has(i - 1)
      && tileHeight(grid, x, y) !== tileHeight(grid, ...from)) why = "too-steep";
    if (why) {
      result.why = why; result.truncated = true; result.blocked.push([x, y]); break;
    }
    // Keep the projected axis masks current for bridge/slope/side-join rules.
    for (const k of ["road", "dirt"] as const) {
      recomputeMask(projected, k, x, y);
      for (const d of DIRS) {
        const nx = x + DIR[d][0], ny = y + DIR[d][1];
        if (inMapT(nx, ny)) recomputeMask(projected, k, nx, ny);
      }
    }
    if (diagonalIn) {
      const { i: slot, bit } = roadDiagSlot(...from!, x, y);
      (projected.road[slot] & PRESENT ? projected.road : projected.dirt)[slot] |= bit;
    }
    // A paid crossing must reach its far bank; do not strand an affordable
    // half-deck if the next deck/bank costs more than the remaining purse.
    if (!outOfBudget && deck && i === deck.start) {
      let crossingCost = result.cost;
      for (let j = deck.start; j <= deck.end + 1; j++) {
        if (j === deck.end + 1 && freeLeft > 0) continue; // dirt-only free bank
        crossingCost = addCost(crossingCost, priceAt(j));
      }
      if (!affordsD(crossingCost)) outOfBudget = true;
    }
    if (roadRailOverpass(grid, kind, path, i, bridges)
      && !affordsD(addCost(addCost(result.cost, priceAt(i)), priceAt(i + 1)))) outOfBudget = true;
    const cost = priceAt(i);
    const charged = Object.keys(cost).length > 0;
    const free = charged && freeLeft > 0 && !deck;
    const total = free ? result.cost : addCost(result.cost, cost);
    if (!affordsD(total)) outOfBudget = true;
    growing?.add(index);
    if (outOfBudget) { result.unaffordable.push([x, y]); continue; }
    result.tiles.push([x, y]); result.cost = total;
    if (free) { freeLeft--; result.free++; }
    if (deck && !tileAlreadyCarries(t, kind, x, y)) result.bridges++;
    if (kind === "road") {
      result.roadPlan!.tiers.push([x, y, tier]);
      if (hasTrack(t, "dirt", x, y)) result.upgrades++;
    }
    if (diagonalIn) result.roadPlan!.links.push([...from!, x, y]);
  }
  // An obstacle after a paid crossing can shorten its affordable prefix too.
  // Never turn that orphaned deck into an unpriced/unmarked level crossing.
  const last = result.tiles.at(-1);
  if (last) {
    const n = path.findIndex(([x, y]) => x === last[0] && y === last[1]);
    if (roadRailOverpass(grid, kind, path, n, bridges)) {
      result.tiles.pop(); result.roadPlan!.tiers.pop();
      const refund = priceAt(n);
      for (const key of Object.keys(refund) as Cargo[]) { result.cost[key] = Math.max(0, (result.cost[key] ?? 0) - (refund[key] ?? 0)); if (!result.cost[key]) delete result.cost[key]; }
      if (hasTrack(t, "dirt", ...last)) result.upgrades--;
      result.unaffordable.unshift(last);
    }
  }
  result.railOverpasses = roadDecksIn(grid, kind, result.tiles, bridges);
  return result;
}

export interface CommitResult {
  built: [number, number][];
  cost: Purse;
  chunks: number[];
}

/**
 * Commit a previewed drag, charging only for the tiles actually placed.
 * W1: the cost is the preview's cost (per-tile `tileCost` model, free
 * allowance already subtracted) — never a recomputation. Committing builds
 * exactly `preview.tiles` and nothing more.
 */
export function commitDrag(
  t: Track, kind: TrackKind, preview: DragPreview, owner = 0, roadTier: RoadTierKey = "road",
): CommitResult {
  const chunks = new Set<number>();
  for (const [x, y] of preview.tiles) {
    // W2: the builder's track-owner id is stamped on every tile laid — a
    // drag built by player 1 is player 1's network, full stop.
    const wasPaved = hasTrack(t, "road", x, y);
    const r = buildTile(t, kind, x, y, owner);
    // A newly built Street is narrower than Road, not an upgrade of the
    // temporary Road byte buildTile just created. Never downgrade old roads.
    if (kind === "road" && roadTier === "street" && !wasPaved && r) setRoadTier(t, x, y, ROAD_TIER.street);
    if (r) for (const c of r.chunks) chunks.add(c);
  }
  for (const [x, y, axis] of preview.railOverpasses ?? []) {
    const i = tIdx(x, y);
    t.tier ??= new Uint8Array(t.road.length);
    t.tier[i] = roadTierAt(t, x, y) | (axis === "x" ? ROAD_RAIL_DECK_X : ROAD_RAIL_DECK_Y);
    dirtyTiles.markAll(autotileAroundBoth(t, "road", x, y).tiles);
    chunks.add(((y / CHUNK) | 0) * chunksX + ((x / CHUNK) | 0));
    t.revision++;
  }
  if (t.diagonalRoads && preview.roadPlan) {
    for (const [x, y, tier] of preview.roadPlan.tiers) {
      setRoadTier(t, x, y, tier);
      chunks.add(((y / CHUNK) | 0) * chunksX + ((x / CHUNK) | 0));
    }
    for (const [ax, ay, bx, by] of preview.roadPlan.links) {
      // Do not let a preview link through another owner's already-paved tile
      // when a dirt build there is a no-op. The public-road rule still applies.
      if (!trackOpenTo(t, owner, ax, ay) || !trackOpenTo(t, owner, bx, by)) continue;
      const linked = stampRoadDiagonal(t, ax, ay, bx, by);
      if (linked) for (const c of linked.chunks) chunks.add(c);
    }
    return { built: preview.tiles, cost: preview.cost, chunks: [...chunks] };
  }
  // ROADS-3 (#394): a Road/Street drag that crosses a Highway at right angles
  // turns that tile into an OVERPASS (the highway keeps its axis).
  if (kind === "road" && (roadTier === "road" || roadTier === "street")) {
    for (let k = 0; k < preview.tiles.length; k++) {
      const [x, y] = preview.tiles[k];
      const ax = passAxis(preview.tiles, k);
      if (!overpassCrossing(t, x, y, ax)) continue;
      setRoadTier(t, x, y, ax === "x" ? OVERPASS_Y : OVERPASS_X);
      chunks.add(((y / CHUNK) | 0) * chunksX + ((x / CHUNK) | 0));
    }
  }
  // ROADS-2 (#393): stamp the tier on every paved tile of the drag whose rank
  // is below it (never downgrade). Plain Road drags leave tiers untouched.
  if (kind === "road" && roadTier !== "road") {
    const want = ROAD_TIER[roadTier];
    for (const [x, y] of preview.tiles) {
      if (!hasTrack(t, "road", x, y)) continue;
      const stored = roadTierAt(t, x, y);
      if (roadTier === "ramp") {
        // a Ramp converts Road/Street only
        if (stored === 0 || stored === 1) { setRoadTier(t, x, y, want); chunks.add(((y / CHUNK) | 0) * chunksX + ((x / CHUNK) | 0)); }
        continue;
      }
      if (RANK_OF_STORED[stored] >= TIER_RANK[roadTier]) continue;
      // ROADS-3 (#394): a Highway laid THROUGH a junction keeps the side road
      // attached — that tile becomes a Ramp (Highway meets roads only there).
      if (roadTier === "highway" && sideBranch(t, preview.tiles, x, y)) {
        setRoadTier(t, x, y, ROAD_TIER.ramp);
        chunks.add(((y / CHUNK) | 0) * chunksX + ((x / CHUNK) | 0));
        continue;
      }
      setRoadTier(t, x, y, want);
      chunks.add(((y / CHUNK) | 0) * chunksX + ((x / CHUNK) | 0));
    }
  }
  return { built: preview.tiles, cost: preview.cost, chunks: [...chunks] };
}

// ── connectivity (the base E6 will build connection scoring on) ───────────
/**
 * Flood fill over direction masks, RESTRICTED to one tier: a tile moves to a
 * neighbour only when the neighbour also carries track of `kind` (it is
 * PRESENT on that layer) and BOTH set the facing bit. Because the masks now
 * cross tiers, a tile's mask can point at the other tier — the flood does
 * not follow it. This is the single-tier view (used for tier-purist tests);
 * the merged surface is what `mergedConnectedTiles` and the economy walk.
 */
export function connectedTiles(
  t: Track, kind: TrackKind, tx: number, ty: number,
): Set<number> {
  const seen = new Set<number>();
  if (!hasTrack(t, kind, tx, ty)) return seen;
  const stack: [number, number][] = [[tx, ty]];
  seen.add(tIdx(tx, ty));
  while (stack.length) {
    const [x, y] = stack.pop()!;
    const bits = bitsAt(t, kind, x, y);
    for (const d of DIRS) {
      if (!(bits & d)) continue;
      const nx = x + DIR[d][0], ny = y + DIR[d][1];
      if (!inMapT(nx, ny)) continue;
      // mutual: the neighbour must face back (on this tier)
      if (!(bitsAt(t, kind, nx, ny) & OPPOSITE[d])) continue;
      const ni = tIdx(nx, ny);
      if (seen.has(ni)) continue;
      seen.add(ni);
      stack.push([nx, ny]);
    }
    for (const [nx, ny] of roadDiagNeighbours(t, x, y, kind)) {
      const ni = tIdx(nx, ny);
      if (seen.has(ni)) continue;
      seen.add(ni);
      stack.push([nx, ny]);
    }
  }
  return seen;
}

export const areConnected = (
  t: Track, kind: TrackKind, ax: number, ay: number, bx: number, by: number,
): boolean => connectedTiles(t, kind, ax, ay).has(tIdx(bx, by));

/**
 * Flood fill over the MERGED surface: gravel and tar are one continuous
 * road, so the flood crosses whichever tier a tile carries, exactly as the
 * economy's owner-scoped flood and the truck route do. Tiles connect only
 * when both set the facing bit.
 */
export function mergedConnectedTiles(
  t: Track, tx: number, ty: number,
): Set<number> {
  const seen = new Set<number>();
  if (!mergedPresent(t, tx, ty)) return seen;
  const stack: [number, number][] = [[tx, ty]];
  seen.add(tIdx(tx, ty));
  while (stack.length) {
    const [x, y] = stack.pop()!;
    const bits = mergedBitsAt(t, x, y);
    for (const d of DIRS) {
      if (!(bits & d)) continue;
      const nx = x + DIR[d][0], ny = y + DIR[d][1];
      if (!inMapT(nx, ny)) continue;
      if (!(mergedBitsAt(t, nx, ny) & OPPOSITE[d])) continue;   // mutual
      const ni = tIdx(nx, ny);
      if (seen.has(ni)) continue;
      seen.add(ni);
      stack.push([nx, ny]);
    }
    for (const [nx, ny] of roadDiagNeighbours(t, x, y, undefined)) {
      const ni = tIdx(nx, ny);
      if (seen.has(ni)) continue;
      seen.add(ni);
      stack.push([nx, ny]);
    }
  }
  return seen;
}

export const mergedAreConnected = (
  t: Track, ax: number, ay: number, bx: number, by: number,
): boolean => mergedConnectedTiles(t, ax, ay).has(tIdx(bx, by));

/**
 * The layer as the renderer consumes it. The PRESENT bit is deliberately kept:
 * `buildDrawList` treats any non-zero cell as "track here" and masks the low
 * nibble for the sprite name, so a lone stub (directions 0000) still draws.
 */
export const drawBits = (t: Track, kind: TrackKind): Uint8Array => layerOf(t, kind);

/** #420: a complete, axis-only diamond. Four ramp tiles connect the two
 * side roads to the highway; the central road jumps over it without a turn.
 * The plan is read-only and all-or-nothing, shared by hover, host and click. */
export interface InterchangePlan {
  tiles: [number, number, RoadTier][];
  cost: Purse;
  why: string | null;
}
export function planInterchange(grid: Grid, t: Track, owner: number, x: number, y: number, purse: Purse, moneyBalance: number | null = null): InterchangePlan {
  const plan: InterchangePlan = { tiles: [], cost: {}, why: null };
  const fail = (why: string) => { plan.why = why; return plan; };
  if (!inMapT(x, y) || !hasTrack(t, "road", x, y)) return fail("Choose a straight Highway tile.");
  const tier = roadTierAt(t, x, y), mask = roadConnectionMask(t, x, y);
  const axis = tier === OVERPASS_X ? "x" : tier === OVERPASS_Y ? "y"
    : tier === ROAD_TIER.highway && mask === (SE | NW) ? "x"
    : tier === ROAD_TIER.highway && mask === (NE | SW) ? "y" : null;
  if (!axis) return fail("Choose a straight Highway, not a bend or junction.");
  const at = (u: number, v: number): [number, number] => axis === "x" ? [x + u, y + v] : [x + v, y + u];
  const put = (u: number, v: number, tier: RoadTier) => { const [tx, ty] = at(u, v); plan.tiles.push([tx, ty, tier]); };
  for (let v = -3; v <= 3; v++) put(0, v, v === 0 ? (axis === "x" ? OVERPASS_X : OVERPASS_Y) : ROAD_TIER.road);
  for (const u of [-2, 2]) for (const sign of [-1, 1]) {
    put(u, sign, ROAD_TIER.ramp);
    put(u, 2 * sign, ROAD_TIER.road);
    put(u / 2, 2 * sign, ROAD_TIER.road);
  }
  const level = tileHeight(grid, x, y);
  for (let u = -3; u <= 3; u++) {
    const [tx, ty] = at(u, 0);
    if (!inMapT(tx, ty) || !hasTrack(t, "road", tx, ty)
      || ![ROAD_TIER.highway, axis === "x" ? OVERPASS_X : OVERPASS_Y].includes(roadTierAt(t, tx, ty) as 2 | 4 | 5)
      || (roadConnectionMask(t, tx, ty) & ~(axis === "x" ? SE | NW : NE | SW))
      || !trackOpenTo(t, owner, tx, ty) || tileHeight(grid, tx, ty) !== level)
      return fail("The diamond needs seven straight, level Highway tiles and access to both sides.");
  }
  for (const [tx, ty, want] of plan.tiles) {
    if (!inMapT(tx, ty)) return fail("The diamond does not fit inside the map.");
    if (grid.terrain[tIdx(tx, ty)] === WATER || tileHeight(grid, tx, ty) !== level)
      return fail("The diamond needs flat, dry ground; bridges and slopes cannot carry its ramps.");
    if (grid.occupancy[tIdx(tx, ty)] !== -1 || grid.builtAt?.(tx, ty))
      return fail("Clear the diamond footprint: a building, railway, town, field or dam is in the way.");
    if (mergedPresent(t, tx, ty) && !trackOpenTo(t, owner, tx, ty)) return fail("The diamond cannot replace another player's roads.");
    if (roadRailDeckAxis(t.tier?.[tIdx(tx, ty)] ?? 0)) return fail("The diamond cannot overlap a road/rail overpass.");
    if (grid.terrain[tIdx(tx, ty)] === ROUGH) return fail("The diamond needs smooth ground for its paved roads.");
    if (roadDiagNeighbours(t, tx, ty).length) return fail("The diamond needs axis-only roads; remove diagonal links in its footprint.");
    if (tx === x && ty === y) {
      if (!tileAlreadyOverpass(t, tx, ty)) plan.cost = addCost(plan.cost, OVERPASS_COST);
      continue;
    }
    if (hasTrack(t, "road", tx, ty) && roadTierAt(t, tx, ty) > ROAD_TIER.ramp)
      return fail("The diamond cannot overlap another overpass.");
    if (hasTrack(t, "road", tx, ty) && roadTierAt(t, tx, ty) === ROAD_TIER.highway)
      return fail("The diamond's side roads cannot replace another Highway.");
    plan.cost = addCost(plan.cost, want === ROAD_TIER.ramp ? tierTileCost(t, "ramp", tx, ty) : tileCost(t, "road", tx, ty));
  }
  if (moneyBalance !== null) {
    if (moneyValueOf(plan.cost) > moneyBalance) return fail("Not enough money for the whole interchange.");
  } else if (!canAfford(purse, plan.cost)) return fail("Not enough resources for the whole interchange.");
  return plan;
}
export function buildInterchange(grid: Grid, t: Track, owner: number, x: number, y: number, purse: Purse, moneyBalance: number | null = null): InterchangePlan {
  const plan = planInterchange(grid, t, owner, x, y, purse, moneyBalance);
  if (plan.why) return plan;
  for (const [tx, ty, want] of plan.tiles) {
    if (!hasTrack(t, "road", tx, ty)) buildTile(t, "road", tx, ty, owner);
    if (want !== ROAD_TIER.road || roadTierAt(t, tx, ty) === ROAD_TIER.road) setRoadTier(t, tx, ty, want);
  }
  return plan;
}
