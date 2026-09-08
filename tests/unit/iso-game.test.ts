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
import { MAP_W, MAP_H, TRANSPORT, INDUSTRY_BY_KEY } from "../../src/iso/config";
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
  /** W8: the twin of the setup click that places your factory (and seeds the rival's). */
  placeFactory: (tx: number, ty: number) => boolean;
  dragBuild: (
    kind: "road" | "rail", ax: number, ay: number, bx: number, by: number,
    xFirst?: boolean,
  ) => import("../../src/iso/track").DragPreview | null;
  aiTick: (now?: number) => void;
  econTick: (now?: number) => void;
  tick: (now?: number) => void;
  finishSetup: () => void;
  /** PP-03: the twin of the placement overlay's plan for a hover tile. */
  placementPlan: (
    kind: "factory" | "depot", tx: number, ty: number,
  ) => import("../../src/iso/placement").PlacementPlan;
  /** PP-03: the exact overlay items painted for a placement hover at (tx,ty). */
  overlayItemsFor: (tx: number, ty: number) => { sprite: string; tx: number; ty: number }[];
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
    // PP-06 added the "plant" tool (an additional processing plant).
    expect(tools).toEqual(["road", "rail", "harvester", "plant", "demolish"]);
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
 * off water. The map is 32×32 and generated under a RANDOM seed each boot, so
 * `industries[0]` alone is not safe — when it sits near the bottom edge the
 * factory tile lands at fy ≥ MAP_H and the round can never score (a flaky
 * failure that depends on the seed). Prefer a corridor like the cargo test:
 * no single industry is special, so scanning is not a cheat.
 */
function findSouthCorridor(
  grid: import("../../src/iso/grid").Grid, len = 6, type?: string,
): { hx: number; hy: number; fy: number; ind: import("../../src/iso/grid").Industry } | null {
  for (const ind of grid.industries) {
    if (type && ind.type !== type) continue;
    // MT-2: the harvester stands below the footprint's south edge, so try
    // every column the footprint spans — the origin column alone can be
    // blocked (a pond, a town) while a neighbour column is clear.
    for (let x = ind.tx; x < ind.tx + ind.w; x++) {
      const hx = x, hy = ind.ty + ind.h;
      const fy = hy + len;
      if (hy < 0 || fy >= MAP_H || hx < 0 || hx >= MAP_W) continue;
      let ok = true;
      for (let y = hy; y <= fy; y++) {
        const i = y * MAP_W + hx;
        if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) { ok = false; break; }
      }
      if (ok) return { hx, hy, fy, ind };
    }
  }
  return null;
}

/**
 * A 2×2 road-legal spot (the factory footprint) scanning from the map's
 * interior outward. MT-2 moved every industry, so the old hard-coded factory
 * tiles (e.g. (23,22)) can now sit inside a mine's footprint — find one that
 * the real `placeFactory` will accept instead.
 */
function findFactorySpot(grid: import("../../src/iso/grid").Grid): [number, number] | null {
  for (let y = 6; y < MAP_H - 6; y++) {
    for (let x = 6; x < MAP_W - 6; x++) {
      let ok = true;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const i = (y + dy) * MAP_W + (x + dx);
          if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) { ok = false; break; }
        }
        if (!ok) break;
      }
      if (ok) return [x, y];
    }
  }
  return null;
}

