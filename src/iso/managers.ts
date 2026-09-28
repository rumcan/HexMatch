// ══════════════════════════════════════════════════════════════════════════
// CAST-1 — the managers' rulebook (docs/CAST.md).
//
// Pure on purpose: no DOM, no art, no storage. The game asks this file one
// question at each price seam it already has ("what does THIS seat pay for
// THIS class of build?") and the answer is a multiplier — so a perk is data,
// never a branch buried in a build function.
//
// Every rule here applies to the seat whose `manager` it is handed. The AI
// rival's seat carries `null`, and so does a game booted without a manager
// (every harness that calls `startIsoGame` directly): `null` is "no perk, no
// quirk", which keeps the BAL-1 gate and every AI test on today's numbers.
// ══════════════════════════════════════════════════════════════════════════

/** The five playable managers. Ids are stable — they are saved and wired. */
export type ManagerId = "james" | "anne" | "rafael" | "dolores" | "kenji";
export const MANAGER_IDS: readonly ManagerId[] = ["james", "anne", "rafael", "dolores", "kenji"];

/** Legacy start-screen portraits (PP-14b): "vex" was Anne, "you" was James. */
export type LegacyPortrait = "vex" | "you";
export const LEGACY_PORTRAIT: Record<LegacyPortrait, ManagerId> = { vex: "anne", you: "james" };

/** The manager a fresh machine (and an unreadable record) plays as. */
export const DEFAULT_MANAGER: ManagerId = "anne";

export const isManagerId = (v: unknown): v is ManagerId =>
  typeof v === "string" && (MANAGER_IDS as readonly string[]).includes(v);

/**
 * Any stored or wired portrait value → a manager id. Old saves, old links and
 * old localStorage carry "vex"/"you"; the new ids pass through; anything else
 * (absent, corrupt) reads as `fallback`.
 */
export function normalizeManager(raw: unknown, fallback: ManagerId = DEFAULT_MANAGER): ManagerId {
  if (isManagerId(raw)) return raw;
  if (raw === "vex" || raw === "you") return LEGACY_PORTRAIT[raw];
  return fallback;
}

/** Like `normalizeManager`, but `null` stays `null` (no manager = no perks). */
export function managerOrNull(raw: unknown): ManagerId | null {
  if (raw === null || raw === undefined) return null;
  if (isManagerId(raw) || raw === "vex" || raw === "you") return normalizeManager(raw);
  return null;
}

/** The price classes a perk can touch. Everything else is `other` (×1). */
export type BuildClass = "road" | "rail" | "level" | "other";

export interface ManagerPerks {
  /** Money multiplier per build class (absent = ×1). */
  build: Partial<Record<Exclude<BuildClass, "other">, number>>;
  /** Free Black Market sabotage cards per window (0 = none). */
  freeBlack: number;
  /** Security Forces: ×0 is free, ×1.5 the Fixer's quirk. */
  security: number;
  /** Gold multiplier on Black Market sabotage cards. */
  sabotageGold: number;
  /** Tuning-session score multiplier. */
  tuning: number;
}

const NONE: ManagerPerks = { build: {}, freeBlack: 0, security: 1, sabotageGold: 1, tuning: 1 };

/**
 * THE TABLE. Tuned modest on purpose — a 25% class discount is the biggest
 * number here, and each perk pays for itself with a quirk in another corner.
 *
 * CAST-2 (#558): the three unlockable managers were a touch WEAKER than the
 * starting pair (James, Anne), so hiring one felt like no reward. Each is now
 * slightly better — the perk buffed or the quirk softened, never both, and
 * never past the starters' 25% ceiling: Rafael's allowance is 4 free cards,
 * Dolores pays 10% (not 20%) more for sabotage, Kenji's tuning is +20%. The
 * numbers stay player-seat only, so the BAL-1 gate and every AI test read the
 * AI rival's null seat and are untouched.
 */
export const PERKS: Record<ManagerId, ManagerPerks> = {
  james: { ...NONE, build: { road: 0.75, rail: 1.1 } },
  anne: { ...NONE, build: { rail: 0.75, road: 1.1 } },
  rafael: { ...NONE, freeBlack: 4, security: 1.5 },
  dolores: { ...NONE, security: 0, sabotageGold: 1.1 },
  kenji: { ...NONE, tuning: 1.2, build: { level: 1.25 } },
};

