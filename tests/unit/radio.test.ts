// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// MUSIC-1 (#377) — the mini radio.
//
// The station URL is EMPTY in the repo (the owner supplies it), so the tests
// pin the contract the game depends on with no stream at all:
//
//   1. THE MACHINE IS PURE. Every transition of off | idle | loading | playing
//      | paused | offline, including the ones that must NOT move (a late
//      `loaded` after a pause, a `retry` while the tab is hidden).
//   2. NO AUTOPLAY. `play()` is only ever called behind the user's tap, the
//      element is `preload="none"`, and nothing opens a connection at import.
//   3. RESILIENCE. An empty or dead URL reads "Radio offline" and retries on
//      the 5/10/20/30 s backoff — never a throw, never a stuck spinner.
//   4. ITS OWN VOLUME, DUCKED 30% UNDER A VOICE LINE, faded over ~200 ms.
//   5. THE SETTINGS ROUND-TRIP (radio on/off, player shown/hidden, volume) in
//      the same storage the voice toggle uses.
//   6. THE PILL: ▶/⏸ with aria-pressed, the status text, the volume popover,
//      hidden when "Show radio player" is off, inert when Radio is off.
// ══════════════════════════════════════════════════════════════════════════
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DUCK_FADE_MS, DUCK_RATIO, DEFAULT_RADIO_VOLUME, RADIO_DEFAULTS,
  RADIO_OFFLINE_TEXT, RADIO_RETRY_CAP_MS, RADIO_RETRY_MS, RADIO_STATION_NAME,
  RADIO_STORAGE_KEY, backoffDelayMs, createRadio, effectiveRadioVolume,
  hasStream, mountRadioWidget, radioBusy, radioGlyph, radioInit, radioReduce,
  radioText, readRadioSettings, writeRadioSettings,
  type RadioAudio, type RadioDocument, type RadioMachine, type RadioTimers,
} from "../../src/audio/radio";

// ── the fake element ───────────────────────────────────────────────────────
interface FakeAudio extends RadioAudio {
  plays: number;
  pauses: number;
  loads: number;
  /** Fire one of the element's own events at the adapter. */
  emit(type: "playing" | "error" | "ended"): void;
  playing(): boolean;
}

function fakeAudio(): FakeAudio {
  const listeners = new Map<string, Array<() => void>>();
  const a: FakeAudio = {
    volume: 1,
    src: "",
    preload: "none",
    plays: 0,
    pauses: 0,
    loads: 0,
    play() { a.plays += 1; a.playingState = true; return Promise.resolve(); },
    pause() { a.pauses += 1; a.playingState = false; },
    load() { a.loads += 1; },
    addEventListener(type, fn) {
      const set = listeners.get(type) ?? [];
      set.push(fn);
      listeners.set(type, set);
    },
    emit(type) { for (const fn of [...(listeners.get(type) ?? [])]) fn(); },
    playing: () => a.playingState === true,
    playingState: false,
  } as FakeAudio & { playingState: boolean };
  return a;
}

interface Mem { getItem(k: string): string | null; setItem(k: string, v: string): void }
const mem = (init: Record<string, string> = {}): Mem => ({
  getItem: (k) => (k in init ? init[k] : null),
  setItem: (k, v) => { init[k] = v; },
});

/** A document whose visibility a test can flip, plus the listener registry. */
function fakeDoc() {
  const box = { visibility: "visible", fns: [] as Array<() => void> };
  const doc: RadioDocument = {
    get visibilityState() { return box.visibility; },
    addEventListener(_type: string, fn: () => void) { box.fns.push(fn); },
    removeEventListener(_type: string, fn: () => void) { box.fns = box.fns.filter((f) => f !== fn); },
  };
  return {
    doc,
    listeners: () => box.fns.length,
    fire(next: "hidden" | "visible") { box.visibility = next; for (const fn of [...box.fns]) fn(); },
  };
}

