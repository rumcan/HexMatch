// 3D-FIX-4 (#663) — ROADS AND RAIL STAY ON THE TERRAIN ON SLOPES WHEN THE CAMERA IS TURNED.
//
// The bug the owner saw: the road/rail layer is a baked raster (one bitmap per 512x256 world chunk), and the hill
// lift (E2 #267) is baked INTO that raster as a shift in GROUND space. Under a turned view the bitmap is laid down
// through the same linear map the terrain uses, M(a) = [[cos a, 2 sin a], [-sin a / 2, cos a]], so a lift that was
// baked screen-vertically in the UNTURNED frame turns with the bitmap and every road on a slope slides sideways.
//
// The rule that fixes it: lift in ground space by the INVERSE quarter turn of (-k, -k), so that after the blit's
// turn the lift is screen-vertical again — which is exactly what the terrain shader, the sprites and the cars do
// (they lift on screen, after the turn). `draperFor(grid, q)` is that rule; this file measures it.
//
// WHAT IS MEASURED, NOT IMPRESSIONED: for a ground point the terrain draws at
//      reference = turn(flat(u, v)) + (0, -liftAt(u, v))
// the road raster draws the same point at
//      baked     = turn(flat(drape(u, v)))
// because the drape is baked before the blit's turn. `mismatch` is the distance between them in world pixels.
// Measured here over every sloped tile of three elevation maps (~11 000 sample points per seed, five points a
// tile): 0.00e+0 px at all four quarters, against 62-69 px if the old unturned lift is baked and then turned.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { generateMap } from "../../src/iso/grid";
import { HW, HH, MAP_W, MAP_H, tileToScreen } from "../../src/game/config";
import {
  draperFor, liftShift, liftAt, tileCorners, LEVEL_PX, MAX_LIFT_PX, LIFT_GROUND_PER_LEVEL, FLAT_DRAPER, elevationActive,
} from "../../src/iso/elevation";
import { createCamera, getViewYaw, setViewYawTarget, snapViewYaw, tickViewYaw, turnWorld } from "../../src/iso/camera";
import { yawQuarter } from "../../src/iso/depth";
import {
  DEFAULT_ROAD_STYLE, ROAD_CHUNK_W, ROAD_CHUNK_H, RoadCache,
} from "../../src/iso/road-renderer";
import { NE, SW } from "../../src/iso/track";

// The view yaw is MODULE state; every test that touches it must hand it back.
afterEach(() => { snapViewYaw(createCamera(800, 600), 0); });

/** The ground-plane -> world-pixel projection the road raster bakes through (`setTransform(HW, HH, -HW, HH, ...)`). */
const flat = (u: number, v: number): [number, number] => [(u - v) * HW, (u + v) * HH];
/** Where the road raster puts a ground point: drape (baked), then the blit's turn. */
const baked = (grid: ReturnType<typeof generateMap>, q: number, u: number, v: number, a: number): [number, number] =>
  turnWorld(...flat(...(draperFor(grid, q).point(u, v) as [number, number])), a);
/** Where the terrain puts the same point: turn the flat point, then lift SCREEN-vertically. */
const reference = (grid: ReturnType<typeof generateMap>, u: number, v: number, a: number): [number, number] => {
  const [x, y] = turnWorld(...flat(u, v), a);
  return [x, y - liftAt(grid, u, v)];
};
const mismatch = (grid: ReturnType<typeof generateMap>, q: number, u: number, v: number, a: number): number => {
  const [bx, by] = baked(grid, q, u, v, a);
  const [rx, ry] = reference(grid, u, v, a);
  return Math.hypot(bx - rx, by - ry);
};
/** Five points a road through a tile actually covers: its centre and the four quarter points. */
const roadSamples = (tx: number, ty: number): [number, number][] => [
  [tx + 0.5, ty + 0.5], [tx + 0.25, ty + 0.5], [tx + 0.75, ty + 0.5], [tx + 0.5, ty + 0.25], [tx + 0.5, ty + 0.75],
];
const slopedTiles = (grid: ReturnType<typeof generateMap>): [number, number][] => {
  const out: [number, number][] = [];
  for (let ty = 0; ty < grid.h; ty++) {
    for (let tx = 0; tx < grid.w; tx++) if (new Set(tileCorners(grid, tx, ty)).size > 1) out.push([tx, ty]);
  }
  return out;
};
const SEEDS = [1, 42, 1337];
const maps = SEEDS.map((s) => generateMap(s, { elevation: true }));

