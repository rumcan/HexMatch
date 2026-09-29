// ══════════════════════════════════════════════════════════════════════════
// FLEET-2 (#596): BLOCKS - how two trains share one line.
//
// Owner: "if two trains run [the] same line there has to be a switch-over
// trains can use to pass each other."
//
// The owner's rail is cut into SEGMENTS. A PLACE is somewhere trains may wait
// for each other: a Passing Loop's run, a station's lane tracks, a depot's
// shed. Everything between places is a plain BLOCK (single track) - one
// train at a time, found by flooding the rail graph without crossing a place.
//
// A train must RESERVE before it moves across a boundary:
//   * stepping into a block it takes that block AND the next place on its
//     route (so it never has to stop inside a block for want of a siding);
//   * stepping into a place it takes one slot of it (a loop holds one train
//     per direction - that is what lets two trains pass; a station holds one
//     per lane).
// All-or-nothing, in a fixed order (loaded train first, then the lower id),
// so a tie is never a coin flip and the reservations cannot form a cycle:
// trains only ever WAIT in places, and a place always has room for the train
// that needs to come out of it the other way.
//
// This module is pure: it knows tiles (indices) and segment keys, nothing of
// `RailState`. `rail.ts` feeds it the graph and calls it from `tickTrains`.
// ══════════════════════════════════════════════════════════════════════════

export type PlaceKind = "loop" | "station" | "depot";

export interface BlockPlace {
  key: string;
  kind: PlaceKind;
  tiles: number[];
  /** How many trains it holds at once (a loop: one each way; a station: its lanes). */
  slots: number;
  /** A loop counts one train per travel direction; a station just counts. */
  directional: boolean;
}

export interface BlockMap {
  segOf: Map<number, string>;
  places: Map<string, BlockPlace>;
}

/** The place key of a loop / station / depot structure. */
export const placeKey = (kind: PlaceKind, structureId: number): string => `${kind[0].toUpperCase()}${structureId}`;

/**
 * Cut one owner's rail into blocks and places. `tiles` is every tile of the
 * owner's graph, `neighbours` its (undirected) adjacency, `places` the passing
 * places (their tiles win over the flood: a place tile is never in a block).
 */
export function buildBlockMap(
  ownerId: number, tiles: readonly number[], neighbours: (tile: number) => readonly number[],
  places: readonly BlockPlace[],
): BlockMap {
  const segOf = new Map<number, string>();
  const placeMap = new Map<string, BlockPlace>();
  for (const p of places) {
    placeMap.set(p.key, p);
    for (const t of p.tiles) if (!segOf.has(t)) segOf.set(t, p.key);
  }
  const sorted = [...tiles].sort((a, b) => a - b);
  for (const seed of sorted) {
    if (segOf.has(seed)) continue;
    const key = `B${ownerId}:${seed}`;      // the lowest tile names the block - stable across rebuilds
    segOf.set(seed, key);
    const queue = [seed];
    for (let head = 0; head < queue.length; head++) {
      for (const n of neighbours(queue[head])) {
        if (segOf.has(n)) continue;
        segOf.set(n, key);
        queue.push(n);
      }
    }
  }
  return { segOf, places: placeMap };
}

export const isPlaceSeg = (map: BlockMap, seg: string | undefined): boolean => !!seg && map.places.has(seg);

/**
 * What a train must take to step from route[i-1] onto route[i]: the segment it
 * is entering, and - when that is a plain block - the next place its route
 * reaches (`endPlace` names one when the route stops short of it, e.g. a
 * train queuing at a station's throat). Empty when the step stays in one segment.
 */
export function stretchFor(
  map: BlockMap, route: readonly number[], i: number, endPlace?: string | null,
): string[] {
  const here = map.segOf.get(route[i]);
  const from = i > 0 ? map.segOf.get(route[i - 1]) : undefined;
  if (!here || here === from) return [];
  if (map.places.has(here)) return [here];
  const out = [here];
  let j = i;
  while (j + 1 < route.length && map.segOf.get(route[j + 1]) === here) j++;
  const next = j + 1 < route.length ? map.segOf.get(route[j + 1]) : (endPlace ?? undefined);
  if (next && next !== here && map.places.has(next)) out.push(next);
  return out;
}

/** One train's claim on a segment: who, and which way it travels through it. */
export interface Hold { trainId: number; dir: number }

/**
 * May `me` take every segment in `wanted`, given what the OTHER trains hold?
 * A plain block is free or it is not. A place has room when fewer than
 * `slots` trains hold it - and a directional place (a loop) only one per
 * direction, so an oncoming train always has its own side to wait on.
 */
export function canTake(
  map: BlockMap, wanted: readonly string[], dirOf: (seg: string) => number,
  holds: ReadonlyMap<string, readonly Hold[]>, me: number,
): boolean {
  for (const seg of wanted) {
    const others = (holds.get(seg) ?? []).filter((h) => h.trainId !== me);
    if (!others.length) continue;
    const place = map.places.get(seg);
    if (!place) return false;                       // a plain block: one train
    if (place.directional) {
      const d = dirOf(seg);
      if (others.some((h) => h.dir === d) || others.length >= place.slots) return false;
    } else if (others.length >= place.slots) return false;
  }
  return true;
}

/** The fixed order trains ask in: the loaded one first, then the lower id. */
export function priorityOrder<T extends { id: number }>(trains: readonly T[], loaded: (t: T) => boolean): T[] {
  return [...trains].sort((a, b) => Number(loaded(b)) - Number(loaded(a)) || a.id - b.id);
}

/** Distinct places a route passes THROUGH, excluding the named end places. */
export function interiorPlaces(map: BlockMap, route: readonly number[], ends: readonly (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const t of route) {
    const seg = map.segOf.get(t);
    if (seg && map.places.has(seg) && !ends.includes(seg) && !out.includes(seg)) out.push(seg);
  }
  return out;
}
