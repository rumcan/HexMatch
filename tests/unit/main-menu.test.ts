// @vitest-environment jsdom
//
// STORY-01 — the front door: Play / Settings / How to Play.
//
// The menu is chrome, not game, so the tests hold it to chrome promises:
// Play leaves for the mode screen, Settings raises the REAL GFX-01 sheet —
// the same projector the in-game ☰ menu opens, writing quality and miniature
// through the store so a player can dress the island before a single hex is
// claimed — and How to Play raises the REAL TUT-01 tour even for a player
// who dismissed it at boot (force: true), because asking for the rules by
// name is not "first visit".
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MainMenu from "../../src/ui/MainMenu";
import { SAVEGAME_VERSION, saveKeyFor } from "../../src/iso/savegame-runtime";
import { SNAPSHOT_VERSION } from "../../src/iso/snapshot";
import type { SaveGamePayload } from "../../src/iso/savegame-runtime";

/** CONTINUE-01 (#191): a minimal but valid solo save in the named slot. */
function writeSave(key: string, over: Partial<SaveGamePayload> = {}): void {
  const payload: SaveGamePayload = {
    v: SAVEGAME_VERSION,
    snapV: SNAPSHOT_VERSION,
    savedAt: Date.now() - 2 * 3600_000,
    seed: 1337,
    skillKey: "normal",
    phase: "play",
    winnerId: null,
    bandit: {},
    track: { dirt: "", road: "", owner: "", upgraded: "" },
    eco: { harvesters: [], factories: [] },
    players: [],
    boards: [],
    clocks: {},
    ...over,
  };
  localStorage.setItem(key, JSON.stringify(payload));
}

let host: HTMLDivElement;
let root: Root;

function mount(onPlay = vi.fn(), onContinue?: ReturnType<typeof vi.fn>) {
  act(() => {
    root.render(createElement(MainMenu, { onPlay, onContinue }));
  });
  return { onPlay, onContinue };
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
    const { onPlay } = mount();
    act(() => { button(/^Play/).click(); });
    expect(onPlay).toHaveBeenCalledTimes(1);
    // the menu never mounts a game — no canvas, no iso root
    expect(document.querySelector("#iso-root")).toBeNull();
  });

  it("Settings raises the real GFX-01 sheet and writes through the store", async () => {
    const { onPlay } = mount();
    expect(document.querySelector(".settings-sheet")).toBeNull();
    act(() => { button(/^Settings/).click(); });
    const sheet = document.querySelector(".settings-sheet");
    expect(sheet).not.toBeNull();
    // the front door opened the sheet, it did not leave the menu
    expect(onPlay).not.toHaveBeenCalled();
    expect(sheet!.querySelector(".modal.box[aria-label=\"Settings\"]")).not.toBeNull();

    // three-way quality segment + the miniature switch + sound, live-painted
    const seg = [...sheet!.querySelectorAll(".gfx-seg button")].map((b) => b.textContent);
    expect(seg).toEqual(["Low", "Medium", "High"]);
    const quality = (q: string) => [...sheet!.querySelectorAll(".gfx-seg button")]
      .find((b) => b.textContent === q) as HTMLButtonElement;
    act(() => { quality("Medium").click(); });
    expect(JSON.parse(localStorage.getItem("hexmatch:graphics")!))
      .toMatchObject({ quality: "medium" });
    expect(quality("Medium").classList.contains("on")).toBe(true);
    const mini = sheet!.querySelector("[data-gfx=\"miniature\"]") as HTMLButtonElement;
    expect(mini.textContent).toBe("OFF");
    act(() => { mini.click(); });
    expect(JSON.parse(localStorage.getItem("hexmatch:graphics")!))
      .toMatchObject({ miniature: true });
    expect(mini.textContent).toBe("ON");

    // Done closes the sheet and unmounts it; a reopened sheet paints from the
    // store, so the door and a later match can never disagree.
    act(() => { (sheet!.querySelector(".big-btn") as HTMLButtonElement).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector(".settings-sheet")).toBeNull();
    act(() => { button(/^Settings/).click(); });
    const again = document.querySelector(".settings-sheet")!;
    expect(again.querySelector("[data-gfx=\"miniature\"]")!.textContent).toBe("ON");
    expect([...again.querySelectorAll(".gfx-seg button.on")].map((b) => b.textContent)).toEqual(["Medium"]);
    act(() => { (again.querySelector("[data-gfx-close].modal-back") as HTMLElement).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector(".settings-sheet")).toBeNull();
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

// CONTINUE-01 (#191): the gold door resumes; Play beneath it starts new.
describe("MainMenu — Continue (#191)", () => {
  it("offers no Continue door on a fresh machine and keeps Play gold", () => {
    mount();
    expect([...host.querySelectorAll("button")].some((b) => /^Continue/.test((b.textContent ?? "").trim()))).toBe(false);
    const play = button(/^Play/);
    expect(play.classList.contains("primary")).toBe(true);
  });

  it("names a resumable sandbox save and resumes it from the gold door", () => {
    writeSave(saveKeyFor(null), { skillKey: "hard" });
    const onContinue = vi.fn();
    const { onPlay } = mount(vi.fn(), onContinue);
    const cont = button(/^Continue/);
    expect(cont.classList.contains("primary")).toBe(true);
    expect(cont.textContent).toMatch(/vs AI \(Hard\)/);
    expect(cont.textContent).toMatch(/saved 2 h ago/);
    // Play stays on the menu but is no longer the gold door
    expect(button(/^Play/).classList.contains("primary")).toBe(false);
    expect(button(/^Play/).textContent).toMatch(/start a new game/i);
    act(() => { cont.click(); });
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledWith(null);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("continues the freshest slot and names a contract for a story save", () => {
    // an older sandbox slot…
    writeSave(saveKeyFor(null), { savedAt: Date.now() - 5 * 3600_000 });
    // …loses the door to a newer contract slot
    writeSave(saveKeyFor("black-gold"), {
      savedAt: Date.now() - 10 * 60_000,
      skillKey: "normal",
    });
    const onContinue = vi.fn();
    mount(vi.fn(), onContinue);
    const cont = button(/^Continue/);
    expect(cont.textContent).toMatch(/Black Gold/);
    expect(cont.textContent).toMatch(/saved 10 min ago/);
    act(() => { cont.click(); });
    expect(onContinue).toHaveBeenCalledWith("black-gold");
  });

  it("stays quiet about saves when no onContinue handler is supplied", () => {
    writeSave(saveKeyFor(null));
    mount();
    expect([...host.querySelectorAll("button")].some((b) => /^Continue/.test((b.textContent ?? "").trim()))).toBe(false);
  });
});
