// ══════════════════════════════════════════════════════════════════════════
// STORY-01 — the opening reel: one skippable cinematic before contract I.
//
// The brief, taken literally: "skippable intro sequence with beautiful
// backgrounds". So — four painted plates, a title card, and the whole
// premise in under a minute of reading: who you are, who Mabel is, what the
// Syndicate wants, and what a star is worth. It plays ONCE (watched or
// skipped both count as seen — the skip is a choice, not an interruption),
// it is replayable from the campaign menu, and `?storyintro=0` keeps it out
// of a playtest link's way.
//
// It is deliberately the campaign's only scene that is not a contract: no
// rival voice deck, no outcome, no progress write except `introSeen`.
// ══════════════════════════════════════════════════════════════════════════
import { say, narrate, title, type ScriptScene } from "./script";

export const INTRO_SCENE: ScriptScene = {
  id: "intro",
  bg: "harbor",
  lines: [
    title("HEXMATCH INDUSTRIES", "harbor"),
    narrate("1949. The war is over, the freight is not, and the island runs on whoever moves it first."),
    narrate("On the docks of a town the maps call merely ‘the fourth town’, a small concern called Hextall Freight has just changed hands — badly, and in writing."),
    say("mabel", "Mind the step, boss. The office is where it always was: above the dock, under the leak, behind the ledger.", "calm", "boardroom"),
    say("mabel", "Your uncle kept two things in this room. A lamp that works, and a debt that does not sleep. I am Mabel Quill — I kept his books. I mean to keep yours.", "calm"),
    say("player", "How bad is it, Mabel?"),
    say("mabel", "Bad enough that the Foundry Syndicate voted on us twice this month. Nobody votes on a company it does not intend to own.", "mad"),
    narrate("The Syndicate: five tycoons who divided the island's freight between them before the war, and have been filing the paperwork ever since."),
    say("torvin", "The new Hextall. Come to sign the dock away, have you? Saves me the stamp.", "smile", "railyard"),
    say("marrow", "Condolences, Hextall. On the uncle, and on the bridge. My gate improves both.", "calm"),
    say("roque", "Darling, if you fold, fold toward me — I buy docks from people I like.", "smile", "oilfield"),
    say("krag", "Hill says you are small. Hill is usually right.", "calm", "quarry"),
    say("griev", "The chair recognises the heir. The Syndicate will watch your season with interest. Interest, Hextall, is a charge.", "calm", "boardroom"),
    say("mabel", "Let them watch, boss. Stars are how this island scores a company — pave your dirt, raise your plants, and every star is a line in OUR ledger, not theirs.", "smile"),
    say("mabel", "Five contracts stand between this leaky office and the Chairman's own minute book. I have filed them in order of rudeness."),
    title("THE FOUNDRY SYNDICATE · A CAMPAIGN IN FIVE CONTRACTS", "skyline"),
  ],
};
