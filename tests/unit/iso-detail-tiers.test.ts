import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { detailTierFor, tierDir, TIER_SCALE } from "../../src/iso/detail-tiers";
import { QUALITY_MAX_DETAIL } from "../../src/iso/graphics";
import { GROUND_TEX_SIZE, oceanMatrix } from "../../src/iso/ground";

// ══════════════════════════════════════════════════════════════════════════
// GFX-01 terrain LOD — the ground textures and decals load a smaller copy at
// the medium and low graphics presets (tools/make-detail-tiers.mjs).
// ══════════════════════════════════════════════════════════════════════════

const GROUND = join(process.cwd(), "assets", "ground");
const DECALS = join(GROUND, "decals");

describe("GFX-01 terrain detail tiers", () => {
  it("each quality preset loads its own tier", () => {
    expect(detailTierFor(QUALITY_MAX_DETAIL.high)).toBe("high");
    expect(detailTierFor(QUALITY_MAX_DETAIL.medium)).toBe("medium");
    expect(detailTierFor(QUALITY_MAX_DETAIL.low)).toBe("low");
    expect(tierDir("high")).toBe("");
    expect(tierDir("medium")).toBe("medium/");
    expect(TIER_SCALE).toEqual({ high: 1, medium: 0.5, low: 0.25 });
  });

  it("a smaller ground texture is stretched, but the ocean drift period is unchanged", () => {
    const cam = { x: 10, y: 20, zoom: 1 };
    for (const t of [0, 1000, 90_000]) {
      const full = oceanMatrix(cam, t, 0.16, 1);
      const half = oceanMatrix(cam, t, 0.16, 2);
      // the drift (a world-space offset) is identical at every tier
      expect(half.e).toBeCloseTo(full.e, 9);
      expect(half.f).toBeCloseTo(full.f, 9);
      // the half-size copy is stretched 2× to cover the same world area
      expect(half.m11).toBeCloseTo(full.m11 * 2, 9);
      expect(half.m22).toBeCloseTo(full.m22 * 2, 9);
    }
  });

  it("every ground texture ships a half- and quarter-size copy", async () => {
    const names = readdirSync(GROUND).filter((f) => f.endsWith(".png"));
    expect(names.sort()).toEqual(["grass.png", "sand.png", "water.png"]);
    for (const name of names) {
      const full = await sharp(join(GROUND, name)).metadata();
      expect(full.width).toBe(GROUND_TEX_SIZE);
      for (const tier of ["medium", "low"] as const) {
        const file = join(GROUND, tier, name);
        expect(existsSync(file), `${tier}/${name}`).toBe(true);
        const m = await sharp(file).metadata();
        expect([m.width, m.height], `${tier}/${name}`)
          .toEqual([full.width! * TIER_SCALE[tier], full.height! * TIER_SCALE[tier]]);
      }
    }
  });

  it("every decal ships a half- and quarter-size copy, and nothing stale", async () => {
    const decals = readdirSync(DECALS).filter((f) => /\.(webp|png)$/.test(f)).sort();
    expect(decals.length).toBeGreaterThan(0);
    for (const tier of ["medium", "low"] as const) {
      expect(readdirSync(join(DECALS, tier)).sort(), `${tier}/ matches the full-size set`).toEqual(decals);
      for (const f of decals) {
        const full = await sharp(join(DECALS, f)).metadata();
        const m = await sharp(join(DECALS, tier, f)).metadata();
        expect([m.width, m.height], `${tier}/${f}`)
          .toEqual([Math.round(full.width! * TIER_SCALE[tier]), Math.round(full.height! * TIER_SCALE[tier])]);
      }
    }
  });

  it("the downsized ground textures still tile without a seam", async () => {
    for (const tier of ["medium", "low"] as const) {
      for (const name of ["grass", "sand", "water"]) {
        const { data, info } = await sharp(join(GROUND, tier, `${name}.png`))
          .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const { width: w, height: h } = info;
        const px = (x: number, y: number, c: number) => data[(y * w + x) * 4 + c];
        // Mean RGB step between horizontally adjacent pixels, across the
        // interior, versus across the wrap (last column → first column).
        let inner = 0, innerN = 0, wrap = 0;
        for (let y = 0; y < h; y++) {
          for (let c = 0; c < 3; c++) {
            wrap += Math.abs(px(w - 1, y, c) - px(0, y, c));
            for (let x = 0; x < w - 1; x++) { inner += Math.abs(px(x + 1, y, c) - px(x, y, c)); innerN++; }
          }
        }
        inner /= innerN;
        wrap /= h * 3;
        // A seam would make the wrap step clearly larger than a normal step.
        expect(wrap, `${tier}/${name}: wrap ${wrap.toFixed(2)} vs interior ${inner.toFixed(2)}`)
          .toBeLessThan(inner * 1.6 + 1);
      }
    }
  });
});
