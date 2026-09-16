// @vitest-environment jsdom
//
// #187 — "Build mode bar is a huge pop-up that repeats the selected tool,
// and its Cancel button does nothing".
//
// The ticket's acceptance criteria, each one asserted against the code that has
// to satisfy it:
//
//   • The hint is ONE slim line (≈32px) and says only what the Build button
//     cannot — the placement verdict — never a second copy of the tool's name
//     and price.                     → `costInfo` in game.ts + styles.css
//   • Tapping Cancel ✕ hides the hint AND leaves no tool armed: `costInfo` is
//     null, the tool is `select`, the bar stays hidden on the next UI update,
//     and the next map tap inspects instead of building.
//   • Esc, Q, right-click and a re-tap of the armed Build button do the same on
//     desktop — one seam (`cancelPlacement`), so no door can leave a ghost or a
//     half-planned drag behind.
//   • While the phase MANDATES a placement (the opening Factory/Depot) there is
//     no dead ✕ on offer.
//   • On a phone, arming a tool hands the screen back to the map and the
//     held-tool chip carries the verdict where the desktop pill is hidden.
//   • Refusal reasons and prices are still shown before placement — PP-05's
//     price stays on the Build button (iso-depot-cost.test.ts), PP-03's per-tile
//     refusal stays in the inspector (iso-placement.test.ts), PP-06's plant
//     refusal is asserted here.
//
// Same harness as iso-input-qol.test.ts: the REAL startIsoGame in a DOM, a
// stubbed 2D context and image loader, the pinned seed 1337 — so this verifies
// wiring and layout, not pixels.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { southLotFree } from "./helpers/depot-lot";
import { readFileSync } from "node:fs";
import { WATER, factoryTouchesTown } from "../../src/iso/grid";
import { CARGOES, MAP_W, MAP_H } from "../../src/iso/config";
import { setRng, mulberry32 } from "../../src/game/config";

// ── stub the art imports (vite handles these in the browser) ──────────────
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

/** A no-op 2D context: the overlay paints vector gradients, so the gradient
 *  factories must hand back a stop-collector rather than `undefined`. */
function stubCanvas() {
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
  purse: Record<string, number>;
  freeDepots: number;
  grid: import("../../src/iso/grid").Grid;
  track: import("../../src/iso/track").Track;
  eco: import("../../src/iso/economy").EconomyState;
  harvesters: { id: number; owner: string; tx: number; ty: number }[];
  setTool: (t: string) => void;
  placeFactory: (tx: number, ty: number) => boolean;
  placeDepot: (tx: number, ty: number) => boolean;
  placePlant: (tx: number, ty: number) => boolean;
  finishSetup: () => void;
  refreshQuarry: (now?: number) => unknown;
  tileScreenAt: (tx: number, ty: number) => [number, number];
  pickAt: (sx: number, sy: number) => { tx: number; ty: number; sprite: string | null } | null;
}

const hook = () => (window as unknown as { __iso: IsoHook }).__iso;
const settle = async (ms = 12) => { for (let i = 0; i < ms; i++) await new Promise((r) => setTimeout(r, 0)); };

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

/** The phone regime is a viewport question (`isPhoneViewport` in ui.ts), so a
 *  test that wants it has to say so before the chrome measures itself. */
function viewport(w: number, h: number) {
  Object.defineProperty(window, "innerWidth", { value: w, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: h, configurable: true });
}

beforeEach(() => {
  stubCanvas();
  stubImage();
  window.history.replaceState(null, "", "/?seed=1337");
  localStorage.removeItem("hexmatch:save");
  localStorage.setItem("hexmatch:rival-skill", "normal");
  localStorage.setItem("hexmatch:tutorial", "never");
  setRng(mulberry32(1337));
  viewport(1280, 800);
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

/** Boot into the post-setup world, where a tool is a choice and not a debt. */
async function playingBoot() {
  const h = await boot();
  h.finishSetup();
  await settle();
  return h;
}

/** An industry whose SOUTH corridor is legal: Depot tile + `len` road tiles. */
function findSouthCorridor(
  grid: import("../../src/iso/grid").Grid, len = 6,
): { hx: number; hy: number; fy: number } | null {
  for (const ind of grid.industries) {
    for (let x = ind.tx; x < ind.tx + ind.w; x++) {
      const hx = x, hy = ind.ty + ind.h + 1, fy = hy + len;
      if (hy < 0 || fy >= MAP_H || hx < 0 || hx >= MAP_W) continue;
      let ok = true;
      for (let y = hy; y <= fy; y++) {
        const i = y * MAP_W + hx;
        if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) { ok = false; break; }
      }
      if (ok && southLotFree(grid, hx, hy)) return { hx, hy, fy };
    }
  }
  return null;
}

/** A free 2×2 that touches a town edge-on (PP-02), i.e. a legal Factory site. */
function findFactorySpot(grid: import("../../src/iso/grid").Grid): [number, number] | null {
  for (let y = 6; y < MAP_H - 6; y++) {
    for (let x = 6; x < MAP_W - 6; x++) {
      let ok = true;
      for (let dy = 0; dy < 2 && ok; dy++) {
        for (let dx = 0; dx < 2 && ok; dx++) {
          const i = (y + dy) * MAP_W + (x + dx);
          if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) ok = false;
        }
      }
      if (ok && !factoryTouchesTown(grid, x, y)) ok = false;
      if (ok) return [x, y];
    }
  }
  return null;
}

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

