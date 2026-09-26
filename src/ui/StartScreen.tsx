import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  NO_ROOM_SERVER_MESSAGE,
  createRoom,
  isAccessDenied,
  isMatchmakeWindowExpired,
  isOfflineMockRealtime,
  isValidRoomCode,
  joinRoomByCode,
  listRejoinableRooms,
  normalizeRoomCode,
  promptLogin,
  quickMatch,
  readActiveMatch,
  writeActiveMatch,
  type ActiveMatchMemo,
  type HexRoom,
  type RealtimeRoomSummary,
  type ServerPlayer,
} from "../net/transport";
import { NetSession, type RosterEntry } from "../net/session";
// #164: abandoning a match in progress is a ranked LOSS, and the abandoning
// client is the one party that will never see the room's verdict (it is
// leaving). RankRuntime.fileOwnForfeit is the same local filing the in-game
// "Leave room" door uses — reused here so the two paths cannot drift.
import { RankRuntime } from "../net/rank-runtime";
// RANK-01 (#147): the rating file and the ladder. The store is the only
// ranking module that touches the SDK/player storage, and this screen is where
// a rating is first PUBLISHED to the room — both seats must have their numbers
// on the room's board before the match starts, or the match rates against a
// stranger's default.
import { rankStore } from "../net/rankstore";
import {
  fmtRating,
  rankKeyOf,
  rankLabelOf,
  searchBucket,
  tierProgress,
  type RankState,
  type RankWire,
} from "../net/rating";
import { badgeUrlFor } from "./rank-badge";

import { VERSION_MISMATCH_MESSAGE, validateWelcome, type HexProtocol } from "../net/protocol";
// #186: the hosted room's rules — ★ line, opening purse, AI seats. The lobby is
// where the host picks them, the room is where they are held, and the guest
// reads them back read-only from the same record.
import {
  AI_SKILL_KEYS,
  DEFAULT_MATCH_SETTINGS,
  MAX_AI_SEATS,
  PURSE_PRESETS,
  START_PURSE_KEYS,
  WIN_TARGET_MAX,
  WIN_TARGET_MIN,
  WIN_TARGET_PRESETS,
  clampWinTarget,
  describeMatchSettings,
  isDefaultMatchSettings,
  loadMatchSettings,
  pursePresetOf,
  saveMatchSettings,
  scalePurse,
  winPresetOf,
  type AiSkillKey,
  type MatchSettings,
} from "../net/match-settings";
import { PORTRAITS, type Portrait } from "../iso/config";
// CONTINUE-01 (#191): the menus name the saves they can resume, and starting
// a new game deliberately clears the slot first instead of silently resuming.
import { showConfirm } from "../iso/confirm-sheet";
import {
  describeSave, discardSoloSave, formatSavedAgo, resumableSaves, saveForMode,
  type SoloSaveSummary,
} from "../iso/save-summary";
// STORY-01: the campaign menu — contracts, their locks and their seals.
import { CHAPTERS, EMPLOYER, currentJobTitle, type StoryChapter } from "../story/chapters";
import { CAST, faceOf } from "../story/cast";
import { loadStoryProgress, pinnedChapter, type StoryProgress } from "../story/progress";
import { STORY_MODE_ENABLED } from "../story/flag";
// PROG-1 (#475): the scenario list — four tuned maps, unlocked by winning.
import {
  SCENARIOS, SCENARIO_SAVE_PREFIX, describeScenarioBest, effectiveUnlocked,
  formatBestTime, loadScenarioProgress, pinnedScenario, scenarioUnlockHint,
  type ScenarioDef, type ScenarioProgress,
} from "../story/scenarios";
import { RIVAL_SKILLS } from "../iso/skill";

/** RANK-01: the ladder panel's data, as `rankStore().loadLadder()` returns it. */
type LadderView = {
  entries: { profileId: string; username: string; rating: number; rank: number }[];
  mine: { rank: number; rating: number } | null;
  total: number;
} | null;

export type StartChoice =
  | { mode: "ai"; portrait: Portrait; conquest?: boolean }
  | { mode: "story"; chapter: string; portrait: Portrait }
  | { mode: "story-intro"; portrait: Portrait }
  | { mode: "scenario"; scenario: string; portrait: Portrait }
  | {
      mode: "host" | "guest";
      seed: number;
      room: HexRoom;
      net: NetSession;
      portrait: Portrait;
      /**
       * RANK-01: this room's matches are RATED. True for quick match only —
       * a hosted room and a shared code are games between friends, and #147
       * settled that the ladder is fed by the one queue that pairs strangers
       * by rating. #186 tightens it further: a match the host customised is
       * never rated, so `App.tsx` also asks `isDefaultMatchSettings`.
       */
      ranked?: boolean;
      /**
       * #186: the rules this room plays by. The host hands over the copy its
       * lobby is showing (it is the authority); a guest hands over the room's
       * echo. Absent reads as the shipped defaults in `startIsoGame`.
       */
      settings?: MatchSettings;
    };

/**
 * `join` is the CODE FIELD; `joined` is the guest lobby. They used to be one
 * state told apart by `!room`, which broke the moment a room outlived its
 * screen: Leave / Back / Cancel returned to `choose` without clearing `room`,
 * so the next "Join with a code" fell straight through to the lobby branch and
 * showed a (dead) room code instead of an input. Each state now means exactly
 * one screen, and every exit goes through `releaseRoom()`.
 */
type ScreenState =
  | "choose"
  | "ladder"
  | "story"
  | "scenarios"
  | "host"
  | "join"
  | "joined"
  | "matchmaking"
  | "rejoin"
  | "error";

/**
 * RANK-01 (#147): the rank windows a SIMILAR RANK search widens through.
 *
 * Why a ladder at all: `matchmakeRoom` takes flat equality criteria — the pool
 * has no "within N points" operator — so a window is a bucket index
 * (`searchBucket`) and a wider window is a DIFFERENT bucket. The search runs
 * one attempt per rung, on its own budget, and the last rung asks for nothing
 * in particular: a player is never left waiting on a window too narrow to
 * contain anybody.
 *
 * The ladder is walked ONCE. After the last rung the search keeps going at Any
 * rank — it never times out (#146) — because a window closing means widen and
 * look again, never "no rival found". `span: 0` is that last, never-narrower
 * rung.
 */
export const RANK_SEARCH_STEPS: readonly { span: number; budgetMs: number }[] = [
  { span: 75, budgetMs: 6_000 },     // same neighbourhood, tightest pair
  { span: 200, budgetMs: 8_000 },    // a tier or so apart
  { span: 400, budgetMs: 8_000 },    // a couple of tiers
  { span: 0, budgetMs: 8_000 },      // any rank — the escape hatch, repeated
];

/** How the player wants strangers paired (RANK-01, #147). */
type RankSearch = "any" | "similar";

/**
 * How long a lobby waits for the room's welcome before giving up. The welcome
 * carries the seed and the seed is what lets the game mount, so a missed one is
 * a dead end with a permanently disabled Play button — this turns it into a
 * recoverable error instead. Typed room messages are NOT replayed to a
 * subscriber that registers late, so the race is real even though it is rare.
 */
const WELCOME_TIMEOUT_MS = 10_000;

/**
 * RANK-01: a badge and a number, in one component, because the same chip is
 * printed on the mode screen (your own rating), in every lobby seat (yours and
 * the opponent's) and in the ladder list. `rating: null` means the room has not
 * carried this player's number yet — which the lobby says out loud rather than
 * hiding, since a rated match against an unknown opponent is worth less.
 */
interface RankChipModel {
  key: string;
  label: string;
  rating: number | null;
  provisional: boolean;
}

function chipFor(state: RankState): RankChipModel {
  return {
    key: rankKeyOf(state),
    label: rankLabelOf(state),
    rating: state.rating,
    provisional: state.matches < 10,
  };
}

function chipForWire(wire: RankWire | null): RankChipModel {
  if (!wire) return { key: "unranked", label: "Unrated", rating: null, provisional: false };
  const state: RankState = {
    rating: wire.rating, matches: wire.matches, wins: 0, losses: 0, season: "s1",
  };
  return { ...chipFor(state), provisional: wire.matches < 10 };
}

function RankChip({ model, label }: { model: RankChipModel; label?: string }) {
  const title = model.rating === null
    ? "No rating published to this room yet"
    : `${model.label} · ${fmtRating(model.rating)}${model.provisional ? " · placement matches" : ""}`;
  return (
    <span className="rank-chip" data-tier={model.key} title={title}>
      <img className="rank-badge" src={badgeUrlFor(model.key)} alt="" aria-hidden="true" />
      <span className="rank-chip-text">
        {label ? <em className="rank-chip-who">{label}</em> : null}
        <b>{model.label}</b>
        <small>{model.rating === null ? "no rating yet" : fmtRating(model.rating)}</small>
      </span>
    </span>
  );
}
 
