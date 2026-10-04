// ══════════════════════════════════════════════════════════════════════════
// #186 — custom match settings: the rules a HOSTED room plays by.
//
// A hosted room used to be one fixed game: two humans, the shipped ★ line and
// the shipped opening purse. This module is the whole of "and now the host may
// choose" — one plain-data record, the presets behind it, and the reader that
// turns an untrusted wire payload back into one.
//
//   aiSeats     the difficulty of each AI seat, in seat order. An AI seat is
//               simulated ON THE HOST and synced like any other seat; a guest
//               never runs one. Empty means an all-human room.
//   winTarget   the ★ line the match races to (`winTarget()` in game.ts reads
//               it for a networked seat, so the win check, the scoreboard, the
//               HUD badge and the star feed all move together).
//   startPurse  what EVERY seat starts with — the opening purse, as numbers
//               rather than a multiplier, so a guest can never disagree with
//               the host about what "2×" meant.
//
// Why this file exists on its own, and why it stays boring:
//
//   • BOTH sides import it. `protocol.ts` validates a settings block with it,
//     and `protocol.ts` is imported by the room bundle — so nothing here may
//     reach the SDK, the DOM or the game's art modules. The two constants it
//     shares with the game (`DEFAULT_WIN_TARGET`, `DEFAULT_START_PURSE`) are
//     declared here rather than imported from `iso/config.ts` / `iso/game.ts`
//     for exactly that reason, and `tests/unit/net-match-settings.test.ts`
//     pins each one against its game-side twin so the copy cannot drift.
//   • It is the ONE answer to "what does this room play by". The lobby edits
//     it, the welcome carries it, the room echoes it, and the game reads it —
//     four readers of one shape, which is only safe if the shape is total:
//     `normalizeMatchSettings` either returns a complete record or nothing.
//
// Defaults are sacred: a host who touches nothing gets exactly the game this
// repo shipped (`isDefaultMatchSettings` is what the lobby and the ladder both
// ask), so `DEFAULT_MATCH_SETTINGS` is the one value every reader falls back
// to — never a per-field guess at the call site.
// ══════════════════════════════════════════════════════════════════════════

/**
 * The AI difficulties a seat may be cast at, by key.
 *
 * Deliberately a COPY of `SKILL_KEYS` in `src/iso/skill.ts` rather than an
 * import: that module pulls the game's config (and with it the packed atlas
 * manifest) into every importer, and this one is imported by the server-side
 * room through `protocol.ts`. The copy is one line and it is pinned — see
 * `tests/unit/net-match-settings.test.ts`, which fails if `iso/skill.ts` grows
 * or renames a preset.
 */
// ── MAP-1 (#412): map features a room generates with ────────────────────
// Declared HERE (this file is the protocol's import-free leaf); the game
// reads them through iso/map-options.ts, which re-exports these.
/**
 * TOWN-2 (#653): which street plan a map's towns are generated with.
 *
 *   "grid"    — every town is a rectangle of 2×2 blocks on the 3-tile street
 *               lattice (`townLayout` in `iso/grid.ts`). This is every map
 *               generated before TOWN-2, every save that predates it, and
 *               every map generated under the unit-test runner.
 *   "organic" — the same lattice for the town's core, then a seeded irregular
 *               outline, one or two 45° avenues and merged long plots.
 *
 * Declared here, beside `MapOptions`, for the same reason the rest of the map
 * record lives here: this module is the protocol's import-free leaf, so the
 * room bundle and the game read ONE definition.
 */
export type TownLayout = "grid" | "organic" | "planned";

/** TOWN-2 / TOWN-4.3: the names `layout` may carry, for the wire/save readers. */
export const TOWN_LAYOUTS: readonly TownLayout[] = ["grid", "organic", "planned"];

/** Read a stored / wire town layout; anything else → null (the caller's
 *  default applies). Only the known names are accepted, so a hand-edited
 *  save can never hand the generator a layout it does not implement. */
export function readTownLayout(raw: unknown): TownLayout | null {
  return typeof raw === "string" && (TOWN_LAYOUTS as readonly string[]).includes(raw)
    ? (raw as TownLayout)
    : null;
}

