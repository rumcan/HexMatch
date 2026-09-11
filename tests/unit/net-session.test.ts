// MP-05 — session tests: roles, the seat mirror, chunked snapshot transfer,
// the sequence guard, and the host's publish decisions.
//
// These drive the REAL `NetSession` over an in-process room pair: a fake
// `ServerRoom` whose `send` hands the message to the peer, exactly as the relay
// does (the relay's own routing — including "a guest cannot forge state" — is
// pinned by `net-room.test.ts`). No network, no SDK, no browser: this runs in
// CI like every other unit suite.
//
// The headline test is the ticket's acceptance at the wire level: after a join
// and a long run of host mutations, the GUEST's track is byte-identical to the
// host's (owner bytes compared through the seat mirror, because that is the
// guest's frame of reference). `iso-mp.test.ts` proves the same thing through
// the real game.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MAX_PENDING_DELTAS,
  NetSession,
  mirrorDelta,
  mirrorOwnerByte,
  mirrorOwnerName,
  mirrorSnapshot,
  type NetHooks,
} from "../../src/net/session";
import {
  PROTOCOL_VERSION,
  VERSION_MISMATCH_MESSAGE,
  type DeltaMsg,
  type HexProtocol,
  type WelcomeMsg,
} from "../../src/net/protocol";
import type { ConnectionState, HexRoom } from "../../src/net/transport";
import { applyTrackDelta } from "../../src/net/delta";
import { base64ToBytes, buildSnapshot, type Snapshot } from "../../src/iso/snapshot";
import {
  buildTile,
  createTrack,
  dirtyTiles,
  demolishTile,
  type Track,
} from "../../src/iso/track";
import { MAP_W, mulberry32 } from "../../src/game/config";

// ── an in-process room pair ───────────────────────────────────────────────

/**
 * The slice of `ServerRoom<HexProtocol>` a session uses. `send` delivers to the
 * peer the way the gateway does: a broadcast/sendTo arrives at the other client
 * as `{ ...data, type: msgType }` — i.e. the same object, JSON-cloned.
 */
class FakeClientRoom {
  roomCode = "HX9KWR";
  connectionState: ConnectionState = "connected";
  latency = 4;
  isCreator = false;
  peer: FakeClientRoom | null = null;
  /** Inbound frames dropped in transit (the seq-gap test). */
  dropInbound = 0;
  /** Everything this client sent. */
  readonly sent: HexProtocol[] = [];
  /** Everything this client RECEIVED (the guest's end of a transfer). */
  readonly inbox: HexProtocol[] = [];
  private events: Record<string, unknown> = {};

  /** Optional tap on this client's outbox — how a test wires a detached guest
   *  to the host session without giving the pair a peer (nothing auto-arrives,
   *  so frames can be fed in by hand). */
  onSend: ((msg: HexProtocol) => void) | null = null;

  constructor(readonly playerId: string) {}

  on(events: Record<string, unknown>): void {
    this.events = { ...this.events, ...events };
  }
  send(msg: HexProtocol): void {
    this.sent.push(structuredClone(msg));
    this.peer?.deliver(structuredClone(msg), false);
    this.onSend?.(structuredClone(msg));
  }
  /** Hand a message to this client. `targeted` picks the sendTo channel — the
   *  room greets the newcomer on BOTH (see `HexmatchRoom`). */
  deliver(msg: HexProtocol, targeted = false): void {
    if (this.dropInbound > 0) { this.dropInbound--; return; }
    this.inbox.push(structuredClone(msg));
    const fn = (targeted ? this.events.onPrivateMessage : this.events.onMessage) as
      | ((m: HexProtocol) => void)
      | undefined;
    fn?.(msg);
  }
  leave(): void {}
  /** This client's OUTBOX, filtered to one message type. */
  frames<T extends HexProtocol["type"]>(type: T): Extract<HexProtocol, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<HexProtocol, { type: T }>[];
  }
  /** This client's INBOX, filtered to one message type. */
  received<T extends HexProtocol["type"]>(type: T): Extract<HexProtocol, { type: T }>[] {
    return this.inbox.filter((m) => m.type === type) as Extract<HexProtocol, { type: T }>[];
  }
}

