// ══════════════════════════════════════════════════════════════════════════
// VO-1 — pre-recorded voices. The game plays files; it does not synthesise.
//
//   assets/voice/lines.json              the script the lead records from
//   assets/voice/<speaker>/<id>.mp3      narrator | rival | player
//
// One line at a time. Rival lines are rate-limited so a burst of feed events
// cannot stack taunts. A missing file, a blocked autoplay, or a browser with
// no Audio element never throws: the subtitle still shows and the queue moves
// on. Voice has its own mute and volume (settings) and also bows to the global
// sound mute (src/audio/sfx.ts / the engine). The narrator speaks only while
// a first/new game has asked for it, and can be skipped for the tab.
// ══════════════════════════════════════════════════════════════════════════
import rawLines from "../../assets/voice/lines.json";
import { isAudioEnabled } from "../audio/engine";
import { registerSoundPainter } from "../audio/sfx";

export const VOICE_STORAGE_KEY = "hexmatch:voice";
export const VOICE_SKIP_KEY = "hexmatch:voice-skip";
/** Minimum gap between accepted rival lines. Extras are dropped, not queued. */
export const RIVAL_GAP_MS = 12_000;
export const DEFAULT_VOICE_VOLUME = 0.85;

export const SPEAKERS = ["narrator", "rival", "player"] as const;
export type Speaker = (typeof SPEAKERS)[number];

export interface VoiceLine {
  id: string;
  speaker: Speaker;
  text: string;
  trigger: string;
}

export interface VoiceSettings {
  enabled: boolean;
  volume: number;
  skipped: boolean;
  narrationOn: boolean;
}

export interface VoicePlayback {
  stop(): void;
  ended: Promise<void>;
  /** True when the file was absent or the element failed. */
  failed?: boolean;
  setVolume?(volume: number): void;
}

export interface VoiceSink {
  show(line: VoiceLine): void;
  hide(): void;
}

interface Memory {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface VoiceDeps {
  lines?: readonly VoiceLine[];
  now?: () => number;
  /** Global sound mute. False → no voice audio. Defaults to the SFX bus. */
  soundEnabled?: () => boolean;
  probe?: (url: string) => Promise<boolean>;
  play?: (url: string, volume: number) => VoicePlayback;
  delay?: (ms: number) => Promise<void>;
  sink?: VoiceSink | null;
  storage?: Memory | null;
  session?: Memory | null;
  baseUrl?: string;
  rivalGapMs?: number;
}

export interface VoiceDirector {
  cue(trigger: string): VoiceLine | null;
  /** Queue the trigger's line once. A repeat is a no-op. */
  cueOnce(trigger: string): VoiceLine | null;
  say(id: string): VoiceLine | null;
  setNarration(on: boolean): void;
  readonly narrationOn: boolean;
  skipNarration(): void;
  readonly narrationSkipped: boolean;
  setEnabled(on: boolean): void;
  setVolume(v: number): void;
  readonly enabled: boolean;
  readonly volume: number;
  settings(): VoiceSettings;
  noteSound(enabled: boolean): void;
  /** Replace the subtitle sink. Stops whatever was speaking into the last one. */
  attach(sink: VoiceSink | null): void;
  detach(): void;
  register(painter: (settings: VoiceSettings) => void): () => void;
  stop(): void;
  readonly queueIds: readonly string[];
  readonly playingId: string | null;
  readonly dropped: number;
  readonly missing: number;
  whenIdle(): Promise<void>;
}

export function voiceWordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** How long a subtitle should stay up when there is no recording to wait on. */
export function readingMs(text: string): number {
  return Math.min(8_000, Math.max(2_200, 800 + voiceWordCount(text) * 280));
}

export function voiceFileUrl(speaker: Speaker, id: string, base = defaultBase()): string {
  const root = base.endsWith("/") ? base : `${base}/`;
  return `${root}assets/voice/${speaker}/${id}.mp3`;
}

export function parseVoiceLines(raw: unknown): VoiceLine[] {
  if (!Array.isArray(raw)) return [];
  const out: VoiceLine[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    const text = typeof r.text === "string" ? r.text.trim() : "";
    const trigger = typeof r.trigger === "string" ? r.trigger.trim() : "";
    const speaker = r.speaker;
    if (!id || !text || !trigger) continue;
    if (speaker !== "narrator" && speaker !== "rival" && speaker !== "player") continue;
    out.push({ id, speaker, text, trigger });
  }
  return out;
}

export const VOICE_LINES: readonly VoiceLine[] = parseVoiceLines(rawLines);

function defaultBase(): string {
  try {
    const b = import.meta.env?.BASE_URL;
    if (typeof b === "string" && b.length) return b.endsWith("/") ? b : `${b}/`;
  } catch { /* a bare node import has no Vite env */ }
  return "./";
}

function liveStore(kind: "local" | "session"): Memory | null {
  try {
    if (typeof window === "undefined") return null;
    const box = kind === "local" ? window.localStorage : window.sessionStorage;
    return box ?? null;
  } catch {
    return null;
  }
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(fallback);
    }, ms);
    p.then(
      (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
      () => { if (!done) { done = true; clearTimeout(timer); resolve(fallback); } },
    );
  });
}

