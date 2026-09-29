// ══════════════════════════════════════════════════════════════════════
// CAST-1 — the managers' rulebook (docs/CAST.md).
//
// Pure on purpose: no DOM, no art, no storage. The game asks this file one
// question at each price seam it already has ("what does THIS seat pay for
// THIS class of build?") and the answer is a multiplier — so a perk is data,
// never a branch buried in a build function.
//
// PERK-1 (#600) — five named perks per manager:
//
// The source of truth is `MANAGER_PERKS` below: one array of NAMED `PerkDef`
// entries per manager — the five perks + the one quirk each (the quirk
// flagged). The table the rules read, `PERKS` / `perksOf`, is DERIVED from
// the list, so cutting a perk is deleting its one entry: the numbers, the
// UI copy (via the story layer) and the battle flags all follow.
//
// Every rule here applies to the seat whose `manager` it is handed. The AI
// rival's seat carries `null`, and so does a game booted without a manager
// (every harness that calls `startIsoGame` directly): `null` is "no perk, no
// quirk", which keeps the BAL-1 gate and every AI test on today's numbers.
// ══════════════════════════════════════════════════════════════════════

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

/**
 * The price classes a perk can touch. Everything else is `other` (×1).
 *
 * PERK-1 (#600): "rail" now means TRACKS ONLY — the platform, the station
 * lane and the train depot became their own classes (Anne's own cuts cover
 * them), and the Depot bill moved to its own class too (James's Yard Deal).
 * The charge sites in game.ts pass the new classes; a class no perk prices
 * reads exactly the base price.
 */
export type BuildClass =
  | "road"        // dirt road, street, road, highway, ramps, road bridges/overpasses
  | "rail"        // rail track only (switches included) — platforms, lanes, depots aside
  | "level"       // Level Ground
  | "depot"       // the Depot bill (the tree's money leg)
  | "platform"    // the rail platform
  | "trainDepot"  // the Train Depot (the car shop)
  | "other";      // everything else — no perk touches it

/** One effect a perk (or a quirk) carries — the data the game reads. */
export type PerkEffect =
  | { kind: "build"; cls: Exclude<BuildClass, "other">; mult: number }
  | { kind: "speed"; vehicle: "truck" | "train"; mult: number }
  | { kind: "freeBlack"; cards: number }
  | { kind: "security"; mult: number }
  | { kind: "sabotageGold"; mult: number }
  | { kind: "tuning"; mult: number }
  | { kind: "extraMoves"; moves: number }
  | { kind: "buyMoves"; gold: number; uses: number }
  | { kind: "battle"; which: "extraTurnOnce" | "match4ExtraTurn" | "encore" }
  | { kind: "sabotageBonus"; tiles: number }
  | { kind: "returnToSender" }
  | { kind: "shortcut"; lineCap: number }
  | { kind: "startingSpecial"; special: "disco" }
  | { kind: "secondSight" }
  | { kind: "fleet"; vehicle: "truck" | "train"; mult: number };

/** A named perk. The entry IS the feature — delete it to cut it. */
export interface PerkDef {
  /** Stable id — the pruner's handle ("james-yard-deal"). */
  id: string;
  /** The profile card's small-caps line ("Road Crew"). */
  title: string;
  /** The one line the profile card and the picker print. */
  text: string;
  /** Marks the quirk — the manager's single downside (CAST-2 keeps one). */
  quirk?: boolean;
  effect: PerkEffect;
}

/**
 * The per-manager perk table, as the game reads it — DERIVED from
 * `MANAGER_PERKS` (`derivePerks` below). Null seats read the `NONE` row.
 */
