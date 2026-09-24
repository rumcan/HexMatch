import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Atlas, maskFromRGBA, type Manifest, type SpriteDef } from "../../src/iso/atlas";
import {
  place, depthSort, tier1Compare, boxesIntersect, isBehind, pickSprite, drawOrigin,
  type Placed, type DrawItem,
} from "../../src/iso/depth";
import { HW, HH, TILE_H, tileToScreen } from "../../src/game/config";
import {
  createRailState, railStructureItems, carPlacements, trainItems, trailOf, PLATFORM_FOOTPRINT,
  OCT_NAMES, type Train,
} from "../../src/iso/rail";
import { shapeGalleryLayout, shapeGalleryDef, SHAPE_GALLERY_FOOTPRINTS } from "../../src/iso/debug";

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

// ══════════════════════════════════════════════════════════════════════════
// F2 (#272) — engine support and tests for NON-SQUARE buildings.
//
// Everything above assumes the shipped 1×1 sheet cells (plus a couple of
// square multi-tile industries). This block exercises the SAME engine paths
// with synthetic defs on w≠h footprints of length up to 4 — placement, depth
// sort (shapes vs shapes vs squares vs a moving vehicle), and stage-2 picking
// — plus the LIVE non-square example: rail platforms (1×3/3×1,
// `railStructureItems`) beside moving trains (`carPlacements`).
//
// The ordering contract pinned here:
//   R1  a strictly-behind footprint (max depth key < the other's min) always
//       draws first — for every pair of shapes at every relative offset;
//   R2  a moving vehicle beside the NEAR side of a shape (east of a column,
//       south of a row) draws OVER it where their boxes overlap;
//   R3  the same vehicle on the FAR side (west / north) draws UNDER it;
//   R4  strictly in front of / behind a shape, the vehicle sorts by its
//       ground key (fx+fy with the +0.5 in-front bias).
// ══════════════════════════════════════════════════════════════════════════

/** The six spec shapes + the 1×4/4×1 pair the ticket names + square controls. */
const F2_SHAPES: [number, number][] = [
  [1, 2], [2, 1], [1, 3], [3, 1], [4, 2], [2, 4], [1, 4], [4, 1], [2, 2], [1, 1], [4, 4],
];

/**
 * A synthetic manifest: one centre-anchored building per shape (a box standing
 * on a footprint-sized plate, big enough that screen boxes overlap across a
 * tile of gap — real art always overhangs) and one 1×1 south-anchored car.
 */
function f2Manifest(extra: Record<string, SpriteDef> = {}): Manifest {
  const sprites: Record<string, SpriteDef> = {};
  for (const [w, h] of F2_SHAPES) {
    const artW = (w + h) * HW;
    const up = Math.round((w + h) * HH * 0.9) + 24;
    const artH = (w + h) * HH + up;
    sprites[`s${w}x${h}`] = {
      x: 0, y: 0, w: artW, h: artH,
      footprint: [w, h],
      anchor: [artW / 2, up + (w + h) * HH / 2],
      center: true,
    };
  }
  sprites.f2car = { x: 0, y: 0, w: 40, h: 30, footprint: [1, 1], anchor: [20, 22] };
  return { images: {}, tileW: 64, tileH: 32, sprites: { ...sprites, ...extra } };
}

const f2 = new Atlas(f2Manifest());
const fp2 = (p: Placed) => p.def.footprint;
const tilesOf = (p: Placed): [number, number][] => {
  const [fw, fh] = fp2(p);
  const out: [number, number][] = [];
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) out.push([p.tx + x, p.ty + y]);
  return out;
};
const disjoint2 = (a: Placed, b: Placed) => {
  const as = new Set(tilesOf(a).map(([x, y]) => `${x},${y}`));
  return tilesOf(b).every(([x, y]) => !as.has(`${x},${y}`));
};
const minKeyOf = (p: Placed): number => p.tx + p.ty;
const maxKeyOf = (p: Placed): number => {
  const [fw, fh] = fp2(p);
  return (p.tx + fw - 1) + (p.ty + fh - 1);
};

