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
//     `quickMatch`, `getUserRooms`), room-code shape, auth helpers. Needs the
//     RUN host (or `vite dev` with `rundotMultiplayerPlugin`, which serves
//     rooms locally on port 9001).
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
  ListUserRoomsOptions,
  RealtimeRoomSummary,
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
  /** How long to wait for an opponent before rejecting (default 120s). */
  matchmakeTimeoutMs?: number;
  /** How often to poll the pool while waiting (default 1s). */
  pollIntervalMs?: number;
}

/**
 * Quick match — cross-instance transactional pairing (§8), the call intended
 * for competitive play. Whoever ends up alone in a fresh room becomes host
 * (MP-07 degrades that into a shareable invite rather than stranding them).
 *
 * NOTE: the ticket sketch passes `createOptions` here, but SDK 5.27's
 * `MatchmakeOptions` accepts only `criteria` + timeouts — matchmaking always
 * mints a 2-player room and `createOptions` is not accepted. Criteria alone.
 */
export function quickMatch(opts: QuickMatchOptions = {}): Promise<HexRoom> {
  return realtime().matchmakeRoom<HexProtocol>(ROOM_TYPE, {
    criteria: { ...MATCH_CRITERIA },
    ...opts,
  });
}

/** Rooms the signed-in player belongs to (the rejoin path). */
export function getUserRooms(
  options?: ListUserRoomsOptions,
): Promise<RealtimeRoomSummary[]> {
  return realtime().getUserRooms(options);
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
