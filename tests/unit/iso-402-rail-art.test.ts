// ══════════════════════════════════════════════════════════════════════════
// ART-4 (#402) — the smaller railway: the cross-section, the gravel, the tiers.
//
// The ticket's acceptance is visual ("reads clearly narrower than a paved
// road"), so what can be pinned without a browser is pinned here:
//
//   • THE CROSS-SECTION is inside the spec's band and narrower than a road —
//     and the sleepers and the light margin fit inside the bed, which is what
//     keeps a bend's sleeper in its own tile and a bridge's deck wider than the
//     track that crosses it;
//   • THE GRAVEL is deterministic, seamless (its wrap is no worse than its
//     interior), grey-brown, and its pebbles wrap with it;
//   • THE TIERS follow the camera zoom, capped by the quality preset, and the
//     far one draws ONE two-tone line instead of two rails;
//   • THE PAINTERS stay batched: a chunk's rail pass costs the same handful of
//     canvas calls for one tile as for forty (the rail-cache suite's promise,
//     re-checked at the seam the new passes were added to);
//   • THE LIT EDGE is up-left of the steel ON SCREEN, offset by a CONSTANT
//     ground vector — which is what keeps it continuous across a tile port.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { HH, HW, MAP_H, MAP_W } from "../../src/game/config";
import { ROAD_WIDTH } from "../../src/iso/road-geometry";
import { BRIDGE_DECK_HALF } from "../../src/iso/bridge-renderer";
import {
  RAIL_BED_SHOULDER, RAIL_BED_WIDTH, RAIL_GAUGE, RAIL_STOP_LENGTH, RAIL_STOP_WIDTH,
  RAIL_WEB_WIDTH, RAIL_WIDTH, TIE_LENGTH, TIE_WIDTH, railTile, type RailTile,
} from "../../src/iso/rail-geometry";
import {
  DEFAULT_RAIL_STYLE, GRAVEL_REPEAT, GRAVEL_TEXTURE_SIZE, RAIL_BALLAST_TEXTURE,
  RAIL_FAR_BED_WIDTH, RAIL_FAR_RAIL_WIDTH, RAIL_LIT_ALPHA, RAIL_LIT_OFFSET, RAIL_LIT_WIDTH,
  contextZoom, gravelPebbleCopies, gravelPebbles, gravelRaster, paintRailTiles,
  railBallastPattern, railDetailFor, railDetailForZoom, tiesFor,
  type GravelPebble, type RailDetail,
} from "../../src/iso/rail-renderer";
import { PRESENT } from "../../src/iso/track";

/** NE | SW: a straight run along the v axis. */
const STRAIGHT = 0b1 | 0b1000;

/** One tile of rail, as `railTilesIn` builds it — connected to nothing beyond. */
function tile(tx: number, ty: number, mask = STRAIGHT): RailTile {
  const cell = PRESENT | mask;
  return railTile(tx, ty, cell, (x, y) => (x === tx && y === ty ? cell : 0), 0, 0);
}

const tilesIn = (specs: readonly (readonly [number, number, number])[]): RailTile[] =>
  specs.map(([x, y, mask]) => tile(x, y, mask));

/** The game's one projection, in ground units — what the screen sees. */
const screen = ([u, v]: readonly [number, number]): [number, number] => [
  (u - v) * HW, (u + v) * HH,
];

const shift = (
  path: readonly (readonly [number, number])[], times = 1,
): [number, number][] => path.map(([u, v]) => [
  u + RAIL_LIT_OFFSET[0] * times, v + RAIL_LIT_OFFSET[1] * times,
]);

// ── the recording context ───────────────────────────────────────────────────
interface Op {
  kind: "stroke" | "fill";
  style: unknown;
  width: number;
  alpha: number;
  /** The path's subpaths, in the context's own (ground) coordinates. */
  subs: [number, number][][];
}

/**
 * A 2D context that records what was painted instead of painting, so the passes
 * (their order, their styles, their widths and their path counts) can be
 * asserted without a canvas. `getTransform` answers the zoom's own matrix —
 * exactly the one `RoadCache` sets before it paints — so the tier the painter
 * picks is the tier the game's cache would get.
 */
