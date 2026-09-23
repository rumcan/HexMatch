// ══════════════════════════════════════════════════════════════════════════
// E2 — Cargo, industries, and the road/rail scoring split (isometric edition)
//
// Settled decisions (spec doc + owner):
//  1. SIX cargoes, not seven: Iron and Coal merged into a single Ore cargo —
//     the match-3 board hard-codes GEM_FRAMES = 6 / gems_spritesheet.png
//     (6 × 128px frames) and no 7th gem frame exists.
//  2. The match-3 board spawns cargo directly (it is NOT transport
//     capacity); board.ts survives the migration untouched.
//  3. Road→rail upgrade in place is allowed, paying the cost difference.
//  4. One Depot holds one industry: the FIRST Depot with a road at a resource
//     owns its output outright, and no second Depot may be built for it
//     (PP-16 — it replaces "overlapping catchments split output
//     proportionally among claimants", which made a district a spreadsheet
//     instead of a race).
//  5. `gold` stays the sabotage currency (SABOTAGE unchanged).
//     PP-08 tightens that to a hard rule: Gold is reserved for Black Market
//     sabotage and pays for NOTHING else. Security Forces (defensive, not
//     sabotage) were repriced to materials (game/config.ts SECURITY.cost),
//     and the bank refuses gold in every exchange, both directions
//     (`src/iso/bank.ts` — the offer board L11 / #226 retired was the other).
// ══════════════════════════════════════════════════════════════════════════
import { TILE_W, TILE_H, MAP_W, MAP_H, HW, HH } from "../game/config";
import manifestJson from "../../assets/iso-atlas/manifest.json";
import type { Manifest } from "./atlas";

export { TILE_W, TILE_H, MAP_W, MAP_H, HW, HH };
export { tileToScreen, screenToTile, tileIndex, inMap, mulberry32 } from "../game/config";

// ── Cargoes (also the six match-3 colours) ────────────────────────────────
export type Cargo = "grain" | "wood" | "ore" | "stone" | "oil" | "gold";

/**
 * PP-14b — the player's tycoon portrait, picked on the start screen. The
 * rival always shows Torvin; the player's own is Vex or You.
 */
export type Portrait = "vex" | "you";
export const PORTRAITS: Portrait[] = ["vex", "you"];

export const CARGOES: Cargo[] = ["grain", "wood", "ore", "stone", "oil", "gold"];

/** Baseline cargo credited by one connected depot per economy tick. */
export const BASE_RATE = 1;

/**
 * L3 (#217) — THE distance table: how far a Depot's road route runs decides
 * the tick-rate multiplier the L1b clock pays it by.
 *
 * The route is the lorry's own road (`depotPathLength` in economy.ts — the
 * shortest run of road tiles from the Depot's shoulder to the nearest owned
 * plant's, over the owner's own + public track), counted in TILES, and the
 * factor is banded so the number the inspector prints and the rate the clock
 * pays are both stable under small re-routes:
 *
 *   ≤ `nearTiles` tiles   `near` — the Depot is next door, full rate;
 *   ≤ `midTiles` tiles    `mid`  — a real line out, visibly slower;
 *   beyond that           `far`  — the long haul, half rate.
 *
 * Why these numbers: the opening corridor in every fixture (and most real
 * openings) runs ~6 tiles of road, so `nearTiles` 8 keeps a sensibly-placed
 * first Depot at the full rate instead of taxing the setup; 20 tiles is a
 * genuine cross-country line on the 144×144 map, and anything past it is the
 * kind of reach that should cost throughput. L7 (#221) left the bands as-is:
 * the lorries now scale their speed by this same table (via `depotRate` in
 * loop.ts), so retuning it would retune both the clock and the traffic. A
 * smooth falloff can still replace the steps later; the clock and the
 * lorries both read only this table.
 */
export const DISTANCE = {
  /** Route length at or below this is "near" — full rate. */
  nearTiles: 8,
  /** Route length above `nearTiles` and at or below this is "mid". Beyond it is "far". */
  midTiles: 20,
  /** Tick-rate multiplier per band. */
  near: 1.0,
  mid: 0.7,
  far: 0.5,
} as const;

/**
 * L4 (#218) — THE tuning-session table. One session per depot, opened by
 * building it, played on the plant board and closed by the budget running out
 * (or by the player finishing early): the session's score is read off into a
 * depot YIELD LEVEL between `minYield` and `maxYield`, and `economyTick`
 * multiplies a connected depot's cargo by exactly that level (L1b).
 *
 * Why these numbers:
 *   • `moves` 10 — a burst you can hold in your head. The board is only up
 *     during a session (this ticket), so a long session would just be the old
 *     always-on board with an odometer.
 *   • `targetScore` 60 cleared gems — a plain 3-match is 3, so a session that
 *     never cascades lands near half the multiplier and one that reads the
 *     board (4/5-matches, cascades, bombs) maxes it. The score counts GEMS,
 *     never cargo: what a match pays the purse is #234/#227's business.
 *   • `maxYield` 2.5 — the yield AT `targetScore`, not a ceiling. Owner call
 *     (2026-09): the better you play the higher it goes, so a session past
 *     the target keeps paying at the same rate (+1.5× per 60 gems). Only a
 *     sanity bound (`yieldSanityMax`) remains, for corrupt wire/save values.
 *   • `cargoBias` — the board spawns "mostly that cargo" (the ticket's words):
 *     just under half of every refill is the depot's own colour, so its tokens
 *     and its long matches come up often without the board becoming single
 *     colour (which would make the session a formality).
 */
export const TUNING = {
  moves: 10,
  /** Score-0 yield — also what an abandoned session and an untuned depot pay. */
  minYield: 1,
  /** Yield AT `targetScore` — the slope's anchor, not a cap (see above). */
  maxYield: 2.5,
  /** Not a game rule: rejects corrupt wire/save values. No session gets near it. */
  yieldSanityMax: 50,
  /** Gems cleared that earn the full multiplier. */
  targetScore: 60,
  /** Chance a spawned gem is the session depot's own cargo. */
  cargoBias: 0.45,
  /**
   * L9 (#224) — THE new-loop Gold source (and the reason `COMBOS_PER_GOLD`
   * stops paying under the flag).
   *
   * Gold used to be minted by the always-on board: every 2 combos banked a
   * coin. The new loop's board is only up during a tuning session, so that
   * wire dries up — and Gold is the only currency the Black Market takes.
   * The replacement keeps Gold inside the loop's own core event rather than
   * inventing a second economy: **a tuning session pays Gold for its score**,
   * so the same burst of matching that sets a Depot's yield also funds the
   * sabotage the player can aim at the rival's map.
   *
   *   score 0 (or an abandoned session)   0 Gold — a session you did not play
   *   any score at all                    at least `minGold`
   *   `targetScore` and beyond            `maxGold`
   *
   * It reaches BOTH seats: the rival takes a simulated session per depot
   * (`rivalTuningYield`), and the same simulated score pays it the same Gold
   * (`rivalTuningGold`), so the raid table stays funded at every difficulty.
   *
   * The second, map-side source is unchanged and deliberate: Gold is a cargo,
   * a Gold Mine is an industry, so a Depot that holds one ticks Gold in on the
   * clock like any other cargo. Connecting a mine is the *bulk* source; the
   * session reward is the steady one that needs no map luck.
   */
  minGold: 1,
  maxGold: 3,
} as const;

