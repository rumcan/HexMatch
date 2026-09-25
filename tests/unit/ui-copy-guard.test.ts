// @vitest-environment jsdom
//
// #383 — player-facing copy must not carry developer comments.
//
// A note written inside the difficulty card's innerHTML template was painted
// on the picker ("// L6 (#220)…"). This guard fails if that comes back, in
// the preset strings, the rendered picker, the top-bar selector, the How to
// Play pages, or the settings sheet.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { radio } from "../../src/audio/radio";
import { sfx } from "../../src/audio/sfx";
import { Board } from "../../src/game/board";
import { mulberry32, setRng } from "../../src/game/config";
import { createOriginalUi, type UiHooks } from "../../src/game/ui";
import { voice } from "../../src/game/voice";
import { DEFAULT_SETTINGS, setGraphics } from "../../src/iso/graphics";
import { emptyBag } from "../../src/iso/purse";
import { showBattleHowto } from "../../src/iso/battle-howto";
import { VICTORY } from "../../src/iso/config";
import { showSettingsSheet } from "../../src/iso/settings-sheet";
import { RIVAL_SKILLS, SKILL_KEYS } from "../../src/iso/skill";
import { promptForRivalSkill } from "../../src/iso/skill-picker";
import {
  buildTutorialSteps, showTutorial, type TutorialStep,
} from "../../src/iso/tutorial";

/** The three shapes the ticket forbids in anything a player can read. */
const FORBIDDEN: { name: string; test: (text: string) => string | null }[] = [
  { name: "//", test: (text) => (text.includes("//") ? "//" : null) },
  { name: "(#", test: (text) => (text.includes("(#") ? "(#" : null) },
  {
    name: "L<n> (",
    test: (text) => text.match(/\bL\d+\s*\(/)?.[0] ?? null,
  },
];

type Sample = { where: string; text: string };

function leaksIn(samples: Sample[]): string[] {
  const hits: string[] = [];
  for (const { where, text } of samples) {
    const found = FORBIDDEN.flatMap(({ test }) => {
      const hit = test(text);
      return hit ? [hit] : [];
    });
    if (found.length === 0) continue;
    const clip = text.replace(/\s+/g, " ").trim().slice(0, 220);
    hits.push(`${where} [${found.join(", ")}]: ${clip}`);
  }
  return hits;
}

function assertClean(samples: Sample[]): void {
  expect(leaksIn(samples), "developer comment leaked into player-facing copy").toEqual([]);
}

/** textContent plus the attributes a player actually reads (tooltip, name, alt). */
function faceOf(where: string, root: ParentNode): Sample[] {
  const samples: Sample[] = [];
  if (root instanceof Element) samples.push({ where: `${where} text`, text: root.textContent ?? "" });
  for (const node of root.querySelectorAll<HTMLElement>("[title], [aria-label], img[alt]")) {
    const title = node.getAttribute("title");
    const label = node.getAttribute("aria-label");
    const alt = node.getAttribute("alt");
    const id = node.id || node.getAttribute("data-skill") || node.getAttribute("data-act") || node.tagName;
    if (title) samples.push({ where: `${where} ${id} title`, text: title });
    if (label) samples.push({ where: `${where} ${id} aria-label`, text: label });
    if (alt) samples.push({ where: `${where} ${id} alt`, text: alt });
  }
  return samples;
}

function stepCopy(where: string, steps: TutorialStep[]): Sample[] {
  const samples: Sample[] = [];
  for (const step of steps) {
    const bits = [step.kicker, step.title, step.lede, step.tip, ...step.points];
    const fig = step.figure;
    bits.push(fig.caption);
    if (fig.kind === "chain") bits.push(...fig.nodes.map((n) => `${n.icon} ${n.label}`));
    else if (fig.kind === "shot") bits.push(fig.alt);
    else if (fig.kind === "ledger") bits.push(...fig.rows.map((r) => `${r.icon} ${r.label} ${r.vp}`));
    bits.forEach((text, i) => samples.push({ where: `${where} ${step.id}#${i}`, text }));
  }
  return samples;
}

/** Walk every card the projector paints, including tooltips on the page. */
function renderedPages(
  where: string,
  open: () => { el: HTMLElement; destroy: () => void } | null,
): Sample[] {
  const handle = open();
  expect(handle, `${where} did not open`).not.toBeNull();
  const samples: Sample[] = [];
  for (let i = 0; i < 16; i++) {
    const step = handle!.el.dataset.step ?? String(i);
    samples.push(...faceOf(`${where} [${step}]`, handle!.el));
    const next = handle!.el.querySelector<HTMLButtonElement>("[data-act='tut-next'], [data-act='tut-done']");
    expect(next, `${where} [${step}] has no Next`).toBeTruthy();
    if (next!.dataset.act === "tut-done") break;
    next!.click();
  }
  handle!.destroy();
  return samples;
}

const emptyStore = { getItem: () => null };

/** `coarsePointer()` reads matchMedia. jsdom reports a mouse, so the phone
 *  sentences of How to Play never paint unless this stands in. */
function withCoarse<T>(on: boolean, fn: () => T): T {
  const prev = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: on && query.includes("pointer: coarse"),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  })) as typeof window.matchMedia;
  try { return fn(); } finally { window.matchMedia = prev; }
}

