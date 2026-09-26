// ══════════════════════════════════════════════════════════════════════════
// ECON-1 (#421) — THE COMMODITY MARKET.
//
// Money ($) is what a seat BUILDS with; resources are what it UPGRADES CITIES
// with. This module is the bridge: the place a seat turns goods into money,
// and the price model that makes WHEN you sell matter.
//
// Three shape rules, all load-bearing:
//
//   • PURE and DETERMINISTIC. No `Math.random`, no `Date.now`. A price is a
//     function of (map seed, cargo, game clock) — so the host and the guest
//     compute the same number without a wire message, a save restores into
//     the same market it left, and the tests are stable.
//   • The caller owns the purse. `sell` moves nothing: it returns what the
//     sale is worth and records the slippage. `game.ts` debits the goods and
//     credits the money.
//   • ONE price. The HUD, the rival's moving average, the sale and the
//     (optional) buy all read `priceOf`, so what you see is what you get.
//
// The price of one unit is
//
//     price = base × exp(walk) × Π events × (1 − impact)
//
//   base    `BASE_PRICE[cargo]` in config.ts — also what `BUILD_COSTS_MONEY`
//           is derived from, so a build costs about what its old resource
//           bill was worth on day one.
//   walk    a seeded Ornstein–Uhlenbeck (mean-reverting) random walk in LOG
//           space, resampled every `STEP_MS` and interpolated between steps.
//           Mean-reverting is the point: a price wanders but always comes
//           home, so "sell on a spike" is a real decision and no seat can be
//           carried by a walk that ran away.
//   events  demand events from a seeded schedule ("Steel boom: Ore +40% for
//           two minutes"). Announced in the Feed.
//   impact  SLIPPAGE: your own sales. Every unit you dump pushes the price
//           down a little and it recovers exponentially (`RECOVERY_MS`), so
//           dumping 60 Ore in one click earns visibly less than 6 sales of 10
//           spread over the next few minutes.
//
// Gold is NOT sellable: it stays the Black Market's currency (PP-08). See
// docs/economy-money.md for that decision and the balance tables.
// ══════════════════════════════════════════════════════════════════════════
import { BASE_PRICE, CARGOES, type Cargo } from "./config";

// ── tuning ────────────────────────────────────────────────────────────────
/** How often the random walk takes a step (ms). */
export const STEP_MS = 5_000;
/** OU pull toward the mean, per step. 0.08 ⇒ a spike is half gone in ~45 s. */
export const THETA = 0.08;
/** OU shock size per step, in log space (≈ ±5% a step). */
export const SIGMA = 0.055;
/** The walk is clamped here (log space): prices stay inside ≈ [0.67×, 1.5×]. */
export const WALK_CLAMP = 0.4;
/** Every unit sold in one lot pushes the price down by this fraction. */
export const SLIP_PER_UNIT = 0.012;
/** Slippage never takes a price below this fraction of its clean price. */
export const MAX_IMPACT = 0.45;
/** Slippage halves roughly every 35 s (exponential recovery). */
export const RECOVERY_MS = 50_000;
/** A buy pays the price plus this spread. */
export const BUY_SPREAD = 0.15;
/** One demand-event slot opens every minute. */
export const EVENT_SLOT_MS = 60_000;
/** …and about one slot in three actually fires. */
export const EVENT_CHANCE = 0.34;
/** How long a demand event runs (ms). */
export const EVENT_MS = 120_000;
/** Above this much spare stock the rival sells regardless of the price. */
export const DUMP_FLOOR = 40;
/** The trend arrow compares against the price this long ago. */
export const TREND_WINDOW_MS = 60_000;

/** The goods the exchange trades. Gold is the Black Market's money (PP-08). */
export const SELLABLE: readonly Cargo[] = CARGOES.filter((c) => c !== "gold");
export const sellable = (c: Cargo): boolean => c !== "gold";

