// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// SFX-01 — the UI sound layer's contract.
//
// Sound is garnish, so the tests are about the three ways garnish goes wrong:
//
//   1. IT BREAKS THE BOARD. Every cue is played against a full fake Web Audio
//      graph, against HALF an API (the two nodes PP-14's choir test has always
//      stubbed), and against NO AudioContext at all — jsdom's own default. Not
//      one of them may throw, and a missing node type must degrade to a
//      simpler sound rather than to an exception.
//   2. IT NEVER STOPS. A cascade fires `pop` per gem, a stack of toasts fires
//      `deny` per message, a mouse dragged along a row fires `hover` per
//      button. So the catalogue is pinned to its own throttles: every cue has
//      a gap, the mix has a voice budget, and finished layers disconnect.
//   3. IT PLAYS WHEN THE PLAYER DID NOT ASK. Nothing sounds before a REAL
//      gesture (which is also what the autoplay policy demands), a muted game
//      creates no nodes at all — including PP-14's choir, because a mute that
//      spared the loudest sound in the game would not be a mute — and the
//      choice survives the reload.
//
// The delegation itself is tested through events whose `isTrusted` is forced:
// jsdom cannot dispatch a trusted event, and "untrusted events are silent" is
// precisely the property `tests/unit/iso-game.test.ts` depends on when it
// counts oscillators to prove the choir sang (and that a broken cross did not).
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  installFakeAudio, installMinimalAudio, removeAudio, type InstalledFake,
} from "./helpers/audio";
import { AUDIO_STORAGE_KEY, MAX_VOICES } from "../../src/audio/engine";

type SfxModule = typeof import("../../src/audio/sfx");
type CueModule = typeof import("../../src/audio/cues");
type HolyModule = typeof import("../../src/game/holy");

let sfxMod: SfxModule;
let cueMod: CueModule;
let holyMod: HolyModule;
let fake: InstalledFake;
/** The clock the engine's throttles and streaks read. */
let clock = 0;

/** A fresh module registry per test: the engine's state is (deliberately) global. */
async function freshAudio(): Promise<void> {
  vi.resetModules();
  sfxMod = await import("../../src/audio/sfx");
  cueMod = await import("../../src/audio/cues");
  holyMod = await import("../../src/game/holy");
}

const sfx = () => sfxMod.sfx;

/**
 * jsdom marks every event it builds as untrusted, with an own non-configurable
 * getter that cannot be overridden or subclassed around — so the delegation is
 * attached with the injectable predicate (`AttachOptions.isTrusted`) to stand in
 * for a real browser's gesture. The untrusted half of the rule is tested
 * separately, with the predicate left at its default.
 */
const REAL: import("../../src/audio/sfx").AttachOptions = { isTrusted: () => true };

function host(html: string): HTMLElement {
  document.body.innerHTML = `<div id="host">${html}</div>`;
  return document.getElementById("host")!;
}

/** A pointer event with the fields the delegation reads. */
function pointer(type: string, pointerType = "mouse"): Event {
  return Object.assign(new MouseEvent(type, { bubbles: true }), { pointerType });
}

beforeEach(async () => {
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  try { localStorage.clear(); } catch { /* no storage */ }
  fake = installFakeAudio();
  // `window.__sfx` outlives a module reset (the jsdom global does not), and a
  // stale hook would audition a previous test's engine.
  delete (window as unknown as Record<string, unknown>).__sfx;
  await freshAudio();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  removeAudio();
  document.body.innerHTML = "";
});

const advance = (ms: number) => { clock += ms; };

