// @vitest-environment jsdom
//
// E11 — boots the REAL game module in a DOM and plays it. This is the test
// that would have caught "it typechecks but the screen is black": it mounts
// startIsoGame, drives the setup phase, lays track, and asserts VP is scored.
//
// Canvas is stubbed rather than using a real 2D context (jsdom has none), so
// this verifies wiring and game logic, not pixels. Pixel correctness is what
// the committed-reference-PNG fixture is for, and that still needs a browser.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WATER } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/iso/config";
import { setRng, mulberry32 } from "../../src/game/config";

// ── stub the art imports (vite handles these in the browser) ──────────────
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

/** A no-op 2D context good enough for the renderer's call pattern. */
function stubCanvas() {
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "canvas") return null;
      if (prop === "imageSmoothingEnabled") return false;
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
  vp: { you: number; ai: number };
  purse: Record<string, number>;
  harvesters: { id: number; owner: string; tx: number; ty: number }[];
  factories: { owner: string; tx: number; ty: number }[];
  freeTrack: number;
  grid: import("../../src/iso/grid").Grid;
  track: import("../../src/iso/track").Track;
  eco: import("../../src/iso/economy").EconomyState;
  /** J1: the mounted match-3 board and what the network lets it pay. */
  board: import("../../src/game/board").Board;
  reach: Record<string, number>;
  quarry: import("../../src/iso/quarry").Quarry;
  market: import("../../src/iso/market").IsoMarket;
  refreshQuarry: (now?: number) => unknown;
  setTool: (t: string) => void;
}

const hook = () => (window as unknown as { __iso: IsoHook }).__iso;

/** Wait for the async atlas load + first frame. */
const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas();
  stubImage();
  // Pin the map seed and the game RNG. Without this the map is drawn fresh
  // every boot, and on some seeds no industry has a legal south corridor, so
  // `findSouthCorridor` returns null and the whole "full round" block fails —
  // a flake that predates J1. Same seed the e2e suite boots with.
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

describe("E11 the game boots", () => {
  it("mounts three canvas layers and a tool bar", async () => {
    await boot();
    expect(root.querySelectorAll("canvas")).toHaveLength(3);
    const tools = [...root.querySelectorAll("[data-tool]")].map(
      (b) => (b as HTMLElement).dataset.tool);
    expect(tools).toEqual(["road", "rail", "harvester", "demolish"]);
  });

  it("starts in the factory-placement phase with a real map", async () => {
    const h = await boot();
    expect(h.phase).toBe("setup-factory");
    expect(h.grid.industries.length).toBeGreaterThan(0);
    expect(h.factories).toHaveLength(0);
    expect(h.freeTrack).toBe(12);
    expect(h.purse.ore ?? 0).toBe(0);
    expect(h.purse.stone ?? 0).toBeGreaterThan(0);
  });

  it("exposes a banner telling the player what to do", async () => {
    await boot();
    const banner = root.querySelector("#iso-banner") as HTMLElement;
    expect(banner.textContent).toMatch(/place your factory/i);
  });

  it("cleans up after itself", async () => {
    await boot();
    dispose!();
    dispose = undefined;
    expect(root.querySelectorAll("canvas")).toHaveLength(0);
  });
});

// ── driving the game through its own module API ───────────────────────────
// The pointer path is pixel-driven and needs a real renderer to pick tiles, so
// these drive the same state the click handlers mutate, via the test hook.

/**
 * Find an industry whose SOUTH corridor is legal: the harvester tile just
 * below its footprint plus 6 road tiles under it all stay inside the map and
 * off water. The map is 48×48 and generated under a RANDOM seed each boot, so
 * `industries[0]` alone is not safe — when it sits near the bottom edge the
 * factory tile lands at fy ≥ MAP_H and the round can never score (a flaky
 * failure that depends on the seed). Prefer a corridor like the cargo test:
 * no single industry is special, so scanning is not a cheat.
 */
