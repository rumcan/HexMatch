// @vitest-environment jsdom
//
// #122 — the Story Mode contract card: the status badge must not sit on top of
// the contract heading.
//
// The report was a screenshot of "Filed · lost" painted over "CONTRACT I ·
// BLACKWOOD FREIGHT". The cause was layout, not paint order: `.cc-seal` was
// `position: absolute; top: 10px; right: 12px` while `.cc-body`'s first line of
// text started in the same box — nothing in the text layout reserved any space
// for the badge, so the two were only ever "not overlapping" by luck of width.
//
// jsdom has no layout engine, so this pins the two things that decide it:
//   · the DOM — the badge is a sibling of the kicker inside one wrapping row,
//     in every state (won / lost / locked / unplayed), rather than a floating
//     child of the card;
//   · the stylesheet — that row really wraps, the badge really is in flow, and
//     the card column can shrink instead of spilling out of a panel that
//     clips its overflow.
// The pixel-level acceptance (desktop / narrow / 200% zoom) belongs to the
// browser spec: `tests/e2e/story-card-layout.spec.ts`.
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import StartScreen from "../../src/ui/StartScreen";
import { STORY_STORAGE_KEY } from "../../src/story/progress";
import { CHAPTERS } from "../../src/story/chapters";

const css = readFileSync("src/game/styles.css", "utf8");

/** The rule body for a selector, so the assertions read one declaration at a
 *  time instead of matching against the whole sheet. */
