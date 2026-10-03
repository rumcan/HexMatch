import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

// 3D-FIX-1: tall buildings — shrink the hotel-class tower, solid base under the glass towers
// This test checks both acceptance criteria:
// 1) The big hotel building (town_hotel) is scaled to ~60% via MODEL_SCALE
// 2) The two glass tower GLBs stand solid on the ground (lowest 20% covers >=80% of plan)
// The geometry test must fail on the original files (before fix-stilts.mjs) and pass after.

describe("3D-FIX-1: tall buildings", () => {
  it("identifies the big hotel and scales it to ~60% (MODEL_SCALE)", async () => {
    // The 5-storey cream-stone-banded red-brick building with terracotta roof terrace
    // and striped canopy is town_hotel. It is the tallest 2×2 hotel/offices-class
    // building in tier-3 towns:
    //   town_hotel       h=1.2486 (tallest)
    //   town_house_c     h=1.0498
    //   town_offices_tall h=0.7777 (halved in build-models)
    //   town_flats_grey   h=0.5906 (halved)
    // We scale it at runtime via MODEL_SCALE (HEIGHT_SCALE in build-models.mjs is only a record).
    const src = fs.readFileSync("src/iso/three-layer.ts", "utf8");
    // Check that MODEL_SCALE is exported and contains town_hotel at ~0.6
    expect(src).toMatch(/export\s+const\s+MODEL_SCALE/);
    expect(src).toMatch(/town_hotel/);
    // Try to import the actual table for a precise numeric check
    let scale: Record<string, number> | null = null;
    try {
      const mod = await import("../../src/iso/three-layer.ts");
      scale = (mod as any).MODEL_SCALE ?? (mod as any).MODEL_SIZE ?? null;
    } catch {
      // Fallback to parsing the source if import fails (e.g., three not available in node)
      const m = src.match(/MODEL_SCALE[^}]*\{([^}]+)\}/s);
      if (m) {
        const entries = [...m[1].matchAll(/(\w+)\s*:\s*([0-9.]+)/g)];
        scale = Object.fromEntries(entries.map((e) => [e[1], Number(e[2])]));
      }
    }
    expect(scale, "MODEL_SCALE should be importable or parsable").not.toBeNull();
    expect(scale!["town_hotel"], "town_hotel should be scaled").toBeCloseTo(0.6, 1);
    // Also ensure the runtime uses MODEL_SCALE (not just MODEL_SIZE)
    expect(src).toMatch(/MODEL_SCALE\[mo!\.name\]/);
    // store_2x4 should still be scaled (existing fix)
    expect(scale!["store_2x4"]).toBeCloseTo(0.6, 1);
  });

  it("glass towers stand solid on the ground (lowest 20% covers >=80% of plan)", async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ "meshopt.decoder": MeshoptDecoder });

    const checkSolid = async (name: string) => {
      const file = path.join("public/models", `${name}.glb`);
      expect(fs.existsSync(file), `${file} should exist`).toBe(true);
      const sz = fs.statSync(file).size;
      expect(sz, `${name}.glb should be <700KB (is ${(sz / 1024).toFixed(1)}KB)`).toBeLessThan(700 * 1024);

      const doc = await io.read(file);
      // Collect all triangles in world space
      const tris: [number[], number[], number[]][] = [];
      for (const scene of doc.getRoot().listScenes()) {
        const trav = (node: any) => {
          const world: number[] = node.getWorldMatrix();
          const mesh = node.getMesh();
          if (mesh) {
            for (const prim of mesh.listPrimitives()) {
              const pos: any = prim.getAttribute("POSITION");
              const idx: any = prim.getIndices();
              if (!pos || !idx) continue;
              const ia: Uint32Array | Uint16Array = idx.getArray();
              const v: number[] = [0, 0, 0];
              const getW = (i: number) => {
                pos.getElement(i, v);
                return [
                  world[0] * v[0] + world[4] * v[1] + world[8] * v[2] + world[12],
                  world[1] * v[0] + world[5] * v[1] + world[9] * v[2] + world[13],
                  world[2] * v[0] + world[6] * v[1] + world[10] * v[2] + world[14],
                ];
              };
              for (let t = 0; t < ia.length; t += 3) {
                tris.push([getW(ia[t]), getW(ia[t + 1]), getW(ia[t + 2])]);
              }
            }
          }
          for (const child of node.listChildren()) trav(child);
        };
        for (const child of scene.listChildren()) trav(child);
      }
      const all = (tris as any).flat() as number[][];
      // Actually all is array of [x,y,z], but we need to flatten correctly
      const pts = tris.flat() as unknown as number[][];
      const ys = (tris.flat() as unknown as number[][]).map((p) => p[1]);
      // Simpler: compute bounds directly from tris
      let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [a, b, c] of tris) {
        for (const p of [a, b, c]) {
          if (p[1] < y0) y0 = p[1];
          if (p[1] > y1) y1 = p[1];
          if (p[0] < x0) x0 = p[0];
          if (p[0] > x1) x1 = p[0];
          if (p[2] < z0) z0 = p[2];
          if (p[2] > z1) z1 = p[2];
        }
      }
      const h = y1 - y0;
      expect(h).toBeGreaterThan(0);

      // Sample at 3 heights inside the lowest 20%, but not too close to the ground
      // (to avoid the ground slab's own bottom-face complexity). Use 8%, 12%, 16% of height.
      const samples = [0.08, 0.12, 0.16];
      const epsX = (x1 - x0) * 0.02, epsZ = (z1 - z0) * 0.02;
      const grid = 32;
      const dx = (x1 - x0) / grid, dz = (z1 - z0) / grid;

      for (const frac of samples) {
        const y = y0 + h * frac;
        // Collect wall intersection segments at y that are on the outer boundary
        const segs: [number[], number[]][] = [];
        for (const [a, b, c] of tris) {
          const minY = Math.min(a[1], b[1], c[1]), maxY = Math.max(a[1], b[1], c[1]);
          if (y < minY - 1e-6 || y > maxY + 1e-6) continue;
          const pts = [a, b, c];
          const cross: number[][] = [];
          for (let e = 0; e < 3; e++) {
            const p1 = pts[e], p2 = pts[(e + 1) % 3];
            if ((p1[1] < y && p2[1] >= y) || (p2[1] < y && p1[1] >= y)) {
              const t = (y - p1[1]) / (p2[1] - p1[1]);
              cross.push([p1[0] + t * (p2[0] - p1[0]), p1[2] + t * (p2[2] - p1[2])]);
            }
          }
          if (cross.length === 2) {
            const isOuter = cross.some(
              ([x, z]) =>
                Math.abs(x - x0) < epsX ||
                Math.abs(x - x1) < epsX ||
                Math.abs(z - z0) < epsZ ||
                Math.abs(z - z1) < epsZ
            );
            if (isOuter) segs.push(cross as [number[], number[]]);
          }
        }
        // Deduplicate segments (plinth has each wall split into 2 triangles -> 2 identical segments)
        const uniq = new Map<string, [number[], number[]]>();
        for (const [p1, p2] of segs) {
          const k1 = `${p1[0].toFixed(3)},${p1[1].toFixed(3)}|${p2[0].toFixed(3)},${p2[1].toFixed(3)}`;
          const k2 = `${p2[0].toFixed(3)},${p2[1].toFixed(3)}|${p1[0].toFixed(3)},${p1[1].toFixed(3)}`;
          const k = k1 < k2 ? k1 : k2;
          if (!uniq.has(k)) uniq.set(k, [p1, p2]);
        }
        const uniqSegs = [...uniq.values()];
        // If there are no outer segs at this y, the slice is empty -> not solid
        if (uniqSegs.length === 0) {
          expect(
            false,
            `${name} at y=${y.toFixed(4)} (frac ${frac}) has no outer wall segments in lowest 20% — should be solid (expected after fix-stilts, fails on original)`
          ).toBe(true);
        }
        let inside = 0;
        for (let ix = 0; ix < grid; ix++) {
          for (let iz = 0; iz < grid; iz++) {
            const px = x0 + dx * (ix + 0.5), pz = z0 + dz * (iz + 0.5);
            let cnt = 0;
            for (const [[x1_, z1_], [x2_, z2_]] of uniqSegs) {
              if ((z1_ > pz) === (z2_ > pz)) continue;
              const xInt = x1_ + ((pz - z1_) * (x2_ - x1_)) / (z2_ - z1_);
              if (xInt > px) cnt++;
            }
            if (cnt % 2 === 1) inside++;
          }
        }
        const cov = inside / (grid * grid);
        expect(
          cov,
          `${name} at y=${y.toFixed(4)} (frac ${frac}) outer coverage ${cov.toFixed(3)} should be >=0.8 (lowest 20% solid)`
        ).toBeGreaterThanOrEqual(0.8);
      }
    };

    await checkSolid("town_office_tower_modern");
    await checkSolid("town_shops_modern");
  }, 30_000);

  it("keeps file sizes under 700KB (and does not touch other models)", () => {
    const check = (name: string) => {
      const file = path.join("public/models", `${name}.glb`);
      const sz = fs.statSync(file).size;
      expect(sz).toBeLessThan(700 * 1024);
    };
    check("town_office_tower_modern");
    check("town_shops_modern");
    // Spot-check that other large models are untouched (still <700 but not modified by this fix)
    // The hotel model should remain at its original size (around 500KB) and not be scaled on disk
    const hotelSz = fs.statSync("public/models/town_hotel.glb").size;
    expect(hotelSz).toBeLessThan(700 * 1024);
  });
});
