// ══════════════════════════════════════════════════════════════════════════
// RAIL-01/02/04 (#175, #176, #178) — the railway: a SEPARATE, owner-scoped
// layer beside the road tiers, its platforms and depots, and the trains that
// run between them.
//
// The epic (#142) asked for one thing above all: railways must not disturb the
// road economy. So this module owns its own bytes (`Rail.tile`, `Rail.owner`),
// its own costs (`RAIL_COSTS`), its own placement rules and its own revision
// counter, and it never renames or reuses a road layer, a road bit or a road
// provenance byte. Everything here is plain data plus pure functions, so the
// rules are unit-testable without a browser, a canvas or a game loop — the same
// shape `economy.ts`, `victory.ts` and `snapshot.ts` already have.
//
//   Layer      one Uint8Array of 4-bit direction masks (the OpenTTD RoadBits
//              model `track.ts` uses) plus an owner byte per tile. A tile
//              carries `RAIL_PRESENT` so a lone stub still has a rail tile on
//              it. Rail is cheap (1 Stone) and scores nothing.
//   Platform   2×3 or 3×2, rotatable by quarter turns. One 3-tile lane with a
//              port at each end — the lane is INTERNAL TRACK, included in the
//              platform's price — beside a platform strip. Exactly 1 VP, on
//              construction; revoked when it is demolished.
//   Depot      2×2, rotatable, one declared rail exit. The train's home.
//   Line       two distinct stops: a platform anchored to an INDUSTRY and a
//              platform anchored to one of the owner's PLANTS.
//   Train      locomotive + one wagon: `stored → departing → dwelling →
//              moving …`, a 1.5 s platform dwell, twice the dirt lorry's speed,
//              its position carried as CUMULATIVE PATH DISTANCE so the wagon
//              follows the locomotive around corners.
//
// Two v1 rules are deliberately conservative, and they live here rather than in
// a caller:
//
//   ONE ACTIVE TRAIN PER CONNECTED OWNER RAIL COMPONENT. There is no signalling
//   in v1, so two trains sharing a component could collide. Enforced on
//   assignment AND on a build that would merge two components with a train each.
//
//   RAIL AT A CROSSING ONLY ON A STRAIGHT ROAD, TRANSVERSE. A level crossing
//   preserves the road's bits, owner and upgrade provenance exactly; the rail
//   gets its own layer beside it. No curves, no junctions, and no transfer
//   between the road graph and the rail graph at a crossing.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W } from "../game/config";
import { BUILD_COSTS, CARGOES, INDUSTRY_BY_KEY, SLOPES, VICTORY, type Cargo } from "./config";
import {
  NE, SE, SW, NW, DIRS, DIR, OPPOSITE, PRESENT, tIdx, inMapT, plantFootprintTiles,
  OVERPASS_COST, OVERPASS_X, OVERPASS_Y, roadTierAt, roadRailDeckAxis, addCost, mergedPresent, octPath, crossingMasksOk, roadConnectionMask, roadDiagLinked,
  DIAGONAL_DIRS, straightTrackDirection, type DragPreview, type Purse, type Track,
} from "./track";
import { heightAt, WATER, FIELD_OCC, GRASS, ROUGH, SAND, factoryFootprintOf, idx, type Grid } from "./grid";
import {
  bridgeCostFor, bridgeDeckAt, planBridges, sideJoinAt, type BridgePlan,
} from "./bridges";
import { TRUCK_SPEED } from "./vehicles";
// E4 (#268): the slope rules — the local step, the drag's ramp/diagonal shape,
// the flat-footprint rule for platforms and depots, and the uphill speed factor.
// #429 adds the drag VERDICT (stop-tiles apart from red-mark tiles, run counted
// across the joins) and the ramp-corner exception to the 45° turn rule.
import {
  elevationActive,
} from "./elevation";
import {
  climbLevels, footprintFlatTiles, railDragSlopeVerdict, railJoinSlopeRefusal,
  railRampCornerOk, uphillFactor, type RailSlopeRun,
} from "./slopes";
// RAIL-SLOPE (#429): the slope-aware router a drag falls back to when the
// geometric line breaks a slope rule.
import { routeRailSlope } from "./rail-slope-route";
import type { DrawItem } from "./depth";
import { base64ToBytes, bytesToBase64, type RailTileWire, type RailWire, type TrainWire } from "./snapshot";

// ── bits ──────────────────────────────────────────────────────────────────
export const RAIL_PRESENT = PRESENT;
export const RAIL_BITS = 0b1111;
/**
 * Playtest (2026-09): DIAGONAL track — screen up/down and left/right — so a
 * line can turn in 45° steps (a train cannot take a 90° bend). A diagonal link
 * is stored ONCE, on the tile with the smaller x: `RAIL_DE` joins (x+1, y-1)
 * (screen east) and `RAIL_DS` joins (x+1, y+1) (screen south). The other two
 * diagonals of a tile are read from its neighbours. The four orthogonal bits
 * and `RAIL_PRESENT` are unchanged, so every road-shaped rule still reads
 * `RAIL_BITS` exactly as before.
 */
export const RAIL_DE = 32;
export const RAIL_DS = 64;
export const RAIL_DIAG = RAIL_DE | RAIL_DS;
/** #420: rail deck above road, in the formerly unused bit of the saved byte. */
export const RAIL_OVERPASS = 128;

/**
 * The eight headings, as grid steps, in turning order (45° apart). Index =
 * "octant". Two consecutive steps of a route may differ by at most one octant.
 */
export const OCT_STEPS: readonly [number, number][] = [
  [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1],
];
/** Screen-compass name of each octant (the car sprites' headings). */
export const OCT_NAMES = ["e", "se", "s", "sw", "w", "nw", "n", "ne"] as const;
export type CarHeading = typeof OCT_NAMES[number];

/** The octant of a grid step (signs only), or -1 for no step. */
export function octantOf(dx: number, dy: number): number {
  const sx = Math.sign(dx), sy = Math.sign(dy);
  for (let i = 0; i < 8; i++) if (OCT_STEPS[i][0] === sx && OCT_STEPS[i][1] === sy) return i;
  return -1;
}

/** May a train go from heading `a` to heading `b`? Straight on or one 45° step. */
export const turnOk = (a: number, b: number): boolean => {
  if (a < 0 || b < 0) return true;
  const d = Math.abs(a - b) % 8;
  return Math.min(d, 8 - d) <= 1;
};

/** The four quarter-turns a platform or a depot may be built in. */
export const RAIL_VIEWS = ["ne", "se", "sw", "nw"] as const;
export type RailView = typeof RAIL_VIEWS[number];

const VIEW_BIT: Record<RailView, number> = { ne: NE, se: SE, sw: SW, nw: NW };
export const VIEW_OF_BIT: Record<number, RailView> = { [NE]: "ne", [SE]: "se", [SW]: "sw", [NW]: "nw" };

/** Platform footprints by heading: the lane along NE/SW is 2 wide × 3 deep. */
export const PLATFORM_FOOTPRINT: Record<RailView, [number, number]> = {
  // Playtest (2026-09): the platform is one tile deep and three long, with NO
  // track of its own. Its view names the side its track runs along: se/nw
  // lie along y (track at x+1 / x-1), sw/ne along x (track at y+1 / y-1).
  se: [1, 3], nw: [1, 3], sw: [3, 1], ne: [3, 1],
};
export const DEPOT_FOOTPRINT: [number, number] = [2, 2];

/** A footprint is rotatable in quarter turns. */
export function rotateView(view: RailView, quarterTurns = 1): RailView {
  const i = RAIL_VIEWS.indexOf(view);
  return RAIL_VIEWS[(i + quarterTurns + 4) % 4];
}

// ── costs and scoring (RAIL-01 / #175) ────────────────────────────────────
/**
 * THE authoritative railway price table. Every surface — the Build buttons, the
 * placement, the multiplayer host's validation and these tests — reads these
 * numbers, so "what the button says" and "what the placement charges" cannot
 * drift (the W1 invariant the road tiers already keep).
 *
 * Gold is deliberately absent: PP-08 reserves it for Black Market sabotage.
 *
 * The numbers themselves live in ONE place, `BUILD_COSTS` (config.ts), beside
 * every road and building price, so the balance gate (#182) tunes one table.
 * This is the railway's view of that table under the names the rules use.
 */
export const RAIL_COSTS: Readonly<{
  rail: Purse; platform: Purse; depot: Purse; train: Purse; bridge: Purse;
  /** RAIL-6 (#575): one more lane at a standing station. */
  lane: Purse;
}> = {
  rail: BUILD_COSTS.rail,
  platform: BUILD_COSTS.platform,
  depot: BUILD_COSTS.trainDepot,
  train: BUILD_COSTS.train,
  // R2 (#266): the deck, per water tile spanned. Three rail tiles' stone.
  bridge: BUILD_COSTS.railBridge,
  lane: BUILD_COSTS.stationLane,
};

/** RAIL-01: exactly one Victory Point per platform, on construction. */
/**
 * The point a platform is worth. Aliased to `VICTORY.platform` rather than
 * retyped, so the scoreboard's number and the tool's promise (`+1★`) can never
 * drift apart.
 */
export const PLATFORM_VP = VICTORY.platform;
/** Demolition and resale both return half, rounded down, per resource. */
export const RESALE_RATE = 0.5;
/** A platform must anchor within this Manhattan distance of its industry. */
export const ANCHOR_RANGE = 3;
/** RAIL-04: the platform stop, in ms. */
export const DWELL_MS = 1500;
/**
 * RAIL-04: twice the dirt lorry's speed (`TRUCK_SPEED` is the dirt pace — one
 * tile per 300 ms), so a rail line is the fast option the epic priced for.
 */
export const RAIL_SPEED = TRUCK_SPEED * 2;
/** Body lengths in tiles, used to space the wagon behind the locomotive. */
export const LOCO_LEN = 1.16;
export const WAGON_LEN = 0.98;
export const COUPLE_GAP = 0.12;
/** Centre-to-centre distance from the locomotive to its wagon. */
export const WAGON_OFFSET = LOCO_LEN / 2 + COUPLE_GAP + WAGON_LEN / 2;

/**
 * Playtest (2026-09): a train is a CONSIST of separate cars — locomotive,
 * tender and wagons — each laid on the track behind the one before, so it
 * follows a bend car by car. Lengths in tiles, measured from the owner's art
 * (the side view, boxcar = 0.8 tiles; `assets/railway/manifest.json`).
 */
export type CarKind = "loco" | "tender" | "box" | "tank" | "flat";
export const CAR_LEN: Record<CarKind, number> = {
  // 25% smaller than the first cut (owner call, 2026-09): boxcar = 0.6 tiles.
  loco: 0.861, tender: 0.394, box: 0.6, tank: 0.556, flat: 0.515,
};
/** Buffer-to-buffer gap between two coupled cars, tiles. */
export const CAR_GAP = 0.03;
/** The cars of a train, locomotive first: every wagon kind, the oil tanker included. */
export const consistOf = (_t: Train): CarKind[] => ["loco", "tender", "box", "tank", "flat"];

/** Distance from the locomotive's centre (the train's position) to each car's centre. */
export function carOffsets(cars: CarKind[]): number[] {
  const out: number[] = [];
  let s = 0;
  for (let i = 0; i < cars.length; i++) {
    if (i > 0) s += CAR_LEN[cars[i - 1]] / 2 + CAR_GAP + CAR_LEN[cars[i]] / 2;
    out.push(s);
  }
  return out;
}

/** Front of the locomotive to the back of the last car. */
export const trainLength = (t: Train): number => {
  const cars = consistOf(t);
  const off = carOffsets(cars);
  return off[off.length - 1] + CAR_LEN[cars[cars.length - 1]] / 2 + CAR_LEN.loco / 2;
};

/** `floor(rate × each resource)` — the one refund rule, for rail and trains. */
export function resaleValue(cost: Purse, rate = RESALE_RATE): Purse {
  const out: Purse = {};
  for (const c of CARGOES) {
    const v = Math.floor((cost[c] ?? 0) * rate);
    if (v > 0) out[c] = v;
  }
  return out;
}

export const costEntries = (cost: Purse): [Cargo, number][] =>
  CARGOES.filter((c) => (cost[c] ?? 0) > 0).map((c) => [c, cost[c] as number]);

export const canPay = (purse: Purse, cost: Purse): boolean =>
  costEntries(cost).every(([c, n]) => (purse[c] ?? 0) >= n);

export const missingFor = (purse: Purse, cost: Purse): Cargo[] =>
  CARGOES.filter((c) => (cost[c] ?? 0) > (purse[c] ?? 0));

/** The price of a drag's worth of rail: one Stone a tile, no free allowance. */
export const railCost = (tiles: number): Purse => {
  const out: Purse = {};
  if (tiles <= 0) return out;          // a free drag costs nothing — and says so
  for (const [c, n] of costEntries(RAIL_COSTS.rail)) out[c] = n * tiles;
  return out;
};

/**
 * R2 (#266): the price of a rail drag of `fresh` new tiles, `decks` of them
 * bridge decks. A deck is charged `RAIL_COSTS.bridge` (per water tile) instead
 * of the flat rail tile, and — like the road decks — never rides the setup
 * allowance. One function, so the preview, `buildRail`'s `RailBuildResult` and
 * the rival's `RailMove.cost` all quote the same number.
 */
export const railCostOf = (fresh: number, decks = 0): Purse =>
  addCost(railCost(Math.max(0, fresh - Math.max(0, decks))), bridgeCostFor(RAIL_COSTS.bridge, decks));

// ── the layer ─────────────────────────────────────────────────────────────
/**
 * The rail layer. Deliberately its own two arrays: an owner-scoped rail graph
 * never touches `Track.dirt`/`Track.road`/`Track.owner`/`Track.upgraded`, so
 * every road rule (flooding, paving provenance, VP on paves, lorry routing) is
 * untouched by a railway existing.
 */
export interface Rail {
  /** Direction mask + `RAIL_PRESENT` per tile; 0 = no rail. */
  tile: Uint8Array;
  /** 0 = unbuilt, else the builder's id (player index + 1). */
  owner: Uint8Array;
  /** Bumped on every rail mutation — planning caches hang off it. */
  revision: number;
}

export const createRail = (): Rail => ({
  tile: new Uint8Array(MAP_W * MAP_W),
  owner: new Uint8Array(MAP_W * MAP_W),
  revision: 0,
});

/** A tile the LAYER says carries player-built rail (any mask, stub included). */
export const hasRail = (rail: Rail, tx: number, ty: number): boolean =>
  inMapT(tx, ty) && (rail.tile[tIdx(tx, ty)] & RAIL_PRESENT) !== 0;

export const railBitsAt = (rail: Rail, tx: number, ty: number): number =>
  inMapT(tx, ty) ? rail.tile[tIdx(tx, ty)] & RAIL_BITS : 0;

/** May `ownerId` use the player-built rail at (tx,ty)? Own tiles only in v1. */
export const railOpenTo = (rail: Rail, ownerId: number, tx: number, ty: number): boolean =>
  inMapT(tx, ty) && (rail.tile[tIdx(tx, ty)] & RAIL_PRESENT) !== 0
  && rail.owner[tIdx(tx, ty)] === ownerId;

/** Are (ax,ay) and (bx,by) diagonal neighbours? */
export const isDiagStep = (ax: number, ay: number, bx: number, by: number): boolean =>
  Math.abs(ax - bx) === 1 && Math.abs(ay - by) === 1;

/** The tile and bit that store the diagonal link between two diagonal neighbours. */
function diagSlot(ax: number, ay: number, bx: number, by: number): { i: number; bit: number } {
  const [lx, ly, hy] = ax < bx ? [ax, ay, by] : [bx, by, ay];
  return { i: tIdx(lx, ly), bit: hy < ly ? RAIL_DE : RAIL_DS };
}

/** Is there a diagonal rail link between these two diagonal neighbours? */
export function diagLinked(rail: Rail, ax: number, ay: number, bx: number, by: number): boolean {
  if (!isDiagStep(ax, ay, bx, by) || !inMapT(ax, ay) || !inMapT(bx, by)) return false;
  if (!(rail.tile[tIdx(ax, ay)] & RAIL_PRESENT) || !(rail.tile[tIdx(bx, by)] & RAIL_PRESENT)) return false;
  const { i, bit } = diagSlot(ax, ay, bx, by);
  return (rail.tile[i] & bit) !== 0;
}

/** The diagonal neighbours a tile is linked to. */
export function diagNeighbours(rail: Rail, x: number, y: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [dx, dy] of [[1, -1], [1, 1], [-1, 1], [-1, -1]] as const) {
    if (diagLinked(rail, x, y, x + dx, y + dy)) out.push([x + dx, y + dy]);
  }
  return out;
}

// D2: roads share the existing octilinear path algorithm (now in track.ts).
export { octPath } from "./track";

// ── ground rules ──────────────────────────────────────────────────────────
/**
 * Land a rail tile may stand on. Rough ground is allowed — this map's ROUGH is
 * rocky flat, not a slope, and the epic's exclusion list (water, bridges,
 * tunnels, slopes) has no bridge, tunnel or slope here to exclude.
 */
export const railTerrainOk = (grid: Grid, tx: number, ty: number): boolean => {
  if (!inMapT(tx, ty)) return false;
  const t = grid.terrain[idx(tx, ty)];
  return t === GRASS || t === SAND || t === ROUGH;
};

/** Road surface at a tile, either tier — own, rival or public. */
export const roadAt = (track: Track, tx: number, ty: number): number =>
  inMapT(tx, ty) ? (track.dirt[tIdx(tx, ty)] | track.road[tIdx(tx, ty)]) & 0b1111 : 0;

/**
 * A level crossing: rail may be laid over a road tile only when the road is an
 * EMPTY STRAIGHT segment and the rail crosses it (axis/axis or axis/diagonal). Curves and
 * junctions are refused, and the road's bits, owner and upgrade provenance are
 * never written — the crossing exists purely as two overlapping tile models.
 */
export function crossingOk(track: Track, tx: number, ty: number, railMask: number, railDiagonal = 0): boolean {
  const road = roadConnectionMask(track, tx, ty);
  return crossingMasksOk(road & 15, railMask, road & ~15, railDiagonal);
}

// Shared leaf policy in track.ts: geometry must not import the rail simulation.
export { crossingMasksOk } from "./track";

// ── structures ────────────────────────────────────────────────────────────
export type RailKind = "platform" | "depot";

/**
 * What a platform serves: a map industry, or one of the owner's own processing
 * plants. `id` is the industry's list index or the plant's townId — two
 * namespaces, which is what the `kind` field is for.
 */
export interface RailAnchor {
  kind: "industry" | "plant";
  id: number;
  /** Tiles of the anchored building, for the range test and the overlay. */
  tiles: [number, number][];
}

export interface RailStructure {
  id: number;
  kind: RailKind;
  /** Track-owner id (player index + 1) — the id rail tiles and trains use. */
  ownerId: number;
  /** Display/VP identity ("you" / "ai" / a story cast id). */
  owner: string;
  /** Footprint origin: the top corner of the block, as everywhere else. */
  tx: number;
  ty: number;
  w: number;
  h: number;
  view: RailView;
  /** Platform only: the industry or owned plant it was anchored to. */
  anchor?: RailAnchor | null;
  /**
   * RAIL-6 (#575) — THE STATION'S LANES. A platform is a station: a warehouse
   * plus 1–4 lanes, each a platform track one train uses at a time. Absent on
   * structures read from an old save or an old wire: `stationLanes` then
   * materialises the ONE lane the footprint always carried, so a pre-RAIL-6
   * single platform loads as a 1-lane station and nothing else changes.
   */
  lanes?: RailLane[];
}

/**
 * RAIL-6 (#575): one platform track of a station — the strip a train stands
 * beside and the three stopping tiles beside it. `lineId` is the lane's
 * standing assignment (which line's train calls it home); a lane with no
 * assignment is free for a new line. The runtime holder (the train actually
 * inbound or dwelling) is read off the trains, never stored here.
 */
export interface RailLane {
  id: number;
  view: RailView;
  /** Slab origin (the strip's top corner); the track runs along its view side. */
  tx: number;
  ty: number;
  /** The line this lane is assigned to, or null while it is unassigned. */
  lineId: number | null;
}

/** RAIL-6 (#575): the lanes a station holds — one to four. */
export const MAX_LANES = 4;

export interface RailState {
  rail: Rail;
  structures: RailStructure[];
  lines: RailLine[];
  trains: Train[];
  /** Monotonic id allocator across structures, lines and trains. */
  seq: number;
  /**
   * Playtest (2026-09): where each train's head has been, head first, in
   * tile coordinates — the cars are laid along it, so a train bends round a
   * corner car by car. Local to each seat (never on the wire): every seat runs
   * `tickTrains`, and a joining guest's trains grow their trail as they move.
   */
  trails?: Map<number, [number, number][]>;
}

export const createRailState = (): RailState => ({
  rail: createRail(),
  structures: [],
  lines: [],
  trains: [],
  seq: 1,
  trails: new Map(),
});

export const footprintFor = (kind: RailKind, view: RailView): [number, number] =>
  kind === "platform" ? PLATFORM_FOOTPRINT[view] : DEPOT_FOOTPRINT;

export const viewBit = (view: RailView): number => VIEW_BIT[view];

