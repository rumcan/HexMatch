// @vitest-environment jsdom
/**
 * MATCH-2 (#566) — the star moment, in the live game.
 *
 * Acceptance, as this file checks it:
 *   • crossing ★★★★ mid-session stamps OVERDRIVE over the board and leaves
 *     the board's clock alone;
 *   • crossing ★★★★★ is the Legendary finale: the banner, the push-in class,
 *     and the board's clock at a quarter speed (every wait divided by it);
 *   • the session's results WAIT for a Legendary finale to land — Finish
 *     pressed during it is remembered and lands with it;
 *   • reduced motion keeps the banner and drops the slow-mo.
 *
 * The finale's own curves are pure and pinned in match3-finale.test.ts; this
 * is the wiring (src/iso/game.ts + ui.boardFinale). Harness as iso-300.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { southLotFree } from "./helpers/depot-lot";
import { WATER, type Grid, type Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { setRng, mulberry32 } from "../../src/game/config";
import { SAVE_KEY } from "../../src/iso/savegame-runtime";
import { FINALE } from "../../src/match3/finale";
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

interface FinaleHook {
  grid: Grid;
  board: Board;
  finishSetup: () => void;
  placeDepot: (tx: number, ty: number) => boolean;
  readonly tuning: { kind: "depot" | "town"; score: number; movesLeft: number } | null;
  readonly tuningResult: UiTuningResult | null;
  readonly tuningEndAsked: boolean;
  tuningEnd: () => void;
}

const hook = () => (window as unknown as { __iso: FinaleHook }).__iso;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { for (let i = 0; i < 12; i++) await sleep(0); };
const until = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await sleep(10);
  return cond();
};

let root: HTMLDivElement;
let dispose: (() => void) | undefined;
const wrap = () => root.querySelector("#iso-quarry .board-slot .board-wrap") as HTMLElement;
const banner = (stars: 4 | 5) => root.querySelector(`.m3-finale-banner-${stars}`) as HTMLElement | null;

beforeEach(() => {
  stubCanvas();
  stubImage();
  window.history.replaceState(null, "", "/?seed=1337&loop=old");
  localStorage.removeItem(SAVE_KEY);
  localStorage.setItem("hexmatch:rival-skill", "normal");
  localStorage.setItem("hexmatch:tutorial", "never");
  localStorage.setItem("hexmatch:tuning:skipTarget", "1");
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
  localStorage.removeItem("hexmatch:tuning:skipTarget");
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  vi.restoreAllMocks();
});

interface Site { hx: number; hy: number; ind: Industry }
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
      if (ok && southLotFree(grid, hx, hy)) return { hx, hy, ind };
    }
  }
  return null;
}

/** Boot, leave setup, put a Depot down — its session opens. */
async function depotSession(): Promise<FinaleHook> {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, { newLoop: true });
  await settle();
  const h = hook();
  h.finishSetup();
  const site = depotSite(h.grid);
  expect(site, "a Depot site on seed 1337").toBeTruthy();
  expect(h.placeDepot(site!.hx, site!.hy - 1)).toBe(true);
  await settle();
  expect(h.tuning?.kind, "the Depot's session is live").toBe("depot");
  return h;
}

describe("MATCH-2 the star moment", () => {
  it("stamps OVERDRIVE at ★★★★ on a normal clock, then the Legendary finale at ★★★★★ on a quarter-speed one", async () => {
    const h = await depotSession();
    expect(h.board.timeScale()).toBe(1);

    h.board.onClear(2160, 1);                 // the pass that crosses ★★★★
    expect(h.tuning!.score).toBeGreaterThanOrEqual(2160);
    expect(banner(4), "the OVERDRIVE banner").toBeTruthy();
    expect(banner(4)!.textContent).toContain("Overdrive");
    expect(wrap().classList.contains("m3-finale-4")).toBe(true);
    expect(h.board.timeScale(), "4★ never slows the board").toBe(1);

    h.board.onClear(300, 1);                 // …and the one that crosses ★★★★★
    expect(banner(5), "the LEGENDARY banner").toBeTruthy();
    expect(banner(5)!.textContent).toContain("Legendary");
    expect(banner(5)!.querySelectorAll(".m3-finale-stars span").length).toBe(5);
    expect(wrap().classList.contains("m3-finale-5"), "the board pushes in").toBe(true);
    expect(h.board.timeScale(), "the cascades still in the air play at a quarter speed").toBeCloseTo(FINALE.timeScale, 2);
  });

  it("holds the results until a Legendary finale has landed — Finish during it lands with it", async () => {
    const h = await depotSession();
    h.board.onClear(2500, 1);
    expect(h.board.busy).toBe(false);
    const t0 = Date.now();
    h.tuningEnd();                           // Finish, mid-finale
    expect(h.tuningResult, "no card over the finale").toBeNull();
    expect(h.tuningEndAsked, "the Finish is remembered").toBe(true);
    expect(await until(() => h.tuningResult !== null, FINALE.durationMs + 3000), "the card comes once it lands").toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(FINALE.durationMs - 400);
    expect(h.tuningResult!.stars).toBe(5);
    expect(h.board.timeScale(), "the clock is back to full speed").toBe(1);
  }, 15_000);

  it("keeps the banner and drops the slow-mo under reduced motion", async () => {
    (window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia =
      (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }) as never;
    const h = await depotSession();
    h.board.onClear(2500, 1);
    expect(banner(5), "the rating still lands").toBeTruthy();
    expect(h.board.timeScale(), "no slow-mo").toBe(1);
  });
});
