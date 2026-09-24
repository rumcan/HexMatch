// C1 (#255) — chat: the rules, the guard, and the session's two ends of it.
//
// Chat is the one wire feature that is NOT a game action, so the tests are
// arranged by WHO has to be right about what:
//
//   1. the RULES (`src/net/chat.ts`) — sanitising, the word filter, the
//      presets, the rate window, and the reader both ends share. Pure
//      functions, no session, no room;
//   2. the GUARD — the client's policy on top of them: mute, presets-only,
//      both rate windows, and the counters a probe reads;
//   3. the SESSION over an in-process room pair — that a line actually
//      crosses, that a dropped line never reaches a hook, and that a chat
//      message can never touch the intent path or the world.
//
// The room's own half (identity stamping, the relay's rate window) is pinned
// in `net-room.test.ts`, with the rest of the relay's routing.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CHAT_MAX_LEN,
  CHAT_PRESETS,
  CHAT_RATE_MAX,
  CHAT_RATE_WINDOW_MS,
  CHAT_RECV_RATE_MAX,
  CHAT_STORAGE_KEY,
  ChatGuard,
  ChatLimiter,
  DEFAULT_CHAT_BLOCKLIST,
  chatPreset,
  escapeChatHtml,
  filterChatText,
  loadChatPrefs,
  readChatMsg,
  sanitizeChatName,
  sanitizeChatText,
  saveChatPrefs,
  type ChatPrefs,
} from "../../src/net/chat";
import { NetSession, type NetHooks } from "../../src/net/session";
import { PROTOCOL_VERSION, type ChatMsg, type HexProtocol, type WelcomeMsg } from "../../src/net/protocol";
import type { ConnectionState, HexRoom } from "../../src/net/transport";

// ── an in-process room pair (the same shape `net-session.test.ts` uses) ────

/**
 * The slice of `ServerRoom<HexProtocol>` a session touches. `send` hands the
 * frame to the peer the way the gateway does, JSON-cloned.
 */
class FakeRoom {
  roomCode = "HX9KWR";
  connectionState: ConnectionState = "connected";
  latency = 3;
  isCreator = false;
  peer: FakeRoom | null = null;
  /** Everything this client put on the wire. */
  readonly sent: HexProtocol[] = [];
  private events: Record<string, unknown> = {};

  constructor(readonly playerId: string) {}

  on(events: Record<string, unknown>): void {
    this.events = { ...this.events, ...events };
  }
  send(msg: HexProtocol): void {
    this.sent.push(structuredClone(msg));
    this.peer?.deliver(structuredClone(msg));
  }
  deliver(msg: HexProtocol): void {
    (this.events.onMessage as ((m: HexProtocol) => void) | undefined)?.(msg);
  }
  leave(): void {}
  /** The gateway's roster event, as `net-session.test.ts` fires it. */
  firePlayerLeft(playerId: string): void {
    (this.events.onPlayerLeft as ((id: string) => void) | undefined)?.(playerId);
  }
  frames<T extends HexProtocol["type"]>(type: T): Extract<HexProtocol, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<HexProtocol, { type: T }>[];
  }
}

const asRoom = (r: FakeRoom): HexRoom => r as unknown as HexRoom;

const ROSTER: WelcomeMsg["roster"] = [
  { id: "host-socket", username: "Ada", slot: 0 },
  { id: "guest-socket", username: "Bo", slot: 1 },
];

function welcome(role: "host" | "guest"): WelcomeMsg {
  return {
    type: "welcome",
    seed: 4242,
    hostId: "host-socket",
    protocolVersion: PROTOCOL_VERSION,
    roster: ROSTER,
  };
}

