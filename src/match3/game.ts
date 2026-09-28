// ══════════════════════════════════════════════════════════════════════════
// MATCH-2 — the session runner: one tuning session on the new board.
//
// What `game.ts` in the iso tree does around a session, in one small
// framework-free object so the demo, the tests and (later) the iso game can
// drive the same thing:
//
//   • opens the board the way the iso game does — `paysScore`, the cargo
//     bias, the difficulty's obstacles under the seeded RNG;
//   • spends a move per swap that RESOLVED (a dud swap is not a move);
//   • scores `onClear` and `onReward` into the session;
//   • rates the score on the 5★ table after every pass, and on a crossing:
//       4★ → the small flourish
//       5★ → the finale (slow-mo cascades, push-in, music) — respecting the
//            player's reduced-motion and performance preferences;
//   • voices every phase (`voicePhase`) unless headless;
//   • ends the session when the budget is spent and the board is still —
//     and, if a finale is running, once the finale is over.
//
// Every hook is optional and every one is what the tests assert through.
// ══════════════════════════════════════════════════════════════════════════

import { playMatch3Cue, stopFinaleMusic, voicePhase, type CuePlay } from "./audio";
import { Board } from "./board";
import { FinaleController, type FinalePlan, type FinalePrefs, type FlourishCue, type MusicCue } from "./finale";
import { mulberry32, setRng, type Rng } from "./rng";
import {
  DIFFICULTY_RULES,
  createTuningSession,
  depotSessionOutcome,
  recordTuningCleared,
  recordTuningReward,
  sessionObstacles,
  takeTuningMove,
  tuningOver,
  type DifficultyKey,
  type TuningOutcome,
  type TuningSession,
} from "./session";
import { TUNING, tuningStarsFor, type TuningStars } from "./stars";
import { STONE_TO_RES, type BoardPhase, type StoneType, type SwapOutcome } from "./types";

export interface RunnerHooks {
  onPhase?: (phase: BoardPhase, ms: number) => void;
  onScore?: (score: number, stars: TuningStars) => void;
  onStars?: (stars: TuningStars, prev: TuningStars) => void;
  onFinaleStart?: (plan: FinalePlan) => void;
  onFinaleEnd?: (plan: FinalePlan) => void;
  onMusic?: (cue: MusicCue) => void;
  onFlourish?: (cue: FlourishCue) => void;
  onTimeScale?: (scale: number) => void;
  onCue?: (play: CuePlay) => void;
  onSessionEnd?: (result: SessionResult) => void;
  onMove?: (used: number, moves: number) => void;
}

export interface RunnerOptions {
  seed?: number;
  cargo?: StoneType | null;
  difficulty?: DifficultyKey;
  tier?: number;
  moves?: number;
  prefs?: FinalePrefs;
  /** No timers, no sound — the tests and the bot. */
  headless?: boolean;
  /** The depot's yield before the session (the results card counts up from it). */
  prevYield?: number;
  hooks?: RunnerHooks;
  now?: () => number;
}

export interface SessionResult {
  session: TuningSession;
  stars: TuningStars;
  outcome: TuningOutcome;
  finale: FinalePlan | null;
  seed: number;
}

export class SessionRunner {
  readonly board: Board;
  readonly session: TuningSession;
  readonly finale: FinaleController;
  readonly seed: number;
  readonly difficulty: DifficultyKey;
  prefs: FinalePrefs;
  hooks: RunnerHooks;
  private ended = false;
  private endPending = false;
  private lastStars: TuningStars = 0;
  private lastPlan: FinalePlan | null = null;
  private readonly headless: boolean;
  private readonly rng: Rng;
  private readonly prevYield: number | undefined;
  private readonly clock: () => number;

