// ══════════════════════════════════════════════════════════════════════════
// MP-01/MP-03 — the RUN.world room class (docs/HexMatch-tickets.md §6).
//
// This is NOT the simulation. The authority model is host-authoritative (§2):
// the browser that creates the room runs the economy tick, the vehicles and the
// rival, and the guests render only. What lives here is the three things the
// platform can own better than a browser:
//
//   1. the map seed   — minted once at room creation, so both clients
//                       regenerate identical geometry via generateMap(seed)
//   2. the host       — the first joiner
//   3. routing        — host→everyone, guest→host, and nothing else
//
// `msg.sender.id !== this.hostId` is the only real authority the relay keeps,
// and it is what stops a guest forging world state. Do not drop it.
//
// Registered in `rundot/realtime.config.json` as room type `hexmatch`, bundled
// into `dist/server-bundle.js` by `rundotMultiplayerPlugin()`.
// ══════════════════════════════════════════════════════════════════════════
import {
  GameRoom,
  type GameMessage,
  type LeaveReason,
  type Player,
} from "@series-inc/rundot-game-sdk/mp-server";
import {
  PROTOCOL_VERSION,
  isHostBound,
  isHostOnly,
  type HexProtocol,
  type RosterEntry,
  type Slot,
  type WelcomeMsg,
} from "../net/protocol";

/**
 * Seed range matches the old relay (`server/server.js` minted at room creation)
 * and stays inside the uint32 the snapshot stores (`seed >>> 0`). Zero is
 * re-rolled: the field's "unset" value is 0, and a room that booted with seed 0
 * would look uninitialised after a crash-recovery restore.
 */
function mintSeed(): number {
  let seed = 0;
  while (seed === 0) seed = (Math.random() * 0x7fffffff) | 0;
  return seed;
}

export default class HexmatchRoom extends GameRoom<HexProtocol> {
  private seed = 0;
  private hostId: string | null = null;
  /** playerId → seat. Slot 0 is "you", slot 1 is the rival (§9). */
  private slots = new Map<string, Slot>();

  // ── lifecycle ──────────────────────────────────────────────────────────────

  protected onCreate(): void {
    this.seed = mintSeed();
    this.log.info("hexmatch room created", { roomId: this.roomId, seed: this.seed });
  }

  /** Crash recovery: without the seed a restored room would mint a new map. */
  protected getPersistState(): Record<string, unknown> {
    return {
      seed: this.seed,
      hostId: this.hostId,
      slots: Array.from(this.slots.entries()),
    };
  }

  protected onRestore(snapshot: Record<string, unknown>): void {
    const seed = snapshot.seed;
    if (typeof seed === "number" && seed !== 0) this.seed = seed;
    const hostId = snapshot.hostId;
    if (typeof hostId === "string" || hostId === null) this.hostId = hostId;
    const slots = snapshot.slots;
    if (Array.isArray(slots)) {
      this.slots = new Map(
        slots
          .filter((e): e is [string, Slot] => Array.isArray(e) && typeof e[0] === "string")
          .map(([id, slot]) => [id, slot === 1 ? 1 : 0] as [string, Slot]),
      );
    }
    this.log.info("hexmatch room restored", { roomId: this.roomId, seed: this.seed });
  }

  protected onPlayerJoin(player: Player): void {
    // `this.players` already contains the joiner by the time this hook runs, so
    // the seat count includes them.
    if (this.slots.size >= 2 && !this.slots.has(player.id)) {
      this.reject({ reason: "This game is full (2 players)." });
    }
    if (this.hostId === null) this.hostId = player.id;
    if (!this.slots.has(player.id)) this.assignSlot(player.id);
    if (this.playerCount >= 2) this.lock();

    const welcome = this.welcome();
    // The joiner cannot be reached by `broadcast` from inside this hook — the
    // harness registers their socket only after the join is accepted — so they
    // get the welcome point-to-point (the harness buffers it until the socket
    // is live) and everyone already connected gets the same message as a roster
    // refresh. `welcome` is idempotent by construction, so a platform that does
    // include the joiner in the broadcast is harmless.
    this.sendTo(player.id, welcome);
    this.broadcast(welcome);
    this.log.info("player joined", { playerId: player.id, slot: this.slots.get(player.id) });
  }

  protected onPlayerLeave(player: Player, reason: LeaveReason): void {
    this.slots.delete(player.id);
    if (player.id === this.hostId) {
      // No host, no truth. Tell the guest plainly rather than stranding them.
      this.hostId = null;
      this.broadcast({ type: "reject", reason: "The host left the game." });
    }
    this.unlock();
    this.log.info("player left", { playerId: player.id, reason });
  }

  protected onGameMessage(message: GameMessage<HexProtocol>): void {
    const payload = message.payload;

    // guest → host only. Never broadcast: a guest action is not world state
    // until the host has run it through construction/economy and published it.
    if (isHostBound(payload)) {
      if (this.hostId) this.sendTo(this.hostId, payload);
      return;
    }

    // host → everyone. This sender check is the whole of the relay's authority.
    if (isHostOnly(payload)) {
      if (message.sender.id !== this.hostId) {
        this.log.warn("dropped forged state from non-host", {
          playerId: message.sender.id,
          hostId: this.hostId,
          type: payload.type,
        });
        return;
      }
      this.broadcast(payload);
      return;
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Lowest free seat, so a rejoin after a drop reuses the vacated slot. */
  private assignSlot(playerId: string): Slot {
    const taken = Array.from(this.slots.values());
    const slot: Slot = taken.includes(0) ? 1 : 0;
    this.slots.set(playerId, slot);
    return slot;
  }

  private roster(): RosterEntry[] {
    const out: RosterEntry[] = [];
    for (const player of this.players.values()) {
      const slot = this.slots.get(player.id);
      if (slot === undefined) continue;
      out.push({ id: player.id, username: player.username, slot });
    }
    return out;
  }

  private welcome(): WelcomeMsg {
    return {
      type: "welcome",
      seed: this.seed,
      hostId: this.hostId ?? "",
      protocolVersion: PROTOCOL_VERSION,
      roster: this.roster(),
    };
  }
}
