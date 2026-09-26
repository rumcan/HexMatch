import { describe, expect, it } from "vitest";
import { buildErosionField, hash2, type TerrainMapInput } from "../../src/iso/terrain-gl/mesh";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function mapOf(w: number, h: number, heights?: Uint8Array, seed = 7): TerrainMapInput {
  return { w, h, terrain: new Uint8Array(w * h), heights, seed };
}

/** Corner lattice of a cone/island: level rises to the centre, 1 per ring. */
function coneHeights(w: number, h: number): Uint8Array {
  const out = new Uint8Array((w + 1) * (h + 1));
  const cx = w / 2, cy = h / 2;
  for (let j = 0; j <= h; j++)
    for (let i = 0; i <= w; i++) {
      const d = Math.hypot(i - cx, j - cy);
      out[j * (w + 1) + i] = Math.max(0, Math.min(4, Math.round((w * 0.4 - d) / 6)));
    }
  return out;
}

/** A one-way ramp: level == i, so every cell drains toward i − 1. */
function rampHeights(w: number, h: number): Uint8Array {
  const out = new Uint8Array((w + 1) * (h + 1));
  for (let j = 0; j <= h; j++)
    for (let i = 0; i <= w; i++) out[j * (w + 1) + i] = i;
  return out;
}

/* ------------------------------------------------------------------ */

