// ══════════════════════════════════════════════════════════════════════════
// MATCH-2 — the board's cues: the ASMR swap, the settle, the match, the
// cascade, the two star flourishes and the finale music.
//
// THE ASSET CONTRACT (the lead's mp3s, in `assets/sfx/`):
//
//   swap_contact_{1..4}   two stones touching — the clack
//   swap_roll_{1..3}      the roll past each other after the contact
//   settle_{1..4}         a stone landing after a fall
//   match_{1..3}          a run clearing — the stones cracking apart
//   cascade_{1..3}        the shimmer over a cascade pass, depth 2, 3, 4+
//   star_4                the 4★ flourish        star_5   the 5★ flourish
//   finale                the music over the 5★ finale (a PD recording)
//
// Every cue is REGISTERED with a synth recipe: the file wins when its buffer
// is decoded, the recipe voices the moment when the file is missing, still
// loading, or the suite is headless. Variants are picked at random (never
// the same one twice running) with ±cents of pitch jitter — a sample plays
// at that rate, a recipe transposes every layer by it — so a ten-move
// session never hears one sound twice. The gap per cue and the bus's voice
// budget are the two quietness rules; a cue asked for inside its gap or in a
// full mix is dropped, never queued.
//
// TIMING. `at` schedules a cue on the AUDIO clock, seconds ahead: the swap
// is voiced when its phase STARTS with the contact clack `at` the contact
// frame (`SwapPhase.contactAt × beat`) and the roll right after it; the
// settle is scheduled `at` the landing frame of the fall. That is what
// "hook the sound at the exact contact frame" means here — not "fire it from
// the animation loop and hope the frame was on time".
//
// Randomness in this file is `Math.random` only. Never the simulation's RNG.
// ══════════════════════════════════════════════════════════════════════════

import {
  audioStats,
  bus,
  countPlay,
  countRefused,
  countThrottled,
  isArmed,
  isAudioEnabled,
  noiseBurst,
  sampleVoice,
  tone,
  type NoiseSpec,
  type ToneSpec,
} from "../audio/engine";
import type { Board } from "./board";

export const MATCH3_CUE_NAMES = ["m3_hover", "swap_contact", "swap_roll", "settle", "match", "cascade", "star_4", "star_5", "finale"] as const;
export type Match3Cue = (typeof MATCH3_CUE_NAMES)[number];

export interface CueVoice {
  tone(spec: ToneSpec): void;
  noise(spec: NoiseSpec): void;
}

export interface Match3CueDef {
  /** The recordings, in the contract's names (no extension). */
  files: string[];
  /** Shortest time between two of this cue, ms. */
  gap: number;
  /** ± pitch jitter, cents. */
  jitterCents: number;
  /** Peak gain scale for the whole cue (the mix ceiling is the bus's). */
  gain: number;
  /** Long-form: takes one voice and can be stopped (the finale). */
  music?: boolean;
  /** Pick the variant by `step` (a depth), not at random: files[step - 2]. */
  byStep?: boolean;
  /** One line on what the moment is. */
  note: string;
  synth: (v: CueVoice, step: number) => void;
}

export interface CueOptions {
  gain?: number;
  /** Cascade depth, landing count, star tier — whatever the cue climbs on. */
  step?: number;
  /** Seconds ahead on the audio clock (the contact frame, the landing frame). */
  at?: number;
}

export interface CuePlay {
  cue: Match3Cue;
  source: "sample" | "synth" | "dropped";
  variant: string | null;
  /** The pitch ratio the play was jittered by (1 = as written). */
  pitch: number;
  /** Seconds ahead it was scheduled. */
  at: number;
  reason?: "muted" | "unarmed" | "gap" | "budget" | "nobus";
}

/** The pentatonic ladder the cascade climbs (E5 root). */
const LADDER = [659.25, 739.99, 830.61, 987.77, 1108.73, 1318.51, 1479.98, 1661.22, 1975.53];

