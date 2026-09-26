// @vitest-environment jsdom
// RADIO-2 (#432) — the dial: shape, persistence, failover, no autoplay.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  RADIO_STATION_KEY, RADIO_STATION_NAME, RADIO_STATIONS, RADIO_STREAM_URL,
  createRadio, failoverStation, mountRadioWidget, readStationId, stepStation,
  writeStationId,
  type RadioAudio, type RadioStation,
} from "../../src/audio/radio";

interface FakeAudio extends RadioAudio {
  plays: number;
  emit(type: "playing" | "error" | "ended"): void;
}

function fakeAudio(): FakeAudio {
  const listeners = new Map<string, Array<() => void>>();
  const a = {
    volume: 1,
    src: "",
    preload: "none",
    plays: 0,
    play() { a.plays += 1; return Promise.resolve(); },
    pause() {},
    load() {},
    addEventListener(type: string, fn: () => void) {
      const set = listeners.get(type) ?? [];
      set.push(fn);
      listeners.set(type, set);
    },
    emit(type: "playing" | "error" | "ended") {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
  };
  return a;
}

function mem(init: Record<string, string> = {}) {
  return {
    getItem: (k: string) => (k in init ? init[k] : null),
    setItem: (k: string, v: string) => { init[k] = v; },
    dump: init,
  };
}

/** A throwing store: private mode, or a test double that refuses both calls. */
function throwingStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; sets: number } {
  return {
    sets: 0,
    getItem() { throw new Error("storage denied"); },
    setItem() { this.sets += 1; throw new Error("storage denied"); },
  };
}

const DIAL: readonly RadioStation[] = [
  { id: "a", name: "Alpha", url: "https://radio.test/a.mp3", genre: "lounge", licence: "CC BY 3.0", termsUrl: "https://example.com/a", credit: "Credit Alpha." },
  { id: "b", name: "Beta", url: "https://radio.test/b.mp3", genre: "jazz", licence: "CC0", termsUrl: "https://example.com/b", credit: "Credit Beta." },
  { id: "c", name: "Gamma", url: "https://radio.test/c.mp3", genre: "surf", licence: "Public domain", termsUrl: "https://example.com/c", credit: "Credit Gamma." },
];

afterEach(() => {
  document.body.innerHTML = "";
});

describe("RADIO-2 station list", () => {
  it("ships 4 to 6 stations, each with id, name, url and licence", () => {
    expect(RADIO_STATIONS.length).toBeGreaterThanOrEqual(4);
    expect(RADIO_STATIONS.length).toBeLessThanOrEqual(6);
    const ids = new Set<string>();
    for (const s of RADIO_STATIONS) {
      expect(s.id).toMatch(/^[a-z0-9-]+$/);
      expect(s.name.trim().length).toBeGreaterThan(0);
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.licence.trim().length).toBeGreaterThan(0);
      expect(s.termsUrl).toMatch(/^https:\/\//);
      expect(s.genre.trim().length).toBeGreaterThan(0);
      expect(s.credit.trim().length).toBeGreaterThan(0);
      // Player-facing copy is scanned for developer comments. No URL in it.
      expect(s.name).not.toContain("//");
      expect(s.credit).not.toContain("//");
      expect(s.credit).not.toContain("(#");
      expect(s.licence).not.toContain("//");
      ids.add(s.id);
    }
    expect(ids.size).toBe(RADIO_STATIONS.length);
    // The shipped default is still the stream MUSIC-1 tests pin by name.
    expect(RADIO_STATION_NAME).toBe("SomaFM Secret Agent");
    expect(RADIO_STREAM_URL).toBe(RADIO_STATIONS[0].url);
    expect(RADIO_STATIONS[0].id).toBe("secret-agent");
  });

  it("records every terms URL in docs/RADIO.md", () => {
    const doc = readFileSync("docs/RADIO.md", "utf8");
    for (const s of RADIO_STATIONS) {
      expect(doc, s.id).toContain(s.termsUrl);
      expect(doc, s.id).toContain(s.name);
      expect(doc, s.id).toContain(s.url);
    }
  });
});

