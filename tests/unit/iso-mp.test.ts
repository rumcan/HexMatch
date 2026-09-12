// @vitest-environment jsdom
//
// MP-05 — the acceptance test, end to end through the REAL game.
//
// Two `startIsoGame` instances boot in one jsdom page (a host and a guest),
// each wired to a real `NetSession` over an in-process room pair. The room
// forwards exactly what the gateway forwards — a `send` from one side lands on
// the other side's `onMessage` — but nothing is delivered until the test calls
// `pump()`, so "the guest has not been told yet" is an observable state rather
// than a race.
//
// The ticket's done-when is asserted literally:
//   * "Guest renders host's map" — the host's Factory (and every later tile)
//     appears on the guest, mirrored into the guest's own seats, and the two
//     games' track layers are byte-identical under that mirror.
//   * "Guest builds via intent" — a guest placement mutates NOTHING locally
//     until the host has applied it and answered; the tile the host commits
//     carries the guest's seat owner byte.
//
// Canvas/art are stubbed (jsdom has no 2D context and the atlas is a Vite
// asset), the same way `iso-game.test.ts` stubs them: this verifies the wiring
// and the rules, not pixels.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NetSession, mirrorOwnerByte } from "../../src/net/session";
import { PROTOCOL_VERSION, type HexProtocol, type WelcomeMsg } from "../../src/net/protocol";
import type { HexRoom } from "../../src/net/transport";
import { MAP_W, MAP_H, mulberry32, setRng, SABOTAGE } from "../../src/game/config";
import { WATER, factoryTouchesTown, type Grid } from "../../src/iso/grid";
import { tIdx, type Track } from "../../src/iso/track";

// ── stub the art imports (vite handles these in the browser) ──────────────
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

/** A no-op 2D context good enough for the renderer's call pattern. */
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

/** Images resolve immediately so the async boot completes. */
function stubImage() {
  class FakeImage {
    width = 1024; height = 1024;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) { queueMicrotask(() => this.onload?.()); }
  }
  (globalThis as Record<string, unknown>).Image = FakeImage;
}

// ── the game's window.__iso hook, narrowed to what this spec reads ────────
interface MpHook {
  phase: string;
  grid: Grid;
  track: Track;
  factories: { owner: string; tx: number; ty: number }[];
  harvesters: { id: number; owner: string; tx: number; ty: number }[];
  purse: Record<string, number>;
  freeTrack: number;
  vp: { you: number; ai: number };
  placeFactory: (tx: number, ty: number) => boolean;
  placeDepot: (tx: number, ty: number) => boolean;
  dragBuild: (
    kind: "dirt" | "road", ax: number, ay: number, bx: number, by: number, xFirst?: boolean,
  ) => { tiles: { tx: number; ty: number }[] } | null;
  dragPreview: (
    kind: "dirt" | "road", ax: number, ay: number, bx: number, by: number, xFirst?: boolean,
  ) => { tiles: { tx: number; ty: number }[] } | null;
  placementPlan: (
    kind: "factory" | "depot", tx: number, ty: number,
  ) => { valid: boolean; why: string | null };
  trucksList: unknown[];
  truckTick: (now?: number, dtMs?: number) => void;
  /** PP-14b: the Black Market twin (refuses on a guest, exactly as the click
   *  path does) and the rival plant it sabotages. */
  buyBlack: (key: string) => void;
  rivalPlant: {
    status: (now: number) => { frozen: number; girders: number; smog: boolean };
    board: import("../../src/game/board").Board;
  };
  /** PP-14b: the local plant board — where the guest applies the host's
   *  sabotage overlay. */
  board: import("../../src/game/board").Board;
}

const hook = () => (window as unknown as { __iso: MpHook }).__iso;
const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
};

// ── the in-process relay ──────────────────────────────────────────────────
//
// Each end records what it sent and what it received, and `send` only QUEUES:
// `pump()` is the network. That one property is what makes "the guest has not
// heard the host yet" assertable.
class Endpoint {
  readonly sent: HexProtocol[] = [];
  readonly inbox: HexProtocol[] = [];
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
  /** Delivery, as the gateway does it: `broadcast` → `onMessage`. */
  deliver(msg: HexProtocol): void {
    const copy = structuredClone(msg);
    this.inbox.push(copy);
    this.handlers.onMessage?.(copy as never);
  }
  /** `sendTo` → `onPrivateMessage`. The room greets a newcomer on BOTH. */
  deliverPrivate(msg: HexProtocol): void {
    const copy = structuredClone(msg);
    this.inbox.push(copy);
    this.handlers.onPrivateMessage?.(copy as never);
  }
  leave(): void {}
}

