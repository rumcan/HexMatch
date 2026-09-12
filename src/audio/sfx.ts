// ══════════════════════════════════════════════════════════════════════════
// SFX-01 — the public face of the audio layer, and the wire into the DOM.
//
// Two halves:
//
//   `sfx.play("pave", { step: 4 })`   what game code calls when something
//                                     happens. Gated (engine rule 3): nothing
//                                     sounds before the player's first real
//                                     gesture, and nothing sounds at all once
//                                     the HUD's 🔇 has been pressed.
//
//   `attachUiSound()`                 one delegation on `document` that gives
//                                     EVERY control in the game a hover tick
//                                     and a press sound — the start screen,
//                                     the HUD, the bounty chooser, the ending
//                                     card, and any button added next month,
//                                     without a line of code at each one.
//
// The delegation is why this stays a small diff: instead of 80 `onclick`
// handlers each remembering to make a noise (and 80 that forget), the layer
// listens once, in the capture phase, and asks `cueFor(target)` what the
// element under the pointer is. A control that wants a different sound says so
// in markup — `data-sfx="coin"` — and a control that wants none says
// `data-sfx="off"` (the mute button itself does, so unmuting is the only click
// in the game that answers with a sound).
//
//   data-sfx="<cue>"          this element presses as that cue
//   data-sfx="off"            no hover, no press (subtree-wide)
//   data-sfx-hover="<cue>"    override the hover tick only ("off" = none)
//
// Also here: the mute toggle's state (persisted, subscribed to), the `M`
// shortcut, and `window.__sfx` — the console hook that lets a reviewer audition
// the whole catalogue without playing a match.
// ══════════════════════════════════════════════════════════════════════════
import {
  audioSettings, audioStats, audioVolume, isArmed, isAudioEnabled, setAudioEnabled,
  setAudioVolume, toggleAudio, unlock,
} from "./engine";
import { CUE_NAMES, CUE_NOTES, isCue, playCue, type Cue, type CueOptions } from "./cues";

/** Every element that may make a sound when the pointer meets it. */
const INTERACTIVE =
  "button, select, summary, [role='button'], [role='tab'], [role='menuitem'], .gem, [data-sfx]";

/** A control that is out of order says nothing — silence is its own feedback. */
function isOut(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled === true
    || el.getAttribute("aria-disabled") === "true"
    || el.classList.contains("disabled");
}

/** An element that takes text must never be second-guessed by the shortcut. */
function isTextEntry(el: EventTarget | null): boolean {
  const node = el instanceof Element ? el : null;
  if (!node) return false;
  const field = node.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");
  if (field) return true;
  return (node as HTMLElement).isContentEditable === true;
}

function elementAt(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const hit = target.closest(INTERACTIVE);
  if (!hit) return null;
  const el = hit as HTMLElement;
  if (el.dataset.sfx === "off" || el.closest("[data-sfx='off']")) return null;
  return isOut(el) ? null : el;
}

/** What an element sounds like when PRESSED (the delegation and the tests agree here). */
export function pressCueFor(target: EventTarget | null): Cue | null {
  const el = elementAt(target);
  if (!el) return null;
  // A <select> is opened by the press but chosen by the change, and the change
  // is the interaction that means something — the `onChange` handler below
  // voices it. Pressing one therefore stays silent rather than saying the same
  // thing twice. (An explicit `data-sfx` still wins: markup beats convention.)
  if (el.tagName === "SELECT" && !el.dataset.sfx) return null;
  const named = el.dataset.sfx;
  if (named && isCue(named)) return named;
  // The board's tokens are picked up, not clicked; tabs and the mobile view
  // switcher slide. Everything else is a brass key.
  if (el.classList.contains("gem")) return "select";
  if (el.dataset.tab || el.classList.contains("tab") || el.classList.contains("mnav-btn")) return "tab";
  return "click";
}

/** What an element sounds like when the pointer arrives (touch is exempt). */
export function hoverCueFor(target: EventTarget | null): Cue | null {
  const el = elementAt(target);
  if (!el) return null;
  const named = el.dataset.sfxHover;
  if (named === "off") return null;
  if (named && isCue(named)) return named;
  return "hover";
}

