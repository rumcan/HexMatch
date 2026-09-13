// ══════════════════════════════════════════════════════════════════════════
// MP-05 — the networked session: role, slot, roster, connection state, and
// both directions of state flow.
//
// The ticket's §2 decision is host authority: the host browser runs the sim,
// the guest renders only, and the room is a thin relay. THIS module is the
// client half of that contract — everything that speaks the wire, so
// `src/iso/game.ts` only has to answer two questions:
//
//   host   — "here is the state" (publish) and "apply this guest intent"
//   guest  — "apply this state" (snapshot/delta) and "send this intent"
//
// What it owns, and why each piece is here and not in game.ts:
//
//   role / slot / roster   §3. The room mints the seed and names the host; the
//                          welcome is the only place that is authoritative, so
//                          the session is where a client learns what it is.
//   seat mirror            The room seats the first joiner at slot 0 (host) and
//                          the second at slot 1 (guest), and every byte on the
//                          wire is in that frame of reference. Each browser
//                          renders "me" as players[0] (that is what all of the
//                          single-player UI assumes), so a GUEST mirrors the
//                          seats on the way in: owner byte 1↔2, owner id 1↔2,
//                          owner name "you"↔"ai", player list order. Doing it
//                          here means the game code needs no idea that a seat
//                          swap happened at all — and the host is identity.
//   chunked snapshots      §1.3: a full state is ~110 KiB against a 16 KiB
//                          frame, so join/resync state crosses as N
//                          `snapshot-chunk` frames (`protocol.ts`) and is
//                          reassembled here, never partially applied.
//   delta sequence         §4: deltas carry `seq`; a gap means the guest's
//                          world is not the host's, so it asks for a resync
//                          instead of quietly drifting. Deltas that arrive
//                          while a snapshot is in flight are BUFFERED, because
//                          applying them to a half-known world is the desync
//                          this whole file exists to prevent.
//   connection state       A reconnect is exactly when a guest must resync —
//                          the SDK re-attaches the socket but replays nothing.
//
// Deliberately transport-agnostic: this file never imports the SDK (the
// protocol-isolation test enforces it). `transport.ts` owns the SDK; the room
// type arrives as `HexRoom`, and the shapes the game hands over are the
// plain-data ones from `snapshot.ts` / `track.ts`.
// ══════════════════════════════════════════════════════════════════════════
import {
  MAX_SNAPSHOT_CHUNKS,
  PROTOCOL_VERSION,
  SnapshotAssembler,
  VERSION_MISMATCH_MESSAGE,
  chunkSnapshot,
  isHexProtocol,
  validateWelcome,
  type AssembledSnapshot,
  type DeltaMsg,
  type HexProtocol,
  type IntentMsg,
  type Slot,
  type SnapshotChunkMsg,
  type WelcomeMsg,
} from "./protocol";
import { applyTrackDelta, buildPublish, type PublishFields } from "./delta";
import { bytesToBase64, base64ToBytes, type Snapshot } from "../iso/snapshot";
import type { DirtyTiles, Track } from "../iso/track";
// Type-only: `transport.ts` loads the RUN SDK singleton, and this module must
// stay importable from Node (the unit suite) and from the game bundle without
// dragging the SDK in.
import type { ConnectionState, HexRoom } from "./transport";

/** What a client is. `solo` never constructs a session at all. */
export type NetRole = "solo" | "host" | "guest";

/** How long a full-state transfer may be reused before a new one is minted. */
const RESYNC_MIN_INTERVAL_MS = 400;

/** Two full-state publishes closer than this are the same event (the room
 *  welcomes a joiner AND the joiner asks for a resync — one snapshot answers
 *  both). A later, genuine resync is always honoured. */
const FULL_STATE_MIN_INTERVAL_MS = 300;

/** Deltas held while a snapshot is in flight. Beyond this the backlog itself
 *  is the problem, and a fresh resync is cheaper than applying a stale queue. */
export const MAX_PENDING_DELTAS = 64;

/** A roster entry, as the room greets it (§4 `WelcomeMsg.roster`). */
export type RosterEntry = WelcomeMsg["roster"][number];

