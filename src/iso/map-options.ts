// ══════════════════════════════════════════════════════════════════════════
// MAP-1 (#412): which map features a game generates with.
//
// Rivers (+ dams), elevation and non-square building shapes are ON for every
// new game. What decides, in order:
//   1. an explicit option (`opts.rivers` …) — tests and debug boots;
//   2. a URL param (`?rivers=0|1`, `?elevation=…`, `?shapes=…`);
//   3. a resumed save's recorded options (a save WITHOUT the field predates
//      MAP-1 and was generated all-OFF, so it resumes all-OFF);
//   4. a networked room's settings (`MatchSettings.map`, defaults when absent);
//   5. a story contract: OFF unless the chapter says otherwise (its map is
//      tuned and must not move);
//   6. a scenario (PROG-1 #475): the scenario's tuned options, the same deal;
//   7. otherwise the defaults: all ON (all OFF under the unit-test runner, so
//      the seed-pinned tests about other things keep their maps).
// ══════════════════════════════════════════════════════════════════════════

import {
  MAP_OPTIONS_OFF, MAP_OPTIONS_ON, defaultMapOptions, mapOptionsEqual, readMapOptions, type MapOptions,
} from "../net/match-settings";

export { MAP_OPTIONS_OFF, MAP_OPTIONS_ON, defaultMapOptions, mapOptionsEqual, readMapOptions };
export type { MapOptions };

const KEYS = ["rivers", "elevation", "shapes", "rings"] as const;

export interface MapOptionSources {
  explicit?: Partial<MapOptions>;
  search?: string;
  /** A resumed save: its recorded options (undefined = pre-MAP-1 save). */
  save?: { map?: unknown } | null;
  /** Networked room: `MatchSettings.map` (undefined = the defaults). */
  room?: { map?: MapOptions } | null;
  /** A story contract's own override (undefined = the chapter's map as tuned: OFF). */
  story?: { mapOptions?: Partial<MapOptions> } | null;
  /** PROG-1 (#475): a scenario's tuned options (a boot is never both). */
  scenario?: { mapOptions?: Partial<MapOptions> } | null;
}

export function resolveMapOptions(src: MapOptionSources): MapOptions {
  let base: MapOptions;
  if (src.save) base = readMapOptions(src.save.map) ?? { ...MAP_OPTIONS_OFF };
  else if (src.room) base = src.room.map ? { ...src.room.map } : defaultMapOptions();
  else if (src.story) base = { ...MAP_OPTIONS_OFF, ...(src.story.mapOptions ?? {}) };
  else if (src.scenario) base = { ...MAP_OPTIONS_OFF, ...(src.scenario.mapOptions ?? {}) };
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
