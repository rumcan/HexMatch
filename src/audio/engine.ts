// ══════════════════════════════════════════════════════════════════════════
// SFX-01 — the sound bus.
//
// One AudioContext, one master gain, one soft limiter, and the two synthesis
// primitives every cue in `cues.ts` is built from: a TONE (an oscillator with
// an envelope and an optional pitch sweep) and a NOISE burst (white noise
// through a swept filter). Nothing in here knows what a "click" or a "shovel
// in gravel" sounds like — that is the catalogue's job.
//
// Three rules the whole audio layer lives by, inherited from PP-14's choir:
//
//   1. SYNTHESISED, NOT RECORDED. No asset to ship, no decode to wait for, no
//      404, no audio pipeline in the build. A cue is a dozen lines of
//      oscillator maths, which is also why the mix can be tuned in a diff.
//   2. GARNISH MUST NEVER BREAK THE BOARD. Every entry point is wrapped, and
//      every OPTIONAL node (limiter, filter, noise buffer, detune) is
//      feature-detected rather than assumed. A browser, a jsdom fake or a
//      private-browsing block that offers only part of the Web Audio API
//      degrades to a simpler sound or to silence — never to a thrown error.
//   3. NOTHING SOUNDS BEFORE THE PLAYER TOUCHES THE PAGE. Autoplay policy
//      wants a gesture anyway: `unlock()` records one, and `sfx.play()`
//      refuses until it has. A background tab never bleeps to itself, and a
//      headless suite (where every event is synthetic, `isTrusted === false`)
//      never hears anything at all.
//
// Randomness here is `Math.random`, never the simulation's `rng()` — a sound
// must not be able to move a dice roll the game depends on (the same rule
// `rivalry.ts` keeps for its flavour text).
// ══════════════════════════════════════════════════════════════════════════

/** Where the mute/volume choice is remembered, beside `hexmatch:save`. */
export const AUDIO_STORAGE_KEY = "hexmatch:audio";

/**
 * The mix ceiling. Every cue's peak gain is written against THIS number, so
 * the whole HUD sits at "you notice it because it is pleasant, not because it
 * is loud". Raising it makes everything louder at once; that is the knob.
 */
export const DEFAULT_VOLUME = 0.55;

/**
 * How many sounding LAYERS may overlap. A cue is 1–6 layers, so this is roughly
 * "four things at once" — a cascade, a toast and a hover can share the mix,
 * and the fifth waits its turn instead of clipping. Pruned by END TIME (not by
 * `onended`, which a stubbed context never fires), so the budget can never
 * leak and silently mute the game.
 */
export const MAX_VOICES = 18;

export interface AudioSettings {
  enabled: boolean;
  volume: number;
}

/**
 * The window as the audio layer sees it. `AudioContext` is a global constructor
 * in lib.dom rather than a `Window` member (only `window: Window & typeof
 * globalThis` makes `window.AudioContext` typecheck), and Safari's prefix lives
 * nowhere in the lib at all — so both are read through one honest shape.
 */
type AudioWindow = {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let settings: AudioSettings | null = null;
/** True once a REAL (trusted) user gesture has been seen. Rule 3. */
let armed = false;
/** End times (ms, `performance.now()` clock) of the layers currently sounding. */
let voices: number[] = [];
/** Counters for `sfx.stats()` — the debug console and the unit tests read them. */
const counters = { played: 0, throttled: 0, refused: 0, layers: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// ── settings ────────────────────────────────────────────────────────────────

/**
 * `?sound=0` (also `off` / `mute` / `false`) boots silenced without writing
 * anything to storage — the flag e2e and CI use so a test run never depends on
 * a stranger's saved preference, and the flag a player can bookmark.
 */
function urlSilenced(): boolean {
  try {
    if (typeof location === "undefined") return false;
    const q = new URLSearchParams(location.search);
    const v = q.get("sound") ?? q.get("sfx");
    return v !== null && ["0", "off", "mute", "false", "no"].includes(v.toLowerCase());
  } catch {
    return false;
  }
}

function readSettings(): AudioSettings {
  const fallback: AudioSettings = { enabled: !urlSilenced(), volume: DEFAULT_VOLUME };
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(AUDIO_STORAGE_KEY) : null;
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    const volume = typeof parsed.volume === "number" && Number.isFinite(parsed.volume)
      ? clamp(parsed.volume, 0, 1)
      : DEFAULT_VOLUME;
    const enabled = typeof parsed.enabled === "boolean" ? parsed.enabled : true;
    // A remembered "on" still bows to the URL flag: `?sound=0` means silent.
    return { enabled: enabled && !urlSilenced(), volume };
  } catch {
    return fallback;
  }
}

function current(): AudioSettings {
  settings ??= readSettings();
  return settings;
}

function persist(): void {
  try {
    if (typeof localStorage !== "undefined" && settings) {
      localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(settings));
    }
  } catch {
    /* private mode: the choice simply does not survive the reload */
  }
}

