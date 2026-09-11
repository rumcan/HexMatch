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
// NOTE (ticket sketch correction): the §6 sketch reads `msg.playerId`, but
// SDK 5.27's `GameMessage` is `{ sender, payload }` — the sender is
// `msg.sender.id`. This file follows the SDK, not the sketch.
// ══════════════════════════════════════════════════════════════════════════
import { GameRoom, type GameMessage, type LeaveReason, type Player } from "@series-inc/rundot-game-sdk/mp-server";
import { PROTOCOL_VERSION, type HexProtocol, type Slot } from "../net/protocol";

/** Sent when the host is gone — no host, no truth, say so plainly. */
export const HOST_LEFT_REASON = "The host left the game.";

export default class HexmatchRoom extends GameRoom<HexProtocol> {
  private seed = 0;
  private hostId: string | null = null;
  private readonly slots = new Map<string, Slot>();

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
    if (p.type === "snapshot" || p.type === "delta") {
      // THE authority check: only the host may assert state. A guest-forged
      // snapshot or delta is dropped silently — no broadcast, no error that a
      // bad client could probe. Do not drop this check.
      if (msg.sender.id !== this.hostId) return;
      this.broadcast(p);
      return;
    }
    // `welcome` / `reject` are server-originated — a client sending them is
    // ignored. Unknown future types land here too: fail closed, never relay
    // what the relay does not understand.
  }

  onPlayerLeave(player: Player, _reason: LeaveReason) {
    // MP-08 refines this per reason (a 10 s host reload must not end the
    // game); for now every departure is final.
    this.slots.delete(player.id);
    if (player.id === this.hostId) {
      // No host, no truth. Tell the guest plainly rather than stranding them.
      this.hostId = null;
      this.broadcast({ type: "reject", reason: HOST_LEFT_REASON });
    }
    this.log.info("Player left", { playerId: player.id });
    this.unlock();
  }

  /** The join greeting: seed, host, protocol version, and the slot roster. */
  private welcome(hostId: string): HexProtocol {
    const roster: { id: string; username: string; slot: Slot }[] = [];
    for (const p of this.players.values()) {
      const slot = this.slots.get(p.id);
      if (slot !== undefined) roster.push({ id: p.id, username: p.username, slot });
    }
    return { type: "welcome", seed: this.seed, hostId, protocolVersion: PROTOCOL_VERSION, roster };
  }
}