// ── L6 (#220): difficulty = decay, not whether match-3 exists ─────────────
/**
 * The ONE place the three difficulties differ as ECONOMY rules.
 *
 * The brief's headline: difficulty changes the *decay*, never whether the tuning
 * session exists. `matchEnabled` is true on all three rows and stays a flag for
 * tests and future modes (#225's obstacle variants, a builder-only sandbox); a
 * difficulty can only move the numbers below. That is what lets the economy have
 * ONE codepath — `economyTick` and the tuning settle read these flags and branch
 * on data, never on `if (difficulty === "hard")`.
 *
 * Why these numbers, per row:
 *
 *   Easy    No decay, and the mapping is generous: `minYield` is raised, so a
 *           session that clears nothing still lands a Depot at ×1.5 — a weak
 *           player is never punished for being weak. No re-match is ever
 *           offered, because the whole point of Easy is that nobody is dragged
 *           back to the board. (Match-3 STILL opens on a Depot build — that is
 *           the change from the original brief, and #218's tests pin it.) No
 *           obstacles: the board is a clean table.
 *   Normal  No decay either, and the yield is *monotone*: every settle is
 *           clamped to `max(old, new)`, so a session can only ever be an
 *           improvement. A re-match is owed only when the Depot itself was
 *           upgraded — the ticket's "set once per depot (at build) and per city
 *           upgrade", until #219 gives the game real city upgrades. Frost sits
 *           on the board from the first move (L10 / #225).
 *   Hard    `decayRate > 0`: the tuning cools off, so a well-tuned Depot drifts
 *           back toward the baseline and a re-match is always open — and a bad
 *           re-match can lower the yield, because this is the only row with
 *           `yieldNeverDrops: false`. Frost AND girders, the ice two matches
 *           deep (L10 / #225): a board you have to dig yourself out of.
 *
 * The obstacles are the difficulty's SECOND axis, and they are deliberately
 * not a difficulty of their own: they cost moves, not yield, so Easy stays
 * easy without the board ever being a formality.
 *
 * `decayRate` is the fraction of the SURPLUS above `minYield` lost per economy
 * tick (`HARVEST_MS` = 3 s in `game.ts`), so cooling slows as a Depot approaches
 * its floor and never crosses it: Hard's 0.017 halves a fresh ×2.5 tune in about
 * two minutes (40 ticks) and takes a little over seven to reach the baseline.
 * It is a fraction of the CLOCK, not of the purse: pausing the game pauses the
 * decay, and a Depot that is not connected still cools (or cutting a road would
 * freeze a fresh tune).
 */
/**
 * L10 (#225) — the obstacles a tuning session OPENS with, per difficulty.
 *
 * Frost is a gem locked in ice (`hard > 0`): it still matches and it still
 * falls, and instead of clearing it cracks one step per pass — `frostHard: 2`
 * takes two matches to free the gem, `frostHard: 1` takes one. A girder
 * (`block`) is a cell taken out of the board entirely — no swap, no match, no
 * refill through it — and it is broken back into an ordinary gem by a removal
 * BESIDE it. Both rules are the ones the old Black-Market cards used; what
 * #225 changed is who places them (this table, at session start) and for how
 * long (the session — there is no timer on an obstacle any more).
 *
 * Counts are absolute, not a share of the board, so a phone's resized board
 * meets the same NUMBER of obstacles a desktop's does.
 */
export interface ObstacleRules {
  /** Frosted gems the session opens with. 0 = this difficulty has no frost. */
  frost: number;
  /** How thick the ice is: 1 = one adjacent match frees the gem, 2 = two. */
  frostHard: 1 | 2;
  /** Iron girders the session opens with. 0 = this difficulty has none. */
  girders: number;
}

/**
 * L10 (#225) — how the obstacle table ramps with the Depot's transport tier
 * (L6's `transportTierOf`, the same axis a re-match credit is counted on).
 *
 * The first Depot a player ever tunes stands on open ground — tier 0, nothing
 * paid for yet — so it meets a thinned board: half the table's count and ice
 * one match deep. Every tier they have actually paid for restores the full
 * row. Gentle on purpose: the obstacles are there to make the board harder to
 * READ, not to make a first session unwinnable.
 */
export const OBSTACLE_RAMP = {
  /** The fraction of the table's counts a tier-0 Depot's session opens with. */
  firstTier: 0.5,
  /** Ice on a tier-0 board is one match deep, whatever the row says. */
  firstTierHard: 1 as 1 | 2,
} as const;

export interface DifficultyRules {
  /** Does the tuning board EVER open on this difficulty? True on all three. */
  matchEnabled: boolean;
  /** The floor a session maps onto — Easy raises it — and the level a cooling
   *  Depot settles at. Deliberately not a second clamp on the wire: see
   *  `tuning.ts` for why a stored level is sanitised against `TUNING` instead. */
  minYield: number;
  /** Fraction of the yield above `minYield` that cools off per economy tick. */
  decayRate: number;
  /** When a Depot may be re-tuned after its build session: `never` (Easy),
   *  `upgrade` (Normal, one per tier it moves up) or `open` (Hard, any time). */
  rematch: "never" | "upgrade" | "open";
  /** Clamp a finished session to `max(old, new)` — the "yield never drops" rule.
   *  Hard is the row where a poor session is allowed to bite. */
  yieldNeverDrops: boolean;
  /**
   * L10 (#225) — what the session's board looks like when it opens. Easy runs
   * a clean table; Normal puts ice on it; Hard ices it AND drops girders on
   * the line. Ramped by the Depot's tier (see `OBSTACLE_RAMP`).
   */
  obstacles: ObstacleRules;
}

export type DifficultyKey = "easy" | "normal" | "hard";

/** The shipped rival-skills keys and these rows are ONE setting (L6). */
export const DIFFICULTY_RULES: Record<DifficultyKey, DifficultyRules> = {
  // Owner call (2026-09): yields never drop (no decay on any row) and a
  // Depot can be retuned any time, for a price (`DEPOT_LEVELS.retuneCost`).
  // The rows still differ by the floor and the board's obstacles.
  easy:   { matchEnabled: true, minYield: 1.5, decayRate: 0,
            rematch: "open", yieldNeverDrops: true,
            obstacles: { frost: 0, frostHard: 1, girders: 0 } },
  normal: { matchEnabled: true, minYield: TUNING.minYield, decayRate: 0,
            rematch: "open", yieldNeverDrops: true,
            obstacles: { frost: 6, frostHard: 1, girders: 0 } },
  hard:   { matchEnabled: true, minYield: TUNING.minYield, decayRate: 0,
            rematch: "open", yieldNeverDrops: true,
            obstacles: { frost: 6, frostHard: 2, girders: 3 } },
};

/** The row the game runs when nothing has chosen a difficulty yet. */
export const DEFAULT_DIFFICULTY: DifficultyKey = "normal";

