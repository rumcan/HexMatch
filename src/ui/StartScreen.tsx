import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  NO_ROOM_SERVER_MESSAGE,
  createRoom,
  isAccessDenied,
  isOfflineMockRealtime,
  isValidRoomCode,
  joinRoomByCode,
  normalizeRoomCode,
  promptLogin,
  quickMatch,
  type HexRoom,
  type ServerPlayer,
} from "../net/transport";
import { NetSession } from "../net/session";
import { VERSION_MISMATCH_MESSAGE, validateWelcome, type HexProtocol } from "../net/protocol";
import { PORTRAITS, type Portrait } from "../iso/config";

export type StartChoice =
  | { mode: "ai"; portrait: Portrait }
  | { mode: "host"; seed: number; room: HexRoom; net: NetSession; portrait: Portrait }
  | { mode: "guest"; seed: number; room: HexRoom; net: NetSession; portrait: Portrait };

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
  | "host"
  | "join"
  | "joined"
  | "matchmaking"
  | "matchmaking-timeout"
  | "error";

const MATCHMAKING_TIMEOUT = null;

/**
 * How long a lobby waits for the room's welcome before giving up. The welcome
 * carries the seed and the seed is what lets the game mount, so a missed one is
 * a dead end with a permanently disabled Play button — this turns it into a
 * recoverable error instead. Typed room messages are NOT replayed to a
 * subscriber that registers late, so the race is real even though it is rare.
 */
const WELCOME_TIMEOUT_MS = 10_000;

interface StartScreenProps {
  onStart: (choice: StartChoice) => void;
}

