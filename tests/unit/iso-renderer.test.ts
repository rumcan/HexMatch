import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Atlas, type AlphaMask, type Manifest } from "../../src/iso/atlas";
import { depthSort, place, pickSprite, type DrawItem } from "../../src/iso/depth";
import {
  CHUNK, chunksX, chunkIndexOf, chunkSurfaceSize, chunkWorldOrigin,
  terrainSprite, buildDrawList, cullPad, flatPick, resolveVariantSprite, variantSeed,
  GROUND_OVERLAP, shouldClipGroundSkirt, structureSkirtPoly,
} from "../../src/iso/renderer";
import { generateMap, WATER, ROUGH } from "../../src/iso/grid";
import { createCamera, centerOnMap, visibleTileRange } from "../../src/iso/camera";
import { MAP_W, MAP_H, HW, HH, TILE_H, TILE_W, BLOCK_H } from "../../src/game/config";

const manifest: Manifest = JSON.parse(
  readFileSync("assets/iso-atlas/manifest.json", "utf8"),
);
const atlas = new Atlas(manifest);
const grid = generateMap(1234);

describe("K4 chunking (4×4 — 132px tiles make 8×8 chunks expensive)", () => {
  it("maps tiles to 4×4 chunks", () => {
    expect(CHUNK).toBe(4);
    expect(chunkIndexOf(0, 0)).toBe(0);
    expect(chunkIndexOf(3, 3)).toBe(0);
    expect(chunkIndexOf(4, 0)).toBe(1);
    expect(chunkIndexOf(0, 4)).toBe(chunksX);
    expect(chunkIndexOf(MAP_W - 1, MAP_H - 1)).toBe(chunksX * Math.ceil(MAP_H / CHUNK) - 1);
  });

  it("G8/K4: chunk surface is large enough that no tile sprite clips", () => {
    const z = 1;
    const { w, h } = chunkSurfaceSize(z);
    const [ox, oy] = chunkWorldOrigin(0, 0);
    // Check the real overflow grass rect, not an assumed 132px tile. I5's
    // seam-safe sprite is deliberately 134px wide and must not be clipped by
    // the cache surface at either side.
    const grass = atlas.get("terrain_grass")!;
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const sx = (tx - ty) * HW, sy = (tx + ty) * HH;
        const left = sx - grass.anchor[0] - ox;
        const top = sy - grass.anchor[1] - oy;
        expect(left, `left edge of (${tx},${ty})`).toBeGreaterThanOrEqual(0);
        expect(left + grass.w, `right edge of (${tx},${ty})`).toBeLessThanOrEqual(w);
        expect(top, `top edge of (${tx},${ty})`).toBeGreaterThanOrEqual(0);
        expect(top + grass.h, `bottom edge of (${tx},${ty})`).toBeLessThanOrEqual(h);
      }
    }
    // Old flat-diamond size was 16*HW wide; the block geometry needs the
    // skirt too — pin the K4 pad.
    expect(w).toBe(2 * CHUNK * HW + TILE_W + 2 * GROUND_OVERLAP);
    expect(h).toBe(2 * CHUNK * HH + TILE_H + BLOCK_H + 2 * GROUND_OVERLAP);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Zoom source rects. The packer packs each sprite at `Math.round(w*z) ×
// Math.round(h*z)` placed at `Math.round(x*z), Math.round(y*z)`; the renderer
// must source those integer rects (via `Atlas.zoomRect`), not the raw 1× rect
// multiplied by z, or odd-sized sprites crop/shift at 0.5×.
// ══════════════════════════════════════════════════════════════════════════
describe("E4 zoomed atlas source rects", () => {
  it("zoomRect is the packer's integer rect, not the fractional 1× × z", () => {
    const farm = atlas.get("farm")!;
    const zr = atlas.zoomRect(farm, 0.5);
    expect(zr).toEqual({
      x: Math.round(farm.x * 0.5),
      y: Math.round(farm.y * 0.5),
      w: Math.round(farm.w * 0.5),
      h: Math.round(farm.h * 0.5),
    });
    // 133×127 at 0.5× would be 66.5×63.5 naively; the packed atlas holds
    // 67×64. The old fractional source rect dropped a half column/row.
    expect(zr.w).toBe(67);
    expect(zr.h).toBe(64);
    expect(farm.w * 0.5).toBe(66.5);
  });

  it("zoomRect round-trips integer dimensions at every shipped zoom", () => {
    for (const z of [0.5, 1, 2] as const) {
      for (const name of ["terrain_grass", "terrain_water", "road_0011", "farm", "highlight"]) {
        const s = atlas.get(name)!;
        const r = atlas.zoomRect(s, z);
        expect(Number.isInteger(r.x) && Number.isInteger(r.y) && Number.isInteger(r.w) && Number.isInteger(r.h), `${name}@${z}`)
          .toBe(true);
        // The actual zoomed atlas image contains the sprite at this rect.
        expect(r.w).toBe(Math.round(s.w * z));
        expect(r.h).toBe(Math.round(s.h * z));
      }
    }
  });

  it("zoomFrameRect(…, 0) equals zoomRect for single-frame sprites", () => {
    const farm = atlas.get("farm")!;
    expect(atlas.zoomFrameRect(farm, 0, 0.5)).toEqual(atlas.zoomRect(farm, 0.5));
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
    // The bound is computed from the manifest itself: largest footprint plus
    // the tallest sprite in half-tile rows (HH = 32 under Kenney geometry).
    const sprites = Object.values(atlas.manifest.sprites);
    const maxFoot = Math.max(...sprites.map((s) => Math.max(s.footprint[0], s.footprint[1])));
    const maxH = Math.max(...sprites.map((s) => s.h));
    expect(pad).toBe(maxFoot + Math.ceil(maxH / HH));
    expect(pad).toBeGreaterThanOrEqual(1 + Math.ceil(127 / HH));  // big factory
    expect(pad).toBeLessThan(40);
  });

  it("emits each industry exactly once, at its origin", () => {
    const full = { x0: 0, y0: 0, x1: MAP_W - 1, y1: MAP_H - 1 };
    const list = buildDrawList({ grid }, full);
    const inds = list.filter((d) => d.ref);
    expect(inds).toHaveLength(grid.industries.length);
    for (const d of inds) {
      const ind = d.ref as { tx: number; ty: number; type: string };
      expect([d.tx, d.ty, d.sprite]).toEqual([ind.tx, ind.ty, ind.type]);
      expect(atlas.has(d.sprite)).toBe(true);
    }
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

describe("I1 standing sprites are positioned, never clipped", () => {
  const inland = {
    ...grid,
    terrain: new Uint8Array(MAP_W * MAP_H),
  };

  it("clips inland ground overlays but never a standing sprite", () => {
    expect(shouldClipGroundSkirt(inland, atlas.get("road_0101")!, 10, 10)).toBe(true);
    expect(shouldClipGroundSkirt(inland, atlas.get("farm")!, 10, 10)).toBe(false);
    expect(shouldClipGroundSkirt(inland, atlas.get("factory_blue")!, 10, 10)).toBe(false);
  });

  it("the rule covers every shipped standing sprite, including composites", () => {
    const standing = Object.entries(manifest.sprites).filter(([, def]) => def.kind === "standing");
    expect(standing.length).toBeGreaterThan(10);
    for (const [name, def] of standing) {
      expect(shouldClipGroundSkirt(inland, def, 12, 12), name).toBe(false);
    }
  });

  it("I4 scales a ground clip once at every zoom and non-zero camera offset", () => {
    const p = place(atlas, { sprite: "road_0101", tx: 5, ty: 6 })!;
    const [wx, wy] = [
      (p.tx - p.ty) * HW,
      (p.tx + p.ty) * HH,
    ];
    for (const zoom of [0.5, 1, 2] as const) {
      const cam = { x: 137, y: -42, zoom, vw: 800, vh: 600 };
      const poly = structureSkirtPoly(p, cam);
      const cx = wx * zoom + cam.x, cy = wy * zoom + cam.y;
      expect(poly[2]).toEqual([Math.round(cx), Math.round(cy + HH * zoom)]);
      expect(poly[0][0]).toBe(Math.round(cx - HW * zoom));
      expect(poly[4][0]).toBe(Math.round(cx + HW * zoom));
    }
  });
});

describe("MB2 per-instance variants pick a stable preset per tile", () => {
  const variants = atlas.get("depot_blue")!.variants!;
  it("depot_blue carries a multi-entry pick-set in the shipped manifest", () => {
    expect(variants.length).toBeGreaterThan(1);
    for (const v of variants) expect(atlas.has(v), `${v} missing`).toBe(true);
  });

  it("the same tile always resolves to the same preset (no flicker)", () => {
    const a = resolveVariantSprite(atlas, "depot_blue", 7, 9);
    const b = resolveVariantSprite(atlas, "depot_blue", 7, 9);
    expect(a).toBe(b);
    expect(variants).toContain(a);
  });

  it("spreads across distinct presets over many tiles", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) seen.add(resolveVariantSprite(atlas, "depot_blue", i, i * 2 + 1));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("single-piece / single-composition sprites resolve to themselves", () => {
    expect(resolveVariantSprite(atlas, "farm", 3, 3)).toBe("farm");
    expect(resolveVariantSprite(atlas, "factory_blue", 3, 3)).toBe("factory_blue");
  });

  it("variantSeed is deterministic and small", () => {
    expect(variantSeed(3, 5)).toBe(variantSeed(3, 5));
    expect(variantSeed(0, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe("I2 flat pick — the exact inverse of the drawn diamond lattice", () => {
  // tileToScreen is the diamond CENTRE and flatPick directly inverts it. There
  // is no second top-vertex lattice and no HH cursor compensation.
  it("picks the tile whose visible diamond contains the point", () => {
    // tile (3,3): centre (0, 6*HH); drawn diamond spans y 6*HH−HH … 6*HH+HH
    expect(flatPick(0, 6 * HH)).toEqual([3, 3]);          // exact centre
    expect(flatPick(0, 6 * HH - HH + 1)).toEqual([3, 3]); // 1px inside the apex
    expect(flatPick(0, 6 * HH - HH - 1)).toEqual([2, 2]); // 1px above → tile behind
    expect(flatPick(0, 6 * HH + HH - 1)).toEqual([3, 3]); // 1px inside the S vertex
    expect(flatPick(0, 6 * HH + HH + 1)).toEqual([4, 4]); // 1px below → tile in front
  });

  it("floors, never rounds — no off-by-one band at diamond edges", () => {
    // near the top vertex of tile (0,0)'s drawn diamond (cursor y≈0 samples
    // the lattice at y≈HH, the centre row of pick cell (0,0))
    expect(flatPick(0.001, 0.001)).toEqual([0, 0]);
    expect(flatPick(-1, 0.001)).toEqual([0, 0]);
    // past the west edge of (0,0)'s diamond: lands in (0,1)'s pick cell
    expect(flatPick(-66, 0.001)).toEqual([0, 1]);
    // a hair left of tile (3,3)'s centre axis still picks (3,3); exactly on
    // its west vertex (shared with (3,4)'s apex and (2,3)'s south vertex) the
    // floor semantics assign the tile whose drawn top it is — (3,4).
    expect(flatPick(-1, 6 * HH)).toEqual([3, 3]);
    expect(flatPick(-65, 6 * HH)).toEqual([3, 3]);
    expect(flatPick(-66, 6 * HH)).toEqual([3, 4]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// K4 picking acceptance: "click a roof → selects that tile; click the
// block-side → still that tile." Built from synthetic sprites with the real
// Kenney geometry (terrain 132×83 anchor [66,33]; factory 132×133 anchor
// [66,59], base diamond at y≈93 with the block rising above it) so the maths
// is exercised without decoding real images in jsdom.
// ══════════════════════════════════════════════════════════════════════════
describe("K4 two-stage picking: roof and block-side clicks", () => {
  const HWt = 66, HHt = 32;
  const mkMask = (w: number, h: number, opaque: (x: number, y: number) => boolean): AlphaMask => {
    const bits = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      if (opaque(x, y)) bits[y * w + x] = 1;
    return { w, h, bits };
  };
  // terrain: visible top diamond centred on the widest row (y=33)
  const terrainOpaque = (x: number, y: number) =>
    Math.abs(x - 66) / 2 + Math.abs(y - 33) <= 33;
  // factory: the same base diamond at y=93 plus the block above it
  const factoryOpaque = (x: number, y: number) =>
    (Math.abs(x - 66) / 2 + Math.abs(y - 93) <= 33) || (y <= 93 && Math.abs(x - 66) <= 60);

  const synth = new Atlas({
    sprites: {
      terrain_grass: { x: 0, y: 0, w: 132, h: 83, footprint: [1, 1], anchor: [66, 33] },
      factory_blue: { x: 132, y: 0, w: 132, h: 133, footprint: [1, 1], anchor: [66, 59] },
    },
  } as unknown as Manifest);
  synth.setMask("terrain_grass", mkMask(132, 83, terrainOpaque));
  synth.setMask("factory_blue", mkMask(132, 133, factoryOpaque));

  // factory at (5,4) one row behind terrain at (5,5) — painter order back→front
  const items: DrawItem[] = [
    { sprite: "factory_blue", tx: 5, ty: 4 },
    { sprite: "terrain_grass", tx: 5, ty: 5 },
  ];
  const order = depthSort(items.map((i) => place(synth, i)!)).order;
  expect(order.map((p) => [p.tx, p.ty])).toEqual([[5, 4], [5, 5]]);

  // helper: click a sprite-LOCAL pixel of the factory (its placed origin)
  const f = order[0];
  const clickFactoryLocal = (lx: number, ly: number) => ({
    wx: f.wx + lx, wy: f.wy + ly,
    flat: flatPick(f.wx + lx, f.wy + ly),
    hit: pickSprite(synth, order, f.wx + lx, f.wy + ly),
  });

  it("a roof click selects the factory's own tile (not the tile behind it)", () => {
    // local (66,20): high on the block, far above the base diamond
    const c = clickFactoryLocal(66, 20);
    expect(synth.opaqueAt("factory_blue", 66, 20)).toBe(true);
    // the flat pass alone mis-attributs the roof to a tile BEHIND the factory
    expect(c.flat).not.toEqual([5, 4]);
    // the alpha pass returns the factory's tile — the tile whose top is clicked
    expect(c.hit?.tx).toBe(5);
    expect(c.hit?.ty).toBe(4);
    expect(c.hit?.sprite).toBe("factory_blue");
  });

  it("a block-side click overlapping the front tile still selects the factory", () => {
    // local (66,110): on the factory's base-diamond skirt — front of its own
    // pick cell, so the flat pass alone hands it to the tile in FRONT
    const c = clickFactoryLocal(66, 110);
    expect(synth.opaqueAt("factory_blue", 66, 110)).toBe(true);
    expect(c.flat).not.toEqual([5, 4]);
    expect(c.hit?.sprite).toBe("factory_blue");
    expect([c.hit?.tx, c.hit?.ty]).toEqual([5, 4]);
  });

  it("a click on the visible terrain diamond in front selects the terrain", () => {
    const t = order[1];
    const wx = t.wx + 30, wy = t.wy + 30;
    expect(synth.opaqueAt("terrain_grass", 30, 30)).toBe(true);
    expect(flatPick(wx, wy)).toEqual([5, 5]);
    const hit = pickSprite(synth, order, wx, wy);
    expect(hit?.sprite).toBe("terrain_grass");
    expect([hit?.tx, hit?.ty]).toEqual([5, 5]);
  });

  it("front-to-back order means the terrain occludes the factory's buried pixels", () => {
    // factory-local (30,108) is on the factory's base-diamond front skirt AND
    // inside the front tile's diamond — a pixel both sprites cover. The
    // terrain is drawn in front, so it must win the pick.
    const wx = f.wx + 30, wy = f.wy + 108;
    expect(synth.opaqueAt("factory_blue", 30, 108)).toBe(true);
    const t = order[1];
    const tlx = Math.floor(wx - t.wx), tly = Math.floor(wy - t.wy);
    expect(synth.opaqueAt("terrain_grass", tlx, tly)).toBe(true);
    const hit = pickSprite(synth, order, wx, wy);
    expect(hit?.sprite).toBe("terrain_grass");
    expect([hit?.tx, hit?.ty]).toEqual([5, 5]);
  });
});
