// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// L7 (#221) — vehicles are visual; speed reflects the tick rate.
//
// The acceptance block this file pins, in the order the ticket writes it:
//
//   • every connected depot shows a moving vehicle; disconnecting stops it;
//   • vehicle speed visibly correlates with the depot's output rate
//     (`yield × distance × transport`);
//   • with vehicles disabled (`__iso.setLorries(false)` / `setVehicles(false)`),
//     income is unchanged.
//
// Also pins the decoupling the status check called out: ambient cars keep
// their own `CAR_SPEED` so a depot-rate retune cannot drag town traffic with
// it.
//
// Pure fixtures cover the planner / integrator; the booted-game block covers
// the live loop (replan on network change, the debug gate, the clock).
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { BASE_RATE, TUNING } from "../../src/iso/config";
import { depotRate, distanceFactor, transportFactor, depotYield } from "../../src/iso/loop";
import {
  TRUCK_SPEED, createTruckState, planTrucks, tickTrucks, truckRateMultOf,
  type Truck,
} from "../../src/iso/vehicles";
import { CAR_SPEED } from "../../src/iso/cars";
import {
  generateMap, WATER, GRASS, type Grid, type Industry,
} from "../../src/iso/grid";
import {
  createTrack, seedTownRoads, seedPublicRoads, buildTile, demolishTile,
  PRESENT, type Track,
} from "../../src/iso/track";
import type { EconomyState, Harvester } from "../../src/iso/economy";
import { MAP_W, MAP_H, setRng, mulberry32 } from "../../src/game/config";
import { southLotFree } from "./helpers/depot-lot";

const TICK = 1 / TRUCK_SPEED; // ms per tile at rateMult 1 on gravel

// ── stub the art imports (vite handles these in the browser) ──────────────
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

// ── pure fixtures ─────────────────────────────────────────────────────────
const CORRIDOR_DEPOT = { tx: 9, ty: 8, facing: "sw" as const };

function pave(t: Track, owner: number, tiles: [number, number][]) {
  for (const [x, y] of tiles) buildTile(t, "dirt", x, y, owner);
}

function corridorEco(extra?: Partial<Harvester>): EconomyState {
  const g = generateMap(1337);
  const track = createTrack();
  seedTownRoads(track, g);
  seedPublicRoads(track, g);
  pave(track, 1, [[10, 10], [10, 11], [10, 12]]);
  return {
    grid: g, track,
    harvesters: [{ id: 1, owner: "you", ownerId: 1, ...CORRIDOR_DEPOT, ...extra }],
    factories: [{ owner: "you", ownerId: 1, tx: 10, ty: 13 }],
  };
}

function truckAt(rateMult: number, extras: Partial<Truck> = {}): Truck {
  return {
    ownerId: 1, depotId: 1, factory: [4, 0],
    route: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
    rateMult, leg: 0, t: 0, reverse: false, deliveries: 0, waitMs: 0,
    ...extras,
  };
}

const progress = (t: Truck): number => t.leg + t.t;