describe("3D-FIX-4 the baked lift lands screen-vertically at every quarter", () => {
  it("mismatch is 0.00 px on every sloped tile of three elevation maps, at all four quarters", () => {
    let samples = 0;
    for (const grid of maps) {
      expect(elevationActive(grid)).toBe(true);
      const slopes = slopedTiles(grid);
      expect(slopes.length).toBeGreaterThan(1000);          // the map really has hills on it
      for (let q = 0; q < 4; q++) {
        const a = (q * Math.PI) / 2;
        let worst = 0;
        for (const [tx, ty] of slopes) {
          for (const [u, v] of roadSamples(tx, ty)) {
            worst = Math.max(worst, mismatch(grid, q, u, v, a));
            samples++;
          }
        }
        expect(worst, `seed ${SEEDS[maps.indexOf(grid)]} quarter ${q}`).toBeLessThan(1e-9);
      }
    }
    expect(samples).toBeGreaterThan(30000);                 // the measurement covers ground, not a token tile
  });

  it("a flat map is untouched at every quarter: the drape is the identity", () => {
    const flatMap = generateMap(7);
    expect(elevationActive(flatMap)).toBe(false);
    for (let q = 0; q < 4; q++) {
      expect(draperFor(flatMap, q)).toBe(FLAT_DRAPER);
      expect(draperFor(flatMap, q).point(12.25, 30.5)).toEqual([12.25, 30.5]);
    }
  });

  it("quarter 0 is the pre-LIVE-3D draper, so the yaw-0 path is byte for byte what it always was", () => {
    const grid = maps[0];
    for (const [u, v] of [[10, 20], [10.5, 20.5], [63.25, 41.75]] as const) {
      const k = liftAt(grid, u, v) / LEVEL_PX * LIFT_GROUND_PER_LEVEL;
      expect(draperFor(grid, 0).point(u, v)[0]).toBeCloseTo(u - k, 12);
      expect(draperFor(grid, 0).point(u, v)[1]).toBeCloseTo(v - k, 12);
      expect(draperFor(grid, 0).point(u, v)).toEqual(liftShift(u, v, k, 0));
    }
    // …and the ground projection inside the raster is the plain tileToScreen, unchanged.
    expect(flat(9, 4)).toEqual(tileToScreen(9, 4));
  });

  it("baking the UNTURNED lift and then turning the raster (the bug) slides a road 60-70 px off its hill", () => {
    // The regression guard: this is the number the fix removes. Without the per-quarter drape the road on a
    // level-4 hill is drawn 2.24 x the lift (71.5 px, about two tiles) away from the ground it lies on.
    for (const grid of maps) {
      const slopes = slopedTiles(grid);
      for (const q of [1, 2, 3]) {
        const a = (q * Math.PI) / 2;
        let worst = 0;
        for (const [tx, ty] of slopes) {
          for (const [u, v] of roadSamples(tx, ty)) worst = Math.max(worst, mismatch(grid, 0, u, v, a));
        }
        expect(worst, `quarter ${q}`).toBeGreaterThan(40);      // the bug is big, and this test would catch it
        expect(worst).toBeLessThanOrEqual(2.24 * MAX_LIFT_PX + 0.001);
      }
    }
  });
});

