// ══════════════════════════════════════════════════════════════════════════
// B1 (#246) — the battle engine: turn-based shared match-3 board.
//
// The acceptance block, pinned against the live engine:
//
//   • turn passing (and a dud swap NOT passing it — a turn is one LEGAL swap);
//   • extra turns: a 4+ run, a special shape, a cascade of 2+ passes;
//   • mana gain per colour, mapped through GEM_TO_CARGO (brick→stone, …),
//     and the per-cargo cap;
//   • damage: a detonated bomb's sweep hits the opponent per gem purged;
//   • reshuffle on no moves, without passing the turn;
//   • win by health, win by turn limit (and the draw);
//   • determinism: replaying a recorded move list from the same seed gives an
//     identical state — and a restored snapshot continues identically.
//
// Fixtures paint over a seeded board like `board.test.ts` does (hands on
// `grid[r][c].res`), so every scenario is a known shape before the swap.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi } from "vitest";
import { createBattle, type Battle, type BattleMove } from "../../src/game/battle";
import type { PassReport } from "../../src/game/board";
import type { ResKey } from "../../src/game/config";
import { BATTLE_RULES, type BattleRules } from "../../src/iso/config";

const players: [BattleContender, BattleContender] = [
  { id: "you", name: "You" },
  { id: "ai", name: "Rival" },
];
type BattleContender = { id: string; name: string };

const rulesFor = (over: Partial<BattleRules> = {}): BattleRules => ({ ...BATTLE_RULES, ...over });

function freshBattle(seed: number, over: Partial<BattleRules> = {}): Battle {
  return createBattle({ seed, players, rules: rulesFor(over) });
}

/**
 * A two-colour checkerboard has no matches anywhere — a clean table to plant
 * fixtures on (same trick as `board.test.ts`'s cross fixtures).
 */
function checker(b: Battle, a: ResKey = "wheat", z: ResKey = "ore"): void {
  for (const g of b.board.gems()) g.res = (g.r + g.c) % 2 ? z : a;
}

const at = (b: Battle, r: number, c: number, res: ResKey) => { b.board.grid[r][c]!.res = res; };

describe("B1 battle engine — turns", () => {
  it("a legal 3-match swap resolves and passes the turn", async () => {
    // seed 2: the fixture's refill lands no cascade — exactly one pass of 3
    const b = freshBattle(2);
    checker(b);
    // row 0: wood wood · and a third wood one row below the hole at (0,2)
    at(b, 0, 0, "wood"); at(b, 0, 1, "wood"); at(b, 1, 2, "wood");
    expect(b.board.findGroups()).toHaveLength(0);

    const out = await b.playSwap(1, 2, 0, 2, 0);
    expect(out.ok).toBe(true);
    expect(out.passes.map((p: PassReport) => p.biggest)).toEqual([3]);
    expect(b.state.turn).toBe(1);
    expect(b.state.turns).toBe(1);
    expect(b.state.players[0].extraTurn).toBe(false);
    expect(b.moves).toHaveLength(1);
  });

  it("a dud swap is refused and the turn does not pass", async () => {
    const b = freshBattle(7);
    checker(b); // a checkerboard swap never matches
    const before = JSON.stringify(b.board.save());
    const out = await b.playSwap(0, 0, 0, 1, 0);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("no-match");
    expect(b.state.turn).toBe(0);
    expect(b.state.turns).toBe(0);
    expect(b.moves).toHaveLength(0);
    // the board reverted — nothing changed
    expect(JSON.stringify(b.board.save())).toBe(before);
  });

  it("refuses non-adjacent swaps, blocked cells and play after the end", async () => {
    const b = freshBattle(7);
    checker(b);
    expect((await b.playSwap(0, 0, 2, 2, 0)).reason).toBe("illegal");
    b.board.grid[0][0]!.block = true;
    expect((await b.playSwap(0, 0, 0, 1, 0)).reason).toBe("illegal");
    b.board.grid[0][0]!.block = false;
    b.state.over = true;
    expect((await b.playSwap(0, 0, 0, 1, 0)).reason).toBe("over");
  });
});