/** A 2×2 road-legal factory spot within a small ring of an industry of `type`. */
function findFactorySpotNear(
  grid: import("../../src/iso/grid").Grid, type: string, excludeId = -1,
): [number, number] | null {
  // T4: return the CLOSEST free 2×2 to the footprint (not the top-left-most).
  // On the roomier map the rival's trunk line has to stay short enough to be
  // affordable from its opening purse, or it strands a harvester it can never
  // connect.
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const ind of grid.industries) {
    if (ind.type !== type || ind.id === excludeId) continue;
    for (let y = Math.max(0, ind.ty - 8); y < Math.min(MAP_H, ind.ty + ind.h + 8); y++) {
      for (let x = Math.max(0, ind.tx - 8); x < Math.min(MAP_W, ind.tx + ind.w + 8); x++) {
        let ok = true;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            if (x + dx >= MAP_W || y + dy >= MAP_H) { ok = false; break; }
            const i = (y + dy) * MAP_W + (x + dx);
            if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) { ok = false; break; }
          }
          if (!ok) break;
        }
        if (!ok) continue;
        const d = Math.abs(x - ind.tx) + Math.abs(y - ind.ty);
        if (d < bestD) { bestD = d; best = [x, y]; }
      }
    }
  }
  return best;
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

    h.eco.factories.push({ owner: "you", ownerId: 1, tx: hx, ty: fy });
    const harv = { id: 1, owner: "you", ownerId: 1, tx: hx, ty: hy };
    h.eco.harvesters.push(harv);

    // catchment must actually see the industry
    expect(industriesInCatchment(h.grid, harv).length).toBeGreaterThan(0);

    // no track yet → unserviced, no VP
    const score = createScoreState();
    expect(isServiced(h.track, harv)).toBe(false);
    expect(rescore(h.eco, score)).toEqual([]);

    // lay a road from the harvester to the factory (W2: owned by "you")
    for (let y = hy + 1; y <= fy; y++) buildTile(h.track, "road", hx, y, 1);
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
    h.eco.factories.push({ owner: "you", ownerId: 1, tx: hx, ty: fy });
    h.eco.harvesters.push({ id: 1, owner: "you", ownerId: 1, tx: hx, ty: hy });
    for (let y = hy + 1; y <= fy; y++) buildTile(h.track, "road", hx, y, 1);

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

    const f = { owner: "ai", ownerId: 2, tx: spot![0], ty: spot![1] };
    h.eco.factories.push(f);
    // PP-05: Oil joins the unlimited purse — the turn ends at a Depot, and a
    // paid Depot costs Oil (`DEPOT_COST` in construction.ts).
    const out = aiBuildStep(
      h.eco, f, { stock: {}, purse: { stone: 9999, ore: 9999, oil: 9999 } }, 99,
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
import { BOARD_H, BOARD_W, CELL, type ResKey } from "../../src/game/config";
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
  h.eco.factories.push({ owner: "you", ownerId: 1, tx: hx, ty: fy });
  h.eco.harvesters.push({ id: 1, owner: "you", ownerId: 1, tx: hx, ty: hy });
  for (let y = hy + 1; y <= fy; y++) buildTile(h.track, "road", hx, y, 1);
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
    // PP-06 added the "plant" tool (an additional processing plant).
    expect(tools).toEqual(["road", "rail", "harvester", "plant", "demolish"]);
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
    // the grid itself is always the full BOARD_W×BOARD_H board (sizes derived
    // from config — the old 9×9/54px hardcodes desynced from the live board)
    expect(gridEl.style.width).toBe(`${CELL * BOARD_W}px`);
    expect(gridEl.style.height).toBe(`${CELL * BOARD_H}px`);
    // …and the published panel width is the board at the live zoom, so the
    // aside/panel can size to it instead of clipping the right columns.
    const uiRoot = root.querySelector(".ui-root") as HTMLElement;
    const boardPx = Number(uiRoot.dataset.boardPx);
    const z = Number((root.querySelector("#iso-quarry .board-wrap:last-child") as HTMLElement).dataset.zoom);
    expect(boardPx).toBe(Math.ceil((CELL * BOARD_W + 10) * z));
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
    expect(faces).toHaveLength(BOARD_W * BOARD_H);
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
    expect(tools).toHaveLength(5);
    for (const b of tools) expect(b.classList.contains(`bg-${b.dataset.tool}`)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// W1–W6 — the open-backlog acceptance tests, run against the REAL game the
// way a player experiences them (drag path, AI clock, economy clock, the
// HUD). Seed 1337 is pinned in beforeEach, so the coordinates below are the
// ones that seed grows — deterministic, no flakes.
// ══════════════════════════════════════════════════════════════════════════
import { AI_BUILD_MS, HARVEST_MS } from "../../src/iso/game";
import { AI_TRADE_MS } from "../../src/iso/market";

describe("W1 the drag charges exactly what it previewed", () => {
  it("an unaffordable drag builds the affordable prefix; nothing goes negative", async () => {
    const h = await boot();
    const { hasTrack } = await import("../../src/iso/track");
    // a clear south column of 15 tiles (harvester + 14 road tiles) below an
    // industry — found, not hard-coded, since MT-2 reshaped the map.
    const c = findSouthCorridor(h.grid, 14);
    expect(c).toBeTruthy();
    const { hx, hy } = c!;
    h.eco.factories.push({ owner: "you", ownerId: 1, tx: hx, ty: hy + 6 });
    h.eco.harvesters.push({ id: 1, owner: "you", ownerId: 1, tx: hx, ty: hy });
    h.finishSetup();

    // Burn 11 of the 12 free setup tiles on one drag — the purse is untouched.
    const pv1 = h.dragBuild("road", hx, hy + 1, hx, hy + 11);
    expect(pv1).toBeTruthy();
    expect(pv1!.free).toBe(11);
    expect(h.freeTrack).toBe(1);
    expect(h.purse.stone).toBe(12);
    // and the tiles are MINE (W2's ownership rides on the same commit)
    expect(h.track.owner[(hy + 1) * MAP_W + hx]).toBe(1);

    // Now the purse pays. 1 free tile + 1 stone can buy 2 of the next 3 —
    // the third tile is the unaffordable remainder, shown but never built.
    h.purse.stone = 1;
    const pv2 = h.dragBuild("road", hx, hy + 12, hx, hy + 14);
    expect(pv2).toBeTruthy();
    expect(pv2!.tiles).toHaveLength(2);
    expect(pv2!.unaffordable).toEqual([[hx, hy + 14]]);   // the blocked tail
    expect(pv2!.free).toBe(1);            // the last free tile went to the prefix
    expect(pv2!.cost).toEqual({ stone: 1 });

    // The commit charged EXACTLY the preview: nothing more, nothing less.
    expect(h.purse.stone).toBe(0);
    expect(h.freeTrack).toBe(0);
    expect(hasTrack(h.track, "road", hx, hy + 12)).toBe(true);
    expect(hasTrack(h.track, "road", hx, hy + 13)).toBe(true);
    expect(hasTrack(h.track, "road", hx, hy + 14)).toBe(false);
    // "no purse value ever negative" — every cargo key, checked, not inferred
    for (const c of CARGOES) expect(h.purse[c] ?? 0, `${c} went negative`).toBeGreaterThanOrEqual(0);
  });
});

describe("W3 the rival actually plays (headless)", () => {
  it("N aiTicks grow the rival's track, connect an industry, and move its cargo", async () => {
    const h = await boot();
    const { buildTile } = await import("../../src/iso/track");
    // minimal player setup (the AI clocks only run in `play`). T4: wire the
    // player to a FARM so the ore mine the rival is placed beside keeps its
    // harvester spots free (on the roomier map the two setups used to converge
    // on the same mine and the rival could never place a harvester).
    const c = findSouthCorridor(h.grid, 6, "farm");
    expect(c).toBeTruthy();
    h.eco.factories.push({ owner: "you", ownerId: 1, tx: c!.hx, ty: c!.fy });
    h.eco.harvesters.push({ id: 1, owner: "you", ownerId: 1, tx: c!.hx, ty: c!.hy });
    for (let y = c!.hy + 1; y <= c!.fy; y++) buildTile(h.track, "road", c!.hx, y, 1);
    h.finishSetup();

    // The rival's factory goes next to an ORE mine (its ore trickle is what the
    // second half asserts). MT-2 moved every mine, so the spot is found from
    // the live grid rather than hard-coded.
    // T4: keep the rival off the industry the player just wired up, so the two
    // networks don't compete for the same harvester spot on the roomier map.
    const rivalSpot = findFactorySpotNear(h.grid, "ore_mine", c!.ind.id);
    expect(rivalSpot).toBeTruthy();
    h.eco.factories.push({ owner: "ai", ownerId: 2, tx: rivalSpot![0], ty: rivalSpot![1] });
    const rival = h.market.players[1];
    const rivalTiles = () => [...h.track.owner].filter((o) => o === 2).length;
    expect(rivalTiles()).toBe(0);
    expect(h.vp.ai).toBe(0);

    // PP-05: the rival's FIRST Depot rides its free allowance, so an opening
    // turn needs no Oil — but every Depot after it pays `DEPOT_COST`, and this
    // rival has never matched an Oil gem. Give it Oil the way a connected Oil
    // Rig would, or the three later turns are (correctly) refused and the
    // "it SPENT stone past its free allowance" assertion has nothing to spend.
    // `res` IS the rival's purse object (market.ts builds over the same record).
    rival.res.oil = 5;

    // Four build ticks = 36s of game time, still within the one-minute goal.
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) h.aiTick(t0 + i * AI_BUILD_MS);

    // its track exists and is ITS OWN...
    expect(rivalTiles()).toBeGreaterThan(0);
    // ...and it connected at least one industry (VP is owner-scoped)
    expect(h.vp.ai).toBeGreaterThan(0);
    // and it SPENT: the rival started with 12 stone (START_PURSE); builds past
    // the 12-tile free allowance come out of that purse, so the stone falls.
    expect(rival.res.stone).toBeLessThan(12);
    // PP-05: …and the paid Depots cost Oil — the rival is down from the 5 it
    // was given, proving the AI pays the same `DEPOT_COST` the player does.
    expect(rival.res.oil).toBeLessThan(5);

    // and it EARNS: the connected mine's trickle lands in its purse each tick
    const ore0 = rival.res.ore;
    h.econTick(t0 + 4 * AI_BUILD_MS);
    h.econTick(t0 + 4 * AI_BUILD_MS + HARVEST_MS);
    h.econTick(t0 + 4 * AI_BUILD_MS + 2 * HARVEST_MS);
    expect(rival.res.ore).toBeGreaterThan(ore0);
    for (const c of CARGOES) expect(rival.res[c], `${c} negative`).toBeGreaterThanOrEqual(0);
  }, 10_000);
});

describe("W8 the rival is placed where it can build — and builds", () => {
  it("the real setup click hands the rival a rail-legal tile with a viable plan", async () => {
    const h = await boot();
    const { canBuildOn } = await import("../../src/iso/track");
    const { canReachASpot } = await import("./helpers/rival-map");
    // The ticket's regression guard: the rival must never be handed a tile no
    // track can leave. On the seed-1337 map the (0,0) water corner is such an
    // unreachable tile (its road-legal component reaches no harvester).
    const spot = findFactorySpot(h.grid);
    expect(spot).toBeTruthy();
    const [fx, fy] = spot!;
    expect(canBuildOn(h.grid, "road", fx, fy)).toBe(true);
    expect(canReachASpot(h.grid, 0, 0)).toBe(false);
    expect(h.placeFactory(fx, fy)).toBe(true);

    const rival = h.factories.find((f) => f.owner === "ai");
    expect(rival).toBeTruthy();
    // rail-legal (flat, off water, off any footprint) and NOT an enclave…
    expect(canBuildOn(h.grid, "rail", rival!.tx, rival!.ty)).toBe(true);
    expect(canReachASpot(h.grid, rival!.tx, rival!.ty)).toBe(true);
    expect([rival!.tx, rival!.ty]).not.toEqual([0, 0]);
    // …and still a good distance from the player, as before
    expect(Math.abs(rival!.tx - fx) + Math.abs(rival!.ty - fy)).toBeGreaterThan(10);
  }, 10_000);

  it("four aiTicks from that real placement build track, a harvester, and VP", async () => {
    const h = await boot();
    const spot = findFactorySpot(h.grid);
    expect(spot).toBeTruthy();
    expect(h.placeFactory(spot![0], spot![1])).toBe(true);
    h.finishSetup();                     // the AI clock only runs in `play`
    const rivalTiles = () => [...h.track.owner].filter((o) => o === 2).length;
    expect(rivalTiles()).toBe(0);
    expect(h.vp.ai).toBe(0);

    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) h.aiTick(t0 + i * AI_BUILD_MS);

    // the rival is no longer a scoreboard entry with 0 VP for the whole match
    expect(rivalTiles()).toBeGreaterThan(0);
    expect(h.harvesters.some((x) => x.owner === "ai")).toBe(true);
    expect(h.vp.ai).toBeGreaterThan(0);
  }, 10_000);
});

