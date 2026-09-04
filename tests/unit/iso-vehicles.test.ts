// ══════════════════════════════════════════════════════════════════════════
// K5 — vehicles (art only; movement is TK-004).
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HEADINGS, headingForDir, headingForStep, vehicleSprite, vehiclesForRoads,
} from "../../src/iso/vehicles";
import { tileToScreen } from "../../src/game/config";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(
  readFileSync(join(ROOT, "assets/iso-atlas/manifest.json"), "utf8"),
) as { sprites: Record<string, { w: number; h: number; anchor: [number, number]; kind: string }> };

const spr = (n: string) => {
  expect(manifest.sprites[n], `sprite ${n} in atlas`).toBeTruthy();
  return manifest.sprites[n];
};

describe("K5 the atlas carries one frame per compass heading", () => {
  it("all eight headings are packed and indexed by compass suffix", () => {
    expect(HEADINGS).toEqual(["n", "ne", "e", "se", "s", "sw", "w", "nw"]);
    for (const h of HEADINGS) {
      const s = spr(vehicleSprite(h));
      expect(s.kind).toBe("vehicle");
    }
  });

  it("frames are anchored bottom-centre — the truck rests ON the road surface", () => {
    for (const h of HEADINGS) {
      const s = spr(vehicleSprite(h));
      expect(s.anchor[0]).toBe(Math.floor(s.w / 2));
      expect(s.anchor[1]).toBe(s.h);
    }
  });

  it("the frames really differ (Kenney's per-heading art, not one rotated sprite)", () => {
    const dims = new Set(HEADINGS.map((h) => {
      const s = spr(vehicleSprite(h));
      return `${s.w}x${s.h}`;
    }));
    // N/S are the thin end-on frames, E/W the wider side-on ones — at least
    // three distinct silhouettes prove the set is per-heading art.
    expect(dims.size).toBeGreaterThanOrEqual(3);
  });

  it("every road direction bit maps to a heading that has a frame", () => {
    // The track layer's four directions are the projection's axis neighbours.
    for (const bits of [0b0001, 0b0010, 0b0100, 0b1000]) {
      const h = headingForDir(bits);
      expect(HEADINGS).toContain(h);
      expect(manifest.sprites[vehicleSprite(h)]).toBeTruthy();
    }
    expect(headingForDir(0b0001)).toBe("ne");   // (tx, ty-1)
    expect(headingForDir(0b0010)).toBe("se");   // (tx+1, ty)
    expect(headingForDir(0b0100)).toBe("sw");   // (tx, ty+1)
    expect(headingForDir(0b1000)).toBe("nw");   // (tx-1, ty)
  });
});

describe("K5 headingForStep: tile steps → compass via the projection", () => {
  it("the four road directions land on their compass frames", () => {
    expect(headingForStep({ tx: 5, ty: 5 }, { tx: 5, ty: 4 })).toBe("ne");
    expect(headingForStep({ tx: 5, ty: 5 }, { tx: 6, ty: 5 })).toBe("se");
    expect(headingForStep({ tx: 5, ty: 5 }, { tx: 5, ty: 6 })).toBe("sw");
    expect(headingForStep({ tx: 5, ty: 5 }, { tx: 4, ty: 5 })).toBe("nw");
  });

  it("screen-diagonal steps land on the inter-cardinal frames", () => {
    expect(headingForStep({ tx: 5, ty: 5 }, { tx: 6, ty: 4 })).toBe("e");
    expect(headingForStep({ tx: 5, ty: 5 }, { tx: 6, ty: 6 })).toBe("s");
    expect(headingForStep({ tx: 5, ty: 5 }, { tx: 4, ty: 6 })).toBe("w");
    expect(headingForStep({ tx: 5, ty: 5 }, { tx: 4, ty: 4 })).toBe("n");
  });

  it("every step's heading points the way the projection moves (screen check)", () => {
    const dirs: Record<string, [number, number]> = {
      ne: [0, -1], se: [1, 0], sw: [0, 1], nw: [-1, 0],
      e: [1, -1], s: [1, 1], w: [-1, 1], n: [-1, -1],
    };
    const compass: Record<string, [number, number]> = {
      ne: [1, -1], se: [1, 1], sw: [-1, 1], nw: [-1, -1],
      e: [1, 0], s: [0, 1], w: [-1, 0], n: [0, -1],
    };
    for (const [h, [dx, dy]] of Object.entries(dirs)) {
      const [sx, sy] = tileToScreen(dx, dy);
      const [ux, uy] = compass[h];
      expect(Math.sign(sx)).toBe(ux);
      expect(Math.sign(sy)).toBe(uy);
    }
  });

  it("rejects steps that are not tile-neighbour moves", () => {
    expect(() => headingForStep({ tx: 0, ty: 0 }, { tx: 2, ty: 0 })).toThrow();
    expect(() => headingForStep({ tx: 0, ty: 0 }, { tx: 0, ty: 0 })).toThrow();
  });
});

describe("K5 headingForDir prefers the continuing arm", () => {
  it("an arriving vehicle keeps its direction when the road continues", () => {
    // drove in heading NE; the tile has NE|SW asphalt → continue NE
    expect(headingForDir(0b0101, "sw")).toBe("ne");
    // drove in heading SE; the tile has SE|NW asphalt → continue SE
    expect(headingForDir(0b1010, "nw")).toBe("se");
  });

  it("falls back to the lowest set bit at a dead end", () => {
    // arrived heading SW into a NE-only stub: no continuing arm → NE stub arm
    expect(headingForDir(0b0001, "sw")).toBe("ne");
    expect(headingForDir(0b1000)).toBe("nw");
  });
});

describe("K5 vehiclesForRoads parks static trucks on built roads", () => {
  const W = 32, H = 32;
  const put = (bits: Uint8Array, tx: number, ty: number, mask: number) => {
    bits[ty * W + tx] = 0b10000 | mask;
  };

  it("one truck per connected road component, on the front tile", () => {
    const bits = new Uint8Array(W * H);
    // an L: (4,4)-(4,6) vertical, (4,6)-(6,6) horizontal
    put(bits, 4, 4, 0b0100);
    put(bits, 4, 5, 0b0101);
    put(bits, 4, 6, 0b0101);
    put(bits, 5, 6, 0b0101);
    put(bits, 6, 6, 0b1000);   // end tile faces back NW along the run
    const v = vehiclesForRoads(bits, W, H);
    expect(v).toHaveLength(1);
    expect(v[0].tx).toBe(6);
    expect(v[0].ty).toBe(6);
    // front tile's connected arm is NW (back toward (5,6)) — truck faces it
    expect(v[0].sprite).toBe(vehicleSprite("nw"));
    expect(v[0].ref).toEqual({ kind: "vehicle" });
  });

  it("two separate components → two trucks; no roads → none", () => {
    const bits = new Uint8Array(W * H);
    put(bits, 2, 2, 0b0001);
    put(bits, 10, 10, 0b1000);
    expect(vehiclesForRoads(bits, W, H)).toHaveLength(2);
    expect(vehiclesForRoads(new Uint8Array(W * H), W, H)).toHaveLength(0);
  });

  it("a lone dead-end stub still faces its only arm", () => {
    const bits = new Uint8Array(W * H);
    put(bits, 9, 9, 0b0010);   // SE stub (the road_0000-style lone bit)
    const [v] = vehiclesForRoads(bits, W, H);
    expect(v.sprite).toBe(vehicleSprite("se"));
  });
});
