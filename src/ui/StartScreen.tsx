import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  NO_ROOM_SERVER_MESSAGE,
  createRoom,
  isAccessDenied,
  isMatchmakeWindowExpired,
  isOfflineMockRealtime,
  isValidRoomCode,
  joinRoomByCode,
  normalizeRoomCode,
  promptLogin,
  quickMatch,
  type HexRoom,
  type ServerPlayer,
} from "../net/transport";

import { NetSession, type RosterEntry } from "../net/session";

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
import { PORTRAITS, type Portrait } from "../iso/config";
// STORY-01: the campaign menu — contracts, their locks and their seals.
import { CHAPTERS, EMPLOYER, currentJobTitle } from "../story/chapters";
import { CAST, faceOf } from "../story/cast";
import { loadStoryProgress, pinnedChapter, type StoryProgress } from "../story/progress";

/** RANK-01: the ladder panel's data, as `rankStore().loadLadder()` returns it. */
type LadderView = {
  entries: { profileId: string; username: string; rating: number; rank: number }[];
  mine: { rank: number; rating: number } | null;
  total: number;
} | null;

export type StartChoice =
  | { mode: "ai"; portrait: Portrait }
  | { mode: "story"; chapter: string; portrait: Portrait }
  | { mode: "story-intro"; portrait: Portrait }
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
       * by rating.
       */
      ranked?: boolean;
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
  | "host"
  | "join"
  | "joined"
  | "matchmaking"
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
  initial?: "choose" | "story";
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
  /** RANK-01: Any rank (the default — fastest) or Similar rank (widening). */
  const [rankSearch, setRankSearch] = useState<RankSearch>("any");
  /** The rung a similar-rank search is currently on, for the waiting screen. */
  const [searchRung, setSearchRung] = useState(0);
  const rankRef = useRef<RankState | null>(null);
  /** Guards the realtime calls: a double-click must not mint two rooms. */
  const [busy, setBusy] = useState(false);
  /** Seconds since the current search began, shown live on the searching
   *  screen — with no timeout, "how long has it been" is the only feedback. */
  const [searchSeconds, setSearchSeconds] = useState(0);
  const matchRequest = useRef(0);

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
        // RANK-01: publish this player's rating now that a room exists to hold
        // it, and mirror the room's board for the lobby.
        if (rankRef.current) session.publishRating(rankRef.current);
        setBoard([...session.ratings]);
        setSeed(message.seed);
        setWelcomeRoster(message.roster);
        return;
      }
      // The host left while we were still in the lobby (MP-03 broadcasts a
      // reject). Without this the guest is offered a Play button that leads
      // into a world nobody is simulating.
      if (message.type === "reject") failMessage(message.reason);
      // RANK-01: any other traffic may carry the opponent's rating (a board
      // update lands as its own message). Cheap, and it keeps the lobby chips
      // live rather than frozen at welcome time.
      setBoard([...session.ratings]);
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
  const beginMatch = useCallback(async () => {
    if (busy) return;
    if (isOfflineMockRealtime()) {
      failMessage(NO_ROOM_SERVER_MESSAGE);
      return;
    }
    setBusy(true);
    setError("");
    setState("matchmaking");
    const request = ++matchRequest.current;
    // Similar rank starts tight; Any rank starts (and stays) at the last rung.
    let rung = rankSearch === "similar" ? 0 : RANK_SEARCH_STEPS.length - 1;
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
  }, [awaitWelcome, busy, fail, failMessage, matchRequest, rankSearch, withLogin]);

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
    onStart({ mode, seed, room, net, portrait, ranked });
  }, [net, onStart, portrait, room, seed]);

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

  useEffect(() => () => { /* room ownership moves to App after resolution */ }, []);

  if (state === "choose") return (
    <main className="start-screen" aria-label="Hexmatch start screen">
      <div className="start-panel">
        <p className="start-kicker">HEXMatch Industries</p>
        <h1>Back to work, Logistics Manager.</h1>
        <p className="start-subtitle">Your first shift at {EMPLOYER}: move the freight, beat the rival, earn the promotion.</p>
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
                ? "Play a quick match to place on the ladder."
                : `${rank.wins}W · ${rank.losses}L · ${
                    tierProgress(rank.rating).next
                      ? `${tierProgress(rank.rating).toNext} rating to ${tierProgress(rank.rating).next!.label}`
                      : "top of the ladder"}`}
            </p>
          </div>
        ) : null}
        <div className="start-actions">
          <button className="start-primary" data-sfx="open" onClick={() => { setProgress(loadStoryProgress()); setState("story"); }}>Story Mode <small>the Foundry Syndicate</small></button>
          <button data-sfx="open" onClick={() => onStart({ mode: "ai", portrait })}>Play vs AI <small>no login</small></button>
          <button disabled={busy} onClick={() => { setState("host"); void beginRoom("host"); }}>Host a game (Experimental) <small>unranked</small></button>
          <button disabled={busy} onClick={openJoinScreen}>Join with a code <small>unranked</small></button>
          <button disabled={busy} onClick={() => void beginMatch()}>Auto Matchmaking <small>ranked · a rated stranger</small></button>
          <div className="rank-search" role="radiogroup" aria-label="Who Auto Matchmaking pairs you with">
            {([["any", "Any rank", "whoever is waiting"], ["similar", "Similar rank", "widening, never stuck"]] as const)
              .map(([value, label, hint]) => (
                <button key={value} type="button" disabled={busy}
                  className={`rank-search-opt${rankSearch === value ? " on" : ""}`}
                  aria-pressed={rankSearch === value}
                  data-sfx="select"
                  onClick={() => setRankSearch(value)}>
                  {label}<small>{hint}</small>
                </button>
              ))}
          </div>
          <button disabled={busy} onClick={() => { loadLadder(); setState("ladder"); }}>The ladder <small>top ratings</small></button>
          {onBack ? <button className="start-back" data-sfx="close" onClick={onBack}>Back to the menu</button> : null}
        </div>
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
              return (
                // The card is a <button>, so its "More" toggle is a sibling
                // (a button cannot hold another button). It also works on a
                // sealed contract, whose card itself is disabled.
                <div key={chapter.id} className="chapter-item">
                <button type="button" data-sfx="open"
                  className={`chapter-card${open ? "" : " locked"}`}
                  style={{ "--cc": rival.colour } as CSSProperties}
                  disabled={!open}
                  aria-label={`${chapter.name}${result === "win" ? " — filed, won" : result === "loss" ? " — filed, lost" : ""}${open ? "" : " (sealed)"}`}
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
                  </span>
                </button>
                <button type="button" className="cc-more" data-sfx="tab"
                  aria-expanded={expanded} aria-controls={briefId}
                  onClick={() => setOpenBriefs((prev) => {
                    const next = new Set(prev);
                    if (next.has(chapter.id)) next.delete(chapter.id); else next.add(chapter.id);
                    return next;
                  })}>
                  {expanded ? "Less ▴" : "More ▾"}
                </button>
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
      <main className="start-screen"><div className="start-panel lobby"><p className="start-kicker">AUTO MATCHMAKING</p><h1>Finding an opponent…</h1>
        <p className="start-subtitle">{window} Searching for {searchClock} — we keep looking until you cancel.</p>
        <button onClick={abandonMatch}>Cancel</button></div></main>
    );
  }
  if (state === "error") return (
    <main className="start-screen"><div className="start-panel lobby"><p className="start-kicker">MATCH UNAVAILABLE</p><h1>Could not join</h1><p className="lobby-error">{error}</p><div className="lobby-actions"><button onClick={backToChoose}>Back</button><button className="start-primary" onClick={() => onStart({ mode: "ai", portrait })}>Play vs AI</button></div></div></main>
  );

  const hosting = state === "host";
  const connecting = seed === null;
  // RANK-01: the seat rows carry a badge each. The room's board is the source
  // for everyone (including ourselves, echoed back), and the local file is the
  // fallback for our own seat until that echo lands.
  const chipBySeat = (player: ServerPlayer): RankChipModel => {
    const wire = board.find((entry) => entry.id === player.id) ?? null;
    if (wire) return chipForWire(wire);
    if (room && player.id === room.playerId && rank) return chipFor(rank);
    return chipForWire(null);
  };
  return <main className="start-screen"><div className="start-panel lobby">
    <p className="start-kicker">{hosting ? "HOST GAME" : "MATCH READY"}{rankedRoom ? " · RANKED" : ""}</p><h1>{hosting ? "Invite a rival" : "Room found"}</h1>
    <div className="room-code"><b>{room?.roomCode ?? "——"}</b><button aria-label="Copy room code" onClick={() => room && void navigator.clipboard?.writeText(room.roomCode)}>Copy</button></div>
    <div className="seat-list">{roster.map((player) => <div className="seat filled" key={player.id}><span className="seat-name">{player.username}</span><RankChip model={chipBySeat(player)} /><span className="seat-status">Connected</span></div>)}<div className="seat"><span>Open seat</span><span className="seat-status">{roster.length >= 2 ? "Ready" : "Waiting"}</span></div></div>
    <p className="lobby-note">{connecting
      ? "Connecting to the room…"
      : rankedRoom
        ? "Ranked: the winner's rating rises and the loser's falls. Leaving mid-match counts as a loss."
        : hosting && roster.length < 2 ? "Share the code. Start when your rival joins." : "Both players are ready."}</p>
    <div className="lobby-actions"><button onClick={backToChoose}>Leave</button><button className="start-primary" data-sfx="open" disabled={connecting || (hosting && roster.length < 2)} onClick={() => startNetworkGame(hosting ? "host" : "guest", rankedRoom)}>{connecting ? "Connecting…" : hosting ? "Start game" : "Play"}</button></div>
  </div></main>;
}
