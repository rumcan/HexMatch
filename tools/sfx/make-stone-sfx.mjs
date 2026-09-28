#!/usr/bin/env node
// MATCH-2 (#566): synthesize the board's recorded cues into assets/sfx/*.mp3.
//
//   node tools/sfx/make-stone-sfx.mjs [name …] [--wav <dir>]
//
// Every file of the asset contract in src/match3/audio.ts, made from first
// principles — no samples from anywhere, so nothing to license:
//
//   swap_contact_1..4   two wenwan walnuts meeting in the hand: a hard, dry
//                       contact, the shell's short ring, the hollow body under
//                       it, and the lighter second tap as they roll together
//   swap_roll_1..3      the ridged shells rolling past each other: a fast
//                       patter of micro-ticks that slows, over a faint rub
//   settle_1..4         a stone landing on the felt-lined wooden tray
//   match_1..3          stones cracking apart: the crack, the shards, a glint
//   cascade_1..3        the shimmer over a cascade pass, bigger per depth
//   star_4, star_5      the flourishes: brass bells, a swell, a sparkle
//   finale              the Ode to Joy (Beethoven, 1824 — public domain),
//                       orchestrated here: brass and a choir on the tune,
//                       strings, bass, timpani and cymbals, in a hall
//
// THE MIX is baked into the files (peak dBFS), so the catalogue can play them
// at gain ≈ 1 beside the game's other recordings (coin/star peak ≈ −5): the
// cues that fire on every move sit well under them — clack −10, settle −14,
// roll −17 — the per-pass crack at −11, the cascade shimmer −16…−12, the
// flourishes −6/−5 and the finale −4. ASMR is close and crisp, not loud.
//
// Modal synthesis: a struck solid is a handful of damped resonances plus the
// contact transient that excites them; the variants move the resonances and
// the timing so no two plays sound alike (the game adds ±cents on top).
// Deterministic: every variant has its own seed.
//
// MP3 via lamejs (pure JS). It is not a project dependency — install it
// anywhere and point LAMEJS_DIR at the package folder, or `npm i --no-save
// lamejs@1.2.1` here. (1.2.1's module entry has a known MPEGMode bug, so the
// prebuilt `lame.all.js` bundle is loaded instead.)
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const SR = 44100;
const OUT = "assets/sfx";

// ── lamejs ──────────────────────────────────────────────────────────────────
function loadLame() {
  const dir = process.env.LAMEJS_DIR
    ?? path.dirname(createRequire(import.meta.url).resolve("lamejs/package.json"));
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(dir, "lame.all.js"), "utf8") + ";this.lamejs = lamejs;", ctx);
  return ctx.lamejs;
}

function toI16(x) {
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767)));
  return out;
}

function encodeMp3(lame, chans, kbps) {
  const enc = new lame.Mp3Encoder(chans.length, SR, kbps);
  const parts = [];
  const L = toI16(chans[0]);
  const R = chans[1] ? toI16(chans[1]) : null;
  const block = 1152;
  for (let i = 0; i < L.length; i += block) {
    const l = L.subarray(i, i + block);
    const buf = R ? enc.encodeBuffer(l, R.subarray(i, i + block)) : enc.encodeBuffer(l);
    if (buf.length) parts.push(Buffer.from(buf));
  }
  const end = enc.flush();
  if (end.length) parts.push(Buffer.from(end));
  return Buffer.concat(parts);
}

function writeWav(file, chans) {
  const n = chans[0].length, c = chans.length;
  const data = Buffer.alloc(n * c * 2);
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(chans[k][i] * 32767))), (i * c + k) * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(c, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * c * 2, 28); h.writeUInt16LE(c * 2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

// ── primitives ──────────────────────────────────────────────────────────────
const buf = (sec) => new Float32Array(Math.ceil(sec * SR));
function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** One damped resonance: `a` peak, `tau` e-fold decay (s), gliding by `glide` over its life. */
function mode(out, t0, f, a, tau, o = {}) {
  const i0 = Math.max(0, Math.round(t0 * SR));
  const len = Math.min(out.length - i0, Math.ceil(tau * 8 * SR));
  const attack = o.attack ?? 0.0004;
  const glide = o.glide ?? 1;
  let ph = o.phase ?? 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const env = Math.exp(-t / tau) * Math.min(1, t / attack);
    ph += (2 * Math.PI * f * Math.pow(glide, t / (tau * 8))) / SR;
    out[i0 + i] += a * env * Math.sin(ph);
  }
}

