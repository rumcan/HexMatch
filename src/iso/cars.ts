// ══════════════════════════════════════════════════════════════════════════
// TRAFFIC-02 — ambient cars as natural town-to-town and local trips.
//
// Replaces TRAFFIC-01's endlessly roaming loop/ping-pong cars with a bounded
// trip lifecycle: waiting → spawning → driving → arriving → despawning → waiting.
//
// Each car spawns at a plausible origin (a road access node derived from a
// town's own streets), drives ONE-WAY to a distinct destination (same town for
// local trips, another town for inter-town), fades out on arrival, waits a
// short seeded delay, then starts a newly chosen trip. No perpetual circling
// or endpoint U-turns.
//
// Routing uses the same mutual-bit road graph the economy and lorries use
// (paved + dirt, public streets included) — only traversable connected roads.
// Adjacency is cached by track.revision so we don't rebuild every render frame.
// Path searches run only when a car needs a new trip, never per frame.
//
// Multiplayer: host generates and advances trips; guests replicate IDs, trip
// state and progress through existing vehicle sync. Ambient traffic stays
// cosmetic: no income, occupancy blocking or VP.
//
// Art: reuses current car PNG assets (car1_* / car2_* / car3_*), four diagonal
// views, slots cycle for car 4+.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W } from "../game/config";
import {
  NE, SE, SW, NW, DIRS, DIR, OPPOSITE, PRESENT, inMapT, tIdx,
  type Track,
} from "./track";
import type { Grid } from "./grid";
import type { DrawItem } from "./depth";

/** Default traffic volume — a dozen cars feels lived-in. */
export const CAR_COUNT = 12;
/**
 * Tiles per millisecond: one tile every 600 ms.
 *
 * L7 (#221): this is a STANDALONE constant, not the depot-lorry pace. Depot
 * lorries scale their pace by the clock rate (`yield × distance × transport`);
 * ambient traffic must not follow, or a well-tuned farm would also send the
 * town's cars flying. The numeric value matches today's gravel lorry so the
 * streets look the same as they did before the rates were wired in.
 */
export const CAR_SPEED = 1 / 600;

/** How many art slots ship: car1_*, car2_*, car3_* */
export const CAR_ART_SLOTS = 3;

/** Trip lifecycle */
export type CarTripState = "waiting" | "spawning" | "driving" | "arriving" | "despawning";

/** One ambient car on a bounded trip. */
export interface Car {
  /** "car 1" … "car N" */
  name: string;
  /** 1-based art-slot index: car 1 drives car1_*, etc (cycles past 3). */
  carIndex: number;

  /** Trip endpoints derived from towns. Null when waiting with no trip. */
  originTownId: number | null;
  destTownId: number | null;
  origin: [number, number] | null;
  dest: [number, number] | null;

  /** One-way route from origin to dest inclusive. Empty when waiting. */
  route: [number, number][];

  /** Lifecycle */
  state: CarTripState;
  /** Index of route tile car is leaving (0..route.length-2). For spawning/despawning, 0 or last. */
  leg: number;
  /** 0..1 progress from route[leg] toward next tile. */
  t: number;

  /** Waiting: ms remaining before next departure attempt. */
  waitMs: number;
  /** Spawn/despawn fade: ms remaining in current fade phase. */
  fadeMs: number;
  /** 0..1 opacity for rendering (0 invisible, 1 fully visible). */
  fade: number;
  /** Arriving pause before despawn. */
  arriveMs: number;

  /** Last trip key to avoid immediate identical repeats where alternatives exist. */
  lastTripKey: string | null;

  // ── legacy compat (for old tests/snapshots that read loop/reverse) ───────
  /** @deprecated — TRAFFIC-02 has no loops; kept as optional for compat. */
  loop?: boolean;
  /** @deprecated — TRAFFIC-02 drives one-way; kept as optional for compat. */
  reverse?: boolean;
}

export interface CarState {
  cars: Car[];
  /** Internal revision of cached adjacency — not on wire. */
  _adjRevision?: number;
  _adjCache?: Map<number, number[]>;
}

export const createCarState = (): CarState => ({ cars: [] });

