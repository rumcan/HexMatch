import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { HW, HH, tileToScreen } from "../../src/game/config";
import { generateMap, SAND, WATER, type Grid } from "../../src/iso/grid";
import { CHUNK, chunkWorldOrigin } from "../../src/iso/renderer";
import {
  BLEND_STRIDE, GROUND_BLEND, GROUND_BLEND_DEFAULTS, applyGroundBlendSearch,
  BLEND_SOFT_K, BLEND_SOLID_K, BLEND_WASH,
  blendClumpSetsFor, blendClumps, blendCoverage, blendEdgesFor, blendNoise,
  clumpCount, groundContours, invalidateGroundBlend, paintGroundTiles, parseGroundBlend,
  resetGroundBlend, type BlendEdge, type BlendEdgeConfig,
} from "../../src/iso/ground";

// ══════════════════════════════════════════════════════════════════════════
// ART-2 (#382) — the thick dithered blend between water, sand and grass.
//
// What is pinned here is the part that has to be true for the paint to be
// cacheable and for multiplayer to agree:
//
//   • the mask is a pure function of WORLD position and the map seed, so two
//     chunks bake the SAME clumps for the strip they share and each paints its
//     own clipped half — the join is seamless by construction;
//   • the band's width follows the config, and a width of 0 paints exactly the
//     ground the game had before this ticket;
//   • one clump field serves every zoom and detail tier, and is generated once
//     per chunk — never per frame.
//
// The LOOK (does it read as painterly, is it thick enough) is the lead's
// play-test; see the PR for where to look.
// ══════════════════════════════════════════════════════════════════════════

/** A recording 2D context — the same trick the other paint tests use. */
type Pt = [number, number];
interface PaintOp { kind: "fill" | "stroke"; subs: Pt[][]; style: string; alpha: number; width: number }
function recorder() {
  const ops: PaintOp[] = [];
  let subs: Pt[][] = [];
  let cur: Pt[] | null = null;
  const st = { fill: "#000", stroke: "#000", width: 1, alpha: 1 };
  const ctx = {
    imageSmoothingEnabled: true,
    save() {}, restore() {}, clip() {},
    beginPath() { subs = []; cur = null; },
    moveTo(x: number, y: number) { cur = [[x, y]]; subs.push(cur); },
    lineTo(x: number, y: number) { (cur ?? (cur = [[x, y]], subs.push(cur), cur)).push([x, y]); },
    closePath() {},
    fill() { ops.push({ kind: "fill", subs: subs.map((s) => s.slice()), style: String(st.fill), alpha: st.alpha, width: st.width }); },
    stroke() { ops.push({ kind: "stroke", subs: subs.map((s) => s.slice()), style: String(st.stroke), alpha: st.alpha, width: st.width }); },
    setLineDash() {},
    createPattern: () => null,
    get fillStyle() { return st.fill; }, set fillStyle(v) { st.fill = v as string; },
    get strokeStyle() { return st.stroke; }, set strokeStyle(v) { st.stroke = v as string; },
    get lineWidth() { return st.width; }, set lineWidth(v) { st.width = v as number; },
    get globalAlpha() { return st.alpha; }, set globalAlpha(v) { st.alpha = v as number; },
    lineJoin: "miter", lineCap: "butt",
  } as unknown as CanvasRenderingContext2D;
  return { ctx, ops };
}

/** A tile range, as the painters take it. */
type Range = [number, number, number, number];

/** World px → fractional tile u (the inverse of `tileToScreen`'s first axis). */
const tileU = (wx: number, wy: number): number => (wx / HW + wy / HH) / 2;

/** The clump polygons a paint emitted, back in WORLD space, sorted. */
function clumpsFrom(ops: PaintOp[], ox: number, oy: number, z: number): string[] {
  const out: string[] = [];
  for (const op of ops) {
    if (op.kind !== "fill") continue;
    for (const sub of op.subs) {
      if (sub.length !== 8) continue;             // a clump is an 8-gon
      let sx = 0, sy = 0;
      for (const [x, y] of sub) { sx += x; sy += y; }
      out.push(`${(sx / sub.length / z + ox).toFixed(3)},${(sy / sub.length / z + oy).toFixed(3)}`);
    }
  }
  return out.sort();
}

