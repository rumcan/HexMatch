import { BOARD_W, BOARD_H, ResKey, RES_KEYS, rand, randInt, choice, shuffle } from "./config";

export interface Gem {
  id: number;
  res: ResKey;
  tier: 0 | 1 | 2;
  special: null | "bomb";
  hard: 0 | 1 | 2;
  block: boolean;
  r: number; c: number;
  isNew?: boolean;
  dead?: boolean;
  /**
   * PP-13: this gem's token was FORGED by the player's own long match (4 in a
   * row mints a tier-1 token of that colour, 5+ mints a tier-2 one) instead of
   * being dropped by the network's token spawner (`spawnTokens`).
   *
   * The distinction is what makes the quarry gate correct: a network token
   * only exists because a depot reaches that cargo's industry, so refusing it
   * when the line is cut is right — but a forged token was PAID FOR by the
   * match that created it. Matching a forged wood token next to a wood industry
   * you have no depot on must still hand you the wood; before this flag the
   * gate refused it and the 4-match reward was silently worthless.
   */
  forged?: boolean;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Processing-plant animation waits, in ms (2× the previous playback speed).
 * Shared with the DOM so input never unlocks before gem motion finishes.
 * Resource-choice prompts and simulation clocks are deliberately unaffected.
 */
export const BOARD_ANIMATION_MS = {
  swap: 80,
  clear: 95,
  fall: 105,
  bombClear: 130,
  bombFall: 115,
  shuffle: 110,
} as const;

/**
 * Issue #152 — turbo waits. When the player has already queued their NEXT
 * move (and it is a real match), the board must keep up with the hand: every
 * swap / clear / fall wait collapses to a single frame's worth of time, and
 * the UI paints a fading remnant of each cleared match so the payoff is still
 * seen. The moment the queue drains (or the queued swap turns out to be a
 * dud) timing falls back to `BOARD_ANIMATION_MS`.
 */
export const FAST_ANIMATION_MS = {
  swap: 16,
  clear: 16,
  fall: 16,
  bombClear: 24,
  bombFall: 16,
  shuffle: 110,
} as const;

export type AnimationKey = keyof typeof BOARD_ANIMATION_MS;


// ── A1: the arcade callouts ────────────────────────────────────────────────
/**
 * Every visual the board can ask the UI to draw. `chain` is the ordinary
 * callout (a plain MATCH!, or a MATCH 5 / L-SHAPE); `combo` is the louder
 * cascade tier (COMBO x2, CHAIN x3!!) — same float, hotter styling.
 *
 * PP-14: `cross` is the holy cross — 3 horizontal + 4 vertical overlapping
 * on one gem (the centre of the 3-run), either orientation. The UI answers
 * it with the praying angel and the choir.
 *
 * PP-14b: `bcross` is the broken holy cross — 3 horizontal + 3 vertical
 * forming a small plus, or two matching runs forming a T. It shares the
 * pause-and-pick chooser with the holy cross but pays three units instead of
 * six, and the UI answers it with a dimmer, cracked cross — no angel.
 */
export type FxType = "pop" | "crack" | "up" | "boom" | "bad" | "chain" | "combo" | "cross" | "bcross";

/** Which cross shape a matched pair formed. */
export type CrossKind = "holy" | "broken";

/**
 * L12 (#227) — the kinds of board reward a score-paying board reports.
 *
 * The board says WHAT happened — it made this shape, banked a combo, cracked
 * a frost, broke a girder — and `src/iso/tuning.ts` says what that is worth
 * in session score. The board itself holds no score values: it is agnostic
 * to the economy exactly as before, it just reports the event.
 */
export type RewardKind =
  | "holyCross"      // the big cross shape (3×4)
  | "brokenCross"    // the smaller one (3×3 plus / T)
  | "shape"          // a match-5 or L-shape (the old loop's "+2 random")
  | "combo"          // a banked combo (every COMBOS_PER_GOLD cascades)
  | "frost"          // one step of frost cracked off a gem
  | "girder";        // a girder broken by an adjacent match

/**
 * PP-14b — how many units of blessing each cross shape pays.
 *   holy cross (3×4, six gems)  → 6 picks
 *   broken holy cross (3×3 plus, or a T) → 3 picks
 */
export const HOLY_CROSS_PICKS = 6;
export const BROKEN_CROSS_PICKS = 3;

/**
 * The word a cascade pass shouts, by how deep in the cascade it is.
 *
 * This is the mapping the arcade feedback hung on and never used: cascade
 * step 1 is a plain `MATCH!` — before A1 the board only spoke at step 2, so
 * an ordinary 3-match cleared in total silence even with `onFx` wired.
 * Step 2 is the first real `COMBO x2`, and everything deeper escalates to
 * `CHAIN xN!!`.
 */
export function arcadeLabel(chain: number): string {
  if (chain <= 1) return "MATCH!";
  if (chain === 2) return "COMBO x2";
  return `CHAIN x${chain}!!`;
}

/**
 * PP-09: the five gem colours that always populate and refill the board.
 * Gold is deliberately absent — gold gems only drop once a depot sits beside
 * a gold mine, and the quarry flips them on via `setGoldEnabled`.
 *
 * AUDIT 2026-09-11 — these five ResKeys ARE the five non-gold Cargoes the
 * player can spend, via GEM_TO_CARGO (quarry.ts):
 *   wood→wood  brick→stone  sheep→oil  wheat→grain  ore→ore.
 * Any reward that draws from this pool therefore pays an existing resource.
 * A new colour here must have a GEM_TO_CARGO entry and art in
 * src/assets/gems/<cargo>.png or the audit fails — sheep may not float as
 * 🐑 where the purse has no Sheep.
 */
const BASE_POOL: ResKey[] = ["wood", "brick", "sheep", "wheat", "ore"];

export class Board {
  grid: (Gem | null)[][] = [];
  seq = 1;
  busy = false;
  /** Queued swaps while animations run — fast play enqueues the next move
   *  instead of refusing it. Capped to avoid runaway, drained in order. */
  private moveQueue: { r1: number; c1: number; r2: number; c2: number; now: number }[] = [];
  /** Issue #152 — last turbo state reported to `onTurbo`, so the UI only
   *  hears about transitions. */
  private turboOn = false;
  // Gold is NOT in the base pool at boot — gold gems only drop (join the
  // gravity pool) once a depot sits beside a gold mine. See setGoldEnabled.
  pool: ResKey[] = [...BASE_POOL];
  fogUntil = 0;
  blockUntil = 0;
  // combos banked toward the next gold coin (2 combos = 1 coin)
  comboCount = 0;
  static COMBOS_PER_GOLD = 2;

  /**
   * L12 (#227) — this board pays SCORE, not cargo. The new loop's session
   * board is set to it on boot (`game.ts`), so every settle on it — inside a
   * session or not — runs the score path:
   *
   *   • a cross resolves as it forms — no pause, no resource picker — and
   *     reports as a reward (the chooser would leak cargo past the clock);
   *   • a match-5 / L-shape reports a "shape" reward instead of minting
   *     "+2 random" cargo;
   *   • 4/5-matches forge no tokens (the session board is token-free);
   *   • a banked combo reports "combo" instead of paying a Gold coin;
   *   • a cracked frost step and a broken girder report as rewards.
   *
   * It lives on the board instance, not a global, because the old loop and
   * the rival's plant keep the shipped cargo behaviour on their own boards —
   * the flag flips nothing for them.
   */
  paysScore = false;
  setPaysScore(on: boolean): void { this.paysScore = on; }

