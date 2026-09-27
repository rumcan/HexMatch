// ══════════════════════════════════════════════════════════════════════════
// SFX-1 (#463) — ambience by zoom: the map's own room tone.
//
// Five looping beds, cross-faded by zoom and by what the camera sits over:
// sea near a coast, town murmur over towns, birds and wind in the
// countryside, distant traffic at the far zoom. The game feeds the probe
// (`setProbe`, from `commitCamera`); this module owns the mix and the loops.
//
// The beds WANT to be recordings (`assets/ambience/<bed>.mp3`, shipped into
// the build like `assets/sfx/` — see `assets/ambience/README.md` for the
// shopping list). Until the lead ships them, each bed bakes a procedural
// placeholder loop in code (shaped noise; chirps for the birds) — the same
// "synth as the fallback" rule the one-shots keep, so the mix is audible
// and tuneable today and the files simply take over when they land.
//
// Its place in the mix, per the ticket:
//   · UNDER THE RADIO — the bed ceilings below keep the loudest possible
//     ambience far under the radio's own level, and there is no route by
//     which it can get louder than that.
//   · DUCKED BY THE VOICE — `duck(on)`, hung off `onVoiceLine` by the game
//     exactly like the radio's, at the same 30% ratio.
//   · THE SOUND SWITCH COVERS EVERYTHING — the beds connect into the shared
//     bus (`engine.bus().out`), so mute and the master volume own them the
//     way they own every cue. `?sound=0` boots them silent.
//   · REDUCED MOTION snaps the cross-fades instead of gliding them (the
//     radio's own rule for its duck fade).
//   · HEADLESS RUNS ARE SILENT — no graph exists until a real gesture arms
//     the engine, and every entry point no-ops without Web Audio.
//
// Client-side only, like the radio: nothing on the wire, nothing in a save.
// ══════════════════════════════════════════════════════════════════════════
import { bus, isArmed, isAudioEnabled } from "./engine";
import { fetchAudioBuffer } from "./samples";

/** The five beds, in the order the debug probe lists them. */
export const AMBIENCE_BEDS = ["sea", "town", "birds", "wind", "traffic"] as const;
export type AmbienceBed = (typeof AMBIENCE_BEDS)[number];

export function isAmbienceBed(name: string): name is AmbienceBed {
  return (AMBIENCE_BEDS as readonly string[]).includes(name);
}

/** Where the player's own ambience volume lives. Beside `hexmatch:radio`. */
export const AMBIENCE_STORAGE_KEY = "hexmatch:ambience";

/** The shipped level: present, but unmistakably underneath everything else. */
export const DEFAULT_AMBIENCE_VOLUME = 0.5;

/** Ducking while a voice line speaks: 30% of the set volume (the radio's ratio). */
export const AMBIENCE_DUCK_RATIO = 0.3;

/**
 * The mix ceiling, per bed: absolute gain at the bus for a FULLY-weighted
 * bed at FULL ambience volume. The loudest the island can ever get is sea
 * 0.10 + wind 0.09 — a wash, not a soundtrack. Raise these and the whole
 * island gets louder at once; that is the knob.
 */
export const AMBIENCE_CEILINGS: Readonly<Record<AmbienceBed, number>> = Object.freeze({
  sea: 0.10,
  town: 0.08,
  birds: 0.14,   // sparse chirps in mostly silence — the peak may be taller
  wind: 0.09,
  traffic: 0.07,
});

/** How quickly one bed gives way to another (the setTarget time constant). */
export const AMBIENCE_FADE_S = 0.45;

/** Re-probes closer together than this are folded into one glide. */
export const AMBIENCE_APPLY_MS = 250;

/** A re-probe this small (every bed) is not worth a new glide. */
export const AMBIENCE_EPSILON = 0.05;

// ── the mix: pure, so the whole "follows zoom and position" contract is a test ──

export interface AmbienceProbe {
  /** The camera's zoom step (0.5 | 1 | 2 — but the curve is continuous). */
  zoom: number;
  /** Water within earshot of the camera's centre tile. */
  nearCoast: boolean;
  /** A town within earshot of the camera's centre tile. */
  nearTown: boolean;
}

export type AmbienceMix = Record<AmbienceBed, number>;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * What each bed weighs for this probe. Every weight is 0..1:
 *
 *   sea      near a coast, louder the closer the zoom (0.35 → 1)
 *   town     over a town, louder the closer the zoom (0.25 → 1)
 *   birds    countryside (neither coast nor town) at zoom 1+, full at 2
 *   wind     everywhere (0.3), more in the countryside (0.6), less at far zoom
 *   traffic  the far zoom's own bed (0.9 at 0.5, gone by 1)
 *
 * At the far zoom the island reads as one distant place (traffic + a little
 * wind); zoomed in, it reads as the place under the camera.
 */
