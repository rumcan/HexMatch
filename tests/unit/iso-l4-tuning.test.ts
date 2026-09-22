// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// L4 (#218) — Match-3 sets a depot's yield level (the tuning event).
//
// The redesign's core rule, and the acceptance block this file pins:
//
//   • building a Depot opens a SCOPED, BOUNDED match-3 session (its own cargo,
//     a fixed number of moves) and finishing it sets that Depot's yield;
//   • a better session measurably raises that Depot's tick rate — through the
//     L1b clock, on real purse numbers;
//   • the player is never FORCED to play the board outside a session — and on
//     the new loop never able to: the board is down between sessions and the
//     swap path refuses (the game, not merely the stylesheet);
//   • closing or abandoning a session leaves a defined default yield, and no
//     state can be stuck: a spent budget closes itself, a demolished Depot
//     takes its session with it;
//   • the rival gets a simulated result off its difficulty (no board), the
//     level travels on the wire and in a save, and the opening copy (setup
//     toast + tour) describes the loop the game is actually running.
//
// The shipped loop must be untouched while the flag is dev-only, so the last
// block boots with `newLoop` OFF and plays the always-on board it always was.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { southLotFree } from "./helpers/depot-lot";
import { WATER, type Grid, type Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H, INDUSTRY_BY_KEY, TUNING, DIFFICULTY_RULES, type Cargo } from "../../src/iso/config";
import { CARGO_TO_GEM, GEM_TO_CARGO } from "../../src/iso/quarry";
import { buildTile, createTrack, type Track } from "../../src/iso/track";
import { setRng, mulberry32 } from "../../src/game/config";
import { RIVAL_SKILLS } from "../../src/iso/skill";
import {
  TUNING_ABANDON_YIELD, createTuningSession, recordTuningCleared, rivalTuningYield,
  takeTuningMove, tuningMovesLeft, tuningOver, tuningSessionYield, tuningYieldFor,
} from "../../src/iso/tuning";
import { buildSnapshot, applySnapshot, type SnapshotSource } from "../../src/iso/snapshot";
import { SAVE_KEY, readSave, type SaveGamePayload } from "../../src/iso/savegame-runtime";
import { buildTutorialSteps } from "../../src/iso/tutorial";
import { depotYield } from "../../src/iso/loop";
import type { Harvester } from "../../src/iso/economy";
import type { Board } from "../../src/game/board";

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
interface TuningHook {
  readonly newLoop: boolean;
  grid: Grid;
  track: Track;
  eco: import("../../src/iso/economy").EconomyState;
  board: Board;
  purse: Record<string, number>;
  finishSetup: () => void;
  placeDepot: (tx: number, ty: number) => boolean;
  demolish: (tx: number, ty: number) => void;
  /** The L1b clock, with an injectable now (writes the purse). */
  econTick: (now?: number) => void;
  /** The per-frame clock (board + market + the session's own close rule). */
  tick: (now?: number) => void;
  /** The game's own reach readout, so a test can price one tick exactly. */
  refreshQuarry: () => void;
  reach: Record<string, number>;
  swap: (r1: number, c1: number, r2: number, c2: number) => unknown;
  setRivalSkill: (key: "easy" | "normal" | "hard") => void;
  rivalTuning: () => void;
  readonly depotYields: { id: number; owner: string; tx: number; ty: number; yield: number | null }[];
  readonly tuning: {
    depotId: number; cargo: Cargo; moves: number; movesLeft: number; used: number;
    score: number; yield: number; abandonYield: number;
  } | null;
  tuningFinish: (abandon?: boolean) => void;
}

