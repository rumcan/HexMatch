import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Atlas, type Manifest } from "../../src/iso/atlas";
import {
  CHUNK, chunksX, chunkIndexOf, chunkSurfaceSize, chunkWorldOrigin,
  terrainSprite, buildDrawList, cullPad, flatPick, IsoRenderer,
} from "../../src/iso/renderer";
import { generateMap, WATER, ROUGH } from "../../src/iso/grid";
import { createCamera, centerOnMap, visibleTileRange } from "../../src/iso/camera";
import { MAP_W, MAP_H, HW, HH, TILE_H } from "../../src/game/config";
import { INDUSTRY_BY_KEY } from "../../src/iso/config";

const manifest: Manifest = JSON.parse(
  readFileSync("assets/iso-atlas/manifest.json", "utf8"),
);
const atlas = new Atlas(manifest);
const grid = generateMap(1234);

describe("E4 chunking", () => {
  it("maps tiles to 8×8 chunks", () => {
    expect(CHUNK).toBe(8);
    expect(chunkIndexOf(0, 0)).toBe(0);
    expect(chunkIndexOf(7, 7)).toBe(0);
    expect(chunkIndexOf(8, 0)).toBe(1);
    expect(chunkIndexOf(0, 8)).toBe(chunksX);
    expect(chunkIndexOf(MAP_W - 1, MAP_H - 1)).toBe(chunksX * Math.ceil(MAP_H / CHUNK) - 1);
  });

  it("G8: chunk surface is large enough that the rightmost tile sprite is not clipped", () => {
    const z = 1;
    const { w, h } = chunkSurfaceSize(z);
    const [ox, oy] = chunkWorldOrigin(0, 0);
    // rightmost tile in chunk (0,0) is (7, 0); 1×1 terrain anchor is [32, 31]
    const wx = (7 - 0) * HW + HW - 32;
    const wy = (7 + 0) * HH + TILE_H - 31;
    const drawX = wx - ox, drawY = wy - oy;
    expect(drawX + 64).toBeLessThanOrEqual(w);
    expect(drawY + 32).toBeLessThanOrEqual(h);
    // Old size was 16*HW = 512, which clipped the last 32px. Pin the pad.
    expect(w).toBeGreaterThan(512);
  });
});

describe("E4 terrain sprite selection", () => {
  it("uses a sprite that exists for every tile of a generated map", () => {
    const seen = new Set<string>();
    for (let ty = 0; ty < MAP_H; ty++)
      for (let tx = 0; tx < MAP_W; tx++) seen.add(terrainSprite(grid, tx, ty));
    for (const name of seen) expect(atlas.has(name)).toBe(true);
  });

  it("is deterministic and terrain-driven", () => {
    const i = 20 * MAP_W + 20;
    const g2 = { ...grid, terrain: Uint8Array.from(grid.terrain) };
    g2.terrain[i] = WATER;
    expect(terrainSprite(g2, 20, 20)).toBe("terrain_water");
    g2.terrain[i] = ROUGH;
    expect(terrainSprite(g2, 20, 20)).toBe("terrain_rough");
    expect(terrainSprite(grid, 5, 6)).toBe(terrainSprite(grid, 5, 6));
  });

  it("Y2: a GRASS tile always maps to the single flat grass tile (no slope variant)", () => {
    // Every tile of an all-grass map selects the one declared flat grass
    // sprite. The old ~1-in-8 `terrain_grass_b` was a slope sprite drawn on
    // flat ground — the source of the "weird triangles".
    const flat = { ...grid, terrain: new Uint8Array(MAP_W * MAP_H) }; // all GRASS
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        expect(terrainSprite(flat, tx, ty)).toBe("terrain_grass");
      }
    }
    expect(atlas.has("terrain_grass")).toBe(true);
    expect(atlas.has("terrain_grass_b")).toBe(false);
  });
});