// ══════════════════════════════════════════════════════════════════════════
// Phase 2 — Match-3 Battles (B1 / #246): the rules table.
//
// The battle engine (`src/game/battle.ts`) is rules-DRIVEN: it never hard-codes
// a number. This table is the whole balance surface — B7 tunes it here and
// nowhere else. Puzzle Quest's shape is the reference: two players take turns
// on ONE shared board; matching gems charges the turn player's mana in that
// gem's cargo; damage gems (the board's bombs — "dynamite") hurt the opponent;
// a big match or a cascade grants an extra turn; first to zero health loses.
//
// The engine is deterministic (seeded RNG, move list replayable) so the same
// seed + the same moves reproduce the same battle — multiplayer and replays
// depend on it.
// ══════════════════════════════════════════════════════════════════════════
export interface BattleRules {
  /** Both seats open at this much health. First to 0 loses. */
  startHealth: number;
  /** Per-cargo mana ceiling — what one colour can bank for abilities (B3). */
  manaCap: number;
  /** Mana gained per matched gem of that gem's cargo. */
  manaPerGem: number;
  /**
   * Damage per gem a detonated bomb ("dynamite") sweeps. The bomb is the
   * battle's damage gem: matching ordinary gems feeds mana, blowing a bomb
   * feeds damage — `purged × damagePerGem` to the opponent, all at once.
   */
  damagePerGem: number;
  /** Playtest (2026-09): damage per MATCHED gem (bomb blasts use `damagePerGem`). */
  matchDamagePerGem?: number;
  /** A matched run of this length or more grants an extra turn (the "4+"). */
  extraTurnMinMatch: number;
  /** A special shape (match-5 / L / T / cross) grants an extra turn. */
  extraTurnOnShape: boolean;
  /** A cascade of at least this many passes grants an extra turn (0 = never). */
  extraTurnOnCascade: number;
  /**
   * Hard stop so a battle always ends: after this many resolved swaps in
   * total, the higher health wins (equal health = a draw — `winner` stays
   * null and `over` is set).
   */
  turnLimit: number;
  /**
   * B2 (#247) — the turn timer, in ms. The battle screen shows it as a bar
   * over the active seat; B6 (#251) makes the HOST enforce it (a timed-out
   * turn passes).
   */
  turnMs: number;
  /**
   * B5 (#250) — the challenge bill in Gold: what a fight for a contested
   * industry costs its caller (sabotage fights are paid by the attacker's
   * hire, which is spent win or lose).
   */
  challengeGold: number;
  /** B5 — decline: the challenger takes the prize, but pays this on top. */
  declineGold: number;
  /** B5 — this long between two challenges OF ONE industry by one player. */
  challengeIndustryCooldownMs: number;
  /** B5 — this long between any two challenges BY ONE player. */
  challengePlayerCooldownMs: number;
}

/**
 * The shipped table. Provisional until B7 (#252) tunes it against bot-vs-bot
 * simulations; the shape (a bomb hurts more than a match helps) is deliberate.
 */
export const BATTLE_RULES: BattleRules = {
  startHealth: 30,
  manaCap: 12,
  manaPerGem: 1,
  damagePerGem: 1,
  matchDamagePerGem: 1,
  extraTurnMinMatch: 4,
  extraTurnOnShape: true,
  extraTurnOnCascade: 2,
  turnLimit: 20,
  turnMs: 30000,
  challengeGold: 12,   // ×3 (2026-09)
  declineGold: 9,
  /** Retired: one player cooldown paces every fight (issue #322). Kept so older readers still type-check. */
  challengeIndustryCooldownMs: 0,
  /** #322: one 2-minute player cooldown (was 90s plus a 180s per-industry clock). */
  challengePlayerCooldownMs: 120_000,
};

/**
 * #322 — Comeback sales. A seat whose last plant has closed may sell assets
 * for Gold to fund a challenge. Cheapest first: 5 paved tiles, then a Depot,
 * then a city tier, then a plant.
 */
export const BATTLE_SALE = {
  depot: 3,
  plant: 5,
  city: 4,
  /** 5 paved tiles sell for 1 Gold. */
  pavedTiles: 5,
  pavedGold: 1,
} as const;

// ══════════════════════════════════════════════════════════════════════════
// B3 (#248) — BATTLE ABILITIES: industrial spells paid in cargo mana.
//
// The old Black Market board cards (Frost Tiles, Iron Girders, Smog Cloud)
// lost their home when #224 cleared the market; battles are their new one.
// The board already carries their RULES (L10 / #225): a frosted gem (`hard`)
// cracks one step instead of clearing, and a girder (`block`) is broken back
// into an ordinary gem by a removal beside it — `Board.seedObstacles` drops
// both, seeded and deadlock-guarded.
//
// This table is the whole balance surface (B7 tunes here): mana cost per
// cargo, cooldown, effect payload. Casting costs the caster's TURN unless a
// row says `costsTurn: false`, and every row may gate on MAP OWNERSHIP —
// `requires` is a cargo whose depot the caster must hold (B5 fills each
// seat's `depots` from the live economy), which is what ties battle strategy
// to the network a tycoon built between fights.
// ══════════════════════════════════════════════════════════════════════════

export type AbilityId = "girders" | "frost" | "smog" | "dynamite" | "repair" | "bribe";

export interface BattleAbilityDef {
  id: AbilityId;
  name: string;
  desc: string;
  /** Mana paid per cargo on cast (the HUD cost chips read this). */
  cost: Partial<Record<Cargo, number>>;
  /**
   * Cooldown in the CASTER's turns: ready again on the caster's `cooldown`-th
   * turn after casting (1 = the very next turn of theirs). Ticks at each
   * turn start, extra turns included.
   */
  cooldown: number;
  /**
   * Casting spends the turn (default). `false` = the table says otherwise:
   * the ability resolves as a free action and the caster still swaps.
   */
  costsTurn?: boolean;
  /** Map gate: hold a depot of this cargo or the ability stays locked. */
  requires?: Cargo;
  // ── effect payload (each ability reads only its own fields) ─────────────
  /** Iron Girders: girder obstacles dropped on the shared board. */
  girders?: number;
  /** Frost: gems frozen at `frostHard` (1 = one crack, 2 = two). */
  frostGems?: number;
  frostHard?: 1 | 2;
  /** Smog: the opponent's next N matches bank half mana. */
  matches?: number;
  /** Dynamite: flat damage to the opponent (bomb purges stay damagePerGem). */
  damage?: number;
  /** Repair Crew: flat heal (capped at startHealth). */
  heal?: number;
  /** Gold Bribe: mana moved per cargo from the opponent. */
  stealPerCargo?: number;
}

export const BATTLE_ABILITIES: Record<AbilityId, BattleAbilityDef> = {
  girders: {
    id: "girders", name: "Iron Girders",
    desc: "Drop 3 girders on the board — blocked cells spoil the opponent's plans.",
    cost: { stone: 3, ore: 3 }, cooldown: 3, requires: "stone", girders: 3,
  },
  frost: {
    id: "frost", name: "Frost",
    desc: "Freeze 4 gems — a frozen gem cracks one step instead of clearing.",
    cost: { grain: 3, wood: 3 }, cooldown: 3, requires: "grain",
    frostGems: 4, frostHard: 2,
  },
  smog: {
    id: "smog", name: "Smog",
    desc: "The opponent's next match banks half mana.",
    cost: { oil: 4 }, cooldown: 2, requires: "oil", matches: 1,
  },
  dynamite: {
    id: "dynamite", name: "Dynamite",
    desc: "Deal 4 direct damage to the opponent.",
    cost: { ore: 2, oil: 2 }, cooldown: 2, requires: "ore", damage: 4,
  },
  repair: {
    id: "repair", name: "Repair Crew",
    desc: "Restore 6 health.",
    cost: { wood: 2, stone: 2 }, cooldown: 3, requires: "wood", heal: 6,
  },
  bribe: {
    id: "bribe", name: "Gold Bribe",
    desc: "Steal 2 mana of each cargo from the opponent — without spending your turn.",
    cost: { gold: 3 }, cooldown: 2, requires: "gold", stealPerCargo: 2,
    costsTurn: false,
  },
};

