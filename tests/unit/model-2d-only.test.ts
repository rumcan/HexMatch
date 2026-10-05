// Owner playtest 2026-10-05: badly generated models draw as their 2D sprite in the 3D layer.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MODEL_2D_ONLY, modelOf } from "../../src/iso/three-layer";

const mf = JSON.parse(readFileSync("public/models/manifest.json", "utf8"));

describe("MODEL_2D_ONLY", () => {
  it("keeps the listed models (and their mirrors) out of the 3D layer", () => {
    for (const name of MODEL_2D_ONLY) {
      expect(mf[name], `${name} has a model to skip`).toBeTruthy();
      expect(modelOf(name, mf), name).toBeNull();
      expect(modelOf(`${name}_r`, mf), `${name}_r`).toBeNull();
    }
  });
  it("leaves every other building its model", () => {
    expect(modelOf("town_bank", mf)).not.toBeNull();
    expect(modelOf("town_cinema", mf)).not.toBeNull();
  });
});
