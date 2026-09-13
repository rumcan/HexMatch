// STORY-01 — the guide takes the setup sheet.
//
// In story mode the loop's opening banners are SPOKEN by Mabel (a speech
// bubble with her face) instead of posted as the faceless manila sheet.
// These pin the seam: only the keys she owns are converted, every other
// banner stays the posted sheet verbatim, and every mood she speaks in is a
// quadrant her painted expression sheet actually has.
import { describe, expect, it } from "vitest";
import { GUIDE_BANNER_KEYS, guideBanner } from "../../src/story/guide-banner";
import { CAST, GUIDE, faceOf } from "../../src/story/cast";

/** The banner keys the iso game actually raises (src/iso/game.ts paint()). */
const GAME_BANNER_KEYS = [
  "setup-factory", "setup-depot", "won", "protest-ready", "free-track",
  "dirt-value", "nothing-connected", "plant", "match-gems",
] as const;

describe("guideBanner — Mabel's lines for the setup sheet", () => {
  it("speaks the factory-placement beat in her voice", () => {
    const line = guideBanner("setup-factory");
    expect(line).not.toBeNull();
    // same instruction as the sheet ("next to a town — click a buildable
    // tile"), but it has to SOUND like the bookkeeper who briefed you.
    expect(line!.text.toLowerCase()).toContain("town");
    expect(line!.text.toLowerCase()).toMatch(/click|tile/);
    expect(line!.mood).toBe("calm");
  });

  it("owns exactly the setup beats, and nothing louder than her job", () => {
    const owned = new Set(GUIDE_BANNER_KEYS);
    expect([...owned].sort()).toEqual(
      ["free-track", "match-gems", "nothing-connected", "setup-depot", "setup-factory"].sort(),
    );
    // every key she speaks for is a key the game really raises
    for (const key of GUIDE_BANNER_KEYS) {
      expect(GAME_BANNER_KEYS).toContain(key);
    }
  });

  it("leaves every other banner as the posted sheet", () => {
    // the win line, the protest countdown, dirt value, the plant hint —
    // a guide who narrates those never stops talking.
    for (const key of ["won", "protest-ready", "dirt-value", "plant"]) {
      expect(guideBanner(key)).toBeNull();
    }
    expect(guideBanner(null)).toBeNull();
    expect(guideBanner("")).toBeNull();
    expect(guideBanner("not-a-banner")).toBeNull();
  });

  it("has a painted face for every mood she speaks in", () => {
    for (const key of GUIDE_BANNER_KEYS) {
      const line = guideBanner(key)!;
      expect(line.text.length).toBeGreaterThan(20);
      const face = faceOf(GUIDE, line.mood);
      // her expression sheet: a quadrant at a uniform 2×, never per-axis
      expect(face.url.length).toBeGreaterThan(0);
      expect(face.pos).not.toBeNull();
      for (const axis of face.pos!) {
        expect([0, 100]).toContain(axis);
      }
    }
  });

  it("names the guide the campaign cast agrees on", () => {
    expect(CAST[GUIDE].name).toMatch(/Mabel/);
  });
});
