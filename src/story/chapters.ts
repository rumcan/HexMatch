// ══════════════════════════════════════════════════════════════════════════
// STORY-01 — the campaign: five contracts, one season each, 1949.
//
// The shape of the arc: a new job at a struggling freight company — hired as
// Logistics Manager, promoted by every contract won (BACK TO WORK, the jam
// theme) — a bookkeeper who keeps it honest, and the five tycoons of the
// Foundry Syndicate who have already divided the island and are politely
// waiting for the new hire to fold. Every
// chapter is a LIVE match — the same map, board, economy and AI the sandbox
// game runs — wearing a contract: the rival's name and voice, the ★ line the
// chapter races to, the difficulty the rival plays at, and three scenes
// (the briefing before the boot prompts, the handshake after a win, the
// rally after a loss).
//
// Nothing here invents a rule. The copy teaches the ones the HUD already
// enforces — stars from paving and plants, the depot's 4×4 catchment, gold's
// sixth colour and its one purchase — because a story that lies about the
// game is worse than no story. `sceneIssues` in script.ts and the chapter
// test keep the copy welded to the cast, the backdrops and the skill table.
//
// Seeds are fixed per chapter on purpose: a contract is a place, and a place
// should not move between attempts. `?seed=` still overrides everything, and
// `?chapter=<id>` opens any contract for a playtest link without touching
// the saved campaign.
// ══════════════════════════════════════════════════════════════════════════
import type { SkillKey } from "../iso/skill";
import type { CastId } from "./cast";
import { say, narrate, title, type ScriptScene } from "./script";

export interface StoryChapter {
  id: string;
  /** 0-based position in the campaign — the unlock order and the progress key. */
  index: number;
  /** "CONTRACT I · BLACKWOOD FREIGHT". */
  kicker: string;
  name: string;
  /** The menu card's one-paragraph pitch. */
  brief: string;
  rival: CastId;
  skill: SkillKey;
  /** The ★ line this chapter races to (overrides the difficulty's own). */
  target: number;
  seed: number;
  /** The work order pinned over the table while the contract is open. */
  objective: string;
  /**
   * BACK TO WORK (the jam theme): the job the player holds while this
   * contract is open. The campaign is a career — hired as Logistics Manager
   * on day one, promoted by every contract won.
   */
  jobTitle: string;
  /** The job a win here promotes the player to (the next contract's title). */
  promotion: string;
  pre: ScriptScene;
  win: ScriptScene;
  lose: ScriptScene;
}

// ── I · FIRST DAY ON THE JOB (id: inheritance) ─────────────────────────────
const C1_PRE: ScriptScene = {
  id: "c1-pre",
  bg: "harbor",
  lines: [
    title("CHAPTER ONE · FIRST DAY ON THE JOB", "harbor"),
    narrate("The funeral was on a Tuesday. The job offer arrived on the Wednesday, in a brown envelope with a wax seal — and so did the debt."),
    say("mabel", "Morning, boss — or Logistics Manager, as the new sign on your door says. Mabel Quill: I kept your uncle's books for thirty years, and I mean to keep yours. He left the firm a dock, one processing plant that still runs, and a job nobody else would take. You took it."),
    say("player", "Day one, and already a debt?"),
    say("mabel", "The debt is a Syndicate matter. Which brings me to the gentleman who has been standing behind us since the quay.", "calm"),
    say("torvin", "Hextall. The dead man's new logistics manager, on my dock, in my weather.", "calm"),
    say("torvin", "Blackwood Freight paved this island while your uncle was still playing at carts. Five stars, child — that is all this little company is worth. I shall collect them personally.", "smile"),
    say("player", "Five stars. What a round number. Did you rehearse it?"),
    say("torvin", "I do not rehearse. I arrive.", "mad"),
    say("mabel", "Boss, the house rules, while he cools: stars are what a company is measured by. Pave your own dirt and every tile counts; raise a plant and each one is a star outright. Reach the line before he does."),
    say("mabel", "And the match-3 board is not a diversion, it is your freight desk — lorries load from it, and the cargo pays for everything else. I reconcile on Fridays.", "smile"),
    narrate("Somewhere down the dock, a freight whistle. Your first shift has started."),
  ],
};
const C1_WIN: ScriptScene = {
  id: "c1-win",
  bg: "harbor",
  lines: [
    say("torvin", "Five stars. In one season. On my dock.", "shock"),
    say("player", "Your dock? The sign says Hextall."),
    say("torvin", "Signs can be repainted.", "mad"),
    say("mabel", "They can — and he has just taught us how, boss. Contract one, closed in the black. The board has signed it already: you are Operations Manager now.", "smile"),
  ],
};
const C1_LOSE: ScriptScene = {
  id: "c1-lose",
  bg: "harbor",
  lines: [
    say("torvin", "Do not take it hard, child. Most new hires last two seasons. You lasted one and a half.", "smile"),
    say("player", "That is not comforting."),
    say("torvin", "It was not intended to be. I shall send a card at the half-season, next time.", "calm"),
    say("mabel", "The ledger opens again tomorrow, boss. Same dock, same plant, same us — and this time we read his pacing before he reads ours.", "calm"),
  ],
};

