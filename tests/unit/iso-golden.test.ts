// I0 — deterministic, pixel-level renderer fixture at all shipped zooms.
//
// CI has no browser canvas, so this extends the software-rasteriser approach
// from iso-skirt.test.ts to a complete scene. It consumes the real zoom atlas,
// real manifest, real anchor/depth math and the renderer's real skirt/pick
// predicates. The committed PNGs make visual drift reviewable and block it in
// `npm test`; set UPDATE_ISO_GOLDENS=1 to intentionally refresh them.
import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { Atlas, type Manifest, type SpriteDef } from "../../src/iso/atlas";
import { depthSort, place, type DrawItem, type Placed } from "../../src/iso/depth";
import {
  aboveGroundPoly, flatPick, GROUND_OVERLAP, shouldClipGroundSkirt, skirtCovered,
  structureSkirtPoly,
} from "../../src/iso/renderer";
import { screenToWorld, worldToScreen, type Camera } from "../../src/iso/camera";
import { GRASS, WATER, type Grid } from "../../src/iso/grid";
import { BLOCK_H, HH, HW, MAP_H, MAP_W, TILE_H, tileToScreen, type Zoom } from "../../src/game/config";

const manifest: Manifest = JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8"));
const atlas = new Atlas(manifest);
const ZOOMS = [0.5, 1, 2] as const;
const WIDTH = 1280, HEIGHT = 720;
const BG = [11, 26, 38, 255] as const;
const GOLDEN_DIR = "tests/fixtures/iso-golden";

type Surface = { data: Uint8ClampedArray; width: number; height: number };
type Poly = [number, number][];
type AtlasPixels = { data: Buffer; width: number; height: number };
type FixtureResult = {
  scene: Surface;
  terrain: Surface;
  grid: Grid;
  cam: Camera;
  hover: [number, number];
};

const atlasPixels = new Map<Zoom, AtlasPixels>();
const results = new Map<Zoom, FixtureResult>();

function surface(transparent = false): Surface {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  if (!transparent) {
    for (let i = 0; i < WIDTH * HEIGHT; i++) data.set(BG, i * 4);
  }
  return { data, width: WIDTH, height: HEIGHT };
}

