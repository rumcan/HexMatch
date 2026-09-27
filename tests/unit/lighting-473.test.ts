// LIGHT-1 (#473) — the match-time lighting arc is a pure function of progress.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { TERRAIN_FS } from "../../src/iso/terrain-gl/shaders";
import {
  DAY_LIGHTING, DEFAULT_LIGHTING_CHOICE, ENDING_NIGHT_CLASS, LIGHTING_STORAGE_KEY,
  MIN_GRADE_LUMA, STAGE_PROGRESS,
  currentLightingChoice, effectiveLighting, endingNightActive, isLitBuilding,
  leaderProgress, lightingFor, lumaOf, parseLightingChoice, parseLightingSettings,
  resetLightingForTests, setLightingChoice, smoothMatchProgress, stageFor,
  subscribeLighting, urlLightingOverride, urlLightingProgress, windowMaskPixels,
} from "../../src/iso/lighting";

const STEPS = 201;

function samples(): ReturnType<typeof lightingFor>[] {
  const out = [];
  for (let i = 0; i < STEPS; i++) out.push(lightingFor(i / (STEPS - 1)));
  return out;
}

describe("lightingFor", () => {
  it("clamps progress and every channel", () => {
    expect(lightingFor(-4).progress).toBe(0);
    expect(lightingFor(3).progress).toBe(1);
    expect(lightingFor(Number.NaN).progress).toBe(0);
    expect(lightingFor(Number.POSITIVE_INFINITY).progress).toBe(0);
    for (const L of [lightingFor(-1), lightingFor(0.6), lightingFor(2), ...samples()]) {
      expect(L.progress).toBeGreaterThanOrEqual(0);
      expect(L.progress).toBeLessThanOrEqual(1);
      expect(L.sunDrop).toBeGreaterThanOrEqual(0);
      expect(L.sunDrop).toBeLessThanOrEqual(1);
      expect(L.exposure).toBeGreaterThan(0);
      expect(L.exposure).toBeLessThanOrEqual(1);
      expect(L.windows).toBeGreaterThanOrEqual(0);
      expect(L.windows).toBeLessThanOrEqual(1);
      expect(L.shadowScale).toBeGreaterThanOrEqual(1);
      expect(L.shadowAlpha).toBeGreaterThan(0);
      expect(L.shadowAlpha).toBeLessThanOrEqual(0.42);
      expect(L.shadowDx).toBeGreaterThan(0);
      expect(L.shadowDx).toBeLessThanOrEqual(280);
      expect(L.shadowDy).toBeGreaterThan(0);
      expect(L.shadowDy).toBeLessThanOrEqual(280);
      for (const c of [...L.tint, ...L.grade]) {
        expect(c).toBeGreaterThan(0);
        expect(c).toBeLessThanOrEqual(1);
      }
      expect(lumaOf(L.grade)).toBeGreaterThanOrEqual(MIN_GRADE_LUMA - 1e-9);
      const len = Math.hypot(L.light[0], L.light[1], L.light[2]);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it("is monotonic: the sun only falls, the windows only come on", () => {
    const xs = samples();
    for (let i = 1; i < xs.length; i++) {
      const a = xs[i - 1];
      const b = xs[i];
      expect(b.sunDrop).toBeGreaterThanOrEqual(a.sunDrop - 1e-9);
      expect(b.sunElev).toBeLessThanOrEqual(a.sunElev + 1e-9);
      expect(b.exposure).toBeLessThanOrEqual(a.exposure + 1e-9);
      expect(b.windows).toBeGreaterThanOrEqual(a.windows - 1e-9);
      expect(b.shadowScale).toBeGreaterThanOrEqual(a.shadowScale - 1e-9);
      expect(b.shadowAlpha).toBeGreaterThanOrEqual(a.shadowAlpha - 1e-9);
      expect(b.shadowDx).toBeGreaterThanOrEqual(a.shadowDx - 1e-6);
      expect(b.shadowDy).toBeGreaterThanOrEqual(a.shadowDy - 1e-6);
      // Warming: the cool channel does not come back as the match advances.
      expect(b.tint[2]).toBeLessThanOrEqual(a.tint[2] + 1e-9);
      expect(b.light[0]).toBeLessThan(0);
      expect(b.light[1]).toBeLessThan(0);
      expect(b.light[2]).toBeGreaterThan(0);
    }
  });

  it("moves smoothly — no step bigger than a felt fade", () => {
    const xs = samples();
    for (let i = 1; i < xs.length; i++) {
      expect(Math.abs(xs[i].sunDrop - xs[i - 1].sunDrop)).toBeLessThan(0.02);
      expect(Math.abs(xs[i].exposure - xs[i - 1].exposure)).toBeLessThan(0.01);
      expect(Math.abs(xs[i].windows - xs[i - 1].windows)).toBeLessThan(0.03);
    }
  });

  it("hits late morning, golden hour at 60%, and dusk in the final stretch", () => {
    const morning = lightingFor(STAGE_PROGRESS.morning);
    const golden = lightingFor(STAGE_PROGRESS.golden);
    const dusk = lightingFor(STAGE_PROGRESS.dusk);
    const finale = lightingFor(STAGE_PROGRESS.finale);
    expect(morning.stage).toBe("morning");
    expect(golden.stage).toBe("golden");
    expect(stageFor(0.6)).toBe("golden");
    expect(dusk.stage).toBe("dusk");
    expect(finale.stage).toBe("dusk");
    expect(golden.progress).toBeCloseTo(0.6, 5);
    // Golden is the warm turn: cooler than morning was, warmer than white.
    expect(golden.tint[2]).toBeLessThan(morning.tint[2] - 0.2);
    expect(golden.tint[0]).toBeGreaterThan(0.95);
    // Dusk is later and lower, and the windows are on.
    expect(dusk.sunDrop).toBeGreaterThan(golden.sunDrop);
    expect(dusk.windows).toBeGreaterThan(0.7);
    expect(finale.windows).toBe(1);
    expect(morning.windows).toBe(0);
    // The sun stays upper-left the whole way, just lower.
    expect(finale.light[2]).toBeLessThan(morning.light[2] - 0.2);
    expect(finale.light[0]).toBeLessThan(morning.light[0]);
  });

  it("always-day is the identity grade and is what the gates select", () => {
    expect(DAY_LIGHTING.identity).toBe(true);
    expect(DAY_LIGHTING.grade).toEqual([1, 1, 1]);
    expect(DAY_LIGHTING.windows).toBe(0);
    expect(effectiveLighting({ choice: "day", progress: 0.9 }).identity).toBe(true);
    expect(effectiveLighting({ choice: "dynamic", progress: 0.9, performance: true }).identity).toBe(true);
    expect(effectiveLighting({ choice: "dynamic", progress: 0.9, reducedMotion: true }).identity).toBe(true);
    const live = effectiveLighting({ choice: "dynamic", progress: 0.6 });
    expect(live.identity).toBe(false);
    expect(live.stage).toBe("golden");
  });
});

describe("leader progress and the ease", () => {
  it("uses the leader, and a missing line stays at morning", () => {
    expect(leaderProgress([2, 7, 4], 10)).toBeCloseTo(0.7);
    expect(leaderProgress([0, 0], 10)).toBe(0);
    expect(leaderProgress([12], 0)).toBe(0);
    expect(leaderProgress([3], -1)).toBe(0);
  });

  it("eases toward the score and does not overshoot", () => {
    let shown = 0;
    for (let i = 0; i < 40; i++) {
      const next = smoothMatchProgress(shown, 0.6, 100);
      expect(next).toBeGreaterThan(shown);
      expect(next).toBeLessThanOrEqual(0.6);
      shown = next;
    }
    expect(shown).toBeGreaterThan(0.2);
    expect(smoothMatchProgress(0.4, 0.4, 16)).toBe(0.4);
    expect(smoothMatchProgress(0.5, -1, 16)).toBeLessThan(0.5);
    expect(smoothMatchProgress(2, 2, 16)).toBe(1);
  });
});

describe("window masks", () => {
  it("lights a dark upper hole and ignores the bright wall and the ground floor", () => {
    const w = 8;
    const h = 8;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        src[i] = src[i + 1] = src[i + 2] = 210;
        src[i + 3] = 255;
      }
    }
    // A dark window in the upper half, framed by the bright wall.
    const hole = (2 * w + 3) * 4;
    src[hole] = src[hole + 1] = src[hole + 2] = 40;
    const mask = windowMaskPixels(src, w, h);
    expect(mask[hole + 3]).toBeGreaterThan(40);
    expect(mask[hole]).toBe(255);
    expect(mask[hole + 1]).toBeGreaterThan(140);
    // Bright wall: no glow.
    expect(mask[(1 * w + 1) * 4 + 3]).toBe(0);
    // Below the upper band: no glow, even if we punch a hole there.
    const low = (6 * w + 3) * 4;
    src[low] = src[low + 1] = src[low + 2] = 40;
    const mask2 = windowMaskPixels(src, w, h);
    expect(mask2[low + 3]).toBe(0);
  });

  it("treats depots and houses as buildings, and skips roads, trees and traffic", () => {
    expect(isLitBuilding("town_house_pool")).toBe(true);
    expect(isLitBuilding("truck_depot")).toBe(true);
    expect(isLitBuilding("factory")).toBe(true);
    expect(isLitBuilding("road_0011")).toBe(false);
    expect(isLitBuilding("dirt_0101")).toBe(false);
    expect(isLitBuilding("rail_ne")).toBe(false);
    expect(isLitBuilding("tree_oak_a", true)).toBe(false);
    expect(isLitBuilding("truck_blue_se", false, true)).toBe(false);
  });
});

describe("Lighting setting", () => {
  afterEach(() => {
    resetLightingForTests();
    delete (globalThis as Record<string, unknown>).localStorage;
    delete (globalThis as Record<string, unknown>).location;
  });

  it("defaults to dynamic and remembers always-day", () => {
    expect(DEFAULT_LIGHTING_CHOICE).toBe("dynamic");
    expect(parseLightingChoice("day")).toBe("day");
    expect(parseLightingChoice("always")).toBe("day");
    expect(parseLightingChoice("dynamic")).toBe("dynamic");
    expect(parseLightingChoice("maybe")).toBeNull();
    expect(parseLightingSettings(null, null)).toBe("dynamic");
    expect(parseLightingSettings(JSON.stringify({ choice: "day" }), null)).toBe("day");
    expect(parseLightingSettings("nope", null)).toBe("dynamic");
    expect(parseLightingSettings(JSON.stringify({ choice: "day" }), "dynamic")).toBe("dynamic");
    expect(urlLightingOverride("?lighting=day")).toBe("day");
    expect(urlLightingOverride("?lighting=0")).toBe("day");
    expect(urlLightingOverride("?lighting=dynamic")).toBe("dynamic");
    expect(urlLightingOverride("?lighting=maybe")).toBeNull();
    expect(urlLightingOverride(undefined)).toBeNull();
    expect(urlLightingProgress("?light=0.6")).toBeCloseTo(0.6);
    expect(urlLightingProgress("?light=0")).toBe(0);
    expect(urlLightingProgress("?light=nope")).toBeNull();
    expect(urlLightingProgress(undefined)).toBeNull();
  });

  it("persists, notifies only on change, and a URL flag is not written back", () => {
    const data = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
      setItem: (k: string, v: string) => { data.set(k, String(v)); },
      removeItem: (k: string) => { data.delete(k); },
    };
    (globalThis as Record<string, unknown>).location = { search: "" };
    resetLightingForTests();
    const seen: string[] = [];
    const unsub = subscribeLighting((c) => { seen.push(c); });
    expect(currentLightingChoice()).toBe("dynamic");
    setLightingChoice("day");
    expect(seen).toEqual(["day"]);
    expect(JSON.parse(data.get(LIGHTING_STORAGE_KEY)!).choice).toBe("day");
    setLightingChoice("day");
    expect(seen).toEqual(["day"]);
    unsub();
    setLightingChoice("dynamic");
    expect(seen).toEqual(["day"]);
    resetLightingForTests();
    expect(currentLightingChoice()).toBe("dynamic");

    data.clear();
    (globalThis as Record<string, unknown>).location = { search: "?lighting=day" };
    resetLightingForTests();
    expect(currentLightingChoice()).toBe("day");
    expect(data.has(LIGHTING_STORAGE_KEY)).toBe(false);
    expect(endingNightActive({ performance: false, reducedMotion: false })).toBe(false);
    setLightingChoice("dynamic");
    resetLightingForTests();
    (globalThis as Record<string, unknown>).location = { search: "" };
    // the URL was not written, so a reload without the flag is dynamic again
    // only if we didn't persist. setLightingChoice above DID persist.
    expect(currentLightingChoice()).toBe("dynamic");
  });

  it("night blue is the ending card, and only while dynamic lighting is live", () => {
    (globalThis as Record<string, unknown>).location = { search: "" };
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
    resetLightingForTests();
    expect(endingNightActive({ performance: false, reducedMotion: false })).toBe(true);
    expect(endingNightActive({ performance: true, reducedMotion: false })).toBe(false);
    expect(endingNightActive({ performance: false, reducedMotion: true })).toBe(false);
    setLightingChoice("day");
    expect(endingNightActive({ performance: false, reducedMotion: false })).toBe(false);
    expect(ENDING_NIGHT_CLASS).toBe("lighting-night");
  });
});

describe("terrain grade uniform", () => {
  it("the fragment shader grades the composite and keeps the water markers", () => {
    expect(TERRAIN_FS).toContain("uniform vec4  uGrade");
    expect(TERRAIN_FS).toContain("uniform vec3  uLight");
    expect(TERRAIN_FS).toContain("uniform float uSun");
    expect(TERRAIN_FS).toContain("baseL * 0.62");
    const water = TERRAIN_FS.split("// 4. Water")[1].split("// 5. Composite")[0];
    expect(water).toContain("if (dShore < 0.9)");
    expect(water).toContain("textureGrad(uWaterN");
    expect(water).not.toContain("clamp(-dShore, 0.0, 8.0)");
  });

  it("styles the ending card night blue without touching the card text colour", () => {
    const css = readFileSync("src/game/styles.css", "utf8");
    expect(css).toContain(".ending-screen.lighting-night");
    expect(css).toContain(".ending-screen.lighting-night .ending-shade::after");
    // The card may take a night-blue edge. It must not recolour its text.
    const card = css.match(/\.ending-screen\.lighting-night \.ending-card \{[^}]*\}/)?.[0] ?? "";
    expect(card).not.toMatch(/(^|[;{\s])color\s*:/);
  });
});