  // callbacks (wired by game)
  /**
   * A tokened gem was matched. `forged` is true when the token came from the
   * player's own long match rather than from the network spawner.
   *
   * Return `false` to REFUSE the payout: the board then keeps that amount out
   * of the match's gain popup, so the readout can only ever show what
   * actually reached the purse. Return a NUMBER to say what was actually
   * credited when it differs from `amount` — the quarry pays a depot-fed
   * token at double face value, and a readout that showed the face value
   * would be advertising a different number than the purse received.
   *
   * Any other return — including `undefined`, for a handler that does not
   * care — counts as paid at face value, which keeps every existing
   * fire-and-forget listener working unchanged.
   */
  onHarvest: (res: ResKey, amount: number, forged: boolean) => boolean | number | void = () => true;

  onGold: (n: number) => void = () => {};
  onFx: (type: FxType, r: number, c: number, text?: string) => void = () => {};
  onChange: () => void = () => {};
  /** Issue #152 — the animation pipeline switched into (or out of) turbo.
   *  The UI shortens its gem transitions and leaves match remnants while on. */
  onTurbo: (on: boolean) => void = () => {};
  onPopup: (gains: Partial<Record<ResKey, number>>, label: string) => void = () => {};
  // fired when a combo is banked: (bankedNow, needed, grantedCoin)
  onCombo: (count: number, needed: number, granted: boolean) => void = () => {};
  /** Arcade bonus (match-5 / L / chain) — always pays, not network-gated. */
  onBonus: (res: ResKey, amount: number, reason: string) => void = () => {};
  /**
   * L12 (#227) — a board reward the session scores. Fires INSTEAD of the
   * cargo path when the board pays score (see `paysScore`): the cross shapes
   * (no pause, no picker), a match-5 / L-shape, a banked combo, and the
   * cleared obstacles. The cargo wires (`onBonus`, the forged `onHarvest`,
   * `onGold`) never run while `paysScore` is set, so a score-paying board
   * cannot reach a purse at all — the new loop's acceptance criterion, by
   * construction.
   */
  onReward: (kind: RewardKind) => void = () => {};
  /**
   * L4 (#218) — one resolved pass CLEARED `n` gems, at cascade depth `chain`.
   * This is the board's own measure of how well a board is being played, and
   * the only thing a tuning session scores: the gems a pass took off the
   * board, not the cargo it paid (that is `onHarvest`, and in the new loop it
   * is the clock's business). Fired once per pass, after the removals are
   * applied, so the count is exactly what the grid lost.
   */
  onClear: (n: number, chain: number) => void = () => {};
  /**
   * PP-14: the cross asks the player how to spend its units of blessing — a
   * holy cross pays `HOLY_CROSS_PICKS` and a broken cross `BROKEN_CROSS_PICKS`.
   * Any allocation counts — all of one cargo, splits, one of each, repeats —
   * so the same resource may be picked more than once. When a cross resolves
   * the cascade PAUSES here until the hook calls `pick(chosen)`; the board
   * tops any missing units up with random cargoes, so even an empty list still
   * pays in full. The default answers instantly with random cargoes, so a
   * headless board (the rival's, or a test) never pauses.
   *
   * The hook receives the shape (`kind`) and how many units it owes (`picks`)
   * so the UI can title the chooser and cap the spend without hard-coding the
   * two sizes.
   */
  onCrossChoice: (kind: CrossKind, picks: number, pick: (chosen: ResKey[]) => void) => void =
    (_kind, picks, pick) => pick(Array.from({ length: picks }, () => choice(BASE_POOL)));

  /**
   * What a harvest actually credited, from `onHarvest`'s answer — 0 when the
   * listener refused it. The board never guesses the amount: the quarry knows
   * what it put in the purse, and the readout has to show that number.
   */
  private credited(res: ResKey, amount: number, forged: boolean): number {
    const r = this.onHarvest(res, amount, forged);
    if (r === false) return 0;
    return typeof r === "number" ? r : amount;
  }

  constructor() {
    this.initFill();
  }

  /**
   * MOBILE-02: the live grid size, READ FROM the grid itself — the shipped
   * `BOARD_W × BOARD_H` is only the fallback for a not-yet-filled board.
   * A phone asks the game to widen/lengthen the plant so the board fills the
   * window at a comfortable cell size (ui.ts proposes the size, game.ts owns
   * the decision); desktop boards, rival plants and headless tests keep the
   * shipped 7×8 because nobody ever proposes otherwise. Deriving rather than
   * storing means a `restore()` — which replaces the array wholesale (a save
   * made on another viewport, a peer's board arriving on the wire) — can
   * never leave the size lying about what the grid actually holds.
   */
  get w(): number { return this.grid[0]?.length ?? BOARD_W; }
  get h(): number { return this.grid.length || BOARD_H; }

  /**
   * MOBILE-02: resize the board in place. Gems inside the new rectangle keep
   * their identity, tokens, frost and girders where they stand; cells the
   * board grows into are filled with fresh gems that drop in (`isNew`); cells
   * it shrinks out of are simply gone. Returns whether anything moved, so a
   * resize-driven `onChange` never fires on a no-op.
   */
  setSize(w: number, h: number): boolean {
    const W2 = Math.max(3, Math.min(24, Math.floor(w)));
    const H2 = Math.max(3, Math.min(24, Math.floor(h)));
    if (this.w === W2 && this.h === H2) return false;
    const old = this.grid;
    const next: (Gem | null)[][] = [];
    for (let r = 0; r < H2; r++) {
      const row: (Gem | null)[] = [];
      for (let c = 0; c < W2; c++) {
        const g = old[r]?.[c] ?? null;
        if (g) { g.r = r; g.c = c; row.push(g); }
        else row.push(this.newGem(this.randRes(), r, c, true));
      }
      next.push(row);
    }
    this.grid = next;
    this.onChange();
    return true;
  }

  private newGem(res: ResKey, r: number, c: number, isNew = false): Gem {
    return { id: this.seq++, res, tier: 0, special: null, hard: 0, block: false, r, c, isNew };
  }

  /**
   * L4 (#218) — the tuning session's OWN colour. While a session runs, the
   * board is "scoped to that depot's cargo": roughly `biasWeight` of every
   * refill is this colour, the rest is drawn uniformly from the pool. It is a
   * deliberate nudge rather than a single-colour board — the session still
   * asks you to read the whole grid, and no existing save or seed changes,
   * because with no session (`biasRes === null`) `randRes` is untouched and
   * consumes no randomness for the choice at all.
   *
   * Gold is guarded by `pool.includes`: a gold depot only drops gold once its
   * own gold-mine gate is open (PP-09), so a bias can never mint a colour the
   * board would not otherwise spawn.
   */
  biasRes: ResKey | null = null;
  biasWeight = 0;
  setBias(res: ResKey | null, weight = 0): void {
    this.biasRes = res;
    this.biasWeight = weight;
  }

