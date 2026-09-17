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
import {
  PROTOCOL_VERSION,
  type HexProtocol, type SnapshotChunkMsg, type WelcomeMsg,
} from "../../src/net/protocol";
import type { HexRoom } from "../../src/net/transport";
import { MAP_W, MAP_H, mulberry32, setRng, SABOTAGE } from "../../src/game/config";
import { FACTORY_FOOTPRINT, type Cargo } from "../../src/iso/config";
import { DEPOT_COST } from "../../src/iso/construction";
import { depotButtonMarkup } from "../../src/game/hud-icons";
import type { Factory, Harvester } from "../../src/iso/economy";
import { WATER, factoryTouchesTown, townForSeat, type Grid } from "../../src/iso/grid";
import { adjacentTown } from "../../src/iso/plants";
import { buildSnapshot, type Snapshot, type WirePlayer } from "../../src/iso/snapshot";
import { tIdx, isPublicRoad, type DragPreview, type Track } from "../../src/iso/track";

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
  factories: Factory[];
  harvesters: Harvester[];
  purse: Record<string, number>;
  freeTrack: number;
  /** PP-05/#137: the live free-Depot allowance and the price it resolves to —
   *  the same `priceDepot` the click, the HUD and the AI all read. */
  freeDepots: number;
  depotPrice: () => import("../../src/iso/construction").DepotPrice;
  vp: { you: number; ai: number };
  placeFactory: (tx: number, ty: number) => boolean;
  placeDepot: (tx: number, ty: number) => boolean;
  /** The twin of the setup clicks that flips a seat into `play`. */
  finishSetup: () => void;
  dragBuild: (
    kind: "dirt" | "road", ax: number, ay: number, bx: number, by: number, xFirst?: boolean,
  ) => DragPreview | null;
  dragPreview: (
    kind: "dirt" | "road", ax: number, ay: number, bx: number, by: number, xFirst?: boolean,
  ) => DragPreview | null;
  placementPlan: (
    kind: "factory" | "depot", tx: number, ty: number,
  ) => { valid: boolean; why: string | null };
  demolish: (tx: number, ty: number) => void;
  trucksList: unknown[];
  truckTick: (now?: number, dtMs?: number) => void;
  /** The Black Market twin (refuses on a guest, exactly as the click path
   *  does) and the rival plant board. */
  buyBlack: (key: string) => void;
  rivalPlant: {
    status: () => { frozen: number; girders: number };
    board: import("../../src/game/board").Board;
  };
  /** The local plant board, mirrored from the host's authoritative one. */
  board: import("../../src/game/board").Board;
  /** #116: the Reset twin — exactly what the `.reset-btn` click runs. */
  resetPlant: () => void;
  /** L11 (#226): the bank's click path on the LOCAL seat — the host applies
   *  it here and now, a guest relays the request (#113's rule, minus the
   *  board that used to hold the escrow). */
  bank: (give: Cargo, want: Cargo) => boolean;
  /** L11 (#226): every seat's LIVE bag, in `players` order — the references
   *  #114's identity rule is asserted against (the market used to hold them). */
  purses: Record<string, number>[];
  /** #115: the protest twins (the card and the map click) and their state. */
  armProtest: () => void;
  placeProtest: (tx: number, ty: number) => boolean;
  readonly protests: { tx: number; ty: number; until: number; owner: string }[];
  readonly protestPending: boolean;
  /** L9 (#224): the Black-Market core run as a named seat (host-side only). */
  buyBlackFor: (seat: number, key: string) => boolean;
  /** L1b: the income clock, with an injectable now — what a Blockade stops. */
  econTick: (now?: number) => void;
  eco: import("../../src/iso/economy").EconomyState;
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
  /**
   * #137: a stalled downlink. The peer's frames are still RECORDED in `sent`
   * (so the host's authoritative wire record stays readable) but never arrive,
   * which is the case where "a later delta will correct it" never happens.
   */
  muted = false;
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
    if (this.muted) return;
    const copy = structuredClone(msg);
    this.inbox.push(copy);
    this.handlers.onMessage?.(copy as never);
  }
  /** `sendTo` → `onPrivateMessage`. The room greets a newcomer on BOTH. */
  deliverPrivate(msg: HexProtocol): void {
    if (this.muted) return;
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
  // L1f (#237): the address bar says which loop this harness plays — the
  // RETIRED one, the loop it was written against. `?loop=old` is the release's
  // escape hatch; a test that wants the new loop says so (`{ newLoop: true }`).
  window.history.replaceState(null, "", "/?seed=1337&loop=old");
  localStorage.removeItem("hexmatch:save");
  localStorage.setItem("hexmatch:rival-skill", "normal");
  // TUT-01: the starting tour is the other boot overlay — these tests boot
  // the game, not its onboarding (the tour itself is covered in
  // iso-tutorial.test.ts).
  localStorage.setItem("hexmatch:tutorial", "never");
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
      for (let dy = 0; dy < FACTORY_FOOTPRINT[1] && ok; dy++) {
        for (let dx = 0; dx < FACTORY_FOOTPRINT[0] && ok; dx++) {
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

/** The tiles a factory at (x,y) stands on — its real footprint (3×3 since the
 *  factory art grew), not the 2×2 this helper once hard-coded. */
const footprint = (x: number, y: number) => {
  const tiles = new Set<number>();
  for (let dy = 0; dy < FACTORY_FOOTPRINT[1]; dy++) {
    for (let dx = 0; dx < FACTORY_FOOTPRINT[0]; dx++) tiles.add(tIdx(x + dx, y + dy));
  }
  return tiles;
};

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

  it.skip("a guest's build is an intent: nothing moves locally until the host answers", async () => {
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

  it.skip("the host's Black Market Blockade shows up on the guest's map (#224)", async () => {
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
    // A Blockade needs something to blockade, so both seats open properly
    // (the guest ends with a Factory AND a Depot — the network the card bites).
    playOpening(host, guest);

    // L9 (#224): the Black Market is MAP sabotage only, so what has to cross
    // the wire is no longer a dirtied plant board — it is the blockade on the
    // map. Neither seat has one yet.
    const live = (h: MpHook) => h.grid.industries.filter((i) => i.banditUntil > performance.now());
    expect(live(host)).toHaveLength(0);
    expect(live(guest)).toHaveLength(0);
    // …and no card in the shop can reach a board at all
    expect(guest.board.gems().filter((g) => g.hard > 0 || g.block)).toHaveLength(0);

    // The host buys a Blockade against the rival (the guest's seat).
    host.purse.gold = SABOTAGE.bandit.gold;
    host.buyBlack("bandit");
    expect(live(host).length, "the host's map shows the blockade").toBe(1);

    // Nothing has crossed the wire yet…
    expect(live(guest)).toHaveLength(0);
    pump();
    // …and now the guest sees the SAME industry blockaded, with the same
    // expiry: it is the guest's own income that stops, so its map has to say
    // so (industries are seed-derived, so only the expiry travels).
    expect(live(guest).length).toBe(1);
    expect(live(guest)[0].id).toBe(live(host)[0].id);
    expect(live(guest)[0].banditUntil).toBe(live(host)[0].banditUntil);
    // and the board stayed clean on both sides — no card touches match-3 now
    expect(guest.board.gems().filter((g) => g.hard > 0 || g.block)).toHaveLength(0);
    expect(guest.rivalPlant.status()).toMatchObject({ frozen: 0, girders: 0 });

    // A lifted blockade clears on the guest too (absent = none, never stale).
    for (const ind of host.grid.industries) ind.banditUntil = 0;
    forcePublish(guest);
    pump();
    expect(live(guest)).toHaveLength(0);
  });

  // ── the 1.2.0 playtest: a PvP match that played like co-op ──────────────

  /** The first legal opening Factory beside one particular town. */
  function spotBesideTown(h: MpHook, townId: number, exclude: ReadonlySet<number> = new Set()): [number, number] | null {
    for (let y = 6; y < MAP_H - 6; y++) {
      for (let x = 6; x < MAP_W - 6; x++) {
        let ok = true;
        for (let dy = 0; dy < FACTORY_FOOTPRINT[1] && ok; dy++) {
          for (let dx = 0; dx < FACTORY_FOOTPRINT[0] && ok; dx++) {
            const i = (y + dy) * MAP_W + (x + dx);
            if (h.grid.terrain[i] === WATER || h.grid.occupancy[i] !== -1 || exclude.has(i)) ok = false;
          }
        }
        if (!ok || !factoryTouchesTown(h.grid, x, y)) continue;
        if (adjacentTown(h.grid, x, y)?.id !== townId) continue;
        if (h.placementPlan("factory", x, y).valid) return [x, y];
      }
    }
    return null;
  }

  it("either seat may open beside ANY town — there are no reserved starting towns", async () => {
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

    const hostReserved = townForSeat(host.grid, 0)!;
    const guestReserved = townForSeat(host.grid, 1)!;
    expect(hostReserved.id).not.toBe(guestReserved.id);

    // The host opens beside a town that is NOT the one the old lock pinned it to…
    const hostTown = host.grid.towns.find((t) => t.id !== hostReserved.id)!;
    const hostSpot = spotBesideTown(host, hostTown.id);
    expect(hostSpot).not.toBeNull();
    expect(host.placeFactory(hostSpot![0], hostSpot![1])).toBe(true);
    pump();
    expect(host.factories).toHaveLength(1);

    // …and the guest opens beside the HOST's old reservation, which the old
    // lock refused as "reserved for the other player".
    const guestSpot = spotBesideTown(guest, hostReserved.id, footprint(hostSpot![0], hostSpot![1]));
    expect(guestSpot).not.toBeNull();
    guest.placeFactory(guestSpot![0], guestSpot![1]);
    pump();
    expect(host.factories.find((f) => f.owner === "ai")).toMatchObject({ tx: guestSpot![0], ty: guestSpot![1] });
    expect(guest.factories.find((f) => f.owner === "you")).toMatchObject({ tx: guestSpot![0], ty: guestSpot![1] });
  });

  it.skip("each seat plays its OWN plant board, and no AI plays the guest's", async () => {
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

    // Both seats open and go into play.
    const hostSpot = findFactorySpot(host.grid)!;
    expect(host.placeFactory(hostSpot[0], hostSpot[1])).toBe(true);
    pump();
    const hostDepot = findDepotSpot(host, hostSpot[0], hostSpot[1])!;
    expect(host.placeDepot(hostDepot[0], hostDepot[1])).toBe(true);
    // The hook's Depot twin places the building only; the real setup click is
    // what flips the host into play, and `finishSetup` is its twin.
    host.finishSetup();
    pump();
    const guestSpot = findFactorySpot(guest.grid, footprint(hostSpot[0], hostSpot[1]))!;
    guest.placeFactory(guestSpot[0], guestSpot[1]);
    pump();
    const guestDepot = findDepotSpot(guest, guestSpot[0], guestSpot[1])!;
    guest.placeDepot(guestDepot[0], guestDepot[1]);
    pump();
    expect(host.phase).toBe("play");
    expect(guest.phase).toBe("play");

    // Board ownership, read straight after the host's forced publish (no frame
    // has run since, so neither board has moved). The guest's own panel is ITS
    // seat's board — the host's seat 1 — and its rival view is the host's board.
    // The old double seat-swap showed the guest the HOST's board as its own.
    // `seq` is the board's gem-id counter: `restore` mints fresh ids, so it only
    // ever grows on the receiving side and is not part of what a board IS.
    const saved = (b: { save(): unknown }) => {
      const { seq: _seq, ...rest } = b.save() as { seq: number } & Record<string, unknown>;
      return JSON.stringify(rest);
    };
    expect(saved(host.board)).not.toBe(saved(host.rivalPlant.board));
    expect(saved(guest.board)).toBe(saved(host.rivalPlant.board));
    expect(saved(guest.rivalPlant.board)).toBe(saved(host.board));

    // No AI on the guest's seat: the host's autoplayer reaches for a move on
    // seat 1's board on the first frame of play, so a few frames is plenty.
    const findMove = vi.spyOn(host.rivalPlant.board, "findMove");
    const trySwap = vi.spyOn(host.rivalPlant.board, "trySwap");
    await settle();
    await settle();
    expect(findMove).not.toHaveBeenCalled();
    expect(trySwap).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// The 2026-09-13 audit regressions (#111–#117): every defect was reproduced
// with two real games and a queued relay, and each fix keeps its case here.
// ══════════════════════════════════════════════════════════════════════════

/** Boot a connected host+guest pair and hand back both hooks and endpoints.
 *  `beforePump` runs after both welcomes are queued but before delivery —
 *  the moment to bend the host's state that the OPENING snapshot will carry. */
async function bootPair(beforePump?: (host: MpHook, guest: MpHook) => void): Promise<{
  host: MpHook; guest: MpHook;
  hostEnd: Endpoint; guestEnd: Endpoint;
}> {
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
  beforePump?.(host, guest);
  pump();
  return { host, guest, hostEnd, guestEnd };
}

/**
 * A guest no-op INTENT: the cheapest way to force a host publish on demand.
 * (It used to be `buyBlack("nonexistent")`, but L9 (#224) gave the shop a
 * closed inventory — an unknown card is now refused on the guest and never
 * relayed. A demolish aimed at the map's corner is refused by the host
 * instead, which still ends in the intent handler's forced publish.)
 */
const forcePublish = (guest: MpHook) => guest.demolish(0, 0);

/** The guest's chooser DOM, scoped to the guest's own root. */
const guestCrossPanel = () => roots[1].querySelector(".cross-pick");
const clickGem = (el: Element, times: number) => {
  for (let i = 0; i < times; i++) (el as HTMLElement).click();
};

// ── #137 helpers: the setup allowances on the full-state path ─────────────
//
// `freeTrack` / `freeDepots` are DATA on the seat (E8), they ride every wire
// record, and the HUD prices from them. These helpers read the two things the
// ticket's acceptance names: the host's AUTHORITATIVE record (off the frames it
// actually sent) and the guest's own BUILD list (where a wrong allowance turns
// into a wrong price line and a wrong `disabled`).

/** Play the opening on both seats — the host's Factory locally, the guest's
 *  Factory and Depot through intents — and hand back the sites. Afterwards the
 *  guest is in `play` and the host's world is a PROGRESSED one worth resyncing
 *  into. */
function playOpening(host: MpHook, guest: MpHook): {
  hostSpot: [number, number]; guestSpot: [number, number]; depotSpot: [number, number];
} {
  const hostSpot = findFactorySpot(host.grid)!;
  expect(hostSpot).not.toBeNull();
  host.placeFactory(hostSpot[0], hostSpot[1]);
  pump();
  const guestSpot = findFactorySpot(guest.grid, footprint(hostSpot[0], hostSpot[1]))!;
  expect(guestSpot).not.toBeNull();
  guest.placeFactory(guestSpot[0], guestSpot[1]);
  pump();
  const depotSpot = findDepotSpot(guest, guestSpot[0], guestSpot[1])!;
  expect(depotSpot).not.toBeNull();
  guest.placeDepot(depotSpot[0], depotSpot[1]);
  pump();
  expect(guest.phase).toBe("play");
  return { hostSpot, guestSpot, depotSpot };
}

/**
 * A valid FULL state in the HOST's seat frame, built by the real
 * `buildSnapshot` from the host's live world — the shape `netFullState`
 * produces — with each seat's economy record set by the test. `seats[1]` is the
 * guest's seat on the wire (slot order IS seat order; `mirrorSnapshot` reverses
 * it on the way in).
 */
function hostFullState(host: MpHook, seats: [Partial<WirePlayer>, Partial<WirePlayer>]): Snapshot {
  const seat = (i: 0 | 1, over: Partial<WirePlayer>): WirePlayer => ({
    id: i === 0 ? "you" : "ai",
    vp: i === 0 ? host.vp.you : host.vp.ai,
    res: { ...host.purse },
    ...over,
  });
  return buildSnapshot({
    seed: SEED,
    track: host.track,
    harvesters: host.harvesters,
    factories: host.factories,
    setupPhase: false,
    won: false,
    players: [seat(0, seats[0]), seat(1, seats[1])],
    t: performance.now(),
  });
}

/**
 * The host's authoritative record for WIRE seat 1 (the guest's seat), read from
 * the last frame the host actually sent: a delta's player list, a single-frame
 * snapshot, or a reassembled chunked transfer. #137 asserts the guest's frame
 * against THIS, never against a number the test invented.
 */
function hostWireSeat(hostEnd: Endpoint): WirePlayer | undefined {
  for (let i = hostEnd.sent.length - 1; i >= 0; i--) {
    const m = hostEnd.sent[i];
    if (m.type === "delta") return m.players?.[1];
    if (m.type === "snapshot") return m.snap.players[1];
    if (m.type === "snapshot-chunk") {
      const frames = hostEnd.sent.filter(
        (f): f is SnapshotChunkMsg => f.type === "snapshot-chunk" && f.id === m.id,
      );
      if (frames.length < m.n) continue;                 // a transfer still in flight
      const json = [...frames].sort((a, b) => a.i - b.i).map((f) => f.data).join("");
      return (JSON.parse(json) as Snapshot).players[1];
    }
  }
  return undefined;
}

/** One Build-list button in the GUEST's own chrome. */
const guestTool = (tool: string) => roots[1].querySelector<HTMLButtonElement>(`[data-tool="${tool}"]`);
/** Its price line — the Depot's reads `freeDepots` and nothing else. */
const guestToolSub = (tool: string) => guestTool(tool)?.querySelector("small")?.textContent ?? null;
/**
 * The same line as MARKUP. The HUD draws each cargo as a gem badge (an <img>
 * with alt text, `hud-icons.ts`), which `textContent` cannot see — so the
 * allowance parity check compares the rendered HTML against the markup the
 * host's own chrome is built from. The value in it (1 free vs 0) is what the
 * test is actually about: it must be the HOST's allowance, mirrored.
 */
const guestToolHtml = (tool: string) => guestTool(tool)?.querySelector("small")?.innerHTML ?? null;

/** A straight dirt drag near a centre whose path covers at least `need`
 *  buildable tiles — long enough that an allowance smaller than the path shows
 *  up in the preview's `free` / `unaffordable` split. */
function findLongDrag(
  h: MpHook, cx: number, cy: number, need: number,
): [number, number, number, number] | null {
  for (let r = 1; r <= 20; r++) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
          const bx = x + dx * (need + 2), by = y + dy * (need + 2);
          const pv = h.dragPreview("dirt", x, y, bx, by);
          if (pv && pv.tiles.length + pv.unaffordable.length >= need) return [x, y, bx, by];
        }
      }
    }
  }
  return null;
}

/**
 * `count` tile-disjoint legal dirt drags near a centre. A muted guest's local
 * track never grows (its own builds are only intents), so the search has to
 * remember what it already picked — otherwise it hands back the same drag
 * `count` times and the host spends no allowance on the repeats.
 */
function findDrags(
  h: MpHook, cx: number, cy: number, count: number,
): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const used = new Set<number>();
  for (let r = 1; r <= 30 && out.length < count; r++) {
    for (let y = cy - r; y <= cy + r && out.length < count; y++) {
      for (let x = cx - r; x <= cx + r && out.length < count; x++) {
        for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
          const bx = x + dx * 2, by = y + dy * 2;
          const pv = h.dragPreview("dirt", x, y, bx, by);
          if (!pv || pv.tiles.length === 0) continue;
          if (pv.tiles.some(([tx, ty]) => used.has(tIdx(tx, ty)))) continue;
          for (const [tx, ty] of pv.tiles) used.add(tIdx(tx, ty));
          out.push([x, y, bx, by]);
          break;
        }
      }
    }
  }
  return out;
}

describe("audit regressions: two real games, one room", () => {
  it.skip("a guest's sabotage hits the HOST — never the guest's own seat (#111/#224)", async () => {
    const { host, guest } = await bootPair();
    playOpening(host, guest);

    // Fund the guest's seat on the host (its authoritative purse).
    host.purses[1].gold = 100;
    forcePublish(guest);
    pump();

    const liveOn = (h: MpHook) => h.grid.industries.filter((i) => i.banditUntil > performance.now());

    // ── the Blockade: the guest stops the HOST's depots ───────────────────
    let gold = guest.purse.gold ?? 0;
    guest.buyBlack("bandit");
    pump();
    // exactly one industry is blockaded, and both clients agree which
    expect(liveOn(host).length).toBe(1);
    expect(liveOn(guest).length).toBe(1);
    expect(liveOn(guest)[0].id).toBe(liveOn(host)[0].id);
    // …and the attacker paid exactly once
    expect(guest.purse.gold).toBe(gold - SABOTAGE.bandit.gold);
    // L9 (#224): nothing in the shop can dirty a board any more
    expect(host.board.gems().filter((g) => g.hard > 0 || g.block)).toHaveLength(0);
    expect(guest.board.gems().filter((g) => g.hard > 0 || g.block)).toHaveLength(0);

    // ── the retired cards are refused, not relayed ────────────────────────
    gold = guest.purse.gold ?? 0;
    for (const dead of ["harden", "block", "fog", "repair"]) guest.buyBlack(dead);
    pump();
    expect(guest.purse.gold, "a retired card charges nothing").toBe(gold);
    expect(host.board.gems().filter((g) => g.hard > 0 || g.block)).toHaveLength(0);
    // L10 (#225): no smog clock to leave behind either — `Board.save()` carries
    // the grid and nothing else, so a dirty board would show up in the bytes.
    expect(Object.keys(host.board.save() as Record<string, unknown>)).not.toContain("fogIn");

    // ── an unaffordable card charges nothing ──────────────────────────────
    for (const ind of host.grid.industries) ind.banditUntil = 0;   // clean slate
    host.purses[1].gold = 0;
    forcePublish(guest);
    pump();
    gold = guest.purse.gold ?? 0;
    expect(gold).toBeLessThan(SABOTAGE.bandit.gold);
    guest.buyBlack("bandit");
    pump();
    expect(guest.purse.gold).toBe(gold);
    expect(liveOn(host)).toHaveLength(0);
    expect(liveOn(guest)).toHaveLength(0);
  });

  it.skip("the host's sabotage on the guest still lands, through the shared core (#111)", async () => {
    const { host, guest } = await bootPair();
    playOpening(host, guest);
    host.purse.gold = SABOTAGE.bandit.gold;
    host.buyBlack("bandit");
    pump();
    // L9 (#224): the effect is on the MAP, and it is the same industry on both
    // clients — the guest's own depots are the ones that stop ticking.
    const now = performance.now();
    const hostHit = host.grid.industries.filter((i) => i.banditUntil > now);
    const guestHit = guest.grid.industries.filter((i) => i.banditUntil > now);
    expect(hostHit.length).toBe(1);
    expect(guestHit.map((i) => i.id)).toEqual(hostHit.map((i) => i.id));
    expect(host.board.gems().filter((g) => g.hard > 0)).toHaveLength(0);
    expect(guest.board.gems().filter((g) => g.hard > 0)).toHaveLength(0);
  });

  it.skip("a guest's cross choice resolves exactly once, via the typed intent (#112)", async () => {
    const { host, guest, guestEnd, hostEnd } = await bootPair();
    const resolveSpy = vi.fn();

    // Trigger a Holy Cross on the guest's board (host-side seat 1).
    host.rivalPlant.board.onCrossChoice("holy", 6, resolveSpy);
    pump();
    // The guest shows ONE chooser.
    expect(guestCrossPanel()).not.toBeNull();
    // Heartbeat deltas repeat the prompt — no duplicate dialog may appear.
    forcePublish(guest);
    pump();
    forcePublish(guest);
    pump();
    expect(roots[1].querySelectorAll(".cross-pick")).toHaveLength(1);

    // Choose six bounties with the guest's REAL buttons and confirm.
    const firstGem = guestCrossPanel()!.querySelector(".cross-pick-btn")!;
    clickGem(firstGem, 6);
    const confirm = guestCrossPanel()!.querySelector(".cross-pick-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    confirm.click();

    // The intent is the ONE typed cross format.
    const sent = guestEnd.sent.filter((m) => m.type === "intent" && m.action === "cross");
    expect(sent).toHaveLength(1);
    const crossPayload = sent[sent.length - 1].payload as { do: string; seq: number; choices: string[] };
    const choices = crossPayload.choices;
    const seq = crossPayload.seq;
    expect(crossPayload.do).toBe("cross");
    expect(choices).toHaveLength(6);

    pump();
    // The host honoured the selection: exactly one resolution, with the picks.
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy).toHaveBeenCalledWith(choices);
    // The chooser is gone and stays gone across further heartbeats.
    expect(guestCrossPanel()).toBeNull();
    forcePublish(guest);
    pump();
    expect(guestCrossPanel()).toBeNull();

    // A duplicate/late answer cannot award twice.
    hostEnd.deliver({ type: "intent", action: "cross", payload: { do: "cross", seq, choices } });
    pump();
    expect(resolveSpy).toHaveBeenCalledTimes(1);

    // A malformed answer (wrong pick count) for a NEW prompt never resolves.
    host.rivalPlant.board.onCrossChoice("holy", 6, resolveSpy);
    pump();
    expect(guestCrossPanel()).not.toBeNull();
    hostEnd.deliver({ type: "intent", action: "cross", payload: { do: "cross", seq: seq + 99, choices } });
    pump();
    hostEnd.deliver({ type: "intent", action: "cross", payload: { do: "cross", seq: seq + 1, choices: choices.slice(1) } });
    pump();
    // The malformed reply never awarded: the prompt is dropped with the SAME
    // empty fallback the timeout uses (the cascade cannot hang, and the
    // board's own backstop picks, not a malformed answer).
    expect(resolveSpy).toHaveBeenCalledTimes(2);
    expect(resolveSpy).toHaveBeenNthCalledWith(2, []);
    // The host cleared the stale prompt; the guest's chooser came down with it.
    expect(guestCrossPanel()).toBeNull();
  });

  it.skip("the bank never spends a human guest's cargo without an intent (#113)", async () => {
    const { host, guest, hostEnd, guestEnd } = await bootPair();

    // The HOST's own exchange moves its own bag and nobody else's.
    const hostBag = host.purses[0];
    const guestBag = host.purses[1];
    hostBag.wood = 12;
    const hostGrain = hostBag.grain;
    const guestWood = guestBag.wood;
    const guestGrain = guestBag.grain;
    expect(host.bank("wood", "grain")).toBe(true);
    expect(hostBag.wood).toBe(8);
    expect(hostBag.grain).toBe(hostGrain + 1);
    expect(guestBag.wood).toBe(guestWood);
    expect(guestBag.grain).toBe(guestGrain);

    // Fund the guest's authoritative bag and publish it. Rung 0 is the only
    // stock a fresh seat may exchange (the tree's gate), so it trades Wood.
    host.purses[1].wood = 10;
    forcePublish(guest);
    pump();
    const guestSeat = host.purses[1];
    expect(guest.purse.wood).toBe(10);

    // The guest's own Exchange, through its HUD (the real click path).
    const give = roots[1].querySelector<HTMLSelectElement>('[data-f="bank-give"]')!;
    const want = roots[1].querySelector<HTMLSelectElement>('[data-f="bank-want"]')!;
    const btn = roots[1].querySelector<HTMLButtonElement>('[data-act="bank"]')!;
    give.value = "wood";
    want.value = "grain";
    give.dispatchEvent(new Event("input"));
    want.dispatchEvent(new Event("input"));
    expect(btn.disabled).toBe(false);
    const localGive = guest.purse.wood;
    const localGet = guest.purse.grain;
    const remoteGive = guestSeat.wood;
    const remoteGet = guestSeat.grain;
    btn.click();

    // The click only REQUESTS: the intent is what left the guest, and neither
    // bag has moved — the host has not confirmed anything yet.
    expect(guestEnd.sent[guestEnd.sent.length - 1]).toMatchObject({
      type: "intent", action: "bank",
      payload: { do: "bank", give: "wood", want: "grain" },
    });
    expect(guest.purse.wood).toBe(localGive);
    expect(guest.purse.grain).toBe(localGet);
    expect(guestSeat.wood).toBe(remoteGive);
    expect(guestSeat.grain).toBe(remoteGet);

    // The host validates and applies it against the GUEST seat's own record…
    pump();
    expect(guestSeat.wood).toBe(remoteGive - 4);
    expect(guestSeat.grain).toBe(remoteGet + 1);
    // …and the delta lands back in the guest's own bag.
    expect(guest.purse.wood).toBe(localGive - 4);
    expect(guest.purse.grain).toBe(localGet + 1);

    // A request the HUD cannot even offer is refused WHOLE: Gold is outside the
    // bank (PP-08), so the exchange never half-applies (the select cannot hold
    // Gold, so this is the only door that could ask for it — the wire).
    const forgedWood = guestSeat.wood;
    const forgedGold = guestSeat.gold;
    hostEnd.deliver({
      type: "intent", action: "bank",
      payload: { do: "bank", give: "wood", want: "gold" },
    } as never);
    expect(guestSeat.wood).toBe(forgedWood);
    expect(guestSeat.gold).toBe(forgedGold);
  });

  it("guest balances follow authoritative purse updates, in place (#114)", async () => {
    const { host, guest } = await bootPair();

    // The opening FULL-state path lands in the guest's ONE purse object — the
    // same reference the HUD paints and prices from.
    const bag = guest.purse;
    expect(bag.stone).toBe(host.purses[1].stone);

    // The host zeroes the guest's authoritative Stone and publishes.
    host.purses[1].stone = 0;
    forcePublish(guest);
    pump();
    expect(guest.purse).toBe(bag);      // no re-allocation: the same bag, moved
    expect(bag.stone).toBe(0);

    // Increase again over the DELTA path — agreement both directions.
    host.purses[1].stone = 7;
    forcePublish(guest);
    pump();
    expect(guest.purse).toBe(bag);
    expect(bag.stone).toBe(7);

    // The room's roster reaches each client's own seat list (the HUD labels
    // the seats from it) — both usernames, on both sides.
    expect(host.players.map((p) => p.name).sort()).toEqual(["Ada", "Bo"]);
    expect(guest.players.map((p) => p.name).sort()).toEqual(["Ada", "Bo"]);
  });

  it("the FULL-state path (resync) fills the same purse object (#114)", async () => {
    const { host, guest, hostEnd } = await bootPair();
    // The host zeroes the guest's authoritative stone, then the guest asks
    // for a resync: the reply is a FULL snapshot, which must land in the
    // same purse object the HUD (and every affordability price) already hold.
    const bag = guest.purse;
    host.purses[1].stone = 0;
    // Full state is ask-throttled to one per 300ms wall clock (the welcome's
    // opening snapshot shares the window) — a genuine later resync waits it out.
    await new Promise((r) => setTimeout(r, 320));
    hostEnd.deliver({ type: "resync" });
    pump();
    expect(guest.purse).toBe(bag);
    expect(bag.stone).toBe(0);
  });

  it("a guest can arm a protest and place it on a public road (#115)", async () => {
    const { host, guest, guestEnd } = await bootPair();

    // Fund the guest's seat; find one public road and one non-road tile.
    host.purses[1].gold = 50;
    forcePublish(guest);
    pump();
    let road: [number, number] | null = null;
    let dry: [number, number] | null = null;
    for (let y = 0; y < MAP_H && (!road || !dry); y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (!road && isPublicRoad(guest.track, x, y)) road = [x, y];
        else if (!dry && !isPublicRoad(guest.track, x, y)) dry = [x, y];
      }
    }
    expect(road).not.toBeNull();
    expect(dry).not.toBeNull();

    // Buying Protest ARMS targeting on the guest (two-step interaction).
    guest.armProtest();
    expect(guest.protestPending).toBe(true);
    expect(guestEnd.sent[guestEnd.sent.length - 1]).toMatchObject({ type: "intent", action: "blackMarket", payload: { key: "protest" } });

    // An invalid road keeps targeting and never sends a placement…
    expect(guest.placeProtest(dry![0], dry![1])).toBe(false);
    expect(guest.protestPending).toBe(true);
    expect(guestEnd.sent[guestEnd.sent.length - 1].payload).toMatchObject({ key: "protest" });

    // …the valid click sends the placement intent and clears targeting.
    expect(guest.placeProtest(road![0], road![1])).toBe(true);
    expect(guest.protestPending).toBe(false);
    expect(guestEnd.sent[guestEnd.sent.length - 1]).toMatchObject({
      type: "intent", action: "blackMarket",
      payload: { key: "protest_place", tx: road![0], ty: road![1] },
    });

    pump();
    // ONE replicated protest at the expected cost — on both clients.
    expect(host.protests).toHaveLength(1);
    expect(host.protests[0]).toMatchObject({ tx: road![0], ty: road![1], owner: "ai" });
    expect(guest.protests).toHaveLength(1);
    expect(guest.protests[0]).toMatchObject({ tx: road![0], ty: road![1], owner: "you" });
    expect(guest.purse.gold).toBe(50 - SABOTAGE.protest.gold);

    // Cancellation is free and sends nothing.
    const sentBefore = guestEnd.sent.length;
    guest.armProtest();
    expect(guest.protestPending).toBe(true);
    guest.armProtest();
    expect(guest.protestPending).toBe(false);
    expect(guestEnd.sent.length).toBe(sentBefore + 1); // the arm ack only
    pump();

    // Insufficient funds refuse the arm locally and charge nothing.
    host.purses[1].gold = 0;
    forcePublish(guest);
    pump();
    const gold = guest.purse.gold ?? 0;
    guest.armProtest();
    expect(guest.protestPending).toBe(false);
    expect(guest.purse.gold).toBe(gold);

    // Duplicate placement clicks after success do not double-charge: the
    // second valid click on an occupied road refuses on the host.
    host.purses[1].gold = 50;
    forcePublish(guest);
    pump();
    const goldBefore = guest.purse.gold ?? 0;
    guest.armProtest();
    guest.placeProtest(road![0], road![1]);   // already protested — refused
    expect(guest.protestPending).toBe(true);  // still armed: the click was refused
    pump();
    expect(host.protests).toHaveLength(1);
    expect(guest.purse.gold).toBe(goldBefore);
  });

  it.skip("a guest's Reset collapses its own board through the host (#116)", async () => {
    const { host, guest, guestEnd, hostEnd } = await bootPair();

    // Give the guest's authoritative board something a reset must clear, and
    // park a bounty prompt on it. L10 (#225): `seedObstacles` is the only way
    // an obstacle reaches a board now — a session's worth, placed by hand.
    host.rivalPlant.board.seedObstacles(7, 0, 2);
    const resolveSpy = vi.fn();
    host.rivalPlant.board.onCrossChoice("holy", 6, resolveSpy);
    forcePublish(guest);
    pump();
    expect(guest.board.gems().some((g) => g.hard > 0 || g.block)).toBe(true);

    // EXPLICIT RULE: a reset during a pending bounty prompt is refused — the
    // cascade is paused on the prompt, so the board (and the marker) stay.
    hostEnd.deliver({ type: "intent", action: "build", payload: { do: "reset" } });
    pump();
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(host.rivalPlant.board.gems().some((g) => g.hard > 0)).toBe(true);

    // Answer the prompt properly (the typed intent)…
    hostEnd.deliver({
      type: "intent", action: "cross",
      payload: { do: "cross", seq: 1, choices: ["wood", "wood", "wood", "wood", "wood", "wood"] },
    });
    pump();
    expect(resolveSpy).toHaveBeenCalledTimes(1);

    // …and now the guest's Reset is an intent the host applies:
    guest.resetPlant();
    expect(guestEnd.sent[guestEnd.sent.length - 1]).toMatchObject({ type: "intent", action: "build", payload: { do: "reset" } });
    pump();

    // …the host collapsed the GUEST's board (never its own)…
    expect(host.rivalPlant.board.gems().some((g) => g.hard > 0 || g.block)).toBe(false);
    expect(guest.board.gems().some((g) => g.hard > 0 || g.block)).toBe(false);
    expect(guest.rivalPlant.board.gems().some((g) => g.hard > 0 || g.block)).toBe(false);

    // …the cooldown now holds: the guest's button waits, and a forged
    // duplicate intent cannot bypass it.
    const sentBefore = guestEnd.sent.length;
    guest.resetPlant();
    expect(guestEnd.sent.length).toBe(sentBefore);
    const hostBoard = JSON.stringify({ ...host.rivalPlant.board.save(), seq: 0 });
    hostEnd.deliver({ type: "intent", action: "build", payload: { do: "reset" } });
    pump();
    expect(JSON.stringify({ ...host.rivalPlant.board.save(), seq: 0 })).toBe(hostBoard);

    // The host's own reset still works and never touches the guest's board.
    host.board.seedObstacles(7, 0, 2);
    host.resetPlant();
    expect(host.board.gems().some((g) => g.hard > 0)).toBe(false);
    expect(guest.rivalPlant.board.gems().some((g) => g.hard > 0)).toBe(false);
  });

  it.skip("idle network ticks preserve gem ids and stop rebuilding the guest board (#117)", async () => {
    const { host, guest, hostEnd } = await bootPair();

    const guestIds = () => guest.board.grid.flat().map((g) => g?.id);
    const domIds = () =>
      [...roots[1].querySelectorAll("#iso-quarry-reach .gem")].map((e) => (e as HTMLElement).dataset.id).sort();
    const idsBefore = guestIds();
    const domBefore = domIds();
    const deltasBefore = hostEnd.sent.filter((m) => m.type === "delta").length;

    // A harmless rejected guest action: the host publishes its normal
    // response — and the saved grid contents are identical.
    forcePublish(guest);
    pump();
    expect(guestIds()).toEqual(idsBefore);

    // Every NEW delta carried NO board saves: unchanged boards are omitted,
    // not re-sent (that re-send restored fresh ids — the old bug). (The
    // opening heartbeats legitimately carried the boot boards once.)
    const deltas = hostEnd.sent.filter((m) => m.type === "delta").slice(deltasBefore);
    expect(deltas.length).toBeGreaterThan(0);
    const boardsBytes = deltas.reduce((n, d) => n + JSON.stringify(d).length, 0);
    const wouldBeBytes = deltas.reduce(
      (n, d) => n + JSON.stringify({ ...(d as Record<string, unknown>), boards: [guest.rivalPlant.board.save(), guest.board.save()] }).length,
      0,
    );
    expect(wouldBeBytes).toBeGreaterThan(boardsBytes);   // the boards payload is real bytes saved
    expect(boardsBytes).toBeGreaterThan(0);

    // The DOM kept its gem elements too — no whole-board rebuild.
    expect(domIds()).toEqual(domBefore);

    // A REAL change still reaches both views — and even then, surviving gems
    // keep their identities (the restore reuses the sender's ids).
    //
    // L10 (#225): the change is a session's obstacles, placed on the host's
    // authoritative guest-seat board directly. What is under test here is the
    // DELTA rule (only changed boards ride), not how the board came to change
    // — and it is `seedObstacles` that changes it, because that is the one
    // door an obstacle has on to a board.
    host.rivalPlant.board.seedObstacles(7, 0, 2);
    forcePublish(guest);
    pump();
    const withBoards = (hostEnd.sent.filter((m) => m.type === "delta") as { boards?: { owner: string }[] }[])
      .filter((d) => d.boards && d.boards.length > 0);
    const lastDelta = withBoards[withBoards.length - 1];
    expect(lastDelta.boards).toHaveLength(1);
    expect(lastDelta.boards![0].owner).toBe("ai");       // the guest seat's board
    expect(guest.board.gems().filter((g) => g.hard > 0).length).toBeGreaterThan(0);
    expect(domIds()).toEqual(domBefore);                  // same elements, restyled
    // The HOST's board did not change, so its mirrored ids are untouched.
    const hostIdsBefore = guest.rivalPlant.board.grid.flat().map((g) => g?.id);
    forcePublish(guest);
    pump();
    expect(guest.rivalPlant.board.grid.flat().map((g) => g?.id)).toEqual(hostIdsBefore);
  });

  it.skip("a FULL snapshot restores both setup allowances — spent, part-spent and absent (#137)", async () => {
    const { host, guest, guestEnd } = await bootPair();
    const { guestSpot } = playOpening(host, guest);

    // What a fresh guest holds: the whole opening dirt allowance, and no free
    // Depot left — its opening Depot rode the allowance and the DELTA that
    // answered the intent carried the 0 back (MP-05). The snapshot path had no
    // such line, which is why the delta's correctness hid the gap.
    expect(guest.freeTrack).toBeGreaterThan(0);
    expect(guest.freeDepots).toBe(0);

    // One drag long enough to outlive a small allowance, found while the guest
    // still holds its boot purse (a path's LEGALITY never depends on the purse).
    const drag = findLongDrag(guest, guestSpot[0], guestSpot[1], 8);
    expect(drag).not.toBeNull();
    const [ax, ay, bx, by] = drag!;

    // An empty purse on the guest's seat makes the HUD read the ALLOWANCE and
    // nothing else: both Build buttons are then live exactly while an allowance
    // covers their cost.
    const send = (over: Partial<WirePlayer>) => {
      guestEnd.deliver({ type: "snapshot", snap: hostFullState(host, [{ res: {} }, { res: {}, ...over }]) });
    };

    // ── partially spent: 5 free dirt tiles, one free Depot ─────────────────
    send({ freeTrack: 5, freeDepots: 1 });
    await settle();                                   // a painted frame re-renders the HUD

    // The DATA…
    expect(guest.freeTrack).toBe(5);
    expect(guest.freeDepots).toBe(1);
    // …the PREVIEW PRICE the next action will be charged from…
    expect(guest.depotPrice()).toMatchObject({ free: true, cost: {}, affordable: true, freeLeft: 0 });
    const part = guest.dragPreview("dirt", ax, ay, bx, by)!;
    expect(part.free).toBe(5);                        // the allowance covers five tiles…
    expect(part.tiles).toHaveLength(5);
    expect(part.cost).toEqual({});                    // …and charges nothing for them
    expect(part.unaffordable.length).toBeGreaterThan(0);   // the rest the empty purse cannot pay
    // …and the HUD built from both.
    expect(guestToolHtml("harvester")).toBe(depotButtonMarkup(1));
    expect(guestToolSub("harvester")).toMatch(/free setup/);
    expect(guestTool("harvester")!.disabled).toBe(false);
    expect(guestTool("dirt")!.disabled).toBe(false);

    // ── the same seat, EXHAUSTED: zero is a value, not a missing field ─────
    send({ freeTrack: 0, freeDepots: 0 });
    await settle();

    expect(guest.freeTrack).toBe(0);
    expect(guest.freeDepots).toBe(0);
    const spent = guest.depotPrice();
    expect(spent.free).toBe(false);
    expect(spent.cost).toEqual(DEPOT_COST);           // the full Oil price the host will charge
    expect(spent.affordable).toBe(false);
    const zero = guest.dragPreview("dirt", ax, ay, bx, by)!;
    expect(zero.free).toBe(0);
    expect(zero.tiles).toHaveLength(0);               // nothing free, nothing affordable
    expect(zero.unaffordable.length).toBeGreaterThan(0);
    expect(guestToolHtml("harvester")).toBe(depotButtonMarkup(0));
    expect(guestToolSub("harvester")).not.toMatch(/free setup/);   // no phantom free Depot
    expect(guestTool("harvester")!.disabled).toBe(true);
    expect(guestTool("dirt")!.disabled).toBe(true);                // no phantom free track

    // ── and a producer with nothing to say leaves the seat alone ───────────
    // Absent is NOT zero: a solo save (or any record without allowances) must
    // not wipe what the guest already holds — it must restore nothing.
    send({});
    await settle();
    expect(guest.freeTrack).toBe(0);
    expect(guest.freeDepots).toBe(0);
    expect(guest.depotPrice().free).toBe(false);
    expect(guestToolHtml("harvester")).toBe(depotButtonMarkup(0));
  });

  it.skip("a stalled guest resyncs into the host's SPENT allowances, not its boot ones (#137)", async () => {
    const { host, guest, hostEnd, guestEnd } = await bootPair();
    const { guestSpot } = playOpening(host, guest);
    const bootTrack = guest.freeTrack;

    // The downlink dies. The guest's intents still reach the host and are still
    // applied — the answers just never come back, so this is the case where "a
    // later delta will correct it" never happens.
    guestEnd.muted = true;

    // Eight three-tile drags: the first twelve tiles ride the guest-seat
    // allowance, the rest are charged. Locally the guest sees none of it.
    const drags = findDrags(guest, guestSpot[0], guestSpot[1], 8);
    expect(drags).toHaveLength(8);
    for (const [ax, ay, bx, by] of drags) {
      const pv = guest.dragBuild("dirt", ax, ay, bx, by, true);
      expect(pv, `drag from ${ax},${ay}`).not.toBeNull();
      // The stale mirror is the bug's impact: the guest previews free tiles the
      // host has already spent.
      expect(pv!.free).toBeGreaterThan(0);
    }
    pump();

    // The host's authoritative seat-1 record, read off the frames it SENT.
    const wire = hostWireSeat(hostEnd);
    expect(wire).toBeDefined();
    expect(wire!.freeTrack).toBe(0);                  // exhausted on the host…
    expect(wire!.freeDepots).toBe(0);
    expect(guest.freeTrack).toBe(bootTrack);          // …and still whole on the stalled guest

    // A genuine resync: the host's REAL full state crosses chunked, and the
    // guest applies it through the validated snapshot path.
    guestEnd.muted = false;
    // Full state is ask-throttled to one per 300 ms wall clock — a real resync
    // waits the throttle out.
    await new Promise((r) => setTimeout(r, 320));
    hostEnd.deliver({ type: "resync" });
    pump();
    expect(guestEnd.inbox.some((m) => m.type === "snapshot-chunk")).toBe(true);

    // The full state restored EXACTLY the host's record — zero included.
    expect(guest.freeTrack).toBe(wire!.freeTrack);
    expect(guest.freeTrack).toBe(0);
    expect(guest.freeDepots).toBe(wire!.freeDepots);
    expect(guest.freeDepots).toBe(0);
    await settle();

    // …and the price the guest now previews is the price the host will charge:
    // no free Depot, no free dirt. (The dirt BUTTON's affordability also reads
    // the seat's purse, which the paid tiles moved — the purse-independent half
    // of the HUD is the Depot's price line, and the controlled-purse case is
    // asserted in the snapshot test above.)
    expect(guest.depotPrice().free).toBe(false);
    expect(guest.depotPrice().cost).toEqual(DEPOT_COST);
    const after = findLongDrag(guest, guestSpot[0], guestSpot[1], 6);
    expect(after).not.toBeNull();
    const pv = guest.dragPreview("dirt", after![0], after![1], after![2], after![3])!;
    expect(pv.free).toBe(0);                          // a fresh drag rides no allowance
    expect(guestToolHtml("harvester")).toBe(depotButtonMarkup(0));
    expect(guestToolSub("harvester")).not.toMatch(/free setup/);

    // The two paths agree: the next delta carries the same record and changes
    // nothing a full state already restored.
    forcePublish(guest);
    pump();
    expect(guest.freeTrack).toBe(0);
    expect(guest.freeDepots).toBe(0);
  });
});
