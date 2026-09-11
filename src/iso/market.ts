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
//
// PP-08: NEITHER path touches Gold. Gold is reserved for Black Market
// sabotage, so the market is created with `gold` on its blocked list and
// every route in — human post, human bank, human accept, and the rival's
// own answering clock — refuses it in both directions (the rule lives once,
// in `trade.ts`, and every player runs the same market record).
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
 * PP-08: the one cargo the market never trades. Gold is earned by processing
 * (gold mines, combo coins) and spent ONLY on Black Market sabotage — never
 * converted into construction stock at the bank or through offers.
 */
export const SABOTAGE_ONLY: readonly Cargo[] = ["gold"];

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

// ── AI-01: the rival POSTS, not just answers ─────────────────────────────
/**
 * What the rival would put on the offer board this turn, or null when its
 * purse has nothing worth trading.
 *
 * `need` is the purse its build plan is working toward (the same target the
 * 4:1 bank aims at — in the live game, `rivalSkintTarget` in game.ts; in the
 * calibration race, its twin in tests/unit/helpers/race.ts). The rule is the
 * bank's rule spoken out loud, so an accepted offer is always a real
 * improvement over banking — never a detour the plan pays for:
 *
 *   want  the cargo the plan is shortest of (what it would buy 4:1 tonight);
 *   give  the cargo furthest above the plan's own demand for it — never
 *         Gold (PP-08), never the wanted cargo, and never what the bank is
 *         saving: the rival keeps `need + BANK_RATE` of every cargo its
 *         plan wants back, not just `need`. The 4:1 bank only fires when a
 *         surplus of 4 exists ABOVE the plan's demand (`bankToward`'s own
 *         filter), so an offer escrowed on the thin slice between `need`
 *         and `need + 4` would pin the purse exactly where the bank can
 *         never trigger — the AI-vs-AI race showed a wood+stone seat
 *         deadlocking itself at depot #3 that way, offer-spamming the same
 *         2–3 wood every 40 s while the grain it needed sat unbought;
 *   rate  strictly better than the bank: 4 of surplus for 2 of need. The
 *         poster improves on 4:1, the taker sees `giveN ≥ wantN` and accepts
 *         by `rivalWouldAccept`'s own rule — which is what makes the market a
 *         real exchange between THINKING economies rather than a donation.
 *
 * Pure so the live game and the headless race share one behaviour (the race
 * runs two AI seats against each other through exactly this question), and
 * deterministic: ties resolve to the lowest cargo in `CARGOES` order.
 */
export interface OfferIdea {
  give: Cargo; giveN: number;
  want: Cargo; wantN: number;
}

export function chooseRivalOffer(
  stock: Partial<Record<Cargo, number>>,
  need: Partial<Record<Cargo, number>>,
): OfferIdea | null {
  let want: Cargo | null = null, gap = 0;
  for (const c of CARGOES) {
    const g = (need[c] ?? 0) - (stock[c] ?? 0);
    if (g > gap) { gap = g; want = c; }
  }
  if (!want) return null;                       // the plan is fully funded — nothing to buy

  let give: Cargo | null = null, surplus = 1;   // need a surplus of ≥2 to make a lot
  for (const c of CARGOES) {
    if (c === "gold" || c === want) continue;
    // keep the plan's need PLUS one bank lot in hand (see above) — the
    // escrowed slice must never be the slice the 4:1 bank fires from.
    const s = Math.max(0, (stock[c] ?? 0) - (need[c] ?? 0) - BANK_RATE);
    if (s > surplus) { surplus = s; give = c; }
  }
  if (!give) return null;                       // nothing it can spare without starving the plan

  const giveN = Math.min(4, surplus);
  const wantN = Math.min(2, gap);
  if (wantN < 1 || giveN < wantN) return null;
  return { give, giveN, want, wantN };
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
  const ctx = createMarket<Cargo>(SABOTAGE_ONLY);   // PP-08: gold never trades
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
    bank: (p, give, want) => bankTrade(p, give, want, BANK_RATE, ctx.blocked),
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
