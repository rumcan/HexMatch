import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  DECAL_INK, DECAL_KINDS, DECAL_PAD_MAX, DECAL_PAD_MIN, DECAL_SHORE_PAD,
  FOREST_FOOTPRINT, FOREST_SPRITES, TREE_SPRITES,
  coastClearance, decalReach, decalsOverlap, groundOf,
  scatterScenery, paintDecals, type Decal,
} from "../../src/iso/scenery";
import { buildDrawList, type World } from "../../src/iso/renderer";
import { generateMap, WATER, SAND, chebyshevField, idx } from "../../src/iso/grid";
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

  it("FOREST-01: grows pine clusters around every lumber (forest) industry", () => {
    const lumber = grid.industries.filter((i) => i.type === "forest");
    expect(lumber.length).toBeGreaterThan(0);
    const isPine = (i: number) => TREE_SPRITES[scenery.trees[i] - 1]?.startsWith("tree_pine");
    for (const ind of lumber) {
      const cx = ind.tx + (ind.w - 1) / 2, cy = ind.ty + (ind.h - 1) / 2;
      const reach = Math.max(ind.w, ind.h) / 2 + 9;
      let pines = 0;
      for (let y = Math.floor(cy - reach); y <= Math.ceil(cy + reach); y++) {
        for (let x = Math.floor(cx - reach); x <= Math.ceil(cx + reach); x++) {
          if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
          if (isPine(idx(x, y))) pines++;
        }
      }
      // a real stand, not a stray pine or two
      expect(pines, `pines around forest industry at ${ind.tx},${ind.ty}`).toBeGreaterThanOrEqual(8);
    }
  });

  it("FOREST-01: sets a painted conifer wood right beside every Forest resource", () => {
    const woods = grid.industries.filter((i) => i.type === "forest");
    expect(woods.length).toBeGreaterThan(0);
    const c = (FOREST_FOOTPRINT - 1) / 2;
    for (const ind of woods) {
      const cx = ind.tx + (ind.w - 1) / 2, cy = ind.ty + (ind.h - 1) / 2;
      // block centre within the placement ring (footprint half + block half +
      // 1 + slack) plus a tile of rounding
      const reach = Math.max(ind.w, ind.h) / 2 + c + 1 + 3 + 1.5;
      const beside = scenery.forests.some((f) => f.sprite === "forest_conifer"
        && Math.hypot(f.tx + c - cx, f.ty + c - cy) <= reach);
      expect(beside, `conifer block beside forest at ${ind.tx},${ind.ty}`).toBe(true);
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

  it("keeps every patch's ink, its padding and clear grass off the shoreline", () => {
    const clear = coastClearance(grid);
    for (const d of scenery.decals) {
      // `reach` is the scatter's cache of the turned box's tile radius —
      // recomputed here, so the cache and the formula cannot drift apart.
      expect(d.reach).toBeCloseTo(decalReach(d.w, d.rot), 10);
      // The ink box, this patch's own padding, and a fixed margin of clear
      // grass between the two and the sea, all measured in tile boxes because
      // the footprint is a box.
      expect(clear[idx(d.tx, d.ty)], `patch at ${d.tx},${d.ty}`)
        .toBeGreaterThanOrEqual(d.reach + d.pad + DECAL_SHORE_PAD);
    }
  });

  it("measures the coast in tile BOXES: the two-pass transform is the BFS answer", () => {
    // The transform is a shortcut, and a shortcut that quietly disagrees with
    // the obvious BFS would under-protect exactly the corner a turned patch
    // reaches farthest. Same sources, same metric, same field.
    const clear = coastClearance(grid);
    const sea: number[] = [];
    for (let i = 0; i < MAP_W * MAP_H; i++) if (grid.terrain[i] === WATER) sea.push(i);
    for (let x = 0; x < MAP_W; x++) sea.push(idx(x, 0), idx(x, MAP_H - 1));
    for (let y = 0; y < MAP_H; y++) sea.push(idx(0, y), idx(MAP_W - 1, y));
    const bfs = chebyshevField(sea);
    let mismatch = -1;
    for (let i = 0; i < clear.length; i++) if (clear[i] !== bfs[i]) { mismatch = i; break; }
    expect(mismatch, `tile ${mismatch % MAP_W},${(mismatch / MAP_W) | 0} disagrees`).toBe(-1);
  });

  it("gives every patch ground no other patch's ink reaches", () => {
    // Checked from OUTSIDE the placement: `decalsOverlap` is the rule the
    // scatter applies, this is the geometry that rule stands for — a lattice
    // sampled across one patch's reserved ground, tested against another's.
    // The art covers a ground square TURNED 45° to the tile grid (a `w × w/2`
    // screen rect inverts to the diamond |dx| + |dy| ≤ w / 64), so its half-side
    // is w / 64 / √2 and its own axes sit at rot + 45°.
    const ink = (d: Decal) => {
      const [gx, gy] = groundOf(d.wx, d.wy);
      const a = d.rot + Math.PI / 4;
      return {
        gx, gy, pad: d.pad,
        h: (d.w / 64 / Math.SQRT2) * DECAL_INK,
        cos: Math.cos(a), sin: Math.sin(a),
      };
    };
    type Ink = ReturnType<typeof ink>;
    /** Distance from a ground point to r's ink square (0 inside it). */
    const distTo = (r: Ink, px: number, py: number) => {
      const dx = px - r.gx, dy = py - r.gy;
      // into the patch's own frame: its two turned axes
      const u = dx * r.cos + dy * r.sin, v = -dx * r.sin + dy * r.cos;
      return Math.hypot(
        u - Math.max(-r.h, Math.min(r.h, u)),
        v - Math.max(-r.h, Math.min(r.h, v)),
      );
    };
    // For every pair: the clear ground between the two inks must be at least
    // the SUM of their paddings — each patch contributes its own.
    const clash = (list: Decal[]) => {
      for (let a = 0; a < list.length; a++) {
        const ra = ink(list[a]!);
        for (let b = a + 1; b < list.length; b++) {
          const rb = ink(list[b]!);
          const dx = rb.gx - ra.gx, dy = rb.gy - ra.gy;
          const wide = (ra.h + rb.h) * Math.SQRT2 + ra.pad + rb.pad;
          if (dx * dx + dy * dy > wide * wide) continue;
          for (let sy = -3; sy <= 3; sy++) {
            for (let sx = -3; sx <= 3; sx++) {
              const u = (sx / 3) * ra.h, v = (sy / 3) * ra.h;
              const gap = distTo(rb, ra.gx + u * ra.cos - v * ra.sin,
                ra.gy + u * ra.sin + v * ra.cos);
              if (gap < ra.pad + rb.pad - 1e-9)
                return `patch ${a} sits ${gap.toFixed(2)} tiles off patch ${b}, `
                  + `which owes ${(ra.pad + rb.pad).toFixed(2)}`;
            }
          }
        }
      }
      return "";
    };
    expect(clash(scenery.decals)).toBe("");
    // Not vacuous: drop one patch onto another's centre and the same check
    // says so.
    const [p, q] = scenery.decals;
    expect(clash([p!, { ...q!, wx: p!.wx, wy: p!.wy }])).not.toBe("");
    // And the rule the scatter uses agrees with the sampling on real output.
    for (let a = 0; a < scenery.decals.length; a++)
      for (let b = a + 1; b < scenery.decals.length; b++)
        expect(decalsOverlap(scenery.decals[a]!, scenery.decals[b]!)).toBe(false);
  });

  it("gives every patch its own turn, spread over the whole circle", () => {
    const d = scenery.decals;
    for (const x of d) {
      expect(x.rot).toBeGreaterThanOrEqual(0);
      expect(x.rot).toBeLessThan(Math.PI * 2);
    }
    // Every eighth of the circle is used and no eighth holds a quarter of the
    // patches: the art ships three cut angles per family, so a layout that
    // leaned on a few angles would be a layout of repeated shapes.
    const sectors = new Array(8).fill(0) as number[];
    for (const x of d) sectors[Math.min(7, Math.floor(x.rot / (Math.PI / 4)))]++;
    expect(Math.min(...sectors)).toBeGreaterThan(0);
    expect(Math.max(...sectors)).toBeLessThan(d.length / 4);
    expect(new Set(d.map((x) => x.rot)).size).toBe(d.length);
  });

  it("gives every patch its own padding, and the band is actually used", () => {
    const d = scenery.decals;
    const pads = d.map((x) => x.pad);
    for (const p of pads) {
      expect(p).toBeGreaterThanOrEqual(DECAL_PAD_MIN);
      expect(p).toBeLessThanOrEqual(DECAL_PAD_MAX);
    }
    expect(Math.min(...pads)).toBeLessThan(DECAL_PAD_MIN + 0.2);
    expect(Math.max(...pads)).toBeGreaterThan(DECAL_PAD_MAX - 0.2);
    expect(new Set(pads).size).toBe(d.length);
    // Individual padding has to change the LAYOUT, not just the numbers: one
    // shared margin would put every neighbour pair the same distance apart.
    // Nearest-neighbour gaps, in tiles, run from a tight pair to a lonely one.
    const gaps = d.map((x, i) => {
      const [gx, gy] = groundOf(x.wx, x.wy);
      let best = Infinity;
      for (let j = 0; j < d.length; j++) {
        if (j === i) continue;
        const [ox, oy] = groundOf(d[j]!.wx, d[j]!.wy);
        const dist = Math.hypot(ox - gx, oy - gy);
        if (dist < best) best = dist;
      }
      return best;
    });
    expect(Math.min(...gaps)).toBeGreaterThan(2);            // nothing is touching
    expect(Math.max(...gaps)).toBeGreaterThan(Math.min(...gaps) * 1.5);
  });

  it("puts one patch on one tile, at a random point inside it", () => {
    const d = scenery.decals;
    // Two patches sharing a tile was the old clustering: pick a tile, nudge it
    // by less than a patch, and the pair reads as one clump. The exclusion
    // rule is wider than a tile, so this now follows from the placement —
    // asserted because it is the point of the rewrite.
    expect(new Set(d.map((x) => idx(x.tx, x.ty))).size).toBe(d.length);
    for (const x of d) {
      const [gx, gy] = groundOf(x.wx, x.wy);
      // a real ground point inside the tile the patch is filed under …
      expect(Math.abs(gx - x.tx)).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(Math.abs(gy - x.ty)).toBeLessThanOrEqual(0.5 + 1e-9);
      // … and never the tile centre: nothing sits on the lattice
      expect(Number.isInteger(gx) && Number.isInteger(gy)).toBe(false);
    }
  });

  it("keeps patches inside the size band the texture can actually cover", () => {
    // The band matters in both directions. Too small and the ground goes back
    // to looking speckled; too LARGE and a 768px texture is stretched across
    // more screen than it has pixels for, which is what made the patches
    // visibly soft at the 2x camera. Roughly 1.75 to 4.75 tiles.
    expect(scenery.decals.length).toBeGreaterThan(200);
    expect(scenery.decals.length).toBeLessThan(900);
    const widths = scenery.decals.map((d) => d.w);
    const mean = widths.reduce((a, b) => a + b, 0) / widths.length;
    expect(mean).toBeGreaterThan(64 * 1.5);
    expect(mean).toBeLessThan(64 * 4);
    expect(Math.min(...widths)).toBeGreaterThan(64);
    expect(Math.max(...widths)).toBeLessThan(64 * 5.5);
  });

  it("paints back to front, with the families interleaved instead of batched", () => {
    const d = scenery.decals;
    for (let i = 1; i < d.length; i++) {
      expect(d[i - 1]!.tx + d[i - 1]!.ty).toBeLessThanOrEqual(d[i]!.tx + d[i]!.ty);
    }
    // Batching the families was there to arbitrate overlaps — bare earth down
    // first, the grass moods over it. Nothing overlaps any more, so the moods
    // run through the list in depth order: a "run" is a change of family, and
    // a batched list would have four of them.
    const runs = d.filter((x, i) => i === 0 || x.kind !== d[i - 1]!.kind).length;
    expect(runs).toBeGreaterThan(d.length * 0.5);
  });

  it("gives every decal a family the art ships and a sane world box", () => {
    for (const d of scenery.decals) {
      expect(DECAL_KINDS).toContain(d.kind);
      expect(d.alpha).toBeGreaterThan(0);
      expect(d.alpha).toBeLessThanOrEqual(1);
      expect(typeof d.flip).toBe("boolean");
      expect(Number.isFinite(d.rot)).toBe(true);
      expect(Number.isFinite(d.pad)).toBe(true);
      // The cull radius has to cover the turned ground square, or big patches
      // pop in at the screen edge: tip to tip the square reaches w / 64 tiles
      // on each ground axis at rot 0, and w / 64 / √2 when it sits flush with
      // the tile grid at 45°.
      expect(d.reach).toBeGreaterThanOrEqual((d.w / 64) / Math.SQRT2);
      expect(d.reach).toBeLessThanOrEqual(d.w / 64 + 1);
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

  it.skip("clears the tree when the tile is paved or gravelled", () => {
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
  /** A canvas transform, as [a, b, c, d, e, f]: x' = a·x + c·y + e. */
  type Matrix = [number, number, number, number, number, number];

  /**
   * A context stub that carries a REAL affine transform, the way canvas does,
   * and resolves each blit's destination rect to page-space corners. A turned
   * or mirrored patch is then checked against the GROUND it should cover, not
   * against the numbers the implementation happened to pass.
   */
  function stubCtx() {
    const mul = (p: Matrix, q: Matrix): Matrix => [
      p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1],
      p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
      p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5],
    ];
    const calls: { box: number[]; corners: [number, number][]; alpha: number }[] = [];
    let m: Matrix = [1, 0, 0, 1, 0, 0];
    let alpha = 1;
    const stack: { m: Matrix; alpha: number }[] = [];
    const at = (x: number, y: number): [number, number] =>
      [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const ctx = {
      get globalAlpha() { return alpha; },
      set globalAlpha(v: number) { alpha = v; },
      save() { stack.push({ m: [...m] as Matrix, alpha }); },
      restore() { const p = stack.pop()!; m = p.m; alpha = p.alpha; },
      translate(x: number, y: number) { m = mul(m, [1, 0, 0, 1, x, y]); },
      transform(a: number, b: number, c: number, d: number, e: number, f: number) {
        m = mul(m, [a, b, c, d, e, f]);
      },
      drawImage(_img: unknown, dx: number, dy: number, dw: number, dh: number) {
        calls.push({
          box: [dx, dy, dw, dh],
          corners: [[dx, dy], [dx + dw, dy], [dx + dw, dy + dh], [dx, dy + dh]]
            .map(([x, y]) => at(x, y)),
          alpha,
        });
      },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, matrix: () => m };
  }

  const images = Object.fromEntries(
    DECAL_KINDS.map((k) => [k, [{ width: 256, height: 128 }]]),
  ) as Record<(typeof DECAL_KINDS)[number], { width: number; height: number }[]>;

  const decal = (over: Partial<Decal> = {}): Decal => ({
    tx: 40, ty: 40, kind: "bare", variant: 0,
    wx: 100, wy: 200, w: 96, alpha: 0.5, flip: false,
    rot: 0, pad: 1, reach: decalReach(96, 0), ...over,
  });

  const cam = { x: 10, y: 20, zoom: 2 };
  const range = { x0: 39, y0: 39, x1: 41, y1: 41 };

  /**
   * Where the four corners of a patch SHOULD land, derived from the projection
   * rather than from the paint code: the art covers a ground square of
   * `w / 64 · √2` tiles a side, turned 45° off the grid before `rot` is applied,
   * so its corners are the centre ± half a side along each of its own axes —
   * and a ground offset (dx, dy) lands on screen at ((dx−dy)·32·z, (dx+dy)·16·z).
   */
  const groundCorners = (d: Decal, c: { x: number; y: number; zoom: number }) => {
    const h = d.w / 64 / Math.SQRT2, a = d.rot + Math.PI / 4;
    const cos = Math.cos(a), sin = Math.sin(a);
    const cx = Math.floor(d.wx * c.zoom + c.x), cy = Math.floor(d.wy * c.zoom + c.y);
    const out: [number, number][] = [];
    for (const su of [1, -1]) for (const sv of [1, -1]) {
      const dx = su * h * cos - sv * h * sin, dy = su * h * sin + sv * h * cos;
      out.push([cx + (dx - dy) * 32 * c.zoom, cy + (dx + dy) * 16 * c.zoom]);
    }
    return out.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  };
  const sorted = (cs: [number, number][]) =>
    [...cs].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const sameCorners = (a: [number, number][], b: [number, number][]) =>
    a.every(([x, y], i) => Math.abs(x - b[i]![0]) < 1e-6 && Math.abs(y - b[i]![1]) < 1e-6);

  it("culls to the visible tile range, by each patch's own turned reach", () => {
    const { ctx, calls } = stubCtx();
    paintDecals(ctx, { x: 0, y: 0, zoom: 1 }, [decal()], images, range);
    expect(calls).toHaveLength(1);
    paintDecals(ctx, { x: 0, y: 0, zoom: 1 }, [decal()], images, { x0: 0, y0: 0, x1: 10, y1: 10 });
    expect(calls).toHaveLength(1);      // still one: the far patch was culled
    // The reach is the ground square's tip-to-tip span on each ground axis, so
    // it SWINGS with the turn: a patch sitting on its points (rot 0) reaches
    // w / 64 tiles out, the same patch turned flush reaches w / 64 / √2. The
    // cull has to follow that or unturned patches pop in at the screen edge.
    const far = { x0: 39, y0: 39, x1: 42, y1: 42 };
    const big = { w: 320, reach: decalReach(320, 0) };
    paintDecals(ctx, { x: 0, y: 0, zoom: 1 }, [decal({ ...big, tx: 47 })], images, far);
    expect(calls).toHaveLength(2);      // 47 ≤ 42 + 6: on its points, still in
    paintDecals(ctx, { x: 0, y: 0, zoom: 1 },
      [decal({ ...big, tx: 47, rot: Math.PI / 4, reach: decalReach(320, Math.PI / 4) })],
      images, far);
    expect(calls).toHaveLength(2);      // 47 > 42 + 4.54: flush, culled
  });

  it("draws the art 2:1 flat on the ground, centred, scaled by the zoom", () => {
    const { ctx, calls } = stubCtx();
    paintDecals(ctx, cam, [decal()], images, range);
    expect(calls).toHaveLength(1);
    const [dx, dy, dw, dh] = calls[0]!.box;
    expect(dw).toBe(96 * 2);
    expect(dh).toBe(48 * 2);            // half the width: the iso squash
    // centred on the patch's own world centre, floored to a pixel
    expect(dx).toBe(-96);
    expect(dy).toBe(-48);
    expect(calls[0]!.corners).toEqual([
      [Math.floor(100 * 2 + 10) - 96, Math.floor(200 * 2 + 20) - 48],
      [Math.floor(100 * 2 + 10) + 96, Math.floor(200 * 2 + 20) - 48],
      [Math.floor(100 * 2 + 10) + 96, Math.floor(200 * 2 + 20) + 48],
      [Math.floor(100 * 2 + 10) - 96, Math.floor(200 * 2 + 20) + 48],
    ]);
    expect(calls[0]!.alpha).toBe(0.5);
  });

  it("turns the patch ON THE GROUND: the blit carries S·R(θ)·S⁻¹", () => {
    const rot = Math.PI / 3;
    const { ctx, calls } = stubCtx();
    paintDecals(ctx, cam, [decal({ rot })], images, range);
    expect(calls).toHaveLength(1);
    // the blit's destination corners are exactly the turned ground square's,
    // projected — not a screen-space rotate of a 2:1 rect
    expect(sameCorners(sorted(calls[0]!.corners), groundCorners(decal({ rot }), cam)))
      .toBe(true);
  });

  it("keeps a square square: a quarter turn lands on the same ground", () => {
    // A ground square turned 90° IS the same square, so the four corners must
    // come back on the unturned patch's corners, in some order. A screen-space
    // rotate would instead stand the 2:1 art on its end.
    const { ctx, calls } = stubCtx();
    paintDecals(ctx, cam, [decal()], images, range);
    paintDecals(ctx, cam, [decal({ rot: Math.PI / 2 })], images, range);
    expect(calls).toHaveLength(2);
    expect(sameCorners(sorted(calls[1]!.corners), sorted(calls[0]!.corners))).toBe(true);
  });

  it("at 45° the patch becomes a diamond on screen, √2 wide and tall", () => {
    const { ctx, calls } = stubCtx();
    paintDecals(ctx, cam, [decal({ rot: Math.PI / 4 })], images, range);
    const [cx, cy] = [Math.floor(100 * 2 + 10), Math.floor(200 * 2 + 20)];
    const hx = 96 * 2 * Math.SQRT2 / 2, hy = 48 * 2 * Math.SQRT2 / 2;
    expect(sameCorners(sorted(calls[0]!.corners), sorted([
      [cx - hx, cy], [cx + hx, cy], [cx, cy - hy], [cx, cy + hy],
    ]))).toBe(true);
  });

  it("mirrors a flipped patch onto the same ground, in the same transform", () => {
    const { ctx, calls } = stubCtx();
    paintDecals(ctx, cam, [decal()], images, range);
    paintDecals(ctx, cam, [decal({ flip: true })], images, range);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.box).toEqual(calls[0]!.box);
    expect(sameCorners(sorted(calls[1]!.corners), sorted(calls[0]!.corners))).toBe(true);
    // the flip is the matrix's first column negated, not a second transform
    const rot = Math.PI / 3;
    const { ctx: c2, calls: k2 } = stubCtx();
    paintDecals(c2, cam, [decal({ rot })], images, range);
    paintDecals(c2, cam, [decal({ rot, flip: true })], images, range);
    expect(sameCorners(sorted(k2[1]!.corners), groundCorners(decal({ rot }), cam))).toBe(true);
  });

  it("restores the context alpha and transform it borrowed", () => {
    const { ctx, calls, matrix } = stubCtx();
    ctx.globalAlpha = 0.75;
    paintDecals(ctx, { x: 0, y: 0, zoom: 1 }, [decal()], images, range);
    expect(calls).toHaveLength(1);
    expect(ctx.globalAlpha).toBe(0.75);
    expect(matrix()).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("is a no-op when a family has no art loaded", () => {
    const { ctx, calls } = stubCtx();
    const empty = Object.fromEntries(DECAL_KINDS.map((k) => [k, []])) as typeof images;
    paintDecals(ctx, { x: 0, y: 0, zoom: 1 }, [decal()], empty, range);
    expect(calls).toHaveLength(0);
  });
});
