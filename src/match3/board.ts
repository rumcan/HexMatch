// ══════════════════════════════════════════════════════════════════════════
// MATCH-2 — the drop-in `Board`.
//
// The public surface `src/game/board.ts` had at 32571ece, over the new
// engine: the same fields (`grid`, `seq`, `busy`, `waitScale`, `pool`,
// `comboCount`, `paysScore`), the same callbacks in the same order
// (`onHarvest`, `onGold`, `onFx`, `onChange`, `onTurbo`, `onPopup`,
// `onCombo`, `onBonus`, `onReward`, `onClear`, `onPass`, `onCrossChoice`),
// the same methods (`trySwap`, `detonate`, `findMove`, `hasMove`,
// `seedObstacles`, `obstacleCounts`, `spawnTokens`, `registerCombo`,
// `reshuffle`, `resetNeutral`, `snapshot`, `restore`, `setSize`, `setBias`,
// `setGoldEnabled`, `initFill`, `gems`, `findGroups`, `matchable`) and the
// same animation pacing (`BOARD_ANIMATION_MS`, the #152 turbo queue, the B1
// `waitScale` for headless callers).
//
// Two things are new, both additive:
//
//   `onPhase`     every animation beat as it starts (`types.ts`) — the
//                 renderer tweens it and the audio layer schedules the clack
//                 at the contact frame and the settle at the landing frame;
//   `timeScale`   a function the finale installs: every wait is divided by
//                 it, so a 0.25 finale runs the last cascades at a quarter
//                 speed while the engine underneath is byte-for-byte the
//                 same resolution.
//
// In the repo this file is `src/game/board.ts`'s replacement body — or, kept
// swappable, `src/game/board.ts` becomes `export * from "../match3/board"`.
// ══════════════════════════════════════════════════════════════════════════

import { Match3Engine, type EngineOptions, type Move, type Resolution } from "./engine";
import { choice } from "./rng";
import {
  BOARD_ANIMATION_MS,
  FAST_ANIMATION_MS,
  type AnimationKey,
  type BoardObstacles,
  type BoardPhase,
  type CrossKind,
  type FxType,
  type Gem,
  type PassReport,
  type ResKey,
  type RewardKind,
  type SwapOutcome,
} from "./types";

export {
  BOARD_ANIMATION_MS,
  FAST_ANIMATION_MS,
  HOLY_CROSS_PICKS,
  BROKEN_CROSS_PICKS,
  arcadeLabel,
} from "./types";
export type { AnimationKey, BoardObstacles, BoardPhase, CrossKind, FxType, Gem, PassReport, RewardKind, ResKey, SwapOutcome } from "./types";

const BASE_POOL: ResKey[] = ["wood", "brick", "sheep", "wheat", "ore"];
const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

export class Board {
  readonly engine: Match3Engine;
  busy = false;
  /** B1 (#246): 1 = shipped pace; 0 = no timers at all (headless). */
  waitScale = 1;
  static COMBOS_PER_GOLD = 2;

  /** MATCH-2: the finale's clock. Waits are divided by it (0.25 = slow-mo). */
  timeScale: () => number = () => 1;
  /** MATCH-2: the #152 queue can be switched off by a caller that wants one
   * move at a time (the tuning session refuses input while a move resolves). */
  allowQueue = true;

  private moveQueue: { r1: number; c1: number; r2: number; c2: number; now: number }[] = [];
  private turboOn = false;

  // ── callbacks (wired by game) ──────────────────────────────────────────
  onHarvest: (res: ResKey, amount: number, forged: boolean) => boolean | number | void = () => true;
  onGold: (n: number) => void = () => {};
  onFx: (type: FxType, r: number, c: number, text?: string) => void = () => {};
  onChange: () => void = () => {};
  onTurbo: (on: boolean) => void = () => {};
  onPopup: (gains: Partial<Record<ResKey, number>>, label: string) => void = () => {};
  onCombo: (count: number, needed: number, granted: boolean) => void = () => {};
  onBonus: (res: ResKey, amount: number, reason: string) => void = () => {};
  onReward: (kind: RewardKind) => void = () => {};
  onClear: (n: number, chain: number) => void = () => {};
  onPass: (info: PassReport) => void = () => {};
  onCrossChoice: (kind: CrossKind, picks: number, pick: (chosen: ResKey[]) => void) => void = (_kind, picks, pick) =>
    pick(Array.from({ length: picks }, () => choice(BASE_POOL)));
  /** MATCH-2: one animation beat, as it starts. */
  onPhase: (phase: BoardPhase, durationMs: number) => void = () => {};

