// ══════════════════════════════════════════════════════════════════════════
// SFX-1 (#463) — the recorded samples behind the cue catalogue.
//
// The lead recorded 25 one-shots (`assets/sfx/*.mp3`, shipped into the build
// beside `assets/voice/`). This module owns the fetch, the decode and the
// cache; `cues.ts` owns the decision: a cue whose buffer is already decoded
// plays the recording through `engine.sample()`, and anything else — a file
// that is missing, still loading, or undecodable, and every headless run —
// falls back to the cue's synth recipe, silently.
//
// Three rules, inherited from the bus:
//   1. NOTHING IS EVER AWAITED. Loads are fire-and-forget: the first play of
//      a cue is the synth (it also kicks the load), and every play after the
//      decode lands is the recording. Sound is garnish; garnish never blocks.
//   2. FAILURE IS A SYNTH, NOT AN ERROR. A 404, a refused fetch, a missing
//      `decodeAudioData` (the unit tests' fakes have none) all land in the
//      same place: the buffer stays absent and the recipe plays. No throw, no
//      console spam — a missing file falls back silently, per the ticket.
//   3. NOTHING LOADS BEFORE THE PLAYER TOUCHES THE PAGE. `prewarmSamples()`
//      runs from `sfx.unlock()` (a real gesture), and the lazy `request()`
//      only ever runs from inside `playCue`, which has already passed the
//      armed + enabled gates. Headless suites stay silent AND fetchless.
// ══════════════════════════════════════════════════════════════════════════
import { bus } from "./engine";

/**
 * Every cue with a recording, and the file behind it. The names are the lead's
 * (`assets/sfx/<file>.mp3`); the table is explicit rather than `${cue}.mp3`
 * so a renamed file breaks loudly here instead of silently falling back.
 */
export const SAMPLE_FILES: Readonly<Record<string, string>> = Object.freeze({
  "build": "build",
  "place": "place",
  "pave": "pave",
  "demolish": "demolish",
  "deny": "deny",
  "harvest": "harvest",
  "coin": "coin",
  "star": "star",
  "city-upgrade": "city-upgrade",
  "boom": "boom",
  "truck-horn": "truck-horn",
  "train-whistle": "train-whistle",
  "victory": "victory",
  "defeat": "defeat",
  "battle-start": "battle-start",
  "battle-turn": "battle-turn",
  "battle-hit": "battle-hit",
  "battle-damage": "battle-damage",
  "battle-bomb": "battle-bomb",
  "battle-mana": "battle-mana",
  "battle-ability": "battle-ability",
  "battle-extra-turn": "battle-extra-turn",
  "battle-frost": "battle-frost",
  "battle-win": "battle-win",
  "battle-lose": "battle-lose",
});

/** True when the cue has a recording on disk to try for. */
export function hasSample(cue: string): boolean {
  return Object.prototype.hasOwnProperty.call(SAMPLE_FILES, cue);
}

function baseUrl(): string {
  try {
    const b = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL;
    if (typeof b === "string" && b.length) return b.endsWith("/") ? b : `${b}/`;
  } catch { /* a bare node import has no Vite env */ }
  return "/";
}

/** Where the recording lives: beside index.html in dev, preview and deploy. */
export function sfxSampleUrl(cue: string, base = baseUrl()): string | null {
  const file = SAMPLE_FILES[cue];
  if (!file) return null;
  const root = base.endsWith("/") ? base : `${base}/`;
  return `${root}assets/sfx/${file}.mp3`;
}

// ── the cache ─────────────────────────────────────────────────────────────
// Absent = never tried (or a failed attempt that may be retried by an
// explicit `prewarmSamples()`); null = tried and failed this session, do not
// fetch again; a buffer = decoded and ready.
const cache = new Map<string, AudioBuffer | null>();
const flying = new Set<string>();

/** A decoded buffer for the cue, or null when there is none (yet). Synchronous. */
export function sampleBuffer(cue: string): AudioBuffer | null {
  return cache.get(cue) ?? null;
}

/** Forget everything (a test seam; production never needs it). */
export function clearSamples(): void {
  cache.clear();
  flying.clear();
}

/**
 * Test seam: put a buffer straight into the cache, so the "plays the sample"
 * path is exercisable without a network or a decoder.
 */
export function injectSample(cue: string, buffer: AudioBuffer): void {
  cache.set(cue, buffer);
}

/**
 * Fetch + decode one MP3 into a buffer. Shared by the one-shots here and the
 * ambience loops (`src/audio/ambience.ts`): both want "a buffer or null, and
 * never a throw". A caller that cannot even decode (the unit tests' fakes)
 * fails closed before touching the network.
 */
export async function fetchAudioBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
  try {
    if (!ctx || typeof ctx.decodeAudioData !== "function") return null;
    if (typeof fetch !== "function") return null;
    let res: Response;
    try {
      res = await fetch(url, { cache: "force-cache" });
    } catch {
      return null;
    }
    if (!res || res.ok !== true) return null;
    let bytes: ArrayBuffer;
    try {
      bytes = await res.arrayBuffer();
    } catch {
      return null;
    }
    try {
      const decoded = await new Promise<AudioBuffer | null>((resolve) => {
        // Promise form (every modern engine) with the callback form as the
        // fallback (older Safari) — and a `null` either way on failure.
        try {
          const out = (ctx.decodeAudioData as unknown as (
            bytes: ArrayBuffer,
            ok?: (b: AudioBuffer) => void,
            bad?: () => void,
          ) => Promise<AudioBuffer> | void).call(ctx, bytes,
            (b) => resolve(b ?? null),
            () => resolve(null));
          if (out && typeof (out as Promise<AudioBuffer>).then === "function") {
            (out as Promise<AudioBuffer>).then(
              (b) => resolve(b ?? null),
              () => resolve(null),
            );
          }
        } catch {
          resolve(null);
        }
      });
      return decoded && (decoded as AudioBuffer).duration > 0 ? (decoded as AudioBuffer) : null;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Kick a cue's load (fire-and-forget). Called from inside `playCue`, so the
 * armed + enabled gates have already passed. Never throws, never rejects —
 * the promise is always caught, and a failure just leaves the synth in place.
 */
export function requestSample(cue: string): void {
  try {
    if (!hasSample(cue)) return;
    if (cache.has(cue) || flying.has(cue)) return;
    const b = bus();
    const ctx = b?.ctx ?? null;
    // No context (node, jsdom's default) or no decoder (the tests' fakes):
    // stay on the synth without touching the network.
    if (!ctx || typeof (ctx as AudioContext).decodeAudioData !== "function") return;
    const url = sfxSampleUrl(cue);
    if (!url) return;
    if (typeof fetch !== "function") return;
    flying.add(cue);
    void fetchAudioBuffer(ctx, url).then(
      (buf) => {
        flying.delete(cue);
        // `null` is remembered too: a 404 is not worth re-fetching every play.
        cache.set(cue, buf);
      },
      () => {
        flying.delete(cue);
        cache.set(cue, null);
      },
    );
  } catch {
    flying.delete(cue);
  }
}

/**
 * Fetch + decode every recording, in the background. Called from
 * `sfx.unlock()` — the first real gesture — so by the second bar of play the
 * whole catalogue is recordings. ~580 KB total; each load fails silently and
 * independently onto its synth recipe.
 */
export function prewarmSamples(): void {
  try {
    for (const cue of Object.keys(SAMPLE_FILES)) requestSample(cue);
  } catch {
    /* garnish */
  }
}
