// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAP_W, MAP_H } from "../../src/game/config";
import { GRASS, WATER, TOWN_OCC, type Grid } from "../../src/iso/grid";
import {
  addCost, buildTile, commitDrag, createTrack, dirtyTiles, hasTrack, lPath, octPath,
  previewDrag, roadDiagLinked, roadDragRefusalText, roadTierAt, setRoadTier, tierTileCost,
  tileCost, tIdx, OVERPASS_COST, OVERPASS_Y, PUBLIC_OWNER, ROAD_DIAG, ROAD_TIER,
  type DragPreview, type Purse, type RoadTierKey, type Track, type TrackKind,
} from "../../src/iso/track";
import { octPath as railOctPath } from "../../src/iso/rail";
import { BRIDGE_COST } from "../../src/iso/bridges";
import { roadPath } from "../../src/iso/road-routing";
import { routeTileLength } from "../../src/iso/slopes";

const rich = { wood: 9999, stone: 9999, ore: 9999, grain: 9999, oil: 9999, gold: 9999 };
const flat = (): Grid => ({ w: MAP_W, h: MAP_H, terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
  occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), industries: [], towns: [], seed: 1 });
const preview = (g: Grid, t: Track, kind: TrackKind = "road", tier: RoadTierKey = "road",
  end: [number, number] = [15, 12], first = true, purse: Purse = rich) =>
  previewDrag(g, t, kind, purse, 10, 10, ...end, first, undefined, 0, undefined, true, {}, tier);
const assertLinks = (t: Track, pv: DragPreview) => {
  for (const [ax, ay, bx, by] of pv.roadPlan?.links ?? []) expect(roadDiagLinked(t, ax, ay, bx, by)).toBe(true);
};
const assertBuilt = (t: Track, kind: TrackKind, pv: DragPreview, tier: RoadTierKey = "road") => {
  const r = commitDrag(t, kind, pv, 1, tier);
  expect(r.built).toEqual(pv.tiles); expect(r.cost).toEqual(pv.cost);
  for (const [x, y] of pv.tiles) expect(hasTrack(t, kind, x, y) || (kind === "dirt" && hasTrack(t, "road", x, y))).toBe(true);
  for (const [x, y] of [...pv.blocked, ...pv.unaffordable]) {
    // Used with fixtures whose refused/over-budget tail was not built before.
    expect(hasTrack(t, kind, x, y)).toBe(false);
  }
  assertLinks(t, pv);
  return r;
};
afterEach(() => { dirtyTiles.clear(); vi.restoreAllMocks(); });

describe("D2 shared octilinear path", () => {
  it("moves rail's existing implementation, rather than creating a road variant", () => {
    expect(octPath).toBe(railOctPath);
  });
  it.each([[-5, -2], [-5, 2], [5, -2], [5, 2], [-2, -5], [2, -5], [-2, 5], [2, 5]])(
    "shortest 8-direction route to offset (%i,%i), either bend order", (dx, dy) => {
      for (const first of [true, false]) {
        const path = octPath(10, 10, 10 + dx, 10 + dy, first);
        expect(path.length).toBe(1 + Math.max(Math.abs(dx), Math.abs(dy)));
        expect(path[0]).toEqual([10, 10]); expect(path.at(-1)).toEqual([10 + dx, 10 + dy]);
        expect(new Set(path.map(([x, y]) => tIdx(x, y))).size).toBe(path.length);
        const steps = path.slice(1).map(([x, y], i) => [x - path[i][0], y - path[i][1]]);
        expect(steps.every(([x, y]) => Math.max(Math.abs(x), Math.abs(y)) === 1)).toBe(true);
        expect(steps.filter(([x, y]) => x && y).length).toBe(Math.min(Math.abs(dx), Math.abs(dy)));
        expect(routeTileLength(path, true)).toBeCloseTo(1 + Math.abs(Math.abs(dx) - Math.abs(dy)) + Math.min(Math.abs(dx), Math.abs(dy)) * Math.SQRT2);
        const g = flat(), t = createTrack(true), pv = preview(g, t, "dirt", "road", [10 + dx, 10 + dy], first);
        expect(pv.tiles).toEqual(path); assertBuilt(t, "dirt", pv);
      }
    });
  it.each([[3, 3], [3, -3], [-3, 3], [-3, -3], [0, 3], [-3, 0], [0, 0]])(
    "pure diagonals, straight drags and one-tile taps don't change on R (%i,%i)", (dx, dy) => {
      expect(octPath(10, 10, 10 + dx, 10 + dy, true)).toEqual(octPath(10, 10, 10 + dx, 10 + dy, false));
    });
  it("R switches straight-then-diagonal to diagonal-then-straight", () => {
    expect(preview(flat(), createTrack(true)).tiles).toEqual([[10, 10], [11, 10], [12, 10], [13, 10], [14, 11], [15, 12]]);
    expect(preview(flat(), createTrack(true), "road", "road", [15, 12], false).tiles).toEqual([[10, 10], [11, 11], [12, 12], [13, 12], [14, 12], [15, 12]]);
  });
});

