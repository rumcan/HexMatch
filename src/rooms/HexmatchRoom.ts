// ══════════════════════════════════════════════════════════════════════════
// MP-03 — Hexmatch room: a thin validating relay (RUN.world GameRoom).
//
// Host authority, thin relay (§2): the host browser runs the full sim and the
// guest renders only. This room owns exactly three things — the map seed, the
// host identity, and message routing. It NEVER simulates.
//
//   guest intent/resync  →  forward to the host ONLY (sendTo hostId)
//   host snapshot/delta  →  broadcast to all guests
//   chat (either seat)   →  relay to the OTHER seat, stamped with the sender's
//                           own name and time and held to a per-sender rate
//                           window (C1 / #255 — chat is not a game action, so
//                           it never goes through the host's economy path)
//   guest-forged state   →  DROPPED. `sender.id !== hostId` is the one piece
//                           of real authority the relay keeps — do not drop it.
//
// Registered in `rundot/realtime.config.json` (`maxPlayers: 2`,
// `reconnectTimeout: 60`). The seed is minted in `onCreate`, exactly as the
// old `server/server.js` relay did at room creation — every client
// regenerates identical geometry via `generateMap(seed)`.
//
// MP-05 added `snapshot-chunk` to the relayed set: it is the same host
// assertion as `snapshot`, cut into ≤16 KiB frames because one full state is
// ~110 KiB (§1.3). The relay deliberately does not reassemble — that is the
// guest's job in `src/net/session.ts`, and keeping it there leaves this room a
// router, not a game server.
//
// NOTE (ticket sketch correction): the §6 sketch reads `msg.playerId`, but
// SDK 5.27's `GameMessage` is `{ sender, payload }` — the sender is
// `msg.sender.id`. This file follows the SDK, not the sketch.
//
// ── RANK-01 (#147): what a rating needs from the ROOM ─────────────────────
//
// The rating itself is computed by both clients from one shared board
// (`src/net/rating.ts`), so the room's job is only to be that board and to
// hold the two things no client can be trusted with:
//
//   1. WHO MAY SPEAK. A rating is published by its owner (`playerRating`) and
//      the relay drops any message whose `id` is not the sender's — a client
//      can be wrong about itself, but it can never write somebody else's
//      number. A departure is filed by the ROOM, not by the player it happens
//      to leave behind.
//   2. WHEN A MATCH IS OVER. The room files exactly one `result` per room,
//      and the room is the only party that saw both seats at that moment. The
//      star line is the host's call (`resultClaim`); an EMPTY SEAT is the
//      room's own (see `onPlayerLeave`).
//
// It still never simulates, never reads a scoreboard, and never invents a
// number: every rating on its board was sent by the player it describes.
//
// ── #164: presence, the reconnect window, and the rejoin ──────────────────
//
// A dropped socket used to be invisible until the platform evicted the seat a
// minute later: the survivor watched a frozen board behind a blank overlay,
// and the returner had no way back in. The room is the only party that can
// see BOTH sides of that, so it now watches the harness's own `connected`
// flags once a second (`pollPresence`) and speaks the transitions as
// `peerStatus` — "disconnected, seat held for graceMs" and "reconnected" —
// re-greeting a returner with a fresh welcome so a reloaded page can rejoin
// the SAME match by room code (the rejoin path `getUserRooms` lists). The
// forfeit rules are unchanged: an eviction inside a live match still arms
// `FORFEIT_GRACE_MS` and still files the leaver's loss, and a survivor's
// `resultClaim` may now name an opponent the room has already evicted — the
// "finish the game" the opponent-left dialog promises.
// ══════════════════════════════════════════════════════════════════════════
import { GameRoom, type GameMessage, type LeaveReason, type Player } from "@series-inc/rundot-game-sdk/mp-server";
import { HOST_LEFT_REASON, PROTOCOL_VERSION, readMatchSettings, readRankWire, type ChatMsg, type HexProtocol, type MatchSettings, type PlayerRatingMsg, type RankWire, type ResultClaimMsg, type ResultMsg, type SettingsClaimMsg, type Slot } from "../net/protocol";
// C1 (#255): the chat rules — the same pure module the CLIENT uses, so the two
// ends cannot drift about what a line is allowed to be. `chat.ts` imports no
// SDK and no game code, which is what lets the room bundle carry it.
import { CHAT_RATE_MAX, CHAT_RATE_WINDOW_MS, ChatLimiter, readChatMsg } from "../net/chat";

