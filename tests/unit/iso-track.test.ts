import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  NE, SE, SW, NW, DIRS, DIR, OPPOSITE, PRESENT,
  createTrack, tIdx, spriteKey, isCrossing, hasTrack, bitsAt, canBuildOn, playerNetwork,
  recomputeMask, autotileAround, buildTile, demolishTile,
  tileCost, addCost, canAfford, lPath, previewDrag, commitDrag,
  connectedTiles, areConnected, drawBits, type Track,
  OTTD_ROADBIT, toOpenttdRoadBits, fromOpenttdRoadBits,
} from "../../src/iso/track";
import { Atlas, type Manifest } from "../../src/iso/atlas";
import { buildDrawList, CHUNK, chunksX } from "../../src/iso/renderer";
import { generateMap, GRASS, WATER, ROUGH, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { TRANSPORT } from "../../src/iso/config";

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

const build = (t: Track, kind: "road" | "rail", pts: [number, number][], owner = 0) => {
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
      buildTile(t, "road", cx, cy);
      for (const d of DIRS) {
        if (mask & d) buildTile(t, "road", cx + DIR[d][0], cy + DIR[d][1]);
      }
      const bits = bitsAt(t, "road", cx, cy);
      expect(bits, `mask ${mask}`).toBe(mask);
      const key = spriteKey("road", bits);
      expect(key).toBe(`road_${mask.toString(2).padStart(4, "0")}`);
      expect(atlas.has(key), `${key} missing from the atlas`).toBe(true);
      expect(atlas.has(spriteKey("rail", bits))).toBe(true);
    }
  });

  it("builds the key by mask, e.g. NE|SE → road_0011", () => {
    expect(spriteKey("road", NE | SE)).toBe("road_0011");
    expect(spriteKey("rail", SE | NW)).toBe("rail_1010");
    expect(spriteKey("road", 0)).toBe("road_0000");
    expect(spriteKey("road", 15)).toBe("road_1111");
  });

  it("connections are mutual — a neighbour bit implies the reverse bit", () => {
    const t = createTrack();
    build(t, "road", [[10, 10], [11, 10]]);
    expect(bitsAt(t, "road", 10, 10) & SE).toBeTruthy();
    expect(bitsAt(t, "road", 11, 10) & NW).toBeTruthy();
  });

  it("road and rail autotile independently and never cross-connect", () => {
    const t = createTrack();
    buildTile(t, "road", 5, 5);
    buildTile(t, "rail", 6, 5);
    expect(bitsAt(t, "road", 5, 5)).toBe(0);
    expect(bitsAt(t, "rail", 6, 5)).toBe(0);
  });
});

describe("E5 incremental recompute", () => {
  // Acceptance: "a test that placing one tile touches exactly 5 tiles' masks
  // and 1–4 chunks".
  it("touches exactly 5 tiles and between 1 and 4 chunks", () => {
    const t = createTrack();
    const r = buildTile(t, "road", 20, 20)!;
    expect(r.tiles).toHaveLength(5);
    expect(new Set(r.tiles).size).toBe(5);
    expect(r.chunks.length).toBeGreaterThanOrEqual(1);
    expect(r.chunks.length).toBeLessThanOrEqual(4);
  });

  it("touches 1 chunk mid-chunk and more at a chunk corner", () => {
    const mid = buildTile(createTrack(), "road", 4, 4)!;
    expect(mid.chunks).toHaveLength(1);
    const corner = buildTile(createTrack(), "road", CHUNK, CHUNK)!;
    expect(corner.chunks.length).toBeGreaterThan(1);
    expect(corner.chunks).toContain(chunksX + 1);
  });

  it("clips the touched set at the map edge", () => {
    const r = buildTile(createTrack(), "road", 0, 0)!;
    expect(r.tiles).toHaveLength(3);   // self + SE + SW
  });

  it("never rescans the whole map", () => {
    const r = buildTile(createTrack(), "road", 24, 24)!;
    expect(r.tiles.length).toBeLessThan(MAP_W * MAP_H);
  });

  it("demolishing re-tiles the neighbours that pointed at it", () => {
    const t = createTrack();
    build(t, "road", [[10, 10], [11, 10], [12, 10]]);
    expect(bitsAt(t, "road", 11, 10)).toBe(SE | NW);
    demolishTile(t, "road", 11, 10);
    expect(hasTrack(t, "road", 11, 10)).toBe(false);
    expect(bitsAt(t, "road", 10, 10)).toBe(0);
    expect(bitsAt(t, "road", 12, 10)).toBe(0);
  });
});

