// ══════════════════════════════════════════════════════════════════════════
// MP-02 — Hexmatch multiplayer protocol (RUN.world).
//
// The shared message union spoken by the host browser, the guest browser and
// the thin validating relay (`src/rooms/HexmatchRoom.ts`). Imported by BOTH
// sides, so it must stay free of browser-only and SDK imports — `transport.ts`
// is the only client module that touches the SDK, and the room keeps its
// `mp-server` import to itself. `Snapshot` is a TYPE-only import: nothing here
// may pull game code into the server bundle at runtime.
//
// Shape: `docs/HexMatch-tickets.md` §4. Rules:
//   - Guests never mutate locally; every guest action is an `IntentMsg`. The
//     host runs it through the same `construction.ts` / `economy.ts` paths as
//     single-player, so rules cannot drift.
//   - The host applies its own actions locally and immediately — no round trip.
//   - `seq` increments per delta. A guest seeing a gap sends `ResyncMsg`; the
//     host replies with a full `SnapshotMsg` (join and resync ONLY — §1.3
//     rules out full snapshots on a timer: 108 KiB vs the 16 KiB frame cap).
// ══════════════════════════════════════════════════════════════════════════
import type { Snapshot } from "../iso/snapshot";
// Type-only, and it must stay that way: `rating.ts` is pure (no SDK, no DOM),
// but protocol.ts is imported by the SERVER bundle too, and a value import from
// a module the room does not need would drag it in for nothing.
// Re-exported so a wire consumer (the room, the session, the lobby) never has
// to import `rating.ts` for the type of a field on a message.
import type { RankWire } from "./rating";
export type { RankWire };
// #186: the match-settings record and its reader. `match-settings.ts` is pure
// (no SDK, no DOM, no game imports) precisely so this file — and therefore the
// room bundle — may import it at runtime rather than by type only.
import { readMatchSettings, type MatchSettings } from "./match-settings";
export type { MatchSettings };
export { readMatchSettings };

/**
 * Protocol version. Bump WITH `SNAPSHOT_VERSION`: a new snapshot shape is a
 * new protocol, and mixed-version rooms must refuse, never desync.
 *
 * v2 (MP-05): the wire gained `snapshot-chunk`. A full state can be ~110 KiB
 * and the frame is capped at 16 KiB (§1.3), so join/resync state crosses as N
 * frames (see `chunkSnapshot`). A v1 peer cannot reassemble them and would sit
 * forever on an empty map, so the welcome must refuse it instead — the version
 * check turns "waits for state that can never arrive" into the reload message.
 * v3 (PP-14b): the delta/snapshot gained `rivalSabotage` (Black-Market
 * sabotage on the guest-seat plant). A v2 peer would drop that state and show
 * a plant the host already froze, so mixed-version rooms must refuse. (L10 /
 * #225 retired the field again — board obstacles belong to a tuning session —
 * but the version numbers only ever have to keep a mixed pair apart, and
 * dropping a field keeps this pair exactly that.)
 * v4 (MP-AUDIT): the delta/snapshot gain market, vehicle, protest, board and
 * winner fields (market parity, vehicle presentation, cross-choice, host
 * departure). A v3 peer would drop those and desync the guest's purse, roads
 * or board, so mixed-version rooms must refuse.
 * v5 (#111–#117): the cross intent gains its typed body (`do:"cross"`), a
 * cleared crossPrompt travels as an explicit null (v4 mirrors swallowed it),
 * and deltas omit UNCHANGED board saves (a v4 guest that counts on boards in
 * every delta would show stale boards between changes), so mixed-version
 * rooms must refuse.
 * v6 (RANK-01): the room holds a RATING BOARD. Four messages are added —
 * `playerRating` (each client publishes its number once per join, with the
 * join token that authorises it), `ratingUpdate` (the room's copy of the
 * board, for the peer who was never told it), `resultClaim` (the host files a
 * finished match) and `result` (the room's verdict, which is the only thing a
 * client is allowed to submit to the ladder). A v5 peer would receive an
 * unknown message type, drop it, and file its own private arithmetic — the two
 * seats would then hold different ratings for the same match, which is exactly
 * the silent divergence the version check exists to stop.
 * v7 (#186): the room carries MATCH SETTINGS — the ★ line, the opening purse
 * and the AI seats a hosted game plays by. `welcome` gains an optional
 * `settings` block, and two messages are added: `settingsClaim` (the host
 * files the rules its lobby is showing) and `settings` (the room's echo, which
 * is what a guest reads them from — live, before the match starts, and again
 * on every later welcome). A v6 peer would drop both, boot on the shipped
 * `VICTORY.target` and `START_PURSE`, and race a different finish line from
 * the seat it is playing against — the quietest possible desync, since both
 * boards would look perfectly healthy right up to the star line.
 * v8 (#164): the room watches PRESENCE. `peerStatus` tells the seat still in
 * the match the instant the other socket drops (with the reconnect window the
 * platform is holding) and the instant it comes back, which is what turns the
 * silent blank-overlay strand into "Opponent disconnected — reconnecting 0:47"
 * and a resumable match; `abandon` is a deliberate departure saying itself out
 * loud, so the room files at once instead of holding the seat for a window
 * that will never refill. A v7 peer would drop both and sit on a world that
 * no longer says why nothing is moving — the exact bug the version check
 * exists to refuse rather than half-run.
 */
