// @vitest-environment jsdom
//
// E11 — boots the REAL game module in a DOM and plays it. This is the test
// that would have caught "it typechecks but the screen is black": it mounts
// startIsoGame, drives the setup phase, lays track, and asserts VP is scored.
//
// Canvas is stubbed rather than using a real 2D context (jsdom has none), so
// this verifies wiring and game logic, not pixels. Pixel correctness is what
// the committed-reference-PNG fixture is for, and that still needs a browser.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WATER } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/iso/config";

// ── stub the art imports (vite handles these in the browser) ──────────────
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

/** A no-op 2D context good enough for the renderer's call pattern. */
function stubCanvas() {
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "canvas") return null;
      if (prop === "imageSmoothingEnabled") return false;
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
  vp: { you: number; ai: number };
  purse: Record<string, number>;
  harvesters: { id: number; owner: string; tx: number; ty: number }[];
  factories: { owner: string; tx: number; ty: number }[];
  freeTrack: number;
  grid: import("../../src/iso/grid").Grid;
  track: import("../../src/iso/track").Track;
  eco: import("../../src/iso/economy").EconomyState;
  setTool: (t: string) => void;
}

const hook = () => (window as unknown as { __iso: IsoHook }).__iso;

/** Wait for the async atlas load + first frame. */
const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas();
  stubImage();
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

describe("E11 the game boots", () => {
  it("mounts three canvas layers and a tool bar", async () => {
    await boot();
    expect(root.querySelectorAll("canvas")).toHaveLength(3);
    const tools = [...root.querySelectorAll("[data-tool]")].map(
      (b) => (b as HTMLElement).dataset.tool);
    expect(tools).toEqual(["road", "rail", "harvester", "demolish"]);
  });

  it("starts in the factory-placement phase with a real map", async () => {
    const h = await boot();
    expect(h.phase).toBe("setup-factory");
    expect(h.grid.industries.length).toBeGreaterThan(0);
    expect(h.factories).toHaveLength(0);
    expect(h.freeTrack).toBe(12);
    expect(h.purse.ore ?? 0).toBe(0);
    expect(h.purse.stone ?? 0).toBeGreaterThan(0);
  });

  it("exposes a banner telling the player what to do", async () => {
    await boot();
    const banner = root.querySelector("#iso-banner") as HTMLElement;
    expect(banner.textContent).toMatch(/place your factory/i);
  });

  it("cleans up after itself", async () => {
    await boot();
    dispose!();
    dispose = undefined;
    expect(root.querySelectorAll("canvas")).toHaveLength(0);
  });
});

// ── driving the game through its own module API ───────────────────────────
// The pointer path is pixel-driven and needs a real renderer to pick tiles, so
// these drive the same state the click handlers mutate, via the test hook.

/**
 * Find an industry whose SOUTH corridor is legal: the harvester tile just
 * below its footprint plus 6 road tiles under it all stay inside the map and
 * off water. The map is 48×48 and generated under a RANDOM seed each boot, so
 * `industries[0]` alone is not safe — when it sits near the bottom edge the
 * factory tile lands at fy ≥ MAP_H and the round can never score (a flaky
 * failure that depends on the seed). Prefer a corridor like the cargo test:
 * no single industry is special, so scanning is not a cheat.
 */
function findSouthCorridor(grid: import("../../src/iso/grid").Grid):
  { hx: number; hy: number; fy: number } | null {
  for (const ind of grid.industries) {
    const hx = ind.tx, hy = ind.ty + ind.h;
    const fy = hy + 6;
    if (hy < 0 || fy >= MAP_H || hx < 0 || hx >= MAP_W) continue;
    let ok = true;
    for (let y = hy; y <= fy; y++) {
      if (grid.terrain[y * MAP_W + hx] === WATER) { ok = false; break; }
    }
    if (ok) return { hx, hy, fy };
  }
  return null;
}

describe("E11 a full round is playable", () => {
  it("setup → connect → score, end to end", async () => {
    const h = await boot();
    const {
      createTrack: _c, buildTile,
    } = await import("../../src/iso/track");
    const { rescore, createScoreState, vpFor, isServiced, industriesInCatchment } =
      await import("../../src/iso/economy");

    // a real industry with a legal harvester spot beside it
    const c = findSouthCorridor(h.grid);
    expect(c).toBeTruthy();
    const { hx, hy, fy } = c!;

    h.eco.factories.push({ owner: "you", tx: hx, ty: fy });
    const harv = { id: 1, owner: "you", tx: hx, ty: hy };
    h.eco.harvesters.push(harv);

    // catchment must actually see the industry
    expect(industriesInCatchment(h.grid, harv).length).toBeGreaterThan(0);

    // no track yet → unserviced, no VP
    const score = createScoreState();
    expect(isServiced(h.track, harv)).toBe(false);
    expect(rescore(h.eco, score)).toEqual([]);

    // lay a road from the harvester to the factory
    for (let y = hy + 1; y <= fy; y++) buildTile(h.track, "road", hx, y);
    expect(isServiced(h.track, harv)).toBe(true);

    const events = rescore(h.eco, score);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "awarded", to: "road", delta: 1 });
    expect(vpFor(score, "you")).toBe(1);
  });

  it("produces cargo once connected, and stops when the line is cut", async () => {
    const h = await boot();
    const { buildTile, demolishTile } = await import("../../src/iso/track");
    const { playerResources } = await import("../../src/iso/economy");

    const c = findSouthCorridor(h.grid);
    expect(c).toBeTruthy();
    const { hx, hy, fy } = c!;
    h.eco.factories.push({ owner: "you", tx: hx, ty: fy });
    h.eco.harvesters.push({ id: 1, owner: "you", tx: hx, ty: hy });
    for (let y = hy + 1; y <= fy; y++) buildTile(h.track, "road", hx, y);

    const before = playerResources(h.eco, "you", 0);
    expect(Object.keys(before).length).toBeGreaterThan(0);

    demolishTile(h.track, "road", hx, hy + 3);   // cut it mid-path
    expect(playerResources(h.eco, "you", 0)).toEqual({});
  });

  it("the AI can plan and build on the real generated map", async () => {
    const h = await boot();
    const { aiBuildStep } = await import("../../src/iso/ai");
    // give the AI a factory on legal ground near the middle
    const { canBuildOn } = await import("../../src/iso/track");
    let spot: [number, number] | null = null;
    for (let y = 10; y < 38 && !spot; y++)
      for (let x = 10; x < 38 && !spot; x++)
        if (canBuildOn(h.grid, "road", x, y)) spot = [x, y];
    expect(spot).toBeTruthy();

    const f = { owner: "ai", tx: spot![0], ty: spot![1] };
    h.eco.factories.push(f);
    const out = aiBuildStep(
      h.eco, f, { stock: {}, purse: { stone: 9999, ore: 9999 } }, 99,
    );
    expect(out).toBeTruthy();
    expect(out!.built.length).toBeGreaterThan(0);
    expect(out!.harvester).toBeTruthy();
  });
});

describe("E11 free setup builds cannot be revoked (K1 regression)", () => {
  it("keeps the free-track allowance as data, not a phase inference", async () => {
    const h = await boot();
    // The K1 bug was a once-per-second affordability sweep clawing back a free
    // build. Here the allowance lives on the player record, so a player with
    // an EMPTY purse still has their free tiles.
    for (const k of Object.keys(h.purse)) h.purse[k] = 0;
    expect(h.freeTrack).toBe(12);
    // ...and it survives arbitrary time passing (many frames)
    await settle(); await settle();
    expect(h.freeTrack).toBe(12);
  });
});