/** Paint one 8×8 chunk exactly the way `groundFillChunk` does. */
function paintChunk(grid: Grid, cx: number, cy: number, z = 1) {
  const r = recorder();
  const [ox, oy] = chunkWorldOrigin(cx, cy, 0);
  paintGroundTiles(r.ctx, grid, cx * CHUNK, cy * CHUNK, cx * CHUNK + CHUNK - 1, cy * CHUNK + CHUNK - 1,
    { grass: "#0f0", sand: "#ff0" }, (wx, wy) => [(wx - ox) * z, (wy - oy) * z]);
  return { ops: r.ops, ox, oy, z };
}

/** A straight edge along y = 0 with the soft side above it. */
const FLAT_EDGE: BlendEdge[] = [
  { ax: -400, ay: 0, bx: 400, by: 0, nx: 0, ny: -1 },
];
const CFG = (widthPx: number, noiseScale = 15, contrast = 1.15): BlendEdgeConfig =>
  ({ widthPx, noiseScale, contrast });

/** How much dither one 8×8 chunk's paint throws. */
function howMuch(grid: Grid, cx: number, cy: number): number {
  const r: Range = [cx * CHUNK, cy * CHUNK, cx * CHUNK + 7, cy * CHUNK + 7];
  const s = blendClumpSetsFor(grid, r, () => blendEdgesFor(grid, ...r));
  return (["sandGrass", "waterSand", "waterGrass"] as const)
    .reduce((n, k) => n + s[k].softSide.length + s[k].hardSide.length + s[k].foam.length, 0);
}

/** The first chunk with a real coast in it — an inland one bakes no dither. */
function coastalChunk(grid: Grid, min = 400): [number, number] {
  for (let cy = 0; cy * CHUNK < grid.h; cy++) {
    for (let cx = 0; cx * CHUNK < grid.w; cx++) {
      if (howMuch(grid, cx, cy) >= min) return [cx, cy];
    }
  }
  throw new Error("no coastal chunk on this seed");
}

beforeEach(() => { resetGroundBlend(); });

