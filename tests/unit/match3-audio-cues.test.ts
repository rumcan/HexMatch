// MATCH-2 — the cues: registered per the asset contract with synth fallbacks,
// variants never repeat back to back, pitch jitter stays in its cents, and
// the swap / settle / match cues are scheduled at the right animation frame.
//
// Headless: there is no AudioContext and no gesture, so every play is
// reported "dropped" — but the report still carries WHICH cue, and WHEN it
// was asked for, which is what the timing assertions read.
import { describe, expect, it } from "vitest";
import { existsSync, statSync } from "node:fs";
import {
  BOARD_ANIMATION_MS,
  MATCH3_CUES,
  MATCH3_CUE_NAMES,
  MAX_SETTLE_VOICES,
  SWAP_CONTACT_AT,
  jitterPitch,
  pickVariant,
  playMatch3Cue,
  voicePhase,
  type Match3Cue,
} from "../../src/match3";

const CONTRACT: Record<string, string[]> = {
  swap_contact: ["swap_contact_1", "swap_contact_2", "swap_contact_3", "swap_contact_4"],
  swap_roll: ["swap_roll_1", "swap_roll_2", "swap_roll_3"],
  settle: ["settle_1", "settle_2", "settle_3", "settle_4"],
  match: ["match_1", "match_2", "match_3"],
  cascade: ["cascade_1", "cascade_2", "cascade_3"],
  finale: ["finale"],
  star_4: ["star_4"],
  star_5: ["star_5"],
};

describe("MATCH-2 — the recordings ship", () => {
  // tools/sfx/make-stone-sfx.mjs writes them; a missing one would fall back to
  // its synth recipe silently, so the contract is pinned here instead.
  it("every contract file is in assets/sfx as an mp3", () => {
    for (const [cue, def] of Object.entries(MATCH3_CUES)) {
      for (const f of def.files) {
        const p = `assets/sfx/${f}.mp3`;
        expect(existsSync(p), `${cue}: ${p}`).toBe(true);
        expect(statSync(p).size, p).toBeGreaterThan(1500);
      }
    }
  });
});

describe("MATCH-2 — the cue catalogue", () => {
  it("registers every file of the asset contract, each with a synth recipe and a gap", () => {
    for (const [cue, files] of Object.entries(CONTRACT)) {
      const def = MATCH3_CUES[cue as Match3Cue];
      expect(def, cue).toBeDefined();
      expect(def.files).toEqual(files);
      expect(typeof def.synth).toBe("function");
      expect(def.gap).toBeGreaterThan(0);
      expect(def.note.length).toBeGreaterThan(10);
    }
    expect(MATCH3_CUE_NAMES).toContain("m3_hover");
    expect(MATCH3_CUES.finale.music).toBe(true);
    expect(MATCH3_CUES.star_4.music).toBeUndefined();
  });

  it("the synth recipes voice layers without a bus (they only call the voice)", () => {
    for (const name of MATCH3_CUE_NAMES) {
      let tones = 0;
      let noises = 0;
      MATCH3_CUES[name].synth({ tone: () => tones++, noise: () => noises++ }, 3);
      expect(tones + noises, name).toBeGreaterThan(0);
    }
  });

  it("never plays the same variant twice running when there is a choice", () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let prev = -1;
    for (let i = 0; i < 200; i++) {
      const v = pickVariant("swap_contact", 4, rnd);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(4);
      expect(v).not.toBe(prev);
      prev = v;
    }
    expect(pickVariant("star_4", 1, rnd)).toBe(0);
    expect(pickVariant("star_4", 1, rnd)).toBe(0);
  });

  it("jitters the pitch inside the cue's cents, never outside", () => {
    for (let i = 0; i < 500; i++) {
      const p = jitterPitch(90);
      expect(p).toBeGreaterThanOrEqual(Math.pow(2, -90 / 1200) - 1e-9);
      expect(p).toBeLessThanOrEqual(Math.pow(2, 90 / 1200) + 1e-9);
    }
    expect(jitterPitch(0)).toBe(1);
    expect(jitterPitch(1200, () => 1)).toBeCloseTo(2);
    expect(jitterPitch(1200, () => 0)).toBeCloseTo(0.5);
  });

  it("is gated headless: no gesture → dropped, never thrown", () => {
    const play = playMatch3Cue("match");
    expect(play.cue).toBe("match");
    expect(play.source).toBe("dropped");
    expect(["unarmed", "muted", "nobus"]).toContain(play.reason);
  });
});

