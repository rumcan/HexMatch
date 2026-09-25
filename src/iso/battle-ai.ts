// ══════════════════════════════════════════════════════════════════════════
// B4 (#249) — the rival fights battles you can watch.
//
// `chooseBattleMove(state, skill)` picks the rival's next battle move — a
// swap or an ability cast — from the live battle. Policy in three layers:
//
//   1. STATIC EVAL of every legal swap (dry-run, no engine mutation):
//      damage it would deal (bomb swaps sweep a whole colour), mana it
//      banks weighted by what that side still needs to cast, extra-turn
//      shapes, and the mana it DENIES the opponent (clearing the colours
//      their bill is waiting on).
//   2. ABILITY EVAL: each row of `BATTLE_ABILITIES` against its cost — a
//      kill shot is worth everything, a free Gold Bribe is worth taking,
//      a wasteful Frost while behind is worth nothing.
//   3. DEPTH: the skill preset says how deep the rival looks (exact shadow
//      plies on a save()/restore() clone of the real engine — same RNG
//      position, same cascades) and how often it simply takes its best
//      line (`pBest`) versus wandering — Easy wanders into second-best
//      and loses games it can see; Hard plays the line and punishes.
//
// Determinism is a hard rule: tie-breaks and the wander rolls come from a
// mulberry32 stream seeded by the battle seed, the skill key and the turn
// count — never `Math.random`, and never the battle's own stream (a
// speculative look must not burn the RNG a replay depends on).
//
// The greedy strawman (`greedyBattleMove`) is the bot the acceptance block
// measures the ladder against: always the best immediate swap, no look,
// no spells, no nerves.
// ══════════════════════════════════════════════════════════════════════════
import { mulberry32 } from "../game/config";
import { createBattle, type AbilityCheck, type Battle, type BattleMove, type BattleSeat } from "../game/battle";
import type { Gem } from "../game/board";
import { GEM_TO_CARGO } from "./quarry";
import {
  BATTLE_ABILITIES, BATTLE_ABILITY_ORDER, type AbilityId, type Cargo,
} from "./config";
import type { SkillKey } from "./skill";

/** The one move the rival can make: swap two gems or cast a spell. */
export type RivalMove = BattleMove;

/**
 * The slice of the live battle the policy reads. `Battle` satisfies it —
 * the type documents what is actually needed.
 */
export interface BattleAiState {
  readonly seed: number;
  readonly rules: Battle["rules"];
  readonly state: Battle["state"];
  readonly board: Battle["board"];
  canUse(id: string, seat?: BattleSeat): AbilityCheck;
}

export interface SkillPolicy {
  /** Shadow plies beyond the immediate swap (0 = static eval only). */
  depth: 0 | 1 | 2;
  /** How often the rival takes its best line (the rest wanders). */
  pBest: number;
  /** Cast spells (hard and normal do; easy takes only the obvious shots). */
  cast: "obvious" | "value" | "value+";
  /** B5 (#250): how often this skill CALLS a fight over a contested industry. */
  challengeEveryMs: number;
}

/**
 * The battle knobs of a skill. The map AI's clocks live in `skill.ts`
 * (`RIVAL_SKILLS`) — battle play is its own policy surface (B7 tunes).
 */
export const BATTLE_SKILLS: Record<SkillKey, SkillPolicy> = {
  easy:   { depth: 0, pBest: 0.55, cast: "obvious", challengeEveryMs: 600_000 },
  normal: { depth: 1, pBest: 0.82, cast: "value", challengeEveryMs: 360_000 },
  hard:   { depth: 2, pBest: 0.97, cast: "value+", challengeEveryMs: 210_000 },
};

const SKILL_SALT: Record<SkillKey, number> = {
  easy: 0x1a2b3c4d, normal: 0x2c3d4e5f, hard: 0x3e4f5a6b,
};

const emptyW = (): Record<Cargo, number> =>
  ({ grain: 0, wood: 0, ore: 0, stone: 0, oil: 0, gold: 0 });

const sumMana = (m: Record<Cargo, number>): number =>
  (Object.values(m) as number[]).reduce((s, n) => s + n, 0);

