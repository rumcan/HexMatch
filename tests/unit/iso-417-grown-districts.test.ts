// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// #417 — grown town districts render when a city grows.
//
// The ticket: upgrading to tier 2/3 shows the tall centre art but NO grown
// district houses, although `grownTownHouses` returns ~567 tiles for the
// same town (seed 42). Root cause was in `syncWorld` (src/iso/game.ts): the
// town block marked the grown tiles `built` BEFORE calling `townBuildings`,
// which derives its very own ring through the same `isBuilt` question — so
// every grown tile then read as blocked and the laid list came back with the
// base town only.
//
// This file boots the REAL game (jsdom, `?seed=42&rings=1`), grows a town
// through `__iso.setTownLevel` — the same door a real city upgrade uses —
// and reads the draw list through `__iso.townDrawItems` plus the live track,
// pinning the acceptance boxes:
//
//   1. tier 2 AND tier 3 draw an item on EVERY grown tile;
//   2. no grown tile sits on a road (districts are ground, not streets);
//   3. the ring road #296 lays WITH the growth sits just outside the
//      districts (a superseded inner loop remains an ordinary street).
//
// The pure tier-art rules live in iso-l17-town-growth.test.ts; this file is
// about the WIRING: syncWorld's ordering after a live growth.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setRng, mulberry32 } from "../../src/game/config";
import { SAVE_KEY } from "../../src/iso/savegame-runtime";
import {
  grownTownHouses, idx, townGrownRings, type Grid,
} from "../../src/iso/grid";
import { hasTrack, plantFootprintTiles, type Track } from "../../src/iso/track";
import { depotTiles } from "../../src/iso/depot";
import { FACTORY_FOOTPRINT } from "../../src/iso/config";

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

/** One town draw item as `__iso.townDrawItems` reports it. */
interface TownItem { sprite: string; tx: number; ty: number; townId: number }

/** The slice of `window.__iso` this file drives. */
interface Hook417 {
  readonly newLoop: boolean;
  readonly towns: { id: number; level: number; label: string }[];
  setTownLevel: (townId: number, level: number) => boolean;
  readonly townDrawItems: TownItem[];
  readonly grid: Grid;
  readonly track: Track;
  readonly eco: {
    factories: { owner: string; ownerId: number; tx: number; ty: number; id: number; rot?: number; townId: number | null }[];
    harvesters: { owner: string; ownerId: number; tx: number; ty: number; id: number }[];
  };
}

const hook = () => (window as unknown as { __iso: Hook417 }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas();
  stubImage();
  // rings ON so #296's grown ring road exists; the map-option URL asks for a
  // fresh map (never a resumed save).
  window.history.replaceState(null, "", "/?seed=42&rings=1");
  localStorage.removeItem(SAVE_KEY);
  localStorage.setItem("hexmatch:rival-skill", "normal");
  localStorage.setItem("hexmatch:tutorial", "never");
  setRng(mulberry32(42));
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

async function boot(): Promise<Hook417> {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, { newLoop: true });
  await settle();
  return hook();
}

/**
 * `syncWorld`'s own `isBuilt` question, mirrored from src/iso/game.ts: every
 * laid track tile plus the player structures. (Rail structures can't exist
 * this early — nothing has been built in this harness.)
 */
function builtSetOf(h: Hook417): Set<number> {
  const built = new Set<number>();
  for (let i = 0; i < h.track.road.length; i++) {
    if (h.track.road[i] || h.track.dirt[i]) built.add(i);
  }
  for (const f of h.eco.factories) {
    for (const [x, y] of plantFootprintTiles(f.tx, f.ty, f.rot ?? 0, FACTORY_FOOTPRINT)) built.add(idx(x, y));
  }
  for (const d of h.eco.harvesters) {
    for (const [x, y] of depotTiles(d.tx, d.ty)) built.add(idx(x, y));
  }
  return built;
}

/** The grown tiles the town draws for its tier, given the live world. */
function grownTilesOf(h: Hook417, townId: number, tier: number): [number, number][] {
  const t = h.grid.towns[townId];
  const built = builtSetOf(h);
  return grownTownHouses(t, h.grid, townGrownRings(tier), (x, y) => built.has(idx(x, y)));
}

/** The town's draw items whose origin is NOT a house tile = GROWN items. */
function grownItemsOf(h: Hook417, townId: number): TownItem[] {
  const t = h.grid.towns[townId];
  const houses = new Set(t.houses.map(([hx, hy]) => idx(hx, hy)));
  return h.townDrawItems.filter((i) => i.townId === t.id && !houses.has(idx(i.tx, i.ty)));
}

/** Road-layer tiles that belong to no town's streets and no highway. */
function growthRingTilesOf(h: Hook417): [number, number][] {
  const townRoads = new Set<number>();
  for (const tn of h.grid.towns) {
    for (const [x, y] of tn.roads) townRoads.add(idx(x, y));
  }
  for (const [x, y] of h.grid.publicRoads ?? []) townRoads.add(idx(x, y));
  const out: [number, number][] = [];
  for (let y = 0; y < h.grid.h; y++) {
    for (let x = 0; x < h.grid.w; x++) {
      if (hasTrack(h.track, "road", x, y) && !townRoads.has(idx(x, y))) out.push([x, y]);
    }
  }
  return out;
}

