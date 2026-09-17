// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// L12 (#227) — Board rewards feed the tuning score, not the purse.
//
// The new loop's acceptance block, pinned here against the LIVE game (flag on):
//
//   • no board event — match, cross, bomb, match-5, combo, frost, girder —
//     changes the purse;
//   • crosses, bombs and the big shapes visibly raise the session score
//     (the score table lives in tuning.ts) and the yield that score buys;
//   • the cross resource picker is gone: a cross resolves as it forms, with
//     no pause and no modal, and a holy cross outscores a broken one;
//   • tokens are gone from the session board — 4-matches forge nothing,
//     5-matches still forge their bomb, the 20-second spawner mints nothing
//     and a lorry load comes back empty.
//
// And the control half: with the flag OFF the board is exactly the shipped
// cargo board — tokens forge, the cross pauses and asks, combos pay gold.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WATER, type Grid, type Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H, CARGOES, TUNING, type Cargo } from "../../src/iso/config";
import { GEM_TO_CARGO } from "../../src/iso/quarry";
import { createTrack, buildTile, type Track } from "../../src/iso/track";
import { setRng, mulberry32, type ResKey } from "../../src/game/config";
import {
  TUNING_REWARD_SCORE, TUNING_ABANDON_YIELD,
} from "../../src/iso/tuning";
import { SAVE_KEY } from "../../src/iso/savegame-runtime";
import type { Board, CrossKind, RewardKind } from "../../src/game/board";

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
interface L12Hook {
  readonly newLoop: boolean;
  grid: Grid;
  track: Track;
  eco: import("../../src/iso/economy").EconomyState;
  board: Board;
  quarry: import("../../src/iso/quarry").Quarry;
  purse: Record<string, number>;
  finishSetup: () => void;
  placeDepot: (tx: number, ty: number) => boolean;
  econTick: (now?: number) => void;
  /** The per-frame clock (board effects + the session's own close rule). */
  tick: (now?: number) => void;
  refreshQuarry: () => void;
  reach: Record<string, number>;
  readonly depotYields: { id: number; owner: string; tx: number; ty: number; yield: number | null }[];
  readonly tuning: {
    depotId: number; cargo: Cargo; moves: number; movesLeft: number; used: number;
    score: number; yield: number; abandonYield: number;
  } | null;
  tuningFinish: (abandon?: boolean) => void;
}

