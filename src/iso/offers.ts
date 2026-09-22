// ══════════════════════════════════════════════════════════════════════════
// TRADE — the offer board, restored (owner call, 2026-09).
//
// L11 (#226) removed player-to-player trading and kept only the bank. The
// owner wants both: the 3:1 bank (`bank.ts`) AND offers between the seats.
// This is the offer half, rebuilt on the pre-L11 engine (`src/game/trade.ts`
// + `src/iso/market.ts` at 7fe0d7a2^) and fitted to today's game:
//
//   • a seat POSTS "give N of X for M of Y": the give is ESCROWED out of its
//     purse at once, so an offer can never be accepted with goods the poster
//     has since spent;
//   • the other seat ACCEPTS: it pays the want to the poster and receives
//     the escrow. A poster may CANCEL (escrow refunded), and an offer that
//     outlives `OFFER_LIFE_MS` expires (escrow refunded);
//   • Gold never trades, in either direction (PP-08 — it is the Black
//     Market's money), and a seat holds at most `MAX_OFFERS` live offers.
//
// Pure and purse-shaped: the caller owns the balances (`purses[seat]` is the
// seat's live purse object, moved in place), this module owns only the book.
// Seats are indices in the HOST frame (0 = host / solo player, 1 = guest or
// rival), so the book rides the wire as-is and a guest mirrors `from`.
// Time is passed in, never read, so the book is deterministic under test.
// ══════════════════════════════════════════════════════════════════════════
import { CARGOES, type Cargo } from "./config";
import { BANK_RATE } from "./bank";

export type Seat = 0 | 1;
export type Purse = Partial<Record<Cargo, number>>;

export interface Offer {
  id: number;
  /** The poster's seat (host frame). */
  from: Seat;
  give: Cargo; giveN: number;
  want: Cargo; wantN: number;
  /** When it was posted (the game's clock), for expiry and the countdown. */
  born: number;
}

export interface OfferBook {
  offers: Offer[];
  seq: number;
}

/** A seat may keep this many offers live at once. */
export const MAX_OFFERS = 3;
/** How long an offer stands before it expires and refunds (ms). */
export const OFFER_LIFE_MS = 40_000;
/** The largest lot one offer may name (a sanity bound on intents). */
export const MAX_LOT = 99;
/** How often the rival looks at the board (answers and posts). */
export const RIVAL_TRADE_MS = 5_000;

export const createOfferBook = (): OfferBook => ({ offers: [], seq: 1 });

/** Gold is the Black Market's money — never traded (PP-08). */
export const tradeable = (c: Cargo): boolean => c !== "gold";

export const liveOffers = (book: OfferBook, seat: Seat): Offer[] =>
  book.offers.filter((o) => o.from === seat);

export type OfferRefusal =
  | "same" | "gold" | "lot" | "short" | "full" | "missing" | "own" | "not-yours";

const isLot = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_LOT;

/** Why `post` would refuse, or null when it would land. */
export function postRefusal(
  book: OfferBook, purse: Purse, seat: Seat,
  give: Cargo, giveN: number, want: Cargo, wantN: number,
): OfferRefusal | null {
  if (give === want) return "same";
  if (!tradeable(give) || !tradeable(want)) return "gold";
  if (!isLot(giveN) || !isLot(wantN)) return "lot";
  if ((purse[give] ?? 0) < giveN) return "short";
  if (liveOffers(book, seat).length >= MAX_OFFERS) return "full";
  return null;
}

/** Post an offer: escrow the give now. Returns the offer, or the refusal. */
export function postOffer(
  book: OfferBook, purse: Purse, seat: Seat,
  give: Cargo, giveN: number, want: Cargo, wantN: number, now: number,
): Offer | OfferRefusal {
  const why = postRefusal(book, purse, seat, give, giveN, want, wantN);
  if (why) return why;
  purse[give] = (purse[give] ?? 0) - giveN;
  const o: Offer = { id: book.seq++, from: seat, give, giveN, want, wantN, born: now };
  book.offers.unshift(o);
  return o;
}

/**
 * Take an offer: the taker pays `want` to the poster and receives the
 * escrowed `give`. `purses[seat]` is each seat's live purse.
 */
export function acceptOffer(
  book: OfferBook, purses: [Purse, Purse], taker: Seat, id: number,
): Offer | OfferRefusal {
  const idx = book.offers.findIndex((o) => o.id === id);
  if (idx < 0) return "missing";
  const o = book.offers[idx];
  if (o.from === taker) return "own";
  if (!tradeable(o.give) || !tradeable(o.want)) return "gold";
  const tp = purses[taker], pp = purses[o.from];
  if ((tp[o.want] ?? 0) < o.wantN) return "short";
  tp[o.want] = (tp[o.want] ?? 0) - o.wantN;
  pp[o.want] = (pp[o.want] ?? 0) + o.wantN;
  tp[o.give] = (tp[o.give] ?? 0) + o.giveN;
  book.offers.splice(idx, 1);
  return o;
}

/** Withdraw your own offer and refund the escrow. */
export function cancelOffer(
  book: OfferBook, purse: Purse, seat: Seat, id: number,
): Offer | OfferRefusal {
  const idx = book.offers.findIndex((o) => o.id === id);
  if (idx < 0) return "missing";
  const o = book.offers[idx];
  if (o.from !== seat) return "not-yours";
  purse[o.give] = (purse[o.give] ?? 0) + o.giveN;
  book.offers.splice(idx, 1);
  return o;
}