/** A joined pair of sessions: host (Ada) and guest (Bo), both attached. */
function joinedPair(): {
  hostRoom: FakeRoom;
  guestRoom: FakeRoom;
  host: NetSession;
  guest: NetSession;
  hostSeen: ChatMsg[];
  guestSeen: ChatMsg[];
  intents: unknown[];
} {
  const hostRoom = new FakeRoom("host-socket");
  const guestRoom = new FakeRoom("guest-socket");
  hostRoom.peer = guestRoom;
  guestRoom.peer = hostRoom;
  const host = new NetSession({ room: asRoom(hostRoom), role: "host" });
  const guest = new NetSession({ room: asRoom(guestRoom), role: "guest" });
  const hostSeen: ChatMsg[] = [];
  const guestSeen: ChatMsg[] = [];
  const intents: unknown[] = [];
  const hooks: NetHooks = {};
  host.attach({ ...hooks, intent: (msg) => intents.push(msg), chat: (m) => hostSeen.push(m) });
  guest.attach({ ...hooks, chat: (m) => guestSeen.push(m) });
  hostRoom.deliver(welcome("host"));
  guestRoom.deliver(welcome("guest"));
  return { hostRoom, guestRoom, host, guest, hostSeen, guestSeen, intents };
}

/** One message from a peer, shaped exactly as the room relays it. */
function line(over: Partial<ChatMsg> = {}): ChatMsg {
  return { type: "chat", from: "Bo", text: "hello", t: 1_000, ...over };
}

let sessions: ReturnType<typeof joinedPair>[];
beforeEach(() => { sessions = []; });
afterEach(() => {
  for (const s of sessions) { s.host.dispose(); s.guest.dispose(); }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function pair(): ReturnType<typeof joinedPair> {
  const s = joinedPair();
  sessions.push(s);
  return s;
}

/** A localStorage stand-in; the node test env has none of its own. */
function stubStorage(initial: Record<string, string> = {}): Map<string, string> {
  const store = new Map<string, string>(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
  return store;
}



// ══════════════════════════════════════════════════════════════════════════
// 1. the rules
// ══════════════════════════════════════════════════════════════════════════
describe("C1 sanitising", () => {
  it("trims, collapses whitespace and keeps one line", () => {
    expect(sanitizeChatText("  hi   there \n\nfriend\t")).toBe("hi there friend");
    expect(sanitizeChatText("a\r\nb")).toBe("a b");
  });

  it("strips control and format characters instead of escaping them", () => {
    const raw = "a\u0007b\u0000c\u001bd\u200be\u202ef\uFEFFg";
    expect(sanitizeChatText(raw)).toBe("abcdefg");
    // The separators a "second line" would need are gone too.
    expect(sanitizeChatText("one\u2028two")).toBe("one two");
  });

  it("folds compatibility spellings (full-width text is the text)", () => {
    expect(sanitizeChatText("ＧＧ")).toBe("GG");
    expect(readChatMsg({ type: "chat", from: "x", text: "ＧＧ", t: 1 })?.preset).toBe("GG");
  });

  it("caps at CHAT_MAX_LEN and never splits a surrogate pair", () => {
    const long = sanitizeChatText("a".repeat(400));
    expect(long).toHaveLength(CHAT_MAX_LEN);
    // 139 units + one astral code point = 140 code points: kept, whole.
    const astral = sanitizeChatText(`${"a".repeat(CHAT_MAX_LEN - 1)}😀`);
    expect(astral).toBe(`${"a".repeat(CHAT_MAX_LEN - 1)}😀`);
    const cut = sanitizeChatText(`${"a".repeat(CHAT_MAX_LEN)}😀`);
    expect(cut).toHaveLength(CHAT_MAX_LEN);
    expect(cut.includes("😀")).toBe(false);
    expect([...cut]).toHaveLength(CHAT_MAX_LEN);
  });

  it("reads a non-string as nothing at all", () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect(sanitizeChatText(bad)).toBe("");
      expect(sanitizeChatName(bad)).toBe("");
    }
  });

  it("gives a sender name its own, shorter cap", () => {
    expect(sanitizeChatName("  A\u0007da  ")).toBe("Ada");
    expect(sanitizeChatName("n".repeat(80))).toHaveLength(32);
  });
});

describe("C1 presets", () => {
  it("recognises a preset by its text, whatever the case", () => {
    expect(chatPreset("GG")).toBe("GG");
    expect(chatPreset("gg")).toBe("GG");
    expect(chatPreset("  Nice Route! ")).toBe("Nice route!");
    for (const p of CHAT_PRESETS) expect(chatPreset(p)).toBe(p);
  });

  it("does not invent a preset out of free text", () => {
    for (const text of ["", "   ", "good game", "GG!", "niceroute!", "Rematch", 42, null]) {
      expect(chatPreset(text)).toBeNull();
    }
  });
});

describe("C1 the word filter", () => {
  const masked = (s: string) => filterChatText(s, DEFAULT_CHAT_BLOCKLIST);

  it("masks a blocked word and keeps the line's shape", () => {
    expect(masked("what the fuck")).toBe("what the ****");
    expect(masked("Shit happens")).toBe("**** happens");
    // Same width in, same width out: the log's alignment survives.
    expect(masked("fuucking idiot")).toHaveLength("fuucking idiot".length);
  });

  it("sees through case, leet and stretched letters", () => {
    expect(masked("FUCK")).toBe("****");
    expect(masked("sh1t")).toBe("****");
    expect(masked("fuuuuuck")).toBe("********");
    expect(masked("fück")).toBe("****");
  });

  it("catches a blocked word leading a compound, not buried in an innocent one", () => {
    expect(masked("fuckface")).toBe("********");
    expect(masked("bullshit")).toBe("********");
    // The classic false positives a word-wise filter buys its way out of:
    expect(masked("the coarse grass")).toBe("the coarse grass");
    expect(masked("Scunthorpe")).toBe("Scunthorpe");
    expect(masked("a class act")).toBe("a class act");
    expect(masked("assumption")).toBe("assumption");
  });

  it("leaves the presets alone", () => {
    for (const p of CHAT_PRESETS) expect(masked(p)).toBe(p);
  });

  it("is configurable, and an empty list filters nothing", () => {
    expect(filterChatText("hello beetroot", ["beetroot"])).toBe("hello ********");
    expect(filterChatText("what the fuck", [])).toBe("what the fuck");
  });

  it("never turns text into markup and escapes for renderers that need it", () => {
    const attack = `<img src=x onerror="alert(1)">`;
    expect(masked(attack)).toBe(attack);          // the characters are kept…
    expect(escapeChatHtml(attack)).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );                                            // …and a markup renderer must escape them
  });
});

