// ══════════════════════════════════════════════════════════════════════════
// B1 (#246) — the battle engine: a turn-based shared match-3 board.
//
// Phase 2's core. Two players take turns making ONE legal swap each on ONE
// board (the `Board` this engine wraps — the same gem rules the quarry runs,
// set to `paysScore` so no battle ever reaches a purse). Reference: Puzzle
// Quest.
//
//   • a swap resolves its full cascade; every gem the cascade CLEARS banks
//     mana of that gem's cargo (`GEM_TO_CARGO`) for the player whose turn it
//     is, up to `rules.manaCap` per cargo;
//   • a bomb ("dynamite") is the damage gem: whatever bomb a swap detonates
//     sweeps one colour, and every gem the blast purges deals
//     `rules.damagePerGem` damage to the OPPONENT (the sweep feeds damage,
//     not mana — matched gems feed mana, blasts feed damage);
//   • a run of `rules.extraTurnMinMatch` (4+), a special shape (match-5 / L /
//     T / cross) or a cascade of `rules.extraTurnOnCascade` passes grants an
//     EXTRA TURN — otherwise the turn passes. B7 (#252): at most
//     `rules.extraTurnChain` extra turns in a row, so an opening can never
//     chain itself into a one-sided knockout;
//   • no legal move at the top of a turn → the board reshuffles (seeded) and
//     the SAME player moves — a reshuffle is not a turn;
//   • first to 0 health loses; failing that, `rules.turnLimit` resolved swaps
//     ends it and the higher health wins (equal = draw).
//
// Determinism is a hard requirement (B6 multiplayer + replays): the same seed
// and the same move list always produce the same battle. The engine owns a
// private `mulberry32` stream and installs it around every board operation
// (via `getRng`/`setRng`), so the map's own randomness can never leak in.
// `save()` records the stream's draw count, and `restore()` re-warms the
// stream to the exact same position — an authoritative continuation (a host
// rejoining) never diverges from the run it left.
//
// Headless: no DOM, no timers, no clock reads — `now` is passed into
// `playSwap` and handed to the board. The wrapped board runs at
// `waitScale = 0` unless the caller asks for animations (the battle screen
// wants the gems to fall; a bot sim or a unit test never waits).
// ══════════════════════════════════════════════════════════════════════════
import { Board, type PassReport } from "./board";
import { mulberry32, setRng, getRng, type ResKey } from "./config";
import { GEM_TO_CARGO } from "../iso/quarry";
import {
  BATTLE_ABILITIES, CARGOES,
  type BattleAbilityDef, type BattleRules, type Cargo,
} from "../iso/config";

export type BattleSeat = 0 | 1;

/** What a caller names a combatant. The engine owns health/mana/flags. */
export interface BattleContender {
  id: string;
  name: string;
  /**
   * B3 (#248) — the cargos this seat's depots harvest on the map. Gates the
   * abilities' `requires` rows (B5 fills this from the live economy).
   */
  depots?: Cargo[];
}

export interface BattlePlayer {
  id: string;
  name: string;
  health: number;
  /** Mana banked per cargo, never above `rules.manaCap` per colour. */
  mana: Record<Cargo, number>;
  /** This seat is owed (or has just earned) an extra turn. */
  extraTurn: boolean;
  /** Copy of the contender's depot cargos (ability ownership gate). */
  depots: Cargo[];
  /**
   * B7 (#252): this seat's full health — `rules.startHealth`, plus
   * `rules.secondSeatHealth` for the seat that moves second. Repair heals up
   * to it and the health bar is drawn against it. Absent on snapshots from
   * before B7: read it through `maxHealthOf`.
   */
  maxHealth?: number;
}

/** B7 (#252): a seat's full health (older snapshots fall back to the rules). */
export const maxHealthOf = (p: BattlePlayer, rules: BattleRules): number =>
  p.maxHealth ?? rules.startHealth;

