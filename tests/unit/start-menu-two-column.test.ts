// @vitest-environment jsdom
//
// Issue #184 — the desktop mode menu is two columns, not one.
//
// The regression: the "Back to work, Logistics Manager" play/start screen was
// a narrow 440px single column, tall enough to push "The ladder" (and "Back
// to the menu") below the fold at 1432x936, with empty space on both sides.
// The fix seats the same content in a wider two-column card:
//
//   left (.start-modes-info):  kicker, heading, intro, manager picker, rating
//   right (.start-actions):    every play/multiplayer/navigation action
//
// jsdom has no layout engine, so this pins the structure (two semantic groups
// in visual order, every action on the right, keyboard order left-to-right)
// and the stylesheet rules (grid, two balanced columns, no clipping or
// scaling tricks, narrow screens collapse back to one column). The real
// pixel check — every action visible without scrolling at 1920x1080,
// 1432x936 and 1366x768 — lives in tests/e2e/start-menu-layout.spec.ts.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../../src/net/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/net/transport")>();
  return {
    ...actual,
    createRoom: vi.fn(),
    joinRoomByCode: vi.fn(),
    quickMatch: vi.fn(),
    promptLogin: vi.fn(async () => ({ success: false })),
    isOfflineMockRealtime: vi.fn(() => false),
  };
});

import StartScreen from "../../src/ui/StartScreen";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stylesCss = () =>
  fs.readFileSync(path.resolve(__dirname, "../../src/game/styles.css"), "utf8");

let container: HTMLDivElement;
let root: Root;

async function renderModes(): Promise<void> {
  await act(async () => {
    // onBack stands so "Back to the menu" is part of the asserted action list.
    root.render(createElement(StartScreen, { onStart: () => {}, onBack: () => {} }));
  });
}

/** Buttons in DOM order, by their leading label text. */
const buttonLabels = (scope: ParentNode): string[] =>
  [...scope.querySelectorAll("button")]
    .map((b) => (b.textContent ?? "").trim().replace(/\s+/g, " "));

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.clearAllMocks();
});

describe("#184 two-column mode menu", () => {
  it("seats the mode screen in a two-group card, info left and actions right", async () => {
    await renderModes();
    const panel = container.querySelector("main[aria-label=\"Hexmatch start screen\"] > .start-panel.start-modes");
    expect(panel).not.toBeNull();

    const groups = [...(panel as Element).children];
    expect(groups).toHaveLength(2);
    // DOM order is visual order: the info column first, the actions second,
    // so Tab walks the manager picker before the mode buttons.
    expect(groups[0].tagName).toBe("SECTION");
    expect(groups[0].classList.contains("start-modes-info")).toBe(true);
    expect(groups[1].tagName).toBe("NAV");
    expect(groups[1].classList.contains("start-actions")).toBe(true);
  });

  it("keeps heading, intro, manager picker and rating in the left column", async () => {
    await renderModes();
    const info = container.querySelector(".start-modes-info")!;
    expect(info.querySelector("h1")?.textContent).toContain("Back to work");
    expect(info.querySelector(".start-subtitle")).not.toBeNull();
    expect(info.querySelector(".portrait-picker")).not.toBeNull();
    expect(info.querySelector(".portrait-label")?.textContent).toContain("Your manager");
    // Nothing that belongs on the left leaks into the action column.
    const actions = container.querySelector(".start-actions")!;
    expect(actions.querySelector("h1")).toBeNull();
    expect(actions.querySelector(".portrait-picker")).toBeNull();
  });

  it("lists every primary action on the right, matchmaking preferences beside their button", async () => {
    await renderModes();
    const labels = buttonLabels(container.querySelector(".start-actions")!);
    for (const action of [
      "Story Mode",
      "Play vs AI",
      "Host a game",
      "Join with a code",
      "Auto Matchmaking",
      "The ladder",
      "Back to the menu",
    ]) {
      expect(labels.some((l) => l.startsWith(action)), `missing action: ${action}`).toBe(true);
    }
    // The Any/Similar rank options ride with Auto Matchmaking, directly after it.
    const autoIdx = labels.findIndex((l) => l.startsWith("Auto Matchmaking"));
    expect(labels[autoIdx + 1]).toMatch(/^Any rank/);
    expect(labels[autoIdx + 2]).toMatch(/^Similar rank/);
    const search = container.querySelector(".start-actions .rank-search")!;
    expect(search.getAttribute("role")).toBe("radiogroup");
  });

  it("tabs through the manager picker before the mode buttons", async () => {
    await renderModes();
    const order = buttonLabels(container.querySelector("main[aria-label=\"Hexmatch start screen\"]")!);
    const lastPortrait = Math.max(
      order.findIndex((l) => l.includes("Anne Hextall")),
      order.findIndex((l) => l.includes("James Hextall")),
    );
    const firstAction = order.findIndex((l) => l.startsWith("Story Mode"));
    expect(lastPortrait).toBeGreaterThanOrEqual(0);
    expect(firstAction).toBeGreaterThan(lastPortrait);
  });

  it("stylesheet: a wider grid card with two balanced columns", () => {
    const css = stylesCss();
    const rule = css.match(/\.start-panel\.start-modes\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rule).not.toBe("");
    expect(rule).toMatch(/width:\s*min\(980px,\s*100%\)/);
    expect(rule).toMatch(/display:\s*grid/);
    expect(rule).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    // The fix is seating, not squeezing: no transform scaling, no clipping,
    // no fixed height that could hide an action.
    expect(rule).not.toMatch(/transform\s*:/);
    expect(rule).not.toMatch(/overflow\s*:/);
    expect(rule).not.toMatch(/(^|[;{])\s*height\s*:/);
  });

  it("stylesheet: shorter desktop windows compact the card, narrow screens stack it", () => {
    const css = stylesCss();
    // Height-aware compaction for the RUN wrapper's shorter iframe.
    expect(css).toMatch(/@media\s*\(min-width:\s*761px\)\s*and\s*\(max-height:\s*800px\)/);
    expect(css).toMatch(/@media\s*\(min-width:\s*761px\)\s*and\s*\(max-height:\s*680px\)/);
    // The phone keeps the single column it already had: a later
    // max-width: 760px block re-declares the card with one column. (Matched
    // by the rule's own first declaration — the sheet holds several
    // max-width: 760px blocks, so anchoring on the media query alone would
    // catch an earlier, unrelated one.)
    expect(css).toMatch(/\.start-panel\.start-modes\s*\{\s*grid-template-columns:\s*1fr;/);
  });
});