describe("SFX-01 the catalogue is complete and self-describing", () => {
  it("gives every cue a recipe that really builds layers", () => {
    sfx().unlock();
    for (const cue of sfx().cues()) {
      const before = fake.started();
      advance(2000);                       // clear this cue's own gap
      sfx().play(cue, { step: 3 });
      expect(fake.started() - before, `${cue} built no layer`).toBeGreaterThan(0);
    }
  });

  it("explains every cue in the notes the console prints", () => {
    const notes = sfx().notes();
    for (const cue of sfx().cues()) {
      expect(notes[cue], `${cue} has no note`).toBeTruthy();
      expect(notes[cue].length, `${cue}'s note is a stub`).toBeGreaterThan(12);
    }
  });

  it("names the moments the game actually has (the wiring cannot drift silently)", () => {
    // The set is the contract: a new cue needs a note above and a call site,
    // and a removed one must not leave a `sfx.play("…")` pointing at nothing.
    for (const cue of ["hover", "click", "tab", "select", "pop", "deny", "place",
      "pave", "build", "demolish", "harvest", "coin", "star", "wire",
      "victory", "defeat"] as const) {
      expect(sfx().cues(), `${cue} disappeared from the catalogue`).toContain(cue);
    }
  });
});

describe("SFX-01 nothing sounds before the player touches the page", () => {
  it("refuses every cue until a real gesture opens the gate", () => {
    expect(sfx().isArmed()).toBe(false);
    sfx().play("click");
    sfx().play("victory");
    expect(fake.nodes(), "a cue built nodes before any gesture").toHaveLength(0);
    sfx().unlock();
    expect(sfx().isArmed()).toBe(true);
    sfx().play("click");
    expect(fake.started()).toBeGreaterThan(0);
  });

  it("arms from a real gesture, and stays silent for a synthetic one", () => {
    const el = host(`<button id="b">Build</button>`);
    // The DEFAULT predicate: exactly what a page installs.
    sfxMod.attachUiSound(el);
    el.querySelector<HTMLButtonElement>("#b")!
      .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(sfx().isArmed(), "a synthetic event must not open the gate").toBe(false);
    expect(fake.started()).toBe(0);
  });

  it("sounds a press once the gesture is real", () => {
    const el = host(`<button id="b">Build</button>`);
    sfxMod.attachUiSound(el, REAL);
    el.querySelector<HTMLButtonElement>("#b")!.dispatchEvent(pointer("pointerdown"));
    expect(sfx().isArmed()).toBe(true);
    expect(fake.started(), "a real press must sound").toBeGreaterThan(0);
  });

  it("keeps a synthetic .click() silent — the property PP-14's oscillator count rests on", () => {
    const el = host(`<button class="cross-pick-btn" data-sfx="pick">+1</button>`);
    sfxMod.attachUiSound(el);              // default predicate: jsdom's untrusted
    sfx().unlock();                       // even with the gate open…
    el.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    (el.querySelector("button") as HTMLElement).click();
    expect(fake.started(), "a jsdom .click() must never make a sound").toBe(0);
  });
});