/**
 * TOWN-4.5 (#681): the town layout a NEW game generates with — planned in a
 * shipped or dev build, grid under the unit-test runner. That is the
 * `defaultMapOptions()` rule one function down, and it is why every
 * seed-pinned suite keeps the rectangular towns it was written against:
 * nothing here has to know which tests exist, only that the runner's maps
 * do not move. (TOWN-2's default was organic; the flip to planned is this
 * ticket. Rooms that name no layout do NOT follow it — see
 * `defaultRoomTownLayout`, the pre-4.5 default old rooms keep playing.)
 */
export function defaultTownLayout(): TownLayout {
  let mode: string | undefined;
  try { mode = import.meta.env?.MODE; } catch { mode = undefined; }
  return mode === "test" ? "grid" : "planned";
}

/**
 * TOWN-4.5 (#681): the layout a ROOM that names none plays — organic in a
 * shipped or dev build, grid under the unit-test runner. This is the PRE-4.5
 * new-game default, kept so a room whose settings predate the option (no
 * `map.layout`) loads exactly the towns it always did, even though new games
 * and new rooms are planned now. New rooms carry an explicit layout (see
 * `defaultMatchSettings`), so this only ever serves old records.
 */
export function defaultRoomTownLayout(): TownLayout {
  let mode: string | undefined;
  try { mode = import.meta.env?.MODE; } catch { mode = undefined; }
  return mode === "test" ? "grid" : "organic";
}

/**
 * TOWN-4.1 (#677): the map's size, by NAME — `standard` (144×144: every save,
 * story chapter, scenario and room written before the option existed) or
 * `large` (216×216). The tile counts live in `MAP_SIZES`
 * (src/game/config.ts); this leaf only knows the names, for the same bundle
 * reason as `TownLayout` above.
 */
export type MapSizeName = "standard" | "large";

/** TOWN-4.1: the names `size` may carry, for the wire/save readers and `?size=`. */
export const MAP_SIZE_NAMES: readonly MapSizeName[] = ["standard", "large"];

/** Read a stored / wire / URL map size; anything else → null (the caller's
 *  rule applies). Only the known names pass, so a hand-edited save or a
 *  future build's record can never hand the generator a size it has no
 *  table entry for. */
export function readMapSize(raw: unknown): MapSizeName | null {
  return typeof raw === "string" && (MAP_SIZE_NAMES as readonly string[]).includes(raw)
    ? (raw as MapSizeName)
    : null;
}

/**
 * TOWN-4.5 (#681): the size a NEW game generates with — large in a shipped
 * or dev build, standard under the unit-test runner (the seed-pinned suites
 * keep their 144 maps). Nothing that reads an ABSENT size follows the flip:
 * old saves and old rooms read "standard" explicitly (`resolveMapSize`), so
 * they never resize under a player; only a new free-play game and a new room
 * (whose settings carry the size — see `defaultMatchSettings`) play large.
 */
export function defaultMapSize(): MapSizeName {
  let mode: string | undefined;
  try { mode = import.meta.env?.MODE; } catch { mode = undefined; }
  return mode === "test" ? "standard" : "large";
}

export interface MapOptions {
  rivers: boolean;
  elevation: boolean;
  shapes: boolean;
  /** #296: ring roads around towns. */
  rings: boolean;
  /**
   * #440: 45° (diagonal) roads.
   *
   * It rides here — beside the features that DO change the terrain — because
   * it needs exactly the same chain of custody: a new game's default, a
   * resumed save's own record, and ONE value both seats of a room agree on.
   * Unlike its neighbours it generates nothing; it only says whether a road
   * drag may leave the grid axis, so a room that changes it re-terrains
   * nothing and a save that changes it keeps every tile it had.
   */
  diag: boolean;
  /**
   * TOWN-2 (#653): the town street plan. OPTIONAL, and deliberately absent
   * from `MAP_OPTIONS_ON` / `MAP_OPTIONS_OFF` / `MAP_KEYS`:
   *
   *   • a record with no key was written before TOWN-2, and reads "grid" —
   *     the plan that map was actually generated with, so a resumed save never
   *     re-shapes its towns under the player;
   *   • a NEW game's default is `defaultTownLayout()` (organic outside the
   *     unit-test runner), applied by the boot rather than stored in the
   *     frozen constants, so the option records every reader pins keep the
   *     exact five-key shape they have always had.
   */
  layout?: TownLayout;
  /**
   * TOWN-4.1 (#677): the map's size. OPTIONAL and absent from the frozen
   * records and `MAP_KEYS`, on the `layout` pattern: a record without the key
   * was written before the option existed and IS a standard map — a save, a
   * room's settings or a story record all read it as "standard", so nothing
   * old ever resizes under a player. A new game's size is resolved by the
   * boot (`resolveMapSize`) and written back here, so its save records it.
   */
  size?: MapSizeName;
}
export const MAP_OPTIONS_OFF: Readonly<MapOptions> = Object.freeze({ rivers: false, elevation: false, shapes: false, rings: false, diag: false });
export const MAP_OPTIONS_ON: Readonly<MapOptions> = Object.freeze({ rivers: true, elevation: true, shapes: true, rings: true, diag: true });
export const MAP_KEYS = ["rivers", "elevation", "shapes", "rings", "diag"] as const;
/** The default for a NEW game: all ON (all OFF under the unit-test runner,
 *  so the seed-pinned tests about other things keep their maps — and the
 *  axis-only suites keep their axis-only roads, #440). */
