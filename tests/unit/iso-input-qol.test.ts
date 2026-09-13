// @vitest-environment jsdom
//
// INPUT-QOL — the strategy-game input pass, tested against the REAL game:
//
//   * the SELECT pointer — a tool that builds nothing but highlights and
//     names, the hand you hold between builds;
//   * right-click drops the held tool back to the pointer (and the browser
//     context menu is suppressed over the map);
//   * WASD pans the camera (Shift doubles, blur clears, typing fields win);
//   * the NAMES top-bar button — name tags over resources, towns, plants
//     and depots while you pan, shown by default, off on demand;
//   * the 1-second build flash — a refused build says so AT THE TILE that
//     refused it, not only in a toast at the edge of the screen;
//   * the first-road blocker — the "connect your depot" guidance banner
//     retires the moment the first track commit lands, so the opening
//     road is never laid behind a popup.
//
// Same harness as iso-game.test.ts: the real startIsoGame, a stubbed 2D
// context and image loader, the pinned seed 1337.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WATER } from "../../src/iso/grid";
import { buildTile } from "../../src/iso/track";
import { MAP_W, MAP_H, INDUSTRY_BY_KEY } from "../../src/iso/config";
import { FREE_SETUP_TRACK } from "../../src/iso/game";
import { setRng, mulberry32 } from "../../src/game/config";

// ── stub the art imports (vite handles these in the browser) ──────────────
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

/**
 * A no-op 2D context good enough for the renderer's call pattern. The
 * placement overlay paints vector gradients (overlay-art.ts), so the
 * gradient factories must hand back a stop-collector, not `undefined`.
 */
function stubCanvas() {
  // Gradients collect stops; the seamless ground PATTERNS are transformed
  // per frame (the drifting ocean), so the stub doubles for both.
  const gradient = { addColorStop: () => undefined, setTransform: () => undefined };
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "canvas") return null;
      if (prop === "imageSmoothingEnabled") return false;
      if (prop === "createLinearGradient" || prop === "createRadialGradient"
          || prop === "createConicGradient" || prop === "createPattern") {
        return () => gradient;
      }
      if (prop === "measureText") return () => ({ width: 0 });
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

interface IsoHook {
  phase: string;
  tool: string;
  grid: import("../../src/iso/grid").Grid;
  track: import("../../src/iso/track").Track;
  eco: import("../../src/iso/economy").EconomyState;
  purse: Record<string, number>;
  freeTrack: number;
  harvesters: { id: number; owner: string; tx: number; ty: number }[];
  factories: { owner: string; tx: number; ty: number }[];
  setTool: (t: string) => void;
  placeDepot: (x: number, y: number) => boolean;
  dragBuild: (
    kind: "dirt" | "road", ax: number, ay: number, bx: number, by: number,
    xFirst?: boolean,
  ) => import("../../src/iso/track").DragPreview | null;
  finishSetup: () => void;
  refreshQuarry: (now?: number) => unknown;
  pickAt: (sx: number, sy: number) => { tx: number; ty: number; sprite: string | null } | null;
  tileScreenAt: (tx: number, ty: number) => [number, number];
  /** The click's own legality answer for a tile (site + Depot rules + price). */
  tileProbe: (kind: "dirt" | "road", tx: number, ty: number) => {
    build: { ok: boolean; why: string | null };
    harvester: {
      ok: boolean; why: string | null; industries: number[]; held: number[];
      cost: Record<string, number>; free: boolean; affordable: boolean;
    };
  };
  /** The drag's own preview (nothing committed). */
  dragPreview: (
    kind: "dirt" | "road", ax: number, ay: number, bx: number, by: number,
    xFirst?: boolean,
  ) => import("../../src/iso/track").DragPreview | null;
  camera: { x: number; y: number; zoom: number; vw: number; vh: number };
  overlayItemsFor: (tx: number, ty: number) => { sprite: string; tx: number; ty: number }[];
  /** INPUT-QOL: the map's name-tag layer. */
  labels: {
    count: () => number;
    texts: () => string[];
    enabled: boolean;
  };
  /** INPUT-QOL: the Names-button state. */
  showNames: boolean;
  /** INPUT-QOL: the 1-second build flashes on the map. */
  flashTexts: () => string[];
  /** INPUT-QOL: the WASD pan keys currently held. */
  panKeys: string[];
}

