// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// BUILD-1 (#460) — placement assist: legal spots, reasons with fixes, cost
// clarity, 8-second undo.
//
// Acceptance pinned here:
//   1. the legal-spot set the armed tool paints IS the placement acceptance —
//      compared tile for tile against the very rule functions the clicks run
//      (`planDepotPlacement`, `plantRefusal` × `planFactoryPlacement`,
//      `platformRefusal`) over three seeds;
//   2. refused tiles answer with a reason AND a fix at the cursor;
//   3. build cards quote $, town upgrades quote cargo — never mixed
//      (snapshot of the build cards);
//   4. undo within 8 s refunds exactly and restores the tiles; refused once
//      something depends on the build; a guest's undo rides through the host.
//
// Harnesses copied from iso-412-rival-smoke.test.ts (solo jsdom boot) and
// iso-181-rail-mp.test.ts (host/guest pair over the queued relay).
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { NetSession } from "../../src/net/session";
import { PROTOCOL_VERSION, type HexProtocol, type WelcomeMsg } from "../../src/net/protocol";
import type { HexRoom } from "../../src/net/transport";
import { MAP_W, MAP_H, PLANT_COST, moneyValueOf } from "../../src/iso/config";
import { mulberry32, setRng } from "../../src/game/config";
import { lockedIndustryIdsFor, type EconomyState } from "../../src/iso/economy";
import { factoryFootprintOf, rotatedSpan, type Grid } from "../../src/iso/grid";
import { planFactoryPlacement } from "../../src/iso/placement";
import { PLANT_COST, plantRefusal } from "../../src/iso/plants";
import {
  ANCHOR_RANGE, PLATFORM_FOOTPRINT, platformRefusal, type RailState, type RailView,
} from "../../src/iso/rail";
import type { Track } from "../../src/iso/track";

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
interface AssistHook {
  phase: string;
  grid: Grid;
  track: Track;
  eco: EconomyState;
  factories: { owner: string; ownerId: number; tx: number; ty: number; id?: number; rot?: number }[];
  harvesters: { id: number; owner: string; tx: number; ty: number }[];
  money: number;
  moneys: number[];
  purses: Record<string, number>[];
  players: { i: number; id: string; human: boolean }[];
  setSeatMoney: (i: number, v: number) => void;
  setTool: (t: string) => void;
  placementPlan: (kind: "factory" | "depot", tx: number, ty: number) => { valid: boolean; why: string | null; code: string | null };
  placeFactory: (tx: number, ty: number) => boolean;
  placeDepot: (tx: number, ty: number) => boolean;
  placePlant: (tx: number, ty: number, who?: "you" | "ai") => boolean;
  placeDamAt: (tx: number, ty: number, side?: string) => boolean;
  dragBuild: (kind: string, ax: number, ay: number, bx: number, by: number, xFirst?: boolean) => unknown;
  demolish: (tx: number, ty: number) => void;
  finishSetup: () => void;
  // BUILD-1 hooks
  legalSpots: (kind: "harvester" | "plant" | "platform") => [number, number][];
  assistAt: (tx: number, ty: number) => { reason: string; fix: string } | null;
  /** #456's read-only twin — the Level tool's own price for a rectangle. */
  levelCostOf: (ax: number, ay: number, bx: number, by: number) =>
    { money: number; levels: number } | { refusal: string };
  undoInfo: (now?: number, seat?: number) =>
    { kind: string; seat: number; leftMs: number; blocked: string | null } | null;
  undoBuild: (now?: number) => string | null;
  tuning?: unknown;
  tuningFinish?: (abandon?: boolean) => void;
  railState: RailState;
  setRailView: (v: string) => string;
}

const hook = () => (window as unknown as { __iso: AssistHook }).__iso;
const settle = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const key = (x: number, y: number) => `${x},${y}`;

/** A factory site the map's own rules accept (the iso-181 pattern). */
function findFactorySite(h: AssistHook, skip: Set<string> = new Set()): [number, number] {
  for (let x = 0; x < MAP_W; x++) {
    for (let y = 0; y < MAP_H; y++) {
      if (skip.has(key(x, y))) continue;
      if (h.placementPlan("factory", x, y).valid) return [x, y];
    }
  }
  throw new Error("no legal factory site on the map");
}