/** Everything the welcome teaches a client about where it is. */
export interface NetInfo {
  role: "host" | "guest";
  seed: number;
  hostId: string;
  /** This client's own player id, straight from the room. */
  selfId: string;
  roster: RosterEntry[];
  roomCode: string;
}

/** The game's end of the session — all optional, all called synchronously. */
export interface NetHooks {
  /** The welcome arrived (roles, seed, roster, usernames). */
  info?: (info: NetInfo) => void;
  /** HOST: build the current full state for a joining/rejoining guest. */
  fullState?: () => Snapshot | null;
  /** HOST: a guest intent, shape-checked but not yet validated by the rules. */
  intent?: (msg: IntentMsg) => void;
  /** GUEST: a validated, reassembled full state (join or resync). */
  snapshot?: (snap: Snapshot, seq: number) => void;
  /** GUEST: an in-order steady-state delta, already mirrored to local seats. */
  delta?: (msg: DeltaMsg) => void;
  /** Either side: the room refused something final (host left, version skew). */
  reject?: (reason: string) => void;
  /** Connection state changed. */
  status?: (state: ConnectionState) => void;
}

export interface NetSessionOptions {
  /** The connected room from `transport.ts` (`createRoom` / `joinRoomByCode`). */
  room: HexRoom;
  /**
   * The role the start screen believes it has. The welcome is authoritative
   * and corrects it — a room's host is whoever the room seated first, which is
   * not necessarily what a client guessed before it was seated.
   */
  role: "host" | "guest";
}

/**
 * One client's multiplayer session. Construct it with the connected room,
 * `attach()` the game's hooks, and it runs: intents out, state in.
 */
export class NetSession {
  readonly room: HexRoom;

  private roleValue: "host" | "guest";
  private hooks: NetHooks = {};
  private readonly assembler = new SnapshotAssembler();
  private infoValue: NetInfo | null = null;
  /** Deltas the host has published (host) / applied (guest) — the wire's `seq`. */
  private seqValue = 0;
  /** Guest: the sequence its world reflects. -1 = no world yet. */
  private lastSeqValue = -1;
  private queue: DeltaMsg[] = [];
  private transferId = 0;
  private lastResyncAt = -Infinity;
  private lastFullAt = -Infinity;
  private noticeValue: string | null = null;
  private halted = false;
  private attached = false;

  constructor(opts: NetSessionOptions) {
    this.room = opts.room;
    this.roleValue = opts.role;
  }

  // ── identity / status ───────────────────────────────────────────────────
  get role(): "host" | "guest" {
    return this.roleValue;
  }
  get isHost(): boolean {
    return this.roleValue === "host";
  }
  get isGuest(): boolean {
    return this.roleValue === "guest";
  }
  /** This client's own room player id (the socket's identity, not a seat). */
  get playerId(): string {
    return this.room.playerId;
  }
  get roomCode(): string {
    return this.room.roomCode;
  }
  get connectionState(): ConnectionState {
    return this.room.connectionState;
  }
  get latency(): number {
    return this.room.latency;
  }
  /** The welcome, once it has arrived. Null while the room is still greeting. */
  get info(): NetInfo | null {
    return this.infoValue;
  }
  get roster(): RosterEntry[] {
    return this.infoValue?.roster ?? [];
  }
  /** True once the room has seated a second player. */
  get hasOpponent(): boolean {
    return this.roster.length >= 2;
  }
  /** Host: deltas published so far. Guest: deltas applied so far. */
  get seq(): number {
    return this.roleValue === "host" ? this.seqValue : this.lastSeqValue;
  }
  /** True while the guest is waiting for full state (joining or resyncing). */
  get awaitingState(): boolean {
    return this.roleValue === "guest" && (this.lastSeqValue < 0 || this.assembler.pending);
  }
  /** Deltas queued behind a snapshot transfer — the desync guard's backlog. */
  get backlog(): number {
    return this.queue.length;
  }

