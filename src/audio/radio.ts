// ══════════════════════════════════════════════════════════════════════════
// MUSIC-1 (#377) — the mini radio in the corner. RADIO-2 (#432) adds the dial.
//
// One `<audio>` element, a list of stations, one small pill in the very top-right
// of the HUD. The owner supplies the stream (RADIO_STREAM_URL; was EMPTY until
// they do), so the module is written for the SHIPPED state — an empty or dead
// URL reads "Radio offline" and never throws, never blocks, never delays the
// game. Everything else is the ordinary browser rules:
//
//   1. NO AUTOPLAY, EVER. The element is `preload="none"` and the first
//      `play()` only ever happens inside a real tap on the pill (the browser
//      would refuse otherwise — and a soundtrack that starts by itself is a
//      bug even where it is allowed).
//   2. THE MACHINE IS PURE. `radioReduce(state, event)` is a value function
//      with no element, no timer and no DOM in it: off | idle | loading |
//      playing | paused | offline, plus the duck/visibility bookkeeping. The
//      HTMLAudioElement wiring is a thin adapter around it, which is what
//      makes the whole player testable in node.
//   3. GARNISH MUST NEVER BREAK THE BOARD. Every entry point is wrapped and
//      every optional capability (an Audio element, storage, `matchMedia`,
//      `document`) is feature-detected. A browser with no audio, a private
//      window with no storage and a dead stream all end in silence — never in
//      a thrown error.
//   4. ITS VOLUME IS ITS OWN. SFX, voice and radio are three separate knobs;
//      the radio also ducks to 30% while a voice line speaks (voice.ts's
//      `onVoiceLine` hook, wired by the game).
//
// Client-side only: nothing here goes on the wire (iso/snapshot.ts) or into a
// save (iso/savegame-runtime.ts). Guests and hosts each control their own.
// ══════════════════════════════════════════════════════════════════════════

import { isAudioEnabled } from "./engine";
import { registerSoundPainter } from "./sfx";

/**
 * RADIO-2 (#432) — the station list.
 *
 * Each entry is a public HTTPS stream the player's own browser opens. We do
 * not download, cache or rebroadcast audio. A station is listed only when its
 * published terms allow that playback inside a free web game, with the credit
 * shown on the chip and in Settings. The terms URL is repeated in
 * `docs/RADIO.md`.
 *
 * SomaFM's current terms forbid embedding in a game
 * (https://somafm.com/contact/tos.html — "Embedding the Content in any
 * website, application, or platform" needs prior written permission; their
 * direct-link pages say the URLs are not for video games). Secret Agent is
 * kept anyway because the ticket says this one stream stays. No other SomaFM
 * channel is added: the same terms cover every channel.
 *
 * Player-facing strings (name, genre, credit, licence) must not contain "//"
 * or "(#" — the settings sheet is scanned for developer comments.
 */
export interface RadioStation {
  id: string;
  name: string;
  /** Direct stream. HTTPS so a secure page is not blocked as mixed content. */
  url: string;
  genre: string;
  /** Short licence name, shown beside the credit. */
  licence: string;
  /** Terms or licence page. Not painted as raw text (it contains "//"). */
  termsUrl: string;
  /** Attribution line for the chip tooltip and the settings sheet. No URL. */
  credit: string;
}

export const RADIO_STATIONS: readonly RadioStation[] = Object.freeze([
  Object.freeze({
    id: "secret-agent",
    name: "SomaFM Secret Agent",
    // Kept by #432. Terms (embedding restricted): https://somafm.com/contact/tos.html
    url: "https://ice1.somafm.com/secretagent-128-mp3",
    genre: "1960s spy and lounge",
    licence: "SomaFM listener-supported stream",
    termsUrl: "https://somafm.com/contact/tos.html",
    credit: "Listener-supported radio from SomaFM. Credit SomaFM.",
  }),
  Object.freeze({
    id: "radionos-lounge",
    name: "RadioNOS Lounge",
    // Station policy (CC, public domain, or artist-authorized only):
    // https://radionos.com/site/sobre/  Stream published on the channel page.
    url: "https://nos.radio.br:443/stream/13/;",
    genre: "1950s-60s lounge, bossa and easy listening",
    licence: "CC, public domain, or artist-authorized",
    termsUrl: "https://radionos.com/site/sobre/",
    credit: "RadioNOS. Creative Commons, public-domain and artist-authorized music. Credit RadioNOS.",
  }),
  Object.freeze({
    id: "radionos-jazz",
    name: "RadioNOS Jazz",
    // Same RadioNOS policy: https://radionos.com/site/sobre/
    // Channel stream: https://radionos.com/site/jazz-channel/
    url: "https://nos.radio.br:443/stream/3/;",
    genre: "Jazz",
    licence: "CC, public domain, or artist-authorized",
    termsUrl: "https://radionos.com/site/sobre/",
    credit: "RadioNOS. Creative Commons, public-domain and artist-authorized music. Credit RadioNOS.",
  }),
  Object.freeze({
    id: "mdk-space",
    name: "MDK Space Radio",
    // Their own catalogue, CC BY 3.0: https://creativecommons.org/licenses/by/3.0/
    // Direct stream published at https://radio.mdkband.com/ (MP3 link).
    url: "https://radio.mdkband.com/stream.mp3",
    genre: "Space-age experimental",
    licence: "CC BY 3.0",
    termsUrl: "https://creativecommons.org/licenses/by/3.0/",
    credit: "Music by MDK. Creative Commons Attribution. Credit MDK.",
  }),
  Object.freeze({
    id: "dogmazic",
    name: "Radio Dogmazic",
    // Operator: play the music in a podcast or at a party, it is legal.
    // Licence table: https://www.dogmazic.net/licences.php
    // Direct stream published at https://radio.dogmazic.net/
    url: "https://radio.dogmazic.net:8001/stream.mp3",
    genre: "Free-licence mix",
    licence: "Free licences, credit the artist",
    termsUrl: "https://www.dogmazic.net/licences.php",
    credit: "Free-licence music from Dogmazic. Credit the artist.",
  }),
]);

