import { describe, it, expect } from "vitest";
import { IsoWorld } from "../../src/iso/world";
import { generateGrid } from "../../src/iso/grid";
import { TERRAIN, setRng, mulberry32, CARGO_KEYS } from "../../src/iso/config";
import { aStar, tileCost, aiBuild } from "../../src/iso/ai";

function harness() {
  setRng(mulberry32(2026));
  const map = generateGrid(2026);
  map.terrain.fill(TERRAIN.GRASS);
  map.industries.length = 0;
  map.occup.fill(-1);
  map.industries.push({ id: 0, type: "farm", tx: 20, ty: 20, w: 2, h: 2, output: 1.0, banditUntil: 0 } as any);
  for (let y = 20; y < 22; y++) for (let x = 20; x < 22; x++) map.occup[y * map.w + x] = 0;
  return new IsoWorld(map, 1);
}

function emptyCargo(): Record<any, number> {
  const c = {} as any;
  CARGO_KEYS.forEach((k) => (c[k] = 0));
  return c;
}

describe("E7 A* pathfinding", () => {
  it("returns null on impassable goal (water)", () => {
    const w = harness();
    w.map.terrain.fill(TERRAIN.WATER);
    const p = aStar(w, "road", [{ x: 10, y: 10 }], { x: 30, y: 30 });
    expect(p).toBeNull();
  });

  it("finds a path on open grass and ends at the goal", () => {
    const w = harness();
    const p = aStar(w, "road", [{ x: 10, y: 10 }], { x: 15, y: 12 });
    expect(p).not.toBeNull();
    expect(p![p!.length - 1]).toEqual({ x: 15, y: 12 });
    // Manhattan-optimal length
    expect(p!.length).toBe(Math.abs(15 - 10) + Math.abs(12 - 10) + 1);
  });

  it("costs rough terrain higher than flat", () => {
    const w = harness();
    w.map.terrain[w.map.w * 11 + 11] = TERRAIN.ROUGH;
    expect(tileCost(w, "road", 11, 11)).toBe(3);
    expect(tileCost(w, "road", 12, 12)).toBe(1);
    expect(tileCost(w, "rail", 11, 11)).toBe(Infinity); // rail can't cross rough
  });

  it("reuses existing network cheaply (0.3)", () => {
    const w = harness();
    w.net.build("road", 12, 10);
    expect(tileCost(w, "road", 12, 10)).toBeCloseTo(0.3);
  });
});

describe("E7 aiBuild", () => {
  it("expands the network and places a harvester, deterministically", () => {
    const run = () => {
      const w = harness();
      w.placeFactory(0, 10, 10);
      const cargo = emptyCargo();
      cargo.stone = 100; // enough for plenty of road
      const ok = aiBuild(w, 0, cargo);
      return { ok, roads: w.net.road.reduce((s, b) => s + (b ? 1 : 0), 0), harvesters: w.harvesters.length };
    };
    const a = run();
    const b = run();
    expect(a.ok).toBe(true);
    expect(a.harvesters).toBe(1);
    expect(a.roads).toBeGreaterThan(0);
    expect(a).toEqual(b); // deterministic under the seed
  });
});
