/**
 * TOWN-4.5 (#681): the solo menu's remembered map choice — the size and town
 * plan a NEW free-play game boots with. Lives in localStorage (the same
 * per-browser persistence as the room settings), validated on load so a
 * hand-edited or future value falls back key-by-key to the shipped defaults
 * rather than breaking the Play screen. Story, scenarios, the tutorial and
 * resumed saves never consult this: it feeds only the Solo "New game" door.
 */
import {
  defaultMapSize, defaultTownLayout, readMapSize, readTownLayout,
  type MapSizeName, type TownLayout,
} from "../net/match-settings";

export interface NewGameMap {
  size: MapSizeName;
  layout: TownLayout;
}

export const NEW_GAME_MAP_KEY = "hexmatch:new-game-map";

/** The shipped default for a new free-play game (large + planned). */
export function defaultNewGameMap(): NewGameMap {
  return { size: defaultMapSize(), layout: defaultTownLayout() };
}

/**
 * The last map this browser's Play screen chose, or the shipped default.
 * Unknown keys fall back individually, so a stored size survives an unknown
 * layout and vice versa; storage is injectable for tests (no window there).
 */
export function loadNewGameMap(
  storage: Pick<Storage, "getItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): NewGameMap {
  const fallback = defaultNewGameMap();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(NEW_GAME_MAP_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<NewGameMap> | null;
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      size: readMapSize(parsed.size) ?? fallback.size,
      // TOWN-2b (#697): a remembered "organic" choice is no longer offered; it becomes the default.
      layout: ((l) => (l && l !== "organic" ? l : fallback.layout))(readTownLayout(parsed.layout)),
    };
  } catch {
    return fallback;
  }
}

/** Remember the Play screen's map choice (a broken store must not throw). */
export function saveNewGameMap(
  prefs: NewGameMap,
  storage: Pick<Storage, "setItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(NEW_GAME_MAP_KEY, JSON.stringify({ size: prefs.size, layout: prefs.layout }));
  } catch {
    // A full or private-mode store loses the preference, not the game.
  }
}
