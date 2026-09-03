// ══════════════════════════════════════════════════════════════════════════
// J1 — the quarry panel: the match-3 board, mounted in the iso layout.
//
// DOM rather than a fourth canvas: the board is 81 cells that change in bursts
// (a match resolves over ~400ms), it needs to be readable on a phone next to
// the map, and DOM cells are pickable by the e2e suite without pixel maths.
// The 81 buttons are built once and re-attributed on change, never rebuilt,
// so a re-render cannot drop the pointer target mid-drag.
// ══════════════════════════════════════════════════════════════════════════
import { Board, type Gem } from "../game/board";
import { BOARD_H, BOARD_W, RES, type ResKey } from "../game/config";
import { CARGO, CARGOES, type Cargo } from "./config";
import { CARGO_TO_GEM } from "./quarry";

export interface BoardPanelHooks {
  /** Two adjacent cells were clicked in order: the game performs the swap. */
  onSwap: (r1: number, c1: number, r2: number, c2: number) => void;
  onToggle?: (visible: boolean) => void;
}

export interface BoardPanel {
  el: HTMLElement;
  /** Redraw every cell from the board. Cheap; called on `board.onChange`. */
  render: () => void;
  /** What the network currently delivers — drives the "reach" strip. */
  setReach: (reach: Partial<Record<Cargo, number>>) => void;
  setVisible: (v: boolean) => void;
  isVisible: () => boolean;
}

const gemFace = (res: ResKey) =>
  `radial-gradient(circle at 34% 28%, ${RES[res].c2}, ${RES[res].c1})`;

const gemMark = (g: Gem): string => {
  if (g.block) return "⛔";
  if (g.special === "bomb") return "💣";
  if (g.res === "gold") return "🪙";
  if (g.hard > 0) return "❄";
  return g.tier > 0 ? String(g.tier) : "";
};

export function createBoardPanel(board: Board, hooks: BoardPanelHooks): BoardPanel {
  const el = document.createElement("div");
  el.className = "iso-panel iso-quarry";
  el.id = "iso-quarry";

  const head = document.createElement("div");
  head.className = "iso-panel-head";
  head.innerHTML =
    `<span>Quarry</span><small id="iso-quarry-combo"></small>` +
    `<button type="button" class="iso-x" data-act="quarry-hide" aria-label="Hide quarry">–</button>`;

  const reachEl = document.createElement("div");
  reachEl.className = "iso-reach";
  reachEl.id = "iso-quarry-reach";

  const grid = document.createElement("div");
  grid.className = "iso-gems";
  grid.id = "iso-gems";

  const hint = document.createElement("div");
  hint.className = "iso-hint";
  hint.id = "iso-quarry-hint";

  el.append(head, reachEl, grid, hint);

  // ── build the 81 cells once ──
  const cells: HTMLButtonElement[][] = [];
  for (let r = 0; r < BOARD_H; r++) {
    cells[r] = [];
    for (let c = 0; c < BOARD_W; c++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "gem";
      b.dataset.r = String(r);
      b.dataset.c = String(c);
      grid.appendChild(b);
      cells[r][c] = b;
    }
  }

  let selected: { r: number; c: number } | null = null;
  let reach: Partial<Record<Cargo, number>> = {};
  let visible = true;

  grid.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".gem");
    if (!b || !b.dataset.r || !b.dataset.c) return;
    const r = Number(b.dataset.r), c = Number(b.dataset.c);
    if (selected && Math.abs(selected.r - r) + Math.abs(selected.c - c) === 1) {
      const { r: r1, c: c1 } = selected;
      selected = null;
      hooks.onSwap(r1, c1, r, c);
      return;
    }
    selected = { r, c };
    paint();
  });

  function paint() {
    for (let r = 0; r < BOARD_H; r++) {
      for (let c = 0; c < BOARD_W; c++) {
        const cell = cells[r][c];
        const g = board.grid[r]?.[c] ?? null;
        const sel = selected?.r === r && selected?.c === c;
        cell.classList.toggle("sel", sel);
        if (!g) {
          // gravity refills every cell, so this is a transient state — but the
          // classes must not survive it into the next gem drawn here
          cell.dataset.res = "";
          cell.dataset.tier = "0";
          cell.classList.remove("token", "wild", "dead");
          cell.textContent = "";
          cell.style.background = "transparent";
          cell.style.boxShadow = "";
          cell.setAttribute("aria-label", "empty");
          continue;
        }
        cell.dataset.res = g.res;
        cell.dataset.tier = String(g.tier);
        cell.classList.toggle("token", g.tier > 0);
        cell.classList.toggle("wild", g.res === "gold");
        cell.classList.toggle("dead", !!g.block || g.special === "bomb");
        cell.style.background = gemFace(g.res);
        cell.style.boxShadow = g.tier > 0 ? `0 0 0 2px ${RES[g.res].ring} inset` : "";
        cell.textContent = gemMark(g);
        cell.setAttribute("aria-label",
          `${RES[g.res].name}${g.tier ? ` token ${g.tier}` : ""}${g.block ? " blocked" : ""}`);
      }
    }
    const combo = head.querySelector("#iso-quarry-combo");
    if (combo) {
      combo.textContent = board.comboCount > 0
        ? `combo ${board.comboCount}/${Board.COMBOS_PER_GOLD} → 🪙`
        : `${Board.COMBOS_PER_GOLD} combos → 🪙`;
    }
  }

  function paintReach() {
    // Each chip is the GEM that pays the cargo, so the board and the network
    // read as the same thing: this colour is live, that colour is not.
    const chips = CARGOES
      .filter((c) => (reach[c] ?? 0) > 0)
      .map((c) =>
        `<span class="chip" style="--c:${CARGO[c].c2}">${RES[CARGO_TO_GEM[c]].icon}${CARGO[c].name}</span>`);
    reachEl.innerHTML = chips.length
      ? `<b>Network reaches</b>${chips.join("")}`
      : "<b>Network reaches</b><i>nothing — connect a harvester</i>";
    hint.textContent = chips.length
      ? "Match 3+ gems. Only tokened gems (numbered) harvest the cargo above."
      : "Connect a harvester to your Factory: tokens only spawn on cargo you reach.";
  }

  // setVisible already fires onToggle; do not fire it twice
  head.querySelector("[data-act=quarry-hide]")?.addEventListener("click", () => setVisible(false));

  function setVisible(v: boolean) {
    visible = v;
    el.style.display = v ? "" : "none";
    hooks.onToggle?.(v);
  }

  paint();
  paintReach();

  return {
    el,
    render: paint,
    setReach(next) {
      reach = next;
      paintReach();
      paint();
    },
    setVisible,
    isVisible: () => visible,
  };
}
