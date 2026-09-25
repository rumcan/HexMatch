// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GRASS, WATER, idx, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { BUILD_COSTS, TRANSPORT } from "../../src/iso/config";
import {
  AXIS_X, AXIS_Y, BRIDGE_BITS, BRIDGE_COST, BRIDGE_REFUSAL_TEXT, MAX_BRIDGE_SPAN,
  RAIL_BRIDGE_COST, axisOfStep, bridgeAxesAt, bridgeCostFor, bridgeWaterAt, planBridges,
} from "../../src/iso/bridges";
import {
  DIR, DIRS, NE, NW, OPPOSITE, SE, SW, bitsAt, buildRefusal, canBuildOn, commitDrag,
  createTrack, demolishTile, hasTrack, playerNetwork, previewDrag, tIdx,
  type Purse, type Track, type TrackKind,
} from "../../src/iso/track";
import {
  RAIL_COSTS, RAIL_REFUSAL_TEXT, buildRail, createRailState, demolishRail, hasRail,
  railBitsAt, railBridgePlan, railPreview, railTileRefusal, type RailState,
} from "../../src/iso/rail";
import {
  COST_BRIDGE, IMPASSABLE, planFeasibility, planRailRoute, railStepCost, stepCost,
  validateRailDrag, type Path,
} from "../../src/iso/ai";
import type { EconomyState } from "../../src/iso/economy";
import { setRng, mulberry32 } from "../../src/game/config";

// ── the real game, booted with rivers on (the ticket's own setting) ───────
// `vi.mock` is hoisted, so the art imports resolve to strings before
// `src/iso/game` loads. Everything below the stubs runs the REAL boot.
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

function stubCanvas(): void {
  const gradient = { addColorStop: () => undefined, setTransform: () => undefined };
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "canvas") return null;
      if (prop === "imageSmoothingEnabled") return false;
      if (prop === "createLinearGradient" || prop === "createRadialGradient"
        || prop === "createConicGradient" || prop === "createPattern") return () => gradient;
      if (prop === "measureText") return () => ({ width: 0 });
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

function stubImage(): void {
  class FakeImage {
    width = 1024; height = 1024;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) { queueMicrotask(() => this.onload?.()); }
  }
  (globalThis as Record<string, unknown>).Image = FakeImage;
}

/** The slice of `window.__iso` this file drives. */
interface IsoHook {
  grid: Grid;
  track: Track;
  railState: RailState;
  finishSetup: () => void;
  dragPreview: (kind: TrackKind, ax: number, ay: number, bx: number, by: number, xFirst?: boolean) => DragPreview | null;
  dragBuild: (kind: TrackKind, ax: number, ay: number, bx: number, by: number, xFirst?: boolean) => DragPreview | null;
}