/** A player wired to fakes, with the real clock unless a test fakes it. */
function harness(over: {
  url?: string; audio?: RadioAudio | null; storage?: Mem | null;
  doc?: RadioDocument | null; fadeMs?: number; loadTimeoutMs?: number;
} = {}) {
  const audio = over.audio === undefined ? fakeAudio() : over.audio;
  const store = over.storage === undefined ? mem() : over.storage;
  const r = createRadio({
    url: over.url === undefined ? "https://radio.test/live.mp3" : over.url,
    audio,
    storage: store,
    doc: over.doc === undefined ? null : over.doc,
    fadeMs: over.fadeMs ?? 0,          // 0 = snap, so the maths is not a timer
    loadTimeoutMs: over.loadTimeoutMs ?? 12_000,
    makeAudio: () => audio,
    reducedMotion: () => false,
  });
  return { r, audio: audio as FakeAudio, store };
}

/** The transition helper: what does `event` do to `state`? */
function go(state: RadioMachine, event: Parameters<typeof radioReduce>[1], url = "u"): RadioMachine {
  return radioReduce(state, event, url);
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* no storage */ }
});

afterEach(() => {
  vi.useRealTimers();
});

// ══ 1. the pure machine ════════════════════════════════════════════════════

describe("MUSIC-1 state machine", () => {
  it("starts idle when the radio is on, and off when the switch is off", () => {
    expect(radioInit(true)).toMatchObject({ status: "idle", enabled: true, want: false });
    expect(radioInit(false)).toMatchObject({ status: "off", enabled: false });
    // Nothing plays at boot: idle is the "on, but nobody has asked yet" state.
    expect(radioInit(true).ducked).toBe(false);
  });

  it("walks idle → loading → playing and back through pause", () => {
    let s = radioInit(true);
    s = go(s, "play");
    expect(s).toMatchObject({ status: "loading", want: true });
    s = go(s, "loaded");
    expect(s).toMatchObject({ status: "playing", want: true });
    s = go(s, "pause");
    expect(s).toMatchObject({ status: "paused", want: false });
    s = go(s, "play");
    expect(s.status).toBe("loading");
  });

  it("ignores a play while the switch is off, and goes idle (not playing) when it comes back", () => {
    let s = go(radioInit(false), "play");
    expect(s.status).toBe("off");
    s = go(s, "enable");
    expect(s).toMatchObject({ status: "idle", enabled: true, want: false });
    // Resume-by-switch is deliberately NOT a resume.
    expect(s.status).not.toBe("playing");
  });

  it("disable stops and disconnects from anywhere, clearing the duck and the backoff", () => {
    let s: RadioMachine = { ...radioInit(true), status: "playing", want: true, ducked: true, failures: 3, resume: true };
    s = go(s, "disable");
    expect(s).toMatchObject({ status: "off", enabled: false, want: false, ducked: false, failures: 0, resume: false });
  });

  it("error → offline and counted; retry only while on, wanted and visible", () => {
    let s = go(go(radioInit(true), "play"), "loaded");
    s = go(s, "error");
    expect(s).toMatchObject({ status: "offline", failures: 1, want: true });
    s = go(s, "retry");
    expect(s).toMatchObject({ status: "loading", failures: 1 });

    // A hidden tab never retries…
    let h: RadioMachine = { ...radioInit(true), status: "offline", want: true, failures: 1, hidden: true };
    expect(go(h, "retry").status).toBe("offline");
    // …and neither does a player who has stopped asking for audio.
    let p: RadioMachine = { ...radioInit(true), status: "offline", want: false, failures: 1 };
    expect(go(p, "retry").status).toBe("offline");
    // …nor a radio that is switched off.
    let o: RadioMachine = { ...radioInit(false), status: "offline", want: true, failures: 1 };
    expect(go(o, "retry").status).toBe("offline");
  });

  it("a pause during loading keeps the spinner from promoting itself later", () => {
    let s = go(radioInit(true), "play");
    s = go(s, "pause");
    expect(s.status).toBe("paused");
    // The element's `playing` event can still land after the pause.
    s = go(s, "loaded");
    expect(s.status).toBe("paused");
    expect(go(s, "loaded").want).toBe(false);
  });

  it("hidden pauses a playing stream and visible resumes it — and nothing else", () => {
    let s = go(go(radioInit(true), "play"), "loaded");
    s = go(s, "hidden");
    expect(s).toMatchObject({ status: "paused", resume: true, want: true, hidden: true });
    s = go(s, "visible");
    expect(s).toMatchObject({ status: "loading", hidden: false, resume: false });

    // Idle (never tapped): hiding and showing must not start the music.
    let i = radioInit(true);
    i = go(i, "hidden");
    i = go(i, "visible");
    expect(i).toMatchObject({ status: "idle", want: false });

    // A user pause is not a resume either.
    let paused = go(go(go(radioInit(true), "play"), "loaded"), "pause");
    paused = go(paused, "hidden");
    paused = go(paused, "visible");
    expect(paused.status).toBe("paused");
  });

  it("a failure while hidden resumes on visible (it was playing before the hide)", () => {
    let s = go(go(radioInit(true), "play"), "loaded");
    s = go(s, "hidden");
    s = go(s, "error");
    expect(s).toMatchObject({ status: "offline", resume: true, hidden: true });
    s = go(s, "visible");
    expect(s.status).toBe("loading");
  });

  it("ducks and restores without touching the transport", () => {
    let s = go(go(radioInit(true), "play"), "loaded");
    s = go(s, "duckStart");
    expect(s).toMatchObject({ status: "playing", ducked: true });
    s = go(s, "duckEnd");
    expect(s).toMatchObject({ status: "playing", ducked: false });
  });

  it("returns the SAME object when nothing changed, so a repaint can be skipped", () => {
    const idle = radioInit(true);
    expect(go(idle, "loaded")).toBe(idle);
    expect(go(idle, "retry")).toBe(idle);
    expect(go(idle, "duckEnd")).toBe(idle);        // already un-ducked
    const ducked = go(idle, "duckStart");
    expect(ducked).not.toBe(idle);
    expect(go(ducked, "duckStart")).toBe(ducked);
  });
});