export const footprintTiles = (s: Pick<RailStructure, "tx" | "ty" | "w" | "h">): [number, number][] => {
  const out: [number, number][] = [];
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) out.push([s.tx + x, s.ty + y]);
  return out;
};

export const structureAt = (state: RailState, tx: number, ty: number): RailStructure | null =>
  state.structures.find((s) => tx >= s.tx && tx < s.tx + s.w && ty >= s.ty && ty < s.ty + s.h) ?? null;

export const structureById = (state: RailState, id: number): RailStructure | null =>
  state.structures.find((s) => s.id === id) ?? null;

export const structuresOf = (state: RailState, ownerId: number, kind?: RailKind): RailStructure[] =>
  state.structures.filter((s) => s.ownerId === ownerId && (kind === undefined || s.kind === kind));

/**
 * The structure's INTERNAL TRACK — one tile wide, running along the lane axis
 * the heading names. For the 3×2 headings the lane is a row; for the 2×3
 * headings it is a column. The lane is what a train drives over, and it is
 * included in the structure's price.
 */
export function laneTiles(s: RailStructure): [number, number][] {
  // A platform has no internal track any more: its train stops on ordinary
  // rail laid beside it (`platformTrack`).
  if (s.kind === "platform") return [];
  const out: [number, number][] = [];
  const uAxis = s.view === "se" || s.view === "nw";
  if (uAxis) {
    const row = s.view === "se" ? s.ty : s.ty + s.h - 1;
    for (let x = 0; x < s.w; x++) out.push([s.tx + x, row]);
  } else {
    const col = s.view === "ne" ? s.tx : s.tx + s.w - 1;
    for (let y = 0; y < s.h; y++) out.push([col, s.ty + y]);
  }
  return out;
}

/**
 * Playtest (2026-09): the three tiles of ordinary rail a platform's train
 * stands on — the row along the platform's track side, in axis order. They are
 * laid for free with the platform (`layPlatformTrack`) and are player rail
 * like any other: demolishable, and joined by the player's own drags.
 */
export function platformTrack(s: RailStructure): [number, number][] {
  const out: [number, number][] = [];
  if (s.view === "se" || s.view === "nw") {
    const x = s.view === "se" ? s.tx + s.w : s.tx - 1;
    for (let y = 0; y < s.h; y++) out.push([x, s.ty + y]);
  } else {
    const y = s.view === "sw" ? s.ty + s.h : s.ty - 1;
    for (let x = 0; x < s.w; x++) out.push([s.tx + x, y]);
  }
  return out;
}

/** The track tiles a platform would get at this placement (before it exists). */
export const platformTrackAt = (tx: number, ty: number, view: RailView): [number, number][] => {
  const [w, h] = PLATFORM_FOOTPRINT[view];
  return platformTrack({ id: 0, kind: "platform", ownerId: 0, owner: "", tx, ty, w, h, view, anchor: null });
};

/** The tile a train stops at: the middle of the lane (a platform: of its track). */
export function stopTile(s: RailStructure): [number, number] {
  const lane = s.kind === "platform" ? platformTrack(s) : laneTiles(s);
  return lane[(lane.length - 1) >> 1];
}

// ── RAIL-6 (#575): the station and its lanes ──────────────────────────────
//
// A platform IS a station: one warehouse plus 1–4 lanes. Lane 0 is the
// footprint the platform was placed with (its strip and its three stopping
// tiles), so every pre-RAIL-6 platform is a 1-lane station and every rule that
// read "the platform's track" keeps reading lane 0. An upgrade adds a lane: a
// parallel strip two tiles over — its own track, its own switch, its own stop
// tile — on whichever side the player picks, if the ground there is free and
// flat. The warehouse art follows the lane count (three tiers); the lane slab
// is painted in code over the track bed.
//
// Lanes are the station's CAPACITY: one train per lane at a time. A train
// books the lane it is running to; when every lane at a station is booked the
// next train holds at the THROAT — the last tile of its approach outside the
// station's tracks — and picks a lane up the moment one frees. Nothing about
// that waits on another train standing still (a dwelling train always departs
// after its dwell and frees its lane), so a full station queues, never
// deadlocks.

/**
 * The station's lanes, materialised on first read: an old save or an old wire
 * carries no `lanes`, and its platform's footprint IS lane 0. Depot structures
 * have none.
 */
export function stationLanes(s: RailStructure): RailLane[] {
  if (s.kind !== "platform") return [];
  if (!s.lanes || !s.lanes.length) {
    s.lanes = [{ id: s.id, view: s.view, tx: s.tx, ty: s.ty, lineId: null }];
  }
  return s.lanes;
}

/** The warehouse art tier a lane count draws (1–3 tiers for 1–4 lanes). */
export const stationWarehouseTier = (lanes: number): 1 | 2 | 3 =>
  (lanes <= 1 ? 1 : lanes === 2 ? 2 : 3);

/** The strip tiles of one lane (its 1×3 / 3×1 platform slab). */
export function laneSlabTiles(l: Pick<RailLane, "view" | "tx" | "ty">): [number, number][] {
  const [w, h] = PLATFORM_FOOTPRINT[l.view];
  const out: [number, number][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push([l.tx + x, l.ty + y]);
  return out;
}

/** The three stopping tiles of one lane — ordinary rail, laid with the lane. */
export function laneTrackTiles(l: Pick<RailLane, "view" | "tx" | "ty">): [number, number][] {
  const out: [number, number][] = [];
  const [w, h] = PLATFORM_FOOTPRINT[l.view];
  if (l.view === "se" || l.view === "nw") {
    const x = l.view === "se" ? l.tx + w : l.tx - 1;
    for (let y = 0; y < h; y++) out.push([x, l.ty + y]);
  } else {
    const y = l.view === "sw" ? l.ty + h : l.ty - 1;
    for (let x = 0; x < w; x++) out.push([l.tx + x, y]);
  }
  return out;
}

/** The tile a train stops at on one lane: the middle of its track. */
export function laneStopTile(l: Pick<RailLane, "view" | "tx" | "ty">): [number, number] {
  const t = laneTrackTiles(l);
  return t[(t.length - 1) >> 1];
}

/** Every tile a station stands on: every lane's strip and stopping track. */
export function stationTiles(s: RailStructure): [number, number][] {
  const out: [number, number][] = [];
  for (const l of stationLanes(s)) out.push(...laneSlabTiles(l), ...laneTrackTiles(l));
  return out;
}

/**
 * Where a new lane's strip would start on one side of the station: two tiles
 * out from the outermost lane already on that side, across the axis the
 * station's heading runs along (a lane is a strip plus its track — two tiles
 * wide across the row).
 */
export function laneOriginAt(s: RailStructure, side: 1 | -1): { tx: number; ty: number } {
  const lanes = stationLanes(s);
  const along = (l: RailLane): number => (l.view === "se" || l.view === "nw" ? l.tx : l.ty);
  const base = side === 1
    ? lanes.reduce((a, b) => (along(b) > along(a) ? b : a))
    : lanes.reduce((a, b) => (along(b) < along(a) ? b : a));
  return s.view === "se" || s.view === "nw"
    ? { tx: base.tx + 2 * side, ty: base.ty }
    : { tx: base.tx, ty: base.ty + 2 * side };
}

/** A probe lane as a structure-shaped record, for the shared footprint rules. */
function laneProbe(l: Pick<RailLane, "view" | "tx" | "ty">): RailStructure {
  const [w, h] = PLATFORM_FOOTPRINT[l.view];
  return { id: -1, kind: "platform", ownerId: 0, owner: "", tx: l.tx, ty: l.ty, w, h, view: l.view };
}

/**
 * RAIL-6 (#575): may this station grow a lane on this side? The same
 * vocabulary as every other placement refusal — the HUD, the click, the rival
 * and the host all read this one answer. The lane's strip AND its three
 * stopping tiles must be free, flat ground inside the map, clear of diagonal
 * track and overpasses, exactly as a placed platform's are.
 */
export function laneRefusal(
  grid: Grid, state: RailState, ownerId: number, stationId: number, side: 1 | -1,
): RailRefusal {
  const s = structureById(state, stationId);
  if (!s || s.kind !== "platform") return "missing";
  if (s.ownerId !== ownerId) return "not-yours";
  const lanes = stationLanes(s);
  if (lanes.length >= MAX_LANES) return "max-lanes";
  const origin = laneOriginAt(s, side);
  const probe = laneProbe({ view: s.view, ...origin });
  for (const [x, y] of [...laneSlabTiles(probe), ...laneTrackTiles(probe)]) {
    if (!inMapT(x, y)) return "off-map";
    if (!railTerrainOk(grid, x, y)) return "water";
    if (grid.occupancy[tIdx(x, y)] >= 0 || grid.occupancy[tIdx(x, y)] === FIELD_OCC) return "occupied";
    const b = grid.builtAt?.(x, y);
    if (b === "depot" || b === "plant" || b === "platform" || b === "bridge" || b === "dam") return "occupied";
    if (state.rail.tile[tIdx(x, y)] & RAIL_OVERPASS) return "overpass-stop";
    // Foreign rail under the new track: the lane's tiles are laid by the
    // station's owner and cannot steal another seat's bed. Own rail is fine —
    // a lane may close over the player's own siding (the merge is `buildRail`'s).
    if (hasRail(state.rail, x, y) && state.rail.owner[tIdx(x, y)] !== ownerId) return "foreign-rail";
  }
  if (laneTrackTiles(probe).some(([x, y]) => diagNeighbours(state.rail, x, y).length > 0)) return "axis-only";
  // Laying the lane's track must not hang an arm no train can turn through on
  // the network beside it — the same 45° rule `buildRail` commits under, asked
  // up front so the HUD and the click refuse with the reason BEFORE the pay.
  for (const [x, y] of laneTrackTiles(probe)) {
    for (const [nx, ny] of railNeighbours(state, ownerId, x, y)) {
      if (!railJoinTurnOk(state, ownerId, x, y, nx, ny, grid)) return "too-sharp";
    }
  }
  if (state.structures.some((o) => o !== s && overlaps(o, origin.tx, origin.ty, probe.w, probe.h))) return "overlap";
  for (const [x, y] of laneTrackTiles(probe)) {
    if (state.structures.some((o) => overlaps(o, x, y, 1, 1))) return "track-blocked";
  }
  // E4 (#268): the strip and its track sit on one plane, like every footprint.
  if (footprintFlatTiles(grid, [...laneSlabTiles(probe), ...laneTrackTiles(probe)])) return "not-flat";
  return "ok";
}

/**
 * RAIL-6 (#575): grow a station by one lane on one side. The lane's three
 * stopping tiles are laid with it (they are inside the lane's price, exactly
 * as a placed platform's are), and the rail revision moves so every planned
 * leg and every renderer cache notices the new track.
 */
export function addStationLane(
  grid: Grid, track: Track, state: RailState, ownerId: number, stationId: number, side: 1 | -1,
): { ok: boolean; lane?: RailLane; why?: RailRefusal } {
  const why = laneRefusal(grid, state, ownerId, stationId, side);
  if (why !== "ok") return { ok: false, why };
  const s = structureById(state, stationId)!;
  const lanes = stationLanes(s);
  const origin = laneOriginAt(s, side);
  const lane: RailLane = { id: state.seq++, view: s.view, tx: origin.tx, ty: origin.ty, lineId: null };
  lanes.push(lane);
  // Keep the lane list in map order along the row, so the draw pass (and the
  // panel) visit lanes back-to-front every frame — a stable order is what
  // keeps a station from flickering between its lanes.
  const along = (l: RailLane): number => (l.view === "se" || l.view === "nw" ? l.tx : l.ty);
  lanes.sort((a, b) => along(a) - along(b) || a.id - b.id);
  // The lane's track is laid with it — and the lay is judged by `buildRail`'s
  // own commit rules (a connector running past the lane can make the join
  // "too-sharp" for a train). A refused lay takes the lane back off the
  // station: a lane without its stopping track would be a dead berth.
  const laid = previewRailBuild(grid, track, state, ownerId, laneTrackTiles(lane));
  if (laid.why !== "ok") {
    lanes.splice(lanes.indexOf(lane), 1);
    return { ok: false, why: laid.why };
  }
  buildRail(grid, track, state, ownerId, laneTrackTiles(lane));
  state.rail.revision++;
  return { ok: true, lane };
}

/**
 * RAIL-6 (#575): would `addStationLane` COMMIT right now — the whole answer,
 * `laneRefusal` plus `buildRail`'s commit rules (a connector running past the
 * lane can make the join "too-sharp" only once the autolink sees it), asked of
 * a copy nothing else can observe. The rival gates its lane proposals on this,
 * so a lane it plans is a lane it builds; the HUD's cheap `laneRefusal` keeps
 * its own answer for the hover colour, and the click still refunds if the
 * world moved in between.
 */
export function probeStationLane(
  grid: Grid, track: Track, state: RailState, ownerId: number, stationId: number, side: 1 | -1,
): { state: RailState; lane: RailLane } | null {
  const s = structureById(state, stationId);
  if (!s) return null;
  const probe: RailState = {
    ...state,
    structures: state.structures.map((o) => o === s ? { ...o, lanes: o.lanes?.map((l) => ({ ...l })) } : o),
    rail: { ...state.rail, tile: state.rail.tile.slice(), owner: state.rail.owner.slice() },
  };
  const res = addStationLane(grid, track, probe, ownerId, stationId, side);
  return res.ok && res.lane ? { state: probe, lane: res.lane } : null;
}

export function canAddStationLane(
  grid: Grid, track: Track, state: RailState, ownerId: number, stationId: number, side: 1 | -1,
): boolean {
  return probeStationLane(grid, track, state, ownerId, stationId, side) !== null;
}

/**
 * RAIL-6 (#575): give a fresh line its standing lane at each end — the first
 * unassigned lane of the station, when one is free. A line whose end has no
 * free lane runs on whatever lane its train can book at runtime (and queues
 * at the throat when none is free).
 */
export function assignLineLanes(state: RailState, line: RailLine): void {
  for (const end of ["source", "dest"] as const) {
    const st = structureById(state, line[end]);
    if (!st || st.kind !== "platform") continue;
    const lane = stationLanes(st).find((l) => l.lineId == null);
    if (!lane) continue;
    lane.lineId = line.id;
    if (end === "source") line.sourceLane = lane.id;
    else line.destLane = lane.id;
  }
}

/** Drop every lane assignment a line held (the line is gone). */
export function clearLineLanes(state: RailState, lineId: number): void {
  for (const st of state.structures) {
    if (st.kind !== "platform" || !st.lanes) continue;
    for (const l of st.lanes) if (l.lineId === lineId) l.lineId = null;
  }
}

/** The station a train's current target names, or null (depot / no line). */
export function trainTargetStation(state: RailState, t: Train): number | null {
  if (t.target === "depot") return null;
  const line = lineOfTrain(state, t);
  if (!line) return null;
  return t.target === "source" ? line.source : line.dest;
}

/**
 * The train that currently holds one lane of a station: inbound to it,
 * dwelling at it, or holding at its throat with the lane booked. A train
 * heading home or parked holds nothing.
 */
export function laneHolder(state: RailState, stationId: number, laneId: number): Train | null {
  for (const t of state.trains) {
    if (t.laneId !== laneId) continue;
    if (t.status === "stored" || t.status === "returning") continue;
    if (trainTargetStation(state, t) !== stationId) continue;
    return t;
  }
  return null;
}

/**
 * RAIL-6 (#575): the lane a train runs into at a station — its line's assigned
 * lane when that one is free, else any free lane, else null (the train holds
 * at the throat). Booking is the write: the caller sets `train.laneId` from
 * the answer, and frees it again when the train departs the stop.
 */
/**
 * RAIL-6 (#575): every FREE lane of the station this train may run into, best
 * first: the lane its line was assigned, then the rest in map order. "Free"
 * means no other train is booked into it — the train's own booking is free to
 * it. `planLeg` walks this list and takes the first lane it can legally ROUTE
 * to: a queued train's throat faces only some of a station's lanes (each lane
 * has its own 45° fan), so a free lane on a far approach must not tempt the
 * train into a 90° "no route".
 */
export function pickStationLanes(state: RailState, train: Train, station: RailStructure): RailLane[] {
  const lanes = stationLanes(station);
  const free = (l: RailLane): boolean => {
    const holder = laneHolder(state, station.id, l.id);
    return !holder || holder.id === train.id;
  };
  const line = lineOfTrain(state, train);
  const assigned = line ? lanes.find((l) => l.id === (train.target === "source" ? line.sourceLane : line.destLane))
    ?? lanes.find((l) => l.lineId === line.id) : undefined;
  const rest = lanes.filter((l) => l !== assigned && free(l));
  return assigned && free(assigned) ? [assigned, ...rest] : rest;
}

export function pickStationLane(state: RailState, train: Train, station: RailStructure): RailLane | null {
  return pickStationLanes(state, train, station)[0] ?? null;
}

/** Free the lane a train holds (it is leaving the stop, or leaving service). */
export function releaseTrainLane(train: Train): void {
  train.laneId = null;
  train.holdStation = null;
}

export interface RailPort {
  tx: number;
  ty: number;
  /** The direction the port faces, outward from the structure. */
  dir: number;
}

/**
 * The lane's two ends, each facing outward. A rail tile built against a port
 * joins the structure to the network; the port's direction is the bit that must
 * face back at it.
 */
export function railPorts(s: RailStructure): RailPort[] {
  const lane = s.kind === "platform" ? platformTrack(s) : laneTiles(s);
  const a = lane[0];
  const b = lane[lane.length - 1];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const bit = dx > 0 ? SE : dx < 0 ? NW : dy > 0 ? SW : NE;
  return [
    { tx: a[0], ty: a[1], dir: OPPOSITE[bit] },
    { tx: b[0], ty: b[1], dir: bit },
  ];
}

/**
 * A depot's declared rail exit: the lane end the shed faces. The art is
 * authored with the shed at the back, so the exit is the front end of the lane —
 * the port a train departs from and returns to.
 */
export function depotExit(s: RailStructure): RailPort {
  const ports = railPorts(s);
  const forward = VIEW_BIT[s.view];
  return ports.find((p) => p.dir === forward) ?? ports[1];
}

/** Bits one structure contributes at one of its own lane tiles. */
function laneMaskAt(s: RailStructure, tx: number, ty: number): number {
  const lane = laneTiles(s);
  const here = lane.findIndex(([x, y]) => x === tx && y === ty);
  if (here < 0) return 0;
  let mask = 0;
  // A bit names the direction FROM this tile TOWARD its neighbour, so the
  // arguments are always (this tile, neighbour) — never the other way round.
  if (here > 0) mask |= dirBitBetween([tx, ty], lane[here - 1]);
  if (here < lane.length - 1) mask |= dirBitBetween([tx, ty], lane[here + 1]);
  for (const port of railPorts(s)) if (port.tx === tx && port.ty === ty) mask |= port.dir;
  return mask;
}

const dirBitBetween = (from: [number, number], to: [number, number]): number => {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  return dx > 0 ? SE : dx < 0 ? NW : dy > 0 ? SW : NE;
};

/**
 * Effective rail mask at a tile: the player-laid layer OR the internal track of
 * a structure lane. A structure's lane is part of the GRAPH — a train must be
 * able to drive out of the depot lane and onto the platform lane — but it is
 * not written into the layer, so the layer stays exactly "what the player
 * built" and demolishing a structure can never leave phantom bytes behind.
 */
export function effectiveMask(state: RailState, tx: number, ty: number): number {
  if (!inMapT(tx, ty)) return 0;
  let mask = state.rail.tile[tIdx(tx, ty)] & RAIL_BITS;
  const s = structureAt(state, tx, ty);
  if (s) mask |= laneMaskAt(s, tx, ty);
  return mask & RAIL_BITS;
}

/** Effective owner at a tile: the layer's owner, or a structure's owner. */
export function effectiveOwner(state: RailState, tx: number, ty: number): number {
  if (!inMapT(tx, ty)) return 0;
  const s = structureAt(state, tx, ty);
  return s ? s.ownerId : state.rail.owner[tIdx(tx, ty)];
}

/**
 * RAIL-03 (#177): the layer as the RENDERER reads it.
 *
 * The mask bytes the track painter draws from, with each structure's internal
 * lane folded in — a platform's lane and a depot's exit ARE track, they just
 * are not stored in the layer (see `effectiveMask`), and the vector geometry
 * has to draw them or the structure's rails would stop at its own footprint.
 * Ownership rides along for the cache's benefit (a change of hands invalidates
 * that tile) and `revision` is the gate its diff hangs off.
 *
 * This is the ONLY railway state the renderer gets: it never re-derives a rule
 * from the map, and it never writes back.
 */
export function railDrawLayer(state: RailState): { tile: Uint8Array; owner: Uint8Array; revision: number } {
  const tile = new Uint8Array(state.rail.tile.length);
  const owner = new Uint8Array(state.rail.owner.length);
  for (let i = 0; i < state.rail.tile.length; i++) {
    if ((state.rail.tile[i] & RAIL_PRESENT) === 0) continue;
    tile[i] = state.rail.tile[i] | RAIL_PRESENT;
    owner[i] = state.rail.owner[i];
  }
  for (const s of state.structures) {
    for (const [x, y] of laneTiles(s)) {
      const i = tIdx(x, y);
      tile[i] |= RAIL_PRESENT | laneMaskAt(s, x, y);
      owner[i] = s.ownerId;
    }
  }
  return { tile, owner, revision: state.rail.revision };
}

/** May `ownerId` drive over (tx,ty) — its own rail tile or its own lane? */
export function railDrivable(state: RailState, ownerId: number, tx: number, ty: number): boolean {
  if (!inMapT(tx, ty)) return false;
  const s = structureAt(state, tx, ty);
  if (s) return s.ownerId === ownerId;
  return railOpenTo(state.rail, ownerId, tx, ty);
}

// ── graph: components and paths ───────────────────────────────────────────
/**
 * Every tile of ONE owner's rail graph: its own layer tiles plus its own
 * structures' lanes. Planning never scans the whole map for candidates — it
 * floods from a seed and asks `effectiveMask` on demand — but the component
 * label map does need the owner's tile set, which is why it takes this one
 * pass. `railTilesOf` is that pass, and it is called on assignment/merge
 * checks, not per frame.
 */
export function ownerRailTiles(state: RailState, ownerId: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < state.rail.tile.length; i++) {
    if ((state.rail.tile[i] & RAIL_PRESENT) !== 0 && state.rail.owner[i] === ownerId) out.push(i);
  }
  for (const s of state.structures) {
    if (s.ownerId !== ownerId) continue;
    for (const [x, y] of laneTiles(s)) out.push(tIdx(x, y));
  }
  return out;
}

