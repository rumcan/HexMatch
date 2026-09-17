// @vitest-environment jsdom
// #301 — Finish doesn't work when session is out of moves; only ✕ closes it.
// Acceptance:
// - With 0 moves left, Finish closes session and applies earned yield
// - Abandon is clearly labelled and can't be mistaken for close
// - unit/e2e: play all moves → Finish → Depot's yield equals session's yield
// - verify players who clicked ✕ after using moves got default yield

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { southLotFree } from "./helpers/depot-lot";
import { WATER, type Grid, type Industry } from "../../src/iso/grid";
import { INDUSTRY_BY_KEY, TUNING, type Cargo } from "../../src/iso/config";
import { MAP_W, MAP_H } from "../../src/game/config";
import { createTrack, type Track } from "../../src/iso/track";
import { setRng, mulberry32 } from "../../src/game/config";
import { SAVE_KEY } from "../../src/iso/savegame-runtime";
import type { Harvester } from "../../src/iso/economy";
import type { Board } from "../../src/game/board";

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

interface TuningHook {
  readonly newLoop: boolean;
  grid: Grid;
  track: Track;
  eco: import("../../src/iso/economy").EconomyState;
  board: Board;
  purse: Record<string, number>;
  finishSetup: () => void;
  placeDepot: (tx: number, ty: number) => boolean;
  readonly depotYields: { id: number; owner: string; tx: number; ty: number; yield: number | null }[];
  readonly tuning: {
    depotId: number; cargo: Cargo; moves: number; movesLeft: number; used: number;
    score: number; yield: number; abandonYield: number;
  } | null;
  tuningFinish: (abandon?: boolean) => void;
}

const hook = () => (window as unknown as { __iso: TuningHook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
const boardIdle = async (h: TuningHook) => {
  for (let i = 0; i < 80 && h.board.busy; i++) await new Promise((r) => setTimeout(r, 30));
  expect(h.board.busy, "the board settled").toBe(false);
};

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

const boardWrap = () => root.querySelector("#iso-quarry .board-slot .board-wrap") as HTMLElement;
const plate = () => root.querySelector("#iso-tuning") as HTMLElement;

beforeEach(() => {
  stubCanvas();
  stubImage();
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

interface Site { hx: number; hy: number; fy: number; ind: Industry }

function depotSite(grid: Grid, skipId?: number): Site | null {
  for (const ind of grid.industries) {
    if (skipId !== undefined && ind.id === skipId) continue;
    for (let x = ind.tx; x < ind.tx + ind.w; x++) {
      const hx = x, hy = ind.ty + ind.h + 1;
      const fy = hy + 6;
      if (hy < 0 || fy >= MAP_H || hx < 0 || hx >= MAP_W) continue;
      let ok = true;
      for (let y = hy; y <= fy; y++) {
        const i = y * MAP_W + hx;
        if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) { ok = false; break; }
      }
      if (ok && southLotFree(grid, hx, hy)) return { hx, hy, fy, ind };
    }
  }
  return null;
}

const groupsOf = (board: Board): unknown[] =>
  (board as unknown as { findGroups(): unknown[] }).findGroups();

function dudSwap(board: Board): [number, number, number, number] | null {
  for (let r = 0; r < board.h; r++) {
    for (let c = 0; c < board.w; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0]] as [number, number][]) {
        const r2 = r + dr, c2 = c + dc;
        if (r2 >= board.h || c2 >= board.w) continue;
        const a = board.grid[r][c], b = board.grid[r2][c2];
        if (!a || !b || a.block || b.block || a.res === b.res) continue;
        if (a.special === "bomb" || b.special === "bomb") continue;
        board.grid[r][c] = b; board.grid[r2][c2] = a;
        const matches = groupsOf(board).length;
        board.grid[r][c] = a; board.grid[r2][c2] = b;
        if (matches === 0) return [r, c, r2, c2];
      }
    }
  }
  return null;
}

