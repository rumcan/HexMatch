// ══════════════════════════════════════════════════════════════════════════
// MP-02 — RUN.world transport.
//
// THE ONLY client module that imports the RUN.world SDK. Multiplayer is BETA
// and the API drifts (§1.4) — every `RundotGameAPI.realtime.*` call lives here
// so a breaking SDK change is a one-file fix. Nothing else in `src/` may
// import `@series-inc/rundot-game-sdk` on the client path: game code imports
// the wrappers and re-exported TYPES below instead. (Two deliberate
// exceptions, both outside the client path: `src/rooms/HexmatchRoom.ts`
// imports `mp-server` because it RUNS on the server, and `vite.config.ts`
// imports the build plugin. The unit suite enforces this — see
// `tests/unit/net-protocol.test.ts`.)
//
// What goes where:
//   - `protocol.ts` — the message union + version refusal. No SDK, no
//     browser: safe to import from the server bundle, Node tests, anywhere.
//   - THIS file — room lifecycle (`createRoom`, `joinRoomByCode`,
//     `quickMatch`, `getUserRooms`), room-code shape, auth helpers, per-player
//     storage and the ladder (RANK-01, #147). Needs the RUN host (or `vite dev`
//     with `rundotMultiplayerPlugin`, which serves rooms locally on port 9001).
//   - `rankstore.ts` — the ranking POLICY (which key, what a stored file means,
//     when a result is filed once). No SDK: it calls the wrappers here.
// ══════════════════════════════════════════════════════════════════════════
import RundotGameAPI from "@series-inc/rundot-game-sdk/api";
import type {
  ConnectionState,
  MultiplayerApi,
  RoomEvents,
  ServerPlayer,
  ServerRoom,
} from "@series-inc/rundot-game-sdk/mp-client";
// `ListUserRoomsOptions` / `RealtimeRoomSummary` are not re-exported from
// `/mp-client` — they live on the package root. Type-only: erased at build.
import type {
  // MON-1 (#367): the IAP and entitlement surfaces the store wrapper reaches.
  // Type-only, like the two above — erased at build.
  EntitlementApi,
  IapApi,
  ListUserRoomsOptions,
  RealtimeRoomSummary,
  SpendCurrencyOptions,
} from "@series-inc/rundot-game-sdk";
import type { HexProtocol } from "./protocol";

/** Room type — must match `rundot/realtime.config.json`. */
export const ROOM_TYPE = "hexmatch";

/**
 * Matchmaking criteria — must match the room `metadata` in
 * `rundot/realtime.config.json` (§8). Two players pair only when every key
 * matches.
 */
export const MATCH_CRITERIA: Record<string, string | number> = { mode: "versus" };

/** RUN room codes are 6 characters (e.g. "HX9KWR"). */
export const ROOM_CODE_LENGTH = 6;

/** A connected RUN room speaking the hexmatch protocol. */
export type HexRoom = ServerRoom<HexProtocol>;

/** Room event handlers for a hexmatch room (`room.on(...)`). */
export type HexRoomEvents = RoomEvents<HexProtocol>;

// Re-exported so consumers never import the SDK for these types themselves.
export type {
  ConnectionState,
  ListUserRoomsOptions,
  RealtimeRoomSummary,
  ServerPlayer,
};

/** The realtime API, or a clear error when there is no RUN host. */
function realtime(): MultiplayerApi {
  const rt = RundotGameAPI.realtime as MultiplayerApi | undefined;
  if (!rt) {
    throw new Error(
      "RUN.world realtime is not available in this environment. " +
        "Multiplayer needs the RUN host (or `vite dev` with rundotMultiplayerPlugin).",
    );
  }
  return rt;
}

/**
 * Host a game. The creator becomes host (first joiner) and the server mints
 * the map seed — every client regenerates identical geometry from it.
 */
export function createRoom(): Promise<HexRoom> {
  return realtime().createRoom<HexProtocol>(ROOM_TYPE);
}

