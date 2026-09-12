// @vitest-environment jsdom
//
// Protests: the Black Market roadblock. Bought with Gold, staged on any
// public road, holds ALL lorries before the tile for PROTEST_MS — then the
// road clears and the trucks roll on. The crowd is temp art
// (assets/protest.png, via tools/make-protest-png.mjs).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SABOTAGE, PROTEST_MS, setRng, mulberry32 } from "../../src/game/config";
import { MAP_W, MAP_H } from "../../src/game/config";
import { PUBLIC_OWNER, tIdx } from "../../src/iso/track";
import {
  TRUCK_SPEED, createTruckState, tickTrucks, type Truck,
} from "../../src/iso/vehicles";

// ── stub the art imports (vite handles these in the browser) ──────────────
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));
vi.mock("../../assets/protest.png", () => ({ default: "protest.png" }));

const TICK = 1 / TRUCK_SPEED;   // ms per dirt tile (300)

/** One lorry on a straight 3-tile road, depot end first. */
function straightTruck(patch?: Partial<Truck>): Truck {
  return {
    ownerId: 1, depotId: 1, factory: [2, 0],
    route: [[0, 0], [1, 0], [2, 0]],
    leg: 0, t: 0, reverse: false, deliveries: 0,
    ...patch,
  };
}

describe("tickTrucks holds lorries before a protested tile", () => {
  it("a truck does not enter a blocked tile — it waits where it is", () => {
    const state = createTruckState();
    state.trucks.push(straightTruck());
    tickTrucks(state, TICK * 2, new Set([tIdx(1, 0)]));
    expect(state.trucks[0].leg).toBe(0);
    expect(state.trucks[0].t).toBe(0);
    expect(state.trucks[0].deliveries).toBe(0);
  });

  it("the same truck rolls on once the road clears", () => {
    const state = createTruckState();
    state.trucks.push(straightTruck());
    const blocked = new Set([tIdx(1, 0)]);
    tickTrucks(state, TICK * 2, blocked);       // held at the depot end
    expect(state.trucks[0].t).toBe(0);
    tickTrucks(state, TICK * 2);                 // the crowd is gone
    expect(state.trucks[0].deliveries).toBe(1); // …and the load is delivered
    expect(state.trucks[0].reverse).toBe(true);
  });

  it("holds mid-leg too, and holds the return journey", () => {
    const mid = createTruckState();
    mid.trucks.push(straightTruck({ leg: 0, t: 0.5 }));
    tickTrucks(mid, TICK, new Set([tIdx(1, 0)]));
    expect(mid.trucks[0].t).toBe(0.5);           // frozen between tiles

    const back = createTruckState();
    back.trucks.push(straightTruck({ leg: 1, t: 1, reverse: true, deliveries: 1 }));
    tickTrucks(back, TICK, new Set([tIdx(1, 0)]));
    expect(back.trucks[0].t).toBe(1);            // held at the factory end
    expect(back.trucks[0].deliveries).toBe(1);   // and no phantom delivery
  });

  it("lets a lorry leave a tile that was just protested under it", () => {
    const state = createTruckState();
    state.trucks.push(straightTruck());
    tickTrucks(state, TICK / 2, new Set([tIdx(0, 0)]));   // its own tile: fine
    expect(state.trucks[0].t).toBeCloseTo(0.5, 9);
  });

  it("a truck already on the boundary still completes its arrival", () => {
    const state = createTruckState();
    // Standing AT the destination (leg 1, t 1) when the crowd lands on it.
    state.trucks.push(straightTruck({ leg: 1, t: 1 }));
    tickTrucks(state, 1, new Set([tIdx(2, 0)]));
    expect(state.trucks[0].deliveries).toBe(1);
    expect(state.trucks[0].reverse).toBe(true);
  });

  it("without a blocked set — or an empty one — nothing changes", () => {
    for (const blocked of [undefined, new Set<number>()]) {
      const state = createTruckState();
      state.trucks.push(straightTruck());
      tickTrucks(state, TICK * 2, blocked);
      expect(state.trucks[0].deliveries).toBe(1);
    }
  });
});

