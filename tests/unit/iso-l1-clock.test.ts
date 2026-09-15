// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// L1 (#215) — resource income is clock-driven, not match-driven.
//
// Pins the acceptance block:
//   • a connected Depot ticks its cargo in at the base rate with NO match
//     played, and `yieldLevel` multiplies it (default 1 until #218/#220);
//   • the network gate stays: a cut line stops the Depot's ticks, a rebuild
//     resumes them;
//   • a gem match credits no cargo, and a lorry arrival mints no token;
//   • the rival earns on the SAME clock — its autoplayed board no longer
//     feeds its purse;
//   • the yield rides the MP snapshot wire and the localStorage save;
//   • `newLoop` is DEV-only solo-sandbox: a multiplayer boot refuses it.
//
// The wave-2 seams (`distanceFactor`/`transportFactor` answering 1) are
// pinned too, so #216/#217/#218 replacing them shows up as a deliberate test
// edit rather than a silent drift.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  clockIncome, depotYield, distanceFactor, transportFactor,
  industriesInCatchment, type EconomyState, type Harvester,
} from "../../src/iso/economy";
import { createTrack, buildTile, demolishTile, tIdx } from "../../src/iso/track";
import { GRASS, WATER, type Grid, type Industry } from "../../src/iso/grid";
import { CARGOES, INDUSTRY_BY_KEY, MAP_W, MAP_H, type Cargo } from "../../src/iso/config";
import { HARVEST_MS } from "../../src/iso/game";
import { createQuarry } from "../../src/iso/quarry";
import { buildSnapshot, applySnapshot } from "../../src/iso/snapshot";
import { SAVE_KEY } from "../../src/iso/savegame-runtime";
import { mulberry32, setRng } from "../../src/game/config";

// ── pure-world kit (no board, no boot): the same 11,11 farm the quarry tests
// use, small enough that the catchment contents are exactly known. ─────────
function flatGrid(industries: Industry[] = []): Grid {
  const occupancy = new Int16Array(MAP_W * MAP_H).fill(-1);
  industries.forEach((ind, i) => {
    ind.id = i;
    for (let y = ind.ty; y < ind.ty + ind.h; y++)
      for (let x = ind.tx; x < ind.tx + ind.w; x++) occupancy[tIdx(x, y)] = i;
  });
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries, occupancy, seed: 1,
  };
}

const ind = (type: string, tx: number, ty: number): Industry => {
  const def = INDUSTRY_BY_KEY[type];
  return {
    id: 0, type, tx, ty, w: def.footprint[0], h: def.footprint[1],
    output: def.output, banditUntil: 0,
  };
};

const H = (id: number, owner: string, tx: number, ty: number): Harvester =>
  ({ id, owner, ownerId: owner === "you" ? 1 : 0, tx, ty });

const run = (t: ReturnType<typeof createTrack>, kind: "dirt" | "road", x0: number, x1: number, y: number) => {
  for (let x = x0; x <= x1; x++) buildTile(t, kind, x, y, 1);
};

/** Farm (grain, 1.0/tick) at 11,11 under harvester (10,10); a road along row
 *  10 to the Factory at 14,10 completes the link. `connect`/`cut` are the
 *  gate's two halves; the 1.6 Road multiplier must NOT show up (L1 replaces
 *  it with the wave-2 `transportFactor` seam, which answers 1). */
function clockWorld() {
  const grid = flatGrid([ind("farm", 11, 11)]);
  const track = createTrack();
  const harvester = H(1, "you", 10, 10);
  const state: EconomyState = {
    grid, track, harvesters: [harvester],
    factories: [{ owner: "you", ownerId: 1, tx: 14, ty: 10 }],
  };
  const connect = () => run(track, "road", 11, 14, 10);
  const cut = () => demolishTile(track, "road", 12, 10);
  return { state, harvester, connect, cut, track };
}

