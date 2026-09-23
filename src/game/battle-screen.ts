// ══════════════════════════════════════════════════════════════════════════
// B2 (#247) — the battle screen: the 1v1 interface over the map.
//
// A full-screen view driven ENTIRELY by the B1 engine (`src/game/battle.ts`):
// this module never changes a rule, it renders `battle.state` and forwards
// gestures to `battle.playSwap`. Reference: Puzzle Quest's duel screen.
//
//   • the shared board draws with the SAME gem rendering as the quarry
//     (`GEM_ART` sprites, the `.gem`/`.face`/`.icon` DOM, the styles.css
//     motion classes) and the SAME drag-on-release swap gesture (press, pull
//     along one axis, release past half a cell to commit);
//   • both seats get a portrait, a health bar and six mana bars (one per
//     cargo, capped at `rules.manaCap`);
//   • a whose-turn banner and a turn timer (`rules.turnMs`) sit over the
//     active seat — the timer is display here; B6's host enforces it;
//   • during the opponent's turn the board is locked and its swap plays
//     through the same animated board so the player watches it move;
//   • damage / mana / EXTRA TURN! floats ride the arcade FX styles;
//   • the ability row is reserved (hidden) for B3;
//   • the result screen names the winner and the stake, and one Continue
//     closes the screen — back to the map, no leftover board state.
//
// The opponent is a placeholder here: a (seeded) random legal swap after a
// short human-like delay. B4 (#249) swaps `opponentSwap` for the skill-based
// `chooseBattleMove` without touching this file's rules-blind plumbing.
// ══════════════════════════════════════════════════════════════════════════
import { CELL, RES, mulberry32, type ResKey } from "./config";
import { GEM_ART } from "./gem-art";
import { BOARD_ANIMATION_MS, type FxType, type Gem } from "./board";
import {
  createBattle, type AbilityOutcome, type Battle, type BattleMove, type BattleSeat, type TurnOutcome,
} from "./battle";
import { GEM_TO_CARGO } from "../iso/quarry";
import {
  BATTLE_ABILITIES, BATTLE_ABILITY_ORDER, BATTLE_RULES, CARGO, CARGOES,
  type BattleRules, type Cargo,
} from "../iso/config";

export interface BattleContenderView {
  id: string;
  name: string;
  /** Portrait URL (tycoon mugshot), or null/absent for a name monogram. */
  portrait?: string | null;
  /** B3 (#248) — the map depots this seat holds (ability ownership gates). */
  depots?: Cargo[];
}

export interface BattleScreenResult {
  winner: BattleSeat | null;
  over: boolean;
  /** "win" for the local seat, "lose", or "draw". */
  verdict: "win" | "lose" | "draw";
}

export interface BattleScreenOptions {
  battle: Battle;
  contenders: [BattleContenderView, BattleContenderView];
  /** Which seat the local hand plays. Default 0 (left). */
  seat?: BattleSeat;
  /** The result screen's stake line ("what was at stake"). */
  stake?: string;
  /**
   * Playtest (2026-09): what happens on the MAP for each verdict, in one short
   * line on the result card ("You can now build a Depot at the Farm").
   */
  consequence?: { win?: string; lose?: string; draw?: string };
  /** B4 plugs the rival policy in here. Default: a seeded random legal swap. */
  opponentSwap?: (battle: Battle) => [number, number, number, number] | null;
  /**
   * B4 (#249) — the rival's full policy: a swap OR an ability cast (the
   * `battle-ai` shape). Supersedes `opponentSwap` when present; may decide
   * asynchronously (the policy's shadow plies are real engine plays).
   */
  opponentMove?: (battle: Battle) => BattleMove | null | Promise<BattleMove | null>;
  /** How long the opponent "thinks" first. Default 900ms. */
  opponentDelayMs?: number;
  /**
   * B6 (#251) — a multiplayer duel. Present = the opponent's moves arrive
   * from OUTSIDE (the host's authority / the guest's replay, via
   * `runExternal`), so no policy is scheduled. `submit` present = the local
   * hand does not play either: its moves go to the host, and the board only
   * moves when the host's log comes back (the guest).
   */
  remote?: { submit?: (move: BattleMove) => void };
  /** B6: a LOCAL move landed on this engine (the host publishes on it). */
  onLocalMove?: (move: BattleMove) => void;
  onClose: (result: BattleScreenResult) => void;
}

