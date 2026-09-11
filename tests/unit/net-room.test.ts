// MP-01 — the RUN room class is a *relay*, and the only authority it keeps is
// "a guest cannot forge world state" (docs/HexMatch-tickets.md §6: "Do not drop
// it"). These tests drive the real `HexmatchRoom` through the real SDK
// `GameRoom` plumbing (`handleCreate` / `handleJoin` / `handleMessage` /
// `handleLeave`) against a recording `RoomProtocol`, so the wire semantics that
// are easy to get wrong are the SDK's own, not a mock's:
//   • the joiner is already in `this.players` when `onPlayerJoin` runs, so
//     `playerCount` includes them;
//   • `broadcast` strips `type` and sends the rest as `data`;
//   • inbound, the payload is reassembled as `{ ...data, type: msgType }`.
import { describe, it, expect, beforeEach } from "vitest";
import {
  Clock,
  type GameRoomProps,
  type LeaveReason,
  type Logger,
  type PlatformServices,
  type RoomProtocol,
} from "@series-inc/rundot-game-sdk/mp-server";
import HexmatchRoom from "../../src/rooms/HexmatchRoom";
import { PROTOCOL_VERSION, type HexProtocol } from "../../src/net/protocol";
import type { Snapshot } from "../../src/iso/snapshot";

interface Broadcast {
  type: string;
  data: Record<string, unknown>;
}
interface Unicast {
  to: string;
  type: string;
  data: Record<string, unknown>;
}
interface LogLine {
  level: string;
  message: string;
  data?: Record<string, unknown>;
}

/** A stand-in snapshot — only the room's *routing* is under test, not its bytes. */
const FAKE_SNAP = { version: 9, seed: 7, t: 0, setupPhase: true, won: false } as unknown as Snapshot;

/** Minimal harness: records what the room sent, and exposes the inbound hooks. */
function makeRoom() {
  const broadcasts: Broadcast[] = [];
  const unicasts: Unicast[] = [];
  const logs: LogLine[] = [];

  const protocol: RoomProtocol = {
    broadcast: (type, data) => broadcasts.push({ type, data: data as Record<string, unknown> }),
    sendTo: (to, type, data) => unicasts.push({ to, type, data: data as Record<string, unknown> }),
    kick: () => {},
    lock: () => {},
    unlock: () => {},
    persist: () => {},
    handleCreate: () => Promise.resolve(),
    handleRestore: () => Promise.resolve(),
    handleJoin: () => Promise.resolve({ accepted: false, reason: "not wired" }),
    handleMessage: () => Promise.resolve(),
    handleLeave: () => Promise.resolve(),
    handleDispose: () => Promise.resolve(),
    handleTick: () => Promise.resolve(),
    serializePersistState: () => ({}),
    getLocked: () => false,
    getPlayers: () => new Map(),
  };

  // The room never touches platform services; the harness requires the object.
  const services = { getGameConfig: () => Promise.resolve({}) } as unknown as PlatformServices;

  // Capture instead of printing: the SDK Logger writes JSON to stdout, and the
  // "dropped forged state" warning is itself worth asserting on.
  const log = {
    debug: (message: string, data?: Record<string, unknown>) => logs.push({ level: "debug", message, data }),
    info: (message: string, data?: Record<string, unknown>) => logs.push({ level: "info", message, data }),
    warn: (message: string, data?: Record<string, unknown>) => logs.push({ level: "warn", message, data }),
    error: (message: string, data?: Record<string, unknown>) => logs.push({ level: "error", message, data }),
    critical: (message: string, data?: Record<string, unknown>) => logs.push({ level: "critical", message, data }),
    child: () => log,
  } as unknown as Logger;

  // `GameRoom`'s constructor is protected on purpose — "you never instantiate it
  // yourself: the platform creates one instance per active room". The test is
  // standing in for the platform, so it widens the constructor here rather than
  // making the shipped class public.
  const RoomCtor = HexmatchRoom as unknown as new (props: GameRoomProps) => HexmatchRoom;
  const room = new RoomCtor({
    protocol,
    roomId: "room-1",
    roomType: "hexmatch",
    config: Object.freeze({ maxPlayers: 2, metadata: { mode: "versus" } }),
    players: new Map(),
    clock: new Clock(),
    log,
    services,
  } as GameRoomProps);

  const join = (id: string, username: string) => protocol.handleJoin({ id, username });
  const message = (playerId: string, msg: HexProtocol) => {
    const { type, ...data } = msg;
    return protocol.handleMessage(playerId, type, data);
  };
  const leave = (id: string, reason: LeaveReason = "leave") => protocol.handleLeave(id, reason);
  const warned = (pattern: RegExp) => logs.some((l) => l.level === "warn" && pattern.test(l.message));

  return { room, protocol, broadcasts, unicasts, logs, join, message, leave, warned };
}