const hook = () => (window as unknown as { __iso: IsoHook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas();
  stubImage();
  // R1 (#260): rivers are a SOLO map option, asked for by URL (`?rivers=1`) or
  // by `opts.rivers`; a rivers boot reads and writes no save slot.
  window.history.replaceState(null, "", "/?seed=1337&rivers=1&loop=old");
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

async function boot(): Promise<IsoHook> {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, {});
  await settle();
  const iso = hook();
  iso.finishSetup();
  return iso;
}

/** The first 1-tile crossing the live map offers, as a drag the game accepts. */
function findCrossing(iso: IsoHook): [number, number, number, number] | null {
  const grid = iso.grid;
  const dry = (x: number, y: number) => grid.terrain[idx(x, y)] !== WATER;
  for (let y = 2; y < MAP_H - 2; y++) {
    for (let x = 2; x < MAP_W - 2; x++) {
      if (!bridgeWaterAt(grid, x, y) || !(bridgeAxesAt(grid, x, y) & AXIS_X)) continue;
      if (!dry(x - 1, y) || !dry(x + 1, y)) continue;
      if (!canBuildOn(grid, "dirt", x - 1, y) || !canBuildOn(grid, "dirt", x + 1, y)) continue;
      const pv = iso.dragPreview("dirt", x - 1, y, x + 1, y);
      if (pv && pv.bridges === 1 && pv.tiles.length === 3) return [x - 1, y, x + 1, y];
    }
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════
// R2 (#266) — BRIDGES: a road or railway drag crosses a NARROW river.
//
// The river is synthetic (a stripe of WATER with `Grid.rivers` set) so the
// geometry is exact: 1- and 2-tile spans bridge, 3 refuse, bends refuse, a
// drag may not END in the water, and neither layer may hang a junction on a
// deck. Every assertion is against the shared rule module (`bridges.ts`) and
// the two layers' own build paths (`previewDrag`/`commitDrag`, `railPreview`/
// `buildRail`), plus the rankers the rival plans with (`stepCost`,
// `railStepCost`, `planRailRoute`, `validateRailDrag`).
// ══════════════════════════════════════════════════════════════════════════

/** A map-sized grid with nothing on it: land, unoccupied, no rivers. */
function makeGrid(): Grid {
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries: [], towns: [], publicRoads: [],
    occupancy: new Int16Array(MAP_W * MAP_H).fill(-1),
    seed: 0,
  } as Grid;
}

/** Water: RIVER water (mask set) unless `river` is false. */
function water(grid: Grid, x: number, y: number, river = true): void {
  grid.terrain[idx(x, y)] = WATER;
  if (!river) return;
  grid.rivers = grid.rivers ?? new Uint8Array(MAP_W * MAP_H);
  grid.rivers[idx(x, y)] = 1;
}

/** A vertical river stripe: water in `x ∈ [10, 10 + width)`, every y. */
function stripe(width: number): Grid {
  const grid = makeGrid();
  for (let y = 0; y < MAP_H; y++) for (let i = 0; i < width; i++) water(grid, 10 + i, y);
  return grid;
}

/** A single river tile at (10,10) with dry land all around. */
function pond(): Grid {
  const grid = makeGrid();
  water(grid, 10, 10);
  return grid;
}

const purse: Purse = { wood: 999, stone: 999, ore: 999, grain: 999, oil: 999 };

// ── the rule module ────────────────────────────────────────────────────────
describe("R2 (#266) the bridge rule", () => {
  it("a bridge may span RIVER water only — never the sea, never with the option off", () => {
    const grid = pond();
    water(grid, 12, 10, false);                       // sea: WATER without the mask
    expect(bridgeWaterAt(grid, 10, 10)).toBe(true);
    expect(bridgeWaterAt(grid, 12, 10)).toBe(false);  // ocean and lakes never bridge
    expect(bridgeWaterAt(grid, 9, 10)).toBe(false);   // dry land

    const off = pond();
    delete off.rivers;                                // `rivers` option off
    expect(bridgeWaterAt(off, 10, 10)).toBe(false);

    const maskOnly = pond();
    maskOnly.terrain[idx(10, 10)] = GRASS;            // mask set, tile not water
    expect(bridgeWaterAt(maskOnly, 10, 10)).toBe(false);
  });

  it("finds the straight 1- and 2-tile runs and refuses the wide water", () => {
    const one = stripe(1);
    expect(bridgeAxesAt(one, 10, 10)).toBe(AXIS_X);       // across x only
    const two = stripe(2);
    expect(bridgeAxesAt(two, 10, 10)).toBe(AXIS_X);
    expect(bridgeAxesAt(two, 11, 10)).toBe(AXIS_X);
    const three = stripe(3);
    for (const x of [10, 11, 12]) expect(bridgeAxesAt(three, x, 10)).toBe(0);

    // A tile of the stripe sees the other water tiles ALONG it, so the axis
    // that runs with the river is never offered.
    expect(bridgeAxesAt(one, 10, 10) & AXIS_Y).toBe(0);

    // In the sea there is no mask at all, so there is nothing to bridge.
    const sea = makeGrid();
    for (let y = 0; y < 10; y++) water(sea, 10, y, false);
    expect(bridgeAxesAt(sea, 10, 5)).toBe(0);
  });

  it("the bits bridges.ts re-declares are track.ts's, walked the same way", () => {
    expect(BRIDGE_BITS).toEqual([NE, SE, SW, NW]);
    for (const d of DIRS) {
      const [dx, dy] = DIR[d];
      const axis = d === SE || d === NW ? AXIS_X : AXIS_Y;
      expect(axisOfStep(dx, dy)).toBe(axis);
      // The four steps really are the four orthogonal directions.
      expect(Math.abs(dx) + Math.abs(dy)).toBe(1);
      // …and OPPOSITE's partner reverses the step.
      const [ox, oy] = DIR[OPPOSITE[d]];
      expect(dx + ox).toBe(0);
      expect(dy + oy).toBe(0);
    }
    expect(axisOfStep(1, 1)).toBe(0);                  // a diagonal is not a step
    expect(axisOfStep(2, 0)).toBe(0);
    expect(MAX_BRIDGE_SPAN).toBe(2);
  });

  it("prices a deck per water tile, and never for free", () => {
    expect(BRIDGE_COST).toEqual(BUILD_COSTS.bridge);
    expect(RAIL_BRIDGE_COST).toEqual(BUILD_COSTS.railBridge);
    expect(bridgeCostFor(BRIDGE_COST, 2)).toEqual({
      wood: BUILD_COSTS.bridge.wood! * 2, stone: BUILD_COSTS.bridge.stone! * 2,
    });
    expect(bridgeCostFor(BRIDGE_COST, 0)).toEqual({});
    // The design note: per tile, a deck is dearer than the surface it carries.
    expect(BRIDGE_COST.wood!).toBeGreaterThan(TRANSPORT.road.cost.wood ?? 0);
    expect(BRIDGE_COST.stone!).toBeGreaterThan(TRANSPORT.road.cost.stone ?? 0);
    expect(RAIL_BRIDGE_COST.stone!).toBeGreaterThan(RAIL_COSTS.rail.stone!);
    for (const why of ["span", "ends", "bend", "junction", "shared"] as const) {
      expect(BRIDGE_REFUSAL_TEXT[why].length).toBeGreaterThan(0);
    }
  });

  it("planBridges: a straight run is a crossing; span, bend and ends refuse", () => {
    const two = stripe(2);
    const path: [number, number][] = [[8, 10], [9, 10], [10, 10], [11, 10], [12, 10]];
    const plan = planBridges(two, path, () => false, () => false);
    expect(plan.refusal).toBeNull();
    expect([...plan.runs.keys()]).toEqual([2, 3]);
    expect(plan.runs.get(2)!.axis).toBe(AXIS_X);
    expect([...plan.deckTiles].sort((a, b) => a - b)).toEqual([tIdx(10, 10), tIdx(11, 10)]);

    const wide = planBridges(stripe(3), [[8, 10], [9, 10], [10, 10], [11, 10], [12, 10], [13, 10], [14, 10]],
      () => false, () => false);
    expect(wide.runs.size).toBe(0);
    expect(wide.refusal).toEqual({ index: 2, why: "span" });

    // An L of water: two tiles, but not straight.
    const bend = makeGrid();
    water(bend, 10, 10); water(bend, 10, 11);
    const bent = planBridges(bend, [[9, 10], [10, 10], [10, 11], [10, 12]], () => false, () => false);
    expect(bent.runs.size).toBe(0);
    expect(bent.refusal!.why).toBe("bend");

    // A drag that stops in the water is not a crossing: the deck must land on
    // both banks inside the one gesture.
    const ends = planBridges(pond(), [[9, 10], [10, 10]], () => false, () => false);
    expect(ends.runs.size).toBe(0);
    expect(ends.refusal!.why).toBe("ends");
  });

  it("planBridges: a flank with track is a junction, the other layer's deck is not shared", () => {
    const grid = pond();
    const lane = new Set([tIdx(10, 9)]);               // a road along the north bank
    const jun = planBridges(grid, [[9, 10], [10, 10], [11, 10]],
      (x, y) => lane.has(tIdx(x, y)), () => false);
    expect(jun.runs.size).toBe(0);
    expect(jun.refusal!.why).toBe("junction");

    const theirs = new Set([tIdx(10, 10)]);            // the other layer's deck
    const shared = planBridges(grid, [[9, 10], [10, 10], [11, 10]], () => false,
      (x, y) => theirs.has(tIdx(x, y)));
    expect(shared.runs.size).toBe(0);
    expect(shared.refusal!.why).toBe("shared");
  });
});

// ── the road layer ─────────────────────────────────────────────────────────
describe("R2 (#266) a road drag crosses the river", () => {
  const drag = (grid: Grid, track: Track, railAt: (x: number, y: number) => boolean,
    ax: number, ay: number, bx: number, by: number, freeTiles = 0, kind: TrackKind = "dirt") =>
    previewDrag(grid, track, kind, purse, ax, ay, bx, by, true, undefined, freeTiles,
      undefined, false, { railAt });

  it("previews the deck, prices it per water tile, and no allowance covers it", () => {
    const grid = stripe(2);
    const track = createTrack();
    // newLoop: the dry tiles are free outright — the decks are not.
    const pv = previewDrag(grid, track, "dirt", purse, 8, 10, 13, 10, true, undefined, 12,
      undefined, true, { railAt: () => false });
    expect(pv.truncated).toBe(false);
    expect(pv.tiles.map(([x]) => x)).toEqual([8, 9, 10, 11, 12, 13]);
    expect(pv.bridges).toBe(2);
    expect(pv.cost).toEqual({
      wood: BUILD_COSTS.bridge.wood! * 2, stone: BUILD_COSTS.bridge.stone! * 2,
    });
    expect(pv.free).toBe(0);         // a free tile consumes no allowance
    // …and with no allowance at all the same drag costs exactly the same: the
    // free setup tiles buy road, never a deck.
    const bare = previewDrag(grid, track, "dirt", purse, 8, 10, 13, 10, true, undefined, 0,
      undefined, false, { railAt: () => false });
    expect(bare.cost).toEqual(pv.cost);
  });

  it("builds it: straight bits on water, ordinary track afterwards", () => {
    const grid = stripe(2);
    const track = createTrack();
    const pv = drag(grid, track, () => false, 8, 10, 13, 10);
    const res = commitDrag(track, "dirt", pv, 1);
    expect(res.built).toHaveLength(6);
    for (const x of [10, 11]) {
      expect(hasTrack(track, "dirt", x, 10)).toBe(true);
      expect(bitsAt(track, "dirt", x, 10)).toBe(SE | NW);        // a straight crossing
      expect(grid.terrain[idx(x, 10)]).toBe(WATER);              // still water underneath
    }
    expect(track.owner[tIdx(10, 10)]).toBe(1);                   // ownership is ordinary
    // …and so is connectivity: the owner's own flood crosses the river.
    const net = playerNetwork(track, 1, [{ ownerId: 1, tx: 8, ty: 10 }], []);
    expect(net.has(tIdx(10, 10))).toBe(true);
    expect(net.has(tIdx(13, 10))).toBe(true);

    // Re-dragging the finished crossing charges nothing for its decks.
    const again = drag(grid, track, () => false, 8, 10, 13, 10);
    expect(again.bridges).toBe(0);
    expect(again.cost).toEqual({});

    // Demolition is the road rule: the deck goes, the water is open again.
    demolishTile(track, "dirt", 10, 10);
    expect(hasTrack(track, "dirt", 10, 10)).toBe(false);
    const redo = drag(grid, track, () => false, 8, 10, 13, 10);
    expect(redo.bridges).toBe(1);
  });

  it("refuses wide water and stops the drag on the bank", () => {
    const grid = stripe(3);
    const track = createTrack();
    const pv = drag(grid, track, () => false, 8, 10, 14, 10);
    expect(pv.bridges).toBe(0);
    expect(pv.truncated).toBe(true);
    expect(pv.tiles.map(([x]) => x)).toEqual([8, 9]);
    expect(pv.blocked.map(([x]) => x)).toEqual([10, 11, 12]);
    expect(buildRefusal(grid, "dirt", 10, 10)).toBe("water");
    expect(canBuildOn(grid, "dirt", 10, 10)).toBe(false);
  });

  it("refuses the sea exactly as before — the mask is the whole difference", () => {
    const grid = makeGrid();
    for (let y = 0; y < MAP_H; y++) water(grid, 10, y, false);
    const track = createTrack();
    const pv = drag(grid, track, () => false, 8, 10, 12, 10);
    expect(pv.bridges).toBe(0);
    expect(pv.tiles.map(([x]) => x)).toEqual([8, 9]);
    expect(buildRefusal(grid, "dirt", 10, 10)).toBe("water");
  });

  it("refuses a flank that would turn the deck into a junction", () => {
    const grid = pond();
    const track = createTrack();
    // A spur standing on the deck's north flank (the water tile's neighbour).
    const spur = drag(grid, track, () => false, 10, 9, 10, 8);
    commitDrag(track, "dirt", spur, 1);
    expect(hasTrack(track, "dirt", 10, 9)).toBe(true);
    const pv = drag(grid, track, () => false, 9, 10, 11, 10);
    expect(pv.bridges).toBe(0);
    expect(pv.blocks);           // (read for clarity; the next line is the rule)
    expect(pv.tiles.map(([x]) => x)).toEqual([9]);
    expect(pv.truncated).toBe(true);

    // The spur is a junction the moment the deck stands, and the deck's own
    // line is still legal ground — that is how a crossing is repaired.
    const clear = pond();
    const t2 = createTrack();
    commitDrag(t2, "dirt", drag(clear, t2, () => false, 9, 10, 11, 10), 1);
    expect(hasTrack(t2, "dirt", 10, 10)).toBe(true);
    expect(buildRefusal(clear, "dirt", 10, 9, undefined, undefined, t2)).toBe("bridge-junction");
    expect(canBuildOn(clear, "dirt", 10, 9, undefined, undefined, t2)).toBe(false);
    expect(buildRefusal(clear, "dirt", 9, 10, undefined, undefined, t2)).toBeNull();
    // …and a tile DIAGONALLY beside a deck is not a junction: it never joins.
    expect(buildRefusal(clear, "dirt", 9, 9, undefined, undefined, t2)).toBeNull();
  });

  it("a deck that lost both banks is stranded, and repairable from any side", () => {
    const grid = pond();
    const track = createTrack();
    commitDrag(track, "dirt", drag(grid, track, () => false, 9, 10, 11, 10), 1);
    demolishTile(track, "dirt", 9, 10);
    demolishTile(track, "dirt", 11, 10);
    expect(bitsAt(track, "dirt", 10, 10)).toBe(0);          // no axis left to protect
    expect(buildRefusal(grid, "dirt", 10, 9, undefined, undefined, track)).toBeNull();
    expect(buildRefusal(grid, "dirt", 10, 11, undefined, undefined, track)).toBeNull();
    // …and a fresh crossing re-lays the deck's line for FREE: the deck is
    // already the player's own track, so repairing a broken bridge never
    // charges the deck price twice.
    const pv = drag(grid, track, () => false, 9, 10, 11, 10);
    expect(pv.bridges).toBe(0);
    expect(pv.cost).toEqual({});
    expect(pv.tiles).toEqual([[9, 10], [10, 10], [11, 10]]);
    commitDrag(track, "dirt", pv, 1);
    expect(bitsAt(track, "dirt", 10, 10)).toBe(SE | NW);
  });

  it("a deck is never shared: the railway's deck refuses the road's", () => {
    const grid = pond();
    const track = createTrack();
    const rail = createRailState();
    rail.rail.tile[tIdx(10, 10)] = 16 | (NE | SW);            // RAIL_PRESENT | a straight pair
    rail.rail.owner[tIdx(10, 10)] = 1;
    const pv = drag(grid, track, (x, y) => hasRail(rail.rail, x, y), 9, 10, 11, 10);
    expect(pv.bridges).toBe(0);
    expect(pv.tiles.map(([x]) => x)).toEqual([9]);
  });

  it("an unaffordable deck truncates the drag before the water", () => {
    const grid = stripe(1);
    const track = createTrack();
    const poor: Purse = { stone: BUILD_COSTS.bridge.stone! - 1, wood: 999 };
    const pv = previewDrag(grid, track, "dirt", poor, 8, 10, 12, 10, true, undefined, 0,
      undefined, false, { railAt: () => false });
    expect(pv.bridges).toBe(0);
    expect(pv.tiles.map(([x]) => x)).toEqual([8, 9]);          // the bank, and no further
    expect(pv.unaffordable.map(([x]) => x)).toEqual([10, 11, 12]);
  });
});

// ── the railway layer ──────────────────────────────────────────────────────
describe("R2 (#266) a rail drag crosses the river", () => {
  const railDrag = (grid: Grid, track: Track, rail: RailState, ax: number, ay: number, bx: number, by: number) =>
    railPreview(grid, track, rail, 1, purse, ax, ay, bx, by, true);

  it("previews and builds a deck at the deck price", () => {
    const grid = stripe(1);
    const track = createTrack();
    const rail = createRailState();
    const pv = railDrag(grid, track, rail, 9, 10, 11, 10);
    expect(pv.why).toBeNull();
    expect(pv.tiles).toEqual([[9, 10], [10, 10], [11, 10]]);
    expect(pv.bridges).toBe(1);
    expect(pv.cost).toEqual({
      stone: RAIL_COSTS.rail.stone! * 2 + RAIL_COSTS.bridge.stone!,
    });

    const res = buildRail(grid, track, rail, 1, pv.tiles);
    expect(res.ok).toBe(true);
    expect(res.built).toHaveLength(3);
    expect(res.cost).toEqual(pv.cost);
    expect(hasRail(rail.rail, 10, 10)).toBe(true);
    expect(railBitsAt(rail.rail, 10, 10)).toBe(SE | NW);       // straight across
    expect(rail.rail.owner[tIdx(10, 10)]).toBe(1);
    // A deck carries no diagonal link: the bit pair above is whole-tile only.
    expect(railBitsAt(rail.rail, 10, 10) & 0b1111).toBe(SE | NW);

    // Lifting the deck behaves like any rail tile, and it can be re-laid.
    expect(demolishRail(rail, 10, 10)).toBe(true);
    expect(hasRail(rail.rail, 10, 10)).toBe(false);
    expect(railDrag(grid, track, rail, 9, 10, 11, 10).bridges).toBe(1);
  });

  it("prices a 2-tile crossing per deck tile, and refuses the wide water", () => {
    const two = stripe(2);
    const pv = railDrag(two, createTrack(), createRailState(), 9, 10, 12, 10);
    expect(pv.why).toBeNull();
    expect(pv.bridges).toBe(2);
    expect(pv.cost).toEqual({
      stone: RAIL_COSTS.rail.stone! * 2 + RAIL_COSTS.bridge.stone! * 2,
    });

    const three = stripe(3);
    const wide = railDrag(three, createTrack(), createRailState(), 9, 10, 13, 10);
    expect(wide.bridges).toBe(0);
    expect(wide.why).toBe("water");
    expect(wide.tiles).toEqual([[9, 10]]);
  });

  it("a bare river tile still refuses rail — the R1 rule, unchanged", () => {
    const grid = stripe(1);
    const track = createTrack();
    const rail = createRailState();
    expect(railTileRefusal(grid, track, rail, 1, 10, 10)).toBe("water");
    expect(RAIL_REFUSAL_TEXT.water.length).toBeGreaterThan(0);
    expect(RAIL_REFUSAL_TEXT["bridge-junction"].length).toBeGreaterThan(0);
  });

  it("a diagonal may not start or end on a deck", () => {
    const grid = stripe(1);
    const track = createTrack();
    const rail = createRailState();
    const path = railPreview(grid, track, rail, 1, purse, 9, 9, 11, 11, true);
    expect(path.why).toBe("water");
    expect(path.bridges).toBe(0);
    expect(path.tiles).toEqual([[9, 9]]);
  });

  it("refuses a side join on a standing rail deck", () => {
    const grid = pond();
    const track = createTrack();
    const rail = createRailState();
    const pv = railDrag(grid, track, rail, 9, 10, 11, 10);
    buildRail(grid, track, rail, 1, pv.tiles);
    expect(railTileRefusal(grid, track, rail, 1, 10, 9)).toBe("bridge-junction");
    expect(railTileRefusal(grid, track, rail, 1, 9, 10)).toBe("ok");
  });

  it("a deck is never shared: the road's deck refuses the railway's", () => {
    const grid = pond();
    const track = createTrack();
    const rail = createRailState();
    commitDrag(track, "dirt", previewDrag(grid, track, "dirt", purse, 9, 10, 11, 10, true,
      undefined, 0, undefined, false, { railAt: () => false }), 1);
    expect(hasTrack(track, "dirt", 10, 10)).toBe(true);
    const pv = railDrag(grid, track, rail, 10, 9, 10, 11);
    expect(pv.bridges).toBe(0);
    expect(pv.why).toBe("water");
    expect(pv.tiles).toEqual([[10, 9]]);
  });
});

// ── the rival's planners ───────────────────────────────────────────────────
describe("R2 (#266) the rival can plan a bridge", () => {
  it("ranks a river crossing as passable-but-dear, and wide water as a wall", () => {
    const one = stripe(1);
    const track = createTrack();
    const deck = stepCost(one, track, "dirt", 10, 10, 1);
    expect(deck).toBe(COST_BRIDGE);
    expect(deck).toBeGreaterThan(stepCost(one, track, "dirt", 9, 10, 1));
    expect(stepCost(stripe(3), track, "dirt", 11, 10, 1)).toBe(IMPASSABLE);
    const sea = makeGrid();
    for (let y = 0; y < MAP_H; y++) water(sea, 10, y, false);
    expect(stepCost(sea, track, "dirt", 10, 10, 1)).toBe(IMPASSABLE);

    const rail = createRailState();
    // The railway's ranker opens the same door, and closes it on the sea.
    expect(railStepCost(one, track, rail, 1, 10, 10)).toBeLessThan(IMPASSABLE);
    expect(railStepCost(one, track, rail, 1, 10, 10)).toBeGreaterThan(
      railStepCost(one, track, rail, 1, 9, 10));
    expect(railStepCost(stripe(3), track, rail, 1, 11, 10)).toBe(IMPASSABLE);
    expect(railStepCost(sea, track, rail, 1, 10, 10)).toBe(IMPASSABLE);
    // A road deck is not the railway's ground either.
    const ponded = pond();
    commitDrag(track, "dirt", previewDrag(ponded, track, "dirt", purse, 9, 10, 11, 10, true,
      undefined, 0, undefined, false, { railAt: () => false }), 1);
    expect(railStepCost(ponded, track, rail, 1, 10, 10)).toBe(IMPASSABLE);
  });

  it("plans a route across a narrow river, and none across a wide one", () => {
    const grid = stripe(1);
    const track = createTrack();
    const rail = createRailState();
    const path = planRailRoute(grid, track, rail, 1, 9, 10, 11, 10);
    expect(path).not.toBeNull();
    const v = validateRailDrag(grid, track, rail, 1, path as [number, number][]);
    expect(v).toEqual({ ok: true, fresh: 3, bridges: 1, why: null });

    // The same line, on water too wide to bridge, is a wall.
    const wide = stripe(3);
    expect(planRailRoute(wide, createTrack(), createRailState(), 1, 9, 10, 13, 10)).toBeNull();
    expect(validateRailDrag(wide, createTrack(), createRailState(), 1,
      [[9, 10], [10, 10], [11, 10], [12, 10], [13, 10]])).toEqual({
      ok: false, fresh: 0, bridges: 0, why: "water",
    });
  });

  it("the rival's road plan refuses a shape that bends back beside the water", () => {
    const grid = pond();
    const state = { grid, track: createTrack(), harvesters: [], factories: [] } as EconomyState;
    const straight: Path = { tiles: [[9, 10], [10, 10], [11, 10]], cost: 0 };
    const ok = planFeasibility(state, "dirt", straight, 9, 10, 1);
    expect(ok.executable).toBe(true);
    expect([...ok.bridgeTiles]).toEqual([tIdx(10, 10)]);

    // …and the SAME shape the player's preview refuses: the last two tiles run
    // back along the bank the crossing just reached, which would put track on
    // the deck's flank.
    const bent: Path = { tiles: [[9, 10], [10, 10], [11, 10], [11, 11], [10, 11]], cost: 0 };
    expect(planFeasibility(state, "dirt", bent, 9, 10, 1).executable).toBe(false);
  });

  it("the plan's deck tiles are TILE indices, not path positions", () => {
    const grid = stripe(1);
    const track = createTrack();
    const rail = createRailState();
    // A path whose deck sits at a position the tile index does not share: the
    // drag starts far from the map's origin, so path index 1 (tile 10,10) can
    // never be confused with tile index 1.
    const tiles: [number, number][] = [[9, 10], [10, 10], [11, 10]];
    const plan = railBridgePlan(grid, track, rail, 1, tiles, new Set(tiles.map(([x, y]) => tIdx(x, y))));
    expect([...plan.runs.keys()]).toEqual([1]);
    expect([...plan.deckTiles]).toEqual([tIdx(10, 10)]);
    expect(tIdx(10, 10)).not.toBe(1);
  });
});

// ── the real game, with the rivers option ON ───────────────────────────────
describe("R2 (#266) a bridge in the running game", () => {
  it("a drag across the river builds a deck, and `builtAt` says so", async () => {
    const iso = await boot();
    expect(iso.grid.rivers).toBeDefined();

    const spot = findCrossing(iso);
    expect(spot, "a rivered map must offer at least one narrow crossing near land").not.toBeNull();
    const [ax, ay, bx, by] = spot!;

    const preview = iso.dragPreview("dirt", ax, ay, bx, by);
    expect(preview).not.toBeNull();
    expect(preview!.bridges).toBe(1);
    expect(preview!.cost).toEqual(BRIDGE_COST);            // one deck, one price

    const built = iso.dragBuild("dirt", ax, ay, bx, by);
    expect(built).not.toBeNull();
    const deck: [number, number] = [(ax + bx) / 2, ay];
    expect(iso.grid.terrain[idx(deck[0], deck[1])]).toBe(WATER);
    expect(hasTrack(iso.track, "dirt", deck[0], deck[1])).toBe(true);
    expect(bitsAt(iso.track, "dirt", deck[0], deck[1])).toBe(SE | NW);
    // THE rule the ticket names: `Grid.builtAt` reports the deck, so nothing
    // else (a platform, a depot, the rival's road) may be built on it.
    expect(iso.grid.builtAt!(deck[0], deck[1])).toBe("bridge");
    expect(iso.grid.builtAt!(ax, ay)).not.toBe("bridge");  // the banks are ordinary road
    // One deck, one layer: the railway may not share it.
    expect(railTileRefusal(iso.grid, iso.track, iso.railState, 1, deck[0], deck[1])).toBe("water");
  });
});
