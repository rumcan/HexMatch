// @vitest-environment jsdom
// @vitest-environment-options {"url": "http://localhost/?loop=old"}
// L1f (#237): the new loop is the sandbox default now — this harness reads the
// RETIRED loop, so every boot in it asks for the one-release `?loop=old` hatch
// (a test that means the other loop says so itself: `{ newLoop: true }`).
//
// #186 — custom match settings, end to end through the REAL game.
//
// The unit suites pin the record and the wire (`net-match-settings.test.ts`,
// `net-room.test.ts`, `net-session.test.ts`). This one pins the thing a player
// would actually notice, and the ticket's acceptance criteria say it plainly:
//
//   * "Changing the win target to e.g. 5★ ends the game at 5★ for host and
//     guest" — both seats boot on the room's line and the match ENDS there;
//   * "Choosing Rich resources starts every player with 2× the default purse.
//     Host and guest purses match." — every seat, both browsers;
//   * "Defaults unchanged: a host who doesn't touch the settings gets exactly
//     today's game" — including a solo boot, which must ignore a settings block
//     altogether (its ★ line belongs to its difficulty);
//   * an AI seat is simulated ON THE HOST — it plays a hosted room, and it
//     never plays a seat a human has taken.
//
// Canvas/art are stubbed exactly as `iso-mp.test.ts` stubs them: this verifies
// the rules and the wiring, not pixels.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NetSession } from "../../src/net/session";
import { PROTOCOL_VERSION, type HexProtocol, type WelcomeMsg } from "../../src/net/protocol";
import type { HexRoom } from "../../src/net/transport";
import type { MatchSettings } from "../../src/net/match-settings";
import { MAP_W, MAP_H, mulberry32, setRng } from "../../src/game/config";
import { VICTORY } from "../../src/iso/config";
import { buildTile } from "../../src/iso/track";

// ── stub the art imports (vite handles these in the browser) ──────────────
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

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
  class FakeImage {
    width = 1024; height = 1024;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) { queueMicrotask(() => this.onload?.()); }
  }
  (globalThis as Record<string, unknown>).Image = FakeImage;
}

/** The slice of `window.__iso` this spec reads. */
interface Hook {
  phase: string;
  track: { dirt: Uint8Array; road: Uint8Array; owner: Uint8Array; upgraded: Uint8Array };
  eco: { factories: { owner: string; ownerId: number; tx: number; ty: number }[] };
  harvesters: { id: number; owner: string; ownerId: number; tx: number; ty: number }[];
  purse: Record<string, number>;
  vp: { you: number; ai: number };
  vpTarget: number;
  rivalSkill: { key: string; label: string };
  /** #186: the seats, both of them, and the rules this match booted with. */
  players: { i: number; id: string; name: string; human: boolean; purse: Record<string, number>; vp: number }[];
  matchSettings: MatchSettings;
  aiSeat: boolean;
  placeFactory: (tx: number, ty: number) => boolean;
  placeDepot: (tx: number, ty: number) => boolean;
  finishSetup: () => void;
  demolish: (tx: number, ty: number) => void;
  aiTick: (now?: number) => void;
  placementPlan: (kind: "factory" | "depot", tx: number, ty: number) => { valid: boolean; why: string | null };
}

const hook = () => (window as unknown as { __iso: Hook }).__iso;
const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};

// ── the in-process relay (the shape `iso-mp.test.ts` uses) ────────────────
class Endpoint {
  readonly sent: HexProtocol[] = [];
  queue: HexProtocol[] = [];
  peer: Endpoint | null = null;
  isCreator = false;
  latency = 3;
  connectionState = "connected" as const;
  private handlers: Record<string, ((m: never) => void) | undefined> = {};

  constructor(readonly playerId: string, readonly roomCode: string) {}

  on(events: Record<string, (m: never) => void>): void {
    Object.assign(this.handlers, events);
  }
  send(msg: HexProtocol): void {
    this.sent.push(structuredClone(msg));
    this.queue.push(structuredClone(msg));
  }
  deliver(msg: HexProtocol): void {
    const copy = structuredClone(msg);
    this.handlers.onMessage?.(copy as never);
  }
  deliverPrivate(msg: HexProtocol): void {
    const copy = structuredClone(msg);
    this.handlers.onPrivateMessage?.(copy as never);
  }
  leave(): void {}
}