describe("E5 presence vs direction bits", () => {
  it("keeps a lone stub visible — mask 0000 still draws", () => {
    const t = createTrack();
    buildTile(t, "road", 15, 15);
    expect(bitsAt(t, "road", 15, 15)).toBe(0);
    expect(hasTrack(t, "road", 15, 15)).toBe(true);
    const grid = flatGrid();
    const list = buildDrawList(
      { grid, roadBits: drawBits(t, "road") },
      { x0: 14, y0: 14, x1: 16, y1: 16 },
    );
    expect(list.map((d) => d.sprite)).toContain("road_0000");
  });

  it("PRESENT sits above the four direction bits", () => {
    expect(PRESENT).toBe(16);
    const t = createTrack();
    buildTile(t, "road", 3, 3);
    expect(t.road[tIdx(3, 3)] & 0b1111).toBe(0);
    expect(t.road[tIdx(3, 3)] & PRESENT).toBe(PRESENT);
  });

  it("a tile with both layers is a level crossing", () => {
    const t = createTrack();
    buildTile(t, "road", 9, 9);
    expect(isCrossing(t, 9, 9)).toBe(false);
    buildTile(t, "rail", 9, 9);
    expect(isCrossing(t, 9, 9)).toBe(true);
  });
});

describe("E5 buildability", () => {
  it("refuses water for both kinds", () => {
    const grid = flatGrid();
    grid.terrain[tIdx(7, 7)] = WATER;
    expect(canBuildOn(grid, "road", 7, 7)).toBe(false);
    expect(canBuildOn(grid, "rail", 7, 7)).toBe(false);
  });

  it("allows road on rough but not rail — rail needs flat", () => {
    const grid = flatGrid();
    grid.terrain[tIdx(8, 8)] = ROUGH;
    expect(TRANSPORT.road.onRough).toBe(true);
    expect(TRANSPORT.rail.onRough).toBe(false);
    expect(canBuildOn(grid, "road", 8, 8)).toBe(true);
    expect(canBuildOn(grid, "rail", 8, 8)).toBe(false);
  });

  it("G5: with a network set, refuses tiles not adjacent to it", () => {
    const grid = flatGrid();
    const net = new Set<number>([tIdx(10, 10)]);
    expect(canBuildOn(grid, "road", 10, 11, net)).toBe(true);
    expect(canBuildOn(grid, "road", 20, 20, net)).toBe(false);
    expect(canBuildOn(grid, "road", 20, 20)).toBe(true); // 3-arg form unchanged
  });

  it("G5: rival track is not a seed; demolish rebuilds the component", () => {
    const t = createTrack();
    build(t, "road", [[10, 10], [11, 10], [12, 10], [13, 10]], 1);
    const factories = [{ ownerId: 1, tx: 10, ty: 10 }];
    const harvesters: { ownerId: number; tx: number; ty: number }[] = [];
    let net = playerNetwork(t, 1, factories, harvesters);
    expect(net.has(tIdx(13, 10))).toBe(true);
    demolishTile(t, "road", 11, 10);
    net = playerNetwork(t, 1, factories, harvesters);
    expect(net.has(tIdx(10, 10))).toBe(true);
    expect(net.has(tIdx(13, 10))).toBe(false);
    expect(canBuildOn(flatGrid(), "road", 13, 11, net)).toBe(false);
  });

  it("W2: a rival's factory does not seed your network, and vice versa", () => {
    const t = createTrack();
    build(t, "road", [[10, 10], [11, 10]], 1);
    build(t, "road", [[30, 30], [31, 30]], 2);
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
    const rich = { stone: 999, ore: 999 };
    const fromSeed = previewDrag(grid, t, "road", rich, 5, 5, 8, 5, true, net);
    expect(fromSeed.tiles.length).toBe(4);
    const fromEmpty = previewDrag(grid, t, "road", rich, 20, 20, 24, 20, true, net);
    expect(fromEmpty.tiles.length).toBe(0);
    expect(fromEmpty.truncated).toBe(true);
  });

  it("refuses industry footprints and out-of-bounds", () => {
    const grid = flatGrid();
    grid.occupancy[tIdx(12, 12)] = 0;
    expect(canBuildOn(grid, "road", 12, 12)).toBe(false);
    expect(canBuildOn(grid, "road", -1, 0)).toBe(false);
    expect(canBuildOn(grid, "road", MAP_W, 0)).toBe(false);
  });
});

