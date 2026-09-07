// I0 — deterministic, pixel-level renderer fixture at all shipped zooms.
//
// CI has no browser canvas, so this extends a software rasteriser to a complete
// scene. It consumes the real zoom atlas, real manifest, real anchor/depth math
// and the real flat draw path (declared xrel/yrel anchor on the footprint's
// SOUTH corner; terrain chunk origin + integer-packed zoom source rects; 1:1
// blits — the flat renderer never scales inside drawImage). The committed PNGs
// make visual drift reviewable and block it in `npm test`; set
// UPDATE_ISO_GOLDENS=1 to intentionally refresh them.
import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { Atlas, type Manifest, type SpriteDef } from "../../src/iso/atlas";
import { depthSort, place, type DrawItem, type Placed } from "../../src/iso/depth";
import { screenToWorld, worldToScreen, type Camera } from "../../src/iso/camera";
import { flatPick, chunkWorldOrigin, CHUNK } from "../../src/iso/renderer";
import { GRASS, WATER, type Grid } from "../../src/iso/grid";
import { HH, HW, MAP_H, MAP_W, TILE_H, tileToScreen, type Zoom } from "../../src/game/config";

const manifest: Manifest = JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8"));
const atlas = new Atlas(manifest);
const ZOOMS = [0.5, 1, 2] as const;
const WIDTH = 1280, HEIGHT = 720;
const BG = [11, 26, 38, 255] as const;
const GOLDEN_DIR = "tests/fixtures/iso-golden";

type Surface = { data: Uint8ClampedArray; width: number; height: number };
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
 * 1:1 blit of the integer-packed zoomed source rect. The flat renderer never
 * scales inside drawImage: `tools/slice-atlas.mjs` resizes each sprite to
 * `Math.round(w*z) × Math.round(h*z)` and places it at
 * `Math.round(x*z), Math.round(y*z)`, and the renderer blits that rect 1:1.
 */
function drawDef(
  target: Surface, pixels: AtlasPixels, def: SpriteDef, zoom: Zoom,
  dx: number, dy: number,
): void {
  const sw = Math.round(def.w * zoom), sh = Math.round(def.h * zoom);
  const sx = Math.round(def.x * zoom), sy = Math.round(def.y * zoom);
  for (let y = 0; y < sh; y++) {
    const yy = dy + y;
    if (yy < 0 || yy >= target.height) continue;
    const ay = sy + y;
    if (ay < 0 || ay >= pixels.height) continue;
    for (let x = 0; x < sw; x++) {
      const xx = dx + x;
      if (xx < 0 || xx >= target.width) continue;
      const ax = sx + x;
      if (ax < 0 || ax >= pixels.width) continue;
      blendPixel(
        target.data, (yy * target.width + xx) * 4,
        pixels.data, (ay * pixels.width + ax) * 4,
      );
    }
  }
}

function drawPlaced(target: Surface, pixels: AtlasPixels, p: Placed, cam: Camera): void {
  const [sx, sy] = worldToScreen(cam, p.wx, p.wy);
  drawDef(target, pixels, p.def, cam.zoom, Math.floor(sx), Math.floor(sy));
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

  // Terrain, exactly as renderer.chunkCanvas blits it: per-chunk surface at
  // chunkWorldOrigin, each tile drawn at (wx, wy) − chunk origin, then the
  // chunk blitted at floor(worldToScreen(origin)). Replicated rather than
  // re-derived so a chunk-offset drift shows up here as a pixel drift.
  const terrainTiles: [number, number][] = [];
  for (let ty = 10; ty <= 16; ty++) for (let tx = 10; tx <= 16; tx++) terrainTiles.push([tx, ty]);
  terrainTiles.sort(([ax, ay], [bx, by]) => (ax + ay) - (bx + by) || (ax - ay) - (bx - by));
  for (const [tx, ty] of terrainTiles) {
    const name = grid.terrain[ty * MAP_W + tx] === WATER ? "terrain_water" : "terrain_grass";
    const def = atlas.get(name)!;
    const cx = (tx / CHUNK) | 0, cy = (ty / CHUNK) | 0;
    const [ox, oy] = chunkWorldOrigin(cx, cy);
    const wx = (tx - ty) * HW + HW - def.anchor[0];
    const wy = (tx + ty) * HH + TILE_H - def.anchor[1];
    const [bx, by] = worldToScreen(cam, ox, oy);
    const dx = Math.floor((wx - ox) * zoom) + Math.floor(bx);
    const dy = Math.floor((wy - oy) * zoom) + Math.floor(by);
    drawDef(terrain, pixels, def, zoom, dx, dy);
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
    { sprite: "factory_blue", tx: 14, ty: 14 },    // tall single-sprite works
  ];
  const placed = structures.map((item) => place(atlas, item)!).filter(Boolean);
  for (const p of depthSort(placed).order) {
    drawPlaced(scene, pixels, p, cam);
  }

  // The placement highlight is drawn on the overlay, whole (no clip).
  const hover: [number, number] = [11, 11];
  drawPlaced(scene, pixels, place(atlas, { sprite: "highlight", tx: hover[0], ty: hover[1] })!, cam);
  return { scene, terrain, grid, cam, hover };
}

function countOpaque(s: Surface): number {
  let n = 0;
  for (let i = 3; i < s.data.length; i += 4) if (s.data[i] > 8) n++;
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

  it("building-intact: a single-sprite works draws whole at every zoom (flat tiles never clip)", () => {
    for (const zoom of ZOOMS) {
      const pixels = atlasPixels.get(zoom)!;
      // place far inside so the sprite (up to 128×156 at 2×) cannot hit an edge
      const cam: Camera = { x: 100, y: 200, zoom, vw: WIDTH, vh: HEIGHT };
      const p = place(atlas, { sprite: "factory_blue", tx: 0, ty: 0 })!;
      const drawn = surface(true);
      drawPlaced(drawn, pixels, p, cam);
      // no skirt/clip machinery exists, so every opaque pixel of the sprite's
      // frame-0 rect lands — the flat renderer cannot lop the tower off.
      const frameW = Math.round((p.def.w / (p.def.frames ?? 1)) * zoom);
      const frameH = Math.round(p.def.h * zoom);
      const sx = Math.round(p.def.x * zoom), sy = Math.round(p.def.y * zoom);
      const srcOpaque = (() => {
        let n = 0;
        for (let y = 0; y < frameH; y++) for (let x = 0; x < frameW; x++) {
          const ax = sx + x, ay = sy + y;
          if (ax >= pixels.width || ay >= pixels.height) continue;
          if (pixels.data[(ay * pixels.width + ax) * 4 + 3] > 8) n++;
        }
        return n;
      })();
      expect(srcOpaque, "factory_blue has no opaque pixels").toBeGreaterThan(0);
      expect(countOpaque(drawn), `${zoom}× opaque pixels`).toBe(srcOpaque);
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
      // flat anchor: the declared anchor lands on the SOUTH corner, i.e. the
      // top vertex shifted by (+HW, +TILE_H).
      expect([h.wx + h.def.anchor[0], h.wy + h.def.anchor[1]]).toEqual([wx + HW, wy + TILE_H]);
      expect([b.wx + b.def.anchor[0], b.wy + b.def.anchor[1]]).toEqual([wx + HW, wy + TILE_H]);
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
