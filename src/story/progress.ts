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
//   bests      (PROG-1 #475, optional) each won contract's widest ★ margin
//              and fastest win, for the chapter list's best-results line.
//
// Corruption is not an error: an unparsable value reads as a fresh campaign
// rather than locking the player out of their own game, and private mode
// (no storage at all) plays the campaign open-everything-for-this-session,
// which is exactly what a reviewer with a playtest link wants.
// ══════════════════════════════════════════════════════════════════════════
export const STORY_STORAGE_KEY = "hexmatch:story";

export type ChapterResult = "win" | "loss";

/**
 * PROG-1 (#475): a contract's best results — the widest ★ margin and the
 * fastest win, for the chapter list's "best results" line. Wins only: a loss
 * keeps nothing. Optional and absent on old records, so the STORY-01 shape
 * (and its pinned tests) never moves.
 */
export interface ChapterBest {
  bestMargin?: number;
  bestTimeMs?: number;
}

export interface StoryProgress {
  unlocked: number;
  results: Record<string, ChapterResult>;
  introSeen: boolean;
  advisor: boolean;
  bests?: Record<string, ChapterBest>;
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
    // PROG-1 (#475): bests ride along only when a record carries them — a
    // fresh load has no `bests` key at all, so the STORY-01 shape is untouched.
    let bests: Record<string, ChapterBest> | undefined;
    if (parsed.bests && typeof parsed.bests === "object") {
      bests = {};
      for (const [k, v] of Object.entries(parsed.bests)) {
        if (!v || typeof v !== "object") continue;
        const clean: ChapterBest = {};
        if (typeof v.bestMargin === "number" && Number.isFinite(v.bestMargin)) {
          clean.bestMargin = v.bestMargin;
        }
        if (typeof v.bestTimeMs === "number" && Number.isFinite(v.bestTimeMs) && v.bestTimeMs >= 0) {
          clean.bestTimeMs = Math.floor(v.bestTimeMs);
        }
        if (clean.bestMargin !== undefined || clean.bestTimeMs !== undefined) bests[k] = clean;
      }
      if (Object.keys(bests).length === 0) bests = undefined;
    }
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
      ...(bests ? { bests } : {}),
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
 *
 * PROG-1 (#475): a win may also carry the match's stats — the ★ margin and
 * the wall time — which keep the contract's bests (widest margin, fastest
 * win) for the chapter list. A loss keeps nothing.
 */
export function recordChapterResult(
  chapterId: string, index: number, won: boolean, chapterCount: number,
  progress: StoryProgress = loadStoryProgress(),
  storage: StoryStorage | null = liveStorage(),
  stats: { margin?: number; timeMs?: number } = {},
): StoryProgress {
  const next: StoryProgress = {
    ...progress,
    results: { ...progress.results },
  };
  const had = next.results[chapterId];
  if (won) {
    next.results[chapterId] = "win";
    next.unlocked = Math.max(next.unlocked, Math.min(chapterCount, index + 2));
    const margin = stats.margin !== undefined && Number.isFinite(stats.margin)
      ? stats.margin : undefined;
    const timeMs = stats.timeMs !== undefined && Number.isFinite(stats.timeMs) && stats.timeMs >= 0
      ? Math.floor(stats.timeMs) : undefined;
    if (margin !== undefined || timeMs !== undefined) {
      const hadBest = next.bests?.[chapterId] ?? {};
      next.bests = {
        ...(next.bests ?? {}),
        [chapterId]: {
          bestMargin: margin === undefined ? hadBest.bestMargin
            : hadBest.bestMargin === undefined ? margin : Math.max(hadBest.bestMargin, margin),
          bestTimeMs: timeMs === undefined ? hadBest.bestTimeMs
            : hadBest.bestTimeMs === undefined ? timeMs : Math.min(hadBest.bestTimeMs, timeMs),
        },
      };
    }
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