/** Sent when the host is gone — no host, no truth, say so plainly. The
 *  string lives in the protocol so the client can recognise it without
 *  importing the server module (#164); re-exported for existing callers. */
export { HOST_LEFT_REASON };

/**
 * RANK-01: how long the room waits before a DISCONNECT becomes a forfeit.
 *
 * A dropped socket is not the same as walking out — `reconnectTimeout` is 60 s
 * and a player who reconnects inside it is still in the match. So a disconnect
 * arms this timer instead of filing immediately, and `onPlayerJoin` cancels it
 * when they come back. A deliberate `leave` gets no such grace: the SDK only
 * reports `leave` after the client asked to go, and a rated match must not be
 * escapable by pressing the button faster.
 */
export const FORFEIT_GRACE_MS = 30_000;

/**
 * #164: how often the room looks at its members' `connected` flags.
 *
 * The platform flips `player.connected` to false the moment a socket drops and
 * holds the seat for `reconnectTimeout`, but it TELLS the room nothing — the
 * system messages that carry the transition are consumed inside the SDK's
 * `GameRoom` and never reach `onGameMessage`. Without a poll the seat still in
 * the match would watch a frozen world for a whole minute with no idea why
 * (the blank-overlay strand in #164). One look a second is cheap (two members,
 * one boolean each) and bounds how long the silence lasts.
 */
export const PRESENCE_POLL_MS = 1_000;

/** The clock handle the presence poll runs under (named, so it is clearable). */
export const PRESENCE_TIMER = "presence-poll";

/** The reconnect window the platform holds a dropped seat for, in ms. */
export const DEFAULT_RECONNECT_GRACE_MS = 60_000;

export default class HexmatchRoom extends GameRoom<HexProtocol> {
  private seed = 0;
  private hostId: string | null = null;
  private readonly slots = new Map<string, Slot>();
  /** RANK-01: the room's rating board, keyed by player id (with the join token). */
  private readonly ratings = new Map<string, RankWire & { joinToken: string }>();
  /**
   * #186: the rules this room plays by, as the HOST last filed them. Null until
   * a claim arrives — which reads as the shipped defaults, never as "unknown".
   *
   * The room keeps them (rather than letting the two seats agree peer-to-peer)
   * because it is the only party every joiner hears from: a guest learns the
   * rules on its welcome, a rejoined seat learns them again, and a host that
   * changes them mid-lobby is heard by everybody through the echo.
   */
  private settings: MatchSettings | null = null;
  /** #186: true when the filed rules put an AI in the opponent seat — see
   *  `lockAiSeat`. */
  private aiSeatFiled = false;
  /** A room files at most ONE result, however the match ended. */
  private resultFiled = false;
  /** True once the host has published state — i.e. a match is actually running. */
  private matchLive = false;
  /** Armed forfeits for disconnected players, by timer name. */
  private readonly forfeitTimers = new Map<string, string>();
  /**
   * #164: every id that has ever held a seat. A survivor's `resultClaim` may
   * name an opponent the room has already EVICTED (the star line can be
   * crossed after the "opponent left" dialog offered "finish the game") — the
   * membership check alone would drop exactly the claim the dialog promises.
   * Membership is still required for the WINNER: a seat that never existed can
   * never win, and a seat that emptied can no longer claim anything.
   */
  private readonly everJoined = new Set<string>();
  /** #164: the last `connected` value the presence poll saw, per member. */
  private readonly presence = new Map<string, boolean>();
  /**
   * C1 (#255): one chat rate window per sender, in the room's own clock.
   *
   * The client enforces the same budget before it sends anything, but a client
   * is exactly the thing that cannot be trusted to police itself — a modified
   * (or simply older) build could send a frame per frame. The relay's window is
   * the one that actually holds: over budget is dropped in silence, like a
   * guest-forged snapshot, because there is nothing a flooding client could
   * usefully be told.
   */
  private readonly chatLimits = new Map<string, ChatLimiter>();

