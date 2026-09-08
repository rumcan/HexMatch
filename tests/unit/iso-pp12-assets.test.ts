import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import sharp from "sharp";
import {
  FACTORY_FOOTPRINT, FACTORY_SPRITE, INDUSTRY_BY_KEY, TOWN_HOUSE_VARIANTS,
  depotSpriteForCargo, footprintForArt, type Cargo,
} from "../../src/iso/config";
import type { Manifest } from "../../src/iso/atlas";

type Cell = {
  name: string; file?: string; scale?: number; footprint?: [number, number] | "auto";
};
const cells = (JSON.parse(readFileSync("tools/iso-atlas.cells.json", "utf8")) as { sprites: Cell[] }).sprites;
const manifest: Manifest = JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8"));
const fileCells = cells.filter((c) => typeof c.file === "string");

/**
 * The PP-12 packer contract, re-derived independently of the slicer: load the
 * source PNG, apply the cell's `scale` (nearest neighbour), trim to the
 * opaque bbox (alpha > 8). tools/slice-atlas.mjs `makeFile` must produce
 * exactly these dimensions — anything else is a stale manifest.
 */
async function packedSize(c: Cell): Promise<[number, number]> {
  let img = sharp(`src/assets/sprites/png/${c.file}`, { limitInputPixels: false });
  if (typeof c.scale === "number" && c.scale !== 1) {
    const meta = await img.metadata();
    img = img.resize(
      Math.max(1, Math.round(meta.width! * c.scale)),
      Math.max(1, Math.round(meta.height! * c.scale)),
      { kernel: "nearest" },
    );
  }
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  expect(maxX, `${c.name}: ${c.file} is fully transparent`).toBeGreaterThanOrEqual(0);
  return [maxX - minX + 1, maxY - minY + 1];
}

describe("PP-12 the manifest matches the packed file art", () => {
  it("packs every file cell at its trimmed opaque-bbox size", async () => {
    expect(fileCells.length).toBeGreaterThan(0);
    for (const c of fileCells) {
      const m = manifest.sprites[c.name];
      expect(m, `manifest is missing file cell ${c.name}`).toBeTruthy();
      expect([m.w, m.h], `${c.name} (${c.file})`).toEqual(await packedSize(c));
    }
  });

  it("anchors every file sprite bottom-centre: [floor(w/2), h-1]", () => {
    for (const c of fileCells) {
      const m = manifest.sprites[c.name];
      expect(m.anchor, c.name).toEqual([Math.floor(m.w / 2), m.h - 1]);
    }
  });

  it("stamps `footprint: \"auto\"` from the art width — and the game agrees", async () => {
    const auto = fileCells.filter((c) => c.footprint === "auto");
    expect(auto.length).toBeGreaterThan(0);
    for (const c of auto) {
      const [w] = await packedSize(c);
      const m = manifest.sprites[c.name];
      // the slicer's own formula, re-stated: n = max(1, ceil((w-32)/64))
      const n = Math.max(1, Math.ceil((w - 32) / 64));
      expect(m.footprint, `${c.name} manifest footprint`).toEqual([n, n]);
      // …and the game's mirror derives the same tiles from the packed width
      expect(footprintForArt(m.w), `${c.name} game/packer agreement`).toEqual([n, n]);
    }
  });
});

describe("PP-12 gameplay footprints are the art's footprints", () => {
  it("every industry def matches its sprite's manifest footprint", () => {
    for (const key of Object.keys(INDUSTRY_BY_KEY)) {
      const m = manifest.sprites[key];
      expect(m, `manifest is missing industry sprite ${key}`).toBeTruthy();
      expect(INDUSTRY_BY_KEY[key].footprint, key).toEqual(m.footprint);
    }
  });

  it("FACTORY_FOOTPRINT is the factory sprite's manifest footprint", () => {
    const m = manifest.sprites[FACTORY_SPRITE];
    expect(m).toBeTruthy();
    expect(FACTORY_FOOTPRINT).toEqual(m.footprint);
  });

  it("every town variant and the town centre are 1×1 manifest sprites", () => {
    expect(TOWN_HOUSE_VARIANTS.length).toBeGreaterThan(1);
    for (const v of [...TOWN_HOUSE_VARIANTS, "town_center"]) {
      const m = manifest.sprites[v];
      expect(m, `manifest is missing town sprite ${v}`).toBeTruthy();
      expect(m.footprint, v).toEqual([1, 1]);
    }
  });

  it("every cargo has its 1×1 depot outpost sprite", () => {
    const cargos: Cargo[] = ["wood", "stone", "grain", "ore", "oil", "gold"];
    for (const cargo of cargos) {
      const name = depotSpriteForCargo(cargo);
      const m = manifest.sprites[name];
      expect(m, `manifest is missing depot sprite ${name}`).toBeTruthy();
      expect(m.footprint, name).toEqual([1, 1]);
    }
  });
});

describe("PP-12 integration hygiene", () => {
  it("the temporary assets/iso-ttd/ staging dir is gone", () => {
    expect(existsSync("assets/iso-ttd")).toBe(false);
  });

  it("no file cell points outside src/assets/sprites/png", () => {
    for (const c of fileCells) {
      expect(c.file).toMatch(/^[A-Za-z0-9_\-./]+\.png$/);
      expect(c.file).not.toContain("..");
      expect(existsSync(`src/assets/sprites/png/${c.file}`), c.name).toBe(true);
    }
  });
});
