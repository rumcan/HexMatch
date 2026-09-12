import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  DECAL_KINDS, FOREST_FOOTPRINT, FOREST_SPRITES, TREE_SPRITES,
  scatterScenery, paintDecals, waterDistance, type Decal,
} from "../../src/iso/scenery";
import { buildDrawList, type World } from "../../src/iso/renderer";
import { generateMap, WATER, SAND, idx } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";

const grid = generateMap(1234);
const scenery = scatterScenery(grid);

const plantedTiles = () => {
  const out: number[] = [];
  for (let i = 0; i < scenery.trees.length; i++) if (scenery.trees[i]) out.push(i);
  return out;
};

describe("scenery scatter", () => {
  it("is a pure function of the seed — same grid, same woodland", () => {
    const again = scatterScenery(generateMap(1234));
    expect(Array.from(again.trees)).toEqual(Array.from(scenery.trees));
    expect(again.decals).toEqual(scenery.decals);
  });

  it("gives different seeds different scenery", () => {
    const other = scatterScenery(generateMap(4321));
    expect(Array.from(other.trees)).not.toEqual(Array.from(scenery.trees));
  });

  it("plants trees and decals, but does not carpet the island", () => {
    const trees = plantedTiles();
    expect(trees.length).toBeGreaterThan(100);
    expect(scenery.decals.length).toBeGreaterThan(20);
    let land = 0;
    for (let i = 0; i < MAP_W * MAP_H; i++) if (grid.terrain[i] !== WATER) land++;
    // Decoration, not terrain: well under a tenth of the land.
    expect(trees.length).toBeLessThan(land * 0.1);
  });

  it("never puts a tree on water, sand, a town, an industry or a public road", () => {
    const publicRoad = new Set((grid.publicRoads ?? []).map(([x, y]) => idx(x, y)));
    for (const i of plantedTiles()) {
      expect(grid.terrain[i]).not.toBe(WATER);
      expect(grid.terrain[i]).not.toBe(SAND);
      expect(grid.occupancy[i]).toBe(-1);      // -2 town, >= 0 industry
      expect(publicRoad.has(i)).toBe(false);
    }
  });

  it("ships exactly the sprites the art tool cut — no drift either way", () => {
    const manifest = JSON.parse(readFileSync("assets/scenery/manifest.json", "utf8"));
    const all = [...TREE_SPRITES, ...FOREST_SPRITES];
    expect(Object.keys(manifest.sprites).sort()).toEqual([...all].sort());
    expect(new Set(all).size).toBe(all.length);
  });

  it("gives the forest blocks the footprint the engine places them on", () => {
    const manifest = JSON.parse(readFileSync("assets/scenery/manifest.json", "utf8"));
    for (const name of FOREST_SPRITES) {
      const def = manifest.sprites[name];
      expect(def).toBeTruthy();
      expect(def.footprint).toEqual([FOREST_FOOTPRINT, FOREST_FOOTPRINT]);
      expect(def.w % 2).toBe(0);
      expect(def.h % 2).toBe(0);
      // Centre-anchored: the anchor is the middle of the ground diamond, so
      // it sits inside the art and well above its bottom edge.
      const [ax, ay] = def.anchor;
      expect(ax).toBeGreaterThan(0);
      expect(ax).toBeLessThan(def.w);
      expect(ay).toBeGreaterThan(0);
      expect(ay).toBeLessThan(def.h);
    }
  });

  it("places forest blocks on clear ground, never overlapping", () => {
    expect(scenery.forests.length).toBeGreaterThan(0);
    const used = new Set<number>();
    for (const f of scenery.forests) {
      expect(FOREST_SPRITES).toContain(f.sprite);
      for (let dy = 0; dy < FOREST_FOOTPRINT; dy++) {
        for (let dx = 0; dx < FOREST_FOOTPRINT; dx++) {
          const i = idx(f.tx + dx, f.ty + dy);
          expect(grid.terrain[i]).not.toBe(WATER);
          expect(grid.terrain[i]).not.toBe(SAND);
          expect(grid.occupancy[i]).toBe(-1);
          expect(used.has(i)).toBe(false);   // no two blocks share a tile
          used.add(i);
          // and no 1×1 tree sprouts out of the middle of a painted wood
          expect(scenery.trees[i]).toBe(0);
        }
      }
    }
  });

  it("anchors every tree on the foot of its trunk, inside its own box", () => {
    const manifest = JSON.parse(readFileSync("assets/scenery/manifest.json", "utf8"));
    for (const name of TREE_SPRITES) {
      const def = manifest.sprites[name] as {
        footprint: number[]; anchor: number[]; w: number; h: number;
      };
      expect(def.footprint).toEqual([1, 1]);
      // Every zoom tier must be an exact division of the 1x box, or the
      // blit's round(w * zoom) source rect crops an edge.
      expect(def.w % 2).toBe(0);
      expect(def.h % 2).toBe(0);
      const [ax, ay] = def.anchor;
      expect(ax).toBeGreaterThanOrEqual(0);
      expect(ax).toBeLessThan(def.w);
      // The foot sits on the bottom row, not up in the canopy.
      expect(ay).toBeGreaterThan(def.h * 0.8);
      expect(ay).toBeLessThan(def.h);
      expect(name).toMatch(/^tree_[a-z]+_[a-d]$/);
    }
  });

  it("names only sprites the art actually ships", () => {
    const manifest = JSON.parse(readFileSync("assets/scenery/manifest.json", "utf8"));
    for (const name of TREE_SPRITES) expect(manifest.sprites[name]).toBeTruthy();
    for (const i of plantedTiles()) {
      expect(scenery.trees[i]).toBeGreaterThanOrEqual(1);
      expect(scenery.trees[i]).toBeLessThanOrEqual(TREE_SPRITES.length);
    }
  });

  it("clumps the trees instead of sprinkling them evenly", () => {
    // Density-independent clustering test. "Has at least ONE neighbour" stops
    // discriminating once the map is well planted — at this density a uniform
    // sprinkle would already hit ~0.39, and no statistic capped at 1.0 can be
    // three times that. So count trees with at least HALF their neighbourhood
    // occupied, which stays vanishingly rare under uniform sprinkling however
    // many trees there are, and compare against the exact binomial tail.
    const trees = plantedTiles();
    let land = 0;
    for (let i = 0; i < MAP_W * MAP_H; i++) if (grid.terrain[i] !== WATER) land++;

    let crowded = 0;
    for (const i of trees) {
      const tx = i % MAP_W, ty = (i / MAP_W) | 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = tx + dx, ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
          if (scenery.trees[ny * MAP_W + nx]) n++;
        }
      }
      if (n >= 4) crowded++;
    }
    const clustered = crowded / trees.length;

    // P(at least 4 of 8 neighbours occupied) for a uniform sprinkle.
    const p = trees.length / land;
    const choose = (n: number, k: number) => {
      let c = 1;
      for (let j = 0; j < k; j++) c = (c * (n - j)) / (j + 1);
      return c;
    };
    let uniform = 0;
    for (let k = 4; k <= 8; k++) uniform += choose(8, k) * p ** k * (1 - p) ** (8 - k);

    // Clumps are loose on purpose — a wood has gaps — so the absolute floor
    // is modest; the ratio is what actually proves the clustering. Measured
    // around 0.13 against a uniform expectation of 0.0007, i.e. ~190x.
    expect(clustered).toBeGreaterThan(0.08);
    expect(clustered).toBeGreaterThan(uniform * 20);
  });

  it("keeps every patch far enough inland that its rim cannot reach the sea", () => {
    const toWater = waterDistance(grid);
    for (const d of scenery.decals) {
      // The same reach the scatter uses: half the patch in tiles, plus slack.
      const reach = Math.ceil(d.w / 64 / 2) + 1;
      expect(toWater[idx(d.tx, d.ty)]).toBeGreaterThanOrEqual(reach);
    }
  });

  it("makes patches big — several tiles across, not stickers", () => {
    expect(scenery.decals.length).toBeGreaterThan(30);
    // A whole-island carpet of 950 small ovals was the thing this replaced.
    expect(scenery.decals.length).toBeLessThan(400);
    const widths = scenery.decals.map((d) => d.w);
    const mean = widths.reduce((a, b) => a + b, 0) / widths.length;
    expect(mean).toBeGreaterThan(64 * 3);      // over three tiles wide on average
    expect(Math.min(...widths)).toBeGreaterThan(64 * 2);
    expect(Math.max(...widths)).toBeLessThan(64 * 12);
  });

  it("paints bare earth under the grass moods, back to front", () => {
    const order = scenery.decals.map((d) => DECAL_KINDS.indexOf(d.kind));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (let i = 1; i < scenery.decals.length; i++) {
      const a = scenery.decals[i - 1], b = scenery.decals[i];
      if (a.kind !== b.kind) continue;
      expect(a.tx + a.ty).toBeLessThanOrEqual(b.tx + b.ty);
    }
  });

  it("gives every decal a family the art ships and a sane world box", () => {
    for (const d of scenery.decals) {
      expect(DECAL_KINDS).toContain(d.kind);
      expect(d.alpha).toBeGreaterThan(0);
      expect(d.alpha).toBeLessThanOrEqual(1);
      expect(typeof d.flip).toBe("boolean");
    }
  });
});