export interface ManagerPerks {
  /** Money multiplier per build class (absent = ×1). */
  build: Partial<Record<Exclude<BuildClass, "other">, number>>;
  /** Free Black Market sabotage cards per window (0 = none). */
  freeBlack: number;
  /** Security Forces: ×0 is free, ×1.5 the Fixer's quirk. */
  security: number;
  /** Gold multiplier on Black Market sabotage cards. */
  sabotageGold: number;
  /** Tuning-session score multiplier (Kenji: 1.25, PERK-1). */
  tuning: number;
  /** PERK-1 — the seat's trucks run the base rate × this (James: 1.2). */
  truckSpeed: number;
  /** PERK-1 — the seat's trains run the base rate × this (Anne: 1.2). */
  trainSpeed: number;
  /** PERK-1 — extra tuning-session moves (Dolores: +3). */
  extraMoves: number;
  /** PERK-1 — the session's extra-moves buy: the Gold price and the uses per
   *  session (Rafael: 8 ×1; Dolores: 4 ×2). Null = the seat has no buy. */
  buyMoves: { gold: number; uses: number } | null;
  /** PERK-1 — the seat's OWN session sabotage lands this many tiles extra
   *  (Rafael's Heavy Hands: +1 frost, +1 girder). */
  sabotageBonus: number;
  /** PERK-1 — the first sabotage played ON this seat each match bounces back
   *  to its sender (Dolores: Return to Sender). */
  returnToSender: boolean;
  /** PERK-1 — the match-3 board mints shortcut specials (Kenji). */
  shortcut: boolean;
  /** PERK-1 — the free shortcut mints per session (Kenji: 3; 0 when off). */
  shortcutLineCap: number;
  /** PERK-1 — the session board opens with this special (Kenji: disco). */
  startingSpecial: "disco" | null;
  /** PERK-1 — the session's hint + free reshuffle keys (Kenji's Second Sight). */
  secondSight: boolean;
  /** PERK-1 — rival battles: one extra turn, once per battle (Rafael). */
  battleExtraTurnOnce: boolean;
  /** PERK-1 — rival battles: a match of 4 earns an extra turn (Dolores). */
  battleMatch4: boolean;
  /** PERK-1 — rival battles: one bonus turn at the end of every round (Kenji). */
  battleEncore: boolean;
  /** PERK-1 — the FLEET upgrade-price multipliers (no-op until FLEET-4/FLEET-5
   *  wire the upgrade price through `fleetUpgradePrice`; #598/#599). */
  fleet: Partial<Record<"truck" | "train", number>>;
}

const NONE: ManagerPerks = {
  build: {},
  freeBlack: 0,
  security: 1,
  sabotageGold: 1,
  tuning: 1,
  truckSpeed: 1,
  trainSpeed: 1,
  extraMoves: 0,
  buyMoves: null,
  sabotageBonus: 0,
  returnToSender: false,
  shortcut: false,
  shortcutLineCap: 0,
  startingSpecial: null,
  secondSight: false,
  battleExtraTurnOnce: false,
  battleMatch4: false,
  battleEncore: false,
  fleet: {},
};

/**
 * ── PERK-1: the five perks + the quirk, per manager ────────────────────
 *
 * THE TABLE. The numbers are the CAST-1/CAST-2 reference (docs/CAST.md)
 * plus PERK-1's named roster: one line per entry, and the order below is
 * the display order — the profile card and the picker print them top to
 * bottom, quirk last. Cutting a perk is deleting its entry.
 *
 * Copy rules: player-facing — no `//`, no `(#` shorthand, no "L7 (" level
 * shorthand (the ui-copy-guard's list).
 */
