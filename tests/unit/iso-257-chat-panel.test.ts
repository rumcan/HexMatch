// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// C2 (#257) — the chat panel in the chrome.
//
// The ticket's acceptance block, at the level jsdom can see it (the two live
// browsers, the phone's soft keyboard and the pixels belong to the lead's
// play-test):
//
//   • MULTIPLAYER ONLY. The panel is built from a `chat` config the GAME hands
//     in, and a solo boot hands in nothing — so "hidden in solo" is not a
//     visibility flag here, it is the absence of a panel. The last test boots
//     a real solo game and asserts the element is not in the tree at all.
//   • TEXT, NEVER MARKUP. Every line goes in through `textContent`, and the
//     test drives a name and a message built to look like HTML through the
//     panel to prove that `<img src=x onerror=…>` is a sentence, not a tag.
//   • Presets are buttons, mute and presets-only are on the panel, unread is
//     counted while the panel is shut, Enter sends and Esc closes.
//   • The composer keeps its own keys: a key pressed inside the panel never
//     reaches the game's window-level hotkey handler (the stand-in for
//     `onKeydown` in game.ts, whose own `isTypingTarget` guard is the second
//     half of the same promise).
//
// The RULES are not tested here — sanitising, the word filter, presets-only,
// mute and both rate windows are `net-chat.test.ts`'s (C1 #255). This file is
// about what the chrome does with the verdicts that come back.
// ══════════════════════════════════════════════════════════════════════════
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Board } from "../../src/game/board";
import {
  createOriginalUi,
  type OriginalUi,
  type UiChatConfig,
  type UiChatPrefs,
  type UiState,
} from "../../src/game/ui";
import { emptyBag } from "../../src/iso/purse";
import { mulberry32, setRng } from "../../src/game/config";
import { CHAT_MAX_LEN, CHAT_PRESETS } from "../../src/net/chat";
// The unread tick is the panel's only sound, and "is anything heard" is the
// sfx layer's question — so the spec spies on the door, not on an oscillator.
import { sfx } from "../../src/audio/sfx";

vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

// ── the harness ───────────────────────────────────────────────────────────
/** What the fake game hands the chrome, and what the chrome handed back. */
interface FakeGame {
  prefs: UiChatPrefs;
  /** Every line the panel tried to say, in order. */
  attempts: string[];
  /** The next `send` verdict; `true` accepts (and the test then echoes). */
  verdict: { ok: boolean; reason?: string };
  setCalls: Partial<UiChatPrefs>[];
  peer: string | null;
}

let game: FakeGame;
let ui: OriginalUi | null;

function mountChat(withChat = true): OriginalUi {
  setRng(mulberry32(7));
  const board = new Board();
  const seat = { id: "you", name: "You", res: emptyBag(), unlocked: null };
  const cfg: UiChatConfig = {
    presets: CHAT_PRESETS,
    maxLength: CHAT_MAX_LEN,
    getPrefs: () => ({ ...game.prefs }),
    setPrefs: (patch) => {
      game.setCalls.push(patch);
      if (typeof patch.muted === "boolean") game.prefs.muted = patch.muted;
      if (typeof patch.presetOnly === "boolean") game.prefs.presetOnly = patch.presetOnly;
    },
    send: (text) => {
      game.attempts.push(text);
      if (!game.verdict.ok) return { ok: false, reason: game.verdict.reason };
      // A line that goes out comes back through `chatLine` with the text that
      // actually crossed the wire — the panel shows what the game logged, not
      // what was typed into it.
      ui!.chatLine({ role: "you", who: "You", colour: "#5aa8ff", text });
      return { ok: true };
    },
    peerName: () => game.peer,
  };
  const mounted = createOriginalUi(board, seat, {
    onTool: vi.fn(), onRecenter: vi.fn(), onSwap: vi.fn(), onReset: vi.fn(),
    onBank: vi.fn(() => "done" as const), onBlackAction: vi.fn(),
  }, withChat ? { chat: cfg } : {});
  document.body.append(mounted.el);
  ui = mounted;
  return mounted;
}