/** Join by code. The code is normalized (trim, uppercase) before sending. */
export function joinRoomByCode(code: string): Promise<HexRoom> {
  return realtime().joinRoomByCode<HexProtocol>(normalizeRoomCode(code));
}

export interface QuickMatchOptions {
  /** How long to wait for an opponent before rejecting (default MATCHMAKE_WINDOW_MS). */
  matchmakeTimeoutMs?: number;
  /** How often to poll the pool while waiting (default 1s). */
  pollIntervalMs?: number;
  /**
   * RANK-01 (#147): the similar-rank SEARCH WINDOW, as a bucket index from
   * `searchBucket()`. The pool matches criteria by equality, so a "within N
   * points" search is expressed as `rank: <bucket>` and the caller widens the
   * bucket over time. `null`/absent = Any rank: `MATCH_CRITERIA` alone.
   */
  rankBucket?: number | null;
}

/** The criteria key carrying a similar-rank search window. */
export const RANK_CRITERIA_KEY = "rank";

/**
 * How long ONE matchmake request waits before the SDK gives up on it: it sends
 * `matchmaking:cancel`, closes the socket and rejects with
 * "Matchmaking timeout — no opponent found" (SDK 5.27's own default is 120s).
 *
 * A bounded window is what makes Auto Matchmaking's Cancel honest: the SDK has
 * no public cancel for a pending `matchmakeRoom`, so an abandoned request can
 * only leave the RUN pool when its window closes. Keeping the window short
 * bounds how long a cancelled player can still be paired with someone
 * (a ghost ticket). The search itself never stops — `StartScreen` re-issues
 * the request each time a window closes.
 */
export const MATCHMAKE_WINDOW_MS = 30_000;

/**
 * True when `err` is one of the SDK's matchmaking-search rejections: the
 * request's waiting window closed, or the server dropped the ticket from the
 * pool ("no longer active"), or the ticket was cancelled. All three mean the
 * SEARCH may continue — the caller re-issues `quickMatch` — as opposed to real
 * failures (access denied, room errors, connection problems), which must
 * surface to the player.
 *
 * SDK 5.27 rejects these with plain `Error`s — no `code`, no `name` to duck-type
 * on (BETA drift, §1.4), so the messages are matched, loosely and
 * case-insensitively, the way `isAccessDenied` duck-types its shapes.
 */
export function isMatchmakeWindowExpired(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : "";
  return (
    message.includes("matchmaking timeout") ||
    message.includes("no longer active") ||
    message.includes("matchmaking cancelled")
  );
}

/**
 * Matchmaking — cross-instance transactional pairing (§8), the call intended
 * for competitive play. Whoever ends up alone in a fresh room becomes host
 * (MP-07 degrades that into a shareable invite rather than stranding them).
 *
 * NOTE: the ticket sketch passes `createOptions` here, but SDK 5.27's
 * `MatchmakeOptions` accepts only `criteria` + timeouts — matchmaking always
 * mints a 2-player room and `createOptions` is not accepted. Criteria alone.
 *
 * One call is one bounded window (see MATCHMAKE_WINDOW_MS); "keep looking
 * until found or cancelled" is the caller's loop: re-issue whenever
 * `isMatchmakeWindowExpired` says the window closed.
 */
export function quickMatch(opts: QuickMatchOptions = {}): Promise<HexRoom> {
  const { rankBucket, ...rest } = opts;
  // A plain search asks for the room type's own criteria only, so it can join
  // ANY waiting room — including one a similar-rank searcher created (the pool
  // requires the room to satisfy every requested key, not to match exactly).
  // That asymmetry is what makes the widening ladder safe: its last rung is
  // always "any rank", and it can see everyone.
  const criteria: Record<string, string | number> = rankBucket == null
    ? { ...MATCH_CRITERIA }
    : { ...MATCH_CRITERIA, [RANK_CRITERIA_KEY]: rankBucket };
  return realtime().matchmakeRoom<HexProtocol>(ROOM_TYPE, {
    criteria,
    matchmakeTimeoutMs: rest.matchmakeTimeoutMs ?? MATCHMAKE_WINDOW_MS,
    pollIntervalMs: rest.pollIntervalMs,
  });
}