function inPoly(x: number, y: number, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function blendPixel(dst: Uint8ClampedArray, di: number, src: Buffer, si: number): void {
  const sa = src[si + 3] / 255;
  if (sa <= 0) return;
  const da = dst[di + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  for (let c = 0; c < 3; c++) {
    dst[di + c] = Math.round((src[si + c] * sa + dst[di + c] * da * (1 - sa)) / oa);
  }
  dst[di + 3] = Math.round(oa * 255);
}

/**
 * Nearest-neighbour drawImage twin over the already-resampled zoom atlas.
 *
 * `Math.round(def.* * zoom)` matches `tools/slice-atlas.mjs`: at each zoom the
 * packer resizes each sprite to `Math.round(w*z) × Math.round(h*z)` and places
 * it at `Math.round(x*z), Math.round(y*z)`. The real renderer sources those
 * integer rects (`Atlas.zoomRect`); this twin must do the same or the golden
 * images would encode the old fractional-rect behavior that crops art at 0.5×.
 */
function drawDef(
  target: Surface, pixels: AtlasPixels, def: SpriteDef, zoom: Zoom,
  dx: number, dy: number, clip: Poly | null = null,
): void {
  const dw = Math.round(def.w * zoom), dh = Math.round(def.h * zoom);
  const sx = Math.round(def.x * zoom), sy = Math.round(def.y * zoom);
  const sw = dw, sh = dh;
  for (let y = 0; y < dh; y++) {
    const yy = dy + y;
    if (yy < 0 || yy >= target.height) continue;
    const ay = Math.min(pixels.height - 1, Math.floor(sy + (y + 0.5) * sh / dh));
    for (let x = 0; x < dw; x++) {
      const xx = dx + x;
      if (xx < 0 || xx >= target.width) continue;
      if (clip && !inPoly(xx + 0.5, yy + 0.5, clip)) continue;
      const ax = Math.min(pixels.width - 1, Math.floor(sx + (x + 0.5) * sw / dw));
      blendPixel(target.data, (yy * target.width + xx) * 4, pixels.data, (ay * pixels.width + ax) * 4);
    }
  }
}

function drawPlaced(
  target: Surface, pixels: AtlasPixels, p: Placed, cam: Camera, clipSkirt: boolean,
): void {
  const clip = clipSkirt ? structureSkirtPoly(p, cam) : null;
  if (p.def.parts) {
    for (const part of p.def.parts) {
      const def = atlas.get(part.sprite)!;
      const [sx, sy] = worldToScreen(cam, p.wx + part.dx, p.wy + part.dy);
      drawDef(target, pixels, def, cam.zoom, Math.floor(sx), Math.floor(sy), clip);
    }
    return;
  }
  const [sx, sy] = worldToScreen(cam, p.wx, p.wy);
  drawDef(target, pixels, p.def, cam.zoom, Math.floor(sx), Math.floor(sy), clip);
}

function fixtureGrid(): Grid {
  const terrain = new Uint8Array(MAP_W * MAP_H).fill(WATER);
  // A five-by-five field gives empty interior, road/building tiles, and a
  // visible SE/SW coastline in one compact deterministic scene.
  for (let ty = 11; ty <= 15; ty++) {
    for (let tx = 11; tx <= 15; tx++) terrain[ty * MAP_W + tx] = GRASS;
  }
  return {
    w: MAP_W, h: MAP_H, terrain, industries: [],
    occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), seed: 0x10,
  };
}

async function renderFixture(zoom: Zoom): Promise<FixtureResult> {
  const pixels = atlasPixels.get(zoom)!;
  const grid = fixtureGrid();
  const [mwx, mwy] = tileToScreen(13, 13);
  const cam: Camera = {
    x: WIDTH / 2 - mwx * zoom,
    y: 300 - mwy * zoom,
    zoom, vw: WIDTH, vh: HEIGHT,
  };
  const terrain = surface(true);

  // Same terrain placement and clip math as renderer.chunkCanvas. The range
  // includes one water ring so the coastline is visible against the sea.
  const terrainTiles: [number, number][] = [];
  for (let ty = 10; ty <= 16; ty++) for (let tx = 10; tx <= 16; tx++) terrainTiles.push([tx, ty]);
  terrainTiles.sort(([ax, ay], [bx, by]) => (ax + ay) - (bx + by) || (ax - ay) - (bx - by));
  for (const [tx, ty] of terrainTiles) {
    const name = grid.terrain[ty * MAP_W + tx] === WATER ? "terrain_water" : "terrain_grass";
    const def = atlas.get(name)!;
    const [wx, wy] = tileToScreen(tx, ty);
    const [sx, sy] = worldToScreen(cam, wx - def.anchor[0], wy - def.anchor[1]);
    const [cx, cy] = worldToScreen(cam, wx, wy);
    const clip = skirtCovered(grid, tx, ty)
      ? aboveGroundPoly(
        cx, cy, (HW + GROUND_OVERLAP) * zoom,
        (HH + GROUND_OVERLAP) * zoom, (TILE_H + BLOCK_H) * zoom,
      )
      : null;
    drawDef(terrain, pixels, def, zoom, Math.floor(sx), Math.floor(sy), clip);
  }

  const scene = surface();
  // Composite the transparent terrain layer over the game background.
  const terrainBuffer = Buffer.from(
    terrain.data.buffer, terrain.data.byteOffset, terrain.data.byteLength,
  );
  for (let i = 0; i < terrain.data.length; i += 4) {
    blendPixel(scene.data, i, terrainBuffer, i);
  }

  const structures: DrawItem[] = [
    { sprite: "road_0101", tx: 13, ty: 11 },       // straight, inland
    { sprite: "road_0011", tx: 14, ty: 11 },       // corner, inland
    { sprite: "farm", tx: 11, ty: 14 },            // one-piece industry
    { sprite: "factory_blue", tx: 14, ty: 14 },    // five-layer stack
  ];
  const placed = structures.map((item) => place(atlas, item)!).filter(Boolean);
  for (const p of depthSort(placed).order) {
    drawPlaced(scene, pixels, p, cam, shouldClipGroundSkirt(grid, p.def, p.tx, p.ty));
  }

  // The real overlay path does not skirt-clip placement highlights.
  const hover: [number, number] = [11, 11];
  drawPlaced(scene, pixels, place(atlas, { sprite: "highlight", tx: hover[0], ty: hover[1] })!, cam, false);
  return { scene, terrain, grid, cam, hover };
}

function countOpaque(s: Surface): number {
  let n = 0;
  for (let i = 3; i < s.data.length; i += 4) if (s.data[i] > 8) n++;
  return n;
}

function isBrown(r: number, g: number, b: number): boolean {
  return r > 95 && r < 205 && g > 65 && g < 165 && b < 115 && r - b > 35 && r > g && g > b;
}

function countBrown(s: Surface, x0: number, y0: number, x1: number, y1: number): number {
  let n = 0;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(s.height, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(s.width, Math.ceil(x1)); x++) {
      const i = (y * s.width + x) * 4;
      if (isBrown(s.data[i], s.data[i + 1], s.data[i + 2])) n++;
    }
  }
  return n;
}

async function savePng(path: string, s: Surface): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  await sharp(Buffer.from(s.data), {
    raw: { width: s.width, height: s.height, channels: 4 },
  }).png().toFile(path);
}