// ── deterministic noise ───────────────────────────────────────────────────
/** 32-bit integer hash — the only source of "randomness" in this module. */
function hash(...parts: (number | string)[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = typeof p === "number" ? `#${Math.floor(p)}` : p;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  // Final avalanche (xorshift-multiply): FNV alone leaves neighbouring inputs
  // correlated, which showed up as whole seeds with no demand events at all.
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
/** Uniform [0,1) from a hash. */
const unit = (...parts: (number | string)[]): number => hash(...parts) / 0x1_0000_0000;
/** Approximately standard-normal from two uniforms (Box–Muller, seeded). */
function gauss(...parts: (number | string)[]): number {
  const u = Math.max(1e-9, unit("g1", ...parts));
  const v = unit("g2", ...parts);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── the mean-reverting walk ───────────────────────────────────────────────
// The walk is a pure function of (seed, cargo, step) but it is defined by
// recurrence, so it is memoised per (seed, cargo) and extended on demand. The
// cache is an optimisation ONLY: `walkStep` returns the same number whether it
// is cold or warm, which is what makes host and guest agree.
const walks = new Map<string, number[]>();

function walkSeries(seed: number, cargo: Cargo, upto: number): number[] {
  const key = `${seed}:${cargo}`;
  let series = walks.get(key);
  if (!series) { series = [0]; walks.set(key, series); }
  for (let k = series.length; k <= upto; k++) {
    const prev = series[k - 1];
    const next = prev * (1 - THETA) + SIGMA * gauss(seed, cargo, k);
    series.push(Math.max(-WALK_CLAMP, Math.min(WALK_CLAMP, next)));
  }
  return series;
}

/** Drop every memoised walk (tests only — results are unchanged either way). */
export const resetMarketCache = (): void => { walks.clear(); };

/** The log-deviation of `cargo` at `clockMs`, interpolated between steps. */
export function walkAt(seed: number, cargo: Cargo, clockMs: number): number {
  const t = Math.max(0, clockMs) / STEP_MS;
  const k = Math.floor(t);
  const series = walkSeries(seed, cargo, k + 1);
  const frac = t - k;
  return series[k] * (1 - frac) + series[k + 1] * frac;
}

// ── demand events ─────────────────────────────────────────────────────────
export interface MarketEvent {
  cargo: Cargo;
  /** Multiplier on the price while it runs (>1 a boom, <1 a glut). */
  mult: number;
  startMs: number;
  endMs: number;
  /** Feed/toast copy, e.g. "Steel boom: Ore +40% for 2 min". */
  label: string;
  /** Stable id, so the Feed announces an event exactly once. */
  id: string;
}

const BOOMS: Record<Cargo, string> = {
  grain: "Harvest festival", wood: "Building boom", ore: "Steel boom",
  stone: "Quarry rush", oil: "Fuel crunch", gold: "Gold fever",
};
const GLUTS: Record<Cargo, string> = {
  grain: "Grain glut", wood: "Timber glut", ore: "Ore glut",
  stone: "Stone glut", oil: "Fuel glut", gold: "Gold slump",
};

/** The event that the slot beginning at `slot × EVENT_SLOT_MS` opened, if any. */
function eventForSlot(seed: number, slot: number): MarketEvent | null {
  // No event in the opening minute: slot 0 is quiet, so every good starts a
  // match at exactly its base price and the first sale is never a lottery.
  if (slot < 1) return null;
  if (unit("ev", seed, slot) >= EVENT_CHANCE) return null;
  const pool = SELLABLE;
  const cargo = pool[Math.floor(unit("evc", seed, slot) * pool.length) % pool.length];
  const boom = unit("evd", seed, slot) < 0.5;
  // Booms are +25%…+50%, gluts are −20%…−35%.
  const size = boom
    ? 0.25 + 0.25 * unit("evs", seed, slot)
    : -(0.2 + 0.15 * unit("evs", seed, slot));
  const startMs = slot * EVENT_SLOT_MS;
  const pct = Math.round(Math.abs(size) * 100);
  const name = `${cargo[0].toUpperCase()}${cargo.slice(1)}`;
  return {
    cargo, mult: 1 + size, startMs, endMs: startMs + EVENT_MS,
    label: `${(boom ? BOOMS : GLUTS)[cargo]}: ${name} ${boom ? "+" : "−"}${pct}% for ${Math.round(EVENT_MS / 60_000)} min`,
    id: `${seed}:${slot}`,
  };
}

/** Every demand event running at `clockMs`. */
export function eventsAt(seed: number, clockMs: number): MarketEvent[] {
  const slot = Math.floor(Math.max(0, clockMs) / EVENT_SLOT_MS);
  const out: MarketEvent[] = [];
  // An event lasts EVENT_MS, so at most the last ⌈EVENT_MS/SLOT⌉ slots can
  // still be running.
  const back = Math.ceil(EVENT_MS / EVENT_SLOT_MS);
  for (let s = slot - back; s <= slot; s++) {
    const ev = eventForSlot(seed, s);
    if (ev && clockMs >= ev.startMs && clockMs < ev.endMs) out.push(ev);
  }
  return out;
}

/** The combined event multiplier on one cargo at `clockMs`. */
export function eventMult(seed: number, cargo: Cargo, clockMs: number): number {
  let m = 1;
  for (const ev of eventsAt(seed, clockMs)) if (ev.cargo === cargo) m *= ev.mult;
  return m;
}

// ── market state (the only mutable part: slippage) ────────────────────────
export interface MarketState {
  seed: number;
  /** Per-cargo price impact in [0, MAX_IMPACT], as of `impactAt`. */
  impact: Partial<Record<Cargo, number>>;
  /** The clock the impacts were last decayed to. */
  impactAt: number;
}

export const createMarket = (seed: number): MarketState =>
  ({ seed, impact: {}, impactAt: 0 });

/** The state as it rides a save or the wire (plain JSON, no behaviour). */
export interface MarketWire { seed: number; impact: Partial<Record<Cargo, number>>; impactAt: number }
export const marketToWire = (m: MarketState): MarketWire =>
  ({ seed: m.seed, impact: { ...m.impact }, impactAt: m.impactAt });
export const marketFromWire = (w: Partial<MarketWire> | null | undefined, fallbackSeed: number): MarketState => {
  const m = createMarket(Number.isFinite(w?.seed) ? Number(w!.seed) : fallbackSeed);
  if (w?.impact) for (const c of CARGOES) {
    const v = w.impact[c];
    if (typeof v === "number" && Number.isFinite(v)) m.impact[c] = Math.max(0, Math.min(MAX_IMPACT, v));
  }
  m.impactAt = Number.isFinite(w?.impactAt) ? Number(w!.impactAt) : 0;
  return m;
};

/** Decay every recorded impact forward to `clockMs`. Idempotent. */
export function decayImpact(m: MarketState, clockMs: number): void {
  const dt = clockMs - m.impactAt;
  if (!(dt > 0)) { m.impactAt = Math.max(m.impactAt, clockMs); return; }
  const factor = Math.exp(-dt / RECOVERY_MS);
  for (const c of CARGOES) {
    const v = m.impact[c];
    if (v) {
      const next = v * factor;
      if (next < 1e-4) delete m.impact[c]; else m.impact[c] = next;
    }
  }
  m.impactAt = clockMs;
}

/** The impact on `cargo` as of `clockMs`, without mutating the state. */
export function impactAt(m: MarketState, cargo: Cargo, clockMs: number): number {
  const v = m.impact[cargo] ?? 0;
  if (!v) return 0;
  const dt = Math.max(0, clockMs - m.impactAt);
  return v * Math.exp(-dt / RECOVERY_MS);
}

/** The price of one unit with NO slippage — the "clean" market price. */
export function cleanPrice(seed: number, cargo: Cargo, clockMs: number): number {
  const p = BASE_PRICE[cargo] * Math.exp(walkAt(seed, cargo, clockMs)) * eventMult(seed, cargo, clockMs);
  return Math.max(0.5, p);
}

/** The live price of one unit: the walk, the events and this seat's slippage. */
export function priceOf(m: MarketState, cargo: Cargo, clockMs: number): number {
  return cleanPrice(m.seed, cargo, clockMs) * (1 - impactAt(m, cargo, clockMs));
}

/** The price a BUY pays per unit (the sale price plus the spread). */
export const buyPrice = (m: MarketState, cargo: Cargo, clockMs: number): number =>
  priceOf(m, cargo, clockMs) * (1 + BUY_SPREAD);

// ── selling ───────────────────────────────────────────────────────────────
export interface SaleQuote {
  /** Units actually sold (0 when the cargo is unsellable or `n` ≤ 0). */
  units: number;
  /** Money the sale is worth, rounded down — never negative. */
  revenue: number;
  /** Unit price before and after the sale (for the toast and the sparkline). */
  priceBefore: number;
  priceAfter: number;
}

/**
 * What selling `n` units WOULD fetch, and what it would do to the price.
 * Pure: nothing is mutated, no purse is touched (see `sell`).
 *
 * The lot is walked unit by unit: the k-th unit fetches the price after the
 * k−1 units before it have already pushed it down, so a big lot earns
 * strictly less per unit than a small one and "sell all" is a real choice.
 */
export function quoteSale(m: MarketState, cargo: Cargo, n: number, clockMs: number): SaleQuote {
  const priceBefore = priceOf(m, cargo, clockMs);
  const units = Math.max(0, Math.floor(n));
  if (!sellable(cargo) || units === 0) {
    return { units: 0, revenue: 0, priceBefore, priceAfter: priceBefore };
  }
  const clean = cleanPrice(m.seed, cargo, clockMs);
  let impact = impactAt(m, cargo, clockMs);
  let revenue = 0;
  for (let k = 0; k < units; k++) {
    revenue += clean * (1 - impact);
    impact = Math.min(MAX_IMPACT, impact + SLIP_PER_UNIT * (1 - impact));
  }
  return {
    units, revenue: Math.max(0, Math.floor(revenue)),
    priceBefore, priceAfter: clean * (1 - impact),
  };
}

/**
 * Sell `n` units: records the slippage on the market and returns the quote.
 * The CALLER debits the goods and credits `revenue` — this module never sees
 * a purse.
 */
export function sell(m: MarketState, cargo: Cargo, n: number, clockMs: number): SaleQuote {
  const quote = quoteSale(m, cargo, n, clockMs);
  if (quote.units === 0) return quote;
  decayImpact(m, clockMs);
  const clean = cleanPrice(m.seed, cargo, clockMs);
  m.impact[cargo] = Math.max(0, Math.min(MAX_IMPACT, 1 - quote.priceAfter / clean));
  return quote;
}

/** What buying `n` units costs (price + spread). Slippage is not moved. */
export function quoteBuy(m: MarketState, cargo: Cargo, n: number, clockMs: number): { units: number; cost: number } {
  const units = Math.max(0, Math.floor(n));
  if (!sellable(cargo) || units === 0) return { units: 0, cost: 0 };
  return { units, cost: Math.ceil(buyPrice(m, cargo, clockMs) * units) };
}

// ── trend, history, the rival's rule ──────────────────────────────────────
/** The mean CLEAN price over the `windowMs` before `clockMs` (the rival's MA). */
export function movingAverage(
  seed: number, cargo: Cargo, clockMs: number, windowMs = 120_000, samples = 12,
): number {
  let total = 0;
  for (let i = 0; i < samples; i++) {
    const t = Math.max(0, clockMs - (windowMs * i) / samples);
    total += cleanPrice(seed, cargo, t);
  }
  return total / samples;
}

/**
 * The rival's sell rule (ECON-1): sell when the market is paying ABOVE its
 * own recent average — never on a dip — and never below the reserve it is
 * keeping back for its next city upgrade.
 *
 * Pure so the unit tests can drive it without a game: `held` is what the seat
 * has, `reserve` is what its next city upgrade needs.
 */
export function rivalSellLot(
  m: MarketState, cargo: Cargo, held: number, reserve: number, clockMs: number,
  opts: { edge?: number; maxLot?: number } = {},
): number {
  if (!sellable(cargo)) return 0;
  const spare = Math.floor(held) - Math.max(0, Math.floor(reserve));
  if (spare <= 0) return 0;
  const maxLot = opts.maxLot ?? 10;
  // A pile this big is money the rival is not using: it cashes some out at
  // whatever the market pays rather than hoarding a warehouse it cannot spend
  // (city upgrades only ever want the reserve above).
  if (spare < DUMP_FLOOR) {
    const edge = opts.edge ?? 0.02;          // 2% over its own recent average
    const avg = movingAverage(m.seed, cargo, clockMs);
    if (priceOf(m, cargo, clockMs) < avg * (1 + edge)) return 0;
  }
  // Never dump: a lot is capped so slippage stays modest (≈ 12% at 10 units).
  return Math.max(1, Math.min(spare, maxLot));
}

/** Price change over the trend window, as a fraction (+0.07 = up 7%). */
export function trendPct(m: MarketState, cargo: Cargo, clockMs: number, windowMs = TREND_WINDOW_MS): number {
  const then = cleanPrice(m.seed, cargo, Math.max(0, clockMs - windowMs));
  const now = priceOf(m, cargo, clockMs);
  if (then <= 0) return 0;
  return now / then - 1;
}

/** `points` clean prices ending at `clockMs`, oldest first — the sparkline. */
export function history(
  m: MarketState, cargo: Cargo, clockMs: number, points = 24, spanMs = 180_000,
): number[] {
  const out: number[] = [];
  for (let i = points - 1; i >= 0; i--) {
    const t = Math.max(0, clockMs - (spanMs * i) / (points - 1 || 1));
    out.push(cleanPrice(m.seed, cargo, t));
  }
  return out;
}

/** "$1,240" — one money formatter for the HUD, the rail and the toasts. */
export const money = (n: number): string =>
  `$${Math.round(n).toLocaleString("en-US")}`;
