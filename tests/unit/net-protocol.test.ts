// MP-02 — protocol unit tests: version refusal, wire round-trip, SDK isolation.
//
// These need no network and must run in CI (§11). They deliberately do NOT
// import `transport.ts`: that module loads the RUN SDK singleton, which needs
// a browser `window` (jsdom or real). Transport's helpers are covered in
// `net-transport.test.ts` (jsdom env); the SDK-isolation assertion below keeps
// the "only transport imports the SDK" rule green without loading it.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_SNAPSHOT_CHUNKS,
  PROTOCOL_VERSION,
  FRAME_CAP_BYTES,
  HEX_MESSAGE_TYPES,
  SNAPSHOT_CHUNK_CHARS,
  SnapshotAssembler,
  VERSION_MISMATCH_MESSAGE,
  ProtocolError,
  chunkSnapshot,
  validateWelcome,
  isHexProtocol,
  type DeltaMsg,
  type HexProtocol,
  type IntentMsg,
  type RejectMsg,
  type ResyncMsg,
  type SnapshotChunkMsg,
  type SnapshotMsg,
  type WelcomeMsg,
} from "../../src/net/protocol";
import { buildSnapshot, type SnapshotSource } from "../../src/iso/snapshot";
import { buildTile, createTrack } from "../../src/iso/track";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "../..");

function welcome(overrides: Partial<WelcomeMsg> = {}): WelcomeMsg {
  return {
    type: "welcome",
    seed: 123456,
    hostId: "host-1",
    protocolVersion: PROTOCOL_VERSION,
    roster: [
      { id: "host-1", username: "Host", slot: 0 },
      { id: "guest-2", username: "Guest", slot: 1 },
    ],
    ...overrides,
  };
}

function snapshotSource(): SnapshotSource {
  const track = createTrack();
  buildTile(track, "dirt", 5, 10, 1);
  buildTile(track, "road", 6, 10, 1);
  return {
    seed: 424242,
    track,
    harvesters: [{ id: 1, owner: "p1", ownerId: 1, tx: 6, ty: 11 }],
    factories: [{ owner: "p1", ownerId: 1, tx: 30, ty: 11 }],
    setupPhase: false,
    won: false,
    players: [{ id: "p1", vp: 1, res: { stone: 4 } }],
    t: 99,
  };
}

/** JSON round-trip, the way every message crosses the socket. */
function wire<T extends HexProtocol>(msg: T): T {
  return JSON.parse(JSON.stringify(msg)) as T;
}

describe("MP-02 protocol version", () => {
  it("is a positive integer, and 3 since PP-14b widened the wire", () => {
    // v2 (MP-05) added `snapshot-chunk`: a full state is ~110 KiB against a
    // 16 KiB frame, so join/resync state crosses as N frames. v3 (PP-14b)
    // added `rivalSabotage` (Black-Market sabotage on the guest-seat plant);
    // a v2 peer would drop that state, so mixed-version rooms must refuse.
    expect(PROTOCOL_VERSION).toBe(3);
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });

  it("pins the frame cap at the RUN 16 KiB gateway limit (§1.3)", () => {
    expect(FRAME_CAP_BYTES).toBe(16 * 1024);
  });

  it("lists every discriminator in the union", () => {
    expect([...HEX_MESSAGE_TYPES].sort()).toEqual(
      ["delta", "intent", "reject", "resync", "snapshot", "snapshot-chunk", "welcome"],
    );
  });
});

