import { useEffect, useRef, useState } from "react";
import "./iso/game.css";
import { startIsoGame } from "./iso/game";

/**
 * E12 — boot orchestrator. The isometric game is the standalone default;
 * the legacy R1/R2 hex game is reachable at `?legacy=1` (the URL flag) and is
 * imported lazily so the default bundle never contains it or its three.js
 * dependency. The legacy module owns its own stylesheet; the iso stylesheet
 * stays in the default bundle.
 */
export default function App() {
  const ref = useRef<HTMLDivElement>(null);
  const [legacy] = useState(
    () => new URLSearchParams(window.location.search).has("legacy"),
  );

  useEffect(() => {
    if (!ref.current) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    (async () => {
      // Keep the legacy branch lazy: importing src/game/main-legacy statically
      // would pull MapView3D + three into every page load (R9/E12).
      const boot = (legacy
        ? (await import("./game/main-legacy")).startGame
        : startIsoGame) as (el: HTMLElement) => unknown;
      if (cancelled) return;
      cleanup = boot(ref.current!) as (() => void) | undefined;
    })();
    return () => { cancelled = true; cleanup?.(); };
  }, [legacy]);

  return <div ref={ref} className="game-root" />;
}