/** RBJ biquad as a per-sample closure. */
function biquad(type, f, q = 0.707, gainDb = 0) {
  const w = (2 * Math.PI * Math.min(f, SR * 0.45)) / SR, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === "lowpass") { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === "highpass") { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === "bandpass") { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else { const A = 10 ** (gainDb / 40); b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
  const c0 = b0 / a0, c1 = b1 / a0, c2 = b2 / a0, d1 = a1 / a0, d2 = a2 / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => { const y = c0 * x + c1 * x1 + c2 * x2 - d1 * y1 - d2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}

/** A filtered noise burst: attack, then an exponential tail of `shape` e-folds over `dur`. */
function noise(out, t0, dur, a, r, o = {}) {
  const i0 = Math.max(0, Math.round(t0 * SR));
  const n = Math.min(out.length - i0, Math.ceil(dur * SR));
  const attack = o.attack ?? 0.0005, shape = o.shape ?? 4;
  const fs = (o.filters ?? []).map((spec) => biquad(...spec));
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let x = (r() * 2 - 1) * Math.min(1, t / attack) * Math.exp((-shape * t) / dur);
    for (const f of fs) x = f(x);
    out[i0 + i] += a * x;
  }
}

function normalize(chans, peakDb) {
  let peak = 0;
  for (const c of chans) for (const v of c) peak = Math.max(peak, Math.abs(v));
  const k = peak > 0 ? 10 ** (peakDb / 20) / peak : 1;
  for (const c of chans) for (let i = 0; i < c.length; i++) c[i] *= k;
  return chans;
}

/** Trim trailing silence (keeping a few ms) and fade the last 4 ms. */
function trim(chans, floorDb = -70) {
  const floor = 10 ** (floorDb / 20);
  let end = 0;
  for (const c of chans) for (let i = c.length - 1; i > end; i--) if (Math.abs(c[i]) > floor) { end = i; break; }
  const n = Math.min(chans[0].length, end + Math.round(0.005 * SR));
  return chans.map((c) => {
    const o = c.slice(0, n);
    const f = Math.min(n, Math.round(0.004 * SR));
    for (let i = 0; i < f; i++) o[n - 1 - i] *= i / f;
    return o;
  });
}

/**
 * A small stereo Freeverb (8 damped combs + 4 allpasses per side) — the room
 * a tray sits in, or the hall the orchestra plays in. Returns [L, R].
 */
function reverb(dryL, dryR, o = {}) {
  const room = o.room ?? 0.5, damp = o.damp ?? 0.35, wet = o.wet ?? 0.2, dry = o.dry ?? 1;
  const pre = Math.round((o.predelay ?? 0.012) * SR);
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const alls = [556, 441, 341, 225];
  const fb = room * 0.28 + 0.7, d = damp * 0.4;
  const side = (input, spread) => {
    const out = new Float32Array(input.length);
    const cs = combs.map((len) => ({ b: new Float32Array(len + spread), i: 0, lp: 0 }));
    const as = alls.map((len) => ({ b: new Float32Array(len + spread), i: 0 }));
    for (let n = 0; n < input.length; n++) {
      const x = (n >= pre ? input[n - pre] : 0) * 0.015;
      let s = 0;
      for (const c of cs) {
        const y = c.b[c.i];
        c.lp = y * (1 - d) + c.lp * d;
        c.b[c.i] = x + c.lp * fb;
        c.i = (c.i + 1) % c.b.length;
        s += y;
      }
      for (const a of as) {
        const y = a.b[a.i];
        a.b[a.i] = s + y * 0.5;
        a.i = (a.i + 1) % a.b.length;
        s = y - s;
      }
      out[n] = s;
    }
    return out;
  };
  const wl = side(dryL, 0), wr = side(dryR ?? dryL, 23);
  const L = new Float32Array(dryL.length), R = new Float32Array(dryL.length);
  for (let n = 0; n < dryL.length; n++) {
    L[n] = dryL[n] * dry + wl[n] * wet;
    R[n] = (dryR ?? dryL)[n] * dry + wr[n] * wet;
  }
  return [L, R];
}

// ── the stones ──────────────────────────────────────────────────────────────

/** A walnut shell struck: contact transient, shell modes, hollow body. */
function walnutHit(out, t0, f0, amp, r, o = {}) {
  const ring = o.ring ?? 1;
  noise(out, t0, 0.0022, 0.85 * amp, r, { attack: 0.0002, shape: 5, filters: [["highpass", 1800, 0.7], ["bandpass", 4200, 0.8]] });
  const ratios = [1, 1.52, 2.21, 2.87, 3.63];
  const amps = [1, 0.62, 0.42, 0.26, 0.15];
  const taus = [0.019, 0.012, 0.0085, 0.006, 0.0042];
  ratios.forEach((k, i) => mode(out, t0, f0 * k * (1 + (r() - 0.5) * 0.02), amps[i] * amp * 0.5, taus[i] * ring, { phase: r() * 6.28 }));
  mode(out, t0, f0 * 0.34, 0.32 * amp, 0.021 * ring, { phase: r() * 6.28 });   // the hollow body
}

function swapContact(v) {
  const r = rng(100 + v);
  const f0 = [1720, 1960, 2210, 1850][v - 1];
  const second = [0.0105, 0.0135, 0.0085, 0.016][v - 1];
  const out = buf(0.16);
  walnutHit(out, 0.002, f0, 1, r);
  walnutHit(out, 0.002 + second, f0 * 1.035, 0.34, r, { ring: 0.8 });   // they roll together and tap again
  if (v % 2 === 0) walnutHit(out, 0.002 + second * 2.6, f0 * 0.98, 0.1, r, { ring: 0.6 });
  const [L, R] = reverb(out, out, { room: 0.18, damp: 0.6, wet: 0.14, predelay: 0.004 });
  return trim(normalize([L, R], -10));
}

function swapRoll(v) {
  const r = rng(200 + v);
  const dur = [0.12, 0.145, 0.105][v - 1];
  const out = buf(dur + 0.08);
  // the ridges ticking past each other, slowing down
  let t = 0.004;
  while (t < dur) {
    const u = t / dur;
    const env = Math.min(1, t / 0.014) * (1 - u) ** 1.6;
    const f = 2500 + r() * 1900;
    mode(out, t, f, (0.18 + r() * 0.4) * env, 0.0012 + r() * 0.0016, { phase: r() * 6.28 });
    mode(out, t, f * 0.41, (0.08 + r() * 0.16) * env, 0.0024, { phase: r() * 6.28 });
    t += (1 / (420 - 220 * u)) * (0.5 + r());
  }
  // the rub under it
  noise(out, 0.004, dur, 0.06, r, { attack: 0.012, shape: 2.2, filters: [["bandpass", 1300, 0.9], ["lowpass", 3200, 0.7]] });
  const [L, R] = reverb(out, out, { room: 0.15, damp: 0.6, wet: 0.1, predelay: 0.004 });
  return trim(normalize([L, R], -17));
}

function settle(v) {
  const r = rng(300 + v);
  const k = [1, 0.9, 1.12, 0.96][v - 1];
  const out = buf(0.2);
  const hit = (t, a) => {
    mode(out, t, 150 * k, 0.8 * a, 0.028, { phase: r() * 6.28, attack: 0.0012 });             // the tray
    [[470, 0.55, 0.024], [1090, 0.28, 0.011], [1840, 0.12, 0.006]].forEach(([f, am, tau]) =>
      mode(out, t, f * k * (1 + (r() - 0.5) * 0.03), am * a, tau, { phase: r() * 6.28 }));   // the knock
    noise(out, t, 0.0015, 0.3 * a, r, { attack: 0.0002, filters: [["bandpass", 3000, 0.9]] }); // the shell's edge
  };
  hit(0.002, 1);
  hit(0.002 + [0.024, 0.031, 0.021, 0.035][v - 1], 0.22);   // a small bounce
  const [L, R] = reverb(out, out, { room: 0.2, damp: 0.7, wet: 0.1, predelay: 0.005 });
  return trim(normalize([L, R], -14));
}

function match(v) {
  const r = rng(400 + v);
  const out = buf(0.4);
  // the crack
  noise(out, 0.002, 0.004, 1, r, { attack: 0.0002, shape: 3, filters: [["highpass", 1500, 0.7], ["bandpass", 5200, 0.7]] });
  mode(out, 0.002, [240, 275, 215][v - 1], 0.22, 0.024, { phase: r() * 6.28 });   // the chunk
  // the shards: a crumble of little hard ticks, spreading out and fading
  let t = 0.006;
  for (let i = 0; i < 14; i++) {
    const a = 0.55 * Math.exp(-i / 5) * (0.5 + r() * 0.5);
    const f = 2600 + r() * 4600;
    mode(out, t, f, a, 0.003 + r() * 0.004, { phase: r() * 6.28 });
    mode(out, t, f * 1.63, a * 0.4, 0.002, { phase: r() * 6.28 });
    t += 0.004 + r() * 0.009 * (1 + i / 4);
  }
  // a glint of the gem
  [[5200, 0.06, 0.11], [6850, 0.045, 0.09], [8100, 0.03, 0.07]].forEach(([f, a, tau], i) =>
    mode(out, 0.004 + i * 0.006, f * (1 + (v - 2) * 0.03), a, tau, { phase: r() * 6.28 }));
  const [L, R] = reverb(out, out, { room: 0.3, damp: 0.5, wet: 0.14, predelay: 0.006 });
  return trim(normalize([L, R], -11));
}

function cascade(v) {
  const r = rng(500 + v);
  const dur = [0.14, 0.2, 0.26][v - 1];
  const out = buf(dur + 0.5);
  // air rising
  const swell = buf(dur + 0.02);
  const bp = biquad("bandpass", 4200, 0.8), hp = biquad("highpass", 2600, 0.7);
  for (let i = 0; i < swell.length; i++) {
    const u = i / swell.length;
    swell[i] = hp(bp((r() * 2 - 1))) * Math.sin(Math.PI * Math.min(1, u * 1.25)) ** 1.5;
  }
  for (let i = 0; i < swell.length; i++) out[i] += swell[i] * 0.5;
  // glints climbing
  const n = [3, 5, 7][v - 1];
  for (let i = 0; i < n; i++) {
    const f = 3400 + (i / Math.max(1, n - 1)) * 3600 + r() * 300;
    mode(out, 0.02 + (i / n) * dur, f, 0.16, 0.05 + r() * 0.03, { phase: r() * 6.28, attack: 0.001 });
  }
  const [L, R] = reverb(out, out, { room: 0.55, damp: 0.3, wet: 0.32, predelay: 0.01 });
  return trim(normalize([L, R], [-16, -14, -12][v - 1]));
}

// ── bells, brass, choir: the flourishes and the finale ──────────────────────

/** A small brass bell: hum, prime, tierce, quint, nominal and the upper partials. */
function bell(out, t0, f, a, r, o = {}) {
  const len = o.len ?? 1;
  [[0.5, 0.35, 1.4], [1, 1, 0.9], [1.19, 0.45, 0.6], [1.5, 0.3, 0.5], [2, 0.5, 0.45], [2.52, 0.2, 0.3], [3.01, 0.15, 0.22], [4.17, 0.08, 0.14]]
    .forEach(([k, am, tau]) => mode(out, t0, f * k, am * a * 0.3, tau * len, { phase: r() * 6.28, attack: 0.0015 }));
  noise(out, t0, 0.003, 0.2 * a, r, { attack: 0.0002, filters: [["highpass", 3000, 0.7]] });
}

const polyblep = (t, dt) => {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
};

/**
 * One sustained synth note into `out`: `voices` detuned band-limited saws,
 * vibrato after the attack, a lowpass whose cutoff follows its own envelope
 * (brass "blat"), an ADSR, and optional formant filters (the choir's "ah").
 */
function note(out, t0, dur, freq, a, o = {}) {
  const attack = o.attack ?? 0.03, release = o.release ?? 0.12, decay = o.decay ?? 0.1, sustain = o.sustain ?? 0.85;
  const voices = o.voices ?? 2, detune = o.detune ?? 6;
  const vibRate = o.vibRate ?? 5.2, vibCents = o.vibCents ?? 7, vibDelay = o.vibDelay ?? 0.18;
  const cut0 = o.cut0 ?? 1200, cut1 = o.cut1 ?? 3200, cutSus = o.cutSus ?? 2200, cutT = o.cutT ?? 0.07;
  const i0 = Math.max(0, Math.round(t0 * SR));
  const n = Math.min(out.length - i0, Math.ceil((dur + release) * SR));
  const phases = Array.from({ length: voices }, (_, k) => (k * 0.37) % 1);
  const ratios = Array.from({ length: voices }, (_, k) => 2 ** (((k - (voices - 1) / 2) * detune) / 1200));
  const formants = (o.formants ?? []).map(([f, q, g]) => ({ f: biquad("bandpass", f, q), g }));
  let lp1 = 0, lp2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = t < attack ? t / attack
      : t < attack + decay ? 1 - (1 - sustain) * ((t - attack) / decay)
        : t < dur ? sustain
          : sustain * Math.max(0, 1 - (t - dur) / release);
    const vib = t > vibDelay ? Math.min(1, (t - vibDelay) / 0.2) * vibCents * Math.sin(2 * Math.PI * vibRate * t) : 0;
    const f = freq * 2 ** (vib / 1200);
    let s = 0;
    for (let k = 0; k < voices; k++) {
      const dt = (f * ratios[k]) / SR;
      phases[k] += dt;
      if (phases[k] >= 1) phases[k] -= 1;
      s += 2 * phases[k] - 1 - polyblep(phases[k], dt);
    }
    s /= voices;
    // two one-pole stages: a soft, playable lowpass whose cutoff follows the envelope
    const cut = t < cutT ? cut0 + (cut1 - cut0) * (t / cutT) : cutSus + (cut1 - cutSus) * Math.exp(-(t - cutT) / 0.15);
    const g = 1 - Math.exp((-2 * Math.PI * cut) / SR);
    lp1 += (s - lp1) * g;
    lp2 += (lp1 - lp2) * g;
    let y = lp2;
    if (formants.length) {
      let fsum = 0;
      for (const fm of formants) fsum += fm.f(s) * fm.g;
      y = fsum;
    }
    out[i0 + i] += y * env * a;
  }
}

