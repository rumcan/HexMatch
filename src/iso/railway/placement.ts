// ══════════════════════════════════════════════════════════════════════════
// RAIL-02 (#176) — rail placement: the rules, in ONE place.
//
// Everything a player can do to the railway passes through this module, and
// nothing here knows about a canvas, a toolbar or a socket:
//
//   previewRailDrag   the four-neighbour drag, priced, with the crossings it
//                     would make and the reason it stopped;
//   commitRailDrag    the same drag, re-validated and applied ATOMICALLY;
//   planPlatform /    the 2×3 and 2×2 structures, rotated by quarter turns,
//   planDepot         with their ports, anchors and per-tile refusals;
//   demolishRailTile / demolishPlatform / demolishRailDepot
//                     the teardown half: floor(50%) per resource, and the
//                     platform's 1★ left for the scoreboard to revoke.
//
// The rules, as the epic states them:
//
//   * rail follows the FOUR ground neighbours of the grid. No diagonals, no
//     bridges, no tunnels, and no slopes: water and rough ground are refused;
//   * rail is PRIVATE. A tile carries one owner, there is no public rail, and
//     an opponent's track may neither be used nor joined;
//   * a ROAD may be crossed — at a level crossing, and only where BOTH
//     surfaces are straight and the rail is perpendicular to the road. A
//     curved or junction road is refused, and so is a rail that would turn or
//     branch on the crossing. The road's bytes are never touched: its owner,
//     its tier and its pave provenance survive the crossing intact, and no
//     traffic ever transfers between the two graphs;
//   * a PLATFORM anchors to exactly one industry or owned processing plant
//     within Manhattan distance 3, one platform per owner per anchor, and the
//     player picks when more than one qualifies;
//   * structures may not overlap each other or a road, and no edit may touch
//     a tile a train is standing on;
//   * one ACTIVE TRAIN per connected owner component — so a drag that would
//     MERGE two components which already have one each is refused whole.
//
// Costs come from the one authoritative table (`BUILD_COSTS.rail` /
// `.platform` / `.railDepot` in config.ts). Nothing in here invents a price,
// and the free setup allowance deliberately does not apply to rail at all:
// the epic prices rail as an investment, not as an opening gift.
//
// Every build is all-or-nothing. The rules can refuse a drag at its tenth
// tile, and a half-built drag would have been paid for on the nine before it,
// so a refused build here leaves the world EXACTLY as it was: same bytes, same
// records, same `nextId`, and (see `commitRailDrag`) the caller charges only
// what the result says.
// ══════════════════════════════════════════════════════════════════════════
import { BUILD_COSTS, VICTORY } from "../config";
import {
  DIRS, DIR, tIdx, inMapT, mergedBitsAt, hasTrack,
  canAfford, addCost, lPath,
  type Purse, type Track,
} from "../track";
import { WATER, ROUGH, TOWN_OCC, type Grid } from "../grid";
import type { Factory } from "../economy";
import {
  OCC_FREE, OCC_PLATFORM, OCC_DEPOT, occAt, occOwnerAt, allocRailId,
  cloneRailway, restoreRailway, railPresent, railOwnedBy, railOwnerAt, railBitsAt,
  layRail, liftRail, reserveTiles, releaseTiles, trainTiles,
  type RailAnchor, type RailDepot, type RailPlatform, type RailwayState,
  type Rotation, type Tile,
} from "./state";
import {
  anchorIn, depotPortDir, depotPortNeighbours, depotPortTiles, depotTiles,
  platformAnchorCandidates, platformLaneTiles, platformPorts, platformStripTiles,
  platformTiles,
} from "./geometry";
import type { Dir } from "../track";
import { buildRailComponents } from "./connectivity";

/** The three pieces of world a rail rule reads. Never mutated here but for `rw`. */
export interface RailWorld {
  rw: RailwayState;
  grid: Grid;
  track: Track;
}

export const RAIL_COST: Purse = BUILD_COSTS.rail;
export const PLATFORM_COST: Purse = BUILD_COSTS.platform;
export const RAIL_DEPOT_COST: Purse = BUILD_COSTS.railDepot;
export const TRAIN_COST: Purse = BUILD_COSTS.train;
/** The epic's demolition refund: floor(50%) of each construction resource. */
export const REFUND_FRACTION = 0.5;

/** floor(fraction × each resource), dropping what rounds to zero. */
export function refundFor(cost: Purse, fraction: number = REFUND_FRACTION): Purse {
  const out: Purse = {};
  for (const [cargo, n] of Object.entries(cost) as [keyof Purse, number][]) {
    const r = Math.floor(n * fraction);
    if (r > 0) out[cargo] = r;
  }
  return out;
}

// ── readable refusals ─────────────────────────────────────────────────────
/**
 * The code → sentence table. A refusal the player cannot read is a refusal
 * they will report as a bug, so the codes below are the vocabulary every
 * caller (preview, toast, debug console, test) prints from.
 */