describe("SFX-01 the delegation decides what a control sounds like", () => {
  const html = `
    <button id="plain">Road</button>
    <button id="named" data-sfx="coin">Bank</button>
    <button id="silent" data-sfx="off">Mute</button>
    <span id="inside-off" data-sfx="off"><button id="child">Child</button></span>
    <button id="dead" disabled>Unaffordable</button>
    <button id="soft-dead" class="disabled">Also dead</button>
    <button id="tabby" data-tab="market">Market</button>
    <button id="gem" class="gem">A gem</button>
    <button id="nav" class="mnav-btn">Economy</button>
    <button id="no-hover" data-sfx-hover="off">Quiet hover</button>
    <button id="hover-cue" data-sfx-hover="wire">Odd hover</button>
    <div id="not-a-control">Text</div>`;

  const at = (id: string) => document.getElementById(id)!;

  beforeEach(() => { host(html); });

  it("classifies a press by what the element IS", () => {
    expect(sfxMod.pressCueFor(at("plain"))).toBe("click");
    expect(sfxMod.pressCueFor(at("tabby"))).toBe("tab");
    expect(sfxMod.pressCueFor(at("nav"))).toBe("tab");
    expect(sfxMod.pressCueFor(at("gem"))).toBe("select");
    expect(sfxMod.pressCueFor(at("named"))).toBe("coin");
  });

  it("says nothing for a control that opted out, or that is out of order", () => {
    expect(sfxMod.pressCueFor(at("silent"))).toBeNull();
    expect(sfxMod.pressCueFor(at("child")), "data-sfx=off covers the subtree").toBeNull();
    expect(sfxMod.pressCueFor(at("dead"))).toBeNull();
    expect(sfxMod.pressCueFor(at("soft-dead"))).toBeNull();
    expect(sfxMod.pressCueFor(at("not-a-control"))).toBeNull();
    expect(sfxMod.pressCueFor(null)).toBeNull();
  });

  it("keeps the hover tick separate from the press cue", () => {
    expect(sfxMod.hoverCueFor(at("plain"))).toBe("hover");
    expect(sfxMod.hoverCueFor(at("named")), "a press cue does not change the hover").toBe("hover");
    expect(sfxMod.hoverCueFor(at("no-hover"))).toBeNull();
    expect(sfxMod.hoverCueFor(at("hover-cue"))).toBe("wire");
    expect(sfxMod.pressCueFor(at("no-hover")), "…and an off hover still clicks").toBe("click");
    expect(sfxMod.hoverCueFor(at("dead"))).toBeNull();
  });

  it("resolves a control from a child element inside it", () => {
    host(`<button id="wrap"><div class="bb-mid"><b id="label">Depot</b></div></button>`);
    expect(sfxMod.pressCueFor(at("label"))).toBe("click");
    expect(sfxMod.hoverCueFor(at("label"))).toBe("hover");
  });

  it("sounds a real hover once per control, not once per child it contains", () => {
    const el = host(
      `<button id="wrap"><b id="label">Depot</b><small id="sub">2🪨</small></button>`
      + `<button id="other"><b id="other-label">Road</b></button>`,
    );
    sfxMod.attachUiSound(el, REAL);
    const over = (id: string) => el.querySelector(`#${id}`)!.dispatchEvent(pointer("pointerover"));
    over("wrap");
    const first = fake.started();
    expect(first).toBeGreaterThan(0);
    advance(200);
    over("label");
    over("sub");
    expect(fake.started(), "moving inside one button must not tick again").toBe(first);
    advance(200);
    over("other");
    expect(fake.started(), "a different control must tick").toBeGreaterThan(first);
  });

  it("never hovers on touch — a phone's pointerover is the tap's own shadow", () => {
    const el = host(`<button id="b">Road</button>`);
    sfxMod.attachUiSound(el, REAL);
    el.querySelector("#b")!.dispatchEvent(pointer("pointerover", "touch"));
    expect(fake.started()).toBe(0);
    // …but the tap itself still sounds its press.
    el.querySelector("#b")!.dispatchEvent(pointer("pointerdown", "touch"));
    expect(fake.started(), "a tap is a press, not a hover").toBeGreaterThan(0);
  });

  it("gives the keyboard the same feedback as the pointer", () => {
    const el = host(`<button id="b">Road</button>`);
    sfxMod.attachUiSound(el, REAL);
    const key = (k: string, target: EventTarget) =>
      target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    key("Enter", el.querySelector("#b")!);
    expect(fake.started(), "Enter on a button must sound").toBeGreaterThan(0);
    const after = fake.started();
    advance(200);
    key(" ", el.querySelector("#b")!);
    expect(fake.started(), "Space on a button must sound").toBeGreaterThan(after);
  });

  it("leaves a text field alone — Space in the room code types a space", () => {
    const el = host(`<input id="code" value="" /><button id="b">Go</button>`);
    sfxMod.attachUiSound(el, REAL);
    el.querySelector("#code")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    expect(fake.started()).toBe(0);
    // …and `M` in the room code types an m rather than muting the game.
    el.querySelector("#code")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "m", bubbles: true }),
    );
    expect(sfx().isEnabled(), "M inside a text field is a letter").toBe(true);
  });

  it("leaves a <select>'s press to its change — one interaction, one sound", () => {
    const el = host(
      `<select id="s"><option>Market</option><option>Bank</option></select>`
      + `<select id="named" data-sfx="coin"><option>x</option></select>`
      + `<span data-sfx="off"><select id="off"><option>x</option></select></span>`,
    );
    expect(sfxMod.pressCueFor(at("s")), "opening the list is not the choice").toBeNull();
    expect(sfxMod.hoverCueFor(at("s")), "…but it still ticks under the pointer").toBe("hover");
    expect(sfxMod.pressCueFor(at("named")), "markup still beats the convention").toBe("coin");

    sfxMod.attachUiSound(el, REAL);
    el.querySelector("#s")!.dispatchEvent(pointer("pointerdown"));
    expect(fake.started(), "pressing a select says nothing").toBe(0);
    el.querySelector("#s")!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(fake.started(), "choosing in it sounds the drawer").toBeGreaterThan(0);
    advance(200);
    const after = fake.started();
    el.querySelector("#off")!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(fake.started(), "data-sfx=off covers a select's change too").toBe(after);
  });

  it("stands down when an ancestor scope is already listening", () => {
    // main.tsx attaches to the document; ui.ts attaches to the HUD root so a
    // chrome mounted without App is covered too. In the real app one click is
    // captured by BOTH — and a duplicate only hidden by the cue's own gap is a
    // bug waiting for a cue with a short one.
    const el = host(`<button id="b">Road</button>`);
    const offDocument = sfxMod.attachUiSound(document, REAL);
    const nested = sfxMod.attachUiSound(el, REAL);
    const press = () => {
      advance(200);
      el.querySelector("#b")!.dispatchEvent(pointer("pointerdown"));
    };
    press();
    const st = sfx().stats();
    expect(st.played, "heard once").toBe(1);
    expect(st.throttled, "…and nothing had to be swallowed to get there").toBe(0);
    nested();                       // the skipped attach owns no listeners
    press();
    expect(sfx().stats().played, "the document delegation outlives it").toBe(2);
    offDocument();
    press();
    expect(sfx().stats().played, "and detaching it really does go quiet").toBe(2);
  });

  it("attaches once per scope, and detaches what it attached", () => {
    const el = host(`<button id="b">Road</button>`);
    const detach = sfxMod.attachUiSound(el, REAL);
    sfxMod.attachUiSound(el, REAL);                 // idempotent
    const press = () => {
      advance(200);
      el.querySelector("#b")!.dispatchEvent(pointer("pointerdown"));
    };
    press();
    const once = fake.started();
    expect(once, "one delegation, one sound — a second attach added nothing").toBeGreaterThan(0);
    detach();
    press();
    expect(fake.started(), "a detached delegation must stop sounding").toBe(once);
  });
});