/** Stable cast/UI order. */
export const BATTLE_ABILITY_ORDER: AbilityId[] =
  ["girders", "frost", "smog", "dynamite", "repair", "bribe"];

// ══════════════════════════════════════════════════════════════════════════
// L5 (#219) — THE DEPOT TREE: which resource buys the next depot type.
//
// Until this ticket every industry's Depot cost the same four-unit mix
// (`BUILD_COSTS.depot`), so a Depot was a Depot and the only question the map
// asked was "where is the nearest industry". The tree makes the *type* matter:
// a Depot harvests the cargo of the industry it stands beside, and that cargo
// is what the next Depot you want is bought with.
//
// The shape, and why it is this shape:
//
//   • TIER is the rung: a seat may build a type whose `tier` is at or below
//     the rungs it has UNLOCKED, and a rung is earned by finishing a tuning
//     session (L4 — `unlockTierAfterSession` in tuning.ts). Match-3 is part of
//     the progression gate, not a side activity: a Depot you never tune does
//     not open the next rung.
//   • COST is a MIX, and mixes are what keep the opening strategic: grain and
//     wood are both reachable from `START_PURSE` (12 wood + 12 stone), so a
//     farm or a forest is always the first paid Depot — whichever the seeded
//     map put nearest you — and from there several routes lead up. There is no
//     single forced order (the Catan rule, Addition B).
//   • The chain still reads as the ticket's example — wood (starter) → stone
//     costs wood → ore costs stone → oil costs ore → gold costs oil — with the
//     branching the ticket's Addition B asks for: stone and ore sit on the
//     SAME rung and are bought with different mixes, and grain (the starter's
//     other half) is a real input to both.
//
// Reachability is a RULE here, not a hope: every type must be payable from
// some mix of the types reachable before it, and `START_PURSE` must buy the
// tier-0 pair (the Oil lesson — `tests/unit/iso-l5-depot-tree.test.ts` proves
// it by walking the table, and the `test:slow` race proves the rival really
// gets through it). Gold is deliberately the deepest rung and buys nothing but
// Black Market sabotage, so nothing below it depends on it.
export interface DepotTypeDef {
  /** The cargo this depot harvests — its industry's output. */
  cargo: Cargo;
  /** Display name, used by the HUD, the toasts and the inspector. */
  name: string;
  /**
   * Rung on the tree (0 = buildable from the start). A seat may build tier T
   * once it has unlocked T rungs; see `unlockTierAfterSession` in tuning.ts.
   */
  tier: number;
  /** What one Depot costs once the setup allowance is spent. */
  cost: Partial<Record<Cargo, number>>;
}

/**
 * Owner call (2026-09): every Depot type costs the same — one of each cargo
 * but gold (`BUILD_COSTS.depot`), about half a processing plant — and the
 * rung gate is OFF, so any industry can take a Depot from the start. The
 * tiers stay: they still set how hard a Depot's tuning session is. Flip
 * `DEPOT_RUNG_GATE` to bring the ladder back (the per-type mixes below are
 * kept as the record of what it cost then).
 */
export const DEPOT_RUNG_GATE = false;

/**
 * Owner call (2026-09) — DEPOT LEVELS. A Depot's tuning yield is capped by its
 * level: L1 ×2, L2 ×4, L3 ×6 (the max, for now). Upgrading a Depot costs what
 * building one does and opens a tuning session at once (like the city). A
 * session's score past the cap pays Gold instead — 1 per `goldPerOvershoot`
 * of yield over it. Retuning any time costs half a Depot (rounded up).
 * A Depot at the top level is worth `VICTORY.loop.maxDepot` ★.
 */
export const DEPOT_LEVELS = {
  caps: [2, 4, 6] as readonly number[],
  max: 3,
  goldPerOvershoot: 0.5,
} as const;

/** The yield cap for a Depot level (absent = level 1). */
export const depotYieldCap = (level: number | undefined): number =>
  DEPOT_LEVELS.caps[Math.min(DEPOT_LEVELS.max, Math.max(1, Math.floor(level ?? 1))) - 1];
const DEPOT_FLAT_COST = (): Partial<Record<Cargo, number>> => ({ grain: 3, wood: 3, stone: 3, ore: 3, oil: 3 });

export const DEPOT_TREE: Record<Cargo, DepotTypeDef> = {
  // Rung 0 — the two cargos `START_PURSE` can always turn into a network. Both
  // are free with the setup allowance; these prices are what a SECOND one
  // costs, and they are deliberately cheap: going WIDE has to stay a real plan
  // (many cheap depots) next to going TALL (unlock rungs, tune harder).
  grain: { cargo: "grain", name: "Farm Depot",   tier: 0, cost: DEPOT_FLAT_COST() }, // was { wood: 2 },
  wood:  { cargo: "wood",  name: "Forest Depot", tier: 0, cost: DEPOT_FLAT_COST() }, // was { stone: 2 },
  // Rung 1 — the two mid-game cargos, on ONE rung with different mixes, so
  // whichever of grain/wood the map gave you, one of them is on the table.
  stone: { cargo: "stone", name: "Quarry Depot", tier: 1, cost: DEPOT_FLAT_COST() }, // was { grain: 2, wood: 2 },
  ore:   { cargo: "ore",   name: "Mine Depot",   tier: 1, cost: DEPOT_FLAT_COST() }, // was { grain: 2, stone: 2 },
  // Rung 2 — the deep types. Oil takes the rung-1 pair apart; Gold sits behind
  // Oil so the deepest rung is a real commitment rather than a shortcut.
  oil:   { cargo: "oil",   name: "Rig Depot",    tier: 2, cost: DEPOT_FLAT_COST() }, // was { wood: 2, ore: 2 },
  gold:  { cargo: "gold",  name: "Gold Depot",   tier: 2, cost: DEPOT_FLAT_COST() }, // was { stone: 2, oil: 2 },
};

/** The rungs: 0…2 (three unlockable steps). */
export const DEPOT_TIER_MAX = 2;

/**
 * The cargos a map is guaranteed to offer, in the order the tree wants to
 * read them (the test and the copy both walk this).
 */
export const DEPOT_TREE_ORDER: Cargo[] = ["grain", "wood", "stone", "ore", "oil", "gold"];