beforeAll(async () => {
  await Promise.all(ZOOMS.map(async (zoom) => {
    const file = `assets/iso-atlas/${manifest.images[String(zoom)]}`;
    const { data, info } = await sharp(file, { limitInputPixels: false })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    atlasPixels.set(zoom, { data: Buffer.from(data), width: info.width, height: info.height });
  }));
  for (const zoom of ZOOMS) results.set(zoom, await renderFixture(zoom));
  if (process.env.UPDATE_ISO_GOLDENS === "1") {
    await Promise.all(ZOOMS.map((zoom) =>
      savePng(join(GOLDEN_DIR, `scene-${zoom}x.png`), results.get(zoom)!.scene)));
  }
}, 30_000);

describe("I0 golden-image scene", () => {
  for (const zoom of ZOOMS) {
    it(`${zoom}× matches its committed reference PNG`, async () => {
      const path = join(GOLDEN_DIR, `scene-${zoom}x.png`);
      expect(existsSync(path), `missing ${path}; run UPDATE_ISO_GOLDENS=1 npm test`).toBe(true);
      const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const actual = results.get(zoom)!.scene;
      expect([info.width, info.height]).toEqual([actual.width, actual.height]);
      let drift = 0;
      for (let i = 0; i < data.length; i++) if (Math.abs(data[i] - actual.data[i]) > 2) drift++;
      expect(drift, `${zoom}× channels drifted beyond the 2/255 AA tolerance`).toBe(0);
    });
  }

  it("building-intact: the stacked factory keeps at least 98% of its unclipped pixels", () => {
    for (const zoom of ZOOMS) {
      const pixels = atlasPixels.get(zoom)!;
      const grid = fixtureGrid();
      const cam: Camera = { x: 400, y: 350, zoom, vw: WIDTH, vh: HEIGHT };
      const p = place(atlas, { sprite: "factory_blue", tx: 0, ty: 0 })!;
      const expected = surface(true), actual = surface(true);
      drawPlaced(expected, pixels, p, cam, false);
      drawPlaced(actual, pixels, p, cam, shouldClipGroundSkirt(grid, p.def, 12, 12));
      const ratio = countOpaque(actual) / countOpaque(expected);
      expect(ratio, `${zoom}× opaque ratio`).toBeGreaterThanOrEqual(0.98);
      expect(shouldClipGroundSkirt(grid, p.def, 12, 12)).toBe(false);
    }
  });

  it("no-interior-brown: empty inland ground has no skirt below its diamond", () => {
    for (const zoom of ZOOMS) {
      const { terrain, cam } = results.get(zoom)!;
      for (const [tx, ty] of [[12, 13], [13, 13]] as [number, number][]) {
        const [wx, wy] = tileToScreen(tx, ty);
        const [cx, cy] = worldToScreen(cam, wx, wy);
        const brown = countBrown(
          terrain,
          cx - 24 * zoom, cy + (HH + 2) * zoom,
          cx + 24 * zoom, cy + (HH + 24) * zoom,
        );
        expect(brown, `${zoom}× inland tile (${tx},${ty})`).toBe(0);
      }
    }
  });

  it("highlight==base: highlight, pick and a building anchor resolve to one tile", () => {
    for (const zoom of ZOOMS) {
      const { cam, hover } = results.get(zoom)!;
      const [wx, wy] = tileToScreen(...hover);
      const [sx, sy] = worldToScreen(cam, wx, wy);
      const picked = flatPick(...screenToWorld(cam, sx, sy));
      const h = place(atlas, { sprite: "highlight", tx: hover[0], ty: hover[1] })!;
      const b = place(atlas, { sprite: "factory_blue", tx: hover[0], ty: hover[1] })!;
      expect(picked).toEqual(hover);
      expect([h.wx + h.def.anchor[0], h.wy + h.def.anchor[1]]).toEqual([wx, wy]);
      expect([b.wx + b.def.anchor[0], b.wy + b.def.anchor[1]]).toEqual([wx, wy]);
    }
  });

  it("I5 has no transparent hard seam through the interior field", () => {
    for (const zoom of ZOOMS) {
      const { terrain, cam } = results.get(zoom)!;
      // Probe the shared edge between (12,13) and (13,13), excluding its AA
      // endpoints. Soft edge alpha is allowed; a hard gap has alpha 0.
      const a = worldToScreen(cam, ...tileToScreen(12, 13));
      const b = worldToScreen(cam, ...tileToScreen(13, 13));
      let holes = 0, probes = 0;
      for (let t = 0.2; t <= 0.8; t += 0.02) {
        const x = Math.round(a[0] + (b[0] - a[0]) * t);
        const y = Math.round(a[1] + (b[1] - a[1]) * t);
        for (const oy of [-1, 0, 1]) {
          const i = ((y + oy) * terrain.width + x) * 4;
          probes++;
          if (terrain.data[i + 3] === 0) holes++;
        }
      }
      expect(holes, `${zoom}× hard seam holes of ${probes}`).toBe(0);
    }
  });
});
