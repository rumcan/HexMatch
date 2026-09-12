import { describe, it, expect, vi } from "vitest";
import { Board, type Gem } from "../../src/game/board";
import { setRng, mulberry32, randInt, BOARD_W, BOARD_H, type ResKey } from "../../src/game/config";

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

  // PP-14: the cross is the shape with a saint on the payroll — 3 horizontal
  // + 4 vertical overlapping on ONE gem (the centre of the 3-run, an
  // interior gem of the 4-run). It pauses the cascade, asks the player how
  // to spend SIX units of blessing (repeats allowed — 6 of one, 3+3, one of
  // each, any mix), then pays exactly that allocation, never gated by the
  // network. Before PP-14 the L detector swallowed crosses and reported them
  // as L-SHAPEs paying two. PP-14b adds the BROKEN holy cross — two 3-runs
  // crossing on their centre gems — which pays THREE units.
  it("a cross of six (3 across + 4 down) pays each of the six picked cargoes", async () => {
    const b = freshBoard();
    const bonus: string[] = [];
    b.onBonus = (res, n, why) => bonus.push(`${why}:${res}:${n}`);
    const crosses: [number, number][] = [];
    b.onFx = (type, r, c) => { if (type === "cross") crosses.push([r, c]); };
    let picked: string[] = [];
    b.onCrossChoice = (kind, picks, pick) => {
      picked = ["wood", "brick", "sheep", "wheat", "ore", "wood"]; // 6, one repeat
      pick([...picked]);
    };
    // 3 horizontal + 4 vertical, overlapping on the centre gem (2,2)
    b.grid[2][1]!.res = "sheep";
    b.grid[2][2]!.res = "sheep";
    b.grid[2][3]!.res = "sheep";
    b.grid[1][2]!.res = "sheep";
    b.grid[3][2]!.res = "sheep";
    b.grid[4][2]!.res = "sheep";
    // stop both arms and fence the sheep in so pass 1 is exactly this cross
    for (const [r, c] of [[2, 0], [2, 4], [0, 2], [5, 2], [1, 1], [1, 3], [3, 1], [3, 3], [4, 1], [4, 3]]) {
      b.grid[r][c]!.res = "ore";
    }
    // `resolve` runs synchronously — the angel fires before the choice
    const p = b.settle();
    expect(crosses).toEqual([[2, 2]]);
    expect(picked).toEqual(["wood", "brick", "sheep", "wheat", "ore", "wood"]);
    // the awaited choice credits in a microtask, before the 190ms pop pause
    await new Promise((r) => setTimeout(r, 0));
    expect(bonus).toEqual([
      "HOLY CROSS:wood:1", "HOLY CROSS:brick:1", "HOLY CROSS:sheep:1",
      "HOLY CROSS:wheat:1", "HOLY CROSS:ore:1", "HOLY CROSS:wood:1",
    ]);
    await p;
  });

  it("a short pick list is topped up to six, honouring every pick", async () => {
    const b = freshBoard();
    const bonus: [string, number][] = [];
    b.onBonus = (res, n) => bonus.push([res, n]);
    b.onCrossChoice = (_kind, _picks, pick) => pick(["wood", "wood"]);
    b.grid[2][1]!.res = "sheep";
    b.grid[2][2]!.res = "sheep";
    b.grid[2][3]!.res = "sheep";
    b.grid[1][2]!.res = "sheep";
    b.grid[3][2]!.res = "sheep";
    b.grid[4][2]!.res = "sheep";
    for (const [r, c] of [[2, 0], [2, 4], [0, 2], [5, 2], [1, 1], [1, 3], [3, 1], [3, 3], [4, 1], [4, 3]]) {
      b.grid[r][c]!.res = "ore";
    }
    const p = b.settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(bonus).toHaveLength(6);
    // BOTH picks are honoured — the random top-up can only ever add wood,
    // never take the two the player was promised away.
    expect(bonus.filter(([res]) => res === "wood").length).toBeGreaterThanOrEqual(2);
    await p;
  });

  it("all six of a single cargo is a valid spend", async () => {
    const b = freshBoard();
    const bonus: [string, number][] = [];
    b.onBonus = (res, n) => bonus.push([res, n]);
    b.onCrossChoice = (_kind, _picks, pick) => pick(["wood", "wood", "wood", "wood", "wood", "wood"]);
    b.grid[2][1]!.res = "sheep";
    b.grid[2][2]!.res = "sheep";
    b.grid[2][3]!.res = "sheep";
    b.grid[1][2]!.res = "sheep";
    b.grid[3][2]!.res = "sheep";
    b.grid[4][2]!.res = "sheep";
    for (const [r, c] of [[2, 0], [2, 4], [0, 2], [5, 2], [1, 1], [1, 3], [3, 1], [3, 3], [4, 1], [4, 3]]) {
      b.grid[r][c]!.res = "ore";
    }
    const p = b.settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(bonus).toEqual([["wood", 1], ["wood", 1], ["wood", 1], ["wood", 1], ["wood", 1], ["wood", 1]]);
    await p;
  });

  it("with no chooser wired the cross still pays six cargoes", async () => {
    const b = freshBoard();
    const bonus: [string, number][] = [];
    b.onBonus = (res, n) => bonus.push([res, n]);
    b.grid[2][1]!.res = "sheep";
    b.grid[2][2]!.res = "sheep";
    b.grid[2][3]!.res = "sheep";
    b.grid[1][2]!.res = "sheep";
    b.grid[3][2]!.res = "sheep";
    b.grid[4][2]!.res = "sheep";
    for (const [r, c] of [[2, 0], [2, 4], [0, 2], [5, 2], [1, 1], [1, 3], [3, 1], [3, 3], [4, 1], [4, 3]]) {
      b.grid[r][c]!.res = "ore";
    }
    const p = b.settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(bonus).toHaveLength(6);
    await p;
  });

  it("a broken cross (3×3 sharing the centre) pays three units and fires bcross", async () => {
    const b = freshBoard();
    const bonus: string[] = [];
    b.onBonus = (res, n, why) => bonus.push(`${why}:${res}:${n}`);
    const fx: [string, number, number][] = [];
    b.onFx = (type, r, c) => { if (type === "cross" || type === "bcross") fx.push([type, r, c]); };
    let picked: string[] = [];
    b.onCrossChoice = (kind, picks, pick) => { picked = ["wood", "stone", "stone"]; pick([...picked]); };
    // 3 horizontal + 3 vertical, both centred on (2,2) — a small plus.
    b.grid[2][1]!.res = "sheep";
    b.grid[2][2]!.res = "sheep";
    b.grid[2][3]!.res = "sheep";
    b.grid[1][2]!.res = "sheep";
    b.grid[3][2]!.res = "sheep";
    // fence the plus in so pass 1 is exactly this cross
    for (const [r, c] of [[2, 0], [2, 4], [0, 2], [4, 2], [1, 1], [1, 3], [3, 1], [3, 3]]) {
      b.grid[r][c]!.res = "ore";
    }
    // keep (4,1)/(4,3) off ore so the (4,2) fence never forms a 3-run
    b.grid[4][1]!.res = "wheat";
    b.grid[4][3]!.res = "wheat";
    const p = b.settle();
    expect(fx).toEqual([["bcross", 2, 2]]);
    expect(picked).toEqual(["wood", "stone", "stone"]);
    await new Promise((r) => setTimeout(r, 0));
    expect(bonus).toEqual(["BROKEN CROSS:wood:1", "BROKEN CROSS:stone:1", "BROKEN CROSS:stone:1"]);
    await p;
  });

  it("a broken cross topped up to three with no chooser pays three", async () => {
    const b = freshBoard();
    const bonus: [string, number][] = [];
    b.onBonus = (res, n) => bonus.push([res, n]);
    b.grid[2][1]!.res = "sheep";
    b.grid[2][2]!.res = "sheep";
    b.grid[2][3]!.res = "sheep";
    b.grid[1][2]!.res = "sheep";
    b.grid[3][2]!.res = "sheep";
    for (const [r, c] of [[2, 0], [2, 4], [0, 2], [4, 2], [1, 1], [1, 3], [3, 1], [3, 3]]) {
      b.grid[r][c]!.res = "ore";
    }
    b.grid[4][1]!.res = "wheat";
    b.grid[4][3]!.res = "wheat";
    const p = b.settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(bonus).toHaveLength(3);
    await p;
  });

  it("the same cross rotated — 4 across + 3 down — is holy too", async () => {
    const b = freshBoard();
    const crosses: [number, number][] = [];
    b.onFx = (type, r, c) => { if (type === "cross") crosses.push([r, c]); };
    b.grid[2][0]!.res = "sheep";
    b.grid[2][1]!.res = "sheep";
    b.grid[2][2]!.res = "sheep";
    b.grid[2][3]!.res = "sheep";
    b.grid[1][1]!.res = "sheep";
    b.grid[3][1]!.res = "sheep";
    for (const [r, c] of [[1, 0], [3, 0], [1, 3], [3, 3], [2, 4], [0, 1], [1, 2], [3, 2], [4, 1]]) {
      b.grid[r][c]!.res = "ore";
    }
    const p = b.settle();
    expect(crosses).toEqual([[2, 1]]);      // the crossing gem
    await p;
  });

  it("a T-shape is not a cross: it stays an L-SHAPE", async () => {
    const b = freshBoard();
    const bonus: string[] = [];
    b.onBonus = (_r, _n, why) => bonus.push(why);
    // horizontal arm shares its centre with the END of the vertical arm
    b.grid[2][1]!.res = "sheep";
    b.grid[2][2]!.res = "sheep";
    b.grid[2][3]!.res = "sheep";
    b.grid[3][2]!.res = "sheep";
    b.grid[4][2]!.res = "sheep";
    const p = b.settle();
    expect(bonus.filter((w) => w === "L-SHAPE").length).toBe(2);
    expect(bonus).not.toContain("HOLY CROSS");
    await p;
  });

  it("a 4-run sharing its END with a 3-run is a T with a tail, not a cross", async () => {
    const b = freshBoard();
    const bonus: string[] = [];
    b.onBonus = (_r, _n, why) => bonus.push(why);
    // 3 horizontal + 4 vertical, but the shared gem is the FIRST gem of the
    // vertical run — the crossing sits on the end, so it is not holy.
    b.grid[2][1]!.res = "sheep";
    b.grid[2][2]!.res = "sheep";
    b.grid[2][3]!.res = "sheep";
    b.grid[3][2]!.res = "sheep";
    b.grid[4][2]!.res = "sheep";
    b.grid[5][2]!.res = "sheep";
    for (const [r, c] of [[2, 0], [2, 4], [1, 1], [1, 3], [3, 1], [3, 3], [4, 1], [4, 3], [5, 1], [5, 3], [6, 2]]) {
      b.grid[r][c]!.res = "ore";
    }
    b.grid[1][2]!.res = "wood";
    const p = b.settle();
    expect(bonus.filter((w) => w === "L-SHAPE").length).toBe(2);
    expect(bonus).not.toContain("HOLY CROSS");
    await p;
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

// ══════════════════════════════════════════════════════════════════════════
// A1 — the arcade callouts.
//
// The board fired `onFx` for every pop, crack, token-up, bomb and callout and
// NOTHING had ever assigned it, so all of it was dead. These tests pin the
// part that is the board's job: WHAT it says, and WHEN. (That the UI is on the
// other end of the wire is iso-game.test.ts's problem — this is the half that
// would still be wrong with a perfect UI.)
// ══════════════════════════════════════════════════════════════════════════
describe("arcade callouts (A1)", () => {
  /** Every callout the board shouts, in order. */
  function callouts(b: import("../../src/game/board").Board): [string, string][] {
    const out: [string, string][] = [];
    b.onFx = (type, _r, _c, text) => {
      if (type === "chain" || type === "combo") out.push([type, text ?? ""]);
    };
    return out;
  }

  /** A horizontal run of three at the top-left, clear of anything else. */
  function threeInARow(b: import("../../src/game/board").Board) {
    b.grid[0][0]!.res = "wood";
    b.grid[0][1]!.res = "wood";
    b.grid[0][2]!.res = "wood";
    b.grid[0][3]!.res = "ore";      // stop the run at three
  }

  it("shouts MATCH! for a plain 3-match — the old gate was chain >= 2", async () => {
    const b = freshBoard();
    const fx = callouts(b);
    threeInARow(b);
    // NOT awaited: `resolve` runs synchronously, before the 190ms pop pause
    // and before gravity. This is the whole point — the callout used to fire
    // ~400ms late (after gravity), and only from the second cascade onwards.
    const p = b.settle();
    expect(fx).toEqual([["chain", "MATCH!"]]);
    await p;
  });

  it("escalates: the second pass is COMBO x2, the third is CHAIN x3!!", async () => {
    const b1 = freshBoard();
    const fx1 = callouts(b1);
    threeInARow(b1);
    await b1.settle(1);             // startCascade 1 → the first pass is chain 2
    expect(fx1[0]).toEqual(["combo", "COMBO x2"]);

    const b2 = freshBoard();
    const fx2 = callouts(b2);
    threeInARow(b2);
    await b2.settle(2);             // what a bomb's settle() starts at
    expect(fx2[0]).toEqual(["combo", "CHAIN x3!!"]);
  });

  it("a match-5 keeps its own name, and names the cascade too when there is one", async () => {
    const b = freshBoard();
    const fx = callouts(b);
    for (let c = 0; c < 5; c++) b.grid[0][c]!.res = "wood";
    b.grid[0][5]!.res = "ore";
    b.grid[0][6]!.res = "brick";
    await b.settle();
    expect(fx[0]).toEqual(["chain", "MATCH 5"]);

    const b2 = freshBoard();
    const fx2 = callouts(b2);
    for (let c = 0; c < 5; c++) b2.grid[0][c]!.res = "wood";
    b2.grid[0][5]!.res = "ore";
    b2.grid[0][6]!.res = "brick";
    await b2.settle(1);
    expect(fx2[0]).toEqual(["combo", "MATCH 5 · COMBO x2"]);
  });

  it("fires exactly one callout per cascade pass, at the matched group", () => {
    const b = freshBoard();
    const at: [number, number][] = [];
    b.onFx = (type, r, c) => { if (type === "chain" || type === "combo") at.push([r, c]); };
    threeInARow(b);
    const p = b.settle();
    // one pass, one callout — the old code could fire two (the shape label and
    // the chain label) on top of each other on the same cell
    expect(at).toHaveLength(1);
    expect(at[0][0]).toBe(0);        // the matched row
    return p;
  });

  it("a tokenless cascade still pops its COMBO label — an empty gains used to silence it", async () => {
    const b = freshBoard();
    const pops: [Record<string, number>, string][] = [];
    b.onPopup = (gains, label) => pops.push([{ ...gains }, label]);
    threeInARow(b);                  // three plain gems: no tokens, no gains
    await b.settle(1);
    expect(pops.some(([, label]) => label === "COMBO x2")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AI-03d — `findMove`, `hasMove` and the board must agree on what a MOVE is.
//
// The rival's autoplayer (`rivalAutoplay` in iso/game.ts) asks `findMove` for a
// swap every `skill().moveMs` and hands the answer straight to `trySwap`.
// `findMove` counted a run through ANY same-coloured neighbour, but the board's
// own `lineRuns` only walks `matchable` cells — so an iron girder or a bomb
// sitting INSIDE a line breaks it however the colours read. The two oracles
// disagreed, `trySwap` found no group and reverted; a revert changes nothing,
// so the next tick asked the same board the same question and got the same
// doomed cells back. One dead swap, replayed every moveMs for the rest of the
// match — "the rival is stuck doing the same match-3 move that doesn't work".
// Sabotage is what puts a `block` gem mid-line, so a plant the player had just
// bought girders for was the one the rival stalled on, and because the seek
// scores tokens, the dead swap it locked onto was usually a TOKENED one: ranked
// above every real move on the board, so the stall cost income too.
// ══════════════════════════════════════════════════════════════════════════
describe("findMove agrees with the board (AI-03d)", () => {
  const CYCLE: ResKey[] = ["wood", "brick", "sheep", "wheat", "ore"];
  /** What the rival's seek scores: tokens by tier, plain gems as nothing. */
  const seek = (g: Gem) => g.tier ?? 0;

  /**
   * A board stamped with a layout that has no match AND no move: colour steps 1
   * across and 2 down a five-colour cycle, so no three cells in either axis ever
   * agree. A test then places the one shape it is about.
   */
  function deadBoard(seed = 7): Board {
    setRng(mulberry32(seed));
    const b = new Board();
    for (let r = 0; r < BOARD_H; r++) for (let c = 0; c < BOARD_W; c++) {
      const g = b.grid[r][c]!;
      g.res = CYCLE[(r * 2 + c) % CYCLE.length];
      g.tier = 0; g.hard = 0; g.block = false; g.special = null;
    }
    expect(b.findGroups(), "the stamped layout must start match-free").toHaveLength(0);
    expect(b.hasMove(), "the stamped layout must start move-free").toBe(false);
    return b;
  }

  /** A REAL move to contrast the trap with: wood at (6,0), (6,1) and (7,2)
   *  leaves the board still match-free but playable — swapping a wood up into
   *  row 6 makes three. Without it "findMove returned null" would prove
   *  nothing; with it, null (or the trap) is the bug. */
  function withRealMove(b: Board): void {
    b.grid[6][0]!.res = "wood";
    b.grid[6][1]!.res = "wood";
    b.grid[7][2]!.res = "wood";
    expect(b.findGroups(), "the contrast board must not already be matched").toHaveLength(0);
    expect(b.hasMove(), "the contrast board must be playable").toBe(true);
  }

  /** The contract the rival plays by: whatever `findMove` returns, `trySwap`
   *  CARRIES OUT — the group it promised is really there, or the swap moves a
   *  bomb (which detonates on any swap). Anything else is a reverted move, and
   *  a reverted move is the one the rival would replay forever. */
  function carriedOut(b: Board, mv: [number, number, number, number]): boolean {
    const [r1, c1, r2, c2] = mv;
    const a = b.grid[r1][c1], d = b.grid[r2][c2];
    if (!a || !d || a.block || d.block) return false;      // trySwap refuses it
    if (a.special === "bomb" || d.special === "bomb") return true;
    b.grid[r1][c1] = d; b.grid[r2][c2] = a;
    const groups = b.findGroups().length;
    b.grid[r1][c1] = a; b.grid[r2][c2] = d;
    return groups > 0;
  }

  /** The rival's cadence, replayed: `findMove` → `trySwap`, one move per tick.
   *  `refused` is every swap the board threw back (its `bad` fx) — the bug's
   *  signature — and `pops` is proof it was actually playing. */
  async function rivalLoop(b: Board, ticks: number) {
    const refused: string[] = [];
    const played: string[] = [];
    let pops = 0;
    b.onFx = (type, r, c) => {
      if (type === "bad") refused.push(`${r},${c}`);
      if (type === "pop") pops++;
    };
    for (let i = 0; i < ticks; i++) {
      const mv = b.findMove(seek);
      if (!mv) continue;
      played.push(mv.join(","));
      await b.trySwap(mv[0], mv[1], mv[2], mv[3], 10_000 + i * 3_000);
    }
    return { refused, played, pops };
  }

  /** Row 3 reads wood · wood(girder) · ore with a wood below the ore: the
   *  COLOURS say "swap the wood up for three in a row", the board says the
   *  girder breaks the line. [3,2,4,2] is the swap the rival replayed forever. */
  function girderTrap(b: Board): void {
    b.grid[3][0]!.res = "wood";
    b.grid[3][1]!.res = "wood"; b.grid[3][1]!.block = true;
    b.grid[3][2]!.res = "ore";
    b.grid[4][2]!.res = "wood";
    expect(b.findGroups(), "the girder breaks the line the colours promise").toHaveLength(0);
  }

  it("a girder inside the line is not a match — the trap is not a move", () => {
    const b = deadBoard();
    girderTrap(b);
    expect(b.hasMove(), "nothing on this board is playable").toBe(false);
    expect(b.findMove(), "the girder trap is not a move").toBeNull();
    expect(b.findMove(seek), "nor is it one the seeking rival may chase").toBeNull();
  });

  it("…and with a real move beside the trap, the rival plays the real one", () => {
    const b = deadBoard();
    withRealMove(b);
    girderTrap(b);
    const mv = b.findMove();
    expect(mv, "the real move is still on the board").not.toBeNull();
    expect(mv, "the girder trap is not a move").not.toEqual([3, 2, 4, 2]);
    expect(carriedOut(b, mv!), `offered ${mv}, which trySwap reverts`).toBe(true);
  });

  it("a bomb inside the line is not a match either", () => {
    const b = deadBoard();
    withRealMove(b);
    // The same trap with a forged bomb as the middle "ore": a bomb is not
    // matchable, so it breaks the line exactly like a girder does.
    b.grid[3][0]!.res = "ore";
    b.grid[3][1]!.res = "ore"; b.grid[3][1]!.special = "bomb";
    b.grid[3][2]!.res = "wood";
    b.grid[4][2]!.res = "ore";
    const mv = b.findMove(seek);
    expect(mv).not.toBeNull();
    expect(mv, "a run through a bomb is not a run").not.toEqual([3, 2, 4, 2]);
    expect(carriedOut(b, mv!), `offered ${mv}, which trySwap reverts`).toBe(true);
  });

  it("the seek plays a real match instead of a TOKENED dead swap", () => {
    const b = deadBoard();
    withRealMove(b);
    // The trap, tokened: `findMove` scores the two swapped gems, so a tier-1
    // token on a dead swap outranked every plain real move on the board — the
    // rival locked onto this one and never played anything else again.
    b.grid[0][0]!.res = "ore"; b.grid[0][0]!.tier = 2;
    b.grid[0][1]!.res = "ore"; b.grid[0][1]!.block = true;
    b.grid[0][2]!.res = "brick";
    b.grid[1][2]!.res = "ore"; b.grid[1][2]!.tier = 1;
    const mv = b.findMove(seek);
    expect(mv).not.toBeNull();
    expect(mv, "the tokened girder trap is not a move").not.toEqual([0, 2, 1, 2]);
    expect(carriedOut(b, mv!), `offered ${mv}, which trySwap reverts`).toBe(true);
  });

  it("a sabotaged plant keeps playing — no dead swap, and gems actually pop", async () => {
    // The live shape of the report: a playable plant, a girder the player has
    // just bought mid-line, and a TOKEN on the dead swap that girder creates.
    // The seek scores tokens, so the dead swap outranked every real move on the
    // board — the rival replayed it every moveMs until the girder expired, and
    // earned nothing while it did. Six moves at the rival's cadence.
    const b = freshBoard();
    expect(b.hasMove(), "a fresh plant is playable").toBe(true);
    b.grid[0][0]!.res = "ore"; b.grid[0][0]!.tier = 2;
    b.grid[0][1]!.res = "ore"; b.grid[0][1]!.block = true;
    b.grid[0][2]!.res = "brick";
    b.grid[1][2]!.res = "ore"; b.grid[1][2]!.tier = 1;
    b.harden(4);
    expect(b.findGroups(), "the girder breaks the line the colours promise").toHaveLength(0);
    const { refused, played, pops } = await rivalLoop(b, 6);
    expect(refused, `the rival replayed dead swaps at ${refused.join(" / ")}`).toEqual([]);
    expect(played.length, "the rival never found a move to play").toBeGreaterThan(0);
    expect(new Set(played).size, "the rival asked for the same cells every tick").toBeGreaterThan(1);
    expect(pops, "the rival played six moves and cleared nothing").toBeGreaterThan(0);
  }, 30_000);

  it("a bomb IS a move: findMove offers the detonation when nothing matches", async () => {
    const b = deadBoard();
    const bomb = b.grid[4][3]!;
    bomb.special = "bomb";
    // hasMove counts a bomb as the board's escape hatch, so the deadlock guard
    // will never reshuffle while one sits there — findMove has to agree, or the
    // rival stalls on a board hasMove calls playable.
    expect(b.hasMove()).toBe(true);
    const mv = b.findMove(seek);
    expect(mv, "a bomb-only board is playable").not.toBeNull();
    const touches = (mv![0] === 4 && mv![1] === 3) || (mv![2] === 4 && mv![3] === 3);
    expect(touches, `offered ${mv} which does not detonate the bomb`).toBe(true);
    expect(carriedOut(b, mv!)).toBe(true);
    await b.trySwap(mv![0], mv![1], mv![2], mv![3], 50_000);
    expect(b.gems().includes(bomb), "the bomb was never detonated").toBe(false);
  }, 20_000);

  it("a bomb is only a move while it can be swapped — girders box it in", () => {
    const b = deadBoard();
    b.grid[4][3]!.special = "bomb";
    for (const [r, c] of [[4, 2], [4, 4], [3, 3], [5, 3]]) b.grid[r][c]!.block = true;
    // trySwap refuses a blocked cell, so this board has NO move at all: hasMove
    // claiming one kept the deadlock guard from ever rescuing it.
    expect(b.hasMove()).toBe(false);
    expect(b.findMove(seek)).toBeNull();
  });

  it("fuzz: on wrecked boards the oracles agree and every move offered works", () => {
    let asked = 0, offered = 0, wrecked = 0;
    for (let seed = 1; seed <= 150; seed++) {
      setRng(mulberry32(seed));
      const b = new Board();
      let girders = 0, bombs = 0;
      for (let r = 0; r < BOARD_H; r++) for (let c = 0; c < BOARD_W; c++) {
        const g = b.grid[r][c]!;
        // a match-free random colour, the way `initFill` deals one: a board
        // already mid-cascade is settle's business, not findMove's
        let res = CYCLE[randInt(CYCLE.length)];
        for (let t = 0; t < 25; t++) {
          const bad =
            (c >= 2 && b.grid[r][c - 1]!.res === res && b.grid[r][c - 2]!.res === res) ||
            (r >= 2 && b.grid[r - 1][c]!.res === res && b.grid[r - 2][c]!.res === res);
          if (!bad) break;
          res = CYCLE[randInt(CYCLE.length)];
        }
        g.res = res;
        g.tier = 0; g.hard = 0; g.block = false; g.special = null;
        const roll = randInt(100);
        if (roll < 9) { g.block = true; girders++; }              // a girder
        else if (roll < 13) { g.special = "bomb"; bombs++; }      // a forged bomb
        else if (roll < 33) g.tier = roll < 23 ? 1 : 2;           // a token
        else if (roll < 43) g.hard = 2;                           // frost
      }
      if (girders + bombs > 0) wrecked++;
      expect(b.findGroups(), `seed ${seed} dealt a board already matched`).toHaveLength(0);
      asked++;
      const mv = b.findMove(seek);
      if (mv) {
        offered++;
        expect(carriedOut(b, mv), `seed ${seed}: findMove offered a dead swap ${mv}`).toBe(true);
        expect(b.hasMove(), `seed ${seed}: offered ${mv} on a board hasMove calls dead`).toBe(true);
      }
      if (b.hasMove()) {
        expect(mv, `seed ${seed}: hasMove says playable, findMove found nothing`).not.toBeNull();
      }
    }
    // the fuzz has to actually fuzz: most boards are wrecked, most have a move
    expect(wrecked).toBeGreaterThan(100);
    expect(asked).toBeGreaterThan(100);
    expect(offered).toBeGreaterThan(50);
  });
});