/** Rooms the signed-in player belongs to (the rejoin path). */
export function getUserRooms(
  options?: ListUserRoomsOptions,
): Promise<RealtimeRoomSummary[]> {
  return realtime().getUserRooms(options);
}

// ══════════════════════════════════════════════════════════════════════════
// #164 — the rejoin path.
//
// A kicked player lands back at the start screen with no memory of the match
// they were in. The platform DOES remember: a dropped socket's seat is held
// for the room's `reconnectTimeout`, and `getUserRooms` lists every room the
// player is still rostered in — which is exactly the set of matches they can
// walk back into. Two wrappers make that usable:
//
//   listRejoinableRooms — the filtered, never-throwing list. "Never throws"
//                         is the whole design: the start screen asks this on
//                         every boot, and a host without the rooms RPC (an old
//                         webview, an offline mock) must degrade to "no
//                         rejoin on offer", never to a broken screen.
//   the active-match memo — one small per-player record of the match this
//                         device walked into (room code + whether it is
//                         RANKED). The summary cannot say whether a room came
//                         out of the rated queue, and a rejoin that silently
//                         downgraded a ranked match to a casual one would
//                         leave the two seats filing different ratings for
//                         one match. Cloud-backed like the rating file, with
//                         the same localStorage mirror for dev pages.
// ══════════════════════════════════════════════════════════════════════════

/** The per-player key holding the active-match memo (see below). */
export const ACTIVE_MATCH_KEY = "hexmatch:mp:active:v1";

/** What this device walked into, so a return can offer the same match back. */
export interface ActiveMatchMemo {
  roomCode: string;
  /** True when the match came out of the rated queue (RANK-01). */
  ranked: boolean;
  /** Wall clock (ms) when the match was entered. */
  at: number;
}

/**
 * Hexmatch rooms the signed-in player is still rostered in — the matches a
 * return can rejoin. Resolves `[]` whenever the platform cannot answer (no
 * host RPC, offline mock, signed out): no rejoin on offer is always safe.
 */
export async function listRejoinableRooms(): Promise<RealtimeRoomSummary[]> {
  try {
    const rooms = await getUserRooms();
    if (!Array.isArray(rooms)) return [];
    return rooms.filter(
      (r) => r && r.roomType === ROOM_TYPE && r.status === "active" && typeof r.roomCode === "string",
    );
  } catch {
    return [];
  }
}

/** The memo's localStorage mirror key, same pattern as the rating file. */
function activeMatchMirrorKey(): string {
  return `${RANK_LOCAL_MIRROR}:${ACTIVE_MATCH_KEY}`;
}

/** Read the active-match memo; null when absent, unreadable or malformed. */
export async function readActiveMatch(): Promise<ActiveMatchMemo | null> {
  const parse = (raw: string | null): ActiveMatchMemo | null => {
    if (!raw) return null;
    try {
      const o = JSON.parse(raw) as Partial<ActiveMatchMemo>;
      if (typeof o?.roomCode !== "string" || o.roomCode.length === 0) return null;
      return { roomCode: o.roomCode, ranked: o.ranked === true, at: Number(o.at) || 0 };
    } catch {
      return null;
    }
  };
  const memo = parse(await readPlayerValue(ACTIVE_MATCH_KEY));
  if (memo) return memo;
  try {
    if (typeof localStorage !== "undefined") return parse(localStorage.getItem(activeMatchMirrorKey()));
  } catch { /* private mode */ }
  return null;
}

/**
 * Write (or with `null`, clear) the active-match memo. Written when a
 * networked match is entered, cleared when it is left through a door this
 * client controls — a kick is precisely the case that CANNOT clear it, which
 * is what makes the rejoin offer possible on return.
 */
