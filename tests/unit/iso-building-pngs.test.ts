import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

// ══════════════════════════════════════════════════════════════════════════
// ART-1950S / TICKET-B2 + B-3.1 — the compiled per-building PNG contract.
//
// tools/make-building-pngs.mjs emits tight-trimmed PNGs whose manifest
// w/h/anchor are expressed relative to the TRIMMED image. The engine blits
// them with `zoomRect` = round(manifest.w × zoom) as the source rect, so the
// REAL pixel dimensions of every zoom file must satisfy exactly that —
// otherwise the right/bottom edge of the art crops (a 1px drift at 0.5× is
// a visible cliff on a fence line). These tests pin the contract against the
// committed output, so a tool regression cannot ship quietly.
// ══════════════════════════════════════════════════════════════════════════

const ROOT = join(__dirname, "..", "..");
const MANIFEST = join(ROOT, "assets", "buildings", "manifest.json");

interface BuildingEntry {
  footprint: [number, number];
  anchor: [number, number];
  w: number;
  h: number;
}

interface BuildingsManifest {
  sprites: Record<string, BuildingEntry>;
}

/** Alpha bbox (threshold 8) as [left, top, width, height], or null if empty. */
async function alphaBBox(file: string): Promise<{ left: number; top: number; width: number; height: number } | null> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

const manifest: BuildingsManifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const names = Object.keys(manifest.sprites);

describe("ART-1950S compiled building PNGs", () => {
  it("has at least one compiled building (the pipeline output is committed)", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  for (const name of names) {
    describe(name, () => {
      const e = manifest.sprites[name];

      it("ships all three zoom files", () => {
        for (const z of ["0.5x", "1x", "2x"]) {
          expect(existsSync(join(ROOT, "assets", "buildings", `${name}@${z}.png`)), `${name}@${z}.png`).toBe(true);
        }
      });

      it("real PNG dimensions match round(manifest.w × zoom) at every tier (no edge cropping)", async () => {
        for (const [z, factor] of [["0.5x", 0.5], ["1x", 1], ["2x", 2]] as const) {
          const meta = await sharp(join(ROOT, "assets", "buildings", `${name}@${z}.png`)).metadata();
          expect(meta.width, `${name}@${z} width`).toBe(Math.round(e.w * factor));
          expect(meta.height, `${name}@${z} height`).toBe(Math.round(e.h * factor));
        }
      });

      it("anchor sits inside the image (placement, not a corner reference)", () => {
        expect(e.anchor[0]).toBeGreaterThanOrEqual(0);
        expect(e.anchor[0]).toBeLessThanOrEqual(e.w);
        expect(e.anchor[1]).toBeGreaterThanOrEqual(0);
        expect(e.anchor[1]).toBeLessThanOrEqual(e.h);
      });

      it("@2x output is the tight alpha trim of the authored source (B-3.1)", async () => {
        const src = join(ROOT, "assets", "buildings-src", `${name}@2x.png`);
        if (!existsSync(src)) return; // source masters are committed alongside
        const box = await alphaBBox(src);
        expect(box, `${name}: source is fully transparent?`).not.toBeNull();
        // snapped to the 4px lattice: floor origin / ceil far edge
        const left = Math.max(0, Math.floor(box!.left / 4) * 4);
        const top = Math.max(0, Math.floor(box!.top / 4) * 4);
        const right = Math.ceil((box!.left + box!.width) / 4) * 4;
        const bottom = Math.ceil((box!.top + box!.height) / 4) * 4;
        const meta = await sharp(join(ROOT, "assets", "buildings", `${name}@2x.png`)).metadata();
        expect(meta.width).toBe(right - left);
        expect(meta.height).toBe(bottom - top);
        // and the anchor is the source anchor shifted by the trim origin
        const S = (e.footprint[0] + e.footprint[1]) * 64; // base canvas side
        const srcMeta = await sharp(src).metadata();
        const ax2 = srcMeta.width! / 2;                    // canvas anchor (see tool)
        const ay2 = srcMeta.height! - (e.footprint[0] + e.footprint[1]) * 16;
        expect(e.anchor[0]).toBeCloseTo((ax2 - left) / 2, 1);
        expect(e.anchor[1]).toBeCloseTo((ay2 - top) / 2, 1);
        expect(srcMeta.width!).toBeGreaterThanOrEqual(S);
        expect(srcMeta.height!).toBeGreaterThanOrEqual(S);
      });

      it("derived tiers are quality-resampled, not nearest pixel subsets (B2)", async () => {
        // A nearest 2:1 downscale of the @2x file must differ from the
        // shipped @1x: lanczos3 interpolates, nearest copies. Compare on
        // distinct colours — interpolation produces colours absent from the
        // source lattice. (On flat-colour art both agree; the shipped art is
        // painted and anti-aliased, so the difference is measurable.)
        const twoX = join(ROOT, "assets", "buildings", `${name}@2x.png`);
        const oneX = join(ROOT, "assets", "buildings", `${name}@1x.png`);
        const nearest = await sharp(twoX)
          .resize(Math.round(e.w), Math.round(e.h), { kernel: "nearest" })
          .raw().toBuffer();
        const shipped = await sharp(oneX).raw().toBuffer();
        let differing = 0;
        const n = Math.min(nearest.length, shipped.length);
        for (let i = 0; i < n; i += 4) {
          if (nearest[i] !== shipped[i] || nearest[i + 1] !== shipped[i + 1] || nearest[i + 2] !== shipped[i + 2]) differing++;
        }
        const total = Math.floor(n / 4);
        // Painted, anti-aliased art: a large share of pixels differ from the
        // nearest lattice (flat fills — the rig's water plane — agree under
        // both kernels, so this is not 100%). A nearest regression collapses
        // this to ~0. 15% separates the two regimes by a wide margin.
        expect(differing / total, `${name}: @1x looks like a nearest subset`).toBeGreaterThan(0.15);
      });
    });
  }
});
