// ══════════════════════════════════════════════════════════════════════════
// E7 — Isometric AI: industry scoring + A* auto-routing.
//
// Replaces ai.ts's `findLegalSettlement` / `findLegalRoad`, which were vertex
// and edge based and do not survive the migration.
//
// Behaviour: score candidate industries by
//     (cargo scarcity in the AI's stock × output) ÷ path cost
// A* a path from the nearest owned network tile, build road if it cannot
// afford rail, then place a harvester.
//
// A* is deliberate HERE and nowhere else. E5 keeps auto-routing out of the
// player's hands because it produces paths they did not intend and hides cost;
// for the AI's own network nobody is surprised by it.
//
// Cost function (from the spec):
//     1     per flat tile
//     3     per rough tile
//     0.3×  for tiles already carrying the AI's own network — so it reuses
//           trunk lines instead of building parallel spurs
//     impassable: water and industry footprints
//
// Everything is deterministic under an injected RNG so T1 can assert on it.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W, MAP_H } from "../game/config";
import { TRANSPORT, INDUSTRY_BY_KEY, type Cargo } from "./config";
import { WATER, ROUGH, type Grid, type Industry } from "./grid";
import {
  DIRS, DIR, tIdx, inMapT, hasTrack, canBuildOn, tileCost, addCost, canAfford,
  buildTile, type Track, type TrackKind, type Purse,
} from "./track";
import {
  catchmentRect, rectContains, isServiced,
  type EconomyState, type Harvester, type Factory,
} from "./economy";

// ── terrain cost ──────────────────────────────────────────────────────────
export const COST_FLAT = 1;
export const COST_ROUGH = 3;
export const COST_OWNED = 0.3;      // multiplier, not an absolute
export const IMPASSABLE = Infinity;

/**
 * Cost of routing `kind` across one tile. Water and industry footprints are
 * impassable; rail additionally cannot cross rough ground.
 *
 * W2: the trunk-line discount applies only to track the AI itself built
 * (`owner`). Passing 0 keeps the legacy "any track is discounted" behaviour
 * the unit tests use with unowned maps; the live game passes the AI's real
 * id, so the AI can never cheat its routing across the player's road.
 */
export function stepCost(
  grid: Grid, track: Track, kind: TrackKind, tx: number, ty: number, owner: number = 0,
): number {
  if (!inMapT(tx, ty)) return IMPASSABLE;
  const i = tIdx(tx, ty);
  const terrain = grid.terrain[i];
  if (terrain === WATER) return IMPASSABLE;
  if (grid.occupancy[i] !== -1) return IMPASSABLE;
  if (terrain === ROUGH && !TRANSPORT[kind].onRough) return IMPASSABLE;
  let c = terrain === ROUGH ? COST_ROUGH : COST_FLAT;
  // reuse our own trunk lines rather than building parallel spurs
  const own = owner === 0 ? true : track.owner[i] === owner;
  if (hasTrack(track, kind, tx, ty) && own) c *= COST_OWNED;
  return c;
}

// ── A* ────────────────────────────────────────────────────────────────────
/** Manhattan distance — admissible, because the cheapest step costs 0.3. */
const heuristic = (ax: number, ay: number, bx: number, by: number) =>
  (Math.abs(ax - bx) + Math.abs(ay - by)) * COST_OWNED;

export interface Path {
  tiles: [number, number][];
  cost: number;
}

/**
 * A* from (ax,ay) to (bx,by) over the 4 diamond directions. The goal tile is
 * allowed to be impassable-adjacent: pass `adjacentTo` to stop as soon as the
 * frontier touches a tile orthogonally next to the goal, which is what you
 * want when routing to an industry footprint you cannot build on.
 *
 * Deterministic: ties are broken by tile index, never by insertion order.
 */
