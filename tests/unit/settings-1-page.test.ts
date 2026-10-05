// @vitest-environment jsdom
//
// SETTINGS-1 (#701) — the New Game page, driven through the real StartScreen:
// the Play card's "Game settings" door opens it, the choices start the game
// with them, Back keeps them, Reset returns today's game. (The harness is
// continue-game.test.ts's.)
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import StartScreen, { type StartChoice } from "../../src/ui/StartScreen";
import { SKILL_STORAGE_KEY } from "../../src/iso/skill";
import { NEW_GAME_SETTINGS_KEY } from "../../src/ui/new-game-settings";

let container: HTMLDivElement;
let root: Root;
let choices: StartChoice[];

async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(StartScreen, {
      onStart: (c: StartChoice) => choices.push(c),
      onBack: () => undefined,
    }));
  });
}
const byTest = (id: string) => {
  const el = container.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;
  if (!el) throw new Error(`no [data-testid=${id}]`);
  return el;
};
const findButton = (re: RegExp): HTMLButtonElement => {
  const b = [...container.querySelectorAll("button")].find((x) => re.test((x.textContent ?? "").trim()));
  if (!b) throw new Error(`no button ${re}`);
  return b as HTMLButtonElement;
};
const click = async (b: HTMLElement) => { await act(async () => { b.click(); }); };

beforeEach(() => {
  localStorage.clear();
  choices = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe("SETTINGS-1: the New Game page", () => {
  it("the Play card says what a new game is and opens the page", async () => {
    await render();
    expect(byTest("ng-summary").textContent).toMatch(/Normal rival · first to \d+★/);
    await click(findButton(/^Game settings/));
    expect(container.querySelector(".ng-page h1")?.textContent).toBe("Game settings");
    // every dial of the ticket is on the page
    for (const name of ["Rival difficulty", "Map size", "Town style", "Towns", "Win target", "Starting money", "Map features", "Map seed", "Graphics"]) {
      expect(container.querySelector(`.ng-page [role=group][aria-label="${name}"]`), name).not.toBeNull();
    }
  });

  it("Start game boots a new game with the page's choices and remembers them", async () => {
    await render();
    await click(findButton(/^Game settings/));
    await click(byTest("ng-skill-hard"));
    await click(byTest("ng-towns-5"));
    await click(byTest("ng-win-18"));
    await click(byTest("ng-money-high"));
    await click(byTest("ng-flag-rivers"));
    await click(byTest("ng-start"));
    expect(choices).toHaveLength(1);
    const c = choices[0] as Extract<StartChoice, { mode: "ai" }>;
    expect(c.mode).toBe("ai");
    expect(c.boot).toMatchObject({ townCount: 5, winVp: 18, moneyScale: 2, rivers: false });
    expect(localStorage.getItem(SKILL_STORAGE_KEY)).toBe("hard");
    expect(JSON.parse(localStorage.getItem(NEW_GAME_SETTINGS_KEY)!)).toMatchObject({ towns: 5, winVp: 18, money: "high", rivers: false });
    // back on the Play card, the summary names the new game
    expect(byTest("ng-summary").textContent).toMatch(/Hard rival · first to 18★ · 5 towns · High money/);
  });

  it("Back keeps the choices without starting; Reset returns today's game", async () => {
    await render();
    await click(findButton(/^Game settings/));
    await click(byTest("ng-towns-3"));
    await click(byTest("ng-back"));
    expect(choices).toEqual([]);
    expect(byTest("ng-summary").textContent).toMatch(/3 towns/);
    // the difficulty was not touched, so AI-02's first-game picker still runs
    expect(localStorage.getItem(SKILL_STORAGE_KEY)).toBeNull();
    await click(findButton(/^Game settings/));
    await click(byTest("ng-reset"));
    await click(byTest("ng-back"));
    expect(byTest("ng-summary").textContent).not.toMatch(/\d towns/);
    // a default Play vs AI sends no `boot` at all
    await click(findButton(/^Play vs AI/));
    expect((choices[0] as { boot?: unknown }).boot).toBeUndefined();
  });

  it("a fixed seed is offered and sent; Random clears it", async () => {
    localStorage.setItem("hexmatch:last-seed", "777");
    await render();
    await click(findButton(/^Game settings/));
    await click(byTest("ng-seed-last"));
    expect(byTest("ng-page-summary").textContent).toMatch(/seed 777/);
    await click(byTest("ng-seed-random"));
    expect(byTest("ng-page-summary").textContent).not.toMatch(/seed/);
    await click(byTest("ng-seed-last"));
    await click(byTest("ng-start"));
    expect((choices[0] as { boot?: { seed?: number } }).boot?.seed).toBe(777);
  });
});