describe("E5 costs", () => {
  it("charges the transport cost on virgin ground", () => {
    const t = createTrack();
    expect(tileCost(t, "road", 1, 1)).toEqual(TRANSPORT.road.cost);
    expect(tileCost(t, "rail", 1, 1)).toEqual(TRANSPORT.rail.cost);
  });

  it("is free over existing track of the same kind", () => {
    const t = createTrack();
    buildTile(t, "road", 1, 1);
    expect(tileCost(t, "road", 1, 1)).toEqual({});
  });

  it("TK-002: crossing the other layer pays the FULL cost — no upgrade pricing", () => {
    const t = createTrack();
    buildTile(t, "road", 1, 1);
    // Rail over an existing road tile is NOT an upgrade: it is an independent
    // network laying its own layer across the road (a level crossing), priced
    // at the full rail cost. Symmetrically, road over rail pays full road.
    expect(tileCost(t, "rail", 1, 1)).toEqual(TRANSPORT.rail.cost);
    buildTile(t, "rail", 1, 1);
    const t2 = createTrack();
    buildTile(t2, "rail", 1, 1);
    expect(tileCost(t2, "road", 1, 1)).toEqual(TRANSPORT.road.cost);
  });

  it("TK-002: a crossing tile keeps both layers and is a real crossing", () => {
    const t = createTrack();
    buildTile(t, "road", 3, 3, 1);
    buildTile(t, "rail", 3, 3, 1);
    expect(hasTrack(t, "road", 3, 3)).toBe(true);
    expect(hasTrack(t, "rail", 3, 3)).toBe(true);
    expect(isCrossing(t, 3, 3)).toBe(true);
    // each layer still autotiles on its own: a rail neighbour only lights the
    // rail mask, never the road mask
    buildTile(t, "rail", 3, 4, 1);
    expect(bitsAt(t, "rail", 3, 3) & SW).toBeTruthy();
    expect(bitsAt(t, "road", 3, 3)).toBe(0);
    // demolishing one layer leaves the other standing
    demolishTile(t, "road", 3, 3);
    expect(hasTrack(t, "road", 3, 3)).toBe(false);
    expect(hasTrack(t, "rail", 3, 3)).toBe(true);
    expect(isCrossing(t, 3, 3)).toBe(false);
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
  const rich = { stone: 999, ore: 999 };

  it("dragging across 10 tiles charges exactly 10× the per-tile cost", () => {
    const grid = flatGrid(), t = createTrack();
    const p = previewDrag(grid, t, "road", rich, 5, 5, 14, 5);
    expect(p.tiles).toHaveLength(10);
    expect(p.cost).toEqual({ stone: 10 * TRANSPORT.road.cost.stone! });
    expect(p.truncated).toBe(false);
  });

  it("dragging into water truncates at the last legal tile", () => {
    const grid = flatGrid(), t = createTrack();
    grid.terrain[tIdx(9, 5)] = WATER;
    const p = previewDrag(grid, t, "road", rich, 5, 5, 14, 5);
    expect(p.truncated).toBe(true);
    expect(p.tiles).toHaveLength(4);            // 5,6,7,8
    expect(p.tiles.at(-1)).toEqual([8, 5]);
  });

  it("dragging over existing road of the same type is free, no double charge", () => {
    const grid = flatGrid(), t = createTrack();
    build(t, "road", [[5, 5], [6, 5], [7, 5]]);
    const p = previewDrag(grid, t, "road", rich, 5, 5, 9, 5);
    expect(p.tiles).toHaveLength(5);
    expect(p.cost).toEqual({ stone: 2 });       // only 8,5 and 9,5 are new
  });

  it("an unaffordable drag previews and builds only the affordable prefix", () => {
    const grid = flatGrid(), t = createTrack();
    const purse = { stone: 3 };
    const p = previewDrag(grid, t, "road", purse, 5, 5, 14, 5);
    expect(p.tiles).toHaveLength(3);
    expect(p.cost).toEqual({ stone: 3 });
    expect(p.unaffordable.length).toBeGreaterThan(0);
    const c = commitDrag(t, "road", p);
    expect(c.built).toHaveLength(3);
    expect(hasTrack(t, "road", 7, 5)).toBe(true);
    expect(hasTrack(t, "road", 8, 5)).toBe(false);
  });

  it("commits a contiguous run that autotiles into a straight line", () => {
    const grid = flatGrid(), t = createTrack();
    const p = previewDrag(grid, t, "road", rich, 5, 5, 9, 5);
    commitDrag(t, "road", p);
    // interior tiles connect both ways along the x axis (NW|SE)
    for (const x of [6, 7, 8]) expect(bitsAt(t, "road", x, 5)).toBe(SE | NW);
    expect(bitsAt(t, "road", 5, 5)).toBe(SE);
    expect(bitsAt(t, "road", 9, 5)).toBe(NW);
  });

  it("rail drags truncate on rough ground where road would pass", () => {
    const grid = flatGrid(), t = createTrack();
    grid.terrain[tIdx(8, 5)] = ROUGH;
    const rail = previewDrag(grid, t, "rail", rich, 5, 5, 12, 5);
    expect(rail.truncated).toBe(true);
    expect(rail.tiles).toHaveLength(3);
    const road = previewDrag(grid, t, "road", rich, 5, 5, 12, 5);
    expect(road.truncated).toBe(false);
    expect(road.tiles).toHaveLength(8);
  });

  it("an L-drag charges for the corner tile exactly once", () => {
    const grid = flatGrid(), t = createTrack();
    const p = previewDrag(grid, t, "road", rich, 5, 5, 8, 8);
    expect(p.tiles).toHaveLength(7);            // 4 across + 3 down, corner once
    expect(new Set(p.tiles.map(([x, y]) => `${x},${y}`)).size).toBe(7);
    expect(p.cost).toEqual({ stone: 7 });
  });
});

describe("E5 connectivity (the base E6 scores on)", () => {
  it("flood fills a connected run and excludes a detached one", () => {
    const t = createTrack();
    build(t, "road", [[5, 5], [6, 5], [7, 5]]);
    build(t, "road", [[20, 20]]);
    const set = connectedTiles(t, "road", 5, 5);
    expect(set.size).toBe(3);
    expect(set.has(tIdx(20, 20))).toBe(false);
    expect(areConnected(t, "road", 5, 5, 7, 5)).toBe(true);
    expect(areConnected(t, "road", 5, 5, 20, 20)).toBe(false);
  });

  it("requires BOTH neighbours to set the facing bit", () => {
    const t = createTrack();
    build(t, "road", [[5, 5], [6, 5]]);
    // forge a one-sided bit: (7,5) has no track at all
    t.road[tIdx(6, 5)] |= SE;
    expect(areConnected(t, "road", 5, 5, 7, 5)).toBe(false);
  });

  it("does not leak between road and rail across a level crossing", () => {
    const t = createTrack();
    build(t, "road", [[10, 10], [11, 10]]);
    build(t, "rail", [[11, 10], [11, 11]]);
    const road = connectedTiles(t, "road", 10, 10);
    expect(road.has(tIdx(11, 11))).toBe(false);
    expect(areConnected(t, "rail", 11, 10, 11, 11)).toBe(true);
  });

  it("breaking the middle splits one network into two", () => {
    const t = createTrack();
    build(t, "road", [[5, 5], [6, 5], [7, 5], [8, 5]]);
    expect(connectedTiles(t, "road", 5, 5).size).toBe(4);
    demolishTile(t, "road", 7, 5);
    expect(connectedTiles(t, "road", 5, 5).size).toBe(2);
    expect(areConnected(t, "road", 5, 5, 8, 5)).toBe(false);
  });

  it("survives a loop without infinite recursion", () => {
    const t = createTrack();
    build(t, "road", [
      [5, 5], [6, 5], [7, 5],
      [5, 6], [7, 6],
      [5, 7], [6, 7], [7, 7],
    ]);
    expect(connectedTiles(t, "road", 5, 5).size).toBe(8);
  });
});

describe("Y4 RoadBits remap to OpenTTD (all 16 masks)", () => {
  // Acceptance (Y4/Y6): "your bitmask → OpenTTD RoadBits remap is exhaustively
  // tested across all 16 values." The remap must be a bijective relabelling of
  // the SAME four compass directions, never a rotation.

  it("single directions map to OpenTTD's reversed numbering", () => {
    // our order NE=1, SE=2, SW=4, NW=8 → OpenTTD NE=8, SE=4, SW=2, NW=1
    expect(OTTD_ROADBIT[NE]).toBe(8);
    expect(OTTD_ROADBIT[SE]).toBe(4);
    expect(OTTD_ROADBIT[SW]).toBe(2);
    expect(OTTD_ROADBIT[NW]).toBe(1);
  });

  it("every one of the 16 masks survives the round trip unchanged", () => {
    for (let mask = 0; mask < 16; mask++) {
      expect(fromOpenttdRoadBits(toOpenttdRoadBits(mask)), `mask ${mask}`).toBe(mask);
    }
  });

  it("the round trip preserves each piece's painted neighbours (no 90° rotation)", () => {
    // Same four compass directions must be reached regardless of numbering.
    const dirsOf = (bits: number) => DIRS.filter((d) => (bits & d) !== 0).sort((a, b) => a - b);
    for (let mask = 0; mask < 16; mask++) {
      const ottd = toOpenttdRoadBits(mask);
      expect(dirsOf(fromOpenttdRoadBits(ottd)), `mask ${mask}`).toEqual(dirsOf(mask));
    }
  });

  it("maps representative layouts to their OpenTTD RoadBits value", () => {
    expect(toOpenttdRoadBits(0)).toBe(0);
    expect(toOpenttdRoadBits(15)).toBe(15);          // full crossing: same numeric
    expect(toOpenttdRoadBits(NE | SE)).toBe(8 | 4);  // our right-edge pair keeps both its edges
    expect(toOpenttdRoadBits(SW | NW)).toBe(2 | 1);  // the left-edge mirror keeps both its edges
    expect(toOpenttdRoadBits(NE | NW)).toBe(8 | 1);  // our north corner stays the north corner
  });

  it("never returns a bit above the low nibble", () => {
    for (let mask = 0; mask < 16; mask++) expect(toOpenttdRoadBits(mask)).toBeLessThanOrEqual(15);
  });
});

describe("E5 renderer integration", () => {
  it("every mask a real map produces resolves to a real atlas sprite", () => {
    const grid = generateMap(4242);
    const t = createTrack();
    // lay a long snake that hits water, rough and industry footprints
    for (let x = 2; x < 46; x++) {
      if (canBuildOn(grid, "road", x, 24)) buildTile(t, "road", x, 24);
      if (canBuildOn(grid, "rail", 24, x)) buildTile(t, "rail", 24, x);
    }
    const list = buildDrawList(
      { grid, roadBits: drawBits(t, "road"), railBits: drawBits(t, "rail") },
      { x0: 0, y0: 0, x1: MAP_W - 1, y1: MAP_H - 1 },
    );
    const track = list.filter((d) => /^(road|rail)_/.test(d.sprite));
    expect(track.length).toBeGreaterThan(20);
    for (const d of track) expect(atlas.has(d.sprite), d.sprite).toBe(true);
  });
});
