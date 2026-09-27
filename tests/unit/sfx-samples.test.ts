// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// SFX-1 (#463) — the recorded tier's contract.
//
// The 25 recordings sit IN FRONT of the synth catalogue, never instead of it:
// a cue whose buffer is already decoded plays the file, and anything else —
// a file that is missing, still loading or undecodable, and every headless
// run — falls back to the synth recipe, silently. So the tests are:
//
//   1. THE MAP is complete: all 25 files keyed by real cue ids, each with a
//      recipe and a note (a renamed file must break HERE, loudly).
//   2. THE FALLBACK holds: nothing decoded ⇒ the synth voices the cue (the
//      suites' fakes have no decoder, so this is also what every other test
//      file hears).
//   3. THE RECORDING plays once decoded (via the test seam — no network).
//   4. A MISSING file degrades to the synth without a throw, a rejection or
//      a re-fetch on every play.
//   5. NODE STAYS SILENT: no AudioContext ⇒ no nodes, no fetches, no throws.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  installFakeAudio, removeAudio, FakeAudioBuffer, type InstalledFake,
} from "./helpers/audio";
import {
  SAMPLE_FILES, fetchAudioBuffer, hasSample, sfxSampleUrl,
} from "../../src/audio/samples";

type SfxModule = typeof import("../../src/audio/sfx");
type CueModule = typeof import("../../src/audio/cues");
type SampleModule = typeof import("../../src/audio/samples");

let sfxMod: SfxModule;
let cueMod: CueModule;
let sampleMod: SampleModule;
let fake: InstalledFake;
let clock = 0;

async function freshAudio(): Promise<void> {
  vi.resetModules();
  sfxMod = await import("../../src/audio/sfx");
  cueMod = await import("../../src/audio/cues");
  sampleMod = await import("../../src/audio/samples");
}

const sfx = () => sfxMod.sfx;
const advance = (ms: number) => { clock += ms; };
const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  try { localStorage.clear(); } catch { /* no storage */ }
  fake = installFakeAudio();
  delete (window as unknown as Record<string, unknown>).__sfx;
  await freshAudio();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  removeAudio();
  document.body.innerHTML = "";
});

describe("SFX-1 the sample map is complete", () => {
  // The ticket's own list: build, place, pave, demolish, deny; harvest, coin,
  // star, city-upgrade, boom, truck-horn, train-whistle; victory, defeat; and
  // eleven battle-* cues. 25 files, 25 cue ids.
  const EXPECTED = [
    "build", "place", "pave", "demolish", "deny",
    "harvest", "coin", "star", "city-upgrade", "boom", "truck-horn", "train-whistle",
    "victory", "defeat",
    "battle-start", "battle-turn", "battle-hit", "battle-damage", "battle-bomb",
    "battle-mana", "battle-ability", "battle-extra-turn", "battle-frost",
    "battle-win", "battle-lose",
  ];

  it("keys all 25 recordings by real cue ids with recipes and notes", () => {
    expect(Object.keys(SAMPLE_FILES).sort()).toEqual([...EXPECTED].sort());
    for (const cue of EXPECTED) {
      expect(hasSample(cue), `${cue} has no sample entry`).toBe(true);
      expect(cueMod.isCue(cue), `${cue} is not a catalogue cue`).toBe(true);
      expect(sfxMod.sfx.cues()).toContain(cue);
      expect(cueMod.CUE_NOTES[cue as keyof typeof cueMod.CUE_NOTES]?.length ?? 0,
        `${cue} has no note`).toBeGreaterThan(12);
    }
    expect(hasSample("not-a-cue")).toBe(false);
    expect(hasSample("click"), "synth-only cues stay synth-only").toBe(false);
  });

  it("points each cue at its file beside index.html", () => {
    for (const cue of EXPECTED) {
      expect(sfxSampleUrl(cue, "/")).toBe(`/assets/sfx/${cue}.mp3`);
    }
    expect(sfxSampleUrl("coin", "./")).toBe("./assets/sfx/coin.mp3");
    expect(sfxSampleUrl("coin", "/hexmatch")).toBe("/hexmatch/assets/sfx/coin.mp3");
    expect(sfxSampleUrl("click"), "a synth-only cue has no URL").toBeNull();
    expect(sfxSampleUrl("not-a-cue")).toBeNull();
    expect(() => sfxSampleUrl("coin"), "the default base never throws").not.toThrow();
  });
});

