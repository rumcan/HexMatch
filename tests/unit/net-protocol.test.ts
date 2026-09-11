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
  PROTOCOL_VERSION,
  FRAME_CAP_BYTES,
  HEX_MESSAGE_TYPES,
  VERSION_MISMATCH_MESSAGE,
  ProtocolError,
  validateWelcome,
  isHexProtocol,
  type DeltaMsg,
  type HexProtocol,
  type IntentMsg,
  type RejectMsg,
  type ResyncMsg,
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
  it("starts at 1 and is a positive integer", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });

  it("pins the frame cap at the RUN 16 KiB gateway limit (§1.3)", () => {
    expect(FRAME_CAP_BYTES).toBe(16 * 1024);
  });

  it("lists every discriminator in the union", () => {
    expect([...HEX_MESSAGE_TYPES].sort()).toEqual(
      ["delta", "intent", "reject", "resync", "snapshot", "welcome"],
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

  it("accepts all six discriminators", () => {
    for (const type of HEX_MESSAGE_TYPES) {
      expect(isHexProtocol({ type })).toBe(true);
    }
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