describe("D2 preview, price and commit are one plan", () => {
  it.each(["road", "street", "highway", "ramp"] as const)("new %s tiles are priced/stamped identically on both bend orders", (tier) => {
    for (const first of [true, false]) {
      const t = createTrack(true), pv = preview(flat(), t, "road", tier, [15, 12], first);
      expect(pv.tiles).toHaveLength(6);
      const expected = pv.tiles.reduce((c, [x, y]) => addCost(c, tierTileCost(t, tier, x, y)), {});
      expect(pv.cost).toEqual(expected);
      assertBuilt(t, "road", pv, tier);
      for (const [x, y] of pv.tiles) expect(roadTierAt(t, x, y)).toBe(ROAD_TIER[tier]);
    }
  });
  it.each(["road", "street", "highway", "ramp"] as const)("paves existing diagonal dirt with %s at its upgrade price", (tier) => {
    const t = createTrack(true), g = flat();
    const dirt = preview(g, t, "dirt"); commitDrag(t, "dirt", dirt, 1);
    const pv = preview(g, t, "road", tier);
    expect(pv.upgrades).toBe(6);
    expect(pv.cost).toEqual(pv.tiles.reduce((c, [x, y]) => addCost(c,
      tier === "road" ? tileCost(t, "road", x, y, true) : tierTileCost(t, tier, x, y)), {}));
    assertBuilt(t, "road", pv, tier);
    for (const [x, y] of pv.tiles) expect(t.dirt[tIdx(x, y)]).toBe(0);
    const again = preview(g, t, "road", tier); expect(again.cost).toEqual({}); assertBuilt(t, "road", again, tier);
  });
  it.each([true, false])("builds only the affordable diagonal prefix (straightFirst=%s)", (first) => {
    const t = createTrack(true), g = flat();
    const each = tierTileCost(t, "highway", 10, 10);
    const purse = addCost({}, each, 4);
    const pv = preview(g, t, "road", "highway", [15, 12], first, purse);
    expect(pv.tiles).toEqual(octPath(10, 10, 15, 12, first).slice(0, 4));
    expect(pv.unaffordable).toEqual(octPath(10, 10, 15, 12, first).slice(4));
    expect(pv.cost).toEqual(purse); assertBuilt(t, "road", pv, "highway");
  });
  it("never mutates live bytes, tiers, ownership, purse, revision or dirty journal while previewing", () => {
    const g = flat(), t = createTrack(true), purse = { ...rich };
    buildTile(t, "dirt", 10, 10, 1);
    const before = { ...t, dirt: t.dirt.slice(), road: t.road.slice(), tier: t.tier?.slice(), owner: t.owner.slice(), upgraded: t.upgraded.slice() }, journal = dirtyTiles.drain(); dirtyTiles.markAll(journal);
    for (const tier of ["road", "street", "highway", "ramp"] as const) preview(g, t, "road", tier, [15, 12], true, purse);
    expect(t).toEqual(before); expect(purse).toEqual(rich); expect(dirtyTiles.drain()).toEqual(journal);
  });
  it("dirt stays free and never consumes the old setup allowance", () => {
    const g = flat(), t = createTrack(true);
    expect(preview(g, t, "dirt", "road", [13, 13], true, {}).cost).toEqual({});
    const pv = previewDrag(g, t, "dirt", {}, 10, 10, 13, 13, true, undefined, 2);
    expect(pv.free).toBe(0); expect(pv.cost).toEqual({}); expect(pv.tiles).toHaveLength(4); expect(pv.unaffordable).toHaveLength(0);
    assertBuilt(t, "dirt", pv);
  });
  it("steps over own floors without charging them or inventing a link across a skipped tile", () => {
    const g = flat(), t = createTrack(true), floors = new Set([tIdx(10, 10), tIdx(12, 12)]);
    g.builtAt = (x, y) => floors.has(tIdx(x, y)) ? "plant" : null;
    const pv = previewDrag(g, t, "dirt", {}, 10, 10, 14, 14, true, undefined, 0, floors, true);
    expect(pv.tiles).toEqual([[11, 11], [13, 13], [14, 14]]);
    expect(pv.roadPlan!.links).toEqual([[13, 13, 14, 14]]);
    assertBuilt(t, "dirt", pv);
    expect(roadPath(t, 1, [[11, 11]], new Set([tIdx(14, 14)]))).toBeNull();
  });
  it("preserves public ownership when a diagonal meets a public Ramp", () => {
    const t = createTrack(true); buildTile(t, "road", 13, 13, PUBLIC_OWNER); setRoadTier(t, 13, 13, ROAD_TIER.ramp);
    const pv = preview(flat(), t, "road", "highway", [13, 13]);
    expect(pv.tiles).toHaveLength(4); commitDrag(t, "road", pv, 1, "highway"); assertLinks(t, pv);
    expect(t.owner[tIdx(13, 13)]).toBe(PUBLIC_OWNER);
  });
});