/**
 * L5 (#219) — THE CITY (town) UPGRADE table.
 *
 * The tree buys new *sources*; this buys throughput on the ones you already
 * have. `TOWN_UPGRADES[level]` is the cost of the next level and the base-rate
 * bonus a perfect session on it is worth.
 *
 * L17 (#245): THREE rows now, one per growth step of the town on the map —
 * every row is worth the same +50% ceiling (the owner's "each upgrade adds
 * 50% to yields, stacking per upgrade"). The tuning session still scales how
 * much of that ceiling lands (`townBonusFor`, tuning.ts — "the session result
 * can set the upgrade's strength", clamped per difficulty by L6): what changed
 * is the ceiling per row, not the curve that reads it. The seat's `townLevel`
 * is also the town's VISUAL growth: level 0 is a village, the first upgrade
 * makes it a town (the centre becomes the bank), the later upgrades grow its
 * footprint (see `Town.level` in grid.ts).
 *
 * The bonus is a multiplier on `BASE_RATE` for EVERY connected depot the seat
 * owns (the clock in `economyTick`), and the session's score decides how much
 * of it you actually get (`townBonusFor`, tuning.ts).
 *
 * L16 (#231): a row also carries the STORAGE it adds. Every resource has a
 * per-seat cap (`STORAGE_CAP_BASE` below, plus every bought row's `storage`),
 * and clock income above the cap is lost — the Merge Gardens pressure point:
 * with a clock economy and no cap a full purse is a purse with nothing left
 * to plan for. The upgrade that raises the base rate is the same one that
 * raises the cap, so "spend or upgrade" is one decision.
 */
export interface TownUpgradeDef {
  /** The level this row buys (1-based). */
  level: number;
  /** What it costs, paid when the upgrade is bought. */
  cost: Partial<Record<Cargo, number>>;
  /** The bonus a full session sets — the ceiling `townBonusFor` scales. */
  bonus: number;
  /** L16 (#231): how much per-resource storage this level adds to the cap. */
  storage: number;
}

export const TOWN_UPGRADES: TownUpgradeDef[] = [
  // 6/4/4 is roughly "a farm, a forest and a quarry worth of ticks" on the
  // L1/L3 clock — real, but a single lap of the network on a normal map, so
  // the first upgrade lands about when the second rung does.
  // L16 (#231): +36 storage takes a seat from 24 to 60 per resource — a
  // network of 3-4 tuned depots can bank a rung-2 mix without wasting ticks,
  // but the opening (one depot, one cargo) genuinely presses against 24.
  // L17 (#245): the ceiling is +50% (was +60% on the single MVP row), the
  // owner's "each upgrade adds 50% to the yields, stacking".
  { level: 1, cost: { wood: 18, stone: 12, grain: 12 }, bonus: 0.5, storage: 36 },   // ×3 (2026-09)
  // L17 (#245): the second and third growth steps. Each asks for the rung the
  // seat is presumably working by then (rung 1 for the second, rung 2 for the
  // third). The `bonus` column is the CUMULATIVE ceiling the seat plays
  // under once that row is bought — 0.5 / 1.0 / 1.5 — because the settlement
  // REPLACES `townBonus` with the bought row's number (`closeTuningSession`),
  // so "each upgrade adds 50%" means each row's ceiling is +50% × its level.
  // Pay, play the session, bank up to half again as much — and watch the
  // town on the map take the next step with it.
  { level: 2, cost: { stone: 24, grain: 24, ore: 18 }, bonus: 1.0, storage: 48 },
  { level: 3, cost: { ore: 30, oil: 24 }, bonus: 1.5, storage: 60 },
];

/**
 * L16 (#231): the per-resource storage cap a seat with NO city upgrade plays
 * under — the number `storageCapFor(0)` (construction.ts) starts from.
 *
 * The two constraints the ticket puts on it, both checked by
 * `tests/unit/iso-l16-storage.test.ts`:
 *
 *   • it fits `START_PURSE` (12 Wood + 12 Stone — the opening must sit UNDER
 *     the cap, not on it, or the first wood tick is wasted on turn one);
 *   • it fits the first tier's prices — the largest single-cargo ask in
 *     `TOWN_UPGRADES[0].cost` and every rung-0/1 `DEPOT_TREE` mix — so the
 *     opening can always bank what the first upgrade or the second rung
 *     costs, and never dead-ends against a cap smaller than a price.
 *
 * 24 is the headroom over those asks (a 6-Wood upgrade, a 2+2 mix) that keeps
 * the early tree comfortable while still making a single untuned depot's
 * income overflow long before the mid-game.
 */
export const STORAGE_CAP_BASE = 24;

export const CARGO: Record<Cargo, {
  name: string; icon: string; c1: string; c2: string; gem: string;
}> = {
  grain: { name: "Grain", icon: "🌾", c1: "#b89400", c2: "#ffe83a", gem: "#f5da28" },
  wood:  { name: "Wood",  icon: "🪵", c1: "#6b3410", c2: "#c47a2c", gem: "#c07b34" },
  ore:   { name: "Ore",   icon: "⛏️", c1: "#284a9c", c2: "#5aa8ff", gem: "#3f7fe0" },
  stone: { name: "Stone", icon: "🪨", c1: "#7c8794", c2: "#c7d0da", gem: "#9aa5b0" },
  oil:   { name: "Oil",   icon: "🛢️", c1: "#1c1e20", c2: "#4c4f52", gem: "#2b2d30" },
  gold:  { name: "Gold",  icon: "🪙", c1: "#9c5a02", c2: "#ffb01f", gem: "#f5921f" },
};

// ── Industries ─────────────────────────────────────────────────────────────
// footprint: [w, h] in tiles along the two diamond axes (w × h tiles).
// output: relative harvest rate (1.0 = baseline farm).
//
// PP-12: every industry is ONE verbatim Transport Tycoon Deluxe building
// sprite, packed by a `file` cell (tools/iso-atlas.cells.json) under the
// industry's own key (`farm`, `forest`, …) and drawn as a single draw item
// by the renderer. The MT-1/MT-2 per-tile layouts (`<key>_t<m>` cells,
// transcribed `_tile_table_*` data) are retired from the game — their cells
// stay packed in the atlas as legacy (golden fixtures still exercise them),
// but nothing in src/ references them anymore.
export interface IndustryDef {
  key: string;
  name: string;
  cargo: Cargo;
  footprint: [number, number];
  output: number;
}

/**
 * PP-12: tile footprint derived from packed art width — the EXACT mirror of
 * `footprintForFileArt` in tools/slice-atlas.mjs. A square [n, n] footprint's
 * diamond spans n*64 + 32 px before the overhang allowance, so
 * n = ceil((w − 32) / 64) is the smallest square whose span covers the art
 * (64→1, 96→1, 115→2, 224→3, 256→4). Height is deliberately ignored: TTD
 * building height includes vertical structure, not footprint depth.
 *
 * The game and the packer MUST agree here: the slicer stamps this derivation
 * into the manifest for every `footprint: "auto"` file cell, and the defs
 * below re-derive it from the same packed widths, so swapping the art
 * re-flows gameplay (placement, occupancy, catchment) with no code change.
 * tests/unit/iso-pp12-assets.test.ts pins the agreement.
 */
export function footprintForArt(spriteW: number): [number, number] {
  const n = Math.max(1, Math.ceil((spriteW - 32) / TILE_W));
  return [n, n];
}

/** Packed 1x width of a manifest sprite. Fails fast on a stale manifest. */
function spriteWidth(name: string): number {
  const s = (manifestJson as unknown as Manifest).sprites[name];
  if (!s) throw new Error(`PP-12: manifest has no sprite "${name}" — rebuild the atlas (npm run slice-atlas)`);
  return s.w;
}

