import { describe, expect, it } from "vitest";
import { generateMap, heightAt, WATER, idx } from "../../src/iso/grid";

const seeds = [42, 1337];

describe("E1 elevation", () => {
  it("is deterministic and option-off remains flat", () => {
    for (const seed of seeds) {
      const a = generateMap(seed, { elevation: true });
      const b = generateMap(seed, { elevation: true });
      expect(a.height).toEqual(b.height);
      expect(generateMap(seed).height).toEqual(new Uint8Array(a.w * a.h));
    }
  });

  it("keeps sea and rivers at the lowest level", () => {
    for (const seed of seeds) {
      const g = generateMap(seed, { elevation: true, rivers: true });
      for (let i = 0; i < g.terrain.length; i++) {
        if (g.terrain[i] === WATER || g.rivers?.[i]) expect(g.height?.[i]).toBe(0);
      }
    }
  });

  it("limits every neighbouring slope to one level", () => {
    const g = generateMap(20260925, { elevation: true, rivers: true });
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
        expect(Math.abs(heightAt(g, x, y) - heightAt(g, nx, ny)), `${x},${y}=${heightAt(g, x, y)} vs ${nx},${ny}=${heightAt(g, nx, ny)}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("flattens industry and town footprints", () => {
    const g = generateMap(1337, { elevation: true });
    for (const ind of g.industries) {
      const levels: number[] = [];
      for (let y = ind.ty; y < ind.ty + ind.h; y++) {
        for (let x = ind.tx; x < ind.tx + ind.w; x++) levels.push(g.height?.[idx(x, y)] ?? 0);
      }
      expect(new Set(levels).size).toBe(1);
    }
    for (const town of g.towns) {
      const levels = [...town.houses, ...town.roads, [town.tx, town.ty] as [number, number]]
        .map(([x, y]) => g.height?.[idx(x, y)] ?? 0);
      expect(new Set(levels).size).toBe(1);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// E2 (#267) — DRAWING the elevation. The data tests above are #261's; these
// pin the surface the renderer draws: the corner lattice's contract, the drape
// the road/rail/bridge painters lift their vectors with, the top faces, and the
// two paint paths (option ON = per-tile raised faces, option OFF = the traced
// contours, byte for byte what the renderer painted before elevation existed).
// ══════════════════════════════════════════════════════════════════════════
import { writeFileSync } from "node:fs";
import { HW, HH, TILE_H } from "../../src/game/config";
import { GRASS, type Grid } from "../../src/iso/grid";
import {
  FLAT_DRAPER, LEVEL_PX, MAX_LEVEL, MAX_LIFT_PX, cornerHeight, drapePath, draperFor,
  elevatedWorld, elevationActive, elevationField, elevationLiftPx, invalidateElevation,
  slopeShade, surfaceHeight, tileCorners, tileSurfaceHeight,
} from "../../src/iso/elevation";
import {
  SHADE_BUCKETS, SHADE_DARK_GAIN, SHADE_LIGHT_GAIN, paintGroundTiles,
  tileDiamondRaised, tileTopFaces,
} from "../../src/iso/ground";
import { roadFigures, type GroundPoint } from "../../src/iso/road-geometry";
import { chunkSurfaceSize, chunkWorldOrigin } from "../../src/iso/renderer";
import { NE, NW, SE, SW } from "../../src/iso/track";

/** The game's one projection, applied to a ground-plane point. */
const iso = ([u, v]: readonly [number, number]): [number, number] => [(u - v) * HW, (u + v) * HH];

/** A tiny hand-built map: heights given as rows of digits, `~` is water. */
function synthetic(rows: string[]): Grid {
  const h = rows.length, w = rows[0].length;
  const terrain = new Uint8Array(w * h);
  const height = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = rows[y][x];
    const i = y * w + x;
    if (c === "~") { terrain[i] = WATER; height[i] = 0; }
    else { terrain[i] = GRASS; height[i] = Number(c); }
  }
  return { w, h, terrain, height, industries: [], towns: [], occupancy: new Uint8Array(w * h), seed: 1 } as unknown as Grid;
}

// ── a recording 2D context: the same trick the other paint tests use ──────
type Pt = [number, number];
interface PaintOp {
  kind: "fill" | "stroke";
  subs: Pt[][];
  style: string;
  alpha: number;
  width: number;
}
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
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    get fillStyle() { return st.fill; }, set fillStyle(v) { st.fill = v as string; },
    get strokeStyle() { return st.stroke; }, set strokeStyle(v) { st.stroke = v as string; },
    get lineWidth() { return st.width; }, set lineWidth(v) { st.width = v as number; },
    get globalAlpha() { return st.alpha; }, set globalAlpha(v) { st.alpha = v as number; },
    lineJoin: "miter", lineCap: "butt",
  } as unknown as CanvasRenderingContext2D;
  return { ctx, ops };
}

describe("E2 the corner lattice", () => {
  it("is the minimum of the tiles that meet at each corner", () => {
    // A lone peak: the corner between the 3 and its 1-neighbours is 1, so the
    // surface ramps up to the peak instead of cliffing — and a corner beside
    // water is always 0.
    const g = synthetic([
      "111",
      "131",
      "111",
    ]);
    expect(elevationActive(g)).toBe(true);
    // corner (1,1) touches tiles (0,0),(1,0),(0,1),(1,1) = 1,1,1,3 → 1
    expect(cornerHeight(g, 1, 1)).toBe(1);
    // the peak's own centre: all four of its corners touch a 1 → 1
    expect(tileCorners(g, 1, 1)).toEqual([1, 1, 1, 1]);
    expect(tileSurfaceHeight(g, 1, 1)).toBe(1);
  });

  it("keeps every corner that touches water at level 0", () => {
    const g = generateMap(1337, { elevation: true, rivers: true });
    const bad: string[] = [];
    for (let y = 0; y < g.h && bad.length < 5; y++) for (let x = 0; x < g.w; x++) {
      if (g.terrain[idx(x, y)] !== WATER) continue;
      for (const [i, j] of [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]] as const) {
        if (cornerHeight(g, i, j) !== 0) bad.push(`corner ${i},${j} beside water ${x},${y}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("renders flat ground — every town and industry footprint — at exactly heightAt", () => {
    // The #269 contract: a building anchored at heightAt(tile) × LEVEL_PX stands
    // on the surface this ticket draws, because a footprint's corners all agree
    // with its own level.
    const g = generateMap(1337, { elevation: true });
    const tiles: [number, number][] = [];
    for (const ind of g.industries) {
      for (let y = ind.ty; y < ind.ty + ind.h; y++) for (let x = ind.tx; x < ind.tx + ind.w; x++) tiles.push([x, y]);
    }
    for (const town of g.towns) tiles.push(...town.houses, ...town.roads, [town.tx, town.ty]);
    expect(tiles.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const [x, y] of tiles) {
      const level = heightAt(g, x, y);
      if (tileSurfaceHeight(g, x, y) !== level
        || tileCorners(g, x, y).some((c) => c !== level)) bad.push(`${x},${y}@${level}`);
    }
    expect(bad).toEqual([]);
  });

  it("agrees with itself from both sides of every shared corner", () => {
    const g = generateMap(42, { elevation: true });
    const bad: string[] = [];
    for (let y = 1; y < 60; y++) for (let x = 1; x < 60; x++) {
      const a = tileCorners(g, x, y);          // N,E,S,W = lattice (x,y),(x+1,y),(x+1,y+1),(x,y+1)
      const e = tileCorners(g, x + 1, y);      // east neighbour
      const s = tileCorners(g, x, y + 1);      // south neighbour
      if (a[1] !== e[0] || a[2] !== e[3] || a[3] !== s[0] || a[2] !== s[1]) bad.push(`${x},${y}`);
    }
    expect(bad).toEqual([]);
  });

  it("is null, and every reader the identity, when the option is off", () => {
    const flat = generateMap(42);
    expect(elevationField(flat)).toBeNull();
    expect(elevationActive(flat)).toBe(false);
    expect(elevationLiftPx(flat)).toBe(0);
    expect(cornerHeight(flat, 5, 5)).toBe(0);
    expect(surfaceHeight(flat, 5.5, 5.5)).toBe(0);
    expect(tileSurfaceHeight(flat, 5, 5)).toBe(0);
    expect(draperFor(flat)).toBe(FLAT_DRAPER);
    expect(FLAT_DRAPER.active).toBe(false);
    // a height array of zeroes is the same as none at all
    const zeroes = { ...flat, height: new Uint8Array(flat.w * flat.h) } as Grid;
    expect(elevationField(zeroes)).toBeNull();
  });

  it("caches per grid object and forgets on invalidate", () => {
    const g = generateMap(7, { elevation: true });
    expect(elevationField(g)).toBe(elevationField(g));
    invalidateElevation(g);
    const again = elevationField(g);
    expect(again?.maxLevel).toBeLessThanOrEqual(MAX_LEVEL);
    expect(again?.maxLevel).toBeGreaterThan(0);
  });
});

describe("E2 the drape", () => {
  const g = generateMap(1337, { elevation: true, rivers: true });

  it("lifts by level × LEVEL_PX in screen Y and not at all in X", () => {
    const drape = draperFor(g);
    expect(drape.active).toBe(true);
    for (const [u, v] of [[10.5, 10.5], [30.25, 44.75], [72, 72], [100.5, 60.25]] as const) {
      const lifted = elevatedWorld(g, u, v);
      const [fx, fy] = [(u - v) * HW, (u + v) * HH];
      expect(lifted[0]).toBeCloseTo(fx, 9);
      expect(lifted[1]).toBeCloseTo(fy - surfaceHeight(g, u, v) * LEVEL_PX, 9);
      // …and the ground-plane drape projects to exactly that world point.
      const [du, dv] = drape.point(u, v);
      expect(iso([du, dv])[0]).toBeCloseTo(lifted[0], 9);
      expect(iso([du, dv])[1]).toBeCloseTo(lifted[1], 9);
    }
  });

  it("keeps two tiles' shared port exactly equal (the port contract, raised)", () => {
    // A road from (tx,ty) into its NE neighbour ends at the edge midpoint; the
    // neighbour's figure starts at that same midpoint. Draped from either side
    // the two endpoints must be bit-identical or the road shows a seam.
    const drape = draperFor(g);
    for (const [tx, ty] of [[40, 30], [66, 22], [52, 18]] as const) {
      // NE edge of (tx,ty) is the SW edge of (tx,ty-1); SE edge is the NW edge
      // of (tx+1,ty). Each side's stub figure ends at the shared midpoint.
      for (const [d, nx, ny, od] of [
        [NE, tx, ty - 1, SW], [SE, tx + 1, ty, NW],
      ] as const) {
        const mine = roadFigures(tx, ty, d)[0].points;
        const theirs = roadFigures(nx, ny, od)[0].points;
        const pm = mine[mine.length - 1];
        const pt = theirs[theirs.length - 1];
        expect(pm).toEqual(pt);                       // same ground midpoint…
        expect(drape.point(pm[0], pm[1])).toEqual(drape.point(pt[0], pt[1]));
        // …and the raised port sits exactly on the lifted ground
        const lifted = elevatedWorld(g, pm[0], pm[1]);
        expect(iso(drape.point(pm[0], pm[1]))[1]).toBeCloseTo(lifted[1], 9);
      }
    }
  });

  it("tessellates long runs and leaves the endpoints exact", () => {
    const drape = draperFor(g);
    const run: GroundPoint[] = [[40, 30], [41, 30], [41, 31]];
    const out = drapePath(run, drape.point);
    // 1-tile legs at DRAPE_STEP 0.25 → 4 segments each, endpoints shared once
    expect(out.length).toBe(4 + 4 + 1);
    expect(out[0]).toEqual(drape.point(40, 30));
    expect(out[out.length - 1]).toEqual(drape.point(41, 31));
    // the identity draper returns the very same array
    expect(FLAT_DRAPER.path(run)).toBe(run);
    // drapePath itself always tessellates; the renderer only reaches it with an
    // active draper, and the flat path goes through FLAT_DRAPER.path instead.
    expect(drapePath(run, FLAT_DRAPER.point)).toHaveLength(9);
  });

  it("is bilinear-continuous across a tile boundary", () => {
    for (const u of [12, 33.5, 71]) {
      for (const v of [12, 45.5, 71]) {
        const a = surfaceHeight(g, u - 1e-9, v);
        const b = surfaceHeight(g, u + 1e-9, v);
        expect(Math.abs(a - b)).toBeLessThan(1e-6);
      }
    }
  });

  it("never lifts above MAX_LIFT_PX", () => {
    expect(elevationLiftPx(g)).toBeLessThanOrEqual(MAX_LIFT_PX);
    expect(MAX_LIFT_PX).toBe(MAX_LEVEL * LEVEL_PX);
  });
});

describe("E2 top faces", () => {
  it("draws a planar tile as one quad and a saddle as four triangles", () => {
    // slope: 0 at the top-left edge, 1 at the bottom-right → N+S == E+W
    const slope = synthetic(["00", "11"]);
    expect(tileTopFaces(slope, 0, 0)).toHaveLength(1);
    // saddle: N,S high and E,W low → N+S != E+W
    const saddle = synthetic(["10", "01"]);
    const faces = tileTopFaces(saddle, 0, 0);
    expect(faces).toHaveLength(4);
    // every triangle carries the tile's own raised corners
    const corners = tileDiamondRaised(saddle, 0, 0);
    const seen = new Set<string>();
    for (const f of faces) for (const p of f) seen.add(p.join(","));
    for (const c of corners) expect(seen.has(c.join(","))).toBe(true);
  });

  it("raises the diamond corner by corner", () => {
    const g = synthetic(["22", "22"]);
    const raised = tileDiamondRaised(g, 0, 0);
    // every corner here is min(2) = 2, so the whole diamond lifts 2 levels
    const want = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) =>
      [(u - v) * HW, (u + v) * HH - 2 * LEVEL_PX] as Pt);
    expect(raised).toEqual(want);
    // a slope raises each corner by its own height
    const slope = synthetic(["01", "23"]);
    const [hN, hE, hS, hW] = tileCorners(slope, 0, 0);
    const sr = tileDiamondRaised(slope, 0, 0);
    expect(sr.map(([x, y], i) => y + [hN, hE, hS, hW][i] * LEVEL_PX))
      .toEqual([[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => (u + v) * HH));
  });

  it("shades a lit slope positive and its opposite negative, zero on flat", () => {
    const flat = synthetic(["222", "222", "222"]);
    expect(slopeShade(tileCorners(flat, 1, 1))).toBeCloseTo(0, 9);
    // rising toward +u/+v (screen south-east) faces the north-west light
    const lit = synthetic(["000", "011", "111"]);
    const dark = synthetic(["111", "110", "000"]);
    expect(slopeShade(tileCorners(lit, 1, 1))).toBeGreaterThan(0);
    expect(slopeShade(tileCorners(dark, 1, 1))).toBeLessThan(0);
    // and the buckets the painter quantises to are stable
    expect(SHADE_BUCKETS).toBeGreaterThan(0);
  });
});

describe("E2 painting the ground", () => {
  const RANGE = [40, 20, 52, 32] as const;

  it("option OFF paints the traced contours, with or without a zero height array", () => {
    const flat = generateMap(42);
    const withZeroes = { ...flat, height: new Uint8Array(flat.w * flat.h) } as Grid;
    const a = recorder();
    const b = recorder();
    paintGroundTiles(a.ctx, flat, ...RANGE, { grass: "#0f0", sand: "#ff0" });
    paintGroundTiles(b.ctx, withZeroes, ...RANGE, { grass: "#0f0", sand: "#ff0" });
    expect(a.ops).toEqual(b.ops);
    // the flat path is the contour paint: two fills (sand land mass, grass
    // inland mask), the first subpath starting on the traced coast.
    const fills = a.ops.filter((o) => o.kind === "fill");
    expect(fills.length).toBeGreaterThanOrEqual(2);
    expect(fills[0].style).toBe("#ff0");
    expect(fills[1].style).toBe("#0f0");
  });

  it("option ON paints batched raised faces instead, one fill per material", () => {
    const g = generateMap(42, { elevation: true });
    const r = recorder();
    paintGroundTiles(r.ctx, g, ...RANGE, { grass: "#0f0", sand: "#ff0" });
    const fills = r.ops.filter((o) => o.kind === "fill");
    expect(fills[0].style).toBe("#ff0");
    expect(fills[1].style).toBe("#0f0");
    // every painted face is a raised diamond (4 pts) or a saddle triangle (3)
    for (const face of [...fills[0].subs, ...fills[1].subs]) {
      expect([3, 4]).toContain(face.length);
    }
    // a flat tile at level L is drawn exactly L × LEVEL_PX above its flat diamond
    let checked = 0;
    for (let ty = RANGE[1]; ty <= RANGE[3] && checked < 8; ty++) {
      for (let tx = RANGE[0]; tx <= RANGE[2] && checked < 8; tx++) {
        const [hN, hE, hS, hW] = tileCorners(g, tx, ty);
        if (hN !== hE || hE !== hS || hS !== hW) continue;
        const flat = [[tx, ty], [tx + 1, ty], [tx + 1, ty + 1], [tx, ty + 1]]
          .map(([u, v]) => [(u - v) * HW, (u + v) * HH] as Pt);
        const want = flat.map(([x, y]) => [x, y - hN * LEVEL_PX]);
        const all = [...fills[0].subs, ...fills[1].subs];
        expect(all, `tile ${tx},${ty} at level ${hN}`).toContainEqual(want);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    // hillshade: one fill per quantised bucket in use, alpha = |shade| × gain
    const shades = fills.slice(2).filter((f) => f.alpha > 0 && f.alpha < 1);
    const gains = [SHADE_LIGHT_GAIN, SHADE_DARK_GAIN];
    for (const s of shades) {
      const hit = gains.some((gain) => {
        const k = Math.round((s.alpha / gain) * SHADE_BUCKETS);
        return k >= 1 && k <= SHADE_BUCKETS
          && Math.abs(Math.min(1, (k / SHADE_BUCKETS) * gain) - s.alpha) < 1e-9;
      });
      expect(hit, `shade alpha ${s.alpha} is a quantised bucket × gain`).toBe(true);
    }
  });

  it("option ON strokes the waterline but option OFF does not", () => {
    const on = generateMap(1337, { elevation: true, rivers: true });
    const off = generateMap(1337, { rivers: true });
    const a = recorder();
    const b = recorder();
    paintGroundTiles(a.ctx, on, 60, 20, 72, 34, { grass: "#0f0", sand: "#ff0" });
    paintGroundTiles(b.ctx, off, 60, 20, 72, 34, { grass: "#0f0", sand: "#ff0" });
    const strokes = (r: typeof a) => r.ops.filter((o) => o.kind === "stroke");
    expect(strokes(a).length).toBeGreaterThan(strokes(b).length);
  });
});

describe("E2 chunk headroom (renderer)", () => {
  it("grows the surface up by the lift and moves the origin with it", () => {
    for (const z of [0.5, 1, 2] as const) {
      const flat = chunkSurfaceSize(z);
      const raised = chunkSurfaceSize(z, MAX_LIFT_PX);
      expect(raised.w).toBe(flat.w);
      expect(raised.h).toBe(flat.h + MAX_LIFT_PX * z);
      const [fx, fy] = chunkWorldOrigin(3, 4);
      const [rx, ry] = chunkWorldOrigin(3, 4, MAX_LIFT_PX);
      expect(rx).toBe(fx);
      expect(ry).toBe(fy - MAX_LIFT_PX);
    }
    // and with no lift — every map without the option — nothing moves
    expect(chunkSurfaceSize(1, 0)).toEqual(chunkSurfaceSize(1));
    expect(chunkWorldOrigin(3, 4, 0)).toEqual(chunkWorldOrigin(3, 4));
  });
});

describe("E2 roads and rail drape onto the same surface", () => {
  const g = generateMap(1337, { elevation: true, rivers: true });

  it("every draped road figure point lands on the lifted ground", () => {
    const drape = draperFor(g);
    for (const [tx, ty] of [[44, 26], [60, 24], [70, 30]] as const) {
      for (const mask of [0b0101, 0b1010, 0b1111]) {
        for (const fig of roadFigures(tx, ty, mask)) {
          for (const p of fig.points) {
            const want = elevatedWorld(g, p[0], p[1]);
            const got = iso(drape.point(p[0], p[1]));
            expect(got[0]).toBeCloseTo(want[0], 9);
            expect(got[1]).toBeCloseTo(want[1], 9);
          }
          // the tessellated run in between lands on the surface too
          for (const p of drapePath(fig.points, drape.point)) {
            const [wx, wy] = iso(p);
            expect(wy).toBeLessThanOrEqual((p[0] + p[1]) * HH + 1e-9);
            void wx;
          }
        }
      }
    }
  });

  it("the flat map's road figures are untouched by the draper", () => {
    const flat = generateMap(1337);
    const drape = draperFor(flat);
    expect(drape).toBe(FLAT_DRAPER);
    for (const fig of roadFigures(10, 10, 0b1111)) {
      expect(drape.path(fig.points)).toBe(fig.points);
    }
  });
});

// ── software preview: PREVIEW_ELEVATION=1 renders the raised ground ────────
if (process.env.PREVIEW_ELEVATION === "1") {
  it("renders the software elevation preview", async () => {
    const sharp = (await import("sharp")).default;
    const seed = Number(process.env.PREVIEW_SEED ?? 1337);
    const X = Number(process.env.PREVIEW_CX ?? 44);
    const Y = Number(process.env.PREVIEW_CY ?? 14);
    const T = Number(process.env.PREVIEW_TILES ?? 24);
    const S = Number(process.env.PREVIEW_SCALE ?? 2);
    const OUT = process.env.PREVIEW_OUT ?? "test-results/elevation-preview.png";
    const grid = generateMap(seed, { elevation: true, rivers: true });
    const [minX, minY] = [(X - Y) * HW - 60, (X + Y) * HH - 90];
    const W = Math.ceil(T * HW * 2 + 120), H = Math.ceil(T * TILE_H + 160);
    const project = (wx: number, wy: number): Pt => [wx - minX, wy - minY];
    const r = recorder();
    r.ctx.fillStyle = "#155e70";
    r.ctx.beginPath();
    r.ctx.moveTo(0, 0); r.ctx.lineTo(W, 0); r.ctx.lineTo(W, H); r.ctx.lineTo(0, H); r.ctx.closePath();
    r.ctx.fill();
    paintGroundTiles(r.ctx, grid, X, Y, X + T, Y + T, { grass: "#6d7c42", sand: "#d9b36c" }, project);
    const d = (o: PaintOp) => o.subs.map((s) =>
      `M${s.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L")}Z`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * S}" height="${H * S}" viewBox="0 0 ${W} ${H}">`
      + r.ops.map((o) => o.kind === "fill"
        ? `<path d="${d(o)}" fill="${o.style}" fill-opacity="${o.alpha}"/>`
        : `<path d="${d(o)}" fill="none" stroke="${o.style}" stroke-opacity="${o.alpha}" stroke-width="${o.width}" stroke-linecap="round" stroke-linejoin="round"/>`).join("")
      + `</svg>`;
    writeFileSync(OUT.replace(/\.png$/, ".svg"), svg);
    await sharp(Buffer.from(svg)).png().toFile(OUT);
    console.log(`[E2] elevation preview → ${OUT}`);
  }, 120_000);
}
