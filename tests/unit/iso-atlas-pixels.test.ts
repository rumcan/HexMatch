import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8")) as {
  sprites: Record<string, { x: number; y: number; w: number; h: number }>;
};

const ARMS: Record<number, [number, number]> = {
  1: [48, 8],
  2: [48, 24],
  4: [16, 24],
  8: [16, 8],
};

function loadPng(path: string) {
  const buf = readFileSync(path);
  // Use sharp via dynamic import in the test runner after npm ci.
  return buf;
}

describe("G1/G2 atlas pixels", () => {
  it("road masks hit expected edge midpoints and miss unset ones", async () => {
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp("assets/iso-atlas/atlas@1x.png").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const sample = (sx: number, sy: number, px: number, py: number) => {
      const x = sx + px, y = sy + py;
      const i = (y * info.width + x) * 4;
      return data[i + 3];
    };
    const nearOpaque = (sx: number, sy: number, mx: number, my: number, r: number) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (sample(sx, sy, mx + dx, my + dy) > 0) return true;
      }
      return false;
    };
    for (let mask = 0; mask < 16; mask++) {
      const key = `road_${mask.toString(2).padStart(4, "0")}`;
      const s = manifest.sprites[key];
      expect(s, key).toBeTruthy();
      for (const bit of [1, 2, 4, 8]) {
        const [mx, my] = ARMS[bit];
        if (mask & bit) {
          expect(nearOpaque(s.x, s.y, mx, my, 2), `${key} missing arm ${bit}`).toBe(true);
        } else {
          expect(nearOpaque(s.x, s.y, mx, my, 6), `${key} stray arm ${bit}`).toBe(false);
        }
      }
    }
  });

  it("X4: road/rail arms are painted at the exact edge midpoint", async () => {
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp("assets/iso-atlas/atlas@1x.png").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const sample = (sx: number, sy: number, px: number, py: number) => {
      const i = ((sy + py) * info.width + (sx + px)) * 4;
      return data[i + 3];
    };
    for (const prefix of ["road", "rail"]) {
      for (let mask = 0; mask < 16; mask++) {
        const key = `${prefix}_${mask.toString(2).padStart(4, "0")}`;
        const s = manifest.sprites[key];
        expect(s, key).toBeTruthy();
        for (const bit of [1, 2, 4, 8]) {
          const [mx, my] = ARMS[bit];
          if (mask & bit) {
            // AT the midpoint, not merely within 2px (X4).
            expect(sample(s.x, s.y, mx, my), `${key} arm ${bit} is 1px short`).toBeGreaterThan(0);
          } else {
            expect(sample(s.x, s.y, mx, my), `${key} stray arm ${bit}`).toBe(0);
          }
        }
      }
    }
  });

  it("X4: two adjacent road_1111 tiles composite with no transparent column at the join", async () => {
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp("assets/iso-atlas/atlas@1x.png").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const s = manifest.sprites.road_1111;

    // Real screen offsets: sprite draw position is topVertex + (HW-anchorX,
    // TILE_H-anchorY). anchor [32,31], so tile A draws at (0,1) and tile B
    // (the SE neighbour, top vertex at +HW/+HH) draws at (32,17).
    const W = 96, H = 80;
    const dst = Buffer.alloc(W * H * 4);
    const blitAt = (sx: number, sy: number, dx: number, dy: number) => {
      for (let y = 0; y < s.h; y++) {
        for (let x = 0; x < s.w; x++) {
          const dxx = dx + x, dyy = dy + y;
          if (dxx < 0 || dyy < 0 || dxx >= W || dyy >= H) continue;
          const si = ((s.y + y) * info.width + (s.x + x)) * 4;
          const di = (dyy * W + dxx) * 4;
          const a = data[si + 3] / 255;
          dst[di] = dst[di] * (1 - a) + data[si] * a;
          dst[di + 1] = dst[di + 1] * (1 - a) + data[si + 1] * a;
          dst[di + 2] = dst[di + 2] * (1 - a) + data[si + 2] * a;
          dst[di + 3] = Math.max(dst[di + 3], data[si + 3]);
        }
      }
    };
    blitAt(s.x, s.y, 0, 1);
    blitAt(s.x, s.y, 32, 17);

    // No single vertical column through the join may be fully transparent.
    // (A 1px-short arm leaves exactly such a gap.)
    for (let x = 44; x <= 52; x++) {
      let painted = false;
      for (let y = 0; y < H; y++) {
        if (dst[(y * W + x) * 4 + 3] > 0) { painted = true; break; }
      }
      expect(painted, `transparent join column at x=${x}`).toBe(true);
    }
  });

  it("terrain sprites have no fully-opaque white bottom row", async () => {
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp("assets/iso-atlas/atlas@1x.png").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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

  it("depot sprites are at most 40px tall (G4)", () => {
    for (const name of ["depot_blue", "depot_red", "depot_purple", "depot_green"]) {
      expect(manifest.sprites[name].h).toBeLessThanOrEqual(40);
    }
  });
});
