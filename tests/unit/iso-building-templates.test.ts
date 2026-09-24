import { describe, expect, it, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  specFor,
  templateSvg,
  templateGeometry,
  resolveFootprint,
  loadDeclaredFootprints,
  processBuilding,
  PERSON_H,
  DOOR_W,
  DOOR_H,
  STOREY_H,
} from "../../tools/make-building-pngs.mjs";

// ══════════════════════════════════════════════════════════════════════════
// F1 (#271) — footprint templates, declared footprints, foot room, scale
// figure. Pins the templateSvg geometry (the cx = h×64 fix), the committed
// template PNGs, the calibrated scale constants, the resolveFootprint
// precedence (declared, not guessed), and the hermetic compile path
// (processBuilding with injected dirs — no repo writes).
// ══════════════════════════════════════════════════════════════════════════

const ROOT = join(__dirname, "..", "..");
const TEMPLATES = join(ROOT, "assets", "buildings-src", "templates");

// Every footprint with a committed template: the four legacy squares plus
// the six F1 non-squares.
const FOOTPRINTS: Array<[number, number]> = [
  [1, 1], [2, 2], [3, 3], [4, 4],
  [1, 2], [2, 1], [1, 3], [3, 1], [4, 2], [2, 4],
];

/** All absolute vertices of an M/L/l/Z path data string. */
function pathVertices(d: string): Array<[number, number]> {
  const toks = d.match(/[MLZmlz]|-?\d+(?:\.\d+)?/g) ?? [];
  const pts: Array<[number, number]> = [];
  let x = 0, y = 0, i = 0;
  while (i < toks.length) {
    const t = toks[i++];
    if (t === "M") { x = Number(toks[i++]); y = Number(toks[i++]); pts.push([x, y]); }
    else if (t === "L") { x = Number(toks[i++]); y = Number(toks[i++]); pts.push([x, y]); }
    else if (t === "l") { x += Number(toks[i++]); y += Number(toks[i++]); pts.push([x, y]); }
    // Z closes back to the start — no new vertex.
  }
  return pts;
}

function attr(tag: string, name: string): number {
  const m = new RegExp(`${name}="([\\d.]+)"`).exec(tag);
  if (!m) throw new Error(`no ${name} in ${tag.slice(0, 80)}`);
  return Number(m[1]);
}