  onCreate() {
    // The seed is minted here, exactly as server.js did at room creation.
    // Every client regenerates identical geometry via generateMap(seed).
    this.seed = (Math.random() * 0x7fffffff) | 0;
    this.log.info("Hexmatch room created", { seed: this.seed });
  }

  onPlayerJoin(player: Player) {
    // First joiner becomes host; a newcomer to a hostless room (MP-08 rehost)
    // takes over. Capacity is enforced by `maxPlayers: 2` + the lock below.
    const hostId = this.hostId ?? player.id;
    this.hostId = hostId;
    if (!this.slots.has(player.id)) {
      // Slot 0 = host, slot 1 = guest. Kept across rejoins (same id rejoins
      // into its old slot), and a new host takes slot 0 even when a stranded
      // guest still holds slot 1 — the ticket's `slots.size === 0 ? 0 : 1`
      // would mis-slot that case.
      this.slots.set(player.id, player.id === hostId ? 0 : 1);
    }
    this.everJoined.add(player.id);
    if (this.playerCount >= 2) this.lock();
    // RANK-01: a reconnecting player is not a leaver. Cancelling the armed
    // forfeit here is the whole point of the grace window above.
    const armed = this.forfeitTimers.get(player.id);
    if (armed) {
      this.clock.clear(armed);
      this.forfeitTimers.delete(player.id);
      this.log.info("Forfeit cancelled — player reconnected", { playerId: player.id });
    }
    // #164: seed the presence poll with the joiner's live state, and start the
    // poll the first time the room has anyone to watch.
    this.presence.set(player.id, player.connected !== false);
    if (!this.clock.has(PRESENCE_TIMER)) {
      this.clock.setInterval(PRESENCE_TIMER, () => this.pollPresence(), PRESENCE_POLL_MS);
    }
    this.log.info("Player joined", { playerId: player.id, hostId });
    // A broadcast inside onPlayerJoin only reaches ALREADY-connected members:
    // the newcomer's socket registers after the hook runs, so the first
    // joiner would get no welcome at all. The newcomer therefore gets the
    // welcome via sendTo (buffered by the gateway, flushed after `room:joined`
    // — the documented initial-state pattern), while existing members learn
    // the new roster from the broadcast. Nobody gets it twice: broadcast
    // skips the unregistered newcomer, sendTo targets only them.
    // Consequence for the client (MP-05/MP-06): a welcome may arrive as a
    // broadcast AND as a targeted message — listen on both channels.
    const greeting = this.welcome(hostId);
    this.broadcast(greeting);
    this.sendTo(player.id, greeting);
  }

  onGameMessage(msg: GameMessage<HexProtocol>) {
    const p = msg.payload;
    if (p.type === "intent" || p.type === "resync") {
      // Guest → host only. (The host never sends intents — it applies its own
      // actions locally — so there is no self-echo to worry about.)
      if (this.hostId !== null) this.sendTo(this.hostId, p);
      return;
    }
    if (p.type === "playerRating") {
      this.onRating(msg.sender, p);
      return;
    }
    if (p.type === "resultClaim") {
      this.onResultClaim(msg.sender, p);
      return;
    }
    if (p.type === "settingsClaim") {
      this.onSettingsClaim(msg.sender, p);
      return;
    }
    if (p.type === "chat") {
      this.onChat(msg.sender, p);
      return;
    }
    if (p.type === "abandon") {
      // #164: "I am not coming back." A socket close looks exactly like a
      // drop to the platform — the seat is HELD for the whole reconnect
      // window — so a player who quits through a door (the in-game "Leave
      // room", the rejoin prompt's "Abandon") would otherwise leave the
      // survivor counting down a seat that will never refill. The kick is
      // the whole handling: `onPlayerLeave` receives it as a deliberate
      // departure (reason "kick") and files the leaver's loss at once for a
      // live match, and the harness's own `room:playerLeft` broadcast opens
      // the survivor's dialog in the same instant. Nothing is filed HERE —
      // one place files for every leave reason, and its `resultFiled` guard
      // is what keeps the racing socket close from filing twice.
      if (this.players.has(msg.sender.id)) {
        this.log.info("Player abandoning match — kicking seat", { playerId: msg.sender.id });
        this.kick(msg.sender.id, "You left the match.");
      }
      return;
    }
    if (p.type === "snapshot" || p.type === "snapshot-chunk" || p.type === "delta") {
      // THE authority check: only the host may assert state. A guest-forged
      // snapshot, chunk or delta is dropped silently — no broadcast, no error
      // that a bad client could probe. Do not drop this check.
      //
      // `snapshot-chunk` is the same assertion, cut into frames (MP-05): a full
      // state is ~110 KiB against a 16 KiB frame, so the host sends N of them
      // and the guest reassembles. The relay does not care which frame it is
      // forwarding — only that the sender is the host.
      if (msg.sender.id !== this.hostId) return;
      // RANK-01: the first state publish is what makes the match "live" — a
      // player who leaves a LOBBY has not lost a rated match, and the room has
      // no other way to tell the two apart. Once a result is filed the room is
      // done rating, so a trailing publish (the winner's final delta) must not
      // re-open it.
      if (!this.resultFiled) this.matchLive = true;
      this.lockAiSeat();
      this.broadcast(p);
      return;
    }
    // `welcome` / `reject` are server-originated — a client sending them is
    // ignored. Unknown future types land here too: fail closed, never relay
    // what the relay does not understand.
  }

