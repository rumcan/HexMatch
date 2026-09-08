// ══════════════════════════════════════════════════════════════════════════
// J1 — the iso market: bank exchange, escrowed offers, and the rival's answer.
//
// These are the same rules `trade.test.ts` proves for the legacy market; what
// is new here is that the iso game drives them over ITS OWN record (the player
// purses) instead of the old global dispatcher.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach } from "vitest";
import { createIsoMarket, emptyBag, toBag, AI_TRADE_MS } from "../../src/iso/market";
import { BANK_RATE, MAX_OFFERS } from "../../src/game/trade";
import { CARGOES, type Cargo } from "../../src/iso/config";

function setup(you: Partial<Record<Cargo, number>> = {}, ai: Partial<Record<Cargo, number>> = {}) {
  const purses = [toBag({ stone: 12, ore: 0, ...you }), toBag({ stone: 4, ore: 3, ...ai })];
  const market = createIsoMarket([
    { i: 0, id: "you", name: "You", human: true, purse: purses[0] },
    { i: 1, id: "ai", name: "Rival", human: false, purse: purses[1] },
  ]);
  return { market, me: market.players[0], rival: market.players[1], purses };
}

let s: ReturnType<typeof setup>;
beforeEach(() => { s = setup(); });

describe("J1 market setup", () => {
  it("gives every player a full cargo bag with no missing keys", () => {
    const bag = emptyBag();
    expect(Object.keys(bag).sort()).toEqual([...CARGOES].sort());
    expect(toBag({ stone: 12 }).stone).toBe(12);
    expect(toBag({ stone: 12 }).grain).toBe(0);
  });

  it("trades the SAME purse object the game holds — one owner, no copy", () => {
    expect(s.market.players[0].res).toBe(s.purses[0]);
  });
});

describe("J1 bank exchange", () => {
  it(`converts ${BANK_RATE} of one cargo into 1 of another`, () => {
    expect(s.market.bank(s.me, "stone", "ore")).toBe(true);
    expect(s.me.res.stone).toBe(12 - BANK_RATE);
    expect(s.me.res.ore).toBe(1);
  });

  it("refuses a cargo you cannot cover, and a self-trade", () => {
    s.me.res.oil = 1;
    expect(s.market.bank(s.me, "oil", "ore")).toBe(false);
    expect(s.market.bank(s.me, "stone", "stone")).toBe(false);
    expect(s.me.res.oil).toBe(1);
  });
});

describe("J1 offers", () => {
  it("escrows on post and refunds on withdraw", () => {
    expect(s.market.post(s.me, "stone", 3, "ore", 2)).toBe(true);
    expect(s.me.res.stone).toBe(9);
    expect(s.market.live(s.me)).toHaveLength(1);

    const id = s.market.live(s.me)[0].id;
    expect(s.market.cancel(s.me, id)).toBe(true);
    expect(s.me.res.stone).toBe(12);
    expect(s.market.ctx.offers).toHaveLength(0);
  });

  it(`caps a player at ${MAX_OFFERS} live offers`, () => {
    for (let i = 0; i < MAX_OFFERS; i++) expect(s.market.post(s.me, "stone", 1, "ore", 1)).toBe(true);
    expect(s.market.post(s.me, "stone", 1, "ore", 1)).toBe(false);
  });

  it("cannot post what you do not have", () => {
    expect(s.market.post(s.me, "oil", 1, "ore", 1)).toBe(false);
    expect(s.market.ctx.offers).toHaveLength(0);
  });
});

