// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// SETTINGS-1 (#701) — the New Game settings page.
//
// The pure half: the stored settings load per key with a fallback to today's
// game, the difficulty key is only written when the player chose one, and the
// boot options name ONLY what differs from today (so a default page boots the
// same game as before). The booted half (the harness of town-4-1-large-boot):
// every setting that reaches the game is seen in it — towns, ★ line, money,
// seed — and the two that must outlive a reload (towns, ★ line) do.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mulberry32, setRng } from "../../src/game/config";
import { SAVE_KEY, readSave, type SaveGamePayload } from "../../src/iso/savegame-runtime";
import { START_MONEY } from "../../src/iso/config";
import {
  readMapOptions, readMoneyScale, readTownCount, readWinVp, MAP_OPTIONS_OFF,
} from "../../src/net/match-settings";
import {
  DEFAULT_TOWNS, DEFAULT_WIN_VP, NEW_GAME_SETTINGS_KEY, WIN_VP_PRESETS, bootOptionsFor,
  defaultNewGameSettings, describeNewGame, loadNewGameSettings, saveNewGameSettings,
} from "../../src/ui/new-game-settings";
import { NEW_GAME_MAP_KEY } from "../../src/ui/new-game-map";
import type { Grid } from "../../src/iso/grid";

vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

const memStore = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    dump: () => Object.fromEntries(m),
  };
};

describe("SETTINGS-1: the stored settings", () => {
  it("an empty store is today's game, and its boot options name nothing new", () => {
    const s = loadNewGameSettings(memStore());
    expect(s).toEqual(defaultNewGameSettings());
    expect(s.towns).toBe(DEFAULT_TOWNS);
    expect(s.winVp).toBe(DEFAULT_WIN_VP);
    expect(WIN_VP_PRESETS.map((p) => p.vp)).toContain(DEFAULT_WIN_VP);
    // only the size + layout the Play screen always passed
    expect(Object.keys(bootOptionsFor(s)).sort()).toEqual(["layout", "size"]);
  });

  it("round-trips every setting, and writes the difficulty only when chosen", () => {
    const st = memStore();
    const s = { ...defaultNewGameSettings(), size: "standard" as const, layout: "grid" as const, skill: "hard" as const,
      winVp: 18, rivers: false, hills: false, rings: false, diag: false, seed: 4242, money: "high" as const, towns: 5 };
    saveNewGameSettings(s, false, st);
    expect(st.dump()["hexmatch:rival-skill"]).toBeUndefined();
    expect(JSON.parse(st.dump()[NEW_GAME_MAP_KEY])).toEqual({ size: "standard", layout: "grid" });
    saveNewGameSettings(s, true, st);
    expect(st.dump()["hexmatch:rival-skill"]).toBe("hard");
    expect(loadNewGameSettings(st)).toEqual(s);
    expect(bootOptionsFor(s)).toEqual({
      size: "standard", layout: "grid", rivers: false, elevation: false, rings: false, diag: false,
      seed: 4242, townCount: 5, winVp: 18, moneyScale: 2,
    });
    expect(describeNewGame(s)).toBe("Vs AI · Standard map · Grid towns · Hard rival · first to 18★ · 5 towns · High money · seed 4242");
  });

  it("a bad stored value costs that one setting, never the page", () => {
    const st = memStore({
      [NEW_GAME_SETTINGS_KEY]: JSON.stringify({ winVp: 0, rivers: "yes", towns: 9, money: "rich", seed: -3, hills: false }),
      "hexmatch:rival-skill": "trainee",
    });
    const s = loadNewGameSettings(st);
    const d = defaultNewGameSettings();
    expect(s).toEqual({ ...d, hills: false });
    expect(loadNewGameSettings(memStore({ [NEW_GAME_SETTINGS_KEY]: "{not json" }))).toEqual(d);
    expect(loadNewGameSettings(memStore({ [NEW_GAME_SETTINGS_KEY]: "[1,2]" }))).toEqual(d);
  });

  it("the rule readers and the map record validate", () => {
    expect([readTownCount(3), readTownCount(0), readTownCount(2.5), readTownCount("4")]).toEqual([3, undefined, undefined, undefined]);
    expect([readWinVp(8), readWinVp(0), readWinVp(100), readWinVp(null)]).toEqual([8, null, null, null]);
    expect([readMoneyScale(2), readMoneyScale(0.5), readMoneyScale(3), readMoneyScale(undefined)]).toEqual([2, 0.5, 1, 1]);
    expect(readMapOptions({ ...MAP_OPTIONS_OFF, towns: 5 })?.towns).toBe(5);
    expect(readMapOptions({ ...MAP_OPTIONS_OFF, towns: 0 })).toBeNull();
    expect(readMapOptions({ ...MAP_OPTIONS_OFF })?.towns).toBeUndefined();
  });
});