// ══ 2. an empty / dead stream ══════════════════════════════════════════════

describe("MUSIC-1 an empty or dead stream", () => {
  it("ships with an empty URL and treats it as offline, not as a crash", () => {
    // The shipped constant is empty on purpose (the owner supplies the URL).
    expect(hasStream("")).toBe(false);
    expect(hasStream("   ")).toBe(false);
    expect(hasStream("https://radio.test/live.mp3")).toBe(true);

    const s = go(radioInit(true), "play", "");
    expect(s).toMatchObject({ status: "offline", want: true, failures: 0 });
    // An unconfigured URL cannot configure itself: no backoff, no spinner.
    expect(go(s, "retry", "").status).toBe("offline");
    expect(radioText(s.status, RADIO_STATION_NAME)).toBe(RADIO_OFFLINE_TEXT);
  });

  it("never throws and never opens a connection when the URL is empty", () => {
    const { r, audio } = harness({ url: "" });
    expect(() => { r.play(); r.toggle(); r.pause(); r.duck(true); r.duck(false); }).not.toThrow();
    expect(r.machine.status).toBe("offline");
    expect(audio.plays).toBe(0);
    expect(audio.src).toBe("");
    expect(r.settings.enabled).toBe(true);
  });

  it("survives an element that refuses to play", async () => {
    const audio = fakeAudio();
    audio.play = () => { audio.plays += 1; return Promise.reject(new Error("NotAllowedError")); };
    const { r } = harness({ audio });
    r.play();
    await Promise.resolve();
    await Promise.resolve();
    expect(r.machine.status).toBe("offline");
    expect(r.machine.failures).toBe(1);
  });

  it("survives a browser with no Audio element at all", () => {
    const r = createRadio({ url: "https://radio.test/live.mp3", makeAudio: () => null, storage: null, doc: null });
    expect(() => r.play()).not.toThrow();
    expect(r.machine.status).toBe("offline");
  });
});

// ══ 3. the adapter: element, timers, backoff ═══════════════════════════════