describe("J1 the rival answers", () => {
  it("takes a fair offer it can afford, paying out of its own purse", () => {
    s.market.post(s.me, "stone", 2, "ore", 2);      // rival: −2 ore, +2 stone
    expect(s.market.ctx.offers).toHaveLength(1);

    s.market.tick(performance.now() + AI_TRADE_MS);

    expect(s.market.ctx.offers).toHaveLength(0);
    expect(s.me.res.ore).toBe(2);
    expect(s.me.res.stone).toBe(10);
    expect(s.rival.res.ore).toBe(1);
    expect(s.rival.res.stone).toBe(6);
  });

  it("leaves an offer it cannot pay, and one that costs it units", () => {
    s.market.post(s.me, "stone", 1, "ore", 99);     // unaffordable
    s.market.tick(performance.now() + AI_TRADE_MS);
    expect(s.market.ctx.offers).toHaveLength(1);

    s.market.cancel(s.me, s.market.live(s.me)[0].id);
    s.market.post(s.me, "stone", 1, "ore", 2);      // pays 2, gets 1 → refuses
    s.market.tick(performance.now() + AI_TRADE_MS * 2);
    expect(s.market.ctx.offers).toHaveLength(1);
    expect(s.rival.res.ore).toBe(3);
  });

  it("does not answer before its clock comes round", () => {
    s.market.post(s.me, "stone", 2, "ore", 2);
    s.market.tick(performance.now() + 10);
    expect(s.market.ctx.offers).toHaveLength(1);
  });

  it("refunds escrow when an offer expires untaken", () => {
    s = setup({ ore: 2 });
    // the rival holds no oil, so it can never pay `want` — the offer must rot
    expect(s.market.post(s.me, "ore", 2, "oil", 1)).toBe(true);
    expect(s.me.res.ore).toBe(0);

    s.market.tick(performance.now() + 60_000);      // past OFFER_LIFE

    expect(s.market.ctx.offers).toHaveLength(0);
    expect(s.me.res.ore).toBe(2);                   // escrow refunded
    expect(s.rival.res.oil).toBe(0);                // nothing was traded
  });
});

// ══════════════════════════════════════════════════════════════════════════
// PP-08 — Gold is reserved for Black Market sabotage. The market never
// converts it: not at the bank (4:1 would mint construction stock from
// coins), not through offers in either direction, and not through the
// rival's answering clock. Gold is earned by processing and spent only on
// the sabotage actions.
// ══════════════════════════════════════════════════════════════════════════
describe("PP-08 gold never trades", () => {
  it("creates the market with gold on the blocked list", () => {
    expect([...s.market.ctx.blocked]).toEqual(["gold"]);
  });

  it("the bank refuses gold in either direction, even with coins in the purse", () => {
    s.me.res.gold = 20;
    expect(s.market.bank(s.me, "gold", "stone")).toBe(false);   // gold → stock
    expect(s.market.bank(s.me, "stone", "gold")).toBe(false);   // stock → gold
    expect(s.me.res.gold).toBe(20);                 // nothing moved
    expect(s.me.res.stone).toBe(12);
  });

  it("offers involving gold are refused even with gold in the purse", () => {
    s.me.res.gold = 9;
    expect(s.market.post(s.me, "gold", 1, "ore", 1)).toBe(false);   // giving gold
    expect(s.market.post(s.me, "ore", 1, "gold", 1)).toBe(false);   // wanting gold
    expect(s.me.res.gold).toBe(9);                  // nothing escrowed
    expect(s.me.res.ore).toBe(0);
    expect(s.market.ctx.offers).toHaveLength(0);
  });

  it("the AI taker refuses a gold offer even if one lands on the board", () => {
    // Inject past the composer (postOffer would refuse it) to prove the
    // ACCEPT side enforces the rule too — that is the path the rival's
    // answering clock drives, and the path a rogue multiplayer guest would hit.
    s.market.ctx.offers.unshift({
      id: 999, from: 0, give: "gold", giveN: 1, want: "stone", wantN: 1,
      born: performance.now(),
    });
    s.me.res.gold = 1;

    s.market.tick(performance.now() + AI_TRADE_MS);

    expect(s.rival.res.gold).toBe(0);               // rival never gained gold
    expect(s.rival.res.stone).toBe(4);              // rival never paid
    expect(s.me.res.gold).toBe(1);
    expect(s.market.ctx.offers).toHaveLength(1);    // the offer just sits there
  });
});
