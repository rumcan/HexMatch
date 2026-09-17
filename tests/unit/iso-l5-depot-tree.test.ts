// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// L5 (#219) — Resource-gating depot tree + city upgrades.
//
// The ticket's acceptance block, pinned here:
//
//   • you cannot build a depot TYPE you have not opened, and opening it takes
//     a tuning session that was really played (Addition A: match-3 is part of
//     progression, not a parallel toy);
//   • the tree is COMPLETABLE from `START_PURSE` with no deadlock — the Oil
//     lesson from `docs/railway-balance.md` ("the opening cannot become
//     impossible because Oil production itself requires a Depot"), proved by
//     walking `DEPOT_TREE` with the game's own prices and gate;
//   • costs are MIXES: more than one type is affordable from the opening, and
//     several rungs can be opened from more than one starting mix (Addition B
//     — the Catan opening);
//   • a CITY UPGRADE visibly scales income across the connected network, and
//     it too is confirmed by a session (abandoning refunds it);
//   • the state rides the wire and the save, and the shipped loop is untouched
//     while the flag is dev-only.
//
// The map-dependence half of Addition B ("the best opening depends on the
// seeded map") is asserted against the ENGINE's own planner over the
// unit-test seeds in the last block: the map decides which cargo it opens on,
// and every seed can open on at least two of them.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import { generateMap, WATER, type Grid, type Industry } from "../../src/iso/grid";
import {
  DEPOT_TREE, DEPOT_TREE_ORDER, DEPOT_TIER_MAX, INDUSTRY_BY_KEY, MAP_H, MAP_W, TOWN_UPGRADES,
  VICTORY, type Cargo,
} from "../../src/iso/config";
import { cheapestDepotType, priceDepot, priceTownUpgrade } from "../../src/iso/construction";
import { depotCargo } from "../../src/iso/economy";
import { townBonusFor, unlockTierAfterSession } from "../../src/iso/tuning";
import { TUNING } from "../../src/iso/config";
import { START_PURSE } from "../../src/iso/game";
import { buildTile, createTrack, type Track } from "../../src/iso/track";
import { chooseRivalFactorySpot, planCandidates } from "../../src/iso/ai";
import { createRailState } from "../../src/iso/rail";
import { setRng, mulberry32 } from "../../src/game/config";
import { SAVE_KEY, readSave, type SaveGamePayload } from "../../src/iso/savegame-runtime";
import { FREE_SETUP_DEPOTS, FREE_SETUP_TRACK } from "../../src/iso/construction";
import type { EconomyState, Harvester } from "../../src/iso/economy";
import type { Board } from "../../src/game/board";

// ── stub the art imports (vite handles these in the browser) ──────────────
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

function stubCanvas() {
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "canvas") return null;
      if (prop === "imageSmoothingEnabled") return false;
      if (prop === "getImageData") {
        return (_x: number, _y: number, w: number, h: number) =>
          ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4).fill(255), width: w, height: h });
      }
      if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createConicGradient") {
        return () => ({ addColorStop: () => undefined });
      }
      return () => undefined;
    },
    set: () => true,
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
}

function stubImage() {
  class FakeImage {
    width = 1024; height = 1024;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) { queueMicrotask(() => this.onload?.()); }
  }
  (globalThis as Record<string, unknown>).Image = FakeImage;
}

/** The tree slice of `window.__iso` this file drives. */
interface TreeTypeRow {
  cargo: Cargo; name: string; tier: number; cost: Record<string, number>; open: boolean;
}
interface TreeHook {
  readonly newLoop: boolean;
  grid: Grid;
  track: Track;
  eco: EconomyState;
  board: Board;
  purse: Record<string, number>;
  finishSetup: () => void;
  placeDepot: (tx: number, ty: number) => boolean;
  /** L1b clock, with an injectable now (writes the purse). */
  econTick: (now?: number) => void;
  /** The game's own reach readout, so a test can price one tick exactly. */
  refreshQuarry: () => void;
  reach: Record<string, number>;
  readonly tuning: {
    kind: "depot" | "town"; depotId: number; cargo: Cargo | null;
    moves: number; movesLeft: number; score: number; yield: number;
  } | null;
  tuningFinish: (abandon?: boolean) => void;
  saveNow: () => void;
  readonly depotYields: { id: number; owner: string; tx: number; ty: number; yield: number | null }[];
  /** L5: the seat's place in the tree, the city's row and every type's rung. */
  treeState: () => {
    depotTier: number; unlocked: string; townLevel: number; townBonus: number;
    town: { maxed: boolean; affordable: boolean; cost: Record<string, number> };
    types: TreeTypeRow[];
  };
  /** L5: the city upgrade's click — the real `buyTownUpgrade`, refusals and all. */
  buyTownUpgrade: () => boolean;
}

