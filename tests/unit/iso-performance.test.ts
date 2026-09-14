// @vitest-environment jsdom
//
// PERF-01 — the performance mode's rendering contract, at the renderer and
// ground-paint level:
//   · the flat scene draws through the real paint path (DOM canvas + a
//     no-op context, the same stub the full-game harness uses);
//   · while performance mode stands the terrain layer is STATIC — the 30 Hz
//     ambient timer is disarmed, so idle frames never redraw it, and a
//     camera/world/mode change invalidates it exactly once;
//   · stepping back re-arms the timer and the textured cadence holds;
//   · the mode switch releases the chunk cache (no stale surfaces);
//   · the flat ground paint is solid colours + ONE grid stroke, clipped to
//     the land, deterministic for a given (grid, range).
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { Atlas, type Manifest } from "../../src/iso/atlas";
import {
  IsoRenderer, TERRAIN_FRAME_MS, type World,
} from "../../src/iso/renderer";
import {
  PERF_FLAT, paintFlatGroundTiles, groundContours,
} from "../../src/iso/ground";
import { createCamera, centerOnMap } from "../../src/iso/camera";
import { generateMap, WATER, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";

// ── the stub canvas (same contract as tests/unit/iso-game.test.ts) ─────────
function stubCanvas() {
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "canvas") return null;
      if (prop === "imageSmoothingEnabled") return false;
      if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createConicGradient") {
        return () => ({ addColorStop: () => undefined });
      }
      return () => undefined;
    },
    set: () => true,
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
}

function setup() {
  const atlas = new Atlas(JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8")) as Manifest);
  const world: World = {
    grid: generateMap(1234),
    roadBits: new Uint8Array(MAP_W * MAP_H),
    dirtBits: new Uint8Array(MAP_W * MAP_H),
  };
  const canvas = document.createElement("canvas");
  const renderer = new IsoRenderer(
    { terrain: canvas, structures: canvas, overlay: canvas },
    atlas, centerOnMap(createCamera(800, 600)), world,
  );
  renderer.setRoadMode("sprites");   // keep the structures path off textured roads
  return { renderer, world };
}

const redraws = (r: IsoRenderer) => r.renderDiagnostics().terrain.redraws;

/** An 8×8 tile range for the flat-paint tests. */
const CHUNK_RANGE_X = 7;
const CHUNK_RANGE_Y = 7;

describe("PERF-01 renderer cadence", () => {
  beforeAll(() => { stubCanvas(); });

  it("is static while performance mode stands: idle frames never redraw the terrain", () => {
    const { renderer } = setup();
    renderer.setPerformanceMode(true);
    renderer.render(0);
    expect(redraws(renderer)).toBe(1);          // the dirty repaint at boot
    expect(renderer.renderDiagnostics().terrain).toMatchObject({ performance: true, animated: false });
    // Four full 30 Hz windows pass — the textured terrain would have
    // redrawn on each of them. The flat one does not move.
    for (const t of [150, 300, 450, 600]) {
      renderer.render(t);
      expect(redraws(renderer), `t=${t}`).toBe(1);
    }
  });

  it("camera, world and mode changes invalidate the static terrain exactly once", () => {
    const { renderer, world } = setup();
    renderer.setPerformanceMode(true);
    renderer.render(0);
    // a camera pan dirties the layer — one repaint, then still again
    renderer.setCamera({ ...renderer.cam, x: renderer.cam.x + 64 });
    renderer.render(500);
    expect(redraws(renderer)).toBe(2);
    renderer.render(650);
    expect(redraws(renderer)).toBe(2);
    // a map edit (a tile flip + the matching invalidation) dirties too
    const i = 100 * MAP_W + 100;
    world.grid.terrain[i] = world.grid.terrain[i] === WATER ? 0 : WATER;
    renderer.invalidateTile(100, 100);
    renderer.render(700);
    expect(redraws(renderer)).toBe(3);
    renderer.render(850);
    expect(redraws(renderer)).toBe(3);
  });

  it("stepping back re-arms the 30 Hz timer and the textured cadence holds", () => {
    const { renderer } = setup();
    renderer.setPerformanceMode(true);
    renderer.render(0);
    renderer.setPerformanceMode(false);
    renderer.render(100);                       // dirty from the mode switch
    const afterSwitch = redraws(renderer);
    expect(afterSwitch).toBe(2);
    // and now the ambient motion is back: a full frame window redraws
    renderer.render(100 + TERRAIN_FRAME_MS + 10);
    expect(redraws(renderer)).toBe(afterSwitch + 1);
    expect(renderer.renderDiagnostics().terrain).toMatchObject({ performance: false, animated: true });
  });

  it("the mode switch releases the chunk cache (no stale surfaces held)", () => {
    const { renderer } = setup();
    renderer.setPerformanceMode(true);
    renderer.render(0);
    expect(renderer.renderDiagnostics().chunkCacheEntries).toBeGreaterThan(0);
    renderer.setPerformanceMode(false);
    expect(renderer.renderDiagnostics().chunkCacheEntries).toBe(0);
    renderer.render(50);                        // textured chunks rebuild lazily
    expect(renderer.renderDiagnostics().chunkCacheEntries).toBeGreaterThan(0);
  });

  it("the flat pass draws through the real paint path without textures", () => {
    const { renderer } = setup();
    // No setGround() was ever called — the flat scene must not need one.
    renderer.setPerformanceMode(true);
    expect(() => renderer.render(0)).not.toThrow();
    expect(redraws(renderer)).toBe(1);
  });
});

// ── the flat ground paint ──────────────────────────────────────────────────
/** A context that records every call and remembers the styles it was given. */
function recordingCtx() {
  const calls: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (["fillStyle", "strokeStyle", "globalAlpha", "lineWidth"].includes(prop)) return state[prop];
      return (..._args: unknown[]) => { calls.push(prop); };
    },
    set(_t, prop: string, v: unknown) { state[prop] = v; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, state };
}

