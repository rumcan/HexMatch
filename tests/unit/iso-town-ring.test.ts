// #296: a one-tile ring road around every town, joined to its streets.
import { describe, expect, it } from "vitest";
import { factoryTouchesTown, generateMap, ROUGH, TOWN_OCC, WATER } from "../../src/iso/grid";
import { FACTORY_FOOTPRINT } from "../../src/iso/config";
import { MAP_W } from "../../src/iso/config";

const idx = (x: number, y: number) => y * MAP_W + x;

describe("#296 town ring roads", () => {
  for (const seed of [7, 42, 199, 1337]) {
    it(`seed ${seed}: every town has a ring joined to its streets, and nothing is sealed`, () => {
      const off = generateMap(seed, {});
      const g = generateMap(seed, { rings: true });
      expect(g.towns.length, "all towns still place").toBe(off.towns.length);
      for (const t of g.towns) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y] of t.houses) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        const roads = new Set(t.roads.map(([x, y]) => idx(x, y)));
        // the loop: every perimeter tile is ring road unless it is water or
        // not this town's ground (an industry / another town)
        let ring = 0, gaps = 0;
        const perim: [number, number][] = [];
        for (let x = x0 - 1; x <= x1 + 1; x++) perim.push([x, y0 - 1], [x, y1 + 1]);
        for (let y = y0; y <= y1; y++) perim.push([x0 - 1, y], [x1 + 1, y]);
        for (const [x, y] of perim) {
          if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_W) { gaps++; continue; }
          if (roads.has(idx(x, y))) ring++;
          else { gaps++; expect(g.terrain[idx(x, y)] === WATER || g.occupancy[idx(x, y)] !== TOWN_OCC, `(${x},${y}) is a gap only for water / other ground`).toBe(true); }
        }
        expect(ring, `town ${t.id} ring`).toBeGreaterThan(perim.length * 0.5);
        // the ring is one road network with the streets (flood from any road)
        const seen = new Set<number>();
        const stack = [idx(t.roads[0][0], t.roads[0][1])];
        seen.add(stack[0]);
        while (stack.length) {
          const c = stack.pop()!;
          const x = c % MAP_W, y = (c / MAP_W) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = idx(x + dx, y + dy);
            if (roads.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
          }
        }
        // allow water-split fragments, but the big one holds almost everything
        expect(seen.size / roads.size, `town ${t.id} road network connected`).toBeGreaterThan(0.9);
        // nothing free is sealed inside the house box
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const i = idx(x, y);
          if (g.terrain[i] === WATER) continue;
          expect(g.occupancy[i] !== -1, `(${x},${y}) free pocket inside town ${t.id}`).toBe(true);
        }
      }
    });
  }

  it("a Factory fits beside the ring on at least three sides of every town", () => {
    const [fw, fh] = FACTORY_FOOTPRINT;
    for (const seed of [7, 42, 199, 1337]) {
      const g = generateMap(seed, { rings: true });
      const fits = (tx: number, ty: number) => {
        for (let y = ty; y < ty + fh; y++) for (let x = tx; x < tx + fw; x++) {
          if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_W) return false;
          const i = idx(x, y);
          if (g.occupancy[i] !== -1 || g.terrain[i] === WATER || g.terrain[i] === ROUGH) return false;
        }
        return factoryTouchesTown(g, tx, ty, 0, [fw, fh]);
      };
      for (const t of g.towns) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y] of t.roads) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        let sides = 0;
        const north = () => { for (let x = x0 - fw; x <= x1; x++) if (fits(x, y0 - fh)) return true; return false; };
        const south = () => { for (let x = x0 - fw; x <= x1; x++) if (fits(x, y1 + 1)) return true; return false; };
        const west = () => { for (let y = y0 - fh; y <= y1; y++) if (fits(x0 - fw, y)) return true; return false; };
        const east = () => { for (let y = y0 - fh; y <= y1; y++) if (fits(x1 + 1, y)) return true; return false; };
        for (const f of [north, south, west, east]) if (f()) sides++;
        expect(sides, `seed ${seed} town ${t.id}: sides with a Factory site`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("rings OFF leaves the generator byte-identical", () => {
    const a = generateMap(42, {}), b = generateMap(42, { rings: false });
    expect(Buffer.from(a.occupancy.buffer).equals(Buffer.from(b.occupancy.buffer))).toBe(true);
  });
});