describe("C1 the rate window", () => {
  it("allows CHAT_RATE_MAX in a window and refuses the next", () => {
    const limiter = new ChatLimiter();
    for (let i = 0; i < CHAT_RATE_MAX; i++) expect(limiter.allow(1_000)).toBe(true);
    expect(limiter.allow(1_000)).toBe(false);
    // Still refused a moment before the window's end…
    expect(limiter.allow(1_000 + CHAT_RATE_WINDOW_MS - 1)).toBe(false);
    // …and allowed again when the oldest permit ages out.
    expect(limiter.allow(1_000 + CHAT_RATE_WINDOW_MS + 1)).toBe(true);
  });

  it("slides rather than buckets — a burst across a boundary is still a burst", () => {
    const limiter = new ChatLimiter(3, 5_000);
    expect(limiter.allow(4_900)).toBe(true);
    expect(limiter.allow(4_950)).toBe(true);
    expect(limiter.allow(4_999)).toBe(true);
    // A fixed window would reset here and let three more through at once.
    expect(limiter.allow(5_100)).toBe(false);
    expect(limiter.retryIn(5_100)).toBeGreaterThan(0);
    expect(limiter.retryIn(9_901)).toBe(0);
    limiter.reset();
    expect(limiter.allow(5_100)).toBe(true);
  });
});

