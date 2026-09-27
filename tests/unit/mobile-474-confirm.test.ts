// @vitest-environment jsdom
//
// MOB-1 (#474) acceptance: "Confirm-to-place works; pan never builds (test)."
//
// On a phone (the ui's data-phone regime, a TOUCH pointer) a tap with a
// structure tool stages the build behind the paper confirm sheet instead of
// placing it; Place builds it, Cancel builds nothing, and a one-finger pan
// neither stages nor builds. A desktop mouse click still builds at once.
//
// Same harness as iso-input-qol.test.ts: the real startIsoGame, a stubbed 2D
// context and image loader, the pinned seed 1337.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { southLotFree } from "./helpers/depot-lot";
import { WATER } from "../../src/iso/grid";
import { buildTile } from "../../src/iso/track";
import { MAP_W, MAP_H } from "../../src/iso/config";
import { setRng, mulberry32 } from "../../src/game/config";

// ── stub the art imports (vite handles these in the browser) ──────────────
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

/**
 * A no-op 2D context good enough for the renderer's call pattern. The
 * placement overlay paints vector gradients (overlay-art.ts), so the
 * gradient factories must hand back a stop-collector, not `undefined`.
 */
function stubCanvas() {
  // Gradients collect stops; the seamless ground PATTERNS are transformed
  // per frame (the drifting ocean), so the stub doubles for both.
  const gradient = { addColorStop: () => undefined, setTransform: () => undefined };
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "canvas") return null;
      if (prop === "imageSmoothingEnabled") return false;
      if (prop === "createLinearGradient" || prop === "createRadialGradient"
          || prop === "createConicGradient" || prop === "createPattern") {
        return () => gradient;
      }
      if (prop === "measureText") return () => ({ width: 0 });
      if (prop === "getImageData") {
        return (_x: number, _y: number, w: number, h: number) =>
          ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4).fill(255), width: w, height: h });
      }
      return () => undefined;
    },
    set: () => true,
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
}

/** Images resolve immediately so the async boot completes. */
function stubImage() {
  class FakeImage {
    width = 1024; height = 1024;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) { queueMicrotask(() => this.onload?.()); }
  }
  (globalThis as Record<string, unknown>).Image = FakeImage;
}

interface IsoHook {
  grid: import("../../src/iso/grid").Grid;
  track: import("../../src/iso/track").Track;
  eco: import("../../src/iso/economy").EconomyState;
  purse: Record<string, number>;
  money: number;
  harvesters: { id: number; owner: string; tx: number; ty: number }[];
  setTool: (t: string) => void;
  placeDepot: (x: number, y: number) => boolean;
  finishSetup: () => void;
  refreshQuarry: (now?: number) => unknown;
  tileScreenAt: (tx: number, ty: number) => [number, number];
  tileProbe: (kind: "dirt" | "road", tx: number, ty: number) => {
    harvester: { ok: boolean; affordable: boolean };
  };
}


const hook = () => (window as unknown as { __iso: IsoHook }).__iso;

/** Wait for the async atlas load + a few frames. */
const settle = async (ms = 12) => {
  for (let i = 0; i < ms; i++) await new Promise((r) => setTimeout(r, 0));
};

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas();
  stubImage();
  window.history.replaceState(null, "", "/?seed=1337&loop=old");
  localStorage.removeItem("hexmatch:save");
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
  dispose = startIsoGame(root);
  await settle();
  return hook();
}

/** A corridor from a resource node down to a legal factory row (seed 1337). */
function findSouthCorridor(
  grid: import("../../src/iso/grid").Grid, len = 6,
): { hx: number; hy: number; fy: number } | null {
  for (const ind of grid.industries) {
    for (let x = ind.tx; x < ind.tx + ind.w; x++) {
      const hx = x, hy = ind.ty + ind.h + 1;
      const fy = hy + len;
      if (hy < 0 || fy >= MAP_H || hx < 0 || hx >= MAP_W) continue;
      let ok = true;
      for (let y = hy; y <= fy; y++) {
        const i = y * MAP_W + hx;
        if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) { ok = false; break; }
      }
      if (ok && southLotFree(grid, hx, hy)) return { hx, hy, fy };
    }
  }
  return null;
}