export interface BattleScreenHandle {
  root: HTMLElement;
  /** The engine behind the screen — probes read state, never rules. */
  battle: Battle;
  /** Take the screen down now (an explicit close button / host order). */
  destroy(): void;
  /**
   * B6 (#251): run moves that did not come from the local hand (a validated
   * guest move on the host, the host's log replayed on the guest, a timed-out
   * turn's auto-play, a forfeit), then repaint turn / HUD / result from the
   * engine. The engine is the truth; the screen only follows it.
   */
  runExternal<T>(fn: () => Promise<T> | T): Promise<T>;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const gemArtUrl = (res: ResKey): string | null => GEM_ART[GEM_TO_CARGO[res]] ?? null;
const gemFaceCss = (res: ResKey): string =>
  `radial-gradient(circle at 34% 28%, ${RES[res].c2}, ${RES[res].c1})`;

/** Mirror of ui.ts's `styleGem` — one gem look across quarry and battle. */
function styleGem(elem: HTMLElement, g: Gem): void {
  const face = elem.querySelector(".face") as HTMLElement;
  const icon = elem.querySelector(".icon") as HTMLElement;
  const badge = elem.querySelector(".badge") as HTMLElement;
  const keep = ["dragging", "yielding", "gliding", "settle", "shake", "falling"]
    .filter((c) => elem.classList.contains(c));
  elem.className = "gem res-" + g.res;
  for (const c of keep) elem.classList.add(c);
  elem.dataset.res = g.res;
  elem.dataset.tier = String(g.tier);
  face.removeAttribute("style");
  face.className = "face";
  icon.className = "icon";
  icon.textContent = "";
  badge.className = "badge";
  badge.textContent = "";
  if (g.block) {
    elem.classList.add("block");
    return;
  }
  if (g.special === "bomb") {
    elem.classList.add("bomb");
    icon.textContent = "💣";
    icon.className = "icon bombic";
    return;
  }
  const url = gemArtUrl(g.res);
  if (url) {
    face.classList.add("sprite");
    face.style.backgroundImage = `url("${url}")`;
  } else {
    face.style.background = gemFaceCss(g.res);
  }
  if (g.res === "gold") elem.classList.add("gold");
  if (g.tier > 0) {
    elem.classList.add("token");
    badge.textContent = String(g.tier);
    badge.classList.add("show", `t${g.tier}`);
  }
  if (g.hard === 2) elem.classList.add("hard2");
  else if (g.hard === 1) elem.classList.add("hard1");
}

/**
 * A seeded random legal swap (B2's placeholder opponent). Enumerates every
 * legal swap the same dry-run the board's oracle uses, then draws one from a
 * stream seeded by the battle seed + moves played — deterministic for a given
 * battle, never `Math.random`. Null only on a dead board.
 */
export function randomLegalSwap(battle: Battle): [number, number, number, number] | null {
  const b = battle.board;
  const matches: [number, number, number, number][] = [];
  const legal: [number, number, number, number][] = [];
  for (let r = 0; r < b.h; r++) {
    for (let c = 0; c < b.w; c++) {
      const a = b.grid[r][c];
      if (!a || a.block) continue;
      for (const [dr, dc] of [[0, 1], [1, 0]] as const) {
        const r2 = r + dr, c2 = c + dc;
        const d = b.grid[r2]?.[c2];
        if (!d || d.block) continue;
        if (a.special === "bomb" || d.special === "bomb") {
          legal.push([r, c, r2, c2]);
          continue;
        }
        if (a.res === d.res) continue;
        b.grid[r][c] = d;
        b.grid[r2][c2] = a;
        const ok = b.findGroups().length > 0;
        b.grid[r][c] = a;
        b.grid[r2][c2] = d;
        if (ok) {
          matches.push([r, c, r2, c2]);
          legal.push([r, c, r2, c2]);
        }
      }
    }
  }
  if (!legal.length) return null;
  // bombs stay a fallback, as in `Board.findMove` — a real match first
  const pool = matches.length ? matches : legal;
  const rng = mulberry32((battle.seed ^ 0x9e3779b9) + battle.moves.length * 7);
  return pool[Math.floor(rng() * pool.length)];
}

export function openBattleScreen(opts: BattleScreenOptions): BattleScreenHandle {
  const { battle, onClose } = opts;
  const mySeat: BattleSeat = opts.seat ?? 0;
  const oppSeat: BattleSeat = mySeat === 0 ? 1 : 0;
  const opponentDelayMs = opts.opponentDelayMs ?? 900;
  const me = battle.state.players[mySeat];
  const opp = battle.state.players[oppSeat];
  const rules: BattleRules = battle.rules ?? BATTLE_RULES;

  // ── the shell ────────────────────────────────────────────────────────────
  const root = h("div", "battle-root");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Battle");
  const card = h("div", "battle-card");
  root.appendChild(card);

  const sideHtml = (v: BattleContenderView) => `
    <div class="battle-portrait">${v.portrait ? `<img src="${v.portrait}" alt="">` : `<span>${v.name.slice(0, 1)}</span>`}</div>
    <div class="battle-who">
      <div class="battle-name">${v.name}</div>
      <div class="battle-health"><div class="battle-health-fill"></div><span class="battle-health-num"></span></div>
      <div class="battle-mana">${CARGOES.map((c) => `
        <div class="battle-mana-chip" data-cargo="${c}" title="${CARGO[c].name}">
          <span class="bm-ic">${CARGO[c].icon}</span>
          <div class="battle-mana-bar"><div class="battle-mana-fill"></div></div>
          <span class="battle-mana-num">0</span>
        </div>`).join("")}
      </div>
    </div>`;

  // Playtest (2026-09): Puzzle-Quest layout — you on the left, the shared
  // board in the middle, the rival on the right; the card is one screen tall
  // and never scrolls (the board scales to the centre column's box). On a
  // phone the grid areas fold into a compact strip on top (styles.css).
  card.classList.add("battle-pq");
  const center = h("div", "battle-center");
  const side0 = h("div", `battle-side s-${mySeat} mine`);
  side0.innerHTML = sideHtml(opts.contenders[mySeat]);
  const mid = h("div", "battle-mid");
  mid.innerHTML = `
    <div class="battle-vs">VS</div>
    <div class="battle-turn" data-turn="you">YOUR TURN</div>
    <div class="battle-timer"><div class="battle-timer-fill"></div></div>`;
  const side1 = h("div", `battle-side s-${oppSeat}`);
  side1.innerHTML = sideHtml(opts.contenders[oppSeat]);
  card.append(side0, center, side1);
  center.appendChild(mid);

  const boardWrap = h("div", "board-wrap battle-board");
  const grid = h("div", "grid");
  boardWrap.appendChild(grid);
  center.appendChild(boardWrap);

  // B3 (#248) — the ability buttons (the row B2 kept hidden until now).
  const abilityRow = h("div", "battle-abilities");
  for (const id of BATTLE_ABILITY_ORDER) {
    const def = BATTLE_ABILITIES[id];
    const btn = h("button", "battle-ability");
    btn.type = "button";
    btn.dataset.ability = id;
    btn.title = def.desc;
    btn.innerHTML = `
      <span class="ba-name">${def.name}</span>
      <span class="ba-cost">${(Object.entries(def.cost) as [Cargo, number][]).map(([c, n]) =>
        `<span class="ba-chip" data-cargo="${c}" title="${CARGO[c].name}">${CARGO[c].icon}${n}</span>`).join("")}</span>
      <span class="ba-reason"></span>`;
    abilityRow.appendChild(btn);
  }
  card.appendChild(abilityRow);

  const foot = h("div", "battle-foot", "<span class=\"battle-hint\"></span>");
  center.appendChild(foot);

  const result = h("div", "battle-result hidden");
  card.appendChild(result);

  document.body.appendChild(root);

  // ── HUD painting ─────────────────────────────────────────────────────────
  const sideEls = [side0, side1];
  const paintSide = (seat: BattleSeat) => {
    const p = battle.state.players[seat];
    const el = sideEls[seat];
    const fill = el.querySelector(".battle-health-fill") as HTMLElement;
    const num = el.querySelector(".battle-health-num") as HTMLElement;
    const pct = Math.max(0, (p.health / rules.startHealth) * 100);
    fill.style.width = pct + "%";
    num.textContent = `${p.health}`;
    el.classList.toggle("low", p.health * 4 <= rules.startHealth);
    for (const cargo of CARGOES) {
      const chip = el.querySelector(`.battle-mana-chip[data-cargo="${cargo}"]`) as HTMLElement;
      const mfill = chip.querySelector(".battle-mana-fill") as HTMLElement;
      const mnum = chip.querySelector(".battle-mana-num") as HTMLElement;
      const v = p.mana[cargo] ?? 0;
      mfill.style.width = ((v / Math.max(1, rules.manaCap)) * 100) + "%";
      mnum.textContent = String(v);
      chip.classList.toggle("full", v >= rules.manaCap);
    }
    el.classList.toggle("turn", battle.state.turn === seat && !battle.state.over);
    el.classList.toggle("extra", p.extraTurn && battle.state.turn === seat && !battle.state.over);
  };

  const turnEl = mid.querySelector(".battle-turn") as HTMLElement;
  const timerFill = mid.querySelector(".battle-timer-fill") as HTMLElement;
  const hintEl = foot.querySelector(".battle-hint") as HTMLElement;

  let timerHandle = 0;
  let timerStart = 0;
  const paintTurn = () => {
    const mine = battle.state.turn === mySeat;
    turnEl.textContent = battle.state.over ? "BATTLE OVER"
      : mine ? "YOUR TURN" : `${opp.name.toUpperCase()}'S TURN`;
    turnEl.dataset.turn = mine ? "you" : "them";
    hintEl.textContent = battle.state.over ? ""
      : mine ? "Swap two neighbouring gems — matches bank mana, bombs deal damage. Abilities spend mana."
      : `${opp.name} is making a move…`;
    paintSide(0); paintSide(1);
    paintAbilities();
  };

  /** The turn timer is display here (B6's host enforces it). */
  const restartTimer = () => {
    window.clearInterval(timerHandle);
    timerStart = Date.now();
    timerFill.style.width = "100%";
    timerHandle = window.setInterval(() => {
      const t = 1 - (Date.now() - timerStart) / rules.turnMs;
      timerFill.style.width = Math.max(0, Math.min(100, t * 100)) + "%";
      if (t <= 0) window.clearInterval(timerHandle);
    }, 250);
  };

  // ── B3 (#248) — ability buttons: ready / locked-with-reason / broke / cooling ──
  const paintAbilities = () => {
    const mine = battle.state.turn === mySeat && !battle.state.over;
    for (const btn of Array.from(abilityRow.querySelectorAll<HTMLButtonElement>(".battle-ability"))) {
      const id = btn.dataset.ability ?? "";
      const def = BATTLE_ABILITIES[id as keyof typeof BATTLE_ABILITIES];
      const reason = btn.querySelector(".ba-reason") as HTMLElement;
      // The check runs as the LOCAL seat even mid-opponent-turn, so a locked
      // ability stays honestly labelled with its reason at all times.
      const check = battle.canUse(id, mySeat);
      let cls = "battle-ability";
      let label = def.desc;
      if (check.ok && mine) {
        cls += " ready";
      } else if (check.ok) {
        cls += " waiting";
        label = battle.state.over ? def.desc : "Waits for your turn";
      } else if (check.reason === "owner" && def.requires) {
        cls += " locked";
        label = `Needs the ${CARGO[def.requires].name} depot`;
      } else if (check.reason === "mana" && check.need) {
        cls += " poor";
        const miss = Object.entries(check.need) as [Cargo, number][];
        label = `Short ${miss.map(([c, n]) => `${n} ${CARGO[c].name}`).join(", ")} mana`;
      } else if (check.reason === "cooldown") {
        cls += " cooling";
        label = (check.readyIn ?? 1) <= 1 ? "Ready next turn" : `Ready in ${check.readyIn} turns`;
      } else {
        cls += " locked";
        label = battle.state.over ? def.desc : "Unavailable";
      }
      btn.className = cls;
      btn.disabled = !check.ok || !mine;
      reason.textContent = label;
    }
  };

  // ── board rendering (the quarry's gem motion, on the battle board) ───────
  const gemEls = new Map<number, HTMLElement>();
  grid.style.width = CELL * battle.board.w + "px";
  grid.style.height = CELL * battle.board.h + "px";
  grid.style.setProperty("--gem", (CELL - 6) + "px");

  const fitBoard = () => {
    // The centre column's own box, minus the turn line and the hint: the
    // board fills what is left and never pushes the card into a scroll.
    const cw = center.clientWidth, ch = center.clientHeight;
    const pad = 24;
    const availW = cw > 100 ? cw - 14 : Math.max(160, window.innerWidth - pad * 2);
    const availH = ch > 100 ? ch - mid.offsetHeight - foot.offsetHeight - 22 : Math.max(160, window.innerHeight - 300);
    const bw = CELL * battle.board.w, bh = CELL * battle.board.h;
    const k = Math.min(1, availW / bw, availH / bh);
    grid.style.transformOrigin = "top left";
    grid.style.transform = k < 1 ? `scale(${k})` : "";
    boardWrap.style.width = k < 1 ? `${bw * k + 10}px` : "";
    // The scaled grid keeps its layout box; size the frame to what is SHOWN
    // so the card never overflows (it used to cut the last row off).
    boardWrap.style.height = k < 1 ? `${bh * k + 10}px` : "";
    boardWrap.style.overflow = "hidden";
  };

  const reduceMotion = typeof matchMedia === "function"
    && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const fxLayer = grid;
  const showFloat = (text: string, big = false) => {
    const f = h("div", `combo-float${big ? " cf-big" : ""}`, text);
    boardWrap.appendChild(f);
    window.setTimeout(() => f.remove(), big ? 950 : 750);
  };

  const spawnFx = (type: FxType, r: number, c: number, text?: string) => {
    const e = h("div", `fx fx-${type}`);
    e.style.left = (c * CELL + CELL / 2) + "px";
    e.style.top = (r * CELL + CELL / 2) + "px";
    if (text) e.textContent = text;
    fxLayer.appendChild(e);
    window.setTimeout(() => e.remove(), 700);
  };

  const renderBoard = () => {
    const present = new Set<number>();
    for (const g of battle.board.gems()) {
      present.add(g.id);
      let elem = gemEls.get(g.id);
      const x = g.c * CELL + 3, y = g.r * CELL + 3;
      if (!elem) {
        elem = document.createElement("button");
        elem.className = "gem";
        (elem as HTMLButtonElement).type = "button";
        elem.innerHTML = `<div class="face"></div><span class="icon"></span><span class="badge"></span>`;
        elem.dataset.id = String(g.id);
        elem.dataset.r = String(g.r);
        elem.dataset.c = String(g.c);
        if (g.isNew && !reduceMotion) {
          elem.style.transform = `translate(${x}px, ${y - CELL * 3}px)`;
          grid.appendChild(elem);
          gemEls.set(g.id, elem);
          styleGem(elem, g);
          const el = elem;
          el.style.setProperty("--fall-ms", `${BOARD_ANIMATION_MS.fall}ms`);
          el.classList.add("falling");
          requestAnimationFrame(() => {
            el.style.transform = `translate(${x}px, ${y}px)`;
            window.setTimeout(() => {
              el.classList.remove("falling");
              el.style.removeProperty("--fall-ms");
            }, BOARD_ANIMATION_MS.fall + 40);
          });
        } else {
          elem.style.transform = `translate(${x}px, ${y}px)`;
          grid.appendChild(elem);
          gemEls.set(g.id, elem);
          styleGem(elem, g);
        }
      } else {
        const oldR = Number(elem.dataset.r), oldC = Number(elem.dataset.c);
        const dist = g.r - oldR;
        const fell = !reduceMotion && oldC === g.c && dist > 0;
        elem.dataset.r = String(g.r);
        elem.dataset.c = String(g.c);
        elem.style.transform = `translate(${x}px, ${y}px)`;
        styleGem(elem, g);
        if (fell) {
          const fallMs = BOARD_ANIMATION_MS.fall;
          elem.style.setProperty("--fall-ms", `${Math.min(fallMs, 45 + dist * 25)}ms`);
          elem.classList.add("falling");
          const el = elem;
          window.setTimeout(() => {
            el.classList.remove("falling");
            el.style.removeProperty("--fall-ms");
          }, fallMs + 40);
        }
      }
      g.isNew = false;
    }
    gemEls.forEach((elem, id) => {
      if (!present.has(id)) {
        elem.classList.add("gone");
        const el = elem;
        window.setTimeout(() => el.remove(), BOARD_ANIMATION_MS.clear);
        gemEls.delete(id);
      }
    });
  };

  // the engine's board wires — the screen IS the board's face
  battle.board.onChange = renderBoard;
  battle.board.onFx = (type, r, c, text) => spawnFx(type, r, c, text);

  // ── input: tap-tap and drag-release (the quarry's gesture) ───────────────
  type Cell = { r: number; c: number };
  let selected: Cell | null = null;
  let inputLocked = true; // unlocked only on the local seat's turn
  const lockInput = (locked: boolean) => {
    inputLocked = locked;
    grid.classList.toggle("locked", locked);
  };

  const renderSelection = () => {
    gemEls.forEach((elem) => elem.classList.remove("sel", "neighbor"));
    if (!selected) return;
    const g = battle.board.grid[selected.r]?.[selected.c];
    if (!g) return;
    gemEls.get(g.id)?.classList.add("sel");
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const n = battle.board.grid[selected.r + dr]?.[selected.c + dc];
      if (n && !n.block) gemEls.get(n.id)?.classList.add("neighbor");
    }
  };

