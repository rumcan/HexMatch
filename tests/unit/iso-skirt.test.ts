// ══════════════════════════════════════════════════════════════════════════
// N1 — brown only at the coastline, and N4 — one pick/draw convention.
//
// The acceptance is pixel-true ("for a fully-interior tile, the rendered
// output has zero brown-range pixels below its diamond"), so the test is
// pixel-true: a small software rasteriser draws REAL atlas pixels with the
// renderer's EXACT draw math (K0 anchor on the lattice point, painter order
// by tx+ty), the real `skirtCovered` classification and the real
// `aboveGroundPoly` clip polygon (even-odd point-in-polygon — no re-derived
// shortcut). What leaks brown in here leaks brown in the game.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import {
  skirtCovered, shouldClipGroundSkirt, aboveGroundPoly, flatPick,
} from "../../src/iso/renderer";
import { pickSprite, place, type Placed } from "../../src/iso/depth";
import { Atlas, type Manifest } from "../../src/iso/atlas";
import { generateMap, WATER, GRASS, type Grid } from "../../src/iso/grid";
import { HW, HH, MAP_W, MAP_H, tileToScreen } from "../../src/game/config";

const manifest: Manifest = JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8"));
const atlas = new Atlas(manifest);

// ── the rasteriser ──────────────────────────────────────────────────────────
const BG: [number, number, number] = [11, 26, 38];   // same as the reference renders

type Canvas = { px: Float64Array; w: number; h: number };

function makeCanvas(w: number, h: number): Canvas {
  const px = new Float64Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = BG[0]; px[i * 4 + 1] = BG[1]; px[i * 4 + 2] = BG[2]; px[i * 4 + 3] = 0;
  }
  return { px, w, h };
}

type Poly = [number, number][];

/** Even-odd point-in-polygon against the real exported clip vertices. */
function inPoly(x: number, y: number, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

let atlasRaw: { data: Buffer; width: number; height: number } | null = null;
async function atlasPixels() {
  if (!atlasRaw) {
    const { data, info } = await sharp("assets/iso-atlas/atlas@1x.png", { limitInputPixels: false })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    atlasRaw = { data: Buffer.from(data), width: info.width, height: info.height };
  }
  return atlasRaw;
}

/**
 * Draw one sprite exactly the way chunkCanvas/blit does: K0 anchor on the
 * tile's lattice point (translated by (dxL, dyL) into the test canvas),
 * honouring the N1 rule when `applyRule` — interior sprites are clipped to
 * their `aboveGroundPoly`, edge sprites draw in full. Alpha-composited.
 */
async function drawSprite(
  c: Canvas, name: string, tx: number, ty: number,
  grid: Grid | null, applyRule: boolean, dxL = 0, dyL = 0,
) {
  const s = manifest.sprites[name];
  const img = await atlasPixels();
  const [lx, ly] = tileToScreen(tx, ty);
  const X0 = Math.round(lx + dxL - s.anchor[0]);
  const Y0 = Math.round(ly + dyL - s.anchor[1]);
  const covered = applyRule && grid ? shouldClipGroundSkirt(grid, s, tx, ty) : false;
  const poly = covered ? aboveGroundPoly(lx + dxL, ly + dyL, HW, HH, 132 + 66, 1) : null;
  for (let y = 0; y < s.h; y++) {
    const Y = Y0 + y;
    if (Y < 0 || Y >= c.h) continue;
    for (let x = 0; x < s.w; x++) {
      const X = X0 + x;
      if (X < 0 || X >= c.w) continue;
      if (poly && !inPoly(X + 0.5, Y + 0.5, poly)) continue;
      const si = ((s.y + y) * img.width + (s.x + x)) * 4;
      const a = img.data[si + 3] / 255;
      if (a === 0) continue;
      const di = (Y * c.w + X) * 4;
      c.px[di] = c.px[di] * (1 - a) + img.data[si] * a;
      c.px[di + 1] = c.px[di + 1] * (1 - a) + img.data[si + 1] * a;
      c.px[di + 2] = c.px[di + 2] * (1 - a) + img.data[si + 2] * a;
      c.px[di + 3] = 1;
    }
  }
}

/**
 * A size×size patch of one terrain kind drawn back-to-front (ty rows, then
 * tx — painter order), centred on canvas, optionally followed by ONE
 * structure sprite at the middle — drawn AFTER the whole patch, exactly like
 * the game's structures layer sits above the finished terrain plane.
 * Returns the canvas plus the centre tile's lattice point in canvas coords.
 */
async function drawPatch(
  size: number, kind: number, applyRule: boolean,
  structureName: string | null = null, structureRule = true,
) {
  const grid: Grid = {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(kind),
    industries: [], occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), seed: 1,
  };
  const mid = size >> 1;
  const c = makeCanvas(size * HW * 2 + 200, size * HH * 2 + 220);
  const [ox, oy] = tileToScreen(mid, mid);
  const dxL = c.w / 2 - ox, dyL = 90 - oy;
  for (let ty = 0; ty < size; ty++) {
    for (let tx = 0; tx < size; tx++) {
      await drawSprite(c, "terrain_grass", tx, ty, grid, applyRule, dxL, dyL);
    }
  }
  if (structureName) {
    // the structures layer: the terrain plane is already complete below
    await drawSprite(c, structureName, mid, mid, grid, structureRule, dxL, dyL);
  }
  return { c, cx: c.w / 2, cy: 90 };
}