describe("ART-2 the blend mask", () => {
  it("is a pure function of world position and the map seed", () => {
    for (const [x, y] of [[0, 0], [137.25, -42.5], [4096, 4096], [-31.7, 88.1]] as const) {
      const a = blendNoise(x, y, 1337, 15);
      expect(blendNoise(x, y, 1337, 15)).toBe(a);       // same answer every call
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it("is continuous — no step at a lattice line", () => {
    // Value noise is C0 everywhere and smoothstep-interpolated inside a cell,
    // so a step smaller than a pixel moves the mask less than a pixel's worth.
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      const x = i * 0.37, y = Math.sin(i) * 90;
      worst = Math.max(worst, Math.abs(blendNoise(x, y, 7, 15) - blendNoise(x + 0.5, y, 7, 15)));
    }
    expect(worst).toBeLessThan(0.05);
  });

  it("does not repeat on the noise lattice or along the world axes", () => {
    // A visible stamp pattern would be a field that repeats at `cell`, or one
    // that is constant along a row/column. Neither survives three octaves with
    // the middle one rotated off the axes.
    let repeats = 0, rows = 0;
    for (let i = 0; i < 200; i++) {
      const x = i * 3.1, y = i * 1.7;
      if (blendNoise(x, y, 99, 15) === blendNoise(x + 15, y, 99, 15)) repeats++;
      if (blendNoise(x, y, 99, 15) === blendNoise(x + 7.3, y, 99, 15)) rows++;
    }
    expect(repeats).toBe(0);
    expect(rows).toBe(0);
  });

  it("gives different seeds different masks", () => {
    let same = 0;
    for (let i = 0; i < 300; i++) {
      const x = i * 2.3, y = i * 5.9;
      if (blendNoise(x, y, 42, 15) === blendNoise(x, y, 43, 15)) same++;
    }
    expect(same).toBe(0);
    // …and so do the clumps they throw, which is what the ground bakes.
    const a = blendClumps(FLAT_EDGE, 1, CFG(44), 42);
    const b = blendClumps(FLAT_EDGE, 1, CFG(44), 43);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length === b.length && a.every((v, i) => v === b[i])).toBe(false);
  });

  it("thresholds the noise against the distance to the material edge", () => {
    const cfg = CFG(48);
    expect(blendCoverage(0.5, 0, cfg)).toBe(1);          // solid at the seam
    expect(blendCoverage(0.99, 48, cfg)).toBe(0);        // nothing past the band
    expect(blendCoverage(0.0, 24, cfg)).toBe(0);         // a low patch dies early
    // monotone: the further in, the less of the incoming material
    let prev = blendCoverage(0.7, 0, cfg);
    for (let d = 4; d <= 48; d += 4) {
      const now = blendCoverage(0.7, d, cfg);
      expect(now).toBeLessThanOrEqual(prev);
      prev = now;
    }
  });

  it("collapses to the old hard edge at width 0", () => {
    const cfg = CFG(0);
    expect(blendCoverage(0.9, -1, cfg)).toBe(1);
    expect(blendCoverage(0.9, 0.5, cfg)).toBe(0);
    expect(blendClumps(FLAT_EDGE, 1, cfg, 42)).toHaveLength(0);
    expect(blendClumps(FLAT_EDGE, -1, cfg, 42)).toHaveLength(0);
  });
});

describe("ART-2 the clumps", () => {
  it("stays inside the configured band, and the band follows the config", () => {
    const reach = (widthPx: number) => {
      const cfg = CFG(widthPx);
      const clumps = blendClumps(FLAT_EDGE, 1, cfg, 42);
      expect(clumps.length).toBeGreaterThan(0);
      let far = 0, near = Infinity;
      for (let i = 0; i < clumps.length; i += BLEND_STRIDE) {
        const d = Math.abs(clumps[i + 1]);                 // the edge is y = 0
        far = Math.max(far, d); near = Math.min(near, d);
      }
      return { far, near, count: clumpCount(Float32Array.from(clumps)) };
    };
    const narrow = reach(24), wide = reach(64);
    // A clump's CENTRE never passes the band; only its radius may hang over.
    expect(narrow.far).toBeLessThanOrEqual(24);
    expect(wide.far).toBeLessThanOrEqual(64);
    // …and a wider config really does reach further and throw more clumps.
    expect(wide.far).toBeGreaterThan(narrow.far * 1.8);
    expect(wide.count).toBeGreaterThan(narrow.count);
    expect(narrow.near).toBeLessThan(6);                   // solid at the seam
  });

  it("clumps into patches instead of an even dust", () => {
    // The point of a noise threshold: surviving points arrive in runs, so
    // their discs merge into patches. A checkerboard would leave almost no
    // clump with a neighbour inside one cell of it.
    const cfg = CFG(44, 15);
    const clumps = blendClumps(FLAT_EDGE, 1, cfg, 42);
    const pts: [number, number][] = [];
    for (let i = 0; i < clumps.length; i += BLEND_STRIDE) pts.push([clumps[i], clumps[i + 1]]);
    expect(pts.length).toBeGreaterThan(200);
    let paired = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < 15 * 1.2) { paired++; break; }
      }
    }
    expect(paired / pts.length).toBeGreaterThan(0.5);
  });
});

