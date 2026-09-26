// ══════════════════════════════════════════════════════════════════════════
// TUT-03 (#422) — the reference-card projector.
//
// The old eight-card tour (`src/iso/tutorial.ts`) was TWO things bolted
// together: a gate (localStorage, `?tutorial=0/1`, "never show this again")
// and a projector that walks a list of cards over the game. The in-game guide
// (src/iso/guide/*) owns the first half now — the Tutorial menu is the gate,
// and progress is per browser. This module is the second half, moved out
// so the one page that still needs it keeps working:
//
//   • THE BATTLE HOW TO PLAY (`battle-howto.ts`) — five cards of rules, asked
//     for on purpose from the ❔ card, the ☰ menu and the battle screen's own
//     "?". Nothing about it is a first-run gate, so it passes `force: true`
//     and has no "never" button to show.
//
// It paints the shipped `.tut-*` classes (src/game/styles.css) exactly as the
// tour did — same plate, same ledger paper, same blueprint figure, same
// `data-act` hooks — so the CSS and the copy guards keep their grip and only
// the module that OWNS the cards changed. Its figures are built from gems and
// ledger rows, so it needs no screenshots: a card projector with no image
// assets to keep in step with the game.
//
// Cards are data (`RefCardStep`), the projector is DOM. Nothing here knows
// about the map, the clock or the boot.
// ══════════════════════════════════════════════════════════════════════════
import { CARGO } from "../config";
import { sfx } from "../../audio/sfx";
import { GEM_ART } from "../../game/gem-art";

/** One gem square on a board figure. */
export interface BoardCell { cargo: import("../config").Cargo | null; hit?: boolean }
export interface RefCardFigureChain { kind: "chain"; nodes: { icon: string; label: string }[]; caption: string }
export interface RefCardFigureBoard { kind: "board"; cells: BoardCell[][]; caption: string }
export interface RefCardFigureLedger { kind: "ledger"; rows: { icon: string; label: string; vp: string }[]; caption: string }
export type RefCardFigure = RefCardFigureChain | RefCardFigureBoard | RefCardFigureLedger;

/** One card. Every field is player-facing copy. */
export interface RefCardStep {
  id: string;
  kicker: string;
  title: string;
  lede: string;
  figure: RefCardFigure;
  points: string[];
  tip: string;
}