export const RAIL_REASON_TEXT: Record<string, string> = {
  "out-of-bounds": "it runs off the map",
  water: "it is on water",
  rough: "it is on rough ground — rail needs flat land",
  occupied: "an industry, a town or another building stands there",
  "opponent-rail": "that is your rival's rail",
  "train-occupied": "a train is standing there",
  "road-end": "the road there is a dead end, not a crossing",
  "road-curve": "the road curves there — crossings must be straight through",
  "road-junction": "the road joins there — crossings must be straight through",
  "crossing-curve": "rail can only cross a road straight through, never turning on it",
  "crossing-skew": "the rail must cross the road perpendicular to it",
  "crossing-branch": "rail cannot branch off at a level crossing",
  "not-adjacent": "it is not next to your railway",
  "train-limit": "that would join two lines that each already have a train",
  "not-yours": "that is not your rail",
  "no-rail": "there is no rail there",
  "structure-occupied": "something is already built there",
  "no-anchor": "a platform must sit within 3 tiles of an industry or your processing plant",
  "anchor-taken": "you already have a platform at that industry or plant",
  "anchor-ambiguous": "several anchors are in range — choose the one this platform serves",
  "anchor-invalid": "that anchor is out of range of this platform",
  "bad-port": "the depot's rail exit does not match its rotation",
  "train-assigned": "a train is assigned to that depot",
  "line-assigned": "a line still uses that platform",
};

/** The sentence fragment for a refusal code. */
export const railReasonText = (code: string | null): string | null =>
  code === null ? null : (RAIL_REASON_TEXT[code] ?? "it is not buildable");

// ── tile legality ─────────────────────────────────────────────────────────
const isStraightPair = (bits: number): boolean =>
  bits === (1 | 4) || bits === (2 | 8);      // NE|SW or SE|NW

/**
 * May rail stand at (tx,ty) on its own, before any path is considered?
 * Mirrors `buildRefusal` in track.ts: one function, so a preview, a commit and
 * a debug probe can never disagree about why a tile was refused.
 *
 * `network` is optional and, when passed, is the drag's GROWING tile set: the
 * tile must be on it or beside it, which is how a spur is kept attached to the
 * owner's own railway. A drag that would start in the middle of nowhere is
 * refused with "not-adjacent" rather than building an orphan island.
 */
export function railRefusal(
  world: RailWorld, ownerId: number, tx: number, ty: number, network?: Set<number>,
): string | null {
  const { rw, grid } = world;
  if (!inMapT(tx, ty)) return "out-of-bounds";
  const i = tIdx(tx, ty);
  if (grid.terrain[i] === WATER) return "water";
  // RAIL-02: the epic excludes slopes, and ROUGH is this map's slope/rough
  // terrain. (Dirt Roads build on it; rail does not.)
  if (grid.terrain[i] === ROUGH) return "rough";
  // "Disallow demolishing rail/structures physically occupied by a train":
  // the same guard gates building, because a tile is no more editable under a
  // train than over one.
  if (trainTiles(rw).has(i)) return "train-occupied";
  if (railPresent(rw, tx, ty)) {
    // Own rail is never a reason to refuse: laying over it is a free no-op,
    // and dragging THROUGH it is how a spur meets its trunk.
    if (railOwnerAt(rw, tx, ty) !== ownerId) return "opponent-rail";
  }
  // Industry footprints and town tiles (TOWN_OCC) block building outright.
  if (grid.occupancy[i] >= 0 || grid.occupancy[i] === TOWN_OCC) return "occupied";
  const code = occAt(rw, tx, ty);
  if (code === OCC_PLATFORM || code === OCC_DEPOT) return "occupied";
  // A road tile is a CROSSING or nothing. Whether the rail through it is
  // straight and perpendicular is the path's business (see
  // `crossingRefusal`); whether the ROAD is crossable at all is this tile's.
  if (hasTrack(world.track, "dirt", tx, ty) || hasTrack(world.track, "road", tx, ty)) {
    const road = roadCrossingRefusal(world, tx, ty);
    if (road) return road;
  }
  if (network) {
    if (network.has(i)) return null;
    for (const d of DIRS) {
      const [dx, dy] = DIR[d];
      if (inMapT(tx + dx, ty + dy) && network.has(tIdx(tx + dx, ty + dy))) return null;
    }
    return "not-adjacent";
  }
  return null;
}

/**
 * Is the road at (tx,ty) a segment a rail may cross?
 *
 * "Allowed only on empty straight road segments": the road must run straight
 * THROUGH the tile — two opposite bits and nothing else. A dead end is not a
 * segment, a curve is not straight, and a junction is neither. Everything
 * else about the road (tier, owner, the 0.25★ provenance of a pave, who is
 * allowed to drive it) is simply not touched by a crossing.
 */