describe("F1 templateSvg geometry", () => {
  for (const [w, h] of FOOTPRINTS) {
    describe(`${w}x${h}`, () => {
      const svg = templateSvg([w, h]);
      const S = (w + h) * 64; // base canvas side (spec)
      const W = Number(/<svg[^>]*width="(\d+)"/.exec(svg)?.[1]);
      const H = Number(/<svg[^>]*height="(\d+)"/.exec(svg)?.[1]);

      it("outline spans the full canvas width and stays inside it (cx = h×64)", () => {
        expect(W).toBe(S); // template width is the base canvas side
        const d = /<path data-guide="outline" d="([^"]+)"/.exec(svg)?.[1] ?? "";
        expect(d.length).toBeGreaterThan(0);
        const v = pathVertices(d);
        expect(v.length).toBe(4);
        const xs = v.map(([x]) => x), ys = v.map(([, y]) => y);
        expect(Math.min(...xs)).toBe(0);
        expect(Math.max(...xs)).toBe(S);
        for (const [x, y] of v) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(S);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(H);
        }
        // south vertex: the lowest outline point, leaning (w−h)×32 off centre
        const sy = Math.max(...ys);
        const sv = v.find(([, y]) => y === sy) ?? [NaN, NaN];
        expect(sv[0]).toBe(w * 64);
      });

      it("draws one tile diamond per footprint tile, all inside the canvas", () => {
        const tiles = [...svg.matchAll(/<path data-guide="tile" d="([^"]+)"/g)];
        expect(tiles.length).toBe(w * h);
        for (const m of tiles) {
          const v = pathVertices(m[1]);
          expect(v.length).toBe(4);
          for (const [x, y] of v) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(S);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(H);
          }
        }
      });

      it("anchor cross-hair sits on the footprint centre", () => {
        // footprint centre, derived from the SVG's own tiles (not the tool's
        // geometry): the mean of the tile-diamond centres.
        const tiles = [...svg.matchAll(/<path data-guide="tile" d="([^"]+)"/g)];
        let cx = 0, cy = 0;
        for (const m of tiles) {
          const v = pathVertices(m[1]);
          cx += v.reduce((a, [x]) => a + x, 0) / 4;
          cy += v.reduce((a, [, y]) => a + y, 0) / 4;
        }
        cx /= tiles.length; cy /= tiles.length;
        const block = /<g data-guide="anchor">([\s\S]*?)<\/g>/.exec(svg)?.[1] ?? "";
        const circle = /<circle[^>]*\/>/.exec(block)?.[0] ?? "";
        expect(attr(circle, "cx")).toBeCloseTo(cx, 6);
        expect(attr(circle, "cy")).toBeCloseTo(cy, 6);
        // …which is the spec anchor shifted onto the guarded canvas
        const g = templateGeometry([w, h]);
        expect(attr(circle, "cx")).toBe(g.ax);
        expect(attr(circle, "cy")).toBe(g.ay);
        expect(g.ax).toBe(specFor([w, h]).ax);
      });

      it("carries the scale guides at the calibrated sizes", () => {
        // door rect is exactly the calibrated 8×16, feet beside the person
        const door = /<g data-guide="door">([\s\S]*?)<\/g>/.exec(svg)?.[1] ?? "";
        const rect = /<rect[^>]*\/>/.exec(door)?.[0] ?? "";
        expect(attr(rect, "width")).toBe(8);
        expect(attr(rect, "height")).toBe(16);
        // person marker present, tagged with its calibrated height
        expect(svg).toContain('data-guide="person"');
        expect(svg).toContain(">12px<");
        expect(svg).toContain(">8×16<");
        // storey lines: every 28px, above the ground row, inside the canvas
        const lines = [...svg.matchAll(/<line data-guide="storey"[^>]*\/>/g)].map((m) => m[0]);
        expect(lines.length).toBeGreaterThanOrEqual(1);
        const ys = lines.map((l) => attr(l, "y1")).sort((a, b) => a - b);
        for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBe(28);
        const band = /<rect data-guide="foot-band"[^>]*\/>/.exec(svg)?.[0] ?? "";
        const vy = attr(band, "y"); // ground (vertex) row
        for (const y of ys) {
          expect(y).toBeLessThan(vy);
          expect(y).toBeGreaterThan(0);
        }
        expect(svg).toContain("storey 28px");
        // foot-room band below the diamond + max-rise line above it
        expect(svg).toContain('data-guide="foot-band"');
        expect(svg).toContain('data-guide="max-rise"');
        expect(attr(band, "height")).toBe(32);
      });
    });
  }

  it("calibrated scale constants (change only by re-measuring the art)", () => {
    // Door 8×16: measured median across town_center / town_house_* /
    // town_flats_* (slabs ran 12–24px tall). Person 12 / storey 28: the
    // redo-guide midpoints (human 10–14, storey 24–32). See the compiler
    // header and docs/ai-codex-art-tickets-1950s.md §2.4.
    expect(PERSON_H).toBe(12);
    expect(DOOR_W).toBe(8);
    expect(DOOR_H).toBe(16);
    expect(STOREY_H).toBe(28);
  });
});

