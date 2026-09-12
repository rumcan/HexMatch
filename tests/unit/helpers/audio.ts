// ─────────────────────────────────────────────────────────────────────────────
// Test helper for SFX-01 (not a test file — vitest only collects
// `tests/unit/**/*.test.ts`).
//
// A fake Web Audio API that RECORDS instead of sounding: every node created,
// every automation event scheduled on every param, every connect/disconnect,
// every start/stop. That is what lets a unit test assert things about a mix
// nobody can hear in jsdom — that a cue really builds its layers, that the
// master gain follows the volume setting, that a cascade climbs the ladder,
// that a muted game creates NO nodes at all, and that a finished layer is
// disconnected rather than left hanging off the bus for the rest of the
// session.
//
// Two flavours are exported on purpose:
//
//   FakeAudioContext  the full graph (oscillators, gains, biquads, buffer
//                     sources, buffers, a compressor). What the cues use.
//   MinimalAudioContext  ONLY createGain + createOscillator — the same two
//                     nodes `tests/unit/iso-game.test.ts` has always stubbed
//                     for PP-14's choir. Every optional node in the engine is
//                     feature-detected, and this fake is what proves it: half
//                     an API must degrade to a simpler sound, never to a throw.
// ─────────────────────────────────────────────────────────────────────────────

export interface ParamEvent {
  method: string;
  value: number;
  time?: number;
}

export class FakeParam {
  value: number;
  readonly events: ParamEvent[] = [];
  constructor(value = 0) { this.value = value; }
  private record(method: string, value: number, time?: number): this {
    this.events.push({ method, value, time });
    this.value = value;
    return this;
  }
  setValueAtTime(v: number, t: number) { return this.record("setValueAtTime", v, t); }
  linearRampToValueAtTime(v: number, t: number) { return this.record("linearRamp", v, t); }
  exponentialRampToValueAtTime(v: number, t: number) { return this.record("exponentialRamp", v, t); }
  setTargetAtTime(v: number, t: number) { return this.record("setTarget", v, t); }
  cancelScheduledValues(t: number) { return this.record("cancel", this.value, t); }
  cancelAndHoldAtTime(t: number) { return this.record("cancelAndHold", this.value, t); }
}

export class FakeNode {
  readonly outgoing: FakeNode[] = [];
  disconnects = 0;
  context: FakeAudioContext | null = null;
  connect(target: FakeNode | FakeParam): FakeNode | FakeParam {
    if (target instanceof FakeNode) this.outgoing.push(target);
    return target;
  }
  disconnect(): void { this.disconnects++; }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

export class FakeOscillator extends FakeNode {
  type: OscillatorType = "sine";
  readonly frequency = new FakeParam(440);
  readonly detune = new FakeParam(0);
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  start(t = 0) { this.startedAt = t; }
  stop(t = 0) { this.stoppedAt = t; }
}

export class FakeBufferSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  readonly playbackRate = new FakeParam(1);
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  start(t = 0, _offset = 0) { this.startedAt = t; }
  stop(t = 0) { this.stoppedAt = t; }
}

export class FakeBiquad extends FakeNode {
  type: BiquadFilterType = "lowpass";
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
  readonly gain = new FakeParam(0);
  readonly detune = new FakeParam(0);
}

export class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam(-24);
  readonly knee = new FakeParam(30);
  readonly ratio = new FakeParam(12);
  readonly attack = new FakeParam(0.003);
  readonly release = new FakeParam(0.25);
}

export class FakeAudioBuffer {
  readonly duration: number;
  private readonly data: Float32Array;
  constructor(_channels: number, length: number, sampleRate: number) {
    this.data = new Float32Array(length);
    this.duration = length / sampleRate;
  }
  getChannelData() { return this.data; }
}

export class FakeAudioContext {
  static readonly instances: FakeAudioContext[] = [];
  currentTime = 0;
  state: AudioContextState = "running";
  sampleRate = 44100;
  readonly destination = new FakeNode();
  readonly created: FakeNode[] = [];
  resumes = 0;

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  resume(): Promise<void> { this.resumes++; return Promise.resolve(); }
  close(): Promise<void> { this.state = "closed"; return Promise.resolve(); }

  private track<T extends FakeNode>(node: T): T {
    node.context = this;
    this.created.push(node);
    return node;
  }

