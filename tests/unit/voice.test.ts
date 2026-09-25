// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// VO-1 — the voice queue.
//
// The recordings are not in the repo (the lead drops the MP3s later), so these
// tests pin the contract the game depends on without a single audio file:
//
//   1. ONE LINE AT A TIME. A second cue waits until the first recording ends.
//   2. RIVAL LINES ARE RATE-LIMITED. A burst drops the extras; the gap lets
//      the next one through. Narrator and player lines are not limited.
//   3. A MISSING FILE NEVER THROWS. The subtitle still shows, play() is not
//      called, and the queue moves on.
//   4. MUTE. Voice mute and the global sound mute both suppress audio. The
//      subtitle still shows — silence is not a blank screen.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  RIVAL_GAP_MS, VOICE_LINES, VOICE_STORAGE_KEY, createVoice, parseVoiceLines,
  readingMs, voiceFileUrl, voiceWordCount, voice,
  type VoiceDeps, type VoiceLine, type VoicePlayback,
} from "../../src/game/voice";
import { showSettingsSheet } from "../../src/iso/settings-sheet";
// MUSIC-1 (#377): the radio's switches sit beside the voice pair in the same
// sheet, and the radio ducks through voice.ts's `onLine` hook.
import { RADIO_STORAGE_KEY, radio, readRadioSettings } from "../../src/audio/radio";
import linesJson from "../../assets/voice/lines.json";

const LINES: VoiceLine[] = [
  { id: "n-factory", speaker: "narrator", text: "Raise the factory.", trigger: "coach:setup-factory" },
  { id: "n-depot", speaker: "narrator", text: "Place the depot.", trigger: "coach:setup-harvester" },
  { id: "n-road", speaker: "narrator", text: "Lay the road.", trigger: "coach:need-road" },
  { id: "r-block", speaker: "rival", text: "Road's shut.", trigger: "rival:blockade" },
  { id: "r-ahead", speaker: "rival", text: "I am ahead.", trigger: "rival:ahead" },
  { id: "p-depot", speaker: "player", text: "First depot is up.", trigger: "player:first-depot" },
];

interface Mem { getItem(k: string): string | null; setItem(k: string, v: string): void }
const mem = (init: Record<string, string> = {}): Mem => ({
  getItem: (k) => (k in init ? init[k] : null),
  setItem: (k, v) => { init[k] = v; },
});

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function harness(over: Partial<VoiceDeps> = {}) {
  const shown: string[] = [];
  const plays: { url: string; volume: number }[] = [];
  const ends: Array<() => void> = [];
  let t = 1_000;
  let sound = true;
  const play = (url: string, volume: number): VoicePlayback => {
    plays.push({ url, volume });
    let end = (): void => {};
    const ended = new Promise<void>((resolve) => { end = resolve; });
    ends.push(end);
    return { stop: () => end(), ended };
  };
  const v = createVoice({
    lines: LINES,
    now: () => t,
    soundEnabled: () => sound,
    storage: mem(),
    session: mem(),
    baseUrl: "./",
    probe: async () => true,
    delay: () => Promise.resolve(),
    play,
    sink: {
      show: (line) => shown.push(line.id),
      hide: () => {},
    },
    ...over,
  });
  return {
    v, shown, plays, ends,
    setTime: (n: number) => { t = n; },
    setSound: (on: boolean) => { sound = on; },
  };
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* no storage */ }
  try { sessionStorage.clear(); } catch { /* no storage */ }
});

afterEach(() => {
  // The settings test talks to the singleton. Leave it audible for the next file.
  try {
    voice.setEnabled(true);
    voice.setVolume(0.85);
    voice.stop();
  } catch { /* singleton is garnish here */ }
});

