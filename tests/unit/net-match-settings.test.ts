// #186 — custom match settings: validation, presets, storage, and the welcome
// round-trip.
//
// The rule these pin is the one the whole feature rests on: TWO SEATS MUST AGREE
// ABOUT THE RULES. A settings block that crosses the wire is read by the room
// (before it stores it), by the guest (on its welcome) and by the host (on the
// echo) — three readers, one shape — so the reader is strict and total, and
// anything it cannot read whole is refused rather than half-applied. A guest
// racing to 10★ against a host racing to 5★ is the desync this protocol refuses
// mixed versions over, and it would look perfectly healthy until somebody won.
//
// Node environment on purpose: `match-settings.ts` is imported by the room
// bundle through `protocol.ts`, so it must survive with no window, no SDK and
// no game code. The one constant it shares with the game and cannot import
// (`START_PURSE`) is pinned from the jsdom suite that already boots the game —
// see `iso-game.test.ts`, "#186".
import { describe, it, expect } from "vitest";
import {
  AI_SKILL_KEYS,
  DEFAULT_MATCH_SETTINGS,
  DEFAULT_START_PURSE,
  DEFAULT_WIN_TARGET,
  MATCH_SETTINGS_STORAGE_KEY,
  MAX_AI_SEATS,
  PURSE_PRESETS,
  START_PURSE_KEYS,
  START_PURSE_MAX,
  WIN_TARGET_MAX,
  WIN_TARGET_MIN,
  WIN_TARGET_PRESETS,
  clampWinTarget,
  coerceMatchSettings,
  defaultMatchSettings,
  describeMatchSettings,
  isDefaultMatchSettings,
  loadMatchSettings,
  matchSettingsEqual,
  normalizeMatchSettings,
  pursePresetOf,
  readMatchSettings,
  saveMatchSettings,
  scalePurse,
  winPresetOf,
  type MatchSettings,
} from "../../src/net/match-settings";
import { PROTOCOL_VERSION, validateWelcome, type WelcomeMsg } from "../../src/net/protocol";
import { VICTORY } from "../../src/iso/config";
import { SKILL_KEYS } from "../../src/iso/skill";

function welcome(overrides: Partial<WelcomeMsg> = {}): WelcomeMsg {
  return {
    type: "welcome",
    seed: 123456,
    hostId: "host-1",
    protocolVersion: PROTOCOL_VERSION,
    roster: [
      { id: "host-1", username: "Host", slot: 0 },
      { id: "guest-2", username: "Guest", slot: 1 },
    ],
    ...overrides,
  };
}

/** A short-lived in-memory Storage, so the persistence path is really run. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => { void map.set(key, value); },
    get raw() { return map; },
  };
}

/** A host's customised room: 5★, Rich purse, one hard AI. */
const CUSTOM: MatchSettings = {
  aiSeats: ["hard"],
  winTarget: 5,
  startPurse: { wood: 24, stone: 24, ore: 0 },
};

describe("#186 defaults are the shipped game", () => {
  it("pins the default ★ line to VICTORY.target", () => {
    // The copy exists because `protocol.ts` (and so the room bundle) imports
    // this module, and `iso/config.ts` would drag the atlas manifest in. This
    // assertion is what keeps the copy from drifting.
    expect(DEFAULT_WIN_TARGET).toBe(VICTORY.target);
    expect(DEFAULT_MATCH_SETTINGS.winTarget).toBe(VICTORY.target);
  });

  it("pins the default purse keys to the ones the game grants", () => {
    // Wood + stone buy the opening Dirt Road; ore stays 0 because the paved
    // Road is gated behind an ore mine. Grain/oil are earned and gold is
    // sabotage money, so none of them is ever in a starting purse.
    expect([...START_PURSE_KEYS]).toEqual(["wood", "stone", "ore"]);
    expect(DEFAULT_START_PURSE).toEqual({ wood: 12, stone: 12, ore: 0 });
  });

  it("pins the AI difficulties to the shipped presets", () => {
    // Same reason as the ★ line: a copy that cannot drift, because a seat cast
    // at a key `RIVAL_SKILLS` does not know would read an undefined preset.
    expect([...AI_SKILL_KEYS]).toEqual([...SKILL_KEYS]);
  });

  it("reads as default when nothing was chosen", () => {
    expect(isDefaultMatchSettings(DEFAULT_MATCH_SETTINGS)).toBe(true);
    expect(isDefaultMatchSettings(defaultMatchSettings())).toBe(true);
    expect(isDefaultMatchSettings(null)).toBe(true);
    expect(isDefaultMatchSettings(undefined)).toBe(true);
    expect(isDefaultMatchSettings(CUSTOM)).toBe(false);
  });

  it("hands out a copy, so a caller cannot move the defaults", () => {
    const mine = defaultMatchSettings();
    mine.startPurse.wood = 999;
    mine.aiSeats.push("easy");
    expect(DEFAULT_MATCH_SETTINGS.startPurse.wood).toBe(12);
    expect(DEFAULT_MATCH_SETTINGS.aiSeats).toEqual([]);
  });
});

