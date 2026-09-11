// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// AI-02 — the start-of-game difficulty prompt (src/iso/skill-picker.ts).
//
// Pinned here:
//   * it asks EXACTLY when nothing has chosen yet — a `?rival=` URL or a
//     remembered localStorage choice both skip it (the boot would use them
//     anyway, and re-asking every boot is nag, not onboarding);
//   * all three presets render as cards with label + blurb, and the marked
//     default is the resolver's current key;
//   * a click routes through the hook the game passes (`setRivalSkill`),
//     removes the overlay, and resolves with the picked key.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach } from "vitest";
import {
  promptForRivalSkill, shouldPromptForSkill, rememberSkill,
} from "../../src/iso/skill-picker";
import {
  RIVAL_SKILLS, SKILL_STORAGE_KEY, SKILL_KEYS,
} from "../../src/iso/skill";

const store = (init: Record<string, string> = {}) => ({
  getItem: (k: string) => (k in init ? init[k] : null),
});
let host: HTMLDivElement;

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
});

describe("AI-02 skill prompt gating", () => {
  it("asks when neither URL nor storage has chosen", () => {
    expect(shouldPromptForSkill("", null)).toBe(true);
    expect(shouldPromptForSkill("?seed=42", store({}))).toBe(true);
  });

  it("skips when the URL pins a difficulty, even a surplus one beside a seed", () => {
    for (const k of SKILL_KEYS) {
      expect(shouldPromptForSkill(`?rival=${k}`, store({}))).toBe(false);
      expect(shouldPromptForSkill(`?seed=7&rival=${k}`, store({}))).toBe(false);
    }
  });

  it("treats junk inputs as no choice at all", () => {
    expect(shouldPromptForSkill("?rival=banana", store({}))).toBe(true);
    expect(shouldPromptForSkill("", store({ [SKILL_STORAGE_KEY]: "banana" }))).toBe(true);
  });

  it("skips around a remembered choice", () => {
    expect(shouldPromptForSkill("", store({ [SKILL_STORAGE_KEY]: "easy" }))).toBe(false);
  });
});

describe("AI-02 skill prompt UI", () => {
  it("renders the three presets as cards and resolves on click", async () => {
    let picked: string | null = null;
    const p = promptForRivalSkill(host, { onPick: (k) => { picked = k; } });
    const overlay = host.querySelector("#iso-skill-prompt")!;
    expect(overlay).toBeTruthy();
    const buttons = [...overlay.querySelectorAll("[data-skill]")] as HTMLElement[];
    expect(buttons.map((b) => b.dataset.skill)).toEqual(SKILL_KEYS);
    for (const b of buttons) {
      expect(b.textContent).toContain(RIVAL_SKILLS[b.dataset.skill as keyof typeof RIVAL_SKILLS].label);
      expect(b.textContent).toContain("between moves");
    }
    // the resolver's default (normal, with no inputs) is marked current
    expect(overlay.querySelector(".iso-skill-current")!
      .getAttribute("data-skill")).toBe("normal");

    (overlay.querySelector('[data-skill="hard"]') as HTMLElement).click();
    await expect(p).resolves.toBe("hard");
    expect(picked).toBe("hard");
    expect(host.querySelector("#iso-skill-prompt")).toBeNull();
  });

  it("marks the stored key as current", async () => {
    const p = promptForRivalSkill(host, {
      search: "",
      storage: store({}),          // 'empty map' storage: a choice would be visible if set
      onPick: () => {},
    });
    const overlay = host.querySelector("#iso-skill-prompt")!;
    (overlay.querySelector('[data-skill="easy"]') as HTMLElement).click();
    await expect(p).resolves.toBe("easy");
  });

  it("no-ops (renders nothing) when the URL already decided", async () => {
    const got = await promptForRivalSkill(host, { search: "?rival=easy" });
    expect(got).toBeNull();
    expect(host.querySelector("#iso-skill-prompt")).toBeNull();
  });

  it("no-ops when storage remembers a choice", async () => {
    const got = await promptForRivalSkill(host, {
      storage: store({ [SKILL_STORAGE_KEY]: "hard" }),
    });
    expect(got).toBeNull();
    expect(host.querySelector("#iso-skill-prompt")).toBeNull();
  });

  it("the default pick persists through rememberSkill", () => {
    rememberSkill("normal");
    expect(localStorage.getItem(SKILL_STORAGE_KEY)).toBe("normal");
  });
});
