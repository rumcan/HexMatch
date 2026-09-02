import { describe, it, expect } from "vitest";
import { generateGrid, hashMap, industryAt } from "../../src/iso/grid";
import { MAP_W, MAP_H, TERRAIN, tileIndex, INDUSTRY_TYPES, INDUSTRIES } from "../../src/iso/config";

describe("E3 grid generation", () => {
  it("uses flat typed arrays of the correct size", () => {
    const m = generateGrid(1234);
    expect(m.terrain).toBeInstanceOf(Uint8Array);
    expect(m.occup).toBeInstanceOf(Int16Array);
    expect(m.terrain.length).toBe(MAP_W * MAP_H);
    expect(m.occup.length).toBe(MAP_W * MAP_H);
  });

  it("is byte-identical for the same seed (determinism)", () => {
    const a = generateGrid(99);
    const b = generateGrid(99);
    expect(hashMap(a)).toBe(hashMap(b));
    expect(Buffer.from(a.terrain).toString("hex")).toBe(Buffer.from(b.terrain).toString("hex"));
    expect(a.industries.map((i) => [i.type, i.tx, i.ty])).toEqual(
      b.industries.map((i) => [i.type, i.tx, i.ty]));
  });

  it("(almost always) differs for different seeds", () => {
    expect(hashMap(generateGrid(1))).not.toBe(hashMap(generateGrid(2)));
  });

  it("produces an island with water and grass both present", () => {
    const m = generateGrid(7);
    let water = 0, grass = 0;
    m.terrain.forEach((t) => { if (t === TERRAIN.WATER) water++; else if (t === TERRAIN.GRASS) grass++; });
    expect(water).toBeGreaterThan(0);
    expect(grass).toBeGreaterThan(0);
  });

  it("guarantees at least one industry for every cargo type", () => {
    const m = generateGrid(77);
    const cargo = new Set(m.industries.map((i) => INDUSTRIES[i.type].cargo));
    for (const type of INDUSTRY_TYPES) {
      // every industry type is placed at least once
      expect(m.industries.some((i) => i.type === type)).toBe(true);
    }
    expect(cargo.size).toBe(6);
  });

  it("records footprint occupancy consistently", () => {
    const m = generateGrid(77);
    for (const ind of m.industries) {
      expect(industryAt(m, ind.tx, ind.ty)?.id).toBe(ind.id);
      // bottom-right corner of footprint also maps to it
      expect(industryAt(m, ind.tx + ind.w - 1, ind.ty + ind.h - 1)?.id).toBe(ind.id);
    }
  });

  it("never places an industry on water or overlapping another", () => {
    const m = generateGrid(77);
    const seen = new Set<number>();
    for (const ind of m.industries) {
      for (let y = ind.ty; y < ind.ty + ind.h; y++) {
        for (let x = ind.tx; x < ind.tx + ind.w; x++) {
          expect(m.terrain[tileIndex(x, y)]).not.toBe(TERRAIN.WATER);
          const id = m.occup[tileIndex(x, y)];
          expect(id).toBe(ind.id);
          if (seen.has(tileIndex(x, y))) throw new Error("overlap");
          seen.add(tileIndex(x, y));
        }
      }
    }
  });

  it("keeps industry centres at least ~6 tiles apart", () => {
    const m = generateGrid(31);
    const c = m.industries.map((i) => ({ x: i.tx + i.w / 2, y: i.ty + i.h / 2 }));
    for (let i = 0; i < c.length; i++)
      for (let j = i + 1; j < c.length; j++) {
        const d = Math.hypot(c[i].x - c[j].x, c[i].y - c[j].y);
        // footprints keep them even further; allow tolerance for large mines
        expect(d).toBeGreaterThan(4.5);
      }
  });
});
