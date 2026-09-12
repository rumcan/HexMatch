// ══════════════════════════════════════════════════════════════════════════
// TRAFFIC-01 — ambient cars: a few simple cars driving the streets and roads.
//
// This is a PERFORMANCE PROBE dressed as a feature. The question it answers:
// "does having a few cars driving on the map kill performance?" — so the
// implementation is deliberately about as cheap as it can be:
//
//   * THREE cars by default (`CAR_COUNT`), named "car 1" / "car 2" /
//     "car 3", and each has its OWN art slot (car1_* / car2_* / car3_*,
//     four diagonal views each). The slots currently hold a COPY of the TTD
//     goods lorry — the placeholder the user replaces per car by dropping
//     PNGs into src/assets/sprites/png/vehicles/ttd/cars/ and running
//     `npm run slice-atlas` (TRAFFIC-02). Until then the names, not the
//     pixels, identify them (`__iso.traffic` lists them by name).
//   * Each car drives a route over the road surface (paved AND dirt, public
//     streets included) using the same mutual-bit edges the economy's routes
//     cross. A bounded DFS finds a real cycle in the road graph (the town
//     ring roads) and the car loops it forever; a tree-shaped road with no
//     cycle degenerates to a ping-pong (go there, come back) — the truck's
//     exact motion model.
//   * Motion is position-along-route in tile units (leg + t), ticked with
//     the same dt-capped integration `tickTrucks` uses, so a huge tick
//     folds through the turns instead of teleporting.
//
// It is pure presentation and host/solo-local, exactly like the lorries:
// a guest runs no vehicle movement, the cars are not on the wire, and
// nothing here changes any economy outcome.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W } from "../game/config";
import {
  NE, SE, SW, NW, DIRS, DIR, OPPOSITE, PRESENT, inMapT, tIdx,
  type Track,
} from "./track";
import type { DrawItem } from "./depth";
import { TRUCK_SPEED } from "./vehicles";

/** The traffic volume the probe starts with — "a few cars". */
export const CAR_COUNT = 3;
/** Cars drive at the lorry's pace: one tile every 300 ms. */
export const CAR_SPEED = TRUCK_SPEED;
/** Walk budget per car when finding a loop (96 tiles is plenty of street). */
const MAX_STEPS = 96;
/** A route shorter than this is not a drive (a stub is a parking spot). */
const MIN_PING_PONG = 2;
/** A cycle shorter than this is not a loop (the DFS skips the edge back to
 *  its parent, so 2-tile "cycles" cannot surface). */
const MIN_LOOP = 3;
/** How many candidate walks per car before we accept the least-overlapping
 *  one — cheap, and it keeps car 2 and 3 off car 1's exact street. */
const WALK_ATTEMPTS = 12;

/** One car on one route. Position along the route is `leg` + `t` tiles. */
export interface Car {
  /** "car 1" … "car N" — the art slot follows the index (car1_* … car3_*). */
  name: string;
  /** 1-based art-slot index: car 1 drives car1_*, car 2 drives car2_*, …
   *  (beyond three, the slots cycle — see `carSprite`). */
  carIndex: number;
  /**
   * Loop routes hold the CYCLE without repeating the closing tile
   * (segment k is route[k] → route[(k+1) % n]). Ping-pong routes hold a
   * plain path (segment k is route[k] → route[k+1], k < n-1).
   */
  route: [number, number][];
  /** true = keeps driving the cycle, false = ping-pongs the path. */
  loop: boolean;
  /** Index of the route tile the car is leaving. */
  leg: number;
  /** 0..1 progress from `route[leg]` toward the segment's far tile. */
  t: number;
  /** Ping-pong only: false = toward the end of the path, true = back. */
  reverse: boolean;
}

export interface CarState {
  cars: Car[];
}

export const createCarState = (): CarState => ({ cars: [] });

// ── the route finder ──────────────────────────────────────────────────────
/** Deterministic per-boot PRNG (mulberry32) — ambient traffic needs no
 *  entropy, and a fixed seed keeps the plan stable across replans. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** Tile indices that carry ANY road surface (dirt or paved), in row order. */
