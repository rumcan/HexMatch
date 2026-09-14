// ══════════════════════════════════════════════════════════════════════════
// CONTINUE-01 (#191) — read-only dossiers of the solo saves on this machine.
//
// The old front door had one behaviour: finding a recent save meant resuming
// it, so "Play vs AI" (and reopening a contract) silently dropped the player
// back into the old match. The new door separates two intents — CONTINUE (the
// save the menus can name: "vs AI (Normal) · 7★ vs 5★ · saved 2 h ago") and
// NEW (which deliberately clears the slot first). This module is the shelf
// those doors read from:
//
//   · it scans localStorage for the sandbox slot (`hexmatch:save`) and every
//     story slot (`hexmatch:save:story:<chapter>`);
//   · it applies the SAME freshness rule the boot path uses
//     (`loadRecentSave` — a save older than SAVE_FRESH_MS is nobody's current
//     game);
//   · it re-derives the two ★ totals the same way game.ts does on restore —
//     VP is deliberately NOT in the payload, so the track layers are stamped
//     onto a throwaway Track and run through `rescore`, never the live world;
//   · it never writes anything. Clearing a slot before a deliberately-new
//     game belongs to `discardSoloSave`, the one thin write path the menus
//     share with the ☰ menu's New Game.
// ══════════════════════════════════════════════════════════════════════════
import {
  SAVE_KEY, clearSave, loadRecentSave, saveKeyFor, trackRestored,
  type SaveGamePayload,
} from "./savegame-runtime";
import { createTrack } from "./track";
import { createScoreState, rescore, vpFor } from "./victory";
import type { EconomyState } from "./economy";
import { RIVAL_SKILLS, SKILL_STORAGE_KEY, type SkillKey } from "./skill";
import { chapterById } from "../story/chapters";

export interface SoloSaveSummary {
  /** The localStorage slot — `saveKeyFor(chapterId)`. */
  key: string;
  /** null = the sandbox ("Play vs AI"); otherwise the story contract id. */
  chapterId: string | null;
  /** Contract name for a story slot, null for the sandbox. */
  chapterName: string | null;
  savedAt: number;
  skillKey: SkillKey;
  skillLabel: string;
  /** Re-derived VP totals, floored exactly as the HUD prints them. */
  youStars: number;
  rivalStars: number;
  /** The match is decided — Continue reopens the final ledger. */
  finished: boolean;
  winnerId: string | null;
}

const STORY_PREFIX = `${SAVE_KEY}:story:`;

/** The slot key for the kind of solo game a menu door starts. */
export const soloSaveKey = (chapterId: string | null): string => saveKeyFor(chapterId);

function asSkillKey(raw: string): SkillKey {
  return (raw in RIVAL_SKILLS ? raw : "normal") as SkillKey;
}

/**
 * Rebuild the two ★ totals from the save's track + structures. VP is derived
 * state (see victory.ts), so the payload never carries it; the rescore here
 * is the exact recompute `applySave` runs, over a track nobody is about to
 * render. A corrupt layer fails closed to zeros rather than breaking a menu.
 */
function starsFromSave(d: SaveGamePayload): { you: number; rival: number } {
  try {
    const track = createTrack();
    trackRestored(track, d.track);
    // `grid` is only consulted by catchment/connection code; `rescore` reads
    // track, factories and harvesters alone, so the grid slot stays empty.
    const scratch: EconomyState = {
      grid: null as never,
      track,
      harvesters: d.eco.harvesters,
      factories: d.eco.factories,
    };
    const score = createScoreState();
    rescore(scratch, score);
    return {
      you: Math.floor(vpFor(score, "you")),
      rival: Math.floor(vpFor(score, "ai")),
    };
  } catch {
    return { you: 0, rival: 0 };
  }
}

