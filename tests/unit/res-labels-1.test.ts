// @vitest-environment jsdom
//
// RES-LABELS-1 — resource sites wear NO permanent name chip. The dark
// "QUARRY" tag that duplicated the hover readout is gone; a site's name may
// appear at most once, and only while the site is hovered or its card is
// open. Town names and the plant / depot tags stay exactly as they were.
//
// Same harness as iso-input-qol.test.ts: the real startIsoGame, a stubbed 2D
// context and image loader, the pinned seed 1337.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { southLotFree } from "./helpers/depot-lot";
import { WATER } from "../../src/iso/grid";
import { buildTile } from "../../src/iso/track";
import { MAP_W, MAP_H, INDUSTRY_BY_KEY } from "../../src/iso/config";
import { setRng, mulberry32 } from "../../src/game/config";

// ── stub the art imports (vite handles these in the browser) ──────────────
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

/** A no-op 2D context good enough for the renderer's call pattern. */
function stubCanvas() {
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
  phase: string;
  tool: string;
  grid: import("../../src/iso/grid").Grid;
  track: import("../../src/iso/track").Track;
  eco: import("../../src/iso/economy").EconomyState;
  purse: Record<string, number>;
  setTool: (t: string) => void;
  placeDepot: (x: number, y: number) => boolean;
  finishSetup: () => void;
  refreshQuarry: (now?: number) => unknown;
  tileScreenAt: (tx: number, ty: number) => [number, number];
  labels: { count: () => number; texts: () => string[]; enabled: boolean };
}

const hook = () => (window as unknown as { __iso: IsoHook }).__iso;

const settle = async (ms = 12) => {
  for (let i = 0; i < ms; i++) await new Promise((r) => setTimeout(r, 0));
};

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas();
  stubImage();
  // The NEW loop: a Select click on a site opens its card ("selected").
  window.history.replaceState(null, "", "/?seed=1337&loop=new");
  localStorage.removeItem("hexmatch:save");
  localStorage.removeItem("hexmatch:names");
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
  expect(h.placeDepot(hx, hy - 1), "the fixture Depot must be legal on the corridor").toBe(true);
  h.refreshQuarry();
  h.finishSetup();
  await settle();
  return h;
}

/** The live industry name chips on the map, in DOM order. */
const industryChips = (root: HTMLElement): string[] =>
  [...root.querySelectorAll("#map .iso-label.label-industry span")]
    .map((el) => (el.textContent ?? "").trim());

/** Move the pointer (CSS px) over the overlay canvas — the live hover path. */
function moveTo(root: HTMLElement, sx: number, sy: number) {
  const canvas = root.querySelectorAll("canvas.iso-layer")[2] as HTMLCanvasElement;
  canvas.dispatchEvent(new PointerEvent("pointermove", {
    clientX: sx, clientY: sy, pointerId: 1, isPrimary: true, bubbles: true,
  }));
}

/** A click (down + up) at CSS px on the overlay canvas. */
function clickAt(root: HTMLElement, sx: number, sy: number) {
  const canvas = root.querySelectorAll("canvas.iso-layer")[2] as HTMLCanvasElement;
  for (const type of ["pointerdown", "pointerup"] as const) {
    canvas.dispatchEvent(new PointerEvent(type, {
      clientX: sx, clientY: sy, pointerId: 1, isPrimary: true, button: 0, bubbles: true,
    }));
  }
}

describe("RES-LABELS-1: no permanent name chip on resource sites", () => {
  it("pins the rule for every resource-site kind on the map", async () => {
    const h = await connectedBoot();

    // Every resource-site kind on this seed wears NO permanent chip: quarry,
    // farm, forest, both mines, oil — the whole vocabulary of the map.
    const kindsOnMap = new Map(h.grid.industries.map((ind) => [ind.type, ind]));
    expect([...kindsOnMap.keys()].sort()).toEqual(
      expect.arrayContaining(["quarry", "farm", "forest", "ore_mine", "oil_rig", "gold_mine"]),
    );
    for (const [type, ind] of kindsOnMap) {
      const name = INDUSTRY_BY_KEY[type]?.name ?? type;
      expect(industryChips(root), `no permanent chip on a ${name}`).toEqual([]);
      expect(h.labels.texts()).not.toContain(name);
    }

    // Town names and the plant / depot tags are exactly as they were.
    for (const t of h.grid.towns) expect(h.labels.texts()).toContain(t.name ?? "Town");
    expect(h.labels.texts()).toContain("Your Plant");
    expect(h.labels.texts()).toContain("Your Depot");
  });

  it("hovering a site shows its name once; leaving removes it", async () => {
    const h = await connectedBoot();
    const quarry = h.grid.industries.find((i) => i.type === "quarry")!;
    const [sx, sy] = h.tileScreenAt(quarry.tx + quarry.w / 2, quarry.ty + quarry.h / 2);

    moveTo(root, sx, sy);
    await settle();
    expect(industryChips(root), "the hovered site wears exactly one chip")
      .toEqual([INDUSTRY_BY_KEY[quarry.type]?.name]);

    // Drift onto open ground: the chip retires with the pointer.
    const open = (() => {
      for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
        const i = y * MAP_W + x;
        if (h.grid.terrain[i] !== WATER && h.grid.occupancy[i] < 0) return [x, y] as const;
      }
      return null;
    })();
    expect(open).toBeTruthy();
    const [ox, oy] = h.tileScreenAt(open![0] + 0.5, open![1] + 0.5);
    moveTo(root, ox, oy);
    await settle();
    expect(industryChips(root)).toEqual([]);
  });

  it("a selected site (its card open) keeps its one chip off-hover", async () => {
    const h = await connectedBoot();
    h.setTool("select");
    const quarry = h.grid.industries.find((i) => i.type === "quarry")!;
    const [sx, sy] = h.tileScreenAt(quarry.tx + quarry.w / 2, quarry.ty + quarry.h / 2);

    // A Select click opens the site's card — the site is now "selected".
    clickAt(root, sx, sy);
    await settle();
    expect(industryChips(root)).toEqual([INDUSTRY_BY_KEY[quarry.type]?.name]);

    // Pointer leaves for open ground: the selected site keeps its one chip.
    const open = (() => {
      for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
        const i = y * MAP_W + x;
        if (h.grid.terrain[i] !== WATER && h.grid.occupancy[i] < 0) return [x, y] as const;
      }
      return null;
    })();
    expect(open).toBeTruthy();
    const [ox, oy] = h.tileScreenAt(open![0] + 0.5, open![1] + 0.5);
    moveTo(root, ox, oy);
    await settle();
    expect(industryChips(root)).toEqual([INDUSTRY_BY_KEY[quarry.type]?.name]);
  });
});
