import { moneyValueOf } from "../../src/iso/config";
// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// #181 — the railway in a hosted match: authority, and the guest's read of it.
//
// Two real games over the queued relay (the `iso-mp.test.ts` pattern): the
// guest's rail clicks are INTENTS, the host runs the same rule functions
// against the guest's seat, and the guest renders whatever the host commits.
// Pinned here:
//
//   * a guest's Platform intent is built with the heading the GUEST drew with.
//     The host used to run the refusal with the guest's `view` and then build
//     with its OWN held one — two shapes for one check, and the wrong structure
//     standing on the board (or a refusal after the check said ok);
//   * a guest's rail drag lands on the host's board, for the guest's seat,
//     priced and shaped by the host's own `railPreview`, and moves nothing
//     locally until the host answers;
//   * a guest's platform-Depot wears the Platform label, carries the Depot
//     record and gets no lorry;
//   * trains are the host's: a guest holding a complete, drivable railway with
//     NO line spawns nothing on its own while the host's own sim does.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NetSession } from "../../src/net/session";
import { PROTOCOL_VERSION, type HexProtocol, type WelcomeMsg } from "../../src/net/protocol";
import type { HexRoom } from "../../src/net/transport";
import { MAP_W, MAP_H, mulberry32, setRng } from "../../src/game/config";
import { FACTORY_FOOTPRINT } from "../../src/iso/config";
import { createRailState, RAIL_COSTS, ownerRailTiles as ownerRailTilesOf, railToWire, type RailState } from "../../src/iso/rail";
import { WATER, factoryTouchesTown, type Grid } from "../../src/iso/grid";
import { adjacentTown } from "../../src/iso/plants";
import { createTrack, seedTownRoads, seedPublicRoads, tIdx, type Track } from "../../src/iso/track";
import { buildSnapshot } from "../../src/iso/snapshot";
import type { Factory, Harvester } from "../../src/iso/economy";
import { seedWithFeature } from "./helpers/map-feature";
import { planFactoryPlacement } from "../../src/iso/placement";
import { findPlatformSite, findRailLine } from "./helpers/rail-line";

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
      if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createConicGradient") {
        return () => ({ addColorStop: () => undefined });
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

// ── the `window.__iso` hook, narrowed to what these specs read ─────────────
interface RailHook {
  phase: string;
  grid: Grid;
  track: Track;
  factories: Factory[];
  harvesters: Harvester[];
  purse: Record<string, number>;
  purses: Record<string, number>[];
  moneys: number[]; money: number;
  setSeatMoney(i: number, v: number): void;
  vp: { you: number; ai: number };
  placeFactory: (tx: number, ty: number) => boolean;
  placeDepot: (tx: number, ty: number) => boolean;
  finishSetup: () => void;
  placementPlan: (kind: "factory" | "depot", tx: number, ty: number) => { valid: boolean; why: string | null };
  setRailView: (v: string) => string;
  demolish: (tx: number, ty: number) => void;
  rail: {
    revision: number;
    tiles: number;
    structures: {
      id: number; kind: string; ownerId: number; tx: number; ty: number; view: string;
      anchor: { kind: string; id: number } | null;
    }[];
    lines: { id: number; ownerId: number; source: number; dest: number }[];
    trains: { id: number; ownerId: number; lineId: number; depotId: number; status: string; tile: [number, number] | null }[];
  };
  railState: RailState;
  railDrag: (ax: number, ay: number, bx: number, by: number) => { tiles: [number, number][]; cost: Record<string, number> } | null;
  placePlatform: (tx: number, ty: number, view?: string, who?: "you" | "ai") => boolean;
  depotCardAt: (tx: number, ty: number) => boolean;
  trucksList: { depotId?: number }[];
}

const hook = () => (window as unknown as { __iso: RailHook }).__iso;
const settle = async (n = 12) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
/**
 * Pump the relay and let the frame loop run until `cond` holds, or the budget
 * runs out — the host publishes on a real 200 ms heartbeat (`PUBLISH_MS`), so
 * anything a guest has to RECEIVE needs more than a few macrotask ticks.
 */
async function until(cond: () => boolean, ms = 4000): Promise<void> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    pump();
    if (cond()) return;
    await settle(1);
  }
  pump();
}

// ── the in-process relay (nothing is delivered until `pump()`) ────────────
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
  deliver(msg: HexProtocol): void {
    const copy = structuredClone(msg);
    this.inbox.push(copy);
    this.handlers.onMessage?.(copy as never);
  }
  deliverPrivate(msg: HexProtocol): void {
    const copy = structuredClone(msg);
    this.inbox.push(copy);
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
  throw new Error("pump() never settled — the two games are chatting in a loop");
}

