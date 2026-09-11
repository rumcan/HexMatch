// ══════════════════════════════════════════════════════════════════════════
// MP-02 — Hexmatch multiplayer protocol (RUN.world).
//
// The shared message union spoken by the host browser, the guest browser and
// the thin validating relay (`src/rooms/HexmatchRoom.ts`). Imported by BOTH
// sides, so it must stay free of browser-only and SDK imports — `transport.ts`
// is the only client module that touches the SDK, and the room keeps its
// `mp-server` import to itself. `Snapshot` is a TYPE-only import: nothing here
// may pull game code into the server bundle at runtime.
//
// Shape: `docs/HexMatch-tickets.md` §4. Rules:
//   - Guests never mutate locally; every guest action is an `IntentMsg`. The
//     host runs it through the same `construction.ts` / `economy.ts` paths as
//     single-player, so rules cannot drift.
//   - The host applies its own actions locally and immediately — no round trip.
//   - `seq` increments per delta. A guest seeing a gap sends `ResyncMsg`; the
//     host replies with a full `SnapshotMsg` (join and resync ONLY — §1.3
//     rules out full snapshots on a timer: 108 KiB vs the 16 KiB frame cap).
// ══════════════════════════════════════════════════════════════════════════
import type { Snapshot } from "../iso/snapshot";

/**
 * Protocol version. Bump WITH `SNAPSHOT_VERSION`: a new snapshot shape is a
 * new protocol, and mixed-version rooms must refuse, never desync.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Realtime WS frame cap in bytes. Mirrors the SDK's `MAX_BROADCAST_BYTES`
 * (`mp-server`, 16 KiB): a serialized message at or under this always fits
 * the gateway's `maxPayload`. Defined HERE — not imported from `mp-server` —
 * so the client never pulls server code into its bundle. MP-04's delta guard
 * asserts serialized deltas against it (§5).
 */
export const FRAME_CAP_BYTES = 16 * 1024;

/** Player slot: 0 = host (first joiner), 1 = guest. Two-player model (§6). */
export type Slot = 0 | 1;

/** server → everyone, on join */
export interface WelcomeMsg {
  type: "welcome";
  seed: number;
  hostId: string;
  protocolVersion: number;
  roster: { id: string; username: string; slot: Slot }[];
}

/** host → server → all guests. Full state; join and resync only. */
export interface SnapshotMsg {
  type: "snapshot";
  snap: Snapshot;
}

/**
 * host → server → all guests. Steady state.
 * `tiles` carries changed tile indices only — the delta format lands in
 * MP-04 (§5); `harvesters` / `factories` / `players` are small lists and go
 * whole. Only the four track layers need diffing.
 */
export interface DeltaMsg {
  type: "delta";
  t: number;
  seq: number;
  tiles?: { i: number; dirt: number; road: number; owner: number; upgraded: number }[];
  harvesters?: Snapshot["harvesters"];
  factories?: Snapshot["factories"];
  players?: Snapshot["players"];
  setupPhase?: boolean;
  won?: boolean;
}

/** guest → server → host only. Guests never mutate locally. */
export interface IntentMsg {
  type: "intent";
  action: "build" | "demolish" | "harvest" | "trade" | "skill";
  payload: unknown;
}

/** guest → server → host. Sent when a guest detects a seq gap. */
export interface ResyncMsg {
  type: "resync";
}

/** server → one client, on refused join or host loss */
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

/** Every `type` tag in the union — the discriminator RUN switches on. */
export const HEX_MESSAGE_TYPES = [
  "welcome",
  "snapshot",
  "delta",
  "intent",
  "resync",
  "reject",
] as const;

export type HexMessageType = HexProtocol["type"];

/**
 * Shown when a welcome arrives from a different protocol version (§11).
 * A mixed-version room must show this — never desync silently.
 */
export const VERSION_MISMATCH_MESSAGE =
  "This game has been updated — reload to play together";

export class ProtocolError extends Error {
  readonly code: "version" | "malformed";
  constructor(code: "version" | "malformed", message: string) {
    super(message);
    this.code = code;
    this.name = "ProtocolError";
  }
}

/**
 * Reject a welcome we cannot safely join. Mirrors `validateSnapshot`'s
 * contract (`Error | null`) so callers handle the two the same way: a
 * `version` mismatch is the common wild case (a guest left on an old tab
 * after a deploy), so it gets the actionable reload message rather than a
 * silent desync.
 */
export function validateWelcome(msg: unknown): ProtocolError | null {
  if (!msg || typeof msg !== "object") {
    return new ProtocolError("malformed", "Welcome is not an object.");
  }
  const o = msg as Partial<WelcomeMsg>;
  if (o.type !== "welcome") {
    return new ProtocolError("malformed", "Message is not a welcome.");
  }
  if (typeof o.protocolVersion !== "number") {
    return new ProtocolError("malformed", "Welcome has no protocol version.");
  }
  if (o.protocolVersion !== PROTOCOL_VERSION) {
    return new ProtocolError("version", VERSION_MISMATCH_MESSAGE);
  }
  if (typeof o.seed !== "number" || !Number.isFinite(o.seed)) {
    return new ProtocolError("malformed", "Welcome has no map seed.");
  }
  if (typeof o.hostId !== "string" || o.hostId.length === 0) {
    return new ProtocolError("malformed", "Welcome has no host.");
  }
  if (!Array.isArray(o.roster)) {
    return new ProtocolError("malformed", "Welcome has no roster.");
  }
  for (const entry of o.roster) {
    const e = entry as { id?: unknown; username?: unknown; slot?: unknown } | null;
    if (
      !e ||
      typeof e !== "object" ||
      typeof e.id !== "string" ||
      typeof e.username !== "string" ||
      (e.slot !== 0 && e.slot !== 1)
    ) {
      return new ProtocolError("malformed", "Welcome roster entry is malformed.");
    }
  }
  return null;
}

/**
 * Narrow an unknown inbound payload to the union. RUN delivers game messages
 * as one discriminated object — `type` is the whole check here; each handler
 * validates the fields it reads (as `validateWelcome` does for welcomes).
 */
export function isHexProtocol(msg: unknown): msg is HexProtocol {
  if (!msg || typeof msg !== "object") return false;
  const t = (msg as { type?: unknown }).type;
  return (
    t === "welcome" ||
    t === "snapshot" ||
    t === "delta" ||
    t === "intent" ||
    t === "resync" ||
    t === "reject"
  );
}
