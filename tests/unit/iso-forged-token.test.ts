// ══════════════════════════════════════════════════════════════════════════
// PP-13 — the 4-match reward actually pays.
//
// The bug this pins: match FOUR gems of a colour in the Processing Plant and
// the board mints a tier-1 token of that colour. Match that token with two
// more of its colour and it paid NOTHING unless a depot already reached that
// cargo's industry — the J1 network gate (`quarry.ts`) treated a token the
// board had just forged exactly like a token the network had spawned, and
// refused it. The 4-match reward was silently worthless for every cargo the
// player had not connected yet, which is most of them at the start.
//
// The fix is the distinction itself: a FORGED token was paid for by the match
// that created it, so it pays whatever cargo it shows. A NETWORK token stays
// gated — that refusal is the whole J1 rule, and it is asserted here too so
// the fix cannot quietly open the gate for everything.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach } from "vitest";
import { createQuarry, GEM_TO_CARGO, demoteTokens, tokenedGems } from "../../src/iso/quarry";
import { INDUSTRY_BY_KEY, type Cargo } from "../../src/iso/config";
import { BOARD_W, BOARD_H, MAP_W, MAP_H, setRng, mulberry32, type ResKey } from "../../src/game/config";
import type { Board, Gem } from "../../src/game/board";
import { createTrack, buildTile, demolishTile, tIdx } from "../../src/iso/track";
import { GRASS, type Grid, type Industry } from "../../src/iso/grid";
import type { EconomyState, Harvester } from "../../src/iso/economy";

// ── a small deterministic world: ONE farm, so ONLY grain is reachable ──────
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
    industries, occupancy, seed: 1, towns: [],
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

/** Farm at 11,11; depot at 10,10 catches it; factory at 14,10; road 11..14. */
function world() {
  const grid = flatGrid([ind("farm", 11, 11)]);
  const track = createTrack();
  const state: EconomyState = {
    grid, track, harvesters: [H(1, "you", 10, 10)],
    factories: [{ owner: "you", ownerId: 1, tx: 14, ty: 10 }],
  };
  const connect = () => { for (let x = 11; x <= 14; x++) buildTile(track, "road", x, 10, 1); };
  const cut = () => demolishTile(track, "road", 12, 10);
  return { state, track, connect, cut };
}

/** A match-free board: four colours cycling so no row or column runs. */
const NEUTRAL: ResKey[] = ["wood", "ore", "brick", "wheat"];
function neutralise(board: Board, skip?: Gem) {
  for (let r = 0; r < BOARD_H; r++) {
    for (let c = 0; c < BOARD_W; c++) {
      const g = board.grid[r][c]!;
      if (g === skip) continue;
      g.res = NEUTRAL[(r * 3 + c) % 4];
      g.tier = 0; g.special = null; g.block = false; g.hard = 0; g.forged = false;
    }
  }
}

interface Rig {
  q: ReturnType<typeof createQuarry>;
  board: Board;
  purse: Record<Cargo, number>;
  harvested: [Cargo, number][];
  blocked: [Cargo, number][];
  gains: Partial<Record<Cargo, number>>[];
}

function rig(state: EconomyState): Rig {
  const purse: Record<Cargo, number> = {
    grain: 0, wood: 0, ore: 0, stone: 0, oil: 0, gold: 0,
  };
  const harvested: [Cargo, number][] = [];
  const blocked: [Cargo, number][] = [];
  const gains: Partial<Record<Cargo, number>>[] = [];
  const q = createQuarry(state, "you", {
    onHarvest: (cargo, amount) => { purse[cargo] += amount; harvested.push([cargo, amount]); },
    onBlocked: (cargo, amount) => blocked.push([cargo, amount]),
    onGains: (g) => gains.push(g),
  });
  return { q, board: q.board, purse, harvested, blocked, gains };
}

/**
 * The exact move the ticket describes: four of one colour in a row. `resolve`
 * removes all four and mints a tier-1 token of that colour in their place.
 */
async function matchFour(board: Board, res: ResKey): Promise<Gem> {
  neutralise(board);
  // Rewrite the whole of row 4: three filler colours that are not `res`, so
  // the row holds exactly one run of four whatever colour was asked for, and
  // the untouched rows 3/5 stay clear of it vertically.
  const fill = NEUTRAL.filter((x) => x !== res);
  const row: ResKey[] = [fill[0], res, res, res, res, fill[1], fill[2]];
  row.forEach((r, c) => { board.grid[4][c]!.res = r; });
  const groups = board.findGroups();
  expect(groups, "the setup must be exactly one run of four").toHaveLength(1);
  expect(groups[0]).toHaveLength(4);
  await board.settle();
  const forged = board.gems().filter((g) => g.forged === true);
  expect(forged, "a 4-match must mint exactly one forged token").toHaveLength(1);
  expect(forged[0].res).toBe(res);
  expect(forged[0].tier).toBe(1);
  return forged[0];
}

