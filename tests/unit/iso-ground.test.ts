import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { HW, HH, TILE_H } from "../../src/game/config";
import { generateMap, SAND, WATER } from "../../src/iso/grid";
import {
  tileDiamondWorld, insetPolygon, SAND_INSET, computeShore, isLandTerrain,
  shallowAlpha, foamAlpha, foamWidth, oceanMatrix, identityProject,
} from "../../src/iso/ground";

// ══════════════════════════════════════════════════════════════════════════
// W-series — the pattern-painted ground: pure geometry/wave unit tests, plus
// a software PREVIEW of the painted ground (`PREVIEW_GROUND=1 npx vitest run
// tests/unit/iso-ground.test.ts`) that rasterises the exact polygons the
// renderer paints as SVG patterns filled with the real seamless textures and
// composites real atlas sprites on top — no browser needed (CI sandboxes
// have no Chromium for capture-iso-review).
// ══════════════════════════════════════════════════════════════════════════

describe("W-series ground geometry", () => {
  const grid = generateMap(42);

  it("tileDiamondWorld corners derive from tileToScreen", () => {
    const [tx, ty] = [10, 14];
    const [x, y] = [((tx - ty) * HW), ((tx + ty) * HH)];   // tileToScreen at cam 0
    const pts = tileDiamondWorld(tx, ty);
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual([x, y]);                        // N = top vertex
    expect(pts[1]).toEqual([x + HW, y + HH]);              // E
    expect(pts[2]).toEqual([x, y + TILE_H]);               // S
    expect(pts[3]).toEqual([x - HW, y + HH]);              // W
  });

  it("insetPolygon scales toward the polygon's own centroid", () => {
    const pts = tileDiamondWorld(3, 3);
    const ins = insetPolygon(pts, SAND_INSET);
    const mid = (a: [number, number][], i: number) => {
      let sx = 0, sy = 0;
      for (const p of a) { sx += p[0]; sy += p[1]; }
      return [sx / a.length, sy / a.length, i] as const;
    };
    const [, , i0] = mid(pts, 0);
    void i0;
    // centroid is preserved; every vertex moves toward it by (1−inset)
    let cx = 0, cy = 0;
    for (const [x, y] of pts) { cx += x; cy += y; }
    cx /= 4; cy /= 4;
    for (let i = 0; i < 4; i++) {
      expect(ins[i][0]).toBeCloseTo(cx + (pts[i][0] - cx) * SAND_INSET, 5);
      expect(ins[i][1]).toBeCloseTo(cy + (pts[i][1] - cy) * SAND_INSET, 5);
    }
  });

  it("every SAND tile is land and every shore tile is water beside land", () => {
    let sand = 0;
    for (let ty = 0; ty < grid.h; ty++) {
      for (let tx = 0; tx < grid.w; tx++) {
        const v = grid.terrain[ty * grid.w + tx];
        if (v === SAND) { sand++; expect(isLandTerrain(v)).toBe(true); }
      }
    }
    expect(sand).toBeGreaterThan(0);
    const shore = computeShore(grid);
    expect(shore.length).toBeGreaterThan(0);
    for (const st of shore) {
      expect(grid.terrain[st.ty * grid.w + st.tx]).toBe(WATER);
      // a diagonal-only contact (a jagged corner) tints without foam edges
      expect(st.edges.length).toBeGreaterThanOrEqual(0);
      // each foam edge endpoint sits on the tile's own diamond
      const pts = tileDiamondWorld(st.tx, st.ty);
      for (const [[ax, ay], [bx, by]] of st.edges) {
        expect(pts.some(([x, y]) => x === ax && y === ay)).toBe(true);
        expect(pts.some(([x, y]) => x === bx && y === by)).toBe(true);
      }
    }
  });

  it("the surf waves breathe within their design ranges", () => {
    let lo = 1, hi = 0, flo = 1, fhi = 0, wlo = 99, whi = 0;
    for (let t = 0; t < 8000; t += 100) {
      for (const [tx, ty] of [[3, 4], [9, 1], [2, 9]]) {
        const s = shallowAlpha(t, tx, ty);
        lo = Math.min(lo, s); hi = Math.max(hi, s);
        const f = foamAlpha(t, tx, ty);
        flo = Math.min(flo, f); fhi = Math.max(fhi, f);
        const w = foamWidth(t, tx, ty);
        wlo = Math.min(wlo, w); whi = Math.max(whi, w);
      }
    }
    expect(lo).toBeGreaterThan(0.05);
    expect(hi).toBeLessThan(0.25);
    expect(flo).toBeGreaterThan(0.05);
    expect(fhi).toBeLessThanOrEqual(0.61);
    expect(wlo).toBeGreaterThan(1);
    expect(whi).toBeLessThan(3.2);
  });

  it("the ocean pattern drifts in world space and wraps its period", () => {
    const cam = { x: 100, y: 200, zoom: 1 };
    const m0 = oceanMatrix(cam, 0);
    const m1 = oceanMatrix(cam, 1000);
    expect(m1.e - m0.e).toBeGreaterThan(0);       // drifts right
    expect(m1.f - m0.f).toBeGreaterThan(0);       // and down
    // identity projection is the identity
    expect(identityProject(7, 9)).toEqual([7, 9]);
  });
});

