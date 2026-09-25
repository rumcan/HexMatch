import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  planNormalize,
  normalizeBuilding,
  measureBase,
  fitGroundLine,
  lightingCheck,
  declarationSnippet,
  declaredFootprints,
  TRACK_SLOPE,
  VERTEX_SLACK,
} from "../../tools/normalize-building-art.mjs";
import { processBuilding } from "../../tools/make-building-pngs.mjs";

// ══════════════════════════════════════════════════════════════════════════
// F5 (#273) — the shear that puts a loose building drawing on the game's 2:1
// grid, and the anchor contract it has to keep while doing it.
//
// The raw art for these buildings is drawn at a flatter, perspective-ish angle
// (+0.55 / −0.36 rather than +0.5 / −0.5), so an alpha-box fit (the old
// fit-building-art.mjs route) leaves the base off its footprint diamond. The
// tool measures the drawn base (a LOWER SUPPORT line per edge — art stands on
// the ground and everything else is above it), shears both edges to ±0.5 and
// scales the drawn base to the footprint's own diagonal, then places its
// centroid on the authoring anchor. These tests pin that geometry on
// synthetic drawings with a KNOWN base, plus the repo's own declarations.
// ══════════════════════════════════════════════════════════════════════════

const ROOT = join(__dirname, "..", "..");
const SRC_DIR = join(ROOT, "assets", "buildings-src");

interface Drawing {
  width?: number;
  height?: number;
  vertex?: [number, number];
  mL?: number;
  mR?: number;
  /** 0–255 wall luminance on the left (SW-facing) side; the right side is 255−this. */
  leftLum?: number;
  /** A cart/step standing IN FRONT of the base over this x range (dips below it). */
  cart?: [number, number];
  /** Building height above the base, px. */
  rise?: number;
}

/**
 * A synthetic isometric building: a filled wall block standing on a two-edged
 * base of known slopes, drawn with the piecewise bottom profile a raw drawing
 * has. Colours are flat so the lighting check has something to read.
 *
 * The default base runs 256 px to the south-vertex and 768 px away from it —
 * a 1 : 3 ground PLAN (the shear keeps x, so the plan's proportions are the
 * drawn ones), which is what a 1×3 footprint must be declared on.
 */
function makeDrawing(d: Drawing = {}) {
  const {
    width = 1024, height = 1024, vertex = [256, 768],
    mL = 0.6, mR = -0.36, leftLum = 210, cart, rise = 300,
  } = d;
  const data = Buffer.alloc(width * height * 4);
  const [vx, vy] = vertex;
  const baseAt = (x: number) => vy + (x <= vx ? mL * (x - vx) : mR * (x - vx));
  for (let x = 0; x < width; x++) {
    const base = baseAt(x);
    for (let y = Math.ceil(base) - rise; y <= Math.floor(base); y++) {
      if (y < 0 || y >= height) continue;
      const o = (y * width + x) * 4;
      const lum = x < vx ? leftLum : 255 - leftLum;
      data[o] = lum; data[o + 1] = lum; data[o + 2] = lum; data[o + 3] = 255;
    }
  }
  if (cart) {
    const [x0, x1] = cart;
    for (let x = x0; x < x1; x++) {
      const top = Math.floor(baseAt(x)) + 20, bottom = Math.floor(baseAt(x)) + 44;
      for (let y = top; y <= bottom && y < height; y++) {
        const o = (y * width + x) * 4;
        data[o] = 90; data[o + 1] = 80; data[o + 2] = 60; data[o + 3] = 255;
      }
    }
  }
  return { data, width, height, channels: 4 };
}

const draw = (d: Drawing) => {
  const f = makeDrawing(d);
  return { ...f, footprint: [1, 3] as [number, number] };
};

