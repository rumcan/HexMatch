// ══════════════════════════════════════════════════════════════════════════
// MAP-1 (#412): which map features a game generates with.
//
// Rivers (+ dams), elevation, non-square building shapes, town ring roads and
// 45° roads (#440) are ON for every new game. What decides, in order:
//   1. an explicit option (`opts.rivers` … `opts.diag`) — tests and debug boots;
//   2. a URL param (`?rivers=0|1`, `?elevation=…`, `?shapes=…`, `?diag=…`);
//   3. a resumed save's recorded options (a save WITHOUT the field predates
//      MAP-1 and was generated all-OFF, so it resumes all-OFF — and a save
//      without `diag` predates #440, so it stays axis-only);
//   4. a networked room's settings (`MatchSettings.map`, defaults when absent)
//      — the HOST's record, so both seats build under the same rule and a
//      guest's own URL cannot split them;
//   5. a story contract: OFF unless the chapter says otherwise (its map is
//      tuned and must not move);
//   6. otherwise the defaults: all ON (all OFF under the unit-test runner, so
//      the seed-pinned tests about other things keep their maps).
//
// #440 note: `diag` is the one key here that generates nothing — no tile of
// terrain moves when it changes, only whether a road drag may leave the grid
// axis. That is why `game.ts` keeps it out of `mapParamsInUrl` (a `?diag=0`
// boot resumes the save in front of it instead of re-terraining under it) and
// why a save carries it in the same `map` record as the features that do move
// the map: one reader, one precedence chain, one place to look.
// ══════════════════════════════════════════════════════════════════════════

import {
  MAP_OPTIONS_OFF, MAP_OPTIONS_ON, defaultMapOptions, mapOptionsEqual, readMapOptions, type MapOptions,
} from "../net/match-settings";

export { MAP_OPTIONS_OFF, MAP_OPTIONS_ON, defaultMapOptions, mapOptionsEqual, readMapOptions };
export type { MapOptions };

const KEYS = ["rivers", "elevation", "shapes", "rings", "diag"] as const;

export interface MapOptionSources {
  explicit?: Partial<MapOptions>;
  search?: string;
  /** A resumed save: its recorded options (undefined = pre-MAP-1 save). */
  save?: { map?: unknown } | null;
  /** Networked room: `MatchSettings.map` (undefined = the defaults). */
  room?: { map?: MapOptions } | null;
  /** A story contract's own override (undefined = the chapter's map as tuned: OFF). */
  story?: { mapOptions?: Partial<MapOptions> } | null;
}

export function resolveMapOptions(src: MapOptionSources): MapOptions {
  let base: MapOptions;
  if (src.save) base = readMapOptions(src.save.map) ?? { ...MAP_OPTIONS_OFF };
  else if (src.room) base = src.room.map ? { ...src.room.map } : defaultMapOptions();
  else if (src.story) base = { ...MAP_OPTIONS_OFF, ...(src.story.mapOptions ?? {}) };
  else base = defaultMapOptions();
  let params: URLSearchParams | null = null;
  try { params = new URLSearchParams(src.search ?? ""); } catch { params = null; }
  for (const k of KEYS) {
    const q = params?.get(k);
    if (!src.save && !src.room && (q === "1" || q === "0")) base[k] = q === "1";
    const e = src.explicit?.[k];
    if (typeof e === "boolean") base[k] = e;
  }
  return base;
}
