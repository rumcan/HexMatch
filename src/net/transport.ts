// ══════════════════════════════════════════════════════════════════════════
// MP-02 — the transport seam (docs/HexMatch-tickets.md §1.4).
//
// This is the ONLY file under src/ that imports the RUN.world SDK. The
// multiplayer API is BETA and will drift; every call is behind a function here
// so a breaking change is a one-file fix. `tests/unit/net-protocol.test.ts`
// enforces the rule — add an SDK import anywhere else and the suite goes red.
//
// The one exception is `src/rooms/HexmatchRoom.ts`, which imports
// `/mp-server` because it IS the server bundle. Client and server never share
// a module that touches the SDK.
//
// Three facts about 5.27.0 that this file encodes, each verified against the
// installed package rather than the ticket text:
//
//   1. `AccessDeniedError` has NO `code` field. It carries `name`,
//      `requiredTier` and `action` (dist/chunk-PQ5SS4T2.js:5449). The ticket's
//      `err.code === "ACCESS_DENIED"` check would never match, so §7's
//      "fall through to Play vs AI" would never fire. Test on `name`.
//   2. The access gate wraps `createRoom`, `joinOrCreateRoom`, `joinRoomByCode`
//      and `getUserRooms` — NOT `matchmakeRoom` (chunk-PQ5SS4T2.js:5590). Quick
//      match therefore gets no automatic login sheet; MP-07 has to prompt.
//   3. `room:error` frames are rejected as `new Error(msg.message)`
//      (chunk-PQ5SS4T2.js:7640) — the structured `code` is dropped. Failure
//      kinds can only be recovered from the message text, which is why the
//      matcher below is the brittle part, and why it lives here.
//
// Do not confuse our `PROTOCOL_VERSION` (src/net/protocol.ts) with the SDK's
// own export of the same name from `/mp-client` — unrelated, and both are 1
// today, which is exactly how a wrong import would go unnoticed.
// ══════════════════════════════════════════════════════════════════════════
import RundotGameAPI from "@series-inc/rundot-game-sdk/api";
import type {
  ConnectionState,
  MatchmakeOptions,
  RealtimeRoomSummary,
  ServerPlayer,
  ServerRoom,
} from "@series-inc/rundot-game-sdk";
import {
  protocolMismatch,
  type HexProtocol,
  type IntentMsg,
  type ResyncMsg,
} from "./protocol";

/** Room type registered in `rundot/realtime.config.json`. */
export const ROOM_TYPE = "hexmatch";

/** §7: the join field is a 6-character code, uppercased and trimmed. */
export const ROOM_CODE_LENGTH = 6;

/** Quick match pairs on this room metadata (§6, §8). */
export const MATCH_CRITERIA = { mode: "versus" } as const;

export type TransportFailure =
  /** Anonymous user; §1.2. The caller must offer "Play vs AI" (§7). */
  | "needs-signin"
  /** No room with that code, or it was disposed. */
  | "not-found"
  /** Both seats taken, or the room locked itself. */
  | "room-full"
  /** Socket/timeout — worth a retry. */
  | "network"
  | "unknown";

export class TransportError extends Error {
  readonly reason: TransportFailure;
  /** The SDK error, kept for the debug console. */
  readonly cause: unknown;

  constructor(reason: TransportFailure, message: string, cause?: unknown) {
    super(message);
    this.name = "TransportError";
    this.reason = reason;
    this.cause = cause;
  }
}

/**
 * §1.2 — every realtime call rejects anonymous users. The SDK's auto-prompt
 * normally shows the login sheet and retries; when it still fails we get this,
 * and the UI owes the player a one-click path to a playable game.
 */
export function isAccessDenied(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; requiredTier?: unknown };
  return e.name === "AccessDeniedError" || e.requiredTier === "authenticated_18plus";
}

/** Recover a failure kind from an SDK rejection. See note 3 above. */
export function classifyError(err: unknown): TransportError {
  if (err instanceof TransportError) return err;
  const message = err instanceof Error ? err.message : String(err ?? "Unknown error");

  if (isAccessDenied(err)) {
    return new TransportError("needs-signin", "Sign in to play with friends.", err);
  }
  if (/not found|no such room|invalid (room )?code|expired/i.test(message)) {
    return new TransportError("not-found", "No game with that code. Ask your friend to check it.", err);
  }
  if (/full|locked|no space|capacity/i.test(message)) {
    return new TransportError("room-full", "That game already has two players.", err);
  }
  if (/timeout|timed out|network|socket|websocket|closed|connect|offline/i.test(message)) {
    return new TransportError("network", "Could not reach RUN.world. Check your connection.", err);
  }
  return new TransportError("unknown", message, err);
}