describe("F5 fitGroundLine — the ground is a support line, not an average", () => {
  const base: Array<[number, number]> = [];
  for (let x = 0; x < 400; x++) base.push([x, 100 + Math.round(0.62 * x)]);

  it("recovers a known slope", () => {
    const line = fitGroundLine(base, -1);   // a rising edge is the vertex's west side
    expect(line.m).toBeCloseTo(0.62, 3);
  });

  it("is not dragged by art resting ON the ground (a cart) or a stray pixel", () => {
    const cart = base.map(([x, y]) => [x, x > 200 && x < 250 ? y + 40 : y] as [number, number]);
    const withCart = fitGroundLine(cart, -1);
    expect(withCart.m, "the cart's 40px step does not bend the ground line").toBeCloseTo(0.62, 3);
    expect(withCart.b).toBeCloseTo(fitGroundLine(base, -1).b, 0);
    // …and a column that leaves the band in the middle does not end the base
    expect(withCart.x1, "the ground continues past the cart").toBe(399);
    const noisy = [...base, [300, 40] as [number, number]];
    expect(fitGroundLine(noisy, -1).m).toBeCloseTo(0.62, 3);
  });

  it("rejects a half whose silhouette does not climb the right way", () => {
    const flat: Array<[number, number]> = Array.from({ length: 60 }, (_, x) => [x, 500]);
    expect(() => fitGroundLine(flat, 1)).toThrow(/ground edge/);
  });
});

describe("F5 measureBase — the drawn base of a real drawing", () => {
  it("reads both edge slopes, the vertex and the corners of the drawn plan", () => {
    const f = draw({ mL: 0.6, mR: -0.36, vertex: [256, 768], cart: [600, 660] });
    const b = measureBase(f.data, f.width, f.height, f.channels);
    expect(b.left.m).toBeCloseTo(0.6, 2);
    expect(b.right.m).toBeCloseTo(-0.36, 2);
    expect(Math.abs(b.vertex.x - 256), `vertex x ${b.vertex.x}`).toBeLessThan(6);
    expect(Math.abs(b.vertex.y - 768), `vertex y ${b.vertex.y}`).toBeLessThan(6);
    // the drawn corners sit where the base runs out at the canvas edge
    expect(b.west[0]).toBe(0);
    expect(b.east[0]).toBe(1023);
    // a cart sitting on the ground mid-edge neither bends the line nor ends it
    expect(b.left.x1).toBeLessThanOrEqual(260);   // the fitted lines cross at the vertex
    expect(b.right.x1).toBe(1023);
    // the plan's proportions are the drawn horizontal spans (the shear keeps x)
    expect(b.spans.w / b.spans.h).toBeCloseTo(1 / 3, 2);
  });
});