export const MANAGER_PERKS: Record<ManagerId, readonly PerkDef[]> = {
  james: [
    {
      id: "james-road-crew",
      title: "Road Crew",
      text: "Every road you lay costs 25% less.",
      effect: { kind: "build", cls: "road", mult: 0.75 },
    },
    {
      id: "james-yard-deal",
      title: "Yard Deal",
      text: "Depots cost 10% less.",
      effect: { kind: "build", cls: "depot", mult: 0.9 },
    },
    {
      id: "james-lead-foot",
      title: "Lead Foot",
      text: "Your Depot trucks drive 20% faster.",
      effect: { kind: "speed", vehicle: "truck", mult: 1.2 },
    },
    {
      id: "james-earthmover",
      title: "Earthmover",
      text: "Level Ground costs 20% less.",
      effect: { kind: "build", cls: "level", mult: 0.8 },
    },
    {
      id: "james-fleet-discount",
      title: "Fleet Discount",
      text: "Truck upgrades cost 15% less.",
      effect: { kind: "fleet", vehicle: "truck", mult: 0.85 },
    },
    {
      id: "james-rail-skeptic",
      title: "Rail Skeptic",
      text: "Rail track costs 10% more. He never trusted a train he couldn't overtake.",
      quirk: true,
      effect: { kind: "build", cls: "rail", mult: 1.1 },
    },
  ],
  anne: [
    {
      id: "anne-iron-rails",
      title: "Iron Rails",
      text: "Rail track costs 25% less.",
      effect: { kind: "build", cls: "rail", mult: 0.75 },
    },
    {
      id: "anne-station-master",
      title: "Station Master",
      text: "Platforms and station lanes cost 10% less.",
      effect: { kind: "build", cls: "platform", mult: 0.9 },
    },
    {
      id: "anne-express",
      title: "Express",
      text: "Your trains run 20% faster.",
      effect: { kind: "speed", vehicle: "train", mult: 1.2 },
    },
    {
      id: "anne-shed-deal",
      title: "Shed Deal",
      text: "Train Depots cost 10% less.",
      effect: { kind: "build", cls: "trainDepot", mult: 0.9 },
    },
    {
      id: "anne-loco-works",
      title: "Loco Works",
      text: "Train upgrades cost 15% less.",
      effect: { kind: "fleet", vehicle: "train", mult: 0.85 },
    },
    {
      id: "anne-lorry-doubt",
      title: "Lorry Doubt",
      text: "Road ways cost 10% more. A lorry is a train that lost its nerve.",
      quirk: true,
      effect: { kind: "build", cls: "road", mult: 1.1 },
    },
  ],
  rafael: [
    {
      id: "rafael-connections",
      title: "Connections",
      text: "Four free Black Market sabotage cards every five minutes.",
      effect: { kind: "freeBlack", cards: 4 },
    },
    {
      id: "rafael-friends-price",
      title: "Friends Price",
      text: "Black Market sabotage costs 25% less Gold.",
      effect: { kind: "sabotageGold", mult: 0.75 },
    },
    {
      id: "rafael-overtime-crew",
      title: "Overtime Crew",
      text: "Buy 3 extra moves in a tuning session for 8 Gold, once per session.",
      effect: { kind: "buyMoves", gold: 8, uses: 1 },
    },
    {
      id: "rafael-sucker-punch",
      title: "Sucker Punch",
      text: "In rival battles you get one extra turn, once per battle.",
      effect: { kind: "battle", which: "extraTurnOnce" },
    },
    {
      id: "rafael-heavy-hands",
      title: "Heavy Hands",
      text: "Your Frost and Iron Girders land one extra tile.",
      effect: { kind: "sabotageBonus", tiles: 1 },
    },
    {
      id: "rafael-guards-price",
      title: "Guards Price",
      text: "Security Forces cost 50% more. He knows what guards can be paid to overlook.",
      quirk: true,
      effect: { kind: "security", mult: 1.5 },
    },
  ],
  dolores: [
    {
      id: "dolores-private-guard",
      title: "Private Guard",
      text: "Security Forces are free.",
      effect: { kind: "security", mult: 0 },
    },
    {
      id: "dolores-stamina",
      title: "Stamina",
      text: "You get 3 extra moves in every tuning session.",
      effect: { kind: "extraMoves", moves: 3 },
    },
    {
      id: "dolores-bulk-buyer",
      title: "Bulk Buyer",
      text: "Buy 3 extra moves for 4 Gold, twice per session.",
      effect: { kind: "buyMoves", gold: 4, uses: 2 },
    },
    {
      id: "dolores-momentum",
      title: "Momentum",
      text: "In rival battles, a match of 4 earns you an extra turn.",
      effect: { kind: "battle", which: "match4ExtraTurn" },
    },
    {
      id: "dolores-return-to-sender",
      title: "Return to Sender",
      text: "The first sabotage played on you each match bounces back to its sender.",
      effect: { kind: "returnToSender" },
    },
    {
      id: "dolores-quiet-money",
      title: "Quiet Money",
      text: "Black Market sabotage costs 10% more Gold. She pays extra so nobody can say she was there.",
      quirk: true,
      effect: { kind: "sabotageGold", mult: 1.1 },
    },
  ],
  kenji: [
    {
      id: "kenji-shortcut",
      title: "Shortcut",
      text: "Specials need one gem fewer to mint, and three of a kind leave a line. Three free lines per session.",
      effect: { kind: "shortcut", lineCap: 3 },
    },
    {
      id: "kenji-showman",
      title: "Showman",
      text: "Your tuning sessions score 25% more.",
      effect: { kind: "tuning", mult: 1.25 },
    },
    {
      id: "kenji-opening-act",
      title: "Opening Act",
      text: "Every tuning session starts with a disco ball on the board.",
      effect: { kind: "startingSpecial", special: "disco" },
    },
    {
      id: "kenji-encore",
      title: "Encore",
      text: "In rival battles, you take one bonus turn at the end of every round.",
      effect: { kind: "battle", which: "encore" },
    },
    {
      id: "kenji-second-sight",
      title: "Second Sight",
      text: "In a tuning session, the hint shows your best move and one reshuffle is free.",
      effect: { kind: "secondSight" },
    },
    {
      id: "kenji-stage-fright",
      title: "Stage Fright",
      text: "Level Ground costs 25% more. He would rather redraw the plan than move the hill.",
      quirk: true,
      effect: { kind: "build", cls: "level", mult: 1.25 },
    },
  ],
};