/** The storage a caller may hand the gate (none needed here — see header). */
export type RefCardStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type RefCardCloseReason = "finished" | "dismissed";
export type RefCardResult = { reason: RefCardCloseReason };
export interface RefCardHandle {
  el: HTMLElement;
  promise: Promise<RefCardResult>;
  close: (reason?: RefCardCloseReason) => void;
  destroy: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

export interface ShowRefCardsOptions {
  /** The cards, in order. An empty list paints nothing. */
  steps: RefCardStep[];
  /** Overlay id — one page at a time, per id. Default `iso-refcard`. */
  overlayId?: string;
  /** The last card's forward key (the battle page ends "To battle →"). */
  doneLabel?: string;
  onClose?: (result: RefCardResult) => void;
  /** Where the overlay hangs — default the `root` argument. */
  mount?: HTMLElement;
}

/**
 * Walk `steps` over the game. Returns `null` when there is no document (SSR /
 * a unit run with no DOM) or a page with that id is already up — one at a
 * time, from any door. A page asked for on purpose is always opened.
 */
export function showRefCards(
  root: HTMLElement,
  opts: ShowRefCardsOptions,
): RefCardHandle | null {
  if (typeof document === "undefined") return null;
  const steps = opts.steps;
  if (!steps.length) return null;
  const existing = document.getElementById(opts.overlayId ?? "iso-refcard");
  if (existing) return null;             // one at a time, from any door
  let idx = 0;

  const overlay = el("div", "");
  overlay.id = opts.overlayId ?? "iso-refcard";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const card = el("div", "tut-card");
  const head = el("div", "tut-head");
  const closeBtn = el("button", "tut-x", "✕") as HTMLButtonElement;
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.dataset.act = "tut-close";
  const kickerEl = el("p", "tut-kicker");
  const titleEl = el("h2", "tut-title");
  head.append(closeBtn, kickerEl, titleEl);

  const body = el("div", "tut-body");
  const ledeEl = el("p", "tut-lede");
  const figureEl = el("div", "");
  const pointsEl = el("ul", "tut-points");
  const tipEl = el("div", "tut-tip");
  body.append(ledeEl, figureEl, pointsEl, tipEl);

  const foot = el("div", "tut-foot");
  const nav = el("div", "tut-nav");
  const prev = el("button", "big-btn ghost", "← Back") as HTMLButtonElement;
  prev.type = "button";
  prev.dataset.act = "tut-prev";
  const next = el("button", "big-btn", "Next →") as HTMLButtonElement;
  next.type = "button";
  next.dataset.act = "tut-next";
  nav.append(prev, next);
  foot.append(nav);

  card.append(head, body, foot);
  overlay.appendChild(card);

  const caption = (text: string) => el("div", "tut-fig-cap", text);

  const renderFigure = (fig: RefCardFigure) => {
    figureEl.className = `tut-fig tut-fig-${fig.kind}`;
    figureEl.innerHTML = "";
    if (fig.kind === "chain") {
      const chain = el("div", "tut-chain");
      fig.nodes.forEach((n, i) => {
        const node = el("div", "tut-chain-node");
        node.innerHTML = `<i class="tut-chain-ic">${n.icon}</i><b>${n.label}</b>`;
        chain.appendChild(node);
        if (i < fig.nodes.length - 1) chain.appendChild(el("i", "tut-chain-arrow", "→"));
      });
      figureEl.append(chain, caption(fig.caption));
    } else if (fig.kind === "board") {
      const board = el("div", "tut-board");
      const cols = Math.max(1, ...fig.cells.map((r) => r.length));
      board.style.setProperty("--tut-cols", String(cols));
      for (const row of fig.cells) {
        for (const cell of row) {
          const c = el("span", "tut-gem");
          if (!cell.cargo) {
            c.classList.add("tut-gem-empty");
          } else {
            const art = (GEM_ART as Record<string, string | undefined>)[cell.cargo] ?? null;
            if (art) c.style.backgroundImage = `url("${art}")`;
            else c.textContent = CARGO[cell.cargo].icon;
            if (cell.hit) c.classList.add("tut-gem-hit");
          }
          board.appendChild(c);
        }
      }
      figureEl.append(board, caption(fig.caption));
    } else if (fig.kind === "ledger") {
      const ledger = el("div", "tut-ledger");
      for (const row of fig.rows) {
        const r = el("div", "tut-ledger-row");
        r.innerHTML =
          `<span class="tut-ledger-ic">${row.icon}</span>` +
          `<span class="tut-ledger-copy"><b>${row.label}</b></span>` +
          `<span class="tut-ledger-vp">${row.vp}</span>`;
        ledger.appendChild(r);
      }
      figureEl.append(ledger, caption(fig.caption));
    }
  };

  const render = () => {
    const s = steps[idx];
    overlay.dataset.step = s.id;
    kickerEl.textContent = s.kicker;
    titleEl.textContent = s.title;
    ledeEl.innerHTML = s.lede;
    renderFigure(s.figure);
    pointsEl.innerHTML = "";
    for (const p of s.points) {
      const li = el("li", "");
      li.innerHTML = p;
      pointsEl.appendChild(li);
    }
    tipEl.textContent = s.tip;
    // Back has nowhere to go on step one; the last step's key is the one that
    // ends the page (and finishing is NOT dismissing).
    prev.disabled = idx === 0;
    const last = idx === steps.length - 1;
    next.dataset.act = last ? "tut-done" : "tut-next";
    next.textContent = last ? (opts.doneLabel ?? "Start Production →") : "Next →";
  };

  let resolve!: (r: RefCardResult) => void;
  const promise = new Promise<RefCardResult>((res) => { resolve = res; });
  let closed = false;
  const close = (reason: RefCardCloseReason = "dismissed") => {
    if (closed) return;   // the promise settles once, however many doors slam
    closed = true;
    overlay.remove();
    const result: RefCardResult = { reason };
    opts.onClose?.(result);
    sfx.play("close");
    resolve(result);
  };
  const destroy = () => close("dismissed");

  prev.onclick = () => { if (idx > 0) { idx--; render(); sfx.play("open"); } };
  next.onclick = () => {
    if (idx < steps.length - 1) { idx++; render(); sfx.play("open"); }
    else close("finished");
  };
  closeBtn.onclick = () => close();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close("dismissed"); });

  render();
  (opts.mount ?? root).appendChild(overlay);
  sfx.play("open");
  return { el: overlay, promise, close, destroy };
}
