// ══════════════════════════════════════════════════════════════════════════
// RAIL-02 (#176) — the evidence figure.
//
// The ticket asks for screenshots where the work is visual. The rail modules
// are headless (art is #177, the construction UI is #179), so the one visual
// surface this ticket owns is the PLACEMENT GEOMETRY — and the honest way to
// show it is to draw the module's own footprint functions rather than a redrawn
// copy that could quietly disagree with them.
//
// The render is opt-in, like the ground preview:
//
//   PREVIEW_RAIL=1 npx vitest run tests/unit/iso-railway-figure.test.ts
//
// Default output: `docs/railway-02/preview.png` (the PR's figure). Set
// `PREVIEW_RAIL_OUT` to write it somewhere else.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { statSync } from "node:fs";
import { renderRailFigure } from "./helpers/rail-figure";

describe("RAIL-02 evidence figure", () => {
  it("renders the placement geometry (PREVIEW_RAIL=1)", async () => {
    if (process.env.PREVIEW_RAIL !== "1") {
      // the geometry itself is pinned by the three numbered suites; this one
      // only exists so the figure can be regenerated on demand
      expect(true).toBe(true);
      return;
    }
    const out = process.env.PREVIEW_RAIL_OUT ?? "docs/railway-02/preview.png";
    await renderRailFigure(out);
    expect(statSync(out).size).toBeGreaterThan(20_000);
  }, 120_000);
});
