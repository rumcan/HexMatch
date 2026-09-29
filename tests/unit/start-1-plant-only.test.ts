// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// START-1 (#604) — a real match starts with just the Plant: no forced Depot.
//
// The owner (2026-09-28): only a lesson (a tutorial section or the Starter
// Island) walks the player through placing a Depot before play starts. A
// real match goes to `play` the moment the opening Factory stands, and the
// first Depot is the player's first CHOICE of the match — a normal build,
// not a blocking setup phase. With zero Depots on the board the legibility
// surfaces must keep telling the truth:
//
//   • the objective line points at "build your first Depot" (GOAL-1's rule 2);
//   • the contracts panel holds its offers until the FIRST Depot stands
//     (delivery work needs something that carries);
//   • the chip-bar income readouts stay quiet — zero rows, no zeros printed;
//   • old saves that parked a real match inside the forced-Depot step resume
//     in `play`; a Starter Island save keeps its coached step.
//
// The unit harness boots the real module (`startIsoGame`), exactly as the L4
// and L1f files do, and reads the game's own `window.__iso` hook.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { southLotFree } from "./helpers/depot-lot";
import { seedWithFeature } from "./helpers/map-feature";
import { WATER, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/iso/config";
import { planFactoryPlacement } from "../../src/iso/placement";
import { createTrack, seedTownRoads, seedPublicRoads } from "../../src/iso/track";
import { SAVE_KEY } from "../../src/iso/savegame-runtime";
import { incomeRates } from "../../src/iso/readouts";
import { HARVEST_MS } from "../../src/iso/loop";
import { setRng, mulberry32 } from "../../src/game/config";

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

/** The slice of `window.__iso` this file reads. */
interface Start1Hook {
  readonly newLoop: boolean;
  phase: string;
  tool: string;
  grid: Grid;
  eco: import("../../src/iso/economy").EconomyState;
  freeDepots: number;
  setTool: (t: string) => void;
  placeFactory: (tx: number, ty: number) => boolean;
  placeDepot: (tx: number, ty: number) => boolean;
  placementPlan: (kind: "factory" | "depot", tx: number, ty: number) => { valid: boolean };
  finishSetup: () => void;
  saveNow: () => void;
  objective: { key: string | null; text: string | null; target: { tx: number; ty: number } | null; tool: string | null };
  incomeRates: Record<string, number>;
}

const hook = () => (window as unknown as { __iso: Start1Hook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas();
  stubImage();
  window.history.replaceState(null, "", "/");
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

// ── world fixtures ────────────────────────────────────────────────────────

/**
 * A legal opening Factory site by the game's OWN rule (`planFactoryPlacement`,
 * the same call the click runs) — footprints differ by map (F4 shapes), so no
 * hand-rolled 2×2 guess here. The grid variant seeds the offline acceptance
 * check with the same town-road plumbing the boot stamps first.
 */
function findFactorySpotPlan(grid: Grid): [number, number] | null {
  const track = createTrack(grid);
  seedTownRoads(track, grid);
  seedPublicRoads(track, grid);
  for (let y = 6; y < MAP_H - 6; y++) {
    for (let x = 6; x < MAP_W - 6; x++) {
      if (planFactoryPlacement(grid, x, y, { track, requireTown: true, rot: 0 }).valid) return [x, y];
    }
  }
  return null;
}

/** The live twin post-boot: `__iso.placementPlan("factory", …)`, real world included. */
function findFactorySpotLive(h: Start1Hook): [number, number] | null {
  for (let y = 6; y < MAP_H - 6; y++) {
    for (let x = 6; x < MAP_W - 6; x++) {
      if (h.placementPlan("factory", x, y)?.valid) return [x, y];
    }
  }
  return null;
}

/** A Depot site with a clear straight corridor south of an industry (L4's shape). */
function depotSite(grid: Grid): { hx: number; hy: number } | null {
  for (const ind of grid.industries) {
    for (let x = ind.tx; x < ind.tx + ind.w; x++) {
      const hx = x, hy = ind.ty + ind.h + 1, fy = hy + 6;
      if (hy < 0 || fy >= MAP_H || hx < 0 || hx >= MAP_W) continue;
      let ok = true;
      for (let y = hy; y <= fy; y++) {
        const i = y * MAP_W + hx;
        if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) { ok = false; break; }
      }
      if (ok && southLotFree(grid, hx, hy)) return { hx, hy };
    }
  }
  return null;
}

/**
 * One seeded normal boot: a map that has BOTH an opening Factory site and an
 * opening Depot corridor, so no assertion ever retries on a friendlier seed.
 * A boot with an older save in storage is the Continue path instead (the
 * save's own seed rules, exactly like the l8 harness).
 */
let start1Seed: number | undefined;
async function boot(opts: Record<string, unknown> = {}) {
  start1Seed ??= seedWithFeature("opening Factory + Depot corridor", (grid) =>
    !!findFactorySpotPlan(grid) && !!depotSite(grid));
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, {
    ...opts,
    ...(Object.keys(opts).length === 0 && !localStorage.getItem(SAVE_KEY) ? { seed: start1Seed } : {}),
  });
  await settle();
  return hook();
}

/** The contracts panel (L8/CONTRACT-1) as the chrome renders it. */
const questsPanel = () => root.querySelector("#iso-quests") as HTMLElement | null;
const contractsShown = () => !!questsPanel() && !questsPanel()!.classList.contains("hidden");
const contractItems = () => root.querySelectorAll("#iso-quests li[data-quest]").length;

// ══════════════════════════════════════════════════════════════════════════

describe("START-1 a real match opens on the Plant alone", () => {
  it("goes straight to play after the Factory — no forced Depot step", async () => {
    const h = await boot();
    expect(h.newLoop).toBe(true);
    expect(h.phase).toBe("setup-factory");
    const spot = findFactorySpotLive(h)!;
    expect(spot, "the boot seed has an opening Factory site").not.toBeNull();
    expect(h.eco.harvesters).toHaveLength(0);

    expect(h.placeFactory(spot[0], spot[1])).toBe(true);
    await settle();

    // The whole ticket in one line: the match is running on the Plant alone.
    expect(h.phase, "a real match has no setup-harvester phase").toBe("play");
    expect(h.eco.harvesters).toHaveLength(0);
    expect(h.eco.factories.some((f) => f.owner === "you")).toBe(true);
  });

  it("treats the Depot tool as a normal tool from the Plant on — nothing locks", async () => {
    const h = await boot();
    const spot = findFactorySpotLive(h)!;
    expect(h.placeFactory(spot[0], spot[1])).toBe(true);
    await settle();
    // On the retired setup these arms were refused ("place your free Depot
    // first"); in a real match every build tool answers from the Plant on.
    h.setTool("dirt");
    expect(h.tool, "a road drag is legal before the first Depot").toBe("dirt");
    h.setTool("harvester");
    expect(h.tool).toBe("harvester");
  });

  it("a tutorial section still owes the setup Depot", async () => {
    const h = await boot({ tutorialSection: "depots" });
    expect(h.phase, "the lesson keeps its coached Depot step").toBe("setup-harvester");
    expect(h.eco.factories.filter((f) => f.owner === "you")).toHaveLength(1);
    expect(h.eco.harvesters).toHaveLength(0);
  });

  it("the Starter Island still owes the setup Depot", async () => {
    const h = await boot({ starterIsland: true });
    expect(h.phase).toBe("setup-factory");
    const spot = findFactorySpotLive(h)!;
    expect(spot, "the island has room for its opening Factory").not.toBeNull();
    expect(h.placeFactory(spot[0], spot[1])).toBe(true);
    await settle();
    expect(h.phase, "the guided island still walks the Depot before play").toBe("setup-harvester");
    // Paying the coached step is what starts a lesson's match.
    const site = depotSite(h.grid);
    expect(site, "the island has a legal Depot corridor").not.toBeNull();
    expect(h.placeDepot(site!.hx, site!.hy - 1)).toBe(true);
    h.finishSetup();   // the click's phase flip; finishSetup is its hook twin
    await settle();
    expect(h.phase).toBe("play");
  });
});

describe("START-1 the readouts keep telling the truth with zero Depots", () => {
  it("the objective line says to build your first Depot — an objective, not a block", async () => {
    const h = await boot();
    const spot = findFactorySpotLive(h)!;
    expect(h.placeFactory(spot[0], spot[1])).toBe(true);
    await settle();
    // GOAL-1's rule 2: zero Depots in a running match names the next build,
    // and arms the Depot tool on click like any objective in the list.
    expect(h.objective.key).toBe("place-depot");
    expect(h.objective.text).toMatch(/Build your first Depot/);
    expect(h.objective.tool).toBe("harvester");
    expect(h.objective.target).not.toBeNull();
  });

  it("the contracts panel holds its offers until the first Depot stands", async () => {
    const h = await boot();
    const spot = findFactorySpotLive(h)!;
    expect(h.placeFactory(spot[0], spot[1])).toBe(true);
    await settle();
    // In play, zero Depots: delivery work with nothing to carry it with is
    // noise — the panel stands down instead of dealing contracts early.
    expect(h.phase).toBe("play");
    expect(contractsShown(), "no contract offers before the first Depot").toBe(false);

    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy - 1)).toBe(true);
    await settle();
    expect(contractsShown(), "offers deal once there is a Depot to deliver with").toBe(true);
    expect(contractItems()).toBeGreaterThan(0);
  });

  it("the chip-bar income readouts stay quiet — zero Depots, zero rows, no zeros printed", async () => {
    const h = await boot();
    const spot = findFactorySpotLive(h)!;
    expect(h.placeFactory(spot[0], spot[1])).toBe(true);
    await settle();
    expect(h.incomeRates, "zero Depots paint no rates at all").toEqual({});

    // A Depot with no road yet is not ticking either: still quiet.
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy - 1)).toBe(true);
    await settle();
    expect(h.incomeRates, "an unroaded Depot is not income").toEqual({});

    // …and the pure rule the paint loops over agrees: an empty row set is a
    // non-printing readout, by construction.
    expect(incomeRates([], HARVEST_MS)).toEqual({});
  });
});