// ── II · THE TOLL KING ─────────────────────────────────────────────────────
const C2_PRE: ScriptScene = {
  id: "c2-pre",
  bg: "railyard",
  lines: [
    title("CHAPTER TWO · THE TOLL KING", "railyard"),
    narrate("Winter came early to the marshalling yard, and with the frost came a timetable."),
    say("mabel", "Congratulations on the promotion, Operations Manager. Your first memo: Meridian Rail Trust has posted a toll on every public highway we drive. Every one of them. Including the bridge we paid for.", "calm"),
    say("player", "Can he do that?"),
    say("marrow", "He can. He has. The notices are watermarked.", "calm"),
    say("marrow", "Hextall. Condolences on the bridge — my gate improves it. The paint alone adds a decade of life.", "smile"),
    say("player", "You gated a bridge in the middle of a contract."),
    say("marrow", "I gated it before the contract. Paper first, Hextall. Paper first, always.", "calm"),
    say("mabel", "His gates eat a margin off every haul, boss. Route around them on the public ring, or swallow the toll and out-earn him — six stars before his trust posts the next notice.", "mad"),
    say("marrow", "Six stars. I shall send flowers when you manage it. Pre-emptively.", "smile"),
  ],
};
const C2_WIN: ScriptScene = {
  id: "c2-win",
  bg: "town",
  lines: [
    narrate("On main street the toll gates came down at noon, to a queue of lorries and one very quiet minute book.", "town"),
    say("marrow", "My gates stood, and my ledger still lost. I am… unaccustomed.", "shock"),
    say("player", "There is a first time for everything, Silas."),
    say("marrow", "There is. Item nine: Hextall — nuisance, promoted to rival. Initialled.", "mad"),
    say("mabel", "He minuted you as a rival, boss. In ink. I have framed the page, beside the board's letter making you Director of Operations.", "smile"),
  ],
};
const C2_LOSE: ScriptScene = {
  id: "c2-lose",
  bg: "railyard",
  lines: [
    say("marrow", "The flowers were not pre-emptive after all. My error; the invoice stands.", "smile"),
    say("player", "You are billing me for sympathy."),
    say("marrow", "Line six: sympathy, handling. It is a real cost, Hextall.", "calm"),
    say("mabel", "We file this one under lessons, boss. The yard reopens at dawn, and so do we.", "calm"),
  ],
};

// ── III · BLACK GOLD ───────────────────────────────────────────────────────
const C3_PRE: ScriptScene = {
  id: "c3-pre",
  bg: "oilfield",
  lines: [
    title("CHAPTER THREE · BLACK GOLD", "oilfield"),
    narrate("South of the county the derricks went up like a rumour, and the rumour had a name."),
    say("roque", "Darling! You must be the new Director of Operations everyone is whispering about. I am Delphine Roque, and I am about to ruin you — socially, I mean. Commercially too. Both, ideally.", "smile"),
    say("player", "You bought the oil field across from my plant."),
    say("roque", "I bought the oil field, the road in front of your plant, and a very good band. In that order.", "calm"),
    say("mabel", "Boss, her crude floods the market every time she ships, and gold is the only cargo that buys Black Market trouble. If she takes seven stars first, our trouble arrives by tanker.", "calm"),
    say("roque", "Seven stars, sweetheart. Then I drill a well where your driveway was and call it a fountain.", "mad"),
    say("player", "You cannot drill on my driveway."),
    say("roque", "I can drill anywhere, darling. That is what makes it a driveway.", "smile"),
  ],
};
const C3_WIN: ScriptScene = {
  id: "c3-win",
  bg: "oilfield",
  lines: [
    say("roque", "My derricks, out-earned by a company that began the season with one plant and a funeral.", "shock"),
    say("player", "The funeral was excellent training, Delphine."),
    say("roque", "Darling, that was cold. I am keeping you. Contract closed — drinks are on my derrick.", "smile"),
    say("mabel", "She sent the drinks, boss. Actual drinks. The ledger does not know where to put them, and the board has put you down as Vice President of Freight.", "smile"),
  ],
};
const C3_LOSE: ScriptScene = {
  id: "c3-lose",
  bg: "oilfield",
  lines: [
    say("roque", "Do not sulk, darling, sulking rusts the trucks. I won fair, and I intend to gloat beautifully.", "smile"),
    say("player", "Gloat quietly, please."),
    say("roque", "Quietly is a form of gloating, sweetheart. Watch me.", "calm"),
    say("mabel", "We reopen the field at first light, boss. She keeps her seven stars; we keep our appetite.", "calm"),
  ],
};

