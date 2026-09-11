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
import { PROTOCOL_VERSION, type HexProtocol } from "../../src/net/protocol";
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
  leaveCalls: number;
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
    on: (e: Record<string, unknown>) => { Object.assign(events, e); },
    send: () => {},
    leave: () => { room.leaveCalls += 1; },
    emit: (msg: HexProtocol) => {
      events.onPrivateMessage?.(msg);
      events.onMessage?.(msg);
    },
    seat: (player: ServerPlayer) => {
      players.push(player);
      events.onPlayerJoined?.(player);
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

  it("still offers a code field after a cancelled quick match", async () => {
    const room = fakeRoom("QM1234");
    mockMatch.mockResolvedValue(room);
    await render();

    await click("Quick match");
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
    expect(choices).toEqual([{ mode: "ai" }]);
  });

  it("refuses to join and to quick-match when there is no room server", async () => {
    mockOffline.mockReturnValue(true);
    await render();
    await click("Join with a code");
    await typeCode("HX9KWR");
    await click("Join game");
    expect(mockJoin).not.toHaveBeenCalled();
    expect(text()).toContain("No room server behind this page");

    await click("Back");
    await click("Quick match");
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
    expect(choices).toEqual([{ mode: "ai" }]);
  });
});