export interface BattleState {
  players: [BattlePlayer, BattlePlayer];
  turn: BattleSeat;
  /** Resolved swaps AND spent turns (an ability that costs a turn counts). */
  turns: number;
  /** 0 / 1 when someone won; null while running AND on a draw. */
  winner: BattleSeat | null;
  over: boolean;
  /**
   * B3 — Smog: how many upcoming matches of each seat bank half mana
   * (`[seat 0, seat 1]`, decremented as those matches resolve).
   */
  smog: [number, number];
  /**
   * B3 — per-seat ability cooldowns ("turns until ready"; ticked at each of
   * that seat's turn starts). Keys are `AbilityId`s.
   */
  cooldowns: [{ [id: string]: number }, { [id: string]: number }];
  /**
   * Playtest (2026-09): the seat that cast Frost / Iron Girders. Those
   * obstacles hamper the OPPONENT only — they are cleared the moment the turn
   * comes back to this seat. null = none standing.
   */
  obstaclesBy?: BattleSeat | null;
  /**
   * B7 (#252): extra turns the CURRENT mover has chained in a row. Reset
   * whenever the turn passes; `rules.extraTurnChain` caps it.
   */
  chain?: number;
  /**
   * B7 (#252): obstacles a FREE Girders / Frost cast has armed — they drop
   * the moment the caster's turn passes (never onto the caster's own swap),
   * then lift when the turn comes back, like a turn-costing cast's do.
   */
  armed?: { seat: BattleSeat; girders: number; frost: number; frostHard: 1 | 2 } | null;
}

/** One entry in the replayable move log. B3 adds `{ t: "ability", … }`. */
export type BattleMove =
  | { t: "swap"; r1: number; c1: number; r2: number; c2: number }
  | { t: "ability"; id: string; seat: BattleSeat };

export type Refusal = "over" | "busy" | "illegal" | "no-match";
/** B3: a cast can also fail on the map gate, the mana bill or the cooldown. */
export type AbilityRefusal = Refusal | "turn" | "owner" | "mana" | "cooldown";

/** What one `playSwap` did. Applied fields are already spent on the state. */
export interface TurnOutcome {
  ok: boolean;
  reason?: Refusal;
  /** Mana gained this turn, per cargo (already banked). */
  mana: Partial<Record<Cargo, number>>;
  /** Damage dealt to the opponent this turn (already applied). */
  damage: number;
  /** Did this move earn the mover another turn? */
  extraTurn: boolean;
  /** B3 — was this match Smogged (mana halved)? */
  smogged?: boolean;
  /** The engine's own reading of the pass reports (for tests and callouts). */
  passes: PassReport[];
  /** Set when this move ended the battle. */
  winner: BattleSeat | null;
}

/** B3 — what one `useAbility` did. All fields are already spent on state. */
export interface AbilityOutcome {
  ok: boolean;
  reason?: AbilityRefusal;
  id: string;
  /** Mana paid per cargo (already deducted). */
  spent: Partial<Record<Cargo, number>>;
  /** Dynamite: damage dealt to the opponent. */
  damage: number;
  /** Repair: health restored. */
  heal: number;
  /** Gold Bribe: mana moved per cargo from the opponent. */
  stolen: Partial<Record<Cargo, number>>;
  /**
   * Iron Girders: girders actually placed (the board may hold fewer). B7: a
   * FREE cast reports the girders it ARMED — they drop when the turn passes.
   */
  girders: number;
  /** Frost: gems actually frozen (B7: a free cast — gems armed to freeze). */
  frozen: number;
  /** Smog: half-mana matches now pending on the opponent. */
  smog: number;
  /** Did this cast spend the caster's turn? */
  costsTurn: boolean;
  /** Set when this move ended the battle. */
  winner: BattleSeat | null;
}

/** B3 — a peek at whether the current player can cast `id` right now. */
export type AbilityCheck =
  | { ok: true; def: BattleAbilityDef }
  | {
      ok: false;
      reason: AbilityRefusal;
      def?: BattleAbilityDef;
      /** Mana still missing, per cargo (for the locked/broke hint). */
      need?: Partial<Record<Cargo, number>>;
      /** Cooldown left in the caster's turns. */
      readyIn?: number;
    };

