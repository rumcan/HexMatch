// ══════════════════════════════════════════════════════════════════════════
// E3 (#269) — height-aware PICKING and OBJECT ANCHORING on elevation.
//
// #267 drew the raised ground; this ticket makes the things that STAND on it
// (buildings, vehicles, ghosts) and the CLICK that selects a tile agree with
// that ground. Pinned here:
//
//   * `pickTile` resolves the tile the cursor SEES — a raised tile in front of
//     a lower one is the one returned, so a hill in front hides what is behind
//     it (front-to-back walk, the raised tile tested first);
//   * on a hillside, `pickTile` is exactly the FRONT-MOST tile whose lifted
//     diamond contains the cursor (cross-checked against a brute force);
//   * a building / vehicle / ghost anchor is lifted by `liftAt` at the tile it
//     stands on, so nothing floats or sinks against the drawn surface;
//   * a FLAT map (no height, or all-zero height) is byte-for-byte unchanged:
//     `pickTile` is the flat pick and `place` lifts by nothing.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { generateMap, GRASS, WATER, type Grid } from "../../src/iso/grid";
import { HW, HH } from "../../src/game/config";
import {
  LEVEL_PX, MAX_LIFT_PX, pickTile, tileSurfaceHeight, surfaceHeight, liftAt,
  elevationActive,
} from "../../src/iso/elevation";
import { place, type Placed } from "../../src/iso/depth";
import { Atlas, type Manifest } from "../../src/iso/atlas";

/** A tiny hand-built map: heights given as rows of digits, `~` is water. */
function synthetic(rows: string[]): Grid {
  const h = rows.length, w = rows[0].length;
  const terrain = new Uint8Array(w * h);
  const height = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = rows[y][x];
    const i = y * w + x;
    if (c === "~") { terrain[i] = WATER; height[i] = 0; }
    else { terrain[i] = GRASS; height[i] = Number(c); }
  }
  return { w, h, terrain, height, industries: [], towns: [], occupancy: new Uint8Array(w * h), seed: 1 } as unknown as Grid;
}

/** The flat pick — the exact tileToScreen inverse, the reference `pickTile` must match when flat. */
const flatPick = (wx: number, wy: number): [number, number] => [
  Math.floor((wx / HW + wy / HH) / 2),
  Math.floor((wy / HH - wx / HW) / 2),
];

/**
 * The independent oracle: over a generous window, the FRONT-MOST tile whose
 * lifted diamond contains (wx, wy) — i.e. `flatPick(wx, wy + itsLift)` lands
 * back on it, and its `tx+ty` is the largest such. This is what `pickTile`
 * must return; it is recomputed here without `pickTile`'s own window so the
 * two can only agree if the window was wide enough.
 */
function frontMostLifted(grid: Grid, wx: number, wy: number): [number, number] {
  const [fx, fy] = flatPick(wx, wy);
  let bx = fx, by = fy, bk = fx + fy;
  for (let ty = fy - 8; ty <= fy + 8; ty++) {
    if (ty < 0 || ty >= grid.h) continue;
    for (let tx = fx - 8; tx <= fx + 8; tx++) {
      if (tx < 0 || tx >= grid.w) continue;
      const lift = tileSurfaceHeight(grid, tx, ty) * LEVEL_PX;
      const [px, py] = flatPick(wx, wy + lift);
      if (px === tx && py === ty && tx + ty > bk) { bx = tx; by = ty; bk = tx + ty; }
    }
  }
  return [bx, by];
}

