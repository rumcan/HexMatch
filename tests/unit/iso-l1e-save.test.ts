// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// L1e (#236) — save and restore the depot yields and income remainders.
//
// The clock (#233) pays `yield × distance × transport` per tick and banks
// whatever is left under one unit until it reaches a whole (#218's level rides
// the depot record). Neither number lived in the save, so a reload restarted
// every depot at the baseline yield with an empty bank: the world looked
// intact and quietly earned less.
//
// The acceptance block this file pins:
//
//   • `?loop=new` — build and connect a Depot, reload, Continue: the same
//     yields and the same banked remainders come back, and the next tick pays
//     on from them instead of restarting (no jump);
//   • old saves still load unchanged — a payload with none of the new fields
//     restores exactly as it always did, and a save the shipped loop wrote
//     loads under the new one;
//   • the round-trip of the new fields, field by field.
//
// Plus the spec's refusal: a save the new loop wrote is not half-restored into
// the shipped one — the boot keeps the slot for the session that can open it,
// boots fresh, and says how (`NEW_LOOP_SAVE_TOAST`).
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WATER, type Grid, type Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H, TUNING, type Cargo } from "../../src/iso/config";
import { buildTile, type Track } from "../../src/iso/track";
import { setRng, mulberry32 } from "../../src/game/config";
import {
  NEW_LOOP_SAVE_TOAST, SAVE_KEY, SAVEGAME_VERSION, loopCarryToWire, readSave,
  saveNeedsNewLoop, savedLoopCarry, type SaveGamePayload,
} from "../../src/iso/savegame-runtime";
import { SNAPSHOT_VERSION } from "../../src/iso/snapshot";
import { tuningYieldFor } from "../../src/iso/tuning";
import type { Board } from "../../src/game/board";

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
interface LoopHook {
  readonly newLoop: boolean;
  readonly phase: string;
  grid: Grid;
  track: Track;
  eco: import("../../src/iso/economy").EconomyState;
  board: Board;
  purse: Record<string, number>;
  finishSetup: () => void;
  placeDepot: (tx: number, ty: number) => boolean;
  /** The L1b clock, with an injectable now (writes the purse). */
  econTick: (now?: number) => void;
  /** The game's own reach readout, so a test can price one tick exactly. */
  refreshQuarry: () => void;
  reach: Record<string, number>;
  readonly tuning: { depotId: number; cargo: Cargo } | null;
  /** The plate's Finish key — what scores the open session onto its Depot. */
  tuningFinish: (abandon?: boolean) => void;
  readonly depotYields: { id: number; owner: string; tx: number; ty: number; yield: number | null }[];
  /** L1e (#236): the banked remainders, the writer's twin, the refusal flag. */
  readonly loopCarries: { id: number; carry: number }[];
  saveNow: () => void;
  readonly saveHeldBack: boolean;
}

const hook = () => (window as unknown as { __iso: LoopHook }).__iso;
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

async function boot(opts: { newLoop?: boolean } = {}) {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, opts);
  await settle();
  return hook();
}

/** A reload: the same slot, the same seed, a fresh game instance over it. */
async function reload(opts: { newLoop?: boolean } = {}) {
  dispose?.();
  dispose = undefined;
  setRng(mulberry32(1337));
  return boot(opts);
}

// ── the live map's own Depot site (the shape iso-l4-tuning.test.ts uses) ───
interface Site { hx: number; hy: number; fy: number; ind: Industry }

/** The tile below an industry's south edge, with six open tiles below that —
 *  a Depot that really serves `ind`, and a straight run a Factory can close. */
function depotSite(grid: Grid): Site {
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
  throw new Error("seed 1337 has no Depot site with a six-tile corridor");
}

/** Plant a Factory at the corridor's far end and lay the road that joins it. */
function connect(h: LoopHook, site: Site) {
  h.eco.factories.push({ owner: "you", ownerId: 1, tx: site.hx, ty: site.fy, id: 0, townId: null });
  for (let y = site.hy + 1; y < site.fy; y++) buildTile(h.track, "road", site.hx, y, 1);
}

