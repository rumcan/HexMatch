// ══════════════════════════════════════════════════════════════════════════
// RANK-01 (#147) — where a rating lives between matches.
//
// The arithmetic is in `rating.ts` (pure) and the match-time glue is in
// `rank-runtime.ts` (SDK-free). THIS is the policy around both: the storage
// keys, the once-only guard that stops a reload from filing one match twice,
// the local mirror for pages with no RUN host, and the single call site that
// writes a rating to the public ladder.
//
// It is the only ranking file that touches `transport.ts`, which is why the
// game receives it by injection (`RankStore`) rather than importing it:
// `iso/game.ts` must stay bootable in a Node test.
//
// WHAT IS AUTHORITATIVE, AND WHAT IS NOT (read this before changing anything)
//
//   the ROOM       — the only witness to both seats, and the only party that
//                    may declare a match over or a seat forfeited
//                    (`src/rooms/HexmatchRoom.ts`). A rating only ever moves
//                    from the room's `result` message; nothing client-side
//                    invents a verdict.
//
//   player storage — the rating file: RUN `appStorage` where the host provides
//                    it (per-player, cloud-backed, not readable or writable by
//                    the other seat), mirrored to localStorage so a dev room —
//                    where the SDK storage bucket does not exist — behaves the
//                    same way. This is the answer #147 asked for ("store
//                    ratings server-side so they can't be edited client-side:
//                    RUN.world player storage"). The seam to revisit when the
//                    platform grows server-writable per-player storage is THIS
//                    FILE plus `readPlayerValue` / `writePlayerValue` in
//                    `transport.ts`.
//
//   the LADDER     — a leaderboard board, keep-best, so it shows a player's
//                    PEAK rating. A rating never gates anything (it is a badge
//                    and a ladder position), which is what makes a
//                    self-reported file an acceptable place for the badge, and
//                    why the ladder keeps the maximum of what has been filed.
// ══════════════════════════════════════════════════════════════════════════
import {
  RANK_FILED_KEY,
  RANK_LOCAL_MIRROR,
  RANK_STORAGE_KEY,
  readLadder,
  readPlayerValue,
  submitLadderScore,
  writePlayerValue,
} from "./transport";
import {
  advanceRating,
  freshRankState,
  ladderScoreFor,
  parseRankState,
  rateOutcome,
  serializeRankState,
  type RankState,
} from "./rating";
import type { ResultMsg } from "./protocol";
import type { FiledOutcome, RankLadder, RankStore } from "./rank-runtime";

/** The local mirror's key for a remote key (see the header). */
export const localMirrorKey = (key: string): string => `${RANK_LOCAL_MIRROR}:${key}`;