describe("3D-FIX-4 the mid-turn ease: a snap, and where it costs", () => {
  it("is exact once the turn lands, and bounded by 2.24 x the lift while the camera eases", () => {
    const grid = maps[0];
    const slopes = slopedTiles(grid);
    // The raster is baked for the DESTINATION quarter, so the drift is front-loaded: it is worst on the first
    // frame of the ease (the blit is still at the old angle) and decays to 0 with the ease (~250 ms, rate 10/s).
    for (const q of [1, 2, 3]) {
      const a = (q * Math.PI) / 2;
      let worst = 0;
      for (let step = 0; step <= 10; step++) {
        const eased = (a * step) / 10;                     // yaw part-way through the ease to quarter q
        for (const [tx, ty] of slopes) {
          for (const [u, v] of roadSamples(tx, ty)) worst = Math.max(worst, mismatch(grid, q, u, v, eased));
        }
      }
      expect(worst).toBeLessThanOrEqual(2.24 * MAX_LIFT_PX + 0.001);
      // …and it vanishes exactly when the ease lands: at rest the road is on the ground again.
      let atRest = 0;
      for (const [tx, ty] of slopes) {
        for (const [u, v] of roadSamples(tx, ty)) atRest = Math.max(atRest, mismatch(grid, q, u, v, a));
      }
      expect(atRest).toBeLessThan(1e-9);
    }
  });

  it("switching quarters at the START of the turn is the smallest snap available", () => {
    // Switching from quarter q to q+1 at ease angle T jumps the road by |M(T) (d_q - d_q+1)|, which is
    // 2.24 x lift at T = 0 (or 90) and 2.83 x lift at T = 45. The raster is re-keyed the moment the target
    // changes, i.e. at T = 0, so a turn costs the minimum possible jump — and it is paid while the camera is
    // still at rest, easing smoothly back to 0. (Re-baking at the 45 deg crossover would be 27% worse.)
    const L = MAX_LIFT_PX;
    const jumpAt = (deg: number): number => {
      const a = (deg * Math.PI) / 180;
      const d0: [number, number] = [0, -L], d1: [number, number] = [2 * L, 0];
      const [x0, y0] = turnWorld(...d0, a);
      const [x1, y1] = turnWorld(...d1, a);
      return Math.hypot(x1 - x0, y1 - y0);
    };
    expect(jumpAt(0)).toBeCloseTo(Math.hypot(2 * L, L), 6);
    expect(jumpAt(45)).toBeCloseTo(2 * Math.SQRT2 * L, 6);
    expect(jumpAt(45)).toBeGreaterThan(jumpAt(0));
  });
});

// ── the blit: the raster is laid down through the terrain's own turn matrix ─────────────────────────────────────
/** A canvas stub that records ops; every method returns the stub itself, so gradients/patterns compose. */
const recCtx = () => {
  const calls: { op: string; args: number[] }[] = [];
  const stub: unknown = new Proxy({}, {
    get(_t, k: string) {
      if (k === "canvas") return { width: 4096, height: 2048 };
      return (...args: unknown[]) => { calls.push({ op: k, args: args as number[] }); return stub; };
    },
    set: () => true,
  });
  return { ctx: stub as CanvasRenderingContext2D, calls };
};
const surfaceFactory = () => {
  const { ctx } = recCtx();
  return (w: number, h: number) => ({ width: w, height: h, getContext: () => ctx }) as unknown as HTMLCanvasElement;
};
/** How far a value is from the nearest whole multiple of `m` (the chunk origins are exact multiples). */
const offGrid = (v: number, m: number): number => { const r = Math.abs(v) % m; return Math.min(r, m - r); };
const PRESENT = 0b10000;
const blank = () => new Uint8Array(MAP_W * MAP_H);

describe("3D-FIX-4 the road layer's blit follows the turn", () => {
  const road = blank();
  road[5 * MAP_W + 5] = PRESENT | NE | SW;                 // tile (5,5) projects to (0, 160): inside chunk (0,0)
  const world = { roadBits: road, dirtBits: blank() };
  const cam = { ...createCamera(800, 600), zoom: 1 as const, x: 400, y: 300 };

  it("yaw 0 takes the plain drawImage path — no transform, nothing new per frame", () => {
    const c = new RoadCache();
    const { ctx, calls } = recCtx();
    snapViewYaw(cam, 0);
    const blits = c.paint(ctx, { ...cam }, world, DEFAULT_ROAD_STYLE, surfaceFactory());
    expect(blits).toBeGreaterThan(0);
    expect(calls.some((c2) => c2.op === "setTransform")).toBe(false);      // the old path, untouched
    expect(calls.some((c2) => c2.op === "drawImage")).toBe(true);
  });

  it("at a turned view every chunk rides M(yaw) = [[cos, 2 sin], [-sin / 2, cos]] about its own origin", () => {
    for (let k = 1; k < 4; k++) {
      const c = new RoadCache();
      const { ctx, calls } = recCtx();
      snapViewYaw(cam, (k * Math.PI) / 2);
      const yaw = getViewYaw(), yc = Math.cos(yaw), ys = Math.sin(yaw);
      const blits = c.paint(ctx, { ...cam }, world, DEFAULT_ROAD_STYLE, surfaceFactory());
      expect(blits).toBeGreaterThan(0);
      const xs = calls.filter((c2) => c2.op === "setTransform");
      expect(xs.length).toBe(blits);                                        // one per chunk, no extra state churn
      let originChunkSeen = false;
      for (const t of xs) {
        const [a, b, cc, d, e, f] = t.args;
        expect(a).toBeCloseTo(yc, 9); expect(b).toBeCloseTo(-0.5 * ys, 9);
        expect(cc).toBeCloseTo(2 * ys, 9); expect(d).toBeCloseTo(yc, 9);
        // (e, f) - cam must be M . (ox, oy) for a chunk origin, i.e. an exact whole number of chunks back.
        const dx = e - cam.x, dy = f - cam.y;
        const ox = yc * dx - 2 * ys * dy, oy = 0.5 * ys * dx + yc * dy;      // M inverse
        expect(offGrid(ox, ROAD_CHUNK_W)).toBeLessThan(1e-6);
        expect(offGrid(oy, ROAD_CHUNK_H)).toBeLessThan(1e-6);
        if (Math.abs(ox) < 1e-6 && Math.abs(oy) < 1e-6) originChunkSeen = true;
      }
      expect(originChunkSeen).toBe(true);                                    // chunk (0,0) lands on the camera
    }
  });
});

