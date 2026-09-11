// MP-02 — protocol round-trip, version refusal, and the transport seam.
//
// Two things are load-bearing here:
//
//   1. §11: a mixed-version room must REFUSE, never desync silently. The
//      message is the exact string the ticket specifies, because a player
//      cannot act on "version mismatch".
//   2. §1.4: the multiplayer API is BETA, so every SDK call must sit behind
//      `src/net/transport.ts`. That rule is enforced by a test rather than by
//      convention, because the failure mode of breaking it is a breaking SDK
//      change touching nine files during a jam.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  PROTOCOL_MISMATCH_MESSAGE,
  PROTOCOL_VERSION,
  isHostBound,
  isHostOnly,
  protocolMismatch,
  type DeltaMsg,
  type HexProtocol,
  type IntentMsg,
  type RejectMsg,
  type ResyncMsg,
  type SnapshotMsg,
  type WelcomeMsg,
} from "../../src/net/protocol";
import { SNAPSHOT_VERSION } from "../../src/iso/snapshot";

// ── version refusal (§11) ───────────────────────────────────────────────────
describe("protocol version refusal", () => {
  it("accepts a room on our version", () => {
    expect(protocolMismatch(PROTOCOL_VERSION)).toBeNull();
  });

  it("refuses a newer or older room with the message a player can act on", () => {
    expect(protocolMismatch(PROTOCOL_VERSION + 1)).toBe(PROTOCOL_MISMATCH_MESSAGE);
    expect(protocolMismatch(PROTOCOL_VERSION - 1)).toBe(PROTOCOL_MISMATCH_MESSAGE);
    expect(protocolMismatch(0)).toBe(PROTOCOL_MISMATCH_MESSAGE);
    expect(PROTOCOL_MISMATCH_MESSAGE).toBe("This game has been updated — reload to play together.");
  });

  it("refuses a welcome with no protocolVersion at all", () => {
    // A build that predates the check sends no version. Trusting it is exactly
    // the silent desync §11 forbids.
    expect(protocolMismatch(undefined)).toBe(PROTOCOL_MISMATCH_MESSAGE);
  });

  it("mirrors the snapshot's own version gate", () => {
    // SNAPSHOT_VERSION (9) and PROTOCOL_VERSION move together: the map a guest
    // regenerates and the wire it arrives on are one contract.
    expect(SNAPSHOT_VERSION).toBe(9);
    expect(typeof PROTOCOL_VERSION).toBe("number");
  });
});

// ── round-trip ──────────────────────────────────────────────────────────────
// The harness strips `type` off the wire and reattaches it on receipt
// (`broadcast(msg)` -> `{type, ...data}`, inbound -> `{...data, type}`). A
// member whose payload carried its own `type` field would be clobbered, so the
// round-trip below is a real constraint, not a formality.
const toWire = (msg: HexProtocol) => {
  const { type, ...data } = msg;
  return { type, data };
};
const fromWire = (wire: { type: string; data: Record<string, unknown> }): HexProtocol =>
  ({ ...wire.data, type: wire.type }) as HexProtocol;

const oneOfEach: HexProtocol[] = [
  {
    type: "welcome",
    seed: 1283971055,
    hostId: "torvin",
    protocolVersion: PROTOCOL_VERSION,
    roster: [
      { id: "torvin", username: "Torvin", slot: 0 },
      { id: "vex", username: "Vex", slot: 1 },
    ],
  } satisfies WelcomeMsg,
  {
    type: "snapshot",
    snap: { version: SNAPSHOT_VERSION, seed: 7, t: 0, setupPhase: true, won: false } as never,
  } satisfies SnapshotMsg,
  {
    type: "delta",
    t: 12,
    seq: 3,
    tiles: [{ i: 4211, dirt: 1, road: 0, owner: 1, upgraded: 0 }],
    setupPhase: false,
    won: false,
  } satisfies DeltaMsg,
  { type: "intent", action: "build", payload: { kind: "road", tx: 4, ty: 5 } } satisfies IntentMsg,
  { type: "resync" } satisfies ResyncMsg,
  { type: "reject", reason: "The host left the game." } satisfies RejectMsg,
];