describe("E4 culling + draw list", () => {
  it("pads by the largest footprint plus sprite height in tiles", () => {
    const pad = cullPad(atlas);
    // Y3/Y7 shrank the buildings from stitched 192px compose blocks to single
    // declared sprites, so the bound is computed from the manifest itself:
    // largest footprint + tallest sprite in half-tile rows.
    const sprites = Object.values(atlas.manifest.sprites);
    const maxFoot = Math.max(...sprites.map((s) => Math.max(s.footprint[0], s.footprint[1])));
    const maxH = Math.max(...sprites.map((s) => s.h));
    expect(pad).toBe(maxFoot + Math.ceil(maxH / 16));
    expect(pad).toBeGreaterThanOrEqual(3 + 3);  // 3×3 mine + declared building headroom
    expect(pad).toBeLessThan(40);
  });

  it("emits one single-sprite item per industry (PP-12)", () => {
    const full = { x0: 0, y0: 0, x1: MAP_W - 1, y1: MAP_H - 1 };
    const list = buildDrawList({ grid }, full);
    const inds = list.filter((d) => d.ref);
    // every industry contributes exactly one item: its own key as the sprite,
    // drawn at the footprint origin, with the manifest footprint matching the
    // industry footprint (both derive from the art).
    for (const ind of grid.industries) {
      const mine = inds.filter((d) => d.ref === ind);
      expect(mine.length, ind.type).toBe(1);
      expect(mine[0].sprite, ind.type).toBe(ind.type);
      expect([mine[0].tx, mine[0].ty], ind.type).toEqual([ind.tx, ind.ty]);
      expect(atlas.has(mine[0].sprite)).toBe(true);
      expect(atlas.get(mine[0].sprite)!.footprint, ind.type).toEqual([ind.w, ind.h]);
      expect([ind.w, ind.h], ind.type).toEqual(INDUSTRY_BY_KEY[ind.type].footprint);
    }
  });

  it("culls industries outside the range but keeps footprint overlaps", () => {
    const ind = grid.industries[0];
    // a range covering only the origin tile still draws the whole complex…
    const tight = { x0: ind.tx, y0: ind.ty, x1: ind.tx, y1: ind.ty };
    expect(buildDrawList({ grid }, tight).some((d) => d.ref === ind)).toBe(true);
    // …as does a range covering only the far corner of its footprint…
    const corner = {
      x0: ind.tx + ind.w - 1, y0: ind.ty + ind.h - 1,
      x1: ind.tx + ind.w - 1, y1: ind.ty + ind.h - 1,
    };
    expect(buildDrawList({ grid }, corner).some((d) => d.ref === ind)).toBe(true);
    // …while a far-away tile draws none of it.
    const far = { x0: 0, y0: 0, x1: 0, y1: 0 };
    const list = buildDrawList({ grid }, far);
    expect(list.length).toBeLessThan(grid.industries.length);
  });

  it("emits dirt/road bitmask sprites that exist in the atlas", () => {
    const dirtBits = new Uint8Array(MAP_W * MAP_H);
    const roadBits = new Uint8Array(MAP_W * MAP_H);
    dirtBits[10 * MAP_W + 10] = 0b0011;
    roadBits[10 * MAP_W + 11] = 0b1010;
    const list = buildDrawList({ grid, dirtBits, roadBits }, { x0: 8, y0: 8, x1: 14, y1: 14 });
    const names = list.map((d) => d.sprite);
    expect(names).toContain("dirt_0011");
    expect(names).toContain("road_1010");
    for (const n of names) expect(atlas.has(n)).toBe(true);
  });

  it("G6: a tile never draws both tiers — paving replaces, not overlays", () => {
    // The old level-crossing overlay is gone: dirt and road are two tiers of
    // the SAME kind, so one tile carries exactly one of them. If a renderer
    // call ever receives both bits set on one tile (a bug — paving clears the
    // gravel layer) we must NOT emit two sprites or any `crossing` overlay.
    expect(atlas.has("crossing")).toBe(false);
    const dirtBits = new Uint8Array(MAP_W * MAP_H);
    const roadBits = new Uint8Array(MAP_W * MAP_H);
    // A correct map never sets both, so two adjacent single-tier tiles render
    // their own tier and nothing else.
    dirtBits[12 * MAP_W + 12] = 0b0101;
    roadBits[12 * MAP_W + 11] = 0b1010;
    const list = buildDrawList({ grid, dirtBits, roadBits }, { x0: 11, y0: 12, x1: 12, y1: 12 });
    const names = list.map((d) => d.sprite);
    expect(names).toContain("dirt_0101");
    expect(names).toContain("road_1010");
    expect(names).not.toContain("crossing");
  });

  it("a gravel tile whose edge meets pavement draws the dirt_road_* seam", () => {
    // Dirt at (10,10) faces NE where a PAVED tile (10,9) faces back. Instead
    // of a bare dirt_0001 stub the tile draws dirt_road_2000 — edge-state
    // chars in NE,SE,SW,NW order, '2' on the paved edge — whose tar bleeds
    // out to match the neighbouring tar tile.
    const dirtBits = new Uint8Array(MAP_W * MAP_H);
    const roadBits = new Uint8Array(MAP_W * MAP_H);
    dirtBits[10 * MAP_W + 10] = 0b10001;              // PRESENT | NE
    roadBits[9 * MAP_W + 10] = 0b10100;               // PRESENT | SW
    const names = buildDrawList(
      { grid, dirtBits, roadBits }, { x0: 9, y0: 8, x1: 11, y1: 11 },
    ).map((d) => d.sprite);
    expect(names).toContain("dirt_road_2000");
    expect(names).not.toContain("dirt_0001");         // the bare stub is gone
    expect(names).toContain("road_0100");             // the paved tile, unmoved
    for (const n of names) expect(atlas.has(n), n).toBe(true);
    expect(names).not.toContain("crossing");
  });

  it("maps each paved edge to its state char, in NE,SE,SW,NW order", () => {
    // A 4-arm dirt tile with ONLY the SE neighbour paved (the other arms are
    // real gravel) must render dirt_road_1211, one sprite, no `crossing`.
    const dirtBits = new Uint8Array(MAP_W * MAP_H);
    const roadBits = new Uint8Array(MAP_W * MAP_H);
    const T = 20 * MAP_W + 20;
    dirtBits[T] = 0b11111;                            // PRESENT | 4 arms
    dirtBits[19 * MAP_W + 20] = 0b10100;              // NE neighbour (gravel, faces back SW)
    roadBits[20 * MAP_W + 21] = 0b11000;              // SE neighbour PAVED, faces back NW
    dirtBits[21 * MAP_W + 20] = 0b10001;              // SW neighbour (gravel, faces back NE)
    dirtBits[20 * MAP_W + 19] = 0b10010;              // NW neighbour (gravel, faces back SE)
    const names = buildDrawList(
      { grid, dirtBits, roadBits }, { x0: 19, y0: 19, x1: 21, y1: 21 },
    ).map((d) => d.sprite);
    expect(names).toContain("dirt_road_1211");
    expect(names.filter((n) => n.startsWith("dirt_"))).toHaveLength(4);   // one per tile
    for (const n of names) expect(atlas.has(n), n).toBe(true);
    expect(names).not.toContain("crossing");
  });

  it("gravel that never touches pavement keeps drawing plain dirt_* stubs", () => {
    const dirtBits = new Uint8Array(MAP_W * MAP_H);
    dirtBits[12 * MAP_W + 12] = 0b10001;              // dirt at (12,12) faces NE
    dirtBits[11 * MAP_W + 12] = 0b10100;              // dirt at (12,11) faces back SW
    const names = buildDrawList(
      { grid, dirtBits }, { x0: 11, y0: 11, x1: 13, y1: 13 },
    ).map((d) => d.sprite);
    expect(names).toContain("dirt_0001");
    expect(names.some((n) => n.startsWith("dirt_road_"))).toBe(false);
  });

  it("draw list stays small under a viewport cull", () => {
    const cam = { ...centerOnMap(createCamera(800, 600)), zoom: 2 as const };
    const r = visibleTileRange(cam, cullPad(atlas));
    const dirtBits = new Uint8Array(MAP_W * MAP_H).fill(0b1111);
    const culled = buildDrawList({ grid, dirtBits }, r);
    const full = buildDrawList({ grid, dirtBits }, { x0: 0, y0: 0, x1: MAP_W - 1, y1: MAP_H - 1 });
    expect(culled.length).toBeLessThan(full.length);
  });
});

