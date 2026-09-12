// ══════════════════════════════════════════════════════════════════════════
// The rival's voice.
//
// Black Market actions used to be mechanically loud and dramatically silent:
// a toast explained the rules, but the opponent never acknowledged the hit.
// These short lines are deliberately UI-agnostic. game.ts puts them on the
// rival's small, self-dismissing wire card and in the Feed; they never pause a
// turn, steal focus, or become a modal.
// ══════════════════════════════════════════════════════════════════════════

export type RivalryDirection = "retort" | "attack" | "thwarted";
export type RivalryTactic = "bandit" | "harden" | "block" | "fog" | "protest";

const RETORTS: Record<RivalryTactic, readonly string[]> = {
  bandit: [
    "You've bought forty-five seconds. I'll collect the interest.",
    "Chain one gate and I open three more. You should know that by now.",
    "A blockade? Good. The night crews were getting comfortable.",
  ],
  harden: [
    "Ice in my plant? Cute. My night shift owns hammers.",
    "Freeze the floor if you like. You cannot freeze an order book.",
    "A little winter will not stop this furnace.",
  ],
  block: [
    "Drop all the steel you like. I will build around it.",
    "Those girders have my name on them now. Very generous.",
    "You sent scrap metal. I expected a strategy.",
  ],
  fog: [
    "You can hide my machines. You cannot stop them.",
    "Smoke is how you know the furnaces are still running.",
    "I have done my best work in rooms darker than this.",
  ],
  protest: [
    "A crowd on the highway? I have waited out bigger storms.",
    "Your picket line stops your lorries too. Remember that.",
    "Let them shout. The road will still be mine at dawn.",
  ],
};

const ATTACKS: Record<RivalryTactic, readonly string[]> = {
  bandit: [
    "Your busiest district just changed ownership—for forty-five seconds.",
    "I found the artery in your little empire. Now watch it close.",
    "No cargo leaves that district without my say-so.",
  ],
  harden: [
    "Consider the frost a forecast. A hard winter is coming.",
    "Seven frozen gems. Let us see how warm ambition keeps you.",
    "Your processing floor needed cooling. I obliged.",
  ],
  block: [
    "I sent four girders. Think of them as bars on the door.",
    "Production is easy when the floor is not full of my steel.",
    "Mind the falling iron. I would hate to dent your confidence.",
  ],
  fog: [
    "The smog is mine. The lost shift is yours.",
    "Run the plant blind, if you still trust your hands.",
    "You wanted an empire. Every empire gets a little smoke.",
  ],
  protest: [
    "Listen closely. That is the sound of every lorry stopping.",
    "The public road belongs to whoever can hold it.",
    "Two minutes is a long time when the other fellow is still moving.",
  ],
};

const THWARTED: Record<RivalryTactic, readonly string[]> = {
  bandit: [
    "Guards at the gate? Sensible. I can be patient.",
    "Keep the guards. I will keep looking for the unguarded door.",
  ],
  harden: [
    "Your guards stopped the frost crew. Winter will come another night.",
    "A guarded floor today is an expensive floor tomorrow.",
  ],
  block: [
    "Your guards caught the lorry. They did not catch the next idea.",
    "Keep watching the gate. I prefer the side entrance anyway.",
  ],
  fog: [
    "The guards cleared my smoke. They cannot clear your nerves.",
    "Fresh air, for now. Breathe deeply.",
  ],
  protest: [
    "You cleared the road. I only needed to know how quickly you could.",
    "No crowd today. There is always another shift change.",
  ],
};

export const RIVALRY_LINES: Record<
  RivalryDirection,
  Record<RivalryTactic, readonly string[]>
> = {
  retort: RETORTS,
  attack: ATTACKS,
  thwarted: THWARTED,
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

/**
 * Pick one line without touching the game's injected RNG. Keeping flavour
 * outside the simulation RNG means adding prose can never change a map, board,
 * market decision, or AI turn.
 */
export function rivalLine(
  direction: RivalryDirection,
  tactic: RivalryTactic,
  sequence = 0,
  seed = 0,
): string {
  const lines = RIVALRY_LINES[direction][tactic];
  const at = hashText(`${seed}:${sequence}:${direction}:${tactic}`) % lines.length;
  return lines[at];
}

/**
 * Stateful voice for one match. It avoids repeating the same line back to back
 * for a tactic even when a hash happens to land on the same card.
 */
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
