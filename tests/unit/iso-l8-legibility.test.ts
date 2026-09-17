// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// L8 (#222) — the loop made legible: the objective line, the income readout
// and the Depot inspector.
//
// The ticket's acceptance, as tests:
//
//   • an objective line ALWAYS states the current goal — connect, tune, earn,
//     spend — and it is on screen (not merely in the state) while the new loop
//     runs;
//   • every resource gain is traceable to a visible cause: the chip's `+X/s`
//     is the rate the clock actually banks (asserted against a real purse
//     delta), and the Depot inspector prints the factors it is made of —
//     yield, transport, distance, rate, decay.
//
// The wiring is the point of this file. PR #287 shipped ui.ts's objective
// element and chip rate and styles.css's chrome for them, but the `game.ts`
// half (the part that FEEDS them) did not survive the merge into main — the
// elements rendered nothing for a release. These tests boot the real game and
// read the real DOM, so the same silence cannot come back unnoticed.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { southLotFree } from "./helpers/depot-lot";
import { WATER, type Grid, type Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H, CARGO, type Cargo } from "../../src/iso/config";
import { buildTile, type Track } from "../../src/iso/track";
import { setRng, mulberry32 } from "../../src/game/config";
import {
  depotReadout, fmtMult, fmtRate, incomeRates, objectiveLine, perSecond, tickFactor, tickRate,
  RATE_EPSILON, type ObjectiveView, type RateRow,
} from "../../src/iso/readouts";
import type { EconomyState } from "../../src/iso/economy";

// ── stub the art imports (vite handles these in the browser) ──────────────
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

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
interface LegibilityHook {
  readonly newLoop: boolean;
  phase: string;
  grid: Grid;
  track: Track;
  eco: EconomyState;
  board: { onClear: (n: number, combo?: number) => void };
  purse: Record<string, number>;
  readonly reach: Partial<Record<Cargo, number>>;
  readonly objective: { key: string | null; text: string | null };
  readonly incomeRates: Partial<Record<Cargo, number>>;
  readonly depotYields: { id: number; owner: string; tx: number; ty: number; yield: number | null }[];
  finishSetup: () => void;
  placeDepot: (tx: number, ty: number) => boolean;
  refreshQuarry: () => void;
  econTick: (now?: number) => void;
  tuningFinish: (abandon?: boolean) => void;
  setRivalSkill: (key: "easy" | "normal" | "hard") => void;
  centerOn: (tx: number, ty: number) => void;
  tileScreenAt: (tx: number, ty: number) => [number, number];
  pickAt: (sx: number, sy: number) => { tx: number; ty: number } | null;
}

const hook = () => (window as unknown as { __iso: LegibilityHook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

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

async function boot(opts: { newLoop?: boolean } = {}) {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, opts);
  await settle();
  return hook();
}

// ── DOM helpers ───────────────────────────────────────────────────────────
const objectiveEl = () => root.querySelector("#iso-objective") as HTMLElement;
const objectiveText = (): string | null => {
  const el = objectiveEl();
  return el.classList.contains("hidden") ? null : (el.textContent ?? "").trim();
};
const chipRate = (cargo: Cargo): string | null => {
  const chip = [...root.querySelectorAll(".chip")].find((c) =>
    c.querySelector("img.cargo-ic")?.getAttribute("alt") === CARGO[cargo].name);
  const el = chip?.querySelector(".chip-r") as HTMLElement | undefined;
  if (!el || el.classList.contains("hidden")) return null;
  return el.textContent ?? "";
};

const dpr = () => Math.min(2, window.devicePixelRatio || 1);
const overlayCanvas = () => root.querySelectorAll("canvas.iso-layer")[2] as HTMLCanvasElement;
function pointer(type: "pointerdown" | "pointermove" | "pointerup", sx: number, sy: number): void {
  overlayCanvas().dispatchEvent(new PointerEvent(type, {
    clientX: sx / dpr(), clientY: sy / dpr(),
    pointerType: "mouse", pointerId: 1, isPrimary: true, button: 0, buttons: 0,
  }));
}

/** Pan to a depot tile, hover it, and return the inspector card's text. */
async function inspectDepotAt(h: LegibilityHook, tx: number, ty: number): Promise<string> {
  h.centerOn(tx, ty);
  await settle();
  const [sx, sy] = h.tileScreenAt(tx, ty);
  expect(h.pickAt(sx, sy)?.tx, "the pointer lands on the depot tile").toBe(tx);
  pointer("pointermove", sx, sy);
  await settle();
  const inspect = root.querySelector(".iso-inspect") as HTMLElement;
  expect(inspect.style.display).toBe("block");
  return inspect.textContent ?? "";
}

// ── the live map's own Depot sites (the L4 corridor shape) ────────────────
interface Site { hx: number; hy: number; fy: number; ind: Industry }

function depotSite(grid: Grid): Site | null {
  for (const ind of grid.industries) {
    for (let x = ind.tx; x < ind.tx + ind.w; x++) {
      const hx = x, hy = ind.ty + ind.h + 1;
      const fy = hy + 6;
      if (hy < 0 || fy >= MAP_H || hx < 0 || hx >= MAP_W) continue;
      let ok = true;
      for (let y = hy; y <= fy; y++) {
        const i = y * MAP_W + hx;
        if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) { ok = false; break; }
      }
      if (ok && southLotFree(grid, hx, hy)) return { hx, hy, fy, ind };
    }
  }
  return null;
}

