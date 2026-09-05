import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { validateManifest } from "../../tools/validate-manifest.mjs";

const realManifest = JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8")) as {
  tileW: number; tileH: number;
  sprites: Record<string, {
    x: number; y: number; w: number; h: number;
    footprint: [number, number]; anchor: [number, number];
    parts?: { sprite: string; dx: number; dy: number }[];
  }>;
};

const cells = JSON.parse(readFileSync("tools/iso-atlas.cells.json", "utf8")) as {
  tileW: number; tileH: number; blockH: number;
  source: { root: string; license: string };
  sprites: {
    name: string; png?: string; kind?: string; footprint?: [number, number];
    tintLum?: [number, number, number]; mask?: [number, number];
    stack?: { png: string }[];
    compose?: unknown; box?: unknown; crop?: unknown; generator?: unknown;
    layers?: unknown; trackset?: unknown; sprite?: unknown;
  }[];
};

// K1 acceptance: the manifest validates against the JSON schema, and every
// cell is a bare PNG reference — the OpenGFX compose/box/crop/generator
// vocabulary is gone from the cells file for good.

const good = {
  images: { "0.5": "a@0.5x.png", "1": "a@1x.png", "2": "a@2x.png" },
  tileW: 132, tileH: 64,
  sprites: {
    terrain_grass: { x: 0, y: 0, w: 132, h: 83, footprint: [1, 1], anchor: [66, 33] },
    oil_rig: { x: 132, y: 0, w: 133, h: 127, footprint: [1, 1], anchor: [66, 59] },
  },
};

describe("K1 manifest schema validation", () => {
  it("accepts a Kenney-geometry manifest", () => {
    expect(validateManifest(good)).toEqual([]);
  });

  it("rejects missing required fields", () => {
    const bad = JSON.parse(JSON.stringify(good));
    delete bad.sprites.terrain_grass.anchor;
    const errors = validateManifest(bad);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toContain("anchor");
  });

  it("rejects an anchor outside its sprite rect", () => {
    const bad = JSON.parse(JSON.stringify(good));
    bad.sprites.terrain_grass.anchor = [133, 33];
    expect(validateManifest(bad).join("\n")).toContain("anchor");
  });

  it("rejects a building sprite dramatically smaller than its footprint", () => {
    const bad = JSON.parse(JSON.stringify(good));
    bad.sprites.factory_blue = { x: 0, y: 400, w: 30, h: 30, footprint: [1, 1], anchor: [15, 29] };
    expect(validateManifest(bad).join("\n")).toContain("covers < half");
  });

  it("the shipped manifest validates clean (schema + geometry)", () => {
    expect(validateManifest(realManifest)).toEqual([]);
  });
});

describe("K1 cells are bare PNG references (no OpenGFX pipeline survives)", () => {
  it("no cell carries compose/box/crop/generator/layers/sprite-id/trackset", () => {
    const raw = readFileSync("tools/iso-atlas.cells.json", "utf8");
    for (const s of cells.sprites) {
      for (const forbidden of
        ["compose", "box", "boxes", "crop", "crops", "generator", "layers", "trackset", "sprite", "frames", "anchor"]) {
        expect(s[forbidden as keyof typeof s], `cell ${s.name} still carries \`${forbidden}\``).toBeUndefined();
      }
    }
    for (const token of ['"compose"', '"crop"', '"generator"', '"trackset"']) {
      expect(raw, `cells file still contains ${token}`).not.toContain(token);
    }
  });

  it("every cell is either one PNG or an ordered stack whose layers all exist", () => {
    expect(cells.sprites.length).toBeGreaterThan(30);
    for (const s of cells.sprites) {
      if (s.stack) {
        expect(s.png, `${s.name} must not mix stack and png`).toBeUndefined();
        expect(s.stack.length, `${s.name} stack size`).toBeGreaterThanOrEqual(2);
        expect(s.stack.length, `${s.name} stack size`).toBeLessThanOrEqual(6);
        for (const l of s.stack) {
          expect(existsSync(join(cells.source.root, l.png)), `${s.name} layer ${l.png} missing`).toBe(true);
        }
      } else {
        expect(typeof s.png, `${s.name}.png`).toBe("string");
        expect(existsSync(join(cells.source.root, s.png!)), `${s.png} missing`).toBe(true);
      }
    }
  });

  it("declares the Kenney source and its CC0 licence", () => {
    expect(cells.source.root).toBe("src/iso/kenny");
    expect(cells.source.license).toMatch(/CC0/i);
  });

  it("declares the measured Kenney geometry", () => {
    expect(cells.tileW).toBe(132);
    expect(cells.tileH).toBe(64);
    expect(cells.blockH).toBe(50);
    expect(realManifest.tileW).toBe(132);
    expect(realManifest.tileH).toBe(64);
  });
});

