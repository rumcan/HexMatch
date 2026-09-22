// TUT-01 — starting tutorial, new loop only (L15 #230)
// No tokens, no bank, no blessings, no board sabotage. The loop is:
// build road/rail to city/depot, match-3 when building depot sets yield,
// resources tick via yield×distance×road/rail, spend on depot tree + city upgrades.
//
// THE GATE: the tour opens on a first solo game with no save (game.ts owns
// the save/seat half of that) and never again once the player has pressed
// "Never show this again" — this module owns the storage half
// (`shouldShowTutorial`), with `?tutorial=0/1` overriding for playtests.
// The projector paints the card with the shipped `.tut-*` CSS classes and
// walks it with Back/Next plus one persistent exit; the figure copy is read
// from the authoritative tables, never retyped.
import {
  CARGO, CARGOES, TRANSPORT, VICTORY, TUNING,
} from "./config";
import { DEPOT_COST, costCompact, costLabel } from "./construction";
import { fmtVp } from "./victory";
import { coarsePointer } from "./touch";
import { sfx } from "../audio/sfx";
import { GEM_ART } from "../game/gem-art";
import shotPlant from "../../assets/tutorial/plant.webp";
import shotDepot from "../../assets/tutorial/depot.webp";
import shotRoads from "../../assets/tutorial/roads.webp";
import shotBoard from "../../assets/tutorial/board.webp";
import shotExpand from "../../assets/tutorial/expand.webp";
import shotDesk from "../../assets/tutorial/desk.webp";

export const TUTORIAL_STORAGE_KEY = "hexmatch:tutorial";
export const TUTORIAL_NEVER = "never";

export type TutorialStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const liveStorage = (): TutorialStorage | null =>
  typeof localStorage !== "undefined" ? localStorage : null;

export function isTutorialDismissed(storage: TutorialStorage | null = liveStorage()): boolean {
  try { return storage?.getItem(TUTORIAL_STORAGE_KEY) === TUTORIAL_NEVER; }
  catch { return false; }
}

export function setTutorialDismissed(
  never: boolean, storage: TutorialStorage | null = liveStorage(),
): void {
  if (!storage) return;
  try {
    if (never) storage.setItem(TUTORIAL_STORAGE_KEY, TUTORIAL_NEVER);
    else storage.removeItem(TUTORIAL_STORAGE_KEY);
  } catch { }
}

// ── the gate ──────────────────────────────────────────────────────────────
// `?tutorial=0` sits a boot out (e2e gameplay specs, playtest links);
// `?tutorial=1` asks again even over "never" (a reviewer, a screenshot).
// Anything else defers to the stored preference.
const OFF_VALUES = new Set(["0", "off", "never", "no"]);
const ON_VALUES = new Set(["1", "on", "yes"]);

export function shouldShowTutorial(
  search: string = typeof location !== "undefined" ? location.search : "",
  storage: TutorialStorage | null = liveStorage(),
): boolean {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const flag = (new URLSearchParams(raw).get("tutorial") ?? "").trim().toLowerCase();
  if (OFF_VALUES.has(flag)) return false;
  if (ON_VALUES.has(flag)) return true;
  return !isTutorialDismissed(storage);
}

export interface BoardCell { cargo: import("./config").Cargo | null; hit?: boolean }
export interface TutorialFigureChain { kind: "chain"; nodes: { icon: string; label: string }[]; caption: string }
export interface TutorialFigureShot { kind: "shot"; src: string; alt: string; caption: string }
export interface TutorialFigureBoard { kind: "board"; cells: BoardCell[][]; caption: string }
export interface TutorialFigureLedger { kind: "ledger"; rows: { icon: string; label: string; vp: string }[]; caption: string }
export type TutorialFigure = TutorialFigureChain | TutorialFigureShot | TutorialFigureBoard | TutorialFigureLedger;

export interface TutorialStep {
  id: string;
  kicker: string;
  title: string;
  lede: string;
  figure: TutorialFigure;
  points: string[];
  tip: string;
}

export interface TutorialContext {
  vpTarget: number;
  freeTrack: number;
  newLoop?: boolean;
}

