// @vitest-environment jsdom
//
// MP-06 — start-screen state machine tests.
//
// The regression these pin: "Join with a code" used to render only when
// `state === "join" && !room`, and every exit back to `choose` (Leave, Back,
// Cancel) left the previous room in state. So after hosting once — the natural
// thing to do when testing multiplayer in two windows — the join button showed
// a dead room code instead of a code field, with nowhere to type.
//
// Runs in jsdom against the REAL component. Only `transport.ts`'s room
// lifecycle is mocked (§11: room lifecycle needs a live room server, so unit
// tests fake it); the real `normalizeRoomCode` / `isValidRoomCode` /
// `isAccessDenied` and the real `NetSession` are exercised.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/net/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/net/transport")>();
  return {
    ...actual,
    createRoom: vi.fn(),
    joinRoomByCode: vi.fn(),
    quickMatch: vi.fn(),
    // The real one opens the platform login sheet; the fallback under test is
    // the "user dismissed it" path (§7's required play-vs-AI escape hatch).
    promptLogin: vi.fn(async () => ({ success: false })),
    // jsdom has no room sidecar, so the real check would report the SDK's
    // offline mock and every test below would (correctly) refuse to host.
    isOfflineMockRealtime: vi.fn(() => false),
  };
});

import StartScreen, { type StartChoice } from "../../src/ui/StartScreen";
import { DEFAULT_MATCH_SETTINGS, type MatchSettings } from "../../src/net/match-settings";
import { PROTOCOL_VERSION, type HexProtocol, type WelcomeMsg } from "../../src/net/protocol";
import {
  NO_ROOM_SERVER_MESSAGE,
  createRoom,
  isOfflineMockRealtime,
  joinRoomByCode,
  quickMatch,
  type HexRoom,
  type ServerPlayer,
} from "../../src/net/transport";

// ── a fake client room ────────────────────────────────────────────────────

interface FakeRoom extends HexRoom {
  /** Deliver a room message the way the gateway does (broadcast + sendTo). */
  emit: (msg: HexProtocol) => void;
  /** Seat another player, firing the roster events the SDK fires. */
  seat: (player: ServerPlayer) => void;
  /** Empty a seat, firing the event the room's `playerLeft` raises. */
  fireLeft: (playerId: string) => void;
  leaveCalls: number;
  /** Everything the lobby sent to the room. */
  sent: HexProtocol[];
}

function fakeRoom(roomCode: string, playerId = "p1", username = "Dev Player"): FakeRoom {
  const events: Record<string, ((...args: unknown[]) => void) | undefined> = {};
  const players: ServerPlayer[] = [{ id: playerId, username, avatarUrl: null }];
  const room = {
    roomCode,
    playerId,
    isCreator: true,
    locked: false,
    maxPlayers: 2,
    connectionState: "connected",
    latency: 1,
    players,
    leaveCalls: 0,
    /** #186: the lobby's outbound frames — a settings claim is assertable. */
    sent: [] as HexProtocol[],
    on: (e: Record<string, unknown>) => { Object.assign(events, e); },
    send: (msg: HexProtocol) => { room.sent.push(msg); },
    leave: () => { room.leaveCalls += 1; },
    emit: (msg: HexProtocol) => {
      events.onPrivateMessage?.(msg);
      events.onMessage?.(msg);
    },
    seat: (player: ServerPlayer) => {
      players.push(player);
      events.onPlayerJoined?.(player);
    },
    fireLeft: (playerId: string) => {
      const i = players.findIndex((p) => p.id === playerId);
      if (i >= 0) players.splice(i, 1);
      events.onPlayerLeft?.(playerId);
    },
  } as unknown as FakeRoom;
  return room;
}

function welcome(room: FakeRoom, seed = 4242): HexProtocol {
  return {
    type: "welcome",
    seed,
    hostId: room.playerId,
    protocolVersion: PROTOCOL_VERSION,
    roster: [{ id: room.playerId, username: "Dev Player", slot: 0 }],
  };
}

// ── harness ───────────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;
let choices: StartChoice[];

async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(StartScreen, { onStart: (c: StartChoice) => choices.push(c) }));
  });
}