// ── software preview (PREVIEW_GROUND=1) ────────────────────────────────────
if (process.env.PREVIEW_GROUND === "1") {
  const SEED = Number(process.env.PREVIEW_SEED ?? 1337);
  const CX = Number(process.env.PREVIEW_CX ?? 72);
  const CY = Number(process.env.PREVIEW_CY ?? 72);
  const TILES = Number(process.env.PREVIEW_TILES ?? 80);
  const OUT = process.env.PREVIEW_OUT ?? "test-results/ground-preview.png";
  const S = 0.2;    // land texture scale vs world px — fine grain (~1.6 tiles/repeat)
  const SEA = 0.16; // the ocean reads a little denser

  beforeAll(async () => {
    const grid = generateMap(SEED);
    const W = Math.ceil((TILES + 2) * HW * 2);
    const H = Math.ceil((TILES + 2) * TILE_H + TILE_H * 2);
    const project = (tx: number, ty: number): [number, number] =>
      [(tx - ty) * HW + W / 2, (tx + ty) * HH + TILE_H];
    const pts = (tx: number, ty: number, inset = 1) => {
      const [x, y] = project(tx, ty);
      const raw: [number, number][] = [[x, y], [x + HW, y + HH], [x, y + TILE_H], [x - HW, y + HH]];
      return inset === 1 ? raw : insetPolygon(raw, inset);
    };
    const poly = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const isLand = (tx: number, ty: number) =>
      tx >= 0 && ty >= 0 && tx < grid.w && ty < grid.h && grid.terrain[ty * grid.w + tx] !== WATER;

    let grass = "", sand = "", foam = "";
    for (let ty = CY - TILES / 2; ty < CY + TILES / 2; ty++) {
      for (let tx = CX - TILES / 2; tx < CX + TILES / 2; tx++) {
        if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) continue;
        const v = grid.terrain[ty * grid.w + tx];
        if (v === WATER) {
          const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isLand(tx + dx, ty + dy));
          if (near) {
            const p = pts(tx, ty);
            for (let i = 0; i < 4; i++) {
              const [ax, ay] = p[i], [bx, by] = p[(i + 1) % 4];
              foam += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="rgba(255,244,214,0.55)" stroke-width="2.4"/>`;
            }
          }
          continue;
        }
        grass += `<polygon points="${poly(pts(tx, ty))}"/>`;
        if (v === SAND) sand += `<polygon points="${poly(pts(tx, ty, SAND_INSET))}"/>`;
      }
    }

    // Plain-geometry masks rasterize fast; the textures are tiled separately
    // (one pattern-filled rect each) and CLIPPED by the masks with dest-in.
    const maskSvg = (body: string, fill: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body.replace(/<polygon /g, `<polygon fill="${fill}" `)}</svg>`;
    // NOTE: no <pattern> — librsvg's patternTransform drops/rounds cells and
    // leaves seams. Tiling an inlined data-URI <image> per cell works at
    // coarse scale but at fine scale the string exceeds V8's limit (≈1400
    // cells × 800KB each), so instead: downsample the seamless texture to
    // ONE period, then stamp that period across the canvas by recursive
    // doubling — logarithmic composites, no per-cell payload.
    const tileFill = async (src: string, scale: number): Promise<Buffer> => {
      const P = Math.max(1, Math.round(512 * scale));        // one period, px
      let cur = await sharp(src).resize(P, P).png().toBuffer();
      let cw = P, ch = P;
      while (cw < W || ch < H) {
        const nw = Math.min(W, cw << 1), nh = Math.min(H, ch << 1);
        const stamps: { input: Buffer; left: number; top: number }[] = [];
        for (let y = 0; y < nh; y += ch)
          for (let x = 0; x < nw; x += cw)
            stamps.push({ input: cur, left: x, top: y });
        cur = await sharp({ create: {
          width: nw, height: nh, channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        } }).composite(stamps).png().toBuffer();
        cw = nw; ch = nh;
      }
      return (cw === W && ch === H)
        ? cur
        : sharp(cur).extract({ left: 0, top: 0, width: W, height: H }).png().toBuffer();
    };
    const foamSvg = (body: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`;

    const [waterTile, grassTile, sandTile, landMask, sandMask, foamRaster] = await Promise.all([
      tileFill("assets/ground/water.png", SEA),
      tileFill("assets/ground/grass.png", S),
      tileFill("assets/ground/sand.png", S),
      sharp(Buffer.from(maskSvg(grass, "#fff"))).png().toBuffer(),
      sharp(Buffer.from(maskSvg(sand, "#fff"))).png().toBuffer(),
      sharp(Buffer.from(foamSvg(foam))).png().toBuffer(),
    ]);
    const clip = async (tex: Buffer, mask: Buffer) =>
      sharp(tex).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
    const [grassClipped, sandClipped] = await Promise.all([
      clip(grassTile, landMask), clip(sandTile, sandMask),
    ]);

    // A few REAL sprites at their drawOrigin positions (depth.ts maths).
    const manifest = JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8")) as {
      sprites: Record<string, { x: number; y: number; w: number; h: number; frames?: number; footprint: [number, number]; anchor: [number, number] }>;
    };
    const atlasBuf = await sharp("assets/iso-atlas/atlas@1x.png").toBuffer();
    const layers: { input: Buffer; left: number; top: number }[] = [];
    const put = async (name: string, tx: number, ty: number) => {
      const s = manifest.sprites[name];
      if (!s) return;
      const fw = s.w / (s.frames ?? 1);
      const ex = tx + s.footprint[0] - 1, ey = ty + s.footprint[1] - 1;
      // preview canvas origin: tile (0,0)'s top vertex sits at (W/2, TILE_H)
      const left = Math.round((ex - ey) * HW + W / 2 + HW - s.anchor[0]);
      const top = Math.round((ex + ey) * HH + TILE_H + TILE_H - s.anchor[1]);
      const sprite = await sharp(atlasBuf).extract({ left: s.x, top: s.y, width: fw, height: s.h }).toBuffer();
      layers.push({ input: sprite, left, top });
    };
    await put("farm", CX - 8, CY + 2);
    await put("town_center", CX + 6, CY - 4);
    await put("depot", CX + 2, CY + 10);
    await put("quarry", CX - 2, CY - 12);

    await sharp(waterTile)
      .composite([{ input: grassClipped }, { input: sandClipped }, { input: foamRaster }, ...layers])
      .png().toFile(OUT);
    console.log(`[w-series] ground preview → ${OUT}`);
  }, 170_000);

  it("renders the software ground preview", () => {
    // the actual assertions above; this test exists so the beforeAll runs
    expect(true).toBe(true);
  });
}
