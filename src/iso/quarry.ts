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
//      PP-13 exception: a token the BOARD itself forged (the tier-1 gem a
//      4-in-a-row leaves behind, tier-2 for 5+) is not the network's token —
//      the match that minted it already paid for it, so it pays whatever
//      cargo it shows, depot or no depot. See `Gem.forged`.
//   2. MAP. The six gem colours are the six iso cargoes, one-to-one
//      (`GEM_TO_CARGO`), so a matched token credits the cargo the connected
//      industry produces.
//
// The board's own rule does the rest: only TOKENED gems pay out, and network
// tokens only exist where the network reaches. Match a plain gem and you clear
// space; match a token and you harvest.
// ══════════════════════════════════════════════════════════════════════════
import { Board, type Gem } from "../game/board";
import { RES_KEYS, UPGRADE_EVERY, type ResKey } from "../game/config";
import { CARGOES, INDUSTRY_BY_KEY, type Cargo } from "./config";
import {
  playerResources, industriesInCatchment, buildAllComponents, ownerIdOf,
  type Components, type EconomyState,
} from "./economy";
import { roadRouteForHarvester } from "./vehicles";

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
 * PP-09: does `owner` have a depot whose 4×4 catchment covers a Gold Mine?
 *
 * This is the DROP gate for gold gems, and it is placement-based, not
 * connection-based: the moment a depot is built beside a gold mine, gold
 * joins the board's gravity pool and starts dropping like the other resource
 * types — the road/rail link is not required for the gems to appear. (The
 * PAYOUT is still connection-gated: only a tokened gold gem credits the
 * purse, and tokens spawn through the normal reach machinery.)
 */
export function hasGoldMineDepot(state: EconomyState, owner: string): boolean {
  return state.harvesters.some((h) =>
    h.owner === owner &&
    industriesInCatchment(state.grid, h).some((i) => i.type === "gold_mine"),
  );
}

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

/**
 * Strip the tokens from cargo the network no longer reaches.
 *
 * PP-13: FORGED tokens survive. They were minted by the player's own 4+ match
 * and are not the network's to revoke — stripping one the moment the line
 * dropped would put the 4-match reward right back behind the gate this
 * function exists to open.
 */
export function demoteTokens(board: Board, resList: ResKey[]): number {
  let n = 0;
  const drop = new Set(resList);
  for (const g of board.gems()) {
    if (g.tier > 0 && g.forged !== true && drop.has(g.res)) { g.tier = 0; n++; }
  }
  return n;
}

// ── RV-03: delivery is paced by truck distance ─────────────────────────────
/**
 * Base time between steady-state token spawns for a cargo. This is the
 * board's own `UPGRADE_EVERY` (20 s) — distance only ever slows a delivery
 * down, never speeds it up past the base clock.
 */
export const SPAWN_BASE_MS = UPGRADE_EVERY;

/**
 * A1: RV-03's distance penalty is now REAL travel time instead of an
 * arithmetic one. The lorry that delivers the token drives the actual route at
 * `TRUCK_SPEED`, so a far depot waits `2 × route × 300 ms` per load where a
 * near one waits a fraction of that — the same rule, paid in distance instead
 * of in a made-up number. What is left for the clock is only the cargo NO
 * lorry carries (rail, or a depot with no road route), and that keeps the
 * flat base interval.
 */

/**
 * The shortest truck-route length (in tiles) that delivers each cargo, or
 * undefined when that cargo has no ROAD truck. The board's token clock is
 * paced from this: the closer a depot is to its factory, the faster its cargo
 * lands. Only ROAD connections are paced — a rail-only depot has no lorry
 * (trains are not this ticket) and keeps the base clock, which is fairest
 * since rail already carries the ×1.6 throughput multiplier.
 *
 * The length is the MINIMUM over every depot delivering the cargo (the
 * closest depot is what actually turns the truck around fastest). Deterministic
 * and cheap — `roadRouteForHarvester` runs per qualifying depot, and this is
 * only recomputed on `refresh` (a network change), never per frame.
 */
export function deliveryDistances(
  state: EconomyState, owner: string, now: number, comp?: Components,
): Partial<Record<Cargo, number>> {
  const out: Partial<Record<Cargo, number>> = {};
  const c = comp ?? buildAllComponents(state.track, ownerIdOf(state, owner));
  for (const h of state.harvesters) {
    if (h.owner !== owner) continue;
    const route = roadRouteForHarvester(state, h, c);
    if (!route) continue;                       // rail-only / unserviced
    for (const ind of industriesInCatchment(state.grid, h)) {
      if (ind.banditUntil > now) continue;      // blockaded industry yields nothing
      const def = INDUSTRY_BY_KEY[ind.type];
      if (!def) continue;
      const len = route.length;
      out[def.cargo] = Math.min(out[def.cargo] ?? len, len);
    }
  }
  return out;
}



