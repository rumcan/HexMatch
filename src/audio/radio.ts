// ══════════════════════════════════════════════════════════════════════════
// MUSIC-1 (#377) — the mini radio in the corner.
//
// One `<audio>` element, one station URL, one small pill in the very top-right
// of the HUD. The owner supplies the stream (RADIO_STREAM_URL is EMPTY until
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

/**
 * The station. EMPTY on purpose: the owner supplies the URL (and the invoice
 * for the music) and the code must already behave without it — an empty URL is
 * the "Radio offline" state, not a crash and not a spinner that never ends.
 */
export const RADIO_STREAM_URL = "";

/** What the pill says when there is no now-playing metadata to say. */
export const RADIO_STATION_NAME = "SEGA Radio";

/** Where the on/off, show/hide and volume choices live. Beside `hexmatch:voice`. */
export const RADIO_STORAGE_KEY = "hexmatch:radio";

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
  | "duckEnd";

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
  }
}

/**
 * The backoff, in `failures`-in-a-row: 5 s, 10 s, 20 s, then a flat 30 s cap.
 * Pure, so the schedule is a test and not a stopwatch.
 */
export function backoffDelayMs(failures: number): number {
  const n = Math.max(0, Math.floor(Number.isFinite(failures) ? failures : 0));
  const i = n - 1;
  return i >= 0 && i < RADIO_RETRY_MS.length ? RADIO_RETRY_MS[i] : RADIO_RETRY_CAP_MS;
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
  /** The stream. Defaults to RADIO_STREAM_URL (empty today). */
  url?: string;
  station?: string;
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
}

export interface Radio {
  /** The live machine (a frozen copy per change; compare by value). */
  readonly machine: RadioMachine;
  /** The saved choices. */
  readonly settings: RadioSettings;
  /** What the pill calls the station. */
  readonly station: string;
  /** The now-playing title, when something can supply one. */
  readonly nowPlaying: string | null;
  /** ▶ — a user tap. The one and only door to `play()`. */
  play(): void;
  /** ⏸ — stop asking for audio (the stream may stay buffered). */
  pause(): void;
  toggle(): void;
  setEnabled(on: boolean): void;
  setShow(on: boolean): void;
  setVolume(v: number): void;
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
  const url = deps.url === undefined ? RADIO_STREAM_URL : deps.url;
  const station = deps.station ?? RADIO_STATION_NAME;
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
  let el: RadioAudio | null = deps.audio ?? null;
  /** The src we ourselves assigned — `audio.src` resolves to an absolute URL. */
  let loadedUrl: string | null = null;
  let retryTimer: number | null = null;
  let loadTimer: number | null = null;
  let fadeTimer: number | null = null;
  let disposed = false;
  let onVisibility: (() => void) | null = null;
  const painters = new Set<(s: RadioSettings, m: RadioMachine) => void>();

  function ensureElement(): RadioAudio | null {
    if (el) return el;
    let made: RadioAudio | null = null;
    try { made = makeAudio(); } catch { made = null; }
    if (!made) return null;
    try {
      made.preload = "none";
      made.addEventListener("playing", () => dispatch("loaded"));
      made.addEventListener("error", () => dispatch("error"));
      // A live stream that "ends" is a stream that died: same door as an error.
      made.addEventListener("ended", () => dispatch("error"));
    } catch { /* a stub with no events simply never reports */ }
    el = made;
    return el;
  }

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
  function applyVolume(animate: boolean): void {
    const target = effectiveRadioVolume(settings.volume, machine.ducked);
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
    return !disposed && machine.enabled && machine.want && !machine.hidden && hasStream(url);
  }

  function armRetry(): void {
    cancelRetry();
    if (!canRetry()) return;
    retryTimer = timers.after(backoffDelayMs(machine.failures), () => {
      retryTimer = null;
      dispatch("retry");
    });
  }

  function armLoadTimeout(): void {
    cancelLoadTimer();
    if (loadTimeoutMs <= 0) return;
    loadTimer = timers.after(loadTimeoutMs, () => {
      loadTimer = null;
      // A stream that neither plays nor errors: treat it as dead.
      if (machine.status === "loading") dispatch("error");
    });
  }

  /** Open the stream. Never throws: a missing element or a refused play is `error`. */
  function openStream(): void {
    const audio = ensureElement();
    if (!audio) { dispatch("error"); return; }
    if (loadedUrl !== url) {
      try { audio.src = url; loadedUrl = url; } catch { dispatch("error"); return; }
    }
    applyVolume(false);
    let started: unknown;
    try { started = audio.play(); } catch { dispatch("error"); return; }
    if (started && typeof (started as Promise<void>).catch === "function") {
      (started as Promise<void>).catch(() => dispatch("error"));
    }
    armLoadTimeout();
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
    try { el.pause(); } catch { /* garnish */ }
    try { el.src = ""; } catch { /* garnish */ }
    try { el.load(); } catch { /* garnish */ }
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
    const prev = machine;
    const next = radioReduce(prev, event, url);
    if (next === prev) return;
    machine = next;
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
    get station() { return station; },
    get nowPlaying() { return nowPlaying; },
    play() { dispatch("play"); },
    pause() { dispatch("pause"); },
    toggle() {
      dispatch(machine.status === "playing" || machine.status === "loading" ? "pause" : "play");
    },
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
 */
export const radio: Radio = createRadio();

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

  pill.append(playBtn, now, volBtn, sliderWrap);
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
      now.title = text;
      pill.title = `${r.station} — ${text}`;

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
