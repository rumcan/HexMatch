import { useEffect, useRef, useState, useCallback } from "react";
import type { IsoGame } from "./game";
import { Quarry } from "./quarry";
import { CARGO, Cargo, CELL } from "./config";

// Gem colour palette keyed by cargo (matches the gem frames, but we use simple
// coloured gems so the board needs no extra art to be legible).
const GEM_FILL: Record<Cargo, string> = {
  grain: "#f5da28", wood: "#c07b34", ore: "#e8442a",
  stone: "#9fb6d8", oil: "#3fbf52", gold: "#ffcf3f",
};
const GEM_DARK: Record<Cargo, string> = {
  grain: "#b89400", wood: "#7a4a16", ore: "#9e1c0c",
  stone: "#5f7697", oil: "#24802f", gold: "#c98a00",
};

export default function QuarryPanel({ game }: { game: IsoGame | null }) {
  const [, force] = useState(0);
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null);
  const q: Quarry | null = game?.state.quarry ?? null;
  const boardRef = useRef<HTMLDivElement>(null);

  const redraw = useCallback(() => force((n) => n + 1), []);
  useEffect(() => {
    game?.onStateChange(redraw);
  }, [game, redraw]);

  if (!game || !q) return null;

  const tap = async (r: number, c: number) => {
    if (q.busy || q.fogUntil > performance.now()) return;
    if (!sel) { setSel({ r, c }); return; }
    if (sel.r === r && sel.c === c) { setSel(null); return; }
    const adj = Math.abs(sel.r - r) + Math.abs(sel.c - c) === 1;
    if (adj) {
      await game.swapQuarry(sel.r, sel.c, r, c);
    }
    setSel(adj ? null : { r, c });
  };

  return (
    <div style={{
      position: "fixed", right: 12, bottom: 56, width: CELL * q.W + 20,
      background: "rgba(10,16,22,.92)", border: "1px solid #3a4550", borderRadius: 8,
      padding: 10, zIndex: 9,
    }}>
      <div style={{ color: "#9fb3c8", fontSize: 12, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
        💎 Your Quarry
      </div>
      <div
        ref={boardRef}
        style={{
          position: "relative",
          width: CELL * q.W, height: CELL * q.H,
          display: "grid",
          gridTemplateColumns: `repeat(${q.W}, ${CELL}px)`,
          gridTemplateRows: `repeat(${q.H}, ${CELL}px)`,
          touchAction: "manipulation",
        }}
      >
        {q.grid.flatMap((row, r) =>
          row.map((g, c) => {
            if (!g) return <div key={`${r}-${c}`} />;
            const selected = sel?.r === r && sel?.c === c;
            const tier = g.tier;
            const fill = GEM_FILL[g.cargo], dark = GEM_DARK[g.cargo];
            return (
              <button
                key={g.id}
                onClick={() => tap(r, c)}
                style={{
                  width: CELL, height: CELL, padding: 3, background: "transparent",
                  border: "none", cursor: "pointer", position: "relative",
                }}
              >
                <span style={{
                  display: "block", width: "100%", height: "100%",
                  borderRadius: 8,
                  background: `linear-gradient(150deg, ${fill}, ${dark})`,
                  boxShadow: tier ? `0 0 8px 2px ${fill}, inset 0 0 0 ${tier + 1}px rgba(255,255,255,.85)`
                    : "inset 0 -3px 4px rgba(0,0,0,.25)",
                  outline: selected ? "2px solid #fff" : "none",
                  outlineOffset: selected ? -2 : 0,
                  opacity: g.block ? 0.35 : 1,
                }}>
                  {g.special === "bomb" && <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 18 }}>💣</span>}
                  {tier > 0 && !g.special && (
                    <span style={{
                      position: "absolute", top: 1, right: 4, fontSize: 11, fontWeight: 700,
                      color: "#fff", textShadow: "0 1px 2px #000",
                    }}>{tier}</span>
                  )}
                </span>
                <span style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)", fontSize: 8, color: "#cdd7e2", opacity: 0.7 }}>
                  {CARGO[g.cargo].name[0]}
                </span>
              </button>
            );
          })
        )}
      </div>
      <div style={{ color: "#7d8fa3", fontSize: 11, marginTop: 6 }}>
        Tap two adjacent gems to swap. Ringed gems carry cargo from your network — match them to mine.
      </div>
    </div>
  );
}
