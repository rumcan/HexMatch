// @vitest-environment jsdom
//
// MP-02 — transport helper tests.
//
// Runs in jsdom because `transport.ts` loads the RUN SDK singleton, which
// needs a browser `window` at construction. No test here touches the network:
// room lifecycle (`createRoom`, `joinRoomByCode`, `quickMatch`, …) needs a
// signed-in identity and a live room server, so it is covered by local
// two-client play (MP-03+) and the e2e suite — not by unit tests (§11).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AccessDeniedError } from "@series-inc/rundot-game-sdk";
// The singleton lives on the `/api` subpath (the package root has no default
// export) — the same module `transport.ts` loads.
import RundotGameAPI from "@series-inc/rundot-game-sdk/api";
import {
  ROOM_TYPE,
  MATCH_CRITERIA,
  ROOM_CODE_LENGTH,
  NO_ROOM_SERVER_MESSAGE,
  normalizeRoomCode,
  isValidRoomCode,
  isAccessDenied,
  isOfflineMockRealtime,
} from "../../src/net/transport";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "../..");

describe("MP-02 room registration", () => {
  it("ROOM_TYPE matches the registered room in realtime.config.json", () => {
    const cfg = JSON.parse(
      readFileSync(join(ROOT, "rundot/realtime.config.json"), "utf8"),
    ) as {
      rooms: {
        type: string;
        config: { maxPlayers: number; metadata: Record<string, unknown> };
      }[];
    };
    const room = cfg.rooms.find((r) => r.type === ROOM_TYPE);
    expect(room).toBeDefined();
    // Two-player model: players[0] = you, players[1] = rival (§6).
    expect(room?.config.maxPlayers).toBe(2);
  });

  it("MATCH_CRITERIA matches the room metadata (§8)", () => {
    const cfg = JSON.parse(
      readFileSync(join(ROOT, "rundot/realtime.config.json"), "utf8"),
    ) as { rooms: { config: { metadata: Record<string, unknown> } }[] };
    for (const [k, v] of Object.entries(MATCH_CRITERIA)) {
      expect(cfg.rooms[0].config.metadata[k]).toBe(v);
    }
  });
});

describe("MP-02 room codes", () => {
  it("ROOM_CODE_LENGTH is the RUN 6-character code", () => {
    expect(ROOM_CODE_LENGTH).toBe(6);
  });

  it("normalizes the way the join field does: trim + uppercase", () => {
    expect(normalizeRoomCode("  hx9kwr ")).toBe("HX9KWR");
    expect(normalizeRoomCode("ab12cd")).toBe("AB12CD");
  });

  it("accepts well-formed codes", () => {
    expect(isValidRoomCode("HX9KWR")).toBe(true);
    expect(isValidRoomCode("  hx9kwr ")).toBe(true);
    expect(isValidRoomCode("ABC123")).toBe(true);
  });

  it("rejects malformed codes (server is still the final authority)", () => {
    expect(isValidRoomCode("")).toBe(false);
    expect(isValidRoomCode("ABC")).toBe(false);
    // Old-relay 4-character codes are a different room system entirely.
    expect(isValidRoomCode("AB12")).toBe(false);
    expect(isValidRoomCode("ABCDEFG")).toBe(false);
    expect(isValidRoomCode("AB-12C")).toBe(false);
    expect(isValidRoomCode("AB 12C")).toBe(false);
  });
});

describe("MP-02 isAccessDenied", () => {
  it("recognizes the SDK's AccessDeniedError", () => {
    expect(isAccessDenied(new AccessDeniedError("authenticated_18plus", "prompt_login"))).toBe(true);
  });

  it("recognizes the documented code shape (§1.2)", () => {
    expect(isAccessDenied({ code: "ACCESS_DENIED" })).toBe(true);
    expect(isAccessDenied({ name: "AccessDeniedError" })).toBe(true);
    expect(
      isAccessDenied({ name: "AccessDeniedError", requiredTier: "authenticated_18plus" }),
    ).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isAccessDenied(null)).toBe(false);
    expect(isAccessDenied(undefined)).toBe(false);
    expect(isAccessDenied("ACCESS_DENIED")).toBe(false);
    expect(isAccessDenied(new Error("boom"))).toBe(false);
    expect(isAccessDenied({ name: "Error", code: "TIMEOUT" })).toBe(false);
    expect(isAccessDenied({})).toBe(false);
  });
});

describe("MP-02 isOfflineMockRealtime", () => {
  const api = RundotGameAPI as unknown as { realtime?: unknown };

  it("reports the SDK's offline mock when no room server was injected", () => {
    // The multiplayer plugin injects `window.__RUNDOT_MULTIPLAYER_DEV_SERVER__`
    // ONLY on `vite serve`. This jsdom page never got it — which is exactly the
    // built / previewed / statically served state, where the SDK resolves
    // createRoom with a mock room and no welcome ever arrives.
    expect(
      (window as unknown as Record<string, unknown>).__RUNDOT_MULTIPLAYER_DEV_SERVER__,
    ).toBeUndefined();
    expect(isOfflineMockRealtime()).toBe(true);
  });

  it("does not flag a realtime API with a room server behind it", () => {
    const original = api.realtime;
    try {
      api.realtime = { delegate: {} };        // dev sidecar delegate present
      expect(isOfflineMockRealtime()).toBe(false);
      api.realtime = { createRoom: () => {} };// hosted RUN API: no such field
      expect(isOfflineMockRealtime()).toBe(false);
      api.realtime = undefined;               // no realtime at all: `realtime()` throws instead
      expect(isOfflineMockRealtime()).toBe(false);
    } finally {
      api.realtime = original;
    }
  });

  it("names the fix in the message shown instead of a lobby that cannot fill", () => {
    expect(NO_ROOM_SERVER_MESSAGE).toContain("npm run dev");
    expect(NO_ROOM_SERVER_MESSAGE).toContain("9001");
  });
});
