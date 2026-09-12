// ══════════════════════════════════════════════════════════════════════════
// PLACEMENT OVERLAY (vector) — the building highlight drawn as geometry.
//
// The overlay used to be four baked atlas cells blitted per tile. These tests
// pin what the vector replacement guarantees:
//
//   • the outline is the boundary of the whole tile SET, so a multi-tile
//     footprint has no interior seams (one path, not one diamond per tile);
//   • the roles stay the game's own overlay vocabulary (highlight /
//     highlight_bad / highlight_soft / node_mark) and nothing else is
//     swallowed — any other sprite is handed back to the blit path;
//   • the transparent building preview is placed by the same `place()` the
//     structures pass uses, drawn translucent, and tinted by the verdict;
//   • `prefers-reduced-motion` freezes the animation without changing a
//     colour, a shape or a position;
//   • the renderer's A/B switch really is an A/B switch.
//
// A recording 2D context stands in for the canvas: no DOM in this suite, and
// the interesting assertions are about the path commands, not the pixels.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_OVERLAY_STYLE, PlacementOverlay, boundaryLoops, emptyScene,
  loopsBounds, overlayRoleOf, rgba, sceneFromItems, tileLoop,
  type OverlayScene, type OverlayStats,
} from "../../src/iso/overlay-art";
import { Atlas, type Manifest } from "../../src/iso/atlas";
import { createCamera, centerOnTile, worldToScreen } from "../../src/iso/camera";
import { place } from "../../src/iso/depth";
import { FACTORY_SPRITE, FACTORY_FOOTPRINT } from "../../src/iso/config";
import { IsoRenderer, type World } from "../../src/iso/renderer";
import { generateMap } from "../../src/iso/grid";

const manifest: Manifest = JSON.parse(
  readFileSync("assets/iso-atlas/manifest.json", "utf8"),
);

// ── recording 2D context ────────────────────────────────────────────────────
interface Call { name: string; args: unknown[]; props: Record<string, unknown> }

/** A CanvasRenderingContext2D that records instead of rasterising. */
function recorder() {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const snap = () => ({ ...state });
  const paths: [number, number][][] = [];
  let current: [number, number][] | null = null;
  const gradients: { kind: string; args: number[]; stops: [number, string][] }[] = [];
  const grad = (kind: string, args: number[]) => {
    const g = {
      kind, args,
      stops: [] as [number, string][],
      addColorStop(o: number, c: string) { this.stops.push([o, c]); },
    };
    gradients.push(g);
    return g;
  };
  const ctx = {
    // props the painter sets
    set fillStyle(v: unknown) { state.fillStyle = v; },
    get fillStyle() { return state.fillStyle; },
    set strokeStyle(v: unknown) { state.strokeStyle = v; },
    get strokeStyle() { return state.strokeStyle; },
    set lineWidth(v: unknown) { state.lineWidth = v; },
    get lineWidth() { return state.lineWidth; },
    set globalAlpha(v: unknown) { state.globalAlpha = v; },
    get globalAlpha() { return state.globalAlpha; },
    set lineDashOffset(v: unknown) { state.lineDashOffset = v; },
    get lineDashOffset() { return state.lineDashOffset; },
    set lineJoin(v: unknown) { state.lineJoin = v; },
    set lineCap(v: unknown) { state.lineCap = v; },
    set globalCompositeOperation(v: unknown) { state.globalCompositeOperation = v; },
    get globalCompositeOperation() { return state.globalCompositeOperation; },
    // path
    beginPath() { current = []; calls.push({ name: "beginPath", args: [], props: snap() }); },
    moveTo(x: number, y: number) {
      current = [[x, y]]; paths.push(current);
      calls.push({ name: "moveTo", args: [x, y], props: snap() });
    },
    lineTo(x: number, y: number) {
      current?.push([x, y]);
      calls.push({ name: "lineTo", args: [x, y], props: snap() });
    },
    closePath() { calls.push({ name: "closePath", args: [], props: snap() }); },
    fill() { calls.push({ name: "fill", args: [], props: snap() }); },
    stroke() { calls.push({ name: "stroke", args: [], props: snap() }); },
    clip() { calls.push({ name: "clip", args: [], props: snap() }); },
    fillRect(...a: number[]) { calls.push({ name: "fillRect", args: a, props: snap() }); },
    clearRect(...a: number[]) { calls.push({ name: "clearRect", args: a, props: snap() }); },
    setLineDash(...a: unknown[]) { calls.push({ name: "setLineDash", args: a, props: snap() }); },
    drawImage(img: unknown, ...a: number[]) {
      calls.push({ name: "drawImage", args: [img, ...a], props: snap() });
    },
    save() { calls.push({ name: "save", args: [], props: snap() }); },
    restore() { calls.push({ name: "restore", args: [], props: snap() }); },
    createLinearGradient(...a: number[]) {
      const g = grad("linear", a);
      calls.push({ name: "createLinearGradient", args: a, props: snap() });
      return g;
    },
    createRadialGradient(...a: number[]) {
      const g = grad("radial", a);
      calls.push({ name: "createRadialGradient", args: a, props: snap() });
      return g;
    },
  } as unknown as CanvasRenderingContext2D;
  const of = (name: string) => calls.filter((c) => c.name === name);
  return {
    ctx, calls, paths, gradients, of,
    /** every subpath started by a moveTo, in order */
    subpaths: () => paths,
    lastProp: (name: string, prop: string) => {
      const list = of(name);
      return list.length ? list[list.length - 1].props[prop] : undefined;
    },
  };
}

