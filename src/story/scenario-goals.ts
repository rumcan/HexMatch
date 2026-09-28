// ══════════════════════════════════════════════════════════════════════════
// SCEN-2 (#602) — a scenario's OBJECTIVE, in the CURRENT loop's own words.
//
// PROG-1 (#475) made a scenario a PLACE wearing a race (a fixed seed, a map
// preset, its own ★ line and its own save slot). SCEN-2 puts the scenarios on
// the redesigned loop, and that leaves one hole PROG-1 never had to fill: a
// scenario's job was only ever implied by the retired loop's furniture — the
// always-on Processing Plant board and its harvest flow. On the new loop
// nothing reminds the player what THIS map is for, so each scenario names one
// objective of its own, in the new loop's verbs:
//
//   deliver  cargo the player's lorries carry INTO their plant — the loop's
//            clock pays the depots, and a depot with no route delivers nothing;
//   tune     the best ★ a PLAYED Depot tuning session reached — the yield
//            ladder, which is the loop's "go tall" axis;
//   rail     a train line actually running — a line with a train assigned,
//            which needs a station at each end and a driver on it;
//   battle   a rival battle WON on the map — a challenge settled the player's
//            way (industry or city), or a fight-off defended.
//
// The module is PURE, like the rest of `src/story`: it takes the numbers the
// game counts and returns the one line the objective lane paints, so the
// wording, the progress and the "is it done" question have exactly one answer
// and a unit test can pin all four without a browser.
//
// The objective is NOT the win condition. A scenario is still a race to its ★
// line (`ScenarioDef.winTarget`), exactly as PROG-1 shipped it: these four
// goals are what the map is FOR — the thing the player does while the race
// runs — and the win check never waits on them.
// ══════════════════════════════════════════════════════════════════════════

export type ScenarioGoalKind = "deliver" | "tune" | "rail" | "battle";

/** One scenario's objective: what it counts and what to call it. */
export interface ScenarioObjective {
  kind: ScenarioGoalKind;
  /** What the goal counts to (cargo · ★ · lines · battles). */
  target: number;
  /** The line the objective lane prints while the goal is open. */
  text: string;
  /** The one line the Feed prints when the goal is met (the scenario's voice). */
  done: string;
}

/** The live counters the four goals read. Plain numbers, never functions. */
export interface ScenarioGoalInput {
  /** Cargo the seat's lorries have carried into its plant this match. */
  delivered: number;
  /** The best ★ a PLAYED Depot tuning session has reached this match. */
  bestTuningStars: number;
  /** Train lines the seat is running (a line with a train on it). */
  trainLines: number;
  /** Rival battles the seat has won on the map this match. */
  battlesWon: number;
}

/** What the goal is counting, read off the matching counter. */
export function scenarioGoalHave(o: ScenarioObjective, s: ScenarioGoalInput): number {
  const raw = o.kind === "deliver" ? s.delivered
    : o.kind === "tune" ? s.bestTuningStars
      : o.kind === "rail" ? s.trainLines
        : s.battlesWon;
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

/** Met means "at or past the target" — the goal line retires the moment it is. */
export function scenarioGoalDone(o: ScenarioObjective, s: ScenarioGoalInput): boolean {
  return scenarioGoalHave(o, s) >= Math.max(1, Math.floor(o.target));
}

/**
 * The objective lane's one line: the scenario's own words plus where the
 * counter stands. `Deliver 12 cargo into your Plant · 3/12`.
 */
export function scenarioGoalLine(o: ScenarioObjective, s: ScenarioGoalInput): string {
  const target = Math.max(1, Math.floor(o.target));
  const have = Math.min(scenarioGoalHave(o, s), target);
  return `${o.text} · ${have}/${target}`;
}