export interface BattleOptions {
  seed: number;
  players: [BattleContender, BattleContender];
  rules: BattleRules;
  /**
   * Keep the board's animation waits (the battle screen wants falling gems).
   * Default false — headless, microtask-only, which is where tests and bot
   * sims live.
   */
  animate?: boolean;
}

export interface Battle {
  readonly seed: number;
  readonly rules: BattleRules;
  readonly state: BattleState;
  /** The shared board — the UI renders it; the engine never mutates past it. */
  readonly board: Board;
  /** The replayable log (seed + this = the whole battle). */
  readonly moves: BattleMove[];
  /** The seat whose turn it is (convenience over `state.turn`). */
  readonly turn: BattleSeat;
  /**
   * One legal swap for the current player. Resolves the full cascade, banks
   * mana, deals damage, passes or keeps the turn, checks the win. A swap that
   * matches nothing is refused ("no-match") and changes nothing — a turn is
   * ONE LEGAL swap.
   */
  playSwap(r1: number, c1: number, r2: number, c2: number, now: number): Promise<TurnOutcome>;
  /**
   * B3 — cast an ability for the CURRENT player. Deterministic (the board
   * effects draw from the battle's own stream) and replayable (logged as a
   * `{ t: "ability" }` move). Costs the turn unless the row says otherwise.
   */
  useAbility(id: string): Promise<AbilityOutcome>;
  /** B3 — why (or why not) `seat` (default: the current player) can cast `id`. */
  canUse(id: string, seat?: BattleSeat): AbilityCheck;
  /** Reshuffle (seeded) if the board has no legal move. Never passes the turn. */
  ensureMove(): Promise<void>;
  /** Exact continuation snapshot (state + board + RNG stream position). */
  save(): unknown;
  /** Restore a snapshot saved at the same rules/seed lineage. */
  restore(d: unknown): void;
}

const emptyMana = (): Record<Cargo, number> =>
  ({ grain: 0, wood: 0, ore: 0, stone: 0, oil: 0, gold: 0 });

const refusal = (reason: Refusal): TurnOutcome => ({
  ok: false, reason, mana: {}, damage: 0, extraTurn: false, passes: [], winner: null,
});