describe("ART-2 baking the blend into the ground chunks", () => {
  it("bakes the SAME clumps for the strip two chunks share", () => {
    const grid = generateMap(42);
    // A chunk pair where BOTH halves carry enough coast to be worth comparing.
    let pair: [number, number] | null = null;
    for (let cy = 0; cy * CHUNK < grid.h && !pair; cy++) {
      for (let cx = 0; (cx + 1) * CHUNK < grid.w; cx++) {
        if (howMuch(grid, cx, cy) > 400 && howMuch(grid, cx + 1, cy) > 400) { pair = [cx, cy]; break; }
      }
    }
    expect(pair, "seed 42 has a coast").not.toBeNull();
    const [cx, cy] = pair!;
    const a = paintChunk(grid, cx, cy);
    const b = paintChunk(grid, cx + 1, cy);
    // The strip both chunks bake: blocks `cx` and `cx+1`, minus a margin wide
    // enough to keep out the clumps only one of them can have generated.
    const inStrip = (keys: string[]) => keys.filter((k) => {
      const [wx, wy] = k.split(",").map(Number);
      const u = tileU(wx, wy);
      return u > cx * CHUNK + 2 && u < (cx + 2) * CHUNK - 2;
    });
    const left = inStrip(clumpsFrom(a.ops, a.ox, a.oy, 1));
    const right = inStrip(clumpsFrom(b.ops, b.ox, b.oy, 1));
    expect(left.length).toBeGreaterThan(50);
    // Every clump the left chunk baked for the shared strip is bit-identical to
    // the right chunk's, so the two clipped halves of the join are one clump.
    expect(left).toEqual(right);
  });

  it("bakes one clump field per chunk and reuses it at every detail tier", () => {
    const grid = generateMap(42);
    const [cx, cy] = coastalChunk(grid);
    const range: Range = [cx * CHUNK, cy * CHUNK, cx * CHUNK + 7, cy * CHUNK + 7];
    invalidateGroundBlend(grid);            // cold: the search above warmed it
    let gathers = 0;
    const edges = () => { gathers++; return blendEdgesFor(grid, ...range); };
    const first = blendClumpSetsFor(grid, range, edges);
    expect(gathers).toBe(1);
    // Same range again — a cache hit, and the edges are not walked a second time.
    expect(blendClumpSetsFor(grid, range, edges)).toBe(first);
    expect(gathers).toBe(1);

    // @2x, @1x and @0.5× are the same field re-projected, not three bakes.
    const tiers = [2, 1, 0.5].map((z) => {
      const p = paintChunk(grid, cx, cy, z);
      return clumpsFrom(p.ops, p.ox, p.oy, z);
    });
    expect(tiers[0].length).toBeGreaterThan(0);
    expect(tiers[1]).toEqual(tiers[0]);
    expect(tiers[2]).toEqual(tiers[0]);
    expect(gathers).toBe(1);
  });

  it("paints exactly today's ground when every band is 0 wide", () => {
    const grid = generateMap(1337, { rivers: true });
    const [cx, cy] = coastalChunk(grid);
    const on = paintChunk(grid, cx, cy);
    GROUND_BLEND.sandGrass.widthPx = 0;
    GROUND_BLEND.waterSand.widthPx = 0;
    GROUND_BLEND.waterGrass.widthPx = 0;
    const off = paintChunk(grid, cx, cy);
    // No clumps at all: nothing the dither would have added is on the surface.
    expect(clumpsFrom(on.ops, on.ox, on.oy, 1).length).toBeGreaterThan(0);
    expect(clumpsFrom(off.ops, off.ox, off.oy, 1)).toHaveLength(0);
    // …and what is left is the pre-#382 paint: sand fill, grass fill, the
    // three-stroke grass feather over the inland contour, then the river.
    const fills = off.ops.filter((o) => o.kind === "fill");
    expect(fills[0].style).toBe("#ff0");
    expect(fills[1].style).toBe("#0f0");
    expect(fills.every((f) => f.alpha === 1)).toBe(true);
    const strokes = off.ops.filter((o) => o.kind === "stroke");
    const feather = strokes.filter((s) => s.style === "#0f0");
    expect(feather.map((s) => s.alpha)).toEqual([0.12, 0.2, 0.28]);
    expect(feather.every((s) => s.width > 0)).toBe(true);
    // and nothing else: two fills and three strokes is the whole flat paint
    expect(fills).toHaveLength(2);
    expect(strokes).toHaveLength(3);
  });

  it("keeps the sand/grass seam off shores that have no beach", () => {
    const grid = generateMap(1337, { rivers: true });
    const seen = { sandGrass: 0, waterSand: 0, waterGrass: 0 };
    for (let cy = 0; cy * CHUNK < grid.h; cy += 2) {
      for (let cx = 0; cx * CHUNK < grid.w; cx += 2) {
        const e = blendEdgesFor(grid, cx * CHUNK, cy * CHUNK, cx * CHUNK + 7, cy * CHUNK + 7);
        seen.sandGrass += e.sandGrass.length;
        seen.waterSand += e.waterSand.length;
        seen.waterGrass += e.waterGrass.length;
      }
    }
    expect(seen.sandGrass).toBeGreaterThan(0);
    expect(seen.waterSand).toBeGreaterThan(0);
    // Rivers (#260) are water beside grass, so they land in the no-beach edge.
    expect(seen.waterGrass).toBeGreaterThan(0);
    // …and every seam edge really does have sand on one side of it. The traced
    // coast is smoothed, so the probe walks outward exactly the way the
    // painter's own classifier does.
    const e = blendEdgesFor(grid, 0, 0, grid.w - 1, grid.h - 1);
    expect(e.sandGrass.length).toBeGreaterThan(0);
    const at = (wx: number, wy: number) => {
      const a = wx / HW, b = wy / HH;
      const tx = Math.floor((a + b) / 2), ty = Math.floor((b - a) / 2);
      return tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h ? -1 : grid.terrain[ty * grid.w + tx];
    };
    for (const s of e.sandGrass.slice(0, 400)) {
      const mx = (s.ax + s.bx) / 2, my = (s.ay + s.by) / 2;
      let soft = -1, hard = -1;
      for (const d of [4, 9, 16, 26, 40]) {
        const p = at(mx + s.nx * d, my + s.ny * d), n = at(mx - s.nx * d, my - s.ny * d);
        if (p !== n && p >= 0 && n >= 0 && (p === SAND) !== (n === SAND)) { soft = p; hard = n; break; }
      }
      expect(soft === SAND || hard === SAND, `seam at ${mx},${my}: ${soft}/${hard}`).toBe(true);
      expect(soft === WATER || hard === WATER).toBe(false);
    }
  });

  it("drapes the blend with the raised ground when elevation is on", () => {
    const grid = generateMap(42, { elevation: true });
    const [cx, cy] = coastalChunk(grid);
    const painted = paintChunk(grid, cx, cy);
    expect(clumpsFrom(painted.ops, painted.ox, painted.oy, 1).length).toBeGreaterThan(0);
    // The first two fills are still the two materials the hillshade test reads.
    const fills = painted.ops.filter((o) => o.kind === "fill");
    expect(fills[0].style).toBe("#ff0");
    expect(fills[1].style).toBe("#0f0");
    // Every translucent fill after them is still a quantised hillshade bucket:
    // the dither paints at alpha 1 with its alpha in the colour.
    for (const f of fills.slice(2)) {
      expect(f.alpha === 1 || f.style === "#fff6dc" || f.style === "#16240f",
        `fill ${f.style} @ ${f.alpha}`).toBe(true);
    }
  });

  it("is deterministic for the same seed — host and guest agree", () => {
    const host = generateMap(1337, { rivers: true });
    const guest = generateMap(1337, { rivers: true });
    const [cx, cy] = coastalChunk(host);
    const range: Range = [cx * CHUNK, cy * CHUNK, cx * CHUNK + 7, cy * CHUNK + 7];
    expect(howMuch(host, cx, cy)).toBeGreaterThan(0);
    const edges = (g: Grid) => blendEdgesFor(g, ...range);
    const a = blendClumpSetsFor(host, range, () => edges(host));
    const b = blendClumpSetsFor(guest, range, () => edges(guest));
    for (const kind of ["sandGrass", "waterSand", "waterGrass"] as const) {
      expect(Array.from(a[kind].softSide)).toEqual(Array.from(b[kind].softSide));
      expect(Array.from(a[kind].hardSide)).toEqual(Array.from(b[kind].hardSide));
      expect(Array.from(a[kind].foam)).toEqual(Array.from(b[kind].foam));
    }
  });
});

