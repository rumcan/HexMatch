// @vitest-environment jsdom
//
// HUD retention: the header and resource bar are painted every frame, so
// unchanged nodes must survive frames (no DOM churn under the pointer) while
// a changed value still shows on the very next frame.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CARGOES } from "../../src/iso/config";
import { mulberry32, setRng } from "../../src/game/config";

vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

const frame = () => new Promise((r) => setTimeout(r, 0));
let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "canvas") return null;
      if (prop === "getImageData") {
        return (_x: number, _y: number, w: number, h: number) =>
          ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4).fill(255), width: w, height: h });
      }
      return () => undefined;
    },
    set: () => true,
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
  (globalThis as Record<string, unknown>).Image = class {
    width = 1024; height = 1024;
    onload: (() => void) | null = null;
    set src(_v: string) { queueMicrotask(() => this.onload?.()); }
  };
  window.history.replaceState(null, "", "/?seed=1337");
  localStorage.removeItem("hexmatch:save");
  localStorage.setItem("hexmatch:rival-skill", "normal");
  localStorage.setItem("hexmatch:tutorial", "never");
  setRng(mulberry32(1337));
  (globalThis as Record<string, unknown>).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (globalThis as Record<string, unknown>).OffscreenCanvas = undefined;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number) as never;
  window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as never;
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
  vi.restoreAllMocks();
});

describe("HUD retention", () => {
  it("keeps unchanged HUD nodes across 120 frames and renders a changed value at once", async () => {
    const { startIsoGame } = await import("../../src/iso/game");
    dispose = startIsoGame(root);
    for (let i = 0; i < 12; i++) await frame();
    const hook = (window as unknown as { __iso: { purse: Record<string, number> } }).__iso;

    const chipNums = () => [...root.querySelectorAll<HTMLElement>("#iso-res .chip-n")];
    const kings = () => [...root.querySelectorAll<HTMLElement>(".kingdoms .king")];
    const chipsBefore = chipNums(), kingsBefore = kings();
    expect(chipsBefore).toHaveLength(CARGOES.length);
    expect(kingsBefore.length).toBeGreaterThan(0);
    const portraits = kingsBefore.map((k) => k.querySelector(".king-av"));

    for (let i = 0; i < 120; i++) await frame();
    chipNums().forEach((n, i) => expect(n).toBe(chipsBefore[i]));
    kings().forEach((k, i) => expect(k.querySelector(".king-av")).toBe(portraits[i]));

    const stone = CARGOES.indexOf("stone");
    const next = (hook.purse.stone ?? 0) + 7;
    hook.purse.stone = next;
    await frame();
    expect(chipNums()[stone]).toBe(chipsBefore[stone]);
    expect(chipNums()[stone].textContent).toBe(String(next));
  });
});
