// ══════════════════════════════════════════════════════════════════════════
// TRAFFIC-01 — the performance probe: "does having a few cars driving on the
// map kill performance?"
//
// Opt-in CPU benchmark (NOT a CI timing assertion — same convention as
// iso-depth-performance.test.ts). Run with:
//
//   HEX_TRAFFIC_BENCH=1 npx vitest run tests/unit/iso-traffic-perf.test.ts
//
// What it does: builds the real seeded world (144×144 map, towns, public
// roads, scenery — the boot state of the actual game), mounts the REAL
// IsoRenderer on a counting canvas stub, and measures the steady-state
// per-frame `render()` cost at 0 / 3 / 10 / 30 / 100 ambient cars.
//
// Honest about what it measures: Node has no rasterizer, so the number is
// the JS side of the frame (culling, placement, depth sort, road-chunk
// bookkeeping, the draw loops) plus the BLIT COUNT — the drawImage calls
// the browser would have to raster. A frame's browser cost is that JS time
// plus roughly 0.1–1 µs of raster per blit (canvas 2D, CPU composite), so
// the blit delta is the part that scales with traffic.
//
// The key structural effect under test: while ANY vehicle moves,
// `hasAnimation()` forces the whole structures pass (roads + every
// structure + sort + blit of everything in view) to run EVERY frame,
// instead of only on world change. The cars switch that on — the N=0 row
// is the "game without traffic" the user calls "a bit slow".
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Atlas, type Manifest } from "../../src/iso/atlas";
import { IsoRenderer, type World } from "../../src/iso/renderer";
import { createCamera, centerOnMap } from "../../src/iso/camera";
import { generateMap } from "../../src/iso/grid";
import {
  createTrack, seedTownRoads, seedPublicRoads, type Track,
} from "../../src/iso/track";
import { scatterScenery } from "../../src/iso/scenery";
import {
  CAR_COUNT, planCars, createCarState, tickCars, carItems, type CarState,
} from "../../src/iso/cars";

// Shadow stamps are a renderer-side cache with their own offscreen surface
// needs — not the cost under test. Same mock as iso-renderer-cache.test.ts.
vi.mock("../../src/iso/building-shadow", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/iso/building-shadow")>(),
  paintBuildingShadows: () => 0,
}));

// Node has no canvas: give the renderer a counting offscreen surface so the
// ground-chunk + road-chunk caches build (once, during warmup) exactly like
// in a browser, and their per-frame BLITS count toward the frame's draw
// calls. The painting itself is a no-op — that is the raster the browser
// pays and Node cannot charge for.
class StubOffscreenCanvas {
  width: number;
  height: number;
  constructor(w: number, h: number) { this.width = w; this.height = h; }
  getContext(): CanvasRenderingContext2D {
    return countingCtx({ drawImage: 0, fillRect: 0, stroke: 0 });
  }
}
(globalThis as Record<string, unknown>).OffscreenCanvas ??= StubOffscreenCanvas;

interface Stats { drawImage: number; fillRect: number; stroke: number; }

/** A no-op 2D context that counts the calls the browser would raster. */
function countingCtx(stats: Stats): CanvasRenderingContext2D {
  const noop = () => undefined;
  const bag: Record<string, unknown> = {
    drawImage: () => { stats.drawImage++; },
    fillRect: () => { stats.fillRect++; },
    clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    closePath: noop, fill: noop, stroke: () => { stats.stroke++; },
    save: noop, restore: noop, clip: noop, translate: noop, scale: noop,
    rotate: noop, setTransform: noop, setLineDash: noop,
    createPattern: () => null, createLinearGradient: () => "gradient",
    measureText: () => ({ width: 0 }),
    // setters the renderer touches
    lineJoin: "miter", lineCap: "butt", lineWidth: 1, globalAlpha: 1,
    fillStyle: "#000", strokeStyle: "#000", lineDashOffset: 0,
    imageSmoothingEnabled: true, font: "10px monospace",
  };
  return bag as unknown as CanvasRenderingContext2D;
}

function setup(zoom: 0.5 | 1 | 2 = 1) {
  const manifest: Manifest = JSON.parse(
    readFileSync("assets/iso-atlas/manifest.json", "utf8"),
  );
  const atlas = new Atlas(manifest);
  // A fake monolith image at every zoom: blit() then runs its FULL path
  // (imageForSprite → zoomFrameRect → drawImage) so the blit count is the
  // real per-frame draw call count.
  atlas.images.set(0.5, {} as never);
  atlas.images.set(1, {} as never);
  atlas.images.set(2, {} as never);
  const grid = generateMap(79);
  const track: Track = createTrack();
  seedTownRoads(track, grid);
  seedPublicRoads(track, grid);
  const scenery = scatterScenery(grid);
  const world: World = {
    grid,
    roadBits: track.road,
    dirtBits: track.dirt,
    trees: scenery.trees,
    sceneryBlocked: scenery.blocked,
    forests: scenery.forests,
  };
  const terrainStats: Stats = { drawImage: 0, fillRect: 0, stroke: 0 };
  const structuresStats: Stats = { drawImage: 0, fillRect: 0, stroke: 0 };
  const canvases = {
    terrain: { getContext: () => countingCtx(terrainStats) } as unknown as HTMLCanvasElement,
    structures: { getContext: () => countingCtx(structuresStats) } as unknown as HTMLCanvasElement,
    overlay: { getContext: () => countingCtx({ drawImage: 0, fillRect: 0, stroke: 0 }) } as unknown as HTMLCanvasElement,
  };
  const cam = centerOnMap({ ...createCamera(1280, 720), zoom });
  const renderer = new IsoRenderer(canvases, atlas, cam, world);
  return { renderer, world, track, terrainStats, structuresStats };
}

