// ══════════════════════════════════════════════════════════════════════════
// MATCH-2 — the finale.
//
// When a session's score crosses the 5★ bar the moment is made to land:
//
//   • the cascades still resolving play at a QUARTER speed (`timeScale`
//     0.25 — every board wait is divided by it), held for a beat and then
//     eased back to full speed over the rest of the finale;
//   • the camera pushes in on the board a few percent and settles back;
//   • the finale MUSIC plays over it (`assets/sfx/finale.mp3`, the lead's
//     public-domain recording — the synth fallback hums the first phrase of
//     the Ode to Joy) and the 5★ flourish rings on top.
//
// 4★ gets the smaller flourish (`star_4`) and nothing else. Reduced motion
// means NO slow-mo and NO push-in — but the music and the flourish still
// happen, because the celebration is the point and the motion is only how
// it is told. Performance mode drops the slow-mo polish too (a mid phone
// rendering a cascade at a quarter speed is four times the frames).
//
// The time curve and the zoom curve are pure functions of elapsed real time
// (`finaleTimeScale`, `finaleZoom`), so a test can assert the whole shape
// without a clock; the controller only holds `startedAt` and the hooks.
// ══════════════════════════════════════════════════════════════════════════

export const FINALE = {
  /** The slow-mo factor at the moment of the crossing. */
  timeScale: 0.25,
  /** How long the quarter speed is held before it eases back, ms (real time). */
  holdMs: 700,
  /** Whole finale length, ms (real time) — time scale is 1 again at the end. */
  durationMs: 2800,
  /** Camera push-in at the peak (1.06 = six percent). */
  pushIn: 1.06,
  /** The push-in reaches its peak here, then settles back by `durationMs`. */
  pushInPeakMs: 500,
} as const;

export type FlourishCue = "star_4" | "star_5";
export type MusicCue = "finale";

export interface FinalePrefs {
  reducedMotion: boolean;
  perfMode: boolean;
}

export interface FinalePlan {
  stars: 4 | 5;
  /** Are the cascades slowed at all? False on reduced motion / perf mode / 4★. */
  slowMo: boolean;
  timeScale: number;
  holdMs: number;
  durationMs: number;
  /** 1 when the camera stays put (reduced motion, 4★). */
  pushIn: number;
  music: MusicCue | null;
  flourish: FlourishCue;
}

/** What a rating earns, under the player's motion preferences. Null below 4★. */
export function planFinale(stars: number, prefs: FinalePrefs): FinalePlan | null {
  if (stars < 4) return null;
  if (stars >= 5) {
    const motion = !prefs.reducedMotion && !prefs.perfMode;
    return {
      stars: 5,
      slowMo: motion,
      timeScale: motion ? FINALE.timeScale : 1,
      holdMs: FINALE.holdMs,
      durationMs: FINALE.durationMs,
      pushIn: prefs.reducedMotion ? 1 : FINALE.pushIn,
      music: "finale",
      flourish: "star_5",
    };
  }
  return { stars: 4, slowMo: false, timeScale: 1, holdMs: 0, durationMs: 900, pushIn: 1, music: null, flourish: "star_4" };
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * The board's clock at `elapsedMs` into a finale: the plan's time scale,
 * held for `holdMs`, then eased back to 1 by `durationMs`. 1 outside it.
 */
export function finaleTimeScale(plan: FinalePlan | null, elapsedMs: number): number {
  if (!plan || !plan.slowMo) return 1;
  if (elapsedMs < 0 || elapsedMs >= plan.durationMs) return 1;
  if (elapsedMs <= plan.holdMs) return plan.timeScale;
  const t = clamp01((elapsedMs - plan.holdMs) / Math.max(1, plan.durationMs - plan.holdMs));
  return plan.timeScale + (1 - plan.timeScale) * easeInOutCubic(t);
}

/** The camera's zoom at `elapsedMs`: up to `pushIn` fast, back to 1 slowly. */
export function finaleZoom(plan: FinalePlan | null, elapsedMs: number): number {
  if (!plan || plan.pushIn === 1) return 1;
  if (elapsedMs < 0 || elapsedMs >= plan.durationMs) return 1;
  if (elapsedMs <= FINALE.pushInPeakMs) return 1 + (plan.pushIn - 1) * easeOutCubic(elapsedMs / FINALE.pushInPeakMs);
  const t = clamp01((elapsedMs - FINALE.pushInPeakMs) / Math.max(1, plan.durationMs - FINALE.pushInPeakMs));
  return plan.pushIn - (plan.pushIn - 1) * easeInOutCubic(t);
}

export interface FinaleHooks {
  onStart?: (plan: FinalePlan) => void;
  onEnd?: (plan: FinalePlan) => void;
  onMusic?: (cue: MusicCue) => void;
  onFlourish?: (cue: FlourishCue) => void;
  onTimeScale?: (scale: number) => void;
}

/**
 * The live finale: `trigger` once per rating crossed, `tick` every frame,
 * `timeScale`/`zoom` read by the board and the renderer. A 4★ trigger while
 * a 5★ finale runs is ignored; a 5★ trigger upgrades a 4★ one.
 */
export class FinaleController {
  plan: FinalePlan | null = null;
  startedAt = 0;
  private lastScale = 1;
  private triggered = new Set<number>();
  constructor(
    public hooks: FinaleHooks = {},
    private now: () => number = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  ) {}

  get active(): boolean {
    return this.plan !== null;
  }

  /** Reset for a new session. */
  reset(): void {
    this.plan = null;
    this.triggered.clear();
    this.lastScale = 1;
  }

  trigger(stars: number, prefs: FinalePrefs, at: number = this.now()): FinalePlan | null {
    if (this.triggered.has(stars)) return null;
    const plan = planFinale(stars, prefs);
    if (!plan) return null;
    if (this.plan && this.plan.stars >= plan.stars) {
      this.triggered.add(stars);
      return null;
    }
    this.triggered.add(stars);
    this.plan = plan;
    this.startedAt = at;
    this.hooks.onStart?.(plan);
    this.hooks.onFlourish?.(plan.flourish);
    if (plan.music) this.hooks.onMusic?.(plan.music);
    this.emitScale(this.timeScale(at));
    return plan;
  }

  elapsed(at: number = this.now()): number {
    return this.plan ? at - this.startedAt : 0;
  }

  timeScale(at: number = this.now()): number {
    return finaleTimeScale(this.plan, this.elapsed(at));
  }

  zoom(at: number = this.now()): number {
    return finaleZoom(this.plan, this.elapsed(at));
  }

  private emitScale(s: number): void {
    if (Math.abs(s - this.lastScale) > 1e-4) {
      this.lastScale = s;
      this.hooks.onTimeScale?.(s);
    }
  }

  /** Advance: emits the eased time scale and closes the finale at its end. */
  tick(at: number = this.now()): void {
    if (!this.plan) return;
    this.emitScale(this.timeScale(at));
    if (this.elapsed(at) >= this.plan.durationMs) {
      const done = this.plan;
      this.plan = null;
      this.emitScale(1);
      this.hooks.onEnd?.(done);
    }
  }
}
