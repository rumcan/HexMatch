// ══════════════════════════════════════════════════════════════════════════
// Cinematic endings.
//
// Victory is not one generic banner: the ledger decides whether this was a
// road-builder's win, a plant-led industrial push, or a balanced empire. The
// same deterministic match seed then picks one of several "what happened
// after" cards. Defeat uses the winner's method and a separate, grim deck.
//
// This module never reads game state directly. The pure `buildEnding` half is
// easy to test; `showEndingScreen` is the small DOM projector used by game.ts.
// ══════════════════════════════════════════════════════════════════════════

import portraitTorvin from "../assets/ui/tycoon_torvin.png";
import portraitVex from "../assets/ui/tycoon_vex.png";
import portraitYou from "../assets/ui/tycoon_you.png";
// RANK-01 (#147): the rating row. The badge art is derived from the painted
// medallion master (`tools/make-rank-badges.mjs`) and bundled by Vite, so a
// ledger never depends on a network fetch to show a player their tier.
import { UNRANKED_KEY, badgeUrlFor } from "../ui/rank-badge";

/**
 * L13 (#228): the new loop's winner is read on its own axes — BREADTH (many
 * depot types running) against DEPTH (the city and the tree) — so it gets two
 * paths of its own rather than being forced into "paving" or "plants", which
 * are the names of two mechanics the new loop does not score.
 */
export type EndingPath = "paving" | "plants" | "balanced" | "network" | "industry";
export type DecisiveSource =
  | "upgrade" | "plant" | "platform" | "type" | "rung" | "city" | "route" | "level" | "hold" | null;

export interface EndingBreakdown {
  /**
   * L13 (#228): true when this ledger was scored by the NEW loop's table, so
   * the rows and the path reading pick themselves off the table that paid
   * rather than off the numbers. An all-zero new-loop ledger (a seat that
   * lost before its first type ran) and an all-zero shipped one are otherwise
   * identical, and inferring printed paved-tile rows for a loop that has no
   * paved tiles.
   */
  loop?: boolean;
  paved: number;
  plants: number;
  /** RAIL-02 (#176): platforms, the railway's contribution to the line. */
  platforms?: number;
  pavedVp: number;
  plantVp: number;
  platformVp?: number;
  /** L13 (#228): distinct depot types running, and what they paid. */
  types?: number;
  typeVp?: number;
  /** L13: depot-tree rungs unlocked, and what they paid. */
  rungs?: number;
  rungVp?: number;
  /** L13: city upgrade tiers confirmed, and what they paid. */
  city?: number;
  cityVp?: number;
  /** 2026-09: Depots with a fully paved route, and what they paid. */
  routes?: number;
  routeVp?: number;
  /** B7 (#252): contested sites held by battle that paid (≤ the cap), and their ★. */
  holds?: number;
  holdVp?: number;
}

export interface EndingInput {
  playerWon: boolean;
  playerScore: number;
  rivalScore: number;
  playerBreakdown: EndingBreakdown;
  rivalBreakdown: EndingBreakdown;
  /** The scoring event that crossed the line, when the live game knows it. */
  decisiveSource?: DecisiveSource;
  seed?: number;
  /** Optional explicit variant for previews/tests; otherwise the seed decides. */
  variant?: number;
  rivalName?: string;
  difficulty?: string;
  playerSabotage?: number;
  rivalSabotage?: number;
}

export interface EndingScoreRow {
  /** L13 (#228): the new loop's rows sit beside the shipped loop's two. */
  key: "paving" | "plants" | "types" | "rungs" | "routes" | "city" | "holds";
  icon: string;
  label: string;
  detail: string;
  vp: number;
}

export interface EndingModel {
  outcome: "victory" | "defeat";
  path: EndingPath;
  kicker: string;
  title: string;
  result: string;
  method: string;
  decisive: string;
  /** Exact point sources for the winning side (the player on victory, the
   * rival on defeat), so every outcome explains how the line was crossed. */
  rows: EndingScoreRow[];
  playerScore: number;
  rivalScore: number;
  rivalName: string;
  epilogue: string;
  coda: string | null;
  rivalQuote: string;
  playerQuote: string;
  variant: number;
}

