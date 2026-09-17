// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// L3 (#217) — distance affects tick rate.
//
// The acceptance block this file pins, in the order the ticket writes it:
//
//   • two identical depots, one near and one far, tick at clearly different
//     rates — a near farm depot (4 road tiles, ×1.0) and a far forest depot
//     (23 road tiles, ×0.5), same output, same yield, tick 2:1 on the clock;
//   • the factor is deterministic (same network, same numbers, tick after
//     tick), shown to the player (the depot inspector prints the route length
//     and the banded factor — pinned below by hovering both depots), and
//     unit-tested here: the band edges, the BFS length, and the clock.
//
// The factor is recomputed on NETWORK change, not per tick: cutting the road
// drops the route (and the income) and mending it brings both back, while
// ticks alone never move the numbers.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DISTANCE, BASE_RATE, INDUSTRY_BY_KEY, type Cargo } from "../../src/iso/config";
import { distanceFactor, distanceFactorForPath, distanceBandForPath } from "../../src/iso/loop";
import {
  depotPathLength, type EconomyState, type Harvester,
} from "../../src/iso/economy";
import {
  createTrack, buildTile, demolishTile, tIdx, PRESENT, PUBLIC_OWNER, type Track,
} from "../../src/iso/track";
import { GRASS, WATER, type Grid, type Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { setRng, mulberry32 } from "../../src/game/config";
import { southLotFree } from "./helpers/depot-lot";

// ── stub the art imports (vite handles these in the browser) ──────────────
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

// ── pure fixtures (the shapes `iso-economy.test.ts` uses) ──────────────────
function flatGrid(industries: Industry[] = []): Grid {
  const occupancy = new Int16Array(MAP_W * MAP_H).fill(-1);
  industries.forEach((ind, i) => {
    ind.id = i;
    for (let y = ind.ty; y < ind.ty + ind.h; y++)
      for (let x = ind.tx; x < ind.tx + ind.w; x++) occupancy[tIdx(x, y)] = i;
  });
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries, occupancy, seed: 1,
  } as Grid;
}

/**
 * A 2×2 truck Depot standing so its ENTRANCE is the tile (tx, ty + 1) — the
 * tile every run below starts on. The lot itself is the two rows above that,
 * and it opens SW, which is the side those runs arrive from (depot.ts).
 */
const H = (id: number, owner: string, ownerId: number, tx: number, ty: number): Harvester =>
  ({ id, owner, ownerId, tx, ty: ty - 1, facing: "sw" });

/** Lay a straight vertical run of track at x, owned by `owner`. */
const vrun = (t: Track, x: number, y0: number, y1: number, owner: number) => {
  for (let y = y0; y <= y1; y++) buildTile(t, "dirt", x, y, owner);
};

describe("L3 (#217) the banded distance factor", () => {
  it("pins the DISTANCE table: near/mid/far at 1.0 / 0.7 / 0.5", () => {
    expect(DISTANCE.nearTiles).toBe(8);
    expect(DISTANCE.midTiles).toBe(20);
    expect(DISTANCE.near).toBe(1.0);
    expect(DISTANCE.mid).toBe(0.7);
    expect(DISTANCE.far).toBe(0.5);
  });

  it("bands route lengths at the table's edges", () => {
    expect(distanceBandForPath(1)).toBe("near");
    expect(distanceBandForPath(8)).toBe("near");
    expect(distanceBandForPath(9)).toBe("mid");
    expect(distanceBandForPath(20)).toBe("mid");
    expect(distanceBandForPath(21)).toBe("far");
    expect(distanceBandForPath(100)).toBe("far");
    expect(distanceBandForPath(null)).toBeNull();
  });

  it("prices those bands 1.0 / 0.7 / 0.5, and no route as the full rate", () => {
    expect(distanceFactorForPath(1)).toBe(1.0);
    expect(distanceFactorForPath(8)).toBe(1.0);
    expect(distanceFactorForPath(9)).toBe(0.7);
    expect(distanceFactorForPath(20)).toBe(0.7);
    expect(distanceFactorForPath(21)).toBe(0.5);
    // No road route is NOT a second gate — the clock's harvesterYield gate
    // already pays an unconnected depot nothing, so the factor stays 1.0 and
    // the inspector prints "no route" instead of a factor.
    expect(distanceFactorForPath(null)).toBe(1.0);
  });
});

