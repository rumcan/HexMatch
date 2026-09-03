// ══════════════════════════════════════════════════════════════════════════
// Cargo trading — restored alongside the match-3 board (J1).
//
// ONE implementation, two markets. The restored hex-era tests drive it through
// the legacy global `G` in `state.ts`; the iso game passes its own market
// record instead, so there is no second copy of these rules and no second
// state system (J1's "reconcile state" requirement).
//
// Every function is generic over the resource key — `ResKey` for the legacy
// map, `Cargo` for the iso economy — and takes the market record as its last
// parameter, defaulting to the legacy global so the old call sites still work.
//
// Escrow is the market's only state: `postOffer` moves goods out of the
// poster's record and into a live offer, `cancelOffer`/`tickMarket` refund it.
// Whoever owns the resource record (the iso player purse) stays the owner; the
// market never keeps a second copy of a balance.
//
// The old `market:changed` bus event went with the old UI — nothing listens to
// it any more. Callers re-read the market record after a call returns.
// ══════════════════════════════════════════════════════════════════════════
import { OFFER_LIFE, ResKey } from "./config";
import { G } from "./state";

/** The only thing the market needs from a player: their resource record. */
export interface Trader<K extends string> { res: Record<K, number> }

/** A trader plus a stable index, used to route an offer back to its poster. */
export interface MarketPlayer<K extends string> extends Trader<K> { i: number }

export interface TradeOffer<K extends string> {
  id: number;
  from: number;                 // index into the market's player list
  give: K; giveN: number;
  want: K; wantN: number;
  born: number;
}

/** The market's own book: the live offers and the next offer id. */
export interface Market<K extends string> {
  offers: TradeOffer<K>[];
  offerSeq: number;
}

export const createMarket = <K extends string>(): Market<K> => ({ offers: [], offerSeq: 1 });

/** A player may have at most this many live offers at once. */
export const MAX_OFFERS = 3;
/** Bank exchange rate: give this many of one good, receive 1 of another. */
export const BANK_RATE = 4;

/** Legacy ResKey-specialised aliases — the hex-era market shape. */
export type LegacyOffer = TradeOffer<ResKey>;
export type LegacyMarket = Market<ResKey>;

export function liveOffers<K extends string>(
  p: MarketPlayer<K>, m: Market<K> = G,
): TradeOffer<K>[] {
  return m.offers.filter((o) => o.from === p.i);
}

/** Escrow `giveN` of `give` and publish an offer asking for `want`. */
export function postOffer<K extends string>(
  p: MarketPlayer<K>, give: K, giveN: number, want: K, wantN: number,
  m: Market<K> = G,
): boolean {
  if (give === want) return false;
  if (giveN <= 0 || wantN <= 0) return false;
  if ((p.res[give] ?? 0) < giveN) return false;
  if (liveOffers(p, m).length >= MAX_OFFERS) return false;
  p.res[give] = (p.res[give] ?? 0) - giveN;   // escrow
  const o: TradeOffer<K> = {
    id: m.offerSeq++, from: p.i, give, giveN, want, wantN, born: performance.now(),
  };
  m.offers.unshift(o);
  return true;
}

/**
 * Take an offer: the taker pays `want`, the poster's escrowed `give` is
 * released to the taker. `players` is indexed by `offer.from`.
 */
export function acceptOffer<K extends string>(
  taker: MarketPlayer<K>, id: number,
  players: Trader<K>[] = G.players, m: Market<K> = G,
): boolean {
  const idx = m.offers.findIndex((o) => o.id === id);
  if (idx < 0) return false;
  const o = m.offers[idx];
  if (o.from === taker.i) return false;
  if ((taker.res[o.want] ?? 0) < o.wantN) return false;
  const poster = players[o.from];
  if (!poster) return false;
  // taker gives want → poster; poster's escrowed give → taker
  taker.res[o.want] = (taker.res[o.want] ?? 0) - o.wantN;
  poster.res[o.want] = (poster.res[o.want] ?? 0) + o.wantN;
  taker.res[o.give] = (taker.res[o.give] ?? 0) + o.giveN;
  m.offers.splice(idx, 1);
  return true;
}

/** Withdraw your own offer and refund the escrow. */
export function cancelOffer<K extends string>(
  p: MarketPlayer<K>, id: number, m: Market<K> = G,
): boolean {
  const idx = m.offers.findIndex((o) => o.id === id);
  if (idx < 0) return false;
  const o = m.offers[idx];
  if (o.from !== p.i) return false;
  p.res[o.give] = (p.res[o.give] ?? 0) + o.giveN;   // refund escrow
  m.offers.splice(idx, 1);
  return true;
}

/** Bank exchange: give BANK_RATE of one good, get 1 of another (no rival). */
export function bankTrade<K extends string>(
  p: Trader<K>, give: K, want: K, rate = BANK_RATE,
): boolean {
  if (give === want) return false;
  if ((p.res[give] ?? 0) < rate) return false;
  p.res[give] = (p.res[give] ?? 0) - rate;
  p.res[want] = (p.res[want] ?? 0) + 1;
  return true;
}

/** Expire offers older than OFFER_LIFE, refunding their escrow. */
export function tickMarket<K extends string>(
  now: number, players: Trader<K>[] = G.players, m: Market<K> = G,
): void {
  for (let i = m.offers.length - 1; i >= 0; i--) {
    const o = m.offers[i];
    if (now - o.born > OFFER_LIFE) {
      const poster = players[o.from];
      if (poster) poster.res[o.give] = (poster.res[o.give] ?? 0) + o.giveN;   // refund
      m.offers.splice(i, 1);
    }
  }
}
