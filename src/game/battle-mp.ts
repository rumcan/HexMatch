// ══════════════════════════════════════════════════════════════════════════
// B6 (#251) — multiplayer battles: the HOST runs B1's engine and validates
// every move; the guest animates the deterministic result.
//
// The sync model the issue asks for:
//   • LIVE — the engine is deterministic and keeps its own replayable log
//     (`Battle.moves`: "seed + this = the whole battle"), so the wire carries
//     the seed + move list and a guest replays the moves it has not seen.
//   • REJOIN — a snapshot carries the FULL battle state (`Battle.save()`), so
//     a refresh mid-battle restores the exact board, mana, health and turn
//     (`duelFromWire`).
//   • TIMER — the host enforces `BATTLE_RULES.turnMs`. A timed-out turn
//     PASSES: the host auto-plays one seeded random legal swap for the
//     staller (logged like any other move). N (`TIMEOUTS_BEFORE_FORFEIT`)
//     consecutive auto-plays read as a vanished player and forfeit the duel
//     to the seat still there — the same door a real disconnect uses.
//
// Everything here is host-side bookkeeping around `src/game/battle.ts` (B1).
// The game layer (`game.ts`) owns the screens, the intents and the settle;
// `src/iso/snapshot.ts` carries `BattleWire.engine`.
// ══════════════════════════════════════════════════════════════════════════
import {
  createBattle,
  type Battle, type BattleMove, type BattleSeat,
  type TurnOutcome, type AbilityOutcome,
} from "./battle";
import type { BattleRules } from "../iso/config";

/** What the host rejects a guest move with (the unit acceptance's reasons). */
export type MoveRejection =
  | "no-duel" | "over" | "out-of-turn" | "illegal" | "busy" | "ability-refused";

export type MoveResult =
  | { ok: true; kind: "swap"; outcome: TurnOutcome }
  | { ok: true; kind: "ability"; outcome: AbilityOutcome }
  | { ok: false; reason: MoveRejection; detail?: string };

/** The host's live duel. The `Battle` is the screen's battle on the host —
 *  one engine, two roles (authority + display). */
export interface Duel {
  readonly seed: number;
  readonly rules: BattleRules;
  readonly battle: Battle;
  /** Host clock: the active seat's turn expires at this moment. */
  turnDeadline: number;
  /** Consecutive auto-played (timed-out) turns per seat. */
  timeouts: [number, number];
  /** Who has played from the room (seat → present). A gone seat forfeits. */
  seatGone: [boolean, boolean];
  /** When each gone seat's grace period started (0 = present). */
  goneSince: [number, number];
}

/** How long a vanished opponent is waited out before the duel forfeits. */
export const DISCONNECT_GRACE_MS = 20_000;
/** Consecutive auto-plays that read as "nobody is there" (the spec's N). */
export const TIMEOUTS_BEFORE_FORFEIT = 3;

/** Seed + rules + the engine; the move log starts empty. */
export function createDuel(
  seed: number,
  rules: BattleRules,
  players: [Parameters<typeof createBattle>[0]["players"][0], Parameters<typeof createBattle>[0]["players"][1]],
  now: number,
  animate = true,
): Duel {
  const battle = createBattle({ seed, players, rules, animate });
  return {
    seed, rules, battle,
    turnDeadline: now + rules.turnMs,
    timeouts: [0, 0],
    seatGone: [false, false],
    goneSince: [0, 0],
  };
}

/** The acting seat for a move, or null when the id is not a duel player. */
export const seatOfId = (d: Duel, playerId: string): BattleSeat | null => {
  const s = d.battle.state.players.findIndex((p) => p.id === playerId);
  return s === 0 || s === 1 ? s : null;
};

/**
 * The host's validation + apply for ANY move (its own seat's or a guest's).
 * A rejected move changes NOTHING (`playSwap` refuses `no-match` before it
 * mutates; `canUse` gates casts) and says why — the unit acceptance.
 *
 * The stall/clock bookkeeping is the CALLER's (`duelClockTick` counts
 * auto-plays; a human move clears the count and re-arms the clock).
 */
export async function applyPlayerMove(
  d: Duel | null,
  playerId: string,
  move: BattleMove,
  now: number,
): Promise<MoveResult> {
  if (!d) return { ok: false, reason: "no-duel" };
  const seat = seatOfId(d, playerId);
  if (seat === null) return { ok: false, reason: "out-of-turn", detail: "not a duelist" };
  if (d.battle.state.over) return { ok: false, reason: "over" };
  if (d.battle.turn !== seat) return { ok: false, reason: "out-of-turn" };
  if (move.t === "swap") {
    const outcome = await d.battle.playSwap(move.r1, move.c1, move.r2, move.c2, now);
    if (!outcome.ok) {
      return { ok: false, reason: outcome.reason === "busy" ? "busy" : "illegal", detail: outcome.reason };
    }
    return { ok: true, kind: "swap", outcome };
  }
  // ability — `canUse` for THIS seat first (out-of-turn/"turn" is its own reason)
  const check = d.battle.canUse(move.id, seat);
  if (!check.ok) {
    const reason: MoveRejection =
      check.reason === "turn" ? "out-of-turn"
      : check.reason === "over" ? "over"
      : check.reason === "busy" ? "busy"
      : "ability-refused";
    return { ok: false, reason, detail: check.reason };
  }
  const outcome = await d.battle.useAbility(move.id);
  if (!outcome.ok) return { ok: false, reason: "ability-refused", detail: outcome.reason };
  return { ok: true, kind: "ability", outcome };
}