describe("scenery in the draw list", () => {
  const treeTile = plantedTiles()[0];
  const tx = treeTile % MAP_W, ty = (treeTile / MAP_W) | 0;
  const range = { x0: tx - 1, y0: ty - 1, x1: tx + 1, y1: ty + 1 };
  const base: World = { grid, trees: scenery.trees };
  const treesIn = (w: World) =>
    buildDrawList(w, range).filter((i) => i.sprite.startsWith("tree_"));

  it("draws the tree as a non-pickable decor item", () => {
    const items = treesIn(base);
    expect(items.length).toBeGreaterThan(0);
    const mine = items.find((i) => i.tx === tx && i.ty === ty);
    expect(mine).toBeTruthy();
    expect(mine!.decor).toBe(true);
    expect(TREE_SPRITES).toContain(mine!.sprite);
  });

  it("clears the tree when the tile is paved or gravelled", () => {
    for (const layer of ["roadBits", "dirtBits"] as const) {
      const bits = new Uint8Array(MAP_W * MAP_H);
      bits[treeTile] = 0b10000;
      const w: World = { ...base, [layer]: bits };
      expect(treesIn(w).some((i) => i.tx === tx && i.ty === ty)).toBe(false);
    }
  });

  it("clears the tree when the player builds on the tile", () => {
    const w: World = { ...base, sceneryBlocked: new Set([treeTile]) };
    expect(treesIn(w).some((i) => i.tx === tx && i.ty === ty)).toBe(false);
  });

  it("draws nothing at all when the world carries no trees", () => {
    expect(treesIn({ grid })).toHaveLength(0);
  });
});

