// ══════════════════════════════════════════════════════════════════════════
// PP-07 playtest — opening progression and expansion on the REAL 144×144 map.
//
// The ticket's acceptance criteria:
//   • Test opening progression and expansion on the actual 144×144 map, not
//     just short synthetic routes.
//   • Record time to first connection, second Depot and second processing
//     plant during playtesting.
//   • Players can manufacture a missing resource without entering an endless
//     dependency loop.
//
// Method: a headless session per seed. The player is driven by the SAME
// modules the live game uses — `aiBuildStep` for track + Depot builds
// (which now price Depots from the authoritative table), `playerResources`
// for the harvest income, and the real `bankTrade` (4:1, gold blocked —
// PP-08) as the way to turn a surplus cargo into a missing one. The opening
// Factory site is a human-style choice (a central industry — see
// `chooseOpeningFactorySpot`), not the rival's far-corner heuristic. The
// match-3 board is deliberately NOT simulated: trickle + bank is the
// CONSERVATIVE income model — if the opening works on it, a human actively
// matching gems only does better.
//
// The measured numbers are written up in
// `docs/playtest-reports/2026-09-08-pp07-cost-rebalance.md`.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeAll } from "vitest";

// The boot module imports the atlas PNGs; stub them so the tuning constants
// can be read without a bundler.
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

import { generateMap, WATER, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { createTrack, canAfford, canBuildOn, type Purse } from "../../src/iso/track";
import { aiBuildStep, harvesterSpots } from "../../src/iso/ai";
import {
  createScoreState, rescore, vpFor, playerResources, type EconomyState,
} from "../../src/iso/economy";
import { BUILD_COSTS, depotCharge } from "../../src/iso/costs";
import {
  PLANT_COST, addPlant, canAffordPlant, chooseAiPlantSpot, plantsOf,
} from "../../src/iso/plants";
import { CARGOES, FACTORY_FOOTPRINT, type Cargo } from "../../src/iso/config";
import { bankTrade } from "../../src/game/trade";
import {
  START_PURSE, FREE_SETUP_TRACK, HARVEST_MS, AI_BUILD_MS,
} from "../../src/iso/game";
import { toBag, type CargoBag } from "../../src/iso/market";

/**
 * The Factory site a competent human picks: beside an industry near the land
 * centroid (so the opening track budget reaches it), with the 2×2 footprint
 * on legal ground a couple of tiles off the Depot spot.
 */
function chooseOpeningFactorySpot(grid: Grid): [number, number] | null {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (grid.terrain[y * MAP_W + x] !== WATER) { sx += x; sy += y; n++; }
    }
  }
  const cx = sx / n, cy = sy / n;
  let best: { hx: number; hy: number; d: number } | null = null;
  for (const ind of grid.industries) {
    for (const [hx, hy] of harvesterSpots(grid, ind)) {
      const d = Math.abs(hx - cx) + Math.abs(hy - cy);
      if (!best || d < best.d) best = { hx, hy, d };
    }
  }
  if (!best) return null;
  const [fw, fh] = FACTORY_FOOTPRINT;
  const offsets: [number, number][] = [
    [2, 0], [0, 2], [-fw - 1, 0], [0, -fh - 1], [2, 2], [-fw - 1, 2], [2, -fh - 1],
  ];
  for (const [dx, dy] of offsets) {
    const tx = best.hx + dx, ty = best.hy + dy;
    let ok = true;
    for (let y = 0; y < fh && ok; y++) {
      for (let x = 0; x < fw && ok; x++) {
        if (!canBuildOn(grid, "road", tx + x, ty + y)) ok = false;
      }
    }
    if (ok) return [tx, ty];
  }
  return null;
}

const CAP_MS = 60 * 60_000;          // 60 in-game minutes per seed
const STEP_MS = 1_000;
/** Expansion legs the bank budgets beyond the purchase itself: a new Depot
 *  needs track to an uncovered industry, and 32 tiles of road covers the
 *  measured inter-industry legs from a central opening on the 144×144 map. */
const TRACK_BUDGET_TILES = 32;