describe("L7 (#221) CAR_SPEED is not tied to the lorries", () => {
  it("is a standalone constant — cars.ts does not import the lorry pace", () => {
    const src = readFileSync("src/iso/cars.ts", "utf8");
    expect(src).not.toMatch(/from ["']\.\/vehicles["']/);
    expect(CAR_SPEED).toBe(1 / 600);
    // Today's gravel lorry happens to share the number; the BINDING is what
    // this pins. A later retune of TRUCK_SPEED must not move the streets.
    expect(CAR_SPEED).toBe(TRUCK_SPEED);
  });
});

describe("L7 (#221) depotRate is yield × distance × transport", () => {
  it("multiplies the three clock seams, nothing else", () => {
    const h: Harvester = {
      id: 1, owner: "you", ownerId: 1, tx: 0, ty: 0, facing: "sw", yield: 2,
    };
    expect(depotYield(h)).toBe(2);
    expect(transportFactor(h)).toBe(1);
    expect(depotRate(h, 1.0)).toBe(2);
    expect(depotRate(h, 0.5)).toBe(1);
    expect(depotRate(h, 0.7)).toBeCloseTo(1.4);
  });

  it("an untuned depot is the baseline yield, not zero", () => {
    const h: Harvester = { id: 1, owner: "you", ownerId: 1, tx: 0, ty: 0, facing: "sw" };
    expect(depotRate(h, 1)).toBe(TUNING.minYield);
  });
});

describe("L7 (#221) planTrucks: one lorry per connected depot", () => {
  it("sends a lorry down a connected depot's road", () => {
    const eco = corridorEco();
    const trucks = planTrucks(eco);
    expect(trucks).toHaveLength(1);
    expect(trucks[0].depotId).toBe(1);
    expect(trucks[0].route.length).toBeGreaterThan(1);
    expect(trucks[0].rateMult).toBe(depotRate(eco.harvesters[0], distanceFactor(eco, eco.harvesters[0])));
  });

  it("stamps rateMult from the depot's live yield × distance × transport", () => {
    const eco = corridorEco({ yield: 2 });
    const [truck] = planTrucks(eco);
    // The corridor is a handful of tiles — near band, ×1.0 — so rate = 2 × 1 × 1.
    expect(distanceFactor(eco, eco.harvesters[0])).toBe(1);
    expect(truck.rateMult).toBe(2);
  });

  it("gives every connected depot its own lorry, and none to a disconnected one", () => {
    const g = generateMap(1337);
    const track = createTrack();
    seedTownRoads(track, g);
    seedPublicRoads(track, g);
    pave(track, 1, [[10, 10], [10, 11], [10, 12]]);
    pave(track, 1, [[20, 10], [20, 11], [20, 12]]);
    const eco: EconomyState = {
      grid: g, track, harvesters: [
        { id: 3, owner: "you", ownerId: 1, ...CORRIDOR_DEPOT },
        { id: 7, owner: "you", ownerId: 1, tx: 19, ty: 8, facing: "sw" },
      ], factories: [
        { owner: "you", ownerId: 1, tx: 10, ty: 13 },
        { owner: "you", ownerId: 1, tx: 20, ty: 13 },
      ],
    };
    expect(planTrucks(eco).map((t) => t.depotId).sort()).toEqual([3, 7]);

    // Cut depot 3's road: that lorry vanishes, depot 7 keeps driving.
    demolishTile(track, "dirt", 10, 11);
    const after = planTrucks(eco);
    expect(after).toHaveLength(1);
    expect(after[0].depotId).toBe(7);

    // Mend it: both run again.
    buildTile(track, "dirt", 10, 11, 1);
    expect(planTrucks(eco).map((t) => t.depotId).sort()).toEqual([3, 7]);
  });

  it("sends no lorry to an unserviced depot", () => {
    const g = generateMap(1337);
    const eco: EconomyState = {
      grid: g, track: createTrack(),
      harvesters: [{ id: 1, owner: "you", ownerId: 1, ...CORRIDOR_DEPOT }],
      factories: [{ owner: "you", ownerId: 1, tx: 10, ty: 13 }],
    };
    expect(planTrucks(eco)).toEqual([]);
  });
});

describe("L7 (#221) tickTrucks: speed ∝ the depot's rate", () => {
  it("a rateMult of 2 covers twice the ground of rateMult 1", () => {
    const slow = createTruckState();
    const fast = createTruckState();
    slow.trucks.push(truckAt(1));
    fast.trucks.push(truckAt(2));
    tickTrucks(slow, TICK / 2);
    tickTrucks(fast, TICK / 2);
    expect(progress(slow.trucks[0])).toBeCloseTo(0.5, 5);
    expect(progress(fast.trucks[0])).toBeCloseTo(1.0, 5);
    expect(progress(fast.trucks[0])).toBeCloseTo(2 * progress(slow.trucks[0]), 5);
  });

  it("a far depot (×0.5) crawls at half the near depot's pace", () => {
    const near = createTruckState();
    const far = createTruckState();
    near.trucks.push(truckAt(1.0));
    far.trucks.push(truckAt(0.5));
    tickTrucks(near, TICK);
    tickTrucks(far, TICK);
    expect(progress(near.trucks[0])).toBeCloseTo(1.0, 5);
    expect(progress(far.trucks[0])).toBeCloseTo(0.5, 5);
  });

  it("a truck without rateMult still drives the pre-L7 pace (saves / tests)", () => {
    const state = createTruckState();
    state.trucks.push(truckAt(undefined as unknown as number, { rateMult: undefined }));
    expect(truckRateMultOf(state.trucks[0])).toBe(1);
    tickTrucks(state, TICK / 2);
    expect(state.trucks[0].t).toBeCloseTo(0.5);
  });
});

// ── the booted game ───────────────────────────────────────────────────────
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

interface L7Hook {
  readonly newLoop: boolean;
  phase: string;
  grid: Grid;
  track: Track;
  eco: EconomyState;
  purse: Record<string, number>;
  readonly trucksList: Truck[];
  readonly lorriesEnabled: boolean;
  finishSetup: () => void;
  econTick: (now?: number) => void;
  rescore: () => void;
  truckTick: (now?: number, dtMs?: number) => void;
  setLorries: (on: boolean) => boolean;
  setVehicles: (on: boolean) => boolean;
  setTraffic: (count: number) => string[];
}

const hook = () => (window as unknown as { __iso: L7Hook }).__iso;
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

interface Corridor { hx: number; hy: number; fy: number; len: number; ind: Industry }

function findCorridors(h: L7Hook, len: number, type: string): Corridor[] {
  const out: Corridor[] = [];
  for (const ind of h.grid.industries) {
    if (ind.type !== type) continue;
    for (let x = ind.tx; x < ind.tx + ind.w; x++) {
      const hx = x, hy = ind.ty + ind.h + 1;
      const fy = hy + len;
      if (hy < 1 || fy + 3 >= MAP_H || hx < 2 || hx + 3 >= MAP_W) continue;
      let ok = true;
      for (let y = hy; y <= fy; y++) {
        const i = y * MAP_W + hx;
        if (h.grid.terrain[i] === WATER || h.grid.occupancy[i] !== -1) { ok = false; break; }
        if (((h.track.dirt[i] | h.track.road[i]) & PRESENT) !== 0) { ok = false; break; }
      }
      for (let dy = 0; dy < 3 && ok; dy++) for (let dx = 0; dx < 3 && ok; dx++) {
        const i = (fy + dy) * MAP_W + (hx + dx);
        if (h.grid.terrain[i] === WATER || h.grid.occupancy[i] !== -1) ok = false;
      }
      if (ok && !southLotFree(h.grid, hx, hy)) ok = false;
      if (ok) out.push({ hx, hy, fy, len, ind });
    }
  }
  return out;
}

function buildCorridor(h: L7Hook, id: number, factoryId: number, c: Corridor) {
  h.eco.factories.push({ owner: "you", ownerId: 1, tx: c.hx, ty: c.fy, id: factoryId, townId: null });
  h.eco.harvesters.push({ id, owner: "you", ownerId: 1, tx: c.hx, ty: c.hy - 1, facing: "sw" });
  for (let y = c.hy + 1; y <= c.fy; y++) buildTile(h.track, "dirt", c.hx, y, 1);
}

describe("L7 (#221) the live loop: connected depots show a moving vehicle", () => {
  it("plans a lorry for a connected depot and drops it when the road is cut", async () => {
    const h = await boot({ newLoop: true });
    const corridors = findCorridors(h, 5, "farm");
    expect(corridors.length, "seed 1337 offers a farm corridor").toBeGreaterThan(0);
    const c = corridors[0];
    buildCorridor(h, 1, 0, c);
    h.rescore();
    h.finishSetup();
    h.truckTick(performance.now(), 0);
    expect(h.trucksList).toHaveLength(1);
    expect(h.trucksList[0].depotId).toBe(1);
    expect(h.trucksList[0].route.length).toBeGreaterThan(1);

    const before = { leg: h.trucksList[0].leg, t: h.trucksList[0].t, reverse: h.trucksList[0].reverse };
    h.truckTick(performance.now(), TICK);
    const after = h.trucksList[0];
    expect(after.leg + after.t !== before.leg + before.t || after.reverse !== before.reverse,
      "the lorry actually moved").toBe(true);

    demolishTile(h.track, "dirt", c.hx, c.hy + 2);
    h.rescore();
    h.truckTick(performance.now(), 0);
    expect(h.trucksList, "disconnecting stops the vehicle").toEqual([]);

    buildTile(h.track, "dirt", c.hx, c.hy + 2, 1);
    h.rescore();
    h.truckTick(performance.now(), 0);
    expect(h.trucksList).toHaveLength(1);
    expect(h.trucksList[0].depotId).toBe(1);
  });

  it("two connected depots at different yields drive at different speeds", async () => {
    const h = await boot({ newLoop: true });
    const farms = findCorridors(h, 5, "farm");
    const forests = findCorridors(h, 5, "forest");
    const a = farms[0];
    const b = forests.find((c) => Math.abs(c.hx - a.hx) >= 5) ?? forests[0];
    expect(a && b, "seed 1337 offers two near corridors").toBeTruthy();
    buildCorridor(h, 1, 0, a);
    buildCorridor(h, 2, 1, b);
    h.eco.harvesters.find((d) => d.id === 1)!.yield = 1;
    h.eco.harvesters.find((d) => d.id === 2)!.yield = 2;
    h.rescore();
    h.finishSetup();
    h.truckTick(performance.now(), 0);
    expect(h.trucksList).toHaveLength(2);
    const slow = h.trucksList.find((t) => t.depotId === 1)!;
    const fast = h.trucksList.find((t) => t.depotId === 2)!;
    expect(slow.rateMult).toBe(1);
    expect(fast.rateMult).toBe(2);

    h.truckTick(performance.now(), TICK / 2);
    const slow2 = h.trucksList.find((t) => t.depotId === 1)!;
    const fast2 = h.trucksList.find((t) => t.depotId === 2)!;
    expect(progress(fast2)).toBeCloseTo(2 * progress(slow2), 4);
  });
});

describe("L7 (#221) income is unchanged with vehicles disabled", () => {
  it("setLorries(false) clears the trucks and the clock pays the same", async () => {
    const h = await boot({ newLoop: true });
    expect(h.newLoop).toBe(true);
    const corridors = findCorridors(h, 5, "farm");
    expect(corridors.length, "seed 1337 offers a farm corridor").toBeGreaterThan(0);
    const c = corridors[0];
    buildCorridor(h, 1, 0, c);
    h.eco.harvesters.find((d) => d.id === 1)!.yield = 2;
    h.rescore();
    h.finishSetup();
    h.truckTick(performance.now(), 1000);
    expect(h.trucksList.length, "the connected depot has a lorry").toBeGreaterThan(0);
    expect(h.lorriesEnabled).toBe(true);

    const before = { ...h.purse };
    let now = performance.now();
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);
    const withLorries = (h.purse.grain ?? 0) - (before.grain ?? 0);
    expect(withLorries).toBe(3 * BASE_RATE * 2 * 1.0);

    // Drive the lorries hard between ticks — they must not pay extra.
    h.truckTick(now, 60_000);
    expect((h.purse.grain ?? 0) - (before.grain ?? 0)).toBe(withLorries);

    expect(h.setLorries(false)).toBe(false);
    expect(h.lorriesEnabled).toBe(false);
    expect(h.trucksList).toEqual([]);
    // The alias the ticket named:
    expect(h.setVehicles(false)).toBe(false);

    const mid = { ...h.purse };
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);
    h.truckTick(now, 60_000);
    const withoutLorries = (h.purse.grain ?? 0) - (mid.grain ?? 0);
    expect(withoutLorries, "income is unchanged with vehicles disabled")
      .toBe(withLorries);

    // Turning them back on must not mint a catch-up payday either.
    expect(h.setLorries(true)).toBe(true);
    expect(h.trucksList.length).toBeGreaterThan(0);
    h.truckTick(now, 60_000);
    expect((h.purse.grain ?? 0) - (mid.grain ?? 0)).toBe(withoutLorries);
  });

  it("setTraffic(0) is cars only — lorries (and income) keep running", async () => {
    const h = await boot({ newLoop: true });
    const corridors = findCorridors(h, 5, "farm");
    const c = corridors[0];
    buildCorridor(h, 1, 0, c);
    h.eco.harvesters.find((d) => d.id === 1)!.yield = 2;
    h.rescore();
    h.finishSetup();
    h.truckTick(performance.now(), 0);
    expect(h.setTraffic(0)).toEqual([]);
    expect(h.trucksList.length, "lorries are not the traffic dial").toBeGreaterThan(0);

    const before = { ...h.purse };
    let now = performance.now();
    h.econTick(now += 10_000);
    expect((h.purse.grain ?? 0) - (before.grain ?? 0)).toBe(BASE_RATE * 2 * 1.0);
  });
});
