// ══════════════════════════════════════════════════════════════════════════
// A1 — the OTHER end of the FX wire: the stylesheet.
//
// The bug this whole ticket is about was a one-line missing assignment, and it
// survived because both ends of the wire were invisible to each other: the
// board emitted `fx`/`popup` events nobody consumed, and the stylesheet carried
// the rules for elements nobody created. The tests in board.test.ts and
// iso-game.test.ts pin the JS end. This file pins the CSS end — every class the
// UI emits is actually styled, every animation it names actually exists, and
// the reduced-motion rule does not quietly delete the readouts.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/game/styles.css", "utf8");
const ui = readFileSync("src/game/ui.ts", "utf8");
const floats = readFileSync("src/iso/floats.ts", "utf8");
const board = readFileSync("src/game/board.ts", "utf8");

/**
 * The selectors the FX code actually puts on the page — written the way the
 * code writes them (`fx fx-${type}`, `iso-float delivery`, …), so a rule that
 * only styles the bare class while the code emits two still fails here.
 */
const EMITTED = [
  ".fx-pop", ".fx-crack", ".fx-up", ".fx-bad", ".fx-boom",
  ".fx-chain", ".fx-combo",
  ".combo-float", ".combo-float.cf-big",
  ".harvest-pop", ".hp-label", ".hp-body",
  ".iso-float", ".iso-float.delivery", ".iso-float.sabotage",
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The `{ … }` block that follows the first real occurrence of `selector`. */
function ruleFor(selector: string): string | null {
  // a whole token: preceded by start/newline/}/comma/space, followed by
  // whitespace, a comma or the brace — so `.delivery` inside `.iso-float` and
  // any mention inside a comment cannot be mistaken for the rule.
  const re = new RegExp(`(^|[},\\s])${esc(selector)}(?=[\\s,{])`, "m");
  const m = re.exec(css);
  if (!m) return null;
  const open = css.indexOf("{", m.index);
  const close = open < 0 ? -1 : css.indexOf("}", open);
  return close < 0 ? null : css.slice(open + 1, close);
}

/** `@keyframes foo { ... }` — the animation actually exists. */
function hasKeyframes(name: string): boolean {
  return new RegExp(`@keyframes\\s+${name}\\s*\\{`).test(css);
}

describe("A1 the FX classes the UI emits are really styled", () => {
  it.each(EMITTED)("%s has a rule in the stylesheet", (selector) => {
    expect(ruleFor(selector), `${selector} is emitted but never styled`).not.toBeNull();
  });

  it("names only animations that exist", () => {
    // every `animation: <name>` in an FX rule must have a @keyframes block
    const names = new Set<string>();
    for (const selector of EMITTED) {
      const body = ruleFor(selector);
      if (!body) continue;
      const m = /animation:\s*([A-Za-z0-9_-]+)/.exec(body);
      if (m) names.add(m[1]);
    }
    expect(names.size).toBeGreaterThan(0);
    for (const n of names) {
      expect(hasKeyframes(n), `@keyframes ${n} is missing`).toBe(true);
    }
  });

  it("gives every FxType the board can fire its own class", () => {
    // `FxType` in board.ts is the contract; a new type with no CSS is exactly
    // how a callout ends up invisible.
    const union = /export type FxType =([^;]+);/.exec(board)![1];
    const types = [...union.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    expect(types).toContain("chain");
    expect(types).toContain("combo");
    for (const t of types) expect(ruleFor(`.fx-${t}`), `.fx-${t}`).not.toBeNull();
  });
});

describe("A1 reduced motion keeps the information and drops the movement", () => {
  const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css);
  const reduced = block?.[1] ?? "";

  it("exempts the arcade readouts from the blanket .01ms rule", () => {
    // The blanket `* { animation-duration: .01ms !important }` sends every
    // `forwards` animation to its LAST keyframe — opacity 0 — so without this
    // exemption a reduced-motion player sees no MATCH!, no COMBO and no
    // harvest at all.
    for (const cls of ["fx-chain", "fx-combo", "combo-float", "harvest-pop", "iso-float"]) {
      expect(reduced, `reduced-motion block not found`).toContain(cls);
    }
    expect(reduced).toMatch(/animation:\s*none\s*!important/);
    expect(reduced).toMatch(/opacity:\s*1\s*!important/);
  });

  it("leaves the decorative pops to the blanket rule", () => {
    // pops, booms and cracks are decoration — they SHOULD collapse. Only the
    // text that carries information is exempt.
    expect(reduced).not.toContain("fx-pop");
    expect(reduced).not.toContain("fx-boom");
  });
});

describe("A1 the class names the code writes match the stylesheet", () => {
  it("ui.ts emits exactly the FX classes it styles", () => {
    // `fx-${type}` in ui.ts + the literal class strings the floats use
    expect(ui).toMatch(/`fx fx-\$\{type\}`/);
    expect(ui).toMatch(/combo-float/);
    expect(ui).toMatch(/harvest-pop/);
    expect(floats).toMatch(/iso-float/);
    expect(floats).toMatch(/delivery|cls/);
  });
});