/** Steady-state: warm up (builds the static placement cache + road chunks),
 *  then measure `frames` full render() frames at 16.7 ms spacing, with the
 *  cars actually rolling between frames. */
function measureFrames(
  renderer: IsoRenderer, world: World, cars: CarState,
  terrainStats: Stats, structuresStats: Stats, frames = 300,
): { medianMs: number; p95Ms: number; totalBlitsPerFrame: number; structuresBlitsPerFrame: number } {
  renderer.render(0);
  for (let i = 0; i < 20; i++) {
    tickCars(cars, 16.7);
    world.vehicles = carItems(cars);
    renderer.render(333 + i * 16.7);
  }
  const times: number[] = [];
  terrainStats.drawImage = 0;
  structuresStats.drawImage = 0;
  for (let i = 0; i < frames; i++) {
    tickCars(cars, 16.7);
    world.vehicles = carItems(cars);
    const start = performance.now();
    renderer.render(i * 16.7);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return {
    medianMs: times[Math.floor(times.length / 2)]!,
    p95Ms: times[Math.floor(times.length * 0.95)]!,
    totalBlitsPerFrame: (terrainStats.drawImage + structuresStats.drawImage) / frames,
    structuresBlitsPerFrame: structuresStats.drawImage / frames,
  };
}

describe("TRAFFIC-01 perf probe", () => {
  it("boots the real world with the default car count (sanity)", () => {
    const { renderer, world, track } = setup();
    const cars = createCarState();
    cars.cars = planCars(track, [], CAR_COUNT);
    const items = carItems(cars);
    // all three cars exist and are named car 1 / car 2 / car 3…
    expect(items.length).toBe(3);
    expect(items.map((i) => (i.ref as { car: string }).car)).toEqual(
      ["car 1", "car 2", "car 3"],
    );
    world.vehicles = items;
    renderer.render(0);
    // …and the structures pass draws the ones in view as moving (fractional)
    // items (a car parked outside the viewport is culled, not dropped).
    const drawn = renderer.drawOrder.filter((p) => p.fx !== undefined);
    expect(drawn.length).toBeGreaterThanOrEqual(1);
    expect(drawn.length).toBeLessThanOrEqual(3);
  });

  it("reports per-frame cost at 0 / 3 / 10 / 30 / 100 cars (HEX_TRAFFIC_BENCH=1)", () => {
    if (!process.env.HEX_TRAFFIC_BENCH) return;
    for (const zoom of [0.5, 1, 2] as const) {
      const { renderer, world, track, terrainStats, structuresStats } = setup(zoom);
      const rows: [number, ReturnType<typeof measureFrames>][] = [];
      for (const n of [0, CAR_COUNT, 10, 30, 100]) {
        const cars = createCarState();
        cars.cars = planCars(track, [], n);
        // scatter them so the frames are representative, not a single blob
        tickCars(cars, 5000);
        const r = measureFrames(renderer, world, cars, terrainStats, structuresStats);
        rows.push([n, r]);
        const zero = rows[0]![1];
        console.log(
          `traffic: zoom ${zoom} | ${String(n).padStart(3)} cars | ` +
          `frame median ${r.medianMs.toFixed(3)} ms (Δ ${(r.medianMs - zero.medianMs).toFixed(3)}) | ` +
          `draw calls ${r.totalBlitsPerFrame.toFixed(0)}/frame (Δ ${(r.totalBlitsPerFrame - zero.totalBlitsPerFrame).toFixed(0)})`,
        );
      }
      // The probe's contract: a full order of magnitude of extra cars must
      // not cost a full order of magnitude of extra frame time (the
      // marginal cost per car is place() + a sort insert + one blit).
      // Timing asserts are flaky, so this margin is the assertion.
      const zero = rows[0]![1];
      for (const [n, r] of rows.slice(1)) {
        expect(
          r.medianMs, `${n} cars @ zoom ${zoom} should not cost more than a 10× margin over 0`,
        ).toBeLessThanOrEqual(zero.medianMs * 10 + 5);
      }
    }
  });
});
