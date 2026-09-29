// LEVEL-FIX: one refused tile (a structure at the patch edge) must not cascade
// into refusing the whole rectangle. Fixed ground slopes the patch instead.
import { describe, expect, it } from "vitest";
import { MAP_H, MAP_W } from "../../src/game/config";
import { GRASS, heightAt, type Grid } from "../../src/iso/grid";
import { applyLevelPlan, planLevel, rectTiles } from "../../src/iso/level-ground";

function flat(level = 1): Grid {
  const w = MAP_W, h = MAP_H;
  return {
    w, h, terrain: new Uint8Array(w * h).fill(GRASS), height: new Uint8Array(w * h).fill(level),
    rivers: new Uint8Array(w * h), occupancy: new Int16Array(w * h).fill(-1),
    industries: [], towns: [], seed: 1,
  } as unknown as Grid;
}

function assertLegal(g: Grid, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      expect(Math.abs(heightAt(g, x, y) - heightAt(g, x + dx, y + dy)), `(${x},${y})+(${dx},${dy})`)
        .toBeLessThanOrEqual(1);
    }
  }
}

describe("level ground does not cascade", () => {
  it("(a) hilly 10x6 patch with a tall structure at one edge: only the structure refuses", () => {
    const g = flat(1);
    for (let y = 8; y <= 20; y++) for (let x = 8; x <= 26; x++) {
      const pyramid = Math.max(1, 4 - Math.max(Math.abs(x - 19), Math.abs(y - 12)));
      g.height![y * g.w + x] = Math.max(pyramid, x <= 14 && (x + y) % 4 === 0 ? 2 : 1);
    }
    g.occupancy[12 * g.w + 19] = 0;
    g.height![10 * g.w + 10] = 1;
    const plan = planLevel(g, rectTiles(10, 10, 19, 15));
    expect(plan.target).toBe(1);
    expect(plan.refused).toEqual([[19, 12, "structure"]]);
    applyLevelPlan(g, plan);
    for (let y = 10; y <= 15; y++) for (let x = 10; x <= 14; x++) expect(heightAt(g, x, y)).toBe(1);
    // beside the structure the ground slopes rather than refusing
    expect(heightAt(g, 18, 12)).toBeGreaterThanOrEqual(3);
    expect(heightAt(g, 19, 12)).toBe(4);
    assertLegal(g, 8, 8, 25, 19);
  });

  it("(b) flat ground levels entirely, nothing refused", () => {
    const g = flat(2);
    const plan = planLevel(g, rectTiles(5, 5, 14, 10));
    expect(plan.refused).toEqual([]);
    expect(plan.changes).toEqual([]);
    const g2 = flat(2);
    g2.height![5 * g2.w + 6] = 3;
    const p2 = planLevel(g2, rectTiles(5, 5, 14, 10));
    expect(p2.refused).toEqual([]);
    applyLevelPlan(g2, p2);
    for (let y = 5; y <= 10; y++) for (let x = 5; x <= 14; x++) expect(heightAt(g2, x, y)).toBe(2);
  });

  it("(c) a patch of only structures refuses everything", () => {
    const g = flat(1);
    for (let y = 5; y <= 7; y++) for (let x = 5; x <= 8; x++) g.occupancy[y * g.w + x] = 0;
    const plan = planLevel(g, rectTiles(5, 5, 8, 7));
    expect(plan.refused.length).toBe(12);
    expect(plan.changes).toEqual([]);
  });
});