/** The shipped default: SomaFM Secret Agent. An empty URL is still "Radio offline". */
export const RADIO_STREAM_URL = RADIO_STATIONS[0].url;

/** What the pill says when there is no now-playing metadata and no station list. */
export const RADIO_STATION_NAME = RADIO_STATIONS[0].name;

/** Where the on/off, show/hide and volume choices live. Beside `hexmatch:voice`. */
export const RADIO_STORAGE_KEY = "hexmatch:radio";

/** The chosen station id. Separate from RADIO_STORAGE_KEY so the three-field settings object stays as it was. */
export const RADIO_STATION_KEY = "hexmatch:radio-station";

/** The radio's own volume, 0..1. Quieter than the SFX bus by design. */
export const DEFAULT_RADIO_VOLUME = 0.5;

/** Ducking while a voice line speaks: 30% of the set volume. */
export const DUCK_RATIO = 0.3;

/** …over ~200 ms, so the duck reads as a dip and not as a cut. */
export const DUCK_FADE_MS = 200;

/** Retry schedule after a failure: 5 s, 10 s, 20 s, then every 30 s at most. */
export const RADIO_RETRY_MS: readonly number[] = [5_000, 10_000, 20_000];
export const RADIO_RETRY_CAP_MS = 30_000;

/** A stream that neither plays nor errors inside this window is a failure. */
export const RADIO_LOAD_TIMEOUT_MS = 12_000;

/** The one line the pill shows when the stream is not there. */
export const RADIO_OFFLINE_TEXT = "Radio offline";

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Is there a stream to open at all? An empty/whitespace URL is the shipped
 * state, and it is deliberately NOT a retryable failure: a URL that is not
 * configured will not configure itself by waiting 30 seconds.
 */
export function hasStream(url: string): boolean {
  return typeof url === "string" && url.trim().length > 0;
}

// ── the machine ────────────────────────────────────────────────────────────

/**
 *   off      the setting is off — stopped, disconnected, no element touched
 *   idle     on, but nothing has been asked for yet (the boot state)
 *   loading  the element is opening the stream (spinner)
 *   playing  audio is coming out
 *   paused   the player stopped it: a tap, or the tab going to the background
 *   offline  the stream refused, died or never answered ("Radio offline")
 */
export type RadioStatus = "off" | "idle" | "loading" | "playing" | "paused" | "offline";

export type RadioEvent =
  /** The settings switch came on. */
  | "enable"
  /** The settings switch went off: stop and release the connection. */
  | "disable"
  /** A tap on ▶ (or a resume): the user wants audio. */
  | "play"
  /** A tap on ⏸: the user wants quiet. */
  | "pause"
  /** The element said it is playing. */
  | "loaded"
  /** The element said it failed (or never answered inside the load window). */
  | "error"
  /** The backoff timer fired — try once more, if it is still wanted. */
  | "retry"
  /** `visibilitychange` → hidden: pause, and remember that it was playing. */
  | "hidden"
  /** `visibilitychange` → visible: resume, but only if it was playing. */
  | "visible"
  /** A voice line started: fade to 30%. */
  | "duckStart"
  /** The voice line ended: fade back. */
  | "duckEnd"
  /**
   * The player changed station (or failed over) while audio was wanted.
   * Loading again — never a way to start from idle. That would be autoplay.
   */
  | "tune";

export interface RadioMachine {
  status: RadioStatus;
  /** The settings switch ("Radio"). */
  enabled: boolean;
  /** The user wants audio and has not stopped it. Drives retries and resume. */
  want: boolean;
  /** The tab is in the background. */
  hidden: boolean;
  /** A voice line is speaking — the mixer sits at DUCK_RATIO. */
  ducked: boolean;
  /** Hidden while playing: `visible` must resume. Never set any other way. */
  resume: boolean;
  /** Failures in a row. Drives the backoff and resets on a real `loaded`. */
  failures: number;
}

export const RADIO_INITIAL: Readonly<RadioMachine> = Object.freeze({
  status: "idle" as RadioStatus,
  enabled: true,
  want: false,
  hidden: false,
  ducked: false,
  resume: false,
  failures: 0,
});

/** The boot state, with the settings switch applied. */
export function radioInit(enabled = true): RadioMachine {
  return { ...RADIO_INITIAL, enabled, status: enabled ? "idle" : "off" };
}

function same(a: RadioMachine, b: RadioMachine): boolean {
  return a.status === b.status && a.enabled === b.enabled && a.want === b.want
    && a.hidden === b.hidden && a.ducked === b.ducked && a.resume === b.resume
    && a.failures === b.failures;
}

/**
 * The whole player, as a value function. `url` is a parameter (not the module
 * constant) so the tests can drive a station that actually exists.
 */
export function radioReduce(state: RadioMachine, event: RadioEvent, url: string = RADIO_STREAM_URL): RadioMachine {
  const next = step(state, event, url);
  return same(state, next) ? state : next;
}

