// ══════════════════════════════════════════════════════════════════════════
// PP-09 — Enable Gold Gem Spawning.
//
// Gold gems must join the Processing Plant board and drop like the other
// resource types the moment a Depot is built beside a Gold Mine. The gate is
// PLACEMENT-based (depot in catchment), not connection-based: no road is
// required for the gems to start dropping. The payout stays connection-gated —
// only a tokened gold gem credits the purse (see the N3 tests in
// iso-quarry.test.ts for that half of the rule).
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach } from "vitest";
import { Board } from "../../src/game/board";
import { createQuarry, hasGoldMineDepot } from "../../src/iso/quarry";
import { INDUSTRY_BY_KEY } from "../../src/iso/config";
import {
  BOARD_H, BOARD_W, MAP_W, MAP_H, setRng, mulberry32, type ResKey,
} from "../../src/game/config";
import { createTrack, buildTile, tIdx } from "../../src/iso/track";
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

/** A gold mine at 11,11 with a depot placed in its catchment at 10,10. */
function goldWorld(harvesters: Harvester[] = [H(1, "you", 10, 10)]) {
  const grid = flatGrid([ind("gold_mine", 11, 11)]);
  const track = createTrack();
  const state: EconomyState = {
    grid, track, harvesters,
    factories: [{ owner: "you", ownerId: 1, tx: 14, ty: 10 }],
  };
  const connect = () => {
    for (let x = 11; x <= 14; x++) buildTile(track, "road", x, 10, 1);
  };
  return { state, connect };
}

/** A match-free, token-free board with no gold on it. */
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
  expect(board.gems().some((g) => g.res === "gold")).toBe(false);
}

beforeEach(() => setRng(mulberry32(1234)));

// ── the board-level gate ──────────────────────────────────────────────────
describe("PP-09 Board.setGoldEnabled", () => {
  it("a fresh board's pool has the five base colours and no gold", () => {
    const b = new Board();
    expect(b.pool).toEqual(["wood", "brick", "sheep", "wheat", "ore"]);
    expect(b.pool).not.toContain("gold");
  });

  it("turns gold drops on and off idempotently", () => {
    const b = new Board();
    b.setGoldEnabled(true);
    b.setGoldEnabled(true);                 // no double-add
    expect(b.pool.filter((r) => r === "gold")).toHaveLength(1);

    b.setGoldEnabled(false);
    b.setGoldEnabled(false);                // no double-remove
    expect(b.pool).not.toContain("gold");
    expect(b.pool).toEqual(["wood", "brick", "sheep", "wheat", "ore"]);
  });

  it("gold gems appear in a refill once the pool is enabled", () => {
    const b = new Board();
    b.setGoldEnabled(true);
    b.resetNeutral();                       // initFill draws from the pool
    expect(b.gems().some((g) => g.res === "gold")).toBe(true);
  });
});

// ── the quarry-level gate: depot beside a gold mine ───────────────────────
describe("PP-09 gold gems drop beside a gold mine", () => {
  it("hasGoldMineDepot is true only for a depot whose catchment covers a gold mine", () => {
    const gold = flatGrid([ind("gold_mine", 11, 11)]);
    const noGold = flatGrid([ind("farm", 11, 11)]);
    const t = createTrack();
    const beside: EconomyState = {
      grid: gold, track: t, harvesters: [H(1, "you", 10, 10)],
      factories: [{ owner: "you", ownerId: 1, tx: 14, ty: 10 }],
    };
    const far: EconomyState = {
      grid: gold, track: t, harvesters: [H(1, "you", 40, 40)],
      factories: [{ owner: "you", ownerId: 1, tx: 14, ty: 10 }],
    };
    const farm: EconomyState = {
      grid: noGold, track: t, harvesters: [H(1, "you", 10, 10)],
      factories: [{ owner: "you", ownerId: 1, tx: 14, ty: 10 }],
    };
    expect(hasGoldMineDepot(beside, "you")).toBe(true);
    expect(hasGoldMineDepot(far, "you")).toBe(false);
    expect(hasGoldMineDepot(farm, "you")).toBe(false);
    expect(hasGoldMineDepot(beside, "ai")).toBe(false);   // another owner's board
  });

  it("building a depot next to a gold mine immediately turns gold drops on", () => {
    const { state } = goldWorld([]);                    // no depot yet
    const q = createQuarry(state, "you");
    q.refresh(0);
    expect(q.board.pool).not.toContain("gold");         // nothing beside a mine yet

    state.harvesters.push(H(1, "you", 10, 10));         // build the depot
    q.refresh(0);
    expect(q.board.pool).toContain("gold");
  });

  it("does NOT require the road link — placement alone starts the drops", () => {
    const { state } = goldWorld();                      // depot beside the mine, no road
    const q = createQuarry(state, "you");
    neutralise(q.board);
    q.refresh(0);
    expect(q.reach).toEqual({});                        // nothing connected yet…
    expect(q.board.pool).toContain("gold");             // …but gold already drops
  });

  it("demolishing the depot turns gold drops back off", () => {
    const { state } = goldWorld();
    const q = createQuarry(state, "you");
    q.refresh(0);
    expect(q.board.pool).toContain("gold");

    state.harvesters.pop();                             // depot demolished
    q.refresh(0);
    expect(q.board.pool).not.toContain("gold");
  });

  it("a depot beside any other industry does not turn gold drops on", () => {
    const grid = flatGrid([ind("farm", 11, 11)]);
    const track = createTrack();
    const state: EconomyState = {
      grid, track, harvesters: [H(1, "you", 10, 10)],
      factories: [{ owner: "you", ownerId: 1, tx: 14, ty: 10 }],
    };
    const q = createQuarry(state, "you");
    q.refresh(0);
    expect(q.board.pool).not.toContain("gold");
  });

  it("gold gems actually drop onto the board once the depot is beside the mine", () => {
    const { state } = goldWorld();
    const q = createQuarry(state, "you");
    neutralise(q.board);                                // no gold anywhere
    q.refresh(0);                                       // the placement gate flips
    expect(q.board.pool).toContain("gold");
    q.board.resetNeutral();                             // refill draws from the pool
    expect(q.board.gems().some((g) => g.res === "gold")).toBe(true);
  });
});