// ── the sound controls that mirror the setting ──────────────────────────────
type Painter = (enabled: boolean, volume: number) => void;

/**
 * Every 🔊/🔇 control in the page, as a paint callback. They live here rather
 * than per-UI because `createOriginalUi` has no teardown contract of its own —
 * it is built once per match and its DOM is thrown away whole — so a painter
 * from a finished match stays registered and writes to a detached button,
 * which costs one function call per toggle and cannot be heard. The `M`
 * shortcut and `__sfx.mute()` both repaint through this set, which is why the
 * HUD button can never disagree with the actual state.
 */
const painters = new Set<Painter>();

/** Register a control painter; it is called immediately with the current state. */
export function registerSoundPainter(painter: Painter): () => void {
  painters.add(painter);
  try {
    const { enabled, volume } = audioSettings();
    painter(enabled, volume);
  } catch {
    /* a bad painter must not mute the game */
  }
  return () => { painters.delete(painter); };
}

/** Repaint every registered sound control from the current setting. */
export function paintSoundControls(): void {
  const { enabled, volume } = audioSettings();
  for (const painter of painters) {
    try { painter(enabled, volume); } catch { /* ditto */ }
  }
}

/** The glyph the HUD's toggle wears. */
export function soundGlyph(enabled: boolean): string {
  return enabled ? "🔊" : "🔇";
}

/** The tooltip/aria text that goes with it. */
export function soundLabel(enabled: boolean): string {
  return enabled ? "Sound on — click to mute (M)" : "Sound off — click to unmute (M)";
}

// ── the public API ──────────────────────────────────────────────────────────
export interface SfxApi {
  /** Sound a moment of the game. Silently no-ops until the first real gesture. */
  play(cue: Cue, opts?: CueOptions): void;
  /** Record a REAL user gesture: creates/resumes the context and opens the gate. */
  unlock(): void;
  isArmed(): boolean;
  isEnabled(): boolean;
  setEnabled(on: boolean): void;
  /** Flip mute; returns the new state. */
  toggle(): boolean;
  volume(): number;
  setVolume(v: number): void;
  cues(): readonly Cue[];
  notes(): Record<Cue, string>;
  /** What a DOM target would sound like — the delegation's whole policy. */
  cueFor(target: EventTarget | null): Cue | null;
  hoverFor(target: EventTarget | null): Cue | null;
  /** Install the document-wide hover/press/shortcut delegation (idempotent). */
  attach(scope?: HTMLElement | Document, options?: AttachOptions): () => void;
  /** Play the whole catalogue, one cue every `gapMs`. Returns a cancel. */
  audition(gapMs?: number): () => void;
  stats(): ReturnType<typeof audioStats>;
}

export const sfx: SfxApi = {
  play: (cue, opts) => playCue(cue, opts),
  unlock: () => unlock(),
  isArmed: () => isArmed(),
  isEnabled: () => isAudioEnabled(),
  setEnabled: (on) => { setAudioEnabled(on); paintSoundControls(); },
  /**
   * Flip mute. Sound is coming back (or going away), so the switch answers with
   * its own small ping on the way ON — one place, whichever way it was flipped
   * (the HUD button, `M`, or `__sfx.mute()` in the console). Muting is silent:
   * a sound to say "you will hear nothing now" is a joke that stops being funny
   * by the second match.
   */
  toggle: () => {
    const on = toggleAudio();
    paintSoundControls();
    if (on) playCue("select");
    return on;
  },
  volume: () => audioVolume(),
  setVolume: (v) => { setAudioVolume(v); paintSoundControls(); },
  cues: () => CUE_NAMES,
  notes: () => CUE_NOTES,
  cueFor: pressCueFor,
  hoverFor: hoverCueFor,
  attach: attachUiSound,
  audition,
  stats: () => audioStats(),
};