describe("E4 flat pick", () => {
  it("floors, never rounds — no off-by-one band at diamond edges", () => {
    // x=0 on the vertical axis at y just past tile (3,3)'s top vertex
    expect(flatPick(0, 32 * 3 + 1)).toEqual([3, 3]);
    // a hair to the left of that axis falls in the SW neighbour, not (3,3)
    expect(flatPick(-1, 32 * 3 + 1)).toEqual([3, 3]);
    expect(flatPick(-31, 32 * 3 + 1)).toEqual([2, 3]);
    expect(flatPick(0.001, 0.001)).toEqual([0, 0]);
    expect(flatPick(-1, 0.001)).toEqual([-1, 0]);
  });
});

// ── B-3.2: the cull pad must follow late building-layer installs ──────────
// The constructor caches `cullPad(atlas)` once, but `loadBuildingLayers()`
// resolves AFTER `new IsoRenderer(...)` (game.ts fires it before the renderer
// exists) and mutates the covered sprites' defs — so a building PNG taller
// than the tallest sheet sprite would cull at the screen edge until a
// recompute. `renderer.recomputePad()` is that recompute.
describe("B-3.2 cull pad follows building-layer installs", () => {
  const fakeCanvas = () =>
    ({ getContext: () => ({ imageSmoothingEnabled: false }) }) as unknown as HTMLCanvasElement;

  function makeRenderer() {
    const manifest: Manifest = JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8"));
    const atlas = new Atlas(manifest);
    const renderer = new IsoRenderer(
      { terrain: fakeCanvas(), structures: fakeCanvas(), overlay: fakeCanvas() },
      atlas, createCamera(), { grid: generateMap(1234) },
    );
    return { renderer, atlas };
  }

  it("caches the pad at construction; recomputePad() follows a mutated def", () => {
    const { renderer, atlas } = makeRenderer();
    const before = renderer.cullPadNow;
    expect(before).toBe(cullPad(atlas));

    // simulate loadBuildingLayers() installing a taller per-building PNG
    const def = atlas.manifest.sprites.oil_rig;
    def.w = def.h = 500;
    expect(renderer.cullPadNow).toBe(before);        // stale until told
    renderer.recomputePad();
    expect(renderer.cullPadNow).toBe(cullPad(atlas));
    expect(renderer.cullPadNow).toBeGreaterThan(before);
  });
});