describe("#186 presets", () => {
  it("offers a short, standard, long and marathon ★ line, standard included", () => {
    expect(WIN_TARGET_PRESETS.map((p) => p.winTarget)).toEqual([5, VICTORY.target, 15, 20]);
    expect(winPresetOf(VICTORY.target)).toBe("standard");
    expect(winPresetOf(5)).toBe("short");
    expect(winPresetOf(7)).toBeNull();          // a stepper value is no preset
  });

  it("scales the purse by the multiplier, and never grants ore", () => {
    expect(scalePurse(0.5)).toEqual({ wood: 6, stone: 6, ore: 0 });
    expect(scalePurse(1)).toEqual(DEFAULT_START_PURSE);
    expect(scalePurse(2)).toEqual({ wood: 24, stone: 24, ore: 0 });
    expect(scalePurse(4)).toEqual({ wood: 48, stone: 48, ore: 0 });
  });

  it("round-trips a preset through pursePresetOf", () => {
    for (const preset of PURSE_PRESETS) {
      expect(pursePresetOf(scalePurse(preset.scale))).toBe(preset.key);
    }
    // A fine-tuned purse is nobody's preset — the lobby then prints the numbers.
    expect(pursePresetOf({ wood: 20, stone: 24, ore: 0 })).toBeNull();
  });

  it("clamps the stepper into the range it advertises", () => {
    expect(clampWinTarget(1)).toBe(WIN_TARGET_MIN);
    expect(clampWinTarget(900)).toBe(WIN_TARGET_MAX);
    expect(clampWinTarget(7.4)).toBe(7);
    expect(clampWinTarget(Number.NaN)).toBe(DEFAULT_WIN_TARGET);
    expect(scalePurse(Number.POSITIVE_INFINITY).wood).toBeLessThanOrEqual(START_PURSE_MAX);
  });

  it("describes a room's rules in one line, defaults included", () => {
    expect(describeMatchSettings(DEFAULT_MATCH_SETTINGS))
      .toBe(`First to ${VICTORY.target}★ · Standard resources`);
    expect(describeMatchSettings(CUSTOM)).toBe("First to 5★ · Rich 2× resources · AI Hard");
  });
});

describe("#186 normalizeMatchSettings — the strict wire reader", () => {
  it("reads a whole block back exactly", () => {
    expect(normalizeMatchSettings(CUSTOM)).toEqual(CUSTOM);
  });

  it("survives the wire: JSON out, JSON in, same record", () => {
    const round = normalizeMatchSettings(JSON.parse(JSON.stringify(CUSTOM)));
    expect(round).toEqual(CUSTOM);
    expect(matchSettingsEqual(round!, CUSTOM)).toBe(true);
  });

  it("fills in what a partial block leaves out", () => {
    expect(normalizeMatchSettings({ winTarget: 15 })).toEqual({
      aiSeats: [],
      winTarget: 15,
      startPurse: { ...DEFAULT_START_PURSE },
    });
    expect(normalizeMatchSettings({})).toEqual(DEFAULT_MATCH_SETTINGS);
  });

  it("drops keys it does not know instead of refusing the block", () => {
    // A settings block only ever grows; a reader that rejected the future would
    // turn every addition into a version bump for a field it does not use.
    const next = normalizeMatchSettings({
      ...CUSTOM,
      freeSetupScale: 2,
      startPurse: { ...CUSTOM.startPurse, uranium: 5 },
    });
    expect(next).toEqual(CUSTOM);
  });

  it("refuses anything it cannot read whole", () => {
    const refusals: unknown[] = [
      null, undefined, 0, "5★", [],
      { winTarget: "five" },                     // a ★ line that is not a number
      { winTarget: 7.5 },                        // …or not a whole star
      { winTarget: WIN_TARGET_MIN - 1 },         // …or outside the range
      { winTarget: WIN_TARGET_MAX + 1 },
      { aiSeats: "hard" },                       // seats are a list
      { aiSeats: ["medium"] },                   // an unknown difficulty
      { aiSeats: new Array(MAX_AI_SEATS + 1).fill("easy") },   // more seats than a match has
      { startPurse: "rich" },                    // a purse that is not a record
      { startPurse: [12, 12, 0] },               // …or a list
      { startPurse: { wood: "twelve" } },        // a line that is not a number
      { startPurse: { wood: -1 } },              // …or negative
      { startPurse: { wood: START_PURSE_MAX + 1 } },           // …or absurd
    ];
    for (const raw of refusals) {
      expect(normalizeMatchSettings(raw), JSON.stringify(raw) ?? String(raw)).toBeNull();
    }
  });

  it("is the reader the protocol re-exports", () => {
    expect(readMatchSettings).toBe(normalizeMatchSettings);
  });

  it("repairs a stale saved block instead of losing the lobby", () => {
    // A localStorage value is the player's own and may predate a cap or a
    // renamed preset. `coerce` is the lenient reader: salvage what reads,
    // default the rest, and never throw.
    expect(coerceMatchSettings({ winTarget: 99, aiSeats: ["medium", "easy"], startPurse: { wood: "x", stone: 30 } }))
      .toEqual({ aiSeats: ["easy"], winTarget: WIN_TARGET_MAX, startPurse: { wood: 12, stone: 30, ore: 0 } });
    expect(coerceMatchSettings("nonsense")).toEqual(DEFAULT_MATCH_SETTINGS);
  });
});