// ── the delegation ──────────────────────────────────────────────────────────
export interface AttachOptions {
  /**
   * The gesture test: `event.isTrusted` in every real page. Injectable because
   * jsdom defines `isTrusted` as an OWN, NON-CONFIGURABLE getter on each event
   * it builds, so a test can neither redefine it nor subclass around it — and
   * "a synthetic event makes no sound" is precisely the property
   * `tests/unit/iso-game.test.ts` depends on when it counts oscillators to prove
   * PP-14's choir sang. Tests that want to exercise the delegation itself pass
   * `() => true`; nothing in `src/` ever does.
   */
  isTrusted?: (event: Event) => boolean;
}

const attached = new WeakSet<object>();
let hoverEl: Element | null = null;
let hoverAt = 0;
let auditTimer = 0;

/**
 * Give a scope (default: the whole document) its hover ticks, press sounds,
 * select-change slides and the `M` shortcut. Idempotent per scope, and the
 * returned function removes exactly what this installed.
 *
 * Every handler starts from `isTrusted`: a synthetic event (a unit test's
 * `.click()`, a jsdom `dispatchEvent`) neither opens the gate nor makes a
 * sound, which is both what the autoplay policy asks for and what keeps the
 * headless suites silent — including PP-14's, which counts oscillators to
 * prove the choir sang.
 */
export function attachUiSound(
  scope: HTMLElement | Document = document,
  options: AttachOptions = {},
): () => void {
  if (typeof document === "undefined") return () => {};
  const host: HTMLElement | Document = scope ?? document;
  if (attached.has(host as object)) return () => {};
  // `main.tsx` attaches to the document, and `ui.ts` attaches to the HUD root so
  // a chrome mounted without App (the e2e specs, the headless suites) is covered
  // too. In the real app BOTH would then see one click — capture on the document
  // and capture on the root — and the second play would only be saved by the
  // cue's own gap. An ancestor scope already listening makes this one redundant,
  // so it stands down instead of leaning on a throttle.
  if (host !== document && attached.has(document)) return () => {};
  attached.add(host as object);
  const isReal = options.isTrusted ?? ((event: Event) => event.isTrusted);

  const onDown = (e: Event) => {
    const pe = e as PointerEvent;
    if (!isReal(e)) return;
    unlock();
    const cue = pressCueFor(pe.target);
    if (cue) playCue(cue);
  };

  const onOver = (e: Event) => {
    const pe = e as PointerEvent;
    // Touch has no hover: on a phone, `pointerover` is a compatibility event
    // fired an instant before the tap, and two sounds for one touch is a stutter.
    if (!isReal(e) || pe.pointerType === "touch") return;
    const el = e.target instanceof Element ? e.target.closest(INTERACTIVE) : null;
    const t = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (el && el === hoverEl && t - hoverAt < 1200) return;   // same control, still under the pointer
    hoverEl = el;
    hoverAt = t;
    if (!el) return;
    unlock();
    const cue = hoverCueFor(el);
    if (cue) playCue(cue);
  };

  // Keyboard players get the same feedback: Enter/Space on a focused control
  // sounds its press cue. (`click` is never listened to, so a real mouse press
  // cannot double up with this.)
  const onKey = (e: Event) => {
    const ke = e as KeyboardEvent;
    if (!isReal(e) || ke.metaKey || ke.ctrlKey || ke.altKey) return;
    if (ke.key === "m" || ke.key === "M") {
      if (isTextEntry(ke.target)) return;
      // Safe to swallow: no control in the game is labelled "m".
      ke.preventDefault();
      unlock();
      sfx.toggle();
      return;
    }
    if (ke.key !== "Enter" && ke.key !== " " && ke.key !== "Spacebar") return;
    if (isTextEntry(ke.target)) return;
    unlock();
    const cue = pressCueFor(ke.target);
    if (cue) playCue(cue);
  };

  // The two `<select>`s (rival difficulty, the trade composer) have no press
  // moment of their own — the change IS the interaction.
  const onChange = (e: Event) => {
    if (!isReal(e)) return;
    const el = e.target instanceof Element ? e.target : null;
    if (!el || el.tagName !== "SELECT") return;
    if (el.closest("[data-sfx='off']")) return;   // the opt-out covers the subtree
    unlock();
    playCue("tab");
  };

  const opts = { capture: true, passive: true } as const;
  host.addEventListener("pointerdown", onDown, opts);
  host.addEventListener("pointerover", onOver, opts);
  host.addEventListener("keydown", onKey, opts);
  host.addEventListener("change", onChange, opts);
  installSfxDebug();

  return () => {
    host.removeEventListener("pointerdown", onDown, opts);
    host.removeEventListener("pointerover", onOver, opts);
    host.removeEventListener("keydown", onKey, opts);
    host.removeEventListener("change", onChange, opts);
    attached.delete(host as object);
  };
}