export function audioSettings(): AudioSettings {
  const s = current();
  return { enabled: s.enabled, volume: s.volume };
}

export function isAudioEnabled(): boolean {
  return current().enabled;
}

export function audioVolume(): number {
  return current().volume;
}

/** Master gain the bus sits at right now: 0 when muted, else the volume. */
export function effectiveGain(): number {
  const s = current();
  return s.enabled ? s.volume : 0;
}

export function setAudioEnabled(on: boolean): void {
  current().enabled = on;
  persist();
  applyGain();
  if (on) unlock();          // unmuting is itself the gesture that may start the ctx
}

export function setAudioVolume(v: number): void {
  current().volume = clamp(Number.isFinite(v) ? v : DEFAULT_VOLUME, 0, 1);
  persist();
  applyGain();
}

export function toggleAudio(): boolean {
  setAudioEnabled(!isAudioEnabled());
  return isAudioEnabled();
}

function applyGain(): void {
  try {
    if (master && ctx) {
      const g = effectiveGain();
      // A 12 ms ramp instead of a jump: muting mid-cue otherwise clicks.
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(g, ctx.currentTime + 0.012);
    }
  } catch {
    /* garnish */
  }
}

// ── the bus ─────────────────────────────────────────────────────────────────

/**
 * Rule 3's gate. Called from a REAL gesture (the delegation in `sfx.ts` checks
 * `isTrusted` before it gets here), so creating/resuming the context is always
 * inside user interaction and never fights the autoplay policy.
 */
export function unlock(): void {
  armed = true;
  try {
    const b = bus();
    if (b && b.ctx.state === "suspended") void b.ctx.resume().catch(() => {});
  } catch {
    /* garnish */
  }
}

export function isArmed(): boolean {
  return armed;
}

/**
 * The shared graph: `master → limiter → destination`. Every cue — and PP-14's
 * choir — connects into `out`, which is what makes ONE mute button and ONE
 * volume quiet the whole game.
 *
 * Returns null where there is no Web Audio at all (jsdom, a hardened browser),
 * and every optional node is feature-detected so a partial implementation (the
 * unit tests' two-node fake) still gets a working, quieter bus.
 */
export function bus(): { ctx: AudioContext; out: AudioNode } | null {
  try {
    if (typeof window === "undefined") return null;
    const w = window as unknown as AudioWindow;
    const AC = w.AudioContext ?? w.webkitAudioContext
      ?? (typeof AudioContext !== "undefined" ? AudioContext : undefined);
    if (!AC) return null;
    // Locals, not the module fields: TS narrows `c` through the build below,
    // while a module-level `let` is re-widened to `| null` at every read.
    let c = ctx;
    let m = master;
    if (!c || !m) {
      c = new AC();
      m = c.createGain();
      m.gain.value = effectiveGain();
      m.connect(limiter(c) ?? c.destination);
      ctx = c;
      master = m;
    }
    return { ctx: c, out: m };
  } catch {
    ctx = null;
    master = null;
    return null;
  }
}

/**
 * A gentle limiter, not a compressor pump: the cues are already quiet, but a
 * nine-gem cascade stacks six of them inside 40 ms and it is the SUM that
 * would otherwise crackle. Feature-detected — a stubbed context gets
 * `master → destination` and simply runs a little hotter.
 */
