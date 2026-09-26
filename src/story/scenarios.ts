// ══════════════════════════════════════════════════════════════════════════
// PROG-1 (#475) — scenarios: map presets beyond the default island, and the
// record of who has beaten them.
//
// A scenario is a PLACE (like a campaign contract: a fixed seed and a tuned
// map) wearing a race (a rival difficulty and a ★ line). The four ship in
// unlock order — each opens by winning the one before it, or any campaign
// contract — and each keeps its own best time and best ★ margin. Progression
// unlocks CONTENT, never power: a scenario changes the map, not the rules.
//
//   River Valley  rivers on, industries along the water;
//   Highlands     strong elevation — climbs are long and flat ground is scarce;
//   Twin Towns    two towns with a contested middle;
//   Archipelago   four islands — roads and rail must bridge between them.
//
// The record lives under its own key (`hexmatch:scenarios`), beside the
// campaign's (`hexmatch:story`) rather than inside it: the campaign record's
// shape is pinned by STORY-01's tests, and scenarios must work with Story
// mode hidden. Campaign wins still count — `effectiveUnlocked` lets each
// filed contract open one more scenario — so neither list can strand the
// other.
//
// FTUE-1 (#464) builds the Starter Island on this same preset shape when it
// lands (fixed seed + map overrides); END-1 (#472) re-checks the "Next
// contract" door this ticket adds to the ending screen.
// ══════════════════════════════════════════════════════════════════════════

import type { MapOptions } from "../net/match-settings";
import type { MapGenOptions } from "../iso/grid";
import type { SkillKey } from "../iso/skill";
import type { StoryProgress } from "./progress";

export const SCENARIO_STORAGE_KEY = "hexmatch:scenarios";

/** The localStorage slot infix a scenario match saves under. */
export const SCENARIO_SAVE_PREFIX = "scenario:";

export type ScenarioId = "river-valley" | "highlands" | "twin-towns" | "archipelago";

/** The generator knobs a scenario may turn beyond the four map options. */
export type ScenarioGen = Pick<
  MapGenOptions,
  "townCount" | "elevationStrength" | "waterfrontIndustries" | "archipelago"
>;

export interface ScenarioDef {
  id: ScenarioId;
  /** 0-based position in the unlock order. */
  index: number;
  name: string;
  /** The card's one-line pitch. */
  tagline: string;
  /** The card's one-paragraph brief. */
  brief: string;
  /** A scenario is a place: its map never moves between attempts. */
  seed: number;
  /** The rival's fixed difficulty (a scenario casts its rival, like a contract). */
  skill: SkillKey;
  /** The ★ line the scenario races to. */
  winTarget: number;
  /** The map features the scenario generates with. */
  mapOptions: MapOptions;
  /** The generator knobs beyond the four map options. */
  gen: ScenarioGen;
}

export const SCENARIOS: readonly ScenarioDef[] = [
  {
    id: "river-valley",
    index: 0,
    name: "River Valley",
    tagline: "Rivers on, industries along the water",
    brief: "The rivers run to the sea and every industry works its banks. Read the water before you lay a road — the cheapest crossing is the one you never build.",
    seed: 47501,
    skill: "normal",
    winTarget: 10,
    mapOptions: { rivers: true, elevation: true, shapes: true, rings: true },
    gen: { waterfrontIndustries: true },
  },
  {
    id: "highlands",
    index: 1,
    name: "Highlands",
    tagline: "Strong elevation — flat ground is scarce",
    brief: "The interior rises high and the climbs are long. Towns and industries hold the low shelf while the plateau waits — plan the grades before you pay for them.",
    seed: 47502,
    skill: "normal",
    winTarget: 10,
    mapOptions: { rivers: false, elevation: true, shapes: true, rings: true },
    gen: { elevationStrength: "strong" },
  },
  {
    id: "twin-towns",
    index: 2,
    name: "Twin Towns",
    tagline: "Two towns, one contested middle",
    brief: "Two settlements far apart, and every industry between them worth fighting over. The middle belongs to whoever paves it first.",
    seed: 47503,
    skill: "normal",
    winTarget: 10,
    mapOptions: { rivers: true, elevation: true, shapes: true, rings: true },
    gen: { townCount: 2 },
  },
  {
    id: "archipelago",
    index: 3,
    name: "Archipelago",
    tagline: "Four islands — bridge between them",
    brief: "Sea channels split the island in four, one town per shore. No highway crosses the water for you: roads and rail must bridge island to island.",
    seed: 47504,
    skill: "normal",
    winTarget: 10,
    mapOptions: { rivers: false, elevation: true, shapes: true, rings: true },
    gen: { archipelago: true },
  },
];