export const PROTOCOL_VERSION = 8;

/**
 * Realtime WS frame cap in bytes. Mirrors the SDK's `MAX_BROADCAST_BYTES`
 * (`mp-server`, 16 KiB): a serialized message at or under this always fits
 * the gateway's `maxPayload`. Defined HERE — not imported from `mp-server` —
 * so the client never pulls server code into its bundle. MP-04's delta guard
 * asserts serialized deltas against it (§5).
 */
export const FRAME_CAP_BYTES = 16 * 1024;

/** Player slot: 0 = host (first joiner), 1 = guest. Two-player model (§6). */
export type Slot = 0 | 1;

/** server → everyone, on join */
export interface WelcomeMsg {
  type: "welcome";
  seed: number;
  hostId: string;
  protocolVersion: number;
  roster: { id: string; username: string; slot: Slot }[];
  /**
   * RANK-01 (v6): the room's rating board — every member that has published a
   * rating, as the room holds it. This is the number both seats compute the
   * rated result from, so it must arrive with the greeting rather than be
   * traded peer-to-peer. Optional in shape (a room whose members have not
   * published yet sends an empty list) — missing reads as "nobody has a rating
   * yet", never as a malformed message.
   */
  ratings?: RankWire[];
  /**
   * #186 (v7): the rules this room plays by — ★ line, opening purse, AI seats.
   *
   * The room holds them because the HOST chose them and the room is the only
   * party every seat hears from: a guest learns them here on join (and again on
   * a rejoin, which is the "late join receives the same settings" rule), while
   * a host that changes them mid-lobby is heard through `settings`.
   *
   * Optional in shape — a room nobody has filed settings for sends none, and
   * absent reads as `DEFAULT_MATCH_SETTINGS`, never as a malformed welcome.
   * Present-but-unreadable IS refused: two seats disagreeing about the ★ line
   * is the desync this whole file exists to prevent.
   */
  settings?: MatchSettings;
}

/** host → server → all guests. Full state; join and resync only. */
export interface SnapshotMsg {
  type: "snapshot";
  snap: Snapshot;
}

/**
 * MP-05: the delta's player entry. The opening allowances a guest previews
 * prices from (`freeTrack` / `freeDepots`) were declared HERE first, because
 * the delta was the only wire MP-05 could add to. #137 moved them onto
 * `WirePlayer` itself — the snapshot's player record has always carried them
 * (`wirePlayers()` in game.ts), it was only ever read for the purse, so a guest
 * that joined or resynced a progressed match kept advertising allowances the
 * host had already spent. One record, two wires: the alias below is what that
 * looks like in the types.
 */
export type DeltaPlayer = Snapshot["players"][number];

/**
 * host → server → all guests. Steady state.
 * `tiles` carries changed tile indices only (§5); `harvesters` / `factories` /
 * `players` are small lists and go whole. Only the four track layers need
 * diffing.
 */