const asRoom = (e: Endpoint): HexRoom => e as unknown as HexRoom;

let endpoints: Endpoint[] = [];
function pump(): void {
  for (let guard = 0; guard < 500; guard++) {
    let moved = false;
    for (const e of endpoints) {
      if (e.queue.length === 0) continue;
      const batch = e.queue;
      e.queue = [];
      moved = true;
      for (const m of batch) e.peer?.deliver(m);
    }
    if (!moved) return;
  }
  throw new Error("pump() never settled");
}

const SEED = 1337;
let roots: HTMLDivElement[] = [];
let disposers: (() => void)[] = [];

beforeEach(() => {
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
  endpoints = [];
});

afterEach(() => {
  for (const d of disposers) d();
  disposers = [];
  for (const r of roots) r.remove();
  roots = [];
  vi.restoreAllMocks();
});

async function boot(role: "solo" | "host" | "guest", net: NetSession | null, settings?: MatchSettings | null): Promise<Hook> {
  const root = document.createElement("div");
  Object.defineProperty(root, "clientWidth", { value: 900, configurable: true });
  Object.defineProperty(root, "clientHeight", { value: 700, configurable: true });
  document.body.appendChild(root);
  roots.push(root);
  const { startIsoGame } = await import("../../src/iso/game");
  disposers.push(startIsoGame(root, { seed: SEED, role, net, settings }));
  await settle();
  return hook();
}

/** A room pair, welcomed. `guestSeated: false` is a host waiting alone. */
function roomPair(guestSeated: boolean, settings?: MatchSettings) {
  const hostEnd = new Endpoint("host-socket", "HX9KWR");
  const guestEnd = new Endpoint("guest-socket", "HX9KWR");
  hostEnd.peer = guestEnd;
  guestEnd.peer = hostEnd;
  endpoints = [hostEnd, guestEnd];
  const roster: WelcomeMsg["roster"] = [
    { id: hostEnd.playerId, username: "Ada", slot: 0 },
    ...(guestSeated ? [{ id: guestEnd.playerId, username: "Bo", slot: 1 }] : []),
  ];
  const greeting: WelcomeMsg = {
    type: "welcome",
    seed: SEED,
    hostId: hostEnd.playerId,
    protocolVersion: PROTOCOL_VERSION,
    roster,
    ...(settings ? { settings } : {}),
  };
  return { hostEnd, guestEnd, greeting };
}

/** Pave `count` tiles for `ownerId` and rescore, the way iso-game.test.ts does. */
function pave(h: Hook, ownerId: number, count: number): void {
  // `rescore` reads a track owner NUMBER back as a player through the
  // structures that carry both identities, so a seat with nothing on the board
  // scores nothing. The opening plant (id 0) is the seat's identity and is not
  // itself a point.
  if (!h.eco.factories.some((f) => f.ownerId === ownerId)) {
    h.eco.factories.push({
      owner: ownerId === 1 ? "you" : "ai",
      ownerId,
      tx: ownerId === 1 ? MAP_W - 8 : MAP_W - 4,
      ty: ownerId === 1 ? MAP_H - 8 : MAP_H - 4,
    });
  }
  let paved = 0;
  let trigger: [number, number] | null = null;
  for (let y = 0; y < MAP_H && !trigger; y++) {
    for (let x = 0; x < MAP_W && !trigger; x++) {
      const i = y * MAP_W + x;
      if (h.track.dirt[i] || h.track.road[i]) continue;
      if (paved < count) {
        buildTile(h.track, "dirt", x, y, ownerId);
        buildTile(h.track, "road", x, y, ownerId);
        paved++;
      } else {
        buildTile(h.track, "dirt", x, y, ownerId);
        trigger = [x, y];
      }
    }
  }
  expect(paved).toBe(count);
  h.finishSetup();
  h.demolish(trigger![0], trigger![1]);
}

const RICH: MatchSettings = { aiSeats: [], winTarget: 5, startPurse: { wood: 24, stone: 24, ore: 0 } };