// ── the quarry ─────────────────────────────────────────────────────────────
export interface QuarryHooks {
  /** A token was matched and paid: a reachable cargo, or a forged token. */
  onHarvest?: (cargo: Cargo, amount: number) => void;
  /**
   * A NETWORK token was matched but the line is down: refused, so the player
   * learns. A forged token never arrives here (PP-13) — it always pays.
   */
  onBlocked?: (cargo: Cargo, amount: number) => void;
  /**
   * W5: the board banked a combo coin. This is the wire the old game never
   * connected — without a listener here the coin died on the board and the
   * purse (and the whole Black Market) never saw it.
   */
  onGold?: (n: number) => void;
  /** Per-match summary, cargo-keyed, for the floating gain readout. */
  onGains?: (gains: Partial<Record<Cargo, number>>, label: string) => void;
  /**
   * A1: the same per-match summary in GEM space, which is what the floating
   * readout over the board draws (it shows gem icons). It fires for every
   * settle that has gains OR a label — including a tokenless cascade, whose
   * `gains` is empty but whose COMBO label is the whole point.
   */
  onPopup?: (gains: Partial<Record<ResKey, number>>, label: string) => void;
  /** Tokens appeared/disappeared: the panel redraws. */
  onTokens?: (pool: Partial<Record<ResKey, number>>) => void;
  onChange?: () => void;
}

export interface Quarry {
  board: Board;
  /** Cargo per tick the network delivered at the last refresh. */
  reach: Partial<Record<Cargo, number>>;
  /**
   * RV-03: shortest truck-route length (tiles) per cargo, from the last
   * refresh. `undefined` = the cargo is rail-only / not road-truck-paced.
   */
  delivery: Partial<Record<Cargo, number>>;
  /** Recompute the reachable set; spawn tokens for newly reached cargo. */
  refresh(now: number): Partial<Record<Cargo, number>>;
  /**
   * A1: tell the quarry which cargoes a LORRY already delivers, so its own
   * clock stops double-spawning them. A cargo with no lorry (rail-only, or a
   * depot with no road route) keeps the base clock.
   */
  setTruckServed(cargos: Iterable<Cargo>): void;
  /**
   * A1: a lorry reached the Factory — mint this cargo's token NOW.
   *
   * Returns the tier minted (1 or 2), or 0 when the delivery landed nothing:
   * the line is cut, or every gem of that colour already carries a token. The
   * caller only draws the "+N" at the Factory when this is non-zero, so the
   * number on the map and the token on the board can never disagree.
   */
  deliver(cargo: Cargo): number;
  /** Per-frame: board effects plus the token spawn for cargo no lorry serves. */
  tick(now: number): void;
}

