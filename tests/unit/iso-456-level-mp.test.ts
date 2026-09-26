// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// #456 — Level Ground at the GAME level: the two acceptance boxes the pure
// rules file cannot reach.
//
//   • SAVES RELOAD EDITED HEIGHTS — level a hill in a live game, let the
//     save write (the `pagehide` twin of the autosave), boot a fresh game
//     from that save, and the levelled heights come back (the diff rides the
//     payload the way map options do);
//   • GUEST LEVELLING GOES THROUGH THE HOST — a guest's level gesture leaves
//     as ONE intent (`build { do: "level", … }`), moves nothing locally, and
//     lands on the host's board for the GUEST's seat at the guest's own
//     preview price — mirrored back by the forced publish.
//
// Harness copied from iso-181-rail-mp.test.ts (the in-process relay) and
// iso-412-rival-smoke.test.ts (the jsdom boot stubs).
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NetSession } from "../../src/net/session";
import { PROTOCOL_VERSION, type HexProtocol, type WelcomeMsg } from "../../src/net/protocol";
import type { HexRoom } from "../../src/net/transport";
import { MAP_H, MAP_W, mulberry32, setRng } from "../../src/game/config";
import { FACTORY_FOOTPRINT } from "../../src/iso/config";
import { heightAt, type Grid } from "../../src/iso/grid";
import { adjacentTown } from "../../src/iso/plants";
import { type Track } from "../../src/iso/track";
import { planLevel, rectTiles, type LevelPlan } from "../../src/iso/level-ground";

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

// ── the `window.__iso` hook, narrowed to what these specs drive ───────────
interface LevelHook {
  phase: string;
  grid: Grid;
  track: Track;
  purse: Record<string, number>;
  purses: Record<string, number>[];
  moneys: number[]; money: number;
  setSeatMoney(i: number, v: number): void;
  placeFactory: (tx: number, ty: number) => boolean;
  placeDepot: (tx: number, ty: number) => boolean;
  finishSetup: () => void;
  placementPlan: (kind: "factory" | "depot", tx: number, ty: number) => { valid: boolean; why: string | null };
  demolish: (tx: number, ty: number) => void;
  /** #456: the level gesture's own twin (commits on solo/host, intents on a guest). */
  levelBuild: (ax: number, ay: number, bx: number, by: number, target?: number) => LevelPlan | null;
  levelCostOf: (ax: number, ay: number, bx: number, by: number) =>
    { money: number; levels: number } | { refusal: string };
}

const hook = () => (window as unknown as { __iso: LevelHook }).__iso;
const settle = async (n = 12) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
/** Pump the relay and wait until `cond` holds (the host publishes on a real
 *  heartbeat, so a guest's receive needs more than a few macrotasks). */
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

const SEED = 1337;
const RICH_MONEY = 1_000_000;
let roots: HTMLDivElement[] = [];
let disposers: (() => void)[] = [];