describe("HexmatchRoom — seat and seed", () => {
  it("mints a non-zero seed at creation, before anyone joins", async () => {
    const { room, protocol } = makeRoom();
    await protocol.handleCreate();
    const state = protocol.serializePersistState();
    expect(typeof state.seed).toBe("number");
    expect(state.seed).not.toBe(0);
    expect(state.hostId).toBeNull();
    expect(room.playerCount).toBe(0);
  });

  it("makes the first joiner the host and seats them 0, the second 1", async () => {
    const { broadcasts, unicasts, join } = makeRoom();
    const first = await join("host-id", "Torvin");
    expect(first.accepted).toBe(true);
    // The joiner cannot be reached by broadcast inside onPlayerJoin (the socket
    // is registered only once the join is accepted) — they get it point-to-point.
    expect(unicasts).toEqual([
      {
        to: "host-id",
        type: "welcome",
        data: {
          seed: expect.any(Number),
          hostId: "host-id",
          protocolVersion: PROTOCOL_VERSION,
          roster: [{ id: "host-id", username: "Torvin", slot: 0 }],
        },
      },
    ]);
    expect(broadcasts).toHaveLength(1);

    await join("guest-id", "Vex");
    const guestWelcome = unicasts.at(-1)!;
    expect(guestWelcome.to).toBe("guest-id");
    expect(guestWelcome.data.hostId).toBe("host-id");
    expect(guestWelcome.data.roster).toEqual([
      { id: "host-id", username: "Torvin", slot: 0 },
      { id: "guest-id", username: "Vex", slot: 1 },
    ]);
  });

  it("stamps PROTOCOL_VERSION on the welcome so a mixed-version room can refuse", async () => {
    const { unicasts, join } = makeRoom();
    await join("host-id", "Torvin");
    expect(unicasts[0].data.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it("rejects a third joiner — two seats, per players[0]/players[1]", async () => {
    const { join } = makeRoom();
    await join("a", "A");
    await join("b", "B");
    const third = await join("c", "C");
    expect(third).toEqual({ accepted: false, reason: expect.stringMatching(/full/i) });
  });

  it("gives a rejoiner the seat the leaver vacated", async () => {
    const { unicasts, join, leave } = makeRoom();
    await join("a", "A");
    await join("b", "B");
    await leave("a", "leave");
    await join("c", "C");
    expect(unicasts.at(-1)!.data.roster).toContainEqual({ id: "c", username: "C", slot: 0 });
  });
});

describe("HexmatchRoom — routing authority", () => {
  let h: ReturnType<typeof makeRoom>;

  beforeEach(async () => {
    h = makeRoom();
    await h.join("host-id", "Torvin");
    await h.join("guest-id", "Vex");
    h.broadcasts.length = 0;
    h.unicasts.length = 0;
    h.logs.length = 0;
  });

  it("relays a host snapshot to the room", async () => {
    await h.message("host-id", { type: "snapshot", snap: FAKE_SNAP });
    expect(h.broadcasts).toEqual([{ type: "snapshot", data: { snap: FAKE_SNAP } }]);
  });

  it("drops a guest-forged snapshot instead of relaying it", async () => {
    await h.message("guest-id", { type: "snapshot", snap: FAKE_SNAP });
    expect(h.broadcasts).toEqual([]);
    expect(h.warned(/forged state from non-host/)).toBe(true);
  });

  it("drops a guest-forged delta instead of relaying it", async () => {
    await h.message("guest-id", { type: "delta", t: 1, seq: 1, won: true });
    expect(h.broadcasts).toEqual([]);
    expect(h.warned(/forged state from non-host/)).toBe(true);
  });

  it("relays a host delta to the room", async () => {
    const tiles = [{ i: 3, dirt: 1, road: 0, owner: 1, upgraded: 0 }];
    await h.message("host-id", { type: "delta", t: 1, seq: 4, tiles });
    expect(h.broadcasts).toEqual([{ type: "delta", data: { t: 1, seq: 4, tiles } }]);
  });

  it("sends a guest intent to the host only, never to the room", async () => {
    await h.message("guest-id", {
      type: "intent",
      action: "build",
      payload: { kind: "road", tx: 4, ty: 5 },
    });
    expect(h.broadcasts).toEqual([]);
    expect(h.unicasts).toEqual([
      {
        to: "host-id",
        type: "intent",
        data: { action: "build", payload: { kind: "road", tx: 4, ty: 5 } },
      },
    ]);
  });

  it("routes a resync request to the host, not back to the asker", async () => {
    await h.message("guest-id", { type: "resync" });
    expect(h.broadcasts).toEqual([]);
    expect(h.unicasts).toEqual([{ to: "host-id", type: "resync", data: {} }]);
  });
});

describe("HexmatchRoom — host loss", () => {
  it("tells the room plainly when the host leaves, and clears the seat", async () => {
    const { broadcasts, unicasts, join, leave, protocol } = makeRoom();
    await join("host-id", "Torvin");
    await join("guest-id", "Vex");
    broadcasts.length = 0;

    await leave("host-id", "disconnect");

    expect(broadcasts).toEqual([{ type: "reject", data: { reason: "The host left the game." } }]);
    expect(protocol.serializePersistState().hostId).toBeNull();
    // The vacated seat is free for the next joiner — this is the rehost case.
    const next = await join("new-host", "Krag");
    expect(next.accepted).toBe(true);
    expect(protocol.serializePersistState().hostId).toBe("new-host");
    expect(unicasts.at(-1)!.data.roster).toContainEqual({
      id: "new-host",
      username: "Krag",
      slot: 0,
    });
  });

  it("does not declare a host loss when the guest leaves", async () => {
    const { broadcasts, join, leave, protocol } = makeRoom();
    await join("host-id", "Torvin");
    await join("guest-id", "Vex");
    broadcasts.length = 0;

    await leave("guest-id", "leave");

    expect(broadcasts).toEqual([]);
    expect(protocol.serializePersistState().hostId).toBe("host-id");
  });

  it("restores the minted seed so a crash-recovered room keeps its map", async () => {
    const { protocol } = makeRoom();
    await protocol.handleCreate();
    const seed = protocol.serializePersistState().seed as number;

    const revived = makeRoom();
    await revived.protocol.handleRestore({
      state: { seed, hostId: null, slots: [] },
      clockSnapshot: null,
    });
    await revived.join("host-id", "Torvin");
    expect(revived.unicasts[0].data.seed).toBe(seed);
  });
});