/** True when a page can reach `localStorage` at all (private mode says no). */
function mirror(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function mirrorRead(key: string): string | null {
  const store = mirror();
  if (!store) return null;
  try {
    return store.getItem(localMirrorKey(key));
  } catch {
    return null;
  }
}

function mirrorWrite(key: string, value: string): void {
  const store = mirror();
  if (!store) return;
  try {
    store.setItem(localMirrorKey(key), value);
  } catch { /* private mode / quota: the remote write is the real one */ }
}

/**
 * The rating file, most authoritative source first: RUN player storage, then
 * the local mirror, then a fresh file. Never throws — a boot path that can
 * fail on a storage read is worse than a fresh rating.
 */
export async function loadRankState(): Promise<RankState> {
  const remote = parseRankState(await readPlayerValue(RANK_STORAGE_KEY));
  if (remote) return remote;
  const local = parseRankState(mirrorRead(RANK_STORAGE_KEY));
  if (local) {
    // Promote the mirror: a device that could only read locally should also,
    // from here on, be readable remotely.
    void writePlayerValue(RANK_STORAGE_KEY, serializeRankState(local));
    return local;
  }
  return freshRankState();
}

/** Persist a rating file to both stores. Returns whether RUN's took it. */
export async function saveRankState(state: RankState): Promise<boolean> {
  const json = serializeRankState(state);
  mirrorWrite(RANK_STORAGE_KEY, json);
  return writePlayerValue(RANK_STORAGE_KEY, json);
}

/** The last room result this client filed, as its once-only key. */
export async function loadFiledKey(): Promise<string | null> {
  const remote = await readPlayerValue(RANK_FILED_KEY);
  if (remote) return remote;
  return mirrorRead(RANK_FILED_KEY);
}

export async function saveFiledKey(key: string): Promise<void> {
  mirrorWrite(RANK_FILED_KEY, key);
  await writePlayerValue(RANK_FILED_KEY, key);
}

/**
 * A room result's identity. `at` is the room's own clock (ms) and the two ids
 * name the seats, so the key is stable across both seats, across a reload, and
 * across the room's broadcast: two clients looking at one match derive the same
 * string, and one client looking at two matches never does.
 *
 * Deliberately NOT the room code: a room outlives a match (a rematch in the
 * same room is a different result), and a six-character code would collide
 * across a season.
 */
export function matchKeyOf(result: Pick<ResultMsg, "winnerId" | "loserId" | "at">): string {
  return `${result.at}:${result.winnerId}:${result.loserId}`;
}

/**
 * File a match the ROOM says is over, for one seat.
 *
 * The once-only guard is why this is a function and not two lines at the call
 * site: a `result` can arrive twice (a broadcast plus a reconnect replay), and
 * one match must never move a rating twice. The key is written BEFORE the
 * rating, so a crash between the two loses a rating move rather than
 * duplicating one.
 *
 * `selfId` is this client's room player id; whether it won comes from the
 * room's verdict, never from local opinion about the scoreboard.
 */
export async function fileRoomResult(input: {
  result: ResultMsg;
  selfId: string;
  opponent: { id: string; rating: number; matches: number; known: boolean };
  state: RankState;
  /** The leaver's own seat: no once-only key, no ladder write. */
  localOnly?: boolean;
}): Promise<FiledOutcome> {
  const key = matchKeyOf(input.result);
  const already = input.localOnly ? null : await loadFiledKey();
  const won = input.result.winnerId === input.selfId;
  const verdict = rateOutcome({
    self: { id: input.selfId, state: input.state },
    opponent: input.opponent,
    won,
    forfeit: input.result.reason === "forfeit",
  });
  if (already === key) {
    // Same match, already counted: report the CURRENT file untouched. The
    // verdict is recomputed only for the screen's sake and deliberately not
    // adopted — a second arrival is a no-op, not a second rating.
    return { state: input.state, verdict, applied: false, ladder: null };
  }
  const next = advanceRating(input.state, verdict.state);
  if (!input.localOnly) await saveFiledKey(key);
  await saveRankState(next);
  if (input.localOnly) return { state: next, verdict, applied: true, ladder: null };
  const ladder = await submitLadderScore({
    rating: ladderScoreFor(next.rating),
    durationSec: input.result.durationSec ?? 0,
    metadata: {
      season: next.season,
      matches: next.matches,
      wins: next.wins,
      losses: next.losses,
      reason: input.result.reason,
      opponent: input.opponent.id,
      result: won ? "win" : "loss",
      tier: next.matches > 0 ? String(next.rating) : "unranked",
    },
  });
  return {
    state: next,
    verdict,
    applied: true,
    ladder: { accepted: ladder.accepted, rank: ladder.rank },
  };
}

/**
 * The store the browser uses. A module-level singleton so the start screen and
 * the match share one instance (and therefore one once-only key) — and so a
 * rematch in the same page cannot race two stores over one file.
 */
export function createRankStore(): RankStore {
  return {
    loadState: loadRankState,
    fileResult: fileRoomResult,
    loadLadder: (limit = 20) => readLadder(limit) as Promise<RankLadder | null>,
  };
}

let singleton: RankStore | null = null;

/** The shared store. Built lazily: importing this file must stay side-effect free. */
export function rankStore(): RankStore {
  singleton ??= createRankStore();
  return singleton;
}