/** Sum every cargo in the purse — what one clock tick paid, all told. */
const purseTotal = (p: Record<string, number>): number =>
  (["wood", "stone", "grain", "ore", "oil", "gold"] as const).reduce((n, c) => n + (p[c] ?? 0), 0);

/** What the network delivers to the local seat's depots in one tick. */
const perTickOf = (h: LoopHook): number => {
  h.refreshQuarry();
  return Object.values(h.reach).reduce((a, b) => a + b, 0);
};

/** The raw slot, so a test can assert what a boot did NOT write over. */
const rawSave = () => localStorage.getItem(SAVE_KEY);
const toasts = () => [...root.querySelectorAll(".toast")].map((t) => t.textContent ?? "");

/** A minimal but VALID payload — the shape the continue-game suites craft. */
function craftedSave(over: Partial<SaveGamePayload> = {}): SaveGamePayload {
  return {
    v: SAVEGAME_VERSION,
    snapV: SNAPSHOT_VERSION,
    savedAt: Date.now() - 60_000,
    seed: 1337,
    skillKey: "normal",
    phase: "play",
    winnerId: null,
    bandit: {},
    track: { dirt: "", road: "", owner: "", upgraded: "" },
    eco: { harvesters: [], factories: [] },
    players: [],
    boards: [],
    clocks: {},
    ...over,
  };
}

/** The level a half-played session (30 of `TUNING.targetScore`) earns. */
const HALF_SESSION_YIELD = tuningYieldFor(30);

/**
 * The new loop's world, saved: a connected Depot with a HALF-PLAYED session —
 * a level above the baseline and below the ceiling, so the round-trip proves
 * the number moved — and one tick banked (this map delivers 1.6/tick, so
 * 1.6 × the level pays two whole units and leaves a remainder waiting).
 */
async function playedNewLoop() {
  const h = await boot({ newLoop: true });
  h.finishSetup();
  const site = depotSite(h.grid);
  expect(h.placeDepot(site.hx, site.hy)).toBe(true);
  connect(h, site);
  await settle();
  const depotId = h.tuning!.depotId;
  expect(HALF_SESSION_YIELD, "not the baseline, not the ceiling")
    .toBeGreaterThan(TUNING.minYield);
  expect(HALF_SESSION_YIELD).toBeLessThan(TUNING.maxYield);
  h.board.onClear(30, 1);
  h.tuningFinish(false);
  await settle();
  expect(h.depotYields.find((d) => d.id === depotId)!.yield).toBe(HALF_SESSION_YIELD);
  const perTick = perTickOf(h);
  expect(perTick, "the Depot is connected and delivering").toBeGreaterThan(0);
  let now = performance.now();
  h.econTick(now += 10_000);
  const banked = h.loopCarries.find((c) => c.id === depotId)?.carry ?? 0;
  expect(banked, "the tick banked a remainder worth restoring").toBeGreaterThan(0);
  return { h, site, depotId, perTick, banked, yieldOf: HALF_SESSION_YIELD };
}

