// @vitest-environment jsdom
//
// PP-05 — "Require Oil when building additional Depots".
//
// The ticket's acceptance criteria, each one asserted against the code that
// has to satisfy it:
//
//   • A player with sufficient other materials but insufficient Oil cannot
//     build a paid Depot.                     → `placeHarvester` in game.ts
//   • Failed placement consumes nothing.      → the check-before-spend order
//   • Successful placement deducts the complete cost exactly once.
//   • Oil obtained through Processing Plant matches is valid construction
//     stock.                                  → a real board match, then a buy
//   • The opening cannot become impossible because Oil production itself
//     requires a Depot.                       → the free-setup allowance
//   • Show the complete cost before placement.→ the Build button + modebar
//   • Apply the same cost to AI decisions.    → planCandidates/executeCandidate
//
// Like `iso-game.test.ts` this boots the REAL game module in a DOM and drives
// it through `window.__iso`; canvas is stubbed, so it verifies wiring and
// economy, not pixels.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WATER } from "../../src/iso/grid";
import { BOARD_H, MAP_W, MAP_H, type ResKey } from "../../src/game/config";
import { setRng, mulberry32 } from "../../src/game/config";
import { CARGOES, type Cargo } from "../../src/iso/config";
import {
  BUILD_COSTS, DEPOT_COST, FREE_SETUP_DEPOTS, costCompact, costLabel,
  depotButtonLabel, priceDepot, shortfallLabel,
} from "../../src/iso/construction";

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

interface IsoHook {
  phase: string;
  purse: Record<string, number>;
  freeDepots: number;
  harvesters: { id: number; owner: string; tx: number; ty: number }[];
  grid: import("../../src/iso/grid").Grid;
  track: import("../../src/iso/track").Track;
  eco: import("../../src/iso/economy").EconomyState;
  board: import("../../src/game/board").Board;
  reach: Record<string, number>;
  market: import("../../src/iso/market").IsoMarket;
  refreshQuarry: (now?: number) => unknown;
  setTool: (t: string) => void;
  aiTick: (now?: number) => void;
  finishSetup: () => void;
  /** PP-05: the real Depot placement, cost and all. */
  placeDepot: (tx: number, ty: number) => boolean;
  depotPrice: () => import("../../src/iso/construction").DepotPrice;
  toast: (text: string, kind?: string) => void;
}