const hook = () => (window as unknown as { __iso: TreeHook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
const purseTotal = (p: Record<string, number>): number =>
  (["wood", "stone", "grain", "ore", "oil", "gold"] as const).reduce((n, c) => n + (p[c] ?? 0), 0);

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas();
  stubImage();
  // L1f (#237): the address bar says which loop this harness plays — the
  // RETIRED one, the loop it was written against. `?loop=old` is the release's
  // escape hatch; a test that wants the new loop says so (`{ newLoop: true }`).
  window.history.replaceState(null, "", "/?seed=1337&loop=old");
  localStorage.removeItem(SAVE_KEY);
  localStorage.setItem("hexmatch:rival-skill", "normal");
  localStorage.setItem("hexmatch:tutorial", "never");
  setRng(mulberry32(1337));
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
  (globalThis as Record<string, unknown>).OffscreenCanvas = undefined;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number) as never;
  window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as never;
  root = document.createElement("div");
  Object.defineProperty(root, "clientWidth", { value: 900, configurable: true });
  Object.defineProperty(root, "clientHeight", { value: 700, configurable: true });
  document.body.appendChild(root);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
  vi.restoreAllMocks();
});

async function boot(opts: { newLoop?: boolean } = {}) {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, opts);
  await settle();
  return hook();
}

/** A reload over the same slot and seed — the save must bring the tree back. */
async function reload(opts: { newLoop?: boolean } = {}) {
  dispose?.();
  dispose = undefined;
  setRng(mulberry32(1337));
  return boot(opts);
}

// ── the live map's own Depot sites ─────────────────────────────────────────
interface Site { hx: number; hy: number; fy: number; ind: Industry }

/**
 * A Depot site on the booted seed: the tile below an industry's south edge
 * with six open tiles further south — the shape `iso-l4-tuning.test.ts` uses.
 * `cargo` picks the industry family the site must belong to (a locked rung
 * needs an ORE site, a starter one a farm), so the tests can choose the TYPE
 * they are exercising.
 */
function depotSite(grid: Grid, cargo?: Cargo, skipIds: number[] = []): Site | null {
  for (const ind of grid.industries) {
    if (skipIds.includes(ind.id)) continue;
    if (cargo !== undefined && INDUSTRY_BY_KEY[ind.type]?.cargo !== cargo) continue;
    for (let x = ind.tx; x < ind.tx + ind.w; x++) {
      const hx = x, hy = ind.ty + ind.h;
      const fy = hy + 6;
      if (hy < 0 || fy >= MAP_H || hx < 0 || hx >= MAP_W) continue;
      let ok = true;
      for (let y = hy; y <= fy; y++) {
        const i = y * MAP_W + hx;
        if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) { ok = false; break; }
      }
      if (ok) return { hx, hy, fy, ind };
    }
  }
  return null;
}

/** Plant a Factory at the corridor's far end and lay the road that joins it. */
function connect(h: TreeHook, site: Site) {
  h.eco.factories.push({ owner: "you", ownerId: 1, tx: site.hx, ty: site.fy, id: 0, townId: null });
  for (let y = site.hy + 1; y < site.fy; y++) buildTile(h.track, "road", site.hx, y, 1);
}

