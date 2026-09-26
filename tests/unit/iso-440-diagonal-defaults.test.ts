// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// #440 — 45° roads are the DEFAULT.
//
// D1–D5 (#423) shipped diagonal roads behind `?diag=1` and DEV-only. This file
// pins the graduation, in the game rather than in the model:
//
//   • a FRESH game drags 45° roads with no URL flag at all;
//   • `?diag=0` turns them off and the drag is the old axis-only L;
//   • a save carries the rule it was played with, and a resumed save keeps it —
//     including a pre-#440 save, which has no `map.diag` and stays axis-only
//     (its diagonal bytes are ignored, never migrated);
//   • the unit-test runner keeps the axis-only default, so every seed-pinned
//     suite about something else keeps the map and the routes it was written
//     against (an explicit `?diag=1` still turns them on there — that is how
//     the D1–D5 files boot).
//
// The precedence chain itself (explicit → URL → save → room → story → default)
// is pinned in `iso-map-defaults.test.ts`; this file boots the real game.
// ══════════════════════════════════════════════════════════════════════════
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAP_W, MAP_H } from "../../src/game/config";
import { GRASS, type Grid } from "../../src/iso/grid";
import {
  lPath, octPath, roadDiagLinked, tIdx, type Track,
} from "../../src/iso/track";
import { SAVE_KEY, type SaveGamePayload } from "../../src/iso/savegame-runtime";
import type { DragPreview } from "../../src/iso/track";

vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));
import { IsoRenderer } from "../../src/iso/renderer";
import { mulberry32, setRng } from "../../src/game/config";

interface BootHook {
  grid: Grid;
  track: Track;
  purse: Record<string, number>;
  money: number;
  phase: string;
  finishSetup(): void;
  setTool(t: string): void;
  saveNow(): void;
  activeRoadDrag: { preview: DragPreview; xFirst: boolean } | null;
}

const rich = { wood: 9999, stone: 9999, ore: 9999, grain: 9999, oil: 9999, gold: 9999 };
/** The drag every case below makes: five tiles east, two south. */
const FROM: [number, number] = [10, 10], TO: [number, number] = [15, 12];

