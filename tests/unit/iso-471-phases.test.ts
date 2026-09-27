// BAL-1 (#471) — the phase beats are a pure rule: the Feed's arc lines fire
// when the ★ LEADER crosses each share of the line, once each.
import { describe, it, expect } from "vitest";

import { PHASE_BEATS, phaseBeatFor, phaseBeatsDue, type PhaseBeatId } from "../../src/iso/phases";

describe("BAL-1 (#471) phase beats", () => {
  it("fires once per beat, driven by the leader — either seat", () => {
    const target = 12;
    // The player leading fires the beats…
    expect(phaseBeatsDue(0, 0, target)).toEqual([]);
    const due = phaseBeatsDue(4, 0, target);      // 4 ≥ 12/3
    expect(due.map((b) => b.id)).toEqual(["midgame"]);
    expect(due[0].text(target)).toBe("Mid-game: tenders open.");
    // …and so does the RIVAL leading (the arc follows the race).
    expect(phaseBeatsDue(0, 8, target).map((b) => b.id)).toEqual(["midgame", "final"]);
    const final = PHASE_BEATS.find((b) => b.id === "final")!;
    expect(final.text(target)).toBe(`Final stretch: ${target}★ to win.`);
  });

  it("never repeats a beat the caller has already seen", () => {
    const seen = new Set<PhaseBeatId>(["midgame"]);
    const beat = phaseBeatFor(8, 0, 12, seen);
    expect(beat?.id).toBe("final");
    seen.add("final");
    expect(phaseBeatFor(11, 0, 12, seen)).toBeNull();
  });

  it("needs a real line", () => {
    expect(phaseBeatFor(5, 5, 0, new Set())).toBeNull();
  });
});