// ── static swap evaluation ──────────────────────────────────────────────────

interface SwapEval {
  mv: [number, number, number, number];
  score: number;
}

/**
 * What a side still wants to buy: per-cargo bill pressure of the abilities
 * its depots unlock and its mana can ALMOST reach. Clearing a colour under
 * pressure is worth more than clearing a colour it can already cast.
 */
const needWeights = (
  state: Battle["state"], seat: BattleSeat, depots: Cargo[],
): Record<Cargo, number> => {
  const w = emptyW();
  const me = state.players[seat];
  for (const id of BATTLE_ABILITY_ORDER) {
    const def = BATTLE_ABILITIES[id];
    if (def.requires && !depots.includes(def.requires)) continue;
    const readyIn = state.cooldowns[seat][id] ?? 0;
    if (readyIn > 1) continue; // not part of the near future
    for (const [c, n] of Object.entries(def.cost) as [Cargo, number][]) {
      const missing = n - (me.mana[c] ?? 0);
      if (missing > 0) w[c] += missing; // only the shortfall counts
    }
  }
  return w;
};

/** Gems of one cargo a sweep of `res` would purge. */
const purgeEstimate = (board: Battle["board"], res: Gem["res"]): number => {
  let n = 0;
  for (const g of board.gems()) {
    if (g.res === res && !g.block && g.hard === 0) n++;
  }
  return n;
};

/**
 * Dry-run one swap: paint it on the grid, read the groups it would make
 * (sizes, crossings and bombs), paint it back. The board is untouched.
 */
const evalSwap = (
  state: BattleAiState, mv: [number, number, number, number],
  mine: Record<Cargo, number>, theirs: Record<Cargo, number>,
): SwapEval => {
  const [r1, c1, r2, c2] = mv;
  const board = state.board;
  const a = board.grid[r1][c1]!, b = board.grid[r2][c2]!;
  board.grid[r1][c1] = b;
  board.grid[r2][c2] = a;
  b.r = r1; b.c = c1; a.r = r2; a.c = c2;

  let score = 0;
  let biggest = 0;
  const clearedCount: Partial<Record<Gem["res"], number>> = {};
  const groups = board.findGroups();
  for (const cells of groups) {
    biggest = Math.max(biggest, cells.length);
    for (const g of cells) {
      clearedCount[g.res] = (clearedCount[g.res] ?? 0) + 1;
    }
  }
  // shaped (L/T/cross): one swapped cell carries two group memberships
  let shaped = false;
  for (const [r, c] of [[r1, c1], [r2, c2]] as const) {
    let inRuns = 0;
    for (const cells of groups) {
      if (cells.some((g) => g.r === r && g.c === c)) inRuns++;
    }
    if (inRuns >= 2) shaped = true;
  }

  // mana utility + denial, per cargo cleared
  for (const [res, n] of Object.entries(clearedCount) as [Gem["res"], number][]) {
    const cargo = GEM_TO_CARGO[res];
    score += n * (1 + 0.55 * Math.min(4, mine[cargo]));
    score += n * 0.35 * Math.min(4, theirs[cargo]);
  }

  // damage gems: a bomb swapped to a gem detonates SWEEPING THE GEM'S COLOUR
  // (`_doSwap` → `detonate(bomb, other.res)`); a bomb caught in a match sweeps
  // its own colour's blast through the settle.
  const swappedBomb = a.special === "bomb" ? a : b.special === "bomb" ? b : null;
  if (swappedBomb) {
    const other = swappedBomb === a ? b : a;
    score += purgeEstimate(board, other.res) * state.rules.damagePerGem * 2.2;
  }
  for (const cells of groups) {
    for (const g of cells) {
      if (g.special === "bomb") {
        score += purgeEstimate(board, g.res) * state.rules.damagePerGem * 1.6;
      }
    }
  }
  // extra turns win games — unless B7's chain cap (#252) has already used
  // up this seat's run of extras, when the turn passes whatever the shape
  const cap = state.rules.extraTurnChain ?? 0;
  const capped = cap > 0 && (state.state.chain ?? 0) >= cap;
  if (!capped && biggest >= state.rules.extraTurnMinMatch) score += 9;
  if (!capped && shaped && state.rules.extraTurnOnShape) score += 7;

  // paint back
  board.grid[r1][c1] = a;
  board.grid[r2][c2] = b;
  a.r = r1; a.c = c1; b.r = r2; b.c = c2;
  return { mv, score };
};