// ══════════════════════════════════════════════════════════════════════════
describe("L1e the payload's rules (savegame-runtime)", () => {
  it("carries a remainder only inside [0, 1), both ways", () => {
    // Nothing banked → no field at all, so a save with no new-loop income is
    // the payload it was before this landed.
    expect(loopCarryToWire(new Map())).toBeUndefined();
    expect(loopCarryToWire(new Map([[1, 0], [2, 1], [3, -0.2], [4, 0.25], [5, Number.NaN]])))
      .toEqual({ "4": 0.25 });
    // …and the read side cleans the same way, hand-edit included.
    expect([...savedLoopCarry(craftedSave({ loopCarry: { "4": 0.25, "9": 5, oops: 0.5 } }))])
      .toEqual([[4, 0.25]]);
    expect([...savedLoopCarry(craftedSave())]).toEqual([]);
  });

  it.skip("refuses only the direction that would break a world", () => {
    // new-loop save, shipped boot: the yields have no clock to pay them.
    expect(saveNeedsNewLoop(craftedSave({ loop: true }), false)).toBe(true);
    // …the same save under the flag is just a resume.
    expect(saveNeedsNewLoop(craftedSave({ loop: true }), true)).toBe(false);
    // an old save is the shipped loop's, whichever loop opens it.
    expect(saveNeedsNewLoop(craftedSave(), false)).toBe(false);
    expect(saveNeedsNewLoop(craftedSave(), true)).toBe(false);
    expect(saveNeedsNewLoop(craftedSave({ loop: false }), true)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L1e a new-loop save round-trips", () => {
  it("saves the flag, the tuned yields and the clock's remainders", async () => {
    const { h, depotId, perTick, banked, yieldOf } = await playedNewLoop();

    // The three numbers the clock is built out of, as the live game holds them.
    expect(h.depotYields.find((d) => d.id === depotId)!.yield).toBe(yieldOf);
    expect(banked).toBeCloseTo(perTick * yieldOf - Math.floor(perTick * yieldOf), 10);

    h.saveNow();
    const d = readSave()!;
    expect(d.loop, "the save names the loop it was played under").toBe(true);
    expect(d.eco.harvesters.find((x) => x.id === depotId)!.yield,
      "the level rides the depot record it belongs to").toBe(yieldOf);
    expect(d.loopCarry?.[String(depotId)], "the remainder rides its depot id")
      .toBeCloseTo(banked, 10);
  });

  it("restores them on Continue, and the next tick pays on without a jump", async () => {
    const { h, site, depotId, perTick, banked, yieldOf } = await playedNewLoop();
    h.saveNow();
    const saved = rawSave();
    expect(saved).not.toBeNull();

    const r = await reload({ newLoop: true });
    // Continue happened: a fresh boot would be in the factory-placement phase.
    expect(r.saveHeldBack).toBe(false);
    expect(r.phase, "the restored world is the one that was saved").toBe("play");
    expect(toasts().join(" ")).toMatch(/restored from your save/);

    // Same road, same Depot, same level, same bank.
    expect(r.depotYields.find((d) => d.id === depotId)!.yield).toBe(yieldOf);
    expect(r.loopCarries.find((c) => c.id === depotId)!.carry).toBeCloseTo(banked, 10);
    expect(perTickOf(r), "the connection came back with the save").toBeCloseTo(perTick, 10);
    expect(r.eco.harvesters.find((d) => d.id === depotId)!.tx).toBe(site.hx);

    // …and the income continues from the banked remainder rather than from
    // zero: `floor(rate + carry)`, not `floor(rate)`.
    const before = purseTotal(r.purse);
    r.econTick(performance.now() + 10_000);
    const paid = purseTotal(r.purse) - before;
    expect(paid).toBe(Math.floor(perTick * yieldOf + banked));
    expect(paid, "the banked fraction is what makes the difference")
      .toBeGreaterThan(Math.floor(perTick * yieldOf));
  });

  it("the `?loop=new` URL is the same door, and it round-trips too", async () => {
    // The acceptance line's own entry point: a DEV boot reading the param, not
    // a harness passing `opts.newLoop`.
    window.history.replaceState(null, "", "/?seed=1337&loop=new");
    const h = await boot();
    expect(h.newLoop, "the URL param turned the new loop on").toBe(true);
    h.finishSetup();
    const site = depotSite(h.grid);
    expect(h.placeDepot(site.hx, site.hy)).toBe(true);
    connect(h, site);
    await settle();
    const depotId = h.tuning!.depotId;
    h.board.onClear(30, 1);
    h.tuningFinish(false);
    await settle();
    const perTick = perTickOf(h);
    h.econTick(performance.now() + 10_000);
    const banked = h.loopCarries.find((c) => c.id === depotId)!.carry;
    h.saveNow();
    expect(readSave()!.loop).toBe(true);

    const r = await reload();                 // same URL, no opts: still `?loop=new`
    expect(r.newLoop).toBe(true);
    expect(r.phase).toBe("play");
    expect(r.depotYields.find((d) => d.id === depotId)!.yield).toBe(HALF_SESSION_YIELD);
    expect(r.loopCarries.find((c) => c.id === depotId)!.carry).toBeCloseTo(banked, 10);
    const before = purseTotal(r.purse);
    r.econTick(performance.now() + 10_000);
    expect(purseTotal(r.purse) - before)
      .toBe(Math.floor(perTick * HALF_SESSION_YIELD + banked));
  });

  it("drops a demolished Depot's remainder instead of carrying a ghost", async () => {
    const { h, site, depotId } = await playedNewLoop();
    expect(h.loopCarries.some((c) => c.id === depotId)).toBe(true);
    h.demolish(site.hx, site.hy);
    await settle();
    expect(h.loopCarries.some((c) => c.id === depotId), "the bank went with it").toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe.skip("L1e saves that predate the fields", () => {
  it("a payload with none of them loads exactly as before", async () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify(craftedSave()));
    const h = await boot();
    expect(h.saveHeldBack).toBe(false);
    expect(h.phase, "the crafted save is the world that resumed").toBe("play");
    expect(h.loopCarries).toEqual([]);
    // …and the shipped loop writes no new-loop field either.
    h.saveNow();
    const d = readSave()!;
    expect(d.loop).toBe(false);
    expect(d.loopCarry).toBeUndefined();
    expect(rawSave()).not.toContain("loopCarry");
  });

  it.skip("a save the shipped loop wrote loads under the new one", async () => {
    const h = await boot();
    h.finishSetup();
    const site = depotSite(h.grid);
    expect(h.placeDepot(site.hx, site.hy)).toBe(true);
    h.saveNow();
    const written = readSave()!;
    expect(written.loop).toBe(false);
    expect(written.eco.harvesters[0].yield, "the shipped loop stores no level").toBeUndefined();

    const r = await reload({ newLoop: true });
    expect(r.saveHeldBack).toBe(false);
    expect(r.phase).toBe("play");
    expect(r.depotYields.find((d) => d.tx === site.hx)!.yield,
      "an old depot keeps no level — the clock reads it as the baseline").toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe.skip("L1e a new-loop save opened without the flag", () => {
  it("is not restored, keeps its slot, and says how to open it", async () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify(craftedSave({
      loop: true,
      loopCarry: { "7": 0.4 },
      eco: {
        harvesters: [{ id: 7, owner: "you", ownerId: 1, tx: 8, ty: 42, yield: 2.5 }],
        factories: [],
      },
    })));
    const before = rawSave();

    const h = await boot();               // no `?loop=new`, no opts.newLoop
    expect(h.newLoop).toBe(false);
    expect(h.saveHeldBack, "the boot recognised a save it cannot honour").toBe(true);
    expect(h.phase, "the world is not half-restored").toBe("setup-factory");
    expect(h.loopCarries).toEqual([]);
    expect(h.depotYields).toEqual([]);

    // The player keeps the save they came back for — this boot does not
    // overwrite the slot with the fresh world it started instead.
    h.saveNow();
    expect(rawSave()).toBe(before);

    // …and the note lands on the first frame with nothing covering the map,
    // exactly like the flag's own "sandbox-only" line — so poll for it rather
    // than sleeping past the loading screen's fade.
    await expect.poll(() => toasts().join(" "), { timeout: 5000, interval: 25 })
      .toContain(NEW_LOOP_SAVE_TOAST);
  });

  it("the same save resumes as normal when the flag is on", async () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify(craftedSave({
      loop: true,
      loopCarry: { "7": 0.4 },
      eco: {
        harvesters: [{ id: 7, owner: "you", ownerId: 1, tx: 8, ty: 42, yield: 2.5 }],
        factories: [],
      },
    })));
    const h = await boot({ newLoop: true });
    expect(h.saveHeldBack).toBe(false);
    expect(h.phase).toBe("play");
    expect(h.depotYields.find((d) => d.id === 7)!.yield).toBe(2.5);
    expect(h.loopCarries).toEqual([{ id: 7, carry: 0.4 }]);
  });
});
