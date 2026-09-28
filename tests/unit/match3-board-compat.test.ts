// MATCH-2 — the drop-in `Board`: the surface the old callers use (tuning,
// battles, quarry, rival plant), determinism under `setRng`, obstacles, the
// phase stream's order, and the wire snapshot.
import { beforeEach, describe, expect, it } from "vitest";
import {
  BOARD_ANIMATION_MS,
  BROKEN_CROSS_PICKS,
  Board,
  FAST_ANIMATION_MS,
  HOLY_CROSS_PICKS,
  Match3Engine,
  arcadeLabel,
  mulberry32,
  setRng,
  type BoardPhase,
  type Gem,
  type PassReport,
  type ResKey,
  type RewardKind,
} from "../../src/match3";

function headless(seed = 1): Board {
  const b = new Board({ rng: mulberry32(seed) });
  b.waitScale = 0;
  return b;
}

/** Paint a grid by letters so a test can lay a shape by hand. */
const L: Record<string, ResKey> = { W: "wood", B: "brick", S: "sheep", H: "wheat", O: "ore", G: "gold" };
function paint(b: Board, rows: string[]): void {
  const e = b.engine;
  e.grid = rows.map((row, r) => row.split("").map((ch, c) => e.newGem(L[ch], r, c)));
}

/** Column 2 reads W S W W from the top; row 1 reads O W S W … — swapping
 * (0,2)W down into (1,2) makes a T of wood. No run stands beforehand. */
const T_BOARD = ["BSWOHBS", "OWSWOHB", "BSWOHBS", "OSWSHOW", "WBSHOWB", "BSHOWBS", "HOWBSHO", "OWBSHOW"];