describe("MP-02 welcome validation (version refusal)", () => {
  it("accepts a well-formed welcome", () => {
    expect(validateWelcome(welcome())).toBeNull();
  });

  it("refuses a mismatched protocol version — never desyncs silently (§11)", () => {
    const err = validateWelcome(welcome({ protocolVersion: PROTOCOL_VERSION + 1 }));
    expect(err).toBeInstanceOf(ProtocolError);
    expect(err?.code).toBe("version");
    expect(err?.message).toBe(VERSION_MISMATCH_MESSAGE);
    expect(err?.message).toBe("This game has been updated — reload to play together");
  });

  it("refuses an old-version welcome the same way", () => {
    const err = validateWelcome(welcome({ protocolVersion: 0 }));
    expect(err?.code).toBe("version");
    expect(err?.message).toBe(VERSION_MISMATCH_MESSAGE);
  });

  it("rejects malformed welcomes without throwing", () => {
    const bad: unknown[] = [
      null,
      undefined,
      "welcome",
      42,
      {},
      { type: "snapshot" },
      { ...welcome(), protocolVersion: undefined },
      { ...welcome(), protocolVersion: "1" },
      { ...welcome(), seed: Number.NaN },
      { ...welcome(), seed: "123" },
      { ...welcome(), hostId: "" },
      { ...welcome(), hostId: 7 },
      { ...welcome(), roster: null },
      { ...welcome(), roster: [{ id: "x", username: "X", slot: 2 }] },
      { ...welcome(), roster: [{ id: "x", username: "X" }] },
      { ...welcome(), roster: [{ id: 1, username: "X", slot: 0 }] },
    ];
    for (const msg of bad) {
      const err = validateWelcome(msg);
      expect(err).toBeInstanceOf(ProtocolError);
      expect(err?.code).toBe("malformed");
    }
  });

  it("accepts edge-case welcomes: empty roster (host alone) and big seeds", () => {
    expect(validateWelcome(welcome({ roster: [] }))).toBeNull();
    expect(validateWelcome(welcome({ seed: 0x7fffffff }))).toBeNull();
  });
});

describe("MP-02 wire round-trip", () => {
  it("round-trips a welcome", () => {
    const msg = welcome();
    expect(wire(msg)).toEqual(msg);
    expect(isHexProtocol(wire(msg))).toBe(true);
  });

  it("round-trips a full snapshot message", () => {
    const msg: SnapshotMsg = { type: "snapshot", snap: buildSnapshot(snapshotSource()) };
    const back = wire(msg);
    expect(back).toEqual(msg);
    expect(back.snap.seed).toBe(424242);
    expect(isHexProtocol(back)).toBe(true);
  });

  it("round-trips a delta with every optional field present", () => {
    const snap = buildSnapshot(snapshotSource());
    const msg: DeltaMsg = {
      type: "delta",
      t: 1234,
      seq: 7,
      tiles: [
        { i: 100, dirt: 19, road: 0, owner: 1, upgraded: 0 },
        { i: 101, dirt: 0, road: 27, owner: 2, upgraded: 16 },
      ],
      harvesters: snap.harvesters,
      factories: snap.factories,
      players: snap.players,
      setupPhase: false,
      won: false,
    };
    expect(wire(msg)).toEqual(msg);
    expect(isHexProtocol(wire(msg))).toBe(true);
  });

  it("round-trips a minimal delta (heartbeat with no changes)", () => {
    const msg: DeltaMsg = { type: "delta", t: 0, seq: 0 };
    expect(wire(msg)).toEqual(msg);
  });

  it("round-trips every intent action", () => {
    const actions: IntentMsg["action"][] = ["build", "demolish", "harvest", "trade", "skill"];
    for (const action of actions) {
      const msg: IntentMsg = { type: "intent", action, payload: { tx: 3, ty: 4 } };
      expect(wire(msg)).toEqual(msg);
      expect(isHexProtocol(wire(msg))).toBe(true);
    }
  });

  it("round-trips resync and reject", () => {
    const resync: ResyncMsg = { type: "resync" };
    const reject: RejectMsg = { type: "reject", reason: "The host left the game." };
    expect(wire(resync)).toEqual(resync);
    expect(wire(reject)).toEqual(reject);
    expect(isHexProtocol(wire(resync))).toBe(true);
    expect(isHexProtocol(wire(reject))).toBe(true);
  });
});