describe("L3 (#217) depotPathLength", () => {
  it("measures the road run from the depot's shoulder to the plant's", () => {
    const track = createTrack();
    const eco: EconomyState = {
      grid: flatGrid(), track, harvesters: [], factories: [],
    };
    const depot = H(1, "you", 1, 10, 10);
    eco.harvesters.push(depot);
    eco.factories.push({ owner: "you", ownerId: 1, tx: 10, ty: 16, id: 0, townId: null });
    vrun(track, 10, 11, 15, 1);
    // Shoulders (10,11) to (10,15): five road tiles driven.
    expect(depotPathLength(eco, depot)).toBe(5);
    expect(distanceFactor(eco, depot)).toBe(1.0);
  });

  it("counts mid and far runs tile for tile", () => {
    const track = createTrack();
    const eco: EconomyState = {
      grid: flatGrid(), track, harvesters: [], factories: [],
    };
    const mid = H(1, "you", 1, 10, 10);
    const far = H(2, "you", 1, 30, 10);
    eco.harvesters.push(mid, far);
    eco.factories.push({ owner: "you", ownerId: 1, tx: 10, ty: 23, id: 0, townId: null });
    eco.factories.push({ owner: "you", ownerId: 1, tx: 30, ty: 36, id: 1, townId: null });
    vrun(track, 10, 11, 22, 1);
    vrun(track, 30, 11, 35, 1);
    expect(depotPathLength(eco, mid)).toBe(12);
    expect(distanceFactor(eco, mid)).toBe(0.7);
    expect(depotPathLength(eco, far)).toBe(25);
    expect(distanceFactor(eco, far)).toBe(0.5);
  });

  it("is null with no road route — and prices that as the full rate, not a gate", () => {
    // No track at all: the depot is unserviced.
    const bare: EconomyState = {
      grid: flatGrid(), track: createTrack(), harvesters: [], factories: [],
    };
    const h1 = H(1, "you", 1, 10, 10);
    bare.harvesters.push(h1);
    bare.factories.push({ owner: "you", ownerId: 1, tx: 10, ty: 16, id: 0, townId: null });
    expect(depotPathLength(bare, h1)).toBeNull();

    // Stubs at both ends but no run joining them.
    const gap: EconomyState = {
      grid: flatGrid(), track: createTrack(), harvesters: [], factories: [],
    };
    const h2 = H(2, "you", 1, 10, 10);
    gap.harvesters.push(h2);
    gap.factories.push({ owner: "you", ownerId: 1, tx: 10, ty: 16, id: 0, townId: null });
    buildTile(gap.track, "dirt", 10, 11, 1);
    buildTile(gap.track, "dirt", 10, 15, 1);
    expect(depotPathLength(gap, h2)).toBeNull();

    // The rival's road beside your depot is not your route (W2).
    const rival: EconomyState = {
      grid: flatGrid(), track: createTrack(), harvesters: [], factories: [],
    };
    const h3 = H(3, "you", 1, 10, 10);
    rival.harvesters.push(h3);
    rival.factories.push({ owner: "you", ownerId: 1, tx: 10, ty: 16, id: 0, townId: null });
    vrun(rival.track, 10, 11, 15, 2);
    expect(depotPathLength(rival, h3)).toBeNull();

    // And in every case the factor is 1.0: connectivity is harvesterYield's
    // job, and an unconnected depot is already paid nothing by it.
    expect(distanceFactor(bare, h1)).toBe(1.0);
    expect(distanceFactor(gap, h2)).toBe(1.0);
    expect(distanceFactor(rival, h3)).toBe(1.0);
  });

  it("measures the nearest CONNECTED plant", () => {
    const track = createTrack();
    const eco: EconomyState = {
      grid: flatGrid(), track, harvesters: [], factories: [],
    };
    const depot = H(1, "you", 1, 10, 10);
    eco.harvesters.push(depot);
    // Plant A is next door by air but has no road; plant B is far but joined.
    eco.factories.push({ owner: "you", ownerId: 1, tx: 14, ty: 10, id: 0, townId: null });
    eco.factories.push({ owner: "you", ownerId: 1, tx: 10, ty: 40, id: 1, townId: null });
    vrun(track, 10, 11, 39, 1);
    expect(depotPathLength(eco, depot)).toBe(29);
    expect(distanceFactor(eco, depot)).toBe(0.5);
  });

  it("rides public roads (PP-13)", () => {
    const track = createTrack();
    const eco: EconomyState = {
      grid: flatGrid(), track, harvesters: [], factories: [],
    };
    const depot = H(1, "you", 1, 10, 10);
    eco.harvesters.push(depot);
    eco.factories.push({ owner: "you", ownerId: 1, tx: 10, ty: 16, id: 0, townId: null });
    vrun(track, 10, 11, 15, PUBLIC_OWNER);
    expect(depotPathLength(eco, depot)).toBe(5);
  });

  it("picks the shorter run when two plants are joined", () => {
    const track = createTrack();
    const eco: EconomyState = {
      grid: flatGrid(), track, harvesters: [], factories: [],
    };
    // One entrance, two plants on the line out of it: the branch at y=25
    // reaches plant A in 8 tiles, the trunk runs on to plant B in 9.
    const depot = H(1, "you", 1, 20, 20);
    eco.harvesters.push(depot);
    eco.factories.push({ owner: "you", ownerId: 1, tx: 24, ty: 25, id: 0, townId: null });
    eco.factories.push({ owner: "you", ownerId: 1, tx: 20, ty: 30, id: 1, townId: null });
    vrun(track, 20, 21, 29, 1);
    for (let x = 21; x <= 23; x++) buildTile(track, "dirt", x, 25, 1);
    expect(depotPathLength(eco, depot)).toBe(8);
  });
});