  private randRes(): ResKey {
    const pool = this.pool.length ? this.pool : RES_KEYS.slice(0, 4);
    if (this.biasRes && this.biasWeight > 0 && pool.includes(this.biasRes) && rand() < this.biasWeight) {
      return this.biasRes;
    }
    return choice(pool);
  }

  /**
   * PP-09: add or remove gold from the gravity pool. Gold gems must "drop
   * like the other resource types" — appearing in the normal refill path
   * (`randRes` → `initFill` / `gravity`) — but only while a depot sits beside
   * a gold mine. The quarry recomputes this on every refresh (build /
   * demolish), so building the depot turns gold drops on and demolishing it
   * turns them off. Gold gems never overwrite an existing gem in place: the
   * only way a gold gem reaches the board is by falling in from the top. A
   * plain gold gem pays nothing, a tokened one pays gold.
   */
  setGoldEnabled(enabled: boolean) {
    const has = this.pool.includes("gold");
    if (enabled === has) return;
    this.pool = enabled ? [...this.pool, "gold"] : this.pool.filter((r) => r !== "gold");
  }

  initFill() {
    // MOBILE-02: the dims are captured BEFORE the grid is emptied — they are
    // read off the live grid (so a ♻ reset re-rolls whatever rectangle the
    // board currently wears, grown phone included), and a half-built array
    // would read back as nothing.
    const W = this.grid[0]?.length ?? BOARD_W;
    const H = this.grid.length || BOARD_H;
    this.grid = [];
    for (let r = 0; r < H; r++) {
      this.grid[r] = [];
      for (let c = 0; c < W; c++) {
        let res = this.randRes();
        for (let tries = 0; tries < 25; tries++) {
          const bad =
            (c >= 2 && this.grid[r][c - 1]?.res === res && this.grid[r][c - 2]?.res === res) ||
            (r >= 2 && this.grid[r - 1][c]?.res === res && this.grid[r - 2][c]?.res === res);
          if (!bad) break;
          res = this.randRes();
        }
        this.grid[r][c] = this.newGem(res, r, c);
      }
    }
  }

  gems(): Gem[] {
    const out: Gem[] = [];
    for (let r = 0; r < this.h; r++) for (let c = 0; c < this.w; c++) { const g = this.grid[r][c]; if (g) out.push(g); }
    return out;
  }

  private matchable(g: Gem | null): g is Gem {
    return !!g && !g.block && g.special !== "bomb";
  }

  // scan one line (row or col) for runs of >=3 of one colour.
  // N3: gold is NOT wild any more — it is its own colour and matches only
  // itself, so this scan needs no wild branching at all.
  private lineRuns(cells: (Gem | null)[]): Gem[][] {
    const runs: Gem[][] = [];
    const n = cells.length;
    let i = 0;
    while (i < n) {
      const g = cells[i];
      if (!this.matchable(g)) { i++; continue; }
      const color: ResKey = g!.res;
      const run: Gem[] = [g!];
      let j = i + 1;
      while (j < n) {
        const h = cells[j];
        if (!this.matchable(h) || h!.res !== color) break;
        run.push(h!);
        j++;
      }
      const matched = run.length >= 3;
      if (matched) runs.push(run);
      i = matched ? j : i + 1;
    }
    return runs;
  }

  findGroups(): Gem[][] {
    const groups: Gem[][] = [];
    for (let r = 0; r < this.h; r++) groups.push(...this.lineRuns(this.grid[r]));
    for (let c = 0; c < this.w; c++) {
      const col: (Gem | null)[] = [];
      for (let r = 0; r < this.h; r++) col.push(this.grid[r][c]);
      groups.push(...this.lineRuns(col));
    }
    return groups;
  }