describe("RADIO-2 persistence", () => {
  it("round-trips the station id, and a throwing storage never throws", () => {
    const store = mem();
    writeStationId(store, "mdk-space");
    expect(store.dump[RADIO_STATION_KEY]).toBe("mdk-space");
    expect(readStationId(store)).toBe("mdk-space");

    // A fresh player over the same storage comes back on that station.
    const audio = fakeAudio();
    const first = createRadio({
      stations: RADIO_STATIONS, audio, storage: store, doc: null, fadeMs: 0,
      makeAudio: () => audio, soundGate: () => true,
    });
    expect(first.stationId).toBe("mdk-space");
    first.setStation("dogmazic");
    expect(readStationId(store)).toBe("dogmazic");
    const second = createRadio({
      stations: RADIO_STATIONS, audio: fakeAudio(), storage: store, doc: null, fadeMs: 0,
      makeAudio: () => fakeAudio(), soundGate: () => true,
    });
    expect(second.stationId).toBe("dogmazic");
    expect(second.station).toBe("Radio Dogmazic");

    // Unknown id, empty store, null store: the first station, not a throw.
    expect(readStationId(mem({ [RADIO_STATION_KEY]: "nope" }))).toBe(RADIO_STATIONS[0].id);
    expect(readStationId(mem())).toBe(RADIO_STATIONS[0].id);
    expect(readStationId(null)).toBe(RADIO_STATIONS[0].id);

    const denied = throwingStorage();
    expect(() => writeStationId(denied, "mdk-space")).not.toThrow();
    expect(() => readStationId(denied)).not.toThrow();
    expect(readStationId(denied)).toBe(RADIO_STATIONS[0].id);
    // The write was attempted and refused — the choice does not survive.
    expect(denied.sets).toBe(1);

    const refused = throwingStorage();
    const player = createRadio({
      stations: RADIO_STATIONS, audio: fakeAudio(), storage: refused, doc: null, fadeMs: 0,
      makeAudio: () => fakeAudio(), soundGate: () => true,
    });
    expect(player.stationId).toBe(RADIO_STATIONS[0].id);
    expect(() => player.setStation("mdk-space")).not.toThrow();
    // In memory the pick stands; a reload cannot see it.
    expect(player.stationId).toBe("mdk-space");
    expect(readStationId(refused)).toBe(RADIO_STATIONS[0].id);
    expect(player.machine.status).toBe("idle");
  });
});

describe("RADIO-2 failover", () => {
  it("picks the next station that has not already failed", () => {
    expect(failoverStation(DIAL, "a", [])?.id).toBe("b");
    expect(failoverStation(DIAL, "b", ["b"])?.id).toBe("c");
    // Wraps, skipping stations already tried. The current id counts as failed.
    expect(failoverStation(DIAL, "c", ["b"])?.id).toBe("a");
    // Every station tried: nowhere new to go. The caller goes offline.
    expect(failoverStation(DIAL, "c", ["a", "b"])).toBeNull();
    expect(failoverStation(DIAL, "c", ["a", "b", "c"])).toBeNull();
    expect(failoverStation(DIAL.slice(0, 1), "a", [])).toBeNull();
    expect(stepStation(DIAL, "c", 1)?.id).toBe("a");
    expect(stepStation(DIAL, "a", -1)?.id).toBe("c");
  });

  it("tunes the next station on an error, and goes offline only when the dial is exhausted", () => {
    const audio = fakeAudio();
    const notices: string[] = [];
    const r = createRadio({
      stations: DIAL, audio, storage: mem(), doc: null, fadeMs: 0, loadTimeoutMs: 0,
      makeAudio: () => audio, soundGate: () => true,
      onNotice: (m) => notices.push(m),
    });
    r.play();
    expect(audio.src).toBe("https://radio.test/a.mp3");
    expect(r.machine.status).toBe("loading");

    audio.emit("error");
    expect(r.stationId).toBe("b");
    expect(audio.src).toBe("https://radio.test/b.mp3");
    expect(audio.plays).toBe(2);
    expect(r.machine.status).toBe("loading");
    expect(notices).toEqual(["Alpha is not answering. Tuning Beta."]);

    audio.emit("error");
    expect(r.stationId).toBe("c");
    expect(audio.src).toBe("https://radio.test/c.mp3");
    expect(notices[1]).toContain("Tuning Gamma");

    audio.emit("error");
    expect(r.machine.status).toBe("offline");
    expect(r.machine.failures).toBe(1);
    expect(r.machine.want).toBe(true);
    // It did not wrap forever inside the same error.
    expect(audio.plays).toBe(3);
  });
});

describe("RADIO-2 no autoplay", () => {
  it("does not open a stream before a user gesture, including next, prev and setStation", () => {
    const audio = fakeAudio();
    const r = createRadio({
      stations: RADIO_STATIONS, audio, storage: mem(), doc: null, fadeMs: 0,
      makeAudio: () => audio, soundGate: () => true,
    });
    expect(r.machine).toMatchObject({ status: "idle", want: false });
    expect(audio.plays).toBe(0);
    expect(audio.src).toBe("");
    expect(audio.preload).toBe("none");

    r.next();
    r.prev();
    r.setStation("mdk-space");
    r.setStation("radionos-lounge");
    expect(audio.plays).toBe(0);
    expect(audio.src).toBe("");
    expect(r.machine.status).toBe("idle");
    expect(r.machine.want).toBe(false);
    expect(r.stationId).toBe("radionos-lounge");

    // The chip's own ‹ › is the same door: a click is not a play.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const widget = mountRadioWidget(host, r);
    const next = widget.el.querySelector(".radio-next") as HTMLButtonElement;
    const prev = widget.el.querySelector(".radio-prev") as HTMLButtonElement;
    expect(next).toBeTruthy();
    expect(prev).toBeTruthy();
    next.click();
    prev.click();
    expect(audio.plays).toBe(0);
    expect(audio.src).toBe("");
    expect(widget.playButton.getAttribute("aria-label")).toContain("Play");

    // The gesture is the play key, and only then.
    widget.playButton.click();
    expect(audio.plays).toBe(1);
    expect(audio.src).toBe("https://nos.radio.br:443/stream/13/;");
  });
});