  createGain() { return this.track(new FakeGain()); }
  createOscillator() { return this.track(new FakeOscillator()); }
  createBiquadFilter() { return this.track(new FakeBiquad()); }
  createBufferSource() { return this.track(new FakeBufferSource()); }
  createDynamicsCompressor() { return this.track(new FakeCompressor()); }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new FakeAudioBuffer(channels, length, sampleRate);
  }

  // ── what a test asks about ────────────────────────────────────────────────
  get gains(): FakeGain[] { return this.created.filter((n): n is FakeGain => n instanceof FakeGain); }
  get oscillators(): FakeOscillator[] { return this.created.filter((n): n is FakeOscillator => n instanceof FakeOscillator); }
  get sources(): FakeBufferSource[] { return this.created.filter((n): n is FakeBufferSource => n instanceof FakeBufferSource); }
  get filters(): FakeBiquad[] { return this.created.filter((n): n is FakeBiquad => n instanceof FakeBiquad); }
  get compressors(): FakeCompressor[] { return this.created.filter((n): n is FakeCompressor => n instanceof FakeCompressor); }

  /** Oscillators that were really started, in the order they started. */
  get startedOscillators(): FakeOscillator[] {
    return this.oscillators.filter((o) => o.startedAt !== null);
  }
  get startedSources(): FakeBufferSource[] {
    return this.sources.filter((s) => s.startedAt !== null);
  }
  /** Every started source, oscillator or buffer — the things that must stop. */
  get startedCount(): number { return this.startedOscillators.length + this.startedSources.length; }
  get stoppedCount(): number {
    return this.oscillators.filter((o) => o.stoppedAt !== null).length
      + this.sources.filter((s) => s.stoppedAt !== null).length;
  }
  /** The first frequency each started oscillator was given (its pitch). */
  get pitches(): number[] {
    return this.startedOscillators.map((o) => o.frequency.events[0]?.value ?? o.frequency.value);
  }
  /** The master gain is the first gain the bus built. */
  get masterGain(): FakeGain | null { return this.gains[0] ?? null; }

  /** Run every finished layer's teardown, as a real context does on `ended`. */
  fireEnded(): void {
    for (const o of this.oscillators) o.onended?.();
    for (const s of this.sources) s.onended?.();
  }

  /** Total disconnects across the graph — the leak check. */
  get totalDisconnects(): number {
    return this.created.reduce((n, node) => n + node.disconnects, 0);
  }
}

/**
 * Only the two nodes PP-14's choir needs — `createGain` and `createOscillator`
 * — which is exactly what `tests/unit/iso-game.test.ts` has always stubbed.
 * Half an API: the engine's limiter, filters and noise grains must all
 * feature-detect their way past it rather than throw.
 */
export class MinimalAudioContext {
  static readonly instances: MinimalAudioContext[] = [];
  currentTime = 0;
  state: AudioContextState = "running";
  sampleRate = 44100;
  readonly destination = new FakeNode();
  started = 0;

  constructor() { MinimalAudioContext.instances.push(this); }
  resume(): Promise<void> { return Promise.resolve(); }
  createGain() { return new FakeGain(); }
  createOscillator() {
    const o = new FakeOscillator();
    o.start = (t = 0) => { o.startedAt = t; this.started++; };
    return o;
  }
}

export interface InstalledFake {
  contexts: () => FakeAudioContext[];
  /** Everything created across every context so far. */
  nodes: () => FakeNode[];
  started: () => number;
  stopped: () => number;
  pitches: () => number[];
  masterGain: () => FakeGain | null;
  fireEnded: () => void;
  disconnects: () => number;
}

/**
 * Install the full fake as the global AudioContext (and reset the instance
 * log). Call it AFTER `vi.resetModules()` and BEFORE importing the audio layer,
 * so the module under test sees this and nothing else.
 */
export function installFakeAudio(): InstalledFake {
  FakeAudioContext.instances.length = 0;
  (globalThis as Record<string, unknown>).AudioContext = FakeAudioContext;
  const all = () => FakeAudioContext.instances;
  return {
    contexts: all,
    nodes: () => all().flatMap((c) => c.created),
    started: () => all().reduce((n, c) => n + c.startedCount, 0),
    stopped: () => all().reduce((n, c) => n + c.stoppedCount, 0),
    pitches: () => all().flatMap((c) => c.pitches),
    masterGain: () => all()[0]?.masterGain ?? null,
    fireEnded: () => all().forEach((c) => c.fireEnded()),
    disconnects: () => all().reduce((n, c) => n + c.totalDisconnects, 0),
  };
}

/** Install the two-node fake instead — the "partial API" degradation check. */
export function installMinimalAudio(): { started: () => number } {
  MinimalAudioContext.instances.length = 0;
  (globalThis as Record<string, unknown>).AudioContext = MinimalAudioContext;
  return { started: () => MinimalAudioContext.instances.reduce((n, c) => n + c.started, 0) };
}

/** Remove any AudioContext, the way jsdom ships by default. */
export function removeAudio(): void {
  delete (globalThis as Record<string, unknown>).AudioContext;
  delete (globalThis as Record<string, unknown>).webkitAudioContext;
}