beforeEach(() => {
  stubCanvas();
  stubImage();
  window.history.replaceState(null, "", "/?seed=1337&loop=old");
  localStorage.removeItem("hexmatch:save");
  localStorage.setItem("hexmatch:rival-skill", "normal");
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

async function boot(opts: Record<string, unknown>): Promise<LevelHook> {
  const root = document.createElement("div");
  Object.defineProperty(root, "clientWidth", { value: 900, configurable: true });
  Object.defineProperty(root, "clientHeight", { value: 700, configurable: true });
  document.body.appendChild(root);
  roots.push(root);
  const { startIsoGame } = await import("../../src/iso/game");
  disposers.push(startIsoGame(root, opts));
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

async function bootPair(): Promise<{ host: LevelHook; guest: LevelHook; hostEnd: Endpoint; guestEnd: Endpoint }> {
  const hostEnd = new Endpoint("host-socket", "HX9KWR");
  const guestEnd = new Endpoint("guest-socket", "HX9KWR");
  hostEnd.peer = guestEnd;
  guestEnd.peer = hostEnd;
  endpoints = [hostEnd, guestEnd];
  const hostSession = new NetSession({ room: asRoom(hostEnd), role: "host" });
  const guestSession = new NetSession({ room: asRoom(guestEnd), role: "guest" });
  const host = await boot({ seed: SEED, role: "host", net: hostSession });
  const guest = await boot({ seed: SEED, role: "guest", net: guestSession });
  greet(welcomeFor(hostEnd, guestEnd, true));
  greet(welcomeFor(hostEnd, guestEnd, false), guestEnd);
  pump();
  return { host, guest, hostEnd, guestEnd };
}

/**
 * The tiles of a Factory footprint, for the second seat's exclusion (a live
 * rival factory holds the town it stands beside — iso-181's rule).
 */
const footprintSet = (x: number, y: number) => {
  const tiles = new Set<number>();
  for (let dy = 0; dy < FACTORY_FOOTPRINT[1]; dy++) {
    for (let dx = 0; dx < FACTORY_FOOTPRINT[0]; dx++) tiles.add((y + dy) * MAP_W + (x + dx));
  }
  return tiles;
};

function findDepotSpot(h: LevelHook, cx: number, cy: number): [number, number] | null {
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

/**
 * A Factory site that ALSO has a Depot site near it — the guest reaches
 * `play` only once its own Depot is mirrored (`refreshGuestPhase` reads the
 * applied state: "do I have a Factory? do I have a Depot?").
 */
function findOpening(h: LevelHook, exclude: ReadonlySet<number> = new Set(), avoidTown = -1):
  { f: [number, number]; d: [number, number] } {
  for (let y = 6; y < MAP_H - 6; y++) {
    for (let x = 6; x < MAP_W - 6; x++) {
      let ok = true;
      for (let dy = 0; dy < FACTORY_FOOTPRINT[1] && ok; dy++) {
        for (let dx = 0; dx < FACTORY_FOOTPRINT[0]; dx++) {
          if (exclude.has((y + dy) * MAP_W + (x + dx))) { ok = false; break; }
        }
      }
      if (!ok) continue;
      if (avoidTown >= 0 && adjacentTown(h.grid, x, y)?.id === avoidTown) continue;
      if (!h.placementPlan("factory", x, y).valid) continue;
      const d = findDepotSpot(h, x, y);
      if (d) return { f: [x, y], d };
    }
  }
  throw new Error("no legal Factory+Depot opening on this map");
}

/** Both seats seated through the live placement rule, and in `play`. */
async function seatBoth(host: LevelHook, guest: LevelHook): Promise<void> {
  const open = findOpening(host);
  host.placeFactory(open.f[0], open.f[1]);
  pump();
  const hostTown = adjacentTown(host.grid, open.f[0], open.f[1])?.id ?? -1;
  const g = findOpening(guest, footprintSet(open.f[0], open.f[1]), hostTown);
  guest.placeFactory(g.f[0], g.f[1]);
  pump();
  guest.placeDepot(g.d[0], g.d[1]);   // an intent — the host applies it
  pump();
  host.placeDepot(open.d[0], open.d[1]);
  host.finishSetup();
  pump();
  await until(() => host.phase === "play" && guest.phase === "play");
  expect(guest.phase).toBe("play");
  expect(host.phase).toBe("play");
  host.setSeatMoney(0, RICH_MONEY);
  host.setSeatMoney(1, RICH_MONEY);
  guest.money = RICH_MONEY;
  guest.demolish(0, 0);   // the host's forced publish carries the purses
  pump();
}

/** A tile whose one-level nudge really moves something: the pure plan says so. */
function findNudge(h: LevelHook): [number, number] {
  for (let y = 40; y < MAP_H - 40; y++) {
    for (let x = 40; x < MAP_W - 40; x++) {
      const lv = heightAt(h.grid, x, y);
      if (lv >= 4) continue;
      const plan = planLevel(h.grid, rectTiles(x, y, x, y), { track: h.track }, lv + 1);
      if (plan.changes.length > 0 && plan.refused.length === 0) return [x, y];
    }
  }
  throw new Error("no levelable tile on this map");
}

// ══════════════════════════════════════════════════════════════════════════
describe("#456 Level Ground — saves reload the edited heights", () => {
  it("levels a hill, saves, boots fresh, and the heights come back", async () => {
    const g1 = await boot({ seed: SEED });
    expect(g1.phase).toBe("setup-factory");
    // Seat the player the ordinary way, so the tool is live.
    const open = findOpening(g1);
    g1.placeFactory(open.f[0], open.f[1]);
    g1.placeDepot(open.d[0], open.d[1]);
    g1.finishSetup();
    await settle();

    const [x, y] = findNudge(g1);
    const before = heightAt(g1.grid, x, y);
    const plan = g1.levelBuild(x, y, x, y, before + 1);
    expect(plan, "the level gesture produced a plan").not.toBeNull();
    expect(plan!.changes.length).toBeGreaterThan(0);
    expect(heightAt(g1.grid, x, y)).toBe(before + 1);

    // The save is the SAME write the autosave and pagehide make.
    window.dispatchEvent(new Event("pagehide"));
    const raw = localStorage.getItem("hexmatch:save");
    expect(raw, "the game wrote a save").not.toBeNull();
    const payload = JSON.parse(raw!) as { heightEdits?: number[] };
    expect(Array.isArray(payload.heightEdits)).toBe(true);
    // The wire form is flat [x, y, level] triples, and ours is in there.
    const triples = payload.heightEdits!;
    let levelledTo: number | null = null;
    for (let i = 0; i + 2 < triples.length; i += 3) {
      if (triples[i] === x && triples[i + 1] === y) levelledTo = triples[i + 2];
    }
    expect(levelledTo, "the save carries this tile's new level").toBe(before + 1);

    // Boot a FRESH game from that save — same seed, saved heights.
    for (const d of disposers) d();
    disposers = [];
    const g2 = await boot({ seed: SEED });
    expect(heightAt(g2.grid, x, y), "the reloaded map keeps the levelled height").toBe(before + 1);
    // …and the rest of the seed map is still the seed map (a diff, not a copy).
    const someFar = findNudge(g2);
    expect(heightAt(g2.grid, someFar[0], someFar[1])).toBe(heightAt(g1.grid, someFar[0], someFar[1]));
  }, 180_000);
});

// ══════════════════════════════════════════════════════════════════════════
describe("#456 Level Ground — guest levelling goes through the host", () => {
  it("sends ONE intent, moves nothing locally, and the host commits for the guest's seat", async () => {
    const { host, guest, guestEnd } = await bootPair();
    await seatBoth(host, guest);

    const [x, y] = findNudge(host);
    const before = heightAt(host.grid, x, y);
    const target = before + 1;

    const wireBefore = guestEnd.sent.length;
    const plan = guest.levelBuild(x, y, x, y, target);
    expect(plan, "the guest previewed a plan").not.toBeNull();
    expect(plan!.changes.length).toBeGreaterThan(0);
    // ONE intent, and it names the rectangle and the target the guest drew.
    expect(guestEnd.sent.slice(wireBefore)).toHaveLength(1);
    expect(guestEnd.sent[wireBefore]).toMatchObject({
      type: "intent", action: "build",
      payload: { do: "level", ax: x, ay: y, bx: x, by: y, target },
    });
    // Nothing exists locally yet — the guest never mutates its own map.
    expect(heightAt(guest.grid, x, y)).toBe(before);
    expect(heightAt(host.grid, x, y)).toBe(before);

    await until(() => heightAt(host.grid, x, y) === target);
    // The HOST levelled it, for the guest's seat, at the guest's preview price.
    expect(heightAt(host.grid, x, y), "the host applied the guest's level intent").toBe(target);
    expect(host.moneys[1], "the guest's seat paid the preview's price")
      .toBe(RICH_MONEY - plan!.money);
    expect(host.moneys[0], "the host's own seat paid nothing").toBe(RICH_MONEY);
    // …and the forced publish mirrored it back (the `heightEdits` diff rides
    // the delta whole, the clearedFields rule).
    await until(() => heightAt(guest.grid, x, y) === target);
    expect(heightAt(guest.grid, x, y), "the guest's mirror carries the new height").toBe(target);
  }, 180_000);
});
