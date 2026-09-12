import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Atlas, type Manifest } from "../../src/iso/atlas";
import { depthSort, place, type Placed } from "../../src/iso/depth";
import { referenceDepthSort } from "../fixtures/reference-depth-sort";

const atlas = new Atlas(JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8")) as Manifest);
function scene(seed: number, count: number, spread = 40): Placed[] {
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const names = Object.keys(atlas.manifest.sprites);
  return Array.from({ length: count }, (_, i) => {
    const tx = Math.floor(random() * spread) - 10, ty = Math.floor(random() * spread) - 10;
    return place(atlas, {
      sprite: names[Math.floor(random() * names.length)], tx, ty,
      ...(i % 5 === 0 ? { fx: tx + random(), fy: ty + random() } : {}),
      decor: i % 3 === 0,
    })!;
  });
}
function check(items: Placed[]) {
  const input = items.slice();
  const actual = depthSort(items), expected = referenceDepthSort(items);
  expect(actual.cycles).toEqual(expected.cycles);
  expect(actual.order.length).toBe(expected.order.length);
  actual.order.forEach((item, i) => expect(item).toBe(expected.order[i]));
  expect(items).toEqual(input);
}

describe("optimized sorter matches original", () => {
  it("matches exact object order and cycle reports in 40 seeded dense scenes", () => {
    for (let seed = 1; seed <= 40; seed++) check(scene(seed, 300));
  });
  it("handles empty, singleton, ties, touching bounds and fully overlapping boxes", () => {
    check([]);
    check(scene(1, 1));
    const items = scene(45, 200, 8);
    check(items.map((p, i) => ({ ...p, wx: i * 64, wy: 0, w: 64, h: 64 })));
    check(items.map((p) => ({ ...p, wx: 0, wy: 0, w: 100, h: 100, key: 1 })));
  });
  it("preserves the cycle fallback and downstream survivors", () => {
    // Four rectangular footprints form a directional cycle. Give them
    // overlapping screen boxes so the graph sees all four constraints.
    const rects = [[0, 6, 4, 6], [5, 3, 1, 4], [6, 1, 6, 4], [2, 5, 6, 1], [12, 1, 1, 4]];
    const items = rects.map(([tx, ty, w, h], i) => {
      const p = scene(i + 1, 1)[0];
      return { ...p, sprite: `cycle-${i}`, tx, ty, key: tx + ty,
        wx: 0, wy: 0, w: 100, h: 100,
        def: { ...p.def, footprint: [w, h] as [number, number] } };
    });
    expect(referenceDepthSort(items).cycles.length).toBeGreaterThan(0);
    check(items);
  });
  it("reports an opt-in CPU benchmark (not an FPS or CI timing assertion)", () => {
    if (!process.env.HEX_DEPTH_BENCH) return;
    const items = scene(1234, 2500, 144);
    check(items);
    for (const sort of [referenceDepthSort, depthSort]) {
      for (let i = 0; i < 5; i++) sort(items);
      const times = Array.from({ length: 15 }, () => {
        const start = performance.now(); sort(items); return performance.now() - start;
      }).sort((a, b) => a - b);
      console.log(`${sort.name}: median ${times[7].toFixed(2)} ms (2,500 sprites, 15 runs)`);
    }
  });
});
