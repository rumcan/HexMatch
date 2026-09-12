// @vitest-environment jsdom
//
// TRAFFIC-01 — the ambient cars wired into the REAL game loop (not just the
// cars module): the frame plans them on the network-change edge, ticks them
// host/solo only, merges them into world.vehicles next to the lorries, and
// exposes __iso.traffic / __iso.setTraffic as the performance dial.
//
// Same headless harness pattern as iso-game.test.ts: the real startIsoGame
// mounts in a jsdom DOM with a stubbed canvas and immediately-resolving
// images; requestAnimationFrame is a zero-delay timer, so frames actually
// run between settle() calls.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setRng, mulberry32 } from "../../src/game/config";
import { CAR_COUNT } from "../../src/iso/cars";

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

interface TrafficCar {
  name: string;
  loop: boolean;
  reverse: boolean;
  leg: number;
  t: number;
  routeTiles: number;
}

interface IsoHook {
  phase: string;
  traffic: TrafficCar[];
  setTraffic: (count: number) => string[];
  truckTick: (now?: number, dtMs?: number) => void;
}

const hook = () => (window as unknown as { __iso: IsoHook }).__iso;

const settle = async (ms = 0) => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, ms));
};

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas();
  stubImage();
  window.history.replaceState(null, "", "/?seed=1337");
  localStorage.removeItem("hexmatch:save");
  localStorage.setItem("hexmatch:rival-skill", "normal");
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

describe("TRAFFIC-01 in the live game loop", () => {
  it("boots with the default volume of ambient cars (car 1 … car N)", async () => {
    const h = await boot();
    expect(h.phase).toBe("setup-factory");
    const cars = h.traffic;
    expect(cars.length).toBe(CAR_COUNT);
    expect(cars.map((c) => c.name)).toEqual(
      Array.from({ length: cars.length }, (_, i) => `car ${i + 1}`),
    );
    for (const c of cars) {
      expect(c.routeTiles).toBeGreaterThanOrEqual(2);
      expect(c.t).toBeGreaterThanOrEqual(0);
      expect(c.t).toBeLessThanOrEqual(1);
    }
  });

  it("the cars actually roll: positions advance between headless ticks", async () => {
    const h = await boot();
    const before = h.traffic.map((c) => `${c.leg}:${c.t}:${c.reverse}`).join("|");
    h.truckTick(performance.now(), 1000); // one second of car time
    const after = h.traffic.map((c) => `${c.leg}:${c.t}:${c.reverse}`).join("|");
    expect(after).not.toBe(before);
  });

  it("__iso.setTraffic is the perf dial: 0 clears, 5 gives five named cars", async () => {
    const h = await boot();
    expect(h.setTraffic(0)).toEqual([]);
    expect(h.traffic).toEqual([]);
    const five = h.setTraffic(5);
    expect(five).toEqual(["car 1", "car 2", "car 3", "car 4", "car 5"]);
    expect(h.traffic).toHaveLength(5);
    // back to the default volume (a dozen)
    expect(h.setTraffic(CAR_COUNT)).toEqual(
      Array.from({ length: CAR_COUNT }, (_, i) => `car ${i + 1}`),
    );
    expect(h.traffic).toHaveLength(CAR_COUNT);
  });
});