export function createBattle(opts: BattleOptions): Battle {
  const { seed, rules, animate } = opts;
  if (rules.startHealth <= 0) throw new Error("battle rules: startHealth must be positive");
  if (rules.turnLimit <= 0) throw new Error("battle rules: turnLimit must be positive");

  // ── the private randomness stream ────────────────────────────────────────
  // `mulberry32(seed)` warmed to a given draw count reproduces that stream
  // position exactly — the whole save/restore determinism story rests here.
  let rng: () => number = () => 0;
  let draws = 0;
  const seedRng = (warm = 0): void => {
    const base = mulberry32(seed);
    rng = () => {
      draws++;
      return base();
    };
    draws = 0;
    for (let i = 0; i < warm; i++) rng();
  };
  seedRng(0);

  /** Install the battle's stream around a board operation and put the world
   *  back afterwards — the map's RNG must never see battle draws, and the
   *  battle's must never see the map's. */
  const withRng = async <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = getRng();
    setRng(rng);
    try {
      return await fn();
    } finally {
      setRng(prev);
    }
  };

  /** `withRng` for a synchronous body (the turn hand-over is synchronous). */
  const withRngSync = <T>(fn: () => T): T => {
    const prev = getRng();
    setRng(rng);
    try {
      return fn();
    } finally {
      setRng(prev);
    }
  };

  const board = (() => {
    // The Board's constructor fills itself — construct it ON the battle's
    // stream so the opening layout is a function of the seed alone.
    const prev = getRng();
    setRng(rng);
    try {
      const b = new Board();
      // Battles play on the full six-colour board — gold gems drop so the
      // gold mana B3's Gold Bribe needs is earnable like every other colour.
      b.setGoldEnabled(true);
      // No purse exists behind a battle: no token forging, no gold coins,
      // crosses resolve as they form with no pause and no picker.
      b.setPaysScore(true);
      b.waitScale = animate ? 1 : 0;
      return b;
    } finally {
      setRng(prev);
    }
  })();

  // B7 (#252): the seat that moves SECOND opens with `secondSeatHealth`
  // extra health (start AND cap) — the first-move compensation: a damage race
  // otherwise goes to whoever swings first.
  const fullHealth = (seat: BattleSeat): number =>
    rules.startHealth + (seat === 1 ? Math.max(0, Math.floor(rules.secondSeatHealth ?? 0)) : 0);
  const makePlayer = (c: BattleContender, seat: BattleSeat): BattlePlayer => ({
    id: c.id,
    name: c.name,
    health: fullHealth(seat),
    mana: emptyMana(),
    extraTurn: false,
    depots: [...(c.depots ?? [])],
    maxHealth: fullHealth(seat),
  });

  const state: BattleState = {
    players: [makePlayer(opts.players[0], 0), makePlayer(opts.players[1], 1)],
    turn: 0,
    turns: 0,
    winner: null,
    over: false,
    smog: [0, 0],
    cooldowns: [{}, {}],
    obstaclesBy: null,
    chain: 0,
    armed: null,
  };

  const moves: BattleMove[] = [];

  // ── the pass accumulator ─────────────────────────────────────────────────
  // `board.onPass` fills this during one `playSwap`; the outcome is computed
  // from it once the board's promise chain settles.
  let acc: PassReport[] = [];
  board.onPass = (info) => { acc.push(info); };

  /**
   * End one turn: count it, flip it (or grant the extra), tick the NEXT
   * mover's cooldowns (their turn is starting), settle the win checks.
   * Shared by `resolveTurn` (swaps) and `useAbility` (a cast that costs the
   * turn). Returns the winner this ending decided, if any.
   */
  const finishTurn = (mover: BattleSeat, extraTurn: boolean): BattleSeat | null => {
    const me = state.players[mover];
    const opp = state.players[1 - mover as BattleSeat];
    me.extraTurn = extraTurn;
    opp.extraTurn = false;
    // B7: the chain counter follows the seat that keeps the turn.
    state.chain = extraTurn ? (state.chain ?? 0) + 1 : 0;
    if (!extraTurn) state.turn = 1 - mover as BattleSeat;
    state.turns++;
    // Playtest (2026-09): the caster's obstacles lift when their turn returns
    // — on a shared board they must never block the one who cast them.
    if (state.obstaclesBy != null && state.turn === state.obstaclesBy) {
      board.clearObstacles();
      state.obstaclesBy = null;
    }
    // B7 (#252): a free Girders / Frost drops now that the caster's turn has
    // passed — on the opponent's board only, lifted when the turn returns.
    const armed = state.armed;
    if (armed && state.turn !== armed.seat && !state.over) {
      state.armed = null;
      withRngSync(() => board.seedObstacles(armed.frost, armed.girders, armed.frostHard));
      state.obstaclesBy = armed.seat;
    }
    // A turn STARTS for `next`, so its cooldowns tick one — extra turns are
    // turns of yours too (a big cascade brings your girders back sooner).
    const cds = state.cooldowns[state.turn];
    for (const id of Object.keys(cds)) cds[id] = Math.max(0, (cds[id] ?? 0) - 1);
    // win — health first, then the turn-limit race (draw keeps winner null)
    let winner: BattleSeat | null = null;
    if (opp.health <= 0) {
      winner = mover;
      state.over = true;
    } else if (state.turns >= rules.turnLimit) {
      const [a, b] = state.players;
      winner = a.health === b.health ? null : a.health > b.health ? 0 : 1;
      state.over = true;
    }
    state.winner = winner;
    return winner;
  };

  /** Settle one resolved swap into health / mana / turn / win. */
  const resolveTurn = (passes: PassReport[]): TurnOutcome => {
    const mover = state.turn;
    const me = state.players[mover];
    const opp = state.players[1 - mover as BattleSeat];

    // B3 — Smog: this match (cascade included) banks half mana while the
    // seat carries pending smog matches.
    const smogged = state.smog[mover] > 0;
    if (smogged) state.smog[mover]--;

    // mana — every cleared gem banks its cargo to the mover, capped per cargo
    const mana: Partial<Record<Cargo, number>> = {};
    for (const pass of passes) {
      for (const key of Object.keys(pass.cleared) as ResKey[]) {
        const n = pass.cleared[key] ?? 0;
        const cargo = GEM_TO_CARGO[key];
        const raw = n * rules.manaPerGem * (smogged ? 0.5 : 1);
        const gain = Math.min(Math.floor(raw), rules.manaCap - me.mana[cargo]);
        if (gain > 0) {
          me.mana[cargo] += gain;
          mana[cargo] = (mana[cargo] ?? 0) + gain;
        }
      }
    }

    // damage — every gem a bomb's blast purged hits the opponent, and
    // (playtest 2026-09) every MATCHED gem does too, like Puzzle Quest's
    // skulls: health has to move in an ordinary battle, not only on a bomb.
    const purged = passes.reduce((s, p) => s + p.purged, 0);
    let matched = 0;
    // Only true MATCH passes count (a blast pass has `biggest` 0 and its
    // gems are already paid through `purged`).
    for (const pass of passes) {
      if (pass.biggest <= 0) continue;
      for (const n of Object.values(pass.cleared)) matched += n ?? 0;
    }
    const damage = purged * rules.damagePerGem + matched * (rules.matchDamagePerGem ?? 0);
    if (damage > 0) opp.health = Math.max(0, opp.health - damage);

    // extra turn — a 4+ run, a special shape, or a real cascade of 2+ match
    // passes. A bomb's blast is not a match pass (`biggest` 0); its follow-on
    // matches count normally.
    const matchPasses = passes.filter((p) => p.biggest > 0);
    const earned =
      matchPasses.some((p) => p.biggest >= rules.extraTurnMinMatch) ||
      (rules.extraTurnOnShape && matchPasses.some((p) => p.shaped)) ||
      (rules.extraTurnOnCascade > 0 && matchPasses.length >= rules.extraTurnOnCascade);
    // B7 (#252): the chain cap — past `extraTurnChain` extras in a row the
    // move still scores, but the turn passes.
    const cap = rules.extraTurnChain ?? 0;
    const extraTurn = earned && !(cap > 0 && (state.chain ?? 0) >= cap);

    const winner = finishTurn(mover, extraTurn);
    return { ok: true, mana, damage, extraTurn, smogged, passes, winner };
  };

  const ensureMove = async (): Promise<void> => {
    if (state.over) return;
    if (board.hasMove()) return;
    await withRng(() => board.reshuffle());
  };

  const playSwap = async (
    r1: number, c1: number, r2: number, c2: number, now: number,
  ): Promise<TurnOutcome> => {
    if (state.over) return refusal("over");
    if (board.busy) return refusal("busy");
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return refusal("illegal");
    const g1 = board.grid[r1]?.[c1], g2 = board.grid[r2]?.[c2];
    if (!g1 || !g2 || g1.block || g2.block) return refusal("illegal");

    acc = [];
    await withRng(() => board.trySwap(r1, c1, r2, c2, now));
    const passes = acc;

    // The board reports every resolved pass (and every detonation). A dud
    // swap is reverted before any pass runs — zero reports means nothing
    // happened, and a turn is ONE LEGAL swap, so the turn stays put.
    if (passes.length === 0) return refusal("no-match");

    const outcome = resolveTurn(passes);
    moves.push({ t: "swap", r1, c1, r2, c2 });
    if (!state.over) await ensureMove();
    return outcome;
  };

  // ── B3 (#248) — abilities ───────────────────────────────────────────────

  const abilityDef = (id: string): BattleAbilityDef | null =>
    (BATTLE_ABILITIES as Record<string, BattleAbilityDef | undefined>)[id] ?? null;

  const canUse = (id: string, seat: BattleSeat = state.turn): AbilityCheck => {
    const def = abilityDef(id);
    if (!def) return { ok: false, reason: "illegal" };
    if (state.over) return { ok: false, reason: "over", def };
    if (board.busy) return { ok: false, reason: "busy", def };
    const me = state.players[seat];
    const readyIn = state.cooldowns[seat][id] ?? 0;
    if (readyIn > 0) return { ok: false, reason: "cooldown", def, readyIn };
    if (def.requires && !me.depots.includes(def.requires))
      return { ok: false, reason: "owner", def };
    const need: Partial<Record<Cargo, number>> = {};
    let broke = false;
    for (const [k, v] of Object.entries(def.cost) as [Cargo, number][]) {
      const miss = v - (me.mana[k] ?? 0);
      if (miss > 0) { need[k] = miss; broke = true; }
    }
    if (broke) return { ok: false, reason: "mana", def, need };
    return { ok: true, def };
  };

  const aRefusal = (
    reason: AbilityRefusal, id: string, extra: Partial<AbilityOutcome> = {},
  ): AbilityOutcome => ({
    ok: false, reason, id, spent: {}, damage: 0, heal: 0, stolen: {},
    girders: 0, frozen: 0, smog: 0, costsTurn: true, winner: null, ...extra,
  });

  /**
   * Cast for the CURRENT player: pay the bill, apply the row's effect (the
   * board obstacles draw from the battle's own stream — seeded, replayable),
   * arm the cooldown, and — unless the table said `costsTurn: false` — end
   * the turn through the same `finishTurn` a swap uses.
   */
  const useAbility = async (id: string): Promise<AbilityOutcome> => {
    const check = canUse(id);
    if (!check.ok) return aRefusal(check.reason, id);
    const def = check.def;
    const seat = state.turn;
    const me = state.players[seat];
    const opp = state.players[1 - seat as BattleSeat];

    // pay the bill (canUse proved it is all there)
    const spent: Partial<Record<Cargo, number>> = {};
    for (const [k, v] of Object.entries(def.cost) as [Cargo, number][]) {
      me.mana[k] -= v;
      spent[k] = v;
    }

    // effects
    let damage = 0, heal = 0, girders = 0, frozen = 0, smog = 0;
    const stolen: Partial<Record<Cargo, number>> = {};
    const free = def.costsTurn === false;
    const arm = (g: number, f: number, hard: 1 | 2): void => {
      // B7 (#252): a free cast ARMS its obstacles — they drop when this
      // seat's turn passes (see finishTurn), so they never block the caster
      const a = state.armed && state.armed.seat === seat
        ? state.armed : { seat, girders: 0, frost: 0, frostHard: hard };
      a.girders += g;
      a.frost += f;
      a.frostHard = Math.max(a.frostHard, hard) as 1 | 2;
      state.armed = a;
    };
    if (def.id === "girders") {
      if (free) { girders = def.girders ?? 0; arm(girders, 0, 2); }
      else {
        girders = (await withRng(async () => board.seedObstacles(0, def.girders ?? 0))).girders;
        state.obstaclesBy = seat;
      }
    } else if (def.id === "frost") {
      if (free) { frozen = def.frostGems ?? 0; arm(0, frozen, def.frostHard ?? 2); }
      else {
        frozen = (await withRng(async () =>
          board.seedObstacles(def.frostGems ?? 0, 0, def.frostHard ?? 2))).frost;
        state.obstaclesBy = seat;
      }
    } else if (def.id === "smog") {
      const oppSeat = 1 - seat as BattleSeat;
      state.smog[oppSeat] += def.matches ?? 1;
      smog = state.smog[oppSeat];
    } else if (def.id === "dynamite") {
      damage = def.damage ?? 0;
      opp.health = Math.max(0, opp.health - damage);
    } else if (def.id === "repair") {
      heal = Math.max(0, Math.min(def.heal ?? 0, maxHealthOf(me, rules) - me.health));
      me.health += heal;
    } else if (def.id === "bribe") {
      for (const c of CARGOES) {
        const room = rules.manaCap - me.mana[c];
        const n = Math.min(opp.mana[c] ?? 0, def.stealPerCargo ?? 0, room);
        if (n > 0) {
          opp.mana[c] -= n;
          me.mana[c] += n;
          stolen[c] = n;
        }
      }
    }

    // the cooldown arms now — `cooldown` of the caster's turns and it's back
    state.cooldowns[seat][id] = def.cooldown;

    const costsTurn = def.costsTurn !== false;
    const winner = costsTurn ? finishTurn(seat, false) : null;

    moves.push({ t: "ability", id, seat });
    if (!state.over) await ensureMove();
    return { ok: true, id, spent, damage, heal, stolen, girders, frozen, smog, costsTurn, winner };
  };

  return {
    seed,
    rules,
    state,
    board,
    moves,
    get turn() { return state.turn; },
    playSwap,
    useAbility,
    canUse,
    ensureMove,
    save(): unknown {
      return {
        seed,
        rules,
        draws,
        state: {
          players: [
            { ...state.players[0], mana: { ...state.players[0].mana }, depots: [...state.players[0].depots] },
            { ...state.players[1], mana: { ...state.players[1].mana }, depots: [...state.players[1].depots] },
          ],
          turn: state.turn,
          turns: state.turns,
          winner: state.winner,
          over: state.over,
          smog: [...state.smog] as [number, number],
          cooldowns: [{ ...state.cooldowns[0] }, { ...state.cooldowns[1] }],
          obstaclesBy: state.obstaclesBy ?? null,
          chain: state.chain ?? 0,
          armed: state.armed ? { ...state.armed } : null,
        },
        moves: moves.map((m) => ({ ...m })),
        board: board.save(),
      };
    },
    restore(d: unknown): void {
      const s = d as {
        seed?: number; draws?: number;
        state?: Partial<BattleState>;
        moves?: BattleMove[];
        board?: unknown;
      };
      if (s?.seed !== seed) return; // lineage guard: same seed or nothing
      seedRng(s.draws ?? 0);
      moves.length = 0;
      if (Array.isArray(s.moves)) moves.push(...s.moves.map((m) => ({ ...m })));
      if (s.board) board.restore(s.board);
      const st = s.state;
      if (st?.players) {
        for (const i of [0, 1] as const) {
          const src = st.players[i];
          if (!src) continue;
          state.players[i].id = src.id;
          state.players[i].name = src.name;
          state.players[i].health = src.health;
          state.players[i].mana = { ...src.mana };
          state.players[i].extraTurn = src.extraTurn;
          if (Array.isArray(src.depots)) state.players[i].depots = [...src.depots];
          // B7: a pre-B7 snapshot has no maxHealth — keep this engine's own
          if (typeof src.maxHealth === "number") state.players[i].maxHealth = src.maxHealth;
        }
      }
      if (st) {
        state.turn = st.turn ?? 0;
        state.turns = st.turns ?? 0;
        state.winner = st.winner ?? null;
        state.over = st.over ?? false;
        state.smog = [st.smog?.[0] ?? 0, st.smog?.[1] ?? 0];
        state.obstaclesBy = st.obstaclesBy ?? null;
        state.chain = st.chain ?? 0;
        state.armed = st.armed ? { ...st.armed } : null;
        state.cooldowns = [
          { ...(st.cooldowns?.[0] ?? {}) },
          { ...(st.cooldowns?.[1] ?? {}) },
        ];
      }
      acc = [];
    },
  };
}