/**
 * Walk the catalogue out loud. Called from the console (`__sfx.audition()`) or
 * from a debug build's own button; `unlock()` first, because the console is not
 * a gesture and a context that was never started cannot be started by nothing.
 */
export function audition(gapMs = 720): () => void {
  unlock();
  cancelAudition();
  let i = 0;
  const step = () => {
    if (i >= CUE_NAMES.length) { auditTimer = 0; return; }
    const cue = CUE_NAMES[i++];
    playCue(cue, cue === "place" || cue === "pave" ? { step: 3 } : undefined);
    auditTimer = typeof window !== "undefined" ? window.setTimeout(step, gapMs) : 0;
  };
  step();
  return cancelAudition;
}

export function cancelAudition(): void {
  if (auditTimer && typeof window !== "undefined") window.clearTimeout(auditTimer);
  auditTimer = 0;
}

// ── window.__sfx ────────────────────────────────────────────────────────────
/** Is this a dev build? Isolated so `debugWanted` stays testable in plain node. */
const devBuild = (): boolean => {
  try {
    return import.meta.env?.DEV === true;
  } catch {
    return false;
  }
};

/**
 * The same gate C5 uses for `window.__iso` — DEV builds always, a production
 * build only when the URL asks (`?iso-debug`, `?debug`, `?sfx-debug`). Written
 * out here rather than imported from `src/iso/debug.ts` on purpose: that module
 * pulls in the renderer, the atlas and the art graph, and the audio layer must
 * stay importable by anything (including a unit test in a bare node
 * environment) without dragging the map with it.
 */
export function debugWanted(
  search = typeof location !== "undefined" ? location.search : "",
  dev = devBuild(),
): boolean {
  try {
    if (dev) return true;
    const qi = search.indexOf("?");
    const q = new URLSearchParams(qi >= 0 ? search.slice(qi + 1) : search);
    const v = q.get("sfx-debug") ?? q.get("iso-debug") ?? q.get("debug");
    return v !== null && v !== "0" && v !== "false";
  } catch {
    return false;
  }
}

/** `window.__sfx` — audition, mute and measure the mix without playing a match. */
export function installSfxDebug(): void {
  try {
    if (typeof window === "undefined" || !debugWanted()) return;
    const w = window as unknown as Record<string, unknown>;
    if (w.__sfx) return;
    w.__sfx = {
      play: (cue: string, opts?: CueOptions) => {
        unlock();
        if (!isCue(cue)) return `unknown cue — try one of: ${CUE_NAMES.join(", ")}`;
        playCue(cue, opts);
        return `played ${cue}`;
      },
      audition,
      stop: cancelAudition,
      cues: () => CUE_NAMES.slice(),
      notes: () => ({ ...CUE_NOTES }),
      mute: () => { sfx.setEnabled(false); return "muted"; },
      unmute: () => { sfx.setEnabled(true); return "unmuted"; },
      toggle: () => (sfx.toggle() ? "on" : "off"),
      volume: (v?: number) => (v === undefined ? sfx.volume() : (sfx.setVolume(v), sfx.volume())),
      settings: () => audioSettings(),
      stats: () => audioStats(),
      armed: () => isArmed(),
      help: "play(cue) · audition() · stop() · cues() · notes() · mute() · unmute() · toggle() · volume(0..1) · stats()",
    };
  } catch {
    /* garnish */
  }
}
