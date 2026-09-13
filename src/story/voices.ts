// ══════════════════════════════════════════════════════════════════════════
// STORY-01 — the rivals' voices: one deck per campaign rival.
//
// Torvin keeps his deck in `src/iso/rivalry.ts` — five tactics of collapsing
// threats, written when he was the only rival the game had. The campaign adds
// four more tycoons, and a rival whose every line sounds like Torvin is not a
// rival, so each of them gets a deck here in the same shape and under the
// same three rules the original obeys:
//
//   1. A scene always STARTS with the rival and ENDS with the player
//      puncturing it. The wire is a two-way telephone; a threat unanswered
//      is a threat that landed.
//   2. Beats alternate speakers, never twice in a row — the projector paints
//      one face per beat and the change of face IS the change of speaker.
//   3. Nothing here touches simulation RNG. `createStoryDirector` hashes
//      (seed, call count) exactly like `createRivalDirector`, so a joke can
//      never move a lorry.
//
// Directions mean what the Black Market means by them: `attack` = the rival's
// sabotage just landed on you, `retort` = yours landed on them, `thwarted` =
// your Security Forces caught theirs mid-job, `banter` = the idle wire
// between set-pieces. A rival with no deck for a direction falls through to
// Torvin's — which only Torvin ever needs, since he is the only rival whose
// deck lives elsewhere.
// ══════════════════════════════════════════════════════════════════════════
import {
  createBanterDirector, createRivalDirector,
  type RivalryDirection, type RivalryScene, type RivalryTactic,
} from "../iso/rivalry";
import type { CastId } from "./cast";

export interface RivalVoice {
  attack: readonly RivalryScene[];
  retort: readonly RivalryScene[];
  thwarted: readonly RivalryScene[];
  banter: readonly RivalryScene[];
}

/** The wire's four moods: the Black Market's three, plus the idle wire. */
export type StoryDirection = RivalryDirection | "banter";

const conversation = (...lines: string[]): RivalryScene => lines.map((text, index) => ({
  speaker: index % 2 === 0 ? "rival" : "you",
  text,
}));

// ── Silas Marrow — the Toll King. Threatens in condolences. ────────────────
const MARROW: RivalVoice = {
  attack: [
    conversation(
      "My thoughts are with your shareholders, Hextall. Truly. I have already sent flowers.",
      "Flowers? For a company that is still trading?",
      "Pre-emptively. It seemed fiscally responsible.",
      "That is the coldest thing anyone has ever shipped me.",
    ),
    conversation(
      "Your lane is toll road now. The sign went up this morning. It is very tasteful.",
      "You put a toll gate on my road.",
      "On the road. Possession is nine tenths, and I bought the other tenth.",
      "Then my lorries take the scenic route. Scenic is cheaper.",
    ),
    conversation(
      "I do not sabotage, Hextall. I adjust. The invoice arrives Thursday.",
      "There is an invoice for freezing my depot?",
      "Line four: frost, industrial. Line five: handling.",
      "I will pay it in materials, Silas. Gold is for people I intend to hurt.",
    ),
  ],
  retort: [
    conversation(
      "My gate is down. My counsel assures me this is temporary. My counsel is lying.",
      "Send my regards to your counsel.",
      "I have. He billed me for the regards.",
      "Next time send the flowers. The bill I can dispute.",
    ),
    conversation(
      "You have undone a quarter's work with one evening's driving. I note it in the minute book.",
      "The minute book? You keep a minute book of our feud?",
      "Item seven: Hextall, insolence, ongoing.",
      "Read it at the funeral, Silas.",
    ),
  ],
  thwarted: [
    conversation(
      "My men were laying a charitable donation of girders. At night. In masks.",
      "Charity does not usually flee the scene.",
      "They were shy. It is a virtue.",
      "Charity that runs from my guards owes me a chase refund.",
    ),
    conversation(
      "Consider the frost crew a audit. Unannounced. Wearing balaclavas.",
      "Your audit tried to freeze my gems.",
      "Gems retain value better in cold storage. You are welcome.",
      "Cold storage. I am putting that on your invoice, line nine.",
    ),
  ],
  banter: [
    conversation(
      "A word of free advice, Hextall. Nothing in life is free, including this: build nothing I cannot toll.",
      "That is advice for you, not for me.",
      "Correct. It was a reminder to myself, read aloud.",
      "At least you are honest in the minute book.",
    ),
    conversation(
      "I was married once, to a junction near Cleveland. The junction understood me.",
      "That is not a marriage, that is a map.",
      "The map was very faithful.",
      "I shall attend the anniversary. Alone.",
    ),
    conversation(
      "Do you know what a toll is, Hextall?",
      "A tax on movement.",
      "A promise that the road ends and I am standing there.",
      "Sleep well, Silas.",
    ),
  ],
};

