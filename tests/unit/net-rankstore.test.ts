// @vitest-environment jsdom
//
// RANK-01 (#147) — the storage policy around a rating.
//
// `rating.ts` is pinned in `net-rank.test.ts` (pure arithmetic); this file pins
// the policy that only exists because a rating has to SURVIVE a match: where
// the file is read from and written to, the once-only guard that stops a reload
// from filing one match twice, the local mirror for a page with no RUN host,
// and the single call site that writes to the public ladder.
//
// `transport.ts` is mocked rather than loaded: it constructs the SDK singleton
// (which needs `window`) and no test here is about the SDK. The mock is an
// in-memory bucket, so what is under test is `rankstore.ts` alone — the module
// that decides what a stored value MEANS.
import { describe, it, expect, beforeEach, vi } from "vitest";

const mock = vi.hoisted(() => ({
  bucket: new Map<string, string>(),
  ladderCalls: [] as { rating: number; durationSec: number; metadata?: Record<string, unknown> }[],
  remoteDown: false,
  ladderDown: false,
}));

vi.mock("../../src/net/transport", () => ({
  RANK_STORAGE_KEY: "hexmatch:rank:v1",
  RANK_FILED_KEY: "hexmatch:rank:filed:v1",
  RANK_LOCAL_MIRROR: "hexmatch:rank",
  readPlayerValue: async (key: string) => (mock.remoteDown ? null : mock.bucket.get(key) ?? null),
  writePlayerValue: async (key: string, value: string) => {
    if (mock.remoteDown) return false;
    mock.bucket.set(key, value);
    return true;
  },
  readLadder: async () => (mock.ladderDown
    ? null
    : {
      entries: [{ profileId: "p1", username: "Ada", rating: 1240, rank: 1 }],
      mine: { rank: 7, rating: 1180 },
      total: 12,
    }),
  submitLadderScore: async (params: { rating: number; durationSec: number; metadata?: Record<string, unknown> }) => {
    mock.ladderCalls.push(params);
    return mock.ladderDown
      ? { accepted: false, rank: null, reason: "unreachable" }
      : { accepted: true, rank: 3, reason: null };
  },
  isLadderAvailable: () => !mock.ladderDown,
}));

import {
  createRankStore,
  fileRoomResult,
  loadRankState,
  localMirrorKey,
  matchKeyOf,
  rankStore,
  saveRankState,
} from "../../src/net/rankstore";
// The storage keys come from the same module `rankstore.ts` reads them from,
// so the test cannot drift from the policy about WHERE a rating lives.
import { RANK_FILED_KEY, RANK_STORAGE_KEY } from "../../src/net/transport";
import { START_RATING, type RankState } from "../../src/net/rating";
import type { ResultMsg } from "../../src/net/protocol";

const RESULT: ResultMsg = {
  type: "result",
  winnerId: "me",
  loserId: "them",
  reason: "win",
  durationSec: 420,
  ratings: [
    { id: "me", rating: 1180, matches: 12 },
    { id: "them", rating: 1180, matches: 12 },
  ],
  at: 1_760_000_000_000,
};

const opponent = { id: "them", rating: 1180, matches: 12, known: true };
const file = (rating: number, matches = 12): RankState =>
  ({ rating, matches, wins: matches - 4, losses: 4, season: "s1" });

beforeEach(() => {
  mock.bucket.clear();
  mock.ladderCalls.length = 0;
  mock.remoteDown = false;
  mock.ladderDown = false;
  localStorage.clear();
});

describe("RANK-01 the rating file", () => {
  it("starts a player who has never played at 1000, unranked, with nothing on the ladder", async () => {
    const state = await loadRankState();
    expect(state.rating).toBe(START_RATING);
    expect(state.matches).toBe(0);
    expect(mock.ladderCalls).toHaveLength(0);
  });

  it("prefers RUN storage, falling back to the local mirror when it has nothing", async () => {
    // Remote answers: that is the file, even when a stale mirror disagrees.
    mock.bucket.set(RANK_STORAGE_KEY, JSON.stringify(file(1310)));
    localStorage.setItem(localMirrorKey(RANK_STORAGE_KEY), JSON.stringify(file(900)));
    expect((await loadRankState()).rating).toBe(1310);

    // Remote empty, mirror present: the mirror is the file — and is promoted
    // to remote on the way out, so the next device/browser sees it too.
    mock.bucket.clear();
    const fromMirror = await loadRankState();
    expect(fromMirror.rating).toBe(900);
    expect(JSON.parse(mock.bucket.get(RANK_STORAGE_KEY)!).rating).toBe(900);
  });

  it("ignores a corrupt file rather than throwing, and mirrors every write", async () => {
    mock.bucket.set(RANK_STORAGE_KEY, "{ not json");
    expect((await loadRankState()).rating).toBe(START_RATING);
    await saveRankState(file(1220));
    expect(JSON.parse(mock.bucket.get(RANK_STORAGE_KEY)!).rating).toBe(1220);
    expect(JSON.parse(localStorage.getItem(localMirrorKey(RANK_STORAGE_KEY))!).rating).toBe(1220);
  });

  it("keeps a rating when RUN storage refuses the write (private mode)", async () => {
    mock.remoteDown = true;
    await saveRankState(file(1260));
    expect(JSON.parse(localStorage.getItem(localMirrorKey(RANK_STORAGE_KEY))!).rating).toBe(1260);
    expect((await loadRankState()).rating).toBe(1260);
  });
});