export function ambienceMix(probe: AmbienceProbe): AmbienceMix {
  const zoom = Number.isFinite(probe.zoom) ? probe.zoom : 1;
  const nearCoast = probe.nearCoast === true;
  const nearTown = probe.nearTown === true;
  const countryside = !nearCoast && !nearTown;
  const far = zoom <= 0.5;
  const close = zoom >= 2;
  return {
    sea: nearCoast ? (close ? 1 : far ? 0.35 : 0.65) : 0,
    town: nearTown ? (close ? 1 : far ? 0.25 : 0.6) : 0,
    birds: countryside ? (close ? 1 : far ? 0 : 0.6) : 0,
    wind: (countryside ? 0.6 : 0.3) * (far ? 0.6 : 1),
    traffic: far ? 0.9 : 0,
  };
}

/** The absolute bus gain a bed sits at: weight × ceiling × volume × duck. */
export function ambienceBedGain(
  bed: AmbienceBed, weight: number, volume: number, ducked: boolean,
): number {
  const v = clamp01(Number.isFinite(volume) ? volume : DEFAULT_AMBIENCE_VOLUME);
  const w = clamp01(Number.isFinite(weight) ? weight : 0);
  return w * AMBIENCE_CEILINGS[bed] * v * (ducked ? AMBIENCE_DUCK_RATIO : 1);
}

// ── settings ─────────────────────────────────────────────────────────────

export interface AmbienceSettings {
  /** The player's own "Ambience" slider, 0..1. 0 is silent. */
  volume: number;
}

interface Memory {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function liveStore(): Memory | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readAmbienceSettings(storage: Memory | null): AmbienceSettings {
  const fallback: AmbienceSettings = { volume: DEFAULT_AMBIENCE_VOLUME };
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(AMBIENCE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AmbienceSettings>;
    return {
      volume: typeof parsed.volume === "number" && Number.isFinite(parsed.volume)
        ? clamp01(parsed.volume)
        : DEFAULT_AMBIENCE_VOLUME,
    };
  } catch {
    return fallback;
  }
}

export function writeAmbienceSettings(storage: Memory | null, s: AmbienceSettings): void {
  if (!storage) return;
  try {
    storage.setItem(AMBIENCE_STORAGE_KEY, JSON.stringify({ volume: s.volume }));
  } catch { /* private mode */ }
}

function baseUrl(): string {
  try {
    const b = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL;
    if (typeof b === "string" && b.length) return b.endsWith("/") ? b : `${b}/`;
  } catch { /* a bare node import has no Vite env */ }
  return "/";
}

/** Where a bed's recording will live once the lead ships it (today: 404 → placeholder). */
export function ambienceFileUrl(bed: AmbienceBed, base = baseUrl()): string {
  const root = base.endsWith("/") ? base : `${base}/`;
  return `${root}assets/ambience/${bed}.mp3`;
}

// ── the placeholder loops: baked procedural beds ──────────────────────────
// Each bakes a seamless loop into an AudioBuffer: shaped, slowly-breathing
// noise for sea/wind/traffic/town, sparse chirps on silence for birds. They
// are PLACEHOLDERS — pleasant enough to mix against, plainly not the real
// thing — and a shipped file replaces its bed wholesale the moment it
// decodes. `Math.random` only, never the simulation's rng: a sound must not
// move a dice roll (the audio layer's oldest rule).

/** Seconds of loop per bed. Longer loops repeat less audibly; each second is ~170 KB. */
const BED_SECONDS: Readonly<Record<AmbienceBed, number>> = Object.freeze({
  sea: 8, town: 6, birds: 12, wind: 8, traffic: 8,
});

/** One-pole lowpass over the data in place (alpha 1 = untouched white noise). */
function lowpass(data: Float32Array, alpha: number): void {
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    y += alpha * (data[i] - y);
    data[i] = y;
  }
}

/** Blend the tail into the head so the loop point never clicks. */
function seamless(data: Float32Array, sampleRate: number, tailS = 0.75): void {
  const tail = Math.min(data.length >> 2, Math.floor(sampleRate * tailS));
  if (tail < 8) return;
  const n = data.length;
  for (let i = 0; i < tail; i++) {
    const k = i / tail;                       // 0 at the loop start → 1 at its end
    data[n - tail + i] = data[n - tail + i] * (1 - k) + data[i] * k;
  }
}