export function findPath(
  grid: Grid, track: Track, kind: TrackKind,
  ax: number, ay: number, bx: number, by: number,
  adjacentTo = false, owner: number = 0,
): Path | null {
  if (!inMapT(ax, ay) || !inMapT(bx, by)) return null;
  const start = tIdx(ax, ay);
  const goal = tIdx(bx, by);

  const gScore = new Map<number, number>([[start, 0]]);
  const cameFrom = new Map<number, number>();
  // Small maps (2304 tiles) — a sorted array beats a binary heap's constant.
  const open: number[] = [start];
  const fScore = new Map<number, number>([[start, heuristic(ax, ay, bx, by)]]);
  const closed = new Set<number>();

  const isGoal = (i: number) => {
    if (i === goal) return true;
    if (!adjacentTo) return false;
    const x = i % MAP_W, y = (i / MAP_W) | 0;
    return Math.abs(x - bx) + Math.abs(y - by) === 1;
  };

  while (open.length) {
    // deterministic pop: lowest f, ties by lowest tile index
    let bi = 0;
    for (let k = 1; k < open.length; k++) {
      const a = fScore.get(open[k]) ?? Infinity, b = fScore.get(open[bi]) ?? Infinity;
      if (a < b || (a === b && open[k] < open[bi])) bi = k;
    }
    const cur = open.splice(bi, 1)[0];
    if (isGoal(cur)) {
      const tiles: [number, number][] = [];
      let n: number | undefined = cur;
      while (n !== undefined) {
        tiles.push([n % MAP_W, (n / MAP_W) | 0]);
        n = cameFrom.get(n);
      }
      tiles.reverse();
      return { tiles, cost: gScore.get(cur) ?? 0 };
    }
    closed.add(cur);
    const cx = cur % MAP_W, cy = (cur / MAP_W) | 0;
    for (const d of DIRS) {
      const nx = cx + DIR[d][0], ny = cy + DIR[d][1];
      if (!inMapT(nx, ny)) continue;
      const ni = tIdx(nx, ny);
      if (closed.has(ni)) continue;
      // the goal itself may be unbuildable when we only need to reach beside it
      const c = stepCost(grid, track, kind, nx, ny, owner);
      if (!isFinite(c) && !(ni === goal && adjacentTo)) continue;
      const tentative = (gScore.get(cur) ?? Infinity) + (isFinite(c) ? c : 0);
      if (tentative >= (gScore.get(ni) ?? Infinity)) continue;
      cameFrom.set(ni, cur);
      gScore.set(ni, tentative);
      fScore.set(ni, tentative + heuristic(nx, ny, bx, by));
      if (!open.includes(ni)) open.push(ni);
    }
  }
  return null;
}

// ── candidate scoring ─────────────────────────────────────────────────────
/**
 * Scarcity of a cargo in the AI's stock. Rarer cargo scores higher, and a
 * cargo it holds none of is the most valuable thing on the board.
 */
export const scarcity = (stock: Purse, cargo: Cargo): number =>
  1 / (1 + (stock[cargo] ?? 0));

export interface Candidate {
  industry: Industry;
  /** Tile the harvester would occupy — adjacent to the industry footprint. */
  hx: number;
  hy: number;
  path: Path;
  kind: TrackKind;
  cost: Purse;
  score: number;
}

/** Tiles orthogonally adjacent to an industry's footprint, in a stable order. */
export function harvesterSpots(grid: Grid, ind: Industry): [number, number][] {
  const out: [number, number][] = [];
  const seen = new Set<number>();
  for (let y = ind.ty - 1; y <= ind.ty + ind.h; y++) {
    for (let x = ind.tx - 1; x <= ind.tx + ind.w; x++) {
      if (!inMapT(x, y)) continue;
      const insideX = x >= ind.tx && x < ind.tx + ind.w;
      const insideY = y >= ind.ty && y < ind.ty + ind.h;
      if (insideX && insideY) continue;                 // on the footprint
      if (!insideX && !insideY) continue;               // diagonal corner
      const i = tIdx(x, y);
      if (seen.has(i)) continue;
      if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) continue;
      seen.add(i);
      out.push([x, y]);
    }
  }
  return out;
}

/**
 * Every tile of the AI's existing network, plus its factory, as path sources.
 * W2: only track the AI itself built counts as "its network" — the player's
 * road no longer makes the AI believe it is already connected (the W3
 * "rival never builds" deadlock), and the AI's routing starts from its own
 * trunk lines, never from yours.
 */
export function networkTiles(track: Track, kind: TrackKind, factory: Factory): [number, number][] {
  const out: [number, number][] = [];
  const owner = factory.ownerId;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (!hasTrack(track, kind, x, y)) continue;
      if (owner !== 0 && track.owner[tIdx(x, y)] !== owner) continue;
      out.push([x, y]);
    }
  }
  if (!out.length) out.push([factory.tx, factory.ty]);
  return out;
}

/** The nearest network tile to a target, by Manhattan distance then index. */
export function nearestSource(
  sources: [number, number][], tx: number, ty: number,
): [number, number] | null {
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const [x, y] of sources) {
    const d = Math.abs(x - tx) + Math.abs(y - ty);
    if (d < bestD || (d === bestD && best && (tIdx(x, y) < tIdx(best[0], best[1])))) {
      best = [x, y]; bestD = d;
    }
  }
  return best;
}

export interface PlanOptions {
  /** Cargo the AI already holds — drives scarcity. */
  stock: Purse;
  /** What it can spend. */
  purse: Purse;
  /**
   * W3: free-track allowance (the AI's `freeTrack`), applied with the SAME
   * cost model as the human's drag preview (`previewDrag`): the first
   * `free` new tiles ride free, `cost` counts only the rest. Without this
   * the AI "sees" a 12-tile build it can't pay for and stands still even
   * though its setup allowance would cover it.
   */
  free?: number;
  /** Prefer rail when affordable (spec: build road if it can't afford rail). */
  preferRail?: boolean;
}

/**
 * Score every reachable industry and return the candidates best first.
 * Deterministic: equal scores break by industry id.
 */