// ── the catalogue ──────────────────────────────────────────────────────────
export const MATCH3_CUES: Record<Match3Cue, Match3CueDef> = {
  // Air and a whisper of pitch: a stone the pointer passed over.
  m3_hover: {
    files: [],
    gap: 55,
    jitterCents: 60,
    gain: 0.7,
    note: "fingertip over a stone — a light tick, 16 ms of air",
    synth: (v) => {
      v.noise({ dur: 0.014, gain: 0.03, filter: "bandpass", freq: 2400, q: 1.2 });
      v.tone({ freq: 1560, gain: 0.01, attack: 0.001, decay: 0.02 });
    },
  },
  // Two walnuts meeting in the hand: a hard, dry, woody knock with a short
  // resonant body, then nothing. This is the contact frame.
  swap_contact: {
    files: ["swap_contact_1", "swap_contact_2", "swap_contact_3", "swap_contact_4"],
    gap: 40,
    jitterCents: 90,
    gain: 1,
    note: "two stones touch — the wenwan walnut clack, at the contact frame",
    synth: (v) => {
      v.noise({ dur: 0.012, gain: 0.09, attack: 0.0006, filter: "bandpass", freq: 3100, q: 1.6 });
      v.tone({ freq: 1180, to: 760, type: "triangle", gain: 0.06, attack: 0.001, decay: 0.045 });
      v.tone({ freq: 420, to: 300, type: "sine", gain: 0.055, attack: 0.001, decay: 0.07 });
      v.noise({ dur: 0.03, gain: 0.025, at: 0.008, attack: 0.004, filter: "lowpass", freq: 900 });
    },
  },
  // The roll past each other: a grainy rub falling in pitch, no attack.
  swap_roll: {
    files: ["swap_roll_1", "swap_roll_2", "swap_roll_3"],
    gap: 40,
    jitterCents: 70,
    gain: 0.8,
    note: "the two stones roll past each other — a grainy rub after the clack",
    synth: (v) => {
      v.noise({ dur: 0.075, gain: 0.03, attack: 0.012, filter: "bandpass", freq: 1500, to: 620, q: 0.9 });
      v.tone({ freq: 240, to: 170, type: "sine", gain: 0.022, attack: 0.01, decay: 0.08 });
    },
  },
  // A stone landing on felt over a wooden tray: a soft low knock. `step` is
  // how many landed in that column; heavier falls thud a little lower.
  settle: {
    files: ["settle_1", "settle_2", "settle_3", "settle_4"],
    gap: 22,
    jitterCents: 120,
    gain: 0.75,
    note: "a stone lands after a fall — a soft felt knock, pitch-varied per column",
    synth: (v, step) => {
      const f = 210 - Math.min(4, step) * 14;
      v.tone({ freq: f, to: f * 0.62, type: "sine", gain: 0.05, attack: 0.002, decay: 0.09 });
      v.noise({ dur: 0.02, gain: 0.03, attack: 0.001, filter: "lowpass", freq: 700 });
    },
  },
  // The board's payoff: a bright glass chime with a wooden knock under it.
  match: {
    files: ["match_1", "match_2", "match_3"],
    gap: 45,
    jitterCents: 40,
    gain: 1,
    note: "a run clears — glass over wood",
    synth: (v) => {
      const f = LADDER[0];
      v.tone({ freq: f, type: "sine", gain: 0.09, attack: 0.0015, decay: 0.16 });
      v.tone({ freq: f * 2, type: "sine", gain: 0.04, attack: 0.002, decay: 0.1 });
      v.tone({ freq: 300, to: 200, type: "triangle", gain: 0.04, attack: 0.002, decay: 0.06 });
      v.noise({ dur: 0.008, gain: 0.014, filter: "highpass", freq: 5500 });
    },
  },
  // A cascade pass: an airy shimmer over the board that grows with the depth.
  // Deliberately NOT pitched — the per-gem pop in src/audio/cues.ts already
  // climbs its pentatonic ladder, and two ladders at once would be mush.
  cascade: {
    files: ["cascade_1", "cascade_2", "cascade_3"],
    gap: 60,
    jitterCents: 30,
    gain: 0.8,
    byStep: true,
    note: "a cascade pass — a rising shimmer of air and glints, bigger at every depth",
    synth: (v, step) => {
      const d = Math.min(3, Math.max(1, step - 1));
      v.noise({ dur: 0.12 + d * 0.05, gain: 0.012 + d * 0.006, attack: 0.03, filter: "highpass", freq: 3600, to: 6400 });
      for (let i = 0; i < 2 + d; i++) {
        v.tone({ freq: 3200 + i * 470, gain: 0.006 + d * 0.002, at: 0.02 + i * 0.03, attack: 0.002, decay: 0.09 });
      }
    },
  },
  // Four stars: a small brass bell, twice, rising.
  star_4: {
    files: ["star_4"],
    gap: 800,
    jitterCents: 0,
    gain: 1,
    note: "the 4★ flourish — two brass bells rising, no music",
    synth: (v) => {
      [987.77, 1318.51].forEach((f, i) => {
        v.tone({ freq: f, gain: 0.05, at: i * 0.12, attack: 0.004, decay: 0.45 });
        v.tone({ freq: f * 1.5, gain: 0.016, at: i * 0.12 + 0.01, attack: 0.006, decay: 0.3 });
      });
    },
  },
  // Five stars: a four-note fanfare on the bells, with a pad under it.
  star_5: {
    files: ["star_5"],
    gap: 800,
    jitterCents: 0,
    gain: 1,
    note: "the 5★ flourish — a four-bell fanfare over a soft pad",
    synth: (v) => {
      for (const f of [261.63, 329.63, 392]) v.tone({ freq: f, gain: 0.03, attack: 0.15, hold: 0.4, decay: 0.8 });
      [783.99, 987.77, 1174.66, 1567.98].forEach((f, i) => {
        v.tone({ freq: f, type: "triangle", gain: 0.055, at: i * 0.11, attack: 0.006, decay: 0.5 + i * 0.1 });
        v.tone({ freq: f * 2, gain: 0.014, at: i * 0.11 + 0.01, attack: 0.008, decay: 0.3 });
      });
    },
  },
  // The finale music. The file is the lead's public-domain recording; the
  // fallback hums the first phrase of the Ode to Joy (public domain, 1824)
  // on a soft triangle choir with a bass under it — nine seconds, then quiet.
  finale: {
    files: ["finale"],
    gap: 4000,
    jitterCents: 0,
    gain: 0.9,
    music: true,
    note: "the finale music — assets/sfx/finale.mp3, or the Ode to Joy hummed",
    synth: (v) => {
      // E E F G | G F E D | C C D E | E. D D
      const E = 329.63, F = 349.23, G = 392, D = 293.66, C = 261.63;
      const line: [number, number][] = [
        [E, 1], [E, 1], [F, 1], [G, 1], [G, 1], [F, 1], [E, 1], [D, 1], [C, 1], [C, 1], [D, 1], [E, 1], [E, 1.5], [D, 0.5], [D, 2],
      ];
      const beat = 0.42;
      let t = 0;
      for (const [f, len] of line) {
        const dur = beat * len;
        v.tone({ freq: f, type: "triangle", gain: 0.06, at: t, attack: 0.03, hold: dur * 0.6, decay: dur * 0.5 });
        v.tone({ freq: f * 2, type: "sine", gain: 0.012, at: t + 0.01, attack: 0.03, hold: dur * 0.5, decay: dur * 0.4 });
        t += dur;
      }
      // a bass line, one note a bar
      const bass = [C / 2, G / 4, C / 2, G / 4];
      bass.forEach((f, i) => v.tone({ freq: f, type: "sine", gain: 0.045, at: i * beat * 4, attack: 0.08, hold: beat * 2.6, decay: beat * 1.2 }));
      v.tone({ freq: C / 2, type: "sine", gain: 0.05, at: beat * 16, attack: 0.1, hold: beat * 1.5, decay: 1.4 });
    },
  },
};

