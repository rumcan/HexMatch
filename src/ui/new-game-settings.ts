/**
 * SETTINGS-1 (#701): the New Game settings page's model — everything a NEW
 * solo free-play game can be started with, remembered per browser.
 *
 * Storage is three keys, each the one its feature already owned, so nothing
 * that reads them today changes:
 *   • `hexmatch:new-game-map` — size + town style (TOWN-4.5, `new-game-map.ts`);
 *   • `hexmatch:rival-skill`  — the difficulty (written only when the player
 *     picks one here, so AI-02's start-of-game picker still meets a first game);
 *   • `hexmatch:new-game-settings` — the rest (★ line, map features, seed,
 *     money, towns).
 * Every value is validated on load and falls back KEY BY KEY to today's game,
 * so a hand-edited or future value costs that one setting, never the page.
 * Defaults are exactly the shipped game: a player who never opens the page
 * starts the same match as before.
 */
import {
  MAP_OPTIONS_ON, MONEY_SCALES, readMoneyScale, readTownCount, readWinVp,
  type MapSizeName, type MoneyChoice, type TownLayout,
} from "../net/match-settings";
import { DEFAULT_SKILL, SKILL_KEYS, SKILL_STORAGE_KEY, type SkillKey } from "../iso/skill";
import { VICTORY } from "../iso/config";
import { defaultNewGameMap, loadNewGameMap, saveNewGameMap } from "./new-game-map";

export const NEW_GAME_SETTINGS_KEY = "hexmatch:new-game-settings";

/** The shipped town count (the generator's own `TOWN_COUNT`). */
export const DEFAULT_TOWNS = 4;
/** The shipped ★ line of a free-play game (the new loop's target). */
export const DEFAULT_WIN_VP: number = VICTORY.loop.target;
/** The three ★ presets the page offers: short, the shipped line, long. */
export const WIN_VP_PRESETS = [
  { vp: Math.max(4, DEFAULT_WIN_VP - 4), label: "Quick" },
  { vp: DEFAULT_WIN_VP, label: "Standard" },
  { vp: DEFAULT_WIN_VP + 6, label: "Long" },
] as const;

export type PlaySkill = Exclude<SkillKey, "trainee">;

export interface NewGameSettings {
  /** Owner (2026-10-05): the game type is picked on this page too. Conquest = no star line, win when the rival is bankrupt. */
  conquest: boolean;
  size: MapSizeName;
  layout: TownLayout;
  skill: PlaySkill;
  /** ★ to win; the shipped line when it equals `DEFAULT_WIN_VP`. */
  winVp: number;
  rivers: boolean;
  /** Elevation (hills). */
  hills: boolean;
  /** Town ring roads. */
  rings: boolean;
  /** 45° roads. */
  diag: boolean;
  /** A fixed map seed, or null for a fresh random map. */
  seed: number | null;
  money: MoneyChoice;
  towns: number;
}

/** Today's game, field for field. */
export function defaultNewGameSettings(): NewGameSettings {
  return {
    conquest: false,
    ...defaultNewGameMap(),
    skill: DEFAULT_SKILL as PlaySkill,
    winVp: DEFAULT_WIN_VP,
    rivers: MAP_OPTIONS_ON.rivers,
    hills: MAP_OPTIONS_ON.elevation,
    rings: MAP_OPTIONS_ON.rings,
    diag: MAP_OPTIONS_ON.diag,
    seed: null,
    money: "normal",
    towns: DEFAULT_TOWNS,
  };
}

type Store = Pick<Storage, "getItem">;
const defaultStore = (): Storage | null => (typeof localStorage !== "undefined" ? localStorage : null);

const readSeed = (raw: unknown): number | null =>
  typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 0xffffffff ? raw : null;
const readBool = (raw: unknown, fallback: boolean): boolean => (typeof raw === "boolean" ? raw : fallback);
const readSkill = (raw: unknown): PlaySkill | null =>
  typeof raw === "string" && (SKILL_KEYS as string[]).includes(raw) ? (raw as PlaySkill) : null;
const readMoney = (raw: unknown): MoneyChoice | null =>
  typeof raw === "string" && raw in MONEY_SCALES ? (raw as MoneyChoice) : null;