  /**
   * Wire the game's hooks. The guest asks for full state immediately: whatever
   * it may have missed before the game booted (a welcome, early deltas) is
   * unanswerable any other way, and asking is idempotent — the host replies
   * with one chunked snapshot.
   */
  attach(hooks: NetHooks): void {
    this.hooks = hooks;
    const room = this.room;
    room.on({
      onMessage: (msg) => this.receive(msg),
      // MP-03 sends the welcome BOTH ways (broadcast to members, sendTo to the
      // newcomer whose socket registers after the hook). Listen on both or the
      // first joiner never learns it is the host.
      onPrivateMessage: (msg) => this.receive(msg),
      onDisconnect: () => this.hooks.status?.("disconnected"),
      onReconnecting: () => this.hooks.status?.("reconnecting"),
      onReconnected: () => {
        this.hooks.status?.("connected");
        // The socket replays nothing: whatever happened while it was down is
        // exactly what a resync is for.
        if (this.isGuest) this.requestResync("reconnected");
      },
      onError: () => this.hooks.status?.("disconnected"),
    });
    this.attached = true;
    if (this.isGuest) this.requestResync("attach");
    else if (this.hasOpponent) this.publishFullState("host ready");
  }

  /** Stop exchanging state (a fatal error the player must act on). */
  halt(reason: string): void {
    if (this.halted) return;
    this.halted = true;
    this.queue = [];
    this.assembler.reset();
    this.hooks.reject?.(reason);
  }

  dispose(): void {
    this.halted = true;
    this.queue = [];
    this.assembler.reset();
    this.hooks = {};
  }

  // ── guest → host ────────────────────────────────────────────────────────
  /**
   * Send a player action to the host. The guest never mutates: this is the
   * ONLY way its clicks reach the world (§4).
   */
  sendIntent(action: IntentMsg["action"], payload: unknown): boolean {
    if (!this.isGuest || this.halted) return false;
    this.room.send({ type: "intent", action, payload } satisfies IntentMsg);
    return true;
  }

  /**
   * Ask the host for full state (a seq gap, a reconnect, a fresh attach).
   *
   * `why` is for callers/logs — the §4 message carries no reason. The throttle
   * exists for exactly one thing: `attach()` and the welcome both ask, and the
   * host should answer both with ONE transfer. It never blocks the state
   * machine (`onDelta` marks the world suspect itself), so a throttled ask can
   * only delay a re-ask, never skip the resync.
   */
  requestResync(why: string): boolean {
    if (!this.isGuest || this.halted) return false;
    const now = Date.now();
    if (now - this.lastResyncAt < RESYNC_MIN_INTERVAL_MS) return false;
    this.lastResyncAt = now;
    void why;
    // The world is suspect from here: `lastSeq < 0` queues every delta until
    // the snapshot lands, so nothing half-true can be applied on top of an old
    // map.
    this.lastSeqValue = -1;
    this.room.send({ type: "resync" });
    return true;
  }

  // ── host → guests ───────────────────────────────────────────────────────
  /**
   * Publish one steady-state tick from the dirty-tile journal. Falls back to a
   * full (chunked) snapshot when the delta would be too big — the §5 rule,
   * already decided by `buildPublish`; this only picks the channel.
   */
  publishTrack(
    track: Track,
    dirty: DirtyTiles,
    fields: Omit<PublishFields, "seq" | "notice"> & { notice?: string | null },
  ): "delta" | "snapshot" | "idle" {
    if (!this.isHost || this.halted) return "idle";
    const notice = fields.notice ?? this.noticeValue;
    const decision = buildPublish(track, dirty, {
      ...fields,
      seq: this.seqValue + 1,
      notice: notice ?? undefined,
    });
    if (decision.kind === "snapshot") {
      // The journal was drained, which is safe here and only here: the snapshot
      // carries everything the drained tiles would have said. That is also why
      // this send does NOT go through the duplicate-publish throttle — the
      // drain already happened, and `buildPublish`'s contract is that dropping
      // the decision desyncs the guest. (A burst inside the join's throttle
      // window is a changed world, not the same event twice.)
      return this.sendFullState(decision.reason, true) ? "snapshot" : "idle";
    }
    this.seqValue = decision.msg.seq;
    if (notice) this.noticeValue = null;      // delivered; never repeat a line
    this.room.send(decision.msg);
    return "delta";
  }