export function defaultMapOptions(): MapOptions {
  let mode: string | undefined;
  try { mode = import.meta.env?.MODE; } catch { mode = undefined; }
  return { ...(mode === "test" ? MAP_OPTIONS_OFF : MAP_OPTIONS_ON) };
}
/** Read a stored / wire value; anything malformed → null. Missing keys read
 *  OFF — which is what keeps a pre-#440 save axis-only and a pre-MAP-1 save
 *  featureless, without a migration or a version bump. */
export function readMapOptions(raw: unknown): MapOptions | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out = { ...MAP_OPTIONS_OFF } as MapOptions;
  for (const k of MAP_KEYS) {
    if (o[k] === undefined) continue;
    if (typeof o[k] !== "boolean") return null;
    out[k] = o[k] as boolean;
  }
  // TOWN-2 (#653): the town layout rides the same record, with the same
  // strictness as the booleans — an unknown name drops the whole record
  // (the boot then plays the defaults) rather than quietly regenerating a
  // different street plan under a save. A MISSING key is left missing, so a
  // pre-TOWN-2 record keeps its exact shape; every reader resolves it.
  if (o.layout !== undefined) {
    const layout = readTownLayout(o.layout);
    if (!layout) return null;
    out.layout = layout;
  }
  // TOWN-4.1 (#677): the size, with the layout's strictness — an unknown name
  // drops the whole record rather than regenerating a different-sized map
  // under a save. A missing key stays missing (= standard; every reader
  // resolves it), so a pre-TOWN-4.1 record keeps its exact shape.
  if (o.size !== undefined) {
    const size = readMapSize(o.size);
    if (!size) return null;
    out.size = size;
  }
  return out;
}
/** Equality; an absent value means the defaults (see `MatchSettings.map`).
 *
 * TOWN-4.5 (#681): an absent layout/size reads as the CURRENT new-game
 * default on both sides (`defaultTownLayout()` / `defaultMapSize()`), so a
 * fresh room — whose settings carry the defaults explicitly — still equals
 * the map-less `DEFAULT_MATCH_SETTINGS`, and a pre-4.5 room (no layout/size
 * named) still reads as the shipped rules it played under. This is ONLY the
 * equality used by `isDefaultMatchSettings` and the lobby's dirty check: the
 * GENERATOR's readers (`resolveTownLayout` / `resolveMapSize`) resolve old
 * records to their pinned legacy values (organic/grid, standard), so old
 * rooms and old saves never re-terrain. */
export function mapOptionsEqual(a: MapOptions | null | undefined, b: MapOptions | null | undefined): boolean {
  const x = a ?? defaultMapOptions(), y = b ?? defaultMapOptions();
  return MAP_KEYS.every((k) => x[k] === y[k])
    && (x.layout ?? defaultTownLayout()) === (y.layout ?? defaultTownLayout())
    && (x.size ?? defaultMapSize()) === (y.size ?? defaultMapSize());
}

export const AI_SKILL_KEYS = ["easy", "normal", "hard"] as const;

/** One AI seat's difficulty. */
export type AiSkillKey = (typeof AI_SKILL_KEYS)[number];

/**
 * The ★ line a room that asks for nothing plays to. Aliases `VICTORY.target`
 * (`src/iso/config.ts`) — declared here for the bundle reason above and pinned
 * to it by the unit suite.
 */
