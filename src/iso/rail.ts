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
//   RAIL AT A CROSSING ONLY ON A STRAIGHT ROAD, PERPENDICULAR. A level crossing
//   preserves the road's bits, owner and upgrade provenance exactly; the rail
//   gets its own layer beside it. No curves, no junctions, and no transfer
//   between the road graph and the rail graph at a crossing.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W } from "../game/config";
import { BUILD_COSTS, CARGOES, INDUSTRY_BY_KEY, VICTORY, type Cargo } from "./config";
import {
  NE, SE, SW, NW, DIRS, DIR, OPPOSITE, PRESENT, tIdx, inMapT, plantFootprintTiles,
  addCost, lPath, type DragPreview, type Purse, type Track,
} from "./track";
import { FIELD_OCC, GRASS, ROUGH, SAND, idx, type Grid } from "./grid";
import { TRUCK_SPEED } from "./vehicles";
import type { DrawItem } from "./depth";
import { base64ToBytes, bytesToBase64, type RailTileWire, type RailWire, type TrainWire } from "./snapshot";

// ── bits ──────────────────────────────────────────────────────────────────
export const RAIL_PRESENT = PRESENT;
export const RAIL_BITS = 0b1111;

/** The four quarter-turns a platform or a depot may be built in. */
export const RAIL_VIEWS = ["ne", "se", "sw", "nw"] as const;
export type RailView = typeof RAIL_VIEWS[number];

const VIEW_BIT: Record<RailView, number> = { ne: NE, se: SE, sw: SW, nw: NW };
export const VIEW_OF_BIT: Record<number, RailView> = { [NE]: "ne", [SE]: "se", [SW]: "sw", [NW]: "nw" };

/** Platform footprints by heading: the lane along NE/SW is 2 wide × 3 deep. */
export const PLATFORM_FOOTPRINT: Record<RailView, [number, number]> = {
  ne: [2, 3], sw: [2, 3], se: [3, 2], nw: [3, 2],
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
  rail: Purse; platform: Purse; depot: Purse; train: Purse;
}> = {
  rail: BUILD_COSTS.rail,
  platform: BUILD_COSTS.platform,
  depot: BUILD_COSTS.trainDepot,
  train: BUILD_COSTS.train,
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

const isStraight = (mask: number): boolean => mask === (NE | SW) || mask === (SE | NW);

/**
 * A level crossing: rail may be laid over a road tile only when the road is an
 * EMPTY STRAIGHT segment and the rail crosses it PERPENDICULARLY. Curves and
 * junctions are refused, and the road's bits, owner and upgrade provenance are
 * never written — the crossing exists purely as two overlapping tile models.
 */
export function crossingOk(track: Track, tx: number, ty: number, railMask: number): boolean {
  return crossingMasksOk(roadAt(track, tx, ty), railMask);
}

/**
 * The SHAPE half of `crossingOk`, on masks alone.
 *
 * Exported because the RENDERER has to classify a tile as a crossing from the
 * layer bytes it was handed, with no `Track` in reach — and the geometry that
 * draws the planks must agree with the rule that allowed them, or a legal
 * crossing would be drawn as track laid across an open road. `rail-geometry.ts`
 * cannot import this (a value import there would close a runtime cycle through
 * `track.ts` and `renderer.ts`), so it re-states these four lines and the unit
 * test drives all 16 × 16 mask pairs through both to prove they agree.
 */
export function crossingMasksOk(roadMask: number, railMask: number): boolean {
  const road = roadMask & 0b1111, rail = railMask & 0b1111;
  if (road === 0) return false;
  if (!isStraight(road)) return false;      // no curves or junctions at a crossing
  if (!isStraight(rail)) return false;      // ditto for the rail
  return road !== rail;                     // perpendicular, never shared
}

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
}

export interface RailState {
  rail: Rail;
  structures: RailStructure[];
  lines: RailLine[];
  trains: Train[];
  /** Monotonic id allocator across structures, lines and trains. */
  seq: number;
}

