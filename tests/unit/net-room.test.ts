// MP-03 — relay unit tests: seed minting, host identity, message routing.
//
// Drives the REAL SDK dispatch (`handleJoin` → `onPlayerJoin`,
// `handleMessage` → `onGameMessage`, `handleLeave` → `onPlayerLeave`) with a
// fake `RoomProtocol` that records every outbound frame. No network, no auth —
// runs in CI. The live two-client exchange (real WS through `vite dev`) is
// `tools/mp-room-smoke.mjs`.
import { describe, it, expect, vi } from "vitest";
import {
  Clock,
  type GameRoomProps,
  type LeaveReason,
  type Logger,
  type PlatformServices,
  type Player,
  type RoomProtocol,
} from "@series-inc/rundot-game-sdk/mp-server";
import HexmatchRoom, { FORFEIT_GRACE_MS, HOST_LEFT_REASON } from "../../src/rooms/HexmatchRoom";
import {
  PROTOCOL_VERSION,
  validateWelcome,
  type HexProtocol,
  type RankWire,
  type ResultMsg,
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

// ══════════════════════════════════════════════════════════════════════════
// RANK-01 (#147) — the room as a rating board, and the room as the referee
//
// The rating arithmetic is unit-tested in `net-rank.test.ts`; what belongs here
// is the part neither client can be trusted with: who may speak about a rating,
// and who gets to say a match is over. Two rules carry the whole design —
// a rating's id must be the sender's, and the room files exactly ONE result.
// ══════════════════════════════════════════════════════════════════════════
describe("RANK-01 the room as a rating board", () => {
  async function twoPlayer(): Promise<Harness> {
    const h = setup();
    await h.protocol.handleCreate();
    await join(h, "host-1", "Host");
    await join(h, "guest-2", "Guest");
    h.frames.length = 0;
    return h;
  }

  /** A room mid-match: both seats published, the host has sent state. */
  async function liveMatch(): Promise<Harness> {
    const h = await twoPlayer();
    await h.protocol.handleMessage("host-1", "playerRating", {
      id: "host-1", rating: 1180, matches: 12, joinToken: "tok-host",
    });
    await h.protocol.handleMessage("guest-2", "playerRating", {
      id: "guest-2", rating: 1040, matches: 3, joinToken: "tok-guest",
    });
    await h.protocol.handleMessage("host-1", "delta", { t: 4, seq: 1 });
    h.frames.length = 0;
    return h;
  }

  const of = (h: Harness, type: string) => h.frames.filter((f) => f.type === type);

  it("broadcasts the board when a rating is published, and echoes it on welcome", async () => {
    const h = await twoPlayer();
    await h.protocol.handleMessage("host-1", "playerRating", {
      id: "host-1", rating: 1180, matches: 12, joinToken: "tok-host",
    });
    const [update] = of(h, "ratingUpdate");
    expect(update.target).toBe("broadcast");
    expect((messageOf(update) as { ratings: RankWire[] }).ratings).toEqual([
      { id: "host-1", rating: 1180, matches: 12 },
    ]);
    // The board is on the greeting too, so a newcomer's lobby shows it at once.
    h.frames.length = 0;
    await join(h, "guest-3", "Guest3");
    const [w] = welcomes(h.frames);
    expect(w.ratings).toEqual([{ id: "host-1", rating: 1180, matches: 12 }]);
  });

  it("DROPS a rating published for somebody else — id must be the sender", async () => {
    const h = await twoPlayer();
    await h.protocol.handleMessage("guest-2", "playerRating", {
      id: "host-1", rating: 3000, matches: 0, joinToken: "tok-guest",
    });
    expect(of(h, "ratingUpdate")).toHaveLength(0);
    // …and the seat it tried to claim still publishes its own number.
    await h.protocol.handleMessage("host-1", "playerRating", {
      id: "host-1", rating: 1180, matches: 12, joinToken: "tok-host",
    });
    const [update] = of(h, "ratingUpdate");
    expect((messageOf(update) as { ratings: RankWire[] }).ratings).toEqual([
      { id: "host-1", rating: 1180, matches: 12 },
    ]);
  });

  it("requires a join token on the first publish, and the SAME one after", async () => {
    const h = await twoPlayer();
    // No token: a stranger who joined could otherwise claim a seat's number.
    await h.protocol.handleMessage("host-1", "playerRating", { id: "host-1", rating: 1180, matches: 12 });
    expect(of(h, "ratingUpdate")).toHaveLength(0);
    await h.protocol.handleMessage("host-1", "playerRating", {
      id: "host-1", rating: 1180, matches: 12, joinToken: "tok-host",
    });
    expect(of(h, "ratingUpdate")).toHaveLength(1);
    // A different token is a different claimant: ignored.
    h.frames.length = 0;
    await h.protocol.handleMessage("host-1", "playerRating", {
      id: "host-1", rating: 2400, matches: 12, joinToken: "stale",
    });
    expect(of(h, "ratingUpdate")).toHaveLength(0);
    // The same token re-publishing is idempotent — and the newer value wins:
    // a client re-attaching after a reconnect sends its rating again.
    await h.protocol.handleMessage("host-1", "playerRating", {
      id: "host-1", rating: 1196, matches: 13, joinToken: "tok-host",
    });
    expect(of(h, "ratingUpdate")).toHaveLength(1);
    expect((messageOf(of(h, "ratingUpdate")[0]) as { ratings: RankWire[] }).ratings[0].rating).toBe(1196);
  });
});

describe("RANK-01 the room as the referee", () => {
  async function liveMatch(): Promise<Harness> {
    const h = setup();
    await h.protocol.handleCreate();
    await join(h, "host-1", "Host");
    await join(h, "guest-2", "Guest");
    await h.protocol.handleMessage("host-1", "playerRating", {
      id: "host-1", rating: 1180, matches: 12, joinToken: "tok-host",
    });
    await h.protocol.handleMessage("guest-2", "playerRating", {
      id: "guest-2", rating: 1040, matches: 3, joinToken: "tok-guest",
    });
    await h.protocol.handleMessage("host-1", "delta", { t: 4, seq: 1 });
    h.frames.length = 0;
    return h;
  }
  const results = (h: Harness) => h.frames.filter((f) => f.type === "result").map((f) => messageOf(f) as ResultMsg);

  it("files the host's claim once, broadcast to BOTH seats with the room's board", async () => {
    const h = await liveMatch();
    await h.protocol.handleMessage("host-1", "resultClaim", {
      winnerId: "host-1", loserId: "guest-2", reason: "win", durationSec: 412.4,
    });
    const [filed] = results(h);
    expect(h.frames.filter((f) => f.type === "result")[0].target).toBe("broadcast");
    expect(filed).toMatchObject({ winnerId: "host-1", loserId: "guest-2", reason: "win", durationSec: 412 });
    expect(filed.ratings).toEqual([
      { id: "host-1", rating: 1180, matches: 12 },
      { id: "guest-2", rating: 1040, matches: 3 },
    ]);
    // One result per room: a second claim (however it is phrased) is ignored,
    // so one match can never move a rating twice.
    h.frames.length = 0;
    await h.protocol.handleMessage("host-1", "resultClaim", {
      winnerId: "guest-2", loserId: "host-1", reason: "win", durationSec: 1,
    });
    expect(results(h)).toHaveLength(0);
  });

  it("DROPS a guest's claim — the guest does not run the simulation", async () => {
    const h = await liveMatch();
    await h.protocol.handleMessage("guest-2", "resultClaim", {
      winnerId: "guest-2", loserId: "host-1", reason: "win", durationSec: 60,
    });
    expect(results(h)).toHaveLength(0);
  });

  it("refuses a claim naming a non-member, a self-match, or an unknown reason", async () => {
    const h = await liveMatch();
    await h.protocol.handleMessage("host-1", "resultClaim", { winnerId: "ghost", loserId: "guest-2", reason: "win", durationSec: 5 });
    await h.protocol.handleMessage("host-1", "resultClaim", { winnerId: "host-1", loserId: "host-1", reason: "win", durationSec: 5 });
    await h.protocol.handleMessage("host-1", "resultClaim", { winnerId: "host-1", loserId: "guest-2", reason: "ragequit", durationSec: 5 });
    expect(results(h)).toHaveLength(0);
  });

  it("a LOBBY departure rates nothing — leaving before the match is not losing", async () => {
    const h = setup();
    await h.protocol.handleCreate();
    await join(h, "host-1", "Host");
    await join(h, "guest-2", "Guest");
    h.frames.length = 0;
    await leave(h, "guest-2");
    expect(results(h)).toHaveLength(0);
  });

  it("an explicit leave in a live match files it immediately: the leaver loses", async () => {
    const h = await liveMatch();
    await leave(h, "guest-2");
    const [filed] = results(h);
    expect(filed).toMatchObject({ winnerId: "host-1", loserId: "guest-2", reason: "forfeit", departedId: "guest-2" });
  });

  it("gives a DISCONNECT 30 s of grace, then files the forfeit", async () => {
    vi.useFakeTimers();
    try {
      const h = await liveMatch();
      await leave(h, "guest-2", "disconnect");
      // Not a departure yet — the seat may be coming back.
      expect(results(h)).toHaveLength(0);
      vi.advanceTimersByTime(FORFEIT_GRACE_MS - 1_000);
      expect(results(h)).toHaveLength(0);
      vi.advanceTimersByTime(1_000);
      expect(results(h)).toHaveLength(1);
      expect(results(h)[0]).toMatchObject({ winnerId: "host-1", loserId: "guest-2", reason: "forfeit" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the armed forfeit when the seat reconnects inside the window", async () => {
    vi.useFakeTimers();
    try {
      const h = await liveMatch();
      await leave(h, "guest-2", "disconnect");
      h.frames.length = 0;
      await join(h, "guest-2", "Guest");
      vi.advanceTimersByTime(FORFEIT_GRACE_MS * 3);
      expect(results(h)).toHaveLength(0);
      // …and the match is still rateable afterwards: the host can still claim.
      await h.protocol.handleMessage("host-1", "resultClaim", {
        winnerId: "host-1", loserId: "guest-2", reason: "win", durationSec: 300,
      });
      expect(results(h)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a host who abandons a live match HANDED the win to the guest", async () => {
    // Abandonment is symmetric: whoever walks away loses, host or guest. The
    // host-left reject and the result are two separate messages — the guest is
    // told the room is over AND told what it did to their rating.
    const h = await liveMatch();
    await leave(h, "host-1");
    const [filed] = results(h);
    expect(filed).toMatchObject({ winnerId: "guest-2", loserId: "host-1", reason: "forfeit", departedId: "host-1" });
  });

  it("disposing the room disarms an armed forfeit — no rating move after the room is gone", async () => {
    vi.useFakeTimers();
    try {
      const h = await liveMatch();
      await leave(h, "guest-2", "disconnect");
      await h.protocol.handleDispose();
      vi.advanceTimersByTime(FORFEIT_GRACE_MS * 3);
      expect(results(h)).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// #186 — the room as the holder of the match rules.
//
// The host CHOOSES the rules; the room HOLDS them, because the room is the only
// party every seat hears from. That is what makes "a guest sees the settings as
// soon as it joins" and "a late join receives the same settings" the same fact
// rather than two features: both are the welcome carrying what the host filed.
// And it is why a guest's claim is dropped rather than merged — one room, one
// set of rules, one authority.
// ══════════════════════════════════════════════════════════════════════════
describe("#186 the room's match settings", () => {
  const RULES = { aiSeats: [] as string[], winTarget: 5, startPurse: { wood: 24, stone: 24, ore: 0 } };

  function settingsFrames(h: Harness) {
    return h.frames.filter((f) => f.type === "settings").map((f) => messageOf(f));
  }

  it("relays the host's rules to everyone, normalised", async () => {
    const h = setup();
    await h.protocol.handleCreate();
    await join(h, "host-1", "Host");
    await join(h, "guest-2", "Guest");
    h.frames.length = 0;
    await h.protocol.handleMessage("host-1", "settingsClaim", { settings: RULES });
    const echoed = settingsFrames(h);
    // One echo, broadcast — it goes to the host too, so a lobby has exactly one
    // source for the rules it prints: the room's.
    expect(echoed).toHaveLength(1);
    expect(h.frames[0].target).toBe("broadcast");
    expect(echoed[0]).toEqual({ type: "settings", settings: RULES });
  });

  it("drops a guest's claim — the host is the only seat that may speak for the room", async () => {
    const h = setup();
    await h.protocol.handleCreate();
    await join(h, "host-1", "Host");
    await join(h, "guest-2", "Guest");
    h.frames.length = 0;
    await h.protocol.handleMessage("guest-2", "settingsClaim", { settings: RULES });
    expect(settingsFrames(h)).toHaveLength(0);
    // …and the room went on holding nothing, so the next welcome still carries
    // no rules and both seats play the defaults.
    h.frames.length = 0;
    await join(h, "late-3", "Late");
    const [w] = h.frames.filter((f) => f.type === "welcome").map((f) => messageOf(f) as WelcomeMsg);
    expect(w.settings).toBeUndefined();
  });

  it("drops a malformed claim rather than storing half a rule", async () => {
    const h = setup();
    await h.protocol.handleCreate();
    await join(h, "host-1", "Host");
    h.frames.length = 0;
    for (const bad of [{ winTarget: 900 }, { aiSeats: ["medium"] }, { startPurse: { wood: -4 } }, "rich"]) {
      await h.protocol.handleMessage("host-1", "settingsClaim", { settings: bad });
    }
    expect(settingsFrames(h)).toHaveLength(0);
  });

  it("carries the filed rules on every later welcome (late join, rejoin)", async () => {
    const h = setup();
    await h.protocol.handleCreate();
    await join(h, "host-1", "Host");
    await h.protocol.handleMessage("host-1", "settingsClaim", { settings: RULES });
    h.frames.length = 0;
    await join(h, "guest-2", "Guest");
    const greetings = h.frames.filter((f) => f.type === "welcome").map((f) => messageOf(f) as WelcomeMsg);
    expect(greetings.length).toBeGreaterThan(0);
    for (const greeting of greetings) {
      expect(greeting.settings).toEqual(RULES);
      // The client's own validator must accept the greeting the room built.
      expect(validateWelcome(greeting)).toBeNull();
    }
  });

  it("keeps a default-rules room's welcome free of a settings block", async () => {
    const h = setup();
    await h.protocol.handleCreate();
    await join(h, "host-1", "Host");
    const [w] = welcomes(h.frames);
    expect(w.settings).toBeUndefined();
  });

  it("locks the seat an AI is holding once the match goes live", async () => {
    // The host started early against a machine. `maxPlayers: 2` only locks on a
    // second HUMAN, so without this a joiner with the code would be seated into
    // a seat the host is already simulating — arriving mid-match as a passenger
    // in somebody else's game.
    const h = setup();
    await h.protocol.handleCreate();
    await join(h, "host-1", "Host");
    await h.protocol.handleMessage("host-1", "settingsClaim", {
      settings: { ...RULES, aiSeats: ["normal"] },
    });
    expect(h.room.locked).toBe(false);            // still a lobby: a human may take the seat
    h.frames.length = 0;
    await h.protocol.handleMessage("host-1", "snapshot", { snap: tinySnapshot() });
    expect(h.room.locked).toBe(true);
  });

  it("leaves an all-human room unlocked until its second seat fills", async () => {
    const h = setup();
    await h.protocol.handleCreate();
    await join(h, "host-1", "Host");
    await h.protocol.handleMessage("host-1", "settingsClaim", { settings: RULES });
    h.frames.length = 0;
    await h.protocol.handleMessage("host-1", "snapshot", { snap: tinySnapshot() });
    expect(h.room.locked).toBe(false);
  });
});
