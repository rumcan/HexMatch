// MAP-1 (#412): rivers + dams, elevation and shapes are ON for new games.
import { describe, expect, it, vi } from "vitest";
import {
  MAP_OPTIONS_OFF, MAP_OPTIONS_ON, mapOptionsEqual, readMapOptions, resolveMapOptions,
} from "../../src/iso/map-options";
import {
  DEFAULT_MATCH_SETTINGS, isDefaultMatchSettings, normalizeMatchSettings,
} from "../../src/net/match-settings";
import { generateMap } from "../../src/iso/grid";

describe("MAP-1 resolveMapOptions", () => {
  it("a new game outside the test runner is all ON", () => {
    vi.stubEnv("MODE", "production");
    try {
      expect(resolveMapOptions({})).toEqual(MAP_OPTIONS_ON);
    } finally { vi.unstubAllEnvs(); }
  });

  it("the unit-test runner defaults OFF (seed-pinned tests keep their maps)", () => {
    expect(resolveMapOptions({})).toEqual(MAP_OPTIONS_OFF);
  });

  it("URL params turn single features on or off for a new game", () => {
    vi.stubEnv("MODE", "production");
    try {
      expect(resolveMapOptions({ search: "?rivers=0" })).toEqual({ rivers: false, elevation: true, shapes: true });
    } finally { vi.unstubAllEnvs(); }
    expect(resolveMapOptions({ search: "?elevation=1" })).toEqual({ rivers: false, elevation: true, shapes: false });
  });

  it("explicit options beat everything", () => {
    expect(resolveMapOptions({ explicit: { shapes: true }, search: "?shapes=0" }).shapes).toBe(true);
  });

  it("a save resumes with its recorded options; a pre-MAP-1 save resumes all OFF", () => {
    expect(resolveMapOptions({ save: { map: { rivers: true, elevation: false, shapes: true } } }))
      .toEqual({ rivers: true, elevation: false, shapes: true });
    expect(resolveMapOptions({ save: {} })).toEqual(MAP_OPTIONS_OFF);
    // a URL param never re-terrains a resumed save
    expect(resolveMapOptions({ save: {}, search: "?rivers=1" })).toEqual(MAP_OPTIONS_OFF);
  });

  it("a room uses the host's options (a room without them uses the defaults: OFF here)", () => {
    expect(resolveMapOptions({ room: { map: { ...MAP_OPTIONS_ON } } })).toEqual(MAP_OPTIONS_ON);
    expect(resolveMapOptions({ room: {} })).toEqual(MAP_OPTIONS_OFF);
  });

  it("story contracts keep their tuned (OFF) map unless the chapter overrides", () => {
    expect(resolveMapOptions({ story: {} })).toEqual(MAP_OPTIONS_OFF);
    expect(resolveMapOptions({ story: { mapOptions: { rivers: true } } }).rivers).toBe(true);
  });

  it("reads wire values strictly", () => {
    expect(readMapOptions({ rivers: "yes" })).toBeNull();
    expect(readMapOptions(null)).toBeNull();
    expect(mapOptionsEqual(undefined, MAP_OPTIONS_OFF)).toBe(true);
  });
});

describe("MAP-1 room settings carry the map", () => {
  it("normalize keeps a valid map and drops a malformed one", () => {
    const s = normalizeMatchSettings({ ...DEFAULT_MATCH_SETTINGS, map: { rivers: true, elevation: true, shapes: false } })!;
    expect(s.map).toEqual({ rivers: true, elevation: true, shapes: false });
    // malformed or absent → no field (the boot uses the defaults)
    expect(normalizeMatchSettings({ winTarget: 10, map: { rivers: 3 } })!.map).toBeUndefined();
    expect(normalizeMatchSettings({ winTarget: 10 })!.map).toBeUndefined();
  });

  it("default rules (the ladder's question) include the default map", () => {
    expect(isDefaultMatchSettings(DEFAULT_MATCH_SETTINGS)).toBe(true);
    expect(isDefaultMatchSettings({ ...DEFAULT_MATCH_SETTINGS, map: { rivers: true, elevation: false, shapes: false } })).toBe(false);
  });
});

describe("MAP-1 maps generate with every feature on", () => {
  it("rivers, heights and a factory span exist on an all-ON map", () => {
    for (const seed of [7, 42, 1337]) {
      const g = generateMap(seed, { rivers: true, elevation: true, shapes: true });
      expect(g.rivers && g.rivers.some((v) => v === 1), `seed ${seed} has a river`).toBe(true);
      expect(g.height && g.height.some((v) => v > 0), `seed ${seed} has hills`).toBe(true);
    }
  });
});