function normalize(data: Float32Array, peak: number): void {
  let hi = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > hi) hi = a;
  }
  if (hi <= 0.0001) return;
  const k = peak / hi;
  for (let i = 0; i < data.length; i++) data[i] *= k;
}

/**
 * Bake one bed. Returns null where there is no buffer API (half an Audio
 * implementation) — the bed then stays silent rather than throwing.
 */
function bakeBed(ctx: AudioContext, bed: AmbienceBed): AudioBuffer | null {
  try {
    if (typeof ctx.createBuffer !== "function") return null;
    const rate = ctx.sampleRate && Number.isFinite(ctx.sampleRate) ? ctx.sampleRate : 44100;
    const seconds = BED_SECONDS[bed];
    const len = Math.max(1024, Math.floor(rate * seconds));
    const buf = ctx.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    if (bed === "birds") {
      // Silence with sparse chirps: each a sine gliding up a fifth, twice.
      for (let i = 0; i < data.length; i++) data[i] = 0;
      const chirps = 6 + Math.floor(Math.random() * 3);
      for (let c = 0; c < chirps; c++) {
        const at = Math.floor(Math.random() * (len - rate * 0.6));
        const f0 = 2400 + Math.random() * 900;
        const f1 = f0 * 1.5;
        const dur = Math.floor(rate * (0.09 + Math.random() * 0.06));
        const repeats = 1 + Math.floor(Math.random() * 2);
        for (let r = 0; r < repeats; r++) {
          const start = at + r * (dur + Math.floor(rate * 0.09));
          if (start + dur >= len) break;
          for (let i = 0; i < dur; i++) {
            const k = i / dur;
            const env = Math.sin(Math.PI * k);              // raised-cosine blip
            const f = f0 + (f1 - f0) * k;
            data[start + i] += Math.sin(2 * Math.PI * f * (i / rate)) * env * 0.5;
          }
        }
      }
      // A breath of air under the chirps so the bed never reads as digital zero.
      for (let i = 0; i < data.length; i++) data[i] += (Math.random() * 2 - 1) * 0.008;
      normalize(data, 0.5);
    } else {
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      // The material: sea is surf (dark wash), wind is air (darker, slower),
      // traffic is far-away rumble (darkest), town is a mid murmur wash.
      const alpha = bed === "sea" ? 0.09 : bed === "wind" ? 0.05 : bed === "traffic" ? 0.025 : 0.14;
      lowpass(data, alpha);
      // The breathing: two slow swells baked in, so the loop feels alive
      // without an LFO node per bed.
      const swell1 = 2 * Math.PI * (bed === "sea" ? 2 : 1) / len;
      const swell2 = 2 * Math.PI * (bed === "sea" ? 5 : 3) / len;
      const depth = bed === "town" ? 0.25 : 0.45;
      const phase = Math.random() * Math.PI * 2;
      for (let i = 0; i < len; i++) {
        const breathe = 1 - depth * 0.5
          + depth * 0.5 * Math.sin(i * swell1 + phase)
          + depth * 0.25 * Math.sin(i * swell2 + phase * 1.7);
        data[i] *= Math.max(0.15, breathe);
      }
      seamless(data, rate);
      normalize(data, bed === "traffic" ? 0.35 : bed === "town" ? 0.4 : 0.5);
    }
    return buf;
  } catch {
    return null;
  }
}

// ── the player ────────────────────────────────────────────────────────────

export interface Ambience {
  /** The saved choices. */
  readonly settings: AmbienceSettings;
  /** The last probe (null until the game feeds one). */
  readonly probe: AmbienceProbe | null;
  /** The last mix weights (all zero until the first probe, and after `stop()`). */
  levels(): AmbienceMix;
  /** The absolute bus gain each bed sits at right now (0 when stopped). */
  gains(): AmbienceMix;
  /** A new camera reading. Re-activates after `stop()`; throttled internally. */
  setProbe(probe: AmbienceProbe): void;
  /** Silence the island and drop the graph (quit to menu, dispose). */
  stop(): void;
  setVolume(v: number): void;
  /** A voice line started (`true`) or ended (`false`): duck and restore. */
  duck(on: boolean): void;
  /** Repaint on every settings change. Returns the unsubscribe. */
  register(painter: (settings: AmbienceSettings) => void): () => void;
  dispose(): void;
}

export interface AmbienceDeps {
  storage?: Memory | null;
  /** The OS "reduce motion" setting, read live. Default: matchMedia. */
  reducedMotion?: () => boolean;
}