export interface DeltaMsg {
  type: "delta";
  t: number;
  seq: number;
  tiles?: { i: number; dirt: number; road: number; owner: number; upgraded: number }[];
  harvesters?: Snapshot["harvesters"];
  factories?: Snapshot["factories"];
  players?: DeltaPlayer[];
  setupPhase?: boolean;
  won?: boolean;
  /** MP-AUDIT: market offers (guest parity) */
  market?: Snapshot["market"];
  /** MP-AUDIT: protest roadblocks */
  protests?: Snapshot["protests"];
  /**
   * L9 (#224): live industry Blockades (id + expiry). Carried on the delta
   * like the protests are — the Black Market is map sabotage only now, so a
   * Blockade is half the shop and the seat it lands on has to SEE it. Not
   * seat-mirrored: industry ids are global and seed-derived.
   */
  blockades?: Snapshot["blockades"];
  /** MP-AUDIT: vehicle presentation (trucks + ambient cars) */
  trucks?: Snapshot["trucks"];
  cars?: Snapshot["cars"];
  /**
   * RAIL-04 (#178): the railway — its layer (omitted when this delta did not
   * move the rail revision), platforms and depots, lines and trains. Absent
   * means "unchanged" on a delta, and "no railway at all" on a full snapshot.
   */
  rail?: Snapshot["rail"];
  /** MP-AUDIT: authoritative boards for both seats (compact gem tuples) */
  boards?: Snapshot["boards"];
  /** MP-AUDIT: cross-bonus choice prompt */
  crossPrompt?: Snapshot["crossPrompt"];
  /** MP-AUDIT: winner identity (host publishes, guest mirrors) */
  winner?: Snapshot["winner"];
  /**
   * MP-05: a one-shot line for the guest ("your action was refused — 2 more
   * Ore"). Rides the next delta, which the relay already forwards; there is no
   * guest→host acknowledgement in §4, and a silent refusal reads as a bug.
   */
  notice?: string;
}

/**
 * MP-05 — a slice of a full `SnapshotMsg` (§1.3 the frame cap, §5 the
 * `snapshot` fallback).
 *
 * A whole snapshot is ~110 KiB of base64 against a 16 KiB frame, and the
 * gateway does not fragment: an oversized frame is dropped (or closes the
 * socket). "Send a full snapshot on join/resync" therefore only works as a
 * CHUNKED transfer:
 *
 *   host: JSON.stringify(snap) → split every `SNAPSHOT_CHUNK_CHARS` → N frames
 *   guest: concat by index → JSON.parse → `validateSnapshot` → apply
 *
 * `seq` is the delta sequence the snapshot REPRESENTS (the last delta the host
 * published before it). The guest resumes from there, so a snapshot and the
 * deltas around it compose: apply snapshot(seq) then deltas seq+1, seq+2…
 * Frames of one transfer share `id`, and a newer `id` supersedes one in
 * flight, so a resync that overtakes a slow join can never mix halves.
 */
export interface SnapshotChunkMsg {
  type: "snapshot-chunk";
  /** Transfer id — monotonic per host, newest wins. */
  id: number;
  /** Delta sequence this snapshot represents; the guest resumes at `seq`. */
  seq: number;
  /** 0-based index of this frame and the transfer's total frame count. */
  i: number;
  n: number;
  /** A slice of `JSON.stringify(snap)`. Reassembly is a plain concat. */
  data: string;
}

/** Characters of snapshot JSON per chunk frame. ~8.1 KiB on the wire: half the
 *  16 KiB cap, which leaves room for the envelope and for a stricter gateway. */
export const SNAPSHOT_CHUNK_CHARS = 8000;

/** Frames a transfer may run to before it is refused as malformed (~1 MiB).
 *  A 110 KiB snapshot is ~15; the bound only stops a hostile/broken flood. */
export const MAX_SNAPSHOT_CHUNKS = 128;

/** guest → server → host only. Guests never mutate locally. */
export interface IntentMsg {
  type: "intent";
  action: "build" | "demolish" | "harvest" | "trade" | "skill" | "market" | "blackMarket" | "cross" | "vehicle";
  payload: unknown;
}

/** guest → server → host. Sent when a guest detects a seq gap. */
export interface ResyncMsg {
  type: "resync";
}

// ── RANK-01 (v6): the room's rating board and the filed result ────────────

/**
 * client → server. A player's rating, published once per join.
 *
 * The one rule the relay enforces here: `id` must be the SENDER's own id.
 * Nothing else about a rating can be checked by a thin relay — the number is
 * the player's own, and a player is allowed to be wrong about themselves (the
 * board is only ever used to compute expectations, never to award anything).
 * What must not be possible is a client writing SOMEBODY ELSE's rating, which
 * is why the id check exists at all.
 *
 * `joinToken` is minted by the client when it joins and is what authorises a
 * later re-publish for the same seat (a re-attach, a reconnect). The room
 * keeps the first token it saw for a player and refuses any later rating that
 * arrives without it, so a third party cannot overwrite a rating mid-room. It
 * is a session nonce, not a secret: it never leaves the room's own members.
 */