describe("L1 clockIncome — the new loop's pay line (economy.ts)", () => {
  it("pays a connected Depot its industry's base rate, per tick", () => {
    const w = clockWorld();
    expect(clockIncome(w.state, "you", 0)).toEqual([]);   // no road yet
    w.connect();
    const income = clockIncome(w.state, "you", 0);
    expect(income).toHaveLength(1);
    expect(income[0]).toMatchObject({ cargo: "grain", amount: 1.0 });
    expect(income[0].harvester.id).toBe(1);
  });

  it("multiplies by the Depot's yield level, defaulting to 1", () => {
    const w = clockWorld();
    w.connect();
    expect(depotYield(w.harvester)).toBe(1);               // unset = base rate
    expect(clockIncome(w.state, "you", 0)[0].amount).toBeCloseTo(1.0);
    w.harvester.yieldLevel = 2.5;                          // #218 sets this from a match later
    expect(depotYield(w.harvester)).toBe(2.5);
    expect(clockIncome(w.state, "you", 0)[0].amount).toBeCloseTo(2.5);
  });

  it("stops the ticks when the line is cut and resumes when it is rebuilt", () => {
    const w = clockWorld();
    w.connect();
    expect(clockIncome(w.state, "you", 0).length).toBe(1);
    w.cut();
    expect(clockIncome(w.state, "you", 0)).toEqual([]);
    run(w.track, "road", 12, 12, 10);                      // rebuild the cut tile
    expect(clockIncome(w.state, "you", 0).length).toBe(1);
  });

  it("pays nothing for a blockaded industry while the blockade runs", () => {
    const w = clockWorld();
    w.connect();
    w.state.grid.industries[0]!.banditUntil = 5_000;
    expect(clockIncome(w.state, "you", 4_000)).toEqual([]);
    expect(clockIncome(w.state, "you", 6_000)[0].amount).toBeCloseTo(1.0);
  });

  it("honours PP-16: the second Depot on the same industry adds nothing", () => {
    const w = clockWorld();
    w.state.harvesters.push(H(2, "you", 12, 11));         // overlaps the farm's catchment
    w.connect();
    // The farm is HELD by the first serviced Depot; the second claims nothing,
    // so the clock pays one row, not two.
    const income = clockIncome(w.state, "you", 0);
    expect(income).toHaveLength(1);
    expect(income[0].harvester.id).toBe(1);
  });

  it("sums every HELD industry of the Depot per cargo", () => {
    // farm + forest under one catchment: grain 1.0 and wood 1.0, side by side.
    const grid = flatGrid([ind("farm", 11, 11), ind("forest", 12, 11)]);
    const track = createTrack();
    const state: EconomyState = {
      grid, track, harvesters: [H(1, "you", 10, 10)],
      factories: [{ owner: "you", ownerId: 1, tx: 14, ty: 10 }],
    };
    run(track, "road", 11, 14, 10);
    const income = clockIncome(state, "you", 0);
    expect(income.length).toBe(2);
    expect(income.find((g) => g.cargo === "grain")!.amount).toBeCloseTo(1.0);
    expect(income.find((g) => g.cargo === "wood")!.amount).toBeCloseTo(1.0);
  });

  it("the wave-2 seams answer 1 — #216/#217 fill their own function, not the loop", () => {
    const w = clockWorld();
    expect(transportFactor(w.state, w.harvester)).toBe(1);
    expect(distanceFactor(w.state, w.harvester)).toBe(1);
  });
});

// ── the board's purse line: `payCargo` ────────────────────────────────────
describe("L1 quarry payCargo=false — a match never credits cargo", () => {
  it("answers 0, credits nothing and refuses nothing (no 'lost' toast)", () => {
    const w = clockWorld();
    w.connect();
    const harvests: [Cargo, number][] = [];
    const blocked: [Cargo, number][] = [];
    const q = createQuarry(w.state, "you", {
      payCargo: false,
      onHarvest: (c, n) => harvests.push([c, n]),
      onBlocked: (c, n) => blocked.push([c, n]),
    });
    // a reachable token AND an unreachable colour both answer 0 with no hooks
    expect(q.board.onHarvest("wheat", 2, false)).toBe(0);   // grain — reachable
    expect(q.board.onHarvest("gold", 2, false)).toBe(0);    // unreachable
    expect(q.board.onHarvest("wood", 1, true)).toBe(0);     // forged — always paid before
    expect(harvests).toEqual([]);
    expect(blocked).toEqual([]);
  });

  it("still pays the old loop by default (flag off changes nothing)", () => {
    const w = clockWorld();
    w.connect();
    const harvests: [Cargo, number][] = [];
    const q = createQuarry(w.state, "you", { onHarvest: (c, n) => harvests.push([c, n]) });
    expect(q.board.onHarvest("wheat", 2, false)).toBe(4);   // 2× depot-fed token
    expect(harvests).toEqual([["grain", 4]]);
  });
});