const asRoom = (r: FakeClientRoom): HexRoom => r as unknown as HexRoom;

function pair(): { host: FakeClientRoom; guest: FakeClientRoom } {
  const host = new FakeClientRoom("host-socket");
  const guest = new FakeClientRoom("guest-socket");
  host.peer = guest;
  guest.peer = host;
  return { host, guest };
}

const ROSTER: WelcomeMsg["roster"] = [
  { id: "host-socket", username: "Ada", slot: 0 },
  { id: "guest-socket", username: "Bo", slot: 1 },
];

function welcome(seed: number, roster = ROSTER, hostId = "host-socket"): WelcomeMsg {
  return { type: "welcome", seed, hostId, protocolVersion: PROTOCOL_VERSION, roster };
}

// ── a stand-in host "game": a track, lists, and the real journal ──────────

interface HostWorld {
  track: Track;
  harvesters: { id: number; owner: string; ownerId: number; tx: number; ty: number }[];
  factories: { owner: string; ownerId: number; tx: number; ty: number; id?: number; townId?: number | null }[];
  players: { id: string; vp: number; res: Record<string, number>; freeTrack: number; freeDepots: number }[];
  snapshot(): Snapshot;
  /** Build one tile through the real choke point (journals it, as in-game). */
  build(x: number, y: number, ownerId: number): void;
}

function hostWorld(seed = 4242): HostWorld {
  const track = createTrack();
  const harvesters = [{ id: 1, owner: "you", ownerId: 1, tx: 20, ty: 20 }];
  const factories = [{ owner: "you", ownerId: 1, tx: 40, ty: 40, id: 0, townId: 1 }];
  const players = [
    { id: "you", vp: 0, res: { wood: 8, stone: 5 }, freeTrack: 9, freeDepots: 0 },
    { id: "ai", vp: 0, res: { wood: 3, stone: 3 }, freeTrack: 12, freeDepots: 1 },
  ];
  return {
    track, harvesters, factories, players,
    snapshot: () => buildSnapshot({
      seed, track, harvesters, factories, setupPhase: false, won: false,
      players: players.map((p) => ({ id: p.id, vp: p.vp, res: { ...p.res } })),
    }),
    build: (x, y, ownerId) => { buildTile(track, "dirt", x, y, ownerId); },
  };
}

/** What the guest should hold: the host's layers with owner bytes mirrored. */
function mirroredOwner(track: Track): Uint8Array {
  const out = new Uint8Array(track.owner);
  for (let i = 0; i < out.length; i++) out[i] = mirrorOwnerByte(out[i]);
  return out;
}

function expectGuestMatchesHost(hostTrack: Track, guestTrack: Track, ctx: string): void {
  expect(new Uint8Array(guestTrack.dirt), `${ctx}: dirt`).toEqual(new Uint8Array(hostTrack.dirt));
  expect(new Uint8Array(guestTrack.road), `${ctx}: road`).toEqual(new Uint8Array(hostTrack.road));
  expect(new Uint8Array(guestTrack.upgraded), `${ctx}: upgraded`).toEqual(new Uint8Array(hostTrack.upgraded));
  expect(new Uint8Array(guestTrack.owner), `${ctx}: owner (mirrored)`).toEqual(mirroredOwner(hostTrack));
}

/** The guest end of a session, applying state into its own track — the shape
 *  the game's hooks have, minus the rendering. */
function guestHarness(room: FakeClientRoom) {
  const session = new NetSession({ room: asRoom(room), role: "guest" });
  const track = createTrack();
  const applied: { seq: number; kind: "snapshot" | "delta"; notice?: string }[] = [];
  const hooks: NetHooks = {
    snapshot: (snap: Snapshot, seq: number) => {
      track.dirt.set(base64ToBytes(snap.dirt));
      track.road.set(base64ToBytes(snap.road));
      track.owner.set(base64ToBytes(snap.owner));
      track.upgraded.set(base64ToBytes(snap.upgraded));
      applied.push({ seq, kind: "snapshot" });
    },
    delta: (msg) => {
      applyTrackDelta(track, msg.tiles);
      applied.push({ seq: msg.seq, kind: "delta", notice: msg.notice });
    },
  };
  session.attach(hooks);
  return { session, track, applied, hooks };
}

