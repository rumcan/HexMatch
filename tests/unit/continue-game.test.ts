// @vitest-environment jsdom
//
// CONTINUE-01 (#191) — the mode-screen and campaign doors:
//
//   · a resumable sandbox save promotes Continue to the gold door; clicking
//     it boots the ai mode WITHOUT touching the slot;
//   · Play vs AI now means a NEW game: with a save present it asks on a
//     painted plate, and only the confirm button clears the slot (and the
//     difficulty pick) before booting; cancel keeps everything;
//   · a contract with a save is a Continue card (the card resumes), and its
//     "Start over" door asks before clearing just that contract's slot.
//
// transport is mocked exactly as in start-screen.test.ts — none of these
// paths touch the wire, but the module imports it at load time.
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
import { SAVE_KEY, SAVEGAME_VERSION, saveKeyFor } from "../../src/iso/savegame-runtime";
import { SNAPSHOT_VERSION } from "../../src/iso/snapshot";
import type { SaveGamePayload } from "../../src/iso/savegame-runtime";
import { SKILL_STORAGE_KEY } from "../../src/iso/skill";

function writeSave(key: string, over: Partial<SaveGamePayload> = {}): void {
  const payload: SaveGamePayload = {
    v: SAVEGAME_VERSION,
    snapV: SNAPSHOT_VERSION,
    savedAt: over.savedAt ?? Date.now() - 60_000,
    seed: 1337,
    skillKey: over.skillKey ?? "normal",
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

const buttons = () => [...container.querySelectorAll("button")];
const findButton = (re: RegExp): HTMLButtonElement => {
  const b = buttons().find((x) => re.test((x.textContent ?? "").trim()));
  if (!b) throw new Error(`no button ${re} — have: ${buttons().map((x) => x.textContent).join(" | ")}`);
  return b as HTMLButtonElement;
};
const click = async (b: HTMLButtonElement) => { await act(async () => { b.click(); }); };
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const confirmPlate = () => document.querySelector(".confirm-sheet");
const confirmOk = () => document.querySelector("[data-confirm-ok]") as HTMLButtonElement;
const confirmCancel = () => document.querySelector("[data-confirm-cancel].big-btn") as HTMLButtonElement;

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

describe("mode screen — Continue vs a new Play vs AI", () => {
  it("boots straight into Play vs AI with no save, with no Continue door", async () => {
    await render();
    expect(buttons().some((b) => /^Continue/.test((b.textContent ?? "").trim()))).toBe(false);
    const play = findButton(/^Play vs AI/);
    expect(play.textContent).toMatch(/no login/);
    await click(play);
    expect(choices).toEqual([{ mode: "ai", portrait: "vex" }]);
    expect(confirmPlate()).toBeNull();
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
  });

  it("Continue resumes the sandbox slot and never clears it", async () => {
    writeSave(SAVE_KEY, { skillKey: "hard", savedAt: Date.now() - 2 * 3600_000 });
    await render();
    const cont = findButton(/^Continue/);
    expect(cont.classList.contains("start-primary")).toBe(true);
    expect(cont.textContent).toMatch(/vs AI \(Hard\)/);
    expect(cont.textContent).toMatch(/0★ vs 0★/);
    expect(cont.textContent).toMatch(/saved 2 h ago/);
    // the door beneath now reads as the NEW-game path
    expect(findButton(/^Play vs AI/).textContent).toMatch(/start a new game/);
    const rawBefore = localStorage.getItem(SAVE_KEY);
    await click(cont);
    expect(choices).toEqual([{ mode: "ai", portrait: "vex" }]);
    expect(localStorage.getItem(SAVE_KEY)).toBe(rawBefore);
  });

  it("Play vs AI asks before clearing the old match; cancel keeps the save", async () => {
    writeSave(SAVE_KEY);
    await render();
    await click(findButton(/^Play vs AI/));
    // the painted ask stands, no boot yet
    const plate = confirmPlate();
    expect(plate).not.toBeNull();
    expect(plate!.textContent).toMatch(/start a new game/i);
    expect(choices).toEqual([]);
    await click(confirmCancel());
    expect(confirmPlate()).toBeNull();
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull();
    expect(choices).toEqual([]);
  });

  it("confirming the ask clears slot AND difficulty pick, then boots new", async () => {
    writeSave(SAVE_KEY);
    localStorage.setItem(SKILL_STORAGE_KEY, "hard");
    await render();
    await click(findButton(/^Play vs AI/));
    await click(confirmOk());
    await flush();
    expect(choices).toEqual([{ mode: "ai", portrait: "vex" }]);
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    expect(localStorage.getItem(SKILL_STORAGE_KEY)).toBeNull();
  });

  it("only offers Continue while the save is inside the freshness window", async () => {
    // eight days old: older than the boot's own week window — no door
    writeSave(SAVE_KEY, { savedAt: Date.now() - 8 * 24 * 3600_000 });
    await render();
    expect(buttons().some((b) => /^Continue/.test((b.textContent ?? "").trim()))).toBe(false);
    expect(findButton(/^Play vs AI/).textContent).toMatch(/no login/);
  });
});

describe("campaign screen — Continue cards and Start over", () => {
  async function openCampaign(): Promise<void> {
    await render();
    await click(findButton(/^Story Mode/));
  }

  it("shows a Continue ribbon on the contract with a save and resumes it from the card", async () => {
    writeSave(saveKeyFor("inheritance"), { savedAt: Date.now() - 5 * 60_000 });
    await openCampaign();
    const card = container.querySelector(".chapter-card") as HTMLElement;
    expect(card.classList.contains("has-save")).toBe(true);
    const ribbon = card.querySelector(".cc-continue");
    expect(ribbon?.textContent).toMatch(/Continue/);
    expect(ribbon?.textContent).toMatch(/saved 5 min ago/);
    // the restart door is the card's sibling (a button cannot hold a button)
    expect(container.querySelector(".chapter-item .cc-restart")).not.toBeNull();
    const rawBefore = localStorage.getItem(saveKeyFor("inheritance"));
    await click(card as HTMLButtonElement);
    expect(choices).toEqual([{ mode: "story", chapter: "inheritance", portrait: "vex" }]);
    expect(localStorage.getItem(saveKeyFor("inheritance"))).toBe(rawBefore);
  });

  it("Start over asks first; cancel keeps the contract save", async () => {
    writeSave(saveKeyFor("inheritance"));
    localStorage.setItem(SKILL_STORAGE_KEY, "hard");
    await openCampaign();
    await click(container.querySelector(".cc-restart") as HTMLButtonElement);
    expect(confirmPlate()?.textContent).toMatch(/Start "First Day on the Job" over\?/);
    await click(confirmCancel());
    expect(localStorage.getItem(saveKeyFor("inheritance"))).not.toBeNull();
    expect(choices).toEqual([]);
  });

  it("Start over confirm clears only that contract's slot and boots the contract", async () => {
    writeSave(saveKeyFor("inheritance"));
    writeSave(saveKeyFor("black-gold"), { savedAt: Date.now() - 30_000 });
    localStorage.setItem(SKILL_STORAGE_KEY, "hard");
    await openCampaign();
    // the restart belongs to the first (open) contract card
    await click(container.querySelector(".cc-restart") as HTMLButtonElement);
    await click(confirmOk());
    await flush();
    expect(choices).toEqual([{ mode: "story", chapter: "inheritance", portrait: "vex" }]);
    expect(localStorage.getItem(saveKeyFor("inheritance"))).toBeNull();
    // the other contract and the difficulty pick are untouched
    expect(localStorage.getItem(saveKeyFor("black-gold"))).not.toBeNull();
    expect(localStorage.getItem(SKILL_STORAGE_KEY)).toBe("hard");
  });

  it("renders no Continue affordance on a fresh contract", async () => {
    await openCampaign();
    const card = container.querySelector(".chapter-card") as HTMLElement;
    expect(card.classList.contains("has-save")).toBe(false);
    expect(card.querySelector(".cc-continue")).toBeNull();
    expect(card.querySelector(".cc-restart")).toBeNull();
  });
});
