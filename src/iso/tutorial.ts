// ══════════════════════════════════════════════════════════════════════════
// TUT-01 — the starting tutorial: one guided walk through the whole loop.
//
// The ask, verbatim: "we need a starting tutorial that shows you how to play
// the game. Simply showing them how the game works. you build a processing
// plant. you build a depot, you connect them with roads and then you play
// match 3. truck creates resources in you matching board that you use to
// expand. How to gain win points. this should have a never show this again
// button."
//
// The ❔ help modal (`helpModal` in src/game/ui.ts) already re-tells the rules,
// but it is one dense three-column plaque that a first-time player opens by
// accident and closes without reading — and nothing ever puts it in front of
// them. This module is the other shape: a stepped tour that opens over every
// FRESH game and walks the loop in the order the player actually meets it
// (plant → depot → road → board → expand → points → the desk) — until the day
// they press *Never show this again*, after which only the ❔ opens it.
//
// Three rules hold it honest, and they are the same three the rest of the
// codebase runs on:
//
//   1. NO NUMBER IS TYPED TWICE. Every price, ★ value and board dimension in
//      the copy is read from the authoritative table (`BUILD_COSTS` /
//      `VICTORY` / `DEPOT_COST` / `PLANT_COST` / `BOARD_W×H`) at render time,
//      exactly as the Build buttons and the help modal do. A rebalance moves
//      the tutorial with it, which is the W1 invariant applied to prose.
//   2. IT IS DATA, NOT A PHASE. "Has this player asked never to see it again"
//      is one localStorage key (`TUTORIAL_STORAGE_KEY`), never an inference
//      from where the boot happened — the same E8/K1 discipline `freeTrack`
//      and `skill.ts` follow, so no code path can silently un-ask or re-ask.
//   3. PURE CONTENT, SMALL PROJECTOR. `buildTutorialSteps` is a pure function
//      a test can read without a DOM; `showTutorial` is the ~120-line DOM
//      projector beside it (the split `ending.ts` uses). Tests drive the
//      projector in jsdom, e2e drives the real one.
//
// When does it appear? On a FIRST game only — no restored save (a resume
// belongs to a player who is mid-match), a solo seat (a networked match is
// live and the host is waiting), and never once the player has pressed
// *Never show this again*. Skip / ✕ / Esc closes it for the session WITHOUT
// persisting, so the button is the one and only way to make it stay closed —
// that asymmetry is deliberate and is stated on the card itself. `?tutorial=0`
// suppresses it for playtest links and the e2e gameplay specs; `?tutorial=1`
// forces it even when dismissed. The ❔ help modal's *Replay the tour* opens
// it at any time without touching the preference.
// ══════════════════════════════════════════════════════════════════════════
import { BOARD_H, BOARD_W } from "../game/config";
import { BANK_RATE } from "../game/trade";
import {
  CARGO, CARGOES, TRANSPORT, UPGRADE_COST, VICTORY, type Cargo,
} from "./config";
import { DEPOT_COST, costCompact, costLabel } from "./construction";
import { PLANT_COST } from "./plants";
import { fmtVp } from "./victory";
import { sfx } from "../audio/sfx";

// The board figure draws the real painted hex gems, mapped by CARGO name the
// same way ui.ts's GEM_ART does — one set of tokens everywhere, so the tour
// shows the art the player is about to look at rather than a stand-in.
import { GEM_ART } from "../game/gem-art";

// ── the preference ────────────────────────────────────────────────────────
/** One key, one meaning: the player pressed *Never show this again*. */
export const TUTORIAL_STORAGE_KEY = "hexmatch:tutorial";
/** The stored value that means "stay closed". Anything else = show it. */
export const TUTORIAL_NEVER = "never";

export type TutorialStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const liveStorage = (): TutorialStorage | null =>
  typeof localStorage !== "undefined" ? localStorage : null;

/** True when the player has permanently dismissed the tour. */
export function isTutorialDismissed(storage: TutorialStorage | null = liveStorage()): boolean {
  try { return storage?.getItem(TUTORIAL_STORAGE_KEY) === TUTORIAL_NEVER; }
  catch { return false; }
}

/**
 * Write (or clear) the permanent dismissal. `false` removes the key rather
 * than writing another value, so "not dismissed" is the ABSENCE of a record —
 * there is no third state for a future reader to misinterpret.
 */
