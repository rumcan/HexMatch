import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Atlas, type Manifest } from "../../src/iso/atlas";
import {
  CHUNK, chunksX, chunkIndexOf, chunkSurfaceSize, chunkWorldOrigin,
  terrainSprite, buildDrawList, cullPad, flatPick,
} from "../../src/iso/renderer";
import { generateMap, WATER, ROUGH } from "../../src/iso/grid";
import { createCamera, centerOnMap, visibleTileRange } from "../../src/iso/camera";
import { MAP_W, MAP_H, HW, HH, TILE_H } from "../../src/game/config";

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

  it("emits each industry exactly once, at its origin", () => {
    const full = { x0: 0, y0: 0, x1: MAP_W - 1, y1: MAP_H - 1 };
    const list = buildDrawList({ grid }, full);
    const inds = list.filter((d) => d.ref && (d.ref as { kind?: string }).kind !== "town-house");
    expect(inds).toHaveLength(grid.industries.length);
    for (const d of inds) {
      const ind = d.ref as { tx: number; ty: number; type: string };
      expect([d.tx, d.ty, d.sprite]).toEqual([ind.tx, ind.ty, ind.type]);
      expect(atlas.has(d.sprite)).toBe(true);
    }
    // TK-005: town houses are emitted too, on their own tiles
    const houses = list.filter((d) => (d.ref as { kind?: string })?.kind === "town-house");
    expect(houses).toHaveLength(grid.towns.reduce((a, t) => a + t.houses.length, 0));
    for (const d of houses) expect(["house_a", "house_b"]).toContain(d.sprite);
  });

  it("culls industries outside the range but keeps footprint overlaps", () => {
    const ind = grid.industries[0];
    const tight = { x0: ind.tx + ind.w - 1, y0: ind.ty + ind.h - 1, x1: ind.tx + ind.w - 1, y1: ind.ty + ind.h - 1 };
    expect(buildDrawList({ grid }, tight).some((d) => d.ref === ind)).toBe(true);
    const far = { x0: 0, y0: 0, x1: 0, y1: 0 };
    const list = buildDrawList({ grid }, far);
    expect(list.length).toBeLessThan(grid.industries.length);
  });

  it("emits road/rail bitmask sprites that exist in the atlas", () => {
    const roadBits = new Uint8Array(MAP_W * MAP_H);
    const railBits = new Uint8Array(MAP_W * MAP_H);
    roadBits[10 * MAP_W + 10] = 0b0011;
    railBits[10 * MAP_W + 11] = 0b1010;
    const list = buildDrawList({ grid, roadBits, railBits }, { x0: 8, y0: 8, x1: 14, y1: 14 });
    const names = list.map((d) => d.sprite);
    expect(names).toContain("road_0011");
    expect(names).toContain("rail_1010");
    expect(names).not.toContain("crossing");
    for (const n of names) expect(atlas.has(n)).toBe(true);
  });

  it("G6: a tile carrying both layers draws a crossing overlay", () => {
    expect(atlas.has("crossing")).toBe(true);
    const roadBits = new Uint8Array(MAP_W * MAP_H);
    const railBits = new Uint8Array(MAP_W * MAP_H);
    roadBits[12 * MAP_W + 12] = 0b0101;
    railBits[12 * MAP_W + 12] = 0b1010;
    const list = buildDrawList({ grid, roadBits, railBits }, { x0: 12, y0: 12, x1: 12, y1: 12 });
    const names = list.map((d) => d.sprite);
    expect(names).toContain("road_0101");
    expect(names).toContain("rail_1010");
    expect(names).toContain("crossing");
  });

  it("draw list stays small under a viewport cull", () => {
    const cam = { ...centerOnMap(createCamera(800, 600)), zoom: 2 as const };
    const r = visibleTileRange(cam, cullPad(atlas));
    const roadBits = new Uint8Array(MAP_W * MAP_H).fill(0b1111);
    const culled = buildDrawList({ grid, roadBits }, r);
    const full = buildDrawList({ grid, roadBits }, { x0: 0, y0: 0, x1: MAP_W - 1, y1: MAP_H - 1 });
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