/** The slice of `UiState` paint() needs — the defaults for everything else. */
function state(over: Partial<UiState> = {}): UiState {
  return {
    players: [
      { id: "you", name: "You", colour: "#5aa8ff", vp: 0, human: true },
      { id: "ai", name: "Torvin", colour: "#ff7a5a", vp: 0, human: true },
    ],
    purse: {}, phase: "play", tool: "select", freeTrack: 0, freeDepots: 0,
    banner: null, bannerKey: null, costInfo: null, inspect: null,
    reach: {}, resetIn: 0, portrait: "you",
    ...over,
  };
}

const root = () => ui!.el;
const dock = () => root().querySelector<HTMLElement>("#iso-chat");
const bodyEl = () => root().querySelector<HTMLElement>("#iso-chat-body");
const headEl = () => root().querySelector<HTMLButtonElement>("#iso-chat-toggle")!;
const inputEl = () => root().querySelector<HTMLInputElement>("#iso-chat-input")!;
const logEl = () => root().querySelector<HTMLElement>("#iso-chat-log")!;
const badgeEl = () => root().querySelector<HTMLElement>("#iso-chat-badge")!;
const noteEl = () => root().querySelector<HTMLElement>("#iso-chat-note")!;
const isOpen = () => !!dock()?.classList.contains("open");
const key = (el: Element, k: string) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

