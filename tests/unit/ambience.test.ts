// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// SFX-1 (#463) — ambience by zoom: the island's room tone.
//
// Five looping beds cross-faded by zoom and by what the camera sits over.
// The tests are about the three things a suite CAN hear about a bed nobody
// can listen to:
//
//   1. THE MIX is the ticket's table: sea near a coast, town murmur over
//      towns, birds + wind in the countryside, distant traffic at the far
//      zoom. Pure — so every row of it is a value assertion.
//   2. THE PLACE IN THE MIX: under the radio (the ceilings), ducked by the
//      voice at the radio's 30%, covered by the Sound switch, its own slider
//      persisted — and silent wherever there is no Web Audio.
//   3. THE GLIDE: re-probes cross-fade (throttled, so a pan does not spam
//      automation), and snap under reduced motion.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  installFakeAudio, removeAudio, type InstalledFake,
} from "./helpers/audio";
import {
  AMBIENCE_BEDS, AMBIENCE_CEILINGS, AMBIENCE_DUCK_RATIO, AMBIENCE_STORAGE_KEY,
  DEFAULT_AMBIENCE_VOLUME, ambienceBedGain, ambienceFileUrl, ambienceMix,
  isAmbienceBed, readAmbienceSettings,
} from "../../src/audio/ambience";

type AmbienceModule = typeof import("../../src/audio/ambience");
type EngineModule = typeof import("../../src/audio/engine");
type SfxModule = typeof import("../../src/audio/sfx");

let ambMod: AmbienceModule;
let engineMod: EngineModule;
let sfxMod: SfxModule;
let fake: InstalledFake;
let clock = 0;

async function freshAudio(): Promise<void> {
  vi.resetModules();
  ambMod = await import("../../src/audio/ambience");
  engineMod = await import("../../src/audio/engine");
  sfxMod = await import("../../src/audio/sfx");
}

const store = () => {
  const box = new Map<string, string>();
  return {
    getItem: (k: string) => box.get(k) ?? null,
    setItem: (k: string, v: string) => { box.set(k, v); },
    box,
  };
};
const advance = (ms: number) => { clock += ms; };
const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  try { localStorage.clear(); } catch { /* no storage */ }
  fake = installFakeAudio();
  await freshAudio();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  removeAudio();
  document.body.innerHTML = "";
});

describe("SFX-1 the mix follows zoom and position", () => {
  it("names the five beds the ticket lists", () => {
    expect([...AMBIENCE_BEDS]).toEqual(["sea", "town", "birds", "wind", "traffic"]);
    for (const bed of AMBIENCE_BEDS) {
      expect(isAmbienceBed(bed)).toBe(true);
      expect(AMBIENCE_CEILINGS[bed], `${bed} has a ceiling`).toBeGreaterThan(0);
      expect(ambienceFileUrl(bed, "/")).toBe(`/assets/ambience/${bed}.mp3`);
    }
    expect(isAmbienceBed("surf")).toBe(false);
  });

  it("plays the sea near a coast, louder at close zoom", () => {
    expect(ambienceMix({ zoom: 2, nearCoast: true, nearTown: false }).sea).toBe(1);
    expect(ambienceMix({ zoom: 1, nearCoast: true, nearTown: false }).sea).toBe(0.65);
    expect(ambienceMix({ zoom: 0.5, nearCoast: true, nearTown: false }).sea).toBe(0.35);
    expect(ambienceMix({ zoom: 2, nearCoast: false, nearTown: false }).sea).toBe(0);
  });

  it("murmurs over towns, louder at close zoom", () => {
    expect(ambienceMix({ zoom: 2, nearCoast: false, nearTown: true }).town).toBe(1);
    expect(ambienceMix({ zoom: 1, nearCoast: false, nearTown: true }).town).toBe(0.6);
    expect(ambienceMix({ zoom: 0.5, nearCoast: false, nearTown: true }).town).toBe(0.25);
    expect(ambienceMix({ zoom: 2, nearCoast: false, nearTown: false }).town).toBe(0);
  });

  it("sings birds and wind in the countryside, not in town or at sea", () => {
    const country = ambienceMix({ zoom: 2, nearCoast: false, nearTown: false });
    expect(country.birds).toBe(1);
    expect(country.wind, "the countryside is the wind's home").toBe(0.6);
    expect(country.sea).toBe(0);
    expect(country.town).toBe(0);
    expect(ambienceMix({ zoom: 1, nearCoast: false, nearTown: false }).birds).toBe(0.6);
    expect(ambienceMix({ zoom: 2, nearCoast: true, nearTown: false }).birds,
      "the sea has no birds").toBe(0);
    expect(ambienceMix({ zoom: 2, nearCoast: false, nearTown: true }).birds,
      "the town has no birds").toBe(0);
    expect(ambienceMix({ zoom: 2, nearCoast: false, nearTown: true }).wind,
      "…but everywhere has some wind").toBe(0.3);
  });

  it("runs distant traffic at the far zoom, and only there", () => {
    expect(ambienceMix({ zoom: 0.5, nearCoast: false, nearTown: false }).traffic).toBe(0.9);
    expect(ambienceMix({ zoom: 1, nearCoast: false, nearTown: false }).traffic).toBe(0);
    expect(ambienceMix({ zoom: 2, nearCoast: false, nearTown: false }).traffic).toBe(0);
    expect(ambienceMix({ zoom: 0.5, nearCoast: false, nearTown: false }).birds,
      "the far zoom is too far for birds").toBe(0);
  });

  it("mixes a coast town as sea AND town", () => {
    const mix = ambienceMix({ zoom: 2, nearCoast: true, nearTown: true });
    expect(mix.sea).toBe(1);
    expect(mix.town).toBe(1);
    expect(mix.birds).toBe(0);
  });

  it("treats a nonsense zoom as the middle step", () => {
    expect(ambienceMix({ zoom: Number.NaN, nearCoast: true, nearTown: false }))
      .toEqual(ambienceMix({ zoom: 1, nearCoast: true, nearTown: false }));
  });
});