/** A timpani stroke: a membrane's inharmonic modes with the pitch sagging as it rings. */
function timpani(out, t0, f, a, r) {
  [[1, 1, 0.6], [1.5, 0.5, 0.45], [1.98, 0.35, 0.35], [2.44, 0.2, 0.25], [2.9, 0.12, 0.2]].forEach(([k, am, tau]) =>
    mode(out, t0, f * k, am * a, tau, { glide: 0.97, phase: r() * 6.28, attack: 0.002 }));
  noise(out, t0, 0.03, 0.25 * a, r, { attack: 0.001, filters: [["lowpass", 900, 0.7]] });
}

function cymbal(out, t0, a, r, len = 1.6) {
  noise(out, t0, len, a, r, { attack: 0.002, shape: 5, filters: [["highpass", 3500, 0.7], ["peak", 7800, 1.2, 6]] });
}

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

function star4() {
  const r = rng(600);
  const L = buf(2.2), R = buf(2.2);
  bell(L, 0.01, hz(83), 0.9, r);                     // B5
  bell(R, 0.01, hz(83), 0.6, r);
  bell(R, 0.15, hz(88), 0.9, r, { len: 1.3 });       // E6
  bell(L, 0.15, hz(88), 0.6, r, { len: 1.3 });
  for (const m of [64, 68, 71]) {                    // E major under it, a soft swell
    note(L, 0.05, 0.9, hz(m), 0.05, { attack: 0.25, release: 0.6, voices: 3, detune: 9, cut0: 900, cut1: 1600, cutSus: 1400, vibCents: 4 });
    note(R, 0.05, 0.9, hz(m) * 1.002, 0.05, { attack: 0.25, release: 0.6, voices: 3, detune: 9, cut0: 900, cut1: 1600, cutSus: 1400, vibCents: 4 });
  }
  for (let i = 0; i < 6; i++) mode(i % 2 ? L : R, 0.2 + i * 0.07, 5200 + i * 380, 0.05, 0.12, { phase: r() * 6.28 });
  const [l, rr] = reverb(L, R, { room: 0.65, damp: 0.3, wet: 0.3, predelay: 0.015 });
  return trim(normalize([l, rr], -6));
}