/**
 * Connected components of ONE owner's rail network, as component id per tile
 * (0 = not this owner's). Two trains may never share a component, so this is
 * how "one active train per connected owner rail component" is enforced — on
 * assignment, and on every build that could merge two components.
 */
export function railComponents(state: RailState, ownerId: number): Map<number, number> {
  const comp = new Map<number, number>();
  let next = 0;
  for (const seed of ownerRailTiles(state, ownerId)) {
    if (comp.has(seed)) continue;
    next++;
    const queue = [seed];
    comp.set(seed, next);
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      const x = cur % MAP_W, y = (cur / MAP_W) | 0;
      for (const [nx, ny] of railNeighbours(state, ownerId, x, y, false)) {
        const ni = tIdx(nx, ny);
        if (comp.has(ni)) continue;
        comp.set(ni, next);
        queue.push(ni);
      }
    }
  }
  return comp;
}

/**
 * Shortest tile route from any tile in `from` to any tile in `goals` over
 * `ownerId`'s drivable rail, crossing only mutually-facing effective bits. Null
 * when the two ends are not connected. The same BFS shape as `roadPath`, so a
 * rail route is planned exactly the way a lorry route is.
 */
export function railPath(
  state: RailState, ownerId: number,
  from: [number, number][], goals: Set<number>, startOct = -1,
  // #429: with a grid the search also drives through the 90° RAMP CORNER (a
  // switchback's turn — `railTurnOkGrid`); without one (a synthetic test
  // state, a caller with no map) it is exactly the 45° rule it always was.
  grid?: Grid,
): [number, number][] | null {
  if (!goals.size || !from.length) return null;
  // Playtest (2026-09): the search state is (tile, heading) — a train turns at
  // most 45° per tile, so a 90° corner is not a way through. Key = tile·9 +
  // heading (8 = "no heading yet", a start tile).
  const parent = new Map<number, number>();
  const queue: number[] = [];
  for (const [x, y] of from) {
    if (!railDrivable(state, ownerId, x, y)) continue;
    const k = tIdx(x, y) * 9 + (startOct >= 0 ? startOct : 8);
    if (parent.has(k)) continue;
    parent.set(k, -1);
    queue.push(k);
  }
  for (let head = 0; head < queue.length; head++) {
    const key = queue[head];
    const cur = Math.floor(key / 9), oct = key % 9;
    if (goals.has(cur)) {
      const path: number[] = [];
      for (let k = key; k !== -1; k = parent.get(k) as number) path.push(Math.floor(k / 9));
      path.reverse();
      return path.map((i) => [i % MAP_W, (i / MAP_W) | 0] as [number, number]);
    }
    const x = cur % MAP_W, y = (cur / MAP_W) | 0;
    for (const [nx, ny] of railNeighbours(state, ownerId, x, y)) {
      const o = octantOf(nx - x, ny - y);
      // #429: `railTurnOkGrid` is the ONE rule — ≤45°, or the ramp corner on
      // a map with height; without a grid, exactly the old `turnOk`.
      if (oct !== 8 && !railTurnOkGrid(grid,
        [x - OCT_STEPS[oct][0], y - OCT_STEPS[oct][1]], [x, y], [nx, ny])) continue;
      const nk = tIdx(nx, ny) * 9 + o;
      if (parent.has(nk)) continue;
      parent.set(nk, key);
      queue.push(nk);
    }
  }
  return null;
}

/**
 * Every tile `ownerId`'s rail steps to from (x,y): the mutually-facing
 * orthogonal bits (lanes included) and the diagonal links. `drive` also asks
 * that a train may stand there (the component flood only needs ownership).
 */
export function railNeighbours(
  state: RailState, ownerId: number, x: number, y: number, drive = true,
): [number, number][] {
  const out: [number, number][] = [];
  const mask = effectiveMask(state, x, y);
  for (const d of DIRS) {
    if (!(mask & d)) continue;
    let nx = x + DIR[d][0], ny = y + DIR[d][1];
    if (drive && inMapT(nx, ny) && (state.rail.tile[tIdx(nx, ny)] & RAIL_OVERPASS)) {
      if (effectiveOwner(state, nx, ny) !== ownerId || (effectiveMask(state, nx, ny) & (d | OPPOSITE[d])) !== (d | OPPOSITE[d])) continue;
      nx += DIR[d][0]; ny += DIR[d][1];
    }
    if (drive ? !railDrivable(state, ownerId, nx, ny) : effectiveOwner(state, nx, ny) !== ownerId) continue;
    if (!(effectiveMask(state, nx, ny) & OPPOSITE[d])) continue;
    out.push([nx, ny]);
  }
  for (const [nx, ny] of diagNeighbours(state.rail, x, y)) {
    if (drive ? railDrivable(state, ownerId, nx, ny) : effectiveOwner(state, nx, ny) === ownerId) out.push([nx, ny]);
  }
  return out;
}

/**
 * #401: a stub has no turn. At a junction EVERY arm must have a drivable
 * continuation. This admits a WYE, not a right-angle corner or a sharp spur:
 * trains may choose only the <=45° transitions (railPath enforces those).
 * Headings here point OUT from the tile, so reverse the arriving arm first.
 *
 * #429: `cornerOk` relaxes exactly the RAMP CORNER — a 90° pair of arms that
 * touches a level change, the switchback's turn (see `railTurnOkGrid`). A
 * caller without elevation context passes nothing and gets the old rule.
 */
function railArmsTurnOk(arms: number[], cornerOk?: (a: number, b: number) => boolean): boolean {
  return arms.length < 2 || arms.every((a) =>
    arms.some((b) => a !== b && (turnOk((a + 4) % 8, b) || cornerOk?.(a, b))));
}

/** #429: the corner test for a tile — two ARMS (directions pointing AT the
 * neighbouring tiles) form a legal ramp corner when the move into this tile
 * along one and out along the other turns 90° beside a level change. */
const rampCornerAtArms = (
  grid: Grid | undefined, x: number, y: number, a: number, b: number,
): boolean => railRampCornerOk(grid,
  [x + OCT_STEPS[a][0], y + OCT_STEPS[a][1]], [x, y],
  [x + OCT_STEPS[b][0], y + OCT_STEPS[b][1]]);

function railArms(state: RailState, ownerId: number, x: number, y: number): number[] {
  return railNeighbours(state, ownerId, x, y).map(([nx, ny]) => octantOf(nx - x, ny - y));
}

/** The planner's local join check, including both ends of a proposed edge.
 * `grid` carries the #429 ramp-corner exception on the edge's own turns. */
export function railJoinTurnOk(
  state: RailState, ownerId: number, ax: number, ay: number, bx: number, by: number,
  grid?: Grid,
): boolean {
  const o = octantOf(bx - ax, by - ay);
  const cornerA = grid ? (a: number, b: number) => rampCornerAtArms(grid, ax, ay, a, b) : undefined;
  const cornerB = grid ? (a: number, b: number) => rampCornerAtArms(grid, bx, by, a, b) : undefined;
  return railArmsTurnOk([...new Set([...railArms(state, ownerId, ax, ay), o])], cornerA)
    && railArmsTurnOk([...new Set([...railArms(state, ownerId, bx, by), (o + 4) % 8])], cornerB);
}

/**
 * Journal the small neighbourhood an explicit link + autotiling may change.
 * Include distance two: an autotiled neighbour can link to its own neighbour.
 * No whole-map copies per tile, and rollback restores reciprocal/diagonal bits,
 * ownership AND revision exactly. Old sharp saves are not rewritten: only a
 * newly gained arm can cause a refusal.
 */
function railEdit(state: RailState, tiles: [number, number][], grid?: Grid) {
  const before = new Map<number, { tile: number; owner: number; arms: number[] }>();
  const revision = state.rail.revision;
  for (const [x, y] of tiles) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (!inMapT(nx, ny)) continue;
      const i = tIdx(nx, ny);
      if (before.has(i)) continue;
      const owner = effectiveOwner(state, nx, ny);
      before.set(i, { tile: state.rail.tile[i], owner: state.rail.owner[i],
        arms: owner ? railArms(state, owner, nx, ny) : [] });
    }
  }
  return {
    tooSharp: () => [...before].some(([i, old]) => {
      const x = i % MAP_W, y = Math.floor(i / MAP_W);
      const owner = effectiveOwner(state, x, y);
      if (!owner) return false;
      const arms = railArms(state, owner, x, y);
      // #429: a newly gained arm may complete a RAMP CORNER — that turn is
      // legal, and the drag build passes the grid so it can see one.
      return arms.some((a) => !old.arms.includes(a))
        && !railArmsTurnOk(arms, grid ? (a, b) => rampCornerAtArms(grid, x, y, a, b) : undefined);
    }),
    crossingRefusal: (track: Track, planned: ReadonlySet<number>, links: ReadonlyMap<number, number>): RailRefusal => {
      for (const [i, old] of before) {
        const x = i % MAP_W, y = Math.floor(i / MAP_W), owner = effectiveOwner(state, x, y);
        if (!owner || (!roadConnectionMask(track, x, y) && !(state.rail.tile[i] & RAIL_OVERPASS))
          || !railArms(state, owner, x, y).some((a) => !old.arms.includes(a))) continue;
        const why = crossingRefusalAt(track, state, owner, x, y, planned, links);
        if (why !== "ok") return why;
      }
      return "ok";
    },
    rollback: () => {
      for (const [i, old] of before) {
        state.rail.tile[i] = old.tile;
        state.rail.owner[i] = old.owner;
      }
      state.rail.revision = revision;
    },
  };
}

/** A read-only build probe: exactly the same joins and prefix as the commit. */
export function previewRailBuild(
  grid: Grid, track: Track, state: RailState, ownerId: number, tiles: [number, number][], gradeSeparated = false,
): RailBuildResult {
  const probe: RailState = { ...state, rail: { ...state.rail,
    tile: state.rail.tile.slice(), owner: state.rail.owner.slice() } };
  return buildRail(grid, track, probe, ownerId, tiles, gradeSeparated);
}

// ── refusals: one vocabulary for the preview, the click, the rival, the host ─
export type RailRefusal =
  | "ok" | "off-map" | "water" | "occupied" | "road-parallel" | "crossing-curve"
  | "diagonal-crossing" | "axis-only"
  | "foreign-rail" | "component-conflict" | "no-anchor" | "anchor-taken"
  | "no-network" | "exit-blocked" | "overlap" | "anchor-range" | "train-in-way"
  | "not-yours" | "missing" | "track-blocked"
  /**
   * #400: the anchor industry is already held. The same refusal a second Depot
   * gets (`industry-taken`) — a platform is a Depot for claiming, never stronger.
   */
  | "industry-taken"
  /** R2 (#266): the tile would hang a side connection on a standing rail bridge. */
  | "bridge-junction"
  | "overpass-stop"
  /** E4 (#268): the step climbs more than `SLOPES.railMaxStep`, or a level
   *  change sits closer than `SLOPES.railRampRun` tiles to another one. */
  | "too-steep"
  /** E4 (#268): a diagonal link across a level change — a corner a train cannot take. */
  | "slope-diagonal"
  /** E4 (#268): a platform's / a rail depot's footprint straddles a level change. */
  | "not-flat"
  /** RAIL-6 (#575): the station already carries four lanes — the maximum. */
  | "max-lanes"
  | "too-sharp";

export const RAIL_REFUSAL_TEXT: Record<RailRefusal, string> = {
  ok: "",
  "off-map": "That is off the map.",
  water: "Rail cannot be laid on water.",
  occupied: "Something else stands there.",
  "diagonal-crossing": "Diagonal tracks cannot cross in an X. Use an axis crossing.",
  "axis-only": "Platforms and train depots need axis-only track; move diagonal bends beyond their lanes.",
  "road-parallel": "Rail may only cross a straight road, never run along it.",
  "crossing-curve": "A crossing needs a straight empty road and a straight rail.",
  "foreign-rail": "That rail belongs to the other player.",
  "component-conflict": "One train per connected network — that would join two running lines.",
  "no-anchor": "A platform must stand within 3 tiles of an industry or your own processing plant.",
  "anchor-taken": "You already have a platform on that industry.",
  "no-network": "A train depot must touch your own rail.",
  "exit-blocked": "The depot's rail exit has nothing to join.",
  overlap: "That footprint overlaps something.",
  "anchor-range": "Too far from the industry — move within 3 tiles of it.",
  "train-in-way": "A train is standing there.",
  "not-yours": "That isn't yours.",
  missing: "That is not there.",
  "track-blocked": "The platform's track side is blocked — turn it (R) or move it.",
  // The Depot click's own sentence (`placeHarvester`), so the two tools refuse
  // a held industry in the same words.
  "industry-taken": "That industry is already claimed — only one Depot may hold it.",
  "bridge-junction": "A bridge stays straight — no track can join its side.",
  "overpass-stop": "Overpasses are straight through; place the platform or depot beyond the deck.",
  // #429: each sentence names the rule AND the fix, so a red tile is never a
  // riddle. (The counts are pinned to `SLOPES.railRampRun` by a unit test.)
  "too-steep": "Too steep — rail needs 2 flat tiles between climbs; end on level ground and climb again.",
  "slope-diagonal": "Diagonals must be level — turn on flat ground, not across a slope.",
  "not-flat": "A flat footprint: the whole site must sit on one level.",
  // RAIL-6 (#575): the station's lane count is capped; the sentence names the
  // cap so an upgrade that cannot happen says why.
  "max-lanes": "That station already has four lanes — the most a station holds.",
  "too-sharp": "Too sharp for rail: turns must be 45° or less",
};

// ── placement: rail tiles ─────────────────────────────────────────────────
/**
 * The bits a tile would end up with if a rail tile were added here.
 *
 * `planned` is the rest of the drag being laid in the same gesture. A crossing
 * is judged on the FINAL shape (the epic's rule), and the tiles either side of a
 * road are laid in the same drag — so a straight run that crosses a straight
 * road is legal while one that stops on the road, or bends over it, is not.
 * A planned neighbour is taken to face back: an adjacent tile in the same drag
 * is laid against this one, and a curve is refused by the straightness test
 * below anyway.
 */
function prospectiveMask(
  state: RailState, tx: number, ty: number, ownerId: number, planned?: ReadonlySet<number>,
): number {
  let mask = state.rail.tile[tIdx(tx, ty)] & RAIL_BITS;
  for (const d of DIRS) {
    const nx = tx + DIR[d][0], ny = ty + DIR[d][1];
    if (!inMapT(nx, ny)) continue;
    if (planned?.has(tIdx(nx, ny))) { mask |= d; continue; }
    if (effectiveOwner(state, nx, ny) !== ownerId) continue;
    if (effectiveMask(state, nx, ny) & OPPOSITE[d]) mask |= d;
  }
  return mask & RAIL_BITS;
}

/** Explicit gesture links, including the two logical reverse diagonals. */
function plannedRailLinks(tiles: readonly (readonly [number, number])[]): Map<number, number> {
  const links = new Map<number, number>();
  for (let i = 1; i < tiles.length; i++) {
    const [ax, ay] = tiles[i - 1], [bx, by] = tiles[i];
    const d = [...DIRS, ...DIAGONAL_DIRS].find((d) => ax + DIR[d][0] === bx && ay + DIR[d][1] === by);
    if (d === undefined || !inMapT(ax, ay) || !inMapT(bx, by)) continue;
    links.set(tIdx(ax, ay), (links.get(tIdx(ax, ay)) ?? 0) | d);
    links.set(tIdx(bx, by), (links.get(tIdx(bx, by)) ?? 0) | OPPOSITE[d]);
  }
  return links;
}

function crossingRefusalAt(track: Track, state: RailState, owner: number, x: number, y: number,
  planned?: ReadonlySet<number>, links?: ReadonlyMap<number, number>): RailRefusal {
  const road = roadConnectionMask(track, x, y);
  const deck = state.rail.tile[tIdx(x, y)] & RAIL_OVERPASS;
  if (deck) {
    const mask = effectiveMask(state, x, y) | (links?.get(tIdx(x, y)) ?? 0);
    if (mask & ~15 || diagNeighbours(state.rail, x, y).length || ![SE | NW, NE | SW].includes(mask)) return "crossing-curve";
  }
  if (!road) return "ok";
  let rail = links ? effectiveMask(state, x, y) | (links.get(tIdx(x, y)) ?? 0)
    : prospectiveMask(state, x, y, owner, planned);
  rail &= ~RAIL_PRESENT;
  for (const d of DIAGONAL_DIRS) if (diagLinked(state.rail, x, y, x + DIR[d][0], y + DIR[d][1])) rail |= d;
  if ((road & ~15) && (rail & ~15)) return "diagonal-crossing";
  if (straightTrackDirection(road) !== undefined && road === rail) return "road-parallel";
  return crossingMasksOk(road & 15, rail & 15, road & ~15, rail & ~15) ? "ok" : "crossing-curve";
}

/** Both endpoints of a proposed link see the other square diagonal, even
 * when the crossing has no shared tile and belongs to a different owner. */
function diagonalConflict(track: Track, state: RailState, tiles: [number, number][], n: number): boolean {
  const [x, y] = tiles[n];
  return [tiles[n - 1], tiles[n + 1]].some((p) => p && isDiagStep(x, y, p[0], p[1])
    && (roadDiagLinked(track, x, p[1], p[0], y) || diagLinked(state.rail, x, p[1], p[0], y)));
}

/**
 * Everything that makes one rail tile illegal — as a CODE, so the preview, the
 * click, the rival AI and a host's validation all answer the same question with
 * the same vocabulary (`RAIL_REFUSAL_TEXT` is the one wording).
 */
export function railTileRefusal(
  grid: Grid, track: Track, state: RailState, ownerId: number, tx: number, ty: number,
  planned?: ReadonlySet<number>,
  bridges?: ReadonlySet<number>,
  links?: ReadonlyMap<number, number>,
): RailRefusal {
  if (!inMapT(tx, ty)) return "off-map";
  // R2 (#266): a tile the drag's own bridge plan covers is RIVER WATER a deck
  // is laid on — legal ground for this one drag (`bridges` is
  // `planBridges(...).runs`), water for every other. Everything below still
  // applies to it: nothing built there, no train on it, no foreign rail.
  if (!railTerrainOk(grid, tx, ty) && !bridges?.has(tIdx(tx, ty))) return "water";
  // R2 (#266): a tile ORTHOGONALLY beside a standing rail bridge would join
  // the deck (own rail joins on connectivity, which is exactly what
  // `autotileRail` computes), and the deck would grow a third arm — a junction
  // on a bridge. `sideJoinAt` reads the deck's own bits, so a join along the
  // deck is still fine (that is how a broken crossing is repaired).
  if (railTerrainOk(grid, tx, ty) && sideJoinAt(
    tx, ty,
    (x, y) => bridgeDeckAt(grid, x, y, (b, c) => sameOwnerRail(state, ownerId, b, c)),
    (x, y) => inMapT(x, y) ? state.rail.tile[tIdx(x, y)] & RAIL_BITS : 0,
  )) return "bridge-junction";
  // Anything built on the tile blocks rail: an industry, a field, a depot, a
  // plant / town building (#298, `builtAt` "plant" — every rotation), a
  // platform, or a train standing on it. Town STREETS are not in that set:
  // they stay crossable like any other straight road.
  if (grid.occupancy[tIdx(tx, ty)] >= 0 || grid.occupancy[tIdx(tx, ty)] === FIELD_OCC) return "occupied";
  if (structureAt(state, tx, ty)) return "occupied";
  const built = grid.builtAt?.(tx, ty);
  if (built === "bridge") {
    // R2 (#266): a deck is built ground — except for the very drag that is
    // bridging there (a re-laid crossing over your own deck reads it back).
    if (!bridges?.has(tIdx(tx, ty))) return "occupied";
  } else if (built === "depot" || built === "plant" || built === "platform" || built === "dam") {
    // R3 (#270): a dam's bank tile is standing ground like a platform's, and
    // its water tile answers "water" above before this is ever reached.
    return "occupied";
  }
  // Stopping lanes stay axis-only even if a later diagonal drag would form
  // an otherwise legal 45-degree WYE at one of their ordinary rail tiles.
  if (((links?.get(tIdx(tx, ty)) ?? 0) & ~15) && state.structures.some((s) => s.kind === "platform"
    && platformTrack(s).some(([x, y]) => x === tx && y === ty))) return "axis-only";
  if (trainOccupies(state, tx, ty)) return "train-in-way";
  const owner = state.rail.owner[tIdx(tx, ty)];
  if ((state.rail.tile[tIdx(tx, ty)] & RAIL_PRESENT) && owner !== ownerId) return "foreign-rail";
  const crossing = crossingRefusalAt(track, state, ownerId, tx, ty, planned, links);
  if (crossing !== "ok") return crossing;
  // E4 (#268): the slope step to every tile this one would JOIN — a planned
  // tile of the same drag, or the owner's standing rail (the same connection
  // model `prospectiveMask` uses). The drag's own SHAPE rules (the ramp run and
  // diagonals on a slope) are a property of the gesture, not of a tile, and are
  // judged by `railDragSlopeRefusals` in the preview, `buildRail` and the
  // rival's `validateRailDrag`.
  const steep = railJoinSlopeRefusal(grid, tx, ty, (x, y) =>
    inMapT(x, y) && (!!planned?.has(tIdx(x, y)) || sameOwnerRail(state, ownerId, x, y)));
  if (steep) return steep;
  // A standalone tile still auto-links. Whole drags probe incrementally in
  // buildRail, with their explicit links and planned diagonals in hand.
  if (!planned) {
    const why = previewRailBuild(grid, track, state, ownerId, [[tx, ty]]).why;
    if (why !== "ok") return why;
  }
  return "ok";
}