  constructor(opts: RunnerOptions = {}) {
    this.seed = opts.seed ?? ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    this.rng = mulberry32(this.seed);
    this.difficulty = opts.difficulty ?? "normal";
    this.prefs = opts.prefs ?? { reducedMotion: false, perfMode: false };
    this.hooks = opts.hooks ?? {};
    this.headless = opts.headless === true;
    this.prevYield = opts.prevYield;
    this.clock = opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    // the shared facade too, so anything else rolling on `rand()` follows the seed
    setRng(this.rng);

    const cargo = opts.cargo === undefined ? "grain" : opts.cargo;
    this.board = new Board({ rng: this.rng });
    this.board.allowQueue = false;
    if (this.headless) this.board.waitScale = 0;
    this.board.setPaysScore(true);
    if (cargo) this.board.setBias(STONE_TO_RES[cargo], TUNING.cargoBias);
    if (cargo === "gold") this.board.setGoldEnabled(true);
    this.session = createTuningSession(1, cargo, opts.moves ?? TUNING.moves);
    const plan = sessionObstacles(DIFFICULTY_RULES[this.difficulty], opts.tier ?? 1);
    this.session.opened = this.board.seedObstacles(plan.frost, plan.girders, plan.frostHard);

    this.finale = new FinaleController(
      {
        onStart: (p) => {
          this.lastPlan = p;
          this.hooks.onFinaleStart?.(p);
        },
        onEnd: (p) => {
          this.hooks.onFinaleEnd?.(p);
          this.maybeEnd();
        },
        onMusic: (cue) => {
          this.hooks.onMusic?.(cue);
          if (!this.headless) this.hooks.onCue?.(playMatch3Cue(cue));
        },
        onFlourish: (cue) => {
          this.hooks.onFlourish?.(cue);
          if (!this.headless) this.hooks.onCue?.(playMatch3Cue(cue, { at: 0.05 }));
        },
        onTimeScale: (s) => this.hooks.onTimeScale?.(s),
      },
      this.clock,
    );
    this.board.timeScale = () => this.finale.timeScale(this.clock());

    this.board.onPhase = (phase, ms) => {
      this.hooks.onPhase?.(phase, ms);
      if (!this.headless) for (const play of voicePhase(phase, ms)) this.hooks.onCue?.(play);
      if (phase.type === "clear" && phase.minted.some((m) => m.what === "bomb")) this.session.tally.bombs++;
    };
    this.board.onClear = (n, chain) => {
      recordTuningCleared(this.session, n, chain);
      this.rate();
    };
    this.board.onReward = (kind) => {
      recordTuningReward(this.session, kind);
      this.rate();
    };
  }

  get stars(): TuningStars {
    return tuningStarsFor(this.session.score);
  }
  get over(): boolean {
    return this.ended;
  }
  get finalePlan(): FinalePlan | null {
    return this.lastPlan;
  }

  /** Re-rate after a pass; fire the crossings. */
  private rate(): void {
    const stars = this.stars;
    this.hooks.onScore?.(this.session.score, stars);
    if (stars !== this.lastStars) {
      const prev = this.lastStars;
      this.lastStars = stars;
      this.hooks.onStars?.(stars, prev);
      if (stars >= 4) this.finale.trigger(stars, this.prefs, this.clock());
    }
  }

  /** Advance the finale's clock (call every frame; headless tests call it by hand). */
  tick(at: number = this.clock()): void {
    this.finale.tick(at);
  }

  /** One player move. Resolves when the board is still again. */
  async trySwap(r1: number, c1: number, r2: number, c2: number): Promise<SwapOutcome> {
    if (this.ended || tuningOver(this.session) || this.board.busy) return "refused";
    const outcome = await this.board.trySwap(r1, c1, r2, c2);
    if (outcome === "matched") {
      takeTuningMove(this.session);
      this.hooks.onMove?.(this.session.used, this.session.moves);
    }
    if (this.headless) this.tick(this.clock());
    this.maybeEnd();
    return outcome;
  }

  /** Finish early (the results card's Finish button). */
  finish(): SessionResult | null {
    if (this.ended) return null;
    this.session.used = this.session.moves;
    return this.end();
  }

  private maybeEnd(): void {
    if (this.ended || !tuningOver(this.session) || this.board.busy) return;
    if (this.finale.active) {
      this.endPending = true;
      return;
    }
    this.end();
  }

  private end(): SessionResult {
    this.ended = true;
    this.endPending = false;
    const stars = this.stars;
    const outcome = depotSessionOutcome(this.session.score, this.prevYield, DIFFICULTY_RULES[this.difficulty]);
    const result: SessionResult = { session: this.session, stars, outcome, finale: this.lastPlan, seed: this.seed };
    this.hooks.onSessionEnd?.(result);
    return result;
  }

  /** Is the runner waiting on the finale before it can end? */
  get waitingOnFinale(): boolean {
    return this.endPending;
  }

  /** Let the music go (a new session, a closed card). */
  dispose(): void {
    stopFinaleMusic();
  }
}
