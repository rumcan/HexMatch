// ══════════════════════════════════════════════════════════════════════════
// ISSUE-144 — "Plant on the south-east side of a road draws over the road
// next to it."
//
// A centre-anchored building's per-building art can overhang its GAMEPLAY
// footprint (the Factory is played on 3×3 while its art is authored 4×4;
// depots and town sprites deliberately overhang theirs). Textured roads are
// painted before every sprite, so an overhang onto the camera-facing (SE/SW)
// tiles hides the road beside the building. The fix — without ever clipping
// or resizing the art — repaints the road tiles in front of the building's
// GAMEPLAY footprint after its blit, so the road stays fully visible right
// up to the reserved block. `frontRoadTiles` is the pure half of that; the
// renderer strokes the returned tiles. `loadBuildingLayers` keeps the
// monolith footprint as `gameplayFootprint` so the renderer can tell "played
// tiles" apart from "authored art tiles".
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { Atlas, loadBuildingLayers, type Manifest, type SpriteDef } from "../../src/iso/atlas";
import { frontRoadTiles, IsoRenderer, type World } from "../../src/iso/renderer";
import { generateMap } from "../../src/iso/grid";
import { createCamera, centerOnMap } from "../../src/iso/camera";
import { MAP_W, MAP_H } from "../../src/game/config";
import type { Placed } from "../../src/iso/depth";

const grid = generateMap(1234);

/** A World with the given paved/dirt tiles set (any non-zero road cell). */
function mkWorld(roads: [number, number][], dirts: [number, number][] = []): World {
  const roadBits = new Uint8Array(MAP_W * MAP_H);
  const dirtBits = new Uint8Array(MAP_W * MAP_H);
  for (const [x, y] of roads) roadBits[y * MAP_W + x] = 0b10001;
  for (const [x, y] of dirts) dirtBits[y * MAP_W + x] = 0b10001;
  return { grid, roadBits, dirtBits };
}

/** The Factory: played on 3×3, authored 4×4 (the reported mismatch). */
const factory = (tx = 10, ty = 10) => ({
  tx, ty,
  def: { footprint: [4, 4], gameplayFootprint: [3, 3], center: true } as SpriteDef,
}) as unknown as Placed;

const keys = (tiles: { tx: number; ty: number }[]) =>
  tiles.map((t) => `${t.tx},${t.ty}`).sort();

describe("issue #144 — front-road repaint band", () => {
  it("repaints the road beside the plant's SE/SW edges, never the reserved block", () => {
    const tiles = frontRoadTiles(factory(), mkWorld([[13, 10], [10, 13], [13, 13]]));
    const k = keys(tiles);
    expect(k).toContain("13,10");   // east edge of the 3×3 block
    expect(k).toContain("10,13");   // south edge
    expect(k).toContain("13,13");   // SE corner
  });

  it("repaints nothing inside the gameplay footprint", () => {
    const tiles = frontRoadTiles(factory(), mkWorld([[12, 11], [10, 10], [12, 12]]));
    expect(keys(tiles)).toEqual([]);
  });

  it("leaves the road behind the plant (NW) to normal occlusion", () => {
    const tiles = frontRoadTiles(factory(), mkWorld([[9, 9], [9, 10], [10, 9]]));
    expect(keys(tiles)).toEqual([]);
  });

  it("covers the widest authored overhang (two tiles) and no further", () => {
    const tiles = frontRoadTiles(factory(), mkWorld([[14, 10], [15, 10], [10, 14], [10, 15]]));
    const k = keys(tiles);
    expect(k).toContain("14,10");
    expect(k).toContain("10,14");
    expect(k).not.toContain("15,10");
    expect(k).not.toContain("10,15");
  });

  it("repaints dirt roads on the same band", () => {
    const tiles = frontRoadTiles(factory(), mkWorld([], [[13, 10]]));
    expect(tiles.map((t) => t.material)).toContain("dirt");
  });

  it("falls back to the draw footprint when no gameplay footprint is recorded", () => {
    // A 2×2 sprite whose draw footprint IS its gameplay footprint (no layer
    // installed): the band is its own block's SE/SW perimeter.
    const p = { tx: 5, ty: 5, def: { footprint: [2, 2] } as SpriteDef } as unknown as Placed;
    const tiles = frontRoadTiles(p, mkWorld([[7, 5], [5, 7], [8, 8], [9, 5]]));
    const k = keys(tiles);
    expect(k).toContain("7,5");    // east edge of the 2×2 block
    expect(k).toContain("5,7");    // south edge
    expect(k).toContain("8,8");    // two tiles out is still within reach
    expect(k).not.toContain("9,5"); // three tiles out is beyond any authored art
  });
});