// ── PRNG ────────────────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

// ── road graph ──────────────────────────────────────────────────────────
function roadTiles(track: Track): number[] {
  const out: number[] = [];
  const road = track.road, dirt = track.dirt;
  for (let i = 0; i < road.length; i++) {
    if ((road[i] & PRESENT) !== 0 || (dirt[i] & PRESENT) !== 0) out.push(i);
  }
  return out;
}

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

// Cache adjacency by track.revision
let globalAdjCache: { track: Track | null; revision: number; neighbours: Map<number, number[]> } = {
  track: null,
  revision: -1,
  neighbours: new Map(),
};

function getNeighbours(track: Track): Map<number, number[]> {
  if (globalAdjCache.track === track && globalAdjCache.revision === track.revision) {
    return globalAdjCache.neighbours;
  }
  const tiles = roadTiles(track);
  const neighbours = buildNeighbours(track, tiles);
  globalAdjCache = { track, revision: track.revision, neighbours };
  return neighbours;
}

function isRouteValid(route: [number, number][], neighbours: Map<number, number[]>): boolean {
  if (route.length < 2) return false;
  for (let k = 0; k < route.length - 1; k++) {
    const a = route[k], b = route[k + 1];
    const ai = tIdx(a[0], a[1]), bi = tIdx(b[0], b[1]);
    const open = neighbours.get(ai);
    if (!open || !open.includes(bi)) return false;
  }
  return true;
}

// ── BFS shortest path ───────────────────────────────────────────────────
function bfs(start: number, target: number, neighbours: Map<number, number[]>): number[] | null {
  if (start === target) return [start];
  const queue: number[] = [start];
  const prev = new Map<number, number>();
  const seen = new Set<number>([start]);
  prev.set(start, -1);
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const open = neighbours.get(cur) ?? [];
    for (const nb of open) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      prev.set(nb, cur);
      if (nb === target) {
        // reconstruct
        const path: number[] = [];
        let at: number | undefined = nb;
        while (at !== undefined && at !== -1) {
          path.push(at);
          at = prev.get(at);
          if (at === -1) break;
        }
        path.reverse();
        return path;
      }
      queue.push(nb);
    }
  }
  return null;
}

const idxToXY = (i: number): [number, number] => [i % MAP_W, (i / MAP_W) | 0] as [number, number];
const xyToIdx = (xy: [number, number]): number => tIdx(xy[0], xy[1]);

// ── town access nodes ───────────────────────────────────────────────────
type TownNodes = Map<number, number[]>; // townId -> tile indices

function townAccessNodes(grid: Grid | null | undefined, track: Track, neighbours: Map<number, number[]>): TownNodes {
  const out: TownNodes = new Map();
  if (grid && grid.towns && grid.towns.length > 0) {
    for (const town of grid.towns) {
      const nodes: number[] = [];
      for (const [rx, ry] of town.roads) {
        if (!inMapT(rx, ry)) continue;
        const idx = tIdx(rx, ry);
        // must be present as road and have at least one mutual edge OR be isolated but still road?
        // We require present and in neighbours map (even if degree 0, still plausible? but for routing we need degree>0 unless origin==dest)
        if ((track.road[idx] & PRESENT) === 0 && (track.dirt[idx] & PRESENT) === 0) continue;
        // keep even if degree 0? For local trips we need at least connectivity, but keep for now
        // Only keep if in neighbours (which implies present)
        if (!neighbours.has(idx)) continue;
        nodes.push(idx);
      }
      if (nodes.length > 0) out.set(town.id, nodes);
    }
  }
  // Fallback: if no towns or no town nodes (e.g. synthetic test grids), treat all road tiles as one pseudo-town
  if (out.size === 0) {
    const all = roadTiles(track).filter((i) => neighbours.has(i));
    if (all.length > 0) out.set(0, all);
  }
  return out;
}

// ── trip finding ────────────────────────────────────────────────────────
export const LOCAL_WEIGHT = 0.6;
export const INTER_WEIGHT = 0.4;
const MAX_ROUTE_TILES = 256;
const TRIP_ATTEMPTS = 30;

