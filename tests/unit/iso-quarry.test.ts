// ══════════════════════════════════════════════════════════════════════════
// J1 — the quarry join: gem colours ↔ cargoes, and the network gate.
//
// The rule under test is the whole point of the ticket: a gem match pays cargo
// ONLY for industries the player's road/rail network reaches, and it stops
// paying the moment the line is cut. Both halves are asserted — the token that
// never spawns, and the harvest that is refused at match time.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach } from "vitest";
import {
  GEM_TO_CARGO, CARGO_TO_GEM, TIER2_YIELD, reachableCargo, tokenPool,
  demoteTokens, createQuarry, tokenedGems,
} from "../../src/iso/quarry";
import { CARGOES, INDUSTRY_BY_KEY, type Cargo } from "../../src/iso/config";
import {
  RES_KEYS, BOARD_W, BOARD_H, MAP_W, MAP_H, setRng, mulberry32, type ResKey,
} from "../../src/game/config";
import type { Board } from "../../src/game/board";
import { createTrack, buildTile, demolishTile, tIdx, type Track } from "../../src/iso/track";
import { GRASS, type Grid, type Industry } from "../../src/iso/grid";
import type { EconomyState, Harvester } from "../../src/iso/economy";

// ── a small deterministic world ───────────────────────────────────────────
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

const run = (t: Track, kind: "road" | "rail", x0: number, x1: number, y: number) => {
  for (let x = x0; x <= x1; x++) buildTile(t, kind, x, y, 1);
};

/**
 * Farm (grain) at 11,11; harvester at 10,10 catches it; the factory sits at
 * 14,10, so road tiles 11..14 on row 10 complete the link. W2: every tile is
 * owned by "you" (ownerId 1) — the link only exists because the track is his.
 */
function world() {
  const grid = flatGrid([ind("farm", 11, 11)]);
  const track = createTrack();
  const harvester = H(1, "you", 10, 10);
  const state: EconomyState = {
    grid, track, harvesters: [harvester], factories: [{ owner: "you", ownerId: 1, tx: 14, ty: 10 }],
  };
  const connect = () => run(track, "road", 11, 14, 10);
  const cut = () => demolishTile(track, "road", 12, 10);
  return { state, harvester, connect, cut, track };
}

/** A match-free board: four colours cycling so no row or column runs. */
const NEUTRAL: ResKey[] = ["wood", "ore", "brick", "wheat"];
function neutralise(board: Board) {
  for (let r = 0; r < BOARD_H; r++) {
    for (let c = 0; c < BOARD_W; c++) {
      const g = board.grid[r][c]!;
      g.res = NEUTRAL[(r * 3 + c) % 4];
      g.tier = 0; g.special = null; g.block = false; g.hard = 0;
    }
  }
  expect(board.findGroups()).toHaveLength(0);
}

/** Line the network-spawned token up with two neighbours of its colour. */
function lineUpToken(board: Board, res: ResKey, r = 4, c = 4) {
  const [tok] = tokenedGems(board, res);
  expect(tok).toBeTruthy();
  const a = board.grid[tok.r][tok.c]!, b = board.grid[r][c]!;
  board.grid[tok.r][tok.c] = b; board.grid[r][c] = a;
  a.r = r; a.c = c; b.r = tok.r; b.c = tok.c;
  board.grid[r][c - 1]!.res = res;
  board.grid[r][c + 1]!.res = res;
  return tok;
}

beforeEach(() => setRng(mulberry32(1234)));

// ── the bijection ─────────────────────────────────────────────────────────
describe("J1 gem colours ↔ cargoes", () => {
  it("maps all six gem colours onto all six cargoes, one-to-one", () => {
    const cargos = RES_KEYS.map((r) => GEM_TO_CARGO[r]);
    expect(new Set(cargos).size).toBe(RES_KEYS.length);
    expect([...cargos].sort()).toEqual([...CARGOES].sort());
  });

  it("inverts cleanly, so no cargo is unreachable and none is doubled up", () => {
    for (const c of CARGOES) {
      expect(GEM_TO_CARGO[CARGO_TO_GEM[c]]).toBe(c);
    }
  });
});

// ── the gate: what the network reaches ────────────────────────────────────
describe("J1 reachable cargo (the gate)", () => {
  it("is empty with no track — a harvester alone reaches nothing", () => {
    const { state } = world();
    expect(reachableCargo(state, "you", 0)).toEqual({});
  });

  it("is exactly the connected industry's cargo once the road is laid", () => {
    const { state, connect } = world();
    connect();
    const reach = reachableCargo(state, "you", 0);
    expect(Object.keys(reach)).toEqual(["grain"]);      // the farm, and only it
    expect(reach.grain).toBeGreaterThan(0);
  });

  it("is empty again the moment the line is cut", () => {
    const { state, connect, cut } = world();
    connect();
    expect(Object.keys(reachableCargo(state, "you", 0))).toEqual(["grain"]);
    cut();
    expect(reachableCargo(state, "you", 0)).toEqual({});
  });

  it("never reports another player's cargo", () => {
    const { state, connect } = world();
    connect();
    expect(reachableCargo(state, "ai", 0)).toEqual({});
  });
});

describe("J1 token pool", () => {
  it("keys reachable cargo by GEM colour, tiered by yield", () => {
    expect(tokenPool({})).toEqual({});
    expect(tokenPool({ grain: 1 })).toEqual({ wheat: 1 });
    expect(tokenPool({ grain: TIER2_YIELD })).toEqual({ wheat: 2 });
    expect(tokenPool({ grain: 0.7, oil: 0.4 })).toEqual({ wheat: 1, sheep: 1 });
  });
});