describe("3D-FIX-4 the cache: one raster per (zoom, quarter, chunk), and a hard byte budget", () => {
  // A camera whose screen rectangle is INVARIANT under the turn: vw / vh = 2 and centred, because the turn maps
  // (x, y) -> (-2y, x / 2), so [-X, X] x [-X / 2, X / 2] comes back as itself. Deliberately NOT a whole number
  // of chunks: on the exact boundary cos(90 deg) = 6e-17 spills an extra row and column. The same 8 x 8 chunks
  // are visited at every quarter and at small ease angles, so after the first paint every further miss is a
  // re-bake and nothing else.
  const cam = { x: 2000, y: 1000, zoom: 1 as const, vw: 4000, vh: 2000 };
  const CHUNKS = 64;                                               // 8 x 8 chunks, see the note above

  it("the view quarter is part of the cache key, and the quarter only — not the angle", () => {
    const c = new RoadCache();
    const { ctx } = recCtx();
    const nothing = { roadBits: blank(), dirtBits: blank() };
    const paint = () => c.paint(ctx, { ...cam }, nothing, DEFAULT_ROAD_STYLE, () => null);
    snapViewYaw(cam, 0);
    expect(paint()).toBe(0);
    expect(c.stats().misses).toBe(CHUNKS);
    let before = c.stats().misses;
    paint();
    expect(c.stats().misses - before).toBe(0);                     // everything is cached now
    expect(c.stats().hits).toBe(CHUNKS);
    snapViewYaw(cam, Math.PI / 2);                                 // a different quarter: re-baked
    before = c.stats().misses;
    paint();
    expect(c.stats().misses - before).toBe(CHUNKS);
    snapViewYaw(cam, Math.PI / 2 + 0.001);                         // the same quarter, a hair off: still a hit
    before = c.stats().misses;
    paint();
    expect(c.stats().misses - before).toBe(0);
  });

  it("a turn re-bakes each chunk once, at the START of the ease — never again once it lands", () => {
    const c = new RoadCache();
    const { ctx } = recCtx();
    const nothing = { roadBits: blank(), dirtBits: blank() };
    const paint = () => c.paint(ctx, { ...cam }, nothing, DEFAULT_ROAD_STYLE, () => null);
    snapViewYaw(cam, 0);
    paint(); paint();
    const settled = c.stats().misses;
    setViewYawTarget(Math.PI / 2);                                 // the owner presses the key; the yaw is still 0
    paint();
    expect(c.stats().misses - settled).toBe(CHUNKS);               // the destination raster is built ONCE, here —
    let mark = c.stats().misses, hits = c.stats().hits;
    tickViewYaw(cam, 0.5);                                         // 0.45 deg into the ease
    paint();
    expect(c.stats().misses - mark).toBe(0);                       // …so no frame of the ease re-bakes anything,
    expect(c.stats().hits - hits).toBe(CHUNKS);                    // (and the turned view saw the same 64 chunks)
    tickViewYaw(cam, 1000);                                        // …and it lands on a warm cache.
    expect(getViewYaw()).toBeCloseTo(Math.PI / 2, 9);
    mark = c.stats().misses; hits = c.stats().hits;
    paint();
    expect(c.stats().misses - mark).toBe(0);
    expect(c.stats().hits - hits).toBe(CHUNKS);
    expect(yawQuarter(getViewYaw())).toBe(1);
  });

  it("is bounded: 48 MiB shared by the four quarters, so a turn cannot grow the cache", () => {
    // One raster is ceil((512 + 128) z) x ceil((256 + 128) z) device pixels at 4 bytes, so the entry count is
    // bounded by the budget alone, whatever the view does: 12 at 2x zoom (3.75 MiB each), 51 at 1x, 204 at 0.5x.
    const perChunk = (z: number) => Math.ceil((ROAD_CHUNK_W + 128) * z) * Math.ceil((ROAD_CHUNK_H + 128) * z) * 4;
    const budget = 48 * 1024 * 1024;
    expect(Math.floor(budget / perChunk(2))).toBe(12);
    expect(Math.floor(budget / perChunk(1))).toBe(51);
    expect(Math.floor(budget / perChunk(0.5))).toBe(204);
    const src = readFileSync(new URL("../../src/iso/road-renderer.ts", import.meta.url), "utf8");
    expect(src).toMatch(/budgetBytes = 48 \* 1024 \* 1024/);       // the bound is the constructor default
    expect(src).toMatch(/while \(this\.bytes > this\.budgetBytes && this\.entries\.size\)/);
  });
});