export function setTutorialDismissed(
  never: boolean, storage: TutorialStorage | null = liveStorage(),
): void {
  if (!storage) return;
  try {
    if (never) storage.setItem(TUTORIAL_STORAGE_KEY, TUTORIAL_NEVER);
    else storage.removeItem(TUTORIAL_STORAGE_KEY);
  } catch { /* private mode: the tour simply returns next boot */ }
}

const OFF_VALUES = new Set(["0", "off", "never", "no"]);
const ON_VALUES = new Set(["1", "on", "yes"]);

/**
 * True when boot should open the tour.
 *
 * Precedence, highest first: an explicit `?tutorial=` (playtest links and the
 * e2e gameplay specs opt out; a reviewer can opt IN over a dismissal), then the
 * stored *never show this again*, then "show it". Mirrors `shouldPromptForSkill`
 * so the two boot prompts answer the same kind of question the same way.
 */
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

// ── the content ───────────────────────────────────────────────────────────
/** A node in the loop diagram: one icon, one word. */
export interface ChainNode { icon: string; label: string }

/** The mini-map's tile vocabulary — every kind is a CSS class (`t-<kind>`). */
export type IsoTileKind =
  | "grass" | "rough" | "water" | "town" | "industry" | "plant" | "depot" | "dirt" | "road";

export interface IsoTile {
  /** Lattice coordinates, not map coordinates: x runs south-east, y south-west. */
  x: number; y: number;
  kind: IsoTileKind;
  /** The emoji stamped on the tile (🌾 🏭 🛖 🚚 …). */
  mark?: string;
  /** A legality ring, the same green/red the map's own preview uses. */
  ring?: "good" | "bad" | "route";
}

export interface BoardCell { cargo: Cargo | null; token?: 1 | 2; hit?: boolean }

/** One figure per step, at most. A union so the projector stays exhaustive. */
export type TutorialFigure =
  | { kind: "chain"; nodes: ChainNode[]; caption?: string }
  | { kind: "iso"; tiles: IsoTile[]; caption?: string }
  | { kind: "board"; cols: number; cells: BoardCell[]; caption?: string }
  | {
    kind: "ledger";
    rows: { icon: string; label: string; detail: string; vp: string; dim?: boolean }[];
    total?: { label: string; vp: string };
  };

export interface TutorialStep {
  /** Stable id: `data-step` on the card, the dots' key, and what tests read. */
  id: string;
  /** The small line above the title ("STEP 3 · CONNECT THEM"). */
  kicker: string;
  title: string;
  /** One sentence under the title, before the bullets. Optional. */
  lede?: string;
  /** The bullets. Inline `<b>` is allowed — this is authored copy, not input. */
  points: string[];
  figure?: TutorialFigure;
  /** The typewritten footnote on the ledger paper. */
  tip?: string;
}

/**
 * The two numbers the tour cannot read for itself: the ★ line belongs to the
 * live difficulty (`winTarget()` in game.ts) and the free-tile allowance is
 * DATA on the player record. Both callers pass what the game is actually
 * running, so the tour can never quote a stale line — and neither constant has
 * to be imported from `game.ts`, which would be a cycle.
 */
export interface TutorialContext {
  /** The ★ total that wins THIS game. */
  vpTarget: number;
  /** Dirt-road tiles the setup allowance pays for. */
  freeTrack: number;
}

/**
 * The whole tour, as pure data. Every price and point value is interpolated
 * from the authoritative tables, so this reads correctly after any rebalance.
 */