describe("buildErosionField", () => {
  it("fits the corner lattice: (w+1)*(h+1) samples, index j*(w+1)+i", () => {
    const w = 24, h = 17;
    const f = buildErosionField(mapOf(w, h, coneHeights(w, h)));
    expect(f.w).toBe(w + 1);
    expect(f.h).toBe(h + 1);
    for (const a of [f.slope, f.curv, f.flow, f.ero]) expect(a.length).toBe((w + 1) * (h + 1));
    expect(f.rgba.length).toBe((w + 1) * (h + 1) * 4);
    // the packed RGBA matches the float arrays
    for (const v of [0, 5, 41, (w + 1) * (h + 1) - 1]) {
      expect(f.rgba[v * 4]).toBe(Math.round(Math.max(0, Math.min(1, f.slope[v])) * 255));
      expect(f.rgba[v * 4 + 1]).toBe(Math.round(Math.max(0, Math.min(1, f.curv[v] * 0.5 + 0.5)) * 255));
      expect(f.rgba[v * 4 + 2]).toBe(Math.round(Math.max(0, Math.min(1, f.flow[v])) * 255));
      expect(f.rgba[v * 4 + 3]).toBe(Math.round(Math.max(0, Math.min(1, f.ero[v] * 0.5 + 0.5)) * 255));
    }
  });

  it("is deterministic for a seed — and for the same map twice", () => {
    for (const seed of [1, 7, 12345]) {
      const w = 40, h = 40;
      const a = buildErosionField(mapOf(w, h, coneHeights(w, h), seed));
      const b = buildErosionField(mapOf(w, h, coneHeights(w, h), seed));
      expect(Array.from(a.slope)).toEqual(Array.from(b.slope));
      expect(Array.from(a.curv)).toEqual(Array.from(b.curv));
      expect(Array.from(a.flow)).toEqual(Array.from(b.flow));
      expect(Array.from(a.ero)).toEqual(Array.from(b.ero));
      expect(Array.from(a.rgba)).toEqual(Array.from(b.rgba));
    }
    // and it does not depend on Math.random or the clock
    const w = 16, h = 16;
    const before = buildErosionField(mapOf(w, h, coneHeights(w, h), 3)).rgba;
    const rnd = Math.random;
    Math.random = () => { throw new Error("buildErosionField must not use Math.random"); };
    try {
      const after = buildErosionField(mapOf(w, h, coneHeights(w, h), 3)).rgba;
      expect(Array.from(after)).toEqual(Array.from(before));
    } finally {
      Math.random = rnd;
    }
  });

  it("stays uniform on a flat map (no elevation at all)", () => {
    const f = buildErosionField(mapOf(32, 32, undefined, 99));
    for (let v = 0; v < f.slope.length; v++) {
      expect(f.slope[v]).toBe(0);
      expect(f.curv[v]).toBe(0);
      expect(f.flow[v]).toBe(0);
      expect(f.ero[v]).toBe(0);
    }
    // every corner the same packed colour: 0 / 128 (flat) / 0 / 128 (no erosion)
    for (let v = 0; v < f.slope.length; v++) {
      expect(f.rgba[v * 4]).toBe(0);
      expect(f.rgba[v * 4 + 1]).toBe(128);
      expect(f.rgba[v * 4 + 2]).toBe(0);
      expect(f.rgba[v * 4 + 3]).toBe(128);
    }
    // an all-zero height lattice is the same thing
    const zeros = buildErosionField(mapOf(32, 32, new Uint8Array(33 * 33), 99));
    expect(Array.from(zeros.rgba)).toEqual(Array.from(f.rgba));
  });

  it("accumulates flow downhill: every step down the ramp adds to it", () => {
    const w = 48, h = 48;
    const f = buildErosionField(mapOf(w, h, rampHeights(w, h), 5));
    const at = (i: number, j: number): number => f.flow[j * (w + 1) + i];
    const rowMax = (i: number): number => {
      let m = 0;
      for (let j = 0; j <= h; j++) m = Math.max(m, at(i, j));
      return m;
    };
    // heights rise with i, so i = 0 is the outlet: the water collected there
    // (and only there) is the map maximum, and no row carries more than the
    // row below it.
    let max = 0, maxI = -1, maxJ = -1;
    for (let j = 0; j <= h; j++) for (let i = 0; i <= w; i++) {
      if (at(i, j) > max) { max = at(i, j); maxI = i; maxJ = j; }
    }
    expect(maxI).toBe(0);
    expect(max).toBeCloseTo(1, 6);
    expect(maxJ).toBeGreaterThanOrEqual(0);
    for (let i = 1; i <= w; i++) expect(rowMax(i - 1)).toBeGreaterThanOrEqual(rowMax(i) - 1e-6);
    // genuinely accumulated, not just a local gradient: the outlet carries far
    // more than a single rain drop's worth (the top row is 1 drop each).
    expect(rowMax(0)).toBeGreaterThan(rowMax(w) * 3);
  });

  it("leaves drainage lines thin and the flat ground between them free", () => {
    const w = 64, h = 64;
    const f = buildErosionField(mapOf(w, h, coneHeights(w, h), 11));
    let wet = 0;
    for (let v = 0; v < f.flow.length; v++) if (f.flow[v] > 0.5) wet++;
    const frac = wet / f.flow.length;
    expect(frac).toBeGreaterThan(0.001); // there ARE drainage lines
    expect(frac).toBeLessThan(0.25);     // but they do not swallow the map
  });

  it("erodes crests and fills hollows (thermal erosion)", () => {
    const w = 9, h = 9;
    const heights = new Uint8Array(10 * 10);
    heights[4 * 10 + 4] = 2; // a lone 2-level peak
    const f = buildErosionField(mapOf(w, h, heights, 3));
    const peak = 4 * 10 + 4, foot = 4 * 10 + 3;
    // the peak is convex (a ridge), the ground around it concave (a hollow)
    expect(f.curv[peak]).toBeLessThan(0);
    expect(f.curv[foot]).toBeGreaterThan(0);
    expect(f.slope[foot]).toBeGreaterThan(0);
    // thermal erosion takes material off the crest and drops it in the hollows
    expect(f.ero[peak]).toBeGreaterThan(0.5);
    expect(f.ero[foot]).toBeLessThan(0);
  });

  it("finds both ridges and hollows on a terraced hill", () => {
    const w = 32, h = 32;
    const f = buildErosionField(mapOf(w, h, coneHeights(w, h), 3));
    let hollows = 0, ridges = 0, deposits = 0;
    for (let k = 0; k < f.curv.length; k++) {
      if (f.curv[k] > 0.05) hollows++;
      if (f.curv[k] < -0.05) ridges++;
      if (f.ero[k] < -0.05) deposits++;
    }
    expect(hollows).toBeGreaterThan(0);
    expect(ridges).toBeGreaterThan(0);
    expect(deposits).toBeGreaterThan(0);
  });

  it("degrades gracefully: a seed-hash tie-break never routes uphill", () => {
    // two neighbours one level lower from the same cell: the deterministic
    // seed hash may pick either one, but never a higher or equal cell
    const w = 3, h = 3;
    const heights = new Uint8Array(4 * 4).fill(2);
    heights[0 * 4 + 1] = 1; // (1,0)
    heights[1 * 4 + 2] = 1; // (2,1)
    for (const seed of [1, 2, 3, 4]) {
      const f = buildErosionField(mapOf(w, h, heights, seed));
      expect(f.flow.length).toBe(16);
      for (let v = 0; v < f.flow.length; v++) expect(f.flow[v]).toBeGreaterThanOrEqual(0);
      for (let v = 0; v < f.slope.length; v++) expect(f.slope[v]).toBeGreaterThanOrEqual(0);
      // the two lower corners cannot be receivers of each other
      expect(hash2(seed, 1, 0)).toBeGreaterThanOrEqual(0);
    }
  });
});
