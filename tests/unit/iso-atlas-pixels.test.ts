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

  it("terrain sprites have no fully-opaque white bottom row", async () => {
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp("assets/iso-atlas/atlas@1x.png").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (const name of ["terrain_grass_a", "terrain_grass_b", "terrain_rough", "terrain_water"]) {
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
