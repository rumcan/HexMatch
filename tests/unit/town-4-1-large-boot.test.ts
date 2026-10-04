// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// TOWN-4.1 (#677) — the booted half of the map-size contract. Boots the REAL
// game (jsdom, stubbed canvas — the harness of iso-l17-save / iso-456) and
// pins the wiring the node suite cannot see:
//
//   • `?size=large` boots a 216×216 game that renders, saves its size, and a
//     reload WITHOUT the param resumes it at 216 (the save's record decides);
//   • an old save — snap 17, no `map.size` — boots at 144 and resumes;
//   • an explicit size that differs from the save's starts a fresh map;
//   • a room plays the HOST's record: a pair booted on large settings is
//     216 on both seats although the window says `?size=standard`, and the
//     host's 216 state reaches the guest (its v18 snapshot is not refused);
//   • dispose hands the size back (standard, unlocked).
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MAP_W, MAP_H, isMapSizeLocked, mulberry32, setRng } from "../../src/game/config";
import { SAVE_KEY, readSave, type SaveGamePayload } from "../../src/iso/savegame-runtime";
import { base64ToBytes } from "../../src/iso/snapshot";
import { DEFAULT_MATCH_SETTINGS, MAP_OPTIONS_OFF, type MatchSettings } from "../../src/net/match-settings";
import { NetSession } from "../../src/net/session";
import { PROTOCOL_VERSION, type HexProtocol, type WelcomeMsg } from "../../src/net/protocol";
import type { HexRoom } from "../../src/net/transport";
import type { Grid } from "../../src/iso/grid";
import type { Track } from "../../src/iso/track";

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

/** The slice of `window.__iso` this file drives. */
interface SizeHook {
  readonly phase: string;
  readonly loading: boolean;
  readonly mapSize: { name: string; w: number; h: number };
  readonly grid: Grid;
  readonly track: Track;
  readonly towns: { id: number; level: number }[];
  eco: { factories: { owner: string; ownerId: number; tx: number; ty: number; id: number; townId: number | null }[] };
  setTownLevel: (townId: number, level: number) => boolean;
  placementPlan: (kind: "factory" | "depot", tx: number, ty: number) => { valid: boolean; why: string | null };
  placeFactory: (tx: number, ty: number) => boolean;
  saveNow: () => void;
}

const hook = () => (window as unknown as { __iso: SizeHook }).__iso;
const settle = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

let roots: HTMLDivElement[] = [];
let disposers: (() => void)[] = [];

beforeEach(() => {
  stubCanvas();
  stubImage();
  window.history.replaceState(null, "", "/?seed=1337&loop=old");
  localStorage.removeItem(SAVE_KEY);
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
  disposeAll();
  vi.restoreAllMocks();
});

function disposeAll(): void {
  for (const d of disposers) d();
  disposers = [];
  for (const r of roots) r.remove();
  roots = [];
}

async function boot(opts: Record<string, unknown> = {}): Promise<SizeHook> {
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

/** A reload: the same slot and seed, a fresh game instance over it. */
async function reload(opts: Record<string, unknown> = {}): Promise<SizeHook> {
  disposeAll();
  setRng(mulberry32(1337));
  return boot(opts);
}

const layerBytes = (b64: string) => base64ToBytes(b64).length;

describe("TOWN-4.1: a large game boots, renders, saves and reloads at its size", () => {
  it("?size=large → 216×216; the save records it; a reload without the param resumes at 216", async () => {
    window.history.replaceState(null, "", "/?seed=1337&loop=old&size=large");
    const h = await boot();
    expect(h.mapSize).toEqual({ name: "large", w: 216, h: 216 });
    expect([h.grid.w, h.grid.h, h.grid.terrain.length]).toEqual([216, 216, 216 * 216]);
    expect(h.track.dirt.length).toBe(216 * 216);
    expect([MAP_W, MAP_H, isMapSizeLocked()]).toEqual([216, 216, true]);
    // it rendered: the loading screen's last step is the first frame
    for (let i = 0; i < 40 && h.loading; i++) await settle(4);
    expect(h.loading, "the first frame ran and the loading screen lifted").toBe(false);
    expect(h.phase).toMatch(/^(setup-factory|play)$/);
    const town = h.grid.towns[0];
    h.saveNow();
    const saved = readSave() as SaveGamePayload;
    expect(saved.map?.size).toBe("large");
    expect(saved.snapV).toBe(18);
    expect(layerBytes(saved.track.dirt)).toBe(216 * 216);

    window.history.replaceState(null, "", "/?seed=1337&loop=old");
    const back = await reload();
    expect(back.mapSize).toEqual({ name: "large", w: 216, h: 216 });
    expect(back.grid.w).toBe(216);
    expect([back.grid.towns[0].tx, back.grid.towns[0].ty]).toEqual([town.tx, town.ty]);   // the same map
  });

  it("an old save (snap 17, no size) boots at 144 and resumes", async () => {
    window.history.replaceState(null, "", "/?seed=1337&loop=old");
    const h = await boot({ newLoop: true });
    expect(h.mapSize.name).toBe("standard");
    const town1 = h.towns[1];
    h.eco.factories.push({ owner: "you", ownerId: 1, tx: 2, ty: 2, id: 0, townId: town1.id });
    expect(h.setTownLevel(town1.id, 2)).toBe(true);
    h.saveNow();
    // Make it exactly what a pre-TOWN-4.1 build wrote: snap 17, no size key.
    const payload = JSON.parse(localStorage.getItem(SAVE_KEY)!) as SaveGamePayload;
    payload.snapV = 17;
    delete payload.map!.size;
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));

    const back = await reload({ newLoop: true });
    expect(back.mapSize).toEqual({ name: "standard", w: 144, h: 144 });
    expect(back.grid.w).toBe(144);
    expect(back.towns[town1.id].level, "the save resumed (its town tier came back)").toBe(2);
  });

  it("an explicit size that differs from the save's starts a fresh map instead of resuming", async () => {
    const h = await boot({ newLoop: true });
    h.eco.factories.push({ owner: "you", ownerId: 1, tx: 2, ty: 2, id: 0, townId: h.towns[1].id });
    expect(h.setTownLevel(h.towns[1].id, 2)).toBe(true);
    h.saveNow();
    const big = await reload({ newLoop: true, size: "large" });
    expect(big.mapSize.name).toBe("large");
    expect(big.towns.every((t) => t.level === 0), "nothing of the 144 save was applied").toBe(true);
  });

  it("dispose hands the size back: standard and unlocked", async () => {
    window.history.replaceState(null, "", "/?seed=1337&loop=old&size=large");
    await boot();
    expect(MAP_W).toBe(216);
    disposeAll();
    expect([MAP_W, MAP_H, isMapSizeLocked()]).toEqual([144, 144, false]);
  });
});