describe("#440 diagonal roads by default", () => {
  let root: HTMLDivElement;
  let dispose: (() => void) | undefined;
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

  beforeEach(() => {
    const gradient = { addColorStop() {}, setTransform() {} };
    const ctx = new Proxy({}, {
      get: (_target, prop) => {
        if (prop === "canvas") return null;
        if (prop === "measureText") return () => ({ width: 0 });
        if (["createLinearGradient", "createRadialGradient", "createConicGradient", "createPattern"].includes(String(prop))) return () => gradient;
        if (prop === "getImageData") return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4).fill(255), width: w, height: h });
        return () => undefined;
      }, set: () => true,
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ctx) as never);
    vi.stubGlobal("Image", class {
      width = 1024; height = 1024; onload: (() => void) | null = null;
      set src(_v: string) { queueMicrotask(() => this.onload?.()); }
    });
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("OffscreenCanvas", undefined);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => setTimeout(() => cb(performance.now()), 0) as unknown as number);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => clearTimeout(id));
    vi.spyOn(IsoRenderer.prototype, "pick").mockImplementation((x, y) => ({ tx: Math.round(x / 10), ty: Math.round(y / 10), sprite: null, ref: null }));
    // The relative-URL art fallbacks are expected noise here, not the subject.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.clear();
    localStorage.setItem("hexmatch:tutorial", "never");
    root = document.createElement("div");
    Object.defineProperties(root, { clientWidth: { value: 900 }, clientHeight: { value: 700 } });
    document.body.appendChild(root);
    // A shipped build, not the unit-test runner: this is the default a player
    // meets. `unlimited=0` keeps the real economy (the boots pay for themselves).
    vi.stubEnv("MODE", "production");
  });

  afterEach(() => {
    dispose?.(); dispose = undefined;
    root.remove();
    vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
    localStorage.clear();
  });

  /** Boot the real game at `search`, on the flat seed the D2 harness uses. */
  async function boot(search: string, opts: Record<string, boolean> = { rivers: false, elevation: false, shapes: false, rings: false }): Promise<BootHook> {
    dispose?.(); dispose = undefined;
    root.remove();
    root = document.createElement("div");
    Object.defineProperties(root, { clientWidth: { value: 900 }, clientHeight: { value: 700 } });
    document.body.appendChild(root);
    window.history.replaceState(null, "", search);
    setRng(mulberry32(1337));
    const { startIsoGame } = await import("../../src/iso/game");
    dispose = startIsoGame(root, opts);
    await settle();
    return (window as unknown as { __iso: BootHook }).__iso;
  }

  /** A clean flat field to drag over, and a purse that can afford the drag. */
  function clearForDrag(h: BootHook): void {
    h.finishSetup(); h.setTool("dirt");
    h.grid.terrain.fill(GRASS); h.grid.occupancy.fill(-1); h.grid.builtAt = () => null;
    for (const layer of [h.track.dirt, h.track.road, h.track.owner, h.track.upgraded, h.track.tier!]) layer.fill(0);
    h.track.revision++;
    Object.assign(h.purse, rich); h.money = 1e9;
  }

  function pointer(type: string, x: number, y: number): void {
    const canvas = root.querySelectorAll("canvas.iso-layer")[2];
    const dpr = window.devicePixelRatio || 1;
    const event = new MouseEvent(type, {
      clientX: x * 10 / dpr, clientY: y * 10 / dpr, button: 0,
      buttons: type === "pointerup" ? 0 : 1,
    });
    Object.defineProperties(event, { pointerType: { value: "mouse" }, pointerId: { value: 1 }, isPrimary: { value: true } });
    canvas.dispatchEvent(event);
  }

  /** Drag FROM → TO with the real pointer handlers and return the hook. */
  async function drag(search: string): Promise<BootHook> {
    const h = await boot(search);
    clearForDrag(h);
    pointer("pointerdown", FROM[0], FROM[1]);
    pointer("pointermove", TO[0], TO[1]);
    pointer("pointerup", TO[0], TO[1]);
    await settle();
    return h;
  }

  const builtTiles = (h: BootHook): [number, number][] => {
    const out: [number, number][] = [];
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      if (h.track.dirt[tIdx(x, y)] || h.track.road[tIdx(x, y)]) out.push([x, y]);
    }
    return out;
  };

  it("a fresh game drags 45° roads with no URL flag", async () => {
    const h = await drag("/?seed=1337&unlimited=0");
    expect(h.track.diagonalRoads).toBe(true);
    expect(builtTiles(h)).toEqual(octPath(FROM[0], FROM[1], TO[0], TO[1], true));
    // the corner is a real stored link, not two tiles that merely touch
    expect(roadDiagLinked(h.track, 13, 10, 14, 11)).toBe(true);
    expect(h.track.dirt.some((b) => b & 0b1100000), "a diagonal bit is stored").toBe(true);
  });

  it("?diag=0 turns them off and the drag is the axis-only L it always was", async () => {
    const h = await drag("/?diag=0&seed=1337&unlimited=0");
    expect(h.track.diagonalRoads).toBe(false);
    expect(builtTiles(h)).toEqual(lPath(FROM[0], FROM[1], TO[0], TO[1], true));
    expect(h.track.dirt.every((b) => !(b & 0b1100000)), "no diagonal bits").toBe(true);
    expect(roadDiagLinked(h.track, 13, 10, 14, 11)).toBe(false);
  });

  it("the unit-test runner stays axis-only unless the boot asks for 45°", async () => {
    vi.unstubAllEnvs();                       // back to MODE=test for one boot
    expect((await boot("/?seed=1337&unlimited=0")).track.diagonalRoads).toBe(false);
    expect((await boot("/?diag=1&seed=1337&unlimited=0")).track.diagonalRoads).toBe(true);
    vi.stubEnv("MODE", "production");         // afterEach unstubs; keep the rest honest
  });

  it("a save records the rule it was played with, and resuming keeps it", async () => {
    const h = await drag("/?seed=1337&unlimited=0");
    expect(roadDiagLinked(h.track, 13, 10, 14, 11)).toBe(true);
    h.saveNow();
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY)!) as SaveGamePayload;
    expect(saved.map?.diag, "the save carries the road rule").toBe(true);

    const resumed = await boot("/?seed=1337&unlimited=0");   // no flag: the save decides
    expect(resumed.track.diagonalRoads).toBe(true);
    expect(roadDiagLinked(resumed.track, 13, 10, 14, 11)).toBe(true);
  });

  it("a pre-#440 save stays axis-only: the bytes survive, the links do not count", async () => {
    const h = await drag("/?seed=1337&unlimited=0");
    h.saveNow();
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY)!) as SaveGamePayload;
    const diagonalBytes = saved.track.dirt;
    delete saved.map!.diag;                    // what a save written before #440 holds
    localStorage.setItem(SAVE_KEY, JSON.stringify(saved));

    const resumed = await boot("/?seed=1337&unlimited=0");
    expect(resumed.track.diagonalRoads).toBe(false);
    expect(resumed.track.dirt[tIdx(14, 11)]).not.toBe(0);   // the tiles are still there
    expect(resumed.track.dirt.some((b) => b & 0b1100000)).toBe(true);
    expect(roadDiagLinked(resumed.track, 13, 10, 14, 11)).toBe(false);  // …but the link is off
    expect(diagonalBytes).toBe(saved.track.dirt);           // untouched, not migrated
  });
});
