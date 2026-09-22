// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// #299 — the tuning session is its own WINDOW, not a right-rail tab.
//
// The ticket's acceptance block, at the level jsdom can observe (the pixels
// and the backdrop's hit-testing belong to the e2e specs):
//
//   • placing a Depot opens `#iso-session` — the plant panel, the plate and
//     the board are hosted INSIDE the window, over the map, and the map/rails
//     go inert behind it until it closes;
//   • the right rail has no Plant tab on this loop — the strip is Bank and
//     Feed only, on desktop and phone alike;
//   • the ♻ Reset button and the combo bank are not visible outside a
//     session: between sessions the whole plant panel sits in a hidden
//     window, and the rail carries only the plate's idle half (the one line,
//     the Retune key, the city key);
//   • a city-upgrade session uses the same window (title says "the City");
//   • abandoning closes the window and hands the map back — and on the
//     RETIRED loop none of this is touched at all: the Plant tab and the
//     always-on board stay exactly as they shipped.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { southLotFree } from "./helpers/depot-lot";
import { WATER, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import type { Track } from "../../src/iso/track";
import { setRng, mulberry32 } from "../../src/game/config";
import { SAVE_KEY } from "../../src/iso/savegame-runtime";
import { TOWN_UPGRADES, type Cargo } from "../../src/iso/config";
import type { Board } from "../../src/game/board";

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
interface SessionHook {
  readonly newLoop: boolean;
  grid: Grid;
  track: Track;
  board: Board;
  purse: Record<string, number>;
  finishSetup: () => void;
  placeDepot: (tx: number, ty: number) => boolean;
  buyTownUpgrade: () => boolean;
  readonly tuning: { kind: "depot" | "town"; depotId: number } | null;
  tuningFinish: (abandon?: boolean) => void;
}

const hook = () => (window as unknown as { __iso: SessionHook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

/** The session window and its parts, by the ids #299 mints. */
const win = () => root.querySelector("#iso-session") as HTMLElement | null;
const frame = () => root.querySelector("#iso-session .session-frame") as HTMLElement | null;
const isUp = () => !!win() && !win()!.classList.contains("hidden");
const rail = () => root.querySelector("#iso-aside-right") as HTMLElement;
const plantCard = () => root.querySelector("#iso-plant") as HTMLElement;
/** Anything inside the window — the frame and its backdrop, both. */
const winHas = (sel: string) => !!win()?.querySelector(sel);

/** A Depot site on seed 1337 with room for a straight road south (L4's shape). */
function depotSite(grid: Grid): { hx: number; hy: number } | null {
  for (const ind of grid.industries) {
    for (let x = ind.tx; x < ind.tx + ind.w; x++) {
      const hx = x, hy = ind.ty + ind.h + 1;
      const fy = hy + 6;
      if (hy < 0 || fy >= MAP_H || hx < 0 || hx >= MAP_W) continue;
      let ok = true;
      for (let y = hy; y <= fy; y++) {
        const i = y * MAP_W + hx;
        if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) { ok = false; break; }
      }
      if (ok && southLotFree(grid, hx, hy)) return { hx, hy };
    }
  }
  return null;
}

async function boot(opts: { newLoop?: boolean } = {}) {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, opts);
  await settle();
  return hook();
}

beforeEach(() => {
  stubCanvas();
  stubImage();
  // Like the L4/L5 files: the URL sits on the retired loop's hatch and the
  // new-loop tests SAY so (`{ newLoop: true }`) — the loop is then pinned by
  // the option, and the tests that care about the hatch can boot without it.
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

describe("#299 the session window on the new loop", () => {
  it("has no Plant tab: the rail strip is Bank and Feed, nothing else", async () => {
    await boot({ newLoop: true });
    const tabs = [...root.querySelectorAll<HTMLElement>("[data-tab]")].map((b) => b.dataset.tab);
    expect(tabs).toEqual(["bank", "feed"]);
    // …and the plant panel is not a pane of the rail — the tab strip has no
    // plant button to open and `#iso-quarry` lives inside the window.
    expect(root.querySelector("#iso-trade #iso-quarry")).toBeNull();
    expect(root.querySelector("#iso-session #iso-quarry")).toBeTruthy();
  });

  it("boots with the window down: board, combo and Reset are not visible", async () => {
    await boot({ newLoop: true });
    expect(win()).toBeTruthy();
    expect(isUp(), "the window waits closed for the first Depot").toBe(false);
    // The plant panel (with its combo bank and ♻ Reset) hides with it, and
    // the board itself is down besides.
    const qp = root.querySelector("#iso-quarry") as HTMLElement;
    expect(qp.classList.contains("hidden")).toBe(true);
    expect(root.querySelector(".reset-btn")).toBeTruthy();
    expect(qp.contains(root.querySelector(".reset-btn")!)).toBe(true);
    const board = root.querySelector("#iso-quarry .board-slot .board-wrap") as HTMLElement;
    expect(board.classList.contains("hidden")).toBe(true);
    // …while the rail's plant card holds the idle plate and says what opens a
    // session. The Retune key and the city key ride that card, not the window.
    const card = plantCard();
    expect(card.classList.contains("hidden")).toBe(false);
    expect(card.textContent).toContain("No tuning session");
    expect(card.contains(root.querySelector("#iso-tuning-retune")!)).toBe(true);
    expect(card.contains(root.querySelector(".tp-city")!)).toBe(true);
  });

  it("placing a Depot opens the window over the map and locks the map down", async () => {
    const h = await boot({ newLoop: true });
    expect(h.newLoop).toBe(true);
    h.finishSetup();
    await settle();
    const site = depotSite(h.grid);
    expect(site, "seed 1337 keeps a legal Depot lot").toBeTruthy();
    // The lot one row under the industry is where the L4 file places its Depot.
    expect(h.placeDepot(site!.hx, site!.hy - 1)).toBe(true);
    await settle();
    // The session opened (L4's rule) — and with it, the WINDOW: plant panel,
    // plate and board are all inside it, over the map.
    expect(h.tuning, "the tuning session is live").toBeTruthy();
    expect(isUp(), "the session window is up").toBe(true);
    expect(winHas("#iso-quarry")).toBe(true);
    // The plate rides at the TOP of the plant panel — the re-mount must keep
    // it ahead of the board, not trail after it.
    const qp = root.querySelector("#iso-quarry")!;
    const plateEl = root.querySelector("#iso-tuning")!;
    expect([...qp.children].indexOf(plateEl), "plate sits right under the head").toBe(1);
    expect(winHas(".session-back"), "the backdrop blocks the map").toBe(true);
    expect(winHas(".board-slot .board-wrap")).toBe(true);
    const board = root.querySelector("#iso-quarry .board-slot .board-wrap") as HTMLElement;
    expect(board.classList.contains("hidden"), "the board is up").toBe(false);
    // The map and both rails are inert behind it: "the map is blocked until
    // it closes" is DOM-enforced, not a stylesheet trick.
    expect((root.querySelector("#map") as HTMLElement).inert).toBe(true);
    expect((root.querySelector("#iso-aside-left") as HTMLElement).inert).toBe(true);
    expect(rail().inert).toBe(true);
    // The plate moved INTO the window, and it owns the session's two doors
    // and the readout the ticket asks the window to carry.
    expect(winHas("#iso-tuning")).toBe(true);
    expect(plantCard().classList.contains("hidden"), "the rail card steps aside").toBe(true);
    const title = root.querySelector(".tp-title")!.textContent ?? "";
    expect(title).toMatch(/Tuning .* Depot/);
    expect(root.querySelector(".tp-moves")!.textContent).toMatch(/moves/);
    expect(root.querySelector(".tp-score")!.textContent).toMatch(/Score/);
    expect(root.querySelector(".tp-yield")!.textContent).toMatch(/Yield/);
    expect(root.querySelector(".tp-finish")).toBeTruthy();
    expect(root.querySelector(".tp-abandon")).toBeTruthy();
    // Backdrop clicks do NOT close it — a session leaves through its doors.
    const back = root.querySelector(".session-back") as HTMLElement;
    back.click();
    await settle();
    expect(isUp(), "a backdrop press is refused, not an exit").toBe(true);
    expect(h.tuning, "the session is still live").toBeTruthy();
  });

  it("abandoning closes the window and hands the map back", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    await settle();
    const site = depotSite(h.grid);
    expect(h.placeDepot(site!.hx, site!.hy - 1)).toBe(true);
    await settle();
    expect(isUp()).toBe(true);
    // #301's door, #299's frame: Abandon with nothing scored closes at once.
    (root.querySelector(".tp-abandon") as HTMLButtonElement).click();
    await settle();
    expect(h.tuning, "the session is gone").toBeNull();
    expect(isUp(), "the window came down with it").toBe(false);
    expect((root.querySelector("#map") as HTMLElement).inert, "the map wakes").toBe(false);
    expect(rail().inert).toBe(false);
    // The plate rides home to the rail card, and the board is down again.
    expect(plantCard().contains(root.querySelector("#iso-tuning"))).toBe(true);
    const board = root.querySelector("#iso-quarry .board-slot .board-wrap") as HTMLElement;
    expect(board.classList.contains("hidden")).toBe(true);
  });

  it("a city-upgrade session uses the same window and titles it the City", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    await settle();
    // The bank block on the map is the door; the chrome's key and this hook
    // run the same `buyTownUpgrade` — the purse is made ready so the first
    // row's price is a fact, not a flake.
    const row = TOWN_UPGRADES[0];
    expect(row, "the city has an upgrade line to buy").toBeTruthy();
    for (const [c, n] of Object.entries(row.cost) as [Cargo, number][]) h.purse[c] = n;
    await settle();
    expect(h.buyTownUpgrade()).toBe(true);
    await settle();
    expect(h.tuning?.kind, "the town session is live").toBe("town");
    expect(isUp(), "the SAME window stands up for it").toBe(true);
    expect(winHas("#iso-tuning"), "its plate is the window's header").toBe(true);
    expect(root.querySelector(".tp-title")!.textContent).toContain("Tuning the City");
    // Abandon refunds and closes — one door out, one frame for both.
    h.tuningFinish(true);
    await settle();
    expect(isUp(), "the window comes down for the city too").toBe(false);
  });
});

describe("#299 the retired loop keeps its rail plant", () => {
  it("still hosts the always-on board in the tab strip, with no window at all", async () => {
    const h = await boot();
    expect(h.newLoop).toBe(false);
    // The strip is what it was; the plant panel is its pane; no window was
    // even built, so nothing can open over the map on this loop.
    const tabs = [...root.querySelectorAll<HTMLElement>("[data-tab]")].map((b) => b.dataset.tab);
    expect(tabs).toEqual(["bank", "plant", "feed"]);
    expect(root.querySelector("#iso-trade #iso-quarry")).toBeTruthy();
    expect(win()).toBeNull();
    expect(plantCard()).toBeNull();
    // The boot lands on the plant tab, the board is up, and Reset and the
    // combo bank ride the always-on panel exactly as they shipped.
    const board = root.querySelector("#iso-quarry .board-slot .board-wrap") as HTMLElement;
    expect(board.classList.contains("hidden")).toBe(false);
    expect((root.querySelector("#iso-quarry") as HTMLElement).classList.contains("hidden")).toBe(false);
    // Clicking Feed hides the plant pane the way the old loop always did.
    (root.querySelector('[data-tab="feed"]') as HTMLElement).click();
    expect((root.querySelector("#iso-quarry") as HTMLElement).classList.contains("hidden")).toBe(true);
  });
});
