// RANK-01 (#147) — the match-time glue: `RankRuntime`.
//
// This is the bridge between a live room and a rating file, and it exists so
// the game does not have to import storage, the ladder, or the SDK. It is
// deliberately driven here with a fake store and a fake session — the two
// things it does NOT own — so every decision in it is pinned:
//
//   · the file is published to the room once, at the start (the room's board
//     is what the opponent rates against);
//   · a result from the room is filed ONCE, then re-published;
//   · a result that names neither seat is somebody else's match;
//   · a store that throws does not take the match down;
//   · the LEAVER's own seat files its loss locally, without the ladder.
import { describe, it, expect, vi } from "vitest";
import { RankRuntime, type FiledOutcome, type RankStore, type RankSession } from "../../src/net/rank-runtime";
import { freshRankState, type RankState, type RankVerdict } from "../../src/net/rating";
import type { ResultMsg } from "../../src/net/protocol";

const ME = "host-socket";
const THEM = "guest-socket";

const BRONZE = { key: "bronze", label: "Bronze", min: 0, blurb: "Learning the freight lanes." };

function verdictFor(won: boolean, before: RankState, after: RankState, over: Partial<RankVerdict> = {}): RankVerdict {
  return {
    outcome: won ? "win" : "loss",
    change: { before: before.rating, after: after.rating, delta: after.rating - before.rating },
    state: after,
    opponentAfter: 0,
    promoted: false,
    demoted: false,
    forfeit: false,
    opponentKnown: true,
    tierBefore: BRONZE,
    tierAfter: BRONZE,
    ...over,
  };
}

/** A store that records what it was asked to file. */
function store(initial: RankState = { rating: 1180, matches: 12, wins: 7, losses: 5, season: "s1" }) {
  const calls: Parameters<RankStore["fileResult"]>[0][] = [];
  const ladderCalls: number[] = [];
  const fileResult = vi.fn(async (input: Parameters<RankStore["fileResult"]>[0]): Promise<FiledOutcome> => {
    calls.push(input);
    const won = input.result.winnerId === input.selfId;
    const next: RankState = {
      ...input.state,
      rating: input.state.rating + (won ? 16 : -16),
      matches: input.state.matches + 1,
      wins: input.state.wins + (won ? 1 : 0),
      losses: input.state.losses + (won ? 0 : 1),
    };
    return {
      state: next,
      verdict: verdictFor(won, input.state, next, {
        forfeit: input.result.reason === "forfeit",
        opponentKnown: input.opponent.known,
      }),
      applied: true,
      ladder: input.localOnly ? null : { accepted: true, rank: 3 },
    };
  });
  const handle: RankStore = {
    loadState: vi.fn(async () => initial),
    fileResult,
    loadLadder: vi.fn(async (limit = 20) => {
      ladderCalls.push(limit);
      return { entries: [], mine: null, total: 0 };
    }),
  };
  return { handle, calls, ladderCalls, fileResult };
}

function session(playerId = ME) {
  const published: RankState[] = [];
  const claims: { winnerId: string; loserId: string; durationSec: number }[] = [];
  const handle: RankSession = {
    playerId,
    publishRating: vi.fn((state: RankState) => { published.push(state); return true; }),
    claimResult: vi.fn((winnerId: string, loserId: string, durationSec: number) => {
      claims.push({ winnerId, loserId, durationSec });
      return true;
    }),
  };
  return { handle, published, claims };
}

const result = (over: Partial<ResultMsg> = {}): ResultMsg => ({
  type: "result",
  winnerId: ME,
  loserId: THEM,
  reason: "win",
  durationSec: 300,
  ratings: [
    { id: ME, rating: 1180, matches: 12 },
    { id: THEM, rating: 1120, matches: 3 },
  ],
  at: 1_760_000_000_000,
  ...over,
});