export function roadCrossingRefusal(world: RailWorld, tx: number, ty: number): string | null {
  if (!hasTrack(world.track, "dirt", tx, ty) && !hasTrack(world.track, "road", tx, ty)) return null;
  const bits = mergedBitsAt(world.track, tx, ty);
  if (bits === 0 || (bits & (bits - 1)) === 0) return "road-end";
  if (isStraightPair(bits)) return null;
  // Two bits that are not opposite are a curve; three or four are a junction.
  const count = (bits & 1 ? 1 : 0) + (bits & 2 ? 1 : 0) + (bits & 4 ? 1 : 0) + (bits & 8 ? 1 : 0);
  return count >= 3 ? "road-junction" : "road-curve";
}

/**
 * The rail bits a tile would have once `accepted` (the drag's tile set) is
 * laid: a bit for every neighbour that carries rail — either already the
 * owner's, or about to be laid by this drag.
 */
function plannedRailBits(
  world: RailWorld, ownerId: number, accepted: Set<number>, tx: number, ty: number,
): number {
  let bits = 0;
  for (const d of DIRS) {
    const [dx, dy] = DIR[d];
    const nx = tx + dx, ny = ty + dy;
    if (!inMapT(nx, ny)) continue;
    if (accepted.has(tIdx(nx, ny)) || railOwnedBy(world.rw, ownerId, nx, ny)) bits |= d;
  }
  return bits;
}

/**
 * The level-crossing rule, for ONE tile that carries road:
 *
 *   1. the rail through it must be STRAIGHT — two opposite bits. A rail that
 *      turns on a road is a curved crossing, which the ticket rejects;
 *   2. it must be PERPENDICULAR to the road — a crossing at any other angle is
 *      a skew crossing, and the two straight pairs are perpendicular exactly
 *      when they share no bit.
 *
 * Both are bit tests on the same masks the renderer draws, so "what the sprite
 * shows" and "what the rule allows" cannot drift.
 */
export function crossingRefusal(
  world: RailWorld, ownerId: number, accepted: Set<number>, tx: number, ty: number,
): string | null {
  if (!hasTrack(world.track, "dirt", tx, ty) && !hasTrack(world.track, "road", tx, ty)) return null;
  const road = roadCrossingRefusal(world, tx, ty);
  if (road) return road;
  const rail = plannedRailBits(world, ownerId, accepted, tx, ty);
  if (!isStraightPair(rail)) return "crossing-curve";
  if ((rail & mergedBitsAt(world.track, tx, ty)) !== 0) return "crossing-skew";
  return null;
}

// ── drag preview ──────────────────────────────────────────────────────────
export interface RailDragPreview {
  /** Tiles the commit would lay, in drag order. */
  tiles: [number, number][];
  /** The subset of `tiles` that becomes a level crossing over a road. */
  crossings: [number, number][];
  /** What the commit charges: the per-tile cost of `tiles`. */
  cost: Purse;
  /** Tiles dragged over but not built, because the purse ran out. */
  unaffordable: [number, number][];
  /** How many of `tiles` already carried the owner's rail (charged nothing). */
  free: number;
  /** True when an obstacle or a refusal cut the path short. */
  truncated: boolean;
  /** The refusal that stopped it, or null when the whole path is buildable. */
  reason: string | null;
  /**
   * RAIL-02 scoring: always 0. Rail track scores nothing (only a PLATFORM is
   * worth a point), and the field is here so the preview a UI paints carries
   * the number honestly instead of the UI assuming one.
   */
  vp: 0;
}

/** Cost of laying rail on ONE tile: the table's rail entry, or nothing. */
export function railTileCost(world: RailWorld, ownerId: number, tx: number, ty: number): Purse {
  // Already the owner's rail (laid, absorbed into a platform lane, or a
  // depot's port stub): nothing to pay, and the drag may pass through.
  if (railOwnedBy(world.rw, ownerId, tx, ty)) return {};
  return { ...RAIL_COST };
}

/**
 * Compute the four-neighbour drag preview between two tiles, exactly as the
 * roads do: an L-shaped Manhattan path (`xFirst` flips which axis leads), a
 * per-tile cost, and a stop at the first refusal. Refusals inside a drag
 * TRUNCATE rather than fail — the affordable, legal prefix is what gets built,
 * which is the behaviour the road drag has always had and what makes a
 * mis-dragged mouse harmless.
 *
 * The crossing pass is deliberately separate and runs AFTER the prefix is
 * known: whether the rail through a road tile is straight and perpendicular
 * depends on which neighbours of that tile the drag actually reaches, so it
 * cannot be decided tile-by-tile in one sweep. Tiles that fail are dropped
 * with everything after them, and the loop repeats until the prefix is clean —
 * dropping the far half of a crossing can disqualify the near half.
 */