describe("START-1 saves stay backward-compatible", () => {
  it("an old save parked in the forced-Depot step of a real match resumes in play", async () => {
    const h = await boot();
    const spot = findFactorySpotLive(h)!;
    expect(h.placeFactory(spot[0], spot[1])).toBe(true);
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy - 1)).toBe(true);
    h.saveNow();
    // Forge the pre-START-1 state: a real-match save caught inside the
    // forced-Depot step.
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY)!) as { phase: string };
    raw.phase = "setup-harvester";
    localStorage.setItem(SAVE_KEY, JSON.stringify(raw));

    dispose?.();
    dispose = undefined;
    const back = await boot();
    expect(back.phase, "the Depot step is no longer a place a save can park").toBe("play");
    expect(back.eco.harvesters.length, "the Depot itself came back").toBe(1);
  });

  it("a Starter Island save keeps its coached setup Depot step", async () => {
    const h = await boot({ starterIsland: true });
    const spot = findFactorySpotLive(h)!;
    expect(h.placeFactory(spot[0], spot[1])).toBe(true);
    await settle();
    expect(h.phase).toBe("setup-harvester");
    h.saveNow();

    dispose?.();
    dispose = undefined;
    const back = await boot();
    expect(back.phase, "a lesson's save resumes its coached step").toBe("setup-harvester");
    expect(back.eco.factories.filter((f) => f.owner === "you")).toHaveLength(1);
  });
});