// ══════════════════════════════ solo boot ══════════════════════════════════
let root: HTMLDivElement;
let dispose: (() => void) | undefined;

function prepareDom() {
  stubCanvas();
  stubImage();
  localStorage.removeItem("hexmatch:save");
  localStorage.setItem("hexmatch:rival-skill", "normal");
  localStorage.setItem("hexmatch:tutorial", "never");
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
}

async function bootSolo(seed: number): Promise<AssistHook> {
  window.history.replaceState(null, "", `/?seed=${seed}`);
  setRng(mulberry32(seed));
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, { newLoop: true, rivers: true, elevation: true, shapes: true, rings: true });
  await settle();
  return hook();
}

function teardownSolo() {
  dispose?.();
  dispose = undefined;
  root?.remove();
  vi.restoreAllMocks();
}

/**
 * Commit one dirt drag out of the seat's opening buildings (factory first,
 * then the setup Depot) — a guaranteed world edit for the undo-dependency
 * tests. Returns the committed preview, or null when the map refuses.
 */
function layDirtSomewhere(h: AssistHook): unknown {
  const starts: [number, number][] = [];
  const mine = h.factories.find((f) => f.owner === h.players[0].id);
  if (mine) for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) starts.push([mine.tx + dx, mine.ty + dy]);
  const depot = h.harvesters.find((d) => d.owner === h.players[0].id);
  if (depot) for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) starts.push([depot.tx + dx, depot.ty + dy]);
  for (const [sx, sy] of starts) {
    for (const [ex, ey] of [[sx + 1, sy], [sx, sy + 1], [sx - 1, sy], [sx, sy - 1]] as [number, number][]) {
      const laid = h.dragBuild("dirt", sx, sy, ex, ey);
      if (laid) return laid;
    }
  }
  return null;
}

/** Open the game into `play` with a factory and the free setup Depot down. */
function playOpening(h: AssistHook): [number, number] {
  const [fx, fy] = findFactorySite(h);
  expect(h.placeFactory(fx, fy), "the opening factory lands").toBe(true);
  const spots = h.legalSpots("harvester");
  expect(spots.length, "legal depot spots exist").toBeGreaterThan(0);
  expect(h.placeDepot(spots[0][0], spots[0][1]), "the setup depot lands").toBe(true);
  // New loop: a Depot is BORN with its tuning session, and only one session
  // may run at a time — abandon it so later builds are not gated on a board.
  if (h.tuning && typeof h.tuningFinish === "function") h.tuningFinish(true);
  h.finishSetup();
  expect(h.phase).toBe("play");
  return spots[0];
}

/** The seat's own plant count, factories table and all. */
const plantsOfMine = (h: AssistHook): number =>
  h.factories.filter((f) => f.owner === h.players[0].id).length;

