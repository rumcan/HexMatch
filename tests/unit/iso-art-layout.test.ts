import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { parsePnml } from "../../tools/parse-pnml.mjs";
import { FACTORY_TILES, INDUSTRY_BY_KEY, TOWN_HOUSE_VARIANTS, townHouseSprite } from "../../src/iso/config";
import type { Manifest } from "../../src/iso/atlas";

type RGB = [number, number, number];
type Layer = { sprite: number; tint?: RGB; tintLum?: RGB };
type Cell = { name: string; footprint: [number, number]; layers: Layer[]; frames?: Layer[][]; frameMs?: number };
const cells = (JSON.parse(readFileSync("tools/iso-atlas.cells.json", "utf8")) as { sprites: Cell[] }).sprites;
const manifest: Manifest = JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8"));
const cell = (name: string) => cells.find((c) => c.name === name)!;

// These pin the handover's actual art mappings, not just the existence of a
// valid manifest: coal-mine sheds previously passed the generic atlas tests.
describe("T1 finished gold-mine grounds and quarry reskin", () => {
  it("uses the 16 finished grounds once each, with only the shaft tower animated", () => {
    for (const type of ["gold_mine", "quarry"]) {
      const tiles = INDUSTRY_BY_KEY[type].tiles!;
      expect(tiles).toHaveLength(16);
      for (const t of tiles) {
        expect(t.m).toBe(72 + 4 * t.dx + t.dy);
        expect(t.ground).toBe(2247 + t.m - 72);
        const c = cell(`${type}_t${t.m}`);
        expect(c.footprint).toEqual([1, 1]);
        expect(c.layers.map((l) => l.sprite)).toEqual([t.ground]);
        if (t.m === 79) {
          expect(t.building).toBe(2263);
          expect(c.frames?.map((f) => f.map((l) => l.sprite))).toEqual([[2263], [2264], [2265]]);
          expect(c.frameMs).toBe(200);
        } else {
          expect(t.building).toBeUndefined();
          expect(c.frames).toBeUndefined(); // palette shimmer is intentionally static
        }
      }
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
  it("uses complete-stage house/office pairs and a hotel landmark", () => {
    const pairs: Record<string, number[]> = {
      town_center: [1420, 1450], town_house_a: [1447, 1446],
      town_house_b: [1420, 1460], town_house_c: [1424, 1423],
    };
    const decls = parsePnml();
    for (const [name, ids] of Object.entries(pairs)) {
      expect(cell(name).layers.map((l) => l.sprite)).toEqual(ids);
      expect(cell(name).footprint).toEqual([1, 1]);
      for (const id of ids) {
        const decl = decls[String(id)];
        expect(decl, `${name}: declaration ${id}`).toBeTruthy();
        const path = `src/assets/sprites/png/${decl.file.replace(/^sprites\/png\//, "")}`;
        // Catch the patch's accidental JSON 404 response masquerading as PNG.
        expect(readFileSync(path).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      }
      expect(decls[String(ids[1])].file).toContain("/houses/");
      expect(manifest.sprites[name]).toBeTruthy();
    }
    expect(manifest.sprites.town_house).toBeUndefined();
  });

  it("deterministically mixes mostly small homes with occasional taller offices", () => {
    const counts = new Map<string, number>();
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
      const name = townHouseSprite(x, y);
      expect(TOWN_HOUSE_VARIANTS).toContain(name);
      expect(townHouseSprite(x, y)).toBe(name);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    expect(counts.get("town_house_a")! / 1600).toBeGreaterThan(0.55);
    expect(counts.get("town_house_b")! / 1600).toBeGreaterThan(0.15);
    expect(counts.get("town_house_c")! / 1600).toBeLessThan(0.18);
    expect(counts.get("town_house_c")).toBeGreaterThan(0);
  });
});

describe("T3 factory mapping and uniform tint", () => {
  it("keeps the authoritative chimney/yard positions and tints ground AND buildings", () => {
    expect(FACTORY_TILES).toEqual([
      { dx: 0, dy: 0, m: 39, ground: 2146, building: 2150 },
      { dx: 0, dy: 1, m: 40, ground: 2147, building: 2151 },
      { dx: 1, dy: 0, m: 41, ground: 2148, building: 2152 },
      { dx: 1, dy: 1, m: 42, ground: 2149 },
    ]);
    for (const [colour, tint] of [["blue", [70, 130, 220]], ["red", [224, 70, 70]]] as const) {
      for (const tile of FACTORY_TILES) {
        const c = cell(`factory_mt_${colour}_${tile.dy * 2 + tile.dx}`);
        const ids = [tile.ground, ...("building" in tile ? [tile.building] : [])];
        expect(c.layers.map((l) => l.sprite)).toEqual(ids);
        for (const l of c.layers) expect(l.tintLum, c.name).toEqual(tint);
      }
    }
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
