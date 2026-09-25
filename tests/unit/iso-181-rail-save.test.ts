// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// #181 — the railway through the save slot.
//
// The save payload carries the SAME `RailWire` the join snapshot carries
// (`collectSave` → `railWire(true)`, `applySave` → `applyRailWire`), so the
// wire's own round-trip case lives in `iso-rail-wire.test.ts`. What THIS file
// pins is the save path itself, booted for real:
//
//   • a railway built in a live game — a platform (which is also a Depot
//     record at an industry) and a DIAGONAL stretch of track — comes back
//     byte-for-byte after a reload: the layer, the owner bytes, the diagonal
//     bits, the structure and the platform-Depot's `platformId`;
//   • a save from BEFORE the railway (the `rail` field absent, as every
//     pre-RAIL-04 payload looks) reloads with an EMPTY rail layer rather than
//     whatever the fresh world happened to generate.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setRng, mulberry32 } from "../../src/game/config";
import { SAVE_KEY, readSave, type SaveGamePayload } from "../../src/iso/savegame-runtime";
import { RAIL_DE, RAIL_DS, type RailState } from "../../src/iso/rail";
import { tIdx } from "../../src/iso/track";
import type { Grid } from "../../src/iso/grid";
import type { Factory, Harvester } from "../../src/iso/economy";
import { findPlatformSite } from "./helpers/rail-line";

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
interface SaveHook {
  readonly phase: string;
  grid: Grid;
  railState: RailState;
  railTiles: (who?: "you" | "ai") => number;
  rail: {
    structures: { id: number; kind: string; ownerId: number; tx: number; ty: number; view: string }[];
    lines: { id: number }[];
    trains: { id: number }[];
  };
  factories: Factory[];
  harvesters: Harvester[];
  vp: { you: number; ai: number };
  purse: Record<string, number>;
  finishSetup: () => void;
  placePlatform: (tx: number, ty: number, view?: string, who?: "you" | "ai") => boolean;
  railDrag: (ax: number, ay: number, bx: number, by: number) => { tiles: [number, number][] } | null;
  saveNow: () => void;
}

const hook = () => (window as unknown as { __iso: SaveHook }).__iso;
const settle = async (n = 12) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas();
  stubImage();
  window.history.replaceState(null, "", "/?seed=1337&loop=new");
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

async function boot(opts: { newLoop?: boolean } = { newLoop: true }): Promise<SaveHook> {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, { seed: 1337, ...opts });
  await settle();
  return hook();
}

/** A reload: the same slot, the same seed, a fresh game instance over it. */
async function reload(opts: { newLoop?: boolean } = { newLoop: true }): Promise<SaveHook> {
  dispose?.();
  dispose = undefined;
  setRng(mulberry32(1337));
  return boot(opts);
}

/**
 * Stand a small railway up in the live game: a platform at an INDUSTRY (which
 * is also a Depot record) and a two-tile diagonal drag of track near it. The
 * drag is found by asking the game itself — `railDrag` is the real preview +
 * commit — so the test never hand-picks a tile the rules would refuse.
 */
function buildRailway(h: SaveHook): { tx: number; ty: number; diag: [number, number] } {
  for (const k of Object.keys(h.purse)) h.purse[k] = 500;
  h.finishSetup();
  const site = findPlatformSite({
    grid: h.grid, state: h.railState, plants: h.factories, ownerId: 1, want: "industry",
  });
  expect(site, "no legal industry platform site on this map").not.toBeNull();
  expect(h.placePlatform(site!.tx, site!.ty, site!.view)).toBe(true);

  for (let y = 3; y < 60; y++) {
    for (let x = 3; x < 60; x++) {
      const pv = h.railDrag(x, y, x + 1, y + 1);
      const tile = h.railState.rail.tile;
      // A two-tile drag that put a DIAGONAL bit down is the shape this case
      // exists for: it is the encoding a version bump or a re-encode breaks.
      if (pv?.tiles.length === 2 && ((tile[tIdx(x, y)] & (RAIL_DE | RAIL_DS)) || (tile[tIdx(x + 1, y + 1)] & (RAIL_DE | RAIL_DS)))) {
        return { tx: site!.tx, ty: site!.ty, diag: [x, y] };
      }
    }
  }
  throw new Error("no legal diagonal two-tile rail drag on this map");
}

describe("#181 the railway through the save slot", () => {
  it("comes back byte-for-byte — diagonals, structure and the platform-Depot", async () => {
    const h = await boot();
    const built = buildRailway(h);
    expect(h.rail.structures.filter((s) => s.kind === "platform")).toHaveLength(1);

    const before = {
      tile: Uint8Array.from(h.railState.rail.tile),
      owner: Uint8Array.from(h.railState.rail.owner),
      tiles: h.railTiles("you"),
      structures: h.rail.structures.map((s) => ({ ...s })),
      depot: h.harvesters.find((x) => x.platformId !== undefined)?.platformId,
    };
    expect(before.tiles).toBeGreaterThan(0);
    expect(before.depot, "the platform did not become a Depot record").toBeDefined();

    h.saveNow();
    const saved = readSave() as SaveGamePayload;
    expect(saved.rail, "the payload carries the railway").toBeTruthy();
    expect(saved.rail!.revision).toBe(h.railState.rail.revision);

    const back = await reload();
    expect(back.railTiles("you")).toBe(before.tiles);
    expect(Array.from(back.railState.rail.tile)).toEqual(Array.from(before.tile));
    expect(Array.from(back.railState.rail.owner)).toEqual(Array.from(before.owner));
    expect(back.rail.structures).toEqual(before.structures);
    expect(back.rail.lines.map((l) => l.id)).toEqual(h.rail.lines.map((l) => l.id));
    expect(back.rail.trains.map((t) => t.id)).toEqual(h.rail.trains.map((t) => t.id));
    expect(back.harvesters.find((x) => x.platformId !== undefined)?.platformId).toBe(before.depot);
    // The diagonal is still a diagonal: the bits rode the payload's own bytes.
    expect(back.railState.rail.tile[tIdx(built.diag[0], built.diag[1])] & (RAIL_DE | RAIL_DS)).toBeTruthy();
  });

  it("a save from before the railway loads with an EMPTY rail", async () => {
    const h = await boot();
    buildRailway(h);
    const purse = { ...h.purse };
    const vp = { ...h.vp };
    h.saveNow();

    // Exactly what a pre-RAIL-04 payload looks like: no `rail` field at all.
    const raw = localStorage.getItem(SAVE_KEY)!;
    const payload = JSON.parse(raw) as SaveGamePayload & { rail?: unknown };
    delete payload.rail;
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));

    const back = await reload();
    expect(back.railTiles("you")).toBe(0);
    expect(back.rail.structures).toHaveLength(0);
    expect(back.rail.lines).toHaveLength(0);
    expect(back.rail.trains).toHaveLength(0);
    // …and the rest of the save still landed: the payload was applied, not
    // ignored — same purse, same ★, and the seat is playing.
    expect(back.purse).toEqual(purse);
    expect(back.vp).toEqual(vp);
    expect(back.phase).toBe("play");
  });
});