describe("RANK-01 filing a room result", () => {
  it("files a win: rating up, file saved, ladder told, verdict printable", async () => {
    const { state, verdict, applied, ladder } = await fileRoomResult({
      result: RESULT, selfId: "me", opponent, state: file(1180),
    });
    expect(applied).toBe(true);
    expect(state.rating).toBe(1180 + verdict.change.delta);
    expect(verdict.change.delta).toBeGreaterThan(0);
    expect(JSON.parse(mock.bucket.get(RANK_STORAGE_KEY)!).rating).toBe(state.rating);
    // The ladder submission is the new rating, with the match's story on it.
    expect(mock.ladderCalls).toHaveLength(1);
    expect(mock.ladderCalls[0].rating).toBe(state.rating);
    expect(mock.ladderCalls[0].durationSec).toBe(420);
    expect(mock.ladderCalls[0].metadata).toMatchObject({
      season: "s1", reason: "win", result: "win", opponent: "them", matches: 13,
    });
    expect(ladder).toEqual({ accepted: true, rank: 3 });
  });

  it("files a loss from the ROOM's verdict, never from local opinion", async () => {
    const lost: ResultMsg = { ...RESULT, winnerId: "them", loserId: "me" };
    const { state, verdict, applied } = await fileRoomResult({
      result: lost, selfId: "me", opponent, state: file(1180),
    });
    expect(applied).toBe(true);
    expect(verdict.outcome).toBe("loss");
    expect(state.rating).toBeLessThan(1180);
    expect(state.losses).toBe(5);
  });

  it("counts one match ONCE, however many times the result arrives", async () => {
    const first = await fileRoomResult({ result: RESULT, selfId: "me", opponent, state: file(1180) });
    const again = await fileRoomResult({ result: RESULT, selfId: "me", opponent, state: first.state });
    expect(again.applied).toBe(false);
    expect(again.state).toEqual(first.state);
    // …and the ladder was told once: the double arrival came from the same
    // filed key, not a second settlement.
    expect(mock.ladderCalls).toHaveLength(1);
    expect(mock.bucket.get(RANK_FILED_KEY)).toBe(matchKeyOf(RESULT));
  });

  it("still files a REMATCH in the same story — a new result is a new key", async () => {
    const first = await fileRoomResult({ result: RESULT, selfId: "me", opponent, state: file(1180) });
    const rematch: ResultMsg = { ...RESULT, winnerId: "them", loserId: "me", at: RESULT.at + 600_000 };
    const second = await fileRoomResult({ result: rematch, selfId: "me", opponent, state: first.state });
    expect(second.applied).toBe(true);
    expect(second.state.matches).toBe(first.state.matches + 1);
    expect(mock.ladderCalls).toHaveLength(2);
  });

  it("the LEAVER's own seat files locally: no guard, no ladder write", async () => {
    // The room never tells a leaver anything (it is gone), so this seat applies
    // its own loss — but it does not get to publish its own loss to the ladder.
    const walkedOut: ResultMsg = { ...RESULT, winnerId: "them", loserId: "me", reason: "forfeit", durationSec: 0 };
    const { state, verdict, applied, ladder } = await fileRoomResult({
      result: walkedOut, selfId: "me", opponent, state: file(1180), localOnly: true,
    });
    expect(applied).toBe(true);
    expect(verdict.forfeit).toBe(true);
    expect(state.rating).toBeLessThan(1180);
    expect(mock.ladderCalls).toHaveLength(0);
    expect(ladder).toBeNull();
    // No filed key either: the leaver's next match (or the same match from the
    // survivor's result, if it somehow arrived) must not be mistaken for this.
    expect(mock.bucket.get(RANK_FILED_KEY)).toBeUndefined();
  });

  it("writes the loss through: the file the next match is rated from is the lower one", async () => {
    const { state } = await fileRoomResult({
      result: { ...RESULT, winnerId: "them", loserId: "me" }, selfId: "me", opponent, state: file(1300, 20),
    });
    expect(state.rating).toBeLessThan(1300);
    expect(JSON.parse(mock.bucket.get(RANK_STORAGE_KEY)!).rating).toBe(state.rating);
    // …and the ladder write is still attempted: the board keeps the best of
    // what was filed, so a lower submission simply changes nothing.
    expect(mock.ladderCalls).toHaveLength(1);
  });

  it("survives an unreachable ladder: the match still files", async () => {
    mock.ladderDown = true;
    const { state, applied, ladder } = await fileRoomResult({
      result: RESULT, selfId: "me", opponent, state: file(1180),
    });
    expect(applied).toBe(true);
    expect(state.rating).toBeGreaterThan(1180);
    expect(ladder).toEqual({ accepted: false, rank: null });
  });
});

describe("RANK-01 the store the game is handed", () => {
  it("exposes the three things a match needs, and reads the ladder", async () => {
    const store = createRankStore();
    expect(typeof store.loadState).toBe("function");
    expect(typeof store.fileResult).toBe("function");
    const ladder = await store.loadLadder(20);
    expect(ladder?.entries[0]).toMatchObject({ username: "Ada", rating: 1240, rank: 1 });
    expect(ladder?.mine).toEqual({ rank: 7, rating: 1180 });
  });

  it("is a singleton — the start screen and the match share one filed key", () => {
    expect(rankStore()).toBe(rankStore());
    expect(rankStore()).not.toBe(createRankStore());
  });

  it("derives one key for one match from the room's own result", () => {
    // The same result message reaches both seats: winner:loser:at must agree,
    // or one client would file a match the other is still guarding.
    const key = matchKeyOf(RESULT);
    expect(key).toBe(`${RESULT.at}:me:them`);
    expect(matchKeyOf({ ...RESULT, ratings: [] })).toBe(key);
    expect(matchKeyOf({ ...RESULT, at: RESULT.at + 1 })).not.toBe(key);
    expect(matchKeyOf({ ...RESULT, winnerId: "them", loserId: "me" })).not.toBe(key);
  });
});