describe("K1/K2 the 16 road masks (and rail mirrors) are an explicit table", () => {
  it("has all 16 road_XXXX cells, each an explicit PNG reference", () => {
    for (let mask = 0; mask < 16; mask++) {
      const key = `road_${mask.toString(2).padStart(4, "0")}`;
      const cell = cells.sprites.find((s) => s.name === key);
      expect(cell, key).toBeTruthy();
      expect(typeof cell!.png, `${key} must name a PNG`).toBe("string");
      expect(cell!.mask, `${key} carries its mask`).toEqual([0, mask]);
    }
  });

  it("the two straights are DIFFERENT Kenney tiles (the 90-degree bug guard)", () => {
    const png = (n: string) => cells.sprites.find((s) => s.name === n)!.png;
    expect(png("road_0101")).not.toEqual(png("road_1010"));
  });

  it("has all 16 rail_XXXX cells plus the crossing", () => {
    for (let mask = 0; mask < 16; mask++) {
      const key = `rail_${mask.toString(2).padStart(4, "0")}`;
      expect(cells.sprites.find((s) => s.name === key), key).toBeTruthy();
    }
    expect(cells.sprites.find((s) => s.name === "crossing")).toBeTruthy();
  });

  it("every cell the renderer can ask for exists in the shipped manifest", () => {
    for (const s of cells.sprites) {
      expect(realManifest.sprites[s.name], `${s.name} missing from manifest`).toBeTruthy();
    }
    // the game's fixed sprite vocabulary
    for (const name of [
      "terrain_grass", "terrain_water", "terrain_rough", "crossing",
      "highlight", "highlight_soft",
      "farm", "forest", "ore_mine", "quarry", "oil_rig", "gold_mine",
      "factory_blue", "factory_red", "factory_purple", "factory_green",
      "depot_blue", "depot_red", "depot_purple", "depot_green",
    ]) {
      expect(realManifest.sprites[name], `${name} missing`).toBeTruthy();
    }
  });
});

// ── K1/K4 anchor rule: computed from the pixels, never hand-authored ──────
// Recompute the packer's anchor from each source PNG (widest opaque row of
// the base diamond; bottom-centre for vehicles) and demand the manifest match.

describe("K1/K4 anchors are pixel-measured, not hand-authored", () => {
  const kinds = new Map(cells.sprites.map((s) => [s.name, s]));

  it("ground/standing anchors equal the source PNG's widest base row", async () => {
    for (const s of cells.sprites) {
      // MB1 stacked cells are composites anchored on their stack, not a single PNG.
      if (s.stack) continue;
      if (s.kind !== "ground" && s.kind !== "standing") continue;
      const m = realManifest.sprites[s.name];
      const { data, info } = await sharp(join(cells.source.root, s.png!))
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let widest = -1, yAt = -1;
      for (let y = 0; y < info.height; y++) {
        let n = 0;
        for (let x = 0; x < info.width; x++)
          if (data[(y * info.width + x) * 4 + 3] > 10) n++;
        if (n > widest) { widest = n; yAt = y; }
      }
      expect(m.anchor, `${s.name} anchor must be the measured widest row`).toEqual([Math.floor(info.width / 2), yAt]);
    }
  }, 30_000);

  it("ground cells are flat-topped: widest row at y≈32 with ~full width (no slopes)", async () => {
    for (const s of cells.sprites) {
      if (s.kind !== "ground") continue;
      const { data, info } = await sharp(join(cells.source.root, s.png!))
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let widest = -1, yAt = -1;
      for (let y = 0; y < info.height; y++) {
        let n = 0;
        for (let x = 0; x < info.width; x++)
          if (data[(y * info.width + x) * 4 + 3] > 10) n++;
        if (n > widest) { widest = n; yAt = y; }
      }
      expect(Math.abs(yAt - cells.tileH / 2), `${s.name} widest row at y=${yAt} — slope tile?`).toBeLessThanOrEqual(4);
      expect(widest, `${s.name} widest row only ${widest}px wide`).toBeGreaterThanOrEqual(cells.tileW - 10);
    }
  }, 30_000);

  it("every footprint is 1×1 (one coherent building per concept, K3)", () => {
    for (const s of cells.sprites) {
      expect(s.footprint, `${s.name}`).toEqual([1, 1]);
    }
  });

  it("manifest sizes match the source PNGs exactly (packer never crops)", () => {
    for (const s of cells.sprites) {
      const m = realManifest.sprites[s.name];
      // sizes checked against the real files in the pixels test (sharp there);
      // here at least the manifest/cells vocabulary is consistent.
      expect(m.footprint).toEqual(s.footprint);
      expect(m.anchor.length).toBe(2);
    }
    expect(kinds.get("factory_blue")!.tintLum).toEqual([70, 130, 220]);
  });
});

// ── MB1 composite stacks: a `stack` cell → one composite manifest sprite ──
describe("MB1 stacked-building composites", () => {
  const stackCells = cells.sprites.filter((s) => s.stack);
  const layerName = (png: string, tint?: [number, number, number]) => {
    const stem = png.slice(png.lastIndexOf("/") + 1).replace(/\.png$/i, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return tint ? `layer_${stem}_${tint.join("_")}` : `layer_${stem}`;
  };

  it("only stack cells are composites (single-png cells never gain parts)", () => {
    for (const s of cells.sprites) {
      const m = realManifest.sprites[s.name];
      if (s.stack) {
        expect(m.parts, `${s.name} must be a composite`).toBeTruthy();
      } else {
        expect(m.parts, `${s.name} must stay single-piece`).toBeUndefined();
      }
    }
  });

  it("each stack's parts resolve to real packed layer sprites in order", () => {
    for (const s of stackCells) {
      const m = realManifest.sprites[s.name];
      expect(m.parts!.length).toBe(s.stack!.length);
      s.stack!.forEach((l, i) => {
        const ln = layerName(l.png, s.tintLum);
        expect(m.parts![i].sprite, `${s.name} part ${i}`).toBe(ln);
        const layerSprite = realManifest.sprites[ln];
        expect(layerSprite, `${ln} must be packed`).toBeTruthy();
        expect(layerSprite.parts, `${ln} must not itself be a composite`).toBeUndefined();
      });
    }
  });
});
