// ══════════════════════════════════════════════════════════════════════════
// RIVAL-ROAD-1 (#683) — owner playtest 2026-10-04: the player's rail crossed
// the public road (a legal level crossing), the rival could no longer route
// its depot along that road, and the detour it built ran through the player's
// station.
//
// A. A level crossing that is already a road is part of that road for every
//    seat: the rival's A* (`stepCost` → `buildRefusal`) now learns the road's
//    axis from the step it came by, so it drives straight across. It still
//    may not turn on the crossing, nor start a NEW crossing it was not asked
//    to (the drag passes `crossing` for that, unchanged).
// B. A station that grew lanes (RAIL-6) stands on every lane: `structureAt`
//    used to test only the rectangle the station was placed with, so a grown
//    lane read as bare ground / plain rail and a road could be laid over it.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { findPath, stepCost, IMPASSABLE } from "../../src/iso/ai";
import {
  buildRefusal, buildTile, createTrack, PUBLIC_OWNER, type Track,
} from "../../src/iso/track";
import {
  addStationLane, createRailState, hasRail, laneTrackTiles, layPlatformTrack, placePlatform,
  stationLanes, structureAt, laneSlabTiles, laneTileAt, type RailState,
} from "../../src/iso/rail";
import { GRASS, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";

function flatGrid(): Grid {
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries: [], towns: [],
    occupancy: new Int16Array(MAP_W * MAP_H).fill(-1),
    seed: 7,
  };
}

/** The player's rail: a straight line along y at x = 20, rows 10..50. */
const RAIL_X = 20;
const onRail = (x: number, y: number) => x === RAIL_X && y >= 10 && y <= 50;

/** A public road along x at y = 30, x 5..35 — crossing the rail at (20, 30). */
function crossingWorld(): { grid: Grid; track: Track } {
  const grid = flatGrid();
  const track = createTrack();
  for (let x = 5; x <= 35; x++) buildTile(track, "road", x, 30, PUBLIC_OWNER);
  // `builtAt` as the game reports a straight rail along y.
  grid.builtAt = (x, y) => (onRail(x, y) ? "rail-y" : null);
  return { grid, track };
}

describe("RIVAL-ROAD-1 A: a level crossing never closes the road", () => {
  it("the rival may step straight across a standing crossing, not along or off it", () => {
    const { grid, track } = crossingWorld();
    expect(stepCost(grid, track, "dirt", 20, 30, 2, [19, 30])).toBeLessThan(IMPASSABLE);
    expect(stepCost(grid, track, "dirt", 20, 30, 2, [21, 30])).toBeLessThan(IMPASSABLE);
    // entering along the rail is running ON the rail
    expect(stepCost(grid, track, "dirt", 20, 30, 2, [20, 29])).toBe(IMPASSABLE);
    // a rail tile with no road on it is still not the planner's to cross
    expect(stepCost(grid, track, "dirt", 20, 25, 2, [19, 25])).toBe(IMPASSABLE);
  });

  it("the rival's route rides the public road across the crossing — no detour", () => {
    const { grid, track } = crossingWorld();
    const path = findPath(grid, track, "dirt", 8, 30, 32, 30, false, 2);
    expect(path).not.toBeNull();
    const tiles = path!.tiles;
    expect(tiles.every(([, y]) => y === 30), "stays on the public road").toBe(true);
    expect(tiles).toContainEqual([20, 30]);
    expect(tiles.length).toBe(32 - 8 + 1);
  });

  it("the shared rule agrees: a road crossing passes, a road along the rail does not", () => {
    const { grid, track } = crossingWorld();
    expect(buildRefusal(grid, "dirt", 20, 30, undefined, undefined, track, [19, 30])).toBeNull();
    expect(buildRefusal(grid, "dirt", 20, 30, undefined, undefined, track, [20, 31])).toBe("rail");
    // A drag that names its own crossing axis keeps the old answer.
    expect(buildRefusal(grid, "dirt", 20, 30, undefined, "x", track)).toBeNull();
    expect(buildRefusal(grid, "dirt", 20, 30, undefined, "y", track)).toBe("rail");
  });
});

describe("RIVAL-ROAD-1 B: nobody builds a road on a station's grown lane", () => {
  function stationWorld(): { grid: Grid; track: Track; state: RailState; id: number } {
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    const P = placePlatform(state, "you", 1, 40, 20, "sw", { kind: "plant", id: 0, tiles: [] });
    layPlatformTrack(grid, track, state, P);
    const res = addStationLane(grid, track, state, 1, P.id, 1);
    expect(res.ok, `lane: ${res.why}`).toBe(true);
    // `builtAt` exactly as game.ts derives it: the placed rectangle, a grown
    // lane's strip, then rail (a grown lane's track never reads as crossable).
    grid.builtAt = (x, y) => {
      if (structureAt(state, x, y)) return "platform";
      const lane = laneTileAt(state, x, y);
      if (lane === "slab") return "platform";
      if (hasRail(state.rail, x, y)) {
        if (lane === "track") return "rail";
        const bits = state.rail.tile[y * MAP_W + x] & 0b1111;
        return bits === 0b1010 ? "rail-x" : bits === 0b0101 ? "rail-y" : "rail";
      }
      return null;
    };
    return { grid, track, state, id: P.id };
  }

  it("every tile of a grown lane is the station's: strip = slab, stopping track = track", () => {
    const { state, id } = stationWorld();
    const lanes = stationLanes(state.structures.find((s) => s.id === id)!);
    expect(lanes.length).toBe(2);
    for (const l of lanes) {
      for (const [x, y] of laneSlabTiles(l)) expect(laneTileAt(state, x, y), `slab (${x},${y})`).toBe("slab");
      for (const [x, y] of laneTrackTiles(l)) expect(laneTileAt(state, x, y), `track (${x},${y})`).toBe("track");
    }
    expect(laneTileAt(state, 10, 10)).toBeNull();
  });

  it("a road is refused on every lane tile, from any side, for any seat", () => {
    const { grid, track, state, id } = stationWorld();
    const lanes = stationLanes(state.structures.find((s) => s.id === id)!);
    for (const l of lanes) {
      for (const [x, y] of [...laneSlabTiles(l), ...laneTrackTiles(l)]) {
        for (const c of ["x", "y", undefined] as const) {
          expect(buildRefusal(grid, "dirt", x, y, undefined, c, track), `(${x},${y}) ${c}`).not.toBeNull();
        }
      }
    }
  });

  it("the rival's route detours around the grown station", () => {
    const { grid, track, state, id } = stationWorld();
    const s = state.structures.find((t) => t.id === id)!;
    const occupied = new Set<string>();
    for (const l of stationLanes(s)) {
      for (const [x, y] of [...laneSlabTiles(l), ...laneTrackTiles(l)]) occupied.add(`${x},${y}`);
    }
    // straight through the station's rows, west to east
    const ys = [...occupied].map((k) => +k.split(",")[1]);
    const y = ys[0];
    const path = findPath(grid, track, "dirt", 30, y, 55, y, false, 2);
    expect(path).not.toBeNull();
    for (const [x, ty] of path!.tiles) expect(occupied.has(`${x},${ty}`), `(${x},${ty})`).toBe(false);
  });
});
