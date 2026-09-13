// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// #122 — Story Mode contract status badge overlaps heading text.
//
// The regression: `.cc-seal` / `.cc-lock` were absolutely positioned siblings
// of `.cc-body`, so at narrow card widths the "Filed · lost" badge painted
// over the "Contract I · Blackwood Freight" kicker. The fix puts the badge
// in a wrapping header row (`.cc-head`) in normal flow inside `.cc-body`,
// so heading, badge, portrait and description occupy separate readable space
// at every card width.
//
// jsdom has no layout engine, so this pins the structure (badge inside the
// header row, never a direct absolutely-positioned child of the card) and the
// stylesheet rules (no absolute positioning, wrapping header, natural wrap).
// The real pixel overlap check lives in tests/e2e/story.spec.ts.
// ══════════════════════════════════════════════════════════════════════════
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
import { STORY_STORAGE_KEY } from "../../src/story/progress";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stylesCss = () =>
  fs.readFileSync(path.resolve(__dirname, "../../src/game/styles.css"), "utf8");

let container: HTMLDivElement;
let root: Root;

async function renderStory(): Promise<void> {
  await act(async () => {
    root.render(createElement(StartScreen, { onStart: () => {}, initial: "story" }));
  });
}

const cards = () => [...container.querySelectorAll(".chapter-card")];

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
  localStorage.clear();
  vi.clearAllMocks();
});

describe("#122 contract status badge layout", () => {
  it("puts won/lost seals in a header row in normal flow, not over the kicker", async () => {
    localStorage.setItem(STORY_STORAGE_KEY, JSON.stringify({
      unlocked: 5,
      results: { inheritance: "loss", "toll-king": "win" },
      introSeen: true,
      advisor: true,
    }));
    await renderStory();
    expect(cards()).toHaveLength(5);

    // The reported state: The Inheritance with a loss.
    const inheritance = cards()[0];
    const lossSeal = inheritance.querySelector(".cc-seal.loss");
    expect(lossSeal?.textContent).toBe("Filed · lost");
    // In flow: seal lives in .cc-head inside .cc-body…
    expect(lossSeal?.closest(".cc-head")).not.toBeNull();
    expect(lossSeal?.closest(".cc-body")).not.toBeNull();
    // …beside the kicker, never as a direct child of the card…
    expect(lossSeal?.parentElement?.classList.contains("chapter-card")).toBe(false);
    expect(inheritance.querySelector(":scope > .cc-seal")).toBeNull();
    expect(inheritance.querySelector(":scope > .cc-lock")).toBeNull();
    // …and the kicker shares the same header row.
    const head = inheritance.querySelector(".cc-head");
    expect(head?.querySelector(".cc-kicker")?.textContent).toContain("BLACKWOOD");

    // The won state follows the same layout.
    const tollKing = cards()[1];
    const winSeal = tollKing.querySelector(".cc-seal:not(.loss)");
    expect(winSeal?.textContent).toBe("Filed · won");
    expect(winSeal?.closest(".cc-head")).not.toBeNull();
    expect(tollKing.querySelector(":scope > .cc-seal")).toBeNull();
  });

  it("puts the lock in the same header row on sealed contracts", async () => {
    localStorage.setItem(STORY_STORAGE_KEY, JSON.stringify({
      unlocked: 1,
      results: {},
      introSeen: true,
      advisor: true,
    }));
    await renderStory();
    const locked = [...container.querySelectorAll(".chapter-card.locked")];
    expect(locked).toHaveLength(4);
    for (const card of locked) {
      const lock = card.querySelector(".cc-lock");
      expect(lock).not.toBeNull();
      expect(lock?.closest(".cc-head")).not.toBeNull();
      expect(lock?.closest(".cc-body")).not.toBeNull();
      expect(card.querySelector(":scope > .cc-lock")).toBeNull();
    }
    // Unplayed-but-open cards carry a header row with no badge at all.
    const open = cards()[0];
    expect(open.classList.contains("locked")).toBe(false);
    expect(open.querySelector(".cc-head")).not.toBeNull();
    expect(open.querySelector(".cc-seal")).toBeNull();
    expect(open.querySelector(".cc-lock")).toBeNull();
  });

  it("keeps cards as keyboard-accessible buttons with content-driven height", async () => {
    localStorage.setItem(STORY_STORAGE_KEY, JSON.stringify({
      unlocked: 2,
      results: { inheritance: "loss" },
      introSeen: true,
      advisor: true,
    }));
    await renderStory();
    for (const card of cards()) {
      expect(card.tagName).toBe("BUTTON");
      expect(card.getAttribute("type")).toBe("button");
    }
    // Unlocked cards stay enabled (selectable); sealed ones stay disabled.
    expect((cards()[0] as HTMLButtonElement).disabled).toBe(false);
    expect((cards()[1] as HTMLButtonElement).disabled).toBe(false);
    expect((cards()[2] as HTMLButtonElement).disabled).toBe(true);
    // Portrait and body are siblings; the body grows with its content.
    for (const card of cards()) {
      expect(card.querySelector(".cc-face")).not.toBeNull();
      expect(card.querySelector(".cc-body")).not.toBeNull();
    }
    const css = stylesCss();
    // No fixed height clips the card; content decides how tall it stands.
    const cardRule = css.match(/\.chapter-card\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(cardRule).not.toMatch(/height\s*:/);
    expect(cardRule).not.toMatch(/overflow\s*:\s*hidden/);
  });

  it("stylesheet: badge and lock are in flow, the header wraps, text wraps naturally", () => {
    const css = stylesCss();
    const sealRule = css.match(/\.cc-seal\s*\{[^}]*\}/s)?.[0] ?? "";
    const lockRule = css.match(/\.cc-lock\s*\{[^}]*\}/s)?.[0] ?? "";
    const headRule = css.match(/\.cc-head\s*\{[^}]*\}/s)?.[0] ?? "";
    const kickerRule = css.match(/\.cc-kicker\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(sealRule).not.toBe("");
    expect(lockRule).not.toBe("");
    expect(headRule).not.toBe("");
    // Neither badge nor lock may be absolutely positioned over the heading.
    expect(sealRule).not.toMatch(/position\s*:\s*absolute/);
    expect(lockRule).not.toMatch(/position\s*:\s*absolute/);
    // The header row wraps, so on a narrow card the badge drops below the
    // kicker instead of colliding with it.
    expect(headRule).toMatch(/display\s*:\s*flex/);
    expect(headRule).toMatch(/flex-wrap\s*:\s*wrap/);
    // Text wraps naturally and is never clipped or shrunk to hide a collision.
    expect(kickerRule).toMatch(/overflow-wrap\s*:\s*break-word/);
    for (const sel of ["\\.cc-name", "\\.cc-brief", "\\.cc-meta"]) {
      const rule = css.match(new RegExp(`${sel}\\s*\\{[^}]*\\}`, "s"))?.[0] ?? "";
      expect(rule).not.toBe("");
      expect(rule).toMatch(/overflow-wrap\s*:\s*break-word/);
      expect(rule).not.toMatch(/text-overflow\s*:\s*ellipsis/);
      expect(rule).not.toMatch(/white-space\s*:\s*nowrap/);
    }
  });
});
