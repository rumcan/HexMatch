import { describe, it, expect } from "vitest";
import {
  BUILD_COSTS, CARGO, CARGOES, INDUSTRY_BY_KEY, INDUSTRY_QUOTA,
  TRANSPORT, UPGRADE_COST, type Cargo,
} from "../../src/iso/config";
import {
  BUILD_COSTS as CONSTRUCTION_TABLE, DEPOT_COST, FREE_SETUP_DEPOTS,
  costCompact, costLabel, depotButtonLabel, priceDepot,
} from "../../src/iso/construction";
import { PLANT_COST, canAffordPlant } from "../../src/iso/plants";
import { createTrack, tIdx } from "../../src/iso/track";
import { aiBuildStep, chooseRivalFactorySpot } from "../../src/iso/ai";
import { reachableCargo, CARGO_TO_GEM } from "../../src/iso/quarry";
import { GRASS, generateMap, type Grid, type Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { UPGRADE_EVERY } from "../../src/game/config";
import { Board } from "../../src/game/board";
import { setRng, mulberry32, type ResKey } from "../../src/game/config";

// PP-07 — Rebalance construction and expansion using Catan-style resource
// roles. The ticket's proposal, pinned:
//
//   Road tile                1 Wood + 1 Stone
//   Rail tile                1 Wood + 1 Stone + 4 Ore
//   Upgrade Road to Rail     4 Ore
//   Additional Depot         1 Wood + 1 Stone + 1 Grain + 1 Oil
//   Additional Plant         2 Wood + 2 Stone + 2 Grain + 3 Ore
//
// Mirrored from src/iso/game.ts — do not import the boot module (it pulls
// atlas PNGs and the DOM). The live boot tests pin the same values from the
// inside (stone 12 / wood 11 after a charged tile), so a drift breaks loudly.
const START_PURSE = { wood: 12, stone: 12, ore: 0 };
const FREE_SETUP_TRACK = 12;
const AI_BUILD_MS = 9000;

// ══════════════════════════════════════════════════════════════════════════
// 1. one authoritative table, read by the UI, gameplay and AI
// ══════════════════════════════════════════════════════════════════════════
describe("PP-07 one authoritative cost table", () => {
  it("prices every buildable exactly as the ticket proposes", () => {
    expect(BUILD_COSTS.dirt).toEqual({ wood: 1, stone: 1 });
    expect(BUILD_COSTS.road).toEqual({ wood: 1, stone: 1, ore: 4 });
    expect(BUILD_COSTS.upgrade).toEqual({ ore: 4 });
    expect(BUILD_COSTS.depot).toEqual({ wood: 1, stone: 1, grain: 1, oil: 1 });
    expect(BUILD_COSTS.plant).toEqual({ wood: 2, stone: 2, grain: 2, ore: 3 });
  });

  it("is the SAME object every surface reads — no copies to drift", () => {
    // track pricing (gameplay: previewDrag/tileCost; AI: planCandidates)
    expect(TRANSPORT.dirt.cost).toBe(BUILD_COSTS.dirt);
    expect(TRANSPORT.road.cost).toBe(BUILD_COSTS.road);
    expect(UPGRADE_COST).toBe(BUILD_COSTS.upgrade);
    // the Depot price (placement, HUD, AI, tile probe)
    expect(DEPOT_COST).toBe(BUILD_COSTS.depot);
    expect(CONSTRUCTION_TABLE).toBe(BUILD_COSTS);
    // the second-plant price (preview, charge, AI)
    expect(PLANT_COST).toBe(BUILD_COSTS.plant);
  });

  it("drives the UI labels, the gameplay gate and the AI charge", () => {
    // UI: the label functions render the table's entries, not typed strings
    for (const c of Object.keys(DEPOT_COST) as Cargo[]) {
      expect(costLabel(DEPOT_COST)).toContain(CARGO[c].name);
      expect(costCompact(DEPOT_COST)).toContain(CARGO[c].icon);
    }
    expect(depotButtonLabel(0)).toContain(costCompact(DEPOT_COST));
    // gameplay: the affordability gate prices the same entries
    expect(priceDepot({ ...DEPOT_COST }, 0).affordable).toBe(true);
    expect(priceDepot({}, 0).affordable).toBe(false);
    expect(canAffordPlant({ ...PLANT_COST })).toBe(true);
    expect(canAffordPlant({})).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. every normal resource has a construction role; gold has none
// ══════════════════════════════════════════════════════════════════════════
describe("PP-07 Catan-style resource roles", () => {
  const usedBy = (c: Cargo): string[] =>
    (Object.entries(BUILD_COSTS) as [string, Partial<Record<Cargo, number>>][])
      .filter(([, cost]) => (cost[c] ?? 0) > 0)
      .map(([k]) => k);

  it("gives wood, stone, grain, ore and oil each a useful role", () => {
    // basic infrastructure
    expect(usedBy("wood")).toEqual(expect.arrayContaining(["dirt", "depot", "plant"]));
    expect(usedBy("stone")).toEqual(expect.arrayContaining(["dirt", "depot", "plant"]));
    // workforce and expansion
    expect(usedBy("grain")).toEqual(expect.arrayContaining(["depot", "plant"]));
    // industrial investment and better transport
    expect(usedBy("ore")).toEqual(expect.arrayContaining(["road", "upgrade", "plant"]));
    // depot expansion
    expect(usedBy("oil")).toEqual(["depot"]);
  });

  it("reserves gold for Black Market sabotage — it buys no construction", () => {
    expect(usedBy("gold")).toEqual([]);
  });

  it("keeps road an upgrade over dirt, not a side-grade", () => {
    // road costs everything dirt does, plus ore
    for (const [c, n] of Object.entries(BUILD_COSTS.dirt) as [Cargo, number][]) {
      expect(BUILD_COSTS.road[c] ?? 0).toBeGreaterThanOrEqual(n);
    }
    expect(BUILD_COSTS.road.ore ?? 0).toBeGreaterThan(0);
    expect(BUILD_COSTS.dirt.ore ?? 0).toBe(0);
    // and the in-place upgrade is exactly the difference
    expect(BUILD_COSTS.upgrade).toEqual({ ore: 4 });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. opening progression on the actual 144×144 map (not synthetic routes)
// ══════════════════════════════════════════════════════════════════════════
describe("PP-07 opening progression on the real map", () => {
  const spend = (purse: Record<string, number>, cost: Partial<Record<Cargo, number>>) => {
    for (const [c, n] of Object.entries(cost) as [Cargo, number][]) purse[c] -= n;
  };
  const shortOf = (purse: Record<string, number>, cost: Partial<Record<Cargo, number>>): Cargo[] =>
    (Object.entries(cost) as [Cargo, number][])
      .filter(([c, n]) => (purse[c] ?? 0) < n)
      .map(([c]) => c);

  /**
   * Play the opening on a real generated map: a factory with a viable first
   * plan, the free depot + free dirt connection, then processing income until
   * the second depot and the second plant are affordable.
   *
   * Income model (the floor, not the ceiling): each round banks +1 per cargo
   * the network reaches (a tier-1 token cleared in an ordinary match pays
   * exactly 1 — pinned in section 4 below), plus ONE manufactured match-4 of
   * the most-missing cargo (PP-04: a match-4 forges a tier-1 token of any
   * colour, and clearing it pays even with no depot supplying that cargo).
   * Every +1 is one token the player had to match, so "matches" is the
   * honest progression currency; wall-clock estimates below assume the 20s
   * token cadence as an upper bound (parallel matching is faster).
   */
  const playOpening = (seed: number) => {
    const grid = generateMap(seed);
    const track = createTrack();
    const spot = chooseRivalFactorySpot(grid, track, [0, 0], {
      purse: { ...START_PURSE }, free: FREE_SETUP_TRACK, ownerId: 1, owner: "you",
    });
    expect(spot, `seed ${seed}: no viable opening site`).toBeTruthy();
    const f = { owner: "you", ownerId: 1, tx: spot![0], ty: spot![1] };
    const eco = { grid, track, harvesters: [], factories: [f] };
    const purse: Record<string, number> = { ...START_PURSE };
    let free = FREE_SETUP_TRACK, freeDepots = FREE_SETUP_DEPOTS;

    // first connection: the free depot + (mostly free) dirt, one AI tick
    const out1 = aiBuildStep(
      eco, f, { stock: { ...purse }, purse, free, freeDepots }, 1,
    );
    expect(out1?.harvester, `seed ${seed}: opening builds no depot`).toBeTruthy();
    spend(purse, out1!.spent);
    free -= out1!.free;
    freeDepots -= out1!.freeDepots;

    // second depot: process until the full ticket is affordable, then pay it
    let matchesToDepot2 = 0;
    while (!priceDepot(purse, freeDepots).affordable && matchesToDepot2 < 40) {
      const reach = reachableCargo(eco, "you", 0);
      for (const c of Object.keys(reach) as Cargo[]) { purse[c] = (purse[c] ?? 0) + 1; matchesToDepot2++; }
      const miss = shortOf(purse, DEPOT_COST);
      if (!miss.length) break;
      purse[miss[0]] = (purse[miss[0]] ?? 0) + 1; matchesToDepot2++;
    }
    expect(priceDepot(purse, freeDepots).affordable, `seed ${seed}: second depot never affordable`).toBe(true);
    spend(purse, DEPOT_COST);

    // second plant: same loop against the bigger ticket
    let matchesToPlant2 = 0;
    while (!canAffordPlant(purse) && matchesToPlant2 < 60) {
      const reach = reachableCargo(eco, "you", 0);
      for (const c of Object.keys(reach) as Cargo[]) { purse[c] = (purse[c] ?? 0) + 1; matchesToPlant2++; }
      const miss = shortOf(purse, PLANT_COST);
      if (!miss.length) break;
      purse[miss[0]] = (purse[miss[0]] ?? 0) + 1; matchesToPlant2++;
    }
    expect(canAffordPlant(purse), `seed ${seed}: second plant never affordable`).toBe(true);

    return {
      seed,
      firstConnectionTiles: out1!.built.length,
      firstConnectionFree: out1!.free,
      firstConnectionSpent: out1!.spent,
      matchesToDepot2,
      matchesToPlant2,
    };
  };

  it("reaches a first connection, a second depot and a second plant on seeds 1337/7/2024", () => {
    const rows = [1337, 7, 2024].map(playOpening);
    for (const r of rows) {
      // the opening connection rides the allowances: at most the 12 free
      // tiles plus what the starting stock pays — never a stuck start
      expect(r.firstConnectionTiles).toBeGreaterThan(0);
      expect(r.firstConnectionTiles).toBeLessThanOrEqual(FREE_SETUP_TRACK + 12);
      // expansion is a handful of token matches, not a grind: the depot
      // needs 1 grain + 1 oil past the starting stock, the plant 2 grain +
      // 3 ore past it — each unit is one match at the payout floor
      expect(r.matchesToDepot2).toBeLessThanOrEqual(8);
      expect(r.matchesToPlant2).toBeLessThanOrEqual(16);
    }
    // the ticket's playtest record: game-time to each milestone. The first
    // connection is 1 AI tick (9s); matches assume the 20s token cadence as
    // an upper bound — a player matching several tokens per board is faster.
    for (const r of rows) {
      console.log(
        `[pp07] seed=${r.seed} first-connection=${r.firstConnectionTiles} tiles ` +
        `(${r.firstConnectionFree} free, ~${AI_BUILD_MS / 1000}s) ` +
        `second-depot=${r.matchesToDepot2} matches (~${r.matchesToDepot2 * UPGRADE_EVERY / 1000}s) ` +
        `second-plant=${r.matchesToPlant2} matches (~${r.matchesToPlant2 * UPGRADE_EVERY / 1000}s)`,
      );
    }
    expect(
      rows.map((r) => `${r.seed}:${r.firstConnectionTiles}/${r.matchesToDepot2}/${r.matchesToPlant2}`).join(" "),
      "pp07 progression (seed:connection-tiles/matches-to-depot2/matches-to-plant2)",
    ).toBeTruthy();
  }, 60_000);
});

// ══════════════════════════════════════════════════════════════════════════
// 4. costs and processing yields, tuned together — no endless loop
// ══════════════════════════════════════════════════════════════════════════
describe("PP-07 a missing resource is always manufacturable", () => {
  it("every priced cargo is stocked, harvestable, and matchable", () => {
    const priced = new Set<Cargo>();
    for (const cost of Object.values(BUILD_COSTS)) {
      for (const [c, n] of Object.entries(cost) as [Cargo, number][]) {
        if (n > 0) priced.add(c);
      }
    }
    expect(priced.size).toBeGreaterThan(0);
    for (const c of priced) {
      const stocked = (START_PURSE[c as keyof typeof START_PURSE] ?? 0) > 0;
      const harvestable = Object.entries(INDUSTRY_BY_KEY)
        .some(([type, def]) => def.cargo === c && (INDUSTRY_QUOTA[type] ?? 0) > 0);
      const matchable = CARGO_TO_GEM[c] !== undefined;
      // stocked (wood/stone) or harvestable off a quota'd industry, and
      // ALWAYS matchable — so a missing unit is one depot or one forged
      // match-4 away, never behind a building it is itself priced into
      expect(stocked || harvestable, `${c} has no source`).toBe(true);
      expect(matchable, `${c} has no gem colour`).toBe(true);
    }
  });

  it("a match-4 forges a tier-1 token of every cargo's colour (the PP-04 input)", async () => {
    // Board-level creation only — the payout gate is PP-04's half, untouched
    // here. A fresh board carries no tokens, so any token (or any harvest,
    // which requires a token) of the forced colour proves the forge fired.
    for (const c of CARGOES) {
      const res: ResKey = CARGO_TO_GEM[c];
      setRng(mulberry32(7000 + CARGOES.indexOf(c)));
      const b = new Board();
      const harvests: [ResKey, number][] = [];
      b.onHarvest = (r, n) => harvests.push([r, n]);
      for (let i = 0; i < 4; i++) b.grid[0][i]!.res = res;
      await b.settle();
      const forged =
        b.gems().some((g) => g.res === res && g.tier >= 1) ||
        harvests.some(([r]) => r === res);
      expect(forged, `match-4 of ${res} (${c}) forged no token`).toBe(true);
    }
  }, 30_000);

  it("a tier-1 token in an ordinary match pays exactly 1 of every cargo (the yield floor)", async () => {
    // The floor section 3's income model stands on: one match, one unit.
    // ALT guards pin the run at exactly 3 — an accidental run of 4 would pay
    // double (the match-4 multiplier) and test the wrong rule.
    const ALT = (res: ResKey): ResKey => (res === "wood" ? "ore" : "wood");
    for (const c of CARGOES) {
      const res: ResKey = CARGO_TO_GEM[c];
      setRng(mulberry32(9000 + CARGOES.indexOf(c)));
      const b = new Board();
      const harvests: [ResKey, number][] = [];
      b.onHarvest = (r, n) => harvests.push([r, n]);
      b.grid[0][1]!.res = res; b.grid[0][1]!.tier = 1;
      b.grid[0][2]!.res = res;
      b.grid[0][3]!.res = res;
      b.grid[0][0]!.res = ALT(res);
      b.grid[0][4]!.res = ALT(res);
      b.grid[1][1]!.res = ALT(res);
      b.grid[1][2]!.res = ALT(res);
      b.grid[1][3]!.res = ALT(res);
      await b.settle();
      expect(harvests, `tier-1 ${res} (${c}) paid nothing`).toContainEqual([res, 1]);
    }
  }, 30_000);
});

// ══════════════════════════════════════════════════════════════════════════
// 5. the AI pays the same ticket (one cost model, W3's rule)
// ══════════════════════════════════════════════════════════════════════════
describe("PP-07 the rival pays the same ticket", () => {
  const flatGrid = (industries: Industry[] = []): Grid => {
    const occupancy = new Int16Array(MAP_W * MAP_H).fill(-1);
    industries.forEach((ind, i) => {
      ind.id = i;
      for (let y = ind.ty; y < ind.ty + ind.h; y++)
        for (let x = ind.tx; x < ind.tx + ind.w; x++) occupancy[tIdx(x, y)] = i;
    });
    return {
      w: MAP_W, h: MAP_H,
      terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
      industries, towns: [], occupancy, seed: 7,
    };
  };
  const ind = (type: string, tx: number, ty: number): Industry => {
    const def = INDUSTRY_BY_KEY[type];
    return {
      id: 0, type, tx, ty,
      w: def.footprint[0], h: def.footprint[1],
      output: def.output, banditUntil: 0,
    };
  };

  it("charges the full depot ticket in `spent` on a paid depot turn", () => {
    const grid = flatGrid([ind("farm", 12, 5)]);
    const eco = { grid, track: createTrack(), harvesters: [], factories: [] };
    const F = { owner: "ai", ownerId: 0, tx: 5, ty: 5 };
    const out = aiBuildStep(eco, F, {
      stock: {}, purse: { wood: 9999, stone: 9999, grain: 9999, ore: 9999, oil: 9999 },
      freeDepots: 0,
    }, 1);
    expect(out?.harvester).toBeTruthy();
    for (const [c, n] of Object.entries(DEPOT_COST) as [Cargo, number][]) {
      expect(out!.spent[c] ?? 0, `AI underpaid ${c}`).toBeGreaterThanOrEqual(n);
    }
  });
});
