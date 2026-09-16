// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// L7 (#221) — vehicles are visual; speed reflects the tick rate.
//
// The acceptance block this file pins, in the order the ticket writes it:
//
//   • every connected Depot shows a moving vehicle, and DISCONNECTING stops
//     it — the plan and the tick, both through the real game module;
//   • vehicle speed VISIBLY correlates with the depot's output rate: a lorry
//     drives at `TRUCK_RATE_SPEED × depotTickRate`, so a tuned depot's lorry
//     outruns an untuned one's over the same frame count, and the pace matches
//     `yield × distance × transport` lorry by lorry;
//   • with every vehicle switched off (`__iso.setVehicles(false)`), income is
//     UNCHANGED — unit test. Not "one lorry fewer": all of them, plus the
//     ambient cars and the trains, while the clock keeps paying exactly what
//     it paid with the traffic running;
//   • the ambient cars' pace is decoupled from the lorries' (the ticket's note:
//     ambient traffic must not move when depot rates do).
//
// Boots the REAL game module in jsdom (canvas stubbed, no pixels asserted), the
// way `iso-l1d-rival-clock.test.ts` and `iso-l3-distance.test.ts` do.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { generateMap, WATER, type Grid, type Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H, CARGOES } from "../../src/iso/config";
import {
  createTrack, buildTile, demolishTile, type Track,
} from "../../src/iso/track";
import { liveTickRate, transportFactor } from "../../src/iso/loop";
import type { EconomyState, Harvester } from "../../src/iso/economy";
import { setRng, mulberry32 } from "../../src/game/config";
import { CAR_SPEED } from "../../src/iso/cars";
import { HARVEST_MS } from "../../src/iso/game";
import {
  TRUCK_SPEED, TRUCK_RATE_SPEED, TRUCK_ROAD_MULT, createTruckState, planTrucks,
  tickTrucks, truckSpeed, type Truck,
} from "../../src/iso/vehicles";

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
interface L7Hook {
  readonly newLoop: boolean;
  phase: string;
  grid: Grid;
  track: Track;
  eco: EconomyState;
  /** The local seat's purse (live object). */
  purse: Record<string, number>;
  readonly trucksList: Truck[];
  /** The lorry integrator: plans on a dirty world, moves, then collects. */
  truckTick: (now?: number, dtMs?: number) => void;
  /** The L1b clock, with an injectable now. */
  econTick: (now?: number) => void;
  /** What a build/demolish's aftermath runs (dirty the lorries, rescore). */
  rescore: () => void;
  finishSetup: () => void;
  /** L7: the all-vehicles switch and its read-only twins. */
  setVehicles: (on: boolean) => boolean;
  readonly vehiclesEnabled: boolean;
  readonly vehicleCount: number;
  readonly depotDistances: { id: number; owner: string; tiles: number | null; factor: number }[];
}