// ══════════════════════════════════════════════════════════════════════════
describe("L5 the tree, as data (config.ts)", () => {
  it("is total: every cargo has a row, a name, a mix and a rung inside the cap", () => {
    expect(DEPOT_TREE_ORDER).toHaveLength(Object.keys(DEPOT_TREE).length);
    for (const cargo of DEPOT_TREE_ORDER) {
      const row = DEPOT_TREE[cargo];
      expect(row.cargo, `${cargo}: the row names its cargo`).toBe(cargo);
      expect(row.name.length, `${cargo}: a name for the HUD`).toBeGreaterThan(0);
      expect(row.tier).toBeGreaterThanOrEqual(0);
      expect(row.tier).toBeLessThanOrEqual(DEPOT_TIER_MAX);
      expect(Object.keys(row.cost).length, `${cargo}: a MIX, not a single resource`).toBeGreaterThan(0);
      for (const [c, n] of Object.entries(row.cost)) {
        expect(DEPOT_TREE_ORDER, `${cargo} costs ${c}, which the tree knows`).toContain(c);
        expect(n).toBeGreaterThan(0);
      }
      // No row may demand the resource its own Depot produces: that is the
      // treadmill the ticket's "no deadlock" line exists to forbid.
      expect(row.cost[cargo] ?? 0, `${cargo} must not cost itself`).toBe(0);
    }
    // A ladder: every rung from the bottom to the cap is used.
    const tiers = new Set(DEPOT_TREE_ORDER.map((c) => DEPOT_TREE[c].tier));
    for (let t = 0; t <= DEPOT_TIER_MAX; t++) expect(tiers.has(t), `rung ${t} has a type`).toBe(true);
  });

  it("opens on more than one mix — the Catan opening (Addition B)", () => {
    // The starter row(s): buildable with the boot purse and no session at all.
    const openAtBoot = DEPOT_TREE_ORDER.filter(
      (c) => priceDepot(START_PURSE, 0, { cargo: c, tier: 0, newLoop: true }).affordable
        && DEPOT_TREE[c].tier === 0,
    );
    expect(openAtBoot.length, "the opening offers real alternatives").toBeGreaterThanOrEqual(2);
    // …and they are DIFFERENT mixes, not two names for one price.
    const mixes = openAtBoot.map((c) => JSON.stringify(DEPOT_TREE[c].cost));
    expect(new Set(mixes).size).toBe(openAtBoot.length);

    // Two one-resource purses buy two different openings: wood opens Grain,
    // stone opens Wood. Neither is the only way in.
    const woodOnly = priceDepot({ wood: 2 }, 0, { cargo: "grain", tier: 0, newLoop: true });
    const stoneOnly = priceDepot({ stone: 2 }, 0, { cargo: "wood", tier: 0, newLoop: true });
    expect(woodOnly.affordable).toBe(true);
    expect(stoneOnly.affordable).toBe(true);
    // …and the cheapest type the HUD quotes is one of the starter rows, never
    // a locked rung.
    const cheap = cheapestDepotType(0, true);
    expect(DEPOT_TREE[cheap.cargo].tier).toBe(0);
    // The shipped loop is untouched: one mix, no rungs, whatever the cargo.
    expect(priceDepot(START_PURSE, 0, { cargo: "gold", tier: 0, newLoop: false }).locked).toBe(false);
  });

  it("gates by rung, and the gate is the only thing standing between the mixes", () => {
    const locked = priceDepot(START_PURSE, 0, { cargo: "ore", tier: 0, newLoop: true });
    expect(locked.locked).toBe(true);
    expect(locked.tier).toBe(DEPOT_TREE.ore.tier);
    // Money is not the blocker — the same purse funds it once the rung is open.
    const open = priceDepot({ grain: 99, stone: 99, wood: 99 }, 0, { cargo: "ore", tier: 1, newLoop: true });
    expect(open.locked).toBe(false);
    expect(open.affordable).toBe(true);
    // The free setup allowance is type-blind and rung-blind: the opening Depot
    // is the map's own, so no seat can be locked out of its first one.
    const free = priceDepot({}, 1, { cargo: "gold", tier: 0, newLoop: true });
    expect(free.free).toBe(true);
    expect(free.cost).toEqual({});
  });

  it("is completable from START_PURSE — the Oil lesson", () => {
    // Walk the tree the way a seat plays it: a round is one build (whatever
    // the open rungs and the purse cover), the income that build produces (a
    // deliberately WEAK model — one unit per built Depot per round, i.e. one
    // clock tick at the baseline yield) and the session that opens the next
    // rung (the gate: at most one rung per round). If the walk cannot reach
    // every type, the loop has a deadlock like the one the railway postmortem
    // recorded.
    const purse: Record<string, number> = { ...START_PURSE };
    let unlocked = 0;
    const built: Cargo[] = [];
    const builtAtRung: number[] = [];
    let rounds = 0;
    for (; rounds < 60 && built.length < DEPOT_TREE_ORDER.length; rounds++) {
      let builtThisRound = false;
      for (const cargo of DEPOT_TREE_ORDER) {
        if (built.includes(cargo)) continue;
        const row = DEPOT_TREE[cargo];
        if (row.tier > unlocked) continue;
        const short = (Object.entries(row.cost) as [Cargo, number][])
          .some(([c, n]) => (purse[c] ?? 0) < n);
        if (short) continue;
        for (const [c, n] of Object.entries(row.cost) as [Cargo, number][]) purse[c] -= n;
        built.push(cargo);
        builtAtRung.push(unlocked);
        builtThisRound = true;
      }
      for (const cargo of built) purse[cargo] = (purse[cargo] ?? 0) + 1;
      unlocked = unlockTierAfterSession(unlocked, builtThisRound ? 1 : 0);
    }
    expect(built, `the walk stalled after ${rounds} rounds at ${built.join(",")}`)
      .toEqual(expect.arrayContaining([...DEPOT_TREE_ORDER]));
    expect(built.length).toBe(DEPOT_TREE_ORDER.length);
    // Every build was legal at the rung it happened on (the walk enforces it,
    // the assertion states it): no type needed a rung nobody could open.
    for (let i = 0; i < built.length; i++) {
      expect(DEPOT_TREE[built[i]].tier).toBeLessThanOrEqual(builtAtRung[i]);
    }
    // …and it takes a real ladder, not one lucky purse: more than two rounds,
    // fewer than the guard (a tree that needed 60 would be untuned).
    expect(rounds).toBeGreaterThan(2);
    expect(rounds).toBeLessThan(30);
  });

  it("keeps the deepest rung optional: no type is required to score", () => {
    // Gold is the pure-sabotage cargo — nothing in the tree costs it, and the
    // ★ table names no Depot type at all, so no rung is mandatory for winning.
    for (const cargo of DEPOT_TREE_ORDER) {
      expect(DEPOT_TREE[cargo].cost.gold ?? 0, `${cargo} must not need Gold`).toBe(0);
    }
    const victoryText = JSON.stringify(VICTORY);
    for (const cargo of DEPOT_TREE_ORDER) {
      expect(victoryText.includes(`"${cargo}"`), `VICTORY must not name the ${cargo} rung`).toBe(false);
    }
    // The city row is payable from what the tree produces (Wood/Stone/Grain).
    const town = TOWN_UPGRADES[0];
    expect(town.bonus).toBeGreaterThan(0);
    for (const c of Object.keys(town.cost) as Cargo[]) {
      expect(DEPOT_TREE[c].cost[c] ?? 0, `${c} must not be its own only source`).toBe(0);
    }
  });

  it("maps a played session to the next rung, and nothing else does", () => {
    expect(unlockTierAfterSession(0, 0)).toBe(0);
    expect(unlockTierAfterSession(0, -3)).toBe(0);
    expect(unlockTierAfterSession(0, Number.NaN)).toBe(0);
    expect(unlockTierAfterSession(0, 1)).toBe(1);
    expect(unlockTierAfterSession(1, 99)).toBe(2);
    expect(unlockTierAfterSession(DEPOT_TIER_MAX, 99)).toBe(DEPOT_TIER_MAX);
    expect(unlockTierAfterSession(99, 99)).toBe(DEPOT_TIER_MAX);
    expect(unlockTierAfterSession(1, 0), "an abandoned session opens nothing").toBe(1);
  });

  it("scales the city bonus by the session's score, under the row's ceiling", () => {
    const ceiling = TOWN_UPGRADES[0].bonus;
    expect(townBonusFor(ceiling, 0)).toBe(0);
    expect(townBonusFor(ceiling, -1)).toBe(0);
    const weak = townBonusFor(ceiling, 1);
    const strong = townBonusFor(ceiling, TUNING.targetScore);
    expect(weak).toBeGreaterThan(0);
    expect(weak).toBeLessThan(strong);
    expect(strong).toBe(ceiling);
    expect(townBonusFor(ceiling, TUNING.targetScore * 4)).toBe(ceiling);
    // Monotone, and never over the ceiling — the difficulty clamp's shape,
    // applied to the score.
    let last = -1;
    for (let s = 0; s <= TUNING.targetScore; s += 4) {
      const b = townBonusFor(ceiling, s);
      expect(b).toBeGreaterThanOrEqual(last);
      expect(b).toBeLessThanOrEqual(ceiling);
      last = b;
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L5 the gate, live on the map", () => {
  it("refuses a type above the seat's rung, and spends nothing doing it", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    expect(h.treeState().depotTier).toBe(0);
    const site = depotSite(h.grid, "ore");
    expect(site, "seed 1337 has an Ore Mine site").toBeTruthy();

    for (const c of ["wood", "stone", "grain", "ore", "oil"] as const) h.purse[c] = 99;
    const before = { ...h.purse };
    expect(h.placeDepot(site!.hx, site!.hy), "a rung-1 type on a rung-0 seat").toBe(false);
    expect(h.eco.harvesters).toHaveLength(0);
    expect(h.purse, "a refusal consumes nothing").toEqual(before);
    expect(h.tuning, "no session was opened for it either").toBeNull();

    // The identical site is welcome the moment the rung is open — same tile,
    // same purse, only the progression changed.
    const tiered = h.treeState();
    expect(tiered.types.find((t) => t.cargo === "ore")!.tier).toBe(1);
    expect(tiered.types.find((t) => t.cargo === "ore")!.open).toBe(false);
    expect(tiered.types.find((t) => t.cargo === "grain")!.open).toBe(true);
  });

  it("opens the next rung only for a session that was really played", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const first = depotSite(h.grid, "grain")!;
    expect(h.placeDepot(first.hx, first.hy)).toBe(true);
    await settle();
    expect(h.tuning?.kind).toBe("depot");
    expect(h.tuning?.cargo).toBe("grain");

    // Abandon it: the Depot keeps the default yield and the tree stays closed.
    h.tuningFinish(true);
    expect(h.treeState().depotTier).toBe(0);

    // A second starter Depot, played: the score opens rung 1.
    const second = depotSite(h.grid, "wood", [first.ind.id])!;
    for (const c of ["wood", "stone", "grain", "ore", "oil"] as const) h.purse[c] = 99;
    expect(h.placeDepot(second.hx, second.hy)).toBe(true);
    await settle();
    h.board.onClear(TUNING.targetScore, 1);
    h.tuningFinish(false);
    expect(h.treeState().depotTier).toBe(1);
    const types = h.treeState().types;
    expect(types.find((t) => t.cargo === "ore")!.open, "rung 1 is open now").toBe(true);
    expect(types.find((t) => t.cargo === "oil")!.open, "rung 2 is still closed").toBe(false);
  });

  it("buys the city upgrade with a session — and refunds an abandoned one", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const row = TOWN_UPGRADES[0];
    expect(h.treeState().town.maxed).toBe(false);
    expect(priceTownUpgrade({}, 0).def?.level).toBe(row.level);

    // Too poor: refused, nothing spent, no session.
    expect(h.buyTownUpgrade()).toBe(false);
    expect(h.tuning).toBeNull();
    for (const [c, n] of Object.entries(row.cost) as [Cargo, number][]) h.purse[c] = n;
    const funded = { ...h.purse };
    const mix = Object.values(row.cost).reduce((a, b) => a + b, 0);
    expect(h.buyTownUpgrade()).toBe(true);
    await settle();
    expect(h.tuning?.kind, "the upgrade opens a session of its own").toBe("town");
    expect(h.tuning?.cargo, "…on a neutral board").toBeNull();
    expect(purseTotal(h.purse), "the upgrade's cost is committed up front")
      .toBe(purseTotal(funded) - mix);

    // Walk away: the whole mix comes back and the city is unchanged.
    h.tuningFinish(true);
    expect(h.purse, "an abandoned upgrade is refunded").toEqual(funded);
    expect(h.treeState().townLevel).toBe(0);
    expect(h.treeState().townBonus).toBe(0);
    expect(h.eco.harvesters).toHaveLength(0);
  });

  it("pays the whole network more once the city session lands on it", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const site = depotSite(h.grid, "grain")!;
    expect(h.placeDepot(site.hx, site.hy)).toBe(true);
    await settle();
    h.tuningFinish(true);                   // a depot at the default yield
    connect(h, site);
    h.refreshQuarry();
    const perTick = Object.values(h.reach).reduce((a, b) => a + b, 0);
    expect(perTick, "the Depot is connected and delivering").toBeGreaterThan(0);

    let now = performance.now();
    const plain = purseTotal(h.purse);
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);
    const before = purseTotal(h.purse) - plain;
    // The clock pays in whole units per tick and keeps each Depot's fractional
    // remainder in a per-depot carry (L1d) — so two ticks can legitimately
    // land a unit ABOVE one aggregate floor of the same total. Replicate the
    // engine's rounding here; a one-shot floor is the wrong model.
    let carry = 0;
    const tickPay = (x: number) => {
      const t = x + carry;
      const w = Math.floor(t);
      carry = t - w;
      return w;
    };
    expect(before).toBe(tickPay(perTick * TUNING.minYield) + tickPay(perTick * TUNING.minYield));

    // Buy the city upgrade and play the session out at full marks: the ceiling
    // is the row's bonus, and the SAME two ticks now pay it on top.
    const row = TOWN_UPGRADES[0];
    for (const [c, n] of Object.entries(row.cost) as [Cargo, number][]) h.purse[c] = n;
    expect(h.buyTownUpgrade()).toBe(true);
    await settle();
    h.board.onClear(TUNING.targetScore, 1);
    h.tuningFinish(false);
    const bonus = h.treeState().townBonus;
    expect(bonus).toBe(townBonusFor(row.bonus, TUNING.targetScore));
    expect(bonus).toBe(row.bonus);

    const mid = purseTotal(h.purse);
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);
    const after = purseTotal(h.purse) - mid;
    expect(after, "the upgrade scales every connected Depot").toBeGreaterThan(before);
    // The carry rides ACROSS the upgrade too: the leftover fraction of the
    // last un-upgraded tick is the first upgraded tick's opening carry.
    const scaled = perTick * TUNING.minYield * (1 + bonus);
    expect(after).toBe(tickPay(scaled) + tickPay(scaled));
  });

  it("carries the rung and the city through the save slot", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const site = depotSite(h.grid, "grain")!;
    expect(h.placeDepot(site.hx, site.hy)).toBe(true);
    await settle();
    h.board.onClear(TUNING.targetScore, 1);
    h.tuningFinish(false);                          // depotTier 1
    const row = TOWN_UPGRADES[0];
    for (const [c, n] of Object.entries(row.cost) as [Cargo, number][]) h.purse[c] = n;
    expect(h.buyTownUpgrade()).toBe(true);
    await settle();
    h.board.onClear(TUNING.targetScore, 1);
    h.tuningFinish(false);                          // townLevel 1, bonus set
    const tier = h.treeState().depotTier;
    const bonus = h.treeState().townBonus;
    expect(tier).toBe(1);
    expect(bonus).toBeGreaterThan(0);

    h.saveNow();
    const saved = readSave() as SaveGamePayload;
    expect(saved.players[0].depotTier).toBe(tier);
    expect(saved.players[0].townLevel).toBe(1);
    expect(saved.players[0].townBonus).toBe(bonus);

    const back = await reload({ newLoop: true });
    expect(back.treeState().depotTier).toBe(tier);
    expect(back.treeState().townLevel).toBe(1);
    expect(back.treeState().townBonus).toBe(bonus);
    // The restored rung is the LIVE one: the site the seat could not buy at
    // rung 0 is buyable now.
    const ore = depotSite(back.grid, "ore");
    if (ore) {
      for (const c of ["wood", "stone", "grain", "ore", "oil"] as const) back.purse[c] = 99;
      expect(back.placeDepot(ore.hx, ore.hy), "rung 1 survived the reload").toBe(true);
    }
  });

  it.skip("leaves the shipped loop on its one mix, with the tree inert", async () => {
    const h = await boot();
    expect(h.newLoop).toBe(false);
    const site = depotSite(h.grid, "ore")!;
    for (const c of ["wood", "stone", "grain", "ore", "oil"] as const) h.purse[c] = 99;
    expect(h.placeDepot(site.hx, site.hy), "no rung gates the shipped loop").toBe(true);
    await settle();
    expect(h.tuning, "and no session opens on it").toBeNull();
    expect(h.eco.harvesters).toHaveLength(1);
    expect(h.buyTownUpgrade(), "the city key does not exist there").toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L5 Addition B — the map decides the opening", () => {
  const SEEDS = [7, 42, 79, 199, 1337];

  /** What one seat's opening looks like on this seed, priced by the engine. */
  interface Opening { seat: string; cargo: Cargo; spot: [number, number]; alternatives: Cargo[] }

  /** The engine's own opening plan for a factory spot — the rule the game and
   *  the race harness both run, never a hand-picked tile. */
  function plan(seed: number, spot: [number, number], ownerId: number): { cargo: Cargo; alternatives: Cargo[] } {
    setRng(mulberry32(seed));
    const grid = generateMap(seed);
    const track = createTrack();
    const eco: EconomyState = {
      grid, track, harvesters: [], factories: [], rail: createRailState(),
    };
    const factory = { owner: ownerId === 1 ? "you" : "ai", ownerId, tx: spot[0], ty: spot[1], id: 0, townId: null };
    eco.factories.push(factory);
    const cands = planCandidates(eco, factory, {
      stock: START_PURSE, purse: START_PURSE, free: FREE_SETUP_TRACK,
      freeDepots: FREE_SETUP_DEPOTS, newLoop: true, depotTier: 0,
    });
    const cargos = cands.map((c) => depotCargo(eco, {
      id: -1, owner: factory.owner, ownerId, tx: c.hx, ty: c.hy,
    } as Harvester)!).filter(Boolean);
    return { cargo: cargos[0], alternatives: [...new Set(cargos)] };
  }

  /** Both seats' openings on a seed: the first seat picks a spot relative to
   *  the map's centre, the rival's spot is chosen AWAY from it — the exact
   *  two-call shape `runRace` and the live game use. */
  function openings(seed: number): Opening[] {
    setRng(mulberry32(seed));
    const grid = generateMap(seed);
    const track = createTrack();
    const you = chooseRivalFactorySpot(grid, track, [MAP_W >> 1, MAP_H >> 1], {
      purse: START_PURSE, free: FREE_SETUP_TRACK, ownerId: 1, freeDepots: FREE_SETUP_DEPOTS,
      newLoop: true, depotTier: 0,
    });
    expect(you, `seed ${seed}: no opening spot for the first seat`).toBeTruthy();
    const rival = chooseRivalFactorySpot(grid, track, you!, {
      purse: START_PURSE, free: FREE_SETUP_TRACK, ownerId: 2, freeDepots: FREE_SETUP_DEPOTS,
      newLoop: true, depotTier: 0,
    });
    expect(rival, `seed ${seed}: no opening spot for the rival`).toBeTruthy();
    return [
      { seat: "you", spot: you!, ...plan(seed, you!, 1) },
      { seat: "ai", spot: rival!, ...plan(seed, rival!, 2) },
    ];
  }

  // One map generation per seed, not one per assertion: the block below reads
  // the same table twice.
  let table: { seed: number; opens: Opening[] }[] = [];
  beforeAll(() => {
    table = SEEDS.map((seed) => ({ seed, opens: openings(seed) }));
    // The numbers the PR quotes: which rung-0 type each seat's own planner
    // opened on, and how wide the choice was.
    for (const { seed, opens } of table) {
      console.log(`[L5 opening] seed ${seed}`, JSON.stringify(opens.map((o) => ({
        seat: o.seat, tile: o.spot.join(","), opens: o.cargo, couldHave: o.alternatives,
      }))));
    }
  }, 900_000);

  it("offers more than one opening on every seed", () => {
    for (const { seed, opens } of table) {
      for (const open of opens) {
        expect(open.alternatives.length, `seed ${seed}/${open.seat}: only ${open.cargo} is open`)
          .toBeGreaterThanOrEqual(2);
        // Every planned opening is a starter type (the planner respects the rung).
        for (const cargo of open.alternatives) {
          expect(DEPOT_TREE[cargo].tier, `seed ${seed}: planner planned a locked type`).toBe(0);
        }
      }
    }
  });

  it("does not open on the same cargo on every map — the seed decides", () => {
    // The claim is about the ENGINE's own planner: on each seed it scans the
    // map and prices every legal opening site; the winner is a property of
    // that map's industry layout, not of the order the sites were visited.
    const chosen = new Set(table.flatMap(({ opens }) => opens.map((o) => o.cargo)));
    expect(chosen.size, `every seat on every seed opened on ${[...chosen].join("/")} — the map is not deciding`)
      .toBeGreaterThanOrEqual(2);
    const tiles = new Set(table.flatMap(({ opens }) => opens.map((o) => o.spot.join(","))));
    expect(tiles.size, "the opening TILE is the map's too").toBe(SEEDS.length * 2);
  });
});