/**
 * Pause between matchmake requests, so a server that rejects a request
 * instantly (a pool that keeps expiring, a flapping socket) cannot turn the
 * endless search into a hot reconnect loop. After a FULL window of waiting
 * (the normal path) one extra second is invisible.
 */
const MATCHMAKE_RETRY_DELAY_MS = 1_000;

interface StartScreenProps {
  onStart: (choice: StartChoice) => void;
  /** STORY-01: the main menu's Back door, when the screen was reached from it. */
  onBack?: () => void;
  /** STORY-01: reopening on the campaign list (the ledger's third door). */
  /** PROG-1 (#475): reopening on the scenario list (a scenario ledger's door). */
  initial?: "choose" | "story" | "scenarios";
}

/** The deliberately low-friction entry point: AI is always available without auth. */
export default function StartScreen({ onStart, onBack, initial = "choose" }: StartScreenProps) {
  const [state, setState] = useState<ScreenState>(initial);
  const [room, setRoom] = useState<HexRoom | null>(null);
  const [seed, setSeed] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  /** PP-14b: the player's tycoon portrait — Vex or You (Torvin is the rival). */
  const [portrait, setPortrait] = useState<Portrait>("vex");
  /** STORY-01: the campaign record, re-read each time the menu opens so a
   *  finished contract seals itself without a reload. */
  const [progress, setProgress] = useState<StoryProgress>(() => loadStoryProgress());
  /** PROG-1 (#475): the scenario record, re-read the same way. */
  const [scenProgress, setScenProgress] = useState<ScenarioProgress>(() => loadScenarioProgress());
  /** Contract cards whose full description the player has opened. */
  const [openBriefs, setOpenBriefs] = useState<ReadonlySet<string>>(() => new Set());
  const [players, setPlayers] = useState<readonly ServerPlayer[]>([]);
  /**
   * The welcome's roster — the one authoritative seat list in the lobby.
   * `room.players` is the SDK's live roster, but a joiner only hears about
   * players who arrive AFTER it (the gateway's `room:joined` carries no player
   * list), so a guest used to sit in front of one nameless seat and never see
   * the host at all. The welcome names every seat — id, username, slot — and
   * `room.players` fills in whoever joins later.
   */
  const [welcomeRoster, setWelcomeRoster] = useState<readonly RosterEntry[]>([]);
  const [net, setNet] = useState<NetSession | null>(null);
  /** RANK-01: this player's own rating file, and the room's board of everyone's. */
  const [rank, setRank] = useState<RankState | null>(null);
  const [board, setBoard] = useState<readonly RankWire[]>([]);
  const [ladder, setLadder] = useState<LadderView | null | "loading">("loading");
  /** RANK-01: this lobby came out of the quick-match queue, so its matches rate. */
  const [rankedRoom, setRankedRoom] = useState(false);
  /**
   * #186: the rules the HOST is offering. Seeded from this browser's last-used
   * settings (a host who ran a Marathon last night gets a Marathon tonight),
   * and filed with the room on every change so the guest reads the same record.
   */
  const [settings, setSettings] = useState<MatchSettings>(() => loadMatchSettings());
  /**
   * #186: the rules the ROOM holds — what a guest plays by, and what the host's
   * own panel confirms. Kept apart from `settings` on purpose: the room's echo
   * is the only copy a guest is allowed to read, and showing the host the
   * room's answer (rather than its own keystroke) is what makes a refused claim
   * visible instead of silent.
   */
  const [roomSettings, setRoomSettings] = useState<MatchSettings>({ ...DEFAULT_MATCH_SETTINGS, startPurse: { ...DEFAULT_MATCH_SETTINGS.startPurse } });
  /** RANK-01: Any rank (the default — fastest) or Similar rank (widening). */
  const [rankSearch, setRankSearch] = useState<RankSearch>("any");
  /** The rung a similar-rank search is currently on, for the waiting screen. */
  const [searchRung, setSearchRung] = useState(0);
  const rankRef = useRef<RankState | null>(null);
  /** #186: the current settings for the room's greeting handler, whose closure
   *  is built once per room and must not file a stale copy. */
  const settingsRef = useRef<MatchSettings>(settings);
  settingsRef.current = settings;
  /** Guards the realtime calls: a double-click must not mint two rooms. */
  const [busy, setBusy] = useState(false);
  /** Seconds since the current search began, shown live on the searching
   *  screen — with no timeout, "how long has it been" is the only feedback. */
  const [searchSeconds, setSearchSeconds] = useState(0);
  const matchRequest = useRef(0);
  /**
   * CONTINUE-01 (#191): the destructive "start a NEW game over an existing
   * save" ask. The chapter-card restart and the Play-vs-AI restart both walk
   * through the same painted plate (#121: never a native confirm in a frame).
   */
  const [pendingNew, setPendingNew] = useState<{
    title: string;
    body: string;
    confirmLabel: string;
    act: () => void;
  } | null>(null);
  /** #164: one-shot bypass for the Auto Matchmaking rejoin guard, set by
   *  "Abandon" — the just-kicked seat may still be settling out of the
   *  platform's roster, and the player was already asked once. */
  const rejoinGuardBypass = useRef(false);
  /**
   * #164: the match this player can walk back into — the room summary the
   * platform still rosters them in (a kick holds the seat for the room's
   * `reconnectTimeout`), plus the memo saying whether it was RANKED. Set on
   * mount (the "you were disconnected" offer) and by the Auto Matchmaking
   * guard (the "you have a match in progress" warn-first).
   */
  const [rejoinable, setRejoinable] = useState<{
    summary: RealtimeRoomSummary;
    memo: ActiveMatchMemo | null;
  } | null>(null);
  /** What the rejoin screen's Abandon/Dismiss returns to. */
  const [rejoinNext, setRejoinNext] = useState<"choose" | "matchmaking">("choose");

  /**
   * #164: ask the platform for a match this player was dropped from. The
   * memo is matched by room code — a stale one (a different device, an old
   * build) must not dress a casual room up as ranked. Resolves null when
   * there is nothing to rejoin, which is also the answer whenever the
   * platform cannot list rooms at all.
   */
  const findRejoinable = useCallback(async () => {
    const rooms = await listRejoinableRooms();
    if (rooms.length === 0) return null;
    const memo = await readActiveMatch();
    // The match this device remembers comes first; any other live seat is
    // still worth offering (a return from a different device is a return).
    const summary = rooms.find((r) => memo?.roomCode === r.roomCode) ?? rooms[0];
    return { summary, memo: memo?.roomCode === summary.roomCode ? memo : null };
  }, []);

  // #164: the return offer. A player who was kicked lands back at this screen
  // with no memory of the match; the platform still holds their seat, so the
  // first thing they see is the choice to walk back into it. Only offered
  // from the neutral ground ("choose") — never over a flow already running.
  useEffect(() => {
    if (initial !== "choose") return;
    let live = true;
    void findRejoinable().then((found) => {
      if (!live || !found) return;
      setRejoinable(found);
      setRejoinNext("choose");
      setState((s) => (s === "choose" ? "rejoin" : s));
    });
    return () => { live = false; };
  }, [findRejoinable, initial]);

  // RANK-01: the rating file is read once per mount. It is deliberately not
  // awaited by anything: a room can be created while the read is in flight,
  // and `publishRating` is idempotent, so the number arrives a moment later
  // rather than holding up a match.
  useEffect(() => {
    let live = true;
    void rankStore().loadState().then((state) => {
      if (!live) return;
      rankRef.current = state;
      setRank(state);
      setNet((session) => {
        if (session) session.publishRating(state);      // a room that is already open
        return session;
      });
    }).catch(() => { /* no storage: the match simply rates from the default */ });
    return () => { live = false; };
  }, []);

  /** RANK-01: the ladder panel's contents, re-read each time it opens. */
  const loadLadder = useCallback(() => {
    setLadder("loading");
    void rankStore().loadLadder(20)
      .then((view) => setLadder(view))
      .catch(() => setLadder(null));
  }, []);

  /**
   * Drop the room and everything derived from it — the SDK socket, the
   * session, the seed, the roster, the busy flag. ANY exit from a lobby goes
   * through here; that is the whole fix for the join screen. The typed room
   * code deliberately survives: it is not room state, and keeping it means a
   * failed join can be corrected instead of retyped.
   */
  const releaseRoom = useCallback(() => {
    room?.leave();
    setRoom(null);
    setNet(null);
    setSeed(null);
    setPlayers([]);
    setWelcomeRoster([]);
    setBusy(false);
    setError("");
  }, [room]);

  const failMessage = useCallback((message: string) => {
    releaseRoom();
    setError(message);
    setState("error");
  }, [releaseRoom]);

  const fail = useCallback((err: unknown) => {
    failMessage(isAccessDenied(err)
      ? "Sign in to play with friends — or play against the AI now."
      : err instanceof Error ? err.message : "Could not connect to the game.");
  }, [failMessage]);

  // A realtime operation may open the platform login sheet. If the user
  // dismisses it, the fallback keeps the AI path one click away.
  const withLogin = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (err) {
      if (!isAccessDenied(err)) throw err;
      const result = await promptLogin();
      if (!result.success) throw err;
      return operation();
    }
  }, []);

  const awaitWelcome = useCallback((nextRoom: HexRoom, role: "host" | "guest", ranked = false) => {
    setRankedRoom(ranked);
    setRoom(nextRoom);
    setPlayers(nextRoom.players);
    const onRoomChanged = () => setPlayers([...nextRoom.players]);
    /** A seat that emptied leaves the list even though the welcome named it. */
    const onSeatEmptied = (playerId: string) => {
      setWelcomeRoster((prev) => prev.filter((entry) => entry.id !== playerId));
      onRoomChanged();
    };
    const session = new NetSession({ room: nextRoom, role });
    setNet(session);
    const onGreeting = (message: HexProtocol) => {
      if (message.type === "welcome") {
        // §11: a mixed-version room must be refused with the reload message,
        // never entered. Validating here (as well as in the session) keeps the
        // player out of a game that could only desync.
        const err = validateWelcome(message);
        if (err) {
          failMessage(err.code === "version" ? VERSION_MISMATCH_MESSAGE : err.message);
          return;
        }
        // Prime the session before the game mounts. Room events can arrive
        // while the lobby is still visible; NetSession retains the
        // authoritative roster and role so attach() can immediately
        // request/render state.
        session.receive(message);
        // #164: welcome.hostId is the authority on who simulates. A re-attached
        // seat can be the ORIGINAL HOST (the platform held their seat; they did
        // not re-create the room), and awaitWelcome only guessed "guest" for the
        // rejoin. Correct the lobby from the room's own answer so the Play
        // button hands the game the right mode — a host publishes state, a
        // guest requests it, and guessing wrong would leave the returner
        // waiting on a full state nobody sends.
        setState(message.hostId === nextRoom.playerId ? "host" : "joined");
        // RANK-01: publish this player's rating now that a room exists to hold
        // it, and mirror the room's board for the lobby.
        if (rankRef.current) session.publishRating(rankRef.current);
        // #186: a host files its lobby's rules as soon as the room exists to
        // hold them, so a guest who joins a moment later is welcomed with the
        // ★ line and purse already on the greeting. A default-rules host files
        // nothing (`publishSettings` says no), and the room's empty hand reads
        // as the defaults — the shipped game needs no wire at all.
        if (session.isHost) session.publishSettings(settingsRef.current);
        setBoard([...session.ratings]);
        setRoomSettings(session.settings);
        setSeed(message.seed);
        setWelcomeRoster(message.roster);
        return;
      }
      // The host left while we were still in the lobby (MP-03 broadcasts a
      // reject). Without this the guest is offered a Play button that leads
      // into a world nobody is simulating.
      if (message.type === "reject") {
        failMessage(message.reason);
        return;
      }
      // #186: the room's rules echo. Fed to the session (which keeps the room's
      // copy) and then read back, so the guest's read-only panel updates live
      // while the host is still choosing — a guest never guesses at the rules.
      if (message.type === "settings" || message.type === "ratingUpdate") session.receive(message);
      // RANK-01: any other traffic may carry the opponent's rating (a board
      // update lands as its own message). Cheap, and it keeps the lobby chips
      // live rather than frozen at welcome time.
      setBoard([...session.ratings]);
      setRoomSettings(session.settings);
    };
    // MP-03 sends the welcome BOTH ways (broadcast to members, sendTo to the
    // newcomer), so listen on both channels or the first joiner never learns
    // it is the host. The SDK may also have delivered it before this component
    // subscribed — the timeout below is the safety net for that race.
    nextRoom.on({
      onMessage: onGreeting,
      onPrivateMessage: onGreeting,
      onPlayerJoined: onRoomChanged,
      onPlayerLeft: onSeatEmptied,
    });
    setState(role === "host" ? "host" : "joined");
  }, [failMessage]);

  const beginRoom = useCallback(async (kind: "host" | "guest") => {
    if (busy) return;
    // No room server (a built/previewed page): the SDK would hand back a mock
    // room with a plausible code and then never introduce itself. Say so now.
    if (isOfflineMockRealtime()) {
      failMessage(NO_ROOM_SERVER_MESSAGE);
      return;
    }
    if (kind === "guest" && !isValidRoomCode(code)) {
      setError("Enter the six-character code your host is showing.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const nextRoom = await withLogin(() => kind === "host" ? createRoom() : joinRoomByCode(code));
      // RANK-01: hosting and joining by code are UNRANKED by decision (#147):
      // a code is how you play a friend, and a ladder match is a stranger
      // paired by the queue.
      awaitWelcome(nextRoom, kind === "host" ? "host" : "guest", false);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }, [awaitWelcome, busy, code, fail, failMessage, withLogin]);

  /**
   * RANK-01 (#147) + #146: Auto Matchmaking, with an optional SIMILAR RANK
   * window — and a search that never times out.
   *
   * Any rank sends the room type's own criteria and stays there. Similar rank
   * walks the ladder above — the narrowest window first, then wider ones, then
   * Any — because a rated queue that can strand a player is worse than a
   * slightly lopsided match. The window is a bucket index (`searchBucket`);
   * widening the span changes the bucket, which is the only kind of "wider"
   * the pool understands.
   *
   * ONE `quickMatch` is one bounded window (the rung's own budget; the SDK
   * sends `matchmaking:cancel` and rejects when it closes), so a closed window
   * just re-issues at the next rung, and after the last rung at Any rank
   * forever. Cancel bumps the token, which is what actually ends the search.
   */
  const beginMatch = useCallback(async (mode: RankSearch = rankSearch, restart = false) => {
    // `restart`: the waiting screen's rank picker re-opens a search that is
    // already running, so the busy flag it holds must not refuse it.
    if (busy && !restart) return;
    if (isOfflineMockRealtime()) {
      failMessage(NO_ROOM_SERVER_MESSAGE);
      return;
    }
    // #164: warn before queueing. A player still rostered in a live match who
    // silently re-queues is the exact stranding the report describes: the
    // queue pairs them elsewhere, the platform evicts them from the old room,
    // and the opponent's match dies with nobody told why. Ask first — rejoin
    // it, or abandon it (which counts as a loss) and THEN search.
    const bypass = rejoinGuardBypass.current;
    rejoinGuardBypass.current = false;
    setBusy(true);
    const found = bypass ? null : await findRejoinable();
    if (found) {
      setBusy(false);
      setRejoinable(found);
      setRejoinNext("matchmaking");
      setState("rejoin");
      return;
    }
    setError("");
    setState("matchmaking");
    const request = ++matchRequest.current;
    // Similar rank starts tight; Any rank starts (and stays) at the last rung.
    let rung = mode === "similar" ? 0 : RANK_SEARCH_STEPS.length - 1;
    try {
      while (request === matchRequest.current) {
        const clamped = Math.min(rung, RANK_SEARCH_STEPS.length - 1);
        const step = RANK_SEARCH_STEPS[clamped];
        setSearchRung(clamped);
        rung++;
        let result: HexRoom;
        try {
          result = await withLogin(() => quickMatch({
            matchmakeTimeoutMs: step.budgetMs,
            rankBucket: searchBucket(rankRef.current?.rating ?? 1000, step.span),
          }));
        } catch (err) {
          if (request !== matchRequest.current) return; // cancelled mid-search
          if (!isMatchmakeWindowExpired(err)) throw err; // a real failure
          // Window closed (or the pool dropped us): breathe once, then either
          // widen to the next rung or — at the last rung — ask again as-is.
          await new Promise((resolve) => {
            window.setTimeout(resolve, MATCHMAKE_RETRY_DELAY_MS);
          });
          continue;
        }
        if (request !== matchRequest.current) {
          // Cancelled while the pairing was in flight: this room must not
          // pull the player out of the menu, and its socket must not linger.
          try {
            result.leave();
          } catch { /* the socket is already going away */ }
          return;
        }
        // A matchmaker can return either an existing room or a newly-created
        // one. isCreator is the SDK's authoritative host hint until welcome
        // arrives. RANK-01: the queue is the ladder — whoever it pairs is rated.
        awaitWelcome(result, result.isCreator ? "host" : "guest", true);
        return;
      }
    } catch (err) {
      if (request === matchRequest.current) fail(err);
    } finally {
      if (request === matchRequest.current) setBusy(false);
    }
  }, [awaitWelcome, busy, fail, failMessage, findRejoinable, matchRequest, rankSearch, withLogin]);

  const abandonMatch = useCallback(() => {
    // Bumping the token is the whole cancel: the beginMatch loop checks it
    // after every await and stops. The SDK has no public cancel for a pending
    // matchmake request, so the abandoned one leaves the RUN pool by itself
    // when its window closes (the SDK then sends `matchmaking:cancel` and
    // closes the socket) — its outcome is ignored here either way.
    ++matchRequest.current;
    releaseRoom();
    setState("choose");
  }, [releaseRoom]);

  /**
   * The Any / Similar rank picker lives on the waiting screen, where the
   * choice actually matters. Changing it mid-search starts the search again
   * in the new window: `beginMatch` bumps the token, which retires the old
   * loop (and it leaves any room that lands late), then walks the new ladder
   * from its first rung.
   */
  const changeRankSearch = useCallback((next: RankSearch) => {
    if (next === rankSearch) return;
    setRankSearch(next);
    if (state === "matchmaking") void beginMatch(next, true);
  }, [beginMatch, rankSearch, state]);

  /**
   * #164: walk back into the match the platform is still holding a seat in.
   *
   * The join is the ordinary `joinRoomByCode`: inside the hold window the
   * room server RE-ATTACHES the seat (same player id, same slot), and the
   * room's presence poll re-greets everyone with a fresh welcome — so the
   * lobby here lights up with the seed exactly like a first join, and the
   * game's resync restores the board, purse, buildings and score from the
   * host's authoritative state. After the window the seat is a plain fresh
   * join into the same room, which the room also re-seats (and which cancels
   * its armed forfeit) — until the survivor has walked out, the match is
   * recoverable.
   */
  const rejoinNow = useCallback(async () => {
    if (busy || !rejoinable) return;
    setBusy(true);
    setError("");
    try {
      const nextRoom = await withLogin(() => joinRoomByCode(rejoinable.summary.roomCode));
      // The memo is what remembers the queue: the summary cannot say whether
      // the match was RANKED, and a rejoin that downgraded it would leave the
      // two seats filing different ratings for one match.
      awaitWelcome(nextRoom, "guest", rejoinable.memo?.ranked ?? false);
      setRejoinable(null);
    } catch (err) {
      // The room died while we were asking (the survivor left, the grace
      // expired): there is nothing to rejoin, and the honest screen is the
      // error one with the AI fallback — never a hang.
      setRejoinable(null);
      fail(err);
    } finally {
      setBusy(false);
    }
  }, [awaitWelcome, busy, fail, rejoinable, withLogin]);

  /**
   * #164: abandon the held seat — an explicit loss, on purpose and told so.
   *
   * Two filings, one for each seat, the same split the in-game "Leave room"
   * door uses:
   *
   *   the survivor — the room files the leaver's loss the moment the seat
   *                empties. Re-attaching and leaving right away is what turns
   *                "wait out the whole hold window staring at a countdown"
   *                into an immediate "opponent left" dialog and result.
   *   this player  — the room's verdict can never reach a client that is
   *                leaving, so the rating file takes its own loss locally
   *                (`fileOwnForfeit`: same arithmetic, same board, no ladder
   *                write), exactly as the in-game door does.
   *
   * A room that will not take the join (already disposed) is an abandonment
   * the platform has already processed — nothing to file against a match the
   * room itself has forgotten, and the ladder only ever moves on a result the
   * room witnessed.
   */
  const abandonRejoinable = useCallback(async () => {
    if (busy || !rejoinable) return;
    setBusy(true);
    setError("");
    const { summary, memo } = rejoinable;
    setRejoinable(null);
    try {
      const doomed = await withLogin(() => joinRoomByCode(summary.roomCode));
      const selfId = doomed.playerId;
      // The summary lists the seats' ids; whichever one is not us is the rival.
      const opponentId = summary.players.find((id) => id !== selfId) ?? "";
      if (memo?.ranked && opponentId) {
        // The board here is empty on purpose: this browser was kicked before
        // it could mirror one, and the opponent's cached rating (same file,
        // same browser) is what the Elo needs. The survivor's own gain is
        // computed on THEIR side from the room's verdict, off their live
        // board — the two filings mirror each other without this one
        // pretending to know the match state.
        const runtime = new RankRuntime({
          session: { playerId: selfId, publishRating: () => false, claimResult: () => false },
          store: rankStore(),
        });
        await runtime.start();
        await runtime.fileOwnForfeit(opponentId);
        if (runtime.state) {
          rankRef.current = runtime.state;
          setRank(runtime.state);
        }
      }
      // Tell the room this is a DEPARTURE, not a drop: the `abandon` message
      // makes it file the survivor's win and free the seat at once, so the
      // opponent's "Opponent left" dialog arrives immediately instead of
      // after a full hold window counting down a seat that never refills.
      try { doomed.send({ type: "abandon" }); } catch { /* socket already closing */ }
      try { doomed.leave(); } catch { /* same */ }
    } catch {
      // The room is gone — the abandonment already happened on its own.
    }
    void writeActiveMatch(null);
    setBusy(false);
    // The guard sent us here from a search that never started; abandoning is
    // the answer to "rejoin it, or abandon it?" — so the search runs now.
    if (rejoinNext === "matchmaking") {
      // The bypass keeps the guard from catching our own seat: the kick and
      // the roster bookkeeping behind it are still settling platform-side.
      rejoinGuardBypass.current = true;
      setState("choose");
      void beginMatch();
      return;
    }
    setState("choose");
  }, [beginMatch, busy, rejoinNext, rejoinable, withLogin]);

  const backToChoose = useCallback(() => {
    releaseRoom();
    setState("choose");
  }, [releaseRoom]);

  /** "Join with a code" must never inherit a room from a previous screen. */
  const openJoinScreen = useCallback(() => {
    releaseRoom();
    setState("join");
  }, [releaseRoom]);

  const startNetworkGame = useCallback((mode: "host" | "guest", ranked = false) => {
    if (!room || seed === null || !net) return;
    // #186: the host hands over the rules its lobby is showing (it is the
    // authority, and the room has them too); a guest hands over the room's
    // echo, which is the only copy it is allowed to read.
    //
    // An AI seat is the seat NOBODY took: if a human is sitting there, the
    // machine is out of the match — the lobby already refuses to add one, and
    // clearing it here means a settings block can never put two players on one
    // seat however it was reached.
    const rules = mode === "host"
      ? (net.info?.roster.length ?? 0) >= 2 && settings.aiSeats.length > 0
        ? { ...settings, aiSeats: [] }
        : settings
      : roomSettings;
    // #164: remember the match on the way in, so a player the browser later
    // kicks can be offered the walk back. The memo is a hint only — the
    // rejoin offer is gated on the platform STILL rostering the seat, and
    // the memo is what remembers whether the match was RANKED (the summary
    // cannot say). Written before onStart so the game's first frame is
    // already covered.
    void writeActiveMatch({ roomCode: room.roomCode, ranked, at: Date.now() });
    onStart({ mode, seed, room, net, portrait, ranked, settings: rules });
  }, [net, onStart, portrait, room, roomSettings, seed, settings]);

  // ── #186: the host's match settings ─────────────────────────────────────
  /**
   * Adopt a new set of rules: remember them for the next room, and file them
   * with the room so the guest reads the same record. The filing is fire-and-
   * forget by design — the panel keeps showing the host's choice, and the
   * room's echo (which lands as `roomSettings`) is what confirms it.
   */
  const applySettings = useCallback((next: MatchSettings) => {
    setSettings(next);
    saveMatchSettings(next);
    net?.publishSettings(next);
  }, [net]);

  /** One dial moved. Every edit goes through here so remembering and filing
   *  can never be forgotten by a future control. */
  const patchSettings = useCallback((patch: Partial<MatchSettings>) => {
    setSettings((prev) => {
      const next: MatchSettings = {
        aiSeats: patch.aiSeats ? [...patch.aiSeats] : [...prev.aiSeats],
        winTarget: patch.winTarget ?? prev.winTarget,
        startPurse: patch.startPurse ? { ...patch.startPurse } : { ...prev.startPurse },
      };
      saveMatchSettings(next);
      net?.publishSettings(next);
      return next;
    });
  }, [net]);

  const addAiSeat = useCallback(() => {
    setSettings((prev) => {
      if (prev.aiSeats.length >= MAX_AI_SEATS) return prev;
      const next: MatchSettings = { ...prev, aiSeats: [...prev.aiSeats, "normal" as AiSkillKey] };
      saveMatchSettings(next);
      net?.publishSettings(next);
      return next;
    });
  }, [net]);

  const removeAiSeat = useCallback((index: number) => {
    setSettings((prev) => {
      const next: MatchSettings = { ...prev, aiSeats: prev.aiSeats.filter((_, i) => i !== index) };
      saveMatchSettings(next);
      net?.publishSettings(next);
      return next;
    });
  }, [net]);

  const setAiSkill = useCallback((index: number, key: AiSkillKey) => {
    setSettings((prev) => {
      const next: MatchSettings = {
        ...prev,
        aiSeats: prev.aiSeats.map((seat, i) => (i === index ? key : seat)),
      };
      saveMatchSettings(next);
      net?.publishSettings(next);
      return next;
    });
  }, [net]);

  const resetSettings = useCallback(() => {
    const next: MatchSettings = {
      aiSeats: [],
      winTarget: DEFAULT_MATCH_SETTINGS.winTarget,
      startPurse: { ...DEFAULT_MATCH_SETTINGS.startPurse },
    };
    applySettings(next);
  }, [applySettings]);

  const roster = useMemo(() => {
    if (!room) return [] as readonly ServerPlayer[];
    const byId = new Map<string, ServerPlayer>();
    // The welcome's seats first — it is slot-ordered and it is the only list
    // that names everyone (see `welcomeRoster`).
    for (const entry of welcomeRoster) {
      byId.set(entry.id, { id: entry.id, username: entry.username, avatarUrl: null });
    }
    // Then whoever the live room knows about, filling in the names it has.
    for (const player of players.length ? players : room.players) {
      if (!player.id) continue;
      const known = byId.get(player.id);
      byId.set(player.id, {
        id: player.id,
        // A live room player may carry an empty username (a joiner's own seat
        // arrives unnamed) — never let it erase the welcome's name.
        username: player.username || known?.username || "",
        avatarUrl: player.avatarUrl ?? known?.avatarUrl ?? null,
      });
    }
    return [...byId.values()];
  }, [players, room, welcomeRoster]);

  // The lobby's dead-end guard: no welcome, no seed, no game.
  useEffect(() => {
    if (seed !== null || (state !== "host" && state !== "joined")) return;
    const timer = window.setTimeout(() => {
      // A room server that is reachable but silent (a stale sidecar, a room
      // bundle that failed to load) lands here too, so re-check the mock: the
      // two causes need different advice.
      failMessage(isOfflineMockRealtime()
        ? NO_ROOM_SERVER_MESSAGE
        : "The room never introduced itself. Go back and try again.");
    }, WELCOME_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [failMessage, seed, state]);

  // The searching clock: elapsed time since this search began, reset on every
  // entry into (and exit from) the matchmaking screen.
  useEffect(() => {
    if (state !== "matchmaking") return;
    setSearchSeconds(0);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setSearchSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [state]);

  const searchClock = useMemo(() => {
    const minutes = Math.floor(searchSeconds / 60);
    const seconds = String(searchSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, [searchSeconds]);

  // CONTINUE-01 (#191): the saves these two doors are built from. They are
  // re-read every time the mode screen or campaign list is entered (every
  // return from a match mounts the component afresh anyway), so a Continue
  // ribbon just cleared or just written never lies.
  const sandboxSave = useMemo<SoloSaveSummary | null>(
    () => (state === "choose" ? saveForMode(null) : null),
    [state],
  );
  const storySaves = useMemo<Map<string, SoloSaveSummary>>(() => {
    const map = new Map<string, SoloSaveSummary>();
    if (state === "story") {
      for (const s of resumableSaves()) if (s.chapterId) map.set(s.chapterId, s);
    }
    return map;
  }, [state]);
  // PROG-1 (#475): the scenario slots, keyed by scenario id.
  const scenarioSaves = useMemo<Map<string, SoloSaveSummary>>(() => {
    const map = new Map<string, SoloSaveSummary>();
    if (state === "scenarios") {
      for (const s of resumableSaves()) {
        if (s.chapterId && s.chapterId.startsWith(SCENARIO_SAVE_PREFIX)) {
          map.set(s.chapterId.slice(SCENARIO_SAVE_PREFIX.length), s);
        }
      }
    }
    return map;
  }, [state]);

  // The one destructive-ask plate. It hangs off a body-level host the effect
  // owns, so every screen branch (mode pick, campaign list) gets it without
  // each branch rendering a host. Cancel/backdrop/Escape/destroy all answer
  // false; the clear-and-start action runs only on the confirm button.
  useEffect(() => {
    if (!pendingNew) return;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = showConfirm(host, {
      title: pendingNew.title,
      body: pendingNew.body,
      confirmLabel: pendingNew.confirmLabel,
      danger: true,
    });
    let live = true;
    void view.promise.then((ok) => {
      if (!live) return;
      const act = pendingNew.act;
      setPendingNew(null);
      // Let the plate tear down before the confirming click mounts a whole
      // game over the same document.
      if (ok) queueMicrotask(act);
    });
    return () => { live = false; view.destroy(); host.remove(); };
  }, [pendingNew]);

  /**
   * CONTINUE-01 (#191): Play vs AI starts a NEW match. A fresh save slot boots
   * straight in; an occupied one asks first and is cleared on confirm, which
   * is what stops the old match silently reattaching. The save's own door is
   * the Continue button rendered above this one.
   */
  const beginAiNew = useCallback((conquest = false) => {
    if (sandboxSave) {
      setPendingNew({
        title: "Start a new game vs the AI?",
        body: `Your saved match — ${describeSave(sandboxSave)} — will be cleared. Use Continue above to pick that match back up.`,
        confirmLabel: "Start new game",
        act: () => {
          discardSoloSave(null);
          onStart({ mode: "ai", portrait, conquest });
        },
      });
      return;
    }
    onStart({ mode: "ai", portrait, conquest });
  }, [onStart, portrait, sandboxSave]);

  /** A scenario card resumes when a save exists; this sibling starts the
   *  scenario over, clearing the slot only after the player confirms. */
  const beginScenarioNew = useCallback((scenario: ScenarioDef, save: SoloSaveSummary) => {
    setPendingNew({
      title: `Start "${scenario.name}" over?`,
      body: `Your saved scenario — ${describeSave(save)} — will be cleared. Use Continue on the card to pick it back up.`,
      confirmLabel: "Start over",
      act: () => {
        discardSoloSave(`${SCENARIO_SAVE_PREFIX}${scenario.id}`);
        onStart({ mode: "scenario", scenario: scenario.id, portrait });
      },
    });
  }, [onStart, portrait]);

  /** A contract card resumes when a save exists; this sibling starts the
   *  contract over, clearing the slot only after the player confirms. */
  const beginChapterNew = useCallback((chapter: StoryChapter, save: SoloSaveSummary) => {
    setPendingNew({
      title: `Start "${chapter.name}" over?`,
      body: `Your saved contract — ${describeSave(save)} — will be cleared. Use Continue on the card to pick it back up.`,
      confirmLabel: "Start over",
      act: () => {
        discardSoloSave(chapter.id);
        onStart({ mode: "story", chapter: chapter.id, portrait });
      },
    });
  }, [onStart, portrait]);

  useEffect(() => () => { /* room ownership moves to App after resolution */ }, []);

  if (state === "choose") return (
    <main className="start-screen" aria-label="Hexmatch start screen">
      <div className="start-panel start-modes">
        <section className="start-modes-info" aria-label="Manager and rating">
          <header className="start-modes-head">
            <p className="start-kicker">HEXMatch Industries</p>
            <h1>Back to work, Logistics Manager.</h1>
            <p className="start-subtitle">Your first shift at {EMPLOYER}: move the freight, beat the rival, earn the promotion.</p>
          </header>
          <div className="portrait-picker" role="radiogroup" aria-label="Choose your manager">
            <p className="portrait-label">Your manager</p>
            <div className="portrait-options">
              {PORTRAITS.map((p) => (
                <button key={p} type="button"
                  className={`portrait-opt${portrait === p ? " on" : ""}`}
                  aria-pressed={portrait === p}
                  data-sfx="select"
                  onClick={() => setPortrait(p)}>
                  <span className={`portrait-face portrait-${p}`} aria-hidden="true" />
                  <span className="portrait-name">{p === "vex" ? "Anne Hextall" : "James Hextall"}</span>
                </button>
              ))}
            </div>
          </div>
          {rank ? (
            <div className="rank-block">
              <RankChip model={chipFor(rank)} />
              <p className="rank-block-note">
                {rank.matches === 0
                  ? "Play Auto Matchmaking to place on the ladder."
                  : `${rank.wins}W · ${rank.losses}L · ${
                      tierProgress(rank.rating).next
                        ? `${tierProgress(rank.rating).toNext} rating to ${tierProgress(rank.rating).next!.label}`
                        : "top of the ladder"}`}
              </p>
            </div>
          ) : null}
      </section>
        <nav className="start-actions" aria-label="Game modes">
          <p className="start-actions-label">Solo</p>
          {/* CONTINUE-01 (#191): a resumable sandbox save gets the gold door,
              naming the rival, the score and when it was last saved. It boots
              exactly as a refresh would; Play vs AI beneath it starts new. */}
          {sandboxSave ? (
            <button className="start-primary start-continue" data-sfx="open"
              aria-label={`Continue — ${describeSave(sandboxSave)}`}
              onClick={() => onStart({ mode: "ai", portrait })}>
              Continue<small>{describeSave(sandboxSave)}</small>
            </button>
          ) : null}
          {STORY_MODE_ENABLED ? (
            <button className={sandboxSave ? "" : "start-primary"} data-sfx="open" onClick={() => { setProgress(loadStoryProgress()); setState("story"); }}>Story Mode <small>the Foundry Syndicate campaign</small></button>
          ) : null}
          <button className={sandboxSave || STORY_MODE_ENABLED ? "" : "start-primary"} data-sfx="open" onClick={() => beginAiNew(false)}>Play vs AI <small>{sandboxSave ? "start a new game" : "sandbox · no login"}</small></button>
          {/* 2026-09: play until the rival cannot go on — no ★ line. */}
          <button data-sfx="open" onClick={() => beginAiNew(true)}>Play vs AI — Conquest <small>no ★ line · win when the rival is bankrupt</small></button>
          {/* PROG-1 (#475): four tuned maps beyond the default island. */}
          <button data-sfx="open" onClick={() => { setScenProgress(loadScenarioProgress()); setState("scenarios"); }}>Scenarios <small>four maps · unlock by winning</small></button>
          <p className="start-actions-label">Multiplayer</p>
          <button disabled={busy} onClick={() => void beginMatch()}>Auto Matchmaking <small>ranked · a rated stranger</small></button>
          <div className="start-actions-pair">
            <button disabled={busy} onClick={() => { setState("host"); void beginRoom("host"); }}>Host a game <small>invite a friend · unranked</small></button>
            <button disabled={busy} onClick={openJoinScreen}>Join with a code <small>unranked</small></button>
          </div>
          <button disabled={busy} onClick={() => { loadLadder(); setState("ladder"); }}>The ladder <small>top ratings</small></button>
          {onBack ? <button className="start-back" data-sfx="close" onClick={onBack}>Back to the menu</button> : null}
        </nav>
      </div>
    </main>
  );
  if (state === "story") {
    const pin = pinnedChapter();
    return (
      <main className="start-screen campaign" aria-label="Hexmatch campaign">
        <div className="start-panel story">
          <p className="start-kicker">THE FOUNDRY SYNDICATE · BACK TO WORK</p>
          <h1>Five contracts, one career</h1>
          <p className="start-subtitle">1949. You take the job of Logistics Manager at {EMPLOYER} — a struggling firm, a bookkeeper who keeps it honest, and five tycoons waiting for you to fold. Every contract you win earns a promotion.</p>
          <p className="start-subtitle story-job">Your job: {currentJobTitle(progress.results)}, {EMPLOYER}</p>
          <div className="chapter-list">
            {CHAPTERS.map((chapter) => {
              const open = pin ? pin === chapter.id : chapter.index < progress.unlocked;
              const result = progress.results[chapter.id];
              const rival = CAST[chapter.rival];
              const face = faceOf(chapter.rival, "calm");
              const expanded = openBriefs.has(chapter.id);
              const briefId = `cc-brief-${chapter.id}`;
              // CONTINUE-01 (#191): an open contract with a fresh save is a
              // Continue door — the card itself resumes (the boot reads the
              // slot), and the "Start over" sibling is the only path that
              // clears it. Sealed contracts never hold saves.
              const save = open ? storySaves.get(chapter.id) ?? null : null;
              return (
                // The card is a <button>, so its "More"/"Start over" toggles
                // are siblings (a button cannot hold another button). They
                // also work on a sealed contract, whose card itself is
                // disabled.
                <div key={chapter.id} className="chapter-item">
                <button type="button" data-sfx="open"
                  className={`chapter-card${open ? "" : " locked"}${save ? " has-save" : ""}`}
                  style={{ "--cc": rival.colour } as CSSProperties}
                  disabled={!open}
                  aria-label={`${chapter.name}${save ? ` — continue saved match, ${describeSave(save)}` : ""}${result === "win" ? " — filed, won" : result === "loss" ? " — filed, lost" : ""}${open ? "" : " (sealed)"}`}
                  onClick={() => onStart({ mode: "story", chapter: chapter.id, portrait })}>
                  <span className="cc-face" aria-hidden="true"
                    style={face.pos
                      ? { backgroundImage: `url(${face.url})`, backgroundSize: "200% 200%", backgroundPosition: `${face.pos[0]}% ${face.pos[1]}%` }
                      : { backgroundImage: `url(${face.url})`, backgroundSize: "cover", backgroundPosition: "center 20%" }} />
                  <span className="cc-body">
                    <span className="cc-head">
                      <span className="cc-kicker">{chapter.kicker}</span>
                      {result === "win"
                        ? <span className="cc-seal">Filed · won</span>
                        : result === "loss"
                          ? <span className="cc-seal loss">Filed · lost</span>
                          : open ? null : <span className="cc-lock" aria-hidden="true">🔒</span>}
                    </span>
                    <span className="cc-name">{chapter.name}</span>
                    <span id={briefId} className={`cc-brief${expanded ? "" : " clamped"}`}>{chapter.brief}</span>
                    <span className="cc-meta">as {chapter.jobTitle} · vs {rival.name} · first to {chapter.target}★ · {chapter.skill}</span>
                    {progress.bests?.[chapter.id] ? (
                      <span className="cc-meta">Best: {[
                        progress.bests[chapter.id].bestMargin !== undefined
                          ? `+${progress.bests[chapter.id].bestMargin}★` : null,
                        progress.bests[chapter.id].bestTimeMs !== undefined
                          ? formatBestTime(progress.bests[chapter.id].bestTimeMs!) : null,
                      ].filter((s): s is string => s !== null).join(" · ")}</span>
                    ) : null}
                    {save ? (
                      <span className="cc-continue">
                        <b>▸ Continue</b> · {save.finished ? "match complete · " : ""}
                        {save.youStars}★ vs {save.rivalStars}★ · saved {formatSavedAgo(save.savedAt)}
                      </span>
                    ) : null}
                  </span>
                </button>
                <span className="cc-actions">
                  <button type="button" className="cc-more" data-sfx="tab"
                    aria-expanded={expanded} aria-controls={briefId}
                    onClick={() => setOpenBriefs((prev) => {
                      const next = new Set(prev);
                      if (next.has(chapter.id)) next.delete(chapter.id); else next.add(chapter.id);
                      return next;
                    })}>
                    {expanded ? "Less ▴" : "More ▾"}
                  </button>
                  {save ? (
                    <button type="button" className="cc-restart" data-sfx="click"
                      title="Clear the saved match and start this contract again"
                      onClick={() => beginChapterNew(chapter, save)}>
                      ↻ Start over
                    </button>
                  ) : null}
                </span>
                </div>
              );
            })}
          </div>
          <div className="story-menu-actions">
            <button data-sfx="open" onClick={() => onStart({ mode: "story-intro", portrait })}>Watch the opening reel</button>
            <button onClick={() => setState("choose")}>Modes</button>
            {onBack ? <button data-sfx="close" onClick={onBack}>Back to the menu</button> : null}
          </div>
        </div>
      </main>
    );
  }

  // PROG-1 (#475): the scenario list — the campaign list's shape (locks,
  // seals, bests, Continue, Start over) over the four tuned maps.
  if (state === "scenarios") {
    const pin = pinnedScenario();
    const openCount = effectiveUnlocked(scenProgress, progress);
    return (
      <main className="start-screen campaign" aria-label="Hexmatch scenarios">
        <div className="start-panel story">
          <p className="start-kicker">BEYOND THE ISLAND · SCENARIOS</p>
          <h1>Four maps, each its own race</h1>
          <p className="start-subtitle">Four tuned maps beyond the default island. Win the open one — or any campaign contract — to unlock the next. Each keeps its own best time and best margin.</p>
          <div className="chapter-list">
            {SCENARIOS.map((scenario) => {
              const open = pin ? pin === scenario.id : scenario.index < openCount;
              const best = scenProgress.results[scenario.id] ?? null;
              const bestLine = best ? describeScenarioBest(best) : null;
              const briefKey = `scenario:${scenario.id}`;
              const expanded = openBriefs.has(briefKey);
              const briefId = `sc-brief-${scenario.id}`;
              const save = open ? scenarioSaves.get(scenario.id) ?? null : null;
              const hint = !open ? scenarioUnlockHint(scenario.id) : null;
              return (
                <div key={scenario.id} className="chapter-item">
                <button type="button" data-sfx="open"
                  className={`chapter-card${open ? "" : " locked"}${save ? " has-save" : ""}`}
                  disabled={!open}
                  aria-label={`${scenario.name}${save ? ` — continue saved match, ${describeSave(save)}` : ""}${bestLine ? ` — ${bestLine}` : ""}${open ? "" : " (locked)"}`}
                  onClick={() => onStart({ mode: "scenario", scenario: scenario.id, portrait })}>
                  <span className="cc-body">
                    <span className="cc-head">
                      <span className="cc-kicker">SCENARIO {["I", "II", "III", "IV"][scenario.index]} · {scenario.tagline}</span>
                      {best && best.wins > 0
                        ? <span className="cc-seal">Filed · won</span>
                        : open ? null : <span className="cc-lock" aria-hidden="true">🔒</span>}
                    </span>
                    <span className="cc-name">{scenario.name}</span>
                    <span id={briefId} className={`cc-brief${expanded ? "" : " clamped"}`}>{scenario.brief}</span>
                    <span className="cc-meta">vs {RIVAL_SKILLS[scenario.skill].label} · first to {scenario.winTarget}★</span>
                    {bestLine ? (
                      <span className="cc-meta">{bestLine}</span>
                    ) : null}
                    {hint ? (
                      <span className="cc-meta">{hint}</span>
                    ) : null}
                    {save ? (
                      <span className="cc-continue">
                        <b>▸ Continue</b> · {save.finished ? "match complete · " : ""}
                        {save.youStars}★ vs {save.rivalStars}★ · saved {formatSavedAgo(save.savedAt)}
                      </span>
                    ) : null}
                  </span>
                </button>
                <span className="cc-actions">
                  <button type="button" className="cc-more" data-sfx="tab"
                    aria-expanded={expanded} aria-controls={briefId}
                    onClick={() => setOpenBriefs((prev) => {
                      const next = new Set(prev);
                      if (next.has(briefKey)) next.delete(briefKey); else next.add(briefKey);
                      return next;
                    })}>
                    {expanded ? "Less ▴" : "More ▾"}
                  </button>
                  {save ? (
                    <button type="button" className="cc-restart" data-sfx="click"
                      title="Clear the saved match and start this scenario again"
                      onClick={() => beginScenarioNew(scenario, save)}>
                      ↻ Start over
                    </button>
                  ) : null}
                </span>
                </div>
              );
            })}
          </div>
          <div className="story-menu-actions">
            <button onClick={() => setState("choose")}>Modes</button>
            {onBack ? <button data-sfx="close" onClick={onBack}>Back to the menu</button> : null}
          </div>
        </div>
      </main>
    );
  }

  if (state === "ladder") {
    const mine = rank ? chipFor(rank) : null;
    return (
      <main className="start-screen" aria-label="Hexmatch ladder">
        <div className="start-panel ladder-panel">
          <p className="start-kicker">THE LADDER</p>
          <h1>Top ratings</h1>
          <p className="start-subtitle">Every rated quick match moves one number. The badge is the band it lands in.</p>
          {ladder === "loading" ? (
            <p className="ladder-note">Reading the board…</p>
          ) : ladder === null ? (
            <p className="ladder-note">The ladder is not reachable from this page — it needs a signed-in RUN.world player. Quick match still works; the rating is kept on your own file.</p>
          ) : ladder.entries.length === 0 ? (
            <p className="ladder-note">Nobody has filed a rating yet. Win a quick match and this board has a first name on it.</p>
          ) : (
            <ol className="ladder-list">
              {ladder.entries.map((row) => (
                <li key={row.profileId} data-rank={row.rank}>
                  <span className="ladder-place">{row.rank}</span>
                  <RankChip model={chipForWire({ id: row.profileId, rating: row.rating, matches: 1 })} label={row.username} />
                </li>
              ))}
            </ol>
          )}
          {mine ? (
            <p className="ladder-mine">
              Your card: <RankChip model={mine} />
              {typeof ladder === "object" && ladder?.mine
                ? <small> · rank {ladder.mine.rank} of {ladder.total}</small>
                : null}
            </p>
          ) : null}
          <div className="lobby-actions">
            <button onClick={() => { setState("choose"); loadLadder(); }}>Back</button>
          </div>
        </div>
      </main>
    );
  }

  // #164: a match in progress this player was dropped from. Two ways in — the
  // return offer on mount, and the Auto Matchmaking guard — and one panel for
  // both, because the choice is the same: rejoin it, or abandon it and take
  // the loss. Never a silent re-queue that strands the far seat.
  if (state === "rejoin" && rejoinable) {
    const ranked = rejoinable.memo?.ranked ?? false;
    const dismissLabel = rejoinNext === "matchmaking" ? "Cancel" : "Not now";
    return (
      <main className="start-screen"><div className="start-panel lobby">
        <p className="start-kicker">MATCH IN PROGRESS</p>
        <h1>You have a match in progress</h1>
        <p className="start-subtitle">
          {ranked
            ? "You were dropped from a ranked match, but your seat is still held. Rejoin it, or abandon it — abandoning counts as a loss and moves your rating down."
            : "You were dropped from a match, but your seat is still held. Rejoin it, or abandon it and return to the menu."}
        </p>
        <p className="rejoin-room">Room <b>{rejoinable.summary.roomCode}</b>{ranked ? " · ranked" : ""}</p>
        {error ? <p className="lobby-error">{error}</p> : null}
        <div className="lobby-actions">
          <button disabled={busy} onClick={() => { setRejoinable(null); setState("choose"); }}>{dismissLabel}</button>
          <button className="danger" disabled={busy} onClick={() => void abandonRejoinable()}>
            {busy ? "Working…" : "Abandon"}{ranked ? " (counts as a loss)" : ""}
          </button>
          <button className="start-primary" data-sfx="open" disabled={busy} onClick={() => void rejoinNow()}>
            {busy ? "Working…" : "Rejoin the match"}
          </button>
        </div>
      </div></main>
    );
  }

  if (state === "join") return (
    <main className="start-screen"><div className="start-panel lobby">
      <p className="start-kicker">JOIN A MATCH</p><h1>Enter room code</h1>
      <p className="start-subtitle">Ask the host for the six-character code.</p>
      <input className="code-input" aria-label="Room code" maxLength={6} autoFocus autoComplete="off" spellCheck={false} value={code}
        onChange={(e) => { setCode(normalizeRoomCode(e.target.value)); setError(""); }}
        onKeyDown={(e) => { if (e.key === "Enter" && !busy) void beginRoom("guest"); }} />
      {error ? <p className="lobby-error">{error}</p> : null}
      <div className="lobby-actions"><button disabled={busy} onClick={backToChoose}>Back</button>
        <button className="start-primary" data-sfx="open" disabled={busy || !isValidRoomCode(code)} onClick={() => void beginRoom("guest")}>{busy ? "Joining…" : "Join game"}</button></div>
    </div></main>
  );

  if (state === "matchmaking") {
    const step = RANK_SEARCH_STEPS[searchRung] ?? RANK_SEARCH_STEPS[RANK_SEARCH_STEPS.length - 1];
    const window = rankSearch === "similar" && step.span > 0
      ? `Similar rank — within ${step.span} rating points${searchRung > 0 ? ", widening" : ""}.`
      : "Any rank — a fair match beats a perfect one.";
    return (
      <main className="start-screen"><div className="start-panel lobby matchmaking"><p className="start-kicker">AUTO MATCHMAKING</p><h1>Finding an opponent…</h1>
        <p className="start-subtitle">{window} Searching for {searchClock} — we keep looking until you cancel.</p>
        <p className="portrait-label">Who to play</p>
        <div className="rank-search" role="radiogroup" aria-label="Who Auto Matchmaking pairs you with">
          {([["any", "Any rank", "whoever is waiting"], ["similar", "Similar rank", "widening, never stuck"]] as const)
            .map(([value, label, hint]) => (
              <button key={value} type="button"
                className={`rank-search-opt${rankSearch === value ? " on" : ""}`}
                aria-pressed={rankSearch === value}
                data-sfx="select"
                onClick={() => changeRankSearch(value)}>
                {label}<small>{hint}</small>
              </button>
            ))}
        </div>
        <button className="matchmaking-cancel" onClick={abandonMatch}>Cancel</button></div></main>
    );
  }
  if (state === "error") return (
    <main className="start-screen"><div className="start-panel lobby"><p className="start-kicker">MATCH UNAVAILABLE</p><h1>Could not join</h1><p className="lobby-error">{error}</p><div className="lobby-actions"><button onClick={backToChoose}>Back</button><button className="start-primary" onClick={() => beginAiNew(false)}>Play vs AI</button></div></div></main>
  );

  const hosting = state === "host";
  const connecting = seed === null;
  // #186: the host's own panel edits `settings`; a guest reads the room's echo.
  // Ranked rooms play the shipped rules (#147's ladder is fed by the queue
  // alone, and a customised match is not a ladder match), so the dials are
  // disabled there rather than hidden — a player should see WHY nothing moves.
  const shown = hosting ? settings : roomSettings;
  const locked = rankedRoom;
  const humanSeats = roster.length;
  const aiSeats = shown.aiSeats;
  const canStart = humanSeats >= 2 || aiSeats.length > 0;
  const winKey = winPresetOf(shown.winTarget);
  const purseKey = pursePresetOf(shown.startPurse);
  // RANK-01: the seat rows carry a badge each. The room's board is the source
  // for everyone (including ourselves, echoed back), and the local file is the
  // fallback for our own seat until that echo lands.
  const chipBySeat = (player: ServerPlayer): RankChipModel => {
    const wire = board.find((entry) => entry.id === player.id) ?? null;
    if (wire) return chipForWire(wire);
    if (room && player.id === room.playerId && rank) return chipFor(rank);
    return chipForWire(null);
  };
  // #186: the rules panel. The host edits it; a guest reads the room's copy.
  // One control per rule, presets first and a stepper behind them, and a Reset
  // that is disabled exactly when there is nothing to reset.
  const settingsPanel = (
    <section className={`match-settings${locked ? " locked" : ""}`} aria-label="Game settings">
      <div className="ms-head">
        <h2>{hosting ? "Game settings" : "Match rules"}</h2>
        {hosting ? (
          <button type="button" className="ms-reset" data-sfx="tab"
            disabled={locked || isDefaultMatchSettings(settings)}
            onClick={resetSettings}>Reset to default</button>
        ) : null}
      </div>

      {/* Seats: who is in the match, and which of them is a machine. */}
      <fieldset className="ms-group" disabled={locked || !hosting}>
        <legend>Players</legend>
        <div className="ms-seats">
          <div className="ms-seat">
            <span className="ms-swatch" style={{ background: "#5aa8ff" }} aria-hidden="true" />
            <span className="ms-seat-name">{room && room.playerId ? "You" : "Host"}</span>
            <span className="ms-badge human">Human</span>
          </div>
          {aiSeats.map((seat, index) => (
            <div className="ms-seat" key={`ai-${index}`}>
              <span className="ms-swatch" style={{ background: "#ff7a5a" }} aria-hidden="true" />
              <span className="ms-seat-name">AI opponent</span>
              <span className="ms-badge ai">AI</span>
              {hosting ? (
                <>
                  <select className="ms-skill" aria-label="AI difficulty" data-sfx="tab"
                    value={seat} onChange={(e) => setAiSkill(index, e.target.value as AiSkillKey)}>
                    {AI_SKILL_KEYS.map((key) => (
                      <option key={key} value={key}>{key.charAt(0).toUpperCase()}{key.slice(1)}</option>
                    ))}
                  </select>
                  <button type="button" className="ms-remove" data-sfx="close"
                    aria-label="Remove AI seat" onClick={() => removeAiSeat(index)}>✕</button>
                </>
              ) : null}
            </div>
          ))}
          {humanSeats >= 2 ? (
            <div className="ms-seat">
              <span className="ms-swatch" style={{ background: "#ff7a5a" }} aria-hidden="true" />
              <span className="ms-seat-name">{roster[1]?.username || "Rival"}</span>
              <span className="ms-badge human">Human</span>
            </div>
          ) : null}
        </div>
        {hosting ? (
          <p className="ms-hint">
            {aiSeats.length >= MAX_AI_SEATS
              ? "A match seats two: you and one opponent."
              : humanSeats >= 2
                ? "A human has taken the second seat — remove them from the room to play an AI."
                : "Fill the open seat with a machine and start without waiting."}
          </p>
        ) : null}
        {hosting ? (
          <button type="button" className="ms-add" data-sfx="coin"
            disabled={locked || aiSeats.length >= MAX_AI_SEATS || humanSeats >= 2}
            onClick={addAiSeat}>Add AI opponent</button>
        ) : null}
      </fieldset>

      {/* The ★ line. */}
      <fieldset className="ms-group" disabled={locked || !hosting}>
        <legend>Win points</legend>
        <div className="ms-presets" role="group" aria-label="Win points">
          {WIN_TARGET_PRESETS.map((preset) => (
            <button type="button" key={preset.key} data-sfx="tab"
              className={`ms-preset${winKey === preset.key ? " on" : ""}`}
              aria-pressed={winKey === preset.key}
              onClick={() => hosting && patchSettings({ winTarget: preset.winTarget })}>
              {preset.label}<small>{preset.winTarget}★</small>
            </button>
          ))}
        </div>
        <label className="ms-stepper">Or exactly
          <input type="number" min={WIN_TARGET_MIN} max={WIN_TARGET_MAX} step={1}
            aria-label="Victory points to win" value={shown.winTarget}
            onChange={(e) => hosting && patchSettings({ winTarget: clampWinTarget(Number(e.target.value)) })} />
          ★ to win
        </label>
      </fieldset>

      {/* The opening purse. */}
      <fieldset className="ms-group" disabled={locked || !hosting}>
        <legend>Starting resources</legend>
        <div className="ms-presets" role="group" aria-label="Starting resources">
          {PURSE_PRESETS.map((preset) => (
            <button type="button" key={preset.key} data-sfx="tab"
              className={`ms-preset${purseKey === preset.key ? " on" : ""}`}
              aria-pressed={purseKey === preset.key}
              onClick={() => hosting && patchSettings({ startPurse: scalePurse(preset.scale) })}>
              {preset.label}
            </button>
          ))}
        </div>
        <p className="ms-purse">{START_PURSE_KEYS.map((key) => `${shown.startPurse[key]} ${key}`).join(" · ")} for every seat</p>
      </fieldset>

      <p className="ms-summary">{describeMatchSettings(shown)}</p>
      {locked ? (
        <p className="ms-note">Ranked matches play the standard rules — a customised game never feeds the ladder.</p>
      ) : hosting ? (
        <p className="ms-note">Your rival sees these as you change them. A customised match is unranked.</p>
      ) : (
        <p className="ms-note">The host chooses the rules; they update here live.</p>
      )}
    </section>
  );

  return <main className="start-screen"><div className="start-panel lobby">
    <p className="start-kicker">{hosting ? "HOST GAME" : "MATCH READY"}{rankedRoom ? " · RANKED" : ""}</p><h1>{hosting ? "Invite a rival" : "Room found"}</h1>
    <div className="room-code"><b>{room?.roomCode ?? "——"}</b><button aria-label="Copy room code" onClick={() => room && void navigator.clipboard?.writeText(room.roomCode)}>Copy</button></div>
    <div className="seat-list">{roster.map((player) => <div className="seat filled" key={player.id}><span className="seat-name">{player.username}</span><RankChip model={chipBySeat(player)} /><span className="seat-status">Connected</span></div>)}<div className="seat"><span>{aiSeats.length > 0 && humanSeats < 2 ? "AI opponent" : "Open seat"}</span><span className="seat-status">{canStart ? "Ready" : "Waiting"}</span></div></div>
    {settingsPanel}
    <p className="lobby-note">{connecting
      ? "Connecting to the room…"
      : rankedRoom
        ? "Ranked: the winner's rating rises and the loser's falls. Leaving mid-match counts as a loss."
        : hosting && !canStart ? "Share the code. Start when your rival joins — or fill the seat with an AI."
        : hosting && humanSeats < 2 ? "An AI holds the second seat. Share the code before you start and a human takes it."
        : "Both players are ready."}</p>
    <div className="lobby-actions"><button onClick={backToChoose}>Leave</button><button className="start-primary" data-sfx="open" disabled={connecting || (hosting && !canStart)} onClick={() => startNetworkGame(hosting ? "host" : "guest", rankedRoom)}>{connecting ? "Connecting…" : hosting ? "Start game" : "Play"}</button></div>
  </div></main>;
}