interface FoundTrip {
  originTownId: number;
  destTownId: number;
  originIdx: number;
  destIdx: number;
  routeIdx: number[];
  route: [number, number][];
  key: string;
}

function tripKey(originIdx: number, destIdx: number): string {
  return `${originIdx}->${destIdx}`;
}

function findTrip(
  rng: () => number,
  townNodes: TownNodes,
  neighbours: Map<number, number[]>,
  lastTripKey: string | null,
): FoundTrip | null {
  const townIds = [...townNodes.keys()];
  if (townIds.length === 0) return null;

  // Helper to pick random element
  const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]!;

  // Try multiple attempts
  let best: FoundTrip | null = null;

  for (let attempt = 0; attempt < TRIP_ATTEMPTS; attempt++) {
    const wantLocal = rng() < LOCAL_WEIGHT || townIds.length < 2;
    if (wantLocal) {
      // local: same town, distinct nodes
      const eligibleTowns = townIds.filter((id) => (townNodes.get(id)?.length ?? 0) >= 2);
      if (eligibleTowns.length === 0) continue;
      const townId = pick(eligibleTowns);
      const nodes = townNodes.get(townId)!;
      // pick two distinct
      let a = pick(nodes), b = pick(nodes);
      let guard = 0;
      while (b === a && guard < 10) { b = pick(nodes); guard++; }
      if (a === b) continue;
      const path = bfs(a, b, neighbours);
      if (!path) continue;
      if (path.length < 2 || path.length > MAX_ROUTE_TILES) continue;
      const key = tripKey(a, b);
      if (lastTripKey && key === lastTripKey) {
        // avoid immediate repeat if alternatives exist — try to find different
        // If this is the only possible route, allow repeat; else skip this attempt
        const hasAlternative = nodes.length > 2 || eligibleTowns.length > 1 || [...townNodes.values()].some((arr) => arr.length >= 2);
        if (hasAlternative) {
          // try again without counting as failed? just continue to next attempt
          if (attempt < TRIP_ATTEMPTS - 1) continue;
        }
      }
      const route = path.map(idxToXY);
      return {
        originTownId: townId,
        destTownId: townId,
        originIdx: a,
        destIdx: b,
        routeIdx: path,
        route,
        key,
      };
    } else {
      // inter-town
      if (townIds.length < 2) continue;
      const fromId = pick(townIds);
      const toCandidates = townIds.filter((id) => id !== fromId);
      if (toCandidates.length === 0) continue;
      const toId = pick(toCandidates);
      const fromNodes = townNodes.get(fromId)!;
      const toNodes = townNodes.get(toId)!;
      if (fromNodes.length === 0 || toNodes.length === 0) continue;
      const a = pick(fromNodes);
      const b = pick(toNodes);
      const path = bfs(a, b, neighbours);
      if (!path) continue;
      if (path.length < 2 || path.length > MAX_ROUTE_TILES) continue;
      const key = tripKey(a, b);
      if (lastTripKey && key === lastTripKey) {
        const hasAlt = townIds.length > 2 || fromNodes.length > 1 || toNodes.length > 1;
        if (hasAlt && attempt < TRIP_ATTEMPTS - 1) continue;
      }
      const route = path.map(idxToXY);
      return {
        originTownId: fromId,
        destTownId: toId,
        originIdx: a,
        destIdx: b,
        routeIdx: path,
        route,
        key,
      };
    }
  }
  // If we found nothing but have a best, return it (currently we return immediately on first valid)
  return best;
}

// ── planning ────────────────────────────────────────────────────────────
// Constants for lifecycle timing
export const SPAWN_FADE_MS = 400;
export const DESPAWN_FADE_MS = 400;
export const ARRIVE_PAUSE_MS = 200;
export const WAIT_MIN_MS = 1000;
export const WAIT_MAX_MS = 4000;

/**
 * Flexible arg parsing to stay backward compatible with old tests that call
 * planCars(track, prev, count, seed) without a grid.
 *
 * New signature: planCars(track, grid, prev, count, seed)
 * Old signatures:
 *   planCars(track)
 *   planCars(track, prev, count, seed)
 *   planCars(track, [], count)
 */