function rule(selector: string): string {
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

let container: HTMLDivElement;
let root: Root;

/** A campaign record with one card in every state the menu can show. */
const FOUR_STATE_RECORD = {
  unlocked: 4,                       // inheritance … stone-thunder are open
  results: { inheritance: "loss", "toll-king": "win" },
  introSeen: true,
  advisor: true,
};

async function openCampaign(): Promise<void> {
  localStorage.setItem(STORY_STORAGE_KEY, JSON.stringify(FOUR_STATE_RECORD));
  await act(async () => {
    root.render(createElement(StartScreen, { onStart: () => {}, initial: "story" }));
  });
}

const cards = () =>
  Array.from(container.querySelectorAll<HTMLButtonElement>(".chapter-card"));
/** The card for a contract, by its id — the list renders `CHAPTERS` in order.
 *  Keyed on the id rather than the title because titles move (PR #125 renamed
 *  chapter 1 out from under the first version of this spec). */
const cardFor = (id: string) => {
  const at = CHAPTERS.findIndex((c) => c.id === id);
  expect(at, `no such contract: ${id}`).toBeGreaterThanOrEqual(0);
  return cards()[at];
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe("#122 contract card layout (DOM)", () => {
  it("renders all five contracts, one in each state", async () => {
    await openCampaign();
    expect(cards()).toHaveLength(CHAPTERS.length);
    expect(cardFor("inheritance").querySelector(".cc-seal.loss")?.textContent)
      .toBe("Filed · lost");
    expect(cardFor("toll-king").querySelector(".cc-seal:not(.loss)")?.textContent)
      .toBe("Filed · won");
    // open and unplayed: no badge at all, and nothing where a badge would go
    const unplayed = cards().find((c) => !c.classList.contains("locked")
      && !c.querySelector(".cc-seal"))!;
    expect(unplayed).toBeTruthy();
    expect(unplayed.querySelector(".cc-lock")).toBeNull();
    // sealed: the lock, in flow with the kicker
    expect(container.querySelectorAll(".chapter-card.locked .cc-lock")).toHaveLength(1);
  });

  it("puts the badge in the kicker's own row, not floating over the card", async () => {
    await openCampaign();
    // THE reported card, in the reported state.
    const reported = cardFor("inheritance");
    const seal = reported.querySelector(".cc-seal")!;
    const kicker = reported.querySelector(".cc-kicker")!;
    // Same parent, and that parent is the row — not the card itself.
    expect(seal.parentElement).toBe(kicker.parentElement);
    expect(seal.parentElement!.classList.contains("cc-head")).toBe(true);
    // The row lives in the text column, beside the portrait.
    expect(kicker.parentElement!.parentElement!.classList.contains("cc-body")).toBe(true);
  });

  it("applies the same row to won, lost and locked cards", async () => {
    await openCampaign();
    for (const sel of [".cc-seal", ".cc-seal.loss", ".cc-lock"]) {
      const badge = container.querySelector(sel)!;
      expect(badge, sel).toBeTruthy();
      const head = badge.closest(".cc-head");
      expect(head, `${sel} sits in the heading row`).toBeTruthy();
      expect(head!.querySelector(".cc-kicker"), `${sel} shares the row with the kicker`)
        .toBeTruthy();
      // …and no card carries a badge outside that row.
      expect(badge.parentElement!.classList.contains("chapter-card")).toBe(false);
    }
  });

  it("keeps the card one click target and names the result to a screen reader", async () => {
    await openCampaign();
    const reported = cardFor("inheritance");
    expect(reported.tagName).toBe("BUTTON");
    expect(reported.disabled).toBe(false);
    // The badge's text is inside the button, but the button's aria-label wins
    // the accessible name — so the result has to be in the label too.
    expect(reported.getAttribute("aria-label")).toContain("filed, lost");
    const won = cardFor("toll-king");
    expect(won.getAttribute("aria-label")).toContain("filed, won");
    const sealed = container.querySelector<HTMLButtonElement>(".chapter-card.locked")!;
    expect(sealed.disabled).toBe(true);
    expect(sealed.getAttribute("aria-label")).toContain("sealed");
  });
});

describe("#122 contract card layout (stylesheet)", () => {
  it("takes the badge out of absolute positioning", () => {
    // The whole bug: an absolutely positioned plate with no space reserved.
    expect(rule(".cc-seal {")).not.toMatch(/position:\s*absolute/);
    expect(rule(".cc-lock {")).not.toMatch(/position:\s*absolute/);
    expect(rule(".cc-seal {")).not.toMatch(/\btop:|\bright:/);
    expect(rule(".cc-lock {")).not.toMatch(/\btop:|\bright:/);
  });

  it("gives the pair one row that wraps instead of colliding", () => {
    const head = rule(".cc-head {");
    expect(head).toMatch(/display:\s*flex/);
    expect(head).toMatch(/flex-wrap:\s*wrap/);   // too narrow ⇒ two lines, not an overlap
    expect(rule(".cc-seal {")).toMatch(/flex:\s*0 0 auto/);
    expect(rule(".cc-seal {")).toMatch(/white-space:\s*nowrap/);  // the stamp stays whole
    // The kicker keeps a readable minimum, which is what makes the wrap happen.
    expect(rule(".cc-kicker {")).toMatch(/min-width:\s*100px/);
  });

  it("lets the card column shrink rather than spill out of a clipping panel", () => {
    // `.start-screen` clips its overflow, so a hard 250px floor lost the
    // card's right edge below ~370px of viewport (and at 200% zoom).
    expect(rule(".chapter-list {")).toMatch(/minmax\(\s*min\(250px,\s*100%\)/);
    // `.start-screen` has more than one rule block, so this one reads the
    // sheet: the clipping that made a spilling card lose its right edge.
    expect(css).toMatch(/\.start-screen\s*\{[^}]*overflow:\s*hidden/);
  });

  it("hides nothing to make the collision disappear", () => {
    // The ticket is explicit: content-driven height, not clipped or shrunk text.
    for (const sel of [".chapter-card {", ".cc-body {", ".cc-kicker {", ".cc-brief {", ".cc-name {"]) {
      const body = rule(sel);
      expect(body, `${sel} must not clip`).not.toMatch(/overflow:\s*hidden/);
      expect(body, `${sel} must not ellipsize`).not.toMatch(/text-overflow/);
      expect(body, `${sel} must not pin a height`).not.toMatch(/(^|[^-])height:\s*\d/);
    }
    expect(rule(".cc-kicker {")).not.toMatch(/white-space:\s*nowrap/);
  });
});