/** Boot, then stand a factory + depot joined by dirt — the post-setup world. */
async function connectedBoot() {
  const h = await boot();
  const c = findSouthCorridor(h.grid);
  expect(c).toBeTruthy();
  const { hx, hy, fy } = c!;
  h.eco.factories.push({ owner: "you", ownerId: 1, tx: hx, ty: fy });
  for (let y = hy + 1; y <= fy; y++) buildTile(h.track, "dirt", hx, y, 1);
  // The Depot lands through the REAL placement path (the setup click's twin)
  // so the world sync — draw list, name tags, lorry replan — runs over the
  // fixture, exactly as the live game does it.
  expect(h.placeDepot(hx, hy - 1), "the fixture Depot must be legal on the corridor").toBe(true);
  h.refreshQuarry();
  h.finishSetup();
  await settle();
  return { h, corridor: { hx, hy, fy } };
}

const overlay = () => root.querySelectorAll("canvas.iso-layer")[2] as HTMLCanvasElement;
const sheet = () => root.querySelector(".confirm-sheet") as HTMLElement;
const sheetOpen = () => !!sheet() && !sheet().classList.contains("hidden") && sheet().classList.contains("open");

/** One pointer event at device-px (sx, sy). */
function pointer(type: string, sx: number, sy: number, pointerType: string) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  overlay().dispatchEvent(new PointerEvent(type, {
    clientX: sx / dpr, clientY: sy / dpr,
    pointerType, pointerId: 1, isPrimary: true, button: 0, bubbles: true,
  }));
}

/** A funded post-setup world, the phone regime on, and a legal paid Depot site. */
async function phoneWithSite() {
  const { h } = await connectedBoot();
  root.querySelector<HTMLElement>(".ui-root")!.dataset.phone = "1";
  for (const c of ["wood", "stone", "ore", "oil", "grain"]) h.purse[c] = 99;
  h.money = 99999;
  let spot: [number, number] | null = null;
  outer: for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const why = h.tileProbe("dirt", x, y);
      if (why.harvester.ok && why.harvester.affordable) { spot = [x, y]; break outer; }
    }
  }
  expect(spot, "a legal, affordable Depot site on seed 1337").not.toBeNull();
  h.setTool("harvester");
  return { h, spot: spot! };
}

describe("MOB-1 (#474) confirm-to-place on a phone", () => {
  it("a tap stages the Depot behind the sheet, and Place builds it", async () => {
    const { h, spot } = await phoneWithSite();
    const before = h.harvesters.length;
    const [sx, sy] = h.tileScreenAt(spot[0], spot[1]);
    pointer("pointerdown", sx, sy, "touch");
    pointer("pointerup", sx, sy, "touch");
    await settle();
    expect(h.harvesters.length, "the tap alone builds nothing").toBe(before);
    expect(sheetOpen(), "the confirm sheet is up").toBe(true);
    expect(sheet().textContent).toMatch(/Depot/);
    (sheet().querySelector(".confirm-sheet__confirm") as HTMLButtonElement).click();
    await settle();
    expect(h.harvesters.length, "Place builds the staged Depot").toBe(before + 1);
    expect(sheetOpen()).toBe(false);
  });

  it("Cancel builds nothing and takes the sheet down", async () => {
    const { h, spot } = await phoneWithSite();
    const before = h.harvesters.length;
    const [sx, sy] = h.tileScreenAt(spot[0], spot[1]);
    pointer("pointerdown", sx, sy, "touch");
    pointer("pointerup", sx, sy, "touch");
    await settle();
    (sheet().querySelector(".confirm-sheet__cancel") as HTMLButtonElement).click();
    await settle();
    expect(h.harvesters.length).toBe(before);
    expect(sheetOpen()).toBe(false);
  });

  it("a one-finger pan never stages and never builds", async () => {
    const { h, spot } = await phoneWithSite();
    const before = h.harvesters.length;
    const [sx, sy] = h.tileScreenAt(spot[0], spot[1]);
    pointer("pointerdown", sx, sy, "touch");
    pointer("pointermove", sx + 60, sy + 40, "touch");
    pointer("pointermove", sx + 120, sy + 80, "touch");
    pointer("pointerup", sx + 120, sy + 80, "touch");
    await settle();
    expect(sheetOpen(), "a pan opens no sheet").toBe(false);
    expect(h.harvesters.length, "a pan builds nothing").toBe(before);
  });

  it("a desktop mouse click still builds at once (no sheet)", async () => {
    const { h, spot } = await phoneWithSite();
    root.querySelector<HTMLElement>(".ui-root")!.dataset.phone = "0";
    const before = h.harvesters.length;
    const [sx, sy] = h.tileScreenAt(spot[0], spot[1]);
    pointer("pointerdown", sx, sy, "mouse");
    pointer("pointerup", sx, sy, "mouse");
    await settle();
    expect(sheetOpen()).toBe(false);
    expect(h.harvesters.length).toBe(before + 1);
  });
});