// ── the join: matching harvests, and only when connected ──────────────────
describe("J1 createQuarry", () => {
  it("spawns a token for the connected cargo and harvests it into the purse", async () => {
    const { state, connect } = world();
    connect();
    const purse: Record<Cargo, number> = {
      grain: 0, wood: 0, ore: 0, stone: 0, oil: 0, gold: 0,
    };
    const harvested: [Cargo, number][] = [];
    const blocked: [Cargo, number][] = [];
    const q = createQuarry(state, "you", {
      onHarvest: (cargo, amount) => { purse[cargo] += amount; harvested.push([cargo, amount]); },
      onBlocked: (cargo, amount) => blocked.push([cargo, amount]),
    });

    neutralise(q.board);
    q.refresh(0);

    // the token exists, it is the farm's colour, and it is the ONLY token
    const tokens = q.board.gems().filter((g) => g.tier > 0);
    expect(tokens).toHaveLength(1);
    expect(GEM_TO_CARGO[tokens[0].res]).toBe("grain");

    lineUpToken(q.board, "wheat");
    expect(q.board.findGroups().length).toBeGreaterThan(0);
    await q.board.settle();

    expect(harvested).toEqual([["grain", 1]]);
    expect(purse.grain).toBe(1);
    expect(blocked).toEqual([]);
  });

  it("spawns nothing and pays nothing when the network reaches no industry", async () => {
    const { state } = world();                       // no track at all
    const purse: Record<Cargo, number> = {
      grain: 0, wood: 0, ore: 0, stone: 0, oil: 0, gold: 0,
    };
    const harvested: [Cargo, number][] = [];
    const q = createQuarry(state, "you", {
      onHarvest: (cargo, amount) => { purse[cargo] += amount; harvested.push([cargo, amount]); },
    });

    neutralise(q.board);
    q.refresh(0);
    expect(q.board.gems().filter((g) => g.tier > 0)).toHaveLength(0);

    // a plain three-in-a-row still resolves, it simply pays nothing
    const r = 4;
    q.board.grid[r][3]!.res = "wheat";
    q.board.grid[r][4]!.res = "wheat";
    q.board.grid[r][5]!.res = "wheat";
    await q.board.settle();

    expect(harvested).toEqual([]);
    expect(purse.grain).toBe(0);
  });

  it("refuses the harvest when the line is cut after the token spawned", async () => {
    const { state, connect, cut } = world();
    connect();
    const purse: Record<Cargo, number> = {
      grain: 0, wood: 0, ore: 0, stone: 0, oil: 0, gold: 0,
    };
    const harvested: [Cargo, number][] = [];
    const blocked: [Cargo, number][] = [];
    const q = createQuarry(state, "you", {
      onHarvest: (cargo, amount) => { purse[cargo] += amount; harvested.push([cargo, amount]); },
      onBlocked: (cargo, amount) => blocked.push([cargo, amount]),
    });

    neutralise(q.board);
    q.refresh(0);
    lineUpToken(q.board, "wheat");

    cut();                       // the road goes down BEFORE the match resolves
    await q.board.settle();

    expect(harvested).toEqual([]);
    expect(blocked).toEqual([["grain", 1]]);
    expect(purse.grain).toBe(0);
  });

  it("strips the tokens of a cargo the network stopped reaching", () => {
    const { state, connect, cut } = world();
    connect();
    const q = createQuarry(state, "you");
    neutralise(q.board);
    q.refresh(0);
    expect(tokenedGems(q.board, "wheat")).toHaveLength(1);

    cut();
    q.refresh(0);
    expect(tokenedGems(q.board, "wheat")).toHaveLength(0);
    expect(q.reach).toEqual({});
  });

  it("demoteTokens clears only the colours it is told to", () => {
    const { state, connect } = world();
    connect();
    const q = createQuarry(state, "you");
    neutralise(q.board);
    q.refresh(0);
    const tok = tokenedGems(q.board, "wheat")[0];
    tok.res = "wood";                        // pretend wood was tokened too
    expect(demoteTokens(q.board, ["brick"])).toBe(0);
    expect(demoteTokens(q.board, ["wood"])).toBe(1);
    expect(q.board.gems().filter((g) => g.tier > 0)).toHaveLength(0);
  });
});

// W5 — gold coins must reach the purse. The board banks a coin every
// COMBOS_PER_GOLD combos; the quarry's onGold hook is the wire that credits
// the purse. Without it the coin dies on the board and the Black Market
// (which spends gold) is silently unaffordable.
describe("W5 the combo coin reaches the purse", () => {
  it("credits onGold exactly once per banked coin (2 combos = 1)", () => {
    const { state } = world();
    const gold: number[] = [];
    const q = createQuarry(state, "you", { onGold: (n) => gold.push(n) });
    neutralise(q.board);

    q.board.registerCombo();
    expect(gold).toEqual([]);                 // one combo: no coin yet
    q.board.registerCombo();
    expect(gold).toEqual([1]);                // second combo: exactly one coin
    q.board.registerCombo();
    q.board.registerCombo();
    expect(gold).toEqual([1, 1]);             // banks again, one at a time
  });

  it("a coin lands in the purse the hook is given (game-level shape)", () => {
    const { state } = world();
    const purse: Record<Cargo, number> = {
      grain: 0, wood: 0, ore: 0, stone: 0, oil: 0, gold: 0,
    };
    const q = createQuarry(state, "you", {
      onGold: (n) => { purse.gold += n; },
    });
    neutralise(q.board);
    q.board.registerCombo();
    q.board.registerCombo();
    expect(purse.gold).toBe(1);
  });
});