  /**
   * #164: one look a second at the platform's own presence flags.
   *
   * The harness flips `player.connected` when a socket drops (and holds the
   * seat for `reconnectTimeout`) and flips it back on a re-attach — but it
   * never calls a room hook for either transition, and the client SDK drops
   * the gateway's `room:playerDisconnected` / `room:playerReconnected` frames
   * on the floor. Polling is the only place the room can see it, and the room
   * is the only party that can tell BOTH seats:
   *
   *   connected → disconnected   broadcast `peerStatus` with the hold window,
   *                              so the survivor shows "Opponent disconnected
   *                              — reconnecting 0:59" instead of a dark,
   *                              silent board.
   *   disconnected → connected   the seat came back inside the window. Cancel
   *                              any armed forfeit, broadcast `peerStatus`,
   *                              and RE-GREET the returner with a welcome:
   *                              a re-attach never runs `onPlayerJoin`, and a
   *                              returner whose PAGE reloaded is a brand-new
   *                              client that has never seen the seed. The
   *                              broadcast copy re-seats the survivor's
   *                              session (its soft peer-gone state resumes on
   *                              a welcome), and the host answers the fresh
   *                              guest's resync with full state — the match
   *                              resumes where it stood.
   */
  private pollPresence(): void {
    for (const player of this.players.values()) {
      const connected = player.connected !== false;
      const before = this.presence.get(player.id);
      if (before === undefined || before === connected) {
        this.presence.set(player.id, connected);
        continue;
      }
      this.presence.set(player.id, connected);
      if (!connected) {
        this.log.info("Peer disconnected — seat held", { playerId: player.id });
        this.broadcast({
          type: "peerStatus",
          playerId: player.id,
          status: "disconnected",
          graceMs: this.reconnectGraceMs(),
          username: player.username,
        });
        continue;
      }
      this.log.info("Peer reconnected inside the window", { playerId: player.id });
      const armed = this.forfeitTimers.get(player.id);
      if (armed) {
        this.clock.clear(armed);
        this.forfeitTimers.delete(player.id);
      }
      this.broadcast({
        type: "peerStatus",
        playerId: player.id,
        status: "reconnected",
        username: player.username,
      });
      // The re-greeting: targeted (the returner may be a fresh client that
      // missed everything) and broadcast (the survivor resumes on a welcome).
      const greeting = this.welcome(this.hostId ?? player.id);
      this.broadcast(greeting);
      this.sendTo(player.id, greeting);
    }
    // Tidy: drop presence for seats that are gone, and stop watching an empty
    // room — the next join restarts the poll.
    for (const id of this.presence.keys()) {
      if (!this.players.has(id)) this.presence.delete(id);
    }
    if (this.playerCount === 0 && this.clock.has(PRESENCE_TIMER)) {
      this.clock.clear(PRESENCE_TIMER);
    }
  }

