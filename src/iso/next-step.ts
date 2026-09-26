// ══════════════════════════════════════════════════════════════════════════
// GOAL-1 (#459): the "Next step" advisor — one line that always says what to
// do next, derived from live state by a strict priority list.
//
// Pure function, importable from unit tests. game.ts wires the live state
// in and consumes {text, target, tool}; ui.ts paints the line and routes a
// click → camera pan + tool arm through the same hooks a player uses.
//
// CONTRACT-1 (#466) and RIVAL-3 (#467) plug into rules 5 and 7 respectively;
// until those tickets land those rules return null (skip) so the rest of
// the list still fires.
// ══════════════════════════════════════════════════════════════════════════
import { CARGO, CARGOES, TOWN_UPGRADES } from "./config";
import type { Cargo } from "./config";
import { priceTownUpgrade, storageCapFor } from "./construction";
import type { Purse } from "./track";
import type { Factory, Harvester } from "./economy";
import type { Industry, Town } from "./grid";

/** A tool the advisor can ask the chrome to arm. Mirrors Tool in game.ts without importing it. */
export type AdvisorTool =
  | "plant"      // Processing Plant / Factory
  | "harvester"  // Depot
  | "road"
  | "rail"
  | "city"       // Town upgrade (onTownUpgrade door)
  | "market"     // Market / sell tab
  | "select";

/** The result of evaluating the priority list for one frame. */
export interface NextStep {
  /** Stable key (so ui.ts can detect changes and not churn textContent). */
  key: string;
  /** The line the player reads. */
  text: string;
  /** Tile the camera should centre on when the line is clicked; null = recentre on the player's anchor. */
  target: { tx: number; ty: number } | null;
  /** Tool the click should arm; null keeps whatever is in the hand. */
  tool: AdvisorTool | null;
}

/** Tuning session info — while a session is open, IT is what to do next. */
export interface AdvisorTuning {
  kind: "depot" | "town";
  /** The session's cargo; null on a city session (the board plays neutral). */
  cargo: Cargo | null;
  movesLeft: number;
  moves: number;
  /** The depot/town tile the session is anchored to (for click pan). */
  target?: { tx: number; ty: number } | null;
}

/** Input view of the world the advisor reads from. Every field is a plain value, never a function. */
export interface NextStepInput {
  /** Live phase string (`setup-factory` · `setup-harvester` · `play` · `won` · …). */
  phase: string;
  /** The player's seat id ("you" in solo, etc.). */
  playerId: string;
  /** The player's Factory records (starting factory is id 0). */
  factories: readonly Factory[];
  /** All Depots in the world (rail-platform Depots included). */
  harvesters: readonly Harvester[];
  /** Map industries (resource nodes). */
  industries: readonly Industry[];
  /** Map towns. */
  towns: readonly Town[];
  /**
   * Predicate: is this Depot connected (road OR rail).
   * Caller owns the real rules; this module just asks.
   */
  isConnected: (h: Harvester) => boolean;
  /** The player's money ($). */
  money: number;
  /** The player's cargo purse. */
  purse: Purse;
  /** Free-depot allowance remaining. */
  freeDepots: number;
  /** The player's current depot tier (rung unlocked). */
  depotTier: number;
  /** Town upgrade level bought so far. */
  townLevel: number;
  /**
   * The market's per-cargo price at this clock. Rule 4 fires only when a
   * cargo is stockpiled (at/above the player's storage cap) AND money is
   * above the IDLE threshold. Null/undefined = market unavailable.
   */
  marketPrices?: Partial<Record<Cargo, number>> | null;
  /** Open tuning session, if any — while up it is what to do next. */
  tuning?: AdvisorTuning | null;
  /**
   * Active contract for this seat (CONTRACT-1 #466). Null until that ticket lands.
   */
  activeContract?: { label: string; target: { tx: number; ty: number } | null } | null;
  /**
   * Contested industry nearby (RIVAL-3 #467). Null until that ticket lands.
   */
  contestedIndustry?: { name: string; target: { tx: number; ty: number } } | null;
  /** Target ★ to win (used for the fallback "chase stars" line). */
  winTarget: number;
  /** Whether the new economy loop is active (rules 4/6 only make sense under it). */
  newLoop: boolean;
}