interface Result {
  seed: number;
  firstConnection: number | null;    // ms of game time
  secondDepot: number | null;
  secondPlant: number | null;
  openingPaidTiles: number;          // paid track tiles when first connected
}

function simulate(seed: number): Result {
  const grid = generateMap(seed);
  const track = createTrack();
  const eco: EconomyState = { grid, track, harvesters: [], factories: [] };
  const purse: CargoBag = toBag(START_PURSE);
  let freeTrack = FREE_SETUP_TRACK;
  let nextHarvesterId = 1;
  const score = createScoreState();
  // PP-08: gold never trades — the bank refuses it in both directions.
  const GOLD_BLOCKED: ReadonlySet<Cargo> = new Set(["gold"]);
  const me = { i: 0, res: purse };

  // A HUMAN chooses the opening Factory site — the rival heuristic
  // (`chooseRivalFactorySpot`) deliberately maximizes distance from the
  // player and lands on far corners, which is the worst case for expansion
  // and not how anyone actually opens. Model a competent opening instead:
  // the Factory goes beside an industry near the land centroid, so the
  // measured progression is about the COSTS, not about a cornered start.
  const spot = chooseOpeningFactorySpot(grid);
  expect(spot, `seed ${seed}: no legal factory site`).toBeTruthy();
  eco.factories.push({
    owner: "you", ownerId: 1, tx: spot![0], ty: spot![1], id: 0, townId: null,
  });
  const f = eco.factories[0];

  const spend = (cost: Purse): boolean => {
    if (!canAfford(purse, cost)) return false;
    for (const [k, v] of Object.entries(cost) as [Cargo, number][]) purse[k] -= v;
    return true;
  };

  const ownedDepots = () => eco.harvesters.filter((h) => h.owner === "you").length;

  /** The full price of the NEXT milestone — the purchase PLUS the track leg
   *  that reaches it (a Depot away from the network is not a Depot). */
  const nextTarget = (): Purse | null => {
    if (ownedDepots() < 2) {
      const t: Purse = { ...depotCharge(ownedDepots()) };
      for (let i = 0; i < TRACK_BUDGET_TILES; i++) {
        for (const [k, v] of Object.entries(BUILD_COSTS.road) as [Cargo, number][]) {
          t[k] = (t[k] ?? 0) + v;
        }
      }
      return t;
    }
    if (plantsOf(eco, "you").length < 2) return { ...PLANT_COST };
    return null;
  };

  /** 4:1-bank surplus cargo into whatever the next milestone is missing. */
  const bankTowardNextMilestone = () => {
    const target = nextTarget();
    if (!target) return;
    let trades = 0;
    for (const [cargo, need] of Object.entries(target) as [Cargo, number][]) {
      if (trades >= 2) break;                       // a market session, not a loop
      while (purse[cargo] < need && trades < 2) {
        // give from the cargo held most, never one the target still lacks
        const surplus = (CARGOES as Cargo[])
          .filter((c) => c !== "gold" && c !== cargo && purse[c] >= 4)
          .filter((c) => (target[c] ?? 0) <= purse[c] - 4)
          .sort((a, b) => purse[b] - purse[a])[0];
        if (!surplus) break;
        bankTrade(me, surplus, cargo, undefined, GOLD_BLOCKED);
        trades++;
      }
    }
  };

  /** Cheap gate before the expensive A* planning: with no free allowance
   *  left, a second Depot needs its price AND a plausible track leg. When the
   *  purse cannot cover even that floor, `aiBuildStep` would only return null
   *  — the live rival spends its 9 s clock anyway, the simulation skips. */
  const worthPlanning = (): boolean => {
    if (freeTrack > 0 || ownedDepots() === 0) return true;
    return canAfford(purse, nextTarget() ?? {});
  };

  const out: Result = {
    seed, firstConnection: null, secondDepot: null, secondPlant: null,
    openingPaidTiles: 0,
  };
  let lastHarvest = -HARVEST_MS, lastAi = -AI_BUILD_MS, paidTiles = 0;
  const carry: Partial<Record<Cargo, number>> = {};

  for (let t = 0; t <= CAP_MS; t += STEP_MS) {
    // the AI build clock — plant first, then track + Depot, exactly as aiTick
    if (t - lastAi >= AI_BUILD_MS) {
      lastAi = t;
      if (canAffordPlant(purse)) {
        const ps = chooseAiPlantSpot(grid, track, eco, "you");
        if (ps && spend(PLANT_COST)) {
          addPlant(grid, track, eco, "you", 1, ps[0], ps[1]);
        }
      }
      if (worthPlanning()) {
        const built = aiBuildStep(
          eco, f, { stock: purse, purse, free: freeTrack }, nextHarvesterId,
        );
        if (built) {
          nextHarvesterId++;
          freeTrack = Math.max(0, freeTrack - built.free);
          if (!spend(built.spent)) throw new Error(`seed ${seed}: purse went unaffordable`);
          paidTiles += built.built.length - built.free;
        }
      }
    }
    // the economy clock — trickle income, then bank toward the next goal.
    // Mirrors game.ts economyTick, INCLUDING the PP-07 fractional carry (an
    // Oil Rig's 0.4/tick pays 1 oil every ~7.5 s, never zero forever).
    if (t - lastHarvest >= HARVEST_MS) {
      lastHarvest = t;
      const y = playerResources(eco, "you", t);
      for (const [cargo, v] of Object.entries(y) as [Cargo, number][]) {
        const acc = (carry[cargo] ?? 0) + Math.max(0, v);
        const n = Math.floor(acc);
        carry[cargo] = acc - n;
        if (n > 0) purse[cargo] += n;
      }
      bankTowardNextMilestone();
    }
    rescore(eco, score);

    if (out.firstConnection === null && vpFor(score, "you") >= 1) {
      out.firstConnection = t;
      out.openingPaidTiles = paidTiles;
    }
    if (out.secondDepot === null && ownedDepots() >= 2) out.secondDepot = t;
    if (out.secondPlant === null && plantsOf(eco, "you").length >= 2) out.secondPlant = t;
    if (out.firstConnection !== null && out.secondDepot !== null && out.secondPlant !== null) break;

    // the W1 invariant holds for the whole simulation
    for (const c of CARGOES) {
      if (purse[c] < 0) throw new Error(`seed ${seed}: ${c} went negative at t=${t}`);
    }
  }
  return out;
}