// ── IV · STONE & THUNDER ───────────────────────────────────────────────────
const C4_PRE: ScriptScene = {
  id: "c4-pre",
  bg: "quarry",
  lines: [
    title("CHAPTER FOUR · STONE & THUNDER", "quarry"),
    narrate("The quarry had been silent for nine years. Then Krag came back, and the hill began to move."),
    say("krag", "Hextall. Your trucks are on my hill.", "calm"),
    say("player", "The hill is public land, Krag."),
    say("krag", "Hill does not know that. Hill knows my drills.", "mad"),
    say("mabel", "A Vice President of Freight holds the line, boss, and this line is a hill. He expands twice as fast as anyone I have ever booked, and he paves in stone. Seven stars, or the quarry closes us out.", "calm"),
    say("mabel", "Do not race his builds — race the map. Every tile of dirt you pave is a star he has to answer with a convoy.", "mad"),
    say("krag", "Stone stays. You go fast. We see which is which.", "smile"),
  ],
};
const C4_WIN: ScriptScene = {
  id: "c4-win",
  bg: "quarry",
  lines: [
    say("krag", "Hm. Your roads stood through the blast. Good roads.", "shock"),
    say("player", "Thank you, Krag. That was praise, I think."),
    say("krag", "Praise is a rock thing. You earned marble.", "calm"),
    say("mabel", "Marble, boss! I am entering it as an asset, and the board is entering you as Managing Director.", "smile"),
  ],
};
const C4_LOSE: ScriptScene = {
  id: "c4-lose",
  bg: "quarry",
  lines: [
    say("krag", "Rock fell on your season. Happens.", "calm"),
    say("player", "Your rock."),
    say("krag", "My rock. Retry when the dust settles. Stone waits.", "smile"),
    say("mabel", "He waits, boss. So do the books. Dawn, then.", "calm"),
  ],
};

// ── V · THE CHAIRMAN'S LEDGER ──────────────────────────────────────────────
const C5_PRE: ScriptScene = {
  id: "c5-pre",
  bg: "boardroom",
  lines: [
    title("CHAPTER FIVE · THE CHAIRMAN'S LEDGER", "boardroom"),
    narrate("The Syndicate did not send a rival this time. It sent the Chairman."),
    say("griev", "Managing Director Hextall. Sit. The Syndicate has reviewed your career and found it irregular. Promotion, without membership, is irregular.", "calm"),
    say("player", "I was not aware success required membership."),
    say("griev", "Nothing requires membership, Hextall. Everything accrues interest without it.", "smile"),
    say("mabel", "Boss, he holds every toll, every tariff and half the bank. Eight stars — the full line — or the Syndicate minutes us into receivership.", "mad"),
    say("griev", "Eight stars. Then the chair adjourns, and your name enters the book. Under ‘assets’.", "calm"),
    say("player", "I would rather be under ‘rivals’."),
    say("griev", "Rivals are minuted too, Hextall. Rivals are expensed.", "mad"),
  ],
};
const C5_WIN: ScriptScene = {
  id: "c5-win",
  bg: "boardroom",
  lines: [
    say("griev", "The line is crossed. The minute book records a new name beside my own; I do not recall approving it.", "shock"),
    say("player", "It was minuted, Chairman. Item one: Hextall — winner, ongoing."),
    say("griev", "…Initialled. The Syndicate adjourns. I do not adjourn, Hextall — I concede. Once, in writing.", "smile"),
    say("mabel", "Boss. The whole line: every star, every plant, every mile. The board has made you Chairman of the Board — hired as Logistics Manager, and you earned every desk on the way up. The books are closed. They are beautiful.", "smile"),
    narrate("The years that followed kept their promises — the freight whistle beyond the garden, the flags at half-mast one distant morning, and always the lamp on the desk where it started.", "skyline"),
  ],
};
const C5_LOSE: ScriptScene = {
  id: "c5-lose",
  bg: "boardroom",
  lines: [
    say("griev", "The motion carries. Hextall Freight enters receivership at midnight — gracefully, as proposed.", "calm"),
    say("player", "Gracefully. Of course."),
    say("griev", "Grace is clause twelve. You were read clause twelve.", "smile"),
    say("mabel", "One more season, boss. The ledger and I are not finished, and neither are you.", "calm"),
  ],
};