type Rec = ReturnType<typeof recorder>;

/** A fake offscreen surface whose context is a fresh recorder. */
function fakeSurface(w: number, h: number) {
  const rec = recorder();
  const surf = { width: w, height: h, getContext: () => rec.ctx, rec };
  return surf;
}

const cam = () => centerOnTile(createCamera(800, 600), 20, 20);

/**
 * The real manifest plus a 1× atlas image, so the ghost pass has something to
 * tint. Only its existence matters here — the recording context never reads a
 * pixel — but without it `imageForSprite` returns undefined and the ghost
 * correctly reports itself undrawn.
 */
const atlas = () => {
  const a = new Atlas(manifest);
  a.images.set(1, { width: 2048, height: 2048 });
  return a;
};

const paint = (
  scene: OverlayScene,
  ghost: { sprite: string; tx: number; ty: number; valid: boolean } | null = null,
  opts: { timeMs?: number; reducedMotion?: boolean } = {},
) => {
  const rec = recorder();
  const po = new PlacementOverlay();
  po.reducedMotion = !!opts.reducedMotion;
  const surfaces: ReturnType<typeof fakeSurface>[] = [];
  const stats = po.paint(
    rec.ctx, cam(), atlas(), scene, ghost, opts.timeMs ?? 0,
    (w, h) => { const s = fakeSurface(w, h); surfaces.push(s); return s as never; },
  );
  return { rec, stats, surfaces, po };
};

/** A 3×3 block of tiles anchored at (tx,ty). */
const block = (tx: number, ty: number, w = 3, h = 3): [number, number][] => {
  const out: [number, number][] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push([tx + dx, ty + dy]);
  return out;
};