  /**
   * Send full state as N chunk frames (§1.3). Returns false when there is
   * nothing to send, when a duplicate publish is throttled, or when the state
   * is too large to frame at all.
   */
  publishFullState(reason: string): boolean {
    return this.sendFullState(reason, false);
  }

  /**
   * The one place a transfer is framed and sent. `force` skips the coalescing
   * throttle for the callers whose state is already gone from the journal —
   * see `publishTrack`'s snapshot branch; every ask-driven publish (welcome,
   * a seated guest, a resync request) stays throttled, so the room's greeting
   * and the newcomer's own ask share one transfer.
   */
  private sendFullState(reason: string, force: boolean): boolean {
    if (!this.isHost || this.halted) return false;
    const now = Date.now();
    if (!force && now - this.lastFullAt < FULL_STATE_MIN_INTERVAL_MS) return false;
    const snap = this.hooks.fullState?.();
    if (!snap) return false;
    const frames: SnapshotChunkMsg[] = chunkSnapshot(snap, this.seqValue, ++this.transferId);
    if (frames.length > 0 && frames.length <= MAX_SNAPSHOT_CHUNKS) {
      this.lastFullAt = now;
      for (const frame of frames) this.room.send(frame);
      return true;
    }
    // Unreachable for a 144×144 board (≈15 frames); a guard, not a branch.
    this.hooks.reject?.(`State too large to send (${reason}).`);
    return false;
  }

  /** Queue a one-shot line for the next delta the host publishes. */
  setNotice(text: string): void {
    this.noticeValue = text;
  }
  /** The line the next delta will carry, if any. */
  get notice(): string | null {
    return this.noticeValue;
  }

  // ── inbound ─────────────────────────────────────────────────────────────
  /** Feed one message. Public so tests can drive a session without a room. */
  receive(raw: unknown): void {
    if (this.halted || !isHexProtocol(raw)) return;
    switch (raw.type) {
      case "welcome":
        this.onWelcome(raw);
        return;
      case "snapshot-chunk":
        this.onChunk(raw);
        return;
      case "snapshot":
        // The single-frame form is legal on the wire (and handy in tests); a
        // real host chunks because a real snapshot never fits one frame.
        if (this.isGuest) this.applyFullState({ snap: raw.snap, seq: this.seqValue });
        return;
      case "delta":
        if (this.isGuest) this.onDelta(raw);
        return;
      case "resync":
        if (this.isHost) this.publishFullState("guest resync");
        return;
      case "intent":
        if (this.isHost) this.hooks.intent?.(raw);
        return;
      case "reject":
        this.hooks.reject?.(raw.reason);
        return;
    }
  }

  private onWelcome(msg: WelcomeMsg): void {
    const err = validateWelcome(msg);
    if (err) {
      // A mixed-version room must REFUSE (§11): a peer that cannot speak this
      // protocol would silently diverge otherwise.
      this.halt(err.code === "version" ? VERSION_MISMATCH_MESSAGE : err.message);
      return;
    }
    // The room seated us; that is the truth, not the start screen's guess.
    const seat: Slot | null =
      msg.roster.find((e) => e.id === this.room.playerId)?.slot ?? null;
    if (seat !== null) this.roleValue = seat === 0 ? "host" : "guest";
    else if (msg.hostId === this.room.playerId) this.roleValue = "host";
    this.infoValue = {
      role: this.roleValue,
      seed: msg.seed,
      hostId: msg.hostId,
      selfId: this.room.playerId,
      roster: msg.roster.map((e) => ({ ...e })),
      roomCode: this.room.roomCode,
    };
    this.hooks.info?.(this.infoValue);
    if (!this.attached) return;                 // attach() runs the handshake
    if (this.isHost) {
      // A second seat exists — it needs the world, whether it asked yet or not.
      if (this.hasOpponent) this.publishFullState("guest seated");
    } else {
      this.requestResync("seated as guest");
    }
  }

