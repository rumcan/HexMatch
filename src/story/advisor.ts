// STORY-01 — the guide: Mabel Quill, in-game. L15 rewrite: new loop only.
// No tokens, no bank, no blessings, no board sabotage. Loop: road/rail to city/depot,
// match-3 when building depot sets yield, resources tick via yield×distance×road/rail,
// spend on depot tree + city upgrades.
import type { StoryChapter } from "./chapters";

export type AdvisorBeat = { speaker: "guide" | "player"; text: string };
export type AdvisorEvent =
  | "welcome" | "stalled" | "sabotaged" | "halfway" | "behind" | "gold";

export const ADVISOR_EVENTS: readonly AdvisorEvent[] = [
  "welcome", "stalled", "sabotaged", "halfway", "behind", "gold",
];

const g = (text: string): AdvisorBeat => ({ speaker: "guide", text });
const p = (text: string): AdvisorBeat => ({ speaker: "player", text });

const WELCOME: Record<string, readonly AdvisorBeat[]> = {
  inheritance: [
    g("First contract, boss: stand a Depot inside an industry's 4×4 catchment, drag a road to the city, then tune it. Yield times distance times road — that's the whole payslip."),
    p("And if I get lost halfway?"),
    g("Then I say it again, here and in the Feed. Repetition is a bookkeeper's love language."),
  ],
  "toll-king": [
    g("Marrow's gates sit on the public highways, boss — but the town ring roads are neutral and toll-free. Route around his paper where you can; swallow a toll only where the haul pays for it."),
    p("Six stars, around a man who sells roads."),
    g("Then six stars it is. I have pencilled it in ink."),
  ],
  "black-gold": [
    g("Roque ships crude in waves, boss — when her lorries move, the market floods. Watch her cadence and price Security Forces early: her crews travel by tanker."),
    p("Noted. No parties on my depot."),
    g("None on mine either, boss. Hers arrive uninvited."),
  ],
  "stone-thunder": [
    g("Krag expands twice as fast as anyone alive, boss — so do not race his builds. Race the map: every new cargo type you run scores, and every city tier you buy scores. His convoys do not buy your city."),
    p("Types and city, not tiles. I can do that."),
    g("You can. I have costed it; the city agrees."),
  ],
  "chairmans-ledger": [
    g("The full line, boss: eight stars. Run new cargo types, unlock depot-tree rungs, raise the city, lay platforms — and keep Security on the books against his audits. The Chairman expenses everything except what he cannot reach."),
    p("Then we will be unreachable."),
    g("That is the entire plan, boss. I have minuted it."),
  ],
};

const GENERIC: Record<Exclude<AdvisorEvent, "welcome">, readonly AdvisorBeat[]> = {
  stalled: [
    g("Boss, the depots are idle: a Depot with no road to the city is a shed with views. Drag the road and the clock starts ticking."),
    p("On it. Shed with views is going in the company motto."),
  ],
  sabotaged: [
    g("That was his crew on our roads, boss. Security Forces pay for themselves the first time they catch one — and they cost materials, not gold."),
    p("Materials, then. Put two on the night shift."),
  ],
  halfway: [
    g("Half the line, boss. Stars grow on types running, rungs unlocked and city tiers raised — keep the network live and I will hold our breath politely."),
  ],
  behind: [
    g("He is clear on stars, boss — ugly, but survivable. Every new cargo type you run scores, and every city tier you buy scores. The map is still full of your stars."),
    p("Then the map is my comeback. Thank you, Mabel."),
  ],
  gold: [
    g("A gold depot, boss? Mind the fine print: gold drops a sixth colour into the tuning board — harder matches — and it buys exactly one thing. Black Market trouble."),
    p("Trouble, aimed on purpose. I can work with that."),
  ],
};

export function advisorBeats(event: AdvisorEvent, chapter: StoryChapter | null): readonly AdvisorBeat[] {
  if (event === "welcome") return WELCOME[chapter?.id ?? ""] ?? WELCOME.inheritance;
  return GENERIC[event];
}
