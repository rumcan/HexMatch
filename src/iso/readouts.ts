// ══════════════════════════════════════════════════════════════════════════
// L8 (#222) — the loop made legible: the objective line and the income
// readouts, as pure rules.
//
// The redesign pays a connected Depot
//
//     BASE_RATE × yield × distanceFactor × transportFactor × (1 + cityBonus)
//
// once every `HARVEST_MS`, and the player has to be able to READ that loop:
// what to do next (the objective line), what one Depot is worth per tick and
// per second (the inspector), and which cargo is earning right now (the chip
// rate).
//
// Every number here is a pure view over inputs the clock already owns — the
// same yield level, distance factor, transport factor and city bonus
// `economyTick` multiplies — so what the HUD prints and what the clock pays
// cannot drift apart. The chrome (ui.ts) styles it; this module decides it.
//
// The tick length is a PARAMETER, not an import: the game owns `HARVEST_MS`
// (game.ts) and this module must stay importable from a unit test that never
// boots a game (and must not create a cycle back into game.ts).
// ══════════════════════════════════════════════════════════════════════════
import { BASE_RATE, CARGO, DEPOT_TIER_MAX, type Cargo } from "./config";
import type { DistanceBand } from "./loop";

/**
 * The rate below which a cargo is "not ticking" — the chip readout's own
 * visibility rule (ui.ts), kept here so the number the game publishes and the
 * number the chip shows are one decision instead of two matching ones.
 */
export const RATE_EPSILON = 0.05;

/** A multiplier the way the inspector prints one: ×1.4, ×1, ×1.75 — never ×1.40. */
export const fmtMult = (n: number): string => `×${Number(n.toFixed(2))}`;

/** A rate the way the inspector prints one: 2.35, 2.4, 8, 0.8 — no dead zeros. */
export const fmtRate = (n: number, digits = 2): string => `${Number(n.toFixed(digits))}`;

// ── the tick, one line ────────────────────────────────────────────────────
export interface TickRateInput {
  /** Per-tick cargo BEFORE the factors — `harvesterYield`'s `yields[cargo]`. */
  amount: number;
  /** `depotYield(depot)` — what the tuning session set (or the baseline). */
  yieldLevel: number;
  /** `distanceInfoFor(depot).factor` — the banded road-distance multiplier. */
  distanceFactor: number;
  /** `transportFactor(depot)` — dirt vs paved. */
  transportFactor: number;
  /** The seat's city-upgrade multiplier (0 = nothing raised). */
  townBonus: number;
  /**
   * R3 (#270): the dam bonus — 0, or `DAM_BONUS` when the seat's own dam
   * reaches this Depot (`dams.ts`). Multiplied like the city term, beside it,
   * so the readout prints the factor the clock pays. Absent = no dam, which
   * a pre-dam caller (a legacy harness) keeps byte-for-byte.
   */
  damBonus?: number;
}

/**
 * The factor the clock multiplies a Depot's cargo by — the same expression
 * `economyTick` builds, in one place. A negative city bonus (nothing in the
 * live game can produce one; a hand-edited save could) clamps to 0, exactly
 * as the clock clamps it.
 */
export function tickFactor(v: Omit<TickRateInput, "amount">): number {
  return BASE_RATE * v.yieldLevel * v.distanceFactor * v.transportFactor
    * (1 + Math.max(0, v.damBonus ?? 0))
    * (1 + Math.max(0, v.townBonus));
}

/** What one tick of this Depot pays, before the integer carry. */
export const tickAmount = (v: TickRateInput): number => v.amount * tickFactor(v);

/** Per-tick numbers as the player reads them: the tick, and the second. */
export const perSecond = (perTick: number, tickMs: number): number => perTick * (1000 / tickMs);

export interface TickRate { perTick: number; perSecond: number }

export const tickRate = (v: TickRateInput, tickMs: number): TickRate => {
  const perTick = tickAmount(v);
  return { perTick, perSecond: perSecond(perTick, tickMs) };
};

// ── the chip bar: per-second income per cargo ─────────────────────────────
export interface RateRow extends TickRateInput { cargo: Cargo }