describe("D2 refuses blocked links and respects tiers", () => {
  it.each([true, false])("corner-cut refusal truncates and highlights exactly the blocking tile (%s)", (first) => {
    const g = flat(), t = createTrack(true), path = octPath(10, 10, 15, 12, first);
    const at = first ? 4 : 1, [x, y] = path[at], [px, py] = path[at - 1];
    g.occupancy[tIdx(x, py)] = TOWN_OCC; g.terrain[tIdx(px, y)] = WATER;
    const pv = preview(g, t, "dirt", "road", [15, 12], first);
    expect(pv.why).toBe("corner-cut"); expect(pv.blocked).toEqual([[x, y]]);
    expect(pv.tiles).toEqual(path.slice(0, at)); assertBuilt(t, "dirt", pv);
  });
  it("refuses an X with an existing diagonal without charging the refused tile", () => {
    const t = createTrack(true), g = flat();
    const other = previewDrag(g, t, "dirt", {}, 11, 10, 10, 11, true, undefined, 0, undefined, true);
    commitDrag(t, "dirt", other, 2);
    const pv = preview(g, t, "road", "road", [13, 13]);
    expect(pv.why).toBe("diagonal-crossing"); expect(pv.tiles).toEqual([[10, 10]]);
    expect(pv.cost).toEqual(tileCost(createTrack(), "road", 10, 10, true)); assertBuilt(t, "road", pv);
  });
  it("a diagonal Highway upgrade validates projected tiers, not the old Road endpoints", () => {
    const g = flat(), t = createTrack(true);
    buildTile(t, "road", 10, 10, 1); setRoadTier(t, 10, 10, ROAD_TIER.highway);
    for (const [x, y] of [[11, 11], [12, 12], [13, 13]]) buildTile(t, "road", x, y, 1);
    const pv = preview(g, t, "road", "highway", [13, 13]);
    expect(pv.truncated).toBe(false); expect(pv.tiles).toHaveLength(4);
    commitDrag(t, "road", pv, 1, "highway"); assertLinks(t, pv);
  });
  it("Highways keep their flat grade rule on a diagonal", () => {
    const g = flat(), t = createTrack(true); g.height = new Uint8Array(MAP_W * MAP_H);
    g.height[tIdx(11, 11)] = 1;
    const pv = preview(g, t, "road", "highway", [13, 13]);
    expect(pv.why).toBe("too-steep"); expect(pv.tiles).toEqual([[10, 10]]); assertBuilt(t, "road", pv, "highway");
  });
  it("diagonal road crossing a Highway has a clear reason (entry and departure)", () => {
    for (const first of [true, false]) {
      const g = flat(), t = createTrack(true);
      for (let y = 5; y <= 20; y++) { buildTile(t, "road", 12, y, 1); setRoadTier(t, 12, y, ROAD_TIER.highway); }
      const pv = preview(g, t, "road", "road", [14, 12], first);
      expect(pv.why).toBe("diagonal-highway");
      expect(roadDragRefusalText(pv.why)).toContain("cannot cross a Highway");
      expect(pv.blocked[0][0]).toBe(12);
      commitDrag(t, "road", pv, 1);
      expect(roadTierAt(t, ...pv.blocked[0])).toBe(ROAD_TIER.highway);
    }
  });
  it.each(["road", "street"] as const)("an axis crossing on the straight leg pays OVERPASS_COST for %s, then continues diagonally", (tier) => {
    const g = flat(), t = createTrack(true);
    for (let y = 5; y <= 20; y++) { buildTile(t, "road", 12, y, 1); setRoadTier(t, 12, y, ROAD_TIER.highway); }
    const pv = preview(g, t, "road", tier, [16, 12]);
    expect(pv.truncated).toBe(false);
    expect(pv.cost).toEqual(pv.tiles.reduce((c, [x, y]) => addCost(c, x === 12 ? OVERPASS_COST : tierTileCost(t, tier, x, y)), {}));
    commitDrag(t, "road", pv, 1, tier);
    expect(roadTierAt(t, 12, 10)).toBe(OVERPASS_Y); assertLinks(t, pv);
    expect(roadPath(t, 1, [[10, 10]], new Set([tIdx(16, 12)]))).not.toBeNull();
    expect(roadPath(t, 1, [[10, 10]], new Set([tIdx(12, 8)]))).toBeNull();
  });
});