export function previewRailDrag(
  world: RailWorld, ownerId: number, purse: Purse,
  ax: number, ay: number, bx: number, by: number,
  xFirst = true, network?: Set<number>,
): RailDragPreview {
  const path = lPath(ax, ay, bx, by, xFirst);
  const growing = network ? new Set(network) : undefined;
  const accepted: [number, number][] = [];
  const unaffordable: [number, number][] = [];
  let cost: Purse = {};
  let truncated = false;
  let reason: string | null = null;
  let free = 0;

  for (let i = 0; i < path.length; i++) {
    const [x, y] = path[i];
    const refuse = railRefusal(world, ownerId, x, y, growing);
    if (refuse) { truncated = true; reason = refuse; break; }
    const c = railTileCost(world, ownerId, x, y);
    if (Object.keys(c).length === 0) {
      accepted.push([x, y]);
      growing?.add(tIdx(x, y));
      free++;
      continue;
    }
    const next = addCost(cost, c);
    if (!canAfford(purse, next)) {
      for (let j = i; j < path.length; j++) {
        const [ux, uy] = path[j];
        if (railRefusal(world, ownerId, ux, uy, growing)) { truncated = true; break; }
        unaffordable.push([ux, uy]);
      }
      reason = "cannot-afford";
      break;
    }
    cost = next;
    accepted.push([x, y]);
    growing?.add(tIdx(x, y));
  }

  const { tiles, crossings, refused } = resolveCrossings(world, ownerId, accepted);
  if (refused) { truncated = true; reason = refused; }

  // Dropped crossings change what the drag costs, so the price is recomputed
  // from the SURVIVING tiles. The commit charges this number and nothing else,
  // which is what keeps "what you see" and "what you pay" one value.
  return {
    tiles, crossings, cost: costOfTiles(world, ownerId, tiles),
    unaffordable, free, truncated, reason, vp: 0,
  };
}

/** What `tiles` cost in total (the owner's existing rail is free). */
export function costOfTiles(
  world: RailWorld, ownerId: number, tiles: readonly [number, number][],
): Purse {
  let out: Purse = {};
  for (const [x, y] of tiles) out = addCost(out, railTileCost(world, ownerId, x, y));
  return out;
}

/**
 * Validate the drag's tiles against the crossing rules and return the longest
 * prefix that satisfies them.
 *
 * A tile fails when it carries road and its rail would not be a straight,
 * perpendicular crossing — or when it would CHANGE an existing crossing into a
 * junction by branching off one (a bit added beside a crossing turns that
 * crossing into a three-way meet, which is the "junction crossing" the ticket
 * rejects). Each failure drops that tile and everything after it, and the
 * check restarts, because the tile before a dropped one may itself now be a
 * half-crossing.
 */
function resolveCrossings(
  world: RailWorld, ownerId: number, path: readonly [number, number][],
): { tiles: [number, number][]; crossings: [number, number][]; refused: string | null } {
  const tiles = path.map(([x, y]) => [x, y] as [number, number]);
  let refused: string | null = null;
  for (;;) {
    const set = new Set(tiles.map(([x, y]) => tIdx(x, y)));
    let bad = -1;
    // Walk backwards so the FIRST illegal tile (from the end) is the one the
    // drag stops at: the prefix before it is still buildable.
    for (let i = tiles.length - 1; i >= 0; i--) {
      const [x, y] = tiles[i];
      // Branching OFF an existing crossing comes first, because such a tile
      // fails its OWN test too (the branch bit it would gain points at the
      // neighbour) and "you cannot branch off a crossing" is the honest
      // reason: the offender is the tile being laid, not the crossing.
      for (const d of DIRS) {
        const [dx, dy] = DIR[d];
        const nx = x + dx, ny = y + dy;
        if (!inMapT(nx, ny)) continue;
        if (!hasTrack(world.track, "dirt", nx, ny) && !hasTrack(world.track, "road", nx, ny)) continue;
        if (!railOwnedBy(world.rw, ownerId, nx, ny)) continue;
        if (crossingRefusal(world, ownerId, set, nx, ny)) { bad = i; refused = "crossing-branch"; break; }
      }
      if (bad >= 0) break;
      const own = crossingRefusal(world, ownerId, set, x, y);
      if (own) { bad = i; refused = own; break; }
    }
    if (bad < 0) break;
    tiles.length = bad;
    if (tiles.length === 0) break;
  }
  const crossings = tiles.filter(([x, y]) =>
    hasTrack(world.track, "dirt", x, y) || hasTrack(world.track, "road", x, y));
  return { tiles, crossings, refused };
}

// ── drag commit ───────────────────────────────────────────────────────────
export interface RailCommitOk {
  ok: true;
  built: [number, number][];
  crossings: [number, number][];
  cost: Purse;
}
export interface RailCommitFail {
  ok: false;
  code: string;
  why: string | null;
}
export type RailCommitResult = RailCommitOk | RailCommitFail;