describe("C1 readChatMsg — the reader both ends share", () => {
  it("accepts a well-formed line and normalises it", () => {
    expect(readChatMsg({ type: "chat", from: " Bo ", text: "  hi  ", t: 12 })).toEqual({
      type: "chat", from: "Bo", text: "hi", t: 12,
    });
  });

  it("refuses anything that is not a chat message", () => {
    const bad: unknown[] = [
      null, undefined, 7, "chat", [],
      { type: "delta", from: "Bo", text: "hi", t: 1 },
      { type: "chat", from: "Bo", t: 1 },                       // no text
      { type: "chat", from: "Bo", text: "   ", t: 1 },           // nothing to say
      { type: "chat", from: "Bo", text: "\u0007\u200b", t: 1 },  // control only
      { type: "chat", from: "Bo", text: 42, t: 1 },              // text is not a string
      { type: "chat", from: "", text: "hi", t: 1 },              // no sender…
      { type: "chat", text: "hi", t: 1 },                        // …and silence is not a sender
    ];
    for (const msg of bad) expect(readChatMsg(msg), JSON.stringify(msg)).toBeNull();
  });

  it("clips the text and strips the control characters on the way IN", () => {
    const msg = readChatMsg({ type: "chat", from: "Bo", text: `\u0007${"x".repeat(300)}`, t: 1 });
    expect(msg?.text).toHaveLength(CHAT_MAX_LEN);
    expect(msg?.text.startsWith("x")).toBe(true);
  });

  it("derives the preset tag — a forged one is discarded, a wrong one corrected", () => {
    expect(readChatMsg({ type: "chat", from: "Bo", text: "hello", t: 1, preset: "GG" })?.preset)
      .toBeUndefined();
    expect(readChatMsg({ type: "chat", from: "Bo", text: "GG", t: 1, preset: "Rematch?" }))
      .toEqual({ type: "chat", from: "Bo", text: "GG", t: 1, preset: "GG" });
    expect(readChatMsg({ type: "chat", from: "Bo", text: "gg", t: 1 }))
      .toEqual({ type: "chat", from: "Bo", text: "GG", t: 1, preset: "GG" });
  });

  it("never trusts a timestamp it cannot use", () => {
    const before = Date.now();
    for (const t of [Number.NaN, Infinity, "12", null, undefined]) {
      const msg = readChatMsg({ type: "chat", from: "Bo", text: "hi", t });
      expect(Number.isFinite(msg!.t)).toBe(true);
      expect(msg!.t).toBeGreaterThanOrEqual(before);
    }
    expect(readChatMsg({ type: "chat", from: "Bo", text: "hi", t: -5 })?.t).toBe(0);
    expect(readChatMsg({ type: "chat", from: "Bo", text: "hi", t: 12.7 })?.t).toBe(13);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. the guard
// ══════════════════════════════════════════════════════════════════════════
describe("C1 the client's chat policy", () => {
  it("composes a clean frame and filters it before it leaves the browser", () => {
    const guard = new ChatGuard();
    const res = guard.compose("  what the fuck  ", "  Ada ", 5_000);
    expect(res).toEqual({
      ok: true,
      msg: { type: "chat", from: "Ada", text: "what the ****", t: 5_000 },
    });
    expect(guard.stats.sent).toBe(1);
  });

  it("sends a preset as its canonical spelling", () => {
    const guard = new ChatGuard();
    const res = guard.compose("gg", "Ada", 0);
    expect(res.ok && res.msg.text).toBe("GG");
    expect(res.ok && res.msg.preset).toBe("GG");
  });

  it("refuses nothing-to-say, and refusing leaves the budget alone", () => {
    const guard = new ChatGuard();
    for (const text of ["", "   ", "\u0007\u200b", "\u200b"]) {
      expect(guard.compose(text, "Ada", 0)).toEqual({ ok: false, reason: "empty" });
    }
    expect(guard.stats.sent).toBe(0);
    // A refused line must not spend a permit: three real lines still fit.
    for (let i = 0; i < CHAT_RATE_MAX; i++) expect(guard.compose("hi", "Ada", 0).ok).toBe(true);
    expect(guard.compose("hi", "Ada", 0)).toEqual({ ok: false, reason: "rate" });
  });

  it("presets-only lets presets through and refuses free text", () => {
    const guard = new ChatGuard({ muted: false, presetOnly: true });
    expect(guard.compose("hello there", "Ada", 0)).toEqual({ ok: false, reason: "preset-only" });
    expect(guard.compose("Oops", "Ada", 0).ok).toBe(true);
    // The refusal did not spend the preset's permit.
    expect(guard.compose("GG", "Ada", 0).ok).toBe(true);
    expect(guard.compose("Rematch?", "Ada", 0).ok).toBe(true);
  });

  it("accepts a peer's line, filtered, and counts it", () => {
    const guard = new ChatGuard();
    const shown = guard.accept(line({ text: "hi fuuuck" }), 0);
    expect(shown).toEqual({ type: "chat", from: "Bo", text: "hi ******", t: 1_000 });
    expect(guard.stats).toEqual({ sent: 0, received: 1, dropped: 0, lastDrop: null });
  });

  it("drops malformed frames and says why", () => {
    const guard = new ChatGuard();
    for (const bad of [null, 7, {}, { type: "chat", text: "" }]) {
      expect(guard.accept(bad, 0)).toBeNull();
    }
    expect(guard.stats.dropped).toBe(4);
    expect(guard.stats.lastDrop).toBe("malformed");
  });

  it("mute stops the peer's lines before the filter's budget, not after", () => {
    const guard = new ChatGuard({ muted: true, presetOnly: false });
    expect(guard.accept(line(), 0)).toBeNull();
    expect(guard.stats.lastDrop).toBe("mute");
    // A flood while muted must not spend the receive window: unmuting must not
    // look like a rate problem.
    for (let i = 0; i < 20; i++) guard.accept(line({ t: i }), 0);
    guard.setPrefs({ muted: false });
    expect(guard.accept(line(), 1)?.text).toBe("hello");
  });

  it("presets-only gates the inbox too: free text in is dropped, presets get in", () => {
    const guard = new ChatGuard({ muted: false, presetOnly: true });
    expect(guard.accept(line({ text: "how are you" }), 0)).toBeNull();
    expect(guard.stats.lastDrop).toBe("preset-only");
    expect(guard.accept(line({ text: "GG", preset: "GG" }), 0)?.text).toBe("GG");
  });

  it("cuts an incoming flood to CHAT_RECV_RATE_MAX per window", () => {
    const guard = new ChatGuard();
    let shown = 0;
    for (let i = 0; i < 30; i++) if (guard.accept(line({ t: i }), 1_000)) shown++;
    expect(shown).toBe(CHAT_RECV_RATE_MAX);
    expect(guard.stats.dropped).toBe(30 - CHAT_RECV_RATE_MAX);
    expect(guard.stats.lastDrop).toBe("rate");
    // The window is a window: once it slides, a line gets in again.
    expect(guard.accept(line(), 1_000 + CHAT_RATE_WINDOW_MS + 1)?.text).toBe("hello");
  });

  it("patches preferences, and keeps both budgets independent", () => {
    const guard = new ChatGuard();
    expect(guard.setPrefs({ muted: true })).toEqual({ muted: true, presetOnly: false });
    expect(guard.prefs).toEqual({ muted: true, presetOnly: false });
    guard.setPrefs({ presetOnly: true });
    expect(guard.prefs).toEqual({ muted: true, presetOnly: true });
    // My own sends are not gagged by a mute (mute is about the opponent), and
    // they are not the same window as the inbox.
    for (let i = 0; i < CHAT_RATE_MAX; i++) expect(guard.compose("GG", "Ada", 0).ok).toBe(true);
    expect(guard.compose("GG", "Ada", 0)).toEqual({ ok: false, reason: "rate" });
    expect(guard.accept(line({ text: "GG", preset: "GG" }), 0)).toBeNull(); // still muted
    guard.reset();
    expect(guard.compose("GG", "Ada", 0).ok).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. the session — a real exchange over an in-process room pair
// ══════════════════════════════════════════════════════════════════════════
describe("C1 the session's two ends", () => {
  it("carries a line from one seat to the other's hook", () => {
    const { guest, guestRoom, hostSeen } = pair();
    const res = guest.sendChat("  Nice route!  ");
    expect(res.ok).toBe(true);
    // One frame, and it is a chat frame — not an intent.
    const frames = guestRoom.frames("chat");
    expect(frames).toHaveLength(1);
    expect(guestRoom.frames("intent")).toHaveLength(0);
    expect(frames[0]).toMatchObject({ type: "chat", from: "Bo", text: "Nice route!" });
    // The other seat's hook has it, already normalised.
    expect(hostSeen).toHaveLength(1);
    expect(hostSeen[0]).toMatchObject({ from: "Bo", text: "Nice route!", preset: "Nice route!" });
  });

  it("names the sender from the room's roster, not from the caller", () => {
    const { host, guestSeen } = pair();
    expect(host.sendChat("hi").ok).toBe(true);
    expect(guestSeen[0].from).toBe("Ada");
  });

  it("returns why a line did not go out, and puts nothing on the wire", () => {
    const { host, hostRoom } = pair();
    hostRoom.sent.length = 0;
    expect(host.sendChat("   ")).toEqual({ ok: false, reason: "empty" });
    expect(hostRoom.frames("chat")).toHaveLength(0);
    for (let i = 0; i < CHAT_RATE_MAX; i++) expect(host.sendChat("hi").ok).toBe(true);
    expect(host.sendChat("hi")).toEqual({ ok: false, reason: "rate" });
    expect(hostRoom.frames("chat")).toHaveLength(CHAT_RATE_MAX);
  });

  it("is offline once this session has stopped, and once the seat has emptied", () => {
    const { host, hostRoom } = pair();
    expect(host.sendChat("still here").ok).toBe(true);
    // A parked session (the opponent's seat emptied) has nobody to speak to.
    hostRoom.firePlayerLeft("guest-socket");
    expect(host.sendChat("anyone there?")).toEqual({ ok: false, reason: "offline" });

    const second = pair();
    expect(second.host.sendChat("hi").ok).toBe(true);
    second.host.halt("bye");
    expect(second.host.sendChat("hello?")).toEqual({ ok: false, reason: "offline" });

    // A PARKED session is not a dead one: when the seat fills again (#164's
    // rejoin path) chat resumes with the match — unlike a halt, which is final.
    const third = pair();
    third.hostRoom.firePlayerLeft("guest-socket");
    expect(third.host.sendChat("gone").ok).toBe(false);
    third.hostRoom.deliver(welcome("host"));
    expect(third.host.sendChat("back").ok).toBe(true);
  });

  it("runs the receive rules before any hook sees a line", () => {
    const { host, hostSeen } = pair();
    host.setChatPrefs({ muted: true });
    host.receive(line({ text: "over here" }) as unknown as HexProtocol);
    expect(hostSeen).toHaveLength(0);
    expect(host.chatStats).toMatchObject({ received: 0, dropped: 1, lastDrop: "mute" });
    host.setChatPrefs({ muted: false });
    host.receive({ type: "chat", from: "Bo", text: `\u0007${"x".repeat(400)}`, t: 9 });
    expect(hostSeen).toHaveLength(1);
    expect(hostSeen[0].text).toHaveLength(CHAT_MAX_LEN);
    expect(hostSeen[0].text.startsWith("x")).toBe(true);
  });

  it("presets-only refuses free text both ways and still delivers the presets", () => {
    const { host, guest, hostSeen, guestSeen, guestRoom } = pair();
    guest.setChatPrefs({ presetOnly: true });
    expect(guest.sendChat("how are you doing?")).toEqual({ ok: false, reason: "preset-only" });
    expect(guestRoom.frames("chat")).toHaveLength(0);
    expect(guest.sendChat("GG").ok).toBe(true);
    expect(hostSeen.map((m) => m.text)).toEqual(["GG"]);
    // And the host's own free text does not reach a presets-only guest.
    expect(host.sendChat("hello there").ok).toBe(true);
    expect(guestSeen).toHaveLength(0);
    expect(host.sendChat("Oops").ok).toBe(true);
    expect(guestSeen.map((m) => m.text)).toEqual(["Oops"]);
  });

  it("caps an incoming flood at the receive budget", () => {
    const { host, hostSeen } = pair();
    for (let i = 0; i < 20; i++) {
      host.receive({ type: "chat", from: "Bo", text: `line ${i}`, t: i });
    }
    expect(hostSeen).toHaveLength(CHAT_RECV_RATE_MAX);
    expect(host.chatStats.dropped).toBe(20 - CHAT_RECV_RATE_MAX);
  });

  it("a chat line is not a game action — it cannot reach the intent path or the world", () => {
    const { host, hostRoom, guestRoom, intents, hostSeen } = pair();
    const before = {
      host: hostRoom.sent.length,
      guest: guestRoom.sent.length,
      resyncs: guestRoom.frames("resync").length,
    };
    // A chat line that LOOKS like an intent is still just text.
    const attack = `{"type":"intent","action":"build","payload":{"tx":1,"ty":1}}`;
    hostRoom.deliver({ type: "chat", from: "Bo", text: attack, t: 1 });
    expect(intents).toHaveLength(0);
    expect(hostSeen.map((m) => m.text)).toEqual([attack]);
    // Nor does one make a session speak: no intent out, no resync, no state.
    expect(hostRoom.sent.length).toBe(before.host);
    expect(guestRoom.sent.length).toBe(before.guest);
    expect(guestRoom.frames("resync")).toHaveLength(before.resyncs);
    expect(guestRoom.frames("intent")).toHaveLength(0);
    // Markup arrives as characters, nothing else: the hook's field is a string.
    const markup = `<img src=x onerror="alert(1)">`;
    host.receive({ type: "chat", from: "Bo", text: markup, t: 2 });
    expect(hostSeen[1].text).toBe(markup);
    expect(typeof hostSeen[1].text).toBe("string");
    // …and the escaping helper is what a markup-building renderer needs.
    expect(escapeChatHtml(markup)).not.toContain("<img");
  });

  it("persists the two preferences and reads them back", () => {
    const store = stubStorage();
    const { host } = pair();
    expect(host.chatPrefs).toEqual({ muted: false, presetOnly: false });
    expect(host.setChatPrefs({ muted: true })).toEqual({ muted: true, presetOnly: false });
    expect(host.chatPrefs.muted).toBe(true);
    expect(host.setChatPrefs({ presetOnly: true })).toEqual({ muted: true, presetOnly: true });
    expect(store.get(CHAT_STORAGE_KEY)).toBe('{"muted":true,"presetOnly":true}');
    // A later session on the same origin starts from what was stored.
    const again = new NetSession({ room: asRoom(new FakeRoom("third")), role: "host" });
    expect(again.chatPrefs).toEqual({ muted: true, presetOnly: true });
    again.dispose();
  });

  it("takes a custom blocklist from the game (the configuration seam)", () => {
    const { host, hostSeen } = pair();
    host.setChatBlocklist(["beetroot"]);
    host.receive({ type: "chat", from: "Bo", text: "I hate beetroot and fuck", t: 1 });
    expect(hostSeen[0].text).toBe("I hate ******** and fuck");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. the frame on the wire, and the preferences on disk
// ══════════════════════════════════════════════════════════════════════════
describe("C1 the chat frame on the wire", () => {
  it("JSON round-trips", () => {
    const msg: ChatMsg = { type: "chat", from: "Ada", text: "GG", t: 1_760_000_000_000, preset: "GG" };
    expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
  });

  it("writes exactly the two booleans, under one key", () => {
    const store = stubStorage();
    saveChatPrefs({ muted: true, presetOnly: false });
    expect(store.get(CHAT_STORAGE_KEY)).toBe('{"muted":true,"presetOnly":false}');
    expect(loadChatPrefs()).toEqual({ muted: true, presetOnly: false });
  });

  it("reads a stored blob field by field, and ignores junk in it", () => {
    stubStorage({ [CHAT_STORAGE_KEY]: JSON.stringify({ muted: "yes", presetOnly: true }) });
    const prefs: ChatPrefs = loadChatPrefs();
    expect(prefs).toEqual({ muted: false, presetOnly: true });
  });

  it("leaves the defaults standing when the blob is unreadable", () => {
    stubStorage({ [CHAT_STORAGE_KEY]: "{not json" });
    expect(loadChatPrefs()).toEqual({ muted: false, presetOnly: false });
  });

  it("survives a storage that refuses to write (private mode)", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: () => {},
    });
    expect(() => saveChatPrefs({ muted: true, presetOnly: true })).not.toThrow();
  });
});
