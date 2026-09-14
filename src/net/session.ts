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
//                          this whole file exists to prevent. A duplicate of a
//                          delta already applied is NOT drift and is ignored.
//   resync retry           #131: an ask the throttle swallowed, or an ask whose
//                          answer was lost, used to leave the guest suspect
//                          forever — frozen mid-match with a growing backlog and
//                          nothing left to try. A guest awaiting state now keeps
//                          a retry armed until the world lands (or the session
//                          halts/disposes, which cancels it).
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
  type MatchSettings,
  type PeerStatusMsg,
  type PlayerRatingMsg,
  type RankWire,
  type ResultClaimMsg,
  type ResultMsg,
  type Slot,
  type SnapshotChunkMsg,
  type WelcomeMsg,
} from "./protocol";
import {
  defaultMatchSettings,
  matchSettingsEqual,
  readMatchSettings,
} from "./match-settings";
import { applyTrackDelta, buildPublish, type PublishFields } from "./delta";
import {
  rankBoardFrom,
  type RankBoard,
  type RankState,
} from "./rating";
import { bytesToBase64, base64ToBytes, type Snapshot } from "../iso/snapshot";
import type { DirtyTiles, Track } from "../iso/track";
// Type-only: `transport.ts` loads the RUN SDK singleton, and this module must
// stay importable from Node (the unit suite) and from the game bundle without
// dragging the SDK in.
import type { ConnectionState, HexRoom } from "./transport";

/** What a client is. `solo` never constructs a session at all. */
export type NetRole = "solo" | "host" | "guest";

/**
 * How long a full-state transfer may be reused before a new one is minted.
 * Exported because the recovery tests (#131) assert the ask stays inside this
 * rate limit rather than hard-coding a magic number of their own.
 */
export const RESYNC_MIN_INTERVAL_MS = 400;

/**
 * #131: how long a guest that is STILL awaiting full state waits before asking
 * again. A throttled ask used to be a dropped ask — the world was marked
 * suspect, every later delta queued behind a snapshot nobody was coming to
 * deliver, and the guest sat frozen with a full backlog and no way out except
 * a page reload. The retry is what makes recovery automatic; the backoff
 * (`RESYNC_RETRY_MAX_MS`) keeps a guest whose host has gone quiet from
 * hammering the relay.
 */
export const RESYNC_RETRY_MS = 500;

