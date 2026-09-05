import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

// ══════════════════════════════════════════════════════════════════════════
// K2 — atlas pixel invariants over the Kenney sources.
//
// The road mask→PNG table is the one place the old 90-degree bug lived, so
// every road cell is verified against ITS OWN source PNG here: asphalt must
// cross the diamond edge midpoints of the set arms and be absent at the
// unset ones. Tinted cells must actually carry their player hue. Terrain
// cells must be the terrain they claim.
// ══════════════════════════════════════════════════════════════════════════

const manifest = JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8")) as {
  tileW: number; tileH: number;
  sprites: Record<string, {
    x: number; y: number; w: number; h: number; anchor: [number, number];
    parts?: { sprite: string; dx: number; dy: number }[];
  }>;
};
const cells = JSON.parse(readFileSync("tools/iso-atlas.cells.json", "utf8")) as {
  source: { root: string };
  sprites: {
    name: string; png?: string; kind: string; mask?: [number, number];
    tintLum?: [number, number, number]; stack?: { png: string }[];
  }[];
};
const cell = (name: string) => cells.sprites.find((s) => s.name === name)!;
const srcPath = (name: string) => join(cells.source.root, cell(name).png!);
/** MB1: the packer's deterministic layer-sprite name for a (png, tint) layer. */
const layerName = (png: string, tint: [number, number, number]) => {
  const stem = png.slice(png.lastIndexOf("/") + 1).replace(/\.png$/i, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `layer_${stem}_${tint.join("_")}`;
};

type Raw = { data: Buffer; info: { width: number; height: number } };
const cache = new Map<string, Raw>();
async function img(path: string): Promise<Raw> {
  if (!cache.has(path)) {
    cache.set(path, await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true }) as unknown as Raw);
  }
  return cache.get(path)!;
}

// Kenney diamond geometry: centre (66,32); edge midpoints of the four arms.
// Game direction bits: NE=1 SE=2 SW=4 NW=8 (NE exits through the upper-right
// edge — up-right on screen — matching tileToScreen steps of (+HW,−HH)).
const ARMS: Record<number, [number, number]> = {
  1: [99, 16],   // NE — upper-right edge midpoint
  2: [99, 48],   // SE — lower-right edge midpoint
  4: [33, 48],   // SW — lower-left edge midpoint
  8: [33, 16],   // NW — upper-left edge midpoint
};

const isGreyAsphalt = (r: number, g: number, b: number) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const lum = (r + g + b) / 3;
  return max - min < 45 && lum > 70 && lum < 190;
};

/** Fraction of grey-asphalt pixels in a window around a point (0..1). */
async function asphaltAt(name: string, mx: number, my: number, r = 4) {
  const { data, info } = await img(srcPath(name));
  let grey = 0, tot = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -8; dx <= 8; dx++) {
      const x = mx + dx, y = my + dy;
      if (x < 0 || y < 0 || x >= info.width || y >= info.height) continue;
      const i = (y * info.width + x) * 4;
      if (data[i + 3] < 200) continue;
      tot++;
      if (isGreyAsphalt(data[i], data[i + 1], data[i + 2])) grey++;
    }
  }
  return tot === 0 ? 0 : grey / tot;
}

