import { describe, it, expect } from "vitest";
import { validateManifest } from "../../tools/validate-manifest.mjs";

// E1 acceptance: the manifest validates against a JSON schema (CI), and the
// anchor contract is enforced geometrically.

const good = {
  image: "industries@1x.png",
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
