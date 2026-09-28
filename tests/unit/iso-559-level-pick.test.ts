// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// MAP-2 (#559) item 5 — Level Ground can target the ground next to a resource.
//
// The owner's report: "Level Ground is useless around a resource. Make it able
// to level the ring around an industry (allow targeting next to industry
// footprints, preview the cost)."
//
// The mechanics were never the block: `planLevel` happily flattens a ring
// (probe: 880 free depot lots beside industries on 20 all-ON seeds, 872 of
// them priced with no refusal at all). The CLICK was. `renderer.pick` is
// two-stage — the tile under the cursor, then a sprite hit that overrides it —
// and a factory's art covers the ground beside its footprint. Every click
// there answered with the factory's own anchor tile, which can only refuse
// ("A building stands there"), so the tool looked dead exactly where the owner
// wanted it.
//
// The fix under test: the Level tool picks GROUND (`pickForAction` passes
// `sprites: false`), so the tile the cursor is over is what the plan levels.
// Pinned here in the real game (jsdom, the same boot the other live harnesses
// use), because the whole bug lives in the pointer path.
//
// The cost preview half of the item is pinned where it lives:
// `iso-456-level-ground.test.ts` covers the plan and its price, and the drag
// hint reads `levelPlan.money` — the exact figure the commit charges.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setRng, mulberry32 } from "../../src/game/config";
import { SAVE_KEY } from "../../src/iso/savegame-runtime";
import { idx, type Grid } from "../../src/iso/grid";

vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

/** The jsdom canvas/image stubs every live harness in this suite uses. */
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

interface Hook {
  pickAt: (sx: number, sy: number) => { tx: number; ty: number; sprite: string | null } | null;
  setTool: (t: string) => void;
  readonly grid: Grid;
}
const hook = () => (window as unknown as { __iso: Hook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas(); stubImage();
  window.history.replaceState(null, "", "/?seed=42&rings=1");
  localStorage.removeItem(SAVE_KEY);
  localStorage.setItem("hexmatch:rival-skill", "normal");
  localStorage.setItem("hexmatch:tutorial", "never");
  setRng(mulberry32(42));
  (globalThis as Record<string, unknown>).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (globalThis as Record<string, unknown>).OffscreenCanvas = undefined;
  window.requestAnimationFrame =
    ((cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number) as never;
  window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as never;
  root = document.createElement("div");
  Object.defineProperty(root, "clientWidth", { value: 900, configurable: true });
  Object.defineProperty(root, "clientHeight", { value: 700, configurable: true });
  document.body.appendChild(root);
});
afterEach(() => { dispose?.(); dispose = undefined; root.remove(); vi.restoreAllMocks(); });

describe("MAP-2 (#559) Level Ground targets the ground", () => {
  it("resolves a click beside an industry to the free tile, not the industry", async () => {
    const { startIsoGame } = await import("../../src/iso/game");
    dispose = startIsoGame(root, { newLoop: true });
    await settle();
    const h = hook();
    const grid = h.grid;
    const industryAt = (tx: number, ty: number): string | null => {
      for (const ind of grid.industries) {
        if (tx >= ind.tx && tx < ind.tx + ind.w && ty >= ind.ty && ty < ind.ty + ind.h) return ind.type;
      }
      return null;
    };

    // The camera opens on the player's own industry, so a window around the
    // screen centre is a window over it.
    let samples = 0, moved = 0, rescued = 0;
    const examples: string[] = [];
    for (let sy = -200; sy <= 200; sy += 8) {
      for (let sx = -320; sx <= 320; sx += 8) {
        h.setTool("select");
        const spritePick = h.pickAt(sx, sy);
        if (!spritePick) continue;
        h.setTool("level");
        const groundPick = h.pickAt(sx, sy);
        if (!groundPick) continue;
        samples++;
        if (groundPick.tx === spritePick.tx && groundPick.ty === spritePick.ty) continue;
        moved++;
        // The rescue: a click the sprite stage stole for an industry is now
        // free ground the Level plan can actually flatten.
        if (industryAt(spritePick.tx, spritePick.ty)
          && !industryAt(groundPick.tx, groundPick.ty)
          && grid.occupancy[idx(groundPick.tx, groundPick.ty)] === -1) {
          rescued++;
          if (examples.length < 3) {
            examples.push(`(${sx},${sy}) ${industryAt(spritePick.tx, spritePick.ty)}@${spritePick.tx},${spritePick.ty} → ${groundPick.tx},${groundPick.ty}`);
          }
        }
      }
    }
    expect(samples).toBeGreaterThan(500);
    // Hundreds of pixels in this window are "over an industry" for every other
    // tool, and more than a few of them are free levelable ground.
    expect(moved).toBeGreaterThan(50);
    expect(rescued, `examples: ${examples.join(" ")}`).toBeGreaterThan(20);
  }, 30000);
});