export const perksOf = (id: ManagerId | null | undefined): ManagerPerks =>
  (id && PERKS[id]) || NONE;

/** The class multiplier this manager pays (1 for none / other). */
export function buildMultiplier(id: ManagerId | null | undefined, cls: BuildClass): number {
  if (cls === "other") return 1;
  return perksOf(id).build[cls] ?? 1;
}

/**
 * A money price after the perk, in whole dollars. A discount rounds DOWN and a
 * surcharge rounds UP — so the effective balance below can promise that any
 * drag the preview calls affordable is one the charge can take (a commit that
 * builds first and charges second must never find the purse short). A
 * positive price never rounds to free.
 */
export function perkPrice(base: number, id: ManagerId | null | undefined, cls: BuildClass): number {
  const m = buildMultiplier(id, cls);
  if (m === 1 || base <= 0) return base;
  return Math.max(1, m < 1 ? Math.floor(base * m + 1e-9) : Math.ceil(base * m - 1e-9));
}

/**
 * The balance a drag preview should test affordability against, so that
 * "base ≤ effective balance" ⇒ "perkPrice(base) ≤ money". Lets the pure track
 * and rail previews stay perk-blind.
 */
export function effectiveBalance(money: number, id: ManagerId | null | undefined, cls: BuildClass): number {
  const m = buildMultiplier(id, cls);
  if (m === 1) return money;
  return m < 1 ? money / m : Math.floor(money) / m;
}

/** Gold a sabotage card costs this manager (rounded up, like every surcharge). */
export function sabotageGold(base: number, id: ManagerId | null | undefined): number {
  const m = perksOf(id).sabotageGold;
  return m === 1 ? base : Math.ceil(base * m - 1e-9);
}

/** A Security Forces bill after the perk — `{}` when it is free. */
export function securityCost<K extends string>(
  base: Partial<Record<K, number>>, id: ManagerId | null | undefined,
): Partial<Record<K, number>> {
  const m = perksOf(id).security;
  if (m === 1) return { ...base };
  const out: Partial<Record<K, number>> = {};
  if (m === 0) return out;
  for (const [k, v] of Object.entries(base) as [K, number][]) out[k] = Math.ceil(v * m - 1e-9);
  return out;
}

/** A tuning-session score after the perk (whole points). */
export function tuningScore(score: number, id: ManagerId | null | undefined): number {
  const m = perksOf(id).tuning;
  return m === 1 ? score : Math.round(score * m);
}

// ── Rafael's Fixer allowance ───────────────────────────────────────────────
/** One refill window: 5 minutes of PLAY (the match clock, not the wall). */
export const FIXER_WINDOW_MS = 5 * 60_000;

/**
 * The allowance is STATELESS about refills: it stores which window the last
 * spend happened in and how many were used there. A new window is a full
 * allowance — the counter can never stack past 3, and a save or a wire only
 * needs the two numbers.
 */
export interface FixerState {
  window: number;
  used: number;
}

export const freshFixer = (): FixerState => ({ window: 0, used: 0 });

const windowOf = (playMs: number) => Math.max(0, Math.floor(playMs / FIXER_WINDOW_MS));

/** Free cards left right now (0 for a manager without the perk). */
export function fixerLeft(state: FixerState | null | undefined, id: ManagerId | null | undefined, playMs: number): number {
  const max = perksOf(id).freeBlack;
  if (max <= 0) return 0;
  const s = state ?? freshFixer();
  return s.window === windowOf(playMs) ? Math.max(0, max - s.used) : max;
}

/** Milliseconds of play until the allowance refills. */
export const fixerRefillIn = (playMs: number): number =>
  FIXER_WINDOW_MS - (Math.max(0, playMs) % FIXER_WINDOW_MS);

/**
 * Spend one free card if one is left. Returns the new state, or null when the
 * seat has none (the caller then charges Gold as usual).
 */
