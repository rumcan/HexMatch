// @vitest-environment jsdom
/**
 * #300 — the RESULTS pop-up a tuning session ends on: animated score, the
 * yield it sets, and a 1–3 star rating.
 *
 * Acceptance, as this file checks it:
 *   • using the last move opens the pop-up — and only once the board has
 *     settled (never while the cascade is still falling);
 *   • the score and the yield count up to the result, and the star count is
 *     the thresholds table's (`TUNING_STARS` via `tuningStarsFor`);
 *   • Confirm applies EXACTLY the yield the card shows — and nothing lands
 *     before it;
 *   • Finish with moves to spare opens the same pop-up ("Session complete"),
 *     Abandon never shows it, and a platform at an industry and a city
 *     session get it too.
 *
 * The pure half (the table, the bars, the outcome maths) is in
 * iso-300-tuning-stars.test.ts. Harness as iso-301-finish / iso-l4-tuning.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { southLotFree } from "./helpers/depot-lot";
import { WATER, GRASS, ROUGH, SAND, type Grid, type Industry } from "../../src/iso/grid";
import { TOWN_UPGRADES, TUNING, type Cargo } from "../../src/iso/config";
import { MAP_W, MAP_H } from "../../src/game/config";
import { tIdx, type Track } from "../../src/iso/track";
import { setRng, mulberry32 } from "../../src/game/config";
import { SAVE_KEY } from "../../src/iso/savegame-runtime";
import { townBonusFor, tuningStarsFor } from "../../src/iso/tuning";
import type { EconomyState } from "../../src/iso/economy";
import type { Board } from "../../src/game/board";
import type { UiTuningResult } from "../../src/game/ui";

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

interface ResultHook {
  readonly newLoop: boolean;
  grid: Grid;
  track: Track;
  eco: EconomyState;
  board: Board;
  purse: Record<string, number>;
  finishSetup: () => void;
  placeDepot: (tx: number, ty: number) => boolean;
  placePlatform: (tx: number, ty: number, view?: string) => boolean;
  buyTownUpgrade: () => boolean;
  treeState: () => { townLevel: number; townBonus: number };
  swap: (r1: number, c1: number, r2: number, c2: number) => void;
  readonly depotYields: { id: number; owner: string; tx: number; ty: number; yield: number | null }[];
  readonly tuning: {
    kind: "depot" | "town"; depotId: number; cargo: Cargo | null; moves: number; movesLeft: number;
    used: number; score: number; yield: number; abandonYield: number;
  } | null;
  readonly tuningResult: UiTuningResult | null;
  readonly tuningEndAsked: boolean;
  tuningFinish: (abandon?: boolean) => void;
  tuningEnd: () => void;
  tuningConfirm: () => void;
}

const hook = () => (window as unknown as { __iso: ResultHook }).__iso;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { for (let i = 0; i < 12; i++) await sleep(0); };
const boardIdle = async (h: ResultHook) => {
  for (let i = 0; i < 80 && h.board.busy; i++) await sleep(30);
  expect(h.board.busy, "the board settled").toBe(false);
};
/** Poll the live game (its frames run on setTimeout here) until `cond` holds. */
const until = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await sleep(10);
  return cond();
};

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

const panel = () => root.querySelector("#iso-tuning-results") as HTMLElement;
const shown = () => !!panel() && !panel().classList.contains("hidden");
const text = (sel: string) => panel().querySelector(sel)!.textContent ?? "";
const windowUp = () => !(root.querySelector("#iso-session") as HTMLElement).classList.contains("hidden");
const quarry = () => root.querySelector("#iso-quarry") as HTMLElement;
const boardWrap = () => root.querySelector("#iso-quarry .board-slot .board-wrap") as HTMLElement;
const confirmKey = () => panel().querySelector(".sr-confirm") as HTMLButtonElement;
/** The plate's yield format (`fmtYield` in ui.ts): ×2.0, ×1.75. */
const fmtYield = (y: number) => y.toFixed(2).replace(/0$/, "");

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

async function boot() {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, { newLoop: true });
  await settle();
  return hook();
}

interface Site { hx: number; hy: number; fy: number; ind: Industry }

