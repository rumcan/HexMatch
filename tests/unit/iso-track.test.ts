import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  NE, SE, SW, NW, DIRS, DIR, OPPOSITE, PRESENT,
  createTrack, tIdx, spriteKey, hasTrack, bitsAt, canBuildOn, playerNetwork,
  recomputeMask, autotileAround, buildTile, demolishTile,
  tileCost, addCost, canAfford, lPath, previewDrag, commitDrag,
  connectedTiles, areConnected, mergedPresent, mergedBitsAt,
  mergedConnectedTiles, mergedAreConnected, drawBits, freeAllowanceCovers, type Track,
} from "../../src/iso/track";
import { Atlas, type Manifest } from "../../src/iso/atlas";
import { buildDrawList, CHUNK, chunksX } from "../../src/iso/renderer";
import { generateMap, GRASS, WATER, ROUGH, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { TRANSPORT, UPGRADE_COST } from "../../src/iso/config";

const atlas = new Atlas(
  JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8")) as Manifest,
);

/** A blank all-grass grid with no industries — isolates the track logic. */
function flatGrid(): Grid {
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries: [],
    occupancy: new Int16Array(MAP_W * MAP_H).fill(-1),
    seed: 1,
  };
}

const build = (t: Track, kind: "dirt" | "road", pts: [number, number][], owner = 0) => {
  for (const [x, y] of pts) buildTile(t, kind, x, y, owner);
};

describe("E5 direction model", () => {
  it("uses the diamond's four edge directions with consistent deltas", () => {
    expect([NE, SE, SW, NW]).toEqual([1, 2, 4, 8]);
    expect(DIR[NE]).toEqual([0, -1]);
    expect(DIR[SE]).toEqual([1, 0]);
    expect(DIR[SW]).toEqual([0, 1]);
    expect(DIR[NW]).toEqual([-1, 0]);
  });

  it("OPPOSITE is a true involution, and stepping it returns you home", () => {
    for (const d of DIRS) {
      expect(OPPOSITE[OPPOSITE[d]]).toBe(d);
      const [dx, dy] = DIR[d];
      const [bx, by] = DIR[OPPOSITE[d]];
      expect([dx + bx, dy + by]).toEqual([0, 0]);
    }
  });
});

describe("E5 autotiling — all 16 neighbour configurations", () => {
  // Acceptance: "a unit test placing every one of the 16 neighbour
  // configurations asserts the correct sprite key".
  it("maps each of the 16 masks to the right sprite key, and it exists", () => {
    for (let mask = 0; mask < 16; mask++) {
      const t = createTrack();
      const cx = 20, cy = 20;
      buildTile(t, "dirt", cx, cy);
      for (const d of DIRS) {
        if (mask & d) buildTile(t, "dirt", cx + DIR[d][0], cy + DIR[d][1]);
      }
      const bits = bitsAt(t, "dirt", cx, cy);
      expect(bits, `mask ${mask}`).toBe(mask);
      const key = spriteKey("dirt", bits);
      expect(key).toBe(`dirt_${mask.toString(2).padStart(4, "0")}`);
      expect(atlas.has(key), `${key} missing from the atlas`).toBe(true);
      expect(atlas.has(spriteKey("road", bits))).toBe(true);
    }
  });

  it("builds the key by mask, e.g. NE|SE → dirt_0011", () => {
    expect(spriteKey("dirt", NE | SE)).toBe("dirt_0011");
    expect(spriteKey("road", SE | NW)).toBe("road_1010");
    expect(spriteKey("dirt", 0)).toBe("dirt_0000");
    expect(spriteKey("dirt", 15)).toBe("dirt_1111");
  });

  it("connections are mutual — a neighbour bit implies the reverse bit", () => {
    const t = createTrack();
    build(t, "dirt", [[10, 10], [11, 10]]);
    expect(bitsAt(t, "dirt", 10, 10) & SE).toBeTruthy();
    expect(bitsAt(t, "dirt", 11, 10) & NW).toBeTruthy();
  });

  it("gravel and tar are one surface: dirt beside a paved tile sets the facing bit", () => {
    // The mask is the physical road surface, so a Dirt Road that reaches a
    // paved tile connects to it — both tiles face each other across the tier
    // boundary (the dirt↔paved seam feature; the `dirt_road_*` art draws the
    // join and the merged floods route across it).
    const t = createTrack();
    buildTile(t, "dirt", 5, 5);
    expect(bitsAt(t, "dirt", 5, 5)).toBe(0);
    buildTile(t, "road", 6, 5);
    expect(bitsAt(t, "dirt", 5, 5) & SE).toBe(SE);    // dirt faces the paving
    expect(bitsAt(t, "road", 6, 5) & NW).toBe(NW);    // …and it faces back
    // each tier's bit still lives in its OWN layer; a tile never carries both
    expect(hasTrack(t, "dirt", 6, 5)).toBe(false);
    expect(hasTrack(t, "road", 5, 5)).toBe(false);
  });
});