export interface PlayerRatingMsg {
  type: "playerRating";
  id: string;
  rating: number;
  matches: number;
  joinToken: string;
}

/**
 * server → everyone. The room's rating board, whole (two entries — cheaper to
 * send whole than to sequence).
 *
 * Needed because a rating published after a client's own welcome would
 * otherwise be visible only to whoever joined later: the host publishes on
 * boot, the guest may already be in the lobby, and the guest must still learn
 * the host's number before the match is filed.
 */
export interface RatingUpdateMsg {
  type: "ratingUpdate";
  ratings: RankWire[];
}

/**
 * host → server. "This match is over, and this is the verdict."
 *
 * Only the host may file a finished match (the relay drops it otherwise) —
 * the host is the seat that runs the simulation and therefore the only one
 * that can say the star line was crossed. A guest claiming a win is either
 * confused or lying; both are ignored.
 *
 * The verdict is NOT a rating and carries no numbers: the room stamps the
 * result with its own clock and its own copy of the board, and both seats
 * compute the rating change from THAT. A forged claim can therefore only ever
 * ask for the wrong verdict, never a wrong number.
 */
export interface ResultClaimMsg {
  type: "resultClaim";
  winnerId: string;
  loserId: string;
  reason: "win" | "forfeit";
  /** Match length in seconds, as the host measured it; 0 when unknown. */
  durationSec: number;
}

/**
 * server → everyone. The room's filed result — the end of a rated match, from
 * the only party that saw both seats.
 *
 * Two producers, one shape:
 *
 *   1. the host's `resultClaim` is relayed after validation, so both seats act
 *      on the same verdict rather than each trusting itself;
 *   2. the ROOM ITSELF files the result when a player leaves mid-match (see
 *      `HexmatchRoom.onPlayerLeave`) — the leaver loses. This is the case that
 *      has to be the room's own: the player who walked away is not going to
 *      send anything, and letting the stayer file it alone would leave the two
 *      seats with different ratings for one match.
 *
 * `ratings` is the board as it stood when the result was filed, so a result is
 * self-contained — a seat that never saw the other's `ratingUpdate` (or saw it
 * late) still computes the same numbers as everyone else.
 */
export interface ResultMsg {
  type: "result";
  winnerId: string;
  loserId: string;
  reason: "win" | "forfeit";
  durationSec?: number;
  ratings: RankWire[];
  /**
   * The seat that emptied, when the result was a forfeit. Lets the survivor's
   * UI name who left even if the roster event and this message race.
   */
  departedId?: string;
  /** Room clock (ms) when the room filed it. Forms the once-only match key. */
  at: number;
}

// ── #186 (v7): the room's match settings ──────────────────────────────────

/**
 * host → server → everyone. The rules the host's lobby is showing.
 *
 * Host-only, and the relay enforces it the way it enforces a snapshot: a guest
 * has no standing to declare what the match plays by, so a `settingsClaim`
 * from any other seat is dropped without an error to probe. The room
 * NORMALISES before it stores (`readMatchSettings`), so what it echoes back is
 * always a whole record — a half-typed purse line or a 900★ stepper cannot
 * become the room's rules.
 *
 * Sent on every change while the lobby is open (the guest reads them
 * read-only and updates live), and once more when the match starts, so a room
 * that never saw a claim still gets one on the way in.
 */
export interface SettingsClaimMsg {
  type: "settingsClaim";
  settings: MatchSettings;
}

/**
 * server → everyone. The room's copy of the rules.
 *
 * The echo, not a delta: it goes to the host too, so a lobby has exactly one
 * source for what it prints — the room's — and a claim the relay refused
 * (a guest's, a malformed one) simply never comes back.
 */
export interface SettingsMsg {
  type: "settings";
  settings: MatchSettings;
}

/** server → one client, on refused join or host loss */
export interface RejectMsg {
  type: "reject";
  reason: string;
}

/**
 * The reject reason the room sends when the HOST seat empties — no host, no
 * truth. It lives with the wire vocabulary because BOTH ends speak it: the
 * room sends it, and the client (#164) compares against it to choose the
 * "opponent left" copy — without the client importing the server module.
 */