describe("SFX-01 the mix cannot run away", () => {
  beforeEach(() => sfx().unlock());

  it("throttles a cue inside its own gap", () => {
    sfx().play("hover");
    const first = fake.started();
    expect(first).toBeGreaterThan(0);
    sfx().play("hover");
    sfx().play("hover");
    expect(fake.started(), "a hover 0 ms after a hover must be swallowed").toBe(first);
    expect(sfx().stats().throttled).toBeGreaterThan(0);
    advance(120);
    sfx().play("hover");
    expect(fake.started(), "…and allowed again once the gap has passed").toBeGreaterThan(first);
  });

  it("collapses a whole cascade resolving in one synchronous pass", () => {
    // `board.settle()` can fire `pop` for nine gems without a millimetre
    // between them. Heard raw that is a blast, not a cascade — the gap folds it
    // into a single strike, and the gems that follow land as the board animates.
    let heard = 0;
    for (let i = 0; i < 9; i++) {
      const before = fake.started();
      sfx().play("pop");
      if (fake.started() > before) heard++;
    }
    expect(heard, "one synchronous burst is one sound").toBe(1);
  });

  it("lets a cascade that animates be heard gem by gem", () => {
    let heard = 0;
    for (let i = 0; i < 9; i++) {
      const before = fake.started();
      sfx().play("pop");
      if (fake.started() > before) heard++;
      advance(45);                                   // the board's own spacing
    }
    expect(heard, "every gem of a running cascade is heard").toBe(9);
  });

  it("climbs the pentatonic ladder while the cascade runs, and resets after it", () => {
    const pitchOf = () => {
      const before = fake.pitches().length;
      sfx().play("pop");
      return fake.pitches().slice(before);
    };
    const a = pitchOf(); advance(60);
    const b = pitchOf(); advance(60);
    const c = pitchOf();
    expect(a[0]).toBe(440);
    expect(b[0], "the second gem of a cascade rises").toBeGreaterThan(a[0]!);
    expect(c[0], "and the third rises again").toBeGreaterThan(b[0]!);
    advance(1500);                                   // the cascade is over
    expect(pitchOf()[0], "a new cascade starts back at the root").toBe(440);
  });

  it("never exceeds the voice budget, however many cues land at once", () => {
    for (const cue of sfx().cues()) sfx().play(cue, { step: 2 });
    expect(sfx().stats().live).toBeLessThanOrEqual(MAX_VOICES);
    // and the budget frees itself as layers finish
    fake.fireEnded();
    advance(5000);
    expect(sfx().stats().live, "finished layers must leave the budget").toBe(0);
  });

  it("disconnects a finished layer instead of leaving it on the bus", () => {
    sfx().play("build");
    expect(fake.disconnects()).toBe(0);
    fake.fireEnded();
    expect(fake.disconnects(), "every started layer must be torn down").toBeGreaterThan(0);
  });

  it("starts everything it stops", () => {
    for (const cue of sfx().cues()) { advance(2000); sfx().play(cue, { step: 4 }); }
    expect(fake.stopped()).toBe(fake.started());
  });
});