/** Money idle threshold: above this AND stockpiled, suggest selling. */
export const IDLE_MONEY_THRESHOLD = 200;

/** Chebyshev-ish tile distance for "nearest" picks. */
const tileDist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.max(Math.abs(ax - bx), Math.abs(ay - by));

/** Centre tile of an industry. */
const industryCenter = (i: Industry): { tx: number; ty: number } => ({
  tx: i.tx + Math.floor(i.w / 2),
  ty: i.ty + Math.floor(i.h / 2),
});

/** Centre tile of a town. */
const townCenter = (t: Town): { tx: number; ty: number } => ({ tx: t.tx, ty: t.ty });

/** Factory anchor tile (same tile `recenterCamera` uses). */
const factoryCenter = (f: Factory): { tx: number; ty: number } => ({ tx: f.tx, ty: f.ty });

/** Depot centre tile (midpoint of its 2×2 lot). */
const depotCenter = (h: Harvester): { tx: number; ty: number } => ({ tx: h.tx + 1, ty: h.ty + 1 });

/** True when an industry is inside the catchment area of a Depot. */
const industryClaimedBy = (ind: Industry, h: Harvester): boolean =>
  tileDist(
    ind.tx + Math.floor(ind.w / 2),
    ind.ty + Math.floor(ind.h / 2),
    h.tx + 1,
    h.ty + 1,
  ) <= 2;

/**
 * The priority list, first match wins:
 *   1. Won / tuning session open  → session says what to do.
 *   2. No Factory                  → place Factory beside a town.
 *   3. No Depot                    → claim an industry: build a Depot inside its catchment.
 *   4. Depot not connected         → connect to Factory with a road.
 *   5. Money idle + stockpile      → sell at the Market.
 *   6. Contract active             → its progress (CONTRACT-1, placeholder).
 *   7. Town upgrade affordable     → "Upgrade (+x% yield)."
 *   8. Contested industry nearby   → "Race the rival for …" (RIVAL-3, placeholder).
 *   9. Otherwise                   → nearest ★ source.
 */
