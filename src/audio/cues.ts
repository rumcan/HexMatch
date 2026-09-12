// ══════════════════════════════════════════════════════════════════════════
// SFX-01 — the cue catalogue: what each moment of the HUD actually sounds like.
//
// The theme is *The Foundry Syndicate* (docs/UI-NOIR-THEME.md): carved iron,
// aged brass, oiled walnut, one amber lamp, a typewriter ledger. So the mix is
// built from wood, felt, paper, glass and brass — never from the bright
// digital beeps a game reaches for when nobody is listening for them. Every
// cue is short (16 ms – 2.1 s), quiet (peak layer gains 0.01 – 0.16 before the
// 0.55 master), and made of at most a handful of layers:
//
//   · a TONE gives the pitch and the body,
//   · a NOISE burst gives the material — the transient that decides whether a
//     click reads as brass, as a fingertip on paper, or as a shovel in gravel.
//
// Two habits keep a session pleasant rather than fatiguing, and both are in
// this file rather than at the call sites:
//
//   · EVERY cue has a `gap` — the shortest time between two of itself. A
//     cascade, a stack of toasts or a mouse dragged along a row of buttons
//     therefore plays a rhythm, not a buzz.
//   · THE CASCADE SINGS A LADDER. `pop` and `pick` keep a streak: consecutive
//     hits inside a short window rise step by step through a pentatonic scale
//     and fall back to the root after a pause. That single trick is most of
//     why clearing five gems feels good instead of noisy.
//
// Nothing here touches the simulation RNG — only `Math.random`, and only for
// the grain of a noise burst, so a sound can never move a game outcome.
// ══════════════════════════════════════════════════════════════════════════
import {
  bus, countPlay, countRefused, gate, isArmed, isAudioEnabled,
  noiseBurst, tone, type NoiseSpec, type ToneSpec,
} from "./engine";

/** Every sound the game can make, in the order `__sfx.audition()` plays them. */
export const CUE_NAMES = [
  "hover", "click", "tab", "select", "pick", "swap", "open", "close",
  "pop", "crack", "up", "boom", "combo", "deny",
  "place", "pave", "build", "demolish", "harvest", "coin", "star", "wire",
  "victory", "defeat",
] as const;

export type Cue = (typeof CUE_NAMES)[number];

export function isCue(name: string): name is Cue {
  return (CUE_NAMES as readonly string[]).includes(name);
}

/**
 * What each cue is FOR — the one line a reviewer or a playtester needs to
 * audition it from the console (`__sfx.cues()`), and the map that keeps the
 * wiring honest when a new moment appears in the game.
 */
export const CUE_NOTES: Record<Cue, string> = {
  hover: "fingertip on oiled walnut — a control noticed, 16 ms of air",
  click: "a brass key settling — every button, tab and chip",
  tab: "a drawer sliding one bay — Market / Bank / Plant / Feed, Map / Build / Economy",
  select: "a soft thud — a gem picked up, a tool armed, a tycoon chosen",
  pick: "the bounty chooser spending one unit; rises a semitone per tap",
  swap: "a soft thud as the gem settles into its new slot — two gems traded",
  open: "a panel swinging up — Help, the rival dossier, the final ledger",
  close: "the same panel settling shut",
  pop: "a bright glass chime — one gem matched; climbs the pentatonic ladder with each combo, like the cargo chute paying out",
  crack: "ice splitting under a boot — a frozen gem or a girder cracked",
  up: "a token stamped up a grade",
  boom: "a charge going off behind a door — a bomb, or sabotage landing across the map",
  combo: "a hand bell rung once — the CHAIN x2 / COMBO x3!! callout, brighter per tier",
  deny: "a palm flat on the ledger — a refusal, a bad swap, a toast that says no",
  place: "a shovel patting earth down — dirt road laid, one pat per tile of the drag",
  pave: "gravel dressed and rolled — a paved Road laid or a dirt tile upgraded",
  build: "a heavy crate set down and latched — Factory, Depot or Processing Plant raised",
  demolish: "timber coming apart — a building or a road torn up",
  harvest: "the chute pays out — cargo landed in the purse",
  coin: "two gold coins touching — Gold from a combo or a gold mine",
  star: "a small brass bell — a Victory Point earned",
  wire: "a telegraph key and a sheet of paper — Torvin's private wire opens",
  victory: "the final ledger, won: a warm four-note cadence under a soft pad",
  defeat: "the final ledger, lost: the same cadence descending, muted, no fail horn",
};