describe("merged surface helpers", () => {
  it("mergedPresent / mergedBitsAt union the two tier layers per tile", () => {
    const t = createTrack();
    buildTile(t, "dirt", 5, 5);
    buildTile(t, "road", 6, 5);
    expect(mergedPresent(t, 5, 5)).toBe(true);
    expect(mergedPresent(t, 6, 5)).toBe(true);
    expect(mergedPresent(t, 7, 5)).toBe(false);
    expect(mergedBitsAt(t, 5, 5) & SE).toBe(SE);
    expect(mergedBitsAt(t, 6, 5) & NW).toBe(NW);
    expect(mergedBitsAt(t, 7, 5)).toBe(0);
  });

  it("a lone gravel tile and a lone paved tile are merged-connected across the seam", () => {
    const t = createTrack();
    buildTile(t, "dirt", 10, 10);
    buildTile(t, "road", 11, 10);
    // per-kind views stay separate…
    expect(connectedTiles(t, "dirt", 10, 10).size).toBe(1);
    expect(areConnected(t, "dirt", 10, 10, 11, 10)).toBe(false);
    // …but the merged surface joins them (the tier boundary is transparent)
    expect(mergedConnectedTiles(t, 10, 10).size).toBe(2);
    expect(mergedAreConnected(t, 10, 10, 11, 10)).toBe(true);
    expect(mergedAreConnected(t, 10, 10, 12, 10)).toBe(false);
  });

  it("merged flood crosses a paved middle between two gravel stubs", () => {
    // dirt — road — dirt: after paving over the middle of a gravel run the
    // two surviving gravel stubs are still one road (they both face the tar).
    const t = createTrack();
    buildTile(t, "dirt", 10, 10);
    buildTile(t, "dirt", 11, 10);
    buildTile(t, "dirt", 12, 10);
    buildTile(t, "road", 11, 10);                 // pave over the centre
    expect(hasTrack(t, "dirt", 11, 10)).toBe(false);
    expect(bitsAt(t, "dirt", 10, 10) & SE).toBe(SE);
    expect(bitsAt(t, "dirt", 12, 10) & NW).toBe(NW);
    expect(mergedConnectedTiles(t, 10, 10).size).toBe(3);
    expect(mergedAreConnected(t, 10, 10, 12, 10)).toBe(true);
  });
});

describe("E5 incremental recompute", () => {
  // Acceptance: "a test that placing one tile touches exactly 5 tiles' masks
  // and 1–4 chunks".
  it("touches exactly 5 tiles and between 1 and 4 chunks", () => {
    const t = createTrack();
    const r = buildTile(t, "dirt", 20, 20)!;
    expect(r.tiles).toHaveLength(5);
    expect(new Set(r.tiles).size).toBe(5);
    expect(r.chunks.length).toBeGreaterThanOrEqual(1);
    expect(r.chunks.length).toBeLessThanOrEqual(4);
  });

  it("touches 1 chunk mid-chunk and more at a chunk corner", () => {
    // K4: chunks are 4×4 — (1,1) is interior to chunk 0, (CHUNK,CHUNK) the
    // four-chunk meeting point.
    const mid = buildTile(createTrack(), "dirt", 1, 1)!;
    expect(mid.chunks).toHaveLength(1);
    const corner = buildTile(createTrack(), "dirt", CHUNK, CHUNK)!;
    expect(corner.chunks.length).toBeGreaterThan(1);
    expect(corner.chunks).toContain(chunksX + 1);
  });

  it("clips the touched set at the map edge", () => {
    const r = buildTile(createTrack(), "dirt", 0, 0)!;
    expect(r.tiles).toHaveLength(3);   // self + SE + SW
  });

  it("never rescans the whole map", () => {
    const r = buildTile(createTrack(), "dirt", 20, 20)!;
    expect(r.tiles.length).toBeLessThan(MAP_W * MAP_H);
  });

  it("demolishing re-tiles the neighbours that pointed at it", () => {
    const t = createTrack();
    build(t, "dirt", [[10, 10], [11, 10], [12, 10]]);
    expect(bitsAt(t, "dirt", 11, 10)).toBe(SE | NW);
    demolishTile(t, "dirt", 11, 10);
    expect(hasTrack(t, "dirt", 11, 10)).toBe(false);
    expect(bitsAt(t, "dirt", 10, 10)).toBe(0);
    expect(bitsAt(t, "dirt", 12, 10)).toBe(0);
  });
});

