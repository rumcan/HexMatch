// ══════════════════════════════════════════════════════════════════════════
// RAIL-02 (#175/#176) — the railway STATE: layers, records and stable ids.
//
// The railway is a THIRD surface on the same 144×144 isometric grid, beside
// the two road tiers. It gets its own layers and never borrows a byte from
// them:
//
//   rail       Uint8Array  the rail SURFACE: a 4-bit direction mask plus the
//                          PRESENT bit, exactly the road layer's encoding
//                          (bits point AT neighbours carrying rail, so
//                          autotiling and connectivity are the same problem
//                          the roads already solved);
//   railOwner  Uint8Array  who built the tile (0 = none). Rail is ALWAYS
//                          private — there is no public rail, and a track
//                          tile may not be shared with an opponent (the epic:
//                          "Exclude … track-sharing with opponents in v1");
//   occ        Uint8Array  per-tile OCCUPANCY code (see `OccCode`): free,
//                          rail, platform, depot. A structure can therefore
//                          never be built on another structure's ground, and
//                          a placement can never "half overlap" a footprint;
//   occOwner   Uint8Array  the owner id behind `occ` — so a refused
//                          demolition can name who stands there.
//
// Why new bytes rather than the road layers: `track.ts`'s four arrays carry
// ROAD semantics (the merged gravel/tar surface, the public-highway owner,
// and VP-01's pave provenance that the scoreboard reads). Writing rail into
// them would silently score, autotile and flood as road — the exact bug class
// this file exists to prevent.
//
// Records carry a STABLE id (`nextId`, never reused) and their owner twice,
// the way every other structure in this game does: `owner` is the display/VP
// identity a scoreboard and a float speak, `ownerId` is the numeric
// track-owner id the layers are keyed by (player index + 1).
//
// `revision` increments on every mutation. Renderers, route caches and the
// multiplayer delta all key off it, so nothing has to diff 20,736 tiles to
// notice that the network changed.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W, MAP_H } from "../../game/config";
import { PRESENT, DIRS, DIR, OPPOSITE, tIdx, inMapT, type Dir } from "../track";

// ── occupancy ─────────────────────────────────────────────────────────────
/**
 * What stands on a tile, for the RAILWAY's own view of the map. Deliberately
 * small and total: a byte per tile, so "is this tile free?" is one read and
 * two structures can never overlap.
 */
export const OCC_FREE = 0;
/** A rail tile — track laid in the open, or a crossing over a road. */
export const OCC_RAIL = 1;
/** A Rail Platform tile (the 2×3 block, lane and strip alike). */
export const OCC_PLATFORM = 2;
/** A Train Depot tile (the 2×2 block). */
export const OCC_DEPOT = 3;
export type OccCode = typeof OCC_FREE | typeof OCC_RAIL | typeof OCC_PLATFORM | typeof OCC_DEPOT;

export const OCC_NAME: Record<number, string> = {
  [OCC_FREE]: "free",
  [OCC_RAIL]: "rail",
  [OCC_PLATFORM]: "platform",
  [OCC_DEPOT]: "depot",
};

// ── geometry types ────────────────────────────────────────────────────────
/** A quarter-turn rotation. `geometry.ts` is the only place that resolves it. */
export type Rotation = 0 | 1 | 2 | 3;
export const ROTATIONS: Rotation[] = [0, 1, 2, 3];

/** Tile coordinates, the pair every geometry function speaks. */
export type Tile = readonly [number, number];

/**
 * What a platform anchors to: a map industry (`grid.industries[].id`) or one
 * of the owner's own processing plants (`Factory.id`). The anchor is chosen at
 * build time and stored — never re-derived — because "one platform per owner
 * per anchor" is a rule about what has been built, not about where things
 * currently stand.
 */
export type AnchorKind = "industry" | "plant";
export interface RailAnchor { kind: AnchorKind; id: number }

export const sameAnchor = (a: RailAnchor, b: RailAnchor): boolean =>
  a.kind === b.kind && a.id === b.id;

export const anchorKey = (a: RailAnchor): string => `${a.kind}#${a.id}`;