function star5() {
  const r = rng(700);
  const L = buf(3.2), R = buf(3.2);
  [79, 83, 86, 91].forEach((m, i) => {               // G5 B5 D6 G6
    bell(i % 2 ? R : L, 0.01 + i * 0.1, hz(m), 0.85, r, { len: 1 + i * 0.15 });
    bell(i % 2 ? L : R, 0.01 + i * 0.1, hz(m), 0.5, r, { len: 1 + i * 0.15 });
  });
  const brass = { attack: 0.12, release: 0.8, voices: 3, detune: 8, cut0: 700, cut1: 2800, cutSus: 1900, cutT: 0.25, vibCents: 5 };
  for (const m of [55, 59, 62, 67]) {                // G major brass swell
    note(L, 0.28, 1.3, hz(m), 0.055, brass);
    note(R, 0.28, 1.3, hz(m) * 1.003, 0.055, brass);
  }
  timpani(L, 0.3, hz(43), 0.5, r);
  timpani(R, 0.3, hz(43), 0.5, r);
  cymbal(L, 0.3, 0.12, r, 1.8);
  cymbal(R, 0.31, 0.12, r, 1.8);
  for (let i = 0; i < 10; i++) mode(i % 2 ? L : R, 0.35 + i * 0.06, 4800 + i * 330, 0.045, 0.15, { phase: r() * 6.28 });
  const [l, rr] = reverb(L, R, { room: 0.75, damp: 0.3, wet: 0.32, predelay: 0.018 });
  return trim(normalize([l, rr], -5));
}