describe("MATCH-2 — cues at the animation moments", () => {
  const beat = BOARD_ANIMATION_MS.swap;

  it("the swap voices the clack AT the contact frame and the roll just after", () => {
    const plays = voicePhase({ type: "swap", contactAt: SWAP_CONTACT_AT }, beat);
    expect(plays.map((p) => p.cue)).toEqual(["swap_contact", "swap_roll"]);
    expect(plays[0].at).toBeCloseTo((beat * SWAP_CONTACT_AT) / 1000, 6);
    expect(plays[1].at).toBeGreaterThan(plays[0].at);
    expect(plays[1].at - plays[0].at).toBeLessThan(0.03);
  });

  it("a slow-mo swap keeps the clack on the contact frame of the longer beat", () => {
    const slow = voicePhase({ type: "swap", contactAt: 0.5 }, beat / 0.25);
    expect(slow[0].at).toBeCloseTo((beat / 0.25) * 0.5 / 1000, 6);
  });

  it("a revert clacks (the stones still touch) but does not roll", () => {
    const plays = voicePhase({ type: "revert", contactAt: 0.5 }, beat);
    expect(plays.map((p) => p.cue)).toEqual(["swap_contact"]);
  });

  // Lead's integration: every pass cracks (the stones' material sound — the
  // pitched ladder is the game's own per-gem `pop`), and a cascade pass adds
  // the depth shimmer on top, its file chosen by the depth.
  it("a clear cracks; a cascade pass adds the shimmer for its depth", () => {
    expect(voicePhase({ type: "clear", chain: 1 }, 95).map((p) => p.cue)).toEqual(["match"]);
    expect(voicePhase({ type: "clear", chain: 3 }, 95).map((p) => p.cue)).toEqual(["match", "cascade"]);
    expect(MATCH3_CUES.cascade.byStep).toBe(true);
  });

  it("a fall settles AT the landing frame, one knock per column, at most four, a few ms apart", () => {
    const fallMs = BOARD_ANIMATION_MS.fall;
    const moves = [
      { c: 0, fromR: -1, toR: 0 },
      { c: 0, fromR: -2, toR: 1 },
      { c: 1, fromR: 2, toR: 5 },
      { c: 2, fromR: -1, toR: 2 },
      { c: 3, fromR: -3, toR: 1 },
      { c: 4, fromR: -1, toR: 7 },
      { c: 5, fromR: -1, toR: 0 },
    ];
    const plays = voicePhase({ type: "fall", moves }, fallMs);
    expect(plays.length).toBe(MAX_SETTLE_VOICES);
    expect(plays.every((p) => p.cue === "settle")).toBe(true);
    expect(plays[0].at).toBeCloseTo(fallMs / 1000, 6);
    for (let i = 1; i < plays.length; i++) {
      expect(plays[i].at).toBeGreaterThan(plays[i - 1].at);
      expect(plays[i].at - plays[i - 1].at).toBeLessThan(0.05);
    }
    expect(voicePhase({ type: "fall", moves: [] }, fallMs)).toEqual([]);
  });

  it("phases with no sound stay silent", () => {
    expect(voicePhase({ type: "end" }, 0)).toEqual([]);
    expect(voicePhase({ type: "crossChoice" }, 0)).toEqual([]);
  });
});
