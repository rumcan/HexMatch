import { CARGOES, type Cargo } from "./config";

export type CargoBag = Record<Cargo, number>;

export const emptyBag = (): CargoBag =>
  Object.fromEntries(CARGOES.map((c) => [c, 0])) as CargoBag;

export const toBag = (purse: Partial<Record<Cargo, number>>): CargoBag => ({
  ...emptyBag(), ...purse,
});

export const isCargo = (k: string): k is Cargo => (CARGOES as readonly string[]).includes(k);

// L15 stubs — bank is retired, but keep symbols so intermediate builds typecheck
export const BANK_RATE = 4;
export const bankAllowed = (_cargo: Cargo, _unlocked: number | null): boolean => true;
export const bankTier = (_cargo: Cargo): number => 0;
export const bankTrade = (_purse: CargoBag, _give: Cargo, _want: Cargo, _opts?: { unlocked?: number | null; rate?: number }): boolean => false;