// ════════════════ 1. legal spots == placement acceptance ══════════════════
describe("#460 legal-spot scans match placement acceptance over seeds", () => {
  afterEach(() => { teardownSolo(); });

  for (const seed of [7, 42, 1337]) {
    it(`seed ${seed}: depot, plant and platform scans agree with the rules`, async () => {
      prepareDom();
      const h = await bootSolo(seed);

      // ── Depots: membership == planDepotPlacement verdict over the ring ──
      const depotSpots = new Set(h.legalSpots("harvester").map(([x, y]) => key(x, y)));
      let depotChecked = 0;
      for (const ind of h.grid.industries) {
        for (let ty = ind.ty - 2; ty <= ind.ty + ind.h; ty++) {
          for (let tx = ind.tx - 2; tx <= ind.tx + ind.w; tx++) {
            const valid = h.placementPlan("depot", tx, ty).valid;
            expect(depotSpots.has(key(tx, ty)), `seed ${seed} depot ${tx},${ty}`).toBe(valid);
            depotChecked++;
          }
        }
      }
      expect(depotChecked).toBeGreaterThan(0);
      expect(depotSpots.size, "the map offers depot spots").toBeGreaterThan(0);

      // ── Plants: membership == plantRefusal × planFactoryPlacement ───────
      const plantSpots = new Set(h.legalSpots("plant").map(([x, y]) => key(x, y)));
      const fp = factoryFootprintOf(h.grid);
      const [fw, fh] = rotatedSpan(fp[0], fp[1], 0);
      let plantChecked = 0;
      for (const t of h.grid.towns) {
        const tiles = [[t.tx, t.ty], ...t.houses, ...(t.roads ?? [])] as [number, number][];
        for (const [hx, hy] of tiles) {
          for (let dy = -fh; dy <= 1; dy++) {
            for (let dx = -fw; dx <= 1; dx++) {
              const x = hx + dx, y = hy + dy;
              if (x < 0 || y < 0 || x >= h.grid.w || y >= h.grid.h) continue;
              const accepted = plantRefusal(h.grid, h.track, h.eco, x, y, 0) === null
                && planFactoryPlacement(h.grid, x, y, { requireTown: true, track: h.track, rot: 0 }).valid;
              expect(plantSpots.has(key(x, y)), `seed ${seed} plant ${x},${y}`).toBe(accepted);
              plantChecked++;
            }
          }
        }
      }
      expect(plantChecked).toBeGreaterThan(0);
      expect(plantSpots.size, "the map offers plant spots").toBeGreaterThan(0);

      // ── Platforms: membership == platformRefusal around every anchor ────
      const view = (typeof h.setRailView === "function" ? h.setRailView("se") : "se") as RailView;
      const rs = h.railState;
      const plants = h.factories.map((f) => ({
        ownerId: f.ownerId, tx: f.tx, ty: f.ty, id: f.id ?? 0, rot: f.rot ?? 0,
      }));
      const ownerId = h.players[0].i + 1;
      const locked = lockedIndustryIdsFor(h.eco, h.players[0].id);
      const platSpots = new Set(h.legalSpots("platform").map(([x, y]) => key(x, y)));
      const [pw, ph] = PLATFORM_FOOTPRINT[view];
      const anchors: [number, number][] = [];
      for (const ind of h.grid.industries) {
        for (let y = 0; y < ind.h; y++) for (let x = 0; x < ind.w; x++) anchors.push([ind.tx + x, ind.ty + y]);
      }
      for (const f of plants.filter((f) => f.ownerId === ownerId)) {
        const [ffw, ffh] = rotatedSpan(fp[0], fp[1], f.rot ?? 0);
        for (let y = 0; y < ffh; y++) for (let x = 0; x < ffw; x++) anchors.push([f.tx + x, f.ty + y]);
      }
      let platChecked = 0;
      const seen = new Set<string>();
      for (const [ax, ay] of anchors) {
        for (let ty = ay - ANCHOR_RANGE - (ph - 1); ty <= ay + ANCHOR_RANGE; ty++) {
          for (let tx = ax - ANCHOR_RANGE - (pw - 1); tx <= ax + ANCHOR_RANGE; tx++) {
            if (tx < 0 || ty < 0 || tx >= h.grid.w || ty >= h.grid.h) continue;
            const k = key(tx, ty);
            if (seen.has(k)) continue;
            seen.add(k);
            const ok = platformRefusal(h.grid, rs.structures, plants, ownerId, tx, ty, view,
              undefined, locked, rs.rail) === "ok";
            expect(platSpots.has(k), `seed ${seed} platform ${tx},${ty}`).toBe(ok);
            platChecked++;
          }
        }
      }
      expect(platChecked).toBeGreaterThan(0);
    }, 180_000);
  }
});

