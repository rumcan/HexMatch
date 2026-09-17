// ══════════════════════════════════════════════════════════════════════════
// L11 (#226) — the bank, alone.
//
// The ticket keeps ONE exchange in the game and deletes the other. What this
// file pins, in order:
//
//   • the purse helpers every caller hands around (`emptyBag` / `toBag`) are
//     complete bags, not sparse records;
//   • 3:1 moves exactly one cargo (L17 #245: the owner's rate, one constant), from the caller's own purse (the module
//     owns no balance — `market.ts` used to build one over the same record,
//     and that indirection is gone);
//   • every refusal leaves the purse UNTOUCHED: same cargo, self-trade, a
//     purse that cannot cover the lot, a rate that is not a positive number;
//   • PP-08 — Gold never trades, in either direction, at any rung, even with
//     coins in the purse;
//   • THE GATE (acceptance 1 of the ticket): a seat may only exchange cargos
//     whose `DEPOT_TREE` rung it has unlocked. Rung 0 = grain/wood, rung 1
//     adds stone/ore, rung 2 adds oil. This is the bypass the ticket exists
//     to close — before it, `bankTrade` turned a pile of Wood straight into
//     Oil, and no tuning session was ever played for the rung.
//
// The shipped loop has no tree. Its callers pass no `unlocked`, and the bank
// must behave exactly as it always did — the last test is that equivalence,
// so a later change cannot make the legacy game stricter by accident.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import {
  BANK_RATE, SABOTAGE_ONLY, bankAllowed, bankTier, bankTrade, emptyBag, isCargo, toBag,
  type CargoBag,
} from "../../src/iso/bank";
import { CARGOES, DEPOT_TREE, DEPOT_TREE_ORDER, type Cargo } from "../../src/iso/config";

const bag = (over: Partial<Record<Cargo, number>> = {}): CargoBag => toBag(over);

describe("the purse helpers", () => {
  it("gives every cargo a key — a full bag, no missing reads", () => {
    for (const b of [emptyBag(), toBag({ wood: 3 })]) {
      for (const c of CARGOES) expect(typeof b[c], `${c} missing`).toBe("number");
    }
    expect(emptyBag()).toEqual(Object.fromEntries(CARGOES.map((c) => [c, 0])));
    expect(toBag({ wood: 3 }).wood).toBe(3);
    expect(toBag({ wood: 3 }).ore).toBe(0);
  });

  it("knows the six cargos and nothing else", () => {
    for (const c of CARGOES) expect(isCargo(c)).toBe(true);
    expect(isCargo("gold ")).toBe(false);
    expect(isCargo("silver")).toBe(false);
  });
});

describe("the exchange", () => {
  it(`converts ${BANK_RATE} of one cargo into 1 of another`, () => {
    const purse = bag({ wood: BANK_RATE });
    expect(bankTrade(purse, "wood", "stone")).toBe(true);
    expect(purse.wood).toBe(0);
    expect(purse.stone).toBe(1);
  });

  it("honours a rate override — the legacy 1:1 is data, not a fork", () => {
    const purse = bag({ wood: 1 });
    expect(bankTrade(purse, "wood", "grain", { rate: 1 })).toBe(true);
    expect(purse.wood).toBe(0);
    expect(purse.grain).toBe(1);
  });

  it("refuses a self-trade, and a purse that cannot cover the lot", () => {
    const purse = bag({ wood: BANK_RATE - 1, stone: 2 });
    const before = { ...purse };
    expect(bankTrade(purse, "wood", "wood")).toBe(false);
    expect(bankTrade(purse, "wood", "stone")).toBe(false);   // one short
    expect(bankTrade(purse, "stone", "wood", { rate: 0 })).toBe(false);
    expect(bankTrade(purse, "stone", "wood", { rate: -2 })).toBe(false);
    expect(purse).toEqual(before);
  });

  it("refuses Gold in either direction, coins or no coins (PP-08)", () => {
    expect([...SABOTAGE_ONLY]).toEqual(["gold"]);
    const purse = bag({ gold: 99, wood: 99 });
    const before = { ...purse };
    expect(bankTrade(purse, "gold", "wood")).toBe(false);
    expect(bankTrade(purse, "wood", "gold")).toBe(false);
    expect(purse).toEqual(before);
  });
});

