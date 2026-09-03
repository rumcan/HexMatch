import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validateManifest } from "../../tools/validate-manifest.mjs";
import { parsePnml } from "../../tools/parse-pnml.mjs";

const realManifest = JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8")) as {
  sprites: Record<string, { w: number; h: number; footprint: [number, number]; frames?: number; x: number; y: number }>;
};

const cells = JSON.parse(readFileSync("tools/iso-atlas.cells.json", "utf8")) as {
  sprites: {
    name: string; sprite?: number; box?: unknown; crop?: unknown; boxes?: unknown; crops?: unknown;
    generator?: string; footprint?: [number, number];
    layers?: { sprite: number; tint?: [number, number, number] }[];
    frames?: { sprite: number }[][];
    trackset?: { mode: string; base?: number; table?: number[]; ground?: number; pieces?: { sprite: number; dirs: number[] }[] };
  }[];
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

  it("road/rail/crossing resolve from declared sprite ids, not a hand crop or generator", () => {
    // Y4c/Y6: road is OpenGFX's finished flat set indexed through OpenTTD's
    // table, rail is declared ground + declared overlay pieces, crossing is a
    // declared finished tile. None of them may fall back to `generator`.
    const road = cells.sprites.find((c) => c.name === "road");
    const rail = cells.sprites.find((c) => c.name === "rail");
    const crossing = cells.sprites.find((c) => c.name === "crossing");
    expect(road?.trackset?.mode).toBe("flat");
    expect(typeof road?.trackset?.base).toBe("number");
    expect(road?.trackset?.table).toHaveLength(16);
    expect(rail?.trackset?.mode).toBe("overlays");
    expect(typeof rail?.trackset?.ground).toBe("number");
    expect((rail?.trackset?.pieces ?? []).length).toBeGreaterThan(0);
    for (const p of rail?.trackset?.pieces ?? []) expect(typeof p.sprite).toBe("number");
    expect(crossing?.layers?.length).toBeGreaterThan(0);
    for (const s of [road, rail, crossing]) {
      expect(s!.generator, `${s!.name} must not use the generator`).toBeUndefined();
      expect(s!.crop, `${s!.name} must not carry a hand crop`).toBeUndefined();
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

// ── Y3 / Y5 / Y6 — the "did you finish" invariants ────────────────────────
// The backlog's process note: "Set up but not applied" must be a CI failure,
// not a screenshot review. These assert the atlas is fully declaration-driven.
describe("Y3/Y5/Y6 declaration invariants", () => {
  type Decl = { file: string; x: number; y: number; w: number; h: number; xrel: number; yrel: number; flags: string[] };
  const decls = parsePnml() as unknown as Record<string, Decl>;

  /** Every declared id a cell references (layers, frames, trackset, sprite). */
  function referencedIds(s: (typeof cells)["sprites"][number]): number[] {
    const out: number[] = [];
    if (typeof s.sprite === "number") out.push(s.sprite);
    for (const l of s.layers ?? []) out.push(l.sprite);
    for (const f of s.frames ?? []) for (const l of f) out.push(l.sprite);
    if (s.trackset) {
      if (typeof s.trackset.base === "number") {
        for (const off of s.trackset.table ?? []) out.push(s.trackset.base + off);
      }
      if (typeof s.trackset.ground === "number") out.push(s.trackset.ground);
      for (const p of s.trackset.pieces ?? []) out.push(p.sprite);
    }
    return out;
  }

  it("Y6: no compose/box/crop/tiles arrays remain in the cells file", () => {
    const raw = readFileSync("tools/iso-atlas.cells.json", "utf8");
    const parsed = JSON.parse(raw);
    for (const s of parsed.sprites) {
      for (const forbidden of ["compose", "box", "boxes", "crop", "crops", "tiles", "anchor"]) {
        expect(s[forbidden], `cell ${s.name} still carries \`${forbidden}\``).toBeUndefined();
      }
    }
    expect(raw).not.toContain("\"compose\"");
    expect(raw).not.toContain("\"crop\"");
  });

  it("Y6: every atlas sprite resolves to declared OpenGFX ids (no compose)", () => {
    for (const s of cells.sprites) {
      if (s.generator === "highlight" || s.generator === "highlight_soft") continue; // procedural UI glow
      const ids = referencedIds(s);
      expect(ids.length, `cell ${s.name} references no declared sprite`).toBeGreaterThan(0);
      for (const id of ids) {
        expect(decls[String(id)], `cell ${s.name}: declared sprite ${id} missing`).toBeTruthy();
      }
    }
  });

  it("Y6: no road/rail cell references the generator", () => {
    for (const s of cells.sprites) {
      if (/^(road|rail)/.test(s.name)) {
        expect(s.generator, `cell ${s.name} must not use the generator`).toBeUndefined();
      }
    }
    // and the slicer source no longer carries the generator's road/rail branch
    const slicer = readFileSync("tools/slice-atlas.mjs", "utf8");
    expect(slicer).not.toContain("clipArm");
    expect(slicer).not.toContain("TRACK_HALF_W");
    expect(slicer).not.toContain("makeGenerated(s, \"road\")");
  });

  it("Y6: sprite width stays within footprint_w * 64 + 32", () => {
    for (const [name, s] of Object.entries(realManifest.sprites)) {
      const frames = s.frames ?? 1;
      expect(s.w / frames, `${name} frame width`).toBeLessThanOrEqual(s.footprint[0] * 64 + 32);
    }
  });

  it("Y5: every manifest anchor is the declared-xrel/yrel derivation, never hand-authored", () => {
    // anchor = (-minX + 1, -minY + 31) where (minX,minY) is the union of the
    // declared layers' (xrel,yrel) rects — recomputed here from the PNML
    // declarations so a hand-tuned anchor can never slip back in.
    const unionOf = (s: (typeof cells)["sprites"][number]) => {
      let minX = Infinity, minY = Infinity;
      const consider = (id: number) => {
        const d = decls[String(id)];
        minX = Math.min(minX, d.xrel);
        minY = Math.min(minY, d.yrel);
      };
      if (typeof s.sprite === "number") consider(s.sprite);
      for (const l of s.layers ?? []) consider(l.sprite);
      for (const f of s.frames ?? []) for (const l of f) consider(l.sprite);
      return [minX, minY];
    };
    for (const s of cells.sprites) {
      if (s.generator) continue;
      if (s.trackset?.mode === "flat") continue; // per-mask union; covered below
      const [minX, minY] = unionOf(s);
      if (!Number.isFinite(minX)) continue;
      const names = s.trackset?.mode === "overlays"
        ? [...Array(16).keys()].map((v) => `${s.namePrefix}_${v.toString(2).padStart(4, "0")}`)
        : [s.name];
      for (const n of names) {
        const m = realManifest.sprites[n];
        expect(m, n).toBeTruthy();
        expect(m.anchor, `${n} anchor must be the declared derivation`).toEqual([-minX + 1, -minY + 31]);
      }
    }
  });

  it("Y5: declared sprites honour NOCROP (declared rect trusted verbatim)", () => {
    // The slicer must size each cell from the declared w/h, not from a measured
    // content bbox. Assert the union rect of a known multi-layer cell matches
    // the manifest size exactly.
    const ore = cells.sprites.find((s) => s.name === "ore_mine")!;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const l of ore.layers!) {
      const d = decls[String(l.sprite)];
      minX = Math.min(minX, d.xrel); maxX = Math.max(maxX, d.xrel + d.w - 1);
      minY = Math.min(minY, d.yrel); maxY = Math.max(maxY, d.yrel + d.h - 1);
    }
    const m = realManifest.sprites.ore_mine;
    expect([m.w, m.h]).toEqual([maxX - minX + 1, maxY - minY + 1 + 1]); // +1 cloned ground row
  });
});