const WIN_EPILOGUES: Record<EndingPath, readonly string[]> = {
  paving: [
    "You went on to become the greatest entrepreneur America had ever seen. Your little freight concern grew into the largest network in the United States, and business schools spent a century arguing over how you did it. You married the model from your first national advertising campaign, raised seven children, and died peacefully in your own bed at ninety-four, with a freight whistle sounding beyond the garden.",
    "Your bright roads crossed three time zones and made forgotten towns into capitals of trade. Congress called you a monopolist; drivers called you the reason supper arrived on time. You retired beside Lake Michigan and spent forty happy years refusing every offer to return.",
    "The little dirt lane became a continental web of asphalt, depots, and midnight headlights. Your company outlived two recessions and every newspaper that predicted its ruin. In old age you toured the first route once a year, waving from the cab like a victorious general.",
  ],
  plants: [
    "America called you the entrepreneur who made industry believe in itself again. Your processing plants became the furnaces of a new age; whole towns grew around their gates, and your name appeared on pay envelopes from coast to coast. You left the company to your children, built a glasshouse full of orchids, and never again woke before noon.",
    "You raised factory after factory until the nation measured prosperity by the smoke above your roofs. The board made you chairman for life. At eighty-eight you still walked the night shift every Friday, remembered every foreman's name, and left behind an empire nobody could divide.",
    "The final plant was only the beginning. You patented a cleaner furnace, endowed three engineering schools, and turned four company towns into thriving cities. Your bronze statue faced the factory gates; workers kept polishing its shoes long after you were gone.",
  ],
  balanced: [
    "By the time the magazines named you America's greatest living entrepreneur, your roads, depots, and processing floors had become the most admired industrial network of the century. Rivals copied the diagrams and failed. You married your oldest confidant, filled a rambling house with children and maps, and died content beneath a framed plan of the first route.",
    "Your empire worked because every mile of road had a purpose and every furnace had cargo waiting. You became the quiet power behind a decade of prosperity, then gave half the company to its workers and disappeared aboard a private train bound west.",
    "Historians later called it the Hexmatch System: build carefully, process relentlessly, and waste nothing. It made you wealthy beyond arithmetic. You spent your final years funding hospitals in every town that had trusted your first trucks, and every one flew its flags at half-mast for you.",
  ],
  // L13 (#228): the new loop's two shapes — a wide map of running depot types,
  // or a deep city that made a handful of routes worth more than anyone's many.
  network: [
    "You took the whole territory one cargo at a time: grain, timber, stone, ore, oil, and at last gold, every one of them running into your yards on a schedule the competition could not read. They called your route map the most valuable piece of paper in America. You retired to a farmhouse inside your own catchment and listened to the lorries all night, perfectly happy.",
    "No rival ever matched the spread. While they argued over one rich valley you had quietly put a depot on every kind of ground the island had, and when prices moved against any one cargo the other five carried you. The trade papers named the strategy after you; three generations of your family never worked a day they did not choose to.",
    "Your empire was a map with nothing left blank on it. Every industry the territory offered ended at a depot with your name on the gate, and the freight kept moving through two wars and a depression. You died at ninety-one, mid-sentence, dictating a route survey for a continent you would not live to cross.",
  ],
  industry: [
    "You did not spread — you deepened. The city grew around your works until the skyline was your balance sheet, and a handful of perfectly tuned routes out-earned entire networks twice their size. Universities taught your depot as a model of efficiency. You endowed the concert hall, married late and happily, and never once moved out of the town that made you.",
    "While the rivals chased every seam on the map, you rebuilt one city until its throughput was a legend. Freight that used to take a day cleared in an hour. The mayor gave you the keys, the workers gave you their loyalty, and the ledgers gave you more money than either could imagine.",
    "Your answer was always the same: make what you already have worth more. Tier after tier, the city rose, the base rate climbed, and a network nobody thought big enough won the territory outright. They put your face on the civic seal, and the trucks still run the routes you drew.",
  ],
};