  constructor(opts: EngineOptions = {}) {
    this.engine = new Match3Engine(opts);
    this.engine.credit = (res, amount, forged) => {
      const r = this.onHarvest(res, amount, forged);
      if (r === false) return 0;
      return typeof r === "number" ? r : amount;
    };
    // Legacy seams: the engine asks the Board for refill colours, matches and
    // "is there a move", so a stub on `board.randRes` / `findGroups` / `hasMove`
    // steers the engine the way it steered the old board. The Board's own
    // methods call the engine's originals.
    this.enginePick = this.engine.randRes.bind(this.engine);
    this.engineGroups = this.engine.findGroups.bind(this.engine);
    this.engineHasMove = this.engine.hasMove.bind(this.engine);
    this.engine.randRes = () => this.randRes();
    this.engine.findGroups = () => this.findGroups();
    this.engine.hasMove = () => this.hasMove();
  }
  private readonly enginePick: () => ResKey;
  private readonly engineGroups: () => Gem[][];
  private readonly engineHasMove: () => boolean;
  /** The cargo colour this session's refills lean toward (null outside a session). */
  get biasRes(): ResKey | null {
    return this.engine.biasRes;
  }

  // ── state passthroughs ─────────────────────────────────────────────────
  get grid(): (Gem | null)[][] {
    return this.engine.grid;
  }
  set grid(g: (Gem | null)[][]) {
    this.engine.grid = g;
  }
  get seq(): number {
    return this.engine.seq;
  }
  set seq(n: number) {
    this.engine.seq = n;
  }
  get pool(): ResKey[] {
    return this.engine.pool;
  }
  set pool(p: ResKey[]) {
    this.engine.pool = p;
  }
  get comboCount(): number {
    return this.engine.comboCount;
  }
  set comboCount(n: number) {
    this.engine.comboCount = n;
  }
  get paysScore(): boolean {
    return this.engine.paysScore;
  }
  set paysScore(on: boolean) {
    this.engine.paysScore = on;
  }
  setPaysScore(on: boolean): void {
    this.engine.paysScore = on;
  }
  get w(): number {
    return this.engine.w;
  }
  get h(): number {
    return this.engine.h;
  }
  get queuedMoves(): number {
    return this.moveQueue.length;
  }

  setSize(w: number, h: number): boolean {
    return this.engine.setSize(w, h);
  }
  setBias(res: ResKey | null, p = 0.45): void {
    this.engine.setBias(res, p);
  }
  setGoldEnabled(on: boolean): void {
    this.engine.setGoldEnabled(on);
  }
  initFill(): void {
    this.engine.initFill();
  }
  gems(): Gem[] {
    return this.engine.gems();
  }
  matchable(g: Gem | null | undefined): g is Gem {
    return this.engine.matchable(g);
  }
  findGroups(): Gem[][] {
    return this.engineGroups();
  }
  findMove(score?: (g: Gem) => number): Move | null {
    return this.engine.findMove(score);
  }
  hasMove(): boolean {
    return this.engineHasMove();
  }
  seedObstacles(frost = 0, girders = 0, frostHard: 1 | 2 = 2): BoardObstacles {
    const placed = this.engine.seedObstacles(frost, girders, frostHard);
    this.onChange();
    return placed;
  }
  clearFrost(): number {
    const n = this.engine.clearFrost();
    if (n) this.onChange();
    return n;
  }
  clearGirders(): number {
    const n = this.engine.clearGirders();
    if (n) this.onChange();
    return n;
  }
  obstacleCounts(): BoardObstacles {
    return this.engine.obstacleCounts();
  }
  spawnTokens(pool: Partial<Record<ResKey, number>>): number {
    const n = this.engine.spawnTokens(pool);
    if (n) this.onChange();
    return n;
  }
  /** The session's exit door: every frost thaws and every girder becomes a plain gem, in place. */
  clearObstacles(): number {
    let n = 0;
    for (const g of this.gems()) {
      if (g.block) { g.block = false; n++; }
      if (g.hard > 0) { g.hard = 0; n++; }
    }
    if (n) this.onChange();
    return n;
  }
  /** Legacy name for `snapshot` (AI-03 save / the wire's board sync). */
  save(): unknown {
    return this.snapshot();
  }
  /** The deadlock guard — the quarry's per-frame tick. */
  tickEffects(_now?: number): void {
    if (!this.busy && !this.hasMove()) this.reshuffle();
  }
  snapshot(): ReturnType<Match3Engine["snapshot"]> {
    return this.engine.snapshot();
  }
  restore(d: unknown): void {
    this.engine.restore(d);
    this.onChange();
  }

