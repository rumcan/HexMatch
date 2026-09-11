// MP-03 — relay unit tests: seed minting, host identity, message routing.
//
// Drives the REAL SDK dispatch (`handleJoin` → `onPlayerJoin`,
// `handleMessage` → `onGameMessage`, `handleLeave` → `onPlayerLeave`) with a
// fake `RoomProtocol` that records every outbound frame. No network, no auth —
// runs in CI. The live two-client exchange (real WS through `vite dev`) is
// `tools/mp-room-smoke.mjs`.
import { describe, it, expect } from "vitest";
import {
  Clock,
  type GameRoomProps,
  type LeaveReason,
  type Logger,
  type PlatformServices,
  type Player,
  type RoomProtocol,
} from "@series-inc/rundot-game-sdk/mp-server";
import HexmatchRoom, { HOST_LEFT_REASON } from "../../src/rooms/HexmatchRoom";
import {
  PROTOCOL_VERSION,
  validateWelcome,
  type HexProtocol,
  type WelcomeMsg,
} from "../../src/net/protocol";
import { buildSnapshot } from "../../src/iso/snapshot";
import { buildTile, createTrack } from "../../src/iso/track";

// The base constructor is protected — a subclass is the test's way in. Only
// the public harness handlers are driven below; no protected members touched.
class TestRoom extends HexmatchRoom {
  constructor(props: GameRoomProps) {
    super(props);
  }
}

interface Frame {
  /** "broadcast" or the target player id (mirrors room:broadcast / room:sendTo). */
  target: string;
  type: string;
  data: unknown;
}

interface Harness {
  room: TestRoom;
  protocol: RoomProtocol;
  frames: Frame[];
}

function setup(): Harness {
  const frames: Frame[] = [];
  const players = new Map<string, Player>();
  const silentLog = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    critical: () => {},
    child: () => silentLog,
  } as unknown as Logger;
  // Outbound calls record; inbound handlers are dummies the GameRoom
  // constructor overwrites with the real dispatch.
  const protocol: RoomProtocol = {
    broadcast: (type: string, data: unknown) => {
      frames.push({ target: "broadcast", type, data });
    },
    sendTo: (playerId: string, type: string, data: unknown) => {
      frames.push({ target: playerId, type, data });
    },
    kick: () => {},
    lock: () => {},
    unlock: () => {},
    persist: () => {},
    handleCreate: () => Promise.resolve(),
    handleRestore: () => Promise.resolve(),
    handleJoin: () => Promise.resolve({ accepted: false as const, reason: "unset" }),
    handleMessage: () => Promise.resolve(),
    handleLeave: () => Promise.resolve(),
    handleDispose: () => Promise.resolve(),
    handleTick: () => Promise.resolve(),
    serializePersistState: () => ({}),
    getLocked: () => false,
    getPlayers: () => players,
  };
  const room = new TestRoom({
    protocol,
    roomId: "room-1",
    roomType: "hexmatch",
    config: { maxPlayers: 2 },
    players,
    clock: new Clock(),
    log: silentLog,
    services: {} as unknown as PlatformServices,
  });
  return { room, protocol, frames };
}

/** Reassemble a frame the way the client's `toMessage` does. */
function messageOf(frame: Frame): HexProtocol {
  return { ...(frame.data as Record<string, unknown>), type: frame.type } as HexProtocol;
}

function welcomes(frames: Frame[]): WelcomeMsg[] {
  return frames
    .filter((f) => f.target === "broadcast" && f.type === "welcome")
    .map((f) => messageOf(f) as WelcomeMsg);
}

function tinySnapshot() {
  const track = createTrack();
  buildTile(track, "dirt", 5, 10, 1);
  return buildSnapshot({
    seed: 777,
    track,
    harvesters: [{ id: 1, owner: "p1", ownerId: 1, tx: 6, ty: 11 }],
    factories: [{ owner: "p1", ownerId: 1, tx: 30, ty: 11 }],
    setupPhase: false,
    won: false,
    players: [{ id: "p1", vp: 0, res: {} }],
    t: 1,
  });
}

async function join(h: Harness, id: string, username: string) {
  const res = await h.protocol.handleJoin({ id, username });
  if (!res.accepted) throw new Error(`join rejected: ${res.reason}`);
  return res.player;
}

async function leave(h: Harness, id: string, reason: LeaveReason = "leave") {
  await h.protocol.handleLeave(id, reason);
}