describe("D2 bridge plans and OFF compatibility", () => {
  const river = (width: number) => {
    const g = flat(); g.rivers = new Uint8Array(MAP_W * MAP_H);
    for (let y = 0; y < MAP_H; y++) for (let x = 12; x < 12 + width; x++) {
      g.terrain[tIdx(x, y)] = WATER; g.rivers[tIdx(x, y)] = 1;
    }
    return g;
  };
  it.each([["road", 2], ["street", 2], ["highway", 4]] as const)("%s bridges %i water tiles along the straight leg", (tier, width) => {
    const g = river(width), t = createTrack(true), end: [number, number] = [18 + width, 12];
    const pv = preview(g, t, "road", tier, end);
    expect(pv.truncated).toBe(false); expect(pv.bridges).toBe(width);
    expect(pv.cost).toEqual(pv.tiles.reduce((c, [x, y]) => addCost(c,
      g.terrain[tIdx(x, y)] === WATER ? BRIDGE_COST : tierTileCost(t, tier, x, y)), {}));
    assertBuilt(t, "road", pv, tier);
    expect(roadPath(t, 1, [[10, 10]], new Set([tIdx(...end)]))).not.toBeNull();
  });
  it("Highway bridge ramps may leave zero-height water for a raised bank", () => {
    const g = river(4), t = createTrack(true);
    g.height = new Uint8Array(MAP_W * MAP_H).fill(3);
    for (let y = 0; y < MAP_H; y++) for (let x = 12; x < 16; x++) g.height[tIdx(x, y)] = 0;
    const pv = preview(g, t, "road", "highway", [22, 12]);
    expect(pv.truncated).toBe(false); expect(pv.bridges).toBe(4);
    assertBuilt(t, "road", pv, "highway");
  });
  it("refuses diagonal decks and 5-tile Highway spans", () => {
    for (const [g, end] of [[river(1), [15, 15]], [river(5), [22, 12]]] as [Grid, [number, number]][]) {
      const t = createTrack(true), pv = preview(g, t, "road", "highway", end);
      expect(pv.truncated).toBe(true); expect(pv.bridges).toBe(0); expect(pv.blocked[0][0]).toBe(12);
      assertBuilt(t, "road", pv, "highway");
    }
  });
  it("doesn't build a half-bridge when only one of two decks is affordable", () => {
    const t = createTrack(true), g = river(2);
    const pv = preview(g, t, "dirt", "road", [18, 12], true, BRIDGE_COST);
    expect(pv.tiles).toEqual([[10, 10], [11, 10]]); expect(pv.bridges).toBe(0); expect(pv.cost).toEqual({});
    expect(pv.unaffordable[0]).toEqual([12, 10]); assertBuilt(t, "dirt", pv);
  });
  it("refuses a bridge already carrying rail", () => {
    const g = river(1), t = createTrack(true);
    const pv = previewDrag(g, t, "dirt", rich, 10, 10, 18, 12, true, undefined, 0, undefined, true,
      { railAt: (x, y) => x === 12 && y === 10 });
    expect(pv.bridges).toBe(0); expect(pv.blocked).toContainEqual([12, 10]); assertBuilt(t, "dirt", pv);
  });
  it("flag OFF retains the exact legacy L-path, prices and bytes", () => {
    for (const first of [true, false]) {
      const t = createTrack(false), pv = preview(flat(), t, "road", "road", [13, 12], first);
      expect(pv.tiles).toEqual(lPath(10, 10, 13, 12, first)); expect(pv.roadPlan).toBeUndefined();
      expect(pv.why).toBeUndefined();
      expect(pv.cost).toEqual(addCost({}, tileCost(t, "road", 10, 10, true), 6));
      const expected = createTrack(false);
      for (const [x, y] of pv.tiles) buildTile(expected, "road", x, y, 1);
      commitDrag(t, "road", pv, 1);
      expect(t).toEqual(expected);
      expect(t.road.every((b) => !(b & ROAD_DIAG))).toBe(true);
    }
  });
});