function findSouthCorridor(grid: import("../../src/iso/grid").Grid):
  { hx: number; hy: number; fy: number } | null {
  for (const ind of grid.industries) {
    const hx = ind.tx, hy = ind.ty + ind.h;
    const fy = hy + 6;
    if (hy < 0 || fy >= MAP_H || hx < 0 || hx >= MAP_W) continue;
    let ok = true;
    for (let y = hy; y <= fy; y++) {
      if (grid.terrain[y * MAP_W + hx] === WATER) { ok = false; break; }
    }
    if (ok) return { hx, hy, fy };
  }
  return null;
}

describe("E11 a full round is playable", () => {
  it("setup → connect → score, end to end", async () => {
    const h = await boot();
    const {
      createTrack: _c, buildTile,
    } = await import("../../src/iso/track");
    const { rescore, createScoreState, vpFor, isServiced, industriesInCatchment } =
      await import("../../src/iso/economy");

    // a real industry with a legal harvester spot beside it
    const c = findSouthCorridor(h.grid);
    expect(c).toBeTruthy();
    const { hx, hy, fy } = c!;

    h.eco.factories.push({ owner: "you", tx: hx, ty: fy });
    const harv = { id: 1, owner: "you", tx: hx, ty: hy };
    h.eco.harvesters.push(harv);

    // catchment must actually see the industry
    expect(industriesInCatchment(h.grid, harv).length).toBeGreaterThan(0);

    // no track yet → unserviced, no VP
    const score = createScoreState();
    expect(isServiced(h.track, harv)).toBe(false);
    expect(rescore(h.eco, score)).toEqual([]);

    // lay a road from the harvester to the factory
    for (let y = hy + 1; y <= fy; y++) buildTile(h.track, "road", hx, y);
    expect(isServiced(h.track, harv)).toBe(true);

    const events = rescore(h.eco, score);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "awarded", to: "road", delta: 1 });
    expect(vpFor(score, "you")).toBe(1);
  });

  it("produces cargo once connected, and stops when the line is cut", async () => {
    const h = await boot();
    const { buildTile, demolishTile } = await import("../../src/iso/track");
    const { playerResources } = await import("../../src/iso/economy");

    const c = findSouthCorridor(h.grid);
    expect(c).toBeTruthy();
    const { hx, hy, fy } = c!;
    h.eco.factories.push({ owner: "you", tx: hx, ty: fy });
    h.eco.harvesters.push({ id: 1, owner: "you", tx: hx, ty: hy });
    for (let y = hy + 1; y <= fy; y++) buildTile(h.track, "road", hx, y);

    const before = playerResources(h.eco, "you", 0);
    expect(Object.keys(before).length).toBeGreaterThan(0);

    demolishTile(h.track, "road", hx, hy + 3);   // cut it mid-path
    expect(playerResources(h.eco, "you", 0)).toEqual({});
  });

  it("the AI can plan and build on the real generated map", async () => {
    const h = await boot();
    const { aiBuildStep } = await import("../../src/iso/ai");
    // give the AI a factory on legal ground near the middle
    const { canBuildOn } = await import("../../src/iso/track");
    let spot: [number, number] | null = null;
    for (let y = 10; y < 38 && !spot; y++)
      for (let x = 10; x < 38 && !spot; x++)
        if (canBuildOn(h.grid, "road", x, y)) spot = [x, y];
    expect(spot).toBeTruthy();

    const f = { owner: "ai", tx: spot![0], ty: spot![1] };
    h.eco.factories.push(f);
    const out = aiBuildStep(
      h.eco, f, { stock: {}, purse: { stone: 9999, ore: 9999 } }, 99,
    );
    expect(out).toBeTruthy();
    expect(out!.built.length).toBeGreaterThan(0);
    expect(out!.harvester).toBeTruthy();
  });
});

