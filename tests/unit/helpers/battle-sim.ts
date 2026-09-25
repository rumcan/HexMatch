// ══════════════════════════════════════════════════════════════════════════
// B7 (#252) — the bot-vs-bot battle harness behind docs/battle-balance.md.
//
// Drives the REAL engine (`createBattle`) with the REAL policies (#249's
// `chooseBattleMove` / `greedyBattleMove`) to the engine's own verdict, and
// records what happened: who won, how (knockout / turn limit / draw), how
// long it took, which abilities were cast and what they did.
//
// Everything is seeded: the battle's board stream is the battle seed, the
// policies' tie-breaks are seeded from (seed, skill, turn). Two runs of the
// same matrix print the same table.
//
// Variants are applied by OVERRIDING the shipped tables for the length of one
// call (`withTables`), so a "what if dynamite did 6" row runs the exact same
// code the game ships, and the tables are always put back — even on a throw.
// ══════════════════════════════════════════════════════════════════════════
import { createBattle, type Battle, type BattleSeat } from "../../../src/game/battle";
import { chooseBattleMove, greedyBattleMove, type RivalMove } from "../../../src/iso/battle-ai";
import {
  BATTLE_ABILITIES, BATTLE_ABILITY_ORDER, BATTLE_RULES,
  type AbilityId, type BattleAbilityDef, type BattleRules, type Cargo,
} from "../../../src/iso/config";

export const ALL_CARGO: Cargo[] = ["grain", "wood", "ore", "stone", "oil", "gold"];

/** Who sits in a chair. `swapper` = greedy swaps, never casts. */
export type SimPolicy = "easy" | "normal" | "hard" | "greedy" | "swapper";

export interface SimSeat {
  policy: SimPolicy;
  /** The map depots this seat brings (the ability gate). Default: all six. */
  depots?: Cargo[];
  /**
   * Measurement seat: cast THIS ability whenever it is castable, otherwise
   * play `policy`. Prices an ability's raw worth apart from the AI's opinion
   * of it (the policies' cast heuristics are themselves under test).
   */
  spam?: AbilityId;
}

export interface DuelResult {
  seed: number;
  winner: BattleSeat | null;
  /** "ko" = health hit 0; "limit" = turn limit decided on health; "draw" = level at the limit. */
  end: "ko" | "limit" | "draw";
  turns: number;
  health: [number, number];
  casts: [Partial<Record<AbilityId, number>>, Partial<Record<AbilityId, number>>];
  extraTurns: [number, number];
  /** Swaps each seat resolved (casts not included). */
  swaps: [number, number];
  /** Damage dealt by each seat, split by source. */
  dmg: [{ match: number; spell: number }, { match: number; spell: number }];
}

const decide = async (b: Battle, p: SimPolicy): Promise<RivalMove | null> => {
  if (p === "greedy") return greedyBattleMove(b);
  if (p === "swapper") {
    // the greedy eye with the spell book shut: best swap only
    const depots = b.state.players[b.state.turn].depots;
    b.state.players[b.state.turn].depots = [];
    try {
      const mv = greedyBattleMove(b);
      return mv && mv.t === "swap" ? mv : null;
    } finally {
      b.state.players[b.state.turn].depots = depots;
    }
  }
  return chooseBattleMove(b, p);
};

/** One battle to the engine's verdict. */
export async function simDuel(
  seed: number, seats: [SimSeat, SimSeat], rules: BattleRules = BATTLE_RULES,
  setup?: (b: Battle) => void,
): Promise<DuelResult> {
  const b = createBattle({
    seed,
    players: [
      { id: "p0", name: "P0", depots: seats[0].depots ?? ALL_CARGO },
      { id: "p1", name: "P1", depots: seats[1].depots ?? ALL_CARGO },
    ],
    rules,
  });
  setup?.(b);
  const casts: DuelResult["casts"] = [{}, {}];
  const extraTurns: [number, number] = [0, 0];
  const swaps: [number, number] = [0, 0];
  const dmg: DuelResult["dmg"] = [{ match: 0, spell: 0 }, { match: 0, spell: 0 }];
  for (let guard = 0; guard < 400 && !b.state.over; guard++) {
    const seat = b.state.turn;
    const spam = seats[seat].spam;
    const mv: RivalMove | null = spam && b.canUse(spam, seat).ok
      ? { t: "ability", id: spam } as RivalMove
      : await decide(b, seats[seat].policy);
    if (!mv) { await b.ensureMove(); continue; }
    if (mv.t === "ability") {
      const out = await b.useAbility(mv.id);
      if (!out.ok) { await b.ensureMove(); continue; }
      const id = mv.id as AbilityId;
      casts[seat][id] = (casts[seat][id] ?? 0) + 1;
      dmg[seat].spell += out.damage;
    } else {
      const out = await b.playSwap(mv.r1, mv.c1, mv.r2, mv.c2, 0);
      if (!out.ok) { await b.ensureMove(); continue; }
      dmg[seat].match += out.damage;
      swaps[seat]++;
      if (out.extraTurn) extraTurns[seat]++;
    }
  }
  const [a, c] = b.state.players;
  const ko = a.health <= 0 || c.health <= 0;
  return {
    seed,
    winner: b.state.winner,
    end: ko ? "ko" : b.state.winner === null ? "draw" : "limit",
    turns: b.state.turns,
    health: [a.health, c.health],
    casts, extraTurns, swaps, dmg,
  };
}

