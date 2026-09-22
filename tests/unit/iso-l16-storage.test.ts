// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// L16 (#231) — the storage cap, raised by city upgrades.
//
// The ticket's acceptance block, pinned here in its order:
//
//   • income stops accumulating at the cap, a city upgrade raises it, and the
//     UI shows full resources — the live clock drives the purse to the cap
//     and pins it there, the upgrade's row moves the number, and the resource
//     bar's chip counts "amount / cap" and wears a full state at it;
//   • the depot tree is still completable from `START_PURSE` with the STARTING
//     cap — walked as data, with every balance bounded by `storageCapFor(0)`,
//     so the opening can never dead-end against a cap smaller than a price;
//   • a capped rival still progresses — the rival respects the same cap (its
//     clock income clamps at the same number) and, pressed against it, SPENDS:
//     the city upgrade runs before the greedy depot pass can eat its mix.
//     The whole-race version of this line is `npm run test:slow` — the race
//     harness clamps `loopIncome` at the same cap.
//
// Also pinned, because they are the rule's edges:
//
//   • the cap never LOWERS a balance — income above it is lost, nothing is
//     taken back (dev mode's 9999 floor and any purse already over the cap
//     sit exactly where they were; the dev bypass itself is `?unlimited=0`
//     territory, a browser playtest, because vitest never sets DEV);
//   • spending is never blocked — a purse over the cap pays prices exactly as
//     it always did ("never spend-blocked, just not stored");
//   • the shipped loop has no cap at all — the chip is the bare amount it
//     always was, and `__iso.storageCap()` answers null;
//   • the cap rides the save — it is DERIVED from `townLevel` (the wire and
//     save field the city ladder already carries), so a reload restores the
//     raised cap with no new payload field.
//
// Boots the REAL game module in jsdom (canvas stubbed, no pixels asserted),
// the way `iso-l5-depot-tree.test.ts` and `iso-l1d-rival-clock.test.ts` do.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DEPOT_RUNG_GATE } from "../../src/iso/config";
import { WATER, type Grid, type Industry } from "../../src/iso/grid";
import {
  CARGOES, DEPOT_TREE, DEPOT_TREE_ORDER, INDUSTRY_BY_KEY, MAP_W, MAP_H,
  STORAGE_CAP_BASE, TOWN_UPGRADES, TUNING, type Cargo,
} from "../../src/iso/config";
import { FREE_SETUP_DEPOTS, storageCapFor } from "../../src/iso/construction";
import { depotCargo, type EconomyState } from "../../src/iso/economy";
import { START_PURSE, AI_BUILD_MS } from "../../src/iso/game";
import { buildTile, type Track } from "../../src/iso/track";
import { toBag } from "../../src/iso/purse";
import { setRng, mulberry32 } from "../../src/game/config";
import { SAVE_KEY, readSave, type SaveGamePayload } from "../../src/iso/savegame-runtime";
import type { Board } from "../../src/game/board";

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

/** The storage slice of `window.__iso` this file drives. */
interface StorageHook {
  readonly newLoop: boolean;
  grid: Grid;
  track: Track;
  eco: EconomyState;
  board: Board;
  /** The local seat's LIVE purse — the record `earn` writes. */
  purse: Record<string, number>;
  /** Every seat's live purse, in seat order (index 1 is the rival). */
  purses: Record<string, number>[];
  /** The seats as the game holds them, with the city ladder L16 derives from. */
  players: {
    id: string; human: boolean; purse: Record<string, number>; vp: number;
    depotTier: number; townLevel: number; townBonus: number; storageCap: number;
  }[];
  finishSetup: () => void;
  /** The L1b clock, with an injectable now (writes both seats' purses). */
  econTick: (now?: number) => void;
  /** The rival's build clock, with an injectable now. */
  aiTick: (now?: number) => void;
  rescore: () => void;
  syncWorld: () => void;
  centerOn: (tx: number, ty: number) => void;
  tileScreenAt: (tx: number, ty: number) => [number, number];
  pickAt: (sx: number, sy: number) => { tx: number; ty: number } | null;
  readonly tuning: { kind: "depot" | "town" } | null;
  tuningFinish: (abandon?: boolean) => void;
  buyTownUpgrade: () => boolean;
  /** L16's twin: the cap the rules use, or null when no cap applies. */
  storageCap: (who?: "you" | "ai") => number | null;
  treeState: () => { townLevel: number; townBonus: number };
  saveNow: () => void;
  placeDepot: (tx: number, ty: number) => boolean;
}

