import { describe, expect, it } from "vitest";
import { buildTerrainMesh, hash2, worldOfCorner, TERRAIN_GRASS, TERRAIN_WATER, TERRAIN_SAND, TERRAIN_ROUGH, type TerrainMapInput } from "../../src/iso/terrain-gl/index";
import { TERRAIN_FS } from "../../src/iso/terrain-gl/shaders";
import { buildFields, buildVertexShade, HH, HW, LEVEL_PX, signedDistance, updateFieldsRegion } from "../../src/iso/terrain-gl/mesh";

const W = (a: number, b: number): [number, number] => [(a - b) * 32, (a + b) * 16];

function flatMap(w: number, h: number, seed = 1): TerrainMapInput {
  return { w, h, terrain: new Uint8Array(w * h), seed };
}

/** Circular island with a SAND ring, a ROUGH blob and a raised centre. */
function islandMap(w = 144, h = 144, seed = 7): TerrainMapInput {
  const terrain = new Uint8Array(w * h);
  const rivers = new Uint8Array(w * h);
  const heights = new Uint8Array((w + 1) * (h + 1));
  const cx = w / 2, cy = h / 2, R = w * 0.35;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      let t = TERRAIN_WATER;
      if (d < R - 2) t = TERRAIN_GRASS;
      else if (d < R) t = TERRAIN_SAND;
      if (t === TERRAIN_GRASS && Math.hypot(x - cx - 20, y - cy) < 8) t = TERRAIN_ROUGH;
      terrain[y * w + x] = t;
      if (t === TERRAIN_GRASS && Math.abs(x - cx) < 1 && y < cy) rivers[y * w + x] = 1;
    }
  }
  for (let j = 0; j <= h; j++)
    for (let i = 0; i <= w; i++) {
      const d = Math.hypot(i - cx, j - cy);
      heights[j * (w + 1) + i] = d < R * 0.3 ? Math.min(4, Math.floor((R * 0.3 - d) / 4)) : 0;
    }
  return { w, h, terrain, rivers, heights, seed };
}

describe("terrain water shader", () => {
  it("applies animated wave normals at all water depths without a deep-water cutoff", () => {
    const waterSection = TERRAIN_FS.split("// 4. Water")[1].split("// 5. Composite")[0];
    expect(waterSection).toContain("if (dShore < 0.9)");
    expect(waterSection).toContain("if (uWaterAnim > 0.0)");
    expect(waterSection).toContain("textureGrad(uWaterN");
    expect(waterSection).toContain("water += diff");
    expect(waterSection).toContain("water += spec");
    expect(waterSection).toContain("float deepness = smoothstep(1.0, 9.0, depth)");
    expect(waterSection).not.toContain("clamp(-dShore, 0.0, 8.0)");
  });
});

describe("hash2", () => {
  it("is deterministic and in [0,1)", () => {
    for (let s = 0; s < 50; s++)
      for (let x = -3; x < 4; x++)
        for (let y = -3; y < 4; y++) {
          const a = hash2(s, x, y), b = hash2(s, x, y);
          expect(a).toBe(b);
          expect(a).toBeGreaterThanOrEqual(0);
          expect(a).toBeLessThan(1);
        }
  });
  it("changes with seed and coordinates", () => {
    expect(hash2(1, 0, 0)).not.toBe(hash2(2, 0, 0));
    expect(hash2(1, 1, 0)).not.toBe(hash2(1, 0, 1));
    // reasonably uniform: mean ≈ 0.5
    let s = 0;
    for (let i = 0; i < 10000; i++) s += hash2(42, i % 100, Math.floor(i / 100));
    expect(Math.abs(s / 10000 - 0.5)).toBeLessThan(0.02);
  });
});

describe("worldOfCorner", () => {
  it("matches W(i,j) = [(i-j)*32, (i+j)*16]", () => {
    for (let i = 0; i <= 144; i += 7)
      for (let j = 0; j <= 144; j += 5) expect(worldOfCorner(i, j)).toEqual(W(i, j));
    expect(HW).toBe(32);
    expect(HH).toBe(16);
  });
  it("raises a corner by LEVEL_PX per level", () => {
    const [x0, y0] = worldOfCorner(10, 4, 0);
    const [x3, y3] = worldOfCorner(10, 4, 3);
    expect(x3).toBe(x0);
    expect(y0 - y3).toBe(3 * LEVEL_PX);
    expect(LEVEL_PX).toBe(8);
  });
});