export function createQuarry(
  state: EconomyState, owner: string, hooks: QuarryHooks = {},
  boardArg?: Board,
): Quarry {
  // AI-03: the board can be SHARED (the rival's plant: rival-plant.ts owns
  // the same grid the Sabotage cards and the peek panel address). Default
  // stays own-board for the single-player quarry.
  const board = boardArg ?? new Board();
  let reach: Partial<Record<Cargo, number>> = {};
  let delivery: Partial<Record<Cargo, number>> = {};
  let lastPool: Partial<Record<ResKey, number>> = {};
  let lastDelivery: Partial<Record<Cargo, number>> = {};
  // RV-03: per-gem-colour spawn clock. `nextSpawnAt[res]` is the next wall
  // time that cargo upgrades a gem; the interval is `spawnIntervalFor` (base
  // + the truck-route distance). Replaced a single `lastTokenAt`.
  const nextSpawnAt: Partial<Record<ResKey, number>> = {};

  // ── the board pays cargo, gated by the network ──
  // The gate reads the network at MATCH TIME, not from the cached reach the
  // panel shows. A cached gate is only as fresh as the last refresh, which
  // means "demolish the road, match the tokens anyway" would pay out — the
  // exact bug this ticket exists to prevent. Recomputing the reachable set is
  // one flood fill over the two track layers, so paying it per token is free.
  board.onHarvest = (res: ResKey, amount: number, forged: boolean) => {
    const cargo = GEM_TO_CARGO[res];
    reach = reachableCargo(state, owner, performance.now());
    // PP-13: a FORGED token — the tier-1 gem a 4-in-a-row mints (tier-2 for
    // 5+) — pays no matter what the network reaches. It is the board's own
    // reward for the long match, and gating it meant "match four wood, then
    // match the token it left you with two more wood" paid nothing at all
    // unless a depot already sat on a forest. Network-spawned tokens stay
    // gated: that refusal is the whole J1 rule and it still fires.
    if (forged || (reach[cargo] ?? 0) > 0) {
      // Depot-fed tokens pay more than match-3 bonuses so the plant never
      // outpaces a connected depot. Forged / match-5 extras stay at face value.
      const paid = forged ? amount : amount * 2;
      hooks.onHarvest?.(cargo, paid);
      // A1: hand the credited amount back to the board. It is what the purse
      // actually received, so it is what the floating readout has to show —
      // returning bare `true` here would let the pop advertise the face value
      // while the purse banked double.
      return paid;
    }
    hooks.onBlocked?.(cargo, amount);
    return false;
  };
  // W5: the coin the board banks on a combo goes straight to the purse.
  board.onGold = (n: number) => hooks.onGold?.(n);
  board.onPopup = (gains, label) => {
    // PP-13: the board accumulates a gain ONLY for a harvest `onHarvest` said
    // was paid, so this is exactly what reached the purse — re-gating it here
    // on `reach` is what used to swallow a forged token's payout from the
    // floating readout even when the purse had been credited.
    const out: Partial<Record<Cargo, number>> = {};
    for (const [res, n] of Object.entries(gains) as [ResKey, number][]) {
      const cargo = GEM_TO_CARGO[res];
      out[cargo] = (out[cargo] ?? 0) + n;
    }
    // A1: the floating readout draws GEMS, not cargo, so it takes the raw
    // gains — and it fires even when `out` is empty, because a tokenless
    // cascade still has its COMBO label to show.
    hooks.onPopup?.(gains, label);
    if (Object.keys(out).length) hooks.onGains?.(out, label);
  };
  board.onChange = () => hooks.onChange?.();

  // PP-09: gold gems drop (join the board's gravity pool) the moment a depot
  // sits beside a gold mine. Apply the gate up front in case the state is
  // created with a depot already there, and re-apply it on every refresh.
  board.setGoldEnabled(hasGoldMineDepot(state, owner));

  const refresh = (now: number) => {
    // PP-09: placement-gated gold drops — recompute alongside the reachable
    // set, since every build/demolish already funnels through refresh.
    board.setGoldEnabled(hasGoldMineDepot(state, owner));
    reach = reachableCargo(state, owner, now);
    delivery = deliveryDistances(state, owner, now);
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
      // A cargo that just BECAME reachable gets its first token immediately — a
      // connection is a reward, not a wait — and then settles into its paced
      // cadence from here.
      board.spawnTokens(gained);
      hooks.onTokens?.(gained);
    }
    // (Re)arm the spawn clock for every reachable cargo. A1: this clock now
    // only ever fires for cargo NO lorry carries — a lorry-served cargo is
    // delivered by the lorry's arrival. It still re-arms on a network change,
    // so a cargo that loses its lorry (road torn up, rail-only connection)
    // picks the fallback cadence up from here rather than from a stale time.
    for (const res of Object.keys(pool) as ResKey[]) {
      const cargo = GEM_TO_CARGO[res];
      const dist = delivery[cargo];
      if (gained[res] !== undefined || nextSpawnAt[res] === undefined
        || dist !== lastDelivery[cargo]) {
        nextSpawnAt[res] = now + SPAWN_BASE_MS;
      }
    }
    lastPool = pool;
    lastDelivery = { ...delivery };
    return reach;
  };

  // A1: the cargoes a LORRY delivers. Their tokens are minted by the lorry's
  // arrival (`deliver`), so the clock must keep its hands off them — otherwise
  // one delivery would be paid twice, once on the road and once on a timer
  // that knows nothing about the road.
  let truckServed = new Set<Cargo>();

  const tick = (now: number) => {
    board.tickEffects(now);
    const pool = tokenPool(reach);
    for (const res of Object.keys(pool) as ResKey[]) {
      if (truckServed.has(GEM_TO_CARGO[res])) continue;   // the lorry owns it
      const at = nextSpawnAt[res];
      if (at === undefined) {
        nextSpawnAt[res] = now + SPAWN_BASE_MS;
        continue;
      }
      if (now < at) continue;
      board.spawnTokens({ [res]: pool[res] });
      nextSpawnAt[res] = now + SPAWN_BASE_MS;
    }
  };

  const setTruckServed = (cargos: Iterable<Cargo>) => {
    truckServed = new Set(cargos);
  };

  /**
   * A1: a lorry arrived at the Factory with this cargo — mint its token now,
   * in the same frame the "+N" pops over the Factory tile.
   *
   * The tier is whatever the network currently earns for that cargo (tier 2
   * at `TIER2_YIELD` and above), and a return of 0 means the lorry came back
   * empty: either the line is cut, or the board has no plain gem of that
   * colour left to upgrade. The caller must not draw a "+N" for an empty load.
   */
  const deliver = (cargo: Cargo): number => {
    const res = CARGO_TO_GEM[cargo];
    const tier = tokenPool(reach)[res];
    if (tier === undefined) return 0;              // nothing reachable to load
    return board.spawnTokens({ [res]: tier }) > 0 ? tier : 0;
  };

  // `reach` / `delivery` are reassigned on every refresh, so expose them
  // through getters — a plain property would freeze the empty set the quarry
  // booted with.
  return {
    board,
    get reach() { return reach; },
    get delivery() { return delivery; },
    refresh,
    setTruckServed,
    deliver,
    tick,
  };
}

/** Gems of one colour that currently carry a harvest token. */
export const tokenedGems = (board: Board, res: ResKey): Gem[] =>
  board.gems().filter((g) => g.res === res && g.tier > 0);
