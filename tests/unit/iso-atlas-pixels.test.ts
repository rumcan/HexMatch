import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { toOpenttdRoadBits } from "../../src/iso/track";
import { parsePnml } from "../../tools/parse-pnml.mjs";

const manifest = JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8")) as {
  sprites: Record<string, { x: number; y: number; w: number; h: number; frames?: number }>;
};
const cells = JSON.parse(readFileSync("tools/iso-atlas.cells.json", "utf8")) as {
  sprites: { name: string; namePrefix?: string; trackset?: { mode: string; base?: number; table?: number[]; ground?: number; pieces?: { sprite: number; dirs: number[] }[] } }[];
};

/** OpenTTD's flat road selection table, as declared in the cells file. */
const roadCell = cells.sprites.find((c) => c.name === "road")!;
const ROAD_BASE = roadCell.trackset!.base!;
const ROAD_TABLE = roadCell.trackset!.table!;

const ARMS: Record<number, [number, number]> = {
  1: [48, 8],
  2: [48, 24],
  4: [16, 24],
  8: [16, 8],
};

/** Declared OpenGFX geometry, parsed straight from the PNML so the
 * test never depends on the gitignored tools/opengfx-sprites.json artifact. */
function declarations() {
  return parsePnml() as unknown as Record<string, { file: string; x: number; y: number; w: number; h: number; xrel: number; yrel: number }>;
}