const LOSS_EPILOGUES: Record<EndingPath, readonly string[]> = {
  paving: [
    "The rival's roads reached every market before yours. Your factory was auctioned in numbered lots, your rails rusted beneath weeds, and you spent eleven years contesting the foreclosure from a rented room above a shuttered depot. The rival used your old desk until retirement.",
    "One by one, carriers abandoned your broken lanes for the rival's shining network. Creditors took the house in spring and the company name in autumn. Years later, motorists crossed your first bridge every day without knowing who had built it.",
    "The map closed around you like a fist. Your last truck was sold for parts, your portrait came down from the boardroom, and the road crews painted over your company crest before sunrise. You died far from the territory, still carrying the first depot key in your coat.",
  ],
  plants: [
    "The rival's furnaces swallowed the contracts your plants needed to live. Your gates closed on a wet Tuesday, the payroll went unpaid, and the receivers sold the machinery by weight. The smokestack bearing your initials was the last thing demolished.",
    "Orders moved to the rival's newer plants until your great floor held only dust and pigeons. You blamed the banks, the unions, and the weather; history blamed you. The final company ledger listed your life's work as salvage.",
    "The rival expanded while you hesitated. By winter your workers crossed town to queue at the rival's gates, and your mansion looked down on dark chimneys. It became a boarding school; no room was ever named for you.",
  ],
  balanced: [
    "The rival beat you everywhere by just enough: one road sooner, one shift longer, one star more. Your directors signed the surrender before breakfast. You kept a ceremonial office for six months, then a smaller one, then none at all.",
    "Your empire did not collapse in a blaze; it vanished by subtraction. A depot sold here, a contract lost there, a trusted manager crossing the street to the rival. When the last sign came down, even the newspapers treated it as old news.",
    "You had built almost everything except the winning margin. The banks merged your company into the rival's concern and struck your name from the stationery. You lived long enough to watch their trucks use your roads more profitably than you ever had.",
  ],
  // L13 (#228): losing to breadth, and losing to depth.
  network: [
    "They reached every cargo on the island while you were still perfecting two. Each new depot of theirs closed another door you had been counting on, until your survey maps showed a territory entirely spoken for. The receivers were almost apologetic about it.",
    "The rival's network touched everything and needed nothing. Your best routes kept running and kept not mattering; there was simply no cargo left that only you could move. The company was wound up on a bright, ordinary Thursday.",
    "You watched them claim one industry after another and told yourself breadth was shallow. The final audit disagreed. Your remaining depots were sold to the concern that had surrounded them, and the new owners kept the roads and changed the signs.",
  ],
  industry: [
    "While you spread yourself across the map, the rival rebuilt one city until every route out of it was worth three of yours. Volume beat reach. Your creditors read the throughput figures, looked at your scattered depots, and stopped returning calls.",
    "Their city grew tiers you could not afford to answer, and each one made your widest network look like a hobby. The takeover was written up as a case study in patience. You were quoted once, in a footnote, complaining about the base rate.",
    "You had more depots than they did, right up to the end. They had a city that made theirs worth more. The difference closed over you quietly, and the works that beat you are still the largest employer in the territory.",
  ],
};

const TITLES: Record<"victory" | "defeat", Record<EndingPath, string>> = {
  victory: {
    paving: "The Asphalt Crown",
    plants: "An Empire of Smoke",
    balanced: "The Complete Empire",
    // L13 (#228): the new loop's two.
    network: "Every Cargo on the Island",
    industry: "The City That Paid for Itself",
  },
  defeat: {
    paving: "The Roads Closed In",
    plants: "The Furnaces Went Dark",
    balanced: "One Star Too Late",
    network: "Surrounded on Every Side",
    industry: "Outgrown by One City",
  },
};

