// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// L1 (#215) playthrough — the `?loop=new` route and the game PLAYED through
// the same twins the pointer path drives (`placeDepot`, `dragBuild`,
// `demolish`, `finishSetup`), not via option injection.
//
// Two jobs:
//   1. the flag must reach the game the way the MVP promise says —
//      `opts.newLoop ?? (import.meta.env.DEV && loopParam === "new")`: a
//      URL-only boot turns the loop on in a dev build and OFF without the
//      param, and the trade chrome hides without a single option passed;
//   2. a connected Depot paid through a REAL drag-committed road, with the
//      clock ticks, a REAL demolish cut and a REAL rebuild — purse
//      arithmetic exact, carry included.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WATER, type Grid, type Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H, mulberry32, setRng } from "../../src/game/config";
import { HARVEST_MS } from "../../src/iso/game";
import { CARGOES, INDUSTRY_BY_KEY, type Cargo } from "../../src/iso/config";
import { industriesInCatchment, type EconomyState, type Harvester } from "../../src/iso/economy";

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

interface GameHook {
  phase: string;
  newLoop: boolean;
  purse: Record<string, number>;
  eco: EconomyState;
  grid: Grid;
  finishSetup: () => void;
  econTick: (now?: number) => void;
  placeDepot: (tx: number, ty: number) => boolean;
  dragBuild: (kind: "dirt" | "road", ax: number, ay: number, bx: number, by: number, xFirst?: boolean) => unknown;
  demolish: (tx: number, ty: number) => void;
  refreshQuarry: (now?: number) => unknown;
}

const hook = () => (window as unknown as { __iso: GameHook }).__iso;
const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas();
  stubImage();
  window.history.replaceState(null, "", "/?seed=1337");
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

/** Boot with NO options: the URL is the only channel, exactly the playtest
 *  link the MVP scope describes (`?loop=new`, dev builds only). */
async function bootUrl(url: string) {
  window.history.replaceState(null, "", url);
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, {});
  await settle();
  return hook();
}

/** An industry whose south column (harvester tile + 6 below) is clear. */
function findSouthCorridor(grid: Grid, len = 6):
  { hx: number; hy: number; fy: number; ind: Industry } | null {
  for (const i0 of grid.industries) {
    for (let x = i0.tx; x < i0.tx + i0.w; x++) {
      const hx = x, hy = i0.ty + i0.h, fy = hy + len;
      if (hy < 0 || fy >= MAP_H || hx < 0 || hx >= MAP_W) continue;
      let ok = true;
      for (let y = hy; y <= fy; y++) {
        const i = y * MAP_W + hx;
        if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) { ok = false; break; }
      }
      if (ok) return { hx, hy, fy, ind: i0 };
    }
  }
  return null;
}

/** Base rate per tick of one Depot: its catchment's industry outputs summed by
 *  cargo (single-Depot world, so the catchment IS its hold list). */
function perTick(grid: Grid, harv: Harvester): Partial<Record<Cargo, number>> {
  const out: Partial<Record<Cargo, number>> = {};
  for (const i0 of industriesInCatchment(grid, harv)) {
    const def = INDUSTRY_BY_KEY[i0.type];
    if (!def) continue;
    out[def.cargo] = (out[def.cargo] ?? 0) + (i0.output ?? def.output);
  }
  return out;
}

describe("L1 the ?loop=new route", () => {
  it("boots the new loop from the URL alone, and only with the param", async () => {
    const h = await bootUrl("/?seed=1337&loop=new");
    expect(h.newLoop).toBe(true);                     // dev build + param
    // the trade chrome is gone without a single option ever being passed
    expect(root.querySelector('[data-tab="market"]')).toBeNull();
    expect(root.querySelector('[data-tab="bank"]')).toBeNull();
    dispose?.(); dispose = undefined; root.innerHTML = "";
    const plain = await bootUrl("/?seed=1337&unlimited=0");
    expect(plain.newLoop).toBe(false);                // param absent → old loop
    expect(root.querySelector('[data-tab="market"]')).toBeTruthy();
  });

  it("plays: connect with a real drag, earn on the clock, cut, and resume", async () => {
    const h = await bootUrl("/?seed=1337&loop=new&unlimited=0");
    expect(h.newLoop).toBe(true);

    // The Factory goes in the way the iso-game fixtures do (a real boot has
    // the town rule, and the corridor's foot is not town land); the Depot is
    // then PLACED — the real `placeHarvester` rule, free setup allowance and
    // all — and the road is committed by the real drag path.
    const c = findSouthCorridor(h.grid);
    expect(c).toBeTruthy();
    const { hx, hy, fy } = c!;
    h.eco.factories.push({ owner: "you", ownerId: 1, tx: hx, ty: fy });
    h.finishSetup();
    expect(h.phase).toBe("play");
    expect(h.placeDepot(hx, hy)).toBe(true);
    const harv = h.eco.harvesters.find((x) => x.owner === "you")!;

    const base = { ...h.purse };
    h.dragBuild("dirt", hx, hy + 1, hx, fy - 1);      // the 5 joining tiles
    const pay = perTick(h.grid, harv);

    // eight ticks: floor(8e) per cargo — exact even for the sub-1 rates,
    // because the carry is linear in the tick count while the line stands.
    const ticks = (n: number, now: number) => {
      let t = now;
      for (let i = 0; i < n; i++) { t += HARVEST_MS; h.econTick(t); }
      return t;
    };
    let t = ticks(8, 1_000_000);
    const total = (n: number) => {
      const out: Partial<Record<Cargo, number>> = {};
      for (const [c2, e] of Object.entries(pay) as [Cargo, number][]) out[c2] = Math.floor(n * e);
      return out;
    };
    const want8 = total(8);
    expect(Object.values(want8).reduce((a, v) => a + (v ?? 0), 0), "map income arrived").toBeGreaterThan(0);
    for (const c2 of CARGOES) {
      expect(h.purse[c2] ?? 0, `+${c2} after 8 clock ticks`)
        .toBe((base[c2] ?? 0) + (want8[c2] ?? 0));
    }

    // cut the line with the REAL demolish (its salvage refund lands in the
    // purse during the call — snapshot AFTER it), tick three times: zero.
    h.demolish(hx, hy + 3);
    h.refreshQuarry();
    const cutPurse = { ...h.purse };
    t = ticks(3, t);
    for (const c2 of CARGOES) expect(h.purse[c2] ?? 0, `${c2} while cut`).toBe(cutPurse[c2] ?? 0);

    // one tile rebuilt through the drag path → the ticks resume from the
    // same carry: the ninth paying tick adds floor(9e) − floor(8e).
    h.dragBuild("dirt", hx, hy + 3, hx, hy + 3);
    h.refreshQuarry();
    t = ticks(1, t); void t;
    const want9 = total(9);
    for (const c2 of CARGOES) {
      const delta = (want9[c2] ?? 0) - (want8[c2] ?? 0);
      expect(h.purse[c2] ?? 0, `+${c2} after resume`)
        .toBe((cutPurse[c2] ?? 0) + delta);
    }
    // and the resumed tick really paid something: ≥1 cargo moved
    expect(CARGOES.some((c2) => (h.purse[c2] ?? 0) > (cutPurse[c2] ?? 0))).toBe(true);
  });
});