describe("E5 presence vs direction bits", () => {
  it("keeps a lone stub visible — mask 0000 still draws", () => {
    const t = createTrack();
    buildTile(t, "dirt", 15, 15);
    expect(bitsAt(t, "dirt", 15, 15)).toBe(0);
    expect(hasTrack(t, "dirt", 15, 15)).toBe(true);
    const grid = flatGrid();
    const list = buildDrawList(
      { grid, dirtBits: drawBits(t, "dirt") },
      { x0: 14, y0: 14, x1: 16, y1: 16 },
    );
    expect(list.map((d) => d.sprite)).toContain("dirt_0000");
  });

  it("PRESENT sits above the four direction bits", () => {
    expect(PRESENT).toBe(16);
    const t = createTrack();
    buildTile(t, "dirt", 3, 3);
    expect(t.dirt[tIdx(3, 3)] & 0b1111).toBe(0);
    expect(t.dirt[tIdx(3, 3)] & PRESENT).toBe(PRESENT);
  });

  it("paving a Road over a Dirt Road replaces it — a tile never holds both tiers", () => {
    // The game is de-railwayed into two road tiers with no level crossing:
    // paving `road` over `dirt` clears the gravel, and laying `dirt` over an
    // existing `road` is a no-op (a paved road is never downgraded).
    const t = createTrack();
    buildTile(t, "dirt", 9, 9);
    expect(hasTrack(t, "dirt", 9, 9)).toBe(true);
    buildTile(t, "road", 9, 9);
    expect(hasTrack(t, "dirt", 9, 9)).toBe(false);   // gravel cleared
    expect(hasTrack(t, "road", 9, 9)).toBe(true);
    buildTile(t, "dirt", 9, 9);
    expect(hasTrack(t, "road", 9, 9)).toBe(true);    // no downgrade
    expect(hasTrack(t, "dirt", 9, 9)).toBe(false);
  });
});