describe("MUSIC-1 the element and the backoff", () => {
  it("opens the stream on a tap only, with preload=none and no crossOrigin tricks", () => {
    const { r, audio } = harness();
    expect(audio.plays).toBe(0);
    expect(audio.src).toBe("");
    expect(audio.preload).toBe("none");
    expect("crossOrigin" in audio).toBe(false);

    r.play();
    expect(audio.plays).toBe(1);
    expect(audio.src).toBe("https://radio.test/live.mp3");
    expect(r.machine.status).toBe("loading");

    // The element's own `playing` event is what promotes it — not the tap.
    audio.emit("playing");
    expect(r.machine.status).toBe("playing");
    expect(audio.volume).toBeCloseTo(DEFAULT_RADIO_VOLUME);
  });

  it("pauses on the tap, and resumes through loading", () => {
    const { r, audio } = harness();
    r.play();
    audio.emit("playing");
    r.toggle();
    expect(r.machine.status).toBe("paused");
    expect(audio.pauses).toBeGreaterThan(0);
    r.toggle();
    expect(r.machine.status).toBe("loading");
    expect(audio.plays).toBe(2);
  });

  it("turning the radio off releases the connection: pause, src = \"\", load()", () => {
    const { r, audio } = harness();
    r.play();
    audio.emit("playing");
    const pauses = audio.pauses;
    r.setEnabled(false);
    expect(r.machine.status).toBe("off");
    expect(audio.src).toBe("");
    expect(audio.loads).toBeGreaterThanOrEqual(1);
    expect(audio.pauses).toBeGreaterThan(pauses);
    // And nothing can bring it back without the switch.
    r.play();
    expect(audio.plays).toBe(1);
  });

  it("retries a dead stream on 5 s, 10 s, 20 s, then every 30 s", () => {
    // Three rungs and then the cap; a nonpositive count waits the first rung.
    expect(backoffDelayMs(0)).toBe(RADIO_RETRY_MS[0]);
    expect(backoffDelayMs(1)).toBe(5_000);
    expect(backoffDelayMs(2)).toBe(10_000);
    expect(backoffDelayMs(3)).toBe(20_000);
    expect(backoffDelayMs(4)).toBe(RADIO_RETRY_CAP_MS);
    expect(backoffDelayMs(9)).toBe(30_000);
    expect(backoffDelayMs(Number.NaN)).toBe(5_000);
    expect(RADIO_RETRY_MS).toEqual([5_000, 10_000, 20_000]);
    expect(RADIO_RETRY_CAP_MS).toBe(30_000);
  });

  it("schedules those retries with the real clock faked, and stops when switched off", () => {
    vi.useFakeTimers();
    const { r, audio } = harness({ loadTimeoutMs: 0 });
    r.play();
    audio.emit("error");
    expect(r.machine).toMatchObject({ status: "offline", failures: 1 });

    // 1st backoff: 5 s. Nothing happens at 4.9 s.
    vi.advanceTimersByTime(4_900);
    expect(audio.plays).toBe(1);
    vi.advanceTimersByTime(100);
    expect(audio.plays).toBe(2);
    expect(r.machine.status).toBe("loading");
    expect(r.machine.failures).toBe(1);      // still the first failure

    // Fail again → 10 s, not 5.
    audio.emit("error");
    expect(r.machine.failures).toBe(2);
    vi.advanceTimersByTime(5_000);
    expect(audio.plays).toBe(2);
    vi.advanceTimersByTime(5_000);
    expect(audio.plays).toBe(3);

    // Third failure → 20 s; the fourth → the 30 s cap.
    audio.emit("error");
    vi.advanceTimersByTime(19_000);
    expect(audio.plays).toBe(3);
    vi.advanceTimersByTime(1_000);
    expect(audio.plays).toBe(4);
    audio.emit("error");
    vi.advanceTimersByTime(29_000);
    expect(audio.plays).toBe(4);
    vi.advanceTimersByTime(1_000);
    expect(audio.plays).toBe(5);

    // Off: the retry timer is cancelled with the connection.
    r.setEnabled(false);
    vi.advanceTimersByTime(120_000);
    expect(audio.plays).toBe(5);
    expect(r.machine.status).toBe("off");
  });

  it("does not retry while the tab is hidden, and resumes it on visible", () => {
    vi.useFakeTimers();
    const d = fakeDoc();
    const { r, audio } = harness({ doc: d.doc, loadTimeoutMs: 0 });
    r.play();
    audio.emit("playing");
    d.fire("hidden");
    expect(r.machine.status).toBe("paused");
    expect(audio.playing()).toBe(false);

    // The stream dies in the background: offline, but no timer is armed.
    audio.emit("error");
    expect(r.machine.status).toBe("offline");
    const plays = audio.plays;
    vi.advanceTimersByTime(60_000);
    expect(audio.plays).toBe(plays);

    d.fire("visible");
    expect(r.machine.status).toBe("loading");
    expect(audio.plays).toBe(plays + 1);
  });

  it("pauses while hidden and resumes only when it was playing", () => {
    const d = fakeDoc();
    const { r, audio } = harness({ doc: d.doc, loadTimeoutMs: 0 });
    d.fire("hidden");
    d.fire("visible");
    expect(audio.plays).toBe(0);
    expect(r.machine.status).toBe("idle");

    r.play();
    audio.emit("playing");
    d.fire("hidden");
    expect(r.machine.status).toBe("paused");
    d.fire("visible");
    expect(r.machine.status).toBe("loading");
    expect(audio.plays).toBe(2);
  });

  it("treats a stream that never answers as an error (the spinner cannot stick)", () => {
    vi.useFakeTimers();
    const { r, audio } = harness({ loadTimeoutMs: 12_000 });
    r.play();
    expect(r.machine.status).toBe("loading");
    vi.advanceTimersByTime(11_000);
    expect(r.machine.status).toBe("loading");
    vi.advanceTimersByTime(1_000);
    expect(r.machine.status).toBe("offline");
    expect(audio.plays).toBe(1);
  });

  it("keeps a fired-and-forgotten error from re-arming after dispose", () => {
    vi.useFakeTimers();
    const d = fakeDoc();
    const { r, audio } = harness({ doc: d.doc, loadTimeoutMs: 0 });
    r.play();
    audio.emit("error");
    expect(d.listeners()).toBe(1);
    r.dispose();
    expect(d.listeners()).toBe(0);
    vi.advanceTimersByTime(120_000);
    expect(audio.plays).toBe(1);
  });
});

