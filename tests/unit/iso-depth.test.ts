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

describe("K4 anchor contract", () => {
  it("puts the anchor pixel on the footprint diamond's SOUTH corner", () => {
    // OpenGFX sprites anchor by their declared xrel/yrel: the anchor pixel
    // lands on the bottom vertex of the footprint diamond — tileToScreen of
    // (tx+fw-1, ty+fh-1) shifted by (0, +TILE_H). A building's base diamond
    // therefore coincides with its tile's south corner.
    //
    // This asserted `sx + HW` until the ground-plane roads landed, and that
    // point is not the south vertex: it is half a tile EAST of it. The whole
    // monolith sheet was drawn there, so it was self-consistent and invisible
    // until a layer measured from the ground disagreed with it — see the note
    // on drawOrigin.
    for (const [name, tx, ty] of [["farm_t33", 10, 12], ["ore_mine_t0", 3, 20], ["terrain_grass", 0, 0], ["factory_blue", 5, 5], ["depot_blue", 9, 7], ["road_1111", 7, 9]] as const) {
      const def = atlas.get(name)!;
      const [ox, oy] = drawOrigin(def, tx, ty);
      const [fw, fh] = def.footprint;
      const [sx, sy] = tileToScreen(tx + fw - 1, ty + fh - 1);
      expect(ox + def.anchor[0]).toBe(sx);
      expect(oy + def.anchor[1]).toBe(sy + TILE_H);
    }
  });

  it("building layers (def.center): the anchor lands on the footprint bbox CENTRE", () => {
    // Per-building PNGs place their anchor pixel on the centre of the
    // footprint's bounding box — verified against the exact tile-union bbox
    // for square and non-square footprints alike.
    const def = { ...atlas.get("oil_rig_t29")!, center: true };
    for (const [fw, fh, tx, ty] of [[3, 3, 5, 5], [1, 1, 9, 7], [4, 4, 2, 3], [3, 2, 4, 6], [2, 1, 8, 8]] as const) {
      const d = { ...def, footprint: [fw, fh] };
      const [ox, oy] = drawOrigin(d, tx, ty);
      // bbox of the tile union
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) {
        const [x, y] = tileToScreen(tx + i, ty + j);
        x0 = Math.min(x0, x - HW); x1 = Math.max(x1, x + HW);
        y0 = Math.min(y0, y);       y1 = Math.max(y1, y + TILE_H);
      }
      expect(ox + def.anchor[0]).toBe((x0 + x1) / 2);
      expect(oy + def.anchor[1]).toBe((y0 + y1) / 2);
    }
  });
});

describe("E4 Tier 1 — max-corner depth key", () => {
  // V1: every shipped building is a single declared sprite on a 1×1 footprint,
  // so the multi-tile key math is exercised with explicit footprints here —
  // the formula is what matters, not which sprite carries it.
  const withFootprint = (p: Placed, fp: [number, number]): Placed => ({
    ...p,
    def: { ...p.def, footprint: fp },
    key: (p.tx + fp[0] - 1) + (p.ty + fp[1] - 1),
  });

  it("uses (tx+w-1)+(ty+h-1), not tx+ty", () => {
    const mine = withFootprint(P("ore_mine_t0", 5, 5), [3, 3]);  // key 7+7 = 14
    const farm = withFootprint(P("farm_t33", 8, 6), [2, 2]);      // key 9+7 = 16
    expect(mine.key).toBe(14);
    expect(farm.key).toBe(16);
    // tx+ty alone would order the farm (14) equal to the mine (10) wrongly
    expect(tier1Compare(mine, farm)).toBeLessThan(0);
  });

  it("draws a small object in front of a big one it overlaps forward of", () => {
    // depot at the mine's south-east: must be drawn after the mine
    const mine = P("ore_mine_t0", 10, 10);
    const depot = P("depot_blue", 13, 12);
    const { order } = depthSort([depot, mine]);
    expect(order.map((p) => p.sprite)).toEqual(["ore_mine_t0", "depot_blue"]);
  });

  it("is a stable total order (sorting twice is idempotent)", () => {
    const items = [P("farm_t33", 4, 4), P("ore_mine_t0", 8, 3), P("depot_red", 6, 9), P("quarry_t72", 1, 1)];
    const a = depthSort(items).order.map((p) => p.sprite);
    const b = depthSort(depthSort(items).order).order.map((p) => p.sprite);
    expect(b).toEqual(a);
  });
});

