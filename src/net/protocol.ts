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
 *
 * v2 (MP-05): the wire gained `snapshot-chunk`. A full state can be ~110 KiB
 * and the frame is capped at 16 KiB (§1.3), so join/resync state crosses as N
 * frames (see `chunkSnapshot`). A v1 peer cannot reassemble them and would sit
 * forever on an empty map, so the welcome must refuse it instead — the version
 * check turns "waits for state that can never arrive" into the reload message.
 */
export const PROTOCOL_VERSION = 2;

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
 * MP-05: the delta's player entry. The snapshot carries the §4 shape (id, vp,
 * purse); a guest ALSO needs the per-seat opening allowances it previews
 * prices from (`freeTrack` / `freeDepots`), and the delta is where MP-05 may
 * add them — additively, so a v1 reader that ignores them still plays.
 */
export type DeltaPlayer = Snapshot["players"][number] & {
  freeTrack?: number;
  freeDepots?: number;
};

/**
 * host → server → all guests. Steady state.
 * `tiles` carries changed tile indices only (§5); `harvesters` / `factories` /
 * `players` are small lists and go whole. Only the four track layers need
 * diffing.
 */
export interface DeltaMsg {
  type: "delta";
  t: number;
  seq: number;
  tiles?: { i: number; dirt: number; road: number; owner: number; upgraded: number }[];
  harvesters?: Snapshot["harvesters"];
  factories?: Snapshot["factories"];
  players?: DeltaPlayer[];
  setupPhase?: boolean;
  won?: boolean;
  /**
   * MP-05: a one-shot line for the guest ("your action was refused — 2 more
   * Ore"). Rides the next delta, which the relay already forwards; there is no
   * guest→host acknowledgement in §4, and a silent refusal reads as a bug.
   */
  notice?: string;
}

/**
 * MP-05 — a slice of a full `SnapshotMsg` (§1.3 the frame cap, §5 the
 * `snapshot` fallback).
 *
 * A whole snapshot is ~110 KiB of base64 against a 16 KiB frame, and the
 * gateway does not fragment: an oversized frame is dropped (or closes the
 * socket). "Send a full snapshot on join/resync" therefore only works as a
 * CHUNKED transfer:
 *
 *   host: JSON.stringify(snap) → split every `SNAPSHOT_CHUNK_CHARS` → N frames
 *   guest: concat by index → JSON.parse → `validateSnapshot` → apply
 *
 * `seq` is the delta sequence the snapshot REPRESENTS (the last delta the host
 * published before it). The guest resumes from there, so a snapshot and the
 * deltas around it compose: apply snapshot(seq) then deltas seq+1, seq+2…
 * Frames of one transfer share `id`, and a newer `id` supersedes one in
 * flight, so a resync that overtakes a slow join can never mix halves.
 */
export interface SnapshotChunkMsg {
  type: "snapshot-chunk";
  /** Transfer id — monotonic per host, newest wins. */
  id: number;
  /** Delta sequence this snapshot represents; the guest resumes at `seq`. */
  seq: number;
  /** 0-based index of this frame and the transfer's total frame count. */
  i: number;
  n: number;
  /** A slice of `JSON.stringify(snap)`. Reassembly is a plain concat. */
  data: string;
}

/** Characters of snapshot JSON per chunk frame. ~8.1 KiB on the wire: half the
 *  16 KiB cap, which leaves room for the envelope and for a stricter gateway. */
export const SNAPSHOT_CHUNK_CHARS = 8000;

/** Frames a transfer may run to before it is refused as malformed (~1 MiB).
 *  A 110 KiB snapshot is ~15; the bound only stops a hostile/broken flood. */
export const MAX_SNAPSHOT_CHUNKS = 128;

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
  | SnapshotChunkMsg
  | DeltaMsg
  | IntentMsg
  | ResyncMsg
  | RejectMsg;

/** Every `type` tag in the union — the discriminator RUN switches on. */
export const HEX_MESSAGE_TYPES = [
  "welcome",
  "snapshot",
  "snapshot-chunk",
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
    t === "snapshot-chunk" ||
    t === "delta" ||
    t === "intent" ||
    t === "resync" ||
    t === "reject"
  );
}