function depotSite(grid: Grid): Site | null {
  for (const ind of grid.industries) {
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

/** Boot, leave setup, and put a Depot down — its session opens. */
async function depotSession(): Promise<ResultHook> {
  const h = await boot();
  h.finishSetup();
  const site = depotSite(h.grid);
  expect(site, "a Depot site on seed 1337").toBeTruthy();
  expect(h.placeDepot(site!.hx, site!.hy - 1)).toBe(true);
  await settle();
  // #461: target card may be up — start it.
  const tc = document.querySelector("#iso-target-card") as HTMLElement | null;
  if (tc && !tc.classList.contains("hidden")) {
    (tc.querySelector(".tc-start") as HTMLButtonElement)?.click();
    await settle();
  }
  expect(h.tuning?.kind, "the Depot's session is live").toBe("depot");
  return h;
}

/** Play the board's first real move and let it land — a session with a score. */
async function scoreOnce(h: ResultHook): Promise<void> {
  const mv = h.board.findMove();
  expect(mv, "the session board has a move").toBeTruthy();
  h.swap(...mv!);
  await boardIdle(h);
  expect(h.tuning!.score, "the move scored").toBeGreaterThan(0);
}

const groupsOf = (board: Board): unknown[] =>
  (board as unknown as { findGroups(): unknown[] }).findGroups();

/** A swap that matches nothing: it costs a move and scores nothing. */
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

/**
 * Put a platform down beside an industry — the rail's Depot, which opens the
 * same tuning session a road Depot does. Returns once one has opened.
 */
function industryPlatform(h: ResultHook): boolean {
  for (const ind of h.grid.industries) {
    for (let dy = -4; dy <= ind.h + 3; dy++) {
      for (let dx = -4; dx <= ind.w + 3; dx++) {
        for (const view of ["se", "ne", "sw", "nw"]) {
          const tx = ind.tx + dx, ty = ind.ty + dy;
          if (tx < 1 || ty < 1 || tx + 3 >= MAP_W || ty + 3 >= MAP_H) continue;
          const [w, hh] = view === "se" || view === "nw" ? [3, 2] : [2, 3];
          let clear = true;
          for (let y = 0; y < hh && clear; y++) {
            for (let x = 0; x < w && clear; x++) {
              const at = tIdx(tx + x, ty + y);
              const t = h.grid.terrain[at];
              if (t !== GRASS && t !== SAND && t !== ROUGH) clear = false;
              if (h.grid.occupancy[at] >= 0) clear = false;
              if (h.track.dirt[at] || h.track.road[at]) clear = false;
            }
          }
          if (!clear) continue;
          if (h.placePlatform(tx, ty, view) && h.tuning) {
            // #461: target card may be up — start it so tuning is live.
            const tc = document.querySelector("#iso-target-card") as HTMLElement | null;
            if (tc && !tc.classList.contains("hidden")) {
              (tc.querySelector(".tc-start") as HTMLButtonElement)?.click();
            }
            return true;
          }
        }
      }
    }
  }
  return false;
}

describe("#300 the results pop-up a tuning session ends on", () => {
  it("opens on the last move once the board settles, counts up, and Confirm applies exactly the yield shown", async () => {
    const h = await depotSession();
    const depotId = h.tuning!.depotId;
    const yieldOf = () => h.depotYields.find((d) => d.id === depotId)!.yield;
    const before = yieldOf();
    await scoreOnce(h);

    // Down to the last move with swaps that score nothing — no pop-up while
    // there are moves left.
    while (h.tuning!.movesLeft > 1) {
      const d = dudSwap(h.board);
      expect(d, "the board offers a non-matching swap").toBeTruthy();
      h.swap(...d!);
      await boardIdle(h);
      expect(h.tuningResult, "no pop-up while moves remain").toBeNull();
      expect(shown()).toBe(false);
    }

    // The LAST move: the board animates it — and the pop-up waits for that.
    const last = dudSwap(h.board)!;
    h.swap(...last);
    expect(h.tuning!.movesLeft).toBe(0);
    expect(h.board.busy, "the last move is still animating").toBe(true);
    let sampled = 0;
    while (h.board.busy) {
      expect(h.tuningResult, "never while the board is still moving").toBeNull();
      sampled++;
      await sleep(5);
    }
    expect(sampled).toBeGreaterThan(0);

    // Settled: the session ENDS into the pop-up — over the window, which stays.
    expect(await until(() => h.tuningResult !== null && shown()), "the pop-up opened").toBe(true);
    const r = h.tuningResult!;
    expect(r.reason).toBe("out-of-moves");
    expect(r.kind).toBe("depot");
    expect(r.score).toBe(h.tuning!.score);
    expect(r.stars, "the star count is the thresholds table's").toBe(tuningStarsFor(r.score));
    expect(r.from).toBe(before);
    expect(h.tuning, "the session is still the one session under the card").not.toBeNull();
    expect(windowUp(), "the session window stays up under the card").toBe(true);
    expect(quarry().inert, "the plate and the final board are out of reach").toBe(true);
    expect(text(".sr-head")).toBe("Out of moves");
    expect(text(".sr-moves")).toContain(`All ${TUNING.moves} moves`);
    // The final numbers ride on the card from frame one.
    expect(panel().dataset.score).toBe(String(r.score));
    expect(panel().dataset.yield).toBe(String(r.to));
    expect(panel().dataset.stars).toBe(String(r.stars));
    expect(document.activeElement, "Confirm takes the focus").toBe(confirmKey());

    // The count-up: the score climbs to the result, then the yield does.
    const scores: number[] = [];
    const yields: string[] = [];
    for (let i = 0; i < 400 && !panel().classList.contains("done"); i++) {
      scores.push(Number(text(".sr-score")));
      yields.push(text(".sr-yield"));
      await sleep(10);
    }
    expect(panel().classList.contains("done"), "the count-up finished").toBe(true);
    expect(scores[0], "the score starts below the result and counts up").toBeLessThan(r.score);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    expect(yields[0], "the yield starts where the Depot was").toBe(`×${fmtYield(r.from)}`);
    expect(text(".sr-score")).toBe(String(r.score));
    expect(text(".sr-yield"), "…and lands on exactly the yield Confirm applies").toBe(`×${fmtYield(r.to)}`);
    expect(panel().querySelectorAll(".sr-star.lit").length).toBe(r.stars);

    // Nothing has landed yet, and the ended board takes no more moves.
    expect(yieldOf(), "no yield before Confirm").toBe(before);
    const used = h.tuning!.used;
    h.swap(...(h.board.findMove() ?? [0, 0, 0, 1]));
    await settle();
    expect(h.tuning!.used, "an ended session takes no swap").toBe(used);
    expect(h.tuningResult!.score).toBe(r.score);

    // Confirm: exactly the shown yield and Gold land, and it is back to the map.
    const gold = h.purse.gold ?? 0;
    confirmKey().click();
    await settle();
    expect(h.tuning).toBeNull();
    expect(h.tuningResult).toBeNull();
    expect(yieldOf(), "Confirm applied exactly the yield shown").toBe(r.to);
    expect(h.purse.gold ?? 0).toBe(gold + r.gold);
    expect(shown()).toBe(false);
    expect(windowUp(), "back on the map").toBe(false);
    expect(quarry().inert).toBe(false);
    expect(boardWrap().classList.contains("hidden"), "the board is down").toBe(true);
  });

  it("Finish with moves to spare opens the same pop-up, as Session complete", async () => {
    const h = await depotSession();
    const depotId = h.tuning!.depotId;
    const yieldOf = () => h.depotYields.find((d) => d.id === depotId)!.yield;
    const before = yieldOf();
    await scoreOnce(h);

    // #301: Finish is disabled only while the board animates — the HUD's next
    // paint re-enables it once the move has landed.
    const finish = root.querySelector(".tp-finish") as HTMLButtonElement;
    expect(await until(() => !finish.disabled), "Finish is live on a settled board").toBe(true);
    finish.click();
    expect(await until(() => h.tuningResult !== null && shown()), "Finish opened the pop-up").toBe(true);
    const r = h.tuningResult!;
    expect(r.reason).toBe("finished");
    expect(r.movesLeft).toBe(TUNING.moves - 1);
    expect(r.stars).toBe(tuningStarsFor(r.score));
    expect(text(".sr-head")).toBe("Session complete");
    expect(text(".sr-moves")).toContain(`${TUNING.moves - 1} of ${TUNING.moves} moves to spare`);
    expect(text(".sr-kicker")).toMatch(/Depot$/);
    expect(yieldOf(), "Finish alone lands nothing").toBe(before);

    // A press on the card skips the count-up straight to the result.
    (panel().querySelector(".sr-card") as HTMLElement).click();
    expect(panel().classList.contains("done")).toBe(true);
    expect(text(".sr-score")).toBe(String(r.score));
    expect(text(".sr-yield")).toBe(`×${fmtYield(r.to)}`);

    confirmKey().click();
    await settle();
    expect(h.tuning).toBeNull();
    expect(yieldOf()).toBe(r.to);
  });

  it("a Finish that lands mid-cascade waits for the board, so the whole cascade is rated", async () => {
    const h = await depotSession();
    const mv = h.board.findMove()!;
    h.swap(...mv);
    expect(h.board.busy).toBe(true);
    h.tuningEnd();
    expect(h.tuningEndAsked, "the Finish is held for the board").toBe(true);
    expect(h.tuningResult).toBeNull();
    const used = h.tuning!.used;
    h.swap(0, 0, 0, 1);
    expect(h.tuning!.used, "no more moves once Finish is pressed").toBe(used);

    await boardIdle(h);
    expect(await until(() => h.tuningResult !== null), "it ended as the board settled").toBe(true);
    expect(h.tuningEndAsked).toBe(false);
    expect(h.tuningResult!.reason).toBe("finished");
    expect(h.tuningResult!.score, "the cascade's points are in").toBe(h.tuning!.score);
    expect(h.tuningResult!.score).toBeGreaterThan(0);
    h.tuningConfirm();
    await settle();
    expect(h.tuning).toBeNull();
  });

  it("Abandon never shows the pop-up and keeps the default yield", async () => {
    const h = await depotSession();
    const depotId = h.tuning!.depotId;
    await scoreOnce(h);
    const fallback = h.tuning!.abandonYield;
    // The hosted sandbox answers window.confirm with false — the plate's own
    // two-step confirm is what abandons a scored session.
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const abandon = root.querySelector(".tp-abandon") as HTMLButtonElement;
    abandon.click();
    abandon.click();
    await settle();
    expect(h.tuning).toBeNull();
    expect(h.tuningResult, "no results for an abandon").toBeNull();
    expect(shown()).toBe(false);
    expect(windowUp()).toBe(false);
    expect(h.depotYields.find((d) => d.id === depotId)!.yield).toBe(fallback);
  });

  it("a platform at an industry ends into the same pop-up, named for the platform", async () => {
    const h = await boot();
    h.finishSetup();
    for (const c of ["wood", "stone", "ore", "oil", "grain"]) h.purse[c] = 999;
    (h as any).money = 99999;
    expect(industryPlatform(h), "an industry platform on seed 1337").toBe(true);
    const depotId = h.tuning!.depotId;
    expect(h.eco.harvesters.find((x) => x.id === depotId)!.platformId, "the session is the platform's").toBeDefined();

    // Half the climb — a two-star session, under the level-1 cap.
    h.board.onClear(TUNING.targetScore / 2, 1);
    h.tuningEnd();
    expect(await until(() => h.tuningResult !== null && shown())).toBe(true);
    const r = h.tuningResult!;
    expect(r.platform).toBe(true);
    expect(r.stars).toBe(2);
    expect(text(".sr-kicker")).toMatch(/Platform$/);
    confirmKey().click();
    await settle();
    expect(h.tuning).toBeNull();
    expect(h.eco.harvesters.find((x) => x.id === depotId)!.yield).toBe(r.to);
  });

  it("a city session ends into the pop-up as a base rate, and Confirm lands that rate", async () => {
    const h = await boot();
    h.finishSetup();
    await settle();
    const row = TOWN_UPGRADES[0];
    for (const [c, n] of Object.entries(row.cost) as [Cargo, number][]) h.purse[c] = n;
    await settle();
    expect(h.buyTownUpgrade()).toBe(true);
    await settle();
    expect(h.tuning?.kind).toBe("town");

    // A max session: three stars, the row's whole ceiling.
    h.board.onClear(TUNING.targetScore, 1);
    h.tuningEnd();
    expect(await until(() => h.tuningResult !== null && shown())).toBe(true);
    const r = h.tuningResult!;
    expect(r.kind).toBe("town");
    expect(r.stars).toBe(3);
    expect(r.to).toBe(townBonusFor(row.bonus, TUNING.targetScore));
    expect(text(".sr-kicker")).toContain("City");
    expect(text(".sr-row-yield .sr-k")).toBe("Base rate");
    (panel().querySelector(".sr-card") as HTMLElement).click();
    expect(text(".sr-yield")).toBe(`+${Math.round(r.to * 100)}%`);

    confirmKey().click();
    await settle();
    expect(h.tuning).toBeNull();
    expect(h.treeState().townBonus, "Confirm landed exactly the rate shown").toBe(r.to);
  });

  it("an empty session is rated no stars, shows the number unchanged, and a city's is refunded on Confirm", async () => {
    const h = await boot();
    h.finishSetup();
    await settle();
    const row = TOWN_UPGRADES[0];
    for (const [c, n] of Object.entries(row.cost) as [Cargo, number][]) h.purse[c] = n;
    await settle();
    const bonusBefore = h.treeState().townBonus;
    expect(h.buyTownUpgrade()).toBe(true);
    await settle();
    const paid = { ...h.purse };

    h.tuningEnd();                               // Finish with nothing cleared
    expect(await until(() => h.tuningResult !== null && shown())).toBe(true);
    const r = h.tuningResult!;
    expect(r.stars).toBe(0);
    expect(r.refund).toBe(true);
    expect(r.from).toBe(bonusBefore);
    expect(r.to, "nothing changes").toBe(bonusBefore);
    expect(panel().querySelectorAll(".sr-star.lit")).toHaveLength(0);
    expect(text(".sr-verdict")).toMatch(/No stars/);
    expect(text(".sr-note")).toMatch(/refunded/);

    confirmKey().click();
    await settle();
    expect(h.tuning).toBeNull();
    expect(h.treeState().townBonus).toBe(bonusBefore);
    for (const [c, n] of Object.entries(row.cost) as [Cargo, number][]) {
      expect(h.purse[c], `${c} refunded`).toBe((paid[c] ?? 0) + n);
    }
  });
});
