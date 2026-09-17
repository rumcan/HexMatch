// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// L9 (#224) — the Black Market is MAP sabotage, priced against the CLOCK.
//
// The ticket's acceptance block, pinned:
//
//   • the shop lists Blockade, Protest and Security Forces, and NOTHING in it
//     touches a match-3 board — the three board cards (Frost Tiles, Iron
//     Girders, Smog Cloud) and the Repair Crew that undid them are gone from
//     the table, the UI, the raid table and the guest intents;
//   • both map cards measurably STOP THE TARGET'S INCOME TICKS for their
//     duration — a Blockade holds an industry's depots, a Protest holds every
//     depot whose route crosses the protested road — and Security Forces
//     turns both away;
//   • Gold still reaches BOTH seats at a steady rate without constant
//     matching: with the new loop on, the combo tap is closed and a tuning
//     session pays the coins instead (the rival's simulated session pays its
//     own, off difficulty);
//   • the rival raids with the same two cards at the same prices.
//
// The "measurably stops income" assertions are deliberately read off the
// PURSE through the L1b clock (`econTick`), not off a flag: a card whose only
// proof is a boolean is a card that can stop working in silence.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WATER, type Grid, type Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H, TUNING } from "../../src/iso/config";
import { buildTile, tIdx, PUBLIC_OWNER, type Track } from "../../src/iso/track";
import {
  SABOTAGE, SECURITY, BANDIT_MS, PROTEST_MS, setRng, mulberry32,
} from "../../src/game/config";
import { tuningGoldFor, rivalTuningGold } from "../../src/iso/tuning";
import { GEM_TO_CARGO } from "../../src/iso/quarry";
import { RIVAL_SKILLS } from "../../src/iso/skill";
import type { Board } from "../../src/game/board";

// ── stub the art imports (vite handles these in the browser) ──────────────
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));
vi.mock("../../assets/protest.png", () => ({ default: "protest.png" }));

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
interface L9Hook {
  grid: Grid;
  track: Track;
  eco: import("../../src/iso/economy").EconomyState;
  board: Board;
  purse: Record<string, number>;
  /**
   * L11 (#226): every seat's LIVE purse, in `players` order. The offer board
   * used to hand these out (`market.players[i].res`); the rival's is the
   * record its own economy spends from, so a test can bank it by hand.
   */
  purses: Record<string, number>[];
  finishSetup: () => void;
  placeDepot: (tx: number, ty: number) => boolean;
  econTick: (now?: number) => void;
  refreshQuarry: (now?: number) => void;
  reach: Record<string, number>;
  buyBlack: (key: string) => void;
  buyBlackFor: (seat: number, key: string) => boolean;
  armProtest: () => void;
  placeProtest: (tx: number, ty: number) => boolean;
  protests: { tx: number; ty: number; until: number; owner: string }[];
  protestPending: boolean;
  rivalPlant: { status(): { frozen: number; girders: number } };
  setRivalSkill: (key: "easy" | "normal" | "hard") => void;
  rivalRaidNow: (now?: number) => void;
  rivalTuning: () => void;
  tuningFinish: (abandon?: boolean) => void;
  readonly tuning: { depotId: number; score: number } | null;
  readonly depotYields: { id: number; owner: string; yield: number | null }[];
}

const hook = () => (window as unknown as { __iso: L9Hook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas();
  stubImage();
  window.history.replaceState(null, "", "/?seed=1337");
  localStorage.clear();
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
  root = document.createElement("div");
  Object.defineProperty(root, "clientWidth", { value: 900, configurable: true });
  Object.defineProperty(root, "clientHeight", { value: 700, configurable: true });
  document.body.appendChild(root);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
  vi.restoreAllMocks();
});

async function boot(opts: { newLoop?: boolean } = {}) {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, opts);
  await settle();
  return hook();
}

// ── the live map's own Depot sites (the shape iso-l4-tuning.test.ts uses) ──
interface Site { hx: number; hy: number; fy: number; ind: Industry }

function depotSite(grid: Grid, skipId?: number): Site | null {
  for (const ind of grid.industries) {
    if (skipId !== undefined && ind.id === skipId) continue;
    for (let x = ind.tx; x < ind.tx + ind.w; x++) {
      const hx = x, hy = ind.ty + ind.h;
      const fy = hy + 6;
      if (hy < 0 || fy >= MAP_H || hx < 0 || hx >= MAP_W) continue;
      let ok = true;
      for (let y = hy; y <= fy; y++) {
        const i = y * MAP_W + hx;
        if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) { ok = false; break; }
      }
      if (ok) return { hx, hy, fy, ind };
    }
  }
  return null;
}