function greet(msg: WelcomeMsg, privateTo?: Endpoint): void {
  for (const e of endpoints) e.deliver(msg);
  privateTo?.deliverPrivate(msg);
}

let SEED: number;
function railwaySeed(): number {
  return seedWithFeature("two-seat opening with a legal two-stop railway", (grid) => {
    const track = createTrack();
    seedTownRoads(track, grid);
    seedPublicRoads(track, grid);
    const a = findFactorySpot(grid, track);
    if (!a) return false;
    const town = adjacentTown(grid, ...a)?.id ?? -1;
    const b = findFactorySpot(grid, track, footprint(...a), town);
    if (!b) return false;
    const plants: Factory[] = [
      { owner: "you", ownerId: 1, tx: a[0], ty: a[1], id: 0, townId: town },
      { owner: "ai", ownerId: 2, tx: b[0], ty: b[1], id: 0, townId: adjacentTown(grid, ...b)?.id ?? null },
    ];
    return !!findRailLine({ grid, track, state: createRailState(), plants, ownerId: 2, purse: { ...rich } });
  });
}
let roots: HTMLDivElement[] = [];
let disposers: (() => void)[] = [];

beforeEach(() => {
  SEED ??= railwaySeed();
  stubCanvas();
  stubImage();
  window.history.replaceState(null, "", `/?seed=${SEED}&loop=old`);
  localStorage.removeItem("hexmatch:save");
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

async function boot(role: "host" | "guest", net: NetSession): Promise<RailHook> {
  const root = document.createElement("div");
  Object.defineProperty(root, "clientWidth", { value: 900, configurable: true });
  Object.defineProperty(root, "clientHeight", { value: 700, configurable: true });
  document.body.appendChild(root);
  roots.push(root);
  const { startIsoGame } = await import("../../src/iso/game");
  disposers.push(startIsoGame(root, { seed: SEED, role, net }));
  await settle();
  return hook();
}

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

async function bootPair(): Promise<{ host: RailHook; guest: RailHook; hostEnd: Endpoint; guestEnd: Endpoint }> {
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
  return { host, guest, hostEnd, guestEnd };
}

// ── map fixtures (the same rules `iso-mp.test.ts` uses) ───────────────────
/**
 * The first factory site the map's own rules accept, skipping `exclude`.
 *
 * `avoidTown` is the OTHER seat's town: a live rival factory holds the town it
 * stands beside (`townBlockedFor`), so the second seat's opening must go
 * beside a different one. (The `iso-mp` `playOpening` helper never learned
 * this — its guests pick the spot next door to the host's, get refused, and
 * the tests that used it are the `.skip`ped ones. This helper avoids it.)
 */
function findFactorySpot(
  grid: Grid, track: Track, exclude: ReadonlySet<number> = new Set(), avoidTown = -1,
): [number, number] | null {
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
      if (ok && !planFactoryPlacement(grid, x, y, { requireTown: true, track }).valid) ok = false;
      if (ok && avoidTown >= 0 && adjacentTown(grid, x, y)?.id === avoidTown) ok = false;
      if (ok) return [x, y];
    }
  }
  return null;
}

const footprint = (x: number, y: number) => {
  const tiles = new Set<number>();
  for (let dy = 0; dy < FACTORY_FOOTPRINT[1]; dy++) {
    for (let dx = 0; dx < FACTORY_FOOTPRINT[0]; dx++) tiles.add(tIdx(x + dx, y + dy));
  }
  return tiles;
};

function findDepotSpot(h: RailHook, cx: number, cy: number): [number, number] | null {
  // Map quotas no longer promise an industry within 14 tiles of a town.
  // Search the actual industry edges, nearest first, using live legality.
  const candidates = new Map<number, [number, number]>();
  for (const ind of h.grid.industries) {
    for (let y = ind.ty - 2; y <= ind.ty + ind.h; y++) {
      for (let x = ind.tx - 2; x <= ind.tx + ind.w; x++) {
        if (x >= 1 && y >= 1 && x < MAP_W - 1 && y < MAP_H - 1)
          candidates.set(tIdx(x, y), [x, y]);
      }
    }
  }
  const distance = ([x, y]: [number, number]) => Math.abs(x - cx) + Math.abs(y - cy);
  for (const [x, y] of [...candidates.values()].sort((a, b) => distance(a) - distance(b))) {
    if (h.placementPlan("depot", x, y).valid) return [x, y];
  }
  return null;
}

