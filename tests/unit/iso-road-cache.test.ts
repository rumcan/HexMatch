import { describe, it, expect } from "vitest";
import {
  DEFAULT_ROAD_STYLE, ROAD_CHUNK_H, ROAD_CHUNK_W, RoadCache,
  roadTilesIn, screenToGround, tilesForRect,
} from "../../src/iso/road-renderer";
import { NE, SE, SW, NW } from "../../src/iso/track";
import { HW, HH, MAP_W, MAP_H } from "../../src/game/config";

const PRESENT = 0b10000;
const put = (arr: Uint8Array, tx: number, ty: number, mask: number) => {
  arr[ty * MAP_W + tx] = PRESENT | mask;
};
const blank = () => new Uint8Array(MAP_W * MAP_H);

describe("ground projection round trip", () => {
  it("inverts the projection exactly at lattice points", () => {
    for (const [u, v] of [[0, 0], [3, 9], [70.5, 12], [143, 143], [8.25, 3.75]]) {
      const [x, y] = [(u - v) * HW, (u + v) * HH];
      const [bu, bv] = screenToGround(x, y);
      expect(bu).toBeCloseTo(u, 9);
      expect(bv).toBeCloseTo(v, 9);
    }
  });

  it("handles negative projected X, which is half the map", () => {
    // Everything with ty > tx projects to a negative X. A cache that only
    // works for positive coordinates works for half the island.
    const [u, v] = screenToGround(-512, 256);
    expect(u).toBeCloseTo(0, 9);
    expect(v).toBeCloseTo(16, 9);
  });
});

describe("tilesForRect", () => {
  it("covers every tile whose centre lies in the rectangle", () => {
    const r = tilesForRect(0, 0, ROAD_CHUNK_W, ROAD_CHUNK_H);
    for (let ty = 0; ty < 20; ty++) {
      for (let tx = 0; tx < 20; tx++) {
        const [cx, cy] = [(tx + 0.5 - ty - 0.5) * HW, (tx + 0.5 + ty + 0.5) * HH];
        if (cx < 0 || cx > ROAD_CHUNK_W || cy < 0 || cy > ROAD_CHUNK_H) continue;
        expect(tx).toBeGreaterThanOrEqual(r.tx0);
        expect(tx).toBeLessThanOrEqual(r.tx1);
        expect(ty).toBeGreaterThanOrEqual(r.ty0);
        expect(ty).toBeLessThanOrEqual(r.ty1);
      }
    }
  });

  it("expands past the rectangle, so a road crossing the edge is complete", () => {
    const tight = tilesForRect(1000, 1000, 1000, 1000);   // a degenerate point
    // Even a zero-area rectangle pulls in a neighbourhood, because a road
    // centred outside it still paints into it.
    expect(tight.tx1 - tight.tx0).toBeGreaterThanOrEqual(2);
    expect(tight.ty1 - tight.ty0).toBeGreaterThanOrEqual(2);
  });

  it("clamps to the map", () => {
    const r = tilesForRect(-100000, -100000, -99000, -99000);
    expect(r.tx0).toBeGreaterThanOrEqual(0);
    expect(r.ty0).toBeGreaterThanOrEqual(0);
    expect(r.tx1).toBeLessThan(MAP_W);
    expect(r.ty1).toBeLessThan(MAP_H);
  });
});

describe("roadTilesIn", () => {
  it("reads paved and dirt tiles, and lets paved win where both are set", () => {
    const road = blank(), dirt = blank();
    put(road, 5, 5, NE);
    put(dirt, 6, 5, SW);
    put(dirt, 5, 5, SE);            // same tile as the paved one
    const tiles = roadTilesIn({ roadBits: road, dirtBits: dirt }, 4, 4, 7, 7);
    expect(tiles).toHaveLength(2);
    const at55 = tiles.find((t) => t.tx === 5 && t.ty === 5)!;
    expect(at55.material).toBe("paved");
    // and it used the PAVED byte's mask, not the dirt one
    expect(at55.mask).toBe(NE);
  });

  it("ignores empty bytes but keeps PRESENT-only tiles", () => {
    const road = blank();
    put(road, 2, 2, 0);
    const tiles = roadTilesIn({ roadBits: road, dirtBits: blank() }, 0, 0, 5, 5);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].mask).toBe(0);
  });

  it("gives a dirt tile a transition only where it meets paved road", () => {
    const road = blank(), dirt = blank();
    put(dirt, 10, 10, NE | SE);
    put(road, 10, 9, SW);           // paved neighbour to the NE
    const world = { roadBits: road, dirtBits: dirt };
    const tile = roadTilesIn(world, 10, 10, 10, 10)[0];
    expect(tile.material).toBe("dirt");
    expect(tile.transitions.map((t) => t.dir)).toEqual([NE]);
  });

  it("survives a world with no road arrays at all", () => {
    expect(roadTilesIn({}, 0, 0, 10, 10)).toEqual([]);
  });
});

