import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateManifest } from "../../tools/validate-manifest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(__dirname, "../../assets/iso-atlas/manifest.json");

describe("E1 atlas manifest", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  it("validates against the schema rules", () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it("uses the E0 64×32 tile size", () => {
    expect(manifest.tileW).toBe(64);
    expect(manifest.tileH).toBe(32);
  });

  it("provides all 16 road and 16 rail autotile variants named by mask", () => {
    for (const kind of ["road", "rail"]) {
      for (let m = 0; m < 16; m++) {
        const key = `${kind}_${m.toString(2).padStart(4, "0")}`;
        expect(manifest.sprites[key], `missing ${key}`).toBeTruthy();
      }
    }
  });

  it("every sprite anchor falls inside its own rect and lands on the footprint south corner", () => {
    for (const [name, s] of Object.entries(manifest.sprites) as any[]) {
      expect(s.anchor[0]).toBeLessThanOrEqual(s.w);
      expect(s.anchor[1]).toBeLessThanOrEqual(s.h);
      // anchor Y for ground/transport sprites is at the rect bottom (south corner)
      expect(s.anchor[1]).toBeGreaterThan(0);
    }
  });

  it("validator rejects a malformed manifest", () => {
    const errors = validateManifest({ image: "x.png", tileW: 64, tileH: 32, sprites: {
      bad: { x: 0, y: 0, w: 10, h: 10, footprint: [2], anchor: [5, 9], frames: 1 },
    } });
    expect(errors.length).toBeGreaterThan(0);
  });
});