const asRoom = (e: Endpoint): HexRoom => e as unknown as HexRoom;

let endpoints: Endpoint[] = [];
/** Deliver everything both sides have sent, including what they send back. */
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
  throw new Error("pump() never settled — the two games are chatting in a loop");
}

function greet(msg: WelcomeMsg, privateTo?: Endpoint): void {
  for (const e of endpoints) e.deliver(msg);
  privateTo?.deliverPrivate(msg);
}

// ── booting the two games ─────────────────────────────────────────────────
let roots: HTMLDivElement[] = [];
let disposers: (() => void)[] = [];

beforeEach(() => {
  stubCanvas();
  stubImage();
  window.history.replaceState(null, "", "/?seed=1337");
  localStorage.removeItem("hexmatch:save");
  localStorage.setItem("hexmatch:rival-skill", "normal");
  setRng(mulberry32(1337));
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

/** Mount one game into its own root and hand back its live `__iso` hook. */
async function boot(
  role: "host" | "guest", net: NetSession,
): Promise<MpHook> {
  const root = document.createElement("div");
  Object.defineProperty(root, "clientWidth", { value: 900, configurable: true });
  Object.defineProperty(root, "clientHeight", { value: 700, configurable: true });
  document.body.appendChild(root);
  roots.push(root);
  const { startIsoGame } = await import("../../src/iso/game");
  disposers.push(startIsoGame(root, { seed: SEED, role, net }));
  await settle();
  // Capture the hook before the next boot overwrites `window.__iso`: the
  // object is per-game, and the reference stays live.
  return hook();
}

const SEED = 1337;

/** The wire roster both sides must agree on: host slot 0, guest slot 1. */
function welcomeFor(hostEnd: Endpoint, guestEnd: Endpoint, hostOnly: boolean): WelcomeMsg {
  return {
    type: "welcome",
    seed: SEED,
    hostId: hostEnd.playerId,
    protocolVersion: PROTOCOL_VERSION,
    roster: [
      { id: hostEnd.playerId, username: "Ada", slot: 0 },
      ...(hostOnly ? [] : [{ id: guestEnd.playerId, username: "Bo", slot: 1 }]),
    ],
  };
}

// ── fixture helpers (the same rules `iso-game.test.ts` uses) ──────────────
function findFactorySpot(grid: Grid, exclude: ReadonlySet<number> = new Set()): [number, number] | null {
  for (let y = 6; y < MAP_H - 6; y++) {
    for (let x = 6; x < MAP_W - 6; x++) {
      let ok = true;
      for (let dy = 0; dy < 2 && ok; dy++) {
        for (let dx = 0; dx < 2 && ok; dx++) {
          const i = (y + dy) * MAP_W + (x + dx);
          if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1 || exclude.has(i)) ok = false;
        }
      }
      if (ok && !factoryTouchesTown(grid, x, y)) ok = false;
      if (ok) return [x, y];
    }
  }
  return null;
}

/** The 2×2 a factory at (x,y) stands on. */
const footprint = (x: number, y: number) =>
  new Set([tIdx(x, y), tIdx(x + 1, y), tIdx(x, y + 1), tIdx(x + 1, y + 1)]);

/** The first legal Depot site the guest's own plan accepts, near the factory. */
function findDepotSpot(h: MpHook, cx: number, cy: number): [number, number] | null {
  for (let r = 1; r <= 14; r++) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 1 || y < 1 || x >= MAP_W - 1 || y >= MAP_H - 1) continue;
        if (h.placementPlan("depot", x, y).valid) return [x, y];
      }
    }
  }
  return null;
}

/** The first legal drag from the seat's own network, searched outward. */
function findDrag(h: MpHook, cx: number, cy: number): [number, number, number, number] | null {
  for (let r = 1; r <= 10; r++) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
          const bx = x + dx * 2, by = y + dy * 2;
          if (h.dragPreview("dirt", x, y, bx, by)) return [x, y, bx, by];
        }
      }
    }
  }
  return null;
}