describe("B1 battle engine — extra turns", () => {
  it("a 4-match grants an extra turn (the turn does not pass)", async () => {
    const b = freshBattle(7);
    checker(b);
    // wood pair at (0,0)-(0,1), a hole at (0,2), a fourth wood at (0,3) —
    // the swap brings the third arm of a 4-run into the hole
    at(b, 0, 0, "wood"); at(b, 0, 1, "wood"); at(b, 0, 3, "wood"); at(b, 1, 2, "wood");
    expect(b.board.findGroups()).toHaveLength(0);

    const out = await b.playSwap(1, 2, 0, 2, 0);
    expect(out.ok).toBe(true);
    expect(out.extraTurn).toBe(true);
    expect(b.state.turn).toBe(0);
    expect(b.state.players[0].extraTurn).toBe(true);
  });

  it("a special shape (L) grants an extra turn on its own", async () => {
    const b = freshBattle(7);
    checker(b);
    // The L: a 3-run across (0,0)-(0,2) and a 3-run down (0,0)-(2,0),
    // sharing only the corner gem — two same-colour groups of 3, union 5.
    // They stand on the board (this is the shape half of `PassReport.shaped`);
    // the swap below only trips the settle that resolves them.
    at(b, 0, 0, "wood"); at(b, 0, 1, "wood"); at(b, 0, 2, "wood");
    at(b, 1, 0, "wood"); at(b, 2, 0, "wood");

    const out = await b.playSwap(6, 0, 6, 1, 0);
    expect(out.ok).toBe(true);
    const matches = out.passes.filter((p: PassReport) => p.biggest > 0);
    expect(matches.some((p: PassReport) => p.shaped)).toBe(true);
    // the L's runs are 3s — no 4+ anywhere in the first pass, so the shape is
    // a live extra-turn trigger (later refill cascades may stack on top)
    expect(matches[0].biggest).toBe(3);
    expect(out.extraTurn).toBe(true);
    expect(b.state.turn).toBe(0);
  });

  it("a cascade of 2+ passes grants an extra turn", async () => {
    const b = freshBattle(7);
    checker(b);
    // Row 3 will clear wheat wheat wheat via the swap; the ore pair above
    // falls onto the waiting ore at (3,0) and matches a second time — a
    // gravity-born cascade, pass 2. (See the fall map in the PR.)
    at(b, 2, 2, "ore");            // falls to (3,2) beside (3,0)
    at(b, 2, 3, "wheat");          // falls to (3,3) — must NOT extend the ore run
    at(b, 3, 2, "wheat");          // the run's middle
    at(b, 3, 3, "ore");            // the hole (not wheat) …
    at(b, 4, 2, "ore");            // keep row 4 from reading wheat wheat wheat
    at(b, 4, 3, "wheat");          // … filled from below by this wheat
    expect(b.board.findGroups()).toHaveLength(0);

    const out = await b.playSwap(4, 3, 3, 3, 0);
    expect(out.ok).toBe(true);
    const matches = out.passes.filter((p: PassReport) => p.biggest > 0);
    expect(matches.length).toBeGreaterThanOrEqual(2); // the cascade happened
    expect(out.extraTurn).toBe(true);
    expect(b.state.turn).toBe(0);
    expect(b.state.players[0].extraTurn).toBe(true);
  });
});

describe("B1 battle engine — mana", () => {
  it("banks mana of the cleared gems' cargo to the mover (wood→wood)", async () => {
    // seed 2: one clean pass, exactly the fixture's 3 woods clear
    const b = freshBattle(2);
    checker(b);
    at(b, 0, 0, "wood"); at(b, 0, 1, "wood"); at(b, 1, 2, "wood");
    const out = await b.playSwap(1, 2, 0, 2, 0);
    expect(out.ok).toBe(true);
    expect(out.passes.reduce((s, p) => s + (p.cleared.wood ?? 0), 0)).toBe(3);
    expect(out.mana.wood).toBe(3);
    expect(b.state.players[0].mana.wood).toBe(3);
    expect(b.state.players[1].mana.wood).toBe(0);
  });

  it("maps gem colours onto cargoes (brick→stone)", async () => {
    const b = freshBattle(2);
    checker(b);
    at(b, 0, 0, "brick"); at(b, 0, 1, "brick"); at(b, 1, 2, "brick");
    const out = await b.playSwap(1, 2, 0, 2, 0);
    expect(out.ok).toBe(true);
    expect(out.mana.stone).toBe(3); // bricks bank STONE, not some brick cargo
    expect(b.state.players[0].mana.stone).toBe(3);
  });

  it("caps each cargo's bank at rules.manaCap", async () => {
    const b = freshBattle(2, { manaCap: 2, manaPerGem: 1 });
    checker(b);
    at(b, 0, 0, "wood"); at(b, 0, 1, "wood"); at(b, 1, 2, "wood");
    const out = await b.playSwap(1, 2, 0, 2, 0);
    expect(out.ok).toBe(true);
    // the fixture clears 3 woods — two fit under the cap
    expect(out.mana.wood).toBe(2);
    expect(b.state.players[0].mana.wood).toBe(2);
  });
});

describe("B1 battle engine — damage", () => {
  it("a detonated bomb damages the opponent per gem its blast purges", async () => {
    const b = freshBattle(7);
    checker(b, "ore", "ore"); // a still table of one colour …
    // … with a known number of wheat gems scattered on it (the blast's fuel)
    for (const [r, c] of [[5, 0], [5, 2], [5, 4], [6, 1], [6, 3], [0, 1]] as const) {
      at(b, r, c, "wheat");
    }
    // the bomb at (0,0) swaps with its wheat neighbour — a detonation
    const g = b.board.grid[0][0]!;
    g.special = "bomb";
    const wheat = b.board.gems().filter((x) => x.res === "wheat").length;
    expect(wheat).toBe(6);

    const out = await b.playSwap(0, 0, 0, 1, 0);
    expect(out.ok).toBe(true);
    expect(out.damage).toBe(wheat * b.rules.damagePerGem);
    expect(b.state.players[1].health).toBe(b.rules.startHealth - out.damage);
    expect(b.state.players[0].health).toBe(b.rules.startHealth);
  });

  it("win by health: the blast that empties the opponent wins for the mover", async () => {
    const b = freshBattle(7);
    checker(b, "ore", "ore");
    for (const [r, c] of [[5, 0], [5, 2], [5, 4], [6, 1], [6, 3], [0, 1]] as const) {
      at(b, r, c, "wheat");
    }
    b.board.grid[0][0]!.special = "bomb";
    const wheat = b.board.gems().filter((x) => x.res === "wheat").length;
    b.state.players[1].health = wheat * b.rules.damagePerGem; // exactly lethal

    const out = await b.playSwap(0, 0, 0, 1, 0);
    expect(out.ok).toBe(true);
    expect(b.state.players[1].health).toBe(0);
    expect(out.winner).toBe(0);
    expect(b.state.winner).toBe(0);
    expect(b.state.over).toBe(true);
  });
});

