// ══════════════════════════════════════════════════════════════════════════
// STORY-01 — the campaign record (src/story/progress.ts): one key, one
// meaning, and corruption is never a locked door.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import {
  FRESH_PROGRESS, STORY_STORAGE_KEY, advisorEnabled, introSuppressed,
  isChapterUnlocked, loadStoryProgress, markIntroSeen, pinnedChapter,
  recordChapterResult, setAdvisorEnabled,
} from "../../src/story/progress";

const store = (init: Record<string, string> = {}) => ({
  getItem: (k: string) => (k in init ? init[k] : null),
  setItem: (k: string, v: string) => { init[k] = v; },
});

describe("STORY-01 campaign progress", () => {
  it("starts fresh: one open contract, nothing filed, the reel unseen", () => {
    const p = loadStoryProgress(store());
    expect(p).toEqual(FRESH_PROGRESS);
    expect(isChapterUnlocked(0, p)).toBe(true);
    expect(isChapterUnlocked(1, p)).toBe(false);
  });

  it("opens the next contract on a win, and never on a loss", () => {
    const s = store();
    let p = recordChapterResult("inheritance", 0, true, 5, loadStoryProgress(s), s);
    expect(p.unlocked).toBe(2);
    expect(p.results.inheritance).toBe("win");
    p = recordChapterResult("toll-king", 1, false, 5, p, s);
    expect(p.unlocked).toBe(2);
    expect(p.results["toll-king"]).toBe("loss");
    // a loss on a won contract never downgrades the seal
    p = recordChapterResult("inheritance", 0, false, 5, p, s);
    expect(p.results.inheritance).toBe("win");
    // and the record survives a reload
    expect(loadStoryProgress(s).results.inheritance).toBe("win");
  });

  it("caps the unlock at the campaign's last contract", () => {
    const s = store();
    const p = recordChapterResult("chairmans-ledger", 4, true, 5, loadStoryProgress(s), s);
    expect(p.unlocked).toBe(5);
  });

  it("reads corruption as a fresh campaign, not a locked one", () => {
    const s = store({ [STORY_STORAGE_KEY]: "{not json" });
    expect(loadStoryProgress(s)).toEqual(FRESH_PROGRESS);
    const s2 = store({ [STORY_STORAGE_KEY]: JSON.stringify({ unlocked: -3, results: 7 }) });
    const p = loadStoryProgress(s2);
    expect(p.unlocked).toBe(1);
    expect(p.results).toEqual({});
  });

  it("marks the reel seen once, and only once", () => {
    const s = store();
    const once = markIntroSeen(loadStoryProgress(s), s);
    expect(once.introSeen).toBe(true);
    const twice = markIntroSeen(once, s);
    expect(twice.introSeen).toBe(true);
    expect(loadStoryProgress(s).introSeen).toBe(true);
  });

  it("lets the player silence the guide, and the URL overrule either way", () => {
    const s = store();
    let p = setAdvisorEnabled(false, loadStoryProgress(s), s);
    expect(advisorEnabled("", p)).toBe(false);
    expect(advisorEnabled("?advisor=1", p)).toBe(true);
    p = setAdvisorEnabled(true, p, s);
    expect(advisorEnabled("?advisor=0", p)).toBe(false);
    expect(advisorEnabled("", p)).toBe(true);
  });

  it("pins a contract for playtest links without touching the record", () => {
    expect(pinnedChapter("?chapter=black-gold")).toBe("black-gold");
    expect(pinnedChapter("?chapter=BLACK-GOLD")).toBe("black-gold");
    expect(pinnedChapter("")).toBeNull();
    expect(pinnedChapter("?seed=7")).toBeNull();
    expect(introSuppressed("?storyintro=0")).toBe(true);
    expect(introSuppressed("?storyintro=1")).toBe(false);
  });
});