// ── yield on the wire and in the save ─────────────────────────────────────
describe("L1 yieldLevel rides the snapshot", () => {
  it("round-trips through buildSnapshot → applySnapshot", () => {
    const snap = buildSnapshot({
      seed: 7, track: createTrack(), setupPhase: false, won: false,
      harvesters: [{ id: 3, owner: "you", ownerId: 1, tx: 10, ty: 10, yieldLevel: 2.5 }],
      factories: [], players: [],
    });
    const applied = applySnapshot(JSON.parse(JSON.stringify(snap)), 7);
    expect(applied.harvesters[0]).toMatchObject({ id: 3, yieldLevel: 2.5 });
    expect(depotYield(applied.harvesters[0]!)).toBe(2.5);
  });

  it("an unset level serializes to nothing (a pre-L1 snapshot costs no bytes)", () => {
    const snap = buildSnapshot({
      seed: 7, track: createTrack(), setupPhase: false, won: false,
      harvesters: [{ id: 3, owner: "you", ownerId: 1, tx: 10, ty: 10 }],
      factories: [], players: [],
    });
    expect(JSON.stringify(snap)).not.toContain("yieldLevel");
    const applied = applySnapshot(JSON.parse(JSON.stringify(snap)), 7);
    expect(depotYield(applied.harvesters[0]!)).toBe(1);
  });
});

// ── the shipped promise must describe the game that actually plays ───────
describe("L1 tour copy follows the loop", () => {
  it("the loop step never promises purse cargo for a match when newLoop is on", async () => {
    const { buildTutorialSteps } = await import("../../src/iso/tutorial");
    const CTX = { vpTarget: 10, freeTrack: 12 };
    const old = buildTutorialSteps(CTX).find((s) => s.id === "loop")!;
    expect(old.points.join(" ")).toMatch(/matching tokened gems pays the cargo/i);  // shipped copy kept
    const fresh = buildTutorialSteps({ ...CTX, newLoop: true });
    const loop = fresh.find((s) => s.id === "loop")!;
    expect(loop.points.join(" ")).toMatch(/ticks in from every .*Depot.*clock/i);
    expect(loop.points.join(" ")).not.toMatch(/pays the cargo into your purse/i);
    expect(loop.figure?.kind === "chain" ? loop.figure.caption : "").toMatch(/clock/i);
    // step count and ids are otherwise untouched — only the two L1 lines move
    expect(fresh.map((s) => s.id)).toEqual(buildTutorialSteps(CTX).map((s) => s.id));
  });
});

// ── the live game ─────────────────────────────────────────────────────────
// stub the art imports (vite handles these in the browser) — same kit as
// iso-game.test.ts: jsdom has no 2D context, so the boot is verified through
// the game's own test hook rather than pixels.

import { GEM_TO_CARGO } from "../../src/iso/quarry";
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

/** Build a horizontal three of `res` centred on (r,c), optionally moving
 *  `token` into the middle first (the iso-game helpers, verbatim — an exact
 *  three so the payout is known, with the flanks forced to another colour). */
function makeRun(board: Board, res: ResKey, r: number, c: number, token?: Gem) {
  if (token && (token.r !== r || token.c !== c)) moveGem(board, token, r, c);
  for (const cc of [c - 1, c, c + 1]) board.grid[r][cc]!.res = res;
  board.grid[r][c - 2]!.res = ALT(res);
  board.grid[r][c + 2]!.res = ALT(res);
}
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

interface GameHook {
  phase: string;
  newLoop: boolean;
  purse: Record<string, number>;
  players: { id: string; purse: Record<string, number> }[];
  eco: EconomyState;
  track: import("../../src/iso/track").Track;
  grid: Grid;
  board: import("../../src/game/board").Board;
  quarry: import("../../src/iso/quarry").Quarry;
  trucks: { ownerId: number; deliveries: number; depotId: number }[];
  harvesters: Harvester[];
  finishSetup: () => void;
  econTick: (now?: number) => void;
  deliveryTick: (now?: number) => void;
  truckTick: (now?: number, dtMs?: number) => void;
  demolish: (tx: number, ty: number) => void;
  refreshQuarry: (now?: number) => unknown;
  saveNow: () => void;
}

const hook = () => (window as unknown as { __iso: GameHook }).__iso;
const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas();
  stubImage();
  window.history.replaceState(null, "", "/?seed=1337");
  localStorage.removeItem("hexmatch:save");
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