describe("W9 the free setup allowance buys road, not rail", () => {
  it("a rail drag with 12 free tiles and no ore lays nothing and burns no allowance", async () => {
    const h = await boot();
    const { canBuildOn, hasTrack } = await import("../../src/iso/track");
    // five consecutive rail-legal tiles to drag along (rail needs flat ground)
    let line: [number, number] | null = null;
    for (let y = 6; y < 26 && !line; y++) {
      for (let x = 6; x < 22 && !line; x++) {
        let ok = true;
        for (let k = 0; k < 5; k++) if (!canBuildOn(h.grid, "rail", x + k, y)) ok = false;
        if (ok) line = [x, y];
      }
    }
    expect(line).toBeTruthy();
    const [fx, fy] = line!;
    expect(h.placeFactory(fx, fy)).toBe(true);
    h.finishSetup();
    expect(h.freeTrack).toBe(12);
    expect(h.purse.ore ?? 0).toBe(0);

    // rail with the full allowance and no ore: refused, allowance untouched.
    // This is the W9 bug — it used to lay all 5 tiles for free.
    const rail = h.dragBuild("rail", fx, fy, fx + 4, fy);
    expect(rail === null || rail.tiles.length === 0).toBe(true);
    expect(h.freeTrack).toBe(12);
    expect(h.purse.ore ?? 0).toBe(0);
    expect(hasTrack(h.track, "rail", fx, fy)).toBe(false);

    // road from the same tile still rides the allowance exactly as before
    const road = h.dragBuild("road", fx, fy, fx + 4, fy);
    expect(road).toBeTruthy();
    expect(road!.tiles).toHaveLength(5);
    expect(road!.free).toBe(5);
    expect(h.purse.stone).toBe(12);              // nothing charged
    expect(h.freeTrack).toBe(7);

    // and rail becomes buildable the moment ore exists — charged, never free
    h.purse.ore = 40;
    const up = h.dragBuild("rail", fx, fy, fx + 4, fy);
    expect(up).toBeTruthy();
    expect(up!.tiles).toHaveLength(5);
    expect(up!.free).toBe(0);
    expect(up!.cost).toEqual({ ore: 20 });       // 5 in-place upgrades × 4 ore
    expect(h.purse.ore).toBe(20);
    expect(h.freeTrack).toBe(7);                 // rail ate no allowance
    for (let k = 0; k < 5; k++) expect(hasTrack(h.track, "rail", fx + k, fy)).toBe(true);
  }, 10_000);
});