/** The remembered settings, validated per key (storage injectable for tests). */
export function loadNewGameSettings(storage: Store | null = defaultStore()): NewGameSettings {
  const d = defaultNewGameSettings();
  if (!storage) return d;
  const map = loadNewGameMap(storage);
  let skill: PlaySkill = d.skill;
  try { skill = readSkill(storage.getItem(SKILL_STORAGE_KEY)) ?? d.skill; } catch { /* default */ }
  let o: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(storage.getItem(NEW_GAME_SETTINGS_KEY) ?? "null") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) o = parsed as Record<string, unknown>;
  } catch { /* a broken record reads as no record */ }
  return {
    conquest: readBool(o.conquest, d.conquest),
    size: map.size,
    layout: map.layout,
    skill,
    winVp: readWinVp(o.winVp) ?? d.winVp,
    rivers: readBool(o.rivers, d.rivers),
    hills: readBool(o.hills, d.hills),
    rings: readBool(o.rings, d.rings),
    diag: readBool(o.diag, d.diag),
    seed: o.seed === null ? null : readSeed(o.seed) ?? d.seed,
    money: readMoney(o.money) ?? d.money,
    towns: readTownCount(o.towns) ?? d.towns,
  };
}

/**
 * Remember the page's settings. `skillChosen` writes the difficulty key too —
 * only when the player actually set it here, so a first game still meets
 * AI-02's picker. A full or blocked store loses the preference, not the game.
 */
export function saveNewGameSettings(
  s: NewGameSettings, skillChosen: boolean,
  storage: Pick<Storage, "setItem"> | null = defaultStore(),
): void {
  if (!storage) return;
  saveNewGameMap({ size: s.size, layout: s.layout }, storage);
  try {
    storage.setItem(NEW_GAME_SETTINGS_KEY, JSON.stringify({
      conquest: s.conquest,
      winVp: s.winVp, rivers: s.rivers, hills: s.hills, rings: s.rings, diag: s.diag,
      seed: s.seed, money: s.money, towns: s.towns,
    }));
    if (skillChosen) storage.setItem(SKILL_STORAGE_KEY, s.skill);
  } catch { /* see above */ }
}

/** What `startIsoGame` is given for a new game with these settings. */
export interface NewGameBootOptions {
  size: MapSizeName;
  layout: TownLayout;
  rivers?: boolean;
  elevation?: boolean;
  rings?: boolean;
  diag?: boolean;
  seed?: number;
  townCount?: number;
  winVp?: number;
  moneyScale?: number;
}

/** The boot options: only what differs from the shipped game is named, so a
 *  default page boots exactly the game a plain "Play vs AI" did (and a
 *  playtest link's `?rivers=0` still reaches a default page's game — an
 *  explicit option would outrank it). Size and layout were always passed. */
export function bootOptionsFor(s: NewGameSettings): NewGameBootOptions {
  const scale = readMoneyScale(MONEY_SCALES[s.money]);
  const d = defaultNewGameSettings();
  return {
    size: s.size,
    layout: s.layout,
    ...(s.rivers !== d.rivers ? { rivers: s.rivers } : {}),
    ...(s.hills !== d.hills ? { elevation: s.hills } : {}),
    ...(s.rings !== d.rings ? { rings: s.rings } : {}),
    ...(s.diag !== d.diag ? { diag: s.diag } : {}),
    ...(s.seed !== null ? { seed: s.seed } : {}),
    ...(s.towns !== DEFAULT_TOWNS ? { townCount: s.towns } : {}),
    ...(s.winVp !== DEFAULT_WIN_VP ? { winVp: s.winVp } : {}),
    ...(scale !== 1 ? { moneyScale: scale } : {}),
  };
}

/** One line for the Play screen: what a new game will be. */
export function describeNewGame(s: NewGameSettings): string {
  const parts = [
    s.conquest ? "Conquest" : "Vs AI",
    s.size === "large" ? "Large map" : "Standard map",
    `${s.layout.charAt(0).toUpperCase()}${s.layout.slice(1)} towns`,
    `${s.skill.charAt(0).toUpperCase()}${s.skill.slice(1)} rival`,
    ...(s.conquest ? [] : [`first to ${s.winVp}★`]),
  ];
  if (s.towns !== DEFAULT_TOWNS) parts.push(`${s.towns} towns`);
  if (s.money !== "normal") parts.push(`${s.money === "high" ? "High" : "Low"} money`);
  if (s.seed !== null) parts.push(`seed ${s.seed}`);
  return parts.join(" · ");
}

/** SETTINGS-1: the seed of the last free-play game, for "replay that map". */
export const LAST_SEED_KEY = "hexmatch:last-seed";
export function loadLastSeed(storage: Store | null = defaultStore()): number | null {
  if (!storage) return null;
  try { return readSeed(Number(storage.getItem(LAST_SEED_KEY) ?? "NaN")); } catch { return null; }
}
