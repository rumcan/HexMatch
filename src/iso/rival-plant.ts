// ══════════════════════════════════════════════════════════════════════════
// A1 — the rival's Processing Plant.
//
// The Black Market bug: Frost Tiles, Iron Girders and Smog Cloud all called
// into `quarry.board` — the PLAYER's own board. Buying sabotage and landing
// it on yourself is not sabotage. (Blockade was already correct: it picks the
// rival's busiest industry.)
//
// The reason they landed on the player is that the rival had nowhere else to
// put them — `game.ts` says so outright: *"The rival has no board to play, so
// the passive yield stays as its income."* So the fix is two halves, and the
// second half is the one that matters:
//
//   1. The rival GETS a board — a real `Board`, its own 7×8 plant.
//   2. That board has to be worth hitting, or the Gold is spent on nothing.
//      The rival's income is its passive trickle, so the plant's state scales
//      it: ice and girders take the plant apart one cell at a time, and smog
//      chokes what is left. `health()` is that multiplier, and `economyTick`
//      applies it to every cargo the rival earns.
//
// The rival never PLAYS this board (no AI match-3 is this ticket), so every
// effect carries its own expiry — ice on a board nobody clears would
// otherwise be permanent, and a sabotage that never wears off is not a
// purchase, it is a bug with a price.
// ══════════════════════════════════════════════════════════════════════════
import { Board } from "../game/board";
import { BOARD_W, BOARD_H } from "../game/config";

/** How long ice sits on the rival's plant before it melts. */
export const RIVAL_FROST_MS = 45_000;
/** How long the girders sit there before they are hauled away. */
export const RIVAL_GIRDER_MS = 60_000;
/** How long smog chokes the plant. */
export const RIVAL_SMOG_MS = 30_000;

/**
 * A girder is worth two ice tiles: ice still shatters into a usable gem
 * after two matches, while a girder takes its cell out of the board entirely
 * (no match, no refill through it).
 */
export const GIRDER_WEIGHT = 2;
/** The fraction of its yield a smogged plant still manages. */
export const SMOG_YIELD = 0.5;
/** A plant can be wrecked, but never to zero — the rival always earns something. */
export const MIN_HEALTH = 0.1;

const CELLS = BOARD_W * BOARD_H;

export interface RivalStatus {
  /** Gems locked in ice. */
  frozen: number;
  /** Immovable girders. */
  girders: number;
  /** Smog is still hanging over the plant. */
  smog: boolean;
}

export interface RivalPlant {
  /** The rival's match-3 board. Nobody plays it; sabotage lands on it. */
  board: Board;
  /** Freeze `n` gems in ice. Returns how many froze. */
  frost(now: number, n?: number): number;
  /** Drop `n` girders. Returns how many landed. */
  girders(now: number, n?: number): number;
  /** Choke the plant with smog (its swaps are dead for `RIVAL_SMOG_MS`). */
  smog(now: number): void;
  /** The 0..1 multiplier the rival's passive income is scaled by. */
  health(now: number): number;
  /** What is currently wrong with the plant, for the HUD and the toasts. */
  status(now: number): RivalStatus;
  /** Melt/clear whatever has expired. Called every frame. */
  tick(now: number): void;
}

export function createRivalPlant(): RivalPlant {
  const board = new Board();
  let frostUntil = 0;
  let girderUntil = 0;

  // Both counts are measured, not assumed: `harden` can only freeze gems that
  // are neither girders nor bombs, so on a wrecked plant "7 frozen" may be
  // fewer than 7 — and the toast has to tell the truth about what landed.
  const frost = (now: number, n = 7) => {
    const before = board.gems().filter((g) => g.hard > 0).length;
    board.harden(n);
    frostUntil = now + RIVAL_FROST_MS;
    return board.gems().filter((g) => g.hard > 0).length - before;
  };

  const girders = (now: number, n = 4) => {
    const before = board.gems().filter((g) => g.block).length;
    board.dropBlocks(n, RIVAL_GIRDER_MS, now);
    girderUntil = now + RIVAL_GIRDER_MS;
    return board.gems().filter((g) => g.block).length - before;
  };

  const smog = (now: number) => {
    board.fog(RIVAL_SMOG_MS, now);
  };

  const status = (now: number): RivalStatus => {
    let frozen = 0, blocked = 0;
    for (const g of board.gems()) {
      if (g.block) blocked++;
      else if (g.hard > 0) frozen++;
    }
    return { frozen, girders: blocked, smog: board.fogUntil > now };
  };

  const health = (now: number): number => {
    const s = status(now);
    const wrecked = s.frozen + s.girders * GIRDER_WEIGHT;
    const clear = Math.max(0, 1 - wrecked / CELLS);
    const yieldFactor = s.smog ? SMOG_YIELD : 1;
    return Math.max(MIN_HEALTH, Math.min(1, clear * yieldFactor));
  };

  const tick = (now: number) => {
    // Ice melts on its own clock — the rival has no way to shatter it.
    if (frostUntil && now >= frostUntil) {
      frostUntil = 0;
      for (const g of board.gems()) if (g.hard > 0) g.hard = 0;
      board.onChange();
    }
    // Girders are hauled away: the cell becomes an ordinary gem again, so no
    // gravity pass and no holes are needed.
    if (girderUntil && now >= girderUntil) {
      girderUntil = 0;
      for (const g of board.gems()) if (g.block) g.block = false;
      board.onChange();
    }
  };

  return { board, frost, girders, smog, health, status, tick };
}