function roadTiles(track: Track): number[] {
  const out: number[] = [];
  const road = track.road, dirt = track.dirt;
  for (let i = 0; i < road.length; i++) {
    if ((road[i] & PRESENT) !== 0 || (dirt[i] & PRESENT) !== 0) out.push(i);
  }
  return out;
}

/**
 * The car graph, built ONCE per plan: for every road tile, the adjacent
 * road tiles it may drive to — one entry per DIRECTION the mask faces, but
 * only where the neighbour faces back (E5's mutual-bit invariant — a half-
 * autotiled stub never carries traffic). The economy's routes cross exactly
 * these edges, so the cars drive what the game calls "a road".
 */
function buildNeighbours(track: Track, tiles: number[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const maskAt = (i: number): number => (track.road[i] || track.dirt[i]) & 0b1111;
  for (const i of tiles) {
    const x = i % MAP_W, y = (i / MAP_W) | 0;
    const mask = maskAt(i);
    const open: number[] = [];
    for (const d of DIRS) {
      if (!(mask & d)) continue;
      const nx = x + DIR[d][0], ny = y + DIR[d][1];
      if (!inMapT(nx, ny)) continue;
      const ni = tIdx(nx, ny);
      if (!(maskAt(ni) & OPPOSITE[d])) continue;
      open.push(ni);
    }
    out.set(i, open);
  }
  return out;
}

const cycleToXY = (idxs: number[]): [number, number][] =>
  idxs.map((i) => [i % MAP_W, (i / MAP_W) | 0] as [number, number]);

/**
 * Bounded DFS from `start` looking for a SIMPLE cycle (a driveable ring:
 * no repeated tile, the closing edge implied). A back edge onto a node that
 * is still on the current DFS path closes the path segment between them —
 * that segment IS the cycle. Neighbour order is shuffled per node with the
 * seeded rng, so different attempts find different rings on the same
 * network. null when the reachable component holds no cycle (a tree-shaped
 * private road) or the budget runs out.
 *
 * A random walk cannot do this job: on a 200-tile town ring road a walk has
 * not walked far enough to close, and on a branching network it wanders.
 * The DFS is exact and cheap (each edge relaxed at most twice).
 */
function findSimpleCycle(
  start: number, neighbours: Map<number, number[]>, rng: () => number, budget = 8000,
): [number, number][] | null {
  const onPath = new Set<number>([start]);
  const done = new Set<number>();
  const path: number[] = [start];
  // stack entries: [node, parent, remaining-neighbours]. The copies matter:
  // the DFS pops its way through them, and the map's arrays are still
  // needed afterwards (the dead-end walk, the next car's plan).
  const stack: [number, number, number[]][] = [
    [start, -1, shuffle([...(neighbours.get(start) ?? [])], rng)],
  ];
  let explored = 0;
  while (stack.length) {
    const top = stack[stack.length - 1]!;
    const u = top[0];
    let advanced = false;
    while (top[2].length && explored < budget) {
      const v = top[2].pop()!;
      explored++;
      if (v === top[1]) continue;      // the edge we came in on
      if (done.has(v)) continue;
      if (onPath.has(v)) {
        const cycle = path.slice(path.indexOf(v));
        if (cycle.length >= MIN_LOOP) return cycleToXY(cycle);
        continue;
      }
      onPath.add(v);
      path.push(v);
      stack.push([v, u, shuffle([...(neighbours.get(v) ?? [])], rng)]);
      advanced = true;
      break;
    }
    if (!advanced) {
      stack.pop();
      onPath.delete(u);
      done.add(u);
      path.pop();
    }
  }
  return null;
}

/** Fisher-Yates with the seeded rng (the arrays are freshly built per node). */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = arr[i]!, b = arr[j]!;
    arr[i] = b; arr[j] = a;
  }
  return arr;
}

/**
 * A walk to a dead end (for tree-shaped components that have no cycle to
 * loop): never U-turns — on a tree that means the path is SIMPLE (no
 * repeated tile) all the way to a leaf, and ping-ponging start→leaf is a
 * perfectly respectable country drive. A lone stub (no exit at all) yields
 * no route.
 */
