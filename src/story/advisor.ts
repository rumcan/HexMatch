// ══════════════════════════════════════════════════════════════════════════
// STORY-01 — the guide: Mabel Quill, in-game.
//
// The cutscenes introduce her; this module is her job. A helpful guide is
// not a tutorial modal nobody reads — it is a voice that arrives at the
// moment the player is actually stuck, on the same two-portrait wire the
// rivalry already uses, in the patina keyline reserved for the office. Six
// moments, each one keyed to a real game state the frame loop can see:
//
//   welcome    play begins — the chapter's own tactic, in her voice
//   stalled    90s into play and the player still has no Depot: the loop's
//              missing hinge, named plainly
//   sabotaged  the first rival raid that lands — and what stops the next one
//   halfway    half the chapter's ★ line: keep going, and how
//   behind     the rival is 3★+ clear late: the honest way back (paving)
//   gold       the player stood a Depot at the Gold Mine: the sixth colour
//              and the one thing gold buys, before it surprises them
//
// Every line is DATA here and pure: `advisorBeats(event, chapter)` returns
// the beats, game.ts decides WHEN, and the player's `?advisor=0` / stored
// word decides WHETHER (progress.ts owns both). Each event fires ONCE per
// match — a guide who repeats herself is a nag with a portrait.
// ══════════════════════════════════════════════════════════════════════════
import type { StoryChapter } from "./chapters";

export type AdvisorBeat = { speaker: "guide" | "player"; text: string };
export type AdvisorEvent =
  | "welcome" | "stalled" | "sabotaged" | "halfway" | "behind" | "gold";

export const ADVISOR_EVENTS: readonly AdvisorEvent[] = [
  "welcome", "stalled", "sabotaged", "halfway", "behind", "gold",
];

const g = (text: string): AdvisorBeat => ({ speaker: "guide", text });
const p = (text: string): AdvisorBeat => ({ speaker: "player", text });

/** The chapter briefing's tactic line, per contract — her voice, the rules' numbers. */
const WELCOME: Record<string, readonly AdvisorBeat[]> = {
  inheritance: [
    g("First contract, boss: raise the plant beside a town, stand a Depot inside an industry's 4×4 catchment, then drag a road between them. The board does the rest."),
    p("And if I get lost halfway?"),
    g("Then I say it again, here and in the Feed. Repetition is a bookkeeper's love language."),
  ],
  "toll-king": [
    g("Marrow's gates sit on the public highways, boss — but the town ring roads are neutral and toll-free. Route around his paper where you can; swallow a toll only where the haul pays for it."),
    p("Six stars, around a man who sells roads."),
    g("Then six stars it is. I have pencilled it in ink."),
  ],
  "black-gold": [
    g("Roque ships crude in waves, boss — when her lorries move, the market floods. Watch her cadence and sell in her gaps. And price Security Forces early: her crews travel by tanker."),
    p("Noted. No parties on my depot."),
    g("None on mine either, boss. Hers arrive uninvited."),
  ],
  "stone-thunder": [
    g("Krag expands twice as fast as anyone alive, boss — so do not race his builds, you will lose a footrace to a mountain. Race the map: every dirt tile you pave scores and his convoys do not."),
    p("Pave while he quarries. I can pave."),
    g("You can. I have costed it; the asphalt agrees."),
  ],
  "chairmans-ledger": [
    g("The full line, boss: eight stars. Bank your combos for gold, keep Security on the books against his ‘audits’, and pave every spare tile — the Chairman expenses everything except what he cannot reach."),
    p("Then we will be unreachable."),
    g("That is the entire plan, boss. I have minuted it."),
  ],
};

const GENERIC: Record<Exclude<AdvisorEvent, "welcome">, readonly AdvisorBeat[]> = {
  stalled: [
    g("Boss, the lorries are idle: a Depot with no road to the plant is a shed with views. Drag the road and the board starts loading."),
    p("On it. Shed with views is going in the company motto."),
  ],
  sabotaged: [
    g("That was his crew on our board, boss. Security Forces pay for themselves the first time they catch one — and they cost materials, not gold."),
    p("Materials, then. Put two on the night shift."),
  ],
  halfway: [
    g("Half the line, boss. Stars grow on asphalt and in plant chimneys — keep paving and the ledger and I will hold our breath politely."),
  ],
  behind: [
    g("He is clear on stars, boss — ugly, but survivable. Every dirt tile YOU pave scores and none of his do. The map is still full of your stars."),
    p("Then the map is my comeback. Thank you, Mabel."),
  ],
  gold: [
    g("A gold depot, boss? Mind the fine print: gold drops a sixth colour into our board — harder matches — and it buys exactly one thing. Black Market trouble."),
    p("Trouble, aimed on purpose. I can work with that."),
  ],
};

/**
 * The beats for one advisor moment. `welcome` reads the chapter's own tactic
 * (a chapter without one falls back to the loop lesson); every other event
 * is campaign-wide, because being stuck is not chapter-specific.
 */
export function advisorBeats(event: AdvisorEvent, chapter: StoryChapter | null): readonly AdvisorBeat[] {
  if (event === "welcome") return WELCOME[chapter?.id ?? ""] ?? WELCOME.inheritance;
  return GENERIC[event];
}