describe("3D-FIX-4 rail, decks, slope shading and the ground decals share the rule", () => {
  const src = readFileSync(new URL("../../src/iso/road-renderer.ts", import.meta.url), "utf8");
  const rendererSrc = readFileSync(new URL("../../src/iso/renderer.ts", import.meta.url), "utf8");

  it("the railway, the grade decks and the slope shading are draped by the SAME quarter draper as the roads", () => {
    // BRIDGE-1 (2026-10-05): the quarter draper is wrapped once so a bridge deck rides its bank's level.
    expect(src).toMatch(/const terrainElev = draperFor\(world\.grid, vq\)/);
    expect(src).toMatch(/const elev = bridgeDraper\(terrainElev, deckLevels, MAP_W, vq\)/);
    // Every painter that lifts geometry into the raster takes that one draper; a painter that lifted on its own
    // (or with the unturned one) would seam against the road it crosses at every quarter but 0.
    expect(src).toMatch(/paintRoadTiles\(ctx, tiles, style, townGround, roadDecks, elev,/);
    expect(src).toMatch(/paintRailTiles\(ctx, rail, this\.railDetail, this\.railStyle, railDecks, elev\)/);
    expect(src).toMatch(/paintRoadTiles\(ctx, gradeRoadDecks, style, \[\], \[\], elev,/);
    expect(src).toMatch(/paintSlopeShade\(ctx, world\.grid, \[\.\.\.tiles, \.\.\.rail\], elev\)/);
    expect(src.match(/\belev\b/g)?.length ?? 0).toBeGreaterThanOrEqual(6);   // one draper, five uses, no strays
  });

  it("the ground decals lift on screen, after the projection — the same rule, so a turn keeps them on their slope", () => {
    // A decal is ground (E2 #267): it is painted through a camera lifted by its level, i.e. shifted in screen
    // space, which is exactly the reference rule above. It therefore needs no quarter of its own.
    expect(rendererSrc).toMatch(/const gcam = g\.lift === 0 \? cam : \{ \.\.\.cam, y: cam\.y - g\.lift \* cam\.zoom \}/);
    expect(rendererSrc).toMatch(/decals \+= paintDecals\(target, gcam, g\.decals, this\.decalImages, r\)/);
  });

  it("the chunk is widened for the turned lift, so a hill road is not clipped at a chunk edge", () => {
    // At a turned quarter the baked lift is a HORIZONTAL shift of up to 2 x the lift, so the tile range has to
    // reach 2 x lift further left and right; at quarter 0 (a vertical lift) the old range is used unchanged.
    expect(src).toMatch(/px - \(vq \? 2 \* lift : 0\)/);
  });
});