describe("K2 road masks — verified against their own source PNGs", () => {
  it("asphalt crosses every set arm and no unset arm (the 90° guard)", async () => {
    for (let mask = 1; mask < 16; mask++) {
      const key = `road_${mask.toString(2).padStart(4, "0")}`;
      for (const bit of [1, 2, 4, 8]) {
        const frac = await asphaltAt(key, ARMS[bit][0], ARMS[bit][1]);
        if (mask & bit) {
          expect(frac, `${key}: arm ${bit} must carry road surface`).toBeGreaterThanOrEqual(0.5);
        } else {
          expect(frac, `${key}: arm ${bit} must NOT carry road surface`).toBeLessThanOrEqual(0.15);
        }
      }
    }
    // mask 0000 is deliberately the NE dead-end stub — a lone PRESENT-bit road
    // reads as a stub, so its NE arm does carry asphalt.
    expect(await asphaltAt("road_0000", ARMS[1][0], ARMS[1][1])).toBeGreaterThanOrEqual(0.5);
  }, 60_000);

  it("the NE–SW and SE–NW straights run on opposite diagonals", async () => {
    // road_0101 = NE+SW: band through the centre from (99,16) to (33,48).
    const centre = async (name: string) => asphaltAt(name, 66, 32, 3);
    expect(await centre("road_0101")).toBeGreaterThanOrEqual(0.5);
    expect(await centre("road_1010")).toBeGreaterThanOrEqual(0.5);
    // and each straight is quiet on the other's diagonal endpoints
    expect(await asphaltAt("road_0101", 99, 48)).toBeLessThanOrEqual(0.15);
    expect(await asphaltAt("road_1010", 99, 16)).toBeLessThanOrEqual(0.15);
  });

  it("rail masks carry rails on their set arms (derived art honours the table)", async () => {
    // dark steel (<95 lum) in a window at the arm midpoints
    const railAt = async (name: string, mx: number, my: number) => {
      const { data, info } = await img(srcPath(name));
      let dark = 0;
      for (let dy = -5; dy <= 5; dy++) {
        for (let dx = -10; dx <= 10; dx++) {
          const x = mx + dx, y = my + dy;
          if (x < 0 || y < 0 || x >= info.width || y >= info.height) continue;
          const i = (y * info.width + x) * 4;
          if (data[i + 3] < 200) continue;
          if ((data[i] + data[i + 1] + data[i + 2]) / 3 < 95) dark++;
        }
      }
      return dark;
    };
    expect(await railAt("rail_0101", 99, 16)).toBeGreaterThan(10);   // NE rail
    expect(await railAt("rail_0101", 33, 48)).toBeGreaterThan(10);   // SW rail
    expect(await railAt("rail_0101", 99, 48)).toBe(0);               // SE: no rail
    expect(await railAt("rail_1010", 99, 48)).toBeGreaterThan(10);   // SE rail
    expect(await railAt("rail_1010", 33, 16)).toBeGreaterThan(10);   // NW rail
  });
});

describe("K2/K3 atlas cells match their sources and their claimed terrain", () => {
  it("untinted atlas cells are pixel-identical to their source PNGs at 1x", async () => {
    const atlasRaw = await img("assets/iso-atlas/atlas@1x.png");
    for (const name of ["terrain_grass", "road_0101", "rail_0111", "crossing", "farm", "oil_rig"]) {
      const src = await img(srcPath(name));
      const s = manifest.sprites[name];
      for (const [x, y] of [[0, 0], [s.w - 1, 0], [Math.floor(s.w / 2), s.anchor[1]], [3, 7], [s.w - 4, s.h - 4]] as const) {
        const si = (y * src.info.width + x) * 4;
        const ai = ((s.y + y) * atlasRaw.info.width + (s.x + x)) * 4;
        expect([atlasRaw.data[ai], atlasRaw.data[ai + 1], atlasRaw.data[ai + 2], atlasRaw.data[ai + 3]],
          `${name} (${x},${y}) differs from ${cell(name).png}`).toEqual(
          [src.data[si], src.data[si + 1], src.data[si + 2], src.data[si + 3]]);
      }
    }
  });

  it("terrain cells are the terrain they claim", async () => {
    const avg = async (name: string) => {
      const { data, info } = await img(srcPath(name));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = 8; y < 40; y++) {
        for (let x = 40; x < 92; x++) {
          const i = (y * info.width + x) * 4;
          if (data[i + 3] < 200) continue;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
      }
      return [r / n, g / n, b / n];
    };
    const [gr, gg, gb] = await avg("terrain_grass");
    expect(gg, "grass is green").toBeGreaterThan(gr + 20);
    const [wr, wg, wb] = await avg("terrain_water");
    expect(wb, "water is blue").toBeGreaterThan(wr + 20);
    const [rr, rg2, rb] = await avg("terrain_rough");
    expect(rr, "rough is sand/tan").toBeGreaterThan(rb + 20);
    expect(rr, "rough differs from grass").toBeGreaterThan(gr + 25);
  });

  it("the four factory/depot tints carry their player hue on the shared layer sprites", async () => {
    // MB1: factory/depot are now composite STACKS (no atlas region of their
    // own) — the tint lives on their shared (png, tint) layer sprites. Each
    // factory/depot cell is therefore verified against its tinted layer.
    const mean = async (name: string) => {
      const { data, info } = await img("assets/iso-atlas/atlas@1x.png");
      const s = manifest.sprites[name];
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = 0; y < s.h; y += 2) {
        for (let x = 0; x < s.w; x += 2) {
          const i = ((s.y + y) * info.width + (s.x + x)) * 4;
          if (data[i + 3] < 200) continue;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
      }
      return [r / n, g / n, b / n] as const;
    };
    const layerMean = async (cellName: string) => {
      const s = cell(cellName);
      const tint = s.tintLum!;
      return mean(layerName(s.stack![0].png, tint));
    };
    const [br, , bb] = await layerMean("factory_blue");
    expect(bb, "blue factory leans blue").toBeGreaterThan(br + 12);
    const [rr, , rb] = await layerMean("factory_red");
    expect(rr, "red factory leans red").toBeGreaterThan(rb + 12);
    const [pr, pg, pb] = await layerMean("factory_purple");
    expect(pr + pb, "purple factory leans purple").toBeGreaterThan(pg + 12);
    const [gr, gg, gb] = await layerMean("factory_green");
    expect(gg, "green factory leans green").toBeGreaterThan(Math.max(gr, gb) + 8);
    const [dr, , db] = await layerMean("depot_red");
    expect(dr, "red depot leans red").toBeGreaterThan(db + 12);
    expect(manifest.sprites[layerName("buildings/PNG/buildingTiles_044.png", [70, 130, 220])])
      .toBeTruthy();  // factory_blue + depot_blue share the tinted storey layer
  });

  it("tint families share one stack geometry: identical size and anchor", () => {
    const fam = ["factory_blue", "factory_red", "factory_purple", "factory_green"];
    const base = manifest.sprites[fam[0]];
    for (const n of fam.slice(1)) {
      const s = manifest.sprites[n];
      expect([s.w, s.h, s.anchor]).toEqual([base.w, base.h, base.anchor]);
      expect(s.parts?.length).toBe(base.parts?.length);
    }
    const depots = ["depot_blue", "depot_red", "depot_purple", "depot_green"];
    const db = manifest.sprites[depots[0]];
    for (const n of depots.slice(1)) {
      const s = manifest.sprites[n];
      expect([s.w, s.h, s.anchor]).toEqual([db.w, db.h, db.anchor]);
      expect(s.parts?.length).toBe(db.parts?.length);
    }
  });
});