function walkToDeadEnd(start: number, neighbours: Map<number, number[]>, rng: () => number):
  [number, number][] | null {
  const path: number[] = [start];
  let cur = start, prev = -1;
  for (let step = 0; step < MAX_STEPS; step++) {
    const open = (neighbours.get(cur) ?? []).filter((v) => v !== prev);
    if (!open.length) break;            // dead end (or lone stub): stop here
    const next = open[Math.floor(rng() * open.length)]!;
    path.push(next);
    prev = cur;
    cur = next;
  }
  return path.length >= MIN_PING_PONG ? cycleToXY(path) : null;
}

/**
 * One candidate route from a random start: a LOOP when the DFS closes a
 * ring, else a PING-PONG path (the component either holds a cycle or it
 * doesn't — the DFS answer is authoritative within its budget).
 */
function routeFrom(
  start: number, neighbours: Map<number, number[]>, rng: () => number,
): { tiles: [number, number][]; loop: boolean } | null {
  const cycle = findSimpleCycle(start, neighbours, rng);
  if (cycle) return { tiles: cycle, loop: true };
  const path = walkToDeadEnd(start, neighbours, rng);
  return path ? { tiles: path, loop: false } : null;
}

/** Pick the best of a handful of candidate routes: prefer one that shares
 *  little of its street with the routes already adopted (so the three cars
 *  read as traffic, not a convoy), fall back to the first valid route. */
function findRoute(
  tiles: number[], neighbours: Map<number, number[]>, rng: () => number, adopted: Car[],
): { tiles: [number, number][]; loop: boolean } | null {
  const adoptedSets = adopted.map((c) => new Set(c.route.map(([x, y]) => tIdx(x, y))));
  let best: { tiles: [number, number][]; loop: boolean } | null = null;
  let bestScore = Infinity;
  for (let attempt = 0; attempt < WALK_ATTEMPTS; attempt++) {
    const start = tiles[Math.floor(rng() * tiles.length)];
    const r = routeFrom(start, neighbours, rng);
    if (!r) continue;
    const self = new Set(r.tiles.map(([x, y]) => tIdx(x, y)));
    let score = 0;
    for (const set of adoptedSets) {
      let n = 0;
      for (const i of self) if (set.has(i)) n++;
      score = Math.max(score, n / Math.max(1, Math.min(self.size, set.size)));
    }
    if (score < bestScore) { best = r; bestScore = score; if (score === 0) break; }
  }
  return best;
}

const routeKey = (route: [number, number][], loop: boolean): string =>
  `${loop ? "L" : "P"}${JSON.stringify(route)}`;

/**
 * Plan up to `count` cars over the CURRENT road surface (paved + dirt, every
 * owner — the ambient traffic of the streets, not any player's freight).
 * `prev` is the previous plan: a car whose route is byte-identical keeps its
 * (leg, t, reverse) and drives on mid-crack, the same migration rule as the
 * lorries' `planTrucksTrucksMerge`. New cars start spaced apart on their
 * route so the three are not a single blob at the depot end.
 */
export function planCars(
  track: Track, prev: Car[] = [], count: number = CAR_COUNT, seed: number = 0x72af,
): Car[] {
  const tiles = roadTiles(track);
  if (tiles.length === 0 || count <= 0) return [];
  const rng = mulberry32(seed);
  const neighbours = buildNeighbours(track, tiles);
  const out: Car[] = [];
  for (let i = 0; i < count; i++) {
    const r = findRoute(tiles, neighbours, rng, out);
    if (!r) continue;
    const p = prev[i];
    let leg = 0, t = 0, reverse = false;
    if (p && p.loop === r.loop && routeKey(p.route, p.loop) === routeKey(r.tiles, r.loop)) {
      leg = p.leg; t = p.t; reverse = p.reverse;
    } else {
      const segs = r.loop ? r.tiles.length : r.tiles.length - 1;
      if (segs > 1) leg = (i * 5) % segs;    // spread the starting points
    }
    out.push({ name: `car ${i + 1}`, carIndex: i + 1, route: r.tiles, loop: r.loop, leg, t, reverse });
  }
  return out;
}

// ── the clock ─────────────────────────────────────────────────────────────
/**
 * Advance every car by `dtMs`. Position is (leg, t) along the route with the
 * truck's exact integration: forward integrates t up to 1, a ping-pong car
 * flips at the ends, a loop car wraps. A huge tick folds through the turns
 * segment by segment — it turns the car around at the exact end tile, never
 * a teleport. (No blocked-set: ambient traffic has no protests to respect —
 * the crowds stand on the road, the cars politely ignore them for now.)
 */