export const createRailState = (): RailState => ({
  rail: createRail(),
  structures: [],
  lines: [],
  trains: [],
  seq: 1,
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

/** The tile a train stops at: the middle of the lane. */
export function stopTile(s: RailStructure): [number, number] {
  const lane = laneTiles(s);
  return lane[(lane.length - 1) >> 1];
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
  const lane = laneTiles(s);
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
      const mask = effectiveMask(state, x, y);
      for (const d of DIRS) {
        if (!(mask & d)) continue;
        const nx = x + DIR[d][0], ny = y + DIR[d][1];
        if (effectiveOwner(state, nx, ny) !== ownerId) continue;
        if (!(effectiveMask(state, nx, ny) & OPPOSITE[d])) continue;
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
  from: [number, number][], goals: Set<number>,
): [number, number][] | null {
  if (!goals.size || !from.length) return null;
  const parent = new Map<number, number>();
  const queue: number[] = [];
  for (const [x, y] of from) {
    if (!railDrivable(state, ownerId, x, y)) continue;
    const i = tIdx(x, y);
    if (parent.has(i)) continue;
    parent.set(i, -1);
    queue.push(i);
  }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (goals.has(cur)) {
      const path: number[] = [];
      for (let i = cur; i !== -1; i = parent.get(i) as number) path.push(i);
      path.reverse();
      return path.map((i) => [i % MAP_W, (i / MAP_W) | 0] as [number, number]);
    }
    const x = cur % MAP_W, y = (cur / MAP_W) | 0;
    const mask = effectiveMask(state, x, y);
    for (const d of DIRS) {
      if (!(mask & d)) continue;
      const nx = x + DIR[d][0], ny = y + DIR[d][1];
      if (!railDrivable(state, ownerId, nx, ny)) continue;
      if (!(effectiveMask(state, nx, ny) & OPPOSITE[d])) continue;
      const ni = tIdx(nx, ny);
      if (parent.has(ni)) continue;
      parent.set(ni, cur);
      queue.push(ni);
    }
  }
  return null;
}

// ── refusals: one vocabulary for the preview, the click, the rival, the host ─
export type RailRefusal =
  | "ok" | "off-map" | "water" | "occupied" | "road-parallel" | "crossing-curve"
  | "foreign-rail" | "component-conflict" | "no-anchor" | "anchor-taken"
  | "no-network" | "exit-blocked" | "overlap" | "anchor-range" | "train-in-way"
  | "not-yours" | "missing";

export const RAIL_REFUSAL_TEXT: Record<RailRefusal, string> = {
  ok: "",
  "off-map": "That is off the map.",
  water: "Rail cannot be laid on water.",
  occupied: "Something else stands there.",
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

/**
 * Everything that makes one rail tile illegal — as a CODE, so the preview, the
 * click, the rival AI and a host's validation all answer the same question with
 * the same vocabulary (`RAIL_REFUSAL_TEXT` is the one wording).
 */
export function railTileRefusal(
  grid: Grid, track: Track, state: RailState, ownerId: number, tx: number, ty: number,
  planned?: ReadonlySet<number>,
): RailRefusal {
  if (!inMapT(tx, ty)) return "off-map";
  if (!railTerrainOk(grid, tx, ty)) return "water";
  // Anything built on the tile blocks rail: a town, an industry, a depot, a
  // plant, a platform, or a train standing on it.
  if (grid.occupancy[tIdx(tx, ty)] >= 0 || grid.occupancy[tIdx(tx, ty)] === FIELD_OCC) return "occupied";
  if (structureAt(state, tx, ty)) return "occupied";
  if (trainOccupies(state, tx, ty)) return "train-in-way";
  const owner = state.rail.owner[tIdx(tx, ty)];
  if ((state.rail.tile[tIdx(tx, ty)] & RAIL_PRESENT) && owner !== ownerId) return "foreign-rail";
  const road = roadAt(track, tx, ty);
  if (road !== 0) {
    // A crossing is judged on the FINAL shape: a straight drag across a straight
    // road is legal while a curve, a corner or a junction is not.
    const finalMask = prospectiveMask(state, tx, ty, ownerId, planned);
    // The road itself must be an empty straight segment ...
    if (!isStraight(road)) return "crossing-curve";
    // ... and the rail must be a straight line ACROSS it, never along it.
    if (road === finalMask) return "road-parallel";
    if (!isStraight(finalMask) || !crossingOk(track, tx, ty, finalMask)) return "crossing-curve";
  }
  return "ok";
}

function writeRailTile(state: RailState, ownerId: number, tx: number, ty: number): void {
  const i = tIdx(tx, ty);
  state.rail.tile[i] = RAIL_PRESENT;
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
 * Recompute the four bits of every rail tile in and around `tiles` — the same
 * "only the tile plus its neighbours" discipline `track.ts` uses, so a drag of
 * twenty tiles is twenty small writes and never a map scan.
 */
export function autotileRail(state: RailState, tiles: [number, number][]): void {
  const touched = new Set<number>();
  for (const [x, y] of tiles) {
    touched.add(tIdx(x, y));
    for (const d of DIRS) {
      const nx = x + DIR[d][0], ny = y + DIR[d][1];
      if (inMapT(nx, ny)) touched.add(tIdx(nx, ny));
    }
  }
  for (const i of touched) {
    if (!(state.rail.tile[i] & RAIL_PRESENT)) continue;
    const x = i % MAP_W, y = (i / MAP_W) | 0;
    let mask = 0;
    for (const d of DIRS) {
      if (sameOwnerRail(state, state.rail.owner[i], x + DIR[d][0], y + DIR[d][1])) mask |= d;
    }
    state.rail.tile[i] = mask | RAIL_PRESENT;
  }
  state.rail.revision++;
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
export function buildRail(
  grid: Grid, track: Track, state: RailState, ownerId: number, tiles: [number, number][],
): RailBuildResult {
  const built: [number, number][] = [];
  // The merge guard can only ever fire with two or more trains on the map, so a
  // player who owns none pays no component scan per tile at all.
  const guardMerge = trainsOf(state, ownerId).length > 1;
  // The whole gesture is the "final shape" a crossing is judged against.
  const planned = new Set(tiles.map(([x, y]) => tIdx(x, y)));
  let charged = 0;
  for (const [tx, ty] of tiles) {
    const why = railTileRefusal(grid, track, state, ownerId, tx, ty, planned);
    if (why !== "ok") return { ok: built.length > 0, why, cost: railCost(charged), built };
    // Rail you already own is stepped over for free — a drag that redraws part
    // of an existing line (or crosses its own track at a junction) pays only
    // for the new tiles, exactly like a road drag over your own road.
    const already = (state.rail.tile[tIdx(tx, ty)] & RAIL_PRESENT) !== 0
      && state.rail.owner[tIdx(tx, ty)] === ownerId;
    if (!already) charged++;
    const beforeTile = state.rail.tile[tIdx(tx, ty)];
    const beforeOwner = state.rail.owner[tIdx(tx, ty)];
    writeRailTile(state, ownerId, tx, ty);
    autotileRail(state, [[tx, ty]]);
    if (!guardMerge) { built.push([tx, ty]); continue; }
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
      // Restore exactly what stood here before (a merge can be attempted over a
      // tile that was already rail), then recompute the neighbourhood's bits.
      state.rail.tile[tIdx(tx, ty)] = beforeTile;
      state.rail.owner[tIdx(tx, ty)] = beforeOwner;
      autotileRail(state, [[tx, ty]]);
      return { ok: built.length > 0, why: "component-conflict", cost: railCost(charged), built };
    }
    built.push([tx, ty]);
  }
  // `charged`, not `built.length`: a drag that redraws rail you already own
  // lays tiles but pays for none of them.
  return { ok: built.length > 0, why: "ok", cost: railCost(charged), built };
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
 *     vocabulary) rather than routing around it — a drag lays the shape the
 *     player drew, and everything past an illegal tile is off;
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
  ax: number, ay: number, bx: number, by: number, xFirst = true,
): RailPreviewResult {
  const path = lPath(ax, ay, bx, by, xFirst);
  const planned = new Set(path.map(([x, y]) => tIdx(x, y)));
  const tiles: [number, number][] = [];
  const unaffordable: [number, number][] = [];
  let cost: Purse = {};
  let why: RailRefusal | null = null;
  let truncated = false;
  for (let i = 0; i < path.length; i++) {
    const [x, y] = path[i];
    const already = (state.rail.tile[tIdx(x, y)] & RAIL_PRESENT) !== 0
      && state.rail.owner[tIdx(x, y)] === ownerId;
    if (!already) {
      const refusal = railTileRefusal(grid, track, state, ownerId, x, y, planned);
      if (refusal !== "ok") { why = refusal; truncated = true; break; }
      const next = addCost(cost, RAIL_COSTS.rail);
      if (!canPay(purse, next)) {
        // Everything from here on is what the purse cannot reach: the overlay
        // paints it as "not this drag", exactly like the road preview.
        for (let j = i; j < path.length; j++) {
          const [ux, uy] = path[j];
          if (railTileRefusal(grid, track, state, ownerId, ux, uy, planned) !== "ok") { truncated = true; break; }
          unaffordable.push([ux, uy]);
        }
        break;
      }
      cost = next;
    }
    tiles.push([x, y]);
  }
  return { tiles, cost, upgrades: 0, free: 0, unaffordable, truncated, why };
}

export function demolishRail(state: RailState, tx: number, ty: number): boolean {
  if (!hasRail(state.rail, tx, ty)) return false;
  if (trainOccupies(state, tx, ty)) return false;
  state.rail.tile[tIdx(tx, ty)] = 0;
  state.rail.owner[tIdx(tx, ty)] = 0;
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
  factories: { ownerId: number; tx: number; ty: number; id?: number }[],
  ownerId: number, tx: number, ty: number, view: RailView,
): AnchorCandidate[] {
  const [w, h] = PLATFORM_FOOTPRINT[view];
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
    const tiles = plantFootprintTiles(f.tx, f.ty);
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
  factories: { ownerId: number; tx: number; ty: number; id?: number }[],
  ownerId: number, tx: number, ty: number, view: RailView,
  anchor?: RailAnchor | null,
): RailRefusal {
  if (!inMapT(tx, ty)) return "off-map";
  const [w, h] = PLATFORM_FOOTPRINT[view];
  if (!inMapT(tx + w - 1, ty + h - 1)) return "off-map";
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!railTerrainOk(grid, tx + x, ty + y)) return "water";
    if (grid.occupancy[tIdx(tx + x, ty + y)] >= 0 || grid.occupancy[tIdx(tx + x, ty + y)] === FIELD_OCC) return "occupied";
  }
  if (structures.some((s) => overlaps(s, tx, ty, w, h))) return "overlap";
  const candidates = anchorCandidates(grid, factories, ownerId, tx, ty, view);
  if (!candidates.length) return "no-anchor";
  const chosen = anchor
    ? candidates.find((c) => c.kind === anchor.kind && c.id === anchor.id)
    : candidates[0];
  if (!chosen) return "anchor-range";
  const taken = structures.some((s) => s.kind === "platform" && s.ownerId === ownerId
    && s.anchor && s.anchor.kind === chosen.kind && s.anchor.id === chosen.id);
  if (taken) return "anchor-taken";
  return "ok";
}

/** The anchor a placement will actually record, given an explicit preference. */
export function resolveAnchor(
  grid: Grid, factories: { ownerId: number; tx: number; ty: number; id?: number }[],
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
  if (!inMapT(tx, ty)) return "off-map";
  const [w, h] = DEPOT_FOOTPRINT;
  if (!inMapT(tx + w - 1, ty + h - 1)) return "off-map";
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!railTerrainOk(grid, tx + x, ty + y)) return "water";
    if (grid.occupancy[tIdx(tx + x, ty + y)] >= 0 || grid.occupancy[tIdx(tx + x, ty + y)] === FIELD_OCC) return "occupied";
  }
  if (state.structures.some((s) => overlaps(s, tx, ty, w, h))) return "overlap";
  const probe: RailStructure = { id: -1, kind: "depot", ownerId, owner: "", tx, ty, w, h, view };
  const exit = depotExit(probe);
  // The exit tile itself may already be the owner's rail (a depot straddling the
  // end of a line), or the tile the exit FACES may be. The reciprocal bit is not
  // required up front: the depot's lane supplies its own half of the join, and
  // placing it autotiles the neighbour.
  if (railOpenTo(state.rail, ownerId, exit.tx, exit.ty)) return "ok";
  const nx = exit.tx + DIR[exit.dir][0], ny = exit.ty + DIR[exit.dir][1];
  if (railOpenTo(state.rail, ownerId, nx, ny)) return "ok";
  // Nothing to join: is the tile even capable of carrying rail?
  if (!inMapT(nx, ny) || !railTerrainOk(grid, nx, ny)) return "exit-blocked";
  const blocked = grid.occupancy[tIdx(nx, ny)] >= 0 || grid.occupancy[tIdx(nx, ny)] === FIELD_OCC || structureAt(state, nx, ny) !== null
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
}