/** GET, never throw. A 404 is "no file", which is the shipped state until the lead drops the MP3s. */
async function defaultProbe(url: string): Promise<boolean> {
  if (typeof fetch !== "function") return false;
  try {
    const res = await fetch(url, { method: "GET", cache: "force-cache" });
    return !!res && res.ok === true;
  } catch {
    return false;
  }
}

function defaultPlay(url: string, volume: number): VoicePlayback {
  let finish = (): void => {};
  const ended = new Promise<void>((resolve) => { finish = () => resolve(); });
  const playback: VoicePlayback = {
    stop: () => {
      finish();
    },
    ended,
    failed: false,
  };
  try {
    if (typeof Audio === "undefined") {
      playback.failed = true;
      finish();
      return playback;
    }
    const audio = new Audio();
    audio.preload = "auto";
    try { audio.volume = clamp01(volume); } catch { /* a stubbed element */ }
    playback.setVolume = (v) => { try { audio.volume = clamp01(v); } catch { /* garnish */ } };
    playback.stop = () => {
      try { audio.pause(); } catch { /* garnish */ }
      try { audio.src = ""; } catch { /* garnish */ }
      finish();
    };
    const fail = () => { playback.failed = true; finish(); };
    audio.addEventListener("error", fail);
    audio.addEventListener("ended", () => finish());
    audio.src = url;
    const started = audio.play();
    if (started && typeof started.catch === "function") void started.catch(fail);
  } catch {
    playback.failed = true;
    finish();
  }
  return playback;
}

