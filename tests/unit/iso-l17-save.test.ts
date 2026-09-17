// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// L17 (#245) — the growth loop live: boot, hook, upgrade, save, restore.
//
// The pure art rules live in `iso-l17-town-growth.test.ts`. This file boots
// the REAL game (jsdom, `?loop=new`) and pins the wiring:
//
//   • a new game opens with FOUR VILLAGES (the ticket's first acceptance
//     line, read through `__iso.towns`);
//   • `__iso.setTownLevel` — the debug hook — grows a town through the same
//     door a confirmed upgrade uses, and the map re-lays (the centre item is
//     the bank afterwards);
//   • a saved game restores the town tiers (`towns` in the payload);
//   • a save from BEFORE this ticket (no `towns` field) self-heals from the
//     seats' own `townLevel`, so a mid-growth save reloads grown;
//   • the flag off (`?loop=old`) never touches tiers — legacy look.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setRng, mulberry32 } from "../../src/game/config";
import { SAVE_KEY, readSave, type SaveGamePayload } from "../../src/iso/savegame-runtime";

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
interface L17Hook {
  readonly newLoop: boolean;
  readonly phase: string;
  readonly towns: { id: number; level: number; label: string }[];
  setTownLevel: (townId: number, level: number) => boolean;
  eco: { factories: { owner: string; ownerId: number; tx: number; ty: number; id: number; townId: number | null }[] };
  saveNow: () => void;
}

const hook = () => (window as unknown as { __iso: L17Hook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas();
  stubImage();
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

describe("L17 growth loop (booted game)", () => {
  it("a new game opens with four villages", async () => {
    const h = await boot({ newLoop: true });
    expect(h.newLoop).toBe(true);
    expect(h.towns.length).toBe(4);
    for (const t of h.towns) {
      expect(t.level).toBe(0);
      expect(t.label).toBe("village");
    }
  });

  it("__iso.setTownLevel grows a town through the upgrade door — the centre becomes the bank", async () => {
    const h = await boot({ newLoop: true });
    expect(h.setTownLevel(0, 1)).toBe(true);
    expect(h.towns[0].level).toBe(1);
    expect(h.towns[0].label).toBe("town");
    expect(h.setTownLevel(0, 2)).toBe(true);
    expect(h.towns[0].label).toBe("city");
    // Clamped, never thrown: an unknown town answers false.
    expect(h.setTownLevel(99, 1)).toBe(false);
  });

  it("a saved game restores the town tiers", async () => {
    const h = await boot({ newLoop: true });
    // The seat owns a Factory beside town 1, then upgrades twice.
    const town1 = h.towns[1];
    h.eco.factories.push({ owner: "you", ownerId: 1, tx: 2, ty: 2, id: 0, townId: town1.id });
    expect(h.setTownLevel(town1.id, 2)).toBe(true);
    h.saveNow();
    const saved = readSave() as SaveGamePayload;
    expect(saved.towns).toBeTruthy();
    expect(saved.towns![town1.id]).toBe(2);

    const reloaded = await reload({ newLoop: true });
    expect(reloaded.towns[town1.id].level).toBe(2);
    expect(reloaded.towns[town1.id].label).toBe("city");
    // The other towns stayed villages.
    for (const t of reloaded.towns) {
      if (t.id !== town1.id) expect(t.level).toBe(0);
    }
  });

  it("a pre-L17 save (no towns field) self-heals from the seats' townLevel", async () => {
    const h = await boot({ newLoop: true });
    h.eco.factories.push({ owner: "you", ownerId: 1, tx: 2, ty: 2, id: 0, townId: 2 });
    h.saveNow();
    // Strip the field and age the seat, exactly as a pre-L17 payload looks.
    const raw = localStorage.getItem(SAVE_KEY)!;
    const payload = JSON.parse(raw) as SaveGamePayload & { towns?: number[] };
    delete payload.towns;
    payload.players[0].townLevel = 2;
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));

    const reloaded = await reload({ newLoop: true });
    expect(reloaded.towns[2].level).toBe(2);
  });

  it("flag off: the boot never touches tiers — the legacy look stays", async () => {
    const h = await boot({});                     // `?loop=old` from beforeEach
    expect(h.newLoop).toBe(false);
    for (const t of h.towns) expect(t.level).toBe(-1);
  });
});