/** Per-side tally for a matchup played from BOTH chairs. */
export interface Tally {
  n: number;
  wins: number;
  losses: number;
  draws: number;
  ko: number;
  limit: number;
  turns: number;
  /** Casts by the measured side, per ability. */
  casts: Partial<Record<AbilityId, number>>;
  extraTurns: number;
  /** Swaps resolved by the measured side. */
  swaps: number;
  /** Damage dealt by the measured side: matches/bombs, and spells. */
  matchDmg: number;
  spellDmg: number;
  /** Seat-0 wins over decisive games (first-mover advantage read). */
  seat0Wins: number;
  decisive: number;
}

export const emptyTally = (): Tally => ({
  n: 0, wins: 0, losses: 0, draws: 0, ko: 0, limit: 0, turns: 0,
  casts: {}, extraTurns: 0, swaps: 0, matchDmg: 0, spellDmg: 0, seat0Wins: 0, decisive: 0,
});

/**
 * Play `a` against `b` over `seeds`, swapping chairs every seed so the
 * first-move advantage cancels. The tally is from `a`'s side.
 */
export async function matchup(
  a: SimSeat, b: SimSeat, seeds: readonly number[], rules: BattleRules = BATTLE_RULES,
  setup?: (b: Battle) => void,
): Promise<Tally> {
  const t = emptyTally();
  for (let i = 0; i < seeds.length; i++) {
    const aSeat: BattleSeat = (i % 2) as BattleSeat;
    const seats: [SimSeat, SimSeat] = aSeat === 0 ? [a, b] : [b, a];
    const r = await simDuel(seeds[i], seats, rules, setup);
    t.n++;
    t.turns += r.turns;
    if (r.end === "ko") t.ko++; else t.limit++;
    if (r.winner === null) t.draws++;
    else {
      t.decisive++;
      if (r.winner === 0) t.seat0Wins++;
      if (r.winner === aSeat) t.wins++; else t.losses++;
    }
    for (const [id, n] of Object.entries(r.casts[aSeat]) as [AbilityId, number][]) {
      t.casts[id] = (t.casts[id] ?? 0) + n;
    }
    t.extraTurns += r.extraTurns[aSeat];
    t.swaps += r.swaps[aSeat];
    t.matchDmg += r.dmg[aSeat].match;
    t.spellDmg += r.dmg[aSeat].spell;
  }
  return t;
}

/** Win rate with draws as half a win — the number the doc's tables print. */
export const score = (t: Tally): number => (t.n ? (t.wins + t.draws * 0.5) / t.n : 0);

export interface TableOverrides {
  rules?: Partial<BattleRules>;
  abilities?: Partial<Record<AbilityId, Partial<BattleAbilityDef>>>;
}

/**
 * Run `fn` with the shipped tables patched, then put every field back. The
 * engine and the policies read `BATTLE_ABILITIES` live, so patching the object
 * is what makes a variant row run the shipped code path.
 */
export async function withTables<T>(o: TableOverrides, fn: (rules: BattleRules) => Promise<T>): Promise<T> {
  const saved = new Map<AbilityId, BattleAbilityDef>();
  for (const id of BATTLE_ABILITY_ORDER) saved.set(id, { ...BATTLE_ABILITIES[id], cost: { ...BATTLE_ABILITIES[id].cost } });
  try {
    for (const [id, patch] of Object.entries(o.abilities ?? {}) as [AbilityId, Partial<BattleAbilityDef>][]) {
      Object.assign(BATTLE_ABILITIES[id], patch);
    }
    return await fn({ ...BATTLE_RULES, ...(o.rules ?? {}) });
  } finally {
    for (const [id, def] of saved) {
      const live = BATTLE_ABILITIES[id] as unknown as Record<string, unknown>;
      for (const k of Object.keys(live)) delete live[k];
      Object.assign(live, def);
    }
  }
}

export const seedList = (n: number, base = 5000, step = 17): number[] =>
  Array.from({ length: n }, (_, i) => base + i * step);

export const pct = (x: number): string => `${Math.round(x * 100)}%`;