  const cellFromEvent = (e: Event): Cell | null => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".gem");
    return b?.dataset.r && b?.dataset.c
      ? { r: Number(b.dataset.r), c: Number(b.dataset.c) }
      : null;
  };

  let busy = false;
  const commit = async (from: Cell, to: Cell) => {
    if (busy || inputLocked || battle.state.over) return;
    selected = null;
    renderSelection();
    const move: BattleMove = { t: "swap", r1: from.r, c1: from.c, r2: to.r, c2: to.c };
    if (opts.remote?.submit) { submitRemote(move); return; }
    busy = true;
    const out = await battle.playSwap(from.r, from.c, to.r, to.c, Date.now());
    busy = false;
    if (out.ok) opts.onLocalMove?.(move);
    afterOutcome(out);
  };

  const selectOrSwap = (cell: Cell) => {
    if (inputLocked || battle.state.over || busy) return;
    if (selected && (Math.abs(selected.r - cell.r) + Math.abs(selected.c - cell.c)) === 1) {
      void commit(selected, cell);
      return;
    }
    const g = battle.board.grid[cell.r]?.[cell.c];
    selected = g && !g.block ? cell : null;
    renderSelection();
  };

  grid.addEventListener("click", (e) => {
    if (swallowClick) { swallowClick = false; return; }
    const cell = cellFromEvent(e);
    if (cell) selectOrSwap(cell);
  });

  // drag-on-release, axis-locked (TACTILE-01's rule, the battle's copy)
  const DRAG_START_PX = 5;
  const COMMIT_PX = CELL * 0.5;
  interface Drag {
    from: Cell; el: HTMLElement; gemId: number; pointerId: number;
    x0: number; y0: number; active: boolean; peer: HTMLElement | null;
    horiz: boolean; pull: number; to: Cell | null; open: boolean;
  }
  let drag: Drag | null = null;
  let swallowClick = false;

  const toLocal = () =>
    (CELL * battle.board.w) / (grid.getBoundingClientRect().width || CELL * battle.board.w);
  const baseOf = (el: HTMLElement): [number, number] =>
    [Number(el.dataset.c) * CELL + 3, Number(el.dataset.r) * CELL + 3];
  const offsetOf = (el: HTMLElement): [number, number] => {
    const [x = "0", y = "0"] = el.style.translate.split(" ");
    return [parseFloat(x) || 0, parseFloat(y) || 0];
  };
  const setOffset = (el: HTMLElement, horiz: boolean, px: number) => {
    el.style.translate = horiz ? `${px}px 0px` : `0px ${px}px`;
  };
  const glide = (el: HTMLElement, sx: number, sy: number) => {
    el.classList.remove("dragging", "yielding");
    const [bx, by] = baseOf(el);
    el.style.transition = "none";
    el.style.transform = `translate(${bx}px, ${by}px)`;
    el.style.translate = `${sx - bx}px ${sy - by}px`;
    void el.offsetWidth;
    el.style.transition = "";
    el.classList.add("gliding");
    el.style.translate = "";
    window.setTimeout(() => el.classList.remove("gliding"), BOARD_ANIMATION_MS.swap);
  };
  const releaseGems = (d: Drag, act: () => void) => {
    const els = d.peer ? [d.el, d.peer] : [d.el];
    const seen = els.map((el) => {
      const [bx, by] = baseOf(el), [tx, ty] = offsetOf(el);
      return [bx + tx, by + ty] as const;
    });
    act();
    els.forEach((el, i) => glide(el, seen[i][0], seen[i][1]));
  };

  grid.addEventListener("pointerdown", (e) => {
    if (drag) { cancelDrag(); swallowClick = true; return; }
    if (inputLocked || busy || battle.state.over) return;
    if ((e as PointerEvent).button !== 0) return;
    const from = cellFromEvent(e);
    const g = from ? battle.board.grid[from.r]?.[from.c] : null;
    const el = g ? gemEls.get(g.id) : undefined;
    if (!from || !g || !el || g.block) return;
    el.classList.remove("gliding");
    el.classList.add("dragging");
    drag = {
      from, el, gemId: g.id, pointerId: (e as PointerEvent).pointerId,
      x0: (e as PointerEvent).clientX, y0: (e as PointerEvent).clientY,
      active: false, peer: null, horiz: true, pull: 0, to: null, open: false,
    };
  });

  grid.addEventListener("pointermove", (e) => {
    const pe = e as PointerEvent;
    if (!drag || pe.pointerId !== drag.pointerId) return;
    const rect = grid.getBoundingClientRect();
    if (rect.width > 0 && (pe.clientX < rect.left || pe.clientX > rect.right
      || pe.clientY < rect.top || pe.clientY > rect.bottom)) {
      cancelDrag();
      swallowClick = true;
      return;
    }
    const dx = pe.clientX - drag.x0, dy = pe.clientY - drag.y0;
    if (!drag.active && Math.hypot(dx, dy) < DRAG_START_PX) return;
    const k = toLocal();
    if (!drag.active) {
      drag.active = true;
      try { grid.setPointerCapture(pe.pointerId); } catch { /* synthetic */ }
    }
    const horiz = Math.abs(dx) >= Math.abs(dy);
    const pull = (horiz ? dx : dy) * k;
    const dir = Math.sign(pull);
    const to = { r: drag.from.r + (horiz ? 0 : dir), c: drag.from.c + (horiz ? dir : 0) };
    const tg = dir ? battle.board.grid[to.r]?.[to.c] : null;
    const open = !!tg && !tg.block;
    drag.horiz = horiz; drag.pull = pull; drag.to = to; drag.open = open;
    const peer = open ? gemEls.get(tg.id) ?? null : null;
    if (peer !== drag.peer) {
      if (drag.peer) { drag.peer.style.translate = ""; drag.peer.classList.remove("yielding"); }
      drag.peer = peer;
      peer?.classList.add("yielding");
    }
    const travel = open ? Math.min(Math.abs(pull), CELL) * 0.8 : Math.min(Math.abs(pull) * 0.15, 10);
    setOffset(drag.el, horiz, dir * travel);
    if (peer) setOffset(peer, horiz, -dir * travel * 0.45);
  });

  const commitDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    if (!d.active) {
      d.el.classList.remove("dragging");
      return;
    }
    swallowClick = true;
    const held = battle.board.grid[d.from.r]?.[d.from.c];
    const doCommit = d.open && d.to !== null && Math.abs(d.pull) >= COMMIT_PX
      && held?.id === d.gemId;
    if (!doCommit || !d.to) {
      releaseGems(d, () => {});
      return;
    }
    const to = d.to;
    releaseGems(d, () => { void commit(d.from, to); });
  };
  function cancelDrag() {
    const d = drag;
    drag = null;
    if (!d) return;
    if (!d.active) {
      d.el.classList.remove("dragging");
      return;
    }
    releaseGems(d, () => {});
  }
  const cancelDragEvent = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    cancelDrag();
    swallowClick = true;
  };
  window.addEventListener("pointerup", commitDrag);
  window.addEventListener("pointercancel", cancelDragEvent);
  window.addEventListener("resize", fitBoard);
  const centerObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => fitBoard()) : null;
  centerObserver?.observe(center);

  // ── the turn loop ────────────────────────────────────────────────────────
  let oppTimer = 0;
  let destroyed = false;
  /**
   * B5 (#250): the close contract — `onClose` fires exactly ONCE, from
   * `destroy()`, whatever tears the screen down. A normal finish stores its
   * result (the Continue button) first; a force-close reports
   * `over: false` so the caller can tell "played out" from "torn down".
   */
  let finalResult: BattleScreenResult | null = null;
  let resultShown = false;
  /** Moves the screen has painted — `runExternal` restarts the clock on growth. */
  let seenMoves = battle.moves.length;

  const afterOutcome = (out: TurnOutcome) => {
    if (destroyed) return;
    seenMoves = battle.moves.length;
    paintTurn();
    restartTimer();
    if (out.damage > 0) showFloat(`−${out.damage} 💥`, true);
    const gains = Object.entries(out.mana) as [Cargo, number][];
    if (gains.length) {
      const [cargo, n] = gains.sort((a, b) => b[1] - a[1])[0];
      showFloat(`+${n} ${CARGO[cargo].icon}`);
    }
    if (out.extraTurn && !battle.state.over) showFloat("EXTRA TURN!", true);
    if (battle.state.over) {
      window.setTimeout(showResult, 700);
      return;
    }
    if (battle.state.turn === oppSeat) scheduleOpponent();
    else lockInput(false);
  };

  // ── B3 (#248) — casting ─────────────────────────────────────────────────
  const abilityName = (id: string): string =>
    BATTLE_ABILITIES[id as keyof typeof BATTLE_ABILITIES]?.name ?? id;

  const afterAbility = (out: AbilityOutcome) => {
    if (destroyed) return;
    seenMoves = battle.moves.length;
    paintTurn();
    restartTimer();
    showFloat(`${abilityName(out.id).toUpperCase()}!`, true);
    if (out.damage > 0) showFloat(`−${out.damage} 💥`, true);
    if (out.heal > 0) showFloat(`+${out.heal} ♥`, true);
    const stolenTotal = (Object.values(out.stolen) as number[]).reduce((s, n) => s + n, 0);
    if (stolenTotal > 0) showFloat(`+${stolenTotal} ${CARGO.gold.icon} mana`, true);
    if (out.frozen > 0) showFloat(`${out.frozen} gems frozen ❄`);
    if (out.girders > 0) showFloat(`${out.girders} girders`);
    if (out.smog > 0) showFloat("SMOG!", true);
    if (battle.state.over) {
      window.setTimeout(showResult, 700);
      return;
    }
    if (battle.state.turn === oppSeat) scheduleOpponent();
    else lockInput(false);
  };

  abilityRow.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".battle-ability");
    if (!btn || destroyed || busy || battle.state.over) return;
    if (battle.state.turn !== mySeat) return;
    const id = btn.dataset.ability ?? "";
    if (!battle.canUse(id).ok) { paintAbilities(); return; }
    if (opts.remote?.submit) { submitRemote({ t: "ability", id, seat: mySeat }); return; }
    busy = true;
    void battle.useAbility(id).then((out) => {
      busy = false;
      if (destroyed) return;
      if (out.ok) {
        opts.onLocalMove?.({ t: "ability", id, seat: mySeat });
        afterAbility(out);
      } else paintAbilities();
    });
  });

  // ── B6 (#251) — the remote seat ──────────────────────────────────────────
  /** The guest's move is in flight: input stays locked until the host's log
   *  grows past `awaitingAt` (runExternal) or the host stays silent (refused). */
  let awaitingAt = -1;
  let awaitTimer = 0;
  const submitRemote = (move: BattleMove) => {
    lockInput(true);
    awaitingAt = battle.moves.length;
    window.clearTimeout(awaitTimer);
    awaitTimer = window.setTimeout(() => {
      if (destroyed || battle.moves.length > awaitingAt) return;
      awaitingAt = -1;                      // refused: the turn is still ours
      lockInput(battle.state.over || battle.state.turn !== mySeat);
    }, 3000);
    opts.remote!.submit!(move);
  };

  const runExternal = async <T,>(fn: () => Promise<T> | T): Promise<T> => {
    try {
      return await fn();
    } finally {
      if (!destroyed) {
        if (battle.moves.length !== seenMoves) {
          seenMoves = battle.moves.length;
          restartTimer();
          awaitingAt = -1;
          window.clearTimeout(awaitTimer);
        }
        paintTurn();
        if (battle.state.over) {
          if (!resultShown) window.setTimeout(showResult, 700);
        } else if (awaitingAt < 0) lockInput(battle.state.turn !== mySeat);
      }
    }
  };

  const scheduleOpponent = () => {
    lockInput(true);
    if (opts.remote) return;                // B6: the far seat moves via runExternal
    window.clearTimeout(oppTimer);
    // B4: the delay is the rival's "think time" — short and human-paced so
    // the player can follow the move (the acceptance playtest note).
    oppTimer = window.setTimeout(() => {
      if (destroyed || battle.state.over) return;
      void (async () => {
        const mv: BattleMove | null = opts.opponentMove
          ? await opts.opponentMove(battle)
          : (() => {
              const m = (opts.opponentSwap ?? randomLegalSwap)(battle);
              return m ? { t: "swap", r1: m[0], c1: m[1], r2: m[2], c2: m[3] } : null;
            })();
        if (destroyed) return;
        if (!mv) {
          // a dead board mid-game: the engine reshuffles on its own; retry
          await battle.ensureMove();
          if (!destroyed && !battle.state.over) scheduleOpponent();
          return;
        }
        if (mv.t === "ability") {
          const out = await battle.useAbility(mv.id);
          if (out.ok) afterAbility(out);
          else if (!destroyed && !battle.state.over) scheduleOpponent();
          return;
        }
        const out = await battle.playSwap(mv.r1, mv.c1, mv.r2, mv.c2, Date.now());
        if (out.ok) afterOutcome(out);
        else if (!destroyed && !battle.state.over) scheduleOpponent();
      })();
    }, opponentDelayMs);
  };

  const showResult = () => {
    if (destroyed || resultShown) return;
    resultShown = true;
    lockInput(true);
    const w = battle.state.winner;
    const verdict: BattleScreenResult["verdict"] =
      w === null ? "draw" : w === mySeat ? "win" : "lose";
    result.classList.remove("hidden");
    result.innerHTML = `
      <div class="battle-result-card">
        <h2 class="battle-verdict v-${verdict}">${
          verdict === "win" ? "VICTORY" : verdict === "lose" ? "DEFEAT" : "DRAW"}</h2>
        <p class="battle-stake">${opts.stake ? `At stake: ${opts.stake}` : ""}</p>
        <p class="battle-summary"></p>
        <p class="battle-consequence"></p>
        <button type="button" class="btn battle-continue">Continue</button>
      </div>`;
    const summary = result.querySelector(".battle-summary") as HTMLElement;
    summary.textContent =
      verdict === "win" ? `${me.name} takes it — ${opp.name} is beaten back.`
      : verdict === "lose" ? `${opp.name} wins the field this time.`
      : "Both sides hold.";
    const cons = verdict === "win" ? opts.consequence?.win
      : verdict === "lose" ? opts.consequence?.lose : opts.consequence?.draw;
    (result.querySelector(".battle-consequence") as HTMLElement).textContent = cons ?? "";
    (result.querySelector(".battle-continue") as HTMLButtonElement).onclick = () => {
      finalResult = { winner: w, over: true, verdict };
      destroy();
    };
  };

  // ── boot the screen ──────────────────────────────────────────────────────
  renderBoard();
  paintTurn();
  restartTimer();
  fitBoard();
  if (battle.state.over) showResult();
  else if (battle.state.turn === oppSeat) scheduleOpponent();
  else lockInput(false);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    window.clearTimeout(oppTimer);
    window.clearTimeout(awaitTimer);
    window.clearInterval(timerHandle);
    window.removeEventListener("pointerup", commitDrag);
    window.removeEventListener("pointercancel", cancelDragEvent);
    window.removeEventListener("resize", fitBoard);
    centerObserver?.disconnect();
    battle.board.onChange = () => {};
    battle.board.onFx = () => {};
    gemEls.clear();
    root.remove();
    // no leftover board state: the battle itself is the caller's to drop
    onClose(finalResult ?? { winner: null, over: false, verdict: "draw" });
  }

  return { root, battle, destroy, runExternal };
}

/**
 * Convenience for the debug console and quick fights: build a battle and open
 * the screen on it (the `__iso.startBattle` shape).
 */
export function startBattleScreen(
  seed: number,
  contenders: [BattleContenderView, BattleContenderView],
  opts: Partial<BattleScreenOptions> & { rules?: BattleRules } = {},
): BattleScreenHandle {
  const battle = createBattle({
    seed,
    players: [
      { id: contenders[0].id, name: contenders[0].name, depots: contenders[0].depots },
      { id: contenders[1].id, name: contenders[1].name, depots: contenders[1].depots },
    ],
    rules: opts.rules ?? BATTLE_RULES,
    animate: true,
  });
  return openBattleScreen({
    battle,
    contenders,
    seat: opts.seat,
    stake: opts.stake,
    consequence: opts.consequence,
    opponentSwap: opts.opponentSwap,
    // B4 (#249) review fix: the rival's policy was dropped here, so every map
    // battle and `__iso.startBattle` fought a random-swap bot, not the skill.
    opponentMove: opts.opponentMove,
    remote: opts.remote,
    onLocalMove: opts.onLocalMove,
    opponentDelayMs: opts.opponentDelayMs,
    onClose: opts.onClose ?? (() => {}),
  });
}