  private onChunk(msg: SnapshotChunkMsg): void {
    if (!this.isGuest) return;                  // only the host asserts state
    const done = this.assembler.accept(msg);
    if (done) this.applyFullState(done);
  }

  private applyFullState(done: AssembledSnapshot): void {
    this.lastSeqValue = done.seq;
    // Mirror first: the hook is handed a world already expressed in the
    // guest's own seats, exactly like the deltas it will receive next.
    this.hooks.snapshot?.(mirrorSnapshot(done.snap), done.seq);
    // Then replay whatever was held while this transfer was in flight. A
    // buffered delta older than the snapshot is dropped by `flushQueue`'s seq
    // check — do NOT clear the queue here: a delta that landed AFTER the host
    // built this snapshot is newer than it, and dropping it would desync the
    // guest on the very next tick.
    this.flushQueue();
  }

  private onDelta(msg: DeltaMsg): void {
    // While full state is in flight, deltas describe a world we do not have
    // yet — hold them and replay after the snapshot (they are absolute
    // patches, so the order snapshot(seq) → seq+1 → seq+2 is exact).
    if (this.assembler.pending || this.lastSeqValue < 0) {
      this.bufferDelta(msg);
      return;
    }
    if (msg.seq !== this.lastSeqValue + 1) {
      // Out of step. Mark the world suspect (so everything after this queues
      // rather than landing on a map we know is wrong), keep this delta for the
      // replay, and ask for full state. The ask is throttled — the suspect flag
      // is what stops the storm, not the clock.
      this.lastSeqValue = -1;
      this.bufferDelta(msg);
      this.requestResync(`seq gap → ${msg.seq}`);
      return;
    }
    this.lastSeqValue = msg.seq;
    this.hooks.delta?.(mirrorDelta(msg));
  }

  private bufferDelta(msg: DeltaMsg): void {
    if (this.queue.length >= MAX_PENDING_DELTAS) {
      this.queue = [];
      this.requestResync("delta backlog");
      return;
    }
    this.queue.push(msg);
  }