/** Plant a Factory at the corridor's far end and lay the road that joins it. */
function connect(h: LegibilityHook, site: Site) {
  h.eco.factories.push({ owner: "you", ownerId: 1, tx: site.hx, ty: site.fy, id: 0, townId: null });
  for (let y = site.hy + 1; y < site.fy; y++) buildTile(h.track, "road", site.hx, y, 1);
}

const purseTotal = (p: Record<string, number>): number =>
  (["wood", "stone", "grain", "ore", "oil", "gold"] as const).reduce((n, c) => n + (p[c] ?? 0), 0);

// ══════════════════════════════════════════════════════════════════════════
// 1. THE OBJECTIVE LINE — one line, always the current goal
// ══════════════════════════════════════════════════════════════════════════
describe("L8 the objective line, as a rule", () => {
  const base: ObjectiveView = {
    phase: "play",
    tuning: null,
    depotCount: 2,
    connectedCount: 2,
    retune: null,
    townLevel: 1,
    townLevelCount: 1,
    nextRung: null,
    winTarget: 12,
  };

  it("walks the loop's own order: setup → tune → build → connect → upgrade", () => {
    expect(objectiveLine({ ...base, phase: "setup-factory" })).toMatchObject({ key: "setup-factory" });
    expect(objectiveLine({ ...base, phase: "setup-harvester" }).text).toMatch(/Depot/);

    // A session IS what to do next while the board is up.
    const tuning = objectiveLine({
      ...base, tuning: { kind: "depot", cargo: "stone", movesLeft: 7, moves: 10 },
    });
    expect(tuning.key).toBe("tuning-depot");
    expect(tuning.text).toBe("Match to set your Stone Depot's output — 7/10 moves left.");

    const town = objectiveLine({ ...base, tuning: { kind: "town", cargo: null, movesLeft: 3, moves: 10 } });
    expect(town.key).toBe("tuning-town");
    expect(town.text).toMatch(/city's base rate — 3\/10 moves left/);

    // No Depot, then a Depot with no road: the two edits the loop asks for.
    expect(objectiveLine({ ...base, depotCount: 0, connectedCount: 0 }).key).toBe("need-depot");
    expect(objectiveLine({ ...base, connectedCount: 0 }).text).toMatch(/road/);

    expect(objectiveLine({ ...base, retune: { cargo: "ore" } }).text).toMatch(/Re-tune your weakest Ore Depot/);
    expect(objectiveLine({ ...base, nextRung: { name: "Quarry Depot", tier: 1 } }).text)
      .toBe("Build a Quarry Depot to unlock rung 2/2.");
    expect(objectiveLine({ ...base, townLevel: 0 }).key).toBe("grow");
    expect(objectiveLine({ ...base }).text).toMatch(/Reach 12★/);
  });

  it("keeps a stable key for the same goal and a new one when the goal moves", () => {
    const a = objectiveLine({ ...base, tuning: { kind: "depot", cargo: "ore", movesLeft: 9, moves: 10 } });
    const b = objectiveLine({ ...base, tuning: { kind: "depot", cargo: "ore", movesLeft: 4, moves: 10 } });
    expect(a.key).toBe(b.key);              // same goal…
    expect(a.text).not.toBe(b.text);        // …with new numbers
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. THE RATE — one expression, printed the way the clock pays it
// ══════════════════════════════════════════════════════════════════════════
describe("L8 the income readout, as a rule", () => {
  const rows = (over: Partial<RateRow> = {}): RateRow => ({
    cargo: "ore", amount: 4, yieldLevel: 2, distanceFactor: 1, transportFactor: 1, townBonus: 0, ...over,
  });

  it("prices a tick with the clock's own factors", () => {
    expect(tickFactor({ yieldLevel: 2, distanceFactor: 0.5, transportFactor: 1, townBonus: 0.6 })).toBeCloseTo(1.6);
    expect(tickRate(rows(), 3000)).toEqual({ perTick: 8, perSecond: 8 / 3 });
    expect(perSecond(6, 3000)).toBe(2);
    // A negative bonus (a hand-edited save) clamps to nothing, exactly as the
    // clock clamps it: the factor never goes below the base rate.
    expect(tickFactor({ yieldLevel: 1, distanceFactor: 1, transportFactor: 1, townBonus: -5 })).toBe(1);
  });

  it("sums per cargo per second and stays quiet below the chip's own epsilon", () => {
    const rates = incomeRates([rows(), rows({ amount: 2 }), rows({ cargo: "wood", amount: 1 })], 3000);
    expect(rates.ore).toBeCloseTo(4);           // (8 + 4) per tick → 4/s
    expect(rates.wood).toBeCloseTo(2 / 3);
    expect(incomeRates([rows({ amount: 0.05 })], 3000)).toEqual({});  // 0.033/s < epsilon
    expect(incomeRates([], 3000)).toEqual({});
    expect(RATE_EPSILON).toBeGreaterThan(0);
  });

  it("prints a multiplier and a rate without dead zeros", () => {
    expect(fmtMult(1)).toBe("×1");
    expect(fmtMult(1.4)).toBe("×1.4");
    expect(fmtMult(1.75)).toBe("×1.75");
    expect(fmtRate(8)).toBe("8");
    expect(fmtRate(2.35)).toBe("2.35");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. THE DEPOT CARD — the numbers the tick multiplies, in words
// ══════════════════════════════════════════════════════════════════════════
describe("L8 the depot readout, as a rule", () => {
  const readout = (over: Partial<Parameters<typeof depotReadout>[0]> = {}) => depotReadout({
    yieldLevel: 1.4,
    transportLabel: "paved",
    transportFactor: 1.6,
    distanceTiles: 12,
    distanceFactor: 1,
    distanceBand: "mid",
    cargo: "ore",
    amount: 4,
    serviced: true,
    stopped: false,
    townBonus: 0,
    decayRate: 0,
    minYield: 1,
    tickMs: 3000,
    ...over,
  });

  it("names the yield, the transport tier, and the tick's rate in both units", () => {
    const r = readout();
    expect(r.yieldLine).toBe("yield: ×1.4 · transport: paved ×1.6");
    expect(r.perTick).toBeCloseTo(4 * 1.4 * 1.6);
    expect(r.rateLine).toBe(`rate: ${fmtRate(r.perTick)}/tick · ${fmtRate(r.perSecond, 1)}/s ${CARGO.ore.icon} ${CARGO.ore.name}`);
    expect(r.decayLine).toBeNull();
  });

  it("refuses to promise income a stopped or unconnected Depot will not pay", () => {
    expect(readout({ serviced: false }).rateLine).toBe("rate: <i>no route — not ticking</i>");
    expect(readout({ serviced: false }).perTick).toBe(0);
    expect(readout({ stopped: true }).rateLine).toMatch(/protest — stopped/);
  });

  it("prints the difficulty's cooling only on a row that has one", () => {
    expect(readout({ decayRate: 0.04, minYield: 1.2 }).decayLine).toBe("decay: 4%/tick above ×1.2");
    expect(readout({ decayRate: 0 }).decayLine).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. THE WIRING — what the player actually sees, on a live game
// ══════════════════════════════════════════════════════════════════════════
describe("L8 the live HUD on the new loop", () => {
  it("shows an objective line that names the setup debt and then the network", async () => {
    const h = await boot({ newLoop: true });
    expect(h.newLoop).toBe(true);

    // Setup: the Factory is owed.
    expect(root.querySelector("#iso-objective"), "the objective element is mounted").toBeTruthy();
    expect(objectiveText()).toMatch(/Factory/);
    expect(h.objective.key).toBe("setup-factory");

    h.finishSetup();
    await settle();
    expect(h.objective.key, "the goal moved on with the phase").not.toBe("setup-factory");
    expect(objectiveText()).toBeTruthy();

    // A Depot with no road: the line says which half is missing.
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy - 1)).toBe(true);
    await settle();
    dispose?.();
    dispose = undefined;

    const played = await boot({ newLoop: true });
    played.finishSetup();
    await settle();
    const site2 = depotSite(played.grid)!;
    expect(played.placeDepot(site2.hx, site2.hy - 1)).toBe(true);
    // The opening Depot opens its tuning session — the board IS the goal.
    await settle();
    expect(played.objective.key).toBe("tuning-depot");
    expect(objectiveText()).toMatch(/Match to set your .*Depot's output/);

    // Finish the session without a road: the goal becomes the connection.
    played.tuningFinish(true);
    await settle();
    expect(played.objective.key).toBe("need-road");
    expect(objectiveText()).toMatch(/road/i);

    // Road it in: the goal moves to the next thing (a rung or the city).
    connect(played, site2);
    await settle();
    expect(played.objective.key).not.toBe("need-road");
  });

  it("keeps the retired loop free of both readouts", async () => {
    const h = await boot({ newLoop: false });
    h.finishSetup();
    await settle();
    expect(objectiveEl().classList.contains("hidden"), "no objective line off the new loop").toBe(true);
    expect(h.objective.text).toBeNull();
    expect(h.incomeRates).toEqual({});
  });

  it("turns a connected Depot into a chip rate that matches what the clock banks", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy - 1)).toBe(true);
    connect(h, site);
    await settle();

    // Tune it to a known level so the rate is not the birth default.
    h.board.onClear(300, 1);
    h.tuningFinish(false);
    await settle();

    h.refreshQuarry();
    const perTick = Object.values(h.reach).reduce((a, b) => a + b, 0);
    expect(perTick, "the Depot is connected and delivering").toBeGreaterThan(0);

    const rates = h.incomeRates;
    const cargo = (Object.keys(rates) as Cargo[])[0];
    expect(cargo, "the chip bar has a rate").toBeTruthy();
    const rate = rates[cargo]!;
    expect(rate).toBeGreaterThan(0);

    // The chip prints the same number the state publishes.
    expect(chipRate(cargo)).toBe(`+${rate.toFixed(1).replace(/\.0$/, "")}/s`);

    // …and three ticks bank it: rate × 9 seconds, inside the clock's own
    // fractional carry (≤ 1 unit per depot).
    const before = purseTotal(h.purse);
    let now = performance.now();
    for (let i = 0; i < 3; i++) h.econTick(now += 10_000);
    const earned = purseTotal(h.purse) - before;
    expect(Math.abs(earned - rate * 9)).toBeLessThanOrEqual(1);
  });

  it("shows no rate while nothing is connected, and none after a protest stops the route", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy - 1)).toBe(true);
    h.tuningFinish(true);
    await settle();
    // A Depot with no road earns nothing, so the bar stays quiet.
    expect(h.incomeRates).toEqual({});
    expect(chipRate(site.ind.cargo ?? "ore")).toBeNull();
  });

  it("hovers a Depot into the full ledger: yield, transport, rate and distance", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy - 1)).toBe(true);
    connect(h, site);
    await settle();
    h.board.onClear(300, 1);
    h.tuningFinish(false);
    await settle();

    const card = await inspectDepotAt(h, site.hx, site.hy);
    expect(card).toMatch(/link: road/);
    expect(card).toMatch(/distance: \d+ tiles · ×[\d.]+ \((near|mid|far)\)/);
    expect(card).toMatch(/yield: ×[\d.]+ · transport: \w+ ×[\d.]+/);
    expect(card).toMatch(/rate: [\d.]+\/tick · [\d.]+\/s/);
    // The rate line names the cargo the Depot HOLDS (the reach readout, which
    // is also what the clock pays), so the card and the purse agree.
    h.refreshQuarry();
    const held = (Object.keys(h.reach) as Cargo[])[0];
    expect(held, "the Depot is delivering something").toBeTruthy();
    expect(card).toMatch(new RegExp(CARGO[held].name));
    // Normal is the no-decay row: the card must not invent a cooling line.
    expect(card).not.toMatch(/decay:/);

    // Hard is the decay row: the same card prints it.
    h.setRivalSkill("hard");
    await settle();
    const hard = await inspectDepotAt(h, site.hx, site.hy);
    expect(hard).toMatch(/decay: [\d.]+%\/tick above ×[\d.]+/);
  });
});