// ════════════════ 2. reasons with fixes at the cursor ═════════════════════
describe("#460 refused tiles answer with a reason and a fix", () => {
  let h: AssistHook;

  beforeAll(async () => {
    prepareDom();
    h = await bootSolo(1337);
    playOpening(h);
  });
  afterAll(() => { teardownSolo(); });

  /** The first spot around the industries whose depot plan gives `code`. */
  function depotSpotWithCode(code: string): [number, number] | null {
    for (const ind of h.grid.industries) {
      for (let ty = ind.ty - 2; ty <= ind.ty + ind.h; ty++) {
        for (let tx = ind.tx - 2; tx <= ind.tx + ind.w; tx++) {
          if (h.placementPlan("depot", tx, ty).code === code) return [tx, ty];
        }
      }
    }
    return null;
  }

  /**
   * The first tile ANYWHERE whose depot plan gives `code` — water only ever
   * refuses where water actually is, which need not be beside an industry.
   */
  function anySpotWithCode(code: string): [number, number] | null {
    for (let x = 0; x < MAP_W; x++) {
      for (let y = 0; y < MAP_H; y++) {
        if (h.placementPlan("depot", x, y).code === code) return [x, y];
      }
    }
    return null;
  }

  /** Every lot the depot plan refuses for slope reason (`not-flat`). */
  function notFlatLots(hh: AssistHook): [number, number][] {
    const out: [number, number][] = [];
    for (let x = 0; x < MAP_W; x++) {
      for (let y = 0; y < MAP_H; y++) {
        if (hh.placementPlan("depot", x, y).code === "not-flat") out.push([x, y]);
      }
    }
    return out;
  }

  /** The Level tool's own price for a 2x2 lot — 0 when it refuses to level it. */
  function levellableMoney(hh: AssistHook, x: number, y: number): number {
    const cost = hh.levelCostOf(x, y, x + 1, y + 1);
    return "money" in cost ? cost.money : 0;
  }

  it("water answers 'Water — build on land'", () => {
    const spot = depotSpotWithCode("water") ?? anySpotWithCode("water");
    expect(spot, "the map has a water lot").not.toBeNull();
    h.setTool("harvester");
    const assist = h.assistAt(spot![0], spot![1]);
    expect(assist).not.toBeNull();
    expect(assist!.reason).toBe("Water");
    expect(assist!.fix.length).toBeGreaterThan(0);
  });

  it("a slope Level Ground can fix answers 'Slope — level it for $N' at #456's own price", () => {
    // #456 landed as this PR's one seam: the fix quotes the Level tool's OWN
    // plan (`levelCost`) for the refused lot, so the money on the card is
    // exactly what the drag would charge — never a second price table.
    const spots = notFlatLots(h);
    const priced = spots.find(([x, y]) => levellableMoney(h, x, y) > 0);
    expect(priced, "the map has a not-flat lot Level Ground can fix").toBeTruthy();
    h.setTool("harvester");
    const assist = h.assistAt(priced![0], priced![1]);
    expect(assist).not.toBeNull();
    expect(assist!.reason).toBe("Slope");
    expect(assist!.fix).toBe(`level it for $${levellableMoney(h, priced![0], priced![1]).toLocaleString("en-US")}`);
  });

  it("a slope Level Ground cannot fix still answers 'find flat ground'", () => {
    // The other half of the seam: when the lot has a tile no level can move
    // (water, a building, rail, a cliff edge), the card never promises a
    // price the Level tool would refuse.
    const spots = notFlatLots(h);
    const stuck = spots.find(([x, y]) => levellableMoney(h, x, y) === 0);
    expect(stuck, "the map has a not-flat lot Level Ground refuses").toBeTruthy();
    h.setTool("harvester");
    const assist = h.assistAt(stuck![0], stuck![1]);
    expect(assist).not.toBeNull();
    expect(assist!.reason).toBe("Slope");
    expect(assist!.fix).toBe("find flat ground");
    expect(assist!.fix).not.toMatch(/\$/);
  });

  it("a poor purse answers 'Not enough money — $N more' (depot and plant)", () => {
    const spots = h.legalSpots("harvester");
    expect(spots.length).toBeGreaterThan(0);
    h.setTool("harvester");
    h.setSeatMoney(0, 0);
    // A rung-locked cargo answers "Rung locked" before the money question —
    // find the spot whose bill the purse actually fails.
    let depotAssist: { reason: string; fix: string } | null = null;
    for (const [x, y] of spots) {
      const a = h.assistAt(x, y);
      if (a && a.reason === "Not enough money") { depotAssist = a; break; }
    }
    expect(depotAssist, "some legal depot spot is unaffordable at $0").not.toBeNull();
    expect(depotAssist!.fix).toMatch(/^\$[\d,]+ more$/);

    const plantSpots = h.legalSpots("plant");
    expect(plantSpots.length).toBeGreaterThan(0);
    h.setTool("plant");
    const plantAssist = h.assistAt(plantSpots[0][0], plantSpots[0][1]);
    expect(plantAssist).not.toBeNull();
    expect(plantAssist!.reason).toBe("Not enough money");
    expect(plantAssist!.fix).toMatch(/^\$[\d,]+ more$/);
    h.setSeatMoney(0, 10_000);
  });

  it("a legal spot with money in the pocket has no refusal", () => {
    const spots = h.legalSpots("harvester");
    h.setTool("harvester");
    h.setSeatMoney(0, 10_000);
    // Skip rung-locked spots: they answer for the TREE, not the site.
    let open: [number, number] | null = null;
    for (const [x, y] of spots) {
      if (h.assistAt(x, y) === null) { open = [x, y]; break; }
    }
    expect(open, "some legal depot spot is fully open").not.toBeNull();
  });
});

