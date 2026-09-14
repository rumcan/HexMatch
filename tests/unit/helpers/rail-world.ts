// ─────────────────────────────────────────────────────────────────────────────
// Test helper for the RAIL-02 railway suites (not a test file — vitest only
// collects `tests/unit/**/*.test.ts`).
//
// A synthetic world with everything the rail rules read and nothing they do
// not: flat grass, a hand-placed industry, an optional town stamp, an optional
// road splice, and a fresh railway state. The grids in these tests are built
// by hand rather than generated so a failure names a tile the reader can
// count on: "the crossing at (10,5)" beats "the 71st road tile of seed 1337".
// ─────────────────────────────────────────────────────────────────────────────
import { MAP_W, MAP_H } from "../../../src/game/config";
import {
  GRASS, ROUGH, TOWN_OCC, type Grid, type Industry, type Town,
} from "../../../src/iso/grid";
import { createTrack, buildTile, tIdx, type Track } from "../../../src/iso/track";
import { createRailway, type RailwayState } from "../../../src/iso/railway/state";
import type { RailWorld } from "../../../src/iso/railway/placement";

/** The two seats, as the game numbers them (player index + 1). */
export const YOU = 1;
export const RIVAL = 2;

export interface RailWorldOptions {
  industries?: Industry[];
  towns?: Town[];
  rough?: [number, number][];
  water?: [number, number][];
  track?: Track;
}

export function flatGrid(opts: RailWorldOptions = {}): Grid {
  const terrain = new Uint8Array(MAP_W * MAP_H).fill(GRASS);
  for (const [x, y] of opts.rough ?? []) terrain[tIdx(x, y)] = ROUGH;
  for (const [x, y] of opts.water ?? []) terrain[tIdx(x, y)] = 1;
  const occupancy = new Int16Array(MAP_W * MAP_H).fill(-1);
  const industries = opts.industries ?? [];
  industries.forEach((ind, i) => {
    ind.id = i;
    for (let y = ind.ty; y < ind.ty + ind.h; y++) {
      for (let x = ind.tx; x < ind.tx + ind.w; x++) occupancy[tIdx(x, y)] = i;
    }
  });
  for (const t of opts.towns ?? []) {
    for (const [x, y] of [...t.houses, ...t.roads]) occupancy[tIdx(x, y)] = TOWN_OCC;
  }
  return { w: MAP_W, h: MAP_H, terrain, industries, towns: opts.towns ?? [], occupancy, seed: 1 };
}

/** An industry def at (tx,ty) with a w×h footprint. */
export const industry = (tx: number, ty: number, w = 2, h = 2): Industry => ({
  id: -1, type: "farm", tx, ty, w, h, output: 1, banditUntil: 0,
});

/** A town with a 2×2 house block and no ring road. */
export const town = (id: number, tx: number, ty: number): Town => ({
  id, tx, ty,
  houses: [[tx, ty], [tx + 1, ty], [tx, ty + 1], [tx + 1, ty + 1]],
  roads: [],
});

export interface RailFixture extends RailWorld {
  rw: RailwayState;
  track: Track;
  grid: Grid;
}

/**
 * A ready-to-use world. `roads` are laid with `buildTile` through the REAL
 * road layer, so the crossing rules are tested against track bytes the game
 * itself produced rather than a hand-poked mask.
 */
export function railWorld(opts: RailWorldOptions & {
  roads?: { kind?: "dirt" | "road"; tiles: [number, number][]; owner?: number }[];
} = {}): RailFixture {
  const grid = flatGrid(opts);
  const track = opts.track ?? createTrack();
  for (const run of opts.roads ?? []) {
    for (const [x, y] of run.tiles) buildTile(track, run.kind ?? "road", x, y, run.owner ?? YOU);
  }
  const rw = createRailway();
  return { rw, grid, track };
}
