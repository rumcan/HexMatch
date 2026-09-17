// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// #297 — the rival may not sprint to the win line.
//
// On the new loop a Depot, a city upgrade and a re-match each cost the player
// a real tuning session. The rival used to get them free and instant: a Normal
// rival raised two Depots and a rung every build clock and won in 30–50 s.
// `sessionMs` (skill.ts) now keeps it busy for one session after each, and it
// raises one Depot per turn. Measured on seeds 1337/7/42 when this landed:
// Easy 9.4–11.2 min, Normal 7.1–8.5 min, Hard 4.7–5.6 min to 12★.
//
// Boots the REAL game module in jsdom and drives its clocks with an injected
// `now`, the way `iso-l1d-rival-clock.test.ts` does.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H, type Cargo } from "../../src/iso/config";
import type { Track } from "../../src/iso/track";
import { setRng, mulberry32 } from "../../src/game/config";
import type { EconomyState } from "../../src/iso/economy";
import type { RivalPlant } from "../../src/iso/rival-plant";

// ── stub the art imports (vite handles these in the browser) ──────────────
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

/** The slice of `window.__iso` this file drives. */
interface RivalClockHook {
  readonly newLoop: boolean;
  phase: string;
  grid: Grid;
  track: Track;
  eco: EconomyState;
  /** The local seat's purse (live object). */
  purse: Record<string, number>;
  /**
   * L11 (#226): each seat's LIVE purse, in `players` order. The offer board
   * used to expose the rival's by reference (`market.players[1].res`).
   */
  purses: Record<string, number>[];
  /** AI-03: the rival's plant — the board its autoplay plays and sabotage hits. */
  rivalPlant: RivalPlant;
  /** What the rival's network reaches, per cargo (its own token gate). */
  readonly rivalReach: Partial<Record<Cargo, number>>;
  readonly trucksList: { depotId: number; ownerId: number; deliveries: number }[];
  finishSetup: () => void;
  /** The L1b/L1d clock, with an injectable now (writes both purses). */
  econTick: (now?: number) => void;
  /** The rival's build turn. */
  aiTick: (now?: number) => void;
  /** The per-frame board clock (drives the rival's plant + autoplay). */
  tick: (now?: number) => void;
  /** The lorry integrator: plans on a dirty world, moves, then collects arrivals. */
  truckTick: (now?: number, dtMs?: number) => void;
  refreshQuarry: (now?: number) => unknown;
  /** The twin of a build's aftermath: rescore, dirty the lorries, re-read
   *  BOTH seats' reach (`rescoreNow` in game.ts). */
  rescore: () => void;
  demolish: (tx: number, ty: number) => void;
  /** The live placement click, so the long-run test opens through the real rule. */
  placeFactory: (tx: number, ty: number) => boolean;
  setRivalSkill: (key: "easy" | "normal" | "hard") => void;
  readonly rivalSkill: { key: "easy" | "normal" | "hard" };
  pavedTiles: (who: string) => number;
  vp: { you: number; ai: number };
}

const hook = () => (window as unknown as { __iso: RivalClockHook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas();
  stubImage();
  // L1f (#237): the address bar says which loop this harness plays — the
  // RETIRED one, the loop it was written against. `?loop=old` is the release's
  // escape hatch; a test that wants the new loop says so (`{ newLoop: true }`).
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

async function boot(opts: { newLoop?: boolean } = {}) {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, opts);
  await settle();
  return hook();
}

/** Seconds until the rival wins (or `null` within `limitS`). */
async function secondsToRivalWin(seed: number, diff: "easy" | "normal" | "hard", limitS: number) {
  window.history.replaceState(null, "", `/?seed=${seed}`);
  setRng(mulberry32(seed));
  localStorage.setItem("hexmatch:rival-skill", diff);
  await boot({ newLoop: true });
  const h = hook() as RivalClockHook & {
    placementPlan: (kind: string, tx: number, ty: number) => { valid: boolean } | null;
  };
  let placed = false;
  for (let x = 0; x < MAP_W && !placed; x++) {
    for (let y = 0; y < MAP_H; y++) {
      if (h.placementPlan("factory", x, y)?.valid && h.placeFactory(x, y)) { placed = true; break; }
    }
  }
  expect(placed, "a legal Factory spot").toBe(true);
  h.setRivalSkill(diff);
  h.finishSetup();
  const t0 = performance.now();
  for (let s = 0; s <= limitS; s++) {
    h.econTick(t0 + s * 1000);
    h.aiTick(t0 + s * 1000);
    if (h.phase === "won") return s;
  }
  return null;
}

describe("#297 the rival's pace on the new loop", () => {
  it("a Normal rival cannot win inside five minutes", async () => {
    const won = await secondsToRivalWin(1337, "normal", 5 * 60);
    expect(won, `Normal rival won after ${won}s`).toBeNull();
  }, 120_000);

  it("a Hard rival cannot win inside three minutes", async () => {
    const won = await secondsToRivalWin(1337, "hard", 3 * 60);
    expect(won, `Hard rival won after ${won}s`).toBeNull();
  }, 120_000);

  it("the rival still gets there: a Hard rival wins within fifteen minutes", async () => {
    const won = await secondsToRivalWin(1337, "hard", 15 * 60);
    expect(won).not.toBeNull();
  }, 180_000);
});