describe("ART-2 the DEV tuning override", () => {
  it("parses ?groundBlend=<width>,<scale>,<contrast>", () => {
    expect(parseGroundBlend("?groundBlend=64,20,1.5")).toEqual({ widthPx: 64, noiseScale: 20, contrast: 1.5 });
    expect(parseGroundBlend("/?seed=7&groundBlend=32")).toEqual({
      widthPx: 32,
      noiseScale: GROUND_BLEND_DEFAULTS.sandGrass.noiseScale,
      contrast: GROUND_BLEND_DEFAULTS.sandGrass.contrast,
    });
    expect(parseGroundBlend("?groundBlend=0")).toEqual({
      widthPx: 0,
      noiseScale: GROUND_BLEND_DEFAULTS.sandGrass.noiseScale,
      contrast: GROUND_BLEND_DEFAULTS.sandGrass.contrast,
    });
    expect(parseGroundBlend("?groundBlend=abc")).toBeNull();
    expect(parseGroundBlend("?groundBlend=-4")).toBeNull();
    expect(parseGroundBlend("?seed=7")).toBeNull();
    expect(parseGroundBlend("")).toBeNull();
  });

  it("applies to all three edges in DEV and leaves the defaults alone otherwise", () => {
    applyGroundBlendSearch("?groundBlend=58,11,2");
    expect(GROUND_BLEND.sandGrass.widthPx).toBe(58);
    expect(GROUND_BLEND.waterSand.noiseScale).toBe(11);
    expect(GROUND_BLEND.waterGrass.contrast).toBe(2);
    resetGroundBlend();
    expect(GROUND_BLEND).toEqual(GROUND_BLEND_DEFAULTS);
  });

  it("re-bakes when the tuning moves", () => {
    const grid = generateMap(42);
    const [cx, cy] = coastalChunk(grid);
    const range: Range = [cx * CHUNK, cy * CHUNK, cx * CHUNK + 7, cy * CHUNK + 7];
    const edges = () => blendEdgesFor(grid, ...range);
    const before = blendClumpSetsFor(grid, range, edges);
    applyGroundBlendSearch("?groundBlend=20,15,1.15");
    const after = blendClumpSetsFor(grid, range, edges);
    expect(after).not.toBe(before);
    expect(after.sandGrass.softSide.length).not.toBe(before.sandGrass.softSide.length);
    resetGroundBlend();
    const restored = blendClumpSetsFor(grid, range, edges);
    expect(Array.from(restored.sandGrass.softSide)).toEqual(Array.from(before.sandGrass.softSide));
  });
});