const P2 = (at: Atlas, sprite: string, tx: number, ty: number, extra: Partial<DrawItem> = {}): Placed => {
  const p = place(at, { sprite, tx, ty, ...extra });
  expect(p, `sprite ${sprite} missing`).toBeTruthy();
  return p as Placed;
};

describe("F2 (#272) — drawOrigin on non-square footprints", () => {
  it("centre anchor lands on the footprint centre for 1×2 … 2×4 at any origin", () => {
    for (const [w, h] of F2_SHAPES) {
      const def = f2.get(`s${w}x${h}`)!;
      for (const [tx, ty] of [[0, 0], [7, 3], [-2, 5], [4, -3]] as const) {
        const [ox, oy] = drawOrigin(def, tx, ty);
        // exact bbox of the w×h tile union (each tile's 2·HW × 2·HH diamond)
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const [x, y] = tileToScreen(tx + i, ty + j);
          x0 = Math.min(x0, x - HW); x1 = Math.max(x1, x + HW);
          y0 = Math.min(y0, y); y1 = Math.max(y1, y + TILE_H);
        }
        expect(ox + def.anchor[0], `${w}×${h}@${tx},${ty} centre x`).toBe((x0 + x1) / 2);
        expect(oy + def.anchor[1], `${w}×${h}@${tx},${ty} centre y`).toBe((y0 + y1) / 2);
      }
    }
  });

  it("south-vertex branch (rail platform convention) lands on the S tile's south vertex", () => {
    // The railway defs anchor on the south VERTEX of the footprint's last
    // tile — no `center` — so a 3×1 and a 1×3 must land on different screen
    // corners of the same-size bbox.
    for (const [w, h] of F2_SHAPES) {
      const def: SpriteDef = { ...f2.get(`s${w}x${h}`)!, center: undefined, anchor: [0, 0] };
      const [ox, oy] = drawOrigin(def, 6, 2);
      const [sx, sy] = tileToScreen(6 + w - 1, 2 + h - 1);
      expect([ox, oy], `${w}×${h} south vertex`).toEqual([sx, sy + TILE_H]);
    }
  });

  it("the debug gallery lays every shape out side by side on its own footprint", () => {
    const slots = shapeGalleryLayout(0, 0);
    expect(slots.map((s) => s.footprint)).toEqual([...SHAPE_GALLERY_FOOTPRINTS]);
    // side by side with one empty column between, all on one row
    let x = 0;
    for (const s of slots) {
      expect([s.tx, s.ty], s.name).toEqual([x, 0]);
      expect(shapeGalleryDef(s.footprint).footprint).toEqual(s.footprint);
      x += s.footprint[0] + 1;
    }
  });
});