describe("F5 planNormalize — the game's 2:1 grid, on the declared footprint", () => {
  const f = draw({});
  const plan = planNormalize({ ...f, footprint: [1, 3] });

  it("shears both ground edges to exactly ±0.5 dy/dx", () => {
    const slope = (a: [number, number], b: [number, number]) => (b[1] - a[1]) / (b[0] - a[0]);
    expect(slope(plan.placed.west, plan.placed.vertex)).toBeCloseTo(TRACK_SLOPE, 2);
    expect(slope(plan.placed.vertex, plan.placed.east)).toBeCloseTo(-TRACK_SLOPE, 2);
    // the shear it solved for: σ·mL + k = +0.5 and σ·mR + k = −0.5, with the
    // drawing's OWN measured slopes — so both edges land on the game's angle
    const { sigma, k } = plan.transform;
    expect(sigma * plan.drawn.leftSlope + k).toBeCloseTo(TRACK_SLOPE, 4);
    expect(sigma * plan.drawn.rightSlope + k).toBeCloseTo(-TRACK_SLOPE, 4);
    expect(sigma).toBeCloseTo(1 / (0.6 + 0.36), 2);   // the drawing is a hair off nominal
    expect(k).toBeCloseTo(-0.125, 2);
  });

  it("scales the drawn base to the footprint's own diagonal and centres it", () => {
    const n = 4;                                       // w + h for 1×3
    const span = plan.placed.east[0] - plan.placed.west[0];
    expect(span).toBeCloseTo(n * 64, 0);
    // the anchor is the footprint centre; the base's centroid lands on it
    expect(plan.anchor[0]).toBe(plan.canvas.W / 2);
    expect(plan.anchor[1]).toBe(plan.canvas.H - n * 16);
    const centroid = [(plan.placed.west[0] + plan.placed.east[0]) / 2, (plan.placed.west[1] + plan.placed.east[1]) / 2];
    expect(Math.abs(centroid[0] - plan.anchor[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(centroid[1] - plan.anchor[1])).toBeLessThanOrEqual(1);
  });

  it("puts the base's south vertex on the canvas bottom row (the anchor contract)", () => {
    // the base leans: a 1×3's south vertex sits (w−h)·32 px left of centre
    expect(Math.abs(plan.placed.vertex[0] - plan.anchor[0] - (1 - 3) * 32)).toBeLessThan(1.5);
    expect(Math.abs(plan.placed.vertex[1] - plan.canvas.H)).toBeLessThan(1.5);
    expect(plan.placed.vertex[1]).toBeLessThanOrEqual(plan.canvas.H);
    expect(plan.belowVertex).toBeLessThanOrEqual(VERTEX_SLACK);
  });

  it("keeps the canvas at least the collar lot wide, and grows it UPWARD for height", () => {
    const n = 4;
    expect(plan.canvas.W).toBeGreaterThanOrEqual(Math.round((n - 0.32) * 64));
    expect(plan.canvas.H).toBeGreaterThanOrEqual(n * 32);
    // the art is 300 px tall in a 1024² drawing scaled to a 256-px base
    const artH = (plan.canvas.H - VERTEX_SLACK) - plan.anchor[1] + n * 16;
    expect(artH).toBeGreaterThan(300 * (plan.resample.rx * plan.transform.sigma) * 0.8);
  });

  it("warns when the drawing's plan is nowhere near the declared footprint", () => {
    // (1×3 and 4×4 both have n = 4, so the shear fits either; the PLAN is what
    // has to match — the drawing is 512 : 307 px of ground, 1 : 0.6)
    const other = planNormalize({ ...f, footprint: [4, 4] });
    expect(other.planRatio.off).toBeLessThan(0.7);
    expect(other.warning).toMatch(/ground plan/);
    expect(plan.planRatio.off, "the drawing's own footprint matches its plan").toBeCloseTo(1, 2);
    expect(plan.warning ?? "", "and does not warn about the plan").not.toMatch(/ground plan/);
  });

  it("refuses a footprint that is not a pair of positive integers", () => {
    expect(() => planNormalize({ ...f, footprint: [0, 3] })).toThrow(/footprint/);
  });
});

describe("F5 normalizeBuilding → the compiler (hermetic, tmp dirs only)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
  });
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), "f5-norm-"));
    dirs.push(dir);
    const srcDir = join(dir, "src");
    mkdirSync(srcDir, { recursive: true });
    return { srcDir, outDir: join(dir, "out"), dir };
  };

  it("writes a master the compiler accepts, and the compiled art keeps the ±0.5 base", async () => {
    const { srcDir, outDir } = setup();
    const raw = join(srcDir, "raw.png");
    const f = makeDrawing({});
    await sharp(f.data, { raw: { width: f.width, height: f.height, channels: 4 } }).png().toFile(raw);
    const res = await normalizeBuilding("hall", raw, { footprint: [1, 3], srcDir, footRoom: 0 });
    const master = join(srcDir, "hall@2x.png");
    expect(existsSync(master)).toBe(true);
    expect(res.footprint).toEqual([1, 3]);
    expect(res.edgeOffset2x.sw).toBeCloseTo(0, 0);

    const entry = await processBuilding("hall", {
      declared: { hall: { footprint: [1, 3], footRoom: 0 } }, srcDir, outDir,
    });
    expect(entry.footprint).toEqual([1, 3]);
    expect(entry.source).toBe("footprints.json");
    // the compiled master's own base still measures the game's angle
    const { data, info } = await sharp(join(outDir, "hall@2x.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const b = measureBase(data, info.width, info.height, info.channels);
    expect(b.left.m).toBeCloseTo(0.5, 1);
    expect(b.right.m).toBeCloseTo(-0.5, 1);
  });

  it("--mirror flips the source and the declared footprint with it", async () => {
    const { srcDir } = setup();
    const raw = join(srcDir, "raw.png");
    // a drawing lit from the LEFT (SW wall brighter) — the world's light
    const f = makeDrawing({ leftLum: 210 });
    await sharp(f.data, { raw: { width: f.width, height: f.height, channels: 4 } }).png().toFile(raw);
    const plain = await normalizeBuilding("hall", raw, { footprint: [1, 3], srcDir });
    const mirrored = await normalizeBuilding("hall", raw, { footprint: [3, 1], mirror: true, srcDir });
    expect(plain.out).toMatch(/hall@2x\.png$/);
    expect(mirrored.out).toMatch(/hall_r@2x\.png$/);
    expect(mirrored.footprint).toEqual([3, 1]);
    // the mirrored master's base still sits on its (swapped) diamond
    expect(Math.abs(mirrored.edgeOffset2x.sw)).toBeLessThan(1);
    expect(Math.abs(mirrored.edgeOffset2x.se)).toBeLessThan(1);
    // and the light moves to the other wall
    const before = await lightingCheck(plain.out);
    const after = await lightingCheck(mirrored.out);
    expect(before.ratio).toBeGreaterThan(1);
    expect(after.ratio).toBeLessThan(1);
  });
});