/**
 * Every resource (industry) stands on a 4×4 block: the resource art in
 * assets/buildings-src/ is authored on that lot, and a truck Depot parks on
 * any of its four sides.
 */
export const RESOURCE_FOOTPRINT: [number, number] = [4, 4];

function industryDef(key: string, name: string, cargo: Cargo, output: number): IndustryDef {
  return { key, name, cargo, footprint: [...RESOURCE_FOOTPRINT], output };
}

export const INDUSTRIES: IndustryDef[] = [
  industryDef("farm",      "Farm",      "grain", 1.0),
  industryDef("forest",    "Forest",    "wood",  1.0),
  industryDef("ore_mine",  "Ore Mine",  "ore",   0.8),
  industryDef("quarry",    "Quarry",    "stone", 0.7),
  industryDef("oil_rig",   "Oil Rig",   "oil",   0.4),
  industryDef("gold_mine", "Gold Mine", "gold",  0.3),
];

export const INDUSTRY_BY_KEY: Record<string, IndustryDef> = Object.fromEntries(
  INDUSTRIES.map((d) => [d.key, d]),
);

// Placement quota per industry type (E3): every cargo must be present.
// Owner call (2026-09): two of each resource and one gold mine — scarce sites
// make monopolies (and so the #322 battles) a real part of a game.
export const INDUSTRY_QUOTA: Record<string, number> = {
  farm: 2, forest: 2, ore_mine: 2, quarry: 2, oil_rig: 2, gold_mine: 1,
};

// ── Road vs rail (the core scoring split) ─────────────────────────────────
/**
 * VP-01: a transport tier earns Victory Points per TILE, and only when it is
 * reached by upgrading the tier underneath it. There is deliberately no VP
 * for a connection any more (neither dirt nor paved), and none for a paved
 * Road laid on virgin ground:
 *
 *   dirt              0 — a Dirt Road is plumbing, not points
 *   road (paved)      VP_UPGRADE per Dirt Road tile paved over in place
 *
 * `vpUpgrade` is the one number the scorer, the HUD labels and the drag
 * preview all read, so "what the button says" and "what the scoreboard pays"
 * cannot drift apart.
 */
export interface TransportDef {
  key: "dirt" | "road";
  name: string;
  cost: Partial<Record<Cargo, number>>;
  /** VP per tile when this tier is reached by upgrading the tier below it. */
  vpUpgrade: number;
  throughput: number;         // multiplier applied to connected harvesters
  onRough: boolean;           // buildable on rough terrain
  label: string;
}

/**
 * The game is de-railwayed into two tiers of ROAD:
 *
 *   dirt  (gravel)  — the cheap basic road. 1 Wood + 1 Stone, no VP, ×1.0,
 *                     buildable on rough ground. Player-built "Dirt Roads"
 *                     render as gravel.
 *   road  (paved)   — the premium road. 1 Wood + 1 Stone + 4 Ore, ×1.6, flat
 *                     ground only. Player-built "Roads" AND the map's
 *                     paved public/town roads live on this tier and render as
 *                     tar. (This was the old "rail" tier, re-skinned as a
 *                     paved road so no literal railway tracks remain.)
 *
 * Paving a Dirt Road into a Road pays only the difference (UPGRADE_COST) and,
 * since VP-01, is the ONLY thing roads are worth points for: 0.25 VP per tile
 * you pave, 0 per connection. A Dirt Road scores nothing at all.
 *
 * L2 (#216) MVP: the paved tier stays EXACTLY as priced and scored here — a
 * paid mid-tier (full price on virgin ground, UPGRADE_COST over gravel,
 * 0.25★ per pave) that the new loop does not require. The L2 spec's
 * paved-vs-rail decision ("remove it or keep it as a paid mid-upgrade") and
 * its ★ replacement land in #228 (L13); this ticket only makes dirt free
 * under `newLoop` (see `tileCost` in track.ts) and removes the dirt
 * demolish refund there. `BUILD_COSTS.dirt` keeps its shipped-loop price —
 * the old loop reads it, and the cost tests pin it.
 *
 * PP-07 — THE authoritative construction-cost table (Catan-style roles).
 *
 * Every buildable in the game is priced here, and ONLY here:
 *
 *   dirt    1 Wood + 1 Stone                       basic gravel road
 *   road    1 Wood + 1 Stone + 4 Ore               paved road, better transport
 *   upgrade 4 Ore                                  dirt -> road in place (the difference only)
 *   depot   1 Wood + 1 Stone + 1 Grain + 1 Oil     workforce (grain) + depot expansion (oil)
 *   plant   2 Wood + 2 Stone + 2 Grain + 3 Ore     the second processing plant
 *
 * Gold is deliberately absent: it is reserved for Black Market sabotage
 * (PP-08) and pays for nothing here.
 *
 * The table lives in this module — the lowest import layer — so every surface
 * can read it without an import cycle: TRANSPORT / UPGRADE_COST below alias
 * into it, construction.ts re-exports it for the Depot price (DEPOT_COST),
 * and plants.ts reads the plant entry (PLANT_COST). The UI labels, the
 * placement charges, the AI plans and the multiplayer host authority all
 * resolve through these aliases, so "what you see" and "what you are
 * charged" are one number.
 */
export const BUILD_COSTS: Readonly<Record<
  "dirt" | "road" | "upgrade" | "depot" | "plant" | "rail" | "platform" | "trainDepot" | "train",
  Partial<Record<Cargo, number>>
>> = {
  // A Dirt Road is FREE: the gravel is the plumbing every game needs, and
  // charging for it only ever delayed the first connection. What it costs is
  // TIME — a lorry crawls on gravel and runs four times quicker on tarmac
  // (`TRUCK_ROAD_MULT` in vehicles.ts), so paving is the upgrade you pay for.
  dirt: {},
  // Owner balancing pass (2026-09): every price in the game ×3. Dirt stays free.
  road: { wood: 3, stone: 3, ore: 12 },
  upgrade: { ore: 12 },
  // One of every cargo but gold — about half a processing plant (owner, 2026-09).
  depot: { grain: 3, wood: 3, stone: 3, ore: 3, oil: 3 },
  plant: { wood: 6, stone: 6, grain: 6, ore: 9 },
  rail: { stone: 3 },
  platform: { wood: 12, stone: 12, ore: 36, oil: 6 },
  trainDepot: { wood: 9, stone: 9, ore: 12, oil: 6 },
  train: { ore: 12, oil: 6 },
};

// ── VP-01: the victory table ──────────────────────────────────────────────
/**
 * Victory Points come from exactly TWO sources, and both of them are things a
 * player *upgrades* rather than merely connects:
 *
 *   upgrade  0.25★ per Dirt Road tile paved into a Road, in place
 *   plant    1★    per processing plant raised after the setup Factory
 *   target   10★   first player there wins
 *
 * Dirt Road scores nothing (that is the ticket), and neither does a connection
 * — dirt or paved. A connection sets the throughput multiplier and that is its
 * whole job. The paved tile VP is deliberately gated on the UPGRADE
 * (`track.ts`'s `upgraded` provenance layer), so a Road laid on virgin ground
 * at full price earns no point: the score pays for improving what you already
 * built, four paves to the point. At 4 Ore a tile, 10★ of pure road is 40
 * paved tiles (160 Ore) — the scoreboard is a measurement of how much ore a
 * network can turn in, which is what keeps a game from ending on the first
 * two spurs. `victory.ts` is the only reader of these three numbers.
 *
 * The line has moved twice: AI-02 raised it from 10★ to 20★ on the
 * player's first long session (a healthy normal-seat race to 10★ was
 * finishing around minute 11–14, before its economy had visibly mattered),
 * and it is back to 10★ now. The per-point numbers never moved — only the
 * finish line did.
 */
