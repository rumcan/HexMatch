// @vitest-environment jsdom
// @vitest-environment-options {"url": "http://localhost/?loop=old"}
// MP-MGR (owner, 2026-09-29): the guest seat is human on the host, the host may
// switch manager perks off for the room, and the same manager may sit twice.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NetSession } from "../../src/net/session";
import { PROTOCOL_VERSION, type HexProtocol, type WelcomeMsg } from "../../src/net/protocol";
import type { HexRoom } from "../../src/net/transport";
import {
  DEFAULT_MATCH_SETTINGS, coerceMatchSettings, isDefaultMatchSettings, normalizeMatchSettings, perksEnabled,
  type MatchSettings,
} from "../../src/net/match-settings";
import { battlePerksOf, perkPrice, type ManagerId } from "../../src/iso/managers";
import { mulberry32, setRng } from "../../src/game/config";

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

interface Hook {
  players: { i: number; human: boolean; manager: ManagerId | null; perkManager: ManagerId | null }[];
  aiSeat: boolean;
}
const hook = () => (window as unknown as { __iso: Hook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

class Endpoint {
  queue: HexProtocol[] = [];
  peer: Endpoint | null = null;
  isCreator = false;
  latency = 3;
  connectionState = "connected" as const;
  private handlers: Record<string, ((m: never) => void) | undefined> = {};
  constructor(readonly playerId: string, readonly roomCode: string) {}
  on(events: Record<string, (m: never) => void>): void { Object.assign(this.handlers, events); }
  send(msg: HexProtocol): void { this.queue.push(structuredClone(msg)); }
  deliver(msg: HexProtocol): void { this.handlers.onMessage?.(structuredClone(msg) as never); }
  deliverPrivate(msg: HexProtocol): void { this.handlers.onPrivateMessage?.(structuredClone(msg) as never); }
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
  window.history.replaceState(null, "", `/?seed=${SEED}&loop=old`);
  localStorage.clear();
  localStorage.setItem("hexmatch:rival-skill", "normal");
  localStorage.setItem("hexmatch:tutorial", "never");
  setRng(mulberry32(SEED));
  (globalThis as Record<string, unknown>).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
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

async function boot(net: NetSession, settings: MatchSettings | undefined, portrait?: ManagerId): Promise<Hook> {
  const root = document.createElement("div");
  Object.defineProperty(root, "clientWidth", { value: 900, configurable: true });
  Object.defineProperty(root, "clientHeight", { value: 700, configurable: true });
  document.body.appendChild(root);
  roots.push(root);
  const { startIsoGame } = await import("../../src/iso/game");
  disposers.push(startIsoGame(root, { seed: SEED, role: "host", net, settings, portrait }));
  await settle();
  return hook();
}

function room(guestSeated: boolean, settings?: MatchSettings) {
  const hostEnd = new Endpoint("host-socket", "HX9KWR");
  const guestEnd = new Endpoint("guest-socket", "HX9KWR");
  hostEnd.peer = guestEnd;
  guestEnd.peer = hostEnd;
  endpoints = [hostEnd, guestEnd];
  const greeting: WelcomeMsg = {
    type: "welcome", seed: SEED, hostId: hostEnd.playerId, protocolVersion: PROTOCOL_VERSION,
    roster: [
      { id: hostEnd.playerId, username: "Ada", slot: 0 },
      ...(guestSeated ? [{ id: guestEnd.playerId, username: "Bo", slot: 1 }] : []),
    ],
    ...(settings ? { settings } : {}),
  };
  return { hostEnd, guestEnd, greeting };
}
function seat(hostEnd: Endpoint, guestEnd: Endpoint, greeting: WelcomeMsg) {
  const hostNet = new NetSession({ room: asRoom(hostEnd), role: "host" });
  const guestNet = new NetSession({ room: asRoom(guestEnd), role: "guest" });
  hostNet.receive(greeting);
  guestNet.receive(greeting);
  for (const e of endpoints) e.deliver(greeting);
  return { hostNet, guestNet };
}

describe("MP-MGR: the guest seat", () => {
  it("(a) a host with a joined guest marks seat 1 human, and a manager intent sets its manager", async () => {
    const { hostEnd, guestEnd, greeting } = room(true);
    const { hostNet, guestNet } = seat(hostEnd, guestEnd, greeting);
    const host = await boot(hostNet, undefined, "james");
    pump();
    expect(host.aiSeat).toBe(false);
    expect(host.players[1].human).toBe(true);
    guestNet.sendIntent("build", { do: "manager", id: "kenji" });
    pump();
    await settle();
    expect(host.players[1].manager).toBe("kenji");
  });

  it("local feedback (sfx, toasts, flashes) belongs to the host's own seat, not the human guest's", async () => {
    const { hostEnd, guestEnd, greeting } = room(true);
    const { hostNet } = seat(hostEnd, guestEnd, greeting);
    const host = await boot(hostNet, undefined, "james") as Hook & { players: { feedsLocal: boolean }[] };
    pump();
    expect(host.players[1].human).toBe(true);
    expect(host.players[0].feedsLocal).toBe(true);
    expect(host.players[1].feedsLocal).toBe(false);
  });

  it("(b) an AI-filled seat stays non-human and ignores a manager intent", async () => {
    const rules: MatchSettings = { ...DEFAULT_MATCH_SETTINGS, aiSeats: ["easy"] };
    const { hostEnd, guestEnd, greeting } = room(false, rules);
    const { hostNet, guestNet } = seat(hostEnd, guestEnd, greeting);
    const host = await boot(hostNet, rules, "james");
    pump();
    expect(host.aiSeat).toBe(true);
    expect(host.players[1].human).toBe(false);
    guestNet.sendIntent("build", { do: "manager", id: "kenji" });
    pump();
    await settle();
    expect(host.players[1].manager).toBeNull();
  });

  it("(e) both seats may hold the same manager", async () => {
    const { hostEnd, guestEnd, greeting } = room(true);
    const { hostNet, guestNet } = seat(hostEnd, guestEnd, greeting);
    const host = await boot(hostNet, undefined, "anne");
    pump();
    guestNet.sendIntent("build", { do: "manager", id: "anne" });
    pump();
    await settle();
    expect(host.players[0].manager).toBe("anne");
    expect(host.players[1].manager).toBe("anne");
  });
});

describe("MP-MGR: perks on / off", () => {
  it("(c) perks:false makes every seat's perks none; the manager stays", async () => {
    const rules: MatchSettings = { ...DEFAULT_MATCH_SETTINGS, perks: false };
    const { hostEnd, guestEnd, greeting } = room(true, rules);
    const { hostNet, guestNet } = seat(hostEnd, guestEnd, greeting);
    const host = await boot(hostNet, rules, "james");
    pump();
    guestNet.sendIntent("build", { do: "manager", id: "anne" });
    pump();
    await settle();
    expect(host.players[0].manager).toBe("james");
    expect(host.players[1].manager).toBe("anne");
    for (const p of host.players) {
      expect(p.perkManager).toBeNull();
      expect(perkPrice(100, p.perkManager, "rail")).toBe(100);
      expect(battlePerksOf(p.perkManager)).toBeNull();
    }
  });

  it("(c) perks on (the default) leaves the manager's perks in place", async () => {
    const { hostEnd, guestEnd, greeting } = room(true);
    const { hostNet } = seat(hostEnd, guestEnd, greeting);
    const host = await boot(hostNet, undefined, "james");
    expect(host.players[0].perkManager).toBe("james");
  });

  it("(d) match-settings: perks defaults on, round-trips, and off is unranked", () => {
    expect(perksEnabled(DEFAULT_MATCH_SETTINGS)).toBe(true);
    expect(perksEnabled(normalizeMatchSettings({}))).toBe(true);           // an old client
    const off = normalizeMatchSettings({ ...DEFAULT_MATCH_SETTINGS, perks: false })!;
    expect(off.perks).toBe(false);
    expect(perksEnabled(normalizeMatchSettings(JSON.parse(JSON.stringify(off))))).toBe(false);
    expect(perksEnabled(coerceMatchSettings({ perks: false }))).toBe(false);
    expect(isDefaultMatchSettings(DEFAULT_MATCH_SETTINGS)).toBe(true);
    expect(isDefaultMatchSettings(off)).toBe(false);
    expect(isDefaultMatchSettings({ ...DEFAULT_MATCH_SETTINGS, perks: true })).toBe(true);
  });
});