export function nextStep(state: NextStepInput): NextStep {
  // Tuning session open — the board IS what to do next.
  if (state.tuning) {
    const t = state.tuning;
    const left = `${t.movesLeft}/${t.moves} moves left`;
    if (t.kind === "town") {
      return { key: "tuning-town", text: `Match to set your city's base rate — ${left}.`, target: t.target ?? null, tool: null };
    }
    const cargo = t.cargo ? `${CARGO[t.cargo].name} ` : "";
    return {
      key: "tuning-depot",
      text: `Match to set your ${cargo}Depot's output — ${left}.`,
      target: t.target ?? null,
      tool: null,
    };
  }

  if (state.phase === "won") {
    return { key: "won", text: `You reached ${state.winTarget}★ — you win.`, target: null, tool: null };
  }

  // ── 1. No Factory ────────────────────────────────────────────────────────
  const myFactory = state.factories.find((f) => f.owner === state.playerId) ?? null;
  if (!myFactory || state.phase === "setup-factory") {
    // Aim at the nearest town (the closest one from map origin — mirrors
    // the boot behaviour where Factory placement expects a town beside it).
    const nearestTown = state.towns.length
      ? [...state.towns].sort((a, b) => tileDist(0, 0, a.tx, a.ty) - tileDist(0, 0, b.tx, b.ty))[0]
      : null;
    const target = nearestTown ? townCenter(nearestTown) : null;
    return {
      key: "place-factory",
      text: "Place your Factory beside a town.",
      target,
      tool: "plant",
    };
  }

  // ── 2. No Depot ──────────────────────────────────────────────────────────
  const myDepots = state.harvesters.filter((h) => h.owner === state.playerId && !h.closed);
  if (myDepots.length === 0 || state.phase === "setup-harvester") {
    const claimed = new Set<number>();
    for (const h of state.harvesters) {
      if (h.closed) continue;
      for (const ind of state.industries) {
        if (industryClaimedBy(ind, h)) claimed.add(ind.id);
      }
      if (h.railIndustryId !== undefined) claimed.add(h.railIndustryId);
    }
    const fac = factoryCenter(myFactory);
    const candidates = state.industries.filter((i) => !claimed.has(i.id));
    const target = candidates.length
      ? industryCenter(
          [...candidates].sort((a, b) => {
            const ca = industryCenter(a), cb = industryCenter(b);
            return tileDist(ca.tx, ca.ty, fac.tx, fac.ty) - tileDist(cb.tx, cb.ty, fac.tx, fac.ty);
          })[0],
        )
      : null;
    return {
      key: "place-depot",
      text: "Claim an industry: build a Depot inside its catchment.",
      target,
      tool: "harvester",
    };
  }

  // ── 3. Depot not connected ───────────────────────────────────────────────
  const disconnected = myDepots.find((h) => !state.isConnected(h));
  if (disconnected) {
    return {
      key: "connect-depot",
      text: "Connect to your Factory with a road.",
      target: depotCenter(disconnected),
      tool: "road",
    };
  }

  // ── The rest of the rules only apply under the new economy loop. ─────────
  if (state.newLoop) {
    // ── 4. Money idle above threshold AND cargo stockpiled ───────────────
    if (state.money >= IDLE_MONEY_THRESHOLD && state.marketPrices) {
      const cap = storageCapFor(state.townLevel);
      const fullCargo = CARGOES.find((c) => {
        const have = state.purse[c] ?? 0;
        return c !== "gold" && have >= cap && (state.marketPrices?.[c] ?? 0) > 0;
      });
      if (fullCargo) {
        const price = state.marketPrices[fullCargo] ?? 0;
        return {
          key: `sell-${fullCargo}`,
          text: `Sell at the Market: ${CARGO[fullCargo].name} price is $${Math.round(price)}.`,
          target: factoryCenter(myFactory),
          tool: "market",
        };
      }
    }

    // ── 5. Contract active (CONTRACT-1 #466) ────────────────────────────
    if (state.activeContract) {
      return {
        key: `contract-${state.activeContract.label}`,
        text: state.activeContract.label,
        target: state.activeContract.target,
        tool: null,
      };
    }

    // ── 6. Town upgrade is affordable ───────────────────────────────────
    if (state.townLevel < TOWN_UPGRADES.length) {
      const up = priceTownUpgrade(state.purse, state.townLevel);
      if (up.affordable && up.def) {
        return {
          key: `town-upgrade-${state.townLevel}`,
          text: `Upgrade (+${Math.round(up.def.bonus * 100)}% yield).`,
          target: factoryCenter(myFactory),
          tool: "city",
        };
      }
    }

    // ── 7. Contested industry nearby (RIVAL-3 #467) ─────────────────────
    if (state.contestedIndustry) {
      return {
        key: `contest-${state.contestedIndustry.name}`,
        text: `Race the rival for ${state.contestedIndustry.name}`,
        target: state.contestedIndustry.target,
        tool: "harvester",
      };
    }
  }

  // ── 8. Otherwise: the nearest ★ source ──────────────────────────────────
  const claimed = new Set<number>();
  for (const h of myDepots) {
    for (const ind of state.industries) {
      if (industryClaimedBy(ind, h)) claimed.add(ind.id);
    }
  }
  const fac = factoryCenter(myFactory);
  const remaining = state.industries.filter((i) => !claimed.has(i.id));
  if (remaining.length) {
    const near = [...remaining].sort((a, b) => {
      const ca = industryCenter(a), cb = industryCenter(b);
      return tileDist(ca.tx, ca.ty, fac.tx, fac.ty) - tileDist(cb.tx, cb.ty, fac.tx, fac.ty);
    })[0];
    const nearC = industryCenter(near);
    return {
      key: `next-star-${near.type}`,
      text: `Reach ${state.winTarget}★ — head for the nearest ★ source.`,
      target: nearC,
      tool: "harvester",
    };
  }
  return {
    key: "win",
    text: `Reach ${state.winTarget}★ — tune, expand or upgrade.`,
    target: factoryCenter(myFactory),
    tool: null,
  };
}
