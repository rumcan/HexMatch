// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// #302 — preload behind the loading screen.
//
// Pinned here:
//   * the reveal gate (src/iso/loading-screen.ts) is a sticky latch: it
//     flips exactly once, on the first frame that sees the game shown, so
//     the pacing clocks re-base onto the reveal instant there and only
//     there. Pure — no DOM, no boot.
//   * the boot actually tracks every step the first frame needs: the task
//     count is pinned with rail on (12, incl. "railway") and off (11), so
//     the LOAD-01 gap this ticket closes — RAIL-03 tracked an id the list
//     never declared — cannot silently come back.
//   * clocks don't start before reveal: frames pumped while art is still
//     pending leave `clocksLive` false and the overlay up; releasing the
//     art settles the bar, lifts the overlay and starts the sim.
// ══════════════════════════════════════════════════════════════════════════
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRevealGate } from "../../src/iso/loading-screen";

// ── stub the art imports (vite handles these in the browser) ──────────────
// Atlas URLs carry the "atlas-fast" mark so the gated Image below can tell
// the gating load (the monolith — without it there is no renderer and no
// frame loop) from every other image, which stays held until the test
// releases it.
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "atlas-fast-0.5x.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "atlas-fast-1x.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "atlas-fast-2x.png" }));

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
      if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createConicGradient") {
        return () => ({ addColorStop: () => undefined });
      }
      return () => undefined;
    },
    set: () => true,
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
}

/** Images the test holds shut until `releaseImages()` — see the mock above. */
const heldImages: (() => void)[] = [];
let imagesReleased = false;
function stubGatedImage() {
  heldImages.length = 0;
  imagesReleased = false;
  class GateImage {
    width = 1024; height = 1024;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(v: string) {
      if (v.includes("atlas-fast") || imagesReleased) queueMicrotask(() => this.onload?.());
      else heldImages.push(() => this.onload?.());
    }
  }
  (globalThis as Record<string, unknown>).Image = GateImage;
}
const releaseImages = () => {
  imagesReleased = true;
  for (const fire of heldImages.splice(0)) fire();
};

interface PreloadHook {
  readonly loading: boolean;
  readonly clocksLive: boolean;
  readonly artLoad: { active: boolean; ready: boolean; done: number; total: number };
}
const hook = () => (window as unknown as { __iso: PreloadHook }).__iso;
const flush = async (n = 12) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

let root: HTMLDivElement;
let dispose: (() => void) | undefined;
/** The captured rAF callback — frames run only when the test pumps them. */
let rafCb: ((t: number) => void) | null = null;
const pump = async (t: number) => {
  const cb = rafCb; rafCb = null;
  if (cb) cb(t);
  await flush(2);
};

beforeEach(() => {
  stubCanvas();
  stubGatedImage();
  window.history.replaceState(null, "", "/?seed=1337&loop=old");
  localStorage.removeItem("hexmatch:save");
  // A remembered difficulty + a dismissed tour keep the boot prompts out of
  // the DOM — this harness boots the game, not its onboarding.
  localStorage.setItem("hexmatch:rival-skill", "normal");
  localStorage.setItem("hexmatch:tutorial", "never");
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
  (globalThis as Record<string, unknown>).OffscreenCanvas = undefined;
  rafCb = null;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafCb = cb as (t: number) => void;
    return 7;
  }) as never;
  window.cancelAnimationFrame = (() => { rafCb = null; }) as never;
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

describe("#302 reveal gate (pure)", () => {
  it("flips exactly once, on the first revealed frame, and never un-flips", () => {
    const gate = createRevealGate();
    expect(gate.live).toBe(false);
    expect(gate.arm(false)).toBe(false);
    expect(gate.live).toBe(false);
    expect(gate.arm(false)).toBe(false);
    // The transitioning call — the frame loop re-bases its pacing clocks here.
    expect(gate.arm(true)).toBe(true);
    expect(gate.live).toBe(true);
    // Already live: no second transition, whatever later frames report.
    expect(gate.arm(true)).toBe(false);
    expect(gate.arm(false)).toBe(false);
    expect(gate.live).toBe(true);
  });
});

describe("#302 preload wiring", () => {
  it("tracks every first-frame step (12 with rail) and starts the clocks on reveal", async () => {
    const { startIsoGame } = await import("../../src/iso/game");
    dispose = startIsoGame(root, { rail: true });
    await flush();

    // The atlas landed (the renderer exists, frames are armed) but the layer
    // sheets, gems, road textures and placards are still held: the bar is up
    // and the game is not revealed.
    expect(hook().artLoad.total).toBe(12);
    expect(hook().artLoad.ready).toBe(false);
    expect(root.querySelector("#iso-loading")).not.toBeNull();
    expect(hook().clocksLive).toBe(false);

    // Frames paint behind the overlay — and the sim stays dark.
    await pump(1000);
    await pump(2000);
    expect(hook().artLoad.ready).toBe(false);
    expect(hook().clocksLive).toBe(false);
    expect(root.querySelector("#iso-loading")).not.toBeNull();

    // The art lands: the bar completes, the overlay lifts, the clocks start.
    releaseImages();
    await flush();
    await pump(3000);
    expect(hook().artLoad).toMatchObject({ ready: true, done: 12, total: 12 });
    expect(hook().clocksLive).toBe(true);
    expect(root.querySelector("#iso-loading.iso-loading-out")).not.toBeNull();
  });

  it("tracks 11 steps with rail off and still reveals", async () => {
    const { startIsoGame } = await import("../../src/iso/game");
    dispose = startIsoGame(root, { rail: false });
    // No "railway" job when the railway is off — and nothing hangs on one.
    expect(hook().artLoad.total).toBe(11);
    releaseImages();
    await flush();
    await pump(1000);
    await pump(2000);
    expect(hook().artLoad).toMatchObject({ ready: true, done: 11, total: 11 });
    expect(hook().clocksLive).toBe(true);
  });
});