function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const fmt = (value: number): string => {
  const rounded = Math.round(value * 100) / 100;
  return rounded.toFixed(2).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

/**
 * Actual games can earn at most a few plant stars, so "plant-led" means the
 * player built the full processing network (roughly 30% of the finish), not
 * that plant VP must exceed road VP. One or no expansion plants is a road win;
 * two is balanced; three-plus is industrial.
 */
export function endingPathFor(breakdown: EndingBreakdown): EndingPath {
  // L13 (#228): a new-loop ledger has the loop's own rows and none of the old
  // ones, so the winner is read on the axes it actually played — breadth (a
  // wide network of depot types) against depth (the city and the tree).
  const typeVp = breakdown.typeVp ?? 0;
  // 2026-09: paved routes are depth too — fewer Depots, better roads.
  const depthVp = (breakdown.rungVp ?? 0) + (breakdown.cityVp ?? 0) + (breakdown.routeVp ?? 0);
  const loopTotal = typeVp + depthVp;
  const isLoop = breakdown.loop ?? (breakdown.typeVp !== undefined
    || breakdown.rungVp !== undefined || breakdown.cityVp !== undefined);
  // A loop ledger that scored nothing at all still reads on the loop's axes:
  // "balanced" is the honest answer, not the shipped loop's paving verdict.
  if (isLoop && loopTotal <= 0) return "balanced";
  if (loopTotal > 0) {
    const depthShare = depthVp / loopTotal;
    if (depthShare >= 0.45) return "industry";
    if (depthShare <= 0.2) return "network";
    return "balanced";
  }
  const total = breakdown.pavedVp + breakdown.plantVp;
  if (total <= 0) return "balanced";
  const plantShare = breakdown.plantVp / total;
  if (breakdown.plants >= 3 || plantShare >= 0.28) return "plants";
  if (breakdown.plants <= 1 || plantShare <= 0.12) return "paving";
  return "balanced";
}

function methodText(path: EndingPath, won: boolean): string {
  const who = won ? "You" : "The rival";
  if (path === "paving") {
    return `${who} won on the network: mile after mile of upgraded road turned Ore into an unanswerable lead.`;
  }
  if (path === "plants") {
    return `${who} won through industrial expansion: a chain of processing plants supplied the stars that broke the race open.`;
  }
  // L13 (#228): the new loop's two methods.
  if (path === "network") {
    return `${who} won on breadth: depot after depot, until nearly every cargo on the island was running into ${won ? "your" : "their"} yards.`;
  }
  if (path === "industry") {
    return `${who} won on depth: a city upgraded tier by tier made a compact network out-earn anything wider.`;
  }
  return `${who} won with a complete system: paved arteries and new processing plants carried the load together.`;
}

function decisiveText(source: DecisiveSource, won: boolean): string {
  const who = won ? "Your" : "The rival's";
  if (source === "plant") {
    return `${who} final star arrived when the newest processing plant opened its gates.`;
  }
  if (source === "upgrade") {
    return `${who} winning margin came from fresh pavement—the last quarter-star clicked into place on the road.`;
  }
  if (source === "platform") {
    return `${who} final star was the new railway platform opening for business.`;
  }
  // L13 (#228): the new loop's three.
  if (source === "type") {
    return `${who} final stars came the moment a new kind of cargo started running into the yards.`;
  }
  if (source === "level") {
    return `${who} final star was a Depot upgraded to the top level.`;
  }
  if (source === "route") {
    return `${who} final star was a route paved end to end — the last stretch of gravel gone.`;
  }
  if (source === "rung") {
    return `${who} last session on the plant floor opened the rung that settled it.`;
  }
  if (source === "city") {
    return `${who} winning margin was the city itself—the newest upgrade lifted every route at once.`;
  }
  // B7 (#252): a contested site held by battle.
  if (source === "hold") {
    return `${who} final star was won across a board, not a map — a contested site held in battle.`;
  }
  return `${who} network crossed the star line and the territory had its answer.`;
}

function rivalryCoda(input: EndingInput): string | null {
  const yours = input.playerSabotage ?? 0;
  const theirs = input.rivalSabotage ?? 0;
  if (input.playerWon && yours >= 3) {
    return "The Senate hearings mentioned blockades, frozen machinery, and several missing invoices. Nothing was ever proved, and your victory portrait remained in the lobby.";
  }
  if (input.playerWon && theirs >= 3) {
    return "The papers called it the impossible shift: sabotage struck again and again, yet your crews kept every essential line alive until the winning cargo came through.";
  }
  if (!input.playerWon && yours >= 3) {
    return "The Black Market ledgers survived the collapse. They did not save the company, but they ensured polite society never again invited you to dinner.";
  }
  if (!input.playerWon && theirs >= 3) {
    return "Years later you still insisted the race had been stolen in smoke, ice, and midnight blockades. The official histories gave the complaint one footnote.";
  }
  return input.difficulty
    ? `The record books marked the contest against a ${input.difficulty.toLowerCase()} rival. They did not record how personal it became.`
    : null;
}

/**
 * L13 (#228): the ledger's rows, for whichever ★ table this match was played
 * under. A new-loop ledger has `typeVp`/`rungVp`/`cityVp` on it and is printed
 * with the loop's three sources; a shipped-loop one keeps the two rows it
 * always had. The test for "which loop is this" is the presence of the loop
 * rows themselves, so no flag has to be threaded down here.
 */
export function ledgerRows(b: EndingBreakdown): EndingScoreRow[] {
  // The flag when the scorer set it; otherwise a hand-built ledger (tests,
  // previews) is a loop one exactly when it carries the loop's own rows.
  const isLoop = b.loop ?? (b.typeVp !== undefined || b.rungVp !== undefined || b.cityVp !== undefined);
  if (isLoop) {
    const types = b.types ?? 0, city = b.city ?? 0, routes = b.routes ?? 0;
    const holds = b.holds ?? 0;
    // B7 (#252): the battle row only when battles paid — a match won without
    // fighting reads exactly as it did before (the three-row ledger).
    const held: EndingScoreRow[] = (b.holdVp ?? 0) > 0 ? [{
      key: "holds",
      icon: "⚔",
      label: "Contested sites held",
      detail: `${holds} site${holds === 1 ? "" : "s"} won in battle (capped)`,
      vp: b.holdVp ?? 0,
    }] : [];
    // 2026-09 (owner's table): depots, paved routes, city tiers.
    return [
      {
        key: "types",
        icon: "⬢",
        label: "Depots running",
        detail: `${types} Depot${types === 1 ? "" : "s"} connected and producing`,
        vp: b.typeVp ?? 0,
      },
      {
        key: "routes",
        icon: "═",
        label: "Fully paved routes",
        detail: `${routes} Depot route${routes === 1 ? "" : "s"} paved end to end`,
        vp: b.routeVp ?? 0,
      },
      {
        key: "city",
        icon: "▰",
        label: "City upgrades",
        detail: `${city} tier${city === 1 ? "" : "s"} raising the base rate`,
        vp: b.cityVp ?? 0,
      },
      ...held,
    ];
  }
  return [
    {
      key: "paving",
      icon: "◆",
      label: "Paved network",
      detail: `${b.paved} tile${b.paved === 1 ? "" : "s"} × 0.25★`,
      vp: b.pavedVp,
    },
    {
      key: "plants",
      icon: "▰",
      label: "Expansion plants",
      detail: `${b.plants} plant${b.plants === 1 ? "" : "s"} × 1★`,
      vp: b.plantVp,
    },
  ];
}

/** Build the complete, deterministic intertitle shown when the star line falls. */
export function buildEnding(input: EndingInput): EndingModel {
  const outcome = input.playerWon ? "victory" : "defeat";
  const winnerBreakdown = input.playerWon ? input.playerBreakdown : input.rivalBreakdown;
  const path = endingPathFor(winnerBreakdown);
  const deck = input.playerWon ? WIN_EPILOGUES[path] : LOSS_EPILOGUES[path];
  const rivalName = input.rivalName?.trim() || "Rival";
  const rawVariant = input.variant ?? hashText([
    input.seed ?? 0, outcome, path,
    input.playerBreakdown.paved, input.playerBreakdown.plants,
    input.rivalBreakdown.paved, input.rivalBreakdown.plants,
  ].join(":"));
  const variant = ((Math.trunc(rawVariant) % deck.length) + deck.length) % deck.length;
  const playerScore = input.playerScore;
  const rivalScore = input.rivalScore;
  const result = input.playerWon
    ? `You reached ${fmt(playerScore)}★ first. ${rivalName} finished at ${fmt(rivalScore)}★.`
    : `${rivalName} reached ${fmt(rivalScore)}★ first. You finished at ${fmt(playerScore)}★.`;

  return {
    outcome,
    path,
    kicker: input.playerWon ? "Victory · The territory is yours" : "Defeat · Hostile takeover",
    title: TITLES[outcome][path],
    result,
    method: methodText(path, input.playerWon),
    decisive: decisiveText(input.decisiveSource ?? null, input.playerWon),
    rows: ledgerRows(winnerBreakdown),
    playerScore,
    rivalScore,
    rivalName,
    epilogue: deck[variant],
    coda: rivalryCoda(input),
    rivalQuote: input.playerWon
      ? "Enjoy the headlines. I have already started on the next map."
      : "The map was never big enough for both of us.",
    playerQuote: input.playerWon
      ? "That was almost gracious. Are you feeling all right?"
      : "You practiced that in the mirror, didn't you?",
    variant,
  };
}

/**
 * RANK-01: the rated-match row on the ledger — the badge, the number, and what
 * the match did to it. Built by `src/iso/game.ts` from the room's verdict; this
 * module only prints it.
 */
export interface EndingRankLine {
  /** Badge key (`src/assets/ui/rank/<key>.png`). */
  key: string;
  tierLabel: string;
  /** Rating after the match. */
  rating: number;
  before: number;
  /** Signed rating change. */
  delta: number;
  promoted: boolean;
  demoted: boolean;
  /** True when the match was decided by a departure rather than the star line. */
  forfeit: boolean;
  /** Still inside the placement matches. */
  provisional: boolean;
  /** False when the opponent's rating was unknown to the room. */
  opponentKnown: boolean;
}

export interface EndingScreenOptions {
  onRestart: () => void;
  onReview?: () => void;
  /** STORY-01: present adds a third door — back to the campaign menu with the
   *  contract recorded. Absent (every sandbox match) the ledger keeps its two. */
  onContinue?: () => void;
  /** The portrait selected on the start screen, reused whenever the player
   * answers Torvin's final wire. */
  playerPortrait?: "vex" | "you";
  /**
   * RANK-01: the rating row. Three states, and the difference matters:
   *
   *   undefined — this match is not rated: no row is drawn at all (every solo,
   *               story and casual room match);
   *   null      — rated, and the room has not filed the result yet: the row
   *               stands with a "filing" note, because a rated match that shows
   *               nothing reads like a rating system that did not work;
   *   a line    — the room's verdict, printed.
   *
   * The row opens in whichever state the ledger was built with and is filled in
   * later through `EndingScreenHandle.setRank` — the verdict normally arrives a
   * round trip after the ledger mounts.
   */
  rank?: EndingRankLine | null;
}

export interface EndingScreenHandle {
  element: HTMLElement;
  reopenButton: HTMLButtonElement;
  open: () => void;
  close: () => void;
  destroy: () => void;
  /**
   * RANK-01: fill (or replace) the rating row once the room has filed the
   * result. A no-op when the ledger was opened for an unrated match.
   */
  setRank: (line: EndingRankLine | null) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function appendFinalWire(
  host: HTMLElement,
  model: EndingModel,
  playerPortrait: "vex" | "you",
): void {
  const wire = el("div", "ending-final-wire");
  const addBeat = (
    speaker: "rival" | "player",
    portrait: string,
    text: string,
  ) => {
    const beat = el("div", `ending-final-beat ${speaker}`);
    const face = el("span", "ending-final-face");
    face.setAttribute("aria-hidden", "true");
    face.style.backgroundImage = `url(${portrait})`;
    beat.append(face, el("p", `ending-${speaker}-final`, text));
    wire.appendChild(beat);
  };
  addBeat("rival", portraitTorvin, `${model.rivalName}'s final wire: “${model.rivalQuote}”`);
  addBeat(
    "player",
    playerPortrait === "you" ? portraitYou : portraitVex,
    `Your reply: “${model.playerQuote}”`,
  );
  host.appendChild(wire);
}

function appendCelebration(host: HTMLElement): void {
  const layer = el("div", "ending-fireworks");
  layer.setAttribute("aria-hidden", "true");
  const bursts = [
    [13, 22, 0, 42], [31, 14, 0.55, 6], [52, 22, 1.1, 28],
    [72, 13, 0.25, 50], [88, 27, 1.45, 15], [22, 48, 1.8, 34],
    [79, 49, 0.9, 3],
  ] as const;
  for (const [x, y, delay, hue] of bursts) {
    const burst = el("span", "ending-firework");
    burst.style.setProperty("--x", `${x}%`);
    burst.style.setProperty("--y", `${y}%`);
    burst.style.setProperty("--delay", `${delay}s`);
    burst.style.setProperty("--hue", String(hue));
    for (let i = 0; i < 12; i++) {
      const spark = el("i", "ending-spark");
      spark.style.setProperty("--i", String(i));
      burst.appendChild(spark);
    }
    layer.appendChild(burst);
  }
  host.appendChild(layer);
}

function appendAsh(host: HTMLElement): void {
  const layer = el("div", "ending-ashes");
  layer.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 24; i++) {
    const ash = el("i", "ending-ash");
    ash.style.setProperty("--x", `${(i * 37) % 101}%`);
    ash.style.setProperty("--delay", `${-((i * 0.41) % 6)}s`);
    ash.style.setProperty("--drift", `${((i % 7) - 3) * 9}px`);
    ash.style.setProperty("--duration", `${4.8 + (i % 5) * 0.55}s`);
    layer.appendChild(ash);
  }
  host.appendChild(layer);
}

/**
 * RANK-01: the ledger's rating row. `line === null` is the pending state — the
 * room has not filed yet — and prints deliberately as work in progress rather
 * than as a zero, because a 0 rating is a number a player would believe.
 */
function appendRankRow(
  card: HTMLElement,
  line: EndingRankLine | null,
): { element: HTMLElement; fill: (line: EndingRankLine | null) => void } {
  const section = el("section", "ending-rank");
  section.setAttribute("aria-label", "Ranked rating");
  const fill = (value: EndingRankLine | null) => {
    section.replaceChildren();
    const badge = el("img", "ending-rank-badge");
    badge.alt = "";
    badge.setAttribute("aria-hidden", "true");
    badge.decoding = "async";
    const body = el("div", "ending-rank-body");
    if (!value) {
      // Rated, but the room has not answered yet. Prints as work in progress:
      // a zero here would be a number a player would believe.
      section.dataset.state = "pending";
      badge.src = badgeUrlFor(UNRANKED_KEY);
      body.appendChild(el("b", undefined, "Filed with the room…"));
      body.appendChild(el("small", undefined, "The rating lands as soon as both seats agree."));
      section.append(badge, body);
      return;
    }
    section.dataset.state = value.delta >= 0 ? "up" : "down";
    if (value.promoted) section.dataset.promoted = "1";
    if (value.demoted) section.dataset.demoted = "1";
    badge.src = badgeUrlFor(value.key);
    const headline = el("b", "ending-rank-headline");
    headline.append(
      el("span", "ending-rank-tier", value.tierLabel),
      el("span", "ending-rank-rating", fmt(value.rating)),
      el("span", `ending-rank-delta ${value.delta >= 0 ? "up" : "down"}`,
        `${value.delta >= 0 ? "+" : "−"}${Math.abs(Math.round(value.delta))}`),
    );
    body.appendChild(headline);
    const notes: string[] = [];
    if (value.promoted) notes.push(`Promoted to ${value.tierLabel}.`);
    else if (value.demoted) notes.push(`Relegated to ${value.tierLabel}.`);
    if (value.provisional) notes.push("Placement match.");
    if (!value.opponentKnown) notes.push("The rival's rating was unknown — a provisional number.");
    if (value.forfeit) notes.push("Filed by forfeit.");
    body.appendChild(el("small", "ending-rank-note",
      notes.length ? notes.join(" ") : `Rating ${fmt(value.before)} → ${fmt(value.rating)}.`));
    section.append(badge, body);
  };
  fill(line);
  card.appendChild(section);
  return { element: section, fill };
}

/**
 * Project an ending model as a full-screen movie intertitle. Celebration is
 * present only for a win; defeat gets falling ash. The explicit Review button
 * leaves a small "Final ledger" ticket behind so the ending is never lost.
 */
export function showEndingScreen(
  host: HTMLElement,
  model: EndingModel,
  options: EndingScreenOptions,
): EndingScreenHandle {
  host.querySelector("#iso-ending")?.remove();
  host.querySelector("#iso-ending-reopen")?.remove();

  const screen = el("section", `ending-screen ${model.outcome} path-${model.path}`);
  screen.id = "iso-ending";
  screen.dataset.outcome = model.outcome;
  screen.dataset.path = model.path;
  screen.dataset.variant = String(model.variant);
  screen.setAttribute("role", "dialog");
  screen.setAttribute("aria-modal", "true");
  screen.setAttribute("aria-labelledby", "iso-ending-title");

  const shade = el("div", "ending-shade");
  screen.appendChild(shade);

  const card = el("div", "ending-card");
  // Keep the atmospheric layer inside the card: on phone-sized screens the
  // card is nearly full bleed, so effects placed only behind it would exist in
  // the DOM but be completely hidden. Text sits one layer above in CSS.
  if (model.outcome === "victory") appendCelebration(card);
  else appendAsh(card);
  const kicker = el("p", "ending-kicker", model.kicker);
  const title = el("h1", "ending-title", model.title);
  title.id = "iso-ending-title";
  const result = el("p", "ending-result", model.result);
  const method = el("p", "ending-method", model.method);
  const decisive = el("p", "ending-decisive", model.decisive);
  card.append(kicker, title, result, method, decisive);

  const ledger = el("section", "ending-ledger");
  const ledgerOwner = model.outcome === "victory" ? "your" : `${model.rivalName}'s winning`;
  const ledgerHeading = `Where ${ledgerOwner} points came from`;
  ledger.setAttribute("aria-label", ledgerHeading);
  ledger.appendChild(el("h2", "ending-section-title", ledgerHeading));
  for (const row of model.rows) {
    const line = el("div", `ending-score-row score-${row.key}`);
    line.dataset.source = row.key;
    line.appendChild(el("span", "ending-score-icon", row.icon));
    const copy = el("span", "ending-score-copy");
    copy.appendChild(el("b", undefined, row.label));
    copy.appendChild(el("small", undefined, row.detail));
    line.appendChild(copy);
    line.appendChild(el("strong", "ending-score-vp", `${fmt(row.vp)}★`));
    ledger.appendChild(line);
  }
  const totals = el("div", "ending-score-total");
  totals.appendChild(el(
    "span",
    undefined,
    model.outcome === "victory" ? "Your final ledger" : `${model.rivalName}'s final ledger`,
  ));
  totals.appendChild(el(
    "strong",
    undefined,
    `${fmt(model.outcome === "victory" ? model.playerScore : model.rivalScore)}★`,
  ));
  ledger.appendChild(totals);
  card.appendChild(ledger);

  // RANK-01: the rating row stands between the ledger and the epilogue — the
  // score, then what the scoreboard did to the ladder, then what happened next.
  const rankRow = options.rank === undefined ? null : appendRankRow(card, options.rank);

  const after = el("section", "ending-after");
  after.appendChild(el("h2", "ending-section-title", "The years that followed"));
  after.appendChild(el("p", "ending-epilogue", model.epilogue));
  if (model.coda) after.appendChild(el("p", "ending-coda", model.coda));
  appendFinalWire(after, model, options.playerPortrait ?? "vex");
  card.appendChild(after);
  card.appendChild(el("p", "ending-the-end", "The End"));

  const actions = el("div", "ending-actions");
  const review = el(
    "button",
    "ending-button ending-review",
    model.outcome === "victory" ? "Tour your empire" : "Survey the wreckage",
  );
  review.type = "button";
  // SFX-01: Review steps OUT of the ledger, Restart opens a new one — the same
  // two cues the HUD's panels use, declared in markup so the document-wide
  // delegation (audio/sfx.ts) plays them without a handler here.
  review.dataset.sfx = "close";
  const restart = el(
    "button",
    "ending-button ending-restart",
    model.outcome === "victory" ? "Build another empire" : "Demand a rematch",
  );
  restart.type = "button";
  restart.dataset.sfx = "open";
  // STORY-01: the campaign's third door, between stepping out and starting
  // over — "back to the contracts" with this one filed in the record.
  const continueBtn = options.onContinue
    ? el("button", "ending-button ending-continue", "Continue the campaign ▸")
    : null;
  if (continueBtn) {
    continueBtn.type = "button";
    continueBtn.dataset.sfx = "open";
  }
  actions.append(review, ...(continueBtn ? [continueBtn] : []), restart);
  card.appendChild(actions);
  screen.appendChild(card);

  const reopen = el("button", "ending-reopen hidden", "★ Final ledger");
  reopen.id = "iso-ending-reopen";
  reopen.type = "button";
  reopen.title = "Open the final score and epilogue";
  reopen.dataset.sfx = "open";

  const open = () => {
    screen.classList.remove("hidden");
    reopen.classList.add("hidden");
    requestAnimationFrame(() => review.focus());
  };
  const close = () => {
    screen.classList.add("hidden");
    reopen.classList.remove("hidden");
    options.onReview?.();
    reopen.focus();
  };
  review.addEventListener("click", close);
  restart.addEventListener("click", options.onRestart);
  if (continueBtn && options.onContinue) {
    continueBtn.addEventListener("click", options.onContinue);
  }
  reopen.addEventListener("click", open);
  // The ledger's keyboard trap walks whatever doors this match actually has:
  // two in a sandbox match, three inside a contract.
  const doors = [review, ...(continueBtn ? [continueBtn] : []), restart];
  const onKey = (event: KeyboardEvent) => {
    if (screen.classList.contains("hidden")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    // This is the only modal layer left at match end. Keep keyboard focus on
    // its two choices until Review deliberately returns to the map.
    if (event.key === "Tab") {
      const active = document.activeElement;
      const at = doors.indexOf(active as HTMLButtonElement);
      const outside = at === -1;
      if (event.shiftKey && (outside || at === 0)) {
        event.preventDefault();
        doors[doors.length - 1].focus();
      } else if (!event.shiftKey && (outside || at === doors.length - 1)) {
        event.preventDefault();
        doors[0].focus();
      }
    }
  };
  document.addEventListener("keydown", onKey);

  host.append(screen, reopen);
  requestAnimationFrame(() => review.focus());

  return {
    element: screen,
    reopenButton: reopen,
    open,
    close,
    setRank: (line: EndingRankLine | null) => {
      // A no-op for an unrated ledger: the row was never drawn, so there is
      // nothing to fill.
      rankRow?.fill(line);
    },
    destroy: () => {
      document.removeEventListener("keydown", onKey);
      screen.remove();
      reopen.remove();
    },
  };
}