const SEEDS = [1337, 7, 2024, 42, 99, 31337];

describe("PP-07 opening progression on the real 144×144 map", () => {
  let results: Result[] = [];
  beforeAll(() => { results = SEEDS.map((s) => simulate(s)); }, 300_000);

  // surface the measured numbers for the playtest report
  it("records the milestone table", () => {
    const fmt = (ms: number | null) => (ms === null ? "—" : `${(ms / 60000).toFixed(1)}m`);
    console.table(results.map((r) => ({
      seed: r.seed,
      "first connection": fmt(r.firstConnection),
      "second depot": fmt(r.secondDepot),
      "second plant": fmt(r.secondPlant),
      "paid opening tiles": r.openingPaidTiles,
    })));
    expect(results.length).toBe(SEEDS.length);
  });

  it("every seed reaches its first connection quickly (free allowance + opening stock)", () => {
    for (const r of results) {
      expect(r.firstConnection, `seed ${r.seed} never connected`).not.toBeNull();
      // the opening sits inside the 12 free tiles + the 12-wood/12-stone
      // stock, so it lands on one of the first build turns, never minutes in
      expect(r.firstConnection!, `seed ${r.seed} connected too late`).toBeLessThanOrEqual(60_000);
    }
  });

  it("every seed reaches a second Depot — no endless dependency loop", () => {
    for (const r of results) {
      expect(r.secondDepot, `seed ${r.seed} never afforded a second Depot `
        + `(needs ${JSON.stringify(BUILD_COSTS.depot)})`).not.toBeNull();
      expect(r.secondDepot!).toBeLessThanOrEqual(CAP_MS);
    }
  });

  it("every seed reaches a second processing plant beside a town", () => {
    for (const r of results) {
      expect(r.secondPlant, `seed ${r.seed} never afforded a second plant `
        + `(needs ${JSON.stringify(PLANT_COST)})`).not.toBeNull();
      expect(r.secondPlant!).toBeLessThanOrEqual(CAP_MS);
    }
  });
});