describe("VO-1 queue", () => {
  it("speaks one line at a time and holds the rest until the recording ends", async () => {
    const h = harness();
    h.v.setNarration(true);
    expect(h.v.cue("coach:setup-factory")?.id).toBe("n-factory");
    expect(h.v.cue("coach:setup-harvester")?.id).toBe("n-depot");
    expect(h.shown).toEqual(["n-factory"]);
    expect(h.v.playingId).toBe("n-factory");
    expect(h.v.queueIds).toEqual(["n-depot"]);

    await flush();
    expect(h.plays).toEqual([{ url: "./assets/voice/narrator/n-factory.mp3", volume: 0.85 }]);
    expect(h.shown).toEqual(["n-factory"]);

    h.ends[0]();
    await flush();
    expect(h.shown).toEqual(["n-factory", "n-depot"]);
    expect(h.v.playingId).toBe("n-depot");
    expect(h.plays).toHaveLength(2);
    expect(h.plays[1].url).toBe("./assets/voice/narrator/n-depot.mp3");

    h.ends[1]();
    await h.v.whenIdle();
    expect(h.v.playingId).toBeNull();
    expect(h.v.queueIds).toEqual([]);
  });

  it("tells a listener when a line starts and when it is over (the radio's duck hook)", async () => {
    const h = harness();
    const beats: Array<string | null> = [];
    const off = h.v.onLine((line) => beats.push(line?.id ?? null));

    h.v.setNarration(true);
    h.v.cue("coach:setup-factory");
    // The line is up the moment it is accepted — the duck starts with it.
    expect(beats).toEqual(["n-factory"]);
    await flush();
    h.ends[0]();
    await h.v.whenIdle();
    expect(beats).toEqual(["n-factory", null]);

    // A skip that cuts a narrator off closes the beat as well: a radio must
    // never stay ducked because the line it was ducking for is gone.
    h.v.cue("coach:setup-harvester");
    await flush();
    h.v.skipNarration();
    expect(beats.at(-1)).toBeNull();

    // And an unsubscribe really unsubscribes.
    off();
    const seen = beats.length;
    h.v.cue("rival:blockade");
    await flush();
    h.ends.at(-1)?.();
    await h.v.whenIdle();
    expect(beats.length).toBe(seen);
  });

  it("does not start the narrator until a first game asks, and skip drops the rest", async () => {
    const h = harness();
    expect(h.v.cue("coach:setup-factory")).toBeNull();
    expect(h.shown).toEqual([]);

    h.v.setNarration(true);
    h.v.cue("coach:setup-factory");
    h.v.cue("coach:setup-harvester");
    h.v.skipNarration();
    expect(h.v.narrationSkipped).toBe(true);
    expect(h.v.narrationOn).toBe(false);
    expect(h.v.cue("coach:need-road")).toBeNull();
    expect(h.v.queueIds.filter((id) => id.startsWith("n-"))).toEqual([]);
    // Rival lines are not part of the walk — skip does not gag them.
    expect(h.v.cue("rival:blockade")?.id).toBe("r-block");
    await flush();
    h.ends.at(-1)?.();
    await h.v.whenIdle();
  });
});

describe("VO-1 rival rate limit", () => {
  it("drops a rival line inside the gap and accepts the next one after it", () => {
    const h = harness();
    expect(h.v.cue("rival:blockade")?.id).toBe("r-block");
    expect(h.v.cue("rival:ahead")).toBeNull();
    expect(h.v.cue("rival:blockade")).toBeNull();
    expect(h.v.dropped).toBe(2);
    // Player lines are not limited, even in the same instant.
    expect(h.v.cue("player:first-depot")?.id).toBe("p-depot");

    h.setTime(1_000 + RIVAL_GAP_MS);
    expect(h.v.cue("rival:ahead")?.id).toBe("r-ahead");
    expect(h.v.dropped).toBe(2);
  });
});

describe("VO-1 missing file", () => {
  it("shows the subtitle and does not throw when the recording is absent", async () => {
    const h = harness({ probe: async () => false });
    h.v.setNarration(true);
    expect(() => h.v.cue("coach:setup-factory")).not.toThrow();
    await h.v.whenIdle();
    expect(h.shown).toEqual(["n-factory"]);
    expect(h.plays).toEqual([]);
    expect(h.v.missing).toBe(1);
    expect(h.v.playingId).toBeNull();
  });

  it("treats a thrown probe or a thrown player as a missing file, not a crash", async () => {
    const thrown = harness({
      probe: async () => { throw new Error("404"); },
    });
    thrown.v.setNarration(true);
    thrown.v.cue("coach:setup-factory");
    await thrown.v.whenIdle();
    expect(thrown.shown).toEqual(["n-factory"]);
    expect(thrown.plays).toEqual([]);
    expect(thrown.v.missing).toBe(1);

    const boom = harness({
      play: () => { throw new Error("no audio device"); },
    });
    boom.v.setNarration(true);
    boom.v.cue("coach:setup-factory");
    boom.v.cue("coach:setup-harvester");
    await boom.v.whenIdle();
    expect(boom.shown).toEqual(["n-factory", "n-depot"]);
    expect(boom.v.missing).toBeGreaterThan(0);
  });
});

describe("VO-1 mute", () => {
  it("honours the global sound mute: subtitle on, audio off", async () => {
    const h = harness();
    h.setSound(false);
    h.v.setNarration(true);
    h.v.cue("coach:setup-factory");
    await h.v.whenIdle();
    expect(h.shown).toEqual(["n-factory"]);
    expect(h.plays).toEqual([]);
    expect(h.v.missing).toBe(0);
  });

  it("the voice mute and volume live in settings and silence playback", async () => {
    const store = mem();
    const h = harness({ storage: store });
    h.v.setNarration(true);
    h.v.setEnabled(false);
    expect(h.v.enabled).toBe(false);
    expect(JSON.parse(store.getItem(VOICE_STORAGE_KEY)!)).toMatchObject({ enabled: false });
    h.v.cue("coach:setup-factory");
    await h.v.whenIdle();
    expect(h.shown).toEqual(["n-factory"]);
    expect(h.plays).toEqual([]);

    h.v.setEnabled(true);
    h.v.setVolume(0.4);
    expect(h.v.volume).toBeCloseTo(0.4);
    h.v.cue("coach:setup-harvester");
    await flush();
    expect(h.plays).toEqual([{ url: "./assets/voice/narrator/n-depot.mp3", volume: 0.4 }]);
    h.ends[0]();
    await h.v.whenIdle();
  });

  it("a volume of zero is silence, same as mute", async () => {
    const h = harness();
    h.v.setNarration(true);
    h.v.setVolume(0);
    h.v.cue("coach:setup-factory");
    await h.v.whenIdle();
    expect(h.shown).toEqual(["n-factory"]);
    expect(h.plays).toEqual([]);
  });
});