// ══ 4. the volume and the duck ═════════════════════════════════════════════

describe("MUSIC-1 volume and ducking", () => {
  it("ducks to 30% of the set volume and back", () => {
    expect(effectiveRadioVolume(0.5, false)).toBeCloseTo(0.5);
    expect(effectiveRadioVolume(0.5, true)).toBeCloseTo(0.5 * DUCK_RATIO);
    expect(effectiveRadioVolume(1, true)).toBeCloseTo(0.3);
    expect(effectiveRadioVolume(0, true)).toBe(0);
    // Out-of-range input is clamped, never NaN.
    expect(effectiveRadioVolume(2, false)).toBe(1);
    expect(effectiveRadioVolume(Number.NaN, false)).toBeCloseTo(DEFAULT_RADIO_VOLUME);
  });

  it("fades the element to 30% over ~200 ms and restores it", () => {
    vi.useFakeTimers();
    const { r, audio } = harness({ fadeMs: DUCK_FADE_MS });
    r.play();
    audio.emit("playing");
    expect(audio.volume).toBeCloseTo(0.5);

    r.duck(true);
    expect(audio.volume).toBeCloseTo(0.5);            // the fade has not moved yet
    vi.advanceTimersByTime(DUCK_FADE_MS / 2);
    expect(audio.volume).toBeLessThan(0.5);
    expect(audio.volume).toBeGreaterThan(0.15);
    vi.advanceTimersByTime(DUCK_FADE_MS);
    expect(audio.volume).toBeCloseTo(0.15);           // 0.5 * 30%

    r.duck(false);
    vi.advanceTimersByTime(DUCK_FADE_MS);
    expect(audio.volume).toBeCloseTo(0.5);
    expect(r.machine.status).toBe("playing");
  });

  it("snaps the duck when the player asked for less motion", () => {
    const audio = fakeAudio();
    const r = createRadio({
      url: "u", audio, storage: null, doc: null, makeAudio: () => audio,
      fadeMs: DUCK_FADE_MS, reducedMotion: () => true,
    });
    r.setVolume(0.8);
    r.play();
    audio.emit("playing");
    r.duck(true);
    expect(audio.volume).toBeCloseTo(0.8 * DUCK_RATIO);
    r.duck(false);
    expect(audio.volume).toBeCloseTo(0.8);
  });

  it("the slider's volume is its own — never the SFX or voice number", () => {
    const { r, audio, store } = harness();
    r.setVolume(0.25);
    expect(r.settings.volume).toBeCloseTo(0.25);
    expect(audio.volume).toBeCloseTo(0.25);
    expect(JSON.parse(store.getItem(RADIO_STORAGE_KEY)!).volume).toBeCloseTo(0.25);
    r.setVolume(5);
    expect(r.settings.volume).toBe(1);
  });

  it("shows the station name until a metadata source has a title", () => {
    expect(radioText("playing", RADIO_STATION_NAME)).toBe(RADIO_STATION_NAME);
    expect(radioText("idle", RADIO_STATION_NAME, "Sonic — Green Hill Zone")).toBe("Sonic — Green Hill Zone");
    expect(radioText("offline", RADIO_STATION_NAME, "Sonic")).toBe(RADIO_OFFLINE_TEXT);
    expect(radioBusy("loading")).toBe(true);
    expect(radioBusy("playing")).toBe(false);
    expect(radioGlyph("playing")).toBe("❚❚");
    expect(radioGlyph("paused")).toBe("▶");
  });
});