function derivePerks(id: ManagerId): ManagerPerks {
  const p: ManagerPerks = { ...NONE, build: {}, fleet: {} };
  for (const perk of MANAGER_PERKS[id]) {
    const e = perk.effect;
    switch (e.kind) {
      case "build":
        p.build[e.cls] = e.mult;
        break;
      case "speed":
        if (e.vehicle === "truck") p.truckSpeed = e.mult;
        else p.trainSpeed = e.mult;
        break;
      case "freeBlack":
        p.freeBlack = Math.max(p.freeBlack, e.cards);
        break;
      case "security":
        p.security = e.mult;
        break;
      case "sabotageGold":
        p.sabotageGold *= e.mult;
        break;
      case "tuning":
        p.tuning = e.mult;
        break;
      case "extraMoves":
        p.extraMoves += e.moves;
        break;
      case "buyMoves":
        p.buyMoves = { gold: e.gold, uses: e.uses };
        break;
      case "battle":
        if (e.which === "extraTurnOnce") p.battleExtraTurnOnce = true;
        else if (e.which === "match4ExtraTurn") p.battleMatch4 = true;
        else p.battleEncore = true;
        break;
      case "sabotageBonus":
        p.sabotageBonus += e.tiles;
        break;
      case "returnToSender":
        p.returnToSender = true;
        break;
      case "shortcut":
        p.shortcut = true;
        p.shortcutLineCap = e.lineCap;
        break;
      case "startingSpecial":
        p.startingSpecial = e.special;
        break;
      case "secondSight":
        p.secondSight = true;
        break;
      case "fleet":
        p.fleet[e.vehicle] = e.mult;
        break;
    }
  }
  return p;
}

/**
 * THE TABLE, as the rules read it — derived from `MANAGER_PERKS` above.
 * Null seats (the AI rival, a game booted without a manager) read `NONE`.
 */
