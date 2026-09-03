import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePnml } from "../../tools/parse-pnml.mjs";

/**
 * Y1 acceptance: the parser is unit-tested against three known declarations,
 * including one templated one, in an isolated fixture tree so this test
 * never depends on the size or contents of the full restored OpenGFX set.
 */
function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "pnml-fixture-"));
  mkdirSync(join(root, "base"));
  mkdirSync(join(root, "templates"));
  writeFileSync(
    join(root, "templates", "sprite_templates.pnml"),
    `
    template tmpl_groundtiles(x, y) {
        [   0+x,   y, 64, 31, -31,  0 ]
        [  80+x,   y, 64, 31, -31,  0 ]
        [ 160+x,   y, 64, 23, -31,  0 ]
    }
    template tmpl_rough(x, y) {
        tmpl_level_ground(    x, y)
        tmpl_level_ground( 80+x, y)
    }
    template tmpl_level_ground(x, y) {
        [ x, y, 64, 31, -31, 0 ]
    }
    template tmpl_additional_rough(x, y) {
        tmpl_rough(1510+x, y)
    }
    `,
  );
  writeFileSync(
    join(root, "base", "base-0001-fixture.pnml"),
    `
    // direct declaration — a single [x,y,w,h,xrel,yrel] rect
    base_graphics spr1332(1332, "sprites/png/infrastructure/infra06.png") { [ 434, 2568, 64, 31, -31, 0] }

    // direct declaration with a flag
    base_graphics spr2011(2011, "sprites/png/industries/coalmine_base.gimp.png") { [ 66, 8, 37, 26, -17, -8] }

    // templated declaration — expands to 3 sprite ids from one template call
    base_graphics spr3981(3981, "sprites/png/terrain/grass-temperate.gimp.png") { tmpl_groundtiles(1, 1) }

    // nested template-calling-template declaration
    base_graphics spr4000(4000, "sprites/png/terrain/rough-temperate.png") { tmpl_groundtiles(1, 1) tmpl_additional_rough(1, 1) }
    `,
  );
  return root;
}

describe("Y1 pnml parser", () => {
  const root = makeFixture();
  const sprites = parsePnml(root);

  it("parses a direct [x,y,w,h,xrel,yrel] declaration", () => {
    expect(sprites[1332]).toEqual({
      file: "sprites/png/infrastructure/infra06.png",
      x: 434, y: 2568, w: 64, h: 31, xrel: -31, yrel: 0, flags: [],
    });
  });

  it("parses a direct declaration with negative offsets on both axes", () => {
    expect(sprites[2011]).toEqual({
      file: "sprites/png/industries/coalmine_base.gimp.png",
      x: 66, y: 8, w: 37, h: 26, xrel: -17, yrel: -8, flags: [],
    });
  });

  it("expands a templated declaration into consecutive sprite ids", () => {
    expect(sprites[3981]).toEqual({
      file: "sprites/png/terrain/grass-temperate.gimp.png",
      x: 1, y: 1, w: 64, h: 31, xrel: -31, yrel: 0, flags: [],
    });
    expect(sprites[3982]).toEqual({
      file: "sprites/png/terrain/grass-temperate.gimp.png",
      x: 81, y: 1, w: 64, h: 31, xrel: -31, yrel: 0, flags: [],
    });
    expect(sprites[3983]).toEqual({
      file: "sprites/png/terrain/grass-temperate.gimp.png",
      x: 161, y: 1, w: 64, h: 23, xrel: -31, yrel: 0, flags: [],
    });
  });

  it("expands a template that itself calls other templates with arithmetic args", () => {
    // tmpl_groundtiles(1,1) -> 3 sprites (4000,4001,4002), then
    // tmpl_additional_rough(1,1) -> tmpl_rough(1511,1) -> 2 more sprites (4003,4004)
    expect(sprites[4003]).toEqual({
      file: "sprites/png/terrain/rough-temperate.png",
      x: 1511, y: 1, w: 64, h: 31, xrel: -31, yrel: 0, flags: [],
    });
    expect(sprites[4004]).toEqual({
      file: "sprites/png/terrain/rough-temperate.png",
      x: 1591, y: 1, w: 64, h: 31, xrel: -31, yrel: 0, flags: [],
    });
  });

  it("every parsed sprite has the expected shape", () => {
    for (const s of Object.values(sprites) as any[]) {
      expect(typeof s.file).toBe("string");
      expect(typeof s.x).toBe("number");
      expect(typeof s.y).toBe("number");
      expect(typeof s.w).toBe("number");
      expect(typeof s.h).toBe("number");
      expect(typeof s.xrel).toBe("number");
      expect(typeof s.yrel).toBe("number");
      expect(Array.isArray(s.flags)).toBe(true);
    }
  });
});

describe("Y1 pnml parser against the real restored OpenGFX declarations", () => {
  const sprites = parsePnml();

  it("parses more than 1900 sprites (R9 restoration was for real)", () => {
    expect(Object.keys(sprites).length).toBeGreaterThan(1900);
  });

  it("flat temperate grass (3981) is 64x31 with yrel 0 — not a slope", () => {
    expect(sprites[3981]).toMatchObject({ w: 64, h: 31, yrel: 0 });
  });

  it("the road half-piece (1332) matches the documented box", () => {
    expect(sprites[1332]).toMatchObject({ x: 434, y: 2568, w: 64, h: 31, xrel: -31, yrel: 0 });
  });

  it("the coal hoist animation frames (2013/2014/2015) share one box across three files", () => {
    for (const id of [2013, 2014, 2015]) {
      expect(sprites[id]).toMatchObject({ x: 162, y: 8, w: 58, h: 50, xrel: -16, yrel: -33 });
    }
    expect(sprites[2013].file).not.toBe(sprites[2014].file);
    expect(sprites[2014].file).not.toBe(sprites[2015].file);
  });
});