describe("issue #144 — building layers keep the gameplay footprint", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("records the monolith footprint before overriding with the art's", async () => {
    const manifest: Manifest = JSON.parse(
      readFileSync("assets/iso-atlas/manifest.json", "utf8"),
    );
    const atlas = new Atlas(manifest);
    const played = [...atlas.get("factory")!.footprint];
    expect(played).toEqual([3, 3]);          // the Factory is PLAYED on 3×3

    // Simulate the compiled buildings manifest: authored 4×4 art.
    const body = { sprites: { factory: { footprint: [4, 4], anchor: [118, 86], w: 228, h: 144 } } };
    const png = new Blob(["stub"]);
    vi.stubGlobal("fetch", async (url: string) =>
      String(url).endsWith("manifest.json")
        ? new Response(JSON.stringify(body), { status: 200 })
        : new Response(png, { status: 200 }));
    vi.stubGlobal("createImageBitmap", async () => ({ width: 228, height: 144 }));

    const n = await loadBuildingLayers(atlas);
    expect(n).toBe(1);
    const def = atlas.get("factory")!;
    expect(def.footprint).toEqual([4, 4]);           // art footprint drives the draw
    expect(def.gameplayFootprint).toEqual([3, 3]);   // monolith kept for the roads
  });
});

describe("issue #144 — the renderer repaints the front road after the building", () => {
  const mkCtx = () => {
    const calls: string[] = [];
    const proxy = new Proxy({}, {
      get: (_t, prop) => {
        if (prop === "imageSmoothingEnabled") return false;
        if (typeof prop === "string") return (..._a: unknown[]) => { calls.push(prop); };
        return undefined;
      },
      set: () => true,
    });
    return { ctx: proxy as CanvasRenderingContext2D, calls };
  };

  const mkRenderer = (world: World, ctx: CanvasRenderingContext2D) => {
    const manifest: Manifest = JSON.parse(
      readFileSync("assets/iso-atlas/manifest.json", "utf8"),
    );
    // Simulate loadBuildingLayers: factory draws 4×4, played 3×3.
    const f = manifest.sprites.factory;
    f.footprint = [4, 4];
    f.gameplayFootprint = [3, 3];
    f.center = true;
    f.anchor = [118, 86];
    f.w = 228; f.h = 144;
    const atlas = new Atlas(manifest, new Map([[1, { width: 4096, height: 4096 }]]));
    const canvas = () => ({ getContext: () => ctx }) as unknown as HTMLCanvasElement;
    return new IsoRenderer(
      { terrain: canvas(), structures: canvas(), overlay: canvas() },
      atlas, centerOnMap(createCamera(800, 600)), world,
    );
  };

  it("strokes the road after blitting the plant (textured mode)", () => {
    const world = mkWorld([[75, 72]]);       // road on the plant's east edge
    world.extra = [{ sprite: "factory", tx: 72, ty: 72 }];
    const { ctx, calls } = mkCtx();
    const r = mkRenderer(world, ctx);
    r.setRoadMode("textured");
    r.drawStructures(0);
    const drew = calls.filter((c) => c === "drawImage").length;
    expect(drew).toBeGreaterThan(0);         // the plant (and map sprites) blit
    expect(calls).toContain("stroke");       // the repainted road
    expect(calls.indexOf("drawImage")).toBeLessThan(calls.lastIndexOf("stroke"));
    // The repaint switches the context into ground coordinates and back.
    expect(calls).toContain("setTransform");
    expect(calls.filter((c) => c === "save").length)
      .toBe(calls.filter((c) => c === "restore").length);
    // The road pass is strokes, not a sprite blit: the plant is the extra.
    expect(r.repaint.full).toBe(true);
  });

  it("does not repaint in sprite mode (roads are depth-sorted there already)", () => {
    const world = mkWorld([[75, 72]]);
    world.extra = [{ sprite: "factory", tx: 72, ty: 72 }];
    const { ctx, calls } = mkCtx();
    const r = mkRenderer(world, ctx);
    r.setRoadMode("sprites");
    r.drawStructures(0);
    expect(calls).not.toContain("setTransform");
  });
});