/** Every legal adjacency a swap could carry. */
const legalSwaps = (board: Battle["board"]): [number, number, number, number][] => {
  const out: [number, number, number, number][] = [];
  for (const g of board.gems()) {
    for (const [dr, dc] of [[0, 1], [1, 0]] as const) {
      const n = board.grid[g.r + dr]?.[g.c + dc];
      if (!n || g.block || n.block) continue;
      out.push([g.r, g.c, n.r, n.c]);
    }
  }
  return out;
};

/** A swap the engine would actually carry: makes a match or detonates a bomb. */
const makesAMatch = (board: Battle["board"], mv: [number, number, number, number]): boolean => {
  const [r1, c1, r2, c2] = mv;
  const a = board.grid[r1][c1]!, b = board.grid[r2][c2]!;
  if (a.special === "bomb" || b.special === "bomb") return true;
  board.grid[r1][c1] = b;
  board.grid[r2][c2] = a;
  b.r = r1; b.c = c1; a.r = r2; a.c = c2;
  const ok = board.findGroups().length > 0;
  board.grid[r1][c1] = a;
  board.grid[r2][c2] = b;
  a.r = r1; a.c = c1; b.r = r2; b.c = c2;
  return ok;
};

const evalAllSwaps = (state: BattleAiState, seat: BattleSeat): SwapEval[] => {
  const me = needWeights(state.state, seat, state.state.players[seat].depots);
  const oppSeat = (1 - seat) as BattleSeat;
  const opp = needWeights(state.state, oppSeat, state.state.players[oppSeat].depots);
  const out: SwapEval[] = [];
  for (const mv of legalSwaps(state.board)) {
    if (!makesAMatch(state.board, mv)) continue;
    out.push(evalSwap(state, mv, me, opp));
  }
  out.sort((x, y) => y.score - x.score);
  return out;
};

// ── ability evaluation ──────────────────────────────────────────────────────

/** What a cast is worth right now, in the same units as swap scores. */
const evalAbility = (state: BattleAiState, seat: BattleSeat, id: AbilityId): number => {
  const check = state.canUse(id, seat);
  if (!check.ok) return -Infinity;
  const def = BATTLE_ABILITIES[id];
  const me = state.state.players[seat];
  const opp = state.state.players[(1 - seat) as BattleSeat];
  switch (id) {
    case "dynamite": {
      const dmg = def.damage ?? 0;
      if (dmg >= opp.health) return 10_000; // the kill shot
      return dmg * 3.4 - (def.costsTurn === false ? 0 : 4);
    }
    case "repair": {
      const full = me.maxHealth ?? state.rules.startHealth;
      const missing = full - me.health;
      if (missing <= 0) return -8;
      const heal = Math.min(def.heal ?? 0, missing);
      const danger = opp.health < (opp.maxHealth ?? state.rules.startHealth) * 0.5 ? -3 : 0;
      return heal * 2.6 + (me.health <= full * 0.35 ? 6 : 0) + danger;
    }
    case "smog": {
      // best when the opponent sits on a bank they are about to spend
      const bank = sumMana(opp.mana);
      return 3 + bank * 0.5 - (def.costsTurn === false ? 0 : 5);
    }
    case "bribe": {
      let steal = 0;
      for (const c of Object.keys(opp.mana) as Cargo[]) {
        steal += Math.min(opp.mana[c] ?? 0, def.stealPerCargo ?? 0);
      }
      return steal * 2.2 + 1.5; // free action: even crumbs are crumbs
    }
    case "girders":
    case "frost": {
      // disruption pays while ahead (make the leader's board worse) —
      // while behind, the turn is worth more as a match
      const ahead = me.health - opp.health;
      return 2 + ahead * 0.25 - (def.costsTurn === false ? 0 : 5);
    }
    default:
      return -Infinity;
  }
};

