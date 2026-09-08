// ─────────────────────────────────────────────────────────────────────────────
// Test helper for the W8 rival sweeps (not a test file — vitest only collects
// `tests/unit/**/*.test.ts`).
//
// Structural reachability, used to tell "the AI deadlocked" apart from "this
// tile physically cannot support a build". A tile whose road-legal component
// contains no harvester spot but itself is an ENCLAVE: water and industry
// footprints wall it in, so no planning fix can ever build from it — which is
// exactly the tile `chooseRivalFactorySpot` must refuse to commit.
//
// Road is legal on every non-water, unoccupied tile (rough included), so one
// BFS over `canBuildOn(grid, "road", …)` is both cheap and exact.
// ─────────────────────────────────────────────────────────────────────────────
import { harvesterSpots } from "../../../src/iso/ai";
import { canBuildOn, tIdx } from "../../../src/iso/track";
import type { Grid } from "../../../src/iso/grid";
import { MAP_W, MAP_H } from "../../../src/game/config";

const spotCache = new WeakMap<Grid, Set<number>>();

/** Tile index of every harvester spot on the map, cached per grid. */
export function harvesterSpotIndex(grid: Grid): Set<number> {
  let spots = spotCache.get(grid);
  if (!spots) {
    spots = new Set<number>();
    for (const ind of grid.industries) {
      for (const [hx, hy] of harvesterSpots(grid, ind)) spots.add(tIdx(hx, hy));
    }
    spotCache.set(grid, spots);
  }
  return spots;
}

/** The road-legal 4-connected component containing (x,y), as a tile mask. */
export function roadComponent(grid: Grid, x: number, y: number): Uint8Array {
  const seen = new Uint8Array(MAP_W * MAP_H);
  if (!canBuildOn(grid, "road", x, y)) return seen;
  const start = tIdx(x, y);
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const cur = stack.pop()!;
    const cx = cur % MAP_W, cy = (cur / MAP_W) | 0;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const ni = tIdx(nx, ny);
      if (seen[ni] || !canBuildOn(grid, "road", nx, ny)) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  return seen;
}

const reachCache = new WeakMap<Grid, Uint8Array>();

/**
 * Can road reach a harvester spot other than the starting tile? Compute each
 * component once per immutable grid, so the full-map check remains O(tiles),
 * rather than flooding the same 20,736 tiles for every placement.
 */
export function canReachASpot(grid: Grid, x: number, y: number): boolean {
  if (!canBuildOn(grid, "road", x, y)) return false;
  let reachable = reachCache.get(grid);
  if (!reachable) {
    reachable = new Uint8Array(MAP_W * MAP_H);
    const seen = new Uint8Array(reachable.length);
    const spots = harvesterSpotIndex(grid);
    for (let start = 0; start < seen.length; start++) {
      if (seen[start] || !canBuildOn(grid, "road", start % MAP_W, Math.floor(start / MAP_W))) continue;
      const component = [start];
      seen[start] = 1;
      let nSpots = 0;
      for (let head = 0; head < component.length; head++) {
        const cur = component[head];
        if (spots.has(cur)) nSpots++;
        const cx = cur % MAP_W, cy = Math.floor(cur / MAP_W);
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const nx = cx + dx, ny = cy + dy;
          if (!canBuildOn(grid, "road", nx, ny)) continue;
          const ni = tIdx(nx, ny);
          if (seen[ni]) continue;
          seen[ni] = 1;
          component.push(ni);
        }
      }
      for (const i of component) reachable[i] = Number(nSpots > Number(spots.has(i)));
    }
    reachCache.set(grid, reachable);
  }
  return reachable[tIdx(x, y)] !== 0;
}

/**
 * Every tile the rival-placement search in `game.ts` considers (even steps).
 * `step` 2 is the game's own space; 4 samples a quarter of it, for the sweeps
 * where a full pass costs more than the assertion is worth.
 */
export function rivalSearchTiles(grid: Grid, step = 2): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 2; y < MAP_H - 2; y += step) {
    for (let x = 2; x < MAP_W - 2; x += step) {
      if (canBuildOn(grid, "road", x, y)) out.push([x, y]);
    }
  }
  return out;
}
