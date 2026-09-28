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

describe("the disco ball and the shape bomb", () => {
  it("swapped, a disco ball wipes the whole board", () => {
    const e = board();
    e.grid[4][3]!.special = "disco";
    const phases = drain(e, e.resolveSwap(4, 3, 4, 4));
    const wipe = phases.find((p) => p.type === "bombClear") as unknown as { removed: unknown[]; wipe?: boolean };
    expect(wipe.wipe).toBe(true);
    expect(wipe.removed.length).toBe(e.w * e.h);
  });

  it("an L-shape mints a bomb at its corner", () => {
    const e = board();
    // L: row 5 cols 0-2 and col 0 rows 3-5, corner (5,0)
    for (const c of [0, 1, 2]) e.grid[5][c]!.res = "gold";
    for (const r of [3, 4]) e.grid[r][0]!.res = "gold";
    const clear = e.resolve(e.findGroups(), {}, 1);
    expect(clear.minted.some((m) => m.what === "bomb" && m.r === 5 && m.c === 0)).toBe(true);
  });
});

describe("a disco ball's cascade", () => {
  it("mints no bombs and no disco balls, whatever falls in", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const e = new Match3Engine({ rng: mulberry32(seed) });
      e.initFill();
      e.grid[4][3]!.special = "disco";
      const minted: string[] = [];
      e.drain(e.resolveSwap(4, 3, 4, 4), (p) => {
        if (p.type === "clear") for (const m of p.minted) minted.push(m.what);
      });
      expect(minted.filter((w) => w === "bomb" || w === "disco"), `seed ${seed}`).toEqual([]);
    }
  });
});

describe("the crazy combo", () => {
  it("bomb into bomb purges both colours and counts up", () => {
    const e = board();
    e.grid[3][3]!.special = "bomb";
    e.grid[3][4]!.special = "bomb";
    const c1 = e.grid[3][3]!.res, c2 = e.grid[3][4]!.res;
    const before = e.gems().filter((g) => g.res === c1 || g.res === c2).length;
    const phases = drain(e, e.resolveSwap(3, 3, 3, 4));
    const blast = phases.find((p) => p.type === "bombClear") as unknown as { removed: unknown[]; label: string };
    expect(blast.label).toBe("CRAZY COMBO ×1!");
    expect(blast.removed.length).toBe(before);
    expect(e.crazyCount).toBe(1);
  });
});

describe("specials on frost", () => {
  it("a 4-run with a frozen middle still leaves its line gem", () => {
    const e = board();
    for (const c of [0, 1, 2, 3]) e.grid[6][c]!.res = "sheep";
    e.grid[6][2]!.hard = 1;
    const clear = e.resolve(e.findGroups(), {}, 1);
    expect(clear.minted.filter((m) => m.what === "line").length).toBe(1);
  });
});
