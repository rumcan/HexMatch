// ══════════════════════════════════════════════════════════════════════════
// C1 (#255) — multiplayer chat: the message's rules, in one module.
//
// Chat is NOT a game action. It never rides `IntentMsg`, never reaches the
// host's economy path and never touches game state: a `chat` frame goes from
// one client through the room's relay to the other client's `chat` hook, and
// that is all it does. The rules live HERE, in one pure module, because three
// parties have to agree on them:
//
//   - the CLIENT, on send (`ChatGuard.compose`): what may be said at all
//     (presets-only mode), how long it may be (`CHAT_MAX_LEN`), how often
//     (`CHAT_RATE_MAX` per `CHAT_RATE_WINDOW_MS`), and what the word filter
//     masks before the text ever leaves the browser;
//   - the CLIENT, on receive (`ChatGuard.accept`): every one of those limits
//     AGAIN. A message that arrived is already too late to refuse, and the peer
//     may be a different build — or not this build at all — so the receive path
//     can never be a pass-through that trusts the sender's client;
//   - the ROOM (`readChatMsg` + `ChatLimiter` in `HexmatchRoom`), which is the
//     only party that can say WHO spoke: it stamps `from` from its own player
//     record — a client cannot name itself — and holds its own per-sender rate
//     window, so a client that skips its own limiter still cannot flood the
//     relay.
//
// Pure by construction: no DOM, no SDK, no game code, and no imports beyond
// the `ChatMsg` TYPE. `protocol.ts` imports nothing from here (the wire
// vocabulary stays a leaf, and the server bundle grows nothing), while the room
// and the session both import THIS file — which is the point.
// ══════════════════════════════════════════════════════════════════════════
import type { ChatMsg } from "./protocol";

/** Longest chat line, in code points. One line, one frame, 140 characters. */
export const CHAT_MAX_LEN = 140;

/** Longest display name the wire will carry (the room's usernames are shorter). */
export const CHAT_MAX_NAME = 32;

/** Messages a client may SEND per `CHAT_RATE_WINDOW_MS`. The room enforces the same. */
export const CHAT_RATE_MAX = 3;

/** The rate window, in ms — "3 messages / 5 s" in the ticket. */
export const CHAT_RATE_WINDOW_MS = 5_000;

/**
 * Messages a client will ACCEPT per window. Deliberately twice the send budget:
 * a peer that obeys its own limiter can still arrive in a burst — one slow
 * frame, or two sends either side of that peer's window boundary, lands three
 * lines at once — and dropping an honest message is a worse failure than
 * tolerating one extra. A flood is still cut to a trickle.
 */
export const CHAT_RECV_RATE_MAX = CHAT_RATE_MAX * 2;

/**
 * Quick phrases. Always allowed — presets-only mode is exactly these, so a
 * player who turns free text off can still say the four things a match needs.
 * A preset is recognised by its TEXT (case-insensitively), so "gg" is sent as
 * "GG": what crosses the wire is always the canonical phrase.
 */
export const CHAT_PRESETS = ["GG", "Nice route!", "Oops", "Rematch?"] as const;

export type ChatPreset = (typeof CHAT_PRESETS)[number];

/**
 * The shipped word filter. Deliberately short and mild: this is a game between
 * two people who chose to play each other, not a public chat room, and the list
 * is CONFIGURABLE (`ChatGuard.setBlocklist`, `__iso.chat({ blocklist })`) so
 * the owner can tune it without a code change.
 *
 * Matching is word-wise (see `filterChatText`): a match must be the whole word
 * or the START of one ("fuckface" is caught, "coarse" is not), with leet
 * substitutions and stretched letters folded first ("fuuuck", "sh1t").
 */
export const DEFAULT_CHAT_BLOCKLIST: readonly string[] = [
  "asshole", "bastard", "bitch", "bollocks", "bullshit", "cunt", "dick",
  "faggot", "fuck", "motherfucker", "nigger", "prick", "retard", "shit",
  "slut", "twat", "whore",
];

/**
 * Characters a chat line may not carry, whatever else it says: C0/C1 controls
 * (a NUL, a bell, a backspace), the line and paragraph separators (a second
 * "line" the panel's own layout did not make), zero-width joiners and the
 * bidirectional overrides.
 *
 * Stripping beats escaping here: nothing on this wire is ever INTERPRETED, so
 * removing the character is the honest fix — and it leaves no escape for a
 * renderer to unescape by accident.
 */
const STRIPPED = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * Normalise one chat string: compatibility-folded, one line, no control or
 * format characters, no runs of whitespace, trimmed, and capped at
 * `CHAT_MAX_LEN` code points.
 *
 * Truncation (rather than refusal) is deliberate on both paths: the wire frame
 * has a byte cap, a 141-character greeting is not a reason to lose the whole
 * message, and "the longest thing anyone may say" is exactly the contract. The
 * cut is by code point, so it can never split a surrogate pair in half.
 */