  /** Two orthogonal runs of 3+ that share one corner gem = a 5-gem L. */
  private lShapes(groups: Gem[][]): Gem[][] {
    const out: Gem[][] = [];
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i], b = groups[j];
        if (a[0].res !== b[0].res) continue;
        // PP-14: a cross (holy 3×4, or broken 3×3, crossing on the centre of
        // the 3-run) is its own shape with its own reward — let `crosses()`
        // claim it.
        if (this.crossPair(a, b)) continue;
        const ids = new Set(a.map((g) => g.id));
        const shared = b.filter((g) => ids.has(g.id));
        if (shared.length !== 1) continue;
        const union = [...a];
        for (const g of b) if (!ids.has(g.id)) union.push(g);
        if (union.length < 5) continue;
        const sameRow = a.every((g) => g.r === a[0].r);
        const otherCol = b.every((g) => g.c === b[0].c);
        const sameCol = a.every((g) => g.c === a[0].c);
        const otherRow = b.every((g) => g.r === b[0].r);
        if ((sameRow && otherCol) || (sameCol && otherRow)) out.push(union);
      }
    }
    return out;
  }

  /**
   * PP-14: is the pair (a, b) a cross — and which kind?
   *
   *   holy    — one 3-run and one 4-run of the same colour, one horizontal
   *             and one vertical, overlapping on exactly one gem: the centre
   *             of the 3-run and an interior (non-end) gem of the 4-run, so
   *             the shape reads as a cross rather than a T with a long tail.
   *             Either orientation counts (3 across + 4 down, or the other
   *             way). Pays six units.
   *   broken  — a 3×3 plus, or a T (the end of one run meets an interior
   *             gem of the other). Pays three units. Corner-to-corner Ls
   *             keep their existing L-SHAPE reward.
   *
   * Returns the shape and its crossing gem, else null.
   */
  private crossPair(a: Gem[], b: Gem[]): { kind: CrossKind; mid: Gem } | null {
    if (a[0].res !== b[0].res) return null;
    const la = a.length, lb = b.length;
    const aRow = a.every((g) => g.r === a[0].r);
    const bRow = b.every((g) => g.r === b[0].r);
    if (aRow === bRow) return null;
    const ids = new Set(a.map((g) => g.id));
    const shared = b.filter((g) => ids.has(g.id));
    if (shared.length !== 1) return null;
    const s = shared[0];

    // A T in any rotation is a broken cross, including a longer stem/bar.
    const aEnd = s.id === a[0].id || s.id === a[la - 1].id;
    const bEnd = s.id === b[0].id || s.id === b[lb - 1].id;
    if (aEnd !== bEnd) return { kind: "broken", mid: s };

    // Broken plus: 3×3, the overlap is the centre of both runs.
    if (la === 3 && lb === 3) {
      if (s.id !== a[1].id || s.id !== b[1].id) return null;
      return { kind: "broken", mid: s };
    }
    // Holy cross: 3×4 — the overlap is the centre of the 3-run …
    if (!((la === 3 && lb === 4) || (la === 4 && lb === 3))) return null;
    const three = la === 3 ? a : b;
    const four = la === 3 ? b : a;
    if (s.id !== three[1].id) return null;
    // … and sits INSIDE the 4-run, not on its end.
    const idx = four.findIndex((g) => g.id === s.id);
    if (idx <= 0 || idx >= four.length - 1) return null;
    return { kind: "holy", mid: s };
  }

  /**
   * PP-14: the holy and broken crosses — two orthogonal same-colour runs
   * overlapping as a plus or T. `mid` is the shared crossing
   * gem, so the callout — and the angel — land exactly on the overlap.
   */
  private crosses(groups: Gem[][]): { gems: Gem[]; mid: Gem; kind: CrossKind }[] {
    const out: { gems: Gem[]; mid: Gem; kind: CrossKind }[] = [];
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i], b = groups[j];
        const x = this.crossPair(a, b);
        if (!x) continue;
        const union = [...a];
        for (const g of b) if (g.id !== x.mid.id) union.push(g);
        out.push({ gems: union, mid: x.mid, kind: x.kind });
      }
    }
    return out;
  }

  /**
   * AUDIT 2026-09-11 — rewards from chains and combos must pay existing
   * Cargo. This helper draws from BASE_POOL (which maps 1-1 to the live
   * Cargo set via GEM_TO_CARGO: brick→stone, sheep→oil, wheat→grain, …)
   * so a MATCH 5 / L-SHAPE's “+2 random” never drops a dead 🐑 where the
   * purse has no Sheep. The Quarry's onHarvest maps the ResKey to Cargo
   * before it hits the purse, and ui.ts's popup maps it again for the
   * floating icon — both steps keep the 2× chain bonus on an existing
   * resource.
   */
  private grantRandom(n: number, reason: string, gains: Partial<Record<ResKey, number>>) {
    for (let i = 0; i < n; i++) {
      const res = choice(BASE_POOL);
      gains[res] = (gains[res] ?? 0) + 1;
      this.onBonus(res, 1, reason);
      // forged=true → the Quarry gate always pays it (it's the board's
      // own reward, not a depot token), and earns it as Cargo via
      // GEM_TO_CARGO, so the +2 is always stone/oil/grain/wood/ore.
      this.onHarvest(res, 1, true);
    }
  }

  /**
   * Clear one cascade pass. `chain` is this pass's 1-based depth, so the
   * callout can name it (`MATCH!` / `COMBO x2` / `CHAIN x3!!`).
   *
   * Returns the crosses this pass resolved (PP-14: `settle` pays each cross's
   * chosen units AFTER the player picks — see `chooseCrossReward`).
   */
  private resolve(
    groups: Gem[][], gains: Partial<Record<ResKey, number>>, chain = 1,
  ): { gems: Gem[]; mid: Gem; kind: CrossKind }[] {
    const removeIds = new Set<number>();
    const crackIds = new Set<number>();
    const forge: { r: number; c: number; res: ResKey; tier: 1 | 2 }[] = [];
    const bombs: { r: number; c: number; res: ResKey }[] = [];

    for (const grp of groups) {
      const size = grp.length;
      // runs are single-colour (no wilds since N3) — the anchor is the colour
      const anchor = grp[0].res;
      const tokenPresent = grp.some((g) => g.tier > 0);
      const mult = size >= 4 ? 2 : 1;
      // pay each token by its OWN resource (a matched gold token pays gold)
      for (const g of grp) {
        if (g.hard > 0) { crackIds.add(g.id); continue; }
        removeIds.add(g.id);
        if (g.tier > 0) {
          const amt = g.tier * mult;
          // PP-13: the listener decides whether this token pays (the quarry
          // gate refuses a NETWORK token whose line is cut, but always pays a
          // FORGED one). A1: it also decides HOW MUCH it paid — `gains`
          // accumulates exactly what reached the purse, so the floating
          // "+2 🪵" can never advertise a number the purse did not receive.
          const paid = this.credited(g.res, amt, g.forged === true);
          if (paid > 0) gains[g.res] = (gains[g.res] ?? 0) + paid;
        }
      }
      const mid = grp[Math.floor(size / 2)];
      // A long match MINTS a token of its own colour: 4 in a row leaves a
      // tier-1 token behind, 5+ leaves a tier-2 one plus a bomb. These are the
      // board's own reward, and they carry `forged` (see the forge loop below)
      // so the quarry pays them even where no depot reaches that cargo.
      // L12 (#227) — a score-paying board forges no tokens (there is no purse
      // to pay them into), but a 5-match still mints its bomb: the blast is
      // the session's biggest single shape.
      if (size === 4 && !tokenPresent && !this.paysScore) forge.push({ r: mid.r, c: mid.c, res: anchor, tier: 1 });
      if (size >= 5) {
        bombs.push({ r: mid.r, c: mid.c, res: anchor });
        if (!tokenPresent && !this.paysScore) forge.push({ r: grp[0].r, c: grp[0].c, res: anchor, tier: 2 });
      }
    }

    // apply
    const removedCells: { r: number; c: number }[] = [];
    for (let r = 0; r < this.h; r++) for (let c = 0; c < this.w; c++) {
      const g = this.grid[r][c];
      if (!g) continue;
      if (removeIds.has(g.id)) { g.dead = true; this.onFx("pop", r, c); this.grid[r][c] = null; removedCells.push({ r, c }); }
      else if (crackIds.has(g.id)) {
        g.hard = (g.hard - 1) as 0 | 1 | 2;
        this.onFx("crack", r, c);
        // L12 (#227) — clearing the frost step out of a frozen gem IS the
        // play on a score-paying board, and it pays for it.
        if (this.paysScore) this.onReward("frost");
      }
    }
    // a match adjacent to an iron block breaks it back into a normal gem
    for (const { r, c } of removedCells) {
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= this.h || nc < 0 || nc >= this.w) continue;
        const b = this.grid[nr][nc];
        if (b && b.block) {
          b.block = false;
          this.onFx("crack", nr, nc);
          // L12 (#227) — a girder broken by this match's removals is a shape
          // the session scores.
          if (this.paysScore) this.onReward("girder");
        }
      }
    }
    for (const f of forge) {
      const g = this.newGem(f.res, f.r, f.c);
      g.tier = f.tier;
      // PP-13: this token was minted by the match itself, so it pays even
      // where the network reaches nothing — mark it for the quarry gate.
      g.forged = true;
      this.grid[f.r][f.c] = g;
      this.onFx("up", f.r, f.c);
    }
    for (const b of bombs) {
      const g = this.newGem(b.res, b.r, b.c);
      g.special = "bomb";
      this.grid[b.r][b.c] = g;
      this.onFx("boom", b.r, b.c);
    }

    // Arcade: match-5 in a line, or a 5-gem L, grants two random materials.
    // PP-14: a cross is NOT granted here — the blessing waits for the
    // player's choice, so `settle` pays the chosen units once the pick lands.
    const fives = groups.filter((g) => g.length >= 5);
    const crosses = this.crosses(groups);
    const ells = this.lShapes(groups);
    const hasHoly = crosses.some((x) => x.kind === "holy");
    const why = fives.length
      ? "MATCH 5"
      : hasHoly
        ? "HOLY CROSS"
        : crosses.length
          ? "BROKEN CROSS"
          : ells.length
            ? "L-SHAPE"
            : null;
    if (why && why !== "HOLY CROSS" && why !== "BROKEN CROSS") {
      if (this.paysScore) {
        // L12 (#227) — the big shape's "+2 random cargo" becomes a flat score
        // reward: the match-5 / L-shape is one of the "big shapes" the issue
        // calls out, and nothing of it may touch a purse.
        this.onReward("shape");
      } else {
        this.grantRandom(2, why, gains);
      }
    }
    // PP-14: the praying angel — one fx per cross, at the centre gem where
    // the two arms overlap. A holy cross fires `cross` (the angel + choir);
    // a broken cross fires `bcross` (a cracked cross, no angel).
    for (const x of crosses) this.onFx(x.kind === "broken" ? "bcross" : "cross", x.mid.r, x.mid.c);

    // ── A1: the callout, fired HERE — the instant the pass resolves ──
    // Two bugs died here. (1) The old text only fired for `chain >= 2`, so a
    // plain 3-match cleared in silence. (2) It fired AFTER `gravity` and its
    // 400ms of sleeps, so `CHAIN x2` appeared ~400ms after the match it was
    // describing had already been swept off the board. One callout per pass,
    // now, at the centre of the group the player just matched — the biggest
    // one, or the special shape when there is one.
    const biggest = groups.reduce((a, g) => (g.length > a.length ? g : a), groups[0]);
    // a cross calls out from its crossing gem (a match-5 still shouts first)
    const cross = fives.length ? undefined : crosses[0];
    const target = fives[0] ?? cross?.gems ?? ells[0] ?? biggest;
    const mid = cross ? cross.mid : target[Math.floor(target.length / 2)];
    const label = arcadeLabel(chain);
    // A special shape keeps its own name (it is strictly more informative
    // than "MATCH!"), but a deep cascade still gets its chain count.
    const text = why ? (chain > 1 ? `${why} · ${label}` : why) : label;
    this.onFx(chain > 1 ? "combo" : "chain", mid.r, mid.c, text);
    if (removedCells.length) this.onClear(removedCells.length, chain);
    return crosses;
  }

  /**
   * Wait for explicit confirmation, with no timeout or random auto-pick.
   * Headless boards already have an immediate default onCrossChoice handler.
   * Promise resolution is one-shot even if a handler accidentally answers twice.
   */
  private chooseCrossReward(kind: CrossKind, picks: number): Promise<ResKey[]> {
    return new Promise((resolve) => {
      this.onCrossChoice(kind, picks, resolve);
    });
  }

  private gravity() {
    for (let c = 0; c < this.w; c++) {
      const stack: Gem[] = [];
      for (let r = this.h - 1; r >= 0; r--) { const g = this.grid[r][c]; if (g) stack.push(g); this.grid[r][c] = null; }
      let r = this.h - 1;
      for (const g of stack) { g.r = r; g.c = c; this.grid[r][c] = g; r--; }
      for (; r >= 0; r--) {
        const g = this.newGem(this.randRes(), r, c, true);
        this.grid[r][c] = g;
      }
    }
  }

  /** How many moves the player has queued behind the running animation. */
  get queuedMoves(): number { return this.moveQueue.length; }

  /**
   * Issue #152 — is the board in catch-up mode? True while a move is queued
   * and that move, dry-run against the grid as it stands, would make a match.
   * Mid-cascade (a queued cell is empty, waiting on gravity) we cannot judge
   * yet, so the player is given the benefit of the doubt: the queue only
   * exists because they are ahead of the board. A queued swap that is plainly
   * a dud (both gems present, no match) does NOT accelerate — its revert
   * plays at normal speed so the refusal reads.
   */
  get turbo(): boolean {
    const nxt = this.moveQueue[0];
    if (!nxt) return false;
    const g1 = this.grid[nxt.r1]?.[nxt.c1], g2 = this.grid[nxt.r2]?.[nxt.c2];
    if (!g1 || !g2) return true;
    if (g1.block || g2.block) return false;
    if (g1.special === "bomb" || g2.special === "bomb") return true;
    return this.wouldMatch(nxt.r1, nxt.c1, nxt.r2, nxt.c2);
  }

  /** Dry-run a swap: would it leave any group on the board? Grid untouched. */
  private wouldMatch(r1: number, c1: number, r2: number, c2: number): boolean {
    const g1 = this.grid[r1][c1], g2 = this.grid[r2][c2];
    if (!g1 || !g2) return false;
    this.grid[r1][c1] = g2; this.grid[r2][c2] = g1;
    const hit = this.findGroups().length > 0;
    this.grid[r1][c1] = g1; this.grid[r2][c2] = g2;
    return hit;
  }

  /** Re-read `turbo` and tell the UI if it changed. */
  private syncTurbo(): boolean {
    const on = this.turbo;
    if (on !== this.turboOn) { this.turboOn = on; this.onTurbo(on); }
    return on;
  }

  /** Every animation pause goes through here so turbo can shorten it. */
  private async wait(key: AnimationKey): Promise<void> {
    const on = this.syncTurbo();
    await sleep(on ? FAST_ANIMATION_MS[key] : BOARD_ANIMATION_MS[key]);
  }

  /** Called when the board goes idle: turbo is over whatever the queue says. */
  private endTurbo() {
    if (this.turboOn) { this.turboOn = false; this.onTurbo(false); }
  }

  async settle(startCascade = 0) {
    this.busy = true;
    let chain = startCascade;
    const gains: Partial<Record<ResKey, number>> = {};
    let maxChain = startCascade;
    while (true) {
      const groups = this.findGroups();
      if (!groups.length) break;
      chain++; maxChain = Math.max(maxChain, chain);
      const crosses = this.resolve(groups, gains, chain);
      if (crosses.length > 0) {
        // PP-14: the blessing waits for the player — the cascade pauses
        // right after the angel pops, and resumes the moment the chooser
        // answers. Each cross is paid EXACTLY as allocated: all of one cargo,
        // a split, one of each, any mix — the same resource may be picked
        // more than once. Units the chooser left unspent are filled at
        // random, and every unit is paid as forged (never gated by the
        // network) like the other arcade bonuses.
        for (const x of crosses) {
          if (this.paysScore) {
            // L12 (#227) — the cross pays SCORE the instant it forms: no
            // pause, no resource picker. The chooser was the one cargo path
            // that sat on the clock, so it simply does not run on a
            // score-paying board, and a holy cross outscores a broken one.
            this.onReward(x.kind === "holy" ? "holyCross" : "brokenCross");
            continue;
          }
          const picks = x.kind === "broken" ? BROKEN_CROSS_PICKS : HOLY_CROSS_PICKS;
          const reason = x.kind === "broken" ? "BROKEN CROSS" : "HOLY CROSS";
          const chosen = await this.chooseCrossReward(x.kind, picks);
          const list = chosen.slice(0, picks);
          while (list.length < picks) list.push(choice(BASE_POOL));
          for (const res of list) {
            gains[res] = (gains[res] ?? 0) + 1;
            this.onBonus(res, 1, reason);
            this.onHarvest(res, 1, true);
          }
        }
      }
      this.onChange();
      await this.wait("clear");
      this.gravity();
      this.onChange();
      await this.wait("fall");
    }
    const label = maxChain > 1 ? `COMBO x${maxChain}` : "";
    if (this.paysScore) {
      // L12 (#227) — the readout carries the pass's SCORE instead of cargo
      // gains, so it fires on the cascade alone: every pass on a score-paying
      // board is feedback. The combo banks BEFORE the popup so its points
      // ride the same float as the gems it came from. (The old loop keeps its
      // exact order: gains-or-label popup first, coin second.)
      if (maxChain >= 2) this.registerCombo();
      this.onPopup({}, label);
    } else {
      // A1: the readout fires on the LABEL as well as the gains. A tokenless
      // cascade accumulates an empty `gains`, and gating the popup on that hid
      // the only feedback such a match had — a two-deep combo of plain gems
      // cleared, rang up a combo, and told the player nothing at all.
      if (Object.keys(gains).length || label) this.onPopup(gains, label);
      // a cascade of two or more counts as a combo; every second one pays a coin
      if (maxChain >= 2) this.registerCombo();
    }
    if (!this.hasMove()) await this.reshuffle();
    this.busy = false;
  }

  /** Internal swap — assumes not busy and not fogged on entry, validates
   *  adjacency / block again, manages busy flag for its whole lifetime. */
  private async _doSwap(r1: number, c1: number, r2: number, c2: number, now: number): Promise<boolean> {
    if (this.fogUntil > now) return false;
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return false;
    const g1 = this.grid[r1]?.[c1], g2 = this.grid[r2]?.[c2];
    if (!g1 || !g2 || g1.block || g2.block) return false;
    this.busy = true;

    // swap positions
    this.grid[r1][c1] = g2; this.grid[r2][c2] = g1;
    g1.r = r2; g1.c = c2; g2.r = r1; g2.c = c1;
    this.onChange();

    if (g1.special === "bomb" || g2.special === "bomb") {
      await this.wait("swap");
      const bomb = g1.special === "bomb" ? g1 : g2;
      const other = g1.special === "bomb" ? g2 : g1;
      await this.detonate(bomb, other.res);
      return true;
    }
    await this.wait("swap");
    const groups = this.findGroups();
    if (!groups.length) {
      // revert
      this.grid[r1][c1] = g1; this.grid[r2][c2] = g2;
      g1.r = r1; g1.c = c1; g2.r = r2; g2.c = c2;
      this.onFx("bad", r1, c1);
      this.onChange();
      await this.wait("swap");
      this.busy = false;
      return true;
    }
    await this.settle(0);
    return true;
  }

  async trySwap(r1: number, c1: number, r2: number, c2: number, now: number) {
    if (this.fogUntil > now) return;
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return;
    const g1 = this.grid[r1]?.[c1], g2 = this.grid[r2]?.[c2];
    if (!g1 || !g2 || g1.block || g2.block) return;
    if (this.busy) {
      if (this.moveQueue.length < 8) this.moveQueue.push({ r1, c1, r2, c2, now });
      // Issue #152: the UI hears about turbo the instant the player gets
      // ahead, so the match already clearing leaves its remnant too — not
      // only the ones after the next wait.
      this.syncTurbo();
      return;
    }
    await this._doSwap(r1, c1, r2, c2, now);
    while (this.moveQueue.length > 0) {
      if (this.busy) break;
      const nxt = this.moveQueue.shift()!;
      if (this.fogUntil > performance.now()) {
        this.moveQueue.unshift(nxt);
        break;
      }
      await this._doSwap(nxt.r1, nxt.c1, nxt.r2, nxt.c2, nxt.now);
    }
    // Issue #152: the queue is drained (or parked behind fog) — back to
    // standard speed for whatever the player does next.
    this.endTurbo();
  }

  async detonate(bomb: Gem, colorRes: ResKey) {
    this.busy = true;
    const gains: Partial<Record<ResKey, number>> = {};
    let purged = 0;
    bomb.dead = true; this.grid[bomb.r][bomb.c] = null; this.onFx("boom", bomb.r, bomb.c);
    for (let r = 0; r < this.h; r++) for (let c = 0; c < this.w; c++) {
      const g = this.grid[r][c];
      if (!g || g.block || g.res !== colorRes) continue;
      if (g.hard > 0) {
        g.hard = (g.hard - 1) as 0 | 1 | 2;
        this.onFx("crack", r, c);
        if (this.paysScore) this.onReward("frost");
        continue;
      }
      if (g.tier > 0) {
        const paid = this.credited(g.res, g.tier, g.forged === true);
        if (paid > 0) gains[g.res] = (gains[g.res] ?? 0) + paid;
      }
      g.dead = true; this.grid[r][c] = null; this.onFx("pop", r, c); purged++;
    }
    if (this.paysScore) {
      // L12 (#227) — a blast is the session's biggest single shape: the gems
      // it sweeps score (depth 2 — the burst is the second step of the
      // cascade `settle(2)` carries on with), and the readout shows them
      // instead of a cargo line.
      this.onClear(purged, 2);
      this.onPopup({}, "COLOUR PURGE");
    } else if (Object.keys(gains).length) {
      this.onPopup(gains, "COLOUR PURGE");
    }
    this.onChange();
    await this.wait("bombClear");
    this.gravity();
    this.onChange();
    await this.wait("bombFall");
    await this.settle(2);
  }

  // 20s token spawn: pool = { res: accessTier }. Every reachable colour,
  // INCLUDING gold, upgrades an existing gem of that colour in place. Gold is
  // never minted by converting a different-colour gem — gold gems reach the
  // board only by dropping in from the top via the gravity pool (see
  // setGoldEnabled). A tokened gold gem pays gold when matched; a plain one
  // pays nothing.
  spawnTokens(pool: Partial<Record<ResKey, number>>): number {
    // L12 (#227) — a score-paying board is token-free: with nothing to spend
    // tokens on in the new loop, lorry deliveries mint nothing here.
    if (this.paysScore) return 0;
    let minted = 0;
    for (const res of Object.keys(pool) as ResKey[]) {
      const tier = pool[res] as 1 | 2;
      const eligible: Gem[] = [];
      for (let r = 0; r < this.h; r++) for (let c = 0; c < this.w; c++) {
        const g = this.grid[r][c];
        if (g && g.res === res && g.tier === 0 && !g.special && !g.block && g.hard === 0) eligible.push(g);
      }
      if (eligible.length) {
        const g = choice(eligible);
        g.tier = tier;
        // PP-13: this token came from the network, so it is network-gated —
        // clear any stale forge mark (a forged token can reach tier 0 again
        // if it was ever stripped) so the two kinds never get confused.
        g.forged = false;
        this.onFx("up", g.r, g.c);
        minted++;
      }
    }
    this.onChange();
    // A1: the caller (the lorry delivery) needs to know whether a token
    // actually landed — a board with every gem of that colour already
    // tokened mints nothing, and the "+N" at the factory must not promise a
    // gem the board never got.
    return minted;
  }

  /**
   * Bank a combo. Every COMBOS_PER_GOLD combos pays one gold into the purse.
   *
   * W5: the coin reaches the player's PURSE directly via `onGold(1)` — that
   * is what makes "2 combos = 1 gold" actually pay out (and what makes the
   * Black Market affordable).
   */
  registerCombo() {
    this.comboCount++;
    const need = Board.COMBOS_PER_GOLD;
    if (this.comboCount >= need) {
      this.comboCount -= need;
      if (this.paysScore) {
        // L12 (#227) — the combo pays SCORE instead of a gold coin: in the new
        // loop the coin never had anywhere to land.
        this.onReward("combo");
      } else {
        this.onGold(1);
      }
      this.onCombo(this.comboCount, need, true);
      this.onChange();
    } else {
      this.onCombo(this.comboCount, need, false);
    }
  }

  harden(n = 7) {
    const eligible = this.gems().filter((g) => !g.block && !g.special);
    for (const g of shuffle(eligible).slice(0, n)) { g.hard = 2; this.onFx("crack", g.r, g.c); }
    this.onChange();
  }

  dropBlocks(n = 4, ms = 30000, now = performance.now()) {
    const cols = shuffle(Array.from({ length: this.w }, (_, i) => i)).slice(0, n);
    for (const c of cols) {
      const r = 2 + randInt(this.h - 3);
      const g = this.newGem(this.randRes(), r, c);
      g.block = true;
      this.grid[r][c] = g;
      this.onFx("boom", r, c);
    }
    this.blockUntil = now + ms;
    this.onChange();
  }

  fog(ms = 30000, now = performance.now()) { this.fogUntil = now + ms; }

  /**
   * MP-05: the sabotage overlay the wire ships — where the frost and girders
   * sit plus the smog clock — WITHOUT the whole sim. A guest's plant board is
   * a spectator view (its gem layout is never synced), but sabotage the host
   * bought against it still has to show up, so only the sabotage state travels.
   */
  sabotageState(now = performance.now()) {
    const frozen: { r: number; c: number; hard: number }[] = [];
    const girders: { r: number; c: number }[] = [];
    for (const g of this.gems()) {
      if (g.block) girders.push({ r: g.r, c: g.c });
      else if (g.hard > 0) frozen.push({ r: g.r, c: g.c, hard: g.hard });
    }
    return { frozen, girders, smogIn: Math.max(0, this.fogUntil - now) };
  }

  /**
   * MP-05: apply a sabotage overlay received from the host onto this board (a
   * guest's plant panel). Idempotent — clears whatever was there first, then
   * stamps the received frost/girders and smog clock. Touches ONLY sabotage
   * state: no matches, no gravity, no purse, no tokens.
   */
  applySabotage(state: {
    frozen?: { r: number; c: number; hard?: number }[];
    girders?: { r: number; c: number }[];
    smogIn?: number;
  }): void {
    const now = performance.now();
    let changed = false;
    for (const g of this.gems()) {
      if (g.hard > 0) { g.hard = 0; changed = true; }
      if (g.block) { g.block = false; changed = true; }
    }
    for (const f of state.frozen ?? []) {
      const g = this.grid[f.r]?.[f.c];
      if (!g) continue;
      if (g.block) { g.block = false; changed = true; }
      const hard = Math.max(1, Math.min(2, Math.floor(f.hard ?? 2))) as 0 | 1 | 2;
      if (g.hard !== hard) { g.hard = hard; changed = true; }
    }
    for (const b of state.girders ?? []) {
      const g = this.grid[b.r]?.[b.c];
      if (!g) continue;
      if (g.hard > 0) { g.hard = 0; changed = true; }
      if (!g.block) { g.block = true; changed = true; }
    }
    const smogIn = Math.max(0, Number.isFinite(state.smogIn) ? (state.smogIn as number) : 0);
    this.fogUntil = now + smogIn;
    if (changed) this.onChange();
  }

  // Repair crew: remove all iron blocks AND thaw all frost tiles immediately
  smashBlocks(): number {
    let n = 0;
    let removed = false;
    this.blockUntil = 0;
    for (let r = 0; r < this.h; r++) for (let c = 0; c < this.w; c++) {
      const g = this.grid[r][c];
      if (!g) continue;
      if (g.block) { g.dead = true; this.grid[r][c] = null; this.onFx("boom", r, c); n++; removed = true; }
      else if (g.hard > 0) { g.hard = 0; this.onFx("crack", r, c); n++; } // thaw ice
    }
    if (removed) this.gravity();
    if (n) this.onChange();
    return n;
  }

  /** AI-03: find one swap the board will actually CARRY OUT — the rival's
   *  autoplayer. Scans right/down neighbours of unblocked gems; returns
   *  [r1,c1,r2,c2] or null. Honour-system fast: checks the two swapped cells'
   *  rows/cols only, because only those lines can change.
   *
   *  `score` (optional, per gem) turns it into a SEEKING player: instead of
   *  the geometrically-first match it returns the match with the highest
   *  weight (ties → first). The rival uses this to chase tokened gems — the
   *  difference between a board that merely animates and a board that PAYS,
   *  which is exactly the skill knob a slow-but-sharp rival earns through.
   *
   *  AI-03d — THE ONE RULE. This used to count a run through ANY same-coloured
   *  neighbour, which is not the board's rule: `lineRuns` walks `matchable`
   *  cells, so an iron girder or a bomb sitting INSIDE a line breaks it however
   *  the colours read. The two oracles disagreed, and the rival — which asks
   *  this for a move and then hands it to `trySwap` — got a swap `trySwap`
   *  found no group for and reverted. A revert changes nothing, so the next
   *  tick asked the same question of the same board and got the same doomed
   *  cells back: the rival replayed one dead swap every `moveMs` for the rest
   *  of the match. It was worst on a sabotaged plant (girders are the sabotage
   *  that puts a `block` gem mid-line) and on a TOKENED dead swap, which the
   *  tier-weighted seek ranked above every real move on the board — so the
   *  rival not only stalled, it stalled on the one board it could least afford
   *  to. `matchable` now decides both sides, and the fuzz in board.test.ts pins
   *  the agreement: whatever `findMove` returns, `trySwap` carries out. */
  findMove(score?: (g: Gem) => number): [number, number, number, number] | null {
    let best: [number, number, number, number] | null = null;
    let bestScore = score ? -Infinity : 0;
    const candidate = (mv: [number, number, number, number], a: Gem, b: Gem): [number, number, number, number] | null => {
      if (!score) return mv;
      const w = (score(a) ?? 0) + (score(b) ?? 0);
      if (w <= bestScore) return null;
      bestScore = w;
      return mv;
    };
    /** The run of one colour through `at` on a line, counted the way the board
     *  counts it: contiguous AND `matchable` at every cell, exactly the walk
     *  `lineRuns` does. A girder or a bomb in the line ENDS it. */
    const runOn = (cell: (i: number) => Gem | null, at: number, len: number, res: ResKey): number => {
      let run = 1;
      for (let i = at - 1; i >= 0; i--) {
        const g = cell(i);
        if (!this.matchable(g) || g.res !== res) break;
        run++;
      }
      for (let i = at + 1; i < len; i++) {
        const g = cell(i);
        if (!this.matchable(g) || g.res !== res) break;
        run++;
      }
      return run;
    };
    const makesMatch = (r: number, c: number): boolean => {
      const g = this.grid[r]?.[c];
      if (!this.matchable(g)) return false;
      const res = g.res;
      if (runOn((i) => this.grid[r][i], c, this.w, res) >= 3) return true;
      return runOn((i) => this.grid[i][c], r, this.h, res) >= 3;
    };
    const dirs: [number, number][] = [[0, 1], [1, 0]];
    /** A bomb is a move in itself — `trySwap` detonates whatever bomb it is
     *  handed instead of looking for a group — and `hasMove` counts an
     *  unblocked bomb as the board's escape hatch, so the deadlock guard will
     *  never reshuffle while one sits there. `findMove` has to agree with that
     *  or the rival stalls on a board `hasMove` calls playable. It is the
     *  FALLBACK, offered only when no scoring match exists: blowing a forged
     *  bomb on a random colour while a real match is waiting is not a plan. */
    let bombMove: [number, number, number, number] | null = null;
    for (let r = 0; r < this.h; r++) {
      for (let c = 0; c < this.w; c++) {
        const a = this.grid[r][c];
        if (!a || a.block) continue;
        for (const [dr, dc] of dirs) {
          const r2 = r + dr, c2 = c + dc;
          const b = this.grid[r2]?.[c2];
          if (!b || b.block) continue;
          if (a.special === "bomb" || b.special === "bomb") {
            if (!bombMove) bombMove = [r, c, r2, c2];
            continue;
          }
          if (b.res === a.res) continue;      // swapping two alike gems is a no-op
          // trial swap
          this.grid[r][c] = b; this.grid[r2][c2] = a;
          const ok = makesMatch(r, c) || makesMatch(r2, c2);
          this.grid[r][c] = a; this.grid[r2][c2] = b;
          if (!ok) continue;
          const picked = candidate([r, c, r2, c2], a, b);
          if (picked && !score) return picked;
          if (picked) best = picked;
        }
      }
    }
    return best ?? bombMove;
  }

  /** AI-03 save/restore: everything that is not derivable (grid, pools,
   * clocks as REMAINING ms so they survive a page reload). #117: each cell
   * also carries its mint id, so a restore REUSES identities instead of
   * minting fresh ones — an incremental update (a multiplayer board sync)
   * then reads to the UI as "the same gems, changed", not a whole-board
   * replacement. */
  save(): unknown {
    const now = performance.now();
    return {
      grid: this.grid.map((row) => row.map((g) => g && {
        id: g.id,
        res: g.res, tier: g.tier, special: g.special, hard: g.hard,
        block: g.block, forged: g.forged ? 1 : 0,
      })),
      seq: this.seq, pool: this.pool, comboCount: this.comboCount,
      fogIn: Math.max(0, this.fogUntil - now), blockIn: Math.max(0, this.blockUntil - now),
    };
  }

  restore(d: any): void {
    if (!d?.grid) return;
    const now = performance.now();
    let maxId = 1;
    this.grid = d.grid.map((row: any[]) => row.map((cell: any, ci: number) => {
      if (!cell) return null;
      // #117: keep the sender's id when it is a usable one — stable cell
      // identity across incremental updates. Anything else (an old save, a
      // malformed cell) falls back to minting, exactly as before.
      const id = typeof cell.id === "number" && Number.isInteger(cell.id) && cell.id > 0
        ? cell.id
        : this.seq++;
      return {
        id, res: cell.res, tier: cell.tier ?? 0,
        special: cell.special ?? null, hard: cell.hard ?? 0,
        block: !!cell.block, forged: !!cell.forged,
        r: 0, c: ci, // r patched below
      } as Gem;
    }));
    for (let r = 0; r < this.grid.length; r++) {
      for (let c = 0; c < (this.grid[r]?.length ?? 0); c++) {
        const g = this.grid[r][c];
        if (g) { g.r = r; g.c = c; maxId = Math.max(maxId, g.id); }
      }
    }
    if (typeof d.seq === "number") this.seq = Math.max(this.seq, d.seq);
    // ...and however the ids arrived, this board never mints a collision.
    this.seq = Math.max(this.seq, maxId + 1);
    if (Array.isArray(d.pool)) this.pool = d.pool;
    if (typeof d.comboCount === "number") this.comboCount = d.comboCount;
    this.fogUntil = now + (d.fogIn ?? 0);
    this.blockUntil = now + (d.blockIn ?? 0);
    this.busy = false;
    this.moveQueue = [];
  }

  tickEffects(now: number) {
    if (this.busy) return;
    // clear expired iron blocks
    if (this.blockUntil && now > this.blockUntil) {
      this.blockUntil = 0;
      let removed = false;
      for (let r = 0; r < this.h; r++) for (let c = 0; c < this.w; c++) {
        const g = this.grid[r][c];
        if (g?.block) { g.dead = true; this.grid[r][c] = null; removed = true; }
      }
      if (removed) { this.gravity(); this.onChange(); }
    }
    // deadlock guard — reshuffle even when no player move triggered a settle
    if (!this.busy && !this.hasMove()) this.reshuffle();
  }

  /** Can the gem at (r,c) be swapped at all — does it have a neighbour
   *  `trySwap` would accept? A bomb is a move only while it can be moved:
   *  one boxed in by girders is not, and claiming it was told the deadlock
   *  guard the board was playable, so the guard never reshuffled it. */
  private swappable(r: number, c: number): boolean {
    const g = this.grid[r]?.[c];
    if (!g || g.block) return false;
    const dirs: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    return dirs.some(([dr, dc]) => {
      const n = this.grid[r + dr]?.[c + dc];
      return !!n && !n.block;
    });
  }

  hasMove(): boolean {
    const test = (r1: number, c1: number, r2: number, c2: number) => {
      const a = this.grid[r1][c1], b = this.grid[r2][c2];
      if (!a || !b || a.block || b.block || a.special === "bomb" || b.special === "bomb") return false;
      this.grid[r1][c1] = b; this.grid[r2][c2] = a;
      const ok = this.findGroups().length > 0;
      this.grid[r1][c1] = a; this.grid[r2][c2] = b;
      return ok;
    };
    for (let r = 0; r < this.h; r++) for (let c = 0; c < this.w; c++) {
      if (c < this.w - 1 && test(r, c, r, c + 1)) return true;
      if (r < this.h - 1 && test(r, c, r + 1, c)) return true;
      // bombs always give a "move" — but only while one can actually be
      // SWAPPED: `trySwap` refuses a blocked cell, and a girder stamped onto a
      // bomb (MP-05's `applySabotage` blocks whatever gem is already there) is
      // not a move. Claiming it anyway told the deadlock guard the board was
      // playable when it was not, so the guard never reshuffled and both seats
      // sat on it until the girder expired. AI-03d: this is the same agreement
      // `findMove` now keeps — if `hasMove` says yes, `findMove` finds one.
      const g = this.grid[r][c];
      if (g?.special === "bomb" && this.swappable(r, c)) return true;
    }
    return false;
  }

  async reshuffle() {
    this.busy = true;
    // try shuffles until the board has at least one move (avoid re-deadlock)
    const movable = this.gems().filter((g) => !g.block);
    for (let attempt = 0; attempt < 30; attempt++) {
      const resList = shuffle(movable.map((g) => g.res));
      movable.forEach((g, i) => { g.res = resList[i]; });
      if (this.hasMove() && this.findGroups().length === 0) break;
    }
    this.onFx("bad", 0, 0);
    this.onChange();
    await sleep(BOARD_ANIMATION_MS.shuffle);
    this.busy = false;
  }

  // Manual escape hatch: wipe the whole quarry to fresh NEUTRAL gems (no tokens).
  resetNeutral() {
    this.busy = true;
    this.moveQueue = [];
    this.blockUntil = 0; this.fogUntil = 0;
    this.initFill();                       // fresh gems, tier 0, no match at start
    this.onChange();
    this.busy = false;
  }
}