export const HOST_LEFT_REASON = "The host left the game.";

/**
 * server → everyone (#164). One seat's presence, as the room's own poll sees it.
 *
 * The platform holds a dropped socket's seat for `reconnectTimeout` before it
 * evicts, and neither the SDK's roster event nor any game message used to say
 * so: the seat still in the match watched a world that simply stopped moving,
 * with no way to tell "opponent is reconnecting" from "opponent is gone". The
 * room polls its members' `connected` flag once a second and speaks the two
 * transitions out loud:
 *
 *   disconnected — the socket dropped; the seat is being held for `graceMs`.
 *                  The match may keep running; the peer should show a countdown.
 *   reconnected  — the same seat is back inside the window (a re-attach, or a
 *                  rejoin by room code). The room re-greets the returner with a
 *                  fresh welcome, so the host answers with full state and the
 *                  match resumes where it stood.
 *
 * An EVICTION is not carried here: it is the platform's own `room:playerLeft`
 * roster event, which the session already hears (`opponentLeft`).
 */
export interface PeerStatusMsg {
  type: "peerStatus";
  playerId: string;
  status: "disconnected" | "reconnected";
  /** For `disconnected`: milliseconds the seat is held before eviction. */
  graceMs?: number;
  /** The room's name for the seat, so a notice can say who even mid-race. */
  username?: string;
}

/**
 * `abandon` — client -> room: "I am leaving this match for good, right now."
 * (#164.) A socket close cannot say that: the room server reads every close
 * as a possible drop and HOLDS the seat for its whole reconnect window, so a
 * player who quits through the door — or answers a rejoin prompt with
 * "Abandon" — leaves the opponent staring at a countdown for a seat that will
 * never refill. The room answers this by filing the sender's loss (a live
 * match only, and only while the result is unfiled) and kicking the seat, so
 * the survivor's `playerLeft` and the verdict arrive in the same instant
 * instead of a minute apart. A client that simply vanishes (reload, crash,
 * closed tab) never sends this — that is what the disconnect grace is for.
 */
export interface AbandonMsg {
  type: "abandon";
}

export type HexProtocol =
  | WelcomeMsg
  | SnapshotMsg
  | SnapshotChunkMsg
  | DeltaMsg
  | IntentMsg
  | ResyncMsg
  | PlayerRatingMsg
  | RatingUpdateMsg
  | ResultClaimMsg
  | ResultMsg
  | SettingsClaimMsg
  | SettingsMsg
  | PeerStatusMsg
  | AbandonMsg
  | RejectMsg;

/** Every `type` tag in the union — the discriminator RUN switches on. */
export const HEX_MESSAGE_TYPES = [
  "welcome",
  "snapshot",
  "snapshot-chunk",
  "delta",
  "intent",
  "resync",
  "playerRating",
  "ratingUpdate",
  "resultClaim",
  "result",
  "settingsClaim",
  "settings",
  "peerStatus",
  "abandon",
  "reject",
] as const;

export type HexMessageType = HexProtocol["type"];

/**
 * Shown when a welcome arrives from a different protocol version (§11).
 * A mixed-version room must show this — never desync silently.
 */
export const VERSION_MISMATCH_MESSAGE =
  "This game has been updated — reload to play together";

export class ProtocolError extends Error {
  readonly code: "version" | "malformed";
  constructor(code: "version" | "malformed", message: string) {
    super(message);
    this.code = code;
    this.name = "ProtocolError";
  }
}

/**
 * Reject a welcome we cannot safely join. Mirrors `validateSnapshot`'s
 * contract (`Error | null`) so callers handle the two the same way: a
 * `version` mismatch is the common wild case (a guest left on an old tab
 * after a deploy), so it gets the actionable reload message rather than a
 * silent desync.
 */