// ── the outline of a tile set ───────────────────────────────────────────────
describe("vector overlay: boundaryLoops", () => {
  it("one tile is a four-corner diamond", () => {
    const loops = boundaryLoops([[5, 7]]);
    expect(loops).toHaveLength(1);
    expect(loops[0].corners).toEqual([[5, 7], [6, 7], [6, 8], [5, 8]]);
  });

  it("a 3×3 footprint is ONE four-corner loop — no interior seams", () => {
    const loops = boundaryLoops(block(10, 10));
    expect(loops).toHaveLength(1);
    expect(loops[0].corners).toEqual([[10, 10], [13, 10], [13, 13], [10, 13]]);
  });

  it("a 2×1 pair merges into ONE rectangle of corner-space", () => {
    // Corner space is the tile lattice, so a merged pair is a 2×1 rectangle
    // here and the six-vertex hexagon only once projected to the screen.
    const loops = boundaryLoops([[4, 4], [5, 4]]);
    expect(loops).toHaveLength(1);
    expect(loops[0].corners).toEqual([[4, 4], [6, 4], [6, 5], [4, 5]]);
  });

  it("diagonal-only contact stays two loops (nothing connects them)", () => {
    expect(boundaryLoops([[2, 2], [3, 3]])).toHaveLength(2);
  });

  it("an L shape is one loop of six corners", () => {
    const loops = boundaryLoops([[0, 0], [1, 0], [0, 1]]);
    expect(loops).toHaveLength(1);
    expect(loops[0].corners).toEqual(
      [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]);
  });

  it("a straight run keeps only its two ends — brackets belong on corners", () => {
    // 1×4: the walk follows four tile edges per side; the outline must not
    // carry the three collinear joins, or every one grows a corner bracket.
    const loops = boundaryLoops([[0, 0], [1, 0], [2, 0], [3, 0]]);
    expect(loops[0].corners).toEqual([[0, 0], [4, 0], [4, 1], [0, 1]]);
  });

  it("duplicate tiles do not punch a hole", () => {
    expect(boundaryLoops([[3, 3], [3, 3]])).toEqual(boundaryLoops([[3, 3]]));
  });

  it("accepts a single-use iterable", () => {
    const gen = (function* () { yield [6, 6] as [number, number]; yield [7, 6] as [number, number]; })();
    expect(boundaryLoops(gen)).toHaveLength(1);
  });

  it("loopsBounds is the diamond bbox of the set, in screen space", () => {
    const c = cam();
    const b = loopsBounds(c, boundaryLoops([[20, 20]]))!;
    // one tile spans TILE_W × TILE_H in world pixels, times the zoom
    expect(b.x1 - b.x0).toBeCloseTo(64 * c.zoom);
    expect(b.y1 - b.y0).toBeCloseTo(32 * c.zoom);
    expect(loopsBounds(c, [])).toBeNull();
  });
});

// ── the scene the game's items describe ─────────────────────────────────────
describe("vector overlay: sceneFromItems", () => {
  it("maps the game's four overlay sprite names onto roles", () => {
    expect(overlayRoleOf("highlight")).toBe("footprint");
    expect(overlayRoleOf("highlight_bad")).toBe("blocked");
    expect(overlayRoleOf("highlight_soft")).toBe("reach");
    expect(overlayRoleOf("node_mark")).toBe("node");
    expect(overlayRoleOf("farm")).toBeNull();
  });

  it("splits by role, collapses duplicates, and hands back everything else", () => {
    const { scene, rest } = sceneFromItems([
      { sprite: "highlight", tx: 1, ty: 2 },
      { sprite: "highlight", tx: 1, ty: 2 },        // duplicate → one fill
      { sprite: "highlight_bad", tx: 2, ty: 2 },
      { sprite: "highlight_soft", tx: 3, ty: 2 },
      { sprite: "node_mark", tx: 4, ty: 2 },
      { sprite: "truck_goods_ne", tx: 5, ty: 2, fx: 5.5, fy: 2.5 },
    ]);
    expect(scene.footprint).toEqual([[1, 2]]);
    expect(scene.blocked).toEqual([[2, 2]]);
    expect(scene.reach).toEqual([[3, 2]]);
    expect(scene.nodes).toEqual([[4, 2]]);
    expect(rest.map((i) => i.sprite)).toEqual(["truck_goods_ne"]);
  });

  it("an empty list is an empty scene", () => {
    expect(sceneFromItems([])).toEqual({ scene: emptyScene(), rest: [] });
  });
});