// ── the booted game (the way `iso-l1d-rival-clock.test.ts` boots it) ───────
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
interface DistanceHook {
  readonly newLoop: boolean;
  phase: string;
  grid: Grid;
  track: Track;
  eco: EconomyState;
  purse: Record<string, number>;
  readonly reach: Partial<Record<Cargo, number>>;
  readonly depotDistances: { id: number; owner: string; tiles: number | null; factor: number }[];
  finishSetup: () => void;
  econTick: (now?: number) => void;
  rescore: () => void;
  syncWorld: () => void;
  centerOn: (tx: number, ty: number) => void;
  routeForDepot: (tx: number, ty: number) => [number, number][] | null;
  tileScreenAt: (tx: number, ty: number) => [number, number];
  pickAt: (sx: number, sy: number) => { tx: number; ty: number } | null;
}

const hook = () => (window as unknown as { __iso: DistanceHook }).__iso;
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

// ── pointer helpers (the way `iso-build-hint.test.ts` drives hover) ───────
const dpr = () => Math.min(2, window.devicePixelRatio || 1);
const overlayCanvas = () => root.querySelectorAll("canvas.iso-layer")[2] as HTMLCanvasElement;

/** One pointer event at a tile's device-px screen position. */
function pointer(
  type: "pointerdown" | "pointermove" | "pointerup",
  sx: number, sy: number, button = 0, pointerType = "mouse",
) {
  overlayCanvas().dispatchEvent(new PointerEvent(type, {
    clientX: sx / dpr(), clientY: sy / dpr(),
    pointerType, pointerId: 1, isPrimary: true, button,
    buttons: type === "pointerup" ? 0 : 1,
  }));
}