function writeRailTile(state: RailState, ownerId: number, tx: number, ty: number): void {
  const i = tIdx(tx, ty);
  // Your own tile keeps the links it had (diagonal AND orthogonal) — a drag
  // over your own line never unhooks it.
  const keep = state.rail.owner[i] === ownerId ? state.rail.tile[i] & (RAIL_DIAG | RAIL_BITS | RAIL_OVERPASS) : 0;
  state.rail.tile[i] = RAIL_PRESENT | keep;
  state.rail.owner[i] = ownerId;
}

/**
 * Is (x,y) part of `ownerId`'s rail for autotiling purposes — an own layer tile,
 * or one of its own structures' LANE tiles?
 *
 * Bits are computed from CONNECTEDNESS, never from the neighbour's own bits:
 * two adjacent own tiles always join, so asking "does my neighbour have a bit
 * pointing at me?" would be circular (neither has one yet on the frame it is
 * laid). Structure lanes join the same way — the lane's port bits are part of
 * its effective mask — which is how a player-built tile links up with a
 * platform's port or a depot's exit without either side knowing the other.
 */
function sameOwnerRail(state: RailState, ownerId: number, x: number, y: number): boolean {
  if (!inMapT(x, y)) return false;
  const s = structureAt(state, x, y);
  if (s) return s.ownerId === ownerId && laneMaskAt(s, x, y) !== 0;
  return (state.rail.tile[tIdx(x, y)] & RAIL_PRESENT) !== 0 && state.rail.owner[tIdx(x, y)] === ownerId;
}

/**
 * #429 — how much FLAT RUN the owner's standing rail carries INTO (tx,ty), in
 * tile-levels: walk the standing line away from the tile (four-adjacent own
 * rail, the same join set `railJoinSlopeRefusal` reads — and the same one the
 * autotiler will connect on commit) and count the level tiles before the
 * first LEVEL CHANGE on it. 0 means the line changes level at the join; the
 * answer saturates at `SLOPES.railRampRun - 1`, because past that much run a
 * change at the far end can no longer be too tight. Tiles of the drag itself
 * (`exclude`) are not walked: a drag that re-draws part of its own line must
 * measure the standing rail BEHIND the join, not its own tiles ahead of it.
 *
 * Fed to `railDragSlopeVerdict` at both ends of a drag, this is what lets the
 * ramp rule count ACROSS the joins — two drags compose as one line, so
 * "climb, one tile, climb" cannot be smuggled through as two drags of
 * "climb, climb, stop" each half legal on its own.
 */
export function railJoinRunAt(
  grid: Grid, state: RailState, ownerId: number, tx: number, ty: number,
  exclude?: ReadonlySet<number>,
): number {
  if (!elevationActive(grid)) return SLOPES.railRampRun - 1;
  const LIMIT = SLOPES.railRampRun - 1;
  let best = LIMIT;
  const seen = new Set<number>([tIdx(tx, ty), ...(exclude ?? [])]);
  const walk = (x: number, y: number, depth: number): void => {
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = x + dx, ny = y + dy;
      if (!inMapT(nx, ny)) continue;
      const i = tIdx(nx, ny);
      if (seen.has(i)) continue;
      if (!sameOwnerRail(state, ownerId, nx, ny)) continue;
      if (Math.abs(climbLevels(grid, [x, y], [nx, ny])) >= 1) best = Math.min(best, depth);
      else if (depth + 1 < LIMIT) { seen.add(i); walk(nx, ny, depth + 1); }
    }
  };
  walk(tx, ty, 0);
  return best;
}

/**
 * #429 — the drag's slope run CONTEXT: the flat run the player's standing
 * rail carries into each end of the drag (`railJoinRunAt`, with the drag's own
 * tiles excluded). Returned for `railDragSlopeVerdict`'s fourth parameter, so
 * the ramp rule judges a drag and the standing line together. Undefined on a
 * map without elevation and for a one-tile gesture, which has no run to keep.
 */
const slopeRunAtEnds = (grid: Grid, state: RailState, ownerId: number,
  tiles: readonly (readonly [number, number])[],
): RailSlopeRun | undefined => {
  if (!elevationActive(grid) || tiles.length < 2) return undefined;
  const planned = new Set(tiles.map(([x, y]) => tIdx(x, y)));
  const a = tiles[0], b = tiles[tiles.length - 1];
  return {
    before: railJoinRunAt(grid, state, ownerId, a[0], a[1], planned),
    after: railJoinRunAt(grid, state, ownerId, b[0], b[1], planned),
  };
};

/**
 * #429 — rail's turn rule for a drag path and its trains: two consecutive
 * steps may differ by at most 45° (`turnOk`), except for the RAMP CORNER — a
 * 90° turn between axis steps where the shared tile touches a level change
 * (the hillside's only other way to turn, and what makes a switchback
 * drawable). No grid, or an elevation-off map: the rule is exactly the 45°
 * one it always was.
 */
export function railTurnOkGrid(
  grid: Grid | undefined, prev: readonly [number, number],
  cur: readonly [number, number], next: readonly [number, number],
): boolean {
  return turnOk(
    octantOf(cur[0] - prev[0], cur[1] - prev[1]),
    octantOf(next[0] - cur[0], next[1] - cur[1]),
  ) || railRampCornerOk(grid, prev, cur, next);
}

/**
 * Recompute the four bits of every rail tile in and around `tiles` — the same
 * "only the tile plus its neighbours" discipline `track.ts` uses, so a drag of
 * twenty tiles is twenty small writes and never a map scan.
 */
function proposeRailAutolinks(
  state: RailState, tiles: [number, number][], plannedDiag?: ReadonlySet<number>,
): void {
  const touched = new Set<number>();
  for (const [x, y] of tiles) {
    touched.add(tIdx(x, y));
    for (const d of DIRS) {
      const nx = x + DIR[d][0], ny = y + DIR[d][1];
      if (inMapT(nx, ny)) touched.add(tIdx(nx, ny));
    }
  }
  // Playtest (2026-09): two tiles side by side join on their own ONLY when
  // neither is part of a diagonal. A diagonal line passes right beside other
  // rail at every step, and joining it there would draw 90° stubs and open
  // shortcuts nobody laid — so those tiles join where the drag joined them
  // (the bits `buildRail` writes and this keeps while the neighbour stands).
  const onDiag = (x: number, y: number) =>
    inMapT(x, y) && (state.rail.tile[tIdx(x, y)] & RAIL_PRESENT) !== 0
    && (plannedDiag?.has(tIdx(x, y)) || diagNeighbours(state.rail, x, y).length > 0);
  for (const i of touched) {
    if (!(state.rail.tile[i] & RAIL_PRESENT)) continue;
    const x = i % MAP_W, y = (i / MAP_W) | 0;
    const old = state.rail.tile[i];
    const here = onDiag(x, y);
    let mask = 0;
    for (const d of DIRS) {
      const nx = x + DIR[d][0], ny = y + DIR[d][1];
      if (!sameOwnerRail(state, state.rail.owner[i], nx, ny)) continue;
      // …or when the join carries a straight line on (either tile already runs
      // that way), which is how a re-laid tile rejoins the line it was cut from.
      const straightOn = (old & OPPOSITE[d]) !== 0 || (state.rail.tile[tIdx(nx, ny)] & d) !== 0;
      if ((old & d) || structureAt(state, nx, ny) || straightOn || (!here && !onDiag(nx, ny))) mask |= d;
    }
    state.rail.tile[i] = mask | RAIL_PRESENT | (old & (RAIL_DIAG | RAIL_OVERPASS));
  }
  state.rail.revision++;
}

/** Structure/demolition auto-link entry point: never introduce a sharp join. */
export function autotileRail(state: RailState, tiles: [number, number][]): void {
  const edit = railEdit(state, tiles);
  proposeRailAutolinks(state, tiles);
  if (edit.tooSharp()) {
    edit.rollback();
    // The caller may already have added/removed a structure or tile. Its
    // graph change still invalidates routes even though these links refused.
    state.rail.revision++;
  }
}

export interface RailBuildResult {
  ok: boolean;
  why: RailRefusal;
  cost: Purse;
  built: [number, number][];
}

/**
 * Lay a drag's worth of rail, in order. Each tile is judged on its own — a drag
 * stops at the first illegal tile, exactly like the road drag — and the accepted
 * run is autotiled once, so the bits are always the mutual ones.
 *
 * ONE TRAIN PER COMPONENT is enforced here as a MERGE rule: if the new tiles
 * would join two components that each already hold a train, the tile that does
 * the joining is refused (`component-conflict`) and rolled back. That is the
 * "reject a merge that violates the limit" clause of the ticket, at the one
 * place where a merge can happen.
 */
function railGradeCrossing(track: Track, tiles: [number, number][], n: number): boolean {
  const a = tiles[n - 1], b = tiles[n], c = tiles[n + 1];
  if (!a || !c || roadRailDeckAxis(track.tier?.[tIdx(...b)] ?? 0)) return false;
  const road = roadConnectionMask(track, ...b);
  return road === (SE | NW) ? a[0] === b[0] && c[0] === b[0] && a[1] + c[1] === 2 * b[1] && Math.abs(a[1] - b[1]) === 1
    : road === (NE | SW) ? a[1] === b[1] && c[1] === b[1] && a[0] + c[0] === 2 * b[0] && Math.abs(a[0] - b[0]) === 1 : false;
}
function railGradeFlat(grid: Grid, tiles: [number, number][], n: number): boolean {
  const h = heightAt(grid, ...tiles[n]);
  return [tiles[n - 1], tiles[n + 1]].every((p) => p && grid.terrain[tIdx(...p)] !== WATER && heightAt(grid, ...p) === h);
}

export function buildRail(
  grid: Grid, track: Track, state: RailState, ownerId: number, tiles: [number, number][], gradeSeparated = false,
): RailBuildResult {
  // A refused diagonal tail no longer suppresses auto-links on the last
  // accepted tile. Re-evaluate a shortened gesture in its OWN shape, just as
  // game.ts will build preview.tiles. Each retry strictly shortens the prefix.
  const original = { tile: state.rail.tile.slice(), owner: state.rail.owner.slice(),
    revision: state.rail.revision };
  let candidate = tiles, why: RailRefusal = "ok";
  if (gradeSeparated) {
    const stacked = ([x, y]: [number, number]) => [OVERPASS_X, OVERPASS_Y].includes(roadTierAt(track, x, y));
    const bad = tiles.findIndex((tile, n) => !(original.tile[tIdx(...tile)] & RAIL_PRESENT)
      && (stacked(tile) || (railGradeCrossing(track, tiles, n) && !railGradeFlat(grid, tiles, n))));
    if (bad >= 0) { candidate = tiles.slice(0, bad); why = stacked(tiles[bad]) ? "crossing-curve" : "too-steep"; }
  }
  for (;;) {
    const result = buildRailAttempt(grid, track, state, ownerId, candidate);
    if (result.why === "ok") {
      if (gradeSeparated) for (let n = 0; n < result.built.length; n++) {
        const [x, y] = result.built[n], i = tIdx(x, y);
        if ((original.tile[i] & RAIL_PRESENT) || !railGradeCrossing(track, result.built, n)) continue;
        state.rail.tile[i] |= RAIL_OVERPASS;
        result.cost = addCost(result.cost, OVERPASS_COST);
      }
      return { ...result, why };
    }
    why = result.why;
    if (!result.built.length) return result;
    state.rail.tile.set(original.tile);
    state.rail.owner.set(original.owner);
    state.rail.revision = original.revision;
    candidate = result.built;
  }
}

function buildRailAttempt(
  grid: Grid, track: Track, state: RailState, ownerId: number, tiles: [number, number][],
): RailBuildResult {
  const built: [number, number][] = [];
  // The merge guard can only ever fire with two or more trains on the map, so a
  // player who owns none pays no component scan per tile at all.
  const guardMerge = trainsOf(state, ownerId).length > 1;
  // The whole gesture is the "final shape" a crossing is judged against.
  const planned = new Set(tiles.map(([x, y]) => tIdx(x, y)));
  const links = plannedRailLinks(tiles);
  // R2 (#266): …and the whole gesture is the bridge, too — a deck exists only
  // as part of a straight crossing with both banks inside this same drag.
  const bridgePlan = railBridgePlan(grid, track, state, ownerId, tiles, planned);
  const bridgeTiles = bridgePlan.deckTiles;      // TILE indices — see `BridgePlan`
  // E4 (#268): the drag's slope SHAPE — the ramp run and the no-diagonal-on-a-
  // slope rule. Like the bridge plan it is a property of the whole gesture, and
  // a deck (bridge) is exempt because its approach is the bridge's own ramp.
  // #429: the verdict separates the tiles the drag may not ENTER (it stops at
  // the first one) from every tile of a bad step (the red ones), and the ramp
  // run is counted across the joins — the standing line that feeds this drag
  // at either end — so two drags compose as one line.
  const slopeWhy = railDragSlopeVerdict(grid, tiles, bridgeTiles, slopeRunAtEnds(grid, state, ownerId, tiles));
  // The drag's tiles that will carry a diagonal link, known up front so the
  // first tile of a diagonal never joins its side neighbours on its own.
  const plannedDiag = new Set<number>();
  for (let n = 1; n < tiles.length; n++) {
    if (!isDiagStep(tiles[n - 1][0], tiles[n - 1][1], tiles[n][0], tiles[n][1])) continue;
    plannedDiag.add(tIdx(tiles[n - 1][0], tiles[n - 1][1]));
    plannedDiag.add(tIdx(tiles[n][0], tiles[n][1]));
  }
  let charged = 0;
  let decks = 0;
  for (let n = 0; n < tiles.length; n++) {
    const [tx, ty] = tiles[n];
    if (n > 0 && (Math.max(Math.abs(tx - tiles[n - 1][0]), Math.abs(ty - tiles[n - 1][1])) !== 1
      || (n > 1 && !railTurnOkGrid(grid, tiles[n - 2], tiles[n - 1], tiles[n])))) {
      return { ok: built.length > 0, why: "too-sharp", cost: railCostOf(charged, decks), built };
    }
    const why = slopeWhy.blocks.get(n)
      ?? (diagonalConflict(track, state, tiles, n) ? "diagonal-crossing"
        : railTileRefusal(grid, track, state, ownerId, tx, ty, planned, bridgeTiles, links));
    if (why !== "ok") return { ok: built.length > 0, why, cost: railCostOf(charged, decks), built };
    // Rail you already own is stepped over for free — a drag that redraws part
    // of an existing line (or crosses its own track at a junction) pays only
    // for the new tiles, exactly like a road drag over your own road.
    const already = (state.rail.tile[tIdx(tx, ty)] & RAIL_PRESENT) !== 0
      && state.rail.owner[tIdx(tx, ty)] === ownerId;
    const edit = railEdit(state, [[tx, ty]], grid);
    writeRailTile(state, ownerId, tx, ty);
    // A diagonal step from the previous tile of the drag is a diagonal link.
    const prev = n > 0 ? tiles[n - 1] : null;
    const link = prev && built.length > 0 && isDiagStep(prev[0], prev[1], tx, ty)
      ? diagSlot(prev[0], prev[1], tx, ty) : null;
    if (link) state.rail.tile[link.i] |= link.bit;
    // An orthogonal step of the drag is an explicit join too (it must hold
    // even where one end sits on a diagonal).
    const ortho = prev && built.length > 0 && Math.abs(prev[0] - tx) + Math.abs(prev[1] - ty) === 1
      ? DIRS.find((d) => prev[0] + DIR[d][0] === tx && prev[1] + DIR[d][1] === ty) : undefined;
    if (ortho !== undefined && prev) {
      state.rail.tile[tIdx(prev[0], prev[1])] |= ortho;
      state.rail.tile[tIdx(tx, ty)] |= OPPOSITE[ortho];
    }
    proposeRailAutolinks(state, [[tx, ty]], plannedDiag);
    const crossingWhy = edit.crossingRefusal(track, planned, links);
    if (crossingWhy !== "ok") {
      edit.rollback();
      return { ok: built.length > 0, why: crossingWhy, cost: railCostOf(charged, decks), built };
    }
    if (edit.tooSharp()) {
      edit.rollback();
      return { ok: built.length > 0, why: "too-sharp", cost: railCostOf(charged, decks), built };
    }
    if (!guardMerge) {
      if (!already) { charged++; if (bridgeTiles.has(tIdx(tx, ty))) decks++; }
      built.push([tx, ty]); continue;
    }
    const comp = railComponents(state, ownerId);
    const here = comp.get(tIdx(tx, ty)) ?? 0;
    const trainsHere = state.trains.filter((t) => {
      if (t.ownerId !== ownerId) return false;
      const home = depotOfTrain(state, t);
      if (!home) return false;
      const exit = depotExit(home);
      return (comp.get(tIdx(exit.tx, exit.ty)) ?? 0) === here;
    });
    if (trainsHere.length > 1) {
      edit.rollback();
      return { ok: built.length > 0, why: "component-conflict", cost: railCostOf(charged, decks), built };
    }
    if (!already) { charged++; if (bridgeTiles.has(tIdx(tx, ty))) decks++; }
    built.push([tx, ty]);
  }
  // `charged`, not `built.length`: a drag that redraws rail you already own
  // lays tiles but pays for none of them. R2 (#266): the charged tiles that
  // stand on water are decks and are quoted at the deck price.
  return { ok: built.length > 0, why: "ok", cost: railCostOf(charged, decks), built };
}

/**
 * R2 (#266): the rail drag's bridge plan, with the railway's own predicates —
 * "this layer carries track" is own rail or an own structure lane (journalled
 * for autotiling), and "the other layer" is any road tier, because a deck is
 * never shared with the road. Shared by `railPreview`, `buildRail` and the
 * rival's `validateRailDrag`, so the player and the AI cross rivers by the one
 * rule.
 */
export function railBridgePlan(
  grid: Grid, track: Track, state: RailState, ownerId: number,
  tiles: readonly (readonly [number, number])[],
  planned: ReadonlySet<number>,
): BridgePlan {
  return planBridges(
    grid, tiles,
    (x, y) => inMapT(x, y) && (sameOwnerRail(state, ownerId, x, y) || planned.has(tIdx(x, y))),
    (x, y) => inMapT(x, y) && mergedPresent(track, x, y),
  );
}

/** Tear up one rail tile: bits recomputed, nothing else on the map touched. */
/**
 * The drag preview for the rail tool, shaped exactly like `previewDrag`'s
 * (`DragPreview`) so the overlay painter, the hover highlight, the cost label
 * and the truncation marker all read it without knowing it is rail at all.
 *
 * Differences from the road preview, all of them the epic's rules:
 *   • `free` is always 0 — the setup allowance is for road (`#142`: rail costs
 *     1 Stone a tile from the first tile);
 *   • a tile the player ALREADY owns is stepped over free, so redrawing part of
 *     a line costs nothing;
 *   • the run stops at the first refused tile (`why`, in the shared refusal
 *     vocabulary), and only the refused tiles are marked — but #429 came
 *     before the refusal: a line that breaks a SLOPE rule first asks the
 *     slope-aware search for a legal line between the same endpoints, so a
 *     switchback on a hill is drawn, not refused. Obstacles (buildings, the
 *     rival's rail, water a bridge cannot span) still simply cut the drag
 *     short, as they always did;
 *   • a crossing is judged on the drag's FINAL shape, so `planned` is the whole
 *     gesture, not the tiles laid so far.
 */