const hook = () => (window as unknown as { __iso: L12Hook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
/** Let the board's async cascade finish (its waits are real timers). */
const boardIdle = async (h: L12Hook) => {
  for (let i = 0; i < 80 && h.board.busy; i++) await new Promise((r) => setTimeout(r, 30));
  expect(h.board.busy, "the board settled").toBe(false);
};

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

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

// ── the live map's own Depot sites (same shape the L4 file uses) ──────────
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

/** Plant a Factory at the corridor's far end and lay the road that joins it. */
function connect(h: L12Hook, site: Site) {
  h.eco.factories.push({ owner: "you", ownerId: 1, tx: site.hx, ty: site.fy, id: 0, townId: null });
  for (let y = site.hy + 1; y < site.fy; y++) buildTile(h.track, "road", site.hx, y, 1);
}

/** Open the session for a fresh Depot: the board is wiped and biased. */
async function openSession(h: L12Hook): Promise<Site> {
  h.finishSetup();
  const site = depotSite(h.grid);
  expect(site, "seed 1337 keeps an industry with a legal south corridor").toBeTruthy();
  expect(h.placeDepot(site!.hx, site!.hy)).toBe(true);
  await settle();
  expect(h.tuning, "the Depot opened its tuning session").not.toBeNull();
  return site!;
}

// ── deterministic board layouts ────────────────────────────────────────────
/**
 * A two-colour checkerboard: no run of three exists, so whatever this file
 * paints on top is exactly what the board will clear. Gems keep their
 * identity; tokens, frost, girders and specials are all wiped first.
 */
function checkerboard(board: Board, a: ResKey = "wood", b: ResKey = "ore") {
  for (let r = 0; r < board.h; r++) for (let c = 0; c < board.w; c++) {
    const g = board.grid[r][c]!;
    g.res = (r + c) % 2 === 0 ? a : b;
    g.tier = 0; g.hard = 0; g.block = false; g.special = null; g.forged = false;
  }
}

/** A holy cross (3×4) centred on (r,c): 3 across, 4 down, sharing (r,c). */
function makeHoly(board: Board, r: number, c: number, res: ResKey) {
  board.grid[r][c]!.res = res;
  board.grid[r][c - 1]!.res = res;
  board.grid[r][c + 1]!.res = res;
  board.grid[r - 1][c]!.res = res;
  board.grid[r + 1][c]!.res = res;
  board.grid[r + 2][c]!.res = res;
}

/** A broken cross (3×3 plus) centred on (r,c). */
function makeBroken(board: Board, r: number, c: number, res: ResKey) {
  board.grid[r][c]!.res = res;
  board.grid[r][c - 1]!.res = res;
  board.grid[r][c + 1]!.res = res;
  board.grid[r - 1][c]!.res = res;
  board.grid[r + 1][c]!.res = res;
}

/** A straight five of `res` centred on (r,c) — the bomb shape. */
function makeFive(board: Board, res: ResKey, r: number, c: number) {
  for (const dc of [-2, -1, 0, 1, 2]) board.grid[r][c + dc]!.res = res;
}

/** A straight four of `res` from (r,c-1) to (r,c+2). */
function makeFour(board: Board, res: ResKey, r: number, c: number) {
  for (const dc of [-1, 0, 1, 2]) board.grid[r][c + dc]!.res = res;
}

/** A plain three of `res` centred on (r,c). */
function makeThree(board: Board, res: ResKey, r: number, c: number) {
  board.grid[r][c]!.res = res;
  board.grid[r][c - 1]!.res = res;
  board.grid[r][c + 1]!.res = res;
}

/**
 * A guaranteed two-deep cascade: a three of `res` at (r, c±1), with a second
 * three of `alt` waiting vertically — two of them directly above the centre
 * and one directly below — so clearing the first run drops the top pair onto
 * the bottom one and the pass counts two. The third colour keeps every cell
 * this layout touches free of any other match.
 */
function makeCascade(board: Board, r: number, c: number, res: ResKey, alt: ResKey = "wheat") {
  makeThree(board, res, r, c);
  board.grid[r - 2][c]!.res = alt;
  board.grid[r - 1][c]!.res = alt;
  board.grid[r + 1][c]!.res = alt;
}

const readout = () => [...root.querySelectorAll(".harvest-pop")]
  .map((e) => e.textContent ?? "").join(" · ");

const tokensOnBoard = (board: Board): number =>
  board.gems().filter((g) => g.tier > 0).length;

const purseOf = (p: Record<string, number>) =>
  Object.fromEntries(CARGOES.map((c) => [c, p[c] ?? 0]));

// ══════════════════════════════════════════════════════════════════════════
describe("L12 the score table (tuning.ts)", () => {
  it("pays every reward, and bigger shapes outscore smaller ones", () => {
    for (const [kind, pts] of Object.entries(TUNING_REWARD_SCORE)) {
      expect(pts, `${kind} pays something`).toBeGreaterThan(0);
    }
    // the issue's rule, in one glance: the holy cross is the session's
    // richest shape, the broken cross next, the smaller shapes below both.
    expect(TUNING_REWARD_SCORE.holyCross).toBeGreaterThan(TUNING_REWARD_SCORE.brokenCross);
    expect(TUNING_REWARD_SCORE.brokenCross).toBeGreaterThan(TUNING_REWARD_SCORE.shape);
    expect(TUNING_REWARD_SCORE.shape).toBeGreaterThan(TUNING_REWARD_SCORE.frost);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L12 no board event reaches the purse (newLoop)", () => {
  it("the new loop's board pays score from boot", async () => {
    const h = await boot({ newLoop: true });
    expect(h.newLoop).toBe(true);
    expect(h.board.paysScore, "score mode is set at boot, not per session").toBe(true);
  });

  it("match, cross, bomb, match-5, combo, frost and girder all leave the purse untouched", async () => {
    const h = await boot({ newLoop: true });
    await openSession(h);
    const before = purseOf(h.purse);

    // 1. a plain match
    checkerboard(h.board);
    makeThree(h.board, "brick", 3, 3);
    await h.board.settle();

    // 2. a holy cross
    checkerboard(h.board);
    makeHoly(h.board, 3, 3, "brick");
    await h.board.settle();

    // 3. a broken cross
    checkerboard(h.board);
    makeBroken(h.board, 3, 3, "wheat");
    await h.board.settle();

    // 4. a match-5 mints its bomb — then the bomb blows a whole colour
    checkerboard(h.board);
    makeFive(h.board, "sheep", 4, 3);
    await h.board.settle();
    const bomb = h.board.gems().find((g) => g.special === "bomb");
    expect(bomb, "the 5-match still forges a bomb on the new loop").toBeTruthy();
    await h.board.detonate(bomb!, "wood");

    // 5. a cascade deep enough to count a combo
    checkerboard(h.board);
    makeCascade(h.board, 4, 3, "brick");
    await h.board.settle();

    expect(h.purse, "no cargo moved for any board event").toEqual(purseOf(before));
    // …and the session really banked all of it as score.
    expect(h.tuning!.score).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L12 the shapes pay the session, and the chooser is gone (newLoop)", () => {
  it("a cross resolves as it forms — no pause, no picker, no cargo units", async () => {
    const h = await boot({ newLoop: true });
    await openSession(h);
    const asked = vi.fn();
    h.board.onCrossChoice = asked;

    checkerboard(h.board);
    makeHoly(h.board, 3, 3, "brick");
    await h.board.settle();
    await boardIdle(h);

    expect(asked, "the cascade never paused on a chooser").not.toHaveBeenCalled();
    expect(root.querySelector(".cross-pick"), "no resource-picker modal").toBeNull();
    expect(h.board.busy).toBe(false);
  });

  it("the board fires the reward kinds it owes — holy, broken, shape, frost, girder, combo", async () => {
    const h = await boot({ newLoop: true });   // no session: capture kinds only
    const seen: RewardKind[] = [];
    h.board.onReward = (k) => { seen.push(k); };
    const purseBefore = purseOf(h.purse);

    checkerboard(h.board);
    makeHoly(h.board, 3, 3, "brick");
    await h.board.settle();
    expect(seen).toContain("holyCross");

    seen.length = 0;
    checkerboard(h.board);
    makeBroken(h.board, 3, 3, "wheat");
    await h.board.settle();
    expect(seen).toContain("brokenCross");

    seen.length = 0;
    checkerboard(h.board);
    makeFive(h.board, "sheep", 4, 3);
    await h.board.settle();
    expect(seen).toContain("shape");                       // the match-5's reward

    seen.length = 0;
    checkerboard(h.board);
    makeThree(h.board, "brick", 3, 3);
    h.board.grid[3][3]!.hard = 2;                          // a frozen centre
    await h.board.settle();
    // the frost step paid (a deeper cascade may crack it further — that is
    // the game working, so only the reward itself is pinned)
    expect(seen).toContain("frost");

    seen.length = 0;
    checkerboard(h.board);
    makeThree(h.board, "brick", 3, 3);
    h.board.grid[3][5]!.block = true;                      // a girder beside the run
    await h.board.settle();
    expect(seen).toContain("girder");
    expect(h.board.grid[3][5]!.block).toBe(false);         // broken by the match

    // a combo banks its reward on the second one — the coin's own rule
    // (earlier cascades may have banked toward the counter, so start clean)
    h.board.comboCount = 0;
    seen.length = 0;
    h.board.registerCombo();
    expect(seen).toEqual([]);
    h.board.registerCombo();
    expect(seen).toEqual(["combo"]);

    expect(h.purse).toEqual(purseOf(purseBefore));         // and still no purse
  });

  it("rewards land on the session score, and a cross is worth at least its gems plus its bonus", async () => {
    const h = await boot({ newLoop: true });
    await openSession(h);

    checkerboard(h.board);
    makeHoly(h.board, 3, 3, "brick");
    const beforeHoly = h.tuning!.score;
    await h.board.settle();
    expect(h.tuning!.score - beforeHoly)
      .toBeGreaterThanOrEqual(6 + TUNING_REWARD_SCORE.holyCross);

    checkerboard(h.board);
    makeBroken(h.board, 3, 3, "wheat");
    const beforeBroken = h.tuning!.score;
    await h.board.settle();
    expect(h.tuning!.score - beforeBroken)
      .toBeGreaterThanOrEqual(5 + TUNING_REWARD_SCORE.brokenCross);

    // a combo's exact value: two combos clear nothing else
    // (earlier cascades may have banked toward the counter, so start clean)
    h.board.comboCount = 0;
    const s0 = h.tuning!.score;
    h.board.registerCombo();
    expect(h.tuning!.score).toBe(s0);
    h.board.registerCombo();
    expect(h.tuning!.score).toBe(s0 + TUNING_REWARD_SCORE.combo);

    // the plate's live yield is the score's yield — above the default…
    expect(h.tuning!.yield).toBeGreaterThan(TUNING.minYield);
    // …and finishing lands it on the Depot, above the abandon default.
    const depotId = h.tuning!.depotId;
    h.tuningFinish(false);
    await settle();
    const landed = h.depotYields.find((d) => d.id === depotId)!.yield;
    expect(landed).toBeGreaterThan(TUNING_ABANDON_YIELD);
  });

  it("the readout is a score popup — no cargo icons, the number is gold", async () => {
    const h = await boot({ newLoop: true });
    await openSession(h);

    checkerboard(h.board);
    makeThree(h.board, "brick", 3, 3);
    await h.board.settle();
    await boardIdle(h);

    const pops = [...root.querySelectorAll(".harvest-pop")];
    expect(pops.length, "the pass floated a readout").toBeGreaterThan(0);
    expect(root.querySelector(".harvest-pop .hp-score")).toBeTruthy();
    const text = pops.map((e) => e.textContent ?? "").join(" ");
    expect(text).toMatch(/\+\d+ score/);
    // nothing cargo-shaped anywhere in the readout
    const cargoSpans = root.querySelectorAll(".harvest-pop .hp-body span:not(.hp-score)");
    expect(cargoSpans.length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L12 the session board is token-free (newLoop)", () => {
  it("4-matches forge nothing, 5-matches still forge a bomb, the spawner and the lorry mint nothing", async () => {
    const h = await boot({ newLoop: true });
    const site = await openSession(h);

    expect(tokensOnBoard(h.board), "the session starts token-free").toBe(0);

    // a 4-match leaves no token behind…
    checkerboard(h.board);
    makeFour(h.board, "brick", 3, 3);
    await h.board.settle();
    expect(tokensOnBoard(h.board)).toBe(0);

    // …a 5-match leaves its bomb and no tier-2 token…
    checkerboard(h.board);
    makeFive(h.board, "sheep", 4, 3);
    await h.board.settle();
    expect(h.board.gems().some((g) => g.special === "bomb")).toBe(true);
    expect(tokensOnBoard(h.board)).toBe(0);

    // …the 20-second spawn clock mints nothing…
    connect(h, site);
    h.refreshQuarry();
    h.tick(performance.now() + 30_000);
    expect(tokensOnBoard(h.board)).toBe(0);

    // …and a lorry load comes back empty.
    expect(h.quarry.deliver(GEM_TO_CARGO["brick" as ResKey])).toBe(0);
    expect(tokensOnBoard(h.board)).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L12 the shipped loop is untouched (flag off)", () => {
  it("tokens forge, the cross pauses and asks, and two combos pay a gold coin", async () => {
    const h = await boot();
    expect(h.newLoop).toBe(false);
    expect(h.board.paysScore).toBe(false);
    h.finishSetup();

    const seen: RewardKind[] = [];
    h.board.onReward = (k) => { seen.push(k); };
    // the board's own "a token was minted" signal (forge and spawner both
    // fire it; with no Depot connected, only the forge can). A long cascade
    // may go on to match and pay the token it minted — the forge itself is
    // the shipped rule being pinned.
    let minted = 0;
    const fx = h.board.onFx;
    h.board.onFx = (t, r, c, text) => { if (t === "up") minted++; fx(t, r, c, text); };

    // a 4-match forges its token — the shipped rule, unchanged
    checkerboard(h.board);
    makeFour(h.board, "brick", 3, 3);
    await h.board.settle();
    expect(minted, "a token was forged by the 4-match").toBeGreaterThanOrEqual(1);
    expect(seen, "no score mode on the old board").toEqual([]);

    // a holy cross pauses the cascade and asks how to spend its blessing
    const asked = vi.fn((_k: CrossKind, _picks: number, pick: (chosen: ResKey[]) => void) => pick([]));
    h.board.onCrossChoice = asked;
    checkerboard(h.board);
    makeHoly(h.board, 3, 3, "wheat");
    await h.board.settle();
    expect(asked, "the chooser still answers the cross").toHaveBeenCalled();

    // two combos still pay a gold coin into the purse
    // (earlier cascades may have banked toward the counter, so start clean)
    h.board.comboCount = 0;
    const gold = h.purse.gold ?? 0;
    h.board.registerCombo();
    h.board.registerCombo();
    expect(h.purse.gold ?? 0).toBe(gold + 1);
    expect(seen, "and none of it ran the score path").toEqual([]);
  });
});