describe("SFX-1 its place in the mix", () => {
  it("sits a bed at weight × ceiling × volume × duck", () => {
    expect(ambienceBedGain("sea", 1, 1, false)).toBeCloseTo(AMBIENCE_CEILINGS.sea, 9);
    expect(ambienceBedGain("sea", 0.5, 0.5, false))
      .toBeCloseTo(AMBIENCE_CEILINGS.sea * 0.25, 9);
    expect(ambienceBedGain("sea", 1, 1, true))
      .toBeCloseTo(AMBIENCE_CEILINGS.sea * AMBIENCE_DUCK_RATIO, 9);
    expect(AMBIENCE_DUCK_RATIO, "the radio's own 30%").toBe(0.3);
    expect(ambienceBedGain("sea", 1, 0, false), "a zero slider is silence").toBe(0);
    // Under the radio: the loudest the whole island can get, every bed full
    // at full volume, is still a wash next to one radio at half volume.
    const loudest = AMBIENCE_BEDS.reduce((s, b) => s + ambienceBedGain(b, 1, 1, false), 0);
    expect(loudest).toBeLessThan(0.5);
  });

  it("starts silent, follows the probe, and goes quiet on stop", () => {
    const amb = ambMod.createAmbience({ storage: store() });
    expect(amb.levels()).toEqual({ sea: 0, town: 0, birds: 0, wind: 0, traffic: 0 });
    sfxMod.sfx.unlock();
    amb.setProbe({ zoom: 2, nearCoast: true, nearTown: false });
    expect(amb.levels()).toEqual(ambienceMix({ zoom: 2, nearCoast: true, nearTown: false }));
    expect(amb.probe).toEqual({ zoom: 2, nearCoast: true, nearTown: false });
    const gains = amb.gains();
    expect(gains.sea).toBeCloseTo(ambienceBedGain("sea", 1, DEFAULT_AMBIENCE_VOLUME, false), 9);
    expect(gains.town).toBe(0);
    amb.stop();
    expect(amb.levels(), "stop() zeroes the island").toEqual(
      { sea: 0, town: 0, birds: 0, wind: 0, traffic: 0 });
    expect(amb.gains()).toEqual({ sea: 0, town: 0, birds: 0, wind: 0, traffic: 0 });
    // …and the next probe wakes it again.
    amb.setProbe({ zoom: 0.5, nearCoast: false, nearTown: false });
    expect(amb.levels().traffic).toBe(0.9);
  });

  it("remembers the probe but builds nothing before a real gesture", () => {
    const amb = ambMod.createAmbience({ storage: store() });
    amb.setProbe({ zoom: 2, nearCoast: true, nearTown: false });
    expect(amb.probe?.nearCoast, "the probe is remembered").toBe(true);
    expect(amb.levels(), "…but the island stays dark").toEqual(
      { sea: 0, town: 0, birds: 0, wind: 0, traffic: 0 });
    expect(fake.nodes(), "no gesture ⇒ no nodes").toHaveLength(0);
    sfxMod.sfx.unlock();
    amb.setProbe({ zoom: 2, nearCoast: true, nearTown: false });
    expect(amb.levels().sea, "the first tap lands in the right mix").toBe(1);
  });

  it("builds nothing at all while muted", () => {
    sfxMod.sfx.unlock();
    sfxMod.sfx.setEnabled(false);
    const nodesBefore = fake.nodes().length;
    const amb = ambMod.createAmbience({ storage: store() });
    amb.setProbe({ zoom: 2, nearCoast: true, nearTown: false });
    expect(amb.levels(), "muted ⇒ dark").toEqual(
      { sea: 0, town: 0, birds: 0, wind: 0, traffic: 0 });
    expect(fake.nodes().length, "no bed nodes while muted").toBe(nodesBefore);
    expect(fake.started(), "and nothing sounding").toBe(0);
  });

  it("loops every bed through the shared bus when the island wakes", () => {
    sfxMod.sfx.unlock();
    const amb = ambMod.createAmbience({ storage: store() });
    amb.setProbe({ zoom: 2, nearCoast: true, nearTown: false });
    const ctx = fake.contexts()[0]!;
    const loops = ctx.sources.filter((s) => s.startedAt !== null);
    expect(loops.length, "one loop per bed").toBe(5);
    expect(loops.every((s) => s.loop), "every one of them looping").toBe(true);
    // Into the bus, never straight to the speakers: the master gain owns them.
    const master = fake.masterGain()!;
    const ambMaster = ctx.gains.find((g) => g !== master && g.outgoing.includes(master));
    expect(ambMaster, "the island's own master lands on the bus master").toBeTruthy();
    const beds = ctx.gains.filter((g) => g.outgoing.includes(ambMaster!));
    expect(beds.length, "five bed gains into the island master").toBe(5);
    // Beds, not layers: the loops never touch the one-shot voice budget.
    expect(engineMod.liveVoices(), "loops are not layers").toBe(0);
    amb.stop();
    expect(fake.stopped(), "stop() really stops the loops").toBeGreaterThanOrEqual(5);
  });

  it("keeps its own slider, persisted and repainted", () => {
    const mem = store();
    const amb = ambMod.createAmbience({ storage: mem });
    const seen: number[] = [];
    const off = amb.register((s) => { seen.push(s.volume); });
    expect(seen, "painted on registration").toEqual([DEFAULT_AMBIENCE_VOLUME]);
    amb.setVolume(0.2);
    expect(amb.settings.volume).toBe(0.2);
    expect(seen).toEqual([DEFAULT_AMBIENCE_VOLUME, 0.2]);
    expect(JSON.parse(mem.box.get(AMBIENCE_STORAGE_KEY)!)).toEqual({ volume: 0.2 });
    amb.setVolume(9);
    expect(amb.settings.volume, "clamped").toBe(1);
    amb.setVolume(Number.NaN);
    expect(amb.settings.volume, "NaN lands on the default").toBe(DEFAULT_AMBIENCE_VOLUME);
    off();
    amb.setVolume(0.4);
    expect(seen).toEqual([DEFAULT_AMBIENCE_VOLUME, 0.2, 1, DEFAULT_AMBIENCE_VOLUME]);
    // A bad file lands on the default, never a throw.
    mem.box.set(AMBIENCE_STORAGE_KEY, "{nope");
    expect(readAmbienceSettings(mem).volume).toBe(DEFAULT_AMBIENCE_VOLUME);
  });

  it("ducks to 30% under a voice line and restores after", () => {
    sfxMod.sfx.unlock();
    const amb = ambMod.createAmbience({ storage: store() });
    amb.setProbe({ zoom: 2, nearCoast: true, nearTown: false });
    const full = amb.gains().sea;
    expect(full).toBeGreaterThan(0);
    amb.duck(true);
    expect(amb.gains().sea).toBeCloseTo(full * AMBIENCE_DUCK_RATIO, 9);
    amb.duck(false);
    expect(amb.gains().sea).toBeCloseTo(full, 9);
  });
});