/** One host heartbeat: mutate, then publish whatever it produced. */
function hostTick(world: HostWorld, hostSession: NetSession, mutate?: () => void) {
  mutate?.();
  return hostSession.publishTrack(world.track, dirtyTiles, {
    t: 0,
    harvesters: world.harvesters,
    factories: world.factories,
    players: world.players,
    setupPhase: false,
    won: false,
  });
}

// ── the tests ─────────────────────────────────────────────────────────────

let host: FakeClientRoom, guest: FakeClientRoom;
beforeEach(() => {
  dirtyTiles.clear();
  ({ host, guest } = pair());
});
afterEach(() => {
  dirtyTiles.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * A joined pair: the host's session is live, the guest attaches (which asks for
 * full state), and the room greets both. Returns the two ends.
 */
function liveMatch(seed = 4242) {
  const world = hostWorld(seed);
  const hostSession = new NetSession({ room: asRoom(host), role: "host" });
  hostSession.attach({ fullState: () => world.snapshot() });
  const guestEnd = guestHarness(guest);          // attach → resync → transfer
  host.deliver(welcome(seed));
  guest.deliver(welcome(seed), true);
  return { world, hostSession, ...guestEnd };
}

describe("MP-05 roles, roster and connection", () => {
  it("a guest asks for full state as soon as its game attaches", () => {
    const { session } = guestHarness(guest);
    expect(guest.frames("resync").length).toBe(1);
    expect(session.awaitingState).toBe(true);
    session.dispose();
  });

  it("reads its role from the room's roster, not the start screen's guess", () => {
    const session = new NetSession({ room: asRoom(guest), role: "host" });
    const seen: string[] = [];
    session.attach({ info: (i) => seen.push(i.role) });
    guest.deliver(welcome(7), true);
    expect(session.role).toBe("guest");
    expect(session.isGuest).toBe(true);
    expect(seen).toEqual(["guest"]);
    expect(session.info?.seed).toBe(7);
    expect(session.info?.selfId).toBe("guest-socket");
    expect(session.roomCode).toBe("HX9KWR");
    expect(session.hasOpponent).toBe(true);
    session.dispose();
  });

  it("falls back to hostId when the roster does not list it (seated late)", () => {
    const session = new NetSession({ room: asRoom(host), role: "guest" });
    session.attach({});
    host.deliver(welcome(9, [{ id: "host-socket", username: "Ada", slot: 0 }]));
    expect(session.isHost).toBe(true);
    session.dispose();
  });

  it("refuses a mixed-version welcome with the reload line, never a silent desync (§11)", () => {
    const session = new NetSession({ room: asRoom(guest), role: "guest" });
    const rejects: string[] = [];
    session.attach({ reject: (r) => rejects.push(r) });
    // A peer still speaking the v1 wire has no chunked transfer, so its state
    // can never cross the frame cap — refusing IS the fix (§11).
    guest.deliver({ ...welcome(1), protocolVersion: PROTOCOL_VERSION + 1 });
    expect(rejects).toEqual([VERSION_MISMATCH_MESSAGE]);
    expect(rejects[0]).toBe("This game has been updated — reload to play together");
    // A halted session stops acting on the room entirely.
    const before = guest.frames("resync").length;
    guest.deliver(welcome(1));
    expect(guest.frames("resync").length).toBe(before);
    session.dispose();
  });
});

describe("MP-05 the seat mirror", () => {
  it("maps the wire's seats onto the local ones for a guest", () => {
    expect(mirrorOwnerByte(1)).toBe(2);
    expect(mirrorOwnerByte(2)).toBe(1);
    expect(mirrorOwnerByte(0)).toBe(0);
    expect(mirrorOwnerByte(3)).toBe(3);          // PUBLIC_OWNER is nobody's seat
    expect(mirrorOwnerName("you")).toBe("ai");
    expect(mirrorOwnerName("ai")).toBe("you");
    expect(mirrorOwnerName("PUBLIC")).toBe("PUBLIC");

    const w = hostWorld();
    w.build(3, 3, 1);                            // a host tile…
    w.build(4, 3, 2);                            // …and a guest tile
    const mirrored = mirrorSnapshot(w.snapshot());
    const m = base64ToBytes(mirrored.owner);
    expect(m[3 * MAP_W + 3]).toBe(2);            // the host's reads as the rival's
    expect(m[3 * MAP_W + 4]).toBe(1);            // the guest's own reads as mine
    // The player list swaps with the seats, so `players[0]` is still "me".
    expect(mirrored.players.map((p) => p.id)).toEqual(["ai", "you"]);
  });

  it("mirrors a delta's owner bytes, ids and list order the same way", () => {
    const msg: DeltaMsg = {
      type: "delta", t: 1, seq: 1,
      tiles: [{ i: 5, dirt: 16, road: 0, owner: 2, upgraded: 0 }],
      harvesters: [{ id: 1, owner: "ai", ownerId: 2, tx: 1, ty: 1 }],
      factories: [{ owner: "you", ownerId: 1, tx: 2, ty: 2, id: 0 }],
      players: [{ id: "you", vp: 1, res: { wood: 1 } }, { id: "ai", vp: 2, res: { wood: 2 } }],
      notice: "hello",
    };
    const m = mirrorDelta(msg);
    expect(m.tiles![0].owner).toBe(1);
    expect(m.harvesters![0]).toEqual({ id: 1, owner: "you", ownerId: 1, tx: 1, ty: 1 });
    expect(m.factories![0]).toMatchObject({ owner: "ai", ownerId: 2 });
    expect(m.players!.map((p) => p.id)).toEqual(["ai", "you"]);
    expect(m.notice).toBe("hello");              // a notice is not seat-scoped
  });
});

describe("MP-05 the guest's world is the host's world", () => {
  it("chunks a join snapshot, reassembles it, and matches byte for byte", () => {
    const { world, track, applied } = liveMatch();
    const frames = guest.received("snapshot-chunk");
    expect(frames.length).toBeGreaterThan(1);            // a whole snapshot never fits one frame
    expect(frames.every((f) => f.seq === 0)).toBe(true); // …and it represents seq 0
    expect(new Set(frames.map((f) => f.id)).size).toBe(1);
    expect(applied).toEqual([{ seq: 0, kind: "snapshot" }]);
    expectGuestMatchesHost(world.track, track, "after join");
  });

  it("keeps the guest in step through a randomised run of host mutations", () => {
    const { world, hostSession, track, applied } = liveMatch();
    const rand = mulberry32(99);
    for (let step = 0; step < 240; step++) {
      const x = 30 + Math.floor(rand() * 40);
      const y = 10 + Math.floor(rand() * 40);
      const decision = hostTick(world, hostSession, () => {
        if (rand() < 0.2) demolishTile(world.track, "dirt", x, y);
        else world.build(x, y, rand() < 0.5 ? 1 : 2);
      });
      expect(decision).toBe("delta");                    // a single action never bursts
    }
    expect(guest.received("delta").length).toBe(240);
    expect(hostSession.seq).toBe(240);
    expect(applied[applied.length - 1].seq).toBe(240);
    expectGuestMatchesHost(world.track, track, "after 240 deltas");
  });

  it("flips to a chunked snapshot when a delta would be too large (§5)", () => {
    const { world, hostSession } = liveMatch();
    // A burst: more than the per-delta tile cap, all journalled at once.
    for (let i = 0; i < 260; i++) world.build(5 + (i % 60), 5 + Math.floor(i / 60), 1);
    expect(hostTick(world, hostSession)).toBe("snapshot");
    // …and the guest received it as frames, not as one oversized message.
    for (const f of guest.received("snapshot-chunk")) {
      expect(JSON.stringify(f).length).toBeLessThan(16 * 1024);
    }
  });

  it("carries a refused-intent notice on the next delta, once", () => {
    const { world, hostSession, applied } = liveMatch();
    hostSession.setNotice("A Depot costs 1 🛢️ Oil — you need 1 🛢️ Oil.");
    hostTick(world, hostSession, () => world.build(12, 12, 1));
    expect(applied[applied.length - 1].notice).toContain("Oil");
    hostTick(world, hostSession, () => world.build(13, 12, 1));
    expect(applied[applied.length - 1].notice).toBeUndefined();
    expect(hostSession.notice).toBeNull();
  });
});

describe("MP-05 the sequence guard", () => {
  it("buffers deltas while full state is in flight, then replays them in order", () => {
    // A DETACHED guest: the host's frames are fed by hand, so a delta can land
    // between chunk 0 and the rest — the case the buffer exists for. (A real
    // transfer is sent in one synchronous burst, but a resync that follows an
    // in-flight delta, or a reconnect, both produce exactly this interleaving.)
    const world = hostWorld();
    const hostSession = new NetSession({ room: asRoom(host), role: "host" });
    hostSession.attach({ fullState: () => world.snapshot() });
    const detached = new FakeClientRoom("guest-socket");    // no peer: nothing auto-arrives
    // The guest's ask goes to the host session directly; the host's frames stay
    // in `host.sent` for the test to deliver one at a time.
    detached.onSend = (m) => hostSession.receive(m);
    const { session, track, applied } = guestHarness(detached);
    const frames = host.frames("snapshot-chunk");
    expect(frames.length).toBeGreaterThan(2);

    session.receive(frames[0]);                            // half a world…
    hostTick(world, hostSession, () => world.build(60, 60, 1));
    session.receive(host.frames("delta")[0]);              // …and a delta for it
    expect(applied.length).toBe(0);                        // nothing applied yet
    expect(session.backlog).toBe(1);
    for (const f of frames.slice(1)) session.receive(f);
    // Snapshot first, then the queued delta: the order that composes.
    expect(applied.map((a) => a.kind)).toEqual(["snapshot", "delta"]);
    expectGuestMatchesHost(world.track, track, "after buffered delta");
    session.dispose();
  });

  it("asks for a resync on a seq gap and recovers to byte-identity", () => {
    vi.useFakeTimers();
    const { world, hostSession, track, applied, session } = liveMatch();
    hostTick(world, hostSession, () => world.build(50, 50, 1));   // delta 1
    expect(session.seq).toBe(1);
    expectGuestMatchesHost(world.track, track, "after delta 1");

    // Delta 2 is lost in transit; delta 3 arrives and says so.
    guest.dropInbound = 1;
    hostTick(world, hostSession, () => world.build(51, 50, 1));   // delta 2 (lost)
    hostTick(world, hostSession, () => world.build(52, 50, 1));   // delta 3
    // 3 was held, not applied, and the world is marked suspect.
    expect(session.awaitingState).toBe(true);
    expect(session.backlog).toBeGreaterThan(0);
    // The ask respects its throttle (attach's ask was moments ago)…
    vi.advanceTimersByTime(1_000);
    expect(session.requestResync("gap")).toBe(true);
    expect(guest.frames("resync").length).toBeGreaterThan(1);
    // …and the host's answer makes the guest whole again.
    hostSession.publishFullState("resync");
    expectGuestMatchesHost(world.track, track, "after resync");
    expect(session.awaitingState).toBe(false);
    expect(session.seq).toBe(3);
    // The queued delta 3 is not re-applied on top of a snapshot that already
    // includes it: the seq guard held.
    expect(applied.filter((a) => a.kind === "delta").map((a) => a.seq)).toEqual([1]);
  });

  it("gives up on an unbounded backlog instead of applying a stale queue", () => {
    const world = hostWorld();
    const hostSession = new NetSession({ room: asRoom(host), role: "host" });
    hostSession.attach({ fullState: () => world.snapshot() });
    const detached = new FakeClientRoom("guest-socket");
    detached.onSend = (m) => hostSession.receive(m);
    const { session } = guestHarness(detached);
    const frames = host.frames("snapshot-chunk");
    session.receive(frames[0]);                              // a transfer that stalls
    for (let i = 0; i < MAX_PENDING_DELTAS + 5; i++) {
      hostTick(world, hostSession, () => world.build(2 + (i % 50), 2 + Math.floor(i / 50), 1));
      session.receive(host.frames("delta")[i]);
    }
    expect(session.backlog).toBeLessThanOrEqual(MAX_PENDING_DELTAS);
    expect(session.awaitingState).toBe(true);
    session.dispose();
  });

  it("takes state from the right direction only", () => {
    const hostSession = new NetSession({ room: asRoom(host), role: "host" });
    const intents: unknown[] = [];
    hostSession.attach({ intent: (m) => intents.push(m) });
    host.deliver({ type: "delta", t: 0, seq: 1 });            // a host consumes no deltas
    expect(hostSession.seq).toBe(0);
    host.deliver({ type: "intent", action: "build", payload: { do: "depot", tx: 1, ty: 1 } });
    expect(intents.length).toBe(1);
    hostSession.dispose();

    // …and a guest never answers a resync (that is a host's job).
    const { session, applied } = guestHarness(guest);
    const before = applied.length;
    guest.deliver({ type: "resync" });
    expect(applied.length).toBe(before);
    session.dispose();
  });
});

describe("MP-05 host publishing rules", () => {
  it("a guest sends intents and publishes nothing", () => {
    const { session } = guestHarness(guest);
    expect(session.sendIntent("build", { do: "depot", tx: 3, ty: 3 })).toBe(true);
    expect(guest.frames("intent")[0]).toMatchObject({
      action: "build", payload: { do: "depot", tx: 3, ty: 3 },
    });
    expect(hostTick(hostWorld(), session)).toBe("idle");     // wrong role: inert, not an error
    expect(session.publishFullState("nope")).toBe(false);
    session.dispose();
  });

  it("throttles duplicate full-state publishes (welcome + resync are one event)", () => {
    const world = hostWorld();
    const session = new NetSession({ room: asRoom(host), role: "host" });
    session.attach({ fullState: () => world.snapshot() });
    expect(session.publishFullState("welcome")).toBe(true);
    const frames = host.frames("snapshot-chunk").length;
    expect(session.publishFullState("resync")).toBe(false);
    expect(host.frames("snapshot-chunk").length).toBe(frames);
    session.dispose();
  });

  it("says so when it has no state to build (fullState missing)", () => {
    const session = new NetSession({ room: asRoom(host), role: "host" });
    session.attach({});
    expect(session.publishFullState("nobody home")).toBe(false);
    session.dispose();
  });

  it("mints a fresh transfer id per transfer, so a resync cannot mix halves", () => {
    vi.useFakeTimers();
    const world = hostWorld();
    const session = new NetSession({ room: asRoom(host), role: "host" });
    session.attach({ fullState: () => world.snapshot() });
    session.publishFullState("one");
    vi.advanceTimersByTime(1_000);
    session.publishFullState("two");
    const ids = new Set(guest.received("snapshot-chunk").map((f) => f.id));
    expect(ids.size).toBe(2);
    session.dispose();
  });
});

describe("MP-05 an intent and its result, over the pair", () => {
  it("carries a guest action to the host, and the host's answer back", () => {
    const hostRoom = new FakeClientRoom("host-socket");
    const guestRoom = new FakeClientRoom("guest-socket");
    hostRoom.peer = guestRoom; guestRoom.peer = hostRoom;
    const world = hostWorld();
    const received: string[] = [];
    const h = new NetSession({ room: asRoom(hostRoom), role: "host" });
    h.attach({
      fullState: () => world.snapshot(),
      // What `applyGuestIntent` does in game.ts: run the SEAT's action through
      // the same rules, then publish immediately (the guest is waiting).
      intent: (msg) => {
        received.push(msg.action);
        const p = msg.payload as { tx: number; ty: number };
        buildTile(world.track, "dirt", p.tx, p.ty, 2);      // the guest's seat = ownerId 2
        h.publishTrack(world.track, dirtyTiles, {
          t: 0, harvesters: world.harvesters, factories: world.factories,
          players: world.players, setupPhase: false, won: false,
        });
      },
    });
    const g = new NetSession({ room: asRoom(guestRoom), role: "guest" });
    const got: DeltaMsg[] = [];
    g.attach({ delta: (m) => got.push(m) });
    g.sendIntent("build", { do: "depot", tx: 9, ty: 9 });

    expect(received).toEqual(["build"]);
    expect(got.length).toBe(1);
    // The tile arrives at the GUEST as its own (owner byte 1 after the mirror).
    expect(got[0].tiles).toContainEqual({ i: 9 * MAP_W + 9, dirt: 16, road: 0, owner: 1, upgraded: 0 });
    h.dispose();
    g.dispose();
  });
});
