import { describe, expect, it } from "vitest";
import { generateMap, heightAt, WATER, idx } from "../../src/iso/grid";

const seeds = [42, 1337];

describe("E1 elevation", () => {
  it("is deterministic and option-off remains flat", () => {
    for (const seed of seeds) {
      const a = generateMap(seed, { elevation: true });
      const b = generateMap(seed, { elevation: true });
      expect(a.height).toEqual(b.height);
      expect(generateMap(seed).height).toEqual(new Uint8Array(a.w * a.h));
    }
  });

  it("keeps sea and rivers at the lowest level", () => {
    for (const seed of seeds) {
      const g = generateMap(seed, { elevation: true, rivers: true });
      for (let i = 0; i < g.terrain.length; i++) {
        if (g.terrain[i] === WATER || g.rivers?.[i]) expect(g.height?.[i]).toBe(0);
      }
    }
  });

  it("limits every neighbouring slope to one level", () => {
    const g = generateMap(20260925, { elevation: true, rivers: true });
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
        expect(Math.abs(heightAt(g, x, y) - heightAt(g, nx, ny)), `${x},${y}=${heightAt(g, x, y)} vs ${nx},${ny}=${heightAt(g, nx, ny)}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("flattens industry and town footprints", () => {
    const g = generateMap(1337, { elevation: true });
    for (const ind of g.industries) {
      const levels: number[] = [];
      for (let y = ind.ty; y < ind.ty + ind.h; y++) {
        for (let x = ind.tx; x < ind.tx + ind.w; x++) levels.push(g.height?.[idx(x, y)] ?? 0);
      }
      expect(new Set(levels).size).toBe(1);
    }
    for (const town of g.towns) {
      const levels = [...town.houses, ...town.roads, [town.tx, town.ty] as [number, number]]
        .map(([x, y]) => g.height?.[idx(x, y)] ?? 0);
      expect(new Set(levels).size).toBe(1);
    }
  });
});