export const scenarioById = (id: string): ScenarioDef | null =>
  SCENARIOS.find((s) => s.id === id) ?? null;

/** The scenario after `id` in unlock order, or null past the last one. */
export const nextScenarioId = (id: string): ScenarioId | null => {
  const at = SCENARIOS.findIndex((s) => s.id === id);
  return at >= 0 && at + 1 < SCENARIOS.length ? SCENARIOS[at + 1].id : null;
};

/**
 * The full generator options for a scenario match: the resolved map options
 * (which a playtest URL may tweak) plus the scenario's own knobs.
 */
export function scenarioMapGen(def: ScenarioDef, mapOptions: MapOptions): MapGenOptions {
  return {
    rivers: mapOptions.rivers,
    elevation: mapOptions.elevation,
    shapes: mapOptions.shapes,
    rings: mapOptions.rings,
    ...def.gen,
  };
}

// ── the record ─────────────────────────────────────────────────────────────

export interface ScenarioBest {
  wins: number;
  bestTimeMs: number | null;
  bestMargin: number | null;
}

export interface ScenarioProgress {
  unlocked: number;
  results: Record<string, ScenarioBest>;
}

export type ScenarioStorage = Pick<Storage, "getItem" | "setItem">;

export const FRESH_SCENARIOS: ScenarioProgress = {
  unlocked: 1,
  results: {},
};

const liveStorage = (): ScenarioStorage | null =>
  typeof localStorage !== "undefined" ? localStorage : null;

const cleanBest = (raw: unknown): ScenarioBest | null => {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const wins = typeof o.wins === "number" && Number.isFinite(o.wins)
    ? Math.max(0, Math.floor(o.wins)) : 0;
  const bestTimeMs = typeof o.bestTimeMs === "number" && Number.isFinite(o.bestTimeMs) && o.bestTimeMs >= 0
    ? Math.floor(o.bestTimeMs) : null;
  const bestMargin = typeof o.bestMargin === "number" && Number.isFinite(o.bestMargin)
    ? o.bestMargin : null;
  return { wins, bestTimeMs, bestMargin };
};

export function loadScenarioProgress(
  storage: ScenarioStorage | null = liveStorage(),
): ScenarioProgress {
  if (!storage) return { ...FRESH_SCENARIOS, results: {} };
  try {
    const raw = storage.getItem(SCENARIO_STORAGE_KEY);
    if (!raw) return { ...FRESH_SCENARIOS, results: {} };
    const parsed = JSON.parse(raw) as Partial<ScenarioProgress>;
    const results: Record<string, ScenarioBest> = {};
    if (parsed.results && typeof parsed.results === "object") {
      for (const [k, v] of Object.entries(parsed.results)) {
        const clean = cleanBest(v);
        if (clean) results[k] = clean;
      }
    }
    return {
      unlocked: typeof parsed.unlocked === "number" && parsed.unlocked >= 1
        ? Math.min(SCENARIOS.length, Math.floor(parsed.unlocked))
        : 1,
      results,
    };
  } catch {
    return { ...FRESH_SCENARIOS, results: {} };
  }
}

export function saveScenarioProgress(
  progress: ScenarioProgress, storage: ScenarioStorage | null = liveStorage(),
): void {
  if (!storage) return;
  try { storage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(progress)); }
  catch { /* private mode: the scenarios simply start fresh next boot */ }
}

/**
 * How many scenarios are open. The stored count moves on scenario wins; each
 * filed campaign contract opens one more besides, so a campaign player never
 * finds the scenarios sealed and a scenario player never needs the campaign.
 */
