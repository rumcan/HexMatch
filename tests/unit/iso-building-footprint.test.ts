import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

// ══════════════════════════════════════════════════════════════════════════
// ISSUE-144 — "Plant on the south-east side of a road draws over the road
// next to it" — art-footprint regression guard.
//
// The six industries and the processing plant are placed by the GAME on a
// footprint derived from the monolith atlas art width (footprintForArt in
// src/iso/config.ts), but since ART-1950S they are DRAWN from per-building
// masters (assets/buildings/) centred on their OWN authored footprint
// (def.center in depth.ts). If a master is authored on a canvas one tile
// larger than the reserved footprint, its base spans a ground diamond a full
// tile wider than the reserved block — and, because roads paint before
// sprites, the art covers the road tiles standing on the south-east edge.
// That is exactly what shipped for factory / quarry / oil_rig (authored
// 4×4 on a reserved 3×3): up to a full tile of overhang onto the road.
//
// Two guards:
//   1. The per-building art footprint never EXCEEDS the reserved footprint
//      (a smaller master is harmless — it just leaves more ground visible).
//   2. No opaque pixel of the @2x art crosses the FRONT (SE/SW) ground edge
//      of the reserved footprint's diamond by more than a small allowance —
//      the front is the half that faces the neighbouring road. The bug
//      measured 26–49px; the fixed masters measure 0px; the allowance is
//      8px @1× (a quarter tile), between the two.
//
// Scope: only the monolith-footprint buildings above. Depots are an
// established wide look (their monolith art is wider than the 1×1 tile it
// sits on), and town sprites are placed ON 2×2 house blocks by
// townBuildings in grid.ts, so neither is comparable against its monolith
// footprint here.
// ══════════════════════════════════════════════════════════════════════════

const ROOT = join(__dirname, "..", "..");
const BUILDINGS = join(ROOT, "assets", "buildings", "manifest.json");
const ATLAS = join(ROOT, "assets", "iso-atlas", "manifest.json");

// 1× tile geometry (src/game/config.ts): a tile diamond is 2·HW wide, 2·HH tall.
const HW = 32;
const HH = 16;
const TILE_W = 64;

/** Same rule src/iso/config.ts uses to size a placement from monolith art. */
function footprintForArt(spriteW: number): [number, number] {
  const n = Math.max(1, Math.ceil((spriteW - 32) / TILE_W));
  return [n, n];
}

/**
 * Horizontal px (1×) that a point at (u, v) — anchor-origin, v down — sits
 * PAST the front (SE/SW) ground edge of the reserved m×m diamond, or null if
 * the point is not in the front half / not past the edge.
 *
 * The per-building anchor sits on the CENTRE of the art's own n×n diamond
 * (def.center), while the reserved m×m diamond is centred (m−n)·HH lower —
 * the two coincide when n = m, and the reserved centre is ABOVE the anchor
 * when the art is too big (the bug), which makes the test stricter there.
 */
function frontOverhangPx(u: number, v: number, n: number, m: number): number | null {
  if (v < 0) return null; // upper half is building height, not ground overhang
  const off = (m - n) * HH; // reserved diamond centre, in anchor-origin coords
  const d = u >= 0
    ? (u / (HW * m) + (v - off) / (HH * m) - 1) * (HW * m)
    : (-u / (HW * m) + (v - off) / (HH * m) - 1) * (HW * m);
  return d > 0 ? d : null;
}

interface BuildingEntry {
  footprint: [number, number];
  anchor: [number, number];
  w: number;
  h: number;
}
const buildings = JSON.parse(readFileSync(BUILDINGS, "utf8")) as { sprites: Record<string, BuildingEntry> };
const atlas = JSON.parse(readFileSync(ATLAS, "utf8")) as { sprites: Record<string, { w: number }> };

// The industries + processing plant: placed on a monolith-derived footprint,
// drawn from a per-building master. (Keep in sync with INDUSTRIES in config.)
const GAME_KEYS = ["farm", "forest", "ore_mine", "quarry", "oil_rig", "gold_mine", "factory"] as const;

// The fixed masters sit exactly on their reserved diamond; the bug measured
// 26–49px. 8px @1× (= a quarter tile) leaves a wide margin for resampling
// fringes while still catching any re-introduction of the bug class.
const FRONT_ALLOWANCE_PX = 8;

describe("ISSUE-144: per-building art fits its reserved footprint", () => {
  it("every monolith-footprint building has both a monolith cell and a per-building master", () => {
    for (const key of GAME_KEYS) {
      expect(buildings.sprites[key], `buildings manifest missing "${key}"`).toBeDefined();
      expect(atlas.sprites[key], `atlas manifest missing "${key}"`).toBeDefined();
    }
  });

  it("per-building art footprint never exceeds the reserved (monolith) footprint", () => {
    for (const key of GAME_KEYS) {
      const art = buildings.sprites[key].footprint;
      const reserved = footprintForArt(atlas.sprites[key].w);
      expect(
        art[0] <= reserved[0] && art[1] <= reserved[1],
        `${key}: art ${art[0]}×${art[1]} is wider than the reserved ${reserved[0]}×${reserved[1]} — ` +
          `its base would span tiles the game never reserved (issue #144)`,
      ).toBe(true);
    }
  });

  for (const key of GAME_KEYS) {
    it(`${key}: no opaque pixel crosses the reserved footprint's front ground edge`, async () => {
      const e = buildings.sprites[key];
      const n = e.footprint[0];
      const m = footprintForArt(atlas.sprites[key].w)[0];
      const { data, info } = await sharp(join(ROOT, "assets", "buildings", `${key}@2x.png`))
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const { width, height, channels } = info;
      const ax = e.anchor[0] * 2;
      const ay = e.anchor[1] * 2;
      let worst = 0;
      let worstAt: [number, number] | null = null;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * channels + 3] <= 8) continue;
          const u = (x - ax) / 2; // 1× units from the anchor
          const v = (y - ay) / 2;
          const d = frontOverhangPx(u, v, n, m);
          if (d !== null && d > worst) {
            worst = d;
            worstAt = [x, y];
          }
        }
      }
      expect(
        worst,
        `${key}: art overhangs the reserved footprint's front edge by ${worst.toFixed(1)}px @1× ` +
          `at @2x px ${worstAt} (allowance ${FRONT_ALLOWANCE_PX}px) — the building would cover ` +
          `the road standing on its south-east side (issue #144)`,
      ).toBeLessThanOrEqual(FRONT_ALLOWANCE_PX);
    });
  }
});