export function buildTutorialSteps(ctx: TutorialContext): TutorialStep[] {
  const dirt = costCompact(TRANSPORT.dirt.cost);
  const road = costCompact(TRANSPORT.road.cost);
  const pave = costCompact(UPGRADE_COST);
  const plant = costCompact(PLANT_COST);
  const star = (n: number) => `${fmtVp(n)}★`;
  // The allowance is DATA on the player record, so the caller hands it over;
  // a replay that does not know it says the rule without inventing a number.
  const allowance = ctx.freeTrack > 0
    ? `, and your setup allowance pays for the first ${ctx.freeTrack} of them`
    : ", and the setup allowance pays for your first tiles";

  return [
    {
      id: "loop",
      kicker: "HEXMATCH INDUSTRIES",
      title: "One island, one loop",
      lede: "You have bought a freight concern on an island with more industry than "
        + "anyone can carry. Everything you will ever do feeds one loop:",
      figure: {
        kind: "chain",
        nodes: [
          { icon: "⛰️", label: "Resource node" },
          { icon: "🛖", label: "Depot" },
          { icon: "🛤️", label: "Roads" },
          { icon: "🏭", label: "Processing Plant" },
          { icon: "💠", label: "Match 3" },
          { icon: "📦", label: "Cargo" },
          { icon: "★", label: "Expand" },
        ],
        caption: "Cargo paid by the board buys the next Depot, the next road and the next plant.",
      },
      points: [
        "A <b>resource node</b> (farm, forest, ore mine, quarry, oil rig) makes cargo. A <b>Depot</b> built within its reach picks that cargo up.",
        "<b>Roads</b> carry it to your <b>Processing Plant</b> — a lorry starts the run the instant the two are connected, and that lorry is the connection made visible.",
        "Inside the plant you play <b>match-3</b>: every delivery stamps a cargo token onto a gem, and matching tokened gems pays the cargo into your purse.",
        "Purse cargo buys more Depots, more road and more plants — and a rival is doing exactly the same thing on the other side of the island.",
      ],
      tip: `Six cargoes, six gem colours: ${CARGOES.map((c) => `${CARGO[c].icon} ${CARGO[c].name}`).join(" · ")}.`,
    },
    {
      id: "plant",
      kicker: "STEP 1 · BUILD IT",
      title: "Raise your Processing Plant",
      lede: "The match opens with one job: put your Processing Plant on the map.",
      figure: {
        kind: "iso",
        caption: "The footprint must share an EDGE with a town — green is legal, red is refused.",
        tiles: [
          // the town
          { x: 1, y: 1, kind: "town", mark: "🏘️" },
          { x: 2, y: 1, kind: "town" },
          { x: 1, y: 2, kind: "town" },
          { x: 2, y: 2, kind: "town" },
          // legal: this footprint touches the town along the lattice
          { x: 3, y: 1, kind: "plant", ring: "good" },
          { x: 4, y: 1, kind: "plant", ring: "good", mark: "🏭" },
          { x: 3, y: 2, kind: "plant", ring: "good" },
          { x: 4, y: 2, kind: "plant", ring: "good" },
          // refused: the same footprint, with no town tile beside any of it
          { x: 1, y: 4, kind: "grass", ring: "bad" },
          { x: 2, y: 4, kind: "grass", ring: "bad", mark: "🏭" },
          { x: 1, y: 5, kind: "grass", ring: "bad" },
          { x: 2, y: 5, kind: "grass", ring: "bad" },
        ],
      },
      points: [
        "It is <b>free</b>, and it is the delivery end of every route you will ever build — nothing pays until cargo can reach one.",
        "Two names, one building: the map and its banners call it the <b>Factory</b>, and the right-hand panel where you play match-3 is its floor, <b>Your Processing Plant</b>.",
        "It must stand <b>next to a town</b>: at least one footprint tile has to share an edge with a town tile (a diagonal touch does not count).",
        "Choose a town with resource nodes nearby. Every Depot you raise later has to reach this spot by road, and distance is paid for in lorry time.",
      ],
      tip: `Later plants are a purchase, not a gift — ${plant} beside another town — and each one is worth +${star(VICTORY.plant)}.`,
    },
    {
      id: "depot",
      kicker: "STEP 2 · COLLECT IT",
      title: "Build a Depot beside a resource node",
      lede: "Build → Depot, then click the ground you want it on.",
      figure: {
        kind: "iso",
        caption: "The dotted 4×4 is the catchment: the farm inside it is collected, the ore mine outside it is not.",
        tiles: [
          // the Depot's 4×4 catchment, dotted
          ...rect(0, 0, 4, 4, "grass", "route"),
          // painted over the patch: the industry it collects, and the Depot
          { x: 0, y: 0, kind: "industry", mark: "🌾" },
          { x: 2, y: 1, kind: "depot", mark: "🛖", ring: "good" },
          // and ground outside it, where a Depot would collect nothing
          { x: 4, y: 0, kind: "industry", mark: "⛏️" },
          { x: 4, y: 1, kind: "grass" },
          { x: 4, y: 2, kind: "rough" },
        ],
      },
      points: [
        "A Depot needs an industry inside its <b>4×4 catchment</b> — hover shows the tiles it would take, and the inspector says why a spot is refused.",
        "<b>One Depot holds each industry.</b> The first Depot to get a road there keeps it, so a rival who connects first locks that node for the rest of the match.",
        `Your <b>first Depot is free</b>. Every Depot after it costs ${costLabel(DEPOT_COST)}, and one you cannot pay for is refused without spending anything.`,
      ],
      tip: "A Depot on open ground with no road claims nothing at all — it can never lock a node away from you by accident.",
    },
    {
      id: "roads",
      kicker: "STEP 3 · CONNECT IT",
      title: "Join them with roads",
      lede: "Build → Dirt Road, then drag from the Depot to your Plant.",
      figure: {
        kind: "iso",
        caption: "One continuous run is all it takes: the lorry appears the moment the ends meet.",
        tiles: [
          { x: 0, y: 1, kind: "industry", mark: "⛏️" },
          { x: 1, y: 1, kind: "depot", mark: "🛖" },
          { x: 2, y: 1, kind: "dirt", ring: "route" },
          { x: 3, y: 1, kind: "dirt", ring: "route" },
          { x: 3, y: 2, kind: "road", ring: "route", mark: "🚚" },
          { x: 3, y: 3, kind: "road", ring: "route" },
          { x: 4, y: 3, kind: "plant", mark: "🏭" },
          { x: 0, y: 3, kind: "town" },
          { x: 1, y: 3, kind: "town" },
        ],
      },
      points: [
        `<b>Dirt Road</b> is ${dirt} a tile${allowance} — the banner counts them down as you drag.`,
        "A <b>lorry</b> drives the route as soon as the Depot reaches the Plant. No lorry, no deliveries, no tokens: the road is the whole machine.",
        "Town ring roads and the map's public highways carry your traffic too, so a route does not have to be entirely your own gravel.",
        `<b>Paved Road</b> is ${road} and runs lorries <b>2× faster</b>. Paving over dirt you already laid costs only ${pave} — and it is the only road work that scores.`,
      ],
      tip: "Left-drag lays a whole run of tiles at once. Middle-drag pans (one finger on touch), the wheel zooms, 🎯 recentres.",
    },
    {
      id: "board",
      kicker: "STEP 4 · PROCESS IT",
      title: "Play match-3 in the plant",
      lede: `The ${BOARD_W}×${BOARD_H} board in the right-hand column is your Processing Plant floor.`,
      figure: {
        kind: "board",
        cols: 5,
        caption: "Only gems wearing a numbered token pay. Swap two neighbours to line up 3 or more.",
        cells: [
          { cargo: "wood" }, { cargo: "ore", token: 1, hit: true }, { cargo: "grain" }, { cargo: "stone" }, { cargo: "wood" },
          { cargo: "grain" }, { cargo: "ore", token: 1, hit: true }, { cargo: "oil" }, { cargo: "wood" }, { cargo: "grain" },
          { cargo: "stone" }, { cargo: "ore", token: 2, hit: true }, { cargo: "wood" }, { cargo: "ore" }, { cargo: "oil" },
          { cargo: "wood" }, { cargo: "grain" }, { cargo: "stone" }, { cargo: "grain" }, { cargo: "stone" },
        ],
      },
      points: [
        "Each delivery stamps a <b>numbered cargo token</b> onto a gem of that colour. Swap two <b>adjacent</b> gems to make a line of three or more.",
        "Only <b>tokened</b> gems pay, and they pay <b>double</b> their number. A plain match is not wasted — it clears space and drops the stack into new shapes.",
        "<b>4 in a row</b> doubles the match and leaves a token behind; <b>5 in a row</b> forges a <b>bomb</b> — swap it with any gem to blow that whole colour.",
        "A colour your network cannot reach stamps no tokens at all, so the <b>Network reaches</b> strip above the board is your shopping list.",
      ],
      tip: "🪙 Gold gems only drop while a Depot sits beside a gold mine — and Gold buys sabotage, never construction.",
    },
    {
      id: "expand",
      kicker: "STEP 5 · SPEND IT",
      title: "Turn cargo into empire",
      lede: "Matched cargo lands in your purse — the chips along the bottom of the screen.",
      points: [
        "That purse is the only money in the game. It buys Depots, roads, plants, Security Forces and Repair Crews — every price is printed on the button before you click it.",
        "<b>Ore is the gate.</b> Dirt Road needs only wood and stone, but paving, plants and the second Depot all want ore, so an Ore Mine is the first real objective.",
        `<b>Bank</b> trades ${BANK_RATE} of one good for 1 of another with no rival needed; <b>Market</b> posts offers the rival may take; <b>Feed</b> logs every event of the match.`,
        `Another <b>Processing Plant</b> (${plant}) beside another town widens where your Depots may deliver. All your plants share ONE board — a new plant adds reach, not throughput.`,
      ],
      tip: "Black Market cards (Blockade, Frost, Girders, Smog, Protest) cost Gold and land on the rival. A Protest ✊ shuts any public road for 2:00 — every truck stops, including yours.",
    },
    {
      id: "victory",
      kicker: "STEP 6 · WIN IT",
      title: "How Victory Points are earned",
      lede: "There are exactly two sources of ★, and both are upgrades rather than connections.",
      figure: {
        kind: "ledger",
        rows: [
          {
            icon: "▰", label: "Pave a Dirt Road tile", vp: `+${star(VICTORY.upgrade)}`,
            detail: `${pave} over gravel you already laid — four paves to the point`,
          },
          {
            icon: "◆", label: "Raise another Processing Plant", vp: `+${star(VICTORY.plant)}`,
            detail: `${plant}, edge-on to another town`,
          },
          {
            icon: "·", label: "Dirt Road, on its own", vp: "0★", dim: true,
            detail: "plumbing, not points",
          },
          {
            icon: "·", label: "Road laid on virgin ground", vp: "0★", dim: true,
            detail: `full ${road}, no gravel underneath to upgrade`,
          },
        ],
        total: { label: `First to ${star(ctx.vpTarget)} wins the match`, vp: `${star(ctx.vpTarget)}` },
      },
      points: [
        `Paving your own dirt into Road pays <b>+${star(VICTORY.upgrade)} a tile</b>; raising an extra plant pays <b>+${star(VICTORY.plant)}</b>. Nothing else scores.`,
        "Tearing up a paved tile or demolishing a plant <b>takes the point back</b>, so a demolished network is a lost lead, not a free re-route.",
        `<b>First to ${star(ctx.vpTarget)} wins</b>, and the match ends the moment either seat crosses it. Your ★ plaque is top-right; hover a name in the header for the exact breakdown, tile by tile, yours and the rival's.`,
      ],
      tip: "The finish line belongs to the difficulty: the Easy chair races a shorter one. The 🤖 switch in the top bar moves it at any time.",
    },
    {
      id: "desk",
      kicker: "THE DESK",
      title: "Controls, and where everything lives",
      points: [
        "<b>Left button</b> places and drags roads; <b>WASD</b> pans the camera (Shift doubles the speed), and so does the <b>middle button</b> (one finger drags the map on touch, two pinch-zoom); <b>wheel</b> zooms; 🎯 recentres on your plant.",
        "<b>Right-click drops the tool you are holding</b> back to the <b>Select</b> pointer — hover it over a resource, town, plant or depot and the inspector says exactly what it is. <b>Q</b> does the same from the keyboard.",
        "Left column: <b>Build</b> — Select, Dirt Road, Road, Depot, Processing Plant, Demolish (half refund) — and the <b>Black Market</b> beneath it.",
        "Right column: the <b>Bank</b>, <b>Market</b>, <b>Processing Plant</b> and <b>Feed</b> tabs, with the board and the reach strip above them.",
        "<b>Esc</b> cancels an armed card or protest, <b>M</b> mutes, ♻ collapses the board for a fresh neutral one (30 s cooldown), and the top-bar <b>Aa Names</b> switch shows or hides the name tags over the map.",
      ],
      tip: "Nothing at the start is timed — the rival does not move until your Plant and first Depot are down. Replaying this tour from ❔ mid-game does not pause it.",
    },
  ];
}

