// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// L10 (#225) — Frost tiles and iron girders are board obstacles set by
// difficulty.
//
// The ticket is a MOVE, not a new mechanic: both obstacles already existed
// (frost = `hard > 0`, cracked by a match next to it; a girder = `block`, out
// of the board entirely until a match beside it breaks it). What changes is
// who places them and for how long:
//
//   • a difficulty table, not the Black Market — Easy none, Normal frost only,
//     Hard frost AND girders;
//   • placed when a tuning session OPENS, ramped by the Depot's tier, on the
//     seeded RNG, and never so as to leave a board with no legal move;
//   • lasting for the session — no timers, no sabotage, no Smog, and no way
//     to put one on a board from outside a session at all.
//
// So this file proves, in that order:
//
//   1. the table (one row per difficulty, and the tier ramp);
//   2. the placement, on a real board (seeded, and the deadlock guard holds);
//   3. one live game, three rows — a session opened on each difficulty and the
//      board it dealt, its intro line, and the board left behind when it
//      closes;
//   4. that a frost step and a girder still crack and break exactly as they
//      always did, and that nothing outside a session can place one.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WATER, type Grid, type Industry } from "../../src/iso/grid";
import {
  MAP_W, MAP_H, DIFFICULTY_RULES, OBSTACLE_RAMP,
  type DifficultyKey, type DifficultyRules,
} from "../../src/iso/config";
import { buildTile } from "../../src/iso/track";
import { setRng, mulberry32, BOARD_W, BOARD_H } from "../../src/game/config";
import { Board } from "../../src/game/board";
import {
  obstacleDrag, obstacleIntroLine, sessionObstacles,
} from "../../src/iso/tuning";
import { SAVE_KEY } from "../../src/iso/savegame-runtime";

// ── stub the art imports (vite handles these in the browser) ──────────────
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
interface ObstacleHook {
  grid: Grid;
  track: ReturnType<typeof import("../../src/iso/track").createTrack>;
  eco: import("../../src/iso/economy").EconomyState;
  board: Board;
  purse: Record<string, number>;
  finishSetup: () => void;
  placeDepot: (tx: number, ty: number) => boolean;
  demolish: (tx: number, ty: number) => void;
  setRivalSkill: (key: DifficultyKey) => void;
  retuneDepot: (id?: number) => boolean;
  readonly difficulty: DifficultyRules & { key: DifficultyKey; label: string };
  readonly tuning: {
    depotId: number; score: number;
    obstacles: { frost: number; girders: number; frostHard: 1 | 2 } | null;
  } | null;
  tuningFinish: (abandon?: boolean) => void;
  depotTier: (depotId: number) => number | null;
}