describe("E5 buildability", () => {
  it("refuses water for both kinds", () => {
    const grid = flatGrid();
    grid.terrain[tIdx(7, 7)] = WATER;
    expect(canBuildOn(grid, "dirt", 7, 7)).toBe(false);
    expect(canBuildOn(grid, "road", 7, 7)).toBe(false);
  });

  it("allows dirt on rough but not road — road needs flat", () => {
    const grid = flatGrid();
    grid.terrain[tIdx(8, 8)] = ROUGH;
    expect(TRANSPORT.dirt.onRough).toBe(true);
    expect(TRANSPORT.road.onRough).toBe(false);
    expect(canBuildOn(grid, "dirt", 8, 8)).toBe(true);
    expect(canBuildOn(grid, "road", 8, 8)).toBe(false);
  });

  it("G5: with a network set, refuses tiles not adjacent to it", () => {
    const grid = flatGrid();
    const net = new Set<number>([tIdx(10, 10)]);
    expect(canBuildOn(grid, "dirt", 10, 11, net)).toBe(true);
    expect(canBuildOn(grid, "dirt", 20, 20, net)).toBe(false);
    expect(canBuildOn(grid, "dirt", 20, 20)).toBe(true); // 3-arg form unchanged
  });

  it("G5: rival track is not a seed; demolish rebuilds the component", () => {
    const t = createTrack();
    build(t, "dirt", [[10, 10], [11, 10], [12, 10], [13, 10]], 1);
    const factories = [{ ownerId: 1, tx: 10, ty: 10 }];
    const harvesters: { ownerId: number; tx: number; ty: number }[] = [];
    let net = playerNetwork(t, 1, factories, harvesters);
    expect(net.has(tIdx(13, 10))).toBe(true);
    demolishTile(t, "dirt", 11, 10);
    net = playerNetwork(t, 1, factories, harvesters);
    expect(net.has(tIdx(10, 10))).toBe(true);
    expect(net.has(tIdx(13, 10))).toBe(false);
    expect(canBuildOn(flatGrid(), "dirt", 13, 11, net)).toBe(false);
  });

  it("W2: a rival's factory does not seed your network, and vice versa", () => {
    const t = createTrack();
    build(t, "dirt", [[10, 10], [11, 10]], 1);
    build(t, "dirt", [[30, 30], [31, 30]], 2);
    const you = playerNetwork(
      t, 1, [{ ownerId: 1, tx: 10, ty: 10 }], [],
    );
    const ai = playerNetwork(
      t, 2, [{ ownerId: 2, tx: 30, ty: 30 }], [],
    );
    expect(you.has(tIdx(11, 10))).toBe(true);
    expect(you.has(tIdx(30, 30))).toBe(false);
    expect(ai.has(tIdx(31, 30))).toBe(true);
    expect(ai.has(tIdx(10, 10))).toBe(false);
  });

  it("G5: previewDrag with network cannot jump a gap", () => {
    const grid = flatGrid(), t = createTrack();
    const net = new Set<number>([tIdx(5, 5)]);
    const rich = { wood: 999, stone: 999, ore: 999 };
    const fromSeed = previewDrag(grid, t, "dirt", rich, 5, 5, 8, 5, true, net);
    expect(fromSeed.tiles.length).toBe(4);
    const fromEmpty = previewDrag(grid, t, "dirt", rich, 20, 20, 24, 20, true, net);
    expect(fromEmpty.tiles.length).toBe(0);
    expect(fromEmpty.truncated).toBe(true);
  });

  it("refuses industry footprints and out-of-bounds", () => {
    const grid = flatGrid();
    grid.occupancy[tIdx(12, 12)] = 0;
    expect(canBuildOn(grid, "dirt", 12, 12)).toBe(false);
    expect(canBuildOn(grid, "dirt", -1, 0)).toBe(false);
    expect(canBuildOn(grid, "dirt", MAP_W, 0)).toBe(false);
  });
});

describe("E5 costs", () => {
  it("charges the transport cost on virgin ground", () => {
    const t = createTrack();
    expect(tileCost(t, "dirt", 1, 1)).toEqual(TRANSPORT.dirt.cost);
    expect(tileCost(t, "road", 1, 1)).toEqual(TRANSPORT.road.cost);
  });

  it("is free over existing track of the same kind", () => {
    const t = createTrack();
    buildTile(t, "dirt", 1, 1);
    expect(tileCost(t, "dirt", 1, 1)).toEqual({});
  });

  it("charges only the difference to upgrade dirt → road in place", () => {
    const t = createTrack();
    buildTile(t, "dirt", 1, 1);
    expect(tileCost(t, "road", 1, 1)).toEqual(UPGRADE_COST);
  });

  it("canAfford compares every cargo in the cost", () => {
    expect(canAfford({ stone: 3 }, { stone: 3 })).toBe(true);
    expect(canAfford({ stone: 2 }, { stone: 3 })).toBe(false);
    expect(canAfford({ stone: 9 }, { ore: 1 })).toBe(false);
    expect(addCost({ stone: 1 }, { stone: 2 }, 3)).toEqual({ stone: 7 });
  });
});

