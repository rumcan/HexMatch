// ══════════════════════════════════════════════════════════════════════════
// TRADE (owner call, 2026-09) — the offer board, restored beside the bank.
// Pinned against `src/iso/offers.ts`: escrow on post, the swap on accept,
// refunds on cancel and expiry, the Gold ban, the seat cap, the rival's
// policy, and the wire (clock-free, mirrored for the guest).
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import {
  createOfferBook, postOffer, acceptOffer, cancelOffer, expireOffers, liveOffers,
  rivalWouldAccept, chooseRivalOffer, offersToWire, offersFromWire,
  MAX_OFFERS, OFFER_LIFE_MS, type Offer, type Purse,
} from "../../src/iso/offers";

const purses = (): [Purse, Purse] => [
  { wood: 10, stone: 10, ore: 0, grain: 5, oil: 0, gold: 5 },
  { wood: 0, stone: 2, ore: 6, grain: 5, oil: 3, gold: 5 },
];

describe("TRADE the offer book", () => {
  it("posting escrows the give at once", () => {
    const book = createOfferBook();
    const [you] = purses();
    const o = postOffer(book, you, 0, "wood", 4, "ore", 2, 0) as Offer;
    expect(typeof o).toBe("object");
    expect(you.wood).toBe(6);
    expect(liveOffers(book, 0)).toHaveLength(1);
  });

  it("accepting swaps the goods: taker pays the want, receives the escrow", () => {
    const book = createOfferBook();
    const ps = purses();
    const o = postOffer(book, ps[0], 0, "wood", 4, "ore", 2, 0) as Offer;
    expect(acceptOffer(book, ps, 1, o.id)).toMatchObject({ id: o.id });
    expect(ps[0]).toMatchObject({ wood: 6, ore: 2 });
    expect(ps[1]).toMatchObject({ wood: 4, ore: 4 });
    expect(book.offers).toHaveLength(0);
  });

  it("refuses: your own offer, a taker who cannot pay, a missing id", () => {
    const book = createOfferBook();
    const ps = purses();
    const o = postOffer(book, ps[0], 0, "wood", 2, "oil", 9, 0) as Offer;
    expect(acceptOffer(book, ps, 0, o.id)).toBe("own");
    expect(acceptOffer(book, ps, 1, o.id)).toBe("short");
    expect(acceptOffer(book, ps, 1, 999)).toBe("missing");
    expect(ps[1].oil).toBe(3);                      // nothing moved
  });

  it("cancel refunds the escrow; only the poster may cancel", () => {
    const book = createOfferBook();
    const ps = purses();
    const o = postOffer(book, ps[0], 0, "wood", 4, "ore", 2, 0) as Offer;
    expect(cancelOffer(book, ps[1], 1, o.id)).toBe("not-yours");
    expect(cancelOffer(book, ps[0], 0, o.id)).toMatchObject({ id: o.id });
    expect(ps[0].wood).toBe(10);
  });

  it("expiry refunds the escrow after the offer's life", () => {
    const book = createOfferBook();
    const ps = purses();
    postOffer(book, ps[0], 0, "wood", 4, "ore", 2, 1000);
    expect(expireOffers(book, ps, 1000 + OFFER_LIFE_MS)).toHaveLength(0);
    expect(expireOffers(book, ps, 1001 + OFFER_LIFE_MS)).toHaveLength(1);
    expect(ps[0].wood).toBe(10);
  });

  it("Gold never trades, same-for-same is refused, lots are bounded", () => {
    const book = createOfferBook();
    const [you] = purses();
    expect(postOffer(book, you, 0, "gold", 1, "ore", 1, 0)).toBe("gold");
    expect(postOffer(book, you, 0, "wood", 1, "gold", 1, 0)).toBe("gold");
    expect(postOffer(book, you, 0, "wood", 1, "wood", 1, 0)).toBe("same");
    expect(postOffer(book, you, 0, "wood", 0, "ore", 1, 0)).toBe("lot");
    expect(postOffer(book, you, 0, "wood", 1.5, "ore", 1, 0)).toBe("lot");
    expect(postOffer(book, you, 0, "wood", 11, "ore", 1, 0)).toBe("short");
    expect(you.wood).toBe(10);
  });

  it(`a seat holds at most ${MAX_OFFERS} live offers`, () => {
    const book = createOfferBook();
    const [you] = purses();
    for (let i = 0; i < MAX_OFFERS; i++) expect(typeof postOffer(book, you, 0, "wood", 1, "ore", 1, 0)).toBe("object");
    expect(postOffer(book, you, 0, "wood", 1, "ore", 1, 0)).toBe("full");
  });
});

