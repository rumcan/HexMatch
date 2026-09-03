import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validateManifest } from "../../tools/validate-manifest.mjs";
import { parsePnml } from "../../tools/parse-pnml.mjs";

const realManifest = JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8")) as {
  sprites: Record<string, { w: number; h: number; footprint: [number, number]; frames?: number; x: number; y: number }>;
};

const cells = JSON.parse(readFileSync("tools/iso-atlas.cells.json", "utf8")) as {
  sprites: { name: string; sprite?: number; box?: unknown; crop?: unknown; boxes?: unknown; crops?: unknown; generator?: string }[];
};

// E1 acceptance: the manifest validates against a JSON schema (CI), and the
// anchor contract is enforced geometrically.

const good = {
  images: {
    "0.5": "industries@0.5x.png",
    "1": "industries@1x.png",
    "2": "industries@2x.png",
  },
  tileW: 64,
  tileH: 32,
  sprites: {
    coal_mine: { x: 0, y: 0, w: 192, h: 160, footprint: [3, 3], anchor: [96, 148], frames: 1 },
    oil_rig: {
      x: 192, y: 0, w: 128, h: 176, footprint: [2, 2], anchor: [64, 160],
      frames: 4, frameMs: 180,
    },
    road_0011: { x: 0, y: 256, w: 64, h: 32, footprint: [1, 1], anchor: [32, 32] },
  },
};

