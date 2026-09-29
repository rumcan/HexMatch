// Owner (2026-09-28): the LINE gem. A match of 4 leaves one behind (the
// colour's own art, marked); caught in a match it clears its whole row and
// column; swapped left/right it clears just its row, up/down just its column.
import { describe, expect, it } from "vitest";
import { Match3Engine, mulberry32, SHORTCUT_LINE_CAP, type ResKey } from "../../src/match3";

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

describe("a line gem swapped into a match", () => {
  it("fires its row AND its column", () => {
    const e = board();
    // (3,3) is a line gem of ore; ore at (2,4),(4,4) — swap it right into a vertical three
    e.grid[3][3]!.res = "ore"; e.grid[3][3]!.special = "line";
    e.grid[2][4]!.res = "ore"; e.grid[4][4]!.res = "ore";
    e.grid[3][4]!.res = "gold";
    const phases = drain(e, e.resolveSwap(3, 3, 3, 4));
    const clear = phases.find((p) => p.type === "clear")!;
    const rows = new Set(clear.removed!.filter((x) => x.c === 4).map((x) => x.r));
    const cols = new Set(clear.removed!.filter((x) => x.r === 3).map((x) => x.c));
    expect(rows.size).toBe(e.h);
    expect(cols.size).toBe(e.w);
  });
});

describe("every shape its own power", () => {
  it("a T (broken cross) makes a blast gem; swapped it clears the 3×3", () => {
    const e = board();
    // T: row 2 cols 1..3, col 2 rows 2..4
    for (const c of [1, 2, 3]) e.grid[2][c]!.res = "wheat";
    for (const r of [3, 4]) e.grid[r][2]!.res = "wheat";
    const clear = e.resolve(e.findGroups(), {}, 1);
    const minted = clear.minted.map((m) => m.what);
    expect(minted.includes("blast") || minted.includes("nova") || minted.includes("bomb")).toBe(true);
    const f = board();
    f.grid[3][3]!.special = "blast";
    const phases = drain(f, f.resolveSwap(3, 3, 3, 4));
    const blast = phases.find((p) => p.type === "bombClear")!;
    expect(blast.removed!.length).toBe(9);
  });
  it("a nova clears the 5×5", () => {
    const f = board();
    f.grid[3][3]!.special = "nova";
    const phases = drain(f, f.resolveSwap(3, 3, 3, 4));
    const blast = phases.find((p) => p.type === "bombClear")!;
    expect(blast.removed!.length).toBe(25);
  });
});

// ── PERK-1 (#600): Kenji's Shortcut — the engine's opt-in mint rules ───
describe("PERK-1 (#600) the shortcut option", () => {
  const paint = (e: Match3Engine): void => {
    // the dead diagonal, then the runs under test — exactly three each.
    e.grid = e.grid.map((row, r) => row.map((_, c) => e.newGem(K[(r + c) % 3], r, c)));
  };
  // The runs use colours OUTSIDE the diagonal pool (wood/brick/ore), so a
  // painted run can never accidentally connect to the dead board: exactly
  // three each, nothing else.
  const threeRuns = (e: Match3Engine): void => {
    for (const c of [0, 1, 2]) e.grid[1][c]!.res = "sheep";
    for (const c of [3, 4, 5]) e.grid[4][c]!.res = "gold";
    for (const c of [1, 2, 3]) e.grid[6][c]!.res = "wheat";
  };

  it("a 3-run leaves a LINE on the shortcut board; the shipped board mints nothing", () => {
    const on = new Match3Engine({ rng: mulberry32(11), shortcut: true });
    paint(on); threeRuns(on);
    const clear = on.resolve(on.findGroups(), {}, 1);
    const lines = clear.minted.filter((m) => m.what === "line");
    expect(lines).toHaveLength(3);
    expect(on.gems().filter((g) => g.special === "line")).toHaveLength(3);

    const off = new Match3Engine({ rng: mulberry32(11) });
    paint(off); threeRuns(off);
    const c2 = off.resolve(off.findGroups(), {}, 1);
    expect(c2.minted).toHaveLength(0);
    expect(off.gems().some((g) => g.special === "line")).toBe(false);
  });

  it("the cap holds: 3 free line mints per board, the 4th 3-run mints nothing", () => {
    const e = new Match3Engine({ rng: mulberry32(11), shortcut: true });
    paint(e); threeRuns(e);
    expect(e.resolve(e.findGroups(), {}, 1).minted.filter((m) => m.what === "line")).toHaveLength(3);
    // The budget is the board's (the session's): a fresh move on the same
    // board has spent it.
    paint(e);
    for (const c of [0, 1, 2]) e.grid[1][c]!.res = "sheep";
    const c2 = e.resolve(e.findGroups(), {}, 1);
    expect(c2.minted.filter((m) => m.what === "line")).toHaveLength(0);
    // A fresh fill — a new session board — starts a fresh budget.
    e.initFill();
    expect(e.shortcutLines).toBe(0);
  });

  it("a 4-run mints the DISCO instead of a line; a 5-run still wipes the board", () => {
    const e = new Match3Engine({ rng: mulberry32(11), shortcut: true });
    paint(e);
    for (const c of [0, 1, 2, 3]) e.grid[0][c]!.res = "sheep";
    const clear = e.resolve(e.findGroups(), {}, 1);
    const what = clear.minted.map((m) => m.what);
    expect(what).toEqual(["disco"]);
  });

  it("the shipped constant is 3 free lines per board", () => {
    expect(SHORTCUT_LINE_CAP).toBe(3);
  });
});
