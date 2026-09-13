// @vitest-environment jsdom
//
// #121 — "Leave Room does nothing", through the REAL game and the REAL ☰ menu.
//
// The report was a click that appeared dead. In source, the menu's leave door
// asked `window.confirm(...)`, and a page inside a frame the host sandboxes
// without `allow-modals` gets that answered `false` with no dialog at all — so
// the handler returned early and nothing happened. Every test here therefore
// boots with `window.confirm` stubbed to answer `false` (the sandboxed
// behaviour), and the flow must still work: that is the regression.
//
// The second half pins what the click has to DO once it works — hand the room
// back (`room.leave()`), stop publishing into it, and tell the seat still in
// the match that their opponent is gone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetSession } from "../../src/net/session";
import { PROTOCOL_VERSION, type HexProtocol, type WelcomeMsg } from "../../src/net/protocol";
import type { HexRoom } from "../../src/net/transport";
import { mulberry32, setRng } from "../../src/game/config";

vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

const SEED = 1337;

/** The slice of `ServerRoom` the game's session touches. Records the two
 *  things #121 is about: whether the room was left, and what was sent. */
class FakeRoom {
  readonly roomCode = "HX9KWR";
  connectionState = "connected" as const;
  latency = 4;
  isCreator = true;
  leaveCount = 0;
  readonly sent: HexProtocol[] = [];
  private events: Record<string, ((m: never) => void) | undefined> = {};

  constructor(readonly playerId: string) {}

  on(events: Record<string, (m: never) => void>): void {
    Object.assign(this.events, events);
  }
  send(msg: HexProtocol): void { this.sent.push(structuredClone(msg)); }
  leave(): void { this.leaveCount++; }

  /** The gateway's roster event, as `removePlayer` broadcasts it. */
  firePlayerLeft(playerId: string): void {
    (this.events.onPlayerLeft as ((id: string) => void) | undefined)?.(playerId);
  }
  sentCount(type: HexProtocol["type"]): number {
    return this.sent.filter((m) => m.type === type).length;
  }
}

const asRoom = (r: FakeRoom): HexRoom => r as unknown as HexRoom;

const welcome = (hostId: string): WelcomeMsg => ({
  type: "welcome",
  seed: SEED,
  hostId,
  protocolVersion: PROTOCOL_VERSION,
  roster: [
    { id: "host-socket", username: "Ada", slot: 0 },
    { id: "guest-socket", username: "Bo", slot: 1 },
  ],
});

// ── the usual headless-game stubs (jsdom has no 2D context, Vite owns art) ──
function stubCanvas() {
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "canvas") return null;
      if (prop === "imageSmoothingEnabled") return false;
      if (prop === "getImageData") {
        return (_x: number, _y: number, w: number, h: number) =>
          ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4).fill(255), width: w, height: h });
      }
      return () => undefined;
    },
    set: () => true,
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
}
function stubImage() {
  (globalThis as Record<string, unknown>).Image = class {
    width = 1024; height = 1024;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) { queueMicrotask(() => this.onload?.()); }
  };
}

const settle = async () => { for (let i = 0; i < 14; i++) await new Promise((r) => setTimeout(r, 0)); };

let root: HTMLDivElement;
let dispose: (() => void) | undefined;
let room: FakeRoom;
let session: NetSession;
let quits: number;

const menuBtn = () => document.getElementById("iso-menu-btn")!;
const menuItems = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("#iso-topmenu .tm-item"));
const leaveItem = () => menuItems().find((b) => b.textContent?.includes("Leave Room"))!;
const sheet = () => document.querySelector<HTMLElement>(".confirm-sheet");
const sheetOk = () => document.querySelector<HTMLButtonElement>(".confirm-sheet [data-confirm-ok]")!;
const sheetCancel = () =>
  document.querySelector<HTMLButtonElement>(".confirm-sheet button[data-confirm-cancel]")!;
const modal = () => root.querySelector<HTMLElement>(".modal-root")!;