/**
 * A w×h patch of one tile kind, for the mini-map figures. Tiles are painted in
 * array order and a later diamond covers an earlier one at the same lattice
 * coordinate, so a patch is laid down first and the building that sits on it is
 * simply listed after — no bookkeeping about which cell was replaced.
 */
function rect(
  x0: number, y0: number, w: number, h: number,
  kind: IsoTileKind, ring?: IsoTile["ring"],
): IsoTile[] {
  const out: IsoTile[] = [];
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) out.push({ x, y, kind, ring });
  }
  return out;
}

// ── the projector ─────────────────────────────────────────────────────────
export type TutorialCloseReason = "done" | "skip" | "never";

export interface TutorialResult {
  /** How the card went away: last step's button, an early exit, or the
   *  permanent dismissal. Only `never` writes the preference. */
  reason: TutorialCloseReason;
  /** The step id the player was reading when it closed. */
  step: string;
  /** How far they got, 1-based — a telemetry line and a test hook. */
  index: number;
}

export interface TutorialHandle {
  el: HTMLElement;
  /** Resolves once, when the card closes for any reason. */
  promise: Promise<TutorialResult>;
  /** Close it from the outside, as a player exit would. */
  close: (reason?: TutorialCloseReason) => void;
  /** Teardown: take the DOM, the document listener and the promise with it. */
  destroy: () => void;
}