/**
 * Apply a previewed drag.
 *
 * Two guarantees, both of them about the money:
 *
 *   1. ATOMIC. Every tile is re-validated against the CURRENT world before a
 *      single byte changes, and the apply itself is wrapped in clone/restore.
 *      If anything fails — a tile that was legal when the drag was previewed
 *      and is not any more, or the one-train rule below — the world is left
 *      exactly as it was and `cost` is empty. There is no half-built drag and
 *      no charge for one.
 *   2. RACE-SAFE. Two seats dragging onto the same ground both reach this
 *      function; the first to run builds and pays, the second finds the tile
 *      changed underneath (an opponent's rail, a structure, a train) and is
 *      refused whole. That is the multi-writer case the host authority
 *      arbitrates, and it needs no lock because nothing is applied until every
 *      tile has passed.
 *
 * The one-train rule is checked AFTER the apply, on the merged components: a
 * drag that joins two stretches which each already hold a train would put two
 * trains in one component, which v1 forbids (no signalling). Reverting is
 * exact, so the refused drag costs nothing.
 */
export function commitRailDrag(
  world: RailWorld, ownerId: number, preview: RailDragPreview,
): RailCommitResult {
  const { rw } = world;
  if (preview.tiles.length === 0) {
    return { ok: false, code: "not-adjacent", why: railReasonText("not-adjacent") };
  }
  // 1. Re-validate EVERY tile before touching anything. The set is its own
  //    network here (each dragged tile is on it), so the adjacency test is
  //    trivially satisfied and what remains is exactly what can have changed
  //    since the preview: an opponent's rail appearing, a structure, a train,
  //    a road re-laid as a curve.
  const set = new Set(preview.tiles.map(([x, y]) => tIdx(x, y)));
  for (const [x, y] of preview.tiles) {
    const bad = railRefusal(world, ownerId, x, y, set);
    if (bad) return { ok: false, code: bad, why: railReasonText(bad) };
  }
  for (const [x, y] of preview.tiles) {
    const bad = crossingRefusal(world, ownerId, set, x, y);
    if (bad) return { ok: false, code: bad, why: railReasonText(bad) };
  }

  // 2. Apply, keeping a copy so a failure can restore the world exactly.
  const before = cloneRailway(rw);
  for (const [x, y] of preview.tiles) layRail(rw, ownerId, x, y);

  // 3. The one-active-train rule, on the components the drag produced.
  //    NOTE: `!== null`, not truthiness — component 0 is a real component and
  //    a merge that breaks the rule there is still a merge that breaks it.
  const violation = mergeTrainViolation(rw, ownerId);
  if (violation !== null) {
    restoreRailway(rw, before);
    return { ok: false, code: "train-limit", why: railReasonText("train-limit") };
  }

  return {
    ok: true,
    built: preview.tiles.map(([x, y]) => [x, y] as [number, number]),
    crossings: preview.crossings,
    cost: preview.cost,
  };
}

/**
 * Does the owner now have a component holding more than one train? Returns the
 * offending component id, or null. The epic's v1 rule is one ACTIVE train per
 * connected component, and a component that just came into being by a merge is
 * exactly where that rule gets broken.
 */
export function mergeTrainViolation(rw: RailwayState, ownerId: number): number | null {
  const comps = buildRailComponents(rw, ownerId);
  const seen = new Map<number, number[]>();   // component → train ids
  for (const train of rw.trains) {
    if (train.ownerId !== ownerId) continue;
    const c = trainComponent(rw, comps, train.id);
    if (c < 0) continue;
    const list = seen.get(c) ?? [];
    list.push(train.id);
    seen.set(c, list);
    if (list.length > 1) return c;
  }
  return null;
}

/** The component a train stands in — by its own tile, else via its depot. */
export function trainComponent(
  rw: RailwayState, comps: ReturnType<typeof buildRailComponents>, trainId: number,
): number {
  const train = rw.trains.find((t) => t.id === trainId);
  if (!train) return -1;
  for (const i of train.tiles) if (comps.comp[i] >= 0) return comps.comp[i];
  const depot = rw.depots.find((d) => d.id === train.depotId);
  if (!depot) return -1;
  for (const [x, y] of depotPortTiles(depot.tx, depot.ty, depot.rot)) {
    const c = comps.comp[tIdx(x, y)];
    if (c >= 0) return c;
  }
  return -1;
}

// ── structures: shared footprint checks ───────────────────────────────────
export interface RailPlanTile {
  tx: number;
  ty: number;
  /** This tile alone may be built on. */
  ok: boolean;
  /** Why it may not, or null. */
  why: string | null;
}

/**
 * One tile of a structure footprint. Stricter than a rail tile on purpose:
 * a structure needs the GROUND, so an existing road is refused ("occupied:
 * a road is in the way") rather than crossed, and the owner's own rail is
 * refused too — demolition pays the rail back before a platform can stand on
 * it, which is what keeps a structure from silently swallowing paid track.
 */
