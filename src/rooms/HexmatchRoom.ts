// ══════════════════════════════════════════════════════════════════════════
// MP-03 — Hexmatch room: a thin validating relay (RUN.world GameRoom).
//
// Host authority, thin relay (§2): the host browser runs the full sim and the
// guest renders only. This room owns exactly three things — the map seed, the
// host identity, and message routing. It NEVER simulates.
//
//   guest intent/resync  →  forward to the host ONLY (sendTo hostId)
//   host snapshot/delta  →  broadcast to all guests
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
// ══════════════════════════════════════════════════════════════════════════
import { GameRoom, type GameMessage, type LeaveReason, type Player } from "@series-inc/rundot-game-sdk/mp-server";
import { PROTOCOL_VERSION, readMatchSettings, readRankWire, type HexProtocol, type MatchSettings, type PlayerRatingMsg, type RankWire, type ResultClaimMsg, type ResultMsg, type SettingsClaimMsg, type Slot } from "../net/protocol";

/** Sent when the host is gone — no host, no truth, say so plainly. */
export const HOST_LEFT_REASON = "The host left the game.";

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
    if (this.playerCount >= 2) this.lock();
    // RANK-01: a reconnecting player is not a leaver. Cancelling the armed
    // forfeit here is the whole point of the grace window above.
    const armed = this.forfeitTimers.get(player.id);
    if (armed) {
      this.clock.clear(armed);
      this.forfeitTimers.delete(player.id);
      this.log.info("Forfeit cancelled — player reconnected", { playerId: player.id });
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

  onPlayerLeave(player: Player, reason: LeaveReason) {
    // MP-08 refines this per reason (a 10 s host reload must not end the
    // game); for now every departure is final.
    this.slots.delete(player.id);
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
   * check — both ids are members, exactly one result per room — and then
   * relayed to EVERYONE including the host, so both seats act on one verdict
   * instead of each trusting itself.
   *
   * A guest claiming a win is dropped: the guest does not run the simulation,
   * so it has no standing to declare the star line crossed.
   */
  private onResultClaim(sender: Player, msg: ResultClaimMsg): void {
    if (sender.id !== this.hostId) return;
    if (this.resultFiled) return;
    if (msg.reason !== "win" && msg.reason !== "forfeit") return;
    if (msg.winnerId === msg.loserId) return;
    if (!this.players.has(msg.winnerId) || !this.players.has(msg.loserId)) return;
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