beforeEach(async () => {
  stubCanvas();
  stubImage();
  window.history.replaceState(null, "", `/?seed=${SEED}`);
  localStorage.clear();
  localStorage.setItem("hexmatch:rival-skill", "normal");
  localStorage.setItem("hexmatch:tutorial", "never");
  setRng(mulberry32(SEED));
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
  (globalThis as Record<string, unknown>).OffscreenCanvas = undefined;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number) as never;
  window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as never;

  // THE regression condition: native dialogs are suppressed by the host frame,
  // so `confirm()` answers false and shows nothing. If any code path still
  // routes the ask through it, every test below fails.
  vi.spyOn(window, "confirm").mockReturnValue(false);

  room = new FakeRoom("host-socket");
  session = new NetSession({ room: asRoom(room), role: "host" });
  quits = 0;

  root = document.createElement("div");
  root.className = "game-root";
  Object.defineProperty(root, "clientWidth", { value: 900, configurable: true });
  Object.defineProperty(root, "clientHeight", { value: 700, configurable: true });
  document.body.appendChild(root);

  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, {
    seed: SEED, role: "host", net: session, onQuitToMenu: () => { quits++; },
  });
  await settle();
  session.receive(welcome("host-socket"));
  await settle();
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
  vi.restoreAllMocks();
});

const openMenu = () => { menuBtn().click(); };

describe("#121 Leave Room", () => {
  it("offers the door in a room, and does not ask through a native dialog", () => {
    expect(leaveItem()).toBeTruthy();
    expect(leaveItem().textContent).toContain("the other seat is told you left");
    openMenu();
    leaveItem().click();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("raises a painted confirm the player can actually answer", async () => {
    openMenu();
    leaveItem().click();
    await settle();
    expect(sheet()).toBeTruthy();
    expect(sheet()!.querySelector("h2")!.textContent).toBe("Leave this room?");
    expect(sheetOk().textContent).toBe("Leave room");
    // The menu closes behind the question rather than stacking over it.
    expect(document.getElementById("iso-topmenu")!.classList.contains("hidden")).toBe(true);
  });

  it("leaves through the confirm door even with native dialogs suppressed", async () => {
    openMenu();
    leaveItem().click();
    await settle();
    sheetOk().click();
    await settle();
    expect(quits).toBe(1);
    expect(sheet()).toBeNull();
  });

  it("cancels through Cancel and through Escape, and the match goes on", async () => {
    openMenu();
    leaveItem().click();
    await settle();
    sheetCancel().click();
    await settle();
    expect(quits).toBe(0);

    openMenu();
    leaveItem().click();
    await settle();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle();
    expect(quits).toBe(0);
    expect(room.leaveCount).toBe(0);
  });

  it("does not stack a second question over the first", async () => {
    openMenu();
    leaveItem().click();
    await settle();
    openMenu();
    leaveItem().click();
    await settle();
    expect(document.querySelectorAll(".confirm-sheet")).toHaveLength(1);
    sheetCancel().click();
    await settle();
    expect(quits).toBe(0);
  });

  it("unmounting the match hands the room back — once, however often it runs", async () => {
    expect(room.leaveCount).toBe(0);
    dispose!();
    dispose = undefined;
    expect(room.leaveCount).toBe(1);
    session.dispose();                       // the page going away calls it again
    expect(room.leaveCount).toBe(1);
  });

  it("stops publishing into the room once it has been handed back", async () => {
    session.dispose();
    const before = room.sentCount("delta") + room.sentCount("snapshot-chunk");
    // Whatever the game would still like to say now has nowhere to go.
    expect(session.publishTrack(
      { tiles: new Uint8Array(0) } as never, {} as never,
      { players: [], winner: null } as never,
    )).toBe("idle");
    expect(room.sentCount("delta") + room.sentCount("snapshot-chunk")).toBe(before);
  });

  it("tells the seat still in the match that their opponent left", async () => {
    room.firePlayerLeft("guest-socket");
    await settle();
    expect(session.hasOpponent).toBe(false);
    const m = modal();
    expect(m.classList.contains("hidden")).toBe(false);
    expect(m.textContent).toContain("Bo left the room");
    expect(m.textContent).toContain("this match is over");
  });

  it("does not mistake its own departure for the opponent's", async () => {
    room.firePlayerLeft("host-socket");      // the gateway echoing our own leave
    await settle();
    expect(modal().classList.contains("hidden")).toBe(true);
    expect(session.hasOpponent).toBe(true);
  });

  it("names nobody when the opponent goes before the welcome arrived", async () => {
    const bare = new FakeRoom("late-socket");
    const bareSession = new NetSession({ room: asRoom(bare), role: "guest" });
    const seen: (string | null)[] = [];
    bareSession.attach({ opponentLeft: (n) => seen.push(n) });
    bare.firePlayerLeft("host-socket");
    expect(seen).toEqual([null]);
    bareSession.dispose();
  });
});