/** The Ode to Joy: two phrases of the theme and a closing chord, in D. */
function finale() {
  const r = rng(800);
  const bpm = 132, beat = 60 / bpm;
  const D4 = 62, E4 = 64, Fs4 = 66, G4 = 67, A4 = 69;
  // [midi, beats]
  const tune = [
    [Fs4, 1], [Fs4, 1], [G4, 1], [A4, 1], [A4, 1], [G4, 1], [Fs4, 1], [E4, 1],
    [D4, 1], [D4, 1], [E4, 1], [Fs4, 1], [Fs4, 1.5], [E4, 0.5], [E4, 2],
    [Fs4, 1], [Fs4, 1], [G4, 1], [A4, 1], [A4, 1], [G4, 1], [Fs4, 1], [E4, 1],
    [D4, 1], [D4, 1], [E4, 1], [Fs4, 1], [E4, 1.5], [D4, 0.5], [D4, 2],
  ];
  // harmony by half bar (2 beats): D, A7 …
  const Dmaj = [50, 54, 57, 62], A7 = [45, 49, 52, 55];
  const chords = [Dmaj, Dmaj, A7, A7, Dmaj, Dmaj, A7, A7, Dmaj, Dmaj, A7, A7, Dmaj, Dmaj, Dmaj, A7, Dmaj, Dmaj];
  const bars = 8;
  const total = bars * 4 * beat + 3.6;
  const L = buf(total), R = buf(total);
  const brass = { attack: 0.028, release: 0.09, decay: 0.08, sustain: 0.82, voices: 2, detune: 7, cut0: 1100, cut1: 3600, cutSus: 2300, cutT: 0.06, vibCents: 8, vibDelay: 0.16 };
  const choir = { attack: 0.07, release: 0.16, voices: 3, detune: 10, vibRate: 5.6, vibCents: 12, vibDelay: 0.1,
    formants: [[800, 5, 1], [1150, 6, 0.6], [2800, 8, 0.25]] };
  const strings = { attack: 0.09, release: 0.22, voices: 3, detune: 9, cut0: 1500, cut1: 1900, cutSus: 1700, vibCents: 5, vibRate: 5.8 };
  // the tune: trumpets an octave up, the choir singing it where it was written
  let t = 0.05;
  for (const [m, b] of tune) {
    const d = b * beat;
    note(L, t, d * 0.92, hz(m + 12), 0.2, brass);
    note(R, t, d * 0.92, hz(m + 12) * 1.001, 0.13, brass);
    note(L, t, d * 0.96, hz(m), 0.1, choir);
    note(R, t, d * 0.96, hz(m) * 0.999, 0.16, choir);
    t += d;
  }
  // strings and bass under it, a chord every half bar
  chords.forEach((ch, i) => {
    const t0 = 0.05 + i * 2 * beat;
    if (t0 > bars * 4 * beat) return;
    for (const m of ch.slice(1)) {
      note(L, t0, 2 * beat * 0.98, hz(m), 0.035, strings);
      note(R, t0, 2 * beat * 0.98, hz(m) * 1.002, 0.035, strings);
    }
    for (const k of [0, 1]) {                        // bass on the beat, two per chord
      const b = { attack: 0.01, release: 0.12, decay: 0.2, sustain: 0.4, voices: 1, cut0: 500, cut1: 900, cutSus: 450, vibCents: 0 };
      note(L, t0 + k * beat, beat * 0.9, hz(ch[0] - 12), 0.14, b);
      note(R, t0 + k * beat, beat * 0.9, hz(ch[0] - 12), 0.14, b);
    }
  });
  // the percussion: a crash and a stroke on the downbeat, strokes at the phrase ends
  cymbal(L, 0.05, 0.14, r, 2.2);
  cymbal(R, 0.06, 0.14, r, 2.2);
  timpani(L, 0.05, hz(38), 0.35, r);
  timpani(R, 0.05, hz(38), 0.35, r);
  for (const bar of [3, 7]) {
    timpani(L, 0.05 + bar * 4 * beat, hz(45), 0.3, r);
    timpani(R, 0.05 + bar * 4 * beat, hz(45), 0.3, r);
  }
  // the close: a held D major, a timpani roll into it, the last crash
  const end = 0.05 + bars * 4 * beat;
  for (let i = 0; i < 14; i++) timpani(i % 2 ? L : R, end - 0.9 + i * 0.064, hz(38), 0.08 + i * 0.012, r);
  for (const m of [50, 57, 62, 66, 69, 74]) {
    note(L, end, 1.6, hz(m), m > 62 ? 0.06 : 0.05, { ...strings, attack: 0.05, release: 1.2 });
    note(R, end, 1.6, hz(m) * 1.002, m > 62 ? 0.06 : 0.05, { ...strings, attack: 0.05, release: 1.2 });
  }
  note(L, end, 1.5, hz(74), 0.18, { ...brass, release: 0.9 });
  note(R, end, 1.5, hz(74), 0.12, { ...brass, release: 0.9 });
  timpani(L, end, hz(38), 0.5, r);
  timpani(R, end, hz(38), 0.5, r);
  cymbal(L, end, 0.16, r, 2.6);
  cymbal(R, end + 0.01, 0.16, r, 2.6);
  const [l, rr] = reverb(L, R, { room: 0.82, damp: 0.35, wet: 0.24, predelay: 0.022 });
  // a gentle limiter: the hall can pile up on the last chord
  for (const c of [l, rr]) for (let i = 0; i < c.length; i++) c[i] = Math.tanh(c[i] * 1.2) / 1.2;
  return trim(normalize([l, rr], -4), -60);
}