// ── records ───────────────────────────────────────────────────────────────
/**
 * A Rail Platform: a 2×3 rotatable block whose three-tile lane carries the
 * track and whose other three tiles are the strip the town grows around. Its
 * lane is part of the owner's rail network from the moment it is built, and
 * its two rail ports are the lane's ends (`geometry.ts`).
 *
 * `tx`/`ty` is the block's NORTH corner — the minimum x and y of the rotated
 * footprint — so every consumer (occupancy, preview, snapshot) can iterate
 * the bounding box without knowing the rotation.
 */
export interface RailPlatform {
  id: number;
  owner: string;
  ownerId: number;
  tx: number;
  ty: number;
  rot: Rotation;
  anchor: RailAnchor;
}

/**
 * A Train Depot: a 2×2 rotatable block with ONE declared rail exit. The port
 * is stored explicitly (and validated against the rotation) rather than
 * inferred at each call site, so a depot knows which edge its trains leave
 * from even after a save/load round trip.
 */
export interface RailDepot {
  id: number;
  owner: string;
  ownerId: number;
  tx: number;
  ty: number;
  rot: Rotation;
  /** The declared exit direction; must equal `depotPortDir(rot)`. */
  port: Dir;
}

/** The v1 train states (the epic's list; #178 drives the transitions). */
export type TrainState =
  | "stored" | "departing" | "moving" | "dwelling" | "returning" | "blocked";

/**
 * A train. RAIL-02 owns only the two things PLACEMENT needs from it: who owns
 * it, and WHICH TILES IT PHYSICALLY OCCUPIES — the edit guard ("disallow
 * demolishing rail/structures physically occupied by a train") and the
 * one-active-train-per-component rule are both reads of this record. The
 * simulation that advances `state` along a route is #178's.
 */
export interface RailTrain {
  id: number;
  owner: string;
  ownerId: number;
  depotId: number;
  lineId: number | null;
  state: TrainState;
  /** Tile indices the train stands on right now (empty when sold/absent). */
  tiles: number[];
}

/**
 * A named two-stop line (#178 runs it; the record lands here because a
 * platform may not be demolished while a line still uses it).
 */
export interface RailLine {
  id: number;
  owner: string;
  ownerId: number;
  name: string;
  sourceId: number;
  destId: number;
}

export interface RailwayState {
  /** Rail surface: direction mask + PRESENT, per tile. */
  rail: Uint8Array;
  /** Rail owner id per tile (0 = none). Rail is never public. */
  railOwner: Uint8Array;
  /** Occupancy code per tile (`OccCode`). */
  occ: Uint8Array;
  /** Occupancy owner id per tile — mirrors `occ`. */
  occOwner: Uint8Array;
  platforms: RailPlatform[];
  depots: RailDepot[];
  trains: RailTrain[];
  lines: RailLine[];
  /** Monotonic id source. Ids are stable and never reused. */
  nextId: number;
  /** Bumped on every mutation; caches and the net delta key off it. */
  revision: number;
}

export const createRailway = (): RailwayState => ({
  rail: new Uint8Array(MAP_W * MAP_H),
  railOwner: new Uint8Array(MAP_W * MAP_H),
  occ: new Uint8Array(MAP_W * MAP_H),
  occOwner: new Uint8Array(MAP_W * MAP_H),
  platforms: [],
  depots: [],
  trains: [],
  lines: [],
  nextId: 1,
  revision: 0,
});

/** Allocate the next stable id. Nothing in the railway ever reuses one. */
export function allocRailId(rw: RailwayState): number {
  return rw.nextId++;
}

// ── layer reads ───────────────────────────────────────────────────────────
/** Is there rail on this tile (any owner)? */
export const railPresent = (rw: RailwayState, tx: number, ty: number): boolean =>
  inMapT(tx, ty) && (rw.rail[tIdx(tx, ty)] & PRESENT) !== 0;

/** The direction bits only — what a renderer draws with. */
export const railBitsAt = (rw: RailwayState, tx: number, ty: number): number =>
  inMapT(tx, ty) ? rw.rail[tIdx(tx, ty)] & 0b1111 : 0;

/** Who owns the rail on this tile? 0 = none. */
export const railOwnerAt = (rw: RailwayState, tx: number, ty: number): number =>
  inMapT(tx, ty) ? rw.railOwner[tIdx(tx, ty)] : 0;

/** The occupancy code at a tile (OCC_FREE outside the map). */
export const occAt = (rw: RailwayState, tx: number, ty: number): number =>
  inMapT(tx, ty) ? rw.occ[tIdx(tx, ty)] : OCC_FREE;