describe("MATCH-2 — Board: the legacy surface", () => {
  beforeEach(() => setRng(Math.random));

  it("exports the constants the callers import", () => {
    expect(BOARD_ANIMATION_MS.swap).toBe(80);
    expect(BOARD_ANIMATION_MS.fall).toBe(105);
    expect(FAST_ANIMATION_MS.clear).toBe(16);
    expect(HOLY_CROSS_PICKS).toBe(6);
    expect(BROKEN_CROSS_PICKS).toBe(3);
    expect(arcadeLabel(1)).toBe("MATCH!");
    expect(arcadeLabel(2)).toBe("COMBO x2");
    expect(arcadeLabel(4)).toBe("CHAIN x4!!");
    expect(Board.COMBOS_PER_GOLD).toBe(2);
  });

  it("boots a 7×8 board with no match and a legal move", () => {
    const b = headless(3);
    expect(b.w).toBe(7);
    expect(b.h).toBe(8);
    expect(b.gems()).toHaveLength(56);
    expect(b.findGroups()).toEqual([]);
    expect(b.hasMove()).toBe(true);
    expect(b.pool).toEqual(["wood", "brick", "sheep", "wheat", "ore"]);
  });

  it("has the fields and callbacks game.ts wires", () => {
    const b = headless();
    for (const k of ["onHarvest", "onGold", "onFx", "onChange", "onTurbo", "onPopup", "onCombo", "onBonus", "onReward", "onClear", "onPass", "onCrossChoice", "onPhase"]) {
      expect(typeof (b as unknown as Record<string, unknown>)[k]).toBe("function");
    }
    expect(b.busy).toBe(false);
    expect(b.comboCount).toBe(0);
    expect(b.paysScore).toBe(false);
    b.setPaysScore(true);
    expect(b.paysScore).toBe(true);
    expect(b.queuedMoves).toBe(0);
    expect(b.turbo).toBe(false);
  });

  it("resolves a swap and reports the pass in the old order (fx → reward → clear → pass → change)", async () => {
    const b = headless();
    b.setPaysScore(true);
    // row 0 reads W W B W …: swapping (0,2)B with (0,3)W makes W W W
    paint(b, ["WWBWOSH", "BSHOWBS", "HOWBSHO", "OWBSHOW", "WBSHOWB", "BSHOWBS", "HOWBSHO", "OWBSHOW"]);
    const order: string[] = [];
    b.onFx = (t) => order.push(`fx:${t}`);
    b.onClear = (n, chain) => order.push(`clear:${n}@${chain}`);
    b.onPass = (p: PassReport) => order.push(`pass:${p.biggest}`);
    b.onChange = () => order.push("change");
    const out = await b.trySwap(0, 2, 0, 3);
    expect(out).toBe("matched");
    // the swap's change first, then the pass
    expect(order[0]).toBe("change");
    const clearAt = order.findIndex((s) => s.startsWith("clear:"));
    const passAt = order.findIndex((s) => s.startsWith("pass:"));
    const popAt = order.findIndex((s) => s === "fx:pop");
    expect(popAt).toBeGreaterThan(-1);
    expect(popAt).toBeLessThan(clearAt);
    expect(clearAt).toBeLessThan(passAt);
    expect(order[passAt + 1]).toBe("change");
    expect(order[clearAt]).toMatch(/^clear:3@1/);
    expect(b.busy).toBe(false);
  });

  it("reverts a dud swap with a `bad` fx and spends nothing", async () => {
    const b = headless(5);
    const before = b.snapshot();
    const fx: string[] = [];
    b.onFx = (t) => fx.push(t);
    // find a swap that makes NO match
    let out: string | null = null;
    outer: for (let r = 0; r < b.h; r++) {
      for (let c = 0; c < b.w - 1; c++) {
        if (b.engine.swapGain(r, c, r, c + 1) === 0) {
          out = await b.trySwap(r, c, r, c + 1);
          break outer;
        }
      }
    }
    expect(out).toBe("reverted");
    expect(fx).toEqual(["bad"]);
    expect(b.snapshot().grid).toEqual(before.grid);
  });

  it("refuses non-adjacent, blocked and empty cells", async () => {
    const b = headless();
    expect(await b.trySwap(0, 0, 0, 2)).toBe("refused");
    b.grid[0][0]!.block = true;
    expect(await b.trySwap(0, 0, 0, 1)).toBe("refused");
    expect(await b.trySwap(-1, 0, 0, 0)).toBe("refused");
  });

  it("queues a move while busy when the queue is allowed, refuses when not", async () => {
    const b = new Board({ rng: mulberry32(8) });
    b.waitScale = 1;
    const mv = b.findMove()!;
    const first = b.trySwap(mv[0], mv[1], mv[2], mv[3]);
    const second = await b.trySwap(mv[0], mv[1], mv[2], mv[3]);
    expect(second).toBe("queued");
    b.allowQueue = false;
    expect(await b.trySwap(mv[0], mv[1], mv[2], mv[3])).toBe("refused");
    await first;
    expect(b.busy).toBe(false);
  }, 10000);
});