// ── painting ────────────────────────────────────────────────────────────────
describe("vector overlay: painting a site", () => {
  it("traces ONE path for a 3×3 footprint — a tile per diamond is the old bug", () => {
    const scene: OverlayScene = { ...emptyScene(), footprint: block(20, 20) };
    const { rec, stats } = paint(scene);
    // fill + outline = two traced paths, plus the corner brackets' eight arms;
    // never nine per-tile diamonds.
    const outlines = rec.of("closePath").length;
    expect(stats.loops).toBe(1);
    expect(outlines).toBeLessThanOrEqual(3);
    expect(rec.of("fill").length).toBeGreaterThanOrEqual(1);
    expect(rec.of("stroke").length).toBeGreaterThanOrEqual(1);
  });

  it("fills with the theme's lamp-amber and outlines it brighter", () => {
    const scene: OverlayScene = { ...emptyScene(), footprint: [[20, 20]] };
    // reduced motion pins the breathing pulse at 1, so the alphas below are
    // the palette's own numbers rather than a sample of the animation
    const { rec } = paint(scene, null, { reducedMotion: true });
    // the fill is a gradient of the theme's --gold, brightest at the top
    const [fill] = rec.gradients.filter((g) => g.kind === "linear");
    expect(fill.stops.map(([o]) => o)).toEqual([0, 1]);
    expect(fill.stops[0][1]).toBe(rgba(DEFAULT_OVERLAY_STYLE.valid.fill, DEFAULT_OVERLAY_STYLE.fillTop));
    expect(fill.stops[1][1]).toBe(rgba(DEFAULT_OVERLAY_STYLE.valid.fill, DEFAULT_OVERLAY_STYLE.fillBottom));
    // every stroke on a legal site is the amber ink — nothing red, nothing filled flat
    const inks = rec.of("stroke").map((c) => String(c.props.strokeStyle));
    expect(inks.length).toBeGreaterThanOrEqual(2);
    for (const ink of inks) {
      expect(ink.startsWith("rgba(255, 217, 138")).toBe(true);   // --gold2
      expect(parseFloat(ink.slice(ink.lastIndexOf(",") + 1))).toBeGreaterThan(0.85);
    }
  });

  it("the gradient runs top→bottom of the site (a lit floor, not a flat wash)", () => {
    const scene: OverlayScene = { ...emptyScene(), footprint: block(20, 20) };
    const { rec } = paint(scene);
    const [x0, y0, x1, y1] = rec.of("createLinearGradient")[0].args as number[];
    expect(x0).toBe(x1);              // vertical
    expect(y1).toBeGreaterThan(y0);   // top → bottom
  });

  it("a refused tile paints in the danger hue and adds a hatch", () => {
    const scene: OverlayScene = { ...emptyScene(), blocked: [[20, 20]] };
    const { rec, stats } = paint(scene);
    expect(stats.blocked).toBe(1);
    // hatching clips to the site and strokes stripes through it
    expect(rec.of("clip").length).toBeGreaterThanOrEqual(1);
    const inks = rec.of("stroke").map((c) => String(c.props.strokeStyle));
    expect(inks.some((s) => s.startsWith(rgba(DEFAULT_OVERLAY_STYLE.bad.ink, 1).slice(0, 13))))
      .toBe(true);
    expect(inks.every((s) => !s.includes("255, 217, 138"))).toBe(true);   // no amber on a refusal
  });

  it("the reach band is dashed, faint, and never paints under the footprint", () => {
    const scene: OverlayScene = {
      ...emptyScene(),
      footprint: [[20, 20]],
      reach: [[20, 20], [21, 20], [20, 21]],   // 20,20 doubles as footprint
    };
    const { rec, stats } = paint(scene);
    expect(stats.reach).toBe(2);                 // the overlap is dropped
    expect(rec.of("setLineDash").length).toBeGreaterThanOrEqual(1);
    const reachFill = String(rec.of("fill")[0].props.fillStyle);
    expect(reachFill).toContain("0.1");
  });

  it("node tags bracket each tile and never fill one", () => {
    const { rec: site } = paint({ ...emptyScene(), footprint: [[20, 20]] });
    const fillsForSite = site.of("fill").length;
    const { rec: nodes } = paint({ ...emptyScene(), nodes: [[20, 20], [21, 20]] });
    expect(nodes.of("fill").length).toBe(0);
    expect(nodes.of("stroke").length).toBe(1);
    // two tiles → eight bracket arms traced into that one stroke
    expect(nodes.subpaths().length).toBe(8);
    expect(fillsForSite).toBeGreaterThan(0);
  });

  it("an empty scene paints nothing at all", () => {
    const { rec, stats } = paint(emptyScene());
    expect(stats).toMatchObject({ mode: "vector", loops: 0, ghost: null, ghostDrawn: false });
    expect(rec.calls.filter((c) => !["save", "restore"].includes(c.name))).toHaveLength(0);
  });
});