// ════════════════ 3. cost clarity — build cards quote $ ═══════════════════
describe("#460 cost clarity on the build cards", () => {
  afterEach(() => { teardownSolo(); });

  it("every build card quotes $ and the town upgrade quotes cargo icons", async () => {
    prepareDom();
    const h = await bootSolo(1337);
    expect(h.phase).toBeTruthy();
    const cards: { tool: string; sub: string }[] = [];
    for (const btn of root.querySelectorAll<HTMLButtonElement>("button[data-tool]")) {
      const tool = btn.dataset.tool ?? "";
      if (!tool) continue;
      const sub = btn.querySelector(".bb-mid small");
      if (!sub) continue;
      cards.push({ tool, sub: (sub.textContent ?? "").replace(/\s+/g, " ").trim() });
      // Every cost chip a build card paints is MONEY — no cargo chip anywhere.
      for (const chip of sub.querySelectorAll(".cost-chip")) {
        expect(chip.classList.contains("money"),
          `build card '${tool}' quotes cargo: ${sub.innerHTML}`).toBe(true);
        expect(chip.textContent, `build card '${tool}' shows a $ price`).toMatch(/^\$[\d,]+$|^free$/);
      }
    }
    // The build cards the modebar offers — dirt, roads, depot, plant, rail,
    // platform, dam, demolish — all present and snapshotted.
    const tools = cards.map((c) => c.tool).sort();
    for (const t of ["dirt", "road", "harvester", "plant", "rail", "platform"]) {
      expect(tools, `the ${t} card exists`).toContain(t);
    }
    expect(cards).toMatchSnapshot();
    void h;
  }, 60_000);

  it("the town upgrade quote is cargo, never $", async () => {
    const { priceTownUpgrade } = await import("../../src/iso/construction");
    const { costMarkup } = await import("../../src/game/hud-icons");
    const price = priceTownUpgrade({}, 0);
    expect(price.def, "level 0 has a next tier").not.toBeNull();
    const html = costMarkup(price.cost);
    const el = document.createElement("div");
    el.innerHTML = html;
    const chips = el.querySelectorAll(".cost-chip");
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip.classList.contains("money"), "the city upgrade never quotes $").toBe(false);
    }
  });
});

/**
 * Place a PAID depot the way a player would: try legal spots until one the
 * seat can actually build (site legal AND its cargo rung open) goes down.
 * Returns the spot, or null when the map holds none the seat can afford.
 */
function placePaidDepot(h: AssistHook): [number, number] | null {
  for (const [x, y] of [...h.legalSpots("harvester")].reverse()) {
    if (h.placeDepot(x, y)) return [x, y];
  }
  return null;
}

