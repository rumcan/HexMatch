// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// MKT-2 (#465) — a market you can play: event forecasts, Buy, price alerts,
// guest selling, and a rival that reads the same rumours.
//
// Pure market rules (rumour timing + the Hard hit rate, alert crossings, the
// rival's boom-wait, the buy quote) are pinned without booting; the exchange
// doors (money down / cargo up, guest sales through the host's intent
// handler) boot a real two-seat room over the queued relay (the
// `iso-456-level-mp.test.ts` pattern).
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NetSession } from "../../src/net/session";
import { PROTOCOL_VERSION, type HexProtocol, type WelcomeMsg } from "../../src/net/protocol";
import type { HexRoom } from "../../src/net/transport";
import { mulberry32, setRng } from "../../src/game/config";
import type { Cargo } from "../../src/iso/config";
import {
  createMarket, quoteSale, quoteBuy, buyPrice, priceOf, sell, eventsAt,
  rivalSellLot, rumourAt, createAlert, alertTick,
  resetMarketCache, EVENT_SLOT_MS, RUMOUR_HARD_HIT_RATE, BUY_SPREAD,
} from "../../src/iso/market";

vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

const MIN = 60_000;

beforeEach(() => { resetMarketCache(); });

/** The truth about one slot: the event scheduled to open there, if any. */
function truthForSlot(seed: number, slot: number) {
  const startMs = slot * EVENT_SLOT_MS;
  return eventsAt(seed, startMs).find((e) => e.startMs === startMs) ?? null;
}