const hook = () => (window as unknown as { __iso: IsoHook }).__iso;

/** Wait for the async atlas load + a few frames. */
const settle = async (ms = 12) => {
  for (let i = 0; i < ms; i++) await new Promise((r) => setTimeout(r, 0));
};

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas();
  stubImage();
  window.history.replaceState(null, "", "/?seed=1337");
  localStorage.removeItem("hexmatch:save");
  localStorage.removeItem("hexmatch:names");
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

async function boot() {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root);
  await settle();
  return hook();
}

/** A corridor from a resource node down to a legal factory row (seed 1337). */
function findSouthCorridor(
  grid: import("../../src/iso/grid").Grid, len = 6,
): { hx: number; hy: number; fy: number } | null {
  for (const ind of grid.industries) {
    for (let x = ind.tx; x < ind.tx + ind.w; x++) {
      const hx = x, hy = ind.ty + ind.h;
      const fy = hy + len;
      if (hy < 0 || fy >= MAP_H || hx < 0 || hx >= MAP_W) continue;
      let ok = true;
      for (let y = hy; y <= fy; y++) {
        const i = y * MAP_W + hx;
        if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) { ok = false; break; }
      }
      if (ok) return { hx, hy, fy };
    }
  }
  return null;
}

/** Boot, then stand a factory + depot joined by dirt — the post-setup world. */
async function connectedBoot() {
  const h = await boot();
  const c = findSouthCorridor(h.grid);
  expect(c).toBeTruthy();
  const { hx, hy, fy } = c!;
  h.eco.factories.push({ owner: "you", ownerId: 1, tx: hx, ty: fy });
  for (let y = hy + 1; y <= fy; y++) buildTile(h.track, "dirt", hx, y, 1);
  // The Depot lands through the REAL placement path (the setup click's twin)
  // so the world sync — draw list, name tags, lorry replan — runs over the
  // fixture, exactly as the live game does it.
  expect(h.placeDepot(hx, hy), "the fixture Depot must be legal on the corridor").toBe(true);
  h.refreshQuarry();
  h.finishSetup();
  await settle();
  return { h, corridor: { hx, hy, fy } };
}

/**
 * The first tile below the Factory's footprint that a REAL drag from the
 * Factory anchor commits as exactly one new track tile — verified with the
 * game's own preview, so the footprint (2×2, PP-15) can never sneak a
 * skipped tile into the expectation.
 */
function firstRoadEnd(h: IsoHook, hx: number, fy: number): number | null {
  for (let y = fy + 2; y < fy + 7; y++) {
    if (y >= MAP_H) break;
    const i = y * MAP_W + hx;
    if (h.grid.terrain[i] === WATER || h.grid.occupancy[i] !== -1) continue;
    const pv = h.dragPreview("dirt", hx, fy, hx, y);
    if (pv && pv.tiles.length === 1 && pv.tiles[0][0] === hx && pv.tiles[0][1] === y) return y;
  }
  return null;
}

/** Dispatch a pointer event pair (down then up) at device-px (sx, sy). */
function clickAt(canvas: HTMLCanvasElement, sx: number, sy: number, button = 0, pointerType = "mouse") {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const type of ["pointerdown", "pointerup"] as const) {
    canvas.dispatchEvent(new PointerEvent(type, {
      clientX: sx / dpr, clientY: sy / dpr,
      pointerType, pointerId: 1, isPrimary: true, button,
    }));
  }
}