/** Expire offers older than `OFFER_LIFE_MS`, refunding escrow. */
export function expireOffers(book: OfferBook, purses: [Purse, Purse], now: number): Offer[] {
  const gone: Offer[] = [];
  for (let i = book.offers.length - 1; i >= 0; i--) {
    const o = book.offers[i];
    if (now - o.born <= OFFER_LIFE_MS) continue;
    const p = purses[o.from];
    p[o.give] = (p[o.give] ?? 0) + o.giveN;
    book.offers.splice(i, 1);
    gone.push(o);
  }
  return gone;
}

/** Seconds left on an offer (the countdown the panel prints). */
export const offerSecondsLeft = (o: Offer, now: number): number =>
  Math.max(0, Math.ceil((OFFER_LIFE_MS - (now - o.born)) / 1000));

/** A refusal in the player's words. */
export const OFFER_REFUSAL_TEXT: Record<OfferRefusal, string> = {
  same: "Pick two different goods.",
  gold: "Gold is reserved for the Black Market — it never trades.",
  lot: `Offer between 1 and ${MAX_LOT} of each good.`,
  short: "You don't have enough to cover that.",
  full: `You already have ${MAX_OFFERS} offers live — cancel one first.`,
  missing: "That offer is gone.",
  own: "That's your own offer.",
  "not-yours": "That isn't your offer.",
};

// ── the rival's policy (solo) ──────────────────────────────────────────────

/**
 * The rival takes an offer it can pay for when it does not lose units doing
 * so (`giveN ≥ wantN`) and the good it pays is not one it is short of for
 * its own next build (`need`). Deliberately simple: any deal at 1:1 or
 * better beats the 3:1 bank for both sides.
 */
export function rivalWouldAccept(stock: Purse, o: Offer, need: Purse = {}): boolean {
  if (!tradeable(o.give) || !tradeable(o.want)) return false;
  if ((stock[o.want] ?? 0) < o.wantN) return false;
  if ((stock[o.want] ?? 0) - o.wantN < (need[o.want] ?? 0)) return false;
  return o.giveN >= o.wantN;
}

export interface OfferIdea { give: Cargo; giveN: number; want: Cargo; wantN: number }

/**
 * What the rival would post toward `need` (its next build), or null.
 *   want — the good it is shortest of;
 *   give — the good furthest above its need, keeping one bank lot of margin
 *          (so an escrowed slice never starves the bank route);
 *   rate — up to 3 for 2: better than the 3:1 bank for the rival, and
 *          `giveN ≥ wantN` so the other side gains units too.
 * Deterministic: ties resolve in `CARGOES` order.
 */
export function chooseRivalOffer(stock: Purse, need: Purse): OfferIdea | null {
  let want: Cargo | null = null, gap = 0;
  for (const c of CARGOES) {
    if (!tradeable(c)) continue;
    const g = (need[c] ?? 0) - (stock[c] ?? 0);
    if (g > gap) { gap = g; want = c; }
  }
  if (!want) return null;
  let give: Cargo | null = null, surplus = 1;
  for (const c of CARGOES) {
    if (!tradeable(c) || c === want) continue;
    const s = Math.max(0, (stock[c] ?? 0) - (need[c] ?? 0) - BANK_RATE);
    if (s > surplus) { surplus = s; give = c; }
  }
  if (!give) return null;
  const giveN = Math.min(3, surplus);
  const wantN = Math.min(2, gap);
  if (wantN < 1 || giveN < wantN) return null;
  return { give, giveN, want, wantN };
}

// ── the wire ───────────────────────────────────────────────────────────────

/**
 * The book as it rides a snapshot/delta (host frame). Each machine has its own
 * clock, so an offer carries the ms it has LEFT, not when it was born; the
 * reader rebuilds `born` on its own clock.
 */
export interface OfferWire { id: number; from: Seat; give: Cargo; giveN: number; want: Cargo; wantN: number; left: number }

export const offersToWire = (book: OfferBook, now: number): OfferWire[] =>
  book.offers.map((o) => ({
    id: o.id, from: o.from, give: o.give, giveN: o.giveN, want: o.want, wantN: o.wantN,
    left: Math.max(0, OFFER_LIFE_MS - (now - o.born)),
  }));

/** A guest reads the book with `from` flipped into its own seat frame. */
export const offersFromWire = (w: unknown, mirror: boolean, now: number): Offer[] => {
  if (!Array.isArray(w)) return [];
  const out: Offer[] = [];
  for (const x of w as Partial<OfferWire>[]) {
    if (!x || typeof x.id !== "number" || (x.from !== 0 && x.from !== 1)) continue;
    if (!CARGOES.includes(x.give as Cargo) || !CARGOES.includes(x.want as Cargo)) continue;
    if (typeof x.giveN !== "number" || typeof x.wantN !== "number" || typeof x.left !== "number") continue;
    out.push({
      id: x.id, from: (mirror ? 1 - x.from : x.from) as Seat,
      give: x.give as Cargo, giveN: x.giveN, want: x.want as Cargo, wantN: x.wantN,
      born: now - (OFFER_LIFE_MS - x.left),
    });
  }
  return out;
};
