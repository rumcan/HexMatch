// ══════════════════════════════════════════════════════════════════════════
// The rival's voice — and the player's answer.
//
// Torvin is an old-school industrial baron who desperately wants to sound
// dangerous and is catastrophically bad at comebacks. Every one of his lines
// therefore has an immediate answer from the player's own portrait. The beats
// stay short, alternate speakers, and run on the small pointer-transparent wire
// card; they never pause a turn or consume simulation RNG.
// ══════════════════════════════════════════════════════════════════════════

export type RivalryDirection = "retort" | "attack" | "thwarted";
export type RivalryTactic = "bandit" | "harden" | "block" | "fog" | "protest";
export type RivalrySpeaker = "rival" | "you";

export interface RivalryBeat {
  speaker: RivalrySpeaker;
  text: string;
}

export type RivalryScene = readonly RivalryBeat[];

type SceneDeck = Record<RivalryDirection, Record<RivalryTactic, readonly RivalryScene[]>>;

const exchange = (rival: string, you: string): RivalryScene => [
  { speaker: "rival", text: rival },
  { speaker: "you", text: you },
];

const conversation = (...lines: string[]): RivalryScene => lines.map((text, index) => ({
  speaker: index % 2 === 0 ? "rival" : "you",
  text,
}));

/**
 * The intentionally awkward Black Market exchanges. A scene always starts
 * with Torvin and ends with the player puncturing the threat.
 */
export const RIVALRY_SCENES: SceneDeck = {
  retort: {
    bandit: [
      exchange(
        "You blocked my district. Two can play at that game. I don't know how, but two can.",
        "Strong finish. You really found the ditch at the end.",
      ),
      exchange(
        "Forty-five seconds? I have naps longer than your blockades.",
        "You're bragging about naps during a freight war?",
      ),
      exchange(
        "You may have the road, but I have the high road. Metaphorically. The actual road is blocked.",
        "Thanks for explaining the metaphor. It was in critical condition.",
      ),
    ],
    harden: [
      exchange(
        "Ice to meet you. Ha! Still got it.",
        "You built an empire and that's the comeback?",
      ),
      exchange(
        "My furnaces run hot. Like me in my courting days.",
        "Please never connect those ideas again.",
      ),
      exchange(
        "You froze seven gems. Seven! Lucky number for me.",
        "That is not how freezing works.",
      ),
    ],
    block: [
      exchange(
        "I've been girded. Or girdered. The point is, steel fears me.",
        "Steel doesn't know who you are.",
      ),
      exchange(
        "These girders will make excellent... girders for my next building.",
        "A devastating display of vocabulary.",
      ),
      exchange(
        "You sent scrap to a man who remembers rationing.",
        "You also remember when that sounded threatening?",
      ),
    ],
    fog: [
      exchange(
        "A little smog never hurt anybody. That's what we used to say.",
        "Yes. Then everybody started coughing.",
      ),
      exchange(
        "You cannot smoke out an old fox.",
        "You're in a factory, not a woodland fable.",
      ),
      exchange(
        "I did business in smoke-filled rooms before you were born.",
        "That explains all of this, honestly.",
      ),
    ],
    protest: [
      exchange(
        "I've stared down angrier crowds at the bingo hall.",
        "Why was the bingo hall angry with you?",
      ),
      exchange(
        "Let them picket. I've got sandwiches and a folding chair.",
        "That is less a threat and more a picnic plan.",
      ),
      exchange(
        "The people love me. Some of them just express it with signs.",
        "The signs literally say ‘GO HOME.’",
      ),
    ],
  },
  attack: {
    bandit: [
      conversation(
        "Your district is closed. Consider yourself... out-districted.",
        "Did you rehearse ‘out-districted’?",
        "Twice.",
        "That somehow made it worse.",
      ),
      exchange(
        "I found your weak artery. That's business anatomy.",
        "Please stop doing business anatomy.",
      ),
      exchange(
        "No cargo gets through. I am the toll troll.",
        "You chose that nickname for yourself?",
      ),
    ],
    harden: [
      conversation(
        "Ice to meet you.",
        "You waited your whole life to use that, didn't you?",
        "Since 1962.",
        "I believe you.",
      ),
      exchange(
        "Your plant has cold feet. About losing.",
        "Plants don't have feet, and neither did that joke.",
      ),
      exchange(
        "Seven frozen gems. Call me Jack Frost's accountant.",
        "Nobody has ever wanted that title.",
      ),
    ],
    block: [
      exchange(
        "You've been girdered. It's an industry term.",
        "No, it absolutely isn't.",
      ),
      exchange(
        "I put the steel in steal your victory.",
        "That sentence should be recalled for safety.",
      ),
      exchange(
        "Those bars are a metaphor for your limited future.",
        "You had to explain it, so the metaphor is gone.",
      ),
    ],
    fog: [
      exchange(
        "Smoke 'em if you got 'em. I quit, doctor's orders.",
        "Your threat came with a medical disclaimer.",
      ),
      exchange(
        "Now you see me, now you don't.",
        "I couldn't see you before. This is a telephone.",
      ),
      exchange(
        "Welcome to the fog of war. Patent pending.",
        "You cannot patent weather, grandpa.",
      ),
    ],
    protest: [
      exchange(
        "The people have spoken. I paid them, but they spoke.",
        "You keep confessing during your own taunts.",
      ),
      exchange(
        "Your trucks are on strike. Mine remain emotionally employed.",
        "Emotionally employed is not a thing.",
      ),
      exchange(
        "Two minutes of silence, courtesy of democracy.",
        "That is neither silence nor democracy.",
      ),
    ],
  },
  thwarted: {
    bandit: [
      exchange(
        "Guards? I was only checking the hinges.",
        "With bolt cutters?",
      ),
      exchange(
        "This was a routine surprise inspection.",
        "By a man hiding behind a hedge?",
      ),
    ],
    harden: [
      exchange(
        "That frost crew was delivering ice for beverages.",
        "The crates said ‘INDUSTRIAL SABOTAGE.’",
      ),
      exchange(
        "Your guards ruined a perfectly good winter metaphor.",
        "They saved us from hearing it. Heroes.",
      ),
    ],
    block: [
      exchange(
        "The girders were a gift. Very structural.",
        "You wrapped them in a ransom note.",
      ),
      exchange(
        "My driver took a wrong turn into your factory.",
        "Four times, carrying attack girders?",
      ),
    ],
    fog: [
      conversation(
        "That smoke was medicinal.",
        "For whom?",
        "Me, mostly.",
        "That tracks.",
      ),
      exchange(
        "Your guards are suspicious of perfectly normal clouds.",
        "Normal clouds don't arrive in your van.",
      ),
    ],
    protest: [
      exchange(
        "Those were concerned citizens.",
        "They all had your company logo on their signs.",
      ),
      exchange(
        "I was promoting civic engagement.",
        "You were promoting traffic.",
      ),
    ],
  },
};