export interface CueOptions {
  /** Scales every layer of the cue (0.7 = a little further away). */
  gain?: number;
  /**
   * A caller-supplied count the recipe may use: tiles laid by a drag, the
   * tier of a chain callout, the units spent so far. Ignored by cues that
   * have no use for it.
   */
  step?: number;
}

/** What a recipe gets: where to connect, when to start, and the two builders. */
interface Voice {
  out: AudioNode;
  t0: number;
  tone(spec: ToneSpec): void;
  noise(spec: NoiseSpec): void;
}

interface Recipe {
  /** Shortest gap between two of this cue, ms. */
  gap: number;
  run(v: Voice, step: number): void;
}

const semi = (freq: number, steps: number) => freq * Math.pow(2, steps / 12);

// ── streaks: the ladder a cascade climbs ────────────────────────────────────
const streaks = new Map<string, { at: number; n: number }>();
const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * How far into its own run this moment is: 0 for the first hit, +1 for each
 * further hit inside `windowMs`, capped at `max`, and back to 0 after a pause.
 */
function streak(key: string, windowMs: number, max: number): number {
  const t = clock();
  const prev = streaks.get(key);
  const n = prev && t - prev.at < windowMs ? Math.min(max, prev.n + 1) : 0;
  streaks.set(key, { at: t, n });
  return n;
}

/** Read a streak without advancing it (the docs/debug console, and tests). */
export function peekStreak(key: string): number {
  return streaks.get(key)?.n ?? 0;
}

/** A major pentatonic on A — the ladder the board climbs. No note in it can
 *  clash with any other, which is why a random cascade still sounds composed. */
const LADDER = [440, 493.88, 587.33, 659.25, 783.99, 880, 987.77, 1174.66, 1318.51];
const rung = (i: number) => LADDER[Math.min(LADDER.length - 1, Math.max(0, i))];