function step(s: RadioMachine, event: RadioEvent, url: string): RadioMachine {
  switch (event) {
    case "enable":
      // Coming back from off starts idle — it does NOT resume playing. The
      // switch is a connection, not a transport.
      return s.status === "off" ? { ...s, enabled: true, status: "idle", want: false } : { ...s, enabled: true };

    case "disable":
      // Stop and disconnect. `ducked`/`resume` go with it; `hidden` is the
      // browser's fact, not ours, so it survives.
      return { ...s, status: "off", enabled: false, want: false, ducked: false, resume: false, failures: 0 };

    case "play": {
      if (!s.enabled) return s;
      if (!hasStream(url)) {
        // Nothing to open. Offline, no retry, no throw — the shipped state
        // until the owner fills RADIO_STREAM_URL in.
        return { ...s, status: "offline", want: true, resume: false };
      }
      if (s.status === "loading" || s.status === "playing") return { ...s, want: true };
      // A manual play is a fresh start: the backoff count begins again.
      return { ...s, status: "loading", want: true, resume: false, failures: 0 };
    }

    case "pause":
      if (s.status === "off") return s;
      return {
        ...s,
        status: s.status === "playing" || s.status === "loading" ? "paused" : s.status,
        want: false,
        resume: false,
      };

    case "loaded":
      // The element is only allowed to promote a LOADING state that is still
      // wanted and on screen — a late `playing` from a stale load cannot
      // override a pause or a background tab.
      if (s.status !== "loading" || !s.want || s.hidden) return s;
      return { ...s, status: "playing", failures: 0, resume: false };

    case "error": {
      if (s.status !== "loading" && s.status !== "playing" && s.status !== "paused") return s;
      const counted = s.enabled && s.want;
      return { ...s, status: "offline", failures: counted ? s.failures + 1 : s.failures };
    }

    case "retry":
      if (s.status !== "offline" || !s.enabled || !s.want || s.hidden || !hasStream(url)) return s;
      return { ...s, status: "loading", resume: false };

    case "hidden":
      if (s.status === "playing" || s.status === "loading") {
        // `want` stays true: the player did not stop the radio, the browser
        // did, and `visible` is what brings it back.
        return { ...s, hidden: true, status: "paused", resume: true };
      }
      return { ...s, hidden: true };

    case "visible":
      if (!s.resume) return { ...s, hidden: false };
      if (!s.enabled || !hasStream(url)) return { ...s, hidden: false, resume: false };
      return { ...s, hidden: false, resume: false, status: "loading" };

    case "duckStart":
      return { ...s, ducked: true };

    case "duckEnd":
      return { ...s, ducked: false };

    case "tune":
      // A station change is a new load only when the player already asked for
      // audio. Idle (never tapped) stays idle — next/prev must not autoplay.
      if (!s.enabled || !s.want || s.hidden || !hasStream(url)) return s;
      if (s.status !== "playing" && s.status !== "loading" && s.status !== "paused" && s.status !== "offline") return s;
      if (s.status === "loading") return s;
      return { ...s, status: "loading", resume: false };
  }
}

/**
 * How long to wait before the next attempt, given `failures` in a row: 5 s,
 * 10 s, 20 s, then a flat 30 s cap. Pure, so the schedule is a test and not a
 * stopwatch; the adapter is the only caller.
 */
export function backoffDelayMs(failures: number): number {
  // A count of zero (or a nonsense one) waits the FIRST rung, not the cap: the
  // shortest wait is the safe answer when the count is not what we expected.
  const n = Number.isFinite(failures) ? Math.max(1, Math.floor(failures)) : 1;
  return n <= RADIO_RETRY_MS.length ? RADIO_RETRY_MS[n - 1] : RADIO_RETRY_CAP_MS;
}

/** The element's volume: the set volume, or 30% of it while a voice line speaks. */
export function effectiveRadioVolume(volume: number, ducked: boolean): number {
  const v = clamp01(Number.isFinite(volume) ? volume : DEFAULT_RADIO_VOLUME);
  return ducked ? v * DUCK_RATIO : v;
}

/**
 * What the pill reads. The station, or the now-playing title when a metadata
 * source exists — an `<audio>` element exposes no ICY tags without a proxy, so
 * today `nowPlaying` is null and the station name is the honest answer.
 */
export function radioText(status: RadioStatus, station: string, nowPlaying: string | null = null): string {
  if (status === "offline") return RADIO_OFFLINE_TEXT;
  return nowPlaying && nowPlaying.trim() ? nowPlaying.trim() : station;
}

/** The transport glyph: ▶ until it is really playing, then ⏸. */
export function radioGlyph(status: RadioStatus): string {
  return status === "playing" ? "❚❚" : "▶";
}

/** True while a spinner should stand in for the transport glyph. */
export function radioBusy(status: RadioStatus): boolean {
  return status === "loading";
}

// ── settings ───────────────────────────────────────────────────────────────

export interface RadioSettings {
  /** The "Radio" switch: off = stopped and disconnected. */
  enabled: boolean;
  /** The "Show radio player" switch: hides the widget only. */
  show: boolean;
  /** The radio's own volume, 0..1. */
  volume: number;
}