/** The deliberately low-friction entry point: AI is always available without auth. */
export default function StartScreen({ onStart }: StartScreenProps) {
  const [state, setState] = useState<ScreenState>("choose");
  const [room, setRoom] = useState<HexRoom | null>(null);
  const [seed, setSeed] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  /** PP-14b: the player's tycoon portrait — Vex or You (Torvin is the rival). */
  const [portrait, setPortrait] = useState<Portrait>("vex");
  const [players, setPlayers] = useState<readonly ServerPlayer[]>([]);
  const [net, setNet] = useState<NetSession | null>(null);
  /** Guards the realtime calls: a double-click must not mint two rooms. */
  const [busy, setBusy] = useState(false);
  const matchRequest = useRef(0);

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

  const awaitWelcome = useCallback((nextRoom: HexRoom, role: "host" | "guest") => {
    setRoom(nextRoom);
    setPlayers(nextRoom.players);
    const onRoomChanged = () => setPlayers([...nextRoom.players]);
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
        setSeed(message.seed);
        return;
      }
      // The host left while we were still in the lobby (MP-03 broadcasts a
      // reject). Without this the guest is offered a Play button that leads
      // into a world nobody is simulating.
      if (message.type === "reject") failMessage(message.reason);
    };
    // MP-03 sends the welcome BOTH ways (broadcast to members, sendTo to the
    // newcomer), so listen on both channels or the first joiner never learns
    // it is the host. The SDK may also have delivered it before this component
    // subscribed — the timeout below is the safety net for that race.
    nextRoom.on({
      onMessage: onGreeting,
      onPrivateMessage: onGreeting,
      onPlayerJoined: onRoomChanged,
      onPlayerLeft: onRoomChanged,
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
      awaitWelcome(nextRoom, kind === "host" ? "host" : "guest");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }, [awaitWelcome, busy, code, fail, failMessage, withLogin]);

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
    // The SDK request remains attached to the race even if the UI gives up;
    // the request token prevents a late room from taking the player out of the
    // explicit fallback screen.
    const timeout = new Promise<null>((resolve) => {
      window.setTimeout(() => resolve(MATCHMAKING_TIMEOUT), 30_000);
    });
    try {
      const result = await Promise.race([
        withLogin(() => quickMatch({ matchmakeTimeoutMs: 30_000 })),
        timeout,
      ]);
      if (result === MATCHMAKING_TIMEOUT) {
        setState("matchmaking-timeout");
        return;
      }
      if (request !== matchRequest.current) return;
      // A matchmaker can return either an existing room or a newly-created one.
      // isCreator is the SDK's authoritative host hint until welcome arrives.
      awaitWelcome(result, result.isCreator ? "host" : "guest");
    } catch (err) {
      if (request === matchRequest.current) fail(err);
    } finally {
      if (request === matchRequest.current) setBusy(false);
    }
  }, [awaitWelcome, busy, fail, failMessage, matchRequest, withLogin]);

  const abandonMatch = useCallback(() => {
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

  const startNetworkGame = useCallback((mode: "host" | "guest") => {
    if (!room || seed === null || !net) return;
    onStart({ mode, seed, room, net, portrait });
  }, [net, onStart, portrait, room, seed]);

  const roster = useMemo(() => {
    if (!room) return [] as readonly ServerPlayer[];
    return players.length ? players : room.players;
  }, [players, room]);

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

  useEffect(() => () => { /* room ownership moves to App after resolution */ }, []);

  if (state === "choose") return (
    <main className="start-screen" aria-label="Hexmatch start screen">
      <div className="start-panel">
        <p className="start-kicker">HEXMatch Industries</p>
        <h1>Build the island. Beat the rival.</h1>
        <p className="start-subtitle">A strategy match of roads, resources, and ruthless expansion.</p>
        <div className="portrait-picker" role="radiogroup" aria-label="Choose your tycoon">
          <p className="portrait-label">Your tycoon</p>
          <div className="portrait-options">
            {PORTRAITS.map((p) => (
              <button key={p} type="button"
                className={`portrait-opt${portrait === p ? " on" : ""}`}
                aria-pressed={portrait === p}
                data-sfx="select"
                onClick={() => setPortrait(p)}>
                <span className={`portrait-face portrait-${p}`} aria-hidden="true" />
                <span className="portrait-name">{p === "vex" ? "Anne" : "James"}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="start-actions">
          <button className="start-primary" data-sfx="open" onClick={() => onStart({ mode: "ai", portrait })}>Play vs AI <small>no login</small></button>
          <button disabled={busy} onClick={() => { setState("host"); void beginRoom("host"); }}>Host a game</button>
          <button disabled={busy} onClick={openJoinScreen}>Join with a code</button>
          <button disabled={busy} onClick={() => void beginMatch()}>Quick match</button>
        </div>
      </div>
    </main>
  );

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

  if (state === "matchmaking") return (
    <main className="start-screen"><div className="start-panel lobby"><p className="start-kicker">QUICK MATCH</p><h1>Finding an opponent…</h1><p className="start-subtitle">We will keep looking for up to 30 seconds.</p>
      <button onClick={abandonMatch}>Cancel</button></div></main>
  );

  if (state === "matchmaking-timeout") return (
    <main className="start-screen"><div className="start-panel lobby"><p className="start-kicker">QUICK MATCH</p><h1>No rival found yet</h1><p className="start-subtitle">Try again later, or start a match against the AI now.</p>
      <div className="lobby-actions"><button onClick={abandonMatch}>Back</button><button className="start-primary" onClick={() => onStart({ mode: "ai", portrait })}>Play vs AI</button></div>
    </div></main>
  );

  if (state === "error") return (
    <main className="start-screen"><div className="start-panel lobby"><p className="start-kicker">MATCH UNAVAILABLE</p><h1>Could not join</h1><p className="lobby-error">{error}</p><div className="lobby-actions"><button onClick={backToChoose}>Back</button><button className="start-primary" onClick={() => onStart({ mode: "ai", portrait })}>Play vs AI</button></div></div></main>
  );

  const hosting = state === "host";
  const connecting = seed === null;
  return <main className="start-screen"><div className="start-panel lobby">
    <p className="start-kicker">{hosting ? "HOST GAME" : "MATCH READY"}</p><h1>{hosting ? "Invite a rival" : "Room found"}</h1>
    <div className="room-code"><b>{room?.roomCode ?? "——"}</b><button aria-label="Copy room code" onClick={() => room && void navigator.clipboard?.writeText(room.roomCode)}>Copy</button></div>
    <div className="seat-list">{roster.map((player) => <div className="seat filled" key={player.id}><span className="seat-name">{player.username}</span><span className="seat-status">Connected</span></div>)}<div className="seat"><span>Open seat</span><span className="seat-status">{roster.length >= 2 ? "Ready" : "Waiting"}</span></div></div>
    <p className="lobby-note">{connecting
      ? "Connecting to the room…"
      : hosting && roster.length < 2 ? "Share the code. Start when your rival joins." : "Both players are ready."}</p>
    <div className="lobby-actions"><button onClick={backToChoose}>Leave</button><button className="start-primary" data-sfx="open" disabled={connecting || (hosting && roster.length < 2)} onClick={() => startNetworkGame(hosting ? "host" : "guest")}>{connecting ? "Connecting…" : hosting ? "Start game" : "Play"}</button></div>
  </div></main>;
}