describe("PERF-01 flat ground paint", () => {
  const grid: Grid = generateMap(1234);

  it("paints solid sand, then solid grass — the same contours the textured ground uses", () => {
    const { ctx, calls, state } = recordingCtx();
    paintFlatGroundTiles(ctx, grid, 0, 0, CHUNK_RANGE_X, CHUNK_RANGE_Y, PERF_FLAT);
    // two fills (sand terrace, then meadow), one grid stroke, clips on
    expect(calls.filter((c) => c === "fill")).toHaveLength(2);
    expect(calls.filter((c) => c === "stroke")).toHaveLength(1);
    expect(calls.filter((c) => c === "clip").length).toBeGreaterThanOrEqual(2);
    expect(state.fillStyle).toBe(PERF_FLAT.grass);     // the LAST fill was the land
    expect(state.strokeStyle).toBe(PERF_FLAT.grid);
    expect(state.lineWidth).toBe(1);
    // save/restore balanced — no state leaks into the caller
    expect(calls.filter((c) => c === "save").length)
      .toBe(calls.filter((c) => c === "restore").length);
  });

  it("is deterministic and contour-stable for a given (grid, range)", () => {
    const a = recordingCtx(), b = recordingCtx();
    paintFlatGroundTiles(a.ctx, grid, 4, 4, 11, 11, PERF_FLAT);
    paintFlatGroundTiles(b.ctx, grid, 4, 4, 11, 11, PERF_FLAT);
    expect(a.calls).toEqual(b.calls);
    // the painted land is the same land the textured ground paints from
    expect(groundContours(grid).land.length).toBeGreaterThan(0);
  });

  it("an all-water map still issues the same two fills and one grid stroke", () => {
    const water = new Uint8Array(MAP_W * MAP_H).fill(WATER);   // GRASS=0, WATER=1
    const ocean: Grid = { ...grid, terrain: water };
    const { ctx, calls, state } = recordingCtx();
    paintFlatGroundTiles(ctx, ocean, 0, 0, 7, 7, PERF_FLAT);
    // the fills are still ISSUED (against empty contours — the traceCoast
    // result for a map with no land is the empty loop set), and the grid
    // clip keeps the water clean either way.
    expect(calls.filter((c) => c === "fill")).toHaveLength(2);
    expect(state.strokeStyle).toBe(PERF_FLAT.grid);
    expect(calls.filter((c) => c === "stroke")).toHaveLength(1);
  });
});