export function sanitizeChatText(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "";
  // NFKC first: full-width and other compatibility spellings fold to their
  // plain form before anything is counted or matched (ａｄｍｉｎ → admin).
  let text = raw.normalize("NFKC");
  // Line breaks and tabs are SPACING, not characters to delete: a pasted
  // two-line message must fold into one line rather than run its words
  // together. Ordinary spaces are left to the collapse below.
  text = text.replace(/[\t\n\v\f\r\u0085\u2028\u2029]+/g, " ");
  text = text.replace(STRIPPED, "");
  text = text.replace(/\s+/g, " ").trim();
  const chars = [...text];
  return chars.length > CHAT_MAX_LEN ? chars.slice(0, CHAT_MAX_LEN).join("") : text;
}

/** A sender name as the wire may carry it — same cleaning, its own cap. */
export function sanitizeChatName(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "";
  const text = raw.normalize("NFKC").replace(STRIPPED, "").replace(/\s+/g, " ").trim();
  const chars = [...text];
  return chars.length > CHAT_MAX_NAME ? chars.slice(0, CHAT_MAX_NAME).join("") : text;
}

/**
 * The canonical preset a line IS, or null. Case-insensitive, so "gg", "GG" and
 * "Gg" are one phrase; the value returned is always the shipped spelling.
 *
 * This is what makes presets-only mode safe: the mode's gate is this function,
 * never a client-supplied `preset` field. A forged tag on free text is
 * stripped by `readChatMsg`, so it cannot buy a way around the gate.
 */
export function chatPreset(value: unknown): ChatPreset | null {
  if (typeof value !== "string") return null;
  const needle = sanitizeChatText(value).toLowerCase();
  if (!needle) return null;
  return CHAT_PRESETS.find((p) => p.toLowerCase() === needle) ?? null;
}

/** Fold one word for filtering: lower-case, leet digits, no accents/punctuation. */
function foldWord(word: string): string {
  const leet: Record<string, string> = {
    "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t",
    "@": "a", "$": "s", "!": "i",
  };
  return word
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[0-9@$!]/g, (c) => leet[c] ?? c)
    .replace(/['’]/g, "");
}

/** Every repeated letter squeezed to one — "fuuuck" and "fuck" fold together. */
function squashRepeats(word: string): string {
  return word.replace(/(.)\1+/g, "$1");
}

/**
 * Mask the blocked words in a chat line. The filter's contract is narrow and
 * deliberately so: it never drops a message, never changes its length, and
 * never turns text into markup — a masked word is simply asterisks of the
 * same width, so the line keeps its shape in the log.
 *
 * A word is masked when its folded form IS a blocked word, or STARTS with one
 * of at least four letters ("fuckface" is caught; "coarse" and "grass" are
 * not — a false positive on an innocent word is the failure this rule buys its
 * way out of). The folded-and-squashed form is tried too, so stretched
 * spellings ("fuuucking") do not walk through.
 */
export function filterChatText(
  text: string,
  blocklist: readonly string[] = DEFAULT_CHAT_BLOCKLIST,
): string {
  if (!text || blocklist.length === 0) return text;
  const words = blocklist.map(foldWord).filter((w) => w.length > 0);
  if (words.length === 0) return text;
  const startsWith = new Set(words.filter((w) => w.length >= 4));
  return text.replace(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu, (token) => {
    const folded = foldWord(token);
    if (!folded) return token;
    const squashed = squashRepeats(folded);
    for (const word of words) {
      const hit = folded === word
        || (startsWith.has(word) && folded.startsWith(word))
        || squashed === squashRepeats(word)
        || (startsWith.has(word) && squashed.startsWith(squashRepeats(word)));
      if (hit) return "*".repeat([...token].length);
    }
    return token;
  });
}

/**
 * Escape chat text for any renderer that builds markup. Chat is TEXT: a line
 * that says `<img src=x onerror=…>` must appear on screen as exactly those
 * characters. `textContent` needs none of this — a renderer that assigns
 * `innerHTML` needs all of it.
 */
export function escapeChatHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

// ── the rate window ───────────────────────────────────────────────────────

/**
 * A sliding window: at most `max` permits per `windowMs`, decided by the
 * caller's clock (so tests drive it, and the room's own window rides the
 * server's `Date.now()` rather than a client's idea of when it spoke).
 *
 * Sliding, not fixed: a fixed bucket lets a client spend a whole budget at the
 * end of one window and another at the start of the next — six messages in a
 * few milliseconds, which is exactly the burst the limit exists to stop.
 */
export class ChatLimiter {
  private readonly stamps: number[] = [];

  constructor(
    private readonly max: number = CHAT_RATE_MAX,
    private readonly windowMs: number = CHAT_RATE_WINDOW_MS,
  ) {}

  /** Spend one permit if any is left. `now` is ms on the caller's clock. */
  allow(now: number = Date.now()): boolean {
    this.prune(now);
    if (this.stamps.length >= this.max) return false;
    this.stamps.push(now);
    return true;
  }

  /** ms until a permit frees up; 0 when one is available right now. */
  retryIn(now: number = Date.now()): number {
    this.prune(now);
    if (this.stamps.length < this.max) return 0;
    return Math.max(1, this.stamps[0] + this.windowMs - now);
  }

  reset(): void {
    this.stamps.length = 0;
  }

  private prune(now: number): void {
    const floor = now - this.windowMs;
    while (this.stamps.length > 0 && this.stamps[0] <= floor) this.stamps.shift();
  }
}

// ── the wire reader ───────────────────────────────────────────────────────

/**
 * Read one inbound `chat` frame, or null when it is not one.
 *
 * The test both sides share: `type`, a non-empty `text`, and a non-empty
 * `from`. A message with no sender is not a message — the room always stamps
 * one, so its absence means the frame never came from the room.
 *
 * `preset` is the one field a client could lie with, so it is DERIVED here and
 * never trusted: the tag is set when the TEXT is a shipped preset, and the
 * text is folded to that preset's canonical spelling when it is. Free text
 * tagged `preset: "GG"` comes back untagged; a preset tagged as a different
 * one comes back tagged for what it actually says. That is what keeps
 * presets-only mode a real gate rather than a field a peer can set.
 */
export function readChatMsg(raw: unknown): ChatMsg | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<ChatMsg>;
  if (o.type !== "chat") return null;
  const text = sanitizeChatText(o.text);
  if (!text) return null;
  const from = sanitizeChatName(o.from);
  if (!from) return null;
  const t = typeof o.t === "number" && Number.isFinite(o.t) ? Math.max(0, Math.round(o.t)) : Date.now();
  const preset = chatPreset(text);
  const msg: ChatMsg = { type: "chat", from, text: preset ?? text, t };
  if (preset) msg.preset = preset;
  return msg;
}