describe("L11 (#226) — the rung gate", () => {
  /** The cargos `unlocked` rungs may be exchanged, in the TREE's own order. */
  const open = (unlocked: number | null): Cargo[] =>
    DEPOT_TREE_ORDER.filter((c) => bankAllowed(c, unlocked));

  it("reads its numbers off DEPOT_TREE — one source, not a second table", () => {
    for (const c of CARGOES) expect(bankTier(c)).toBe(DEPOT_TREE[c].tier);
  });

  it("opens rung by rung: grain/wood, then stone/ore, then oil", () => {
    expect(open(0)).toEqual(["grain", "wood"]);
    expect(open(1)).toEqual(["grain", "wood", "stone", "ore"]);
    expect(open(2)).toEqual(["grain", "wood", "stone", "ore", "oil"]);
    // Fractional rungs floor; a nonsense negative one clamps to rung 0 rather
    // than opening a rung below the table or closing the bank entirely.
    expect(open(0.7)).toEqual(["grain", "wood"]);
    expect(open(-1)).toEqual(["grain", "wood"]);
  });

  it("the bypass the ticket closed: no rung bought with Wood can arrive", () => {
    // A seat at rung 0 with a mountain of Wood, and what it may NOT buy with it.
    for (const locked of ["stone", "ore", "oil"] as Cargo[]) {
      const purse = bag({ wood: 400 });
      const before = { ...purse };
      expect(bankTrade(purse, "wood", locked, { unlocked: 0 }), `${locked} skipped a rung`).toBe(false);
      expect(purse).toEqual(before);
      // …and it cannot sell the rung it has not reached back into Wood either.
      expect(bankTrade(purse, locked, "grain", { unlocked: 0 })).toBe(false);
    }
    // Wood → Grain (rung 0 → rung 0) still works: the bank rebalances, it does
    // not stop being a bank.
    const purse = bag({ wood: BANK_RATE });
    expect(bankTrade(purse, "wood", "grain", { unlocked: 0 })).toBe(true);
    expect(purse.grain).toBe(1);
  });

  it("a rung-1 seat still cannot reach Oil, and a rung-2 seat can", () => {
    const one = bag({ ore: 4 });
    expect(bankTrade(one, "ore", "oil", { unlocked: 1 })).toBe(false);
    expect(one.oil).toBe(0);
    const two = bag({ ore: 4 });
    expect(bankTrade(two, "ore", "oil", { unlocked: 2 })).toBe(true);
    expect(two.oil).toBe(1);
  });

  it("Gold stays out even at the deepest rung", () => {
    const purse = bag({ oil: 4, gold: 4 });
    expect(bankTrade(purse, "oil", "gold", { unlocked: 2 })).toBe(false);
    expect(bankTrade(purse, "gold", "oil", { unlocked: 2 })).toBe(false);
    expect(purse).toEqual(bag({ oil: 4, gold: 4 }));
  });

  it("no tree (the shipped loop) is the behaviour the game shipped with", () => {
    // Every cargo but Gold, at the same 3:1 — the legacy bank, unchanged.
    expect(open(null)).toEqual(DEPOT_TREE_ORDER.filter((c) => c !== "gold"));
    const purse = bag({ wood: 400 });
    expect(bankTrade(purse, "wood", "oil")).toBe(true);       // the old rule
    expect(bankTrade(purse, "wood", "gold")).toBe(false);     // PP-08, always
    const explicit = bag({ wood: 400 });
    expect(bankTrade(explicit, "wood", "oil", { unlocked: null })).toBe(true);
  });
});
