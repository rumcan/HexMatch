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
      expect(resolveMapOptions({ search: "?rivers=0" })).toEqual({ rivers: false, elevation: true, shapes: true, rings: true, diag: true });
    } finally { vi.unstubAllEnvs(); }
    expect(resolveMapOptions({ search: "?elevation=1" })).toEqual({ rivers: false, elevation: true, shapes: false, rings: false, diag: false });
  });

  it("explicit options beat everything", () => {
    expect(resolveMapOptions({ explicit: { shapes: true }, search: "?shapes=0" }).shapes).toBe(true);
  });

  it("a save resumes with its recorded options; a pre-MAP-1 save resumes all OFF", () => {
    expect(resolveMapOptions({ save: { map: { rivers: true, elevation: false, shapes: true } } }))
      .toEqual({ rivers: true, elevation: false, shapes: true, rings: false, diag: false });
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
    expect(s.map).toEqual({ rivers: true, elevation: true, shapes: false, rings: false, diag: false });
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

// ══════════════════════════════════════════════════════════════════════════
// #440 — 45° roads join the same chain. They generate no terrain, but they
// need the exact same custody: a new game's default, a resumed save's own
// record, and ONE value every seat of a room agrees on.
// ══════════════════════════════════════════════════════════════════════════
describe("#440 diagonal roads ride the map-options chain", () => {
  it("defaults ON for a new game and OFF under the unit-test runner", () => {
    expect(resolveMapOptions({}).diag).toBe(false);          // the runner: axis-only
    vi.stubEnv("MODE", "production");
    try {
      expect(resolveMapOptions({}).diag).toBe(true);         // a new game: 45° on
      expect(resolveMapOptions({}).diag).toBe(MAP_OPTIONS_ON.diag);
    } finally { vi.unstubAllEnvs(); }
  });

  it("?diag=0 turns them off and ?diag=1 turns them on, for a NEW game only", () => {
    vi.stubEnv("MODE", "production");
    try {
      expect(resolveMapOptions({ search: "?diag=0" }).diag).toBe(false);
      expect(resolveMapOptions({ search: "?diag=1" }).diag).toBe(true);
      // only 0 and 1 are read, exactly like ?rivers=
      expect(resolveMapOptions({ search: "?diag=nope" }).diag).toBe(true);
    } finally { vi.unstubAllEnvs(); }
    expect(resolveMapOptions({ search: "?diag=1" }).diag).toBe(true);   // explicit in the runner
    expect(resolveMapOptions({ explicit: { diag: false }, search: "?diag=1" }).diag).toBe(false);
  });

  it("a save keeps its own rule: a pre-#440 save stays axis-only", () => {
    vi.stubEnv("MODE", "production");
    try {
      const preMap = { rivers: true, elevation: true, shapes: true, rings: true };
      expect(resolveMapOptions({ save: { map: preMap } }).diag).toBe(false);
      expect(resolveMapOptions({ save: { map: { ...MAP_OPTIONS_ON } } }).diag).toBe(true);
      expect(resolveMapOptions({ save: { map: { ...MAP_OPTIONS_ON, diag: false } } }).diag).toBe(false);
      // a URL never re-rules a resumed save (the map-options rule for every key)
      expect(resolveMapOptions({ save: { map: preMap }, search: "?diag=1" }).diag).toBe(false);
      // a pre-MAP-1 save (no map at all) resumes all-OFF, diagonals included
      expect(resolveMapOptions({ save: {} }).diag).toBe(false);
    } finally { vi.unstubAllEnvs(); }
  });

  it("in a room the HOST's record wins — a guest's URL cannot split the seats", () => {
    vi.stubEnv("MODE", "production");
    try {
      expect(resolveMapOptions({ room: {} }).diag).toBe(true);                       // defaults
      const hostOff = { room: { map: { ...MAP_OPTIONS_ON, diag: false } } };
      expect(resolveMapOptions(hostOff).diag).toBe(false);
      expect(resolveMapOptions({ ...hostOff, search: "?diag=1" }).diag).toBe(false); // guest tries
      expect(resolveMapOptions({ room: { map: { ...MAP_OPTIONS_OFF, diag: true } } }).diag).toBe(true);
    } finally { vi.unstubAllEnvs(); }
  });

  it("a story contract keeps its tuned (axis-only) map unless the chapter says otherwise", () => {
    vi.stubEnv("MODE", "production");
    try {
      expect(resolveMapOptions({ story: {} }).diag).toBe(false);
      expect(resolveMapOptions({ story: { mapOptions: { diag: true } } }).diag).toBe(true);
    } finally { vi.unstubAllEnvs(); }
  });

  it("travels on the room wire, and a malformed value falls back to the default", () => {
    const off = { ...MAP_OPTIONS_ON, diag: false };
    expect(normalizeMatchSettings({ ...DEFAULT_MATCH_SETTINGS, map: off })!.map).toEqual(off);
    // a half-read map is dropped whole — the boot then uses the defaults (ON)
    expect(normalizeMatchSettings({ ...DEFAULT_MATCH_SETTINGS, map: { ...off, diag: "yes" } })!.map).toBeUndefined();
    // the ladder's question: a room that turned 45° roads off is not the
    // shipped game, exactly as one that turned rivers off is not.
    expect(isDefaultMatchSettings(DEFAULT_MATCH_SETTINGS)).toBe(true);
    expect(isDefaultMatchSettings({ ...DEFAULT_MATCH_SETTINGS, map: off })).toBe(false);
  });
});