// ── the client's chat policy ──────────────────────────────────────────────

/** What the player chose. Persisted locally; it never crosses the wire. */
export interface ChatPrefs {
  /** Mute the opponent: their lines do not reach the hook (mine still leave). */
  muted: boolean;
  /**
   * Free text OFF. It gates BOTH directions, on purpose: a player who turns it
   * off is not exposed to whatever the other seat types either — the four
   * presets remain the whole conversation.
   */
  presetOnly: boolean;
}

export const DEFAULT_CHAT_PREFS: ChatPrefs = { muted: false, presetOnly: false };

/** The one localStorage slot for chat preferences (same pattern as graphics). */
export const CHAT_STORAGE_KEY = "hexmatch:chat";

/** Read the stored preferences. No storage (node, private mode) → defaults. */
export function loadChatPrefs(): ChatPrefs {
  const prefs: ChatPrefs = { ...DEFAULT_CHAT_PREFS };
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(CHAT_STORAGE_KEY) : null;
    if (!raw) return prefs;
    const parsed = JSON.parse(raw) as Partial<ChatPrefs>;
    if (typeof parsed.muted === "boolean") prefs.muted = parsed.muted;
    if (typeof parsed.presetOnly === "boolean") prefs.presetOnly = parsed.presetOnly;
  } catch {
    /* unreadable blob: the defaults stand */
  }
  return prefs;
}

/** Remember the preferences; a storage that refuses is not an error. */
export function saveChatPrefs(prefs: ChatPrefs): void {
  try {
    const storage = typeof localStorage !== "undefined" ? localStorage : null;
    storage?.setItem(CHAT_STORAGE_KEY, JSON.stringify({ muted: prefs.muted, presetOnly: prefs.presetOnly }));
  } catch {
    /* private mode: the choice simply does not survive the reload */
  }
}

/** Why a line did not go out (or did not come in). */
export type ChatSendFailReason =
  /** Nothing left after sanitising (empty, whitespace, control characters only). */
  | "empty"
  /** Free text is off and the line is not one of the presets. */
  | "preset-only"
  /** Over the rate window. */
  | "rate"
  /** No room to speak into (solo, halted, or the opponent's seat is empty). */
  | "offline";

export interface ChatSendOk {
  ok: true;
  /** The exact frame that went on the wire, already cleaned and filtered. */
  msg: ChatMsg;
}
export interface ChatSendFail {
  ok: false;
  reason: ChatSendFailReason;
}
export type ChatSendResult = ChatSendOk | ChatSendFail;