export function createVoice(deps: VoiceDeps = {}): VoiceDirector {
  const lines = deps.lines ?? VOICE_LINES;
  const now = deps.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const soundEnabled = deps.soundEnabled ?? (() => {
    try { return isAudioEnabled(); } catch { return false; }
  });
  const probe = deps.probe ?? ((url: string) => withTimeout(defaultProbe(url), 1_500, false));
  const play = deps.play ?? defaultPlay;
  const gap = deps.rivalGapMs ?? RIVAL_GAP_MS;
  const baseUrl = deps.baseUrl ?? defaultBase();
  const storage = deps.storage === undefined ? liveStore("local") : deps.storage;
  const session = deps.session === undefined ? liveStore("session") : deps.session;

  const prefs = readPrefs(storage);
  let skipped = readSkipped(session);
  let narrationOn = false;
  let sink: VoiceSink | null = deps.sink ?? null;
  const painters = new Set<(s: VoiceSettings) => void>();
  const queue: VoiceLine[] = [];
  const cursor = new Map<string, number>();
  const once = new Set<string>();
  const probeCache = new Map<string, boolean>();
  let lastRivalAt = -1e15;
  let dropped = 0;
  let missing = 0;
  let playing: VoiceLine | null = null;
  let currentPlayback: VoicePlayback | null = null;
  let busy = false;
  let epoch = 0;
  let cancelHold: (() => void) | null = null;
  let abortResolve: (() => void) | null = null;
  const idleWaiters: Array<() => void> = [];

  function delay(ms: number): Promise<void> {
    if (deps.delay) return deps.delay(ms);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { cancelHold = null; resolve(); }, ms);
      cancelHold = () => {
        clearTimeout(timer);
        cancelHold = null;
        resolve();
      };
    });
  }

  function snapshot(): VoiceSettings {
    return {
      enabled: prefs.enabled,
      volume: prefs.volume,
      skipped,
      narrationOn,
    };
  }

  function paint(): void {
    const s = snapshot();
    for (const painter of painters) {
      try { painter(s); } catch { /* a bad painter must not mute the yard */ }
    }
  }

  function shouldHear(): boolean {
    if (!prefs.enabled || prefs.volume <= 0) return false;
    try { return soundEnabled() !== false; } catch { return false; }
  }

  function silence(): void {
    const pb = currentPlayback;
    currentPlayback = null;
    try { pb?.stop(); } catch { /* garnish */ }
  }

  function settleIdle(): void {
    if (busy || queue.length || playing) return;
    const waiters = idleWaiters.splice(0);
    for (const w of waiters) {
      try { w(); } catch { /* garnish */ }
    }
  }

  function interrupt(): void {
    epoch++;
    busy = false;
    playing = null;
    silence();
    try { cancelHold?.(); } catch { /* garnish */ }
    try { abortResolve?.(); } catch { /* garnish */ }
    abortResolve = null;
  }

  function group(trigger: string): VoiceLine[] {
    return lines.filter((l) => l.trigger === trigger);
  }

  function take(trigger: string): VoiceLine | null {
    const rows = group(trigger);
    if (!rows.length) return null;
    const i = cursor.get(trigger) ?? 0;
    return rows[i % rows.length] ?? null;
  }

  function commit(trigger: string): void {
    cursor.set(trigger, (cursor.get(trigger) ?? 0) + 1);
  }

  function accept(line: VoiceLine, markOnce: boolean, advance = true): VoiceLine | null {
    if (line.speaker === "narrator" && (!narrationOn || skipped)) return null;
    if (line.speaker === "rival") {
      const t = now();
      if (t - lastRivalAt < gap) {
        dropped++;
        return null;
      }
      lastRivalAt = t;
    }
    if (markOnce) once.add(line.trigger);
    if (advance) commit(line.trigger);
    queue.push(line);
    kick();
    return line;
  }

  function kick(): void {
    if (busy) return;
    busy = true;
    const token = epoch;
    void run(token).catch(() => {
      if (token === epoch) {
        busy = false;
        playing = null;
        settleIdle();
      }
    });
  }

  async function run(token: number): Promise<void> {
    try {
      while (token === epoch && queue.length) {
        const line = queue.shift()!;
        if (token !== epoch) break;
        playing = line;
        try { sink?.show(line); } catch { /* a detached bubble is not a crash */ }
        if (token !== epoch) break;

        let playback: VoicePlayback | null = null;
        if (shouldHear()) {
          const url = voiceFileUrl(line.speaker, line.id, baseUrl);
          let present = probeCache.get(url);
          if (present === undefined) {
            try { present = await probe(url); } catch { present = false; }
            probeCache.set(url, present === true);
          }
          if (token !== epoch) break;
          if (!present) {
            missing++;
          } else {
            try {
              playback = play(url, prefs.volume);
              currentPlayback = playback;
            } catch {
              missing++;
              playback = null;
            }
          }
        }
        if (token !== epoch) {
          try { playback?.stop(); } catch { /* garnish */ }
          break;
        }

        let cancel: () => void = () => {};
        const aborted = new Promise<void>((resolve) => { cancel = resolve; abortResolve = resolve; });
        const hold = delay(readingMs(line.text));
        const audioEnded = playback
          ? playback.ended.then(() => {}, () => {})
          : Promise.resolve();
        await Promise.race([Promise.all([audioEnded, hold]), aborted]);
        if (abortResolve === cancel) abortResolve = null;
        if (playback?.failed) missing++;
        if (currentPlayback === playback) currentPlayback = null;
        if (token !== epoch) break;
        playing = null;
      }
    } finally {
      if (token === epoch) {
        playing = null;
        busy = false;
        try { if (!queue.length) sink?.hide(); } catch { /* garnish */ }
        if (queue.length) kick();
        else settleIdle();
      }
    }
  }

  const director: VoiceDirector = {
    cue(trigger) {
      const line = take(trigger);
      return line ? accept(line, false) : null;
    },
    cueOnce(trigger) {
      if (once.has(trigger)) return null;
      const line = take(trigger);
      return line ? accept(line, true) : null;
    },
    say(id) {
      const line = lines.find((l) => l.id === id) ?? null;
      // By id: do not burn the trigger's round-robin slot.
      return line ? accept(line, false, false) : null;
    },
    setNarration(on) {
      narrationOn = on && !skipped;
      paint();
    },
    get narrationOn() { return narrationOn; },
    skipNarration() {
      skipped = true;
      narrationOn = false;
      try { session?.setItem(VOICE_SKIP_KEY, "1"); } catch { /* private mode */ }
      const wasNarrator = playing?.speaker === "narrator";
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i].speaker === "narrator") queue.splice(i, 1);
      }
      paint();
      if (wasNarrator) {
        try { sink?.hide(); } catch { /* garnish */ }
        interrupt();
        if (queue.length) kick();
        else settleIdle();
      }
    },
    get narrationSkipped() { return skipped; },
    setEnabled(on) {
      prefs.enabled = on;
      writePrefs(storage, prefs);
      if (!shouldHear()) silence();
      paint();
    },
    setVolume(v) {
      prefs.volume = clamp01(Number.isFinite(v) ? v : DEFAULT_VOICE_VOLUME);
      writePrefs(storage, prefs);
      try { currentPlayback?.setVolume?.(shouldHear() ? prefs.volume : 0); } catch { /* garnish */ }
      if (!shouldHear()) silence();
      paint();
    },
    get enabled() { return prefs.enabled; },
    get volume() { return prefs.volume; },
    settings: snapshot,
    noteSound(enabled) {
      if (!enabled || !shouldHear()) silence();
      else try { currentPlayback?.setVolume?.(prefs.volume); } catch { /* garnish */ }
      paint();
    },
    attach(next) {
      interrupt();
      queue.length = 0;
      once.clear();
      narrationOn = false;
      try { sink?.hide(); } catch { /* garnish */ }
      sink = next;
      paint();
      settleIdle();
    },
    detach() {
      director.attach(null);
    },
    register(painter) {
      painters.add(painter);
      try { painter(snapshot()); } catch { /* garnish */ }
      return () => { painters.delete(painter); };
    },
    stop() {
      queue.length = 0;
      interrupt();
      try { sink?.hide(); } catch { /* garnish */ }
      settleIdle();
    },
    get queueIds() { return queue.map((l) => l.id); },
    get playingId() { return playing?.id ?? null; },
    get dropped() { return dropped; },
    get missing() { return missing; },
    whenIdle() {
      if (!busy && !queue.length && !playing) return Promise.resolve();
      return new Promise((resolve) => { idleWaiters.push(resolve); });
    },
  };
  return director;
}

