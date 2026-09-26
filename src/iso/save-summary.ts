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
//   · it scans localStorage for the sandbox slot (`hexmatch:save`), every
//     story slot (`hexmatch:save:story:<chapter>`) and every scenario slot
//     (PROG-1 #475, `hexmatch:save:scenario:<id>`);
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
  SAVE_KEY, SCENARIO_SAVE_KEY_PREFIX, clearSave, loadRecentSave, saveKeyFor,
  scenarioSaveKey, trackRestored, type SaveGamePayload,
} from "./savegame-runtime";
import { createTrack } from "./track";
import { createScoreState, rescore, vpFor, type LoopScoring } from "./victory";
import { VICTORY } from "./config";
import { generateMap } from "./grid";
import {
  buildAllComponents, depotCargo, heldIndustries, industryLocks, isServiced,
  ownerIdOf, resolveConnection, type EconomyState,
} from "./economy";
import { RIVAL_SKILLS, SKILL_STORAGE_KEY, type SkillKey } from "./skill";
import { chapterById } from "../story/chapters";
import { SCENARIO_SAVE_PREFIX, scenarioById } from "../story/scenarios";

export interface SoloSaveSummary {
  /** The localStorage slot — `saveKeyFor(chapterId)`. */
  key: string;
  /**
   * null = the sandbox ("Play vs AI"); otherwise the story contract id —
   * or, PROG-1 (#475), a `scenario:<id>` tag for a scenario slot.
   */
  chapterId: string | null;
  /** Contract (or scenario) name for a story slot, null for the sandbox. */
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
export const soloSaveKey = (chapterId: string | null): string =>
  chapterId !== null && chapterId.startsWith(SCENARIO_SAVE_PREFIX)
    ? scenarioSaveKey(chapterId.slice(SCENARIO_SAVE_PREFIX.length))
    : saveKeyFor(chapterId);

function asSkillKey(raw: string): SkillKey {
  return (raw in RIVAL_SKILLS ? raw : "normal") as SkillKey;
}

/**
 * L13 (#228): the ★ table a save was played under is the one its dossier must
 * be scored by. A new-loop save (`loop: true`, written by L1e) scores depot
 * types, rungs and city tiers; a shipped-loop save scores paves and plants.
 * Reading a new-loop save on the shipped table printed "0★ vs 0★" on the menu
 * — the loop pays nothing for pavement, and that save has no scored pavement.
 *
 * Unlike every other `rescore` caller this one has no live world: the summary
 * is built from a payload, on a menu, for a game that is not running. The
 * grid is what the loop's "running" rule needs (catchments decide which
 * industries a Depot holds), so a new-loop dossier regenerates it from the
 * save's own seed — `generateMap` is a pure function of that seed, which is
 * exactly how `applySave` rebuilds the same world. It costs ~300ms, so it is
 * paid ONLY for a new-loop save, and never for the shipped-loop scan.
 */
function loopScoringFor(
  scratch: EconomyState, d: SaveGamePayload,
): LoopScoring | undefined {
  if (d.loop !== true) return undefined;
  const locks = industryLocks(scratch);
  const comps = new Map<string, ReturnType<typeof buildAllComponents>>();
  const compFor = (owner: string) => {
    let c = comps.get(owner);
    if (!c) comps.set(owner, c = buildAllComponents(scratch.track, ownerIdOf(scratch, owner)));
    return c;
  };
  return {
    // The same three clauses as `loopScoring` in game.ts — serviced,
    // connected to one of the seat's own plants, and holding an industry no
    // rival claimed first. One rule, so a dossier can never disagree with the
    // scoreboard the save will show when it is reopened.
    running: (h) => {
      if (!isServiced(scratch.track, h, scratch.rail)) return false;
      if (resolveConnection(scratch, compFor(h.owner), h).kind === null) return false;
      return heldIndustries(scratch, h, locks).length > 0;
    },
    cargoOf: (h) => depotCargo(scratch, h),
    // The seat records ride the payload (L1e); a save written before they did
    // reads as a fresh seat, which is what such a save was played with.
    seats: (d.players ?? []).map((p, i) => ({
      owner: i === 0 ? "you" : "ai",
      depotTier: p.depotTier ?? 0,
      townLevel: p.townLevel ?? 0,
    })),
  };
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
    // `grid` is only consulted by catchment/connection code. The shipped
    // loop's table never asks (paves and plants are track/list facts), so it
    // stays empty there; the new loop's "which industries does this Depot
    // hold" rule does, so a loop save rebuilds it from its own seed.
    const scratch: EconomyState = {
      grid: (d.loop === true ? generateMap(d.seed) : null) as never,
      track,
      harvesters: d.eco.harvesters,
      factories: d.eco.factories,
      // R3 (#270): the score summary doesn't read the dam bonus.
      dams: [],
    };
    const score = createScoreState();
    // Railways v1: platforms score 1★ each (`rescore`'s third argument is a
    // full RailwayState), but a platform is a flat owner-scored record, so
    // the payload's serialised structures list is enough — no rail graph.
    // RAIL-04 wire: the railway sits on the payload's `rail` field and its
    // platforms/depots ride `structures` with a `kind` discriminator.
    rescore(scratch, score, undefined, loopScoringFor(scratch, d));
    const platformStars = (owner: string): number =>
      (d.rail?.structures ?? [])
        .filter((p) => p.kind === "platform" && p.owner === owner).length
      * VICTORY.platform;
    return {
      you: Math.floor(vpFor(score, "you") + platformStars("you")),
      rival: Math.floor(vpFor(score, "ai") + platformStars("ai")),
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
  // PROG-1 (#475): scenario slots read the same way, off the scenario list.
  let chapterName: string | null = null;
  if (chapterId !== null) {
    if (chapterId.startsWith(SCENARIO_SAVE_PREFIX)) {
      const scenario = scenarioById(chapterId.slice(SCENARIO_SAVE_PREFIX.length));
      if (!scenario) return null;
      chapterName = scenario.name;
    } else {
      const chapter = chapterById(chapterId);
      if (!chapter) return null;
      chapterName = chapter.name;
    }
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
    // PROG-1 (#475): scenario slots join the shelf as `scenario:<id>` tags.
    if (k && k.startsWith(SCENARIO_SAVE_KEY_PREFIX)) {
      consider(k, `${SCENARIO_SAVE_PREFIX}${k.slice(SCENARIO_SAVE_KEY_PREFIX.length)}`);
    }
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
 * A story contract (or a scenario) casts its own rival at a fixed difficulty
 * and has no pick to forget.
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