// Real input handlers + cost/overlay composition. Picking and graphics are
// stubbed: this is not a browser/art check (the lead owns Playwright).
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));
import { IsoRenderer } from "../../src/iso/renderer";
import { mulberry32, setRng } from "../../src/game/config";

interface DragHook {
  grid: Grid; track: Track; purse: Record<string, number>;
  finishSetup(): void; setTool(t: string): void;
  dragPreview(kind: TrackKind, ax: number, ay: number, bx: number, by: number, first?: boolean): DragPreview;
  activeRoadDrag: { ax: number; ay: number; bx: number; by: number; xFirst: boolean; preview: DragPreview } | null;
  activeDragOverlay: { sprite: string; tx: number; ty: number }[];
}

describe("D2 live pointer / R / overlay contract", () => {
  let root: HTMLDivElement, dispose: (() => void) | undefined;
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
  beforeEach(() => {
    const gradient = { addColorStop() {}, setTransform() {} };
    const ctx = new Proxy({}, {
      get: (_target, prop) => {
        if (prop === "canvas") return null;
        if (prop === "measureText") return () => ({ width: 0 });
        if (["createLinearGradient", "createRadialGradient", "createConicGradient", "createPattern"].includes(String(prop))) return () => gradient;
        if (prop === "getImageData") return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4).fill(255), width: w, height: h });
        return () => undefined;
      }, set: () => true,
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ctx) as never);
    vi.stubGlobal("Image", class {
      width = 1024; height = 1024; onload: (() => void) | null = null;
      set src(_v: string) { queueMicrotask(() => this.onload?.()); }
    });
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("OffscreenCanvas", undefined);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => setTimeout(() => cb(performance.now()), 0) as unknown as number);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => clearTimeout(id));
    vi.spyOn(IsoRenderer.prototype, "pick").mockImplementation((x, y) => ({ tx: Math.round(x / 10), ty: Math.round(y / 10), sprite: null, ref: null }));
    // The normal relative-URL art fallbacks are expected, not the subject of
    // these input assertions. No image/network fixture generation is needed.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.clear(); localStorage.setItem("hexmatch:tutorial", "never");
    window.history.replaceState(null, "", "/?diag=1&seed=1337&unlimited=0");
    setRng(mulberry32(1337));
    root = document.createElement("div");
    Object.defineProperties(root, { clientWidth: { value: 900 }, clientHeight: { value: 700 } });
    document.body.appendChild(root);
  });
  afterEach(() => { dispose?.(); dispose = undefined; root.remove(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); localStorage.clear(); });
  async function boot(diagonal = true): Promise<DragHook> {
    if (!diagonal) window.history.replaceState(null, "", "/?diag=0&seed=1337&unlimited=0");
    const { startIsoGame } = await import("../../src/iso/game");
    dispose = startIsoGame(root, { rivers: false, elevation: false, shapes: false, rings: false });
    await settle();
    const h = (window as unknown as { __iso: DragHook }).__iso;
    h.finishSetup(); h.setTool("dirt");
    h.grid.terrain.fill(GRASS); h.grid.occupancy.fill(-1); h.grid.builtAt = () => null;
    for (const layer of [h.track.dirt, h.track.road, h.track.owner, h.track.upgraded, h.track.tier!]) layer.fill(0);
    h.track.revision++; Object.assign(h.purse, rich);
    return h;
  }
  function pointer(type: string, x: number, y: number, pointerType = "mouse", pointerId = 1) {
    const canvas = root.querySelectorAll("canvas.iso-layer")[2];
    const event = new MouseEvent(type, { clientX: x * 10 / (window.devicePixelRatio || 1), clientY: y * 10 / (window.devicePixelRatio || 1), button: 0, buttons: type === "pointerup" ? 0 : 1 });
    Object.defineProperties(event, { pointerType: { value: pointerType }, pointerId: { value: pointerId }, isPrimary: { value: pointerId === 1 } });
    canvas.dispatchEvent(event);
  }
  const pressR = (repeat = false) => window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", repeat, cancelable: true }));

  it("R immediately flips the live highlights and pointerup commits that exact order", async () => {
    const h = await boot(); pointer("pointerdown", 10, 10); pointer("pointermove", 15, 12);
    expect(h.activeRoadDrag!.preview.tiles).toEqual(octPath(10, 10, 15, 12, true));
    pressR();
    const pv = h.activeRoadDrag!.preview;
    expect(h.activeRoadDrag!.xFirst).toBe(false);
    expect(pv.tiles).toEqual(octPath(10, 10, 15, 12, false));
    expect(h.activeDragOverlay.filter((i) => i.sprite === "highlight").map((i) => [i.tx, i.ty])).toEqual(pv.tiles);
    pressR(true); expect(h.activeRoadDrag!.xFirst).toBe(false); // holding R doesn't flicker
    pointer("pointerup", 15, 12);
    expect(h.activeRoadDrag).toBeNull(); assertLinks(h.track, pv);
    for (const [x, y] of pv.tiles) expect(hasTrack(h.track, "dirt", x, y)).toBe(true);
    expect(hasTrack(h.track, "dirt", 11, 10)).toBe(false);
  });

  it("pointerup keeps the original endpoint when an obstacle clips the diagonal leg", async () => {
    const h = await boot();
    h.grid.occupancy[tIdx(15, 12)] = TOWN_OCC;
    pointer("pointerdown", 10, 10); pointer("pointermove", 15, 12);
    const pv = h.activeRoadDrag!.preview;
    expect(pv.tiles).toEqual([[10, 10], [11, 10], [12, 10], [13, 10], [14, 11]]);
    expect(h.activeDragOverlay).toContainEqual({ sprite: "highlight_bad", tx: 15, ty: 12 });
    pointer("pointerup", 15, 12);
    assertLinks(h.track, pv); expect(hasTrack(h.track, "dirt", 15, 12)).toBe(false);
    expect(h.track.dirt.filter((b) => b !== 0).length).toBe(pv.tiles.length);
  });

  it("affordable-prefix preview, highlighted tail and actual purse debit agree", async () => {
    const h = await boot(); h.setTool("road");
    const budget = addCost({}, tileCost(h.track, "road", 10, 10, true), 5);
    for (const key of Object.keys(h.purse)) h.purse[key] = budget[key as keyof Purse] ?? 0;
    pointer("pointerdown", 10, 10); pointer("pointermove", 15, 12); pressR();
    const pv = h.activeRoadDrag!.preview;
    expect(pv.tiles).toEqual(octPath(10, 10, 15, 12, false).slice(0, 5));
    expect(pv.cost).toEqual(budget);
    expect(h.activeDragOverlay).toContainEqual({ sprite: "highlight_bad", tx: 15, ty: 12 });
    pointer("pointerup", 15, 12); assertLinks(h.track, pv);
    expect(hasTrack(h.track, "road", 15, 12)).toBe(false);
    for (const key of Object.keys(budget)) expect(h.purse[key]).toBe(0);
  });

  it.each(["road", "street", "highway", "ramp"] as const)("the %s toolbar selection, debug preview and pointer price agree", async (tier) => {
    const h = await boot();
    const button = root.querySelector<HTMLButtonElement>(`[data-tool="${tier}"]`)!;
    expect(button).not.toBeNull();
    // Dispatch the toolbar's click handler directly; layout/enabled-state
    // browser behavior is not under test in this canvas-stubbed harness.
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const expected = h.dragPreview("road", 10, 10, 15, 12);
    const before = { ...h.purse };
    pointer("pointerdown", 10, 10); pointer("pointermove", 15, 12);
    expect(h.activeRoadDrag!.preview).toEqual(expected);
    expect(expected.cost).toEqual(addCost({}, tierTileCost(h.track, tier, 10, 10), 6));
    pointer("pointerup", 15, 12); assertLinks(h.track, expected);
    for (const [x, y] of expected.tiles) expect(roadTierAt(h.track, x, y)).toBe(ROAD_TIER[tier]);
    for (const [key, price] of Object.entries(expected.cost)) expect(h.purse[key]).toBe(before[key] - price!);
  });

  it("a prefix ending on the overpass keeps its crossing tier and quoted price on release", async () => {
    const h = await boot(); h.setTool("road");
    for (let y = 5; y <= 20; y++) { buildTile(h.track, "road", 12, y, 1); setRoadTier(h.track, 12, y, ROAD_TIER.highway); }
    const budget = addCost(addCost({}, tileCost(h.track, "road", 10, 10, true), 2), OVERPASS_COST);
    for (const key of Object.keys(h.purse)) h.purse[key] = budget[key as keyof Purse] ?? 0;
    pointer("pointerdown", 10, 10); pointer("pointermove", 16, 12);
    const pv = h.activeRoadDrag!.preview;
    expect(pv.tiles).toEqual([[10, 10], [11, 10], [12, 10]]);
    expect(pv.cost).toEqual(budget);
    pointer("pointerup", 16, 12);
    expect(roadTierAt(h.track, 12, 10)).toBe(OVERPASS_Y);
    expect(hasTrack(h.track, "road", 13, 10)).toBe(false);
    for (const key of Object.keys(budget)) expect(h.purse[key]).toBe(0);
  });

  it("a diagonal Highway crossing puts the refusal text in the live cost hint", async () => {
    const h = await boot(); h.setTool("road");
    for (let y = 5; y <= 20; y++) { buildTile(h.track, "road", 12, y, 1); setRoadTier(h.track, 12, y, ROAD_TIER.highway); }
    pointer("pointerdown", 10, 10); pointer("pointermove", 14, 12);
    expect(h.activeRoadDrag!.preview.why).toBe("diagonal-highway");
    await settle();
    expect(root.textContent).toContain("A diagonal road cannot cross a Highway");
  });

  it("flag OFF keeps the L drag and R does not change its path", async () => {
    const h = await boot(false); pointer("pointerdown", 10, 10); pointer("pointermove", 15, 12);
    const pv = h.activeRoadDrag!.preview;
    expect(pv.tiles).toEqual(lPath(10, 10, 15, 12, true)); pressR();
    expect(h.activeRoadDrag!.preview).toBe(pv);
    pointer("pointerup", 15, 12);
    expect(h.track.dirt.every((b) => !(b & ROAD_DIAG))).toBe(true);
  });

  it("touch tap slop is unchanged, and a second finger still cancels the drag for pinch", async () => {
    const h = await boot();
    pointer("pointerdown", 10, 10, "touch"); pointer("pointermove", 10.1, 10, "touch");
    expect(h.activeRoadDrag!.preview).toBeNull();
    pointer("pointermove", 15, 12, "touch"); expect(h.activeRoadDrag!.preview.tiles).toHaveLength(6);
    pointer("pointerdown", 18, 14, "touch", 2);
    expect(h.activeRoadDrag).toBeNull();
    expect(h.activeDragOverlay).toEqual([]);
    pointer("pointerup", 15, 12, "touch");
    expect(h.track.dirt.every((b) => b === 0)).toBe(true);
  });
});