// ── recordings ─────────────────────────────────────────────────────────────
function defaultBase(): string {
  try {
    const b = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL;
    if (typeof b === "string" && b.length) return `${b.endsWith("/") ? b : `${b}/`}assets/sfx`;
  } catch { /* a bare node import has no Vite env */ }
  return "/assets/sfx";
}
let sampleBase = defaultBase();
const buffers = new Map<string, AudioBuffer | "missing" | "loading">();

/** Where the mp3s live (the demo serves them from /assets/sfx). */
export function setSampleBase(base: string): void {
  sampleBase = base.replace(/\/$/, "");
}

export function sampleState(file: string): "ready" | "missing" | "loading" | "unknown" {
  const s = buffers.get(file);
  if (!s) return "unknown";
  if (s === "missing" || s === "loading") return s;
  return "ready";
}

/** Kick the load of one recording. Never throws; a miss is remembered. */
export function requestSample(file: string): void {
  if (buffers.has(file)) return;
  buffers.set(file, "loading");
  try {
    const b = bus();
    if (!b || typeof fetch !== "function") {
      buffers.set(file, "missing");
      return;
    }
    fetch(`${sampleBase}/${file}.mp3`)
      .then((res) => {
        if (!res.ok || !/audio|octet/.test(res.headers.get("content-type") ?? "audio")) throw new Error("no file");
        return res.arrayBuffer();
      })
      .then((data) => b.ctx.decodeAudioData(data.slice(0)))
      .then((buf) => buffers.set(file, buf))
      .catch(() => buffers.set(file, "missing"));
  } catch {
    buffers.set(file, "missing");
  }
}