const cheb = (t: { tx: number; ty: number }, x: number, y: number) =>
  Math.max(Math.abs(x - t.tx), Math.abs(y - t.ty));

describe("#417 grown town districts render in play", () => {
  it("a village draws its base town only — no grown items at tier 0", async () => {
    const h = await boot();
    expect(h.newLoop).toBe(true);
    expect(h.towns[0].level).toBe(0);
    const items = h.townDrawItems.filter((i) => i.townId === 0);
    expect(items.length, "the base town draws").toBeGreaterThan(0);
    expect(grownItemsOf(h, 0)).toEqual([]);
    // sanity: the grown ring exists to be drawn once the tier rises
    expect(grownTilesOf(h, 0, 0)).toEqual([]);
  }, 20000);

  it("tier 2: every grown tile gets a draw item, none sits on a road, the grown ring road sits outside", async () => {
    const h = await boot();
    expect(h.setTownLevel(0, 2)).toBe(true);
    expect(h.towns[0].level).toBe(2);
    const t = h.grid.towns[0];

    const grown = grownTilesOf(h, 0, 2);
    expect(grown.length, "seed 42 tier 2 grows a real district").toBeGreaterThan(100);

    // (1) the draw list covers every grown tile.
    const drawn = new Set(grownItemsOf(h, 0).map((i) => idx(i.tx, i.ty)));
    for (const [x, y] of grown) {
      expect(drawn.has(idx(x, y)), `grown tile (${x},${y}) has no draw item`).toBe(true);
    }
    // …and draws nothing outside the derived ring (no stray art).
    for (const i of grownItemsOf(h, 0)) {
      expect(grown.some(([x, y]) => x === i.tx && y === i.ty),
        `draw item at (${i.tx},${i.ty}) is outside the grown ring`).toBe(true);
    }

    // (2) no grown item sits on a road of the LIVE track layer.
    for (const i of grownItemsOf(h, 0)) {
      expect(hasTrack(h.track, "road", i.tx, i.ty), `(${i.tx},${i.ty}) sits on a road`).toBe(false);
      expect(hasTrack(h.track, "dirt", i.tx, i.ty), `(${i.tx},${i.ty}) sits on dirt track`).toBe(false);
    }

    // (3) #296: the ring road this growth laid sits just outside the districts.
    const ring = growthRingTilesOf(h);
    expect(ring.length, "the growth laid its outer ring road").toBeGreaterThan(0);
    const maxDistrict = Math.max(...grown.map(([x, y]) => cheb(t, x, y)));
    for (const [x, y] of ring) {
      expect(cheb(t, x, y), `ring tile (${x},${y}) inside/on the districts`)
        .toBeGreaterThan(maxDistrict);
    }
    // "just" outside: the loop is one tile beyond the outermost district tile.
    const minRing = Math.min(...ring.map(([x, y]) => cheb(t, x, y)));
    expect(minRing).toBe(maxDistrict + 1);
  }, 20000);

  it("tier 3: the metropolis draws the second grown ring too, still clear of the roads", async () => {
    const h = await boot();
    expect(h.setTownLevel(0, 2)).toBe(true);
    const ring2 = growthRingTilesOf(h);
    expect(h.setTownLevel(0, 3)).toBe(true);
    expect(h.towns[0].level).toBe(3);
    const t = h.grid.towns[0];

    const grown = grownTilesOf(h, 0, 3);
    expect(grown.length).toBeGreaterThan(grownTilesOf(h, 0, 2).length);
    expect(grown.length, "seed 42 tier 3 grows ~567 tiles (the ticket)").toBeGreaterThan(300);

    // (1) every grown tile draws.
    const drawn = new Set(grownItemsOf(h, 0).map((i) => idx(i.tx, i.ty)));
    for (const [x, y] of grown) {
      expect(drawn.has(idx(x, y)), `grown tile (${x},${y}) has no draw item`).toBe(true);
    }

    // (2) none of them sits on a road.
    for (const i of grownItemsOf(h, 0)) {
      expect(hasTrack(h.track, "road", i.tx, i.ty), `(${i.tx},${i.ty}) sits on a road`).toBe(false);
      expect(hasTrack(h.track, "dirt", i.tx, i.ty), `(${i.tx},${i.ty}) sits on dirt track`).toBe(false);
    }

    // (3) the ring road THIS growth laid (the tier-2 loop is a street now) is
    // still just outside the tier-3 districts.
    const oldRing = new Set(ring2.map(([x, y]) => idx(x, y)));
    const fresh = growthRingTilesOf(h).filter(([x, y]) => !oldRing.has(idx(x, y)));
    expect(fresh.length, "tier 3 grew the ring road outward").toBeGreaterThan(0);
    const maxDistrict = Math.max(...grown.map(([x, y]) => cheb(t, x, y)));
    for (const [x, y] of fresh) {
      expect(cheb(t, x, y), `fresh ring tile (${x},${y}) inside/on the districts`)
        .toBeGreaterThan(maxDistrict);
    }
    const minFresh = Math.min(...fresh.map(([x, y]) => cheb(t, x, y)));
    expect(minFresh).toBe(maxDistrict + 1);
  }, 20000);
});