function recorder(zoom: number | null = 2, canPattern = true) {
  const ops: Op[] = [];
  const stack: Record<string, unknown>[] = [];
  let path: [number, number][][] = [];
  const pattern = {
    scale: undefined as number | undefined,
    // `m11` is the stub matrix's own spelling of DOMMatrix's `a` alias.
    setTransform(m: DOMMatrix) { pattern.scale = (m as unknown as { m11?: number }).m11 ?? m.a; },
  };
  const ctx = {
    lineWidth: 1, globalAlpha: 1, lineCap: "butt", lineJoin: "miter", lineDashOffset: 0,
    strokeStyle: "#000" as unknown, fillStyle: "#000" as unknown,
    save() {
      stack.push({
        lineWidth: ctx.lineWidth, globalAlpha: ctx.globalAlpha, lineCap: ctx.lineCap,
        lineJoin: ctx.lineJoin, strokeStyle: ctx.strokeStyle, fillStyle: ctx.fillStyle,
      });
    },
    restore() { Object.assign(ctx, stack.pop() ?? {}); },
    beginPath() { path = []; },
    moveTo(x: number, y: number) { path.push([[x, y]]); },
    lineTo(x: number, y: number) { path[path.length - 1].push([x, y]); },
    closePath() { /* the closing segment only matters to a filling backend */ },
    setTransform() { /* the matrix lives in getTransform, below */ },
    setLineDash() { /* the preview does not carry dash phases */ },
    getTransform: zoom === null
      ? undefined
      : () => ({ a: HW * zoom, b: HH * zoom, c: -HW * zoom, d: HH * zoom, e: 0, f: 0 }),
    // `canPattern: false` is the rail-cache suite's stub: a context whose
    // `createPattern` answers null, so the flat fallbacks are exercised.
    createPattern: () => (canPattern ? pattern : null),
    stroke() {
      ops.push({ kind: "stroke", style: ctx.strokeStyle, width: ctx.lineWidth, alpha: ctx.globalAlpha, subs: path.map((s) => s.slice()) });
    },
    fill() {
      ops.push({ kind: "fill", style: ctx.fillStyle, width: ctx.lineWidth, alpha: ctx.globalAlpha, subs: path.map((s) => s.slice()) });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops, pattern };
}

const strokeWidth = (ops: readonly Op[], width: number): Op[] =>
  ops.filter((o) => o.kind === "stroke" && o.width === width);

describe("ART-4 the cross-section", () => {
  it("draws the ballast inside the spec's band, and narrower than a road", () => {
    // A tile is one ground unit across, so the bed's width in tile units IS the
    // fraction of a tile's width the ticket asks for.
    expect(RAIL_BED_WIDTH).toBeGreaterThanOrEqual(0.40);
    expect(RAIL_BED_WIDTH).toBeLessThanOrEqual(0.45);
    // The reference the ticket names: the rail reads narrower than a paved road,
    // bed AND margin together.
    const railFull = RAIL_BED_WIDTH + RAIL_BED_SHOULDER * 2;
    expect(railFull).toBeLessThan(ROAD_WIDTH.paved);
    expect(railFull / ROAD_WIDTH.paved).toBeLessThan(0.7);
  });

  it("keeps the sleepers and the margin inside the bed, and the deck over both", () => {
    expect(TIE_LENGTH).toBeLessThan(RAIL_BED_WIDTH);
    expect(TIE_WIDTH).toBeLessThan(TIE_LENGTH);
    // A bend's sleeper is centred on the tile centre, so half of it must still
    // fit inside the tile that carries the bend.
    expect(TIE_LENGTH / 2).toBeLessThan(0.5);
    // R2 (#266): a bridge's deck is wider than the widest thing that rides it.
    expect(RAIL_BED_WIDTH / 2 + RAIL_BED_SHOULDER).toBeLessThan(BRIDGE_DECK_HALF);
    // The steel is a hairline, not a stripe: a thin line inside a thin web, and
    // far thinner than the bed it sits on.
    expect(RAIL_WIDTH).toBeLessThan(RAIL_WEB_WIDTH);
    expect(RAIL_WIDTH * 2).toBeLessThan(RAIL_BED_WIDTH / 4);
    expect(RAIL_LIT_WIDTH).toBeLessThan(RAIL_WIDTH / 3);
    // The buffer stop's beam spans the track it ends, and no more.
    expect(RAIL_STOP_LENGTH).toBeGreaterThan(RAIL_GAUGE + RAIL_WIDTH);
    expect(RAIL_STOP_LENGTH).toBeLessThan(RAIL_BED_WIDTH);
    expect(RAIL_STOP_WIDTH).toBeLessThan(TIE_WIDTH * 1.5);
  });
});

describe("ART-4 the generated gravel", () => {
  const size = GRAVEL_TEXTURE_SIZE;
  const rgba = (px: Uint8ClampedArray, x: number, y: number): number[] => {
    const i = (y * size + x) * 4;
    return [px[i], px[i + 1], px[i + 2], px[i + 3]];
  };
  /** Mean |Δ| between the pixels a walk pairs up. */
  const meanDelta = (px: Uint8ClampedArray, along: (i: number) => [number[], number[]]): number => {
    let sum = 0, n = 0;
    for (let i = 0; i < size; i++) {
      const [a, b] = along(i);
      for (let c = 0; c < 3; c++) { sum += Math.abs(a[c] - b[c]); n++; }
    }
    return sum / n;
  };

  it("is deterministic, opaque and grey-brown", () => {
    const a = gravelRaster(), b = gravelRaster();
    expect(a).toEqual(b);
    expect(a.length).toBe(size * size * 4);
    for (const [x, y] of [[0, 0], [7, 31], [64, 64], [size - 1, size - 1]] as const) {
      const [r, g, bl, al] = rgba(a, x, y);
      expect(al).toBe(255);
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(bl);
    }
    let r = 0, g = 0, bl = 0;
    for (let i = 0; i < a.length; i += 4) { r += a[i]; g += a[i + 1]; bl += a[i + 2]; }
    const n = size * size;
    // Mid-light, warm and desaturated: gravel, not asphalt and not bare earth.
    expect(r / n).toBeGreaterThan(85);
    expect(r / n).toBeLessThan(155);
    expect(r / n - bl / n).toBeGreaterThan(8);
    expect(r / n - bl / n).toBeLessThan(60);
    expect(bl / n).toBeLessThan(g / n);
  });

  it("is seamless: the wrap is no worse than the texture's own grain", () => {
    const px = gravelRaster();
    const wrapX = meanDelta(px, (y) => [rgba(px, size - 1, y), rgba(px, 0, y)]);
    const wrapY = meanDelta(px, (x) => [rgba(px, x, size - 1), rgba(px, x, 0)]);
    const innerX = meanDelta(px, (y) => [rgba(px, 0, y), rgba(px, 1, y)]);
    const innerY = meanDelta(px, (x) => [rgba(px, x, 0), rgba(px, x, 1)]);
    // The metric `tools/make-road-textures.mjs` refuses a swatch for.
    expect(wrapX).toBeLessThan(innerX * 2);
    expect(wrapY).toBeLessThan(innerY * 2);
    // A seam would show as a wrap far rougher than the grain, so pin that the
    // texture HAS grain to compare against.
    expect(innerX).toBeGreaterThan(0.5);
    expect(innerY).toBeGreaterThan(0.5);
  });

  it("draws every pebble that reaches over an edge again on the far side", () => {
    const pebbles: GravelPebble[] = gravelPebbles();
    expect(pebbles.length).toBeGreaterThan(50);
    expect(pebbles).toEqual(gravelPebbles());                 // deterministic
    for (const p of pebbles) {
      expect(p.rx).toBeLessThanOrEqual(6);
      expect(p.tone).toBeGreaterThanOrEqual(0);
      expect(p.tone).toBeLessThanOrEqual(1);
      const copies = gravelPebbleCopies(p);
      expect(copies.length).toBeGreaterThanOrEqual(1);
      // Any copy that exists is a whole swatch away, in x, in y or both: that
      // is what makes the pebble layer tile, not just the noise under it.
      for (const [x, y] of copies) {
        expect(Math.abs(x - p.x) % size).toBeCloseTo(0, 9);
        expect(Math.abs(y - p.y) % size).toBeCloseTo(0, 9);
      }
      // A pebble whose body hangs over an edge is drawn again on the far side.
      const overhang = p.x - p.rx < 0 || p.y - p.ry < 0
        || p.x + p.rx > size || p.y + p.ry > size;
      if (overhang) expect(copies.length).toBeGreaterThan(1);
    }
  });

  it("names the painted swatch the lead can drop in, and the pattern it feeds", () => {
    // The one hole the painted file needs plugged: a setter on the cache and a
    // boot load in game.ts (both outside this ticket's files — see the PR).
    expect(RAIL_BALLAST_TEXTURE.file).toBe("assets/railway/ballast.webp");
    expect(RAIL_BALLAST_TEXTURE.size).toBe(256);
    expect(RAIL_BALLAST_TEXTURE.repeat).toBe(GRAVEL_REPEAT);
    // The generated swatch stands in whenever no painted one is installed.
    expect(DEFAULT_RAIL_STYLE.ballast).toBeNull();
    // The pattern is bound to the context and scaled so ONE repeat spans
    // `repeat` tile units across the image whatever the image's own size: a
    // 256 px painted file and the 128 px generated one cover the same ground.
    const r = recorder();
    const style = { ...DEFAULT_RAIL_STYLE, ballast: { width: 256, height: 256 } };
    expect(railBallastPattern(r.ctx, style)).not.toBeNull();
    expect(r.pattern.scale).toBeCloseTo(GRAVEL_REPEAT / 256, 9);
    // The generated swatch spans the same ground at its own, smaller size.
    const generated = { ...style, ballast: { width: GRAVEL_TEXTURE_SIZE, height: GRAVEL_TEXTURE_SIZE } };
    const g = recorder();
    railBallastPattern(g.ctx, generated);
    expect(g.pattern.scale).toBeCloseTo(GRAVEL_REPEAT / GRAVEL_TEXTURE_SIZE, 9);
    // …and against a context that cannot take one: null, not a throw — the
    // painter falls back to the flat bed colour (the rail-cache stub does this).
    const bare = { ...recorder().ctx, createPattern: () => null } as unknown as CanvasRenderingContext2D;
    expect(railBallastPattern(bare, style)).toBeNull();
  });
});

describe("ART-4 the detail tiers follow the zoom", () => {
  const base = railDetailFor(2);              // a full-quality boot

  it("keeps the closest zoom at full detail and thins the two below it", () => {
    const close = railDetailForZoom(base, 2);
    expect(close.key).toBe("high");
    expect(close.bed && close.gravel && close.ties && close.railPair && close.lit).toBe(true);

    const middle = railDetailForZoom(base, 1);
    expect(middle.key).toBe("medium");
    expect(middle.bed && middle.gravel && middle.railPair).toBe(true);
    expect(middle.lit).toBe(false);            // the closest zoom's extra only
    expect(middle.boards).toBe(false);         // …and one slab, not three boards

    const far = railDetailForZoom(base, 0.5);
    expect(far.key).toBe("low");
    expect(far.bed).toBe(false);
    expect(far.ties).toBe(false);
    expect(far.railPair).toBe(false);          // ONE two-tone line, not two rails
  });

  it("never UPGRADES what the quality preset allows", () => {
    // Low quality at the closest zoom stays low; the zoom can only take detail
    // away, so a performance boot never pays for the full bed.
    expect(railDetailForZoom(railDetailFor(0.5), 2).key).toBe("low");
    expect(railDetailForZoom(railDetailFor(1), 2).key).toBe("medium");
    expect(railDetailForZoom(railDetailFor(1), 0.5).key).toBe("low");
    // …and the identity: a tier the zoom does not limit is handed straight back.
    expect(railDetailForZoom(base, 2)).toBe(base);
  });
});

describe("ART-4 what one chunk's rail pass costs", () => {
  const one = tilesIn([[10, 10, STRAIGHT]]);
  const many = tilesIn(Array.from({ length: 40 }, (_, i) =>
    [4 + (i % 8), 4 + Math.floor(i / 8), STRAIGHT] as const));

  const paint = (zoom: number, tiles = one, detail: RailDetail = railDetailFor(2)) => {
    const r = recorder(zoom);
    paintRailTiles(r.ctx, tiles, detail);
    return r;
  };
  const bed = (ops: readonly Op[]) => strokeWidth(ops, RAIL_BED_WIDTH)[0];

  it("costs the same handful of calls for 40 tiles as for one", () => {
    const a = paint(2, one);
    const b = paint(2, many);
    expect(a.ops.length).toBeGreaterThan(4);
    expect(b.ops.length).toBe(a.ops.length);
    // And the geometry really did grow: the bed is one batched pass over all of
    // it, not one pass per tile.
    expect(bed(b.ops).subs.length).toBeGreaterThan(bed(a.ops).subs.length);
  });

  it("strokes the gravel bed once, with the pattern, at the cross-section's width", () => {
    // A painted swatch installed, so the pattern path is the one in play: node
    // has no canvas, and the generated gravel is what a browser falls back to.
    const painted = { ...DEFAULT_RAIL_STYLE, ballast: { width: 128, height: 128 } };
    const r = recorder(2);
    paintRailTiles(r.ctx, one, railDetailFor(2), painted);
    // save · margin · bed · planks(fill) · ties · web · steel · lit · stops(fill)
    const bedOps = strokeWidth(r.ops, RAIL_BED_WIDTH);
    expect(bedOps).toHaveLength(1);
    expect(bedOps[0].style).toBe(r.pattern);          // textured, not flat
    const margin = r.ops.filter((o) => o.kind === "stroke" && o.width > RAIL_BED_WIDTH);
    expect(margin).toHaveLength(1);                   // the light margin, and it is light
    expect(margin[0].style).toBe(DEFAULT_RAIL_STYLE.bedEdge);
    expect(margin[0].alpha).toBeLessThan(1);

    // …and where no pattern can be made — the rail-cache suite's recording stub
    // answers null from `createPattern` — the bed is the flat gravel colour
    // rather than a hole in the track.
    const noPattern = recorder(2, false);
    paintRailTiles(noPattern.ctx, one, railDetailFor(2), painted);
    const bed2 = strokeWidth(noPattern.ops, RAIL_BED_WIDTH);
    expect(bed2).toHaveLength(1);
    expect(bed2[0].style).toBe(DEFAULT_RAIL_STYLE.bed);
  });

  it("draws two rails and a lit edge at the closest zoom, one line when far", () => {
    const close = paint(2);
    const rails = strokeWidth(close.ops, RAIL_WIDTH);
    expect(rails).toHaveLength(1);
    expect(rails[0].style).toBe(DEFAULT_RAIL_STYLE.steel);
    // Two rails a gauge apart, and BOTH from the one batched pass…
    expect(rails[0].subs).toHaveLength(2);
    // …on the geometry, offset towards the light so the web shows below-right.
    expect(rails[0].subs[0]).toEqual(shift(tile(10, 10).rails[0]));
    const web = strokeWidth(close.ops, RAIL_WEB_WIDTH);
    expect(web).toHaveLength(1);
    expect(web[0].subs[0]).toEqual(tile(10, 10).rails[0]);     // the rail itself"
    const lit = strokeWidth(close.ops, RAIL_LIT_WIDTH);
    expect(lit).toHaveLength(1);
    expect(lit[0].style).toBe(DEFAULT_RAIL_STYLE.lit);
    expect(lit[0].alpha).toBe(RAIL_LIT_ALPHA);        // a spark, not a stripe
    expect(RAIL_LIT_ALPHA).toBeLessThan(0.5);
    expect(lit[0].subs[0]).toEqual(shift(tile(10, 10).rails[0], 2));

    const far = paint(0.5);
    expect(bed(far.ops)).toBeUndefined();
    // No sleepers at all — selected by STYLE, because the far line's own steel
    // is exactly as wide as a sleeper is long.
    expect(far.ops.some((o) => o.style === DEFAULT_RAIL_STYLE.tie)).toBe(false);
    expect(strokeWidth(far.ops, RAIL_LIT_WIDTH)).toHaveLength(0);
    // The two-tone line: a dark band with the steel through it, along the
    // tile's CENTRE-line — one subpath for this straight, not the rail pair.
    const band = strokeWidth(far.ops, RAIL_FAR_BED_WIDTH)[0];
    const line = strokeWidth(far.ops, RAIL_FAR_RAIL_WIDTH)[0];
    expect(band.style).toBe(DEFAULT_RAIL_STYLE.web);
    expect(line.style).toBe(DEFAULT_RAIL_STYLE.steel);
    expect(line.subs).toHaveLength(1);
    expect(band.subs[0]).toEqual(shift(line.subs[0], -1));

    // The middle zoom keeps the bed and both rails, and drops the lit edge.
    const mid = paint(1);
    expect(bed(mid.ops)).toBeDefined();
    expect(strokeWidth(mid.ops, RAIL_WIDTH)).toHaveLength(1);
    expect(strokeWidth(mid.ops, RAIL_LIT_WIDTH)).toHaveLength(0);
  });

  it("walks the sleepers the tier allows, at the lattice's own spots", () => {
    // By STYLE, not by width: the far tier's steel line is the sleepers' width.
    const ties = (zoom: number) =>
      paint(zoom).ops.filter((o) => o.kind === "stroke" && o.style === DEFAULT_RAIL_STYLE.tie)[0]?.subs ?? [];
    const lattice = tiesFor(tile(10, 10), railDetailFor(2));
    expect(ties(2)).toHaveLength(lattice.length);
    expect(ties(2)[0]).toEqual(lattice[0]);
    // The middle zoom thins nothing but the boards — same ladder, same rungs.
    expect(ties(1)).toHaveLength(lattice.length);
    // The far tier has no sleepers at all: it is a line.
    expect(ties(0.5)).toHaveLength(0);
    // Low QUALITY keeps the stride-2 subset of the very same rungs.
    const low = tiesFor(tile(10, 10), railDetailFor(0.5));
    expect(low.length).toBeLessThan(lattice.length);
    expect(low.map((t) => t[0])).toEqual(lattice.filter((_, i) => i % 2 === 0).map((t) => t[0]));
  });

  it("puts the lit edge up-left of the steel on screen, by a constant ground step", () => {
    const rail = tile(10, 10).rails[0];
    const [sx, sy] = screen(shift(rail)[0]);
    const [bx, by] = screen(rail[0]);
    expect(sx).toBeLessThan(bx);              // left…
    expect(sy).toBeLessThan(by);              // …and up
    // A CONSTANT ground offset is what keeps two tiles' lit edges continuous:
    // every point moves by the same vector, the ports included, and the steel
    // itself is untouched (the trains ride the geometry, not the paint).
    for (const [u, v] of rail) {
      const [su, sv] = shift([[u, v]])[0];
      expect(su - u).toBeCloseTo(RAIL_LIT_OFFSET[0], 12);
      expect(sv - v).toBeCloseTo(RAIL_LIT_OFFSET[1], 12);
    }
    // The far tier's line is the centre-line, and its own shadow is offset the
    // same way — one light direction for the whole railway.
    expect(screen(shift(tile(10, 10).runs[0])[0])[0]).toBeLessThan(screen(tile(10, 10).runs[0][0])[0]);
  });

  it("reads the zoom off the context, and draws its full detail without one", () => {
    expect(contextZoom(recorder(2).ctx)).toBeCloseTo(2, 9);
    expect(contextZoom(recorder(1).ctx)).toBeCloseTo(1, 9);
    expect(contextZoom(recorder(0.5).ctx)).toBeCloseTo(0.5, 9);
    // A context with no transform to read (a bare stub, an exotic backend): the
    // painter draws the tier it was handed rather than guessing a zoom.
    const blind = recorder(null);
    expect(contextZoom(blind.ctx)).toBeNull();
    paintRailTiles(blind.ctx, one, railDetailFor(2));
    expect(strokeWidth(blind.ops, RAIL_BED_WIDTH)).toHaveLength(1);
    expect(strokeWidth(blind.ops, RAIL_LIT_WIDTH)).toHaveLength(1);
    // …and the quality preset still rules where there IS a transform: a low-cap
    // raster is the far line at ANY zoom (the zoom can only take detail away).
    const low = recorder(2);
    paintRailTiles(low.ctx, one, railDetailFor(0.5));
    expect(strokeWidth(low.ops, RAIL_FAR_BED_WIDTH)).toHaveLength(1);
    expect(strokeWidth(low.ops, RAIL_BED_WIDTH)).toHaveLength(0);
  });
});

// ── software preview: ART4_PREVIEW=1 renders the sheets the PR asks for ─────
//
// This sandbox has no browser, so the "screenshots" are rendered through the
// SHIPPING painters instead of through Chromium: the rail (and, for the width
// comparison, the road) pass is driven with a recording context, its ops become
// SVG — the same ground-space transform, the same widths, the same gravel
// bytes the browser generates — and sharp rasterises that. Off unless the env
// var is set, exactly like the E2 preview in `iso-elevation.test.ts`.
if (process.env.ART4_PREVIEW === "1") {
  it("renders the ART-4 preview sheets", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const sharp = (await import("sharp")).default;
    const { GRASS } = await import("../../src/iso/grid");
    const { draperFor } = await import("../../src/iso/elevation");
    const { railTilesIn } = await import("../../src/iso/rail-renderer");
    const { DEFAULT_ROAD_STYLE, paintRoadTiles, roadTilesIn } = await import("../../src/iso/road-renderer");

    const out = process.env.ART4_PREVIEW_OUT ?? "test-results/rail-402";
    mkdirSync(out, { recursive: true });

    /** A grid with only the heights a sheet asks for (the slope case). */
    const gridOf = (height: (x: number, y: number) => number) => {
      const h = new Uint8Array(MAP_W * MAP_H);
      for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) h[y * MAP_W + x] = height(x, y);
      return {
        w: MAP_W, h: MAP_H, terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
        occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), industries: [], towns: [], seed: 1, height: h,
      };
    };
    const FLAT = gridOf(() => 0);

    const PRESENT_BIT = 0b10000, DE = 32;
    const NE = 0b0001, SE = 0b0010, SW = 0b0100, NW = 0b1000;
    /** A straight run down the v axis (the game's NE↔SW), ends capped. */
    const run = (tx: number, ty0: number, ty1: number): [number, number, number][] =>
      Array.from({ length: ty1 - ty0 + 1 }, (_, i) => {
        const ty = ty0 + i;
        const mask = ty === ty0 ? SW : ty === ty1 ? NE : NE | SW;
        return [tx, ty, PRESENT_BIT | mask] as [number, number, number];
      });

    interface Sheet {
      name: string;
      /** `[tx, ty, cell]`: the whole byte, diagonal bits included. */
      rail: [number, number, number][];
      roads?: [number, number, number][];
      decks?: { tx: number; ty: number; axis: "x" | "y" }[];
      grid?: ReturnType<typeof gridOf>;
      /** Ground-space quads for art that cannot be drawn here (a sprite). */
      boxes?: { u0: number; v0: number; u1: number; v1: number; note: string }[];
      note: string;
    }

    const sheets: Sheet[] = [
      {
        name: "straight-vs-road",
        rail: run(10, 8, 13),
        roads: run(13, 8, 13),
        note: "straight (left) beside a paved road (right) — the width check",
      },
      {
        name: "diagonal",
        rail: [[10, 10, PRESENT_BIT | DE], [11, 9, PRESENT_BIT]],
        note: "the 32/64 diagonal link: (10,10) stores it east, (11,9) reads it west",
      },
      {
        name: "curve",
        rail: [
          [10, 9, PRESENT_BIT | (NE | SW)],       // the approach from the north
          [10, 10, PRESENT_BIT | (NE | SE)],      // the bend itself
          [11, 10, PRESENT_BIT | (NW | SE)],      // and away to the east
        ],
        note: "a 90° bend through (10,10), with both ends capped by buffer stops",
      },
      {
        name: "junction",
        rail: [
          // Each neighbour's single arm points back AT the junction (the
          // reciprocal bit), which is what makes the steel meet at the port.
          [10, 10, PRESENT_BIT | (NE | SE | SW | NW)],
          [10, 9, PRESENT_BIT | SW], [10, 11, PRESENT_BIT | NE],
          [9, 10, PRESENT_BIT | SE], [11, 10, PRESENT_BIT | NW],
        ],
        note: "a crossroads: two through runs, the steel continuous both ways",
      },
      {
        name: "bridge",
        rail: run(10, 9, 12),
        decks: [{ tx: 10, ty: 10, axis: "y" }, { tx: 10, ty: 11, axis: "y" }],
        note: "two deck tiles under the track (the river itself is not drawn here)",
      },
      {
        name: "slope",
        rail: run(10, 8, 13),
        grid: gridOf((_x, y) => (y >= 12 ? 2 : y >= 10 ? 1 : 0)),
        note: "a rail ramp — the bed and the rails are draped by elevation.ts",
      },
      {
        name: "platform",
        rail: run(10, 8, 13),
        boxes: [{ u0: 10.6, v0: 8, u1: 11.6, v1: 11, note: "platform_se (1×3) sprite" }],
        note: "the 1×3 platform's own footprint: its track is ordinary rail BESIDE it",
      },
    ];

    const gravelPng = await sharp(Buffer.from(gravelRaster()), {
      raw: { width: GRAVEL_TEXTURE_SIZE, height: GRAVEL_TEXTURE_SIZE, channels: 4 },
    }).png().toBuffer();
    const gravelUri = `data:image/png;base64,${gravelPng.toString("base64")}`;
    const PREVIEW_STYLE = { ...DEFAULT_RAIL_STYLE, ballast: { width: GRAVEL_TEXTURE_SIZE, height: GRAVEL_TEXTURE_SIZE } };
    // The caption sits above the frame; the margins leave room for the bed's
    // own bulge at the sheet's corners (the stroke reaches half its width).
    const MARGIN = 52, TOP = 34, ZOOMS = [0.5, 1, 2];

    let made = 0;
    for (const sheet of sheets) {
      for (const zoom of ZOOMS) {
        const layer = new Uint8Array(MAP_W * MAP_H);
        for (const [tx, ty, cell] of sheet.rail) layer[ty * MAP_W + tx] = cell;
        const roadBits = new Uint8Array(MAP_W * MAP_H);
        for (const [tx, ty, cell] of sheet.roads ?? []) roadBits[ty * MAP_W + tx] = cell;
        const grid = sheet.grid ?? FLAT;
        const railTiles = railTilesIn({ rail: { tile: layer }, grid }, 0, 0, MAP_W - 1, MAP_H - 1);
        const roadTiles = sheet.roads
          ? roadTilesIn({ roadBits, dirtBits: new Uint8Array(MAP_W * MAP_H), grid }, 0, 0, MAP_W - 1, MAP_H - 1)
          : [];

        // The frame: the projected bounds of everything the sheet draws.
        const us = sheet.rail.map(([tx]) => tx).concat(sheet.rail.map(([tx]) => tx + 1))
          .concat((sheet.roads ?? []).flatMap(([tx]) => [tx, tx + 1]));
        const vs = sheet.rail.map(([, ty]) => ty).concat(sheet.rail.map(([, ty]) => ty + 1))
          .concat((sheet.roads ?? []).flatMap(([, ty]) => [ty, ty + 1]));
        const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
        const x0 = (u0 - v1) * HW * zoom, x1 = (u1 - v0) * HW * zoom;
        const y0 = (u0 + v0) * HH * zoom, y1 = (u1 + v1) * HH * zoom;
        const e = MARGIN - x0, f = TOP - y0;
        const W = Math.ceil(x1 - x0 + MARGIN * 2), H = Math.ceil(y1 - y0 + MARGIN + TOP + 8);
        const m = { a: HW * zoom, b: HH * zoom, c: -HW * zoom, d: HH * zoom, e, f };
        const xf = `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`;

        const r = recorder(zoom);
        const drape = draperFor(grid);
        // Stand-in sprites first (the sheet's own caption says what they are)…
        const boxes = (sheet.boxes ?? []).map((b) => {
          r.ctx.fillStyle = "#7d4536";
          r.ctx.globalAlpha = 0.85;
          r.ctx.beginPath();
          r.ctx.moveTo(b.u0, b.v0);
          r.ctx.lineTo(b.u1, b.v0);
          r.ctx.lineTo(b.u1, b.v1);
          r.ctx.lineTo(b.u0, b.v1);
          r.ctx.closePath();
          r.ctx.fill();
          r.ctx.globalAlpha = 1;
          return `<path d="M${b.u0} ${b.v0}L${b.u1} ${b.v0}L${b.u1} ${b.v1}L${b.u0} ${b.v1}Z" transform="${xf}" fill="#7d4536" fill-opacity="0.85"/>`;
        });
        // …then the roads, then the track over them, the cache's own order.
        if (roadTiles.length) paintRoadTiles(r.ctx, roadTiles, DEFAULT_ROAD_STYLE, [], [], drape);
        paintRailTiles(r.ctx, railTiles, railDetailFor(2), PREVIEW_STYLE, sheet.decks ?? [], drape);

        const d = (subs: [number, number][][]) =>
          subs.map((sub) => `M${sub.map(([x, y]) => `${x.toFixed(4)} ${y.toFixed(4)}`).join("L")}Z`).join("");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
          + `<defs><pattern id="gravel" patternUnits="userSpaceOnUse" width="${GRAVEL_REPEAT}" height="${GRAVEL_REPEAT}">`
          + `<image href="${gravelUri}" x="0" y="0" width="${GRAVEL_REPEAT}" height="${GRAVEL_REPEAT}"/></pattern></defs>`
          + `<rect width="${W}" height="${H}" fill="#5c6b3f"/>`
          + boxes.join("")
          + r.ops.map((o) => {
            const style = typeof o.style === "string" ? o.style : "url(#gravel)";
            return o.kind === "fill"
              ? `<path d="${d(o.subs)}" transform="${xf}" fill="${style}" fill-opacity="${o.alpha}"/>`
              : `<path d="${d(o.subs)}" transform="${xf}" fill="none" stroke="${style}"`
                + ` stroke-opacity="${o.alpha}" stroke-width="${o.width}" stroke-linecap="butt" stroke-linejoin="round"/>`;
          }).join("")
          + `<text x="${MARGIN}" y="20" font-family="DejaVu Sans, Helvetica, sans-serif" font-size="13" fill="#f2efe6">`
          + `ART-4 #402 · ${sheet.name} · zoom ${zoom}× · ${sheet.note}</text></svg>`;
        const file = `${out}/${sheet.name}-${zoom}x`;
        writeFileSync(`${file}.svg`, svg);
        await sharp(Buffer.from(svg)).png().toFile(`${file}.png`);
        made++;
      }
    }
    console.log(`[ART-4] ${made} preview sheets → ${out}/`);
  }, 180_000);
}