/** Count the tiles `owner` byte carries, one seat's footprint of the map. */
function ownedTiles(track: Track, owner: number): number {
  let n = 0;
  for (let i = 0; i < track.owner.length; i++) if (track.owner[i] === owner) n++;
  return n;
}

/** The guest's world IS the host's, expressed in the guest's own seats. */
function expectMirrored(hostTrack: Track, guestTrack: Track, ctx: string): void {
  expect(Array.from(guestTrack.dirt), `${ctx}: dirt layer`).toEqual(Array.from(hostTrack.dirt));
  expect(Array.from(guestTrack.road), `${ctx}: road layer`).toEqual(Array.from(hostTrack.road));
  expect(Array.from(guestTrack.upgraded), `${ctx}: pave layer`).toEqual(Array.from(hostTrack.upgraded));
  const mirrored = Array.from(hostTrack.owner, mirrorOwnerByte);
  expect(Array.from(guestTrack.owner), `${ctx}: owner layer (mirrored)`).toEqual(mirrored);
}

// ── the tests ────────────────────────────────────────────────────────────

describe("MP-05 two real games, one room", () => {
  it("the guest renders the host's map, in its own seats", async () => {
    const hostEnd = new Endpoint("host-socket", "HX9KWR");
    const guestEnd = new Endpoint("guest-socket", "HX9KWR");
    hostEnd.peer = guestEnd;
    guestEnd.peer = hostEnd;
    endpoints = [hostEnd, guestEnd];

    const hostSession = new NetSession({ room: asRoom(hostEnd), role: "host" });
    const guestSession = new NetSession({ room: asRoom(guestEnd), role: "guest" });
    const host = await boot("host", hostSession);
    const guest = await boot("guest", guestSession);

    // Both sides learn where they are. The host's own welcome names only
    // itself; the guest's carries the full roster, and the host hears about
    // the second seat through the room's join broadcast (second welcome).
    greet(welcomeFor(hostEnd, guestEnd, true));
    greet(welcomeFor(hostEnd, guestEnd, false), guestEnd);
    pump();

    // A fresh guest seats nothing of its own.
    expect(guest.factories).toEqual([]);
    expect(guest.harvesters).toEqual([]);
    // …and the maps agree, because the seed came from the room.
    expect(guest.grid.industries.map((i) => [i.tx, i.ty, i.type]))
      .toEqual(host.grid.industries.map((i) => [i.tx, i.ty, i.type]));

    // The host opens: its Factory goes down locally and crosses the wire.
    const hostSpot = findFactorySpot(host.grid);
    expect(hostSpot).not.toBeNull();
    expect(host.placeFactory(hostSpot![0], hostSpot![1])).toBe(true);
    expect(guest.factories).toEqual([]);            // nothing has crossed yet
    pump();
    expect(host.factories).toHaveLength(1);
    expect(host.factories[0]).toMatchObject({ owner: "you", tx: hostSpot![0], ty: hostSpot![1] });
    // The guest renders it as the RIVAL seat: "me" is players[0] everywhere in
    // the UI, and the guest's own seat is pixels away, not owner "you".
    expect(guest.factories).toHaveLength(1);
    expect(guest.factories[0]).toMatchObject({ owner: "ai", tx: hostSpot![0], ty: hostSpot![1] });
    // The guest still has to seat its own Factory.
    expect(guest.phase).toBe("setup-factory");
    // The world layers are identical under the seat mirror — including the
    // town and public roads the host stamped at boot.
    expectMirrored(host.track, guest.track, "after the host's opening");
  });

  it("a guest's build is an intent: nothing moves locally until the host answers", async () => {
    const hostEnd = new Endpoint("host-socket", "HX9KWR");
    const guestEnd = new Endpoint("guest-socket", "HX9KWR");
    hostEnd.peer = guestEnd;
    guestEnd.peer = hostEnd;
    endpoints = [hostEnd, guestEnd];

    const hostSession = new NetSession({ room: asRoom(hostEnd), role: "host" });
    const guestSession = new NetSession({ room: asRoom(guestEnd), role: "guest" });
    const host = await boot("host", hostSession);
    const guest = await boot("guest", guestSession);

    greet(welcomeFor(hostEnd, guestEnd, true));
    greet(welcomeFor(hostEnd, guestEnd, false), guestEnd);
    pump();

    const hostSpot = findFactorySpot(host.grid)!;
    host.placeFactory(hostSpot[0], hostSpot[1]);
    pump();

    // ── the guest's opening Factory, through an intent ────────────────────
    const guestSpot = findFactorySpot(guest.grid, footprint(hostSpot[0], hostSpot[1]));
    expect(guestSpot).not.toBeNull();
    const wireBefore = guestEnd.sent.length;
    // A guest's twin returns "the intent is away", never "the factory exists".
    expect(guest.placeFactory(guestSpot![0], guestSpot![1])).toBe(true);
    expect(guestEnd.sent.slice(wireBefore).map((m) => m.type)).toEqual(["intent"]);
    expect(guestEnd.sent[wireBefore]).toMatchObject({
      type: "intent", action: "build", payload: { do: "factory", tx: guestSpot![0], ty: guestSpot![1] },
    });
    // The local world is UNTOUCHED — a guest renders the host's world, not its
    // own guess at it.
    expect(guest.factories.some((f) => f.owner === "you")).toBe(false);
    expect(host.factories.some((f) => f.owner === "ai")).toBe(false);

    pump();
    // The host applied it to the GUEST's seat (wire seat 1 = "ai")…
    expect(host.factories).toHaveLength(2);
    expect(host.factories[1]).toMatchObject({ owner: "ai", tx: guestSpot![0], ty: guestSpot![1] });
    // …and the answer teaches the guest that it is its own.
    expect(guest.factories).toHaveLength(2);
    expect(guest.factories.find((f) => f.owner === "you"))
      .toMatchObject({ tx: guestSpot![0], ty: guestSpot![1] });
    expect(guest.phase).toBe("setup-harvester");

    // ── the guest's opening Depot, same story ─────────────────────────────
    const depotSpot = findDepotSpot(guest, guestSpot![0], guestSpot![1]);
    expect(depotSpot).not.toBeNull();
    guest.placeDepot(depotSpot![0], depotSpot![1]);
    expect(guest.harvesters).toEqual([]);                 // still nothing local
    pump();
    expect(guest.harvesters).toHaveLength(1);
    expect(guest.harvesters[0]).toMatchObject({ owner: "you", tx: depotSpot![0], ty: depotSpot![1] });
    expect(host.harvesters.find((h) => h.owner === "ai"))
      .toMatchObject({ tx: depotSpot![0], ty: depotSpot![1] });
    // Seated: the guest is in play, with no economy of its own to get here.
    expect(guest.phase).toBe("play");

    // ── a guest's track drag ──────────────────────────────────────────────
    const drag = findDrag(guest, guestSpot![0], guestSpot![1]);
    expect(drag).not.toBeNull();
    const [ax, ay, bx, by] = drag!;
    const guestOwnBefore = ownedTiles(guest.track, 1);
    const preview = guest.dragBuild("dirt", ax, ay, bx, by, true);
    expect(preview!.tiles.length).toBeGreaterThan(0);
    // Not one tile of it is on the guest's board yet: the preview is a
    // preview, and the commit happens on the host.
    expect(ownedTiles(guest.track, 1)).toBe(guestOwnBefore);
    expect(guest.track.dirt[tIdx(ax, ay)]).toBe(0);

    pump();
    // The host laid it for the guest's seat (owner byte 2 = its "ai"), and the
    // guest reads the same tiles as its own (owner byte 1).
    expect(host.track.dirt[tIdx(ax, ay)]).not.toBe(0);
    expect(host.track.owner[tIdx(ax, ay)]).toBe(2);
    expect(guest.track.dirt[tIdx(ax, ay)]).not.toBe(0);
    expect(guest.track.owner[tIdx(ax, ay)]).toBe(1);
    expect(ownedTiles(guest.track, 1)).toBeGreaterThan(guestOwnBefore);
    // And the two worlds are still the same world.
    expectMirrored(host.track, guest.track, "after the guest's drag");
    expect(guest.vp).toEqual(host.vp);
  });

  it("a guest never runs the host's game: no AI on either seat, no save", async () => {
    const hostEnd = new Endpoint("host-socket", "HX9KWR");
    const guestEnd = new Endpoint("guest-socket", "HX9KWR");
    hostEnd.peer = guestEnd;
    guestEnd.peer = hostEnd;
    endpoints = [hostEnd, guestEnd];

    const hostSession = new NetSession({ room: asRoom(hostEnd), role: "host" });
    const guestSession = new NetSession({ room: asRoom(guestEnd), role: "guest" });
    const host = await boot("host", hostSession);
    const guest = await boot("guest", guestSession);
    greet(welcomeFor(hostEnd, guestEnd, true));
    greet(welcomeFor(hostEnd, guestEnd, false), guestEnd);
    pump();

    const hostSpot = findFactorySpot(host.grid)!;
    host.placeFactory(hostSpot[0], hostSpot[1]);
    pump();
    expect(guest.factories.map((f) => f.owner)).toEqual(["ai"]);
    const guestWorld = Array.from(guest.track.owner);

    // §9: seat 1 in a hosted game is a PERSON, so the host runs no AI for it —
    // an AI that were still ticking would own tiles within a frame or two
    // (`aiTick`'s first act is not gated on a whole turn). And a guest runs
    // nothing at all: its board only ever changes when the host says so.
    await settle();
    expect(guest.factories.map((f) => f.owner)).toEqual(["ai"]);
    expect(guest.harvesters).toEqual([]);
    expect(guest.phase).toBe("setup-factory");
    expect(Array.from(guest.track.owner)).toEqual(guestWorld);
    expect(ownedTiles(host.track, 2)).toBe(0);
    expect(host.factories).toHaveLength(1);

    // §9: no vehicle movement on a guest. The twin is the same planner and
    // integrator the rAF frame calls, and on a guest it must leave the fleet
    // alone: the guest's roads stay empty rather than carrying a locally
    // simulated convoy that disagrees with the host's.
    expect(guest.trucksList).toEqual([]);
    guest.truckTick(performance.now(), 60_000);
    expect(guest.trucksList).toEqual([]);

    // Neither side writes a save: a mid-room refresh must never come back as a
    // solo world (and the guest must not restore a map the host never grew).
    expect(localStorage.getItem("hexmatch:save")).toBeNull();
  });

  it("the host's Black Market sabotage shows up on the guest's plant", async () => {
    const hostEnd = new Endpoint("host-socket", "HX9KWR");
    const guestEnd = new Endpoint("guest-socket", "HX9KWR");
    hostEnd.peer = guestEnd;
    guestEnd.peer = hostEnd;
    endpoints = [hostEnd, guestEnd];

    const hostSession = new NetSession({ room: asRoom(hostEnd), role: "host" });
    const guestSession = new NetSession({ room: asRoom(guestEnd), role: "guest" });
    const host = await boot("host", hostSession);
    const guest = await boot("guest", guestSession);

    greet(welcomeFor(hostEnd, guestEnd, true));
    greet(welcomeFor(hostEnd, guestEnd, false), guestEnd);
    pump();

    // Neither plant is wrecked yet.
    expect(guest.board.gems().filter((g) => g.hard > 0)).toHaveLength(0);
    expect(guest.rivalPlant.status(performance.now()).frozen).toBe(0);

    // The host buys Frost Tiles against the rival (the guest's seat).
    host.purse.gold = SABOTAGE.harden.gold;
    host.buyBlack("harden");
    // The host's own plant is untouched; the RIVAL plant (seat 1) is frozen.
    expect(host.rivalPlant.status(performance.now()).frozen).toBeGreaterThan(0);

    // Nothing has crossed the wire yet…
    expect(guest.board.gems().filter((g) => g.hard > 0)).toHaveLength(0);
    pump();
    // …and now the guest's OWN plant board shows the frost (sabotage targets
    // seat 1 = the guest itself, so it is applied WITHOUT seat mirroring).
    expect(guest.board.gems().filter((g) => g.hard > 0).length).toBeGreaterThan(0);
    // The host's own seat (the guest's rivalPlant) was never sabotaged.
    expect(guest.rivalPlant.status(performance.now()).frozen).toBe(0);

    // Girders cross the wire the same way.
    host.purse.gold = SABOTAGE.block.gold;
    host.buyBlack("block");
    pump();
    expect(guest.board.gems().filter((g) => g.block).length).toBeGreaterThan(0);

    // Smog too — the guest's board reads as smogged.
    host.purse.gold = SABOTAGE.fog.gold;
    host.buyBlack("fog");
    pump();
    expect(guest.board.fogUntil).toBeGreaterThan(performance.now());
  });
});