const hook = () => (window as unknown as { __iso: L7Hook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

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

async function boot(opts: { newLoop?: boolean } = {}) {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, opts);
  await settle();
  return hook();
}

// ── module-level fixtures: the pace is a pure function ────────────────────
/**
 * A 2×2 Depot lot with a straight gravel lane south to its Factory — enough
 * for the real planner (`roadPath` from the lot's entrance through
 * `plantShoulders`). The lot's `(10, 10)` is its top corner; its default
 * `sw` entrance looks at `(10, 12)` / `(11, 12)`, which is the lane's head.
 */
function lane(): EconomyState {
  const grid = generateMap(1701);
  const track: Track = createTrack();
  for (let y = 12; y <= 14; y++) buildTile(track, "dirt", 10, y, 1);
  return {
    grid,
    track,
    harvesters: [{ id: 1, owner: "you", ownerId: 1, tx: 10, ty: 10 }],
    factories: [{ owner: "you", ownerId: 1, tx: 10, ty: 15 }],
  };
}

/** One lorry on a straight four-segment route, optionally paced. */
const lorry = (rate?: number): Truck => ({
  ownerId: 1, depotId: rate === undefined ? 1 : 7, factory: [4, 0],
  route: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
  ...(rate === undefined ? { segFast: [false, false, false, false] } : { rate }),
  leg: 0, t: 0, reverse: false, deliveries: 0,
});

/** The pace a lorry with no rate drives at, in ms per tile, on gravel. */
const SHIPPED_TILE_MS = 1 / TRUCK_SPEED;

/** How far along its route a lorry has travelled, in tiles. */
const travelled = (x: Truck): number => x.leg + x.t;

describe("L7 (#221) the pace is the depot's tick rate", () => {
  it("pins the reference pace and the band the rate sweeps it over", () => {
    expect(TRUCK_RATE_SPEED).toBe(1 / 600);
    // Reference rate 1 is the plain untuned Depot next door: no faster than
    // the pace the shipped loop gives a free gravel lane, which is what the
    // ticket asked for ("slower base speed than today"). The two happen to be
    // equal numbers with different owners — a relation, deliberately not an
    // equation (see `TRUCK_RATE_SPEED` in vehicles.ts).
    expect(TRUCK_RATE_SPEED).toBeLessThanOrEqual(TRUCK_SPEED);
    // The fast end of the table: a fully tuned, near Depot (yield 2.5) is
    // quicker than gravel, but its lorry still never matches tarmac.
    expect(TRUCK_RATE_SPEED * 2.5).toBeLessThan(TRUCK_SPEED * TRUCK_ROAD_MULT);
  });

  it("scales the pace by the rate, and only by the rate", () => {
    // rate 1 = one tile per 600 ms; rate 2 = half the time; rate 0.5 = double.
    expect(truckSpeed(lorry(1), 0)).toBe(TRUCK_RATE_SPEED);
    expect(truckSpeed(lorry(2), 0)).toBe(TRUCK_RATE_SPEED * 2);
    expect(truckSpeed(lorry(0.5), 3)).toBe(TRUCK_RATE_SPEED * 0.5);

    // …and the integration agrees: 300 ms at rate 1 is half a tile, at rate
    // 2.5 (the maxed, near depot a tuning session can make) it is 1.25 tiles.
    // (The frame's own unit, whatever the shipped loop's constants do.)
    const one = createTruckState();
    one.trucks.push(lorry(1));
    tickTrucks(one, 300);
    expect(travelled(one.trucks[0])).toBeCloseTo(0.5, 6);

    const tuned = createTruckState();
    tuned.trucks.push(lorry(2.5));
    tickTrucks(tuned, 300);
    expect(travelled(tuned.trucks[0])).toBeCloseTo(1.25, 6);
  });

  it("keeps the shipped pace for a lorry with no rate (flag off, saves)", () => {
    // The shipped model, unchanged: one gravel tile per `SHIPPED_TILE_MS`, and
    // `TRUCK_ROAD_MULT` times as far over the same time on tarmac.
    const gravel = createTruckState();
    gravel.trucks.push(lorry());
    tickTrucks(gravel, SHIPPED_TILE_MS);
    expect(travelled(gravel.trucks[0])).toBeCloseTo(1, 6);

    const tarmac = createTruckState();
    tarmac.trucks.push({ ...lorry(), segFast: [true, true, true, true] });
    tickTrucks(tarmac, SHIPPED_TILE_MS);
    expect(travelled(tarmac.trucks[0])).toBeCloseTo(TRUCK_ROAD_MULT, 6);
    expect(truckSpeed(tarmac.trucks[0], 0)).toBe(TRUCK_SPEED * TRUCK_ROAD_MULT);
    // …and a paced lorry ignores the flags entirely: the rate is the throttle.
    expect(truckSpeed({ ...tarmac.trucks[0], rate: 1, segFast: [true, true, true, true] }, 0))
      .toBe(TRUCK_RATE_SPEED);
  });

  it("treats a bogus rate as no rate rather than freezing the lorry", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const st = createTruckState();
      st.trucks.push({ ...lorry(), rate: bad, segFast: undefined });
      expect(truckSpeed(st.trucks[0], 0), `rate ${bad}`).toBe(TRUCK_SPEED);
      tickTrucks(st, SHIPPED_TILE_MS);
      expect(travelled(st.trucks[0]), `rate ${bad} moved`).toBeCloseTo(1, 6);
    }
  });

  it("plans a rate instead of the per-segment paved flags when asked", () => {
    const eco = lane();
    // No resolver: exactly RV-01/AI-02's plan — speed flags, no rate.
    const shipped = planTrucks(eco)[0];
    expect(shipped.rate).toBeUndefined();
    expect(shipped.segFast).toEqual(shipped.route.slice(0, -1).map(() => false));

    // With a resolver: the lorry carries the number it was handed, and no
    // per-segment flags — one rated pace, not two.
    const paced = planTrucks(eco, { rateFor: () => 2.5 })[0];
    expect(paced.rate).toBe(2.5);
    expect(paced.segFast).toBeUndefined();
    expect(truckSpeed(paced, 0)).toBe(TRUCK_RATE_SPEED * 2.5);
    // the rest of the plan is untouched — same depot, same route
    expect(paced.route).toEqual(shipped.route);
    expect(paced.depotId).toBe(shipped.depotId);
  });

  it("reads the ambient cars from their own constant, not the lorry's", () => {
    // The number ambient traffic kept when the lorries moved to the rate model.
    expect(CAR_SPEED).toBe(1 / 300);
    // …and the coupling itself is gone: `cars.ts` references no lorry speed, so
    // a future retune of the lorries cannot drag the scenery with it.
    const code = readFileSync("src/iso/cars.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")   // drop the prose above the constant
      .replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/\bTRUCK_SPEED\b/);
    expect(code).not.toMatch(/\bTRUCK_RATE_SPEED\b/);
    expect(code).not.toMatch(/from "\.\/vehicles"/);
  });
});

