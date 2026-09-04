// ══════════════════════════════════════════════════════════════════════════
// J1 — the cargo market, iso-shaped.
//
// A thin wrapper over the restored, map-agnostic `src/game/trade.ts`: the iso
// game owns the resource records (the player purses, which stay the single
// owner of cargo), and this module owns nothing but the live offers plus the
// rival's response to them.
//
// Two ways to trade, both real:
//   • bank exchange — 4 of one cargo for 1 of another, always available;
//   • offers — post to the rival, who accepts on its own clock when the deal
//     is affordable and does not cost it units (see `rivalWouldAccept`).
// ══════════════════════════════════════════════════════════════════════════
import { OFFER_LIFE } from "../game/config";
import {
  BANK_RATE, acceptOffer, bankTrade, cancelOffer, createMarket, liveOffers,
  postOffer, tickMarket,
  type Market, type MarketPlayer, type TradeOffer,
} from "../game/trade";
import { CARGOES, type Cargo } from "./config";

/** A purse with every cargo key present — the shape the market arithmetic needs. */
export type CargoBag = Record<Cargo, number>;

export const emptyBag = (): CargoBag =>
  Object.fromEntries(CARGOES.map((c) => [c, 0])) as CargoBag;

/** Fill in the cargo keys a partial purse (e.g. `START_PURSE`) leaves out. */
export const toBag = (purse: Partial<Record<Cargo, number>>): CargoBag => ({
  ...emptyBag(), ...purse,
});

export interface IsoMarketPlayer extends MarketPlayer<Cargo> {
  id: string;
  name: string;
  human: boolean;
}

export type Offer = TradeOffer<Cargo>;

/**
 * W6: the market tells the world when an offer leaves the board. The game
 * wires this to the Feed tab so "a posted offer can be answered by the rival"
 * is visible instead of silent — before, the rival's answers happened inside
 * `tick` and nothing on screen ever said so.
 */
export interface IsoMarketEvents {
  onOfferClosed?: (offer: Offer, how: "accepted" | "expired") => void;
}

export interface IsoMarket {
  /** The market record. Offers live here; balances never do. */
  ctx: Market<Cargo>;
  players: IsoMarketPlayer[];
  live(p: IsoMarketPlayer): Offer[];
  post(p: IsoMarketPlayer, give: Cargo, giveN: number, want: Cargo, wantN: number): boolean;
  cancel(p: IsoMarketPlayer, id: number): boolean;
  accept(p: IsoMarketPlayer, id: number): boolean;
  bank(p: IsoMarketPlayer, give: Cargo, want: Cargo): boolean;
  /** Expire stale offers and let the rival answer the ones it likes. */
  tick(now: number): void;
}

/** How often the rival looks at the offer board. */
export const AI_TRADE_MS = 5000;

/**
 * The rival's whole trading policy: take an offer it can afford when it does
 * not lose units doing so. Deliberately dumb — the point of the market is the
 * 4:1 bank rate, and a 1:1 (or better) deal with the rival beats the bank.
 */
export function rivalWouldAccept(
  taker: MarketPlayer<Cargo>, o: TradeOffer<Cargo>,
): boolean {
  if ((taker.res[o.want] ?? 0) < o.wantN) return false;   // cannot pay
  return o.giveN >= o.wantN;                              // does not lose units
}

/**
 * Build the market over existing purse records. `res` is the SAME object the
 * game already mutates, so there is one owner of every balance and no copy to
 * keep in sync.
 */
export function createIsoMarket(
  players: { i: number; id: string; name: string; human: boolean; purse: CargoBag }[],
  events: IsoMarketEvents = {},
): IsoMarket {
  const ctx = createMarket<Cargo>();
  const list: IsoMarketPlayer[] = players.map((p) => ({
    i: p.i, id: p.id, name: p.name, human: p.human, res: p.purse,
  }));
  const at = (i: number) => list[i];
  let lastAiTrade = 0;

  return {
    ctx,
    players: list,
    live: (p) => liveOffers(p, ctx),
    post: (p, give, giveN, want, wantN) => postOffer(p, give, giveN, want, wantN, ctx),
    cancel: (p, id) => cancelOffer(p, id, ctx),
    accept: (p, id) => acceptOffer(p, id, list, ctx),
    bank: (p, give, want) => bankTrade(p, give, want, BANK_RATE),
    tick(now: number) {
      // W6: remember what is live so we can report exactly which offers
      // disappeared this tick (taken by the rival, or rotted out).
      const before = new Map(ctx.offers.map((o) => [o.id, o]));
      tickMarket(now, list, ctx);
      if (now - lastAiTrade >= AI_TRADE_MS) {
        lastAiTrade = now;
        const rivals = list.filter((p) => !p.human);
        for (const o of [...ctx.offers]) {
          const poster = at(o.from);
          if (!poster || !poster.human) continue;          // rivals answer YOU
          const taker = rivals.find((r) => rivalWouldAccept(r, o));
          if (taker) acceptOffer(taker, o.id, list, ctx);
        }
      }
      const nowLive = new Set(ctx.offers.map((o) => o.id));
      for (const o of before.values()) {
        if (nowLive.has(o.id)) continue;
        // Expired iff it outlived its life; anything else was taken.
        const how = now - o.born > OFFER_LIFE ? "expired" as const : "accepted" as const;
        events.onOfferClosed?.(o, how);
      }
    },
  };
}