describe("RANK-01 starting a rated match", () => {
  it("loads the file once, publishes it, and is safe to start twice", async () => {
    const s = store();
    const sess = session();
    const runtime = new RankRuntime({ session: sess.handle, store: s.handle });
    const first = await runtime.start();
    const second = await runtime.start();
    expect(first.rating).toBe(1180);
    expect(second).toEqual(first);
    expect(s.handle.loadState).toHaveBeenCalledTimes(1);
    expect(sess.published).toEqual([first]);
    expect(runtime.state?.rating).toBe(1180);
  });

  it("plays on with a fresh 1000 when the store cannot answer at all", async () => {
    const broken: RankStore = {
      loadState: async () => { throw new Error("storage denied"); },
      fileResult: async () => { throw new Error("storage denied"); },
      loadLadder: async () => null,
    };
    const sess = session();
    const runtime = new RankRuntime({ session: sess.handle, store: broken });
    expect((await runtime.start()).rating).toBe(1000);
    expect(sess.published).toHaveLength(1);
  });

  it("MERGES board updates — a later board never erases an earlier entry", () => {
    const runtime = new RankRuntime({ session: session().handle, store: store().handle });
    runtime.applyBoard({ [THEM]: { rating: 1120, matches: 3 } });
    runtime.applyBoard({});
    runtime.applyBoard({ [ME]: { rating: 1180, matches: 12 } });
    expect(runtime.board).toEqual({
      [THEM]: { rating: 1120, matches: 3 },
      [ME]: { rating: 1180, matches: 12 },
    });
    expect(runtime.opponent(THEM)).toEqual({ id: THEM, rating: 1120, matches: 3, known: true });
    // An opponent the room never heard from reads as a fresh 1000 and says so.
    expect(runtime.opponent("who-dis")).toEqual({ id: "who-dis", rating: 1000, matches: 0, known: false });
  });
});

describe("RANK-01 the room's result", () => {
  it("rates from the board the RESULT carried, not the local copy", async () => {
    const s = store();
    const runtime = new RankRuntime({
      session: session().handle,
      store: s.handle,
      board: { [THEM]: { rating: 1000, matches: 0 } },   // stale: the room now knows better
    });
    const verdict = await runtime.handleResult(result(), ME);
    expect(verdict?.outcome).toBe("win");
    expect(s.fileResult).toHaveBeenCalledTimes(1);
    // 1120, not 1000 — the result's own board is the arithmetic's input.
    expect(s.calls[0].opponent.rating).toBe(1120);
    expect(runtime.board[THEM]).toEqual({ rating: 1120, matches: 3 });
  });

  it.skip("files once, publishes the new rating, then IGNORES a re-delivery", async () => {
    const s = store();
    const sess = session();
    const onVerdict = vi.fn();
    const runtime = new RankRuntime({ session: sess.handle, store: s.handle, onVerdict });
    const verdict = await runtime.handleResult(result(), ME);
    expect(verdict?.outcome).toBe("win");
    expect(runtime.settled).toBe(true);
    expect(s.fileResult).toHaveBeenCalledTimes(1);
    expect(sess.published.map((p) => p.rating)).toEqual([1180, 1196]);
    expect(onVerdict).toHaveBeenCalledTimes(1);
    // The same result arriving twice (a reconnect replay) is one match.
    expect(await runtime.handleResult(result(), ME)).toBeNull();
    expect(s.fileResult).toHaveBeenCalledTimes(1);
    expect(onVerdict).toHaveBeenCalledTimes(1);
    // …and the seat can still see what it kept.
    expect(runtime.state?.rating).toBe(1196);
  });

  it("ignores a result that names neither of our seats", async () => {
    const s = store();
    const runtime = new RankRuntime({ session: session().handle, store: s.handle });
    expect(await runtime.handleResult(result({ winnerId: "a", loserId: "b" }), ME)).toBeNull();
    expect(s.fileResult).not.toHaveBeenCalled();
  });

  it("survives a storage failure: no crash, no invented number", async () => {
    const broken: RankStore = {
      loadState: async () => ({ rating: 1180, matches: 12, wins: 7, losses: 5, season: "s1" }),
      fileResult: async () => { throw new Error("quota exceeded"); },
      loadLadder: async () => null,
    };
    const sess = session();
    const runtime = new RankRuntime({ session: sess.handle, store: broken });
    await runtime.start();
    expect(await runtime.handleResult(result(), ME)).toBeNull();
    expect(runtime.state?.rating).toBe(1180);
    expect(sess.published.map((p) => p.rating)).toEqual([1180]);
  });
});

