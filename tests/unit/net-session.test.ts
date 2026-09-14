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
  RESYNC_MIN_INTERVAL_MS,
  RESYNC_RETRY_MAX_MS,
  RESYNC_RETRY_MS,
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
  type ResultMsg,
  type WelcomeMsg,
} from "../../src/net/protocol";
import type { ConnectionState, HexRoom } from "../../src/net/transport";
import { DEFAULT_MATCH_SETTINGS, type MatchSettings } from "../../src/net/match-settings";
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
  leave(): void { this.leaveCount++; }
  /** How many times `leave()` was called — #121's "hands the room back". */
  leaveCount = 0;
  /** #121: the gateway's roster event, as `removePlayer` broadcasts it to the
   *  members still in the room. */
  firePlayerLeft(playerId: string): void {
    (this.events.onPlayerLeft as ((id: string) => void) | undefined)?.(playerId);
  }
  /** #131: the gateway's socket lifecycle events, as `transport.ts` forwards them. */
  fireReconnected(): void {
    (this.events.onReconnected as (() => void) | undefined)?.();
  }
  fireReconnecting(): void {
    (this.events.onReconnecting as (() => void) | undefined)?.();
  }
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

  it("#137: a seat's setup allowances travel with the seat, zero included", () => {
    const snap = hostWorld().snapshot();
    // The host's own record is exhausted; the guest's is partially spent.
    snap.players = [
      { ...snap.players[0], freeTrack: 0, freeDepots: 0 },
      { ...snap.players[1], freeTrack: 5, freeDepots: 1 },
    ];
    const mirrored = mirrorSnapshot(snap);
    // Slot order IS seat order, so the guest's OWN record lands first — with
    // its allowance intact, or `applyNetSnapshot` would restore the purse of a
    // seat that just happened to keep the allowances it booted with.
    expect(mirrored.players[0]).toMatchObject({ id: "ai", freeTrack: 5, freeDepots: 1 });
    // An exhausted allowance arrives as 0, never as "absent": the reader treats
    // an absent field as "nothing to restore".
    expect(mirrored.players[1]).toMatchObject({ id: "you", freeTrack: 0, freeDepots: 0 });
  });

  it("mirrors a delta's owner bytes, ids and list order the same way", () => {
    const msg: DeltaMsg = {
      type: "delta", t: 1, seq: 1,
      tiles: [{ i: 5, dirt: 16, road: 0, owner: 2, upgraded: 0 }],
      harvesters: [{ id: 1, owner: "ai", ownerId: 2, tx: 1, ty: 1 }],
      factories: [{ owner: "you", ownerId: 1, tx: 2, ty: 2, id: 0 }],
      players: [
        { id: "you", vp: 1, res: { wood: 1 }, freeTrack: 0, freeDepots: 0 },
        { id: "ai", vp: 2, res: { wood: 2 }, freeTrack: 5, freeDepots: 1 },
      ],
      notice: "hello",
    };
    const m = mirrorDelta(msg);
    expect(m.tiles![0].owner).toBe(1);
    expect(m.harvesters![0]).toEqual({ id: 1, owner: "you", ownerId: 1, tx: 1, ty: 1 });
    expect(m.factories![0]).toMatchObject({ owner: "ai", ownerId: 2 });
    expect(m.players!.map((p) => p.id)).toEqual(["ai", "you"]);
    // #137: the allowances swap with their seat exactly as the snapshot's do —
    // one wire shape, one reader, so the two paths cannot disagree.
    expect(m.players![0]).toMatchObject({ freeTrack: 5, freeDepots: 1 });
    expect(m.players![1]).toMatchObject({ freeTrack: 0, freeDepots: 0 });
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

  // ── #131: recovery the SESSION performs ─────────────────────────────────
  //
  // Everything below heals through production callbacks and the clock alone.
  // No test calls `requestResync` or `publishFullState` to finish the job: the
  // previous version of this suite did, which is how a guest that stalled for
  // good — suspect world, growing backlog, ask swallowed by the throttle —
  // stayed green. Drop the retry in `session.ts` and these fail.

  it("#131: a delta lost inside the throttle window heals by itself, to byte-identity", () => {
    vi.useFakeTimers();
    const { world, hostSession, track, applied, session } = liveMatch();
    hostTick(world, hostSession, () => world.build(50, 50, 1));   // delta 1
    expect(session.seq).toBe(1);
    expectGuestMatchesHost(world.track, track, "after delta 1");

    // Delta 2 is lost in transit; delta 3 arrives and says so. The gap lands
    // inside RESYNC_MIN_INTERVAL_MS of the attach's ask — the timing that used
    // to strand the guest, because a throttled ask was a dropped ask.
    guest.dropInbound = 1;
    hostTick(world, hostSession, () => world.build(51, 50, 1));   // delta 2 (lost)
    hostTick(world, hostSession, () => world.build(52, 50, 1));   // delta 3
    expect(session.awaitingState).toBe(true);                     // world suspect
    expect(session.backlog).toBe(1);                              // delta 3 held
    expect(guest.frames("resync").length).toBe(1);                // only attach asked
    expect(session.resyncPending).toBe(true);                     // …and a retry is armed

    // The clock is the only thing this test advances.
    vi.advanceTimersByTime(RESYNC_MIN_INTERVAL_MS);

    expect(session.awaitingState).toBe(false);
    expect(session.backlog).toBe(0);
    expectGuestMatchesHost(world.track, track, "after the automatic resync");
    expect(session.seq).toBe(3);
    // Exactly one extra ask: the throttled one, retried when the window opened.
    expect(guest.frames("resync").length).toBe(2);
    // The queued delta 3 is not re-applied on top of a snapshot that already
    // includes it: the seq guard held.
    expect(applied.filter((a) => a.kind === "delta").map((a) => a.seq)).toEqual([1]);
    // Recovered means the wait is over — no retry keeps knocking on a good world.
    expect(session.resyncPending).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(guest.frames("resync").length).toBe(2);
    session.dispose();
  });

  it("#131: keeps recovering while deltas keep arriving, and never storms the relay", () => {
    vi.useFakeTimers();
    const { world, hostSession, track, session } = liveMatch();
    // The FIRST delta is the one lost, so every later delta arrives at a guest
    // that is already suspect — the backlog grows while the retry is pending.
    guest.dropInbound = 1;
    const ticks = 12;
    for (let i = 0; i < ticks; i++) {
      vi.advanceTimersByTime(120);
      hostTick(world, hostSession, () => world.build(40 + i, 40, 1));
    }
    const elapsed = ticks * 120;
    // Healed without a hand on it, and in step with the host's last tick.
    expect(session.awaitingState).toBe(false);
    expect(session.backlog).toBe(0);
    expect(session.seq).toBe(ticks);
    expectGuestMatchesHost(world.track, track, "after a gap mid-stream");
    // Rate-limited: never more than one ask per throttle window, and at least
    // the one automatic re-ask that proves the retry exists.
    const asks = guest.frames("resync").length;
    expect(asks).toBeGreaterThan(1);
    expect(asks).toBeLessThanOrEqual(1 + Math.ceil(elapsed / RESYNC_MIN_INTERVAL_MS));
    session.dispose();
  });

  it("#131: an ask nobody answers is retried, backing off instead of hammering", () => {
    vi.useFakeTimers();
    const detached = new FakeClientRoom("guest-socket");          // no peer: nobody answers
    const { session } = guestHarness(detached);
    const asks = () => detached.frames("resync").length;
    expect(asks()).toBe(1);                                       // attach asked at t=0
    expect(session.awaitingState).toBe(true);
    expect(session.resyncPending).toBe(true);

    // The exact schedule: RESYNC_RETRY_MS doubling to RESYNC_RETRY_MAX_MS. One
    // ask per step, so a guest whose host has gone quiet costs the relay 1.25
    // asks/s at worst and 0.25/s once the backoff has run out — never a storm.
    for (const [at, total] of [
      [RESYNC_RETRY_MS, 2],
      [RESYNC_RETRY_MS * 2, 3],
      [RESYNC_RETRY_MS * 4, 4],
      [RESYNC_RETRY_MS * 8, 5],
      [RESYNC_RETRY_MAX_MS, 6],
    ] as const) {
      vi.advanceTimersByTime(at);
      expect(asks(), `after +${at}ms`).toBe(total);
    }

    expect(session.awaitingState).toBe(true);                     // still waiting, still armed
    expect(session.resyncPending).toBe(true);
    expect(session.backlog).toBe(0);
    session.dispose();
    expect(session.resyncPending).toBe(false);
    const settled = asks();
    vi.advanceTimersByTime(30_000);
    expect(asks()).toBe(settled);                                 // disposed means done
  });

  it("#131: a transfer that stops mid-way is restarted, not waited on forever", () => {
    vi.useFakeTimers();
    const world = hostWorld();
    const hostSession = new NetSession({ room: asRoom(host), role: "host" });
    hostSession.attach({ fullState: () => world.snapshot() });
    const detached = new FakeClientRoom("guest-socket");
    detached.onSend = (m) => hostSession.receive(m);              // asks reach the host
    const { session, track } = guestHarness(detached);
    const frames = host.frames("snapshot-chunk");
    session.receive(frames[0]);                                   // …then the link dies
    expect(session.awaitingState).toBe(true);

    vi.advanceTimersByTime(RESYNC_RETRY_MS + 50);

    expect(detached.frames("resync").length).toBe(2);             // asked again by itself
    const fresh = host.frames("snapshot-chunk").slice(frames.length);
    expect(fresh.length).toBeGreaterThan(2);
    expect(new Set(fresh.map((f) => f.id)).size).toBe(1);         // one NEW transfer id
    for (const f of fresh) session.receive(f);
    expect(session.awaitingState).toBe(false);
    expectGuestMatchesHost(world.track, track, "after a restarted transfer");
    session.dispose();
  });

  it("#131: a delta already applied is not divergence — duplicates never force a resync", () => {
    vi.useFakeTimers();
    const { world, hostSession, track, applied, session } = liveMatch();
    hostTick(world, hostSession, () => world.build(50, 50, 1));   // delta 1
    const asks = guest.frames("resync").length;
    const delta1 = guest.received("delta").at(-1)!;

    // The relay repeats a frame, and an old one overtakes the stream. Both are
    // noise, not a gap: the old code marked the world suspect and froze.
    session.receive(structuredClone(delta1));
    session.receive(structuredClone(delta1));
    session.receive({ ...structuredClone(delta1), seq: 0 });

    expect(session.awaitingState).toBe(false);
    expect(session.seq).toBe(1);
    expect(session.backlog).toBe(0);
    expect(guest.frames("resync").length).toBe(asks);             // no unnecessary resync
    expect(applied.filter((a) => a.kind === "delta").map((a) => a.seq)).toEqual([1]);
    expectGuestMatchesHost(world.track, track, "after duplicate frames");

    // …and the next real delta still lands, so nothing was knocked out of step.
    hostTick(world, hostSession, () => world.build(51, 50, 1));   // delta 2
    expect(session.seq).toBe(2);
    expect(session.awaitingState).toBe(false);
    expect(guest.frames("resync").length).toBe(asks);
    expectGuestMatchesHost(world.track, track, "after duplicates then delta 2");
    // The welcome's own throttled ask left a retry armed (that is #131's fix);
    // a guest with a good world is not awaiting state, so it stays silent.
    vi.advanceTimersByTime(5_000);
    expect(guest.frames("resync").length).toBe(asks);             // nothing sent for a healthy world
    session.dispose();
  });

  it("#131: dispose cancels the retry — a session that is gone asks for nothing", () => {
    vi.useFakeTimers();
    const { world, hostSession, session } = liveMatch();
    guest.dropInbound = 1;
    hostTick(world, hostSession, () => world.build(50, 50, 1));   // lost
    hostTick(world, hostSession, () => world.build(51, 50, 1));   // the gap
    expect(session.resyncPending).toBe(true);

    session.dispose();

    expect(session.resyncPending).toBe(false);
    const asks = guest.frames("resync").length;
    vi.advanceTimersByTime(10_000);
    expect(guest.frames("resync").length).toBe(asks);             // no timer outlived it
    expect(guest.leaveCount).toBe(1);
  });

  it("#131: a halt cancels the retry too — a refused room is not re-asked", () => {
    vi.useFakeTimers();
    const { world, hostSession, session } = liveMatch();
    guest.dropInbound = 1;
    hostTick(world, hostSession, () => world.build(50, 50, 1));   // lost
    hostTick(world, hostSession, () => world.build(51, 50, 1));   // the gap
    expect(session.resyncPending).toBe(true);

    session.halt("boom");

    expect(session.resyncPending).toBe(false);
    const asks = guest.frames("resync").length;
    vi.advanceTimersByTime(10_000);
    expect(guest.frames("resync").length).toBe(asks);
    expect(session.requestResync("after halt")).toBe(false);      // the API agrees
    session.dispose();
  });

  it("#131: the opponent leaving cancels the retry — #121's halt is final", () => {
    vi.useFakeTimers();
    const { world, hostSession, session } = liveMatch();
    guest.dropInbound = 1;
    hostTick(world, hostSession, () => world.build(50, 50, 1));   // lost
    hostTick(world, hostSession, () => world.build(51, 50, 1));   // the gap
    expect(session.resyncPending).toBe(true);

    guest.firePlayerLeft("host-socket");

    expect(session.resyncPending).toBe(false);
    const asks = guest.frames("resync").length;
    vi.advanceTimersByTime(10_000);
    expect(guest.frames("resync").length).toBe(asks);
    session.dispose();
  });

  /**
   * The explicit API, tested AS an API: what `requestResync` returns and what
   * the host does with the frame. This is deliberately not a recovery proof —
   * the tests above are, and they touch nothing but the clock. (This is the
   * old "recovers to byte-identity" test, re-scoped: it used to call both
   * halves of the recovery by hand and so proved neither.)
   */
  it("the explicit resync API: throttled to one ask per window, kept rather than dropped", () => {
    vi.useFakeTimers();
    const { session } = guestHarness(guest);                      // attach asked at t=0
    expect(guest.frames("resync").length).toBe(1);
    expect(session.requestResync("manual")).toBe(false);          // inside the window…
    expect(guest.frames("resync").length).toBe(1);                // …nothing sent…
    expect(session.resyncPending).toBe(true);                     // …but the ask is kept

    vi.advanceTimersByTime(RESYNC_MIN_INTERVAL_MS);
    expect(guest.frames("resync").length).toBe(2);                // one ask when it opened
    expect(session.requestResync("manual")).toBe(false);          // and the window is shut again
    session.dispose();
  });

  it("#131: a reconnect inside the throttle window still resyncs — the ask is owed, not dropped", () => {
    vi.useFakeTimers();
    const { world, hostSession, track, session } = liveMatch();
    hostTick(world, hostSession, () => world.build(50, 50, 1));   // delta 1 lands
    expect(session.seq).toBe(1);

    // The socket drops a tick's worth of world and comes back. Nothing on the
    // wire says so: the guest's seq still looks perfectly fine, which is why
    // the reconnect has to invalidate the world itself.
    guest.dropInbound = 1;
    hostTick(world, hostSession, () => world.build(51, 50, 1));   // delta 2, unheard
    guest.fireReconnecting();
    guest.fireReconnected();                                      // inside the window

    expect(session.awaitingState).toBe(true);                     // suspect, and owed an ask
    expect(session.resyncPending).toBe(true);
    const asks = guest.frames("resync").length;

    vi.advanceTimersByTime(RESYNC_MIN_INTERVAL_MS);

    expect(guest.frames("resync").length).toBe(asks + 1);         // it asked on its own
    expect(host.received("resync").length).toBe(asks + 1);        // and the host heard it
    expect(session.awaitingState).toBe(false);
    expect(session.seq).toBe(2);
    expectGuestMatchesHost(world.track, track, "after the reconnect resync");
    session.dispose();
    hostSession.dispose();
  });

  it("#131: a manual ask on a HEALTHY guest is not owed — the throttle still coalesces", () => {
    vi.useFakeTimers();
    const { world, hostSession, track, session } = liveMatch();
    hostTick(world, hostSession, () => world.build(50, 50, 1));
    expect(session.publishFullState("guests assert nothing")).toBe(false);
    const asks = guest.frames("resync").length;
    const chunks = guest.received("snapshot-chunk").length;

    // The welcome asks, attach already asked, and this asks again: all inside
    // one throttle window, all for a world the guest already has. One transfer
    // answered them and no retry re-asks for a guest that is not waiting —
    // that is the coalescing the throttle exists for.
    expect(session.requestResync("manual")).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(guest.frames("resync").length).toBe(asks);
    expect(guest.received("snapshot-chunk").length).toBe(chunks);
    expect(session.awaitingState).toBe(false);
    expectGuestMatchesHost(world.track, track, "an unchanged world");
    session.dispose();
    hostSession.dispose();
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

// ── #121: leaving the room ────────────────────────────────────────────────
//
// Two halves of the same report. `dispose()` used to clear local state and
// stop there — the socket stayed open, so a player who quit to the menu was
// still an occupied seat in a room they were no longer in. And a GUEST's
// departure was invisible: the relay only broadcasts when the HOST goes, so
// the host kept simulating against an empty seat. The gateway's own roster
// event covers both directions, which is why the wire needed no new message.
describe("#121 leaving a room", () => {
  it("hands the room back on dispose, and only once", () => {
    const session = new NetSession({ room: asRoom(host), role: "host" });
    session.attach({});
    expect(host.leaveCount).toBe(0);
    session.dispose();
    session.dispose();                       // a navigation can run cleanup twice
    expect(host.leaveCount).toBe(1);
  });

  it("drops its hooks before the socket closes, so teardown paints nothing", () => {
    const states: string[] = [];
    const session = new NetSession({ room: asRoom(host), role: "host" });
    session.attach({ status: (s) => states.push(s) });
    session.dispose();
    // Closing the socket is what fires this; a hook answered now would toast
    // over whatever the player navigated to.
    (host as unknown as { events: Record<string, () => void> }).events.onDisconnect?.();
    expect(states).toEqual([]);
  });

  it("tells the host the guest went — the direction the relay never broadcast", () => {
    const world = hostWorld();
    const left: (string | null)[] = [];
    const session = new NetSession({ room: asRoom(host), role: "host" });
    session.attach({ fullState: () => world.snapshot(), opponentLeft: (n) => left.push(n) });
    host.deliver(welcome(5));
    expect(session.hasOpponent).toBe(true);

    host.firePlayerLeft("guest-socket");
    expect(left).toEqual(["Bo"]);
    expect(session.hasOpponent).toBe(false);  // the roster is no longer a lie
    // And the match is over: nothing more is published into the empty room.
    const before = host.frames("delta").length + host.frames("snapshot-chunk").length;
    expect(session.publishTrack(world.track, dirtyTiles, {
      t: 0, harvesters: world.harvesters, factories: world.factories,
      players: world.players, setupPhase: false, won: false,
    })).toBe("idle");
    expect(host.frames("delta").length + host.frames("snapshot-chunk").length).toBe(before);
    session.dispose();
  });

  it("tells the guest the host went, and says who when the roster never arrived", () => {
    const left: (string | null)[] = [];
    const session = new NetSession({ room: asRoom(guest), role: "guest" });
    session.attach({ opponentLeft: (n) => left.push(n) });
    guest.firePlayerLeft("host-socket");
    expect(left).toEqual([null]);            // no welcome, so no name to give
    expect(session.awaitingState).toBe(true);
    session.dispose();
  });

  it("ignores the gateway echoing our own id back", () => {
    const left: (string | null)[] = [];
    const session = new NetSession({ room: asRoom(host), role: "host" });
    session.attach({ opponentLeft: (n) => left.push(n) });
    host.deliver(welcome(5));
    host.firePlayerLeft("host-socket");      // our own departure, not theirs
    expect(left).toEqual([]);
    expect(session.hasOpponent).toBe(true);
    session.dispose();
  });

  it("reports nobody twice — a second departure cannot fire on a halted session", () => {
    const left: (string | null)[] = [];
    const session = new NetSession({ room: asRoom(host), role: "host" });
    session.attach({ opponentLeft: (n) => left.push(n) });
    host.deliver(welcome(5));
    host.firePlayerLeft("guest-socket");
    host.firePlayerLeft("guest-socket");
    expect(left).toEqual(["Bo"]);
    session.dispose();
  });
});

// ── #164: presence, the park, and the resume ─────────────────────────────
//
// The kicked player's half of the report was a session that could not come
// back: `onPeerLeft` halted, and a halted session drops the welcome that
// re-seats a returner. So a departure now PARKS the session (peerGone) — the
// state flow stops, the verdicts and greetings still pass — and the room's
// re-greeting resumes it. The countdown half is `peerStatus`: the room's poll
// says "held" and "back", and the session turns that into hooks the game can
// print without guessing.
describe("#164 presence, park, resume", () => {
  it("counts a held seat down out loud — and starts the count once", () => {
    const away: [string | null, number][] = [];
    const session = new NetSession({ room: asRoom(host), role: "host" });
    session.attach({ opponentDisconnected: (n, g) => away.push([n, g]) });
    host.deliver(welcome(5));
    host.deliver({ type: "peerStatus", playerId: "guest-socket", status: "disconnected", graceMs: 45_000, username: "Bo" });
    expect(away).toEqual([["Bo", 45_000]]);
    expect(session.opponentAway).toBe(true);
    // The poll repeats itself while the socket stays down; the countdown is
    // one episode, not a strobe.
    host.deliver({ type: "peerStatus", playerId: "guest-socket", status: "disconnected", graceMs: 30_000 });
    expect(away).toHaveLength(1);
    // A held seat is not an empty one: the roster — and the match — stand.
    expect(session.hasOpponent).toBe(true);
    session.dispose();
  });

  it("falls back to the roster's name and to a 60 s window", () => {
    const away: [string | null, number][] = [];
    const session = new NetSession({ room: asRoom(host), role: "host" });
    session.attach({ opponentDisconnected: (n, g) => away.push([n, g]) });
    host.deliver(welcome(5));
    host.deliver({ type: "peerStatus", playerId: "guest-socket", status: "disconnected" });
    expect(away).toEqual([["Bo", 60_000]]);   // the roster knew the name
    session.dispose();
  });

  it("ignores this client's own presence", () => {
    const away: unknown[] = [];
    const session = new NetSession({ room: asRoom(host), role: "host" });
    session.attach({ opponentDisconnected: (n, g) => away.push([n, g]) });
    host.deliver(welcome(5));
    host.deliver({ type: "peerStatus", playerId: "host-socket", status: "disconnected", graceMs: 1_000 });
    expect(away).toEqual([]);
    expect(session.opponentAway).toBe(false);
    session.dispose();
  });

  it("ends the count when the seat comes back", () => {
    const back: (string | null)[] = [];
    const session = new NetSession({ room: asRoom(host), role: "host" });
    session.attach({ opponentReconnected: (n) => back.push(n) });
    host.deliver(welcome(5));
    host.deliver({ type: "peerStatus", playerId: "guest-socket", status: "disconnected", graceMs: 45_000 });
    host.deliver({ type: "peerStatus", playerId: "guest-socket", status: "reconnected", username: "Bo" });
    expect(back).toEqual(["Bo"]);
    expect(session.opponentAway).toBe(false);
    expect(session.hasOpponent).toBe(true);
    session.dispose();
  });

  it("parks the state flow when the seat truly empties — verdicts still pass", () => {
    const world = hostWorld();
    const session = new NetSession({ room: asRoom(host), role: "host" });
    session.attach({ fullState: () => world.snapshot() });
    host.deliver(welcome(5));
    host.firePlayerLeft("guest-socket");
    expect(session.opponentGone).toBe(true);
    expect(session.hasOpponent).toBe(false);
    const before = host.frames("delta").length + host.frames("snapshot-chunk").length;
    expect(session.publishTrack(world.track, dirtyTiles, {
      t: 0, harvesters: world.harvesters, factories: world.factories,
      players: world.players, setupPhase: false, won: false,
    })).toBe("idle");
    expect(host.frames("delta").length + host.frames("snapshot-chunk").length).toBe(before);
    session.dispose();
  });

  it("a parked guest drops world frames but hears the verdict", () => {
    const deltas: unknown[] = [];
    const results: ResultMsg[] = [];
    const session = new NetSession({ room: asRoom(guest), role: "guest" });
    session.attach({ delta: (m) => deltas.push(m), result: (m) => results.push(m) });
    guest.deliver(welcome(5));
    guest.firePlayerLeft("host-socket");
    guest.deliver({ type: "delta", t: 2, seq: 9 });
    expect(deltas).toEqual([]);                     // the world flow is parked
    const verdict: ResultMsg = {
      type: "result", winnerId: "guest-socket", loserId: "host-socket",
      reason: "forfeit", durationSec: 0, ratings: [], at: 1,
    };
    guest.deliver(verdict);
    expect(results).toEqual([verdict]);             // the rating always lands
    session.dispose();
  });

  it("resumes on the greeting that re-seats the opponent — the rejoin a halt used to drop", () => {
    vi.useFakeTimers();
    try {
      const world = hostWorld();
      const back: (string | null)[] = [];
      const session = new NetSession({ room: asRoom(host), role: "host" });
      session.attach({ fullState: () => world.snapshot(), opponentReconnected: (n) => back.push(n) });
      host.deliver(welcome(5));
      host.firePlayerLeft("guest-socket");
      expect(session.opponentGone).toBe(true);
      // A rejoin is seconds later, not the same millisecond — the clock moves
      // so the full-state duplicate throttle does not swallow the re-greeting.
      vi.advanceTimersByTime(5_000);
      host.sent.length = 0;

      // The room re-greeted everyone: the evicted seat is back (a fresh join
      // after the hold window, or the poll's re-greeting after a re-attach).
      host.deliver(welcome(5));
      expect(session.opponentGone).toBe(false);
      expect(back).toEqual(["Bo"]);
      // And the host did what it does at any seating: the world went to the
      // returner, whose page may have reloaded into an empty client.
      expect(host.frames("snapshot-chunk").length + host.frames("snapshot").length).toBeGreaterThan(0);
      // The flow works again.
      world.build(21, 20, 1);
      expect(session.publishTrack(world.track, dirtyTiles, {
        t: 1, harvesters: world.harvesters, factories: world.factories,
        players: world.players, setupPhase: false, won: false,
      })).not.toBe("idle");
      session.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a welcome that seats NOBODY keeps the session parked", () => {
    const back: (string | null)[] = [];
    const session = new NetSession({ room: asRoom(host), role: "host" });
    session.attach({ opponentReconnected: (n) => back.push(n) });
    host.deliver(welcome(5));
    host.firePlayerLeft("guest-socket");
    host.deliver(welcome(5, [{ id: "host-socket", username: "Ada", slot: 0 }]));
    expect(session.opponentGone).toBe(true);
    expect(back).toEqual([]);
    session.dispose();
  });

  it("says goodbye on dispose — the room frees the seat instead of holding it", () => {
    const session = new NetSession({ room: asRoom(host), role: "host" });
    session.attach({});
    session.dispose();
    expect(host.sent.some((m) => m.type === "abandon")).toBe(true);
    expect(host.leaveCount).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// RANK-01 (#147) — the rating board as this client sees it
//
// The room owns the board's authority (`net-room.test.ts`); the arithmetic is
// pure (`net-rank.test.ts`). This is the middle: what a session does with a
// welcome, with a `ratingUpdate`, with its own publish, and — the one that
// would be easy to get wrong — with a `result` that arrives on a session the
// peer-left halt has already stopped.
// ══════════════════════════════════════════════════════════════════════════
describe("RANK-01 the rating board on a session", () => {
  const hostRating = { id: "host-socket", rating: 1180, matches: 12 };
  const guestRating = { id: "guest-socket", rating: 1040, matches: 3 };

  it("takes the welcome's board as the room's whole truth", () => {
    const session = new NetSession({ room: asRoom(guest), role: "guest" });
    const seen: { board: Record<string, unknown>; raw: unknown[] }[] = [];
    session.attach({ ratings: (board, raw) => seen.push({ board, raw }) });
    guest.deliver({ ...welcome(5), ratings: [hostRating, guestRating] }, true);
    expect(session.ratings).toEqual([hostRating, guestRating]);
    // Keyed by player id, not by slot or seat index.
    expect(session.board["host-socket"]).toEqual({ rating: 1180, matches: 12 });
    expect(session.info?.ratings).toEqual([hostRating, guestRating]);
    expect(seen).toHaveLength(1);
    // A welcome with NO board (nobody has published yet) must not erase a
    // board this session already learned — the field is optional on the wire.
    guest.deliver(welcome(5));
    expect(session.ratings).toEqual([hostRating, guestRating]);
    session.dispose();
  });

  it("publishes its own rating with the session's join token, and adopts it locally", () => {
    const session = new NetSession({ room: asRoom(host), role: "host" });
    session.attach({});
    session.publishRating({ rating: 1180, matches: 12, wins: 7, losses: 5, season: "s1" });
    const [sent] = host.frames("playerRating");
    expect(sent).toMatchObject({ id: "host-socket", rating: 1180, matches: 12 });
    expect(sent.joinToken).toBe(session.joinToken);
    expect(sent.joinToken.length).toBeGreaterThan(8);
    // The lobby can print a number before the room echoes anything back.
    expect(session.board["host-socket"]).toEqual({ rating: 1180, matches: 12 });
    // A later publish (the rating moved) replaces the entry rather than
    // duplicating it, and carries the SAME token — the room's sticky rule.
    session.publishRating({ rating: 1196, matches: 13, wins: 8, losses: 5, season: "s1" });
    expect(host.frames("playerRating")).toHaveLength(2);
    expect(host.frames("playerRating")[1].joinToken).toBe(sent.joinToken);
    expect(session.ratings).toHaveLength(1);
    expect(session.board["host-socket"]).toEqual({ rating: 1196, matches: 13 });
    session.dispose();
  });

  it("folds a ratingUpdate and reports the opponent's published number", () => {
    const session = new NetSession({ room: asRoom(host), role: "host" });
    session.attach({});
    expect(session.opponentRating()).toBeNull();
    host.deliver({ type: "ratingUpdate", ratings: [guestRating] });
    expect(session.opponentRating()).toEqual(guestRating);
    expect(session.board["guest-socket"]).toEqual({ rating: 1040, matches: 3 });
    // A message that is not a board is ignored rather than wiping one.
    host.deliver({ type: "ratingUpdate", ratings: "nope" });
    expect(session.ratings).toEqual([guestRating]);
    session.dispose();
  });

  it("lets only the host file the verdict", () => {
    const hostSession = new NetSession({ room: asRoom(host), role: "host" });
    hostSession.attach({});
    expect(hostSession.claimResult("host-socket", "guest-socket", 300)).toBe(true);
    expect(host.frames("resultClaim")).toEqual([
      { type: "resultClaim", winnerId: "host-socket", loserId: "guest-socket", reason: "win", durationSec: 300 },
    ]);

    const guestSession = new NetSession({ room: asRoom(guest), role: "guest" });
    guestSession.attach({});
    expect(guestSession.claimResult("guest-socket", "host-socket", 300)).toBe(false);
    expect(guest.frames("resultClaim")).toEqual([]);
    hostSession.dispose();
    guestSession.dispose();
  });

  it("delivers the room's result even after the peer-left HALT — that is the forfeit case", () => {
    // The order a forfeit really happens in: the guest's seat empties, which
    // halts this session — and THEN the room files the result. A session that
    // refused to act after a halt would drop the rating of every abandoned
    // match on exactly the seat that has to file it.
    const session = new NetSession({ room: asRoom(host), role: "host" });
    const results: ResultMsg[] = [];
    session.attach({ result: (m) => results.push(m) });
    host.deliver(welcome(5));
    host.firePlayerLeft("guest-socket");
    const filed: ResultMsg = {
      type: "result",
      winnerId: "host-socket",
      loserId: "guest-socket",
      reason: "forfeit",
      durationSec: 0,
      ratings: [hostRating, guestRating],
      departedId: "guest-socket",
      at: 1_760_000_000_000,
    };
    host.deliver(filed);
    expect(results).toEqual([filed]);
    // …and the board the result carried is folded, so the arithmetic runs on
    // the numbers the result was filed against.
    expect(session.board["guest-socket"]).toEqual({ rating: 1040, matches: 3 });
    // Nothing else gets through a halted session (the deltas in flight stop).
    const before = session.appliedDeltas;
    host.deliver({ type: "delta", t: 9, seq: 99, tiles: [] });
    expect(session.appliedDeltas).toBe(before);
    session.dispose();
  });

  it("sends nothing once disposed — a rating cannot move the room after leaving", () => {
    const session = new NetSession({ room: asRoom(host), role: "host" });
    session.attach({});
    session.dispose();
    expect(session.publishRating({ rating: 1400, matches: 30, wins: 20, losses: 10, season: "s1" })).toBe(false);
    expect(host.frames("playerRating")).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// #186 — the room's match settings on a session.
//
// The session is where wire state survives the lobby → match handover, and the
// settings are exactly that: the game reads its ★ line and opening purse from
// `session.settings`, so a session that lost them would boot a match on the
// shipped rules while the other seat raced the room's.
// ══════════════════════════════════════════════════════════════════════════
describe("#186 the room's settings on a session", () => {
  const RULES: MatchSettings = {
    aiSeats: ["hard"],
    winTarget: 5,
    startPurse: { wood: 24, stone: 24, ore: 0 },
  };

  it("reads the defaults until the room says otherwise", () => {
    const session = new NetSession({ room: asRoom(host), role: "host" });
    session.attach({});
    expect(session.settings).toEqual(DEFAULT_MATCH_SETTINGS);
    session.dispose();
  });

  it("takes the rules a welcome carries, onto the info the game reads", () => {
    const session = new NetSession({ room: asRoom(guest), role: "guest" });
    session.attach({});
    guest.deliver({ ...welcome(5), settings: RULES }, true);
    expect(session.settings).toEqual(RULES);
    expect(session.info?.settings).toEqual(RULES);
    session.dispose();
  });

  it("files the host's rules as a claim, and folds the room's echo", () => {
    const session = new NetSession({ room: asRoom(host), role: "host" });
    const seen: MatchSettings[] = [];
    session.attach({ settings: (s) => seen.push(s) });
    expect(session.publishSettings(RULES)).toBe(true);
    expect(host.frames("settingsClaim")).toEqual([{ type: "settingsClaim", settings: RULES }]);
    // Nothing is applied optimistically: the echo is the only thing that moves
    // the session's copy, so a refused claim is visible rather than silent.
    expect(session.settings).toEqual(DEFAULT_MATCH_SETTINGS);
    host.deliver({ type: "settings", settings: RULES });
    expect(session.settings).toEqual(RULES);
    expect(seen).toEqual([RULES]);
    session.dispose();
  });

  it("does not file rules the room already holds, nor a guest's rules at all", () => {
    const session = new NetSession({ room: asRoom(host), role: "host" });
    session.attach({});
    host.deliver({ type: "settings", settings: RULES });
    expect(session.publishSettings({ ...RULES, startPurse: { ...RULES.startPurse } })).toBe(false);
    expect(host.frames("settingsClaim")).toHaveLength(0);
    const guestSession = new NetSession({ room: asRoom(guest), role: "guest" });
    guestSession.attach({});
    expect(guestSession.publishSettings(RULES)).toBe(false);
    expect(guest.frames("settingsClaim")).toHaveLength(0);
    session.dispose();
    guestSession.dispose();
  });

  it("keeps the last rules it was told when an echo is unreadable", () => {
    const session = new NetSession({ room: asRoom(guest), role: "guest" });
    session.attach({});
    guest.deliver({ ...welcome(5), settings: RULES }, true);
    guest.deliver({ type: "settings", settings: { winTarget: 900 } as unknown as MatchSettings });
    expect(session.settings).toEqual(RULES);
    session.dispose();
  });

  it("carries the room's rules across to a second welcome (rejoin)", () => {
    const session = new NetSession({ room: asRoom(guest), role: "guest" });
    session.attach({});
    guest.deliver({ ...welcome(5), settings: RULES }, true);
    // A later welcome (a seat joining) is not a reset of the rules.
    guest.deliver(welcome(5), true);
    expect(session.settings).toEqual(RULES);
    session.dispose();
  });
});