// ── the transparent building preview ────────────────────────────────────────
describe("vector overlay: the ghost building", () => {
  const ghost = { sprite: FACTORY_SPRITE, tx: 20, ty: 20, valid: true };

  it("is the real sprite, tinted through its own alpha, drawn translucent", () => {
    const { rec, stats, surfaces } = paint(
      { ...emptyScene(), footprint: block(20, 20) }, ghost,
    );
    expect(stats.ghost).toBe(FACTORY_SPRITE);
    expect(stats.ghostDrawn).toBe(true);
    // one tinted surface, built by compositing the tint over the sprite
    expect(surfaces).toHaveLength(1);
    const s = surfaces[0].rec;
    expect(s.of("drawImage").length).toBe(1);
    expect(s.of("fillRect").length).toBe(1);
    const tintPass = s.of("fillRect")[0];
    expect(s.calls[s.calls.indexOf(tintPass) - 1]?.name ?? "").not.toBe("");
    expect(s.of("fillRect")[0].props.globalCompositeOperation).toBe("source-atop");
    // …and blitted translucent, never opaque
    const blit = rec.of("drawImage")[0];
    expect(blit).toBeTruthy();
    expect(blit.props.globalAlpha as number).toBeLessThan(1);
    expect(blit.props.globalAlpha as number).toBeGreaterThan(0.2);
  });

  it("lands exactly where the placed building would — same anchor, same zoom", () => {
    const c = cam();
    const rec = recorder();
    const po = new PlacementOverlay();
    po.paint(rec.ctx, c, atlas(), emptyScene(), ghost, 0,
      (w, h) => fakeSurface(w, h) as never);
    const placed = place(atlas(), { sprite: FACTORY_SPRITE, tx: 20, ty: 20 })!;
    const [sx, sy] = worldToScreen(c, placed.wx, placed.wy);
    const blit = rec.of("drawImage")[0];
    expect(blit.args[1]).toBe(Math.floor(sx));
    // the bob is at most a couple of device pixels either side of the anchor
    expect(Math.abs((blit.args[2] as number) - Math.floor(sy))).toBeLessThanOrEqual(4);
    expect(FACTORY_FOOTPRINT[0]).toBe(3);
  });

  it("a refused site tints the same building red and holds it still", () => {
    const okSurfaces: ReturnType<typeof fakeSurface>[] = [];
    const badSurfaces: ReturnType<typeof fakeSurface>[] = [];
    const runWith = (valid: boolean, sink: typeof okSurfaces) => {
      const rec = recorder();
      const po = new PlacementOverlay();
      po.paint(rec.ctx, cam(), atlas(), emptyScene(),
        { ...ghost, valid }, 1234,
        (w, h) => { const s = fakeSurface(w, h); sink.push(s); return s as never; });
      return rec;
    };
    const ok = runWith(true, okSurfaces);
    const bad = runWith(false, badSurfaces);
    // the tint is a gradient laid over the sprite's alpha; its first stop is
    // the hue the verdict picked
    const tintOf = (s: typeof okSurfaces) => s[0].rec.gradients[0].stops[0][1];
    expect(tintOf(okSurfaces)).not.toBe(tintOf(badSurfaces));
    expect(tintOf(badSurfaces)).toContain("226, 112, 79");   // --danger2
    // a refusal does not float: same y at two different times
    const a = bad.of("drawImage")[0].args[2];
    const again = runWith(false, []);
    expect(again.of("drawImage")[0].args[2]).toBe(a);
    expect(ok.of("drawImage").length).toBe(1);
  });

  it("a ghost with no art to draw reports itself undrawn instead of throwing", () => {
    const { stats } = paint(emptyScene(), { sprite: "no_such_sprite", tx: 1, ty: 1, valid: true });
    expect(stats.ghostDrawn).toBe(false);
    expect(stats.ghost).toBe("no_such_sprite");
  });

  it("caches the tint per (sprite, zoom, verdict)", () => {
    const rec = recorder();
    const po = new PlacementOverlay();
    let built = 0;
    const make = (w: number, h: number) => { built++; return fakeSurface(w, h) as never; };
    for (let i = 0; i < 4; i++) {
      po.paint(rec.ctx, cam(), atlas(), emptyScene(), ghost, i * 100, make);
    }
    expect(built).toBe(1);
    po.paint(rec.ctx, cam(), atlas(), emptyScene(), { ...ghost, valid: false }, 0, make);
    expect(built).toBe(2);
    po.clearCache();
    po.paint(rec.ctx, cam(), atlas(), emptyScene(), ghost, 0, make);
    expect(built).toBe(3);
  });
});