// ── depth: exact shadow plies ───────────────────────────────────────────────

/**
 * An exact in-process clone: same seed lineage, restored to the same draw
 * position. Speculative play on it can never leak into the real battle.
 */
const cloneBattle = (battle: Battle): Battle => {
  const b = createBattle({
    seed: battle.seed,
    players: [
      { id: battle.state.players[0].id, name: battle.state.players[0].name, depots: battle.state.players[0].depots },
      { id: battle.state.players[1].id, name: battle.state.players[1].name, depots: battle.state.players[1].depots },
    ],
    rules: battle.rules,
  });
  b.restore(battle.save());
  return b;
};

/**
 * Look past the immediate move on an exact clone of the engine. Returns a
 * positional score from `seat`'s point of view: the root move's static
 * score, health gap and banked mana pressure after it resolves — then, if
 * `plies` remain, the continuation the NEXT mover would choose (their best
 * answer against us, or our own best extra turn).
 */
const shadowScore = async (
  battle: Battle, seat: BattleSeat, mv: RivalMove, rootScore: number, plies: number,
): Promise<number> => {
  const clone = cloneBattle(battle);
  if (mv.t === "ability") {
    const out = await clone.useAbility(mv.id);
    if (!out.ok) return rootScore;
  } else {
    const out = await clone.playSwap(mv.r1, mv.c1, mv.r2, mv.c2, 0);
    if (!out.ok) return rootScore;
  }
  if (clone.state.over) {
    return clone.state.winner === seat ? 50_000 : clone.state.winner === null ? 0 : -50_000;
  }
  let score = rootScore;
  const me = clone.state.players[seat], opp = clone.state.players[(1 - seat) as BattleSeat];
  score += (me.health - opp.health) * 1.6;
  score += (sumMana(me.mana) - sumMana(opp.mana)) * 0.35;

  if (plies > 0) {
    const nextSeat = clone.state.turn;
    const replies = evalAllSwaps(clone, nextSeat).slice(0, 3);
    if (replies.length === 0) return score + 6; // a stuck opponent is worth points
    let roll = nextSeat === seat ? -Infinity : Infinity;
    for (const rep of replies) {
      const after = await shadowScore(
        clone, seat,
        { t: "swap", r1: rep.mv[0], c1: rep.mv[1], r2: rep.mv[2], c2: rep.mv[3] },
        0, plies - 1,
      );
      roll = nextSeat === seat ? Math.max(roll, after) : Math.min(roll, after);
    }
    score += roll * 0.5;
  }
  return score;
};

// ── the policy ──────────────────────────────────────────────────────────────

/** B7 (#252): a free action below this value is not worth the fuss. */
const FREE_CAST_MIN = 1;

/**
 * B7 (#252): the best FREE cast worth taking right now (`costsTurn: false`
 * rows — Bribe, and since B7 Girders / Frost / Smog). A free action competes
 * with nothing: it is cast first and the swap still follows, so it is never
 * priced against the best swap (before B7 it was, and the rival never cast a
 * control spell at all). `only` narrows the book (Easy sees just the Bribe).
 */
const bestFreeCast = (state: Battle, seat: BattleSeat, only?: (id: AbilityId) => boolean): RivalMove | null => {
  let best: RivalMove | null = null;
  let bestScore = FREE_CAST_MIN;
  for (const id of BATTLE_ABILITY_ORDER) {
    if (BATTLE_ABILITIES[id].costsTurn !== false || (only && !only(id))) continue;
    const v = evalAbility(state, seat, id);
    if (v > bestScore) { bestScore = v; best = { t: "ability", id, seat }; }
  }
  return best;
};

/**
 * B4 — the rival's move. `state` is the live battle (`Battle` satisfies
 * `BattleAiState`); `skill` is the preset key (`skill.ts`). Deterministic
 * in (seed, skill, turns): same battle, same rival, same choices.
 */