describe("MATCH-2 — Board: rules", () => {
  // Owner (2026-09-28): a 5-run mints the DISCO BALL now (bombs come from L's
  // and crosses); the bomb's purge is checked on a bomb set by hand.
  it("a 5-run mints a disco ball; a bomb swapped purges a colour and reports `purged`", async () => {
    const b = headless();
    b.setPaysScore(true);
    paint(b, ["WWBWWSH", "BSWOHBS", "HOBWSHO", "OWSBHOW", "WBSHOWB", "BSHOWBS", "HOWBSHO", "OWBSHOW"]);
    // (0,2)B ↔ (1,2)W → row 0 = W W W W W → match-5
    const rewards: RewardKind[] = [];
    b.onReward = (k) => rewards.push(k);
    const passes: PassReport[] = [];
    b.onPass = (p) => passes.push(p);
    expect(await b.trySwap(0, 2, 1, 2)).toBe("matched");
    expect(passes[0].biggest).toBeGreaterThanOrEqual(5);
    expect(passes[0].shaped).toBe(true);
    expect(rewards).toContain("shape");
    const disco = b.gems().find((g) => g.special === "disco");
    expect(disco).toBeDefined();
    expect(b.matchable(disco)).toBe(false);
    disco!.special = null;
    const bomb = b.gems().find((g) => g.r === 3 && g.c === 3)!;
    bomb.special = "bomb";
    expect(bomb).toBeDefined();
    // a bomb is not matchable but is the board's escape hatch
    expect(b.matchable(bomb)).toBe(false);
    expect(b.hasMove()).toBe(true);
    // detonate it into a neighbour's colour
    const nb = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dr, dc]) => b.grid[bomb!.r + dr]?.[bomb!.c + dc]).find((g) => g && g.special !== "bomb")!;
    const colour = nb.res;
    const victims = new Set(b.gems().filter((g) => g.res === colour && g.special !== "bomb" && !g.block && g.hard === 0).map((g) => g.id));
    const cleared: number[] = [];
    b.onClear = (n, chain) => cleared.push(chain === 2 ? n : -n);
    passes.length = 0;
    expect(await b.trySwap(bomb!.r, bomb!.c, nb.r, nb.c)).toBe("matched");
    expect(passes[0].purged).toBe(victims.size);
    expect(cleared[0]).toBe(passes[0].purged); // the blast scores at depth 2
    // every gem of that colour that stood before the blast is gone
    expect(b.gems().some((g) => victims.has(g.id))).toBe(false);
    expect(b.gems().some((g) => g.special === "bomb" && g.id === bomb!.id)).toBe(false);
  });

  it("frost cracks instead of clearing and pays a `frost` reward; a girder breaks beside a removal", async () => {
    const b = headless();
    b.setPaysScore(true);
    paint(b, ["WBWSOHB", "BSHOWBS", "HOWBSHO", "OWBSHOW", "WBSHOWB", "BSHOWBS", "HOWBSHO", "OWBSHOW"]);
    // (0,1)B ↔ (1,1)S? make row 0 W W W by swapping (0,1)B with (1,1)S — no. Use (0,1)↔(0,2)? W W B... Lay it plainly:
    paint(b, ["WBWSOHB", "BWHOWBS", "HOWBSHO", "OWBSHOW", "WBSHOWB", "BSHOWBS", "HOWBSHO", "OWBSHOW"]);
    // (0,1)B ↔ (1,1)W → row 0 = W W W
    b.grid[0][0]!.hard = 2;
    b.grid[0][3]!.block = true; // the girder beside (0,2)
    const rewards: RewardKind[] = [];
    b.onReward = (k) => rewards.push(k);
    const fx: string[] = [];
    b.onFx = (t) => fx.push(t);
    let cleared = 0;
    b.onClear = (n) => (cleared += n);
    const frostedId = b.grid[0][0]!.id;
    expect(await b.trySwap(0, 1, 1, 1)).toBe("matched");
    expect(rewards).toContain("frost");
    expect(rewards).toContain("girder");
    expect(fx.filter((f) => f === "crack").length).toBeGreaterThanOrEqual(2);
    // the frosted gem stayed on the first pass (cracked once, 2 → 1) while the
    // other two left; a later cascade may crack it again, so allow either
    const frosted = b.gems().find((g) => g.id === frostedId);
    if (frosted) expect(frosted.hard).toBeLessThanOrEqual(1);
    expect(cleared).toBeGreaterThanOrEqual(2);
    expect(b.obstacleCounts().girders).toBe(0);
  });

  it("scores crosses without pausing on a score board, and pauses for the chooser on a cargo board", async () => {
    const b = headless();
    b.setPaysScore(true);
    // A T (broken cross): W arrives at (1,2) from (0,2); row 1 then reads
    // W W W across (1,1)…(1,3) with (1,2) its centre, and column 2 reads
    // W W W down rows 1…3 with (1,2) its END. No match stands beforehand.
    paint(b, T_BOARD);
    const rewards: RewardKind[] = [];
    b.onReward = (k) => rewards.push(k);
    let asked = 0;
    b.onCrossChoice = (_k, picks, pick) => {
      asked++;
      pick(Array.from({ length: picks }, () => "ore" as ResKey));
    };
    expect(b.findGroups()).toEqual([]);
    expect(await b.trySwap(0, 2, 1, 2)).toBe("matched");
    expect(rewards.filter((r) => r === "brokenCross" || r === "holyCross").length).toBeGreaterThanOrEqual(1);
    expect(asked).toBe(0);
  });

  it("a cargo board pays the chooser's picks as forged harvests", async () => {
    const b = headless();
    paint(b, T_BOARD);
    const paid: [ResKey, number, boolean][] = [];
    b.onHarvest = (res, amount, forged) => {
      paid.push([res, amount, forged]);
      return true;
    };
    let asked: [string, number] | null = null;
    b.onCrossChoice = (k, picks, pick) => {
      asked = [k, picks];
      pick(["ore", "ore", "wood"]);
    };
    await b.trySwap(0, 2, 1, 2);
    expect(asked).toEqual(["broken", BROKEN_CROSS_PICKS]);
    // the three picks are paid forged, in the order chosen (a later cascade
    // may add token harvests behind them)
    expect(paid.filter(([, , forged]) => forged).length).toBeGreaterThanOrEqual(BROKEN_CROSS_PICKS);
    expect(paid.map(([r]) => r).slice(0, 3)).toEqual(["ore", "ore", "wood"]);
  });

  it("obstacles are seeded, never take the last move, and are counted back", () => {
    const b = headless(11);
    const placed = b.seedObstacles(6, 3, 2);
    expect(placed.frost).toBeGreaterThan(0);
    expect(placed.girders).toBeGreaterThan(0);
    expect(placed.frostHard).toBe(2);
    expect(b.hasMove()).toBe(true);
    expect(b.obstacleCounts()).toEqual({ frost: placed.frost, girders: placed.girders, frostHard: 2 });
    expect(b.clearFrost()).toBe(placed.frost);
    expect(b.clearGirders()).toBe(placed.girders);
    expect(b.obstacleCounts()).toEqual({ frost: 0, girders: 0, frostHard: 1 });
  });

  it("findMove agrees with trySwap: whatever it returns, the board carries out", async () => {
    for (let seed = 1; seed <= 25; seed++) {
      const b = headless(seed);
      if (seed % 3 === 0) b.seedObstacles(6, 3, 2);
      const mv = b.findMove();
      expect(mv).not.toBeNull();
      const out = await b.trySwap(mv![0], mv![1], mv![2], mv![3]);
      expect(out).toBe("matched");
    }
  });

  it("snapshot → restore round-trips the grid, and a sizing change keeps identity", () => {
    const b = headless(2);
    b.grid[1][1]!.tier = 2;
    b.grid[2][2]!.hard = 1;
    b.grid[3][3]!.block = true;
    const snap = b.snapshot();
    const c = headless(99);
    c.restore(JSON.parse(JSON.stringify(snap)));
    expect(c.snapshot().grid).toEqual(snap.grid);
    expect(c.grid[1][1]!.tier).toBe(2);
    expect(c.grid[2][2]!.hard).toBe(1);
    expect(c.grid[3][3]!.block).toBe(true);
    const id = b.grid[0][0]!.id;
    expect(b.setSize(9, 10)).toBe(true);
    expect(b.w).toBe(9);
    expect(b.h).toBe(10);
    expect(b.grid[0][0]!.id).toBe(id);
    expect(b.setSize(9, 10)).toBe(false);
  });

  it("spawnTokens upgrades an existing gem, never on a score board", () => {
    const b = headless(4);
    expect(b.spawnTokens({ wood: 1, ore: 2 })).toBe(2);
    expect(b.gems().filter((g) => g.tier > 0)).toHaveLength(2);
    b.setPaysScore(true);
    expect(b.spawnTokens({ wood: 1 })).toBe(0);
  });

  it("gold only joins the pool when enabled; the bias pulls the depot's colour", () => {
    const b = headless(6);
    b.setGoldEnabled(true);
    expect(b.pool).toContain("gold");
    b.setGoldEnabled(false);
    expect(b.pool).not.toContain("gold");
    b.setBias("wheat", 1);
    b.initFill();
    // a 100% bias fills the whole board in wheat wherever no-match allows it (~every cell it can)
    const wheat = b.gems().filter((g) => g.res === "wheat").length;
    expect(wheat).toBeGreaterThan(30);
  });
});