/** The owner id behind the occupancy at a tile (0 = none). */
export const occOwnerAt = (rw: RailwayState, tx: number, ty: number): number =>
  inMapT(tx, ty) ? rw.occOwner[tIdx(tx, ty)] : 0;

/**
 * The strict, owner-scoped presence test — the railway's `trackOwnedBy`.
 * Rail admits no public ground and no sharing, so this single test is the
 * whole access rule: a tile is yours only when you built it.
 */
export const railOwnedBy = (rw: RailwayState, ownerId: number, tx: number, ty: number): boolean =>
  railPresent(rw, tx, ty) && rw.railOwner[tIdx(tx, ty)] === ownerId;

// ── layer writes ──────────────────────────────────────────────────────────
/**
 * Recompute one tile's rail mask from its four neighbours: a bit is set for
 * each neighbour that carries rail OF THE SAME OWNER. Rail is private, so an
 * opponent's line touching yours is two surfaces that merely stand side by
 * side — they never join, and a bit pointing across the seam would draw a
 * junction that no train may use.
 *
 * The tile keeps its owner byte; a tile with no rail PRESENT recomputes to 0.
 */
export function recomputeRailMask(rw: RailwayState, tx: number, ty: number): number {
  if (!inMapT(tx, ty)) return 0;
  const i = tIdx(tx, ty);
  if ((rw.rail[i] & PRESENT) === 0) { rw.rail[i] = 0; return 0; }
  const owner = rw.railOwner[i];
  let bits = 0;
  for (const d of DIRS) {
    const [dx, dy] = DIR[d];
    const nx = tx + dx, ny = ty + dy;
    if (!inMapT(nx, ny)) continue;
    if ((rw.rail[tIdx(nx, ny)] & PRESENT) === 0) continue;
    if (rw.railOwner[tIdx(nx, ny)] !== owner) continue;
    bits |= d;
  }
  rw.rail[i] = PRESENT | bits;
  return bits;
}

/** The four ground neighbours, in this project's direction numbering. */
const NEIGHBOURS: [number, number][] = DIRS.map((d) => DIR[d]);

/**
 * Put rail on a tile (owner-scoped) and re-autotile the tile plus its four
 * neighbours. Returns the tile indices whose mask changed — the caller's
 * dirty set, exactly like `AutotileResult.tiles` for roads.
 *
 * Laying on your OWN existing rail is a no-op (the mask still recomputes, so
 * an externally-set byte heals). Laying on an OPPONENT's rail is refused by
 * the placement rules before this is ever called; as a belt-and-braces rule
 * this function leaves a foreign owner byte alone.
 */
export function layRail(rw: RailwayState, ownerId: number, tx: number, ty: number): number[] {
  if (!inMapT(tx, ty)) return [];
  const i = tIdx(tx, ty);
  if ((rw.rail[i] & PRESENT) === 0) rw.rail[i] = PRESENT;
  if (rw.railOwner[i] === 0) rw.railOwner[i] = ownerId;
  rw.occ[i] = rw.occ[i] === OCC_FREE ? OCC_RAIL : rw.occ[i];
  if (rw.occ[i] === OCC_RAIL) rw.occOwner[i] = rw.railOwner[i];
  rw.revision++;
  return autotileRail(rw, tx, ty);
}

/** Take rail off a tile: the mask, the owner byte and a plain rail occupancy. */
export function liftRail(rw: RailwayState, tx: number, ty: number): number[] {
  if (!inMapT(tx, ty)) return [];
  const i = tIdx(tx, ty);
  if ((rw.rail[i] & PRESENT) === 0) return [];
  rw.rail[i] = 0;
  rw.railOwner[i] = 0;
  if (rw.occ[i] === OCC_RAIL) { rw.occ[i] = OCC_FREE; rw.occOwner[i] = 0; }
  rw.revision++;
  return autotileRail(rw, tx, ty);
}

/** Recompute a tile and its four neighbours, reporting the touched indices. */
export function autotileRail(rw: RailwayState, tx: number, ty: number): number[] {
  const out: number[] = [];
  recomputeRailMask(rw, tx, ty);
  out.push(tIdx(tx, ty));
  for (const [dx, dy] of NEIGHBOURS) {
    const nx = tx + dx, ny = ty + dy;
    if (!inMapT(nx, ny)) continue;
    recomputeRailMask(rw, nx, ny);
    out.push(tIdx(nx, ny));
  }
  return out;
}