export function validateWelcome(msg: unknown): ProtocolError | null {
  if (!msg || typeof msg !== "object") {
    return new ProtocolError("malformed", "Welcome is not an object.");
  }
  const o = msg as Partial<WelcomeMsg>;
  if (o.type !== "welcome") {
    return new ProtocolError("malformed", "Message is not a welcome.");
  }
  if (typeof o.protocolVersion !== "number") {
    return new ProtocolError("malformed", "Welcome has no protocol version.");
  }
  if (o.protocolVersion !== PROTOCOL_VERSION) {
    return new ProtocolError("version", VERSION_MISMATCH_MESSAGE);
  }
  if (typeof o.seed !== "number" || !Number.isFinite(o.seed)) {
    return new ProtocolError("malformed", "Welcome has no map seed.");
  }
  if (typeof o.hostId !== "string" || o.hostId.length === 0) {
    return new ProtocolError("malformed", "Welcome has no host.");
  }
  if (!Array.isArray(o.roster)) {
    return new ProtocolError("malformed", "Welcome has no roster.");
  }
  for (const entry of o.roster) {
    const e = entry as { id?: unknown; username?: unknown; slot?: unknown } | null;
    if (
      !e ||
      typeof e !== "object" ||
      typeof e.id !== "string" ||
      typeof e.username !== "string" ||
      (e.slot !== 0 && e.slot !== 1)
    ) {
      return new ProtocolError("malformed", "Welcome roster entry is malformed.");
    }
  }
  // RANK-01 (v6): the rating board. Optional — a room where nobody has
  // published yet sends an empty list, and the field itself may be absent — but
  // a board that is PRESENT and unreadable is refused rather than half-read:
  // one seat computing from a rating the other never sent is precisely the
  // divergence this protocol's version check exists to prevent.
  if (o.ratings !== undefined) {
    if (!Array.isArray(o.ratings)) {
      return new ProtocolError("malformed", "Welcome ratings are not a list.");
    }
    for (const entry of o.ratings) {
      if (!readRankWire(entry)) {
        return new ProtocolError("malformed", "Welcome rating entry is malformed.");
      }
    }
  }
  // #186 (v7): the match settings. Same contract as the rating board — absent
  // is fine (a room nobody has filed rules for plays the defaults), but a
  // block that is PRESENT and unreadable is refused rather than half-read: one
  // seat racing to 10★ against a seat racing to 5★ is a match that looks
  // healthy until somebody wins it, which is exactly the silent divergence
  // this protocol refuses mixed versions over.
  if (o.settings !== undefined && !readMatchSettings(o.settings)) {
    return new ProtocolError("malformed", "Welcome match settings are malformed.");
  }
  return null;
}

/**
 * Shape check for one rating as it travels (RANK-01). Kept here rather than in
 * `rating.ts` because BOTH sides call it while parsing a message — the room
 * while validating a `playerRating`, the client while reading a welcome or a
 * `ratingUpdate` — and `rating.ts` must stay free of wire concerns.
 *
 * Deliberately strict about `rating` being a finite number: this is the one
 * field a peer can get wrong in a way that poisons somebody else's arithmetic
 * (a NaN expectation makes every later match worth nothing).
 */
export function readRankWire(raw: unknown): RankWire | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<RankWire>;
  if (typeof o.id !== "string" || o.id.length === 0) return null;
  if (typeof o.rating !== "number" || !Number.isFinite(o.rating)) return null;
  if (typeof o.matches !== "number" || !Number.isFinite(o.matches) || o.matches < 0) return null;
  const out: RankWire = {
    id: o.id,
    rating: Math.max(0, Math.round(o.rating)),
    matches: Math.floor(o.matches),
  };
  if (typeof o.joinToken === "string" && o.joinToken.length > 0) out.joinToken = o.joinToken;
  return out;
}

/** Read a whole board, dropping malformed entries instead of the message. */
export function readRankBoard(raw: unknown): RankWire[] {
  if (!Array.isArray(raw)) return [];
  const out: RankWire[] = [];
  for (const entry of raw) {
    const wire = readRankWire(entry);
    if (wire) out.push(wire);
  }
  return out;
}

/**
 * Narrow an unknown inbound payload to the union. RUN delivers game messages
 * as one discriminated object — `type` is the whole check here; each handler
 * validates the fields it reads (as `validateWelcome` does for welcomes).
 */
export function isHexProtocol(msg: unknown): msg is HexProtocol {
  if (!msg || typeof msg !== "object") return false;
  const t = (msg as { type?: unknown }).type;
  return (
    t === "welcome" ||
    t === "snapshot" ||
    t === "snapshot-chunk" ||
    t === "delta" ||
    t === "intent" ||
    t === "resync" ||
    t === "playerRating" ||
    t === "ratingUpdate" ||
    t === "resultClaim" ||
    t === "result" ||
    t === "settingsClaim" ||
    t === "settings" ||
    t === "peerStatus" ||
    t === "abandon" ||
    t === "reject"
  );
}