// ── the catalogue ───────────────────────────────────────────────────────────
const JOBS = {};
for (const v of [1, 2, 3, 4]) JOBS[`swap_contact_${v}`] = { make: () => swapContact(v), kbps: 128 };
for (const v of [1, 2, 3]) JOBS[`swap_roll_${v}`] = { make: () => swapRoll(v), kbps: 128 };
for (const v of [1, 2, 3, 4]) JOBS[`settle_${v}`] = { make: () => settle(v), kbps: 128 };
for (const v of [1, 2, 3]) JOBS[`match_${v}`] = { make: () => match(v), kbps: 128 };
for (const v of [1, 2, 3]) JOBS[`cascade_${v}`] = { make: () => cascade(v), kbps: 128 };
JOBS.star_4 = { make: star4, kbps: 160 };
JOBS.star_5 = { make: star5, kbps: 160 };
JOBS.finale = { make: finale, kbps: 160 };

function run() {
  const argv = process.argv.slice(2);
  const wavAt = argv.indexOf("--wav");
  const wavDir = wavAt >= 0 ? argv[wavAt + 1] : null;
  const names = argv.filter((a, i) => !a.startsWith("--") && i !== wavAt + 1);
  const lame = loadLame();
  fs.mkdirSync(OUT, { recursive: true });
  if (wavDir) fs.mkdirSync(wavDir, { recursive: true });
  for (const name of names.length ? names : Object.keys(JOBS)) {
    const job = JOBS[name];
    if (!job) throw new Error(`unknown cue file ${name}`);
    const chans = job.make();
    const mp3 = encodeMp3(lame, chans, job.kbps);
    fs.writeFileSync(path.join(OUT, `${name}.mp3`), mp3);
    if (wavDir) writeWav(path.join(wavDir, `${name}.wav`), chans);
    console.log(`${name}: ${(chans[0].length / SR).toFixed(2)} s → ${(mp3.length / 1024).toFixed(1)} KB`);
  }
}

run();