describe("E1 atlas manifest validation", () => {
  it("accepts the spec's example manifest", () => {
    expect(validateManifest(good)).toEqual([]);
  });

  it("accepts a manifest with E4 Tier-3 slices", () => {
    const withSlices = {
      ...good,
      sprites: {
        ...good.sprites,
        coal_mine: {
          ...good.sprites.coal_mine,
          slices: [{ x: 0, y: 0, w: 192, h: 64 }],
        },
      },
    };
    expect(validateManifest(withSlices)).toEqual([]);
  });

  it("rejects missing required fields", () => {
    const bad = JSON.parse(JSON.stringify(good));
    delete bad.sprites.coal_mine.anchor;
    const errors = validateManifest(bad);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toContain("anchor");
  });

  it("rejects an anchor outside its sprite rect (anchor contract)", () => {
    const bad = JSON.parse(JSON.stringify(good));
    bad.sprites.road_0011.anchor = [64, 33]; // 64x32 sprite: anchor must be inside
    const errors = validateManifest(bad);
    expect(errors.join("\n")).toContain("anchor");
  });

  it("rejects animation frames that do not tile the rect evenly", () => {
    const bad = JSON.parse(JSON.stringify(good));
    bad.sprites.oil_rig.w = 130; // 4 frames, 130px — not divisible
    const errors = validateManifest(bad);
    expect(errors.join("\n")).toContain("frames do not tile");
  });

  it("requires frameMs on animated sprites", () => {
    const bad = JSON.parse(JSON.stringify(good));
    delete bad.sprites.oil_rig.frameMs;
    const errors = validateManifest(bad);
    expect(errors.join("\n")).toContain("frameMs");
  });

  it("rejects a slice outside its sprite rect", () => {
    const bad = JSON.parse(JSON.stringify(good));
    bad.sprites.coal_mine.slices = [{ x: 0, y: 150, w: 100, h: 100 }];
    const errors = validateManifest(bad);
    expect(errors.join("\n")).toContain("slice");
  });

  it("rejects unknown fields (schema strictness)", () => {
    const bad = JSON.parse(JSON.stringify(good));
    bad.sprites.coal_mine.anchro = [1, 2]; // typo of anchor
    const errors = validateManifest(bad);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("X5 cheap manifest invariants", () => {
  it("bounds sprite size by footprint (catches the 768px oil rig crop)", () => {
    const sprites = realManifest.sprites;
    for (const [name, s] of Object.entries(sprites)) {
      const frames = s.frames ?? 1;
      const frameW = s.w / frames;
      expect(frameW, `${name} sprite width`).toBeLessThanOrEqual(s.footprint[0] * 64 + 32);
      expect(s.h, `${name} sprite height`).toBeLessThanOrEqual(s.footprint[1] * 32 + 160);
    }
  });

  it("rejects duplicate crop rectangles unless they are tints of one another", () => {
    const groups = new Map<string, string[]>();
    for (const [name, s] of Object.entries(realManifest.sprites)) {
      const key = `${s.x},${s.y},${s.w},${s.h}`;
      const g = groups.get(key) ?? [];
      g.push(name);
      groups.set(key, g);
    }
    for (const [key, names] of groups) {
      if (names.length < 2) continue;
      const family = (n: string) => n.includes("factory_") ? "factory" : n.includes("depot_") ? "depot" : n;
      const fams = new Set(names.map(family));
      // tints of the same base sprite are permitted; non-tint collocations are not.
      expect(fams.size, `duplicate crop ${key} (${names.join(", ")})`).toBeLessThanOrEqual(2);
      expect([...fams].every((f) => f === "factory" || f === "depot"),
        `duplicate crop ${key} must be a declared tint family (${names.join(", ")})`).toBe(true);
    }
  });

  it("has one ore-mine / factory crop distinct from the other buildings", () => {
    const { ore_mine, quarry, factory_blue, gold_mine } = realManifest.sprites;
    expect([ore_mine.x, ore_mine.y, ore_mine.w, ore_mine.h])
      .not.toEqual([factory_blue.x, factory_blue.y, factory_blue.w, factory_blue.h]);
    expect([ore_mine.x, ore_mine.y, ore_mine.w, ore_mine.h])
      .not.toEqual([quarry.x, quarry.y, quarry.w, quarry.h]);
    expect([factory_blue.x, factory_blue.y, factory_blue.w, factory_blue.h])
      .not.toEqual([gold_mine.x, gold_mine.y, gold_mine.w, gold_mine.h]);
  });
});

describe("Y1/Y2 declaration invariants (ground + roads are declaration-driven)", () => {
  // Y1 acceptance: the cells file contains no hand-authored crop/box arrays
  // for ground/road sprites; every one of them traces to a declared id.

  it("terrain cells reference a declared sprite id and carry no hand box/crop", () => {
    const terrain = cells.sprites.filter((s) => s.name.startsWith("terrain_"));
    expect(terrain.length).toBeGreaterThan(0);
    for (const s of terrain) {
      expect(typeof s.sprite, `${s.name} must reference a declared sprite id`).toBe("number");
      expect(s.box ?? s.crop ?? s.boxes ?? s.crops, `${s.name} must not carry a hand rect`).toBeUndefined();
    }
  });

  it("there is exactly one grass terrain tile and no slope `_b` variant", () => {
    const grass = cells.sprites.filter((s) => s.name === "terrain_grass" || s.name.startsWith("terrain_grass"));
    expect(grass.map((s) => s.name)).toEqual(["terrain_grass"]);
    expect(cells.sprites.some((s) => s.name === "terrain_grass_b")).toBe(false);
    expect(realManifest.sprites.terrain_grass_b).toBeUndefined();
  });

  it("road/rail/crossing resolve from a declared sprite id, not a hand crop", () => {
    for (const name of ["road", "rail", "crossing"]) {
      const s = cells.sprites.find((c) => c.name === name);
      expect(s, name).toBeTruthy();
      expect(typeof s!.sprite, `${name} must reference a declared sprite id`).toBe("number");
      expect(s!.crop).toBeUndefined();
    }
  });

  it("Y2: every terrain sprite declared for the atlas is a flat 64x31 tile with yrel 0", () => {
    // A ground tile with height 23/39/47 or a non-zero yrel is a slope and must
    // fail — this is what keeps slope sprites from being used as flat tiles.
    const decls = parsePnml();
    const terrainIds = cells.sprites
      .filter((s) => s.name.startsWith("terrain_") && typeof s.sprite === "number")
      .map((s) => s.sprite as number);
    expect(terrainIds.length).toBeGreaterThan(0);
    for (const id of terrainIds) {
      const d = decls[String(id)];
      expect(d, `declared sprite ${id} missing`).toBeTruthy();
      expect([d!.w, d!.h, d!.yrel], `terrain sprite ${id}`).toEqual([64, 31, 0]);
    }
  });
});