export function planCandidates(
  state: EconomyState, factory: Factory, opts: PlanOptions,
): Candidate[] {
  const { grid, track } = state;
  const out: Candidate[] = [];
  const claimed = new Set(state.harvesters.map((h) => tIdx(h.tx, h.ty)));
  const free = Math.max(0, opts.free ?? 0);

  for (const kindPref of [opts.preferRail === false ? "road" : "rail", "road"] as TrackKind[]) {
    const sources = networkTiles(track, kindPref, factory);
    for (const ind of grid.industries) {
      const def = INDUSTRY_BY_KEY[ind.type];
      if (!def) continue;
      // skip industries already covered by one of our own harvesters
      const covered = state.harvesters.some((h) =>
        h.owner === factory.owner
        && rectContains(catchmentRect(h.tx, h.ty), ind.tx, ind.ty));
      if (covered) continue;

      for (const [hx, hy] of harvesterSpots(grid, ind)) {
        if (claimed.has(tIdx(hx, hy))) continue;
        const src = nearestSource(sources, hx, hy);
        if (!src) continue;
        // W2: route with the AI's own trunk discount, not the player's road.
        const path = findPath(grid, track, kindPref, src[0], src[1], hx, hy, false, factory.ownerId);
        if (!path) continue;

        // W3: same cost model as the human preview — the allowance covers the
        // first new tiles, the purse pays the rest.
        let cost: Purse = {};
        let freeLeft = free;
        for (const [x, y] of path.tiles) {
          const c = tileCost(track, kindPref, x, y);
          if (Object.keys(c).length === 0) continue;
          if (freeLeft > 0) { freeLeft--; continue; }
          cost = addCost(cost, c);
        }
        if (!canAfford(opts.purse, cost)) continue;

        const score = scarcity(opts.stock, def.cargo) * (ind.output ?? def.output)
          / Math.max(0.3, path.cost);
        out.push({ industry: ind, hx, hy, path, kind: kindPref, cost, score });
        break;   // one spot per industry is enough — the cheapest we found
      }
    }
    if (out.length) break;   // rail worked; no need to consider road
  }

  out.sort((a, b) =>
    b.score - a.score
    || a.industry.id - b.industry.id
    || tIdx(a.hx, a.hy) - tIdx(b.hx, b.hy));
  return out;
}

export const bestCandidate = (
  state: EconomyState, factory: Factory, opts: PlanOptions,
): Candidate | null => planCandidates(state, factory, opts)[0] ?? null;

// ── execution ─────────────────────────────────────────────────────────────
export interface BuildOutcome {
  built: [number, number][];
  harvester: Harvester | null;
  kind: TrackKind;
  /** What the caller debits from the purse — free tiles already subtracted. */
  spent: Purse;
  /** W3: how many tiles the free allowance covered (caller debits freeTrack). */
  free: number;
}

/**
 * Commit a candidate: lay the path (stamping `ownerId`, W2), then place the
 * harvester. Tiles that turn out to be unbuildable are skipped rather than
 * aborting the whole plan. `free` is the same allowance `planCandidates`
 * priced with, so `spent` is exactly what the plan said the purse would pay.
 */
export function executeCandidate(
  state: EconomyState, c: Candidate, owner: string, ownerId: number,
  nextHarvesterId: number, free: number = 0,
): BuildOutcome {
  const built: [number, number][] = [];
  let spent: Purse = {};
  let freeLeft = Math.max(0, free);
  for (const [x, y] of c.path.tiles) {
    if (!canBuildOn(state.grid, c.kind, x, y)) continue;
    if (hasTrack(state.track, c.kind, x, y)) continue;
    const cCost = tileCost(state.track, c.kind, x, y);
    if (Object.keys(cCost).length === 0) {
      // already this kind — rebuild is free and consumes no allowance
    } else if (freeLeft > 0) {
      freeLeft--;
    } else {
      spent = addCost(spent, cCost);
    }
    buildTile(state.track, c.kind, x, y, ownerId);
    built.push([x, y]);
  }
  let harvester: Harvester | null = null;
  const h: Harvester = { id: nextHarvesterId, owner, ownerId, tx: c.hx, ty: c.hy };
  if (isServiced(state.track, h)) {
    state.harvesters.push(h);
    harvester = h;
  }
  return { built, harvester, kind: c.kind, spent, free: Math.max(0, free) - freeLeft };
}

/**
 * One AI turn: pick the best candidate it can afford and build it. Returns
 * null when nothing is affordable or reachable, so the caller can keep the
 * existing skill/timing scaffolding (`nextBuild`, `nextIncome`, `slowedUntil`)
 * in charge of pacing.
 *
 * W2: the build is stamped with `factory.ownerId` — the rival's network is
 * its own from the first tile. W3: `opts.free` prices the build the same way
 * the player's drag preview does, so the AI can use its setup allowance
 * instead of deadlocking on a purse it hasn't earned yet.
 */
export function aiBuildStep(
  state: EconomyState, factory: Factory, opts: PlanOptions, nextHarvesterId: number,
): BuildOutcome | null {
  const c = bestCandidate(state, factory, opts);
  if (!c) return null;
  return executeCandidate(state, c, factory.owner, factory.ownerId, nextHarvesterId, opts.free);
}
