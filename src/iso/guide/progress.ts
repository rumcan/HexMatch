// ══════════════════════════════════════════════════════════════════════════
// TUT-03 (#422) — the guide's memory: which sections are done, and whether
// the player has asked it to go away.
//
// ONE record, in localStorage, behind a try/catch. A browser that refuses
// storage (private mode, a sandboxed frame) gets a fresh shelf every boot —
// the guide simply runs again, which is the correct failure: never a throw,
// never a permanent silence.
//
// The record is ALSO where the old tour's "never show this again" lands:
// every e2e spec and every returning player that pressed it wrote
// `hexmatch:tutorial = never`, and that word still means "no onboarding
// overlay on the click path". Reading it here is what keeps those boots
// playing the game instead of dismissing a guide they never met.
// ══════════════════════════════════════════════════════════════════════════
import {
  EMPTY_PROGRESS, GUIDE_SECTION_IDS,
  type GuideProgress, type GuideSectionId,
} from "./types";

export const GUIDE_STORAGE_KEY = "hexmatch:guide";
/** TUT-01's key, kept so a stored "never" keeps meaning what it meant. */
export const LEGACY_TUTORIAL_KEY = "hexmatch:tutorial";
export const LEGACY_NEVER = "never";

export type GuideMemory = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const liveMemory = (): GuideMemory | null => {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
};

/** A hostile store throws on every call; treat it as an empty shelf. */
function safeGet(store: GuideMemory | null, key: string): string | null {
  if (!store) return null;
  try { return store.getItem(key); } catch { return null; }
}

function safeSet(store: GuideMemory | null, key: string, value: string): void {
  if (!store) return;
  try { store.setItem(key, value); } catch { /* private mode: memory is best-effort */ }
}

function safeRemove(store: GuideMemory | null, key: string): void {
  if (!store) return;
  try { store.removeItem(key); } catch { /* private mode: memory is best-effort */ }
}

const isSectionId = (v: unknown): v is GuideSectionId =>
  typeof v === "string" && (GUIDE_SECTION_IDS as readonly string[]).includes(v);

/** Read the record. Anything unreadable or corrupt is a fresh shelf. */
export function loadProgress(store: GuideMemory | null = liveMemory()): GuideProgress {
  const raw = safeGet(store, GUIDE_STORAGE_KEY);
  if (!raw) return { ...EMPTY_PROGRESS };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ...EMPTY_PROGRESS }; }
  if (!parsed || typeof parsed !== "object") return { ...EMPTY_PROGRESS };
  const row = parsed as Record<string, unknown>;
  const done = Array.isArray(row.done) ? row.done.filter(isSectionId) : [];
  return {
    done: [...new Set(done)] as GuideSectionId[],
    dismissed: row.dismissed === true,
  };
}

export function saveProgress(
  progress: GuideProgress, store: GuideMemory | null = liveMemory(),
): void {
  safeSet(store, GUIDE_STORAGE_KEY, JSON.stringify({
    done: [...new Set(progress.done)],
    dismissed: progress.dismissed === true,
  }));
}

export function isSectionDone(
  id: GuideSectionId, store: GuideMemory | null = liveMemory(),
): boolean {
  return loadProgress(store).done.includes(id);
}

/** "Reset tutorial": forget every section and every dismissal. */
export function resetProgress(store: GuideMemory | null = liveMemory()): GuideProgress {
  safeRemove(store, GUIDE_STORAGE_KEY);
  return { ...EMPTY_PROGRESS };
}

/** The stored word that keeps every onboarding overlay off a boot. */
export function legacyNever(store: GuideMemory | null = liveMemory()): boolean {
  return safeGet(store, LEGACY_TUTORIAL_KEY) === LEGACY_NEVER;
}

// ── the gate ──────────────────────────────────────────────────────────────
// `?guide=0` (or the old `?tutorial=0`) sits the guide out — a playtest link,
// an e2e gameplay spec. `?guide=1` asks for it even over a dismissal. Anything
// else defers to the record.
const OFF_VALUES = new Set(["0", "off", "never", "no"]);
const ON_VALUES = new Set(["1", "on", "yes"]);

function flagOf(search: string, key: string): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  try { return (new URLSearchParams(raw).get(key) ?? "").trim().toLowerCase(); }
  catch { return ""; }
}

/**
 * Should the guide be able to open itself on this boot? False for a player who
 * dismissed it, and for a URL that asks it to stay out of the way. The
 * Tutorial MENU is never gated — a page asked for by name always opens.
 */
export function guideAllowed(
  search: string = typeof location !== "undefined" ? location.search : "",
  store: GuideMemory | null = liveMemory(),
): boolean {
  const off = OFF_VALUES.has(flagOf(search, "guide")) || OFF_VALUES.has(flagOf(search, "tutorial"));
  if (off) return false;
  const on = ON_VALUES.has(flagOf(search, "guide")) || ON_VALUES.has(flagOf(search, "tutorial"));
  if (on) return true;
  if (legacyNever(store)) return false;
  return !loadProgress(store).dismissed;
}

/**
 * True when the player has asked the guide to stay away — the one rule the
 * whole ticket turns on: a dismissed guide NEVER restarts unless they ask.
 */
export function guideDismissed(
  search: string = typeof location !== "undefined" ? location.search : "",
  store: GuideMemory | null = liveMemory(),
): boolean {
  if (ON_VALUES.has(flagOf(search, "guide"))) return false;
  return legacyNever(store) || loadProgress(store).dismissed;
}
