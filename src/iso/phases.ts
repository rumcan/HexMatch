// ══════════════════════════════════════════════════════════════════════════
// BAL-1 (#471) — PHASE BEATS.
//
// A match should have a clear arc (land grab → logistics race → contests →
// finale). The arc is TELEGRAPHED, not scripted: the Feed announces a beat
// when the ★ LEADER crosses a share of the line, whichever seat that is, so
// the pacing line is about the race rather than about the player.
//
//   "Mid-game: tenders open"       at PHASE_BEATS.midgame × target ★
//   "Final stretch: X★ to win"     at PHASE_BEATS.final × target ★
//
// Pure and side-effect free: `game.ts` owns the Feed and the seen-set, so a
// save, a replay and a headless sim can all ask "is there a beat due?" and
// get the same answer. CONTRACT-1's tenders are the thing the mid-game line
// promises; until that lands the beat is only the announcement (which is what
// makes the arc readable even before the tenders themselves).
// ══════════════════════════════════════════════════════════════════════════

export type PhaseBeatId = "midgame" | "final";

export interface PhaseBeatDef {
  id: PhaseBeatId;
  /** Share of the ★ line the LEADER must reach for the beat to fire. */
  atFraction: number;
  /** The Feed line, given the ★ line the match races to. */
  text: (target: number) => string;
}

export const PHASE_BEATS: readonly PhaseBeatDef[] = [
  {
    id: "midgame",
    atFraction: 1 / 3,
    text: () => "Mid-game: tenders open.",
  },
  {
    id: "final",
    atFraction: 2 / 3,
    // "X★ to win" is the LINE — the thing both seats are racing to, so the
    // beat reads the same in the Feed no matter who is ahead when it lands.
    text: (target) => `Final stretch: ${target}★ to win.`,
  },
];

/**
 * The beat due at this leaderboard state, or null. `seen` is the caller's
 * already-announced set (a beat fires exactly once per match). The leader is
 * the MAX of the two seats' ★ — the arc follows the race, not one seat.
 */
export function phaseBeatFor(
  youStar: number, aiStar: number, target: number, seen: ReadonlySet<PhaseBeatId>,
): PhaseBeatDef | null {
  if (!(target > 0)) return null;
  const leader = Math.max(youStar, aiStar);
  for (const beat of PHASE_BEATS) {
    if (seen.has(beat.id)) continue;
    if (leader >= beat.atFraction * target) return beat;
  }
  return null;
}

/** Every beat that is due, in order — for the harness and the tests. */
export function phaseBeatsDue(
  youStar: number, aiStar: number, target: number,
): PhaseBeatDef[] {
  const seen = new Set<PhaseBeatId>();
  const out: PhaseBeatDef[] = [];
  for (;;) {
    const beat = phaseBeatFor(youStar, aiStar, target, seen);
    if (!beat) break;
    seen.add(beat.id);
    out.push(beat);
  }
  return out;
}