/**
 * Sum the rows per cargo, per second — what the chip bar prints beside the
 * purse. Only cargos that actually tick are published: a cargo at 0/s stays
 * quiet rather than advertising a zero (ui.ts hides anything below
 * `RATE_EPSILON` anyway, and the two rules are the same rule).
 */
export function incomeRates(
  rows: readonly RateRow[], tickMs: number,
): Partial<Record<Cargo, number>> {
  const out: Partial<Record<Cargo, number>> = {};
  for (const row of rows) {
    const rate = perSecond(tickAmount(row), tickMs);
    out[row.cargo] = (out[row.cargo] ?? 0) + rate;
  }
  for (const cargo of Object.keys(out) as Cargo[]) {
    if (Math.abs(out[cargo] ?? 0) < RATE_EPSILON) delete out[cargo];
  }
  return out;
}

// ── the objective line: one line, always the current goal ────────────────
export interface ObjectiveTuning {
  kind: "depot" | "town";
  /** The session's cargo; null on a city session (the board plays neutral). */
  cargo: Cargo | null;
  movesLeft: number;
  moves: number;
}

export interface ObjectiveView {
  /** The live phase (`setup-factory` · `setup-harvester` · `play` · …). */
  phase: string;
  /** The open tuning session, if any — the board is what to do next. */
  tuning: ObjectiveTuning | null;
  /** This seat's Depots, and how many of them are on the clock. */
  depotCount: number;
  connectedCount: number;
  /** The plate's own re-match offer (null = nothing owed). */
  retune: { cargo: Cargo | null } | null;
  /** The city ladder: the level reached, and the table's height. */
  townLevel: number;
  townLevelCount: number;
  /**
   * The next depot-tree type this seat has NOT unlocked, when its mix is
   * already in the purse — the "build a Quarry Depot to unlock the next rung"
   * step of the tree. Null when every rung is open or nothing is affordable.
   */
  nextRung: { name: string; tier: number } | null;
  winTarget: number;
}

export interface Objective { key: string; text: string }

/**
 * The one line that always says the current goal on the new loop.
 *
 * The ORDER is the loop's own order, and it is what makes the line stable:
 * the setup debts first (Factory, Depot), then the board when it is up (a
 * session IS what to do next), then the network (build · connect), then the
 * two upgrade axes (re-tune · new rung · city), and the win line last. Each
 * step has its own `key` so a caller can tell "the goal changed" from "the
 * goal is the same goal with new numbers" (moves left, the ★ line).
 */
export function objectiveLine(v: ObjectiveView): Objective {
  if (v.phase === "setup-factory") {
    return { key: "setup-factory", text: "Place your Factory beside a town — it anchors your whole network." };
  }
  if (v.phase === "setup-harvester") {
    return {
      key: "setup-harvester",
      text: "Place your first Depot inside an industry's catchment — the road comes next.",
    };
  }
  if (v.tuning) {
    const left = `${v.tuning.movesLeft}/${v.tuning.moves} moves left`;
    if (v.tuning.kind === "town") {
      return { key: "tuning-town", text: `Match to set your city's base rate — ${left}.` };
    }
    const cargo = v.tuning.cargo ? `${CARGO[v.tuning.cargo].name} ` : "";
    return { key: "tuning-depot", text: `Match to set your ${cargo}Depot's output — ${left}.` };
  }
  if (v.depotCount === 0) {
    return {
      key: "need-depot",
      text: "Connect an industry to your city — build a Depot in a catchment, then road it in.",
    };
  }
  if (v.connectedCount === 0) {
    return {
      key: "need-road",
      text: "Connect a Depot to your Factory with a road — then it ticks every 3s.",
    };
  }
  if (v.retune) {
    const cargo = v.retune.cargo ? `${CARGO[v.retune.cargo].name} ` : "";
    return { key: "retune", text: `Re-tune your weakest ${cargo}Depot — the plant panel is offering it.` };
  }
  if (v.nextRung) {
    return {
      key: "unlock-rung",
      text: `Build a ${v.nextRung.name} to unlock rung ${v.nextRung.tier + 1}/${DEPOT_TIER_MAX}.`,
    };
  }
  if (v.townLevel < v.townLevelCount) {
    return {
      key: "grow",
      text: "Upgrade your city to boost output — every connected Depot ticks faster.",
    };
  }
  return {
    key: "win",
    text: `Reach ${v.winTarget}★ — tune a Depot, connect a new cargo, or raise the city.`,
  };
}