// ── the catalogue ───────────────────────────────────────────────────────────
const RECIPES: Record<Cue, Recipe> = {
  // A hover is the quietest thing in the game: mostly air, a whisper of pitch.
  // The random grain (engine) and the ±40 cents of jitter keep a mouse dragged
  // along a row of buttons from sounding like one stuck note.
  hover: {
    gap: 55,
    run: (v) => {
      const jitter = (Math.random() * 2 - 1) * 40;
      v.noise({ dur: 0.016, gain: 0.035, filter: "bandpass", freq: 2600, q: 1.1 });
      v.tone({ freq: semi(1760, jitter / 100), gain: 0.012, attack: 0.001, decay: 0.022 });
    },
  },

  // The workhorse: a wooden body falling a fifth, plus the brass tick on top.
  click: {
    gap: 30,
    run: (v) => {
      v.noise({ dur: 0.012, gain: 0.05, filter: "bandpass", freq: 1900, q: 0.9 });
      v.tone({ freq: 300, to: 190, type: "triangle", gain: 0.15, attack: 0.002, decay: 0.075 });
      v.tone({ freq: 640, to: 500, gain: 0.045, attack: 0.001, decay: 0.04 });
    },
  },

  // Tabs and views slide rather than knock — mostly the noise, almost no body.
  tab: {
    gap: 55,
    run: (v) => {
      v.noise({ dur: 0.07, gain: 0.042, attack: 0.008, filter: "bandpass", freq: 1250, to: 620, q: 0.8 });
      v.tone({ freq: 392, gain: 0.026, attack: 0.004, decay: 0.09 });
    },
  },

  // Something picked up: a SOFT THUD. The player asked the gem pickup to be
  // muffled and gentle rather than a bright ping, so this is a low damped
  // knock in the cloth — no glass, no brassy ring. `step` still transposes it
  // so the tool bar and the portrait picker say "this one, then that one".
  select: {
    gap: 30,
    run: (v, step) => {
      const f = semi(196, step);
      v.tone({ freq: f, to: f * 0.55, type: "sine", gain: 0.05, attack: 0.004, decay: 0.13 });
      v.noise({ dur: 0.035, gain: 0.03, attack: 0.004, filter: "lowpass", freq: 420 });
    },
  },

  // The cross bounty chooser: one unit spent. Its own cue (rather than
  // `select`) so the six taps of a holy cross climb the ladder and the panel
  // audibly fills up.
  pick: {
    gap: 45,
    run: (v) => {
      const n = streak("pick", 900, 7);
      const f = rung(n);
      v.tone({ freq: f, type: "triangle", gain: 0.075, attack: 0.002, decay: 0.14 });
      v.tone({ freq: f * 2, gain: 0.02, attack: 0.002, decay: 0.07 });
    },
  },

  // Two gems traded: the SAME SOFT THUD as the pickup, a touch lower and with
  // a little downward settle so the gesture reads as "moved" — still a thud,
  // deliberately not a knock or a swoosh.
  swap: {
    gap: 60,
    run: (v) => {
      v.tone({ freq: 165, to: 120, type: "sine", gain: 0.045, attack: 0.005, decay: 0.16 });
      v.noise({ dur: 0.045, gain: 0.03, attack: 0.006, filter: "lowpass", freq: 360, to: 220 });
    },
  },

  // A panel swinging up: two notes rising, a fifth apart, with air behind them.
  open: {
    gap: 110,
    run: (v) => {
      v.tone({ freq: 329.63, type: "triangle", gain: 0.05, attack: 0.014, decay: 0.22 });
      v.tone({ freq: 493.88, type: "triangle", gain: 0.042, at: 0.055, attack: 0.014, decay: 0.26 });
      v.noise({ dur: 0.13, gain: 0.012, attack: 0.03, filter: "bandpass", freq: 1700, to: 900, q: 0.7 });
    },
  },

  // …and settling shut: the same pair coming down, softer and shorter.
  close: {
    gap: 110,
    run: (v) => {
      v.tone({ freq: 493.88, type: "triangle", gain: 0.038, attack: 0.01, decay: 0.17 });
      v.tone({ freq: 329.63, type: "triangle", gain: 0.032, at: 0.05, attack: 0.01, decay: 0.22 });
      v.noise({ dur: 0.09, gain: 0.01, attack: 0.02, filter: "bandpass", freq: 900, to: 500, q: 0.7 });
    },
  },

  // The board's heartbeat: A BRIGHT GLASS CHIME. A match is no longer the
  // wooden "marble in a box" — the player wanted it bright and rising with the
  // combos, like the cargo chute paying out a resource. Short, bright, and
  // climbing: a nine-gem cascade climbs the pentatonic ladder (the same one
  // `harvest`/`coin` sit on), so each combo rings a little higher, and it is
  // the single most "sensory" thing in the mix.
  pop: {
    gap: 38,
    run: (v) => {
      const n = streak("pop", 650, LADDER.length - 1);
      const f = rung(n);
      v.tone({ freq: f, type: "sine", gain: 0.1, attack: 0.0015, decay: 0.16 });
      v.tone({ freq: f * 2, type: "sine", gain: 0.05, attack: 0.002, decay: 0.11 });
      v.tone({ freq: f * 3, type: "triangle", gain: 0.022, attack: 0.004, decay: 0.07 });
      v.noise({ dur: 0.008, gain: 0.014, attack: 0.001, filter: "highpass", freq: 6000 });
    },
  },

  // Ice or iron giving way: a bright splinter over a low thump.
  crack: {
    gap: 55,
    run: (v) => {
      v.noise({ dur: 0.045, gain: 0.085, attack: 0.001, filter: "bandpass", freq: 2800, q: 2.2 });
      v.noise({ dur: 0.02, gain: 0.04, at: 0.03, filter: "bandpass", freq: 4300, q: 2.6 });
      v.tone({ freq: 190, to: 120, gain: 0.05, attack: 0.002, decay: 0.07 });
    },
  },

  // A token stamped up a grade: one note bending up, no transient.
  up: {
    gap: 80,
    run: (v) => {
      v.tone({ freq: 523.25, to: 784, sweep: "linear", gain: 0.055, attack: 0.008, decay: 0.16 });
    },
  },

  // A bomb — behind a door, not in the room. Low, soft, over in 300 ms.
  boom: {
    gap: 90,
    run: (v) => {
      v.tone({ freq: 112, to: 44, gain: 0.16, attack: 0.004, decay: 0.3 });
      v.noise({ dur: 0.17, gain: 0.055, attack: 0.004, filter: "lowpass", freq: 720, to: 200 });
    },
  },

  // The CHAIN / COMBO callout: a hand bell, brighter per tier.
  combo: {
    gap: 150,
    run: (v, step) => {
      const f = semi(659.25, Math.min(9, Math.max(0, step)) * 2);
      v.tone({ freq: f, gain: 0.07, attack: 0.003, decay: 0.4 });
      v.tone({ freq: f * 2, gain: 0.022, attack: 0.004, decay: 0.22 });
      v.tone({ freq: f / 2, type: "triangle", gain: 0.028, attack: 0.008, decay: 0.3 });
    },
  },

  // A refusal. Deliberately NOT a buzzer: two muted knocks a minor second
  // apart read as "no" without reading as "you failed", and 200 ms of gap
  // keeps a row of bad toasts from turning into a drum roll.
  deny: {
    gap: 200,
    run: (v) => {
      v.tone({ freq: 165, to: 120, gain: 0.085, attack: 0.003, decay: 0.14 });
      v.tone({ freq: 121, gain: 0.05, at: 0.045, attack: 0.004, decay: 0.11 });
      v.noise({ dur: 0.028, gain: 0.03, attack: 0.002, filter: "lowpass", freq: 900 });
    },
  },

  // Dirt road laid. `step` is the drag's tile count: a long line gets two
  // extra pats behind the first, falling away, so laying six tiles reads as
  // one gesture rather than one sound.
  place: {
    gap: 40,
    run: (v, step) => {
      const pat = (at: number, gain: number, freq: number) => {
        v.noise({ dur: 0.05, gain, at, attack: 0.002, filter: "lowpass", freq: 1150 });
        v.tone({ freq, to: freq * 0.72, gain: gain * 1.6, at, attack: 0.002, decay: 0.1 });
      };
      pat(0, 0.07, 178);
      if (step > 1) pat(0.05, 0.04, 190);
      if (step > 3) pat(0.1, 0.024, 205);
    },
  },

  // Gravel dressed and rolled: the same pat, brighter, with a trowel ring.
  pave: {
    gap: 40,
    run: (v, step) => {
      v.noise({ dur: 0.07, gain: 0.06, attack: 0.002, filter: "bandpass", freq: 1800, to: 900, q: 0.7 });
      v.tone({ freq: 210, to: 150, gain: 0.08, attack: 0.002, decay: 0.11 });
      v.tone({ freq: 1180, type: "triangle", gain: 0.026, at: 0.01, attack: 0.006, decay: 0.22 });
      v.tone({ freq: 1760, gain: 0.012, at: 0.012, attack: 0.008, decay: 0.18 });
      if (step > 2) v.noise({ dur: 0.05, gain: 0.024, at: 0.07, filter: "bandpass", freq: 1500, q: 0.7 });
    },
  },

  // A building raised: the heaviest thing the player does, and still under
  // 350 ms — a crate set down, dust, then the brass latch.
  build: {
    gap: 110,
    run: (v) => {
      v.tone({ freq: 98, to: 68, gain: 0.14, attack: 0.004, decay: 0.3 });
      v.noise({ dur: 0.09, gain: 0.065, attack: 0.003, filter: "lowpass", freq: 820 });
      v.tone({ freq: 392, type: "triangle", gain: 0.034, at: 0.05, attack: 0.008, decay: 0.3 });
      v.tone({ freq: 588, gain: 0.016, at: 0.055, attack: 0.01, decay: 0.26 });
    },
  },

  // Timber coming apart: a long crumble with three splinters in it.
  demolish: {
    gap: 130,
    run: (v) => {
      v.noise({ dur: 0.22, gain: 0.07, attack: 0.004, filter: "bandpass", freq: 1400, to: 380, q: 0.7 });
      v.tone({ freq: 150, to: 88, gain: 0.09, attack: 0.003, decay: 0.22 });
      for (const [at, gain] of [[0.05, 0.03], [0.095, 0.024], [0.15, 0.018]] as const) {
        v.noise({ dur: 0.02, gain, at, filter: "bandpass", freq: 2600, q: 2 });
      }
    },
  },

  // Cargo landing in the purse: three quiet rungs up.
  harvest: {
    gap: 240,
    run: (v) => {
      const notes = [587.33, 739.99, 880];
      notes.forEach((f, i) => {
        v.tone({ freq: f, gain: 0.045 - i * 0.005, at: i * 0.06, attack: 0.006, decay: 0.2 });
      });
    },
  },

  // Gold: two coins touching, then the shimmer of the second one.
  coin: {
    gap: 110,
    run: (v) => {
      v.tone({ freq: 1046.5, gain: 0.05, attack: 0.002, decay: 0.18 });
      v.tone({ freq: 1568, gain: 0.038, at: 0.045, attack: 0.002, decay: 0.28 });
      v.tone({ freq: 2093, gain: 0.011, at: 0.05, attack: 0.004, decay: 0.2 });
    },
  },

  // A Victory Point: one small brass bell, once. Long tail, no transient —
  // the star is the reward, so it is allowed to ring.
  star: {
    gap: 280,
    run: (v) => {
      v.tone({ freq: 1318.5, gain: 0.042, attack: 0.005, decay: 0.5 });
      v.tone({ freq: 1975.5, gain: 0.016, attack: 0.008, decay: 0.42 });
      v.tone({ freq: 659.25, type: "triangle", gain: 0.02, attack: 0.012, decay: 0.35 });
    },
  },

  // Torvin's private wire: two telegraph clicks and the paper behind them.
  wire: {
    gap: 420,
    run: (v) => {
      for (const at of [0, 0.075]) {
        v.noise({ dur: 0.012, gain: 0.05, at, filter: "bandpass", freq: 3200, q: 2 });
        v.tone({ freq: 900, gain: 0.02, at, attack: 0.001, decay: 0.03 });
      }
      v.noise({ dur: 0.16, gain: 0.012, at: 0.02, attack: 0.03, filter: "highpass", freq: 5200 });
    },
  },

  // The final ledger, won. A soft pad under a four-note cadence that lands on
  // the tonic an octave up — 1.8 s, and then the room is quiet again.
  victory: {
    gap: 900,
    run: (v) => {
      for (const f of [220, 277.18, 329.63]) {
        v.tone({ freq: f, gain: 0.042, attack: 0.22, hold: 0.5, decay: 0.9, detune: (Math.random() * 2 - 1) * 5 });
      }
      [392, 493.88, 587.33, 783.99].forEach((f, i) => {
        v.tone({ freq: f, type: "triangle", gain: 0.05, at: i * 0.16, attack: 0.012, decay: 0.55 + i * 0.12 });
      });
      v.tone({ freq: 1567.98, gain: 0.018, at: 0.66, attack: 0.01, decay: 1.1 });
    },
  },

  // …and lost. The same shape descending, a fifth lower, with a room tone
  // under it. No fail horn: the ending card is already sombre enough.
  defeat: {
    gap: 900,
    run: (v) => {
      for (const f of [174.61, 207.65, 261.63]) {
        v.tone({ freq: f, gain: 0.036, attack: 0.26, hold: 0.45, decay: 1.1 });
      }
      [349.23, 311.13, 261.63].forEach((f, i) => {
        v.tone({ freq: f, type: "triangle", gain: 0.042, at: i * 0.28, attack: 0.014, decay: 0.7 });
      });
      v.tone({ freq: 87.31, gain: 0.03, attack: 0.3, hold: 0.6, decay: 1.2 });
    },
  },
};