/** Ask for every recording in the catalogue (call after the first gesture). */
export function preloadMatch3Samples(): void {
  for (const def of Object.values(MATCH3_CUES)) for (const f of def.files) requestSample(f);
}

// ── the gap, on the SCHEDULED time ─────────────────────────────────────────
// The bus's `gate` compares call times; a fall schedules its four settles in
// one tick for the landing frame, 28 ms apart on the audio clock, so the gap
// is measured where the sound lands, not where it was asked for.
const lastScheduled = new Map<string, number>();
const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function gateScheduled(key: string, gapMs: number, atMs: number): boolean {
  const t = clock() + Math.max(0, atMs);
  const prev = lastScheduled.get(key);
  if (prev !== undefined && Math.abs(t - prev) < gapMs) {
    countThrottled();
    return false;
  }
  lastScheduled.set(key, t);
  return true;
}

// ── variants and jitter ────────────────────────────────────────────────────
const lastVariant = new Map<Match3Cue, number>();

/** A random variant index, never the one played last (when there is a choice). */
export function pickVariant(cue: Match3Cue, count: number, random: () => number = Math.random): number {
  if (count <= 1) return 0;
  const prev = lastVariant.get(cue);
  let idx = Math.floor(random() * count);
  if (idx === prev) idx = (idx + 1 + Math.floor(random() * (count - 1))) % count;
  lastVariant.set(cue, idx);
  return idx;
}

/** A pitch ratio jittered by ±`cents`. */
export function jitterPitch(cents: number, random: () => number = Math.random): number {
  if (cents <= 0) return 1;
  return Math.pow(2, ((random() * 2 - 1) * cents) / 1200);
}