// ── colour ranges (sampled from the shipped atlas) ──────────────────────────
// dirt skirt: grass/water/rough rgb(129,96,62), road rgb(150,112,73) + AA
const isBrown = (r: number, g: number, b: number) =>
  r > 100 && r < 200 && g > 70 && g < 160 && b < 110 && r - b > 40 && r > g && g > b;

function countIn(c: Canvas, x0: number, y0: number, x1: number, y1: number,
  pred: (r: number, g: number, b: number) => boolean): number {
  let n = 0;
  for (let y = Math.max(0, y0 | 0); y < Math.min(c.h, y1 | 0); y++) {
    for (let x = Math.max(0, x0 | 0); x < Math.min(c.w, x1 | 0); x++) {
      const i = (y * c.w + x) * 4;
      if (c.px[i + 3] === 0) continue;
      if (pred(c.px[i], c.px[i + 1], c.px[i + 2])) n++;
    }
  }
  return n;
}

// ── N1: the classification ──────────────────────────────────────────────────
describe("N1 skirtCovered — who is the coast", () => {
  const allGrass = (): Grid => ({
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries: [], occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), seed: 1,
  });

  it("an all-grass map is covered everywhere except the tx/ty rim", () => {
    const grid = allGrass();
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const rim = tx === MAP_W - 1 || ty === MAP_H - 1;
        expect(skirtCovered(grid, tx, ty), `(${tx},${ty})`).toBe(!rim);
      }
    }
  });

  it("water or the void in FRONT (SE/SW) makes a coast tile; behind does not", () => {
    const grid = allGrass();
    grid.terrain[10 * MAP_W + 11] = WATER;   // SE neighbour of (10,10)
    expect(skirtCovered(grid, 10, 10)).toBe(false);   // water in front → coast
    expect(skirtCovered(grid, 9, 10)).toBe(true);     // water BESIDE/behind is fine
    grid.terrain[10 * MAP_W + 10] = WATER;   // (10,10) itself is water…
    expect(skirtCovered(grid, 9, 9)).toBe(true);      // …only its FRONT matters
    expect(skirtCovered(grid, 10, 10)).toBe(false);   // its own front is the rim
  });

  it("on a generated island the coast is exactly the front-of-water/rim set", () => {
    const grid = generateMap(1337);
    let coast = 0, interior = 0;
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        if (grid.terrain[ty * MAP_W + tx] === WATER) continue;
        const se = tx + 1 < MAP_W ? grid.terrain[ty * MAP_W + tx + 1] : WATER;
        const sw = ty + 1 < MAP_H ? grid.terrain[(ty + 1) * MAP_W + tx] : WATER;
        const expectCoast = se === WATER || sw === WATER;
        expect(skirtCovered(grid, tx, ty)).toBe(!expectCoast);
        if (expectCoast) coast++; else interior++;
      }
    }
    expect(coast).toBeGreaterThan(20);     // a ragged coastline exists…
    expect(interior).toBeGreaterThan(400); // …around a large flat island
  });
});