export function planCars(
  track: Track,
  gridOrPrev: Grid | Car[] | null | undefined = [],
  prevOrCount: Car[] | number = [],
  countOrSeed: number = CAR_COUNT,
  seed: number = 0x72af,
): Car[] {
  let grid: Grid | null = null;
  let prev: Car[] = [];
  let count = CAR_COUNT;
  let seedVal = 0x72af;

  if (Array.isArray(gridOrPrev)) {
    // old: (track, prev, count, seed)
    prev = gridOrPrev as Car[];
    if (typeof prevOrCount === "number") {
      count = prevOrCount;
      if (typeof countOrSeed === "number") seedVal = countOrSeed;
    } else if (Array.isArray(prevOrCount)) {
      // shouldn't happen, but handle
      prev = prevOrCount as Car[];
      if (typeof countOrSeed === "number") count = countOrSeed;
      if (typeof seed === "number") seedVal = seed;
    } else {
      // prevOrCount is [] etc
      if (typeof countOrSeed === "number") count = countOrSeed;
      if (typeof seed === "number") seedVal = seed;
    }
  } else if (gridOrPrev && typeof gridOrPrev === "object" && "towns" in (gridOrPrev as any)) {
    grid = gridOrPrev as Grid;
    if (Array.isArray(prevOrCount)) {
      prev = prevOrCount as Car[];
      if (typeof countOrSeed === "number") {
        count = countOrSeed;
        if (typeof seed === "number") seedVal = seed;
      }
    } else if (typeof prevOrCount === "number") {
      count = prevOrCount;
      if (typeof countOrSeed === "number") seedVal = countOrSeed;
    }
  } else {
    // gridOrPrev undefined/null
    if (Array.isArray(prevOrCount)) {
      prev = prevOrCount as Car[];
      if (typeof countOrSeed === "number") count = countOrSeed;
      if (typeof seed === "number") seedVal = seed;
    } else if (typeof prevOrCount === "number") {
      count = prevOrCount;
      if (typeof countOrSeed === "number") seedVal = countOrSeed;
    }
  }

  // Normalise count
  if (count <= 0) return [];
  const tiles = roadTiles(track);
  if (tiles.length === 0) return [];

  const rng = mulberry32(seedVal);
  const neighbours = getNeighbours(track);
  const townNodes = townAccessNodes(grid, track, neighbours);

  const out: Car[] = [];
  // For route overlap avoidance (optional), keep set of adopted routes
  const adoptedRouteKeys = new Set<string>();

  for (let i = 0; i < count; i++) {
    const p = prev[i];

    // Retain unaffected trips: if prev route still valid, keep it
    if (p && p.route && p.route.length >= 2) {
      if (isRouteValid(p.route, neighbours)) {
        // Keep car, but ensure name/index updated, and keep state/progress
        // If grid changed and town nodes missing, still keep if route valid (conservative)
        const retained: Car = {
          ...p,
          name: `car ${i + 1}`,
          carIndex: i + 1,
          // keep route as is, but ensure fade etc present
          waitMs: p.waitMs ?? 0,
          fadeMs: p.fadeMs ?? 0,
          fade: p.fade ?? (p.state === "waiting" ? 0 : 1),
          arriveMs: p.arriveMs ?? 0,
          lastTripKey: p.lastTripKey ?? (p.origin && p.dest ? tripKey(xyToIdx(p.origin), xyToIdx(p.dest)) : null),
          state: p.state ?? "driving",
          leg: p.leg ?? 0,
          t: p.t ?? 0,
        };
        // Clamp leg/t to valid range
        if (retained.leg >= retained.route.length) retained.leg = 0;
        if (retained.leg >= retained.route.length - 1 && retained.route.length >= 2) {
          // at end, should be arriving
          if (retained.state === "driving") {
            retained.state = "arriving";
            retained.arriveMs = ARRIVE_PAUSE_MS;
          }
        }
        out.push(retained);
        if (retained.route.length) adoptedRouteKeys.add(JSON.stringify(retained.route));
        continue;
      }
      // else route invalid -> will replan below, but keep lastTripKey for avoidance
    } else if (p && p.state === "waiting") {
      // Retain waiting cars with their timers (unaffected by road edits if they have no route)
      const waiting: Car = {
        ...p,
        name: `car ${i + 1}`,
        carIndex: i + 1,
        state: "waiting",
        route: [],
        origin: null,
        dest: null,
        originTownId: null,
        destTownId: null,
        leg: 0,
        t: 0,
        fade: 0,
        fadeMs: 0,
        arriveMs: 0,
        waitMs: p.waitMs ?? (WAIT_MIN_MS + rng() * (WAIT_MAX_MS - WAIT_MIN_MS) + i * 150),
        lastTripKey: p.lastTripKey ?? null,
      };
      out.push(waiting);
      continue;
    }

    // Need new trip for this slot
    const lastKey = p?.lastTripKey ?? null;
    const trip = findTrip(rng, townNodes, neighbours, lastKey);

    if (trip) {
      // Avoid immediate identical repeat already handled in findTrip, but also avoid overlapping routes too much?
      // For simplicity, allow any valid trip
      const car: Car = {
        name: `car ${i + 1}`,
        carIndex: i + 1,
        originTownId: trip.originTownId,
        destTownId: trip.destTownId,
        origin: idxToXY(trip.originIdx),
        dest: idxToXY(trip.destIdx),
        route: trip.route,
        state: "spawning",
        leg: 0,
        t: 0,
        waitMs: 0,
        fadeMs: SPAWN_FADE_MS,
        fade: 0,
        arriveMs: 0,
        lastTripKey: trip.key,
        loop: false,
        reverse: false,
      };
      // Stagger initial spawn: add small wait for cars beyond first few
      if (i > 0) {
        const stagger = (i * 180) % 1200 + rng() * 400;
        car.state = "waiting";
        car.waitMs = stagger;
        car.fade = 0;
        car.fadeMs = 0;
        // keep route for when it spawns? No, waiting cars have no route until tick
        // To stagger but still have route ready, we keep route but state waiting
        // On tick, waiting with route will go to spawning? Let's keep route empty for waiting to force re-find on tick for better stagger variety.
        // Actually we want cars to start at endpoint, not random fractional, so waiting with route is okay if we treat waiting as pre-spawn.
        // For initial boot, set waiting cars to have route already and small wait, so they spawn soon.
        // We'll keep route for initial waiting cars to avoid extra search on first tick.
        // But our tick logic for waiting expects to find trip if route empty. If route present, we should go to spawning.
        // Let's keep route and go to waiting state with route preserved — tick will transition waiting+route -> spawning.
      }
      out.push(car);
    } else {
      // No valid route — wait without teleporting or spinning retry loop
      const wait = WAIT_MIN_MS + rng() * (WAIT_MAX_MS - WAIT_MIN_MS) + i * 200;
      const car: Car = {
        name: `car ${i + 1}`,
        carIndex: i + 1,
        originTownId: null,
        destTownId: null,
        origin: null,
        dest: null,
        route: [],
        state: "waiting",
        leg: 0,
        t: 0,
        waitMs: wait,
        fadeMs: 0,
        fade: 0,
        arriveMs: 0,
        lastTripKey: lastKey,
        loop: false,
        reverse: false,
      };
      out.push(car);
    }
  }

  return out;
}