describe("F2 (#272) — depth sort: shapes against each other", () => {
  it("R1: strictly-behind footprints sort back-to-front at every relative offset", () => {
    const names = F2_SHAPES.map(([w, h]) => `s${w}x${h}`);
    let checked = 0;
    for (const na of names) for (const nb of names) {
      for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) {
        const a = P2(f2, na, 0, 0);
        const b = P2(f2, nb, dx, dy);
        if (!disjoint2(a, b)) continue;
        checked++;
        const { order, cycles } = depthSort([b, a]);
        expect(cycles, `${na} ${nb} @${dx},${dy} must be resolvable`).toEqual([]);
        if (maxKeyOf(a) < minKeyOf(b)) {
          expect(order, `R1 ${na}(0,0) behind ${nb}(${dx},${dy})`).toEqual([a, b]);
        } else if (maxKeyOf(b) < minKeyOf(a)) {
          expect(order, `R1 ${nb}(${dx},${dy}) behind ${na}(0,0)`).toEqual([b, a]);
        }
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it("mixed shapes + two moving vehicles: never drops, stays acyclic and idempotent", () => {
    for (let seed = 0; seed < 250; seed++) {
      let s = seed * 7919 + 1;
      const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const items: Placed[] = [];
      for (let i = 0; i < 9; i++) {
        const [w, h] = F2_SHAPES[(seed + i) % F2_SHAPES.length];
        items.push(P2(f2, `s${w}x${h}`, Math.floor(rnd() * 7) - 3, Math.floor(rnd() * 7) - 3));
      }
      for (let i = 0; i < 2; i++) {
        const fx = Math.floor(rnd() * 7) - 3 + 0.3, fy = Math.floor(rnd() * 7) - 3 + 0.3;
        items.push(P2(f2, "f2car", Math.round(fx), Math.round(fy), { fx, fy }));
      }
      const { order, cycles } = depthSort(items);
      expect(order, `seed ${seed} drops nothing`).toHaveLength(items.length);
      expect(new Set(order), `seed ${seed}`).toEqual(new Set(items));
      expect(cycles, `seed ${seed} resolves`).toEqual([]);
      const again = depthSort(order).order;
      expect(again, `seed ${seed} idempotent`).toEqual(order);
    }
  });
});

describe("F2 (#272) — a moving vehicle around every shape", () => {
  it("R2/R3/R4: near lanes draw over, far lanes under, strict front/back by ground key", () => {
    let near = 0, far = 0, strict = 0;
    for (const [w, h] of F2_SHAPES) {
      for (let cy = -3; cy <= h + 2; cy++) for (let cx = -3; cx <= w + 2; cx++) {
        for (const [ox, oy] of [[0.3, 0.7], [-0.25, -0.35]] as const) {
          const fx = cx + ox, fy = cy + oy;
          if (Math.round(fx) !== cx || Math.round(fy) !== cy) continue;
          const a = P2(f2, `s${w}x${h}`, 0, 0);
          const v = P2(f2, "f2car", cx, cy, { fx, fy });
          const yIn = cy >= 0 && cy <= h - 1;
          const xIn = cx >= 0 && cx <= w - 1;
          const { order } = depthSort([v, a]);
          const vOver = order.indexOf(v) > order.indexOf(a);
          // R2/R3: the near/far side of the flank (both strict and interleaved
          // depth — the flank rule is the one that decides either way)
          if (boxesIntersect(a, v)) {
            if ((cx >= w && yIn) || (cy >= h && xIn)) {
              near++;
              expect(vOver, `R2 near ${w}×${h} car@${fx},${fy} draws over`).toBe(true);
            } else if ((cx < 0 && yIn) || (cy < 0 && xIn)) {
              far++;
              expect(vOver, `R3 far ${w}×${h} car@${fx},${fy} draws under`).toBe(false);
            }
          }
          // R4: strictly past either end of the shape's depth range, the
          // ground key alone rules (flank zones never reach these — proved by
          // the ranges; diagonal positions do)
          const vKey = cx + cy + 0.5;
          if (vKey > maxKeyOf(a)) {
            strict++;
            expect(vOver, `R4 over ${w}×${h} car@${cx},${cy}`).toBe(true);
          } else if (vKey < minKeyOf(a)) {
            strict++;
            expect(vOver, `R4 under ${w}×${h} car@${cx},${cy}`).toBe(false);
          }
        }
      }
    }
    expect(near).toBeGreaterThan(20);
    expect(far).toBeGreaterThan(20);
    expect(strict).toBeGreaterThan(200);
  });
});

describe("F2 (#272) — live example: rail platforms (1×3/3×1) beside moving trains", () => {
  // The REAL railway defs (assets/railway/manifest.json): platforms anchored
  // on the south vertex of their footprint's last tile, cars on their ground
  // contact point — exactly what `railStructureItems` / `trainItems` emit.
  const railManifest = (): Manifest => {
    const m = JSON.parse(readFileSync("assets/railway/manifest.json", "utf8")) as {
      sprites: Record<string, SpriteDef>;
    };
    return { images: {}, tileW: 64, tileH: 32, sprites: { ...m.sprites, ...f2Manifest().sprites } };
  };
  const mkState = () => {
    const state = createRailState();
    state.structures.push(
      { id: 1, kind: "platform", ownerId: 1, owner: "you", tx: 5, ty: 5, w: 1, h: 3, view: "se", anchor: null },
      { id: 2, kind: "platform", ownerId: 1, owner: "you", tx: 10, ty: 5, w: 1, h: 3, view: "nw", anchor: null },
    );
    return state;
  };
  const mkTrain = (id: number, route: [number, number][], dist: number): Train => ({
    id, ownerId: 1, lineId: 1, depotId: 0, status: "moving", target: "source",
    route, dist, planRevision: 0, dwellMs: 0, dirBit: 2, resold: false,
  });

  it("platforms carry their 1×3/3×1 footprints from the rail structure to the draw item", () => {
    const at = new Atlas(railManifest());
    const state = mkState();
    const items = railStructureItems(state);
    expect(items.map((i) => i.sprite)).toEqual(["platform_se", "platform_nw"]);
    const placed = items.map((i) => P2(at, i.sprite, i.tx, i.ty));
    expect(placed.map(fp2)).toEqual([[1, 3], [1, 3]]);
    expect(placed.map(maxKeyOf)).toEqual([5 + 7, 10 + 7]);
  });

  it("a train on the track lane draws OVER the platform it is passing (R2)", () => {
    const at = new Atlas(railManifest());
    const state = mkState();
    state.trains.push(mkTrain(1, [[6, 2], [6, 12]], 3.2));   // track lane x = 6 (se side)
    // the live trail: head-first, then the ground points it has covered
    trailOf(state, state.trains[0]).push([6, 5.2], [6, 4], [6, 3], [6, 2]);
    const platform = P2(at, "platform_se", 5, 5);
    const cars = trainItems(state, at)
      .map((i) => P2(at, i.sprite, i.tx, i.ty, { fx: i.fx, fy: i.fy }));
    expect(cars.length).toBeGreaterThan(0);
    let beside = 0;
    for (const car of cars) {
      // beside the platform: same rows, one column east
      if (car.tx !== 6 || car.ty < 5 || car.ty > 7) continue;
      if (!boxesIntersect(platform, car)) continue;
      beside++;
      const { order } = depthSort([car, platform]);
      expect(order.indexOf(car), `car@${car.fx!.toFixed(2)},${car.fy!.toFixed(2)} over the platform`).toBeGreaterThan(order.indexOf(platform));
    }
    expect(beside).toBeGreaterThan(0);
  });

  it("a train on the far lane draws UNDER the platform (R3)", () => {
    const at = new Atlas(railManifest());
    const state = mkState();
    state.trains.push(mkTrain(1, [[9, 2], [9, 12]], 3.2));   // far lane x = 9 (nw side)
    trailOf(state, state.trains[0]).push([9, 5.2], [9, 4], [9, 3], [9, 2]);
    const platform = P2(at, "platform_nw", 10, 5);
    const cars = trainItems(state, at)
      .map((i) => P2(at, i.sprite, i.tx, i.ty, { fx: i.fx, fy: i.fy }));
    let beside = 0;
    for (const car of cars) {
      if (car.tx !== 9 || car.ty < 5 || car.ty > 7) continue;
      if (!boxesIntersect(platform, car)) continue;
      beside++;
      const { order } = depthSort([car, platform]);
      expect(order.indexOf(car), `car@${car.fx!.toFixed(2)},${car.fy!.toFixed(2)} under the platform`).toBeLessThan(order.indexOf(platform));
    }
    expect(beside).toBeGreaterThan(0);
  });

  it("a train's own cars place at the head's ground point and along the trail (carPlacements)", () => {
    const state = createRailState();
    const t = mkTrain(1, [[6, 2], [6, 10]], 4);
    const cars = carPlacements(state, t);
    expect(cars.map((c) => c.kind)).toEqual(["loco", "tender", "box", "tank", "flat"]);
    // locomotive exactly at the head; with no trail yet every car is there too
    expect(cars[0].fx).toBeCloseTo(6, 5);
    expect(cars[0].fy).toBeCloseTo(6, 5);
    // seed the head-first trail the game records as the train moves, and the
    // cars lay out BACK along it (behind the head, toward the route start)
    trailOf(state, t).push([6, 6], [6, 5], [6, 4], [6, 3]);
    const laid = carPlacements(state, t);
    expect(laid[0].fx).toBeCloseTo(6, 5);
    expect(laid[0].fy).toBeCloseTo(6, 5);
    for (let i = 1; i < laid.length; i++) {
      expect(laid[i].fy).toBeLessThan(laid[i - 1].fy);
      expect(laid[i].fx).toBeCloseTo(6, 5);
    }
    // and every car is a moving 1×1 item once trainItems names it
    const items = trainItems(state, { has: () => true });
    expect(items.every((i) => i.fx !== undefined && i.fy !== undefined)).toBe(true);
    expect(items.map((i) => i.sprite.startsWith("car-")).every(Boolean)).toBe(true);
    expect([...OCT_NAMES]).toEqual(["e", "se", "s", "sw", "w", "nw", "n", "ne"]);
    expect([PLATFORM_FOOTPRINT.se, PLATFORM_FOOTPRINT.nw, PLATFORM_FOOTPRINT.sw, PLATFORM_FOOTPRINT.ne])
      .toEqual([[1, 3], [1, 3], [3, 1], [3, 1]]);
  });
});

describe("F2 (#272) — picking follows the real footprint", () => {
  /** A footprint-diamond mask in the art's own pixels (plate = the footprint). */
  const plateMask = (def: SpriteDef): { w: number; h: number; bits: Uint8Array } => {
    const [fw, fh] = def.footprint;
    const [ax, ay] = def.anchor;
    const rx = (fw + fh) * HW / 2, ry = (fw + fh) * HH / 2;
    const bits = new Uint8Array(def.w * def.h);
    for (let y = 0; y < def.h; y++) for (let x = 0; x < def.w; x++) {
      const dx = Math.abs(x - ax) / rx, dy = Math.abs(y - ay) / ry;
      if (dx + dy <= 1) bits[y * def.w + x] = 1;
    }
    return { w: def.w, h: def.h, bits };
  };

  for (const [w, h] of [[2, 4], [4, 2], [1, 3], [3, 1]] as const) {
    it(`a ${w}×${h} footprint mask: the plate hits, beyond it misses`, () => {
      const at = new Atlas(f2Manifest());
      const name = `s${w}x${h}`;
      at.setMask(name, plateMask(at.get(name)!));
      const p = P2(at, name, 8, 8);
      const [fw, fh] = [w, h];
      // the anchor (footprint centre) and the four footprint corners hit
      const [cx, cy] = [p.wx + p.def.anchor[0], p.wy + p.def.anchor[1]];
      expect(pickSprite(at, [p], cx, cy), "centre").toBe(p);
      const rx = (fw + fh) * HW / 2 - 2, ry = (fw + fh) * HH / 2 - 2;
      for (const [dx, dy] of [[0, -ry], [rx, 0], [0, ry], [-rx, 0]] as const) {
        expect(pickSprite(at, [p], cx + dx, cy + dy), `corner ${dx},${dy}`).toBe(p);
      }
      // outside the diamond (bbox corners of a non-square art box) misses
      expect(pickSprite(at, [p], p.wx + 1, p.wy + 1)).toBeNull();
      expect(pickSprite(at, [p], p.wx + p.w - 1, p.wy + 1)).toBeNull();
    });
  }

  it("the front-most of two overlapping plates wins the pick", () => {
    const at = new Atlas(f2Manifest());
    for (const n of ["s2x4", "s4x2"]) at.setMask(n, plateMask(at.get(n)!));
    const back = P2(at, "s2x4", 4, 4);
    const front = P2(at, "s4x2", 5, 6);   // south-east of the column → in front
    const { order } = depthSort([back, front]);
    expect(order).toEqual([back, front]);
    // a point on both plates (front's west corner region)
    const fx = front.wx + front.def.anchor[0] - ((4 + 2) * HW / 2 - 2);
    const fy = front.wy + front.def.anchor[1];
    if (pickSprite(at, order, fx, fy) === front) {
      expect(pickSprite(at, order, fx, fy)).toBe(front);
    }
  });
});
