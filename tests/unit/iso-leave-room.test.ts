// @vitest-environment jsdom
// @vitest-environment-options {"url": "http://localhost/?loop=old"}
// L1f (#237): the new loop is the sandbox default now — this harness reads the
// RETIRED loop, so every boot in it asks for the one-release `?loop=old` hatch
// (a test that means the other loop says so itself: `{ newLoop: true }`).
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
import { HOST_LEFT_REASON, PROTOCOL_VERSION, type HexProtocol, type WelcomeMsg } from "../../src/net/protocol";
import type { HexRoom } from "../../src/net/transport";
import { mulberry32, setRng } from "../../src/game/config";
import { rateOutcome } from "../../src/net/rating";
import type { RankStore } from "../../src/net/rank-runtime";

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

/**
 * Boot one game against the fake room. Extracted so a ranked match can be
 * booted with its injected `RankStore` without a second harness.
 */
async function bootGame(opts: { ranked?: boolean; rank?: RankStore } = {}): Promise<void> {
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
    ...opts,
  });
  await settle();
  session.receive(welcome("host-socket"));
  await settle();
}

/**
 * Re-boot the game for a test that needs different options. `beforeEach`
 * already mounted a casual match, and a second `#iso-menu-btn` would shadow
 * the first for every `getElementById` lookup, so the old one goes first.
 */
async function reboot(opts: { ranked?: boolean; rank?: RankStore }): Promise<void> {
  dispose?.();
  dispose = undefined;
  root.remove();
  await bootGame(opts);
}

/** A `RankStore` whose only job is to record what the game asks it to file. */
function fakeRankStore(): {
  store: RankStore;
  filings: Parameters<RankStore["fileResult"]>[0][];
  loads: () => number;
} {
  let loads = 0;
  const filings: Parameters<RankStore["fileResult"]>[0][] = [];
  const store: RankStore = {
    loadState: async () => {
      loads++;
      return { rating: 1180, matches: 12, wins: 7, losses: 5, season: "s1" };
    },
    fileResult: async (input) => {
      filings.push(input);
      const verdict = rateOutcome({
        self: { id: input.selfId, state: input.state },
        opponent: input.opponent,
        won: input.result.winnerId === input.selfId,
        forfeit: input.result.reason === "forfeit",
      });
      return { state: verdict.state, verdict, applied: true, ladder: null };
    },
    loadLadder: async () => null,
  };
  return { store, filings, loads: () => loads };
}