// ── Delphine Roque — the Oil Queen. Sabotage as a party invitation. ────────
const ROQUE: RivalVoice = {
  attack: [
    conversation(
      "Darling! I flooded your depot with crude. Do not thank me, it was impulse.",
      "You flooded my depot.",
      "With BLACK GOLD. Say it with me. Black. Gold.",
      "My ledger does not have a line for 'impulse'.",
    ),
    conversation(
      "I bought your road at auction while you were blinking. You blink adorably, did you know?",
      "You cannot buy a road mid-game.",
      "I can buy anything mid-anything, darling. That is what oil is.",
      "Keep the road. I will keep the hauling contract for the road.",
    ),
    conversation(
      "Smoke on your horizon, sweetheart. Mine. It waves at you.",
      "Your flare stack is waving at my trucks?",
      "Everything of mine waves at everything of yours. It is called pressure.",
      "Then tell your smoke to wave faster. My lorries are not stopping.",
    ),
  ],
  retort: [
    conversation(
      "My derrick is down and my hair is still perfect. Note both.",
      "Noted. Both.",
      "Say it like you mean it, darling.",
      "Both noted, in ink, under assets.",
    ),
    conversation(
      "You caught my crew! I am furious! Absolutely— no wait, I am delighted, they adore you.",
      "Your crew brought their own snacks.",
      "Of course they did. Sabotage on an empty stomach is amateur hour.",
      "Tell them the gate is open whenever they want to surrender.",
    ),
  ],
  thwarted: [
    conversation(
      "Those men in your yard? Fire dancers. Very avant-garde.",
      "They had crowbars, Delphine.",
      "Props, darling. The piece is about crowbars.",
      "The piece needs a permit, Delphine. And a smaller cast.",
    ),
    conversation(
      "My protest march was genuine! I paid for genuine!",
      "The signs said 'ROQUE OIL IS HOT' with a heart.",
      "That is grassroots organising, darling.",
      "Grassroots with your logo on the water jugs, darling.",
    ),
  ],
  banter: [
    conversation(
      "Darling, quick question. If I drill on your side of the map, hypothetically—",
      "No.",
      "—how angry? On a scale of one to wedding.",
      "Beyond wedding.",
    ),
    conversation(
      "I named a derrick after you. It leaks, but it tries.",
      "I am honoured and insulted in one line.",
      "That is my whole personality, sweetheart.",
      "Name the next one after my depot. It leaks less.",
    ),
    conversation(
      "They call me the Oil Queen. Do you know what I call them?",
      "Who?",
      "Everyone. I call everyone them. It keeps things simple.",
      "It keeps things vague.",
    ),
  ],
};

// ── Krag — the Quarry King. Few words, all of them stone. ──────────────────
const KRAG: RivalVoice = {
  attack: [
    conversation(
      "Put girders on your plant. Girders stay. You do not.",
      "That is your threat? Girders staying?",
      "Girders outlast us all. Think about it.",
      "Think about it later, Krag. My trucks are moving now.",
    ),
    conversation(
      "Rock fell on your road.",
      "Rock fell.",
      "Big rock. My rock.",
      "Of course it was your rock.",
    ),
    conversation(
      "Froze your gems. Stone cold. Stone wins.",
      "You froze them with what, exactly?",
      "Patience.",
      "Patience melts, Krag. My combos do not.",
    ),
  ],
  retort: [
    conversation(
      "Hm. Your guards are good. Stone respect them.",
      "Please never say that again.",
      "Stone say it once. Enough.",
      "They unionised. It was your frost that did it.",
    ),
    conversation(
      "You broke my blockade. Blockade was young. It happens.",
      "That is surprisingly graceful of you.",
      "Grace is a rock thing. Look at marble.",
      "Then may the marble outlive us both. It usually does.",
    ),
  ],
  thwarted: [
    conversation(
      "Was not my crew. My crew is upstairs. Having soup.",
      "Your crew was in my quarry with crowbars.",
      "Crowbars are for soup too. Sometimes.",
      "Soup at midnight, in my quarry, with crowbars. Noted.",
    ),
  ],
  banter: [
    conversation(
      "Rain today.",
      "…Yes. It is raining.",
      "Good for stone. Bad for you.",
      "Noted in the ledger: weather has a favourite.",
    ),
    conversation(
      "I talk to the quarry. It listens slow, but it listens.",
      "And what does it say about me?",
      "It says: small trucks. Big mouth.",
      "Tell the hill its mouth is bigger than its output.",
    ),
    conversation(
      "You build fast.",
      "Thank you, Krag.",
      "Fast is soft. Stone builds slow. Stone stays.",
      "Then may the slowest win.",
    ),
  ],
};

