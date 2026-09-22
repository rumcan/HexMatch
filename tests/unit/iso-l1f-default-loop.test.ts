// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// L1f (#237) — the new loop is the game, and the promise says so.
//
// The flip's acceptance block, booted the way a player boots (no options, no
// dev-only URL parameter):
//
//   • a fresh SANDBOX game runs the new loop without any URL parameter — the
//     clock chrome, the free gravel, the loop's ★ line and a board that is DOWN
//     outside a tuning session;
//   • `?loop=old` is the one-release escape hatch, and it is genuinely the old
//     game (always-on board, the paving ★ line, the old prices on the buttons);
//   • `?loop=new` still resolves — it names the default instead of unlocking a
//     hidden one, so an old playtest link keeps working;
//   • the opening copy describes the loop that is actually running: the setup
//     toast speaks the clock, and the How to Play tour — written for the new
//     loop (L15 #230) — opens there and stands nowhere else, so the retired
//     loop is never told "the board is not up otherwise";
//   • a story contract still plays the retired loop, and a boot that never
//     asked for the new one is not told about a refusal it did not request.
//
// The unit harness boots the real module (`startIsoGame`), exactly as the L4 and
// L1e files do, and reads the game's own `window.__iso` hook — the same one the
// e2e specs drive.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { southLotFree } from "./helpers/depot-lot";
import { WATER, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H, VICTORY } from "../../src/iso/config";
import { SAVE_KEY } from "../../src/iso/savegame-runtime";
import { setupDepotToast } from "../../src/iso/game";
import { setRng, mulberry32 } from "../../src/game/config";
import type { Track } from "../../src/iso/track";
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

/** The slice of `window.__iso` this file reads. */
interface LoopHook {
  readonly newLoop: boolean;
  phase: string;
  vpTarget: number;
  vpRates: { newLoop?: boolean; upgrade?: number; plant?: number };
  grid: Grid;
  track: Track;
  eco: import("../../src/iso/economy").EconomyState;
  board: Board;
  finishSetup: () => void;
  placeDepot: (tx: number, ty: number) => boolean;
  refreshQuarry: (now?: number) => unknown;
}