  /**
   * The reconnect window the platform is holding, in ms — the countdown the
   * survivor's UI prints. Read from the room's own config so the number on
   * screen is the number the server is actually running.
   */
  private reconnectGraceMs(): number {
    const secs = this.config.reconnectTimeout;
    return typeof secs === "number" && secs > 0
      ? secs * 1000
      : DEFAULT_RECONNECT_GRACE_MS;
  }

  onPlayerLeave(player: Player, reason: LeaveReason) {
    // MP-08 refines this per reason (a 10 s host reload must not end the
    // game); for now every departure is final.
    this.slots.delete(player.id);
    this.presence.delete(player.id);
    // C1 (#255): the seat's chat budget goes with the seat — a rejoiner starts
    // with a clean window, and a room that churns seats cannot accumulate
    // windows for players nobody can reach.
    this.chatLimits.delete(player.id);
    if (player.id === this.hostId) {
      // No host, no truth. Tell the guest plainly rather than stranding them.
      this.hostId = null;
      this.broadcast({ type: "reject", reason: HOST_LEFT_REASON });
    }
    this.log.info("Player left", { playerId: player.id, reason });
    this.unlock();

    // RANK-01: an empty seat in a LIVE match is a forfeit — the leaver loses.
    //
    // The policy, and why it is this way round: a ladder that ignored
    // abandonment would make quitting strictly better than losing, and the top
    // of the board would belong to whoever walked away fastest. So the leaver
    // is debited and the survivor credited, exactly as if the star line had
    // been crossed the other way.
    //
    // The room files it rather than the survivor because the two seats must
    // not be able to disagree about one match: the player who walks away is
    // not going to send anything, and a survivor who filed alone could claim
    // any verdict. One `result`, broadcast to whoever is still in the room —
    // and the leaver's own client applies the same loss locally at the moment
    // it leaves (`src/iso/game.ts`), so both seats land on the same number.
    if (!this.matchLive || this.resultFiled) return;
    const others = [...this.players.keys()].filter((id) => id !== player.id);
    if (others.length === 0) return;                 // the room emptied: nobody to rate
    if (reason === "disconnect") {
      // A dropped socket is not a departure yet. Clear any earlier timer for
      // this seat and re-arm: the LAST disconnect is the one that counts.
      const previous = this.forfeitTimers.get(player.id);
      if (previous) this.clock.clear(previous);
      const name = `forfeit:${player.id}`;
      this.forfeitTimers.set(player.id, name);
      this.clock.setTimeout(name, () => {
        this.forfeitTimers.delete(player.id);
        this.fileLeaverLoss(player.id, others[0], "forfeit");
      }, FORFEIT_GRACE_MS);
      return;
    }
    this.fileLeaverLoss(player.id, others[0], "forfeit");
  }

  onDispose() {
    // A room that empties is not a room that lost. Drop the armed timers: the
    // clock is disposed with the room, and firing into a gone room would file
    // against players nobody can reach.
    for (const name of this.forfeitTimers.values()) this.clock.clear(name);
    this.forfeitTimers.clear();
    // C1 (#255): chat windows are per-seat state like any other — a disposed
    // room keeps nothing.
    this.chatLimits.clear();
  }

  // ── RANK-01: the rating board and the filed result ──────────────────────

  /**
   * A rating arrives. Two rules, both about who is allowed to speak:
   *
   *   - the id must be the SENDER's. A rating is the one number a player is
   *     allowed to be wrong about (it only ever feeds an expectation), but it
   *     must never be possible to write somebody else's;
   *   - the first publish for a seat must carry a join token, and any later
   *     publish for the same seat must carry the SAME one. The token is minted
   *     when the player joins the room, so a third party who joined later (or
   *     a stale tab) cannot overwrite a rating mid-room. Re-publishing with
   *     the same token is allowed and idempotent — a client re-attaching after
   *     a reconnect sends its rating again, and the newer value is the truer
   *     one (it may have just filed a match).
   */
  private onRating(sender: Player, msg: PlayerRatingMsg): void {
    const wire = readRankWire(msg);
    if (!wire || wire.id !== sender.id) return;
    const existing = this.ratings.get(sender.id);
    if (existing) {
      if (!wire.joinToken || wire.joinToken !== existing.joinToken) return;
    } else if (!wire.joinToken) {
      return;
    }
    this.ratings.set(sender.id, { ...wire, joinToken: wire.joinToken ?? existing!.joinToken });
    // The board goes out whole: two entries, and a delta would need a sequence
    // and a re-request path for the one message a room ever sends twice.
    this.broadcast({ type: "ratingUpdate", ratings: this.ratingBoard() });
  }