export function buildTutorialSteps(ctx: TutorialContext): TutorialStep[] {
  const coarse = coarsePointer();
  const dirt = costCompact(TRANSPORT.dirt.cost);

  const star = (n: number) => `${fmtVp(n)}★`;
  const allowance = ctx.freeTrack > 0
    ? `, and your setup allowance pays for the first ${ctx.freeTrack} of them`
    : ", and the setup allowance pays for your first tiles";

  return [
    {
      id: "loop",
      kicker: "HEXMATCH INDUSTRIES",
      title: "One island, one loop",
      lede: "You have bought a freight concern on an island with more industry than anyone can carry. Everything feeds one loop:",
      figure: {
        kind: "chain",
        nodes: [
          { icon: "⛰️", label: "Resource node" },
          { icon: "🛖", label: "Depot" },
          { icon: "🛤️", label: "Roads & Rail" },
          { icon: "🏭", label: "Match-3 tuning" },
          { icon: "📦", label: "Yield × distance × road" },
          { icon: "★", label: "Expand" },
        ],
        caption: "Every connected Depot ticks cargo in on the clock — the match-3 session that tunes it decides how fast.",
      },
      points: [
        "A <b>resource node</b> (farm, forest, ore mine, quarry, oil rig, gold mine) makes cargo. A <b>Depot</b> built within its reach picks that cargo up.",
        "Build <b>Dirt Road</b> (free) and <b>Road</b> (faster hauling) and <b>Rail</b> (fastest) to the <b>City</b>. Distance matters — longer lines pay less per tick.",
        "When you build a Depot you play a short <b>match-3 tuning session</b>. Your score sets that Depot's <b>yield</b> — how much it ticks.",
        "Cargo ticks into your <b>purse</b> every clock tick: <b>yield × distanceFactor × transportFactor</b>. Spend it on the depot tree and city upgrades.",
      ],
      tip: `Six cargoes, six gem colours: ${CARGOES.map((c) => `${CARGO[c].icon} ${CARGO[c].name}`).join(" · ")}.`,
    },
    {
      id: "plant",
      kicker: "STEP 1 · THE CITY",
      title: "Your city is the hub",
      lede: "The city is where every depot delivers. Roads and rail all run to it.",
      figure: {
        kind: "shot",
        src: shotPlant,
        alt: "City with depot roads",
        caption: "Every depot needs a road to the city. Distance and road tier decide the payout.",
      },
      points: [
        "The <b>city</b> is the delivery end of every route. Nothing pays until a Depot can reach it by road or rail.",
        "Build <b>Dirt Road</b> (free) and <b>Road</b> (costs, but faster hauling) and later <b>Rail</b> — rail is fastest, but needs platforms.",
        "The inspector tells you a tile's distance factor and transport factor — the two multipliers on every tick.",
      ],
      tip: `Later city upgrades cost cargo and give +${star(VICTORY.loop.city)} each — depth over breadth.`,
    },
    {
      id: "depot",
      kicker: "STEP 2 · COLLECT IT",
      title: "Build a Depot beside a resource node",
      lede: "Build → Depot, then click the ground you want it on.",
      figure: {
        kind: "shot",
        src: shotDepot,
        alt: "A Depot previewed near an ore mine",
        caption: "The shaded square is its 4×4 catchment — the ore mine it reaches is what this Depot collects.",
      },
      points: [
        "A Depot needs an industry inside its <b>4×4 catchment</b> — hover shows the tiles it would take.",
        "<b>One Depot per industry.</b> First to connect keeps it.",
        `Your <b>first Depot is free</b>. Every Depot after it costs ${costLabel(DEPOT_COST)}, and one you cannot pay for is refused without spending.`,
      ],
      tip: "A Depot on open ground with no road claims nothing — it can never lock a node away by accident.",
    },
    {
      id: "roads",
      kicker: "STEP 3 · CONNECT IT",
      title: "Join them with roads and rail",
      lede: "Build → Dirt Road, then drag from the Depot to your City.",
      figure: {
        kind: "shot",
        src: shotRoads,
        alt: "Road joining Depot to City",
        caption: "One continuous run is all it takes: the depot starts ticking the moment it reaches the city.",
      },
      points: [
        `<b>Dirt Road</b> is ${dirt} a tile${allowance}.`,
        "<b>Road</b> is faster hauling (×1.6). <b>Rail</b> is fastest — build a platform at each end, then a line.",
        "Distance falloff: the longer the path, the smaller the <b>distanceFactor</b>. The inspector shows it per depot.",
        "Town ring roads and public highways carry your traffic too.",
      ],
      tip: coarse
        ? "One finger drags a run; a tap lays one tile. + / − / 🎯 zoom and recenter."
        : "Left-drag lays a run. Middle-drag pans, wheel zooms, 🎯 recentres.",
    },
    {
      id: "board",
      kicker: "STEP 4 · TUNE IT",
      title: "Match-3 tunes a Depot",
      lede: "Building a Depot opens the board for a short tuning session — the board is not up otherwise.",
      figure: {
        kind: "shot",
        src: shotBoard,
        alt: "Tuning board open",
        caption: `The plate above the board counts moves and shows the yield your score is worth. Swap two neighbours to line up 3 or more.`,
      },
      points: [
        "A session is <b>bounded</b>: a fixed number of moves. When the last one resolves the board closes.",
        `Every gem you clear is <b>score</b>. The score becomes the Depot's <b>yield level</b> — between ×${TUNING.minYield} and ×${TUNING.maxYield} — and a connected Depot ticks its cargo at exactly that rate.`,
        "<b>5 in a row</b> forges a <b>bomb</b> — swap it to blow that whole colour. Combos and cascades bank bonus points.",
        "Finish keeps the score you have; ✕ abandons and leaves the Depot on the default yield.",
        "<b>Difficulty</b> changes what a yield does over time. <b>Easy</b>: one session per Depot, weak still lands decent, nothing cools. <b>Normal</b>: one more session with each upgrade, yield never drops. <b>Hard</b>: tuned Depot cools, re-match can lower it.",
        "On Normal and Hard the plate offers <b>Retune</b> for your weakest Depot when one is owed.",
      ],
      tip: `🪙 Gold gems only drop while a Depot sits beside a gold mine. Every Depot is tuned once as it is built.`,
    },
    {
      id: "expand",
      kicker: "STEP 5 · SPEND IT",
      title: "Turn cargo into empire",
      lede: "Connected Depots tick cargo into your purse — the chips along the bottom of the screen.",
      figure: {
        kind: "shot",
        src: shotExpand,
        alt: "Purse chips and Feed tab",
        caption: "Your purse runs along the bottom; the Feed tab logs every event.",
      },
      points: [
        "That purse is the only money in the game. It buys Depots, roads, rail, city upgrades and the depot tree.",
        "<b>Ore is the gate.</b> Dirt Road is free, but Road, Rail and the second Depot all want ore.",
        "<b>Feed</b> logs every event of the match, and the inspector answers a hover with what a tile is and what it is worth.",
        `Another <b>City upgrade</b> widens your base rate and gives +${star(VICTORY.loop.city)}.`,
      ],
      tip: "Black Market cards (Blockade, Protest) cost Gold and land on the rival. A Protest ✊ shuts any public road for 2:00 — every truck stops, including yours.",
    },
    {
      id: "victory",
      kicker: "STEP 6 · WIN IT",
      title: "How Victory Points are earned",
      lede: `First to ${ctx.vpTarget}★ wins. Three sources pay under the new loop:`,
      figure: {
        kind: "ledger",
        rows: [
          { icon: "🔷", label: "A depot type running (per distinct cargo)", vp: `+${star(VICTORY.loop.type)}` },
          { icon: "🪜", label: "A depot-tree rung unlocked", vp: `+${star(VICTORY.loop.rung)}` },
          { icon: "🏙️", label: "A city upgrade tier", vp: `+${star(VICTORY.loop.city)}` },
          { icon: "🚉", label: "A railway platform built", vp: `+${star(VICTORY.platform)}` },
        ],
        caption: `Breadth (types) + depth (rungs, city) + network (platforms) = ${ctx.vpTarget}★. Different plans win.`,
      },
      points: [
        `A <b>type</b> is a cargo you have a connected, producing Depot for — ${star(VICTORY.loop.type)} per distinct cargo, revocable if you cut the road.`,
        `A <b>rung</b> is a depot-tree unlock — ${star(VICTORY.loop.rung)} each, never revoked.`,
        `A <b>city tier</b> is a city upgrade — ${star(VICTORY.loop.city)} each, never revoked.`,
        `A <b>platform</b> is a railway platform — +${star(VICTORY.platform)} when built, revoked if demolished.`,
        `The pool is bigger than the line: 6 types (12★) + rungs + city + platforms = many honest routes to ${ctx.vpTarget}★.`,
      ],
      tip: `Roads themselves score nothing — they make your depots tick faster. Dirt is free, Road is faster hauling.`,
    },
    {
      id: "desk",
      kicker: "STEP 7 · THE DESK",
      title: "The map is not the whole game",
      lede: "Gold buys sabotage. The Feed tells you what happened. The inspector tells you what a tile is worth.",
      figure: {
        kind: "shot",
        src: shotDesk,
        alt: "Black Market, Feed, and inspector",
        // #299: on the new loop the plant is no longer a tab — the session
        // owns its own window over the map, and the rail keeps Bank, Feed
        // and the plant's idle card. The retired loop keeps the old strip.
        caption: ctx.newLoop === false
          ? "Right column: Processing Plant and Feed tabs — the board comes up in the plant one while a Depot is being tuned."
          : "Right column: Bank and Feed tabs over the plant's idle card — while a Depot is being tuned, the board comes up in its own session window over the map.",
      },
      points: [
        "<b>Gold</b> 🪙 is earned from gold-mine access or combos. It buys Black Market sabotage only — never construction.",
        "<b>Blockade</b> ⛓ stops an industry's depots for 45s. <b>Protest</b> ✊ shuts any public road for 2:00 — every depot through that tile stops earning, including your own.",
        "<b>Security Forces</b> turn both away — hired with ordinary materials.",
        "The <b>Feed</b> logs every event. The <b>inspector</b> (hover) says what a tile is, its distance factor and its transport factor.",
      ],
      tip: "The rival plays the same loop you do — road/rail to city/depot, tuning sessions for yield, spending on tree + city. No paving-for-points, no plant-for-points, no bank, no blessings.",
    },
  ];
}