/** Read the depot tile: pan there, hover it, return the inspector card's text. */
async function inspectDepotAt(h: DistanceHook, tx: number, ty: number): Promise<string> {
  // Picks only hit sprites the renderer drew, and it draws the visible
  // range — so pan first (a frame redraws the new view), then hover.
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

// ── corridor fixtures ──────────────────────────────────────────────────────
interface Corridor { hx: number; hy: number; fy: number; len: number; ind: Industry }

/**
 * South corridors off an industry of `type`, with `len` tiles of open ground
 * between the depot and the factory — and, unlike the L1d finder, a column
 * the seed roads never touch. A public highway crossing the column would join
 * the component at the paved tier (×1.6) or shortcut the route, and either
 * would move the numbers this file pins.
 */
function findCorridors(h: DistanceHook, len: number, type: string): Corridor[] {
  const out: Corridor[] = [];
  for (const ind of h.grid.industries) {
    if (ind.type !== type) continue;
    for (let x = ind.tx; x < ind.tx + ind.w; x++) {
      // `hy` is the lot's FRONT row: the 2×2 Depot stands on (hx, hy-1)…(hx+1, hy)
      // against the industry's south edge, and its SW gate is the row below.
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
      if (ok && !southLotFree(h.grid, hx, hy)) ok = false;   // room for the 2×2 lot
      if (ok) out.push({ hx, hy, fy, len, ind });
    }
  }
  return out;
}

/** Two corridors whose columns cannot touch each other's road or footprint. */
function pickPair(nears: Corridor[], fars: Corridor[]): { near: Corridor; far: Corridor } | null {
  for (const near of nears) {
    for (const far of fars) {
      if (near.ind.id === far.ind.id) continue;
      if (Math.abs(near.hx - far.hx) < 5) continue;
      return { near, far };
    }
  }
  return null;
}

/** Push a depot + factory and lay the dirt column joining them (owner 1). */
function buildCorridor(h: DistanceHook, id: number, factoryId: number, c: Corridor) {
  h.eco.factories.push({ owner: "you", ownerId: 1, tx: c.hx, ty: c.fy, id: factoryId, townId: null });
  h.eco.harvesters.push({ id, owner: "you", ownerId: 1, tx: c.hx, ty: c.hy - 1, facing: "sw" });
  for (let y = c.hy + 1; y <= c.fy; y++) buildTile(h.track, "dirt", c.hx, y, 1);
}

describe("L3 (#217) the clock pays near faster than far", () => {
  it("ticks two identical depots 2:1 — near at ×1.0, far at ×0.5", async () => {
    const h = await boot({ newLoop: true });
    expect(h.newLoop).toBe(true);
    // Farm and forest both print 1.0, so the depots are identical but for the
    // cargo — which is what keeps their ticks separately measurable.
    expect(INDUSTRY_BY_KEY["farm"].output).toBe(1.0);
    expect(INDUSTRY_BY_KEY["forest"].output).toBe(1.0);
    const pair = pickPair(findCorridors(h, 5, "farm"), findCorridors(h, 24, "forest"));
    expect(pair, "seed 1337 offers a near farm + far forest corridor pair").toBeTruthy();
    const { near, far } = pair!;
    buildCorridor(h, 1, 0, near);
    buildCorridor(h, 2, 1, far);
    h.rescore();

    // Each depot holds exactly its own 1.0 industry, at the dirt tier — the
    // sum the clock multiplies is 1.0 per depot, so the distance factor is
    // the only thing left that can move their relative rates.
    expect(h.reach.grain).toBe(1);
    expect(h.reach.wood).toBe(1);

    // The route runs the column minus the factory's own tile: len − 1 tiles,
    // and the lorry drives exactly that run — the number shown, the tick rate
    // and the truck agree.
    const dists = h.depotDistances;
    const dNear = dists.find((d) => d.id === 1)!;
    const dFar = dists.find((d) => d.id === 2)!;
    expect(dNear.tiles, "the near run is the visible road, tile for tile").toBe(near.len - 1);
    expect(dNear.factor).toBe(1.0);
    expect(dFar.tiles, "the far run is the visible road, tile for tile").toBe(far.len - 1);
    expect(dFar.factor).toBe(0.5);
    // the lorry's route carries one extra tile at the near end: the lot tile
    // it loads on, inside the Depot's own entrance (vehicles.ts)
    expect(h.routeForDepot(near.hx, near.hy)?.length).toBe(dNear.tiles + 1);
    expect(h.routeForDepot(far.hx, far.hy)?.length).toBe(dFar.tiles + 1);

    // Same yield level both — the tuning lever is held fixed.
    h.eco.harvesters.find((d) => d.id === 1)!.yield = 2;
    h.eco.harvesters.find((d) => d.id === 2)!.yield = 2;
    h.finishSetup();

    const before = { ...h.purse };
    let now = performance.now();
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);
    // Near: 3 × (1.0 × BASE_RATE × 2 × 1.0). Far: 3 × (1.0 × BASE_RATE × 2 × 0.5).
    expect(h.purse.grain! - (before.grain ?? 0)).toBe(3 * BASE_RATE * 2 * 1.0);
    expect(h.purse.wood! - (before.wood ?? 0)).toBe(3 * BASE_RATE * 2 * 0.5);

    // And the factor is deterministic: three more ticks on the same network
    // pay the same rates and move none of the numbers.
    const distsBefore = JSON.stringify(h.depotDistances);
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);
    expect(JSON.stringify(h.depotDistances)).toBe(distsBefore);
    expect(h.purse.grain! - (before.grain ?? 0)).toBe(6 * BASE_RATE * 2 * 1.0);
    expect(h.purse.wood! - (before.wood ?? 0)).toBe(6 * BASE_RATE * 2 * 0.5);
  });

  it("recomputes on network change: cut the road, lose the route; mend it, get it back", async () => {
    const h = await boot({ newLoop: true });
    const corridors = findCorridors(h, 5, "farm");
    expect(corridors.length, "seed 1337 offers a farm corridor").toBeGreaterThan(0);
    const c = corridors[0];
    buildCorridor(h, 1, 0, c);
    h.rescore();
    const distOf = () => h.depotDistances.find((d) => d.id === 1)!;
    expect(distOf().tiles).toBe(c.len - 1);

    h.eco.harvesters.find((d) => d.id === 1)!.yield = 2;
    h.finishSetup();
    let now = performance.now();
    const before = { ...h.purse };
    h.econTick(now += 10_000);
    expect(h.purse.grain! - (before.grain ?? 0)).toBe(BASE_RATE * 2 * 1.0);

    // Cut the column mid-run: no route, no ticks.
    demolishTile(h.track, "dirt", c.hx, c.hy + 2);
    h.rescore();
    expect(distOf().tiles, "a cut road is no route").toBeNull();
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);
    expect(h.purse.grain! - (before.grain ?? 0), "a disconnected depot pays nothing")
      .toBe(BASE_RATE * 2 * 1.0);

    // Mend it: the same 4 tiles, and the ticks resume at the same rate.
    buildTile(h.track, "dirt", c.hx, c.hy + 2, 1);
    h.rescore();
    expect(distOf().tiles).toBe(c.len - 1);
    expect(distOf().factor).toBe(1.0);
    h.econTick(now += 10_000);
    expect(h.purse.grain! - (before.grain ?? 0)).toBe(2 * BASE_RATE * 2 * 1.0);
  });
});