async function boot(opts: { newLoop?: boolean; role?: "solo" | "host" } = {}) {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, opts);
  await settle();
  return hook();
}

/** An industry with a legal SOUTH corridor on the seeded map (same scan the
 *  iso-game suite uses): harvester just below the footprint, 6 tiles clear. */
function findSouthCorridor(
  grid: Grid, len = 6,
): { hx: number; hy: number; fy: number; ind: Industry } | null {
  for (const i0 of grid.industries) {
    for (let x = i0.tx; x < i0.tx + i0.w; x++) {
      const hx = x, hy = i0.ty + i0.h, fy = hy + len;
      if (hy < 0 || fy >= MAP_H || hx < 0 || hx >= MAP_W) continue;
      let ok = true;
      for (let y = hy; y <= fy; y++) {
        const i = y * MAP_W + hx;
        if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) { ok = false; break; }
      }
      if (ok) return { hx, hy, fy, ind: i0 };
    }
  }
  return null;
}

/** Boot on the new loop with ONE connected Depot (any owner seat), the way
 *  the iso-game full-round tests connect theirs. */
async function bootLoop(who: "you" | "ai" = "you") {
  const h = await boot({ newLoop: true });
  const c = findSouthCorridor(h.grid);
  expect(c).toBeTruthy();
  const { hx, hy, fy } = c!;
  const ownerId = who === "you" ? 1 : 2;
  h.eco.factories.push({ owner: who, ownerId, tx: hx, ty: fy });
  h.eco.harvesters.push({ id: who === "you" ? 1 : 2, owner: who, ownerId, tx: hx, ty: hy });
  for (let y = hy + 1; y <= fy; y++) buildTile(h.track, "dirt", hx, y, ownerId);
  h.finishSetup();
  h.refreshQuarry();
  return { h, c: c! };
}

/** The exact purse delta of `ticks` clock payouts for one Depot — the floor
 *  of the fractional sum, because `clockIncome` carries per-depot remainders. */
function expectedPay(h: GameHook, harv: Harvester, ticks: number): Partial<Record<Cargo, number>> {
  const base: Partial<Record<Cargo, number>> = {};
  for (const i0 of industriesInCatchment(h.grid, harv)) {
    const def = INDUSTRY_BY_KEY[i0.type];
    if (!def) continue;
    base[def.cargo] = (base[def.cargo] ?? 0) + (i0.output ?? def.output);
  }
  const out: Partial<Record<Cargo, number>> = {};
  for (const [c, v] of Object.entries(base) as [Cargo, number][]) out[c] = Math.floor(ticks * v);
  return out;
}