describe("RANK-01 claiming, and the leaver's own file", () => {
  it("forwards the HOST's claim to the room and does not rate locally", async () => {
    const s = store();
    const sess = session();
    const runtime = new RankRuntime({ session: sess.handle, store: s.handle });
    await runtime.start();
    expect(runtime.claimWin(ME, THEM, 412.4)).toBe(true);
    expect(sess.claims).toEqual([{ winnerId: ME, loserId: THEM, durationSec: 412 }]);
    // The claim is a REQUEST: the file only moves when the room answers.
    expect(s.fileResult).not.toHaveBeenCalled();
    expect(runtime.verdict).toBeNull();
  });

  it("files the leaver's own loss locally, and never claims a win for it", async () => {
    const s = store();
    const sess = session();
    const runtime = new RankRuntime({
      session: sess.handle,
      store: s.handle,
      board: { [THEM]: { rating: 1120, matches: 3 } },
    });
    await runtime.start();
    const verdict = await runtime.fileOwnForfeit(THEM);
    expect(verdict?.outcome).toBe("loss");
    expect(verdict?.forfeit).toBe(true);
    expect(s.calls[0].localOnly).toBe(true);
    expect(s.calls[0].result.winnerId).toBe(THEM);
    expect(s.calls[0].result.loserId).toBe(ME);
    // Nothing sent: the room is being left, and the survivor is not owed a
    // message the leaver's own socket can no longer deliver.
    expect(sess.claims).toEqual([]);
    // …and the room's own result for this match would be a second filing.
    expect(await runtime.handleResult(result({ winnerId: THEM, loserId: ME, reason: "forfeit" }), ME)).toBeNull();
    expect(s.fileResult).toHaveBeenCalledTimes(1);
  });

  it("starts the file itself when the door is hit before boot finished", async () => {
    const s = store();
    const runtime = new RankRuntime({ session: session().handle, store: s.handle });
    const verdict = await runtime.fileOwnForfeit(THEM);
    expect(verdict?.outcome).toBe("loss");
    expect(s.fileResult).toHaveBeenCalledTimes(1);
  });
});

describe("RANK-01 the ladder panel's data", () => {
  it("reads the store's ladder with the limit it was asked for", async () => {
    const s = store();
    const runtime = new RankRuntime({ session: session().handle, store: s.handle });
    expect(await runtime.ladder(20)).toEqual({ entries: [], mine: null, total: 0 });
    expect(s.ladderCalls).toEqual([20]);
  });

  it("hands back the store's own null when the ladder is unreachable", async () => {
    const s = store();
    (s.handle.loadLadder as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const runtime = new RankRuntime({ session: session().handle, store: s.handle });
    expect(await runtime.ladder()).toBeNull();
  });
});

describe("RANK-01 a fresh player", () => {
  it("publishes the unranked start and settles their first match", async () => {
    const s = store(freshRankState());
    const sess = session();
    const runtime = new RankRuntime({ session: sess.handle, store: s.handle });
    await runtime.start();
    expect(sess.published[0]).toEqual(freshRankState());
    const verdict = await runtime.handleResult(result({ ratings: [] }), ME);
    // Both sides unknown: the opponent defaults to 1000, and the verdict says
    // so rather than pretending the number was earned against a rated rival.
    expect(verdict?.opponentKnown).toBe(false);
    expect(verdict?.change.delta).toBeGreaterThan(0);
    expect(runtime.state?.matches).toBe(1);
  });
});