// ── the game: one lorry per connected depot, paced by its rate ────────────
interface Corridor { hx: number; hy: number; fy: number; ind: Industry }

/** Every industry with `len` tiles of open ground south of it, in map order. */
function southCorridors(grid: Grid, len = 6): Corridor[] {
  const out: Corridor[] = [];
  for (const ind of grid.industries) {
    for (let x = ind.tx; x < ind.tx + ind.w; x++) {
      const hx = x, hy = ind.ty + ind.h, fy = hy + len;
      if (hy < 0 || fy >= MAP_H || hx < 0 || hx >= MAP_W) continue;
      let ok = true;
      for (let y = hy; y <= fy; y++) {
        const i = y * MAP_W + hx;
        if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) { ok = false; break; }
      }
      if (ok) out.push({ hx, hy, fy, ind });
    }
  }
  return out;
}

let nextDepotId = 1;

/**
 * One player depot beside `c`'s industry with a straight dirt run to its own
 * Factory at the far end — pushed straight onto the records the way the
 * player-side fixtures in `iso-l1d-rival-clock.test.ts` do (no A*, no purse),
 * then RESCORED, because `rescore` is what marks the lorries dirty for the
 * next `truckTick` (headless harnesses have no rAF).
 */
function connectDepot(h: L7Hook, c: Corridor, yieldLevel?: number): Harvester {
  const depot: Harvester = { id: nextDepotId++, owner: "you", ownerId: 1, tx: c.hx, ty: c.hy };
  if (yieldLevel !== undefined) depot.yield = yieldLevel;
  h.eco.factories.push({ owner: "you", ownerId: 1, tx: c.hx, ty: c.fy, id: 100 + depot.id, townId: null });
  h.eco.harvesters.push(depot);
  for (let y = c.hy + 1; y <= c.fy; y++) buildTile(h.track, "dirt", c.hx, y, 1);
  h.rescore();
  return depot;
}

const lorryOf = (h: L7Hook, depotId: number): Truck | undefined =>
  h.trucksList.find((t) => t.depotId === depotId);