// ── reduced motion ──────────────────────────────────────────────────────────
describe("vector overlay: prefers-reduced-motion", () => {
  const scene: OverlayScene = {
    ...emptyScene(), footprint: [[20, 20]], reach: [[21, 20]],
  };
  const ghost = { sprite: FACTORY_SPRITE, tx: 20, ty: 20, valid: true };

  /** Every command with every property: the frame, in full. */
  const frame = (r: Rec) => r.calls
    .map((c) => `${c.name}:${c.args.join(",")}:${JSON.stringify(c.props)}`)
    .join("|");

  it("freezes: two frames at different times draw identically", () => {
    const a = paint(scene, ghost, { timeMs: 0, reducedMotion: true });
    const b = paint(scene, ghost, { timeMs: 4321, reducedMotion: true });
    expect(frame(a.rec)).toBe(frame(b.rec));
    // …and it is not frozen by drawing nothing
    expect(a.rec.of("stroke").length).toBeGreaterThan(0);
    expect(a.stats.ghostDrawn).toBe(true);
  });

  it("and without it the overlay does move", () => {
    const a = paint(scene, ghost, { timeMs: 0, reducedMotion: false });
    const b = paint(scene, ghost, { timeMs: 4321, reducedMotion: false });
    expect(frame(a.rec)).not.toBe(frame(b.rec));
    // the movement is the march of the reach band and the ghost's bob — the
    // geometry (path commands, ignoring properties) is identical
    const shape = (r: Rec) => r.calls
      .filter((c) => c.name !== "drawImage")
      .map((c) => `${c.name}:${c.args.join(",")}`).join("|");
    expect(shape(a.rec)).toBe(shape(b.rec));
  });
});

