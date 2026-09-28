// ══════════════════════════════════════════════════════════════════════════
// UIX-6 (#601) — ONE paper recipe, on every beige surface.
//
// The ticket's acceptance block, pinned from the stylesheets out:
//
//   1. the menu card's light pattern texture is factored into ONE shared
//      custom property (--px-paper-bg, theme-poster.css :root) plus the
//      .px-paper-tex class — the old three-line recipe appears exactly
//      once, inside the var, and the menu cards themselves take the var;
//   2. every beige surface the ticket lists — the objective chip, the
//      bottom-right Plant / action (Depot, Platform, Train) cards, the
//      bottom tabs' active tab, the drawer sheets, the confirm sheet, the
//      toasts, the tutorial/How-to cards, the ending card, the paper
//      popups and the loading card — takes that var (or the class);
//   3. the match-3 (tuning session) page is the new UI card: a paper frame
//      with the .px-card's 3px ink border and radius, an ink header bar
//      (session title + star bar), textured paper side readouts, the
//      menu's orange buttons — and no gradient anywhere on the page but
//      the paper recipe itself, no lemon.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const POSTER = readFileSync("src/game/theme-poster.css", "utf8");
const HUD = readFileSync("src/game/theme-poster-hud.css", "utf8");
const STYLES = readFileSync("src/game/styles.css", "utf8");
const UI_TS = readFileSync("src/game/ui.ts", "utf8");

/** The shared paper recipe — `var(--px-paper-bg)`, fallbacks allowed
 *  (styles.css does not know the poster tokens and keeps a literal fall-
 *  back; the value itself is the var's). */
const PAPER = /var\(--px-paper-bg(?:\s*,\s*[^)]*)?\)/;
/** The stipple — the one fingerprint of the recipe, so a copy-paste shows. */
const STIPPLE = "radial-gradient(rgba(73, 52, 24";

const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every rule body whose SELECTOR region (the text between one brace pair's
 * close and the next `{`) contains `needle` — works across @media nesting.
 */
function bodiesWith(css: string, needle: string): string[] {
  const re = new RegExp(`[^{}]*${esc(needle)}[^{}]*\\{([^{}]*)\\}`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(strip(css))) !== null) out.push(m[1]);
  return out;
}
/** Some rule for `needle` carries the paper recipe (or the .px-paper-tex class). */
const usesPaper = (css: string, needle: string): boolean =>
  bodiesWith(css, needle).some((b) => PAPER.test(b) || b.includes(".px-paper-tex"));
/** Some rule for `needle` contains `frag` (string or regex). */
const has = (css: string, needle: string, frag: string | RegExp): boolean =>
  bodiesWith(css, needle).some((b) => (typeof frag === "string" ? b.includes(frag) : frag.test(b)));

describe("UIX-6 — the recipe is ONE thing", () => {
  it("defines --px-paper-bg exactly once, in theme-poster.css", () => {
    const defs = [...strip(POSTER).matchAll(/--px-paper-bg\s*:/g)].length;
    expect(defs, "the var is defined more than once").toBe(1);
    expect(
      [...strip(HUD).matchAll(/--px-paper-bg\s*:/g)].length,
      "the HUD sheet must not redefine the recipe",
    ).toBe(0);
  });

  it("paints the stipple exactly once (inside the var) across both sheets", () => {
    const hits =
      strip(POSTER).split(STIPPLE).length - 1 + (strip(HUD).split(STIPPLE).length - 1);
    expect(hits, "the 3-line recipe must live only inside --px-paper-bg").toBe(1);
  });

  it("ships the .px-paper-tex class wired to the var", () => {
    expect(usesPaper(POSTER, ".px-paper-tex")).toBe(true);
  });

  it("the menu cards and the difficulty card take the shared var", () => {
    expect(usesPaper(POSTER, ".px-detail"), ".px-detail").toBe(true);
    expect(usesPaper(POSTER, ".px-sidebar"), ".px-sidebar").toBe(true);
    expect(usesPaper(POSTER, ".px-profile"), ".px-profile").toBe(true);
    expect(usesPaper(POSTER, ".px-modes"), ".px-modes").toBe(true);
    expect(usesPaper(POSTER, ".iso-skill-card"), ".iso-skill-card").toBe(true);
  });

  it("the paper popups and the loading card take the shared var", () => {
    expect(usesPaper(POSTER, ".modal.box"), ".modal.box").toBe(true);
    expect(usesPaper(POSTER, ".iso-loading-card"), ".iso-loading-card").toBe(true);
  });
});