type Raw = { data: Buffer; info: { width: number; height: number } };
let atlasRaw: Raw | null = null;
async function atlas(): Promise<Raw> {
  if (!atlasRaw) {
    const sharp = (await import("sharp")).default;
    atlasRaw = await sharp("assets/iso-atlas/atlas@1x.png").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  }
  return atlasRaw;
}
const sheetCache = new Map<string, Raw>();
async function sheet(file: string): Promise<Raw> {
  if (!sheetCache.has(file)) {
    const sharp = (await import("sharp")).default;
    sheetCache.set(file, await sharp(`src/assets/sprites/png/${file}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
  }
  return sheetCache.get(file)!;
}

/** The slicer's keying: blue backing + id-label glyphs + border white → transparent. */
function keyed(r: number, g: number, b: number, a: number): boolean {
  if (a === 0) return true;
  if (r === 0 && g === 0 && b === 255) return true;
  if (b > 90 && b > r + 30 && b > g + 30) return true;
  return false;
}

/** Grey road surface / dashed lane marking (not grass, not key). */
function isRoadColour(r: number, g: number, b: number, a: number): boolean {
  if (a === 0) return false;
  if (keyed(r, g, b, a)) return false;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), lum = (r + g + b) / 3;
  if (max - min >= 60) return false;
  if (g > r + 6 && g > b + 6) return false;
  return lum > 40 && lum < 215;
}

describe("G1/G2 atlas pixels", () => {
  it("Y4c: every road mask is pixel-identical to its declared OpenGFX tile", async () => {
    // The generator is gone: road_<mask> must BE the declared sprite
    // 1332 + TABLE[toOpenttdRoadBits(mask)], keyed exactly as the slicer keys.
    const { data, info } = await atlas();
    const decls = declarations();
    const src = await sheet("infrastructure/infra06.png");
    for (let mask = 0; mask < 16; mask++) {
      const key = `road_${mask.toString(2).padStart(4, "0")}`;
      const s = manifest.sprites[key];
      expect(s, key).toBeTruthy();
      const id = ROAD_BASE + ROAD_TABLE[toOpenttdRoadBits(mask)];
      const d = decls[String(id)];
      expect(d, `declared road sprite ${id}`).toBeTruthy();
      expect([s.w, s.h], `${key} size vs declared ${id}`).toEqual([d.w, d.h === 31 ? 32 : d.h]);
      for (let y = 0; y < d.h; y++) {
        for (let x = 0; x < d.w; x++) {
          const si = ((d.y + y) * src.info.width + (d.x + x)) * 4;
          const ai = ((s.y + y) * info.width + (s.x + x)) * 4;
          const transparent = keyed(src.data[si], src.data[si + 1], src.data[si + 2], src.data[si + 3]);
          expect(data[ai + 3] === 0, `${key} (${x},${y}) alpha mismatch vs declared ${id}`).toBe(transparent);
          if (!transparent) {
            expect([data[ai], data[ai + 1], data[ai + 2]], `${key} (${x},${y}) colour vs declared ${id}`)
              .toEqual([src.data[si], src.data[si + 1], src.data[si + 2]]);
          }
        }
      }
    }
  });

  it("Y4c: road arms carry road surface at set edge midpoints and none at unset ones", async () => {
    const { data, info } = await atlas();
    const sample = (sx: number, sy: number, px: number, py: number) => {
      const i = ((sy + py) * info.width + (sx + px)) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]] as const;
    };
    // Count road-surface pixels in a window around an edge midpoint: a real
    // arm crosses the window in a broad band, grass speckle contributes at
    // most a pixel or two.
    const roadCount = (sx: number, sy: number, mx: number, my: number, r: number) => {
      let n = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const [rr, gg, bb, aa] = sample(sx, sy, mx + dx, my + dy);
        if (isRoadColour(rr, gg, bb, aa)) n++;
      }
      return n;
    };
    for (let mask = 1; mask < 16; mask++) {
      const key = `road_${mask.toString(2).padStart(4, "0")}`;
      const s = manifest.sprites[key];
      for (const bit of [1, 2, 4, 8]) {
        const [mx, my] = ARMS[bit];
        if (mask & bit) {
          expect(roadCount(s.x, s.y, mx, my, 3), `${key} missing arm ${bit}`).toBeGreaterThanOrEqual(10);
        } else {
          expect(roadCount(s.x, s.y, mx, my, 3), `${key} stray arm ${bit}`).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it("Y4c: a straight road is a full-width grey surface with centre lane markings (sprite 1332)", async () => {
    const { data, info } = await atlas();
    // OpenTTD's table maps the SE|NW straight (our mask SE|NW = 2|8) to offset
    // 0 — declared sprite 1332, the one the ticket names.
    expect(ROAD_BASE + ROAD_TABLE[toOpenttdRoadBits(2 | 8)]).toBe(1332);
    const s = manifest.sprites.road_1010;
    // The dashed centre line: white-ish lane markings plus a broad grey road
    // surface across the whole declared tile.
    let markings = 0, grey = 0, opaque = 0;
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const i = ((s.y + y) * info.width + (s.x + x)) * 4;
        const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
        if (a === 0) continue;
        opaque++;
        const lum = (r + g + b) / 3;
        if (lum > 215 && Math.max(r, g, b) - Math.min(r, g, b) < 40) markings++;
        else if (isRoadColour(r, g, b, a)) grey++;
      }
    }
    expect(opaque, "full-width tile surface").toBeGreaterThan(900);
    expect(markings, "dashed centre markings").toBeGreaterThan(3);
    expect(grey, "grey road surface").toBeGreaterThan(200);
  });

  it("X4: two adjacent declared road pieces tile seamlessly (no gap at the join)", async () => {
    // Rewritten for Y4c: the pieces are now finished declared tiles, so the
    // join test asserts the road *surface* is continuous across the shared
    // edge rather than asserting stamped arm endpoints.
    const { data, info } = await atlas();
    const s = manifest.sprites.road_0101; // NE|SW straight
    // Real screen offsets: draw position is topVertex + (HW-anchorX, TILE_H-anchorY).
    const draw = (tx: number, ty: number): [number, number] =>
      [(tx - ty) * 32 + 32 - s.w / 2 + 0, (tx + ty) * 16 + 32 - s.h + 1];
    const W = 128, H = 96;
    const dst = Buffer.alloc(W * H * 4);
    const blitAt = (dx: number, dy: number) => {
      for (let y = 0; y < s.h; y++) {
        for (let x = 0; x < s.w; x++) {
          const X = dx + x, Y = dy + y;
          if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
          const si = ((s.y + y) * info.width + (s.x + x)) * 4;
          const di = (Y * W + X) * 4;
          const a = data[si + 3] / 255;
          if (a === 0) continue;
          dst[di] = data[si]; dst[di + 1] = data[si + 1]; dst[di + 2] = data[si + 2]; dst[di + 3] = 255;
        }
      }
    };
    const [ax, ay] = draw(0, 0);
    const [bx, by] = draw(0, 1); // SW neighbour
    blitAt(ax, ay);
    blitAt(bx, by);
    // Walk the road centre line from tile A's centre to tile B's centre: the
    // declared pieces must hand over with no unpainted gap at the join.
    const ca = [ax + 32, ay + 16], cb = [bx + 32, by + 16];
    let gaps = 0;
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const x = Math.round(ca[0] + (cb[0] - ca[0]) * t);
      const y = Math.round(ca[1] + (cb[1] - ca[1]) * t);
      let road = false;
      for (let dy = -1; dy <= 1 && !road; dy++) for (let dx = -1; dx <= 1 && !road; dx++) {
        const i = ((y + dy) * W + (x + dx)) * 4;
        if (dst[i + 3] > 0 && isRoadColour(dst[i], dst[i + 1], dst[i + 2], dst[i + 3])) road = true;
      }
      if (!road) gaps++;
    }
    expect(gaps, "unpainted samples along the road centre line across the join").toBe(0);
  });

  it("Y4c: rail masks are declared ground + declared overlay pieces (no generator)", async () => {
    const { data, info } = await atlas();
    const decls = declarations();
    const rail = cells.sprites.find((c) => c.name === "rail")!.trackset!;
    const src = await sheet(decls[String(rail.ground)].file.replace(/^sprites\/png\//, ""));
    const ovl = await sheet("infrastructure/infra06.png");
    const px = (raw: Raw, x: number, y: number) => {
      const i = (y * raw.info.width + x) * 4;
      return [raw.data[i], raw.data[i + 1], raw.data[i + 2], raw.data[i + 3]] as const;
    };
    // rail_0000 is exactly the declared grass ground tile. The grass sheet's
    // page background is white (removed by the slicer's border-white flood),
    // so white counts as transparent here too.
    const g = decls[String(rail.ground)];
    const s0 = manifest.sprites.rail_0000;
    const gone = (r: number, gg: number, b: number, a: number) =>
      keyed(r, gg, b, a) || (r > 250 && gg > 250 && b > 250);
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const [r, gg, b, a] = px(src, g.x + x, g.y + y);
        const ai = ((s0.y + y) * info.width + (s0.x + x)) * 4;
        expect(data[ai + 3] === 0, `rail_0000 (${x},${y})`).toBe(gone(r, gg, b, a));
      }
    }
    // rail_0101 (NE|SW) carries the declared 1005 overlay at its declared offset.
    const piece = rail.pieces!.find((p) => p.sprite === 1005)!;
    const d = decls["1005"];
    const s = manifest.sprites.rail_0101;
    let overlayPixels = 0;
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        const [r, gg, b, a] = px(ovl, d.x + x, d.y + y);
        if (keyed(r, gg, b, a)) continue;
        // overlay pixel lands at cell (xrel+x, yrel+y) shifted by the cell origin
        const cx = d.xrel + x + 31, cy = d.yrel + y;
        const ai = ((s.y + cy) * info.width + (s.x + cx)) * 4;
        if (data[ai + 3] > 0 && data[ai] === r && data[ai + 1] === gg && data[ai + 2] === b) overlayPixels++;
      }
    }
    expect(piece).toBeTruthy();
    expect(overlayPixels, "declared rail overlay pixels present in rail_0101").toBeGreaterThan(200);
  });

  it("terrain sprites have no fully-opaque white bottom row", async () => {
    const { data, info } = await atlas();
    for (const name of ["terrain_grass", "terrain_rough", "terrain_water"]) {
      const s = manifest.sprites[name];
      const y = s.y + s.h - 1;
      let whiteRow = true;
      for (let x = 0; x < s.w; x++) {
        const i = (y * info.width + (s.x + x)) * 4;
        if (!(data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255 && data[i + 3] === 255)) {
          whiteRow = false;
          break;
        }
      }
      expect(whiteRow, name).toBe(false);
      for (let x = 0; x < s.w; x++) {
        const i = (y * info.width + (s.x + x)) * 4;
        const opaqueWhite = data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255 && data[i + 3] === 255;
        expect(opaqueWhite, `${name} x=${x}`).toBe(false);
      }
    }
  });

  it("U2: highlight_soft is a fainter catchment tint than the solid highlight", async () => {
    const { data, info } = await atlas();
    const alphaAt = (name: string, x = 32, y = 8) => {
      const s = manifest.sprites[name];
      const i = ((s.y + y) * info.width + (s.x + x)) * 4;
      return data[i + 3];
    };
    expect(manifest.sprites.highlight_soft).toBeTruthy();
    // At the NE arm midpoint both cells paint, but the soft catchment is
    // deliberately less prominent than the solid placement tile.
    expect(alphaAt("highlight")).toBeGreaterThan(alphaAt("highlight_soft"));
  });

  it("G4: depot buildings stay small — at most 40px of building above the declared ground tile", () => {
    // Y3 put a declared ground tile under every building cell, so the cell
    // now spans the 32 ground rows plus the building's headroom; G4's bound
    // applies to the building part (the old hand crop was 36px tall).
    for (const name of ["depot_blue", "depot_red", "depot_purple", "depot_green"]) {
      expect(manifest.sprites[name].h - 32).toBeLessThanOrEqual(40);
    }
  });
});
