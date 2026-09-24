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

/**
 * The footprint the game reserves: every resource stands on a 4×4 lot
 * (RESOURCE_FOOTPRINT in src/iso/config.ts); the plant is still sized from its
 * monolith art.
 */
const reservedFor = (key: string): [number, number] =>
  key === "factory" ? footprintForArt(atlas.sprites[key].w) : [4, 4];

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
      const reserved = reservedFor(key);
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
      const m = reservedFor(key)[0];
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

// ══════════════════════════════════════════════════════════════════════════
// F2 (#272) — the shadow path follows the REAL footprint, w≠h included.
//
// The cast shadow is the footprint's own diamond (building-shadow.ts), so for
// a non-square building it must be a non-square-aware diamond: concentric
// with where `drawOrigin` places a centre-anchored building, sized to the w×h
// tile union, and stamped per (w, h) — a 4×2 must never borrow a 2×4's stamp.
// ══════════════════════════════════════════════════════════════════════════
import {
  shadowCentre, shadowRadii, castsShadow, ShadowStamps,
  SHADOW_DX, SHADOW_DY, SHADOW_GROW,
} from "../../src/iso/building-shadow";
import { drawOrigin, place, type DrawItem, type Placed } from "../../src/iso/depth";
import { Atlas, type Manifest, type SpriteDef } from "../../src/iso/atlas";

const HW2 = 32, HH2 = 16, TILE_H2 = 32;   // 1× tile geometry (src/game/config.ts)

const F2_FOOTPRINTS: [number, number][] = [[1, 2], [2, 1], [1, 3], [3, 1], [4, 2], [2, 4], [1, 4], [4, 1], [2, 2]];

const f2Def = ([fw, fh]: [number, number]): SpriteDef => {
  const w = (fw + fh) * HW2, up = Math.round((fw + fh) * HH2 * 0.9) + 24;
  return {
    x: 0, y: 0, w, h: (fw + fh) * HH2 + up,
    footprint: [fw, fh],
    anchor: [w / 2, up + (fw + fh) * HH2 / 2],
    center: true,
  };
};

describe("F2 (#272) — shadows follow the real footprint", () => {
  it("the shadow sits on the footprint centre the art is placed on, offset up-right", () => {
    for (const fp of F2_FOOTPRINTS) {
      const def = f2Def(fp);
      const [ox, oy] = drawOrigin(def, 5, 5);
      const [scx, scy] = shadowCentre(def, 5, 5);
      expect(scx - (ox + def.anchor[0]), `${fp} dx`).toBeCloseTo(SHADOW_DX, 5);
      expect(scy - (oy + def.anchor[1]), `${fp} dy`).toBeCloseTo(SHADOW_DY, 5);
    }
  });

  it("the shadow diamond is the grown w×h footprint diamond (asymmetric shapes differ)", () => {
    for (const [fw, fh] of F2_FOOTPRINTS) {
      const [rx, ry] = shadowRadii(fw, fh);
      // half-extents of the tile-union diamond corner-to-corner: (w+h)·HW × (w+h)·HH
      expect(rx - SHADOW_GROW, `${fw}×${fh} rx`).toBeCloseTo((fw + fh) * HW2 / 2, 5);
      expect(ry - SHADOW_GROW / 2, `${fw}×${fh} ry`).toBeCloseTo((fw + fh) * HH2 / 2, 5);
    }
    // a 4×2 and a 2×4 share the radii but NOT the centre lean (checked above),
    // and a 1×3 is a strictly smaller diamond than a 4×2
    expect(shadowRadii(1, 3)[0]).toBeLessThan(shadowRadii(4, 2)[0]);
  });

  it("stamps are keyed per footprint: 1×3 and 3×1 never share, 4×2 ≠ 2×4", () => {
    const stamps = new ShadowStamps();
    const made: { key: string; w: number; h: number }[] = [];
    const makeSurface = (w: number, h: number) => {
      made.push({ key: `${made.length}`, w, h });
      return { getContext: () => ({
        filter: "none", fillStyle: "", beginPath() {}, moveTo() {}, lineTo() {},
        closePath() {}, fill() {},
      }) } as unknown as HTMLCanvasElement;
    };
    const a = stamps.stamp(1, 3, 1, makeSurface);
    const b = stamps.stamp(3, 1, 1, makeSurface);
    const c = stamps.stamp(4, 2, 1, makeSurface);
    const d = stamps.stamp(2, 4, 1, makeSurface);
    expect([a, b, c, d].every(Boolean)).toBe(true);
    expect(stamps.size, "four distinct keys").toBe(4);
    // cached hit is the SAME stamp object per key
    expect(stamps.stamp(1, 3, 1, makeSurface)).toBe(a);
    // 1×3 and 3×1 have equal radii (symmetric diamond) — same pixel box —
    // but 4×2 vs 2×4 are equal too: the guarantee under test is that each
    // (w,h) pair has its OWN cache entry and zooms key apart as well
    expect(stamps.stamp(1, 3, 2, makeSurface)).not.toBe(a);
    expect(stamps.size).toBe(5);
  });

  it("only free-placed standing buildings cast: not decor, not moving cars, not sheet sprites", () => {
    const def = f2Def([2, 4]);
    const base = { tx: 1, ty: 1 } as const;
    const standing = { ...base, def, sprite: "x", wx: 0, wy: 0, w: 1, h: 1, key: 0 } as Placed;
    expect(castsShadow(standing)).toBe(true);
    expect(castsShadow({ ...standing, decor: true })).toBe(false);
    expect(castsShadow({ ...standing, fx: 1.2, fy: 1.2 })).toBe(false);
    expect(castsShadow({ ...standing, def: { ...def, center: undefined } })).toBe(false);
  });
});
