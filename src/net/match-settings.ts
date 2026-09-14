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
}

/** The rules a host who touches nothing plays by — today's game, verbatim. */
export const DEFAULT_MATCH_SETTINGS: MatchSettings = {
  aiSeats: [],
  winTarget: DEFAULT_WIN_TARGET,
  startPurse: { ...DEFAULT_START_PURSE },
};

/** A fresh copy of the defaults (callers own what they hand back). */
export function defaultMatchSettings(): MatchSettings {
  return {
    aiSeats: [],
    winTarget: DEFAULT_WIN_TARGET,
    startPurse: { ...DEFAULT_START_PURSE },
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

  return { aiSeats, winTarget, startPurse };
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
    START_PURSE_KEYS.every((key) => a.startPurse[key] === b.startPurse[key])
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
 * The last settings this browser used, or the defaults.
 *
 * Storage is injectable for the same reason `resolveSkillKey`'s is: the suite
 * reads this without a window, and a private-mode browser that throws on read
 * gets the defaults rather than a broken lobby.
 */
export function loadMatchSettings(
  storage: Pick<Storage, "getItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): MatchSettings {
  if (!storage) return defaultMatchSettings();
  try {
    const raw = storage.getItem(MATCH_SETTINGS_STORAGE_KEY);
    if (!raw) return defaultMatchSettings();
    return coerceMatchSettings(JSON.parse(raw));
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