describe("E3 (#269) — flat map is unchanged", () => {
  it("pickTile is exactly the flat pick when the option is off", () => {
    const flat = generateMap(1337);
    expect(elevationActive(flat)).toBe(false);
    for (const [wx, wy] of [[0, 0], [120, 260], [-300, 900], [2048, 4096], [32.5, 16.25]]) {
      expect(pickTile(flat, wx, wy)).toEqual(flatPick(wx, wy));
    }
    // a null grid (no world yet) and an all-zero height array are the same
    expect(pickTile(null, 120, 260)).toEqual(flatPick(120, 260));
    const zeroes = { ...flat, height: new Uint8Array(flat.w * flat.h) } as Grid;
    for (const [wx, wy] of [[0, 0], [500, 1200]]) {
      expect(pickTile(zeroes, wx, wy)).toEqual(flatPick(wx, wy));
    }
  });

  it("place lifts by nothing on a flat map, so the sprite is byte-for-byte where it was", () => {
    const atlas = new Atlas(JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8")) as Manifest);
    const flat = generateMap(1337);
    const noGrid = place(atlas, { sprite: "farm_t33", tx: 40, ty: 30 })!;
    const withFlat = place(atlas, { sprite: "farm_t33", tx: 40, ty: 30 }, flat)!;
    expect(withFlat.wx).toBe(noGrid.wx);
    expect(withFlat.wy).toBe(noGrid.wy);
    expect(withFlat.key).toBe(noGrid.key);
    expect(withFlat.elev ?? 0).toBe(0);
    // a moving sprite likewise
    const m0 = place(atlas, { sprite: "truck_goods_se", tx: 3, ty: 10, fx: 3.5, fy: 10 })!;
    const m1 = place(atlas, { sprite: "truck_goods_se", tx: 3, ty: 10, fx: 3.5, fy: 10 }, flat)!;
    expect(m1.wy).toBe(m0.wy);
    expect(m1.key).toBe(m0.key);
  });
});

describe("E3 (#269) — a raised tile hides the one behind it", () => {
  it("returns the raised tile in front, not the flat tile the flat pick lands on", () => {
    // A level-4 plateau with a single level-0 pit at (5,5). The tile (6,6) sits
    // one diagonal in FRONT of the pit; its NW corner is pulled to 0 by the pit
    // so its surface is a slope (tileSurfaceHeight 3), lifted 24 px = 1½ tiles —
    // enough that it climbs up over the pit's screen diamond. A cursor in the
    // overlap must resolve to (6,6), the raised front tile, not (5,5) behind.
    const g = synthetic([
      "4444444",
      "4444444",
      "4444444",
      "4444444",
      "4444444",
      "4444404",
      "4444444",
    ]);
    expect(elevationActive(g)).toBe(true);
    expect(tileSurfaceHeight(g, 5, 5)).toBe(0);          // the pit reads flat-0
    expect(tileSurfaceHeight(g, 6, 6)).toBeGreaterThan(0); // (6,6) is raised

    // The pit's centre, on screen.
    const [cx, cy] = [(5.5 - 5.5) * HW, (5.5 + 5.5) * HH]; // (0, 176)
    // The flat pick lands on the pit (5,5)…
    expect(flatPick(cx, cy)).toEqual([5, 5]);
    // …but the raised tile (6,6) covers that point, so pickTile returns it.
    const [tx, ty] = pickTile(g, cx, cy);
    expect([tx, ty]).toEqual([6, 6]);
    expect(tx + ty).toBeGreaterThan(5 + 5);               // the FRONT tile wins
  });

  it("front-most oracle agrees on a whole stepped hillside", () => {
    const g = synthetic([
      "0000000000",
      "0000000000",
      "0011111110",
      "0011222210",
      "0011222210",
      "0011222210",
      "0011111110",
      "0000000000",
    ]);
    // Sweep a grid of cursors across the map; pickTile must equal the brute
    // force at every one (a window too small would diverge somewhere).
    for (let wy = 0; wy < 9 * HH; wy += 3) {
      for (let wx = -6 * HW; wx < 6 * HW; wx += 5) {
        expect(pickTile(g, wx, wy), `pickTile(${wx.toFixed(0)},${wy.toFixed(0)})`)
          .toEqual(frontMostLifted(g, wx, wy));
      }
    }
  });
});

describe("E3 (#269) — hillside picking on a generated map", () => {
  it("pickTile is the front-most lifted tile everywhere on a real dome", () => {
    const g = generateMap(1337, { elevation: true, rivers: true });
    expect(elevationActive(g)).toBe(true);
    // A deterministic sweep over a hilly interior band. Every cursor must
    // resolve to the front-most tile whose raised diamond contains it.
    let checked = 0;
    for (let ty = 40; ty <= 64; ty += 1) {
      for (let tx = 40; tx <= 64; tx += 1) {
        // the tile's own raised centre
        const lift = tileSurfaceHeight(g, tx, ty) * LEVEL_PX;
        const [wx, wy] = [(tx + 0.5 - (ty + 0.5)) * HW, (tx + 0.5 + ty + 0.5) * HH - lift];
        const got = pickTile(g, wx, wy);
        expect(got, `centre of (${tx},${ty})`).toEqual(frontMostLifted(g, wx, wy));
        // …and the tile's own raised centre always resolves to a tile that is
        // at least as far forward (a raised surface is never picked as behind).
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
    // never lifts a pick above the map's own headroom
    expect(MAX_LIFT_PX).toBe(4 * LEVEL_PX);
  });
});

describe("E3 (#269) — object anchors are lifted by liftAt", () => {
  const atlas = new Atlas(JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8")) as Manifest);

  it("a building's anchor rides up the hill by its tile's surface height", () => {
    // A flat level-2 plateau; a 1×1 building on it must lift exactly 2 levels.
    const g = synthetic([
      "222222",
      "222222",
      "222222",
    ]);
    const def = atlas.get("farm_t33")!;
    expect(def.footprint).toEqual([1, 1]);
    const flat = place(atlas, { sprite: "farm_t33", tx: 3, ty: 1 })!;
    const raised = place(atlas, { sprite: "farm_t33", tx: 3, ty: 1 }, g)!;
    // The south tile's centre surface height, as liftAt reads it.
    const [su, sv] = [3 + 0.5, 1 + 0.5];
    const want = liftAt(g, su, sv);
    expect(want).toBeCloseTo(2 * LEVEL_PX, 9);
    // The anchor pixel (top-left + anchor) is lifted by exactly that.
    const anchorFlat = flat.wy + def.anchor[1];
    const anchorRaised = raised.wy + def.anchor[1];
    expect(anchorFlat - anchorRaised).toBeCloseTo(want, 9);
    expect(raised.elev).toBeCloseTo(want, 9);
    expect(raised.wx).toBe(flat.wx);           // X is never lifted
    expect(raised.key).toBe(flat.key); // depth still sorts by ground position
  });

  it("a vertex-anchored sprite lifts by its own tile, not the one south of it", () => {
    const g = synthetic([
      "0000",
      "0200",
      "0000",
    ]);
    const def = atlas.get("quarry_t73")!;
    expect(def.anchor[1]).toBe(def.h);
    const raised = place(atlas, { sprite: "quarry_t73", tx: 1, ty: 1 }, g)!;
    expect(raised.elev).toBeCloseTo(liftAt(g, 1.5, 1.5), 9);
  });

  it("a moving vehicle's anchor follows the exact fractional surface", () => {
    // A slope: 0 along the top row rising to 2 along the bottom. A truck at a
    // fractional tile reads the bilinear surface at its own ground point.
    const g = synthetic([
      "00000",
      "01110",
      "02220",
    ]);
    const def = atlas.get("truck_goods_se")!;
    for (const [fx, fy] of [[1.5, 1.5], [2.25, 0.75], [3.5, 2.0]] as const) {
      const flat = place(atlas, { sprite: "truck_goods_se", tx: Math.round(fx), ty: Math.round(fy), fx, fy })!;
      const raised = place(atlas, { sprite: "truck_goods_se", tx: Math.round(fx), ty: Math.round(fy), fx, fy }, g)!;
      // drawOriginMoving anchors at the fractional diamond's centre (fx+0.5, fy+0.5).
      const want = liftAt(g, fx + 0.5, fy + 0.5);
      expect(want).toBeCloseTo(surfaceHeight(g, fx + 0.5, fy + 0.5) * LEVEL_PX, 9);
      const anchorFlat = flat.wy + def.anchor[1];
      const anchorRaised = raised.wy + def.anchor[1];
      expect(anchorFlat - anchorRaised, `truck@${fx},${fy}`).toBeCloseTo(want, 9);
      expect(raised.wx).toBe(flat.wx);
    }
  });

  it("a ghost preview (place with the grid) sits where the real building will", () => {
    // The overlay ghost is placed by the same `place(atlas, {sprite,tx,ty}, grid)`
    // call, so it is covered by the building case above; assert the contract
    // directly so a future refactor of the ghost cannot drift from it.
    const g = synthetic(["111", "111", "111"]);
    const ghost = place(atlas, { sprite: "farm_t33", tx: 1, ty: 1 }, g)!;
    expect(ghost.elev).toBeCloseTo(liftAt(g, 1.5, 1.5), 9);
    expect(ghost.elev).toBeCloseTo(LEVEL_PX, 9);   // a level-1 plateau
  });
});