describe("W4 a normal session earns the rail", () => {
  it("road → ore mine → harvest ore → the rail tile is affordable", async () => {
    const h = await boot();
    const { buildTile, hasTrack, canAfford } = await import("../../src/iso/track");
    // an ore mine with a clean south corridor, found on the live grid (MT-2
    // moved every mine, so the old hard-coded (18,13) is gone).
    const c = findSouthCorridor(h.grid, 6, "ore_mine");
    expect(c).toBeTruthy();
    const { hx, hy, fy } = c!;
    h.eco.factories.push({ owner: "you", ownerId: 1, tx: hx, ty: fy });
    h.eco.harvesters.push({ id: 1, owner: "you", ownerId: 1, tx: hx, ty: hy });
    for (let y = hy + 1; y <= fy; y++) buildTile(h.track, "road", hx, y, 1);
    h.finishSetup();
    h.refreshQuarry();

    // the network reaches ORE and only ore — the board tokened exactly that
    expect(h.reach.ore).toBeGreaterThan(0);
    expect(Object.keys(h.reach)).toEqual(["ore"]);
    expect(h.board.gems().some((g) => g.res === "ore" && g.tier > 0)).toBe(true);

    // harvest: force the 20s token clock and match the spawned tokens
    // (the game's own `tick` twin — board effects + token spawn)
    const t0 = 1_000_000;
    for (let i = 0; i < 12 && (h.purse.ore ?? 0) < 4; i++) {
      h.tick(t0 + (i + 1) * 20_000);
      const tok = h.board.gems().find((g) => g.res === "ore" && g.tier > 0);
      if (!tok) continue;
      makeRun(h.board, "ore", freeRow(h.board, tok), 4, tok);
      await h.board.settle();
    }
    // The W4 numbers (documented per the ticket): ore_mine output 0.8 → a
    // tier-1 token worth 1 ore every UPGRADE_EVERY (20s); rail = 4 ore +
    // 1 stone per tile; start purse {stone 12, ore 0}. So ~4 token matches
    // (≈80s of play) buy the first rail tile — no economy adjustment needed.
    expect(h.purse.ore ?? 0).toBeGreaterThanOrEqual(4);
    expect(canAfford(h.purse, TRANSPORT.rail.cost)).toBe(true);

    // and the game lets you lay it over the corridor: the rail goes down as
    // the settled in-place upgrade of a corridor road tile, which is exactly
    // "laying it over the corridor".
    const pv = h.dragBuild("rail", hx, fy - 1, hx, fy - 1);
    expect(pv).toBeTruthy();
    expect(hasTrack(h.track, "rail", hx, fy - 1)).toBe(true);
  });
});