const hook = () => (window as unknown as { __iso: LoopHook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

/** The board's own wrap: `.board-wrap` also matches the reach strip's slot. */
const boardWrap = () => root.querySelector("#iso-quarry .board-slot .board-wrap") as HTMLElement;
const toastText = () =>
  [...root.querySelectorAll(".toast")].map((t) => t.textContent ?? "").join(" ");
/** The sandbox-only note, on screen (it auto-dismisses, so poll for it). */
const sandboxNoteUp = () => toastText().includes("The new loop is sandbox-only for now.");
/** A tool button's whole line — label, sub-line and the price it prints. */
const toolText = (tool: string) =>
  (root.querySelector(`[data-tool="${tool}"]`) as HTMLElement | null)?.textContent ?? "";

/**
 * Boot the way a URL does: `search` is the whole input, no options. Every test
 * here is about what a player who typed (or did not type) something gets.
 */
async function bootUrl(search: string, opts: Record<string, unknown> = {}) {
  window.history.replaceState(null, "", search);
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, opts);
  await settle();
  return hook();
}

beforeEach(() => {
  stubCanvas();
  stubImage();
  localStorage.clear();
  localStorage.setItem("hexmatch:rival-skill", "normal");
  // The tour must be WELCOME on these boots: two of them read its first card.
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

/** A Depot site on seed 1337 with room for a straight road south (L4's shape). */
function depotSite(grid: Grid): { hx: number; hy: number; fy: number } | null {
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
      if (ok && southLotFree(grid, hx, hy)) return { hx, hy, fy };
    }
  }
  return null;
}

describe("L1f the new loop is the default", () => {
  it("a bare URL boots the new loop — no parameter, no option", async () => {
    const h = await bootUrl("/?seed=1337&tutorial=0");
    expect(h.newLoop).toBe(true);
    // The loop's own ★ line, not the shipped one.
    expect(h.vpTarget).toBe(VICTORY.loop.target);
    expect(h.vpRates).toMatchObject({ newLoop: true });
    // …and the board is DOWN until a Depot is being tuned (L4). The shipped
    // loop's board is always up; this is the cheapest proof of which game booted.
    expect(boardWrap().classList.contains("hidden"), "no always-on board").toBe(true);
  });

  it("the chrome a bare boot shows is the loop's: free gravel, no paving ★", async () => {
    await bootUrl("/?seed=1337&tutorial=0");
    // L13 (#228): paving pays nothing, so the Road button sells the lane, not
    // a quarter-star. (Dirt reads "free" on BOTH loops since PP-07 priced the
    // gravel at {} — what moves here is what paving is worth.)
    expect(toolText("road")).toContain("faster hauling");
    expect(toolText("road")).not.toContain(`${VICTORY.upgrade}★`);
    // L5 (#219): a Depot's price is the industry beside it, so the button says
    // where the number comes from rather than quoting one mix.
    expect(toolText("harvester")).toMatch(/from/i);
    // L11 (#226) / L9 (#224): the Black Market is map-only and hangs in the
    // build column. #299: the strip is Bank / Feed ONLY on this loop — the
    // Processing Plant left the tab rail for its own session window, so the
    // third tab is gone and the plant's idle plate rides a small card.
    const tabs = [...root.querySelectorAll("[data-tab]")].map((b) => (b as HTMLElement).dataset.tab);
    expect(tabs).toEqual(["bank", "feed"]);
    expect(root.querySelector('[data-tab="plant"]')).toBeNull();
    expect(root.querySelector("#iso-session")).toBeTruthy();
    expect(root.querySelector("#iso-trade #iso-quarry")).toBeNull();
    expect(root.querySelector(".market-pane")).toBeNull();
    expect(root.querySelector(".aside.left .sab-list")).toBeTruthy();
  });

  it("?loop=old is the escape hatch, and it really is the old game", async () => {
    const h = await bootUrl("/?seed=1337&tutorial=0&loop=old");
    expect(h.newLoop).toBe(false);
    expect(h.vpTarget).toBe(VICTORY.target);
    expect(h.vpRates).toEqual({ upgrade: VICTORY.upgrade, plant: VICTORY.plant, platform: 1 });
    expect(boardWrap().classList.contains("hidden"), "the always-on board is up").toBe(false);
    expect(root.textContent).toContain(`+${VICTORY.upgrade}★ paving dirt`);
  });

  it("?loop=new still resolves — it asks for what is now the default", async () => {
    const h = await bootUrl("/?seed=1337&tutorial=0&loop=new");
    expect(h.newLoop).toBe(true);
    expect(boardWrap().classList.contains("hidden")).toBe(true);
    // A solo boot that was GRANTED the loop hears nothing about it.
    expect(sandboxNoteUp()).toBe(false);
  });
});

describe("L1f the opening copy speaks the loop the game runs", () => {
  // The setup line lives on the map-click path (`setup-harvester` → `play`),
  // which no jsdom harness reaches, so the flip pins the seam instead: the
  // sentence is ONE pair, exported, and the boot's own flag picks it — the
  // pointer handler passes `newLoop` and nothing else.
  it("the setup line a fresh boot gives is the clock, not the tokens", async () => {
    const h = await bootUrl("/?seed=1337&tutorial=0");
    expect(h.newLoop).toBe(true);
    expect(setupDepotToast(h.newLoop)).toMatch(/ticks its cargo in on the clock/i);
    expect(setupDepotToast(h.newLoop)).not.toMatch(/match the tokened gems/i);
    // …and the escape hatch's boot still gets the sentence its loop can keep.
    expect(setupDepotToast(false)).toMatch(/match the tokened gems in the Processing Plant/i);
  });

  it("a fresh boot's opening toasts are the new loop's, tokens included", async () => {
    const h = await bootUrl("/?seed=1337&tutorial=0");
    h.finishSetup();
    const site = depotSite(h.grid);
    expect(site, "seed 1337 keeps an industry with a legal south corridor").toBeTruthy();
    expect(h.placeDepot(site!.hx, site!.hy - 1), "the lot L4 pins on seed 1337").toBe(true);
    await settle();
    // Building the Depot opened a tuning session (L4) — the loop the tour just
    // promised — and nothing on screen sends the player to tokened gems.
    expect(toastText()).toMatch(/Tuning session/i);
    expect(toastText()).not.toMatch(/match the tokened gems/i);
    expect(h.newLoop).toBe(true);
  });

  it("the escape hatch's first Depot opens the always-on board, not a session", async () => {
    const h = await bootUrl("/?seed=1337&tutorial=0&loop=old");
    h.finishSetup();
    const site = depotSite(h.grid);
    expect(h.placeDepot(site!.hx, site!.hy - 1)).toBe(true);
    await settle();
    expect(toastText()).not.toMatch(/Tuning session/i);
    expect(boardWrap().classList.contains("hidden"), "its board is always up").toBe(false);
  });

  it("the tour a first game opens is the tuning session's, and only that", async () => {
    // The ticket's own line: the tour used to say "every delivery stamps a
    // cargo token onto a gem" — the sentence the loop has left behind.
    await bootUrl("/?seed=1337");
    await expect.poll(() => root.querySelector("#iso-tutorial"), { timeout: 5000, interval: 25 })
      .toBeTruthy();
    const card = root.querySelector("#iso-tutorial") as HTMLElement;
    expect(card.getAttribute("data-step")).toBe("loop");
    expect(card.textContent).toMatch(/tuning session/i);
    expect(card.textContent).not.toMatch(/stamps a cargo token/i);
  });

  it("the escape hatch stands no boot tour — the tour belongs to the loop it describes", async () => {
    // L15 (#230) wrote the tour for the new loop ("the board is not up
    // otherwise", the tuning session, the Bank/Feed rail). On `?loop=old`
    // every one of those sentences would lie, so the retired game boots
    // straight to the difficulty prompt instead — and the player's "never"
    // preference is not touched by a card that never stood.
    await bootUrl("/?seed=1337&loop=old");
    await settle();
    await new Promise((r) => setTimeout(r, 300));
    await settle();
    expect(root.querySelector("#iso-tutorial")).toBeNull();
    expect(localStorage.getItem("hexmatch:tutorial")).toBeNull();
    expect(hook().newLoop).toBe(false);
    // …and the always-on board — the thing the tour would have lied about —
    // really is up.
    expect(boardWrap().classList.contains("hidden")).toBe(false);
  });
});

describe("L1f the flip does not reach outside the sandbox", () => {
  /**
   * A contract opens with its briefing, and the note waits behind every boot
   * overlay (see `loopToastPending`), so the ask has to skip it before the
   * frame loop will spend the line. Same dance as #232's test in
   * `iso-game.test.ts`: click the skip, wait the stage's real 260 ms crossfade,
   * then let the frame chain run.
   */
  const clearStage = async () => {
    const skip = root.querySelector(".story-skip") as HTMLElement | null;
    if (skip) skip.click();
    await new Promise((r) => setTimeout(r, 400));
    await settle();
  };

  it("a story contract ignores the new loop and says so when it was asked for", async () => {
    const { chapterById } = await import("../../src/story/chapters");
    const chapter = chapterById("inheritance")!;
    const h = await bootUrl("/?seed=1337&tutorial=0", { story: chapter.id, newLoop: true });
    expect(h.newLoop, "the contract plays the retired loop").toBe(false);
    expect(sandboxNoteUp(), "the note waits for the briefing to come down").toBe(false);
    await clearStage();
    expect(sandboxNoteUp()).toBe(true);
  });

  it("a contract booted by default is not apologised for", async () => {
    // The note used to fire at every refused request — and after #237 every
    // boot of a contract IS a refused default. That would open the campaign
    // with a sentence about a loop the player never asked for, so the note
    // answers a request by name (the option or `?loop=new`) and nothing else.
    const { chapterById } = await import("../../src/story/chapters");
    const chapter = chapterById("inheritance")!;
    const h = await bootUrl("/?seed=1337&tutorial=0", { story: chapter.id });
    expect(h.newLoop).toBe(false);
    await clearStage();
    expect(sandboxNoteUp()).toBe(false);
  });

  it("`?loop=new` in a contract is still a request, and still answered", async () => {
    const { chapterById } = await import("../../src/story/chapters");
    const chapter = chapterById("inheritance")!;
    await bootUrl("/?seed=1337&tutorial=0&loop=new", { story: chapter.id });
    await clearStage();
    expect(sandboxNoteUp()).toBe(true);
  });
});