export function effectiveUnlocked(
  progress: ScenarioProgress, story?: Pick<StoryProgress, "results"> | null,
): number {
  const campaignWins = story
    ? Object.values(story.results).filter((r) => r === "win").length : 0;
  return Math.min(SCENARIOS.length, Math.max(progress.unlocked, 1 + campaignWins));
}

/** A scenario index (0-based) is open when it is inside the unlocked count. */
export function isScenarioUnlocked(
  id: ScenarioId | string, progress: ScenarioProgress = loadScenarioProgress(),
  story?: Pick<StoryProgress, "results"> | null,
): boolean {
  const def = scenarioById(id);
  if (!def) return false;
  return def.index < effectiveUnlocked(progress, story);
}

export interface ScenarioMatchStats {
  /** Wall time from boot to the final ledger, in ms. */
  timeMs?: number;
  /** The winner's ★ margin (floored totals), signed. */
  margin?: number;
}

/**
 * Record a finished scenario match. A win counts itself, keeps the fastest
 * time and the widest margin, and opens the next scenario; a loss leaves the
 * record exactly as it was (there is nothing to keep from it).
 */
export function recordScenarioResult(
  scenarioId: string, index: number, won: boolean,
  stats: ScenarioMatchStats = {},
  progress: ScenarioProgress = loadScenarioProgress(),
  storage: ScenarioStorage | null = liveStorage(),
): ScenarioProgress {
  if (!won) return progress;
  const next: ScenarioProgress = {
    ...progress,
    results: { ...progress.results },
  };
  const had = next.results[scenarioId] ?? { wins: 0, bestTimeMs: null, bestMargin: null };
  const timeMs = stats.timeMs !== undefined && Number.isFinite(stats.timeMs) && stats.timeMs >= 0
    ? Math.floor(stats.timeMs) : null;
  const margin = stats.margin !== undefined && Number.isFinite(stats.margin)
    ? stats.margin : null;
  next.results[scenarioId] = {
    wins: had.wins + 1,
    bestTimeMs: timeMs === null ? had.bestTimeMs
      : had.bestTimeMs === null ? timeMs : Math.min(had.bestTimeMs, timeMs),
    bestMargin: margin === null ? had.bestMargin
      : had.bestMargin === null ? margin : Math.max(had.bestMargin, margin),
  };
  next.unlocked = Math.max(next.unlocked, Math.min(SCENARIOS.length, index + 2));
  saveScenarioProgress(next, storage);
  return next;
}

/**
 * How a locked scenario opens, for its card. The first scenario is open, so
 * it has no hint; every other names the win (or the contract) that opens it.
 */
export function scenarioUnlockHint(id: ScenarioId | string): string | null {
  const def = scenarioById(id);
  if (!def || def.index === 0) return null;
  return `Win ${SCENARIOS[def.index - 1].name} — or any campaign contract — to unlock.`;
}

/**
 * `?scenario=<id>` pins a scenario for a playtest link, the same way
 * `?chapter=` pins a contract: the menu lock steps aside, the record does
 * not change. Returns null when the URL says nothing.
 */
export function pinnedScenario(
  search: string = typeof location !== "undefined" ? location.search : "",
): string | null {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const value = (new URLSearchParams(raw).get("scenario") ?? "").trim().toLowerCase();
  return value || null;
}

/** `732000` → `"12:12"`; hours grow a third field. */
export function formatBestTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60, m = Math.floor(total / 60) % 60, h = Math.floor(total / 3600);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** One line for a played scenario's card — wins, widest margin, fastest time. */
export function describeScenarioBest(best: ScenarioBest): string | null {
  if (best.wins <= 0) return null;
  const parts = [`${best.wins} win${best.wins === 1 ? "" : "s"}`];
  if (best.bestMargin !== null) parts.push(`best +${best.bestMargin}★`);
  if (best.bestTimeMs !== null) parts.push(`fastest ${formatBestTime(best.bestTimeMs)}`);
  return parts.join(" · ");
}
