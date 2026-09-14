// ══════════════════════════════════════════════════════════════════════════
// RAIL-02 (#176) — rail CONNECTIVITY: one owner's network, and who is on it.
//
// The rail layer is private (`state.railOwner`), so "connected" is always
// asked of ONE owner, exactly like `buildComponents` in economy.ts asks it of
// one owner's roads. Two properties come out of that:
//
//   * an opponent's line touching yours is two networks that happen to meet —
//     the epic forbids shared track in v1, and refusing to cross the seam is
//     how that rule is enforced rather than documented;
//   * a platform's LANE and a depot's PORT STUB are ordinary rail tiles
//     carrying the owner's id, so they are part of the component by
//     construction. Nothing has to remember to join a station to its track.
//
// Components are also where the one-ACTIVE-TRAIN rule lives: v1 admits a
// single train per connected component (including depot tracks), so a build
// that MERGES two components has to know how many trains each one held. That
// count is `componentTrains` below, and `commitRailDrag` is what refuses a
// merge that would put two trains in one place.
//
// The flood is a plain stack over the four ground neighbours, tiles visited in
// index order, so component ids are stable for a given board — which matters,
// because a cache or a test that keyed off them would otherwise see them
// shuffle from frame to frame.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W } from "../../game/config";
import { DIRS, DIR, OPPOSITE, PRESENT, tIdx, inMapT } from "../track";
import { depotPortTiles } from "./geometry";
import type { RailTrain, RailwayState } from "./state";

export interface RailComponents {
  /** Component id per tile index; -1 = no rail for this owner. */
  comp: Int32Array;
  /** How many components exist. */
  count: number;
  /** Tiles per component. */
  size: Int32Array;
}

/**
 * Flood one owner's rail into connected components. A tile joins its neighbour
 * only when BOTH face each other (the mutual-bit invariant the roads use), so
 * a one-sided bit can never merge two stretches.
 */
export function buildRailComponents(rw: RailwayState, ownerId: number): RailComponents {
  const comp = new Int32Array(rw.rail.length).fill(-1);
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < comp.length; start++) {
    if (comp[start] !== -1) continue;
    if ((rw.rail[start] & PRESENT) === 0) continue;
    if (rw.railOwner[start] !== ownerId) continue;
    const id = next++;
    comp[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      const bits = rw.rail[i] & 0b1111;
      for (const d of DIRS) {
        if (!(bits & d)) continue;
        const [dx, dy] = DIR[d];
        const nx = x + dx, ny = y + dy;
        if (!inMapT(nx, ny)) continue;
        const ni = tIdx(nx, ny);
        if (comp[ni] !== -1) continue;
        if ((rw.rail[ni] & PRESENT) === 0) continue;
        if (rw.railOwner[ni] !== ownerId) continue;
        // mutual: the neighbour must face back, or the two are not joined
        if ((rw.rail[ni] & OPPOSITE[d]) === 0) continue;
        comp[ni] = id;
        stack.push(ni);
      }
    }
  }
  const size = new Int32Array(next);
  for (let i = 0; i < comp.length; i++) if (comp[i] >= 0) size[comp[i]]++;
  return { comp, count: next, size };
}

/** Every tile carrying this owner's rail — the seed set a drag may start from. */
export function railNetworkTiles(rw: RailwayState, ownerId: number): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < rw.rail.length; i++) {
    if ((rw.rail[i] & PRESENT) === 0) continue;
    if (rw.railOwner[i] !== ownerId) continue;
    out.add(i);
  }
  return out;
}

/** Are these two tiles on one of the owner's components? */
export function railConnected(
  rw: RailwayState, ownerId: number, a: readonly [number, number], b: readonly [number, number],
): boolean {
  const comps = buildRailComponents(rw, ownerId);
  const ca = comps.comp[tIdx(a[0], a[1])];
  if (ca < 0) return false;
  return comps.comp[tIdx(b[0], b[1])] === ca;
}

/** The component a tile belongs to for this owner, or -1. */
export function componentAt(
  rw: RailwayState, ownerId: number, tx: number, ty: number,
): number {
  if (!inMapT(tx, ty)) return -1;
  return buildRailComponents(rw, ownerId).comp[tIdx(tx, ty)];
}

/**
 * The tile a train is anchored to: its own first tile, or — for a train
 * standing in its depot, which has no track tile of its own — the depot's port
 * stub. This is what makes "one train per component" answerable for a stored
 * train, and #178 keeps `tiles` current as the train moves.
 */
export function trainAnchorTile(rw: RailwayState, train: RailTrain): number {
  if (train.tiles.length) return train.tiles[0];
  const depot = rw.depots.find((d) => d.id === train.depotId);
  if (!depot) return -1;
  const stubs = depotPortTiles(depot.tx, depot.ty, depot.rot);
  return stubs.length ? tIdx(stubs[0][0], stubs[0][1]) : -1;
}

/**
 * Which trains stand on which component of this owner's network.
 * A train whose tiles are not on any component (parked on a line that was torn
 * up) is reported under -1 rather than dropped, so a caller can see it.
 */
export function componentTrains(
  rw: RailwayState, ownerId: number, comps?: RailComponents,
): Map<number, RailTrain[]> {
  const c = comps ?? buildRailComponents(rw, ownerId);
  const out = new Map<number, RailTrain[]>();
  for (const train of rw.trains) {
    if (train.ownerId !== ownerId) continue;
    const anchor = trainAnchorTile(rw, train);
    const id = anchor >= 0 ? c.comp[anchor] : -1;
    const list = out.get(id) ?? [];
    list.push(train);
    out.set(id, list);
  }
  return out;
}

/** Component ids holding more than one train — the v1 rule's violations. */
export function overTrainLimit(rw: RailwayState, ownerId: number): number[] {
  const out: number[] = [];
  for (const [id, trains] of componentTrains(rw, ownerId)) {
    if (id >= 0 && trains.length > 1) out.push(id);
  }
  return out;
}

/** Tiles any of this owner's structures stand on, for a hover highlight. */
export function structureTilesOf(rw: RailwayState, ownerId: number): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < rw.occ.length; i++) {
    if (rw.occ[i] === 0) continue;
    if (rw.occOwner[i] !== ownerId) continue;
    out.add(i);
  }
  return out;
}
