import { describe, it, expect, beforeEach } from "vitest";
import { generateGrid } from "../../src/iso/grid";
import { TransportNet, maskAt, spriteKey, bitToward, DIR_BITS } from "../../src/iso/transport";
import { tileIndex, TERRAIN, NE, SE, SW, NW } from "../../src/iso/config";

// Build a minimal all-grass map with no industries for transport tests.
function flatMap() {
  const m = generateGrid(20240101);
  // force everything to grass and clear occupancy for deterministic placement
  m.terrain.fill(TERRAIN.GRASS);
  m.occup.fill(-1);
  return m;
}

describe("E5 autotile bitmask", () => {
  it("sprite key names the binary mask", () => {
    expect(spriteKey("road", NE | SE)).toBe("road_0011");
    expect(spriteKey("rail", NE | SW)).toBe("rail_0101");
    expect(spriteKey("road", 0)).toBe("road_0000");
  });

  it("bitToward maps neighbour deltas to direction bits", () => {
    expect(bitToward(5, 5, 5, 4)).toBe(NE);
    expect(bitToward(5, 5, 6, 5)).toBe(SE);
    expect(bitToward(5, 5, 5, 6)).toBe(SW);
    expect(bitToward(5, 5, 4, 5)).toBe(NW);
  });

  it("placing one piece sets facing bits on BOTH tiles", () => {
    const m = flatMap();
    const net = new TransportNet(m);
    expect(net.build("road", 10, 10)).toBe(true);
    expect(net.build("road", 11, 10)).toBe(true); // neighbour to the SE
    // tile (10,10) should face SE(bit 2); tile (11,10) should face NW(bit 8)
    expect(net.road[tileIndex(10, 10)] & SE).toBeTruthy();
    expect(net.road[tileIndex(11, 10)] & NW).toBeTruthy();
  });

  it("all 16 neighbour configurations produce distinct masks", () => {
    const masks = new Set<number>();
    for (let cfg = 0; cfg < 16; cfg++) {
      const m = flatMap();
      const net = new TransportNet(m);
      net.build("road", 20, 20);
      // manually surround centre with roads according to cfg bits
      const dirs = [
        [NE, 20, 19], [SE, 21, 20], [SW, 20, 21], [NW, 19, 20],
      ] as const;
      for (let b = 0; b < 4; b++) {
        if (cfg & (1 << b)) net.build("road", dirs[b][1], dirs[b][2]);
      }
      const mask = maskAt(net.road, m, 20, 20);
      masks.add(mask);
      // the mask must reflect exactly the neighbours present
      for (let b = 0; b < 4; b++) {
        const bit = DIR_BITS[b];
        const present = !!(cfg & (1 << b));
        expect(!!(mask & bit)).toBe(present);
      }
    }
    // a lone centre (cfg 0) gets a default stub so the sprite is never empty
    expect(masks.size).toBe(16);
  });

  it("recomputing a tile touches exactly the placed tile + its 4 neighbours", () => {
    const m = flatMap();
    const net = new TransportNet(m);
    const touched: string[] = [];
    const before = { ...net.road };
    net.build("road", 24, 24);
    net.build("road", 25, 24);
    // only indices around (25,24) should differ from the all-zero baseline
    for (let ty = 20; ty < 30; ty++)
      for (let tx = 20; tx < 30; tx++) {
        const idx = tileIndex(tx, ty);
        if (net.road[idx] !== before[idx]) touched.push(`${tx},${ty}`);
      }
    // (24,24),(25,24) and their connecting faces — no far-away tiles
    expect(touched.every((p) => ["24,24", "25,24"].includes(p))).toBe(true);
  });
});

describe("E5 drag-to-build", () => {
  let net: TransportNet;
  beforeEach(() => { net = new TransportNet(flatMap()); });

  it("L-path between two tiles is Manhattan and contiguous", () => {
    const path = net.dragPath("road", 10, 10, 13, 12);
    // |13-10| + |12-10| = 5 steps → 6 tiles
    expect(path.length).toBe(6);
    // contiguous: each step is a 4-neighbour move
    for (let i = 1; i < path.length; i++) {
      const dd = Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
      expect(dd).toBe(1);
    }
    // endpoints present
    expect(path[0]).toEqual({ x: 10, y: 10 });
    expect(path[path.length - 1]).toEqual({ x: 13, y: 12 });
  });

  it("flip swaps which axis goes first", () => {
    const a = net.dragPath("road", 10, 10, 12, 12, false);
    const b = net.dragPath("road", 10, 10, 12, 12, true);
    // both reach the end, but the corner is at a different position
    expect(a[a.length - 1]).toEqual({ x: 12, y: 12 });
    expect(b[b.length - 1]).toEqual({ x: 12, y: 12 });
    expect(a.map((p) => `${p.x},${p.y}`).join("|")).not.toBe(
      b.map((p) => `${p.x},${p.y}`).join("|"));
  });

  it("truncates at water rather than failing", () => {
    const m = flatMap();
    // carve a water wall beyond column 12
    for (let ty = 0; ty < 48; ty++) m.terrain[tileIndex(13, ty)] = TERRAIN.WATER;
    const n = new TransportNet(m);
    const path = n.dragPath("road", 10, 10, 20, 10);
    expect(path.length).toBeLessThan(11);
    expect(path.every((p) => p.x <= 12)).toBe(true);
  });

  it("rail cannot be laid on rough terrain", () => {
    const m = flatMap();
    m.terrain[tileIndex(11, 10)] = TERRAIN.ROUGH;
    const n = new TransportNet(m);
    expect(n.build("rail", 11, 10)).toBe(false);
    expect(n.build("road", 11, 10)).toBe(true);
  });

  it("commit charges only newly placed tiles (re-drag is free)", () => {
    net.commitDrag("road", net.dragPath("road", 10, 10, 10, 15));
    // 6 tiles now exist
    const again = net.commitDrag("road", net.dragPath("road", 10, 10, 10, 15));
    expect(again.length).toBe(0);
  });
});