// ══════════════════════════════════════════════════════════════════════════
// SELECT — the pointer that builds nothing but reads everything
// ══════════════════════════════════════════════════════════════════════════
describe("INPUT-QOL select: the pointer tool", () => {
  it("is in the Build list, and the button and Q both arm it", async () => {
    const h = await boot();
    const selectBtn = root.querySelector('[data-tool="select"]') as HTMLButtonElement;
    expect(selectBtn).toBeTruthy();
    expect(h.tool).toBe("dirt");   // the default hand is still the Dirt Road

    selectBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(h.tool).toBe("select");

    h.setTool("road");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
    expect(h.tool).toBe("select");
  });

  it("a select click places nothing — no track, no refusal toast", async () => {
    const { h, corridor: { hx, hy } } = await connectedBoot();
    h.setTool("select");
    const canvas = root.querySelectorAll("canvas.iso-layer")[2] as HTMLCanvasElement;

    const dirtBefore = [...h.track.dirt.values()].length;
    // A tile the DIRT tool WOULD build on (next to the network) — the
    // pointer has to leave it alone.
    const tile = h.pickAt(...h.tileScreenAt(hx, hy + 1))!;
    clickAt(canvas, ...h.tileScreenAt(tile.tx, tile.ty));
    await settle();

    expect([...h.track.dirt.values()].length).toBe(dirtBefore);
    expect(root.querySelector(".toasts")!.textContent).not.toMatch(/extend your network/i);
    expect(h.flashTexts()).toEqual([]);
  });

  it("hovering a resource with the pointer highlights it and the inspector names it", async () => {
    const { h } = await connectedBoot();
    h.setTool("select");
    const overlay = root.querySelectorAll("canvas.iso-layer")[2] as HTMLCanvasElement;
    const ind = h.grid.industries[0];
    const def = INDUSTRY_BY_KEY[ind.type];

    // The hover item the overlay paints: a plain highlight (no ghost, no plan).
    const items = h.overlayItemsFor(ind.tx, ind.ty);
    expect(items.some((i) => i.sprite === "highlight" && i.tx === ind.tx && i.ty === ind.ty)).toBe(true);

    // …and after a frame, the inspector panel says WHAT it is.
    const [sx, sy] = h.tileScreenAt(ind.tx, ind.ty);
    overlay.dispatchEvent(new MouseEvent("pointermove", {
      clientX: sx, clientY: sy, pointerType: "mouse", pointerId: 1, bubbles: true,
    }));
    await settle();
    const inspect = root.querySelector(".iso-inspect") as HTMLElement;
    expect(inspect.style.display).toBe("block");
    expect(inspect.textContent).toContain(def.name);
    expect(inspect.textContent).toMatch(/unclaimed|held/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// RIGHT-CLICK — cancel the held tool, back to the pointer
// ══════════════════════════════════════════════════════════════════════════
describe("INPUT-QOL right-click: cancel the tool", () => {
  it("drops any held tool back to the select pointer", async () => {
    const { h, corridor: { hx, hy } } = await connectedBoot();
    const canvas = root.querySelectorAll("canvas.iso-layer")[2] as HTMLCanvasElement;
    const [sx, sy] = h.tileScreenAt(hx, hy);

    for (const tool of ["dirt", "road", "harvester", "plant", "demolish"] as const) {
      h.setTool(tool);
      clickAt(canvas, sx, sy, 2);
      expect(h.tool, `right-click after ${tool}`).toBe("select");
    }
  });

  it("never falls through to a build: a right click lays no track", async () => {
    const { h, corridor: { hx, hy } } = await connectedBoot();
    h.setTool("dirt");
    const canvas = root.querySelectorAll("canvas.iso-layer")[2] as HTMLCanvasElement;
    const dirtBefore = [...h.track.dirt.values()].length;
    const tile = h.pickAt(...h.tileScreenAt(hx, hy + 1))!;
    clickAt(canvas, ...h.tileScreenAt(tile.tx, tile.ty), 2);
    await settle();
    expect([...h.track.dirt.values()].length).toBe(dirtBefore);
  });

  it("suppresses the browser context menu over the map", async () => {
    await boot();
    const canvas = root.querySelectorAll("canvas.iso-layer")[2] as HTMLCanvasElement;
    let prevented = false;
    canvas.addEventListener("contextmenu", (e) => { prevented = e.defaultPrevented; });
    canvas.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(prevented).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// WASD — pan the map from the keyboard
// ══════════════════════════════════════════════════════════════════════════
describe("INPUT-QOL WASD: pan the map", () => {
  it("D pans east, A pans west, and releasing stops the pan", async () => {
    const { h } = await connectedBoot();
    const x0 = h.camera.x;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
    expect(h.panKeys).toContain("d");
    await new Promise((r) => setTimeout(r, 250));   // ~25 frames of pan
    const x1 = h.camera.x;
    expect(x1).toBeGreaterThan(x0);

    window.dispatchEvent(new KeyboardEvent("keyup", { key: "d" }));
    expect(h.panKeys).not.toContain("d");
    const x2 = h.camera.x;
    await new Promise((r) => setTimeout(r, 250));
    expect(h.camera.x).toBe(x2);   // keys up — camera at rest

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    await new Promise((r) => setTimeout(r, 250));
    expect(h.camera.x).toBeLessThan(x2);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "a" }));
  });

  it("W/S pan north/south", async () => {
    const { h } = await connectedBoot();
    const y0 = h.camera.y;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    await new Promise((r) => setTimeout(r, 250));
    expect(h.camera.y).toBeLessThan(y0);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
    const y1 = h.camera.y;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    await new Promise((r) => setTimeout(r, 250));
    expect(h.camera.y).toBeGreaterThan(y1);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "s" }));
  });

  it("does not pan while typing in a field", async () => {
    const { h } = await connectedBoot();
    const sel = root.querySelector("#iso-rival-skill") as HTMLSelectElement;
    expect(sel).toBeTruthy();
    sel.focus();
    sel.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));
    expect(h.panKeys).toEqual([]);
    const x0 = h.camera.x;
    await new Promise((r) => setTimeout(r, 200));
    expect(h.camera.x).toBe(x0);
    sel.blur();
  });

  it("a window blur clears held keys (no pan that sticks)", async () => {
    const { h } = await connectedBoot();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    expect(h.panKeys).toContain("s");
    window.dispatchEvent(new Event("blur"));
    expect(h.panKeys).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NAMES — the tags over the map, and the top-bar switch
// ══════════════════════════════════════════════════════════════════════════
describe("INPUT-QOL names: labels over the map + the Names button", () => {
  it("shows a tag for every industry, town, plant and depot by default", async () => {
    const { h } = await connectedBoot();
    expect(h.showNames).toBe(true);
    const btn = root.querySelector("#iso-names") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.classList.contains("active")).toBe(true);

    const n = h.grid.industries.length + h.grid.towns.length + h.eco.factories.length + h.harvesters.length;
    expect(h.labels.count()).toBe(n);
    expect(h.labels.enabled).toBe(true);
    // The tag text is the REAL vocabulary: the industry's def name, and the
    // owner's plant/depot.
    const texts = h.labels.texts();
    const def = INDUSTRY_BY_KEY[h.grid.industries[0].type];
    expect(texts).toContain(def.name);
    expect(texts).toContain("Town");
    expect(texts).toContain("Your Plant");
    expect(texts).toContain("Your Depot");
    // And the tags are live DOM in the map host (pannable with the camera).
    expect(root.querySelectorAll("#map .iso-label").length).toBe(n);
    expect(root.querySelectorAll("#map .iso-label.hidden").length).toBe(0);
  });

  it("the Names button hides them, and again shows them", async () => {
    const { h } = await connectedBoot();
    const btn = root.querySelector("#iso-names") as HTMLButtonElement;

    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(h.showNames).toBe(false);
    expect(h.labels.enabled).toBe(false);
    await settle();   // the button's pressed state paints on the next frame
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(root.querySelectorAll("#map .iso-label.hidden").length)
      .toBe(h.labels.count());

    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(h.showNames).toBe(true);
    expect(h.labels.enabled).toBe(true);
    await settle();
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelectorAll("#map .iso-label.hidden").length).toBe(0);
  });

  it("remembers the choice in localStorage across boots", async () => {
    const { h } = await connectedBoot();
    (root.querySelector("#iso-names") as HTMLButtonElement)
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(localStorage.getItem("hexmatch:names")).toBe("0");
    dispose?.(); dispose = undefined; await settle();

    const h2 = await boot();
    expect(h2.showNames).toBe(false);
    expect(root.querySelector("#iso-names")!.getAttribute("aria-pressed")).toBe("false");
  });

  it("a newly placed depot gets a tag on the same beat as the world sync", async () => {
    const { h } = await connectedBoot();
    const before = h.labels.count();
    // The fixture already spent the free allowance, so this second Depot
    // pays — fund it like a player who harvested some grain and oil.
    h.purse.grain = 20; h.purse.oil = 20;
    // Find ANY site the CLICK itself would accept: open ground inside some
    // UNCLAIMED resource's 4×4 catchment (PP-16 — the corridor resource is
    // already held by the fixture's connected Depot, so a second Depot by it
    // is refused by design). The probe is the click's own rule.
    let spot: [number, number] | null = null;
    outer: for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const why = h.tileProbe("dirt", x, y);
        if (why.harvester.ok && why.harvester.affordable) { spot = [x, y]; break outer; }
      }
    }
    expect(spot, "an unclaimed Depot site must exist on the map").not.toBeNull();
    const placed = h.placeDepot(spot![0], spot![1]);
    expect(placed).toBe(true);
    // …and the tag appeared in the SAME sync the depot stood up in.
    expect(h.labels.count()).toBe(before + 1);
    expect(h.labels.texts().filter((t) => t === "Your Depot")).toHaveLength(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// BUILD FLASH — the 1-second answer, at the tile that refused
// ══════════════════════════════════════════════════════════════════════════
describe("INPUT-QOL build flash: the 1-second answer on the map", () => {
  it("a road/dirt click on occupied ground flashes the tile itself", async () => {
    const { h } = await connectedBoot();
    h.setTool("dirt");
    const canvas = root.querySelectorAll("canvas.iso-layer")[2] as HTMLCanvasElement;
    const ind = h.grid.industries[0];
    clickAt(canvas, ...h.tileScreenAt(ind.tx, ind.ty));
    await settle();
    expect(h.flashTexts().join(" ")).toMatch(/Tile is occupied/i);
    // The toast still says the same — the flash is the on-map twin.
    expect(root.querySelector(".toasts")!.textContent).toMatch(/occupied/i);
  });

  it("a paved Road drag with no ore flashes 'needs ore' at the drag start", async () => {
    const { h, corridor: { hx, hy } } = await connectedBoot();
    h.purse.ore = 0;
    h.setTool("road");
    const canvas = root.querySelectorAll("canvas.iso-layer")[2] as HTMLCanvasElement;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const [ax, ay] = h.tileScreenAt(hx, hy);
    canvas.dispatchEvent(new PointerEvent("pointerdown", {
      clientX: ax / dpr, clientY: ay / dpr,
      pointerType: "mouse", pointerId: 1, isPrimary: true, button: 0,
    }));
    const [bx, by] = h.tileScreenAt(hx, hy + 1);
    canvas.dispatchEvent(new PointerEvent("pointermove", {
      clientX: bx / dpr, clientY: by / dpr,
      pointerType: "mouse", pointerId: 1, bubbles: true,
    }));
    canvas.dispatchEvent(new PointerEvent("pointerup", {
      clientX: bx / dpr, clientY: by / dpr,
      pointerType: "mouse", pointerId: 1, isPrimary: true, button: 0,
    }));
    await settle();
    expect(h.flashTexts().join(" ")).toMatch(/ore/i);
  });

  it("a successful first road flashes the new end of the line", async () => {
    const { h, corridor: { hx, fy } } = await connectedBoot();
    const end = firstRoadEnd(h, hx, fy);
    expect(end, "a tile to lay the first road on").not.toBeNull();
    const before = h.flashTexts().length;
    const pv = h.dragBuild("dirt", hx, fy, hx, end!);
    expect(pv).toBeTruthy();
    await settle();
    expect(h.flashTexts().length).toBeGreaterThan(before);
    expect(h.flashTexts().join(" ")).toMatch(/Dirt Road laid/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// FIRST ROAD — the guidance banner retires when the first track lands
// ══════════════════════════════════════════════════════════════════════════
describe("INPUT-QOL first road: no popup between the player and the track", () => {
  it("the 'connect your depot' banner shows pre-first-road and retires after it", async () => {
    const { h, corridor: { hx, fy } } = await connectedBoot();
    // The allowance the banner counts down (the corridor above was built
    // through buildTile, which never spends it).
    expect(h.freeTrack).toBe(FREE_SETUP_TRACK);
    await settle();
    let banner = root.querySelector("#iso-banner") as HTMLElement;
    expect(banner).toBeTruthy();
    expect(banner.classList.contains("hidden")).toBe(false);
    expect(banner.textContent).toMatch(/free track tiles/i);

    // …lay the first road through the REAL commit path, one tile past the
    // Factory's footprint…
    const end = firstRoadEnd(h, hx, fy);
    expect(end, "a tile to lay the first road on").not.toBeNull();
    expect(h.dragBuild("dirt", hx, fy, hx, end!)).toBeTruthy();
    await settle();

    // …and the guidance is gone: whatever the banner says next, it is no
    // longer the "connect your depot" line.
    banner = root.querySelector("#iso-banner") as HTMLElement;
    expect(banner.textContent).not.toMatch(/free track tiles/i);
  });
});