// ── software preview (PREVIEW_BLEND=1) ─────────────────────────────────────
// CI sandboxes have no Chromium and this ticket forbids Playwright, so the
// before/after shots in the PR come from here: the SAME contours, the SAME
// clump fields and the SAME layer order the renderer paints, rasterised with
// sharp over the real seamless textures — no browser needed.
//
//   PREVIEW_BLEND=1 npx vitest run tests/unit/iso-ground-blend.test.ts
//   PREVIEW_SEED=1337 PREVIEW_CX=72 PREVIEW_CY=72 PREVIEW_TILES=16 \
//   PREVIEW_RIVERS=1 PREVIEW_BLEND_OFF=1 …
//
// Writes test-results/blend-{before,after}-<seed>-<cx>,<cy>@<zoom>.png.
if (process.env.PREVIEW_BLEND === "1") {
  /* eslint-disable no-console */
  const SEED = Number(process.env.PREVIEW_SEED ?? 1337);
  const CX = Number(process.env.PREVIEW_CX ?? 72);
  const CY = Number(process.env.PREVIEW_CY ?? 72);
  const TILES = Number(process.env.PREVIEW_TILES ?? 16);
  const RIVERS = process.env.PREVIEW_RIVERS === "1";
  const LAND_SCALE = 0.2, SEA_SCALE = 0.16;   // the renderer's texture grain
  const TEX = 512;

  describe("ART-2 software preview", () => {
    for (const z of [2, 1, 0.5]) {
      for (const off of [true, false]) {
        it(`rasterises the ${off ? "before" : "after"} at ${z}x`, async () => {
          if (!off) resetGroundBlend();
          else {
            GROUND_BLEND.sandGrass.widthPx = 0;
            GROUND_BLEND.waterSand.widthPx = 0;
            GROUND_BLEND.waterGrass.widthPx = 0;
          }
          const grid = generateMap(SEED, { rivers: RIVERS });
          const tx0 = CX - TILES / 2, ty0 = CY - TILES / 2;
          const tx1 = CX + TILES / 2, ty1 = CY + TILES / 2;
          const pts = [[tx0, ty0], [tx1, ty0], [tx1, ty1], [tx0, ty1]].map(([u, v]) => tileToScreen(u, v));
          const minx = Math.min(...pts.map((p) => p[0])), maxx = Math.max(...pts.map((p) => p[0]));
          const miny = Math.min(...pts.map((p) => p[1])), maxy = Math.max(...pts.map((p) => p[1]));
          const W = Math.ceil((maxx - minx) * z), H = Math.ceil((maxy - miny) * z);
          const project = (wx: number, wy: number): [number, number] => [(wx - minx) * z, (wy - miny) * z];

          // One seamless texture, tiled across the image and anchored on world
          // (0,0) exactly the way the chunk patterns are.
          const tileFill = async (src: string, k: number): Promise<Buffer> => {
            const P = Math.max(1, Math.round(TEX * k * z));
            let cur = await sharp(src).resize(P, P).png().toBuffer();
            let cw = P, ch = P;
            while (cw < W + 2 * P || ch < H + 2 * P) {
              const nw = Math.min(W + 2 * P, cw << 1), nh = Math.min(H + 2 * P, ch << 1);
              const stamps: { input: Buffer; left: number; top: number }[] = [];
              for (let y = 0; y < nh; y += ch) for (let x = 0; x < nw; x += cw) stamps.push({ input: cur, left: x, top: y });
              cur = await sharp({ create: { width: nw, height: nh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
                .composite(stamps).png().toBuffer();
              cw = nw; ch = nh;
            }
            const mod = (v: number, p: number) => ((v % p) + p) % p;
            return sharp(cur).extract({
              left: Math.round(P - mod(-minx * z, P)), top: Math.round(P - mod(-miny * z, P)),
              width: W, height: H,
            }).png().toBuffer();
          };

          const svg = (body: string) =>
            `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`;
          const polyPath = (loops: [number, number][][]) => loops.map((loop) => {
            const p = loop.map(([x, y]) => project(x, y));
            return `M${p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}Z`;
          }).join("");
          /** One <path> per clump layer, at radius × k — the shape the paint paths. */
          const clumpPath = (c: Float32Array, k: number) => {
            let d = "";
            for (let i = 0; i < c.length; i += BLEND_STRIDE) {
              const [px, py] = project(c[i], c[i + 1]);
              const r = c[i + 2] * k * z;
              if (r < 0.4) continue;
              for (let v = 0; v < 8; v++) {
                const a = (v / 8) * Math.PI * 2;
                d += `${v ? "L" : "M"}${(px + Math.cos(a) * r).toFixed(1)},${(py + Math.sin(a) * r).toFixed(1)}`;
              }
              d += "Z";
            }
            return d;
          };
          const maskBuf = (d: string) =>
            sharp(Buffer.from(svg(`<path d="${d}" fill="#fff"/>`))).png().toBuffer();
          const washBuf = (d: string, fill: string) =>
            sharp(Buffer.from(svg(`<path d="${d}" fill="${fill}"/>`))).png().toBuffer();
          const clip = async (tex: Buffer, mask: Buffer) =>
            sharp(tex).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();

          const range: Range = [Math.floor(tx0), Math.floor(ty0), Math.ceil(tx1) - 1, Math.ceil(ty1) - 1];
          const sets = blendClumpSetsFor(grid, range, () => blendEdgesFor(grid, ...range));
          const coast = groundContours(grid);
          const inView = (loop: [number, number][]) => {
            const xs = loop.map((p) => p[0]), ys = loop.map((p) => p[1]);
            return Math.max(...xs) > minx - 4 && Math.min(...xs) < maxx + 4
              && Math.max(...ys) > miny - 4 && Math.min(...ys) < maxy + 4;
          };
          const land = coast.land.filter(inView), inland = coast.inland.filter(inView);

          const [waterTex, sandTex, grassTex] = await Promise.all([
            tileFill("assets/ground/water.png", SEA_SCALE),
            tileFill("assets/ground/sand.png", LAND_SCALE),
            tileFill("assets/ground/grass.png", LAND_SCALE),
          ]);

          // The paint's own order: sand under the island, grass over the inland
          // mask, then the dither — halo, texture, tide, foam.
          const layers: { input: Buffer; blend?: keyof typeof sharp.prototype }[] = [];
          const pushTex = async (tex: Buffer, c: Float32Array, k: number) => {
            if (c.length === 0) return;
            layers.push({ input: await clip(tex, await maskBuf(clumpPath(c, k))) });
          };
          const pushWash = async (c: Float32Array, k: number, fill: string) => {
            if (c.length === 0) return;
            layers.push({ input: await washBuf(clumpPath(c, k), fill) });
          };
          layers.push({ input: await clip(sandTex, await maskBuf(polyPath(land))) });
          layers.push({ input: await clip(grassTex, await maskBuf(polyPath(inland))) });
          const seam = sets.sandGrass;
          await pushWash(seam.softSide, BLEND_SOFT_K, BLEND_WASH.grass);
          await pushTex(grassTex, seam.softSide, BLEND_SOLID_K);
          await pushWash(seam.hardSide, BLEND_SOFT_K, BLEND_WASH.sand);
          await pushTex(sandTex, seam.hardSide, BLEND_SOLID_K);
          for (const [kind, tex, wet] of [
            ["waterSand", sandTex, BLEND_WASH.wetSand],
            ["waterGrass", grassTex, BLEND_WASH.wetGrass],
          ] as const) {
            const s = sets[kind];
            await pushWash(s.softSide, BLEND_SOFT_K * 1.25, BLEND_WASH.shallow);
            await pushTex(tex, s.softSide, BLEND_SOLID_K);
            await pushWash(s.hardSide, BLEND_SOFT_K, wet);
            await pushWash(s.foam, BLEND_SOLID_K, BLEND_WASH.foam);
          }
          const out = `test-results/blend-${off ? "before" : "after"}-${SEED}-${CX},${CY}@${z}.png`;
          await sharp(waterTex).composite(layers as never).png().toFile(out);
          const clumps = (["sandGrass", "waterSand", "waterGrass"] as const)
            .reduce((n, k) => n + clumpCount(sets[k].softSide) + clumpCount(sets[k].hardSide)
              + clumpCount(sets[k].foam), 0);
          console.log(`[art-2] ${out} — ${W}×${H}, ${clumps} clumps`);
          expect(true).toBe(true);
        }, 240_000);
      }
    }
  });
}