/**
 * Play both seats' openings — both Factories and both Depots, the guest's two
 * through intents — and hand the guest's seat a railway-sized purse.
 *
 * `__iso.placeDepot` runs `placeHarvester` and nothing else, so the host's own
 * phase stays `setup-harvester` where a real click would have flipped it: the
 * click's next line is `phase = "play"` (#181's guest side reads its phase off
 * the applied state, so the guest is already there). `finishSetup` is the
 * documented twin for exactly that flip, and the host has to be in `play` for
 * its own sim to run — which is the half of this suite that watches the host.
 */
async function seatBoth(host: RailHook, guest: RailHook): Promise<void> {
  const hostSpot = findFactorySpot(host.grid, host.track)!;
  expect(hostSpot).not.toBeNull();
  expect(host.placeFactory(hostSpot[0], hostSpot[1])).toBe(true);
  pump();
  const hostTown = adjacentTown(host.grid, hostSpot[0], hostSpot[1])?.id ?? -1;
  const guestSpot = findFactorySpot(guest.grid, guest.track, footprint(hostSpot[0], hostSpot[1]), hostTown)!;
  expect(guestSpot).not.toBeNull();
  expect(guest.placeFactory(guestSpot[0], guestSpot[1])).toBe(true);
  pump();
  const guestDepot = findDepotSpot(guest, guestSpot[0], guestSpot[1])!;
  expect(guestDepot, "guest opening has a legal Depot").not.toBeNull();
  expect(guest.placeDepot(guestDepot[0], guestDepot[1])).toBe(true);
  pump();
  const hostDepot = findDepotSpot(host, hostSpot[0], hostSpot[1])!;
  expect(hostDepot, "host opening has a legal Depot").not.toBeNull();
  expect(host.placeDepot(hostDepot[0], hostDepot[1])).toBe(true);
  host.finishSetup();          // the setup Depot click's own phase flip
  pump();
  await settle();
  expect(guest.phase).toBe("play");
  expect(host.phase).toBe("play");
  // The railway is a material build; every bag gets the run's worth — the
  // host's own (so its seat's ledger can be read as untouched) and the guest's
  // on both sides of the wire (the host's authoritative copy of seat 1, and
  // the guest's local mirror of it).
  for (const bag of [host.purses[0], host.purses[1], guest.purse]) {
    bag.wood = RICH; bag.stone = RICH; bag.ore = RICH; bag.oil = RICH;
  }
  // ECON-1 (#421): builds are paid in money - fund every seat the same way.
  host.setSeatMoney(0, RICH_MONEY); host.setSeatMoney(1, RICH_MONEY); guest.money = RICH_MONEY;
  guest.demolish(0, 0);   // the host's forced publish carries the purses
  pump();
}

/** What `seatBoth` hands every seat — enough rail (3 Stone a tile) for the
 *  nearest legal two-stop line plus its platforms, with room to spare. */
const RICH = 200;
const RICH_MONEY = 1_000_000;
const rich = { wood: RICH, stone: RICH, ore: RICH, oil: RICH } as const;

