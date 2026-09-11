// ══════════════════════════════════════════════════════════════════════════
// MP — the multiplayer wire protocol (docs/HexMatch-tickets.md §4).
//
// One discriminated union on `type`, shared by BOTH sides: the client bundle
// (`src/net/transport.ts`) and the server bundle (`src/rooms/HexmatchRoom.ts`).
// RUN requires a discriminated union for `GameRoom<P>` — every member must
// carry a `{ type: string }` — and it strips that `type` field off the wire and
// reattaches it on receipt, so a payload field named `type` would be clobbered.
// None of the members below have one.
//
// Authority model (§2): the host browser runs the full simulation, this file's
// server-side consumer is a thin validating relay. Guests never mutate state;
// every guest action is an `IntentMsg` the host runs through the same
// `construction.ts` / `economy.ts` paths as single-player, so the rules cannot
// drift between the two paths.
//
// NOTE on the `Snapshot` import: it is `import type` on purpose. `snapshot.ts`
// pulls in `grid.ts`, `track.ts` and `economy.ts`; a value import would drag
// the whole isometric engine into the server bundle for one type alias.
// ══════════════════════════════════════════════════════════════════════════
import type { Snapshot } from "../iso/snapshot";

/**
 * Bump alongside `SNAPSHOT_VERSION` (src/iso/snapshot.ts, currently 9) whenever
 * the wire shape changes. A mixed-version room must refuse loudly, never
 * desync silently — §11.
 */
export const PROTOCOL_VERSION = 1;

/** Two seats: `players[0]` is you, `players[1]` is the rival (src/iso/game.ts). */
export type Slot = 0 | 1;

/**
 * §11 — the exact string a mixed-version room must show. `validateSnapshot`
 * (src/iso/snapshot.ts:159) already refuses a mismatched `SNAPSHOT_VERSION`;
 * this is the same rule for the wire shape, and it must never desync silently.
 */
export const PROTOCOL_MISMATCH_MESSAGE = "This game has been updated — reload to play together.";

/**
 * `null` when the far end speaks our protocol, otherwise the refusal message.
 * `undefined` counts as a mismatch: a welcome with no `protocolVersion` came
 * from a build that predates the check, which is precisely the case that must
 * not be trusted.
 */
export function protocolMismatch(remoteVersion: number | undefined): string | null {
  return remoteVersion === PROTOCOL_VERSION ? null : PROTOCOL_MISMATCH_MESSAGE;
}

export interface RosterEntry {
  id: string;
  username: string;
  slot: Slot;
}

/** server → each client, on join. Carries the seed every client regenerates from. */
export interface WelcomeMsg {
  type: "welcome";
  seed: number;
  /** Player id of the browser that owns the truth. Empty string until assigned. */
  hostId: string;
  protocolVersion: number;
  roster: RosterEntry[];
}

/** host → server → all guests. Full state; join and resync only (§1.3). */
export interface SnapshotMsg {
  type: "snapshot";
  snap: Snapshot;
}

/** One changed tile: index plus the four layers that moved. */
export interface TileDelta {
  i: number;
  dirt: number;
  road: number;
  owner: number;
  upgraded: number;
}

/**
 * host → server → all guests. Steady state (§5).
 *
 * A full snapshot is 108 KiB and the RUN frame cap is 16 KiB, so only the tiles
 * that actually changed travel here — capped at ~200 before the host falls back
 * to a full `SnapshotMsg`. The small lists ride along whole.
 */
export interface DeltaMsg {
  type: "delta";
  t: number;
  /** Monotonic per room. A guest that sees a gap asks for a resync. */
  seq: number;
  tiles?: TileDelta[];
  harvesters?: Snapshot["harvesters"];
  factories?: Snapshot["factories"];
  players?: Snapshot["players"];
  setupPhase?: boolean;
  won?: boolean;
}

/**
 * guest → server → host only. Guests never mutate locally, so every guest
 * action crosses as an intent and comes back down inside a delta.
 */
export interface IntentMsg {
  type: "intent";
  action: "build" | "demolish" | "harvest" | "trade" | "skill";
  payload: unknown;
}

/** guest → server → host. Sent when a guest detects a `seq` gap. */
export interface ResyncMsg {
  type: "resync";
}

/** server → one client (refused join) or all of them (host lost). */
export interface RejectMsg {
  type: "reject";
  reason: string;
}

export type HexProtocol =
  | WelcomeMsg
  | SnapshotMsg
  | DeltaMsg
  | IntentMsg
  | ResyncMsg
  | RejectMsg;

/** Messages only the host may originate — the relay drops them from anyone else. */
export function isHostOnly(msg: HexProtocol): msg is SnapshotMsg | DeltaMsg {
  return msg.type === "snapshot" || msg.type === "delta";
}

/** Messages that must be routed to the host and to nobody else. */
export function isHostBound(msg: HexProtocol): msg is IntentMsg | ResyncMsg {
  return msg.type === "intent" || msg.type === "resync";
}