/** The rail drag preview: `DragPreview` plus the refusal that stopped it. */
export interface RailPreviewResult extends DragPreview {
  /** Why the drag stopped short, in the shared refusal vocabulary (null = all clear). */
  why: RailRefusal | null;
}

export function railPreview(
  grid: Grid, track: Track, state: RailState, ownerId: number, purse: Purse,
  ax: number, ay: number, bx: number, by: number, xFirst = true, gradeSeparated = false,
): RailPreviewResult {
  // #429: the drag's line. The gesture drawn between the endpoints is the
  // first candidate; when it breaks a slope rule the search asks the better
  // question — is there ANY legal line between these two tiles? — and takes
  // it when one exists (a switchback finds itself). Only when none does,
  // within the bound, the drag refuses — and it marks only the offending
  // tile, never the whole line. A drawn line crossing water is a bridge
  // attempt, not a routing request: `planBridges` stays its judge.
  let path = octPath(ax, ay, bx, by, xFirst);
  let planned = new Set(path.map(([x, y]) => tIdx(x, y)));
  // R2 (#266): the drag's crossing — the deck tiles, and the price each buys.
  let bridgePlan = railBridgePlan(grid, track, state, ownerId, path, planned);
  let bridgeTiles = bridgePlan.deckTiles;        // TILE indices — see `BridgePlan`
  // E4 (#268) + #429: the drag's slope shape, judged once for the whole
  // gesture — the ramp run (counted ACROSS the joins with standing rail) and
  // the no-diagonal-on-a-slope rule.
  let run = slopeRunAtEnds(grid, state, ownerId, path);
  let slope = railDragSlopeVerdict(grid, path, bridgeTiles, run);
  if (slope.blocks.size && elevationActive(grid)
    && !path.some(([x, y]) => !railTerrainOk(grid, x, y))) {
    const routed = routeRailSlope(grid, ax, ay, bx, by, {
      runBefore: run?.before,
      impassable: (x, y) => {
        if (!railTerrainOk(grid, x, y)) return true;
        const i = tIdx(x, y);
        if (grid.occupancy[i] >= 0 || grid.occupancy[i] === FIELD_OCC) return true;
        if (structureAt(state, x, y) || grid.builtAt?.(x, y)) return true;
        if ((state.rail.tile[i] & RAIL_PRESENT) !== 0 && state.rail.owner[i] !== ownerId) return true;
        return false;
      },
    });
    if (routed) {
      const rPlanned = new Set(routed.map(([x, y]) => tIdx(x, y)));
      const rRun = slopeRunAtEnds(grid, state, ownerId, routed);
      const rSlope = railDragSlopeVerdict(grid, routed, undefined, rRun);
      if (!rSlope.flags.size && !rSlope.blocks.size) {
        path = routed; planned = rPlanned; run = rRun; slope = rSlope;
        bridgePlan = railBridgePlan(grid, track, state, ownerId, path, planned);
        bridgeTiles = bridgePlan.deckTiles;
      }
    }
  }
  const probe = previewRailBuild(grid, track, state, ownerId, path, gradeSeparated);
  const links = plannedRailLinks(path);
  const slopeWhy = slope;
  const tiles: [number, number][] = [];
  const unaffordable: [number, number][] = [];
  const blocked: [number, number][] = [];
  let cost: Purse = {};
  let decks = 0;
  let why: RailRefusal | null = null;
  let truncated = false;
  const noteObstacle = (from: number, firstWhy: RailRefusal) => {
    why = firstWhy;
    truncated = true;
    blocked.push(path[from]);
    for (let j = from + 1; j < path.length; j++) {
      const [bx, by] = path[j];
      if (railTileRefusal(grid, track, state, ownerId, bx, by, planned, bridgeTiles, links) === "ok") break;
      blocked.push([bx, by]);
    }
  };
  for (let i = 0; i < path.length; i++) {
    const [x, y] = path[i];
    const already = (state.rail.tile[tIdx(x, y)] & RAIL_PRESENT) !== 0
      && state.rail.owner[tIdx(x, y)] === ownerId;
    if (i === probe.built.length && probe.why !== "ok") { noteObstacle(i, probe.why); break; }
    const shape = slopeWhy.blocks.get(i);
    if (shape) { noteObstacle(i, shape); break; }
    if (!already) {
      const refusal = railTileRefusal(grid, track, state, ownerId, x, y, planned, bridgeTiles, links);
      if (refusal !== "ok") { noteObstacle(i, refusal); break; }
      // R2 (#266): a deck tile pays the deck price; everything else pays the
      // flat rail tile, exactly as before.
      const base = bridgeTiles.has(tIdx(x, y)) ? RAIL_COSTS.bridge : RAIL_COSTS.rail;
      const grade = gradeSeparated && railGradeCrossing(track, path, i);
      const next = addCost(cost, grade ? addCost(base, OVERPASS_COST) : base);
      if (!canPay(purse, next)) {
        // Everything from here on is what the purse cannot reach: the overlay
        // paints it as "not this drag", exactly like the road preview.
        for (let j = i; j < path.length; j++) {
          const [ux, uy] = path[j];
          const tail = railTileRefusal(grid, track, state, ownerId, ux, uy, planned, bridgeTiles, links);
          // The purse already stopped the drag; the obstacle only paints the
          // tiles it claims. Don't invent a refusal the affordable prefix
          // didn't hit.
          if (tail !== "ok") {
            truncated = true;
            for (let k = j; k < path.length; k++) {
              const [bx, by] = path[k];
              if (railTileRefusal(grid, track, state, ownerId, bx, by, planned, bridgeTiles, links) === "ok") break;
              blocked.push([bx, by]);
            }
            break;
          }
          unaffordable.push([ux, uy]);
        }
        break;
      }
      cost = next;
      if (bridgeTiles.has(tIdx(x, y))) decks++;
    }
    tiles.push([x, y]);
  }
  // Affordability can also cut off a planned diagonal (or a bridge). The
  // preview must quote the prefix that the click can actually commit.
  if (unaffordable.length && tiles.length) {
    const prefix = previewRailBuild(grid, track, state, ownerId, tiles, gradeSeparated);
    if (prefix.built.length < tiles.length) {
      noteObstacle(prefix.built.length, prefix.why);
      tiles.splice(prefix.built.length);
      cost = prefix.cost;
      decks = tiles.filter(([x, y]) => bridgeTiles.has(tIdx(x, y))
        && !railOpenTo(state.rail, ownerId, x, y)).length;
    }
  }
  return { tiles, cost, upgrades: 0, free: 0, bridges: decks, unaffordable, blocked, truncated, why };
}

export function demolishRail(state: RailState, tx: number, ty: number): boolean {
  if (!hasRail(state.rail, tx, ty)) return false;
  if (trainOccupies(state, tx, ty)) return false;
  state.rail.tile[tIdx(tx, ty)] = 0;
  state.rail.owner[tIdx(tx, ty)] = 0;
  if (inMapT(tx - 1, ty + 1)) state.rail.tile[tIdx(tx - 1, ty + 1)] &= ~RAIL_DE;
  if (inMapT(tx - 1, ty - 1)) state.rail.tile[tIdx(tx - 1, ty - 1)] &= ~RAIL_DS;
  autotileRail(state, [[tx, ty]]);
  return true;
}

// ── placement: platforms ──────────────────────────────────────────────────
export interface AnchorCandidate {
  kind: "industry" | "plant";
  id: number;
  tiles: [number, number][];
  label: string;
  /** Manhattan distance from the nearest footprint tile to the nearest anchor tile. */
  distance: number;
}

/**
 * Which industries / owned plants may anchor a platform at this footprint
 * (Manhattan distance ≤ 3 from a footprint cell to an anchor footprint cell),
 * nearest first so a caller that wants a default can take `[0]`. More than one
 * may qualify — the player picks, which is why this returns a list.
 */
export function anchorCandidates(
  grid: Grid,
  factories: { ownerId: number; tx: number; ty: number; id?: number; rot?: number }[],
  ownerId: number, tx: number, ty: number, view: RailView,
): AnchorCandidate[] {
  const [w, h] = PLATFORM_FOOTPRINT[view];
  // F4 (#275): the plant block this map plays with — the shapes option's long
  // footprint where the grid carries one, the legacy square otherwise.
  const fp = factoryFootprintOf(grid);
  const mine: [number, number][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mine.push([tx + x, ty + y]);
  const dist = (tiles: [number, number][]): number => {
    let best = Infinity;
    for (const [ax, ay] of tiles) {
      for (const [mx, my] of mine) best = Math.min(best, Math.abs(ax - mx) + Math.abs(ay - my));
    }
    return best;
  };
  const out: AnchorCandidate[] = [];
  for (const ind of grid.industries) {
    const tiles: [number, number][] = [];
    for (let y = 0; y < ind.h; y++) for (let x = 0; x < ind.w; x++) tiles.push([ind.tx + x, ind.ty + y]);
    const d = dist(tiles);
    if (d > ANCHOR_RANGE) continue;
    out.push({
      kind: "industry", id: ind.id, tiles, distance: d,
      label: INDUSTRY_BY_KEY[ind.type]?.name ?? ind.type,
    });
  }
  for (const f of factories) {
    if (f.ownerId !== ownerId) continue;                 // owned plants only
    const tiles = plantFootprintTiles(f.tx, f.ty, f.rot ?? 0, fp);
    const d = dist(tiles);
    if (d > ANCHOR_RANGE) continue;
    out.push({ kind: "plant", id: f.id ?? 0, tiles, label: "Processing Plant", distance: d });
  }
  return out.sort((a, b) => a.distance - b.distance || a.kind.localeCompare(b.kind) || a.id - b.id);
}

export function overlaps(
  s: Pick<RailStructure, "tx" | "ty" | "w" | "h">, tx: number, ty: number, w: number, h: number,
): boolean {
  return tx < s.tx + s.w && s.tx < tx + w && ty < s.ty + s.h && s.ty < ty + h;
}

/**
 * The one anchor rule: a platform anchors to exactly one INDUSTRY or one owned
 * PLANT within range, and a player may hold only ONE platform per anchor
 * ("one platform per player per anchor"). The player selects the anchor when
 * more than one qualifies, so an explicit `anchor` is checked against the
 * candidate list rather than trusted.
 */
export function platformRefusal(
  grid: Grid, structures: RailStructure[],
  factories: { ownerId: number; tx: number; ty: number; id?: number; rot?: number }[],
  ownerId: number, tx: number, ty: number, view: RailView,
  anchor?: RailAnchor | null,
  /**
   * #400: industry ids this seat may not claim — `lockedIndustryIdsFor` in
   * economy.ts, the same set `planDepotPlacement` refuses a second Depot
   * against. A platform anchored to one of them is `industry-taken`. Omitted
   * only for a geometry probe (a line fixture, a slope check); the click, the
   * host and the rival always pass it, so a platform is never stronger than
   * a Depot.
   */
  locked?: ReadonlySet<number>,
  rail?: Rail,
): RailRefusal {
  if (!RAIL_VIEWS.includes(view)) return "axis-only";
  if (!inMapT(tx, ty)) return "off-map";
  const [w, h] = PLATFORM_FOOTPRINT[view];
  if (!inMapT(tx + w - 1, ty + h - 1)) return "off-map";
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!railTerrainOk(grid, tx + x, ty + y)) return "water";
    if (grid.occupancy[tIdx(tx + x, ty + y)] >= 0 || grid.occupancy[tIdx(tx + x, ty + y)] === FIELD_OCC) return "occupied";
    // Nothing else built there: a Depot lot, a plant / town building, or anyone's rail.
    // R3 (#270): a dam's footprint is standing ground too.
    const b = grid.builtAt?.(tx + x, ty + y);
    if (b === "depot" || b === "plant" || b === "platform" || b === "bridge" || b === "dam"
      || b === "rail" || b === "rail-x" || b === "rail-y") return "occupied";
  }
  if (structures.some((s) => overlaps(s, tx, ty, w, h))) return "overlap";
  if (rail && platformTrackAt(tx, ty, view).some(([x, y]) => !!(rail.tile[tIdx(x, y)] & RAIL_OVERPASS))) return "overpass-stop";
  if (rail && platformTrackAt(tx, ty, view).some(([x, y]) => diagNeighbours(rail, x, y).length > 0)) return "axis-only";
  // The track side must be free to lay the three stopping tiles on.
  for (const [x, y] of platformTrackAt(tx, ty, view)) {
    if (!railTerrainOk(grid, x, y)) return "track-blocked";
    if (grid.occupancy[tIdx(x, y)] >= 0 || grid.occupancy[tIdx(x, y)] === FIELD_OCC) return "track-blocked";
    if (structures.some((s) => overlaps(s, x, y, 1, 1))) return "track-blocked";
    const side = grid.builtAt?.(x, y);
    if (side === "depot" || side === "plant" || side === "platform" || side === "bridge"
      || side === "dam") return "track-blocked";
  }
  // E4 (#268): a platform's 1×3 (or 3×1) needs level ground — the art is drawn
  // on one plane and its lane sits at the footprint's own height.
  const off = footprintFlatTiles(grid, footprintTiles({ tx, ty, w, h }));
  if (off) return "not-flat";
  const candidates = anchorCandidates(grid, factories, ownerId, tx, ty, view);
  if (!candidates.length) return "no-anchor";
  const chosen = anchor
    ? candidates.find((c) => c.kind === anchor.kind && c.id === anchor.id)
    : candidates[0];
  if (!chosen) return "anchor-range";
  const taken = structures.some((s) => s.kind === "platform" && s.ownerId === ownerId
    && s.anchor && s.anchor.kind === chosen.kind && s.anchor.id === chosen.id);
  if (taken) return "anchor-taken";
  // #400: the chosen industry is already held, and this seat has no battle
  // rights to it. A plant anchor holds nothing, so it is never this refusal.
  // Checked after `anchor-taken` so "you already have one here" stays the
  // more specific sentence when both apply.
  if (chosen.kind === "industry" && locked?.has(chosen.id)) return "industry-taken";
  return "ok";
}

/** The anchor a placement will actually record, given an explicit preference. */
export function resolveAnchor(
  grid: Grid, factories: { ownerId: number; tx: number; ty: number; id?: number; rot?: number }[],
  ownerId: number, tx: number, ty: number, view: RailView, prefer?: RailAnchor | null,
): RailAnchor | null {
  const candidates = anchorCandidates(grid, factories, ownerId, tx, ty, view);
  const chosen = prefer
    ? candidates.find((c) => c.kind === prefer.kind && c.id === prefer.id)
    : candidates[0];
  return chosen ? { kind: chosen.kind, id: chosen.id, tiles: chosen.tiles } : null;
}

export function placePlatform(
  state: RailState, owner: string, ownerId: number,
  tx: number, ty: number, view: RailView, anchor: RailAnchor | null,
): RailStructure {
  const [w, h] = PLATFORM_FOOTPRINT[view];
  const s: RailStructure = {
    id: state.seq++, kind: "platform", ownerId, owner, tx, ty, w, h, view, anchor: anchor ?? null,
  };
  state.structures.push(s);
  autotileRail(state, laneTiles(s));
  return s;
}

/**
 * Lay a new platform's three stopping tiles as ordinary rail, free (they are
 * part of the platform's price). Tiles a rule refuses (a road, say) are left
 * for the player to sort out.
 */
export function layPlatformTrack(grid: Grid, track: Track, state: RailState, s: RailStructure): void {
  const row = platformTrack(s);
  buildRail(grid, track, state, s.ownerId, row);
}

// ── placement: depots ─────────────────────────────────────────────────────
/**
 * A depot may stand anywhere legal as long as its declared EXIT joins the
 * owner's existing rail, and nothing blocks the lane. That is the epic's "build
 * a Train Depot attached to the network": an unconnected depot would be a shed
 * with no track, and its train could never leave.
 */
export function depotRefusal(
  grid: Grid, state: RailState, ownerId: number, tx: number, ty: number, view: RailView,
): RailRefusal {
  if (!RAIL_VIEWS.includes(view)) return "axis-only";
  if (!inMapT(tx, ty)) return "off-map";
  const [w, h] = DEPOT_FOOTPRINT;
  if (!inMapT(tx + w - 1, ty + h - 1)) return "off-map";
  if (footprintTiles({ tx, ty, w, h }).some(([x, y]) => !!(state.rail.tile[tIdx(x, y)] & RAIL_OVERPASS))) return "overpass-stop";
  if (footprintTiles({ tx, ty, w, h }).some(([x, y]) => diagNeighbours(state.rail, x, y).length > 0)) return "axis-only";
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!railTerrainOk(grid, tx + x, ty + y)) return "water";
    if (grid.occupancy[tIdx(tx + x, ty + y)] >= 0 || grid.occupancy[tIdx(tx + x, ty + y)] === FIELD_OCC) return "occupied";
    // #298: a rail depot does not stand on a plant, a town building, a truck
    // Depot lot, or rail that is already there.
    const b = grid.builtAt?.(tx + x, ty + y);
    if (b === "depot" || b === "plant" || b === "platform" || b === "bridge"
      || b === "dam" || b === "rail" || b === "rail-x" || b === "rail-y") return "occupied";
  }
  if (state.structures.some((s) => overlaps(s, tx, ty, w, h))) return "overlap";
  // E4 (#268): the 2×2 shed needs level ground, like every other footprint.
  if (footprintFlatTiles(grid, footprintTiles({ tx, ty, w, h }))) return "not-flat";
  const probe: RailStructure = { id: -1, kind: "depot", ownerId, owner: "", tx, ty, w, h, view };
  const exit = depotExit(probe);
  if (state.rail.tile[tIdx(exit.tx, exit.ty)] & RAIL_OVERPASS) return "overpass-stop";
  // The exit tile itself may already be the owner's rail (a depot straddling the
  // end of a line), or the tile the exit FACES may be. The reciprocal bit is not
  // required up front: the depot's lane supplies its own half of the join, and
  // placing it autotiles the neighbour.
  if (railOpenTo(state.rail, ownerId, exit.tx, exit.ty)) return "ok";
  const nx = exit.tx + DIR[exit.dir][0], ny = exit.ty + DIR[exit.dir][1];
  if (railOpenTo(state.rail, ownerId, nx, ny)) {
    // The depot adds an axis arm at its neighbour. A diagonal stub pointing
    // BACK towards the shed would otherwise make a sharp join without ever
    // going through buildRail's turn guard. A 45-degree departure remains OK.
    const arms = new Set(railArms(state, ownerId, nx, ny));
    arms.add(octantOf(exit.tx - nx, exit.ty - ny));
    return railArmsTurnOk([...arms]) ? "ok" : "too-sharp";
  }
  // Nothing to join: is the tile even capable of carrying rail?
  if (!inMapT(nx, ny) || !railTerrainOk(grid, nx, ny)) return "exit-blocked";
  const exitBuilt = grid.builtAt?.(nx, ny);
  const blocked = grid.occupancy[tIdx(nx, ny)] >= 0 || grid.occupancy[tIdx(nx, ny)] === FIELD_OCC || structureAt(state, nx, ny) !== null
    || exitBuilt === "depot" || exitBuilt === "plant" || exitBuilt === "platform" || exitBuilt === "bridge" || exitBuilt === "dam"
    || (hasRail(state.rail, nx, ny) && state.rail.owner[tIdx(nx, ny)] !== ownerId);
  return blocked ? "exit-blocked" : "no-network";
}

export function placeDepot(
  state: RailState, owner: string, ownerId: number, tx: number, ty: number, view: RailView,
): RailStructure {
  const s: RailStructure = { id: state.seq++, kind: "depot", ownerId, owner, tx, ty, w: 2, h: 2, view };
  state.structures.push(s);
  autotileRail(state, laneTiles(s));
  return s;
}

/**
 * Remove a structure. Its lane goes with it, and anything that cannot survive
 * the demolition goes too: a depot takes its train and line, a platform takes
 * every line that stopped there (the train on it has nowhere left to run).
 */
export function demolishStructure(state: RailState, id: number): RailStructure | null {
  const at = state.structures.findIndex((s) => s.id === id);
  if (at < 0) return null;
  const s = state.structures[at];
  // #142: "disallow demolishing rail/structures physically occupied by a
  // train". The lane is the obvious half; the less obvious one is the depot
  // whose train is INSIDE it — a stored train has no route and so no tile, and
  // without this guard demolishing the shed would delete a bought train (and
  // its line) with no message and no refund. A train that is out on the line
  // is based here too: destroying its home would strand it, so the player must
  // sell it (it is at home) or wait for it to return.
  if (s.kind === "depot" && trainBasedAt(state, s.id)) return null;
  const lane = laneTiles(s);
  if (lane.some(([x, y]) => trainOccupies(state, x, y))) return null;
  state.structures.splice(at, 1);
  autotileRail(state, lane);
  if (s.kind !== "depot") {
    // Only a PLATFORM can take a line down with it: the guard above means a
    // depot reached this point with no train based at it, so a line can never
    // lose its depot here.
    for (const line of [...state.lines]) {
      if (line.source !== id && line.dest !== id) continue;
      state.lines.splice(state.lines.indexOf(line), 1);
      clearLineLanes(state, line.id);   // RAIL-6: lanes it held at OTHER stations
      for (const t of [...state.trains]) {
        if (t.lineId === line.id) state.trains.splice(state.trains.indexOf(t), 1);
      }
    }
  }
  state.rail.revision++;
  return s;
}