describe("TRADE the rival's policy", () => {
  it("takes a deal it can pay that does not lose units or eat its own need", () => {
    const o: Offer = { id: 1, from: 0, give: "wood", giveN: 3, want: "ore", wantN: 2, born: 0 };
    expect(rivalWouldAccept({ ore: 6 }, o)).toBe(true);
    expect(rivalWouldAccept({ ore: 1 }, o)).toBe(false);                   // cannot pay
    expect(rivalWouldAccept({ ore: 6 }, { ...o, giveN: 1 })).toBe(false);  // loses units
    expect(rivalWouldAccept({ ore: 3 }, o, { ore: 2 })).toBe(false);       // eats its need
  });

  it("posts toward its shortest need from its biggest surplus, never Gold", () => {
    const idea = chooseRivalOffer({ wood: 12, stone: 1, gold: 50 }, { ore: 1, oil: 2, wood: 1 });
    expect(idea).toMatchObject({ give: "wood", want: "oil" });
    expect(idea!.giveN).toBeGreaterThanOrEqual(idea!.wantN);
    expect(chooseRivalOffer({ gold: 50 }, { ore: 2 })).toBeNull();          // gold is not a surplus
    expect(chooseRivalOffer({ wood: 9 }, {})).toBeNull();                   // nothing needed
  });
});

describe("TRADE the wire", () => {
  it("carries time LEFT, so the guest's countdown is right on its own clock", () => {
    const book = createOfferBook();
    const [you] = purses();
    postOffer(book, you, 0, "wood", 2, "ore", 1, 5_000);
    const wire = JSON.parse(JSON.stringify(offersToWire(book, 15_000)));
    expect(wire[0].left).toBe(OFFER_LIFE_MS - 10_000);
    const guest = offersFromWire(wire, true, 900_000);
    expect(900_000 - guest[0].born).toBe(10_000);                           // same age, other clock
  });

  it("the guest mirrors the seats: the host's offer is the guest's rival's", () => {
    const book = createOfferBook();
    const ps = purses();
    postOffer(book, ps[0], 0, "wood", 2, "ore", 1, 0);
    postOffer(book, ps[1], 1, "ore", 2, "wood", 1, 0);
    const guest = offersFromWire(offersToWire(book, 0), true, 0);
    expect(guest.map((o) => [o.give, o.from])).toEqual([["ore", 0], ["wood", 1]]);
    expect(offersFromWire(offersToWire(book, 0), false, 0).map((o) => o.from)).toEqual([1, 0]);
  });

  it("drops malformed rows instead of trusting them", () => {
    expect(offersFromWire([{ id: 1, from: 3, give: "wood", giveN: 1, want: "ore", wantN: 1, left: 1 }], true, 0)).toEqual([]);
    expect(offersFromWire([{ id: 1, from: 0, give: "nope", giveN: 1, want: "ore", wantN: 1, left: 1 }], true, 0)).toEqual([]);
    expect(offersFromWire("x", true, 0)).toEqual([]);
  });
});

describe("TRADE + B6 ride every delta, not only full states", () => {
  it("buildPublish carries the offer book and the battle layer", async () => {
    const { buildPublish } = await import("../../src/net/delta");
    const { createTrack, DirtyTiles } = await import("../../src/iso/track");
    const book = createOfferBook();
    const [you] = purses();
    postOffer(book, you, 0, "wood", 2, "ore", 1, 0);
    const battle = { locks: [], readyAt: [], playerReadyAt: [], rivalReadyAt: 0, battles: 3 };
    const d = buildPublish(createTrack(), new DirtyTiles(), {
      t: 1, seq: 1, harvesters: [], factories: [], players: [], setupPhase: false, won: false,
      offers: offersToWire(book, 0), battle,
    });
    expect(d.kind).toBe("delta");
    if (d.kind !== "delta") throw new Error("unreachable");
    expect(d.msg.offers).toHaveLength(1);
    expect(d.msg.battle).toMatchObject({ battles: 3 });
  });
});