export const DEFAULT_WIN_TARGET = 10;

/** Sane bounds for the stepper. Below 3★ the race is one lucky plant; past
 *  30★ it outlasts the session it was started in. */
export const WIN_TARGET_MIN = 3;
export const WIN_TARGET_MAX = 30;

/** The ★ choices the lobby offers. The stepper may land between them. */
export const WIN_TARGET_PRESETS: readonly { key: string; label: string; winTarget: number }[] = [
  { key: "short", label: "Short", winTarget: 5 },
  { key: "standard", label: "Standard", winTarget: DEFAULT_WIN_TARGET },
  { key: "long", label: "Long", winTarget: 15 },
  { key: "marathon", label: "Marathon", winTarget: 20 },
];

/**
 * The cargo a starting purse may grant.
 *
 * Wood and stone only ever buy Dirt Road (`TRANSPORT.dirt`), and ore is the
 * gate behind the paved Road — so these three ARE the opening purse, exactly
 * the keys `START_PURSE` in `src/iso/game.ts` carries. Grain and oil are
 * earned (depot expansion, processing) and gold is sabotage money (PP-08);
 * none of them is ever granted, at any multiplier.
 */
export const START_PURSE_KEYS = ["wood", "stone", "ore"] as const;

/** A granted key of the opening purse. */
export type StartPurseKey = (typeof START_PURSE_KEYS)[number];

/** What every seat starts with. Total: all three keys are always present. */
export type StartPurse = Record<StartPurseKey, number>;

/**
 * The opening purse a room that asks for nothing plays with — the numbers
 * `START_PURSE` in `src/iso/game.ts` ships with, pinned to it by the suite.
 */
export const DEFAULT_START_PURSE: StartPurse = { wood: 12, stone: 12, ore: 0 };

/** A ceiling on one purse line, so a hand-edited record cannot mint an
 *  unwinnable-by-economy game (or a number the HUD cannot print). */
export const START_PURSE_MAX = 240;

/** The multipliers the lobby offers, and the labels it prints for them. */
export const PURSE_PRESETS: readonly { key: string; label: string; scale: number }[] = [
  { key: "scarce", label: "Scarce ½×", scale: 0.5 },
  { key: "standard", label: "Standard", scale: 1 },
  { key: "rich", label: "Rich 2×", scale: 2 },
  { key: "tycoon", label: "Tycoon 4×", scale: 4 },
];

/**
 * How many AI seats a room may carry.
 *
 * One, because a match seats two players: `game.ts` runs `players[0]` (you)
 * and `players[1]` (the opponent), the wire's owner bytes and the seat mirror
 * in `session.ts` are built around exactly those two, and the ★ race is a
 * two-name scoreboard. So an AI seat is the opponent seat the host filled
 * rather than waited for — which is what "seats fill with AI when the host
 * starts early" means here. A room with THREE simultaneous seats (two humans
 * and an AI, or three humans) is the next step and needs the engine's seat
 * model first: the owner byte, the mirror and the scoreboard all speak two
 * seats today. Raising this constant alone would advertise seats the game
 * cannot seat, which is why the cap lives next to the reason.
 */
export const MAX_AI_SEATS = 1;

/** One room's rules, as they travel and as the game reads them. */
export interface MatchSettings {
  /** Difficulty per AI seat, in seat order. `[]` = an all-human room. */
  aiSeats: AiSkillKey[];
  /** The ★ line the match races to. */
  winTarget: number;
  /** What every seat starts with. */
  startPurse: StartPurse;
  /** MAP-1 (#412): the map features the room generates with — and, since
   *  #440, the road rule both seats build under (`map.diag`). TOWN-4.5
   *  (#681): a NEW room carries the size and town layout explicitly (large +
   *  planned — see `defaultMatchSettings`), so both seats agree even though
   *  the defaults moved. Absent = a room whose settings predate the option:
   *  the boot resolves it to the LEGACY map (standard, organic outside the
   *  runner), never the current defaults. This is why the HOST decides: the
   *  record is the room's, and a guest reads the same one it was handed
   *  rather than its own URL. */
  map?: MapOptions;
  /** MP-MGR (owner, 2026-09-29): do the managers' perks apply? Absent = ON
   *  (old clients and old rooms), so only `false` is ever written. The
   *  managers stay visible either way; only their perks stop. */
  perks?: boolean;
}