describe("#186 defaults unchanged", () => {
  it("boots a hosted room nobody customised on today's purse and ★ line", async () => {
    const { hostEnd, guestEnd, greeting } = roomPair(true);
    const hostNet = new NetSession({ room: asRoom(hostEnd), role: "host" });
    const guestNet = new NetSession({ room: asRoom(guestEnd), role: "guest" });
    greeted([hostNet, guestNet], greeting);
    const host = await boot("host", hostNet);
    const guest = await boot("guest", guestNet);
    pump();
    expect(host.vpTarget).toBe(VICTORY.target);
    expect(guest.vpTarget).toBe(VICTORY.target);
    expect(host.players[0].purse).toMatchObject({ wood: 12, stone: 12, ore: 0 });
    expect(guest.players[0].purse).toMatchObject({ wood: 12, stone: 12, ore: 0 });
    expect(host.aiSeat).toBe(false);
  });

  it("ignores a settings block on a solo boot — the difficulty owns that line", async () => {
    // A solo game's ★ line comes from `RIVAL_SKILLS`, and a contract's from its
    // chapter. Letting a settings block move either would give one rule two
    // owners, so solo reads the defaults whatever it is handed.
    localStorage.setItem("hexmatch:rival-skill", "normal");
    const h = await boot("solo", null, RICH);
    expect(h.vpTarget).toBe(VICTORY.target);
    expect(h.players[0].purse).toMatchObject({ wood: 12, stone: 12, ore: 0 });
  });
});

describe("#186 the room's rules reach both seats", () => {
  it("runs a 5★ race with a Rich purse, identically on host and guest", async () => {
    const { hostEnd, guestEnd, greeting } = roomPair(true, RICH);
    const hostNet = new NetSession({ room: asRoom(hostEnd), role: "host" });
    const guestNet = new NetSession({ room: asRoom(guestEnd), role: "guest" });
    greeted([hostNet, guestNet], greeting);
    const host = await boot("host", hostNet, RICH);
    const guest = await boot("guest", guestNet);
    pump();

    // "first to 5★" on both — the HUD badge reads `winTarget()` too.
    expect(host.vpTarget).toBe(5);
    expect(guest.vpTarget).toBe(5);
    // "every player starts with 2× the default purse. Host and guest purses
    // match." — both seats on both browsers, mirrored into each one's own frame.
    for (const seat of host.players) expect(seat.purse).toMatchObject({ wood: 24, stone: 24, ore: 0 });
    for (const seat of guest.players) expect(seat.purse).toMatchObject({ wood: 24, stone: 24, ore: 0 });
    expect(host.matchSettings).toEqual(RICH);
  });

  it("ends the match at the room's ★ line, on the seat that crosses it", async () => {
    const { hostEnd, guestEnd, greeting } = roomPair(true, RICH);
    const hostNet = new NetSession({ room: asRoom(hostEnd), role: "host" });
    const guestNet = new NetSession({ room: asRoom(guestEnd), role: "guest" });
    greeted([hostNet, guestNet], greeting);
    const host = await boot("host", hostNet, RICH);
    const guest = await boot("guest", guestNet);
    pump();

    // 20 paves × 0.25★ = 5★: a mid-game score on the shipped 10★ line, and the
    // whole race on the room's 5★ one.
    pave(host, 1, 20);
    expect(host.vp.you).toBe(5);
    expect(host.phase).toBe("won");
    // The winner rides the host's next heartbeat, so the frame has to run
    // before the wire has anything to carry — and the guest holds deltas until
    // the join snapshot it asked for has landed, so the wire is walked a few
    // times rather than once.
    for (let i = 0; i < 6; i++) { await settle(); pump(); }
    // …and the guest agrees, from the wire: one finish line, two browsers.
    expect(guest.phase).toBe("won");
  });

  it("keeps the same 20 paves mid-game on the shipped line", async () => {
    const { hostEnd, guestEnd, greeting } = roomPair(true);
    const hostNet = new NetSession({ room: asRoom(hostEnd), role: "host" });
    const guestNet = new NetSession({ room: asRoom(guestEnd), role: "guest" });
    greeted([hostNet, guestNet], greeting);
    const host = await boot("host", hostNet);
    await boot("guest", guestNet);
    pump();
    pave(host, 1, 20);
    expect(host.vp.you).toBe(5);
    expect(host.phase).toBe("play");
  });
});