  // ── pacing ─────────────────────────────────────────────────────────────
  /** Is the board in catch-up mode (#152)? */
  get turbo(): boolean {
    const nxt = this.moveQueue[0];
    if (!nxt) return false;
    const g1 = this.grid[nxt.r1]?.[nxt.c1];
    const g2 = this.grid[nxt.r2]?.[nxt.c2];
    if (!g1 || !g2) return true;
    if (g1.block || g2.block) return false;
    if (g1.special === "bomb" || g2.special === "bomb") return true;
    return this.engine.swapGain(nxt.r1, nxt.c1, nxt.r2, nxt.c2) > 0;
  }

  private syncTurbo(): boolean {
    const on = this.turbo;
    if (on !== this.turboOn) {
      this.turboOn = on;
      this.onTurbo(on);
    }
    return on;
  }

  private endTurbo(): void {
    if (this.turboOn) {
      this.turboOn = false;
      this.onTurbo(false);
    }
  }

  /** The real-time length of one beat, as the renderer must tween it. */
  phaseMs(key: AnimationKey): number {
    if (this.waitScale <= 0) return 0;
    const table = this.syncTurbo() ? FAST_ANIMATION_MS : BOARD_ANIMATION_MS;
    const scale = this.timeScale();
    const ts = Number.isFinite(scale) && scale > 0 ? scale : 1;
    return (table[key] * this.waitScale) / ts;
  }

  private async wait(ms: number): Promise<void> {
    if (ms <= 0) {
      await Promise.resolve();
      return;
    }
    await sleep(ms);
  }

  private static beatKey(phase: BoardPhase): AnimationKey | null {
    switch (phase.type) {
      case "swap":
      case "revert":
        return "swap";
      case "clear":
        return "clear";
      case "bombClear":
        return "bombClear";
      case "fall":
        return "fall";
      case "bombFall":
        return "bombFall";
      case "shuffle":
        return "shuffle";
      default:
        return null;
    }
  }

  /** Run a resolution: hand every phase's facts to the legacy listeners, in
   * the old order, and wait the beat out before the next one. */
  private async run(gen: Resolution): Promise<boolean> {
    let input: ResKey[] | undefined;
    for (;;) {
      const step = gen.next(input);
      input = undefined;
      if (step.done) return step.value;
      const phase = step.value;
      const key = Board.beatKey(phase);
      const ms = key ? this.phaseMs(key) : 0;
      this.onPhase(phase, ms);
      switch (phase.type) {
        case "swap":
          this.onChange();
          await this.wait(ms);
          break;
        case "revert":
          this.onFx("bad", phase.a.r, phase.a.c);
          this.onChange();
          await this.wait(ms);
          break;
        case "clear":
        case "bombClear": {
          for (const f of phase.fx) this.onFx(f.type, f.r, f.c, f.text);
          for (const b of phase.bonus) this.onBonus(b.res, b.amount, b.reason);
          for (const k of phase.rewards) this.onReward(k);
          if (phase.type === "clear") {
            if (this.paysScore) for (const x of phase.crosses) this.onReward(x.kind === "holy" ? "holyCross" : "brokenCross");
            if (phase.cleared) this.onClear(phase.cleared, phase.chain);
          } else if (this.paysScore) {
            // a blast is the session's biggest single shape: depth 2
            this.onClear(phase.cleared, 2);
          }
          this.onPass(phase.pass);
          this.onChange();
          await this.wait(ms);
          break;
        }
        case "fall":
        case "bombFall":
          this.onChange();
          await this.wait(ms);
          break;
        case "crossBonus":
          for (const b of phase.bonus) this.onBonus(b.res, b.amount, b.reason);
          this.onChange();
          break;
        case "crossChoice":
          input = await new Promise<ResKey[]>((resolve) => this.onCrossChoice(phase.kind, phase.picks, resolve));
          break;
        case "end":
          if (phase.label === "COLOUR PURGE") {
            if (this.paysScore) this.onPopup({}, phase.label);
            else if (Object.keys(phase.gains).length) this.onPopup(phase.gains, phase.label);
          } else if (this.paysScore) {
            if (phase.maxChain >= 2) this.registerCombo();
            this.onPopup({}, phase.label);
          } else {
            if (Object.keys(phase.gains).length || phase.label) this.onPopup(phase.gains, phase.label);
            if (phase.maxChain >= 2) this.registerCombo();
          }
          break;
        case "shuffle":
          this.onFx("bad", 0, 0);
          this.onChange();
          await this.wait(ms);
          break;
      }
    }
  }

