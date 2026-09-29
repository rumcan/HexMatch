// TRAFFIC-INCOME: a depot's income feels the traffic its lorries sit in.
//
// Owner (2026-09-29): "trucks being delayed by traffic should affect the speed
// you get your resources and motivate you to build your own roads and not use
// public roads with traffic." FLOW-1 already slows and stops the lorries; this
// keeps a smoothed (EMA) ratio of observed lorry speed / free-flow speed per
// depot and hands it to `haulFactor` as a 0.4..1 multiplier.
//
// HOST-LOCAL like the flow itself: never saved, never on the wire. No flow
// (traffic off, a guest) = no samples = factor 1.

/** The floor: even a gridlocked depot still earns 40%. */
export const TRAFFIC_FACTOR_MIN = 0.4;
/** Smoothing time constant (ms) of the per-depot EMA. */
export const TRAFFIC_EMA_TAU_MS = 20000;

const ema = new Map<number, number>();

/** Fold one lorry's observed speed ratio (0 = standing, 1 = free flow) into its depot's EMA. */
export function noteTrafficSample(depotId: number, ratio: number, dtMs: number): void {
  if (!(dtMs > 0)) return;
  const r = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 1));
  const prev = ema.get(depotId) ?? 1;
  const a = 1 - Math.exp(-dtMs / TRAFFIC_EMA_TAU_MS);
  ema.set(depotId, prev + (r - prev) * a);
}

/** 0.4..1: the depot's traffic multiplier (1 with no data). */
export function trafficFactorOf(depotId: number): number {
  const v = ema.get(depotId);
  if (v === undefined) return 1;
  return Math.max(TRAFFIC_FACTOR_MIN, Math.min(1, v));
}

/** Scale a haul factor by the depot's traffic factor. */
export const trafficScaledHaul = (base: number, depotId: number): number =>
  base * trafficFactorOf(depotId);

/** Traffic off / no flow this tick: forget every sample (factor back to 1). */
export function clearTrafficSamples(): void {
  if (ema.size) ema.clear();
}