function text(): string {
  return container.textContent ?? "";
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")]
    .find((b) => (b.textContent ?? "").trim().startsWith(label));
  if (!found) {
    const have = [...container.querySelectorAll("button")].map((b) => b.textContent).join(" | ");
    throw new Error(`no button starting with "${label}" — have: ${have}`);
  }
  return found;
}

async function click(label: string): Promise<HTMLButtonElement> {
  const el = button(label);
  await act(async () => { el.click(); });
  return el;
}

/** Type into the room-code field the way a browser would (React's onChange). */
async function typeCode(code: string): Promise<void> {
  const input = container.querySelector("input");
  if (!input) throw new Error("no code input on screen");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("no value setter");
  await act(async () => {
    setter.call(input, code);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const mockCreate = createRoom as unknown as ReturnType<typeof vi.fn>;
const mockOffline = isOfflineMockRealtime as unknown as ReturnType<typeof vi.fn>;
const mockJoin = joinRoomByCode as unknown as ReturnType<typeof vi.fn>;
const mockMatch = quickMatch as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  choices = [];
  // `vi.clearAllMocks()` keeps implementations, so a test that flips this must
  // not leak into the next one.
  mockOffline.mockReturnValue(false);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("MP-06 join screen", () => {
  it("offers a code field on a fresh start", async () => {
    await render();
    await click("Join with a code");
    expect(container.querySelector("input")).not.toBeNull();
    expect(text()).toContain("Enter room code");
  });

  it("still offers a code field after hosting and leaving (the reported bug)", async () => {
    const room = fakeRoom("HX9KWR");
    mockCreate.mockResolvedValue(room);
    await render();

    await click("Host a game");
    await act(async () => { room.emit(welcome(room)); });
    expect(text()).toContain("HX9KWR");          // host lobby, code shown
    await click("Leave");
    expect(room.leaveCalls).toBe(1);             // the socket is really gone

    await click("Join with a code");
    expect(container.querySelector("input")).not.toBeNull();
    expect(text()).not.toContain("HX9KWR");      // no stale room code
    expect(text()).toContain("Enter room code");
  });

  it("still offers a code field after a cancelled auto match", async () => {
    const room = fakeRoom("QM1234");
    mockMatch.mockResolvedValue(room);
    await render();

    await click("Auto Matchmaking");
    await act(async () => { room.emit(welcome(room)); });
    await click("Leave");
    await click("Join with a code");
    expect(container.querySelector("input")).not.toBeNull();
    expect(text()).not.toContain("QM1234");
  });

  it("still offers a code field after a failed join", async () => {
    mockJoin.mockRejectedValue(new Error("No room with that code."));
    await render();
    await click("Join with a code");
    await typeCode("ZZZZZZ");
    await click("Join game");
    expect(text()).toContain("Could not join");
    expect(text()).toContain("No room with that code.");

    await click("Back");
    await click("Join with a code");
    expect(container.querySelector("input")).not.toBeNull();
    expect(text()).toContain("Enter room code");
  });

  it("keeps the typed code after a failed join so it can be corrected", async () => {
    mockJoin.mockRejectedValue(new Error("No room with that code."));
    await render();
    await click("Join with a code");
    await typeCode("ZZZZZZ");
    await click("Join game");
    await click("Back");
    await click("Join with a code");
    expect((container.querySelector("input") as HTMLInputElement).value).toBe("ZZZZZZ");
  });

  it("joins with the typed code and resolves as guest once the welcome lands", async () => {
    const room = fakeRoom("HX9KWR", "p2", "Rival");
    mockJoin.mockResolvedValue(room);
    await render();

    await click("Join with a code");
    await typeCode("hx9kwr");                    // lowercase is normalized
    await click("Join game");
    expect(mockJoin).toHaveBeenCalledWith("HX9KWR");
    expect(text()).toContain("Room found");

    await act(async () => { room.emit(welcome(room, 777)); });
    await click("Play");
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({ mode: "guest", seed: 777 });
  });

  it("names both seats in the guest's lobby from the welcome roster", async () => {
    // The live room's honest shape: a joiner's `room:joined` carries no player
    // list, so `room.players` holds the guest alone and without a username —
    // the lobby used to show one nameless seat and an "Open seat" where the
    // host was already standing. The welcome names every seat, so it does.
    const room = fakeRoom("HX9KWR", "guest-socket", "");
    mockJoin.mockResolvedValue(room);
    await render();
    await click("Join with a code");
    await typeCode("HX9KWR");
    await click("Join game");

    await act(async () => {
      room.emit({
        type: "welcome",
        seed: 777,
        hostId: "host-socket",
        protocolVersion: PROTOCOL_VERSION,
        roster: [
          { id: "host-socket", username: "Ada", slot: 0 },
          { id: "guest-socket", username: "Bo", slot: 1 },
        ],
      });
    });

    const seated = [...container.querySelectorAll(".seat.filled .seat-name")]
      .map((el) => el.textContent?.trim());
    expect(seated).toEqual(["Ada", "Bo"]);
    // Both seats are taken, so the placeholder stops saying it is waiting.
    expect(text()).toContain("Ready");
  });

  it("drops a seat from the guest's lobby when the room says it emptied", async () => {
    const room = fakeRoom("HX9KWR", "guest-socket", "");
    mockJoin.mockResolvedValue(room);
    await render();
    await click("Join with a code");
    await typeCode("HX9KWR");
    await click("Join game");
    await act(async () => {
      room.emit({
        type: "welcome",
        seed: 777,
        hostId: "host-socket",
        protocolVersion: PROTOCOL_VERSION,
        roster: [
          { id: "host-socket", username: "Ada", slot: 0 },
          { id: "guest-socket", username: "Bo", slot: 1 },
        ],
      });
    });
    expect([...container.querySelectorAll(".seat.filled .seat-name")].map((el) => el.textContent))
      .toEqual(["Ada", "Bo"]);

    // The room's own roster event is what removes a seat — the welcome is a
    // list of who WAS there, and it must not keep naming a player who left.
    await act(async () => {
      (room as unknown as { fireLeft: (id: string) => void }).fireLeft("host-socket");
    });
    expect([...container.querySelectorAll(".seat.filled .seat-name")].map((el) => el.textContent))
      .toEqual(["Bo"]);
  });

  it("keeps Play disabled until the welcome brings a seed", async () => {
    const room = fakeRoom("HX9KWR", "p2");
    mockJoin.mockResolvedValue(room);
    await render();
    await click("Join with a code");
    await typeCode("HX9KWR");
    await click("Join game");
    expect(button("Connecting…").disabled).toBe(true);

    await act(async () => { room.emit(welcome(room)); });
    expect(button("Play").disabled).toBe(false);
  });

  it("refuses a malformed code without touching the network", async () => {
    await render();
    await click("Join with a code");
    await typeCode("HX9");
    expect(button("Join game").disabled).toBe(true);
    expect(mockJoin).not.toHaveBeenCalled();
  });

  it("submits on Enter", async () => {
    const room = fakeRoom("HX9KWR", "p2");
    mockJoin.mockResolvedValue(room);
    await render();
    await click("Join with a code");
    await typeCode("HX9KWR");
    const input = container.querySelector("input") as HTMLInputElement;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(mockJoin).toHaveBeenCalledWith("HX9KWR");
  });

  it("shows the host's reason when the room rejects us in the lobby", async () => {
    const room = fakeRoom("HX9KWR", "p2");
    mockJoin.mockResolvedValue(room);
    await render();
    await click("Join with a code");
    await typeCode("HX9KWR");
    await click("Join game");
    await act(async () => { room.emit(welcome(room)); });
    await act(async () => { room.emit({ type: "reject", reason: "The host left the game." }); });
    expect(text()).toContain("Could not join");
    expect(text()).toContain("The host left the game.");
  });

  it("refuses a welcome from a different protocol version (§11)", async () => {
    const room = fakeRoom("HX9KWR", "p2");
    mockJoin.mockResolvedValue(room);
    await render();
    await click("Join with a code");
    await typeCode("HX9KWR");
    await click("Join game");
    await act(async () => {
      room.emit({ ...welcome(room), protocolVersion: PROTOCOL_VERSION + 1 });
    });
    expect(text()).toContain("This game has been updated");
    expect(choices).toHaveLength(0);
  });

  it("gives up on a lobby that never receives a welcome", async () => {
    // Only setTimeout is faked: React's scheduler keeps its real timers.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const room = fakeRoom("HX9KWR");
    mockCreate.mockResolvedValue(room);
    await render();
    await click("Host a game");
    expect(text()).toContain("Connecting");

    await act(async () => { vi.advanceTimersByTime(10_001); });
    expect(text()).toContain("never introduced itself");
    expect(room.leaveCalls).toBe(1);
  });

  it("ignores a second Join click while the first is still in flight", async () => {
    let resolveJoin: (room: HexRoom) => void = () => {};
    mockJoin.mockReturnValue(new Promise<HexRoom>((res) => { resolveJoin = res; }));
    await render();
    await click("Join with a code");
    await typeCode("HX9KWR");

    await act(async () => { button("Join game").click(); });
    expect(button("Joining…").disabled).toBe(true);
    await act(async () => { button("Joining…").click(); });   // a real click on a disabled button is a no-op
    expect(mockJoin).toHaveBeenCalledTimes(1);

    const room = fakeRoom("HX9KWR", "p2");
    await act(async () => { resolveJoin(room); });
    expect(text()).toContain("Room found");
  });

  it("hosts: Start enabled once a rival is seated", async () => {
    const room = fakeRoom("HX9KWR");
    mockCreate.mockResolvedValue(room);
    await render();

    await click("Host a game");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(text()).toContain("HX9KWR");

    await act(async () => { room.emit(welcome(room, 99)); });
    expect(button("Start game").disabled).toBe(true);   // still alone in the room

    await act(async () => { room.seat({ id: "p2", username: "Rival", avatarUrl: null }); });
    expect(button("Start game").disabled).toBe(false);

    await click("Start game");
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({ mode: "host", seed: 99 });
  });

  // The trap this pins: with no room server (a built or previewed page) the SDK
  // RESOLVES createRoom/joinRoomByCode with a mock room and a plausible code,
  // so both lobbies look alive and then wait out the welcome timeout. Fail at
  // the door with the actionable message instead.
  it("refuses to host when there is no room server behind the page", async () => {
    mockOffline.mockReturnValue(true);
    await render();
    await click("Host a game");
    expect(text()).toContain("No room server behind this page");
    expect(mockCreate).not.toHaveBeenCalled();
    await click("Play vs AI");
    expect(choices).toEqual([{ mode: "ai", portrait: "vex" }]);
  });

  it("refuses to join and to auto-matchmake when there is no room server", async () => {
    mockOffline.mockReturnValue(true);
    await render();
    await click("Join with a code");
    await typeCode("HX9KWR");
    await click("Join game");
    expect(mockJoin).not.toHaveBeenCalled();
    expect(text()).toContain("No room server behind this page");

    await click("Back");
    await click("Auto Matchmaking");
    expect(mockMatch).not.toHaveBeenCalled();
    expect(text()).toContain("No room server behind this page");
    expect(text()).not.toContain("Finding an opponent");
  });

  it("names the room server as the cause when a lobby times out in mock mode", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const room = fakeRoom("HX9KWR");
    mockCreate.mockResolvedValue(room);
    await render();
    await click("Host a game");           // the check passed at the door…
    mockOffline.mockReturnValue(true);    // …but the room server vanished
    await act(async () => { vi.advanceTimersByTime(10_001); });
    expect(text()).toContain(NO_ROOM_SERVER_MESSAGE.split(". ")[0]);
  });

  it("falls back to the AI when the platform refuses an anonymous player", async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error("nope"), { name: "AccessDeniedError" }));
    await render();
    await click("Host a game");
    expect(text()).toContain("Sign in to play with friends");
    await click("Play vs AI");
    expect(choices).toEqual([{ mode: "ai", portrait: "vex" }]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Auto Matchmaking — #146's search that never times out, and RANK-01's (#147)
// Any / Similar rank window on the same door.
//
// Two rules, one loop: a closed matchmake window is simply re-issued (there is
// no "no rival found" screen any more), and a SIMILAR RANK search walks the
// widening ladder once before settling at Any rank for good. "Any rank" opens
// at that last rung and stays there.
// ══════════════════════════════════════════════════════════════════════════
describe("auto matchmaking: never time out, and the rank window", () => {
  /** The SDK's own per-request window closing (transport.isMatchmakeWindowExpired). */
  const windowExpired = () => new Error("Matchmaking timeout — no opponent found");

  it("re-issues the request each time a matchmake window closes, then lands in the room", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const room = fakeRoom("QM1234");
    // One RUN request is one bounded window; the SDK rejects each expiry with
    // one of these plain Errors (matched by transport's isMatchmakeWindowExpired).
    mockMatch.mockRejectedValueOnce(windowExpired());
    mockMatch.mockRejectedValueOnce(new Error("Matchmaking is no longer active (pool expired or cancelled)"));
    mockMatch.mockResolvedValue(room);
    await render();

    await click("Auto Matchmaking");
    expect(mockMatch).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Finding an opponent");

    // Each closed window → the loop breathes once → asks again. No give-up,
    // no timeout screen: the search simply continues.
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(mockMatch).toHaveBeenCalledTimes(2);
    expect(text()).toContain("Finding an opponent");
    expect(text()).not.toContain("No rival found yet");
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(mockMatch).toHaveBeenCalledTimes(3);

    // The third request pairs. Alone in a fresh room → host lobby with the code.
    expect(text()).toContain("QM1234");
    await act(async () => { room.emit(welcome(room, 99)); });
    await act(async () => { room.seat({ id: "p2", username: "Rival", avatarUrl: null }); });
    await click("Start game");
    expect(choices[0]).toMatchObject({ mode: "host", seed: 99 });
  });

  it("searches past the old 30-second cutoff and lands a late match as guest", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const room = fakeRoom("QM5678", "p2", "Rival");
    room.isCreator = false; // the matchmaker joined us into someone's room
    let resolveMatch: (room: HexRoom) => void = () => {};
    mockMatch.mockReturnValue(new Promise<HexRoom>((res) => { resolveMatch = res; }));
    await render();

    await click("Auto Matchmaking");
    await act(async () => { vi.advanceTimersByTime(120_000); });
    expect(text()).toContain("Finding an opponent");
    expect(text()).not.toContain("No rival found yet");  // the timeout screen is gone
    expect(mockMatch).toHaveBeenCalledTimes(1);          // same search, still pending

    // Matched while still searching → into the room, as today.
    await act(async () => { resolveMatch(room); });
    expect(text()).toContain("Room found");
    await act(async () => { room.emit(welcome(room, 777)); });
    await click("Play");
    expect(choices[0]).toMatchObject({ mode: "guest", seed: 777 });
  });

  it("a Cancel beats a match that resolves afterwards, and the room is left", async () => {
    const room = fakeRoom("QM9999", "p2", "Rival");
    let resolveMatch: (room: HexRoom) => void = () => {};
    mockMatch.mockReturnValue(new Promise<HexRoom>((res) => { resolveMatch = res; }));
    await render();

    await click("Auto Matchmaking");
    await click("Cancel");
    expect(text()).toContain("Back to work");            // back on the mode list

    await act(async () => { resolveMatch(room); });      // the pairing lands late…
    expect(text()).not.toContain("Room found");
    expect(text()).not.toContain("QM9999");              // …and must not yank us in
    expect(room.leaveCalls).toBe(1);                     // abandoned socket closed
  });

  it("shows the elapsed search time and stops the clock on cancel", async () => {
    // Date is faked too: the clock derives elapsed time from wall time.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    mockMatch.mockReturnValue(new Promise<HexRoom>(() => {}));
    await render();

    await click("Auto Matchmaking");
    expect(text()).toMatch(/Searching for 0:00/);
    await act(async () => { vi.advanceTimersByTime(61_000); });
    expect(text()).toMatch(/Searching for 1:01/);
    expect(text()).not.toContain("up to 30 seconds");    // the old promise is gone

    await click("Cancel");
    expect(text()).not.toContain("Finding an opponent");
    expect(text()).not.toMatch(/Searching for/);
  });

  it("surfaces a real failure instead of retrying forever", async () => {
    mockMatch.mockRejectedValue(Object.assign(new Error("nope"), { name: "AccessDeniedError" }));
    await render();
    await click("Auto Matchmaking");
    expect(mockMatch).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Sign in to play with friends");
    await click("Play vs AI");
    expect(choices).toEqual([{ mode: "ai", portrait: "vex" }]);
  });

  it("Any rank opens at the widest rung and STAYS there — no criterion, no give-up", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mockMatch.mockRejectedValue(windowExpired());
    await render();
    await click("Auto Matchmaking");
    // The first attempt already asks for nothing in particular: Any rank is
    // the last rung of the ladder, and it is a place, not a pass-through.
    expect(mockMatch.mock.calls[0][0].rankBucket).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1_000); });
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(mockMatch.mock.calls.length).toBeGreaterThanOrEqual(2);
    // …and it keeps asking for nothing, forever, rather than narrowing.
    expect(mockMatch.mock.calls.every((c) => c[0].rankBucket === null)).toBe(true);
    expect(text()).toContain("Finding an opponent");
    expect(text()).not.toContain("No rival found yet");
    await click("Cancel");
  });

  it("Similar rank widens through every window and settles at Any — never stuck", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mockMatch.mockReturnValueOnce(new Promise<HexRoom>(() => {}));  // the Any search it replaces
    mockMatch.mockRejectedValue(windowExpired());
    await render();
    await click("Auto Matchmaking");
    // The picker is on the waiting screen: switching restarts the search.
    await click("Similar rank");
    // Six windows' worth of "widen and look again": one per rung, then Any.
    for (let i = 0; i < 6; i++) await act(async () => { vi.advanceTimersByTime(1_000); });

    const restarted = mockMatch.mock.calls.slice(1);
    const buckets = restarted.map((c) => c[0].rankBucket as number | null);
    const budgets = restarted.map((c) => c[0].matchmakeTimeoutMs as number);
    expect(budgets.slice(0, 4)).toEqual([6_000, 8_000, 8_000, 8_000]);
    // Narrow → wide: each of the first three rungs is a COARSER bucket, so two
    // players who miss each other tight can still meet wide.
    expect(buckets.slice(0, 3).every((b) => typeof b === "number")).toBe(true);
    expect(new Set(buckets.slice(0, 3)).size).toBe(3);
    // …and the last rung asks for nothing in particular, then stays there.
    expect(buckets[3]).toBeNull();
    expect(buckets.at(-1)).toBeNull();
    expect(text()).toContain("Finding an opponent");
    await click("Cancel");
  });

  it("a match found on a widened rung seats the player in a RANKED lobby", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const room = fakeRoom("HX9KWR");
    mockMatch
      .mockReturnValueOnce(new Promise<HexRoom>(() => {}))  // the Any search, replaced
      .mockRejectedValueOnce(windowExpired())   // the tight window found nobody
      .mockResolvedValueOnce(room);             // the next window did
    await render();
    await click("Auto Matchmaking");
    await click("Similar rank");
    await act(async () => { vi.advanceTimersByTime(1_000); });
    await act(async () => { room.emit(welcome(room)); });
    expect(mockMatch).toHaveBeenCalledTimes(3);
    expect(text()).toContain("HX9KWR");
    expect(text()).toContain("RANKED");
  });

  it("the waiting screen carries the rank picker and says which window the search is in", async () => {
    mockMatch.mockReturnValue(new Promise(() => {}));
    await render();
    await click("Auto Matchmaking");
    expect(text()).toContain("Any rank — a fair match beats a perfect one.");
    expect(container.querySelector(".matchmaking .rank-search")?.getAttribute("role")).toBe("radiogroup");

    await click("Similar rank");                        // restarts the search, narrow first
    expect(mockMatch).toHaveBeenCalledTimes(2);
    expect(mockMatch.mock.calls[1][0].rankBucket).not.toBeNull();
    expect(text()).toContain("within 75 rating points");

    await click("Any rank");                            // and back to the widest window
    expect(mockMatch).toHaveBeenCalledTimes(3);
    expect(mockMatch.mock.calls[2][0].rankBucket).toBeNull();
    expect(text()).toContain("Any rank — a fair match beats a perfect one.");

    await click("Any rank");                            // re-picking the same window is a no-op
    expect(mockMatch).toHaveBeenCalledTimes(3);
    await click("Cancel");
  });

  it("switching rank mid-search leaves a room that lands for the abandoned search", async () => {
    const late = fakeRoom("OLD111", "p2", "Rival");
    let resolveOld: (room: HexRoom) => void = () => {};
    mockMatch
      .mockReturnValueOnce(new Promise<HexRoom>((res) => { resolveOld = res; }))
      .mockReturnValue(new Promise<HexRoom>(() => {}));
    await render();
    await click("Auto Matchmaking");
    await click("Similar rank");
    await act(async () => { resolveOld(late); });       // the Any search pairs, too late
    expect(text()).not.toContain("OLD111");
    expect(text()).toContain("Finding an opponent");
    expect(late.leaveCalls).toBe(1);
    await click("Cancel");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// #186 — the host's Game settings panel.
//
// The lobby is where a room's rules are chosen, and three things have to be
// true there: the host can start a match WITHOUT a second human (an AI holds
// the seat), every change is filed with the room (so a guest reads the same
// record rather than guessing), and a guest's copy is read-only. The record
// itself and its validation are pinned in net-match-settings.test.ts.
// ══════════════════════════════════════════════════════════════════════════
describe("#186 host game settings", () => {
  const settingsClaims = (room: FakeRoom) =>
    room.sent.filter((m) => m.type === "settingsClaim") as { type: "settingsClaim"; settings: MatchSettings }[];

  async function hostLobby(rosterHasGuest = false): Promise<FakeRoom> {
    const room = fakeRoom("HX9KWR");
    mockCreate.mockResolvedValue(room);
    await render();
    await click("Host a game");
    const greeting = welcome(room, 99) as WelcomeMsg;
    if (rosterHasGuest) greeting.roster = [...greeting.roster, { id: "p2", username: "Rival", slot: 1 }];
    await act(async () => { room.emit(greeting); });
    if (rosterHasGuest) {
      await act(async () => { room.seat({ id: "p2", username: "Rival", avatarUrl: null }); });
    }
    return room;
  }

  beforeEach(() => {
    // The panel seeds itself from the last-used rules; every test starts clean.
    localStorage.removeItem("hexmatch:match-settings");
  });

  it("shows the panel with the shipped rules, and a disabled Reset", async () => {
    await hostLobby();
    expect(text()).toContain("Game settings");
    expect(text()).toContain("Win points");
    expect(text()).toContain("Starting resources");
    expect(text()).toContain(`First to ${DEFAULT_MATCH_SETTINGS.winTarget}★`);
    expect(button("Reset to default").disabled).toBe(true);
  });

  it("lets the host start alone by filling the seat with a machine", async () => {
    const room = await hostLobby();
    expect(button("Start game").disabled).toBe(true);      // nobody to play yet
    await click("Add AI opponent");
    expect(text()).toContain("AI opponent");
    expect(button("Start game").disabled).toBe(false);     // the seat is filled
    // …and the room was told, so a guest who joins later reads the same rules.
    expect(settingsClaims(room).at(-1)?.settings.aiSeats).toEqual(["normal"]);

    await click("Start game");
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({ mode: "host", seed: 99 });
    expect((choices[0] as { settings: MatchSettings }).settings.aiSeats).toEqual(["normal"]);
  });

  it("caps the AI seats at the ones a match can hold", async () => {
    await hostLobby();
    await click("Add AI opponent");
    expect(button("Add AI opponent").disabled).toBe(true);
    expect(text()).toContain("A match seats two");
  });

  it("refuses an AI seat once a human has taken it", async () => {
    const room = await hostLobby(true);
    expect(button("Add AI opponent").disabled).toBe(true);
    expect(text()).toContain("A human has taken the second seat");
    expect(settingsClaims(room)).toHaveLength(0);          // nothing to file
  });

  it("files the ★ line and the purse with the room, and remembers them here", async () => {
    const room = await hostLobby();
    await click("Short");                       // 5★
    await click("Rich 2×");                     // 2× the opening purse
    const last = settingsClaims(room).at(-1);
    expect(last?.settings.winTarget).toBe(5);
    expect(last?.settings.startPurse).toEqual({ wood: 24, stone: 24, ore: 0 });
    expect(text()).toContain("First to 5★ · Rich 2× resources");
    // The host's last-used rules survive the lobby.
    expect(JSON.parse(localStorage.getItem("hexmatch:match-settings")!))
      .toMatchObject({ winTarget: 5, startPurse: { wood: 24, stone: 24, ore: 0 } });
    expect(button("Reset to default").disabled).toBe(false);
  });

  it("does not file a rule that did not move", async () => {
    const room = await hostLobby();
    await click("Standard");                    // already the shipped line
    expect(settingsClaims(room)).toHaveLength(0);
  });

  /** The room's echo, as the real relay sends it: a claim comes back to
   *  everybody, which is what makes the lobby's printed rules the room's. */
  async function ackSettings(room: FakeRoom): Promise<void> {
    const last = settingsClaims(room).at(-1);
    if (!last) return;
    await act(async () => { room.emit({ type: "settings", settings: last.settings }); });
  }

  it("restores the shipped rules on Reset", async () => {
    const room = await hostLobby();
    await click("Marathon");
    await ackSettings(room);
    await click("Reset to default");
    expect(settingsClaims(room).at(-1)?.settings).toEqual(DEFAULT_MATCH_SETTINGS);
    expect(text()).toContain(`First to ${DEFAULT_MATCH_SETTINGS.winTarget}★`);
    expect(button("Reset to default").disabled).toBe(true);
  });

  it("comes back on the last-used rules", async () => {
    const room = await hostLobby();
    await click("Short");
    await click("Leave");
    const again = await hostLobby();
    void room;
    expect(text()).toContain("First to 5★");
    // …and a room that joins late is told them on the way in.
    expect(settingsClaims(again).at(-1)?.settings.winTarget).toBe(5);
  });

  it("shows a guest the room's rules, read-only", async () => {
    const room = fakeRoom("HX9KWR", "p2", "Guest");
    mockJoin.mockResolvedValue(room);
    await render();
    await click("Join with a code");
    await typeCode("HX9KWR");
    await act(async () => { button("Join game").click(); });
    const greeting = welcome(room, 99) as WelcomeMsg;
    greeting.roster = [{ id: "p1", username: "Host", slot: 0 }, { id: "p2", username: "Guest", slot: 1 }];
    await act(async () => { room.emit(greeting); });
    expect(text()).toContain("Match rules");
    // The guest sees the same dials and cannot move any of them…
    const groups = [...container.querySelectorAll("fieldset.ms-group")] as HTMLFieldSetElement[];
    expect(groups.length).toBe(3);
    expect(groups.every((g) => g.disabled)).toBe(true);
    // …has no seat controls at all…
    expect(text()).not.toContain("Add AI opponent");
    expect(text()).not.toContain("Reset to default");
    // …and no say in the rules.
    expect(room.sent.filter((m) => m.type === "settingsClaim")).toHaveLength(0);

    // The host moves a dial; the guest's panel follows, live.
    await act(async () => {
      room.emit({
        type: "settings",
        settings: { aiSeats: [], winTarget: 5, startPurse: { wood: 24, stone: 24, ore: 0 } },
      });
    });
    expect(text()).toContain("First to 5★ · Rich 2× resources");
    await click("Play");
    expect((choices[0] as { settings: MatchSettings }).settings.winTarget).toBe(5);
  });

  it("keeps a ranked room on the standard rules", async () => {
    const room = fakeRoom("HX9KWR");
    mockMatch.mockResolvedValue(room);
    await render();
    await click("Auto Matchmaking");
    await act(async () => { room.emit(welcome(room, 99)); });
    expect(text()).toContain("RANKED");
    expect(text()).toContain("Ranked matches play the standard rules");
    expect(button("Add AI opponent").disabled).toBe(true);
  });
});
