import { useEffect, useRef, useState } from "react";
import "./game/styles.css";
import { startIsoGame } from "./iso/game";
import StartScreen, { type StartChoice } from "./ui/StartScreen";

/**
 * Multiplayer is opt-in: keeping the start screen outside the game means the
 * AI match remains playable without an account or a realtime connection.
 */
export default function App() {
  const [choice, setChoice] = useState<StartChoice | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!choice || !ref.current) return;
    const cleanup = choice.mode === "ai"
      ? startIsoGame(ref.current, { role: "solo", portrait: choice.portrait })
      : startIsoGame(ref.current, { seed: choice.seed, role: choice.mode, net: choice.net, portrait: choice.portrait });
    return () => { (cleanup as (() => void) | undefined)?.(); };
  }, [choice]);

  if (!choice) return <StartScreen onStart={setChoice} />;
  return <div ref={ref} className="game-root" />;
}