// ════════════════ 4. the 8-second undo ════════════════════════════════════
describe("#460 the 8-second undo", () => {
  let h: AssistHook;

  beforeAll(async () => {
    prepareDom();
    h = await bootSolo(42);
    playOpening(h);
    h.setSeatMoney(0, 10_000);
  });
  afterAll(() => { teardownSolo(); });
  // A refused undo leaves its charge spent — top the purse back up so the
  // next test's affordability is never the previous test's doing.
  beforeEach(() => { h.setSeatMoney(0, 10_000); });

  it("refunds exactly and restores the tiles", () => {
    const before = { money: h.moneys[0], depots: h.harvesters.length };
    const spot = placePaidDepot(h);
    expect(spot, "a paid depot the seat may build").not.toBeNull();
    const charged = before.money - h.moneys[0];
    expect(charged, "the paid depot charges money").toBeGreaterThan(0);

    const info = h.undoInfo();
    expect(info).not.toBeNull();
    expect(info!.kind).toBe("harvester");
    expect(info!.blocked).toBeNull();
    expect(info!.leftMs).toBeGreaterThan(0);
    expect(info!.leftMs).toBeLessThanOrEqual(8000);

    expect(h.undoBuild()).toBeNull();
    expect(h.moneys[0], "the refund is 100%").toBe(before.money);
    expect(h.harvesters.length, "the depot came back off the map").toBe(before.depots);
    expect(h.undoInfo()).toBeNull();
  });

  it("refuses once the 8 seconds are over", () => {
    const depots = h.harvesters.length;
    const spot = placePaidDepot(h);
    expect(spot, "a second paid depot").not.toBeNull();
    // The info read names the reason; the build read answers like the chip
    // that has already disappeared.
    expect(h.undoInfo(performance.now() + 9000)?.blocked).toBe("the 8 seconds are over");
    const why = h.undoBuild(performance.now() + 9000);
    expect(why, "the expired window refuses").toBe("nothing to undo");
    expect(h.harvesters.length, "the depot stands").toBe(depots + 1);
    // The depot that stands keeps its born session — abandon it so the next
    // test can build at all (one session at a time on the new loop).
    if (h.tuning && typeof h.tuningFinish === "function") h.tuningFinish(true);
  });

  it("refuses once something else was built or demolished since", () => {
    const spot = placePaidDepot(h);
    expect(spot, "a third paid depot").not.toBeNull();
    expect(h.undoInfo()!.blocked).toBeNull();
    // A road out of the opening buildings' side is a world edit: the undo
    // window closes even though nothing touched the new depot itself.
    expect(layDirtSomewhere(h), "a dirt drag commits").not.toBeNull();
    const why = h.undoBuild();
    expect(why).toBe("something else was built or demolished since");
  });

  it("a plant undo refunds and takes the plant back down", () => {
    const spots = h.legalSpots("plant");
    expect(spots.length).toBeGreaterThan(0);
    const plantsBefore = plantsOfMine(h);
    const moneyBefore = h.moneys[0];
    let placed: [number, number] | null = null;
    for (const [x, y] of spots) {
      if (h.placePlant(x, y)) { placed = [x, y]; break; }
    }
    expect(placed, "a plant spot the seat can build").not.toBeNull();
    expect(h.moneys[0], "the plant charges the money price").toBe(moneyBefore - moneyValueOf(PLANT_COST));
    const info = h.undoInfo();
    expect(info!.kind).toBe("plant");
    expect(info!.blocked).toBeNull();
    expect(h.undoBuild()).toBeNull();
    expect(h.moneys[0], "the plant refund is 100%").toBe(moneyBefore);
    expect(plantsOfMine(h)).toBe(plantsBefore);
  });
});

// ════════════════ 5. guest undo rides through the host ════════════════════
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

