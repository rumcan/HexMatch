// Owner (2026-09-28): the LINE gem. A match of 4 leaves one behind (the
// colour's own art, marked); caught in a match it clears its whole row and
// column; swapped left/right it clears just its row, up/down just its column.
import { describe, expect, it } from "vitest";
import { Match3Engine, mulberry32, type ResKey } from "../../src/match3";

const K: ResKey[] = ["wood", "brick", "ore"];
/** A dead board (three colours on diagonals: no match, no move) to paint on. */
function board(): Match3Engine {
  const e = new Match3Engine({ rng: mulberry32(7) });
  e.grid = e.grid.map((row, r) => row.map((_, c) => e.newGem(K[(r + c) % 3], r, c)));
  return e;
}
const drain = (e: Match3Engine, gen: ReturnType<Match3Engine["resolveSwap"]>) => {
  const seen: { type: string; removed?: { r: number; c: number }[] }[] = [];
  e.drain(gen, (p) => seen.push(p as never));
  return seen;
};

describe("the line gem", () => {
  it("is what a match of 4 leaves behind, in its colour", () => {
    const e = board();
    // row 0: three sheep, the fourth swapped up into col 3 from (1,3)
    for (const c of [0, 1, 2]) e.grid[0][c]!.res = "sheep";
    e.grid[1][3]!.res = "sheep";
    e.grid[0][3]!.res = "gold";
    e.grid[0][5]!.res = "wheat";
    const phases = drain(e, e.resolveSwap(0, 3, 1, 3));
    const clear = phases.find((p) => p.type === "clear") as unknown as { minted: { what: string; r: number; c: number }[] };
    expect(clear.minted.some((m) => m.what === "line")).toBe(true);
    const m = clear.minted.find((x) => x.what === "line")!;
    expect(e.gems().some((g) => g.special === "line" && g.res === "sheep")).toBe(true);
    expect(m.r).toBeGreaterThanOrEqual(0);
  });

  it("swapped left/right clears just its row; up/down just its column", () => {
    const row = board();
    const lr = row.grid[3][3]!;
    lr.special = "line";
    const phasesR = drain(row, row.resolveSwap(3, 3, 3, 4));
    const blastR = phasesR.find((p) => p.type === "bombClear")!;
    const rs = new Set(blastR.removed!.map((x) => x.r));
    expect([...rs]).toEqual([3]);
    expect(blastR.removed!.length).toBe(row.w);

    const col = board();
    col.grid[3][3]!.special = "line";
    const phasesC = drain(col, col.resolveSwap(3, 3, 4, 3));
    const blastC = phasesC.find((p) => p.type === "bombClear")!;
    const cs = new Set(blastC.removed!.map((x) => x.c));
    expect([...cs]).toEqual([3]);
    expect(blastC.removed!.length).toBe(col.h);
  });

  it("caught in a match it clears its row AND its column", () => {
    const e = board();
    // a line gem in the middle of a vertical three
    e.grid[2][2]!.res = "gold"; e.grid[3][2]!.res = "gold"; e.grid[4][2]!.res = "gold";
    e.grid[3][2]!.special = "line";
    const groups = e.findGroups();
    const gains = {};
    const clear = e.resolve(groups, gains, 1);
    const onRow = clear.removed.filter((x) => x.r === 3).length;
    const onCol = clear.removed.filter((x) => x.c === 2).length;
    expect(onRow).toBe(e.w);
    expect(onCol).toBe(e.h);
  });

  it("counts as a move (a swap always fires it)", () => {
    const e = board();
    expect(e.hasMove()).toBe(false);
    e.grid[0][0]!.special = "line";
    expect(e.hasMove()).toBe(true);
    expect(e.findMove()).not.toBeNull();
  });
});