export type TrainStatus = "stored" | "departing" | "moving" | "dwelling" | "returning" | "blocked";

export const TRAIN_STATUSES: TrainStatus[] = [
  "stored", "departing", "moving", "dwelling", "returning", "blocked",
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

/** The tile a train's locomotive actually stands on. */
export const trainTile = (t: Train): [number, number] => {
  const p = pointAt(t.route, t.dist);
  return [Math.round(p.fx), Math.round(p.fy)];
};

/** Does a train physically occupy this tile — locomotive or wagon? */
export function trainOccupies(state: RailState, tx: number, ty: number): Train | null {
  for (const t of state.trains) {
    if (!t.route.length) continue;
    const cum = polyline(t.route);
    for (const back of [0, WAGON_OFFSET]) {
      const p = pointAt(t.route, t.dist - back, cum);
      if (Math.round(p.fx) === tx && Math.round(p.fy) === ty) return t;
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
export function depotReaching(state: RailState, ownerId: number, platformId: number): RailStructure | null {
  const platform = structureById(state, platformId);
  if (!platform) return null;
  const goals = new Set(laneTiles(platform).map(([x, y]) => tIdx(x, y)));
  for (const depot of structuresOf(state, ownerId, "depot")) {
    const exit = depotExit(depot);
    if (railPath(state, ownerId, [[exit.tx, exit.ty]], goals)) return depot;
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
  state: RailState, ownerId: number, depot: RailStructure, platformId: number,
): boolean {
  const platform = structureById(state, platformId);
  if (!platform) return false;
  const goals = new Set(laneTiles(platform).map(([x, y]) => tIdx(x, y)));
  const exit = depotExit(depot);
  return !!railPath(state, ownerId, [[exit.tx, exit.ty]], goals);
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
  state: RailState, ownerId: number, depotId: number, lineId: number,
): { ok: boolean; train?: Train; why?: string } {
  const depot = state.structures.find((s) => s.id === depotId && s.kind === "depot" && s.ownerId === ownerId);
  const line = state.lines.find((l) => l.id === lineId && l.ownerId === ownerId);
  if (!depot || !line) return { ok: false, why: RAIL_REFUSAL_TEXT.missing };
  if (!depotReachesPlatform(state, ownerId, depot, line.source)) {
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
export function startLine(state: RailState, ownerId: number, lineId: number): boolean {
  const line = state.lines.find((l) => l.id === lineId && l.ownerId === ownerId);
  if (!line) return false;
  let started = false;
  for (const t of state.trains) {
    if (t.lineId !== lineId || t.ownerId !== ownerId || t.status !== "stored") continue;
    t.target = "source";
    if (planLeg(state, t)) started = true;
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
  state: RailState, ownerId: number, sourceId: number, destId: number, name?: string,
): LinePlan {
  const why = lineRefusal(state, ownerId, sourceId, destId);
  if (why !== "ok") return { ok: false, why: RAIL_REFUSAL_TEXT[why] };
  const depot = depotReaching(state, ownerId, sourceId);
  if (!depot) return { ok: false, why: "No depot of yours can reach that platform." };
  const seq = state.seq;
  const created = createLine(state, ownerId, sourceId, destId, name);
  if (!created.ok || !created.line) return { ok: false, why: created.why ?? RAIL_REFUSAL_TEXT.missing };
  const bought = buyTrain(state, ownerId, depot.id, created.line.id);
  if (!bought.ok || !bought.train) {
    state.lines.splice(state.lines.indexOf(created.line), 1);
    state.seq = seq;
    return { ok: false, why: bought.why ?? RAIL_REFUSAL_TEXT.missing };
  }
  startLine(state, ownerId, created.line.id);
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
export function planLeg(state: RailState, train: Train): boolean {
  const line = state.lines.find((l) => l.id === train.lineId);
  const depot = depotOfTrain(state, train);
  if (!line || !depot) {
    train.status = "blocked";
    train.blockedWhy = "Line or depot gone";
    return false;
  }
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
  const exit = depotExit(depot);
  const wasRolling = train.status === "moving" || train.status === "departing" || train.status === "returning";
  const oldRoute = train.route;
  const oldDist = train.dist;
  const here: [number, number] = oldRoute.length ? trainTile(train) : [exit.tx, exit.ty];
  const start: [number, number] = railDrivable(state, train.ownerId, here[0], here[1]) ? here : [exit.tx, exit.ty];
  const targetStruct = train.target === "depot" ? depot : train.target === "source" ? source : dest;
  // The leg ends at ONE tile — the middle of a platform's lane, or the depot's
  // shed door — so a train parks inside the platform instead of on its port.
  const stop: [number, number] = train.target === "depot" ? [exit.tx, exit.ty] : stopTile(targetStruct);
  const route = railPath(state, train.ownerId, [start], new Set([tIdx(stop[0], stop[1])]));
  if (!route) {
    train.status = "blocked";
    train.blockedWhy = train.target === "depot" ? "No route back to the depot" : "No route to the platform";
    train.planRevision = state.rail.revision;
    return false;
  }
  train.route = route;
  // A replan must not teleport a train that is already rolling: carry the
  // sub-tile progress it had over onto the new route's first step. In the
  // ordinary case — a player building somewhere else on the network — the new
  // route is the same and the train does not visibly move at all.
  let resume = 0;
  if (wasRolling && oldRoute.length > 1 && route.length > 1) {
    const p = pointAt(oldRoute, oldDist);
    const dx = route[1][0] - route[0][0], dy = route[1][1] - route[0][1];
    const along = (p.fx - route[0][0]) * dx + (p.fy - route[0][1]) * dy;
    resume = Math.max(0, Math.min(0.9, along));
  }
  train.dist = resume;
  train.planRevision = state.rail.revision;
  train.blockedWhy = undefined;
  train.status = train.target === "depot" ? "returning" : train.target === "source" ? "departing" : "moving";
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
 */
export function tickTrains(state: RailState, dtMs: number): void {
  if (dtMs <= 0) return;
  for (const train of state.trains) {
    // A train that is out on the line replans the moment the graph moves under
    // it (RAIL-04's "only when the graph revision changes") — the one place a
    // broken route is noticed. `planLeg` parks it where it stands if there is no
    // way through, and a train mid-dwell finishes its dwell first.
    if (train.status === "moving" || train.status === "departing" || train.status === "returning") {
      if (train.planRevision !== state.rail.revision) planLeg(state, train);
    }
    if (train.status === "blocked") {
      if (train.planRevision !== state.rail.revision) planLeg(state, train);
      if (train.status === "blocked") continue;
    }
    let ms = dtMs;
    let guard = 0;
    while (ms > 1e-9 && guard++ < 1000) {
      if (train.status === "stored") {
        // A stored train with a live line departs on the next tick; a train the
        // player has parked (target "depot") stays in the shed.
        if (train.target === "depot" && !train.route.length) break;
        if (!planLeg(state, train)) break;
        continue;
      }
      if (train.status === "dwelling") {
        if (train.dwellMs > ms) { train.dwellMs -= ms; ms = 0; break; }
        ms -= train.dwellMs;
        train.dwellMs = 0;
        // The dwell is over: reverse at the platform and run to the other stop.
        train.target = train.target === "source" ? "dest" : "source";
        if (!planLeg(state, train)) break;
        continue;
      }
      const cum = polyline(train.route);
      const total = cum[cum.length - 1] ?? 0;
      const remaining = total - train.dist;
      const step = RAIL_SPEED * ms;
      if (step < remaining) {
        train.dist += step;
        train.dirBit = pointAt(train.route, train.dist, cum).dirBit;
        ms = 0;
        break;
      }
      train.dist = total;
      train.dirBit = pointAt(train.route, total, cum).dirBit;
      ms -= remaining / RAIL_SPEED;
      if (train.target === "depot") {
        train.status = "stored";
        train.route = [];
        train.dist = 0;
        continue;
      }
      train.status = "dwelling";
      train.dwellMs = DWELL_MS;
    }
  }
}

/** Send a train home: `returning` first, and it stays there until re-assigned. */
export function recallTrain(state: RailState, train: Train): boolean {
  if (train.status === "stored") return false;
  train.target = "depot";
  return planLeg(state, train);
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
  if (line) state.lines.splice(state.lines.indexOf(line), 1);
  return { ok: true, refund };
}

/** Stop running a line but keep the train: home to the depot and stay there. */
export function stopLine(state: RailState, lineId: number): boolean {
  let any = false;
  for (const t of state.trains.filter((t) => t.lineId === lineId)) {
    t.target = "depot";
    any = planLeg(state, t) || any;
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
    if (!depot) continue;
    const comp = railComponents(state, ownerId);
    const home = depotComponent(comp, depot);
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
export type RailPanelAction = "assign" | "recall" | "sell" | "buy" | "start";

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
    const line = state.lines.find((l) => l.source === s.id || l.dest === s.id);
    let partnerId: number | undefined;
    if (!line && s.anchor?.kind === "industry") {
      const dest = myPlatforms.find((p) => p.anchor?.kind === "plant");
      if (dest) partnerId = dest.id;
    }
    rows.push({
      id: s.id,
      kind: "platform",
      label: `Platform (${s.view}) · ${anchor}`,
      detail: line ? `line: ${line.name}` : `${PLATFORM_VP}★ · not on a line`,
      actions: line ? [] : (partnerId !== undefined ? ["assign"] : []),
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
      actions: trainAtHome(state, t)
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
  }
}

// ── drawing ───────────────────────────────────────────────────────────────
/** Art sprite names (see tools/make-railway-art.mjs for the authored files). */
export const platformSprite = (view: RailView): string => `platform_${view}`;
export const depotSprite = (view: RailView): string => `train-depot_${view}`;
export const VIEW_NAME: Record<number, RailView> = { [NE]: "ne", [SE]: "se", [SW]: "sw", [NW]: "nw" };

export interface RailSpriteSource { has(name: string): boolean }

/**
 * The structures as draw items. Exactly like every other building: the sprite is
 * placed at the footprint origin with a `ref` payload, so clicking an arm of the
 * platform selects the platform. Rail TILES are not draw items — they are
 * ground, painted by the renderer's chunk pass from the layer bytes.
 */
export function railStructureItems(state: RailState): DrawItem[] {
  return state.structures.map((s) => ({
    sprite: s.kind === "platform" ? platformSprite(s.view) : depotSprite(s.view),
    tx: s.tx,
    ty: s.ty,
    ref: { kind: "rail", structure: s.id, railKind: s.kind, ownerId: s.ownerId },
  }));
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
    if (!train.route.length) continue;
    const cum = polyline(train.route);
    const loco = pointAt(train.route, train.dist, cum);
    const wagon = pointAt(train.route, train.dist - WAGON_OFFSET, cum);
    for (const [kind, p] of [["locomotive", loco], ["wagon", wagon]] as const) {
      const name = `${kind}_${VIEW_NAME[p.dirBit] ?? "se"}`;
      if (atlas && !atlas.has(name)) continue;
      out.push({ sprite: name, tx: Math.round(p.fx), ty: Math.round(p.fy), fx: p.fx, fy: p.fy });
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
    state.trains.push({
      id: t.id, ownerId: t.ownerId, lineId: t.lineId, depotId: t.depotId,
      status: asStatus(t.status), target: asTarget(t.target),
      route: Array.isArray(t.route)
        ? t.route.map((r) => [...r] as [number, number])
        : (prevRoutes.get(t.id) ?? []).map((r) => [...r] as [number, number]),
      dist: t.dist, planRevision: t.planRevision, dwellMs: t.dwellMs,
      dirBit: t.dirBit, resold: !!t.resold, blockedWhy: t.blockedWhy,
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
  state.seq = 1;
  return true;
}

// ── the build palette's rows, priced from the one table ───────────────────
export const RAIL_TOOLS = [
  { key: "rail", label: "Railway Track", cost: RAIL_COSTS.rail },
  { key: "platform", label: "Rail Platform", cost: RAIL_COSTS.platform },
  { key: "raildepot", label: "Train Depot", cost: RAIL_COSTS.depot },
] as const;
export type RailToolKey = typeof RAIL_TOOLS[number]["key"];