/**
 * A one-off scene when the player's oil network first pays out. This is longer
 * than a sabotage exchange on purpose: Torvin keeps trying to rescue one bad
 * hand gesture from the fact that this conversation is happening remotely.
 */
export const OIL_DRILLING_SCENE: RivalryScene = conversation(
  "I see you're drilling for oil. How about you drill this!",
  "Drill what?",
  "I was making a rude gesture with my hands.",
  "Yeah, I can't see you.",
  "Point stands.",
  "Wait—what point?",
  "Just... you just watch your back, sonny.",
  "Okay...",
);

/** The original rival-only view remains useful to copy audits and callers. */
const linesFor = (direction: RivalryDirection): Record<RivalryTactic, readonly string[]> => ({
  bandit: RIVALRY_SCENES[direction].bandit.map((scene) => scene[0].text),
  harden: RIVALRY_SCENES[direction].harden.map((scene) => scene[0].text),
  block: RIVALRY_SCENES[direction].block.map((scene) => scene[0].text),
  fog: RIVALRY_SCENES[direction].fog.map((scene) => scene[0].text),
  protest: RIVALRY_SCENES[direction].protest.map((scene) => scene[0].text),
});

export const RIVALRY_LINES: Record<
  RivalryDirection,
  Record<RivalryTactic, readonly string[]>
> = {
  retort: linesFor("retort"),
  attack: linesFor("attack"),
  thwarted: linesFor("thwarted"),
};

/** Small stable hash: dialogue varies by match but a restored match keeps its voice. */
function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const pickIndex = (
  direction: RivalryDirection,
  tactic: RivalryTactic,
  sequence: number,
  seed: number,
): number => hashText(`${seed}:${sequence}:${direction}:${tactic}`)
  % RIVALRY_SCENES[direction][tactic].length;

/** Pick one rival line without touching the game's injected simulation RNG. */
export function rivalLine(
  direction: RivalryDirection,
  tactic: RivalryTactic,
  sequence = 0,
  seed = 0,
): string {
  return RIVALRY_SCENES[direction][tactic][pickIndex(direction, tactic, sequence, seed)][0].text;
}

/** Pick the complete alternating exchange represented by `rivalLine`. */
export function rivalryScene(
  direction: RivalryDirection,
  tactic: RivalryTactic,
  sequence = 0,
  seed = 0,
): RivalryScene {
  return RIVALRY_SCENES[direction][tactic][pickIndex(direction, tactic, sequence, seed)];
}

/** Stateful legacy rival-only voice, retained for simple text consumers. */
export function createRivalVoice(seed = 0) {
  let sequence = 0;
  const previous = new Map<string, string>();
  return (direction: RivalryDirection, tactic: RivalryTactic): string => {
    const lines = RIVALRY_LINES[direction][tactic];
    const key = `${direction}:${tactic}`;
    let line = rivalLine(direction, tactic, sequence++, seed);
    if (lines.length > 1 && previous.get(key) === line) {
      const at = lines.indexOf(line);
      line = lines[(at + 1) % lines.length];
    }
    previous.set(key, line);
    return line;
  };
}

/** Stateful scene director; it also avoids repeating one exchange back to back. */
export function createRivalDirector(seed = 0) {
  let sequence = 0;
  const previous = new Map<string, number>();
  return (direction: RivalryDirection, tactic: RivalryTactic): RivalryScene => {
    const scenes = RIVALRY_SCENES[direction][tactic];
    const key = `${direction}:${tactic}`;
    let at = pickIndex(direction, tactic, sequence++, seed);
    if (scenes.length > 1 && previous.get(key) === at) at = (at + 1) % scenes.length;
    previous.set(key, at);
    return scenes[at];
  };
}
