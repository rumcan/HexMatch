// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { armSessionSabotage, readBlackMarket, sabotagedObstacles, sabotagedScore, sessionSabotage } from "../../src/iso/black-market";
import { Board } from "../../src/game/board";
import { mulberry32, SABOTAGE, setRng } from "../../src/game/config";
import { TUNING } from "../../src/iso/config";
import { SAVE_KEY } from "../../src/iso/savegame-runtime";

vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

describe("BM-2 session rules", () => {
  it("expires exactly at the deadline, adds to difficulty, and never deadlocks the board", () => {
    const actor = readBlackMarket(), target = readBlackMarket();
    armSessionSabotage(actor, target, "frost", 1000);
    expect(actor.readyAt).toBe(181000);
    const base = { frost: 2, girders: 1, frostHard: 1 as const };
    const plan = sabotagedObstacles(base, target, 120999);
    expect(plan).toEqual({ frost: 6, girders: 3, frostHard: 1 });
    for (let seed = 0; seed < 30; seed++) {
      setRng(mulberry32(seed));
      const board = new Board();
      const placed = board.seedObstacles(plan.frost, plan.girders, plan.frostHard);
      expect(placed.frost).toBeGreaterThan(0);
      expect(placed.girders).toBeGreaterThan(0);
      expect(board.hasMove()).toBe(true);
    }
    expect(sabotagedObstacles(base, target, 121000)).toEqual(base);
    expect(sessionSabotage(actor, 1000).frost).toBe(0);
  });
  it("Red Tape costs two moves and both effects also penalise simulated AI sessions", () => {
    const actor = readBlackMarket(), target = readBlackMarket();
    armSessionSabotage(actor, target, "redTape", 0);
    expect(sessionSabotage(target, 59999).lostMoves).toBe(2);
    expect(sabotagedScore(100, target, 59999)).toBeCloseTo(100 * (TUNING.moves - 2) / TUNING.moves);
    expect(sabotagedScore(100, target, 60000)).toBe(100);
    armSessionSabotage(actor, target, "frost", 180000);
    expect(sabotagedScore(100, target, 180000)).toBeLessThan(100);
    expect(sabotagedScore(100, target, 300000)).toBe(100);
  });
  it("accepts old saves and sanitises malformed deadlines", () => {
    // STALE (PERK-1 #610): the state also carries the manager's frost / girders bonuses (default 0).
    expect(readBlackMarket()).toEqual({ frostUntil: 0, redTapeUntil: 0, readyAt: 0, frostBonus: 0, girdersBonus: 0 });
    expect(readBlackMarket({ frostUntil: NaN, redTapeUntil: -1, readyAt: Infinity })).toEqual(readBlackMarket());
  });
});

let root: HTMLDivElement;
let dispose: (() => void) | undefined;
// Use the game's public debug twins, never a second purchase/session path.
interface Hook {
  grid: import("../../src/iso/grid").Grid;
  board: Board;
  eco: import("../../src/iso/economy").EconomyState;
  rivalTuning: () => void;
  purse: Record<string, number>;
  purses: Record<string, number>[];
  blackMarketStates: import("../../src/iso/black-market").BlackMarketState[];
  tuning: { moves: number; obstacles: import("../../src/game/board").BoardObstacles };
  market: { ms: number; advance: (ms: number) => void };
  finishSetup: () => void;
  buyBlackFor: (seat: number, key: string) => boolean;
  buyTownUpgrade: () => boolean;
  tuningFinish: (abandon: boolean) => void;
  setRivalSkill: (key: "easy" | "normal" | "hard") => void;
  rivalRaidNow: () => void;
  saveNow: () => void;
  placeDepot: (x: number, y: number) => boolean;
  placementPlan: (kind: "depot", x: number, y: number) => { valid: boolean };
}
function getHook() { return (window as unknown as { __iso: Hook }).__iso; }
beforeEach(() => {
  const ctx = new Proxy({}, { get: (_, p) => p === "getImageData" ? (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) : p.toString().includes("Gradient") ? () => ({ addColorStop() {} }) : () => undefined, set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ctx) as never);
  vi.stubGlobal("Image", class { width = 1024; height = 1024; onload?: () => void; set src(_: string) { queueMicrotask(() => this.onload?.()); } });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("OffscreenCanvas", undefined);
  // No animation clock: tests advance the authoritative match clock explicitly.
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  localStorage.clear();
  localStorage.setItem("hexmatch:tutorial", "never");
  localStorage.setItem("hexmatch:tuning:skipTarget", "1");
  window.history.replaceState(null, "", "/?seed=1337");
  root = document.createElement("div");
  document.body.appendChild(root);
});
afterEach(() => { dispose?.(); root.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function boot(): Promise<Hook> {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, { seed: 1337, newLoop: true });
  for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 0));
  const h = getHook();
  h.finishSetup();
  for (const purse of h.purses) for (const key of Object.keys(purse)) purse[key] = 1000;
  return h;
}