// ── a room: the host's record decides ──────────────────────────────────────
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
  on(events: Record<string, (m: never) => void>): void { Object.assign(this.handlers, events); }
  send(msg: HexProtocol): void { this.sent.push(structuredClone(msg)); this.queue.push(structuredClone(msg)); }
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
  throw new Error("pump() never settled");
}
async function until(cond: () => boolean, ms = 6000): Promise<void> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    pump();
    if (cond()) return;
    await settle(1);
  }
  pump();
}

const SEED = 1337;
const LARGE_ROOM: MatchSettings = { ...DEFAULT_MATCH_SETTINGS, map: { ...MAP_OPTIONS_OFF, size: "large" } };

function welcome(hostEnd: Endpoint, guestEnd: Endpoint, hostOnly: boolean): WelcomeMsg {
  return {
    type: "welcome", seed: SEED, hostId: hostEnd.playerId, protocolVersion: PROTOCOL_VERSION,
    roster: [
      { id: hostEnd.playerId, username: "Ada", slot: 0 },
      ...(hostOnly ? [] : [{ id: guestEnd.playerId, username: "Bo", slot: 1 }]),
    ],
  };
}

/** A legal Factory site beside one of the towns (scanned near the centres —
 *  a whole-map sweep of the placement rule is needlessly slow at 216²). */
function factorySite(h: SizeHook): [number, number] {
  for (const t of h.grid.towns) {
    for (let r = 1; r <= 22; r++) {
      for (let y = t.ty - r; y <= t.ty + r; y++) {
        for (let x = t.tx - r; x <= t.tx + r; x++) {
          if (Math.max(Math.abs(x - t.tx), Math.abs(y - t.ty)) !== r) continue;
          if (h.placementPlan("factory", x, y).valid) return [x, y];
        }
      }
    }
  }
  throw new Error("no legal Factory site near any town");
}

describe("TOWN-4.1: a room plays the host's size — a guest's ?size= is ignored", () => {
  it("large room settings + ?size=standard in the window → both seats 216; the host's state reaches the guest", async () => {
    window.history.replaceState(null, "", "/?seed=1337&loop=old&size=standard");
    const hostEnd = new Endpoint("host-socket", "HX4ONE");
    const guestEnd = new Endpoint("guest-socket", "HX4ONE");
    hostEnd.peer = guestEnd;
    guestEnd.peer = hostEnd;
    endpoints = [hostEnd, guestEnd];
    const hostSession = new NetSession({ room: asRoom(hostEnd), role: "host" });
    const guestSession = new NetSession({ room: asRoom(guestEnd), role: "guest" });
    const guestHalt = vi.spyOn(guestSession, "halt");
    const host = await boot({ seed: SEED, role: "host", net: hostSession, settings: LARGE_ROOM });
    const guest = await boot({ seed: SEED, role: "guest", net: guestSession, settings: LARGE_ROOM });
    for (const end of endpoints) end.deliver(welcome(hostEnd, guestEnd, true));
    for (const end of endpoints) end.deliver(welcome(hostEnd, guestEnd, false));
    guestEnd.deliverPrivate(welcome(hostEnd, guestEnd, false));
    pump();

    expect(host.mapSize).toEqual({ name: "large", w: 216, h: 216 });
    expect(guest.mapSize).toEqual({ name: "large", w: 216, h: 216 });
    expect(guest.grid.w).toBe(216);

    const [fx, fy] = factorySite(host);
    expect(host.placeFactory(fx, fy)).toBe(true);
    await until(() => guest.eco.factories.some((f) => f.tx === fx && f.ty === fy));
    expect(guest.eco.factories.some((f) => f.tx === fx && f.ty === fy), "the host's Factory reached the guest").toBe(true);
    expect(guestHalt, "the guest never refused the host's state").not.toHaveBeenCalled();
  });
});