export interface Memory {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Defaults: the radio is ON but idle (nothing plays until it is tapped) and shown. */
export const RADIO_DEFAULTS: Readonly<RadioSettings> = Object.freeze({
  enabled: true,
  show: true,
  volume: DEFAULT_RADIO_VOLUME,
});

/**
 * Read the saved choices. Every failure mode (no storage, private mode, a
 * hand-edited string, a value out of range) lands on the default for that
 * field — a radio preference is never worth a thrown error at boot.
 */
export function readRadioSettings(storage: Memory | null): RadioSettings {
  const out: RadioSettings = { ...RADIO_DEFAULTS };
  if (!storage) return out;
  try {
    const raw = storage.getItem(RADIO_STORAGE_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Partial<RadioSettings>;
    if (typeof parsed.enabled === "boolean") out.enabled = parsed.enabled;
    if (typeof parsed.show === "boolean") out.show = parsed.show;
    if (typeof parsed.volume === "number" && Number.isFinite(parsed.volume)) out.volume = clamp01(parsed.volume);
    return out;
  } catch {
    return { ...RADIO_DEFAULTS };
  }
}

/** Write them back. A blocked storage just means the choice does not survive. */
export function writeRadioSettings(storage: Memory | null, settings: RadioSettings): void {
  if (!storage) return;
  try {
    storage.setItem(RADIO_STORAGE_KEY, JSON.stringify({
      enabled: settings.enabled, show: settings.show, volume: settings.volume,
    }));
  } catch { /* private mode */ }
}

/**
 * The saved station. A missing key, an unknown id, no storage, or a storage
 * that throws (private mode, a locked-down iframe) all land on the first
 * station — a radio preference is never worth a thrown error at boot.
 */
export function readStationId(
  storage: Memory | null,
  stations: readonly Pick<RadioStation, "id">[] = RADIO_STATIONS,
): string {
  const fallback = stations[0]?.id ?? "";
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(RADIO_STATION_KEY);
    if (!raw) return fallback;
    const id = raw.trim();
    return stations.some((s) => s.id === id) ? id : fallback;
  } catch {
    return fallback;
  }
}

/** Remember the choice. A throwing `setItem` is swallowed — the in-memory pick still stands. */
export function writeStationId(storage: Memory | null, id: string): void {
  if (!storage) return;
  try { storage.setItem(RADIO_STATION_KEY, id); } catch { /* private mode, quota, a test double */ }
}

/** The station with this id, or the first one when the id is unknown. */
export function stationById(stations: readonly RadioStation[], id: string): RadioStation | null {
  if (stations.length === 0) return null;
  return stations.find((s) => s.id === id) ?? stations[0];
}

/** Next (`dir` 1) or previous (`dir` -1), wrapping. Null only for an empty list. */
export function stepStation(stations: readonly RadioStation[], id: string, dir: 1 | -1): RadioStation | null {
  if (stations.length === 0) return null;
  const i = stations.findIndex((s) => s.id === id);
  const from = i < 0 ? 0 : i;
  const n = stations.length;
  const step = dir < 0 ? -1 : 1;
  return stations[(from + step + n) % n];
}

/**
 * The station to open after `currentId` failed. Walks forward, skipping ids
 * already tried this pass. Null when there is nowhere new to go (one station,
 * or every station has failed) — the caller then uses the ordinary offline
 * backoff instead of spinning the list forever.
 */
export function failoverStation(
  stations: readonly RadioStation[],
  currentId: string,
  failedIds: readonly string[],
): RadioStation | null {
  if (stations.length <= 1) return null;
  const failed = new Set(failedIds);
  failed.add(currentId);
  if (failed.size >= stations.length && stations.every((s) => failed.has(s.id))) return null;
  const start = stations.findIndex((s) => s.id === currentId);
  const from = start < 0 ? 0 : start;
  for (let k = 1; k <= stations.length; k++) {
    const s = stations[(from + k) % stations.length];
    if (!failed.has(s.id)) return s;
  }
  return null;
}

/** Tooltip / settings line. No URL — those live on the licence link and in docs. */
export function stationLine(s: Pick<RadioStation, "name" | "genre" | "credit">): string {
  return `${s.name}. ${s.genre}. ${s.credit}`;
}

// ── the adapter ────────────────────────────────────────────────────────────

/**
 * The slice of `HTMLAudioElement` this module uses. Structural, so a real
 * element satisfies it and a test can hand in a ten-line fake.
 */
export interface RadioAudio {
  volume: number;
  src: string;
  preload: string;
  play(): Promise<void> | void;
  pause(): void;
  load(): void;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener?(type: string, fn: () => void): void;
}

/** The two timer calls, injectable so a test can fake the clock. */
export interface RadioTimers {
  after(ms: number, fn: () => void): number;
  cancel(id: number): void;
}

/** Just enough of `document` for the visibility hook. */
export interface RadioDocument {
  visibilityState: string;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

export interface RadioDeps {
  /**
   * A single stream, the MUSIC-1 path. When this is set, the station list is
   * not used — existing callers (and the unit tests) keep one URL and the
   * same-stream backoff. Omit it to play `stations` (the shipped list).
   */
  url?: string;
  station?: string;
  /** The dial. Ignored when `url` is set. Defaults to RADIO_STATIONS. */
  stations?: readonly RadioStation[];
  /** The element. Tests pass a fake; production builds one lazily on first play. */
  audio?: RadioAudio | null;
  /** How to build that element. Return null where there is no Audio at all. */
  makeAudio?: () => RadioAudio | null;
  storage?: Memory | null;
  doc?: RadioDocument | null;
  timers?: RadioTimers;
  /** Duck fade length, ms. 0 (or a reduced-motion preference) snaps instead. */
  fadeMs?: number;
  loadTimeoutMs?: number;
  reducedMotion?: () => boolean;
  /** False while the master Sound switch (or `?sound=0`) is off. Default: always on. */
  soundGate?: () => boolean;
  /** Failover toast. Never called before a user gesture, because nothing fails before one. */
  onNotice?: (message: string) => void;
}

export interface Radio {
  /** The live machine (a frozen copy per change; compare by value). */
  readonly machine: RadioMachine;
  /** The saved choices. */
  readonly settings: RadioSettings;
  /** What the pill calls the station. */
  readonly station: string;
  /** The dial, empty when this player was built with a single `url`. */
  readonly stations: readonly RadioStation[];
  readonly stationId: string;
  readonly genre: string;
  readonly licence: string;
  readonly credit: string;
  /** Licence page. Empty in single-url mode. Not for painting as text. */
  readonly termsUrl: string;
  /** The now-playing title, when something can supply one. */
  readonly nowPlaying: string | null;
  /** ▶ — a user tap. The one and only door to `play()`. */
  play(): void;
  /** ⏸ — stop asking for audio (the stream may stay buffered). */
  pause(): void;
  toggle(): void;
  /** Wrap the dial. No-op with fewer than two stations. Does not start playback. */
  next(): void;
  prev(): void;
  /** Remember a station. Opens it only if audio was already wanted. */
  setStation(id: string): void;
  setEnabled(on: boolean): void;
  setShow(on: boolean): void;
  setVolume(v: number): void;
  /** Master Sound / mute. Default is "on". A false gate forces the element to 0. */
  setSoundGate(fn: () => boolean): void;
  /** Push the gated volume onto the element (the Sound switch calls this). */
  applyMix(): void;
  /** Failover line. Replaces any previous hook. */
  setNotice(fn: ((message: string) => void) | null): void;
  /** Feed a title in (a metadata source would call this); null = the station name. */
  setNowPlaying(title: string | null): void;
  /** A voice line started (`true`) or ended (`false`): duck and restore. */
  duck(on: boolean): void;
  /** Repaint on every state/settings change. Returns the unsubscribe. */
  register(painter: (settings: RadioSettings, machine: RadioMachine) => void): () => void;
  dispose(): void;
}

const realTimers: RadioTimers = {
  after: (ms, fn) => setTimeout(fn, ms) as unknown as number,
  cancel: (id) => { try { clearTimeout(id as unknown as ReturnType<typeof setTimeout>); } catch { /* gone */ } },
};

function liveStore(): Memory | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function liveDocument(): RadioDocument | null {
  try {
    if (typeof document === "undefined") return null;
    return document as unknown as RadioDocument;
  } catch {
    return null;
  }
}

function prefersReducedMotion(): boolean {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** `new Audio()` with the two rules the ticket pins: preload none, no CORS tricks. */
function defaultMakeAudio(): RadioAudio | null {
  try {
    if (typeof Audio === "undefined") return null;
    const el = new Audio();
    el.preload = "none";
    return el;
  } catch {
    return null;
  }
}

export function createRadio(deps: RadioDeps = {}): Radio {
  // An explicit `url` (including "") is the single-stream player the MUSIC-1
  // tests drive. Omit it and the dial is `stations` (the shipped list).
  const singleUrl = deps.url !== undefined;
  const stations: readonly RadioStation[] = singleUrl ? [] : (deps.stations ?? RADIO_STATIONS);
  const stationMode = stations.length > 0;
  const fixedUrl = singleUrl ? deps.url! : RADIO_STREAM_URL;
  const fixedName = deps.station ?? RADIO_STATION_NAME;
  const storage = deps.storage === undefined ? liveStore() : deps.storage;
  const doc = deps.doc === undefined ? liveDocument() : deps.doc;
  const timers = deps.timers ?? realTimers;
  const fadeMs = Math.max(0, deps.fadeMs ?? DUCK_FADE_MS);
  const loadTimeoutMs = Math.max(0, deps.loadTimeoutMs ?? RADIO_LOAD_TIMEOUT_MS);
  const makeAudio = deps.makeAudio ?? defaultMakeAudio;
  const reduced = deps.reducedMotion ?? prefersReducedMotion;

  let settings = readRadioSettings(storage);
  let machine = radioInit(settings.enabled);
  let nowPlaying: string | null = null;
  let currentId = stationMode ? readStationId(storage, stations) : "";
  let soundGate = deps.soundGate ?? (() => true);
  let notice: ((message: string) => void) | null = deps.onNotice ?? null;
  /** Stations that already failed this pass. Cleared on a real play, a retry, or a success. */
  const failedThisPass = new Set<string>();
  let el: RadioAudio | null = null;
  /** The src we ourselves assigned — `audio.src` resolves to an absolute URL. */
  let loadedUrl: string | null = null;
  let retryTimer: number | null = null;
  let loadTimer: number | null = null;
  let fadeTimer: number | null = null;
  let disposed = false;
  /** True while we ourselves clear `src`, so that empty-src error is not a failure. */
  let suppressError = false;
  /** Bumped on every open. A failure for an older open is ignored. */
  let openGen = 0;
  /** The open whose failure we have already counted, so error+rejection is one skip. */
  let consumedGen = -1;
  let onVisibility: (() => void) | null = null;
  const painters = new Set<(s: RadioSettings, m: RadioMachine) => void>();
  const armed: Array<{ type: string; fn: () => void }> = [];

  function currentStation(): RadioStation | null {
    return stationMode ? stationById(stations, currentId) : null;
  }
  function streamUrl(): string {
    return currentStation()?.url ?? fixedUrl;
  }
  function streamName(): string {
    return currentStation()?.name ?? fixedName;
  }

  /**
   * preload none, no CORS tricks. The playing/error listeners are armed per
   * open (they close over that open's generation) so a dead station cannot
   * be reported twice, and a late event cannot skip the station we just tuned.
   */
  function wire(audio: RadioAudio): RadioAudio {
    try { audio.preload = "none"; } catch { /* a stub */ }
    return audio;
  }

  function ensureElement(): RadioAudio | null {
    if (el) return el;
    let made: RadioAudio | null = null;
    try { made = makeAudio(); } catch { made = null; }
    if (!made) return null;
    el = wire(made);
    return el;
  }

  // An injected element (a test's fake, or a host that already has one) is
  // wired at once: the wiring is the element's, not the first play's.
  if (deps.audio) el = wire(deps.audio);

  function setElementVolume(v: number): void {
    try { if (el) el.volume = clamp01(v); } catch { /* a stubbed element */ }
  }

  function cancelFade(): void {
    if (fadeTimer !== null) { timers.cancel(fadeTimer); fadeTimer = null; }
  }

  /**
   * Move the element to the volume the machine says. Ducking fades over
   * `fadeMs` in ten steps; every other change (the slider) is immediate, and
   * a reduced-motion preference snaps the duck too.
   */
  /** The set volume, ducked, and forced to 0 while the master Sound switch is off. */
  function targetVolume(): number {
    const base = effectiveRadioVolume(settings.volume, machine.ducked);
    try { if (!soundGate()) return 0; } catch { /* a broken gate must not throw */ }
    return base;
  }

  function applyVolume(animate: boolean): void {
    const target = targetVolume();
    cancelFade();
    if (!el) return;
    if (!animate || fadeMs <= 0 || reduced()) { setElementVolume(target); return; }
    const from = clamp01(Number(el.volume) || 0);
    const steps = 10;
    let i = 0;
    const tick = (): void => {
      i += 1;
      setElementVolume(from + (target - from) * (i / steps));
      fadeTimer = i < steps ? timers.after(fadeMs / steps, tick) : null;
    };
    fadeTimer = timers.after(fadeMs / steps, tick);
  }

  function cancelRetry(): void {
    if (retryTimer !== null) { timers.cancel(retryTimer); retryTimer = null; }
  }

  function cancelLoadTimer(): void {
    if (loadTimer !== null) { timers.cancel(loadTimer); loadTimer = null; }
  }

  /** Only retry while the switch is on, the player wants it, and the tab shows it. */
  function canRetry(): boolean {
    return !disposed && machine.enabled && machine.want && !machine.hidden && hasStream(streamUrl());
  }

  function armRetry(): void {
    cancelRetry();
    if (!canRetry()) return;
    retryTimer = timers.after(backoffDelayMs(machine.failures), () => {
      retryTimer = null;
      dispatch("retry");
    });
  }

  function armLoadTimeout(gen: number): void {
    cancelLoadTimer();
    if (loadTimeoutMs <= 0) return;
    loadTimer = timers.after(loadTimeoutMs, () => {
      loadTimer = null;
      // A stream that neither plays nor errors: treat it as dead.
      if (machine.status === "loading") onStreamFailed(gen);
    });
  }

  /** Listeners for THIS open only. An older open's event no-ops on the generation check. */
  function armLoadListeners(audio: RadioAudio, gen: number): void {
    if (audio.removeEventListener) {
      for (const a of armed) {
        try { audio.removeEventListener(a.type, a.fn); } catch { /* garnish */ }
      }
    }
    armed.length = 0;
    const onErr = (): void => { if (!suppressError) onStreamFailed(gen); };
    const onPlay = (): void => { if (gen === openGen) dispatch("loaded"); };
    for (const [type, fn] of [["error", onErr], ["ended", onErr], ["playing", onPlay]] as const) {
      try { audio.addEventListener(type, fn); armed.push({ type, fn }); } catch { /* a stub with no events */ }
    }
  }

  function tell(message: string): void {
    try { notice?.(message); } catch { /* a bad toast is not a crash */ }
  }

  /**
   * A dead stream. With a dial, skip to the next station that has not failed
   * this pass and keep the spinner up. With one URL (or a dial that has all
   * failed), the ordinary offline + backoff path.
   */
  function onStreamFailed(gen: number): void {
    if (suppressError || disposed || gen !== openGen || gen === consumedGen) return;
    consumedGen = gen;
    if (stationMode && machine.enabled && machine.want && !machine.hidden) {
      failedThisPass.add(currentId);
      const next = failoverStation(stations, currentId, [...failedThisPass]);
      if (next) {
        const from = streamName();
        currentId = next.id;
        writeStationId(storage, next.id);
        nowPlaying = null;
        loadedUrl = null;
        tell(`${from} is not answering. Tuning ${next.name}.`);
        if (machine.status === "loading") {
          openStream();
          paint();
        } else {
          dispatch("tune");
        }
        return;
      }
    }
    dispatch("error");
  }

  /** Open the stream. Never throws: a missing element or a refused play is `error`. */
  function openStream(): void {
    openGen += 1;
    const gen = openGen;
    const audio = ensureElement();
    if (!audio) { dispatch("error"); return; }
    const target = streamUrl();
    if (loadedUrl !== target) {
      suppressError = true;
      try { audio.src = target; loadedUrl = target; }
      catch { suppressError = false; onStreamFailed(gen); return; }
      suppressError = false;
    }
    armLoadListeners(audio, gen);
    applyVolume(false);
    let started: unknown;
    try { started = audio.play(); } catch (err) { onPlayRefused(gen, err); return; }
    if (started && typeof (started as Promise<void>).catch === "function") {
      (started as Promise<void>).catch((err) => onPlayRefused(gen, err));
    }
    armLoadTimeout(gen);
  }

  /**
   * A NotAllowedError is the browser asking for a gesture, not a dead station.
   * Skipping the dial on it would burn every station after the first error.
   * Anything else (a thrown play, a network rejection) is a failed stream.
   */
  function onPlayRefused(gen: number, err: unknown): void {
    const name = err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "";
    if (name === "NotAllowedError") {
      if (gen !== openGen || disposed) return;
      consumedGen = gen;
      tell("Tap play to keep listening.");
      dispatch("pause");
      return;
    }
    onStreamFailed(gen);
  }

  /** Drop a stale source without counting it as a failure. */
  function dropSrc(): void {
    suppressError = true;
    cancelLoadTimer();
    try { el?.pause(); } catch { /* garnish */ }
    try { if (el) el.src = ""; } catch { /* garnish */ }
    try { el?.load(); } catch { /* garnish */ }
    suppressError = false;
    loadedUrl = null;
  }

  /** Point the dial at `id`. Opens the new stream only if audio is already wanted. */
  function retune(id: string): void {
    if (!stationMode) return;
    const next = stations.find((s) => s.id === id);
    if (!next || next.id === currentId) return;
    currentId = next.id;
    writeStationId(storage, next.id);
    nowPlaying = null;
    loadedUrl = null;
    failedThisPass.clear();
    cancelRetry();
    if (machine.want && (machine.status === "playing" || machine.status === "loading" || machine.status === "offline")) {
      if (machine.status === "loading") openStream();
      else dispatch("tune");
    } else {
      dropSrc();
    }
    paint();
  }

  function pauseElement(): void {
    cancelLoadTimer();
    try { el?.pause(); } catch { /* a stubbed element */ }
  }

  /** Off: stop, drop the source and `load()` so the connection is released. */
  function releaseStream(): void {
    cancelRetry();
    cancelLoadTimer();
    cancelFade();
    if (!el) return;
    suppressError = true;
    try { el.pause(); } catch { /* garnish */ }
    try { el.src = ""; } catch { /* garnish */ }
    try { el.load(); } catch { /* garnish */ }
    suppressError = false;
    loadedUrl = null;
  }

  /** The one place a status becomes element work. */
  function sync(prev: RadioMachine, next: RadioMachine): void {
    switch (next.status) {
      case "off": releaseStream(); break;
      case "idle": pauseElement(); break;
      case "loading": openStream(); break;
      case "playing": break;            // `loaded` came FROM the element
      case "paused": pauseElement(); break;
      case "offline": pauseElement(); armRetry(); break;
    }
    applyVolume(prev.ducked !== next.ducked);
  }

  function dispatch(event: RadioEvent): void {
    if (disposed) return;
    // A tap, or the backoff, is a fresh pass down the dial.
    if (event === "play" || event === "retry") failedThisPass.clear();
    const prev = machine;
    const next = radioReduce(prev, event, streamUrl());
    if (next === prev) return;
    machine = next;
    if (next.status === "playing") failedThisPass.clear();
    try { sync(prev, next); } catch { /* the show must go on */ }
    paint();
  }

  function paint(): void {
    for (const painter of painters) {
      try { painter(settings, machine); } catch { /* a bad painter is not a crash */ }
    }
  }

  if (doc) {
    try {
      onVisibility = () => {
        try {
          dispatch(doc.visibilityState === "hidden" ? "hidden" : "visible");
        } catch { /* garnish */ }
      };
      doc.addEventListener("visibilitychange", onVisibility);
    } catch { /* no hook, no auto-pause */ }
  }

  return {
    get machine() { return machine; },
    get settings() { return settings; },
    get station() { return streamName(); },
    get stations() { return stations; },
    get stationId() { return currentStation()?.id ?? ""; },
    get genre() { return currentStation()?.genre ?? ""; },
    get licence() { return currentStation()?.licence ?? ""; },
    get credit() { return currentStation()?.credit ?? ""; },
    get termsUrl() { return currentStation()?.termsUrl ?? ""; },
    get nowPlaying() { return nowPlaying; },
    play() { dispatch("play"); },
    pause() { dispatch("pause"); },
    toggle() {
      dispatch(machine.status === "playing" || machine.status === "loading" ? "pause" : "play");
    },
    next() {
      const n = stepStation(stations, currentId, 1);
      if (n) retune(n.id);
    },
    prev() {
      const n = stepStation(stations, currentId, -1);
      if (n) retune(n.id);
    },
    setStation(id) { retune(id); },
    setEnabled(on) {
      settings = { ...settings, enabled: !!on };
      writeRadioSettings(storage, settings);
      dispatch(on ? "enable" : "disable");
      paint();
    },
    setShow(on) {
      settings = { ...settings, show: !!on };
      writeRadioSettings(storage, settings);
      paint();
    },
    setVolume(v) {
      settings = { ...settings, volume: clamp01(Number.isFinite(v) ? v : DEFAULT_RADIO_VOLUME) };
      writeRadioSettings(storage, settings);
      applyVolume(false);
      paint();
    },
    setSoundGate(fn) { soundGate = fn; applyVolume(false); },
    applyMix() { applyVolume(false); },
    setNotice(fn) { notice = fn; },
    setNowPlaying(title) {
      const next = title && title.trim() ? title.trim() : null;
      if (next === nowPlaying) return;
      nowPlaying = next;
      paint();
    },
    duck(on) { dispatch(on ? "duckStart" : "duckEnd"); },
    register(painter) {
      painters.add(painter);
      try { painter(settings, machine); } catch { /* garnish */ }
      return () => { painters.delete(painter); };
    },
    dispose() {
      disposed = true;
      cancelRetry();
      cancelLoadTimer();
      cancelFade();
      painters.clear();
      notice = null;
      if (doc && onVisibility) {
        try { doc.removeEventListener("visibilitychange", onVisibility); } catch { /* garnish */ }
        onVisibility = null;
      }
      try { el?.pause(); } catch { /* garnish */ }
    },
  };
}

/**
 * The one player every door shares (the settings sheet, the pill, the game's
 * probe). It is created at import but touches nothing until it is asked to:
 * no element until the first play, no storage until the first read.
 * The master Sound switch (and `?sound=0`) gates its volume to 0.
 */
export const radio: Radio = createRadio({
  soundGate: () => { try { return isAudioEnabled(); } catch { return true; } },
});

try {
  registerSoundPainter(() => { try { radio.applyMix(); } catch { /* garnish */ } });
} catch { /* a host with no sound registry still plays at the radio's own volume */ }

// ── the widget ─────────────────────────────────────────────────────────────

/** How long a press has to hold before it is a "long press" (the phone peek). */
export const RADIO_LONGPRESS_MS = 450;
/** How long the peeked text stays up on a phone. */
export const RADIO_PEEK_MS = 1_800;

export interface RadioWidget {
  el: HTMLElement;
  /** The play button, for the tests and for a console poke. */
  readonly playButton: HTMLButtonElement;
  /** The volume button / slider pair. */
  readonly volumeButton: HTMLButtonElement;
  readonly slider: HTMLInputElement;
  destroy(): void;
}

/**
 * Mount the pill inside `host` (the chrome owns the host's place — styles.css
 * `.radio-dock`). The widget owns the look and every interaction:
 *
 *   ▶ / ⏸   toggle. `aria-pressed` follows the real transport, and the first
 *           tap is the gesture the browser's autoplay rule wants.
 *   text     station / now-playing, ellipsised; "Radio offline" when dead.
 *   🔊 / ⏸   opens a small volume slider (its own bus, 0..1).
 *   phone    the row collapses to one round button (CSS): the text comes back
 *           on a long press, and the title attribute is the desktop tooltip.
 *
 * Nothing here throws: a state that cannot be painted simply does not paint.
 */
export function mountRadioWidget(host: HTMLElement, r: Radio = radio): RadioWidget {
  // One pill per dock: a game that mounts twice (a re-boot over the same host)
  // replaces its player rather than stacking a second one on top of it.
  for (const stale of Array.from(host.querySelectorAll(".radio-pill"))) stale.remove();

  const pill = document.createElement("div");
  pill.className = "radio-pill";
  pill.id = "iso-radio";
  pill.dataset.state = r.machine.status;
  pill.setAttribute("role", "group");
  pill.setAttribute("aria-label", `${r.station} player`);

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "radio-play";
  const glyph = document.createElement("span");
  glyph.className = "radio-glyph";
  glyph.setAttribute("aria-hidden", "true");
  const spin = document.createElement("span");
  spin.className = "radio-spin";
  spin.setAttribute("aria-hidden", "true");
  playBtn.append(glyph, spin);

  const now = document.createElement("span");
  now.className = "radio-now";

  const volBtn = document.createElement("button");
  volBtn.type = "button";
  volBtn.className = "radio-vol";
  volBtn.setAttribute("aria-expanded", "false");
  const volGlyph = document.createElement("span");
  volGlyph.className = "radio-vol-glyph";
  volGlyph.setAttribute("aria-hidden", "true");
  volGlyph.textContent = "🔊";
  volBtn.appendChild(volGlyph);

  const sliderWrap = document.createElement("span");
  sliderWrap.className = "radio-slider hidden";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "1";
  slider.step = "0.05";
  slider.className = "radio-vol-range";
  slider.setAttribute("aria-label", "Radio volume");
  sliderWrap.appendChild(slider);

  // RADIO-2: ‹ › on the chip. Hidden on a phone (the one-round-key contract);
  // the settings sheet's station list is the picker there.
  const prevBtn = document.createElement("button");
  const nextBtn = document.createElement("button");
  if (r.stations.length > 1) {
    for (const [btn, dir, label, mark] of [
      [prevBtn, "prev", "Previous station", "‹"],
      [nextBtn, "next", "Next station", "›"],
    ] as const) {
      btn.type = "button";
      btn.className = `radio-step radio-${dir}`;
      btn.setAttribute("aria-label", label);
      const glyphStep = document.createElement("span");
      glyphStep.setAttribute("aria-hidden", "true");
      glyphStep.textContent = mark;
      btn.appendChild(glyphStep);
      btn.onclick = (e) => {
        e.stopPropagation();
        try { dir === "prev" ? r.prev() : r.next(); } catch { /* garnish */ }
      };
    }
    pill.append(prevBtn, playBtn, now, nextBtn, volBtn, sliderWrap);
  } else {
    pill.append(playBtn, now, volBtn, sliderWrap);
  }
  host.appendChild(pill);

  // ── interactions ──
  playBtn.onclick = () => { if (!suppressClick) { try { r.toggle(); } catch { /* garnish */ } } suppressClick = false; };
  volBtn.onclick = () => {
    const open = pill.dataset.vol === "1";
    pill.dataset.vol = open ? "0" : "1";
    volBtn.setAttribute("aria-expanded", String(!open));
    sliderWrap.classList.toggle("hidden", open);
    if (!open) { try { slider.focus(); } catch { /* garnish */ } }
  };
  slider.oninput = () => { try { r.setVolume(Number(slider.value)); } catch { /* garnish */ } };
  // Keep the slider's own click from reaching the map behind the pill.
  slider.onclick = (e) => { e.stopPropagation(); };

  // Phone: the row is hidden, so a held press peeks at the text instead.
  let holdTimer: number | null = null;
  let peekTimer: number | null = null;
  let suppressClick = false;
  const endHold = (): void => {
    if (holdTimer !== null) { window.clearTimeout(holdTimer); holdTimer = null; }
  };
  playBtn.addEventListener("pointerdown", () => {
    endHold();
    holdTimer = window.setTimeout(() => {
      holdTimer = null;
      suppressClick = true;
      pill.dataset.peek = "1";
      if (peekTimer !== null) window.clearTimeout(peekTimer);
      peekTimer = window.setTimeout(() => {
        peekTimer = null;
        pill.dataset.peek = "0";
      }, RADIO_PEEK_MS);
    }, RADIO_LONGPRESS_MS);
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"] as const) {
    playBtn.addEventListener(ev, endHold);
  }

  const paint = (s: RadioSettings, m: RadioMachine): void => {
    try {
      const text = radioText(m.status, r.station, r.nowPlaying);
      const label = playLabel(m, s, r.station);
      pill.dataset.state = m.status;
      pill.dataset.enabled = s.enabled ? "1" : "0";
      pill.dataset.show = s.show ? "1" : "0";
      pill.hidden = !s.show;

      glyph.textContent = radioGlyph(m.status);
      const busy = radioBusy(m.status);
      pill.dataset.busy = busy ? "1" : "0";

      const playing = m.status === "playing";
      playBtn.setAttribute("aria-pressed", String(playing));
      playBtn.disabled = !s.enabled;
      playBtn.setAttribute("aria-disabled", String(!s.enabled));
      playBtn.setAttribute("aria-label", label);
      playBtn.title = label;

      if (now.textContent !== text) now.textContent = text;
      const credit = r.credit
        ? stationLine({ name: r.station, genre: r.genre, credit: r.credit })
        : r.station;
      now.title = r.credit ? `${text}. ${r.credit}` : text;
      pill.title = credit;
      pill.setAttribute("aria-label", `${r.station} player`);
      if (r.stationId) pill.dataset.station = r.stationId;

      for (const step of [prevBtn, nextBtn]) {
        if (!step.isConnected) continue;
        step.disabled = !s.enabled;
        step.setAttribute("aria-disabled", String(!s.enabled));
      }

      volBtn.disabled = !s.enabled;
      volBtn.setAttribute("aria-disabled", String(!s.enabled));
      volBtn.title = `Radio volume ${Math.round(s.volume * 100)}%`;
      volBtn.setAttribute("aria-label", `Radio volume, ${Math.round(s.volume * 100)} percent`);
      if (document.activeElement !== slider) slider.value = String(s.volume);
    } catch { /* a dead host cannot be painted */ }
  };

  const unsub = r.register(paint);
  return {
    el: pill,
    playButton: playBtn,
    volumeButton: volBtn,
    slider,
    destroy() {
      endHold();
      if (peekTimer !== null) { window.clearTimeout(peekTimer); peekTimer = null; }
      try { unsub(); } catch { /* garnish */ }
      pill.remove();
    },
  };
}

/** The play button's label, which is also its tooltip. */
function playLabel(m: RadioMachine, s: RadioSettings, station: string): string {
  if (!s.enabled) return "Radio is off — turn it on in Settings";
  if (m.status === "loading") return `Tuning in ${station}`;
  if (m.status === "playing") return `Pause ${station}`;
  if (m.status === "offline") return `${RADIO_OFFLINE_TEXT} — try again`;
  return `Play ${station}`;
}
