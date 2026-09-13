// @vitest-environment jsdom
//
// MP-02 — transport helper tests.
//
// Runs in jsdom because `transport.ts` loads the RUN SDK singleton, which
// needs a browser `window` at construction. No test here touches the network:
// room lifecycle (`createRoom`, `joinRoomByCode`, `quickMatch`, …) needs a
// signed-in identity and a live room server, so it is covered by local
// two-client play (MP-03+) and the e2e suite — not by unit tests (§11).
import { describe, it, expect, vi } from "vitest";
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
  RANK_CRITERIA_KEY,
  ROOM_CODE_LENGTH,
  NO_ROOM_SERVER_MESSAGE,
  normalizeRoomCode,
  isValidRoomCode,
  isAccessDenied,
  isOfflineMockRealtime,
  quickMatch,
  LADDER_MODE,
} from "../../src/net/transport";
import { RANK_TIERS, RATING_FLOOR, START_RATING } from "../../src/net/rating";

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

  it("the ladder config is the shape the platform reads (RANK-01)", () => {
    // `rundot/leaderboard.config.json` is read by the RUN host, not by this
    // build — so a typo in it fails silently, at deploy, in production. Check
    // the fields the SDK's `LeaderboardConfig` REQUIRES, and that the board
    // this game submits to exists and can hold a rating.
    const cfg = JSON.parse(
      readFileSync(join(ROOT, "rundot/leaderboard.config.json"), "utf8"),
    ) as Record<string, unknown>;
    for (const key of ["minDurationSec", "maxDurationSec", "minScore", "maxScore", "requiresToken", "enableScoreSealing"]) {
      expect(typeof cfg[key], key).not.toBe("undefined");
    }
    for (const key of ["modes", "periods", "antiCheat", "displaySettings"]) {
      expect(typeof cfg[key], key).toBe("object");
    }
    // No wrapping key: the file holds the config directly (LEADERBOARD.md).
    expect(cfg.leaderboard).toBeUndefined();
    // The mode this game submits (`LADDER_MODE`) is a declared mode, and its
    // bounds admit the rating scale: the floor, the start, and the top band.
    const modes = cfg.modes as Record<string, { minScore?: number; maxScore?: number }>;
    expect(Object.keys(modes)).toContain(LADDER_MODE);
    const min = Math.max(cfg.minScore as number, modes[LADDER_MODE]?.minScore ?? 0);
    const max = Math.min(cfg.maxScore as number, modes[LADDER_MODE]?.maxScore ?? Infinity);
    expect(min).toBeLessThanOrEqual(RATING_FLOOR);
    expect(max).toBeGreaterThanOrEqual(START_RATING);
    expect(max).toBeGreaterThanOrEqual(RANK_TIERS[RANK_TIERS.length - 1].min);
    // A forfeit files duration 1 (the wrapper clamps to >= 1), so the minimum
    // run length must not be longer than that.
    expect(cfg.minDurationSec as number).toBeLessThanOrEqual(1);
    expect(cfg.maxDurationSec as number).toBeGreaterThanOrEqual(600);
    expect((cfg.periods as Record<string, { type: string }>).alltime?.type).toBe("alltime");
  });

  it("a similar-rank search adds the bucket as one more criteria key, and Any removes it", async () => {
    // RANK-01 (#147): the pool matches criteria by EQUALITY, so the search
    // window rides the request as one more key. The room type itself declares
    // only `mode` — the bucket is a request-time hint, and the last rung of
    // the widening ladder must be indistinguishable from a plain search.
    const realtime = RundotGameAPI.realtime as unknown as {
      matchmakeRoom: (roomType: string, opts?: unknown) => Promise<unknown>;
    };
    const spy = vi.spyOn(realtime, "matchmakeRoom").mockResolvedValue({} as never);
    await quickMatch();
    expect(spy.mock.calls[0][1]).toMatchObject({ criteria: MATCH_CRITERIA });
    await quickMatch({ rankBucket: 7 });
    expect(spy.mock.calls[1][1]).toMatchObject({
      criteria: { ...MATCH_CRITERIA, [RANK_CRITERIA_KEY]: 7 },
    });
    // `null` is Any rank, as are the default and an omitted field.
    await quickMatch({ rankBucket: null });
    expect(spy.mock.calls[2][1]).toMatchObject({ criteria: MATCH_CRITERIA });
    spy.mockRestore();
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
