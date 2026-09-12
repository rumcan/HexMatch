import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Atlas, type AtlasImage, type Manifest } from "../../src/iso/atlas";
import { IsoRenderer, type World } from "../../src/iso/renderer";
import { place } from "../../src/iso/depth";
import { createCamera, centerOnMap, visibleTileRange, worldToScreen } from "../../src/iso/camera";
import { generateMap } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";

// Damage-clipped traffic repaint and terrain cadence, against a recording
// context. This pins WHICH path runs and what it touches; it does not rasterise.
vi.mock("../../src/iso/building-shadow", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/iso/building-shadow")>(),
  paintBuildingShadows: () => 0,
}));

function recorder() {
  const calls: string[] = [];
  const op = (name: string) => vi.fn(() => { calls.push(name); });
  return {
    calls,
    ctx: {
      clearRect: op("clearRect"), save: op("save"), restore: op("restore"),
      beginPath: op("beginPath"), rect: op("rect"), clip: op("clip"), drawImage: op("drawImage"),
      imageSmoothingEnabled: false,
    },
  };
}

function setup() {
  const image = { width: 8192, height: 8192 } as unknown as AtlasImage;
  const atlas = new Atlas(
    JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8")) as Manifest,
    new Map([[0.5, image], [1, image], [2, image]]),
  );
  const { ctx, calls } = recorder();
  const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
  const world: World = {
    grid: generateMap(1234),
    extra: [{ sprite: "depot_blue", tx: 72, ty: 72 }],
    roadBits: new Uint8Array(MAP_W * MAP_H), dirtBits: new Uint8Array(MAP_W * MAP_H),
  };
  const renderer = new IsoRenderer({ terrain: canvas, structures: canvas, overlay: canvas },
    atlas, centerOnMap(createCamera(800, 600)), world);
  renderer.setRoadMode("sprites");
  const truck = (fx: number, fy: number) =>
    ({ sprite: "depot_blue", tx: Math.round(fx), ty: Math.round(fy), fx, fy });
  const repaint = () => renderer.renderDiagnostics().repaint;
  return { renderer, world, atlas, calls, truck, repaint };
}

describe("damage-clipped traffic repaint", () => {
  it("paints the first frame whole, then only the old and new traffic bounds", () => {
    const { renderer, world, calls, truck, repaint } = setup();
    world.vehicles = [truck(72.1, 72)];
    renderer.drawStructures(0);
    expect(repaint().full).toBe(true);
    const fullBlits = repaint().blits;

    calls.length = 0;
    world.vehicles = [truck(72.4, 72)];
    renderer.drawStructures(16);
    expect(repaint()).toMatchObject({ full: false, damageRects: 2 });
    expect(calls).toContain("clip");
    expect(calls.filter((c) => c === "save").length).toBe(calls.filter((c) => c === "restore").length);
    expect(repaint().blits).toBeGreaterThan(0);
    expect(repaint().blits).toBeLessThan(fullBlits);
  });

  it("repaints where the last vehicle was when traffic disappears", () => {
    const { renderer, world, truck, repaint } = setup();
    world.vehicles = [truck(72.1, 72)];
    renderer.drawStructures(0);
    world.vehicles = [];
    renderer.drawStructures(16);
    expect(repaint()).toMatchObject({ full: false, damageRects: 1 });
  });

  it("leaves a still viewport untouched when only off-screen traffic moves", () => {
    const { renderer, world, atlas, calls, truck, repaint } = setup();
    const cam = renderer.cam, r = visibleTileRange(cam, renderer.cullPadValue);
    // A tile the cull range keeps but the viewport cannot see.
    let spot: [number, number] | null = null;
    for (let ty = r.y0; ty <= r.y1 && !spot; ty++) {
      for (let tx = r.x0; tx <= r.x1 && !spot; tx++) {
        const p = place(atlas, truck(tx, ty))!;
        const [sx, sy] = worldToScreen(cam, p.wx, p.wy);
        const z = cam.zoom;
        if (sx + p.w * z < -4 || sy + p.h * z < -4 || sx > cam.vw + 4 || sy > cam.vh + 4) spot = [tx, ty];
      }
    }
    expect(spot).not.toBeNull();
    world.vehicles = [truck(spot![0], spot![1])];
    renderer.drawStructures(0);
    calls.length = 0;
    world.vehicles = [truck(spot![0] + 0.3, spot![1])];
    renderer.drawStructures(16);
    expect(repaint()).toMatchObject({ full: false, damageRects: 0, blits: 0 });
    expect(calls).toEqual([]);
  });

  it("falls back to a full repaint on demand, camera, world and art changes", () => {
    const { renderer, world, truck, repaint } = setup();
    world.vehicles = [truck(72.1, 72)];
    renderer.drawStructures(0);
    const changes = [
      () => renderer.drawStructures(16, true),
      () => { renderer.setCamera({ ...renderer.cam, x: renderer.cam.x + 32 }); renderer.drawStructures(32); },
      () => { renderer.setWorld(world); renderer.drawStructures(48); },
      () => { renderer.recomputePad(); renderer.drawStructures(64); },
      () => { renderer.invalidateAll(); renderer.drawStructures(80); },
    ];
    for (const change of changes) {
      change();
      expect(repaint().full).toBe(true);
      renderer.drawStructures(100);          // and back to damage-only after
      expect(repaint().full).toBe(false);
    }
  });
});

describe("terrain cadence", () => {
  it("caps ambient terrain at ~30 Hz, keeps the overlay per frame, and repaints at once on camera/world change", () => {
    const { renderer } = setup();
    // Cadence only: record which layers each frame asks for, without painting.
    const terrain = vi.spyOn(renderer, "drawTerrain").mockImplementation(() => {});
    const overlay = vi.spyOn(renderer, "drawOverlay").mockImplementation(() => {});
    vi.spyOn(renderer, "drawStructures").mockImplementation(() => {});
    const t60 = 1000 / 60;
    for (let i = 0; i <= 6; i++) renderer.render(i * t60);
    expect(overlay).toHaveBeenCalledTimes(7);
    expect(terrain.mock.calls.map((c) => Math.round(c[0] ?? 0))).toEqual([0, 33, 67, 100]);

    terrain.mockClear();
    renderer.setCamera({ ...renderer.cam, x: renderer.cam.x + 10 });
    renderer.render(6 * t60 + 1);
    expect(terrain).toHaveBeenCalledTimes(1);
    renderer.setWorld(renderer.world);
    renderer.render(6 * t60 + 2);
    expect(terrain).toHaveBeenCalledTimes(2);
    renderer.render(6 * t60 + 3);
    expect(terrain).toHaveBeenCalledTimes(2);
  });
});