const hook = () => (window as unknown as { __iso: IsoHook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas();
  stubImage();
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

// ── map helpers (same shape as iso-game.test.ts; the map is seed-pinned) ──
/** An industry whose SOUTH corridor is legal: Depot tile + `len` road tiles. */
function findSouthCorridor(
  grid: import("../../src/iso/grid").Grid, len = 6, type?: string,
): { hx: number; hy: number; fy: number; ind: import("../../src/iso/grid").Industry } | null {
  for (const ind of grid.industries) {
    if (type && ind.type !== type) continue;
    for (let x = ind.tx; x < ind.tx + ind.w; x++) {
      const hx = x, hy = ind.ty + ind.h, fy = hy + len;
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

/** A buildable tile no Depot could serve: nothing in its 4×4 catchment. */
async function findBarrenTile(grid: import("../../src/iso/grid").Grid): Promise<[number, number]> {
  const { industriesInCatchment } = await import("../../src/iso/economy");
  const { canBuildOn } = await import("../../src/iso/track");
  for (let y = 4; y < MAP_H - 4; y++) {
    for (let x = 4; x < MAP_W - 4; x++) {
      if (!canBuildOn(grid, "road", x, y)) continue;
      if (industriesInCatchment(grid, { id: -1, owner: "you", ownerId: 0, tx: x, ty: y }).length) continue;
      return [x, y];
    }
  }
  throw new Error("no barren tile on this map");
}

// ── board helpers: force a known match, the way iso-game.test.ts does ─────
const ALT = (res: ResKey) => (res === "wood" ? "ore" : "wood");

function moveGem(board: import("../../src/game/board").Board, a: import("../../src/game/board").Gem, r: number, c: number) {
  const other = board.grid[r][c]!;
  board.grid[a.r][a.c] = other; other.r = a.r; other.c = a.c;
  board.grid[r][c] = a; a.r = r; a.c = c;
}

function freeRow(board: import("../../src/game/board").Board, except?: import("../../src/game/board").Gem): number {
  for (let r = 0; r < BOARD_H; r++) {
    if (!board.grid[r].some((g) => g && g.tier > 0 && g !== except)) return r;
  }
  throw new Error("no token-free row");
}

function makeRun(
  board: import("../../src/game/board").Board, res: ResKey,
  r: number, c: number, token?: import("../../src/game/board").Gem,
) {
  if (token && (token.r !== r || token.c !== c)) moveGem(board, token, r, c);
  for (const cc of [c - 1, c, c + 1]) board.grid[r][cc]!.res = res;
  board.grid[r][c - 2]!.res = ALT(res);
  board.grid[r][c + 2]!.res = ALT(res);
}

// ══════════════════════════════════════════════════════════════════════════
// 1. the authoritative table and the pricing rule
// ══════════════════════════════════════════════════════════════════════════
describe("PP-05 the Depot cost is one authoritative rule", () => {
  it("requires Oil — that is the whole point of the ticket", () => {
    expect(DEPOT_COST.oil).toBeGreaterThan(0);
    expect(BUILD_COSTS.depot).toBe(DEPOT_COST);   // one table, one entry
  });

  it("prices a paid Depot at the full cost and names what is missing", () => {
    // every other cargo in abundance, and still no Oil
    const purse = Object.fromEntries(CARGOES.map((c) => [c, 99]));
    delete (purse as Record<string, number>).oil;
    const p = priceDepot(purse, 0);
    expect(p.cost).toEqual(DEPOT_COST);
    expect(p.free).toBe(false);
    expect(p.affordable).toBe(false);
    expect(p.missing).toEqual(["oil"]);
    expect(shortfallLabel(p.missing)).toMatch(/Oil/);
  });

  it("makes the first Depot free on the setup allowance — the opening stays solvable", () => {
    expect(FREE_SETUP_DEPOTS).toBeGreaterThan(0);
    const p = priceDepot({}, FREE_SETUP_DEPOTS);      // an EMPTY purse
    expect(p.free).toBe(true);
    expect(p.cost).toEqual({});
    expect(p.affordable).toBe(true);
    expect(p.freeLeft).toBe(0);
    // …and the second one is paid again
    const second = priceDepot({}, p.freeLeft);
    expect(second.free).toBe(false);
    expect(second.affordable).toBe(false);
  });

  it("accepts Oil in any amount that covers the cost, and never goes partial", () => {
    // PP-07: the Depot costs Wood/Stone/Grain beside the Oil, so "exact"
    // covers the whole ticket — and one Oil short of it is still refused.
    const exact = priceDepot({ ...DEPOT_COST }, 0);
    expect(exact.affordable).toBe(true);
    expect(exact.cost).toEqual(DEPOT_COST);
    const short = priceDepot({ ...DEPOT_COST, oil: DEPOT_COST.oil! - 1 }, 0);
    expect(short.affordable).toBe(false);
    expect(short.missing).toEqual(["oil"]);
  });

  it("renders the COMPLETE cost for the HUD before any placement", () => {
    // PP-07: 1 Wood + 1 Stone + 1 Grain + 1 Oil, in the fixed display order.
    expect(costLabel(DEPOT_COST)).toBe("1 🌾 Grain + 1 🪵 Wood + 1 🪨 Stone + 1 🛢️ Oil");
    expect(costCompact(DEPOT_COST)).toBe("1🌾 1🪵 1🪨 1🛢️");
    expect(depotButtonLabel(FREE_SETUP_DEPOTS)).toMatch(/free setup/);
    expect(depotButtonLabel(FREE_SETUP_DEPOTS)).toContain(costCompact(DEPOT_COST));
    expect(depotButtonLabel(0)).toContain(costCompact(DEPOT_COST));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. the player's placement (the host's authority in a multiplayer room)
// ══════════════════════════════════════════════════════════════════════════
describe("PP-05 placing a Depot in the live game", () => {
  it("builds the setup Depot for free and burns the allowance, not the purse", async () => {
    const h = await boot();
    const c = findSouthCorridor(h.grid, 6, "farm");
    expect(c).toBeTruthy();
    expect(h.freeDepots).toBe(FREE_SETUP_DEPOTS);

    const before = { ...h.purse };
    expect(h.placeDepot(c!.hx, c!.hy)).toBe(true);

    expect(h.harvesters).toHaveLength(1);
    expect(h.freeDepots).toBe(0);
    // nothing was charged — the allowance covered it
    for (const k of CARGOES) expect(h.purse[k] ?? 0, `${k} moved`).toBe(before[k] ?? 0);
    // …and the price the HUD shows flips to the paid cost at the same moment
    expect(h.depotPrice().free).toBe(false);
    expect(h.depotPrice().cost).toEqual(DEPOT_COST);
  });

  it("refuses a paid Depot when Oil is short, even with everything else in abundance", async () => {
    const h = await boot();
    const farm = findSouthCorridor(h.grid, 6, "farm")!;
    expect(h.placeDepot(farm.hx, farm.hy)).toBe(true);      // burns the allowance
    const second = findSouthCorridor(h.grid, 6, "quarry")!;
    expect(second.ind.id).not.toBe(farm.ind.id);

    // every material except Oil, well past what the Depot could ever need
    for (const c of CARGOES) if (c !== "oil") h.purse[c] = 99;
    h.purse.oil = 0;
    const before = { ...h.purse };
    const depots = h.harvesters.length;

    expect(h.placeDepot(second.hx, second.hy)).toBe(false);

    // failed placement consumes NOTHING, and builds nothing
    expect(h.harvesters).toHaveLength(depots);
    for (const c of CARGOES) expect(h.purse[c] ?? 0, `${c} consumed by a refusal`).toBe(before[c] ?? 0);
    expect((root.querySelector(".toasts") as HTMLElement).textContent).toMatch(/oil/i);
  });

  it("deducts the complete cost exactly once on a successful paid placement", async () => {
    const h = await boot();
    expect(h.placeDepot(findSouthCorridor(h.grid, 6, "farm")!.hx, findSouthCorridor(h.grid, 6, "farm")!.hy)).toBe(true);
    const second = findSouthCorridor(h.grid, 6, "quarry")!;

    for (const c of CARGOES) if (c !== "oil") h.purse[c] = 5;
    h.purse.oil = 3;
    const before = { ...h.purse };

    expect(h.placeDepot(second.hx, second.hy)).toBe(true);

    expect(h.harvesters).toHaveLength(2);
    for (const [cargo, amount] of Object.entries(DEPOT_COST) as [Cargo, number][]) {
      expect(h.purse[cargo], `${cargo} charged`).toBe((before[cargo] ?? 0) - amount);
    }
    for (const c of CARGOES) {
      if ((DEPOT_COST[c] ?? 0) > 0) continue;
      expect(h.purse[c] ?? 0, `${c} charged`).toBe(before[c] ?? 0);
      expect(h.purse[c] ?? 0, `${c} negative`).toBeGreaterThanOrEqual(0);
    }
  });

  it("charges nothing when the site itself is illegal, Oil or no Oil", async () => {
    const h = await boot();
    const farm = findSouthCorridor(h.grid, 6, "farm")!;
    expect(h.placeDepot(farm.hx, farm.hy)).toBe(true);       // allowance spent

    for (const c of CARGOES) h.purse[c] = 50;                // Oil included
    const before = { ...h.purse };

    // (a) the tile is already taken
    expect(h.placeDepot(farm.hx, farm.hy)).toBe(false);
    // (b) a buildable tile with no industry in its 4×4 catchment
    const [bx, by] = await findBarrenTile(h.grid);
    expect(h.placeDepot(bx, by)).toBe(false);

    expect(h.harvesters).toHaveLength(1);
    for (const c of CARGOES) expect(h.purse[c] ?? 0, `${c} consumed`).toBe(before[c] ?? 0);
  });

  it("spends Oil that the Processing Plant produced — same purse, no special case", async () => {
    const h = await boot();
    const { buildTile } = await import("../../src/iso/track");
    const { CARGO_TO_GEM } = await import("../../src/iso/quarry");

    // the setup Depot goes through the real placement, beside an Oil Rig
    const oil = findSouthCorridor(h.grid, 6, "oil_rig");
    expect(oil, "seed 1337 needs an oil-rig corridor").toBeTruthy();
    expect(h.placeDepot(oil!.hx, oil!.hy)).toBe(true);
    expect(h.freeDepots).toBe(0);

    // Factory below it + a road corridor, the way the pointer path builds it
    h.eco.factories.push({ owner: "you", ownerId: 1, tx: oil!.hx, ty: oil!.fy });
    for (let y = oil!.hy + 1; y <= oil!.fy; y++) buildTile(h.track, "road", oil!.hx, y, 1);
    h.refreshQuarry();
    expect(h.reach.oil, "the network must reach the Oil Rig").toBeGreaterThan(0);

    // match an Oil token: this is the ONLY source of the Oil below
    const gem = CARGO_TO_GEM.oil;
    const tok = h.board.gems().find((g) => g.res === gem && g.tier > 0);
    expect(tok, "an Oil token must spawn once the rig is reached").toBeTruthy();
    expect(h.purse.oil ?? 0).toBe(0);
    makeRun(h.board, gem, freeRow(h.board, tok), 4, tok);
    expect(h.board.findGroups().length).toBeGreaterThan(0);
    await h.board.settle();
    const oilEarned = h.purse.oil ?? 0;
    expect(oilEarned, "matching the Oil token must bank Oil").toBeGreaterThan(0);

    // …and that Oil builds the next Depot (PP-07: the Depot also costs
    // Wood/Stone/Grain — granted here, since the earned Oil is the part
    // under test; wood/stone ride the new starting stock).
    h.purse.grain = 5;
    const next = findSouthCorridor(h.grid, 6, "quarry")!;
    expect(h.depotPrice().affordable).toBe(true);
    expect(h.placeDepot(next.hx, next.hy)).toBe(true);
    expect(h.harvesters).toHaveLength(2);
    expect(h.purse.oil).toBe(oilEarned - (DEPOT_COST.oil ?? 0));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. showing the complete cost before placement
// ══════════════════════════════════════════════════════════════════════════
describe("PP-05 the cost is visible before the click", () => {
  const depotBtn = () =>
    [...root.querySelectorAll<HTMLElement>("[data-tool]")].find((b) => b.dataset.tool === "harvester")!;

  it("prices the Depot button from the table, allowance first", async () => {
    const h = await boot();
    // the setup allowance is live, so the button says so — and still names Oil
    expect(depotBtn().querySelector("small")!.textContent).toMatch(/free setup/);
    expect(depotBtn().querySelector("small")!.textContent).toContain("🛢️");
    expect(depotBtn().classList.contains("disabled")).toBe(false);

    expect(h.placeDepot(findSouthCorridor(h.grid, 6, "farm")!.hx, findSouthCorridor(h.grid, 6, "farm")!.hy)).toBe(true);
    h.purse.oil = 0;
    await settle();
    // …and once it is spent, the button shows the real price and greys out
    expect(depotBtn().querySelector("small")!.textContent).toContain(costCompact(DEPOT_COST));
    expect(depotBtn().classList.contains("disabled")).toBe(true);
    // PP-07: the full ticket (Oil + Grain; wood/stone ride the starting stock)
    h.purse.oil = 1;
    h.purse.grain = 1;
    await settle();
    expect(depotBtn().classList.contains("disabled")).toBe(false);
  });

  it("shows the Depot's cost in the modebar while the tool is armed", async () => {
    const h = await boot();
    h.setTool("harvester");
    await settle();
    const bar = root.querySelector(".modebar") as HTMLElement;
    expect(bar.textContent).toMatch(/Depot/);
    expect(bar.textContent).toMatch(/🛢️|free/i);
    expect(bar.textContent).toMatch(/catchment/);
  });

  it("reports the same price through the read-only tile probe", async () => {
    const h = await boot();
    expect(h.placeDepot(findSouthCorridor(h.grid, 6, "farm")!.hx, findSouthCorridor(h.grid, 6, "farm")!.hy)).toBe(true);
    h.finishSetup();
    h.setTool("harvester");
    await settle();
    // the probe the e2e corridor picker reads prices the Depot too
    const probe = (window as unknown as {
      __iso: { tileProbe: (k: string, tx: number, ty: number) => {
        harvester: { cost: Record<string, number>; free: boolean; affordable: boolean };
      } };
    }).__iso.tileProbe("road", 10, 12);
    expect(probe.harvester.free).toBe(false);
    expect(probe.harvester.cost).toEqual(DEPOT_COST);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. the AI pays the same price (one cost model, W3's rule)
// ══════════════════════════════════════════════════════════════════════════
describe("PP-05 the rival pays the same Depot cost", () => {
  const flat = async (industries: { type: string; tx: number; ty: number }[]) => {
    const { GRASS } = await import("../../src/iso/grid");
    const { INDUSTRY_BY_KEY } = await import("../../src/iso/config");
    const { tIdx } = await import("../../src/iso/track");
    const list = industries.map((d, i) => {
      const def = INDUSTRY_BY_KEY[d.type];
      return {
        id: i, type: d.type, tx: d.tx, ty: d.ty,
        w: def.footprint[0], h: def.footprint[1], output: def.output, banditUntil: 0,
      };
    });
    const occupancy = new Int16Array(MAP_W * MAP_H).fill(-1);
    list.forEach((ind, i) => {
      for (let y = ind.ty; y < ind.ty + ind.h; y++)
        for (let x = ind.tx; x < ind.tx + ind.w; x++) occupancy[tIdx(x, y)] = i;
    });
    const { createTrack } = await import("../../src/iso/track");
    const grid = {
      w: MAP_W, h: MAP_H, terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
      industries: list, towns: [], occupancy, seed: 7,
    } as import("../../src/iso/grid").Grid;
    return { grid, eco: { grid, track: createTrack(), harvesters: [], factories: [] } };
  };

  it("charges Oil in `spent` for a Depot it places, and nothing when the allowance covers it", async () => {
    const { planCandidates, executeCandidate } = await import("../../src/iso/ai");
    const { eco, grid } = await flat([{ type: "farm", tx: 12, ty: 5 }]);
    const F = { owner: "ai", ownerId: 2, tx: 5, ty: 5 };
    const purse = { wood: 9999, stone: 9999, grain: 9999, ore: 9999, oil: 9999 };
    const c = planCandidates(eco, F, { stock: {}, purse, free: 12, freeDepots: 1 })[0];
    expect(c).toBeTruthy();

    // opening Depot: the allowance covers it, so Oil is untouched
    const free = executeCandidate(eco, c, "ai", 2, 1, 12, FREE_SETUP_DEPOTS);
    expect(free.harvester).toBeTruthy();
    expect(free.freeDepots).toBe(1);
    expect(free.spent.oil).toBeUndefined();

    // the next one is paid
    const eco2 = { grid, track: (await import("../../src/iso/track")).createTrack(), harvesters: [], factories: [] };
    const c2 = planCandidates(eco2, F, { stock: {}, purse, free: 12, freeDepots: 0 })[0];
    const paid = executeCandidate(eco2, c2, "ai", 2, 2, 12, 0);
    expect(paid.harvester).toBeTruthy();
    expect(paid.freeDepots).toBe(0);
    expect(paid.spent.oil).toBe(DEPOT_COST.oil);
  });

  it("offers no plan at all when the purse cannot pay the Depot's Oil", async () => {
    const { planCandidates, aiBuildStep } = await import("../../src/iso/ai");
    const { eco } = await flat([{ type: "farm", tx: 12, ty: 5 }]);
    const F = { owner: "ai", ownerId: 2, tx: 5, ty: 5 };
    // plenty for the track, nothing for the Depot — Oil is the ONLY thing
    // missing, so the refusal names it (PP-07: wood/grain granted).
    const broke = { wood: 9999, stone: 9999, grain: 9999, ore: 9999, oil: 0 };
    expect(planCandidates(eco, F, { stock: {}, purse: broke, free: 12, freeDepots: 0 })).toEqual([]);
    expect(aiBuildStep(eco, F, { stock: {}, purse: broke, free: 12, freeDepots: 0 }, 1)).toBeNull();
    // …and the map proves it: no track, no Depot, nothing spent
    expect(eco.harvesters).toHaveLength(0);
    expect([...eco.track.owner].some((o) => o === 2)).toBe(false);
  });

  it("keeps the rival's opening solvable with no Oil anywhere", async () => {
    const { aiBuildStep, chooseRivalFactorySpot } = await import("../../src/iso/ai");
    const { generateMap } = await import("../../src/iso/grid");
    const { createTrack } = await import("../../src/iso/track");
    const grid = generateMap(1337);
    // START_PURSE has no Oil at all; the opening must still build a Depot
    const purse = { wood: 12, stone: 12, ore: 0 };
    const spot = chooseRivalFactorySpot(grid, createTrack(), [23, 22], {
      purse, free: 12, ownerId: 2, freeDepots: FREE_SETUP_DEPOTS,
    });
    expect(spot).toBeTruthy();
    const f = { owner: "ai", ownerId: 2, tx: spot![0], ty: spot![1] };
    const eco = { grid, track: createTrack(), harvesters: [], factories: [f] };
    const out = aiBuildStep(eco, f, { stock: purse, purse, free: 12, freeDepots: FREE_SETUP_DEPOTS }, 1);
    expect(out?.harvester, "the opening Depot must be free, or the game is unwinnable").toBeTruthy();
    expect(out?.freeDepots).toBe(1);
    expect(out?.spent.oil).toBeUndefined();
  }, 15_000);

  it("the live rival spends its allowance once and then needs Oil it has not earned", async () => {
    const h = await boot();
    const { buildTile } = await import("../../src/iso/track");
    // the player's setup, so the clocks run and the rival has room of its own
    const farm = findSouthCorridor(h.grid, 6, "farm")!;
    expect(h.placeDepot(farm.hx, farm.hy)).toBe(true);
    h.eco.factories.push({ owner: "you", ownerId: 1, tx: farm.hx, ty: farm.fy });
    for (let y = farm.hy + 1; y <= farm.fy; y++) buildTile(h.track, "road", farm.hx, y, 1);
    const quarry = findSouthCorridor(h.grid, 6, "quarry")!;
    h.eco.factories.push({ owner: "ai", ownerId: 2, tx: quarry.hx, ty: quarry.fy });
    h.finishSetup();

    const rival = h.market.players[1];
    expect(rival.res.oil ?? 0).toBe(0);
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) h.aiTick(t0 + i * 9000);

    const rivalDepots = h.harvesters.filter((x) => x.owner === "ai");
    // exactly one Depot: the free opening one. The other three turns are
    // refused because Oil costs Oil — not silently built for free.
    expect(rivalDepots).toHaveLength(1);
    expect(rival.res.oil ?? 0).toBe(0);
    expect([...h.track.owner].some((o) => o === 2)).toBe(true);
  }, 15_000);
});