describe("MP-02 isHexProtocol narrowing", () => {
  it("rejects non-messages", () => {
    const bad: unknown[] = [null, undefined, 0, "welcome", [], {}, { type: "move" }, { type: 7 }, { Type: "welcome" }];
    for (const msg of bad) expect(isHexProtocol(msg)).toBe(false);
  });

  it("accepts every discriminator in the union", () => {
    for (const type of HEX_MESSAGE_TYPES) {
      expect(isHexProtocol({ type })).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// MP-05 chunked full-state transfer
//
// §1.3: a whole snapshot is ~110 KiB and the frame cap is 16 KiB, and the
// gateway does not fragment — so join/resync state must cross as frames that
// provably fit. These are the pure helpers; the wire behaviour (a real host
// chunking to a real guest) is `net-session.test.ts`.
// ══════════════════════════════════════════════════════════════════════════

/** A saturated-ish snapshot: every layer carrying real bytes, not zeros. */
function fullSnapshot() {
  const track = createTrack();
  for (let x = 0; x < 60; x++) {
    buildTile(track, "dirt", x + 10, 40, 1);
    buildTile(track, "road", x + 10, 41, 2);
  }
  return buildSnapshot({
    seed: 2024,
    track,
    harvesters: [{ id: 1, owner: "you", ownerId: 1, tx: 12, ty: 40 }],
    factories: [{ owner: "ai", ownerId: 2, tx: 30, ty: 30, id: 1, townId: 3 }],
    setupPhase: false,
    won: false,
    players: [{ id: "you", vp: 3.25, res: { wood: 4, stone: 2 } }],
  });
}

describe("MP-05 chunked snapshot transfer", () => {
  it("cuts a whole snapshot into frames that each fit the frame cap", () => {
    const snap = fullSnapshot();
    const frames = chunkSnapshot(snap, 7, 1);
    expect(frames.length).toBeGreaterThan(1);              // it genuinely does not fit
    for (const f of frames) {
      expect(f.type).toBe("snapshot-chunk");
      expect(f.seq).toBe(7);
      expect(f.i).toBeLessThan(f.n);
      expect(f.data.length).toBeLessThanOrEqual(SNAPSHOT_CHUNK_CHARS);
      // The frame is the JSON the SDK puts on the socket; the cap is not a
      // guess, it is asserted on the serialized form.
      expect(JSON.stringify(f).length).toBeLessThanOrEqual(FRAME_CAP_BYTES);
    }
    expect(frames.map((f) => f.i)).toEqual([...frames.keys()]);
    expect(new Set(frames.map((f) => f.id))).toEqual(new Set([1]));
  });

  it("reassembles to the identical snapshot, sequence included", () => {
    const snap = fullSnapshot();
    const frames = chunkSnapshot(snap, 12, 3);
    const asm = new SnapshotAssembler();
    let out = null;
    for (const f of frames) out = asm.accept(JSON.parse(JSON.stringify(f))) ?? out;
    expect(out).not.toBeNull();
    expect(out!.seq).toBe(12);
    expect(out!.snap).toEqual(snap);
    expect(asm.pending).toBe(false);
  });

  it("survives frames arriving twice or out of order", () => {
    const snap = fullSnapshot();
    const frames = chunkSnapshot(snap, 1, 1);
    const asm = new SnapshotAssembler();
    const shuffled = [...frames].reverse();
    let out = null;
    for (const f of [...shuffled, ...frames, ...shuffled]) {
      out = asm.accept(f) ?? out;
      if (out) break;
    }
    // A duplicate index is not double-appended: the joined string parses to the
    // SAME snapshot rather than to a doubled one.
    expect(out!.snap).toEqual(snap);
  });

  it("abandons a half-received transfer when a newer id starts", () => {
    const snap = fullSnapshot();
    const first = chunkSnapshot(snap, 1, 1);
    const second = chunkSnapshot(snap, 9, 2);
    const asm = new SnapshotAssembler();
    expect(asm.accept(first[0])).toBeNull();
    expect(asm.pending).toBe(true);                        // half a world on hand…
    let out = null;
    for (const f of second) out = asm.accept(f) ?? out;
    expect(out).toEqual({ snap, seq: 9 });
    expect(asm.pending).toBe(false);
  });

  it("ignores malformed frames and never half-applies a corrupt transfer", () => {
    const snap = fullSnapshot();
    const frames = chunkSnapshot(snap, 1, 1);
    const asm = new SnapshotAssembler();
    const bad: unknown[] = [
      null, undefined, "chunk", [], { type: "delta" },
      { type: "snapshot-chunk", id: 1, seq: 1, i: 0, n: 0, data: "" },
      { type: "snapshot-chunk", id: 1, seq: 1, i: 2, n: 2, data: "x" },
      { type: "snapshot-chunk", id: 1, seq: 1, i: 0, n: 2, data: 42 },
      { type: "snapshot-chunk", id: 1, seq: 1, i: 0, n: MAX_SNAPSHOT_CHUNKS + 1, data: "x" },
      { type: "snapshot-chunk", id: 1, seq: 1, i: 0, n: 2, data: "x".repeat(SNAPSHOT_CHUNK_CHARS + 1) },
    ];
    for (const b of bad) expect(asm.accept(b)).toBeNull();
    // A transfer whose concatenation is not JSON yields null (a resync heals
    // it) instead of throwing mid-assembly.
    const junk: SnapshotChunkMsg = { type: "snapshot-chunk", id: 5, seq: 1, i: 0, n: 2, data: "{oops" };
    const junk2: SnapshotChunkMsg = { type: "snapshot-chunk", id: 5, seq: 1, i: 1, n: 2, data: "}" };
    expect(asm.accept(junk)).toBeNull();
    expect(asm.accept(junk2)).toBeNull();
    expect(asm.pending).toBe(false);
    // …and it still works after all that.
    let out = null;
    for (const f of frames) out = asm.accept(f) ?? out;
    expect(out!.snap).toEqual(snap);
  });

  it("is recognized as a protocol message", () => {
    expect(isHexProtocol({ type: "snapshot-chunk" })).toBe(true);
  });
});

describe("MP-02 SDK isolation", () => {
  const SDK = "@series-inc/rundot-game-sdk";

  function srcFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) srcFiles(p, out);
      else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
    }
    return out;
  }

  it("no file under src/ imports the SDK except transport.ts and HexmatchRoom.ts", () => {
    // `transport.ts` is the only CLIENT importer (§1.4: BETA drift is a
    // one-file fix). `HexmatchRoom.ts` is the deliberate exception — it runs
    // ON the server (`mp-server`), not in the game. `vite.config.ts` imports
    // the build plugin, but it lives outside `src/` by design.
    const importers = srcFiles(join(ROOT, "src"))
      .filter((f) => readFileSync(f, "utf8").includes(SDK))
      .map((f) => relative(ROOT, f).replace(/\\/g, "/"))
      .sort();
    expect(importers).toEqual(["src/net/transport.ts", "src/rooms/HexmatchRoom.ts"]);
  });

  it("protocol.ts stays SDK-free (both sides import it, including the server)", () => {
    const src = readFileSync(join(ROOT, "src/net/protocol.ts"), "utf8");
    expect(src).not.toContain(SDK);
    // …and value-free of game code: the Snapshot import must be type-only or
    // the server bundle would drag the whole sim in at runtime.
    expect(src).toMatch(/import\s+type\s*\{[^}]*Snapshot[^}]*\}/);
    expect(src).not.toMatch(/^import\s+\{[^}]*\}\s+from/m);
  });

  it("transport.ts really is the SDK seam (guard against a vacuous pass)", () => {
    const src = readFileSync(join(ROOT, "src/net/transport.ts"), "utf8");
    expect(src).toContain(`${SDK}/api`);
    expect(src).toContain(`${SDK}/mp-client`);
    expect(src).toContain("RundotGameAPI.realtime");
  });
});
