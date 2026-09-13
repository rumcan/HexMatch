// ══════════════════════════════════════════════════════════════════════════
// RANK-01 (#147) — the match-time half of the ranking system.
//
// `rating.ts` is the arithmetic, `rankstore.ts` is where a rating is kept, and
// THIS is the glue a running match needs: hold the player's file, publish it to
// the room, and turn the room's `result` into a verdict the ending screen can
// print.
//
// Why it is a class and not four functions in `iso/game.ts`: the game must stay
// instantiable in a headless test with no SDK and no storage (see
// `tests/unit/iso-mp.test.ts` — `game.ts` may not import `transport.ts`, which
// touches `window` at module load). So the STORE arrives by injection and the
// game only ever sees the small interface below. In the browser the store is
// `createRankStore()` from `rankstore.ts`; in a test it is three stubs.
// ══════════════════════════════════════════════════════════════════════════
import type { ResultMsg } from "./protocol";
import {
  freshRankState,
  opponentFor as pickOpponent,
  rankBoardFrom,
  type RankBoard,
  type RankState,
  type RankVerdict,
} from "./rating";

/** One row of the ladder, as the panel prints it. Mirrors `LadderEntry`. */
export interface RankLadderRow {
  profileId: string;
  username: string;
  rating: number;
  rank: number;
  isSeed?: boolean;
}

export interface RankLadder {
  entries: RankLadderRow[];
  mine: { rank: number; rating: number } | null;
  total: number;
}

/** The filed-result record `rankstore.fileResult` returns. */
export interface FiledOutcome {
  state: RankState;
  verdict: RankVerdict;
  applied: boolean;
  ladder: { accepted: boolean; rank: number | null } | null;
}

/**
 * Where a rating is kept. Implemented by `rankstore.ts`; faked in tests. Kept
 * deliberately narrow — the game only ever does these three things with it.
 */
export interface RankStore {
  loadState(): Promise<RankState>;
  /** File a room result for this seat. `key` guards against a double filing. */
  fileResult(input: {
    result: ResultMsg;
    selfId: string;
    opponent: { id: string; rating: number; matches: number; known: boolean };
    state: RankState;
    /** Skip the once-only guard + the ladder write (the leaver's own seat). */
    localOnly?: boolean;
  }): Promise<FiledOutcome>;
  loadLadder(limit?: number): Promise<RankLadder | null>;
}

/** The slice of `NetSession` the runtime uses — so tests can pass a stand-in. */
export interface RankSession {
  readonly playerId: string;
  publishRating(state: RankState): boolean;
  claimResult(winnerId: string, loserId: string, durationSec: number): boolean;
}

export interface RankRuntimeOptions {
  session: RankSession;
  store: RankStore;
  /** The room's rating board at the moment the match started (welcome copy). */
  board?: RankBoard;
  /** Fired once the room's verdict has been folded into the local file. */
  onVerdict?: (verdict: RankVerdict) => void;
}

export class RankRuntime {
  private readonly session: RankSession;
  private readonly store: RankStore;
  private readonly onVerdict: (verdict: RankVerdict) => void;
  private stateValue: RankState | null = null;
  private verdictValue: RankVerdict | null = null;
  private boardValue: RankBoard;
  private filed = false;
  private started = false;

  constructor(opts: RankRuntimeOptions) {
    this.session = opts.session;
    this.store = opts.store;
    this.boardValue = opts.board ? { ...opts.board } : {};
    this.onVerdict = opts.onVerdict ?? (() => {});
  }

  /** The player's rating file; null until the store has answered. */
  get state(): RankState | null {
    return this.stateValue;
  }

  /** The match's verdict, once the room has filed one. */
  get verdict(): RankVerdict | null {
    return this.verdictValue;
  }

  /** True once a result has been folded in (so the UI can stop saying "pending"). */
  get settled(): boolean {
    return this.verdictValue !== null;
  }

  /**
   * Load the file and publish it to the room. Idempotent: the start screen
   * may already have published the same rating under the same join token, and
   * the room treats a re-publish as an update rather than a second entry.
   */
  async start(): Promise<RankState> {
    if (this.started && this.stateValue) return this.stateValue;
    this.started = true;
    // A store that throws must not take the match down with it: a player with
    // no reachable storage plays an unrated-looking match, not a broken one.
    let state: RankState;
    try {
      state = await this.store.loadState();
    } catch {
      state = freshRankState();
    }
    this.stateValue = state;
    this.session.publishRating(state);
    return state;
  }