// ── the renderer's A/B switch ───────────────────────────────────────────────
describe("vector overlay: renderer integration", () => {
  const mk = () => {
    const rec = recorder();
    const canvas = () => ({ getContext: () => rec.ctx }) as unknown as HTMLCanvasElement;
    const r = new IsoRenderer(
      { terrain: canvas(), structures: canvas(), overlay: canvas() },
      atlas(), cam(), { grid: generateMap(7) } as World,
    );
    return { r, rec };
  };
  const items = [
    { sprite: "highlight", tx: 20, ty: 20 },
    { sprite: "highlight_soft", tx: 21, ty: 20 },
    { sprite: "node_mark", tx: 22, ty: 20 },
  ];

  it("vector (default) strokes the grid instead of blitting the baked cells", () => {
    const { r, rec } = mk();
    expect(r.highlightRenderMode).toBe("vector");
    r.drawOverlay(items, 0);
    expect(rec.of("drawImage").length).toBe(0);
    expect(rec.of("stroke").length).toBeGreaterThan(0);
    expect(rec.of("fill").length).toBeGreaterThan(0);
    expect(r.overlayDiagnostics()).toMatchObject({
      mode: "vector", footprint: 1, reach: 1, nodes: 1,
    });
  });

  it("sprites blits them, exactly as the overlay always did", () => {
    const { r, rec } = mk();
    r.setHighlightMode("sprites");
    r.drawOverlay(items, 0);
    expect(rec.of("drawImage").length).toBe(3);
    expect(r.overlayDiagnostics()).toEqual({ mode: "sprites", painted: 3 });
  });

  it("a non-overlay sprite still blits in vector mode", () => {
    const { r, rec } = mk();
    r.drawOverlay([...items, { sprite: "farm", tx: 20, ty: 21 }], 0);
    expect(rec.of("drawImage").length).toBe(1);
  });

  it("carries the ghost through the overlay pass (render's third argument)", () => {
    // `render()` itself needs the terrain pass, which builds chunk surfaces —
    // no DOM in this suite — so the overlay half is driven directly. This is
    // the exact call `render()` makes with the ghost it was handed.
    const { r, rec } = mk();
    r.drawOverlay([{ sprite: "highlight", tx: 20, ty: 20 }], 0,
      { sprite: FACTORY_SPRITE, tx: 20, ty: 20, valid: true });
    expect(r.overlayDiagnostics()).toMatchObject({
      mode: "vector", ghost: FACTORY_SPRITE,
      // no OffscreenCanvas/DOM in a node suite, so there is no surface to
      // tint into and the ghost reports itself undrawn — the browser path is
      // covered above, where a surface is injected.
      ghostDrawn: false,
    });
    expect(rec.of("drawImage").length).toBe(0);
    expect(rec.of("stroke").length).toBeGreaterThan(0);
  });

  it("setOverlayMotion(false) freezes the overlay", () => {
    const { r, rec } = mk();
    r.setOverlayMotion(false);
    r.drawOverlay(items, 0);
    const first = rec.calls.map((c) => `${c.name}:${c.args.join(",")}`).join("|");
    rec.calls.length = 0;
    r.drawOverlay(items, 9999);
    expect(rec.calls.map((c) => `${c.name}:${c.args.join(",")}`).join("|")).toBe(first);
  });
});

describe("vector overlay: palette", () => {
  it("rgba() expands a hex colour and clamps its alpha", () => {
    expect(rgba("#ffb02e", 0.5)).toBe("rgba(255, 176, 46, 0.5)");
    expect(rgba("#e2704f", 2)).toBe("rgba(226, 112, 79, 1)");
    expect(rgba("#000000", -1)).toBe("rgba(0, 0, 0, 0)");
  });

  it("every tone is opaque-capable hex the theme already ships", () => {
    for (const tone of Object.values(DEFAULT_OVERLAY_STYLE)) {
      if (typeof tone !== "object") continue;
      for (const v of Object.values(tone)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("tileLoop is the single-tile diamond", () => {
    expect(tileLoop(1, 2).corners).toEqual([[1, 2], [2, 2], [2, 3], [1, 3]]);
  });

  it("stats survive a paint with no ghost and no tiles", () => {
    const stats: OverlayStats = paint(emptyScene()).stats;
    expect(stats.footprint + stats.blocked + stats.reach + stats.nodes).toBe(0);
  });
});
