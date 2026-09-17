// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// L1d (#235) — the rival earns on the clock.
//
// The acceptance block this file pins, in the order the ticket writes it:
//
//   • `?loop=new`: the rival's purse rises FROM ITS CONNECTED DEPOTS, through
//     the very `economyTick` pass that pays the player — same seams
//     (`BASE_RATE × depotYield × distanceFactor × transportFactor`), same
//     per-depot fractional carry — and it KEEPS EXPANDING on that income
//     alone (no board payout, no lorry payout, no gifts);
//   • the rival's board and its lorries no longer pay cargo (#234's mirror for
//     the "ai" seat): a match on its plant clears gems and credits nothing, an
//     arrival mints no token and floats no "+N" — while the plant itself stays
//     ALIVE, because it is the board you can watch, the body sabotage lands on
//     and the source of its combo Gold (#227), so its token clock keeps
//     feeding it even though its lorries no longer reserve the cargo;
//   • flag off: the rival behaves exactly as it shipped — its plant's matches
//     and its lorry arrivals still pay its purse, and the clock pays nobody.
//
// Boots the REAL game module in jsdom (canvas stubbed, no pixels asserted), the
// way `iso-game.test.ts` and `iso-l4-tuning.test.ts` do.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WATER, factoryTouchesTown, type Grid, type Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H, CARGOES, BASE_RATE, DIFFICULTY_RULES, type Cargo } from "../../src/iso/config";
import { GEM_TO_CARGO } from "../../src/iso/quarry";
import { buildTile, demolishTile, type Track } from "../../src/iso/track";
import { depotYield, distanceFactor, transportFactor } from "../../src/iso/loop";
import { rivalTuningYield } from "../../src/iso/tuning";
import { setRng, mulberry32, type ResKey } from "../../src/game/config";
import { AI_BUILD_MS, HARVEST_MS } from "../../src/iso/game";
import type { Harvester, EconomyState } from "../../src/iso/economy";
import type { Board, Gem } from "../../src/game/board";
import type { RivalPlant } from "../../src/iso/rival-plant";

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

/** The slice of `window.__iso` this file drives. */
interface RivalClockHook {
  readonly newLoop: boolean;
  phase: string;
  grid: Grid;
  track: Track;
  eco: EconomyState;
  /** The local seat's purse (live object). */
  purse: Record<string, number>;
  /**
   * L11 (#226): each seat's LIVE purse, in `players` order. The offer board
   * used to expose the rival's by reference (`market.players[1].res`).
   */
  purses: Record<string, number>[];
  /** AI-03: the rival's plant — the board its autoplay plays and sabotage hits. */
  rivalPlant: RivalPlant;
  /** What the rival's network reaches, per cargo (its own token gate). */
  readonly rivalReach: Partial<Record<Cargo, number>>;
  readonly trucksList: { depotId: number; ownerId: number; deliveries: number }[];
  finishSetup: () => void;
  /** The L1b/L1d clock, with an injectable now (writes both purses). */
  econTick: (now?: number) => void;
  /** The rival's build turn. */
  aiTick: (now?: number) => void;
  /** The per-frame board clock (drives the rival's plant + autoplay). */
  tick: (now?: number) => void;
  /** The lorry integrator: plans on a dirty world, moves, then collects arrivals. */
  truckTick: (now?: number, dtMs?: number) => void;
  refreshQuarry: (now?: number) => unknown;
  /** The twin of a build's aftermath: rescore, dirty the lorries, re-read
   *  BOTH seats' reach (`rescoreNow` in game.ts). */
  rescore: () => void;
  demolish: (tx: number, ty: number) => void;
  /** The live placement click, so the long-run test opens through the real rule. */
  placeFactory: (tx: number, ty: number) => boolean;
  setRivalSkill: (key: "easy" | "normal" | "hard") => void;
  readonly rivalSkill: { key: "easy" | "normal" | "hard" };
  pavedTiles: (who: string) => number;
  vp: { you: number; ai: number };
}