// ── MP-05: chunked full-state transfer ────────────────────────────────────

/**
 * Split one snapshot into frames that each fit the guaranteed 16 KiB cap.
 *
 * `JSON.stringify` output is sliced by UTF-16 code unit; the guest rejoins the
 * exact same string before parsing, so a slice may split anything (an escape,
 * a surrogate pair) without corrupting the result — only the concat matters.
 * The size bound is therefore exact: every frame carries at most
 * `SNAPSHOT_CHUNK_CHARS` data characters plus ~60 bytes of envelope.
 */
export function chunkSnapshot(
  snap: Snapshot,
  seq: number,
  id: number,
  chunkChars: number = SNAPSHOT_CHUNK_CHARS,
): SnapshotChunkMsg[] {
  const json = JSON.stringify(snap);
  const size = Math.max(1, Math.floor(chunkChars));
  const n = Math.max(1, Math.ceil(json.length / size));
  const out: SnapshotChunkMsg[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      type: "snapshot-chunk",
      id: Math.floor(id) >>> 0,
      seq: Math.floor(seq),
      i,
      n,
      data: json.slice(i * size, (i + 1) * size),
    });
  }
  return out;
}

/** A reassembled full state plus the delta sequence it represents. */
export interface AssembledSnapshot {
  snap: Snapshot;
  /**
   * The delta sequence the snapshot represents: the guest resumes at `seq`, so
   * snapshot(seq) then deltas seq+1, seq+2… compose into one continuous state.
   */
  seq: number;
}

/**
 * Guest-side reassembly of a chunked snapshot.
 *
 * Deliberately strict and self-healing: shape-invalid frames are ignored, a new
 * transfer id abandons whatever was half-received (a resync that overtakes a
 * slow join), a duplicate index does not double-append, and a transfer that
 * never completes simply never yields — `pending` tells the caller to keep
 * buffering deltas instead of applying them to a half-applied world. The
 * parse is the only throwing step, and it is caught: a corrupt transfer yields
 * `null` and resets, never a partial snapshot.
 */
export class SnapshotAssembler {
  private id = -1;
  private seq = -1;
  private total = 0;
  private parts: string[] = [];
  private filled = 0;

  /** True while a transfer is in flight (some frames seen, not all). */
  get pending(): boolean {
    return this.total > 0 && this.filled < this.total;
  }

  /** Frames still missing; 0 when idle or complete. */
  get missing(): number {
    return this.total > 0 ? this.total - this.filled : 0;
  }

  reset(): void {
    this.id = -1;
    this.seq = -1;
    this.total = 0;
    this.parts = [];
    this.filled = 0;
  }

  /**
   * Feed one frame; returns the reassembled state on the frame that completes
   * the transfer, `null` otherwise.
   */
  accept(msg: unknown): AssembledSnapshot | null {
    if (!msg || typeof msg !== "object") return null;
    const m = msg as Partial<SnapshotChunkMsg>;
    if (m.type !== "snapshot-chunk") return null;
    const { id, seq, i, n, data } = m;
    if (
      typeof id !== "number" || !Number.isInteger(id) ||
      typeof seq !== "number" || !Number.isInteger(seq) ||
      typeof i !== "number" || !Number.isInteger(i) ||
      typeof n !== "number" || !Number.isInteger(n) ||
      typeof data !== "string"
    ) {
      return null;
    }
    if (n <= 0 || n > MAX_SNAPSHOT_CHUNKS || i < 0 || i >= n) return null;
    if (data.length > SNAPSHOT_CHUNK_CHARS) return null;

    if (id !== this.id || n !== this.total) {
      // A new transfer (or a re-cut of this one) — the old partial is dead.
      this.id = id;
      this.seq = seq;
      this.total = n;
      this.parts = new Array<string>(n).fill("");
      this.filled = 0;
    }
    if (this.parts[i] === "") {
      this.parts[i] = data;
      this.filled++;
    }
    if (this.filled < this.total) return null;

    const json = this.parts.join("");
    const seqAtStart = this.seq;
    this.reset();
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return null;                                   // corrupt transfer: resync heals it
    }
    if (!parsed || typeof parsed !== "object") return null;
    return { snap: parsed as Snapshot, seq: seqAtStart };
  }
}