/** The opposite of a direction bit — the mutual-face test's other half. */
export const oppositeBit = (d: number): number => OPPOSITE[d] ?? 0;

// ── occupancy writes ──────────────────────────────────────────────────────
/**
 * Reserve tiles for a structure. Refuses (returns false, touching nothing) if
 * ANY tile is already taken — a structure is all-or-nothing, so a footprint
 * can never half-overlap another one.
 */
export function reserveTiles(
  rw: RailwayState, tiles: readonly Tile[], code: OccCode, ownerId: number,
): boolean {
  for (const [tx, ty] of tiles) {
    if (!inMapT(tx, ty)) return false;
    if (rw.occ[tIdx(tx, ty)] !== OCC_FREE) return false;
  }
  for (const [tx, ty] of tiles) {
    const i = tIdx(tx, ty);
    rw.occ[i] = code;
    rw.occOwner[i] = ownerId;
  }
  rw.revision++;
  return true;
}

/**
 * Release tiles a structure held. Guarded on `code` AND `ownerId`: releasing
 * a platform never clears a depot's ground, and a stale demolition of the
 * rival's structure is a no-op rather than a hole in the map.
 */
export function releaseTiles(
  rw: RailwayState, tiles: readonly Tile[], code: OccCode, ownerId: number,
): void {
  for (const [tx, ty] of tiles) {
    if (!inMapT(tx, ty)) continue;
    const i = tIdx(tx, ty);
    if (rw.occ[i] !== code || rw.occOwner[i] !== ownerId) continue;
    rw.occ[i] = OCC_FREE;
    rw.occOwner[i] = 0;
  }
  rw.revision++;
}

// ── snapshot / rollback ───────────────────────────────────────────────────
/**
 * A deep copy of the whole state. Placement uses it to make a multi-tile
 * build ATOMIC: the cheap thing to get wrong in a drag is the middle of it,
 * and a half-applied drag is worse than a refused one — it has been paid for
 * on some tiles and not others. `restoreRailway` puts the copy back IN PLACE,
 * so every caller holding the state object sees the rollback.
 *
 * The layer copy is 4 × 20,736 bytes; a build (never a frame) can afford it,
 * and in exchange the rules stay written as a straight line of checks.
 */
export function cloneRailway(rw: RailwayState): RailwayState {
  return {
    rail: rw.rail.slice(),
    railOwner: rw.railOwner.slice(),
    occ: rw.occ.slice(),
    occOwner: rw.occOwner.slice(),
    platforms: rw.platforms.map((p) => ({ ...p, anchor: { ...p.anchor } })),
    depots: rw.depots.map((d) => ({ ...d })),
    trains: rw.trains.map((t) => ({ ...t, tiles: [...t.tiles] })),
    lines: rw.lines.map((l) => ({ ...l })),
    nextId: rw.nextId,
    revision: rw.revision,
  };
}

/** Restore `snapshot` INTO `rw` (identity preserved for every holder). */
export function restoreRailway(rw: RailwayState, snapshot: RailwayState): void {
  rw.rail.set(snapshot.rail);
  rw.railOwner.set(snapshot.railOwner);
  rw.occ.set(snapshot.occ);
  rw.occOwner.set(snapshot.occOwner);
  rw.platforms = snapshot.platforms.map((p) => ({ ...p, anchor: { ...p.anchor } }));
  rw.depots = snapshot.depots.map((d) => ({ ...d }));
  rw.trains = snapshot.trains.map((t) => ({ ...t, tiles: [...t.tiles] }));
  rw.lines = snapshot.lines.map((l) => ({ ...l }));
  rw.nextId = snapshot.nextId;
  rw.revision = snapshot.revision;
}

/** Every tile a train physically occupies right now (any owner). */
export function trainTiles(rw: RailwayState): Set<number> {
  const out = new Set<number>();
  for (const t of rw.trains) for (const i of t.tiles) out.add(i);
  return out;
}

/** Every tile one owner's trains occupy. */
export function trainTilesOf(rw: RailwayState, ownerId: number): Set<number> {
  const out = new Set<number>();
  for (const t of rw.trains) {
    if (t.ownerId !== ownerId) continue;
    for (const i of t.tiles) out.add(i);
  }
  return out;
}