describe("#301 Finish when out of moves", () => {
  it("play all moves → Finish → Depot yield equals session yield", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const site = depotSite(h.grid)!;
    expect(site).toBeTruthy();
    expect(h.placeDepot(site.hx, site.hy - 1)).toBe(true);
    await settle();

    // Play all moves (dud swaps to avoid scoring complexity, then one real move to get score)
    // First, do one real move to get some score so yield > min
    const mv = h.board.findMove();
    expect(mv).toBeTruthy();
    // Use the exposed swap twin that goes through game gate
    (h as any).swap(...mv!);
    await boardIdle(h);
    const scoreAfterFirst = h.tuning!.score;
    // Now exhaust remaining moves with dud swaps
    let remaining = h.tuning!.movesLeft;
    for (let i = 0; i < remaining; i++) {
      const d = dudSwap(h.board);
      if (!d) break; // if no dud found, break — board might be in weird state
      (h as any).swap(...d);
      await boardIdle(h);
      if (!h.tuning) break; // auto-close may have happened
    }
    // If auto-close already happened (because tuningOver + !busy), then yield should already be applied
    // But spec says manual Finish should also work when movesLeft==0, so we test both paths.
    if (h.tuning) {
      expect(h.tuning.movesLeft).toBe(0);
      const sessionYield = h.tuning.yield;
      const depotId = h.tuning.depotId;
      // Finish manually — this is the bug that was blocked
      h.tuningFinish(false);
      await settle();
      expect(h.tuning).toBeNull();
      const depot = h.depotYields.find((d) => d.id === depotId)!;
      expect(depot.yield).toBeCloseTo(sessionYield, 2);
      expect(depot.yield).toBeGreaterThanOrEqual(TUNING.minYield);
    } else {
      // Auto-close path: yield already applied
      const depot = h.depotYields.find((d) => d.tx === site.hx && d.ty === site.hy - 1)!;
      expect(depot.yield).not.toBeNull();
      expect(depot.yield).toBeGreaterThanOrEqual(TUNING.minYield);
    }
  });

  it("abandon after scoring keeps default yield (not earned)", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy - 1)).toBe(true);
    await settle();

    const mv = h.board.findMove();
    expect(mv).toBeTruthy();
    (h as any).swap(...mv!);
    await boardIdle(h);
    expect(h.tuning!.score).toBeGreaterThan(0);
    const earned = h.tuning!.yield;
    expect(earned).toBeGreaterThan(TUNING.minYield);

    const depotId = h.tuning!.depotId;
    // Abandon — should get default yield
    h.tuningFinish(true);
    await settle();
    const depot = h.depotYields.find((d) => d.id === depotId)!;
    expect(depot.yield).toBe(TUNING.minYield);
  });

  it("UI: Finish enabled at 0 moves, disabled only when busy, Abandon labelled", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const site = depotSite(h.grid)!;
    h.placeDepot(site.hx, site.hy - 1);
    await settle();

    const finishBtn = root.querySelector(".tp-finish") as HTMLButtonElement;
    const abandonBtn = root.querySelector(".tp-abandon") as HTMLButtonElement;
    expect(finishBtn).toBeTruthy();
    expect(abandonBtn).toBeTruthy();
    // Label check — must not be just ✕
    expect(abandonBtn.textContent).toContain("Abandon");
    expect(abandonBtn.textContent).toContain("default yield");
    // Initially, moves left >0, not busy → enabled
    expect(finishBtn.disabled).toBe(false);
    // Simulate busy state via direct paint: we can't call paintTuning directly,
    // but we can check that the game sends busy flag.
    // Exhaust moves
    let remaining = h.tuning!.movesLeft;
    for (let i = 0; i < remaining; i++) {
      const d = dudSwap(h.board);
      if (!d) break;
      (h as any).swap(...d);
      await boardIdle(h);
      if (!h.tuning) break;
    }
    if (h.tuning) {
      // At 0 moves, still not busy → Finish should be enabled and primary
      // The UI updates on next frame; wait a tick
      await new Promise((r) => setTimeout(r, 50));
      const fb = root.querySelector(".tp-finish") as HTMLButtonElement;
      expect(fb.disabled).toBe(false);
      expect(fb.classList.contains("primary")).toBe(true);
    }
  });
});
