// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// B5 (#250) — the live acceptance half: NEITHER player's resources tick while
// a battle is up. The economy clock (`economyTick`), the delivery collector
// and the AI turn all bail on `battleScreen`; this probe boots the real game,
// puts a serviced Depot to work (a churning economy — the control), opens a
// battle screen and shows the purse FLAT across the same clock burst, then
// shows it churn again after the screen closes.
//
// ("The battle always ends within the limit" is the engine's `turnLimit`
// verdict — pinned in `battle.test.ts`; the map half — conquests, fight-offs,
// cooldowns, the rival's battle count — is pinned pure in `iso-battle-map.test.ts`.)
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WATER, type Grid, type Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/iso/config";
import { createTrack, buildTile, type Track } from "../../src/iso/track";
import { setRng, mulberry32 } from "../../src/game/config";
import { SAVE_KEY } from "../../src/iso/savegame-runtime";
import type { BattleScreenHandle } from "../../src/game/battle-screen";

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
interface B5Hook {
  readonly newLoop: boolean;
  grid: Grid;
  track: Track;
  eco: import("../../src/iso/economy").EconomyState;
  purse: Record<string, number>;
  finishSetup: () => void;
  placeDepot: (tx: number, ty: number) => boolean;
  econTick: (now?: number) => void;
  tuningFinish: (abandon?: boolean) => void;
  startBattle: (seed?: number) => BattleScreenHandle;
  readonly battleScreen: BattleScreenHandle | null;
  readonly challengeState: {
    battles: number; rivalReadyAt: number;
    readyAt: [string, number][]; playerReadyAt: [string, number][];
    battleLocks: [number, number][];
  };
  readonly pendingChallenge: unknown;
  readonly pendingFightOff: unknown;
  challengeIndustry: (indId: number) => boolean;
  fightOff: () => boolean;
  declineFightOff: () => void;
}

const hook = () => (window as unknown as { __iso: B5Hook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas();
  stubImage();
  window.history.replaceState(null, "", "/?seed=1337");
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
  // the clock economy (the income this test watches) is the new loop's
  dispose = startIsoGame(root, { newLoop: true });
  await settle();
  return hook();
}

// ── the live map's own Depot site (the L12 file's shape) ──────────────────
interface Site { hx: number; hy: number; fy: number; ind: Industry }

function depotSite(grid: Grid): Site | null {
  for (const ind of grid.industries) {
    for (let x = ind.tx; x < ind.tx + ind.w; x++) {
      const hx = x, hy = ind.ty + ind.h;
      const fy = hy + 6;
      if (hy < 0 || fy >= MAP_H || hx < 0 || hx >= MAP_W) continue;
      let ok = true;
      for (let y = hy; y <= fy; y++) {
        const i = y * MAP_W + hx;
        if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) { ok = false; break; }
      }
      if (ok) return { hx, hy, fy, ind };
    }
  }
  return null;
}

function connect(h: B5Hook, site: Site) {
  h.eco.factories.push({ owner: "you", ownerId: 1, tx: site.hx, ty: site.fy, id: 0, townId: null });
  for (let y = site.hy + 1; y < site.fy; y++) buildTile(h.track, "road", site.hx, y, 1);
}

/** A working economy: a serviced Depot past its first session, at a yield
 *  level that makes the tick's integer credit visible (the tuning economy is
 *  not this test's subject — the CLOCK is). */
async function workingEconomy(h: B5Hook): Promise<Site> {
  expect(h.newLoop, "the clock economy is the new loop").toBe(true);
  const site = depotSite(h.grid);
  expect(site, "seed 1337 keeps an industry with a legal south corridor").toBeTruthy();
  connect(h, site!);
  h.finishSetup();
  expect(h.placeDepot(site!.hx, site!.hy)).toBe(true);
  await settle();
  h.tuningFinish(true);                 // settle the opening session (abandon)
  await settle();
  for (const d of h.eco.harvesters) d.yield = 99;   // clamps to maxYield
  return site!;
}

/** One burst of the economy clock — the same pass the frame makes. */
function burst(h: B5Hook, t0: number, steps = 30) {
  for (let i = 1; i <= steps; i++) h.econTick(t0 + i * 3000);
}

describe("B5 — the economy clock pauses for BOTH players during a battle", () => {
  it("control: a working economy churns; during a battle the purse is FLAT; closing resumes it", async () => {
    const h = await boot();
    await workingEconomy(h);

    // control — the same clock burst moves the purse (up or down: income and
    // upkeep both count as "ticking").
    const t0 = performance.now();
    const before = { ...h.purse };
    burst(h, t0);
    await settle();
    expect(h.purse, "control: a working economy ticks its purse").not.toEqual(before);

    // Drain the cargo the depot pays (the seat "spent" it) — the L16 storage
    // cap would otherwise refuse further credits and mask the clock.
    const paid = Object.keys(before).find((k) => h.purse[k] !== before[k]);
    expect(paid, "the depot pays a visible cargo").toBeTruthy();
    h.purse[paid!] = 0;

    // the fight: the battle screen is up. Even drained, nothing ticks.
    const screen = h.startBattle(7);
    expect(h.battleScreen).toBeTruthy();
    burst(h, t0 + 100_000);
    await settle();
    burst(h, t0 + 200_000);
    await settle();
    expect(h.purse[paid!], "neither seat's resources tick during the battle").toBe(0);

    // closing the screen resumes the clock on the next burst.
    screen.destroy();
    expect(h.battleScreen).toBeNull();
    burst(h, t0 + 300_000);
    await settle();
    expect(h.purse[paid!], "the economy resumes after the battle").toBeGreaterThan(0);
  });

  it("the battle-layer probe exists and starts un-fought (the map saves it with the economy)", async () => {
    const h = await boot();
    await workingEconomy(h);
    expect(h.challengeState.battles).toBe(0);
    expect(h.challengeState.battleLocks).toEqual([]);
    expect(h.pendingChallenge).toBeNull();
    expect(h.pendingFightOff).toBeNull();
    // the doors are wired (a refusal is a healthy door on a fresh map):
    expect(h.challengeIndustry(0)).toBe(false);
    expect(h.fightOff()).toBe(false);
    h.declineFightOff();                 // no-op without an offer
  });
});