// ── lines and trains (RAIL-04 / #178) ─────────────────────────────────────
export interface RailLine {
  id: number;
  ownerId: number;
  name: string;
  /** Platform structure ids: where the freight comes from and where it goes. */
  source: number;
  dest: number;
  /**
   * RAIL-6 (#575): the lane each end of the line runs into at its station —
   * the standing assignment a lane's `lineId` mirrors. Absent (an old save, an
   * old wire) reads as "the station's first lane", which is what every line
   * had before stations grew.
   */
  sourceLane?: number | null;
  destLane?: number | null;
}

export type TrainStatus =
  | "stored" | "departing" | "moving" | "dwelling" | "returning" | "blocked"
  /** RAIL-6 (#575): waiting at the station throat — every lane is busy. */
  | "holding";

export const TRAIN_STATUSES: TrainStatus[] = [
  "stored", "departing", "moving", "dwelling", "returning", "blocked", "holding",
];

export interface Train {
  id: number;
  ownerId: number;
  lineId: number;
  depotId: number;
  status: TrainStatus;
  /** Which stop the train is heading for (or dwelling at). */
  target: "source" | "dest" | "depot";
  /** The leg being driven: tiles from where the train was to where it is going. */
  route: [number, number][];
  /** Tiles travelled along `route` (fractional). */
  dist: number;
  /** The rail revision `route` was planned against. */
  planRevision: number;
  /** Remaining dwell at a platform, ms. */
  dwellMs: number;
  /** Last heading, for the sprite while dwelling or stored. */
  dirBit: number;
  /** Set once the 50% resale has been taken — it is a ONE-TIME refund. */
  resold: boolean;
  /** Why a blocked train is blocked, for the panel. */
  blockedWhy?: string;
  /**
   * RAIL-6 (#575): the lane this train is booked into at the stop it is
   * currently heading for (or dwelling at). One train per lane at a time —
   * the lane IS the station's capacity. Null while no lane is held.
   */
  laneId?: number | null;
  /**
   * RAIL-6 (#575): the station whose throat a `holding` train waits at, while
   * every lane there is busy. Null unless the train is holding.
   */
  holdStation?: number | null;
}

export interface LinePlan {
  ok: boolean;
  why?: string;
  line?: RailLine;
  train?: Train;
}

/** Cumulative path distances along a tile route, one entry per tile. */
export function polyline(route: [number, number][]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < route.length; i++) {
    const dx = route[i][0] - route[i - 1][0], dy = route[i][1] - route[i - 1][1];
    out.push(out[i - 1] + Math.hypot(dx, dy));
  }
  return out;
}

export const routeLength = (route: [number, number][]): number => {
  const cum = polyline(route);
  return cum[cum.length - 1] ?? 0;
};

export interface PathPoint {
  fx: number;
  fy: number;
  dirBit: number;
}

/**
 * The point `dist` tiles along a route, plus the heading of the segment it is
 * on. This is the ONLY way a train position is computed, so the locomotive and
 * the wagon — which sit at different distances along the same polyline — turn
 * the same corner at the same place, one after the other.
 */
export function pointAt(route: [number, number][], dist: number, cum?: number[]): PathPoint {
  if (!route.length) return { fx: 0, fy: 0, dirBit: SE };
  const cumDist = cum ?? polyline(route);
  const total = cumDist[cumDist.length - 1];
  const d = Math.max(0, Math.min(total, dist));
  let i = 1;
  while (i < cumDist.length - 1 && cumDist[i] < d) i++;
  const a = route[i - 1];
  const b = route[Math.min(i, route.length - 1)];
  const span = (cumDist[Math.min(i, cumDist.length - 1)] - cumDist[i - 1]) || 1;
  const t = Math.max(0, Math.min(1, (d - cumDist[i - 1]) / span));
  if (a[0] === b[0] && a[1] === b[1]) {
    const prev = route[Math.max(0, i - 2)];
    return { fx: a[0], fy: a[1], dirBit: dirBitBetween(prev, a) };
  }
  return { fx: a[0] + (b[0] - a[0]) * t, fy: a[1] + (b[1] - a[1]) * t, dirBit: dirBitBetween(a, b) };
}

/**
 * The index of the route segment `dist` lies on — the same scan `pointAt` runs,
 * so the segment whose grade prices the train's speed is the segment the head
 * is actually drawn on.
 */
function segmentAt(route: [number, number][], dist: number, cum: number[]): number {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < dist) i++;
  return Math.min(i, route.length - 1);
}

/** A train's trail (created on first use). */
export function trailOf(state: RailState, t: Train): [number, number][] {
  if (!state.trails) state.trails = new Map();
  let tr = state.trails.get(t.id);
  if (!tr) { tr = []; state.trails.set(t.id, tr); }
  return tr;
}

/** The point `s` tiles back along a head-first trail (clamped to its ends). */
export function walkTrail(trail: [number, number][], s: number): [number, number] {
  if (!trail.length) return [0, 0];
  if (s <= 0) return trail[0];
  let left = s;
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1], b = trail[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (seg >= left && seg > 0) {
      const k = left / seg;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    }
    left -= seg;
  }
  return trail[trail.length - 1];
}

/** Octant (0..7) nearest to a grid direction vector, or -1 for none. */
export function octantNear(dx: number, dy: number): number {
  if (Math.hypot(dx, dy) < 1e-6) return -1;
  const a = Math.atan2(dy, dx) * 180 / Math.PI;       // (1,-1) is -45°
  return (((Math.round((a + 45) / 45)) % 8) + 8) % 8;
}