// ── N1: the pixel acceptance ────────────────────────────────────────────────
//
// Measured reality this suite pins (the reason the terrain tests assert both
// directions): in back-to-front painter order a Kenney block's skirt is
// ALREADY fully covered by the tiles in front — the interior terrain leak
// the backlog predicted (50−32=18px) belongs to the pre-K-FIX-1 normalised
// art. On the terrain layer the N1 clip is therefore behaviour-preserving;
// the leak is real on the STRUCTURES layer, where road/building sprites are
// blitted ABOVE the completed terrain plane and their full block side
// browns-out the grass tile in front. That is "brown at the base of every
// road and building", and it is what the structure bites reproduce.
describe("N1 pixel acceptance — brown only at the coast", () => {
  const SIZE = 9;
  // the window strictly below the centre tile's lower edges — small enough
  // that no patch-rim skirt (legitimately drawn at the patch coast, ≥4 tiles
  // away on the lattice) can reach it, so ANY brown here is a leak.
  const W = 60;

  it("a fully-interior terrain tile shows ZERO brown below its diamond", async () => {
    const { c, cy } = await drawPatch(SIZE, GRASS, true);
    const brown = countIn(c, c.w / 2 - W, cy + HH - 8, c.w / 2 + W, cy + HH + W, isBrown);
    expect(brown, "brown pixels below an interior diamond").toBe(0);
  });

  it("the ground plane still tessellates — no background holes in the same window", async () => {
    const { c, cy } = await drawPatch(SIZE, GRASS, true);
    let holes = 0;
    for (let y = cy - HH + 2; y < cy + HH + W; y++) {
      for (let x = c.w / 2 - W; x < c.w / 2 + W; x++) {
        const i = (y * c.w + x) * 4;
        if (c.px[i + 3] === 0) { holes++; continue; }
        if (Math.abs(c.px[i] - BG[0]) < 4 && Math.abs(c.px[i + 1] - BG[1]) < 4 &&
          Math.abs(c.px[i + 2] - BG[2]) < 4) holes++;
      }
    }
    // A hairline of anti-aliased seam pixels (22 in this window) is inherent
    // to the art's soft diamond edges compositing over the clipped plane; a
    // REAL hole — a missing neighbour, a mis-sized clip — is hundreds+.
    expect(holes, "unpainted/background pixels in the interior window").toBeLessThan(60);
  });

  it("BITE — an interior road on the structures layer leaks brown without the rule", async () => {
    // the game's order: finished terrain plane below, the road blitted on top
    const { c, cy } = await drawPatch(SIZE, GRASS, true, "road_0011", false);
    const brown = countIn(c, c.w / 2 - W, cy + HH - 8, c.w / 2 + W, cy + HH + W, isBrown);
    expect(brown, "the pre-fix road browns out the grass tile in front")
      .toBeGreaterThan(100);
  });

  it("an interior road with the rule draws no skirt — flush on the plane, asphalt kept", async () => {
    const { c, cy } = await drawPatch(SIZE, GRASS, true, "road_0011", true);
    const brown = countIn(c, c.w / 2 - W, cy + HH - 8, c.w / 2 + W, cy + HH + W, isBrown);
    expect(brown, "brown pixels below an interior road").toBe(0);
    // the road's top face survives the clip: grey asphalt inside the diamond
    const asphalt = countIn(c, c.w / 2 - W, cy - HH + 4, c.w / 2 + W, cy + HH - 4,
      (r, g, b) => Math.abs(r - g) < 12 && Math.abs(g - b) < 12 && r > 80 && r < 140);
    expect(asphalt).toBeGreaterThan(300);
  });

  it("I1 — an interior building is byte-identical to its unclipped sprite", async () => {
    const withoutRule = await drawPatch(SIZE, GRASS, true, "farm", false);
    const withRule = await drawPatch(SIZE, GRASS, true, "farm", true);
    // This is intentionally stronger than counting one wall region: every
    // painted channel must survive. Reintroducing the old universal skirt
    // clip changes hundreds of pixels here.
    let drift = 0;
    for (let i = 0; i < withRule.c.px.length; i++) {
      if (withRule.c.px[i] !== withoutRule.c.px[i]) drift++;
    }
    expect(drift).toBe(0);
    expect(shouldClipGroundSkirt(
      { w: MAP_W, h: MAP_H, terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
        industries: [], occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), seed: 1 },
      manifest.sprites.farm, 10, 10,
    )).toBe(false);
  });

  it("a coast tile keeps its skirt — the island edge still shows its block side", async () => {
    // one grass tile in the sea: every front neighbour is the void → full block
    const grid: Grid = {
      w: MAP_W, h: MAP_H,
      terrain: new Uint8Array(MAP_W * MAP_H).fill(WATER),
      industries: [], occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), seed: 1,
    };
    grid.terrain[0] = GRASS;   // tile (0,0) — front neighbours (1,0),(0,1) water
    const c = makeCanvas(400, 300);
    await drawSprite(c, "terrain_grass", 0, 0, grid, true, c.w / 2, 120);
    const brown = countIn(c, c.w / 2 - W, 120 + HH - 8, c.w / 2 + W, 120 + HH + W, isBrown);
    expect(brown, "the coastline must keep its brown block side").toBeGreaterThan(200);
  });

  it("a coast ROAD keeps its skirt too — edge structures keep their block side", async () => {
    const grid: Grid = {
      w: MAP_W, h: MAP_H,
      terrain: new Uint8Array(MAP_W * MAP_H).fill(WATER),
      industries: [], occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), seed: 1,
    };
    grid.terrain[0] = GRASS;   // tile (0,0) is land — a road on the beach
    const c = makeCanvas(400, 300);
    await drawSprite(c, "road_0011", 0, 0, grid, true, c.w / 2, 120);
    const brown = countIn(c, c.w / 2 - W, 120 + HH - 8, c.w / 2 + W, 120 + HH + W, isBrown);
    expect(brown, "a road on the coast keeps its block side").toBeGreaterThan(100);
  });
});