export const PERKS: Record<ManagerId, ManagerPerks> = {
  james: derivePerks("james"),
  anne: derivePerks("anne"),
  rafael: derivePerks("rafael"),
  dolores: derivePerks("dolores"),
  kenji: derivePerks("kenji"),
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

// ── PERK-1: the named-perk seams the game reads ───────────────────────────

/**
 * The named perk rows a seat prints — the profile card and the picker read
 * these (via the story layer). Display order = the `MANAGER_PERKS` order,
 * quirk last. Cutting an entry above cuts the rule AND its copy at once.
 */
export function perkLines(
  id: ManagerId | null | undefined,
): { id: string; title: string; text: string; quirk?: boolean }[] {
  if (!id) return [];
  return MANAGER_PERKS[id].map((p) => ({
    id: p.id, title: p.title, text: p.text, quirk: p.quirk,
  }));
}

/**
 * PERK-1: the seat's trucks run the base rate × this (null seats 1). The game
 * folds it into the truck-tick closure; `TRUCK_SPEED` itself never changes,
 * so the constant tests pin stay untouched.
 */
export function truckSpeedOf(id: ManagerId | null | undefined): number {
  return perksOf(id).truckSpeed;
}

/** PERK-1: the seat's trains run the base rate × this (null seats 1). */
export function trainSpeedOf(id: ManagerId | null | undefined): number {
  return perksOf(id).trainSpeed;
}

/** PERK-1: the extra tuning moves the seat's sessions start with. */
export function sessionExtraMoves(id: ManagerId | null | undefined): number {
  return perksOf(id).extraMoves;
}

/** PERK-1: the session's extra-moves buy (the Gold price + uses), or null. */
export function buyMovesOffer(
  id: ManagerId | null | undefined,
): { gold: number; uses: number } | null {
  return perksOf(id).buyMoves;
}

/** PERK-1: the tiles the seat's OWN session sabotage lands extra. */
export function sabotageTilesBonus(id: ManagerId | null | undefined): number {
  return perksOf(id).sabotageBonus;
}

/** PERK-1: the seat bounces the first sabotage played on it, per match. */
export function returnToSenderOf(id: ManagerId | null | undefined): boolean {
  return perksOf(id).returnToSender;
}

/**
 * PERK-1: the FLEET upgrade price after the perk — FLEET-4/FLEET-5 (#598/
 * #599) price their upgrade through this when it lands. A seat without the
 * perk (or a null seat) pays exactly the base; a 0.85 perk on a 200 bill is
 * 170 (discounts round down, like every other perk price).
 */
export function fleetUpgradePrice(
  base: number,
  id: ManagerId | null | undefined,
  vehicle: "truck" | "train",
): number {
  const m = perksOf(id).fleet[vehicle] ?? 1;
  if (m === 1 || base <= 0) return base;
  return m < 1
    ? Math.max(1, Math.floor(base * m + 1e-9))
    : Math.ceil(base * m - 1e-9);
}

/**
 * The pure shape the battle engine reads for one seat. The engine itself is
 * manager-free (src/game/battle.ts never imports this file): the game passes
 * these flags through `BattleOptions.perks`, seat by seat.
 */
export interface BattlePerkFlags {
  /** Sucker Punch: one extra turn, once per battle (Rafael). */
  extraTurnOnce?: boolean;
  /** Momentum: a match of at least this length earns an extra turn (Dolores: 4). */
  extraTurnMinMatch?: number;
  /** Encore: one bonus turn at the end of every round (Kenji). */
  bonusTurnPerRound?: boolean;
}

/** The battle flags for a seat — null for a seat without any (incl. null). */
export function battlePerksOf(id: ManagerId | null | undefined): BattlePerkFlags | null {
  const p = perksOf(id);
  if (!p.battleExtraTurnOnce && !p.battleMatch4 && !p.battleEncore) return null;
  return {
    ...(p.battleExtraTurnOnce ? { extraTurnOnce: true } : {}),
    ...(p.battleMatch4 ? { extraTurnMinMatch: 4 } : {}),
    ...(p.battleEncore ? { bonusTurnPerRound: true } : {}),
  };
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