describe("F5 the repo's own declarations and masters", () => {
  const declared = declaredFootprints();

  // The first set of non-square buildings (#273). Long side along grid y ⇒ the
  // LARGER h; the `_r` mirror of each ships too, declared the other way round.
  const PAIRS: Array<[string, [number, number], [number, number]]> = [
    ["terrace_1x2", [1, 2], [2, 1]],
    ["shops_1x3", [1, 3], [3, 1]],
    ["store_2x4", [2, 4], [4, 2]],
    ["factory_2x4", [2, 4], [4, 2]],
    ["depot_1x2", [1, 2], [2, 1]],
  ];

  it("declares every new building and its mirror at the swapped footprint", () => {
    for (const [name, fp, rfp] of PAIRS) {
      expect(declared[name]?.footprint, `${name} declared`).toEqual(fp);
      expect(declared[`${name}_r`]?.footprint, `${name}_r declared`).toEqual(rfp);
      // the file name and the declaration must agree: the LONG side of the name
      // is the footprint's larger axis
      const [lw, lh] = name.match(/(\d)x(\d)/)!.slice(1).map(Number);
      expect(fp, `${name}: name says ${lw}×${lh}`).toEqual([lw, lh]);
      expect(Math.max(fp[0], fp[1])).toBe(lh);
    }
  });

  it("marks the mirror usable only where the lighting allows it", () => {
    for (const [name] of PAIRS) {
      expect(declared[name]?.mirror, `${name} mirror flag`).toBe(true);
    }
  });

  it("ships both orientations as real art, with the declared footprints in the compiled manifest", async () => {
    const buildings = JSON.parse(readFileSync(join(ROOT, "assets", "buildings", "manifest.json"), "utf8"));
    for (const [name, fp, rfp] of PAIRS) {
      for (const [n, want] of [[name, fp], [`${name}_r`, rfp]] as const) {
        expect(buildings.sprites[n]?.footprint, `${n} compiled footprint`).toEqual(want);
        for (const z of ["0.5x", "1x", "2x"]) {
          expect(existsSync(join(ROOT, "assets", "buildings", `${n}@${z}.png`)), `${n}@${z}`).toBe(true);
        }
      }
    }
  });

  it("keeps every new master on the authoring canvas the compiler expects", async () => {
    for (const [name, fp] of PAIRS) {
      for (const n of [name, `${name}_r`]) {
        const foot = declared[n];
        const meta = await sharp(join(SRC_DIR, `${n}@2x.png`)).metadata();
        const n2 = foot.footprint[0] + foot.footprint[1];
        expect(meta.width!, `${n} canvas width`).toBeGreaterThanOrEqual(Math.round((n2 - 0.32) * 64));
        expect(meta.height!, `${n} canvas height`).toBeGreaterThanOrEqual(n2 * 32);
        expect(foot.footprint).toContain(fp[0]);
      }
    }
  });

  it("declarationSnippet mirrors the loader's own normal form", () => {
    expect(declarationSnippet([1, 3])).toEqual({ footprint: [1, 3] });
    expect(declarationSnippet([2, 4], 16)).toEqual({ footprint: [2, 4], footRoom: 16 });
  });
});
