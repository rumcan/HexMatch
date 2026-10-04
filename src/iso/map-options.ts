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
//   6. a scenario (PROG-1 #475): the scenario's tuned options, the same deal;
//   7. otherwise the defaults: all ON (all OFF under the unit-test runner, so
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
  MAP_OPTIONS_OFF, MAP_OPTIONS_ON, defaultMapOptions, mapOptionsEqual, readMapOptions,
  readTownLayout, defaultTownLayout, readMapSize, defaultMapSize, MAP_SIZE_NAMES,
  type MapOptions, type TownLayout, type MapSizeName,
} from "../net/match-settings";

export {
  MAP_OPTIONS_OFF, MAP_OPTIONS_ON, defaultMapOptions, mapOptionsEqual, readMapOptions,
  readTownLayout, defaultTownLayout, readMapSize, defaultMapSize, MAP_SIZE_NAMES,
};
export type { MapOptions, TownLayout, MapSizeName };

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

/**
 * TOWN-2 (#653) / TOWN-4.3 (#679): the town street plan a boot generates with,
 * over the same chain of custody as the booleans (most specific wins):
 *
 *   1. an explicit option (`opts.layout`) — tests and debug boots;
 *   2. a URL param (`?layout=grid|organic|planned`) — for a NEW game only,
 *      exactly like `?shapes=`: a save never re-terrains under a URL;
 *   3. a resumed save's recorded layout — a record without the key predates
 *      TOWN-2 and was generated "grid", so it resumes "grid";
 *   4. a networked room's `MatchSettings.map.layout` — the HOST's record (a
 *      guest's URL cannot split the seats); a room without a map uses the
 *      new-game default;
 *   5. a story contract / scenario — OFF ("grid") unless the chapter says
 *      otherwise, the same rule its booleans play;
 *   6. otherwise `defaultTownLayout()` — "organic" for a new game, "grid"
 *      under the unit-test runner so the seed-pinned suites keep their maps.
 *      TOWN-4.3 (#679) ADDS "planned" to the chain and changes NO default:
 *      making it the new-game default is TOWN-4.5 (#681).
 *
 * Nothing here reads `KEYS`: the layout is not a boolean and never rides the
 * `?rivers=0|1` loop — it has its own names and its own param.
 */
export function resolveTownLayout(
  src: MapOptionSources,
  runnerDefault: TownLayout = defaultTownLayout(),
): TownLayout {
  // A resumed save is the map's own record: it wins over the URL, and an
  // absent key reads as the pre-TOWN-2 plan.
  if (src.save) return readTownLayout(src.save.map && (src.save.map as Record<string, unknown>).layout) ?? "grid";
  if (src.room) {
    return readTownLayout(src.room.map?.layout) ?? runnerDefault;
  }
  if (src.story || src.scenario) {
    const tuned = (src.story ?? src.scenario) as { mapOptions?: Partial<MapOptions> } | null | undefined;
    return readTownLayout(tuned?.mapOptions?.layout) ?? "grid";
  }
  const e = src.explicit?.layout;
  if (typeof e === "string") {
    const explicit = readTownLayout(e);
    if (explicit) return explicit;
  }
  let q: string | null = null;
  try { q = new URLSearchParams(src.search ?? "").get("layout"); } catch { q = null; }
  const fromUrl = readTownLayout(q);
  if (fromUrl) return fromUrl;
  return runnerDefault;
}

/**
 * TOWN-4.1 (#677): the map size a boot generates with — the ticket's chain,
 * most specific first:
 *
 *   1. an explicit option (`opts.size`) — tests and debug boots;
 *   2. a URL param (`?size=standard|large`) — for a NEW game only: never over
 *      a save or a room. `game.ts` counts `size` among the map params that
 *      start a fresh map (`mapParamsInUrl`), so a URL can never resize the
 *      map under a resumed save;
 *   3. a resumed save's recorded size — ABSENT = standard: every save written
 *      before TOWN-4.1 is a 144×144 map, and it reloads as one;
 *   4. a networked room's `MatchSettings.map.size` — the HOST's record, so a
 *      guest's own `?size=` cannot split the seats. Absent = standard too: a
 *      room whose settings predate the option (or name no size) plays the map
 *      it always did, even once TOWN-4.5 makes large the free-play default;
 *   5. a story contract / scenario — standard: tuned places (a chapter or a
 *      scenario may name a size in its `mapOptions`; none does);
 *   6. otherwise `defaultMapSize()` — standard, in this ticket, everywhere.
 *
 * The Starter Island and the tutorial lessons never get here: `game.ts`
 * hard-codes their whole map record (standard), exactly as it already does
 * their other map options — a first launch is a fixed place.
 */
export function resolveMapSize(
  src: MapOptionSources,
  newGameDefault: MapSizeName = defaultMapSize(),
): MapSizeName {
  const explicit = readMapSize(src.explicit?.size);
  if (explicit) return explicit;
  if (!src.save && !src.room) {
    let q: string | null = null;
    try { q = new URLSearchParams(src.search ?? "").get("size"); } catch { q = null; }
    const fromUrl = readMapSize(q);
    if (fromUrl) return fromUrl;
  }
  if (src.save) {
    const rec = src.save.map;
    return readMapSize(rec && typeof rec === "object" ? (rec as Record<string, unknown>).size : undefined)
      ?? "standard";
  }
  if (src.room) return readMapSize(src.room.map?.size) ?? "standard";
  if (src.story || src.scenario) {
    const tuned = (src.story ?? src.scenario) as { mapOptions?: Partial<MapOptions> } | null | undefined;
    return readMapSize(tuned?.mapOptions?.size) ?? "standard";
  }
  return newGameDefault;
}
