import { describe, it, expect } from "vitest";
import { generateMap, WATER } from "../../src/iso/grid";
import { MAP_W, MAP_H, INDUSTRY_QUOTA, TRANSPORT, UPGRADE_COST, VP_TARGET } from "../../src/iso/config";

// Mirrored from src/iso/game.ts — do not import the boot module (it pulls
// atlas PNGs and the DOM). Pass 1 pinned these; pass 2 measures against them.
// PP-07 retuned the purse: a dirt tile costs Wood + Stone now, so the opening
// grants both (12 paid tiles — the same E8 curve), still with no ore.
const START_PURSE = { wood: 12, stone: 12, ore: 0 };
const FREE_SETUP_TRACK = 12;
const HARVEST_MS = 3000;

// E8 pass 2 — measure the curve pass 1 left us, then file one follow-up per
// lever. These assertions pin the *current* numbers so a later rebalance
// ticket has a baseline, and they record the distance-to-ore distribution
// that decides whether road arrives too fast.

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

describe("E8 pass 2 — starting curve", () => {
  // #431: this used to pin PP-07's prices (4 Ore a road, 12 of each to start,
  // 5 ore mines, a 10★ line). The owner's balancing pass (52b11bf, costs ×3)
  // and the 11-industry map (957faeb) moved every one of those numbers on
  // purpose, and BAL-1 (#471's balance harness, `npm run balance`) now owns
  // the prices. What E8 protects is the STRUCTURE, so that is what it pins.
  it("still gates road behind an ore mine (pass 1 structure)", () => {
    expect(START_PURSE.ore ?? 0, "no Ore to start: the first road waits on a mine").toBe(0);
    expect(START_PURSE.stone, "the opening Dirt is affordable").toBeGreaterThan(0);
    expect(START_PURSE.wood, "the opening Dirt is affordable").toBeGreaterThan(0);
    expect(FREE_SETUP_TRACK).toBeGreaterThan(0);
    expect(TRANSPORT.road.cost.ore ?? 0, "a paved Road costs Ore").toBeGreaterThan(0);
    expect(TRANSPORT.dirt.cost.ore ?? 0, "Dirt never costs Ore").toBe(0);
    expect(UPGRADE_COST.ore ?? 0, "dirt→road pays Ore").toBeGreaterThan(0);
    expect(UPGRADE_COST.ore!, "…the difference only").toBeLessThanOrEqual(TRANSPORT.road.cost.ore!);
    expect(TRANSPORT.dirt.onRough).toBe(true);
    expect(TRANSPORT.road.onRough).toBe(false);
    expect(INDUSTRY_QUOTA.ore_mine, "every map can mine Ore").toBeGreaterThan(0);
    expect(VP_TARGET).toBeGreaterThan(0);
  });

  it.skip("records distance-to-nearest-ore from the land centroid across 40 seeds", () => {
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
    // First road tile costs 4 ore → four ticks after the dirt lands (E8a).
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