interface Prefs { enabled: boolean; volume: number }

function readPrefs(storage: Memory | null): Prefs {
  const fallback: Prefs = { enabled: true, volume: DEFAULT_VOICE_VOLUME };
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(VOICE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : true,
      volume: typeof parsed.volume === "number" && Number.isFinite(parsed.volume)
        ? clamp01(parsed.volume)
        : DEFAULT_VOICE_VOLUME,
    };
  } catch {
    return fallback;
  }
}

function writePrefs(storage: Memory | null, prefs: Prefs): void {
  if (!storage) return;
  try { storage.setItem(VOICE_STORAGE_KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
}

function readSkipped(session: Memory | null): boolean {
  try { return session?.getItem(VOICE_SKIP_KEY) === "1"; } catch { return false; }
}

/** The match and the settings sheet share this one director. */
export const voice: VoiceDirector = createVoice();

export function registerVoicePainter(painter: (settings: VoiceSettings) => void): () => void {
  return voice.register(painter);
}

export function setVoiceEnabled(on: boolean): void { voice.setEnabled(on); }
export function setVoiceVolume(v: number): void { voice.setVolume(v); }
export function voiceSettings(): VoiceSettings { return voice.settings(); }

// Global mute is the SFX bus. A painter here stops a line that was already
// speaking when the player hits 🔇, without waiting for the next cue.
try {
  registerSoundPainter((enabled) => voice.noteSound(enabled));
} catch { /* the bus is garnish; voice subtitles still stand */ }
