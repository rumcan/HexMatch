// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// TOWN-2 (#470) — towns grow VISIBLY: the tier-up moment, construction states,
// growing districts.
//
// The ticket's acceptance boxes, and where each is checked:
//
//   1. "The tier-up sequence plays once per tier, is skippable by any click,
//       and respects reduced motion."
//        → the controller tests below (fake deps, exact numbers for `now`) for
//          skip / reduced motion / supersede, and the booted-game tests for the
//          real click listener and the real "once per tier" door
//          (`setTownLevel` returns false when the tier did not move).
//   2. "New district buildings pass through a scaffold state."
//        → `lotLookAt` (scaffold → crane → finished, and the placeholder ramp
//          while the lead's art is missing) plus the booted game, where the
//          grown district's draw items carry the construction look and the
//          town's older blocks do not.
//   3. "Unit test: the draw items during and after construction."
//        → the booted-game block reads `__iso.townDrawItems` mid-build and
//          after `__iso.finishTownGrowth()`: same tiles, same sprites, no
//          alpha left, nothing lost while the scaffolds were up.
//
// The pure half runs with no DOM at all; the wiring half boots the real game
// exactly the way iso-417-grown-districts does (jsdom, `?seed=42&rings=1`,
// `newLoop: true`) and drives `__iso.setTownLevel` — the same door a confirmed
// city upgrade uses (`growCity` → `setTownLevel` + `growTownArt`).
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setRng, mulberry32 } from "../../src/game/config";
import { SAVE_KEY } from "../../src/iso/savegame-runtime";
import { idx, type Grid } from "../../src/iso/grid";
import {
  ART_NEEDED, BUILD_MS, CONSTRUCTION_STAGES, FLAG_MS, FLOURISH_BUNTING, FLOURISH_FLAG,
  FLOURISH_FLOAT, FLOURISH_MS, STAGGER_BANDS, STAGGER_MS, STAGE_MS,
  constructionSprite, createGrowthMoment, flourishLookAt, flourishStageAt, growthFeedLine,
  growthLots, growthMomentMs, lotDoneAt, lotLookAt, lotStageAt,
  type GrowthMomentDeps, type GrowthTown,
} from "../../src/iso/town-growth";

vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

// ────────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────────
const HALL = { tx: 40, ty: 40 };
const lot = (over: Partial<{ tx: number; ty: number; sprite: string; w: number; h: number; band: number }> = {}) => ({
  tx: 44, ty: 40, sprite: "town_flats", w: 1, h: 1, band: 0, ...over,
});
/** An atlas that has every sprite the lead is being asked for. */
const allArt = (name: string): boolean => (ART_NEEDED as readonly string[]).includes(name);
/** A checkout with none of it (today's main): every look must fall back. */
const noArt = (): boolean => false;

/** A recorded controller: what the game would have been asked to do. */
function recorder(over: Partial<GrowthMomentDeps> = {}) {
  const calls = {
    apply: 0, camera: [] as [number, number][], feed: [] as string[],
    sound: [] as number[], float: [] as [string, number, number][],
    skips: 0,
  };
  let skipHandler: (() => void) | null = null;
  const deps: GrowthMomentDeps = {
    hasArt: noArt,
    apply: () => { calls.apply++; },
    camera: (tx, ty) => { calls.camera.push([tx, ty]); },
    feed: (text) => { calls.feed.push(text); },
    sound: (tier) => { calls.sound.push(tier); },
    float: (text, tx, ty) => { calls.float.push([text, tx, ty]); },
    reducedMotion: () => false,
    onSkip: (handler) => {
      calls.skips++;
      skipHandler = handler;
      return () => { skipHandler = null; };
    },
    ...over,
  };
  return {
    deps, calls,
    moment: createGrowthMoment(deps),
    /** What "any click" does in the game. */
    click: () => skipHandler?.(),
    armed: () => skipHandler !== null,
  };
}