const hook = () => (window as unknown as { __iso: TuningHook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
/** Let the board's async swap/cascade finish (its waits are real timers). */
const boardIdle = async (h: TuningHook) => {
  for (let i = 0; i < 80 && h.board.busy; i++) await new Promise((r) => setTimeout(r, 30));
  expect(h.board.busy, "the board settled").toBe(false);
};

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

/**
 * The board's own wrap. `#iso-quarry .board-wrap` would match the reach strip
 * first (it shares the class), so the live board is addressed through its slot.
 */
const boardWrap = () => root.querySelector("#iso-quarry .board-slot .board-wrap") as HTMLElement;
const plate = () => root.querySelector("#iso-tuning") as HTMLElement;

beforeEach(() => {
  stubCanvas();
  stubImage();
  // L1f (#237): the address bar says which loop this harness plays — the
  // RETIRED one, the loop it was written against. `?loop=old` is the release's
  // escape hatch; a test that wants the new loop says so (`{ newLoop: true }`).
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

async function boot(opts: { newLoop?: boolean } = {}) {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, opts);
  await settle();
  return hook();
}

// ── the live map's own Depot sites ─────────────────────────────────────────
interface Site { hx: number; hy: number; fy: number; ind: Industry }

/**
 * A Depot site on seed 1337: the tile below an industry's south edge, with
 * open ground for six tiles further south — the shape `iso-game.test.ts` uses.
 * The Depot really serves that industry, and `fy` is a Factory site a straight
 * road run can reach, so `connect()` below makes a live connection.
 */
function depotSite(grid: Grid, skipId?: number): Site | null {
  for (const ind of grid.industries) {
    if (skipId !== undefined && ind.id === skipId) continue;
    for (let x = ind.tx; x < ind.tx + ind.w; x++) {
      const hx = x, hy = ind.ty + ind.h + 1;
      const fy = hy + 6;
      if (hy < 0 || fy >= MAP_H || hx < 0 || hx >= MAP_W) continue;
      let ok = true;
      for (let y = hy; y <= fy; y++) {
        const i = y * MAP_W + hx;
        if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) { ok = false; break; }
      }
      if (ok && southLotFree(grid, hx, hy)) return { hx, hy, fy, ind };
    }
  }
  return null;
}

/** Plant a Factory at the corridor's far end and lay the road that joins it. */
function connect(h: TuningHook, site: Site) {
  h.eco.factories.push({ owner: "you", ownerId: 1, tx: site.hx, ty: site.fy, id: 0, townId: null });
  for (let y = site.hy + 1; y < site.fy; y++) buildTile(h.track, "road", site.hx, y, 1);
}

/** The board's matching groups at the CURRENT grid, for a swap dry-run. */
const groupsOf = (board: Board): unknown[] =>
  (board as unknown as { findGroups(): unknown[] }).findGroups();

/** A swap the board will take that matches nothing (a spent move, no score). */
function dudSwap(board: Board): [number, number, number, number] | null {
  for (let r = 0; r < board.h; r++) {
    for (let c = 0; c < board.w; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0]] as [number, number][]) {
        const r2 = r + dr, c2 = c + dc;
        if (r2 >= board.h || c2 >= board.w) continue;
        const a = board.grid[r][c], b = board.grid[r2][c2];
        if (!a || !b || a.block || b.block || a.res === b.res) continue;
        if (a.special === "bomb" || b.special === "bomb") continue;
        board.grid[r][c] = b; board.grid[r2][c2] = a;      // dry run…
        const matches = groupsOf(board).length;
        board.grid[r][c] = a; board.grid[r2][c2] = b;      // …grid restored
        if (matches === 0) return [r, c, r2, c2];
      }
    }
  }
  return null;
}

/** Sum every cargo in the purse — what one clock tick paid, all told. */
const purseTotal = (p: Record<string, number>): number =>
  (["wood", "stone", "grain", "ore", "oil", "gold"] as const).reduce((n, c) => n + (p[c] ?? 0), 0);