  private flushQueue(): void {
    const queued = this.queue;
    this.queue = [];
    for (const msg of queued) {
      if (msg.seq <= this.lastSeqValue) continue;      // the snapshot superseded it
      if (msg.seq !== this.lastSeqValue + 1) {
        this.requestResync(`seq gap after snapshot (${msg.seq})`);
        return;
      }
      this.lastSeqValue = msg.seq;
      this.hooks.delta?.(mirrorDelta(msg));
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// The seat mirror
//
// Wire frame of reference: slot 0 = host = owner byte 1 / owner id 1 / name
// "you" (the host's own record), slot 1 = guest = 2 / 2 / "ai". Every browser
// renders itself as players[0], so a guest maps the wire onto its own seats on
// the way in. The HOST is the identity — it built the wire.
//
// Public ground is owner byte 3 (`PUBLIC_OWNER`) and is nobody's: it passes
// through untouched. `upgraded` is provenance, not ownership, and is not
// mirrored. Intents carry no seat information at all — the host applies them
// to the guest's seat because it knows who sent them.
// ══════════════════════════════════════════════════════════════════════════

/** Owner byte +2 ↔ +1. 0 = unowned and 3 = public ground pass through. */
export function mirrorOwnerByte(b: number): number {
  if (b === 1) return 2;
  if (b === 2) return 1;
  return b;
}

/** Owner id (player index + 1), same rule as the byte. */
export const mirrorOwnerId = mirrorOwnerByte;

/** Seat name: the host's seat is called "you", the guest's "ai". */
export function mirrorOwnerName(name: string): string {
  if (name === "you") return "ai";
  if (name === "ai") return "you";
  return name;
}

/**
 * Mirror a full wire snapshot into the guest's local seat frame. `rivalSabotage`
 * is deliberately left UNMIRRORED: sabotage always targets seat 1 (the host's
 * rival = the guest's own plant), so the guest applies it to its own board
 * as-is — swapping it would put the host's frost on the host's plant.
 */
export function mirrorSnapshot(snap: Snapshot): Snapshot {
  const owner = base64ToBytes(snap.owner);
  for (let i = 0; i < owner.length; i++) owner[i] = mirrorOwnerByte(owner[i]);
  return {
    ...snap,
    owner: bytesToBase64(owner),
    harvesters: snap.harvesters.map((h) => ({
      ...h,
      owner: mirrorOwnerName(h.owner),
      ownerId: mirrorOwnerId(h.ownerId),
    })),
    factories: snap.factories.map((f) => ({
      ...f,
      owner: mirrorOwnerName(f.owner),
      ownerId: mirrorOwnerId(f.ownerId),
    })),
    // Slot order IS the seat order: [host, guest] → [mine, theirs].
    players: [...snap.players].reverse().map((p) => ({ ...p, res: { ...p.res } })),
    // MP-AUDIT: parity wires — mirror where seat matters, pass through otherwise
    market: snap.market
      ? { offerSeq: snap.market.offerSeq, offers: snap.market.offers.map((o) => ({ ...o, from: o.from === 0 ? 1 : o.from === 1 ? 0 : o.from })) }
      : undefined,
    protests: snap.protests?.map((pr) => ({ ...pr, owner: mirrorOwnerName(pr.owner) })),
    trucks: snap.trucks?.map((t) => ({ ...t, ownerId: mirrorOwnerId(t.ownerId) })),
    cars: snap.cars?.map((c) => ({ ...c })),
    boards: snap.boards?.map((b) => ({ ...b, owner: mirrorOwnerName(b.owner) })),
    crossPrompt: snap.crossPrompt
      ? { ...snap.crossPrompt, boardOwner: mirrorOwnerName(snap.crossPrompt.boardOwner) }
      : snap.crossPrompt ?? null,
    winner: snap.winner ? { ...snap.winner, id: snap.winner.id ? mirrorOwnerName(snap.winner.id) : null } : snap.winner ?? null,
  };
}

/** Mirror a steady-state delta into the guest's local seat frame. */
export function mirrorDelta(msg: DeltaMsg): DeltaMsg {
  return {
    ...msg,
    tiles: msg.tiles?.map((c) => ({ ...c, owner: mirrorOwnerByte(c.owner) })),
    harvesters: msg.harvesters?.map((h) => ({
      ...h,
      owner: mirrorOwnerName(h.owner),
      ownerId: mirrorOwnerId(h.ownerId),
    })),
    factories: msg.factories?.map((f) => ({
      ...f,
      owner: mirrorOwnerName(f.owner),
      ownerId: mirrorOwnerId(f.ownerId),
    })),
    players: msg.players ? [...msg.players].reverse().map((p) => ({ ...p, res: { ...p.res } })) : undefined,
    market: msg.market
      ? { offerSeq: msg.market.offerSeq, offers: msg.market.offers.map((o) => ({ ...o, from: o.from === 0 ? 1 : o.from === 1 ? 0 : o.from })) }
      : undefined,
    protests: msg.protests?.map((pr) => ({ ...pr, owner: mirrorOwnerName(pr.owner) })),
    trucks: msg.trucks?.map((t) => ({ ...t, ownerId: mirrorOwnerId(t.ownerId) })),
    cars: msg.cars?.map((c) => ({ ...c })),
    boards: msg.boards?.map((b) => ({ ...b, owner: mirrorOwnerName(b.owner) })),
    crossPrompt: msg.crossPrompt
      ? { ...msg.crossPrompt, boardOwner: mirrorOwnerName((msg.crossPrompt as any).boardOwner) }
      : (msg.crossPrompt as any) ?? undefined,
    winner: (msg as any).winner ? { ...(msg as any).winner, id: (msg as any).winner.id ? mirrorOwnerName((msg as any).winner.id) : null } : (msg as any).winner,
  };
}

// Re-exported so game code (and tests) never reach for the transport module —
// and therefore never for the SDK — just to name a role or a state.
export type { ConnectionState };
export { applyTrackDelta };
export const SESSION_PROTOCOL_VERSION = PROTOCOL_VERSION;
export type { HexProtocol, IntentMsg, DeltaMsg, Snapshot };