describe("forest blocks in the draw list", () => {
  const forest = scatterScenery(grid).forests[0];
  const range = {
    x0: forest.tx - 1, y0: forest.ty - 1,
    x1: forest.tx + FOREST_FOOTPRINT, y1: forest.ty + FOREST_FOOTPRINT,
  };
  const base: World = { grid, forests: [forest] };
  const blocksIn = (w: World) =>
    buildDrawList(w, range).filter((i) => i.sprite.startsWith("forest_"));

  it("draws the block once, at its footprint origin, as decor", () => {
    const items = blocksIn(base);
    expect(items).toHaveLength(1);
    expect(items[0].tx).toBe(forest.tx);
    expect(items[0].ty).toBe(forest.ty);
    expect(items[0].decor).toBe(true);
  });

  it("clears the whole block when anything is built on ANY of its tiles", () => {
    // A half-erased painted wood would look far worse than a cleared one, so
    // one road tile anywhere inside takes the entire block down.
    for (let dy = 0; dy < FOREST_FOOTPRINT; dy++) {
      for (let dx = 0; dx < FOREST_FOOTPRINT; dx++) {
        const bits = new Uint8Array(MAP_W * MAP_H);
        bits[idx(forest.tx + dx, forest.ty + dy)] = 0b10000;
        expect(blocksIn({ ...base, roadBits: bits })).toHaveLength(0);
      }
    }
    const blocked = new Set([idx(forest.tx + 2, forest.ty + 1)]);
    expect(blocksIn({ ...base, sceneryBlocked: blocked })).toHaveLength(0);
  });

  it("leaves the block alone when the building is outside it", () => {
    const bits = new Uint8Array(MAP_W * MAP_H);
    bits[idx(forest.tx - 1, forest.ty)] = 0b10000;
    expect(blocksIn({ ...base, roadBits: bits })).toHaveLength(1);
  });
});