/** Every cargo but Gold: what a depot clock or a cargo match can move. */
const cargoTotal = (p: Record<string, number>): number =>
  CARGOES.filter((c) => c !== "gold").reduce((n, c) => n + (p[c] ?? 0), 0);

describe("L7 (#221) the game's lorries drive their depot's rate", () => {
  it("gives every connected depot a lorry paced by yield × distance × transport", async () => {
    nextDepotId = 1;
    const h = await boot({ newLoop: true });
    expect(h.newLoop).toBe(true);

    const corridors = southCorridors(h.grid);
    expect(corridors.length, "seed 1337 has south corridors").toBeGreaterThan(1);
    const near = connectDepot(h, corridors[0]);
    h.finishSetup();

    const now = performance.now();
    h.truckTick(now, 0);                       // plan only (dt 0 moves nothing)

    const lorryA = lorryOf(h, near.id);
    expect(lorryA, "the connected depot has a lorry").toBeTruthy();

    // The rate IS the depot's tick rate — `depotTickRate`, the same product the
    // clock pays by — and the game's cached distance factor agrees with the
    // uncached BFS `liveTickRate` runs.
    const bandFactor = (id: number) => h.depotDistances.find((d) => d.id === id)!.factor;
    const liveRate = (d: Harvester) => liveTickRate(h.eco, d);
    expect(lorryA!.rate).toBeCloseTo(liveRate(near), 6);
    expect(lorryA!.rate).toBeCloseTo(1 * bandFactor(near.id) * transportFactor(near), 6);
    expect(lorryA!.rate).toBeGreaterThan(0);

    // 600 ms of driving covers exactly `rate` tiles — the pace, not a shrug.
    const startA = travelled(lorryA!);
    h.truckTick(now + 200, 600);
    const movedA = travelled(lorryOf(h, near.id)!) - startA;
    expect(movedA).toBeCloseTo(600 * TRUCK_RATE_SPEED * lorryA!.rate!, 6);

    // A second depot, tuned to the top of the yield table BEFORE it is planned,
    // drives the same 600 ms visibly further: speed tracks the output rate.
    const other = connectDepot(h, corridors[1], 2.5);
    h.truckTick(now + 400, 0);
    const lorryB = lorryOf(h, other.id)!;
    expect(lorryB, "the tuned depot has a lorry").toBeTruthy();
    expect(lorryB.rate).toBeCloseTo(2.5 * bandFactor(other.id) * transportFactor(other), 6);
    expect(lorryB.rate!).toBeGreaterThan(lorryA!.rate!);

    const startB = travelled(lorryB);
    h.truckTick(now + 400, 600);
    const movedB = travelled(lorryOf(h, other.id)!) - startB;
    expect(movedB).toBeCloseTo(600 * TRUCK_RATE_SPEED * lorryB.rate!, 6);
    // one ratio, both ends of the same rule: pace ÷ rate is a constant
    expect(movedB / movedA).toBeCloseTo(lorryB.rate! / lorryA!.rate!, 6);

    // Tuning a depot that already has a lorry replans it — the rate follows the
    // new level, and the lorry keeps its place on the road (no teleport).
    const at = travelled(lorryOf(h, near.id)!);
    near.yield = 2.5;
    h.rescore();                               // the edge a settled session makes
    h.truckTick(now + 600, 0);
    expect(lorryOf(h, near.id)!.rate).toBeCloseTo(2.5 * bandFactor(near.id), 6);
    expect(travelled(lorryOf(h, near.id)!)).toBe(at);
  });

  it("stops the lorry when the connection is cut, and brings it back", async () => {
    nextDepotId = 1;
    const h = await boot({ newLoop: true });
    const c = southCorridors(h.grid)[0];
    const depot = connectDepot(h, c);
    h.finishSetup();

    const now = performance.now();
    h.truckTick(now, 0);
    expect(lorryOf(h, depot.id), "connected ⇒ a lorry").toBeTruthy();

    // Cut the middle of the run the way a demolish does: no route ⇒ no lorry at
    // all (a disconnected depot shows nothing).
    demolishTile(h.track, "dirt", c.hx, c.hy + 2);
    h.rescore();
    h.truckTick(now + 100, 0);
    expect(lorryOf(h, depot.id), "disconnected ⇒ no lorry").toBeUndefined();

    // Mending it brings the lorry back — the map keeps explaining itself.
    buildTile(h.track, "dirt", c.hx, c.hy + 2, 1);
    h.rescore();
    h.truckTick(now + 200, 0);
    expect(lorryOf(h, depot.id), "reconnected ⇒ the lorry returns").toBeTruthy();
  });

  it("pays the same income with every vehicle switched off", async () => {
    nextDepotId = 1;
    const h = await boot({ newLoop: true });
    const c = southCorridors(h.grid)[0];
    const depot = connectDepot(h, c);
    h.finishSetup();

    let now = performance.now();
    h.truckTick(now, 0);                       // plan the lorry

    // The switch really is on: there are vehicles to draw…
    h.setVehicles(true);
    expect(h.vehiclesEnabled).toBe(true);
    expect(h.vehicleCount, "lorries (and ambient traffic) are in the draw list")
      .toBeGreaterThan(0);

    // …and they MOVED while driving: real frames of dt, so the lorries cover
    // ground and reach the Factory end. On the new loop those arrivals are
    // animation — the purse must not budge for them (L1c, restated here where
    // the claim is load-bearing). One one-way trip at this lorry's own pace,
    // in 100 ms frames — the frame loop's own dt cap.
    const purseBeforeDriving = cargoTotal(h.purse);
    const lorry0 = lorryOf(h, depot.id)!;
    const startPos = travelled(lorry0);
    const trip = lorry0.route.length / truckSpeed(lorry0, 0);
    for (let ms = 0; ms <= trip + 100; ms += 100) h.truckTick(now + ms, 100);
    expect(travelled(lorryOf(h, depot.id)!), "the lorry drove").not.toBe(startPos);
    expect(lorryOf(h, depot.id)!.deliveries, "…and reached the factory end")
      .toBeGreaterThan(0);
    expect(cargoTotal(h.purse) - purseBeforeDriving, "lorry arrivals pay nothing")
      .toBe(0);

    // Three clock ticks with the traffic running.
    const beforeWith = cargoTotal(h.purse);
    for (let i = 0; i < 3; i++) h.econTick(now += HARVEST_MS * 4);
    const withVehicles = cargoTotal(h.purse) - beforeWith;
    expect(withVehicles, "the connected depot is being paid").toBeGreaterThan(0);

    // Vehicles OFF: nothing planned, nothing moving, nothing drawn…
    const parkedAt = travelled(lorryOf(h, depot.id)!);
    expect(h.setVehicles(false)).toBe(false);
    expect(h.vehiclesEnabled).toBe(false);
    expect(h.vehicleCount, "no vehicles in the draw list").toBe(0);
    for (let i = 1; i <= 20; i++) h.truckTick(now + i * 100, 100);
    expect(travelled(lorryOf(h, depot.id)!), "no lorry moved with the switch off")
      .toBe(parkedAt);

    // …and the clock pays EXACTLY what it paid while they were running.
    const beforeWithout = cargoTotal(h.purse);
    for (let i = 0; i < 3; i++) h.econTick(now += HARVEST_MS * 4);
    const withoutVehicles = cargoTotal(h.purse) - beforeWithout;
    expect(withoutVehicles, "income with every vehicle disabled").toBe(withVehicles);
    expect(cargoTotal(h.purse) - beforeWith, "the same three ticks, twice")
      .toBe(withVehicles + withoutVehicles);

    // Switched back on the traffic resumes, from where it stood.
    h.setVehicles(true);
    expect(h.vehicleCount).toBeGreaterThan(0);
    const resumedAt = travelled(lorryOf(h, depot.id)!);
    for (let i = 1; i <= 10; i++) h.truckTick(now + i * 100, 100);
    expect(travelled(lorryOf(h, depot.id)!), "the lorry drives again").not.toBe(resumedAt);
  });
});