describe("BM-2 real game", () => {
  it("lists paper cards, charges only once, blocks alternating spam and affects city boards until expiry", async () => {
    const h = await boot();
    expect(root.querySelector('[data-black="frost"]')?.textContent).toContain("Frost / Iron Girders");
    expect(root.querySelector('[data-black="redTape"]')?.textContent).toContain("Red Tape");
    const gold = h.purses[1].gold;
    expect(h.buyBlackFor(1, "frost")).toBe(true);
    expect(h.purses[1].gold).toBe(gold - SABOTAGE.frost.gold);
    expect(h.buyBlackFor(1, "redTape")).toBe(false);
    expect(h.purses[1].gold).toBe(gold - SABOTAGE.frost.gold);
    expect(h.buyTownUpgrade()).toBe(true);
    expect(h.tuning.obstacles).toMatchObject({ frost: 4, girders: 2 });
    expect(h.board.hasMove()).toBe(true);
    h.tuningFinish(true);
    h.market.advance(120000);
    expect(h.buyTownUpgrade()).toBe(true);
    expect(h.tuning.obstacles).toMatchObject({ frost: 0, girders: 0 });
    h.tuningFinish(true);
    h.market.advance(60000);
    expect(h.buyBlackFor(1, "redTape")).toBe(true);
    expect(h.buyTownUpgrade()).toBe(true);
    expect(h.tuning.moves).toBe(TUNING.moves - 2);
    h.tuningFinish(true);
    h.market.advance(60000);
    expect(h.buyTownUpgrade()).toBe(true);
    expect(h.tuning.moves).toBe(TUNING.moves);
  });
  it("applies Frost and Red Tape to a newly built Depot, without changing an already open session", async () => {
    const h = await boot();
    h.setRivalSkill("easy"); // no difficulty obstacles: every obstacle below is sabotage
    expect(h.buyBlackFor(1, "frost")).toBe(true);
    let site: [number, number] | undefined;
    for (const ind of h.grid.industries) {
      for (let x = ind.tx; x < ind.tx + ind.w; x++) {
        const y = ind.ty + ind.h;
        if (h.placementPlan("depot", x, y).valid) { site = [x, y]; break; }
      }
      if (site) break;
    }
    expect(site).toBeDefined();
    expect(h.placeDepot(...site!)).toBe(true);
    expect(h.tuning.obstacles).toMatchObject({ frost: 4, girders: 2 });
    expect(h.tuning.moves).toBe(TUNING.moves);
    h.market.advance(180000);
    expect(h.buyBlackFor(1, "redTape")).toBe(true);
    expect(h.tuning.moves).toBe(TUNING.moves); // no mid-session budget changes
    h.tuningFinish(true);
    // A fresh Depot uses the other sabotage now, not stale Frost.
    let next: [number, number] | undefined;
    for (const ind of h.grid.industries) {
      for (let x = ind.tx; x < ind.tx + ind.w; x++) {
        const y = ind.ty + ind.h;
        if (h.placementPlan("depot", x, y).valid) { next = [x, y]; break; }
      }
      if (next) break;
    }
    expect(next).toBeDefined();
    expect(h.placeDepot(...next!)).toBe(true);
    expect(h.tuning.moves).toBe(TUNING.moves - 2);
    expect(h.tuning.obstacles).toMatchObject({ frost: 0, girders: 0 });
  });
  it("refuses unaffordable cards and lets Security block a paid attempt", async () => {
    const h = await boot();
    h.purses[1].gold = 0;
    expect(h.buyBlackFor(1, "frost")).toBe(false);
    expect(h.blackMarketStates[0].frostUntil).toBe(0);
    h.purses[1].gold = 100;
    expect(h.buyBlackFor(0, "security")).toBe(true);
    expect(h.buyBlackFor(1, "frost")).toBe(true);
    expect(h.purses[1].gold).toBe(100 - SABOTAGE.frost.gold);
    expect(h.blackMarketStates[0].frostUntil).toBe(0);
    expect(h.blackMarketStates[1].readyAt).toBe(180000);
  });
  it("player-bought sabotage lowers the rival's real simulated Depot result, and expiry restores it", async () => {
    const h = await boot();
    const ind = h.grid.industries[0];
    const depot: import("../../src/iso/economy").Harvester = {
      id: 9876, owner: "ai", ownerId: 2, tx: ind.tx, ty: ind.ty + ind.h, level: 3,
    };
    h.eco.harvesters.push(depot);
    h.rivalTuning();
    const clean = depot.yield!;
    for (const key of ["frost", "redTape"]) {
      expect(h.buyBlackFor(0, key)).toBe(true);
      delete depot.yield;
      h.rivalTuning();
      expect(depot.yield).toBeLessThan(clean);
      h.market.advance(180000);
      delete depot.yield;
      h.rivalTuning();
      expect(depot.yield).toBe(clean);
    }
  });
  it("the Normal rival alternates the new cards; Easy never raids", async () => {
    const h = await boot();
    h.setRivalSkill("easy");
    h.rivalRaidNow();
    expect(h.blackMarketStates[0].frostUntil).toBe(0);
    h.setRivalSkill("normal");
    h.rivalRaidNow();
    expect(h.blackMarketStates[0].frostUntil).toBe(120000);
    h.market.advance(180000);
    h.rivalRaidNow();
    expect(h.blackMarketStates[0].redTapeUntil).toBe(240000);
  });
  it("reloads only the remaining duration and cooldown, never the old clock origin", async () => {
    const h = await boot();
    h.market.advance(900000);
    h.buyBlackFor(1, "frost");
    h.market.advance(30000);
    h.saveNow();
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY)!);
    expect(saved.players[0].blackMarket.frostUntil).toBe(90000);
    expect(saved.players[1].blackMarket.readyAt).toBe(150000);
    dispose?.();
    const restored = await boot();
    expect(restored.blackMarketStates[0].frostUntil - restored.market.ms).toBe(90000);
    expect(restored.buyBlackFor(1, "redTape")).toBe(false);
    restored.market.advance(90000);
    expect(restored.buyTownUpgrade()).toBe(true);
    expect(restored.tuning.obstacles).toMatchObject({ frost: 0, girders: 0 });
    restored.tuningFinish(true);
    restored.market.advance(60000);
    expect(restored.buyBlackFor(1, "redTape")).toBe(true);
  });
});
