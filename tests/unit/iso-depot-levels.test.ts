// 2026-09 (owner call) — Depot levels cap the tuning yield; score past the cap
// pays Gold; upgrades cost a Depot, retunes half; no decay on any row.
import { describe, it, expect } from "vitest";
import { DEPOT_LEVELS, DIFFICULTY_RULES, TUNING, depotYieldCap, BUILD_COSTS } from "../../src/iso/config";
import { settleTuningYield, overshootGold, tuningYieldFor } from "../../src/iso/tuning";
import { DEPOT_UPGRADE_COST, DEPOT_RETUNE_COST } from "../../src/iso/construction";

const normal = DIFFICULTY_RULES.normal;

describe("2026-09 Depot levels", () => {
  it("caps: L1 ×2, L2 ×4, L3 ×6; absent = L1; nothing past L3", () => {
    expect([depotYieldCap(undefined), depotYieldCap(1), depotYieldCap(2), depotYieldCap(3), depotYieldCap(9)])
      .toEqual([2, 2, 4, 6, 6]);
    expect(DEPOT_LEVELS.max).toBe(3);
  });

  it("a session settles at most at the Depot's cap", () => {
    const huge = TUNING.targetScore * 4;
    expect(settleTuningYield(undefined, huge, normal, { cap: 2 })).toBe(2);
    expect(settleTuningYield(undefined, huge, normal, { cap: 4 })).toBe(4);
    expect(settleTuningYield(undefined, 20, normal, { cap: 6 })).toBe(tuningYieldFor(20, normal.minYield));
  });

  it("score past the cap pays Gold: 1 per 0.5× over", () => {
    const at = (y: number) => ((y - normal.minYield) / (TUNING.maxYield - normal.minYield)) * TUNING.targetScore;
    expect(overshootGold(at(2), normal, 2)).toBe(0);
    expect(overshootGold(at(3), normal, 2)).toBe(2);
    expect(overshootGold(at(1.5), normal, 2)).toBe(0);
  });

  it("never lowers a Depot and never decays, on any difficulty", () => {
    for (const r of Object.values(DIFFICULTY_RULES)) {
      expect(r.decayRate).toBe(0);
      expect(r.yieldNeverDrops).toBe(true);
      expect(r.rematch).toBe("open");
      expect(settleTuningYield(1.9, 0, r, { cap: 2 })).toBe(1.9);
    }
  });

  it("upgrade costs a Depot; a retune costs half, rounded up", () => {
    expect(DEPOT_UPGRADE_COST).toEqual(BUILD_COSTS.depot);
    for (const [c, n] of Object.entries(BUILD_COSTS.depot)) {
      expect((DEPOT_RETUNE_COST as Record<string, number>)[c]).toBe(Math.ceil((n ?? 0) / 2));
    }
  });
});