describe("UIX-6 — every gameplay beige surface takes the recipe", () => {
  it("the objective chip", () => {
    expect(usesPaper(HUD, ".ui-root .objective")).toBe(true);
  });
  it("the bottom-right Plant card and the Depot / Platform / Train action cards", () => {
    expect(usesPaper(HUD, ".ui-root .br-dock .plant-card")).toBe(true);
    expect(usesPaper(HUD, ".ui-root .br-dock .depot-card")).toBe(true);
  });
  it("the bottom tabs' active tab (desktop and phone)", () => {
    expect(usesPaper(HUD, ".aside.right .tab.active")).toBe(true);
    expect(usesPaper(HUD, "#iso-aside-right .tab.active")).toBe(true);
  });
  it("the drawer and its sheets (bank / market / contracts, incl. the build sheet)", () => {
    expect(usesPaper(HUD, ".ui-root .aside.right")).toBe(true);
    expect(usesPaper(HUD, ".ui-root .aside.right .pane")).toBe(true);
  });
  it("the phone Economy sheet", () => {
    expect(usesPaper(HUD, ".ui-root #iso-aside-right")).toBe(true);
  });
  it("the confirm sheets", () => {
    expect(usesPaper(HUD, ".ui-root .confirm-sheet")).toBe(true);
  });
  it("toasts, the held-tool hint and the banner", () => {
    expect(usesPaper(HUD, ".ui-root .toast")).toBe(true);
    expect(usesPaper(HUD, ".ui-root .modebar")).toBe(true);
    expect(usesPaper(HUD, ".ui-root .banner")).toBe(true);
  });
  it("the tutorial strip and the How to Play / tutorial dialog card", () => {
    expect(usesPaper(HUD, "#iso-guide .guide-strip")).toBe(true);
    expect(usesPaper(HUD, ".tut-card")).toBe(true);
  });
  it("the results / ending card", () => {
    expect(usesPaper(HUD, "#iso-ending .ending-card")).toBe(true);
  });
});

describe("UIX-6 — the match-3 page is the new UI card", () => {
  it("the frame: paper, the .px-card's 3px ink border and radius", () => {
    expect(has(STYLES, ".session-frame", PAPER), "paper background").toBe(true);
    expect(
      has(STYLES, ".session-frame", /border:\s*3px solid var\(--px-ink-2/),
      "3px ink border",
    ).toBe(true);
    expect(has(STYLES, ".session-frame", "border-radius: 11px"), "card radius").toBe(true);
  });

  it("the ink header bar holds the session title and the star bar", () => {
    expect(has(STYLES, ".session-frame .tp-title", "var(--px-ink-2"), "title on the ink bar").toBe(true);
    expect(has(STYLES, ".session-frame .tp-meter", "var(--px-ink-2"), "meter on the ink bar").toBe(true);
    expect(has(STYLES, ".session-frame .tp-meter", "grid-row: 1"), "meter is row 1 of the grid").toBe(true);
  });

  it("the side readouts are textured paper sub-cards (moves, score, reward, star curve)", () => {
    expect(usesPaper(STYLES, ".tp-moves, .tp-score, .tp-yield"), "moves / score / reward").toBe(true);
    expect(usesPaper(STYLES, ".session-frame .tp-curve"), "star curve").toBe(true);
  });

  it("the star-curve labels are wired to TUNING_STARS in ui.ts", () => {
    expect(UI_TS).toContain("TUNING_STARS");
    expect(UI_TS).toContain("tp-curve-label");
    expect(UI_TS).toMatch(/"★"\.repeat\(row\.stars\)/);
  });

  it("the buttons use the menu's orange (never lemon)", () => {
    for (const needle of [".session-frame .tp-finish", ".sr-confirm", ".tc-start"]) {
      expect(has(STYLES, needle, "#e6690c"), `${needle} is orange`).toBe(true);
      expect(
        bodiesWith(STYLES, needle).some((b) => /lemon|#f2d64b/i.test(b)),
        `${needle} must not be lemon`,
      ).toBe(false);
    }
  });

  it("the results, target and finale cards wear the same paper card", () => {
    for (const needle of [".sr-card", ".tc-card", ".m3-finale-banner"]) {
      expect(usesPaper(STYLES, needle), `${needle} paper`).toBe(true);
      expect(has(STYLES, needle, /border:\s*3px solid #11191d/), `${needle} 3px ink border`).toBe(true);
      expect(has(STYLES, needle, "border-radius: 11px"), `${needle} card radius`).toBe(true);
    }
  });
});

describe("UIX-6 — flat colours on the match-3 page", () => {
  /** Every rule on the session page (chrome only — the board's own felt
   *  is board drawing and lives on .board-wrap, not a session selector). */
  function sessionBodies(css: string): { sel: string; body: string }[] {
    const re = /([^{}]+)\{([^{}]*)\}/g;
    const out: { sel: string; body: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(strip(css))) !== null) {
      const sel = m[1].trim();
      if (/^(\.session-|\.sr-|\.tc-|\.tp-|\.m3-finale)/.test(sel)) out.push({ sel, body: m[2] });
    }
    return out;
  }

  it("paints no gradient but the paper recipe", () => {
    const offenders = sessionBodies(STYLES).filter(({ body }) => /gradient\(/.test(body));
    expect(
      offenders.map(({ sel }) => sel),
      "the match-3 page paints flat colours; the only gradient allowed is --px-paper-bg",
    ).toEqual([]);
  });

  it("paints no lemon", () => {
    const offenders = sessionBodies(STYLES).filter(
      ({ body }) => /lemon|#f2d64b|#ffe066|#fff06a/i.test(body),
    );
    expect(offenders.map(({ sel }) => sel), "orange buttons, never lemon").toEqual([]);
  });
});