describe("#460 a guest's undo goes through the host", () => {
  const SEED = 1337;
  let endpoints: Endpoint[] = [];
  const roots: HTMLDivElement[] = [];
  const disposers: (() => void)[] = [];

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
  async function boot(role: "host" | "guest", net: NetSession): Promise<AssistHook> {
    const r = document.createElement("div");
    Object.defineProperty(r, "clientWidth", { value: 900, configurable: true });
    Object.defineProperty(r, "clientHeight", { value: 700, configurable: true });
    document.body.appendChild(r);
    roots.push(r);
    const { startIsoGame } = await import("../../src/iso/game");
    disposers.push(startIsoGame(r, { seed: SEED, role, net }));
    await settle();
    return hook();
  }

  beforeEach(() => {
    stubCanvas();
    stubImage();
    window.history.replaceState(null, "", `/?seed=${SEED}`);
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
    disposers.length = 0;
    for (const r of roots) r.remove();
    roots.length = 0;
    vi.restoreAllMocks();
  });

  it("the host refunds a guest's build and refuses once the world moved", async () => {
    const hostEnd = new Endpoint("host-socket", "HX460A");
    const guestEnd = new Endpoint("guest-socket", "HX460A");
    hostEnd.peer = guestEnd;
    guestEnd.peer = hostEnd;
    endpoints = [hostEnd, guestEnd];
    const host = await boot("host", new NetSession({ room: asRoom(hostEnd), role: "host" }));
    const guest = await boot("guest", new NetSession({ room: asRoom(guestEnd), role: "guest" }));
    const greet = (msg: WelcomeMsg, privateTo?: Endpoint) => {
      for (const e of endpoints) e.deliver(msg);
      privateTo?.deliverPrivate(msg);
    };
    greet(welcomeFor(hostEnd, guestEnd, true));
    greet(welcomeFor(hostEnd, guestEnd, false), guestEnd);
    pump();

    // ── the opening for BOTH seats ────────────────────────────────────────
    const hostFactory = findFactorySite(host);
    expect(host.placeFactory(hostFactory[0], hostFactory[1])).toBe(true);
    pump();
    await until(() => guest.factories.length >= 1);
    const guestFactory = findFactorySite(guest, new Set([key(hostFactory[0], hostFactory[1])]));
    guest.placeFactory(guestFactory[0], guestFactory[1]);   // an intent on a guest
    pump();
    await until(() => host.factories.filter((f) => f.owner === guest.players[0].id).length >= 1);

    const hostSpot = host.legalSpots("harvester")[0];
    expect(host.placeDepot(hostSpot[0], hostSpot[1])).toBe(true);
    pump();
    const guestSpot = guest.legalSpots("harvester").find(
      ([x, y]) => !(x === hostSpot[0] && y === hostSpot[1]),
    );
    expect(guestSpot, "the guest has its own depot spot").toBeTruthy();
    guest.placeDepot(guestSpot![0], guestSpot![1]);       // the free setup depot
    pump();
    await until(() => host.harvesters.filter((d) => d.owner === guest.players[0].id).length >= 1);
    host.finishSetup();
    pump();
    await until(() => guest.phase === "play");

    // ── the guest's PAID depot — the undoable build. A rung-locked cargo
    //    spot is refused by the host, so try spots the way a player would. ──
    host.setSeatMoney(1, 10_000);
    pump();
    await until(() => host.moneys[1] === 10_000);
    const depotsBefore = host.harvesters.length;
    const tryGuestDepot = async (): Promise<boolean> => {
      const base = host.harvesters.length;   // re-read: a prior call built one
      for (const [x, y] of [...guest.legalSpots("harvester")].reverse()) {
        guest.placeDepot(x, y);
        pump();
        const end = performance.now() + 1500;
        while (performance.now() < end && host.harvesters.length === base) {
          pump(); await settle(1);
        }
        if (host.harvesters.length > base) return true;
      }
      return false;
    };
    expect(await tryGuestDepot(), "the guest lands a paid depot").toBe(true);
    expect(host.moneys[1], "the host charged the guest's seat").toBeLessThan(10_000);
    const charged = 10_000 - host.moneys[1];
    expect(charged, "a paid build charged real money").toBeGreaterThan(0);

    // The HOST holds the guest's undo record.
    const info = host.undoInfo(performance.now(), 1);
    expect(info, "the host keeps the guest's record").not.toBeNull();
    expect(info!.kind).toBe("harvester");
    expect(info!.blocked).toBeNull();

    // ── the guest asks for the undo; the host applies it ──────────────────
    expect(guest.undoBuild()).toBeNull();                  // sends the intent
    pump();
    await until(() => host.harvesters.length === depotsBefore);
    expect(host.moneys[1], "the refund is 100%").toBe(10_000);
    expect(host.undoInfo(performance.now(), 1)).toBeNull();

    // ── once the world moves, the guest's undo is refused ────────────────
    expect(await tryGuestDepot(), "the guest builds again").toBe(true);  // another build
    // The host's own road drag is a world edit: the guest's window closes.
    expect(layDirtSomewhere(host), "the host can lay a road").not.toBeNull();
    pump();
    guest.undoBuild();                                     // refused on the host
    pump();
    await settle(4);
    expect(host.harvesters.length, "the guest's depot stands").toBe(depotsBefore + 1);
    const blocked = host.undoInfo(performance.now(), 1);
    expect(blocked?.blocked).toBe("something else was built or demolished since");
  }, 180_000);
});