/**
 * Put a specific gem on (4,4) with two neighbours of its colour, on an
 * otherwise match-free board — the "match the new one with 2 more" move.
 */
function lineUpThree(board: Board, g: Gem): void {
  const from = { r: g.r, c: g.c };
  const displaced = board.grid[4][4]!;
  board.grid[4][4] = g; g.r = 4; g.c = 4;
  board.grid[from.r][from.c] = displaced; displaced.r = from.r; displaced.c = from.c;
  neutralise(board, g);
  board.grid[4][3]!.res = g.res;
  board.grid[4][5]!.res = g.res;
  const groups = board.findGroups();
  expect(groups, "the setup must be exactly one run of three").toHaveLength(1);
  expect(groups[0]).toHaveLength(3);
  expect(groups[0]).toContain(g);
}

beforeEach(() => setRng(mulberry32(1234)));

describe("PP-13 the board mints a token a 4-match can be rewarded with", () => {
  it("marks the minted gem as forged, so the gate can tell it apart", async () => {
    const { state } = world();
    const { board } = rig(state);
    neutralise(board);
    expect(board.gems().some((g) => g.forged === true)).toBe(false);
    const forged = await matchFour(board, "wood");
    // a network-spawned token, by contrast, is never marked
    expect(tokenedGems(board, "wood")).toContain(forged);
  });

  it("a 5-match mints a forged tier-2 token", async () => {
    const { state } = world();
    const { board } = rig(state);
    neutralise(board);
    // wood, brick ×5, wheat — exactly one run of five
    const row: ResKey[] = ["wood", "brick", "brick", "brick", "brick", "brick", "wheat"];
    row.forEach((r, c) => { board.grid[4][c]!.res = r; });
    expect(board.findGroups()).toHaveLength(1);
    expect(board.findGroups()[0]).toHaveLength(5);
    await board.settle();
    const forged = board.gems().filter((g) => g.forged === true);
    expect(forged).toHaveLength(1);
    expect(forged[0].tier).toBe(2);
    expect(forged[0].res).toBe("brick");
  });
});

describe("PP-13 a forged token pays with NO depot on that cargo's industry", () => {
  it("match four wood, then match the minted token → 1 Wood in the purse", async () => {
    const { state, connect } = world();
    connect();                       // grain is reachable; wood is NOT
    const r = rig(state);
    const forged = await matchFour(r.board, "wood");

    // sanity: this world has no forest, so wood is not a network cargo
    expect(GEM_TO_CARGO[forged.res]).toBe("wood");
    r.purse.wood = 0;

    lineUpThree(r.board, forged);
    await r.board.settle();

    expect(r.harvested).toEqual([["wood", 1]]);
    expect(r.blocked).toEqual([]);
    expect(r.purse.wood).toBe(1);
    // and the floating readout agrees with the purse (it used to filter the
    // forged payout back out, so the purse moved with nothing on screen)
    expect(r.gains.at(-1)).toEqual({ wood: 1 });
  });

  it("pays with no network at all — not even a road laid", async () => {
    const { state } = world();       // no track whatsoever
    const r = rig(state);
    // nothing reachable → the spawner mints no tokens at all
    expect(r.board.gems().filter((g) => g.tier > 0)).toHaveLength(0);

    const forged = await matchFour(r.board, "ore");
    lineUpThree(r.board, forged);
    await r.board.settle();

    expect(r.harvested).toEqual([["ore", 1]]);
    expect(r.purse.ore).toBe(1);
    expect(r.blocked).toEqual([]);
  });

  it("keeps a forged token when the network stops reaching that cargo", async () => {
    const { state, connect, cut } = world();
    connect();
    const r = rig(state);
    const forged = await matchFour(r.board, "wheat");   // grain IS reachable now

    cut();                           // the line goes down before the match
    // …and the refresh that follows must not strip the forged token
    expect(demoteTokens(r.board, ["wheat"])).toBe(0);
    expect(forged.tier).toBe(1);

    lineUpThree(r.board, forged);
    await r.board.settle();
    expect(r.harvested).toEqual([["grain", 1]]);
    expect(r.purse.grain).toBe(1);
  });
});

describe("PP-13 the network gate still refuses what the network spawned", () => {
  it("a network token is refused the moment the line is cut", async () => {
    const { state, connect, cut } = world();
    connect();
    const r = rig(state);
    neutralise(r.board);
    // the quarry's own refresh mints the grain token — the farm IS reachable
    r.q.refresh(0);
    const [tok] = tokenedGems(r.board, "wheat");
    expect(tok, "the network must have spawned a grain token").toBeTruthy();
    expect(tok.forged === true).toBe(false);

    lineUpThree(r.board, tok);
    cut();                           // the road goes down before the match
    await r.board.settle();

    expect(r.harvested).toEqual([]);
    expect(r.blocked).toEqual([["grain", 1]]);
    expect(r.purse.grain).toBe(0);
  });
});