describe("#186 the welcome round-trip", () => {
  it("accepts a welcome with no settings at all — the room plays the defaults", () => {
    expect(validateWelcome(welcome())).toBeNull();
  });

  it("accepts a welcome carrying custom rules, whole", () => {
    const msg = welcome({ settings: CUSTOM });
    expect(validateWelcome(msg)).toBeNull();
    // …and the block that survives the wire is the block the host filed.
    const round = JSON.parse(JSON.stringify(msg)) as WelcomeMsg;
    expect(validateWelcome(round)).toBeNull();
    expect(normalizeMatchSettings(round.settings)).toEqual(CUSTOM);
  });

  it("refuses a welcome whose settings are malformed", () => {
    const bad = validateWelcome(welcome({ settings: { winTarget: 900 } as MatchSettings }));
    expect(bad).not.toBeNull();
    expect(bad!.code).toBe("malformed");
    // A half-read block is two seats playing different rules, so it is refused
    // rather than defaulted — the guest must not quietly race the shipped line.
    expect(validateWelcome(welcome({ settings: { aiSeats: ["medium"] } as MatchSettings }))).not.toBeNull();
    expect(validateWelcome(welcome({ settings: "rich" as unknown as MatchSettings }))).not.toBeNull();
  });

  it("still refuses a mixed-version room before it ever reads the settings", () => {
    const err = validateWelcome(welcome({ protocolVersion: PROTOCOL_VERSION - 1, settings: CUSTOM }));
    expect(err).not.toBeNull();
    expect(err!.code).toBe("version");
  });
});

describe("#186 remembering the host's last room", () => {
  it("returns the defaults when nothing was stored", () => {
    expect(loadMatchSettings(fakeStorage())).toEqual(DEFAULT_MATCH_SETTINGS);
    expect(loadMatchSettings(null)).toEqual(DEFAULT_MATCH_SETTINGS);
  });

  it("stores and reads back the last-used rules", () => {
    const storage = fakeStorage();
    saveMatchSettings(CUSTOM, storage);
    expect(storage.raw.get(MATCH_SETTINGS_STORAGE_KEY)).toBeDefined();
    expect(loadMatchSettings(storage)).toEqual(CUSTOM);
  });

  it("falls back to the defaults on a corrupt or hostile value", () => {
    expect(loadMatchSettings(fakeStorage({ [MATCH_SETTINGS_STORAGE_KEY]: "{not json" })))
      .toEqual(DEFAULT_MATCH_SETTINGS);
    expect(loadMatchSettings(fakeStorage({ [MATCH_SETTINGS_STORAGE_KEY]: "null" })))
      .toEqual(DEFAULT_MATCH_SETTINGS);
  });

  it("survives storage that throws (private mode)", () => {
    const hostile = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };
    expect(loadMatchSettings(hostile)).toEqual(DEFAULT_MATCH_SETTINGS);
    expect(() => saveMatchSettings(CUSTOM, hostile)).not.toThrow();
  });

  it("says when two records are the same rules", () => {
    expect(matchSettingsEqual(CUSTOM, { ...CUSTOM, startPurse: { ...CUSTOM.startPurse } })).toBe(true);
    expect(matchSettingsEqual(CUSTOM, { ...CUSTOM, winTarget: 6 })).toBe(false);
    expect(matchSettingsEqual(CUSTOM, { ...CUSTOM, aiSeats: [] })).toBe(false);
    expect(matchSettingsEqual(CUSTOM, { ...CUSTOM, startPurse: { wood: 25, stone: 24, ore: 0 } })).toBe(false);
  });
});
