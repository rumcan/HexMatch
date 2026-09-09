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

  // N3: gold is no longer a wildcard. It is its own colour — it completes
  // only runs of gold, and never finishes another colour's run.
  it("N3: gold is its own colour — it matches only gold", () => {
    const b = freshBoard();
    // gold between two woods must NOT complete a wood match any more
    b.grid[4][4]!.res = "wood";
    b.grid[4][5]!.res = "gold";
    b.grid[4][6]!.res = "wood";
    expect(b.findGroups().some((g) => g.length >= 3)).toBe(false);
    // …but three golds in a row are a plain gold match
    b.grid[2][2]!.res = "gold";
    b.grid[2][3]!.res = "gold";
    b.grid[2][4]!.res = "gold";
    const groups = b.findGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].every((g) => g.res === "gold")).toBe(true);
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

  // Combos bank a coin every two and hand it straight to the purse via
  // `onGold(1)` (W5). A combo never mints a gold GEM on the board — the old
  // in-place `spawnGold` conversion (turn a random resource gem into gold) is
  // gone, so a banked coin must not rewrite an existing lumber/ore gem.
  it("match 5 in a line grants two random materials", async () => {
    const b = freshBoard();
    const bonus: string[] = [];
    b.onBonus = (res, n, why) => bonus.push(`${why}:${res}:${n}`);
    const harvests: [string, number][] = [];
    b.onHarvest = (res, amt) => { harvests.push([res, amt]); };
    for (let c = 0; c < 5; c++) b.grid[0][c]!.res = "wood";
    b.grid[0][5]!.res = "ore";
    b.grid[0][6]!.res = "brick";
    await b.settle();
    expect(bonus.some((s) => s.startsWith("MATCH 5:"))).toBe(true);
    expect(bonus).toHaveLength(2);
  });

  it("an L of five grants two random materials", async () => {
    const b = freshBoard();
    const bonus: string[] = [];
    b.onBonus = (_r, _n, why) => bonus.push(why);
    // 3 across + 3 down sharing corner = 5 unique
    b.grid[1][1]!.res = "sheep";
    b.grid[1][2]!.res = "sheep";
    b.grid[1][3]!.res = "sheep";
    b.grid[2][1]!.res = "sheep";
    b.grid[3][1]!.res = "sheep";
    // break other accidental matches
    b.grid[0][1]!.res = "ore";
    b.grid[1][0]!.res = "ore";
    b.grid[1][4]!.res = "ore";
    b.grid[4][1]!.res = "ore";
    await b.settle();
    expect(bonus.filter((w) => w === "L-SHAPE").length).toBeGreaterThanOrEqual(2);
  });

  it("combos pay the purse every two and never convert a resource gem into a gold gem", () => {
    const b = freshBoard();
    const gold: number[] = [];
    b.onGold = (n) => gold.push(n);
    const combos: [number, number, boolean][] = [];
    b.onCombo = (count, need, granted) => combos.push([count, need, granted]);
    b.registerCombo();
    expect(combos[0]).toEqual([1, 2, false]);
    expect(gold).toEqual([]);
    b.registerCombo();
    expect(combos[1][2]).toBe(true);
    expect(gold).toEqual([1]);                                   // the purse was paid…
    expect(b.gems().some((g) => g.res === "gold")).toBe(false);  // …no board gem minted
  });
});

// Gold reaches the Processing Plant board ONLY by dropping in from the top
// (setGoldEnabled → the gravity pool). It is never created by rewriting an
// existing resource gem in place.
describe("gold gems only fall in from the top — never replace a resource gem", () => {
  it("spawnTokens upgrades an existing gold gem, not a different-colour gem", () => {
    const b = freshBoard();
    b.setGoldEnabled(true);          // a depot sits beside a gold mine
    b.resetNeutral();                // refill draws gold from the pool
    const goldCount = b.gems().filter((g) => g.res === "gold").length;
    expect(goldCount).toBeGreaterThan(0);

    // reachable gold → the 20s spawn upgrades one gold gem in place (tier 1)
    b.spawnTokens({ gold: 1 });
    expect(b.gems().filter((g) => g.res === "gold")).toHaveLength(goldCount); // no new gold
    expect(b.gems().filter((g) => g.res === "gold" && g.tier === 1)).toHaveLength(1);
  });

  it("spawnTokens never turns a non-gold gem into gold when no gold gem exists", () => {
    const b = freshBoard();               // base pool has no gold
    expect(b.gems().some((g) => g.res === "gold")).toBe(false);
    // pretend gold is reachable but no gold gem has fallen in yet
    b.spawnTokens({ gold: 1 });
    expect(b.gems().some((g) => g.res === "gold")).toBe(false);   // wood/ore stay put
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