  /**
   * The host says the match is over. Validated to the shape the room can
   * check — the winner is a member, the loser is a member OR a seat this room
   * has seen and already evicted (#164: the survivor who picked "finish the
   * game" crosses the star line AFTER the opponent's seat was removed, and
   * "claim the win now" must not wait out the forfeit timer), exactly one
   * result per room — and then relayed to EVERYONE including the host, so both
   * seats act on one verdict instead of each trusting itself.
   *
   * A guest claiming a win is dropped: the guest does not run the simulation,
   * so it has no standing to declare the star line crossed.
   */
  private onResultClaim(sender: Player, msg: ResultClaimMsg): void {
    if (sender.id !== this.hostId) return;
    if (this.resultFiled) return;
    if (msg.reason !== "win" && msg.reason !== "forfeit") return;
    if (msg.winnerId === msg.loserId) return;
    if (!this.players.has(msg.winnerId)) return;
    if (!this.players.has(msg.loserId) && !this.everJoined.has(msg.loserId)) return;
    const durationSec = typeof msg.durationSec === "number" && Number.isFinite(msg.durationSec)
      ? Math.max(0, Math.round(msg.durationSec))
      : 0;
    this.fileResult(msg.winnerId, msg.loserId, msg.reason, durationSec);
  }

  /** The room's own verdict on an empty seat: the leaver loses. */
  private fileLeaverLoss(leaverId: string, winnerId: string, reason: ResultMsg["reason"]): void {
    this.fileResult(winnerId, leaverId, reason, 0, leaverId);
  }

  // ── #186: the room's match settings ─────────────────────────────────────

  /**
   * The host files the rules its lobby is showing.
   *
   * Two checks, both about who may speak and what may be said:
   *
   *   - the claim must come from the HOST. A guest has no standing to declare
   *     what the match plays by — the host runs the simulation, so the host's
   *     ★ line is the only one that exists;
   *   - the block must NORMALISE (`readMatchSettings`). What the room stores
   *     and echoes is therefore always a whole record: a half-typed purse line
   *     or a 900★ stepper is dropped rather than becoming the room's rules.
   *
   * The echo goes to EVERYONE including the host, so a lobby has exactly one
   * source for the rules it prints — the room's — and a refused claim simply
   * never comes back.
   */
  private onSettingsClaim(sender: Player, msg: SettingsClaimMsg): void {
    if (sender.id !== this.hostId) return;
    const next = readMatchSettings(msg.settings);
    if (!next) return;
    this.settings = next;
    this.aiSeatFiled = next.aiSeats.length > 0;
    this.log.info("Match settings filed", {
      playerId: sender.id,
      winTarget: next.winTarget,
      aiSeats: next.aiSeats,
    });
    this.broadcast({ type: "settings", settings: next });
    // A seat that emptied while an AI was filed frees it again: the next
    // joiner is welcome to take the seat the AI was holding.
    if (!this.aiSeatFiled) this.unlock();
  }

  // ── C1 (#255): chat ─────────────────────────────────────────────────────