export type TutorialCloseReason = "finished" | "dismissed" | "never";
export type TutorialResult = { reason: TutorialCloseReason };
export interface TutorialHandle {
  el: HTMLElement;
  promise: Promise<TutorialResult>;
  close: (reason?: TutorialCloseReason) => void;
  destroy: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

export interface ShowTutorialOptions {
  /** Skip the gate — the ❔ help modal's replay does this on purpose. */
  force?: boolean;
  vpTarget: number;
  freeTrack: number;
  /** The loop the booted game runs — the desk card names its rail. */
  newLoop?: boolean;
  /** Gate overrides for tests/playtests; defaults read the live boot. */
  search?: string;
  storage?: TutorialStorage | null;
  onClose?: (result: TutorialResult) => void;
}

export function showTutorial(
  root: HTMLElement,
  opts: ShowTutorialOptions = { vpTarget: 12, freeTrack: 0 },
): TutorialHandle | null {
  const search = opts.search ?? (typeof location !== "undefined" ? location.search : "");
  const storage = opts.storage === undefined ? liveStorage() : opts.storage;
  // THE GATE (rule 1 of the module header): a remembered "never" or an
  // explicit `?tutorial=0` means no card at all — the caller (game.ts boot,
  // the help modal) renders nothing and hands on to the difficulty prompt.
  if (!opts.force && !shouldShowTutorial(search, storage)) return null;

  const steps = buildTutorialSteps({ vpTarget: opts.vpTarget, freeTrack: opts.freeTrack, newLoop: opts.newLoop });
  let idx = 0;

  // The projector emits the classes the shipped CSS styles (`#iso-tutorial`
  // and the `.tut-*` block in src/game/styles.css) — the plate, the ledger
  // paper, the blueprint figure — and carries the `data-step`/`data-act`
  // hooks the unit and e2e suites walk it by.
  const overlay = el("div", "");
  overlay.id = "iso-tutorial";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const card = el("div", "tut-card");
  const head = el("div", "tut-head");
  const closeBtn = el("button", "tut-x", "✕") as HTMLButtonElement;
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close the tour");
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
  const never = el("button", "tut-never", "Never show this again") as HTMLButtonElement;
  never.type = "button";
  never.dataset.act = "tut-never";
  const spacer = el("span", "tut-spacer");
  const nav = el("div", "tut-nav");
  const prev = el("button", "big-btn ghost", "← Back") as HTMLButtonElement;
  prev.type = "button";
  prev.dataset.act = "tut-prev";
  const next = el("button", "big-btn", "Next →") as HTMLButtonElement;
  next.type = "button";
  next.dataset.act = "tut-next";
  nav.append(prev, next);
  foot.append(never, spacer, nav);

  card.append(head, body, foot);
  overlay.appendChild(card);

  const caption = (text: string) => el("div", "tut-fig-cap", text);

  const renderFigure = (fig: TutorialFigure) => {
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
    } else if (fig.kind === "shot") {
      const img = el("img", "tut-shot") as HTMLImageElement;
      img.src = fig.src;
      img.alt = fig.alt;
      figureEl.append(img, caption(fig.caption));
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
    // Back has nowhere to go on step one; the last step's key is the one
    // that ends the tour (and finishing is NOT dismissing).
    prev.disabled = idx === 0;
    const last = idx === steps.length - 1;
    next.dataset.act = last ? "tut-done" : "tut-next";
    next.textContent = last ? "Start Production →" : "Next →";
  };

  let resolve!: (r: TutorialResult) => void;
  const promise = new Promise<TutorialResult>((res) => { resolve = res; });
  let closed = false;
  const close = (reason: TutorialCloseReason = "dismissed") => {
    if (closed) return;   // the promise settles once, however many doors slam
    closed = true;
    overlay.remove();
    const result: TutorialResult = { reason };
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
  never.onclick = () => { setTutorialDismissed(true, storage); close("never"); };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close("dismissed"); });

  render();
  root.appendChild(overlay);
  sfx.play("open");
  return { el: overlay, promise, close, destroy };
}
