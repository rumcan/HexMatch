// ══════════════════════════════════════════════════════════════════════════
// A1 (as of L10 / #225) — the rival's Processing Plant.
//
// The Black Market bug this file was written to fix is long fixed: Frost
// Tiles, Iron Girders and Smog Cloud used to fire into `quarry.board` — the
// buyer's OWN board — and the fix gave the rival a plant of its own for them
// to land on.
//
// #225 removed the cards themselves. Board obstacles are a difficulty's now,
// placed when a tuning session opens, so there is nothing left to land on
// anybody's board: no sabotage, no expiry clocks, and no damage model — the
// rival's income is never scaled by how wrecked a plant looks, because nothing
// can wreck it. What it is scaled by is the SIMULATED SESSION (L4), docked once
// by the obstacles that difficulty puts on a board (see `rivalTuningYield`'s
// `rules` argument in `tuning.ts`).
//
// So what is left here is the plant AS A BOARD: the surface AI-03's autoplayer
// plays one watchable move at a time on, and the surface the peek panel paints.
// It is the rival's own board — the player's is `quarry.board` — and it is a
// plain `Board` with a name, because a name is worth more than a wrapper with
// one field in it.
// ══════════════════════════════════════════════════════════════════════════
import { Board } from "../game/board";

/**
 * L10 (#225) — the rival's plant: one board, and the plant's own status line.
 *
 * `createRivalPlant` keeps its name and its shape (the game, the quarry and the
 * peek panel all read `rivalPlant.board`) but it holds nothing else: the
 * frost/girder/smog counters, their three expiry clocks, `health()` and
 * `tick()` are gone with the cards that fed them.
 */
export interface RivalPlant {
  /** The rival's match-3 board — AI-03 plays it, the peek panel shows it. */
  board: Board;
  /**
   * What is standing on the plant right now, for the peek panel's status
   * line. Obstacles reach this board the same way they reach any other —
   * through `Board.seedObstacles` at the start of a session — so on the
   * rival's board this reads "healthy" unless something has put an obstacle
   * on it.
   */
  status(): { frozen: number; girders: number };
}

export function createRivalPlant(): RivalPlant {
  const board = new Board();
  return {
    board,
    status: () => {
      const { frost, girders } = board.obstacleCounts();
      return { frozen: frost, girders };
    },
  };
}