// ── tick ────────────────────────────────────────────────────────────────
/**
 * Advance cars by dtMs through their trip lifecycle.
 *
 * When track and grid are provided, waiting cars that have expired will attempt
 * to find a new trip (host only). If not provided (e.g. old tests), only
 * existing driving cars advance and waiting cars simply count down.
 */
export function tickCars(
  state: CarState,
  dtMs: number,
  trackOrBlocked?: Track | ReadonlySet<number> | undefined,
  grid?: Grid | null,
  seed: number = 0x72af,
): void {
  if (dtMs <= 0) return;

  // Backward compat: third arg used to be blocked set for trucks (old signature had blocked? no)
  // In current game.ts, tickCars(cars, dt) only. So trackOrBlocked may be Track or undefined.
  let track: Track | null = null;
  if (trackOrBlocked && typeof trackOrBlocked === "object" && "revision" in (trackOrBlocked as any)) {
    track = trackOrBlocked as Track;
  }

  const needsTripSearch = track && grid && state.cars.some((c) => c.state === "waiting" && c.waitMs <= dtMs);

  let neighbours: Map<number, number[]> | null = null;
  let townNodes: TownNodes | null = null;
  let rng: (() => number) | null = null;

  if (needsTripSearch) {
    neighbours = getNeighbours(track!);
    townNodes = townAccessNodes(grid!, track!, neighbours);
    rng = mulberry32(seed);
  }

  for (const car of state.cars) {
    let remaining = dtMs;
    let guard = 0;
    while (remaining > 1e-9 && guard++ < 1000) {
      if (car.state === "waiting") {
        car.waitMs -= remaining;
        remaining = 0;
        if (car.waitMs <= 0) {
          if (car.route.length >= 2) {
            // Has a pre-planned route from planCars (initial stagger) — go to spawning
            car.state = "spawning";
            car.fade = 0;
            car.fadeMs = SPAWN_FADE_MS;
            car.leg = 0;
            car.t = 0;
          } else if (track && grid && neighbours && townNodes && rng) {
            // Need to find a new trip now
            const trip = findTrip(rng, townNodes, neighbours, car.lastTripKey);
            if (trip) {
              car.originTownId = trip.originTownId;
              car.destTownId = trip.destTownId;
              car.origin = idxToXY(trip.originIdx);
              car.dest = idxToXY(trip.destIdx);
              car.route = trip.route;
              car.lastTripKey = trip.key;
              car.state = "spawning";
              car.fade = 0;
              car.fadeMs = SPAWN_FADE_MS;
              car.leg = 0;
              car.t = 0;
              car.waitMs = 0;
            } else {
              // No valid route — wait without spinning retry loop
              car.waitMs = WAIT_MIN_MS + rng() * (WAIT_MAX_MS - WAIT_MIN_MS);
              remaining = 0;
            }
          } else {
            // No track/grid to search — just keep waiting with small retry
            car.waitMs = WAIT_MIN_MS;
            remaining = 0;
          }
        }
        break;
      } else if (car.state === "spawning") {
        if (car.fadeMs <= remaining) {
          remaining -= car.fadeMs;
          car.fadeMs = 0;
          car.fade = 1;
          car.state = "driving";
          car.leg = 0;
          car.t = 0;
        } else {
          car.fadeMs -= remaining;
          car.fade = 1 - car.fadeMs / SPAWN_FADE_MS;
          remaining = 0;
        }
        // During spawning, stay at origin
        if (car.state !== "driving") break;
        // else continue to driving with remaining time
      } else if (car.state === "driving") {
        const n = car.route.length;
        if (n < 2) {
          car.state = "arriving";
          car.arriveMs = ARRIVE_PAUSE_MS;
          break;
        }
        // Advance along one-way route
        while (remaining > 1e-9) {
          if (car.leg >= n - 1) {
            // reached end
            car.t = 1;
            car.state = "arriving";
            car.arriveMs = ARRIVE_PAUSE_MS;
            break;
          }
          const need = (1 - car.t) / CAR_SPEED;
          if (remaining < need) {
            car.t += remaining * CAR_SPEED;
            remaining = 0;
            break;
          }
          remaining -= need;
          car.t = 0;
          car.leg++;
          if (car.leg >= n - 1) {
            car.t = 1;
            car.leg = n - 1;
            car.state = "arriving";
            car.arriveMs = ARRIVE_PAUSE_MS;
            break;
          }
        }
        break; // driving consumes remaining or transitions
      } else if (car.state === "arriving") {
        if (car.arriveMs <= remaining) {
          remaining -= car.arriveMs;
          car.arriveMs = 0;
          car.state = "despawning";
          car.fade = 1;
          car.fadeMs = DESPAWN_FADE_MS;
        } else {
          car.arriveMs -= remaining;
          remaining = 0;
        }
        if (car.state !== "despawning") break;
      } else if (car.state === "despawning") {
        if (car.fadeMs <= remaining) {
          remaining -= car.fadeMs;
          car.fadeMs = 0;
          car.fade = 0;
          // Arrival cleanup: remove from active draw list by going to waiting with empty route
          car.state = "waiting";
          car.waitMs = WAIT_MIN_MS + (rng ? rng() * (WAIT_MAX_MS - WAIT_MIN_MS) : 1000);
          // Keep lastTripKey to avoid immediate repeat
          car.route = [];
          car.origin = null;
          car.dest = null;
          car.originTownId = null;
          car.destTownId = null;
          car.leg = 0;
          car.t = 0;
          car.arriveMs = 0;
        } else {
          car.fadeMs -= remaining;
          car.fade = car.fadeMs / DESPAWN_FADE_MS;
          remaining = 0;
        }
        break;
      } else {
        break;
      }
    }
  }
}