// ── Aldous Griev — the Chairman. Politeness as a weapon. ───────────────────
const GRIEV: RivalVoice = {
  attack: [
    conversation(
      "The Syndicate notes your little network with interest. Interest, in our minute book, is a charge.",
      "You are charging me interest on existing?",
      "Clause eleven: existence within Syndicate territory accrues.",
      "I would like to speak to whoever drafted clause eleven.",
    ),
    conversation(
      "Your depot is in receivership as of this morning. The receiver is me.",
      "You cannot receive your rival's depot.",
      "I have received it, therefore I can. The paperwork is immaculate.",
      "Then the receiver can feed my lorries at dawn. I will invoice him.",
    ),
    conversation(
      "A frost audit of your board was carried out at dawn. It found gems. They remain frozen pending review.",
      "Pending review by whom?",
      "By me. Review complete. They remain frozen.",
      "Appeal filed, Chairman — with myself. It was upheld.",
    ),
  ],
  retort: [
    conversation(
      "The minute book records a setback. The setback is you. I have initialled it.",
      "Initialled your own setback?",
      "Everything is initialled, Hextall. Everything.",
      "Initial this: my stars, your setback, same page.",
    ),
    conversation(
      "Your security detained my auditors. I have filed a complaint.",
      "With whom?",
      "With myself. It was upheld. I am disappointed in you.",
      "I will recover, Chairman.",
    ),
  ],
  thwarted: [
    conversation(
      "Those men in your yard were delivering stationery. Aggressively.",
      "Stationery with bolt cutters.",
      "The Syndicate opens many envelopes.",
      "Aggressively stamped, no doubt. My guards signed for it.",
    ),
    conversation(
      "My presence at your depot was ceremonial.",
      "You were in a van with a fog machine.",
      "Ceremony requires atmosphere.",
      "The fog machine was the choir, I assume.",
    ),
  ],
  banter: [
    conversation(
      "The meeting will come to order. There is no meeting. I simply enjoy the phrase.",
      "Chairman, it is Saturday.",
      "Saturday is a minute item. Read.",
      "I am hanging up on the minute book.",
    ),
    conversation(
      "I have chaired forty-one boards, Hextall. Do you know what survives all of them?",
      "Paperwork?",
      "Paperwork. Never forget: freight rots, stone erodes, paper persists.",
      "Paper persists, Chairman. So does asphalt. Mine.",
    ),
    conversation(
      "A proposal: you lose gracefully, I win gracefully, we adjourn for lunch.",
      "And if I decline the proposal?",
      "Then it is minuted as declined, and I win gracefully alone.",
      "The lunch was the only part I wanted.",
    ),
  ],
};

export const STORY_VOICES: Partial<Record<CastId, RivalVoice>> = {
  marrow: MARROW,
  roque: ROQUE,
  krag: KRAG,
  griev: GRIEV,
};

/** Small stable hash — the same discipline `rivalry.ts` uses, copied not imported
 *  because it is private there and the two decks must never share a sequence. */
function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The next scene for a campaign rival. Torvin — whose deck lives in
 * `rivalry.ts`, not here — and any direction a new rival's deck lacks fall
 * through to the original directors, so the wire is never silent and never
 * out of character. Deterministic per (seed, call count); never repeats the
 * last scene; never touches simulation RNG.
 */
export function createStoryDirector(
  rival: CastId, seed = 0,
): (direction: StoryDirection, tactic: RivalryTactic) => RivalryScene {
  const voice = STORY_VOICES[rival];
  const fallbackRival = createRivalDirector(seed);
  const fallbackBanter = createBanterDirector(seed);
  let calls = 0;
  const previous = new Map<string, number>();
  return (direction, tactic) => {
    const deck = voice?.[direction] ?? null;
    if (!deck || !deck.length) {
      return direction === "banter" ? fallbackBanter() : fallbackRival(direction, tactic);
    }
    let at = hashText(`${seed}:${calls++}:${direction}`) % deck.length;
    if (deck.length > 1 && previous.get(direction) === at) at = (at + 1) % deck.length;
    previous.set(direction, at);
    return deck[at];
  };
}
