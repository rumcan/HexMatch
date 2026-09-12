// ══════════════════════════════════════════════════════════════════════════
// PP-14 — the holy cross.
//
// When the player shapes a CROSS on the board (3 horizontal + 3 vertical
// overlapping on the centre gem), the board fires `onFx("cross", …)` and the
// UI answers with the praying angel and this sound: a soft choir-pad swell
// with a high bell shimmer, synthesised on the spot with the Web Audio API.
//
// Synthesised, not recorded: no asset to ship, no decode to wait for, no
// network, and the whole thing is wrapped so a missing or blocked
// AudioContext (jsdom, private browsing, autoplay policy) simply stays
// silent — sound is garnish, and garnish must never break the board.
//
// SFX-01 moved ONE thing here: the choir no longer builds its own context and
// its own path to the speakers. It sings into the shared bus
// (`src/audio/engine.ts`), which is what lets the HUD's 🔇 button mute it and
// the volume setting quieten it — a mute that spared the loudest sound in the
// game would not be a mute. The recipe below is unchanged, note for note.
//
// The choir is also the ONE sound that does not wait for the gate in
// `sfx.play()`: it answers a board event, not a click, and by the time a cross
// exists the player has already swapped gems — and `prewarmHoly()` below has
// already unlocked the context on the board's first touch.
// ══════════════════════════════════════════════════════════════════════════
import { bus, isAudioEnabled } from "../audio/engine";

/**
 * Unlock the audio context inside a user gesture. Autoplay policies only let
 * an AudioContext start (or resume) while the user is interacting, and a
 * cross resolves a beat AFTER the click that made it — so the UI calls this
 * once, on the first touch of the board, and the first choir never has to
 * fight the policy.
 */
export function prewarmHoly(): void {
  try {
    if (!isAudioEnabled()) return;   // 🔇: do not even build the graph
    bus();                       // creates the context + the shared master gain
  } catch {
    // garnish must never break the board
  }
}

export function playHoly(): void {
  try {
    if (!isAudioEnabled()) return;      // 🔇 silences the choir too
    const b = bus();
    if (!b) return;
    const ctx = b.ctx;
    const out = b.out;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});

    const t0 = ctx.currentTime + 0.03;

    // one master swell: fade in, hold, long fade out
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.linearRampToValueAtTime(0.3, t0 + 0.45);
    master.gain.setValueAtTime(0.3, t0 + 1.7);
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.6);
    master.connect(out);

    // the choir: an open A-major pad. Each voice is a detuned pair with a
    // slow pitch wobble — the detune and wobble together read as "many
    // voices", which is what makes a bare oscillator stack sound holy
    // instead of like a test tone.
    const voices = [110, 164.81, 220, 277.18, 329.63, 440];
    voices.forEach((f, i) => {
      for (const det of [-3.2, 3.2]) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(f + det, t0);

        const wob = ctx.createOscillator();
        wob.frequency.value = 4.2 + i * 0.35;
        const wobG = ctx.createGain();
        wobG.gain.value = f < 260 ? 1.6 : 3.2;
        wob.connect(wobG);
        wobG.connect(o.frequency);

        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(0.75 / voices.length, t0 + 0.35 + i * 0.06);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.4);

        o.connect(g);
        g.connect(master);
        o.start(t0);
        o.stop(t0 + 3.6);
        wob.start(t0);
        wob.stop(t0 + 3.6);
      }
    });

    // the halo bells: a soft high arpeggio that fades like struck glass
    const bells = [880, 1108.73, 1318.51, 1760];
    bells.forEach((f, i) => {
      const t = t0 + 0.1 + i * 0.13;
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + 1.6);
    });

    // The swell ends at t0 + 3.6; drop the whole graph once it has, so a
    // session that shapes many crosses does not stack dead nodes on the bus.
    const teardown = () => {
      try { master.disconnect(); } catch { /* already gone */ }
    };
    if (typeof window !== "undefined") window.setTimeout(teardown, 4200);
    else teardown();
  } catch {
    // garnish must never break the board
  }
}