/** #131: the retry backoff's ceiling — one ask every 4 s at worst. */
export const RESYNC_RETRY_MAX_MS = 4_000;

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
  /**
   * RANK-01 (#147): the room's rating board at greeting time — every member
   * that had published a rating when this client was welcomed. Kept on the
   * info rather than in a side channel because the match's rated result is
   * computed from exactly this board.
   */
  ratings: RankWire[];
  /**
   * #186: the rules this room plays by — the ★ line, the opening purse and the
   * AI seats. Carried on the info (rather than read off a side channel)
   * because it is wire state that must survive the lobby → match handover:
   * `startIsoGame` reads the room's ★ line and purse from exactly this.
   *
   * Defaults until the room says otherwise, never absent — a reader that had
   * to ask "did the settings arrive yet" would race the welcome.
   */
  settings: MatchSettings;
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
  /**
   * RANK-01: the room's rating board changed (someone published a rating).
   * Fires on every `ratingUpdate`; the welcome's board arrives through
   * `info` instead, so a client that only ever reads this hook still sees the
   * full history rather than only the tail of it.
   */
  ratings?: (board: RankBoard, raw: RankWire[]) => void;
  /**
   * RANK-01: the room filed a result for this match — the star line was
   * crossed, or a seat emptied. This arrives for BOTH seats and is the only
   * thing the rating arithmetic is ever fed.
   */
  result?: (msg: ResultMsg) => void;
  /**
   * #186: the room's rules changed — the host moved a dial and the echo came
   * back, or a welcome carried rules this client had not seen. Fires for BOTH
   * seats: the host reads it as confirmation of what the room accepted, the
   * guest as the read-only view of what it is about to play.
   */
  settings?: (settings: MatchSettings) => void;
  /** Connection state changed. */
  status?: (state: ConnectionState) => void;
  /**
   * #121: the other seat emptied. `username` is the name the welcome carried,
   * or null when the departure outran it. Distinct from `reject` on purpose:
   * a host-left is a fatal error the guest cannot play through, whereas the
   * opponent leaving ends a match that was still running — the player still
   * has a board on screen and a door to walk out of.
   *
   * #164: NOT final any more. The seat can be re-taken — the same player
   * rejoining by room code inside the room's forfeit window — and the fresh
   * `welcome` that re-seats them resumes this session (`opponentReconnected`
   * fires and state flow restarts). The hook still means what it says: right
   * now, the opponent is out of the room.
   */
  opponentLeft?: (username: string | null) => void;
  /**
   * #164: the opponent's socket dropped, and the platform is HOLDING their
   * seat for `graceMs` (the room's `reconnectTimeout`). The match is not over
   * — this is the "Opponent disconnected — reconnecting…" notice, and the
   * countdown the survivor prints is `graceMs`.
   */
  opponentDisconnected?: (username: string | null, graceMs: number) => void;
  /**
   * #164: the opponent is back — either their socket re-attached inside the
   * hold window, or they rejoined by room code after it expired and a fresh
   * welcome re-seated them. Whatever dialog the departure raised comes down,
   * and state flow has already restarted by the time this fires.
   */
  opponentReconnected?: (username: string | null) => void;
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
  /**
   * #131: the guest's outstanding "I am still waiting for full state" retry —
   * null whenever nothing is armed. `resyncRetryAt` is the wall-clock deadline
   * it was armed for, so an earlier need can pull a later retry forward
   * instead of stacking a second timer. `resyncBackoff` doubles each unanswered
   * ask (capped) and resets the moment a transfer makes progress.
   */
  private resyncTimer: ReturnType<typeof setTimeout> | null = null;
  private resyncRetryAt = Infinity;
  private resyncWhy: string | null = null;
  private resyncBackoff = 0;
  /** When a snapshot frame last arrived — a transfer in motion is left alone. */
  private lastChunkAt = -Infinity;
  private noticeValue: string | null = null;
  private halted = false;
  private attached = false;
  /**
   * #164: the far seat's presence, in two degrees.
   *
   *   peerAway — their socket dropped and the platform is HOLDING the seat
   *              (the room's `peerStatus` said so). The match is paused in
   *              spirit, not in state: nothing is pruned, and a
   *              `reconnected` puts everything back without a resync of
   *              anything but the UI's countdown.
   *   peerGone — the seat EMPTYED (the gateway's roster event). The roster is
   *              pruned, state flow stops, and the game owes the player the
   *              "opponent left" choices. This used to be a `halt` — final,
   *              unresumable — which is exactly why a rejoin was impossible:
   *              the fresh welcome that re-seats the returner was dropped on
   *              the floor. It is now soft: a welcome with an opponent in it
   *              clears the flag and the match resumes.
   */
  private peerAway = false;
  private peerGone = false;
  /** The name the departed seat carried, so a return can be announced. */
  private departedName: string | null = null;
  /**
   * RANK-01: the room's rating board, in wire order. Held here (not in the UI)
   * because it is wire state that must survive the lobby → match handover: the
   * same session object is handed to `startIsoGame`.
   */
  private ratingsValue: RankWire[] = [];
  /**
   * #186: the room's rules, as the room last stated them. Defaults until a
   * welcome or a `settings` echo says otherwise — a seat that has not been
   * told plays the shipped game, which is exactly what "defaults unchanged"
   * means for a room nobody customised.
   */
  private settingsValue: MatchSettings = defaultMatchSettings();
  /** This session's join nonce — what authorises its rating publications. */
  private readonly token: string = makeJoinToken();
  /** #121: `dispose()` releases the room exactly once, however often it runs. */
  private disposed = false;

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
  /** RANK-01: the room's rating board, whole. */
  get ratings(): RankWire[] {
    return this.ratingsValue;
  }
  /** RANK-01: the same board keyed by player id, for the rating arithmetic. */
  get board(): RankBoard {
    return rankBoardFrom(this.ratingsValue);
  }
  /** #186: the room's rules, whole. Never null — defaults until told. */
  get settings(): MatchSettings {
    return this.settingsValue;
  }
  /** RANK-01: this session's join nonce (see `PlayerRatingMsg.joinToken`). */
  get joinToken(): string {
    return this.token;
  }
  /** RANK-01: the opponent's entry on the board, or null if unpublished. */
  opponentRating(): RankWire | null {
    const self = this.room.playerId;
    return this.ratingsValue.find((entry) => entry.id !== self) ?? null;
  }
  get roster(): RosterEntry[] {
    return this.infoValue?.roster ?? [];
  }
  /** True once the room has seated a second player. */
  get hasOpponent(): boolean {
    return this.roster.length >= 2;
  }
  /** #164: the opponent's socket is down but their seat is being held. */
  get opponentAway(): boolean {
    return this.peerAway;
  }
  /** #164: the opponent's seat emptied (they may still rejoin it). */
  get opponentGone(): boolean {
    return this.peerGone;
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
      // #121: the room's roster event is the ONLY signal that works in both
      // directions. The relay broadcasts a `reject` when the HOST goes, but a
      // GUEST's departure is silent on the wire — so the host kept simulating
      // a versus match against a seat that had already emptied. Riding the
      // SDK's own event needs no new message type, and so no protocol bump.
      onPlayerLeft: (playerId) => this.onPeerLeft(playerId),
      onDisconnect: () => this.hooks.status?.("disconnected"),
      onReconnecting: () => this.hooks.status?.("reconnecting"),
      onReconnected: () => {
        this.hooks.status?.("connected");
        // The socket replays nothing: whatever happened while it was down is
        // exactly what a resync is for. Invalidate FIRST, so the world is
        // `awaitingState` before the ask — a reconnect can strand a guest whose
        // seq still looks fine, and an ask the throttle swallows is only
        // retried while the guest is genuinely waiting (#131).
        if (this.isGuest) {
          this.lastSeqValue = -1;
          this.requestResync("reconnected");
        }
      },
      onError: () => this.hooks.status?.("disconnected"),
    });
    this.attached = true;
    // MP fix: the welcome may have already arrived in the lobby (StartScreen
    // calls receive before the game attaches). Replay it so the game's info
    // hook learns the roster / login names and can update the top bar.
    if (this.infoValue) this.hooks.info?.(this.infoValue);
    if (this.isGuest) this.requestResync("attach");
    else if (this.hasOpponent) this.publishFullState("host ready");
  }

  /** Stop exchanging state (a fatal error the player must act on). */
  halt(reason: string): void {
    if (this.halted) return;
    this.halted = true;
    this.queue = [];
    this.assembler.reset();
    // #131: a halted session asks for nothing — the retry would keep knocking
    // on a room the player has been told is over.
    this.clearResyncRetry();
    this.hooks.reject?.(reason);
  }

  /**
   * Leave the room and stop everything. Idempotent: `App.tsx` unmounts the
   * match through `startIsoGame`'s cleanup, and a navigation can run that
   * more than once for one match.
   *
   * #121: this is the one place a session's room is released. `leave()` closes
   * the socket, and the socket closing is what tells the room server the seat
   * emptied — which is what unlocks it for the next joiner and (host gone)
   * rejects the player still in the match. Before this, `dispose()` only
   * cleared local state, so a player who quit to the menu stayed an occupied
   * seat in a room they were no longer in until the page itself went away.
   *
   * Hooks are dropped BEFORE the socket closes on purpose: closing fires the
   * SDK's `onDisconnect`, and a status hook answered after the game is gone
   * would paint a toast over whatever the player navigated to.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.halted = true;
    this.queue = [];
    this.assembler.reset();
    // #131: no timer of this session may outlive it — a retry firing after the
    // game unmounted would send on a socket that has already been left.
    this.clearResyncRetry();
    this.hooks = {};
    // #164: say it is a DEPARTURE, not a drop. A bare socket close leaves the
    // seat held for the platform's whole reconnect window, and the opponent
    // spends it watching a countdown that can only expire. `abandon` makes the
    // room file the result at once (live match) and free the seat; with a
    // result already filed its guard turns the filing into a no-op and only
    // the early release remains.
    try { this.room.send({ type: "abandon" }); } catch { /* a socket already dead is not an error */ }
    try { this.room.leave(); } catch { /* same */ }
  }

  /**
   * #121: a seat emptied. Prune the roster (so `hasOpponent` tells the truth
   * and a later rejoin is re-seated by a fresh welcome), stop exchanging
   * state — a two-seat match is over the moment the other seat goes — and
   * tell the game, which owes the player a clear "opponent left" state.
   *
   * #164: this is a SOFT stop, not a `halt`. The player who went can still
   * come back — the room keeps their seat warm for `reconnectTimeout` and
   * re-greets a returner with a fresh welcome — and a halted session dropped
   * that welcome on the floor, which is exactly why a kicked player could
   * never rejoin. `peerGone` parks the state flow instead; `onWelcome`
   * resumes it when the roster fills again.
   */
  private onPeerLeft(playerId: string): void {
    if (this.halted || this.peerGone || playerId === this.room.playerId) return;
    const gone = this.infoValue?.roster.find((e) => e.id === playerId) ?? null;
    if (this.infoValue) {
      this.infoValue = {
        ...this.infoValue,
        roster: this.infoValue.roster.filter((e) => e.id !== playerId),
      };
    }
    this.peerGone = true;
    this.peerAway = false;
    if (gone?.username) this.departedName = gone.username;
    this.queue = [];
    this.assembler.reset();
    this.clearResyncRetry();                 // #131: nobody left to answer
    this.hooks.opponentLeft?.(gone?.username || null);
  }

  /**
   * #164: the room's presence poll spoke. `disconnected` starts the
   * countdown the survivor prints (the platform is holding the seat for
   * `graceMs`); `reconnected` ends it. Neither prunes anything — the roster
   * event is still the only signal that a seat actually emptied.
   */
  private onPeerStatus(msg: PeerStatusMsg): void {
    if (msg.playerId === this.room.playerId) return;
    const name =
      msg.username ||
      this.infoValue?.roster.find((e) => e.id === msg.playerId)?.username ||
      null;
    if (msg.status === "disconnected") {
      if (this.peerAway || this.peerGone) return;
      this.peerAway = true;
      const grace = typeof msg.graceMs === "number" && msg.graceMs > 0
        ? Math.round(msg.graceMs)
        : 60_000;
      this.hooks.opponentDisconnected?.(name, grace);
      return;
    }
    // "reconnected": the socket re-attached inside the hold window. The room
    // re-greets the returner with a welcome right behind this message, which
    // is what restarts the state flow — this hook is for the countdown UI.
    this.peerAway = false;
    this.hooks.opponentReconnected?.(name ?? this.departedName);
  }

  // ── guest → host ────────────────────────────────────────────────────────
  /**
   * Send a player action to the host. The guest never mutates: this is the
   * ONLY way its clicks reach the world (§4).
   */
  sendIntent(action: IntentMsg["action"], payload: unknown): boolean {
    if (!this.isGuest || this.halted || this.peerGone) return false;
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
   * only DELAY a re-ask, never skip the resync — and #131 is the fix that makes
   * that literal: a throttled ask now arms a retry for the rest of the window
   * instead of being dropped on the floor.
   *
   * Returns true when a `resync` frame actually went out.
   */
  requestResync(why: string): boolean {
    if (!this.isGuest || this.halted || this.disposed || this.peerGone) return false;
    const now = Date.now();
    const since = now - this.lastResyncAt;
    if (since < RESYNC_MIN_INTERVAL_MS) {
      // Inside the throttle: keep the ask, retry when the window opens. Without
      // this the guest is stuck — `onDelta` has already marked its world
      // suspect, so every later delta queues behind a snapshot nobody asked for.
      this.armResyncRetry(why, RESYNC_MIN_INTERVAL_MS - since);
      return false;
    }
    this.lastResyncAt = now;
    this.clearResyncRetry();
    void why;
    // The world is suspect from here: `lastSeq < 0` queues every delta until
    // the snapshot lands, so nothing half-true can be applied on top of an old
    // map.
    this.lastSeqValue = -1;
    this.room.send({ type: "resync" });
    // #131: the ask is out, but the answer can be lost exactly like the delta
    // that caused the gap. Stay armed until the world lands. (A relay that
    // delivers synchronously — the unit suite's room pair — has often answered
    // already, in which case there is nothing left to wait for.)
    if (this.awaitingState) this.armResyncRetry("resync unanswered", this.nextRetryDelay());
    return true;
  }

  /**
   * #131: true while a guest has a resync retry armed — i.e. it is waiting for
   * full state and WILL ask again on its own. Tests read this to prove recovery
   * is the session's work and not theirs.
   */
  get resyncPending(): boolean {
    return this.resyncTimer !== null;
  }

  /**
   * Take the next unanswered-ask delay and step the backoff: `RESYNC_RETRY_MS`
   * doubling to `RESYNC_RETRY_MAX_MS`. Only an ask that went out and was not
   * answered consumes a step — `onChunk` / `applyFullState` reset it, so a
   * guest that recovers starts the next wait at the short end again.
   */
  private nextRetryDelay(): number {
    const delay = RESYNC_RETRY_MS * 2 ** this.resyncBackoff;
    this.resyncBackoff = Math.min(this.resyncBackoff + 1, 16);
    return Math.min(delay, RESYNC_RETRY_MAX_MS);
  }

  /**
   * #131: arm (or pull forward) the one retry a waiting guest keeps. Never
   * stacks timers, never fires on a session that has stopped, and `unref`s in
   * Node so a retry cannot hold the process — or a vitest worker — open.
   */
  private armResyncRetry(why: string, delayMs: number): void {
    if (!this.isGuest || this.halted || this.disposed) return;
    const at = Date.now() + Math.max(0, delayMs);
    // An earlier deadline already armed wins; a later one is not worth a reset.
    if (this.resyncTimer !== null && at >= this.resyncRetryAt) return;
    this.clearResyncRetry();
    this.resyncWhy = why;
    this.resyncRetryAt = at;
    this.resyncTimer = setTimeout(() => this.onResyncRetry(), Math.max(0, at - Date.now()));
    (this.resyncTimer as unknown as { unref?: () => void }).unref?.();
  }

  /** Cancel the retry — the world landed, or this session is over. */
  private clearResyncRetry(): void {
    if (this.resyncTimer !== null) clearTimeout(this.resyncTimer);
    this.resyncTimer = null;
    this.resyncRetryAt = Infinity;
  }

  /**
   * #131: the retry firing. Re-ask if — and only if — the guest is still
   * waiting. A transfer that is actively delivering frames is left to finish:
   * re-asking mints a new transfer id, which abandons the half-received one and
   * starts its ~15-frame walk over, so a slow link would never converge.
   */
  private onResyncRetry(): void {
    this.resyncTimer = null;
    this.resyncRetryAt = Infinity;
    if (!this.isGuest || this.halted || this.disposed) return;
    if (!this.awaitingState) return;                       // healed: nothing to do
    if (this.assembler.pending && Date.now() - this.lastChunkAt < RESYNC_RETRY_MS) {
      this.armResyncRetry(this.resyncWhy ?? "awaiting state", RESYNC_RETRY_MS);
      return;
    }
    this.requestResync(`retry (${this.resyncWhy ?? "awaiting state"})`);
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
    if (!this.isHost || this.halted || this.peerGone) return "idle";
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
    if (!this.isHost || this.halted || this.peerGone) return false;
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

  // ── RANK-01: the rating board ───────────────────────────────────────────

  /**
   * Publish this player's rating to the room. Safe to call more than once per
   * session (a re-attach, a rating that moved): the room accepts a re-publish
   * that carries this session's join token, and drops one that does not.
   *
   * Called by the start screen as soon as the rank file is loaded, and again
   * by the game once a match has been filed — the second publish is what lets
   * the NEXT match in the same room rate correctly.
   */
  publishRating(state: RankState): boolean {
    if (this.halted || this.disposed) return false;
    const msg: PlayerRatingMsg = {
      type: "playerRating",
      id: this.room.playerId,
      rating: state.rating,
      matches: state.matches,
      joinToken: this.token,
    };
    this.room.send(msg);
    // Adopt our own entry locally too: the room's `ratingUpdate` echo will
    // overwrite this with the same numbers, but the lobby must be able to
    // print a rating before the round trip completes.
    this.onRatings([...this.ratingsValue.filter((e) => e.id !== msg.id), msg]);
    return true;
  }

  /**
   * HOST only: file the finished match with the room. The relay validates the
   * ids and relays the verdict to both seats — see `ResultMsg`.
   */
  claimResult(winnerId: string, loserId: string, durationSec: number): boolean {
    if (!this.isHost || this.halted || this.disposed) return false;
    const msg: ResultClaimMsg = { type: "resultClaim", winnerId, loserId, reason: "win", durationSec };
    this.room.send(msg);
    return true;
  }

  /**
   * #186 — HOST only: file the rules this room plays by.
   *
   * The room is the only party every seat hears from, so a dial moved in the
   * host's lobby goes there and comes back as a `settings` echo — to the host
   * too, which is what makes the lobby's printed rules the room's rules rather
   * than the host's opinion of them. Nothing is applied optimistically: a
   * claim the relay refuses (a malformed block) simply never returns, and the
   * lobby keeps showing what the room actually holds.
   *
   * Returns false when this seat may not speak for the room, or when the block
   * would not survive the relay's own read — the lobby uses that to leave the
   * dial where it was instead of pretending.
   */
  publishSettings(settings: MatchSettings): boolean {
    if (!this.isHost || this.halted || this.disposed) return false;
    const clean = readMatchSettings(settings);
    if (!clean) return false;
    if (matchSettingsEqual(clean, this.settingsValue)) return false;   // nothing to file
    this.room.send({ type: "settingsClaim", settings: clean });
    return true;
  }

  /** Fold the room's rules into local state and tell the lobby. */
  private onSettings(raw: unknown): void {
    const next = readMatchSettings(raw);
    if (!next) return;                       // unreadable: keep what the room said last
    const changed = !matchSettingsEqual(next, this.settingsValue);
    this.settingsValue = next;
    if (this.infoValue) this.infoValue = { ...this.infoValue, settings: next };
    if (changed) this.hooks.settings?.(next);
  }

  /** Fold a board update into local state and tell the game. */
  private onRatings(raw: unknown): void {
    if (!Array.isArray(raw)) return;
    this.ratingsValue = (raw as RankWire[])
      .filter((e) => e && typeof e === "object" && typeof e.id === "string")
      .map((e) => ({ ...e }));
    this.hooks.ratings?.(this.board, this.ratingsValue);
  }

  // ── inbound ─────────────────────────────────────────────────────────────
  /** Feed one message. Public so tests can drive a session without a room. */
  receive(raw: unknown): void {
    if (!isHexProtocol(raw)) return;
    // RANK-01: a result is the ONE message that must survive a halt. The
    // forfeit case is filed by the room AFTER the seat it belongs to emptied —
    // which is the very event that halts this session (`onPeerLeft`) — so
    // gating results behind `halted` would drop the rating of every abandoned
    // match on exactly the seat that needs it.
    if (raw.type === "result") {
      // The result carries the board it was computed from, so a seat that
      // never saw the opponent's `ratingUpdate` still rates the match exactly
      // as the other seat did.
      this.onRatings(raw.ratings);
      if (!this.disposed) this.hooks.result?.(raw);
      return;
    }
    if (this.halted) return;
    // #164: a session parked by an emptied seat keeps listening for exactly
    // the messages that can bring the opponent back (a re-seating `welcome`,
    // a presence line) or settle the match (a `result`, handled above, and
    // `reject`/`ratingUpdate`). Everything that moves the world is dropped:
    // applying deltas from — or intents into — a seat nobody is in is the
    // desync this file exists to prevent.
    if (
      this.peerGone &&
      raw.type !== "welcome" &&
      raw.type !== "peerStatus" &&
      raw.type !== "ratingUpdate" &&
      raw.type !== "reject"
    ) {
      return;
    }
    switch (raw.type) {
      case "welcome":
        this.onWelcome(raw);
        return;
      case "peerStatus":
        this.onPeerStatus(raw);
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
      case "ratingUpdate":
        this.onRatings(raw.ratings);
        return;
      case "settings":
        this.onSettings(raw.settings);
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
    // #164: a welcome that re-seats an opponent RESUMES a parked session —
    // this is the rejoin path (the kicked player came back by room code
    // inside the forfeit window, and the room re-greeted everyone). Clear the
    // park BEFORE the flow below runs: it is what re-publishes full state to
    // the returner (host) or re-requests it (guest).
    const wasGone = this.peerGone;
    if (wasGone && msg.roster.some((e) => e.id !== this.room.playerId)) {
      this.peerGone = false;
    }
    // The room seated us; that is the truth, not the start screen's guess.
    const seat: Slot | null =
      msg.roster.find((e) => e.id === this.room.playerId)?.slot ?? null;
    if (seat !== null) this.roleValue = seat === 0 ? "host" : "guest";
    else if (msg.hostId === this.room.playerId) this.roleValue = "host";
    // #186: the rules the room holds, folded in BEFORE the info is built so a
    // lobby reading `info.settings` on its very first hello sees them. A
    // welcome that carries none leaves whatever the room said last alone — a
    // second welcome (a seat joining) is not a reset of the rules.
    if (msg.settings !== undefined) this.onSettings(msg.settings);
    this.infoValue = {
      role: this.roleValue,
      seed: msg.seed,
      hostId: msg.hostId,
      selfId: this.room.playerId,
      roster: msg.roster.map((e) => ({ ...e })),
      roomCode: this.room.roomCode,
      ratings: msg.ratings ? msg.ratings.map((e) => ({ ...e })) : [],
      settings: this.settingsValue,
    };
    // RANK-01: the greeting's board replaces whatever we held — it is the
    // room's whole truth, not a delta on top of a stale guess. A welcome with
    // no board at all (a room where nobody has published yet) leaves the empty
    // board alone rather than clearing a board learned from an earlier hello.
    if (msg.ratings) this.onRatings(msg.ratings);
    this.hooks.info?.(this.infoValue);
    if (wasGone && !this.peerGone) {
      const back = msg.roster.find((e) => e.id !== this.room.playerId);
      this.hooks.opponentReconnected?.(back?.username || this.departedName);
    }
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
    // #131: a frame in hand is progress — it is what tells the retry that this
    // transfer is alive and must not be restarted out from under itself.
    this.lastChunkAt = Date.now();
    this.resyncBackoff = 0;
    const done = this.assembler.accept(msg);
    if (done) this.applyFullState(done);
  }

  private applyFullState(done: AssembledSnapshot): void {
    this.lastSeqValue = done.seq;
    // #131: the world landed, so the wait is over. `flushQueue` below may find
    // a fresh gap in what was held, and re-arm through `requestResync`.
    this.clearResyncRetry();
    this.resyncBackoff = 0;
    this.resyncWhy = null;
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
    // #131: a frame this world already contains — the relay repeating itself,
    // a reconnect replay, a stale frame overtaking a snapshot — is NOT
    // divergence. Treating it as a gap threw away a perfectly good world and
    // froze the guest behind a full resync it did not need. (`flushQueue` drops
    // the same frames from the backlog; this is the steady-state half.)
    if (msg.seq <= this.lastSeqValue) return;
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
 * RAIL-04 (#178): mirror the railway into the guest's seat frame — the layer's
 * owner bytes, every structure, line and train owner, and the sparse patch's
 * owner bytes. Without this a guest's own platforms would read as the host's
 * and its panel would offer the rival's lines.
 */
function mirrorRail(w: Snapshot["rail"]): Snapshot["rail"] | undefined {
  if (!w) return undefined;
  const out: NonNullable<Snapshot["rail"]> = {
    ...w,
    structures: w.structures.map((s) => ({
      ...s,
      owner: mirrorOwnerName(s.owner),
      ownerId: mirrorOwnerId(s.ownerId),
    })),
    lines: w.lines.map((l) => ({ ...l, ownerId: mirrorOwnerId(l.ownerId) })),
    trains: w.trains.map((t) => ({ ...t, ownerId: mirrorOwnerId(t.ownerId) })),
  };
  if (w.owner !== undefined) {
    const owner = base64ToBytes(w.owner);
    for (let i = 0; i < owner.length; i++) owner[i] = mirrorOwnerByte(owner[i]);
    out.owner = bytesToBase64(owner);
  }
  if (w.tiles !== undefined) {
    out.tiles = w.tiles.map((t) => ({ ...t, owner: mirrorOwnerByte(t.owner) }));
  }
  return out;
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
    rail: mirrorRail(snap.rail),
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
    ...(msg.rail ? { rail: mirrorRail(msg.rail) } : {}),
    boards: msg.boards?.map((b) => ({ ...b, owner: mirrorOwnerName(b.owner) })),
    // #112: an EXPLICIT null means "the host cleared the prompt" and must
    // reach the guest — `?? undefined` used to swallow it, so a chooser the
    // host had resolved stayed on screen over a cascade that had moved on.
    crossPrompt: msg.crossPrompt === undefined
      ? undefined
      : msg.crossPrompt
        ? { ...msg.crossPrompt, boardOwner: mirrorOwnerName((msg.crossPrompt as any).boardOwner) }
        : null,
    winner: (msg as any).winner ? { ...(msg as any).winner, id: (msg as any).winner.id ? mirrorOwnerName((msg as any).winner.id) : null } : (msg as any).winner,
  };
}

// Re-exported so game code (and tests) never reach for the transport module —
// and therefore never for the SDK — just to name a role or a state.
export type { ConnectionState };
export { applyTrackDelta };
export const SESSION_PROTOCOL_VERSION = PROTOCOL_VERSION;
export type { HexProtocol, IntentMsg, DeltaMsg, Snapshot, MatchSettings };

/**
 * A session nonce for the rating board (RANK-01). Not a secret and not a
 * signature — it is the room's way of telling "the same client publishing
 * again" (a reconnect, a re-attach) apart from "somebody else publishing for
 * this seat". `crypto.randomUUID` when the page has one, which is every RUN
 * host and every browser this game ships to; the fallback keeps Node/CI runs
 * (and an older webview) working.
 */
function makeJoinToken(): string {
  try {
    const c = globalThis.crypto as Crypto | undefined;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
  } catch { /* no web crypto: fall through */ }
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
