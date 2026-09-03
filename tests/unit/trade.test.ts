import { describe, it, expect, beforeEach } from "vitest";
import { generateMap } from "../../src/game/hexmap";
import { setRng, mulberry32 } from "../../src/game/config";
import { G, makePlayer, Player, Offer } from "../../src/game/state";
import { gainRes } from "../../src/game/actions";
import { postOffer, acceptOffer, cancelOffer, bankTrade, tickMarket, liveOffers } from "../../src/game/trade";

function setup() {
  setRng(mulberry32(7 ^ 0x5eed5));
  G.map = generateMap(7);
  G.players = [makePlayer(0, "You", true, "#fff"), makePlayer(1, "Rival", false, "#f00")];
  G.offers = [];
  G.offerSeq = 1;
  return G.players as Player[];
}
beforeEach(setup);

describe("postOffer", () => {
  it("escrows goods, rejects duplicates of self-trade, enforces the 3-offer cap", () => {
    const p = G.players[0];
    // postOffer(p, give, giveN, want, wantN): giving and wanting the same good is invalid
    expect(postOffer(p, "wood", 1, "wood", 1)).toBe(false);
    gainRes(p, "wood", 10);
    expect(postOffer(p, "wood", 2, "ore", 1)).toBe(true);
    expect(p.res.wood).toBe(8);
    expect(liveOffers(p).length).toBe(1);
    expect(postOffer(p, "wood", 1, "ore", 1)).toBe(true);
    expect(postOffer(p, "wood", 1, "ore", 1)).toBe(true);
    expect(postOffer(p, "wood", 1, "ore", 1)).toBe(false); // cap of 3
    expect(postOffer(p, "brick", 5, "ore", 1)).toBe(false); // can't afford
  });
});

describe("acceptOffer", () => {
  it("swaps goods between players and removes the offer", () => {
    const [p, rival] = G.players as Player[];
    gainRes(p, "wood", 5);
    postOffer(p, "wood", 2, "ore", 1);
    const id = (G.offers as Offer[])[0].id;
    expect(acceptOffer(rival, id)).toBe(false); // rival has no ore
    gainRes(rival, "ore", 3);
    expect(acceptOffer(rival, id)).toBe(true);
    expect(rival.res.wood).toBe(2);
    expect(p.res.ore).toBe(1);
    expect(rival.res.ore).toBe(2);
    expect(G.offers.length).toBe(0);
    // can't accept own offer
    gainRes(p, "wood", 5);
    postOffer(p, "wood", 1, "ore", 1);
    expect(acceptOffer(p, G.offers[0].id)).toBe(false);
  });
});

describe("cancelOffer", () => {
  it("refunds the escrow", () => {
    const p = G.players[0];
    gainRes(p, "wood", 5);
    postOffer(p, "wood", 3, "ore", 1);
    const id = G.offers[0].id;
    expect(cancelOffer(p, id)).toBe(true);
    expect(p.res.wood).toBe(5);
    expect(G.offers.length).toBe(0);
  });
});

describe("bankTrade", () => {
  it("converts 4 of one resource into 1 of another", () => {
    const p = G.players[0];
    gainRes(p, "wood", 4);
    expect(bankTrade(p, "wood", "wood")).toBe(false);
    expect(bankTrade(p, "wood", "ore")).toBe(true);
    expect(p.res.wood).toBe(0);
    expect(p.res.ore).toBe(1);
    expect(bankTrade(p, "wood", "ore")).toBe(false); // not enough
  });
});

describe("tickMarket", () => {
  it("refunds expired offers", () => {
    const p = G.players[0];
    gainRes(p, "wood", 5);
    postOffer(p, "wood", 2, "ore", 1);
    G.offers[0].born = 0;
    tickMarket(1e9);
    expect(G.offers.length).toBe(0);
    expect(p.res.wood).toBe(5);
  });
});