/** Plant a Factory at the corridor's far end and lay the road that joins it. */
function connect(h: L9Hook, site: Site) {
  h.eco.factories.push({ owner: "you", ownerId: 1, tx: site.hx, ty: site.fy, id: 0, townId: null });
  for (let y = site.hy + 1; y < site.fy; y++) buildTile(h.track, "road", site.hx, y, 1);
}

/** Sum every cargo in the purse — what the clock paid, all told. */
const purseTotal = (p: Record<string, number>): number =>
  (["wood", "stone", "grain", "ore", "oil", "gold"] as const).reduce((n, c) => n + (p[c] ?? 0), 0);

/**
 * A connected, tuned-to-baseline Depot on the new loop, with the tuning
 * session it opened already closed — the standard fixture for "does the clock
 * still pay?". Returns what one 10s tick is worth while nothing is sabotaged.
 */
async function connectedDepot(h: L9Hook) {
  h.finishSetup();
  const site = depotSite(h.grid)!;
  expect(site, "seed 1337 keeps an industry with a legal south corridor").toBeTruthy();
  expect(h.placeDepot(site.hx, site.hy)).toBe(true);
  connect(h, site);
  await settle();
  if (h.tuning) h.tuningFinish(true);           // close the session it opened
  h.refreshQuarry();
  const perTick = Object.values(h.reach).reduce((a, b) => a + b, 0);
  expect(perTick, "the Depot is connected and delivering").toBeGreaterThan(0);
  return { site, perTick };
}

/** Run one clock tick and report what the purse gained. */
function tickGain(h: L9Hook, now: number): number {
  const before = purseTotal(h.purse);
  h.econTick(now);
  return purseTotal(h.purse) - before;
}

