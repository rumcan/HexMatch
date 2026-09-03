import { useEffect, useRef, useState } from "react";
import "./game/styles.css";
import "./iso/game.css";
import { startGame } from "./game/main";
import { startIsoGame } from "./iso/game";

/**
 * E11 (partial) cutover: the isometric game is now the default view. The old
 * hex/3D game is still reachable at `?legacy=1` until the destructive half of
 * E11 deletes hexmap.ts / MapView3D.ts and the `three` dependency.
 */
export default function App() {
  const ref = useRef<HTMLDivElement>(null);
  const [legacy] = useState(
    () => new URLSearchParams(window.location.search).has("legacy"),
  );

  useEffect(() => {
    if (!ref.current) return;
    const cleanup = legacy ? startGame(ref.current) : startIsoGame(ref.current);
    return () => { if (cleanup) cleanup(); };
  }, [legacy]);

  return <div ref={ref} className="game-root" />;
}
