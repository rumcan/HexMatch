import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import {
  FACTORY_FOOTPRINT, FACTORY_SPRITE, INDUSTRY_BY_KEY, TOWN_HOUSE_VARIANTS,
  townHouseSprite,
} from "../../src/iso/config";
import type { Manifest } from "../../src/iso/atlas";

type RGB = [number, number, number];
type Layer = { sprite: number; tint?: RGB; tintLum?: RGB };
type Cell = {
  name: string; footprint?: [number, number] | "auto"; file?: string; scale?: number;
  layers?: Layer[]; frames?: Layer[][]; frameMs?: number;
};
const cells = (JSON.parse(readFileSync("tools/iso-atlas.cells.json", "utf8")) as { sprites: Cell[] }).sprites;
const manifest: Manifest = JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8"));
const cell = (name: string) => cells.find((c) => c.name === name)!;

// These pin the actual art mappings, not just the existence of a valid
// manifest: coal-mine sheds previously passed the generic atlas tests.
// PP-12: industries are single verbatim-TTD file sprites, so these pin the
// file each node maps to and the footprint the game plays it with.
describe("T1 finished gold-mine grounds and quarry reskin", () => {
  it("maps each node to its verbatim TTD file sprite with the art's footprint", () => {
    const files: Record<string, string> = {
      farm: "industries/ttd/farm.png",
      forest: "industries/ttd/forest.png",
      ore_mine: "industries/ttd/coal_mine.png",
      quarry: "industries/ttd/steel_mill.png",
      oil_rig: "industries/ttd/oil_wells.png",
      gold_mine: "industries/ttd/gold_mine.png",
    };
    expect(Object.keys(files).sort()).toEqual(Object.keys(INDUSTRY_BY_KEY).sort());
    for (const [type, file] of Object.entries(files)) {
      const c = cell(type);
      expect(c.file, `${type} must be a file cell`).toBe(file);
      expect(c.layers, `${type} must not compose layers`).toBeUndefined();
      const m = manifest.sprites[type];
      expect(m, `${type} manifest sprite`).toBeTruthy();
      // the game plays the node on exactly the tiles its art spans
      expect(INDUSTRY_BY_KEY[type].footprint, type).toEqual(m.footprint);
    }
  });

  it("mirrors every ground and animation frame into the grey quarry", async () => {
    const { data, info } = await sharp("assets/iso-atlas/atlas@1x.png").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const shades = new Set<number>();
    for (let m = 72; m <= 87; m++) {
      const gold = cell(`gold_mine_t${m}`), quarry = cell(`quarry_t${m}`);
      const allLayers = (c: Cell) => [...c.layers, ...(c.frames ?? []).flat()];
      expect(allLayers(quarry).map((l) => l.sprite)).toEqual(allLayers(gold).map((l) => l.sprite));
      for (const l of allLayers(quarry)) expect(l.tintLum).toEqual([138, 138, 138]);
      const s = manifest.sprites[quarry.name];
      let coloured = 0, opaque = 0;
      for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) {
        const i = (y * info.width + x) * 4;
        if (!data[i + 3]) continue;
        opaque++;
        if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) coloured++;
        shades.add(data[i]);
      }
      expect(opaque, quarry.name).toBeGreaterThan(500);
      expect(coloured, `${quarry.name} must be grey, not dark brown`).toBe(0);
    }
    expect(shades.size).toBeGreaterThan(16); // preserve texture/shading
  });
});

describe("T2 real town buildings", () => {
  it("uses the TTD church as the town centre and one file sprite per house variant", () => {
    // the landmark: verbatim TTD church, 1×1, bottom-centre anchored
    const centre = cell("town_center");
    expect(centre.file).toBe("houses/ttd/church.png");
    expect(manifest.sprites.town_center.footprint).toEqual([1, 1]);
    // every variant is a packed TTD house file on its own 1×1 tile
    expect(TOWN_HOUSE_VARIANTS).toHaveLength(43);
    for (const name of TOWN_HOUSE_VARIANTS) {
      expect(name).toMatch(/^town_/);
      expect(cell(name).file, `${name} must be a file cell`).toMatch(/^houses\/ttd\/.*\.png$/);
      const m = manifest.sprites[name];
      expect(m, `${name} manifest sprite`).toBeTruthy();
      expect(m.footprint, name).toEqual([1, 1]);
    }
    expect(manifest.sprites.town_house).toBeUndefined();
  });

  it("deterministically deals every variant with no weighting", () => {
    const counts = new Map<string, number>();
    for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) {
      const name = townHouseSprite(x, y);
      expect(TOWN_HOUSE_VARIANTS).toContain(name);
      expect(townHouseSprite(x, y)).toBe(name);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    // a uniform pick over 43 variants: every variant appears across a town's
    // worth of tiles, and none dominates (a stuck/mod-biased hash would).
    expect(counts.size).toBe(TOWN_HOUSE_VARIANTS.length);
    const vals = [...counts.values()];
    expect(Math.min(...vals)).toBeGreaterThan(0);
    expect(Math.max(...vals) / Math.min(...vals)).toBeLessThan(3);
  });
});

describe("T3 factory mapping and uniform tint", () => {
  it("draws the factory as one verbatim TTD complex on the art's footprint", () => {
    const c = cell(FACTORY_SPRITE);
    expect(c.file).toBe("industries/ttd/factory.png");
    expect(c.footprint).toBe("auto");
    expect(c.layers, "the factory must not compose layers").toBeUndefined();
    const m = manifest.sprites[FACTORY_SPRITE];
    expect(m).toBeTruthy();
    // the game plays the factory on exactly the tiles its art spans
    expect(FACTORY_FOOTPRINT).toEqual(m.footprint);
  });
});

describe("T2 atlas packing regression", () => {
  it("keeps every packed rect, including the final tall office, inside every zoom image", async () => {
    for (const zoom of [0.5, 1, 2] as const) {
      const { width, height } = await sharp(`assets/iso-atlas/${manifest.images[String(zoom)]}`).metadata();
      for (const [name, s] of Object.entries(manifest.sprites)) {
        expect(Math.round(s.x * zoom) + Math.round(s.w * zoom), `${name} at ${zoom}×`).toBeLessThanOrEqual(width!);
        expect(Math.round(s.y * zoom) + Math.round(s.h * zoom), `${name} at ${zoom}×`).toBeLessThanOrEqual(height!);
      }
    }
  });
});