describe("SFX-1 the glide", () => {
  it("cross-fades between probes instead of jumping", () => {
    sfxMod.sfx.unlock();
    const amb = ambMod.createAmbience({ storage: store() });
    amb.setProbe({ zoom: 2, nearCoast: false, nearTown: false });
    const ctx = fake.contexts()[0]!;
    const seaGain = (bedIdx: number) => ctx.gains.filter((g) =>
      g !== fake.masterGain() && !g.outgoing.includes(fake.masterGain()!))[bedIdx]!;
    advance(300);
    amb.setProbe({ zoom: 2, nearCoast: true, nearTown: false });
    // The sea bed glided up (setTarget), the birds bed glided down.
    const kinds = (i: number) => seaGain(i).gain.events.map((e) => e.method);
    expect(kinds(0), "the sea cross-fades").toContain("setTarget");
  });

  it("folds a pan's re-probes into one glide", () => {
    sfxMod.sfx.unlock();
    const amb = ambMod.createAmbience({ storage: store() });
    amb.setProbe({ zoom: 0.5, nearCoast: false, nearTown: false });
    const ctx = fake.contexts()[0]!;
    const traffic = ctx.gains.filter((g) =>
      g !== fake.masterGain() && !g.outgoing.includes(fake.masterGain()!))[4]!;
    const before = traffic.gain.events.length;
    // A pan re-probes every frame: same mix, 16 ms apart — nothing new to say.
    for (let i = 0; i < 10; i++) {
      advance(16);
      amb.setProbe({ zoom: 0.5, nearCoast: false, nearTown: false });
    }
    expect(traffic.gain.events.length, "identical probes glide once").toBe(before);
  });

  it("snaps instead of gliding under reduced motion", () => {
    sfxMod.sfx.unlock();
    const amb = ambMod.createAmbience({ storage: store(), reducedMotion: () => true });
    amb.setProbe({ zoom: 2, nearCoast: false, nearTown: false });
    advance(300);
    amb.setProbe({ zoom: 2, nearCoast: true, nearTown: false });
    const ctx = fake.contexts()[0]!;
    const beds = ctx.gains.filter((g) =>
      g !== fake.masterGain() && !g.outgoing.includes(fake.masterGain()!));
    const methods = beds.flatMap((g) => g.gain.events.map((e) => e.method));
    expect(methods, "reduced motion snaps the cross-fade").not.toContain("setTarget");
    expect(methods).toContain("setValueAtTime");
  });
});