export async function writeActiveMatch(memo: ActiveMatchMemo | null): Promise<void> {
  const json = memo ? JSON.stringify(memo) : "";
  try {
    if (typeof localStorage !== "undefined") {
      if (memo) localStorage.setItem(activeMatchMirrorKey(), json);
      else localStorage.removeItem(activeMatchMirrorKey());
    }
  } catch { /* private mode: the remote write is the real one */ }
  if (memo) await writePlayerValue(ACTIVE_MATCH_KEY, json);
  else {
    // No removePlayerValue in the seam; an empty write reads back as null.
    try {
      const api = RundotGameAPI as unknown as { appStorage?: { removeItem?(key: string): Promise<void> } };
      await api.appStorage?.removeItem?.(ACTIVE_MATCH_KEY);
    } catch { /* nothing to clear */ }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// RANK-01 (#147) — player storage and the ladder, behind the same seam.
//
// The rating system needs two platform calls this file did not previously
// make: a per-player key/value store (the rating file) and the leaderboard
// (the public ladder). Both live HERE, with every other SDK call, so a BETA
// drift is still a one-file fix — and so the ranking policy in
// `src/net/rankstore.ts` can be read and unit-tested without an SDK.
//
// Every wrapper resolves rather than rejects. A rating read that fails must
// fall back to a fresh file, and a ladder submit that fails must not take the
// match's ending screen down with it: this is a game about freight, and none
// of these calls is worth a lost match.
// ══════════════════════════════════════════════════════════════════════════

/** The stored rating file (`appStorage`, per-player, cloud-backed). */
export const RANK_STORAGE_KEY = "hexmatch:rank:v1";

/** The once-only guard: the last room result this client filed. */
export const RANK_FILED_KEY = "hexmatch:rank:filed:v1";

/** The rating board's leaderboard mode (`rundot/leaderboard.config.json`). */
export const LADDER_MODE = "ranked";

/** Where the local mirror lives in a page with no RUN host (a dev room). */
export const RANK_LOCAL_MIRROR = "hexmatch:rank";

interface StorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * The RUN player store, or null when there is no host. Duck-typed on the same
 * basis as `isOfflineMockRealtime`: the mock resolves every call, so a wrapper
 * that trusted it would write a rating into a bucket that does not exist and
 * read `null` back forever — which looks exactly like a storage bug.
 */
function playerStorage(): StorageLike | null {
  try {
    const api = RundotGameAPI as unknown as { appStorage?: StorageLike };
    return api.appStorage ?? null;
  } catch {
    return null;
  }
}

/** Read a stored value; `null` when absent, unreachable, or malformed. */
export async function readPlayerValue(key: string): Promise<string | null> {
  const store = playerStorage();
  if (!store) return null;
  try {
    const value = await store.getItem(key);
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Write a stored value. Resolves `false` when the write did not happen, and
 * the caller mirrors to localStorage: a rating kept only on this device is a
 * worse rating, not a lost one.
 */
export async function writePlayerValue(key: string, value: string): Promise<boolean> {
  const store = playerStorage();
  if (!store) return false;
  try {
    await store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** One row of the public ladder, as the start screen prints it. */
export interface LadderEntry {
  profileId: string;
  username: string;
  rating: number;
  rank: number;
  isSeed?: boolean;
}

export interface LadderResult {
  entries: LadderEntry[];
  /** This player's own row, when the board knows them. */
  mine: { rank: number; rating: number } | null;
  total: number;
}

/** True when a leaderboard API exists behind this page at all. */
export function isLadderAvailable(): boolean {
  try {
    return typeof RundotGameAPI.leaderboard?.getPagedScores === "function";
  } catch {
    return false;
  }
}

/**
 * Read the ladder. Never throws: an unreachable or unconfigured board returns
 * `null`, and the ladder panel says so in one line rather than showing an
 * empty board that looks like nobody plays this game.
 */
export async function readLadder(limit = 20): Promise<LadderResult | null> {
  try {
    const page = await RundotGameAPI.leaderboard.getPagedScores({
      mode: LADDER_MODE,
      limit,
    });
    const entries: LadderEntry[] = (page?.entries ?? []).map((e) => ({
      profileId: e.profileId,
      username: e.username,
      rating: e.score,
      rank: e.rank ?? 0,
      isSeed: e.isSeed,
    }));
    return {
      entries,
      mine: page?.playerRank != null
        ? { rank: page.playerRank, rating: entries.find((e) => e.rank === page.playerRank)?.rating ?? 0 }
        : null,
      total: page?.totalEntries ?? entries.length,
    };
  } catch {
    return null;
  }
}

/**
 * Submit this player's rating to the ladder.
 *
 * The board is keep-best (`scoreOrder: "highest"`, the default): a lower
 * submission is accepted:false and changes nothing, which is exactly right for
 * a rating — see `docs/RANK-01-multiplayer-ranking.md` for why "peak rating"
 * rather than "current rating" is what a public board can honestly show.
 */
export async function submitLadderScore(params: {
  rating: number;
  durationSec: number;
  metadata?: Record<string, unknown>;
}): Promise<{ accepted: boolean; rank: number | null; reason: string | null }> {
  try {
    const result = await RundotGameAPI.leaderboard.submitScore({
      score: Math.round(params.rating),
      duration: Math.max(1, Math.round(params.durationSec)),
      mode: LADDER_MODE,
      metadata: params.metadata,
    });
    return {
      accepted: result?.accepted === true,
      rank: typeof result?.rank === "number" ? result.rank : null,
      reason: typeof result?.reason === "string" ? result.reason : null,
    };
  } catch (err) {
    // A rate-limited or out-of-bounds submission is not an error the player
    // needs to see: the rating itself is already filed in their own storage.
    return { accepted: false, rank: null, reason: err instanceof Error ? err.message : null };
  }
}

// ── MON-1 (#367) — the RUN Bits store ─────────────────────────────────────
// The IAP and entitlement surfaces, wrapped by the same rule as the ladder:
// every call here resolves, never throws, and says so when the platform is
// not behind the page. `src/game/store.ts` owns the policy (cache, idempotency,
// what "owned" means); this file only owns the SDK shape, so that the next
// BETA drift (§1.4) is still a one-file fix.
//
// SHAPE NOTE (the ticket's `purchase(itemId, key)` / `getBalance()` are gone):
// SDK 5.27's `IapApi` sells through `spendCurrency(productId, cost, options)`
// — the host raises its own confirm dialog, deducts the Bits and resolves
// `{ success, error }` — and reads the purse with `getHardCurrencyBalance()`.
// Durable ownership is a SEPARATE surface, `RundotGameAPI.entitlements`
// (`listEntitlements` / `getQuantity`), which is what re-verification asks.

/** Why a purchase did not go through. `null` means it did. */
export type StorePurchaseFailure =
  | "unavailable"      // no platform behind the page
  | "user-cancelled"   // the player declined the host's confirm — no charge
  | "insufficient-funds"
  | "unknown-item"
  | "error";

export interface BitsPurchaseResult {
  ok: boolean;
  reason: StorePurchaseFailure | null;
  /** The balance the host reports after the attempt, when it gives one. */
  balance: number | null;
}

/** The IAP surface, or null when the singleton has none. */
function iap(): IapApi | null {
  try {
    return (RundotGameAPI.iap ?? null) as IapApi | null;
  } catch {
    return null;
  }
}

/** The entitlement surface, or null when the singleton has none. */
function entitlements(): EntitlementApi | null {
  try {
    return (RundotGameAPI.entitlements ?? null) as EntitlementApi | null;
  } catch {
    return null;
  }
}

/**
 * True only when the SDK's offline MOCK is standing in — `vite preview` or a
 * statically served build, where `MockIapApi` hands out 100 fake Bits and
 * `spendCurrency` "succeeds" for free. Duck-typed on the mock's own field
 * (`_hardCurrency`), the same way `isOfflineMockRealtime` duck-types the
 * room mock: a class name is not a handle to rely on under BETA drift (§1.4).
 */
function isMockIap(api: IapApi): boolean {
  try {
    return "_hardCurrency" in (api as unknown as object);
  } catch {
    return false;
  }
}

/**
 * True when Bits can actually be spent from this page: a live IAP surface,
 * not the offline mock. The store panel says "unavailable" and the game plays
 * on when this is false — an unlockable must never hold the island hostage.
 */
export function isStoreAvailable(): boolean {
  const api = iap();
  if (!api || typeof api.spendCurrency !== "function") return false;
  return !isMockIap(api);
}

/** This player's Bits, or null when the purse cannot be read. */
export async function readBitsBalance(): Promise<number | null> {
  const api = iap();
  if (!api || typeof api.getHardCurrencyBalance !== "function") return null;
  try {
    const n = await api.getHardCurrencyBalance();
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Ask the platform what this player owns. Resolves `null` when the ledger
 * cannot be read at all (offline, mock, missing surface) — NULL MEANS
 * "UNKNOWN", never "owns nothing": the caller keeps its cached answer.
 */
export async function readEntitlements(
  ids: readonly string[],
): Promise<Record<string, number> | null> {
  const api = entitlements();
  if (!api || typeof api.listEntitlements !== "function") return null;
  try {
    const list = await api.listEntitlements();
    if (!Array.isArray(list)) return null;
    const want = new Set(ids);
    const out: Record<string, number> = {};
    for (const e of list) {
      if (!e || typeof e.entitlementId !== "string") continue;
      if (!want.has(e.entitlementId)) continue;
      // A revoked or expired grant is not ownership.
      if (e.status && e.status !== "active") continue;
      if (typeof e.quantity !== "number") continue;
      out[e.entitlementId] = Math.max(out[e.entitlementId] ?? 0, e.quantity);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Spend Bits on one catalogued item.
 *
 * `idempotencyKey` is OURS, not the SDK's: SDK 5.27's `spendCurrency` takes
 * no key, so the key rides along in the options bag (unknown fields are
 * ignored by a host that does not know them) and — more importantly — is
 * written to the store's own ledger BEFORE the call, so a retry after a crash
 * or a lost tab re-sends the same key instead of charging twice.
 */
export async function purchaseWithBits(req: {
  productId: string;
  price: number;
  /** Shown by the host in its own confirm dialog, so it says what it is charging for. */
  description: string;
  idempotencyKey: string;
}): Promise<BitsPurchaseResult> {
  const api = iap();
  if (!api || typeof api.spendCurrency !== "function" || isMockIap(api)) {
    return { ok: false, reason: "unavailable", balance: null };
  }
  const options = {
    screenName: "store",
    description: req.description,
    // Not in `SpendCurrencyOptions` — forwarded as an opaque field.
    idempotencyKey: req.idempotencyKey,
  } as SpendCurrencyOptions & { idempotencyKey?: string };
  try {
    const res = await api.spendCurrency(req.productId, req.price, options);
    const balance = await readBitsBalance();
    if (res?.success === true) return { ok: true, reason: null, balance };
    const err = typeof res?.error === "string" ? res.error : "";
    return {
      ok: false,
      // The one sentinel the SDK defines; everything else is a server string.
      reason: err === "USER_CANCELLED" ? "user-cancelled" : "error",
      balance,
    };
  } catch {
    return { ok: false, reason: "error", balance: null };
  }
}

/**
 * Raise the platform's own Bits store (top-ups). Null when there is no
 * platform behind the page — the panel simply hides the button.
 */
export async function openBitsStore(): Promise<{ purchased: boolean; balance: number | null } | null> {
  const api = iap();
  if (!api || typeof api.openStore !== "function" || isMockIap(api)) return null;
  try {
    const res = await api.openStore();
    return { purchased: res?.purchased === true, balance: typeof res?.newBalance === "number" ? res.newBalance : null };
  } catch {
    return null;
  }
}

/**
 * MON-1's analytics hook (purchase attempted / succeeded / failed). The SDK's
 * `analytics.recordCustomEvent` is fire-and-forget here: an unreachable
 * pipeline must never hold up a receipt the player is waiting for.
 */
export function recordStoreEvent(event: string, payload?: Record<string, unknown>): void {
  try {
    void RundotGameAPI.analytics?.recordCustomEvent(event, payload)?.catch?.(() => {});
  } catch {
    /* an absent analytics surface is not a purchase failure */
  }
}

/**
 * True when there is NO room server behind the SDK: not the RUN host, and not
 * `vite dev` either (the multiplayer plugin injects the local sidecar's origin
 * as `window.__RUNDOT_MULTIPLAYER_DEV_SERVER__`, and only on serve — a built or
 * previewed page never gets it).
 *
 * This state is a trap rather than an error: the SDK's offline mock still
 * RESOLVES `createRoom` and `joinRoomByCode` — with a random six-character code,
 * and for a join it ignores the code entirely and mocks a second room. Both
 * lobbies therefore look alive ("Connected", a copyable code) and then wait for
 * a welcome that nothing will ever send. Detect it at the door and say so.
 *
 * Duck-typed on the mock's `delegate` field, which is null exactly when it is
 * offline: BETA drift (§1.4) means a class name is not a handle to rely on, and
 * the hosted API has no such field.
 */
export function isOfflineMockRealtime(): boolean {
  try {
    const rt = RundotGameAPI.realtime as unknown as { delegate?: unknown } | undefined;
    return !!rt && "delegate" in rt && rt.delegate == null;
  } catch {
    return false;
  }
}

/**
 * Shown instead of a lobby that can never fill. Deliberately names the fix:
 * multiplayer is only reachable from the dev server (or from RUN.world once
 * published), never from `vite preview` / a static copy of the build.
 */
export const NO_ROOM_SERVER_MESSAGE =
  "No room server behind this page, so host and join can never meet. " +
  "Multiplayer runs from `npm run dev` — open the localhost:5173 URL it prints " +
  "(its room server listens on port 9001). A previewed or statically served " +
  "build mocks rooms instead; play vs AI here.";

/**
 * Normalize a room code the way the join field (MP-06) does: trim and
 * uppercase, `maxLength={6}` at the input. No server-address field exists —
 * unlike the old relay lobby there is nothing to configure.
 */
export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Shape check ONLY — the server is the final authority on whether a code
 * exists. Old-relay 4-character codes fail here, which is correct: they are a
 * different room system entirely.
 */
export function isValidRoomCode(code: string): boolean {
  const c = normalizeRoomCode(code);
  return c.length === ROOM_CODE_LENGTH && /^[A-Z0-9]+$/.test(c);
}

/**
 * True when `err` is the platform's anonymous-user rejection (§1.2).
 *
 * The ticket names `code === "ACCESS_DENIED"`; SDK 5.27 throws
 * `AccessDeniedError` (a `name`, no `code`). Accept BOTH — BETA drift (§1.4)
 * means either shape may arrive, and misclassifying it strands a signed-out
 * player on an error screen instead of the login sheet with its
 * play-vs-AI fallback.
 *
 * Duck-typed on purpose: importing the error class would couple every caller
 * to the SDK's error taxonomy.
 */
export function isAccessDenied(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; code?: unknown };
  return e.name === "AccessDeniedError" || e.code === "ACCESS_DENIED";
}

/**
 * True when no signed-in user is present — multiplayer calls will hit the
 * login sheet. Defensive: when the access gate itself is missing (a host
 * older than the gate), report signed-in and let the realtime call fail with
 * `AccessDeniedError`, which `isAccessDenied` already handles.
 */
export function isAnonymous(): boolean {
  try {
    return RundotGameAPI.accessGate.isAnonymous();
  } catch {
    return false;
  }
}

/**
 * Show the platform login sheet. Resolves `{ success: false }` when the gate
 * is unavailable rather than throwing — the caller falls through to
 * play-vs-AI (§7: that fallback is required, not optional).
 */
export function promptLogin(): Promise<{ success: boolean }> {
  try {
    return RundotGameAPI.accessGate.promptLogin();
  } catch {
    return Promise.resolve({ success: false });
  }
}