describe("MP-03 seed and host identity", () => {
  it("mints a 31-bit seed on create, like server.js did", async () => {
    const h = setup();
    await h.protocol.handleCreate();
    await join(h, "host-1", "Host");
    const [w] = welcomes(h.frames);
    expect(w.seed).toBeGreaterThan(0);
    expect(w.seed).toBeLessThan(0x80000000);
    expect(Number.isInteger(w.seed)).toBe(true);
  });

  it("makes the first joiner host (slot 0) and welcomes them", async () => {
    const h = setup();
    await h.protocol.handleCreate();
    await join(h, "host-1", "Host");
    expect(h.room.playerCount).toBe(1);
    expect(h.room.locked).toBe(false);
    const [w] = welcomes(h.frames);
    expect(w.hostId).toBe("host-1");
    expect(w.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(w.roster).toEqual([{ id: "host-1", username: "Host", slot: 0 }]);
    // The room's welcome must pass the client's own validation.
    expect(validateWelcome(w)).toBeNull();
  });

  it("seats the second joiner as guest (slot 1), locks, and welcomes all", async () => {
    const h = setup();
    await h.protocol.handleCreate();
    await join(h, "host-1", "Host");
    h.frames.length = 0;
    await join(h, "guest-2", "Guest");
    expect(h.room.playerCount).toBe(2);
    expect(h.room.locked).toBe(true);
    const [w] = welcomes(h.frames);
    expect(w.hostId).toBe("host-1");
    expect(w.roster).toEqual([
      { id: "host-1", username: "Host", slot: 0 },
      { id: "guest-2", username: "Guest", slot: 1 },
    ]);
    expect(validateWelcome(w)).toBeNull();
  });

  it("delivers the welcome to the newcomer via sendTo (broadcast skips them)", async () => {
    // The gateway registers the newcomer's socket AFTER onPlayerJoin, so a
    // broadcast from the hook never reaches them — without the targeted copy
    // the first joiner would sit in a room that never greeted them.
    const h = setup();
    await h.protocol.handleCreate();
    await join(h, "host-1", "Host");
    const solo = h.frames.filter((f) => f.target === "host-1" && f.type === "welcome");
    expect(solo).toHaveLength(1);
    expect(validateWelcome(messageOf(solo[0]) as WelcomeMsg)).toBeNull();
    h.frames.length = 0;
    await join(h, "guest-2", "Guest");
    const toGuest = h.frames.filter((f) => f.target === "guest-2" && f.type === "welcome");
    const toAll = h.frames.filter((f) => f.target === "broadcast" && f.type === "welcome");
    expect(toGuest).toHaveLength(1);
    expect(toAll).toHaveLength(1);
    // Same greeting on both channels — and the guest is NOT broadcast-spammed:
    // exactly one welcome per channel per join.
    expect(messageOf(toGuest[0])).toEqual(messageOf(toAll[0]));
  });
});

describe("MP-03 message routing", () => {
  async function twoPlayer(): Promise<Harness> {
    const h = setup();
    await h.protocol.handleCreate();
    await join(h, "host-1", "Host");
    await join(h, "guest-2", "Guest");
    h.frames.length = 0;
    return h;
  }

  it("forwards a guest intent to the host only", async () => {
    const h = await twoPlayer();
    await h.protocol.handleMessage("guest-2", "intent", {
      action: "build",
      payload: { tx: 3, ty: 4 },
    });
    expect(h.frames).toHaveLength(1);
    expect(h.frames[0].target).toBe("host-1");
    expect(messageOf(h.frames[0])).toEqual({
      type: "intent",
      action: "build",
      payload: { tx: 3, ty: 4 },
    });
  });

  it("forwards a guest resync to the host only", async () => {
    const h = await twoPlayer();
    await h.protocol.handleMessage("guest-2", "resync", {});
    expect(h.frames).toHaveLength(1);
    expect(h.frames[0].target).toBe("host-1");
    expect(messageOf(h.frames[0])).toEqual({ type: "resync" });
  });

  it("broadcasts a host snapshot byte-identical", async () => {
    const h = await twoPlayer();
    const snap = tinySnapshot();
    await h.protocol.handleMessage("host-1", "snapshot", { snap });
    expect(h.frames).toHaveLength(1);
    expect(h.frames[0].target).toBe("broadcast");
    expect(messageOf(h.frames[0])).toEqual({ type: "snapshot", snap });
  });

  it("broadcasts a host delta", async () => {
    const h = await twoPlayer();
    await h.protocol.handleMessage("host-1", "delta", {
      t: 10,
      seq: 3,
      tiles: [{ i: 99, dirt: 19, road: 0, owner: 1, upgraded: 0 }],
      won: false,
    });
    expect(h.frames).toHaveLength(1);
    expect(h.frames[0].target).toBe("broadcast");
    expect(messageOf(h.frames[0])).toMatchObject({ type: "delta", t: 10, seq: 3 });
  });

  it("DROPS a guest-forged snapshot — a guest cannot forge state", async () => {
    const h = await twoPlayer();
    await h.protocol.handleMessage("guest-2", "snapshot", { snap: tinySnapshot() });
    expect(h.frames).toHaveLength(0);
  });

  it("DROPS a guest-forged delta", async () => {
    const h = await twoPlayer();
    await h.protocol.handleMessage("guest-2", "delta", { t: 10, seq: 999 });
    expect(h.frames).toHaveLength(0);
  });

  it("ignores client-sent welcome/reject (server-originated only)", async () => {
    const h = await twoPlayer();
    await h.protocol.handleMessage("guest-2", "welcome", { seed: 1 });
    await h.protocol.handleMessage("guest-2", "reject", { reason: "lol" });
    await h.protocol.handleMessage("host-1", "reject", { reason: "lol" });
    expect(h.frames).toHaveLength(0);
  });

  it("ignores messages from unknown players", async () => {
    const h = await twoPlayer();
    await h.protocol.handleMessage("ghost", "intent", { action: "build", payload: {} });
    await h.protocol.handleMessage("ghost", "snapshot", { snap: tinySnapshot() });
    expect(h.frames).toHaveLength(0);
  });

  it("drops guest intents when there is no host to hear them", async () => {
    const h = await twoPlayer();
    await leave(h, "host-1");
    h.frames.length = 0;
    await h.protocol.handleMessage("guest-2", "intent", { action: "build", payload: {} });
    expect(h.frames).toHaveLength(0);
  });
});

describe("MP-03 leaving", () => {
  async function twoPlayer(): Promise<Harness> {
    const h = setup();
    await h.protocol.handleCreate();
    await join(h, "host-1", "Host");
    await join(h, "guest-2", "Guest");
    h.frames.length = 0;
    return h;
  }

  it("a guest leave frees the slot and unlocks, with no reject", async () => {
    const h = await twoPlayer();
    await leave(h, "guest-2");
    expect(h.room.locked).toBe(false);
    expect(h.frames).toHaveLength(0);
    // A newcomer takes the guest slot.
    await join(h, "guest-3", "Guest3");
    const [w] = welcomes(h.frames);
    expect(w.roster).toEqual([
      { id: "host-1", username: "Host", slot: 0 },
      { id: "guest-3", username: "Guest3", slot: 1 },
    ]);
  });

  it("a host leave broadcasts host-left and clears the host", async () => {
    const h = await twoPlayer();
    expect(HOST_LEFT_REASON).toBe("The host left the game.");
    await leave(h, "host-1");
    expect(h.room.locked).toBe(false);
    expect(h.frames).toHaveLength(1);
    expect(h.frames[0].target).toBe("broadcast");
    expect(messageOf(h.frames[0])).toEqual({ type: "reject", reason: HOST_LEFT_REASON });
  });

  it("a newcomer to a hostless room becomes host in slot 0", async () => {
    const h = await twoPlayer();
    await leave(h, "host-1");
    h.frames.length = 0;
    await join(h, "host-3", "Host3");
    const [w] = welcomes(h.frames);
    expect(w.hostId).toBe("host-3");
    expect(w.roster).toEqual([
      { id: "guest-2", username: "Guest", slot: 1 },
      { id: "host-3", username: "Host3", slot: 0 },
    ]);
    // And the new host's state now relays.
    h.frames.length = 0;
    await h.protocol.handleMessage("host-3", "delta", { t: 1, seq: 1 });
    expect(h.frames).toHaveLength(1);
    expect(h.frames[0].target).toBe("broadcast");
  });

  it("a same-id rejoin keeps its old slot", async () => {
    const h = await twoPlayer();
    await leave(h, "guest-2", "disconnect");
    h.frames.length = 0;
    await join(h, "guest-2", "Guest");
    const [w] = welcomes(h.frames);
    expect(w.roster).toEqual([
      { id: "host-1", username: "Host", slot: 0 },
      { id: "guest-2", username: "Guest", slot: 1 },
    ]);
  });
});
