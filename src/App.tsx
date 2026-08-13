import { useEffect, useRef } from "react";
import "./game/styles.css";
import { startGame } from "./game/main";

export default function App() {
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!ref.current || started.current) return;
    started.current = true;
    const cleanup = startGame(ref.current);
    return () => { if (cleanup) cleanup(); };
  }, []);

  return <div ref={ref} className="game-root" />;
}