/** Why a received line was dropped. `null` when nothing has been dropped. */
export type ChatDropReason = "malformed" | "rate" | "mute" | "preset-only";

export interface ChatStats {
  sent: number;
  received: number;
  dropped: number;
  lastDrop: ChatDropReason | null;
}

/**
 * One client's chat policy: the preferences, the word filter and both rate
 * windows. The session owns one; the room owns the limiter alone (it has no
 * preferences — it is not a player).
 */
export class ChatGuard {
  private prefsValue: ChatPrefs;
  private blocklist: readonly string[];
  private readonly outbound = new ChatLimiter(CHAT_RATE_MAX, CHAT_RATE_WINDOW_MS);
  private readonly inbound = new ChatLimiter(CHAT_RECV_RATE_MAX, CHAT_RATE_WINDOW_MS);
  private counters: ChatStats = { sent: 0, received: 0, dropped: 0, lastDrop: null };

  constructor(prefs: ChatPrefs = { ...DEFAULT_CHAT_PREFS }, blocklist: readonly string[] = DEFAULT_CHAT_BLOCKLIST) {
    this.prefsValue = { ...prefs };
    this.blocklist = [...blocklist];
  }

  get prefs(): ChatPrefs {
    return { ...this.prefsValue };
  }

  /** Apply a patch; returns the resulting preferences. */
  setPrefs(patch: Partial<ChatPrefs>): ChatPrefs {
    if (typeof patch.muted === "boolean") this.prefsValue.muted = patch.muted;
    if (typeof patch.presetOnly === "boolean") this.prefsValue.presetOnly = patch.presetOnly;
    return { ...this.prefsValue };
  }

  setBlocklist(words: readonly string[]): void {
    this.blocklist = [...words];
  }

  get stats(): ChatStats {
    return { ...this.counters };
  }

  /** Forget both rate windows — a new match starts with a full budget. */
  reset(): void {
    this.outbound.reset();
    this.inbound.reset();
  }

  /**
   * Send side: build the frame that may go out, or say why not.
   *
   * Order matters and is the point: preset detection first (so a preset is
   * measured as itself), then the presets-only gate, THEN the rate window — a
   * refused line must not spend a permit, or a player holding a key down would
   * spend the budget on messages they never sent.
   *
   * The filter is applied before the text leaves the browser, so the wire
   * never carries the word at all. The receiver filters again, because a peer
   * may be running a different list.
   */
  compose(text: string, from: string, now: number = Date.now()): ChatSendResult {
    const clean = sanitizeChatText(text);
    if (!clean) return { ok: false, reason: "empty" };
    const preset = chatPreset(clean);
    // A preset is sent as its canonical spelling, whatever case was typed.
    const body = preset ?? clean;
    if (this.prefsValue.presetOnly && !preset) return { ok: false, reason: "preset-only" };
    if (!this.outbound.allow(now)) return { ok: false, reason: "rate" };
    const msg: ChatMsg = {
      type: "chat",
      from: sanitizeChatName(from) || "You",
      text: filterChatText(body, this.blocklist),
      t: now,
    };
    // The tag is an invariant, not a hint: it is set when the line IS a preset.
    if (preset) msg.preset = preset;
    this.counters = { ...this.counters, sent: this.counters.sent + 1 };
    return { ok: true, msg };
  }

  /**
   * Receive side: everything `compose` does, in the other direction, plus the
   * two things only a reader can decide — mute and the free-text gate.
   *
   * Returns the line to SHOW (already filtered), or null when it is dropped.
   * A drop is silent on purpose: the sender is a peer, not a client that can
   * be told to try again, and a reply saying "refused" would be a way to probe
   * what a peer's settings are.
   */
  accept(raw: unknown, now: number = Date.now()): ChatMsg | null {
    const msg = readChatMsg(raw);
    if (!msg) {
      this.drop("malformed");
      return null;
    }
    // Mute first: a muted peer's flood must not spend the receive budget and
    // then look like a rate problem when the player unmutes.
    if (this.prefsValue.muted) {
      this.drop("mute");
      return null;
    }
    if (!this.inbound.allow(now)) {
      this.drop("rate");
      return null;
    }
    if (this.prefsValue.presetOnly && !msg.preset) {
      this.drop("preset-only");
      return null;
    }
    const shown: ChatMsg = { ...msg, text: filterChatText(msg.text, this.blocklist) };
    this.counters = { ...this.counters, received: this.counters.received + 1 };
    return shown;
  }

  private drop(reason: ChatDropReason): void {
    this.counters = {
      ...this.counters,
      dropped: this.counters.dropped + 1,
      lastDrop: reason,
    };
  }
}