// ── the Black Market purchase + placement, through the booted game ─────────
/** A no-op 2D context good enough for the renderer's call pattern. */
function stubCanvas() {
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "canvas") return null;
      if (prop === "imageSmoothingEnabled") return false;
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

interface ProtestHook {
  purse: Record<string, number>;
  grid: import("../../src/iso/grid").Grid;
  track: import("../../src/iso/track").Track;
  armProtest: () => void;
  placeProtest: (tx: number, ty: number) => boolean;
  protests: { tx: number; ty: number; until: number; owner: string }[];
  protestPending: boolean;
  protestTick: (now?: number) => number;
}

const hook = () => (window as unknown as { __iso: ProtestHook }).__iso;

/** Wait for the async atlas load + first frame. */
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
  // TUT-01: the starting tour is the other boot overlay — these tests boot
  // the game, not its onboarding (the tour itself is covered in
  // iso-tutorial.test.ts).
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
  dispose = startIsoGame(root);
  await settle();
  return hook();
}

describe("Black Market protests", () => {
  it("is a Gold sabotage card with a 2-minute clock", () => {
    expect(SABOTAGE.protest.name).toBe("Protest");
    expect(SABOTAGE.protest.gold).toBe(6);
    expect(SABOTAGE.protest.target).toBe("tile");
    expect(SABOTAGE.protest.desc).toMatch(/public road/);
    expect(PROTEST_MS).toBe(120000);
  });

  it("the Black Market lists a Protest button", async () => {
    await boot();
    await settle();
    const b = root.querySelector('[data-black="protest"]') as HTMLElement;
    expect(b).toBeTruthy();
    expect(b.textContent).toMatch(/Protest/);
  });

  it("buying arms placement; staging on a public road charges the Gold", async () => {
    const h = await boot();
    h.purse.gold = 10;
    await settle();
    h.armProtest();
    expect(h.protestPending).toBe(true);
    expect(h.purse.gold).toBe(10);   // charged on placement, not on arming
    const [px, py] = h.grid.publicRoads![0];
    expect(h.placeProtest(px, py)).toBe(true);
    expect(h.protestPending).toBe(false);
    expect(h.purse.gold).toBe(10 - SABOTAGE.protest.gold);
    expect(h.protests).toHaveLength(1);
    expect(h.protests[0].tx).toBe(px);
    expect(h.protests[0].ty).toBe(py);
  });

  it("refuses anything that is not a free public road, and stays armed", async () => {
    const h = await boot();
    h.purse.gold = 10;
    h.armProtest();
    let nx = 0, ny = 0;
    outer: for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      if (h.track.owner[tIdx(x, y)] !== PUBLIC_OWNER) { nx = x; ny = y; break outer; }
    }
    expect(h.placeProtest(nx, ny)).toBe(false);
    expect(h.protestPending).toBe(true);   // still armed
    expect(h.purse.gold).toBe(10);         // nothing charged
    const [px, py] = h.grid.publicRoads![0];
    expect(h.placeProtest(px, py)).toBe(true);
    h.purse.gold = 10;
    h.armProtest();                        // a second crowd…
    expect(h.placeProtest(px, py)).toBe(false);  // …cannot take the same tile
    expect(h.protestPending).toBe(true);
    expect(h.purse.gold).toBe(10);         // a refused staging charges nothing
  });

  it("without Gold there is no protest and no charge", async () => {
    const h = await boot();
    h.purse.gold = 0;
    h.armProtest();
    expect(h.protestPending).toBe(false);
    const [px, py] = h.grid.publicRoads![0];
    h.purse.gold = 0;
    // Even staged directly, a broke buyer is refused.
    expect(h.placeProtest(px, py)).toBe(false);
    expect(h.protests).toHaveLength(0);
  });

  it("the road clears when the clock runs out", async () => {
    const h = await boot();
    h.purse.gold = 10;
    h.armProtest();
    const [px, py] = h.grid.publicRoads![0];
    h.placeProtest(px, py);
    expect(h.protests).toHaveLength(1);
    const until = h.protests[0].until;
    expect(until).toBeGreaterThan(performance.now());
    expect(h.protestTick(until - 1)).toBe(0);
    expect(h.protests).toHaveLength(1);
    expect(h.protestTick(until + 1)).toBe(1);
    expect(h.protests).toHaveLength(0);
  });
});
