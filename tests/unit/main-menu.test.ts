// @vitest-environment jsdom
//
// STORY-01 — the front door: Play / Settings / How to Play.
//
// The menu is chrome, not game, so the tests hold it to chrome promises:
// Play leaves for the mode screen, Settings says out loud that it is being
// furnished (SETTINGS-01 owns the real room — this button must never die
// silently), and How to Play raises the REAL TUT-01 tour even for a player
// who dismissed it at boot (force: true), because asking for the rules by
// name is not "first visit".
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MainMenu from "../../src/ui/MainMenu";

let host: HTMLDivElement;
let root: Root;

function mount(onPlay = vi.fn()) {
  act(() => { root.render(createElement(MainMenu, { onPlay })); });
  return onPlay;
}

function button(name: RegExp): HTMLButtonElement {
  const btn = [...host.querySelectorAll("button")]
    .find((b) => name.test((b.textContent ?? "").trim()));
  if (!btn) throw new Error(`no button matching ${name}`);
  return btn as HTMLButtonElement;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  localStorage.clear();
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
});

describe("MainMenu — the front door", () => {
  it("stands three doors on the living plate", () => {
    mount();
    const screen = host.querySelector(".start-screen.menu");
    expect(screen).not.toBeNull();
    expect(host.querySelector(".menu-embers")).not.toBeNull();
    for (const door of [/^Play/, /^Settings/, /^How to Play/]) {
      expect(button(door)).toBeTruthy();
    }
    // a first visit has filed nothing and seen no reel
    expect(host.querySelector(".menu-campaign")!.textContent)
      .toMatch(/no contracts filed/i);
  });

  it("Play leaves for the mode screen", () => {
    const onPlay = mount();
    act(() => { button(/^Play/).click(); });
    expect(onPlay).toHaveBeenCalledTimes(1);
    // the menu never mounts a game — no canvas, no iso root
    expect(document.querySelector("#iso-root")).toBeNull();
  });

  it("Settings says so instead of dying silently", () => {
    const onPlay = mount();
    expect(host.querySelector(".menu-note")).toBeNull();
    act(() => { button(/^Settings/).click(); });
    const note = host.querySelector(".menu-note");
    expect(note).not.toBeNull();
    expect(note!.textContent).toMatch(/settings/i);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("How to Play raises the real tour, even after a boot dismissal", async () => {
    // the player already said "never show this again" at boot…
    localStorage.setItem("hexmatch:tutorial", "never");
    mount();
    act(() => { button(/^How to Play/).click(); });
    await Promise.resolve();
    // …and still gets the eight cards when they ask by name (force: true)
    expect(document.querySelector("#iso-tutorial")).not.toBeNull();
    const host2 = document.querySelector(".menu-howto");
    expect(host2).not.toBeNull();
    expect(host2!.contains(document.querySelector("#iso-tutorial"))).toBe(true);
  });

  it("reports filed contracts from saved campaign progress", () => {
    localStorage.setItem("hexmatch:story", JSON.stringify({
      unlocked: 2,
      introSeen: true,
      results: { inheritance: "win" },
    }));
    mount();
    expect(host.querySelector(".menu-campaign")!.textContent)
      .toMatch(/1 of 5 contracts filed/i);
  });
});