describe("F1 committed template PNGs", () => {
  for (const [w, h] of FOOTPRINTS) {
    it(`${w}x${h} template exists at the geometry size with the anchor cross-hair`, async () => {
      const g = templateGeometry([w, h]);
      const file = join(TEMPLATES, `${w}x${h}@2x.png`);
      expect(existsSync(file), file).toBe(true);
      const meta = await sharp(file).metadata();
      expect(meta.width).toBe(g.W);
      expect(meta.height).toBe(g.H);
      // the cross-hair crossing is solid guide magenta (#ff4fd8)
      const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const px = (x: number, y: number) => {
        const o = (y * info.width + x) * info.channels;
        return [data[o], data[o + 1], data[o + 2]];
      };
      const [r, gg, b] = px(g.ax, g.ay);
      expect(r).toBeGreaterThan(200);
      expect(gg).toBeLessThan(120);
      expect(b).toBeGreaterThan(200);
      // …and the south-vertex row carries the scale figure (magenta pixels
      // within a few px of the vertex, where the person stands)
      let magenta = 0;
      for (let y = g.vy - PERSON_H - 2; y <= g.vy + 1; y++) {
        for (let x = g.vx - 20; x <= g.vx + 20; x++) {
          const [pr, pg, pb] = px(x, y);
          if (pr > 200 && pg < 130 && pb > 200) magenta++;
        }
      }
      expect(magenta).toBeGreaterThan(10);
    });
  }
});

describe("F1 resolveFootprint: declared, not guessed", () => {
  it("--footprint wins over everything", () => {
    expect(resolveFootprint("t", 128, 128, {
      forced: [4, 4], declared: [1, 1], compiled: [2, 2], sheet: [3, 3],
    })).toEqual({ fp: [4, 4], source: "--footprint" });
  });

  it("footprints.json wins over the manifests and the canvas", () => {
    // 256² would infer 2×2 — the declaration says 1×3 and must win.
    expect(resolveFootprint("t", 256, 256, {
      declared: [1, 3], compiled: [2, 2], sheet: [2, 2],
    })).toEqual({ fp: [1, 3], source: "footprints.json" });
  });

  it("the compiled manifest keeps re-authored art on its footprint", () => {
    expect(resolveFootprint("t", 256, 300, { compiled: [2, 2], sheet: [3, 3] }))
      .toEqual({ fp: [2, 2], source: "manifest" });
  });

  it("the sheet manifest beats canvas-size inference", () => {
    expect(resolveFootprint("t", 128, 128, { sheet: [2, 2] }))
      .toEqual({ fp: [2, 2], source: "iso-atlas" });
  });

  it("legacy squares still infer when every authority is silent", () => {
    expect(resolveFootprint("t", 128, 128, {}).fp).toEqual([1, 1]);
    expect(resolveFootprint("t", 256, 256, {}).fp).toEqual([2, 2]);
    expect(resolveFootprint("t", 384, 384, {}).fp).toEqual([3, 3]);
    expect(resolveFootprint("t", 512, 512, {}).fp).toEqual([4, 4]);
  });

  it("an undeclared ambiguous canvas fails naming footprints.json", () => {
    expect(() => resolveFootprint("windmill", 256, 300, {}))
      .toThrow('declare "windmill" in assets/buildings-src/footprints.json');
    expect(() => resolveFootprint("windmill", 200, 200, {}))
      .toThrow('declare "windmill" in assets/buildings-src/footprints.json');
  });

  it("a malformed footprint fails instead of compiling wrong", () => {
    expect(() => resolveFootprint("t", 128, 128, { declared: [0, 3] as any })).toThrow();
    expect(() => resolveFootprint("t", 128, 128, { declared: [2.5, 2] as any })).toThrow();
  });
});

describe("F1 loadDeclaredFootprints", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
  });

  it("accepts bare [w,h] and {footprint, footRoom}, skips _notes", () => {
    const dir = mkdtempSync(join(tmpdir(), "f1-decl-"));
    dirs.push(dir);
    const file = join(dir, "footprints.json");
    writeFileSync(file, JSON.stringify({
      _note: "ignored",
      box: [2, 2],
      hall: { footprint: [1, 3], footRoom: 24 },
    }));
    expect(loadDeclaredFootprints(file)).toEqual({
      box: { footprint: [2, 2], footRoom: 0 },
      hall: { footprint: [1, 3], footRoom: 24 },
    });
  });

  it("a missing file means no declarations; a bad entry throws", () => {
    expect(loadDeclaredFootprints(join(tmpdir(), "f1-no-such-file.json"))).toEqual({});
    const dir = mkdtempSync(join(tmpdir(), "f1-decl-"));
    dirs.push(dir);
    const file = join(dir, "footprints.json");
    writeFileSync(file, JSON.stringify({ bad: { footprint: [9, 9] } }));
    expect(() => loadDeclaredFootprints(file)).toThrow("footprints.json");
  });
});