// ── the Depot inspector: the numbers the clock multiplies ────────────────
export interface DepotReadoutInput {
  /** `depotYield(depot)`. */
  yieldLevel: number;
  /** "dirt" · "paved" — what the link is paid as. */
  transportLabel: string;
  transportFactor: number;
  distanceTiles: number | null;
  distanceFactor: number;
  distanceBand: DistanceBand | null;
  /** The cargo and per-tick amount before the factors (0/absent = nothing held). */
  cargo: Cargo | null;
  amount: number;
  serviced: boolean;
  /** A Protest stands on this Depot's route — it is not ticking right now. */
  stopped: boolean;
  townBonus: number;
  /** R3 (#270): the dam bonus reaching this Depot (0 or `DAM_BONUS`). */
  damBonus?: number;
  /** The difficulty's cooling, as a fraction of the level per tick (0 = none). */
  decayRate: number;
  /** The floor the cooling stops at (the difficulty's `minYield`). */
  minYield: number;
  tickMs: number;
}

export interface DepotReadout {
  perTick: number;
  perSecond: number;
  /** "yield: ×1.4 · transport: paved ×1.6" */
  yieldLine: string;
  /** "rate: 12/tick · 4/s ⛰️ Ore" · "rate: no route — not ticking" (+ protest) */
  rateLine: string;
  /** "decay: 4%/tick above ×1" — null on rows with no cooling. */
  decayLine: string | null;
  /** "dam: ×1.25 — hydro dam nearby" — null when no dam reaches the Depot. */
  damLine: string | null;
}

/**
 * Everything one Depot's income reads as, off the numbers the clock uses.
 *
 * A Depot that is not serviced (no road route, or no link to a plant) prints
 * "no route — not ticking" instead of a rate: `harvesterYield` pays it
 * nothing, and a number here would be the ledger lie the redesign closed (the
 * inspector has no business promising income the tick will not pay).
 */
export function depotReadout(v: DepotReadoutInput): DepotReadout {
  const rate = tickRate(
    {
      amount: v.serviced ? v.amount : 0,
      yieldLevel: v.yieldLevel,
      distanceFactor: v.distanceFactor,
      transportFactor: v.transportFactor,
      townBonus: v.townBonus,
      damBonus: v.damBonus,
    },
    v.tickMs,
  );
  const yieldLine = `yield: ${fmtMult(v.yieldLevel)} · transport: ${v.transportLabel} ${fmtMult(v.transportFactor)}`;
  let rateLine: string;
  if (!v.serviced) {
    rateLine = "rate: <i>no route — not ticking</i>";
  } else {
    const cargo = v.cargo ? ` ${CARGO[v.cargo].icon} ${CARGO[v.cargo].name}` : "";
    rateLine = `rate: ${fmtRate(rate.perTick)}/tick · ${fmtRate(rate.perSecond, 1)}/s${cargo}`;
    if (v.stopped) rateLine += " · <i>protest — stopped</i>";
  }
  const decayLine = v.decayRate > 0
    ? `decay: ${fmtRate(v.decayRate * 100, 1)}%/tick above ${fmtMult(v.minYield)}`
    : null;
  // R3 (#270): the dam's line prints only when the bonus is live for THIS
  // Depot — the same gate the clock applies — so a Depot out of range of
  // every dam promises nothing its tick will not pay.
  const damLine = (v.damBonus ?? 0) > 0
    ? `dam: ${fmtMult(1 + v.damBonus!)} — hydro dam nearby`
    : null;
  return { perTick: rate.perTick, perSecond: rate.perSecond, yieldLine, rateLine, decayLine, damLine };
}