describe("buildTerrainMesh", () => {
  it("has w*h*2 triangles and one vertex per lattice corner", () => {
    const m = buildTerrainMesh(flatMap(144, 144));
    expect(m.indices.length).toBe(144 * 144 * 6);
    expect(m.positions.length).toBe(145 * 145 * 2);
    expect(m.uvTile.length).toBe(145 * 145 * 2);
    expect(m.indices).toBeInstanceOf(Uint32Array);
    for (let i = 0; i < m.indices.length; i++) expect(m.indices[i]).toBeLessThan(145 * 145);
  });

  it("puts every tile diamond exactly on W(i,j), with heights applied", () => {
    const map = islandMap(24, 20);
    const m = buildTerrainMesh(map);
    const w1 = map.w + 1;
    const lvl = (i: number, j: number): number => map.heights![j * w1 + i];
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        const base = (ty * map.w + tx) * 6;
        const used = new Set<number>();
        for (let k = 0; k < 6; k++) used.add(m.indices[base + k]);
        // the two triangles cover exactly the four corners of this tile
        expect(used).toEqual(new Set([ty * w1 + tx, ty * w1 + tx + 1, (ty + 1) * w1 + tx, (ty + 1) * w1 + tx + 1]));
        const corners: Array<[number, number]> = [[tx, ty], [tx + 1, ty], [tx + 1, ty + 1], [tx, ty + 1]];
        for (const [i, j] of corners) {
          const v = j * w1 + i;
          const [ex, ey] = W(i, j);
          expect(m.positions[v * 2]).toBe(ex);
          expect(m.positions[v * 2 + 1]).toBe(ey - lvl(i, j) * LEVEL_PX);
          expect(m.uvTile[v * 2]).toBe(i);
          expect(m.uvTile[v * 2 + 1]).toBe(j);
        }
      }
    }
  });

  it("is flat (shade == 1 everywhere) without heights", () => {
    const s = buildVertexShade(flatMap(10, 10));
    for (let i = 0; i < s.length; i++) expect(s[i]).toBe(1);
  });

  it("lights slopes facing the upper-left brighter than slopes facing away", () => {
    const w = 8, h = 8;
    const heights = new Uint8Array((w + 1) * (h + 1));
    // a ramp rising toward +i and +j (toward screen lower-right) → faces upper-left
    for (let j = 0; j <= h; j++) for (let i = 0; i <= w; i++) heights[j * (w + 1) + i] = Math.min(4, Math.floor((i + j) / 4));
    const s = buildVertexShade({ w, h, terrain: new Uint8Array(w * h), heights, seed: 1 });
    expect(s[4 * (w + 1) + 4]).toBeGreaterThan(1);
    const heights2 = new Uint8Array((w + 1) * (h + 1));
    for (let j = 0; j <= h; j++) for (let i = 0; i <= w; i++) heights2[j * (w + 1) + i] = Math.min(4, Math.floor((16 - i - j) / 4));
    const s2 = buildVertexShade({ w, h, terrain: new Uint8Array(w * h), heights: heights2, seed: 1 });
    expect(s2[4 * (w + 1) + 4]).toBeLessThan(1);
  });
});

describe("distance fields", () => {
  it("signed distance is 0.5 on a boundary cell, -0.5 just across, and grows away from the edge", () => {
    const w = 9, h = 1;
    const mask = new Uint8Array([1, 1, 1, 1, 0, 0, 0, 0, 0]);
    const d = signedDistance(w, h, mask);
    expect(d[3]).toBeCloseTo(-0.5);
    expect(d[4]).toBeCloseTo(0.5);
    expect(d[8]).toBeCloseTo(4.5);
    expect(d[0]).toBeCloseTo(-3.5);
  });

  it("has the right sign on a synthetic island (water negative, land positive)", () => {
    const map = islandMap(64, 64);
    const f = buildFields(map);
    const cx = 32, cy = 32;
    // deep sea corner
    expect(f.shore[0]).toBeLessThan(-4);
    // an inland tile far from water (the island's river ends beside the
    // centre tile, so the centre itself is only ~0.5 from water)
    const li = (cy + 6) * 64 + (cx + 10);
    expect(map.terrain[li]).toBe(TERRAIN_GRASS);
    expect(f.shore[li]).toBeGreaterThan(4);
    // packed byte: 0 ↔ -8, 255 ↔ +8, land/water crossing at 127/128
    expect(f.rgba[0]).toBeLessThan(64);
    expect(f.rgba[li * 4]).toBeGreaterThan(190);
    // every tile: sign must agree with the terrain code
    for (let i = 0; i < 64 * 64; i++) {
      const water = map.terrain[i] === TERRAIN_WATER || map.rivers![i] === 1;
      if (water) expect(f.shore[i]).toBeLessThan(0);
      else expect(f.shore[i]).toBeGreaterThan(0);
      if (map.terrain[i] === TERRAIN_ROUGH) expect(f.rough[i]).toBeLessThan(0); else expect(f.rough[i]).toBeGreaterThan(0);
      if (map.terrain[i] === TERRAIN_SAND) expect(f.sand[i]).toBeLessThan(0); else expect(f.sand[i]).toBeGreaterThan(0);
    }
    // river channel is water and inside the river field
    const ri = 14 * 64 + cx;
    expect(map.rivers![ri]).toBe(1);
    expect(f.river[ri]).toBeLessThan(0);
    expect(f.codes[ri] & 0x80).toBe(0x80);
  });

  it("region update matches a full rebuild", () => {
    const map = islandMap(48, 48);
    const f = buildFields(map);
    // dig a lake
    for (let y = 20; y < 24; y++) for (let x = 30; x < 34; x++) map.terrain[y * 48 + x] = TERRAIN_WATER;
    updateFieldsRegion(map, f, 30, 20, 33, 23);
    const g = buildFields(map);
    for (let i = 0; i < 48 * 48; i++) {
      expect(f.rgba[i * 4]).toBe(g.rgba[i * 4]);
      expect(f.rgba[i * 4 + 1]).toBe(g.rgba[i * 4 + 1]);
      expect(f.rgba[i * 4 + 2]).toBe(g.rgba[i * 4 + 2]);
      expect(f.rgba[i * 4 + 3]).toBe(g.rgba[i * 4 + 3]);
      expect(f.codes[i]).toBe(g.codes[i]);
    }
  });
});

describe("performance", () => {
  it("builds mesh + shade + fields for 144x144 in < 30 ms", () => {
    const map = islandMap(144, 144);
    // warm up JIT once, then time
    buildTerrainMesh(map); buildVertexShade(map); buildFields(map);
    const t0 = performance.now();
    buildTerrainMesh(map);
    buildVertexShade(map);
    buildFields(map);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(30);
  });
});