/** MP-MGR: do manager perks apply under these rules? Absent = yes. */
export function perksEnabled(settings: MatchSettings | null | undefined): boolean {
  return settings?.perks !== false;
}

/**
 * The rules a host who touches nothing plays by — today's game, verbatim.
 *
 * TOWN-4.5 (#681): deliberately map-LESS (frozen before the map had defaults
 * worth naming). It stays the wire-shape baseline — `normalizeMatchSettings`
 * of an empty block, the room's "no settings filed" state — while
 * `defaultMatchSettings()` below is the live copy new rooms and sessions
 * actually boot from, map included. `isDefaultMatchSettings` still reads
 * this as default (`mapOptionsEqual` resolves both sides' absent map to the
 * current defaults), so the ladder's question keeps working.
 */
export const DEFAULT_MATCH_SETTINGS: MatchSettings = {
  aiSeats: [],
  winTarget: DEFAULT_WIN_TARGET,
  startPurse: { ...DEFAULT_START_PURSE },
};

/**
 * A fresh copy of the defaults (callers own what they hand back — the map
 * record is built new on every call, like the purse).
 *
 * TOWN-4.5 (#681): carries the map explicitly — the booleans plus the current
 * new-game size and town layout (large + planned outside the unit-test
 * runner; all-OFF, standard + grid under it, which resolves exactly as an
 * absent map always did). A new room therefore PLAYS large + planned on both
 * seats even when the host files nothing (the room then holds no settings
 * and each seat boots its own copy of this), while an old room's map-less
 * record keeps resolving to the legacy map.
 */
export function defaultMatchSettings(): MatchSettings {
  return {
    aiSeats: [],
    winTarget: DEFAULT_WIN_TARGET,
    startPurse: { ...DEFAULT_START_PURSE },
    map: { ...defaultMapOptions(), layout: defaultTownLayout(), size: defaultMapSize() },
  };
}

/** The purse a multiplier buys, floored at 0 and capped for sanity. */
export function scalePurse(scale: number): StartPurse {
  const factor = Number.isFinite(scale) ? Math.max(0, scale) : 1;
  const out = {} as StartPurse;
  for (const key of START_PURSE_KEYS) {
    out[key] = Math.min(
      START_PURSE_MAX,
      Math.max(0, Math.round(DEFAULT_START_PURSE[key] * factor)),
    );
  }
  return out;
}

/**
 * Which preset a purse came from, or null when it was fine-tuned. `0` reads as
 * Scarce only if every line is 0 — an all-zero purse nobody chose is still
 * "not a preset", but Scarce's own 6/6/0 is unambiguous.
 */
export function pursePresetOf(purse: StartPurse): string | null {
  for (const preset of PURSE_PRESETS) {
    const scaled = scalePurse(preset.scale);
    if (START_PURSE_KEYS.every((key) => scaled[key] === purse[key])) return preset.key;
  }
  return null;
}

/** Which ★ preset a target matches, or null for a stepper value. */
export function winPresetOf(winTarget: number): string | null {
  return WIN_TARGET_PRESETS.find((p) => p.winTarget === winTarget)?.key ?? null;
}

/** The ★ line, clamped into the stepper's range and rounded to a whole star. */
export function clampWinTarget(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_WIN_TARGET;
  return Math.min(WIN_TARGET_MAX, Math.max(WIN_TARGET_MIN, Math.round(value)));
}

const isSkillKey = (raw: unknown): raw is AiSkillKey =>
  typeof raw === "string" && (AI_SKILL_KEYS as readonly string[]).includes(raw);

const isPurseKey = (raw: string): raw is StartPurseKey =>
  (START_PURSE_KEYS as readonly string[]).includes(raw);

/**
 * Read an untrusted settings block into a whole record, or null.
 *
 * This is the wire reader (`validateWelcome` calls it, and so does the room
 * before it stores a host's claim), so it is strict on purpose: a half-read
 * settings block is two seats playing different rules, which is precisely the
 * divergence a protocol version check exists to prevent. Anything it refuses
 * is a `null`, and every caller falls back to `DEFAULT_MATCH_SETTINGS` rather
 * than inventing a repair — except `coerceMatchSettings` below, which is the
 * lobby's lenient reader for a hand-edited localStorage value.
 *
 * Unknown EXTRA keys are dropped, not refused: a settings block only ever
 * grows, and a reader that rejected the future would turn every addition into
 * a version bump for a field it does not use.
 */