describe("VO-1 settings", () => {
  it("puts a voice mute and a volume slider on the settings sheet", () => {
    voice.setEnabled(true);
    voice.setVolume(0.85);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const sheet = showSettingsSheet(host);
    const sw = sheet.el.querySelector("[data-gfx='voice']") as HTMLButtonElement;
    const vol = sheet.el.querySelector("[data-gfx='voice-volume']") as HTMLInputElement;
    expect(sw).toBeTruthy();
    expect(sw.getAttribute("role")).toBe("switch");
    expect(sw.textContent).toBe("ON");
    expect(vol).toBeTruthy();
    sw.click();
    expect(sw.textContent).toBe("OFF");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(JSON.parse(localStorage.getItem(VOICE_STORAGE_KEY)!)).toMatchObject({ enabled: false });
    vol.value = "0.35";
    vol.dispatchEvent(new Event("input"));
    expect(voice.volume).toBeCloseTo(0.35);
    expect(JSON.parse(localStorage.getItem(VOICE_STORAGE_KEY)!).volume).toBeCloseTo(0.35);
    sheet.destroy();
    host.remove();
  });

  // MUSIC-1 (#377): the radio's three controls, in the same rows family as the
  // voice pair and saved through the same kind of storage.
  it("puts the Radio switch, its volume and Show radio player beside the voice toggle", () => {
    localStorage.clear();
    radio.setEnabled(true);
    radio.setShow(true);
    radio.setVolume(0.5);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const sheet = showSettingsSheet(host);
    const sw = sheet.el.querySelector("[data-gfx='radio']") as HTMLButtonElement;
    const show = sheet.el.querySelector("[data-gfx='radio-show']") as HTMLButtonElement;
    const vol = sheet.el.querySelector("[data-gfx='radio-volume']") as HTMLInputElement;
    expect(sw).toBeTruthy();
    expect(sw.getAttribute("role")).toBe("switch");
    expect(sw.textContent).toBe("ON");
    expect(show.textContent).toBe("ON");
    expect(vol.value).toBe("0.5");

    sw.click();
    expect(sw.textContent).toBe("OFF");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(radio.settings.enabled).toBe(false);
    expect(JSON.parse(localStorage.getItem(RADIO_STORAGE_KEY)!)).toMatchObject({ enabled: false });

    show.click();
    expect(show.textContent).toBe("OFF");
    expect(radio.settings.show).toBe(false);
    expect(JSON.parse(localStorage.getItem(RADIO_STORAGE_KEY)!)).toMatchObject({ show: false });

    vol.value = "0.2";
    vol.dispatchEvent(new Event("input"));
    expect(radio.settings.volume).toBeCloseTo(0.2);
    // "Survives a reload": a fresh read of the same storage has all three.
    expect(readRadioSettings(localStorage)).toEqual({ enabled: false, show: false, volume: 0.2 });

    sheet.destroy();
    host.remove();
    // Leave the singleton as the shipped defaults for the next file.
    radio.setEnabled(true);
    radio.setShow(true);
    radio.setVolume(0.5);
  });
});

describe("VO-1 script", () => {
  it("ships about forty short lines the lead can record", () => {
    const parsed = parseVoiceLines(linesJson);
    expect(parsed.length).toBe(VOICE_LINES.length);
    expect(parsed.length).toBeGreaterThanOrEqual(40);
    expect(parsed.length).toBeLessThanOrEqual(48);
    const ids = new Set<string>();
    const triggers = new Set<string>();
    for (const line of parsed) {
      expect(ids.has(line.id), `duplicate id ${line.id}`).toBe(false);
      ids.add(line.id);
      triggers.add(line.trigger);
      expect(["narrator", "rival", "player"]).toContain(line.speaker);
      expect(voiceWordCount(line.text)).toBeLessThan(18);
      expect(line.text.length).toBeGreaterThan(0);
      expect(readingMs(line.text)).toBeGreaterThan(0);
    }
    for (const trigger of [
      "coach:setup-factory", "coach:setup-harvester", "coach:tuning-depot",
      "coach:need-road", "coach:first-income", "coach:rail", "coach:platform",
      "rival:industry-taken", "rival:blockade", "rival:battle-won", "rival:battle-lost",
      "rival:ahead", "player:first-depot", "player:first-train", "player:win", "player:lose",
    ]) {
      expect(triggers.has(trigger), trigger).toBe(true);
    }
    expect(voiceFileUrl("narrator", "n-factory", "./")).toBe("./assets/voice/narrator/n-factory.mp3");
    expect(voiceFileUrl("rival", "r-block", "/hex/")).toBe("/hex/assets/voice/rival/r-block.mp3");
  });
});