let host: HTMLDivElement;

function mountHost(): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  return host;
}

afterEach(() => {
  document.body.innerHTML = "";
  // The settings case toggles live singletons. Put the shipped defaults back
  // before the next file in the worker reads them.
  setGraphics(DEFAULT_SETTINGS);
  sfx.setEnabled(true);
  radio.setEnabled(true);
  radio.setShow(true);
  radio.setVolume(0.5);
  voice.detach();
  localStorage.clear();
});

describe("#383 difficulty copy has no developer comments", () => {
  it("keeps ticket notes out of every preset string", () => {
    const samples: Sample[] = [];
    for (const key of SKILL_KEYS) {
      const preset = RIVAL_SKILLS[key];
      samples.push(
        { where: `${key} label`, text: preset.label },
        { where: `${key} blurb`, text: preset.blurb },
        { where: `${key} economyLine`, text: preset.economyLine },
      );
      expect(preset.label.length, key).toBeGreaterThan(0);
      expect(preset.blurb.length, key).toBeGreaterThan(0);
      expect(preset.economyLine.length, key).toBeGreaterThan(0);
    }
    assertClean(samples);
  });

  it("keeps them out of the rendered start-of-game picker", async () => {
    mountHost();
    const pending = promptForRivalSkill(host, {
      search: "",
      storage: emptyStore,
      onPick: () => {},
    });
    const overlay = host.querySelector("#iso-skill-prompt");
    expect(overlay).toBeTruthy();
    const samples = faceOf("picker", overlay!);
    for (const key of SKILL_KEYS) {
      const btn = overlay!.querySelector<HTMLElement>(`[data-skill="${key}"]`);
      expect(btn, key).toBeTruthy();
      const text = btn!.textContent ?? "";
      // The card must still say the real sentences — an empty button is not a pass.
      expect(text).toContain(RIVAL_SKILLS[key].label);
      expect(text).toContain(RIVAL_SKILLS[key].blurb);
      expect(text).toContain(RIVAL_SKILLS[key].economyLine);
      samples.push({ where: `picker ${key}`, text });
    }
    assertClean(samples);
    (overlay!.querySelector("[data-skill='normal']") as HTMLElement).click();
    await expect(pending).resolves.toBe("normal");
  });

  it("keeps them out of the top-bar option text and title", () => {
    setRng(mulberry32(1));
    mountHost();
    const board = new Board();
    const hooks: UiHooks = {
      onTool: () => {},
      onRailAction: () => {},
      onRecenter: () => {},
      onSwap: () => {},
      onReset: () => {},
      onBank: () => "done",
      onBlackAction: () => {},
      onSkill: () => {},
      skill: "normal",
    };
    const ui = createOriginalUi(board, { id: "you", name: "You", res: emptyBag(), unlocked: null }, hooks);
    host.appendChild(ui.el);
    const sel = ui.el.querySelector<HTMLSelectElement>("#iso-rival-skill");
    expect(sel).toBeTruthy();
    const samples: Sample[] = [
      { where: "selector title", text: sel!.title },
      ...faceOf("selector", sel!),
    ];
    for (const key of SKILL_KEYS) {
      const opt = sel!.querySelector<HTMLOptionElement>(`option[value="${key}"]`);
      expect(opt, key).toBeTruthy();
      expect(opt!.text).toBe(`Difficulty: ${RIVAL_SKILLS[key].label}`);
      expect(opt!.title).toContain(RIVAL_SKILLS[key].economyLine);
      samples.push(
        { where: `option ${key} text`, text: opt!.text },
        { where: `option ${key} title`, text: opt!.title },
      );
    }
    assertClean(samples);

    // The in-game How to Play door is this reference card (☰ → How to Play).
    ui.showHelp();
    const modal = ui.el.querySelector(".modal.box");
    expect(modal, "How to Play reference card").toBeTruthy();
    const help = faceOf("help modal", modal!);
    withCoarse(true, () => {
      ui.showHelp();
      const touch = ui.el.querySelector(".modal.box");
      expect(touch?.textContent).toContain("Playing by touch");
      help.push(...faceOf("help modal touch", touch!));
    });
    assertClean(help);
  });

  it("keeps them out of the difficulty-switch toast template", () => {
    // The toast is built inside startIsoGame, which these tests do not boot.
    // The template itself is the player-facing string: a comment between the
    // backticks would be spoken the same way the picker used to paint one.
    const src = readFileSync("src/iso/game.ts", "utf8");
    const toast = src.match(/toast\(`Difficulty:[^`]*`/);
    expect(toast, "difficulty toast template moved — re-pin the guard").not.toBeNull();
    assertClean([{ where: "difficulty toast", text: toast![0] }]);
    expect(toast![0]).toContain("${skill().label}");
    expect(toast![0]).toContain("${skill().economyLine}");
  });
});

describe("#383 How to Play and settings copy", () => {
  const ctx = { vpTarget: VICTORY.loop.target, freeTrack: 12 };

  it("keeps them out of every How to Play card, including the battle pages", () => {
    mountHost();
    const touch = withCoarse(true, () => stepCopy("tour touch", buildTutorialSteps(ctx)));
    expect(touch.some((s) => s.text.includes("One finger")), "phone tour branch did not render").toBe(true);
    const samples = [
      ...stepCopy("tour", buildTutorialSteps(ctx)),
      ...stepCopy("tour old loop", buildTutorialSteps({ ...ctx, newLoop: false })),
      ...touch,
      ...renderedPages("tour", () => showTutorial(host, { force: true, ...ctx })),
      ...renderedPages("battles", () => showBattleHowto({ mount: host })),
    ];
    expect(samples.length).toBeGreaterThan(20);
    assertClean(samples);
  });

  it("keeps them out of the settings sheet, including the notes that swap in", () => {
    mountHost();
    const sheet = showSettingsSheet(host);
    const samples = faceOf("settings", sheet.el);
    const click = (sel: string) => {
      const btn = sheet.el.querySelector<HTMLButtonElement>(sel);
      expect(btn, sel).toBeTruthy();
      btn!.click();
      samples.push(...faceOf(`settings after ${sel}`, sheet.el));
    };
    // Alternate sentences: performance suppresses miniature, Sound off holds
    // voice, Radio off explains the stopped stream.
    click("[data-gfx='performance']");
    click("[data-gfx='sound']");
    click("[data-gfx='radio']");
    expect(samples.some((s) => /Unavailable while Performance mode/.test(s.text))).toBe(true);
    assertClean(samples);
    sheet.destroy();
  });
});
