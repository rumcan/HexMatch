import { CARGOES, type Cargo } from "./config";

/** Dollars per economy minute, PER cargo. Marginal bands: 0–25%,
 * 25–100%, and beyond 100% overflow. Never round individual ticks. */
export function storageRent(held: number, cap: number): number {
  const over = Math.max(0, held - cap);
  return Math.min(over, cap * .25) * .2
    + Math.min(Math.max(0, over - cap * .25), cap * .75) * 1
    + Math.max(0, over - cap) * 3;
}

export function totalStorageRent(purse: Partial<Record<Cargo, number>>, cap: number): number {
  return CARGOES.reduce((sum, c) => sum + storageRent(purse[c] ?? 0, cap), 0);
}

export function storageRentLabel(purse: Partial<Record<Cargo, number>>, cap: number): string {
  return CARGOES.filter(c => (purse[c] ?? 0) > cap).map(c =>
    `Over cap: +${+(purse[c]! - cap).toFixed(1)} ${c} · rent $${storageRent(purse[c]!, cap).toFixed(2)}/min`
  ).join(" · ");
}