function summarize(
  key: string,
  chapterId: string | null,
  d: SaveGamePayload,
): SoloSaveSummary | null {
  // A story slot whose contract the campaign no longer knows can never be
  // resumed (the boot would treat an unknown chapter as no story and read
  // the sandbox slot instead) — don't offer a door that leads nowhere.
  let chapterName: string | null = null;
  if (chapterId !== null) {
    const chapter = chapterById(chapterId);
    if (!chapter) return null;
    chapterName = chapter.name;
  }
  const skillKey = asSkillKey(d.skillKey);
  const stars = starsFromSave(d);
  return {
    key,
    chapterId,
    chapterName,
    savedAt: d.savedAt,
    skillKey,
    skillLabel: RIVAL_SKILLS[skillKey].label,
    youStars: stars.you,
    rivalStars: stars.rival,
    finished: d.phase === "won",
    winnerId: d.winnerId,
  };
}

type StorageReader = Pick<Storage, "getItem" | "removeItem" | "key" | "length">;

const reader = (
  storage: StorageReader | null,
): StorageReader | null => storage;

/**
 * Every resumable solo save the machine holds — sandbox slot first, then each
 * story slot — freshest first within that order. Mirrors the boot's own
 * freshness window, so a door offered here is a door the boot would honour.
 */
export function resumableSaves(
  now: number = Date.now(),
  storage: StorageReader | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): SoloSaveSummary[] {
  const s = reader(storage);
  if (!s) return [];
  const out: SoloSaveSummary[] = [];
  const consider = (key: string, chapterId: string | null) => {
    const d = loadRecentSave(now, key);
    if (!d) return;
    const summary = summarize(key, chapterId, d);
    if (summary) out.push(summary);
  };
  consider(SAVE_KEY, null);
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k && k.startsWith(STORY_PREFIX)) consider(k, k.slice(STORY_PREFIX.length));
  }
  return out;
}

/** The one save a front-door "Continue" should pick up: the freshest of all
 *  slots (a half-played contract is newer than last week's sandbox). */
export function mostRecentSave(
  now: number = Date.now(),
  storage: StorageReader | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): SoloSaveSummary | null {
  return [...resumableSaves(now, storage)]
    .sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
}

/** The resumable save for exactly one solo mode (null chapter = sandbox). */
export function saveForMode(
  chapterId: string | null,
  now: number = Date.now(),
  storage: StorageReader | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): SoloSaveSummary | null {
  if (!storage) return null;
  const d = loadRecentSave(now, soloSaveKey(chapterId));
  return d ? summarize(soloSaveKey(chapterId), chapterId, d) : null;
}

/**
 * "saved 2 h ago" in the menu's voice. Deliberately compact — it rides a
 * button's second line beside the score, never a paragraph.
 */
export function formatSavedAgo(
  savedAt: number,
  now: number = Date.now(),
): string {
  const secs = Math.max(0, Math.floor((now - savedAt) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

/** The second line under a Continue button, e.g.
 *  "vs AI (Normal) · 7★ vs 5★ · saved 2 h ago". */
export function describeSave(
  s: SoloSaveSummary,
  now: number = Date.now(),
): string {
  const score = s.finished
    ? `final ${s.youStars}★ vs ${s.rivalStars}★`
    : `${s.youStars}★ vs ${s.rivalStars}★`;
  const mode = s.chapterName ?? `vs AI (${s.skillLabel})`;
  return `${mode} · ${score} · saved ${formatSavedAgo(s.savedAt, now)}`;
}

/**
 * Clear one solo slot so the next boot is a deliberately NEW game. The
 * sandbox also forgets the remembered difficulty pick — exactly the ☰ menu's
 * New Game semantics — so the new match re-asks rather than inheriting.
 * A story contract casts its own rival at a fixed difficulty and has no pick
 * to forget.
 */
export function discardSoloSave(
  chapterId: string | null,
  storage: StorageReader | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): void {
  if (!storage) return;
  clearSave(soloSaveKey(chapterId));
  if (chapterId === null) {
    try { storage.removeItem(SKILL_STORAGE_KEY); } catch { /* private mode */ }
  }
}