describe("SFX-01 the mute switch mutes the whole game", () => {
  it("creates nothing at all while muted — no context, no nodes", () => {
    sfx().unlock();
    sfx().setEnabled(false);
    expect(sfx().isEnabled()).toBe(false);
    for (const cue of sfx().cues()) sfx().play(cue);
    holyMod.playHoly();
    expect(fake.started(), "a muted game must be completely silent").toBe(0);
  });

  it("mutes PP-14's choir too — the loudest sound in the game is not exempt", () => {
    holyMod.prewarmHoly();
    holyMod.playHoly();
    expect(fake.started(), "the choir sings when sound is on").toBeGreaterThan(10);
    const after = fake.started();
    sfx().setEnabled(false);
    holyMod.playHoly();
    expect(fake.started(), "…and must not sing when sound is off").toBe(after);
  });

  it("routes the choir through the shared bus, so one master gain owns both", () => {
    holyMod.playHoly();
    const ctx = fake.contexts()[0]!;
    const master = fake.masterGain();
    expect(master, "the bus built a master gain").not.toBeNull();
    // the bus: master → limiter → speakers
    const limiter = ctx.compressors[0];
    expect(limiter, "the bus builds its soft limiter when the API offers one").toBeTruthy();
    expect(master!.outgoing, "the master runs INTO the limiter").toContain(limiter!);
    expect(limiter!.outgoing, "…and the limiter runs to the speakers").toContain(ctx.destination);
    // the choir's own swell connects into the bus, never straight to the speakers
    const swell = ctx.gains.find((g) => g !== master && g.outgoing.includes(master!));
    expect(swell, "the choir's swell must land on the master gain").toBeTruthy();
    const voices = ctx.gains.filter((g) => g.outgoing.includes(swell!));
    expect(voices.length, "12 choir voices + 4 halo bells").toBeGreaterThanOrEqual(16);
  });

  it("builds a limiter, and still works where the API does not offer one", async () => {
    installMinimalAudio();
    vi.resetModules();
    const half = await import("../../src/game/holy");
    expect(() => half.playHoly()).not.toThrow();
  });

  it("sings again when unmuted, and says so with a sound of its own", () => {
    sfx().unlock();
    sfx().setEnabled(false);
    const muted = fake.started();
    const on = sfx().toggle();
    expect(on).toBe(true);
    expect(fake.started(), "unmuting confirms itself").toBeGreaterThan(muted);
    advance(200);
    const afterOn = fake.started();
    sfx().toggle();
    expect(fake.started(), "muting is silent").toBe(afterOn);
  });

  it("answers the M shortcut by flipping the switch", () => {
    const el = host(`<button id="b">Road</button>`);
    sfxMod.attachUiSound(el, REAL);
    const m = () => {
      const ev = new KeyboardEvent("keydown", { key: "m", bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      return ev;
    };
    // The shortcut swallows the key so nothing downstream can act on it too —
    // which it may only do from a listener that is NOT passive: a passive
    // listener's preventDefault() is ignored, with a console warning, by every
    // browser that honours the flag (jsdom among them, which is why this is
    // assertable here at all).
    expect(m().defaultPrevented, "M is consumed, and the listener may consume it").toBe(true);
    expect(sfx().isEnabled(), "…and that first M muted").toBe(false);
    m();
    expect(sfx().isEnabled(), "M unmutes").toBe(true);
    // a modified M is somebody else's shortcut
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "m", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(sfx().isEnabled()).toBe(true);
  });

  it("puts the volume on the master gain, and keeps it inside 0..1", () => {
    sfx().unlock();
    sfx().setVolume(0.2);
    expect(sfx().volume()).toBe(0.2);
    const ramps = fake.masterGain()!.gain.events.filter((e) => e.method === "linearRamp");
    expect(ramps.at(-1)?.value, "the master gain follows the setting").toBeCloseTo(0.2, 5);
    sfx().setVolume(9);
    expect(sfx().volume(), "a nonsense volume is clamped").toBe(1);
    sfx().setVolume(-3);
    expect(sfx().volume()).toBe(0);
    sfx().setVolume(Number.NaN);
    expect(sfx().volume(), "and so is NaN").toBeGreaterThan(0);
  });

  it("drops the master to zero instead of ramping a click when muted mid-cue", () => {
    sfx().unlock();
    sfx().play("build");
    sfx().setEnabled(false);
    const master = fake.masterGain()!;
    expect(master.gain.events.at(-1)?.value).toBe(0);
    expect(master.gain.events.filter((e) => e.method === "cancel").length)
      .toBeGreaterThan(0);
  });

  it("remembers the choice across a reload", () => {
    sfx().setEnabled(false);
    sfx().setVolume(0.3);
    const raw = localStorage.getItem(AUDIO_STORAGE_KEY);
    expect(raw, "the setting is persisted").toBeTruthy();
    expect(JSON.parse(raw!)).toEqual({ enabled: false, volume: 0.3 });
  });

  it("boots silent when the URL says so, without touching storage", async () => {
    window.history.replaceState({}, "", "/?sound=0");
    vi.resetModules();
    const fresh = (await import("../../src/audio/sfx")).sfx;
    expect(fresh.isEnabled(), "?sound=0 boots muted").toBe(false);
    expect(localStorage.getItem(AUDIO_STORAGE_KEY), "a URL flag is not a saved preference").toBeNull();
    fresh.unlock();
    fresh.play("click");
    expect(fake.started()).toBe(0);
    window.history.replaceState({}, "", "/");
  });

  it("repaints every registered control when the setting changes", () => {
    const seen: boolean[] = [];
    const off = sfxMod.registerSoundPainter((enabled) => { seen.push(enabled); });
    expect(seen, "a control is painted on registration").toEqual([true]);
    sfx().setEnabled(false);
    expect(seen).toEqual([true, false]);
    sfx().toggle();
    expect(seen).toEqual([true, false, true]);
    off();
    sfx().setEnabled(false);
    expect(seen, "an unregistered control stops being painted").toEqual([true, false, true]);
  });
});

describe("SFX-01 garnish must never break the board", () => {
  it("plays every cue where there is no AudioContext at all (jsdom's default)", async () => {
    removeAudio();
    vi.resetModules();
    const bare = (await import("../../src/audio/sfx")).sfx;
    const holy = await import("../../src/game/holy");
    bare.unlock();
    expect(() => {
      for (const cue of bare.cues()) bare.play(cue, { step: 2 });
      holy.playHoly();
      holy.prewarmHoly();
    }).not.toThrow();
  });

  it("degrades to the nodes it has when the API is only half there", async () => {
    const minimal = installMinimalAudio();
    vi.resetModules();
    const half = (await import("../../src/audio/sfx")).sfx;
    half.unlock();
    expect(() => {
      for (const cue of half.cues()) { advance(2000); half.play(cue, { step: 2 }); }
    }).not.toThrow();
    // A noise-only cue has nothing to build with (no buffer source) and stays
    // silent; a tone cue still sounds. That is the degradation, and it is the
    // whole reason PP-14's two-node stub keeps working.
    expect(minimal.started(), "oscillator cues survive half an API").toBeGreaterThan(0);
  });

  it("sings the choir through a two-node context, exactly as PP-14 pins it", async () => {
    const minimal = installMinimalAudio();
    vi.resetModules();
    const holy = await import("../../src/game/holy");
    expect(() => holy.playHoly()).not.toThrow();
    expect(minimal.started(), "12 choir voices + wobbles + 4 bells").toBeGreaterThan(10);
  });

  it("ignores a cue name that does not exist", () => {
    sfx().unlock();
    expect(() => sfx().play("not-a-cue" as never)).not.toThrow();
    expect(cueMod.isCue("pop")).toBe(true);
    expect(cueMod.isCue("not-a-cue")).toBe(false);
  });
});

describe("SFX-01 the mix is legal Web Audio, and measurably quiet", () => {
  // Nobody can listen to a CI run, but everything that would make a real engine
  // THROW — or make the HUD loud — is a number on the fake's recorded
  // automation. The shipped catalogue measures: loudest single layer 0.16,
  // loudest cue 0.34 summed over layers that are not in fact simultaneous,
  // 44 Hz..2.1 kHz, longest layer 2.1 s — so at the default master gain of 0.55
  // the worst moment in the HUD lands near -15 dBFS. These ceilings exist to be
  // exceeded only on purpose, in a diff that also moves the number here.
  it("audits every cue's automation against the engine's real rules", () => {
    sfx().unlock();
    const c = fake.contexts()[0]!;
    let gMark = 1;   // gains[0] is the bus master
    let oMark = 0;
    let sMark = 0;
    let worstCue = 0;
    let worstLayer = 0;
    let lowestHz = Infinity;
    let highestHz = 0;
    let longest = 0;

    for (const cue of sfx().cues()) {
      advance(5_000);              // past this cue's own gap, and its voices expire
      sfx().play(cue, { step: 3 });

      const gains = c.gains.slice(gMark);
      const oscs = c.oscillators.slice(oMark);
      const srcs = c.sources.slice(sMark);
      gMark = c.gains.length;
      oMark = c.oscillators.length;
      sMark = c.sources.length;

      expect(oscs.length + srcs.length, `${cue} builds layers`).toBeGreaterThan(0);
      expect(gains.length, `${cue} envelops each layer in its own gain`).toBe(oscs.length + srcs.length);

      const peaks = gains.map((g) => Math.max(0, ...g.gain.events.map((e) => e.value)));
      for (const peak of peaks) {
        expect(peak, `${cue}: a single layer is too loud`).toBeLessThanOrEqual(0.2);
        worstLayer = Math.max(worstLayer, peak);
      }
      worstCue = Math.max(worstCue, peaks.reduce((a, b) => a + b, 0));

      for (const o of oscs) {
        expect(o.frequency.events.length, `${cue}: an oscillator with no pitch`).toBeGreaterThan(0);
        for (const e of o.frequency.events) {
          // A sweep to 0 Hz — or an exponentialRamp to 0 on any param — is an
          // InvalidValueError in a real engine, not a quiet note.
          expect(e.value, `${cue}: frequency must stay positive`).toBeGreaterThan(0);
          expect(e.value, `${cue}: frequency out of hearing`).toBeLessThan(12_000);
          expect(Number.isFinite(e.time ?? 0), `${cue}: finite schedule`).toBe(true);
          lowestHz = Math.min(lowestHz, e.value);
          highestHz = Math.max(highestHz, e.value);
        }
      }
      for (const g of gains) {
        for (const e of g.gain.events) {
          if (e.method === "exponentialRamp") {
            expect(e.value, `${cue}: an exponential gain ramp may not reach 0`).toBeGreaterThan(0);
          }
          expect(Number.isFinite(e.value), `${cue}: finite gain`).toBe(true);
          expect(e.value, `${cue}: no negative gain (phase flip)`).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(e.time ?? 0), `${cue}: finite schedule`).toBe(true);
        }
      }
      for (const node of [...oscs, ...srcs]) {
        expect(node.startedAt, `${cue}: every layer is started`).not.toBeNull();
        expect(node.stoppedAt, `${cue}: every layer is stopped`).not.toBeNull();
        expect(node.stoppedAt!, `${cue}: stops after it starts`).toBeGreaterThan(node.startedAt!);
        longest = Math.max(longest, node.stoppedAt! - node.startedAt!);
      }
    }

    expect(worstLayer, "at least one layer is audible").toBeGreaterThan(0);
    expect(worstCue, "no cue sums past comfortable headroom").toBeLessThanOrEqual(0.45);
    expect(lowestHz, "nothing below what a phone speaker can move").toBeGreaterThanOrEqual(20);
    expect(highestHz, "nothing that reads as a mosquito").toBeLessThanOrEqual(6_000);
    expect(longest, "no layer outlives the moment it belongs to").toBeLessThanOrEqual(2.5);
  });
});

describe("SFX-01 the console hook", () => {
  it("is gated the same way as __iso, and installs in a dev build", () => {
    expect(sfxMod.debugWanted("", true)).toBe(true);
    expect(sfxMod.debugWanted("", false)).toBe(false);
    expect(sfxMod.debugWanted("?iso-debug=1", false)).toBe(true);
    expect(sfxMod.debugWanted("?sfx-debug=1", false)).toBe(true);
    expect(sfxMod.debugWanted("?debug=0", false)).toBe(false);
    expect(sfxMod.debugWanted("", false)).toBe(false);
  });

  it("can audition the whole catalogue without playing a match", () => {
    vi.useFakeTimers();
    const w = window as unknown as Record<string, { play(c: string): string; audition(g?: number): () => void }>;
    sfxMod.installSfxDebug();
    expect(w.__sfx, "__sfx is installed in a dev build").toBeTruthy();
    expect(w.__sfx.play("nope")).toContain("unknown cue");
    w.__sfx.audition(40);
    // Step the timer AND the engine's own clock together: the audition spaces
    // its cues so each one's layers have finished before the next starts, which
    // is exactly what the voice budget expects of a real audition.
    for (let i = 0; i < sfx().cues().length; i++) {
      vi.advanceTimersByTime(40);
      advance(400);
    }
    expect(sfx().stats().played, "the audition walked the catalogue")
      .toBeGreaterThanOrEqual(sfx().cues().length);
    vi.useRealTimers();
  });
});