describe("#186 an AI seat is simulated on the host", () => {
  it("fills the empty seat with a machine the host started early against", async () => {
    const { hostEnd, greeting } = roomPair(false, { ...RICH, aiSeats: ["easy"] });
    const hostNet = new NetSession({ room: asRoom(hostEnd), role: "host" });
    greeted([hostNet], greeting);
    const host = await boot("host", hostNet, { ...RICH, aiSeats: ["easy"] });
    pump();

    expect(host.aiSeat).toBe(true);
    expect(host.matchSettings.aiSeats).toEqual(["easy"]);
    // The seat's difficulty is the ROOM's pick, not this browser's last solo one.
    expect(host.rivalSkill.key).toBe("easy");

    // The opening: the host places its Factory and the machine is seated
    // exactly as it is in solo — nobody is there to click for it.
    const spot = findFactorySpot(host);
    expect(spot).toBeTruthy();
    expect(host.placeFactory(spot![0], spot![1])).toBe(true);
    expect(host.eco.factories.some((f) => f.ownerId === 2)).toBe(true);
    host.finishSetup();
    expect(host.phase).toBe("play");

    // …and then it PLAYS. The turn is the shipped `aiTick`, so a depot or a
    // paved tile appearing under owner 2 is the machine moving, on the host.
    let acted = false;
    for (let step = 1; step <= 40 && !acted; step++) {
      host.aiTick(step * 12_000);
      acted = host.harvesters.some((d) => d.ownerId === 2)
        || countOwned(host, 2) > 0;
    }
    expect(acted).toBe(true);
  });

  it("never plays a seat a human has taken", async () => {
    // The AI is the FILLER. With a guest in the room the seat belongs to the
    // guest, and a machine playing it would be a third player on their board.
    const rules: MatchSettings = { ...RICH, aiSeats: ["easy"] };
    const { hostEnd, guestEnd, greeting } = roomPair(true, rules);
    const hostNet = new NetSession({ room: asRoom(hostEnd), role: "host" });
    const guestNet = new NetSession({ room: asRoom(guestEnd), role: "guest" });
    greeted([hostNet, guestNet], greeting);
    const host = await boot("host", hostNet, rules);
    await boot("guest", guestNet);
    pump();

    expect(host.aiSeat).toBe(false);
    const spot = findFactorySpot(host);
    host.placeFactory(spot![0], spot![1]);
    host.finishSetup();
    for (let step = 1; step <= 20; step++) host.aiTick(step * 12_000);
    expect(host.harvesters.some((d) => d.ownerId === 2)).toBe(false);
    expect(countOwned(host, 2)).toBe(0);
  });

  it("runs no AI at all on a guest — the seat is synced, never simulated", async () => {
    const rules: MatchSettings = { ...RICH, aiSeats: ["easy"] };
    const { hostEnd, guestEnd, greeting } = roomPair(false, rules);
    const guestNet = new NetSession({ room: asRoom(guestEnd), role: "guest" });
    void hostEnd;
    greeted([guestNet], greeting);
    const guest = await boot("guest", guestNet, rules);
    expect(guest.aiSeat).toBe(false);
  });
});

// ── helpers ───────────────────────────────────────────────────────────────

/**
 * Hand each seat its welcome BEFORE the game boots — the order a real match
 * happens in. The lobby's Play button stays disabled until the room has
 * introduced itself, so a game always mounts onto a session that already knows
 * its roster, its seed and (#186) its rules.
 */
function greeted(sessions: NetSession[], greeting: WelcomeMsg): void {
  for (const session of sessions) session.receive(greeting);
  for (const e of endpoints) e.deliver(greeting);
}

function countOwned(h: Hook, owner: number): number {
  let n = 0;
  for (let i = 0; i < h.track.owner.length; i++) if (h.track.owner[i] === owner) n++;
  return n;
}

/** A legal Factory site: dry, unoccupied, and beside a town (the game's rule). */
function findFactorySpot(h: Hook): [number, number] | null {
  for (let y = 6; y < MAP_H - 6; y++) {
    for (let x = 6; x < MAP_W - 6; x++) {
      if (h.placementPlan("factory", x, y).valid) return [x, y];
    }
  }
  return null;
}
