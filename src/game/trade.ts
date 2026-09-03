import { OFFER_LIFE, ResKey } from "./config";
import { G, Player, Offer, bus } from "./state";
import { gainRes } from "./actions";

export function liveOffers(p: Player): Offer[] {
  return G.offers.filter((o: Offer) => o.from === p.i);
}

export function postOffer(p: Player, give: ResKey, giveN: number, want: ResKey, wantN: number): boolean {
  if (give === want) return false;
  if (p.res[give] < giveN) return false;
  if (liveOffers(p).length >= 3) return false;
  p.res[give] -= giveN; // escrow
  const o: Offer = { id: G.offerSeq++, from: p.i, give, giveN, want, wantN, born: performance.now() };
  G.offers.unshift(o);
  bus.emit("market:changed", o);
  return true;
}

export function acceptOffer(taker: Player, id: number): boolean {
  const idx = G.offers.findIndex((o: Offer) => o.id === id);
  if (idx < 0) return false;
  const o: Offer = G.offers[idx];
  if (o.from === taker.i) return false;
  if (taker.res[o.want] < o.wantN) return false;
  const poster = G.players[o.from] as Player;
  // taker gives want -> poster; poster's escrowed give -> taker
  taker.res[o.want] -= o.wantN;
  gainRes(poster, o.want, o.wantN);
  gainRes(taker, o.give, o.giveN);
  G.offers.splice(idx, 1);
  bus.emit("market:changed", { o, taker });
  return true;
}

export function cancelOffer(p: Player, id: number): boolean {
  const idx = G.offers.findIndex((o: Offer) => o.id === id);
  if (idx < 0) return false;
  const o: Offer = G.offers[idx];
  if (o.from !== p.i) return false;
  p.res[o.give] += o.giveN; // refund escrow
  G.offers.splice(idx, 1);
  bus.emit("market:changed", o);
  return true;
}

// Bank exchange: give 4 of one resource, get 1 of another (instant, no rival)
export function bankTrade(p: Player, give: ResKey, want: ResKey): boolean {
  if (give === want) return false;
  if (p.res[give] < 4) return false;
  p.res[give] -= 4;
  gainRes(p, want, 1);
  bus.emit("market:changed", { bank: true });
  return true;
}

export function tickMarket(now: number) {
  for (let i = G.offers.length - 1; i >= 0; i--) {
    const o: Offer = G.offers[i];
    if (now - o.born > OFFER_LIFE) {
      G.players[o.from].res[o.give] += o.giveN; // refund
      G.offers.splice(i, 1);
      bus.emit("market:changed", o);
    }
  }
}