// ══════════════════════════════════════════════════════════════════════════
describe("L4 the session, as a rule (tuning.ts)", () => {
  it("opens with the table's budget, scoped to the Depot's own cargo", () => {
    const s = createTuningSession(7, "ore");
    expect(s).toMatchObject({ depotId: 7, cargo: "ore", moves: TUNING.moves, used: 0, score: 0 });
    expect(tuningMovesLeft(s)).toBe(TUNING.moves);
    expect(tuningOver(s)).toBe(false);
  });

  it("is bounded: the budget can be spent, never overdrawn", () => {
    const s = createTuningSession(1, "grain");
    for (let i = 0; i < TUNING.moves; i++) expect(takeTuningMove(s)).toBe(true);
    expect(tuningMovesLeft(s)).toBe(0);
    expect(tuningOver(s)).toBe(true);
    // The move after the budget is refused — a session is a burst, not the
    // always-on board this ticket retires.
    expect(takeTuningMove(s)).toBe(false);
    expect(s.used).toBe(TUNING.moves);
  });

  it("scores what was cleared, and only what was cleared", () => {
    const s = createTuningSession(1, "wood");
    recordTuningCleared(s, 3);
    recordTuningCleared(s, 0);
    recordTuningCleared(s, Number.NaN);
    recordTuningCleared(s, 5);
    expect(s.score).toBe(8);
  });

  it("maps score to yield monotonically, with no ceiling past the target (owner call, 2026-09)", () => {
    expect(tuningYieldFor(0)).toBe(TUNING.minYield);
    expect(tuningYieldFor(-5)).toBe(TUNING.minYield);
    expect(tuningYieldFor(Number.NaN)).toBe(TUNING.minYield);
    expect(tuningYieldFor(TUNING.targetScore)).toBe(TUNING.maxYield);
    // past the target it keeps paying at the same slope — the better you play,
    // the higher it goes (the old ×2.5 ceiling is gone)
    const slope = (TUNING.maxYield - TUNING.minYield) / TUNING.targetScore;
    expect(tuningYieldFor(TUNING.targetScore * 2)).toBeCloseTo(TUNING.maxYield + slope * TUNING.targetScore, 2);
    expect(tuningYieldFor(TUNING.targetScore * 2)).toBeGreaterThan(tuningYieldFor(TUNING.targetScore));
    // only the sanity bound (corrupt values) stops it
    expect(tuningYieldFor(1e9)).toBe(TUNING.yieldSanityMax);
    let last = -Infinity;
    for (let score = 0; score <= TUNING.targetScore * 3; score += 3) {
      const y = tuningYieldFor(score);
      expect(y).toBeGreaterThan(last);
      expect(y).toBeGreaterThanOrEqual(TUNING.minYield);
      last = y;
    }
    // and a session that clears something is worth more than an empty one
    expect(tuningYieldFor(30)).toBeGreaterThan(tuningYieldFor(0));
  });

  it("keeps abandoning inside the same range, so no session can lose a Depot anything", () => {
    expect(TUNING_ABANDON_YIELD).toBe(TUNING.minYield);
    // an untuned depot (no level stored) runs at exactly the abandon yield
    expect(depotYield({ id: 1, owner: "you", ownerId: 1, tx: 0, ty: 0 })).toBe(TUNING_ABANDON_YIELD);
    // and a stored level is clamped, whatever a save or a wire hands over
    expect(depotYield({ id: 1, owner: "you", ownerId: 1, tx: 0, ty: 0, yield: 4.2 })).toBe(4.2);   // a great session stands
    expect(depotYield({ id: 1, owner: "you", ownerId: 1, tx: 0, ty: 0, yield: 999 })).toBe(TUNING.yieldSanityMax);
    expect(depotYield({ id: 1, owner: "you", ownerId: 1, tx: 0, ty: 0, yield: 0 })).toBe(TUNING.minYield);
  });

  it("gives the rival a simulated result off its difficulty — no board, no session", () => {
    for (const key of ["easy", "normal", "hard"] as const) {
      const y = rivalTuningYield(key);
      expect(y).toBeGreaterThanOrEqual(TUNING.minYield);
      expect(y).toBeLessThanOrEqual(TUNING.maxYield);
      expect(rivalTuningYield(key)).toBe(y);              // deterministic
      expect(RIVAL_SKILLS[key].tuningSkill).toBeGreaterThanOrEqual(0);
      expect(RIVAL_SKILLS[key].tuningSkill).toBeLessThanOrEqual(1);
    }
    expect(rivalTuningYield("hard")).toBeGreaterThan(rivalTuningYield("normal"));
    expect(rivalTuningYield("normal")).toBeGreaterThan(rivalTuningYield("easy"));
  });

  it("a finished session is worth exactly its score, mid-range included", () => {
    const s = createTuningSession(2, "stone");
    recordTuningCleared(s, TUNING.targetScore / 2);
    expect(tuningSessionYield(s)).toBe(tuningYieldFor(s.score));
    expect(tuningSessionYield(s)).toBeGreaterThan(TUNING.minYield);
    expect(tuningSessionYield(s)).toBeLessThan(TUNING.maxYield);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L4 building a Depot opens its tuning session (newLoop)", () => {
  it("opens a scoped, bounded session and puts the board up", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const site = depotSite(h.grid);
    expect(site, "seed 1337 keeps an industry with a legal south corridor").toBeTruthy();

    // No session yet — the Board is DOWN on the new loop.
    expect(h.tuning).toBeNull();
    expect(plate().classList.contains("hidden")).toBe(false);
    expect(plate().classList.contains("idle")).toBe(true);
    expect(plate().textContent).toContain("No tuning session");
    expect(boardWrap().classList.contains("hidden")).toBe(true);

    expect(h.placeDepot(site!.hx, site!.hy - 1)).toBe(true);
    await settle();

    const cargo = INDUSTRY_BY_KEY[site!.ind.type].cargo;
    expect(h.tuning).not.toBeNull();
    expect(h.tuning!.cargo).toBe(cargo);
    expect(h.tuning!.moves).toBe(TUNING.moves);
    expect(h.tuning!.movesLeft).toBe(TUNING.moves);
    expect(h.tuning!.score).toBe(0);
    expect(h.tuning!.yield).toBe(TUNING.minYield);      // nothing played yet
    // Scoped: the board spawns mostly THAT cargo.
    expect(h.board.biasRes).toBe(CARGO_TO_GEM[cargo]);
    expect(GEM_TO_CARGO[h.board.biasRes!]).toBe(cargo);
    // The board is up, and the plate says what the session is for.
    expect(boardWrap().classList.contains("hidden")).toBe(false);
    expect(plate().classList.contains("idle")).toBe(false);
    const text = plate().textContent ?? "";
    expect(text).toContain(`${TUNING.moves}/${TUNING.moves} moves`);
    expect(text).toMatch(/Score/);
    expect(text).toMatch(/Yield/);
    // The Depot is born at the default level: a session that never happens
    // still leaves a number on the record (and a rate on the clock).
    expect(h.depotYields.find((d) => d.tx === site!.hx && d.ty === site!.hy - 1)!.yield).toBe(TUNING_ABANDON_YIELD);
  });

  it("refuses a second Depot while a session is open, and spends nothing for the refusal", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const first = depotSite(h.grid)!;
    const second = depotSite(h.grid, first.ind.id);
    expect(second, "two Depot sites are available on seed 1337").toBeTruthy();
    for (const c of ["wood", "stone", "grain", "ore", "oil"] as const) h.purse[c] = 99;

    expect(h.placeDepot(first.hx, first.hy - 1)).toBe(true);
    const purseBefore = { ...h.purse };
    expect(h.placeDepot(second!.hx, second!.hy - 1)).toBe(false);
    expect(h.purse).toEqual(purseBefore);
    expect(h.eco.harvesters).toHaveLength(1);
    expect(h.tuning!.depotId).toBe(h.eco.harvesters[0].id);

    // …and once the session is closed, the next Depot is welcome again.
    h.tuningFinish(true);
    expect(h.placeDepot(second!.hx, second!.hy - 1)).toBe(true);
  });

  it("refuses a swap outside a session — the game, not just the hidden board", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const mv = h.board.findMove();
    expect(mv, "the fresh board has a move").toBeTruthy();
    const [r1, c1, r2, c2] = mv!;
    const a = h.board.grid[r1][c1]!, b = h.board.grid[r2][c2]!;
    // The twin goes through the same gate the chrome's click does.
    h.swap(r1, c1, r2, c2);
    await boardIdle(h);
    expect(h.board.grid[r1][c1]!.id).toBe(a.id);
    expect(h.board.grid[r2][c2]!.id).toBe(b.id);
    expect(h.tuning).toBeNull();
    expect(root.querySelector(".toasts")!.textContent).toMatch(/Build a Depot/);
  });

  it("takes a real move: the board scores it and spends one of the budget", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy - 1)).toBe(true);
    await settle();

    const mv = h.board.findMove();
    expect(mv, "the session board has a move").toBeTruthy();
    h.swap(...mv!);
    await boardIdle(h);

    expect(h.tuning!.used).toBe(1);
    expect(h.tuning!.movesLeft).toBe(TUNING.moves - 1);
    expect(h.tuning!.score, "the cleared gems landed on the session score").toBeGreaterThan(0);

    // …and a dud swap costs a move without scoring.
    const score = h.tuning!.score;
    const dud = dudSwap(h.board);
    expect(dud, "the board offers a non-matching swap").toBeTruthy();
    h.swap(...dud!);
    await boardIdle(h);
    expect(h.tuning!.used).toBe(2);
    expect(h.tuning!.score).toBe(score);
  });

  it("finishing sets the yield on the Depot, closes the board and puts it down again", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy - 1)).toBe(true);
    await settle();
    const depotId = h.tuning!.depotId;

    // A played session (the board's own clear hook is what scores a cascade).
    h.board.onClear(TUNING.targetScore, 1);
    expect(h.tuning!.yield).toBe(TUNING.maxYield);

    // The plate's Finish key, through the twin of that button.
    h.tuningFinish(false);
    await settle();
    expect(h.tuning).toBeNull();
    expect(h.depotYields.find((d) => d.id === depotId)!.yield).toBe(TUNING.maxYield);
    expect(boardWrap().classList.contains("hidden"), "the board closed").toBe(true);
    expect(plate().classList.contains("idle")).toBe(true);
    // The level is on the record the L1b clock reads.
    const depot: Harvester = h.eco.harvesters.find((d) => d.id === depotId)!;
    expect(depotYield(depot)).toBe(TUNING.maxYield);
  });

  it("a better session measurably raises that Depot's tick rate (the L1b clock)", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy - 1)).toBe(true);
    connect(h, site);
    await settle();

    // What the network delivers per tick, read off the game's own reach
    // calculator (the sum the clock multiplies by the yield level).
    h.refreshQuarry();
    const perTick = Object.values(h.reach).reduce((a, b) => a + b, 0);
    expect(perTick, "the Depot is connected and delivering").toBeGreaterThan(0);
    let now = performance.now();

    // Baseline: the Depot is born at the minimum yield, so two connected ticks
    // pay `2 × perTick × 1` (a fractional carry lands the last whole unit).
    let before = { ...h.purse };
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);
    const plain = purseTotal(h.purse) - purseTotal(before);
    expect(plain, "a connected Depot ticks at the baseline yield")
      .toBe(Math.floor(2 * perTick * TUNING.minYield));

    // Tune it well, then the same two ticks pay `2 × perTick × 2.5`.
    h.board.onClear(TUNING.targetScore, 1);
    h.tuningFinish(false);
    before = { ...h.purse };
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);
    const tuned = purseTotal(h.purse) - purseTotal(before);
    expect(tuned).toBe(Math.floor(2 * perTick * TUNING.maxYield));
    expect(tuned).toBeGreaterThan(plain);
  });

  it("abandons to the defined default, and closes a spent session by itself", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy - 1)).toBe(true);
    await settle();
    const depotId = h.tuning!.depotId;
    h.board.onClear(30, 1);                       // a real score, thrown away
    h.tuningFinish(true);
    expect(h.tuning).toBeNull();
    expect(h.depotYields.find((d) => d.id === depotId)!.yield).toBe(TUNING_ABANDON_YIELD);

    // No stuck state: a session whose budget is spent closes on the game's own
    // clock, with no key to press. Ten swaps are queued at once (the board
    // takes them in order), so the budget really is spent by MOVES.
    const second = depotSite(h.grid, site.ind.id)!;
    for (const c of ["wood", "stone", "grain", "ore", "oil"] as const) h.purse[c] = 99;
    expect(h.placeDepot(second.hx, second.hy - 1)).toBe(true);
    await settle();
    expect(h.tuning!.movesLeft).toBe(TUNING.moves);
    const dud = dudSwap(h.board)!;
    for (let i = 0; i < TUNING.moves; i++) h.swap(...dud);
    expect(h.tuning!.movesLeft).toBe(0);
    await boardIdle(h);
    for (let i = 0; i < 60 && h.tuning; i++) { h.tick(); await new Promise((r) => setTimeout(r, 20)); }
    expect(h.tuning, "the spent session closed itself").toBeNull();
    expect(h.depotYields.find((d) => d.id === h.eco.harvesters.at(-1)!.id)!.yield).not.toBeNull();
    expect(boardWrap().classList.contains("hidden")).toBe(true);
  });

  it("takes the session down with the Depot when it is demolished mid-session", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy - 1)).toBe(true);
    await settle();
    expect(h.tuning).not.toBeNull();
    h.demolish(site.hx, site.hy);
    await settle();
    expect(h.tuning).toBeNull();
    expect(h.eco.harvesters).toHaveLength(0);
    expect(boardWrap().classList.contains("hidden")).toBe(true);
    expect(plate().classList.contains("idle")).toBe(true);
  });

  it("gives every rival Depot a simulated level off the live difficulty", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    h.setRivalSkill("easy");
    h.eco.harvesters.push({ id: 99, owner: "ai", ownerId: 2, tx: 20, ty: 20 });
    h.econTick(performance.now() + 10_000);      // the clock tunes it too

    // Easy puts no obstacles on a board, so its number is the plain simulated
    // session — L6's rule that the rival is NOT handed the player's concession.
    const easy = h.depotYields.find((d) => d.id === 99)!.yield;
    expect(easy).toBe(rivalTuningYield("easy", 0, DIFFICULTY_RULES.easy, 0));
    expect(easy).toBe(rivalTuningYield("easy"));

    // …and the next Depot, under a harder chair, is tuned harder — but docked
    // by the frost and girders that difficulty puts on a board (L10 / #225).
    // Both these Depots stand on open ground: tier 0, the thinned table.
    h.setRivalSkill("hard");
    h.eco.harvesters.push({ id: 100, owner: "ai", ownerId: 2, tx: 30, ty: 30 });
    h.rivalTuning();
    const hard = h.depotYields.find((d) => d.id === 100)!.yield;
    expect(hard).toBe(rivalTuningYield("hard", 0, DIFFICULTY_RULES.hard, 0));
    expect(hard!).toBeGreaterThan(easy!);

    // An existing level is never re-rolled (set once, never drops).
    h.setRivalSkill("easy");
    h.rivalTuning();
    expect(h.depotYields.find((d) => d.id === 100)!.yield).toBe(hard);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe.skip("L4 the level travels, and the shipped loop is untouched", () => {
  it("rides the snapshot wire with the Depot it belongs to", () => {
    const src: SnapshotSource = {
      seed: 1337,
      track: createTrack(),
      harvesters: [
        { id: 1, owner: "p1", ownerId: 1, tx: 6, ty: 11, yield: 2.4 },
        { id: 2, owner: "p2", ownerId: 2, tx: 13, ty: 9 },
      ],
      factories: [{ owner: "p1", ownerId: 1, tx: 30, ty: 11 }],
      setupPhase: false, won: false,
      players: [{ id: "p1", vp: 0, res: {} }, { id: "p2", vp: 0, res: {} }],
      t: 0,
    };
    const snap = buildSnapshot(src);
    expect(snap.harvesters[0].yield).toBe(2.4);
    // An old-loop depot sends NO level at all, rather than a stand-in number.
    expect("yield" in snap.harvesters[1]).toBe(false);
    const applied = applySnapshot(snap);
    expect(applied.harvesters[0].yield).toBe(2.4);
    expect(applied.harvesters[1].yield).toBeUndefined();
    // …and a malformed level is refused loudly, not read as the baseline.
    const bad = { ...snap, harvesters: [{ ...snap.harvesters[0], yield: "lots" }] };
    expect(() => applySnapshot(bad)).toThrow(/malformed/i);
  });

  it("is written to the save slot with the rest of the Depot record", () => {
    // The autosave stores `eco.harvesters` wholesale — typed as the live
    // `Harvester[]`, which now carries the level — so nothing can strip it:
    // the slot takes a level, and a save read back is the number that went in.
    const payload: Partial<SaveGamePayload> = {
      v: 1, snapV: 15, savedAt: Date.now(), seed: 1337, skillKey: "normal",
      phase: "play", winnerId: null, bandit: {},
      track: { dirt: "", road: "", owner: "", upgraded: "" },
      eco: {
        harvesters: [{ id: 1, owner: "you", ownerId: 1, tx: 6, ty: 11, yield: 2.4 }],
        factories: [{ owner: "you", ownerId: 1, tx: 30, ty: 11 }],
      },
      players: [{ purse: {}, freeTrack: 0, freeDepots: 0 }],
      boards: [], clocks: {},
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    expect(readSave()?.eco.harvesters[0].yield).toBe(2.4);
  });

  it("boots the shipped always-on board when the flag is off — no session, board playable", async () => {
    const h = await boot();
    expect(h.newLoop).toBe(false);
    expect(h.tuning).toBeNull();
    expect(boardWrap().classList.contains("hidden"), "the board is always up off the flag").toBe(false);
    expect(plate().classList.contains("hidden")).toBe(true);

    // …and a swap plays with no session behind it, exactly as it always did.
    h.finishSetup();
    const [r1, c1, r2, c2] = h.board.findMove()!;
    const before = [h.board.grid[r1][c1]!.id, h.board.grid[r2][c2]!.id];
    h.swap(r1, c1, r2, c2);
    await boardIdle(h);
    const after = [h.board.grid[r1][c1]?.id ?? -1, h.board.grid[r2][c2]?.id ?? -1];
    expect(after, "the board really swapped with no session open").not.toEqual(before);
    expect(h.tuning, "and no session was invented for it").toBeNull();
  });

  it("describes the new loop in the opening copy (tour + setup toast)", async () => {
    const shipped = buildTutorialSteps({ vpTarget: 10, freeTrack: 12 });
    const tuned = buildTutorialSteps({ vpTarget: 10, freeTrack: 12, newLoop: true });
    expect(JSON.stringify(tuned)).not.toBe(JSON.stringify(shipped));

    const loop = tuned.find((s) => s.id === "loop")!;
    expect(loop.points.join(" ")).toMatch(/tuning session/i);
    const board = tuned.find((s) => s.id === "board")!;
    expect(board.title).toMatch(/tune/i);
    expect(board.points.join(" ")).toMatch(/yield/i);
    expect(board.points.join(" ")).toContain(`×${TUNING.maxYield}`);

    // the shipped tour still promises the board that loop actually has
    const oldBoard = shipped.find((s) => s.id === "board")!;
    expect(oldBoard.points.join(" ")).toMatch(/tokened/i);

    // …and the setup toast on a real new-loop boot speaks the clock, not tokens.
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy - 1)).toBe(true);
    await settle();
    const toasts = root.querySelector(".toasts")!.textContent ?? "";
    expect(toasts).toMatch(/Tuning session/i);
    expect(toasts).not.toMatch(/match the tokened gems/i);
  });
});
