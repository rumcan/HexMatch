// ══════════════════════════════════════════════════════════════════════════
// TRAFFIC-01 — which image each sprite blits from once the W-series layer
// sheets are loaded (src/iso/atlas.ts `layerOfSprite` / `imageForSprite`).
//
// The ambient cars were invisible in the live game: their cells were cut into
// the monolithic atlas after assets/layers/ was last built, the buildings
// layer holds only transparent pixels at their rects, and every non-road
// sprite was routed to that layer. Pinned here: cars blit from the monolith,
// while roads and buildings keep their layer sheets.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Atlas, type Manifest } from "../../src/iso/atlas";
import { carSprite } from "../../src/iso/cars";
import { NE, SE, SW, NW } from "../../src/iso/track";

const manifest: Manifest = JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8"));

/** An atlas with the monolith AND both layer sheets loaded, told apart by tag. */
function loadedAtlas() {
  const atlas = new Atlas(manifest);
  const img = (tag: string) => ({ tag } as never);
  for (const z of [0.5, 1, 2]) atlas.images.set(z, img(`monolith@${z}`));
  atlas.layerImages.set("roads", new Map([0.5, 1, 2].map((z) => [z, img(`roads@${z}`)])));
  atlas.layerImages.set("buildings", new Map([0.5, 1, 2].map((z) => [z, img(`buildings@${z}`)])));
  return atlas;
}

const tagOf = (i: unknown) => (i as { tag?: string } | undefined)?.tag;

describe("TRAFFIC-01 car sprites blit from the monolithic atlas", () => {
  it("every shipped car cell exists in the manifest and skips the layer sheets", () => {
    const atlas = loadedAtlas();
    for (let car = 1; car <= 3; car++) {
      for (const dir of [NE, SE, SW, NW]) {
        const name = carSprite(car, dir);
        expect(atlas.get(name), `${name} in manifest`).toBeTruthy();
        expect(atlas.layerOfSprite(name), name).toBeNull();
        for (const z of [0.5, 1, 2]) expect(tagOf(atlas.imageForSprite(name, z)), `${name}@${z}`).toBe(`monolith@${z}`);
      }
    }
  });

  it("roads and buildings still blit from their own layer sheets", () => {
    const atlas = loadedAtlas();
    const road = Object.keys(manifest.sprites).find((n) => /^road_/.test(n))!;
    const building = Object.keys(manifest.sprites).find((n) => /^(?!road_|dirt_|terrain_|car\d)/.test(n))!;
    expect(atlas.layerOfSprite(road)).toBe("roads");
    expect(tagOf(atlas.imageForSprite(road, 1))).toBe("roads@1");
    expect(atlas.layerOfSprite(building)).toBe("buildings");
    expect(tagOf(atlas.imageForSprite(building, 1))).toBe("buildings@1");
  });
});