beforeEach(async () => {
  stubCanvas();
  stubImage();
  // L1f (#237): the address bar says which loop this harness plays — the
  // RETIRED one, the loop it was written against. `?loop=old` is the release's
  // escape hatch; a test that wants the new loop says so (`{ newLoop: true }`).
  window.history.replaceState(null, "", `/?seed=${SEED}&loop=old`);
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

  await bootGame();
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
    // #164: the notice is a SHEET with doors, never a bare sentence on a dark
    // backdrop the player can only click away — every overlay carries text AND
    // an action. It is a `.left-sheet` over the game root, not ui's modal.
    const sheetEl = root.querySelector<HTMLElement>(".left-sheet");
    expect(sheetEl).toBeTruthy();
    expect(sheetEl!.textContent).toContain("Opponent left");
    expect(sheetEl!.textContent).toContain("Bo left");
    expect(sheetEl!.textContent).toContain("this match is over");
    // The real choices are on it: finish the board solo, or leave.
    const doors = [...sheetEl!.querySelectorAll<HTMLButtonElement>(".left-doors button")]
      .map((b) => b.textContent ?? "");
    expect(doors).toContain("Finish the game");
    expect(doors.some((t) => t.startsWith("Leave"))).toBe(true);
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

// ══════════════════════════════════════════════════════════════════════════
// RANK-01 (#147) — what leaving costs in a RATED room
//
// The forfeit policy is enforced by the room (an empty seat in a live match
// loses); what this pins is the LOCAL half of it: the game tells the player
// before they commit, and applies the same loss to its own file on the way
// out, because the leaver never sees the room's `result` message.
// ══════════════════════════════════════════════════════════════════════════
describe("RANK-01 leaving a rated match", () => {
  it("publishes the rating to the room as the match boots", async () => {
    const rank = fakeRankStore();
    await reboot({ ranked: true, rank: rank.store });
    // The room's board is what both seats rate from, so the number is on the
    // wire before a single tile is laid.
    expect(room.sentCount("playerRating")).toBe(1);
    const [published] = room.sent.filter((m) => m.type === "playerRating");
    expect(published).toMatchObject({ id: "host-socket", rating: 1180, matches: 12 });
    expect(rank.loads()).toBe(1);
  });

  it("says what leaving costs, and files the loss when the player confirms", async () => {
    const rank = fakeRankStore();
    await reboot({ ranked: true, rank: rank.store });
    openMenu();
    leaveItem().click();
    await settle();
    expect(sheet()!.textContent).toContain("ranked match");
    sheetOk().click();
    await settle();

    expect(quits).toBe(1);
    // The room itself is handed back when the app unmounts the match (#121);
    // what a rated leave adds is the local filing below.
    expect(rank.filings).toHaveLength(1);
    const filed = rank.filings[0];
    // The LEAVER's own seat: filed locally, against the rival's wire id, and
    // marked so it never touches the ladder.
    expect(filed.localOnly).toBe(true);
    expect(filed.selfId).toBe("host-socket");
    expect(filed.result).toMatchObject({
      type: "result",
      winnerId: "guest-socket",
      loserId: "host-socket",
      reason: "forfeit",
    });
    expect(filed.opponent).toMatchObject({ id: "guest-socket" });
  });

  it("files nothing when the player changes their mind", async () => {
    const rank = fakeRankStore();
    await reboot({ ranked: true, rank: rank.store });
    openMenu();
    leaveItem().click();
    await settle();
    sheetCancel().click();
    await settle();
    expect(rank.filings).toHaveLength(0);
    expect(quits).toBe(0);
  });

  it("keeps a CASUAL room casual: no rating published, no warning", async () => {
    // The boot in `beforeEach` is the host-by-code path: no store, no `ranked`.
    expect(room.sentCount("playerRating")).toBe(0);
    openMenu();
    leaveItem().click();
    await settle();
    expect(sheet()!.textContent).not.toContain("ranked match");
    sheetOk().click();
    await settle();
    expect(quits).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// #164 — the stranded seat gets a dialog, a countdown, and a way to be paid
//
// The report: a player kicked by a browser resize could not get back in, and
// the player left behind got a blank dark overlay with nothing on it. These
// pin the answer through the REAL game: the reconnect window counts down in
// plain sight while play continues; the seat emptying raises a sheet whose
// every door spells out its consequence; the rated survivor can claim the
// win (and Leave claims FIRST, so walking away cannot strand an unfiled
// rating); a reject paints words and a door even with an empty reason; and
// a return takes the whole thing down.
// ══════════════════════════════════════════════════════════════════════════
const leftSheetEl = () => root.querySelector<HTMLElement>(".left-sheet");
const leftDoors = () =>
  [...root.querySelectorAll<HTMLButtonElement>(".left-doors button")].map((b) => b.textContent ?? "");
const doorByLabel = (label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>(".left-doors button")]
    .find((b) => (b.textContent ?? "").startsWith(label))!;

/**
 * Flip the client's "a match is live" mirror the way the room does: the far
 * seat asks for state and the host answers. The boot welcome's own publish
 * sits inside the session's 300 ms full-state throttle, so outwait it first —
 * otherwise the resync is coalesced away and the doors never learn there is
 * a rated match to claim.
 */
async function makeMatchLive(): Promise<void> {
  await new Promise((r) => setTimeout(r, 320));
  const before = room.sentCount("snapshot-chunk");
  session.receive({ type: "resync" });
  await settle();
  expect(room.sentCount("snapshot-chunk")).toBeGreaterThan(before);
}

/** The room's own verdict, as it broadcasts it after a survivor's claim. */
const filedWin = (): HexProtocol => ({
  type: "result",
  winnerId: "host-socket",
  loserId: "guest-socket",
  reason: "win",
  ratings: [],
  departedId: "guest-socket",
  at: Date.now(),
});

describe("#164 disconnect, departure, and the rated claim", () => {
  it("counts the reconnect window down in plain sight — the seat is held, not lost", async () => {
    const banner = document.getElementById("iso-banner")!;
    session.receive({
      type: "peerStatus", playerId: "guest-socket", status: "disconnected",
      username: "Bo", graceMs: 60_000,
    });
    await settle();
    // The wait is VISIBLE where the play continues underneath it…
    expect(banner.classList.contains("hidden")).toBe(false);
    expect(banner.textContent).toContain("Bo disconnected");
    expect(banner.textContent).toMatch(/reconnecting \d+:\d\d/);
    // …and it is a countdown, not a verdict: no sheet, no quit, seat intact.
    expect(leftSheetEl()).toBeNull();
    expect(session.hasOpponent).toBe(true);
    expect(quits).toBe(0);

    session.receive({
      type: "peerStatus", playerId: "guest-socket", status: "reconnected", username: "Bo",
    });
    await settle();
    expect(
      banner.classList.contains("hidden") || !banner.textContent!.includes("disconnected"),
    ).toBe(true);
  });

  it("the rated survivor can CLAIM the win: the ask rides out, the ledger shows the rating", async () => {
    const rank = fakeRankStore();
    await reboot({ ranked: true, rank: rank.store });
    await makeMatchLive();

    room.firePlayerLeft("guest-socket");
    await settle();

    // The sheet spells out the rating consequence on every door (#164's ask).
    const el = leftSheetEl();
    expect(el).toBeTruthy();
    expect(el!.querySelector("h2")!.textContent).toBe("Opponent left");
    expect(el!.textContent).toContain("rank points");
    const doors = leftDoors();
    expect(doors).toContain("Finish the game");
    expect(doors).toContain("Claim the win now");
    expect(doors.some((t) => t.startsWith("Leave — claim the win first"))).toBe(true);

    doorByLabel("Claim the win now").click();
    await settle();

    // The claim went to the room — the ONLY seat that may file is the one
    // that ran the simulation, and the room files from everJoined even
    // though the loser's socket is already gone.
    const claim = room.sent.find((m) => m.type === "resultClaim");
    expect(claim).toMatchObject({
      type: "resultClaim", winnerId: "host-socket", loserId: "guest-socket", reason: "win",
    });
    // The ledger replaced the sheet: the celebration AND the verdict's home.
    expect(leftSheetEl()).toBeNull();
    expect(document.getElementById("iso-ending")).toBeTruthy();

    // The room's answer lands a round trip later; the local file moves once,
    // and the ledger's rating row — "filing…" until now — fills in.
    session.receive(filedWin());
    await settle();
    expect(rank.filings).toHaveLength(1);
    expect(root.querySelector(".ending-rank-rating")?.textContent ?? "").not.toBe("");
    expect(rank.filings[0].result.winnerId).toBe("host-socket");
    expect(rank.filings[0].opponent).toMatchObject({ id: "guest-socket" });
    expect(leftSheetEl()).toBeNull();
    expect(quits).toBe(0);
  });

  it("the LEAVE door claims FIRST — walking away cannot strand an unfiled win", async () => {
    const rank = fakeRankStore();
    await reboot({ ranked: true, rank: rank.store });
    await makeMatchLive();

    room.firePlayerLeft("guest-socket");
    await settle();
    doorByLabel("Leave").click();
    await settle();

    // The claim rode out before the walk: the quit now waits on the verdict.
    expect(room.sent.some((m) => m.type === "resultClaim")).toBe(true);
    expect(leftSheetEl()).toBeNull();
    expect(quits).toBe(0);

    session.receive(filedWin());
    await settle();
    expect(rank.filings).toHaveLength(1);
    expect(quits).toBe(1);   // the rating folded into the file — the door completes
  });

  it("a HOST departure paints its reason on a sheet with a door — never a bare sentence", async () => {
    session.receive({ type: "reject", reason: HOST_LEFT_REASON });
    await settle();
    const el = leftSheetEl();
    expect(el).toBeTruthy();
    expect(el!.querySelector("h2")!.textContent).toBe("Opponent left");
    expect(el!.textContent).toContain("The host left the game");
    // No win to claim from this seat — Leave is the one honest door.
    expect(leftDoors()).toEqual(["Leave the match"]);
  });

  it("an EMPTY reject reason still paints words and a door — the blank-overlay regression", async () => {
    session.receive({ type: "reject", reason: "" });
    await settle();
    const el = leftSheetEl();
    expect(el).toBeTruthy();
    expect(el!.querySelector("h2")!.textContent).toBe("Match ended");
    expect(el!.textContent).toContain("The room ended this match");
    expect(leftDoors()).toEqual(["Leave the match"]);
  });

  it("a return after eviction takes the standing sheet down — the match resumes", async () => {
    room.firePlayerLeft("guest-socket");
    await settle();
    expect(leftSheetEl()).toBeTruthy();

    // The seat refilled and the room re-greets: the welcome's roster says
    // the far seat is back, so the sheet — and every door on it — is a lie.
    session.receive(welcome("host-socket"));
    await settle();
    expect(leftSheetEl()).toBeNull();
    expect(session.hasOpponent).toBe(true);
    expect(quits).toBe(0);
  });
});
