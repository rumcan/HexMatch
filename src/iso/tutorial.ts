// TUT-01 / TUT-02 — starting tutorial.
//
// The tour is the new loop's. game.ts only raises it when that loop is on;
// `newLoop: false` keeps a retired-loop branch so a replay on the hatch does
// not teach the clock as if the always-on board were still the game.
//
// THE GATE: opens on a first solo game with no save (game.ts owns the
// save/seat half) and never again once the player has pressed "Never show
// this again" — this module owns the storage half (`shouldShowTutorial`),
// with `?tutorial=0/1` overriding for playtests.
//
// THE COPY IS READ, NOT TYPED. Prices, bands, yields and the ★ line come
// from the tables the placement and the scorer use. The win line is the
// caller's `vpTarget` (game.ts passes `winTarget()`), never a typed split
// of 12 / 10 / 5. Dirt is free, so the setup allowance is not taught.
//
// Rail is its own card. Five rules (stone, platform-as-Depot, one train,
// 45° turns, no diagonal on a slope) do not fit the roads card's one list.
// Battles stay a Depot bullet plus the battle How to Play, not a tenth card.
//
// The projector paints the shipped `.tut-*` classes, including the veil,
// the step dots and the ledger total the browser specs walk.
import {
  BUILD_COSTS, BATTLE_RULES, CARGO, CARGOES, DEPOT_LEVELS, DIFFICULTY_RULES,
  DISTANCE, TOWN_UPGRADES, TRANSPORT, TUNING, VICTORY,
} from "./config";
import {
  DEPOT_COST, DEPOT_RETUNE_COST, FREE_SETUP_DEPOTS, costCompact, costLabel,
} from "./construction";
import { SLOPE_REFUSAL_TEXT } from "./slopes";
import { SABOTAGE } from "../game/config";
import { fmtVp } from "./victory";
import { coarsePointer } from "./touch";
import { sfx } from "../audio/sfx";
import { GEM_ART } from "../game/gem-art";
import shotPlant from "../../assets/tutorial/plant.webp";
import shotDepot from "../../assets/tutorial/depot.webp";
import shotRoads from "../../assets/tutorial/roads.webp";
import shotRail from "../../assets/tutorial/rail.webp";
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
  } catch { /* private mode: the tour simply asks again next boot */ }
}

// `?tutorial=0` sits a boot out (e2e gameplay specs, playtest links);
// `?tutorial=1` asks again even over "never". Anything else defers to storage.
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
export interface TutorialFigureLedger {
  kind: "ledger";
  rows: { icon: string; label: string; vp: string }[];
  caption: string;
  /** The finish line, printed as the ledger total. Absent on cards that are not a race. */
  total?: string;
}
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
  /**
   * False is the retired loop (always-on board, tokened gems). Absent or
   * true is the loop the game ships: a tuning session, then the clock.
   */
  newLoop?: boolean;
}

const star = (n: number): string => `${fmtVp(n)}★`;

/** Paying ★ rows on the new loop. A zero row (the retired rung) is not taught. */
function loopLedgerRows(): { icon: string; label: string; vp: string }[] {
  const holdCap = fmtVp(VICTORY.loop.holdCap);
  const candidates: { icon: string; label: string; vp: number }[] = [
    { icon: "🛖", label: "A Depot running", vp: VICTORY.loop.type },
    { icon: "🛣️", label: "A route fully paved", vp: VICTORY.loop.route },
    { icon: "🏙️", label: "A city upgrade tier", vp: VICTORY.loop.city },
    { icon: "⭐", label: "A Depot at the top level", vp: VICTORY.loop.maxDepot },
    { icon: "⚔", label: `A contested hold, at most ${holdCap}★`, vp: VICTORY.loop.hold },
  ];
  return candidates.filter((r) => r.vp > 0).map((r) => ({
    icon: r.icon, label: r.label, vp: `+${star(r.vp)}`,
  }));
}