// ══ 5. the settings round trip ═════════════════════════════════════════════

describe("MUSIC-1 settings persistence", () => {
  it("defaults to radio ON (idle), player shown, volume 0.5", () => {
    const store = mem();
    const s = readRadioSettings(store);
    expect(s).toEqual(RADIO_DEFAULTS);
    expect(RADIO_DEFAULTS).toMatchObject({ enabled: true, show: true, volume: 0.5 });
  });

  it("writes and reads back all three choices, under the voice toggle's own key shape", () => {
    const store = mem();
    writeRadioSettings(store, { enabled: false, show: false, volume: 0.35 });
    const raw = store.getItem(RADIO_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual({ enabled: false, show: false, volume: 0.35 });
    expect(readRadioSettings(store)).toEqual({ enabled: false, show: false, volume: 0.35 });
  });

  it("survives a hand-edited or hostile stored value", () => {
    expect(readRadioSettings(mem({ [RADIO_STORAGE_KEY]: "not json" }))).toEqual(RADIO_DEFAULTS);
    expect(readRadioSettings(mem({ [RADIO_STORAGE_KEY]: "null" }))).toEqual(RADIO_DEFAULTS);
    expect(readRadioSettings(mem({ [RADIO_STORAGE_KEY]: JSON.stringify({ enabled: "yes", volume: 42 }) })))
      .toEqual({ enabled: true, show: true, volume: 1 });
    expect(readRadioSettings(null)).toEqual(RADIO_DEFAULTS);
    expect(() => writeRadioSettings(null, RADIO_DEFAULTS)).not.toThrow();
  });

  it("a reload keeps the switches: a fresh player reads the previous one's storage", () => {
    const store = mem();
    const first = harness({ storage: store });
    first.r.setEnabled(false);
    first.r.setShow(false);
    first.r.setVolume(0.7);
    // "Reload": a brand new player over the same storage.
    const second = createRadio({ url: "u", audio: fakeAudio(), storage: store, doc: null, fadeMs: 0 });
    expect(second.settings).toEqual({ enabled: false, show: false, volume: 0.7 });
    expect(second.machine.status).toBe("off");     // off means off at boot
  });

  it("show/hide never touches the transport — the music keeps playing", () => {
    const { r } = harness();
    r.play();
    r.setShow(false);
    expect(r.settings.show).toBe(false);
    expect(r.machine.status).toBe("loading");
    expect(r.machine.want).toBe(true);
  });
});

// ══ 6. the pill ════════════════════════════════════════════════════════════

describe("MUSIC-1 the pill", () => {
  function mount(over: Parameters<typeof harness>[0] = {}) {
    const h = harness(over);
    const host = document.createElement("div");
    host.className = "radio-dock";
    document.body.appendChild(host);
    const widget = mountRadioWidget(host, h.r);
    return { ...h, host, widget, pill: widget.el };
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders ▶, the station name and a volume key, with the a11y wiring", () => {
    const { pill, widget } = mount();
    expect(pill.dataset.state).toBe("idle");
    expect(pill.getAttribute("role")).toBe("group");
    expect(widget.playButton.getAttribute("aria-pressed")).toBe("false");
    expect(widget.playButton.getAttribute("aria-label")).toBe(`Play ${RADIO_STATION_NAME}`);
    expect(pill.querySelector(".radio-now")!.textContent).toBe(RADIO_STATION_NAME);
    expect(pill.querySelector(".radio-glyph")!.textContent).toBe("▶");
    expect(widget.volumeButton.getAttribute("aria-expanded")).toBe("false");
    expect(widget.slider.getAttribute("aria-label")).toBe("Radio volume");
    // The volume popover is shut until the 🔊 key is pressed.
    expect(pill.querySelector(".radio-slider")!.classList.contains("hidden")).toBe(true);
  });

  it("plays and pauses from the button (no autoplay before the tap)", () => {
    const { widget, pill, audio } = mount();
    expect(audio.plays).toBe(0);
    widget.playButton.click();
    expect(audio.plays).toBe(1);
    expect(pill.dataset.state).toBe("loading");
    expect(pill.dataset.busy).toBe("1");          // the spinner stands in for ▶
    audio.emit("playing");
    expect(pill.dataset.state).toBe("playing");
    expect(pill.dataset.busy).toBe("0");
    expect(pill.querySelector(".radio-glyph")!.textContent).toBe("❚❚");
    expect(widget.playButton.getAttribute("aria-pressed")).toBe("true");

    widget.playButton.click();
    expect(pill.dataset.state).toBe("paused");
    expect(widget.playButton.getAttribute("aria-pressed")).toBe("false");
    expect(pill.querySelector(".radio-glyph")!.textContent).toBe("▶");
  });

  it("opens the volume slider and drives the radio's own volume", () => {
    const { widget, pill } = mount();
    widget.volumeButton.click();
    expect(widget.volumeButton.getAttribute("aria-expanded")).toBe("true");
    expect(pill.querySelector(".radio-slider")!.classList.contains("hidden")).toBe(false);
    widget.slider.value = "0.8";
    widget.slider.dispatchEvent(new Event("input"));
    expect(widget.slider.value).toBe("0.8");
    // Painting must not fight a thumb that is still on the slider.
    widget.volumeButton.click();
    expect(widget.volumeButton.getAttribute("aria-expanded")).toBe("false");
  });

  it("says \"Radio offline\" and offers another try when the stream is dead", async () => {
    const { widget, pill, audio } = mount({ url: "" });
    widget.playButton.click();
    expect(pill.dataset.state).toBe("offline");
    expect(pill.querySelector(".radio-now")!.textContent).toBe(RADIO_OFFLINE_TEXT);
    expect(widget.playButton.getAttribute("aria-label")).toContain(RADIO_OFFLINE_TEXT);
    expect(audio.plays).toBe(0);
  });

  it("goes inert (and disabled) when Radio is off, and returns when it is on", () => {
    const { r, pill, widget } = mount();
    r.setEnabled(false);
    expect(pill.dataset.enabled).toBe("0");
    expect(widget.playButton.disabled).toBe(true);
    expect(widget.volumeButton.disabled).toBe(true);
    r.setEnabled(true);
    expect(pill.dataset.enabled).toBe("1");
    expect(widget.playButton.disabled).toBe(false);
    expect(widget.playButton.getAttribute("aria-label")).toBe(`Play ${RADIO_STATION_NAME}`);
  });

  it("hides on \"Show radio player\" off without stopping the music", () => {
    const { r, pill } = mount();
    r.play();
    r.setShow(false);
    expect(pill.hidden).toBe(true);
    expect(pill.dataset.show).toBe("0");
    r.setShow(true);
    expect(pill.hidden).toBe(false);
    expect(r.machine.want).toBe(true);
  });

  it("keeps the slider in step with the settings sheet's own slider", () => {
    const { r, widget } = mount();
    r.setVolume(0.15);
    expect(widget.slider.value).toBe("0.15");
    expect(widget.volumeButton.title).toContain("15%");
  });

  it("peeks at the station name on a long press (the phone's way back to the text)", () => {
    vi.useFakeTimers();
    const { pill, widget } = mount();
    widget.playButton.dispatchEvent(new Event("pointerdown"));
    expect(pill.dataset.peek).toBeUndefined();
    vi.advanceTimersByTime(450);
    expect(pill.dataset.peek).toBe("1");
    vi.advanceTimersByTime(1_800);
    expect(pill.dataset.peek).toBe("0");
  });

  it("tears itself down: the pill leaves the DOM and the painter is dropped", () => {
    const { r, host, widget, pill } = mount();
    expect(host.contains(pill)).toBe(true);
    widget.destroy();
    expect(host.contains(pill)).toBe(false);
    expect(() => r.setVolume(0.9)).not.toThrow();
  });
});