const hook = () => (window as unknown as { __iso: RivalClockHook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

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

async function boot(opts: { newLoop?: boolean } = {}) {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, opts);
  await settle();
  return hook();
}

// ── the map fixtures (the shapes `iso-game.test.ts` uses) ─────────────────
interface Corridor { hx: number; hy: number; fy: number; ind: Industry }

/** An industry with `len` tiles of open ground south of it: a Depot site at
 *  (hx,hy) and a Factory site at (hx,fy) joined by a straight run. `type`
 *  picks the industry, which is how a fixture chooses the cargo (and the
 *  output rate) the depot will hold. */
function findSouthCorridor(grid: Grid, len = 6, type?: string): Corridor | null {
  for (const ind of grid.industries) {
    if (type && ind.type !== type) continue;
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
 * The RIVAL's version of that corridor: its Factory at the far end, its Depot
 * beside the industry, and its own gravel between them (owner id 2 — a seat may
 * only ride its own track, W2). Pushed straight onto the records, the way the
 * player-side fixtures do, so the scenario costs no A* and no purse.
 */
function rivalCorridor(h: RivalClockHook, len = 6, type?: string): Corridor {
  const c = findSouthCorridor(h.grid, len, type);
  expect(c, `seed 1337 has a south corridor${type ? ` off a ${type}` : ""}`).toBeTruthy();
  h.eco.factories.push({ owner: "ai", ownerId: 2, tx: c!.hx, ty: c!.fy, id: 0, townId: null });
  h.eco.harvesters.push({ id: 900, owner: "ai", ownerId: 2, tx: c!.hx, ty: c!.hy });
  for (let y = c!.hy + 1; y <= c!.fy; y++) buildTile(h.track, "dirt", c!.hx, y, 2);
  // The game rescores on every build and demolish — that is what re-reads BOTH
  // seats' reach and marks the lorries dirty for planning. A fixture that
  // pushes the records by hand has to say so itself.
  h.rescore();
  return c!;
}

const rivalDepot = (h: RivalClockHook): Harvester =>
  h.eco.harvesters.find((d) => d.owner === "ai")!;

/** The rival's live purse — the record the game's own economy spends from. */
const rivalPurse = (h: RivalClockHook): Record<string, number> => h.purses[1];

/** Every cargo but Gold: what a depot clock or a cargo match can move. */
const cargoTotal = (p: Record<string, number>): number =>
  CARGOES.filter((c) => c !== "gold").reduce((n, c) => n + (p[c] ?? 0), 0);

/** Per-tick cargo the rival's connected depots deliver, read off the game's own
 *  network calculator — the sum the clock multiplies by the depot's yield. */
const rivalReachTotal = (h: RivalClockHook): number =>
  Object.values(h.rivalReach).reduce((a, b) => a + (b ?? 0), 0);

const tokenedGems = (board: Board): Gem[] => board.gems().filter((g) => g.tier > 0);

/** A row holding no token other than `except`, so a run there pays a known count. */
function freeRow(board: Board, except?: Gem): number {
  for (let r = 0; r < board.h; r++) {
    const tokens = board.grid[r].filter((g) => g && g.tier > 0 && g !== except);
    if (!tokens.length) return r;
  }
  throw new Error("no token-free row");
}

const ALT = (res: ResKey): ResKey => (res === "wood" ? "brick" : "wood");

/** Move `token` into (r,c) — the way `iso-game.test.ts`'s `moveGem` does — and
 *  force a horizontal three of `res` around it, bounded by another colour so
 *  the match is exactly three long and pays a known amount. */
function makeRun(board: Board, res: ResKey, r: number, c: number, token?: Gem) {
  if (token && (token.r !== r || token.c !== c)) {
    const other = board.grid[r][c]!;
    board.grid[token.r][token.c] = other;
    board.grid[r][c] = token;
    other.r = token.r; other.c = token.c;
    token.r = r; token.c = c;
  }
  for (const cc of [c - 1, c, c + 1]) board.grid[r][cc]!.res = res;
  board.grid[r][c - 2]!.res = ALT(res);
  board.grid[r][c + 2]!.res = ALT(res);
}

/**
 * Quiet the rival's autoplay for one test. The plant is a real board on a real
 * clock, and these fixtures assert what the CLOCK and the LORRIES pay — so the
 * rival must not spend a token (or bank a combo) behind the assertion's back.
 * `trySwap` is the only way the autoplay moves a gem.
 */
const stillPlant = (h: RivalClockHook) => vi.spyOn(h.rivalPlant.board, "trySwap").mockResolvedValue(true as never);

/**
 * Cut the rival's line mid-corridor and put it back, the way a real demolish +
 * rebuild does — through `demolishTile`, because the demolish TOOL only ever
 * tears up the local seat's own track (W2). Each half rescores, which is what
 * marks the lorries dirty for the next `truckTick` to plan (headless harnesses
 * have no rAF).
 */
function cutRivalLine(h: RivalClockHook, c: Corridor) {
  demolishTile(h.track, "dirt", c.hx, c.hy + 2);
  h.rescore();
}

function mendRivalLine(h: RivalClockHook, c: Corridor) {
  buildTile(h.track, "dirt", c.hx, c.hy + 2, 2);
  h.rescore();
}

// ══════════════════════════════════════════════════════════════════════════
describe("L1d (#235) the rival's connected depots pay it on the clock", () => {
  it("credits the rival's purse every tick, through the player's own seams", async () => {
    const h = await boot({ newLoop: true });
    expect(h.newLoop).toBe(true);
    rivalCorridor(h);
    h.finishSetup();                       // the clock only runs in `play`

    const depot = rivalDepot(h);
    const reach = rivalReachTotal(h);
    expect(reach, "the rival's depot is connected and delivering").toBeGreaterThan(0);

    // Hand it a level, the way a tuning session would: `applyRivalTuning` never
    // re-rolls a depot that already has one, so this is what the clock reads.
    depot.yield = 2;
    const perTick = reach * BASE_RATE * depotYield(depot) * distanceFactor(h.eco, depot) * transportFactor(depot);

    // The player's seat must not move either: the rival's depot pays the rival.
    const meBefore = cargoTotal(h.purse);
    const before = cargoTotal(rivalPurse(h));
    let now = performance.now();
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);

    const paid = cargoTotal(rivalPurse(h)) - before;
    expect(paid, "three connected ticks pay the rival").toBe(Math.floor(3 * perTick));
    expect(paid).toBeGreaterThan(0);
    expect(cargoTotal(h.purse) - meBefore, "the rival's depot paid MY purse").toBe(0);

    // And the level really is the lever: the same three ticks at the baseline
    // yield pay strictly less than at ×2.
    depot.yield = 1;
    const atBaseline = cargoTotal(rivalPurse(h));
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);
    expect(cargoTotal(rivalPurse(h)) - atBaseline).toBeLessThan(paid);
  });

  it("carries the fraction, so a sub-1 rate still pays over time", async () => {
    const h = await boot({ newLoop: true });
    // An Oil Rig prints 0.4 a tick at the baseline yield — the PP-07 case the
    // per-depot carry exists for (a depot level can never go below 1, so the
    // sub-unit rate has to come from the industry itself).
    rivalCorridor(h, 6, "oil_rig");
    h.finishSetup();
    const depot = rivalDepot(h);
    // Pin the level BEFORE the clock runs: `applyRivalTuning` only fills in an
    // ABSENT one, so a depot this test has priced stays priced.
    depot.yield = 1;
    const perTick = rivalReachTotal(h) * BASE_RATE * depotYield(depot);
    expect(perTick, "the Oil Rig is connected").toBeGreaterThan(0);
    expect(perTick, "the fixture really is a sub-unit rate").toBeLessThan(1);

    const before = cargoTotal(rivalPurse(h));
    let now = performance.now();
    h.econTick(now += 10_000);
    expect(cargoTotal(rivalPurse(h)) - before).toBe(Math.floor(perTick));
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);
    expect(cargoTotal(rivalPurse(h)) - before, "the carry landed the saved fraction")
      .toBe(Math.floor(3 * perTick));
  });

  it("takes a depot the rival never tuned and gives it a simulated level", async () => {
    const h = await boot({ newLoop: true });
    h.setRivalSkill("hard");
    rivalCorridor(h);
    h.finishSetup();
    const depot = rivalDepot(h);
    expect(depot.yield, "no level yet — the clock assigns one").toBeUndefined();

    const before = cargoTotal(rivalPurse(h));
    h.econTick(performance.now() + 10_000);
    // L10 (#225): the level is the simulated session DOCKED by the obstacles
    // the difficulty puts on a board — the rival plays no session, so frost
    // and girders come off its score instead of off a grid. (The corridor
    // below is dirt, so this Depot is still on tier 0: the thinned table.)
    expect(depot.yield).toBe(rivalTuningYield("hard", 0, DIFFICULTY_RULES.hard, 0));
    expect(depot.yield!).toBeLessThan(rivalTuningYield("hard"));
    expect(cargoTotal(rivalPurse(h))).toBeGreaterThan(before);
  });

  it("stops paying when its road is cut, and resumes when it is back", async () => {
    const h = await boot({ newLoop: true });
    const c = rivalCorridor(h);
    h.finishSetup();
    const depot = rivalDepot(h);
    depot.yield = 2;

    // Cut the line: the depot is no longer serviced, so the gate pays nothing.
    cutRivalLine(h, c);
    expect(rivalReachTotal(h), "the rival's depot is disconnected").toBe(0);

    const before = cargoTotal(rivalPurse(h));
    let now = performance.now();
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);
    expect(cargoTotal(rivalPurse(h)) - before, "a disconnected depot pays nothing").toBe(0);

    // Rebuild the very same tile and the income resumes — same depot, same
    // level, and the carry it had saved is still there.
    mendRivalLine(h, c);
    expect(rivalReachTotal(h)).toBeGreaterThan(0);
    h.econTick(now += 10_000);
    expect(cargoTotal(rivalPurse(h))).toBeGreaterThan(before);
    expect(depot.yield).toBe(2);
  });

  it("keeps expanding on the clock alone — no board payout, no lorry payout", async () => {
    // The AI-02 anti-stall fixture, on the new loop: the rival opens through
    // the game's own placement rule and then lives on its own clocks for four
    // simulated minutes. Its board pays nothing (#234's mirror) and its
    // lorries are animation, so every unit it spent came off the clock.
    const h = await boot({ newLoop: true });
    expect(h.newLoop).toBe(true);
    let spot: [number, number] | null = null;
    for (let y = 2; y < MAP_H - 3 && !spot; y++) {
      for (let x = 2; x < MAP_W - 3 && !spot; x++) {
        if (h.grid.terrain[y * MAP_W + x] !== WATER && factoryTouchesTown(h.grid, x, y)) spot = [x, y];
      }
    }
    expect(spot, "a town-touching factory site exists").toBeTruthy();
    expect(h.placeFactory(spot![0], spot![1])).toBe(true);   // seeds the rival's own spot
    h.finishSetup();

    const purse = rivalPurse(h);
    const startCargo = cargoTotal(purse);
    const rivalTiles = () => [...h.track.owner].filter((o) => o === 2).length;
    const depots = () => h.eco.harvesters.filter((d) => d.owner === "ai").length;

    // Ahead of the game's own pacing clocks, which `finishSetup` seeds from
    // the real `performance.now()` — see the note on `t0` below.
    let t = performance.now() + 1_000_000;
    // L3 (#217): the cumulative clock income — sampled around `econTick`
    // alone, which only ever PAYS (this seat's spending happens in aiTick and
    // tick), so any rise between the two samples IS clock income, exactly
    // attributed. The old signal (the purse's NET peak clearing its start)
    // does not survive the distance factor: the AI's routes run long enough
    // to tick at the far band's half rate, and its spending keeps pace with
    // that inside four minutes — while the seat still earns and expands.
    let clockEarned = 0;
    for (let step = 1; step <= 240; step++) {           // four simulated minutes
      t += 1000;
      const pre = cargoTotal(purse);
      h.econTick(t);
      const post = cargoTotal(purse);
      if (post > pre) clockEarned += post - pre;
      h.aiTick(t); h.tick(t); h.truckTick(t);
      // The board's async resolution needs the event loop; a yield every
      // twenty steps is plenty (and keeps the fixture off the wall clock).
      if (step % 20 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    // It EARNS on the clock — income arrived, even though the seat also spends.
    expect(clockEarned, "the rival earned nothing off the clock").toBeGreaterThan(0);
    // …and it spends it: a depot went up and its network grew. The signature
    // this guards is AI-02's stall — one factory, one road, one depot, forever.
    expect(depots(), "the rival never laid a depot").toBeGreaterThanOrEqual(1);
    expect(rivalTiles(), "the rival laid no track of its own").toBeGreaterThan(0);
    // Every depot it raised carries a level, so the clock can pay it.
    for (const d of h.eco.harvesters.filter((x) => x.owner === "ai")) {
      expect(d.yield, `depot ${d.id} has no yield level`).toBeDefined();
    }
    // And the economy stays honest: no purse overdrawn by any of it.
    for (const c of CARGOES) expect(purse[c] ?? 0, `${c} went negative`).toBeGreaterThanOrEqual(0);
  }, 150_000);
});

// ══════════════════════════════════════════════════════════════════════════
describe("L1d (#235) the rival's board and lorries stop paying cargo", () => {
  it("a match on the rival's plant clears the token and credits no cargo", async () => {
    const h = await boot({ newLoop: true });
    rivalCorridor(h);
    h.finishSetup();
    const board = h.rivalPlant.board;

    // Its network tokened the cargo it reaches — the gate is alive, so there is
    // a real depot-fed token to match (the payout that must NOT happen).
    const token = tokenedGems(board)[0];
    expect(token, "the rival's plant holds a token to match").toBeTruthy();
    const cargo = GEM_TO_CARGO[token!.res];
    expect(Object.keys(h.rivalReach), "the rival reaches that cargo").toContain(cargo);

    makeRun(board, token!.res, freeRow(board, token!), 4, token!);
    expect(board.findGroups().length).toBeGreaterThan(0);
    const before = { ...rivalPurse(h) };
    await board.settle();                    // what trySwap runs after a swap

    // The match really happened — the token is gone from the grid…
    expect(board.gems().includes(token!)).toBe(false);
    // …and it paid the rival no cargo (Gold is left out on purpose: combo coins
    // are #227's business, and this ticket cuts cargo only).
    for (const c of CARGOES) {
      if (c === "gold") continue;
      expect(rivalPurse(h)[c] ?? 0, `${c} paid by the rival's match`).toBe(before[c] ?? 0);
    }
  });

  it("a lorry arrival mints no token, credits nothing and floats no +N — and still drives", async () => {
    const h = await boot({ newLoop: true });
    const c = rivalCorridor(h, 3);           // a short route: arrivals land fast
    h.finishSetup();
    stillPlant(h);                           // the autoplay must not spend a token
    const board = h.rivalPlant.board;

    cutRivalLine(h, c); mendRivalLine(h, c);   // a rescore pair: the lorries replan
    h.truckTick(performance.now(), 1000);    // plan the run + one second
    const rivalTrucks = () => h.trucksList.filter((x) => x.ownerId === 2);
    expect(rivalTrucks().length, "the rival has a lorry on its own road").toBeGreaterThan(0);

    // Whatever the connection's first refresh tokened is the baseline: from here
    // on, only an ARRIVAL could add to it.
    const spawn = vi.spyOn(board, "spawnTokens");
    spawn.mockClear();
    const beforeTokens = tokenedGems(board).length;
    const before = { ...rivalPurse(h) };
    const loads = () => rivalTrucks().reduce((n, x) => n + x.deliveries, 0);
    const beforeLoads = loads();

    let now = performance.now();
    for (let i = 0; i < 150; i++) { now += 1000; h.truckTick(now, 1000); }

    // The lorries are ANIMATION: they drove out, arrived and turned around…
    expect(loads(), "the rival's lorry never arrived").toBeGreaterThan(beforeLoads);
    // …and not one arrival touched its plant or its purse.
    expect(spawn).not.toHaveBeenCalled();
    expect(tokenedGems(board).length, "an arrival minted a token").toBe(beforeTokens);
    for (const cargo of CARGOES) {
      expect(rivalPurse(h)[cargo] ?? 0, `${cargo} paid by a lorry`).toBe(before[cargo] ?? 0);
    }
    expect([...root.querySelectorAll(".iso-float.delivery")].length, "a +N floated for nothing").toBe(0);
  });

  it("keeps the plant alive: the token clock feeds it although the lorry reserves nothing", async () => {
    // The autoplay stays because the plant is still a THING: the peek panel
    // shows it, sabotage lands on it, and its combo Gold still banks (#227). A
    // board with no tokens could do none of that — and under the shipped loop
    // the lorry RESERVED this cargo, so the spawn clock kept its hands off.
    // With arrivals paying nobody (#234/#235) that reservation has to go, or
    // the plant the player watches goes dark.
    const h = await boot({ newLoop: true });
    const c = rivalCorridor(h, 3);
    h.finishSetup();
    stillPlant(h);
    const board = h.rivalPlant.board;
    const served = Object.keys(h.rivalReach) as Cargo[];
    expect(served.length, "the rival's depot delivers a cargo").toBeGreaterThan(0);

    cutRivalLine(h, c); mendRivalLine(h, c);
    h.truckTick(performance.now(), 1000);
    expect(h.trucksList.filter((x) => x.ownerId === 2).length, "a lorry runs that cargo")
      .toBeGreaterThan(0);

    const spawn = vi.spyOn(board, "spawnTokens");
    spawn.mockClear();
    // Past the 20 s spawn cadence (`UPGRADE_EVERY`), board clock only — no
    // lorry time, so the only thing that can token the plant is its own clock.
    let now = performance.now();
    for (let i = 0; i < 30; i++) { now += 1000; h.tick(now); }
    expect(spawn).toHaveBeenCalled();
    expect(tokenedGems(board).length, "the rival's plant went dark").toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L1d (#235) flag off: the rival plays the shipped economy", () => {
  it("its plant's match still pays its purse, and the clock pays nobody", async () => {
    const h = await boot();
    expect(h.newLoop).toBe(false);
    rivalCorridor(h);
    h.finishSetup();
    const board = h.rivalPlant.board;
    const token = tokenedGems(board)[0];
    expect(token, "the rival's plant holds a token to match").toBeTruthy();
    const cargo = GEM_TO_CARGO[token!.res];

    makeRun(board, token!.res, freeRow(board, token!), 4, token!);
    const before = { ...rivalPurse(h) };
    await board.settle();

    // AI-03's parity economy, unchanged: a depot-fed token pays the rival.
    expect((rivalPurse(h)[cargo] ?? 0) - (before[cargo] ?? 0), "the rival's match paid nothing")
      .toBeGreaterThan(0);

    // …and the economy clock still pays NOTHING to either seat on the shipped
    // loop (AI-03 removed the rival's trickle; L1b's clock is flag-gated).
    const meBefore = cargoTotal(h.purse);
    const rivalBefore = cargoTotal(rivalPurse(h));
    let now = performance.now();
    for (let i = 0; i < 5; i++) h.econTick(now += 10_000);
    expect(cargoTotal(rivalPurse(h)) - rivalBefore, "the trickle came back").toBe(0);
    expect(cargoTotal(h.purse) - meBefore).toBe(0);
  });

  it("its lorry arrival still mints a token on its own plant", async () => {
    const h = await boot();
    const c = rivalCorridor(h, 3);
    h.finishSetup();
    stillPlant(h);
    const board = h.rivalPlant.board;

    cutRivalLine(h, c); mendRivalLine(h, c);
    h.truckTick(performance.now(), 1000);
    expect(h.trucksList.filter((x) => x.ownerId === 2).length).toBeGreaterThan(0);

    // AI-03c: its lorries mint tokens onto THAT board. Same drive as the
    // new-loop fixture above — no board clock at all, so the only thing that
    // can token the plant is an arrival.
    const spawn = vi.spyOn(board, "spawnTokens");
    spawn.mockClear();
    let now = performance.now();
    for (let i = 0; i < 150; i++) { now += 1000; h.truckTick(now, 1000); }
    expect(spawn, "the rival's lorry stopped delivering").toHaveBeenCalled();
    expect(tokenedGems(board).length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L1d (#235) the rival's build turn is untouched", () => {
  it("still raises a depot and a road on an empty purse, and tunes what it raises", async () => {
    // The ticket's "minimal AI changes only": the turn is the same turn, its
    // depots are just paid by the clock now. This is the W3/L2 fixture with the
    // flag on — free dirt, no board income, and a level on every depot.
    const h = await boot({ newLoop: true });
    const c = findSouthCorridor(h.grid)!;
    h.eco.factories.push({ owner: "you", ownerId: 1, tx: c.hx, ty: c.fy, id: 0, townId: null });
    h.eco.harvesters.push({ id: 100, owner: "you", ownerId: 1, tx: c.hx, ty: c.hy });
    for (let y = c.hy + 1; y <= c.fy; y++) buildTile(h.track, "dirt", c.hx, y, 1);
    h.finishSetup();

    // The rival opens beside a DIFFERENT industry, off the game's own spot rule
    // (PP-16: one holder per industry, so it must not share the player's).
    const { chooseRivalFactorySpot } = await import("../../src/iso/ai");
    const spot = chooseRivalFactorySpot(h.grid, h.track, [MAP_W >> 1, MAP_H >> 1], {
      purse: { wood: 4, stone: 12, grain: 4, ore: 8, oil: 4 }, free: 12, ownerId: 2,
      opponentHarvesters: h.eco.harvesters.filter((d) => d.owner === "you"),
      newLoop: true,
    });
    expect(spot, "the rival has an opening spot").toBeTruthy();
    h.eco.factories.push({ owner: "ai", ownerId: 2, tx: spot![0], ty: spot![1], id: 0, townId: null });

    const purse = rivalPurse(h);
    for (const k of Object.keys(purse)) purse[k] = 0;      // no gifts: free dirt only
    const rivalTiles = () => [...h.track.owner].filter((o) => o === 2).length;
    expect(rivalTiles()).toBe(0);

    // The simulated clock must start AHEAD of the game's own pacing clocks,
    // which `finishSetup` seeds from the real `performance.now()`. A fixed
    // 1_000_000 was ahead of it for a short run and BEHIND it once the worker
    // had been alive ~17 minutes (a long suite run), at which point no build
    // or income clock ever came round and the rival did nothing — a latent
    // flake that only showed up in a full `npm test`, never in isolation.
    const t0 = performance.now() + 1_000_000;
    for (let i = 0; i < 3; i++) {
      h.aiTick(t0 + i * AI_BUILD_MS);
      h.econTick(t0 + i * AI_BUILD_MS + HARVEST_MS);       // the clock pays between turns
    }

    expect(rivalTiles(), "the rival laid no track").toBeGreaterThan(0);
    const raised = h.eco.harvesters.filter((d) => d.owner === "ai");
    expect(raised.length, "the rival raised no depot").toBeGreaterThan(0);
    for (const d of raised) expect(d.yield, "its depot has no level").toBeDefined();
    for (const cargo of CARGOES) expect(purse[cargo] ?? 0, `${cargo} negative`).toBeGreaterThanOrEqual(0);
  }, 60_000);
});
