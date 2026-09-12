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

export type EndingPath = "paving" | "plants" | "balanced";
export type DecisiveSource = "upgrade" | "plant" | null;

export interface EndingBreakdown {
  paved: number;
  plants: number;
  pavedVp: number;
  plantVp: number;
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
  key: "paving" | "plants";
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
};

const TITLES: Record<"victory" | "defeat", Record<EndingPath, string>> = {
  victory: {
    paving: "The Asphalt Crown",
    plants: "An Empire of Smoke",
    balanced: "The Complete Empire",
  },
  defeat: {
    paving: "The Roads Closed In",
    plants: "The Furnaces Went Dark",
    balanced: "One Star Too Late",
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
    rows: [
      {
        key: "paving",
        icon: "◆",
        label: "Paved network",
        detail: `${winnerBreakdown.paved} tile${winnerBreakdown.paved === 1 ? "" : "s"} × 0.25★`,
        vp: winnerBreakdown.pavedVp,
      },
      {
        key: "plants",
        icon: "▰",
        label: "Expansion plants",
        detail: `${winnerBreakdown.plants} plant${winnerBreakdown.plants === 1 ? "" : "s"} × 1★`,
        vp: winnerBreakdown.plantVp,
      },
    ],
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

export interface EndingScreenOptions {
  onRestart: () => void;
  onReview?: () => void;
}

export interface EndingScreenHandle {
  element: HTMLElement;
  reopenButton: HTMLButtonElement;
  open: () => void;
  close: () => void;
  destroy: () => void;
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

  const after = el("section", "ending-after");
  after.appendChild(el("h2", "ending-section-title", "The years that followed"));
  after.appendChild(el("p", "ending-epilogue", model.epilogue));
  if (model.coda) after.appendChild(el("p", "ending-coda", model.coda));
  after.appendChild(el("p", "ending-rival-final", `${model.rivalName}'s final wire: “${model.rivalQuote}”`));
  after.appendChild(el("p", "ending-player-final", `Your reply: “${model.playerQuote}”`));
  card.appendChild(after);
  card.appendChild(el("p", "ending-the-end", "The End"));

  const actions = el("div", "ending-actions");
  const review = el(
    "button",
    "ending-button ending-review",
    model.outcome === "victory" ? "Tour your empire" : "Survey the wreckage",
  );
  review.type = "button";
  const restart = el(
    "button",
    "ending-button ending-restart",
    model.outcome === "victory" ? "Build another empire" : "Demand a rematch",
  );
  restart.type = "button";
  actions.append(review, restart);
  card.appendChild(actions);
  screen.appendChild(card);

  const reopen = el("button", "ending-reopen hidden", "★ Final ledger");
  reopen.id = "iso-ending-reopen";
  reopen.type = "button";
  reopen.title = "Open the final score and epilogue";

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
  reopen.addEventListener("click", open);
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
      if (event.shiftKey && (active === review || !screen.contains(active))) {
        event.preventDefault();
        restart.focus();
      } else if (!event.shiftKey && (active === restart || !screen.contains(active))) {
        event.preventDefault();
        review.focus();
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
    destroy: () => {
      document.removeEventListener("keydown", onKey);
      screen.remove();
      reopen.remove();
    },
  };
}