const town = (over: Partial<GrowthTown> = {}): GrowthTown => ({
  id: 0, tx: HALL.tx, ty: HALL.ty, tier: 2, label: "city", ...over,
});

/** Three lots: one beside the old town, one mid-ring, one at the far edge. */
const sampleItems = () => [
  { tx: 44, ty: 40, sprite: "town_flats", w: 1, h: 1 },
  { tx: 47, ty: 43, sprite: "town_flats_2", w: 2, h: 2 },
  { tx: 50, ty: 50, sprite: "town_offices_tall", w: 1, h: 1 },
];

// ────────────────────────────────────────────────────────────────────────────
// 1. the pure construction rules
// ────────────────────────────────────────────────────────────────────────────
describe("#470 a lot's construction look", () => {
  it("walks scaffold → crane → finished over the ticket's 2–3 s", () => {
    const l = lot();
    const first = lotLookAt(l, 0, allArt);
    expect(first).toMatchObject({ sprite: "scaffold_1x1", stage: 0, art: true, alpha: 1 });
    const second = lotLookAt(l, STAGE_MS, allArt);
    expect(second).toMatchObject({ sprite: "crane_1x1", stage: 1, art: true });
    // …and then it is finished: no look at all, the town draws its own art.
    expect(lotLookAt(l, BUILD_MS, allArt)).toBeNull();
    expect(lotLookAt(l, BUILD_MS * 4, allArt)).toBeNull();
    // The whole build sits inside the ticket's window.
    expect(BUILD_MS).toBeGreaterThanOrEqual(2000);
    expect(BUILD_MS + (STAGGER_BANDS - 1) * STAGGER_MS).toBeLessThanOrEqual(3000);
  });

  it("asks for the prop at the lot's own footprint", () => {
    expect(constructionSprite("scaffold", 2, 2)).toBe("scaffold_2x2");
    expect(lotLookAt(lot({ w: 2, h: 2 }), 0, allArt)?.sprite).toBe("scaffold_2x2");
    expect(lotLookAt(lot({ w: 2, h: 2 }), STAGE_MS, allArt)?.sprite).toBe("crane_2x2");
    expect(lotLookAt(lot({ w: 1, h: 2 }), 0, allArt)?.sprite).toBe("scaffold_1x2");
  });

  it("falls back to the finished building at a rising alpha while the art is missing", () => {
    const l = lot();
    // An unknown sprite draws NOTHING (depth.ts `place` returns null), so the
    // placeholder has to be the real building, faded — never a hole.
    expect(lotLookAt(l, 0, noArt)).toMatchObject({ sprite: l.sprite, alpha: 0.25, art: false });
    const mid = lotLookAt(l, STAGE_MS, noArt);
    expect(mid).toMatchObject({ sprite: l.sprite, art: false });
    expect(mid!.alpha).toBeGreaterThan(0.25);
    expect(mid!.alpha).toBeLessThan(1);
    expect(lotLookAt(l, BUILD_MS, noArt)).toBeNull();
  });

  it("keeps the scaffold when only the crane is missing, and vice versa", () => {
    const scaffoldOnly = (n: string) => n.startsWith("scaffold_");
    expect(lotLookAt(lot(), STAGE_MS, scaffoldOnly)?.sprite).toBe("scaffold_1x1");
    const craneOnly = (n: string) => n.startsWith("crane_");
    // No scaffold at all: the crane still covers the second half, and the first
    // half falls back rather than drawing nothing.
    expect(lotLookAt(lot(), 0, craneOnly)).toMatchObject({ art: false, alpha: 0.25 });
    expect(lotLookAt(lot(), STAGE_MS, craneOnly)?.sprite).toBe("crane_1x1");
  });

  it("stays on the scaffold until its own wave starts — a lot is never a hole", () => {
    const outer = lot({ band: STAGGER_BANDS - 1 });
    expect(lotStageAt(outer, 0)).toBe(0);
    expect(lotLookAt(outer, 0, allArt)?.sprite).toBe("scaffold_1x1");
    // The outer wave finishes STAGGER_MS per band later than the inner one.
    expect(lotDoneAt(outer)).toBe(BUILD_MS + (STAGGER_BANDS - 1) * STAGGER_MS);
    expect(lotLookAt(outer, BUILD_MS, allArt)).not.toBeNull();
    expect(lotLookAt(outer, lotDoneAt(outer), allArt)).toBeNull();
  });

  it("bands the new lots outward from the hall, deterministically", () => {
    const lots = growthLots(sampleItems(), HALL);
    expect(lots.map((l) => l.band)).toEqual([0, 1, STAGGER_BANDS - 1]);
    // Same input, same waves — a re-sync (or another client) never reshuffles.
    expect(growthLots(sampleItems(), HALL)).toEqual(lots);
    // One band's worth of lots all build together.
    expect(growthLots([sampleItems()[0]], HALL).map((l) => l.band)).toEqual([0]);
    expect(growthLots([], HALL)).toEqual([]);
  });

  it("runs the whole moment long enough for the last lot and the flourish", () => {
    const lots = growthLots(sampleItems(), HALL);
    const ms = growthMomentMs(lots);
    expect(ms).toBeGreaterThanOrEqual(FLOURISH_MS);
    expect(ms).toBeGreaterThanOrEqual(Math.max(...lots.map(lotDoneAt)));
    expect(growthMomentMs([])).toBe(FLOURISH_MS);
    expect(CONSTRUCTION_STAGES).toBeGreaterThanOrEqual(2);
  });
});

