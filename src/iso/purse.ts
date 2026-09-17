import { CARGOES, type Cargo } from "./config";

export type CargoBag = Record<Cargo, number>;

export const emptyBag = (): CargoBag =>
  Object.fromEntries(CARGOES.map((c) => [c, 0])) as CargoBag;

export const toBag = (purse: Partial<Record<Cargo, number>>): CargoBag => ({
  ...emptyBag(), ...purse,
});

export const isCargo = (k: string): k is Cargo => (CARGOES as readonly string[]).includes(k);