describe("#181 the guest's rail actions are the host's", () => {
  it("builds the guest's Platform in the heading the GUEST drew with", async () => {
    const { host, guest, guestEnd } = await bootPair();
    await seatBoth(host, guest);

    const site = findPlatformSite({
      grid: host.grid, state: host.railState, plants: host.factories, ownerId: 2, want: "industry",
    });
    expect(site, "no legal industry platform site on this map").not.toBeNull();
    // The host's own tool is pointed somewhere else. The old bug built the
    // guest's platform with THIS heading, after checking it with the guest's.
    const hostHeading = host.setRailView(site!.view === "se" ? "nw" : "se");
    expect(hostHeading).not.toBe(site!.view);

    const before = guest.rail.structures.length;
    const wireBefore = guestEnd.sent.length;
    expect(guest.placePlatform(site!.tx, site!.ty, site!.view)).toBe(true);
    // The intent is away, and nothing exists locally yet.
    expect(guestEnd.sent.slice(wireBefore)).toHaveLength(1);
    expect(guestEnd.sent[wireBefore]).toMatchObject({
      type: "intent", action: "build",
      payload: { do: "platform", tx: site!.tx, ty: site!.ty, view: site!.view },
    });
    expect(guest.rail.structures).toHaveLength(before);

    pump();
    // The HOST's board carries it, for the guest's seat, in the guest's
    // heading — not the host's held one — and anchored to the industry.
    const platforms = host.rail.structures.filter((s) => s.kind === "platform");
    expect(platforms).toHaveLength(1);
    expect(platforms[0]).toMatchObject({
      ownerId: 2, tx: site!.tx, ty: site!.ty, view: site!.view,
      anchor: { kind: "industry", id: site!.anchorId },
    });
    expect(platforms[0].view).toBe(site!.view);
    // The guest renders the same structure as its own, and paid for it from
    // its own seat's bag — the host's seat is untouched.
    const mine = guest.rail.structures.filter((s) => s.kind === "platform");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ tx: site!.tx, ty: site!.ty, view: site!.view });
    expect(host.moneys[1]).toBe(RICH_MONEY - moneyValueOf(RAIL_COSTS.platform));
    expect(host.moneys[0]).toBe(RICH_MONEY);
  });

  it("lays the guest's drag on the HOST's board only, priced by the host's preview", async () => {
    const { host, guest, guestEnd } = await bootPair();
    await seatBoth(host, guest);

    const line = findRailLine({
      grid: host.grid, track: host.track, state: host.railState,
      plants: host.factories, ownerId: 2, purse: { ...rich },
    });
    expect(line, "no legal two-stop railway on this map").not.toBeNull();
    // Both platforms, through the guest, exactly as a player builds them.
    expect(guest.placePlatform(line!.src.tx, line!.src.ty, line!.src.view)).toBe(true);
    pump();
    expect(guest.placePlatform(line!.dst.tx, line!.dst.ty, line!.dst.view)).toBe(true);
    pump();
    expect(host.rail.structures).toHaveLength(2);

    const cash = host.moneys[1];
    const tilesBefore = guest.rail.tiles;
    const wireBefore = guestEnd.sent.length;
    const pv = guest.railDrag(line!.drag[0], line!.drag[1], line!.drag[2], line!.drag[3]);
    // The guest previewed the whole drag (its own local read of the shared
    // world) — but the commit is the host's: nothing has moved on either
    // board, and the only thing that left the guest is the intent.
    expect(pv?.tiles).toHaveLength(line!.tiles.length);
    expect(guestEnd.sent.slice(wireBefore)).toHaveLength(1);
    expect(guestEnd.sent[wireBefore]).toMatchObject({
      type: "intent", action: "build",
      payload: { do: "rail", ax: line!.drag[0], ay: line!.drag[1], bx: line!.drag[2], by: line!.drag[3] },
    });
    expect(guest.rail.tiles).toBe(tilesBefore);
    expect(ownerRailTilesOf(host.railState, 2).length).toBe(tilesBefore);

    pump();
    // The host laid it for the guest's seat, at the preview's price…
    expect(ownerRailTilesOf(host.railState, 2).length).toBeGreaterThan(tilesBefore);
    expect(host.moneys[1]).toBe(cash - moneyValueOf(pv!.cost));
    // …and the guest renders exactly the host's tiles as its own.
    expect(guest.rail.tiles).toBe(ownerRailTilesOf(host.railState, 2).length);
    // The host's own seat paid nothing and owns nothing.
    expect(host.moneys[0]).toBe(RICH_MONEY);
    expect(ownerRailTilesOf(host.railState, 1).length).toBe(0);
  });

  it("removes the guest's platform through the host, and revokes the point", async () => {
    const { host, guest, guestEnd } = await bootPair();
    await seatBoth(host, guest);
    const site = findPlatformSite({
      grid: host.grid, state: host.railState, plants: host.factories, ownerId: 2, want: "industry",
    })!;
    guest.placePlatform(site.tx, site.ty, site.view);
    pump();
    expect(host.rail.structures).toHaveLength(1);
    const before = host.moneys[1];
    const wireBefore = guestEnd.sent.length;
    guest.demolish(site.tx, site.ty);
    expect(guestEnd.sent.slice(wireBefore)).toHaveLength(1);
    expect(guestEnd.sent[wireBefore]).toMatchObject({ type: "intent", action: "demolish", payload: { do: "demolish", tx: site.tx, ty: site.ty } });
    expect(host.rail.structures).toHaveLength(1);   // nothing yet
    pump();
    expect(host.rail.structures).toHaveLength(0);
    expect(guest.rail.structures).toHaveLength(0);
    expect(host.moneys[1]).toBeGreaterThan(before);   // the 50% refund, in money
  });
});