// ══════════════════════════════════════════════════════════════════════════
describe("L9 the shop sells map sabotage only", () => {
  it("prices exactly two cards, both aimed at a tile", () => {
    expect(Object.keys(SABOTAGE)).toEqual(["bandit", "protest"]);
    expect(SABOTAGE.bandit.gold).toBe(5);
    expect(SABOTAGE.protest.gold).toBe(6);
    for (const def of Object.values(SABOTAGE)) {
      expect(def.target, "a map card aims at the map").toBe("tile");
      // …and no card's own copy promises anything about a plant board
      expect(def.desc.toLowerCase()).not.toMatch(/gem|board|plant|frozen|girder|smog/);
    }
    // the defence is priced in MATERIALS (PP-08) and now stops both cards
    expect(SECURITY.cost).toMatchObject({ wheat: 2, brick: 1 });
    expect(SECURITY.desc).toMatch(/Blockade/);
    expect(SECURITY.desc).toMatch(/Protest/);
    expect(SECURITY.desc, "Smog no longer exists to be immune to").not.toMatch(/Smog/i);
  });

  it("lists the two cards and the defence, and nothing else, on the new loop", async () => {
    const h = await boot({ newLoop: true });
    await settle();
    expect([...root.querySelectorAll("[data-black]")].map((b) => (b as HTMLElement).dataset.black))
      .toEqual(["bandit", "protest", "security"]);
    // L1a (#232) hid the Gold shop because it sold match-3 sabotage; the
    // converted shop is map-only, so the new loop carries it again.
    expect(root.querySelector(".sab-list")).toBeTruthy();
    expect(h.purse).toBeTruthy();
  });

  it("refuses every retired card without charging, and dirties no board", async () => {
    const h = await boot();
    h.purse.gold = 40;
    await settle();
    for (const dead of ["harden", "block", "fog", "repair"]) {
      expect(root.querySelector(`[data-black="${dead}"]`), `${dead} still has a button`).toBeNull();
      h.buyBlack(dead);
    }
    await settle();
    expect(h.purse.gold, "a refused card charges nothing").toBe(40);
    expect(h.board.gems().filter((g) => g.block || g.hard > 0)).toHaveLength(0);
    // L10 (#225): the plant reads its own board — and no card can put an
    // obstacle on any board any more, so "healthy" is the only answer there is.
    expect(h.rivalPlant.status()).toMatchObject({ frozen: 0, girders: 0 });
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L9 the map cards stop the target's income ticks", () => {
  it("a Blockade holds the blockaded industry's depot for its duration", async () => {
    const h = await boot({ newLoop: true });
    const { site } = await connectedDepot(h);
    let now = performance.now();

    // baseline: the connected Depot pays every tick
    const plain = tickGain(h, now += 10_000);
    expect(plain, "a connected Depot pays").toBeGreaterThan(0);

    // Blockade THAT industry (the rival's card, aimed at the player's depot —
    // the same write `buyBlackFor` makes, through the real industry record).
    const ind = h.grid.industries.find((i) => i.id === site.ind.id)!;
    ind.banditUntil = now + BANDIT_MS;

    const blocked = tickGain(h, now += 10_000);
    expect(blocked, "a blockaded industry pays NOTHING").toBe(0);

    // …and the clock resumes by itself when the blockade lapses
    const after = tickGain(h, ind.banditUntil + 10_000);
    expect(after, "the blockade expires on its own").toBeGreaterThan(0);
  });

  it("a Protest on the Depot's own road stops that Depot, and only for its duration", async () => {
    const h = await boot({ newLoop: true });
    const { site } = await connectedDepot(h);
    let now = performance.now();
    expect(tickGain(h, now += 10_000), "baseline income").toBeGreaterThan(0);

    // Stage a protest on a road tile the Depot's route crosses. The road was
    // laid by the player, so it is made public first — `placeProtest` only
    // takes public roads (the rule the map click enforces).
    const ty = site.hy + 2;
    h.track.owner[tIdx(site.hx, ty)] = PUBLIC_OWNER;
    h.purse.gold = SABOTAGE.protest.gold;
    h.armProtest();
    expect(h.protestPending).toBe(true);
    expect(h.placeProtest(site.hx, ty)).toBe(true);
    expect(h.purse.gold, "the protest was paid for").toBe(0);
    expect(h.protests).toHaveLength(1);

    const held = tickGain(h, now += 10_000);
    expect(held, "every depot routed through the protest stops").toBe(0);

    // the crowd goes home after PROTEST_MS and the depot pays again
    const until = h.protests[0].until;
    expect(until).toBeGreaterThan(now);
    expect(tickGain(h, until + 10_000)).toBeGreaterThan(0);
  });

  it("a Protest somewhere else on the map costs the Depot nothing", async () => {
    const h = await boot({ newLoop: true });
    const { site } = await connectedDepot(h);
    let now = performance.now();
    expect(tickGain(h, now += 10_000)).toBeGreaterThan(0);

    // A public road far from this Depot's route: laid, made public, protested.
    const fx = site.hx, fy = Math.min(MAP_H - 1, site.fy + 4);
    expect(fy).toBeGreaterThan(site.fy);
    buildTile(h.track, "road", fx, fy, 1);
    h.track.owner[tIdx(fx, fy)] = PUBLIC_OWNER;
    h.purse.gold = SABOTAGE.protest.gold;
    h.armProtest();
    expect(h.placeProtest(fx, fy)).toBe(true);

    expect(tickGain(h, now += 10_000), "an unrelated road stops nobody").toBeGreaterThan(0);
  });

  it("stops the RIVAL's clock too, now that both seats earn on it (#235)", async () => {
    // L1d (#235) landed beside this ticket: the new-loop clock pays BOTH
    // seats from their own connected depots. A Protest is therefore a card
    // the player can aim at the rival's INCOME, not just a thing that happens
    // to them — this pins that the skip lives inside the two-seat loop and
    // reads the rival's own routes.
    const h = await boot({ newLoop: true });
    h.finishSetup();
    // A rival depot + factory joined by its own road, the mirror of the
    // player fixture above.
    const site = depotSite(h.grid)!;
    h.eco.harvesters.push({ id: 700, owner: "ai", ownerId: 2, tx: site.hx, ty: site.hy });
    h.eco.factories.push({ owner: "ai", ownerId: 2, tx: site.hx, ty: site.fy, id: 7, townId: null });
    for (let y = site.hy + 1; y < site.fy; y++) buildTile(h.track, "road", site.hx, y, 2);
    h.rivalTuning();                       // give it a yield to be multiplied by

    const rival = h.purses[1];
    const rivalTotal = () => purseTotal(rival);
    let now = performance.now();
    let before = rivalTotal();
    h.econTick(now += 10_000);
    expect(rivalTotal() - before, "the rival earns on the clock (#235)").toBeGreaterThan(0);

    // The player protests the rival's own haul road.
    const ty = site.hy + 2;
    h.track.owner[tIdx(site.hx, ty)] = PUBLIC_OWNER;
    h.purse.gold = SABOTAGE.protest.gold;
    h.armProtest();
    expect(h.placeProtest(site.hx, ty)).toBe(true);

    before = rivalTotal();
    h.econTick(now += 10_000);
    expect(rivalTotal() - before, "the rival's depot is held by the crowd").toBe(0);

    // …and it resumes on its own when the crowd goes home.
    before = rivalTotal();
    h.econTick(h.protests[0].until + 10_000);
    expect(rivalTotal() - before).toBeGreaterThan(0);
  });

  it("Security Forces turn BOTH cards away for the guard's duration", async () => {
    const h = await boot({ newLoop: true });
    const { site } = await connectedDepot(h);
    let now = performance.now();

    // Hire the guard the way the button does — materials, not Gold. The iso
    // purse is in CARGO (the board's gem names map through `GEM_TO_CARGO`).
    for (const [gem, n] of Object.entries(SECURITY.cost ?? {})) {
      h.purse[GEM_TO_CARGO[gem as keyof typeof GEM_TO_CARGO]] = n + 2;
    }
    expect(h.buyBlackFor(0, "security")).toBe(true);

    // A protest on the Depot's own route now bounces off the guard.
    const ty = site.hy + 2;
    h.track.owner[tIdx(site.hx, ty)] = PUBLIC_OWNER;
    h.purse.gold = SABOTAGE.protest.gold;
    h.armProtest();
    expect(h.placeProtest(site.hx, ty)).toBe(true);
    expect(tickGain(h, now += 10_000), "guarded routes keep ticking").toBeGreaterThan(0);

    // and the guard is a CLOCK, not a permanent immunity: past its window the
    // same standing protest bites again.
    expect(tickGain(h, now + SECURITY.ms + 10_000), "the guard runs out").toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L9 Gold reaches both seats without constant matching", () => {
  it("maps a session score to coins, bounded by the table", () => {
    expect(tuningGoldFor(0)).toBe(0);
    expect(tuningGoldFor(-5)).toBe(0);
    expect(tuningGoldFor(Number.NaN)).toBe(0);
    // anything cleared is worth at least the floor, a full session the ceiling
    expect(tuningGoldFor(1)).toBe(TUNING.minGold);
    expect(tuningGoldFor(TUNING.targetScore)).toBe(TUNING.maxGold);
    expect(tuningGoldFor(TUNING.targetScore * 10)).toBe(TUNING.maxGold);
    let last = -Infinity;
    for (let score = 0; score <= TUNING.targetScore; score += 3) {
      const g = tuningGoldFor(score);
      expect(g).toBeGreaterThanOrEqual(last);        // monotonic
      expect(g).toBeLessThanOrEqual(TUNING.maxGold);
      last = g;
    }
    // a card must be reachable in a sane number of sessions
    expect(TUNING.maxGold).toBeGreaterThan(0);
    expect(Math.ceil(SABOTAGE.protest.gold / TUNING.maxGold)).toBeLessThanOrEqual(3);
  });

  it("pays the player for a finished session — and nothing for an abandoned one", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy)).toBe(true);
    await settle();
    expect(h.tuning).not.toBeNull();
    const before = h.purse.gold ?? 0;

    h.board.onClear(TUNING.targetScore, 1);          // a full session
    h.tuningFinish(false);
    await settle();
    expect((h.purse.gold ?? 0) - before).toBe(TUNING.maxGold);

    // A second Depot, abandoned, pays nothing — the coins are for the WORK.
    const gold = h.purse.gold ?? 0;
    const site2 = depotSite(h.grid, site.ind.id)!;
    for (const c of ["wood", "stone", "grain", "ore", "oil"]) h.purse[c] = 20;  // past the free one
    expect(h.placeDepot(site2.hx, site2.hy)).toBe(true);
    await settle();
    h.board.onClear(TUNING.targetScore, 1);
    h.tuningFinish(true);
    await settle();
    expect(h.purse.gold ?? 0).toBe(gold);
  });

  it("closes the combo tap on the new loop, and leaves it alone on the shipped one", async () => {
    const neu = await boot({ newLoop: true });
    const before = neu.purse.gold ?? 0;
    for (let i = 0; i < 10; i++) neu.board.registerCombo();
    expect(neu.purse.gold ?? 0, "matching is no longer a Gold tap").toBe(before);
    dispose?.(); dispose = undefined;
    root.remove();
    root = document.createElement("div");
    Object.defineProperty(root, "clientWidth", { value: 900, configurable: true });
    Object.defineProperty(root, "clientHeight", { value: 700, configurable: true });
    document.body.appendChild(root);

    // …and the shipped loop is untouched: 2 combos still buy a coin (W5).
    const old = await boot();
    for (let i = 0; i < 10; i++) old.board.registerCombo();
    expect(old.purse.gold ?? 0).toBe(5);
  });

  it("funds the RIVAL's raid table off its own simulated sessions", async () => {
    for (const key of ["easy", "normal", "hard"] as const) {
      const g = rivalTuningGold(key);
      expect(g).toBeGreaterThanOrEqual(TUNING.minGold);
      expect(g).toBeLessThanOrEqual(TUNING.maxGold);
      expect(rivalTuningGold(key)).toBe(g);          // deterministic
      expect(RIVAL_SKILLS[key].tuningSkill).toBeGreaterThanOrEqual(0);
    }
    expect(rivalTuningGold("hard")).toBeGreaterThanOrEqual(rivalTuningGold("easy"));

    // through the game: a rival depot's simulated session pays its purse
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const site = depotSite(h.grid)!;
    h.eco.harvesters.push({ id: 900, owner: "ai", ownerId: 2, tx: site.hx, ty: site.hy });
    const rival = h.purses[1];
    const before = rival.gold ?? 0;
    h.rivalTuning();
    expect((rival.gold ?? 0) - before, "the rival banks its own session")
      .toBe(rivalTuningGold("normal"));
    // and the level really was set (the same sweep, one pass)
    expect(h.depotYields.find((d) => d.id === 900)!.yield).not.toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L9 the rival raids with the same two cards", () => {
  it("keeps its raid table to the shop's map cards, at the shop's prices", async () => {
    const h = await boot();
    await settle();
    // the rival pays the table price for the card it plays — both are priced
    // in the same `SABOTAGE` record the player's buttons read
    expect(SABOTAGE.bandit.gold).toBe(5);
    expect(SABOTAGE.protest.gold).toBe(6);
    // it cannot play a card that no longer exists: seat 1 through the shared
    // core refuses a retired key without charging
    const rival = h.purses[1];
    rival.gold = 30;
    for (const dead of ["harden", "block", "fog", "repair"]) {
      expect(h.buyBlackFor(1, dead), `${dead} was sold to the rival`).toBe(false);
    }
    expect(rival.gold, "a refused raid costs the rival nothing").toBe(30);
    expect(h.rivalPlant.status()).toMatchObject({ frozen: 0, girders: 0 });
  });

  it("charges the rival and blockades a player industry when it plays the Blockade", async () => {
    const h = await boot({ newLoop: true });
    await connectedDepot(h);
    const rival = h.purses[1];
    rival.gold = SABOTAGE.bandit.gold;
    expect(h.buyBlackFor(1, "bandit")).toBe(true);
    expect(rival.gold).toBe(0);
    const now = performance.now();
    const hit = h.grid.industries.filter((i) => i.banditUntil > now);
    expect(hit.length, "the raid landed on exactly one industry").toBe(1);
    expect(hit[0].banditUntil).toBeLessThanOrEqual(now + BANDIT_MS + 50);
  });

  it("stages a rival Protest on a road that actually carries the player's cargo", async () => {
    const h = await boot({ newLoop: true });
    const { site } = await connectedDepot(h);
    // the route is the player's own road; a raid stages on public road, so the
    // corridor is made public the way a town road would be
    for (let y = site.hy + 1; y < site.fy; y++) h.track.owner[tIdx(site.hx, y)] = PUBLIC_OWNER;
    const rival = h.purses[1];
    rival.gold = SABOTAGE.protest.gold;          // exactly one raid's worth
    h.rivalRaidNow();
    expect(rival.gold, "the raid pays the shop price").toBe(0);
    expect(h.protests.length).toBe(1);
    const p = h.protests[0];
    expect(p.until).toBeGreaterThan(performance.now());
    expect(p.until).toBeLessThanOrEqual(performance.now() + PROTEST_MS + 200);
    // …and it bites: the player's connected Depot stops paying
    expect(p.tx).toBe(site.hx);
    expect(tickGain(h, performance.now() + 10_000)).toBe(0);
  });

  it("skips a raid it cannot place rather than burning the Gold", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const rival = h.purses[1];
    rival.gold = 30;
    h.rivalRaidNow();                                 // no public roads, no depots
    expect(h.protests).toHaveLength(0);
    expect(rival.gold, "nothing to hit is not a purchase").toBe(30);
  });
});
