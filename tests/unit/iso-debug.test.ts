// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- the whole point of these
   tests is the SHAPE of the dumps' payloads, which are debug reports, not a
   typed API; each field is asserted by name below. */
// ══════════════════════════════════════════════════════════════════════════
// C5 — the visual-debug console, against the real booted game.
//
// Same jsdom harness as `iso-game.test.ts` (real React-free boot of
// `startIsoGame`, stub canvas raster, stub image decode), plus a RECORDING 2D
// context so the overlay painter's draw calls can be counted. What these tests
// pin:
//   * the gate — a production build without `?iso-debug` installs nothing;
//   * every command returns the structured data a screenshot gets traced with;
//   * the numbers are the renderer's own: the measured skirt per terrain cell
//     (66px grass / 50px water against the 50px canonical block — the exact
//     drift `docs/HexMatch-open-backlog.md` C1 is about), and the flush/hover
//     gap of a building foot on its tile;
//   * toggling an overlay actually puts paint on the overlay canvas, and
//     turning it off leaves the renderer with no debug painter at all.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setRng, mulberry32 } from "../../src/game/config";
import { shouldInstallDebugConsole, DEBUG_OVERLAYS } from "../../src/iso/debug";
import { WATER, GRASS } from "../../src/iso/grid";

vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

type Op = { op: string; args: unknown[] };
const ops: Op[] = [];

function recordingContext() {
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "canvas") return null;
      if (prop === "imageSmoothingEnabled") return false;
      if (prop === "getImageData") {
        return (_x: number, _y: number, w: number, h: number) =>
          ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4), width: w, height: h });
      }
      return (...args: unknown[]) => { ops.push({ op: String(prop), args }); };
    },
    set: (_t, prop, value) => { ops.push({ op: `set:${String(prop)}`, args: [value] }); return true; },
  });
  return ctx as unknown as CanvasRenderingContext2D;
}

/**
 * `resize()` sizes the stage from `clientWidth`, and the boot camera is
 * created from it — with jsdom's always-zero boxes the viewport would be 1×1
 * and the culling range would contain nothing. Report a desktop viewport for
 * the map stage so the camera, the cull range and therefore the dumps are the
 * ones a real 1280×720 window produces.
 */
function giveTheStageAViewport() {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) { return this.classList?.contains("iso-stage") ? 1280 : 0; },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) { return this.classList?.contains("iso-stage") ? 720 : 0; },
  });
}

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  ops.length = 0;
  HTMLCanvasElement.prototype.getContext = (() => recordingContext()) as never;
  class FakeImage {
    width = 2048; height = 2048;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) { queueMicrotask(() => this.onload?.()); }
  }
  (globalThis as Record<string, unknown>).Image = FakeImage;
  giveTheStageAViewport();
  window.history.replaceState(null, "", "/?seed=1337");
  setRng(mulberry32(1337));
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
  (globalThis as Record<string, unknown>).OffscreenCanvas = undefined;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number) as never;
  window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as never;
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
  vi.restoreAllMocks();
});

const settle = async () => { for (let i = 0; i < 14; i++) await new Promise((r) => setTimeout(r, 0)); };

/** The debug console as the browser sees it. */
type DebugIso = {
  grid: import("../../src/iso/grid").Grid;
  phase: string;
  camera: { zoom: number; vw: number; vh: number };
  dumpTile: (tx: number, ty: number) => any;
  dumpAt: (x: number, y: number, o?: { device?: boolean }) => any;
  dumpBuilding: (tx: number, ty: number) => any;
  dumpNetwork: (who?: string) => any;
  overlay: (name?: string, on?: boolean) => { active: string[]; drawn: boolean };
  config: () => any;
  probe: (tx: number, ty: number) => any;
  placeFactory: (tx: number, ty: number) => boolean;
};

async function boot(): Promise<DebugIso> {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root);
  await settle();
  return (window as unknown as { __iso: DebugIso }).__iso;
}

