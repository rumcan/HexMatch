import { describe, expect, it } from "vitest";
import { CHAPTERS, EMPLOYER, currentJobTitle } from "../../src/story/chapters";
import { CAST } from "../../src/story/cast";
import { INTRO_SCENE } from "../../src/story/intro";

// ══════════════════════════════════════════════════════════════════════════
// BACK TO WORK (the jam theme) — Story Mode is a career: the player takes the
// job of Logistics Manager at Hextall Freight and every contract won is a
// promotion. These tests keep the job visible in the data and in the scenes.
// ══════════════════════════════════════════════════════════════════════════

const text = (lines: readonly { text: string }[]) => lines.map((l) => l.text).join(" ");

describe("the Story Mode career", () => {
  it("hires the player as Logistics Manager at Hextall Freight", () => {
    expect(CHAPTERS[0].jobTitle).toBe("Logistics Manager");
    expect(EMPLOYER).toBe("Hextall Freight");
    expect(CAST.vex.role).toContain("Logistics Manager");
    expect(CAST.you.role).toContain("Logistics Manager");
  });

  it("promotes contract to contract without a gap", () => {
    for (let i = 0; i < CHAPTERS.length - 1; i++) {
      expect(CHAPTERS[i].promotion, `${CHAPTERS[i].id} promotes into the next contract`)
        .toBe(CHAPTERS[i + 1].jobTitle);
    }
    expect(new Set(CHAPTERS.map((c) => c.jobTitle)).size).toBe(CHAPTERS.length);
    expect(CHAPTERS[CHAPTERS.length - 1].promotion).toBe("Chairman of the Board");
  });

  it("reads the current job from results, and a loss never demotes", () => {
    expect(currentJobTitle({})).toBe("Logistics Manager");
    expect(currentJobTitle({ inheritance: "loss" })).toBe("Logistics Manager");
    expect(currentJobTitle({ inheritance: "win" })).toBe("Operations Manager");
    expect(currentJobTitle({ inheritance: "win", "toll-king": "loss" })).toBe("Operations Manager");
    expect(currentJobTitle(Object.fromEntries(CHAPTERS.map((c) => [c.id, "win"]))))
      .toBe("Chairman of the Board");
  });

  it("names the job in the first briefing and every promotion in its win scene", () => {
    expect(text(CHAPTERS[0].pre.lines)).toMatch(/Logistics Manager/i);
    for (const c of CHAPTERS) {
      expect(text(c.win.lines), `${c.id} win scene names the promotion`).toContain(c.promotion);
    }
  });

  it("opens the campaign on the job, not an inheritance", () => {
    const reel = text(INTRO_SCENE.lines);
    expect(reel).toMatch(/Logistics Manager/);
    expect(reel).not.toMatch(/\bheir\b/i);
    for (const c of CHAPTERS) {
      expect(text(c.pre.lines), `${c.id} briefing`).not.toMatch(/\bheirs?\b|the inheritance/i);
    }
  });
});
