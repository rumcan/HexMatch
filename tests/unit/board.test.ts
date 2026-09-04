import { describe, it, expect, vi } from "vitest";
import { Board } from "../../src/game/board";
import { setRng, mulberry32, BOARD_W, BOARD_H } from "../../src/game/config";

function freshBoard() {
  setRng(mulberry32(1234));
  return new Board();
}

describe("Board initial fill", () => {
  it("fills a full grid with no pre-existing matches", () => {
    const b = freshBoard();
    let n = 0;
    for (let r = 0; r < BOARD_H; r++) for (let c = 0; c < BOARD_W; c++) {
      expect(b.grid[r][c]).not.toBeNull();
      n++;
    }
    expect(n).toBe(BOARD_W * BOARD_H);
    expect(b.findGroups().length).toBe(0);
  });
});

describe("match detection", () => {
  it("finds horizontal and vertical runs of 3+", () => {
    const b = freshBoard();
    b.grid[0][0]!.res = "wood";
    b.grid[0][1]!.res = "wood";
    b.grid[0][2]!.res = "wood";
    b.grid[1][0]!.res = "ore";
    b.grid[2][0]!.res = "ore";
    b.grid[3][0]!.res = "ore";
    const groups = b.findGroups();
    expect(groups.length).toBe(2);
  });

  it("treats gold gems as wildcards", () => {
    const b = freshBoard();
    b.grid[4][4]!.res = "wood";
    b.grid[4][5]!.res = "gold";
    b.grid[4][6]!.res = "wood";
    const groups = b.findGroups();
    expect(groups.some((g) => g.length >= 3)).toBe(true);
  });

  it("ignores blocked gems", () => {
    const b = freshBoard();
    b.grid[2][2]!.res = "wood"; b.grid[2][2]!.block = true;
    b.grid[2][3]!.res = "wood";
    b.grid[2][4]!.res = "wood";
    expect(b.findGroups().length).toBe(0);
  });
});

describe("settle / swap", () => {
  it("harvests tiered gems from a match and removes them", async () => {
    const b = freshBoard();
    const harvests: [ResKey, number][] = [];
    b.onHarvest = (res, amt) => harvests.push([res, amt]);
    // craft a row: tiered wood, wood, wood
    b.grid[0][0]!.res = "wood"; b.grid[0][0]!.tier = 1;
    b.grid[0][1]!.res = "wood";
    b.grid[0][2]!.res = "wood";
    await b.settle();
    expect(harvests.some(([r, n]) => r === "wood" && n === 1)).toBe(true);
  });

  it("reverts a swap that creates no match", async () => {
    const b = freshBoard();
    // trySwap(r1, c1, r2, c2, now): adjacent cells chosen to avoid matches;
    // if no match forms the swap must revert to the original layout.
    let reverted = false;
    outer:
    for (let r = 0; r < BOARD_H; r++) {
      for (let c = 0; c < BOARD_W - 1; c++) {
        const before = [b.grid[r][c]!.res, b.grid[r][c + 1]!.res];
        await b.trySwap(r, c, r, c + 1, 1);
        const after = [b.grid[r][c]!.res, b.grid[r][c + 1]!.res];
        if (after.join(",") === before.join(",")) { reverted = true; break outer; }
      }
    }
    expect(reverted).toBe(true);
  });

  it("banks combos and mints a gold coin every two", () => {
    const b = freshBoard();
    const combos: [number, number, boolean][] = [];
    b.onCombo = (count, need, granted) => combos.push([count, need, granted]);
    b.registerCombo();
    expect(combos[0]).toEqual([1, 2, false]);
    b.registerCombo();
    expect(combos[1][2]).toBe(true);
    expect(b.gems().some((g) => g.res === "gold")).toBe(true);
  });

  // W5: the board must TELL the world when it banks a coin. The gold gem on
  // the board is cosmetic; `onGold(1)` is the wire the purse (and therefore
  // the Black Market) listens to. Without it "2 combos = 1 gold" is a lie.
  it("fires onGold exactly once per banked coin", () => {
    const b = freshBoard();
    const gold: number[] = [];
    b.onGold = (n) => gold.push(n);
    b.registerCombo();
    expect(gold).toEqual([]);
    b.registerCombo();
    expect(gold).toEqual([1]);
    b.registerCombo();
    b.registerCombo();
    expect(gold).toEqual([1, 1]);
  });
});

describe("obstacles", () => {
  it("smashBlocks removes blocks and thaws frost", () => {
    const b = freshBoard();
    b.grid[0][0]!.block = true;
    b.grid[1][1]!.hard = 2;
    const n = b.smashBlocks();
    expect(n).toBe(2);
    expect(b.grid[0][0] === null || b.grid[0][0]!.block === false).toBe(true);
  });

  it("fog blocks swaps until it expires", async () => {
    const b = freshBoard();
    b.fog(1000, 1);
    const changed = vi.fn();
    b.onChange = changed;
    await b.trySwap(0, 0, 0, 1, 500);
    expect(changed).not.toHaveBeenCalled();
  });
});

describe("deadlock guard", () => {
  it("hasMove detects at least one board move", () => {
    const b = freshBoard();
    // fresh boards are reshuffled to always have a move
    expect(b.hasMove()).toBe(true);
  });
});