function makeVoice(out: AudioNode, t0: number, scale: number): Voice {
  return {
    out,
    t0,
    tone: (spec) => { tone(out, t0, { ...spec, gain: (spec.gain ?? 0.05) * scale }); },
    noise: (spec) => { noiseBurst(out, t0, { ...spec, gain: (spec.gain ?? 0.04) * scale }); },
  };
}

/**
 * Play one cue. The single gated entry point:
 *
 *   muted  → nothing is even created (no AudioContext, no nodes);
 *   not yet armed by a real gesture → nothing (autoplay policy, rule 3);
 *   inside this cue's own gap → nothing (the throttle);
 *   the mix already full → nothing (the voice budget).
 *
 * Never throws: sound is garnish, and garnish must never break the board.
 */
export function playCue(cue: Cue, opts: CueOptions = {}): void {
  try {
    if (!isAudioEnabled()) { countRefused(); return; }
    if (!isArmed()) { countRefused(); return; }
    const recipe = RECIPES[cue];
    if (!recipe) return;
    if (!gate(cue, recipe.gap)) return;      // `gate` counted it
    const b = bus();
    if (!b) { countRefused(); return; }
    const scale = Number.isFinite(opts.gain ?? 1) ? Math.max(0, opts.gain ?? 1) : 1;
    if (scale <= 0) return;
    // 1 ms of lookahead: scheduling at exactly `currentTime` can land a hair
    // late on a busy frame, which reads as a fluffed transient.
    recipe.run(makeVoice(b.out, b.ctx.currentTime + 0.001, scale), Math.max(0, Math.floor(opts.step ?? 0)));
    countPlay();
  } catch {
    // garnish must never break the board
  }
}