// ── drawing ───────────────────────────────────────────────────────────────
const VIEW_OF: Record<number, string> = {
  [NE]: "ne",
  [SE]: "se",
  [SW]: "sw",
  [NW]: "nw",
};

export function carSprite(carIndex: number, dir: number): string {
  const slot = ((carIndex - 1) % CAR_ART_SLOTS) + 1;
  return `car${slot}_${VIEW_OF[dir] ?? "se"}`;
}

function dirBit(from: [number, number], to: [number, number]): number {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  if (dx > 0) return SE;
  if (dx < 0) return NW;
  if (dy > 0) return SW;
  if (dy < 0) return NE;
  return SE;
}

export function carItems(state: CarState): DrawItem[] {
  const out: DrawItem[] = [];
  for (const car of state.cars) {
    if (car.state === "waiting") continue;
    const n = car.route.length;
    if (n < 2) continue;
    // During waiting we skip; during spawning at origin, driving, arriving at dest, despawning at dest
    let k = car.leg;
    if (k < 0) k = 0;
    if (k >= n) k = n - 1;

    let a: [number, number], b: [number, number];
    if (k >= n - 1) {
      // At destination (arriving/despawning)
      a = car.route[n - 2] ?? car.route[n - 1];
      b = car.route[n - 1];
      // Position at dest for fade out
      if (car.state === "despawning" || car.state === "arriving") {
        // fx/fy at dest
        const fx = b[0];
        const fy = b[1];
        const dir = dirBit(a, b);
        const sprite = carSprite(car.carIndex, dir);
        out.push({
          sprite,
          tx: Math.round(fx),
          ty: Math.round(fy),
          fx,
          fy,
          alpha: car.fade,
          ref: { car: car.name, state: car.state, fade: car.fade },
        });
        continue;
      }
    }

    // Normal: between route[k] and route[k+1]
    const nextIdx = Math.min(k + 1, n - 1);
    a = car.route[k];
    b = car.route[nextIdx];
    // If at last tile (leg == n-1) and t==1, a==b? Use previous segment for direction
    if (k === n - 1) {
      a = car.route[n - 2] ?? car.route[n - 1];
      b = car.route[n - 1];
    }
    const fx = a[0] + (b[0] - a[0]) * car.t;
    const fy = a[1] + (b[1] - a[1]) * car.t;
    const dir = dirBit(a, b);
    const sprite = carSprite(car.carIndex, dir);
    out.push({
      sprite,
      tx: Math.round(fx),
      ty: Math.round(fy),
      fx,
      fy,
      alpha: car.fade,
      ref: { car: car.name, state: car.state, fade: car.fade },
    });
  }
  return out;
}

// ── helpers for tests / game integration ─────────────────────────────────
/** For tests: check if a car route is local (same town) */
export function isLocalTrip(car: Car): boolean {
  return car.originTownId !== null && car.destTownId !== null && car.originTownId === car.destTownId;
}
export function isInterTownTrip(car: Car): boolean {
  return car.originTownId !== null && car.destTownId !== null && car.originTownId !== car.destTownId;
}

/** Expose for testing: get adjacency revision */
export function getAdjacencyRevision(): number {
  return globalAdjCache.revision;
}