export const CHAPTERS: readonly StoryChapter[] = [
  {
    id: "inheritance", index: 0,
    kicker: "CONTRACT I · BLACKWOOD FREIGHT",
    name: "First Day on the Job",
    brief: "Your first day as Logistics Manager at Hextall Freight: your late uncle's dock, one working plant, and an old baron who has already measured the company for a coffin. Learn the loop — plant, depot, road, board — and take five stars before he collects them.",
    rival: "torvin", skill: "easy", target: 5, seed: 19491,
    objective: "Contract I — reach 5★ before Torvin's old empire does.",
    jobTitle: "Logistics Manager", promotion: "Operations Manager",
    pre: C1_PRE, win: C1_WIN, lose: C1_LOSE,
  },
  {
    id: "toll-king", index: 1,
    kicker: "CONTRACT II · MERIDIAN RAIL TRUST",
    name: "The Toll King",
    brief: "Silas Marrow has gated every public highway on the island, including the bridge you paid for. Route around his paper, or swallow the tolls and out-earn him anyway.",
    rival: "marrow", skill: "normal", target: 6, seed: 19492,
    objective: "Contract II — out-earn the Toll King to 6★.",
    jobTitle: "Operations Manager", promotion: "Director of Operations",
    pre: C2_PRE, win: C2_WIN, lose: C2_LOSE,
  },
  {
    id: "black-gold", index: 2,
    kicker: "CONTRACT III · ROQUE BLACK GOLD",
    name: "Black Gold",
    brief: "Delphine Roque bought the field, the road and the band. Her crude floods the market and her gold buys the Black Market — seven stars before her trouble arrives by tanker.",
    rival: "roque", skill: "normal", target: 7, seed: 19493,
    objective: "Contract III — beat the Oil Queen to 7★.",
    jobTitle: "Director of Operations", promotion: "Vice President of Freight",
    pre: C3_PRE, win: C3_WIN, lose: C3_LOSE,
  },
  {
    id: "stone-thunder", index: 3,
    kicker: "CONTRACT IV · STONE & THUNDER CO.",
    name: "Stone & Thunder",
    brief: "The quarry is open and the hill is moving. Krag expands twice as fast as anyone and paves in stone — so do not race his builds. Race the map.",
    rival: "krag", skill: "hard", target: 7, seed: 19494,
    objective: "Contract IV — outlast the Quarry King to 7★.",
    jobTitle: "Vice President of Freight", promotion: "Managing Director",
    pre: C4_PRE, win: C4_WIN, lose: C4_LOSE,
  },
  {
    id: "chairmans-ledger", index: 4,
    kicker: "CONTRACT V · THE FOUNDRY SYNDICATE",
    name: "The Chairman's Ledger",
    brief: "No rival this time — the Chairman himself, with every toll, every tariff and half the bank in his minute book. The full line: eight stars, or receivership, gracefully.",
    rival: "griev", skill: "hard", target: 8, seed: 19495,
    objective: "Contract V — the full line: 8★ before the Syndicate adjourns.",
    jobTitle: "Managing Director", promotion: "Chairman of the Board",
    pre: C5_PRE, win: C5_WIN, lose: C5_LOSE,
  },
];

export const chapterById = (id: string): StoryChapter | null =>
  CHAPTERS.find((c) => c.id === id) ?? null;

/** The firm the player works for; job lines read "<title>, Hextall Freight". */
export const EMPLOYER = "Hextall Freight";

/**
 * BACK TO WORK: the player's current job, read from the campaign results —
 * the promotion earned by the furthest contract won, else the first day's
 * title. A loss never demotes: it only means that contract is still open.
 */
export function currentJobTitle(results: Readonly<Record<string, string>>): string {
  let title = CHAPTERS[0].jobTitle;
  for (const c of CHAPTERS) if (results[c.id] === "win") title = c.promotion;
  return title;
}

/** Every scene in the campaign, in the order the player meets them. */
export const allChapterScenes = (): readonly ScriptScene[] =>
  CHAPTERS.flatMap((c) => [c.pre, c.win, c.lose]);