describe("#470 the town hall flourish", () => {
  it("raises the flag, then hangs the bunting, then takes it down", () => {
    expect(flourishStageAt(0)).toBe(0);
    expect(flourishLookAt(HALL, 0, allArt)).toMatchObject({ sprite: FLOURISH_FLAG, stage: 0, ...HALL });
    expect(flourishStageAt(FLAG_MS)).toBe(1);
    expect(flourishLookAt(HALL, FLAG_MS, allArt)).toMatchObject({ sprite: FLOURISH_BUNTING, stage: 1 });
    expect(flourishStageAt(FLOURISH_MS)).toBe(2);
    expect(flourishLookAt(HALL, FLOURISH_MS, allArt)).toBeNull();
  });

  it("draws nothing while its art is missing — the game floats the beat instead", () => {
    expect(flourishLookAt(HALL, 0, noArt)).toBeNull();
    expect(flourishLookAt(HALL, FLAG_MS, noArt)).toBeNull();
    expect(FLOURISH_FLOAT.length).toBeGreaterThan(0);
  });
});

describe("#470 the Feed line", () => {
  it("names the tier and the construction", () => {
    const withLots = growthFeedLine("city", 12);
    expect(withLots).toMatch(/city/);
    expect(withLots).toMatch(/construction/i);
    // A first upgrade adds no district: the line still says something true.
    expect(growthFeedLine("town", 0)).toMatch(/town hall/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. the controller — the sequence, the click, reduced motion, once per tier
// ────────────────────────────────────────────────────────────────────────────
describe("#470 the tier-up moment controller", () => {
  it("starts on a tier-up: camera, sound, Feed line, and the first look painted", () => {
    const r = recorder({ hasArt: allArt });
    expect(r.moment.start(town(), sampleItems(), 1000)).toBe(true);
    expect(r.calls.camera).toEqual([[HALL.tx, HALL.ty]]);
    expect(r.calls.sound).toEqual([2]);
    expect(r.calls.feed.length).toBe(1);
    expect(r.moment.state).toMatchObject({ active: true, townId: 0, tier: 2, lots: 3, stage: 0 });
    // The scaffolds go up on the same beat as the growth (no finished frame).
    expect(r.calls.apply).toBe(1);
    expect(r.moment.lookFor(0, 44, 40)?.sprite).toBe("scaffold_1x1");
    // "Skippable by any click" is armed only while the moment runs.
    expect(r.armed()).toBe(true);
    expect(r.calls.skips).toBe(1);
  });

  it("floats the flourish over the hall while the flag art is missing", () => {
    const r = recorder({ hasArt: noArt });
    r.moment.start(town(), sampleItems(), 0);
    expect(r.calls.float).toEqual([[FLOURISH_FLOAT, HALL.tx, HALL.ty - 1]]);
    const withArt = recorder({ hasArt: allArt });
    withArt.moment.start(town(), sampleItems(), 0);
    expect(withArt.calls.float).toEqual([]);
    expect(withArt.moment.flourish()?.sprite).toBe(FLOURISH_FLAG);
  });

  it("repaints on a look change only — never per frame", () => {
    const r = recorder({ hasArt: allArt });
    const total = growthMomentMs(growthLots(sampleItems(), HALL));
    r.moment.start(town(), sampleItems(), 0);
    expect(r.calls.apply).toBe(1);
    // Frames inside one look cost nothing (the first change is whichever comes
    // first: the crane, or the flag giving way to the bunting).
    for (let t = 8; t < Math.min(STAGE_MS, FLAG_MS) - 8; t += 16) r.moment.tick(t);
    expect(r.calls.apply).toBe(1);
    // Crossing into the crane repaints, and the near lot wears it.
    r.moment.tick(STAGE_MS + 1);
    expect(r.calls.apply).toBeGreaterThan(1);
    expect(r.moment.lookFor(0, 44, 40)?.sprite).toBe("crane_1x1");
    // A quiet window — every wave on the same look, the flourish unchanged —
    // is free again.
    const quietAt = STAGE_MS + (STAGGER_BANDS - 1) * STAGGER_MS + 8;
    r.moment.tick(quietAt);
    const quiet = r.calls.apply;
    for (let t = quietAt + 16; t < BUILD_MS - 8; t += 16) r.moment.tick(t);
    expect(r.calls.apply, "frames with no look change repaint nothing").toBe(quiet);
    // Running out lands the finished district by itself, with one last repaint.
    r.moment.tick(total + 1);
    expect(r.moment.active).toBe(false);
    expect(r.moment.lookFor(0, 44, 40)).toBeNull();
    expect(r.calls.apply).toBe(quiet + 1);
    expect(r.armed(), "the click listener goes when the moment does").toBe(false);
    expect(r.moment.state).toMatchObject({ active: false, skipped: false, stage: CONSTRUCTION_STAGES });
    // Ticking a finished moment is free.
    r.moment.tick(999_999);
    expect(r.calls.apply).toBe(quiet + 1);

    // The whole sequence at 60 fps: a couple of hundred frames, a handful of
    // world syncs (#417's "no frame-rate drop when a town grows").
    const r2 = recorder({ hasArt: allArt });
    r2.moment.start(town(), sampleItems(), 0);
    let frames = 0;
    for (let t = 16; t <= total + 16; t += 16) { r2.moment.tick(t); frames++; }
    expect(frames).toBeGreaterThan(150);
    expect(r2.calls.apply).toBeLessThan(15);
    expect(r2.moment.active).toBe(false);
  });

  it("builds the waves outward: the far lot is still going up when the near one is done", () => {
    const r = recorder({ hasArt: allArt });
    r.moment.start(town(), sampleItems(), 0);
    r.moment.tick(BUILD_MS + 1);
    expect(r.moment.lookFor(0, 44, 40), "the near lot is finished").toBeNull();
    expect(r.moment.lookFor(0, 50, 50), "the far lot is still building").not.toBeNull();
    r.moment.tick(BUILD_MS + (STAGGER_BANDS - 1) * STAGGER_MS + 1);
    expect(r.moment.lookFor(0, 50, 50)).toBeNull();
  });

  it("is skippable: any click lands the finished district at once", () => {
    const r = recorder({ hasArt: allArt });
    r.moment.start(town(), sampleItems(), 0);
    r.moment.tick(STAGE_MS + 1);
    expect(r.moment.lookFor(0, 44, 40)?.sprite).toBe("crane_1x1");
    r.click();
    expect(r.moment.active).toBe(false);
    expect(r.moment.lookFor(0, 44, 40)).toBeNull();
    expect(r.moment.flourish()).toBeNull();
    expect(r.moment.state).toMatchObject({ active: false, skipped: true, townId: 0, tier: 2 });
    expect(r.armed()).toBe(false);
    // A second click has nothing to skip.
    expect(r.moment.skip()).toBe(false);
  });

  it("respects reduced motion: no scaffolds, no flourish, no animation — but still the sound and the Feed", () => {
    const r = recorder({ hasArt: allArt, reducedMotion: () => true });
    expect(r.moment.start(town(), sampleItems(), 0)).toBe(false);
    expect(r.moment.active).toBe(false);
    expect(r.moment.lookFor(0, 44, 40)).toBeNull();
    expect(r.moment.flourish()).toBeNull();
    expect(r.moment.state).toMatchObject({ active: false, reduced: true, skipped: false, lots: 3 });
    expect(r.calls.sound).toEqual([2]);
    expect(r.calls.feed.length).toBe(1);
    // `flyCameraTo` snaps under reduced motion, so the ask still goes out.
    expect(r.calls.camera.length).toBe(1);
    // Nothing animates: a tick changes nothing.
    r.moment.tick(5000);
    expect(r.moment.active).toBe(false);
  });

  it("plays once: a growth inside a growth supersedes the running moment", () => {
    const r = recorder({ hasArt: allArt });
    r.moment.start(town(), sampleItems(), 0);
    expect(r.moment.state.lots).toBe(3);
    // The next tier, one second later: the first district lands at once and the
    // new one takes over the sequence.
    r.moment.start(town({ tier: 3, label: "metropolis" }), [
      { tx: 60, ty: 60, sprite: "town_offices_tall", w: 1, h: 1 },
    ], 1000);
    expect(r.moment.state).toMatchObject({ active: true, tier: 3, lots: 1 });
    expect(r.moment.lookFor(0, 44, 40), "the old lots are finished").toBeNull();
    expect(r.moment.lookFor(0, 60, 60), "the new lot is under construction").not.toBeNull();
    expect(r.calls.skips, "one listener at a time").toBe(2);
    expect(r.armed()).toBe(true);
  });

  it("only ever answers for the town that is building", () => {
    const r = recorder({ hasArt: allArt });
    r.moment.start(town(), sampleItems(), 0);
    expect(r.moment.lookFor(1, 44, 40)).toBeNull();
    expect(r.moment.lookFor(0, 10, 10)).toBeNull();
    r.moment.dispose();
    expect(r.moment.active).toBe(false);
    expect(r.armed(), "dispose disarms the click listener").toBe(false);
  });

  it("a tier-up with no new district is still a moment (camera, sound, Feed, flourish)", () => {
    const r = recorder({ hasArt: allArt });
    expect(r.moment.start(town({ tier: 1, label: "town" }), [], 0)).toBe(true);
    expect(r.moment.state).toMatchObject({ active: true, lots: 0, tier: 1 });
    expect(r.moment.flourish()?.sprite).toBe(FLOURISH_FLAG);
    expect(r.calls.feed[0]).toMatch(/town hall/i);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. the wiring — the real game, the real draw list
// ────────────────────────────────────────────────────────────────────────────
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

/** One town draw item as `__iso.townDrawItems` reports it (#470 adds `alpha`). */
interface TownItem { sprite: string; tx: number; ty: number; townId: number; alpha?: number }

/** The tier-up moment as `__iso.townGrowth` reports it. */
interface GrowthState {
  active: boolean; townId: number | null; tier: number; label: string; elapsed: number;
  durationMs: number; lots: number; stage: number; flourishStage: number;
  art: boolean; skipped: boolean; reduced: boolean;
}

interface Hook470 {
  readonly newLoop: boolean;
  readonly towns: { id: number; level: number; label: string }[];
  setTownLevel: (townId: number, level: number) => boolean;
  readonly townDrawItems: TownItem[];
  readonly townGrowth: GrowthState;
  finishTownGrowth: () => boolean;
  readonly grid: Grid;
}

const hook = () => (window as unknown as { __iso: Hook470 }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

/** `prefers-reduced-motion` as the OS would report it. */
function stubMotion(reduce: boolean) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => { window.matchMedia = original; };
}

beforeEach(() => {
  stubCanvas();
  stubImage();
  window.history.replaceState(null, "", "/?seed=42&rings=1");
  localStorage.removeItem(SAVE_KEY);
  localStorage.setItem("hexmatch:rival-skill", "normal");
  localStorage.setItem("hexmatch:tutorial", "never");
  setRng(mulberry32(42));
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

async function boot(): Promise<Hook470> {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, { newLoop: true });
  await settle();
  return hook();
}

/** The town's draw items whose origin is not one of its own house tiles. */
function grownItemsOf(h: Hook470, townId: number): TownItem[] {
  const t = h.grid.towns[townId];
  const houses = new Set(t.houses.map(([hx, hy]) => idx(hx, hy)));
  return h.townDrawItems.filter((i) => i.townId === townId && !houses.has(idx(i.tx, i.ty)));
}

/** A construction look: the lead's art, or the finished sprite faded down. */
const underConstruction = (i: TownItem): boolean =>
  i.sprite.startsWith("scaffold_") || i.sprite.startsWith("crane_")
  || (typeof i.alpha === "number" && i.alpha < 1);

describe("#470 in play — the draw items during and after construction", () => {
  it("a city upgrade puts the new district under construction, and only the new district", async () => {
    const h = await boot();
    expect(h.newLoop).toBe(true);
    expect(h.towns[0].level).toBe(0);
    expect(h.townGrowth.active, "nothing is building before an upgrade").toBe(false);
    const before = h.townDrawItems.filter((i) => i.townId === 0).map((i) => `${i.tx},${i.ty}`).sort();

    expect(h.setTownLevel(0, 2)).toBe(true);

    // The moment is running, on this town, at this tier.
    expect(h.townGrowth).toMatchObject({ active: true, townId: 0, tier: 2, stage: 0 });
    const grown = grownItemsOf(h, 0);
    expect(grown.length, "seed 42 tier 2 grows a real district").toBeGreaterThan(100);
    expect(h.townGrowth.lots, "one lot per new draw item").toBe(grown.length);

    // (2) every new district building passes through a scaffold state…
    for (const i of grown) {
      expect(underConstruction(i), `new lot (${i.tx},${i.ty}) drew ${i.sprite} at full alpha`).toBe(true);
    }
    // …and the town that was already there is untouched by the build.
    const grownKeys = new Set(grown.map((i) => `${i.tx},${i.ty}`));
    const old = h.townDrawItems.filter((i) => i.townId === 0 && !grownKeys.has(`${i.tx},${i.ty}`));
    expect(old.length).toBeGreaterThan(0);
    for (const i of old) expect(underConstruction(i), `old block (${i.tx},${i.ty}) is under construction`).toBe(false);

    // (3) the draw items DURING construction: no tile lost, none added, and the
    // hall's flourish is not a town draw item (the bank stays clickable).
    const during = h.townDrawItems.filter((i) => i.townId === 0).map((i) => `${i.tx},${i.ty}`).sort();
    expect(during.filter((k) => !before.includes(k)).length).toBe(grown.length);
    expect(before.filter((k) => !during.includes(k))).toEqual([]);
    expect(h.townDrawItems.some((i) => i.sprite === FLOURISH_FLAG || i.sprite === FLOURISH_BUNTING)).toBe(false);
  }, 90000);

  it("after construction the district is finished: same tiles, same sprites, no alpha", async () => {
    const h = await boot();
    expect(h.setTownLevel(0, 2)).toBe(true);
    const during = grownItemsOf(h, 0);
    const duringKeys = during.map((i) => `${i.tx},${i.ty}`).sort();
    expect(during.every(underConstruction)).toBe(true);

    // What a click does — the same door `finishTownGrowth` and any pointerdown use.
    expect(h.finishTownGrowth()).toBe(true);

    expect(h.townGrowth).toMatchObject({ active: false, skipped: true, townId: 0, tier: 2 });
    const after = grownItemsOf(h, 0);
    expect(after.map((i) => `${i.tx},${i.ty}`).sort()).toEqual(duringKeys);
    for (const i of after) {
      expect(i.sprite.startsWith("scaffold_")).toBe(false);
      expect(i.sprite.startsWith("crane_")).toBe(false);
      expect(i.alpha, `(${i.tx},${i.ty}) still faded`).toBeUndefined();
    }
    // And the finished district draws the art #417 pinned: every grown tile has
    // an item, so the scaffolds never cost the town a building.
    expect(after.length).toBeGreaterThan(100);
    expect(h.finishTownGrowth(), "nothing left to skip").toBe(false);
  }, 90000);

  it("is skippable by ANY click, and plays once per tier", async () => {
    const h = await boot();
    expect(h.setTownLevel(0, 2)).toBe(true);
    expect(h.townGrowth.active).toBe(true);

    // A click anywhere — here on the document, not on the map — ends it.
    window.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(h.townGrowth).toMatchObject({ active: false, skipped: true });
    expect(grownItemsOf(h, 0).every((i) => i.alpha === undefined)).toBe(true);

    // Once per tier: asking for the same tier again moves nothing and starts
    // nothing (the growth door itself refuses).
    expect(h.setTownLevel(0, 2)).toBe(false);
    expect(h.townGrowth.active).toBe(false);

    // The next tier is a new moment.
    expect(h.setTownLevel(0, 3)).toBe(true);
    expect(h.townGrowth).toMatchObject({ active: true, tier: 3, skipped: false });
    expect(h.townGrowth.lots).toBeGreaterThan(0);
    expect(grownItemsOf(h, 0).some(underConstruction)).toBe(true);
    h.finishTownGrowth();
  }, 90000);

  it("respects reduced motion: the district lands finished, with no sequence to skip", async () => {
    const h = await boot();
    const restore = stubMotion(true);
    try {
      expect(h.setTownLevel(0, 2)).toBe(true);
      expect(h.townGrowth).toMatchObject({ active: false, reduced: true, tier: 2 });
      expect(h.townGrowth.lots, "the new district is still counted").toBeGreaterThan(100);
      const grown = grownItemsOf(h, 0);
      expect(grown.length).toBeGreaterThan(100);
      for (const i of grown) expect(underConstruction(i), `(${i.tx},${i.ty}) animated`).toBe(false);
      expect(h.finishTownGrowth()).toBe(false);
    } finally { restore(); }
  }, 90000);

  it("a first upgrade (village → town) is a moment too, with no district to build", async () => {
    const h = await boot();
    expect(h.setTownLevel(0, 1)).toBe(true);
    expect(h.townGrowth).toMatchObject({ active: true, townId: 0, tier: 1, lots: 0 });
    // The centre is the bank now, and nothing is under construction.
    const items = h.townDrawItems.filter((i) => i.townId === 0);
    expect(items.some((i) => i.sprite === "town_bank")).toBe(true);
    expect(items.every((i) => !underConstruction(i))).toBe(true);
    h.finishTownGrowth();
  }, 90000);
});