export const VICTORY = {
  /** VP per Dirt Road tile paved into a Road (`TRANSPORT.road.vpUpgrade`). */
  upgrade: 0.25,
  /** VP per processing plant raised after setup. */
  plant: 1,
  /** RAIL-02 (#176): VP per railway PLATFORM built (`PLATFORM_VP` in
   *  `rail.ts` aliases this). The epic's exact figure: a platform is worth its
   *  point at valid construction — a line does not have to be running — and
   *  the point is revoked when the platform is demolished. */
  platform: 1,
  /** VP needed to win. Back to 10★ — the AI-02 experiment with a 20★ line
   *  made games drag, so the race runs to 10 again.
   *  AI-04: this is the SHIPPED line and the default for `hasWon`, but it is no
   *  longer the only line: the difficulty presets may race a shorter one
   *  (`RIVAL_SKILLS.easy.winTarget` = 5★), and `game.ts` reads the live preset's
   *  number for the win check, the HUD and the rival's race assessment. */
  target: 10,

  // ────────────────────────────────────────────────────────────────────────
  // L13 (#228) — THE NEW LOOP'S ★ TABLE.
  //
  // The three rows above pay for actions the redesigned loop no longer has as
  // its spine. L2 (#216) made dirt FREE, so `upgrade` — 0.25★ a paved tile,
  // and 90% of every score on the shipped loop — pays for a road tier the loop
  // does not require; and L5 (#219) made the CITY the thing a seat upgrades,
  // which leaves an "extra Processing Plant" scoring 1★ for feeding a board
  // that is no longer a constant board. Under `newLoop` both pay ZERO (see
  // `rescore` in victory.ts, which simply stops handing the scorer paves and
  // plants), and the ★ come from the loop's own actions instead:
  //
  //   type   a DEPOT TYPE RUNNING — one per distinct cargo the seat has a
  //          connected, producing Depot for. This is the BREADTH axis and the
  //          long pole of the race: a new type needs an industry of that cargo
  //          near your network, a road out to it, its rung open and its mix
  //          paid. Revocable, like a pave was: cut the road and the type stops
  //          running, so the scoreboard stays a live view of the network
  //          rather than a history of everything ever built.
  //   rung   a RUNG OF THE DEPOT TREE UNLOCKED (L5's `depotTier`). Cheap and
  //          monotone — a played tuning session opens one — so it is the
  //          smallest of the three: it marks progress, it does not carry a
  //          game. You cannot un-unlock a rung, so this one never revokes.
  //   city   a CITY UPGRADE TIER bought and confirmed on the board (L5's
  //          `townLevel`). This is the DEPTH axis: fewer, richer depots and a
  //          higher base rate instead of more routes. Monotone too.
  //
  // Why these numbers. The pool is deliberately BIGGER than the line so no
  // single source is a toll gate: 6 types (12★) + 2 rungs (2★) + 3 city
  // tiers (3★, #297's 1★ each) = 17★ against a 12★ line. No single source
  // carries most of the win line — types at 12★ is the full breadth axis
  // (six connected depots), city at 3★ is a quarter of the line and rungs
  // at 2★ are the progress marker they were always meant to be.
  //
  // #297: city was 2★ per tier (L17's three rows at 2★ = 6★, half the win
  // line), and the rival could buy two tiers in one turn (cap-first at step 0
  // and post-depot at step 4 of `aiNewLoopTurn`), bursting 4★ of city plus
  // depot types in a single clock. The fix is both halves: one tier per turn
  // (`townBoughtThisTurn` in game.ts) and 1★ per tier here, so no single turn
  // can carry the rival past the line the player is still racing toward.
  //
  // `target` is the new loop's OWN line and is read only when the flag is on
  // (`winTarget()` in game.ts). The shipped 10★ above is untouched, so every
  // VP-01 test, the host settings range (#186) and ranked play keep racing the
  // number they always did — this ticket's MVP scope is the solo new loop.
  // ────────────────────────────────────────────────────────────────────────
  // Owner balancing pass (2026-09) — the table the owner plays:
  //   type   1★ per DEPOT running (connected and producing) — every Depot,
  //          not one per cargo. Revocable: cut its road and it stops paying.
  //   route  1★ per Depot whose route to your plant is FULLY PAVED Road.
  //          Revocable too (demolish a paved tile and the route stops paying).
  //   city   1★ per city upgrade tier (unchanged).
  //   rung   0 — the depot tree's rung gate is off, so rungs pay nothing.
  // Railways are out of the game, so platforms pay nothing on this loop.
  loop: {
    /** ★ per Depot running (connected, producing) — owner call, 2026-09. */
    type: 1,
    /** ★ per Depot whose route to the plant is fully paved (2026-09). */
    route: 1,
    /** ★ per Depot upgraded to the top level (`DEPOT_LEVELS.max`) — 2026-09. */
    maxDepot: 1,
    /** ★ per rung of the depot tree unlocked — retired (0) with the gate. */
    rung: 0,
    /** ★ per city upgrade tier bought and confirmed (L5 `townLevel`).
     *  #297: 1★ per tier (was 2★). Three tiers at 1★ = 3★, a quarter of the
     *  12★ line — no single source carries most of the win condition. */
    city: 1,
    /** ★ needed to win under the new loop. */
    target: 12,
  },
} as const;

export const TRANSPORT: Record<"dirt" | "road", TransportDef> = {
  dirt: {
    key: "dirt", name: "Dirt Road",
    cost: BUILD_COSTS.dirt,
    // VP-01: gravel scores nothing, and there is no tier under it to pave.
    vpUpgrade: 0, throughput: 1.0, onRough: true, label: "Dirt Road",
  },
  road: {
    key: "road", name: "Road",
    cost: BUILD_COSTS.road,
    // VP-01: the tile VP is paid per DIRT TILE PAVED, never per connection and
    // never for a Road laid on virgin ground.
    vpUpgrade: VICTORY.upgrade, throughput: 1.6, onRough: false, label: "Road",
  },
};

// Dirt→road upgrade pays only the difference (settled: yes, pave in place).
//
// W9: neither this nor TRANSPORT.road.cost can ever be paid with the free
// setup allowance. That allowance (FREE_SETUP_TRACK — it lives in `game.ts`
// with the rest of the E8 tuning surface, not here) buys DIRT ONLY; the single
// implementation of the rule is `freeAllowanceCovers` in `track.ts`, which
// `previewDrag` (the human drag) and `planCandidates`/`executeCandidate` (the
// rival) all consult. The paved Road therefore stays gated behind an ore mine
// exactly as E8/PP-07 settled it — "wood and stone for roads, no ore — the
// paved road is gated behind an ore mine" — instead of arriving free with the
// opening 12 tiles, at road throughput (×1.6) and — since VP-01 — at road VP.
export const UPGRADE_COST: Partial<Record<Cargo, number>> = BUILD_COSTS.upgrade;