describe("MATCH-2 — determinism and the phase stream", () => {
  it("the same seed gives the same board and the same resolution", async () => {
    const play = async (seed: number) => {
      const b = headless(seed);
      const phases: string[] = [];
      b.onPhase = (p: BoardPhase) => phases.push(p.type + (p.type === "clear" ? `:${p.cleared}` : ""));
      for (let i = 0; i < 5; i++) {
        const mv = b.findMove();
        if (!mv) break;
        await b.trySwap(mv[0], mv[1], mv[2], mv[3]);
      }
      return { grid: b.snapshot().grid.map((row) => row.map((g) => g?.res).join("")).join("|"), phases };
    };
    const a = await play(1234);
    const c = await play(1234);
    expect(a).toEqual(c);
    const d = await play(1235);
    expect(d.grid).not.toBe(a.grid);
  });

  it("the swap phase names the contact frame; the fall phase names every landing", async () => {
    const b = headless(21);
    const phases: BoardPhase[] = [];
    b.onPhase = (p) => phases.push(p);
    const mv = b.findMove()!;
    await b.trySwap(mv[0], mv[1], mv[2], mv[3]);
    expect(phases[0].type).toBe("swap");
    if (phases[0].type === "swap") {
      expect(phases[0].contactAt).toBe(0.5);
      expect(phases[0].a.id).not.toBe(phases[0].b.id);
    }
    const clear = phases.find((p) => p.type === "clear");
    const fall = phases.find((p) => p.type === "fall");
    expect(clear && clear.type === "clear" && clear.removed.length).toBeGreaterThanOrEqual(3);
    expect(fall && fall.type === "fall" && fall.moves.length).toBeGreaterThanOrEqual(3);
    if (fall && fall.type === "fall") {
      for (const m of fall.moves) {
        expect(m.toR).toBeGreaterThan(m.fromR);
        if (m.spawned) expect(m.fromR).toBeLessThan(0);
      }
    }
    expect(phases[phases.length - 1].type === "end" || phases[phases.length - 1].type === "shuffle").toBe(true);
  });

  it("the engine drains a resolution with no timers at all", () => {
    const e = new Match3Engine({ rng: mulberry32(3) });
    const mv = e.findMove()!;
    const seen: string[] = [];
    const ok = e.drain(e.resolveSwap(mv[0], mv[1], mv[2], mv[3]), (p) => seen.push(p.type));
    expect(ok).toBe(true);
    expect(seen[0]).toBe("swap");
    expect(seen).toContain("clear");
    expect(e.findGroups()).toEqual([]);
    expect(e.hasMove()).toBe(true);
  });

  it("a dead board reshuffles into one with a move", () => {
    const e = new Match3Engine({ rng: mulberry32(1) });
    // three colours on diagonals have no match and no move (two colours in a
    // checkerboard still leave moves)
    const K: ResKey[] = ["wood", "brick", "ore"];
    e.grid = e.grid.map((row, r) => row.map((_, c) => e.newGem(K[(r + c) % 3], r, c)));
    expect(e.hasMove()).toBe(false);
    e.reshuffleGrid();
    expect(e.hasMove()).toBe(true);
    expect(e.findGroups()).toEqual([]);
  });

  it("gems keep their identity through a fall (the renderer's contract)", async () => {
    const b = headless(31);
    const before = new Map(b.gems().map((g) => [g.id, g] as [number, Gem]));
    const mv = b.findMove()!;
    await b.trySwap(mv[0], mv[1], mv[2], mv[3]);
    let kept = 0;
    for (const g of b.gems()) if (before.has(g.id)) kept++;
    expect(kept).toBeGreaterThan(40);
  });
});
