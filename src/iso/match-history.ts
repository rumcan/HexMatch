// ══════════════════════════════════════════════════════════════════════════
// END-1 (#472) — match history recorder + summary builder.
//
// The recorder is sampled every 10 s: ★, money, and events. It is
// save-safe (never written to the save) and MP-safe (host and guest
// both record locally, never on the wire). Memory stays small by
// capping samples and events.
//
// The pure `buildSummary` half is easy to test; the DOM part lives in
// `ending.ts`.
// ══════════════════════════════════════════════════════════════════════════

export const SAMPLE_INTERVAL_MS = 10_000;
export const MAX_SAMPLES = 360; // 1 h at 10 s
export const MAX_EVENTS = 300;

export interface HistorySample {
  /** Seconds from match start. */
  t: number;
  pStars: number;
  rStars: number;
  pMoney: number;
  rMoney: number;
}

export type HistoryEvent =
  | { kind: "sale"; seat: 0 | 1; cargo: string; units: number; revenue: number; t: number }
  | { kind: "battle"; winner: 0 | 1; loser: 0 | 1; t: number }
  | { kind: "offer"; from: 0 | 1; to: 0 | 1; give: string; giveN: number; want: string; wantN: number; t: number }
  | { kind: "town"; seat: 0 | 1; townId: number; level: number; t: number }
  | { kind: "quest"; seat: 0 | 1; questId: string; t: number }
  | { kind: "depot"; seat: 0 | 1; depotId: number; cargo: string; t: number };

export interface DepotTotal {
  seat: 0 | 1;
  depotId: number;
  cargo: string;
  total: number;
}

export interface MatchHistory {
  startMs: number;
  lastSampleMs: number;
  samples: HistorySample[];
  events: HistoryEvent[];
  depotTotals: Map<number, DepotTotal>;
  durationMs: number;
}

export function createHistory(nowMs = 0): MatchHistory {
  return {
    startMs: nowMs,
    lastSampleMs: nowMs - SAMPLE_INTERVAL_MS, // so first tick samples immediately
    samples: [],
    events: [],
    depotTotals: new Map(),
    durationMs: 0,
  };
}

export function recordSample(
  h: MatchHistory,
  nowMs: number,
  pStars: number,
  rStars: number,
  pMoney: number,
  rMoney: number,
): void {
  if (nowMs - h.lastSampleMs < SAMPLE_INTERVAL_MS) return;
  h.lastSampleMs = nowMs;
  const t = Math.max(0, (nowMs - h.startMs) / 1000);
  h.samples.push({
    t,
    pStars,
    rStars,
    pMoney,
    rMoney,
  });
  if (h.samples.length > MAX_SAMPLES) {
    // Keep first sample (origin) and drop second oldest to preserve start.
    // Simpler: drop from front but keep at least one.
    h.samples.splice(0, h.samples.length - MAX_SAMPLES);
  }
}

export function recordEvent(h: MatchHistory, ev: HistoryEvent): void {
  h.events.push(ev);
  if (h.events.length > MAX_EVENTS) {
    h.events.splice(0, h.events.length - MAX_EVENTS);
  }
}

export function recordDepotDelivery(
  h: MatchHistory,
  depotId: number,
  seat: 0 | 1,
  cargo: string,
  amount: number,
): void {
  const cur = h.depotTotals.get(depotId);
  if (cur) {
    cur.total += amount;
    // keep cargo as first seen, seat too
  } else {
    h.depotTotals.set(depotId, { seat, depotId, cargo, total: amount });
  }
}

export function finalizeHistory(h: MatchHistory, nowMs: number): void {
  h.durationMs = Math.max(0, nowMs - h.startMs);
}

// ── Summary builder (pure) ────────────────────────────────────────────────

export interface SummaryHighlights {
  bestRoute: { seat: 0 | 1; depotId: number; cargo: string; total: number; perMin: number } | null;
  biggestSale: { seat: 0 | 1; cargo: string; units: number; revenue: number; t: number } | null;
  battles: { pWins: number; rWins: number; total: number };
  offers: { pTaken: number; rTaken: number; total: number };
  quests: { pDone: number; rDone: number; total: number };
  townFirsts: Array<{ townId: number; level: number; firstSeat: 0 | 1; firstT: number }>;
  duration: number;
}

export interface SummaryModel {
  duration: number;
  samples: HistorySample[];
  depotTotals: DepotTotal[];
  highlights: SummaryHighlights;
}

export function buildSummary(h: MatchHistory): SummaryModel {
  const durationSec = h.durationMs > 0 ? h.durationMs / 1000 : (h.samples.length ? h.samples[h.samples.length - 1].t : 0);
  const durationMin = Math.max(1 / 60, durationSec / 60);

  // Best route: highest cargo total (or per min)
  let best: SummaryHighlights["bestRoute"] = null;
  for (const tot of h.depotTotals.values()) {
    const perMin = tot.total / durationMin;
    if (!best || perMin > best.perMin) {
      best = { seat: tot.seat, depotId: tot.depotId, cargo: tot.cargo, total: tot.total, perMin };
    }
  }

  // Biggest sale
  let biggest: SummaryHighlights["biggestSale"] = null;
  for (const ev of h.events) {
    if (ev.kind !== "sale") continue;
    if (!biggest || ev.revenue > biggest.revenue) {
      biggest = { seat: ev.seat, cargo: ev.cargo, units: ev.units, revenue: ev.revenue, t: ev.t };
    }
  }

  // Battles
  let pWins = 0, rWins = 0;
  for (const ev of h.events) {
    if (ev.kind !== "battle") continue;
    if (ev.winner === 0) pWins++;
    else rWins++;
  }

  // Offers taken
  let pTaken = 0, rTaken = 0;
  for (const ev of h.events) {
    if (ev.kind !== "offer") continue;
    if (ev.to === 0) pTaken++;
    else rTaken++;
  }

  // Quests done
  let pDone = 0, rDone = 0;
  for (const ev of h.events) {
    if (ev.kind !== "quest") continue;
    if (ev.seat === 0) pDone++;
    else rDone++;
  }

  // Town firsts: for each townId+level, earliest seat
  const townMap = new Map<string, { townId: number; level: number; firstSeat: 0 | 1; firstT: number }>();
  for (const ev of h.events) {
    if (ev.kind !== "town") continue;
    const key = `${ev.townId}:${ev.level}`;
    const cur = townMap.get(key);
    if (!cur || ev.t < cur.firstT) {
      townMap.set(key, { townId: ev.townId, level: ev.level, firstSeat: ev.seat, firstT: ev.t });
    }
  }
  const townFirsts = [...townMap.values()].sort((a, b) => a.townId - b.townId || a.level - b.level || a.firstT - b.firstT);

  return {
    duration: durationSec,
    samples: [...h.samples],
    depotTotals: [...h.depotTotals.values()],
    highlights: {
      bestRoute: best,
      biggestSale: biggest,
      battles: { pWins, rWins, total: pWins + rWins },
      offers: { pTaken, rTaken, total: pTaken + rTaken },
      quests: { pDone, rDone, total: pDone + rDone },
      townFirsts,
      duration: durationSec,
    },
  };
}
