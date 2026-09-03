import { useEffect, useRef } from "react";
import "./iso/game.css";
import { startIsoGame } from "./iso/game";

/**
 * E11 — the isometric game is the only boot path. The legacy hex + three.js
 * game (`?legacy=1`, `src/game/main-legacy.ts`, MapView3D) was deleted.
 */
export default function App() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const cleanup = startIsoGame(ref.current) as (() => void) | undefined;
    return () => { cleanup?.(); };
  }, []);

  return <div ref={ref} className="game-root" />;
}