function limiter(c: AudioContext): AudioNode | null {
  try {
    if (typeof c.createDynamicsCompressor !== "function") return null;
    const comp = c.createDynamicsCompressor();
    const set = (p: AudioParam | undefined, v: number) => {
      try { if (p) p.value = v; } catch { /* read-only in some engines */ }
    };
    set(comp.threshold, -20);
    set(comp.knee, 14);
    set(comp.ratio, 3.5);
    set(comp.attack, 0.004);
    set(comp.release, 0.2);
    comp.connect(c.destination);
    return comp;
  } catch {
    return null;
  }
}

/** Half a second of white noise, built once per context and reused by every burst. */
function noiseBuffer(c: AudioContext): AudioBuffer | null {
  try {
    if (noise) return noise;
    if (typeof c.createBuffer !== "function") return null;
    const rate = c.sampleRate && Number.isFinite(c.sampleRate) ? c.sampleRate : 44100;
    const len = Math.max(1024, Math.floor(rate * 0.5));
    const buf = c.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    // 4 ms of fade at each end so a looped grain can never click at the seam.
    const fade = Math.min(256, Math.floor(rate * 0.004));
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      data[i] *= k;
      data[len - 1 - i] *= k;
    }
    noise = buf;
    return noise;
  } catch {
    return null;
  }
}

// ── voice budget + throttling ───────────────────────────────────────────────

/** Prune finished layers, then take one slot. False = the mix is full. */
function takeVoice(untilMs: number): boolean {
  const t = now();
  voices = voices.filter((end) => end > t);
  if (voices.length >= MAX_VOICES) return false;
  voices.push(untilMs);
  counters.layers++;
  return true;
}

/** How many layers are sounding right now. */
export function liveVoices(): number {
  const t = now();
  voices = voices.filter((end) => end > t);
  return voices.length;
}

export function audioStats(): { played: number; throttled: number; refused: number; layers: number; live: number } {
  return { ...counters, live: liveVoices() };
}

export function countPlay(): void { counters.played++; }
export function countThrottled(): void { counters.throttled++; }
export function countRefused(): void { counters.refused++; }

/**
 * Per-cue cooldown, in the `performance.now()` clock. A hover tick every 60 ms
 * reads as a pleasant rattle; every 4 ms reads as a buzz. Returns false (and
 * counts it) when the cue is still inside its own gap.
 */
const lastAt = new Map<string, number>();
export function gate(key: string, gapMs: number): boolean {
  const t = now();
  const prev = lastAt.get(key);
  if (prev !== undefined && t - prev < gapMs) {
    counters.throttled++;
    return false;
  }
  lastAt.set(key, t);
  return true;
}

// ── the two primitives ──────────────────────────────────────────────────────

export interface ToneSpec {
  /** Start frequency, Hz. */
  freq: number;
  /** Optional sweep target (exponential by default — pitch reads as natural). */
  to?: number;
  sweep?: "exp" | "linear";
  type?: OscillatorType;
  /** Peak amplitude at the bus, 0..1. Cues stay in the 0.01–0.16 band. */
  gain?: number;
  /** Seconds. */
  at?: number;
  attack?: number;
  hold?: number;
  decay?: number;
  detune?: number;
}

export interface NoiseSpec {
  /** Peak amplitude at the bus, 0..1. */
  gain?: number;
  /** Seconds. */
  at?: number;
  dur?: number;
  attack?: number;
  filter?: BiquadFilterType;
  freq?: number;
  to?: number;
  q?: number;
}

/**
 * One enveloped oscillator. Returns the layer's length in ms so the caller can
 * price it against the voice budget; 0 when it could not be built.
 */