export function structureTileRefusal(world: RailWorld, tx: number, ty: number): string | null {
  const { rw, grid } = world;
  if (!inMapT(tx, ty)) return "out-of-bounds";
  const i = tIdx(tx, ty);
  if (grid.terrain[i] === WATER) return "water";
  if (grid.terrain[i] === ROUGH) return "rough";
  if (grid.occupancy[i] >= 0 || grid.occupancy[i] === TOWN_OCC) return "occupied";
  if (trainTiles(rw).has(i)) return "train-occupied";
  if (occAt(rw, tx, ty) !== OCC_FREE) return "structure-occupied";
  if (hasTrack(world.track, "dirt", tx, ty) || hasTrack(world.track, "road", tx, ty)) return "occupied";
  // Rail of ANY owner is in the way — including the builder's own: the tile has
  // to be cleared (and refunded) first, so a platform never eats a paid tile.
  if (railPresent(rw, tx, ty)) return "structure-occupied";
  return null;
}

export interface RailStructurePlan {
  kind: "platform" | "depot";
  tx: number;
  ty: number;
  rot: Rotation;
  /** The whole block, per tile, with the verdict the overlay paints. */
  footprint: RailPlanTile[];
  /** Platform: the lane tiles (they carry the track, included in the price). */
  lane: [number, number][];
  /** Platform: the strip tiles. */
  strip: [number, number][];
  /** The declared rail port(s), with their outward direction. */
  ports: { tile: [number, number]; dir: Dir }[];
  /** Platform: every anchor in range (industries first, then owned plants). */
  anchors: RailAnchor[];
  /** Platform: the anchor this plan serves — the caller's choice, or the only one. */
  anchor: RailAnchor | null;
  /** The whole placement is legal exactly as planned. */
  valid: boolean;
  /** The first refusal, machine-readable. */
  code: string | null;
  /** The first refusal, as a sentence fragment. */
  why: string | null;
  /** What the build charges. */
  cost: Purse;
  /** The VP the scoreboard will pay when this lands (platform: 1, depot: 0). */
  vp: number;
}

const tuples = (tiles: readonly Tile[]): [number, number][] =>
  tiles.map(([x, y]) => [x, y] as [number, number]);

const planFootprint = (
  world: RailWorld, tiles: readonly Tile[],
): { footprint: RailPlanTile[]; code: string | null } => {
  const footprint: RailPlanTile[] = [];
  let code: string | null = null;
  for (const [x, y] of tiles) {
    const why = structureTileRefusal(world, x, y);
    if (why && !code) code = why;
    footprint.push({ tx: x, ty: y, ok: why === null, why });
  }
  return { footprint, code };
};

/**
 * Plan a Rail Platform. `anchor` is the player's explicit choice when more
 * than one candidate is in range — the epic's "choose explicitly when
 * ambiguous" — and a plan with several candidates and no choice is refused
 * (`anchor-ambiguous`) rather than silently taking the first.
 */
export function planPlatform(
  world: RailWorld, factories: readonly Factory[], ownerId: number,
  tx: number, ty: number, rot: Rotation, anchor?: RailAnchor | null,
): RailStructurePlan {
  const tiles = platformTiles(tx, ty, rot);
  const lane = platformLaneTiles(tx, ty, rot);
  const strip = platformStripTiles(tx, ty, rot);
  const ports = platformPorts(tx, ty, rot).map(({ tile, dir }) => ({ tile: [...tile] as [number, number], dir }));
  const anchors = platformAnchorCandidates(world.grid, factories, ownerId, tiles);
  const { footprint, code } = planFootprint(world, tiles);

  let anchorCode: string | null = null;
  if (anchors.length === 0) anchorCode = "no-anchor";
  else if (anchor != null && !anchorIn(anchor, anchors)) anchorCode = "anchor-invalid";
  else if (anchor == null && anchors.length > 1) anchorCode = "anchor-ambiguous";
  const chosen = anchor ?? (anchors.length === 1 ? anchors[0] : null);
  if (!anchorCode && chosen && platformAtAnchor(world.rw, ownerId, chosen)) {
    anchorCode = "anchor-taken";
  }

  const finalCode = code ?? anchorCode;
  return {
    kind: "platform", tx, ty, rot,
    footprint,
    lane: tuples(lane),
    strip: tuples(strip),
    ports,
    anchors,
    anchor: finalCode ? null : chosen,
    valid: finalCode === null,
    code: finalCode,
    why: railReasonText(finalCode),
    cost: { ...PLATFORM_COST },
    vp: VICTORY.platform,
  };
}

/**
 * Plan a Train Depot. The port is the rotation's exit direction; when the
 * caller passes one it must MATCH (`bad-port`), which is the check that keeps
 * a depot record from a snapshot honest about which way its trains leave.
 */