describe("SFX-1 headless runs stay silent", () => {
  it("probes, ducks and retunes without audio, nodes or fetches", async () => {
    removeAudio();
    vi.resetModules();
    const bare = (await import("../../src/audio/ambience")).createAmbience({ storage: store() });
    const bareSfx = (await import("../../src/audio/sfx")).sfx;
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    bareSfx.unlock();
    expect(() => {
      bare.setProbe({ zoom: 2, nearCoast: true, nearTown: true });
      bare.duck(true);
      bare.setVolume(0.7);
      bare.duck(false);
      bare.stop();
    }).not.toThrow();
    await flush();
    expect(fetchMock, "no context ⇒ no loop fetches").not.toHaveBeenCalled();
    // …but the mix math still answers, for the debug probe.
    bare.setProbe({ zoom: 2, nearCoast: true, nearTown: false });
    expect(bare.levels().sea).toBe(1);
  });

  it("swaps a shipped loop under its placeholder without a throw", async () => {
    sfxMod.sfx.unlock();
    const ctx = fake.contexts()[0];
    if (ctx) {
      (ctx as unknown as Record<string, unknown>).decodeAudioData =
        async () => ({ duration: 8 });
    }
    const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    vi.stubGlobal("fetch", fetchMock);
    const amb = ambMod.createAmbience({ storage: store() });
    amb.setProbe({ zoom: 2, nearCoast: true, nearTown: false });
    await flush();
    // Five beds, five loop fetches attempted — the placeholder stands where
    // the network says no (the other four tests' 404 is the same path).
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(amb.levels().sea, "the mix survives the swap").toBe(1);
  });
});
