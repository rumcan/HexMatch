import { useEffect, useRef, useState } from "react";
import { createGame, BuildTool, SetupStep } from "./game";
import { CARGO, Cargo, CARGO_KEYS, INDUSTRIES } from "./config";
import { Industry as IndType } from "./grid";

const TOOL_LABEL: Record<BuildTool, string> = {
  road: "Road", rail: "Rail", harvester: "Harvester", demolish: "Demolish",
};
const SETUP_BANNER: Record<SetupStep, string> = {
  factory: "Place your main Factory (HQ) — click any grass tile.",
  harvester: "Place your first Harvester on an industry.",
  connect: "Drag Road (or Rail) to connect your Harvester to the Factory.",
  play: "Empire underway. Keep building out to new industries.",
};

export default function IsoApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<ReturnType<typeof createGame> | null>(null);
  const [, force] = useState(0);
  const [tool, setTool] = useState<BuildTool>("harvester");
  const [sel, setSel] = useState<IndType | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const g = createGame(canvasRef.current, 1337);
    gameRef.current = g;
    const refresh = () => {
      setTool(g.state.tool);
      force((n) => n + 1);
    };
    g.onStateChange(refresh);
    g.onSelectIndustry((ind: IndType) => setSel(ind));

    const canvas = canvasRef.current;
    const ro = new ResizeObserver(() => {
      g.renderer.resize(); g.renderer.recentre();
    });
    ro.observe(canvas);
    let raf = 0;
    const loop = () => { g.renderer.draw(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "1") g.setTool("road");
      if (e.key === "2") g.setTool("rail");
      if (e.key === "3") g.setTool("harvester");
      if (e.key === "4") g.setTool("demolish");
      if (e.key === "f" || e.key === "F") g.renderer.recentre();
    };
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener("keydown", onKey); };
  }, []);

  const g = gameRef.current;
  const state = g?.state;

  const pickTool = (t: BuildTool) => {
    if (!g) return;
    g.setTool(t);
    setTool(t);
  };

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#2a6aa0", fontFamily: "Segoe UI, system-ui, sans-serif" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }} />

      {/* top bar */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, padding: "10px 14px", display: "flex", gap: 12, alignItems: "center",
        background: "linear-gradient(180deg, rgba(8,13,19,.9), rgba(8,13,19,.5))", color: "#fff", zIndex: 10 }}>
        <b>⚙️ HEXMATCH <small style={{ opacity: 0.7 }}>ISO</small></b>
        {CARGO_KEYS.map((c: Cargo) => (
          <span key={c} style={{ fontSize: 13, opacity: 0.95 }}>
            {CARGO[c].name} <b>{Math.floor(state?.cargo[c] ?? 0)}</b>
          </span>
        ))}
        <span style={{ marginLeft: "auto" }}>VP <b>{state?.world.vp[0] ?? 0}</b></span>
        <button onClick={() => g?.renderer.recentre()} style={btn}>🎯 Recentre</button>
      </div>

      {/* setup banner */}
      {state && state.step !== "play" && (
        <div style={{ position: "fixed", top: 56, left: "50%", transform: "translateX(-50%)",
          background: "rgba(10,16,22,.92)", color: "#ffe27a", padding: "8px 16px", borderRadius: 6,
          border: "1px solid #6b5a22", zIndex: 10, fontSize: 14 }}>
          {SETUP_BANNER[state.step]}
          {state.step === "connect" && <div style={{ fontSize: 12, opacity: 0.8 }}>Free road left: {state.roadBudget}</div>}
        </div>
      )}

      {/* build panel */}
      <div style={{ position: "fixed", left: 12, bottom: 12, display: "flex", gap: 8, zIndex: 10 }}>
        {(["road", "rail", "harvester", "demolish"] as BuildTool[]).map((t) => (
          <button key={t} onClick={() => pickTool(t)}
            style={{ ...btn, background: tool === t ? "#ffd23c" : "rgba(10,16,22,.85)",
              color: tool === t ? "#111" : "#fff" }}>
            {TOOL_LABEL[t]}
            {(t === "road" || t === "rail") && (
              <div style={{ fontSize: 10, opacity: 0.8 }}>
                {t === "road" ? "1 stone/tile · 1 VP" : "2 ore+1 stone/tile · 3 VP"}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* industry inspector (E9) */}
      {sel && (
        <div style={{ position: "fixed", right: 12, bottom: 12, width: 240, background: "rgba(10,16,22,.92)",
          color: "#fff", padding: 12, borderRadius: 8, border: "1px solid #334", zIndex: 10, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <b>{INDUSTRIES[sel.type] && sel.type.replace("_", " ")}</b>
            <button onClick={() => setSel(null)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer" }}>×</button>
          </div>
          <div style={{ opacity: 0.85, marginTop: 6 }}>
            Output: {sel.output.toFixed(1)} × {CARGO[INDUSTRIES[sel.type].cargo].name}
          </div>
          <div style={{ opacity: sel.banditUntil > performance.now() ? 1 : 0.5, marginTop: 4 }}>
            {sel.banditUntil > performance.now() ? "⛔ Blockaded" : "Producing normally"}
          </div>
        </div>
      )}
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "rgba(10,16,22,.85)", color: "#fff", border: "1px solid #3a4550",
  padding: "8px 12px", borderRadius: 6, cursor: "pointer", fontSize: 13,
};