// ── MP-05: chunked full-state transfer ────────────────────────────────────

/**
 * Split one snapshot into frames that each fit the guaranteed 16 KiB cap.
 *
 * `JSON.stringify` output is sliced by UTF-16 code unit; the guest rejoins the
 * exact same string before parsing, so a slice may split anything (an escape,
 * a surrogate pair) without corrupting the result — only the concat matters.
 * The size bound is therefore exact: every frame carries at most
 * `SNAPSHOT_CHUNK_CHARS` data characters plus ~60 bytes of envelope.
 */
export function chunkSnapshot(
  snap: Snapshot,
  seq: number,
  id: number,
  chunkChars: number = SNAPSHOT_CHUNK_CHARS,
): SnapshotChunkMsg[] {
  const json = JSON.stringify(snap);
  const size = Math.max(1, Math.floor(chunkChars));
  const n = Math.max(1, Math.ceil(json.length / size));
  const out: SnapshotChunkMsg[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      type: "snapshot-chunk",
      id: Math.floor(id) >>> 0,
      seq: Math.floor(seq),
      i,
      n,
      data: json.slice(i * size, (i + 1) * size),
    });
  }
  return out;
}

/** A reassembled full state plus the delta sequence it represents. */
export interface AssembledSnapshot {
  snap: Snapshot;
  /**
   * The delta sequence the snapshot represents: the guest resumes at `seq`, so
   * snapshot(seq) then deltas seq+1, seq+2… compose into one continuous state.
   */
  seq: number;
}

/**
 * Guest-side reassembly of a chunked snapshot.
 *
 * Deliberately strict and self-healing: shape-invalid frames are ignored, a new
 * transfer id abandons whatever was half-received (a resync that overtakes a
 * slow join), a duplicate index does not double-append, and a transfer that
 * never completes simply never yields — `pending` tells the caller to keep
 * buffering deltas instead of applying them to a half-applied world. The
 * parse is the only throwing step, and it is caught: a corrupt transfer yields
 * `null` and resets, never a partial snapshot.
 */
export class SnapshotAssembler {
  private id = -1;
  private seq = -1;
  private total = 0;
  private parts: string[] = [];
  private filled = 0;

  /** True while a transfer is in flight (some frames seen, not all). */
  get pending(): boolean {
    return this.total > 0 && this.filled < this.total;
  }

  /** Frames still missing; 0 when idle or complete. */
  get missing(): number {
    return this.total > 0 ? this.total - this.filled : 0;
  }

  reset(): void {
    this.id = -1;
    this.seq = -1;
    this.total = 0;
    this.parts = [];
    this.filled = 0;
  }

  /**
   * Feed one frame; returns the reassembled state on the frame that completes
   * the transfer, `null` otherwise.
   */
  accept(msg: unknown): AssembledSnapshot | null {
    if (!msg || typeof msg !== "object") return null;
    const m = msg as Partial<SnapshotChunkMsg>;
    if (m.type !== "snapshot-chunk") return null;
    const { id, seq, i, n, data } = m;
    if (
      typeof id !== "number" || !Number.isInteger(id) ||
      typeof seq !== "number" || !Number.isInteger(seq) ||
      typeof i !== "number" || !Number.isInteger(i) ||
      typeof n !== "number" || !Number.isInteger(n) ||
      typeof data !== "string"
    ) {
      return null;
    }
    if (n <= 0 || n > MAX_SNAPSHOT_CHUNKS || i < 0 || i >= n) return null;
    if (data.length > SNAPSHOT_CHUNK_CHARS) return null;

    if (id !== this.id || n !== this.total) {
      // A new transfer (or a re-cut of this one) — the old partial is dead.
      this.id = id;
      this.seq = seq;
      this.total = n;
      this.parts = new Array<string>(n).fill("");
      this.filled = 0;
    }
    if (this.parts[i] === "") {
      this.parts[i] = data;
      this.filled++;
    }
    if (this.filled < this.total) return null;

    const json = this.parts.join("");
    const seqAtStart = this.seq;
    this.reset();
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return null;                                   // corrupt transfer: resync heals it
    }
    if (!parsed || typeof parsed !== "object") return null;
    return { snap: parsed as Snapshot, seq: seqAtStart };
  }
}