describe("F1 processBuilding (hermetic — tmp dirs only)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
  });

  function setup(): { srcDir: string; outDir: string } {
    const dir = mkdtempSync(join(tmpdir(), "f1-build-"));
    dirs.push(dir);
    return { srcDir: dir, outDir: join(dir, "out") };
  }

  /** Opaque rect fixture on a transparent W×H canvas. */
  async function fixture(srcDir: string, name: string, W: number, H: number, rect: [number, number, number, number]) {
    const [x, y, w, h] = rect;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
      `<rect width="${W}" height="${H}" fill="#000" fill-opacity="0"/>` +
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#c8a86a"/></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(join(srcDir, `${name}@2x.png`));
  }

  it("a declared 1×3 on the ambiguous 256² canvas compiles to [1, 3]", async () => {
    const { srcDir, outDir } = setup();
    await fixture(srcDir, "hall", 256, 256, [64, 96, 128, 104]);
    const e = await processBuilding("hall", {
      declared: { hall: { footprint: [1, 3], footRoom: 0 } }, srcDir, outDir,
    });
    expect(e.footprint).toEqual([1, 3]);
    expect(e.source).toBe("footprints.json");
    for (const z of ["0.5x", "1x", "2x"]) {
      expect(existsSync(join(outDir, `hall@${z}.png`))).toBe(true);
    }
    expect(e.warnings.some((m: string) => /bottom edge/.test(m))).toBe(false);
  });

  it("an undeclared ambiguous canvas rejects with the footprints.json message", async () => {
    const { srcDir, outDir } = setup();
    await fixture(srcDir, "hall", 256, 300, [64, 96, 128, 104]);
    await expect(processBuilding("hall", { srcDir, outDir }))
      .rejects.toThrow('declare "hall" in assets/buildings-src/footprints.json');
  });

  it("footRoom raises the anchor by exactly footRoom/2 at 1×", async () => {
    const { srcDir, outDir } = setup();
    await fixture(srcDir, "hall", 256, 256, [64, 96, 128, 104]);
    const plain = await processBuilding("hall", {
      declared: { hall: { footprint: [2, 2], footRoom: 0 } }, srcDir, outDir,
    });
    const footed = await processBuilding("hall", {
      declared: { hall: { footprint: [2, 2], footRoom: 24 } }, srcDir, outDir,
    });
    expect(footed.anchor[0]).toBe(plain.anchor[0]);
    // the vertex (and with it the anchor) moves UP by footRoom @2×
    expect(footed.anchor[1]).toBe(plain.anchor[1] - 12);
  });

  it("art cut flat along the bottom edge warns; a vertex touch stays quiet", async () => {
    const { srcDir, outDir } = setup();
    await fixture(srcDir, "cut", 256, 256, [0, 200, 256, 56]); // full-width bar to the edge
    const warned = await processBuilding("cut", {
      declared: { cut: { footprint: [2, 2], footRoom: 0 } }, srcDir, outDir,
    });
    expect(warned.warnings.some((m: string) => /bottom edge/.test(m))).toBe(true);
    await fixture(srcDir, "ok", 256, 256, [120, 200, 16, 56]); // narrow vertex-like touch
    const quiet = await processBuilding("ok", {
      declared: { ok: { footprint: [2, 2], footRoom: 0 } }, srcDir, outDir,
    });
    expect(quiet.warnings.some((m: string) => /bottom edge/.test(m))).toBe(false);
  });
});
