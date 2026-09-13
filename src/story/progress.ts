// ══════════════════════════════════════════════════════════════════════════
// STORY-01 — campaign progress: one localStorage key, one meaning.
//
// The same discipline TUT-01 settled for the tour and AI-03 for saves: the
// campaign's state is a RECORD, never an inference from where the boot
// happened. One key (`hexmatch:story`) holds
//
//   unlocked   how many contracts are open (1 = the first, always),
//   results    the best outcome per chapter id — a win sticks, a loss never
//              overwrites a win, and a loss still counts as "played",
//   introSeen  the opening reel was watched OR skipped (both are "seen": the
//              skip button is a choice, not an interruption),
//   advisor    the player's last word on Mabel's in-game hints (default on).
//
// Corruption is not an error: an unparsable value reads as a fresh campaign
// rather than locking the player out of their own game, and private mode
// (no storage at all) plays the campaign open-everything-for-this-session,
// which is exactly what a reviewer with a playtest link wants.
// ══════════════════════════════════════════════════════════════════════════
export const STORY_STORAGE_KEY = "hexmatch:story";

export type ChapterResult = "win" | "loss";

export interface StoryProgress {
  unlocked: number;
  results: Record<string, ChapterResult>;
  introSeen: boolean;
  advisor: boolean;
}

export type StoryStorage = Pick<Storage, "getItem" | "setItem">;

export const FRESH_PROGRESS: StoryProgress = {
  unlocked: 1,
  results: {},
  introSeen: false,
  advisor: true,
};

const liveStorage = (): StoryStorage | null =>
  typeof localStorage !== "undefined" ? localStorage : null;

export function loadStoryProgress(storage: StoryStorage | null = liveStorage()): StoryProgress {
  if (!storage) return { ...FRESH_PROGRESS, results: {} };
  try {
    const raw = storage.getItem(STORY_STORAGE_KEY);
    if (!raw) return { ...FRESH_PROGRESS, results: {} };
    const parsed = JSON.parse(raw) as Partial<StoryProgress>;
    return {
      unlocked: typeof parsed.unlocked === "number" && parsed.unlocked >= 1
        ? Math.floor(parsed.unlocked)
        : 1,
      results: parsed.results && typeof parsed.results === "object"
        ? Object.fromEntries(
          Object.entries(parsed.results).filter(([, v]) => v === "win" || v === "loss"),
        )
        : {},
      introSeen: parsed.introSeen === true,
      advisor: parsed.advisor !== false,
    };
  } catch {
    return { ...FRESH_PROGRESS, results: {} };
  }
}

export function saveStoryProgress(
  progress: StoryProgress, storage: StoryStorage | null = liveStorage(),
): void {
  if (!storage) return;
  try { storage.setItem(STORY_STORAGE_KEY, JSON.stringify(progress)); }
  catch { /* private mode: the campaign simply starts fresh next boot */ }
}

/** A chapter index (0-based) is open when it is inside the unlocked count. */
export function isChapterUnlocked(
  index: number, progress: StoryProgress = loadStoryProgress(),
): boolean {
  return index < progress.unlocked;
}

/**
 * Record a finished contract. A win opens the next chapter; a loss only
 * records itself (the retry is the point). A win never downgrades to a loss.
 */
export function recordChapterResult(
  chapterId: string, index: number, won: boolean, chapterCount: number,
  progress: StoryProgress = loadStoryProgress(),
  storage: StoryStorage | null = liveStorage(),
): StoryProgress {
  const next: StoryProgress = {
    ...progress,
    results: { ...progress.results },
  };
  const had = next.results[chapterId];
  if (won) {
    next.results[chapterId] = "win";
    next.unlocked = Math.max(next.unlocked, Math.min(chapterCount, index + 2));
  } else if (had !== "win") {
    next.results[chapterId] = "loss";
  }
  saveStoryProgress(next, storage);
  return next;
}

export function markIntroSeen(
  progress: StoryProgress = loadStoryProgress(),
  storage: StoryStorage | null = liveStorage(),
): StoryProgress {
  if (progress.introSeen) return progress;
  const next = { ...progress, introSeen: true };
  saveStoryProgress(next, storage);
  return next;
}

/** Mabel's in-game hints: the player's last word, default on. */
export function setAdvisorEnabled(
  enabled: boolean,
  progress: StoryProgress = loadStoryProgress(),
  storage: StoryStorage | null = liveStorage(),
): StoryProgress {
  const next = { ...progress, advisor: enabled };
  saveStoryProgress(next, storage);
  return next;
}

const OFF = new Set(["0", "off", "no"]);
const ON = new Set(["1", "on", "yes"]);

/**
 * `?advisor=0` silences the guide for a playtest link (and `?advisor=1`
 * brings her back over a stored "off"), the same precedence shape
 * `shouldShowTutorial` uses: explicit URL, then the stored word, then on.
 */
export function advisorEnabled(
  search: string = typeof location !== "undefined" ? location.search : "",
  progress: StoryProgress = loadStoryProgress(),
): boolean {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const flag = (new URLSearchParams(raw).get("advisor") ?? "").trim().toLowerCase();
  if (OFF.has(flag)) return false;
  if (ON.has(flag)) return true;
  return progress.advisor;
}

/**
 * `?chapter=<id>` pins a contract for a playtest link, the same way `?rival=`
 * pins a difficulty: the menu lock steps aside, the campaign record does not
 * change. Returns null when the URL says nothing.
 */
export function pinnedChapter(
  search: string = typeof location !== "undefined" ? location.search : "",
): string | null {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const value = (new URLSearchParams(raw).get("chapter") ?? "").trim().toLowerCase();
  return value || null;
}

/** `?storyintro=0` boots straight into the contract, reel unseen-and-unmarked. */
export function introSuppressed(
  search: string = typeof location !== "undefined" ? location.search : "",
): boolean {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  return OFF.has((new URLSearchParams(raw).get("storyintro") ?? "").trim().toLowerCase());
}