export async function chooseBattleMove(
  state: Battle, skill: SkillKey,
): Promise<RivalMove | null> {
  const seat = state.state.turn;
  const policy = BATTLE_SKILLS[skill];
  const swaps = evalAllSwaps(state, seat);
  if (swaps.length === 0) {
    // nothing to swap into: only a kill shot is worth casting here
    return killShot(state, seat);
  }

  // a kill shot first — then any free action worth taking (B7): it costs no
  // turn, so the swap below still happens after it
  const kill = killShot(state, seat);
  if (kill) return kill;
  const free = bestFreeCast(state, seat, policy.cast === "obvious" ? (id) => id === "bribe" : undefined);
  if (free) return free;

  // spell or swap? each castable row priced against the best swap it would
  // displace (a free action competes with nothing — it went above)
  let best: RivalMove = { t: "swap", ...zip(swaps[0].mv) };
  let bestScore = swaps[0].score;
  for (const id of BATTLE_ABILITY_ORDER) {
    const v = evalAbility(state, seat, id);
    if (policy.cast === "obvious") {
      // easy takes only the shots a beginner sees: the kill and the freebie
      const obvious = v >= 10_000 || (id === "bribe" && v > 1.5);
      if (!obvious) continue;
    }
    if (v > bestScore) {
      bestScore = v;
      best = { t: "ability", id, seat };
    }
  }

  // depth re-grades the top lines on exact shadow plies
  if (policy.depth > 0) {
    const contenders: { mv: RivalMove; score: number }[] = [];
    const top = swaps.slice(0, policy.depth === 1 ? 4 : 5);
    for (const ev of top) {
      const mv: RivalMove = { t: "swap", ...zip(ev.mv) };
      contenders.push({ mv, score: await shadowScore(state, seat, mv, ev.score, policy.depth - 1) });
    }
    if (best.t === "ability") {
      contenders.push({ mv: best, score: await shadowScore(state, seat, best, bestScore * 0.35, policy.depth - 1) });
    }
    contenders.sort((x, y) => y.score - x.score);
    best = contenders[0].mv;
  }

  // …and how often it TAKES that best line is the skill's nerve
  const rng = mulberry32(
    (state.seed ^ SKILL_SALT[skill] ^ Math.imul(state.state.turns + 1, 0x9e3779b9)) >>> 0,
  );
  if (swaps.length > 1 && rng() >= policy.pBest && bestScore < 10_000) {
    // a seeded excursion: the second- or third-shallow-best line, like a
    // hurried eye — never away from a kill shot
    const k = Math.min(swaps.length - 1, 1 + Math.floor(rng() * 2));
    return { t: "swap", ...zip(swaps[k].mv) };
  }
  return best;
}

const killShot = (state: Battle, seat: BattleSeat): RivalMove | null => {
  if (!state.canUse("dynamite", seat).ok) return null;
  const def = BATTLE_ABILITIES.dynamite;
  const opp = state.state.players[(1 - seat) as BattleSeat];
  return (def.damage ?? 0) >= opp.health ? { t: "ability", id: "dynamite", seat } : null;
};

const zip = (mv: [number, number, number, number]) =>
  ({ r1: mv[0], c1: mv[1], r2: mv[2], c2: mv[3] });

/**
 * The acceptance block's strawman ("a greedy-move bot"): always the best
 * immediate MOVE — swap or spell — never a look, never a doubt, never a
 * nervous second pick. The skill ladder is measured against this: it
 * hammers damage when the greedy value says so, and Easy's obvious-shots
 * policy gives that damage back unanswered.
 */
export function greedyBattleMove(state: Battle): RivalMove | null {
  const seat = state.state.turn;
  const free = bestFreeCast(state, seat);   // B7: freebies first (see above)
  if (free) return free;
  const swaps = evalAllSwaps(state, seat);
  let best: RivalMove | null = swaps.length ? { t: "swap", ...zip(swaps[0].mv) } : null;
  let bestScore = swaps.length ? swaps[0].score : -Infinity;
  for (const id of BATTLE_ABILITY_ORDER) {
    const v = evalAbility(state, seat, id);
    if (v > bestScore) {
      bestScore = v;
      best = { t: "ability", id, seat };
    }
  }
  return best;
}
