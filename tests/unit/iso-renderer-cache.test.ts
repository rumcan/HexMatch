import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Atlas, type Manifest } from "../../src/iso/atlas";
import { IsoRenderer, buildDrawList, type World } from "../../src/iso/renderer";
import { place, depthSort } from "../../src/iso/depth";
import { createCamera, centerOnMap, visibleTileRange } from "../../src/iso/camera";
import { generateMap } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";

// Test placement/invalidation without a browser canvas or loaded art.
vi.mock("../../src/iso/building-shadow", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/iso/building-shadow")>(),
  paintBuildingShadows: () => 0,
}));
function setup() {
  const atlas = new Atlas(JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8")) as Manifest);
  const ctx = { clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn() };
  const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
  const world: World = { grid: generateMap(1234), extra: [{ sprite: "depot_blue", tx: 72, ty: 72 }],
    roadBits: new Uint8Array(MAP_W * MAP_H), dirtBits: new Uint8Array(MAP_W * MAP_H) };
  const renderer = new IsoRenderer({ terrain: canvas, structures: canvas, overlay: canvas },
    atlas, centerOnMap(createCamera(800, 600)), world);
  renderer.setRoadMode("sprites");
  return { renderer, atlas, world };
}
function assertFresh(renderer: IsoRenderer) {
  const items = buildDrawList(renderer.world, visibleTileRange(renderer.cam, renderer.cullPadValue),
    { roads: renderer.roadRenderMode === "sprites" });
  const placed = items.flatMap((item) => { const p = place(renderer.atlas, item); return p ? [p] : []; });
  expect(renderer.drawOrder).toEqual(depthSort(placed).order);
}
describe("static placement cache", () => {
  it("reuses static objects but refreshes traffic, including the last vehicle disappearing", () => {
    const { renderer, world } = setup();
    world.vehicles = [{ sprite: "depot_blue", tx: 72, ty: 72, fx: 72.1, fy: 72 }];
    renderer.drawStructures();
    const depot = renderer.drawOrder.find((p) => p.sprite === "depot_blue" && p.fx === undefined)!;
    world.vehicles = [{ ...world.vehicles[0], fx: 72.4 }];
    renderer.drawStructures(100);
    expect(renderer.drawOrder).toContain(depot);
    expect(renderer.drawOrder.find((p) => p.fx !== undefined)?.fx).toBe(72.4);
    assertFresh(renderer);
    vi.spyOn(renderer, "drawTerrain").mockImplementation(() => {});
    vi.spyOn(renderer, "drawOverlay").mockImplementation(() => {});
    world.vehicles = [];
    renderer.render(200);
    expect(renderer.drawOrder.every((p) => p.fx === undefined)).toBe(true);
    assertFresh(renderer);
  });
  it("rebuilds on tile, world, camera, road-mode, full and late-art invalidation", () => {
    const { renderer, world, atlas } = setup();
    renderer.drawStructures();
    const invalidate = [
      () => { world.roadBits![72 * MAP_W + 72] = 16; renderer.invalidateTile(72, 72); },
      () => { world.extra![0].tx++; renderer.setWorld(world); },
      () => renderer.setCamera({ ...renderer.cam, x: renderer.cam.x + 120 }),
      () => renderer.invalidateAll(),
      () => { atlas.get("depot_blue")!.h += 10; renderer.recomputePad(); },
      () => { renderer.setRoadMode("textured"); renderer.setRoadMode("sprites"); },
      () => renderer.setWorld({ grid: generateMap(2345) }),
    ];
    for (const change of invalidate) {
      const previous = renderer.drawOrder.slice();
      change(); renderer.drawStructures(); assertFresh(renderer);
      expect(renderer.drawOrder.some((p) => previous.includes(p))).toBe(false);
    }
  });
  it("does not construct trace payloads when logging is disabled", () => {
    const { renderer } = setup();
    const trace = vi.spyOn(renderer as unknown as { trace: (...args: unknown[]) => void }, "trace");
    renderer.drawStructures();
    expect(trace).not.toHaveBeenCalled();
    renderer.setRenderLog(true);
    const log = vi.spyOn(console, "debug").mockImplementation(() => {});
    renderer.drawStructures();
    expect(trace).toHaveBeenCalledWith("structures-pass", expect.objectContaining({ order: expect.any(Array) }));
    log.mockRestore();
  });
});