export function tickCars(state: CarState, dtMs: number): void {
  if (dtMs <= 0) return;
  for (const car of state.cars) {
    const n = car.route.length;
    if (n < 2) continue;
    const segs = car.loop ? n : n - 1;
    let ms = dtMs;
    let guard = 0;
    while (ms > 1e-9 && ++guard < 100_000) {
      const k = car.leg;
      // ms to the segment's far end at CAR_SPEED (1 tile / 300 ms).
      const need = (car.reverse ? car.t : 1 - car.t) / CAR_SPEED;
      if (ms < need) {
        car.t += (car.reverse ? -1 : 1) * ms * CAR_SPEED;
        break;
      }
      ms -= need;
      if (car.loop) {
        car.t = 0;
        car.leg = (k + 1) % n;
      } else if (car.reverse) {
        // t reached 0 — the car is standing on route[k]
        if (k === 0) { car.reverse = false; car.t = 0; }
        else { car.leg = k - 1; car.t = 1; }
      } else {
        // t reached 1 — the car is standing on route[k+1]
        if (k + 1 === segs) car.reverse = true;
        else { car.leg = k + 1; car.t = 0; }
      }
    }
  }
}

// ── drawing ───────────────────────────────────────────────────────────────
/** How many art slots ship: car1_*, car2_*, car3_* (see the cells and the
 *  art folder src/assets/sprites/png/vehicles/ttd/cars/). */
export const CAR_ART_SLOTS = 3;

/** View name for a direction bit — the four diagonal views the iso roads
 *  can express (ne = up/right, se = down/right, sw = down/left, nw = up/left). */
const VIEW_OF: Record<number, string> = {
  [NE]: "ne", [SE]: "se", [SW]: "sw", [NW]: "nw",
};

/**
 * The sprite for car `carIndex` (1-based) facing a direction bit. Each car
 * has its OWN art slot — car 1 drives car1_*, car 2 drives car2_*, car 3
 * drives car3_* — so dropping different PNGs into
 * src/assets/sprites/png/vehicles/ttd/cars/ gives different cars on the
 * street (TRAFFIC-02). Beyond the shipped slots the art cycles (car 4 looks
 * like car 1), so `setTraffic(n)` can grow past three without new cells.
 */
export function carSprite(carIndex: number, dir: number): string {
  const slot = ((carIndex - 1) % CAR_ART_SLOTS) + 1;
  return `car${slot}_${VIEW_OF[dir] ?? "se"}`;
}

/** Direction bit for driving FROM one tile TO an adjacent one. */
function dirBit(from: [number, number], to: [number, number]): number {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  if (dx > 0) return SE;
  if (dx < 0) return NW;
  if (dy > 0) return SW;
  if (dy < 0) return NE;
  return SE;                           // degenerate: face somewhere sensible
}

/**
 * The cars as draw items: FRACTIONAL tile position between route-tile
 * centres (same contract as `truckItems` — `depth.place` anchors a moving
 * item at the fractional tile's diamond centre and picking skips it), the
 * directional truck sprite for the direction of TRAVEL (a ping-pong car
 * turning around faces the way it is actually rolling), and the rounded
 * tile for culling. `ref` carries the name so `__iso.traffic` and any
 * debug overlay can label car 1 / car 2 / car 3.
 */
export function carItems(state: CarState): DrawItem[] {
  const out: DrawItem[] = [];
  for (const car of state.cars) {
    const n = car.route.length;
    if (n < 2) continue;
    const k = car.leg;
    const a = car.route[k];
    const b = car.route[car.loop ? (k + 1) % n : Math.min(k + 1, n - 1)];
    const fx = a[0] + (b[0] - a[0]) * car.t;
    const fy = a[1] + (b[1] - a[1]) * car.t;
    const dir = car.reverse ? dirBit(b, a) : dirBit(a, b);
    const sprite = carSprite(car.carIndex, dir);
    out.push({ sprite, tx: Math.round(fx), ty: Math.round(fy), fx, fy, ref: { car: car.name } });
  }
  return out;
}