export function normaliseRoomCode(input: string): string {
  return input.trim().toUpperCase().slice(0, ROOM_CODE_LENGTH);
}

export function isPlausibleRoomCode(input: string): boolean {
  return normaliseRoomCode(input).length === ROOM_CODE_LENGTH;
}

export type TransportRoom = ServerRoom<HexProtocol>;

export interface RoomHandlers {
  /** A broadcast or targeted message that passed the version check. */
  onMessage?: (msg: HexProtocol) => void;
  onPlayerJoined?: (player: ServerPlayer) => void;
  onPlayerLeft?: (playerId: string) => void;
  onDisconnect?: () => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
  onConnectionState?: (state: ConnectionState) => void;
  /**
   * §11 — a room whose `PROTOCOL_VERSION` is not ours. The welcome is NOT
   * forwarded: a mixed-version room must refuse, never desync silently.
   */
  onIncompatible?: (remoteVersion: number, message: string) => void;
  onError?: (err: TransportError) => void;
}

/**
 * Wire a room's events to the game. The version gate sits here because this is
 * the only door the wire comes through: nothing downstream can be handed a
 * welcome from a room it cannot understand.
 */
export function attach(room: TransportRoom, handlers: RoomHandlers): void {
  const deliver = (msg: HexProtocol) => {
    if (msg.type === "welcome") {
      const refusal = protocolMismatch(msg.protocolVersion);
      if (refusal) {
        handlers.onIncompatible?.(msg.protocolVersion, refusal);
        return;
      }
    }
    handlers.onMessage?.(msg);
  };

  room.on({
    // The room relays host state by broadcast and guest intents by sendTo, so
    // both channels carry `HexProtocol`.
    onMessage: deliver,
    onPrivateMessage: deliver,
    onPlayerJoined: (player) => handlers.onPlayerJoined?.(player),
    onPlayerLeft: (playerId) => handlers.onPlayerLeft?.(playerId),
    onError: (message) => handlers.onError?.(classifyError(new Error(message))),
    onDisconnect: () => handlers.onDisconnect?.(),
    onReconnecting: () => handlers.onReconnecting?.(),
    onReconnected: () => handlers.onReconnected?.(),
  });
}

/** §7 "Host a game". Requires a signed-in user (§1.2). */
export async function hostRoom(): Promise<TransportRoom> {
  try {
    return await RundotGameAPI.realtime.createRoom<HexProtocol>(ROOM_TYPE);
  } catch (err) {
    throw classifyError(err);
  }
}

/** §7 "Join with a code". */
export async function joinByCode(code: string): Promise<TransportRoom> {
  const normalised = normaliseRoomCode(code);
  if (!isPlausibleRoomCode(normalised)) {
    throw new TransportError("not-found", `Room codes are ${ROOM_CODE_LENGTH} characters.`);
  }
  try {
    return await RundotGameAPI.realtime.joinRoomByCode<HexProtocol>(normalised);
  } catch (err) {
    throw classifyError(err);
  }
}

/**
 * §8 "Quick match". `matchmakeRoom` rather than `joinOrCreateRoom`: the latter
 * races when two players call it at once, which is precisely the quick-match
 * case. Note 2 above — this call is NOT access-gated, so it will not raise
 * `needs-signin` for an anonymous user; MP-07 has to check sign-in itself.
 */
export async function quickMatch(opts?: MatchmakeOptions): Promise<TransportRoom> {
  try {
    return await RundotGameAPI.realtime.matchmakeRoom<HexProtocol>(ROOM_TYPE, {
      criteria: MATCH_CRITERIA,
      ...opts,
    });
  } catch (err) {
    throw classifyError(err);
  }
}

/** "You are already in a game" recovery — MP-08. */
export async function listMyRooms(): Promise<RealtimeRoomSummary[]> {
  try {
    return await RundotGameAPI.realtime.getUserRooms();
  } catch (err) {
    throw classifyError(err);
  }
}

/** Guest → host. Never mutates anything locally (§4). */
export function sendIntent(room: TransportRoom, intent: IntentMsg): void {
  room.send(intent);
}

/** Guest saw a `seq` gap; ask the host for a full snapshot (§4). */
export function requestResync(room: TransportRoom): void {
  const msg: ResyncMsg = { type: "resync" };
  room.send(msg);
}

export function leaveRoom(room: TransportRoom): void {
  room.leave();
}