export function planDepot(
  world: RailWorld, tx: number, ty: number, rot: Rotation, port?: Dir,
): RailStructurePlan {
  const tiles = depotTiles(tx, ty, rot);
  const dir = depotPortDir(rot);
  const { footprint, code } = planFootprint(world, tiles);
  const portCode = port !== undefined && port !== dir ? "bad-port" : null;
  const finalCode = code ?? portCode;
  return {
    kind: "depot", tx, ty, rot,
    footprint,
    lane: [],
    strip: [],
    ports: depotPortTiles(tx, ty, rot).map((tile) => ({ tile: [...tile] as [number, number], dir })),
    anchors: [],
    anchor: null,
    valid: finalCode === null,
    code: finalCode,
    why: railReasonText(finalCode),
    cost: { ...RAIL_DEPOT_COST },
    // Depots score nothing: infrastructure, not points (the epic, "Initial
    // costs and scoring").
    vp: 0,
  };
}

/** Does this owner already have a platform anchored to `anchor`? */
export function platformAtAnchor(
  rw: RailwayState, ownerId: number, anchor: RailAnchor,
): RailPlatform | null {
  return rw.platforms.find((p) =>
    p.ownerId === ownerId && p.anchor.kind === anchor.kind && p.anchor.id === anchor.id) ?? null;
}

/** Is the platform's lane joined to its owner's rail network? (for UI/#178) */
export const platformOnNetwork = (
  world: RailWorld, ownerId: number, platform: RailPlatform,
): boolean =>
  platformLaneTiles(platform.tx, platform.ty, platform.rot)
    .some(([x, y]) => railOwnedBy(world.rw, ownerId, x, y));

/** Is the depot's port joined to its owner's rail network? (for UI/#178) */
export const depotOnNetwork = (
  world: RailWorld, ownerId: number, depot: RailDepot,
): boolean =>
  depotPortNeighbours(depot.tx, depot.ty, depot.rot)
    .some(([x, y]) => railOwnedBy(world.rw, ownerId, x, y));

// ── structure builds ──────────────────────────────────────────────────────
export interface RailBuildResult {
  ok: boolean;
  code: string | null;
  why: string | null;
  /** What the build charged — empty on any refusal. */
  cost: Purse;
  /** VP the scoreboard will now pay for this build (platform: 1, depot: 0). */
  vp: number;
  platform?: RailPlatform;
  depot?: RailDepot;
}

const refuse = (plan: RailStructurePlan): RailBuildResult =>
  ({ ok: false, code: plan.code, why: plan.why, cost: {}, vp: 0 });

/**
 * Build a Rail Platform: reserve the whole 2×3, lay the lane's track (it is
 * part of the platform, not a separate purchase), and record it with its
 * anchor. The 1★ is NOT added here: the scoreboard diffs the standing
 * platforms (`victory.ts`), so a platform can never be paid for twice by two
 * code paths.
 */
export function buildPlatform(
  world: RailWorld, factories: readonly Factory[], ownerId: number, owner: string,
  tx: number, ty: number, rot: Rotation, anchor?: RailAnchor | null,
): RailBuildResult {
  const plan = planPlatform(world, factories, ownerId, tx, ty, rot, anchor);
  if (!plan.valid || !plan.anchor) return refuse(plan);
  const { rw } = world;
  const before = cloneRailway(rw);
  const tiles = platformTiles(tx, ty, rot);
  if (!reserveTiles(rw, tiles, OCC_PLATFORM, ownerId)) {
    restoreRailway(rw, before);
    return { ok: false, code: "structure-occupied", why: railReasonText("structure-occupied"), cost: {}, vp: 0 };
  }
  // The lane is the platform's own track: laid at the platform's price, and
  // owner-stamped so it belongs to the network the platform serves.
  for (const [x, y] of platformLaneTiles(tx, ty, rot)) layRail(rw, ownerId, x, y);
  const platform: RailPlatform = {
    id: allocRailId(rw), owner, ownerId, tx, ty, rot, anchor: { ...plan.anchor },
  };
  rw.platforms.push(platform);
  rw.revision++;
  return { ok: true, code: null, why: null, cost: plan.cost, vp: VICTORY.platform, platform };
}

/** Build a Train Depot: reserve the 2×2 and lay the port edge's track stub. */
export function buildRailDepot(
  world: RailWorld, ownerId: number, owner: string,
  tx: number, ty: number, rot: Rotation, port?: Dir,
): RailBuildResult {
  const plan = planDepot(world, tx, ty, rot, port);
  if (!plan.valid) return refuse(plan);
  const { rw } = world;
  const before = cloneRailway(rw);
  const tiles = depotTiles(tx, ty, rot);
  if (!reserveTiles(rw, tiles, OCC_DEPOT, ownerId)) {
    restoreRailway(rw, before);
    return { ok: false, code: "structure-occupied", why: railReasonText("structure-occupied"), cost: {}, vp: 0 };
  }
  for (const [x, y] of depotPortTiles(tx, ty, rot)) layRail(rw, ownerId, x, y);
  const depot: RailDepot = {
    id: allocRailId(rw), owner, ownerId, tx, ty, rot, port: depotPortDir(rot),
  };
  rw.depots.push(depot);
  rw.revision++;
  return { ok: true, code: null, why: null, cost: plan.cost, vp: 0, depot };
}