// ── listeners (the hooks log, the tests) ───────────────────────────────────
const listeners = new Set<(play: CuePlay) => void>();
export function onMatch3Cue(fn: (play: CuePlay) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(play: CuePlay): CuePlay {
  for (const fn of listeners) {
    try {
      fn(play);
    } catch {
      /* a listener must not break the board */
    }
  }
  return play;
}

let musicStop: ((fadeSec?: number) => void) | null = null;

/** Fade the finale music out (a new session, a closed results card). */
export function stopFinaleMusic(fadeSec = 0.6): void {
  try {
    musicStop?.(fadeSec);
  } catch {
    /* garnish */
  }
  musicStop = null;
}

/**
 * Play one cue. Gated like every cue in the game: muted → nothing, not yet
 * armed by a gesture → nothing, inside its gap → nothing, mix full → the
 * bus refuses the layers. Reports what it did for the log and the tests.
 */
export function playMatch3Cue(cue: Match3Cue, opts: CueOptions = {}): CuePlay {
  const def = MATCH3_CUES[cue];
  const at = Math.max(0, opts.at ?? 0);
  const drop = (reason: CuePlay["reason"]): CuePlay => emit({ cue, source: "dropped", variant: null, pitch: 1, at, reason });
  try {
    if (!def) return drop("nobus");
    if (!isAudioEnabled()) {
      countRefused();
      return drop("muted");
    }
    if (!isArmed()) {
      countRefused();
      return drop("unarmed");
    }
    if (!gateScheduled(`m3:${cue}`, def.gap, at * 1000)) return drop("gap");
    const b = bus();
    if (!b) {
      countRefused();
      return drop("nobus");
    }
    const scale = def.gain * (Number.isFinite(opts.gain ?? 1) ? Math.max(0, opts.gain ?? 1) : 1);
    const pitch = jitterPitch(def.jitterCents);
    const step = Math.max(0, Math.floor(opts.step ?? 0));
    const t0 = b.ctx.currentTime + 0.001 + at;
    const variant = !def.files.length ? null
      : def.byStep ? def.files[Math.min(def.files.length - 1, Math.max(0, step - 2))]
      : def.files[pickVariant(cue, def.files.length)];

    if (variant) {
      const state = buffers.get(variant);
      if (state && state !== "missing" && state !== "loading") {
        const played = sampleVoice(b.out, t0, state, scale, pitch);
        if (played) {
          if (def.music) {
            stopFinaleMusic();
            musicStop = played.stop;
          }
          countPlay();
          return emit({ cue, source: "sample", variant, pitch, at });
        }
        return drop("budget");
      }
      if (!state) requestSample(variant);
    }

    let layers = 0;
    const v: CueVoice = {
      tone: (spec) => {
        const ms = tone(b.out, t0, { ...spec, freq: spec.freq * pitch, to: spec.to ? spec.to * pitch : undefined, gain: (spec.gain ?? 0.05) * scale });
        if (ms > 0) layers++;
      },
      noise: (spec) => {
        const ms = noiseBurst(b.out, t0, { ...spec, gain: (spec.gain ?? 0.04) * scale });
        if (ms > 0) layers++;
      },
    };
    def.synth(v, step);
    if (layers === 0) return drop("budget");
    countPlay();
    if (def.music) {
      stopFinaleMusic();
      musicStop = null; // the synth phrase is short and ends on its own
    }
    return emit({ cue, source: "synth", variant: null, pitch, at });
  } catch {
    return drop("nobus");
  }
}

export function match3AudioStats(): ReturnType<typeof audioStats> {
  return audioStats();
}

// ── the phase → cue mapping ────────────────────────────────────────────────

/** How many settle knocks one fall may voice (the rest land in silence). */
export const MAX_SETTLE_VOICES = 4;

/**
 * Voice one board phase, given how long the beat runs in real ms. This is the
 * single place the animation moments meet the catalogue:
 *
 *   swap      contact clack AT the contact frame, the roll just after it;
 *   revert    the same contact (the stones still touch), no roll;
 *   clear     one match chime (cascade chime with the depth from 2 on);
 *   fall      up to four settles AT the landing frame, a few ms apart,
 *             pitch-varied by how far each column fell;
 *   bombClear a heavier match on the blast.
 */
export function voicePhase(phase: { type: string; contactAt?: number; chain?: number; moves?: { toR: number; fromR: number; c: number }[] }, beatMs: number): CuePlay[] {
  const out: CuePlay[] = [];
  const beat = Math.max(0, beatMs) / 1000;
  switch (phase.type) {
    case "swap":
    case "revert": {
      const contact = beat * (phase.contactAt ?? 0.5);
      out.push(playMatch3Cue("swap_contact", { at: contact }));
      if (phase.type === "swap") out.push(playMatch3Cue("swap_roll", { at: contact + 0.012, gain: 0.8 }));
      break;
    }
    case "clear": {
      const chain = phase.chain ?? 1;
      out.push(playMatch3Cue("match", { gain: Math.min(1.25, 0.85 + chain * 0.1) }));
      if (chain >= 2) out.push(playMatch3Cue("cascade", { step: chain }));
      break;
    }
    case "bombClear":
      out.push(playMatch3Cue("match", { gain: 1.3 }));
      out.push(playMatch3Cue("cascade", { step: 4, at: 0.06 }));
      break;
    case "fall":
    case "bombFall": {
      const moves = phase.moves ?? [];
      const byCol = new Map<number, number>();
      for (const m of moves) byCol.set(m.c, Math.max(byCol.get(m.c) ?? 0, m.toR - m.fromR));
      const cols = [...byCol.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_SETTLE_VOICES);
      cols.forEach(([, drop], i) => {
        out.push(playMatch3Cue("settle", { at: beat + i * 0.028, step: Math.min(4, drop), gain: 0.7 + Math.min(0.3, drop * 0.06) }));
      });
      break;
    }
    default:
      break;
  }
  return out;
}

/**
 * Voice a board: every phase it starts is voiced at its animation moment
 * (`voicePhase`). Chained onto `Board.onPhase`, so the chrome's own listener
 * (the stone turns) keeps running. Returns the unhook.
 */
export function attachBoardVoice(board: Board): () => void {
  const prev = board.onPhase;
  board.onPhase = (p, ms) => {
    prev(p, ms);
    try { voicePhase(p, ms); } catch { /* garnish */ }
  };
  return () => { board.onPhase = prev; };
}