describe("protocol round-trip", () => {
  it("survives the strip-type / reattach-type wire transform", () => {
    for (const msg of oneOfEach) {
      expect(fromWire(toWire(msg))).toEqual(msg);
    }
  });

  it("uses a distinct discriminator for every member, so a switch cannot fall through", () => {
    const types = oneOfEach.map((m) => m.type);
    expect(new Set(types).size).toBe(types.length);
    expect(types.sort()).toEqual(["delta", "intent", "reject", "resync", "snapshot", "welcome"]);
  });

  it("carries no payload field named `type` — the harness would overwrite it", () => {
    for (const msg of oneOfEach) {
      const { type: _type, ...data } = msg;
      expect(Object.keys(data)).not.toContain("type");
    }
  });
});

describe("routing predicates", () => {
  it("partitions the union: host-only state vs host-bound requests", () => {
    for (const msg of oneOfEach) {
      const hostOnly = isHostOnly(msg);
      const hostBound = isHostBound(msg);
      expect(hostOnly && hostBound).toBe(false);
      if (msg.type === "snapshot" || msg.type === "delta") expect(hostOnly).toBe(true);
      if (msg.type === "intent" || msg.type === "resync") expect(hostBound).toBe(true);
      if (msg.type === "welcome" || msg.type === "reject") {
        expect(hostOnly).toBe(false);
        expect(hostBound).toBe(false);
      }
    }
  });
});

// ── the transport seam (§1.4) ───────────────────────────────────────────────
const SRC = path.resolve(__dirname, "../../src");
const SDK = "@series-inc/rundot-game-sdk";

/** Every .ts/.tsx under src/, recursively. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const importersOfSdk = sources(SRC)
  .filter((file) => readFileSync(file, "utf8").includes(SDK))
  .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
  .sort();

describe("transport seam (§1.4)", () => {
  it("keeps every client-side SDK import inside src/net/transport.ts", () => {
    // src/rooms/** is the SERVER bundle: HexmatchRoom is a GameRoom subclass and
    // must import /mp-server. Client and server never share an SDK module.
    const clientSide = importersOfSdk.filter((f) => !f.startsWith("rooms/"));
    expect(clientSide).toEqual(["net/transport.ts"]);
  });

  it("and only the room class on the server side", () => {
    const serverSide = importersOfSdk.filter((f) => f.startsWith("rooms/"));
    expect(serverSide).toEqual(["rooms/HexmatchRoom.ts"]);
  });

  it("never reaches the deleted ws relay from src/ (§1.1)", () => {
    // A published game is sandboxed to a host allowlist: server/ is unreachable,
    // so nothing in src/ may reference it or its VITE_ROOM_SERVER address.
    const offenders = sources(SRC)
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        return text.includes("VITE_ROOM_SERVER") || /["']\.\.\/\.\.\/server\//.test(text)
          || text.includes("hexmatch.fly.dev");
      })
      .map((file) => path.relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it("is reached only by dynamic import(), so Play-vs-AI never downloads the SDK (§1.2)", () => {
    // Measured on this repo: adding a STATIC `import ... from "./net/transport"`
    // to App.tsx takes the client bundle from 352.97 kB (115.87 kB gzip) to
    // 666.35 kB (219.00 kB gzip) plus a 47.41 kB chunk — the whole RUN SDK, paid
    // by every player including the ones who only ever click "Play vs AI".
    // §1.2 makes that path the lowest-friction option, so the SDK is loaded on
    // demand: `await import("./net/transport")` from the button handler.
    const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");
    const staticImporters = sources(SRC)
      .filter((file) => /^[^]*?from\s+["'][^"']*net\/transport["']/m.test(readFileSync(file, "utf8")))
      .map(rel);
    expect(staticImporters).toEqual([]);
  });
});