/** A human move landed: clear the stall count and re-arm the turn clock. */
export function noteHumanMove(d: Duel, seat: BattleSeat, now: number): void {
  d.timeouts[seat] = 0;
  d.turnDeadline = now + d.rules.turnMs;
}

/** The wire shape (`src/iso/snapshot.ts`'s `BattleWire.engine`). */
export interface DuelWire {
  seed: number;
  rules: BattleRules;
  /** The replayable log — seed + this = the whole battle (B1's promise). */
  moves: BattleMove[];
  /** The FULL continuation state — for rejoin (`Battle.save()`). */
  saved: unknown;
  turnDeadline: number;
  timeouts: [number, number];
  seatGone: [boolean, boolean];
}

export function duelToWire(d: Duel): DuelWire {
  return {
    seed: d.seed,
    rules: d.rules,
    moves: [...d.battle.moves],
    saved: d.battle.save(),
    turnDeadline: d.turnDeadline,
    timeouts: [d.timeouts[0], d.timeouts[1]],
    seatGone: [d.seatGone[0], d.seatGone[1]],
  };
}

/** Rejoin: the exact continuation (same battle, same move log). */
export function duelFromWire(w: DuelWire, players: Parameters<typeof createDuel>[2], animate = true): Duel {
  const battle = createBattle({ seed: w.seed, players, rules: w.rules, animate });
  battle.restore(w.saved);
  return {
    seed: w.seed,
    rules: w.rules,
    battle,
    turnDeadline: w.turnDeadline,
    timeouts: [w.timeouts[0], w.timeouts[1]],
    seatGone: [w.seatGone[0], w.seatGone[1]],
    goneSince: [0, 0],
  };
}

/** One seeded random legal swap for the current seat (the timeout's auto-play). */
export async function autoPlayFor(
  d: Duel, now: number, rng: () => number = Math.random,
): Promise<MoveResult> {
  const seat = d.battle.turn;
  const board = d.battle.board;
  const cands: [number, number, number, number][] = [];
  for (let r = 0; r < board.h; r++) {
    for (let c = 0; c < board.w; c++) {
      if (c + 1 < board.w) cands.push([r, c, r, c + 1]);
      if (r + 1 < board.h) cands.push([r, c, r + 1, c]);
    }
  }
  // seeded shuffle (Fisher–Yates) — the game's rule: no `Math.random` in game
  // logic; the CALLER passes the game's stream (`rand` in game.ts).
  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cands[i], cands[j]] = [cands[j], cands[i]];
  }
  for (const [r1, c1, r2, c2] of cands) {
    const res = await applyPlayerMove(d, d.battle.state.players[seat].id, { t: "swap", r1, c1, r2, c2 }, now);
    if (res.ok) return res;
  }
  return { ok: false, reason: "illegal", detail: "no legal swap" };
}

/** End the duel by forfeit: the seat still THERE wins. */
export function endByForfeit(d: Duel, winner: BattleSeat): BattleSeat {
  const st = d.battle.state as { over: boolean; winner: BattleSeat | null };
  st.over = true;
  st.winner = winner;
  return winner;
}

/**
 * The host's turn clock. On expiry the stalled seat's turn PASSES via one
 * auto-played random legal swap — `TIMEOUTS_BEFORE_FORFEIT` in a row and the
 * seat has forfeited (nobody is driving; the other seat wins). Returns the
 * winner when the duel just ended, else null (with `auto` set when it played).
 */
export async function duelClockTick(
  d: Duel | null,
  now: number,
  rng: () => number = Math.random,
): Promise<{ winner: BattleSeat | null; auto: boolean }> {
  if (!d || d.battle.state.over) return { winner: null, auto: false };
  if (now < d.turnDeadline) return { winner: null, auto: false };
  const stalled = d.battle.turn;
  const res = await autoPlayFor(d, now, rng);
  if (!res.ok) return { winner: null, auto: false };   // board busy — next tick
  d.timeouts[stalled] += 1;
  d.turnDeadline = now + d.rules.turnMs;
  if (d.timeouts[stalled] >= TIMEOUTS_BEFORE_FORFEIT) {
    return { winner: endByForfeit(d, stalled === 0 ? 1 : 0), auto: true };
  }
  return { winner: null, auto: true };
}

/**
 * Disconnect: mark the seat gone (its grace runs). Rejoin clears it.
 */
export function duelPresence(
  d: Duel | null, seat: BattleSeat, present: boolean, now: number,
): void {
  if (!d || d.battle.state.over) return;
  if (present) {
    d.seatGone[seat] = false;
    d.goneSince[seat] = 0;
    return;
  }
  d.seatGone[seat] = true;
  d.goneSince[seat] = now;
}

/** The grace sweep — call every tick. Winner when someone just won by forfeit. */
export function duelGraceTick(d: Duel | null, now: number): BattleSeat | null {
  if (!d || d.battle.state.over) return null;
  for (const s of [0, 1] as BattleSeat[]) {
    if (!d.seatGone[s]) continue;
    if (now - d.goneSince[s] >= DISCONNECT_GRACE_MS) {
      return endByForfeit(d, s === 0 ? 1 : 0);
    }
  }
  return null;
}
