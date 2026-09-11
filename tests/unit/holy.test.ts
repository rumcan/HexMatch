// ══════════════════════════════════════════════════════════════════════════
// PP-14 — the holy cross's sound is garnish: it must sing where it can and
// stay silent (not crash the board) where it cannot. jsdom has no
// AudioContext, so this test pins the no-crash half of that contract; the
// real sing happens in the browser.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { playHoly, prewarmHoly } from "../../src/game/holy";

describe("PP-14 holy sound", () => {
  it("never throws, even where there is no AudioContext (jsdom)", () => {
    expect(() => playHoly()).not.toThrow();
    expect(() => prewarmHoly()).not.toThrow();
  });
});