export function normalizeMatchSettings(raw: unknown): MatchSettings | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Partial<MatchSettings> & Record<string, unknown>;

  // ── AI seats ────────────────────────────────────────────────────────────
  let aiSeats: AiSkillKey[] = [];
  if (o.aiSeats !== undefined) {
    if (!Array.isArray(o.aiSeats)) return null;
    if (o.aiSeats.length > MAX_AI_SEATS) return null;
    for (const seat of o.aiSeats) if (!isSkillKey(seat)) return null;
    aiSeats = [...o.aiSeats];
  }

  // ── win target ──────────────────────────────────────────────────────────
  let winTarget = DEFAULT_WIN_TARGET;
  if (o.winTarget !== undefined) {
    if (typeof o.winTarget !== "number" || !Number.isFinite(o.winTarget)) return null;
    if (!Number.isInteger(o.winTarget)) return null;
    if (o.winTarget < WIN_TARGET_MIN || o.winTarget > WIN_TARGET_MAX) return null;
    winTarget = o.winTarget;
  }

  // ── starting purse ──────────────────────────────────────────────────────
  const startPurse: StartPurse = { ...DEFAULT_START_PURSE };
  if (o.startPurse !== undefined) {
    if (!o.startPurse || typeof o.startPurse !== "object" || Array.isArray(o.startPurse)) return null;
    for (const [key, value] of Object.entries(o.startPurse as Record<string, unknown>)) {
      if (!isPurseKey(key)) continue;               // a future cargo: ignore it
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      if (!Number.isInteger(value) || value < 0 || value > START_PURSE_MAX) return null;
      startPurse[key] = value;
    }
  }

  // ── map features (MAP-1 #412) — kept only when the host set them; absent
  //    or malformed means the defaults (read at boot, see map-options.ts) ──
  const map = o.map === undefined ? null : readMapOptions(o.map);

  // MP-MGR: only an explicit `false` is kept; anything else reads ON.
  const perks = o.perks === false ? { perks: false as const } : {};
  return map ? { aiSeats, winTarget, startPurse, map, ...perks } : { aiSeats, winTarget, startPurse, ...perks };
}

/**
 * The wire reader, named for the side that calls it: `validateWelcome` and the
 * room both read a settings block through this, exactly as they read a rating
 * through `readRankWire`.
 */
export const readMatchSettings = normalizeMatchSettings;

/**
 * The LOBBY's reader: everything it can salvage, defaults for the rest.
 *
 * A localStorage value is the player's own and may be stale (a preset that was
 * renamed, a purse line from an older cap), so it is repaired rather than
 * refused — a host whose last-used settings no longer parse should still get a
 * lobby, on the defaults, not an empty one. Anything not an object at all
 * reads as the defaults.
 */
export function coerceMatchSettings(raw: unknown): MatchSettings {
  return normalizeMatchSettings(raw) ?? repairMatchSettings(raw);
}

/** The salvage half of `coerceMatchSettings`, field by field. */
function repairMatchSettings(raw: unknown): MatchSettings {
  const out = defaultMatchSettings();
  if (!raw || typeof raw !== "object") return out;
  const o = raw as Record<string, unknown>;
  if (o.perks === false) out.perks = false;
  if (Array.isArray(o.aiSeats)) {
    out.aiSeats = o.aiSeats.filter(isSkillKey).slice(0, MAX_AI_SEATS);
  }
  if (typeof o.winTarget === "number") out.winTarget = clampWinTarget(o.winTarget);
  if (o.startPurse && typeof o.startPurse === "object" && !Array.isArray(o.startPurse)) {
    for (const [key, value] of Object.entries(o.startPurse as Record<string, unknown>)) {
      if (!isPurseKey(key) || typeof value !== "number" || !Number.isFinite(value)) continue;
      out.startPurse[key] = Math.min(START_PURSE_MAX, Math.max(0, Math.round(value)));
    }
  }
  return out;
}

/** Field-by-field equality — the lobby's "has anything moved" test. */
export function matchSettingsEqual(a: MatchSettings, b: MatchSettings): boolean {
  return (
    a.winTarget === b.winTarget &&
    a.aiSeats.length === b.aiSeats.length &&
    a.aiSeats.every((seat, i) => seat === b.aiSeats[i]) &&
    START_PURSE_KEYS.every((key) => a.startPurse[key] === b.startPurse[key]) &&
    mapOptionsEqual(a.map, b.map) &&
    perksEnabled(a) === perksEnabled(b)
  );
}