describe("#181 the guest's platform-Depot", () => {
  it("wears the Platform label, carries the Depot record and gets no lorry", async () => {
    const { host, guest } = await bootPair();
    await seatBoth(host, guest);
    const site = findPlatformSite({
      grid: host.grid, state: host.railState, plants: host.factories, ownerId: 2, want: "industry",
    })!;
    guest.placePlatform(site.tx, site.ty, site.view);
    pump();
    await settle();

    // The Depot record the economy keeps for the platform — on both seats.
    const hostDepot = host.harvesters.find((h) => h.platformId !== undefined);
    const guestDepot = guest.harvesters.find((h) => h.platformId !== undefined);
    expect(hostDepot, "the platform did not become a Depot on the host").toBeTruthy();
    expect(guestDepot, "the guest never received the platform's Depot record").toBeTruthy();
    expect(guestDepot!.owner).toBe("you");
    expect(guestDepot!.ownerId).toBe(1);          // the guest's own seat frame
    expect(guestDepot!.platformId).toBeDefined();

    // The label over it says Platform, on both seats and in each one's words.
    const labelsOf = (i: number) =>
      [...roots[i].querySelectorAll(".iso-label.label-depot span")].map((e) => e.textContent);
    expect(labelsOf(0)).toContain("Rival Platform");
    expect(labelsOf(1)).toContain("Your Platform");

    // The guest can OPEN its Depot's card on the platform — the click's own
    // door (`myDepotAt` → `depotCardFor`) answers for ITS seat. The host's
    // seat, looking at the same tile, finds no Depot of its own.
    expect(guest.depotCardAt(site.tx, site.ty)).toBe(true);
    expect(roots[1].querySelector(".panel.depot-card")).toBeTruthy();
    expect(host.depotCardAt(site.tx, site.ty)).toBe(false);

    // And it is not a road Depot: no lorry is planned for it anywhere.
    expect(guest.trucksList.some((t) => t.depotId === guestDepot!.id)).toBe(false);
    expect(host.trucksList.some((t) => t.depotId === hostDepot!.id)).toBe(false);
  });
});

describe("#181 trains belong to the host", () => {
  it("gives the guest the host's train — and spawns none on its own", async () => {
    const { host, guest, guestEnd } = await bootPair();
    await seatBoth(host, guest);
    const line = findRailLine({
      grid: host.grid, track: host.track, state: host.railState,
      plants: host.factories, ownerId: 2, purse: { ...rich },
    });
    expect(line, "no legal two-stop railway on this map").not.toBeNull();
    // The whole railway through the GUEST's intents: two platforms and the
    // drag that joins them. `autoTrains` needs nothing else to give the seat
    // a line and a train — there is no depot and no buying any more.
    guest.placePlatform(line!.src.tx, line!.src.ty, line!.src.view);
    pump();
    guest.placePlatform(line!.dst.tx, line!.dst.ty, line!.dst.view);
    pump();
    guest.railDrag(line!.drag[0], line!.drag[1], line!.drag[2], line!.drag[3]);
    pump();

    // The host's own frame gives the connected pair a line and a train…
    await until(() => host.rail.trains.length > 0);
    expect(host.rail.lines).toHaveLength(1);
    expect(host.rail.trains).toHaveLength(1);
    // …and the guest renders it, from the wire — on the next heartbeat.
    await until(() => guest.rail.lines.length > 0);
    await until(() => guest.rail.trains.length > 0);
    expect(guest.rail.lines.map((l) => l.id)).toEqual(host.rail.lines.map((l) => l.id));
    expect(guest.rail.trains.map((t) => t.id)).toEqual(host.rail.trains.map((t) => t.id));
    expect(guest.rail.trains[0].tile).toEqual(host.rail.trains[0].tile);

    // Now the decisive half. The guest is handed the SAME railway with no
    // line and no train, and then left alone: if a guest ran `autoTrains` it
    // would spawn one from exactly this state. It must not.
    const wire = railToWire(host.railState, { layers: true })!;
    wire.lines = [];
    wire.trains = [];
    const snap = buildSnapshot({
      seed: SEED,
      track: host.track,
      harvesters: host.harvesters,
      factories: host.factories,
      setupPhase: false,
      won: false,
      players: [
        { id: "you", vp: host.vp.you, res: { ...host.purses[0] } },
        { id: "ai", vp: host.vp.ai, res: { ...host.purses[1] } },
      ],
      t: performance.now(),
      rail: wire,
    });
    guestEnd.deliver({ type: "snapshot", snap });
    expect(guest.rail.structures).toHaveLength(2);      // it has the railway…
    expect(guest.rail.trains).toHaveLength(0);          // …and no line at all
    await settle(40);                                    // …and time to think
    expect(guest.rail.trains).toHaveLength(0);
    expect(host.rail.trains.length).toBeGreaterThan(0);  // while the host's sim runs
  });
});
