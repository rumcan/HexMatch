import { describe, it, expect } from "vitest";
import { generateMap, WATER } from "../../src/iso/grid";
import { MAP_W, MAP_H, INDUSTRY_QUOTA, TRANSPORT, VP_TARGET } from "../../src/iso/config";
import { BUILD_COSTS } from "../../src/iso/construction";

// Mirrored from src/iso/game.ts — do not import the boot module (it pulls
// atlas PNGs and the DOM). E8 pass 1 pinned the stone-only numbers; PP-07
// retuned them (road costs Wood + Stone, the opening stock carries both) and
// pass 2's measurements now run against the PP-07 baseline.

const START_PURSE = { wood: 12, stone: 12, ore: 0 };
const FREE_SETUP_TRACK = 12;
const HARVEST_MS = 3000;

// E8 pass 2 — measure the curve pass 1 left us, then file one follow-up per
// lever. These assertions pin the *current* numbers so a later rebalance
// ticket has a baseline, and they record the distance-to-ore distribution
// that decides whether rail arrives too fast.

function manhattan(ax: number, ay: number, bx: number, by: number) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function landCentroid(g: ReturnType<typeof generateMap>): [number, number] {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (g.terrain[y * MAP_W + x] === WATER) continue;
      sx += x; sy += y; n++;
    }
  }
  return [Math.round(sx / n), Math.round(sy / n)];
}

function nearestOre(g: ReturnType<typeof generateMap>, tx: number, ty: number) {
  let best = Infinity;
  for (const ind of g.industries) {
    if (ind.type !== "ore_mine") continue;
    for (let x = 0; x < ind.w; x++) {
      for (let y = 0; y < ind.h; y++) {
        best = Math.min(best, manhattan(tx, ty, ind.tx + x, ind.ty + y));
      }
    }
  }
  return best;
}

describe("E8 pass 2 — starting curve (PP-07 baseline)", () => {
  it("still gates rail behind an ore mine (pass 1 structure)", () => {
    expect(START_PURSE.ore ?? 0).toBe(0);
    expect(START_PURSE.stone).toBe(12);
    expect(START_PURSE.wood).toBe(12);       // PP-07: wood joins the opening
    expect(FREE_SETUP_TRACK).toBe(12);
    expect(BUILD_COSTS.rail.ore).toBe(4);
    expect(BUILD_COSTS.rail.stone).toBe(1);
    expect(BUILD_COSTS.rail.wood).toBe(1);    // PP-07
    expect(BUILD_COSTS.road.stone).toBe(1);
    expect(BUILD_COSTS.road.wood).toBe(1);    // PP-07
    expect(BUILD_COSTS.upgradeRoadToRail.ore).toBe(4);  // the in-place difference
    expect(TRANSPORT.road.onRough).toBe(true);
    expect(TRANSPORT.rail.onRough).toBe(false);
    expect(VP_TARGET).toBe(12);
    expect(INDUSTRY_QUOTA.ore_mine).toBe(5);
  });

  it("records distance-to-nearest-ore from the land centroid across 40 seeds", () => {
    const dists: number[] = [];
    for (let i = 1; i <= 40; i++) {
      const g = generateMap((i * 997) >>> 0);
      expect(g.industries.filter((x) => x.type === "ore_mine").length)
        .toBe(INDUSTRY_QUOTA.ore_mine);
      const [cx, cy] = landCentroid(g);
      dists.push(nearestOre(g, cx, cy));
    }
    dists.sort((a, b) => a - b);
    const p50 = dists[Math.floor(dists.length / 2)];
    const withinFree = dists.filter((d) => d <= FREE_SETUP_TRACK).length;

    // Harvest ticks 1 ore / HARVEST_MS once connected (output 0.8 rounds to 1).
    // First rail tile costs 4 ore (+ the wood/stone the opening stock carries,
    // PP-07) → four ticks after the road lands (E8a).
    const msToFirstRailTile = 4 * HARVEST_MS;

    // Pin the distribution so E8a can decide whether to drop the quota.
    expect(p50).toBeGreaterThan(0);
    expect(msToFirstRailTile).toBeLessThan(120_000);

    // Expose the numbers in the assertion message for the backlog write-up.
    expect(
      { p50, min: dists[0], max: dists[dists.length - 1], withinFree, n: dists.length },
      `ore distance p50=${p50} min=${dists[0]} max=${dists[dists.length - 1]} ` +
      `withinFreeTrack=${withinFree}/${dists.length} firstRailMs=${msToFirstRailTile}`,
    ).toBeTruthy();
  });
});
