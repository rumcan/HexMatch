import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fillCoastalHoles, traceCoast, type CoastPoint } from "../../src/iso/coastline";
import { generateMap, WATER } from "../../src/iso/grid";
import { groundContours, invalidateGroundContours } from "../../src/iso/ground";
import { readSave, SAVEGAME_VERSION } from "../../src/iso/savegame-runtime";
import { SNAPSHOT_VERSION } from "../../src/iso/snapshot";

const area = (loop: CoastPoint[]) => loop.reduce((sum, p, i) => {
  const q = loop[(i + 1) % loop.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0) / 2;

describe("continuous coastline", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("traces one outline for adjacent cells, separate loops for diagonal contacts", () => {
    expect(traceCoast(2, 1, () => true)).toHaveLength(1);
    const diagonal = traceCoast(2, 2, (x, y) => x === y);
    expect(diagonal).toHaveLength(2);
    expect(diagonal.every(loop => area(loop) > 0)).toBe(true);
    expect(traceCoast(2, 2, () => false)).toEqual([]);
  });

  it("keeps hole winding opposite to the outer contour", () => {
    const loops = traceCoast(5, 5, (x, y) => x !== 2 || y !== 2);
    expect(loops).toHaveLength(2);
    expect(area(loops[0]) * area(loops[1])).toBeLessThan(0);
    for (const loop of loops) {
      expect(new Set(loop.map(p => p.join(","))).size).toBe(loop.length);
      expect(loop.flat().every(Number.isFinite)).toBe(true);
    }
  });

  it("fills diagonal-only water pockets but preserves a connected bay", () => {
    const t = new Uint8Array([
      1,1,1,1,1,
      1,0,0,0,1,
      1,0,1,0,1,
      1,0,0,1,1,
      1,1,1,1,1,
    ]);
    fillCoastalHoles(t, 5, 5, 1, 3);
    expect(t[12]).toBe(3);
    expect(t[18]).toBe(1);
  });

  it.each([1,42,123,1337,98765])("has no disconnected water on seed %i", seed => {
    const g = generateMap(seed), copy = g.terrain.slice();
    fillCoastalHoles(copy, g.w, g.h, WATER, 99);
    expect(copy).toEqual(g.terrain);
  });

  it.each([
    [42, "a95bfd3d67e097123424adc7b1c8da3c6a475a1e50b021ce2a317b6737938939"],
    [1337, "e2cd07b21c5167c8d317fd3361d2aea26e05c75719ec3e9438fdc3a4ac9fc510"],
  ] as const)("preserves v14 save placement for seed %i", (seed, hash) => {
    // Re-captured for snapshot v14, when every resource became a 4×4 lot (the
    // v10 pins came from main 42db9b9). Save loading regenerates these objects,
    // so changing them would move saved buildings — bump SNAPSHOT_VERSION when
    // they have to change again.
    const g = generateMap(seed);
    const digest = createHash("sha256").update(JSON.stringify([
      g.industries, g.towns, g.publicRoads, Array.from(g.occupancy),
    ])).digest("hex");
    expect(digest).toBe(hash);
  });

  it("reuses contour geometry until the map is invalidated", () => {
    const g = generateMap(42), a = groundContours(g);
    expect(groundContours(g)).toBe(a);
    invalidateGroundContours(g);
    expect(groundContours(g)).not.toBe(a);
    expect(groundContours(g)).toEqual(a);
  });

  it("accepts only current saves — v14 moved the seeded map (4×4 resources)", () => {
    for (const snapV of [9,10,12,13,SNAPSHOT_VERSION,SNAPSHOT_VERSION + 1]) {
      const save = {v:SAVEGAME_VERSION,snapV,seed:42,track:{}};
      vi.stubGlobal("localStorage", {getItem: () => JSON.stringify(save)});
      expect(readSave() !== null).toBe(snapV === SNAPSHOT_VERSION);
    }
  });
});