function freeDepotLine(): string {
  const later = `Every Depot after that costs ${costLabel(DEPOT_COST)}.`;
  if (FREE_SETUP_DEPOTS <= 0) return `A Depot costs ${costLabel(DEPOT_COST)}.`;
  if (FREE_SETUP_DEPOTS === 1) return `Your first Depot is free. ${later}`;
  return `Your first ${FREE_SETUP_DEPOTS} Depots are free. ${later}`;
}

export function buildTutorialSteps(ctx: TutorialContext): TutorialStep[] {
  const coarse = coarsePointer();
  const retired = ctx.newLoop === false;
  const dirt = costCompact(TRANSPORT.dirt.cost);
  const road = costCompact(TRANSPORT.road.cost);
  // The allowance only buys tiles that cost something. Dirt is free, so it
  // is not taught; a rebalance that charges for gravel brings the countdown back.
  const allowance = ctx.freeTrack > 0
    ? `, and your setup allowance pays for the first ${ctx.freeTrack} of them`
    : "";
  const dirtLine = dirt === "free"
    ? `<b>Dirt Road</b> is ${dirt}, tile after tile.`
    : `<b>Dirt Road</b> costs ${dirt} a tile${allowance}.`;
  const rail = costCompact(BUILD_COSTS.rail);
  const caps = DEPOT_LEVELS.caps.map((n) => `×${n}`).join(" → ");
  const waitMin = Math.round(BATTLE_RULES.challengePlayerCooldownMs / 60_000);
  const easy = DIFFICULTY_RULES.easy;
  const normal = DIFFICULTY_RULES.normal;
  const hard = DIFFICULTY_RULES.hard;
  const city0 = TOWN_UPGRADES[0];
  const line = `${ctx.vpTarget}★`;

  const cargoTip = `Six cargoes, six gem colours: ${CARGOES.map((c) => `${CARGO[c].icon} ${CARGO[c].name}`).join(" · ")}.`;

  return [
    {
      id: "loop",
      kicker: "HEXMATCH INDUSTRIES",
      title: "One island, one loop",
      lede: retired
        ? "You have bought a freight concern on an island with more industry than anyone can carry. Deliveries feed the board, and the board feeds the purse."
        : "You have bought a freight concern on an island with more industry than anyone can carry. Everything feeds one loop:",
      figure: {
        kind: "chain",
        nodes: retired
          ? [
            { icon: "⛰️", label: "Resource" },
            { icon: "🛖", label: "Depot" },
            { icon: "🛤️", label: "Road" },
            { icon: "🏭", label: "Plant" },
            { icon: "💎", label: "Board" },
            { icon: "📦", label: "Purse" },
          ]
          : [
            { icon: "🛖", label: "Depot" },
            { icon: "💎", label: "Match-3" },
            { icon: "×", label: "The tick" },
            { icon: "📦", label: "Purse" },
            { icon: "★", label: "Upgrades" },
          ],
        caption: retired
          ? "A connected Depot stamps tokened gems. Only a tokened gem pays into the purse."
          : "A Depot is tuned, then it ticks yield × distance × haul into the purse. The purse pays the depot tree and the city.",
      },
      points: retired
        ? [
          "A resource node makes cargo. A Depot built against it picks that cargo up and sends it to your plant.",
          "Deliveries stamp tokened gems on the board. Only a tokened gem pays.",
          "The purse along the top is what you spend. Gold buys sabotage, never a road or a Depot.",
        ]
        : [
          "Build a Depot against a resource, then play a short match-3 tuning session. The score sets that Depot's yield.",
          `The clock then ticks cargo in: yield × distance × haul. Haul does not change the tick — a paved Road makes the trucks faster instead.`,
          "The purse pays the depot tree and the city upgrades. Gold, from a played session or a Gold Mine, buys Challenges and Black Market cards, never construction.",
        ],
      tip: cargoTip,
    },
    {
      id: "plant",
      kicker: "STEP 1 · THE CITY",
      title: "Your city is the hub",
      lede: "The city is where every Depot delivers. Nothing ticks until a route can reach it.",
      figure: {
        kind: "shot",
        src: shotPlant,
        alt: "The city previewed beside a town, the delivery end of every route",
        caption: "The city is the delivery end. Every Depot needs a road or a rail line that can reach it.",
      },
      points: [
        "Place the city beside your town. Roads and rail all run back to it.",
        `The first city upgrade costs ${costCompact(city0.cost)}, adds ${Math.round(city0.bonus * 100)}% to every Depot's tick, and pays ${star(VICTORY.loop.city)}.`,
        "The Plant card sits at the bottom right once the city is down. It is where you upgrade the city and retune.",
      ],
      tip: "A Depot with no route to the city claims nothing and pays nothing.",
    },
    {
      id: "depot",
      kicker: "STEP 2 · COLLECT IT",
      title: "A Depot beside the resource",
      lede: "Build, then Depot, then the ground you want it on. The lot has to touch the industry.",
      figure: {
        kind: "shot",
        src: shotDepot,
        alt: "A Depot previewed so its lot shares an edge with an industry",
        caption: "The lot is 2×2 and must share an edge with the industry. Hover shows the tiles it would take.",
      },
      points: [
        "Set the 2×2 lot against the industry so they share an edge. R turns the entrance. Roads join on that open side.",
        freeDepotLine(),
        "The first Depot to serve an industry holds it. An unconnected Depot claims nothing, so it cannot lock a node away by accident.",
        `Taking a held industry is Challenge, then a battle — ${BATTLE_RULES.challengeGold} Gold, then a ${waitMin}-minute wait. The first win shares the site. A second win in a row closes the loser's Depot. Decline forfeits.`,
        "A Challenge opens once you hold every industry of one cargo, every town is taken, or you have fallen far enough behind. How battles work, in the menu, is the rest of the fight.",
      ],
      tip: "A platform beside an industry is a Depot too. It will not take one the other seat already holds.",
    },
    {
      id: "roads",
      kicker: "STEP 3 · CONNECT IT",
      title: "Join them with roads",
      lede: "Build, then Dirt Road, then drag from the Depot to your city. One continuous run is enough.",
      figure: {
        kind: "shot",
        src: shotRoads,
        alt: "A dirt road joining a Depot to the city",
        caption: "One continuous gravel run is enough. The Depot starts ticking the moment the route reaches the city.",
      },
      points: [
        `${dirtLine} It is the gravel every route starts on.`,
        `A run of ${DISTANCE.nearTiles} tiles or fewer pays in full. Up to ${DISTANCE.midTiles} pays ${DISTANCE.mid}×, and farther pays ${DISTANCE.far}×.`,
        `<b>Road</b> costs ${road}. It does not multiply the tick. Trucks run faster on it than on gravel, and a fully paved route pays ${star(VICTORY.loop.route)}.`,
        "Town ring roads and public highways carry your traffic too. A protest on a public tile stops every truck through it, including yours.",
      ],
      tip: coarse
        ? "One finger drags a run tile by tile. A tap lays one tile. Two fingers zoom."
        : "Left-drag lays a run. Middle-drag pans, the wheel zooms, and right-click puts the tool down.",
    },
    {
      id: "rail",
      kicker: "STEP 4 · THE FAST LINE",
      title: "Rail turns gently",
      lede: "Rail is the fast line between an industry and your city. It is not a second gravel road.",
      figure: {
        kind: "shot",
        src: shotRail,
        alt: "A platform beside an industry, a rail line turning 45 degrees, and a slope a diagonal may not cross",
        caption: "A platform beside an industry is a Depot. The line turns 45 degrees, and a diagonal may not cross a slope.",
      },
      points: [
        retired
          ? `<b>Rail</b> costs ${rail} a tile. A platform beside an industry acts as a Depot for that industry.`
          : `<b>Rail</b> costs ${rail} a tile. A platform beside an industry is a Depot: it claims that industry, opens a tuning session, and ticks when its train runs.`,
        "One train per connected network. A second line that would join two running trains is refused.",
        "A train can go straight or turn 45°. It cannot take a sharp corner.",
        SLOPE_REFUSAL_TEXT["slope-diagonal"],
      ],
      tip: "R turns a platform. The Railway panel, while a rail tool is in your hand, lists the lines you can run.",
    },
    {
      id: "board",
      kicker: "STEP 5 · TUNE IT",
      title: "Match-3 tunes a Depot",
      lede: retired
        ? "The board stays up in the Processing Plant for the whole match. Deliveries are what put cargo on it."
        : "Building a Depot opens a short tuning session. The board is not up otherwise.",
      figure: {
        kind: "shot",
        src: shotBoard,
        alt: retired
          ? "The Processing Plant board, with tokened gems waiting to be matched"
          : "The tuning session window open over the map",
        caption: retired
          ? "Swap two neighbours to line up 3 or more. Only a tokened gem pays."
          : "The plate counts the moves left and the yield the score is worth. Swap two neighbours to line up 3 or more.",
      },
      points: retired
        ? [
          "Deliveries stamp tokened gems, and only a tokened gem pays into the purse.",
          "The board stays up. Matching is the whole match, not a session you finish.",
          "Swap two neighbours to line up 3 or more of a colour. Five in a row forges a bomb.",
        ]
        : [
          `A session is <b>bounded</b>: ${TUNING.moves} moves, then the board closes.`,
          `Every gem you clear is score. The score becomes the Depot's yield — ×${TUNING.minYield} at zero, ×${TUNING.maxYield} at ${TUNING.targetScore} gems — and what sticks is capped by that Depot's level.`,
          "Five in a row forges a bomb. Finish keeps the score you have. ✕ abandons and does not raise the yield.",
          `Easy starts at ×${easy.minYield} on a clean board. Normal ices ${normal.obstacles.frost} gems. Hard ices ${hard.obstacles.frost} and drops ${hard.obstacles.girders} girders. On every difficulty the yield never drops, and you can retune any time for ${costCompact(DEPOT_RETUNE_COST)}.`,
        ],
      tip: retired
        ? "Gold gems are the sabotage purse. Construction never spends Gold."
        : `A played session pays ${TUNING.minGold} to ${TUNING.maxGold} Gold. Abandoning pays none. A Gold Mine ticks Gold like any other cargo.`,
    },
    {
      id: "expand",
      kicker: "STEP 6 · SPEND IT",
      title: "Turn cargo into empire",
      lede: "Connected Depots tick cargo into the purse along the top of the screen. That purse is what you spend.",
      figure: {
        kind: "shot",
        src: shotExpand,
        alt: "The bottom drawer open on Bank, with the purse in the top bar",
        caption: "The purse runs along the top. The drawer is Bank, Market, Black Market, Feed and Quests.",
      },
      points: [
        "Construction spends cargo, never Gold. Gold buys Challenges and Black Market cards.",
        `Click a Depot to raise its yield cap ${caps}. The top level pays ${star(VICTORY.loop.maxDepot)}. Score past the cap pays Gold.`,
        `The first city upgrade costs ${costCompact(city0.cost)} and pays ${star(VICTORY.loop.city)}. Each tier raises what every Depot ticks.`,
        `Blockade costs ${SABOTAGE.bandit.gold} Gold and stops an industry's Depots. Protest costs ${SABOTAGE.protest.gold} Gold and shuts a public road, yours included. Feed logs every event.`,
      ],
      tip: "The bank trades cargo for cargo. It never touches Gold.",
    },
    {
      id: "victory",
      kicker: "STEP 7 · WIN IT",
      title: "How Victory Points are earned",
      lede: `First to ${ctx.vpTarget}★ wins. These are the sources that pay:`,
      figure: {
        kind: "ledger",
        rows: retired
          ? [
            { icon: "🛣️", label: "A paved tile", vp: `+${star(VICTORY.upgrade)}` },
            { icon: "🏭", label: "An extra plant", vp: `+${star(VICTORY.plant)}` },
            { icon: "🚉", label: "A platform", vp: `+${star(VICTORY.platform)}` },
          ]
          : loopLedgerRows(),
        total: line,
        caption: retired
          ? `Paves, plants and platforms — first to ${line}.`
          : `Depots, paved routes, the city, and a couple of holds — first to ${line}.`,
      },
      points: retired
        ? [
          `A paved tile pays ${star(VICTORY.upgrade)}. Dirt itself scores nothing.`,
          `An extra plant pays ${star(VICTORY.plant)}, and a platform pays ${star(VICTORY.platform)}.`,
          `First to ${ctx.vpTarget}★ wins. The line on the badge is the one this match is racing.`,
        ]
        : [
          `Every Depot that is connected and producing pays ${star(VICTORY.loop.type)}. Cut its route and it stops paying.`,
          `A route to your city pays ${star(VICTORY.loop.route)} once every tile of it is paved. A city tier pays ${star(VICTORY.loop.city)} and is never revoked.`,
          `A Depot at the top level pays ${star(VICTORY.loop.maxDepot)}. A contested hold pays ${star(VICTORY.loop.hold)}, and at most ${star(VICTORY.loop.holdCap)} of those stars count.`,
          "A single road tile scores nothing. The star is for the whole route, once every tile of it is paved.",
        ],
      tip: "Different plans win. Breadth, a paved network, a taller city, or a couple of holds.",
    },
    {
      id: "desk",
      kicker: "STEP 8 · THE DESK",
      title: "Where everything lives",
      lede: "The map is the island. The tools, the purse and the menu live around it.",
      figure: {
        kind: "shot",
        src: shotDesk,
        alt: "The left tool rail, the bottom drawer, the Plant card and the minimap",
        caption: retired
          ? "Right column: Processing Plant and Feed tabs — the board stays up in the plant."
          : "The drawer holds Bank, Market, Black Market, Feed and Quests. While a Depot is tuned, the board opens in its own session window.",
      },
      points: [
        "On a wide screen the tools stand in a rail on the left. Hover one to see its price before you build.",
        "The drawer along the bottom holds Bank, Market, Black Market, Feed and Quests. A tab opens it. The same tab again closes it.",
        "The Plant card is bottom right. The minimap is top right. The menu holds difficulty, sound, recenter and names over the map.",
        "On a phone the bottom bar switches Map, Build and Economy. Build is the tool list. Economy is the drawer.",
      ],
      tip: coarse
        ? "One finger pans the map. A tap places a building or lays one tile. Two fingers zoom. The bottom bar switches Map, Build and Economy."
        : "Middle-drag pans, the wheel zooms, and right-click puts the tool down. The menu is the ☰ at the top right.",
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
  /** Skip the gate — the help modal's replay does this on purpose. */
  force?: boolean;
  vpTarget: number;
  freeTrack: number;
  /** False is the retired loop. Absent or true is the loop the game ships. */
  newLoop?: boolean;
  /** Gate overrides for tests and playtests; defaults read the live boot. */
  search?: string;
  storage?: TutorialStorage | null;
  onClose?: (result: TutorialResult) => void;
  /**
   * Another reference card on the same projector — the battle How to Play
   * passes its own cards, overlay id and last-button label, and hides
   * "Never show this again" (a page opened on purpose has nothing to dismiss
   * forever). Absent = the starting tour.
   */
  steps?: TutorialStep[];
  overlayId?: string;
  doneLabel?: string;
  showNever?: boolean;
  /** Where the overlay hangs (default: `root`). */
  mount?: HTMLElement;
}

export function showTutorial(
  root: HTMLElement,
  opts: ShowTutorialOptions = { vpTarget: VICTORY.loop.target, freeTrack: 0 },
): TutorialHandle | null {
  const search = opts.search ?? (typeof location !== "undefined" ? location.search : "");
  const storage = opts.storage === undefined ? liveStorage() : opts.storage;
  if (!opts.force && !shouldShowTutorial(search, storage)) return null;

  const steps = opts.steps && opts.steps.length
    ? opts.steps
    : buildTutorialSteps({ vpTarget: opts.vpTarget, freeTrack: opts.freeTrack, newLoop: opts.newLoop });
  let idx = 0;

  const overlay = el("div", "");
  overlay.id = opts.overlayId ?? "iso-tutorial";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  // The veil is the other "for now" exit. It sits under the card; a click
  // on the card never reaches it.
  const shade = el("div", "tut-shade");

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
  const dots = el("div", "tut-dots");
  steps.forEach((s, i) => {
    const dot = el("button", "tut-dot") as HTMLButtonElement;
    dot.type = "button";
    dot.dataset.step = s.id;
    dot.setAttribute("aria-label", s.title);
    dot.onclick = () => {
      if (idx === i) return;
      idx = i;
      render();
      sfx.play("open");
    };
    dots.appendChild(dot);
  });
  const nav = el("div", "tut-nav");
  const prev = el("button", "big-btn ghost", "← Back") as HTMLButtonElement;
  prev.type = "button";
  prev.dataset.act = "tut-prev";
  const next = el("button", "big-btn", "Next →") as HTMLButtonElement;
  next.type = "button";
  next.dataset.act = "tut-next";
  nav.append(prev, next);
  if (opts.showNever === false) foot.append(dots, nav);
  else foot.append(never, dots, nav);

  card.append(head, body, foot);
  overlay.append(shade, card);

  const caption = (text: string) => el("div", "tut-fig-cap", text);

  const renderFigure = (fig: TutorialFigure) => {
    figureEl.className = `tut-fig tut-fig-${fig.kind}`;
    figureEl.replaceChildren();
    if (fig.kind === "chain") {
      const chain = el("div", "tut-chain");
      fig.nodes.forEach((n, i) => {
        const node = el("div", "tut-chain-node");
        const ic = el("i", "tut-chain-ic", n.icon);
        const label = el("b", "", n.label);
        node.append(ic, label);
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
        const ic = el("span", "tut-ledger-ic", row.icon);
        const copy = el("span", "tut-ledger-copy");
        copy.appendChild(el("b", "", row.label));
        const vp = el("span", "tut-ledger-vp", row.vp);
        r.append(ic, copy, vp);
        ledger.appendChild(r);
      }
      figureEl.appendChild(ledger);
      if (fig.total) {
        const total = el("div", "tut-ledger-total");
        total.append(el("span", "", "The line"), el("strong", "", fig.total));
        figureEl.appendChild(total);
      }
      figureEl.appendChild(caption(fig.caption));
    }
  };

  const render = () => {
    const s = steps[idx];
    overlay.dataset.step = s.id;
    kickerEl.textContent = s.kicker;
    titleEl.textContent = s.title;
    ledeEl.innerHTML = s.lede;
    renderFigure(s.figure);
    pointsEl.replaceChildren();
    for (const p of s.points) {
      const li = el("li", "");
      li.innerHTML = p;
      pointsEl.appendChild(li);
    }
    tipEl.textContent = s.tip;
    dots.querySelectorAll<HTMLButtonElement>(".tut-dot").forEach((d, i) => {
      const on = i === idx;
      d.classList.toggle("on", on);
      d.setAttribute("aria-current", on ? "step" : "false");
    });
    prev.disabled = idx === 0;
    const last = idx === steps.length - 1;
    next.dataset.act = last ? "tut-done" : "tut-next";
    next.textContent = last ? (opts.doneLabel ?? "Start Production →") : "Next →";
  };

  let resolve!: (r: TutorialResult) => void;
  const promise = new Promise<TutorialResult>((res) => { resolve = res; });
  let closed = false;
  const close = (reason: TutorialCloseReason = "dismissed") => {
    document.removeEventListener("keydown", onKey);
    if (closed) return;
    closed = true;
    overlay.remove();
    const result: TutorialResult = { reason };
    opts.onClose?.(result);
    sfx.play("close");
    resolve(result);
  };
  const destroy = () => close("dismissed");

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close("dismissed");
      return;
    }
    if (e.key === "ArrowRight") { e.preventDefault(); next.click(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); prev.click(); }
  };

  prev.onclick = () => { if (idx > 0) { idx--; render(); sfx.play("open"); } };
  next.onclick = () => {
    if (idx < steps.length - 1) { idx++; render(); sfx.play("open"); }
    else close("finished");
  };
  closeBtn.onclick = () => close();
  never.onclick = () => { setTutorialDismissed(true, storage); close("never"); };
  shade.onclick = () => close("dismissed");
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close("dismissed"); });
  document.addEventListener("keydown", onKey);

  render();
  (opts.mount ?? root).appendChild(overlay);
  sfx.play("open");
  return { el: overlay, promise, close, destroy };
}