/**
 * Is this the shipped game? The ladder's one question (RANK-01: only a
 * default-rules match feeds the rating) and the lobby's "Reset to default"
 * button's disabled state.
 */
export function isDefaultMatchSettings(settings: MatchSettings | null | undefined): boolean {
  return matchSettingsEqual(settings ?? DEFAULT_MATCH_SETTINGS, DEFAULT_MATCH_SETTINGS);
}

/**
 * One line describing a room's rules, for the lobby's read-only view and the
 * boot toast. Defaults are said plainly so a guest can see at a glance that
 * nothing was changed.
 */
export function describeMatchSettings(settings: MatchSettings): string {
  const parts = [`First to ${settings.winTarget}★`];
  const preset = pursePresetOf(settings.startPurse);
  const purse = preset
    ? PURSE_PRESETS.find((p) => p.key === preset)?.label ?? "Standard"
    : `${settings.startPurse.wood} wood · ${settings.startPurse.stone} stone · ${settings.startPurse.ore} ore`;
  parts.push(`${purse} resources`);
  // TOWN-4.1 (#677): a guest should hear the map is bigger before it lands.
  // Standard (or absent) says nothing, so every existing line reads as before.
  // TOWN-4.5 (#681): "Large map" keeps printing now that large is the default —
  // a guest should still hear the map is big (and an old standard room reads
  // audibly different). A non-default town plan is named the same way;
  // planned (or absent) says nothing.
  if (settings.map?.size === "large") parts.push("Large map");
  if (settings.map?.layout === "organic") parts.push("Organic towns");
  else if (settings.map?.layout === "grid") parts.push("Grid towns");
  if (!perksEnabled(settings)) parts.push("No manager perks");
  if (settings.aiSeats.length > 0) {
    parts.push(settings.aiSeats
      .map((seat) => `AI ${seat.charAt(0).toUpperCase()}${seat.slice(1)}`)
      .join(", "));
  }
  return parts.join(" · ");
}

/** Where the host's last-used settings are remembered. */
export const MATCH_SETTINGS_STORAGE_KEY = "hexmatch:match-settings";

/**
 * Fill a stored record's map up to the CURRENT new-room defaults. A record
 * that names no map (every record stored before TOWN-4.5, when the lobby had
 * no map dials) or no layout/size gets the defaults for exactly the keys it
 * does not name — the host never chose a map, so a new room plays today's
 * default, shown and played identically, and stays a default-rules (ranked)
 * match. The WIRE reader (`normalizeMatchSettings`) deliberately does NOT do
 * this: an old room's map-less record must keep resolving to the legacy map.
 */
function withMapDefaults(settings: MatchSettings): MatchSettings {
  const map = settings.map;
  if (map && map.layout !== undefined && map.size !== undefined) return settings;
  return {
    ...settings,
    map: { ...defaultMapOptions(), layout: defaultTownLayout(), size: defaultMapSize(), ...map },
  };
}

/**
 * The last settings this browser used, or the defaults.
 *
 * Storage is injectable for the same reason `resolveSkillKey`'s is: the suite
 * reads this without a window, and a private-mode browser that throws on read
 * gets the defaults rather than a broken lobby.
 *
 * TOWN-4.5 (#681): a stored record always comes back with a COMPLETE map
 * (see `withMapDefaults`) — the lobby's dials show it, the room plays it.
 */
export function loadMatchSettings(
  storage: Pick<Storage, "getItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): MatchSettings {
  if (!storage) return defaultMatchSettings();
  try {
    const raw = storage.getItem(MATCH_SETTINGS_STORAGE_KEY);
    if (!raw) return defaultMatchSettings();
    return withMapDefaults(coerceMatchSettings(JSON.parse(raw)));
  } catch {
    return defaultMatchSettings();
  }
}

/** Remember the host's choice for the next room. Failures are silent: a
 *  browser that will not store it simply asks again next time. */
export function saveMatchSettings(
  settings: MatchSettings,
  storage: Pick<Storage, "setItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(MATCH_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch { /* private mode: the next room asks again */ }
}
