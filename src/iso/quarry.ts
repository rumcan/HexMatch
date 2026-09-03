// ══════════════════════════════════════════════════════════════════════════
// J1 — the join. The match-3 quarry and the iso economy, in one module.
//
// This is the file that makes HexMatch a game again: the restored board
// (`src/game/board.ts`) had no map, and the iso map had no board. Neither side
// learns anything new about the other — the board still only knows gems, and
// the economy still only knows harvesters — the join is two small rules:
//
//   1. GATE. `economy.playerResources` already computes the cargo a player's
//      road/rail network actually delivers (serviced harvester → catchment →
//      industries → connection multiplier). That same set decides which gem
//      colours carry harvest tokens, so a colour your network cannot reach
//      simply never pays. A harvest that lands while the line is cut is
//      refused at harvest time, not merely never spawned.
//   2. MAP. The six gem colours are the six iso cargoes, one-to-one
//      (`GEM_TO_CARGO`), so a matched token credits the cargo the connected
//      industry produces.
//
// The board's own rule does the rest: only TOKENED gems pay out, and tokens
// only exist where the network reaches. Match a plain gem and you clear space;
// match a token and you harvest.
// ══════════════════════════════════════════════════════════════════════════
import { Board, type Gem } from "../game/board";
import { RES_KEYS, UPGRADE_EVERY, type ResKey } from "../game/config";
import { CARGOES, type Cargo } from "./config";
import { playerResources, type Components, type EconomyState } from "./economy";

// ── the bijection ──────────────────────────────────────────────────────────
/**
 * Gem colour → cargo. Four of the six are semantic (and colour-matched in the
 * palette): wheat→grain, wood→wood, ore→ore, gold→gold. Brick and sheep have
 * no iso counterpart, so they take the two cargoes with no gem colour —
 * brick→stone (a quarry's output) and sheep→oil. It is a bijection by
 * construction and unit-tested as one: no cargo can be unreachable and no two
 * gems can pay the same cargo.
 */
export const GEM_TO_CARGO: Record<ResKey, Cargo> = {
  wheat: "grain",
  wood: "wood",
  ore: "ore",
  brick: "stone",
  sheep: "oil",
  gold: "gold",
};

export const CARGO_TO_GEM: Record<Cargo, ResKey> = Object.fromEntries(
  (Object.keys(GEM_TO_CARGO) as ResKey[]).map((r) => [GEM_TO_CARGO[r], r]),
) as Record<Cargo, ResKey>;

// ── the gate ───────────────────────────────────────────────────────────────
/** Cargo per tick that `owner`'s network currently delivers. Empty = nothing. */
export function reachableCargo(
  state: EconomyState, owner: string, now: number, comp?: Components,
): Partial<Record<Cargo, number>> {
  const yields = playerResources(state, owner, now, comp);
  const out: Partial<Record<Cargo, number>> = {};
  for (const c of CARGOES) {
    const v = yields[c] ?? 0;
    if (v > 0) out[c] = v;
  }
  return out;
}

/** A cargo delivering at least this much per tick upgrades its token to tier 2. */
export const TIER2_YIELD = 2;

/**
 * The pool `Board.spawnTokens` wants: one entry per reachable cargo, keyed by
 * gem colour, valued 1 or 2 (the token tier). Nothing reachable → empty pool,
 * so the board stays full of gems that pay nothing.
 */
export function tokenPool(
  reach: Partial<Record<Cargo, number>>,
): Partial<Record<ResKey, number>> {
  const pool: Partial<Record<ResKey, number>> = {};
  for (const c of CARGOES) {
    const v = reach[c] ?? 0;
    if (v <= 0) continue;
    pool[CARGO_TO_GEM[c]] = v >= TIER2_YIELD ? 2 : 1;
  }
  return pool;
}

/** Strip the tokens from cargo the network no longer reaches. */
export function demoteTokens(board: Board, resList: ResKey[]): number {
  let n = 0;
  const drop = new Set(resList);
  for (const g of board.gems()) {
    if (g.tier > 0 && drop.has(g.res)) { g.tier = 0; n++; }
  }
  return n;
}