  // ── moves ──────────────────────────────────────────────────────────────
  private async _doSwap(r1: number, c1: number, r2: number, c2: number): Promise<SwapOutcome> {
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return "refused";
    const g1 = this.grid[r1]?.[c1];
    const g2 = this.grid[r2]?.[c2];
    if (!g1 || !g2 || g1.block || g2.block) return "refused";
    this.busy = true;
    let reverted = false;
    const seen = this.onPhase;
    this.onPhase = (p, ms) => {
      if (p.type === "revert") reverted = true;
      seen(p, ms);
    };
    try {
      const ok = await this.run(this.engine.resolveSwap(r1, c1, r2, c2));
      if (!ok) return "refused";
      return reverted ? "reverted" : "matched";
    } finally {
      this.onPhase = seen;
      this.busy = false;
    }
  }

  async trySwap(r1: number, c1: number, r2: number, c2: number, now = 0): Promise<SwapOutcome> {
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return "refused";
    const g1 = this.grid[r1]?.[c1];
    const g2 = this.grid[r2]?.[c2];
    if (!g1 || !g2 || g1.block || g2.block) return "refused";
    if (this.busy) {
      if (this.allowQueue && this.moveQueue.length < 4) {
        this.moveQueue.push({ r1, c1, r2, c2, now });
        this.syncTurbo();
        return "queued";
      }
      return "refused";
    }
    const outcome = await this._doSwap(r1, c1, r2, c2);
    while (this.moveQueue.length > 0) {
      if (this.busy) break;
      const nxt = this.moveQueue.shift()!;
      await this._doSwap(nxt.r1, nxt.c1, nxt.r2, nxt.c2);
    }
    this.endTurbo();
    return outcome;
  }

  /** Detonate a bomb on `colorRes` (the battle screen's ability row). */
  async detonate(bomb: Gem, colorRes: ResKey): Promise<void> {
    this.busy = true;
    try {
      await this.run(this.engine.detonate(bomb, colorRes));
    } finally {
      this.busy = false;
    }
  }

  /** Legacy: resolve whatever is on the board now (no swap) — cascades, callouts, harvest. */
  async settle(startCascade = 0): Promise<void> {
    this.busy = true;
    try {
      await this.run(this.engine.settle(startCascade));
    } finally {
      this.busy = false;
    }
  }

  /** Legacy: the next refill colour (tests stub it to script a refill). */
  randRes(): ResKey {
    return this.enginePick();
  }

  registerCombo(): void {
    this.engine.comboCount++;
    const need = Board.COMBOS_PER_GOLD;
    if (this.engine.comboCount >= need) {
      this.engine.comboCount -= need;
      if (this.paysScore) this.onReward("combo");
      else this.onGold(1);
      this.onCombo(this.engine.comboCount, need, true);
      this.onChange();
    } else {
      this.onCombo(this.engine.comboCount, need, false);
    }
  }

  async reshuffle(): Promise<void> {
    this.busy = true;
    try {
      this.engine.reshuffleGrid();
      const ms = this.phaseMs("shuffle");
      this.onPhase({ type: "shuffle" }, ms);
      this.onFx("bad", 0, 0);
      this.onChange();
      await this.wait(ms);
    } finally {
      this.busy = false;
    }
  }

  /** Wipe to fresh neutral gems — the session's obstacles die with it. */
  resetNeutral(): void {
    this.busy = true;
    this.moveQueue = [];
    this.engine.initFill();
    this.onChange();
    this.busy = false;
  }
}