// ── the booted half ─────────────────────────────────────────────────────────
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

interface Hook {
  readonly grid: Grid;
  readonly money: number;
  readonly winTarget: number;
  saveNow: () => void;
}
const hook = () => (window as unknown as { __iso: Hook }).__iso;
const settle = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
let roots: HTMLDivElement[] = [];
let disposers: (() => void)[] = [];
function disposeAll() {
  for (const d of disposers) d();
  disposers = [];
  for (const r of roots) r.remove();
  roots = [];
}
async function boot(opts: Record<string, unknown> = {}): Promise<Hook> {
  const root = document.createElement("div");
  Object.defineProperty(root, "clientWidth", { value: 900, configurable: true });
  Object.defineProperty(root, "clientHeight", { value: 700, configurable: true });
  document.body.appendChild(root);
  roots.push(root);
  const { startIsoGame } = await import("../../src/iso/game");
  disposers.push(startIsoGame(root, opts));
  await settle();
  return hook();
}
async function reload(opts: Record<string, unknown> = {}): Promise<Hook> {
  disposeAll();
  setRng(mulberry32(1337));
  return boot(opts);
}

describe("SETTINGS-1: every setting reaches the game", () => {
  beforeEach(() => {
    stubCanvas();
    stubImage();
    window.history.replaceState(null, "", "/?seed=1337&loop=old");
    localStorage.removeItem(SAVE_KEY);
    localStorage.setItem("hexmatch:rival-skill", "normal");
    localStorage.setItem("hexmatch:tutorial", "never");
    setRng(mulberry32(1337));
    (globalThis as Record<string, unknown>).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    (globalThis as Record<string, unknown>).OffscreenCanvas = undefined;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 0) as unknown as number) as never;
    window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as never;
  });
  afterEach(() => { disposeAll(); vi.restoreAllMocks(); });

  it("defaults boot today's game: same towns, line and cash as a bare boot", async () => {
    const bare = await boot();
    const towns = bare.grid.towns.map((t) => [t.tx, t.ty]);
    const line = bare.winTarget, cash = bare.money;
    localStorage.removeItem(SAVE_KEY);
    const viaPage = await reload(bootOptionsFor(defaultNewGameSettings()));
    expect(viaPage.grid.towns.map((t) => [t.tx, t.ty])).toEqual(towns);
    expect([viaPage.winTarget, viaPage.money]).toEqual([line, cash]);
    expect(cash).toBe(START_MONEY);
  });

  it("town count, ★ line, money and seed reach the boot; towns + line survive a reload", async () => {
    const h = await boot({ townCount: 3, winVp: 18, moneyScale: 2, seed: 4242 });
    expect(h.grid.towns.length).toBe(3);
    expect(h.grid.seed).toBe(4242);
    expect(h.winTarget).toBe(18);
    expect(h.money).toBe(START_MONEY * 2);
    expect(localStorage.getItem("hexmatch:last-seed")).toBe("4242");
    h.saveNow();
    const saved = readSave() as SaveGamePayload;
    expect(saved.map?.towns).toBe(3);
    expect(saved.winVp).toBe(18);
    const towns = h.grid.towns.map((t) => [t.tx, t.ty]);

    const back = await reload();   // no options: the save decides
    expect(back.grid.towns.map((t) => [t.tx, t.ty])).toEqual(towns);
    expect(back.winTarget).toBe(18);
  });

  it("an old save (no towns, no winVp) resumes on today's count and line", async () => {
    const h = await boot();
    const line = h.winTarget, n = h.grid.towns.length;
    h.saveNow();
    const payload = JSON.parse(localStorage.getItem(SAVE_KEY)!) as SaveGamePayload;
    delete payload.winVp;
    delete payload.map!.towns;
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    const back = await reload();
    expect([back.winTarget, back.grid.towns.length]).toEqual([line, n]);
  });
});