// ── the quarry ─────────────────────────────────────────────────────────────
export interface QuarryHooks {
  /** A token was matched and the cargo IS reachable: credit it. */
  onHarvest?: (cargo: Cargo, amount: number) => void;
  /** A token was matched but the line is down: refused, so the player learns. */
  onBlocked?: (cargo: Cargo, amount: number) => void;
  /** Per-match summary, cargo-keyed, for the floating gain readout. */
  onGains?: (gains: Partial<Record<Cargo, number>>, label: string) => void;
  /** Tokens appeared/disappeared: the panel redraws. */
  onTokens?: (pool: Partial<Record<ResKey, number>>) => void;
  onChange?: () => void;
}

export interface Quarry {
  board: Board;
  /** Cargo per tick the network delivered at the last refresh. */
  reach: Partial<Record<Cargo, number>>;
  /** Recompute the reachable set; spawn tokens for newly reached cargo. */
  refresh(now: number): Partial<Record<Cargo, number>>;
  /** Per-frame: board effects plus the 20s token spawn. */
  tick(now: number): void;
}

export function createQuarry(
  state: EconomyState, owner: string, hooks: QuarryHooks = {},
): Quarry {
  const board = new Board();
  let reach: Partial<Record<Cargo, number>> = {};
  let lastPool: Partial<Record<ResKey, number>> = {};
  let lastTokenAt = 0;

  // ── the board pays cargo, gated by the network ──
  // The gate reads the network at MATCH TIME, not from the cached reach the
  // panel shows. A cached gate is only as fresh as the last refresh, which
  // means "demolish the road, match the tokens anyway" would pay out — the
  // exact bug this ticket exists to prevent. Recomputing the reachable set is
  // one flood fill over the two track layers, so paying it per token is free.
  board.onHarvest = (res: ResKey, amount: number) => {
    const cargo = GEM_TO_CARGO[res];
    reach = reachableCargo(state, owner, performance.now());
    if ((reach[cargo] ?? 0) > 0) hooks.onHarvest?.(cargo, amount);
    else hooks.onBlocked?.(cargo, amount);
  };
  board.onPopup = (gains, label) => {
    const out: Partial<Record<Cargo, number>> = {};
    for (const [res, n] of Object.entries(gains) as [ResKey, number][]) {
      const cargo = GEM_TO_CARGO[res];
      // only what the gate actually credited belongs in the readout
      if ((reach[cargo] ?? 0) > 0) out[cargo] = (out[cargo] ?? 0) + n;
    }
    if (Object.keys(out).length) hooks.onGains?.(out, label);
  };
  board.onChange = () => hooks.onChange?.();

  const refresh = (now: number) => {
    reach = reachableCargo(state, owner, now);
    const pool = tokenPool(reach);
    const gained: Partial<Record<ResKey, number>> = {};
    const lost: ResKey[] = [];
    for (const res of RES_KEYS) {
      const want = pool[res];
      const had = lastPool[res];
      if (want !== undefined && had === undefined) gained[res] = want;
      else if (want === undefined && had !== undefined) lost.push(res);
    }
    if (lost.length && demoteTokens(board, lost)) board.onChange();
    if (Object.keys(gained).length) {
      board.spawnTokens(gained);
      hooks.onTokens?.(gained);
    }
    lastPool = pool;
    return reach;
  };

  const tick = (now: number) => {
    board.tickEffects(now);
    if (now - lastTokenAt < UPGRADE_EVERY) return;
    lastTokenAt = now;
    const pool = tokenPool(reach);
    lastPool = pool;
    if (Object.keys(pool).length) board.spawnTokens(pool);
  };

  // `reach` is reassigned on every refresh, so expose it through a getter —
  // a plain property would freeze the empty set the quarry booted with.
  return {
    board,
    get reach() { return reach; },
    refresh,
    tick,
  };
}

/** Gems of one colour that currently carry a harvest token. */
export const tokenedGems = (board: Board, res: ResKey): Gem[] =>
  board.gems().filter((g) => g.res === res && g.tier > 0);