describe("K3 industries are distinct coherent buildings", () => {
  it("each industry maps to a different single source PNG", () => {
    const pngs = new Set(["farm", "forest", "ore_mine", "quarry", "oil_rig", "gold_mine"]
      .map((n) => cell(n).png));
    expect(pngs.size).toBe(6);
    // factories/depots are now STACKED composites, not single png cells
    expect(cell("factory_blue").stack).toBeTruthy();
    expect(cell("depot_blue").stack).toBeTruthy();
    expect(cell("factory_blue").png).toBeUndefined();
    // industries stay one-piece and never borrow a stack layer tile
    for (const n of ["farm", "forest", "ore_mine", "quarry", "oil_rig", "gold_mine"]) {
      for (const b of ["factory_blue", "depot_blue"]) {
        const layers = cell(b).stack!.map((l) => l.png);
        expect(layers, `${b} shares a tile with ${n}`).not.toContain(cell(n).png);
      }
    }
  });

  it("factories stack taller than depots (MB1 storey mix)", () => {
    expect(cell("factory_blue").stack!.length).toBe(5);   // base + 3 floors + roof
    expect(cell("depot_blue").stack!.length).toBe(3);     // base + 1 floor + roof
    // every factory/depot layer resolves to a packed layer sprite in the manifest
    for (const b of ["factory_blue", "factory_red", "factory_purple", "factory_green",
      "depot_blue", "depot_red", "depot_purple", "depot_green"]) {
      const s = cell(b);
      for (const l of s.stack!) {
        expect(manifest.sprites[layerName(l.png, s.tintLum!)], `${b} layer ${l.png}`)
          .toBeTruthy();
      }
      expect(manifest.sprites[b].parts?.length).toBe(s.stack!.length);
    }
  });

  it("the composite stands flush: base layer's widest row is the ground anchor", () => {
    const f = manifest.sprites.factory_blue;
    // composite anchor x is centred; w/h form the union bounding box (taller than
    // any single layer), and the base layer is the first part at dy such that its
    // own widest row lands on the tile ground line.
    expect(f.parts).toBeTruthy();
    expect(f.w).toBeGreaterThanOrEqual(90);
    expect(f.h).toBeGreaterThan(manifest.sprites.farm.h);
    expect(f.anchor[0]).toBe(Math.floor(f.w / 2));
    // building rises out of the ground, roof far above the base row
    expect(f.parts![0].dy).toBeGreaterThan(0);
    expect(f.parts![f.parts!.length - 1].dy).toBe(0);      // roof caps the top
  });
});