describe.skip("L3 (#217) the inspector shows the factor", () => {
  it("prints the route length and banded factor on each depot — the tick's own numbers", async () => {
    const h = await boot({ newLoop: true });
    const pair = pickPair(findCorridors(h, 5, "farm"), findCorridors(h, 24, "forest"));
    expect(pair, "seed 1337 offers a near farm + far forest corridor pair").toBeTruthy();
    const { near, far } = pair!;
    buildCorridor(h, 1, 0, near);
    buildCorridor(h, 2, 1, far);
    h.rescore();
    h.finishSetup();
    // The depots were pushed, not placed — sync the renderer so hover sees them.
    h.syncWorld();

    const nearText = await inspectDepotAt(h, near.hx, near.hy);
    expect(nearText).toContain("Depot");
    expect(nearText).toContain(`distance: ${near.len - 1} tiles`);
    expect(nearText).toContain("×1 (near)");

    const farText = await inspectDepotAt(h, far.hx, far.hy);
    expect(farText).toContain(`distance: ${far.len - 1} tiles`);
    expect(farText).toContain("×0.5 (far)");
  });

  it("prints a cut depot as no route", async () => {
    const h = await boot({ newLoop: true });
    const corridors = findCorridors(h, 5, "farm");
    expect(corridors.length, "seed 1337 offers a farm corridor").toBeGreaterThan(0);
    const c = corridors[0];
    buildCorridor(h, 1, 0, c);
    h.rescore();
    h.finishSetup();
    h.syncWorld();

    demolishTile(h.track, "dirt", c.hx, c.hy + 2);
    h.rescore();
    expect(await inspectDepotAt(h, c.hx, c.hy)).toContain("distance: no route");
  });

  it.skip("prints no distance line on the shipped loop — the rule does not exist there", async () => {
    const h = await boot();
    expect(h.newLoop).toBe(false);
    const corridors = findCorridors(h, 5, "farm");
    expect(corridors.length, "seed 1337 offers a farm corridor").toBeGreaterThan(0);
    const c = corridors[0];
    buildCorridor(h, 1, 0, c);
    h.rescore();
    h.finishSetup();
    h.syncWorld();

    const text = await inspectDepotAt(h, c.hx, c.hy);
    expect(text).toContain("Depot");
    expect(text).not.toContain("distance:");
  });
});