/**
 * VP-01: the winning total. Dropped from 12 to 10 alongside the new point
 * economy, because the only sources left are paves (0.25★) and plants (1★).
 */
export const VP_TARGET = VICTORY.target;

// ── Player buildings ───────────────────────────────────────────────────────
/**
 * PP-12: the Factory / Processing Plant is ONE verbatim TTD factory complex
 * (`factory` file cell), drawn as a single draw item — not four per-tile
 * pieces. The MT-1/MT-2 `factory_mt_*` cells stay packed as legacy but the
 * game no longer emits them.
 */
export const FACTORY_SPRITE = "factory";

/**
 * PP-12: the Factory footprint is DERIVED from its sprite's packed width via
 * `footprintForArt` — the image dictates the tiles it occupies (currently
 * 3×3 for the 224px TTD factory). Every consumer (placement, plants, grid,
 * AI, game) reads this constant, so re-arting the factory re-flows the rules
 * with no code change. tests/unit/iso-pp12-assets.test.ts pins that this
 * equals the manifest's own footprint for the sprite.
 */
export const FACTORY_FOOTPRINT: [number, number] = footprintForArt(spriteWidth(FACTORY_SPRITE));

/**
 * Depot art: ONE truck depot building for every Depot, whatever it harvests
 * (like the railway's single platform art). The per-cargo outposts
 * (`depot_<cargo>`) were retired. Drawn on a 2×2 art area.
 */
export const DEPOT_SPRITE = "truck_depot";

/**
 * PP-12: one town variant per packed TTD house file (43). The church is the
 * town centre (`town_center` cell); the bungalows pair and the two stadiums
 * are packed as `spare_*` cells instead — far too wide for a 1x1 tile.
 */
export const TOWN_HOUSE_VARIANTS = [
  "town_offices_1423", "town_office_1460", "town_flats_trop_1x1_4", "town_flats_trop_1x1_7",
  "town_cottage_arctic_1x1_1", "town_flats_arctic_1x1_1", "town_flats_arctic_1x1_2",
  "town_fountain_1x1", "town_house_arctic_1x1_5", "town_shops_arctic_1x1_2",
  "town_small_flat_1x1_1", "town_small_flat_1x1_2", "town_small_house_1x1_1",
  "town_small_house_arctic_1x1_2", "town_townhouse_garden_2", "town_townhouse_gardens_2",
  "town_flats_trop_2x1_6", "town_flats_arctic_2x1_1", "town_flats_arctic_2x1_2",
  "town_townhouse_3", "town_townhouse_garden_3", "town_bank", "town_cinema", "town_flats",
  "town_flats_2", "town_flats_4", "town_flats_grey", "town_hotel", "town_house_pool",
  "town_shops_modern", "town_house_modern", "town_house_modern_2", "town_office_tower_modern",
  "town_shops_offices", "town_shops_offices_2", "town_cottage_old_small_a",
  "town_cottage_old_small", "town_cottage_old_small_2", "town_shop_small", "town_house_swiss",
  "town_cottage_tall", "town_offices_tall", "town_flats_townhouse_tall",
] as const;

/** Spatial hash of a tile, used to pick town art.
 *  A hash rather than `(x + y) % n`, which bands a settlement into diagonal
 *  stripes; deterministic, so a re-render always puts the same building on
 *  the same tile. */
function tileHash(tx: number, ty: number): number {
  let h = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

/**
 * TOWN-GRID: a deterministic uniform pick from `variants`, keyed on a tile.
 *
 * The caller filters the list by FOOTPRINT — `townBuildings` in grid.ts picks
 * a 2×2 cell for a whole house block and a 1×1 cell for a single tile — so
 * the art can never be placed on more tiles than the block it was chosen for
 * (which is what used to put an office tower across a street).
 */
export function pickTownVariant(tx: number, ty: number, variants: readonly string[]): string {
  return variants[tileHash(tx, ty) % variants.length];
}

/** The atlas cell a town tile draws, chosen from every variant.
 *  With 43 variants a uniform pick already mixes homes, shops and the
 *  occasional tall block — no weighting needed. */
export function townHouseSprite(tx: number, ty: number): string {
  return pickTownVariant(tx, ty, TOWN_HOUSE_VARIANTS);
}

// ── L17 (#245): town tiers — what a town draws at each growth step ─────────
/**
 * The tiers a town VISUALLY grows through under the new loop:
 *
 *   0  village   — small 1×1 homes around the church; streets remain paved
 *                  with sidewalks, lamps and paved yards;
 *   1  town      — the full building mix of today's towns, and the centre
 *                  becomes the bank (this is what you click to upgrade);
 *   2  city      — the footprint grows one block-ring outward;
 *   3  metropolis — a second ring. `TOWN_VISUAL_MAX` caps the look; the
 *                  economy (`townLevel`) can climb past it and simply stops
 *                  growing the map.
 *
 * A town with NO level (`Town.level` absent, `TOWN_TIER_LEGACY`) draws exactly
 * what towns always drew — that is the shipped loop, the rooms and the story
 * contracts, and every synthetic grid in the tests.
 */
export const TOWN_TIER_LEGACY = -1;
/** The highest tier the map can show (`setTownLevel` clamps to it). */
export const TOWN_VISUAL_MAX = 3;

/** What each tier is called, in the inspector and the growth toast. */
export function townTierLabel(tier: number): string {
  return ["village", "town", "city", "metropolis"][Math.max(0, Math.min(TOWN_VISUAL_MAX, tier))] ?? "village";
}

/**
 * L17 (#245): the VILLAGE (tier 0) cells — small single homes only, per the
 * ticket: `town_cottage_*`, `town_small_house_*`, `town_small_flat_*`,
 * `town_house_arctic_1x1_5`, `town_house_swiss`, `town_shop_small` and the
 * fountain. Every one is an authored 1×1 cell, so a village never raises a
 * tall or multi-tile building however the atlas is asked.
 *
 * The pick is the same `tileHash` (`pickTownVariant`) within THIS list, so a
 * tile only changes art when its town's tier changes — deterministic and
 * multiplayer-safe, exactly like the full list above.
 */
export const TOWN_VILLAGE_VARIANTS = [
  "town_cottage_arctic_1x1_1", "town_house_arctic_1x1_5", "town_small_house_1x1_1",
  "town_small_house_arctic_1x1_2", "town_small_flat_1x1_1", "town_small_flat_1x1_2",
  "town_cottage_old_small_a", "town_cottage_old_small", "town_cottage_old_small_2",
  "town_shop_small", "town_house_swiss", "town_fountain_1x1",
] as const;

/**
 * L17 (#245): the MIDDLE building per tier. A village keeps the church
 * (`town_center`); from the first upgrade on, the centre is the BANK
 * (`town_bank`, per the owner's direction) — the same 2×2 block origin, so
 * the swap is one sprite and nothing else on the map moves. The bank is where
 * the city upgrade is bought: click it.
 */
export function townCentreSprite(tier: number): string {
  return tier >= 1 ? "town_bank" : "town_center";
}