// ── N4: one convention — picking agrees with the brush ─────────────────────
describe("N4 flatPick is the exact inverse of the drawn lattice", () => {
  const inDrawnDiamond = (wx: number, wy: number, tx: number, ty: number) => {
    const [cx, cy] = tileToScreen(tx, ty);
    return Math.abs(wx - cx) / HW + Math.abs(wy - cy) / HH <= 1;
  };

  it("flatPick(p) is a tile whose DRAWN diamond contains p (sampled widely)", () => {
    for (let tx = 2; tx < 12; tx++) {
      for (let ty = 2; ty < 12; ty++) {
        const [cx, cy] = tileToScreen(tx, ty);
        for (const [ox, oy] of [[0, 0], [HW / 2, 0], [0, HH / 2], [-HW / 2, -HH / 2],
          [HW / 2 - 1, HH - 1], [1, 1], [-1, -1]] as [number, number][]) {
          const wx = cx + ox, wy = cy + oy;
          const [gx, gy] = flatPick(wx, wy);
          expect(inDrawnDiamond(wx, wy, gx, gy),
            `flatPick(${wx},${wy}) → (${gx},${gy}) must contain it`)
            .toBe(true);
        }
      }
    }
  });

  it("round-trips every tile centre and stays put a hair inside each vertex", () => {
    for (let tx = 0; tx < MAP_W; tx++) {
      for (let ty = 0; ty < MAP_H; ty++) {
        const [sx, sy] = tileToScreen(tx, ty);
        expect(flatPick(sx, sy)).toEqual([tx, ty]);
        expect(flatPick(sx, sy - 1)).toEqual([tx, ty]);      // 1px inside the apex
        expect(flatPick(sx, sy + HH - 1)).toEqual([tx, ty]); // 1px inside the S vertex
      }
    }
  });

  it("anchors on the DRAWN lattice: the apex belongs to its own tile", () => {
    // the drawn diamond's top vertex is one lattice row above its centre —
    // a cursor there must stay on this tile, not hand the seam to the tile
    // behind. (This is the property the old +HH sample expressed; the unified
    // inverse keeps it without the second convention.)
    const [sx, sy] = tileToScreen(6, 6);
    expect(flatPick(sx, sy - HH)).toEqual([6, 6]);     // the apex → its own tile
    expect(flatPick(sx, sy - HH - 1)).toEqual([5, 5]); // 1px above → the tile behind
  });
});

describe("I1/I4 stage-2 pick matches the ground-only clip", () => {
  const grid = {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries: [], occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), seed: 1,
  } satisfies Grid;
  void grid;
  const placed = (name: string, tx: number, ty: number, clipped: boolean): Placed => {
    const p = place(atlas, { sprite: name, tx, ty })!;
    p.clipped = clipped;
    return p;
  };

  it("an inland ground overlay is not picked in its undrawn skirt", () => {
    const p = placed("road_0101", 10, 10, true);
    const [cx, cy] = tileToScreen(10, 10);
    const px = cx, py = cy + HH + 12; // below the S vertex, inside the sprite
    expect(atlas.opaqueAt("road_0101", px - p.wx, py - p.wy)).toBe(true);
    expect(pickSprite(atlas, [p], px, py)).toBeNull();
  });

  it("the same point on a coastal ground overlay remains pickable", () => {
    const p = placed("road_0101", 10, 10, false);
    const [cx, cy] = tileToScreen(10, 10);
    expect(pickSprite(atlas, [p], cx, cy + HH + 12)).toBe(p);
  });

  it("a standing building is never marked clipped and remains pickable whole", () => {
    const p = placed("farm", 10, 10, false);
    const [cx, cy] = tileToScreen(10, 10);
    expect(pickSprite(atlas, [p], cx, cy + HH + 12)).toBe(p); // complete base/wall
    expect(pickSprite(atlas, [p], cx, cy - 49)).toBe(p);      // tower
  });
});