/** Heading of the leg the head is on, from the route (the fallback heading). */
function routeOctant(t: Train): number {
  const r = t.route;
  if (r.length < 2) return 1;
  const cum = polyline(r);
  let i = 1;
  while (i < r.length - 1 && cum[i] < t.dist) i++;
  const o = octantOf(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
  return o < 0 ? 1 : o;
}

/** Where each car of a train stands, and which way it faces. */
export interface CarPlacement { kind: CarKind; fx: number; fy: number; oct: number }
export function carPlacements(state: RailState, t: Train): CarPlacement[] {
  if (!t.route.length) return [];
  const head = pointAt(t.route, t.dist);
  const trail = trailOf(state, t);
  const pts: [number, number][] = trail.length && Math.hypot(trail[0][0] - head.fx, trail[0][1] - head.fy) < 1e-6
    ? trail : [[head.fx, head.fy], ...trail];
  const cars = consistOf(t);
  const offs = carOffsets(cars);
  const fallback = routeOctant(t);
  return cars.map((kind, i) => {
    const [fx, fy] = walkTrail(pts, offs[i]);
    const half = CAR_LEN[kind] * 0.4;
    const front = walkTrail(pts, Math.max(0, offs[i] - half));
    const rear = walkTrail(pts, offs[i] + half);
    const o = octantNear(front[0] - rear[0], front[1] - rear[1]);
    return { kind, fx, fy, oct: o < 0 ? fallback : o };
  });
}

/**
 * Record the head's progress along `route` from distance `a` to `b` onto the
 * trail — every route vertex passed, then the head — and trim what no car
 * can reach any more.
 */
function recordTrail(state: RailState, t: Train, cum: number[], a: number, b: number): void {
  const trail = trailOf(state, t);
  const push = (p: [number, number]) => {
    const h = trail[0];
    if (h && Math.hypot(h[0] - p[0], h[1] - p[1]) < 1e-6) return;
    trail.unshift(p);
  };
  for (let i = 0; i < t.route.length; i++) {
    if (cum[i] > a + 1e-9 && cum[i] < b - 1e-9) push([t.route[i][0], t.route[i][1]]);
  }
  const p = pointAt(t.route, b, cum);
  push([p.fx, p.fy]);
  const keep = trainLength(t) + 1;
  let s = 0;
  for (let i = 1; i < trail.length; i++) {
    s += Math.hypot(trail[i][0] - trail[i - 1][0], trail[i][1] - trail[i - 1][1]);
    if (s > keep) { trail.length = i + 1; break; }
  }
}

/**
 * Turn a train round at a platform: the car at the far end becomes the front.
 * The trail is reversed from the tail back to the head (so the cars stay where
 * they stood), and the new leg starts from the tail's tile, heading away from
 * the platform. Returns that start and heading, or null when the trail is too
 * short to matter (the head's own tile, any heading).
 */
function turnRound(state: RailState, t: Train): { tile: [number, number]; oct: number } | null {
  const trail = trailOf(state, t);
  if (trail.length < 2) return null;
  const len = trainLength(t) - CAR_LEN.loco / 2 - CAR_LEN[consistOf(t).slice(-1)[0]] / 2;
  // The first WHOLE-TILE vertex at or past the last car: a train starts a leg
  // from a tile, never from a corner between tiles.
  let s = 0, k = trail.length - 1;
  for (let i = 1; i < trail.length; i++) {
    s += Math.hypot(trail[i][0] - trail[i - 1][0], trail[i][1] - trail[i - 1][1]);
    const p = trail[i];
    if (s >= len - 1e-6 && Number.isInteger(p[0]) && Number.isInteger(p[1])) { k = i; break; }
  }
  let end = trail[k];
  while (k > 0 && !(Number.isInteger(end[0]) && Number.isInteger(end[1]))) end = trail[--k];
  if (k === 0) return null;
  const prev = trail[k - 1];
  const oct = octantNear(end[0] - prev[0], end[1] - prev[1]);
  const flipped = trail.slice(0, k + 1).reverse();
  trail.length = 0;
  trail.push(...flipped);
  return { tile: [end[0], end[1]], oct };
}

/** The tile a train's locomotive actually stands on. */
export const trainTile = (t: Train): [number, number] => {
  const p = pointAt(t.route, t.dist);
  return [Math.round(p.fx), Math.round(p.fy)];
};

/** Does a train physically occupy this tile — locomotive or wagon? */
export function trainOccupies(state: RailState, tx: number, ty: number): Train | null {
  for (const t of state.trains) {
    for (const c of carPlacements(state, t)) {
      if (Math.round(c.fx) === tx && Math.round(c.fy) === ty) return t;
    }
  }
  return null;
}

export const depotOfTrain = (state: RailState, t: Train): RailStructure | null =>
  state.structures.find((s) => s.id === t.depotId && s.kind === "depot") ?? null;

/** The train based at a depot — the one in its shed, or out on its line. */
export const trainBasedAt = (state: RailState, depotId: number): Train | null =>
  state.trains.find((t) => t.depotId === depotId) ?? null;

/**
 * Is this train standing at home — in its shed, or STOPPED SAFELY on its
 * depot's own exit tile? The second half matters: a route cut between the
 * depot and the line leaves a train `blocked` where it started, and the epic's
 * resale rule ("return to depot precedes resale") is about the train being
 * home, not about the state's name. A train on its line — running, dwelling
 * or blocked mid-route — is not home and cannot be sold.
 */
export function trainAtHome(state: RailState, train: Train): boolean {
  if (train.status === "stored") return true;
  // A live train is on its way somewhere and is never "at home", however
  // close to the shed it looks — only one that STOPPED (blocked) counts.
  if (train.status !== "blocked") return false;
  const depot = depotOfTrain(state, train);
  if (!depot) return false;
  if (train.route.length === 0 || train.dist > 1e-9) return false;
  const exit = depotExit(depot);
  return train.route[0][0] === exit.tx && train.route[0][1] === exit.ty;
}

export const lineOfTrain = (state: RailState, t: Train): RailLine | null =>
  state.lines.find((l) => l.id === t.lineId) ?? null;

export const trainsOf = (state: RailState, ownerId: number): Train[] =>
  state.trains.filter((t) => t.ownerId === ownerId);

/**
 * A line needs a SOURCE platform anchored to an industry, a DESTINATION
 * platform anchored to one of the same owner's plants, two distinct stops, and
 * both ends in the same owner's rail. The depot is a further requirement,
 * checked on assignment.
 */
export function lineRefusal(state: RailState, ownerId: number, sourceId: number, destId: number): RailRefusal {
  const source = structureById(state, sourceId);
  const dest = structureById(state, destId);
  if (!source || !dest) return "missing";
  if (source.ownerId !== ownerId || dest.ownerId !== ownerId) return "not-yours";
  if (source.kind !== "platform" || dest.kind !== "platform") return "missing";
  if (sourceId === destId) return "missing";
  if (source.anchor?.kind !== "industry") return "no-anchor";
  if (dest.anchor?.kind !== "plant") return "no-anchor";
  return "ok";
}

/** An owned depot whose exit can reach this platform, or null. */
export function depotReaching(
  state: RailState, ownerId: number, platformId: number, grid?: Grid,
): RailStructure | null {
  const platform = structureById(state, platformId);
  if (!platform) return null;
  const goals = new Set(platformTrack(platform).map(([x, y]) => tIdx(x, y)));
  for (const depot of structuresOf(state, ownerId, "depot")) {
    const exit = depotExit(depot);
    if (railPath(state, ownerId, [[exit.tx, exit.ty]], goals, -1, grid)) return depot;
  }
  return null;
}

/** The component a depot's exit sits on, or 0. */
const depotComponent = (comp: Map<number, number>, depot: RailStructure): number => {
  const exit = depotExit(depot);
  return comp.get(tIdx(exit.tx, exit.ty)) ?? 0;
};

/** The longest name a line may carry. A name is trimmed and never empty. */
export const LINE_NAME_MAX = 32;

const cleanLineName = (name: string | undefined): string | null => {
  const clean = (name ?? "").replace(/\s+/g, " ").trim().slice(0, LINE_NAME_MAX);
  return clean || null;
};

/** Can this depot's exit reach the platform's lane on the owner's own rail? */
function depotReachesPlatform(
  state: RailState, ownerId: number, depot: RailStructure, platformId: number, grid?: Grid,
): boolean {
  const platform = structureById(state, platformId);
  if (!platform) return false;
  const goals = new Set(platformTrack(platform).map(([x, y]) => tIdx(x, y)));
  const exit = depotExit(depot);
  return !!railPath(state, ownerId, [[exit.tx, exit.ty]], goals, -1, grid);
}

/**
 * #179: create a named line between two of the owner's platforms — an
 * industry-anchored source and a plant-anchored destination. It buys nothing:
 * `buyTrain` is the separate purchase and `startLine` sends the train off, so
 * the Railway panel can build a line in steps. `assignLine` is all three at once.
 */
export function createLine(
  state: RailState, ownerId: number, sourceId: number, destId: number, name?: string,
): { ok: boolean; line?: RailLine; why?: string } {
  const why = lineRefusal(state, ownerId, sourceId, destId);
  if (why !== "ok") return { ok: false, why: RAIL_REFUSAL_TEXT[why] };
  const line: RailLine = {
    id: state.seq++,
    ownerId,
    name: cleanLineName(name) ?? `Line ${state.lines.filter((l) => l.ownerId === ownerId).length + 1}`,
    source: sourceId,
    dest: destId,
  };
  state.lines.push(line);
  // RAIL-6 (#575): a fresh line takes a standing lane at each end when the
  // station has one free — the lane ledger the HUD and the save carry.
  assignLineLanes(state, line);
  return { ok: true, line };
}

/** #179: rename one of the owner's lines. An empty name is refused. */
export function renameLine(state: RailState, ownerId: number, lineId: number, name: string): boolean {
  const line = state.lines.find((l) => l.id === lineId && l.ownerId === ownerId);
  const clean = cleanLineName(name);
  if (!line || !clean) return false;
  line.name = clean;
  return true;
}

/**
 * #179: buy a locomotive + one wagon into an owned depot, for one of the
 * owner's lines. The train is PARKED in the shed (`stored`, heading home, no
 * leg) until `startLine` sends it off.
 *
 * Refusals: the depot and the line must be the owner's; the depot must reach
 * the line's source platform; and the connected owner rail network must not
 * already hold a train — v1's one-train rule (no signals, so no collisions),
 * checked across EVERY depot on that network, not just this one.
 *
 * The PRICE is the caller's to check and charge, so a guest can ask and the
 * host debits its authoritative purse; a refusal here costs nothing.
 */
export function buyTrain(
  state: RailState, ownerId: number, depotId: number, lineId: number, grid?: Grid,
): { ok: boolean; train?: Train; why?: string } {
  const depot = state.structures.find((s) => s.id === depotId && s.kind === "depot" && s.ownerId === ownerId);
  const line = state.lines.find((l) => l.id === lineId && l.ownerId === ownerId);
  if (!depot || !line) return { ok: false, why: RAIL_REFUSAL_TEXT.missing };
  if (!depotReachesPlatform(state, ownerId, depot, line.source, grid)) {
    return { ok: false, why: "No depot of yours can reach that platform." };
  }
  const comp = railComponents(state, ownerId);
  const home = depotComponent(comp, depot);
  if (!home) return { ok: false, why: "The depot is not connected to the platform." };
  const busy = state.trains.some((t) => {
    if (t.ownerId !== ownerId) return false;
    const d = depotOfTrain(state, t);
    return d ? depotComponent(comp, d) === home : false;
  });
  if (busy) return { ok: false, why: "One train per connected network — this line is already running one." };
  const exit = depotExit(depot);
  const train: Train = {
    id: state.seq++,
    ownerId,
    lineId: line.id,
    depotId: depot.id,
    status: "stored",
    // Parked: `tickTrains` leaves a stored train that is heading for its depot
    // with no leg exactly where it is, so a bought train waits to be started.
    target: "depot",
    route: [],
    dist: 0,
    planRevision: -1,
    dwellMs: 0,
    dirBit: exit.dir,
    resold: false,
  };
  state.trains.push(train);
  return { ok: true, train };
}

/**
 * #179: send a line's parked train off to its source platform, from the depot
 * exit (RAIL-04's "start at the depot exit"). A train that cannot route is left
 * `blocked` where it stands — `planLeg`'s rule — never deleted. The one-train
 * rule needs no second check here: `buyTrain` and the rail merge guard already
 * keep a network to one train. Returns true when a train set off.
 */
export function startLine(state: RailState, ownerId: number, lineId: number, grid?: Grid): boolean {
  const line = state.lines.find((l) => l.id === lineId && l.ownerId === ownerId);
  if (!line) return false;
  let started = false;
  for (const t of state.trains) {
    if (t.lineId !== lineId || t.ownerId !== ownerId || t.status !== "stored") continue;
    t.target = "source";
    if (planLeg(state, t, undefined, grid)) started = true;
  }
  return started;
}

/**
 * Buy a locomotive + one wagon and put it on a line — the whole of #178's
 * "assign an owned industry-platform to an owned-plant-platform line with a
 * reachable depot" in one authoritative call. Since #179 it is exactly
 * `createLine` → `buyTrain` → `startLine`, rolled back whole (no line, no train,
 * no ids spent) when any step refuses, so the panel's step-by-step path and
 * this one-click path share every rule.
 *
 * Refusals, in the order a player hits them: the two platforms must make a
 * legal line; a depot must reach the source; and the connected owner rail
 * component the line lives on must not already hold a train (v1's one-train
 * rule — no signals, so no collisions).
 */
export function assignLine(
  state: RailState, ownerId: number, sourceId: number, destId: number, name?: string, grid?: Grid,
): LinePlan {
  const why = lineRefusal(state, ownerId, sourceId, destId);
  if (why !== "ok") return { ok: false, why: RAIL_REFUSAL_TEXT[why] };
  const depot = depotReaching(state, ownerId, sourceId, grid);
  if (!depot) return { ok: false, why: "No depot of yours can reach that platform." };
  const seq = state.seq;
  const created = createLine(state, ownerId, sourceId, destId, name);
  if (!created.ok || !created.line) return { ok: false, why: created.why ?? RAIL_REFUSAL_TEXT.missing };
  const bought = buyTrain(state, ownerId, depot.id, created.line.id, grid);
  if (!bought.ok || !bought.train) {
    state.lines.splice(state.lines.indexOf(created.line), 1);
    state.seq = seq;
    return { ok: false, why: bought.why ?? RAIL_REFUSAL_TEXT.missing };
  }
  startLine(state, ownerId, created.line.id, grid);
  return { ok: true, line: created.line, train: bought.train };
}

/**
 * Plan the leg the train is currently heading for. Called on assignment, when a
 * dwell ends, and whenever the rail revision has moved under a planned route
 * (RAIL-04's "recompute only when graph revision changes").
 *
 * A route that cannot be planned leaves the train `blocked`, standing exactly
 * where it is — never teleported, never deleted — and it tries again the next
 * time the revision moves, which is the "stop safely on broken routes" clause.
 */
export function planLeg(
  state: RailState, train: Train, from?: { tile: [number, number]; oct: number } | null,
  // #429: the leg is planned through the network a train may drive — with the
  // grid the route may round ramp corners; without it, the 45° rule stands.
  grid?: Grid,
): boolean {
  const line = state.lines.find((l) => l.id === train.lineId);
  const depot = depotOfTrain(state, train);
  // Playtest (2026-09): trains spawn on their line like lorries — no depot.
  // A depot-less train starts from its source platform and never heads "home".
  if (!line || (!depot && train.depotId !== 0)) {
    train.status = "blocked";
    train.blockedWhy = "Line or depot gone";
    return false;
  }
  if (!depot && train.target === "depot") train.target = "source";
  const source = structureById(state, line.source);
  const dest = structureById(state, line.dest);
  if (!source || !dest) {
    train.status = "blocked";
    train.blockedWhy = "A platform is gone";
    train.planRevision = state.rail.revision;
    return false;
  }

  // Where the train actually IS: its own tile when that is still its rail, else
  // the depot exit (a freshly bought train sitting in the shed).
  const exit = depot ? depotExit(depot) : { tx: stopTile(source)[0], ty: stopTile(source)[1] };
  const wasRolling = train.status === "moving" || train.status === "departing" || train.status === "returning";
  const oldRoute = train.route;
  const oldDist = train.dist;
  // Where the head IS, as a tile the rail passes through: the route vertex the
  // train last left (a train between two tiles of a diagonal is on a corner,
  // and rounding a corner lands on a tile the rail does not touch).
  let here: [number, number] = [exit.tx, exit.ty];
  let startOct = -1;
  if (from) { here = from.tile; startOct = from.oct; }
  else if (oldRoute.length) {
    const cum = polyline(oldRoute);
    let i = 0;
    while (i < oldRoute.length - 1 && cum[i + 1] <= oldDist + 1e-9) i++;
    here = oldRoute[i];
    if (i > 0) startOct = octantOf(oldRoute[i][0] - oldRoute[i - 1][0], oldRoute[i][1] - oldRoute[i - 1][1]);
  }
  const start: [number, number] = railDrivable(state, train.ownerId, here[0], here[1]) ? here : [exit.tx, exit.ty];
  const targetStruct = train.target === "depot" ? depot! : train.target === "source" ? source : dest;
  // The leg ends at ONE tile — the middle of a platform's lane, or the depot's
  // shed door — so a train parks inside the platform instead of on its port.
  // RAIL-6 (#575): a station has several such tiles, one per lane, and a train
  // books the first lane that is free AND legally routable from where it
  // stands. With no lane to book the leg ends at the THROAT instead — the last
  // tile of the approach outside the station's tracks — and the train holds
  // there until a lane frees (`tickTrains`).
  let holding = false;
  // One routing attempt: the current heading first, then the legal reversal.
  const tryRoute = (goalTile: [number, number]): [number, number][] | null => {
    const goal = new Set([tIdx(goalTile[0], goalTile[1])]);
    return railPath(state, train.ownerId, [start], goal, startOct, grid)
      // Reversal is legal (recall / a platform departure), but dropping the
      // heading entirely let a train resume right on a legacy 90° corner.
      ?? railPath(state, train.ownerId, [start], goal, startOct < 0 ? -1 : (startOct + 4) % 8, grid);
  };
  let route: [number, number][] | null = null;
  if (train.target === "depot") {
    releaseTrainLane(train);
    route = tryRoute([exit.tx, exit.ty]);
  } else {
    for (const lane of pickStationLanes(state, train, targetStruct)) {
      route = tryRoute(laneStopTile(lane));
      if (!route) continue;
      train.laneId = lane.id;
      train.holdStation = null;
      break;
    }
    if (!route) {
      train.laneId = null;
      train.holdStation = targetStruct.id;
      holding = true;
      route = tryRoute(laneStopTile(stationLanes(targetStruct)[0]));
    }
  }
  if (!route) {
    train.status = "blocked";
    train.blockedWhy = train.target === "depot" ? "No route back to the depot"
      : "No route to the platform (a train cannot take a 90° bend)";
    train.planRevision = state.rail.revision;
    return false;
  }
  if (holding) {
    // Trim the leg back out of the station: the throat is the last tile of the
    // approach that is not one of the station's lane tracks. A train that
    // starts its hold already inside the station (a fresh spawn, a cut route)
    // holds where it stands rather than driving deeper in.
    const tracks = new Set<number>();
    for (const l of stationLanes(targetStruct)) for (const [x, y] of laneTrackTiles(l)) tracks.add(tIdx(x, y));
    let i = route.length - 1;
    while (i > 0 && tracks.has(tIdx(route[i][0], route[i][1]))) i--;
    route = i > 0 ? route.slice(0, i + 1) : [route[0]];
  }
  train.route = route;
  // A replan must not teleport a train that is already rolling: carry the
  // sub-tile progress it had over onto the new route's first step. In the
  // ordinary case — a player building somewhere else on the network — the new
  // route is the same and the train does not visibly move at all.
  let resume = 0;
  if (wasRolling && !from && oldRoute.length > 1 && route.length > 1) {
    const p = pointAt(oldRoute, oldDist);
    const dx = route[1][0] - route[0][0], dy = route[1][1] - route[0][1];
    const seg = Math.hypot(dx, dy) || 1;
    const along = ((p.fx - route[0][0]) * dx + (p.fy - route[0][1]) * dy) / seg;
    resume = Math.max(0, Math.min(0.9 * seg, along));
  }
  train.dist = resume;
  train.planRevision = state.rail.revision;
  train.blockedWhy = undefined;
  // A depot-less (automatic) train is never "departing": it starts on its line.
  // RAIL-6 (#575): a train with no free lane at its stop is "holding" — running
  // to the throat, then waiting there with the station's lanes in view.
  train.status = holding ? "holding"
    : train.target === "depot" ? "returning"
      : train.target === "source" && depot ? "departing" : "moving";
  return true;
}

/**
 * Advance every train by `dtMs`. The state machine is exactly the epic's:
 *
 *   stored → departing (to the source platform)
 *          → dwelling (DWELL_MS) → moving → dwelling → moving …   (the shuttle)
 *          → returning (on stop or sell) → stored
 *   any    → blocked (a route that no longer exists), standing still
 *
 * Position is CUMULATIVE DISTANCE along the current leg's polyline, so a huge
 * dt crosses as many tiles as it should, and arrival is exact: the train is
 * clamped to its stop tile and starts its dwell rather than overshooting by a
 * frame's worth of distance.
 *
 * E4 (#268): `grid` is optional and buys ONE thing — the uphill grade. With a
 * grid, a train climbing a slope moves at `uphillFactor` of `RAIL_SPEED`; with
 * none (a hand-built test state, a flat map) it moves exactly as it always did.
 */
export function tickTrains(state: RailState, dtMs: number, grid?: Grid): void {
  if (dtMs <= 0) return;
  for (const train of state.trains) {
    // A train that is out on the line replans the moment the graph moves under
    // it (RAIL-04's "only when the graph revision changes") — the one place a
    // broken route is noticed. `planLeg` parks it where it stands if there is no
    // way through, and a train mid-dwell finishes its dwell first.
    if (train.status === "moving" || train.status === "departing" || train.status === "returning") {
      if (train.planRevision !== state.rail.revision) planLeg(state, train, undefined, grid);
    }
    // RAIL-6 (#575): a holding train asks for a lane again every tick — the
    // moment a dwelling train departs and frees one, the holder plans in and
    // rolls. A dwell always ends and a departure always frees the lane, so a
    // full station is a QUEUE, never a deadlock.
    if (train.status === "holding") {
      const st = train.holdStation != null ? structureById(state, train.holdStation) : null;
      const lane = st && st.kind === "platform" ? pickStationLane(state, train, st) : null;
      if (lane) {
        train.laneId = lane.id;
        train.holdStation = null;
        planLeg(state, train, undefined, grid);
      } else if (train.planRevision !== state.rail.revision) {
        planLeg(state, train, undefined, grid);   // the throat itself was cut
      }
      if (train.status === "holding" && train.route.length <= 1) continue;  // held in place
    }
    if (train.status === "blocked") {
      if (train.planRevision !== state.rail.revision) planLeg(state, train, undefined, grid);
      if (train.status === "blocked") continue;
    }
    let ms = dtMs;
    let guard = 0;
    while (ms > 1e-9 && guard++ < 1000) {
      if (train.status === "stored") {
        // A stored train with a live line departs on the next tick; a train the
        // player has parked (target "depot") stays in the shed.
        if (train.target === "depot" && !train.route.length) break;
        if (!planLeg(state, train, undefined, grid)) break;
        continue;
      }
      if (train.status === "dwelling") {
        if (train.dwellMs > ms) { train.dwellMs -= ms; ms = 0; break; }
        ms -= train.dwellMs;
        train.dwellMs = 0;
        // The dwell is over: reverse at the platform and run to the other stop.
        // The train turns round where it stands — its last car leads out.
        // RAIL-6 (#575): leaving the stop frees the lane — the queued train at
        // the throat picks it up on its very next tick.
        releaseTrainLane(train);
        train.target = train.target === "source" ? "dest" : "source";
        if (!planLeg(state, train, turnRound(state, train), grid)) break;
        continue;
      }
      const cum = polyline(train.route);
      const total = cum[cum.length - 1] ?? 0;
      const remaining = total - train.dist;
      // E4 (#268): the locomotive's own pace for the segment it is ON: a climb
      // costs speed (`1 / (1 + uphillSlow × levels climbed)`), the flat and the
      // downhill run at `RAIL_SPEED`. Positions stay geometric tile distances —
      // only the clock the head advances by changes, so the wagons, the trail
      // and the cornering are the same maths they always were.
      const seg = train.route.length > 1 ? segmentAt(train.route, train.dist, cum) : -1;
      const speed = grid && seg > 0
        ? RAIL_SPEED * uphillFactor(grid, train.route[seg - 1], train.route[seg])
        : RAIL_SPEED;
      const step = speed * ms;
      if (step < remaining) {
        recordTrail(state, train, cum, train.dist, train.dist + step);
        train.dist += step;
        train.dirBit = pointAt(train.route, train.dist, cum).dirBit;
        ms = 0;
        break;
      }
      recordTrail(state, train, cum, train.dist, total);
      train.dist = total;
      train.dirBit = pointAt(train.route, total, cum).dirBit;
      ms -= remaining / speed;
      if (train.target === "depot") {
        train.status = "stored";
        train.route = [];
        train.dist = 0;
        continue;
      }
      // RAIL-6 (#575): arriving at the THROAT is not arriving at the station —
      // the train waits where it stands (every lane is busy) and keeps asking.
      if (train.status === "holding") { ms = 0; break; }
      train.status = "dwelling";
      train.dwellMs = DWELL_MS;
    }
  }
}

/**
 * Playtest (2026-09): trains are automatic, exactly like the lorries. Every
 * industry platform of the owner that rail connects to one of the owner's
 * plant platforms gets a line and a train (free, no depot), starting at the
 * source platform. Lines whose platforms are gone, or no longer connected,
 * are dropped with their train. Returns true when anything changed.
 * (The Train Depot comes back when players can buy trains.)
 */
export function autoTrains(state: RailState, ownerId: number, grid?: Grid): boolean {
  let changed = false;
  const comp = railComponents(state, ownerId);
  const compOf = (s: RailStructure): number => comp.get(tIdx(...stopTile(s))) ?? 0;
  const drivable = (a: RailStructure, b: RailStructure): [number, number][] | null =>
    railPath(state, ownerId, [stopTile(a)], new Set([tIdx(...stopTile(b))]), -1, grid);
  for (const line of state.lines.filter((l) => l.ownerId === ownerId)) {
    const src = structureById(state, line.source), dst = structureById(state, line.dest);
    const joined = !!src && !!dst && compOf(src) !== 0 && compOf(src) === compOf(dst);
    // A train that is stuck because its line cannot be DRIVEN (a 90° bend on
    // the way) goes too, and comes back the moment the track is fixed.
    const stuck = state.trains.some((t) => t.lineId === line.id && t.status === "blocked");
    if (joined && !(stuck && !drivable(src!, dst!))) continue;
    state.lines.splice(state.lines.indexOf(line), 1);
    clearLineLanes(state, line.id);       // RAIL-6: its lanes are free again
    for (const t of state.trains.filter((x) => x.lineId === line.id)) state.trails?.delete(t.id);
    state.trains = state.trains.filter((t) => t.lineId !== line.id);
    changed = true;
  }
  const plats = structuresOf(state, ownerId, "platform");
  for (const src of plats) {
    if (src.anchor?.kind !== "industry") continue;
    if (state.lines.some((l) => l.source === src.id)) continue;
    const home = compOf(src);
    if (!home) continue;
    // Only a line a train can actually DRIVE gets a train (the component says
    // the rails touch; the route also honours the 45° rule).
    let dst: RailStructure | undefined;
    let route: [number, number][] | null = null;
    for (const p of plats) {
      if (p.anchor?.kind !== "plant" || compOf(p) !== home) continue;
      route = drivable(src, p);
      if (route && route.length > 1) { dst = p; break; }
    }
    if (!dst || !route) continue;
    // RAIL-6 (#575): a line only exists when BOTH of its stations have a lane
    // free to assign it — one train per lane at a time is the station's
    // capacity. A second resource wanting the same plant station waits for
    // the upgrade that adds the lane; the pass runs again every frame, so the
    // line appears the moment the lane does.
    if (!stationLanes(src).some((l) => l.lineId == null)) continue;
    const free = stationLanes(dst).find((l) => l.lineId == null);
    if (!free) continue;
    // The leg runs to the lane the line WILL be assigned (`assignLineLanes`
    // books the first free one — `free`) — and that berth must be DRIVABLE
    // now: a lane whose switch has not been laid yet holds the line back. The
    // pass runs again every frame, so the line appears the moment the lane
    // becomes reachable — never a train aimed at an island.
    const run = railPath(state, ownerId, [route[0]], new Set([tIdx(...laneStopTile(free))]), -1, grid);
    if (!run || run.length < 2) continue;
    const made = createLine(state, ownerId, src.id, dst.id);
    if (!made.ok || !made.line) continue;
    const train: Train = {
      id: state.seq++, ownerId, lineId: made.line.id, depotId: 0,
      status: "moving", target: "dest", route: run, dist: 0,
      planRevision: state.rail.revision, dwellMs: 0,
      dirBit: dirBitBetween(run[0], run[1] ?? run[0]), resold: false,
      // The destination lane is booked from the first metre: two lines into
      // one station never aim at the same platform track.
      laneId: made.line.destLane ?? null,
    };
    state.trains.push(train);
    // The train starts already PULLED OUT of the platform: the locomotive a
    // train's length along the route, every car behind it on real track — never
    // five cars stacked on the stop tile (the platform's track dead-ends
    // behind it, so there is no room to lay them out backwards).
    const cum = polyline(run);
    const lead = Math.min(trainLength(train) - CAR_LEN.loco / 2, cum[cum.length - 1] - 0.01);
    const trail = trailOf(state, train);
    trail.length = 0;
    trail.push([run[0][0], run[0][1]]);
    recordTrail(state, train, cum, 0, lead);
    train.dist = lead;
    changed = true;
  }
  return changed;
}

/** Send a train home: `returning` first, and it stays there until re-assigned. */
export function recallTrain(state: RailState, train: Train, grid?: Grid): boolean {
  if (train.status === "stored") return false;
  train.target = "depot";
  return planLeg(state, train, undefined, grid);
}

/**
 * Sell a train back. The epic's rule is explicit: the 50% refund is available
 * only AFTER the train has returned to its depot, and only ONCE. A train still
 * out on the line must be recalled first, so a player cannot mint money by
 * buying and selling inside one tick — at best they lose half of it.
 *
 * "Returned" is `trainAtHome`, not the state name: a train whose route was cut
 * at the depot is `blocked` forever, and a player must still be able to get
 * their 50% back out of it.
 */
export function sellTrain(state: RailState, train: Train): { ok: boolean; why?: string; refund: Purse } {
  if (!trainAtHome(state, train)) {
    return { ok: false, why: "Send the train back to its depot first.", refund: {} };
  }
  if (train.resold) return { ok: false, why: "This train has already been sold.", refund: {} };
  const refund = resaleValue(RAIL_COSTS.train);
  const line = state.lines.find((l) => l.id === train.lineId);
  train.resold = true;
  state.trains.splice(state.trains.indexOf(train), 1);
  if (line) {
    state.lines.splice(state.lines.indexOf(line), 1);
    clearLineLanes(state, line.id);   // RAIL-6: the line's lanes are free again
  }
  return { ok: true, refund };
}

/** Stop running a line but keep the train: home to the depot and stay there. */
export function stopLine(state: RailState, lineId: number, grid?: Grid): boolean {
  let any = false;
  for (const t of state.trains.filter((t) => t.lineId === lineId)) {
    t.target = "depot";
    any = planLeg(state, t, undefined, grid) || any;
  }
  return any;
}

// ── service: what a running line makes reachable (the economy's view) ─────
/**
 * Is the industry served by a RUNNING railway for this owner? Every clause is a
 * rule the epic spelled out:
 *
 *   • the line's train is past its initial depot departure — a stored, blocked
 *     or still-`departing` train proves nothing yet;
 *   • the source platform is anchored to THIS industry and belongs to the owner;
 *   • the destination platform is anchored to one of the owner's own plants;
 *   • source, destination and depot all sit on ONE connected owner component.
 *
 * The economy reads this exactly as it reads `isServiced` for a road depot, so
 * rail grants the same source reachability a road connection does and no more.
 * `earn()` is never called from here: arrivals are cosmetic.
 */
export function railServesIndustry(state: RailState, ownerId: number, industryId: number): boolean {
  for (const line of state.lines) {
    if (line.ownerId !== ownerId) continue;
    const source = structureById(state, line.source);
    const dest = structureById(state, line.dest);
    if (!source || !dest) continue;
    if (source.anchor?.kind !== "industry" || source.anchor.id !== industryId) continue;
    if (dest.anchor?.kind !== "plant") continue;
    const train = state.trains.find((t) => t.lineId === line.id && t.ownerId === ownerId);
    if (!train || train.status === "stored" || train.status === "blocked" || train.status === "departing") continue;
    const depot = depotOfTrain(state, train);
    if (!depot && train.depotId !== 0) continue;
    const comp = railComponents(state, ownerId);
    const home = depot ? depotComponent(comp, depot) : (comp.get(tIdx(...stopTile(source))) ?? 0);
    if (!home) continue;
    const a = comp.get(tIdx(...stopTile(source))) ?? 0;
    const b = comp.get(tIdx(...stopTile(dest))) ?? 0;
    if (a === home && b === home) return true;
  }
  return false;
}

/** Every industry a running railway serves for one owner, as ids. */
export function railServicedIndustries(state: RailState, ownerId: number): Set<number> {
  const out = new Set<number>();
  for (const s of structuresOf(state, ownerId, "platform")) {
    if (s.anchor?.kind !== "industry") continue;
    if (railServesIndustry(state, ownerId, s.anchor.id)) out.add(s.anchor.id);
  }
  return out;
}

/** The Victory Point value of one owner's platforms — live, never historical. */
export const platformVp = (state: RailState, ownerId: number): number =>
  structuresOf(state, ownerId, "platform").length * PLATFORM_VP;

// ── the Railway panel's model ─────────────────────────────────────────────
/**
 * RAIL-6 (#575): `lane` arms the station upgrade — the next click beside the
 * station picks the side the new lane goes on.
 */
export type RailPanelAction = "assign" | "recall" | "sell" | "buy" | "start" | "lane";

export interface RailPanelRow {
  id: number;
  kind: RailKind | "train";
  label: string;
  detail: string;
  /** What the panel offers for this row (the game supplies the callbacks). */
  actions: RailPanelAction[];
  /**
   * For a platform with no line yet: the partner platform `assign` would use.
   * For a depot offering `buy`: the line the train would be bought for.
   */
  partnerId?: number;
}

/**
 * The rows the Railway panel lists: every platform (with its anchor) and depot,
 * every train with its line and status. Kept out of the UI module so the panel
 * is a rendering of the model and a test can assert what a player sees without
 * a DOM.
 */
export function railPanelRows(state: RailState, ownerId: number): RailPanelRow[] {
  const rows: RailPanelRow[] = [];
  const myPlatforms = structuresOf(state, ownerId, "platform");
  for (const s of myPlatforms) {
    const anchor = s.anchor
      ? `${s.anchor.kind === "industry" ? "industry" : "plant"} #${s.anchor.id}`
      : "unanchored";
    const lines = state.lines.filter((l) => l.source === s.id || l.dest === s.id);
    const line = lines[0];
    let partnerId: number | undefined;
    if (!line && s.anchor?.kind === "industry") {
      const dest = myPlatforms.find((p) => p.anchor?.kind === "plant");
      if (dest) partnerId = dest.id;
    }
    // RAIL-6 (#575): a platform reads as what it is — a station with lanes.
    // The row says how many lanes stand, how many are busy right now, and
    // offers the upgrade (priced by the game, which owns the money table)
    // until the station holds four.
    const lanes = stationLanes(s);
    const busy = lanes.filter((l) => laneHolder(state, s.id, l.id)).length;
    rows.push({
      id: s.id,
      kind: "platform",
      label: `Station · ${lanes.length} lane${lanes.length === 1 ? "" : "s"} (${s.view}) · ${anchor}`,
      detail: line
        ? `line${lines.length > 1 ? "s" : ""}: ${lines.map((l) => l.name).join(", ")}`
          + ` · ${busy}/${lanes.length} lane${lanes.length === 1 ? "" : "s"} busy`
        : `${PLATFORM_VP}★ · not on a line`,
      // Playtest (2026-09): trains spawn on their own (`autoTrains`), so a
      // platform offers nothing to click — connecting it by rail is the
      // action. RAIL-6: the one click a station does offer is the lane.
      actions: lanes.length < MAX_LANES ? ["lane"] : [],
      partnerId,
    });
  }
  // #179: a depot with no train offers "Buy train" for a line that has none,
  // when the depot sits on that line's network and the network is free.
  // Computed only when some line is still idle, so a running railway pays no
  // network flood per paint. `buyTrain` re-checks all of it on the click.
  const idleLines = state.lines.filter(
    (l) => l.ownerId === ownerId && !state.trains.some((t) => t.lineId === l.id),
  );
  const comp = idleLines.length ? railComponents(state, ownerId) : null;
  for (const s of structuresOf(state, ownerId, "depot")) {
    const train = state.trains.find((t) => t.depotId === s.id);
    const home = !train && comp ? depotComponent(comp, s) : 0;
    const networkBusy = home !== 0 && state.trains.some((t) => {
      if (t.ownerId !== ownerId) return false;
      const d = depotOfTrain(state, t);
      return d ? depotComponent(comp!, d) === home : false;
    });
    const buyFor = home !== 0 && !networkBusy
      ? idleLines.find((l) => {
        const src = structureById(state, l.source);
        return src ? (comp!.get(tIdx(...stopTile(src))) ?? 0) === home : false;
      })
      : undefined;
    rows.push({
      id: s.id,
      kind: "depot",
      label: `Train Depot (${s.view})`,
      // "based here", not "at home": the train this depot owns is usually out
      // on its line, and the row must not promise it is parked.
      detail: train ? "train based here" : buyFor ? `no train · ready for ${buyFor.name}` : "no train",
      actions: buyFor ? ["buy"] : [],
      partnerId: buyFor?.id,
    });
  }
  for (const t of state.trains) {
    if (t.ownerId !== ownerId) continue;
    const line = state.lines.find((l) => l.id === t.lineId);
    rows.push({
      id: t.id,
      kind: "train",
      label: line?.name ?? "Train",
      detail: trainStatusText(t),
      // A blocked train stopped on its depot exit is home (see `trainAtHome`)
      // and offers its 50% sale rather than a recall that can never route.
      // #179: a train parked in its shed on a line can be started as well as sold.
      actions: t.depotId === 0 ? [] : trainAtHome(state, t)
        ? (t.status === "stored" && line ? ["start", "sell"] : ["sell"])
        : ["recall"],
    });
  }
  return rows;
}

export function trainStatusText(t: Train): string {
  switch (t.status) {
    case "stored": return "waiting at the depot";
    case "departing": return "departing — running to the source platform";
    case "moving": return `running to the ${t.target === "source" ? "source" : "destination"} platform`;
    case "dwelling": return `dwelling at the ${t.target} — ${(Math.ceil(t.dwellMs / 100) / 10).toFixed(1)}s`;
    case "returning": return "returning to the depot";
    case "blocked": return `blocked — ${t.blockedWhy ?? "no route"}`;
    // RAIL-6 (#575): the queue at a full station, in the player's words.
    case "holding": return "waiting at the throat — every lane of the station is busy";
  }
}

// ── drawing ───────────────────────────────────────────────────────────────
/** Art sprite names (see tools/make-railway-art.mjs for the authored files). */
export const platformSprite = (view: RailView): string => `platform_${view}`;
export const depotSprite = (view: RailView): string => `train-depot_${view}`;
/**
 * RAIL-6 (#575) — THE STATION ART (art drop #578). The warehouse ships in three
 * tiers (`assets/stations/station_wh_{1,2,3}@2x.png`, the tier following the
 * lane count) and the platform end as a cap (`station_cap@2x.png`), each with
 * an `_r` orientation for the other axis. The lane slab between them is
 * painted in code — flat concrete with an edge line over the track bed — and
 * installed as `station_lane_<view>`; there is no lane sprite. A station draws
 * as warehouse + one slab item per lane strip tile + a cap at every lane end:
 * each its own depth-sorted item, lanes visited in map order, so the draw
 * order is stable and nothing flickers between lanes.
 */
export const stationWhSprite = (tier: number, view: RailView): string =>
  `station_wh_${Math.min(3, Math.max(1, tier))}${view === "se" || view === "nw" ? "_r" : ""}`;
export const stationCapSprite = (view: RailView): string =>
  (view === "se" || view === "nw" ? "station_cap_r" : "station_cap");
export const laneSlabSprite = (view: RailView): string => `station_lane_${view}`;
/**
 * The tile the warehouse stands on: the HEAD of the station's first lane — the
 * platform's own end tile, exactly where a station house sits at the end of a
 * platform. Keeping it ON the lane (never beside it) is what keeps the painter
 * order exact: warehouse, then slab tile by slab tile, then the cap — depth
 * keys rising along the row, so nothing ever draws over anything it stands
 * behind.
 */
export function stationWarehouseTile(s: RailStructure): [number, number] {
  const l = stationLanes(s)[0];
  return [l.tx, l.ty];
}
/** The lane strip tile a cap finishes: the far end of the lane from the warehouse. */
export const laneCapTile = (l: RailLane): [number, number] => {
  const slab = laneSlabTiles(l);
  return slab[slab.length - 1];
};
export const VIEW_NAME: Record<number, RailView> = { [NE]: "ne", [SE]: "se", [SW]: "sw", [NW]: "nw" };

export interface RailSpriteSource { has(name: string): boolean }

/**
 * The structures as draw items. Exactly like every other building: the sprite is
 * placed at the footprint origin with a `ref` payload, so clicking an arm of the
 * platform selects the platform. Rail TILES are not draw items — they are
 * ground, painted by the renderer's chunk pass from the layer bytes.
 *
 * RAIL-6 (#575): a platform draws as its STATION — warehouse, lane slabs, caps —
 * when the station art is installed; with no `atlas` (or the art missing) it
 * falls back to the one platform sprite it always had, so a map without the
 * station PNGs is the same map, only undressed.
 */
export function railStructureItems(state: RailState, atlas?: RailSpriteSource): DrawItem[] {
  const out: DrawItem[] = [];
  for (const s of state.structures) {
    const ref = { kind: "rail", structure: s.id, railKind: s.kind, ownerId: s.ownerId };
    if (s.kind === "depot") {
      out.push({ sprite: depotSprite(s.view), tx: s.tx, ty: s.ty, ref });
      continue;
    }
    const lanes = stationLanes(s);
    const tier = stationWarehouseTier(lanes.length);
    if (atlas && !atlas.has(stationWhSprite(tier, s.view))) {
      out.push({ sprite: platformSprite(s.view), tx: s.tx, ty: s.ty, ref });
      continue;
    }
    const [wx, wy] = stationWarehouseTile(s);
    out.push({ sprite: stationWhSprite(tier, s.view), tx: wx, ty: wy, ref });
    for (let li = 0; li < lanes.length; li++) {
      const l = lanes[li];
      const slab = laneSlabTiles(l);
      // The cap finishes the lane's far end; the slab tiles before it are the
      // code-painted concrete strip. The first lane's head tile is the
      // warehouse's own ground, so no slab is painted under it.
      for (let i = li === 0 ? 1 : 0; i < slab.length - 1; i++) {
        out.push({ sprite: laneSlabSprite(l.view), tx: slab[i][0], ty: slab[i][1], ref });
      }
      const [cx, cy] = laneCapTile(l);
      out.push({ sprite: stationCapSprite(l.view), tx: cx, ty: cy, ref });
    }
  }
  return out;
}

/**
 * RAIL-7 (#603) — GHOST HELPERS: one source of truth for what a placed
 * station looks like. The ghost and the placed structure call the SAME sprite
 * lookup (stationWhSprite / laneSlabSprite / stationCapSprite / depotSprite)
 * and the SAME tile helpers (laneSlabTiles / laneCapTile /
 * stationWarehouseTile), so they cannot drift again.
 *
 * The overlay (game.ts) builds its ghost from these; the unit test
 * rail-7-ghost.test.ts asserts that the ghost's sprite keys equal the placed
 * structure's sprite keys for every rotation.
 */
export interface GhostDrawItem { sprite: string; tx: number; ty: number; }

/** The warehouse + one slab + cap that a 1-lane platform placement will build. */
export function platformGhostItems(tx: number, ty: number, view: RailView, tier: number = 1): GhostDrawItem[] {
  const wh = stationWhSprite(tier, view);
  const lane = { view, tx, ty } as RailLane;
  const slab = laneSlabTiles(lane);
  const cap = laneCapTile(lane);
  const out: GhostDrawItem[] = [];
  out.push({ sprite: wh, tx, ty });
  if (slab.length >= 2) {
    out.push({ sprite: laneSlabSprite(view), tx: slab[1][0], ty: slab[1][1] });
  }
  out.push({ sprite: stationCapSprite(view), tx: cap[0], ty: cap[1] });
  return out;
}

/** A train depot ghost — same sprite as the placed depot. */
export function depotGhostItems(tx: number, ty: number, view: RailView): GhostDrawItem[] {
  return [{ sprite: depotSprite(view), tx, ty }];
}

/** The lane that a station upgrade will add: two slabs + cap. */
export function laneGhostItems(tx: number, ty: number, view: RailView): GhostDrawItem[] {
  const lane = { view, tx, ty } as RailLane;
  const slab = laneSlabTiles(lane);
  const cap = laneCapTile(lane);
  const out: GhostDrawItem[] = [];
  for (let i = 0; i < slab.length - 1; i++) {
    out.push({ sprite: laneSlabSprite(view), tx: slab[i][0], ty: slab[i][1] });
  }
  out.push({ sprite: stationCapSprite(view), tx: cap[0], ty: cap[1] });
  return out;
}


/**
 * A train as two moving draw items: the locomotive on its own ground point and
 * the wagon `WAGON_OFFSET` tiles behind it ON THE SAME POLYLINE, so both follow
 * the track around a corner instead of the wagon cutting across it. A sprite
 * that is not installed (art missing) is skipped rather than drawn as nothing —
 * the same non-gating contract the branded lorries keep.
 */
export function trainItems(state: RailState, atlas?: RailSpriteSource): DrawItem[] {
  const out: DrawItem[] = [];
  for (const train of state.trains) {
    for (const c of carPlacements(state, train)) {
      const name = `car-${c.kind}_${OCT_NAMES[c.oct]}`;
      if (atlas && !atlas.has(name)) continue;
      out.push({ sprite: name, tx: Math.round(c.fx), ty: Math.round(c.fy), fx: c.fx, fy: c.fy });
    }
  }
  return out;
}

// ── the wire (RAIL-04 / #178) ─────────────────────────────────────────────
/**
 * The railway as a snapshot/delta carries it. Structures, lines and trains
 * always ride — a guest's panel and its trains need them every tick — but not
 * every FIELD of every train: a leg's tiles are ~40 numbers for a 20-tile line
 * and only change when the train is replanned, so a caller that passes a
 * `routeCache` gets the route once and progress (dist, status, dwell) after
 * that (#142: "replicate graph changes and routes only by revision; train
 * progress via compact updates and interpolation"). The two base64 layers are
 * ~2 KB each, so a steady-state delta whose rail revision has not moved passes
 * `layers: false` and the guest keeps the bytes it already has; a join or
 * resync always sends both the layers and the routes.
 *
 * A world with no railway returns `undefined` and `buildPublish` keeps the
 * field off the wire entirely — a rail-free match pays nothing for this.
 */
export function railToWire(
  state: RailState,
  opts: { layers?: boolean; routeCache?: Map<number, [number, number][]> } = {},
): RailWire | undefined {
  const empty = state.rail.revision === 0 && state.structures.length === 0
    && state.lines.length === 0 && state.trains.length === 0;
  if (empty) return undefined;
  const wire: RailWire = {
    revision: state.rail.revision,
    seq: state.seq,
    structures: state.structures.map((s) => ({
      id: s.id, kind: s.kind, ownerId: s.ownerId, owner: s.owner,
      tx: s.tx, ty: s.ty, w: s.w, h: s.h, view: s.view,
      anchor: s.anchor
        ? { kind: s.anchor.kind, id: s.anchor.id, tiles: s.anchor.tiles.map((t) => [...t] as [number, number]) }
        : null,
      // RAIL-6 (#575): the station's lanes ride with the structure — a guest's
      // station has the same lanes, the same assignments, the same warehouse
      // tier, from the same bytes.
      lanes: s.kind === "platform"
        ? stationLanes(s).map((l) => ({ id: l.id, view: l.view, tx: l.tx, ty: l.ty, lineId: l.lineId }))
        : undefined,
    })),
    lines: state.lines.map((l) => ({ ...l })),
    trains: state.trains.map((t) => {
      const record: TrainWire = { ...t, route: t.route.map((r) => [...r] as [number, number]) };
      // `planLeg` REPLACES the route array whenever it replans, so array
      // identity is the cheapest exact test that the guest's copy is current.
      if (opts.routeCache) {
        if (opts.routeCache.get(t.id) === t.route) delete record.route;
        else opts.routeCache.set(t.id, t.route);
      }
      return record;
    }),
  };
  if (opts.layers !== false) {
    wire.tile = bytesToBase64(state.rail.tile);
    wire.owner = bytesToBase64(state.rail.owner);
  }
  return wire;
}

/** One tile's two rail bytes — a sparse layer patch record. */
/**
 * Every tile whose rail bytes differ from the caller's shadow copy. A built
 * railway is SPARSE — a line is a few dozen tiles of a 20 736-tile map — while
 * one base64 layer is 27 KB and cannot fit a single frame next to the four road
 * layers the delta already carries (16 KiB cap), so a steady-state publish
 * sends the patch and only a join/resync sends the layers whole.
 */
export function railLayerPatch(
  state: RailState, prevTile: Uint8Array, prevOwner: Uint8Array,
): RailTileWire[] {
  const out: RailTileWire[] = [];
  const tile = state.rail.tile, owner = state.rail.owner;
  for (let i = 0; i < tile.length; i++) {
    if (tile[i] !== prevTile[i] || owner[i] !== prevOwner[i]) {
      out.push({ i, tile: tile[i], owner: owner[i] });
    }
  }
  return out;
}

/** Snapshot the layer into the two shadow buffers a patch is computed against. */
export function copyRailLayer(
  state: RailState, intoTile: Uint8Array, intoOwner: Uint8Array,
): void {
  intoTile.set(state.rail.tile);
  intoOwner.set(state.rail.owner);
}

const asView = (v: unknown): RailView =>
  (RAIL_VIEWS as readonly string[]).includes(v as string) ? (v as RailView) : "se";
const asKind = (k: unknown): RailKind => (k === "depot" ? "depot" : "platform");
const asStatus = (s: unknown): TrainStatus =>
  TRAIN_STATUSES.includes(s as TrainStatus) ? (s as TrainStatus) : "stored";
const asTarget = (t: unknown): Train["target"] =>
  t === "source" || t === "dest" || t === "depot" ? t : "depot";

/**
 * Apply a wire onto local rail state (guest side). Tolerant reader, like
 * `applyTrackDelta`: an absent wire is a no-op, layer bytes of the wrong size
 * are skipped, an ABSENT `tile`/`owner` pair means "unchanged" — the guest
 * keeps the bytes it already has — and a train record with no `route` keeps
 * the leg this guest already holds (`railToWire` sends a route only when the
 * train is replanned). Structures, lines and trains are replaced wholesale,
 * because the host is authoritative for all three.
 *
 * Returns true when anything was applied, so the caller can rebuild the
 * vehicle list.
 */
export function applyRailWire(state: RailState, wire: RailWire | null | undefined): boolean {
  if (!wire || typeof wire !== "object") return false;
  if (typeof wire.tile === "string" && typeof wire.owner === "string") {
    const tile = base64ToBytes(wire.tile), owner = base64ToBytes(wire.owner);
    if (tile.length === state.rail.tile.length && owner.length === state.rail.owner.length) {
      state.rail.tile.set(tile);
      state.rail.owner.set(owner);
    }
  } else if (Array.isArray(wire.tiles)) {
    // The sparse half of the same story: a handful of records instead of two
    // 27 KB layers. Out-of-range indices and byte values are skipped.
    for (const t of wire.tiles) {
      if (!t || !Number.isInteger(t.i) || t.i < 0 || t.i >= state.rail.tile.length) continue;
      if (Number.isInteger(t.tile) && t.tile >= 0 && t.tile <= 255) state.rail.tile[t.i] = t.tile;
      if (Number.isInteger(t.owner) && t.owner >= 0 && t.owner <= 255) state.rail.owner[t.i] = t.owner;
    }
  }
  if (typeof wire.revision === "number" && Number.isFinite(wire.revision)) {
    state.rail.revision = Math.max(state.rail.revision + 1, wire.revision);
  } else {
    state.rail.revision++;
  }
  if (typeof wire.seq === "number" && Number.isFinite(wire.seq)) state.seq = wire.seq;
  state.structures.length = 0;
  for (const s of Array.isArray(wire.structures) ? wire.structures : []) {
    if (!s || typeof s.tx !== "number" || typeof s.ty !== "number") continue;
    state.structures.push({
      id: s.id, kind: asKind(s.kind), ownerId: s.ownerId, owner: s.owner,
      tx: s.tx, ty: s.ty, w: s.w, h: s.h, view: asView(s.view),
      anchor: s.anchor && typeof s.anchor.id === "number"
        ? {
            kind: s.anchor.kind === "plant" ? "plant" : "industry",
            id: s.anchor.id,
            tiles: (s.anchor.tiles ?? []).map((t) => [...t] as [number, number]),
          }
        : null,
      // RAIL-6 (#575): tolerant like every other field here — a lane record
      // without coordinates is skipped, and a structure with NO lanes array
      // stays lane-less until `stationLanes` materialises its lane 0 (the
      // pre-RAIL-6 shape, from an old host or an old save).
      lanes: asKind(s.kind) === "platform" && Array.isArray(s.lanes)
        ? s.lanes
          .filter((l) => l && typeof l.tx === "number" && typeof l.ty === "number")
          .map((l) => ({
            id: typeof l.id === "number" ? l.id : 0,
            view: asView(l.view),
            tx: l.tx, ty: l.ty,
            lineId: typeof l.lineId === "number" ? l.lineId : null,
          }))
        : undefined,
    });
  }
  state.lines.length = 0;
  for (const l of Array.isArray(wire.lines) ? wire.lines : []) state.lines.push({ ...l });
  // A train record with no `route` means "the route you hold is current"
  // (#142: routes ride only when replanned), so the previous leg is carried
  // over — for a train this guest has never seen, there is nothing to carry
  // and it stands still until the next full snapshot.
  const prevRoutes = new Map(state.trains.map((t) => [t.id, t.route] as const));
  state.trains.length = 0;
  for (const t of Array.isArray(wire.trains) ? wire.trains : []) {
    if (!t || typeof t.id !== "number") continue;
    const route = (Array.isArray(t.route) ? t.route : (prevRoutes.get(t.id) ?? []))
      .map((r) => [...r] as [number, number]);
    state.trains.push({
      id: t.id, ownerId: t.ownerId, lineId: t.lineId, depotId: t.depotId,
      status: asStatus(t.status), target: asTarget(t.target),
      route,
      dist: t.dist,
      // #401: preserve legacy track, but never resume a saved sharp route.
      planRevision: route.some((p, i, route) => i >= 2 && !turnOk(
        octantOf(route[i - 1][0] - route[i - 2][0], route[i - 1][1] - route[i - 2][1]),
        octantOf(p[0] - route[i - 1][0], p[1] - route[i - 1][1]),
      )) ? -1 : t.planRevision,
      dwellMs: t.dwellMs,
      dirBit: t.dirBit, resold: !!t.resold, blockedWhy: t.blockedWhy,
      // RAIL-6 (#575): the lane booking and the queue position ride with the
      // train; an old record without them reads as "no lane held".
      laneId: typeof t.laneId === "number" ? t.laneId : null,
      holdStation: typeof t.holdStation === "number" ? t.holdStation : null,
    });
  }
  return true;
}

/**
 * The "no railway" half of the wire: a join or resync from a host with no rail
 * must leave the guest with no railway, not a stale one. (A DELTA without a
 * `rail` field means "unchanged", so only the full-state path calls this.)
 */
export function clearRail(state: RailState): boolean {
  // Emptiness is CONTENT, not a revision: a cleared layer that gets cleared
  // again is a no-op, and the guest's own revision must not make it look dirty.
  let had = state.structures.length > 0 || state.lines.length > 0 || state.trains.length > 0;
  if (!had) {
    for (let i = 0; i < state.rail.tile.length; i++) {
      if (state.rail.tile[i] !== 0 || state.rail.owner[i] !== 0) { had = true; break; }
    }
  }
  if (!had) return false;
  state.rail.tile.fill(0);
  state.rail.owner.fill(0);
  state.rail.revision++;
  state.structures.length = 0;
  state.lines.length = 0;
  state.trains.length = 0;
  state.trails?.clear();
  state.seq = 1;
  return true;
}

// ── the build palette's rows, priced from the one table ───────────────────
export const RAIL_TOOLS = [
  { key: "rail", label: "Railway Track", cost: RAIL_COSTS.rail },
  { key: "platform", label: "Rail Platform", cost: RAIL_COSTS.platform },
] as const;
export type RailToolKey = typeof RAIL_TOOLS[number]["key"];