// ── demolition ────────────────────────────────────────────────────────────
export interface RailDemolishResult {
  ok: boolean;
  code: string | null;
  why: string | null;
  /** floor(50%) of the construction cost, per resource. */
  refund: Purse;
  /** VP the scoreboard will revoke with this demolition. */
  vp: number;
}

const cannotDemolish = (code: string): RailDemolishResult =>
  ({ ok: false, code, why: railReasonText(code), refund: {}, vp: 0 });

/**
 * Tear up one rail tile. Refund is floor(50%) of the rail price — which for a
 * 1-Stone tile is nothing, and the ticket's arithmetic is deliberate: cheap
 * track is cheap to lose. A crossing may be removed like any other rail tile,
 * and the road underneath is untouched by either the build or the teardown.
 */
export function demolishRailTile(
  world: RailWorld, ownerId: number, tx: number, ty: number,
): RailDemolishResult {
  const { rw } = world;
  if (!railPresent(rw, tx, ty)) return cannotDemolish("no-rail");
  if (railOwnerAt(rw, tx, ty) !== ownerId) return cannotDemolish("not-yours");
  if (trainTiles(rw).has(tIdx(tx, ty))) return cannotDemolish("train-occupied");
  // A platform's lane or a depot's port stub is part of the structure: it goes
  // with the structure, not tile by tile.
  const code = occAt(rw, tx, ty);
  if (code === OCC_PLATFORM || code === OCC_DEPOT) return cannotDemolish("structure-occupied");
  liftRail(rw, tx, ty);
  rw.revision++;
  return { ok: true, code: null, why: null, refund: refundFor(RAIL_COST), vp: 0 };
}

/** Demolish a platform by id: its lane rail, its ground and its 1★ all go. */
export function demolishPlatform(
  world: RailWorld, ownerId: number, id: number,
): RailDemolishResult {
  const { rw } = world;
  const platform = rw.platforms.find((p) => p.id === id);
  if (!platform) return cannotDemolish("no-rail");
  if (platform.ownerId !== ownerId) return cannotDemolish("not-yours");
  const tiles = platformTiles(platform.tx, platform.ty, platform.rot);
  if (tiles.some(([x, y]) => trainTiles(rw).has(tIdx(x, y)))) {
    return cannotDemolish("train-occupied");
  }
  if (rw.lines.some((l) => l.sourceId === id || l.destId === id)) {
    return cannotDemolish("line-assigned");
  }
  for (const [x, y] of platformLaneTiles(platform.tx, platform.ty, platform.rot)) liftRail(rw, x, y);
  releaseTiles(rw, tiles, OCC_PLATFORM, ownerId);
  rw.platforms = rw.platforms.filter((p) => p.id !== id);
  rw.revision++;
  return { ok: true, code: null, why: null, refund: refundFor(PLATFORM_COST), vp: VICTORY.platform };
}

/** Demolish a depot by id. Trains must be sold first (#178's rule). */
export function demolishRailDepot(
  world: RailWorld, ownerId: number, id: number,
): RailDemolishResult {
  const { rw } = world;
  const depot = rw.depots.find((d) => d.id === id);
  if (!depot) return cannotDemolish("no-rail");
  if (depot.ownerId !== ownerId) return cannotDemolish("not-yours");
  const tiles = depotTiles(depot.tx, depot.ty, depot.rot);
  if (tiles.some(([x, y]) => trainTiles(rw).has(tIdx(x, y)))) {
    return cannotDemolish("train-occupied");
  }
  if (rw.trains.some((t) => t.depotId === id)) return cannotDemolish("train-assigned");
  for (const [x, y] of depotPortTiles(depot.tx, depot.ty, depot.rot)) liftRail(rw, x, y);
  releaseTiles(rw, tiles, OCC_DEPOT, ownerId);
  rw.depots = rw.depots.filter((d) => d.id !== id);
  rw.revision++;
  return { ok: true, code: null, why: null, refund: refundFor(RAIL_DEPOT_COST), vp: 0 };
}

// ── small reads the UI (#179) and the AI will want ────────────────────────
/** Rail assets of one owner, for a panel or an AI survey. */
export function railAssetsOf(rw: RailwayState, ownerId: number) {
  return {
    platforms: rw.platforms.filter((p) => p.ownerId === ownerId),
    depots: rw.depots.filter((d) => d.ownerId === ownerId),
    trains: rw.trains.filter((t) => t.ownerId === ownerId),
    lines: rw.lines.filter((l) => l.ownerId === ownerId),
  };
}

/** The owner id a structure tile belongs to (0 = none) — for hover text. */
export const structureOwnerAt = occOwnerAt;

/** Rail on a tile, as a mask the renderer draws with. */
export const railMaskAt = railBitsAt;

/** Is this tile free ground for a structure? (the preview's cheap test) */
export const structureTileFree = (world: RailWorld, tx: number, ty: number): boolean =>
  structureTileRefusal(world, tx, ty) === null;
