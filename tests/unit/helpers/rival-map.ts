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

/**
 * Can track laid from (x,y) reach a harvester spot OTHER than (x,y) itself?
 * False means the tile is an enclave — the only "plan" it can ever have is the
 * degenerate one-tile build under its own depot.
 */
export function canReachASpot(grid: Grid, x: number, y: number): boolean {
  const start = tIdx(x, y);
  const seen = roadComponent(grid, x, y);
  for (const s of harvesterSpotIndex(grid)) if (s !== start && seen[s]) return true;
  return false;
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