/** The HUD's own shell — `startIsoGame` builds a `.ui-root` inside the mount. */
const uiRoot = () => root.querySelector(".ui-root") as HTMLElement;
const bar = () => root.querySelector(".modebar") as HTMLElement;
const cancelBtn = () => bar().querySelector(".mb-cancel") as HTMLButtonElement | null;
const buildBtn = (tool: string) =>
  root.querySelector(`[data-tool="${tool}"]`) as HTMLButtonElement;
const key = (k: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k }));
/** The track arrays are whole-map; a build shows up at `ty * MAP_W + tx`. */
const idx = (tx: number, ty: number) => ty * MAP_W + tx;
/**
 * A purse that can buy anything. The Build sheet DISABLES a button the purse
 * cannot pay (PP-05's price is a promise, not a surprise), and a disabled
 * button does not arm its tool — so a test about the toggle has to be able to
 * afford the tool it toggles.
 */
const rich = (h: IsoHook) => { for (const c of CARGOES) h.purse[c] = 99; };

// ══════════════════════════════════════════════════════════════════════════
// 1. ONE SLIM LINE — the verdict, not a second copy of the button
// ══════════════════════════════════════════════════════════════════════════
describe("#187 the placement hint is one slim line", () => {
  it("carries the Depot's site rule, and leaves the name and price to the button", async () => {
    const h = await playingBoot();
    h.setTool("harvester");
    await settle();

    expect(bar().classList.contains("hidden"), "the hint stands while a tool is armed").toBe(false);
    expect(bar().querySelectorAll(".mb-txt").length, "one line, one verdict").toBe(1);
    expect(bar().textContent).toMatch(/catchment/);
    // The complaint: "it repeats the tool you just tapped and its cost, both
    // already shown on the build button". Neither is the hint's job any more…
    expect(bar().textContent).not.toMatch(/Depot/i);
    expect(bar().querySelectorAll("img.cargo-ic").length).toBe(0);
    // …because the button still states the complete price before the click
    // (PP-05/PP-07), which is where the ticket says it belongs.
    const price = buildBtn("harvester").querySelector("small")!;
    expect(price.textContent).toMatch(/free setup/);
    expect(price.querySelectorAll("img.cargo-ic").length).toBe(4);
  });

  it("answers a purse that cannot pay with the shortfall — the refusal IS the verdict", async () => {
    const h = await playingBoot();
    const c = findSouthCorridor(h.grid)!;
    expect(h.placeDepot(c.hx, c.hy - 1)).toBe(true);   // spends the free allowance
    h.purse.grain = 0; h.purse.wood = 0; h.purse.stone = 0; h.purse.oil = 0;
    h.setTool("harvester");
    await settle();

    expect(bar().textContent).toMatch(/needs/i);
    expect(bar().querySelector('img.cargo-ic[alt="Oil"]'), "the missing cargo, as its gem").toBeTruthy();
    expect(bar().textContent).not.toMatch(/catchment/);   // the rule yields to the refusal
  });

  it("keeps PP-06's plant refusal — the only place it is spelled out before the click", async () => {
    const h = await playingBoot();
    h.setTool("plant");
    // A tile no town touches: the plan refuses, and the hint says why in words.
    const c = findSouthCorridor(h.grid)!;
    pointer("pointermove", ...h.tileScreenAt(c.hx, c.fy));
    await settle();
    expect(bar().classList.contains("hidden")).toBe(false);
    expect(bar().textContent).toMatch(/must be built next to a town|off the map|water|taken|already stands|track/i);
  });

  it("and a legal plant site answers with the point it is worth, not the tool's name", async () => {
    const h = await playingBoot();
    rich(h);
    await settle();
    h.setTool("plant");
    const spot = findFactorySpot(h.grid)!;         // a free 2×2 touching a town
    pointer("pointermove", ...h.tileScreenAt(spot[0], spot[1]));
    await settle();
    expect(bar().textContent).toMatch(/ready to raise/);
    expect(bar().textContent).toMatch(/\+1★/);     // VP-01: no button states this
    expect(bar().textContent).not.toMatch(/Processing Plant/i);
  });

  it("prices a road drag in the same line: tiles, ★ and what the drag charges", async () => {
    const h = await playingBoot();
    h.setTool("road");
    const c = findSouthCorridor(h.grid)!;
    const [ax, ay] = h.tileScreenAt(c.hx, c.hy + 1);
    const [bx, by] = h.tileScreenAt(c.hx, c.hy + 3);
    pointer("pointerdown", ax, ay);
    pointer("pointermove", bx, by);
    await settle();

    // The drag's own numbers — a per-tile price on a button cannot state these.
    expect(bar().textContent).toMatch(/tiles/);
    expect(bar().textContent).toMatch(/★/);
    expect(bar().textContent).toMatch(/\+0★|paves/);   // VP-01: the rule, out loud
    expect(bar().querySelectorAll(".mb-txt").length, "still one line").toBe(1);
  });

  it("is a 32px, non-wrapping, click-through box — and steps aside on a phone", () => {
    const css = readFileSync("src/game/styles.css", "utf8");
    const bodies = (sel: string): string[] => {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(^|[},\\s])${esc}(?=[\\s,{])`, "gm");
      const out: string[] = [];
      for (let m = re.exec(css); m; m = re.exec(css)) {
        const open = css.indexOf("{", m.index);
        const close = open < 0 ? -1 : css.indexOf("}", open);
        if (close > open) out.push(css.slice(open + 1, close));
      }
      return out;
    };
    /** Every `@media <query> { … }` block, braces counted (rules nest). */
    const mediaBlocks = (query: string): string[] => {
      const out: string[] = [];
      for (let i = css.indexOf(query); i >= 0; i = css.indexOf(query, i + 1)) {
        const start = css.indexOf("{", i);
        let depth = 0, j = start;
        for (; j < css.length; j++) {
          if (css[j] === "{") depth++;
          else if (css[j] === "}" && --depth === 0) break;
        }
        out.push(css.slice(start + 1, j));
      }
      return out;
    };
    const box = bodies(".modebar").find((b) => /position:\s*fixed/.test(b))!;
    expect(box, ".modebar has no box").toBeTruthy();
    // "The hint takes at most one line (≈32px)" — pinned at the source, because
    // the whole ticket is about how much screen this box used to take.
    expect(box).toMatch(/height:\s*32px/);
    expect(box).toMatch(/white-space:\s*nowrap/);
    expect(box).toMatch(/pointer-events:\s*none/);
    expect(box).not.toMatch(/flex-wrap:\s*wrap/);
    // The ✕ is the one part that takes a click…
    expect(bodies(".mb-cancel").some((b) => /pointer-events:\s*auto/.test(b))).toBe(true);
    // …and where the held-tool chip is the hint instead, the pill leaves the
    // screen: ONE media pair drives both halves of the swap, so a regime can
    // never end up with two pills stacked over the map (the old bug) or with
    // neither and no way to put a tool down.
    const swap = mediaBlocks("@media (pointer: coarse), (max-width: 760px)").join("\n");
    expect(swap).toMatch(/\.toolchip:not\(\.hidden\) \{ display: flex; \}/);
    expect(swap).toMatch(/\.modebar \{ display: none !important; \}/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. CANCEL REALLY CANCELS
// ══════════════════════════════════════════════════════════════════════════
describe("#187 Cancel ✕ disarms the tool instead of hiding a class", () => {
  it("the ✕ clears costInfo, leaves `select` in the hand, and the bar stays down", async () => {
    const h = await playingBoot();
    h.setTool("harvester");
    await settle();
    expect(bar().classList.contains("hidden")).toBe(false);
    expect(cancelBtn(), "a cancel is offered while placing is a choice").toBeTruthy();

    cancelBtn()!.click();
    expect(h.tool, "the tool is disarmed at once").toBe("select");
    await settle();
    // …and it STAYS down: the old ✕ only added a class that the next frame's
    // `toggle("hidden", !info)` took straight back off.
    expect(bar().classList.contains("hidden"), "the bar is hidden on the next UI update").toBe(true);
    expect(bar().textContent, "costInfo is null, so the bar is empty").toBe("");
    expect(cancelBtn()).toBeNull();
  });

  it("the next map tap inspects instead of building", async () => {
    const h = await playingBoot();
    const c = findSouthCorridor(h.grid)!;
    const depots = h.harvesters.length;
    h.setTool("harvester");
    await settle();
    cancelBtn()!.click();
    await settle();

    // The legal Depot site, on screen and pickable…
    const [sx, sy] = h.tileScreenAt(c.hx, c.hy);
    expect(h.pickAt(sx, sy)?.tx, "the tap lands on the corridor tile").toBe(c.hx);
    pointer("pointerdown", sx, sy);
    pointer("pointerup", sx, sy);
    await settle();
    expect(h.harvesters.length, "a cancelled tool builds nothing there").toBe(depots);
    expect(h.tool).toBe("select");

    // …and the pointer now does what the pointer does: it reads the tile. The
    // industry beside the corridor names itself in the inspector card, which is
    // the "returns to the select/inspect tool" half of the ticket.
    const ind = h.grid.industries[0];
    const [ix, iy] = h.tileScreenAt(ind.tx, ind.ty);
    expect(h.pickAt(ix, iy)?.tx, "the industry is on screen too").toBe(ind.tx);
    pointer("pointermove", ix, iy);
    await settle();
    const inspect = root.querySelector(".iso-inspect") as HTMLElement;
    expect(inspect.style.display).toBe("block");
    expect(inspect.textContent!.length).toBeGreaterThan(0);
  });

  it("Esc, Q, the right button and a re-tap of the armed button each do the same", async () => {
    const h = await playingBoot();
    const c = findSouthCorridor(h.grid)!;
    const [sx, sy] = h.tileScreenAt(c.hx, c.hy);

    const doors: [string, () => void][] = [
      ["Esc", () => key("Escape")],
      ["Q", () => key("q")],
      ["right-click", () => { pointer("pointerdown", sx, sy, 2); pointer("pointerup", sx, sy, 2); }],
      ["re-tap", () => buildBtn("harvester").click()],
      ["Select button", () => buildBtn("select").click()],
    ];
    for (const [name, fire] of doors) {
      h.setTool("harvester");
      await settle();
      expect(bar().classList.contains("hidden"), `${name}: armed`).toBe(false);
      fire();
      expect(h.tool, `${name} leaves the pointer in the hand`).toBe("select");
      await settle();
      expect(bar().classList.contains("hidden"), `${name} hides the hint`).toBe(true);
      expect(bar().textContent, `${name} clears costInfo`).toBe("");
    }
  });

  it("a cancel mid-drag takes the preview with it, so the finger comes up building nothing", async () => {
    const h = await playingBoot();
    h.setTool("dirt");
    await settle();
    const c = findSouthCorridor(h.grid)!;
    const [ax, ay] = h.tileScreenAt(c.hx, c.hy + 1);
    const [bx, by] = h.tileScreenAt(c.hx, c.hy + 4);
    pointer("pointerdown", ax, ay);
    pointer("pointermove", bx, by);
    await settle();
    expect(bar().textContent, "the drag is priced while it is armed").toMatch(/tiles/);

    key("Escape");                     // the desktop twin of the ✕
    expect(h.tool).toBe("select");
    pointer("pointerup", bx, by);      // the gesture finishes AFTER the cancel
    await settle();

    for (let y = c.hy + 1; y <= c.hy + 4; y++) {
      expect(h.track.dirt[idx(c.hx, y)], `no gravel at ${c.hx},${y}`).toBe(0);
      expect(h.track.owner[idx(c.hx, y)], `nothing claimed at ${c.hx},${y}`).toBe(0);
    }
    expect(bar().classList.contains("hidden")).toBe(true);
    expect(bar().textContent).toBe("");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. NO DEAD BUTTON — a mandatory placement has nothing to cancel
// ══════════════════════════════════════════════════════════════════════════
describe("#187 the setup phases hide Cancel instead of showing a dead ✕", () => {
  it("while the opening Factory is owed", async () => {
    const h = await boot();
    expect(h.phase).toBe("setup-factory");
    h.setTool("harvester");
    await settle();
    expect(bar().classList.contains("hidden"), "the rule still shows").toBe(false);
    expect(cancelBtn(), "no cancel while placing is mandatory").toBeNull();
    // …and the Build button does not toggle the tool off either.
    buildBtn("harvester").click();
    await settle();
    expect(h.tool).toBe("harvester");
  });

  it("while the opening Depot is owed", async () => {
    const h = await boot();
    const spot = findFactorySpot(h.grid)!;
    expect(h.placeFactory(spot[0], spot[1])).toBe(true);
    await settle();
    expect(h.phase).toBe("setup-harvester");
    // The hint stands on the phase alone — no tool needs to be armed for it.
    expect(bar().classList.contains("hidden")).toBe(false);
    expect(bar().textContent).toMatch(/catchment/);
    expect(cancelBtn()).toBeNull();
  });

  it("refuses the Processing Plant while the opening Depot is owed", async () => {
    const h = await boot();
    const spot = findFactorySpot(h.grid)!;
    expect(h.placeFactory(spot[0], spot[1])).toBe(true);
    h.setTool("harvester");
    await settle();
    expect(h.phase).toBe("setup-harvester");
    // Every click in this phase places the Depot, so the plant must not arm.
    buildBtn("plant").click();
    await settle();
    expect(h.tool, "the Depot stays in the hand").toBe("harvester");
    expect(buildBtn("plant").classList.contains("locked")).toBe(true);
    expect(buildBtn("harvester").classList.contains("locked")).toBe(false);
  });

  it("and grows its ✕ back the moment the debt is paid", async () => {
    const h = await boot();
    const spot = findFactorySpot(h.grid)!;
    expect(h.placeFactory(spot[0], spot[1])).toBe(true);   // → setup-harvester
    // The opening Depot is paid by a real click on the map — that click is
    // what advances the phase, not the placement call alone.
    const c = findSouthCorridor(h.grid)!;
    // the click lands on the 2×2 lot's origin (top) tile
    const [dx, dy] = h.tileScreenAt(c.hx, c.hy - 1);
    expect(h.pickAt(dx, dy)?.tx, "the site is on screen").toBe(c.hx);
    pointer("pointerdown", dx, dy);
    pointer("pointerup", dx, dy);
    await settle();
    expect(h.phase, "the debt is paid").toBe("play");
    h.setTool("harvester");
    await settle();
    expect(cancelBtn(), "placing is a choice again").toBeTruthy();
    cancelBtn()!.click();
    await settle();
    expect(h.tool).toBe("select");
    expect(bar().classList.contains("hidden")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. A PHONE KEEPS THE MAP — the sheet collapses, the chip carries the verdict
// ══════════════════════════════════════════════════════════════════════════
describe("#187 on a phone the map keeps the screen while placing", () => {
  it("arming a tool from the Build sheet hands the screen back to the map", async () => {
    viewport(390, 780);
    const h = await playingBoot();
    (root.querySelector('.mnav-btn[data-view="build"]') as HTMLElement).click();
    expect(uiRoot().dataset.view).toBe("build");

    buildBtn("harvester").click();
    expect(h.tool).toBe("harvester");
    await settle();
    expect(uiRoot().dataset.view, "the sheet collapses so the map is visible").toBe("map");
  });

  it("the held-tool chip is the hint there: name, verdict, and a ✕ that works", async () => {
    viewport(390, 780);
    const h = await playingBoot();
    buildBtn("harvester").click();
    await settle();

    const chip = root.querySelector(".toolchip") as HTMLElement;
    expect(chip.classList.contains("hidden")).toBe(false);
    expect(chip.querySelector(".tc-label")!.textContent).toBe("Depot");
    expect(chip.querySelector(".tc-hint")!.textContent).toMatch(/catchment/);
    expect(chip.getAttribute("aria-label")).toMatch(/put the Depot tool down/i);

    chip.click();                                  // the touch twin of the ✕
    expect(h.tool).toBe("select");
    await settle();
    expect(chip.classList.contains("hidden"), "the chip goes with the tool").toBe(true);
    expect(chip.querySelector(".tc-hint")!.textContent).toBe("");
  });

  it("a re-tap of the armed Build button cancels there too", async () => {
    viewport(390, 780);
    const h = await playingBoot();
    rich(h);                                       // a paved Road costs Ore
    await settle();
    buildBtn("road").click();
    await settle();
    expect(h.tool).toBe("road");
    expect(uiRoot().dataset.view).toBe("map");

    (root.querySelector('.mnav-btn[data-view="build"]') as HTMLElement).click();
    expect(uiRoot().dataset.view, "reopening the sheet is the player's call").toBe("build");
    buildBtn("road").click();                      // the armed button, again
    expect(h.tool).toBe("select");
    await settle();
    expect(uiRoot().dataset.view, "and the sheet stays open — a toggle is not a trap").toBe("build");
  });
});
