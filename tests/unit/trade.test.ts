import { describe, it, expect, beforeEach } from "vitest";
import { setRng, mulberry32, RES_KEYS, type ResKey } from "../../src/game/config";
import {
  createMarket, postOffer, acceptOffer, cancelOffer, bankTrade, tickMarket,
  liveOffers, BANK_RATE, MAX_OFFERS,
  type Market, type MarketPlayer,
} from "../../src/game/trade";

// ══════════════════════════════════════════════════════════════════════════
// J2 rebase. These are the restored trading rules, unchanged in behaviour —
// but they no longer run against the deleted hex map or the deleted global
// dispatcher. The market record and the traders are built right here, which is
// exactly how the iso game drives them (`src/iso/market.ts`).
//
// No map is needed any more: trading never touched the grid, only the players'
// resource records. That is the point of the rebase — the hex `generateMap`
// import was the last thread tying this suite to `hexmap.ts`.
// ══════════════════════════════════════════════════════════════════════════

const emptyRes = () =>
  Object.fromEntries(RES_KEYS.map((k) => [k, 0])) as Record<ResKey, number>;

const makePlayer = (i: number, human: boolean): MarketPlayer<ResKey> => ({
  i, name: human ? "You" : "Rival", human, res: emptyRes(),
});

function setup() {
  setRng(mulberry32(7 ^ 0x5eed5));
  const market = createMarket<ResKey>();
  const players = [makePlayer(0, true), makePlayer(1, false)];
  return { market, players };
}

let market: Market<ResKey>;
let players: MarketPlayer<ResKey>[];
beforeEach(() => {
  ({ market, players } = setup());
});

const gainRes = (p: MarketPlayer<ResKey>, res: ResKey, n: number) => { p.res[res] += n; };

describe("postOffer", () => {
  it("escrows goods, rejects duplicates of self-trade, enforces the 3-offer cap", () => {
    const p = players[0];
    // giving and wanting the same good is invalid
    expect(postOffer(p, "wood", 1, "wood", 1, market)).toBe(false);
    gainRes(p, "wood", 10);
    expect(postOffer(p, "wood", 2, "ore", 1, market)).toBe(true);
    expect(p.res.wood).toBe(8);
    expect(liveOffers(p, market).length).toBe(1);
    expect(postOffer(p, "wood", 1, "ore", 1, market)).toBe(true);
    expect(postOffer(p, "wood", 1, "ore", 1, market)).toBe(true);
    expect(postOffer(p, "wood", 1, "ore", 1, market)).toBe(false); // cap of 3
    expect(MAX_OFFERS).toBe(3);
    expect(postOffer(p, "brick", 5, "ore", 1, market)).toBe(false); // can't afford
  });
});

describe("acceptOffer", () => {
  it("swaps goods between players and removes the offer", () => {
    const [p, rival] = players;
    gainRes(p, "wood", 5);
    postOffer(p, "wood", 2, "ore", 1, market);
    const id = market.offers[0].id;
    expect(acceptOffer(rival, id, players, market)).toBe(false); // rival has no ore
    gainRes(rival, "ore", 3);
    expect(acceptOffer(rival, id, players, market)).toBe(true);
    expect(rival.res.wood).toBe(2);
    expect(p.res.ore).toBe(1);
    expect(rival.res.ore).toBe(2);
    expect(market.offers.length).toBe(0);
    // can't accept own offer
    gainRes(p, "wood", 5);
    postOffer(p, "wood", 1, "ore", 1, market);
    expect(acceptOffer(p, market.offers[0].id, players, market)).toBe(false);
  });
});

describe("cancelOffer", () => {
  it("refunds the escrow", () => {
    const p = players[0];
    gainRes(p, "wood", 5);
    postOffer(p, "wood", 3, "ore", 1, market);
    const id = market.offers[0].id;
    expect(cancelOffer(p, id, market)).toBe(true);
    expect(p.res.wood).toBe(5);
    expect(market.offers.length).toBe(0);
  });
});

describe("bankTrade", () => {
  it(`converts ${BANK_RATE} of one resource into 1 of another`, () => {
    const p = players[0];
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
    const p = players[0];
    gainRes(p, "wood", 5);
    postOffer(p, "wood", 2, "ore", 1, market);
    market.offers[0].born = 0;
    tickMarket(1e9, players, market);
    expect(market.offers.length).toBe(0);
    expect(p.res.wood).toBe(5);
  });
});