describe("C5 the debug console is gated, not shipped", () => {
  it("installs in a dev build, and in production only when the URL asks", () => {
    expect(shouldInstallDebugConsole({ dev: true, search: "" })).toBe(true);
    expect(shouldInstallDebugConsole({ dev: false, search: "" })).toBe(false);
    expect(shouldInstallDebugConsole({ dev: false, search: "?seed=1337" })).toBe(false);
    expect(shouldInstallDebugConsole({ dev: false, search: "/hexmatch/?iso-debug=1" })).toBe(true);
    expect(shouldInstallDebugConsole({ dev: false, search: "?seed=1&iso-debug" })).toBe(true);
    expect(shouldInstallDebugConsole({ dev: false, search: "?iso-debug=0" })).toBe(false);
  });

  it("boots the real game with the console mounted on __iso", async () => {
    const h = await boot();
    for (const cmd of ["dumpTile", "dumpAt", "dumpBuilding", "dumpNetwork", "overlay", "config", "probe"]) {
      expect(typeof (h as any)[cmd], cmd).toBe("function");
    }
    expect(h.camera).toMatchObject({ zoom: 1, vw: 1280, vh: 720 });
  });
});

describe("C5 the dumps report the geometry the renderer used", () => {
  it("dumpTile names the terrain sprite and its MEASURED skirt, with the drift", async () => {
    const h = await boot();
    const g = h.grid;
    const find = (want: number) => {
      for (let i = 0; i < g.terrain.length; i++) if (g.terrain[i] === want) return [i % g.w, (i / g.w) | 0];
      throw new Error("no such terrain on this map");
    };
    const [gx, gy] = find(GRASS);
    const grass = h.dumpTile(gx, gy);
    expect(grass.terrainName).toBe("grass");
    expect(grass.sprite).toBe("terrain_grass");
    // landscapeTiles_067: h 99 − anchor 33 = a 66px block below the widest row
    expect(grass.skirtPx).toBe(66);
    expect(grass.canonicalSkirtPx).toBe(50);
    expect(grass.skirtDriftPx).toBe(16);     // ← the C1 hover source, in one number
    expect(grass.cell.footprint).toEqual([1, 1]);
    expect(grass.screen[0]).toBeCloseTo(grass.css[0], 0);   // dpr 1 in jsdom
    expect(grass.build.ok).toBe(true);       // grass takes a road

    const [wx, wy] = find(WATER);
    const water = h.dumpTile(wx, wy);
    expect(water.terrainName).toBe("water");
    expect(water.skirtPx).toBe(50);
    expect(water.skirtDriftPx).toBe(0);      // the canonical block
    expect(water.build.ok).toBe(false);
    expect(water.build.why).toBe("water");
  });

  it("dumpAt resolves a screen point through the real pick and flags the override", async () => {
    const h = await boot();
    const ind = h.grid.industries[0];
    const [dx, dy] = h.dumpTile(ind.tx, ind.ty).screen as [number, number];
    const here = h.dumpAt(dx, dy, { device: true });
    expect(here.inMap).toBe(true);
    expect(here.resolvesTo).toEqual([ind.tx, ind.ty]);
    expect(here.flatPick).toEqual([ind.tx, ind.ty]);
    expect(here.input.unit).toBe("device");
    // and the CSS-px form scales by dpr (1 here, 2/3 on the mobile projects)
    const css = h.dumpAt(dx, dy);
    expect(css.device).toEqual([dx, dy]);
    expect(css.overridden).toBe(false);
  });

  it("dumpBuilding measures the gap between a building's foot and its tile", async () => {
    const h = await boot();
    const ind = h.grid.industries[0];
    const d = h.dumpBuilding(ind.tx, ind.ty);
    expect(d.ground.sprite).toMatch(/^terrain_(grass|water|rough)$/);
    expect(d.ground.skirtPx).toBeGreaterThan(0);
    expect(d.tile).toEqual([ind.tx, ind.ty]);
    expect(d.structures.length).toBeGreaterThan(0);
    const built = d.structures.find((x: any) => x.isIndustry);
    expect(built).toBeTruthy();
    expect(built.sprite).toBe(ind.type);
    // K0 anchoring: the base diamond's widest row lands ON the tile centre
    // line, so a flush building has a zero gap. A non-zero one is the hover.
    expect(built.gapPx).toBe(0);
    expect(built.footprint).toEqual([1, 1]);
    // an empty tile reports no structures rather than guessing
    expect(h.dumpBuilding(0, 0).structures).toEqual([]);
  });

  it("dumpNetwork answers the adjacency question, per player", async () => {
    const h = await boot();
    const empty = h.dumpNetwork("you");
    expect(empty.player).toBe("you");
    expect(empty.ownerId).toBe(1);
    expect(empty.tiles).toBe(0);
    expect(h.dumpNetwork("rival-not-here").error).toMatch(/unknown player/);

    // place the factory through the game's own setup twin, then ask again
    const spot = (() => {
      for (let ty = 6; ty < 22; ty++) {
        for (let tx = 10; tx < 24; tx++) {
          if (h.probe(tx, ty).build.ok) return { tx, ty };
        }
      }
      throw new Error("no buildable tile on this map");
    })();
    expect(h.placeFactory(spot.tx, spot.ty)).toBe(true);
    const net = h.dumpNetwork("you");
    expect(net.seeds.factories.length).toBe(1);
    expect(net.tiles).toBeGreaterThanOrEqual(1);   // the factory tile itself
    expect(net.list[0]).toEqual([spot.tx, spot.ty]);
  });

  it("config() returns the resolved cell of every sprite on screen", async () => {
    const h = await boot();
    const c = h.config();
    expect(c.camera.zoom).toBe(1);
    expect(c.geometry).toMatchObject({ tileW: 132, tileH: 64, blockH: 50 });
    expect(c.visibleTiles.x0).toBeLessThanOrEqual(c.visibleTiles.x1);
    const grass = c.sprites.terrain_grass;
    expect(grass).toMatchObject({ anchor: [66, 33], footprint: [1, 1], kind: "ground" });
    // the meta travels with the dump, so a report says which atlas it came from
    expect(c.manifestMeta.generatedBy).toMatch(/slice-atlas/);
    expect(Object.keys(c.sprites).length).toBeGreaterThan(0);
  });
});