  /** Fold a board update from the session into the runtime's copy. */
  applyBoard(board: RankBoard): void {
    // Never let a board LOSE an entry: ratings only arrive, and a stale empty
    // update (a welcome with no ratings, an old relay) must not erase the
    // opponent's number and turn a match into an unrated one.
    for (const [id, entry] of Object.entries(board)) this.boardValue[id] = entry;
  }

  /** The room's board, for the lobby UI. */
  get board(): RankBoard {
    return { ...this.boardValue };
  }

  /** The opponent's numbers, as the arithmetic needs them. */
  opponent(opponentId: string): { id: string; rating: number; matches: number; known: boolean } {
    return pickOpponent(this.boardValue, opponentId);
  }

  /**
   * HOST: the star line was crossed. The verdict goes to the room, which relays
   * it back to both seats — the host does NOT rate the match itself here, so
   * both seats' arithmetic runs on one identical, room-stamped result.
   */
  claimWin(winnerId: string, loserId: string, durationSec: number): boolean {
    if (this.filed) return false;
    return this.session.claimResult(winnerId, loserId, Math.max(0, Math.round(durationSec)));
  }

  /**
   * Either seat: the room filed the result. Rate the match, keep the rating,
   * and hand the verdict to the UI.
   *
   * The board that arrives WITH the result is used in preference to the one
   * held locally: it is the board the result was filed against, so a seat that
   * missed an update still computes the same numbers as its opponent.
   */
  async handleResult(msg: ResultMsg, selfId = this.session.playerId): Promise<RankVerdict | null> {
    if (msg.winnerId !== selfId && msg.loserId !== selfId) return null;
    if (this.filed) return null;
    this.filed = true;
    const board = rankBoardFrom(msg.ratings ?? []);
    this.applyBoard(board);
    const opponentId = msg.winnerId === selfId ? msg.loserId : msg.winnerId;
    const state = this.stateValue ?? (await this.start());
    let outcome: FiledOutcome;
    try {
      outcome = await this.store.fileResult({
        result: msg,
        selfId,
        opponent: this.opponent(opponentId),
        state,
      });
    } catch {
      // Storage refused the write. The player still gets the verdict on
      // screen — the number they keep is the one already stored.
      return null;
    }
    this.stateValue = outcome.state;
    this.verdictValue = outcome.verdict;
    // Tell the room the new number, so a rematch in this room rates correctly.
    this.session.publishRating(outcome.state);
    this.onVerdict(outcome.verdict);
    return outcome.verdict;
  }

  /**
   * THIS player walked out of a live ranked match: the room will file the loss
   * against the seat that emptied, and this client will never see that message
   * (it is leaving). So the leaving seat applies its own loss locally, with the
   * same arithmetic and the same board the survivor's side will use.
   *
   * `localOnly` on purpose: no ladder write. The ladder is written from a
   * result the room witnessed, and a client that writes its own loss on the way
   * out is a client that could have written anything on the way out. (A loss
   * cannot raise a keep-best ladder number anyway, so nothing is lost by it.)
   */
  async fileOwnForfeit(opponentId: string): Promise<RankVerdict | null> {
    if (this.filed) return null;
    this.filed = true;
    const state = this.stateValue ?? (await this.start());
    const opponent = this.opponent(opponentId);
    try {
      const outcome = await this.store.fileResult({
        result: {
          type: "result",
          winnerId: opponent.id,
          loserId: this.session.playerId,
          reason: "forfeit",
          durationSec: 0,
          ratings: [],
          at: Date.now(),
        },
        selfId: this.session.playerId,
        opponent,
        state,
        localOnly: true,
      });
      this.stateValue = outcome.state;
      this.verdictValue = outcome.verdict;
      return outcome.verdict;
    } catch {
      return null;
    }
  }

  /** The public ladder, for the start screen's panel. */
  ladder(limit = 20): Promise<RankLadder | null> {
    return this.store.loadLadder(limit);
  }
}