describe("B1 battle engine — reshuffle and the turn limit", () => {
  it("no legal move → reshuffle, without passing the turn", async () => {
    const b = freshBattle(7);
    const fx: string[] = [];
    b.board.onFx = (t) => { fx.push(t); };
    vi.spyOn(b.board, "hasMove").mockReturnValue(false);
    const turnBefore = b.state.turn;
    const turnsBefore = b.state.turns;

    await b.ensureMove();

    expect(fx).toContain("bad");        // reshuffle's marker
    expect(b.state.turn).toBe(turnBefore);
    expect(b.state.turns).toBe(turnsBefore);
    expect(b.moves).toHaveLength(0);    // a reshuffle is not a move
  });

  it("win by turn limit: the higher health wins; equal health is a draw", async () => {
    const b = freshBattle(7, { turnLimit: 2 });
    b.state.players[0].health = 25;
    b.state.players[1].health = 20;
    // two ordinary legal swaps — the board is seeded, `findMove` agrees with
    // `trySwap` (AI-03d's one rule)
    for (let i = 0; i < 2; i++) {
      const mv = b.board.findMove()!;
      expect(mv).not.toBeNull();
      const out = await b.playSwap(mv[0], mv[1], mv[2], mv[3], 0);
      expect(out.ok).toBe(true);
    }
    expect(b.state.turns).toBe(2);
    expect(b.state.over).toBe(true);
    expect(b.state.winner).toBe(0);

    const d = freshBattle(7, { turnLimit: 2 });
    d.state.players[0].health = 20;
    d.state.players[1].health = 20;
    for (let i = 0; i < 2; i++) {
      const mv = d.board.findMove()!;
      await d.playSwap(mv[0], mv[1], mv[2], mv[3], 0);
    }
    expect(d.state.over).toBe(true);
    expect(d.state.winner).toBeNull(); // draw
  });
});

describe("B1 battle engine — determinism", () => {
  it("replaying a recorded move list from the same seed gives identical state", async () => {
    const a = freshBattle(42);
    for (let i = 0; i < 8 && !a.state.over; i++) {
      const mv = a.board.findMove();
      if (!mv) break;
      await a.playSwap(mv[0], mv[1], mv[2], mv[3], 0);
    }
    const script: BattleMove[] = a.moves.map((m) => ({ ...m }));
    expect(script.length).toBeGreaterThan(3);

    const replay = freshBattle(42);
    for (const m of script) {
      if (m.t !== "swap") continue;
      await replay.playSwap(m.r1, m.c1, m.r2, m.c2, 0);
    }
    expect(replay.moves).toEqual(script);
    expect(replay.save()).toEqual(a.save());
  });

  it("a restored snapshot continues the same run (RNG stream included)", async () => {
    const a = freshBattle(99);
    for (let i = 0; i < 3; i++) {
      const mv = a.board.findMove()!;
      await a.playSwap(mv[0], mv[1], mv[2], mv[3], 0);
    }
    const snap = a.save();

    const resumed = freshBattle(99);
    resumed.restore(snap);
    expect(resumed.state.turn).toBe(a.state.turn);
    expect(resumed.board.save()).toEqual(a.board.save());

    // both runs continue with the same two moves
    const next: [number, number, number, number][] = [];
    for (let i = 0; i < 2; i++) {
      const mv = a.board.findMove()!;
      next.push(mv);
      await a.playSwap(mv[0], mv[1], mv[2], mv[3], 0);
    }
    for (const mv of next) {
      // the board after restore is identical, so the same moves are legal
      expect(resumed.board.grid[mv[0]][mv[1]]).toBeTruthy();
      await resumed.playSwap(mv[0], mv[1], mv[2], mv[3], 0);
    }
    expect(resumed.save()).toEqual(a.save());
  });

  it("the battle's RNG never leaks: the world's stream is put back", async () => {
    const { getRng, setRng, mulberry32 } = await import("../../src/game/config");
    const world = mulberry32(5);
    setRng(world);
    const before = getRng();
    const b = freshBattle(7);
    await b.playSwap(0, 0, 0, 1, 0);
    expect(getRng()).toBe(before);
  });
});