describe("W5 combos pay gold into the purse", () => {
  it("2 combos = 1 gold, the chip shows it, and the Black Market opens up", async () => {
    const h = await boot();
    expect(h.purse.gold ?? 0).toBe(0);

    h.board.registerCombo();
    expect(h.purse.gold ?? 0).toBe(0);        // one combo: no coin yet
    h.board.registerCombo();
    expect(h.purse.gold ?? 0).toBe(1);        // the coin went to the PURSE
    // N3: no gold GEM without a connected mine — the gate is wired through
    // the real game's quarry, and this boot has no gold mine linked yet.
    expect(h.board.gems().some((g) => g.res === "gold")).toBe(false);

    await settle();                           // one paint cycle
    const chips = [...root.querySelectorAll("#iso-res .chip .chip-n")].map((e) => e.textContent);
    expect(chips[CARGOES.indexOf("gold")]).toBe("1");

    // five gold (10 combos) makes the 5-coin Blockade affordable
    for (let i = 0; i < 8; i++) h.board.registerCombo();
    expect(h.purse.gold ?? 0).toBe(5);
    await settle();
    const bandit = root.querySelector('[data-black="bandit"]') as HTMLElement;
    expect(bandit).toBeTruthy();
    expect(bandit.classList.contains("disabled")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// TK-008 — buying a Blockade auto-routes it to the rival. There is ONE rival,
// so the old "click an industry" crosshair step is gone: the purchase itself
// blockades the industry that costs the rival the most yield.
// ══════════════════════════════════════════════════════════════════════════
describe("TK-008 Blockade buys auto-target the rival (no targeting step)", () => {
  it("spends the gold and blockades the rival's yielding industry in one click", async () => {
    const h = await boot();
    const { buildTile } = await import("../../src/iso/track");
    const { playerResources } = await import("../../src/iso/economy");

    // Give the rival a real corridor: harvester below an industry, road down
    // to its factory (ownerId 2), so the industry is yielding for the rival.
    const c = findSouthCorridor(h.grid);
    expect(c).toBeTruthy();
    const { hx, hy, fy, ind } = c!;
    expect(ind).toBeTruthy();
    h.eco.factories.push({ owner: "ai", ownerId: 2, tx: hx, ty: fy });
    h.eco.harvesters.push({ id: 1, owner: "ai", ownerId: 2, tx: hx, ty: hy });
    for (let y = hy + 1; y <= fy; y++) buildTile(h.track, "road", hx, y, 2);
    const now0 = performance.now();
    expect(Object.keys(playerResources(h.eco, "ai", now0)).length).toBeGreaterThan(0);

    h.purse.gold = 5;
    await settle();                              // paint enables the button
    const bandit = root.querySelector('[data-black="bandit"]') as HTMLElement;
    expect(bandit).toBeTruthy();
    expect(bandit.classList.contains("disabled")).toBe(false);

    const boughtAt = performance.now();
    bandit.click();
    await settle();

    // gold was spent, and the purchase ITSELF placed the blockade — no map
    // click, no crosshair mode, no "click an industry" prompt anywhere.
    expect(h.purse.gold ?? 0).toBe(0);
    const banditAfter = root.querySelector('[data-black="bandit"]') as HTMLElement;
    expect(banditAfter.classList.contains("active")).toBe(false);   // not armed
    expect(banditAfter.classList.contains("disabled")).toBe(true);  // 0 gold left
    expect((root.querySelector(".modebar") as HTMLElement).textContent ?? "")
      .not.toMatch(/click an industry/i);
    expect((root.querySelector(".toasts") as HTMLElement).textContent ?? "")
      .toMatch(/blockade set on/i);

    // the industry the rival actually yields from is the one that got blockaded
    // (MT-2: a 4×4 catchment can now touch more than one footprint, so the
    // target is found by the game's own rule rather than assumed to be `ind`).
    const blocked = h.grid.industries.find((i) => i.banditUntil > boughtAt);
    expect(blocked).toBeTruthy();
    const cargo = INDUSTRY_BY_KEY[blocked!.type].cargo;
    // …its harvest is stopped until it expires…
    expect(playerResources(h.eco, "ai", blocked!.banditUntil - 1_000)[cargo]).toBeUndefined();
    // …and resumes afterwards.
    expect(playerResources(h.eco, "ai", blocked!.banditUntil + 1_000)[cargo]).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// PP-08 — Gold is reserved for Black Market sabotage.
//   • the four SABOTAGE actions keep their Gold price, and insufficient Gold
//     refuses the purchase without touching any other resource;
//   • Security Forces (defensive, NOT sabotage) are repriced to materials,
//     so every non-sabotage action completes without Gold;
//   • the trade composer never offers Gold, and the market refuses it anyway.
// ══════════════════════════════════════════════════════════════════════════
describe("PP-08 gold is reserved for Black Market sabotage", () => {
  it("insufficient gold blocks a sabotage and consumes nothing else", async () => {
    const h = await boot();
    h.purse.stone = 12;
    h.purse.gold = 0;
    await settle();
    const harden = root.querySelector('[data-black="harden"]') as HTMLElement;
    expect(harden.classList.contains("disabled")).toBe(true);
    harden.click();
    await settle();
    expect(h.purse.gold ?? 0).toBe(0);
    expect(h.purse.stone).toBe(12);             // no material was touched
    expect((root.querySelector(".toasts") as HTMLElement).textContent ?? "")
      .toMatch(/needs 5 gold/i);
  });

  it("sabotage with enough gold deducts ONLY gold", async () => {
    const h = await boot();
    h.purse.gold = 5;
    h.purse.stone = 12;
    await settle();
    (root.querySelector('[data-black="harden"]') as HTMLElement).click();
    await settle();
    expect(h.purse.gold).toBe(0);
    expect(h.purse.stone).toBe(12);             // construction stock untouched
  });

  it("Security Forces are hired with materials — Gold stays in the purse", async () => {
    const h = await boot();
    h.purse.gold = 6;             // the OLD price, deliberately affordable
    h.purse.grain = 2;
    h.purse.stone = 1;
    await settle();
    const sec = root.querySelector('[data-black="security"]') as HTMLElement;
    expect(sec.classList.contains("disabled")).toBe(false);
    expect(sec.textContent).toMatch(/2🌾/);      // the cost is shown in materials
    sec.click();
    await settle();
    expect(h.purse.grain).toBe(0);
    expect(h.purse.stone).toBe(0);
    expect(h.purse.gold).toBe(6);               // gold was NOT the price
  });

  it("Security Forces without materials are refused and consume nothing", async () => {
    const h = await boot();
    h.purse.gold = 6;
    h.purse.grain = 1;            // short of the 2 grain the hire needs
    h.purse.stone = 1;
    await settle();
    const sec = root.querySelector('[data-black="security"]') as HTMLElement;
    expect(sec.classList.contains("disabled")).toBe(true);
    sec.click();
    await settle();
    expect(h.purse.grain).toBe(1);
    expect(h.purse.stone).toBe(1);
    expect(h.purse.gold).toBe(6);               // nothing was consumed at all
  });

  it("the trade composer never offers gold, and the market refuses it anyway", async () => {
    const h = await boot();
    (root.querySelector('[data-panel="trade"]') as HTMLElement).click();
    const panel = root.querySelector("#iso-trade") as HTMLElement;
    for (const sel of [...panel.querySelectorAll("select")]) {
      const values = [...(sel as HTMLSelectElement).options].map((o) => o.value);
      expect(values).not.toContain("gold");
    }
    // belt and braces: the market record itself carries the rule
    expect([...h.market.ctx.blocked]).toEqual(["gold"]);
  });
});

describe("W6 the market is visible and trades are logged", () => {
  it("the Market button opens the panel, and a bank trade 4:1 moves the purse", async () => {
    const h = await boot();
    const panel = root.querySelector("#iso-trade") as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.classList.contains("hidden")).toBe(true);     // closed at boot

    (root.querySelector('[data-panel="trade"]') as HTMLElement).click();
    expect(panel.classList.contains("hidden")).toBe(false);    // OPEN

    h.purse.stone = 4; h.purse.ore = 0;
    (panel.querySelector('[data-f="bank-give"]') as HTMLSelectElement).value = "stone";
    (panel.querySelector('[data-f="bank-want"]') as HTMLSelectElement).value = "ore";
    (panel.querySelector('[data-act="bank"]') as HTMLElement).click();
    expect(h.purse.stone).toBe(0);
    expect(h.purse.ore).toBe(1);
  });

  it("a posted offer can be answered by the rival, and the feed logs it", async () => {
    const h = await boot();
    const panel = root.querySelector("#iso-trade") as HTMLElement;
    (root.querySelector('[data-panel="trade"]') as HTMLElement).click();

    const me = h.market.players[0];
    const rival = h.market.players[1];
    rival.res.ore = 5;                        // the rival can pay for what we want
    me.res.stone = 12;

    // post: 2 stone → 2 ore
    (panel.querySelector('[data-f="give"]') as HTMLSelectElement).value = "stone";
    (panel.querySelector('[data-f="want"]') as HTMLSelectElement).value = "ore";
    (panel.querySelector('[data-f="give-n"]') as HTMLInputElement).value = "2";
    (panel.querySelector('[data-f="want-n"]') as HTMLInputElement).value = "2";
    (panel.querySelector('[data-act="post"]') as HTMLElement).click();
    expect(h.market.live(me)).toHaveLength(1);
    expect(me.res.stone).toBe(10);            // escrowed

    // the rival answers on its 5s trading clock
    h.market.tick(performance.now() + AI_TRADE_MS);
    expect(h.market.live(me)).toHaveLength(0); // taken, not expired
    expect(me.res.stone).toBe(10);            // escrow converted, not refunded
    expect(me.res.ore).toBe(2);
    expect(rival.res.ore).toBe(3);
    expect(rival.res.stone).toBe(14);

    // the Feed tab is the trade log: both the posting and the answer
    const feedEl = root.querySelector("#iso-trade .feed-pane") as HTMLElement;
    expect(feedEl.textContent).toMatch(/posted 2 stone/i);
    expect(feedEl.textContent).toMatch(/rival took your offer/i);
  });
});

describe("D2/D3 road building feedback and debug overlay toggle", () => {
  it("shows a toast explaining why a road click/drag is refused on non-adjacent ground", async () => {
    const h = await boot();
    h.finishSetup();
    h.setTool("road");

    const canvas = root.querySelectorAll("canvas.iso-layer")[2] as HTMLCanvasElement;
    expect(canvas).toBeTruthy();
    const evtDown = new PointerEvent("pointerdown", { clientX: 200, clientY: 200, isPrimary: true, button: 0 });
    const evtUp = new PointerEvent("pointerup", { clientX: 200, clientY: 200, isPrimary: true, button: 0 });
    canvas.dispatchEvent(evtDown);
    canvas.dispatchEvent(evtUp);
    await settle();

    const toastEl = root.querySelector(".toasts") as HTMLElement;
    expect(toastEl.textContent).toMatch(/Track must extend your network|Can't build/);
  });

  it("pressing backtick toggles the debug overlay", async () => {
    await boot();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "`" }));
    await settle();
    const toastEl = root.querySelector(".toasts") as HTMLElement;
    expect(toastEl.textContent).toMatch(/Debug overlay: ON/);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "`" }));
    await settle();
    expect(toastEl.textContent).toMatch(/Debug overlay: OFF/);
  });
});

// ── PP-01: terminology — the match-3 interface is the Processing Plant, ──
// the collector building is a Depot. UI-only: internal identifiers (tool
// keys, phase names, snapshot shapes) stay untouched so saved games keep
// working, and the stone node keeps its "Quarry" name.
describe("PP-01 terminology: Processing Plant + Depot", () => {
  it("labels the collector tool 'Depot' and shows no player-facing 'Harvester'", async () => {
    await boot();
    const depot = [...root.querySelectorAll<HTMLElement>("[data-tool]")]
      .find((b) => b.dataset.tool === "harvester");
    expect(depot?.textContent).toContain("Depot");
    // nothing the player can READ on the booted screen says "harvester"
    expect(root.textContent).not.toMatch(/harvester/i);
  });

  it("calls the match-3 panel, its build toggle and the mobile nav 'Processing Plant'", async () => {
    await boot();
    expect(root.querySelector("#iso-quarry .panel-title")?.textContent).toContain("Processing Plant");
    expect(root.querySelector('[data-panel="quarry"]')?.textContent).toContain("Processing Plant");
    const nav = [...root.querySelectorAll<HTMLElement>(".mnav-btn")]
      .find((b) => b.dataset.view === "quarry");
    expect(nav?.textContent).toContain("Processing Plant");
  });

  it("explains the loop in the help and keeps the stone node's Quarry name", async () => {
    await boot();
    // the stone-producing resource node keeps its existing name
    expect(INDUSTRY_BY_KEY["quarry"].name).toBe("Quarry");
    const helpBtn = [...root.querySelectorAll<HTMLElement>(".icon-btn")]
      .find((b) => b.title === "How to play");
    helpBtn?.click();
    await settle();
    const modal = root.querySelector(".modal") as HTMLElement;
    expect(modal.textContent).toContain(
      "resource node → Depot → transport network → Factory → processing → resources available for construction",
    );
    expect(modal.textContent).toContain("The Processing Plant");
    expect(modal.textContent).not.toMatch(/harvester/i);
  });

  it("leaves the internal identifiers (save compatibility) unchanged", async () => {
    const h = await boot();
    expect(h.phase).toBe("setup-factory");
    expect(h.tool).toBe("road");
    h.finishSetup();
    expect(h.phase).toBe("play");
    // the snapshot/eco shape the save format depends on
    expect(Array.isArray(h.eco.harvesters)).toBe(true);
    expect(Array.isArray(h.eco.factories)).toBe(true);
  });
});

// ── PP-03: the real game paints its placement overlay from the same plan the
// click handlers validate with — strong footprint, light reach, node marks,
// red + readable reason for invalid tiles (AC1–AC4 of the ticket). The plans
// are exercised through the __iso twins so no pixel path is needed here;
// the sprites themselves are pinned in iso-atlas-pixels.test.ts.
describe("PP-03 footprint vs reach placement feedback (wired game)", () => {
  const sorted = (ts: [number, number][]) =>
    [...ts].map(([x, y]) => [x, y] as [number, number]).sort((a, b) =>
      a[0] - b[0] || a[1] - b[1]);

  it("factory: legal site paints exactly the 2×2 footprint + soft adjacency band + town marks", async () => {
    const h = await boot();
    const spot = findFactorySpot(h.grid)!;
    const plan = h.placementPlan("factory", spot[0], spot[1]);
    expect(plan.valid).toBe(true);
    const items = h.overlayItemsFor(spot[0], spot[1]);
    const tiles = (sprite: string) => sorted(
      items.filter((i) => i.sprite === sprite).map((i) => [i.tx, i.ty] as [number, number]));
    expect(items.some((i) => i.sprite === "highlight_bad")).toBe(false);
    expect(tiles("highlight")).toEqual(sorted(
      plan.footprint.filter((t) => t.ok).map((t) => [t.tx, t.ty] as [number, number])));
    expect(tiles("highlight_soft")).toEqual(sorted(plan.reach));
    expect(tiles("node_mark")).toEqual(sorted(plan.nodes));
  });

  it("factory: an occupied footprint tile turns red and carries a readable reason", async () => {
    const h = await boot();
    const ind = h.grid.industries.find((i) => i.type === "farm")!;
    const plan = h.placementPlan("factory", ind.tx, ind.ty);
    expect(plan.valid).toBe(false);
    expect(plan.why).toMatch(/industry|overlaps/);
    const items = h.overlayItemsFor(ind.tx, ind.ty);
    // every footprint tile that refused the build is painted red
    const bad = items.filter((i) => i.sprite === "highlight_bad");
    expect(bad.length).toBeGreaterThan(0);
    for (const t of plan.footprint.filter((t) => !t.ok)) {
      expect(bad).toContainEqual({ sprite: "highlight_bad", tx: t.tx, ty: t.ty });
    }
  });

  it("depot: 1×1 footprint solid, 4×4 catchment soft, served resource nodes marked", async () => {
    const h = await boot();
    const spot = findFactorySpot(h.grid)!;
    expect(h.placeFactory(spot[0], spot[1])).toBe(true);   // phase → setup-harvester
    const c = findSouthCorridor(h.grid)!;
    const plan = h.placementPlan("depot", c.hx, c.hy);
    expect(plan.valid).toBe(true);
    expect(plan.served.length).toBeGreaterThan(0);
    const items = h.overlayItemsFor(c.hx, c.hy);
    expect(items.filter((i) => i.sprite === "highlight"))
      .toEqual([{ sprite: "highlight", tx: c.hx, ty: c.hy }]);
    const soft = sorted(items.filter((i) => i.sprite === "highlight_soft")
      .map((i) => [i.tx, i.ty] as [number, number]));
    expect(soft).toEqual(sorted(plan.reach));
    const marks = sorted(items.filter((i) => i.sprite === "node_mark")
      .map((i) => [i.tx, i.ty] as [number, number]));
    expect(marks.length).toBeGreaterThan(0);
    expect(marks).toEqual(sorted(plan.nodes));
  });

  it("depot: an occupied/water hover is painted red with the reason readable", async () => {
    const h = await boot();
    const spot = findFactorySpot(h.grid)!;
    expect(h.placeFactory(spot[0], spot[1])).toBe(true);
    const ind = h.grid.industries[0];
    const plan = h.placementPlan("depot", ind.tx, ind.ty);
    expect(plan.valid).toBe(false);
    expect(plan.why).toMatch(/overlaps an industry/);
    expect(h.overlayItemsFor(ind.tx, ind.ty))
      .toContainEqual({ sprite: "highlight_bad", tx: ind.tx, ty: ind.ty });
  });
});
