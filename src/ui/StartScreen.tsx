import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createRoom,
  isAccessDenied,
  joinRoomByCode,
  normalizeRoomCode,
  promptLogin,
  quickMatch,
  type HexRoom,
  type ServerPlayer,
} from "../net/transport";
import { NetSession } from "../net/session";

export type StartChoice =
  | { mode: "ai" }
  | { mode: "host"; seed: number; room: HexRoom; net: NetSession }
  | { mode: "guest"; seed: number; room: HexRoom; net: NetSession };

type ScreenState = "choose" | "host" | "join" | "matchmaking" | "matchmaking-timeout" | "error";

const MATCHMAKING_TIMEOUT = null;

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
  const [players, setPlayers] = useState<readonly ServerPlayer[]>([]);
  const [net, setNet] = useState<NetSession | null>(null);
  const matchRequest = useRef(0);

  const fail = useCallback((err: unknown) => {
    setError(isAccessDenied(err)
      ? "Sign in to play with friends — or play against the AI now."
      : err instanceof Error ? err.message : "Could not connect to the game.");
    setState("error");
  }, []);

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
    const waitForWelcome = (message: import("../net/protocol").HexProtocol) => {
      if (message.type !== "welcome") return;
      // Prime the session before the game mounts. Room events can arrive while
      // the lobby is still visible; NetSession retains the authoritative roster
      // and role so attach() can immediately request/render state.
      session.receive(message);
      setSeed(message.seed);
    };
    nextRoom.on({ onMessage: waitForWelcome, onPrivateMessage: waitForWelcome, onPlayerJoined: onRoomChanged, onPlayerLeft: onRoomChanged });
    // The SDK may have delivered the welcome before this component subscribed.
    // It still exposes the creator seed only over the protocol, so preserve a
    // short-lived session once the message arrives and use it below.
    setState(role === "host" ? "host" : "join");
  }, []);

  const beginRoom = useCallback(async (kind: "host" | "guest") => {
    setError("");
    try {
      const nextRoom = await withLogin(() => kind === "host" ? createRoom() : joinRoomByCode(code));
      const role = kind === "host" ? "host" : "guest";
      awaitWelcome(nextRoom, role);
    } catch (err) {
      fail(err);
    }
  }, [awaitWelcome, code, fail, withLogin]);

  const beginMatch = useCallback(async () => {
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
    }
  }, [awaitWelcome, fail, matchRequest, withLogin]);

  const abandonMatch = useCallback(() => {
    ++matchRequest.current;
    room?.leave();
    setState("choose");
  }, [room]);

  const startNetworkGame = useCallback((mode: "host" | "guest") => {
    if (!room || seed === null || !net) return;
    onStart({ mode, seed, room, net });
  }, [onStart, room, seed]);

  const roster = useMemo(() => {
    if (!room) return [] as readonly ServerPlayer[];
    return players.length ? players : room.players;
  }, [players, room]);

  useEffect(() => () => { /* room ownership moves to App after resolution */ }, []);

  if (state === "choose") return (
    <main className="start-screen" aria-label="Hexmatch start screen">
      <div className="start-panel">
        <p className="start-kicker">HEXMatch Industries</p>
        <h1>Build the island. Beat the rival.</h1>
        <p className="start-subtitle">A strategy match of roads, resources, and ruthless expansion.</p>
        <div className="start-actions">
          <button className="start-primary" onClick={() => onStart({ mode: "ai" })}>Play vs AI <small>no login</small></button>
          <button onClick={() => { setState("host"); void beginRoom("host"); }}>Host a game</button>
          <button onClick={() => setState("join")}>Join with a code</button>
          <button onClick={() => void beginMatch()}>Quick match</button>
        </div>
      </div>
    </main>
  );

  if (state === "join" && !room) return (
    <main className="start-screen"><div className="start-panel lobby">
      <p className="start-kicker">JOIN A MATCH</p><h1>Enter room code</h1>
      <p className="start-subtitle">Ask the host for the six-character code.</p>
      <input className="code-input" aria-label="Room code" maxLength={6} autoFocus value={code}
        onChange={(e) => setCode(normalizeRoomCode(e.target.value))} />
      <div className="lobby-actions"><button onClick={() => setState("choose")}>Back</button>
        <button className="start-primary" disabled={code.length !== 6} onClick={() => void beginRoom("guest")}>Join game</button></div>
    </div></main>
  );

  if (state === "matchmaking") return (
    <main className="start-screen"><div className="start-panel lobby"><p className="start-kicker">QUICK MATCH</p><h1>Finding an opponent…</h1><p className="start-subtitle">We will keep looking for up to 30 seconds.</p>
      <button onClick={abandonMatch}>Cancel</button></div></main>
  );

  if (state === "matchmaking-timeout") return (
    <main className="start-screen"><div className="start-panel lobby"><p className="start-kicker">QUICK MATCH</p><h1>No rival found yet</h1><p className="start-subtitle">Try again later, or start a match against the AI now.</p>
      <div className="lobby-actions"><button onClick={abandonMatch}>Back</button><button className="start-primary" onClick={() => onStart({ mode: "ai" })}>Play vs AI</button></div>
    </div></main>
  );

  if (state === "error") return (
    <main className="start-screen"><div className="start-panel lobby"><p className="start-kicker">MATCH UNAVAILABLE</p><h1>Could not join</h1><p className="lobby-error">{error}</p><div className="lobby-actions"><button onClick={() => setState("choose")}>Back</button><button className="start-primary" onClick={() => onStart({ mode: "ai" })}>Play vs AI</button></div></div></main>
  );

  const hosting = state === "host";
  return <main className="start-screen"><div className="start-panel lobby">
    <p className="start-kicker">{hosting ? "HOST GAME" : "MATCH READY"}</p><h1>{hosting ? "Invite a rival" : "Room found"}</h1>
    <div className="room-code"><b>{room?.roomCode ?? "——"}</b><button aria-label="Copy room code" onClick={() => room && void navigator.clipboard?.writeText(room.roomCode)}>Copy</button></div>
    <div className="seat-list">{roster.map((player) => <div className="seat filled" key={player.id}><span className="seat-name">{player.username}</span><span className="seat-status">Connected</span></div>)}<div className="seat"><span>Open seat</span><span className="seat-status">{roster.length >= 2 ? "Ready" : "Waiting"}</span></div></div>
    <p className="lobby-note">{hosting && roster.length < 2 ? "Share the code. Start when your rival joins." : "Both players are ready."}</p>
    <div className="lobby-actions"><button onClick={() => { room?.leave(); setState("choose"); }}>Leave</button><button className="start-primary" disabled={seed === null || (hosting && roster.length < 2)} onClick={() => startNetworkGame(hosting ? "host" : "guest")}>{hosting ? "Start game" : "Play"}</button></div>
  </div></main>;
}