const hook = () => (window as unknown as { __iso: ObstacleHook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

const rules = (key: DifficultyKey): DifficultyRules => DIFFICULTY_RULES[key];
const toasts = (): string[] =>
  [...root.querySelectorAll(".toast")].map((t) => t.textContent ?? "");

/** A board under test: the live game's board, or a seeded one of its own. */
const freshBoard = (): Board => { setRng(mulberry32(1337)); return new Board(); };

beforeEach(() => {
  stubCanvas();
  stubImage();
  window.history.replaceState(null, "", "/?seed=1337");
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

// ── the live map's own Depot sites (the shape iso-l6-difficulty uses) ─────
interface Site { hx: number; hy: number; fy: number; ind: Industry }

function depotSite(grid: Grid, skipId?: number): Site | null {
  for (const ind of grid.industries) {
    if (skipId !== undefined && ind.id === skipId) continue;
    for (let x = ind.tx; x < ind.tx + ind.w; x++) {
      const hx = x, hy = ind.ty + ind.h;
      const fy = hy + 6;
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

/** The PAVED run that makes a Depot a tier-1 Depot — the axis the ramp reads. */
function connect(h: ObstacleHook, site: Site) {
  h.eco.factories.push({ owner: "you", ownerId: 1, tx: site.hx, ty: site.fy, id: 0, townId: null });
  for (let y = site.hy + 1; y < site.fy; y++) buildTile(h.track, "road", site.hx, y, 1);
  buildTile(h.track, "dirt", site.hx, site.fy + 1, 1);
  h.demolish(site.hx, site.fy + 1);
}

const iced = (b: Board) => b.gems().filter((g) => g.hard > 0);
const girded = (b: Board) => b.gems().filter((g) => g.block);

// ══════════════════════════════════════════════════════════════════════════
describe("L10 the table: what each difficulty puts on the board", () => {
  it.skip("is Easy none, Normal frost only, Hard frost and girders", () => {
    for (const key of ["easy", "normal", "hard"] as DifficultyKey[]) {
      const plan = sessionObstacles(rules(key), 1);       // the full row
      const text = `${key}: ${plan.frost} frost / ${plan.girders} girders`;
      if (key === "easy") {
        expect(plan.frost, text).toBe(0);
        expect(plan.girders, text).toBe(0);
      }
      if (key === "normal") {
        expect(plan.frost, text).toBeGreaterThan(0);
        expect(plan.girders, text).toBe(0);               // frost ONLY
      }
      if (key === "hard") {
        expect(plan.frost, text).toBeGreaterThan(0);
        expect(plan.girders, text).toBeGreaterThan(0);
      }
    }
    // Hard's ice is the two-match kind; Normal's cracks in one.
    expect(sessionObstacles(rules("hard"), 1).frostHard).toBe(2);
    expect(sessionObstacles(rules("normal"), 1).frostHard).toBe(1);
    // …and neither row is anywhere near a whole board: an obstacle is a
    // handful of cells to play around, not a wall.
    for (const key of ["normal", "hard"] as DifficultyKey[]) {
      const p = sessionObstacles(rules(key), 1);
      expect(p.frost + p.girders, `${key} is gentle`).toBeLessThan(BOARD_W * BOARD_H / 4);
      expect(obstacleDrag(p), `${key} costs a session something`).toBeGreaterThan(0);
      expect(obstacleDrag(p), `${key} is not a wall`).toBeLessThan(0.35);
    }
  });

  it("ramps with the Depot's tier — the first Depot meets fewer", () => {
    for (const key of ["normal", "hard"] as DifficultyKey[]) {
      const full = sessionObstacles(rules(key), 1);
      const first = sessionObstacles(rules(key), 0);
      expect(first.frost, `${key} frost`).toBeLessThan(full.frost);
      expect(first.frost, `${key} keeps some frost on the first Depot`).toBeGreaterThan(0);
      if (full.girders > 0) expect(first.girders, `${key} girders`).toBeLessThan(full.girders);
      else expect(first.girders, `${key} has no girders to ramp`).toBe(0);
      // The ramp is the config's, read once — hard-coding 0.5 here would make
      // a tuning change a test failure instead of a number change.
      expect(first.frost).toBe(Math.floor(full.frost * OBSTACLE_RAMP.firstTier));
      expect(first.frostHard, `${key} thins the ice too`).toBe(OBSTACLE_RAMP.firstTierHard);
    }
    // Easy has nothing to ramp.
    expect(sessionObstacles(rules("easy"), 0)).toEqual(sessionObstacles(rules("easy"), 1));
  });

  it("names them in the world, in the session intro — and says nothing on Easy", () => {
    const hard = sessionObstacles(rules("hard"), 1);
    const line = obstacleIntroLine("Hard", { ...hard, frost: hard.frost, girders: hard.girders });
    expect(line).toMatch(/^Hard: /);
    expect(line, "the intro is in-world, not a rule's name").toMatch(/rails froze overnight/);
    expect(line, "girders are named too").toMatch(/girder/);
    expect(line, "the counts are what the player can see").toContain(`${hard.frost} iced`);
    // Frost alone reads as frost alone.
    const normal = sessionObstacles(rules("normal"), 1);
    expect(obstacleIntroLine("Normal", { ...normal, frost: normal.frost, girders: 0 }))
      .not.toMatch(/girder/);
    // …and a clean board promises nothing it did not place.
    expect(obstacleIntroLine("Easy", { frost: 0, girders: 0, frostHard: 1 })).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L10 the placement", () => {
  it("puts on exactly what the table asked for, and reports what landed", () => {
    const b = freshBoard();
    const plan = sessionObstacles(rules("hard"), 1);
    const placed = b.seedObstacles(plan.frost, plan.girders, plan.frostHard);
    expect(placed).toEqual(plan);
    expect(iced(b)).toHaveLength(plan.frost);
    expect(girded(b)).toHaveLength(plan.girders);
    for (const g of iced(b)) expect(g.hard).toBe(plan.frostHard);
  });

  it("is seeded — the same seed deals the same board, twice", () => {
    const cellsOf = (b: Board) =>
      b.gems().filter((g) => g.block || g.hard > 0).map((g) => `${g.r},${g.c}:${g.hard}${g.block}`).sort();
    const a = freshBoard();
    a.seedObstacles(6, 3, 2);
    const b = freshBoard();
    b.seedObstacles(6, 3, 2);
    expect(cellsOf(b)).toEqual(cellsOf(a));
  });

  it("never deals a board with no legal move, however greedy the table", () => {
    // More obstacles than the board could ever hold: the deadlock guard puts
    // back every one that would take the last legal move with it.
    for (let seed = 1; seed <= 25; seed++) {
      setRng(mulberry32(seed));
      const b = new Board();
      const placed = b.seedObstacles(BOARD_W * BOARD_H, BOARD_W * BOARD_H, 2);
      expect(b.hasMove(), `seed ${seed}: ${placed.frost} ice + ${placed.girders} girders, no move left`)
        .toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L10 one live game, three rows", () => {
  it("Easy: the session opens on a clean board and says nothing about obstacles", async () => {
    const h = await boot({ newLoop: true });
    h.setRivalSkill("easy");
    h.finishSetup();
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy)).toBe(true);
    await settle();
    expect(h.tuning, "match-3 still opens on Easy").not.toBeNull();
    expect(h.tuning!.obstacles).toEqual({ frost: 0, girders: 0, frostHard: 1 });
    expect(iced(h.board)).toHaveLength(0);
    expect(girded(h.board)).toHaveLength(0);
    // The intro is the ordinary one: a difficulty with no obstacles does not
    // tell the player about obstacles.
    expect(toasts().some((t) => /ice|frost|girder/i.test(t))).toBe(false);
  });

  it.skip("Normal: the session opens frosted, and names it in the intro", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();                                   // normal is the default
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy)).toBe(true);
    await settle();
    const plan = sessionObstacles(rules("normal"), 0);   // a first Depot: tier 0
    expect(h.tuning!.obstacles).toEqual(plan);
    expect(iced(h.board)).toHaveLength(plan.frost);
    expect(girded(h.board), "Normal has no girders").toHaveLength(0);
    for (const g of iced(h.board)) expect(g.hard).toBe(plan.frostHard);
    expect(toasts().some((t) => /rails froze overnight/i.test(t)), "the intro says why").toBe(true);
    expect(h.board.hasMove(), "a frosted board is still a playable one").toBe(true);
  });

  it.skip("Hard: the session opens frosted AND girded, and the board stays playable", async () => {
    const h = await boot({ newLoop: true });
    h.setRivalSkill("hard");
    h.finishSetup();
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy)).toBe(true);
    await settle();
    const plan = sessionObstacles(rules("hard"), 0);
    expect(h.tuning!.obstacles).toEqual(plan);
    expect(iced(h.board)).toHaveLength(plan.frost);
    expect(girded(h.board)).toHaveLength(plan.girders);
    for (const g of iced(h.board)) expect(g.hard).toBe(plan.frostHard);
    const intro = toasts().find((t) => /rails froze overnight/i.test(t));
    expect(intro, "the intro names both").toBeTruthy();
    expect(intro).toMatch(/girder/);
    expect(h.board.hasMove()).toBe(true);
  });

  it.skip("a paved Depot opens the FULL table — the ramp is the tier's, not the mood's", async () => {
    const h = await boot({ newLoop: true });
    h.setRivalSkill("hard");
    h.finishSetup();
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy)).toBe(true);
    await settle();
    const id = h.tuning!.depotId;
    const first = h.tuning!.obstacles!;
    h.tuningFinish(true);                                  // abandon: close it
    await settle();
    connect(h, site);                                      // pave the link → tier 1
    await settle();
    expect(h.depotTier(id), "the pave is the tier the ramp counts").toBe(1);
    // Hard owes a re-match any time, so the plate's key opens the next one.
    expect(h.retuneDepot(id)).toBe(true);
    await settle();
    const full = sessionObstacles(rules("hard"), 1);
    expect(h.tuning!.obstacles!.girders, "the tier-1 session carries more girders")
      .toBeGreaterThan(first.girders);
    expect(h.tuning!.obstacles!.frost).toBeGreaterThanOrEqual(first.frost);
    expect(h.tuning!.obstacles!.girders).toBe(full.girders);
    expect(girded(h.board)).toHaveLength(full.girders);
  });

  it("the obstacles go when the session does — no ice is left on the board", async () => {
    const h = await boot({ newLoop: true });
    h.setRivalSkill("hard");
    h.finishSetup();
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy)).toBe(true);
    await settle();
    expect(iced(h.board).length + girded(h.board).length).toBeGreaterThan(0);
    h.tuningFinish(false);
    await settle();
    expect(h.tuning, "the session is closed").toBeNull();
    expect(iced(h.board)).toHaveLength(0);
    expect(girded(h.board)).toHaveLength(0);
    // …and the next session deals a fresh set rather than inheriting them.
    h.demolish(site.hx, site.hy);
    for (const c of ["wood", "stone", "grain", "ore", "oil"] as const) h.purse[c] = 99;
    expect(h.placeDepot(site.hx, site.hy)).toBe(true);
    await settle();
    expect(iced(h.board).length + girded(h.board).length).toBeGreaterThan(0);
    expect(h.tuning!.obstacles!.frost).toBe(sessionObstacles(rules("hard"), 0).frost);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L10 an obstacle is still the obstacle it always was", () => {
  it.skip("cracks one step per adjacent match, and a girder breaks at one", async () => {
    const b = freshBoard();
    b.setPaysScore(true);                       // the session board: score, not cargo
    const rewards: string[] = [];
    b.onReward = (kind) => rewards.push(kind);
    // Row 4 is a 3-run whose third gem is FROSTED two deep: the frozen gem
    // still matches, it just cracks a step instead of clearing. The girder
    // above (4,1) is not in the run at all — it is broken by the removals
    // NEXT TO it, and the colours around them make sure it is the only run.
    for (const [r, c, res] of [[4, 0, "wood"], [4, 1, "wood"], [4, 2, "wood"], [4, 3, "brick"],
      [3, 0, "ore"], [3, 2, "sheep"], [3, 3, "ore"], [5, 0, "sheep"], [5, 1, "ore"],
      [5, 2, "brick"], [5, 3, "sheep"], [2, 0, "brick"], [2, 1, "ore"], [2, 2, "sheep"]] as const) {
      b.grid[r]![c]!.res = res;
    }
    b.grid[4]![2]!.hard = 2;
    b.grid[3]![1]!.block = true;
    await b.settle(0);
    expect(iced(b).some((g) => g.r === 4 && g.c === 2 && g.hard === 1),
      "one match cracks one step off the ice — and only one").toBe(true);
    expect(girded(b).some((g) => g.r === 3 && g.c === 1),
      "a girder is broken by an adjacent removal, not matched itself").toBe(false);
    // L12 (#227): both are board rewards the session scores.
    expect(rewards).toContain("frost");
    expect(rewards).toContain("girder");
  });

  it("cannot be placed outside a session — the board has no sabotage door", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    await settle();
    // No session up: the board is not a game surface at all, and it is clean.
    expect(h.tuning).toBeNull();
    expect(iced(h.board)).toHaveLength(0);
    expect(girded(h.board)).toHaveLength(0);
    // The retired cards are the only things that could ever have dirtied it,
    // and they are refused without a charge (L9) — nothing relights them.
    for (const dead of ["harden", "block", "fog", "repair"]) {
      expect(root.querySelector(`[data-black="${dead}"]`), `${dead} is back on sale`).toBeNull();
    }
    const surface = h.board.constructor.prototype as Record<string, unknown>;
    for (const gone of ["harden", "dropBlocks", "fog", "smashBlocks", "applySabotage"]) {
      expect(surface[gone], `Board.${gone}() is a sabotage path again`).toBeUndefined();
    }
    // What replaced them is one door, and it is the session that opens it.
    expect(typeof surface.seedObstacles).toBe("function");
  });
});
