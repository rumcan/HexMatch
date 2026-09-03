import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Atlas, maskFromRGBA, type Manifest } from "../../src/iso/atlas";
import {
  place, depthSort, tier1Compare, boxesIntersect, isBehind, pickSprite, drawOrigin,
  type Placed,
} from "../../src/iso/depth";
import { HW, TILE_H, tileToScreen } from "../../src/game/config";

const manifest: Manifest = JSON.parse(
  readFileSync("assets/iso-atlas/manifest.json", "utf8"),
);
const atlas = new Atlas(manifest);

const P = (sprite: string, tx: number, ty: number) => {
  const p = place(atlas, { sprite, tx, ty });
  expect(p, `sprite ${sprite} missing from the manifest`).toBeTruthy();
  return p as Placed;
};

describe("E4 anchor contract", () => {
  it("puts the anchor pixel on the footprint's south corner", () => {
    for (const [name, tx, ty] of [["farm", 10, 12], ["ore_mine", 3, 40], ["terrain_grass_a", 0, 0]] as const) {
      const def = atlas.get(name)!;
      const [ox, oy] = drawOrigin(def, tx, ty);
      const [fw, fh] = def.footprint;
      const [sx, sy] = tileToScreen(tx + fw - 1, ty + fh - 1);
      // south corner of the last tile's diamond
      expect(ox + def.anchor[0]).toBe(sx + HW);
      expect(oy + def.anchor[1]).toBe(sy + TILE_H);
    }
  });
});

describe("E4 Tier 1 — max-corner depth key", () => {
  it("uses (tx+w-1)+(ty+h-1), not tx+ty", () => {
    const mine = P("ore_mine", 5, 5);   // 3×3 → key 7+7 = 14
    const farm = P("farm", 8, 6);       // 2×2 → key 9+7 = 16
    expect(mine.key).toBe(14);
    expect(farm.key).toBe(16);
    // tx+ty alone would order the farm (14) equal to the mine (10) wrongly
    expect(tier1Compare(mine, farm)).toBeLessThan(0);
  });

  it("draws a small object in front of a big one it overlaps forward of", () => {
    // depot at the mine's south-east: must be drawn after the mine
    const mine = P("ore_mine", 10, 10);
    const depot = P("depot_blue", 13, 12);
    const { order } = depthSort([depot, mine]);
    expect(order.map((p) => p.sprite)).toEqual(["ore_mine", "depot_blue"]);
  });

  it("is a stable total order (sorting twice is idempotent)", () => {
    const items = [P("farm", 4, 4), P("ore_mine", 8, 3), P("depot_red", 6, 9), P("quarry", 1, 1)];
    const a = depthSort(items).order.map((p) => p.sprite);
    const b = depthSort(depthSort(items).order).order.map((p) => p.sprite);
    expect(b).toEqual(a);
  });
});

describe("E4 Tier 2 — topological pass over overlapping sprites", () => {
  it("only relates sprites whose screen boxes intersect", () => {
    const a = P("farm", 0, 0);
    const b = P("farm", 30, 30);
    expect(boxesIntersect(a, b)).toBe(false);
    const { order, cycles } = depthSort([b, a]);
    expect(cycles).toEqual([]);
    expect(order[0]).toBe(a);
  });

  it("orders a mine, a farm and a station between them back-to-front", () => {
    // the E4 acceptance fixture: 3×3 mine, 2×2 farm, depot between them
    const mine = P("ore_mine", 6, 6);
    const depot = P("depot_green", 9, 8);
    const farm = P("farm", 10, 10);
    const names = depthSort([farm, depot, mine]).order.map((p) => p.sprite);
    expect(names.indexOf("ore_mine")).toBeLessThan(names.indexOf("depot_green"));
    expect(names.indexOf("depot_green")).toBeLessThan(names.indexOf("farm"));
  });

  it("isBehind is antisymmetric for separated footprints", () => {
    const a = P("farm", 2, 2), b = P("farm", 6, 2);
    expect(isBehind(a, b)).toBe(true);
    expect(isBehind(b, a)).toBe(false);
  });

  it("never drops a sprite, even under contrived overlap", () => {
    const items = [
      P("ore_mine", 5, 5), P("farm", 6, 5), P("farm", 5, 7),
      P("depot_blue", 7, 6), P("quarry", 4, 4),
    ];
    const { order } = depthSort(items);
    expect(order).toHaveLength(items.length);
    expect(new Set(order)).toEqual(new Set(items));
  });
});

describe("E4 picking — stage 2 alpha test", () => {
  it("hits the sprite's opaque pixels and misses transparent corners", () => {
    const mine = P("ore_mine", 20, 20);
    // give the mine a mask that is opaque only in a central column (a chimney)
    const w = mine.w, h = mine.h;
    const bits = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (Math.abs(x - w / 2) < 6) bits[y * w + x] = 1;
    }
    atlas.setMask("ore_mine", { w, h, bits });

    const chimneyX = mine.wx + w / 2, chimneyY = mine.wy + 4;
    expect(pickSprite(atlas, [mine], chimneyX, chimneyY)).toBe(mine);
    // top-left corner of the bbox is transparent → no hit, caller keeps the
    // flat pick (the grass behind the mine)
    expect(pickSprite(atlas, [mine], mine.wx + 1, mine.wy + 1)).toBeNull();
  });

  it("returns the front-most sprite when two overlap", () => {
    const back = P("ore_mine", 10, 10);
    const front = P("farm", 12, 12);
    atlas.setMask("ore_mine", { w: back.w, h: back.h, bits: new Uint8Array(back.w * back.h).fill(1) });
    atlas.setMask("farm", { w: front.w, h: front.h, bits: new Uint8Array(front.w * front.h).fill(1) });
    const { order } = depthSort([back, front]);
    // a point inside both boxes
    const px = Math.max(back.wx, front.wx) + 2;
    const py = Math.max(back.wy, front.wy) + 2;
    if (px < Math.min(back.wx + back.w, front.wx + front.w)) {
      expect(pickSprite(atlas, order, px, py)).toBe(front);
    }
  });

  it("maskFromRGBA thresholds on alpha", () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]);
    const m = maskFromRGBA(rgba, 2, 1);
    expect(Array.from(m.bits)).toEqual([0, 1]);
  });
});