describe("E11 free setup builds cannot be revoked (K1 regression)", () => {
  it("keeps the free-track allowance as data, not a phase inference", async () => {
    const h = await boot();
    // The K1 bug was a once-per-second affordability sweep clawing back a free
    // build. Here the allowance lives on the player record, so a player with
    // an EMPTY purse still has their free tiles.
    for (const k of Object.keys(h.purse)) h.purse[k] = 0;
    expect(h.freeTrack).toBe(12);
    // ...and it survives arbitrary time passing (many frames)
    await settle(); await settle();
    expect(h.freeTrack).toBe(12);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// J1 — the join. This block is the reason the game can never again ship with a
// map and no harvesting loop: it boots the real app and asserts the match-3
// board is on screen AND that matching a gem moves cargo in the purse.
//
// Every board edit below moves whole gem objects between slots and keeps their
// `r`/`c` fields in step, the way `trySwap` and `gravity` do. Aliasing one gem
// into two slots would make a single token pay twice and the test would still
// go green — that is a false pass, so the amount is asserted EXACTLY.
// ══════════════════════════════════════════════════════════════════════════
import { CARGO_TO_GEM, GEM_TO_CARGO } from "../../src/iso/quarry";
import { CARGOES, type Cargo } from "../../src/iso/config";
import { BOARD_H, BOARD_W, type ResKey } from "../../src/game/config";
import type { Board, Gem } from "../../src/game/board";

const ALT = (res: ResKey): ResKey => (res === "wood" ? "ore" : "wood");

/** Move a gem between two slots the way the board itself does. */
function moveGem(board: Board, a: Gem, r: number, c: number) {
  const other = board.grid[r][c]!;
  board.grid[a.r][a.c] = other; other.r = a.r; other.c = a.c;
  board.grid[r][c] = a; a.r = r; a.c = c;
}

/** A row holding no token other than `except`, so a run there pays a known count. */
function freeRow(board: Board, except?: Gem): number {
  for (let r = 0; r < BOARD_H; r++) {
    const tokens = board.grid[r].filter((g) => g && g.tier > 0 && g !== except);
    if (!tokens.length) return r;
  }
  throw new Error("no token-free row");
}

/**
 * Build a horizontal three of `res` centred on (r,c), optionally moving `token`
 * into the middle first. The two cells beyond the run are forced to another
 * colour so the match is exactly three long and pays a known amount.
 */
function makeRun(board: Board, res: ResKey, r: number, c: number, token?: Gem) {
  if (token && (token.r !== r || token.c !== c)) moveGem(board, token, r, c);
  for (const cc of [c - 1, c, c + 1]) board.grid[r][cc]!.res = res;
  board.grid[r][c - 2]!.res = ALT(res);
  board.grid[r][c + 2]!.res = ALT(res);
}

/** Connect a harvester to a factory with road, the way the pointer path does. */
async function connectedBoot() {
  const h = await boot();
  const { buildTile } = await import("../../src/iso/track");
  const c = findSouthCorridor(h.grid);
  expect(c).toBeTruthy();
  const { hx, hy, fy } = c!;
  h.eco.factories.push({ owner: "you", tx: hx, ty: fy });
  h.eco.harvesters.push({ id: 1, owner: "you", tx: hx, ty: hy });
  for (let y = hy + 1; y <= fy; y++) buildTile(h.track, "road", hx, y);
  h.refreshQuarry();      // the game runs this on every build and demolish
  return { h, corridor: { hx, hy, fy } };
}

describe("J1 the quarry is mounted in the iso app", () => {
  it("boots the map AND the match-3 board together", async () => {
    const h = await boot();
    expect(root.querySelector("#iso-quarry")).toBeTruthy();
    expect(root.querySelectorAll("#iso-gems .gem")).toHaveLength(BOARD_W * BOARD_H);
    expect(h.board.gems()).toHaveLength(BOARD_W * BOARD_H);
    // the reach strip is honest before anything is connected
    expect((root.querySelector("#iso-quarry-reach") as HTMLElement).textContent)
      .toMatch(/nothing/i);
  });

  it("extends the tool bar instead of replacing it", async () => {
    await boot();
    const tools = [...root.querySelectorAll("[data-tool]")].map(
      (b) => (b as HTMLElement).dataset.tool);
    expect(tools).toEqual(["road", "rail", "harvester", "demolish"]);
    const panels = [...root.querySelectorAll("[data-panel]")].map(
      (b) => (b as HTMLElement).dataset.panel);
    expect(panels).toEqual(["quarry", "trade"]);
    expect(root.querySelector("[data-act=recenter]")).toBeTruthy();
  });

  it("selects a gem on click, ready to swap with its neighbour", async () => {
    await boot();
    const first = root.querySelector('.gem[data-r="0"][data-c="0"]') as HTMLElement;
    first.click();
    expect(first.classList.contains("sel")).toBe(true);
  });

  it("matching a connected industry's token harvests exactly its cargo", async () => {
    const { h } = await connectedBoot();

    // the network tokened every cargo it reaches, and only those colours
    const reached = Object.keys(h.reach) as Cargo[];
    expect(reached.length).toBeGreaterThan(0);
    const tokens = h.board.gems().filter((g) => g.tier > 0);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.map((g) => GEM_TO_CARGO[g.res]).every((c) => reached.includes(c))).toBe(true);

    const tok = tokens[0];
    const cargo = GEM_TO_CARGO[tok.res];
    const before = { ...h.purse };
    makeRun(h.board, tok.res, freeRow(h.board, tok), 4, tok);
    expect(h.board.findGroups().length).toBeGreaterThan(0);
    await h.board.settle();          // what trySwap runs after a legal swap

    // Matching the token harvested ITS cargo...
    expect(h.purse[cargo]).toBeGreaterThan(before[cargo] ?? 0);
    // ...and nothing the network cannot reach. The exact per-token amount is
    // pinned in iso-quarry.test.ts, where the board is match-free so a cascade
    // cannot add a second payout behind this assertion's back.
    for (const c of CARGOES) {
      if (reached.includes(c)) continue;
      expect(h.purse[c] ?? 0, `${c} paid with no route`).toBe(before[c] ?? 0);
    }
  });

  it("matching a colour the network cannot reach pays nothing", async () => {
    const { h } = await connectedBoot();
    const reached = Object.keys(h.reach) as Cargo[];
    const dead = CARGOES.find((x) => !reached.includes(x))!;
    expect(dead).toBeTruthy();
    const deadGem = CARGO_TO_GEM[dead];

    // no token of that colour exists: the gate never spawned one
    expect(h.board.gems().some((g) => g.res === deadGem && g.tier > 0)).toBe(false);

    const before = h.purse[dead] ?? 0;
    const row = freeRow(h.board);                    // a row with no token in it
    makeRun(h.board, deadGem, row, 4);
    expect(h.board.findGroups().length).toBeGreaterThan(0);
    await h.board.settle();

    expect(h.purse[dead]).toBe(before);
  });

  it("cutting the line stops the harvest — tokens go dark at once", async () => {
    const { h, corridor } = await connectedBoot();
    const tokens = h.board.gems().filter((g) => g.tier > 0);
    expect(tokens.length).toBeGreaterThan(0);
    const tok = tokens[0];
    const cargo = GEM_TO_CARGO[tok.res];

    // demolish the road mid-corridor; the game rescores (and re-gates) on demolish
    const { demolishTile } = await import("../../src/iso/track");
    demolishTile(h.track, "road", corridor.hx, corridor.hy + 3);
    h.refreshQuarry();

    expect(h.reach).toEqual({});
    expect(h.board.gems().filter((g) => g.tier > 0)).toHaveLength(0);

    const before = h.purse[cargo] ?? 0;
    makeRun(h.board, tok.res, freeRow(h.board, tok), 4, tok);
    await h.board.settle();
    expect(h.purse[cargo]).toBe(before);
  });

  it("surfaces trading, and a bank trade moves cargo in the same purse", async () => {
    const h = await boot();
    (root.querySelector('[data-panel="trade"]') as HTMLElement).click();
    const panel = root.querySelector("#iso-trade") as HTMLElement;
    expect(panel.style.display).not.toBe("none");

    h.purse.stone = 4; h.purse.ore = 0;
    (panel.querySelector('[data-f="bank-give"]') as HTMLSelectElement).value = "stone";
    (panel.querySelector('[data-f="bank-want"]') as HTMLSelectElement).value = "ore";
    (panel.querySelector('[data-act="bank"]') as HTMLElement).click();

    expect(h.purse.stone).toBe(0);
    expect(h.purse.ore).toBe(1);
  });
});

// ── V3 / V4 / V5 — the chrome fixes from the v10 backlog ──────────────────
describe("V3 the quarry panel fits the whole board", () => {
  it("publishes a board width the nine columns fit inside", async () => {
    await boot();
    const gridEl = root.querySelector("#iso-gems") as HTMLElement;
    // the grid itself is always the full 9×9 board…
    expect(gridEl.style.width).toBe(`${54 * 9}px`);
    expect(gridEl.style.height).toBe(`${54 * 9}px`);
    // …and the published panel width is the board at the live zoom, so the
    // aside/panel can size to it instead of clipping the right columns.
    const uiRoot = root.querySelector(".ui-root") as HTMLElement;
    const boardPx = Number(uiRoot.dataset.boardPx);
    const z = Number((root.querySelector("#iso-quarry .board-wrap:last-child") as HTMLElement).dataset.zoom);
    expect(boardPx).toBe(Math.ceil((54 * 9 + 10) * z));
    // and at that zoom the column plus the left panel fits the window
    const leftW = window.innerWidth <= 900 ? 0 : (window.innerWidth <= 1180 ? 262 : 300);
    expect(boardPx + 30 + leftW + 64).toBeLessThanOrEqual(window.innerWidth + 1);
  });
});

describe("V4 toasts and the banner close", () => {
  it("a toast's X removes that toast and leaves the rest of the stack", async () => {
    const h = await boot();
    h.toast("first message", "info");
    h.toast("second message", "info");
    await settle();
    const toasts = [...root.querySelectorAll(".toast")] as HTMLElement[];
    expect(toasts).toHaveLength(2);
    (toasts[0].querySelector(".toast-x") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 400));   // the 300ms fade-out
    const left = [...root.querySelectorAll(".toast")] as HTMLElement[];
    expect(left).toHaveLength(1);
    expect(left[0].textContent).toContain("second message");
  });

  it("an untouched toast still auto-dismisses", async () => {
    const h = await boot();
    h.toast("auto dismiss me", "info");
    await settle();
    expect(root.querySelectorAll(".toast")).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 2900));
    expect(root.querySelectorAll(".toast")).toHaveLength(0);
  }, 8000);

  it("the banner X stays dismissed while the same message repeats", async () => {
    await boot();
    const banner = root.querySelector("#iso-banner") as HTMLElement;
    expect(banner.classList.contains("hidden")).toBe(false);
    (banner.querySelector(".banner-close") as HTMLElement).click();
    expect(banner.classList.contains("hidden")).toBe(true);
    // paint() runs every frame — the dismissal must survive it
    await settle();
    await settle();
    expect(banner.classList.contains("hidden")).toBe(true);
  });
});

describe("V5 gems draw the restored sprite art", () => {
  it("every gem face is a sprite from src/assets/gems, mapped by cargo", async () => {
    await boot();
    const faces = [...root.querySelectorAll("#iso-gems .gem .face")] as HTMLElement[];
    expect(faces).toHaveLength(81);
    const seen = new Set<string>();
    for (const f of faces) {
      expect(f.classList.contains("sprite")).toBe(true);
      const m = f.style.backgroundImage.match(/\/gems\/([a-z]+)\.png/);
      expect(m, f.style.backgroundImage).toBeTruthy();
      seen.add(m![1]);
    }
    // the neutral board spawns the five non-gold cargoes
    expect([...seen].sort()).toEqual(["grain", "oil", "ore", "stone", "wood"]);
  });

  it("the build buttons carry per-tool banner art classes", async () => {
    await boot();
    const tools = [...root.querySelectorAll("[data-tool]")] as HTMLElement[];
    expect(tools).toHaveLength(4);
    for (const b of tools) expect(b.classList.contains(`bg-${b.dataset.tool}`)).toBe(true);
  });
});
