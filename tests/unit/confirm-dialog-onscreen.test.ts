// The shared "Are you sure?" plate (src/iso/confirm-sheet.ts, class
// `modal-root confirm-sheet`) must never pick up the phone placement sheet's
// off-screen bottom-sheet rules (MOB-1, theme-space-age.css) — when it did,
// "Play vs AI" and "Conquest" with a save on disk opened an invisible ask and
// looked dead (owner play-test, 2026-09-28).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const css = fs.readFileSync(path.resolve(__dirname, "../../src/game/theme-space-age.css"), "utf8");

describe("the confirm dialog stays on screen", () => {
  it("no bare `.confirm-sheet {` rule parks every confirm sheet off screen", () => {
    const bare = css.split(/\r?\n/).filter((l) => /^\.confirm-sheet\s*\{/.test(l.trim()));
    expect(bare, "scope the bottom-sheet rule with :not(.modal-root)").toEqual([]);
  });
  it("the bottom-sheet rule excludes the modal root", () => {
    expect(css).toMatch(/\.confirm-sheet:not\(\.modal-root\)\s*\{[^}]*translateY\(100%\)/);
  });
});
