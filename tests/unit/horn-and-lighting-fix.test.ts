// Owner complaints (2026-09-27): a honk every few seconds, and a time-of-day
// filter that "does not work at all". Guards for both fixes.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { effectiveLighting, lightingFor, lumaOf } from "../../src/iso/lighting";

const game = readFileSync("src/iso/game.ts", "utf8");

describe("lorry deliveries are silent", () => {
  it("no truck-horn plays anywhere in the game loop", () => {
    expect(game).not.toMatch(/sfx\.play\(\s*["']truck-horn["']/);
  });

  it("the train whistle is a rare accent, not a metronome", () => {
    const cues = readFileSync("src/audio/cues.ts", "utf8");
    const gap = Number(cues.split('"train-whistle": {')[1].match(/gap:\s*([\d_]+)/)![1].replace(/_/g, ""));
    expect(gap).toBeGreaterThanOrEqual(60_000);
  });
});

describe("lighting grade is actually applied", () => {
  it("a non-zero stage produces a visibly non-white grade, even with reduced motion", () => {
    for (const reducedMotion of [false, true]) {
      const L = effectiveLighting({ choice: "dynamic", progress: 0.6, reducedMotion });
      expect(L.identity).toBe(false);
      // Blue channel pulled well down: a clearly warm golden hour.
      expect(L.grade[2]).toBeLessThan(0.65);
    }
  });

  it("the first third of the match already moves the light", () => {
    const start = lightingFor(0);
    const third = lightingFor(0.3);
    expect(start.grade[2]).toBeLessThan(0.9);
    expect(start.grade[2] - third.grade[2]).toBeGreaterThan(0.1);
    expect(lumaOf(third.grade)).toBeGreaterThan(0.8);
  });

  it("the frame pushes the grade to the terrain shader and the 2D renderer", () => {
    const push = game.split("const pushMatchLighting")[1].split("};")[0];
    expect(push).toContain("terrainGl?.setGrade(");
    expect(push).toContain("renderer?.setLighting(L)");
    expect(game).toMatch(/pushMatchLighting\(dt\);\s*\n\s*terrainGl\?\.render\(/);
    const terrain = readFileSync("src/iso/terrain-gl/index.ts", "utf8");
    const render = terrain.split("render(cam: TerrainCamera, timeMs: number): void {")[1].split("drawElements")[0];
    expect(render).toContain("gl.uniform4f(st.u.uGrade");
    expect(render).toContain("gl.uniform3f(st.u.uLight");
  });
});