export function tone(out: AudioNode, t0: number, spec: ToneSpec): number {
  const c = contextOf(out);
  if (!c) return 0;
  const attack = Math.max(0.0006, spec.attack ?? 0.004);
  const hold = Math.max(0, spec.hold ?? 0);
  const decay = Math.max(0.008, spec.decay ?? 0.12);
  const t = t0 + Math.max(0, spec.at ?? 0);
  const dur = attack + hold + decay;
  if (!takeVoice(now() + (dur + 0.03) * 1000)) return 0;
  try {
    const o = c.createOscillator();
    o.type = spec.type ?? "sine";
    const f0 = Math.max(1, spec.freq);
    o.frequency.setValueAtTime(f0, t);
    if (spec.to && spec.to > 0 && spec.to !== f0) {
      const f1 = Math.max(1, spec.to);
      if ((spec.sweep ?? "exp") === "linear") o.frequency.linearRampToValueAtTime(f1, t + dur);
      else o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    }
    if (spec.detune && o.detune) {
      try { o.detune.setValueAtTime(spec.detune, t); } catch { /* not all engines */ }
    }
    const g = c.createGain();
    envelope(g.gain, t, Math.max(0.0002, spec.gain ?? 0.05), attack, hold, decay);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
    release(o, g);
    return dur * 1000;
  } catch {
    return 0;
  }
}

/**
 * One burst of filtered noise — the transient that makes a tone read as wood,
 * felt, paper or gravel instead of as a test signal. Falls back to silence
 * (not to an unfiltered blast) where the context cannot make a buffer.
 */
export function noiseBurst(out: AudioNode, t0: number, spec: NoiseSpec): number {
  const c = contextOf(out);
  if (!c) return 0;
  const buf = noiseBuffer(c);
  if (!buf || typeof c.createBufferSource !== "function") return 0;
  const attack = Math.max(0.0006, spec.attack ?? 0.002);
  const dur = Math.max(0.006, spec.dur ?? 0.05);
  const t = t0 + Math.max(0, spec.at ?? 0);
  if (!takeVoice(now() + (attack + dur + 0.03) * 1000)) return 0;
  try {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // A random rate and a random read offset: two hovers are never the same
    // grain, which is most of why the tick does not fatigue.
    if (src.playbackRate) {
      try { src.playbackRate.setValueAtTime(0.85 + Math.random() * 0.35, t); } catch { /* fixed rate */ }
    }
    const g = c.createGain();
    envelope(g.gain, t, Math.max(0.0002, spec.gain ?? 0.04), attack, 0, dur);
    const filter = typeof c.createBiquadFilter === "function" ? c.createBiquadFilter() : null;
    if (filter) {
      filter.type = spec.filter ?? "bandpass";
      const f0 = Math.max(20, spec.freq ?? 1400);
      filter.frequency.setValueAtTime(f0, t);
      if (spec.to && spec.to > 0 && spec.to !== f0) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(20, spec.to), t + attack + dur);
      }
      if (spec.q !== undefined && filter.Q) {
        try { filter.Q.setValueAtTime(spec.q, t); } catch { /* fixed Q */ }
      }
      src.connect(filter);
      filter.connect(g);
    } else {
      src.connect(g);
    }
    g.connect(out);
    const offset = Math.random() * Math.max(0.01, buf.duration - dur - attack - 0.02);
    src.start(t, offset);
    src.stop(t + attack + dur + 0.02);
    release(src, filter ?? null, g);
    return (attack + dur) * 1000;
  } catch {
    return 0;
  }
}

/** The AudioContext a node belongs to (`ctx` in every engine we support). */
function contextOf(node: AudioNode): AudioContext | null {
  try {
    const c = (node as unknown as { context?: AudioContext }).context;
    return c ?? ctx;
  } catch {
    return ctx;
  }
}

/** The standard AD-ish envelope: silence → peak → exponential tail. */
function envelope(
  param: AudioParam, t: number, peak: number,
  attack: number, hold: number, decay: number,
): void {
  const floor = 0.0001;
  param.setValueAtTime(floor, t);
  param.linearRampToValueAtTime(peak, t + attack);
  if (hold > 0) param.setValueAtTime(peak, t + attack + hold);
  param.exponentialRampToValueAtTime(floor, t + attack + hold + decay);
}

/**
 * Disconnect a finished layer so a long session cannot accumulate dead nodes.
 * The source owns `onended`; everything else is only reachable through it.
 */
function release(
  source: AudioScheduledSourceNode, ...rest: (AudioNode | null)[]
): void {
  try {
    source.onended = () => {
      for (const n of [source, ...rest]) {
        try { n?.disconnect(); } catch { /* already gone */ }
      }
    };
  } catch {
    /* a stubbed source with no onended simply never disconnects */
  }
}