export function spendFixer(
  state: FixerState | null | undefined, id: ManagerId | null | undefined, playMs: number,
): FixerState | null {
  if (fixerLeft(state, id, playMs) <= 0) return null;
  const w = windowOf(playMs);
  const s = state ?? freshFixer();
  return s.window === w ? { window: w, used: s.used + 1 } : { window: w, used: 1 };
}

/** Read a fixer record off a save / wire (anything malformed = fresh). */
export function readFixer(raw: unknown): FixerState {
  const o = raw as Partial<FixerState> | null;
  const w = o && typeof o.window === "number" && Number.isFinite(o.window) ? Math.max(0, Math.floor(o.window)) : 0;
  const u = o && typeof o.used === "number" && Number.isFinite(o.used) ? Math.max(0, Math.floor(o.used)) : 0;
  return { window: w, used: u };
}

// ── Unlocks: earned by PLAY ─────────────────────────────────────────────────
/** What the unlock rules read: the player's record of wins. */
export interface ManagerRecord {
  wins: number;
  /** Wins at Normal or harder (solo), plus multiplayer wins. */
  hardWins: number;
  scenarioWins: number;
  /** Sticky: once hired, a manager stays hired whatever the counters say. */
  unlocked: ManagerId[];
}

export const FRESH_RECORD: ManagerRecord = { wins: 0, hardWins: 0, scenarioWins: 0, unlocked: ["james", "anne"] };

export interface UnlockRule {
  /** The line printed on a locked card. */
  label: string;
  met: (r: ManagerRecord) => boolean;
}

export const UNLOCKS: Record<ManagerId, UnlockRule> = {
  james: { label: "Hired from the start", met: () => true },
  anne: { label: "Hired from the start", met: () => true },
  rafael: { label: "Win 1 match to hire", met: (r) => r.wins >= 1 },
  dolores: { label: "Win a match on Normal or Hard to hire", met: (r) => r.hardWins >= 1 },
  kenji: { label: "Win 3 matches or any Scenario to hire", met: (r) => r.wins >= 3 || r.scenarioWins >= 1 },
};

export const isUnlocked = (r: ManagerRecord, id: ManagerId): boolean =>
  r.unlocked.includes(id) || UNLOCKS[id].met(r);

/** One finished match, as the unlock rules see it. */
export interface MatchOutcome {
  won: boolean;
  /** Solo difficulty key ("trainee" | "easy" | "normal" | "hard"), or null. */
  skill: string | null;
  multiplayer: boolean;
  scenario: boolean;
  /** The Starter Island tutorial — never counts. */
  tutorial?: boolean;
}

/**
 * Fold one match into the record. Returns the new record and the managers
 * this result hired (for the ending card's "New manager unlocked!").
 */
export function recordOutcome(r: ManagerRecord, m: MatchOutcome): { record: ManagerRecord; hired: ManagerId[] } {
  if (!m.won || m.tutorial) return { record: r, hired: [] };
  const hard = m.multiplayer || m.skill === "normal" || m.skill === "hard";
  const next: ManagerRecord = {
    wins: r.wins + 1,
    hardWins: r.hardWins + (hard ? 1 : 0),
    scenarioWins: r.scenarioWins + (m.scenario ? 1 : 0),
    unlocked: [...r.unlocked],
  };
  const hired: ManagerId[] = [];
  for (const id of MANAGER_IDS) {
    if (!isUnlocked(r, id) && UNLOCKS[id].met(next)) hired.push(id);
    if (UNLOCKS[id].met(next) && !next.unlocked.includes(id)) next.unlocked.push(id);
  }
  return { record: next, hired };
}

/** Parse a stored record; corruption reads as a fresh one (never a lock-out). */
export function readRecord(raw: unknown): ManagerRecord {
  const o = raw as Partial<ManagerRecord> | null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  const unlocked = new Set<ManagerId>(FRESH_RECORD.unlocked);
  if (o && Array.isArray(o.unlocked)) for (const id of o.unlocked) if (isManagerId(id)) unlocked.add(id);
  return {
    wins: n(o?.wins), hardWins: n(o?.hardWins), scenarioWins: n(o?.scenarioWins),
    unlocked: MANAGER_IDS.filter((id) => unlocked.has(id)),
  };
}