describe("L1 the game ticks income on the clock (newLoop)", () => {
  it("boots the new loop from the flag", async () => {
    const h = await boot({ newLoop: true });
    expect(h.newLoop).toBe(true);
    dispose?.();
    dispose = undefined;
    const plain = await boot();
    expect(plain.newLoop).toBe(false);
  });

  it("with a connected Depot and no match played, resources tick in at the base rate", async () => {
    const { h } = await bootLoop();
    const harv = h.eco.harvesters[0]!;
    const before = { ...h.purse };
    // 4 ticks, 3 s apart, on the injected clock — no board touch anywhere.
    let t = 1_000_000;
    for (let i = 0; i < 4; i++) { t += HARVEST_MS; h.econTick(t); }
    const pay = expectedPay(h, harv, 4);
    for (const cargo of CARGOES) {
      const want = pay[cargo] ?? 0;
      expect(h.purse[cargo] ?? 0, `${cargo} after 4 clock ticks`)
        .toBe((before[cargo] ?? 0) + want);
    }
    // something actually arrived: the Depot reaches ≥1 industry by construction
    expect(Object.values(pay).some((v) => (v ?? 0) > 0)).toBe(true);
  });

  it("the per-depot fractional carry pays sub-1 rates over time", async () => {
    const { h, c } = await bootLoop();
    // force the depot's only industry to 0.4/tick (the Oil Rig's rate): two
    // ticks pay 0, five pay 2 — rounding every tick would pay 0 forever.
    c.ind.output = 0.4;
    const cargo = INDUSTRY_BY_KEY[c.ind.type]!.cargo;
    let t = 1_000_000;
    const first = h.purse[cargo] ?? 0;
    for (let i = 0; i < 2; i++) { t += HARVEST_MS; h.econTick(t); }
    expect(h.purse[cargo] ?? 0).toBe(first);           // 2 × 0.4 floors to 0
    for (let i = 0; i < 3; i++) { t += HARVEST_MS; h.econTick(t); }
    expect(h.purse[cargo] ?? 0).toBe(first + 2);       // 5 × 0.4 = 2
  });

  it("cutting the road stops the Depot's ticks; reconnecting resumes them", async () => {
    const { h, c } = await bootLoop();
    const { hx, hy } = c;
    let t = 1_000_000;
    t += HARVEST_MS; h.econTick(t);
    const afterFirst = { ...h.purse };

    demolishTile(h.track, "dirt", hx, hy + 3);         // cut the line mid-path
    h.refreshQuarry();
    const paidWhileCut = (() => {
      const acc = { ...h.purse };
      for (let i = 0; i < 4; i++) { t += HARVEST_MS; h.econTick(t); }
      return acc;
    })();
    for (const cargo of CARGOES) expect(paidWhileCut[cargo] ?? 0).toBe(afterFirst[cargo] ?? 0);

    buildTile(h.track, "dirt", hx, hy + 3, 1);         // rebuild the cut tile
    h.refreshQuarry();
    t += HARVEST_MS; h.econTick(t);
    const harv = h.eco.harvesters[0]!;
    const pay = expectedPay(h, harv, 1);
    const any = (Object.entries(pay) as [Cargo, number][]).filter(([, v]) => v > 0)[0];
    expect(any, "a rebuilt line pays again").toBeTruthy();
    expect(h.purse[any[0]] ?? 0).toBe((afterFirst[any[0]] ?? 0) + any[1]);
  });

  it("no cargo is credited by a gem match anymore", async () => {
    const { h } = await bootLoop();
    // the board is ALIVE — the network still stamps its tokens (the gate and
    // the readout stay; only the PURSE line is cut) — and a real match pays
    // nothing: the board's harvest hook answers 0 before the gate, so gems
    // clear, no `+N` accumulates, and the purse does not move.
    const spy = vi.fn();
    const q = createQuarry(h.eco, "you", { payCargo: false, onHarvest: spy, onGains: spy, onPopup: spy });
    expect(q.board.onHarvest("wheat", 2, false)).toBe(0);
    expect(spy).not.toHaveBeenCalled();

    const reached = Object.keys(h.quarry.reach) as Cargo[];
    expect(reached.length).toBeGreaterThan(0);
    const tokens = h.board.gems().filter((g) => g.tier > 0);
    expect(tokens.length).toBeGreaterThan(0);
    const tok = tokens.find((g) => reached.includes(GEM_TO_CARGO[g.res]))!;
    expect(tok).toBeTruthy();
    const before = { ...h.purse };
    makeRun(h.board, tok!.res, freeRow(h.board, tok), 4, tok);
    expect(h.board.findGroups().length).toBeGreaterThan(0);
    await h.board.settle();                             // the swap's payout pass
    for (const c2 of CARGOES) {
      // Gold keeps paying from board combos under L1 — the ticket leaves the
      // board's coin economy out of scope; a cascade's chain bonus may land,
      // so the purse line skips it deliberately.
      if (c2 === "gold") continue;
      expect(h.purse[c2] ?? 0, `${c2} paid by a match`).toBe(before[c2] ?? 0);
    }
  });

  /** Boot on `newLoop` with a network the REAL placement path touched, so
   *  `trucksDirty` is set and `truckTick` can plan the lorry the frame loop
   *  would have (headless harnesses have no animation clock of their own). */
  async function bootLoopWithLorry() {
    const { h, c } = await bootLoop();
    h.demolish(c.hx, c.hy + 3);                           // the network moved…
    buildTile(h.track, "dirt", c.hx, c.hy + 3, 1);        // …and moved back
    h.truckTick(1_000_000);                               // frame twin: replan + drive
    h.refreshQuarry();
    return { h, c };
  }

  it("a lorry arrival creates no board token — and the trucks still run", async () => {
    const { h } = await bootLoopWithLorry();
    expect(h.trucks.length).toBeGreaterThan(0);         // the animation survives
    const deliver = vi.spyOn(h.quarry, "deliver");
    h.trucks[0]!.deliveries += 1;                       // hand it an arrival, no clock wait
    h.deliveryTick(2_000_000);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("a lorry arrival STILL mints its token under the old loop (control)", async () => {
    // newLoop OFF: identical flow, and the arrival DOES reach the quarry.
    const h = await boot();
    const c = findSouthCorridor(h.grid);
    expect(c).toBeTruthy();
    const { hx, hy, fy } = c!;
    h.eco.factories.push({ owner: "you", ownerId: 1, tx: hx, ty: fy });
    h.eco.harvesters.push({ id: 1, owner: "you", ownerId: 1, tx: hx, ty: hy });
    for (let y = hy + 1; y <= fy; y++) buildTile(h.track, "dirt", hx, y, 1);
    h.finishSetup();
    h.demolish(hx, hy + 3);
    buildTile(h.track, "dirt", hx, hy + 3, 1);
    h.truckTick(1_000_000);
    h.refreshQuarry();
    expect(h.trucks.length).toBeGreaterThan(0);
    const deliver = vi.spyOn(h.quarry, "deliver");
    h.trucks[0]!.deliveries += 1;
    h.deliveryTick(2_000_000);
    expect(deliver).toHaveBeenCalled();
    // the clock pays NOTHING here: `newLoop` off, an empty econTick changes
    // the purse by zero.
    const before = { ...h.purse };
    let t = 3_000_000;
    for (let i = 0; i < 4; i++) { t += HARVEST_MS; h.econTick(t); }
    for (const cargo of CARGOES) expect(h.purse[cargo] ?? 0).toBe(before[cargo] ?? 0);
  });

  it("the rival earns on the same clock — and only on the clock", async () => {
    const { h } = await bootLoop("ai");
    const harv = h.eco.harvesters.find((x) => x.owner === "ai")!;
    const pay = expectedPay(h, harv, 4);
    const rival = () => h.players.find((p) => p.id === "ai")!.purse;
    const before = { ...rival() };
    const playersBefore = { ...h.purse };
    let t = 1_000_000;
    for (let i = 0; i < 4; i++) { t += HARVEST_MS; h.econTick(t); }
    for (const cargo of CARGOES) {
      expect(rival()[cargo] ?? 0, `rival ${cargo}`)
        .toBe((before[cargo] ?? 0) + (pay[cargo] ?? 0));
    }
    // your seat has nothing connected: the clock must not have paid it either
    const mine = playersBefore;
    for (const cargo of CARGOES) expect(h.purse[cargo] ?? 0).toBe(mine[cargo] ?? 0);
  });

  it("the Market and Bank tabs (with the Black Market) are hidden on the new loop", async () => {
    await boot({ newLoop: true });
    expect(root.querySelector('[data-tab="market"]')).toBeNull();
    expect(root.querySelector('[data-tab="bank"]')).toBeNull();
    expect(root.querySelectorAll("#iso-trade [data-tab]")).toHaveLength(2); // Plant + Feed
    expect(root.textContent).not.toContain("Black Market");
    // control: the old loop keeps all four tabs — after tearing the new-loop
    // game down so its chrome cannot leak into the query
    dispose?.();
    dispose = undefined;
    root.innerHTML = "";
    await boot();
    expect(root.querySelector('[data-tab="market"]')).toBeTruthy();
    expect(root.querySelector('[data-tab="bank"]')).toBeTruthy();
    expect(root.textContent).toContain("Black Market");
  });

  it("saved games restore depot yields", async () => {
    const { h } = await bootLoop();
    h.eco.harvesters[0]!.yieldLevel = 2;
    h.saveNow();
    const raw = localStorage.getItem(SAVE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).eco.harvesters[0].yieldLevel).toBe(2);
    // reload the page: the fresh boot resumes the save — same seed, same
    // network, and the yield level comes back off the disk.
    dispose?.();
    dispose = undefined;
    const h2 = await boot({ newLoop: true });
    expect(h2.harvesters[0]).toMatchObject({ yieldLevel: 2 });
    expect(depotYield(h2.harvesters[0]!)).toBe(2);
  });

  it("a multiplayer boot refuses the flag and keeps the current loop", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = await boot({ role: "host", newLoop: true });
    expect(h.newLoop).toBe(false);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("solo sandbox preview"))).toBe(true);
    // the trade chrome came back — the refusal is not a half-measure
    expect(root.querySelector('[data-tab="market"]')).toBeTruthy();
  });
});