describe("RoadCache", () => {
  /** The cache never allocates in node; `paint` must cope with that. */
  const noSurface = () => null;

  it("reports empty stats before anything is drawn", () => {
    const c = new RoadCache();
    expect(c.stats()).toMatchObject({ entries: 0, bytes: 0, hits: 0, misses: 0 });
  });

  it("clears and records why", () => {
    const c = new RoadCache();
    c.clear("world");
    expect(c.stats().lastInvalidation).toBe("world");
  });

  it("records a style bump as an invalidation", () => {
    const c = new RoadCache();
    c.bumpStyle("style");
    expect(c.stats().lastInvalidation).toBe("style");
    expect(c.stats().entries).toBe(0);
  });

  it("counts a miss for every chunk it cannot allocate, and caches nothing", () => {
    const c = new RoadCache();
    const cam = { x: 0, y: 0, zoom: 1, vw: 800, vh: 600 };
    const road = blank();
    put(road, 4, 4, NE | SW);
    const blits = c.paint(
      {} as unknown as CanvasRenderingContext2D,
      cam, { roadBits: road, dirtBits: blank() }, DEFAULT_ROAD_STYLE, noSurface,
    );
    expect(blits).toBe(0);
    expect(c.stats().misses).toBeGreaterThan(0);
    expect(c.stats().entries).toBe(0);
  });

  it("invalidating a tile is a no-op on an empty cache but still records why", () => {
    const c = new RoadCache();
    c.invalidateTile(10, 10, "build");
    expect(c.stats().lastInvalidation).toBe("build");
  });

  it("walks every chunk covering the viewport", () => {
    // One chunk is 512x256 world pixels; a 1200x700 viewport at 1x therefore
    // spans several, and each must be visited exactly once.
    const c = new RoadCache();
    const cam = { x: 0, y: 0, zoom: 1, vw: 1200, vh: 700 };
    c.paint(
      {} as unknown as CanvasRenderingContext2D,
      cam, { roadBits: blank(), dirtBits: blank() }, DEFAULT_ROAD_STYLE, noSurface,
    );
    const wide = Math.floor(1200 / ROAD_CHUNK_W) + 1;
    const tall = Math.floor(700 / ROAD_CHUNK_H) + 1;
    expect(c.stats().misses).toBe(wide * tall);
  });

  it("covers fewer chunks when zoomed in, because less world is on screen", () => {
    const near = new RoadCache(), far = new RoadCache();
    const world = { roadBits: blank(), dirtBits: blank() };
    const cam = { x: 0, y: 0, vw: 1200, vh: 700 };
    const ctx = {} as unknown as CanvasRenderingContext2D;
    near.paint(ctx, { ...cam, zoom: 2 }, world, DEFAULT_ROAD_STYLE, noSurface);
    far.paint(ctx, { ...cam, zoom: 0.5 }, world, DEFAULT_ROAD_STYLE, noSurface);
    expect(near.stats().misses).toBeLessThan(far.stats().misses);
  });
});

describe("road style", () => {
  it("ships a complete flat fallback, so a missing texture is not a missing road", () => {
    for (const m of [DEFAULT_ROAD_STYLE.paved, DEFAULT_ROAD_STYLE.dirt]) {
      expect(m.image).toBeNull();
      expect(m.flat).toMatch(/^#[0-9a-f]{6}$/i);
      expect(m.shoulder).toMatch(/^#[0-9a-f]{6}$/i);
      expect(m.repeat).toBeGreaterThan(0);
    }
    expect(DEFAULT_ROAD_STYLE.paintAlpha).toBeGreaterThan(0);
    expect(DEFAULT_ROAD_STYLE.paintAlpha).toBeLessThanOrEqual(1);
  });

  it("keeps the material repeat in the range the art was tuned for", () => {
    // Grain has to read against 64x32 tiles: much below 2 and the texture
    // turns to noise, much above 4 and one blotch spans several tiles.
    for (const m of [DEFAULT_ROAD_STYLE.paved, DEFAULT_ROAD_STYLE.dirt]) {
      expect(m.repeat).toBeGreaterThanOrEqual(2);
      expect(m.repeat).toBeLessThanOrEqual(4);
    }
  });
});

describe("direction bits are the ones the simulation uses", () => {
  it("keeps the geometry aligned with track.ts", () => {
    // If these ever drift, roads render rotated with no other symptom.
    expect([NE, SE, SW, NW]).toEqual([1, 2, 4, 8]);
  });
});