describe("E5 L-shaped Manhattan drag", () => {
  it("goes all of one axis then the other, and the flip changes the corner", () => {
    const a = lPath(0, 0, 2, 2, true);
    expect(a).toEqual([[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]);
    const b = lPath(0, 0, 2, 2, false);
    expect(b).toEqual([[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]]);
    expect(a).toHaveLength(b.length);
  });

  it("handles straight lines, reverses and the degenerate single tile", () => {
    expect(lPath(5, 5, 5, 5)).toEqual([[5, 5]]);
    expect(lPath(5, 5, 3, 5)).toEqual([[5, 5], [4, 5], [3, 5]]);
    expect(lPath(5, 5, 5, 3)).toEqual([[5, 5], [5, 4], [5, 3]]);
  });
});

describe("E5 drag-to-build acceptance", () => {
  const rich = { wood: 999, stone: 999, ore: 999 };

  it("dragging across 10 tiles charges exactly 10× the per-tile cost", () => {
    const grid = flatGrid(), t = createTrack();
    const p = previewDrag(grid, t, "dirt", rich, 5, 5, 14, 5);
    expect(p.tiles).toHaveLength(10);
    expect(p.cost).toEqual({
      wood: 10 * TRANSPORT.dirt.cost.wood!,
      stone: 10 * TRANSPORT.dirt.cost.stone!,
    });
    expect(p.truncated).toBe(false);
  });

  it("dragging into water truncates at the last legal tile", () => {
    const grid = flatGrid(), t = createTrack();
    grid.terrain[tIdx(9, 5)] = WATER;
    const p = previewDrag(grid, t, "dirt", rich, 5, 5, 14, 5);
    expect(p.truncated).toBe(true);
    expect(p.tiles).toHaveLength(4);            // 5,6,7,8
    expect(p.tiles.at(-1)).toEqual([8, 5]);
  });

  it("dragging over existing dirt of the same type is free, no double charge", () => {
    const grid = flatGrid(), t = createTrack();
    build(t, "dirt", [[5, 5], [6, 5], [7, 5]]);
    const p = previewDrag(grid, t, "dirt", rich, 5, 5, 9, 5);
    expect(p.tiles).toHaveLength(5);
    expect(p.cost).toEqual({ wood: 2, stone: 2 });   // only 8,5 and 9,5 are new
  });

  it("an unaffordable drag previews and builds only the affordable prefix", () => {
    const grid = flatGrid(), t = createTrack();
    const purse = { wood: 99, stone: 3 };
    const p = previewDrag(grid, t, "dirt", purse, 5, 5, 14, 5);
    expect(p.tiles).toHaveLength(3);
    expect(p.cost).toEqual({ wood: 3, stone: 3 });
    expect(p.unaffordable.length).toBeGreaterThan(0);
    const c = commitDrag(t, "dirt", p);
    expect(c.built).toHaveLength(3);
    expect(hasTrack(t, "dirt", 7, 5)).toBe(true);
    expect(hasTrack(t, "dirt", 8, 5)).toBe(false);
  });

  it("commits a contiguous run that autotiles into a straight line", () => {
    const grid = flatGrid(), t = createTrack();
    const p = previewDrag(grid, t, "dirt", rich, 5, 5, 9, 5);
    commitDrag(t, "dirt", p);
    // interior tiles connect both ways along the x axis (NW|SE)
    for (const x of [6, 7, 8]) expect(bitsAt(t, "dirt", x, 5)).toBe(SE | NW);
    expect(bitsAt(t, "dirt", 5, 5)).toBe(SE);
    expect(bitsAt(t, "dirt", 9, 5)).toBe(NW);
  });

  it("road drags truncate on rough ground where dirt would pass", () => {
    const grid = flatGrid(), t = createTrack();
    grid.terrain[tIdx(8, 5)] = ROUGH;
    const road = previewDrag(grid, t, "road", rich, 5, 5, 12, 5);
    expect(road.truncated).toBe(true);
    expect(road.tiles).toHaveLength(3);
    const dirt = previewDrag(grid, t, "dirt", rich, 5, 5, 12, 5);
    expect(dirt.truncated).toBe(false);
    expect(dirt.tiles).toHaveLength(8);
  });

  it("an L-drag charges for the corner tile exactly once", () => {
    const grid = flatGrid(), t = createTrack();
    const p = previewDrag(grid, t, "dirt", rich, 5, 5, 8, 8);
    expect(p.tiles).toHaveLength(7);            // 4 across + 3 down, corner once
    expect(new Set(p.tiles.map(([x, y]) => `${x},${y}`)).size).toBe(7);
    expect(p.cost).toEqual({ wood: 7, stone: 7 });
  });
});

describe("E5 connectivity (the base E6 scores on)", () => {
  it("flood fills a connected run and excludes a detached one", () => {
    const t = createTrack();
    build(t, "dirt", [[5, 5], [6, 5], [7, 5]]);
    build(t, "dirt", [[20, 20]]);
    const set = connectedTiles(t, "dirt", 5, 5);
    expect(set.size).toBe(3);
    expect(set.has(tIdx(20, 20))).toBe(false);
    expect(areConnected(t, "dirt", 5, 5, 7, 5)).toBe(true);
    expect(areConnected(t, "dirt", 5, 5, 20, 20)).toBe(false);
  });

  it("requires BOTH neighbours to set the facing bit", () => {
    const t = createTrack();
    build(t, "dirt", [[5, 5], [6, 5]]);
    // forge a one-sided bit: (7,5) has no track at all
    t.dirt[tIdx(6, 5)] |= SE;
    expect(areConnected(t, "dirt", 5, 5, 7, 5)).toBe(false);
  });

  it("a per-tier flood never enters the other tier — even though the masks cross it", () => {
    // `connectedTiles` is the SINGLE-TIER view: it only steps onto tiles that
    // carry the requested tier, so two adjacent runs of opposite tiers never
    // leak into each other on that flood. (The masks themselves DO cross the
    // boundary now — see the merged-surface tests — but a tile that is not
    // PRESENT on the tier is a wall for the per-tier flood.)
    const t = createTrack();
    build(t, "dirt", [[10, 10], [10, 11]]);   // vertical Dirt Road
    build(t, "road", [[11, 10], [11, 11]]);   // vertical paved Road, adjacent
    expect(bitsAt(t, "dirt", 10, 10) & SE).toBe(SE);   // masks face across…
    expect(bitsAt(t, "road", 11, 10) & NW).toBe(NW);
    expect(connectedTiles(t, "dirt", 10, 10).size).toBe(2);
    expect(connectedTiles(t, "road", 11, 10).size).toBe(2);
    expect(areConnected(t, "dirt", 10, 10, 10, 11)).toBe(true);
    expect(areConnected(t, "dirt", 10, 10, 11, 10)).toBe(false);  // road tile excluded
    expect(mergedConnectedTiles(t, 10, 10).size).toBe(4);         // merged joins all
  });

  it("breaking the middle splits one network into two", () => {
    const t = createTrack();
    build(t, "dirt", [[5, 5], [6, 5], [7, 5], [8, 5]]);
    expect(connectedTiles(t, "dirt", 5, 5).size).toBe(4);
    demolishTile(t, "dirt", 7, 5);
    expect(connectedTiles(t, "dirt", 5, 5).size).toBe(2);
    expect(areConnected(t, "dirt", 5, 5, 8, 5)).toBe(false);
  });

  it("survives a loop without infinite recursion", () => {
    const t = createTrack();
    build(t, "dirt", [
      [5, 5], [6, 5], [7, 5],
      [5, 6], [7, 6],
      [5, 7], [6, 7], [7, 7],
    ]);
    expect(connectedTiles(t, "dirt", 5, 5).size).toBe(8);
  });
});

describe("E5 renderer integration", () => {
  it("every mask a real map produces resolves to a real atlas sprite", () => {
    const grid = generateMap(4242);
    const t = createTrack();
    // lay a long snake that hits water, rough and industry footprints
    for (let x = 2; x < 46; x++) {
      if (canBuildOn(grid, "dirt", x, 24)) buildTile(t, "dirt", x, 24);
      if (canBuildOn(grid, "road", 24, x)) buildTile(t, "road", 24, x);
    }
    const list = buildDrawList(
      { grid, dirtBits: drawBits(t, "dirt"), roadBits: drawBits(t, "road") },
      { x0: 0, y0: 0, x1: MAP_W - 1, y1: MAP_H - 1 },
    );
    const track = list.filter((d) => /^(dirt|road)_/.test(d.sprite));
    expect(track.length).toBeGreaterThan(20);
    for (const d of track) expect(atlas.has(d.sprite), d.sprite).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// W9 — the free setup allowance buys ROAD, never road.
//
// `previewDrag` used to spend the allowance on any tile with a non-empty cost,
// so the first FREE_SETUP_TRACK (12) tiles of a road drag were free: the ore
// gate E8/PP-07 settled ("wood and stone for dirts, no ore — road is gated behind
// an ore mine") was bypassed and the connection jumped straight to road VP
// (3/tile) and road throughput (×1.6) with 0 ore in the purse.
// ══════════════════════════════════════════════════════════════════════════
describe("W9 the free setup allowance buys dirt, never road", () => {
  /** START_PURSE: 12 wood + 12 stone for the opening dirt, and no ore at all. */
  const setup = { wood: 12, stone: 12, ore: 0 };

  it("the rule lives in one place, and it says dirt only", () => {
    expect(freeAllowanceCovers("dirt")).toBe(true);
    expect(freeAllowanceCovers("road")).toBe(false);
  });

  it("a road drag with 12 free tiles and no ore lays 0 tiles (was 12)", () => {
    const grid = flatGrid(), t = createTrack();
    const p = previewDrag(grid, t, "road", setup, 5, 5, 16, 5, true, undefined, 12);
    expect(p.tiles).toHaveLength(0);
    expect(p.cost).toEqual({});                 // nothing to charge
    expect(p.free).toBe(0);                     // and no allowance burned on it
    expect(p.unaffordable).toHaveLength(12);    // drawn red, never built
    const c = commitDrag(t, "road", p, 1);
    expect(c.built).toHaveLength(0);
    expect(hasTrack(t, "road", 5, 5)).toBe(false);
  });

  it("the same drag with ore in the purse lays road and debits it per tile", () => {
    const grid = flatGrid(), t = createTrack();
    // exactly 4 ore = exactly one new road tile ({wood 1, stone 1, ore 4})
    const p = previewDrag(grid, t, "road", { wood: 12, stone: 12, ore: 4 }, 5, 5, 16, 5, true, undefined, 12);
    expect(p.tiles).toHaveLength(1);
    expect(p.cost).toEqual(TRANSPORT.road.cost);
    expect(p.cost.ore).toBe(4);
    expect(p.free).toBe(0);
    commitDrag(t, "road", p, 1);
    expect(hasTrack(t, "road", 5, 5)).toBe(true);
    expect(hasTrack(t, "road", 6, 5)).toBe(false);

    // a purse that can pay lays the whole line, charging every tile
    const grid2 = flatGrid(), t2 = createTrack();
    const q = previewDrag(grid2, t2, "road", { wood: 99, stone: 99, ore: 99 }, 5, 5, 16, 5, true, undefined, 12);
    expect(q.tiles).toHaveLength(12);
    expect(q.cost).toEqual({ wood: 12, ore: 4 * 12, stone: 12 });
    expect(q.free).toBe(0);
  });

  it("an in-place dirt→road upgrade is never free either", () => {
    const grid = flatGrid(), t = createTrack();
    build(t, "dirt", [[5, 5], [6, 5], [7, 5], [8, 5]], 1);
    const broke = previewDrag(grid, t, "road", setup, 5, 5, 8, 5, true, undefined, 12);
    expect(broke.tiles).toHaveLength(0);
    expect(broke.free).toBe(0);
    // 8 ore = two upgrades at UPGRADE_COST (4) each
    const paid = previewDrag(grid, t, "road", { wood: 12, stone: 12, ore: 8 }, 5, 5, 8, 5, true, undefined, 12);
    expect(paid.tiles).toHaveLength(2);
    expect(paid.cost).toEqual({ ore: 2 * UPGRADE_COST.ore! });
    expect(paid.free).toBe(0);
  });

  it("dirt still rides the allowance exactly as W1 established", () => {
    const grid = flatGrid(), t = createTrack();
    const free = previewDrag(grid, t, "dirt", { stone: 0, ore: 0 }, 5, 5, 16, 5, true, undefined, 12);
    expect(free.tiles).toHaveLength(12);
    expect(free.cost).toEqual({});
    expect(free.free).toBe(12);

    // past the allowance the purse pays, and the preview truncates there
    const grid2 = flatGrid(), t2 = createTrack();
    const mixed = previewDrag(grid2, t2, "dirt", { wood: 5, stone: 5, ore: 0 }, 5, 5, 21, 5, true, undefined, 12);
    expect(mixed.tiles).toHaveLength(17);        // 12 free + 5 paid
    expect(mixed.cost).toEqual({ wood: 5, stone: 5 });
    expect(mixed.free).toBe(12);
  });

  it("a dirt drag over your own track still wastes no allowance", () => {
    const grid = flatGrid(), t = createTrack();
    build(t, "dirt", [[5, 5], [6, 5], [7, 5]], 1);
    const p = previewDrag(grid, t, "dirt", { stone: 0, ore: 0 }, 5, 5, 9, 5, true, undefined, 12);
    expect(p.tiles).toHaveLength(5);
    expect(p.free).toBe(2);                      // only the two new tiles
    expect(p.cost).toEqual({});
  });
});