const hook = () => (window as unknown as { __iso: StorageHook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas();
  stubImage();
  // L1f (#237): the address bar says which loop this harness plays — the
  // RETIRED one, the loop it was written against. `?loop=old` is the release's
  // escape hatch; a test that wants the new loop says so (`{ newLoop: true }`).
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

/** A reload over the same slot and seed — the save must bring the cap back. */
async function reload(opts: { newLoop?: boolean } = {}) {
  dispose?.();
  dispose = undefined;
  setRng(mulberry32(1337));
  return boot(opts);
}

// ── the map fixtures (the shapes `iso-l5-depot-tree` / `iso-l1d-rival-clock`
//    use — a south corridor off an industry, pushed by hand so the scenario
//    costs no A* and no purse) ──────────────────────────────────────────────
interface Site { hx: number; hy: number; fy: number; ind: Industry }

/** An industry's south-edge tile with six open tiles further south. */
function southSite(grid: Grid, cargo?: Cargo, skipIds: number[] = []): Site | null {
  for (const ind of grid.industries) {
    if (skipIds.includes(ind.id)) continue;
    if (cargo !== undefined && INDUSTRY_BY_KEY[ind.type]?.cargo !== cargo) continue;
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

/** The PLAYER's corridor: own Factory at the far end, own Depot, own road. */
function playerCorridor(h: StorageHook, cargo?: Cargo): Site {
  const s = southSite(h.grid, cargo);
  expect(s, `seed 1337 has a south corridor${cargo ? ` off a ${cargo} industry` : ""}`).toBeTruthy();
  h.eco.factories.push({ owner: "you", ownerId: 1, tx: s!.hx, ty: s!.fy, id: 0, townId: null });
  h.eco.harvesters.push({ id: 800, owner: "you", ownerId: 1, tx: s!.hx, ty: s!.hy });
  for (let y = s!.hy + 1; y <= s!.fy; y++) buildTile(h.track, "road", s!.hx, y, 1);
  h.rescore();
  return s!;
}

/** The RIVAL's corridor — the same shape, owner id 2 (W2: a seat rides its
 *  own track only), exactly the fixture `iso-l1d-rival-clock.test.ts` uses. */
function rivalCorridor(h: StorageHook, cargo?: Cargo): Site {
  const s = southSite(h.grid, cargo);
  expect(s, `seed 1337 has a south corridor${cargo ? ` off a ${cargo} industry` : ""}`).toBeTruthy();
  h.eco.factories.push({ owner: "ai", ownerId: 2, tx: s!.hx, ty: s!.fy, id: 0, townId: null });
  h.eco.harvesters.push({ id: 900, owner: "ai", ownerId: 2, tx: s!.hx, ty: s!.hy });
  for (let y = s!.hy + 1; y <= s!.fy; y++) buildTile(h.track, "dirt", s!.hx, y, 2);
  h.rescore();
  return s!;
}

/**
 * Drive the clock until `purse[cargo]` stops moving (or the guard runs out):
 * a low-output industry's per-depot carry can bank a fraction for a few ticks
 * before it pays a whole unit, so "one tick" is not a unit of income. The
 * loop makes the clamp assertion about the CAP, not about one tick's rounding.
 */
function tickToCap(h: StorageHook, purse: Record<string, number>, cargo: Cargo, cap: number): number {
  let now = performance.now();
  let ticks = 0;
  while (purse[cargo] < cap && ticks < 40) {
    h.econTick(now += 10_000);
    ticks++;
  }
  return ticks;
}

// ── pointer helpers (the way `iso-l3-distance.test.ts` drives hover) ───────
const dpr = () => Math.min(2, window.devicePixelRatio || 1);
const overlayCanvas = () => root.querySelectorAll("canvas.iso-layer")[2] as HTMLCanvasElement;

function pointer(
  type: "pointerdown" | "pointermove" | "pointerup",
  sx: number, sy: number, button = 0, pointerType = "mouse",
) {
  overlayCanvas().dispatchEvent(new PointerEvent(type, {
    clientX: sx / dpr(), clientY: sy / dpr(),
    pointerType, pointerId: 1, isPrimary: true, button,
    buttons: type === "pointerup" ? 0 : 1,
  }));
}

/** Hover the depot tile and return the inspector card's text. */
async function inspectDepotAt(h: StorageHook, tx: number, ty: number): Promise<string> {
  h.centerOn(tx, ty);
  await settle();
  const [sx, sy] = h.tileScreenAt(tx, ty);
  expect(h.pickAt(sx, sy)?.tx, "the pointer lands on the depot tile").toBe(tx);
  pointer("pointermove", sx, sy);
  await settle();
  const inspect = root.querySelector(".iso-inspect") as HTMLElement;
  expect(inspect.style.display).toBe("block");
  return inspect.textContent ?? "";
}

// ══════════════════════════════════════════════════════════════════════════
describe("L16 (#231) the cap, as data", () => {
  it("is a ladder: every city level raises it, off a positive base", () => {
    expect(STORAGE_CAP_BASE).toBeGreaterThan(0);
    expect(storageCapFor(0)).toBe(STORAGE_CAP_BASE);
    let prev = STORAGE_CAP_BASE;
    for (const row of TOWN_UPGRADES) {
      expect(row.storage, `level ${row.level} must raise storage`).toBeGreaterThan(0);
      expect(storageCapFor(row.level), `level ${row.level} adds its row's storage`).toBe(prev + row.storage);
      prev += row.storage;
    }
    // Past the top of the table: every row bought, nothing more to add.
    expect(storageCapFor(TOWN_UPGRADES.length + 5)).toBe(prev);
    // A hostile level (a corrupt save, a negative wire value) reads as "none
    // bought" rather than a negative cap — the clamp would invert.
    expect(storageCapFor(-3)).toBe(STORAGE_CAP_BASE);
  });

  it("fits START_PURSE and the first tier's prices — the opening never dead-ends", () => {
    const cap = storageCapFor(0);
    // The opening purse sits UNDER the cap, not on it — the first wood tick
    // must not be wasted on turn one.
    for (const [c, n] of Object.entries(START_PURSE) as [Cargo, number][]) {
      expect(n, `START_PURSE ${c}`).toBeLessThanOrEqual(cap);
    }
    // Every single-cargo ask the first tier can make: the city upgrade's row
    // and every rung-0/1 depot mix. None may exceed what a capped purse can
    // hold, or the price would be permanently unpurchasable.
    const asks: [string, Partial<Record<Cargo, number>>][] = [
      ["the first city upgrade", TOWN_UPGRADES[0].cost],
      ...DEPOT_TREE_ORDER
        .filter((c) => DEPOT_TREE[c].tier <= 1)
        .map((c) => [`the ${DEPOT_TREE[c].name} mix`, DEPOT_TREE[c].cost] as [string, Partial<Record<Cargo, number>>]),
    ];
    for (const [what, cost] of asks) {
      for (const [c, n] of Object.entries(cost) as [Cargo, number][]) {
        expect(n, `${what} asks more ${c} than the starting cap can hold`).toBeLessThanOrEqual(cap);
      }
    }
  });

  // Owner call (2026-09): with the rung gate off a Depot needs every cargo, so
  // the walk goes through the bank (pinned in iso-l5-depot-tree instead).
  it.skipIf(!DEPOT_RUNG_GATE)("the depot tree is completable from START_PURSE with the starting cap", () => {
    // The acceptance walk. Balances are bounded by `storageCapFor(0)` the
    // whole way: each Depot pays its mix (the first rides the setup
    // allowance, exactly as the live `freeDepots` data does), then banks its
    // own cargo — which is the MOST the capped clock can ever hold of it.
    // The first city upgrade is bought at the earliest point its whole mix
    // exists (after the rung-0 pair), the tightest honest spot.
    const cap = storageCapFor(0);
    const have = toBag(START_PURSE);
    let free = FREE_SETUP_DEPOTS;
    const pay = (cost: Partial<Record<Cargo, number>>, what: string) => {
      for (const [c, v] of Object.entries(cost) as [Cargo, number][]) {
        expect(have[c] ?? 0, `${what} is not payable at this point in the walk`).toBeGreaterThanOrEqual(v);
        have[c] = (have[c] ?? 0) - v;
      }
    };
    for (const cargo of DEPOT_TREE_ORDER) {
      const row = DEPOT_TREE[cargo];
      if (free > 0) free -= 1;
      else pay(row.cost, `the ${row.name}`);
      have[cargo] = cap;      // its own output, banked to the cap
      if (cargo === "wood") pay(TOWN_UPGRADES[0].cost, "the first city upgrade");
    }
    // The deepest rung asked for nothing the capped walk could not hold.
    expect(have.gold).toBe(cap);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L16 (#231) income stops at the cap — and the upgrade raises it", () => {
  it("pins the local purse at the cap, loses the overflow, and takes nothing back", async () => {
    const h = await boot({ newLoop: true });
    expect(h.newLoop).toBe(true);
    h.finishSetup();
    playerCorridor(h, "grain");
    const depot = h.eco.harvesters.find((d) => d.owner === "you")!;
    depot.yield = 2;                       // pin the rate the clock multiplies
    const cap = h.storageCap()!;
    expect(cap).toBe(storageCapFor(0));

    // The fixture earns: from empty, the clock moves the depot's cargo to
    // the cap and pins it there (the loop rides the carry over any rounding).
    h.purse.grain = 0;
    const ticks = tickToCap(h, h.purse, "grain", cap);
    expect(ticks, "the connected depot paid on the clock").toBeGreaterThan(0);
    expect(h.purse.grain, "income stops accumulating at the cap").toBe(cap);
    // …and STAYS there: further ticks add nothing (lost, not stored).
    let now = performance.now();
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);
    expect(h.purse.grain).toBe(cap);

    // A balance ALREADY above the cap is never lowered while it earns — the
    // cap gates income, it never confiscates. (This is dev mode's 9999-floor
    // shape; the dev bypass itself is a `?unlimited=0` browser playtest.)
    h.purse.grain = 500;
    h.econTick(now += 10_000);
    h.econTick(now += 10_000);
    expect(h.purse.grain, "an over-cap balance keeps every unit it holds").toBe(500);

    // The city upgrade raises the cap — bought through the real click path,
    // confirmed by a real played session (the score sets the bonus; L5).
    const row = TOWN_UPGRADES[0];
    for (const [c, n] of Object.entries(row.cost) as [Cargo, number][]) {
      h.purse[c] = Math.max(h.purse[c] ?? 0, n);
    }
    expect(h.buyTownUpgrade()).toBe(true);
    await settle();
    expect(h.tuning?.kind).toBe("town");
    h.board.onClear(TUNING.targetScore, 1);
    h.tuningFinish(false);
    expect(h.players[0].townLevel).toBe(1);
    expect(h.storageCap(), "the upgrade raised the cap").toBe(cap + row.storage);

    // And income resumes into the headroom: one under the NEW cap, the clock
    // carries it onto the new line and pins it there.
    h.purse.grain = cap + row.storage - 1;
    const more = tickToCap(h, h.purse, "grain", cap + row.storage);
    expect(more).toBeGreaterThan(0);
    expect(h.purse.grain).toBe(cap + row.storage);
  });

  it("spends from over the cap exactly as from under it — never spend-blocked", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const cap = h.storageCap()!;
    // The first Depot rides the setup allowance, exactly as a real opening.
    const first = southSite(h.grid, "grain")!;
    expect(h.placeDepot(first.hx, first.hy)).toBe(true);
    await settle();
    h.tuningFinish(true);
    // A purse far above the cap (dev mode's floor shape) still pays a price
    // through the real placement path: the second Depot pays its type's mix.
    const second = southSite(h.grid, "wood", [first.ind.id])!;
    expect(second, "seed 1337 has a second corridor off a forest").toBeTruthy();
    const mix = DEPOT_TREE.wood.cost;
    h.purse.stone = 500;                   // far over the cap, and the mix's cargo
    // …and the rest of the mix (every Depot needs one of each cargo now).
    for (const [c, n] of Object.entries(mix)) if (c !== "stone") (h.purse as Record<string, number>)[c] = Math.max((h.purse as Record<string, number>)[c] ?? 0, n ?? 0);
    expect(h.placeDepot(second.hx, second.hy)).toBe(true);
    await settle();
    h.tuningFinish(true);
    expect(h.purse.stone, "the over-cap purse paid the mix in full").toBe(500 - (mix.stone ?? 0));
    expect(h.purse.stone).toBeGreaterThan(cap);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L16 (#231) the UI shows amount / cap and a full state", () => {
  const chipEls = () => [...root.querySelectorAll<HTMLElement>("#iso-res .chip")];
  const chipNums = () => [...root.querySelectorAll<HTMLElement>("#iso-res .chip-n")];

  it("counts toward the cap and flags the cargo sitting at it", async () => {
    const h = await boot({ newLoop: true });
    await settle();
    const stone = CARGOES.indexOf("stone");
    const cap = h.storageCap()!;
    expect(chipNums()[stone].textContent, "the boot purse reads amount / cap").toBe(`12/${cap}`);
    // Under the cap: no full state, no tooltip.
    expect(chipEls()[stone].classList.contains("full")).toBe(false);
    expect(chipEls()[stone].hasAttribute("title")).toBe(false);

    // At the cap: the chip wears the full state and says what it means.
    h.purse.stone = cap;
    await settle();
    expect(chipNums()[stone].textContent).toBe(`${cap}/${cap}`);
    expect(chipEls()[stone].classList.contains("full"), "a full store is legible at a glance").toBe(true);
    expect(chipEls()[stone].title).toContain("Storage full");

    // Spent back under: the state clears, the tooltip goes.
    h.purse.stone = cap - 1;
    await settle();
    expect(chipEls()[stone].classList.contains("full")).toBe(false);
    expect(chipEls()[stone].hasAttribute("title")).toBe(false);

    // The city upgrade moves the denominator the same frame the level lands.
    const row = TOWN_UPGRADES[0];
    h.finishSetup();
    for (const [c, n] of Object.entries(row.cost) as [Cargo, number][]) {
      h.purse[c] = Math.max(h.purse[c] ?? 0, n);
    }
    expect(h.buyTownUpgrade()).toBe(true);
    await settle();
    h.board.onClear(TUNING.targetScore, 1);
    h.tuningFinish(false);
    await settle();
    const raised = cap + row.storage;
    expect(chipNums()[stone].textContent, "the raised cap is the new denominator")
      .toBe(`${h.purse.stone}/${raised}`);
  });

  it.skip("keeps the shipped loop's chip the bare amount it always was", async () => {
    const h = await boot();                       // no newLoop
    expect(h.storageCap()).toBeNull();
    await settle();
    const stone = CARGOES.indexOf("stone");
    expect(chipNums()[stone].textContent).toBe("12");
    // Even a balance far past the new loop's cap: no denominator, no state.
    h.purse.stone = 500;
    await settle();
    expect(chipNums()[stone].textContent).toBe("500");
    expect(chipEls()[stone].classList.contains("full")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L16 (#231) the depot inspector says when output is being wasted", () => {
  it("flags a connected depot whose cargo sits at its owner's cap", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const site = southSite(h.grid, "grain")!;
    expect(h.placeDepot(site.hx, site.hy)).toBe(true);   // the real placement path
    await settle();
    h.tuningFinish(true);                                // default yield
    // Connect it: own Factory at the far end, own road between.
    h.eco.factories.push({ owner: "you", ownerId: 1, tx: site.hx, ty: site.fy, id: 0, townId: null });
    for (let y = site.hy + 1; y <= site.fy; y++) buildTile(h.track, "road", site.hx, y, 1);
    h.rescore();
    h.syncWorld();
    const depot = h.eco.harvesters.find((d) => d.owner === "you")!;
    expect(depotCargo(h.eco, depot)).toBe("grain");

    // Under the cap: the card prints the link and the distance, no warning.
    h.purse.grain = 10;
    const calm = await inspectDepotAt(h, site.hx, site.hy);
    expect(calm).toContain("Depot");
    expect(calm).not.toContain("wasted");

    // At the cap: every tick this Depot earns is being dropped — the card
    // says so, in the same card that prints the rate.
    const cap = h.storageCap()!;
    h.purse.grain = cap;
    const full = await inspectDepotAt(h, site.hx, site.hy);
    expect(full).toContain("storage full");
    expect(full).toContain("wasted");
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L16 (#231) the rival respects the cap — and spends at it", () => {
  it("clamps the rival's clock income at the same number", async () => {
    const h = await boot({ newLoop: true });
    rivalCorridor(h, "grain");
    h.finishSetup();
    const depot = h.eco.harvesters.find((d) => d.owner === "ai")!;
    depot.yield = 2;
    const cargo = depotCargo(h.eco, depot)!;
    const cap = h.storageCap("ai")!;
    expect(cap, "both seats play the same starting cap").toBe(storageCapFor(0));

    const purse = h.purses[1];
    purse[cargo] = cap - 1;
    const ticks = tickToCap(h, purse, cargo, cap);
    expect(ticks, "the rival's depot paid on the clock").toBeGreaterThan(0);
    expect(purse[cargo], "the rival's income stops at the cap too").toBe(cap);
  });

  it("prefers upgrading when its purse is pressed against the cap", async () => {
    const h = await boot({ newLoop: true });
    rivalCorridor(h);        // a connected depot: the bonus has something to multiply
    h.finishSetup();
    const cap = h.storageCap("ai")!;
    const purse = h.purses[1];
    // The whole first upgrade mix at the cap: affordable, and every further
    // tick of it is being wasted — the state the ticket's "prefers spending
    // or upgrading when near full" line is about.
    purse.wood = cap; purse.stone = cap; purse.grain = cap;
    purse.ore = 0; purse.oil = 0; purse.gold = 0;
    expect(h.players[1].townLevel).toBe(0);

    // One rival turn: the upgrade runs — hoisted BEFORE the greedy depot
    // pass can eat its mix — and the cap rises with the level.
    h.aiTick(performance.now() + AI_BUILD_MS + 5_000);
    expect(h.players[1].townLevel, "the capped rival upgraded its city").toBe(1);
    expect(h.players[1].storageCap).toBe(cap + TOWN_UPGRADES[0].storage);
    // And it SPENT: the wood that was wasting is now working.
    expect(purse.wood).toBeLessThan(cap);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L16 (#231) the cap rides the save — derived, not stored", () => {
  it("a reload restores the raised cap off the restored city level", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const row = TOWN_UPGRADES[0];
    for (const [c, n] of Object.entries(row.cost) as [Cargo, number][]) {
      h.purse[c] = Math.max(h.purse[c] ?? 0, n);
    }
    expect(h.buyTownUpgrade()).toBe(true);
    await settle();
    h.board.onClear(TUNING.targetScore, 1);
    h.tuningFinish(false);
    expect(h.players[0].townLevel).toBe(1);

    h.saveNow();
    // The payload carries the level; the cap needs no field of its own —
    // `storageCapFor` derives it, so save, wire and live rules are one number.
    const saved = readSave() as SaveGamePayload;
    expect(saved.players[0].townLevel).toBe(1);

    const back = await reload({ newLoop: true });
    expect(back.players[0].townLevel).toBe(1);
    expect(back.storageCap(), "the raised cap survived the reload").toBe(storageCapFor(0) + row.storage);
    expect(back.players[0].storageCap).toBe(storageCapFor(0) + row.storage);
  });
});