const ZERO_MIX: AmbienceMix = Object.freeze({ sea: 0, town: 0, birds: 0, wind: 0, traffic: 0 });

const clockNow = (): number =>
  (typeof performance !== "undefined" ? performance.now() : Date.now());

function prefersReducedMotion(): boolean {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function createAmbience(deps: AmbienceDeps = {}): Ambience {
  const storage = deps.storage === undefined ? liveStore() : deps.storage;
  const reduced = deps.reducedMotion ?? prefersReducedMotion;
  let settings = readAmbienceSettings(storage);
  let probe: AmbienceProbe | null = null;
  let active = false;
  let ducked = false;
  let mix: AmbienceMix = { ...ZERO_MIX };
  let lastApplyAt = -1e15;
  let applied: AmbienceMix = { ...ZERO_MIX };
  let graph: {
    master: GainNode;
    beds: Partial<Record<AmbienceBed, { src: AudioBufferSourceNode; gain: GainNode }>>;
  } | null = null;
  // Decoded file loops (a shipped bed replaces its placeholder wholesale).
  const files = new Map<AmbienceBed, AudioBuffer>();
  const flyingFiles = new Set<AmbienceBed>();
  // Baked placeholders, one per context — rebaked if the bus is ever rebuilt.
  let bakedFor: AudioContext | null = null;
  const baked = new Map<AmbienceBed, AudioBuffer>();
  const painters = new Set<(s: AmbienceSettings) => void>();
  let disposed = false;

  function paint(): void {
    for (const painter of painters) {
      try { painter({ ...settings }); } catch { /* a bad painter is not a crash */ }
    }
  }

  function bufferFor(ctx: AudioContext, bed: AmbienceBed): AudioBuffer | null {
    const file = files.get(bed);
    if (file) return file;
    if (bakedFor !== ctx) {
      bakedFor = ctx;
      baked.clear();
    }
    let buf = baked.get(bed) ?? null;
    if (!buf) {
      buf = bakeBed(ctx, bed);
      if (buf) baked.set(bed, buf);
    }
    return buf;
  }

  /** Fetch the shipped loop for this bed, then swap it under the placeholder. */
  function requestFile(ctx: AudioContext, bed: AmbienceBed): void {
    try {
      if (files.has(bed) || flyingFiles.has(bed)) return;
      if (typeof fetch !== "function") return;
      flyingFiles.add(bed);
      void fetchAudioBuffer(ctx, ambienceFileUrl(bed)).then(
        (buf) => {
          flyingFiles.delete(bed);
          if (disposed || !buf) return;      // 404 today: the placeholder stands
          files.set(bed, buf);
          swapBed(bed, buf);
        },
        () => { flyingFiles.delete(bed); },
      );
    } catch {
      flyingFiles.delete(bed);
    }
  }

  /** Rebuild one bed's source under its live gain (a file just landed). */
  function swapBed(bed: AmbienceBed, buf: AudioBuffer): void {
    try {
      if (!graph || !active) return;
      const slot = graph.beds[bed];
      if (!slot) return;
      const ctx = slot.gain.context ?? null;
      if (!ctx || typeof ctx.createBufferSource !== "function") return;
      try { slot.src.stop(); } catch { /* already stopped */ }
      try { slot.src.disconnect(); } catch { /* a stub */ }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(slot.gain);
      try { src.start(); } catch { /* a stubbed source */ }
      slot.src = src;
    } catch { /* the placeholder keeps playing */ }
  }

  /**
   * Build the graph on first need. Returns false where there is no Web Audio
   * (jsdom, a hardened browser) — every caller treats that as "stay silent".
   * The loops are beds, not layers: they never touch the one-shot voice
   * budget, and they connect into the shared bus so one mute owns everything.
   */
  function ensureGraph(): boolean {
    if (graph) return true;
    const b = bus();
    if (!b) return false;
    const ctx = b.ctx;
    if (typeof ctx.createGain !== "function" || typeof ctx.createBufferSource !== "function") {
      return false;
    }
    try {
      const master = ctx.createGain();
      master.gain.value = masterGain();
      master.connect(b.out);
      graph = { master, beds: {} };
      for (const bed of AMBIENCE_BEDS) {
        const buf = bufferFor(ctx, bed);
        requestFile(ctx, bed);
        if (!buf) continue;                 // half an API: this bed stays silent
        const gain = ctx.createGain();
        gain.gain.value = 0;                 // beds fade UP into their first mix
        gain.connect(master);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.connect(gain);
        try { src.start(); } catch { /* a stubbed source */ }
        graph.beds[bed] = { src, gain };
      }
      return true;
    } catch {
      graph = null;
      return false;
    }
  }

  function masterGain(): number {
    const v = clamp01(settings.volume);
    return v * (ducked ? AMBIENCE_DUCK_RATIO : 1);
  }

  function pushMaster(): void {
    if (!graph) return;
    try {
      const t = graph.master.context?.currentTime ?? 0;
      const target = masterGain();
      if (reduced()) {
        graph.master.gain.cancelScheduledValues(t);
        graph.master.gain.setValueAtTime(target, t);
      } else {
        graph.master.gain.setTargetAtTime(target, t, 0.12);
      }
    } catch { /* garnish */ }
  }

  /** Glide (or snap, under reduced motion) every bed to its new weight. */
  function applyMix(force: boolean): void {
    if (!ensureGraph() || !graph) return;
    const now = clockNow();
    if (!force) {
      let biggest = 0;
      for (const bed of AMBIENCE_BEDS) {
        biggest = Math.max(biggest, Math.abs(mix[bed] - applied[bed]));
      }
      if (biggest < AMBIENCE_EPSILON) return;
      if (now - lastApplyAt < AMBIENCE_APPLY_MS) return;
    }
    lastApplyAt = now;
    applied = { ...mix };
    const snap = reduced();
    for (const bed of AMBIENCE_BEDS) {
      const slot = graph.beds[bed];
      if (!slot) continue;
      const target = mix[bed] * AMBIENCE_CEILINGS[bed];
      try {
        const t = slot.gain.context?.currentTime ?? 0;
        if (snap) {
          slot.gain.gain.cancelScheduledValues(t);
          slot.gain.gain.setValueAtTime(target, t);
        } else {
          slot.gain.gain.setTargetAtTime(target, t, AMBIENCE_FADE_S);
        }
      } catch { /* one dead bed is not a dead island */ }
    }
  }

  function teardown(): void {
    if (!graph) return;
    for (const bed of AMBIENCE_BEDS) {
      const slot = graph.beds[bed];
      if (!slot) continue;
      try { slot.src.stop(); } catch { /* already stopped */ }
      try { slot.src.disconnect(); } catch { /* a stub */ }
      try { slot.gain.disconnect(); } catch { /* a stub */ }
    }
    try { graph.master.disconnect(); } catch { /* a stub */ }
    graph = null;
  }

  return {
    get settings() { return { ...settings }; },
    get probe() { return probe ? { ...probe } : null; },
    levels() { return active ? { ...mix } : { ...ZERO_MIX }; },
    gains() {
      if (!active) return { ...ZERO_MIX };
      const out = { ...ZERO_MIX } as AmbienceMix;
      for (const bed of AMBIENCE_BEDS) {
        out[bed] = ambienceBedGain(bed, mix[bed], settings.volume, ducked);
      }
      return out;
    },
    setProbe(p) {
      if (disposed) return;
      try {
        probe = { zoom: p.zoom, nearCoast: p.nearCoast === true, nearTown: p.nearTown === true };
        mix = ambienceMix(probe);
        // Rule 3's gate, the ambience's own copy: nothing exists before a
        // real gesture, and nothing exists while muted — but the PROBE is
        // still remembered, so unmuting or the first tap lands in the right
        // mix instead of fading up from nowhere.
        if (!isArmed() || !isAudioEnabled()) return;
        active = true;
        applyMix(false);
      } catch { /* garnish */ }
    },
    stop() {
      active = false;
      mix = { ...ZERO_MIX };
      applied = { ...ZERO_MIX };
      try { teardown(); } catch { /* garnish */ }
    },
    setVolume(v) {
      settings = { volume: clamp01(Number.isFinite(v) ? v : DEFAULT_AMBIENCE_VOLUME) };
      writeAmbienceSettings(storage, settings);
      try { pushMaster(); } catch { /* garnish */ }
      paint();
    },
    duck(on) {
      const next = on === true;
      if (next === ducked) return;
      ducked = next;
      try { pushMaster(); } catch { /* garnish */ }
    },
    register(painter) {
      painters.add(painter);
      try { painter({ ...settings }); } catch { /* garnish */ }
      return () => { painters.delete(painter); };
    },
    dispose() {
      disposed = true;
      painters.clear();
      try { teardown(); } catch { /* garnish */ }
    },
  };
}

/**
 * The one island every game shares. It touches nothing until the first probe
 * after a real gesture: no nodes, no fetches, no baked buffers.
 */
export const ambience: Ambience = createAmbience();