describe("SFX-1 the synth is the fallback", () => {
  it("voices every sampled cue from its recipe while nothing is decoded", () => {
    sfx().unlock();
    // The fakes have no decoder, so NOTHING can decode here — exactly the
    // headless state every other suite hears. Every sampled cue's fallback
    // still builds real oscillator layers (all 25 recipes carry tone).
    for (const cue of Object.keys(SAMPLE_FILES)) {
      const ctx = fake.contexts()[0];
      const before = ctx ? ctx.oscillators.length : 0;
      advance(10_000);                     // past the longest gap (the whistle's 9 s)
      sfx().play(cue as never);
      const after = fake.contexts()[0]?.oscillators.length ?? 0;
      expect(after - before, `${cue} fell silent with no buffer`).toBeGreaterThan(0);
    }
  });

  it("plays the recording once its buffer is decoded", () => {
    sfx().unlock();
    // The test seam stands in for the network + the decoder.
    const coin = new FakeAudioBuffer(1, 4410, 44100);
    sampleMod.injectSample("coin", coin as unknown as AudioBuffer);
    const ctx = () => fake.contexts()[0]!;
    advance(10_000);
    const oscsBefore = ctx().oscillators.length;
    sfx().play("coin", { gain: 0.5 });
    // One buffer source, carrying the injected buffer — and not one
    // oscillator: the synth stood down for the recording.
    const srcs = ctx().sources.filter((s) => s.startedAt !== null);
    expect(srcs.length, "the sample never started").toBeGreaterThan(0);
    expect(srcs.at(-1)!.buffer, "the source carries the decoded buffer").toBe(coin);
    expect(ctx().oscillators.length, "the synth must stand down").toBe(oscsBefore);
    expect(sfx().stats().played).toBe(1);
    // …while a cue with no buffer still sings its recipe.
    advance(10_000);
    const oscs2 = ctx().oscillators.length;
    sfx().play("star");
    expect(ctx().oscillators.length, "an undecoded cue falls back").toBeGreaterThan(oscs2);
  });

  it("scales the recording by the play's gain", () => {
    sfx().unlock();
    sampleMod.injectSample("coin", new FakeAudioBuffer(1, 4410, 44100) as unknown as AudioBuffer);
    advance(10_000);
    sfx().play("coin", { gain: 0.5 });
    const gains = fake.contexts()[0]!.gains;
    const env = gains[gains.length - 1]!;
    const ramps = env.gain.events.filter((e) => e.method === "linearRamp");
    expect(ramps.at(-1)?.value, "the sample's own gain carries the scale").toBeCloseTo(0.5, 5);
  });
});

describe("SFX-1 a missing file falls back silently", () => {
  it("degrades a failed fetch, a 404 and a failed decode to null — never a throw", async () => {
    const decode = vi.fn();
    const ctx = { decodeAudioData: decode } as unknown as AudioContext;
    // A refused fetch.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    await expect(fetchAudioBuffer(ctx, "http://x/coin.mp3")).resolves.toBeNull();
    // A 404 (the shipped state for a file the lead has not dropped yet).
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    await expect(fetchAudioBuffer(ctx, "http://x/coin.mp3")).resolves.toBeNull();
    // Bytes that do not decode.
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, arrayBuffer: async () => new ArrayBuffer(8),
    })));
    decode.mockRejectedValueOnce(new Error("not audio"));
    await expect(fetchAudioBuffer(ctx, "http://x/coin.mp3")).resolves.toBeNull();
    // …and the happy path, for the shape of it.
    const buf = { duration: 1.2 } as AudioBuffer;
    decode.mockResolvedValueOnce(buf);
    await expect(fetchAudioBuffer(ctx, "http://x/coin.mp3")).resolves.toBe(buf);
  });

  it("plays the synth after a failed load, and never re-fetches it", async () => {
    sfx().unlock();
    // Give the fake a decoder that refuses, so the load runs and fails.
    const ctx = fake.contexts()[0] as unknown as Record<string, unknown>;
    ctx.decodeAudioData = async () => { throw new Error("not audio"); };
    const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    vi.stubGlobal("fetch", fetchMock);

    advance(10_000);
    sfx().play("coin");                    // kicks the load, voices the synth
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sampleMod.sampleBuffer("coin"), "a failed load caches as absent").toBeNull();

    const oscsBefore = fake.contexts()[0]!.oscillators.length;
    advance(10_000);
    sfx().play("coin");
    expect(fetchMock, "a 404 is not worth re-fetching every play").toHaveBeenCalledTimes(1);
    expect(fake.contexts()[0]!.oscillators.length, "…and the synth voices it").toBeGreaterThan(oscsBefore);
  });

  it("prewarms every recording once, in the background", async () => {
    sfx().unlock();
    const ctx = fake.contexts()[0] as unknown as Record<string, unknown>;
    ctx.decodeAudioData = async () => new FakeAudioBuffer(1, 4410, 44100);
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true, url, arrayBuffer: async () => new ArrayBuffer(8),
    }));
    vi.stubGlobal("fetch", fetchMock);
    sampleMod.prewarmSamples();
    await flush();
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toHaveLength(25);
    expect(new Set(urls).size, "each file fetched once").toBe(25);
    expect(sampleMod.sampleBuffer("coin"), "decoded buffers are cached").not.toBeNull();
    sampleMod.prewarmSamples();
    await flush();
    expect(fetchMock, "a second prewarm refetches nothing").toHaveBeenCalledTimes(25);
  });
});

describe("SFX-1 headless runs stay silent", () => {
  it("creates no nodes and fetches nothing where there is no AudioContext", async () => {
    removeAudio();
    vi.resetModules();
    const bare = (await import("../../src/audio/sfx")).sfx;
    const bareSamples = await import("../../src/audio/samples");
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    bare.unlock();
    expect(() => {
      bareSamples.prewarmSamples();
      for (const cue of bare.cues()) bare.play(cue);
      bareSamples.requestSample("coin");
    }).not.toThrow();
    await flush();
    expect(fetchMock, "no decoder ⇒ no fetch, ever").not.toHaveBeenCalled();
    expect(bareSamples.sampleBuffer("coin")).toBeNull();
  });
});