  /**
   * One chat line arrives. Chat is not a game action — no intent, no economy
   * path, no state — so the room does exactly what a relay should with it: say
   * who spoke, hold the line inside the limits, and pass it on.
   *
   * Three rules, the same shapes as the ones above:
   *
   *   - the SENDER owns the name. `from` is stamped from the room's own player
   *     record, never read from the message body, so a client cannot type as
   *     somebody else; `t` is the room's clock for the same reason — one time
   *     source orders both seats' lines and no client can backdate itself.
   *   - the LINE is clipped by `readChatMsg`, the same reader the receiving
   *     client runs, so "what the room accepts" and "what a peer will accept"
   *     are one definition rather than two that can drift. A frame with no
   *     text, or one that is not a chat message at all, is dropped.
   *   - the BUDGET is the sender's own window (see `chatLimits`), spent here in
   *     the room's clock.
   *
   * The relay goes to the OTHER seats only. A line is something said TO
   * somebody: the speaker's own client made it and keeps it, so echoing it
   * back would only be a second copy to de-duplicate — and a client that
   * trusted the echo would double every line it sent.
   */
  private onChat(sender: Player, msg: ChatMsg): void {
    const line = readChatMsg({ ...msg, from: sender.username });
    if (!line) return;
    if (!this.chatLimitFor(sender.id).allow()) return;
    const out: ChatMsg = { ...line, from: sender.username, t: Date.now() };
    for (const id of this.players.keys()) {
      if (id !== sender.id) this.sendTo(id, out);
    }
  }

  /** A sender's rate window, created on first use and dropped when they leave. */
  private chatLimitFor(playerId: string): ChatLimiter {
    let limiter = this.chatLimits.get(playerId);
    if (!limiter) {
      limiter = new ChatLimiter(CHAT_RATE_MAX, CHAT_RATE_WINDOW_MS);
      this.chatLimits.set(playerId, limiter);
    }
    return limiter;
  }

  /**
   * #186: an AI is holding the opponent seat, so the room is full the moment
   * the match goes live.
   *
   * `maxPlayers: 2` locks a room on its second HUMAN, and a host who started
   * early against an AI has only ever had one — so without this a joiner with
   * the code would be seated into a seat the host is already simulating for a
   * machine, arriving mid-match as a passenger in somebody else's game. The
   * lock is the honest version of that seat: taken.
   */
  private lockAiSeat(): void {
    if (!this.aiSeatFiled) return;
    if (this.playerCount >= 2) return;              // a human already holds it
    this.lock();
  }

  /**
   * File the one result this room will ever carry. Idempotent by construction:
   * `resultFiled` is set before the broadcast, so a race between a disconnect
   * grace expiring and the host's own claim cannot produce two results (and
   * therefore cannot move a rating twice for one match).
   */
  private fileResult(
    winnerId: string,
    loserId: string,
    reason: ResultMsg["reason"],
    durationSec: number,
    departedId?: string,
  ): void {
    if (this.resultFiled) return;
    this.resultFiled = true;
    for (const name of this.forfeitTimers.values()) this.clock.clear(name);
    this.forfeitTimers.clear();
    const result: ResultMsg = {
      type: "result",
      winnerId,
      loserId,
      reason,
      durationSec,
      ratings: this.ratingBoard(),
      at: Date.now(),
    };
    if (departedId) result.departedId = departedId;
    this.log.info("Ranked result filed", { winnerId, loserId, reason, durationSec });
    this.broadcast(result);
  }

  /** The board as it stands: every rating the room has actually been told. */
  private ratingBoard(): RankWire[] {
    return [...this.ratings.entries()].map(([id, entry]) => ({
      id,
      rating: entry.rating,
      matches: entry.matches,
    }));
  }

  /** The join greeting: seed, host, protocol version, and the slot roster. */
  private welcome(hostId: string): HexProtocol {
    const roster: { id: string; username: string; slot: Slot }[] = [];
    for (const p of this.players.values()) {
      const slot = this.slots.get(p.id);
      if (slot !== undefined) roster.push({ id: p.id, username: p.username, slot });
    }
    // RANK-01: the board rides the greeting, so a newcomer's very first look at
    // the lobby already shows both players' ratings.
    const greeting: HexProtocol = {
      type: "welcome",
      seed: this.seed,
      hostId,
      protocolVersion: PROTOCOL_VERSION,
      roster,
      ratings: this.ratingBoard(),
    };
    // #186: and so do the rules. A guest learns the ★ line, the opening purse
    // and the AI seats here — which is also how a LATE join or a rejoin gets
    // the same settings the room has been playing by all along. Absent (no
    // claim yet) reads as the defaults, so the field is only sent once the
    // host has actually chosen something.
    if (this.settings) greeting.settings = this.settings;
    return greeting;
  }
}