describe("C5 the overlay toggles paint on the map", () => {
  it("each overlay draws, and 'none' leaves no debug painter on the renderer", async () => {
    const h = await boot();
    expect(h.overlay()).toEqual({ active: [], drawn: false });
    expect(ops.filter((o) => o.op === "stroke").length).toBe(0);

    for (const name of DEBUG_OVERLAYS) {
      expect(h.overlay(name).active).toContain(name);
      await settle();
      // the overlay layer is cleared + redrawn every frame; the debug marks are
      // strokes/fills/text, none of which the sprite blitter ever calls.
      const drawn = ops.filter((o) => o.op === "stroke" || o.op === "fill" || o.op === "fillText");
      expect(drawn.length, name).toBeGreaterThan(0);
      expect(h.overlay(name, false).active).not.toContain(name);
      await settle();
    }

    expect(h.overlay("all").active.sort()).toEqual([...DEBUG_OVERLAYS].sort());
    await settle();
    expect(h.overlay("none")).toEqual({ active: [], drawn: false });
    await settle();
    const before = ops.length;
    await settle();
    // with no overlay active, the painter is detached: the remaining per-frame
    // ops are the sprite blits only (drawImage), never the debug marks.
    const marks = ops.slice(before).filter((o) => o.op === "fillText" || o.op === "stroke");
    expect(marks).toEqual([]);
  });

  it("the skirt overlay marks the tiles whose block depth drifts", async () => {
    const h = await boot();
    h.overlay("skirt");
    await settle();
    const labels = ops.filter((o) => o.op === "fillText").map((o) => String(o.args[0]));
    expect(labels.length).toBeGreaterThan(0);
    // grass drifts +16 on this map, water does not — so the labels are drifts
    expect(labels.every((l) => /^[+-]\d+$/.test(l))).toBe(true);
    expect(labels).toContain("+16");
  });
});