describe("paintDecals", () => {
  /** A context stub that records what was blitted. */
  function stubCtx() {
    const calls: { args: number[]; alpha: number }[] = [];
    const ctx = {
      globalAlpha: 1,
      // The flip path wraps its blit in save/translate/scale/restore, so the
      // stub has to model the transform well enough to prove the mirrored
      // patch still lands on the same box.
      tx: 0, ty: 0, sx: 1,
      saved: [] as { tx: number; ty: number; sx: number }[],
      save() { ctx.saved.push({ tx: ctx.tx, ty: ctx.ty, sx: ctx.sx }); },
      restore() { const p = ctx.saved.pop()!; ctx.tx = p.tx; ctx.ty = p.ty; ctx.sx = p.sx; },
      translate(x: number, y: number) { ctx.tx += x; ctx.ty += y; },
      scale(x: number) { ctx.sx *= x; },
      drawImage(_img: unknown, ...args: number[]) {
        const a = [...args];
        // Resolve back to page space so a mirrored blit and a plain one can
        // be compared as the same destination box.
        a[0] = ctx.sx < 0 ? ctx.tx - a[2] : a[0] + ctx.tx;
        a[1] += ctx.ty;
        calls.push({ args: a, alpha: (ctx as { globalAlpha: number }).globalAlpha });
      },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }
  const images = Object.fromEntries(
    DECAL_KINDS.map((k) => [k, [{ width: 256, height: 128 }]]),
  ) as Record<(typeof DECAL_KINDS)[number], { width: number; height: number }[]>;

  const decal: Decal = {
    tx: 40, ty: 40, kind: "bare", variant: 0,
    wx: 100, wy: 200, w: 96, alpha: 0.5, flip: false,
  };

  it("culls to the visible tile range, with a pad for the overhang", () => {
    const { ctx, calls } = stubCtx();
    const cam = { x: 0, y: 0, zoom: 1 };
    paintDecals(ctx, cam, [decal], images, { x0: 39, y0: 39, x1: 41, y1: 41 });
    expect(calls).toHaveLength(1);
    paintDecals(ctx, cam, [decal], images, { x0: 0, y0: 0, x1: 10, y1: 10 });
    expect(calls).toHaveLength(1);      // still one: the far decal was culled
  });

  it("draws 2:1 flat on the ground, centred, scaled by the zoom", () => {
    const { ctx, calls } = stubCtx();
    paintDecals(ctx, { x: 10, y: 20, zoom: 2 }, [decal], images,
      { x0: 39, y0: 39, x1: 41, y1: 41 });
    const [dx, dy, dw, dh] = calls[0].args;
    expect(dw).toBe(96 * 2);
    expect(dh).toBe(48 * 2);            // half the width: the iso squash
    expect(dx).toBe(Math.floor(100 * 2 + 10 - dw / 2));
    expect(dy).toBe(Math.floor(200 * 2 + 20 - dh / 2));
    expect(calls[0].alpha).toBe(0.5);
  });

  it("mirrors a flipped patch onto the same box", () => {
    const { ctx, calls } = stubCtx();
    const cam = { x: 10, y: 20, zoom: 2 };
    const range = { x0: 39, y0: 39, x1: 41, y1: 41 };
    paintDecals(ctx, cam, [decal], images, range);
    paintDecals(ctx, cam, [{ ...decal, flip: true }], images, range);
    expect(calls).toHaveLength(2);
    expect(calls[1].args.slice(0, 4)).toEqual(calls[0].args.slice(0, 4));
  });

  it("restores the context alpha it borrowed", () => {
    const { ctx, calls } = stubCtx();
    ctx.globalAlpha = 0.75;
    paintDecals(ctx, { x: 0, y: 0, zoom: 1 }, [decal], images,
      { x0: 39, y0: 39, x1: 41, y1: 41 });
    expect(calls).toHaveLength(1);
    expect(ctx.globalAlpha).toBe(0.75);
  });

  it("is a no-op when a family has no art loaded", () => {
    const { ctx, calls } = stubCtx();
    const empty = Object.fromEntries(DECAL_KINDS.map((k) => [k, []])) as typeof images;
    paintDecals(ctx, { x: 0, y: 0, zoom: 1 }, [decal], empty,
      { x0: 39, y0: 39, x1: 41, y1: 41 });
    expect(calls).toHaveLength(0);
  });
});