describe("MKT-2 rumours > timing", () => {
  it("names the NEXT slot, about 60 s before its event", () => {
    for (const seed of [7, 42, 1337]) {
      for (const now of [0, 1_000, 59_999, 60_000, 61_000, 5 * MIN + 37_000, 61 * MIN]) {
        const rum = rumourAt(seed, now, "normal");
        const slotStart = (Math.floor(now / EVENT_SLOT_MS) + 1) * EVENT_SLOT_MS;
        expect(slotStart - now).toBeGreaterThan(0);
        expect(slotStart - now).toBeLessThanOrEqual(EVENT_SLOT_MS);
        if (rum) {
          expect(rum.startMs).toBe(slotStart);
          expect(rum.id).toBe(`rumour:${seed}:${slotStart / EVENT_SLOT_MS}`);
        } else {
          // an honest silence: nothing is scheduled for that slot
          expect(truthForSlot(seed, slotStart / EVENT_SLOT_MS)).toBeNull();
        }
      }
    }
  });

  it("quotes the scheduled range and the cargo, never the exact size", () => {
    let seen = 0;
    for (let seed = 1; seed < 30 && seen < 4; seed++) {
      for (let t = 0; t < 20 * MIN && seen < 4; t += 61_000) {
        const rum = rumourAt(seed, t, "easy");
        if (!rum) continue;
        seen++;
        const name = `${rum.cargo[0].toUpperCase()}${rum.cargo.slice(1)}`;
        expect(rum.label).toMatch(/rumoured/);
        expect(rum.label).toContain(name);
        expect(rum.label).toMatch(/in ~1 min/);
        expect(rum.label).toContain(rum.boom ? "+25–50%" : "−20–35%");
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("is deterministic — same seed, clock and skill, same rumour", () => {
    for (const skill of ["easy", "normal", "hard"]) {
      const a = rumourAt(99, 7 * MIN + 12_000, skill);
      resetMarketCache();
      const b = rumourAt(99, 7 * MIN + 12_000, skill);
      expect(b).toEqual(a);
    }
  });
});

describe("MKT-2 rumours > honesty", () => {
  it("is always right on Easy and Normal", () => {
    for (const skill of ["easy", "normal"]) {
      for (const seed of [1, 7, 42, 1337]) {
        for (let slot = 1; slot <= 300; slot++) {
          const rum = rumourAt(seed, (slot - 1) * EVENT_SLOT_MS + 1_000, skill);
          const truth = truthForSlot(seed, slot);
          if (!truth) {
            expect(rum, `seed ${seed} slot ${slot}`).toBeNull();
          } else {
            expect(rum?.cargo, `seed ${seed} slot ${slot}`).toBe(truth.cargo);
            expect(rum?.boom, `seed ${seed} slot ${slot}`).toBe(truth.mult > 1);
          }
        }
      }
    }
  });

  it("holds the 70% hit rate on Hard (deterministic)", () => {
    let hits = 0, total = 0, falseQuiets = 0;
    for (const seed of [1, 2, 3]) {
      for (let slot = 1; slot <= 2000; slot++) {
        const rum = rumourAt(seed, (slot - 1) * EVENT_SLOT_MS + 1_000, "hard");
        const truth = truthForSlot(seed, slot);
        if (!truth) {
          if (rum) falseQuiets++;   // a false rumour on a quiet slot
          continue;
        }
        total++;
        if (rum && rum.cargo === truth.cargo && rum.boom === (truth.mult > 1)) hits++;
      }
    }
    expect(total).toBeGreaterThan(500);   // ~34% of slots fire
    const rate = hits / total;
    expect(rate).toBeGreaterThan(RUMOUR_HARD_HIT_RATE - 0.1);
    expect(rate).toBeLessThan(RUMOUR_HARD_HIT_RATE + 0.1);
    expect(hits).toBeLessThan(total);     // some rumours ARE false
    expect(falseQuiets).toBeGreaterThan(0);
  });
});

describe("MKT-2 alerts > one crossing, one firing", () => {
  it("fires once per crossing and re-arms below the line", () => {
    const m = createMarket(11);
    const t = 3 * MIN + 30_000;   // mid-slot, away from event boundaries
    // set the line just under the live price: the next tick fires at once…
    const alert = createAlert("ore", priceOf(m, "ore", t) * 0.995);
    expect(alertTick(m, alert, t)).toBe(true);
    // …while the price sits above the line it stays silent (no stream)…
    expect(alertTick(m, alert, t + 1_000)).toBe(false);
    // …a dump pushes the price under the line: silent, but re-armed…
    sell(m, "ore", 60, t + 1_000);
    let dip = -1;   // the scan only READS prices — no ticks, no state change
    for (let k = t + 1_000; k < t + 10 * MIN; k += 5_000) {
      if (priceOf(m, "ore", k) < alert.above) { dip = k; break; }
    }
    expect(dip).toBeGreaterThan(0);
    expect(alertTick(m, alert, dip)).toBe(false);
    // …and the recovered price fires exactly once more.
    let rise = -1;
    for (let k = dip; k < dip + 30 * MIN; k += 5_000) {
      if (priceOf(m, "ore", k) >= alert.above) { rise = k; break; }
    }
    expect(rise).toBeGreaterThan(0);
    expect(alertTick(m, alert, rise)).toBe(true);
    expect(alertTick(m, alert, rise + 1_000)).toBe(false);
  });

  it("fires when the price sits exactly on the line", () => {
    const m = createMarket(5);
    const alert = createAlert("oil", priceOf(m, "oil", MIN));
    expect(alertTick(m, alert, MIN)).toBe(true);
    expect(alertTick(m, alert, MIN)).toBe(false);
  });
});

describe("MKT-2 > the rival waits out a rumoured boom", () => {
  it("holds what it would have sold, but the dump floor still sells", () => {
    const m = createMarket(2026);
    // a clock where the PRICE rule fires on a small pile (no dump floor)
    let t = 0;
    while (t < 60 * MIN && rivalSellLot(m, "ore", 30, 0, t) === 0) t += 5_000;
    expect(rivalSellLot(m, "ore", 30, 0, t)).toBeGreaterThan(0);
    expect(rivalSellLot(m, "ore", 30, 0, t, { rumourBoom: true })).toBe(0);
    // …but a warehouse still cashes out, rumour or not
    expect(rivalSellLot(m, "ore", 500, 0, t, { rumourBoom: true })).toBeGreaterThan(0);
    expect(rivalSellLot(m, "gold", 500, 0, t)).toBe(0);
  });
});

describe("MKT-2 > the buy quote", () => {
  it("pays the spread over the live sale price", () => {
    const m = createMarket(7);
    const t = 4 * MIN + 9_000;
    expect(buyPrice(m, "oil", t)).toBeCloseTo(priceOf(m, "oil", t) * (1 + BUY_SPREAD), 10);
    expect(quoteBuy(m, "oil", 10, t).cost).toBe(Math.ceil(buyPrice(m, "oil", t) * 10));
    expect(quoteBuy(m, "oil", 10, t).cost).toBeGreaterThan(quoteSale(m, "oil", 10, t).revenue);
    expect(quoteBuy(m, "gold", 10, t)).toEqual({ units: 0, cost: 0 });
    expect(quoteBuy(m, "oil", 0, t)).toEqual({ units: 0, cost: 0 });
  });
});

// ── the two-seat room ─────────────────────────────────────────────────────
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

/** The `window.__iso` hook, narrowed to what these specs drive. */
interface Market465Hook {
  purses: Record<string, number>[];
  moneys: number[];
  setSeatMoney(i: number, v: number): void;
  exchangeSell: (cargo: Cargo, n: number | "all") => number | string;
  exchangeBuy: (cargo: Cargo, n: number) => number | string;
  setAlert: (cargo: Cargo, above: number | null) => string;
  checkAlerts: () => Cargo[];
  market: {
    ms: number;
    rumour: () => string | null;
  };
}

const hook = () => (window as unknown as { __iso: Market465Hook }).__iso;
const settle = async (n = 12) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

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

async function until(cond: () => boolean, ms = 4000): Promise<void> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    pump();
    if (cond()) return;
    await settle(1);
  }
  pump();
}

function greet(msg: WelcomeMsg, privateTo?: Endpoint): void {
  for (const e of endpoints) e.deliver(msg);
  privateTo?.deliverPrivate(msg);
}

const SEED = 1337;
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

async function boot(opts: Record<string, unknown>): Promise<Market465Hook> {
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

async function bootPair(): Promise<{ host: Market465Hook; guest: Market465Hook }> {
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
  return { host, guest };
}

describe("MKT-2 > a guest can sell in a two-seat room", () => {
  it("relays the sale to the host, which applies it to the guest's seat", async () => {
    const { host, guest } = await bootPair();
    host.purses[1].ore = 20;
    const moneyBefore = host.moneys[1];
    // the guest's click is a REQUEST: it moves nothing locally…
    const guestOreBefore = guest.purses[0].ore;
    // …and the host prices it at its own clock — read here, because the
    // delivery below is synchronous and the clock cannot move mid-pump.
    const ms0 = host.market.ms;
    const expected = quoteSale(createMarket(SEED), "ore", 10, ms0).revenue;
    expect(guest.exchangeSell("ore", 10)).toBe("relayed");
    expect(guest.purses[0].ore).toBe(guestOreBefore);
    // …until the host applies the intent against the guest's seat…
    pump();
    expect(host.purses[1].ore).toBe(10);
    expect(host.moneys[1] - moneyBefore).toBe(expected);
    // …and the forced publish mirrors it back to the guest.
    await until(() => guest.purses[0].ore === 10 && guest.moneys[0] === host.moneys[1]);
    expect(guest.purses[0].ore).toBe(10);
    expect(guest.moneys[0]).toBe(host.moneys[1]);
  });

  it("the host refuses what the guest cannot sell (gold, an empty purse)", async () => {
    const { host, guest } = await bootPair();
    expect(guest.exchangeSell("gold", 1)).toMatch(/Black Market/);
    host.purses[1].wood = 0;
    const moneyBefore = host.moneys[1];
    expect(guest.exchangeSell("wood", 5)).toBe("relayed");
    pump();
    await settle(4);
    pump();
    expect(host.purses[1].wood).toBe(0);
    expect(host.moneys[1]).toBe(moneyBefore);
  });
});

describe("MKT-2 > Buy works", () => {
  it("money down, cargo up, spread applied", async () => {
    const { host } = await bootPair();
    host.setSeatMoney(0, 10_000);
    host.purses[0].ore = 3;
    // the host applies a local buy synchronously, so the quote below prices
    // the exact clock the trade runs at — no drift, no tolerance.
    const ms0 = host.market.ms;
    const expected = quoteBuy(createMarket(SEED), "ore", 10, ms0);
    expect(expected.cost).toBeGreaterThan(quoteSale(createMarket(SEED), "ore", 10, ms0).revenue);
    expect(host.exchangeBuy("ore", 10)).toBe(10);
    expect(host.purses[0].ore).toBe(13);
    expect(host.moneys[0]).toBe(10_000 - expected.cost);
    // and a seat that cannot pay is refused with the price, moving nothing
    host.setSeatMoney(0, 1);
    expect(host.exchangeBuy("ore", 10)).toMatch(/Not enough money/);
    expect(host.purses[0].ore).toBe(13);
    expect(host.moneys[0]).toBe(1);
  });

  it("a guest's buy relays through the host like a sale", async () => {
    const { host, guest } = await bootPair();
    host.setSeatMoney(1, 10_000);
    host.purses[1].oil = 2;
    const ms0 = host.market.ms;
    const expected = quoteBuy(createMarket(SEED), "oil", 10, ms0);
    expect(guest.exchangeBuy("oil", 10)).toBe("relayed");
    pump();
    expect(host.purses[1].oil).toBe(12);
    expect(host.moneys[1]).toBe(10_000 - expected.cost);
    await until(() => guest.purses[0].oil === 12 && guest.moneys[0] === host.moneys[1]);
    expect(guest.moneys[0]).toBe(host.moneys[1]);
  });
});

describe("MKT-2 > alerts through the game", () => {
  it("sets, fires once, and clears (all synchronous — no frame-loop race)", async () => {
    const { host } = await bootPair();
    // ore at ~$8 can never sit under $1 (walk clamp × glut floor), so this
    // line is already crossed the moment it is set — and can never re-arm.
    expect(host.setAlert("ore", 1)).toMatch(/alert set above/);
    expect(host.checkAlerts()).toEqual(["ore"]);
    expect(host.checkAlerts()).toEqual([]);
    expect(host.setAlert("ore", null)).toMatch(/alert cleared/);
    expect(host.checkAlerts()).toEqual([]);
    expect(host.setAlert("gold", 50)).toMatch(/no exchange price/);
  });
});

describe("MKT-2 > the game prints the next slot's rumour", () => {
  it("matches the pure forecast at the game's own clock and skill", async () => {
    const { host } = await bootPair();
    const ms = host.market.ms;
    expect(host.market.rumour()).toBe(rumourAt(SEED, ms, "normal")?.label ?? null);
  });
});

it("arms and clears an alert through the actual Market DOM", async () => {
  const host = await boot({ newLoop: true });
  const root = roots[0];
  const input = root.querySelector<HTMLInputElement>('[data-alert="ore"]')!;
  expect(input.getAttribute("aria-label")).toBe("Ore alert at $");
  input.value = "1";
  root.querySelector<HTMLButtonElement>('[data-alert-btn="ore"]')!.click();
  expect(host.checkAlerts()).toEqual(["ore"]);
  expect(host.checkAlerts()).toEqual([]);
  expect([...root.querySelectorAll(".feed-row")].filter(n => n.textContent?.includes("Price alert — Ore"))).toHaveLength(1);
  root.querySelector<HTMLButtonElement>('[data-alert-clear="ore"]')!.disabled = false;
  root.querySelector<HTMLButtonElement>('[data-alert-clear="ore"]')!.click();
  expect(host.checkAlerts()).toEqual([]);
});