export interface TutorialOptions extends Partial<TutorialContext> {
  /** Injectable for tests, exactly as the skill picker does. */
  search?: string;
  storage?: TutorialStorage | null;
  /** Show it even when the player asked never to (the ❔ help modal's Replay). */
  force?: boolean;
  /** Called with the result the moment the card closes. */
  onClose?: (r: TutorialResult) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/** The iso figure's diamond, in CSS px. 2:1 like the map's own tile. */
const FIG_TILE_W = 46;
const FIG_TILE_H = 23;

function figureNode(fig: TutorialFigure): HTMLElement {
  const wrap = el("div", `tut-fig tut-fig-${fig.kind}`);
  if (fig.kind === "chain") {
    const row = el("div", "tut-chain");
    fig.nodes.forEach((n, i) => {
      if (i) row.appendChild(el("span", "tut-chain-arrow", "➜"));
      const node = el("span", "tut-chain-node");
      node.appendChild(el("i", "tut-chain-ic", n.icon));
      node.appendChild(el("b", undefined, n.label));
      row.appendChild(node);
    });
    wrap.appendChild(row);
  } else if (fig.kind === "iso") {
    wrap.appendChild(isoNode(fig.tiles));
  } else if (fig.kind === "board") {
    const grid = el("div", "tut-board");
    grid.style.setProperty("--tut-cols", String(fig.cols));
    for (const cell of fig.cells) {
      const gem = el("span", "tut-gem" + (cell.hit ? " tut-gem-hit" : "")
        + (cell.cargo ? "" : " tut-gem-empty"));
      const art = cell.cargo ? GEM_ART[cell.cargo] : null;
      if (cell.cargo) {
        gem.dataset.cargo = cell.cargo;
        gem.style.setProperty("--tut-gem-c1", CARGO[cell.cargo].c1);
        gem.style.setProperty("--tut-gem-c2", CARGO[cell.cargo].c2);
      }
      if (art) gem.style.backgroundImage = `url(${art})`;
      if (cell.token) {
        const badge = el("b", `tut-gem-token t${cell.token}`, String(cell.token));
        gem.appendChild(badge);
      }
      grid.appendChild(gem);
    }
    wrap.appendChild(grid);
  } else {
    const ledger = el("div", "tut-ledger");
    for (const row of fig.rows) {
      const line = el("div", "tut-ledger-row" + (row.dim ? " dim" : ""));
      line.appendChild(el("span", "tut-ledger-ic", row.icon));
      const copy = el("span", "tut-ledger-copy");
      copy.appendChild(el("b", undefined, row.label));
      copy.appendChild(el("small", undefined, row.detail));
      line.appendChild(copy);
      line.appendChild(el("strong", "tut-ledger-vp", row.vp));
      ledger.appendChild(line);
    }
    if (fig.total) {
      const total = el("div", "tut-ledger-total");
      total.appendChild(el("span", undefined, fig.total.label));
      total.appendChild(el("strong", undefined, fig.total.vp));
      ledger.appendChild(total);
    }
    wrap.appendChild(ledger);
  }
  if ("caption" in fig && fig.caption) wrap.appendChild(el("div", "tut-fig-cap", fig.caption));
  return wrap;
}

/** The mini-map: one CSS diamond per tile, laid out on the map's own lattice. */
function isoNode(tiles: IsoTile[]): HTMLElement {
  const plate = el("div", "tut-iso");
  const left = (t: IsoTile) => (t.x - t.y) * (FIG_TILE_W / 2);
  const top = (t: IsoTile) => (t.x + t.y) * (FIG_TILE_H / 2);
  const minX = Math.min(...tiles.map(left));
  const minTop = Math.min(...tiles.map(top));
  const maxLeft = Math.max(...tiles.map(left));
  const maxTop = Math.max(...tiles.map(top));
  plate.style.width = `${maxLeft - minX + FIG_TILE_W}px`;
  plate.style.height = `${maxTop - minTop + FIG_TILE_H + 14}px`;
  for (const t of tiles) {
    const d = el("span", `tut-tile t-${t.kind}${t.ring ? ` ring-${t.ring}` : ""}`);
    d.style.left = `${left(t) - minX}px`;
    d.style.top = `${top(t) - minTop}px`;
    d.style.width = `${FIG_TILE_W}px`;
    d.style.height = `${FIG_TILE_H}px`;
    if (t.mark) {
      // A mark stands ABOVE its tile, and tiles paint in DOM order — so the
      // marked ones are lifted out of that order or the next row's diamond
      // would cover the emoji.
      d.style.zIndex = "3";
      d.appendChild(el("i", undefined, t.mark));
    }
    plate.appendChild(d);
  }
  return plate;
}

/**
 * Open the tour over `host` (the HUD root). Returns `null` when the player has
 * dismissed it and nothing forces it — the caller then has no card to await.
 */
export function showTutorial(host: HTMLElement, opts: TutorialOptions = {}): TutorialHandle | null {
  const storage = opts.storage ?? liveStorage();
  const search = opts.search ?? (typeof location !== "undefined" ? location.search : "");
  if (!opts.force && !shouldShowTutorial(search, storage)) return null;

  const ctx: TutorialContext = {
    vpTarget: opts.vpTarget ?? VICTORY.target,
    freeTrack: opts.freeTrack ?? 0,
  };
  const steps = buildTutorialSteps(ctx);
  let index = 0;
  let closed = false;

  // One overlay, one id: the CSS and the e2e spec both address it by id, the
  // way the difficulty prompt and the ending screen do.
  const screen = el("div");
  screen.id = "iso-tutorial";
  screen.setAttribute("role", "dialog");
  screen.setAttribute("aria-modal", "true");
  screen.setAttribute("aria-label", "How to play Hexmatch Industries");

  // The backdrop is its own element so a click on it (and only it) closes.
  screen.appendChild(el("div", "tut-shade"));

  const card = el("div", "tut-card");
  const head = el("div", "tut-head");
  const kicker = el("p", "tut-kicker");
  const title = el("h2", "tut-title");
  title.id = "iso-tutorial-title";
  card.setAttribute("aria-labelledby", title.id);
  const closeBtn = el("button", "tut-x", "✕");
  closeBtn.type = "button";
  closeBtn.dataset.act = "tut-close";
  closeBtn.dataset.sfx = "close";
  closeBtn.title = "Close (Esc) — it comes back next game unless you press “Never show this again”";
  closeBtn.setAttribute("aria-label", "Close the tutorial");
  head.append(kicker, title, closeBtn);
  card.appendChild(head);

  const body = el("div", "tut-body");
  card.appendChild(body);

  const foot = el("div", "tut-foot");
  const never = el("button", "tut-never", "Never show this again");
  never.type = "button";
  never.dataset.act = "tut-never";
  never.dataset.sfx = "close";
  never.title = "Remember this choice and never open the tour at boot again";
  const dots = el("div", "tut-dots");
  dots.setAttribute("role", "group");
  dots.setAttribute("aria-label", "Tutorial steps");
  const nav = el("div", "tut-nav");
  const prev = el("button", "big-btn tut-btn tut-prev ghost", "◀ Back");
  prev.type = "button";
  prev.dataset.act = "tut-prev";
  prev.dataset.sfx = "tab";
  const next = el("button", "big-btn tut-btn tut-next", "Next ▶");
  next.type = "button";
  next.dataset.act = "tut-next";
  next.dataset.sfx = "tab";
  nav.append(prev, next);
  foot.append(never, dots, nav);
  card.appendChild(foot);
  // One honest line about the two exits, so the button is not a mystery.
  card.appendChild(el(
    "p", "tut-note",
    "Skip closes it for now — “Never show this again” is what keeps it closed. "
    + "Replay it any time from the ❔ in the top bar.",
  ));
  screen.appendChild(card);

  function paint() {
    const step = steps[index];
    screen.dataset.step = step.id;
    kicker.textContent = `${step.kicker} · ${index + 1} of ${steps.length}`;
    title.textContent = step.title;
    body.innerHTML = "";
    // The copy is authored markup (`<b>` and the odd entity), never input, so
    // the inline-bold lines go through innerHTML and nothing else does.
    const rich = (tag: "p" | "li", cls: string | undefined, markup: string) => {
      const n = el(tag, cls);
      n.innerHTML = markup;
      return n;
    };
    if (step.lede) body.appendChild(rich("p", "tut-lede", step.lede));
    if (step.figure) body.appendChild(figureNode(step.figure));
    const list = el("ul", "tut-points");
    for (const p of step.points) list.appendChild(rich("li", undefined, p));
    body.appendChild(list);
    if (step.tip) body.appendChild(rich("p", "tut-tip", step.tip));

    dots.innerHTML = "";
    steps.forEach((s, i) => {
      const dot = el("button", "tut-dot" + (i === index ? " on" : ""));
      dot.type = "button";
      dot.dataset.step = s.id;
      dot.dataset.sfx = "tab";
      dot.title = `${i + 1}. ${s.title}`;
      dot.setAttribute("aria-label", `Step ${i + 1}: ${s.title}`);
      if (i === index) dot.setAttribute("aria-current", "step");
      dot.onclick = () => { index = i; paint(); };
      dots.appendChild(dot);
    });

    const last = index === steps.length - 1;
    prev.disabled = index === 0;
    prev.classList.toggle("hidden", index === 0);
    next.textContent = last ? "Start playing ▶" : "Next ▶";
    next.dataset.act = last ? "tut-done" : "tut-next";
    body.scrollTop = 0;
  }

  let resolve!: (r: TutorialResult) => void;
  const promise = new Promise<TutorialResult>((r) => { resolve = r; });

  function finish(reason: TutorialCloseReason) {
    if (closed) return;
    closed = true;
    // The ONE rule about persistence: only the button writes it.
    if (reason === "never") setTutorialDismissed(true, storage);
    const result: TutorialResult = { reason, step: steps[index].id, index: index + 1 };
    document.removeEventListener("keydown", onKey);
    screen.remove();
    opts.onClose?.(result);
    resolve(result);
  }

  const onKey = (event: KeyboardEvent) => {
    if (closed) return;
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        finish("skip");
        break;
      case "ArrowRight":
      case "PageDown":
        event.preventDefault();
        if (index < steps.length - 1) { index += 1; paint(); } else finish("done");
        break;
      case "ArrowLeft":
      case "PageUp":
        event.preventDefault();
        if (index > 0) { index -= 1; paint(); }
        break;
      case "Home":
        event.preventDefault(); index = 0; paint();
        break;
      case "End":
        event.preventDefault(); index = steps.length - 1; paint();
        break;
      case "Tab": {
        // Keep focus on the card while it is the only thing that matters: the
        // same five-control loop the ending ledger traps.
        const stops = [never, prev, next, ...dots.querySelectorAll<HTMLButtonElement>(".tut-dot"), closeBtn]
          .filter((b) => !b.disabled && !b.classList.contains("hidden"));
        if (!stops.length) break;
        const at = stops.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();
        const to = event.shiftKey
          ? (at <= 0 ? stops.length - 1 : at - 1)
          : (at < 0 || at === stops.length - 1 ? 0 : at + 1);
        stops[to].focus();
        break;
      }
      default:
        break;
    }
  };

  closeBtn.onclick = () => finish("skip");
  never.onclick = () => finish("never");
  prev.onclick = () => { if (index > 0) { index -= 1; paint(); } };
  next.onclick = () => {
    if (index < steps.length - 1) { index += 1; paint(); } else finish("done");
  };
  screen.querySelector(".tut-shade")!.addEventListener("click", () => finish("skip"));
  document.addEventListener("keydown", onKey);

  paint();
  host.appendChild(screen);
  // The panel that just swung up; the next key is the one that reads it aloud.
  sfx.play("open");
  requestAnimationFrame(() => next.focus());

  return {
    el: screen,
    promise,
    close: (reason: TutorialCloseReason = "skip") => finish(reason),
    // Teardown from outside (the game's own `dispose`). It closes rather than
    // merely detaching, so `promise` always settles and a caller awaiting the
    // tour can never be left hanging on a disposed game.
    destroy: () => finish("skip"),
  };
}