beforeEach(() => {
  game = {
    prefs: { muted: false, presetOnly: false },
    attempts: [],
    verdict: { ok: true },
    setCalls: [],
    peer: "Torvin",
  };
  ui = null;
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("C2 (#257) the chat panel", () => {
  it("is not built at all in a game with no chat — solo shows no panel", () => {
    mountChat(false);
    expect(root().querySelector("#iso-chat")).toBeNull();
    expect(root().querySelector("#iso-chat-body")).toBeNull();
    expect(root().querySelector("#iso-chat-input")).toBeNull();
    // …and the door the game calls is a no-op, not a crash: game.ts pushes
    // every line it logs through `chatLine`, solo included.
    expect(() => ui!.chatLine({ role: "peer", who: "Bo", colour: "#fff", text: "hi" })).not.toThrow();
  });

  it("opens collapsed, names the other seat, and the bar is the whole toggle", () => {
    mountChat();
    expect(dock()).toBeTruthy();
    expect(isOpen()).toBe(false);
    expect(bodyEl()!.classList.contains("hidden")).toBe(true);
    expect(headEl().getAttribute("aria-expanded")).toBe("false");
    expect(root().querySelector("#iso-chat-peer")!.textContent).toBe("· Torvin");

    headEl().click();
    expect(isOpen()).toBe(true);
    expect(bodyEl()!.classList.contains("hidden")).toBe(false);
    expect(headEl().getAttribute("aria-expanded")).toBe("true");
    // Typing is what an open panel is for, so the composer takes the focus —
    // and with it every WASD/Q/R the player types next (see the keys test).
    expect(document.activeElement).toBe(inputEl());

    headEl().click();
    expect(isOpen()).toBe(false);
    expect(bodyEl()!.classList.contains("hidden")).toBe(true);
  });

  it("names an empty seat instead of guessing a player", () => {
    game.peer = null;
    mountChat();
    const peer = root().querySelector("#iso-chat-peer")!;
    expect(peer.textContent).toBe("· nobody yet");
    expect(peer.classList.contains("empty")).toBe(true);
  });

  it("renders every line as TEXT — a name and a message cannot become markup", () => {
    mountChat();
    const evilName = `<img src=x onerror="window.__pwned = 1">`;
    const evilText = `nice <b>route</b> <script>window.__pwned = 1</script> & "quotes"`;
    ui!.chatLine({ role: "peer", who: evilName, colour: "#ff7a5a", text: evilText });

    const log = logEl();
    // Nothing the line contained became an element…
    expect(log.querySelector("img")).toBeNull();
    expect(log.querySelector("script")).toBeNull();
    expect(log.querySelector(".chat-text b")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    // …it is all there as characters, name and message alike.
    expect(log.querySelector(".chat-who")!.textContent).toBe(evilName);
    expect(log.querySelector(".chat-text")!.textContent).toBe(evilText);
    expect(log.querySelector(".chat-text")!.children.length).toBe(0);
    // …and even the serialised HTML is escaped, which is what says the
    // renderer never built a tag out of it in the first place.
    expect(log.innerHTML).toContain("&lt;script&gt;");
    expect(log.innerHTML).not.toContain("<script>");
  });

  it("colours the speaker and says which seat a line came from", () => {
    mountChat();
    ui!.chatLine({ role: "you", who: "You", colour: "#5aa8ff", text: "gg" });
    ui!.chatLine({ role: "peer", who: "Torvin", colour: "#ff7a5a", text: "GG" });
    ui!.chatLine({ role: "system", who: "", colour: "", text: "Torvin left the room." });

    const rows = [...logEl().querySelectorAll<HTMLElement>(".chat-row")];
    expect(rows.map((r) => r.dataset.role)).toEqual(["you", "peer", "system"]);
    expect(rows[0].querySelector(".chat-who")!.getAttribute("style")).toContain("rgb(90, 168, 255)");
    expect(rows[1].querySelector(".chat-who")!.getAttribute("style")).toContain("rgb(255, 122, 90)");
    // A system notice is one line of prose: no name, no colour, no markup.
    expect(rows[2].querySelector(".chat-who")).toBeNull();
    expect(rows[2].textContent).toBe("Torvin left the room.");
  });

  it("keeps the last 20 lines and drops the ones before them", () => {
    mountChat();
    for (let i = 1; i <= 25; i++) {
      ui!.chatLine({ role: "peer", who: "Torvin", colour: "#ff7a5a", text: `line ${i}` });
    }
    const rows = [...logEl().querySelectorAll<HTMLElement>(".chat-row")];
    expect(rows).toHaveLength(20);
    expect(rows[0].textContent).toContain("line 6");
    expect(rows[19].textContent).toContain("line 25");
  });

  it("counts unread lines while the panel is shut, and clears them when it opens", () => {
    // The one line that is not news — a peer's, arriving while the panel is
    // down — also gets the quiet tick. `sfx.play` is where "is anything heard"
    // is decided (a muted game, an unarmed context), so the panel only asks.
    const play = vi.spyOn(sfx, "play").mockImplementation(() => {});
    mountChat();
    expect(badgeEl().classList.contains("hidden")).toBe(true);

    ui!.chatLine({ role: "peer", who: "Torvin", colour: "#ff7a5a", text: "hello?" });
    expect(play).toHaveBeenCalledWith("wire", { gain: 0.5 });
    play.mockClear();
    expect(badgeEl().classList.contains("hidden")).toBe(false);
    expect(badgeEl().textContent).toBe("1");
    expect(headEl().getAttribute("aria-label")).toBe("Chat — 1 new message");

    ui!.chatLine({ role: "system", who: "", colour: "", text: "Torvin disconnected — holding their seat for 60s…" });
    expect(badgeEl().textContent).toBe("2");
    // A room notice is news too, so the tick above was the pair of them.
    expect(play).toHaveBeenCalledTimes(1);
    play.mockClear();

    // MY OWN line is not news to me — no count, and no sound either.
    ui!.chatLine({ role: "you", who: "You", colour: "#5aa8ff", text: "still here" });
    expect(badgeEl().textContent).toBe("2");
    expect(play).not.toHaveBeenCalled();

    headEl().click();
    expect(badgeEl().classList.contains("hidden")).toBe(true);
    expect(headEl().getAttribute("aria-label")).toBe("Chat");

    // …and a line that lands while the panel is open does not count up again.
    ui!.chatLine({ role: "peer", who: "Torvin", colour: "#ff7a5a", text: "back" });
    expect(badgeEl().classList.contains("hidden")).toBe(true);
    expect(logEl().querySelectorAll(".chat-row")).toHaveLength(4);
  });

  it("sends what is typed on Enter, and what a preset button says", () => {
    mountChat();
    headEl().click();
    const input = inputEl();
    input.value = "  nice route  ";
    key(input, "Enter");
    expect(game.attempts).toEqual(["  nice route  "]);   // the guard trims it; the panel does not
    expect(input.value).toBe("");                        // …and the box is ready for the next line
    expect(document.activeElement).toBe(input);
    // The line on screen is the one the GAME logged (the guard's own text).
    expect(logEl().querySelectorAll(".chat-row")).toHaveLength(1);
    expect(logEl().querySelector(".chat-row")!.dataset.role).toBe("you");

    // An empty box is nothing to do — no wire, no refusal note.
    key(input, "Enter");
    expect(game.attempts).toHaveLength(1);

    // The presets are buttons, one per shipped phrase, and they say the
    // canonical spelling.
    const presets = [...root().querySelectorAll<HTMLButtonElement>(".chat-preset")];
    expect(presets.map((b) => b.textContent)).toEqual([...CHAT_PRESETS]);
    presets[1].click();
    expect(game.attempts[1]).toBe("Nice route!");
    expect(presets.length).toBe(4);

    // The Send key is the same door as Enter (it is the form's submit).
    input.value = "hello";
    root().querySelector<HTMLButtonElement>("#iso-chat-send")!.click();
    expect(game.attempts[2]).toBe("hello");
  });

  it("says why a line did not go out — and stays quiet about an empty box", () => {
    mountChat();
    headEl().click();
    const note = () => (noteEl().classList.contains("hidden") ? "" : noteEl().textContent);

    game.verdict = { ok: false, reason: "rate" };
    inputEl().value = "one more";
    key(inputEl(), "Enter");
    expect(note()).toContain("Slow down a moment");
    expect(inputEl().value).toBe("one more");            // nothing is lost to a refusal

    game.verdict = { ok: false, reason: "offline" };
    key(inputEl(), "Enter");
    expect(note()).toContain("Nobody in the other seat");

    game.verdict = { ok: false, reason: "preset-only" };
    key(inputEl(), "Enter");
    expect(note()).toContain("Presets only");

    game.verdict = { ok: false, reason: "empty" };
    inputEl().value = "   ";
    key(inputEl(), "Enter");
    expect(note()).toBe("");                             // a stray Enter is not a scolding
    expect(game.attempts).toHaveLength(3);               // …and the blank line never went

    game.verdict = { ok: true };
    inputEl().value = "back in";
    key(inputEl(), "Enter");
    expect(note()).toBe("");
  });

  it("keeps its own keys: Esc closes the panel and nothing typed reaches the game", () => {
    mountChat();
    // The stand-in for game.ts's window-level handler (tools, R, WASD pan).
    const seen: string[] = [];
    const onGameKey = (e: KeyboardEvent) => seen.push(e.key);
    window.addEventListener("keydown", onGameKey);
    try {
      headEl().click();
      const input = inputEl();
      for (const k of ["w", "a", "s", "d", "q", "r", "3"]) key(input, k);
      expect(seen).toEqual([]);

      key(input, "Enter");
      expect(seen).toEqual([]);

      key(input, "Escape");
      expect(isOpen()).toBe(false);
      expect(document.activeElement).not.toBe(input);
      expect(seen).toEqual([]);                          // Esc does not double as "put the tool down"

      // With the panel shut, keys on the map are the game's again — this is a
      // key ON the map (the root), not one that started inside the panel.
      key(root(), "w");
      expect(seen).toEqual(["w"]);

      // …and so is a key pressed with the collapsed BAR still under the focus
      // (a click on the head leaves it there): shutting the conversation hands
      // the keyboard back at once, rather than after a click on the map.
      headEl().click();                                   // open…
      headEl().click();                                   // …and shut again
      key(headEl(), "w");
      expect(seen).toEqual(["w", "w"]);
    } finally {
      window.removeEventListener("keydown", onGameKey);
    }
  });

  it("mirrors both switches, from the panel and from anywhere else", () => {
    mountChat();
    headEl().click();
    const mute = root().querySelector<HTMLButtonElement>("#iso-chat-mute")!;
    const only = root().querySelector<HTMLButtonElement>("#iso-chat-presets-only")!;
    expect(mute.textContent).toBe("Mute opponent");
    expect(mute.getAttribute("aria-pressed")).toBe("false");
    expect(only.getAttribute("aria-pressed")).toBe("false");
    expect(inputEl().disabled).toBe(false);

    mute.click();
    expect(game.setCalls).toEqual([{ muted: true }]);
    expect(game.prefs.muted).toBe(true);
    expect(mute.textContent).toBe("Unmute opponent");
    expect(mute.getAttribute("aria-pressed")).toBe("true");
    expect(mute.classList.contains("on")).toBe(true);

    only.click();
    expect(game.prefs.presetOnly).toBe(true);
    expect(only.classList.contains("on")).toBe(true);
    expect(only.getAttribute("aria-pressed")).toBe("true");
    // Presets-only closes the composer — the four keys are the conversation —
    // and the guard is still the one that would refuse a forged line, because
    // the panel routes every send through the game.
    expect(inputEl().disabled).toBe(true);
    expect(inputEl().placeholder).toContain("Presets only");
    expect(root().querySelectorAll<HTMLButtonElement>(".chat-preset")).toHaveLength(4);

    // A change made elsewhere (`__iso.chat({ muted: false })`, a settings
    // screen, a second match) lands on the next paint without a rebuild.
    mute.click();
    expect(game.prefs.muted).toBe(false);
    game.prefs = { muted: true, presetOnly: false };
    ui!.paint(state());
    expect(mute.textContent).toBe("Unmute opponent");
    expect(mute.getAttribute("aria-pressed")).toBe("true");
    expect(inputEl().disabled).toBe(false);

    // …and the header follows the roster: the name the room sent, live.
    game.peer = "Ada";
    ui!.paint(state());
    expect(root().querySelector("#iso-chat-peer")!.textContent).toBe("· Ada");
    // A paint that changes nothing must not churn the node under the pointer.
    const peer = root().querySelector("#iso-chat-peer");
    ui!.paint(state());
    expect(root().querySelector("#iso-chat-peer")).toBe(peer);
  });
});

// ── the integration half: a SOLO boot has no chat at all ──────────────────
describe("C2 (#257) a solo game boots without a chat panel", () => {
  let gameRoot: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    const ctx = new Proxy({}, {
      get: (_t, prop) => {
        if (prop === "canvas") return null;
        if (prop === "imageSmoothingEnabled") return false;
        return () => undefined;
      },
      set: () => true,
    });
    HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
    (globalThis as Record<string, unknown>).Image = class {
      width = 1024; height = 1024;
      onload: (() => void) | null = null;
      set src(_v: string) { queueMicrotask(() => this.onload?.()); }
    };
    (globalThis as Record<string, unknown>).ResizeObserver =
      class { observe() {} unobserve() {} disconnect() {} };
    (globalThis as Record<string, unknown>).OffscreenCanvas = undefined;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 0) as unknown as number) as never;
    window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as never;
    window.history.replaceState(null, "", "/?seed=1337&loop=old");
    localStorage.removeItem("hexmatch:save");
    localStorage.setItem("hexmatch:rival-skill", "normal");
    localStorage.setItem("hexmatch:tutorial", "never");
    setRng(mulberry32(1337));
    gameRoot = document.createElement("div");
    Object.defineProperty(gameRoot, "clientWidth", { value: 1280, configurable: true });
    Object.defineProperty(gameRoot, "clientHeight", { value: 800, configurable: true });
    document.body.appendChild(gameRoot);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    gameRoot.remove();
  });

  it("has no panel, no composer and an offline debug door", async () => {
    const { startIsoGame } = await import("../../src/iso/game");
    dispose = startIsoGame(gameRoot);
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    const hook = (window as unknown as {
      __iso: { sendChat: (t: string) => { ok: boolean; reason?: string } };
    }).__iso;
    expect(gameRoot.querySelector("#iso-chat")).toBeNull();
    expect(gameRoot.querySelector("#iso-chat-input")).toBeNull();
    expect(hook.sendChat("GG")).toEqual({ ok: false, reason: "offline" });
  });
});