describe("E4 Tier 2 — topological pass over overlapping sprites", () => {
  it("only relates sprites whose screen boxes intersect", () => {
    const a = P("farm_t33", 0, 0);
    const b = P("farm_t33", 30, 30);
    expect(boxesIntersect(a, b)).toBe(false);
    const { order, cycles } = depthSort([b, a]);
    expect(cycles).toEqual([]);
    expect(order[0]).toBe(a);
  });

  it("orders a mine, a farm and a station between them back-to-front", () => {
    // the E4 acceptance fixture: 3×3 mine, 2×2 farm, depot between them
    const mine = P("ore_mine_t0", 6, 6);
    const depot = P("depot_green", 9, 8);
    const farm = P("farm_t33", 10, 10);
    const names = depthSort([farm, depot, mine]).order.map((p) => p.sprite);
    expect(names.indexOf("ore_mine_t0")).toBeLessThan(names.indexOf("depot_green"));
    expect(names.indexOf("depot_green")).toBeLessThan(names.indexOf("farm_t33"));
  });

  it("isBehind is antisymmetric for separated footprints", () => {
    const a = P("farm_t33", 2, 2), b = P("farm_t33", 6, 2);
    expect(isBehind(a, b)).toBe(true);
    expect(isBehind(b, a)).toBe(false);
  });

  it("never drops a sprite, even under contrived overlap", () => {
    const items = [
      P("ore_mine_t0", 5, 5), P("farm_t33", 6, 5), P("farm_t33", 5, 7),
      P("depot_blue", 7, 6), P("quarry_t72", 4, 4),
    ];
    const { order } = depthSort(items);
    expect(order).toHaveLength(items.length);
    expect(new Set(order)).toEqual(new Set(items));
  });
});

describe("E4 picking — stage 2 alpha test", () => {
  it("hits the sprite's opaque pixels and misses transparent corners", () => {
    const mine = P("ore_mine_t0", 20, 20);
    // give the mine a mask that is opaque only in a central column (a chimney)
    const w = mine.w, h = mine.h;
    const bits = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (Math.abs(x - w / 2) < 6) bits[y * w + x] = 1;
    }
    atlas.setMask("ore_mine_t0", { w, h, bits });

    const chimneyX = mine.wx + w / 2, chimneyY = mine.wy + 4;
    expect(pickSprite(atlas, [mine], chimneyX, chimneyY)).toBe(mine);
    // top-left corner of the bbox is transparent → no hit, caller keeps the
    // flat pick (the grass behind the mine)
    expect(pickSprite(atlas, [mine], mine.wx + 1, mine.wy + 1)).toBeNull();
  });

  it("returns the front-most sprite when two overlap", () => {
    const back = P("ore_mine_t0", 10, 10);
    const front = P("farm_t33", 12, 12);
    atlas.setMask("ore_mine_t0", { w: back.w, h: back.h, bits: new Uint8Array(back.w * back.h).fill(1) });
    atlas.setMask("farm_t33", { w: front.w, h: front.h, bits: new Uint8Array(front.w * front.h).fill(1) });
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

describe("V1 single-sprite buildings are ONE object on their footprint", () => {
  it("the factory is a single declared sprite, taller than a single-piece industry", () => {
    const f = P("factory_blue", 5, 5);
    // Flat OpenGFX: no `parts`/stack — one sprite, one footprint.
    expect(f.def.parts).toBeUndefined();
    expect(f.w).toBe(f.def.w);
    expect(f.h).toBe(f.def.h);
    // a multi-storey works must be strictly taller than a single-piece industry
    expect(f.h).toBeGreaterThan(P("farm_t33", 5, 5).h);
  });

  it("depth-sorts by its 1×1 footprint (one entry, painter-ordered with neighbours)", () => {
    const factory = P("factory_blue", 5, 4);
    const farm = P("farm_t33", 5, 5);            // one row in front
    const { order, cycles } = depthSort([farm, factory]);
    expect(cycles).toEqual([]);
    // two distinct objects → two entries, back (factory) then front (farm)
    expect(order.map((p) => p.sprite)).toEqual(["factory_blue", "farm_t33"]);
    expect(factory.key).toBe((5) + (4));     // [1,1] footprint → tx+ty
  });

  it("its top is high enough that a click on the tower above a single storey hits it", () => {
    const f = P("factory_blue", 20, 20);
    const farm = P("farm_t35", 20, 20);   // the low barn shed — a single storey
    // high on the tower: above where a single-storey building's art reaches,
    // but inside the factory's own sprite box → still the factory.
    const pt = { x: f.wx + f.w / 2, y: f.wy + Math.floor(f.h / 4) };
    expect(pt.y).toBeLessThan(farm.wy + 1);    // sanity: really up in the tower
    // (no canvas in node → no masks; a sprite without a mask tests opaque on
    // its box, matching the pre-mask contract.)
    expect(pickSprite(atlas, [farm, f], pt.x, pt.y)).toBe(f);
  });
});
